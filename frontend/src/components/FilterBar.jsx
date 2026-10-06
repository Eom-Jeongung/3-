const APPLICANT_TYPES = [
  { value: '', label: '전체' },
  { value: 'own', label: '자사' },
  { value: 'competitor', label: '경쟁사' },
]

export default function FilterBar({ filters, onChange, statuses, expiringCount, expiringMonths }) {
  const toggleStatus = (s) => {
    const next = filters.statuses.includes(s)
      ? filters.statuses.filter((x) => x !== s)
      : [...filters.statuses, s]
    onChange({ ...filters, statuses: next })
  }

  return (
    <div className="filter-bar">
      <div className="filter-group">
        <span className="filter-label">출원인</span>
        {APPLICANT_TYPES.map((t) => (
          <button
            key={t.value}
            className={`chip ${filters.applicantType === t.value ? 'active' : ''}`}
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
          onClick={() => onChange({ ...filters, statuses: [] })}
        >
          전체
        </button>
        {statuses.map(({ legal_status: s, n }) => (
          <button
            key={s}
            className={`chip ${filters.statuses.includes(s) ? 'active' : ''}`}
            onClick={() => toggleStatus(s)}
          >
            {s} <span className="chip-count">{n}</span>
          </button>
        ))}
        <button
          className={`chip chip-expiring ${filters.expiringOnly ? 'active' : ''}`}
          onClick={() => onChange({ ...filters, expiringOnly: !filters.expiringOnly })}
          title={`${expiringMonths}개월 이내 만료 예정인 특허만 표시`}
        >
          ⏰ 만료임박만 <span className="chip-count">{expiringCount}</span>
        </button>
      </div>
    </div>
  )
}
