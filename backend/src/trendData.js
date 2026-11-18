// 트렌드 집계 (대시보드·기술 분야별 분석·AI 동향 요약이 함께 쓴다). AI 없이 DB만으로 계산한다
import { db } from './db.js';
import { CHINA_APPLICANTS } from './kipris.js';
import { MIN_COUNT, UNPUBLISHED_MONTHS } from './summaryStats.js';

const WINDOW_COUNT = 3; // 최근 12개월 + 비교용 이전 2개 구간
const MOVER_LIMIT = 5; // 회사별로 보여 줄 세부 기술 수
const UNCLASSIFIED = '미분류';
export const COMPANIES = ['own', 'competitor', 'china']; // china: 중국 경쟁사 4곳 합계 (BOE·CSOT·Tianma·Visionox)
const LATEST_VERSION_SQL = '(SELECT MAX(criteria_version) FROM classification)';

// 공개일 구간 집계: 그 구간 특허만 먼저 고르고 출원번호로 분류를 찾는다
// 색인을 못 박지 않으면 특허마다 분류 표를 훑는 계획이 잡혀 서버가 멈출 수 있다
const PATENTS_THEN_CLASSIFICATION = `
  FROM patents p CROSS JOIN classification c INDEXED BY idx_classification_number
    ON c.application_number = p.application_number
`;

const ymd = (d) => d.toISOString().slice(0, 10);
const addYears = (d, n) => { const r = new Date(d); r.setUTCFullYear(r.getUTCFullYear() + n); return r; };
const addDays = (d, n) => { const r = new Date(d); r.setUTCDate(r.getUTCDate() + n); return r; };

/** 직전 구간 대비 증감률(%). 직전 건수가 MIN_COUNT 미만이면 null */
export function changeOf(current, previous) {
  if (previous < MIN_COUNT) return null;
  return Math.round(((current - previous) / previous) * 100);
}

const emptyCounts = () => Object.fromEntries(COMPANIES.map((c) => [c, Array(WINDOW_COUNT).fill(0)]));

// 공개일 기준 12개월 구간. 특허는 출원 후 보통 18개월 뒤 공개되므로 출원일로 자르면 최근 구간이 비어 버린다
// 달력 연도가 아니라 DB의 최신 공개일에서 거꾸로 12개월씩 자른다 (진행 중인 해만 적어 보이는 문제 방지)
function getWindows() {
  const { latest } = db.prepare('SELECT MAX(open_date) latest FROM patents').get();
  if (!latest) return [];
  const totals = db.prepare('SELECT applicant_type, COUNT(*) n FROM patents WHERE open_date BETWEEN ? AND ? GROUP BY 1');
  const end = new Date(latest);
  return Array.from({ length: WINDOW_COUNT }, (_, i) => {
    const to = ymd(addYears(end, -i));
    const from = ymd(addDays(addYears(end, -(i + 1)), 1));
    const rows = totals.all(from, to);
    const pick = (type) => rows.find((r) => r.applicant_type === type)?.n ?? 0;
    return { from, to, ...Object.fromEntries(COMPANIES.map((c) => [c, pick(c)])) };
  });
}

// 3차가 전부 같은 2차 안에 있으므로 "2차|3차"를 키로 묶는다
function addCount(map, key, base, company, windowIndex, n) {
  if (!map.has(key)) map.set(key, { ...base, ...emptyCounts() });
  map.get(key)[company][windowIndex] += n;
}

