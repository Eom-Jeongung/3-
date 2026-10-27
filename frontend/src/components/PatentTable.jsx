import { useRef, useState } from 'react'
import { URGENT_DAYS, WARNING_DAYS, urgencyBadgeText, urgencyOf } from '../urgency.js'

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


// 1020230116992 -> 10-2023-0116992
const formatAppNo = (n) => (n?.length === 13 ? `${n.slice(0, 2)}-${n.slice(2, 6)}-${n.slice(6)}` : n)

// 공동출원은 'A|B'로 오므로 첫 출원인 + "외 N"으로 표시
const formatApplicant = (name) => {
  const [first, ...rest] = name.split('|').map((s) => s.replace(/\s*주식회사\s*/, '').trim())
  return rest.length ? `${first} 외 ${rest.length}` : first
}

const PAGE_SIZE = 10 // 처음에 보여줄 건수이자 "더보기" 한 번에 늘어나는 건수

// 부모가 key로 필터·정렬이 바뀔 때마다 이 컴포넌트를 새로 만들어서 다시 PAGE_SIZE건부터 보인다
export default function PatentTable({ items, expiringMonths, sort, onSortChange, onSelect }) {
  const [visible, setVisible] = useState(PAGE_SIZE)
  const wrapRef = useRef(null)
  const shown = items.slice(0, visible)
  const remaining = items.length - shown.length
  const expanded = shown.length > PAGE_SIZE

  // 접으면 표 위쪽(필터 줄이 같이 보이는 위치)으로 돌아가서, 화면이 아래쪽에 남아 길을 잃지 않게 한다
  const collapse = () => {
    const top = wrapRef.current.getBoundingClientRect().top + window.scrollY - 140
    setVisible(PAGE_SIZE)
    // 표가 줄어든 뒤에 이동한다 (즉시 이동: 부드러운 스크롤은 환경에 따라 중간에 멈춰서 쓰지 않음)
    setTimeout(() => window.scrollTo({ top: Math.max(top, 0) }), 50)
  }

  const handleSort = (key) =>
    onSortChange(
      sort.key === key ? { key, order: sort.order === 'asc' ? 'desc' : 'asc' } : { key, order: 'asc' },
    )

  if (items.length === 0) {
    return <p className="empty">조건에 맞는 특허가 없습니다.</p>
  }

  return (
    <div className="table-wrap" ref={wrapRef}>
      <p className="table-meta">
        총 {items.length}건 중 {shown.length}건 표시 · 행을 누르면 상세 보기
      </p>
      <p className="urgency-legend">
        <span className="legend-title">만료 임박</span>
        <span className="badge-expiring badge-critical">긴급</span> {URGENT_DAYS}일 이내
        <span className="badge-expiring badge-warning">주의</span> {WARNING_DAYS}일 이내
        <span className="badge-expiring badge-soon">임박</span> {expiringMonths}개월 이내
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
          {shown.map((p) => {
            const level = urgencyOf(p.is_expiring, p.expiry_date)
            return (
            <tr
              key={p.id}
              className={`row-clickable ${level ? `row-expiring row-u-${level}` : ''}`}
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
                {level && <span className={`badge-expiring badge-${level}`}>{urgencyBadgeText(level, p.expiry_date)}</span>}
              </td>
            </tr>
            )
          })}
        </tbody>
      </table>
      {(remaining > 0 || expanded) && (
        <div className="more-area">
          <div className="more-circles">
            {remaining > 0 && (
              <button className="circle-btn" onClick={() => setVisible((v) => v + PAGE_SIZE)} aria-label={`${Math.min(PAGE_SIZE, remaining)}건 더 보기`}>
                <span className="circle-label">더보기</span>
                <span className="circle-arrow">⌄</span>
              </button>
            )}
            {expanded && (
              <button className="circle-btn circle-btn-quiet" onClick={collapse} aria-label="10건만 보이도록 접기">
                <span className="circle-label">접기</span>
                <span className="circle-arrow">⌃</span>
              </button>
            )}
          </div>
          <p className="more-hint">
            {remaining > 0 ? `${Math.min(PAGE_SIZE, remaining)}건 더 · 남은 ${remaining}건` : '모든 특허를 표시했어요'}
            {remaining > PAGE_SIZE && (
              <>
                {' · '}
                <button className="more-link" onClick={() => setVisible(items.length)}>전체 {items.length}건 모두 보기</button>
              </>
            )}
          </p>
        </div>
      )}
    </div>
  )
}
