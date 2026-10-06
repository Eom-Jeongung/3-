// Express 앱 진입점
import express from 'express';
import { initSchema } from './db.js';
import patentsRouter from './routes/patents.js';
import syncRouter from './routes/sync.js';
import techCategoriesRouter from './routes/techCategories.js';

initSchema();

const app = express();
app.use(express.json());

app.use('/api/patents', patentsRouter);
app.use('/api/sync', syncRouter);
app.use('/api/tech-categories', techCategoriesRouter);

// PORT가 아닌 API_PORT를 쓴다: 미리보기·호스팅 환경이 PORT를 프론트엔드용으로 미리 넣어두는 경우가 있어 충돌함
const port = Number(process.env.API_PORT) || 4000;
app.listen(port, () => console.log(`API 서버: http://localhost:${port}`));
