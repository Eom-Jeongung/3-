// Summary statistics use the requested calendar years and retain every group.
// This deliberately does not use the chart's series limit or date window.
const COMPANIES = ['own', 'competitor', 'china'];
const LEVELS = ['level1', 'level2', 'level3'];
const MIN_COUNT = 30;
const change = (first, last) => first >= MIN_COUNT ? Math.round((last - first) / first * 100) : null;

export function getSummaryStats(db, { level1, level2, level3, from, to }, version) {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from >= to || from < 1990 || to > 9999) {
    throw new Error('Invalid summary period');
  }
  const dates = db.prepare('SELECT MAX(application_date) applied, MAX(open_date) opened FROM patents').get();
  if (!dates.applied || to > Number(dates.applied.slice(0, 4))) {
    throw new Error('요청한 마지막 연도까지의 출원 데이터가 없습니다');
  }

  const scope = { level1, level2, level3 };
  const groupLevel = level3 ? null : level2 ? 'level3' : level1 ? 'level2' : 'level1';
  const groupExpr = groupLevel ? `COALESCE(c.${groupLevel}, '미분류')` : "'전체'";
  const filters = LEVELS.filter((key) => scope[key]);
  const where = filters.map((key) => `AND c.${key} = @${key}`).join(' ');
  const params = { version, from: `${from}-01-01`, end: `${to}-12-31`, ...Object.fromEntries(filters.map((key) => [key, scope[key]])) };
  const rows = db.prepare(`
    SELECT p.applicant_type company, substr(p.application_date, 1, 4) year,
           ${groupExpr} grp, COUNT(*) n
    FROM patents p JOIN classification c ON c.application_number = p.application_number
    WHERE c.is_primary = 1 AND c.criteria_version = @version ${where}
      AND p.application_date BETWEEN @from AND @end
      AND p.applicant_type IN ('own', 'competitor', 'china')
    GROUP BY 1, 2, 3
  `).all(params);
  const groups = [...new Set(rows.map((row) => row.grp))].sort();
  let cutoff = null;
  if (dates.opened) {
    const date = new Date(`${dates.opened}T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() - 18);
    cutoff = date.toISOString().slice(0, 10);
  }
  const periods = Array.from({ length: to - from + 1 }, (_, i) => {
    const year = from + i;
    return { key: String(year), label: `${year}년`, incomplete: !cutoff || `${year}-12-31` >= cutoff };
  });
  const series = Object.fromEntries(COMPANIES.map((company) => [company,
    Object.fromEntries(groups.map((group) => [group, Array(periods.length).fill(0)]))]));
  for (const row of rows) series[row.company][row.grp][Number(row.year) - from] = row.n;
  const totals = COMPANIES.map((company) => {
    const counts = periods.map((_, i) => groups.reduce((sum, group) => sum + series[company][group][i], 0));
    return { company, counts, change: change(counts[0], counts.at(-1)) };
  });
  const table = COMPANIES.flatMap((company) => groups.flatMap((group) => {
    const counts = series[company][group];
    if (counts.every((count) => count === 0)) return [];
    const total = totals.find((item) => item.company === company).counts.at(-1);
    return [{ company, group, counts, change: change(counts[0], counts.at(-1)),
      share: total ? Math.round(counts.at(-1) / total * 100) : null }];
  }));
  return { periods, groups, groupLevel, companies: COMPANIES, series, totals, table };
}
