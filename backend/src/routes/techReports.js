// AI 기술 분석 보고서 API (routes/summaries.js를 복사해 기술 분석용으로 바꿈. 건수 요약 API는 그대로)
import { Router } from 'express';
import { generateTechReport, latestTechReport, listTechReports, getTechReportById } from '../techReport.js';
import { lastCompleteYear } from '../trendSummary.js';
import { aiFailure, isAiConfigured } from '../ai.js';
import { CRITERIA_VERSION } from '../classification.js';

const router = Router();
const runningScopes = new Set(); // 같은 범위를 동시에 두 번 만들지 않게

function parseScope(src) {
  const from = Number(src.from);
  const to = Number(src.to);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from >= to || from < 1990) return null;
  const pick = (k) => (typeof src[k] === 'string' && src[k].trim() ? src[k].trim() : '');
  return { level1: pick('level1'), level2: pick('level2'), level3: pick('level3'), from, to };
}

// GET /api/tech-reports?level1=&level2=&level3=&from=2022&to=2024 → 이 범위·기간의 가장 최근 보고서
router.get('/', (req, res) => {
  const last = lastCompleteYear();
  const scope = parseScope({ from: last - 2, to: last, ...req.query });
  if (!scope) return res.status(400).json({ error: 'from, to(연도)가 필요해요' });
  res.json({
    summary: latestTechReport(scope) ?? null,
    aiReady: isAiConfigured(),
    criteriaVersion: CRITERIA_VERSION,
    lastCompleteYear: last,
    from: scope.from,
    to: scope.to,
    running: runningScopes.has(JSON.stringify(scope)),
  });
});

// GET /api/tech-reports/archive?all=1 → 보관함 (모든 분류), level1~3을 주면 그 범위만
router.get('/archive', (req, res) => {
  const pick = (k) => (typeof req.query[k] === 'string' ? req.query[k].trim() : '');
  const scope = req.query.all === '1' ? null : { level1: pick('level1'), level2: pick('level2'), level3: pick('level3') };
  res.json({ items: listTechReports(scope) });
});

// GET /api/tech-reports/:id → 보관함에서 고른 보고서 하나
router.get('/:id', (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: '보고서 번호가 올바르지 않아요' });
  const summary = getTechReportById(Number(req.params.id));
  if (!summary) return res.status(404).json({ error: '그 보고서를 찾을 수 없어요' });
  res.json({ summary });
});

// POST /api/tech-reports { level1, level2, level3, from, to } → AI로 새로 만든다 (1~3분)
router.post('/', async (req, res) => {
  const scope = parseScope(req.body ?? {});
  if (!scope) return res.status(400).json({ error: 'from, to(연도)가 필요해요' });
  if (!isAiConfigured()) return res.status(503).json({ error: 'AI 설정이 없어요 (backend/.env 의 AI_BASE_URL, AI_MODEL)' });
  const key = JSON.stringify(scope);
  if (runningScopes.has(key)) return res.status(409).json({ error: '같은 보고서를 이미 만드는 중이에요' });
  runningScopes.add(key);
  try {
    res.json({ summary: await generateTechReport(scope) });
  } catch (e) {
    const { status, message } = aiFailure(e);
    res.status(e.code === 'SUMMARY_CLASSIFICATION_VERSION_MISSING' ? 409 : status).json({ error: message });
  } finally {
    runningScopes.delete(key);
  }
});

export default router;
