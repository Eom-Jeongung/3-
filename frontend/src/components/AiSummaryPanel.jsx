import { Fragment, useEffect, useState } from 'react'
import { summaryCheckStatus } from './summaryCheckStatus.js'

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
      const text = line.replace(/^[-*]\s+/, '')
      // "- 해석: …" 줄도 추정 문장이라 표시를 다르게 한다
      list.push(<li key={list.length} className={/^\**해석/.test(text) ? 'ai-interpretation' : undefined}><Inline text={text} evidence={evidence} onOpen={onOpen} /></li>)
    } else {
      list = null
      const isNote = /^\**해석/.test(line)
      blocks.push(<p key={blocks.length} className={isNote ? 'ai-interpretation' : undefined}><Inline text={line} evidence={evidence} onOpen={onOpen} /></p>)
    }
  }
  return blocks
}

const FIRST_YEAR = 2000 // 기간 목록의 첫해

const toLocal = (sqliteUtc) => new Date(`${sqliteUtc.replace(' ', 'T')}Z`)
const formatWhen = (sqliteUtc) => toLocal(sqliteUtc).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })

// 복사·내려받기용 글: 요약 본문 + 만든 정보 + 근거 특허 + 검사 경고
function summaryText(s, scopeName, issues) {
  const lines = [
    `# ${scopeName} AI 동향 요약 (${s.period_from}~${s.period_to}년 출원)`,
    '',
    `만든 때 ${formatWhen(s.created_at)} · 모델 ${s.model || '-'} · 분류 기준 ${s.criteria_version}${s.source === 'auto' ? ' · 분기 자동 생성' : ''}`,
    '',
    s.content.trim(),
  ]
  if (s.evidence?.length) {
    lines.push('', '## 근거 후보 특허', ...s.evidence.map((e) => `- ${formatAppNo(e.number)} · ${e.title} · ${e.reason}`))
  }
  if (issues.length) lines.push('', '## 자동 검사 경고', ...issues.map(([k, label]) => `- ${label}: ${s.checks[k].join(' / ')}`))
  lines.push('', '> AI가 DB 숫자와 근거 특허만 보고 쓴 초안입니다. "해석:" 문장은 추정이니 근거 특허로 확인해 주세요.')
  return lines.join('\n')
}

// 클립보드 복사 (http 주소처럼 클립보드 API가 막힌 곳에서는 예전 방식으로)
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const area = Object.assign(document.createElement('textarea'), { value: text })
    document.body.append(area)
    area.select()
    document.execCommand('copy')
    area.remove()
  }
}

function downloadText(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  a.click()
  URL.revokeObjectURL(url)
}

