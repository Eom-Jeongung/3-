import { useCallback, useEffect, useState } from 'react'
import EmergingPage from './pages/EmergingPage.jsx'
import FieldPage from './pages/FieldPage.jsx'
import HomePage from './pages/HomePage.jsx'
import PatentsPage from './pages/PatentsPage.jsx'
import SummaryPage from './pages/SummaryPage.jsx'

const formatDateTime = (iso) =>
  iso ? new Date(iso).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }) : '-'

const MENUS = [
  { route: 'home', href: '#/', label: '홈' },
  { route: 'field', href: '#/field', label: '기술 분야별 분석' },
  { route: 'summary', href: '#/summary', label: 'AI 동향 요약' },
  { route: 'emerging', href: '#/emerging', label: '신기술 탐지' },
  { route: 'patents', href: '#/patents', label: '특허 목록' },
]

const routeOf = (hash) => {
  if (hash.startsWith('#/patents')) return 'patents'
  if (hash.startsWith('#/field')) return 'field'
  if (hash.startsWith('#/summary')) return 'summary'
  if (hash.startsWith('#/emerging')) return 'emerging'
  return 'home'
}
// #/field?level1=OLED&level2=설계 → { level1: 'OLED', level2: '설계' }
const scopeOf = (hash) => Object.fromEntries(new URLSearchParams(hash.split('?')[1] ?? ''))

export default function App() {
  const [hash, setHash] = useState(window.location.hash)
  const route = routeOf(hash)
  const [overview, setOverview] = useState(null)
  const [error, setError] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const onHashChange = () => {
      setHash(window.location.hash)
      window.scrollTo({ top: 0 })
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const loadOverview = useCallback(async () => {
    try {
      const res = await fetch('/api/trends/overview')
      if (!res.ok) throw new Error((await res.json()).error)
      setOverview(await res.json())
      setError(null)
    } catch (err) {
      setError(`트렌드를 불러오지 못했습니다: ${err.message}`)
    }
  }, [])

  useEffect(() => { loadOverview() }, [loadOverview])

  async function handleSync() {
    setSyncing(true)
    try {
      const res = await fetch('/api/sync', { method: 'POST' })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error)
      // 새로고침은 마지막으로 받은 날짜 이후 새로 공개·등록된 특허만 가져온다
      setSyncMsg(body.added ? `새 특허 ${body.added.toLocaleString('ko-KR')}건 추가` : '새로 추가된 특허 없음')
      await loadOverview()
      setRefreshKey((k) => k + 1)
    } catch (err) {
      setError(`새로고침 실패: ${err.message}`)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <>
      <nav className="topbar" aria-label="상단 메뉴">
        <div className="topbar-inner">
          <div className="topbar-left">
            <span className="brand">특허 트렌드 센싱</span>
            <div className="menu">
              {MENUS.map((m) => (
                <a key={m.route} href={m.href} className={`menu-link ${route === m.route ? 'active' : ''}`} aria-current={route === m.route ? 'page' : undefined}>
                  {m.label}
                </a>
              ))}
            </div>
          </div>
          <div className="sync-box">
            {syncMsg && <span className="sync-msg" role="status">{syncMsg}</span>}
            <span className="sync-time">마지막 갱신 <strong>{formatDateTime(overview?.lastSyncedAt)}</strong></span>
            <button onClick={handleSync} disabled={syncing}>
              {syncing ? '갱신 중…' : '새로고침'}
            </button>
          </div>
        </div>
      </nav>

      <main>
        {error && <p className="error page-error">{error}</p>}
        {/* 메뉴를 오가도 모아보기의 필터·펼친 목록이 유지되도록 화면을 지우지 않고 숨긴다 */}
        <div hidden={route !== 'home'}><HomePage overview={overview} refreshKey={refreshKey} /></div>
        {route === 'field' && <FieldPage key={hash} scope={scopeOf(hash)} refreshKey={refreshKey} />}
        {route === 'summary' && <SummaryPage scope={scopeOf(hash)} />}
        {route === 'emerging' && <EmergingPage scope={scopeOf(hash)} refreshKey={refreshKey} />}
        <div hidden={route !== 'patents'}><PatentsPage refreshKey={refreshKey} /></div>
      </main>
    </>
  )
}
