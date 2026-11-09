// AI 동향 요약: 한 분류·기간의 건수와 근거 특허를 DB에서 뽑아 AI에게 고정 형식으로 쓰게 하고, 검사 결과와 함께 저장한다
// - 숫자는 DB에서 계산한 값만 AI에게 준다 (비중도 미리 계산). 답은 summaryCheck.js로 검사한다
// - 화면(routes/summaries.js)과 시험 스크립트(scripts/summary-trial.js)가 함께 쓴다
import { db } from './db.js';
import { getSeries } from './trendData.js';
import { chat, isAiConfigured } from './ai.js';
import { CRITERIA_VERSION } from './classification.js';
import { checkSummary, SECTIONS } from './summaryCheck.js';

const COMPANY = { own: '자사(LG디스플레이)', competitor: '경쟁사(삼성디스플레이 중심)' };
const EVIDENCE_LIMIT = 8;
const MIN_COUNT = 30; // 30건 미만은 %가 크게 흔들려 증감률을 내지 않는다
const pct = (a, b) => (a >= MIN_COUNT ? Math.round(((b - a) / a) * 100) : null);
const LEVELS = ['level1', 'level2', 'level3'];

/** 요약 범위 이름 (예: "OLED > 소자"). 범위가 없으면 "전체" */
export const scopeLabel = (scope) => LEVELS.map((k) => scope[k]).filter(Boolean).join(' > ') || '전체';

