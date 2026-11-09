// 수동 새로고침 API
import { Router } from 'express';
import { runSync, isSyncRunning } from '../sync.js';

const router = Router();

// POST /api/sync — DB의 마지막 공개일·등록일 이후 새로 나온 특허만 KIPRIS에서 받아 upsert (캐시 사용 안 함)
router.post('/', async (req, res) => {
  if (isSyncRunning()) return res.status(409).json({ error: '이미 수집 중입니다 (자동 갱신 포함)' });
  const started = Date.now();
  try {
    const result = await runSync({ source: 'manual', useCache: false });
    res.json({ ...result, elapsedMs: Date.now() - started });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

export default router;
