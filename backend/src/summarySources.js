const segmenter = new Intl.Segmenter('ko', { granularity: 'sentence' });
export const summaryBody = (text) => text.trim().replace(/^[-*]\s+/, '').replace(/\[(?:주의|확인 필요|숫자 다름|다른 언어)\]\s*/g, '');
export const canonicalSummaryBody = (text) => summaryBody(text).replace(/\s+/g, ' ');

/** 제목을 바꾸거나 중복 제목을 출력해도, 실제 조립과 기록이 동일한 첫 섹션을 선택한다. */
export function summarySourceSections(text, request = 0) {
  const sections = [];
  let offset = 0;
  for (const chunk of text.split(/(?=^[ \t]*#{1,6}(?:[ \t]|$))/m)) {
    const trimmed = chunk.trim();
    const start = offset + (trimmed ? chunk.indexOf(trimmed) : 0);
    offset += chunk.length;
    const title = trimmed.split('\n', 1)[0].match(/^##[ \t]+(.+?)\s*$/)?.[1];
    if (!title) continue;
    const section = title === '핵심 흐름 (3줄)' ? '핵심 흐름' : title;
    const sectionNumber = sections.length + 1;
    const firstLine = text.slice(0, start).split('\n').length;
    const lines = trimmed.split('\n').map((line, index) => {
      const lineId = `p${request}:h${sectionNumber}:l${firstLine + index}`;
      const sentences = index === 0 ? [] : [...segmenter.segment(summaryBody(line))].map(({ segment, index: start }, sentence) => ({
        id: `${lineId}:s${sentence + 1}`, request, section, sectionNumber,
        line: firstLine + index, sentence: sentence + 1, lineId, start, end: start + segment.length, text: segment.trim(),
      })).filter(({ text }) => text);
      return { lineId, request, section, sectionNumber, line: firstLine + index, text: line, sentences };
    });
    sections.push({ section, sectionNumber, text: trimmed, lines });
  }
  return sections;
}

export function readSummarySections(text) {
  const sections = new Map();
  for (const item of summarySourceSections(text)) if (!sections.has(item.section)) sections.set(item.section, item.text);
  return sections;
}

export function composeSummaryParts(parts, tasks) {
  const sections = new Map();
  const origins = new Map();
  const requests = parts.map((text, index) => summarySourceSections(text, index + 1));
  tasks.forEach((names, index) => names.forEach((name) => {
    const selected = requests[index]?.find(({ section }) => section === name);
    if (selected) { sections.set(name, selected.text); origins.set(name, selected.lines); }
  }));
  return { sections, origins, requests, content: [...sections.values()].join('\n') };
}

// 원문 탐색은 출처를 결정하는 데 쓰지 않는다. 확정된 출처의 문장이 얼마나 보존됐는지만 판정한다.
export function retainedSummarySources(content, origins) {
  return content.split('\n').flatMap((text, index) => origins[index] ? [{ ...origins[index], text }] : []);
}

/** 인용문·특허 설명은 통계 주체나 운영 규칙의 지표로 해석하지 않는다. */
export function statisticPart(text) {
  return text.split('|', 1)[0].replace(/「[^」]*」/g, (quote) => ' '.repeat(quote.length));
}
