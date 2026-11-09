// AI 동향 요약을 명령으로 만든다 (화면의 "AI 요약 만들기" 버튼과 같은 기능: src/trendSummary.js)
// 실행: npm run summary-trial --prefix backend -- [1차=OLED] [2차=소자] [시작연도=2022] [끝연도=2024]
//   2차를 비우려면 "-" (예: -- LCD - 2015 2024)
// - 결과는 DB(trend_summaries)에 저장되어 대시보드에 바로 보이고, data/summary-trial.md 에도 남긴다
// - AI 설정은 .env의 AI_BASE_URL / AI_API_KEY / AI_MODEL (키 값은 출력하지 않는다)
import fs from 'node:fs';
import { generateTrendSummary, scopeLabel } from '../src/trendSummary.js';
import { isAiConfigured } from '../src/ai.js';

const arg = (v) => (v && v !== '-' ? v : '');
const [level1 = 'OLED', level2 = '소자', from = '2022', to = '2024'] = process.argv.slice(2);
const scope = { level1: arg(level1), level2: arg(level2), from: Number(from), to: Number(to) };
const OUT = new URL('../data/summary-trial.md', import.meta.url);

if (!isAiConfigured()) {
  console.error('AI 설정이 없습니다. backend/.env 에 AI_BASE_URL, AI_API_KEY, AI_MODEL 을 넣어 주세요.');
  process.exit(1);
}

console.log(`요약 대상: ${scopeLabel(scope)}, ${scope.from}~${scope.to}년`);
const s = await generateTrendSummary(scope);
const { strangeNumbers, strangePatents, mixups, unsupported = [], overreach = [], missingSections } = s.checks;
const list = (a) => (a.length ? a.join(' / ') : '없음');
const checkLines = [
  `- 자료에 없는 숫자: ${list(strangeNumbers)}`,
  `- 근거 목록에 없는 출원번호: ${list(strangePatents)}`,
  `- 다른 특허 내용이 섞였을 수 있는 인용: ${list(mixups)}`,
  `- 초록에 없는 효과: ${list(unsupported)}`,
  `- 과한 해석: ${list(overreach)}`,
  `- 빠진 칸(답이 잘렸을 수 있음): ${list(missingSections)}`,
];
fs.writeFileSync(OUT, [
  `# 동향 요약: ${scopeLabel(scope)}, ${scope.from}~${scope.to}년`,
  '',
  `- 분류 기준 ${s.criteria_version} · 모델 ${s.model} · ${s.created_at} (UTC) · ${(s.elapsed_ms / 1000).toFixed(1)}초`,
  ...checkLines,
  '',
  '---',
  '',
  s.content,
  '',
  '---',
  '',
  '## AI에게 준 자료',
  '',
  '```',
  s.facts,
  '```',
].join('\n'));
console.log(s.content);
console.log('\n---');
console.log(checkLines.join('\n'));
console.log(`저장: DB trend_summaries #${s.id} (대시보드에 표시) · backend/data/summary-trial.md`);
