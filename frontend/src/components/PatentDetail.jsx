import { useEffect, useState } from 'react'

const daysUntil = (date) => Math.ceil((new Date(date) - new Date()) / 86_400_000)
const formatAppNo = (n) => (n?.length === 13 ? `${n.slice(0, 2)}-${n.slice(2, 6)}-${n.slice(6)}` : n)

// 상세 패널: 목록에서 행을 누르면 오른쪽에서 열린다 (GET /api/patents/:id)
export default function PatentDetail({ id, onClose }) {
  const [patent, setPatent] = useState(null)
  const [error, setError] = useState(null)
  const [drawingFailed, setDrawingFailed] = useState(false)
  const [zoomed, setZoomed] = useState(false) // 도면 확대 팝업
  const [bigLoaded, setBigLoaded] = useState(false)
  const [bigFailed, setBigFailed] = useState(false)

  useEffect(() => {
    setPatent(null)
    setError(null)
    setDrawingFailed(false)
    setZoomed(false)
    setBigLoaded(false)
    setBigFailed(false)
    fetch(`/api/patents/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setPatent)
      .catch((e) => setError(e.message))
  }, [id])

  // ESC: 도면 팝업이 열려 있으면 팝업만, 아니면 상세 패널을 닫는다
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (zoomed) setZoomed(false)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, zoomed])

  const names = patent?.applicant_name.split('|').map((s) => s.trim()) ?? []
  const ipcs = patent?.ipc_codes?.split('|').map((s) => s.trim()).filter(Boolean) ?? []

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-label="특허 상세" onClick={(e) => e.stopPropagation()}>
        <button className="drawer-close" onClick={onClose} aria-label="닫기">✕</button>

        {error && <p className="error">상세를 불러오지 못했습니다: {error}</p>}
        {!patent && !error && <p className="muted">불러오는 중…</p>}

        {patent && (
          <>
            <div className="drawer-tags">
              <span className={`type-tag ${patent.applicant_type}`}>{patent.applicant_type === 'own' ? '자사' : '경쟁사'}</span>
              <span className={`status ${patent.legal_status === '등록' ? 'status-registered' : patent.legal_status === '공개' ? 'status-pending' : 'status-dead'}`}>
                {patent.legal_status}
              </span>
              {patent.is_expiring && <span className="badge-expiring">만료임박 D-{daysUntil(patent.expiry_date)}</span>}
              <span className="kw">{patent.tech_category}</span>
            </div>

            <h2 className="drawer-title">{patent.title}</h2>

            <dl className="detail-grid">
              <dt>출원인</dt>
              <dd>{names.map((n) => n.replace(/\s*주식회사\s*/, '')).join(', ')}</dd>
              <dt>출원번호</dt>
              <dd className="mono">{formatAppNo(patent.application_number)}</dd>
              {patent.register_number && (
                <>
                  <dt>등록번호</dt>
                  <dd className="mono">{patent.register_number}</dd>
                </>
              )}
            </dl>

            <h3>주요 일정</h3>
            <ol className="timeline">
              <li><span>출원일</span><b className="mono">{patent.application_date ?? '-'}</b></li>
              <li><span>공개일</span><b className="mono">{patent.open_date ?? '-'}</b></li>
              <li><span>등록일</span><b className="mono">{patent.registration_date ?? '-'}</b></li>
              <li className={patent.is_expiring ? 'timeline-expiring' : ''}>
                <span>만료예정일</span>
                <b className="mono">{patent.expiry_date ?? '해당 없음'}</b>
              </li>
            </ol>
            {patent.expiry_date && (
              <p className="footnote">출원일+20년으로 계산한 값입니다. 존속기간 연장과 연차료 미납으로 인한 조기 소멸은 반영하지 않았어요.</p>
            )}

            {ipcs.length > 0 && (
              <>
                <h3>IPC 분류</h3>
                <div className="keywords">
                  {ipcs.map((c) => <span key={c} className="kw ipc">{c}</span>)}
                </div>
              </>
            )}

            {patent.abstract && (
              <>
                <h3>초록</h3>
                <p className="abstract">{patent.abstract}</p>
              </>
            )}

            {patent.drawing_url && !drawingFailed && (
              <>
                <h3>대표 도면 <span className="muted">· 클릭하면 확대</span></h3>
                <button className="drawing-btn" onClick={() => setZoomed(true)} aria-label="대표 도면 확대">
                  <img
                    className="drawing"
                    src={patent.drawing_url}
                    alt={`${patent.title} 대표 도면`}
                    referrerPolicy="no-referrer"
                    onError={() => setDrawingFailed(true)}
                  />
                </button>
              </>
            )}

            <p className="footnote">마지막 수집: {new Date(patent.last_synced_at).toLocaleString('ko-KR')}</p>
          </>
        )}
      </aside>

      {zoomed && patent && (
        <div className="lightbox-backdrop" onClick={(e) => { e.stopPropagation(); setZoomed(false) }}>
          <figure className="lightbox" role="dialog" aria-label="대표 도면 확대" onClick={(e) => e.stopPropagation()}>
            <button className="drawer-close" onClick={() => setZoomed(false)} aria-label="도면 닫기">✕</button>
            {!bigLoaded && !bigFailed && <p className="muted lightbox-status">고해상도 도면을 불러오는 중…</p>}
            {bigFailed && <p className="muted lightbox-status">고해상도 도면을 불러오지 못해 작은 이미지로 표시합니다.</p>}
            <img
              src={bigFailed || !patent.big_drawing_url ? patent.drawing_url : patent.big_drawing_url}
              alt={`${patent.title} 대표 도면 확대`}
              referrerPolicy="no-referrer"
              onLoad={() => setBigLoaded(true)}
              onError={() => setBigFailed(true)}
              style={bigLoaded || bigFailed ? undefined : { visibility: 'hidden', position: 'absolute' }}
            />
            <figcaption>{patent.title} · 대표 도면</figcaption>
          </figure>
        </div>
      )}
    </div>
  )
}
