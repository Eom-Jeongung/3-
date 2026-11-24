import { readFileSync } from 'node:fs';
// AI 동향 요약: 한 분류·기간의 건수와 근거 특허를 DB에서 뽑아 AI에게 고정 형식으로 쓰게 하고, 검사 결과와 함께 저장한다
// - 숫자는 DB에서 계산한 값만 AI에게 준다 (비중도 미리 계산). 답은 summaryCheck.js로 검사한다
// - 화면(routes/summaries.js)과 시험 스크립트(scripts/summary-trial.js)가 함께 쓴다
import { db } from './db.js';
import { getSummaryStats, MIN_COUNT, UNPUBLISHED_MONTHS } from './summaryStats.js';
import { chat, isAiConfigured } from './ai.js';
import { CRITERIA_VERSION } from './classification.js';
import { checkSummary, MAX_NOTABLE_PATENTS, SECTIONS } from './summaryCheck.js';
import { burstTerms } from './emerging.js';
import { checkStatistics } from './summaryStatCheck.js';
import { groundInterpretations } from './summaryEvidence.js';
import { buildSummaryInsights } from './summaryInsights.js';

const COMPANY = { own: '자사(LG디스플레이)', competitor: '경쟁사(삼성디스플레이)', china: '중국 경쟁사(BOE·CSOT·Tianma·Visionox)' };
const EVIDENCE_LIMIT = 10;
const BURST_LIMIT = 6; // 회사별로 AI에게 줄 급증 용어 수
// 급증 용어 중 뜻이 약한 말 (자동 추출 잡음)
const WEAK_TERMS = new Set(['주변', '주변부', '구조물', '화소', '서브화소', '부화소', '구조', '영역', '패턴', '층', '절연층', '전극', '라인', '배선', '소자', '부재', '데이터', '신호', '전압', '회로', '구동부', '패널']);
const cleanTerm = (t) => t.replace(/들$/, '').trim();
const isWeakTerm = (t) => {
  const k = cleanTerm(t).replace(/\s+/g, '');
  // "보다 상세하게", "~에 따르면" 같은 문장 표현도 뺀다
  return k.length < 3 || /^제\d/.test(k) || WEAK_TERMS.has(k) || /(하게|따르면|의하면|위하여|관한)$/.test(k);
};
const LEVELS = ['level1', 'level2', 'level3'];

/** 요약 범위 이름 (예: "OLED > 소자"). 범위가 없으면 "전체" */
export const scopeLabel = (scope) => LEVELS.map((k) => scope[k]).filter(Boolean).join(' > ') || '전체';

