import { useEffect, useMemo, useState } from 'react'
import AiSummaryPanel from './AiSummaryPanel.jsx'
import PatentDetail from './PatentDetail.jsx'

const ALL = ''
const HIDDEN = ['미분류'] // 고를 필요가 없는 분류

// 홈의 "분야별 동향 요약": 방식(1차) → 기술 분야(2차) → 세부 기술(3차)과 기간을 골라 AI 요약을 본다
export default function SummaryExplorer() {
  const [options, setOptions] = useState([]) // [{ level1, level2, level3, n }]
  const [level1, setLevel1] = useState(ALL)
  const [level2, setLevel2] = useState(ALL)
  const [level3, setLevel3] = useState(ALL)
  const [selectedId, setSelectedId] = useState(null)

  useEffect(() => {
    fetch('/api/patents/filter-options')
      .then((r) => r.json())
      .then((body) => setOptions(body.classification ?? []))
      .catch(() => setOptions([]))
  }, [])

  // 고른 상위 분류 안에 있는 하위 분류만, 건수가 많은 순서로
  const choices = useMemo(() => {
    const count = (rows, key) => {
      const m = new Map()
      for (const r of rows) if (r[key] && !HIDDEN.includes(r[key])) m.set(r[key], (m.get(r[key]) ?? 0) + r.n)
      return [...m].sort((a, b) => b[1] - a[1]).map(([name]) => name)
    }
    const in1 = options.filter((r) => !level1 || r.level1 === level1)
    const in2 = in1.filter((r) => !level2 || r.level2 === level2)
    return { level1: count(options, 'level1'), level2: count(in1, 'level2'), level3: count(in2, 'level3') }
  }, [options, level1, level2])

  const scope = { level1, level2, level3 }
  const label = [level1, level2, level3].filter(Boolean).join(' › ') || '전체 분야'
  const fieldHref = `#/field?${new URLSearchParams(Object.fromEntries(Object.entries(scope).filter(([, v]) => v)))}`

  const select = (title, value, list, onChange, allLabel) => (
    <label className="filter-group">
      <span className="filter-label">{title}</span>
      <select className="filter-input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value={ALL}>{allLabel}</option>
        {list.map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
    </label>
  )

  return (
    <section className="card" aria-labelledby="explorer-title">
      <h2 id="explorer-title" className="card-title">분야별 동향 요약</h2>
      <p className="table-meta">요약하고 싶은 분야와 기간을 고르세요. 자사와 경쟁사를 비교한 동향 요약을 볼 수 있어요.</p>
      <div className="trend-controls">
        {select('방식', level1, choices.level1, (v) => { setLevel1(v); setLevel2(ALL); setLevel3(ALL) }, '전체 (OLED·LCD 등)')}
        {select('기술 분야', level2, choices.level2, (v) => { setLevel2(v); setLevel3(ALL) }, '전체')}
        {select('세부 기술', level3, choices.level3, setLevel3, level2 ? '전체' : '기술 분야를 먼저 고르세요')}
        <a className="more-link explorer-link" href={fieldHref}>{label} 추이 그래프·특허 보기 →</a>
      </div>
      <AiSummaryPanel key={label} scope={scope} title={`${label} 동향 요약`} onOpenPatent={setSelectedId} />
      {selectedId && <PatentDetail id={selectedId} onClose={() => setSelectedId(null)} />}
    </section>
  )
}