/** AI에게 줄 자료(글), 통계 부분, 근거 특허를 만든다 */
export function buildSummaryInput({ level1, level2, level3, from, to }) {
  const scope = { level1, level2, level3 };
  const data = getSeries({ years: Math.max(1, new Date().getFullYear() - from), unit: 'year', ...scope });
  const keep = data.periods.map((p, i) => [p, i]).filter(([p]) => Number(p.key) >= from && Number(p.key) <= to);
  if (keep.length < 2) throw new Error(`${from}~${to}년에 비교할 연도가 부족해요`);
  const incomplete = keep.filter(([p]) => p.incomplete).map(([p]) => p.label);
  const { groups } = data;

  const table = [];
  for (const company of data.companies) {
    for (const group of groups) {
      const counts = keep.map(([, i]) => data.series[company][group][i]);
      if (counts.every((n) => n === 0)) continue;
      table.push({ company, group, counts, change: pct(counts[0], counts.at(-1)) });
    }
  }
  const totals = data.companies.map((company) => {
    const counts = keep.map(([, i]) => groups.reduce((s, g) => s + data.series[company][g][i], 0));
    return { company, counts, change: pct(counts[0], counts.at(-1)) };
  });
  // 비중은 AI가 계산하지 않도록 미리 계산한다 (시험에서 AI가 "약 51%"를 직접 계산했다)
  const last = keep.length - 1;
  const shares = table.map((t) => {
    const total = totals.find((x) => x.company === t.company).counts[last];
    return { ...t, share: total ? Math.round((t.counts[last] / total) * 100) : null };
  });

  // 근거 특허: 움직임이 큰 분야(회사별 2개)에서 마지막 해 출원 2건씩. 매번 같은 특허(결과를 비교할 수 있게), 날짜에 몰리지 않게
  const groupCol = data.groupLevel ?? 'level1';
  const scopeWhere = LEVELS.filter((k) => scope[k]).map((k) => `AND c.${k} = @${k}`).join(' ');
  const pick = db.prepare(`
    SELECT p.id, p.application_number number, p.applicant_type company, p.application_date date, c.${groupCol} field, p.title, p.abstract
    FROM patents p JOIN classification c ON c.application_number = p.application_number
    WHERE c.is_primary = 1 AND +c.criteria_version = @version ${scopeWhere} AND c.${groupCol} = @group
      AND p.applicant_type = @company AND substr(p.application_date, 1, 4) = @year
    ORDER BY (CAST(substr(p.application_number, -6) AS INTEGER) * 7919) % 1000 LIMIT 2
  `);
  const moveSize = (t) => (t.change !== null ? Math.abs(t.change) * 1000 : 0) + Math.abs(t.counts.at(-1) - t.counts[0]);
  const movers = Object.keys(COMPANY).flatMap((company) => table
    .filter((t) => t.company === company && t.counts.at(-1) > 0 && !['미분류', '그 외'].includes(t.group))
    .sort((a, b) => moveSize(b) - moveSize(a))
    .slice(0, 2));
  const evidence = movers
    .flatMap((t) => pick.all({ version: CRITERIA_VERSION, ...scope, group: t.group, company: t.company, year: String(to) }))
    .slice(0, EVIDENCE_LIMIT)
    .map((e) => ({
      id: e.id,
      number: e.number,
      companyKey: e.company,
      company: COMPANY[e.company],
      date: e.date,
      field: e.field,
      title: e.title,
      fullText: `${e.title} ${e.abstract ?? ''}`, // 검사용: 초록 전체
      abstract: (e.abstract ?? '').replace(/\s+/g, ' ').slice(0, 300),
    }));

  const years = keep.map(([p]) => p.key);
  const smallData = totals.some((t) => t.counts.some((n) => n < MIN_COUNT));
  const changeText = (c) => (c === null ? '계산 안 함(30건 미만)' : `${c}%`);
  const statText = [
    `분류: ${scopeLabel(scope)} (분류 기준 ${CRITERIA_VERSION}), 기간: ${from}~${to}년 출원`,
    `연도: ${years.join(', ')}`,
    incomplete.length ? `아직 공개가 덜 된 연도(건수가 적게 보임): ${incomplete.join(', ')}` : '',
    smallData ? '주의: 연간 30건 미만인 회사·연도가 있어 몇 건 차이로도 흐름이 크게 달라 보일 수 있음' : '',
    '',
    '[회사별 전체 건수 (연도순), 첫해 대비 마지막 해 증감률]',
    ...totals.map((t) => `${COMPANY[t.company]}: ${t.counts.join(', ')} / 증감 ${changeText(t.change)}`),
    '',
    '[분야별 건수 (연도순), 첫해 대비 마지막 해 증감률]',
    ...table.map((t) => `${COMPANY[t.company]} - ${t.group}: ${t.counts.join(', ')} / 증감 ${changeText(t.change)}`),
    '',
    `[분야별 비중 (${years.at(-1)}년, 회사 전체 대비)]`,
    ...shares.filter((t) => t.share !== null).map((t) => `${COMPANY[t.company]} - ${t.group}: ${t.share}%`),
  ].join('\n');
  const facts = [
    statText,
    '',
    '[근거 후보 특허] (출원번호 | 회사 | 출원일 | 분야 | 명칭 | 초록 앞부분)',
    ...evidence.map((e) => `${e.number} | ${e.company} | ${e.date} | ${e.field} | ${e.title} | ${e.abstract}`),
  ].join('\n');
  return { facts, statText, evidence };
}

