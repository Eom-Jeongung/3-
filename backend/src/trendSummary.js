// AI 동향 요약: 한 분류·기간의 건수와 근거 특허를 DB에서 뽑아 AI에게 고정 형식으로 쓰게 하고, 검사 결과와 함께 저장한다
// - 숫자는 DB에서 계산한 값만 AI에게 준다 (비중도 미리 계산). 답은 summaryCheck.js로 검사한다
// - 화면(routes/summaries.js)과 시험 스크립트(scripts/summary-trial.js)가 함께 쓴다
import { db } from './db.js';
import { getSeries } from './trendData.js';
import { chat, isAiConfigured } from './ai.js';
import { CRITERIA_VERSION } from './classification.js';
import { checkSummary, SECTIONS } from './summaryCheck.js';
import { burstTerms } from './emerging.js';

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

  // 급증 용어: 마지막 해 출원을 그 전 해들과 비교해 갑자기 많이 나온 용어 (emerging.js, AI 없이 계산)
  // 해석의 근거로 쓰고, 그 용어가 나온 특허를 "주목 특허" 후보로 먼저 뽑는다
  const bursts = {};
  for (const company of Object.keys(COMPANY)) {
    const { rows } = burstTerms({
      applicant: company, ...scope, dateField: 'application_date',
      pastFrom: `${from}-01-01`, recentFrom: `${to}-01-01`, ref: `${to}-12-31`,
    });
    bursts[company] = rows.filter((r) => !isWeakTerm(r.term)).slice(0, BURST_LIMIT)
      .map((r) => ({ term: cleanTerm(r.term), recent: r.recentDocs, past: r.pastDocs, examples: r.examples.map((x) => x.applicationNumber) }));
  }

  // 근거 특허: ① 급증 용어가 나온 특허(회사별 상위 3개 용어에서 1건씩) ② 증감이 큰 분야(회사별 2개)의 마지막 해 출원 1건씩
  // 매번 같은 특허(결과를 비교할 수 있게), 날짜에 몰리지 않게
  const groupCol = data.groupLevel ?? 'level1';
  const scopeWhere = LEVELS.filter((k) => scope[k]).map((k) => `AND c.${k} = @${k}`).join(' ');
  const detail = db.prepare(`
    SELECT p.id, p.application_number number, p.applicant_type company, p.application_date date, p.legal_status status,
      c.${groupCol} field, p.title, p.abstract
    FROM patents p JOIN classification c ON c.application_number = p.application_number AND c.is_primary = 1 AND +c.criteria_version = @version
    WHERE p.application_number = @number
  `);
  const pick = db.prepare(`
    SELECT p.application_number number
    FROM patents p JOIN classification c ON c.application_number = p.application_number
    WHERE c.is_primary = 1 AND +c.criteria_version = @version ${scopeWhere} AND c.${groupCol} = @group
      AND p.applicant_type = @company AND substr(p.application_date, 1, 4) = @year
    ORDER BY (CAST(substr(p.application_number, -6) AS INTEGER) * 7919) % 1000 LIMIT 3
  `);
  const chosen = new Map(); // 출원번호 → 선정 이유
  for (const company of Object.keys(COMPANY)) {
    for (const b of bursts[company].slice(0, 3)) {
      const n = b.examples.find((x) => !chosen.has(x));
      if (n) chosen.set(n, `급증 용어 "${b.term}"`);
    }
  }
  const moveSize = (t) => (t.change !== null ? Math.abs(t.change) * 1000 : 0) + Math.abs(t.counts.at(-1) - t.counts[0]);
  const movers = Object.keys(COMPANY).flatMap((company) => table
    .filter((t) => t.company === company && t.counts.at(-1) > 0 && !['미분류', '그 외'].includes(t.group))
    .sort((a, b) => moveSize(b) - moveSize(a))
    .slice(0, 2));
  for (const t of movers) {
    const n = pick.all({ version: CRITERIA_VERSION, ...scope, group: t.group, company: t.company, year: String(to) })
      .map((r) => r.number).find((x) => !chosen.has(x));
    if (n) chosen.set(n, `증감이 큰 분야 "${t.group}"`);
  }
  const evidence = [...chosen].slice(0, EVIDENCE_LIMIT)
    .map(([number, reason]) => ({ e: detail.get({ number, version: CRITERIA_VERSION }), reason }))
    .filter(({ e }) => e)
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
      fullText: `${e.title} ${e.abstract ?? ''}`, // 검사용: 초록 전체
      abstract: (e.abstract ?? '').replace(/\s+/g, ' ').slice(0, 300),
    }));

  // 증감률 순위: "가장 많이 늘었다" 같은 말을 AI가 직접 비교하지 않게 미리 정렬해 준다
  const ranks = Object.keys(COMPANY).map((company) => {
    const list = table.filter((t) => t.company === company && t.change !== null).sort((a, b) => b.change - a.change);
    return list.length
      ? `${COMPANY[company]}: ${list.map((t) => `${t.group} ${t.change}%`).join(' > ')}`
      : `${COMPANY[company]}: (증감률을 계산한 분야 없음)`;
  });

  const years = keep.map(([p]) => p.key);
  // 중국 경쟁사는 한국 출원이 원래 적어 거의 늘 30건 미만이므로, 자사·삼성 기준 주의와 따로 알린다
  const smallData = totals.filter((t) => t.company !== 'china').some((t) => t.counts.some((n) => n < MIN_COUNT));
  const chinaSmall = totals.some((t) => t.company === 'china' && t.counts.some((n) => n < MIN_COUNT));
  const changeText = (c) => (c === null ? '계산 안 함(30건 미만)' : `${c}%`);
  const statText = [
    `분류: ${scopeLabel(scope)} (분류 기준 ${CRITERIA_VERSION}), 기간: ${from}~${to}년 출원`,
    `연도: ${years.join(', ')}`,
    incomplete.length ? `아직 공개가 덜 된 연도(건수가 적게 보임): ${incomplete.join(', ')}` : '',
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
    ...shares.filter((t) => t.share !== null).map((t) => `${COMPANY[t.company]} - ${t.group}: ${t.share}%`),
    '',
    '[증감률 순위 (높은 순)]',
    ...ranks,
    '',
    `[급증 용어 (${to}년 출원을 ${from}~${to - 1}년과 비교, 명칭·초록에서 자동 추출, 괄호는 ${to}년 건수 / 이전 건수)]`,
    ...Object.keys(COMPANY).map((c) => `${COMPANY[c]}: ${bursts[c].length ? bursts[c].map((b) => `${b.term}(${b.recent}/${b.past})`).join(', ') : '(뚜렷한 급증 용어 없음)'}`),
  ].join('\n');
  const facts = [
    statText,
    '',
    '[근거 후보 특허] (출원번호 | 회사 | 출원일 | 상태 | 분야 | 선정 이유 | 명칭 | 초록 앞부분)',
    ...evidence.map((e) => `${e.number} | ${e.company} | ${e.date} | ${e.status} | ${e.field} | ${e.reason} | ${e.title} | ${e.abstract}`),
  ].join('\n');
  return { facts, statText, evidence };
}

