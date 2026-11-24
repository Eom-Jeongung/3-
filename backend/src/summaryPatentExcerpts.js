import { MAX_NOTABLE_PATENTS, MAX_SUMMARY_LENGTH } from './summaryCheck.js';

const sentenceSegmenter = new Intl.Segmenter('ko', { granularity: 'sentence' });
const heading = '## 주목 특허';
const noSelection = '- 선정할 원문 문장 없음';

// 300자로 자른 통계용 초록과 달리, 발췌 후보는 원본 초록에서 문장 단위로 준비한다.
export function patentExcerptSentences(abstract) {
  const text = (abstract ?? '').replace(/\s+/g, ' ').trim();
  return [...new Set([...sentenceSegmenter.segment(text)].map(({ segment }) => segment.trim())
    .filter((sentence) => sentence.length <= MAX_SUMMARY_LENGTH
      && /[.!?。！？][」”"')\]]*$/.test(sentence) && !/(?:\.{2,}|…)[」”"')\]]*$/.test(sentence)))];
}

export function renderPatentExcerpts(selection, evidence, budget) {
  const byNumber = new Map(evidence.map((item) => [item.number, item]));
  const seen = new Set();
  const lines = [heading];
  const warnings = [];
  let length = heading.length;
  let omittedForLength = false;
  for (const raw of selection.split('\n').slice(1)) {
    const line = raw.trim();
    if (!line || line === noSelection) continue;
    const match = line.match(/^-\s+(\d{13})\s*\|\s*([1-9]\d*)$/);
    const item = match && byNumber.get(match[1]);
    const sentence = item?.excerptSentences?.[Number(match[2]) - 1];
    if (!sentence || seen.has(item.number)) {
      warnings.push('주목 특허의 출원번호 또는 원문 문장 번호가 근거 후보와 맞지 않거나 중복됩니다.');
      continue;
    }
    seen.add(item.number);
    if (lines.length > MAX_NOTABLE_PATENTS) break;
    const excerpt = `- ${item.number} (${item.company}): 원문 발췌: 「${sentence}」`;
    if (length + 1 + excerpt.length > budget) {
      omittedForLength = true;
      continue;
    }
    lines.push(excerpt);
    length += 1 + excerpt.length;
  }
  if (lines.length === 1) {
    const fallback = omittedForLength ? '- 분량 한도 안에 담을 수 있는 원문 발췌가 없습니다.'
      : evidence.length ? '- 표시할 수 있는 원문 발췌를 확인하지 못했습니다.'
        : '- 제공된 근거 후보 특허가 없습니다.';
    if (length + 1 + fallback.length <= budget) lines.push(fallback);
  }
  return { content: lines.join('\n'), warnings };
}
