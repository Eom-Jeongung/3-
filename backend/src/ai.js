// AI 호출은 이 파일에만 둔다. .env의 설정값만 바꾸면 OpenRouter든 사내 서버든 그대로 동작한다
// 특정 회사 SDK나 전용 기능 없이 OpenAI 호환 /chat/completions만 쓴다
const TIMEOUT_MS = 60_000;

const config = () => ({
  baseUrl: (process.env.AI_BASE_URL ?? '').trim().replace(/\/+$/, ''),
  apiKey: (process.env.AI_API_KEY ?? '').trim(), // 사내 서버는 키 없이 쓸 수도 있다
  model: (process.env.AI_MODEL ?? '').trim(),
});

export function isAiConfigured() {
  const { baseUrl, model } = config();
  return Boolean(baseUrl && model);
}

/** @returns {Promise<string>} 모델이 돌려준 글 */
export async function chat(messages, { maxTokens = 800 } = {}) {
  const { baseUrl, apiKey, model } = config();
  if (!baseUrl || !model) throw new Error('AI 설정(AI_BASE_URL, AI_MODEL)이 비어 있습니다');

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(apiKey && { Authorization: `Bearer ${apiKey}` }) },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0 }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`AI 서버 응답 오류 (HTTP ${res.status})`);

  const body = await res.json();
  const text = body.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new Error('AI 서버가 빈 답변을 돌려줬습니다');
  return text.trim();
}
