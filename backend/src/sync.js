// 수집·가공·저장 파이프라인
// 수동 갱신(npm run sync, POST /api/sync) + 자동 갱신(scheduled, src/scheduler.js)이 같이 쓴다
import { db, initSchema } from './db.js';
import { searchPatents, APPLICANTS, CHINA_APPLICANTS } from './kipris.js';
import { classifyPatents, hasCriteria } from './classification.js';

// ---- 날짜 유틸 ----
const ymd = (d) => d.toISOString().slice(0, 10).replaceAll('-', '');
const addYears = (d, n) => { const r = new Date(d); r.setUTCFullYear(r.getUTCFullYear() + n); return r; };
const addDays = (d, n) => { const r = new Date(d); r.setUTCDate(r.getUTCDate() + n); return r; };

// 'YYYYMMDD' -> 'YYYY-MM-DD' (빈 값이면 null)
function toIsoDate(s) {
  return /^\d{8}$/.test(s ?? '') ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null;
}

// 존속기간 만료예정일: 특허(출원번호 10…) 출원일+20년, 실용신안(20…) +10년
// 아직 살아있는(등록·공개) 건만 계산하고, 소멸·거절·취하 등은 null
function calcExpiryDate(applicationNumber, applicationDate, legalStatus) {
  if (!applicationDate || !['등록', '공개'].includes(legalStatus)) return null;
  const years = String(applicationNumber).startsWith('20') ? 10 : 20;
  return addYears(new Date(applicationDate), years).toISOString().slice(0, 10);
}

export function normalize(item, applicantType, syncedAt) {
  const applicationDate = toIsoDate(item.applicationDate);
  return {
    application_number: item.applicationNumber,
    applicant_name: item.applicantName,
    applicant_type: applicantType,
    title: item.inventionTitle,
    application_date: applicationDate,
    registration_date: toIsoDate(item.registerDate),
    register_number: item.registerNumber || null,
    open_date: toIsoDate(item.openDate),
    legal_status: item.registerStatus,
    ipc_codes: item.ipcNumber || null,
    expiry_date: calcExpiryDate(item.applicationNumber, applicationDate, item.registerStatus),
    abstract: item.astrtCont || null,
    drawing_url: item.drawing || null,
    big_drawing_url: item.bigDrawing || null,
    last_synced_at: syncedAt,
  };
}

const upsert = db.prepare(`
  INSERT INTO patents (
    application_number, applicant_name, applicant_type, title, application_date, registration_date,
    register_number, open_date, legal_status, ipc_codes, expiry_date, abstract, drawing_url, big_drawing_url, last_synced_at
  ) VALUES (
    @application_number, @applicant_name, @applicant_type, @title, @application_date, @registration_date,
    @register_number, @open_date, @legal_status, @ipc_codes, @expiry_date, @abstract, @drawing_url, @big_drawing_url, @last_synced_at
  )
  ON CONFLICT (application_number) DO UPDATE SET
    applicant_name = excluded.applicant_name, title = excluded.title,
    registration_date = excluded.registration_date, register_number = excluded.register_number,
    open_date = excluded.open_date, legal_status = excluded.legal_status, ipc_codes = excluded.ipc_codes,
    expiry_date = excluded.expiry_date, abstract = excluded.abstract, drawing_url = excluded.drawing_url, big_drawing_url = excluded.big_drawing_url,
    last_synced_at = excluded.last_synced_at, updated_at = datetime('now')
  -- 바뀐 항목이 있을 때만 갱신 (증분 저장)
  WHERE patents.legal_status IS NOT excluded.legal_status
     OR patents.registration_date IS NOT excluded.registration_date
     OR patents.expiry_date IS NOT excluded.expiry_date
     OR patents.title IS NOT excluded.title
     OR patents.big_drawing_url IS NOT excluded.big_drawing_url
`);
const touch = db.prepare('UPDATE patents SET last_synced_at = ? WHERE application_number = ?');
export const logRun = db.prepare('INSERT INTO sync_log (source, records_fetched, records_changed, status) VALUES (?, ?, ?, ?)');

