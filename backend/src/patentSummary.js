// 개별 특허 AI 요약: 특허 하나의 명칭·초록(+ 이미 받아 둔 대표 청구항)만 AI에게 주고 정해진 다섯 칸으로 요약한다
// - 청구항은 DB에 이미 있을 때만 쓴다. 요약 버튼이 KIPRIS를 부르지 않게 (청구항 불러오기 = KIPRIS 1회)
// - 한 번 만든 요약은 저장하고, "다시 만들기"를 누르면 새로 만든다 (이전 요약도 남는다)
// - 화면: PatentDetail.jsx의 "개별 요약" 칸, API: routes/patents.js의 /api/patents/:id/summary
import { db } from './db.js';
import { chat, isAiConfigured } from './ai.js';

const PATENT_SECTIONS = ['한 줄 요약', '해결하려는 문제', '핵심 해결 수단', '기존 기술과의 차이', '핵심 키워드'];
const MIN_ABSTRACT = 80; // 초록이 이보다 짧으면 요약할 내용이 부족하다
const EFFECT_WORDS = ['신뢰성', '내구성', '수명', '광효율', '발광 효율', '고해상도', '정밀', '화질', '시인성', '투과율', '소비전력', '생산성', '수율', '원가', '박형화', '휘도', '저전력'];

const SYSTEM_PROMPT = [
  '너는 디스플레이 특허를 읽기 쉽게 정리하는 분석가다. 한국어로 쓴다.',
  '규칙:',
  '- 아래 [특허]의 명칭·초록·대표 청구항에 있는 내용만 쓴다. 외부 지식, 회사 전략, 시장 이야기는 쓰지 않는다.',
  '- 초록에 없는 효과(신뢰성, 수명, 화질 향상 등)를 덧붙이지 않는다. 숫자는 [특허]에 있는 것만 쓴다.',
  '- 초록에 기존 기술과 비교한 내용이 없으면 "기존 기술과의 차이" 칸에는 "초록에 명시되지 않음"이라고만 쓴다.',
  '- 어려운 용어는 그대로 쓰되, 문장은 짧고 쉽게 쓴다. 전체 400자 안팎.',
  '- 형식은 아래 틀을 그대로 채운다.',
  '## 한 줄 요약',
  '(무엇을 어떻게 했는지 한 문장)',
  '## 해결하려는 문제',
  '(1~2문장)',
  '## 핵심 해결 수단',
  '- (구성이나 방법 1~3줄)',
  '## 기존 기술과의 차이',
  '(1~2문장 또는 "초록에 명시되지 않음")',
  '## 핵심 키워드',
  '(초록에 나온 기술 용어 3~5개를 쉼표로)',
].join('\n');

const getPatent = db.prepare('SELECT id, application_number, title, abstract FROM patents WHERE id = ?');
const firstClaim = db.prepare(`
  SELECT claim FROM patent_claims WHERE application_number = ? AND claim NOT GLOB '*[0-9]. 삭제*' ORDER BY seq LIMIT 1
`);

/** 요약에 쓸 입력. 초록이 너무 짧으면 null */
export function patentSummaryInput(id) {
  const p = getPatent.get(id);
  if (!p) return { patent: null };
  const abstract = (p.abstract ?? '').replace(/\s+/g, ' ').trim();
  const claim = firstClaim.get(p.application_number)?.claim?.replace(/\s+/g, ' ').trim().slice(0, 1500) ?? null;
  if (abstract.length < MIN_ABSTRACT) return { patent: p, input: null };
  const text = [`명칭: ${p.title}`, `초록: ${abstract}`, claim ? `대표 청구항: ${claim}` : ''].filter(Boolean).join('\n');
  return { patent: p, input: { text, usedClaim: Boolean(claim) } };
}

/** 검사: 원문에 없는 숫자, 원문에 없는 효과 말, 빠진 칸 */
function checkPatentSummary(answer, source) {
  const plain = source.replace(/\s+/g, '');
  const strangeNumbers = [...new Set((answer.match(/\d+(?:\.\d+)?/g) ?? []).filter((n) => !source.includes(n)))];
  const unsupported = EFFECT_WORDS.filter((w) => answer.includes(w) && !plain.includes(w.replace(/\s+/g, '')));
  const missingSections = PATENT_SECTIONS.filter((h) => !answer.split('\n').some((l) => /^##/.test(l.trim()) && l.includes(h)));
  return { strangeNumbers, unsupported, missingSections };
}

const parseRow = (r) => r && { ...r, checks: JSON.parse(r.checks) };

export function latestPatentSummary(id) {
  return parseRow(db.prepare('SELECT * FROM patent_summaries WHERE patent_id = ? ORDER BY id DESC LIMIT 1').get(id));
}

/** AI로 요약을 만들고 저장한다 */
export async function generatePatentSummary(id) {
  if (!isAiConfigured()) throw new Error('AI 설정(AI_BASE_URL, AI_MODEL)이 비어 있어요');
  const { patent, input } = patentSummaryInput(id);
  if (!patent) throw Object.assign(new Error('특허를 찾을 수 없어요'), { status: 404 });
  if (!input) throw Object.assign(new Error('초록이 없거나 너무 짧아서 요약할 내용이 부족해요'), { status: 422 });
  const started = Date.now();
  const content = await chat([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `[특허]\n${input.text}\n\n위 특허를 정해진 형식으로 요약해 줘.` },
  ], { maxTokens: 4000, purpose: 'patent-summary', timeoutMs: 180_000 });
  const checks = checkPatentSummary(content, input.text);
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO patent_summaries (patent_id, application_number, model, content, checks, used_claim, elapsed_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(patent.id, patent.application_number, (process.env.AI_MODEL ?? '').trim(), content, JSON.stringify(checks), input.usedClaim ? 1 : 0, Date.now() - started);
  return parseRow(db.prepare('SELECT * FROM patent_summaries WHERE id = ?').get(lastInsertRowid));
}
