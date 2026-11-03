// AI 질문 API
import { Router } from 'express';
import { isAiConfigured } from '../ai.js';
import { answerQuestion } from '../ask.js';

const router = Router();

const MAX_QUESTION_LENGTH = 300;
// 팀 크레딧 한도가 있어 하루 질문 수를 제한한다 (서버를 다시 켜면 초기화)
const DAILY_LIMIT = Number(process.env.ASK_DAILY_LIMIT) || 50;
const usage = { day: '', count: 0 };

function remaining() {
  const today = new Date().toISOString().slice(0, 10);
  if (usage.day !== today) { usage.day = today; usage.count = 0; }
  return DAILY_LIMIT - usage.count;
}

// GET /api/ask/status
router.get('/status', (req, res) => {
  res.json({ configured: isAiConfigured(), remaining: remaining() });
});

// POST /api/ask { question }
router.post('/', async (req, res) => {
  const question = String(req.body?.question ?? '').trim();
  if (!question) return res.status(400).json({ error: '질문을 입력해 주세요' });
  if (question.length > MAX_QUESTION_LENGTH) return res.status(400).json({ error: `질문은 ${MAX_QUESTION_LENGTH}자까지 입력할 수 있어요` });
  if (!isAiConfigured()) return res.status(503).json({ error: 'AI 연결 전이에요. backend/.env의 AI 설정을 확인해 주세요' });
  if (remaining() <= 0) return res.status(429).json({ error: `오늘 질문 한도(${DAILY_LIMIT}회)를 다 썼어요` });

  usage.count++;
  try {
    res.json({ ...(await answerQuestion(question)), remaining: remaining() });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

export default router;
