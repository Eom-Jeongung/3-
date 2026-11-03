// 전체 재분류와 결과 점검: npm run classify
// classification/*.csv를 대응표에 넣고 전체 특허를 다시 분류한다 (KIPRIS 호출 없음)
import { db } from '../src/db.js';
import { classifyPatents, seedCriteria, CRITERIA_VERSION, UNCLASSIFIED } from '../src/classification.js';

const started = Date.now();
const seeded = seedCriteria();
const count = classifyPatents();
console.log(`기준 ${CRITERIA_VERSION}: IPC ${seeded.ipc}줄, 키워드 ${seeded.keywords}줄 / ${count.toLocaleString()}건 분류 (${((Date.now() - started) / 1000).toFixed(1)}초)\n`);

const v = { v: CRITERIA_VERSION };
const percent = (n) => `${((n / count) * 100).toFixed(1)}%`;
const withShare = (rows) => rows.map((r) => ({ ...r, 비중: percent(r.건수) }));

console.log('1차별');
console.table(withShare(db.prepare(`SELECT level1 "1차", COUNT(*) 건수 FROM classification WHERE is_primary = 1 AND criteria_version = @v GROUP BY 1 ORDER BY 2 DESC`).all(v)));

console.log('2차별 (주분류)');
console.table(withShare(db.prepare(`SELECT level2 "2차", COUNT(*) 건수 FROM classification WHERE is_primary = 1 AND criteria_version = @v GROUP BY 1 ORDER BY 2 DESC`).all(v)));

console.log('근거별');
console.table(withShare(db.prepare(`SELECT basis 근거, COUNT(*) 건수 FROM classification WHERE is_primary = 1 AND criteria_version = @v GROUP BY 1 ORDER BY 2 DESC`).all(v)));

console.log('3차별 (주분류)');
console.table(withShare(db.prepare(`SELECT level2 "2차", level3 "3차", COUNT(*) 건수 FROM classification WHERE is_primary = 1 AND criteria_version = @v AND level3 IS NOT NULL GROUP BY 1, 2 ORDER BY 1, 3 DESC`).all(v)));

console.log(`미분류 특허의 첫 IPC 상위 (대응표에 추가할 후보)`);
console.table(db.prepare(`
  SELECT substr(i.ipc_code, 1, instr(i.ipc_code, '/') - 1) "IPC 그룹", COUNT(*) 건수
  FROM classification c JOIN patent_ipc i ON i.application_number = c.application_number AND i.seq = 1
  WHERE c.is_primary = 1 AND c.criteria_version = @v AND c.level2 = '${UNCLASSIFIED}'
  GROUP BY 1 ORDER BY 2 DESC LIMIT 20
`).all(v));

console.log('키워드로 2차를 정한 특허의 첫 IPC 상위 (대응표에 없거나 여러 2차에 걸린 코드)');
console.table(db.prepare(`
  SELECT substr(i.ipc_code, 1, instr(i.ipc_code, '/') - 1) "IPC 그룹", COUNT(*) 건수
  FROM classification c JOIN patent_ipc i ON i.application_number = c.application_number AND i.seq = 1
  WHERE c.is_primary = 1 AND c.criteria_version = @v AND c.basis = '키워드'
  GROUP BY 1 ORDER BY 2 DESC LIMIT 15
`).all(v));
