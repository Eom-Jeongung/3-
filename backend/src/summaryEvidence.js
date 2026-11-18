import { checkStatistics } from './summaryStatCheck.js';

// AI 요약의 줄마다 근거를 확인해 표시를 붙인다. 원문은 지우지 않는다 (맞는 내용까지 사라지지 않게)
// - 통계와 다른 숫자가 있으면 "[숫자 다름]", 확인하지 못한 문장은 "[확인 필요]", 한자·일본 글자가 섞이면 "[다른 언어]"
// - 주목 특허는 근거 목록의 출원번호 하나와 맞으면 실제 명칭·선정 이유로 바꿔 쓴다
// - 해석은 "회사 분야 연도 건수 | 출원번호 | 「원문」" 형식이고 통계·특허 원문이 맞을 때만 확인된 해석으로 정리한다
//   이것은 추적 가능성 확인이지, 해석의 인과관계를 증명하는 것은 아니다
export const FLAGS = { mismatch: '숫자 다름', unverified: '확인 필요', foreign: '다른 언어' };
const FOREIGN = /[぀-ヿ㐀-鿿]/; // 일본 글자, 한자

export function groundInterpretations(content, evidence, stats) {
  const byNumber = new Map(evidence.map((e) => [e.number, e]));
  const warnings = [];
  const foreignText = [];
  const mark = (flag, text) => `- [${FLAGS[flag]}] ${text}`;
  let section = '';
  const lines = content.split('\n').map((line) => {
    if (/^\s*##/.test(line)) { section = line; return line; }
    if (!line.trim()) return line;
    const body = line.replace(/^\s*[-*]\s*/, '').trim();
    const foreign = FOREIGN.test(body);
    if (foreign) foreignText.push(body);
    if (/한계/.test(section)) return foreign ? mark('foreign', body) : line;

    if (!/^(?:\*\*)?해석\s*:/.test(body)) {
      if (/주목 특허/.test(section)) {
        const citations = body.match(/\d{13}/g) ?? [];
        const item = citations.length === 1 ? byNumber.get(citations[0]) : null;
        if (item) return `- ${item.number} (${item.company}): ${item.title} (${item.reason})`;
        warnings.push(`근거 목록의 특허 하나와 연결하지 못한 주목 특허: ${body}`);
        return mark(foreign ? 'foreign' : 'unverified', body);
      }
      const check = checkStatistics(body, stats);
      if (check.statMismatches.length) { warnings.push(`자료와 다른 숫자: ${body}`); return mark('mismatch', body); }
      if (foreign) { warnings.push(`한국어가 아닌 글자가 섞인 문장: ${body}`); return mark('foreign', body); }
      const hasNumber = /\d\s*(?:건|%)|\d\s*(?:→|->)\s*\d/.test(body);
      if (!hasNumber || check.statUnverified.length) { warnings.push(`통계로 확인하지 못한 문장: ${body}`); return mark('unverified', body); }
      return `- ${body}`;
    }

    // AI가 스스로 근거 부족이라고 쓴 해석은 그대로 둔다
    if (/^(?:\*\*)?해석\s*:\s*판단 근거 부족\s*$/.test(body)) return `- ${body}`;
    const match = body.match(/^(?:\*\*)?해석\s*:\s*(.+?)\s*\|\s*(\d{13})\s*\|\s*「([^」]+)」\s*$/);
    if (match) {
      const [, stat, number, quote] = match;
      const item = byNumber.get(number);
      const verify = checkStatistics(stat, stats);
      const fields = stats.fields.filter((f) => f !== '전체' && stat.includes(f));
      const companyMatches = item && ({ own: /자사|LG/i, competitor: /삼성|(?<!중국\s)경쟁사/, china: /중국|BOE|CSOT|Tianma|Visionox/i }[item.companyKey]?.test(stat));
      const fieldMatches = item && (stats.fields.length === 1 && stats.fields[0] === '전체' || fields.length === 1 && fields[0] === item.field);
      const canonical = stat.match(/^(자사|LG디스플레이|삼성|삼성디스플레이|중국|중국 4사)\s+(.+?)\s+(\d{4})년\s+([\d,]+)건$/);
      const source = item ? `${item.title} ${item.abstract}` : '';
      const quoted = quote.trim();
      const group = stats.fields.length === 1 && stats.fields[0] === '전체' ? '전체' : item?.field;
      const samples = stats.values.filter((v) => v.company === item?.companyKey && v.field === group && v.metric === 'count');
      const tooSmall = stats.minimumSample != null && (!samples.length || samples.some((v) => v.value < stats.minimumSample));
      if (verify.statMismatches.length) { warnings.push(`해석의 통계가 자료와 다름: ${body}`); return mark('mismatch', body); }
      if (item && canonical && canonical[2] === item.field && companyMatches && fieldMatches && !tooSmall
        && !verify.statUnverified.length && quoted.length >= 6 && source.includes(quoted) && !foreign) {
        return `- 해석: ${stat} · 특허(${number}) 원문: 「${quoted}」`;
      }
    }
    warnings.push(`통계·특허 원문과 연결하지 못한 해석: ${body}`);
    return mark(foreign ? 'foreign' : 'unverified', body);
  });
  return { content: lines.join('\n'), warnings, foreignText };
}
