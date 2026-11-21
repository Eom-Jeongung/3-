// AI 동향 요약: 한 분류·기간의 건수와 근거 특허를 DB에서 뽑아 AI에게 고정 형식으로 쓰게 하고, 검사 결과와 함께 저장한다
// - 숫자는 DB에서 계산한 값만 AI에게 준다 (비중도 미리 계산). 답은 summaryCheck.js로 검사한다
// - 화면(routes/summaries.js)과 시험 스크립트(scripts/summary-trial.js)가 함께 쓴다
import { db } from './db.js';
import { getSummaryStats, MIN_COUNT, UNPUBLISHED_MONTHS } from './summaryStats.js';
import { chat, isAiConfigured } from './ai.js';
import { CRITERIA_VERSION } from './classification.js';
import { checkSummary } from './summaryCheck.js';
import { burstTerms } from './emerging.js';
import { checkStatistics } from './summaryStatCheck.js';
import { groundInterpretations } from './summaryEvidence.js';

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
  return { facts, statText, evidence, structuredStats, dataWarnings };
}

/** 공개가 끝난 마지막 연도 (그 해 12월 31일 출원까지 공개가 끝났다고 볼 수 있는 해). 요약 기본 기간의 끝 */
export function lastCompleteYear() {
  const { latestOpen } = db.prepare('SELECT MAX(open_date) latestOpen FROM patents').get();
  const cutoff = new Date(latestOpen ?? Date.now());
  cutoff.setUTCMonth(cutoff.getUTCMonth() - UNPUBLISHED_MONTHS);
  return cutoff.getUTCMonth() === 11 && cutoff.getUTCDate() === 31 ? cutoff.getUTCFullYear() : cutoff.getUTCFullYear() - 1;
}

