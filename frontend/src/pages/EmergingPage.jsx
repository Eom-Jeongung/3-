import { useEffect, useState } from 'react'
import FieldPicker, { scopeHref, scopeLabel } from '../components/FieldPicker.jsx'
import PatentDetail from '../components/PatentDetail.jsx'
import { COMPANY_OPTIONS, jsonOrThrow } from '../format.js'

const COMPANY_SHORT = { own: '자사', competitor: '삼성', china: '중국' }
const MONTH_OPTIONS = [12, 24, 36]
const formatDate = (iso) => (iso ? iso.replaceAll('-', '.') : '-')
const formatShare = (n) => `${n < 0.1 ? n.toFixed(2) : n.toFixed(1)}%`

const PATENT_PREVIEW = 3 // 카드마다 처음에 보여 줄 특허 수. "모두 보기"를 누르면 전부(최대 30건)
const TERMS_PER_PAGE = 5 // 처음에 보여 줄 용어 수. "더 보기"를 누를 때마다 5개씩 늘어난다

// 용어 목록: 용어마다 카드 한 장 (용어 · 건수 · 비중 변화 · 그 용어가 나온 최근 특허)
// 한 화면에 다 띄우지 않고 5개씩 끊어 본다. 조건이 바뀌면 부모가 key를 바꿔 처음(5개)부터 다시 보여 준다
function TermList({ rows, onOpen, showPast = false }) {
  const [shown, setShown] = useState(TERMS_PER_PAGE)
  const [open, setOpen] = useState(() => new Set())
  const toggle = (term) => setOpen((s) => { const n = new Set(s); if (n.has(term)) n.delete(term); else n.add(term); return n })
  const visible = rows.slice(0, shown)
  return (
    <>
      <ol className="term-list">
        {visible.map((r, i) => {
          const expanded = open.has(r.term)
          const list = expanded ? r.patents : r.patents.slice(0, PATENT_PREVIEW)
          return (
            <li key={r.term} className="term-card">
              <div className="term-main">
                <span className="term-rank">{i + 1}</span>
                <div>
                  <h4 className="term-name">
                    {r.term}
                    {showPast && r.isNew && <span className="type-tag own">새로 등장</span>}
                  </h4>
                  {r.related.length > 0 && <p className="term-related">비슷한 말: {r.related.slice(0, 3).join(', ')}</p>}
                </div>
              </div>
              <dl className="term-stats">
                <div><dt>최근</dt><dd><b>{r.recentDocs.toLocaleString('ko-KR')}</b>건</dd></div>
                {showPast && <div><dt>이전</dt><dd>{r.pastDocs.toLocaleString('ko-KR')}건</dd></div>}
                {showPast && <div><dt>비중 변화</dt><dd>{formatShare(r.pastPct)} → <b className="term-up">{formatShare(r.recentPct)}</b></dd></div>}
              </dl>
              <div className="term-patents">
                <p className="term-patents-title">이 용어가 나온 최근 특허</p>
                <ul>
                  {list.map((x) => (
                    <li key={x.id}>
                      <button className="term-patent" onClick={() => onOpen(x.id)} title={x.applicationNumber}>
                        <span className={`type-tag ${x.type}`}>{COMPANY_SHORT[x.type]}</span>
                        <span className="term-patent-date">{formatDate(x.date)}</span>
                        <span className="term-patent-title">{x.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                {r.patents.length > PATENT_PREVIEW && (
                  <button className="term-patents-toggle" onClick={() => toggle(r.term)} aria-expanded={expanded}>
                    {expanded ? '접기' : `특허 ${r.patents.length}건 모두 보기`}
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ol>
      {(rows.length > shown || shown > TERMS_PER_PAGE) && (
        <div className="term-more">
          {rows.length > shown && (
            <button className="more-btn" onClick={() => setShown((n) => n + TERMS_PER_PAGE)}>
              <span className="more-label">더보기</span>
              <span className="more-arrow">↓</span>
            </button>
          )}
          {shown > TERMS_PER_PAGE && (
            <button className="more-btn more-btn-quiet" onClick={() => setShown(TERMS_PER_PAGE)}>
              <span className="more-label">접기</span>
            </button>
          )}
          <span className="more-hint">{Math.min(shown, rows.length)} / {rows.length}개</span>
        </div>
      )}
    </>
  )
}

// 신기술 탐지: 최근 공개된 특허에서 예전보다 눈에 띄게 많이 나온 용어 (AI 없이 계산)
export default function EmergingPage({ scope }) {
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
      .then(jsonOrThrow)
      .then((body) => { if (!cancelled) { setData(body); setError(null) } })
      .catch((e) => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [company, months, level1, level2, level3])

  return (
    <>
      <header className="hero hero-sm">
        <h1 className="page-title">신기술 탐지</h1>
        <p className="period">최근 공개된 특허에서 예전보다 눈에 띄게 많이 나온 용어를 찾아요. 새로 뜨는 기술의 신호로 볼 수 있어요.</p>
      </header>
      <div className="page-body">
        <section className="card emerging-card" aria-labelledby="emerging-title">
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
              <h3 className="emerging-subtitle">급증 기술 <span className="muted">예전보다 눈에 띄게 많이 나온 용어 ({data.rows.length}개)</span></h3>
              {data.rows.length === 0
                ? <p className="placeholder-text">눈에 띄게 늘어난 용어가 없어요. 분야를 넓히거나 기간을 바꿔 보세요.</p>
                : <TermList key={`rows|${company}|${months}|${level1}|${level2}|${level3}`} rows={data.rows} onOpen={setSelectedId} showPast />}
              <p className="footnote">
                한 특허에 여러 번 나와도 1건으로 세요. 최근 기간에 5건 이상 나오고, 늘어난 정도가 우연으로 보기 어려운(0.1% 수준) 용어만 보여줘요.
                전체 특허의 8% 넘게 나오는 흔한 말은 뺐고, 같은 뜻의 다른 표기(마이크로 발광 다이오드 → 마이크로LED 등)는 하나로 셌어요.
                공개된 특허는 대체로 1년 반쯤 전에 출원한 기술이에요.
              </p>

              <h3 className="emerging-subtitle">초기 신호 <span className="muted">예전엔 한 건도 없다가 최근 3건 이상 나온 새 용어 ({data.early.length}개)</span></h3>
              {data.early.length === 0
                ? <p className="placeholder-text">새로 나타난 용어가 없어요.</p>
                : <TermList key={`early|${company}|${months}|${level1}|${level2}|${level3}`} rows={data.early} onOpen={setSelectedId} />}
              <p className="footnote">
                건수가 적어 우연일 수 있는 참고용 목록이에요. 막 나타나기 시작한 기술일 수 있으니 특허를 눌러 내용을 확인해 주세요.
                같은 발명을 나눠 낸 출원만으로 생긴 말을 거르려고, 명칭이 다른 특허 2건 이상에 나온 용어만 보여줘요.
              </p>
            </>
          )}
        </section>
      </div>
      {selectedId && <PatentDetail id={selectedId} onClose={() => setSelectedId(null)} />}
    </>
  )
}