/** 후보가 요청한 회사·분류·기간에 실제로 속하는지 확인한 뒤에만 선정한다. */
export function selectSummaryEvidence({ scope, from, to, data, bursts }, database = db) {
  // 근거 특허: ① 급증 용어가 나온 특허(회사별 상위 3개 용어에서 1건씩) ② 증감이 큰 분야(회사별 2개)의 마지막 해 출원 1건씩
  // 매번 같은 특허(결과를 비교할 수 있게), 날짜에 몰리지 않게
  const groupCol = data.groupLevel ?? 'level3';
  const scopeWhere = LEVELS.filter((k) => scope[k]).map((k) => `AND c.${k} = @${k}`).join(' ');
  const evidenceDetail = database.prepare(`
    SELECT p.id, p.application_number number, p.applicant_type company, p.application_date date, p.legal_status status,
      c.${groupCol} field, p.title, p.abstract
    FROM patents p JOIN classification c ON c.application_number = p.application_number AND c.is_primary = 1 AND +c.criteria_version = @version
    WHERE p.application_number = @number AND p.applicant_type = @company ${scopeWhere}
      AND p.application_date BETWEEN @from AND @to
  `);
  const patentsInGroup = database.prepare(`
    SELECT p.application_number number
    FROM patents p JOIN classification c ON c.application_number = p.application_number
    WHERE c.is_primary = 1 AND +c.criteria_version = @version ${scopeWhere}
      ${data.groupLevel ? `AND c.${groupCol} = @group` : ''}
      AND p.applicant_type = @company AND substr(p.application_date, 1, 4) = @year
    ORDER BY (CAST(substr(p.application_number, -6) AS INTEGER) * 7919) % 1000 LIMIT 3
  `);
  const chosen = new Map(); // 출원번호 → 검증된 특허와 선정 이유
  const choose = (numbers, company, reason) => {
    for (const number of numbers) {
      if (chosen.has(number)) continue;
      const e = evidenceDetail.get({ ...scope, number, company, version: CRITERIA_VERSION, from: `${from}-01-01`, to: `${to}-12-31` });
      if (e) { chosen.set(number, { e, reason }); return; }
    }
  };
  for (const company of Object.keys(COMPANY)) {
    for (const b of (bursts[company] ?? []).slice(0, 3)) {
      choose(b.examples, company, `급증 용어 "${b.term}"`);
    }
  }
  const moveSize = (t) => (t.change !== null ? Math.abs(t.change) * 1000 : 0) + Math.abs(t.counts.at(-1) - t.counts[0]);
  const movers = Object.keys(COMPANY).flatMap((company) => data.table
    .filter((t) => t.company === company && t.counts.at(-1) > 0 && !['미분류', '그 외'].includes(t.group))
    .sort((a, b) => moveSize(b) - moveSize(a))
    .slice(0, 2));
  for (const t of movers) {
    const numbers = patentsInGroup.all({ version: CRITERIA_VERSION, ...scope, group: t.group, company: t.company, year: String(to) })
      .map((r) => r.number);
    choose(numbers, t.company, `증감이 큰 분야 "${data.groupLevel ? t.group : scope.level3}"`);
  }
  return [...chosen.values()].slice(0, EVIDENCE_LIMIT)
    .map(({ e, reason }) => ({
      id: e.id,
      number: e.number,
      companyKey: e.company,
      company: COMPANY[e.company],
      date: e.date,
      status: e.status,
      field: e.field,
      reason,
      title: e.title,
      fullText: `${e.title} ${(e.abstract ?? '').replace(/\s+/g, ' ').slice(0, 300)}`, // AI에게 전달한 범위와 동일
      abstract: (e.abstract ?? '').replace(/\s+/g, ' ').slice(0, 300),
    }));
}

