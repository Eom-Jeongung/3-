import { useEffect, useState } from 'react'

const formatAppNo = (n) => (n?.length === 13 ? `${n.slice(0, 2)}-${n.slice(2, 6)}-${n.slice(6)}` : n)

// 상세 패널: 목록에서 행을 누르면 오른쪽에서 열린다 (GET /api/patents/:id)
export default function PatentDetail({ id, onClose }) {
  const [patent, setPatent] = useState(null)
  const [error, setError] = useState(null)
  const [drawingFailed, setDrawingFailed] = useState(false)
  const [zoomed, setZoomed] = useState(false) // 도면 확대 팝업
  const [bigLoaded, setBigLoaded] = useState(false)
  const [bigFailed, setBigFailed] = useState(false)
  const [fetchedClaims, setFetchedClaims] = useState(null)
  const [claimsLoading, setClaimsLoading] = useState(false)
  const [claimsError, setClaimsError] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setPatent(null)
    setError(null)
    setDrawingFailed(false)
    setZoomed(false)
    setBigLoaded(false)
    setBigFailed(false)
    setFetchedClaims(null)
    setClaimsError(null)
    setCopied(false)
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

  async function loadClaims() {
    setClaimsLoading(true)
    setClaimsError(null)
    try {
      const res = await fetch(`/api/patents/${id}/claims`, { method: 'POST' })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error)
      setFetchedClaims(body.claims)
    } catch (e) {
      setClaimsError(e.message)
    } finally {
      setClaimsLoading(false)
    }
  }

  async function copyNumber() {
    try {
      await navigator.clipboard.writeText(patent.application_number)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  // 저장된 청구항이 없으면 null (버튼을 보여 준다)
  const savedClaims = patent?.claims?.length ? patent.claims : null
  const claims = fetchedClaims ?? savedClaims
  const representative = claims?.find((c) => !/^\d+\.\s*삭제\s*$/.test(c))

  const primary = patent?.classification?.find((c) => c.is_primary)
  const secondary = patent?.classification?.filter((c) => !c.is_primary) ?? []
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
              <dt>KIPRIS 원문</dt>
              <dd>
                <a className="field-link" href="https://www.kipris.or.kr/" target="_blank" rel="noreferrer">KIPRIS 열기 ↗</a>
                {' '}
                <button className="more-link" onClick={copyNumber}>{copied ? '복사했어요' : '출원번호 복사'}</button>
                <span className="muted detail-hint">KIPRIS에서 출원번호로 검색하면 원문이 나와요.</span>
              </dd>
            </dl>

            <h3>주요 일정</h3>
            <ol className="timeline">
              <li><span>출원일</span><b className="mono">{patent.application_date ?? '-'}</b></li>
              <li><span>공개일</span><b className="mono">{patent.open_date ?? '-'}</b></li>
              <li><span>등록일</span><b className="mono">{patent.registration_date ?? '-'}</b></li>
            </ol>

            {primary && (
              <>
                <h3>기술 분야 <span className="muted">· 임시 기준 {primary.criteria_version}</span></h3>
                <p className="class-path">{[primary.level1, primary.level2, primary.level3].filter(Boolean).join(' › ')}</p>
                <p className="class-basis">근거: {primary.basis}{primary.basis_detail ? ` (첫 IPC ${primary.basis_detail})` : ''}</p>
                {secondary.length > 0 && (
                  <div className="keywords">
                    <span className="class-basis">부분류</span>
                    {secondary.map((c) => <span key={c.level2} className="kw" title={`IPC ${c.basis_detail}`}>{c.level2}</span>)}
                  </div>
                )}
              </>
            )}

            {ipcs.length > 0 && (
              <>
                <h3>IPC 분류</h3>
                <div className="keywords">
                  {ipcs.map((c) => <span key={c} className="kw ipc">{c}</span>)}
                </div>
              </>
            )}

            <h3>개별 요약</h3>
            <p className="placeholder-text">AI 모델 선정 후 한 줄 요약, 해결하려는 문제, 핵심 해결 수단, 기존 기술과의 차이, 핵심 키워드가 여기에 표시돼요.</p>

            <div className="source-columns">
              <section>
                <h3>원문 초록</h3>
                <p className="abstract">{patent.abstract ?? '초록이 없어요.'}</p>
              </section>
              <section>
                <h3>대표 청구항</h3>
                {representative && <p className="abstract">{representative}</p>}
                {claims?.length > 0 && !representative && <p className="placeholder-text">유효한 청구항이 없어요.</p>}
                {claims?.length > 0 && <p className="muted">전체 {claims.length}개 항 중 삭제되지 않은 첫 항이에요.</p>}
                {claims?.length === 0 && <p className="placeholder-text">KIPRIS에 청구항이 없어요.</p>}
                {claims === null && (
                  <button className="more-btn" onClick={loadClaims} disabled={claimsLoading}>
                    <span className="more-label">{claimsLoading ? '불러오는 중…' : '청구항 불러오기'}</span>
                  </button>
                )}
                {claimsError && <p className="error">청구항을 불러오지 못했어요: {claimsError}</p>}
                {claims === null && <p className="muted">KIPRIS를 1회 호출하고, 받은 내용은 저장해요.</p>}
              </section>
            </div>

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
