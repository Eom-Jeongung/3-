// 신기술 탐지: 최근에 급증한 용어 찾기 (팀 Python 스크립트 emerging_terms.py를 JavaScript로 옮긴 것)
// AI 없이 DB만으로 계산한다. 동향 요약의 "성장 키워드" 재료로 쓴다
//
// 방법 (Python 버전과 같음)
//  1. 용어: 명칭·초록에서 명사구(1~3어절)를 뽑는다
//     - Python은 형태소 분석기(kiwipiepy)를 썼고, 여기서는 띄어쓰기 단위로 자른 뒤 조사·어미를 떼는 규칙을 쓴다
//  2. 횟수: 한 특허에 여러 번 나와도 1번 (문서 빈도)
//  3. 흔한 단어 제거: 전체의 8% 넘게 나오는 용어는 뺀다 (IDF 필터)
//  4. 급증 판정: 최근 구간 vs 과거 구간을 로그우도비로 비교해 "우연이 아닌 증가"만 남긴다
//  5. 거의 같은 특허에 함께 나오는 용어는 한 줄로 합친다
import fs from 'node:fs';
import { db } from './db.js';

const PARAMS = {
  minDocs: 5,          // 최근 구간에서 최소 이 건수 이상
  llrThreshold: 10.83, // 우연일 확률 0.1% 수준
  maxDocShare: 0.08,   // 전체의 8% 넘게 나오면 흔한 단어
  smoothing: 0.0005,
  topN: 50,
  samples: 3,
  maxPatents: 30,      // 용어마다 화면에 넘겨 줄 특허 수
  earlyMinDocs: 3,     // 초기 신호: 과거 0건, 최근 이 건수 이상
  earlyTopN: 20,
};

const key = (s) => s.replace(/\s+/g, '').toLowerCase();

// 특허 문서에 늘 나오는 상투어 (띄어쓰기 없이 비교) — Python 버전 STOPWORDS와 같음
const STOPWORDS = new Set([
  '표시장치', '표시패널', '디스플레이장치', '디스플레이패널', '실시예', '일실시예', '본발명',
  '기판', '전극', '제1전극', '제2전극', '화소', '복수', '복수개', '영역', '부분', '방법', '장치',
  '포함', '구성', '배치', '형성', '상부', '하부', '일측', '타측', '단면도', '평면도', '도면',
  '구조', '연결', '접촉', '개선', '향상', '효율', '신뢰성', '실시', '예', '상기', '해당', '각각', '일부', '하나', '이상', '이하', '사이', '적어도', '제1', '제2',
  '전자', '전자장치', '전자기기', '기기', '모바일전자장치', '평면', '노드', '양상', '관점', '개시', '단계',
  '본명세서', '명세서', '발명', '경우', '목적', '효과', '제공', '특징', '이용', '사용', '가능', '정도', '방향', '위치', '상태', '면', '측',
  'displaydevice', 'displaypanel', 'substrate', 'electrode', 'embodiment', 'method', 'device',
].map(key));

// 이 단어가 오면 명사구를 끊는다 (관형사·접두어)
const BREAK_WORDS = new Set(['상기', '본', '일', '각', '제', '상', '하', '개시', '양상', '관점', '측면', '등', '및', '또는', '그', '이', '이러한', '해당', '복수의', '적어도', '각각의', '다른', '서로', '동일한',
  // 위치를 나타내는 말 ("절연층 상에", "기판 상의")
  '상에', '상의', '상으로', '상에서', '하에', '내에', '내의', '위에', '위의', '아래', '아래에', '중', '내', '외', '간', '것', '수', '때']);

// 띄어 쓴 용어를 붙이고, 상투 표현은 쉼표로 바꿔 명사구를 끊는다 — Python 버전 NORMALIZE와 같음
const NORMALIZE = [
  [/화소\s*정의\s*(막|층)/g, '화소정의막'], [/증\s*착\s*용/g, '증착용'], [/발광\s*스택/g, '발광스택'],
  [/(층|막|영역|기판|전극|패턴|개구부)상(?=[에의으,.\s]|$)/g, '$1 '],
  [/(모바일\s*)?전자\s*(장치|기기)/g, ','], [/실시\s*(예|례)들?/g, ','], [/일\s*례/g, ','],
  [/구체적(으로|인)?/g, ','],
];

