// AI 사용량 보기: 최근 30일 날짜별·용도별 호출 수, 실패 수, 토큰 수
// 실행: npm run ai-usage --prefix backend   (다른 기간: npm run ai-usage --prefix backend -- 7)
import { db } from '../src/db.js';

const days = Math.max(Number(process.argv[2]) || 30, 1);
const since = `-${days} days`;

const byDay = db.prepare(`
  SELECT date(called_at, '+9 hours') day, purpose, model,
         COUNT(*) calls, SUM(error IS NOT NULL) failed,
         COALESCE(SUM(prompt_tokens), 0) prompt_tokens, COALESCE(SUM(completion_tokens), 0) completion_tokens
  FROM ai_calls WHERE called_at >= datetime('now', ?)
  GROUP BY day, purpose, model ORDER BY day DESC, purpose
`).all(since);

const total = db.prepare(`
  SELECT COUNT(*) calls, SUM(error IS NOT NULL) failed,
         COALESCE(SUM(prompt_tokens), 0) prompt_tokens, COALESCE(SUM(completion_tokens), 0) completion_tokens
  FROM ai_calls WHERE called_at >= datetime('now', ?)
`).get(since);

console.log(`최근 ${days}일 AI 사용량 (날짜는 한국 시간)\n`);
if (!byDay.length) {
  console.log('기록이 없어요.');
} else {
  console.table(byDay.map((r) => ({
    날짜: r.day, 용도: r.purpose, 모델: r.model, 호출: r.calls, 실패: r.failed,
    입력토큰: r.prompt_tokens, 출력토큰: r.completion_tokens,
  })));
}
console.log(`합계: 호출 ${total.calls}회 (실패 ${total.failed ?? 0}회), 입력 토큰 ${total.prompt_tokens.toLocaleString('ko-KR')}, 출력 토큰 ${total.completion_tokens.toLocaleString('ko-KR')}`);
console.log('\n비용은 OpenRouter 사이트의 Activity 화면에서 확인하세요. 토큰 수 × 모델 가격으로 어림할 수도 있어요.');