/** AI에게 줄 자료(글), 통계 부분, 근거 특허를 만든다 */
export function buildSummaryInput({ level1, level2, level3, from, to }) {
  const scope = { level1, level2, level3 };
  const data = getSummaryStats(db, { ...scope, from, to }, CRITERIA_VERSION);
  const requestedPeriods = data.periods.map((p, i) => [p, i]).filter(([p]) => Number(p.key) >= from && Number(p.key) <= to);
  if (requestedPeriods.length < 2) throw new Error(`${from}~${to}년에 비교할 연도가 부족해요`);
  const incomplete = requestedPeriods.filter(([p]) => p.incomplete).map(([p]) => p.label);
  const { table, totals } = data;

  // 급증 용어는 마지막 해 출원을 이전 연도들과 비교한다.
  const bursts = {};
  for (const company of Object.keys(COMPANY)) {
    const { rows } = burstTerms({
      applicant: company, ...scope, dateField: 'application_date',
      pastFrom: `${from}-01-01`, recentFrom: `${to}-01-01`, ref: `${to}-12-31`,
    });
    bursts[company] = rows.filter((r) => !isWeakTerm(r.term)).slice(0, BURST_LIMIT)
      .map((r) => ({ term: cleanTerm(r.term), recent: r.recentDocs, past: r.pastDocs, examples: r.examples.map((x) => x.applicationNumber) }));
  }
  const evidence = selectSummaryEvidence({ scope, from, to, data, bursts });

  // 증감률 순위: "가장 많이 늘었다" 같은 말을 AI가 직접 비교하지 않게 미리 정렬해 준다
  const ranks = Object.keys(COMPANY).map((company) => {
    const list = table.filter((t) => t.company === company && t.change !== null).sort((a, b) => b.change - a.change);
    return list.length
      ? `${COMPANY[company]}: ${list.map((t) => `${t.group} ${t.change}%`).join(' > ')}`
      : `${COMPANY[company]}: (증감률을 계산한 분야 없음)`;
  });

  const years = requestedPeriods.map(([p]) => p.key);
  // 고른 범위 전체(예: "소자" 전체)의 합계도 대조할 수 있게 넣는다. AI는 "소자 분야 자사 320건 → 420건"처럼 합계를 자주 쓴다
  const totalField = scope.level3 || scope.level2 || scope.level1 || '전체';
  const structuredStats = {
    from, to, fields: data.groups, totalField, minimumSample: MIN_COUNT,
    values: [
      ...table.flatMap((row) => [
        ...years.map((year, i) => ({ company: row.company, field: row.group, year: Number(year), metric: 'count', value: row.counts[i] })),
        { company: row.company, field: row.group, year: to, metric: 'share', value: row.share },
        { company: row.company, field: row.group, year: to, metric: 'change', value: row.change },
      ]),
      ...totals.filter((t) => t.counts.some((n) => n > 0)).flatMap((t) => [
        ...years.map((year, i) => ({ company: t.company, field: totalField, year: Number(year), metric: 'count', value: t.counts[i] })),
        { company: t.company, field: totalField, year: to, metric: 'change', value: t.change },
      ]),
    ],
  };
  // 중국 경쟁사는 한국 출원이 원래 적어 거의 늘 30건 미만이므로, 자사·삼성 기준 주의와 따로 알린다
  const smallData = totals.filter((t) => t.company !== 'china').some((t) => t.counts.some((n) => n < MIN_COUNT));
  const chinaSmall = totals.some((t) => t.company === 'china' && t.counts.some((n) => n < MIN_COUNT));
  const dataWarnings = data.companies.flatMap((company) => data.groups.flatMap((field) => {
    const small = data.series[company][field].map((count, i) => ({ count, year: years[i] })).filter(({ count }) => count < MIN_COUNT);
    return small.length ? [`${COMPANY[company]} · ${field === '전체' ? (scope.level3 || field) : field}: ${small.map(({ year, count }) => `${year}년 ${count}건`).join(', ')} (기존 주의 기준 ${MIN_COUNT}건 미만)`] : [];
  }));
  if (data.noMatches) dataWarnings.push('선택 범위·기간에 분류된 출원이 없어 동향 판단이 어렵습니다.');
  const changeText = (c) => (c === null ? '계산 안 함(첫해 또는 마지막 해 30건 미만)' : `${c}%`);
  const statText = [
    `분류: ${scopeLabel(scope)} (분류 기준 ${CRITERIA_VERSION}), 기간: ${from}~${to}년 출원`,
    `연도: ${years.join(', ')}`,
    data.noMatches ? '선택한 범위·기간에 해당 분류 기준으로 분류된 출원이 없습니다. 데이터 수집·분류가 완전하다는 뜻은 아닙니다.' : '',
    incomplete.length ? `아직 공개가 덜 된 연도(건수가 적게 보임): ${incomplete.join(', ')}` : '',
    ...dataWarnings,
    smallData ? '주의: 연간 30건 미만인 회사·연도가 있어 몇 건 차이로도 흐름이 크게 달라 보일 수 있음' : '',
    chinaSmall ? '참고: 중국 경쟁사는 한국 출원이 연간 30건 미만인 해가 있어 증감을 해석하지 않음' : '',
    '',
    '[회사별 전체 건수 (연도순), 첫해 대비 마지막 해 증감률]',
    ...totals.map((t) => `${COMPANY[t.company]}: ${t.counts.join(', ')} / 증감 ${changeText(t.change)}`),
    '',
    '[분야별 건수 (연도순), 첫해 대비 마지막 해 증감률]',
    ...table.map((t) => `${COMPANY[t.company]} - ${t.group}: ${t.counts.join(', ')} / 증감 ${changeText(t.change)}`),
    '',
    `[분야별 비중 (${years.at(-1)}년, 회사 전체 대비)]`,
    ...table.filter((t) => t.share !== null).map((t) => `${COMPANY[t.company]} - ${t.group}: ${t.share}%`),
    '',
    '[증감률 순위 (높은 순)]',
    ...ranks,
    '',
    `[급증 용어 (${to}년 출원을 ${from}~${to - 1}년과 비교, 명칭·초록에서 자동 추출, 괄호는 ${to}년 건수 / 이전 건수)]`,
    '집계 기준 차이: 출원 건수는 주 분류 출원번호 기준으로 패밀리·후속 출원을 포함한다. 급증 용어는 회사별 같은 초록 앞 200자 기준 중복 제거 후 용어가 나온 문서 수이며, 마지막 해와 그 이전 여러 해의 출현 비율을 비교한다. 두 수치는 직접 비교할 수 없다.',
    ...Object.keys(COMPANY).map((c) => `${COMPANY[c]}: ${bursts[c].length ? bursts[c].map((b) => `${b.term}(${b.recent}/${b.past})`).join(', ') : '(뚜렷한 급증 용어 없음)'}`),
  ].join('\n');
  const facts = [
    statText,
    '',
    '[구조화 통계: company, field, year, metric(count=출원 건수, share=비중, change=첫해 대비 증감률), value]',
    JSON.stringify(structuredStats),
    '',
    '[근거 후보 특허] (출원번호 | 회사 | 출원일 | 상태 | 분야 | 선정 이유 | 명칭 | 초록 앞부분)',
    ...evidence.map((e) => `${e.number} | ${e.company} | ${e.date} | ${e.status} | ${e.field} | ${e.reason} | ${e.title} | ${e.abstract}`),
  ].join('\n');
  // 입력 표는 전 기간 0건인 행을 생략하지만, 검사는 집계에서 확인한 0건도 대조한다.
  const zeroRows = [...data.companies.flatMap((company) => data.groups
    .filter((field) => data.series[company][field].every((count) => count === 0))
    .map((field) => ({ company, field }))),
  ...totals.filter((row) => row.counts.every((count) => count === 0))
    .map((row) => ({ company: row.company, field: totalField }))];
  const validationStats = {
    ...structuredStats,
    values: [...structuredStats.values, ...zeroRows.flatMap((row) => years.map((year) => ({
      ...row, year: Number(year), metric: 'count', value: 0,
    })))],
  };
  return { facts, statText, evidence, structuredStats, validationStats, dataWarnings, incomplete };
}

