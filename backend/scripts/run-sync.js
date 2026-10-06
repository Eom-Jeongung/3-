// 수동 수집 실행: npm run sync  (캐시 무시하고 새로 받으려면 npm run sync -- --fresh)
import { runSync } from '../src/sync.js';
import { db } from '../src/db.js';

const useCache = !process.argv.includes('--fresh');
const result = await runSync({ source: 'manual', useCache, log: console.log });
console.log(`\n수집 ${result.fetched}건 / 변경 ${result.changed}건 / ${result.syncedAt}`);

const summary = db.prepare(`
  SELECT applicant_type, legal_status, COUNT(*) n,
         SUM(expiry_date BETWEEN date('now') AND date('now', '+6 months')) expiring
  FROM patents GROUP BY 1, 2 ORDER BY 1, 3 DESC
`).all();
console.table(summary);
