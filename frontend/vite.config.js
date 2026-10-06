import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // /api 요청은 Express 백엔드로 전달 (backend/.env의 API_PORT와 맞출 것)
    proxy: { '/api': 'http://localhost:4000' },
    // GitHub Codespaces는 *.app.github.dev 주소로 접속하는데, Vite는 허용 목록에 없는 호스트를 막는다
    allowedHosts: ['.app.github.dev'],
  },
})