/** normalize된 행들을 한 트랜잭션으로 저장하고, 실제로 바뀐 건수를 돌려준다 */
export function saveRows(rows, syncedAt) {
  let changed = 0;
  db.transaction(() => {
    for (const r of rows) {
      const { changes } = upsert.run(r);
      if (changes) changed++;
      else touch.run(syncedAt, r.application_number);
    }
  })();
  return changed;
}

// ---- 새로고침 (증분 수집) ----
// 전체 수집(npm run collect) 이후에는 "DB에 있는 마지막 날짜 이후"만 KIPRIS에 묻는다
// - 공개일(openDate): 새로 공개된 특허
// - 등록일(registerDate): 공개 없이 바로 등록된 특허 + 공개 → 등록으로 상태가 바뀐 특허
// 보통 회사 2 × 기준 2 = 4회 호출로 끝난다 (예전 샘플 방식은 28회). 중국 경쟁사를 받은 뒤로는 회사 3곳 × 2회가 더 든다
const OVERLAP_DAYS = 30; // KIPRIS에 늦게 올라오는 건을 놓치지 않게 겹쳐서 조회 (겹친 건은 upsert라 중복 저장 안 됨)
const PAGE_SIZE = 500;
const latestDates = db.prepare('SELECT MAX(open_date) open, MAX(registration_date) reg FROM patents WHERE applicant_type = ?');
const exists = db.prepare('SELECT 1 FROM patents WHERE application_number = ?');

// 수동·자동 갱신이 동시에 돌지 않게 하는 표시
let running = false;
export const isSyncRunning = () => running;

/** @returns {Promise<{ fetched: number, added: number, changed: number, calls: number, syncedAt: string }>} */
export async function runSync(options = {}) {
  if (running) throw new Error('이미 수집 중입니다');
  running = true;
  try {
    return await runSyncOnce(options);
  } finally {
    running = false;
  }
}

async function runSyncOnce({ source = 'manual', useCache = false, log = () => {} } = {}) {
  initSchema();
  const syncedAt = new Date().toISOString();
  const to = ymd(new Date());
  const byNumber = new Map(); // 공개일·등록일 조회에 같은 특허가 겹쳐 나올 수 있어 출원번호로 합친다
  let calls = 0;
  try {
    // 중국 경쟁사는 전체 수집(npm run collect-china)을 한 뒤부터 함께 갱신한다
    const targets = [
      ...Object.entries(APPLICANTS).map(([type, applicant]) => ({ type, applicant })),
      ...(latestDates.get('china').open ? CHINA_APPLICANTS.map((c) => ({ type: 'china', applicant: c.query, match: c.match })) : []),
    ];
    for (const { type, applicant, match } of targets) {
      const { open, reg } = latestDates.get(type);
      if (!open) throw new Error('DB가 비어 있습니다. 먼저 backend에서 npm run collect로 전체 수집을 하세요');
      for (const [field, last] of [['openDate', open], ['registerDate', reg ?? open]]) {
        const from = ymd(addDays(new Date(last), -OVERLAP_DAYS));
        for (let page = 1, pages = 1; page <= pages; page++) {
          const res = await searchPatents(
            { applicant, [field]: `${from}~${to}`, numOfRows: String(PAGE_SIZE), pageNo: String(page) },
            { useCache },
          );
          if (!res.fromCache) calls++;
          pages = Math.ceil(res.totalCount / PAGE_SIZE);
          for (const it of res.items) if (!match || match.test(it.applicantName ?? '')) byNumber.set(it.applicationNumber, normalize(it, type, syncedAt));
        }
        log(`[${type}] ${field} ${from}~${to}`);
      }
    }
    const rows = [...byNumber.values()];
    const added = rows.filter((r) => !exists.get(r.application_number)).length;
    const changed = saveRows(rows, syncedAt);
    // 새로 받은 특허도 바로 필터에 잡히도록 분류한다 (받은 건만 다시 계산)
    if (hasCriteria()) classifyPatents({ numbers: rows.map((r) => r.application_number) });
    logRun.run(source, rows.length, changed, 'success');
    return { fetched: rows.length, added, changed, calls, syncedAt };
  } catch (err) {
    logRun.run(source, byNumber.size, 0, `error: ${err.message}`);
    throw err;
  }
}