const UNPUBLISHED_MONTHS = 18; // trendData.js와 같은 기준: 출원 후 보통 18개월 뒤 공개

/** 공개가 끝난 마지막 연도 (그 해 12월 31일 출원까지 공개가 끝났다고 볼 수 있는 해). 요약 기본 기간의 끝 */
export function lastCompleteYear() {
  const { d } = db.prepare('SELECT MAX(open_date) d FROM patents').get();
  const cutoff = new Date(d ?? Date.now());
  cutoff.setUTCMonth(cutoff.getUTCMonth() - UNPUBLISHED_MONTHS);
  return cutoff.getUTCMonth() === 11 && cutoff.getUTCDate() === 31 ? cutoff.getUTCFullYear() : cutoff.getUTCFullYear() - 1;
}

const SYSTEM_PROMPT = [
  '너는 디스플레이 기업의 특허 동향을 정리하는 분석가다. 한국어로 쓴다.',
  '규칙:',
  '- 숫자(건수, %, 연도)는 아래 [자료]에 적힌 값을 그대로만 쓴다. 비중·차이·합계·배율을 새로 계산하지 않는다. 필요한 비중은 [분야별 비중]에 있다.',
  '- 특허를 언급할 때는 [근거 후보 특허]의 출원번호를 괄호로 붙인다. 목록에 없는 특허는 언급하지 않는다.',
  '- 특허 하나를 설명할 때는 그 특허의 명칭과 초록에 있는 내용만 쓴다. 다른 특허의 내용을 섞지 않는다. 회사(자사/경쟁사/중국 경쟁사)도 그 특허 줄에 적힌 대로 쓴다.',
  '- 한 문장에서 특허 여러 건을 언급할 때는 각 내용 바로 뒤에 그 특허의 출원번호를 붙인다.',
  '- 해석은 써도 된다. 단, 해석마다 근거(자료의 숫자, [급증 용어], 근거 특허 출원번호 중 둘 이상)를 함께 쓰고, "~로 보인다", "~가능성이 있다"처럼 추정임을 밝힌다.',
  '  예: "급증 용어 \'광학 부재\'(6/0)가 새로 나타나고 근거 특허(출원번호)도 광학 부재를 다뤄, 패널 위 광학 구조에 관심이 커진 것으로 보인다."',
  '- 전체 분량은 한 화면(900자 안팎)으로 짧게 쓴다. 핵심 흐름을 뺀 칸은 칸마다 2~3줄이다. 보고서처럼 길게 풀어 쓰지 않는다.',
  '- 연도별 건수를 차례로 나열하지 않는다(그래프에 있다). 첫해와 마지막 해 두 값과 증감률만 쓴다. 예: "2022년 120건 → 2024년 180건(50% 증가)".',
  '- 해석은 "어떤 기술 주제에 관심이 커졌다" 수준까지만 쓴다. "성숙 단계", "전략", "주력", "집중 투자", "경쟁 심화", "본격화", "선점", "핵심 분야", "핵심 연구", "지속적으로 투자", "집중하는"처럼 회사 의도나 산업 단계를 단정하는 말은 쓰지 않는다.',
  '- 건수가 줄어든 분야의 원인은 추정하지 않는다. 줄었다는 사실만 쓴다. "중단", "동력이 약해졌다"처럼 줄어든 것을 해석하는 말도 쓰지 않는다.',
  '- 마지막 해 건수가 10건 미만인 분야는 해석하지 않는다. 몇 건 차이는 우연일 수 있다.',
  '- 해석 문장은 "해석:" 줄에만 쓴다. 사실을 쓰는 문장에는 "~로 보인다"를 쓰지 않는다. 같은 해석을 두 번 쓰지 않는다.',
  '- 각 칸의 분야별 건수를 모두 나열하지 않는다. 증감이 크거나 비중이 큰 분야 2~3개만 쓴다.',
  '- [급증 용어]는 자동 추출이라 뜻이 모호한 말이 섞여 있을 수 있다. 뜻이 분명한 용어만 골라 쓴다.',
  '- "주목 특허"에는 [근거 후보 특허] 중 4~5건을 골라, 각 특허가 무엇을 다루는지 짧은 한 줄로 쓰고 끝에 선정 이유를 괄호로 붙인다. 선정 이유는 그 특허 줄의 "선정 이유" 칸 문구를 그대로 복사한다. 다른 특허의 선정 이유를 가져오지 않는다.',
  '- "성장 분야" 칸에는 첫해보다 마지막 해 건수가 늘어난 분야만 최대 3개 쓴다. 줄어든 분야는 이 칸에 쓰지 않는다.',
  '- "경쟁사 동향" 칸은 자사와 다른 점(경쟁사가 자사와 다르게 늘었거나 비중이 큰 분야) 위주로 쓴다.',
  '- 자료에 없는 외부 지식(시장 상황, 제품 출시, 회사 전략 발표 등)으로 원인을 설명하지 않는다. 미래 전망은 쓰지 않는다.',
  '- 핵심 흐름은 정확히 3줄이고, 각 줄은 "- "로 시작한다.',
  '- "성장 분야"와 "경쟁사 동향" 칸은 사실을 쓴 뒤 마지막에 "해석:"으로 시작하는 문장을 칸마다 정확히 1개 쓴다. 해석에는 위 규칙대로 근거와 추정 표현을 넣는다. 사실 문장에서 이미 한 말을 해석에서 되풀이하지 않는다.',
  '- 증감률은 첫해 대비 마지막 해 값이다(예: "2022년 대비 2024년 24% 증가"). "전년 대비"라고 쓰지 않는다.',
  '- "가장 높다/가장 많이 늘었다" 같은 순위 표현은 [증감률 순위]와 [분야별 비중]에 적힌 순서대로만 쓴다.',
  '- 특허 설명에 초록에 없는 효과(신뢰성 강화, 내구성 향상 등)를 덧붙이지 않는다.',
  '- "경쟁사 동향" 칸은 삼성디스플레이를 먼저 쓰고, 중국 경쟁사는 따로 1~2문장으로 쓴다. [자료]에 "참고: 중국 경쟁사는"이 있으면 중국 경쟁사는 건수 사실만 쓰고 해석하지 않는다.',
  '- 형식은 반드시 아래 틀을 그대로 채운다. 줄 수를 늘리지 않는다. 틀에 없는 줄·문단을 더하지 않는다.',
  '## 핵심 흐름 (3줄)',
  '- (전체 흐름 한 줄)',
  '- (자사 한 줄)',
  '- (경쟁사 한 줄)',
  '## 성장 분야',
  '- 자사: (늘어난 분야 최대 2개, 첫해→마지막 해 건수와 증감률, 한 줄)',
  '- 삼성: (늘어난 분야 최대 2개, 한 줄)',
  '- 해석: (근거 둘 이상 + 추정 표현, 한 문장)',
  '## 경쟁사 동향',
  '- 삼성: (자사와 다른 점, 한 줄)',
  '- 중국 4사: (건수 사실 한 줄)',
  '- 해석: (한 문장)',
  '## 주목 특허',
  '- 출원번호 (회사): 무엇을 다루는지 짧게 (선정 이유)  ← 이런 줄을 4~5개만',
  '## 한계',
  '- (필수 항목을 한두 줄로)',
  '- [자료]에 "주의: 연간 30건 미만"이 있으면 "크게 늘었다/급감" 같은 강한 표현을 쓰지 말고, 한계 칸에 건수가 적어 해석에 주의가 필요하다고 쓴다.',
  '- 한계 칸에는 반드시 다음을 포함한다: 분류는 규칙 기반 자동 분류이며 무작위 검증 정확도 약 85%; 건수는 출원일 기준이며 패밀리·후속 출원이 포함됨; 경쟁사는 삼성디스플레이, 중국 경쟁사는 BOE·CSOT·Tianma·Visionox의 한국 출원만 포함(중국 회사는 한국 출원이 적음).',
].join('\n');

