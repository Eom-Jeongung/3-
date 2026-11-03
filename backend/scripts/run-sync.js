// 새로고침(증분 수집) 실행: npm run sync — 화면의 새로고침 버튼과 같은 동작
// DB가 비어 있으면 먼저 npm run collect로 전체 수집을 해야 한다
import { runSync } from '../src/sync.js';
import { db } from '../src/db.js';

const result = await runSync({ source: 'manual', log: console.log });
console.log(`\n새 특허 ${result.added}건 / 받은 ${result.fetched}건 중 변경 ${result.changed}건 / KIPRIS 호출 ${result.calls}회 / ${result.syncedAt}`);

const summary = db.prepare('SELECT applicant_type, legal_status, COUNT(*) n FROM patents GROUP BY 1, 2 ORDER BY 1, 3 DESC').all();
console.table(summary);
