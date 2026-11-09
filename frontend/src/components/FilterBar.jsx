import { useEffect, useState } from 'react'

const APPLICANT_TYPES = [
  { value: '', label: '전체' },
  { value: 'own', label: '자사' },
  { value: 'competitor', label: '경쟁사' },
]

const SEARCH_DELAY_MS = 300 // 글자를 칠 때마다 요청하지 않도록 잠깐 기다린다

export const EMPTY_FILTERS = { applicantType: '', statuses: [], q: '', openFrom: '', openTo: '', level1: '', level2: '', level3: '' }

const uniqueValues = (rows, key) => [...new Set(rows.map((r) => r[key]).filter(Boolean))]

export default function FilterBar({ filters, onChange, statuses, classification }) {
  const [text, setText] = useState(filters.q)

  useEffect(() => { setText(filters.q) }, [filters.q]) // 초기화 버튼을 누르면 입력칸도 비운다

  useEffect(() => {
    if (text === filters.q) return undefined
    const timer = setTimeout(() => onChange({ ...filters, q: text }), SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [text, filters, onChange])

  const toggleStatus = (s) => {
    const next = filters.statuses.includes(s)
      ? filters.statuses.filter((x) => x !== s)
      : [...filters.statuses, s]
    onChange({ ...filters, statuses: next })
  }

  // 위 단계를 고르면 그 아래 선택지만 남긴다 (예: 1차를 LCD로 고르면 LCD 특허가 있는 2차만)
  const level2Rows = classification.filter((r) => !filters.level1 || r.level1 === filters.level1)
  const level3Rows = level2Rows.filter((r) => !filters.level2 || r.level2 === filters.level2)
  const techLevels = [
    { key: 'level1', label: '1차', options: uniqueValues(classification, 'level1'), reset: { level2: '', level3: '' } },
    { key: 'level2', label: '2차', options: uniqueValues(level2Rows, 'level2'), reset: { level3: '' } },
    { key: 'level3', label: '3차', options: uniqueValues(level3Rows, 'level3'), reset: {} },
  ]
  const noClassification = classification.length === 0

  const active = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS)

  return (
    <div className="filter-bar">
      <form
        className="filter-group"
        role="search"
        onSubmit={(e) => {
          e.preventDefault()
          if (text !== filters.q) onChange({ ...filters, q: text }) // Enter·아이콘은 기다리지 않고 바로 검색
        }}
      >
        <label className="filter-label" htmlFor="filter-q">명칭·초록 검색</label>
        <div className="search-box">
          <input
            id="filter-q"
            className="filter-input filter-search"
            type="search"
            placeholder="예: 탠덤, 봉지"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button className="search-btn" type="submit" aria-label="검색">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="10.5" cy="10.5" r="6.5" />
              <path d="M15.5 15.5L21 21" />
            </svg>
          </button>
        </div>
      </form>

      <div className="filter-group">
        <span className="filter-label">출원인</span>
        {APPLICANT_TYPES.map((t) => (
          <button
            key={t.value}
            className={`chip ${filters.applicantType === t.value ? 'active' : ''}`}
            aria-pressed={filters.applicantType === t.value}
            onClick={() => onChange({ ...filters, applicantType: t.value })}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="filter-group">
        <span className="filter-label">상태</span>
        <button
          className={`chip ${filters.statuses.length === 0 ? 'active' : ''}`}
          aria-pressed={filters.statuses.length === 0}
          onClick={() => onChange({ ...filters, statuses: [] })}
        >
          전체
        </button>
        {statuses.map(({ legal_status: s, n }) => (
          <button
            key={s}
            className={`chip ${filters.statuses.includes(s) ? 'active' : ''}`}
            aria-pressed={filters.statuses.includes(s)}
            onClick={() => toggleStatus(s)}
          >
            {s} <span className="chip-count">{n.toLocaleString('ko-KR')}</span>
          </button>
        ))}
      </div>

      <div className="filter-group">
        <span className="filter-label">공개일</span>
        <input
          className="filter-input"
          type="date"
          aria-label="공개일 시작"
          value={filters.openFrom}
          max={filters.openTo || undefined}
          onChange={(e) => onChange({ ...filters, openFrom: e.target.value })}
        />
        <span className="filter-sep">~</span>
        <input
          className="filter-input"
          type="date"
          aria-label="공개일 끝"
          value={filters.openTo}
          min={filters.openFrom || undefined}
          onChange={(e) => onChange({ ...filters, openTo: e.target.value })}
        />
      </div>

      <div className="filter-group">
        <span className="filter-label">기술 분야</span>
        {techLevels.map((l) => (
          <select
            key={l.key}
            className="filter-input"
            aria-label={`기술 분야 ${l.label}`}
            value={filters[l.key]}
            disabled={noClassification}
            onChange={(e) => onChange({ ...filters, [l.key]: e.target.value, ...l.reset })}
          >
            <option value="">{l.label} 전체</option>
            {l.options.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        ))}
        {noClassification && <span className="filter-note">분류 작업이 끝나면 선택할 수 있어요</span>}
      </div>

      {active && <button className="filter-reset" onClick={() => onChange(EMPTY_FILTERS)}>필터 초기화</button>}
    </div>
  )
}
