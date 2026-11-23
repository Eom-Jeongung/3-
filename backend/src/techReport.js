// AI 기술 분석 보고서: 건수 요약(trendSummary.js)을 복사해 '기술 분석'용으로 바꾼 모듈. 건수 요약 코드는 건드리지 않는다
// - 건수 요약은 "몇 건 늘었나", 기술 분석은 "어떤 기술이 무엇을 위해 어디로 가나"를 쓴다 (팀장님 보고서 기초 형식, 2026-11-23)
// - 숫자(KPI·차트·차트 제목)는 DB에서 코드로 계산한다. AI는 문장만 쓴다
// - 프롬프트는 목적별로 나눠 부른다 (멘토링): ① 특허 분석(6건씩 병렬) → ② 시기별 흐름·③ 경쟁사 비교(병렬) → ④ 핵심 결론
// - ①은 AI_MODEL(하이쿠), ②~④는 AI_INSIGHT_MODEL이 있으면 그 모델(소넷 권장), 없으면 AI_MODEL
// - 근거 특허는 시기·회사마다 급증 용어가 나온 특허와 늘어난 분야의 특허를 고른다 (늘어나는 기술을 대표하게)
// - 초록이 짧은 근거 특허는 KIPRIS에서 청구항을 받아 함께 넘긴다 (보고서 1개당 최대 12회)
// - 저장: tech_reports 표 (건수 요약의 trend_summaries와 따로)
import { db } from './db.js';
import { getSummaryStats, MIN_COUNT } from './summaryStats.js';
import { chat, isAiConfigured } from './ai.js';
import { CRITERIA_VERSION } from './classification.js';
import { fetchClaims } from './kipris.js';
import { burstTerms } from './emerging.js';
import { scopeLabel } from './trendSummary.js';

export const COMPANY = { own: '자사(LG디스플레이)', competitor: '삼성디스플레이', china: '중국 4사(BOE·CSOT·Tianma·Visionox)' };
const SHORT = { own: '자사', competitor: '삼성', china: '중국 4사' };
const COMPANIES = Object.keys(COMPANY);
// 시기마다 회사별 근거 특허 수. 3·3·2건으로는 표본이 작아 결론이 과하게 일반화돼 5·5·3건으로 늘림 (2026-11-23 검증)
const PER_COMPANY = { own: 5, competitor: 5, china: 3 };
const MIN_ABSTRACT = 40; // 이보다 짧은 초록은 근거로 쓰지 않는다
const SHORT_ABSTRACT = 200; // 이보다 짧으면 청구항으로 보강한다
const CLAIM_LIMIT = 12; // 보고서 1개당 KIPRIS 청구항 호출 수
const CLAIM_CHARS = 1200;
const BATCH = 6; // 특허 분석 한 번에 넘기는 특허 수
const LEVELS = ['level1', 'level2', 'level3'];
// 회사 의도·산업 단계·미래를 단정하는 말 (자료로 확인할 수 없다)
export const ASSERTIVE_WORDS = ['전략', '선점', '본격화', '시장', '전망', '주력', '투자', '경쟁 심화', '성숙', '우위', '독점'];
// 초록에 없는 효과를 덧붙였는지 보는 말 (patentSummary.js와 같은 목록, 건수 요약 코드와 섞지 않게 복사)
const EFFECT_WORDS = ['신뢰성', '내구성', '수명', '광효율', '발광 효율', '고해상도', '정밀', '화질', '시인성', '투과율', '소비전력', '생산성', '수율', '원가', '박형화', '휘도', '저전력'];
// 급증 용어 중 뜻이 약한 말 (trendSummary.js와 같은 목록)
const WEAK_TERMS = new Set(['주변', '주변부', '구조물', '화소', '서브화소', '부화소', '구조', '영역', '패턴', '층', '절연층', '전극', '라인', '배선', '소자', '부재', '데이터', '신호', '전압', '회로', '구동부', '패널']);
const cleanTerm = (t) => t.replace(/들$/, '').trim();
const isWeakTerm = (t) => {
  const k = cleanTerm(t).replace(/\s+/g, '');
  return k.length < 3 || /^제\d/.test(k) || WEAK_TERMS.has(k) || /(하게|따르면|의하면|위하여|관한)$/.test(k);
};
const INFERRED = '(추정)'; // 원문에 없는 목적을 일반 기술 지식으로 추정했을 때 붙이는 표시
// 시기 제목·단계 이름에 붙는 목적·효과 말. 그 시기 근거 특허 원문에 없으면 '주의' (예: 근거에 없는 "신뢰성 확보")
const TITLE_EFFECT_WORDS = [...EFFECT_WORDS, '신뢰', '성능', '효율', '안정화', '안정성', '색 순도', '색순도'];

/** 제목·단계 이름에 있는 목적·효과 말 중 근거 원문에 없는 것 */
export function unsupportedEffects(text, source) {
  const plain = String(source ?? '').replace(/\s+/g, '');
  const hits = [...new Set(TITLE_EFFECT_WORDS.filter((w) => String(text).includes(w) && !plain.includes(w.replace(/\s+/g, ''))))];
  return hits.filter((w) => !hits.some((o) => o !== w && o.includes(w))); // "신뢰성"이 걸리면 "신뢰"는 따로 적지 않는다
}

/** 기간 나누기: 4년 이하면 1년씩, 더 길면 3묶음 (남는 해는 앞 묶음부터 하나씩) */
export function splitPeriods(from, to) {
  const n = to - from + 1;
  if (n <= 4) return Array.from({ length: n }, (_, i) => ({ from: from + i, to: from + i, label: `${from + i}년` }));
  const base = Math.floor(n / 3);
  const extra = n % 3;
  const out = [];
  let start = from;
  for (let i = 0; i < 3; i++) {
    const len = base + (i < extra ? 1 : 0);
    const end = start + len - 1;
    out.push({ from: start, to: end, label: start === end ? `${start}년` : `${start}~${end}년` });
    start = end + 1;
  }
  return out;
}