export function getOverview() {
  const windows = getWindows();
  const unclassified = emptyCounts();
  if (!windows.length) return { windows, fields: [], movers: { own: [], competitor: [] }, unclassified, minCount: MIN_COUNT };

  const byField = db.prepare(`
    SELECT p.applicant_type company, c.level2, c.level3, COUNT(*) n
    ${PATENTS_THEN_CLASSIFICATION}
    WHERE c.is_primary = 1 AND c.criteria_version = ${LATEST_VERSION_SQL}
      AND p.open_date BETWEEN ? AND ?
    GROUP BY 1, 2, 3
  `);
  const fieldMap = new Map();
  const topicMap = new Map();
  windows.forEach((w, i) => {
    for (const { company, level2, level3, n } of byField.all(w.from, w.to)) {
      if (level2 === UNCLASSIFIED) { unclassified[company][i] += n; continue; }
      addCount(fieldMap, level2, { level2 }, company, i, n);
      // '기타 ○○'는 어디에도 안 걸린 나머지라 기술 흐름으로 읽을 수 없어 세부 기술 순위에서 뺀다
      if (level3 && !level3.startsWith('기타 ')) addCount(topicMap, `${level2}|${level3}`, { level2, level3 }, company, i, n);
    }
  });

  // 2차는 최근 12개월 건수가 많은 순으로
  const recentTotal = (f) => COMPANIES.reduce((s, c) => s + f[c][0], 0);
  const fields = [...fieldMap.values()].sort((a, b) => recentTotal(b) - recentTotal(a));

  // 회사별로 가장 많이 늘어난 세부 기술
  const movers = Object.fromEntries(COMPANIES.map((company) => [
    company,
    [...topicMap.values()]
      .map((t) => ({ level2: t.level2, level3: t.level3, counts: t[company], change: changeOf(t[company][0], t[company][1]) }))
      .filter((t) => t.change !== null && t.change > 0)
      .sort((a, b) => b.change - a.change)
      .slice(0, MOVER_LIMIT),
  ]));

  return { windows, fields, movers, unclassified, minCount: MIN_COUNT };
}

// ---- 출원 추이 그래프 ----
const MAX_SERIES = 7; // 그래프가 읽히는 선의 수. 나머지는 '그 외'로 묶는다
const OTHER_GROUP = '그 외';

const addMonths = (d, n) => { const r = new Date(d); r.setUTCMonth(r.getUTCMonth() + n); return r; };

// 고른 분야의 바로 아래 단계로 나눈다 (전체 → 1차 → 2차 → 3차)
function groupLevelOf({ level1, level2, level3 }) {
  if (level3) return null;
  if (level2) return 'level3';
  if (level1) return 'level2';
  return 'level1';
}

function buildPeriods(startYear, endYear, unit, cutoff) {
  const periods = [];
  for (let y = startYear; y <= endYear; y++) {
    if (unit === 'year') {
      periods.push({ key: String(y), label: `${y}년`, end: `${y}-12-31` });
    } else {
      periods.push({ key: `${y}-H1`, label: `${y} 상반기`, end: `${y}-06-30` });
      periods.push({ key: `${y}-H2`, label: `${y} 하반기`, end: `${y}-12-31` });
    }
  }
  // 구간 끝이 기준일을 넘으면 아직 공개 안 된 출원이 빠져 있어 적게 보인다
  return periods.map((p) => ({ ...p, incomplete: p.end >= cutoff }));
}

function buildSummary(periods, groups, series, companies) {
  const complete = periods.map((p, i) => ({ ...p, i })).filter((p) => !p.incomplete);
  if (complete.length < 2) return null;
  const first = complete[0];
  const last = complete[complete.length - 1];

  const rows = groups.map((group) => {
    const row = { group };
    for (const c of companies) {
      const values = series[c][group];
      row[c] = { first: values[first.i], last: values[last.i], change: changeOf(values[last.i], values[first.i]) };
    }
    return row;
  });

  // 회사별로 가장 많이 늘고 줄어든 분야. '미분류'와 '기타'는 기술 흐름으로 읽을 수 없어 뺀다
  const readable = rows.filter((r) => r.group !== UNCLASSIFIED && r.group !== OTHER_GROUP && !r.group.startsWith('기타 '));
  const highlights = companies.flatMap((company) => {
    // %로 고르면 시작 건수가 작은 분야가 위로 올라와(37건 → 284건, +668%) 건수 차이로 고른다
    const gap = (r) => r[company].last - r[company].first;
    const ranked = readable.filter((r) => r[company].change !== null).sort((a, b) => gap(b) - gap(a));
    const pick = (r) => ({ company, group: r.group, ...r[company] });
    const top = ranked[0];
    const bottom = ranked[ranked.length - 1];
    return [
      top && top[company].change > 0 ? pick(top) : null,
      bottom && bottom[company].change < 0 ? pick(bottom) : null,
    ].filter(Boolean);
  });
  return { from: first.label, to: last.label, firstKey: first.key, lastKey: last.key, rows, highlights };
}

