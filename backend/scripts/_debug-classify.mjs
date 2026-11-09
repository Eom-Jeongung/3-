// 임시 디버그: node scripts/_debug-classify.mjs 출원번호...  (CLS_DEBUG=1 로 점수 출력)
import { db } from '../src/db.js';
import { loadCriteria, classifyPatent } from '../src/classification.js';
const criteria = loadCriteria();
for (const no of process.argv.slice(2)) {
  const p = db.prepare('SELECT title, abstract, ipc_codes FROM patents WHERE application_number = ?').get(no);
  console.error(`# ${no} ${p.title}\n  IPC ${p.ipc_codes}`);
  const { rows } = classifyPatent({ ipcCodes: p.ipc_codes.split('|').map((s) => s.trim()).filter(Boolean), title: p.title, abstract: p.abstract }, criteria);
  console.error(`  => ${rows[0].level2} / ${rows[0].level3} (${rows[0].basis})`);
}
