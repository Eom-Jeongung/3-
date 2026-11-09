// 전체 재분류와 결과 점검: npm run classify
// classification/*.csv를 대응표에 넣고 전체 특허를 다시 분류한다 (KIPRIS 호출 없음)
import fs from 'node:fs';
import { db } from '../src/db.js';
import { classifyPatents, seedCriteria, CRITERIA_VERSION, UNCLASSIFIED } from '../src/classification.js';

const started = Date.now();
const seeded = seedCriteria();
const count = classifyPatents();
console.log(`기준 ${CRITERIA_VERSION}: IPC ${seeded.ipc}줄, 키워드 ${seeded.keywords}줄, 응용 태그 ${seeded.tags}줄 / ${count.toLocaleString()}건 분류 (${((Date.now() - started) / 1000).toFixed(1)}초)\n`);

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

console.log('응용 태그 (한 특허에 여러 개 가능, 비중은 전체 특허 대비)');
console.table(withShare(db.prepare(`SELECT tag 태그, COUNT(*) 건수 FROM application_tags WHERE criteria_version = @v GROUP BY 1 ORDER BY 2 DESC`).all(v)));

// 정답 세트 채점: classification/gold_set.csv (사람이 확인한 특허. 정답이 여럿이면 '|'로 구분)
// 규칙을 바꿀 때마다 이 점수가 떨어지지 않았는지 본다
const goldPath = new URL('../classification/gold_set.csv', import.meta.url);
if (fs.existsSync(goldPath)) {
  const [header, ...lines] = fs.readFileSync(goldPath, 'utf8').trim().split(/\r?\n/);
  const keys = header.split(',');
  const gold = lines.map((l) => Object.fromEntries(l.split(',').map((c, i) => [keys[i], c.trim()])));
  const resultOf = db.prepare('SELECT level2, level3 FROM classification WHERE application_number = ? AND +criteria_version = @v AND is_primary = 1');
  let ok2 = 0;
  let ok3 = 0;
  let has3 = 0;
  const misses = [];
  for (const g of gold) {
    const r = resultOf.get(g.application_number, v);
    if (!r) continue;
    const hit2 = g.level2.split('|').includes(r.level2);
    if (hit2) ok2++;
    if (g.level3) {
      has3++;
      if (hit2 && g.level3.split('|').includes(r.level3)) ok3++;
    }
    if (!hit2) misses.push({ 출원번호: g.application_number, 정답: g.level2, 결과: `${r.level2} / ${r.level3}`, 메모: g.note });
  }
  console.log(`\n정답 세트 채점 (${gold.length}건): 2차 ${ok2}/${gold.length} (${Math.round((ok2 / gold.length) * 100)}%), 3차 ${ok3}/${has3}`);
  if (misses.length) console.table(misses);
}
