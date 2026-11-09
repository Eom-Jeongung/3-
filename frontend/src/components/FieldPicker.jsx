import { useEffect, useMemo, useState } from 'react'

const ALL = ''
const HIDDEN = ['미분류'] // 고를 필요가 없는 분류
let cache = null // 분류 목록은 화면마다 다시 받지 않는다

// 방식(1차) → 기술 분야(2차) → 세부 기술(3차) 선택 칸. 분야 분석·AI 동향 요약·신기술 탐지가 함께 쓴다
// scope = { level1, level2, level3 }, onChange(새 scope)
export default function FieldPicker({ scope, onChange }) {
  const [options, setOptions] = useState(cache ?? []) // [{ level1, level2, level3, n }]
  const { level1 = ALL, level2 = ALL, level3 = ALL } = scope

  useEffect(() => {
    if (cache) return
    fetch('/api/patents/filter-options')
      .then((r) => r.json())
      .then((body) => { cache = body.classification ?? []; setOptions(cache) })
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
    return { level1: count(options, 'level1'), level2: count(in1, 'level2'), level3: level2 ? count(in2, 'level3') : [] }
  }, [options, level1, level2])

  const select = (title, value, list, set, allLabel) => (
    <label className="filter-group">
      <span className="filter-label">{title}</span>
      <select className="filter-input" value={value} onChange={(e) => set(e.target.value)}>
        <option value={ALL}>{allLabel}</option>
        {/* 주소로 들어온 값이 목록에 아직 없어도 보이게 */}
        {value && !list.includes(value) && <option value={value}>{value}</option>}
        {list.map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
    </label>
  )

  return (
    <>
      {select('방식', level1, choices.level1, (v) => onChange({ level1: v, level2: ALL, level3: ALL }), '전체 (OLED·LCD 등)')}
      {select('기술 분야', level2, choices.level2, (v) => onChange({ level1, level2: v, level3: ALL }), '전체')}
      {select('세부 기술', level3, choices.level3, (v) => onChange({ level1, level2, level3: v }), level2 ? '전체' : '기술 분야를 먼저 고르세요')}
    </>
  )
}

/** { level1, level2 } → "#/field?level1=..&level2=.." (빈 값은 뺀다) */
export const scopeHref = (route, scope) => {
  const q = new URLSearchParams(Object.entries(scope).filter(([k, v]) => v && ['level1', 'level2', 'level3'].includes(k)))
  return `#/${route}${q.size ? `?${q}` : ''}`
}

export const scopeLabel = (scope) => [scope.level1, scope.level2, scope.level3].filter(Boolean).join(' › ') || '전체 분야'
