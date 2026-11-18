// 홈 화면 트렌드 API
import { Router } from 'express';
import { db } from '../db.js';
import { getOverview, getSeries, COMPANIES } from '../trendData.js';
import { burstTerms } from '../emerging.js';

const router = Router();

// GET /api/trends/overview
router.get('/overview', (req, res) => {
  const lastSync = db.prepare(`SELECT run_at FROM sync_log WHERE status = 'success' ORDER BY id DESC LIMIT 1`).get();
  res.json({ ...getOverview(), lastSyncedAt: lastSync ? lastSync.run_at.replace(' ', 'T') + 'Z' : null });
});

// GET /api/trends/series?years=5&unit=year|half&company=own|competitor|china&level1=&level2=&level3=
router.get('/series', (req, res) => {
  const { unit = 'year', company, level1, level2, level3 } = req.query;
  const years = Number(req.query.years ?? 5);
  if (!Number.isInteger(years) || years < 1 || years > 10) return res.status(400).json({ error: 'years는 1~10' });
  if (!['year', 'half'].includes(unit)) return res.status(400).json({ error: 'unit은 year 또는 half' });
  if (company && !COMPANIES.includes(company)) return res.status(400).json({ error: 'company는 own, competitor, china 중 하나' });
  res.json(getSeries({ years, unit, company, level1, level2, level3 }));
});

const toEmergingRow = ({ term, recentDocs, pastDocs, recentPct, pastPct, growth, isNew, related, patents }) =>
  ({ term, recentDocs, pastDocs, recentPct, pastPct, growth, isNew, related, patents });

// GET /api/trends/emerging?company=own|competitor|china&level1=&level2=&level3=&months=24
// 신기술 탐지: 최근 months개월(공개일 기준)에 그 전 4년보다 눈에 띄게 많이 나온 용어. AI 없이 계산한다
router.get('/emerging', (req, res) => {
  const { company, level1 = '', level2 = '', level3 = '' } = req.query;
  const months = Number(req.query.months ?? 24);
  if (![12, 24, 36].includes(months)) return res.status(400).json({ error: 'months는 12, 24, 36' });
  if (company && !COMPANIES.includes(company)) return res.status(400).json({ error: 'company는 own, competitor, china 중 하나' });
  const r = burstTerms({ applicant: company || 'all', level1, level2, level3, recentMonths: months });
  res.json({
    ref: r.ref, recentStart: r.recentStart, pastStart: r.pastStart, recent: r.recent, past: r.past,
    rows: r.rows.map(toEmergingRow),
    early: (r.early ?? []).map(toEmergingRow), // 초기 신호: 과거 0건 → 최근 3건 이상 새 용어
  });
});

export default router;
