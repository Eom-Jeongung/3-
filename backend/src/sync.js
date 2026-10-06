// 수집·가공·저장 파이프라인
// 데모 v1: 수동 실행만 (node-cron 스케줄러는 보류, SYNC_INTERVAL_CRON 미사용)
import { db, initSchema } from './db.js';
import { searchPatents, APPLICANTS, STATUS_CODES } from './kipris.js';
import { classifyTech, TECH_RULES, toKiprisQuery } from './classify.js';

// ---- 날짜 유틸 ----
const ymd = (d) => d.toISOString().slice(0, 10).replaceAll('-', '');
const addYears = (d, n) => { const r = new Date(d); r.setUTCFullYear(r.getUTCFullYear() + n); return r; };
const addMonths = (d, n) => { const r = new Date(d); r.setUTCMonth(r.getUTCMonth() + n); return r; };

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

// 데모용 샘플링: 회사별 50건, 상태·만료시점이 고르게 섞이도록 구간별로 가져온다
function sampleBuckets(today = new Date()) {
  const range = (from, to) => `${ymd(from)}~${ymd(to)}`;
  const expiringFrom = addYears(today, -20);            // 오늘 만료
  const expiringTo = addMonths(expiringFrom, 6);        // 6개월 뒤 만료
  return [
    { name: '등록·6개월 내 만료', count: 10, lastvalue: 'R', applicationDate: range(expiringFrom, expiringTo) },
    { name: '등록·3년 내 만료', count: 8, lastvalue: 'R', applicationDate: range(expiringTo, addYears(expiringFrom, 3)) },
    { name: '등록·2010~2013 출원', count: 4, lastvalue: 'R', applicationDate: '20100101~20131231' },
    { name: '등록·2014~2017 출원', count: 4, lastvalue: 'R', applicationDate: '20140101~20171231' },
    { name: '등록·2018~ 출원', count: 4, lastvalue: 'R', applicationDate: `20180101~${ymd(today)}` },
    { name: '공개(출원중)', count: 8, lastvalue: STATUS_CODES.공개 },
    { name: '소멸', count: 6, lastvalue: STATUS_CODES.소멸 },
    { name: '거절', count: 3, lastvalue: STATUS_CODES.거절 },
    { name: '취하', count: 3, lastvalue: STATUS_CODES.취하 },
  ];
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
const logRun = db.prepare('INSERT INTO sync_log (source, records_fetched, records_changed, status) VALUES (?, ?, ?, ?)');

/** @returns {Promise<{ fetched: number, changed: number, syncedAt: string }>} */
export async function runSync({ source = 'manual', useCache = true, log = () => {} } = {}) {
  initSchema();
  const syncedAt = new Date().toISOString();
  const rows = [];
  try {
    // 구간별 호출을 병렬로 보내 수동 새로고침 시간을 줄인다 (순차 호출 시 약 27초)
    const jobs = Object.entries(APPLICANTS).flatMap(([type, applicant]) =>
      sampleBuckets().map(async ({ name, count, ...params }) => {
        const { items } = await searchPatents({ applicant, ...params, numOfRows: String(count) }, { useCache });
        log(`[${type}] ${name}: ${items.length}건`);
        return items.map((it) => normalize(it, type, syncedAt));
      }),
    );
    // 기술분야별 전체 건수: 분야 키워드로 초록 검색해 totalCount만 사용 (회사 2 × (분야 4 + 전체) = 10회 호출)
    // '전체'는 회사별 총 출원 건수 — 비중(%) 계산용
    const statJobs = Object.entries(APPLICANTS).flatMap(([type, applicant]) =>
      [...TECH_RULES, { name: '전체', keywords: [] }].map(async (rule) => {
        const query = toKiprisQuery(rule);
        const params = { applicant, numOfRows: '1', ...(query && { astrtCont: query }) };
        const { totalCount } = await searchPatents(params, { useCache });
        return { tech_category: rule.name, applicant_type: type, total_count: totalCount, query, synced_at: syncedAt };
      }),
    );
    const [batches, stats] = await Promise.all([Promise.all(jobs), Promise.all(statJobs)]);
    for (const batch of batches) rows.push(...batch);
    db.transaction(() => { for (const s of stats) upsertStat.run(s); })();
    let changed = 0;
    db.transaction(() => {
      for (const r of rows) {
        const { changes } = upsert.run(r);
        if (changes) changed++;
        else touch.run(syncedAt, r.application_number);
      }
    })();
    logRun.run(source, rows.length, changed, 'success');
    return { fetched: rows.length, changed, syncedAt };
  } catch (err) {
    logRun.run(source, rows.length, 0, `error: ${err.message}`);
    throw err;
  }
}
