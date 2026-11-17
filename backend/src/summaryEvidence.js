import { checkStatistics } from './summaryStatCheck.js';

// Only display an interpretation as a statistical fact plus a verbatim patent
// excerpt. This is traceability, not proof of semantic entailment or causality.
export function groundInterpretations(content, evidence, stats) {
  const byNumber = new Map(evidence.map((e) => [e.number, e]));
  const warnings = [];
  let section = '';
  const lines = content.split('\n').map((line) => {
    if (/^\s*##/.test(line)) { section = line; return line; }
    if (!line.trim() || /한계/.test(section)) return line;
    if (!/^\s*[-*]?\s*(?:\*\*)?해석\s*:/.test(line)) {
      if (/주목 특허/.test(section)) {
        const citations = line.match(/\d{13}/g) ?? [];
        const item = citations.length === 1 ? byNumber.get(citations[0]) : null;
        if (item) return `- ${item.number} (${item.company}): ${item.title} (${item.reason})`;
      } else {
        const fact = line.replace(/^\s*[-*]\s*/, '').trim();
        const validForm = /^(자사|LG디스플레이|삼성|삼성디스플레이|중국|중국 4사)\s+.+?\s+\d{4}년\s+[\d,]+건$/.test(fact);
        const check = checkStatistics(fact, stats);
        if (validForm && !check.statMismatches.length && !check.statUnverified.length) return `- ${fact}`;
      }
      warnings.push('검증할 수 없는 기술 설명 또는 통계 문장을 표시하지 않았습니다.');
      return '- 판단 근거 부족';
    }
    const match = line.match(/^\s*[-*]?\s*(?:\*\*)?해석\s*:\s*(.+?)\s*\|\s*(\d{13})\s*\|\s*「([^」]+)」\s*$/);
    const fallback = '- 해석: 판단 근거 부족';
    if (!match) { warnings.push('해석의 통계·특허 번호·원문 인용이 없거나 형식이 맞지 않습니다.'); return fallback; }
    const [, stat, number, quote] = match;
    const item = byNumber.get(number);
    const verify = checkStatistics(stat, stats);
    const fields = stats.fields.filter((f) => f !== '전체' && stat.includes(f));
    const companyMatches = item && ({ own: /자사|LG/i, competitor: /삼성|(?<!중국\s)경쟁사/, china: /중국|BOE|CSOT|Tianma|Visionox/i }[item.companyKey]?.test(stat));
    const fieldMatches = item && (stats.fields.length === 1 && stats.fields[0] === '전체' || fields.length === 1 && fields[0] === item.field);
    // Accept only a bare company/field/year/count fact: no unverified prose can
    // be smuggled into the displayed interpretation alongside a real quote.
    const canonical = stat.match(/^(자사|LG디스플레이|삼성|삼성디스플레이|중국|중국 4사)\s+(.+?)\s+(\d{4})년\s+([\d,]+)건$/);
    const source = item ? `${item.title} ${item.abstract}` : '';
    const quoted = quote.trim();
    const group = stats.fields.length === 1 && stats.fields[0] === '전체' ? '전체' : item?.field;
    const samples = stats.values.filter((v) => v.company === item?.companyKey && v.field === group && v.metric === 'count');
    const tooSmall = stats.minimumSample != null && (!samples.length || samples.some((v) => v.value < stats.minimumSample));
    if (!item || !canonical || canonical[2] !== item.field || !companyMatches || !fieldMatches || tooSmall || verify.statMismatches.length || verify.statUnverified.length || quoted.length < 6 || !source.includes(quoted)) {
      warnings.push('해석에 연결된 통계·회사·분야·특허 원문을 확인하지 못했습니다.');
      return fallback;
    }
    return `- 해석: ${stat} · 특허(${number}) 원문: 「${quoted}」`;
  });
  return { content: lines.join('\n'), warnings };
}
