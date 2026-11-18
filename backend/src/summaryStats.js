// AI 동향 요약용 통계: 요청한 연도 그대로, 모든 분야를 담는다
// 그래프와 달리 분야 수를 줄이거나 기간을 자르지 않는다
const COMPANIES = ['own', 'competitor', 'china'];
const LEVELS = ['level1', 'level2', 'level3'];
// 건수가 적으면 몇 건 차이로 %가 크게 흔들려 증감을 내지 않는다 (프로젝트 기준이며 통계적 유의성을 뜻하지 않는다)
export const MIN_COUNT = 30;
export const UNPUBLISHED_MONTHS = 18; // 출원 후 보통 이 기간이 지나야 공개되어 최근 구간이 적게 보인다
const change = (first, last) => first >= MIN_COUNT && last >= MIN_COUNT ? Math.round((last - first) / first * 100) : null;

export function getSummaryStats(db, { level1, level2, level3, from, to }, version) {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from >= to || from < 1990 || to > 9999) {
    throw new Error('Invalid summary period');
  }
  // 고른 범위가 아니라 DB 전체에서 버전을 확인한다 (버전이 맞아도 그 범위에 특허가 없을 수 있다)
  const exists = db.prepare('SELECT 1 FROM classification WHERE is_primary = 1 AND criteria_version = ? LIMIT 1').get(version);
  if (!exists) {
    const versions = db.prepare('SELECT DISTINCT criteria_version FROM classification WHERE is_primary = 1 ORDER BY criteria_version').all()
      .map((row) => row.criteria_version);
    const error = new Error(`요약에 필요한 분류 기준 ${version}의 주 분류 데이터가 없습니다. DB에 있는 주 분류 기준: ${versions.join(', ') || '없음'}. 분류 데이터와 버전을 확인해 주세요.`);
    error.code = 'SUMMARY_CLASSIFICATION_VERSION_MISSING';
    throw error;
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
    date.setUTCMonth(date.getUTCMonth() - UNPUBLISHED_MONTHS);
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
  return { periods, groups, groupLevel, companies: COMPANIES, series, totals, table, noMatches: rows.length === 0 };
}