// 중국 경쟁사 회사별 구간 건수 (그래프는 4곳 합계라 표로 따로 보여 준다). 회사는 출원인 이름으로 가른다
function chinaByCompany({ base, params, periodExpr, index, periods, startYear }) {
  const caseExpr = `CASE ${CHINA_APPLICANTS.map((c, i) => `WHEN p.applicant_name LIKE @like${i} THEN '${c.company}'`).join(' ')} ELSE '기타' END`;
  const likes = Object.fromEntries(CHINA_APPLICANTS.map((c, i) => [`like${i}`, `%${c.query}%`]));
  const out = Object.fromEntries(CHINA_APPLICANTS.map((c) => [c.company, Array(periods.length).fill(0)]));
  const rows = db.prepare(`
    SELECT ${caseExpr} company, ${periodExpr} period, COUNT(*) n
    ${base} AND p.applicant_type = 'china' AND p.application_date >= @start
    GROUP BY 1, 2
  `).all({ ...params, ...likes, start: `${startYear}-01-01` });
  for (const { company, period, n } of rows) {
    const i = index.get(period);
    if (out[company] && i !== undefined) out[company][i] += n;
  }
  return out;
}

// '2024' → 2024년 전체, '2024-H1' → 상반기
function periodRange(key) {
  const [year, half] = key.split('-');
  if (!half) return { from: `${year}-01-01`, to: `${year}-12-31` };
  return half === 'H1' ? { from: `${year}-01-01`, to: `${year}-06-30` } : { from: `${year}-07-01`, to: `${year}-12-31` };
}

const EVIDENCE_LIMIT = 10;
const TOPICS_PER_FIELD = 3;
const COMPANY_NAMES = { own: '자사', competitor: '삼성', china: '중국 4사' };

/**
 * 요약의 근거 특허: 많이 늘어난 분야에서 어떤 세부 기술이 늘었는지 보여 주는 예시
 * 분야 안에서 건수가 가장 많이 늘어난 3차 → 마지막 구간에 출원된 특허 → 최근 공개순
 * PRD에는 없는 추가 기능(팀 결정). 중요도 순위가 아니라 규칙으로 뽑은 예시다. 줄어든 분야는 건수가 근거라 특허를 뽑지 않는다
 */
function selectEvidence(summary, scope, groupLevel) {
  const rises = (summary?.highlights ?? []).filter((h) => h.change > 0);
  if (!rises.length) return [];

  const scopeLevels = Object.entries(scope).filter(([, v]) => v);
  const first = periodRange(summary.firstKey);
  const last = periodRange(summary.lastKey);
  const quota = Math.ceil(EVIDENCE_LIMIT / rises.length);
  const seen = new Set();
  const picked = [];

  for (const rise of rises) {
    const filters = { ...Object.fromEntries(scopeLevels), ...(groupLevel && { [groupLevel]: rise.group }) };
    const levelSql = Object.keys(filters).map((k) => `AND c.${k} = @${k}`).join(' ');
    // 출원일 구간으로 먼저 좁힌다 (회사 기준으로 고르면 수만 건을 훑어 서버가 느려진다)
    const where = `
      FROM patents p INDEXED BY idx_patents_application_date
      CROSS JOIN classification c INDEXED BY idx_classification_number ON c.application_number = p.application_number
      WHERE p.applicant_type = @company AND c.is_primary = 1 AND c.criteria_version = ${LATEST_VERSION_SQL} ${levelSql}
    `;
    const topicCount = db.prepare(`
      SELECT c.level3 topic, COUNT(*) n ${where}
        AND p.application_date BETWEEN @from AND @to AND c.level3 IS NOT NULL AND c.level3 NOT LIKE '기타 %'
      GROUP BY 1
    `);
    const params = { ...filters, company: rise.company };
    const before = new Map(topicCount.all({ ...params, ...first }).map((r) => [r.topic, r.n]));
    const topics = topicCount.all({ ...params, ...last })
      .map((r) => ({ topic: r.topic, first: before.get(r.topic) ?? 0, last: r.n }))
      .sort((a, b) => (b.last - b.first) - (a.last - a.first))
      .slice(0, TOPICS_PER_FIELD);

    const patentsOf = db.prepare(`
      SELECT p.id, p.application_number, p.title, p.applicant_type, p.application_date, p.open_date, p.legal_status,
             c.level1, c.level2, c.level3
      ${where} AND p.application_date BETWEEN @from AND @to AND c.level3 = @topic
        AND p.open_date IS NOT NULL
      ORDER BY p.open_date DESC, p.id DESC
      LIMIT ${quota}
    `);
    const pools = topics.map((t) => ({ ...t, patents: patentsOf.all({ ...params, ...last, topic: t.topic }) }));

    // 한 세부 기술에 몰리지 않게 돌아가며 한 건씩 고른다
    let taken = 0;
    for (let round = 0; round < quota && taken < quota; round++) {
      for (const pool of pools) {
        const patent = pool.patents[round];
        if (!patent || seen.has(patent.id) || taken >= quota) continue;
        seen.add(patent.id);
        taken++;
        picked.push({
          ...patent,
          reason: `${COMPANY_NAMES[rise.company]} ${rise.group} 증가 (${rise.change > 0 ? '+' : ''}${rise.change}%) · ${pool.topic} ${pool.first} → ${pool.last}건`,
        });
      }
    }
  }
  return picked.slice(0, EVIDENCE_LIMIT);
}

