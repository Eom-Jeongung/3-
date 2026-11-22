import { useEffect, useState } from 'react'
import FilterBar, { EMPTY_FILTERS } from '../components/FilterBar.jsx'
import PatentDetail from '../components/PatentDetail.jsx'
import PatentTable from '../components/PatentTable.jsx'
import { usePatentList } from '../hooks/usePatentList.js'
import { jsonOrThrow } from '../format.js'

const queryOf = (filters, sort) => {
  const q = { sort: sort.key, order: sort.order }
  if (filters.applicantType) q.applicant_type = filters.applicantType
  if (filters.statuses.length) q.status = filters.statuses.join(',')
  if (filters.q.trim()) q.q = filters.q.trim()
  if (filters.openFrom) q.open_from = filters.openFrom
  if (filters.openTo) q.open_to = filters.openTo
  for (const level of ['level1', 'level2', 'level3']) {
    if (filters[level]) q[level] = filters[level]
  }
  if (filters.estimate) q.estimate = filters.estimate
  return q
}

export default function PatentsPage({ search }) {
  const [filters, setFilters] = useState(EMPTY_FILTERS)

  // 상단 검색창에서 찾으면 다른 필터를 풀고 그 검색어로 목록을 다시 받는다
  useEffect(() => {
    if (search) setFilters({ ...EMPTY_FILTERS, q: search.q })
  }, [search])
  const [sort, setSort] = useState({ key: 'open_date', order: 'desc' })
  const [classification, setClassification] = useState([]) // 기술 분야 필터 선택지
  const [optionsError, setOptionsError] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const { data, error: listError, loading, loadingMore, loadMore, collapse } = usePatentList(queryOf(filters, sort))
  const error = listError ?? optionsError

  useEffect(() => {
    fetch('/api/patents/filter-options')
      .then(jsonOrThrow)
      .then((body) => setClassification(body.classification))
      .catch((err) => setOptionsError(`필터를 불러오지 못했습니다: ${err.message}`))
  }, [])

  // 상단 요약 카드: 필터와 무관하게 출원인 구분 기준 건수
  const statuses = data?.statuses ?? []
  const total = statuses.reduce((sum, s) => sum + s.n, 0)
  const countOf = (status) => statuses.find((s) => s.legal_status === status)?.n ?? 0
  const stat = (n) => (data ? n.toLocaleString('ko-KR') : '–')

  // 검색 결과 안내: 검색 중이면 그 사실을, 끝나면 몇 건 찾았는지 알려 준다
  const searchWord = filters.q.trim()
  const otherFiltersOn = JSON.stringify({ ...filters, q: '' }) !== JSON.stringify(EMPTY_FILTERS)
  let searchMessage = null
  if (searchWord && loading) {
    searchMessage = `'${searchWord}' 검색 중…`
  } else if (searchWord && data && !error) {
    searchMessage = data.total > 0
      ? `'${searchWord}' 검색 결과 ${data.total.toLocaleString('ko-KR')}건을 찾았어요`
      : `'${searchWord}' 검색 결과가 없어요`
    if (otherFiltersOn) searchMessage += ' (다른 필터도 함께 적용됨)'
  }

  return (
    <>
      <header className="hero hero-sm">
        <h1 className="page-title">특허 모아보기</h1>
        <p className="period">엘지디스플레이(자사) · 삼성디스플레이(경쟁사) · 중국 4사 · KIPRIS 공개 데이터</p>
      </header>

      <div className="page-body">
      <section className="stats" aria-label="요약">
        <div className="stat">
          <span className="stat-label">전체 특허</span>
          <span className="stat-value">{stat(total)}<small>건</small></span>
        </div>
        <div className="stat">
          <span className="stat-label">등록</span>
          <span className="stat-value">{stat(countOf('등록'))}<small>건</small></span>
        </div>
        <div className="stat">
          <span className="stat-label">공개</span>
          <span className="stat-value">{stat(countOf('공개'))}<small>건</small></span>
        </div>
      </section>

      {error && <p className="error">{error}</p>}

      <section className="card">
        <FilterBar filters={filters} onChange={setFilters} statuses={statuses} classification={classification} />
        {/* 안내가 나타날 때 화면 읽기 프로그램도 읽도록 자리는 항상 둔다 */}
        <p className={`search-message ${searchMessage ? 'on' : ''}`} role="status">{searchMessage}</p>
        {data && (
          <PatentTable
            items={data.items}
            total={data.total}
            sort={sort}
            onSortChange={setSort}
            onSelect={setSelectedId}
            onLoadMore={loadMore}
            onCollapse={collapse}
            loadingMore={loadingMore}
            exportQuery={queryOf(filters, sort)}
          />
        )}
      </section>
      </div>

      {selectedId && <PatentDetail id={selectedId} onClose={() => setSelectedId(null)} />}
    </>
  )
}
