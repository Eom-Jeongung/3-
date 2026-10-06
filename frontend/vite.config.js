import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // /api 요청은 Express 백엔드로 전달 (backend/.env의 PORT와 맞출 것)
    proxy: { '/api': 'http://localhost:4000' },
  },
})
