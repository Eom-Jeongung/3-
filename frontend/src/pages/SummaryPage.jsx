import { useState } from 'react'
import AiSummaryPanel from '../components/AiSummaryPanel.jsx'
import FieldPicker, { scopeHref, scopeLabel } from '../components/FieldPicker.jsx'
import PatentDetail from '../components/PatentDetail.jsx'

// AI 동향 요약: 분야와 기간을 골라 자사·경쟁사 비교 요약을 만들고 본다. 고른 분야는 주소에 남는다
export default function SummaryPage({ scope }) {
  const [selectedId, setSelectedId] = useState(null)
  const label = scopeLabel(scope)

  return (
    <>
      <header className="hero hero-sm">
        <h1 className="page-title">AI 동향 요약</h1>
        <p className="period">분야와 기간을 고르면 자사와 경쟁사를 비교한 요약을 볼 수 있어요.</p>
      </header>
      <div className="page-body">
        <section className="card" aria-labelledby="summary-title">
          <h2 id="summary-title" className="card-title">{label} 동향 요약</h2>
          <div className="trend-controls">
            <FieldPicker scope={scope} onChange={(s) => { window.location.hash = scopeHref('summary', s) }} />
            <a className="more-link explorer-link" href={scopeHref('field', scope)}>{label} 추이 그래프 보기 →</a>
          </div>
          <AiSummaryPanel key={label} scope={scope} title={`${label} 동향 요약`} onOpenPatent={setSelectedId} />
        </section>
      </div>
      {selectedId && <PatentDetail id={selectedId} onClose={() => setSelectedId(null)} />}
    </>
  )
}
