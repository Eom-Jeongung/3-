import { useEffect, useState } from 'react'
import PatentDetail from './PatentDetail.jsx'
import TrendChart, { chartMax, seriesColor } from './TrendChart.jsx'
import AiSummaryPanel from './AiSummaryPanel.jsx'

const EVIDENCE_COLUMNS = ['출원번호', '발명의 명칭', '출원인', '공개일', '상태', '선정 이유']
// 1020230116992 -> 10-2023-0116992
const formatAppNo = (n) => (n?.length === 13 ? `${n.slice(0, 2)}-${n.slice(2, 6)}-${n.slice(6)}` : n)

const YEAR_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
const UNITS = [{ value: 'year', label: '연간' }, { value: 'half', label: '반기' }]
const COMPANY_OPTIONS = [
  { value: '', label: '전체' },
  { value: 'own', label: '자사' },
  { value: 'competitor', label: '삼성' },
  { value: 'china', label: '중국 4사' },
]
const COMPANY_NAMES = { own: '자사 (엘지디스플레이)', competitor: '경쟁사 (삼성디스플레이)', china: '중국 경쟁사 (BOE·CSOT·Tianma·Visionox 합계)' }
const COMPANY_SHORT = { own: '자사', competitor: '삼성', china: '중국 4사' }
const NOT_FIELD = ['미분류', '그 외']

const formatCount = (n) => n.toLocaleString('ko-KR')
const percent = (change) => (change === null ? '-' : `${change > 0 ? '+' : ''}${change}%`)

// 분야를 누르면 내려갈 주소 (전체 → 1차 → 2차 → 3차)
export function fieldHref(scope, groupLevel, group) {
  const q = new URLSearchParams()
  for (const k of ['level1', 'level2', 'level3']) if (scope[k]) q.set(k, scope[k])
  if (group) q.set(groupLevel, group)
  return `#/field?${q}`
}

