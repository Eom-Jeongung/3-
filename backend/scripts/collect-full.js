// 전체 수집: 자사·경쟁사 전체 출원을 출원연도 구간별로 500건씩 받아 DB에 저장
// 실행: npm run collect  (호출 수만 미리 보려면 npm run collect -- --dry)
//
// - 받은 페이지는 data/kipris-cache에 저장 → 중간에 끊기거나 다시 실행해도 받은 페이지는 KIPRIS를 다시 부르지 않음 (이어받기)
// - 무료 한도(월 1,000회)를 넘지 않도록 MAX_CALLS에서 멈춘다
import { searchPatents, APPLICANTS } from '../src/kipris.js';
import { normalize, saveRows, logRun } from '../src/sync.js';

const PAGE_SIZE = 500; // KIPRIS 1회 최대
const MAX_CALLS = Number(process.env.COLLECT_MAX_CALLS) || 300;
const DELAY_MS = 300; // 공용 API라 연속 호출 사이에 잠깐 쉰다
const dryRun = process.argv.includes('--dry');

// 1970~1999는 한 구간, 2000년부터는 연도별 (구간이 작아야 끊겨도 다시 받을 양이 적음)
// 날짜 하한은 1970: 19000101은 KIPRIS가 INVALID_REQUEST_PARAMETER_ERROR로 거부함
function buckets(thisYear = new Date().getFullYear()) {
  const list = [{ name: '1970~1999', applicationDate: '19700101~19991231' }];
  for (let y = 2000; y <= thisYear; y++) list.push({ name: String(y), applicationDate: `${y}0101~${y}1231` });
  return list;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let calls = 0;

async function fetchPage(params) {
  if (calls >= MAX_CALLS) throw new Error(`호출 한도 ${MAX_CALLS}회에 도달해 멈춤 — 다시 실행하면 이어받습니다`);
  // 500건짜리 응답은 가끔 중간에 끊긴다 → 잠깐 쉬고 2번까지 다시 시도 (재시도도 호출 수에 포함)
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await searchPatents({ ...params, numOfRows: String(PAGE_SIZE) }, { useCache: true });
      if (!res.fromCache) { calls++; await sleep(DELAY_MS); }
      return res;
    } catch (err) {
      calls++;
      if (attempt >= 3 || calls >= MAX_CALLS) throw err;
      console.warn(`  재시도 ${attempt}/2 (${params.applicationDate} p${params.pageNo}): ${err.message}`);
      await sleep(3000 * attempt);
    }
  }
}

const syncedAt = new Date().toISOString();
const summary = [];
let totalSaved = 0;
let totalChanged = 0;

try {
  for (const [type, applicant] of Object.entries(APPLICANTS)) {
    for (const b of buckets()) {
      const params = { applicant, applicationDate: b.applicationDate, pageNo: '1' };
      const first = await fetchPage(params);
      const pages = Math.ceil(first.totalCount / PAGE_SIZE);
      if (dryRun) { summary.push({ 회사: type, 구간: b.name, 전체: first.totalCount, 페이지: pages }); continue; }

      const items = [...first.items];
      for (let p = 2; p <= pages; p++) items.push(...(await fetchPage({ ...params, pageNo: String(p) })).items);

      // 구간마다 바로 저장 → 중간에 멈춰도 여기까지는 DB에 남음
      const rows = items.map((it) => normalize(it, type, syncedAt));
      const changed = saveRows(rows, syncedAt);
      totalSaved += rows.length;
      totalChanged += changed;
      summary.push({ 회사: type, 구간: b.name, 전체: first.totalCount, 받음: items.length, 호출누계: calls });
      console.log(`[${type}] ${b.name}: ${items.length}/${first.totalCount}건 (실제 호출 누계 ${calls}회)`);
    }
  }
  if (!dryRun) logRun.run('manual', totalSaved, totalChanged, 'success');
} catch (err) {
  if (!dryRun) logRun.run('manual', totalSaved, totalChanged, `error: ${err.message}`);
  console.error(`\n중단: ${err.message}`);
  process.exitCode = 1;
} finally {
  console.table(summary);
  console.log(`실제 KIPRIS 호출 ${calls}회 / 저장 ${totalSaved}건 / 변경 ${totalChanged}건`);
}