const scopeKey = ({ level1 = '', level2 = '', level3 = '' }) => ({ level1: level1 ?? '', level2: level2 ?? '', level3: level3 ?? '' });

/** AI로 요약을 만들고 저장한다. 같은 범위·기간은 새 행으로 쌓인다(이전 요약과 비교할 수 있게) */
export async function generateTrendSummary({ level1, level2, level3, from, to }, { source = 'manual' } = {}) {
  if (!isAiConfigured()) throw new Error('AI 설정(AI_BASE_URL, AI_MODEL)이 비어 있어요');
  const scope = scopeKey({ level1, level2, level3 });
  const { facts, statText, evidence } = buildSummaryInput({ ...scope, from, to });
  const started = Date.now();
  const content = await chat([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `[자료]\n${facts}\n\n위 자료로 동향 요약을 써 줘.` },
  ], { maxTokens: 8000, purpose: 'trend-summary', timeoutMs: 180_000 }); // 추론형 모델은 생각에도 토큰을 써서 2000이면 잘렸고 6000에서도 가끔 잘려 8000, 무료 모델은 1분을 넘기기도 한다
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
    source,
  };
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO trend_summaries (level1, level2, level3, period_from, period_to, criteria_version, model, content, facts, evidence, checks, elapsed_ms, source)
    VALUES (@level1, @level2, @level3, @period_from, @period_to, @criteria_version, @model, @content, @facts, @evidence, @checks, @elapsed_ms, @source)
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
