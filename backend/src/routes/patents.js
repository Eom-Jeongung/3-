// 특허 목록·필터·정렬 API
import { Router } from 'express';
import { db, likePattern } from '../db.js';
import { fetchClaims } from '../kipris.js';
import { generatePatentSummary, latestPatentSummary, patentSummaryInput } from '../patentSummary.js';
import { aiFailure, isAiConfigured } from '../ai.js';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100; // 전체 8만 건을 한 번에 내려보내지 않도록 상한을 둔다
const SORTABLE = ['open_date', 'application_date', 'registration_date', 'title', 'legal_status', 'applicant_name'];
const NULLABLE_SORT = ['open_date', 'registration_date'];
const COLUMNS = `
  id, application_number, applicant_name, applicant_type, title, application_date, open_date, registration_date,
  register_number, legal_status, ipc_codes, last_synced_at
`;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 분류 기준을 다시 돌리면 버전별 결과가 쌓이므로 최신 버전의 주분류만 본다
const CURRENT_CLASSIFICATION = `is_primary = 1 AND criteria_version = (SELECT MAX(criteria_version) FROM classification)`;

const router = Router();

/** 목록·CSV 내려받기가 같이 쓰는 필터와 정렬. 잘못된 값이면 { error } */
function buildQuery(query) {
  const { applicant_type, status, q, level1, level2, level3, sort = 'open_date', order = 'desc' } = query;
  const where = [];
  const params = {};

  if (applicant_type) {
    if (!['own', 'competitor', 'china'].includes(applicant_type)) {
      return { error: 'applicant_type은 own, competitor, china 중 하나' };
    }
    where.push('applicant_type = @applicant_type');
    params.applicant_type = applicant_type;
  }
  if (status) {
    const list = String(status).split(',').filter(Boolean);
    where.push(`legal_status IN (${list.map((_, i) => `@s${i}`).join(', ')})`);
    list.forEach((s, i) => (params[`s${i}`] = s));
  }
  if (q?.trim()) {
    // 명칭은 "표시 장치"처럼 일반적인 경우가 많아 초록까지 찾는다
    where.push(`(title LIKE @q ESCAPE '\\' OR abstract LIKE @q ESCAPE '\\')`);
    params.q = likePattern(q.trim());
  }
  for (const [name, op] of [['open_from', '>='], ['open_to', '<=']]) {
    const value = query[name];
    if (!value) continue;
    if (!DATE_RE.test(value)) return { error: `${name}은 YYYY-MM-DD 형식` };
    where.push(`open_date ${op} @${name}`);
    params[name] = value;
  }
  // 기술 분야 필터: 분류 결과는 원본과 분리된 classification 테이블에 있다
  const levels = Object.entries({ level1, level2, level3 }).filter(([, v]) => v);
  if (levels.length) {
    // 특허마다 분류 테이블을 다시 뒤지는 EXISTS는 2·3차를 고르면 서버가 멈출 만큼 느려서, 맞는 출원번호를 먼저 한 번만 추린다
    where.push(`application_number IN (
      SELECT application_number FROM classification
      WHERE ${CURRENT_CLASSIFICATION} ${levels.map(([k]) => `AND ${k} = @${k}`).join(' ')}
    )`);
    for (const [k, v] of levels) params[k] = v;
  }
  if (!SORTABLE.includes(sort)) {
    return { error: `sort는 ${SORTABLE.join(', ')} 중 하나` };
  }
  const dir = order === 'desc' ? 'DESC' : 'ASC';
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  // 날짜가 없는 건(공개 없이 등록 등)은 정렬 방향과 관계없이 맨 뒤로
  // SQLite는 내림차순에서 NULL이 원래 맨 뒤라 식 없이 쓴다. 그래야 색인을 타서 8만 건을 정렬하지 않는다 (240ms → 1ms)
  const orderBy = dir === 'DESC' || !NULLABLE_SORT.includes(sort)
    ? `${sort} ${dir}, id ${dir}`
    : `${sort} IS NULL, ${sort} ASC, id`;
  return { whereSql, params, orderBy };
}

