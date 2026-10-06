const COLUMNS = [
  { key: 'applicant_name', label: '출원인', sortable: true },
  { key: 'application_number', label: '출원번호' },
  { key: 'title', label: '발명의 명칭', sortable: true },
  { key: 'application_date', label: '출원일', sortable: true },
  { key: 'registration_date', label: '등록일', sortable: true },
  { key: 'legal_status', label: '상태', sortable: true },
  { key: 'expiry_date', label: '만료예정일', sortable: true },
]

const STATUS_CLASS = { 등록: 'status-registered', 공개: 'status-pending' }

const daysUntil = (date) => Math.ceil((new Date(date) - new Date()) / 86_400_000)

// 1020230116992 -> 10-2023-0116992
const formatAppNo = (n) => (n?.length === 13 ? `${n.slice(0, 2)}-${n.slice(2, 6)}-${n.slice(6)}` : n)

// 공동출원은 'A|B'로 오므로 첫 출원인 + "외 N"으로 표시
const formatApplicant = (name) => {
  const [first, ...rest] = name.split('|').map((s) => s.replace(/\s*주식회사\s*/, '').trim())
  return rest.length ? `${first} 외 ${rest.length}` : first
}

export default function PatentTable({ items, expiringMonths, sort, onSortChange, onSelect }) {
  const handleSort = (key) =>
    onSortChange(
      sort.key === key ? { key, order: sort.order === 'asc' ? 'desc' : 'asc' } : { key, order: 'asc' },
    )

  if (items.length === 0) {
    return <p className="empty">조건에 맞는 특허가 없습니다.</p>
  }

  return (
    <div className="table-wrap">
      <p className="table-meta">
        {items.length}건 · <span className="badge-expiring">만료임박</span> = {expiringMonths}개월 이내 만료 예정 · 행을 누르면 상세 보기
      </p>
      <table>
        <thead>
          <tr>
            {COLUMNS.map((c) => (
              <th
                key={c.key}
                className={c.sortable ? 'sortable' : ''}
                onClick={c.sortable ? () => handleSort(c.key) : undefined}
                aria-sort={sort.key === c.key ? (sort.order === 'asc' ? 'ascending' : 'descending') : undefined}
              >
                {c.label}
                {sort.key === c.key && <span className="sort-arrow">{sort.order === 'asc' ? '▲' : '▼'}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((p) => (
            <tr
              key={p.id}
              className={`row-clickable ${p.is_expiring ? 'row-expiring' : ''}`}
              tabIndex={0}
              onClick={() => onSelect(p.id)}
              onKeyDown={(e) => e.key === 'Enter' && onSelect(p.id)}
              title="클릭하면 상세 보기"
            >
              <td>
                <span className={`type-tag ${p.applicant_type}`}>{p.applicant_type === 'own' ? '자사' : '경쟁사'}</span>
                <span className="applicant" title={p.applicant_name.replaceAll('|', ', ')}>{formatApplicant(p.applicant_name)}</span>
              </td>
              <td className="mono">{formatAppNo(p.application_number)}</td>
              <td className="title-cell" title={p.title}>{p.title}</td>
              <td className="mono">{p.application_date ?? '-'}</td>
              <td className="mono">{p.registration_date ?? '-'}</td>
              <td><span className={`status ${STATUS_CLASS[p.legal_status] ?? 'status-dead'}`}>{p.legal_status}</span></td>
              <td className="mono expiry-cell">
                {p.expiry_date ?? '-'}
                {p.is_expiring && <span className="badge-expiring">D-{daysUntil(p.expiry_date)}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
