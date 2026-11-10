// 분기 자동 요약을 지금 돌린다 (서버 스케줄러가 하는 일과 같음: src/autoSummary.js)
// 실행: npm run auto-summary --prefix backend           이번 분기에 빠진 범위만 만든다
//       npm run auto-summary --prefix backend -- --dry  만들 범위만 보여 주고 AI는 부르지 않는다
import { currentQuarter, autoScopes, pendingScopes, runQuarterlySummaries } from '../src/autoSummary.js';
import { scopeLabel } from '../src/trendSummary.js';
import { isAiConfigured } from '../src/ai.js';

const quarter = currentQuarter();
const todo = pendingScopes(quarter);
console.log(`${quarter.label}: 자동 요약 범위 ${autoScopes().length}개 중 아직 없는 것 ${todo.length}개`);
for (const s of todo) console.log(`  - ${scopeLabel(s)} (${s.from}~${s.to}년)`);

if (process.argv.includes('--dry')) process.exit(0);
if (!isAiConfigured()) {
  console.error('AI 설정이 없습니다. backend/.env 에 AI_BASE_URL, AI_API_KEY, AI_MODEL 을 넣어 주세요.');
  process.exit(1);
}
const r = await runQuarterlySummaries();
console.log(`끝: 새로 ${r.made}개, 실패 ${r.failed.length}개`);
if (r.failed.length) console.log(r.failed.map((f) => `  - ${f}`).join('\n'));
