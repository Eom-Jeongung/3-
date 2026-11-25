// 기존 운영 기록을 읽기만 한다. 모델 호출·요약 생성·DB 변경은 하지 않는다.
// 실행: npm run summary-quality --prefix backend -- 30
import Database from 'better-sqlite3';
import { summarizeQuality } from '../src/summaryQuality.js';

const days = Math.max(Number(process.argv[2]) || 30, 1);
const database = new Database(process.env.DB_PATH || './data/patents.db', { readonly: true, fileMustExist: true });
try {
  const rows = database.prepare(`
    SELECT model, criteria_version, checks FROM trend_summaries
    WHERE created_at >= datetime('now', ?) ORDER BY id
  `).all(`-${days} days`);
  console.log('자동 관찰 집계입니다. 수치 경고는 사실 오류 확정이 아닙니다. transformed는 출처가 남고 표현이 바뀐 경우, unknown은 출처 정보 부족입니다.');
  console.log(JSON.stringify({ days, ...summarizeQuality(rows) }, null, 2));
} finally {
  database.close();
}
