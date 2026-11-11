// DB 테이블 생성 (여러 번 실행해도 안전). 만든 테이블과 컬럼을 출력한다
import { db, initSchema } from '../src/db.js';

initSchema();
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
console.log('DB:', db.name);
for (const { name } of tables) {
  const cols = db.prepare(`PRAGMA table_info(${name})`).all().map((c) => c.name);
  console.log(`- ${name} (${cols.length}개 컬럼): ${cols.join(', ')}`);
}