const SYSTEM_PROMPT = [
  '너는 디스플레이 기업의 특허 동향을 정리하는 분석가다. 한국어로 쓴다.',
  '규칙:',
  '- 숫자(건수, %, 연도)는 아래 [자료]에 적힌 값을 그대로만 쓴다. 비중·차이·합계·배율을 새로 계산하지 않는다. 필요한 비중은 [분야별 비중]에 있다.',
  '- 특허를 언급할 때는 [근거 후보 특허]의 출원번호를 괄호로 붙인다. 목록에 없는 특허는 언급하지 않는다.',
  '- 특허 하나를 설명할 때는 그 특허의 명칭과 초록에 있는 내용만 쓴다. 다른 특허의 내용을 섞지 않는다. 회사(자사/경쟁사)도 그 특허 줄에 적힌 대로 쓴다.',
  '- 한 문장에서 특허 여러 건을 언급할 때는 각 내용 바로 뒤에 그 특허의 출원번호를 붙인다.',
  '- 해석은 써도 된다. 단, 해석마다 근거(자료의 숫자 또는 근거 특허 출원번호)를 함께 쓰고, "~로 보인다", "~가능성이 있다"처럼 추정임을 밝힌다.',
  '  예: "근거 특허 2건(출원번호, 출원번호)이 모두 뱅크 구조를 다루고 전극·화소 정의 건수도 늘어, 화소 구조 개선에 관심이 커진 것으로 보인다."',
  '- 자료에 없는 외부 지식(시장 상황, 제품 출시, 회사 전략 발표 등)으로 원인을 설명하지 않는다. 미래 전망은 쓰지 않는다.',
  '- 핵심 흐름은 정확히 3줄이고, 각 줄은 "- "로 시작한다.',
  '- "성장 분야"와 "경쟁사 동향" 칸은 사실을 쓴 뒤 마지막에 "해석:"으로 시작하는 문장을 1~2개 쓴다. 해석에는 위 규칙대로 근거와 추정 표현을 넣는다.',
  '- 증감률은 첫해 대비 마지막 해 값이다(예: "2022년 대비 2024년 24% 증가"). "전년 대비"라고 쓰지 않는다.',
  '- "가장 높다/가장 많다/유일하다" 같은 순위 표현은 [자료]의 숫자를 모두 비교해 맞을 때만 쓴다.',
  '- 특허 설명에 초록에 없는 효과(신뢰성 강화, 내구성 향상 등)를 덧붙이지 않는다.',
  '- 형식은 반드시 아래 다섯 칸을 이 순서로 쓴다.',
  ...SECTIONS.map((s) => `## ${s}${s === '핵심 흐름' ? ' (3줄)' : ''}`),
  '- [자료]에 "주의: 연간 30건 미만"이 있으면 "크게 늘었다/급감" 같은 강한 표현을 쓰지 말고, 한계 칸에 건수가 적어 해석에 주의가 필요하다고 쓴다.',
  '- 한계 칸에는 반드시 다음을 포함한다: 분류는 규칙 기반 자동 분류이며 무작위 검증 정확도 약 85%; 건수는 출원일 기준이며 패밀리·후속 출원이 포함됨; 경쟁사는 현재 삼성디스플레이 중심.',
].join('\n');

const scopeKey = ({ level1 = '', level2 = '', level3 = '' }) => ({ level1: level1 ?? '', level2: level2 ?? '', level3: level3 ?? '' });

/** AI로 요약을 만들고 저장한다. 같은 범위·기간은 새 행으로 쌓인다(이전 요약과 비교할 수 있게) */
export async function generateTrendSummary({ level1, level2, level3, from, to }) {
  if (!isAiConfigured()) throw new Error('AI 설정(AI_BASE_URL, AI_MODEL)이 비어 있어요');
  const scope = scopeKey({ level1, level2, level3 });
  const { facts, statText, evidence } = buildSummaryInput({ ...scope, from, to });
  const started = Date.now();
  const content = await chat([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `[자료]\n${facts}\n\n위 자료로 동향 요약을 써 줘.` },
  ], { maxTokens: 6000, purpose: 'trend-summary', timeoutMs: 180_000 }); // 추론형 모델은 생각에도 토큰을 써서 2000이면 잘렸고, 무료 모델은 1분을 넘기기도 한다
  const checks = checkSummary(content, statText, evidence);
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
  };
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO trend_summaries (level1, level2, level3, period_from, period_to, criteria_version, model, content, facts, evidence, checks, elapsed_ms)
    VALUES (@level1, @level2, @level3, @period_from, @period_to, @criteria_version, @model, @content, @facts, @evidence, @checks, @elapsed_ms)
  `).run(row);
  return getSummaryById(lastInsertRowid);
}

const parse = (r) => r && { ...r, evidence: JSON.parse(r.evidence), checks: JSON.parse(r.checks) };

export function getSummaryById(id) {
  return parse(db.prepare('SELECT * FROM trend_summaries WHERE id = ?').get(id));
}

/** 범위·기간의 가장 최근 요약 (분류 기준이 달라도 돌려주되 화면이 표시한다) */
export function latestSummary({ level1, level2, level3, from, to }) {
  const s = scopeKey({ level1, level2, level3 });
  return parse(db.prepare(`
    SELECT * FROM trend_summaries
    WHERE level1 = @level1 AND level2 = @level2 AND level3 = @level3 AND period_from = @from AND period_to = @to
    ORDER BY id DESC LIMIT 1
  `).get({ ...s, from, to }));
}