/** 공개가 끝난 마지막 연도 (그 해 12월 31일 출원까지 공개가 끝났다고 볼 수 있는 해). 요약 기본 기간의 끝 */
export function lastCompleteYear() {
  const { latestOpen } = db.prepare('SELECT MAX(open_date) latestOpen FROM patents').get();
  const cutoff = new Date(latestOpen ?? Date.now());
  cutoff.setUTCMonth(cutoff.getUTCMonth() - UNPUBLISHED_MONTHS);
  return cutoff.getUTCMonth() === 11 && cutoff.getUTCDate() === 31 ? cutoff.getUTCFullYear() : cutoff.getUTCFullYear() - 1;
}

// 각 파일은 담당 항목의 규칙과 출력 틀만 담는다.
export const SUMMARY_TASKS = [
  ['핵심 메시지'],
  ['핵심 흐름', '성장 분야'],
  ['경쟁사 동향'],
  ['주목 특허'],
];

const PROMPT_FILES = ['01_stats.md', '02_timeline.md', '03_competitors.md', '04_evidence.md'];

export function splitSummaryPrompt() {
  return PROMPT_FILES.map((name) => readFileSync(new URL('../prompts/' + name, import.meta.url), 'utf8').trimEnd());
}

function readSummarySections(text) {
  const sections = new Map();
  for (const chunk of text.split(/(?=^[ \t]*#{1,6}(?:[ \t]|$))/m)) {
    const heading = chunk.split('\n', 1)[0].trim().match(/^##[ \t]+(.+?)\s*$/)?.[1];
    if (!heading) continue;
    const title = heading === '핵심 흐름 (3줄)' ? '핵심 흐름' : heading;
    if (!sections.has(title)) sections.set(title, chunk.trim());
  }
  return sections;
}

// 각 응답에서 허용한 제목과 그 본문만 가져온다.
export function combineSummaryParts(answers) {
  return SUMMARY_TASKS.flatMap((names, i) => {
    const sections = readSummarySections(answers[i] ?? '');
    return names.map((name) => sections.get(name)).filter(Boolean);
  }).join('\n');
}

function displayedPatents(section, evidence) {
  const available = new Map(evidence.map((item) => [item.number, item]));
  const lines = [];
  for (const line of section.split('\n').slice(1)) {
    const item = available.get(line.match(/^- (\d{13}) \(/)?.[1]);
    if (!item) continue;
    available.delete(item.number);
    // 식별자와 기술 문장은 유지하고, 설명 첫머리에 인용된 동일 제목만 덜어낸다.
    const prefix = `- ${item.number} (${item.company}): `;
    const title = `「${item.title}」`;
    const description = line.startsWith(prefix) ? line.slice(prefix.length) : '';
    const redundant = [`${title}은 `, `${title}는 `].find((start) => description.startsWith(start));
    lines.push(redundant ? prefix + description.slice(redundant.length) : line);
    if (lines.length === MAX_NOTABLE_PATENTS) break;
  }
  if (!lines.length) {
    lines.push(evidence.length
      ? '- 주목 특허의 근거를 확인하지 못했습니다.'
      : '- 제공된 근거 후보 특허가 없어 주목 특허를 선정하지 않았습니다.');
  }
  return ['## 주목 특허', ...lines].join('\n');
}

const scopeKey = ({ level1 = '', level2 = '', level3 = '' }) => ({ level1: level1 ?? '', level2: level2 ?? '', level3: level3 ?? '' });

/** AI로 요약을 만들고 저장한다. 같은 범위·기간은 새 행으로 쌓인다(이전 요약과 비교할 수 있게) */
export async function generateTrendSummary({ level1, level2, level3, from, to }, { source = 'manual' } = {}) {
  if (!isAiConfigured()) throw new Error('AI 설정(AI_BASE_URL, AI_MODEL)이 비어 있어요');
  const scope = scopeKey({ level1, level2, level3 });
  const { facts, statText, evidence, structuredStats, validationStats, dataWarnings, incomplete } = buildSummaryInput({ ...scope, from, to });
  // 고른 범위·기간에 분류된 특허가 없으면 AI를 부르지 않는다 (비용을 쓰고 의미 없는 요약이 저장되는 것을 막는다)
  if (structuredStats.values.length === 0) {
    throw Object.assign(new Error('선택한 범위와 기간에 분류된 특허가 없어 요약을 만들 수 없어요'), { status: 422 });
  }
  const started = Date.now();
  const prompts = splitSummaryPrompt();
  const runPart = (prompt, i) => chat([
    { role: 'system', content: prompt },
    { role: 'user', content: `[자료]\n${facts}\n\n위 자료로 동향 요약을 써 줘. 이 요청에서는 제시된 항목만 작성해 줘.` },
  ], { maxTokens: 12000, purpose: `trend-summary-${i + 1}`, timeoutMs: 180_000 });
  const parts = await Promise.all(prompts.slice(0, 3).map((prompt, i) => runPart(prompt, i)));
  parts.push(await runPart(prompts[3], 3));
  const answer = combineSummaryParts(parts);
  const grounded = groundInterpretations(answer, evidence, validationStats);
  const sections = readSummarySections(grounded.content);
  const insights = buildSummaryInsights(sections, validationStats);
  sections.set('시사점', insights.text);
  if (sections.has('주목 특허')) {
    sections.set('주목 특허', displayedPatents(sections.get('주목 특허'), evidence));
  }
  const limitations = [
    '- 규칙 기반 자동 분류의 무작위 검증 정확도는 약 85%입니다.',
    '- 출원일·출원번호 기준으로 패밀리·후속 출원을 포함합니다. 급증 용어는 유사 초록 중복 제거 후 문서 수입니다.',
    '- 경쟁사 비교는 삼성디스플레이·중국 4사(BOE·CSOT·Tianma·Visionox)의 한국 출원 기준입니다.',
    ...(dataWarnings.some((warning) => warning.includes(`기존 주의 기준 ${MIN_COUNT}건 미만`))
      ? [`- 연간 ${MIN_COUNT}건 미만은 해석에 주의합니다. 통계적 유의성 기준은 아닙니다.`] : []),
    ...(incomplete.length ? [`- 출원 후 약 ${UNPUBLISHED_MONTHS}개월의 공개 시차로 최근 연도는 과소집계될 수 있습니다.`] : []),
    ...(evidence.length < 4 ? [`- 근거 후보 특허가 ${evidence.length}건으로 기술 동향 판단에 한계가 있습니다.`] : []),
  ];
  sections.set('한계', ['## 한계', ...limitations].join('\n'));
  const content = SECTIONS.map((name) => sections.get(name)).filter(Boolean).join('\n');
  const checks = checkSummary(grounded.content, statText, evidence, { finalContent: content, requiredLimitations: limitations });
  checks.insightSelection = insights.counts;
  const interpretation = /시사(?:한|하|된|점)|필요(?:가\s*있|하(?:다|며|다는))|전망|예상(?:된|한|하)|바람직/;
  const patentLines = (readSummarySections(answer).get('주목 특허') ?? '').split('\n').slice(1);
  for (const line of patentLines.filter((line) => interpretation.test(line))) {
    checks.overreach.push(`주목 특허의 해석·제언 표현 확인 필요: ${line.trim().slice(0, 90)}`);
  }
  Object.assign(checks, checkStatistics(answer, validationStats));
  checks.evidenceWarnings = [...grounded.warnings, ...(evidence.length < 4 ? [`근거 후보 특허 ${evidence.length}건: 근거가 부족할 수 있습니다.`] : [])];
  checks.foreignText = grounded.foreignText;
  checks.dataWarnings = dataWarnings;
  const row = {
    ...scope,
    period_from: from,
    period_to: to,
    criteria_version: CRITERIA_VERSION,
    model: (process.env.AI_MODEL ?? '').trim(),
    content,
    facts,
    evidence: JSON.stringify(evidence.map(({ fullText, ...e }) => e)),
    checks: JSON.stringify(checks),
    elapsed_ms: Date.now() - started,
    source,
  };
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO trend_summaries (level1, level2, level3, period_from, period_to, criteria_version, model, content, facts, evidence, checks, elapsed_ms, source)
    VALUES (@level1, @level2, @level3, @period_from, @period_to, @criteria_version, @model, @content, @facts, @evidence, @checks, @elapsed_ms, @source)
  `).run(row);
  return getSummaryById(lastInsertRowid);
}

const parseRow = (r) => r && { ...r, evidence: JSON.parse(r.evidence), checks: JSON.parse(r.checks) };

export function getSummaryById(id) {
  return parseRow(db.prepare('SELECT * FROM trend_summaries WHERE id = ?').get(id));
}

/** 범위·기간의 가장 최근 요약 (분류 기준이 달라도 돌려주되 화면이 표시한다) */
export function latestSummary({ level1, level2, level3, from, to }) {
  const s = scopeKey({ level1, level2, level3 });
  return parseRow(db.prepare(`
    SELECT * FROM trend_summaries
    WHERE level1 = @level1 AND level2 = @level2 AND level3 = @level3 AND period_from = @from AND period_to = @to
    ORDER BY id DESC LIMIT 1
  `).get({ ...s, from, to }));
}

/**
 * 보관함: 지금까지 만든 요약 목록 (기간 상관없이 최신순, 본문 제외)
 * scope를 주면 그 범위(1·2·3차)만, null이면 모든 분류 — 목록에서 어떤 분류·기간인지 보고 고를 수 있게 분류도 돌려준다
 */
export function listSummaries(scope, limit = 300) {
  const where = scope ? 'WHERE level1 = @level1 AND level2 = @level2 AND level3 = @level3' : '';
  return db.prepare(`
    SELECT id, created_at, level1, level2, level3, period_from, period_to, model, source, criteria_version, checks
    FROM trend_summaries
    ${where}
    ORDER BY id DESC LIMIT @limit
  `).all({ ...(scope ? scopeKey(scope) : {}), limit }).map((r) => ({ ...r, checks: JSON.parse(r.checks) }));
}