// 같은 뜻의 다른 표기를 하나로 (classification/term_synonyms.csv). 흩어져 있으면 건수 기준(5건)을 못 넘어 급증을 놓친다
// 띄어쓰기 차이(마이크로 LED / 마이크로LED)는 원래 같은 용어로 센다. 여기서는 뜻이 같은 다른 말을 묶는다
const SYNONYMS = loadSynonyms();
function loadSynonyms() {
  const file = new URL('../classification/term_synonyms.csv', import.meta.url);
  if (!fs.existsSync(file)) return [];
  const escape = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).slice(1).filter((l) => l.trim()).flatMap((line) => {
    const [canonical, variants = ''] = line.split(',');
    return variants.split('|').map((v) => v.trim()).filter(Boolean).map((v) => {
      const body = v.split(/\s+/).map(escape).join('\\s*');
      // 영문은 다른 영단어 안에서 걸리지 않게 (QD가 QDOT 안에서 걸리지 않게)
      // 영문 약어는 앞뒤에 영문·하이픈이 붙으면 다른 말이다 (QD-OLED의 QD는 양자점으로 바꾸지 않는다)
      const pattern = /^[A-Za-z]/.test(v) ? `(?<![A-Za-z-])${body}(?![A-Za-z-])` : body;
      return [new RegExp(pattern, 'gi'), canonical.trim()];
    });
  });
}

// 어절 끝의 조사: 떼어 내고, 뗐으면 그 어절에서 명사구가 끝난 것으로 본다
const PARTICLES = ['으로부터', '에서부터', '로부터', '에서의', '에서는', '에서', '으로는', '으로', '에는', '에게', '와의', '과의',
  '로는', '로서', '로써', '보다', '까지', '부터', '마다', '처럼', '만큼', '이며', '이고', '에', '의', '을', '를', '은', '는',
  '이', '가', '와', '과']; // '로'는 "마이크로"처럼 외래어 끝과 헷갈려 '으로'만 뗀다
// 받침이 있어야 붙는 조사 / 없어야 붙는 조사 ("디스플레이"의 '이'를 조사로 떼지 않게)
const NEEDS_BATCHIM = new Set(['이', '을', '은', '과', '으로', '으로는', '이며', '이고']);
const NEEDS_VOWEL = new Set(['가', '를', '는', '와']);
const hasBatchim = (ch) => { const c = ch.charCodeAt(0) - 0xac00; return c >= 0 && c < 11172 && c % 28 !== 0; };
const isHangul = (ch) => { const c = ch.charCodeAt(0) - 0xac00; return c >= 0 && c < 11172; };
// 용언(동사·형용사)으로 끝나는 어절: 명사구가 아니다
const VERB_END = /((하|되|있|없|않|싸|지|이|시키|가지|갖)(고|며|면|도록|지만|어|여|서|고자)|하는|되는|있는|없는|하고|되고|하여|되어|하며|되며|한다|된다|하기|되기|하도록|되도록|하면|되면|했|됐|해서|돼서|하지|되지|않는|않고|같은|위한|위해|따른|따라|대한|대해|통해|통한|관한|의한|의해|인한|있고|있으며|있다|없다|이다|된|한|할|될|진|있어|없이|적인|적으로|하게|되게)$/;

function stripParticle(word) {
  for (const p of PARTICLES) {
    if (word.length < p.length + 1 || !word.endsWith(p)) continue;
    const stem = word.slice(0, -p.length);
    const last = stem.at(-1);
    if (!isHangul(last)) continue; // 'OLED의'는 영문 뒤라 받침 판단 없이 '의'만 뗀다
    if (NEEDS_BATCHIM.has(p) && !hasBatchim(last)) continue;
    if (NEEDS_VOWEL.has(p) && hasBatchim(last)) continue;
    // 떼고 남은 말이 동사 줄기면("둘러싸는" → "둘러싸") 명사가 아니다
    if (/(싸|하|되|있|없|않|시키|이루어지|가지|갖|보이|놓이|쌓이)$/.test(stem)) return '';
    return stem;
  }
  if (/[A-Za-z0-9)](의|에|을|를|은|는|이|가|와|과|로)$/.test(word)) return word.slice(0, -1);
  return null;
}

