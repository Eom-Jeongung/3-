import { verifiedStatisticSubject } from './summaryStatCheck.js';

const COMPANY_NAMES = { own: 'LG디스플레이', competitor: '삼성디스플레이', china: '중국 경쟁사' };
const SOURCE_SECTIONS = ['핵심 메시지', '핵심 흐름', '성장 분야', '경쟁사 동향'];

export function buildSummaryInsights(sections, stats, sourceRows = new Map()) {
  const candidates = new Map();
  for (const title of SOURCE_SECTIONS) {
    for (const [index, line] of (sections.get(title) ?? '').split('\n').entries()) {
      if (!/^\s*[-*]\s+/.test(line)) continue;
      const subject = verifiedStatisticSubject(line, stats);
      if (!subject?.hasActivity) continue;
      const key = subject.company ? `company:${subject.company}` : `field:${subject.field}`;
      const previous = candidates.get(key);
      // 회사는 한 번만 쓰고, 뒤에서 확인한 회사·분야 쌍이 회사 단독보다 구체적이면 교체한다.
      const source = sourceRows.get(title)?.[index];
      const origin = source ? { lineId: source.lineId, request: source.request, section: source.section, line: source.line,
        sentenceIds: source.sentences.map(({ id }) => id) } : null;
      if (!previous || (!previous.field && subject.field)) candidates.set(key, { ...subject, sourceLine: line, origin });
    }
  }
  const pairedFields = new Set([...candidates.values()].filter(({ company }) => company).map(({ field }) => field));
  const selected = [...candidates.values()].filter(({ company, field }) => company || !pairedFields.has(field)).slice(0, 2);
  const counts = { pair: 0, company: 0, field: 0, insufficient: Number(!selected.length) };
  // 템플릿에는 검토 동작만 둔다. 정식 이름 외 수치나 추세 판단을 추가하지 않는다.
  const lines = selected.map(({ company, field }) => {
    if (company && field) {
      counts.pair++;
      return `- 확인해 볼 점: ${COMPANY_NAMES[company]}의 ${field} 출원을 살펴본다.`;
    }
    if (company) {
      counts.company++;
      return `- 확인해 볼 점: ${COMPANY_NAMES[company]}의 주요 출원 동향을 살펴본다.`;
    }
    counts.field++;
    return `- 확인해 볼 점: ${field} 분야의 출원을 살펴본다.`;
  });
  if (!lines.length) lines.push('- 확인해 볼 점: 추가로 살펴볼 주제를 고를 자료가 부족하다.');
  return { text: ['## 시사점', ...lines].join('\n'), counts,
    sources: selected.map(({ company, field, sourceLine, origin }) => ({ company, field, sourceLine, origin })) };
}
