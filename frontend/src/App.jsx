import { useCallback, useEffect, useState } from 'react'
import FilterBar from './components/FilterBar.jsx'
import PatentDetail from './components/PatentDetail.jsx'
import PatentTable from './components/PatentTable.jsx'
import TechCategoryCompare from './components/TechCategoryCompare.jsx'

const formatDateTime = (iso) =>
  iso ? new Date(iso).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }) : '-'

export default function App() {
  const [filters, setFilters] = useState({ applicantType: '', statuses: [], expiringOnly: false })
  const [sort, setSort] = useState({ key: 'expiry_date', order: 'asc' })
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [selectedId, setSelectedId] = useState(null)

  const load = useCallback(async () => {
    const q = new URLSearchParams({ sort: sort.key, order: sort.order })
    if (filters.applicantType) q.set('applicant_type', filters.applicantType)
    if (filters.statuses.length) q.set('status', filters.statuses.join(','))
    if (filters.expiringOnly) q.set('expiring', 'true')
    try {
      const res = await fetch(`/api/patents?${q}`)
      if (!res.ok) throw new Error((await res.json()).error)
      setData(await res.json())
      setError(null)
    } catch (err) {
      setError(`목록을 불러오지 못했습니다: ${err.message}`)
    }
  }, [filters, sort])

  useEffect(() => { load() }, [load])

  async function handleSync() {
    setSyncing(true)
    try {
      const res = await fetch('/api/sync', { method: 'POST' })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error)
      await load()
    } catch (err) {
      setError(`새로고침 실패: ${err.message}`)
    } finally {
      setSyncing(false)
    }
  }

  // 상단 요약 카드: 필터와 무관하게 출원인 구분(자사/경쟁사) 기준 건수
  const total = (data?.statuses ?? []).reduce((sum, s) => sum + s.n, 0)
  const registered = (data?.statuses ?? []).find((s) => s.legal_status === '등록')?.n ?? 0
  const stat = (n) => (data ? n.toLocaleString('ko-KR') : '–')

  return (
    <>
      <nav className="topbar" aria-label="상단 메뉴">
        <div className="topbar-inner">
          <span className="brand">특허 현황</span>
          <div className="sync-box">
            <span className="sync-time">마지막 갱신 <strong>{formatDateTime(data?.lastSyncedAt)}</strong></span>
            <button onClick={handleSync} disabled={syncing}>
              {syncing ? '갱신 중…' : '새로고침'}
            </button>
          </div>
        </div>
      </nav>

      <main className="page">
        <header className="page-header hero">
          <span className="draft-tag">가정 검증용 초안</span>
          <h1>특허 현황 대시보드</h1>
          <p className="subtitle">엘지디스플레이(자사) · 삼성디스플레이(경쟁사)<br />KIPRIS 공개 데이터 샘플로 만든 데모입니다.</p>
        </header>

        <section className="stats" aria-label="요약">
          <div className="stat">
            <span className="stat-label">전체 특허</span>
            <span className="stat-value">{stat(total)}<small>건</small></span>
          </div>
          <div className="stat">
            <span className="stat-label">등록 유지</span>
            <span className="stat-value">{stat(registered)}<small>건</small></span>
          </div>
          <div className="stat stat-alert">
            <span className="stat-label">{data?.expiringMonths ?? 6}개월 내 만료</span>
            <span className="stat-value">{stat(data?.expiringCount ?? 0)}<small>건</small></span>
          </div>
        </section>

        {error && <p className="error">{error}</p>}

      <section className="card">
        <FilterBar
          filters={filters}
          onChange={setFilters}
          statuses={data?.statuses ?? []}
          expiringCount={data?.expiringCount ?? 0}
          expiringMonths={data?.expiringMonths ?? 6}
        />
        {data && (
          <PatentTable
            key={JSON.stringify([filters, sort])}
            items={data.items}
            expiringMonths={data.expiringMonths}
            sort={sort}
            onSortChange={setSort}
            onSelect={setSelectedId}
          />
        )}
      </section>

      <TechCategoryCompare refreshKey={data?.lastSyncedAt} />

      {selectedId && <PatentDetail id={selectedId} onClose={() => setSelectedId(null)} />}
      </main>
    </>
  )
}