// 여러 어절 구의 처음·끝에 오면 안 되는 말 (화소·기판처럼 기술 명사는 구 안에서는 살린다: "화소 구동 회로")
const GENERIC = new Set(['포함', '구성', '배치', '형성', '방법', '상부', '하부', '일부', '각각', '하나', '복수', '복수개',
  '부분', '영역', '일측', '타측', '사이', '이상', '이하', '해당', '경우', '목적', '효과', '제공', '이용', '사용', '전자', '실시예',
  '본발명', '발명', '명세서', '본명세서', '단계', '개시', '제1', '제2', '상태', '방향', '위치'].map(key));

const isNumberish = (k) => /^[\d.,%~\-]+$/.test(k);

/** 명칭·초록에서 1~3어절 명사구를 뽑는다. 같은 특허 안 중복은 1번 (Set) */
function extractTerms(text, surface) {
  if (!text) return new Set();
  let t = text;
  for (const [pat, sub] of SYNONYMS) t = t.replace(pat, sub);
  t = t.replace(/(\S+)\s*\(\s*\1\s*\)/g, '$1'); // "박막 트랜지스터(TFT)"가 같은 말로 바뀌어 겹친 것
  for (const [pat, sub] of NORMALIZE) t = t.replace(pat, sub);

  const chunks = [];
  let cur = [];
  const flush = () => { if (cur.length) chunks.push(cur); cur = []; };
  // 문장부호·괄호는 명사구 경계
  for (const raw of t.split(/[\s,.;:()[\]{}"'“”‘’·/<>]+/)) {
    if (!raw) { flush(); continue; }
    if (BREAK_WORDS.has(raw)) { flush(); continue; }
    if (VERB_END.test(raw)) { flush(); continue; }
    const stem = stripParticle(raw);
    if (stem === '') { flush(); continue; }
    const word = stem ?? raw;
    const ended = stem !== null;
    if (!/[가-힣A-Za-z]/.test(word)) { flush(); continue; }
    // 한 글자 한글 낱말은 대부분 조사·의존명사라 구를 끊는다 ("것은", "은")
    if (word.length === 1 && isHangul(word)) { flush(); continue; }
    cur.push(word);
    if (ended) flush();
  }
  flush();

  const keys = new Set();
  for (const ch of chunks) {
    for (const n of [1, 2, 3]) {
      for (let i = 0; i + n <= ch.length; i++) {
        const phrase = ch.slice(i, i + n).join(' ');
        const k = key(phrase);
        if (k.length < 2 || isNumberish(k) || STOPWORDS.has(k)) continue;
        if (n > 1 && new Set(ch.slice(i, i + n)).size < n) continue; // "기판 기판"처럼 같은 말 반복
        // 3어절 이상 긴 구가 상투어로 시작하거나 끝나면 뺀다
        if (n > 1 && (GENERIC.has(key(ch[i])) || GENERIC.has(key(ch[i + n - 1])))) continue;
        keys.add(k);
        if (surface) {
          const m = surface.get(k) ?? new Map();
          m.set(phrase, (m.get(phrase) ?? 0) + 1);
          surface.set(k, m);
        }
      }
    }
  }
  return keys;
}

/** 두 묶음 비교 로그우도비 (a/n1 = 최근, b/n2 = 과거) */
function logLikelihood(a, n1, b, n2) {
  const total = n1 + n2, k = a + b;
  if (total === 0 || k === 0 || k === total) return 0;
  const cells = [
    [a, (n1 * k) / total], [b, (n2 * k) / total],
    [n1 - a, (n1 * (total - k)) / total], [n2 - b, (n2 * (total - k)) / total],
  ];
  return 2 * cells.reduce((s, [o, e]) => (o > 0 && e > 0 ? s + o * Math.log(o / e) : s), 0);
}

const monthsBefore = (iso, months) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(Math.min(d.getUTCDate(), 28));
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
};

/**
 * 최근 구간에 급증한 용어
 * @param {{applicant?: 'all'|'own'|'competitor'|'china', level1?: string, level2?: string, level3?: string,
 *   recentMonths?: number, pastMonths?: number, ref?: string,
 *   dateField?: 'open_date'|'application_date', recentFrom?: string, pastFrom?: string}} opts
 *   dateField·recentFrom·pastFrom: 동향 요약처럼 출원 기간으로 볼 때 (예: 과거 2022-01-01~, 최근 2024-01-01~ref)
 */
// 특허마다 뽑은 용어를 기억해 둔다 (전체 특허를 매번 다시 자르면 30초 가까이 걸려서, 두 번째부터는 1~2초)
// 명칭·초록이 바뀌면 다시 뽑는다
const termCache = new Map(); // 출원번호 -> { text, keys, phrases }
function cachedTerms(d) {
  const text = `${d.title ?? ''} ${d.abstract ?? ''}`;
  const hit = termCache.get(d.num);
  if (hit && hit.text === text) return hit;
  const surface = new Map();
  const keys = extractTerms(text, surface);
  const phrases = [];
  for (const [k, m] of surface) for (const [phrase, n] of m) for (let i = 0; i < n; i++) phrases.push([k, phrase]);
  const entry = { text, keys, phrases };
  termCache.set(d.num, entry);
  return entry;
}

// ---- 초기 신호 잡음 거르기 ----
// 건수가 적은 새 용어는 문장 조각("보다 상세하게", "스위칭 소자들로")이 많이 섞여서, 기술 용어로 보기 어려운 구는 뺀다
const WEAK_WORD = /^(보다|상세하게|여기|일부분|개수|물질|정도|가까운|갖는|덮는|포함하되|기초로|연결해주며|작거나|같다|제공하는바|그리고|당해|제조방법|장착|소재|개시서|패턴|가능성|가로|것|한정부)$|(들로|으로|물질로|하게|시켜|시킬|하되|해주며|하는바|된다|한다|으며|져서|어서|시킨다|함으|으)$|^제\d/;
// 구의 끝에 오면 앞말을 꾸미는 흔한 말이라 새 기술 이름이 아니다 ("기판 표시", "애노드 전극 발광")
const WEAK_TAIL = new Set(['표시', '화소', '발광', '신호', '연결', '터치', '게이트', '전극', '패턴', '영역', '라인', '구조', '기판', '절연층', '층']);
const topSurface = (surface, k) => [...(surface.get(k) ?? new Map([[k, 1]]))].sort((x, y) => y[1] - x[1])[0][0];
function isWeakPhrase(phrase) {
  const words = phrase.split(/\s+/);
  if (words.some((w) => WEAK_WORD.test(w))) return true;
  if (words.length > 1 && (WEAK_TAIL.has(words.at(-1)) || WEAK_TAIL.has(words[0]))) return true;
  return false;
}

// 같은 조건의 결과를 기억해 둔다. 특허가 새로 들어오거나 분류 기준이 바뀌면 다시 계산한다
const resultCache = new Map();
const dataStamp = () => JSON.stringify(db.prepare(`
  SELECT (SELECT COUNT(*) FROM patents) n, (SELECT MAX(open_date) FROM patents) d, (SELECT MAX(criteria_version) FROM classification) v
`).get());

export function burstTerms(opts = {}) {
  const k = JSON.stringify(opts);
  const stamp = dataStamp();
  const hit = resultCache.get(k);
  if (hit && hit.stamp === stamp) return hit.result;
  const result = computeBurstTerms(opts);
  if (resultCache.size > 300) resultCache.clear();
  resultCache.set(k, { stamp, result });
  return result;
}

/** 화면에서 자주 보는 조건(전체 분야, 출원인별, 최근 24개월)을 미리 계산해 둔다. 실패해도 화면에서 다시 계산하므로 무시 */
export function warmUpEmerging() {
  const started = Date.now();
  try {
    for (const company of ['', 'own', 'competitor', 'china']) burstTerms({ applicant: company || 'all', level1: '', level2: '', level3: '', recentMonths: 24 });
    console.log(`[신기술 탐지] 미리 계산 끝 (${((Date.now() - started) / 1000).toFixed(0)}초)`);
  } catch (err) {
    console.error(`[신기술 탐지] 미리 계산 실패: ${err.message}`);
  }
}

function computeBurstTerms({
  applicant = 'all', level1 = '', level2 = '', level3 = '', recentMonths = 24, pastMonths = 48, ref = '',
  dateField = 'open_date', recentFrom = '', pastFrom = '',
} = {}) {
  const where = [];
  const params = {};
  if (applicant !== 'all') { where.push('p.applicant_type = @applicant'); params.applicant = applicant; }
  if (level1) { where.push('c.level1 = @level1'); params.level1 = level1; }
  if (level2) { where.push('c.level2 = @level2'); params.level2 = level2; }
  if (level3) { where.push('c.level3 = @level3'); params.level3 = level3; }
  const dateCol = dateField === 'application_date' ? 'p.application_date' : 'p.open_date';
  const rows = db.prepare(`
    SELECT p.id, p.application_number num, p.title, p.abstract, p.applicant_type type, ${dateCol} pub
    FROM patents p
    ${level1 || level2 || level3 ? `JOIN classification c ON c.application_number = p.application_number
      AND c.is_primary + 0 = 1 AND c.criteria_version || '' = (SELECT MAX(criteria_version) FROM classification)` : ''}
    WHERE ${dateCol} IS NOT NULL ${where.length ? `AND ${where.join(' AND ')}` : ''}
  `).all(params);

  // 분할출원처럼 초록이 같은 특허는 하나로 (Python dedupe와 같음)
  rows.sort((x, y) => (x.pub < y.pub ? -1 : x.pub > y.pub ? 1 : 0));
  const seen = new Set();
  const docs = rows.filter((d) => {
    const body = (d.abstract ?? '').replace(/\s+/g, '').slice(0, 200);
    const sig = body ? `${d.type}|${body}` : d.num;
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });
  if (!docs.length) return { rows: [], recent: 0, past: 0 };

  const refDate = ref || docs.at(-1).pub;
  const recentStart = recentFrom || monthsBefore(refDate, recentMonths);
  const pastStart = pastFrom || monthsBefore(recentStart, pastMonths);
  const recent = docs.filter((d) => d.pub >= recentStart && d.pub <= refDate);
  const past = docs.filter((d) => d.pub >= pastStart && d.pub < recentStart);

  const surface = new Map();
  const recentSets = recent.map((d) => {
    const { keys, phrases } = cachedTerms(d);
    for (const [k, phrase] of phrases) {
      const m = surface.get(k) ?? new Map();
      m.set(phrase, (m.get(phrase) ?? 0) + 1);
      surface.set(k, m);
    }
    return { terms: keys, d };
  });
  const recentCounts = new Map();
  for (const { terms } of recentSets) for (const t of terms) recentCounts.set(t, (recentCounts.get(t) ?? 0) + 1);
  const pastCounts = new Map();
  for (const d of past) for (const t of cachedTerms(d).keys) pastCounts.set(t, (pastCounts.get(t) ?? 0) + 1);

  const n1 = recent.length, n2 = past.length, nAll = n1 + n2;
  const eps = PARAMS.smoothing;
  let out = [];
  for (const [term, a] of recentCounts) {
    if (a < PARAMS.minDocs) continue;
    const b = pastCounts.get(term) ?? 0;
    if (nAll && (a + b) / nAll > PARAMS.maxDocShare) continue;
    const p1 = a / n1, p2 = n2 ? b / n2 : 0;
    if (p1 <= p2) continue;
    const g = logLikelihood(a, n1, b, n2);
    if (g < PARAMS.llrThreshold) continue;
    out.push({
      term, recentDocs: a, pastDocs: b,
      recentPct: +(p1 * 100).toFixed(3), pastPct: +(p2 * 100).toFixed(3),
      growth: +((p1 + eps) / (p2 + eps)).toFixed(2), llr: +g.toFixed(1), isNew: b === 0,
    });
  }
  out.sort((x, y) => y.llr - x.llr || y.growth - x.growth);
  const burstKeys = new Set(out.map((r) => r.term));
  out = mergeOverlaps(out.slice(0, PARAMS.topN * 5), recentSets, surface).slice(0, PARAMS.topN);

  // 초기 신호: 과거에는 한 건도 없다가 최근에 3건 이상 나온 새 용어. 건수가 적어 급증 판정(5건 이상)에는 못 들지만
  // 막 나타나기 시작한 기술일 수 있어 따로 보여 준다. 같은 발명의 쌍둥이 출원만으로 생긴 말을 거르려고 명칭이 2가지 이상이어야 한다
  const titlesOf = (term) => new Set(recentSets.filter((s) => s.terms.has(term)).map((s) => key(s.d.title ?? ''))).size;
  let early = [];
  for (const [term, a] of recentCounts) {
    if (a < PARAMS.earlyMinDocs || burstKeys.has(term) || pastCounts.has(term)) continue;
    if (nAll && a / nAll > PARAMS.maxDocShare) continue;
    if (titlesOf(term) < 2) continue;
    early.push({ term, recentDocs: a, pastDocs: 0, recentPct: +((a / n1) * 100).toFixed(3), pastPct: 0, isNew: true });
  }
  early = early.filter((r) => !isWeakPhrase(topSurface(surface, r.term)));
  early.sort((x, y) => y.recentDocs - x.recentDocs || key(y.term).length - key(x.term).length);
  early = mergeOverlaps(early.slice(0, PARAMS.topN * 5), recentSets, surface).slice(0, PARAMS.earlyTopN);

  const display = (k) => [...(surface.get(k) ?? new Map([[k, 1]]))].sort((x, y) => y[1] - x[1])[0][0];
  for (const r of [...out, ...early]) {
    const hits = recentSets.filter((s) => s.terms.has(r.term)).map((s) => s.d).sort((x, y) => (x.pub < y.pub ? 1 : -1));
    const brief = (d) => ({ id: d.id, applicationNumber: d.num, title: d.title, type: d.type, date: d.pub });
    r.examples = hits.slice(0, PARAMS.samples).map(brief);
    r.patents = hits.slice(0, PARAMS.maxPatents).map(brief); // 화면에서 용어를 누르면 보여 줄 특허
    r.related = r.related.slice(0, 8).map(display);
    r.term = display(r.term);
  }
  return { rows: out, early, ref: refDate, recentStart, pastStart, recent: n1, past: n2 };
}

/** 거의 같은 특허에 함께 나오는 용어(자카드 0.8 이상)는 한 줄로 합치고, 가장 구체적인 용어를 대표로 */
function mergeOverlaps(rows, recentSets, surface) {
  const wanted = new Set(rows.map((r) => r.term));
  const docSets = new Map([...wanted].map((t) => [t, new Set()]));
  recentSets.forEach(({ terms }, i) => { for (const t of terms) if (wanted.has(t)) docSets.get(t).add(i); });
  const groups = [];
  for (const r of rows) {
    const mine = docSets.get(r.term);
    const g = groups.find((grp) => {
      const anchor = docSets.get(grp[0].term);
      let inter = 0;
      for (const x of mine) if (anchor.has(x)) inter++;
      const union = mine.size + anchor.size - inter;
      return union && inter / union >= 0.8;
    });
    if (g) g.push(r); else groups.push([r]);
  }
  const words = (k) => [...(surface.get(k)?.keys() ?? [k])][0].split(' ').length;
  return groups.map((g) => {
    const top = Math.max(...g.map((x) => x.recentDocs));
    const rep = { ...g.filter((x) => x.recentDocs >= 0.8 * top).sort((x, y) => words(y.term) - words(x.term) || y.term.length - x.term.length)[0] };
    rep.llr = g[0].llr;
    rep.related = g.filter((x) => x.term !== rep.term).map((x) => x.term);
    return rep;
  });
}
