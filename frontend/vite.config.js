import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // backend/.env의 API_PORT를 같이 읽어서 백엔드와 같은 포트로 /api를 보낸다
  const env = loadEnv(mode, '../backend', '')
  const webPort = Number(process.env.PORT) || 5173
  // 천안 서버: 화면은 $PORT, 백엔드는 $PORT + 100 (backend/src/index.js와 같은 규칙)
  const apiPort = Number(env.API_PORT) || (Number(process.env.PORT) ? webPort + 100 : 4000)

  return {
    plugins: [react()],
    server: {
      port: webPort,
      // 공용 서버라 다른 포트로 몰래 넘어가지 않게 한다 (남의 포트 침범 방지)
      strictPort: true,
      // /api 요청은 Express 백엔드로 전달
      proxy: { '/api': `http://localhost:${apiPort}` },
      // GitHub Codespaces는 *.app.github.dev 주소로 접속하는데, Vite는 허용 목록에 없는 호스트를 막는다
      allowedHosts: ['.app.github.dev'],
    },
  }
})
