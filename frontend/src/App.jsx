import { useCallback, useEffect, useState } from 'react'
import Icon from './components/Icon.jsx'
import EmergingPage from './pages/EmergingPage.jsx'
import FieldPage from './pages/FieldPage.jsx'
import HomePage from './pages/HomePage.jsx'
import PatentsPage from './pages/PatentsPage.jsx'
import SummaryPage from './pages/SummaryPage.jsx'

const formatDateTime = (iso) =>
  iso ? new Date(iso).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }) : '-'

// 왼쪽 사이드바 메뉴 (Figma 'DISPLAY INSIGHT' 시안). 지금 있는 화면 5개에 맞췄다
const MENUS = [
  { route: 'home', href: '#/', label: '대시보드', icon: 'grid' },
  { route: 'field', href: '#/field', label: '기술 분야별 분석', icon: 'chart' },
  { route: 'summary', href: '#/summary', label: 'AI 동향 요약', icon: 'sparkle', badge: 'AI' },
  { route: 'emerging', href: '#/emerging', label: '신기술 탐지', icon: 'radar' },
  { route: 'patents', href: '#/patents', label: '특허 목록', icon: 'docs' },
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
  const [searchText, setSearchText] = useState('')
  const [search, setSearch] = useState(null) // 상단 검색 → 특허 목록 검색어로 넘긴다 ({ q, n }: 같은 말로 다시 찾아도 반영되게 n을 올린다)
  const [navOpen, setNavOpen] = useState(false) // 좁은 화면에서 사이드바 열기

  useEffect(() => {
    const onHashChange = () => {
      setHash(window.location.hash)
      setNavOpen(false)
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

  function handleSearch(e) {
    e.preventDefault()
    setSearch((s) => ({ q: searchText.trim(), n: (s?.n ?? 0) + 1 }))
    window.location.hash = '#/patents'
  }

  return (
    <div className={`shell ${navOpen ? 'nav-open' : ''}`}>
      <aside className="sidebar" aria-label="메뉴">
        <a className="side-brand" href="#/">
          <span className="side-logo"><Icon name="layers" /></span>
          <span className="side-brand-text">DISPLAY<br />INSIGHT</span>
        </a>
        <p className="side-section">WORKSPACE</p>
        <nav className="side-menu">
          {MENUS.map((m) => (
            <a key={m.route} href={m.href} className={`side-link ${route === m.route ? 'active' : ''}`} aria-current={route === m.route ? 'page' : undefined}>
              <Icon name={m.icon} />
              <span>{m.label}</span>
              {m.badge && <span className="side-badge">{m.badge}</span>}
            </a>
          ))}
        </nav>

        <div className="side-sync">
          <span className="side-sync-label">데이터 마지막 갱신</span>
          <strong>{formatDateTime(overview?.lastSyncedAt)}</strong>
          {syncMsg && <span className="side-sync-msg" role="status">{syncMsg}</span>}
          <button onClick={handleSync} disabled={syncing}>
            <Icon name="refresh" />{syncing ? '갱신 중…' : '새로고침'}
          </button>
        </div>
        <div className="side-foot">
          <span className="side-avatar">LG</span>
          <span>
            <b>특허 트렌드 센싱</b>
            <small>KIPRIS 공개 데이터</small>
          </span>
        </div>
      </aside>
      {navOpen && <div className="side-scrim" onClick={() => setNavOpen(false)} aria-hidden="true" />}

      <div className="shell-main">
        <header className="topbar">
          <button className="nav-toggle" onClick={() => setNavOpen((o) => !o)} aria-label="메뉴 열기" aria-expanded={navOpen}>
            <Icon name="menu" />
          </button>
          <form className="top-search" role="search" onSubmit={handleSearch}>
            <Icon name="search" />
            <input
              type="search"
              placeholder="특허 명칭·초록에서 기술 키워드를 검색하세요 (예: 탠덤, 봉지)"
              aria-label="특허 검색"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
            />
            <kbd>Enter</kbd>
          </form>
          <span className="top-period">
            <Icon name="calendar" />
            <b>공개일 기준</b>
            <span>{overview?.windows?.[0] ? `${overview.windows[2].from.slice(0, 4)} – ${overview.windows[0].to.slice(0, 4)}` : '-'}</span>
          </span>
        </header>

        <main>
          {error && <p className="error page-error">{error}</p>}
          {/* 메뉴를 오가도 모아보기의 필터·펼친 목록이 유지되도록 화면을 지우지 않고 숨긴다 */}
          <div hidden={route !== 'home'}><HomePage overview={overview} refreshKey={refreshKey} /></div>
          {route === 'field' && <FieldPage key={hash} scope={scopeOf(hash)} refreshKey={refreshKey} />}
          {route === 'summary' && <SummaryPage scope={scopeOf(hash)} />}
          {route === 'emerging' && <EmergingPage scope={scopeOf(hash)} refreshKey={refreshKey} />}
          <div hidden={route !== 'patents'}><PatentsPage refreshKey={refreshKey} search={search} /></div>
        </main>
      </div>
    </div>
  )
}
