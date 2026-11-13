import { Router } from 'express';
import { generateTrendSummary, latestSummary, lastCompleteYear } from '../trendSummary.js';
import { isAiConfigured } from '../ai.js';
import { CRITERIA_VERSION } from '../classification.js';

const router = Router();
const running = new Set(); // 같은 범위를 동시에 두 번 만들지 않게

function parseScope(src) {
  const from = Number(src.from);
  const to = Number(src.to);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from >= to || from < 1990) return null;
  const pick = (k) => (typeof src[k] === 'string' && src[k].trim() ? src[k].trim() : '');
  return { level1: pick('level1'), level2: pick('level2'), level3: pick('level3'), from, to };
}

// GET /api/summaries?level1=&level2=&level3=&from=2022&to=2024 → 이 범위·기간의 가장 최근 AI 요약
// from·to를 빼면 공개가 끝난 마지막 연도까지 최근 3개 연도 (PRD v3 기본값)
router.get('/', (req, res) => {
  const last = lastCompleteYear();
  const scope = parseScope({ from: last - 2, to: last, ...req.query });
  if (!scope) return res.status(400).json({ error: 'from, to(연도)가 필요해요' });
  res.json({
    summary: latestSummary(scope) ?? null,
    aiReady: isAiConfigured(),
    criteriaVersion: CRITERIA_VERSION,
    lastCompleteYear: last,
    from: scope.from,
    to: scope.to,
    running: running.has(JSON.stringify(scope)),
  });
});

// POST /api/summaries { level1, level2, level3, from, to } → AI로 새로 만든다 (수십 초 걸릴 수 있음)
router.post('/', async (req, res) => {
  const scope = parseScope(req.body ?? {});
  if (!scope) return res.status(400).json({ error: 'from, to(연도)가 필요해요' });
  if (!isAiConfigured()) return res.status(503).json({ error: 'AI 설정이 없어요 (backend/.env 의 AI_BASE_URL, AI_MODEL)' });
  const key = JSON.stringify(scope);
  if (running.has(key)) return res.status(409).json({ error: '같은 요약을 이미 만드는 중이에요' });
  running.add(key);
  try {
    res.json({ summary: await generateTrendSummary(scope) });
  } catch (e) {
    const busy = /HTTP 429/.test(e.message);
    const slow = /timeout|aborted/i.test(e.message);
    res.status(e.code === 'SUMMARY_CLASSIFICATION_VERSION_MISSING' ? 409 : busy || slow ? 503 : 500).json({
      error: busy ? 'AI 서버가 바빠요(무료 모델 공용 한도). 잠시 뒤 다시 시도하거나 다른 모델로 바꿔 주세요.'
        : slow ? 'AI 응답이 3분 안에 오지 않았어요. 무료 모델이 붐비는 것 같아요. 잠시 뒤 다시 시도해 주세요.'
        : e.message,
    });
  } finally {
    running.delete(key);
  }
});

export default router;