/** 분야별 출원 추이 (출원일 기준, 회사별) */
export function getSeries({ years, unit, company, level1, level2, level3 }) {
  // MAX를 따로 물어야 색인만 읽는다 (한 SELECT에 함께 쓰면 표 전체를 훑는다)
  const { latestApplied, latestOpen } = db.prepare(`
    SELECT (SELECT MAX(application_date) FROM patents) latestApplied, (SELECT MAX(open_date) FROM patents) latestOpen
  `).get();
  if (!latestApplied) return null;

  const companies = company ? [company] : COMPANIES;
  const scope = { level1, level2, level3 };
  const levels = Object.entries(scope).filter(([, v]) => v);
  const groupLevel = groupLevelOf(scope);
  const groupExpr = groupLevel ? `COALESCE(c.${groupLevel}, '${UNCLASSIFIED}')` : `'전체'`;
  const levelSql = levels.map(([k]) => `AND c.${k} = @${k}`).join(' ');
  const params = Object.fromEntries(levels);
  const base = `
    FROM classification c JOIN patents p ON p.application_number = c.application_number
    WHERE c.is_primary = 1 AND c.criteria_version = ${LATEST_VERSION_SQL} ${levelSql}
  `;

  // 선과 색이 기간을 바꿔도 달라지지 않도록 전체 기간 건수로 순서를 고정한다
  const ranked = db.prepare(`
    SELECT ${groupExpr} grp, COUNT(*) n FROM classification c
    WHERE c.is_primary = 1 AND c.criteria_version = ${LATEST_VERSION_SQL} ${levelSql}
    GROUP BY 1 ORDER BY 2 DESC, 1
  `).all(params).map((r) => r.grp);
  const named = ranked.length > MAX_SERIES + 1 ? ranked.slice(0, MAX_SERIES) : ranked;
  const groups = named.length < ranked.length ? [...named, OTHER_GROUP] : named;

  const endYear = Number(latestApplied.slice(0, 4));
  const startYear = endYear - years;
  const cutoff = ymd(addMonths(new Date(latestOpen), -UNPUBLISHED_MONTHS));
  const periods = buildPeriods(startYear, endYear, unit, cutoff);
  const index = new Map(periods.map((p, i) => [p.key, i]));

  const series = Object.fromEntries(companies.map((c) => [
    c,
    Object.fromEntries(groups.map((g) => [g, Array(periods.length).fill(0)])),
  ]));
  const periodExpr = unit === 'year'
    ? `substr(p.application_date, 1, 4)`
    : `substr(p.application_date, 1, 4) || '-H' || CASE WHEN substr(p.application_date, 6, 2) <= '06' THEN 1 ELSE 2 END`;
  const rows = db.prepare(`
    SELECT p.applicant_type company, ${periodExpr} period, ${groupExpr} grp, COUNT(*) n
    ${base} AND p.application_date >= @start
    GROUP BY 1, 2, 3
  `).all({ ...params, start: `${startYear}-01-01` });
  for (const { company: c, period, grp, n } of rows) {
    const i = index.get(period);
    if (!series[c] || i === undefined) continue;
    series[c][named.includes(grp) ? grp : OTHER_GROUP][i] += n;
  }

  const summary = buildSummary(periods, groups, series, companies);
  return {
    groups, periods, series, companies, unit, years, cutoff, groupLevel, minCount: MIN_COUNT,
    chinaByCompany: companies.includes('china') ? chinaByCompany({ base, params, periodExpr, index, periods, startYear }) : null,
    summary,
    evidence: selectEvidence(summary, scope, groupLevel),
  };
}