/** AI 답에서 JSON을 꺼낸다. 코드 블록 표시나 앞뒤 설명이 붙어도 된다. 실패하면 오류 */
export function parseJsonAnswer(text) {
  const stripped = String(text).replace(/```(?:json)?/gi, '').trim();
  const starts = [stripped.indexOf('{'), stripped.indexOf('[')].filter((i) => i >= 0);
  if (!starts.length) throw new Error('AI 답에 JSON이 없어요');
  const start = Math.min(...starts);
  const end = Math.max(stripped.lastIndexOf('}'), stripped.lastIndexOf(']'));
  if (end <= start) throw new Error('AI 답의 JSON이 닫히지 않았어요');
  return JSON.parse(stripped.slice(start, end + 1));
}

// 문장에서 숫자만 뽑는다. [3] 같은 근거 번호와 회사 이름 "중국 4사"는 뺀다
const numbersIn = (text) => (String(text ?? '').replace(/\[\d+(?:\s*,\s*\d+)*\]/g, '').replace(/중국\s*4\s*사/g, '').match(/\d+(?:\.\d+)?/g) ?? []);
const textOf = (v) => (Array.isArray(v) ? v.join(' ') : String(v ?? ''));

/**
 * 문장 하나를 검사해 이유 목록을 돌려준다 (없으면 빈 배열)
 * @param {{ allowedNumbers: Set<string>, refs?: number[], allowedRefs?: Set<number>, refScope?: string }} rule
 */
export function checkStatement(text, { allowedNumbers, refs = [], allowedRefs = null, refScope = '' }) {
  const reasons = [];
  const strange = [...new Set(numbersIn(text).filter((n) => !allowedNumbers.has(n)))];
  if (strange.length) reasons.push(`자료에 없는 숫자: ${strange.join(', ')}`);
  const strong = ASSERTIVE_WORDS.filter((w) => String(text).includes(w));
  if (strong.length) reasons.push(`근거보다 강한 표현: ${strong.join(', ')}`);
  if (allowedRefs) {
    const bad = refs.filter((r) => !allowedRefs.has(r));
    if (bad.length) reasons.push(`${refScope} 근거가 아닌 특허 번호: ${bad.map((r) => `[${r}]`).join(', ')}`);
  }
  return reasons;
}

/**
 * 원문에 없는 용어 찾기 (키워드·집중 분야가 근거에 실제로 나오는지). 띄어쓰기·대소문자는 무시한다
 * 예: 근거 특허 어디에도 없는 "2-Stack Tandem"을 키워드로 쓰면 걸린다
 */
export function missingTerms(terms, source) {
  const norm = (s) => String(s ?? '').replace(/\s+/g, '').toLowerCase();
  const plain = norm(source);
  // 통째로 있거나, 띄어 쓴 낱말이 모두 원문에 있으면 통과한다
  // ("개구 직경" ← 원문 "개구의 직경", "곡률 모서리" ← 원문 "곡률을 갖는 모서리"처럼 조사를 줄인 말은 오류가 아니다)
  const found = (t) => plain.includes(norm(t)) || t.trim().split(/\s+/).every((w) => plain.includes(norm(w)));
  return (terms ?? []).map(String).filter((t) => t.trim() && !found(t));
}

/**
 * 특허 분석 한 건 검사: 원문에 없는 숫자, 원문에 없는 효과 말
 * 목적(purpose)은 "(추정)"이 붙어 있으면 일반 지식으로 추정한 문장이라 효과 말 검사에서 뺀다 (화면에 추정으로 표시된다)
 */
export function checkPatentAnalysis(item, source) {
  const purpose = String(item.purpose ?? '');
  const inferred = purpose.includes(INFERRED);
  // 기술 주제(theme)는 "봉지 박형화"처럼 분류 이름이라 효과 말 검사에서 뺀다
  const written = [item.topic, item.problem, item.baseline, item.improvement, textOf(item.keywords), inferred ? '' : purpose].join(' ');
  const plain = source.replace(/\s+/g, '');
  const reasons = [];
  const strange = [...new Set(numbersIn(`${written} ${purpose}`).filter((n) => !source.includes(n)))];
  if (strange.length) reasons.push(`원문에 없는 숫자: ${strange.join(', ')}`);
  const effects = EFFECT_WORDS.filter((w) => written.includes(w) && !plain.includes(w.replace(/\s+/g, '')));
  if (effects.length) reasons.push(`원문에 없는 효과: ${effects.join(', ')}`);
  const strangeKw = missingTerms(item.keywords, source);
  if (strangeKw.length) reasons.push(`원문에 없는 키워드: ${strangeKw.join(', ')}`);
  return reasons;
}

const scopeKey = ({ level1 = '', level2 = '', level3 = '' }) => ({ level1: level1 ?? '', level2: level2 ?? '', level3: level3 ?? '' });
const hashOrder = '(CAST(substr(p.application_number, -6) AS INTEGER) * 7919) % 1000, p.application_number';
const scopeWhereOf = (scope) => LEVELS.filter((k) => scope[k]).map((k) => `AND c.${k} = @${k}`).join(' ');

/** 시기·회사·3차 분야별 건수 (기타 여부 포함) */
function fieldCounts(scope, from, to) {
  return db.prepare(`
    SELECT p.applicant_type company, CAST(substr(p.application_date, 1, 4) AS INTEGER) year, COALESCE(c.level3, '미분류') field,
      (c.level3 IS NULL OR c.level3 = '기타' OR COALESCE(c.level3_basis, '') = '기타') other, COUNT(*) n
    FROM patents p JOIN classification c ON c.application_number = p.application_number
    WHERE c.is_primary = 1 AND c.criteria_version = @version ${scopeWhereOf(scope)}
      AND p.application_date BETWEEN @from AND @end AND p.applicant_type IN ('own', 'competitor', 'china')
    GROUP BY 1, 2, 3, 4
  `).all({ ...scope, version: CRITERIA_VERSION, from: `${from}-01-01`, end: `${to}-12-31` });
}

const sumBy = (rows, key) => rows.reduce((m, r) => ({ ...m, [r[key]]: (m[r[key]] ?? 0) + r.n }), {});

/**
 * 근거 특허 고르기 (시기×회사마다)
 * ① 그 시기에 급증한 용어가 나온 특허 (그 시기를 앞 3년과 비교) → 새로 늘어나는 기술
 * ② 모자라면 앞 시기보다 많이 늘어난 3차 분야, 그다음 출원이 많은 분야에서 한 건씩
 * 같은 특허가 매번 뽑히도록 정렬한다. 기타·미분류·초록 40자 미만은 뺀다
 */
function selectEvidence(scope, periods, counts) {
  const sw = scopeWhereOf(scope);
  const check = db.prepare(`
    SELECT p.id, p.application_number number, p.applicant_type company, p.application_date date, c.level3 field, p.title, p.abstract
    FROM patents p JOIN classification c ON c.application_number = p.application_number AND c.is_primary = 1 AND +c.criteria_version = @version
    WHERE p.application_number = @number AND p.applicant_type = @company AND c.level3 IS NOT NULL AND c.level3 <> '기타'
      AND COALESCE(c.level3_basis, '') <> '기타' ${sw}
      AND p.application_date BETWEEN @from AND @end AND length(p.abstract) >= ${MIN_ABSTRACT}
  `);
  const pickInField = db.prepare(`
    SELECT p.id, p.application_number number, p.applicant_type company, p.application_date date, c.level3 field, p.title, p.abstract
    FROM patents p JOIN classification c ON c.application_number = p.application_number AND c.is_primary = 1 AND +c.criteria_version = @version
    WHERE p.applicant_type = @company AND c.level3 = @field AND COALESCE(c.level3_basis, '') <> '기타' ${sw}
      AND p.application_date BETWEEN @from AND @end AND length(p.abstract) >= ${MIN_ABSTRACT}
    ORDER BY ${hashOrder} LIMIT 5
  `);
  const chosen = new Set();
  const out = [];
  periods.forEach((period, pi) => {
    const range = { version: CRITERIA_VERSION, from: `${period.from}-01-01`, end: `${period.to}-12-31` };
    for (const company of COMPANIES) {
      const picked = [];
      const usedFields = new Set();
      const take = (row, reason) => {
        if (!row || chosen.has(row.number) || picked.length >= PER_COMPANY[company]) return false;
        chosen.add(row.number);
        usedFields.add(row.field);
        picked.push({ ...row, reason });
        return true;
      };
      // ① 급증 용어
      let bursts = [];
      try {
        bursts = burstTerms({
          applicant: company, ...scope, dateField: 'application_date',
          pastFrom: `${period.from - 3}-01-01`, recentFrom: `${period.from}-01-01`, ref: `${period.to}-12-31`,
        }).rows.filter((r) => !isWeakTerm(r.term));
      } catch { /* 급증 용어를 못 구하면 분야 기준으로만 고른다 */ }
      for (const b of bursts.slice(0, 6)) {
        for (const ex of b.examples ?? []) {
          const row = check.get({ ...scope, ...range, company, number: ex.applicationNumber });
          // 한 분야에 몰리지 않게, 이미 고른 분야는 건너뛴다
          if (row && !usedFields.has(row.field) && take(row, `급증 용어 "${cleanTerm(b.term)}"`)) break;
        }
      }
      // ② 늘어난 분야 → 많은 분야
      const now = sumBy(counts.filter((r) => r.company === company && !r.other && r.year >= period.from && r.year <= period.to), 'field');
      const prevPeriod = periods[pi - 1];
      const before = prevPeriod ? sumBy(counts.filter((r) => r.company === company && !r.other && r.year >= prevPeriod.from && r.year <= prevPeriod.to), 'field') : {};
      const fields = Object.entries(now)
        .map(([field, n]) => ({ field, n, grow: n - (before[field] ?? 0) }))
        .sort((a, b) => (prevPeriod ? b.grow - a.grow : 0) || b.n - a.n || a.field.localeCompare(b.field));
      const fieldReason = (f) => (prevPeriod && f.grow > 0 ? `늘어난 분야 "${f.field}"` : `출원이 많은 분야 "${f.field}"`);
      for (const f of fields) {
        if (picked.length >= PER_COMPANY[company]) break;
        if (usedFields.has(f.field)) continue;
        const row = pickInField.all({ ...scope, ...range, company, field: f.field }).find((r) => !chosen.has(r.number));
        take(row, fieldReason(f));
      }
      // ③ 분야 수가 적어(예: 소자는 3차가 4~5개) 아직 모자라면, 같은 분야에서 한 건씩 더 (늘어난·많은 분야 순으로 돌아가며)
      for (let round = 0; round < 3 && picked.length < PER_COMPANY[company]; round++) {
        for (const f of fields) {
          if (picked.length >= PER_COMPANY[company]) break;
          const row = pickInField.all({ ...scope, ...range, company, field: f.field }).find((r) => !chosen.has(r.number));
          take(row, fieldReason(f));
        }
      }
      out.push(...picked.map((r) => ({ ...r, period: pi, abstract: (r.abstract ?? '').replace(/\s+/g, ' ').trim() })));
    }
  });
  return out.map((e, i) => ({ ...e, no: i + 1 }));
}

const storedClaim = db.prepare(`
  SELECT claim FROM patent_claims WHERE application_number = ? AND claim NOT GLOB '*[0-9]. 삭제*' ORDER BY seq LIMIT 1
`);
const hasClaims = db.prepare('SELECT 1 FROM patent_claims WHERE application_number = ? LIMIT 1');

/** 초록이 짧은 근거 특허는 청구항으로 보강한다. 받은 청구항은 저장한다 (routes/patents.js와 같은 방식) */
async function enrichClaims(evidence) {
  const info = { fetched: 0, failed: [], skipped: null };
  const need = evidence.filter((e) => e.abstract.length < SHORT_ABSTRACT && !hasClaims.get(e.number));
  if (need.length && !process.env.KIPRIS_API_KEY) info.skipped = 'KIPRIS_API_KEY가 없어 청구항 보강을 건너뜀';
  else {
    const insert = db.prepare('INSERT OR REPLACE INTO patent_claims (application_number, seq, claim) VALUES (?, ?, ?)');
    for (const e of need.slice(0, CLAIM_LIMIT)) {
      try {
        const claims = await fetchClaims(e.number);
        db.transaction(() => claims.forEach((c, i) => insert.run(e.number, i + 1, c)))();
        info.fetched += 1;
      } catch (err) {
        info.failed.push(`${e.number}: ${err.message}`);
      }
    }
    if (need.length > CLAIM_LIMIT) info.skipped = `청구항이 필요한 특허 ${need.length}건 중 ${CLAIM_LIMIT}건만 받음 (보고서당 호출 한도)`;
  }
  for (const e of evidence) {
    const claim = e.abstract.length < SHORT_ABSTRACT ? storedClaim.get(e.number)?.claim?.replace(/\s+/g, ' ').trim().slice(0, CLAIM_CHARS) : null;
    e.claim = claim || null;
  }
  return info;
}

const insightModel = () => (process.env.AI_INSIGHT_MODEL ?? '').trim() || undefined;

/** JSON으로 답을 받는다. 읽지 못하면 한 번 더 부른다 */
async function chatJson(system, user, opts) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    const answer = await chat([{ role: 'system', content: system }, { role: 'user', content: user }], { maxTokens: 8000, timeoutMs: 180_000, ...opts });
    try {
      return parseJsonAnswer(answer);
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`AI 답을 읽지 못했어요 (${lastError.message})`);
}

const RULES_COMMON = [
  '- 숫자는 [자료]에 적힌 값만 그대로 쓴다. 비율·차이·합계를 새로 계산하지 않는다.',
  `- 회사 의도나 산업 단계를 단정하는 말(${ASSERTIVE_WORDS.join(', ')})과 미래 전망·권고는 쓰지 않는다.`,
  '- 문장은 짧고 쉽게, 한국어로만 쓴다.',
  '- 답은 JSON만 쓴다. 설명이나 코드 블록 표시를 붙이지 않는다.',
];

// ① 특허 분석: 부품 이름을 나열하지 않고 "어떤 기술 주제가, 무엇을 위해, 무엇을 바꿨나"를 쓴다
const PATENT_PROMPT = [
  '너는 디스플레이 특허를 기술 관점에서 분석하는 연구원이다.',
  '규칙:',
  '- 특허마다 [명칭·초록·대표 청구항]을 근거로 쓴다. 다른 특허의 내용을 섞지 않는다.',
  '- theme: 이 특허가 속한 기술 주제를 15자 이내 명사로. 부품 이름 하나가 아니라 기술 방향으로 쓰되, 원문에 나온 기술 용어를 바탕으로 쓴다.',
  '- purpose: 이 기술이 무엇을 위한 것인지(개선하려는 성능·제품 특성) 한 문장. 원문에 근거가 있으면 그대로 쓴다. 원문에 없으면 일반적인 디스플레이 기술 지식으로 추정하고 문장 맨 앞에 "(추정)"을 붙인다.',
  '- problem: 해결하려는 기술 문제 한 문장. 원문에 없으면 "원문에 명시되지 않음".',
  '- baseline: 기존 기술 대비 차이 한 문장. 원문에 비교가 없으면 "원문에 명시되지 않음".',
  '- improvement: 핵심 개선 사항 한 문장. 부품 이름만 나열하지 말고 "무엇을 어떻게 바꿔 어떤 효과를 노리는지"로 쓴다. 원문에 없는 효과는 쓰지 않는다.',
  '- topic: 무엇에 관한 특허인지 25자 안팎.',
  '- keywords: 원문에 나온 기술 용어 2~4개.',
  '- 원문에 없는 숫자는 쓰지 않는다.',
  ...RULES_COMMON,
  '형식: [{"no":1,"theme":"","purpose":"","topic":"","problem":"","baseline":"","improvement":"","keywords":[""]}]',
].join('\n');

// ② 시기별 흐름: 기술의 무게중심이 어떻게 이동했는지
const FLOW_PROMPT = [
  '너는 디스플레이 특허 기술 동향 보고서의 "시기별 기술 발전 방향"을 쓰는 분석가다.',
  '목표: 시기마다 기술의 무게중심이 어디서 어디로 이동했는지 보여 준다. 부품 이름을 나열하지 않고 기술 주제와 목적으로 묶는다.',
  '규칙:',
  '- [특허 분석]의 theme·purpose·improvement와 [자료]의 분야 건수만 근거로 쓴다.',
  '- [특허 분석]은 시기·회사마다 몇 건만 고른 표본이다. 근거 특허에서 본 내용은 "근거 특허에서는", "~를 다룬 특허가 있다"처럼 표본이라는 게 드러나게 쓰고, 회사 전체가 그렇다고 단정하지 않는다.',
  '- summary: 전체 기간의 이동을 한 문장으로 ("A에서 B로 이동" 꼴).',
  '- 시기마다 stage(그 시기 기술 단계 이름, 10자 이내), title(기술 주제 + 목적, 25자 안팎), points 정확히 2개, keywords 3개를 쓴다.',
  '- stage와 title은 그 칸 points 2개의 내용을 묶어 쓴다. points에 없는 주제를 제목에 넣지 않는다.',
  '- stage와 title에 목적·효과(신뢰성, 성능, 효율 등)를 쓰려면 그 말이 points의 근거 특허 원문(purpose 중 "(추정)"이 아닌 것)에 있어야 한다. "(추정)" 목적은 제목에 쓰지 않는다.',
  '- point는 "누가(자사·삼성·중국 4사) 어떤 기술을 무엇을 위해 다뤘는지" 한 문장이다.',
  '- refs에는 그 point에 나온 내용의 근거 특허 번호(no)를 빠짐없이 넣는다(최대 4개). 문장에 쓴 특허 내용마다 그 특허 번호가 refs에 있어야 한다.',
  '- 앞 시기와 달라진 점이 드러나게 쓴다. 같은 말을 시기마다 반복하지 않는다.',
  '- [특허 분석]의 purpose에 "(추정)"이 붙은 내용을 쓸 때는 문장에 "~로 보인다"를 붙인다.',
  '- keywords는 그 시기 [특허 분석]의 keywords에 있는 말을 그대로 고른다. 원문에 없는 용어나 영어 약어를 새로 만들지 않는다.',
  ...RULES_COMMON,
  '형식: {"summary":"","periods":[{"label":"(자료의 시기 이름 그대로)","stage":"","title":"","points":[{"text":"","refs":[1]}],"keywords":[""]}]}',
].join('\n');

// ③ 경쟁사 비교: 같은 시장에서 서로 다른 기술 문제에 집중하는 점
const COMPETITOR_PROMPT = [
  '너는 디스플레이 특허 기술 동향 보고서의 "경쟁사별 기술 집중도와 차별점 비교"를 쓰는 분석가다.',
  '목표: 회사마다 어떤 기술 주제에 집중하고, 다른 회사와 무엇이 다른지 보여 준다.',
  '규칙:',
  '- 회사마다 한 줄씩, [자료]에 있는 회사만 쓴다. company는 own, competitor, china 중 하나다.',
  '- focus: 그 회사의 집중 분야 1~2개. [자료]의 "비중 큰 분야"와 "많이 늘어난 분야"(DB 전체 건수)를 먼저 따른다. "기타"로 시작하는 분야는 분류되지 않은 묶음이라 focus에 쓰지 않는다.',
  '- 비중 순위를 비교할 때는 "기타"도 포함한 [자료]의 순서 그대로 쓴다. "세 회사 모두 ~가 가장 크다"는 세 회사의 비중 1위가 [자료]에서 실제로 같을 때만 쓴다.',
  '- [자료]에 "건수가 적어"라는 표시가 있는 회사는 비중·순위를 단정하지 않는다.',
  '- keywords: 그 회사 [특허 분석]의 keywords에 있는 말 3개를 그대로 고른다.',
  '- direction: 무엇이 다른가. 그 회사 근거 특허 2건 이상에서 공통으로 보이는 개선 방향을 다른 회사와 비교해 한 문장으로 쓴다. 근거 특허는 표본이므로 "근거 특허에서는"으로 시작한다.',
  '- 특허 1건에서만 보이는 내용으로 그 회사 전체를 단정하지 않는다.',
  '- refs: 그 회사 특허 번호(no)만 2~4개. direction에 쓴 내용마다 그 내용이 나온 특허 번호를 빠짐없이 넣는다. refs에 없는 특허의 내용은 direction에 쓰지 않는다.',
  '- lead: 세 회사가 어떻게 같고 다른지 한 문장. 비중 큰 분야가 같으면 같다는 점을 먼저 쓰고, 근거 특허에서 보이는 차이를 덧붙인다.',
  ...RULES_COMMON,
  '형식: {"lead":"","rows":[{"company":"own","focus":"","keywords":[""],"direction":"","refs":[1]}]}',
].join('\n');

// ④ 핵심 결론: 기술 축이 회사별로 어떻게 갈리는지
const HEADLINE_PROMPT = [
  '너는 디스플레이 특허 기술 동향 보고서의 제목(핵심 결론)과 시사점을 쓰는 분석가다.',
  '규칙:',
  '- headline: 보고서 전체의 핵심 결론 한 문장(60자 안팎). 건수 나열이 아니라 기술 흐름을 쓴다. 숫자는 쓰지 않는다.',
  '- headline은 [핵심 지표]와 [회사별 분야 비중]과 맞아야 한다. 회사들의 비중 1위 분야가 같으면 "기술 축이 갈린다"고 쓰지 않고, 같은 분야 안에서 근거 특허에 보이는 접근 차이로 쓴다.',
  '- 비중 1위는 "기타"(분류되지 않은 묶음)도 포함해 판단한다. "세 회사 모두"는 세 회사의 1위가 실제로 같을 때만 쓰고, 다르면 같은 회사들만 묶어 쓴다(예: "자사와 삼성 모두"). "건수가 적어" 표시가 있는 회사는 비중 비교에서 빼거나 그렇다고 밝힌다.',
  '- [시기별 흐름]과 [경쟁사 비교]는 근거 특허 표본에서 나온 것이다. 표본 몇 건으로 회사 전체를 단정하지 않는다.',
  '- takeaways: 정확히 2개. 자사가 이어서 살펴볼 만한 기술 주제를 "~를 살펴볼 만하다"로 쓴다. 숫자는 쓰지 않는다.',
  ...RULES_COMMON,
  '형식: {"headline":"","takeaways":["",""]}',
].join('\n');

const pct = (first, last) => (first >= MIN_COUNT && last >= MIN_COUNT ? Math.round((last - first) / first * 100) : null);
const pctText = (p) => (p === null ? '' : ` (${p > 0 ? '+' : ''}${p}%)`);

/** KPI·차트와 그 제목 문장: 모두 DB 숫자로 코드가 만든다 */
function buildQuant(scope, from, to) {
  const data = getSummaryStats(db, { ...scope, from, to }, CRITERIA_VERSION);
  const years = data.periods.map((p) => Number(p.key));
  const total = (c) => data.totals.find((t) => t.company === c);
  const own = total('own');
  const delta = (t) => t.counts.at(-1) - t.counts[0];
  const rowsOf = (c) => data.table.filter((t) => t.company === c && !['미분류', '그 외', '기타'].includes(t.group) && !/^기타/.test(t.group));
  const ownTop = rowsOf('own').sort((a, b) => delta(b) - delta(a))[0];
  const samTop = rowsOf('competitor').sort((a, b) => Math.abs(delta(b)) - Math.abs(delta(a)))[0];
  const fieldName = (g) => (data.groupLevel ? g : scope.level3 || g);
  const ownPct = pct(own.counts[0], own.counts.at(-1));
  const kpis = [
    { key: 'own-total', tone: 'own', label: '자사 전체 출원', value: `${own.counts[0]}건 → ${own.counts.at(-1)}건${pctText(ownPct)}`, detail: `${from}년 → ${to}년 출원` },
    ownTop && {
      key: 'own-growth', tone: 'own', label: delta(ownTop) >= 0 ? '자사에서 가장 많이 늘어난 분야' : '자사 분야 (가장 적게 줄어든 분야)',
      value: fieldName(ownTop.group), detail: `${ownTop.counts[0]}건 → ${ownTop.counts.at(-1)}건${pctText(pct(ownTop.counts[0], ownTop.counts.at(-1)))}`,
    },
    samTop && {
      key: 'samsung-move', tone: 'competitor', label: '삼성에서 가장 크게 변한 분야',
      value: fieldName(samTop.group), detail: `${samTop.counts[0]}건 → ${samTop.counts.at(-1)}건${pctText(pct(samTop.counts[0], samTop.counts.at(-1)))}`,
    },
  ].filter(Boolean);

  // 차트 제목: 회사별 첫해→마지막 해 증가율을 비교한 문장 (중국 4사는 건수가 적어도 비율로 비교하되 참고로 표시)
  const rate = (c) => {
    const t = total(c);
    return t.counts[0] > 0 ? Math.round((t.counts.at(-1) - t.counts[0]) / t.counts[0] * 100) : null;
  };
  const rates = COMPANIES.map((c) => ({ c, r: rate(c) })).filter((x) => x.r !== null).sort((a, b) => b.r - a.r);
  let yearlyTitle = '회사별 연도별 출원 건수';
  if (rates.length >= 2) {
    const [top, ...rest] = rates;
    yearlyTitle = top.r > 0
      ? `${SHORT[top.c]}의 출원 증가율이 가장 높다 (${rates.map((x) => `${SHORT[x.c]} ${x.r > 0 ? '+' : ''}${x.r}%`).join(', ')})`
      : `세 회사 모두 출원이 줄거나 비슷하다 (${rates.map((x) => `${SHORT[x.c]} ${x.r}%`).join(', ')})`;
    if (rest.length === 0) yearlyTitle = `${SHORT[top.c]} 출원 변화 ${top.r}%`;
  }
  const yearly = {
    title: yearlyTitle, years,
    series: Object.fromEntries(COMPANIES.map((c) => [c, total(c).counts])),
    incomplete: data.periods.filter((p) => p.incomplete).map((p) => Number(p.key)),
  };
  let distribution = null;
  if (data.groupLevel && data.groups.length > 1) {
    distribution = {
      year: to,
      title: `${to}년 회사별 분야 분포`,
      rows: COMPANIES.map((c) => {
        const all = data.table.filter((t) => t.company === c && t.counts.at(-1) > 0).sort((a, b) => b.counts.at(-1) - a.counts.at(-1));
        const sum = all.reduce((s, t) => s + t.counts.at(-1), 0);
        const top = all.slice(0, 5).map((t) => ({ label: t.group, count: t.counts.at(-1) }));
        const rest = sum - top.reduce((s, t) => s + t.count, 0);
        if (rest > 0) top.push({ label: '그 외', count: rest });
        return { company: c, total: sum, items: top.map((t) => ({ ...t, share: sum ? Math.round(t.count / sum * 100) : 0 })) };
      }).filter((r) => r.total > 0),
    };
    const ownDist = distribution.rows.find((r) => r.company === 'own');
    const samDist = distribution.rows.find((r) => r.company === 'competitor');
    if (ownDist && samDist && ownDist.items[0] && samDist.items[0]) {
      distribution.title = ownDist.items[0].label === samDist.items[0].label
        ? `${to}년 자사·삼성 모두 ${ownDist.items[0].label} 비중이 가장 크다 (자사 ${ownDist.items[0].share}%, 삼성 ${samDist.items[0].share}%)`
        : `${to}년 비중 1위 분야가 다르다 (자사 ${ownDist.items[0].label} ${ownDist.items[0].share}%, 삼성 ${samDist.items[0].label} ${samDist.items[0].share}%)`;
    }
  }
  // 정량 스냅샷 제목 (한 줄 결론)
  const quantTitle = [
    `자사 출원 ${own.counts[0]}건 → ${own.counts.at(-1)}건${pctText(ownPct)}`,
    ownTop && delta(ownTop) > 0 ? `가장 많이 늘어난 분야는 ${fieldName(ownTop.group)}` : '',
  ].filter(Boolean).join(', ');
  const numbers = new Set([
    ...years.map(String),
    ...data.totals.flatMap((t) => t.counts.map(String)),
    ...data.table.flatMap((t) => t.counts.map(String)),
    ...kpis.flatMap((k) => numbersIn(`${k.value} ${k.detail}`)),
  ]);
  return { data, kpis, quantTitle, charts: { yearly, distribution }, numbers };
}

/** AI를 부르지 않고 숫자·시기·근거 특허만 미리 본다 (시험용) */
export function previewTechReport({ level1, level2, level3, from, to }) {
  const scope = scopeKey({ level1, level2, level3 });
  const periods = splitPeriods(from, to);
  const quant = buildQuant(scope, from, to);
  return { periods, quantTitle: quant.quantTitle, kpis: quant.kpis, charts: quant.charts, evidence: selectEvidence(scope, periods, fieldCounts(scope, from, to)) };
}

/** 보고서를 만들고 저장한다 */
export async function generateTechReport({ level1, level2, level3, from, to }, { source = 'manual' } = {}) {
  if (!isAiConfigured()) throw new Error('AI 설정(AI_BASE_URL, AI_MODEL)이 비어 있어요');
  const scope = scopeKey({ level1, level2, level3 });
  const started = Date.now();
  const quant = buildQuant(scope, from, to);
  if (quant.data.noMatches) throw Object.assign(new Error('선택한 범위와 기간에 분류된 특허가 없어 보고서를 만들 수 없어요'), { status: 422 });
  const periods = splitPeriods(from, to);
  const counts = fieldCounts(scope, from, to);
  const evidence = selectEvidence(scope, periods, counts);
  if (evidence.length < 3) throw Object.assign(new Error(`근거로 쓸 특허가 ${evidence.length}건뿐이라 기술 분석을 만들 수 없어요`), { status: 422 });
  const claimInfo = await enrichClaims(evidence);
  const warnings = [];
  const warn = (where, reasons) => {
    if (!reasons.length) return undefined;
    const reason = reasons.join(' / ');
    warnings.push({ where, reason });
    return reason;
  };

  // ① 특허 분석 (6건씩 병렬, 기본 모델)
  const sourceText = (e) => [`명칭: ${e.title}`, `초록: ${e.abstract}`, e.claim ? `대표 청구항: ${e.claim}` : ''].filter(Boolean).join('\n');
  const batches = [];
  for (let i = 0; i < evidence.length; i += BATCH) batches.push(evidence.slice(i, i + BATCH));
  const analyzed = (await Promise.all(batches.map((b) => chatJson(PATENT_PROMPT,
    `[특허]\n${b.map((e) => `<no ${e.no}>\n${sourceText(e)}`).join('\n\n')}\n\n위 특허 ${b.length}건을 형식대로 분석해 줘.`,
    { purpose: 'tech-report-patents' })))).flat();
  const patents = evidence.map((e) => {
    const a = analyzed.find((x) => Number(x?.no) === e.no) ?? {};
    const item = {
      no: e.no, id: e.id, number: e.number, company: e.company, companyLabel: COMPANY[e.company],
      period: periods[e.period].label, date: e.date, field: e.field, title: e.title, reason: e.reason,
      source: e.claim ? '초록+청구항' : '초록',
      theme: String(a.theme ?? ''), purpose: String(a.purpose ?? ''), topic: String(a.topic ?? ''),
      problem: String(a.problem ?? ''), baseline: String(a.baseline ?? ''), improvement: String(a.improvement ?? ''),
      keywords: Array.isArray(a.keywords) ? a.keywords.map(String).slice(0, 4) : [],
    };
    item.inferred = item.purpose.includes(INFERRED);
    const reasons = a.no === undefined ? ['AI 분석 결과가 없음'] : checkPatentAnalysis(item, sourceText(e));
    item.caution = warn(`근거 특허 [${e.no}]`, reasons);
    return item;
  });

  // 자료: 시기별·회사별 분야 건수와 기술 주제
  const topFields = (company, pf, pt, k = 5) => Object.entries(sumBy(counts
    .filter((r) => r.company === company && r.year >= pf && r.year <= pt && r.field !== '미분류'), 'field'))
    .sort((a, b) => b[1] - a[1]).slice(0, k);
  const themesOf = (list) => Object.entries(list.reduce((m, p) => (p.theme ? { ...m, [p.theme]: (m[p.theme] ?? 0) + 1 } : m), {}))
    .sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}(${n}건)`).join(', ') || '(없음)';
  const periodFacts = periods.map((p) => [
    `[시기 ${p.label}]`,
    ...COMPANIES.map((c) => `${COMPANY[c]} 분야: ${topFields(c, p.from, p.to).map(([f, n]) => `${f} ${n}건`).join(', ') || '(출원 없음)'}`),
    `근거 특허의 기술 주제: ${themesOf(patents.filter((x) => x.period === p.label))}`,
  ].join('\n')).join('\n\n');
  const patentFacts = patents.map((p) => `no ${p.no} | ${p.period} | ${SHORT[p.company]} | 기술 주제: ${p.theme} | 목적: ${p.purpose} | 개선: ${p.improvement} | 키워드: ${p.keywords.join(', ')}`).join('\n');
  // 회사별 분야 비중(마지막 해)과 많이 늘어난 분야: DB 전체 건수 기준. 경쟁사 비교·결론이 표본이 아니라 이 숫자와 맞게
  const realRows = (c) => quant.data.table.filter((t) => t.company === c && !/^(기타|미분류|그 외)/.test(t.group));
  // 비중은 '기타'도 넣어 보여 준다. 빼고 주면 "세 회사 모두 ○○가 1위"처럼 틀린 비교가 나온다 (2026-11-23 검증: 중국 4사는 기타 소자가 1위)
  const allRows = (c) => quant.data.table.filter((t) => t.company === c && t.share !== null && !/^(미분류|그 외)$/.test(t.group));
  const lastTotal = (c) => quant.data.totals.find((t) => t.company === c)?.counts.at(-1) ?? 0;
  const shareText = (c) => [
    allRows(c).sort((a, b) => b.share - a.share).slice(0, 4)
      .map((t) => `${quant.data.groupLevel ? t.group : scope.level3} ${t.share}%${/^기타/.test(t.group) ? '(분류되지 않은 묶음)' : ''}`).join(', ') || '(없음)',
    lastTotal(c) < MIN_COUNT ? ` ※ 건수가 적어(${to}년 전체 ${lastTotal(c)}건) 비중이 몇 건 차이로 크게 바뀜` : '',
  ].join('');
  // 회사별 비중 1위 분야 ('기타' 포함). "세 회사 모두 ~"가 맞는지 코드가 확인한다
  const topGroupOf = (c) => allRows(c).sort((a, b) => b.share - a.share)[0]?.group ?? null;
  const tops = COMPANIES.filter((c) => lastTotal(c) > 0).map(topGroupOf);
  const sameTop = tops.length > 1 && tops.every((g) => g && g === tops[0]);
  const checkAllSame = (text) => (/(세 회사|세 기업|3사)\s*모두/.test(text) && !sameTop
    ? [`세 회사의 ${to}년 비중 1위 분야가 같지 않음 (${COMPANIES.filter((c) => lastTotal(c) > 0).map((c) => `${SHORT[c]} ${topGroupOf(c)}`).join(', ')})`]
    : []);
  const growText = (c) => realRows(c).map((t) => ({ g: t.group, d: t.counts.at(-1) - t.counts[0] })).filter((x) => x.d > 0)
    .sort((a, b) => b.d - a.d).slice(0, 3).map((x) => `${quant.data.groupLevel ? x.g : scope.level3} +${x.d}건`).join(', ') || '(늘어난 분야 없음)';
  const shareFacts = COMPANIES.map((c) => `${COMPANY[c]}: 비중 큰 분야(${to}년) ${shareText(c)} / 많이 늘어난 분야(${from}→${to}년) ${growText(c)}`).join('\n');
  const companyFacts = COMPANIES.map((c) => [
    `${c} = ${COMPANY[c]}`,
    `  비중 큰 분야(${to}년, DB 전체): ${shareText(c)}`,
    `  많이 늘어난 분야(${from}→${to}년, DB 전체): ${growText(c)}`,
    `  분야 건수(${from}~${to}년): ${topFields(c, from, to).map(([f, n]) => `${f} ${n}건`).join(', ') || '(출원 없음)'}`,
    `  근거 특허(표본 ${patents.filter((x) => x.company === c).length}건)의 기술 주제: ${themesOf(patents.filter((x) => x.company === c))}`,
  ].join('\n')).join('\n');
  const allowedNumbers = new Set([...quant.numbers, ...counts.map((r) => String(r.n)),
    ...periods.flatMap((p) => [String(p.from), String(p.to)]),
    ...evidence.flatMap((e) => numbersIn(sourceText(e)))]);
  periods.forEach((p) => COMPANIES.forEach((c) => topFields(c, p.from, p.to).forEach(([, n]) => allowedNumbers.add(String(n)))));
  COMPANIES.forEach((c) => topFields(c, from, to).forEach(([, n]) => allowedNumbers.add(String(n))));
  // 기술 주제 뒤 "(2건)" 같은 근거 특허 수도 자료에 있는 숫자다
  for (let n = 1; n <= patents.length; n++) allowedNumbers.add(String(n));
  numbersIn(shareFacts).forEach((n) => allowedNumbers.add(n));
  // 키워드·집중 분야 검사용 원문: 시기별·회사별 근거 특허의 명칭·초록·청구항과 분야 이름
  const sourceOf = (list) => list.map((p) => `${sourceText(evidence.find((e) => e.no === p.no))} ${p.field}`).join(' ');
  const fieldNames = counts.map((r) => r.field).join(' ');

  // ② 시기별 흐름, ③ 경쟁사 비교 (병렬, 인사이트 모델)
  const model = insightModel();
  const [flow, comp] = await Promise.all([
    chatJson(FLOW_PROMPT, `[자료]\n${periodFacts}\n\n[특허 분석]\n${patentFacts}\n\n시기 ${periods.map((p) => p.label).join(', ')}의 기술 발전 방향을 형식대로 써 줘.`, { purpose: 'tech-report-flow', model }),
    chatJson(COMPETITOR_PROMPT, `[자료] (${from}~${to}년 출원)\n${companyFacts}\n\n[특허 분석]\n${patentFacts}\n\n회사별 기술 초점과 차별점을 형식대로 비교해 줘.`, { purpose: 'tech-report-competitors', model }),
  ]);

  const toRefs = (v) => (Array.isArray(v) ? v.map(Number).filter(Number.isInteger) : []);
  const flowSummary = String(flow?.summary ?? '');
  const flowPeriods = periods.map((p, i) => {
    const got = (flow?.periods ?? []).find((x) => x?.label === p.label) ?? flow?.periods?.[i] ?? {};
    const mine = new Set(patents.filter((x) => x.period === p.label).map((x) => x.no));
    const points = (Array.isArray(got.points) ? got.points : []).slice(0, 2).map((pt, j) => {
      const text = String(pt?.text ?? pt ?? '');
      const refs = toRefs(pt?.refs);
      return { text, refs, caution: warn(`${p.label} 흐름 ${j + 1}`, checkStatement(text, { allowedNumbers, refs, allowedRefs: mine, refScope: '이 시기' })) };
    });
    const title = String(got.title ?? '');
    const stage = String(got.stage ?? '').slice(0, 14) || `${i + 1}단계`;
    const keywords = Array.isArray(got.keywords) ? got.keywords.map(String).slice(0, 4) : [];
    const periodSource = sourceOf(patents.filter((x) => x.period === p.label));
    const strangeKw = missingTerms(keywords, periodSource);
    // 제목의 목적·효과 말은 그 칸 문장이 든 근거 특허 원문에 있어야 한다 (추정 목적만으로 제목을 붙이지 않게)
    const citedSource = sourceOf(patents.filter((x) => points.some((pt) => pt.refs.includes(x.no))));
    const effects = unsupportedEffects(`${stage} ${title}`, citedSource || periodSource);
    return {
      label: p.label, from: p.from, to: p.to, stage, title,
      titleCaution: warn(`${p.label} 제목`, [
        ...checkStatement(`${stage} ${title}`, { allowedNumbers }),
        ...(effects.length ? [`이 칸 근거 특허 원문에 없는 목적·효과: ${effects.join(', ')}`] : []),
      ]),
      points, keywords,
      keywordsCaution: warn(`${p.label} 핵심 키워드`, strangeKw.length ? [`이 시기 근거 특허에 없는 용어: ${strangeKw.join(', ')}`] : []),
    };
  });
  const competitorLead = String(comp?.lead ?? '');
  const competitors = COMPANIES.filter((c) => counts.some((r) => r.company === c)).map((c) => {
    const got = (comp?.rows ?? []).find((x) => x?.company === c) ?? {};
    const refs = toRefs(got.refs);
    const mine = patents.filter((x) => x.company === c);
    const owned = new Set(mine.map((x) => x.no));
    const text = `${got.focus ?? ''} ${got.direction ?? ''}`;
    const keywords = Array.isArray(got.keywords) ? got.keywords.map(String).slice(0, 4) : [];
    const focus = String(got.focus ?? '');
    // 집중 분야는 DB 분야 이름이나 그 회사 근거 특허에 나오는 말이어야 한다
    const strangeFocus = missingTerms(focus.split(/[,，]/).map((s) => s.trim()), `${fieldNames} ${sourceOf(mine)} ${mine.map((x) => x.theme).join(' ')}`);
    const strangeKw = missingTerms(keywords, sourceOf(mine));
    return {
      company: c, companyLabel: COMPANY[c], focus, keywords,
      direction: String(got.direction ?? ''), refs,
      caution: warn(`경쟁사 비교 ${COMPANY[c]}`, [
        ...(got.company ? [] : ['AI 답에 이 회사 줄이 없음']),
        ...checkStatement(text, { allowedNumbers, refs, allowedRefs: owned, refScope: '이 회사' }),
        ...(refs.filter((r) => owned.has(r)).length < 2 ? ['근거 특허 1건 이하로 회사 전체를 설명함'] : []),
        ...(strangeFocus.length ? [`근거에 없는 집중 분야: ${strangeFocus.join(', ')}`] : []),
        ...(strangeKw.length ? [`근거 특허에 없는 키워드: ${strangeKw.join(', ')}`] : []),
      ]),
    };
  });

  // ④ 핵심 결론과 시사점
  const kpiFacts = quant.kpis.map((k) => `${k.label}: ${k.value} (${k.detail})`).join('\n');
  const head = await chatJson(HEADLINE_PROMPT, [
    `[핵심 지표]\n${kpiFacts}`,
    `[회사별 분야 비중] (DB 전체 건수)\n${shareFacts}`,
    `[시기별 흐름] ${flowSummary}\n${flowPeriods.map((p) => `${p.label} ${p.stage} · ${p.title}: ${p.points.map((x) => x.text).join(' ')}`).join('\n')}`,
    `[경쟁사 비교] ${competitorLead}\n${competitors.map((c) => `${c.companyLabel}: ${c.focus} / ${c.direction}`).join('\n')}`,
    '보고서의 핵심 결론과 시사점을 형식대로 써 줘.',
  ].join('\n\n'), { purpose: 'tech-report-headline', model });
  const headline = String(head?.headline ?? '');
  const takeaways = (Array.isArray(head?.takeaways) ? head.takeaways : []).slice(0, 2).map((t, i) => {
    const text = String(t);
    return { text, caution: warn(`시사점 ${i + 1}`, checkStatement(text, { allowedNumbers: new Set() })) };
  });

  const notes = [
    ...(quant.charts.yearly.incomplete.length ? [`${quant.charts.yearly.incomplete.join(', ')}년은 아직 공개가 덜 되어 건수가 적게 보일 수 있어요.`] : []),
    ...(quant.data.totals.some((t) => t.company !== 'china' && t.counts.some((n) => n < MIN_COUNT)) ? [`연간 ${MIN_COUNT}건 미만인 회사·연도가 있어 몇 건 차이로도 흐름이 달라 보일 수 있어요.`] : []),
    ...(quant.data.totals.some((t) => t.company === 'china' && t.counts.some((n) => n < MIN_COUNT)) ? ['중국 4사는 한국 출원이 적어 증가율이 크게 흔들릴 수 있어요.'] : []),
    ...(claimInfo.skipped ? [claimInfo.skipped] : []),
  ];
  const report = {
    version: 2,
    scopeLabel: scopeLabel(scope), from, to,
    headline, headlineCaution: warn('핵심 결론', [...checkStatement(headline, { allowedNumbers: quant.numbers }), ...checkAllSame(headline)]),
    quantTitle: quant.quantTitle, kpis: quant.kpis, charts: quant.charts,
    flowSummary, flowSummaryCaution: warn('시기별 흐름 요약', checkStatement(flowSummary, { allowedNumbers })),
    periods: flowPeriods,
    competitorLead, competitorLeadCaution: warn('경쟁사 비교 요약', [...checkStatement(competitorLead, { allowedNumbers }), ...checkAllSame(competitorLead)]),
    competitors, patents, takeaways, notes,
    models: { patents: (process.env.AI_MODEL ?? '').trim(), insight: model || (process.env.AI_MODEL ?? '').trim() },
  };
  const checks = { warnings, claims: claimInfo, evidenceCount: patents.length, claimBoosted: patents.filter((p) => p.source === '초록+청구항').length, inferred: patents.filter((p) => p.inferred).length };
  const facts = [`[시기별 자료]\n${periodFacts}`, `[회사별 자료]\n${companyFacts}`, `[핵심 지표]\n${kpiFacts}`, `[특허 분석 요약]\n${patentFacts}`].join('\n\n');
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO tech_reports (level1, level2, level3, period_from, period_to, criteria_version, model, content, facts, checks, elapsed_ms, source)
    VALUES (@level1, @level2, @level3, @from, @to, @version, @model, @content, @facts, @checks, @elapsed, @source)
  `).run({
    ...scope, from, to, version: CRITERIA_VERSION,
    model: [...new Set([report.models.patents, report.models.insight])].join(' + '),
    content: JSON.stringify(report), facts, checks: JSON.stringify(checks), elapsed: Date.now() - started, source,
  });
  return getTechReportById(lastInsertRowid);
}

const parseRow = (r) => r && { ...r, report: JSON.parse(r.content), checks: JSON.parse(r.checks) };

export function getTechReportById(id) {
  return parseRow(db.prepare('SELECT * FROM tech_reports WHERE id = ?').get(id));
}

/** 범위·기간의 가장 최근 보고서 */
export function latestTechReport({ level1, level2, level3, from, to }) {
  return parseRow(db.prepare(`
    SELECT * FROM tech_reports
    WHERE level1 = @level1 AND level2 = @level2 AND level3 = @level3 AND period_from = @from AND period_to = @to
    ORDER BY id DESC LIMIT 1
  `).get({ ...scopeKey({ level1, level2, level3 }), from, to }));
}

/** 보관함: 지금까지 만든 보고서 목록 (최신순, 본문 제외). scope가 null이면 모든 분류 */
export function listTechReports(scope, limit = 300) {
  const where = scope ? 'WHERE level1 = @level1 AND level2 = @level2 AND level3 = @level3' : '';
  return db.prepare(`
    SELECT id, created_at, level1, level2, level3, period_from, period_to, model, source, criteria_version, checks
    FROM tech_reports ${where}
    ORDER BY id DESC LIMIT @limit
  `).all({ ...(scope ? scopeKey(scope) : {}), limit }).map((r) => ({ ...r, checks: JSON.parse(r.checks) }));
}
