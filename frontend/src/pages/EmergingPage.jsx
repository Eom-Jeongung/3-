import { useEffect, useState } from 'react'
import FieldPicker, { scopeHref, scopeLabel } from '../components/FieldPicker.jsx'
import PatentDetail from '../components/PatentDetail.jsx'

const COMPANY_OPTIONS = [
  { value: '', label: '둘 다' },
  { value: 'own', label: '자사' },
  { value: 'competitor', label: '경쟁사' },
]
const COMPANY_SHORT = { own: '자사', competitor: '경쟁사' }
const MONTH_OPTIONS = [12, 24, 36]
const formatDate = (iso) => (iso ? iso.replaceAll('-', '.') : '-')
const pct = (n) => `${n < 0.1 ? n.toFixed(2) : n.toFixed(1)}%`

// 신기술 탐지: 최근 공개된 특허에서 예전보다 눈에 띄게 많이 나온 용어 (AI 없이 계산)
export default function EmergingPage({ scope, refreshKey }) {
  const [company, setCompany] = useState('')
  const [months, setMonths] = useState(24)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const { level1 = '', level2 = '', level3 = '' } = scope
  const label = scopeLabel(scope)

  useEffect(() => {
    let cancelled = false
    const q = new URLSearchParams({ months })
    if (company) q.set('company', company)
    for (const [k, v] of Object.entries({ level1, level2, level3 })) if (v) q.set(k, v)
    setLoading(true)
    fetch(`/api/trends/emerging?${q}`)
      .then((r) => (r.ok ? r.json() : r.json().then((b) => Promise.reject(new Error(b.error ?? `HTTP ${r.status}`)))))
      .then((body) => { if (!cancelled) { setData(body); setError(null) } })
      .catch((e) => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [company, months, level1, level2, level3, refreshKey])

  return (
    <>
      <header className="hero hero-sm">
        <h1 className="page-title">신기술 탐지</h1>
        <p className="period">최근 공개된 특허에서 예전보다 눈에 띄게 많이 나온 용어를 찾아요. 새로 뜨는 기술의 신호로 볼 수 있어요.</p>
      </header>
      <div className="page-body">
        <section className="card" aria-labelledby="emerging-title">
          <h2 id="emerging-title" className="card-title">{label} 급증 용어</h2>
          <div className="trend-controls">
            <FieldPicker scope={scope} onChange={(s) => { window.location.hash = scopeHref('emerging', s) }} />
            <div className="filter-group">
              <span className="filter-label">출원인</span>
              {COMPANY_OPTIONS.map((c) => (
                <button key={c.value} className={`chip ${company === c.value ? 'active' : ''}`} aria-pressed={company === c.value} onClick={() => setCompany(c.value)}>{c.label}</button>
              ))}
            </div>
            <label className="filter-group">
              <span className="filter-label">최근 기간</span>
              <select className="filter-input" value={months} onChange={(e) => setMonths(Number(e.target.value))}>
                {MONTH_OPTIONS.map((m) => <option key={m} value={m}>최근 {m}개월</option>)}
              </select>
            </label>
          </div>

          {error && <p className="error">{error}</p>}
          {loading && <p className="placeholder-text">계산 중… (처음 한 번은 몇 초 걸려요)</p>}
          {data && !loading && (
            <>
              <p className="table-meta">
                공개일 기준 최근 {formatDate(data.recentStart)} ~ {formatDate(data.ref)} ({data.recent.toLocaleString('ko-KR')}건)과
                그 전 {formatDate(data.pastStart)} ~ ({data.past.toLocaleString('ko-KR')}건)을 비교했어요.
              </p>
              {data.rows.length === 0 ? (
                <p className="placeholder-text">눈에 띄게 늘어난 용어가 없어요. 분야를 넓히거나 기간을 바꿔 보세요.</p>
              ) : (
                <div className="table-wrap">
                  <table className="field-table">
                    <thead>
                      <tr>
                        <th scope="col">용어</th>
                        <th scope="col" className="num">최근 건수</th>
                        <th scope="col" className="num">이전 건수</th>
                        <th scope="col" className="num">비중 변화</th>
                        <th scope="col">이 용어가 나온 최근 특허</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.rows.map((r) => (
                        <tr key={r.term}>
                          <th scope="row">
                            {r.term} {r.isNew && <span className="type-tag own">새로 등장</span>}
                            {r.related.length > 0 && <div className="muted">비슷한 말: {r.related.join(', ')}</div>}
                          </th>
                          <td className="num">{r.recentDocs}</td>
                          <td className="num">{r.pastDocs}</td>
                          <td className="num">{pct(r.pastPct)} → <b>{pct(r.recentPct)}</b></td>
                          <td>
                            {r.examples.map((x) => (
                              <button key={x.id} className="appno-link emerging-example" onClick={() => setSelectedId(x.id)} title={x.applicationNumber}>
                                <span className="muted">{COMPANY_SHORT[x.type]}</span> {x.title}
                              </button>
                            ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="footnote">
                한 특허에 여러 번 나와도 1건으로 세요. 최근 기간에 5건 이상 나오고, 늘어난 정도가 우연으로 보기 어려운(0.1% 수준) 용어만 보여줘요.
                전체 특허의 8% 넘게 나오는 흔한 말은 뺐어요. 공개된 특허는 대체로 1년 반쯤 전에 출원한 기술이에요.
              </p>
            </>
          )}
        </section>
      </div>
      {selectedId && <PatentDetail id={selectedId} onClose={() => setSelectedId(null)} />}
    </>
  )
}
