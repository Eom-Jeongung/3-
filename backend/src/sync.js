// 수집·가공·저장 파이프라인
// 화면의 새로고침 버튼(manual) + 자동 갱신(scheduled, src/scheduler.js)이 같이 쓴다
import { db, initSchema } from './db.js';
import { searchPatents, APPLICANTS } from './kipris.js';
import { classifyTech } from './classify.js';
import { classifyPatents, hasCriteria } from './classification.js';

// ---- 날짜 유틸 ----
const ymd = (d) => d.toISOString().slice(0, 10).replaceAll('-', '');
const addYears = (d, n) => { const r = new Date(d); r.setUTCFullYear(r.getUTCFullYear() + n); return r; };
const addDays = (d, n) => { const r = new Date(d); r.setUTCDate(r.getUTCDate() + n); return r; };

// 'YYYYMMDD' -> 'YYYY-MM-DD' (빈 값이면 null)
export function toIsoDate(s) {
  return /^\d{8}$/.test(s ?? '') ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null;
}

// 존속기간 만료예정일: 특허(출원번호 10…) 출원일+20년, 실용신안(20…) +10년
// 아직 살아있는(등록·공개) 건만 계산하고, 소멸·거절·취하 등은 null
export function calcExpiryDate(applicationNumber, applicationDate, legalStatus) {
  if (!applicationDate || !['등록', '공개'].includes(legalStatus)) return null;
  const years = String(applicationNumber).startsWith('20') ? 10 : 20;
  return addYears(new Date(applicationDate), years).toISOString().slice(0, 10);
}

export function normalize(item, applicantType, syncedAt) {
  const applicationDate = toIsoDate(item.applicationDate);
  const row = {
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
  return { ...row, tech_category: classifyTech(row) };
}

const upsert = db.prepare(`
  INSERT INTO patents (
    application_number, applicant_name, applicant_type, title, application_date, registration_date,
    register_number, open_date, legal_status, ipc_codes, expiry_date, tech_category, abstract, drawing_url, big_drawing_url, last_synced_at
  ) VALUES (
    @application_number, @applicant_name, @applicant_type, @title, @application_date, @registration_date,
    @register_number, @open_date, @legal_status, @ipc_codes, @expiry_date, @tech_category, @abstract, @drawing_url, @big_drawing_url, @last_synced_at
  )
  ON CONFLICT (application_number) DO UPDATE SET
    applicant_name = excluded.applicant_name, title = excluded.title,
    registration_date = excluded.registration_date, register_number = excluded.register_number,
    open_date = excluded.open_date, legal_status = excluded.legal_status, ipc_codes = excluded.ipc_codes,
    expiry_date = excluded.expiry_date, tech_category = excluded.tech_category, abstract = excluded.abstract, drawing_url = excluded.drawing_url, big_drawing_url = excluded.big_drawing_url,
    last_synced_at = excluded.last_synced_at, updated_at = datetime('now')
  -- 바뀐 항목이 있을 때만 갱신 (증분 저장)
  WHERE patents.legal_status IS NOT excluded.legal_status
     OR patents.registration_date IS NOT excluded.registration_date
     OR patents.expiry_date IS NOT excluded.expiry_date
     OR patents.title IS NOT excluded.title
     OR patents.tech_category IS NOT excluded.tech_category
     OR patents.big_drawing_url IS NOT excluded.big_drawing_url
`);
const upsertStat = db.prepare(`
  INSERT INTO tech_category_stats (tech_category, applicant_type, total_count, query, synced_at)
  VALUES (@tech_category, @applicant_type, @total_count, @query, @synced_at)
  ON CONFLICT (tech_category, applicant_type) DO UPDATE SET
    total_count = excluded.total_count, query = excluded.query, synced_at = excluded.synced_at
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
// 보통 회사 2 × 기준 2 = 4회 호출로 끝난다 (예전 샘플 방식은 28회)
const OVERLAP_DAYS = 30; // KIPRIS에 늦게 올라오는 건을 놓치지 않게 겹쳐서 조회 (겹친 건은 upsert라 중복 저장 안 됨)
const PAGE_SIZE = 500;
const latestDates = db.prepare('SELECT MAX(open_date) open, MAX(registration_date) reg FROM patents WHERE applicant_type = ?');
const exists = db.prepare('SELECT 1 FROM patents WHERE application_number = ?');
const countByType = db.prepare('SELECT COUNT(*) n FROM patents WHERE applicant_type = ?');

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
    for (const [type, applicant] of Object.entries(APPLICANTS)) {
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
          for (const it of res.items) byNumber.set(it.applicationNumber, normalize(it, type, syncedAt));
        }
        log(`[${type}] ${field} ${from}~${to}`);
      }
    }
    const rows = [...byNumber.values()];
    const added = rows.filter((r) => !exists.get(r.application_number)).length;
    const changed = saveRows(rows, syncedAt);
    // 새로 받은 특허도 바로 필터에 잡히도록 분류한다 (받은 건만 다시 계산)
    if (hasCriteria()) classifyPatents({ numbers: rows.map((r) => r.application_number) });
    // 비중(%) 계산용 회사별 전체 건수: 전체 수집 이후로는 DB 건수가 곧 KIPRIS 전체 건수 (API 호출 불필요)
    db.transaction(() => {
      for (const type of Object.keys(APPLICANTS)) {
        upsertStat.run({ tech_category: '전체', applicant_type: type, total_count: countByType.get(type).n, query: '', synced_at: syncedAt });
      }
    })();
    logRun.run(source, rows.length, changed, 'success');
    return { fetched: rows.length, added, changed, calls, syncedAt };
  } catch (err) {
    logRun.run(source, byNumber.size, 0, `error: ${err.message}`);
    throw err;
  }
}
