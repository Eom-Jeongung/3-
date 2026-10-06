// 자사 vs 경쟁사 기술분야 비교 API
import { Router } from 'express';
import { db } from '../db.js';
import { TECH_RULES, UNCLASSIFIED } from '../classify.js';

const router = Router();

// GET /api/tech-categories/compare
router.get('/compare', (req, res) => {
  const stats = db.prepare('SELECT * FROM tech_category_stats').all();
  const sample = db.prepare('SELECT tech_category, applicant_type, COUNT(*) n FROM patents GROUP BY 1, 2').all();

  const pick = (rows, cat, type, field) => rows.find((r) => r.tech_category === cat && r.applicant_type === type)?.[field] ?? 0;
  const totals = { own: pick(stats, '전체', 'own', 'total_count'), competitor: pick(stats, '전체', 'competitor', 'total_count') };

  res.json({
    totals, // 회사별 KIPRIS 전체 출원 건수
    syncedAt: stats[0]?.synced_at ?? null,
    categories: [...TECH_RULES, { name: UNCLASSIFIED, keywords: [], ipcPrefixes: [] }].map((rule) => ({
      name: rule.name,
      keywords: rule.keywords,
      ipcPrefixes: rule.ipcPrefixes,
      // 전체 포트폴리오 기준 (초록 키워드 검색, 분야 간 중복 집계 가능). 미분류는 계산 불가라 null
      portfolio: rule.name === UNCLASSIFIED ? null : {
        own: pick(stats, rule.name, 'own', 'total_count'),
        competitor: pick(stats, rule.name, 'competitor', 'total_count'),
      },
      // 대시보드 샘플(100건) 기준 (분야당 1개, 위 규칙 순서대로 먼저 걸린 분야)
      sample: { own: pick(sample, rule.name, 'own', 'n'), competitor: pick(sample, rule.name, 'competitor', 'n') },
    })),
  });
});

export default router;
