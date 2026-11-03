import { useState } from 'react'
import PatentDetail from '../components/PatentDetail.jsx'
import PatentTable from '../components/PatentTable.jsx'
import TrendSection from '../components/TrendSection.jsx'
import { usePatentList } from '../hooks/usePatentList.js'

const hrefOf = (levels) => `#/field?${new URLSearchParams(levels)}`

// 분야 드릴다운: 고른 분야의 추이와 특허 목록. 그래프 범례나 표의 분야를 누르면 한 단계 더 내려간다
export default function FieldPage({ scope, refreshKey }) {
  const [sort, setSort] = useState({ key: 'open_date', order: 'desc' })
  const [selectedId, setSelectedId] = useState(null)
  const { level1, level2, level3 } = scope

  const params = { sort: sort.key, order: sort.order }
  for (const k of ['level1', 'level2', 'level3']) if (scope[k]) params[k] = scope[k]
  const { data, error, loadingMore, loadMore, collapse } = usePatentList(params, refreshKey)

  // 위 단계로 돌아가는 경로
  const crumbs = [
    level1 && { label: level1, href: hrefOf({ level1 }) },
    level2 && { label: level2, href: hrefOf({ ...(level1 && { level1 }), level2 }) },
    level3 && { label: level3 },
  ].filter(Boolean)

  return (
    <>
      <header className="hero hero-sm">
        <h1 className="page-title">{level3 ?? level2 ?? level1 ?? '기술 분야'}</h1>
        <nav className="breadcrumb" aria-label="분야 경로">
          <a href="#/">전체</a>
          {crumbs.map((c) => (
            <span key={c.label}>
              {' › '}
              {c.href ? <a href={c.href}>{c.label}</a> : c.label}
            </span>
          ))}
        </nav>
      </header>

      <div className="page-body">
        <TrendSection scope={scope} refreshKey={refreshKey} />

        <section className="card card-gap" aria-labelledby="field-patents-title">
          <h2 id="field-patents-title" className="card-title">이 분야의 특허</h2>
          {error && <p className="error">{error}</p>}
          {!data && !error && <p className="placeholder-text">특허 목록을 불러오는 중…</p>}
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
            />
          )}
        </section>
      </div>

      {selectedId && <PatentDetail id={selectedId} onClose={() => setSelectedId(null)} />}
    </>
  )
}
