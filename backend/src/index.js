// Express 앱 진입점
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initSchema } from './db.js';
import patentsRouter from './routes/patents.js';
import syncRouter from './routes/sync.js';
import techCategoriesRouter from './routes/techCategories.js';
import trendsRouter from './routes/trends.js';
import askRouter from './routes/ask.js';
import summariesRouter from './routes/summaries.js';
import { startScheduler } from './scheduler.js';

initSchema();

const app = express();
app.use(express.json());

app.use('/api/patents', patentsRouter);
app.use('/api/sync', syncRouter);
app.use('/api/tech-categories', techCategoriesRouter);
app.use('/api/trends', trendsRouter);
app.use('/api/ask', askRouter);
app.use('/api/summaries', summariesRouter);

// 배포용: npm run build로 만든 화면(frontend/dist)이 있으면 이 서버가 같이 띄운다
// 개발 중(npm run dev)에는 Vite가 화면을 띄우므로 dist가 없어도 된다
// 화면은 주소의 # 뒤로 페이지를 나눠서, index.html 하나만 있으면 모든 페이지가 열린다
const distDir = fileURLToPath(new URL('../../frontend/dist', import.meta.url));
const serveScreen = fs.existsSync(path.join(distDir, 'index.html'));
if (serveScreen) app.use(express.static(distDir));

// PORT가 아닌 API_PORT를 쓴다: 미리보기·호스팅 환경이 PORT를 프론트엔드용으로 미리 넣어두는 경우가 있어 충돌함
// API_PORT가 없고 PORT만 있으면(천안 서버) 수업 규칙대로 PORT + 100을 쓴다
const port = Number(process.env.API_PORT) || (Number(process.env.PORT) ? Number(process.env.PORT) + 100 : 4000);
app.listen(port, () => {
  console.log(`API 서버: http://localhost:${port}`);
  if (serveScreen) console.log(`화면(빌드본): http://localhost:${port}`);
  startScheduler();
});