// 기간·단위·출원인 설정, 분야별 출원 추이 그래프, 요약과 근거 수치 (트렌드 메인과 분야 화면이 함께 쓴다)
export default function TrendSection({ scope = {}, refreshKey, showAiSummary = true }) {
  const [years, setYears] = useState(5)
  const [unit, setUnit] = useState('year')
  const [company, setCompany] = useState('')
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [showTable, setShowTable] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const { level1, level2, level3 } = scope

  useEffect(() => {
    let cancelled = false
    const q = new URLSearchParams({ years, unit })
    if (company) q.set('company', company)
    if (level1) q.set('level1', level1)
    if (level2) q.set('level2', level2)
    if (level3) q.set('level3', level3)
    fetch(`/api/trends/series?${q}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((body) => { if (!cancelled) { setData(body); setError(null) } })
      .catch((e) => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [years, unit, company, level1, level2, level3, refreshKey])

  const summary = data?.summary
  // 자사·삼성은 같은 눈금으로 비교하고, 건수가 훨씬 적은 중국 4사는 따로 눈금을 잡는다 (같은 눈금이면 바닥에 붙어 안 보인다)
  const korean = data ? data.companies.filter((c) => c !== 'china') : []
  const yMax = data && korean.length ? chartMax({ ...data, companies: korean }) : 0
  const chinaMax = data?.companies.includes('china') ? chartMax({ ...data, companies: ['china'] }) : 0
  const canDrill = (group) => data?.groupLevel && !NOT_FIELD.includes(group)

  return (
    <section className="card" aria-labelledby="trend-title">
      <h2 id="trend-title" className="card-title">{[level1, level2, level3].filter(Boolean).join(' › ') || '전체 분야'} 출원 추이</h2>

      <div className="trend-controls">
        <label className="filter-group">
          <span className="filter-label">기간</span>
          <select className="filter-input" value={years} onChange={(e) => setYears(Number(e.target.value))}>
            {YEAR_OPTIONS.map((y) => <option key={y} value={y}>최근 {y}년</option>)}
          </select>
        </label>
        <div className="filter-group">
          <span className="filter-label">단위</span>
          {UNITS.map((u) => (
            <button key={u.value} className={`chip ${unit === u.value ? 'active' : ''}`} aria-pressed={unit === u.value} onClick={() => setUnit(u.value)}>{u.label}</button>
          ))}
        </div>
        <div className="filter-group">
          <span className="filter-label">출원인</span>
          {COMPANY_OPTIONS.map((c) => (
            <button key={c.value} className={`chip ${company === c.value ? 'active' : ''}`} aria-pressed={company === c.value} onClick={() => setCompany(c.value)}>{c.label}</button>
          ))}
        </div>
      </div>

      {error && <p className="error">추이를 불러오지 못했습니다: {error}</p>}
      {!data && !error && <p className="placeholder-text">그래프를 불러오는 중…</p>}

      {data && (
        <>
          <ul className="chart-legend" aria-label="범례">
            {data.groups.map((g) => (
              <li key={g}>
                <i style={{ background: seriesColor(g, data.groups) }} />
                {canDrill(g) ? <a href={fieldHref(scope, data.groupLevel, g)}>{g}</a> : g}
              </li>
            ))}
            <li className="chart-legend-note"><i className="chart-legend-shade" />미공개 출원 반영 전</li>
          </ul>

          <div className={`chart-grid-2 ${data.companies.length === 1 ? 'single' : ''}`}>
            {data.companies.map((c) => (
              <TrendChart key={c} title={`${COMPANY_NAMES[c]}${c === 'china' && korean.length ? ' · 눈금 다름' : ''}`} periods={data.periods} groups={data.groups} series={data.series[c]} yMax={(c === 'china' ? chinaMax : yMax) || 1} />
            ))}
          </div>

          <p className="footnote">
            출원일 기준이에요. 특허는 출원 후 보통 18개월 뒤 공개되어, {data.cutoff.replaceAll('-', '.')} 이후 출원은 아직 다 보이지 않아 음영으로 표시했어요.
            자사와 삼성 그래프는 눈금이 같고, 중국 4사는 건수가 훨씬 적어 눈금을 따로 잡았어요. 분류는 규칙 기반 자동 분류예요(무작위 검증 정확도 약 85%).
            중국 4사는 한국에 낸 출원만이라 실제 출원 규모보다 작게 보여요.
          </p>

          {data.chinaByCompany && (
            <div className="table-wrap chart-table">
              <table>
                <caption>중국 경쟁사 회사별 출원 건수 (이 분야)</caption>
                <thead>
                  <tr>
                    <th scope="col">회사</th>
                    {data.periods.map((p) => <th key={p.key} scope="col" className="num">{p.label}{p.incomplete ? ' *' : ''}</th>)}
                    <th scope="col" className="num">합계</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(data.chinaByCompany).map(([name, counts]) => (
                    <tr key={name}>
                      <th scope="row">{name}</th>
                      {counts.map((v, i) => <td key={data.periods[i].key} className="num">{formatCount(v)}</td>)}
                      <td className="num">{formatCount(counts.reduce((a, b) => a + b, 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <button className="more-link" onClick={() => setShowTable((s) => !s)} aria-expanded={showTable}>
            {showTable ? '표 닫기' : '그래프 값을 표로 보기'}
          </button>
          {showTable && (
            <div className="table-wrap chart-table">
              <table>
                <thead>
                  <tr>
                    <th scope="col">회사</th>
                    <th scope="col">분야</th>
                    {data.periods.map((p) => <th key={p.key} scope="col" className="num">{p.label}{p.incomplete ? ' *' : ''}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {data.companies.flatMap((c) => data.groups.map((g) => (
                    <tr key={`${c}${g}`}>
                      <td>{COMPANY_SHORT[c]}</td>
                      <th scope="row">{g}</th>
                      {data.series[c][g].map((v, i) => <td key={data.periods[i].key} className="num">{formatCount(v)}</td>)}
                    </tr>
                  )))}
                </tbody>
              </table>
              <p className="footnote">* 미공개 출원 반영 전</p>
            </div>
          )}

          {showAiSummary && <AiSummaryPanel scope={scope} onOpenPatent={setSelectedId} />}

          <div className="trend-summary">
            <div className="summary-box">
              <h3>증감 요약</h3>
              {!summary && <p className="placeholder-text">이 기간에는 공개가 끝난 구간이 부족해서 증감을 말하기 어려워요. 기간을 3년 이상으로 늘려 보세요.</p>}
              {summary && summary.highlights.length === 0 && <p className="placeholder-text">{summary.from}부터 {summary.to}까지 크게 움직인 분야가 없어요.</p>}
              {summary && summary.highlights.length > 0 && (
                <ul>
                  {summary.highlights.map((h) => (
                    <li key={`${h.company}${h.group}`}>
                      <b>{COMPANY_SHORT[h.company]}</b> {h.group} 출원은 {summary.from} {formatCount(h.first)}건에서 {summary.to} {formatCount(h.last)}건으로 <b>{percent(h.change)}</b> {h.change > 0 ? '늘었어요' : '줄었어요'}.
                    </li>
                  ))}
                </ul>
              )}
              <p className="ask-note">DB 숫자로 만든 규칙 기반 요약이에요. 그래프에서 고른 기간 기준이에요.</p>
            </div>

            {summary && (
              <div className="table-wrap summary-table">
                <table>
                  <caption>{summary.from} → {summary.to} 출원 건수 · 공개가 끝난 구간끼리 비교</caption>
                  <thead>
                    <tr>
                      <th scope="col">분야</th>
                      {data.companies.flatMap((c) => [
                        <th key={c} scope="col" className="num">{COMPANY_SHORT[c]}</th>,
                        <th key={`${c}c`} scope="col" className="num">증감</th>,
                      ])}
                    </tr>
                  </thead>
                  <tbody>
                    {summary.rows.map((r) => (
                      <tr key={r.group}>
                        <th scope="row">{canDrill(r.group) ? <a className="field-link" href={fieldHref(scope, data.groupLevel, r.group)}>{r.group}</a> : r.group}</th>
                        {data.companies.flatMap((c) => [
                          <td key={c} className="num">{formatCount(r[c].first)} → {formatCount(r[c].last)}</td>,
                          <td key={`${c}c`} className="num trend-change">{percent(r[c].change)}</td>,
                        ])}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="footnote">시작 구간 건수가 {data.minCount}건 미만이면 증감을 표시하지 않아요.</p>
              </div>
            )}
          </div>

          {summary && (
            <div className="evidence">
              <h3>근거 특허</h3>
              <p className="table-meta">
                많이 늘어난 분야에서 건수가 가장 많이 늘어난 세부 기술의 {summary.to} 출원 중, 최근 공개순으로 뽑은 예시예요. 중요도 순위는 아니에요.
              </p>
              {data.evidence.length === 0 && <p className="placeholder-text">이 조건에서는 늘어난 분야가 없어 뽑은 특허가 없어요.</p>}
              {data.evidence.length > 0 && (
                <div className="table-wrap">
                  <table className="evidence-table">
                    <thead>
                      <tr>{EVIDENCE_COLUMNS.map((c) => <th key={c} scope="col">{c}</th>)}</tr>
                    </thead>
                    <tbody>
                      {data.evidence.map((p) => (
                        <tr
                          key={p.id}
                          className="row-clickable"
                          tabIndex={0}
                          onClick={() => setSelectedId(p.id)}
                          onKeyDown={(e) => e.key === 'Enter' && setSelectedId(p.id)}
                          title="클릭하면 상세 보기"
                        >
                          <td className="mono">{formatAppNo(p.application_number)}</td>
                          <td className="title-cell" title={p.title}>{p.title}</td>
                          <td><span className={`type-tag ${p.applicant_type}`}>{COMPANY_SHORT[p.applicant_type]}</span></td>
                          <td className="mono">{p.open_date}</td>
                          <td><span className={`status ${p.legal_status === '등록' ? 'status-registered' : p.legal_status === '공개' ? 'status-pending' : ''}`}>{p.legal_status}</span></td>
                          <td className="evidence-reason">{p.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          {selectedId && <PatentDetail id={selectedId} onClose={() => setSelectedId(null)} />}
        </>
      )}
    </section>
  )
}