// GET /api/patents?applicant_type=own|competitor|china&status=등록,공개&q=검색어&open_from=2025-01-01&open_to=2025-12-31
//                  &level1=OLED&level2=설계&level3=화소 회로&sort=open_date&order=desc&limit=10&offset=0
router.get('/', (req, res) => {
  const built = buildQuery(req.query);
  if (built.error) return res.status(400).json({ error: built.error });
  const { whereSql, params, orderBy } = built;
  const { applicant_type } = req.query;
  const limit = Math.min(Math.max(Math.trunc(Number(req.query.limit)) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.max(Math.trunc(Number(req.query.offset)) || 0, 0);
  const items = db.prepare(`
    SELECT ${COLUMNS} FROM patents
    ${whereSql}
    ORDER BY ${orderBy}
    LIMIT @limit OFFSET @offset
  `).all({ ...params, limit, offset });

  // 목록의 분류 근거 칸 (주분류)
  const classificationOf = db.prepare(`SELECT level1, level2, level3, basis FROM classification WHERE application_number = ? AND ${CURRENT_CLASSIFICATION}`);
  for (const item of items) item.classification = classificationOf.get(item.application_number) ?? null;

  const { n: total } = db.prepare(`SELECT COUNT(*) n FROM patents ${whereSql}`).get(params);

  // 상태 칩 건수는 출원인 구분 필터만 반영 (상태 필터를 걸어도 다른 상태 건수가 0이 되지 않도록)
  const statuses = db.prepare(`
    SELECT legal_status, COUNT(*) n FROM patents
    ${applicant_type ? 'WHERE applicant_type = @applicant_type' : ''}
    GROUP BY 1 ORDER BY 2 DESC
  `).all(applicant_type ? { applicant_type } : {});

  res.json({
    items,
    total, // 필터에 맞는 전체 건수 (items는 그중 limit건)
    statuses, // 필터 UI에 쓸 상태값 목록
  });
});

// GET /api/patents/export.csv?(목록과 같은 필터·정렬) — 지금 고른 조건의 특허를 CSV로 내려받기
// 엑셀에서 한글이 깨지지 않게 맨 앞에 BOM을 붙인다. 너무 큰 파일이 되지 않게 EXPORT_MAX건까지만
const EXPORT_MAX = 20000;
const TYPE_LABELS = { own: '자사(LG디스플레이)', competitor: '삼성디스플레이', china: '중국 4사' };
const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};
const formatAppNo = (n) => (n?.length === 13 ? `${n.slice(0, 2)}-${n.slice(2, 6)}-${n.slice(6)}` : n);

router.get('/export.csv', (req, res) => {
  const built = buildQuery(req.query);
  if (built.error) return res.status(400).json({ error: built.error });
  const { whereSql, params, orderBy } = built;
  const rows = db.prepare(`
    SELECT application_number, title, applicant_name, applicant_type, application_date, open_date,
           registration_date, register_number, legal_status, ipc_codes
    FROM patents ${whereSql} ORDER BY ${orderBy} LIMIT ${EXPORT_MAX}
  `).all(params);
  const classificationOf = db.prepare(`SELECT level1, level2, level3, basis FROM classification WHERE application_number = ? AND ${CURRENT_CLASSIFICATION}`);
  for (const r of rows) Object.assign(r, classificationOf.get(r.application_number));
  const header = ['출원번호', '발명의 명칭', '출원인', '구분', '출원일', '공개일', '등록일', '등록번호', '상태', 'IPC', '1차 분류', '2차 분류', '3차 분류', '분류 근거'];
  const lines = rows.map((r) => [
    formatAppNo(r.application_number), r.title, r.applicant_name, TYPE_LABELS[r.applicant_type] ?? r.applicant_type,
    r.application_date, r.open_date, r.registration_date, r.register_number, r.legal_status,
    (r.ipc_codes ?? '').replaceAll('|', ' '), r.level1, r.level2, r.level3, r.basis,
  ].map(csvCell).join(','));
  const today = new Date().toISOString().slice(0, 10);
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="patents-${today}.csv"; filename*=UTF-8''${encodeURIComponent(`특허목록_${today}.csv`)}`);
  res.send('﻿' + [header.join(','), ...lines].join('\r\n'));
});

// GET /api/patents/filter-options — 기술 분야 필터의 선택지
// 코드에 분야 이름을 두지 않고 분류 결과에서 그대로 읽는다 (분류 기준이 바뀌어도 화면을 고칠 필요가 없음)
router.get('/filter-options', (req, res) => {
  const classification = db.prepare(`
    SELECT level1, level2, level3, COUNT(*) n FROM classification
    WHERE ${CURRENT_CLASSIFICATION}
    GROUP BY 1, 2, 3 ORDER BY 1, 2, 3
  `).all();
  res.json({ classification });
});

const storedClaims = (applicationNumber) => db
  .prepare('SELECT claim FROM patent_claims WHERE application_number = ? ORDER BY seq')
  .all(applicationNumber)
  .map((r) => r.claim);

// POST /api/patents/:id/claims — 없으면 KIPRIS에서 받아 저장한다 (특허 1건당 호출 1회)
router.post('/:id/claims', async (req, res) => {
  const row = db.prepare('SELECT application_number FROM patents WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '특허를 찾을 수 없습니다' });
  let claims = storedClaims(row.application_number);
  if (!claims.length) {
    try {
      claims = await fetchClaims(row.application_number);
    } catch (err) {
      return res.status(502).json({ error: err.message });
    }
    const insert = db.prepare('INSERT OR REPLACE INTO patent_claims (application_number, seq, claim) VALUES (?, ?, ?)');
    db.transaction(() => claims.forEach((c, i) => insert.run(row.application_number, i + 1, c)))();
  }
  res.json({ claims });
});

// GET /api/patents/:id/summary → 저장된 개별 AI 요약 (없으면 null)과 만들 수 있는지
// POST /api/patents/:id/summary → AI로 새로 만든다 (청구항은 이미 받아 둔 경우만 쓰고 KIPRIS는 부르지 않는다)
const summarizing = new Set();
router.get('/:id/summary', (req, res) => {
  const { patent, input } = patentSummaryInput(req.params.id);
  if (!patent) return res.status(404).json({ error: '특허를 찾을 수 없습니다' });
  res.json({ summary: latestPatentSummary(patent.id) ?? null, aiReady: isAiConfigured(), enoughText: Boolean(input), running: summarizing.has(patent.id) });
});
router.post('/:id/summary', async (req, res) => {
  const id = Number(req.params.id);
  if (!isAiConfigured()) return res.status(503).json({ error: 'AI 설정이 없어요 (backend/.env 의 AI_BASE_URL, AI_MODEL)' });
  if (summarizing.has(id)) return res.status(409).json({ error: '이 특허 요약을 이미 만드는 중이에요' });
  summarizing.add(id);
  try {
    res.json({ summary: await generatePatentSummary(id) });
  } catch (e) {
    const { status, message } = aiFailure(e);
    res.status(status).json({ error: message });
  } finally {
    summarizing.delete(id);
  }
});

// GET /api/patents/:id
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM patents WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '특허를 찾을 수 없습니다' });
  const classification = db.prepare(`
    SELECT level1, level2, level3, is_primary, basis, basis_detail, criteria_version FROM classification
    WHERE application_number = ? AND criteria_version = (SELECT MAX(criteria_version) FROM classification)
    ORDER BY is_primary DESC, id
  `).all(row.application_number);
  res.json({ ...row, classification, claims: storedClaims(row.application_number) });
});

export default router;
