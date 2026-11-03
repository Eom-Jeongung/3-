import { useRef } from 'react'
import { PAGE_SIZE } from '../hooks/usePatentList.js'

const COLUMNS = [
  { key: 'application_number', label: '출원번호' },
  { key: 'title', label: '발명의 명칭', sortable: true },
  { key: 'applicant_name', label: '출원인', sortable: true },
  { key: 'application_date', label: '출원일', sortable: true },
  { key: 'open_date', label: '공개일', sortable: true },
  { key: 'ipc', label: 'IPC' },
  { key: 'classification', label: '분류 (근거)' },
  { key: 'legal_status', label: '상태', sortable: true },
]

// 'A|B|C' → 'A 외 2'
const formatIpc = (codes) => {
  const [first, ...rest] = (codes ?? '').split('|').map((s) => s.trim()).filter(Boolean)
  if (!first) return '-'
  return rest.length ? `${first} 외 ${rest.length}` : first
}

const STATUS_CLASS = { 등록: 'status-registered', 공개: 'status-pending' }

// 1020230116992 -> 10-2023-0116992
const formatAppNo = (n) => (n?.length === 13 ? `${n.slice(0, 2)}-${n.slice(2, 6)}-${n.slice(6)}` : n)

// 공동출원은 'A|B'로 오므로 첫 출원인 + "외 N"으로 표시
const formatApplicant = (name) => {
  const [first, ...rest] = name.split('|').map((s) => s.replace(/\s*주식회사\s*/, '').trim())
  return rest.length ? `${first} 외 ${rest.length}` : first
}

// items는 지금까지 서버에서 받은 만큼만 들어 있고, total이 필터에 맞는 전체 건수다
export default function PatentTable({ items, total, sort, onSortChange, onSelect, onLoadMore, onCollapse, loadingMore }) {
  const wrapRef = useRef(null)
  const remaining = total - items.length
  const expanded = items.length > PAGE_SIZE

  // 접으면 표 위쪽(필터 줄이 같이 보이는 위치)으로 돌아가서, 화면이 아래쪽에 남아 길을 잃지 않게 한다
  const collapse = () => {
    const top = wrapRef.current.getBoundingClientRect().top + window.scrollY - 140
    onCollapse()
    // 표가 줄어든 뒤에 이동한다 (즉시 이동: 부드러운 스크롤은 환경에 따라 중간에 멈춰서 쓰지 않음)
    setTimeout(() => window.scrollTo({ top: Math.max(top, 0) }), 50)
  }

  const handleSort = (key) =>
    onSortChange(
      sort.key === key ? { key, order: sort.order === 'asc' ? 'desc' : 'asc' } : { key, order: 'asc' },
    )

  if (total === 0) {
    return <p className="empty">조건에 맞는 특허가 없습니다.</p>
  }

  return (
    <div className="table-wrap" ref={wrapRef}>
      <p className="table-meta">
        총 {total.toLocaleString('ko-KR')}건 중 {items.length.toLocaleString('ko-KR')}건 표시 · 행을 누르면 상세 보기
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
              className="row-clickable"
              tabIndex={0}
              onClick={() => onSelect(p.id)}
              onKeyDown={(e) => e.key === 'Enter' && onSelect(p.id)}
              title="클릭하면 상세 보기"
            >
              <td className="mono">{formatAppNo(p.application_number)}</td>
              <td className="title-cell" title={p.title}>{p.title}</td>
              <td>
                <span className={`type-tag ${p.applicant_type}`}>{p.applicant_type === 'own' ? '자사' : '경쟁사'}</span>
                <span className="applicant" title={p.applicant_name.replaceAll('|', ', ')}>{formatApplicant(p.applicant_name)}</span>
              </td>
              <td className="mono">{p.application_date ?? '-'}</td>
              <td className="mono">{p.open_date ?? '-'}</td>
              <td className="mono" title={p.ipc_codes?.replaceAll('|', ', ')}>{formatIpc(p.ipc_codes)}</td>
              <td title={p.classification ? [p.classification.level1, p.classification.level2, p.classification.level3].filter(Boolean).join(' › ') : undefined}>
                {p.classification ? <>{p.classification.level3 ?? p.classification.level2} <span className="muted">{p.classification.basis}</span></> : '-'}
              </td>
              <td><span className={`status ${STATUS_CLASS[p.legal_status] ?? 'status-dead'}`}>{p.legal_status}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      {(remaining > 0 || expanded) && (
        <div className="more-area">
          <div className="more-buttons">
            {remaining > 0 && (
              <button className="more-btn" onClick={onLoadMore} disabled={loadingMore} aria-label={`${Math.min(PAGE_SIZE, remaining)}건 더 보기`}>
                <span className="more-label">더보기</span>
                <span className="more-arrow">⌄</span>
              </button>
            )}
            {expanded && (
              <button className="more-btn more-btn-quiet" onClick={collapse} aria-label="10건만 보이도록 접기">
                <span className="more-label">접기</span>
                <span className="more-arrow">⌃</span>
              </button>
            )}
          </div>
          <p className="more-hint">
            {remaining > 0 ? `${Math.min(PAGE_SIZE, remaining)}건 더 · 남은 ${remaining.toLocaleString('ko-KR')}건` : '모든 특허를 표시했어요'}
          </p>
        </div>
      )}
    </div>
  )
}
