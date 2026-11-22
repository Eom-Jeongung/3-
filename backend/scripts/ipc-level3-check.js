// IPC 3차 힌트 규칙별 정확도 점검: npm run ipc-check
// 3차는 키워드 → (없으면) IPC 힌트 → 기타 순서로 정한다. IPC 힌트가 얼마나 맞는지 사람 손 없이 어림한다
// - 키워드로도 3차가 나오는 특허에서, 같은 특허의 IPC 힌트가 키워드 3차와 같은 비율(일치율)을 규칙별로 센다
// - 키워드 3차를 정답에 가깝다고 보는 어림값이다. 키워드가 없는 특허(실제로 IPC로 정해지는 특허)는 성격이 다를 수 있다
// - 정답 세트(gold_set.csv)에 있는 특허는 실제 3차와도 비교한다
// - 주의: 이 일치율은 실제보다 높게 나온다. 2026-11-21 규칙별 표본 290건을 직접 채점해 보니, 일치율 70% 이상이던 규칙도
//   실제로 IPC로 정해지는 특허(키워드가 없는 특허)에서는 15~70%만 맞은 경우가 많았다
// - 그래서 남길 규칙은 표본 채점(classification/ipc_level3_validation.csv, 75% 이상)으로 정한다. 이 스크립트는 후보를 찾는 데만 쓴다
import fs from 'node:fs';
import { db } from '../src/db.js';
import { classifyPatent, loadCriteria, CRITERIA_VERSION } from '../src/classification.js';

const MIN_SAMPLE = Number(process.env.MIN_SAMPLE ?? 30); // 이보다 적으면 일치율을 믿기 어려워 "표본 부족"
const KEEP_RATE = Number(process.env.KEEP_RATE ?? 0.7); // 이 이상이면 남긴다

const criteria = loadCriteria(CRITERIA_VERSION);
const claimsOf = new Map();
for (const c of db.prepare('SELECT application_number, claim FROM patent_claims ORDER BY application_number, seq').all()) {
  if (!claimsOf.has(c.application_number)) claimsOf.set(c.application_number, []);
  claimsOf.get(c.application_number).push(c.claim);
}
const gold = new Map();
const goldFile = new URL('../classification/gold_set.csv', import.meta.url);
for (const line of fs.readFileSync(goldFile, 'utf8').trim().split(/\r?\n/).slice(1)) {
  const [number, level2, level3] = line.split(',');
  if (level3) gold.set(number, { level2, level3 });
}

const rules = new Map(); // "IPC → 3차" → { compared, agreed, used, goldCompared, goldAgreed, examples }
const ruleOf = (prefix, level3) => {
  const key = `${prefix} → ${level3}`;
  if (!rules.has(key)) rules.set(key, { prefix, level3, compared: 0, agreed: 0, used: 0, goldCompared: 0, goldAgreed: 0, misses: new Map() });
  return rules.get(key);
};

let total = 0;
for (const p of db.prepare('SELECT application_number, title, abstract, ipc_codes FROM patents').iterate()) {
  const ipcCodes = (p.ipc_codes ?? '').split('|').map((c) => c.trim()).filter(Boolean);
  const { level3Check: c } = classifyPatent({ ipcCodes, title: p.title, abstract: p.abstract, claims: claimsOf.get(p.application_number) }, criteria);
  total++;
  if (!c?.prefix) continue;
  const r = ruleOf(c.prefix, c.ipc);
  if (c.keyword) {
    r.compared++;
    if (c.keyword === c.ipc) r.agreed++;
    else r.misses.set(c.keyword, (r.misses.get(c.keyword) ?? 0) + 1);
  } else {
    r.used++;
  }
  const g = gold.get(p.application_number);
  if (g && g.level2 === c.level2) { r.goldCompared++; if (g.level3 === c.ipc) r.goldAgreed++; }
}

const rows = [...rules.values()].map((r) => {
  const rate = r.compared ? r.agreed / r.compared : null;
  const verdict = r.compared < MIN_SAMPLE ? '표본 부족' : rate >= KEEP_RATE ? '남김' : '뺌';
  const topMiss = [...r.misses].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, n]) => `${k} ${n}`).join(', ');
  return {
    규칙: `${r.prefix} → ${r.level3}`,
    비교: r.compared,
    일치율: rate === null ? '-' : `${Math.round(rate * 100)}%`,
    'IPC로 정해진 특허': r.used,
    정답세트: r.goldCompared ? `${r.goldAgreed}/${r.goldCompared}` : '-',
    판정: verdict,
    '키워드는 주로': topMiss,
  };
}).sort((a, b) => b['IPC로 정해진 특허'] - a['IPC로 정해진 특허']);

console.log(`기준 ${CRITERIA_VERSION}, 특허 ${total.toLocaleString()}건, 남김 기준: 비교 ${MIN_SAMPLE}건 이상 & 일치율 ${KEEP_RATE * 100}% 이상\n`);
console.table(rows);
const sum = (v) => rows.filter((r) => r.판정 === v).reduce((n, r) => n + r['IPC로 정해진 특허'], 0);
console.log(`IPC로 3차가 정해진 특허: 남김 ${sum('남김').toLocaleString()}건 · 뺌 ${sum('뺌').toLocaleString()}건 · 표본 부족 ${sum('표본 부족').toLocaleString()}건`);
if (process.argv.includes('--json')) fs.writeFileSync('ipc-level3-check.json', JSON.stringify(rows, null, 2));
