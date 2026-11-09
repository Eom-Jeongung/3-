// AI 동향 요약 검사: AI가 자료에 없는 숫자를 만들었거나, 특허 설명에 다른 특허 내용을 섞었는지 찾는다
// 요약 시험(scripts/summary-trial.js)과 나중의 요약 기능이 함께 쓴다

/** 요약의 다섯 칸 (프롬프트와 검사가 함께 쓴다) */
export const SECTIONS = ['핵심 흐름', '성장 분야', '경쟁사 동향', '주목 특허', '한계'];

const STOP = new Set(['자사', '경쟁사', 'LG디스플레이', '삼성디스플레이', '중심', '출원', '특허', '기술', '구조', '분야', '증가', '감소',
  '포함', '구현', '확보', '향상', '동시', '배치', '적용', '형성', '지속', '표시', '장치', '디스플레이', '방지', '개선', '강화', '최적화',
  '도모', '추구', '명세서', '발명', '실시예', '제공', '관한', '것으로', '상기', '포함하는', '위치하는', '배치되는', '있다']);
const JOSA = /(으로|에서|하여|하는|되는|을|를|이|가|은|는|의|에|로|와|과|도|만|및|한|해|된|함|등)$/;
const VERB_END = /(한다|된다|이다|있다|하며|하고|하여|하는|하도록|하게|하면|되어|되며|되고|되는|시키는|시켜|함으로써|있는|없는|같은|위한|따른|통해)$/; // 동사·어미는 기술 용어가 아니다
const squeeze = (t) => t.replace(/\s+/g, '');
const termsOf = (text) => [...new Set((text.match(/[가-힣A-Za-z]{2,}/g) ?? [])
  .map((w) => w.replace(JOSA, ''))
  .filter((w) => w.length >= 3 && !STOP.has(w) && !VERB_END.test(w)))];

/**
 * @param {string} answer AI 답
 * @param {string} statText 통계 자료(건수·증감률·비중) 글. 여기 있는 숫자만 "건·%·→" 옆에 올 수 있다
 * @param {{number:string, company:string, fullText:string, field?:string}[]} evidence 근거 특허 (fullText = 명칭 + 초록 전체, field = 3차)
 */
export function checkSummary(answer, statText, evidence) {
  // 1. 숫자: "건", "%", "→" 옆 숫자는 통계 자료의 값이어야 한다. 그 밖의 숫자는 통계나 근거 특허 글에 있으면 된다
  const statNumbers = new Set(statText.match(/\d+/g) ?? []);
  ['3', '85'].forEach((n) => statNumbers.add(n)); // 형식("3줄")과 한계 문구("약 85%")
  const evidenceText = evidence.map((e) => `${e.fullText} ${e.date ?? ''}`).join(' '); // 근거 특허의 출원일도 인용될 수 있다
  const body = answer.replace(/\d{13}/g, ' ');
  const strangeNumbers = new Set();
  for (const m of body.matchAll(/(\d+(?:\.\d+)?)(\s*(?:%|건|→))?/g)) {
    const [, num, unit] = m;
    const before = body.slice(Math.max(0, m.index - 2), m.index);
    const isStat = Boolean(unit) || /→\s*$/.test(before);
    const ok = isStat ? statNumbers.has(num) : statNumbers.has(num) || evidenceText.includes(num);
    if (!ok) strangeNumbers.add(num + (unit ?? '').trim());
  }

  // 2. 출원번호: 목록에 있는지
  const byNumber = new Map(evidence.map((e) => [e.number, e]));
  const strangePatents = [...new Set(answer.match(/\d{13}/g) ?? [])].filter((n) => !byNumber.has(n));

  // 3. 특허 설명: 이 특허 글에는 없고 다른 근거 특허 글에만 있는 말, 회사 표기
  const mixups = [];
  const fieldWords = squeeze(evidence.map((x) => x.field ?? '').join(' ')); // 3차 이름(예: 시야각·투과 영역)은 AI가 분류로 적는 말
  const isForeignTo = (w, cited) => !cited.some((e) => squeeze(e.fullText).includes(squeeze(w)))
    && !fieldWords.includes(squeeze(w))
    && evidence.some((x) => !cited.includes(x) && squeeze(x.fullText).includes(squeeze(w)));
  for (const line of answer.split('\n')) {
    const cites = [...line.matchAll(/\d{13}/g)].filter((m) => byNumber.has(m[0]));
    // "자사 2건(A, B)은 …, 경쟁사 2건(C, D)은 …"처럼 번호를 괄호로 묶어 쓴 줄은 설명이 번호 앞뒤로 오가므로
    // 문장 단위로 본다: 문장에 인용한 특허들 어디에도 없고, 인용하지 않은 근거 특허에만 있는 말을 찾는다
    if (/\(\s*\d{13}\s*,\s*\d{13}/.test(line)) {
      for (const sentence of line.split(/(?<=[.。])\s+/)) {
        const cited = [...sentence.matchAll(/\d{13}/g)].map((m) => byNumber.get(m[0])).filter(Boolean);
        if (!cited.length) continue;
        const foreign = termsOf(sentence.replace(/\d{13}/g, ' ')).filter((w) => isForeignTo(w, cited));
        if (foreign.length) mixups.push(`${cited.map((e) => e.number).join(', ')}: 인용한 특허에 없고 다른 근거 특허에 있는 말: ${foreign.join(', ')}`);
      }
      continue;
    }
    cites.forEach((m, i) => {
      // 줄 앞(굵은 제목)에 번호 하나면 설명은 번호 뒤, 아니면 앞 인용 이후 ~ 이 번호 앞
      const claim = cites.length === 1 && m.index < 25
        ? line.slice(m.index + 13)
        : line.slice(i === 0 ? 0 : cites[i - 1].index + 13, m.index);
      const e = byNumber.get(m[0]);
      const foreign = termsOf(claim).filter((w) => isForeignTo(w, [e]));
      // 회사 표기: 설명 구간에 한쪽 회사만 나올 때만 본다 ("자사와 경쟁사 모두 …"는 비교 문장)
      const saysOwn = /자사|LG/.test(claim);
      const saysComp = /경쟁사|삼성/.test(claim);
      const wrongCompany = saysOwn !== saysComp
        && ((saysOwn && e.company.startsWith('경쟁사')) || (saysComp && e.company.startsWith('자사')));
      if (foreign.length || wrongCompany) {
        mixups.push(`${m[0]}: ${wrongCompany ? '회사 표기가 다름. ' : ''}${foreign.length ? `이 특허에 없고 다른 근거 특허에 있는 말: ${foreign.join(', ')}` : ''}`.trim());
      }
    });
  }
  // 4. 빠진 칸: 답이 잘렸거나 형식을 안 지킴
  const missingSections = SECTIONS.filter((h) => !answer.split('\n').some((l) => /^##/.test(l.trim()) && l.includes(h)));
  return { strangeNumbers: [...strangeNumbers], strangePatents, mixups, missingSections };
}
