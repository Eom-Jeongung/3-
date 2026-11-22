// Express 앱 진입점
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initSchema } from './db.js';
import patentsRouter from './routes/patents.js';
import syncRouter from './routes/sync.js';
import trendsRouter from './routes/trends.js';
import summariesRouter from './routes/summaries.js';
import { startScheduler } from './scheduler.js';
import { warmUpEmerging } from './emerging.js';
import { siteAuth } from './siteAuth.js';
import { hasCriteria, seedCriteria, classifyPatents, CRITERIA_VERSION } from './classification.js';

initSchema();

// 분류 기준(CRITERIA_VERSION)을 올린 코드가 처음 켜질 때(배포 직후) 새 기준의 결과가 없으면 전체를 다시 분류한다
// 이걸 안 하면 콘솔에서 npm run classify를 돌리기 전까지 화면의 건수가 모두 0으로 보인다. 약 10초, KIPRIS·AI 호출 없음
if (!hasCriteria()) {
  const started = Date.now();
  seedCriteria();
  const n = classifyPatents();
  console.log(`[분류] 기준 ${CRITERIA_VERSION} 결과가 없어 ${n.toLocaleString()}건을 다시 분류함 (${((Date.now() - started) / 1000).toFixed(1)}초)`);
}

const app = express();

// 서버 상태 확인 (Render가 살아 있는지 보는 주소). 비밀번호 없이 열린다
app.get('/api/health', (req, res) => res.json({ ok: true }));

// 비밀번호 입력 화면이 보낸 비밀번호를 읽어야 해서, JSON 읽기를 비밀번호 확인보다 먼저 둔다
app.use(express.json({ limit: '100kb' }));
app.use(siteAuth(process.env.SITE_PASSWORD));

app.use('/api/patents', patentsRouter);
app.use('/api/sync', syncRouter);
app.use('/api/trends', trendsRouter);
app.use('/api/summaries', summariesRouter);

// 배포용: npm run build로 만든 화면(frontend/dist)이 있으면 이 서버가 같이 띄운다
// 개발 중(npm run dev)에는 Vite가 화면을 띄우므로 dist가 없어도 된다
// 화면은 주소의 # 뒤로 페이지를 나눠서, index.html 하나만 있으면 모든 페이지가 열린다
const distDir = fileURLToPath(new URL('../../frontend/dist', import.meta.url));
const serveScreen = fs.existsSync(path.join(distDir, 'index.html'));
if (serveScreen) app.use(express.static(distDir));

// 오류 처리: 오류 내용(파일 경로·코드 위치)은 서버 로그에만 남기고, 화면에는 짧은 안내만 보낸다 (보안 점검 8번)
// Express 기본 오류 화면은 개발 환경에서 서버 경로가 담긴 오류 내용을 그대로 보여 준다
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status ?? err.statusCode ?? 500;
  if (status >= 500) console.error(`[오류] ${req.method} ${req.originalUrl}:`, err);
  res.status(status).json({ error: status < 500 ? '요청 형식이 올바르지 않아요' : '서버에서 오류가 났어요. 잠시 뒤 다시 시도해 주세요' });
});

// PORT가 아닌 API_PORT를 쓴다: 미리보기·호스팅 환경이 PORT를 프론트엔드용으로 미리 넣어두는 경우가 있어 충돌함
// API_PORT가 없고 PORT만 있으면(천안 서버) 수업 규칙대로 PORT + 100을 쓴다
// Render는 RENDER=true와 함께 서버가 받아야 할 PORT를 넣어 주므로, 그때는 PORT를 그대로 쓴다
const port = Number(process.env.API_PORT)
  || (process.env.RENDER && Number(process.env.PORT))
  || (Number(process.env.PORT) ? Number(process.env.PORT) + 100 : 4000);
app.listen(port, () => {
  console.log(`API 서버: http://localhost:${port}`);
  if (serveScreen) console.log(`화면(빌드본): http://localhost:${port}`);
  startScheduler();
  // 신기술 탐지는 처음 계산이 10초 넘게 걸려서, 서버가 켜지고 잠시 뒤 자주 보는 조건을 미리 계산해 둔다
  setTimeout(() => warmUpEmerging(), 5_000).unref();
});
