// 중국 경쟁사 전체 수집: BOE·CSOT·Tianma·Visionox 출원을 회사마다 500건씩 받아 DB에 저장 (applicant_type 'china')
// 실행: npm run collect-china --prefix backend   (건수·호출 수만 보려면 -- --dry)
//
// - LG·삼성 수집(collect-full.js)은 출원연도별로 나눠 부르지만, 중국 회사는 건수가 적어(회사당 1천 건 안팎)
//   나누지 않고 한 번에 받는다 → 회사당 2회 정도
// - 출원인 이름이 일부만 맞아도 검색되므로, CHINA_APPLICANTS의 match에 맞는 출원인만 저장한다
// - 받은 페이지는 data/kipris-cache에 남아 다시 실행해도 KIPRIS를 다시 부르지 않는다
import { searchPatents, CHINA_APPLICANTS } from '../src/kipris.js';
import { normalize, saveRows, logRun } from '../src/sync.js';
import { classifyPatents, hasCriteria } from '../src/classification.js';

const PAGE_SIZE = 500;
const MAX_CALLS = 30;
const dryRun = process.argv.includes('--dry');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let calls = 0;

async function fetchPage(params) {
  for (let attempt = 1; ; attempt++) {
    if (calls >= MAX_CALLS) throw new Error(`호출 한도 ${MAX_CALLS}회에 도달해 멈춤`);
    try {
      const res = await searchPatents({ ...params, numOfRows: String(PAGE_SIZE) }, { useCache: true });
      if (!res.fromCache) { calls++; await sleep(300); }
      return res;
    } catch (err) {
      calls++;
      if (attempt >= 3) throw err;
      console.warn(`  재시도 ${attempt}/2: ${err.message}`);
      await sleep(3000 * attempt);
    }
  }
}

const syncedAt = new Date().toISOString();
const summary = [];
const saved = [];
let changedTotal = 0;
try {
  for (const c of CHINA_APPLICANTS) {
    const first = await fetchPage({ applicant: c.query, pageNo: '1' });
    const pages = Math.ceil(first.totalCount / PAGE_SIZE);
    if (dryRun) { summary.push({ 회사: c.company, 검색어: c.query, 검색건수: first.totalCount, 호출: pages }); continue; }
    const items = [...first.items];
    for (let p = 2; p <= pages; p++) items.push(...(await fetchPage({ applicant: c.query, pageNo: String(p) })).items);
    const kept = items.filter((it) => c.match.test(it.applicantName ?? ''));
    const rows = kept.map((it) => normalize(it, 'china', syncedAt));
    changedTotal += saveRows(rows, syncedAt);
    saved.push(...rows.map((r) => r.application_number));
    summary.push({ 회사: c.company, 검색건수: first.totalCount, 받음: items.length, 저장: rows.length, 뺀것: items.length - kept.length, 호출누계: calls });
  }
  if (!dryRun) {
    if (hasCriteria()) classifyPatents({ numbers: saved });
    logRun.run('manual', saved.length, changedTotal, 'success');
  }
} catch (err) {
  if (!dryRun) logRun.run('manual', saved.length, changedTotal, `error: ${err.message}`);
  console.error(`\n중단: ${err.message}`);
  process.exitCode = 1;
} finally {
  console.table(summary);
  console.log(`실제 KIPRIS 호출 ${calls}회${dryRun ? '' : ` / 저장 ${saved.length}건 (분류까지 완료)`}`);
}
