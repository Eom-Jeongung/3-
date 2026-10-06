// 특허 목록·필터·정렬 API
import { Router } from 'express';
import { db } from '../db.js';

export const EXPIRING_MONTHS = 6; // 만료임박 기준 (인터뷰에서 확인할 가정)

const SORTABLE = ['expiry_date', 'application_date', 'registration_date', 'title', 'legal_status', 'applicant_name'];
const IS_EXPIRING = `(expiry_date BETWEEN date('now') AND date('now', '+${EXPIRING_MONTHS} months')) AS is_expiring`;
const COLUMNS = `
  id, application_number, applicant_name, applicant_type, title, application_date, registration_date,
  register_number, legal_status, ipc_codes, expiry_date, tech_category, last_synced_at, ${IS_EXPIRING}
`;

const router = Router();

// 만료임박 조건 (SELECT 별칭이 아니라 WHERE에서 직접 쓰기 위한 식)
const EXPIRING_WHERE = `expiry_date BETWEEN date('now') AND date('now', '+${EXPIRING_MONTHS} months')`;

// GET /api/patents?applicant_type=own|competitor&status=등록,공개&expiring=true&sort=expiry_date&order=asc
router.get('/', (req, res) => {
  const { applicant_type, status, expiring, sort = 'expiry_date', order = 'asc' } = req.query;
  const where = [];
  const params = {};

  if (applicant_type) {
    if (!['own', 'competitor'].includes(applicant_type)) {
      return res.status(400).json({ error: 'applicant_type은 own 또는 competitor' });
    }
    where.push('applicant_type = @applicant_type');
    params.applicant_type = applicant_type;
  }
  if (status) {
    const list = String(status).split(',').filter(Boolean);
    where.push(`legal_status IN (${list.map((_, i) => `@s${i}`).join(', ')})`);
    list.forEach((s, i) => (params[`s${i}`] = s));
  }
  if (expiring === 'true') where.push(EXPIRING_WHERE);
  if (!SORTABLE.includes(sort)) {
    return res.status(400).json({ error: `sort는 ${SORTABLE.join(', ')} 중 하나` });
  }
  const dir = order === 'desc' ? 'DESC' : 'ASC';

  // 만료일이 없는 건(소멸·거절 등)은 정렬 방향과 관계없이 맨 뒤로
  const items = db.prepare(`
    SELECT ${COLUMNS} FROM patents
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY ${sort} IS NULL, ${sort} ${dir}, id
  `).all(params).map((r) => ({ ...r, is_expiring: r.is_expiring === 1 }));

  const lastSync = db.prepare(`SELECT run_at FROM sync_log WHERE status = 'success' ORDER BY id DESC LIMIT 1`).get();
  // 상태 칩 건수는 출원인 구분 필터만 반영 (상태 필터를 걸어도 다른 상태 건수가 0이 되지 않도록)
  const statuses = db.prepare(`
    SELECT legal_status, COUNT(*) n FROM patents
    ${applicant_type ? 'WHERE applicant_type = @applicant_type' : ''}
    GROUP BY 1 ORDER BY 2 DESC
  `).all(applicant_type ? { applicant_type } : {});
  // 만료임박 칩 건수도 출원인 구분만 반영
  const { n: expiringCount } = db.prepare(`
    SELECT COUNT(*) n FROM patents
    WHERE ${EXPIRING_WHERE} ${applicant_type ? 'AND applicant_type = @applicant_type' : ''}
  `).get(applicant_type ? { applicant_type } : {});

  res.json({
    items,
    total: items.length,
    expiringMonths: EXPIRING_MONTHS,
    expiringCount,
    lastSyncedAt: lastSync ? lastSync.run_at.replace(' ', 'T') + 'Z' : null,
    statuses, // 필터 UI에 쓸 상태값 목록
  });
});

// GET /api/patents/:id
router.get('/:id', (req, res) => {
  const row = db.prepare(`SELECT *, ${IS_EXPIRING} FROM patents WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: '특허를 찾을 수 없습니다' });
  res.json({ ...row, is_expiring: row.is_expiring === 1 });
});

export default router;
