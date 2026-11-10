import { Fragment, useEffect, useState } from 'react'

// 1020230116992 -> 10-2023-0116992
const formatAppNo = (n) => `${n.slice(0, 2)}-${n.slice(2, 6)}-${n.slice(6)}`

// 굵은 글씨(**…**)와 출원번호(13자리)를 바꾼다. 출원번호는 누르면 특허 상세가 열린다
function Inline({ text, evidence, onOpen }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\d{13})/g)
  return parts.map((p, i) => {
    if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i}><Inline text={p.slice(2, -2)} evidence={evidence} onOpen={onOpen} /></strong>
    if (/^\d{13}$/.test(p)) {
      const e = evidence.find((x) => x.number === p)
      return e
        ? <button key={i} className="appno-link" onClick={() => onOpen(e.id)} title={e.title}>{formatAppNo(p)}</button>
        : <mark key={i} title="근거 목록에 없는 출원번호">{formatAppNo(p)}</mark>
    }
    return <Fragment key={i}>{p}</Fragment>
  })
}

// AI 답(마크다운 일부: ## 제목, - 목록, **굵게**)을 화면 요소로
function SummaryBody({ content, evidence, onOpen }) {
  const blocks = []
  let list = null
  for (const raw of content.split('\n')) {
    const line = raw.trim()
    if (!line || line === '---') { list = null; continue }
    if (line.startsWith('#')) {
      list = null
      blocks.push(<h4 key={blocks.length}>{line.replace(/^#+\s*/, '')}</h4>)
    } else if (/^[-*]\s+/.test(line)) {
      if (!list) { list = []; blocks.push(<ul key={blocks.length}>{list}</ul>) }
      list.push(<li key={list.length}><Inline text={line.replace(/^[-*]\s+/, '')} evidence={evidence} onOpen={onOpen} /></li>)
    } else {
      list = null
      const isNote = /^\**해석/.test(line)
      blocks.push(<p key={blocks.length} className={isNote ? 'ai-interpretation' : undefined}><Inline text={line} evidence={evidence} onOpen={onOpen} /></p>)
    }
  }
  return blocks
}

const CHECKS = [
  ['strangeNumbers', '자료에 없는 숫자'],
  ['strangePatents', '근거 목록에 없는 출원번호'],
  ['mixups', '다른 특허 내용이 섞였을 수 있는 인용'],
  ['unsupported', '특허 초록에 없는 효과를 덧붙였을 수 있음'],
  ['overreach', '근거보다 강한 해석(회사 의도·산업 단계 단정)'],
  ['missingSections', '빠진 칸(답이 잘렸을 수 있음)'],
]

const FIRST_YEAR = 2000 // 기간 목록의 첫해

// AI 동향 요약: 고른 범위(1·2·3차)와 기간의 저장된 요약을 보여 주고, 새로 만들 수 있다
// 기간을 정하지 않으면 공개가 끝난 마지막 연도까지 최근 3개 연도 (서버가 정해 준다)
export default function AiSummaryPanel({ scope, title = 'AI 동향 요약', onOpenPatent }) {
  const [period, setPeriod] = useState(null) // { from, to } — null이면 서버 기본값
  const [state, setState] = useState(null) // { summary, aiReady, criteriaVersion, lastCompleteYear, from, to }
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [showFacts, setShowFacts] = useState(false)
  const { level1 = '', level2 = '', level3 = '' } = scope
  const from = period?.from ?? state?.from
  const to = period?.to ?? state?.to

  useEffect(() => {
    let cancelled = false
    setState((prev) => (prev ? { ...prev, summary: undefined } : null))
    setError(null)
    const q = new URLSearchParams({ level1, level2, level3, ...(period && { from: period.from, to: period.to }) })
    fetch(`/api/summaries?${q}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((body) => { if (!cancelled) setState(body) })
      .catch((e) => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [level1, level2, level3, period])

  // 끝 연도는 공개가 끝난 해까지만, 시작 연도는 끝 연도보다 앞이어야 한다
  const last = state?.lastCompleteYear
  const years = last ? Array.from({ length: last - FIRST_YEAR + 1 }, (_, i) => last - i) : []
  const choose = (next) => {
    const p = { from, to, ...next }
    if (p.from >= p.to) {
      if (next.from !== undefined) p.to = Math.min(last, p.from + 1)
      else p.from = p.to - 1
    }
    setPeriod(p)
  }

  async function generate() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/summaries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level1, level2, level3, from, to }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error)
      setState((s) => ({ ...s, summary: body.summary }))
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const s = state?.summary || null
  const issues = s ? CHECKS.filter(([k]) => s.checks[k]?.length) : []
  const stale = s && state.criteriaVersion && s.criteria_version !== state.criteriaVersion

  return (
    <div className="ai-summary">
      <div className="ai-summary-head">
        <h3>{title}</h3>
        {years.length > 0 && from && (
          <div className="period-picker">
            <span className="filter-label">출원 기간</span>
            <select className="filter-input" aria-label="시작 연도" value={from} onChange={(e) => choose({ from: Number(e.target.value) })}>
              {years.filter((y) => y < last).map((y) => <option key={y} value={y}>{y}년</option>)}
            </select>
            <span>~</span>
            <select className="filter-input" aria-label="끝 연도" value={to} onChange={(e) => choose({ to: Number(e.target.value) })}>
              {years.filter((y) => y > FIRST_YEAR).map((y) => <option key={y} value={y}>{y}년</option>)}
            </select>
          </div>
        )}
        {state?.aiReady && (
          <button className="more-btn" onClick={generate} disabled={busy}>
            <span className="more-label">{busy ? '만드는 중… (30초~2분)' : s ? '다시 만들기' : 'AI 요약 만들기'}</span>
          </button>
        )}
      </div>

      {error && <p className="error">{error}</p>}
      {!state && !error && <p className="placeholder-text">불러오는 중…</p>}
      {state && !state.aiReady && <p className="placeholder-text">AI 설정이 없어 요약을 만들 수 없어요 (backend/.env 의 AI_BASE_URL, AI_MODEL).</p>}
      {state && state.summary === undefined && !error && <p className="placeholder-text">불러오는 중…</p>}
      {state && state.summary === null && state.aiReady && !busy && (
        <p className="placeholder-text">{from}~{to}년 요약은 아직 없어요. "AI 요약 만들기"를 누르면 1분 안팎으로 만들어져요.</p>
      )}

      {s && (
        <>
          <p className="table-meta">
            {s.source === 'auto' && <><b>분기 자동 생성</b> · </>}
            모델 {s.model || '-'} · 분류 기준 {s.criteria_version}
            {stale && <b className="warn-text"> (지금 기준 {state.criteriaVersion}과 달라요. 다시 만들기를 권해요)</b>}
            {' '}· {new Date(`${s.created_at.replace(' ', 'T')}Z`).toLocaleString('ko-KR')}
          </p>
          {issues.length === 0
            ? <p className="check-ok">자동 검사 통과: 자료에 없는 숫자·출원번호, 특허 내용 섞임, 초록에 없는 효과, 과한 해석, 빠진 칸 없음</p>
            : (
              <div className="check-warn">
                <b>자동 검사에서 확인이 필요한 부분이 있어요</b>
                <ul>{issues.map(([k, label]) => <li key={k}>{label}: {s.checks[k].join(' / ')}</li>)}</ul>
              </div>
            )}
          <div className="ai-summary-body">
            <SummaryBody content={s.content} evidence={s.evidence} onOpen={onOpenPatent} />
          </div>
          <p className="ask-note">
            AI가 DB 숫자와 근거 특허만 보고 쓴 초안이에요. "해석:" 문장은 추정이니 근거 특허를 눌러 확인해 주세요.
          </p>
          <button className="more-link" onClick={() => setShowFacts((v) => !v)} aria-expanded={showFacts}>
            {showFacts ? 'AI에게 준 자료 닫기' : 'AI에게 준 자료 보기'}
          </button>
          {showFacts && <pre className="ai-facts">{s.facts}</pre>}
        </>
      )}
    </div>
  )
}