const SYSTEM_PROMPT = [
  '너는 디스플레이 기업의 특허 동향을 정리하는 분석가다. 한국어로 쓴다.',
  '규칙:',
  '- 숫자(건수, %, 연도)는 아래 [자료]에 적힌 값을 그대로만 쓴다. 비중·차이·합계·배율을 새로 계산하지 않는다. 필요한 비중은 [분야별 비중]에 있다.',
  '- 수치가 포함된 문장마다 회사, 정확한 분야명, 연도와 지표(출원 건수·비중·증감률)를 명시한다. 한 문장에는 한 회사와 한 분야만 쓴다.',
  '- 해석·시사점·한계·주목 특허를 제외한 각 줄은 "- 자사 기술분야 2022년 100건"처럼 회사·정확한 분야·연도·건수만 쓴다. 임의의 설명은 추가하지 않는다.',
  '- 특허를 언급할 때는 [근거 후보 특허]의 출원번호를 괄호로 붙인다. 목록에 없는 특허는 언급하지 않는다.',
  '- 특허 하나를 설명할 때는 그 특허의 명칭과 초록에 있는 내용만 쓴다. 다른 특허의 내용을 섞지 않는다. 회사(자사/경쟁사/중국 경쟁사)도 그 특허 줄에 적힌 대로 쓴다.',
  '- 한 문장에서 특허 여러 건을 언급할 때는 각 내용 바로 뒤에 그 특허의 출원번호를 붙인다.',
  '- 해석 줄은 반드시 "- 해석: 회사 분야 연도 통계 | 출원번호 13자리 | 「명칭 또는 전달된 초록에서 그대로 복사한 6자 이상 원문」" 형식으로 작성한다. 특허와 통계의 회사·분야가 같아야 한다. 조건을 충족하지 못하면 "- 해석: 판단 근거 부족"이라고 쓴다.',
  '- 전체 분량은 한 화면(1,000자 안팎)으로 짧게 쓴다. 핵심 메시지는 1줄, 핵심 흐름을 뺀 나머지 칸은 칸마다 2~3줄이다. 보고서처럼 길게 풀어 쓰지 않는다.',
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
  '- 선택한 범위·기간에 분류된 출원이 없으면 근거 부족을 명시하고 성장 분야나 특허 동향을 추정하지 않는다.',
  '- 분야·회사별 어느 연도라도 30건 미만이면 해당 범위의 성장이나 감소 추세를 단정하지 않는다. 30건은 기존 주의 기준이며 통계적 유의성을 뜻하지 않는다.',
  '- "핵심 메시지"는 요약 전체에서 가장 중요한 변화 하나를 한 문장으로 쓴다. 한 회사·한 분야만 쓰고, 첫해와 마지막 해 건수와 증감률은 [자료] 값을 그대로 쓴다. 해석이나 추정 표현은 넣지 않는다.',
  '- "시사점" 칸에는 앞 칸에 쓴 사실을 바탕으로 자사가 이어서 살펴볼 만한 점을 정확히 2줄 쓴다. 각 줄은 "- 확인해 볼 점:"으로 시작하고, 어느 회사·분야의 무엇(늘어난 분야, 경쟁사와 다른 점, 주목 특허)을 더 살펴보면 좋을지만 쓴다.',
  '- 시사점에는 새 숫자를 넣지 않는다. 회사 의도·전략·미래 전망을 단정하거나 "투자해야 한다", "대응해야 한다" 같은 권고는 쓰지 않는다.',
  '- 핵심 흐름은 정확히 3줄이고, 각 줄은 "- "로 시작한다.',
  '- "성장 분야"와 "경쟁사 동향" 칸의 마지막에 지정된 형식의 "해석:" 줄을 정확히 1개 쓴다.',
  '- 증감률은 첫해 대비 마지막 해 값이다(예: "2022년 대비 2024년 24% 증가"). "전년 대비"라고 쓰지 않는다.',
  '- "가장 높다/가장 많이 늘었다" 같은 순위 표현은 [증감률 순위]와 [분야별 비중]에 적힌 순서대로만 쓴다.',
  '- 특허 설명에 초록에 없는 효과(신뢰성 강화, 내구성 향상 등)를 덧붙이지 않는다.',
  '- "경쟁사 동향" 칸은 삼성디스플레이를 먼저 쓰고, 중국 경쟁사는 따로 1~2문장으로 쓴다. [자료]에 "참고: 중국 경쟁사는"이 있으면 중국 경쟁사는 건수 사실만 쓰고 해석하지 않는다.',
  '- 형식은 반드시 아래 틀을 그대로 채운다. 줄 수를 늘리지 않는다. 틀에 없는 줄·문단을 더하지 않는다.',
  '## 핵심 메시지',
  '- (가장 중요한 변화 한 문장: 회사·분야, 첫해→마지막 해 건수와 증감률)',
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
  '## 시사점',
  '- 확인해 볼 점: (한 줄)',
  '- 확인해 볼 점: (한 줄)',
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
  const { facts, statText, evidence, structuredStats, dataWarnings } = buildSummaryInput({ ...scope, from, to });
  // 고른 범위·기간에 분류된 특허가 없으면 AI를 부르지 않는다 (비용을 쓰고 의미 없는 요약이 저장되는 것을 막는다)
  if (structuredStats.values.length === 0) {
    throw Object.assign(new Error('선택한 범위와 기간에 분류된 특허가 없어 요약을 만들 수 없어요'), { status: 422 });
  }
  const started = Date.now();
  const answer = await chat([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `[자료]\n${facts}\n\n위 자료로 동향 요약을 써 줘.` },
  ], { maxTokens: 12000, purpose: 'trend-summary', timeoutMs: 180_000 }); // 추론형 모델은 생각에도 토큰을 써서 2000이면 잘렸고 6000에서도 가끔 잘려 8000. Haiku 5.5는 생각을 low로 줄여도 6,600토큰을 써서 8000이면 답 끝이 잘려 12000 (2026-11-21)
  const grounded = groundInterpretations(answer, evidence, structuredStats);
  let content = grounded.content;
  const checks = checkSummary(content, statText, evidence);
  Object.assign(checks, checkStatistics(answer, structuredStats));
  checks.evidenceWarnings = [...grounded.warnings, ...(evidence.length < 4 ? [`근거 후보 특허 ${evidence.length}건: 근거가 부족할 수 있습니다.`] : [])];
  checks.foreignText = grounded.foreignText;
  checks.dataWarnings = dataWarnings;
  const limitations = [
    ...(dataWarnings.some((warning) => warning.includes(`기존 주의 기준 ${MIN_COUNT}건 미만`)) ? ['- 일부 회사·분야·연도의 출원 건수가 30건 미만이므로 동향 해석에 주의가 필요합니다. 30건은 기존 주의 기준이며 통계적 유의성을 뜻하지 않습니다.'] : []),
    ...(evidence.length < 4 ? [`- 근거 후보 특허가 ${evidence.length}건으로 부족할 수 있어 기술 동향 판단에 한계가 있습니다.`] : []),
    '- 출원 건수는 출원번호 기준이며, 급증 용어는 유사 초록 중복 제거 후 문서 수를 기준으로 합니다.',
  ];
  if (/^##\s*한계[^\n]*$/m.test(content)) {
    content = content.replace(/^##\s*한계[^\n]*$/m, (header) => `${header}\n${limitations.join('\n')}`);
  } else {
    content += `\n## 한계\n${limitations.join('\n')}`;
  }
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