// AI 동향 요약: 고른 범위(1·2·3차)와 기간의 저장된 요약을 보여 주고, 새로 만들 수 있다
// 기간을 정하지 않으면 공개가 끝난 마지막 연도까지 최근 3개 연도 (서버가 정해 준다)
export default function AiSummaryPanel({ scope, title = 'AI 동향 요약', onOpenPatent }) {
  const [period, setPeriod] = useState(null) // { from, to } — null이면 서버 기본값
  const [state, setState] = useState(null) // { summary, aiReady, criteriaVersion, lastCompleteYear, from, to }
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [showFacts, setShowFacts] = useState(false)
  const [archive, setArchive] = useState(null) // 보관함: 이 범위에서 만든 요약 목록
  const [archiveTry, setArchiveTry] = useState(0) // 새로 만들면 올려서 목록을 다시 받는다
  const [showArchive, setShowArchive] = useState(false)
  const [viewing, setViewing] = useState(null) // 보관함에서 고른 지난 요약 (없으면 최신 요약)
  const [copied, setCopied] = useState(false)
  const { level1 = '', level2 = '', level3 = '' } = scope
  const scopeName = level3 || level2 || level1 || '전체 분야'
  const from = period?.from ?? state?.from
  const to = period?.to ?? state?.to

  useEffect(() => {
    let cancelled = false
    const q = new URLSearchParams({ level1, level2, level3 })
    fetch(`/api/summaries/archive?${q}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((body) => { if (!cancelled) setArchive(body.items) })
      .catch(() => { if (!cancelled) setArchive(null) })
    return () => { cancelled = true }
  }, [level1, level2, level3, archiveTry])

  useEffect(() => {
    let cancelled = false
    setViewing(null)
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
      setViewing(null)
      setState((s) => ({ ...s, summary: body.summary }))
      setArchiveTry((n) => n + 1)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  // 보관함에서 고른 요약 불러오기 (최신 요약과 같은 것이면 그냥 최신으로)
  async function openArchived(id) {
    setError(null)
    if (id === state?.summary?.id) { setViewing(null); return }
    try {
      const res = await fetch(`/api/summaries/${id}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body.error)
      setViewing(body.summary)
      setShowFacts(false)
    } catch (e) {
      setError(`보관함 요약을 불러오지 못했어요: ${e.message}`)
    }
  }

  const s = viewing ?? (state?.summary || null)
  const { issues, missing: olderChecks } = summaryCheckStatus(s?.checks)
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
        {archive?.length > 0 && (
          <button className="more-btn more-btn-quiet" onClick={() => setShowArchive((v) => !v)} aria-expanded={showArchive}>
            <span className="more-label">보관함 ({archive.length})</span>
          </button>
        )}
        {state?.aiReady && (
          <button className="more-btn" onClick={generate} disabled={busy}>
            <span className="more-label">{busy ? '만드는 중… (30초~2분)' : state.summary ? '다시 만들기' : 'AI 요약 만들기'}</span>
          </button>
        )}
      </div>

      {showArchive && archive?.length > 0 && (
        <div className="summary-archive">
          <p className="table-meta">이 분야에서 지금까지 만든 요약이에요. 다시 만들어도 예전 요약은 지워지지 않고 여기 남아요.</p>
          <ul>
            {archive.map((a) => {
              const { issues, missing } = summaryCheckStatus(a.checks)
              const current = s?.id === a.id
              return (
                <li key={a.id}>
                  <button className={`archive-item ${current ? 'current' : ''}`} onClick={() => openArchived(a.id)} aria-current={current || undefined}>
                    <b>{a.period_from}~{a.period_to}년</b>
                    <span>{formatWhen(a.created_at)}</span>
                    <span className="muted">{a.source === 'auto' ? '분기 자동' : '직접 만듦'} · {a.model || '-'}</span>
                    <span className={issues.length || missing ? 'archive-warn' : 'archive-ok'}>
                      {issues.length ? `검사 경고 ${issues.length}` : missing ? '이전 검사' : '검사 통과'}
                    </span>
                    {current && <span className="archive-now">보는 중</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {viewing && (
        <p className="archive-banner" role="status">
          보관함에서 고른 <b>{viewing.period_from}~{viewing.period_to}년</b> 요약({formatWhen(viewing.created_at)})을 보고 있어요.
          {' '}<button className="more-link" onClick={() => setViewing(null)}>최신 요약으로 돌아가기</button>
        </p>
      )}

      {error && <p className="error">{error}</p>}
      {!state && !error && <p className="placeholder-text">불러오는 중…</p>}
      {state && !state.aiReady && <p className="placeholder-text">AI 설정이 없어 요약을 만들 수 없어요 (backend/.env 의 AI_BASE_URL, AI_MODEL).</p>}
      {state && state.summary === undefined && !error && <p className="placeholder-text">불러오는 중…</p>}
      {state && state.summary === null && state.aiReady && !busy && !viewing && (
        <p className="placeholder-text">{from}~{to}년 요약은 아직 없어요. "AI 요약 만들기"를 누르면 1분 안팎으로 만들어져요.</p>
      )}

      {s && (
        <>
          <p className="table-meta">
            {s.source === 'auto' && <><b>분기 자동 생성</b> · </>}
            모델 {s.model || '-'} · 분류 기준 {s.criteria_version}
            {stale && <b className="warn-text"> (지금 기준 {state.criteriaVersion}과 달라요. 다시 만들기를 권해요)</b>}
            {' '}· {formatWhen(s.created_at)}
          </p>
          <div className="summary-actions">
            <button
              className="more-link"
              onClick={async () => { await copyText(summaryText(s, scopeName, issues)); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
            >
              {copied ? '복사했어요' : '요약 복사'}
            </button>
            <button
              className="more-link"
              onClick={() => downloadText(summaryText(s, scopeName, issues), `AI동향요약_${scopeName}_${s.period_from}-${s.period_to}_${toLocal(s.created_at).toISOString().slice(0, 10)}.md`)}
            >
              내려받기 (.md)
            </button>
          </div>
          {issues.length === 0 && !olderChecks
            ? <p className="check-ok">규칙 기반 자동 검사에서 경고를 발견하지 못했어요. 모든 수치와 해석의 정확성을 보장하지 않으니 근거를 확인해 주세요.</p>
            : (
              <div className="check-warn" role="status">
                <b>자동 검사에서 확인이 필요한 부분이 있어요</b>
                {olderChecks && <p>이전에 생성된 요약이라 새 통계·근거 검사가 적용되지 않았어요. 다시 만들면 검사할 수 있어요.</p>}
                {issues.length > 0 && <ul>{issues.map(([k, label]) => <li key={k}>{label}: {s.checks[k].join(' / ')}</li>)}</ul>}
                <p>자동 검사는 모든 오류를 찾지 못할 수 있으니 자료와 근거 특허를 확인해 주세요.</p>
              </div>
            )}
          <div className="ai-summary-body">
            <SummaryBody content={s.content} evidence={s.evidence} onOpen={onOpenPatent} />
          </div>
          {s.evidence?.length > 0 && (
            <details>
              <summary>근거 후보 특허 보기</summary>
              <ul>{s.evidence.map((e) => (
                <li key={e.number}>
                  <button className="appno-link" onClick={() => onOpenPatent(e.id)}>{formatAppNo(e.number)}</button>
                  {' '}· {e.title} · {e.reason}
                </li>
              ))}</ul>
            </details>
          )}
          <p className="footnote">
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
