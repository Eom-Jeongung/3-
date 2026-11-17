import { useCallback, useEffect, useState } from 'react'
import GuideDialog from './components/GuideDialog.jsx'
import Icon from './components/Icon.jsx'
import EmergingPage from './pages/EmergingPage.jsx'
import FieldPage from './pages/FieldPage.jsx'
import HomePage, { httpMessage } from './pages/HomePage.jsx'
import PatentsPage from './pages/PatentsPage.jsx'
import SummaryPage from './pages/SummaryPage.jsx'

const AUTO_SYNC_DAYS = 90 // 서버 SYNC_INTERVAL_DAYS 기본값과 같게

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
  const [searchText, setSearchText] = useState('')
  const [search, setSearch] = useState(null) // 상단 검색 → 특허 목록 검색어로 넘긴다 ({ q, n }: 같은 말로 다시 찾아도 반영되게 n을 올린다)
  const [navOpen, setNavOpen] = useState(false) // 좁은 화면에서 사이드바 열기
  const [guideOpen, setGuideOpen] = useState(false) // 1분 사용 안내
  const closeGuide = useCallback(() => setGuideOpen(false), [])

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
      setError(null)
      const res = await fetch('/api/trends/overview')
      // 서버가 꺼졌을 때는 JSON이 아닌 오류 화면이 오므로 상태 코드로 알려 준다
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? httpMessage(res.status))
      setOverview(await res.json())
    } catch (err) {
      setError(`트렌드를 불러오지 못했습니다: ${err.message === 'Failed to fetch' ? '서버에 연결할 수 없어요' : err.message}`)
    }
  }, [])

  useEffect(() => { loadOverview() }, [loadOverview])

  // 새 특허는 서버가 마지막 갱신 후 90일(분기)마다 자동으로 받아온다 (backend/src/scheduler.js). 그래서 새로고침 버튼은 없앴다
  const nextSync = overview?.lastSyncedAt ? new Date(new Date(overview.lastSyncedAt).getTime() + AUTO_SYNC_DAYS * 86_400_000) : null

  function handleSearch(e) {
    e.preventDefault()
    setSearch((s) => ({ q: searchText.trim(), n: (s?.n ?? 0) + 1 }))
    window.location.hash = '#/patents'
  }

  return (
    <div className={`shell ${navOpen ? 'nav-open' : ''}`}>
      <aside className="sidebar" aria-label="메뉴">
        <a className="side-brand" href="#/">
          <span className="side-avatar side-logo">LG</span>
          <span className="side-brand-text">LG Display<br /><small>특허 트렌드 센싱</small></span>
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

        <button className="side-guide" onClick={() => { setGuideOpen(true); setNavOpen(false) }}>
          <Icon name="docs" />
          <span>1분 사용 안내</span>
        </button>
        <div className="side-sync">
          <span className="side-sync-label">데이터 마지막 갱신</span>
          <strong>{formatDateTime(overview?.lastSyncedAt)}</strong>
          {nextSync && (
            <span className="side-sync-next">
              <Icon name="refresh" />
              분기마다 자동 갱신 · 다음 {nextSync.getFullYear()}.{nextSync.getMonth() + 1}.{nextSync.getDate()}쯤
            </span>
          )}
        </div>
      </aside>
      {navOpen && <div className="side-scrim" onClick={() => setNavOpen(false)} aria-hidden="true" />}
      {guideOpen && <GuideDialog onClose={closeGuide} />}

      <div className="shell-main">
        <header className="topbar">
          <button className="nav-toggle" onClick={() => setNavOpen((o) => !o)} aria-label="메뉴 열기" aria-expanded={navOpen}>
            <Icon name="menu" />
          </button>
          {/* 좁은 화면에서는 사이드바가 숨으니 첫 화면에 제품 이름을 따로 보여 준다 */}
          <a className="top-brand" href="#/">
            <span className="side-avatar">LG</span>
            <span>LG Display <b>특허 트렌드 센싱</b></span>
          </a>
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
          {/* 대시보드는 카드마다 실패 안내를 따로 보여 주므로, 위쪽 오류 줄은 다른 화면에서만 */}
          {error && route !== 'home' && <p className="error page-error">{error}</p>}
          {/* 메뉴를 오가도 모아보기의 필터·펼친 목록이 유지되도록 화면을 지우지 않고 숨긴다 */}
          <div hidden={route !== 'home'}><HomePage overview={overview} overviewError={error} onRetryOverview={loadOverview} /></div>
          {route === 'field' && <FieldPage key={hash} scope={scopeOf(hash)} />}
          {route === 'summary' && <SummaryPage scope={scopeOf(hash)} />}
          {route === 'emerging' && <EmergingPage scope={scopeOf(hash)} />}
          <div hidden={route !== 'patents'}><PatentsPage search={search} /></div>
        </main>
      </div>
    </div>
  )
}
