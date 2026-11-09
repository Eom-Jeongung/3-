// AI 질문 API
import { Router } from 'express';
import { isAiConfigured } from '../ai.js';
import { answerQuestion } from '../ask.js';
import { db } from '../db.js';

const router = Router();

const MAX_QUESTION_LENGTH = 300;
// 팀 크레딧 한도가 있어 하루 질문 수를 제한한다
// 질문마다 ask_log에 남기고 그 줄 수로 세므로, 서버를 다시 켜도 초기화되지 않는다
const DAILY_LIMIT = Number(process.env.ASK_DAILY_LIMIT) || 50;

// 시각은 UTC로 저장된다. 하루는 한국 시간 자정부터 센다
const countToday = db.prepare(`
  SELECT COUNT(*) n FROM ask_log WHERE asked_at >= datetime(date('now', '+9 hours'), '-9 hours')
`);
const insertAsk = db.prepare('INSERT INTO ask_log (question) VALUES (?)');
const finishAsk = db.prepare('UPDATE ask_log SET plan = @plan, answer = @answer, source = @source, error = @error WHERE id = @id');

const remaining = () => Math.max(DAILY_LIMIT - countToday.get().n, 0);

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

  const id = insertAsk.run(question).lastInsertRowid;
  try {
    const result = await answerQuestion(question);
    finishAsk.run({ id, plan: JSON.stringify(result.plan), answer: result.answer, source: result.source, error: null });
    res.json({ ...result, remaining: remaining() });
  } catch (err) {
    finishAsk.run({ id, plan: null, answer: null, source: null, error: err.message });
    res.status(502).json({ error: err.message });
  }
});

export default router;
