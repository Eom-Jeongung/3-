import { useState } from 'react'
import AiSummaryPanel from '../components/AiSummaryPanel.jsx'
import TechReportPanel from '../components/TechReportPanel.jsx'
import FieldPicker, { scopeHref, scopeLabel } from '../components/FieldPicker.jsx'
import PatentDetail from '../components/PatentDetail.jsx'

// 요약 종류: 건수 요약(AiSummaryPanel, 기존 그대로)과 기술 분석(TechReportPanel, 2026-11-23 추가)
const KINDS = [
  { kind: 'count', label: '건수 요약', hint: '회사·분야별 건수와 증감을 한 화면으로 정리해요.' },
  { kind: 'tech', label: '기술 분석', hint: '근거 특허를 읽고 시기별 기술 흐름과 경쟁사 차이를 보고서로 정리해요.' },
]

// 고른 종류를 주소에 남긴다 (분야를 바꿔도, 새로고침해도 유지)
const hrefWithKind = (scope, kind) => {
  const href = scopeHref('summary', scope)
  return kind === 'tech' ? `${href}${href.includes('?') ? '&' : '?'}kind=tech` : href
}

// AI 동향 요약: 분야와 기간을 골라 자사·경쟁사 비교 요약을 만들고 본다. 고른 분야는 주소에 남는다
export default function SummaryPage({ scope }) {
  const [selectedId, setSelectedId] = useState(null)
  const label = scopeLabel(scope)
  const kind = scope.kind === 'tech' ? 'tech' : 'count'
  const info = KINDS.find((k) => k.kind === kind)

  return (
    <>
      <header className="hero hero-sm">
        <h1 className="page-title">AI 동향 요약</h1>
        <p className="period">분야와 기간을 고르고, 건수 요약이나 기술 분석 중 하나를 골라 볼 수 있어요.</p>
      </header>
      <div className="page-body">
        <section className="card" aria-labelledby="summary-title">
          <h2 id="summary-title" className="card-title">{label} {kind === 'tech' ? '기술 분석' : '동향 요약'}</h2>
          <div className="trend-controls">
            <FieldPicker scope={scope} onChange={(s) => { window.location.hash = hrefWithKind(s, kind) }} />
            <a className="more-link explorer-link" href={scopeHref('field', scope)}>{label} 추이 그래프 보기 →</a>
          </div>
          <div className="kind-picker">
            <div className="filter-group" role="group" aria-label="요약 종류">
              {KINDS.map((k) => (
                <a key={k.kind} className={`chip ${kind === k.kind ? 'active' : ''}`} aria-current={kind === k.kind || undefined} href={hrefWithKind(scope, k.kind)}>
                  {k.label}
                </a>
              ))}
            </div>
            <p className="table-meta">{info.hint}</p>
          </div>
          {kind === 'tech'
            ? <TechReportPanel key={`tech-${label}`} scope={scope} title={`${label} 기술 분석`} onOpenPatent={setSelectedId} />
            : <AiSummaryPanel key={label} scope={scope} title={`${label} 동향 요약`} onOpenPatent={setSelectedId} />}
        </section>
      </div>
      {selectedId && <PatentDetail id={selectedId} onClose={() => setSelectedId(null)} />}
    </>
  )
}
