import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// 배포 사이트에서 로그인이 풀리면(7일이 지나거나 비밀번호가 바뀌면) API가 401을 준다
// 그때 화면을 다시 불러오면 서버가 비밀번호 입력 화면을 보여 준다
const originalFetch = window.fetch.bind(window)
window.fetch = async (...args) => {
  const res = await originalFetch(...args)
  if (res.status === 401 && res.headers.get('content-type')?.includes('application/json')) {
    const body = await res.clone().json().catch(() => null)
    if (body?.login) window.location.reload()
  }
  return res
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
