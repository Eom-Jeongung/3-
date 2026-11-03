// 홈 화면 트렌드 API
import { Router } from 'express';
import { db } from '../db.js';
import { getOverview, getSeries } from '../trendData.js';

const router = Router();

// GET /api/trends/overview
router.get('/overview', (req, res) => {
  const lastSync = db.prepare(`SELECT run_at FROM sync_log WHERE status = 'success' ORDER BY id DESC LIMIT 1`).get();
  res.json({ ...getOverview(), lastSyncedAt: lastSync ? lastSync.run_at.replace(' ', 'T') + 'Z' : null });
});

// GET /api/trends/series?years=5&unit=year|half&company=own|competitor&level1=&level2=&level3=
router.get('/series', (req, res) => {
  const { unit = 'year', company, level1, level2, level3 } = req.query;
  const years = Number(req.query.years ?? 5);
  if (!Number.isInteger(years) || years < 1 || years > 10) return res.status(400).json({ error: 'years는 1~10' });
  if (!['year', 'half'].includes(unit)) return res.status(400).json({ error: 'unit은 year 또는 half' });
  if (company && !['own', 'competitor'].includes(company)) return res.status(400).json({ error: 'company는 own 또는 competitor' });
  res.json(getSeries({ years, unit, company, level1, level2, level3 }));
});

export default router;
