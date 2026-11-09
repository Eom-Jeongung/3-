// AI 호출은 이 파일에만 둔다. .env의 설정값만 바꾸면 OpenRouter든 사내 서버든 그대로 동작한다
// 특정 회사 SDK나 전용 기능 없이 OpenAI 호환 /chat/completions만 쓴다
import { db } from './db.js';

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

const insertCall = db.prepare(`
  INSERT INTO ai_calls (purpose, host, model, prompt_tokens, completion_tokens, elapsed_ms, error)
  VALUES (@purpose, @host, @model, @prompt_tokens, @completion_tokens, @elapsed_ms, @error)
`);

const hostOf = (url) => {
  try { return new URL(url).host; } catch { return null; }
};

// 기록이 실패해도 AI 답변은 그대로 돌려준다
function logCall(row) {
  try {
    insertCall.run(row);
  } catch (err) {
    console.error(`AI 호출 기록 실패: ${err.message}`);
  }
}

/**
 * @param {string} purpose 무엇에 쓴 호출인지 (ai_calls 기록용, 예: 'ask-plan')
 * @returns {Promise<string>} 모델이 돌려준 글
 */
export async function chat(messages, { maxTokens = 800, purpose = 'etc', timeoutMs = TIMEOUT_MS } = {}) {
  const { baseUrl, apiKey, model } = config();
  if (!baseUrl || !model) throw new Error('AI 설정(AI_BASE_URL, AI_MODEL)이 비어 있습니다');

  const started = Date.now();
  let usage;
  let error = null;
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(apiKey && { Authorization: `Bearer ${apiKey}` }) },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0 }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`AI 서버 응답 오류 (HTTP ${res.status})`);

    const body = await res.json();
    usage = body.usage;
    const text = body.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) throw new Error('AI 서버가 빈 답변을 돌려줬습니다');
    return text.trim();
  } catch (err) {
    error = err.message;
    throw err;
  } finally {
    logCall({
      purpose,
      host: hostOf(baseUrl),
      model,
      prompt_tokens: Number.isInteger(usage?.prompt_tokens) ? usage.prompt_tokens : null,
      completion_tokens: Number.isInteger(usage?.completion_tokens) ? usage.completion_tokens : null,
      elapsed_ms: Date.now() - started,
      error,
    });
  }
}
