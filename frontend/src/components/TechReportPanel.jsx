import { useEffect, useState } from 'react'
import { scopeHref, scopeLabel } from './FieldPicker.jsx'
import { formatAppNo, jsonOrThrow } from '../format.js'
import TechReport from './TechReport.jsx'

// AI 기술 분석 보고서 패널: AiSummaryPanel.jsx(건수 요약)를 복사해 기술 분석용으로 바꿨다. 건수 요약 패널은 그대로 둔다
// API는 /api/tech-reports (routes/techReports.js), 보관함도 건수 요약과 따로다

const FIRST_YEAR = 2000 // 기간 목록의 첫해

const toLocal = (sqliteUtc) => new Date(`${sqliteUtc.replace(' ', 'T')}Z`)
const formatWhen = (sqliteUtc) => toLocal(sqliteUtc).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })

// 복사·내려받기용 글 (마크다운)
function reportText(s) {
  const r = s.report
  const mark = (c) => (c ? ` (주의: ${c})` : '')
  const refs = (list) => (list?.length ? ` ${list.map((n) => `[${n}]`).join('')}` : '')
  const lines = [
    `# ${r.scopeLabel} 기술 분석 보고서 (${r.from}~${r.to}년 출원)`,
    '',
    `**${r.headline}**${mark(r.headlineCaution)}`,
    '',
    `만든 때 ${formatWhen(s.created_at)} · 모델 ${s.model || '-'} · 분류 기준 ${s.criteria_version}`,
    '', `## 정량 스냅샷${r.quantTitle ? `: ${r.quantTitle}` : ''}`, ...r.kpis.map((k) => `- ${k.label}: ${k.value} (${k.detail})`),
    ...(r.charts?.yearly?.title ? [`- ${r.charts.yearly.title}`] : []),
    ...(r.charts?.distribution?.title ? [`- ${r.charts.distribution.title}`] : []),
    '', `## 시기별 기술 발전 방향${r.flowSummary ? `: ${r.flowSummary}` : ''}`,
    ...r.periods.flatMap((p) => [`### ${p.label} · ${p.stage} · ${p.title}${mark(p.titleCaution)}`, ...p.points.map((x) => `- ${x.text}${refs(x.refs)}${mark(x.caution)}`), `- 핵심 키워드: ${p.keywords.join(', ')}`]),
    '', '## 경쟁사별 기술 집중도와 차별점 비교', ...(r.competitorLead ? [r.competitorLead, ''] : []),
    '| 기업 | 집중 기술 분야 | 핵심 키워드 | 주요 기술 개선 방향 | 근거 |', '|---|---|---|---|---|',
    ...r.competitors.map((c) => `| ${c.companyLabel} | ${c.focus} | ${c.keywords.join(', ')} | ${c.direction}${mark(c.caution)} | ${refs(c.refs).trim()} |`),
    '', '## 주요 근거 특허 기술 분석', '| 번호 | 출원인·기술 주제 | 해결 문제 | 기존 대비 차이 | 핵심 개선 |', '|---|---|---|---|---|',
    ...r.patents.map((p) => `| [${p.no}] | ${p.companyLabel} ${formatAppNo(p.number)} (${p.period}, ${p.source}) ${p.theme || p.topic} | ${p.problem}${p.purpose ? ` / 목적: ${p.purpose}` : ''} | ${p.baseline} | ${p.improvement}${mark(p.caution)} |`),
    '', '## 시사점', ...r.takeaways.map((t) => `- ${t.text}${mark(t.caution)}`),
  ]
  const warnings = s.checks?.warnings ?? []
  if (warnings.length) lines.push('', '## 자동 검증 주의', ...warnings.map((w) => `- ${w.where}: ${w.reason}`))
  lines.push('', ...r.notes.map((n) => `> ${n}`), '> 숫자는 DB 값, 문장은 AI가 근거 특허를 보고 쓴 초안입니다. "(추정)"은 원문에 없어 일반 기술 지식으로 추정한 내용입니다.')
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

export default function TechReportPanel({ scope, title = 'AI 기술 분석', onOpenPatent }) {
  const [period, setPeriod] = useState(null) // { from, to } — null이면 서버 기본값
  const [state, setState] = useState(null) // { summary, aiReady, criteriaVersion, lastCompleteYear, from, to }
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [showFacts, setShowFacts] = useState(false)
  const [archive, setArchive] = useState(null)
  const [archiveReload, setArchiveReload] = useState(0)
  const [showArchive, setShowArchive] = useState(false)
  const [archiveHere, setArchiveHere] = useState(false)
  const [viewing, setViewing] = useState(null) // 보관함에서 고른 지난 보고서 (없으면 최신)
  const [copied, setCopied] = useState(false)
  const { level1 = '', level2 = '', level3 = '' } = scope
  const scopeName = level3 || level2 || level1 || '전체 분야'
  const from = period?.from ?? state?.from
  const to = period?.to ?? state?.to

  useEffect(() => {
    let cancelled = false
    fetch('/api/tech-reports/archive?all=1')
      .then(jsonOrThrow)
      .then((body) => { if (!cancelled) setArchive(body.items) })
      .catch(() => { if (!cancelled) setArchive(null) })
    return () => { cancelled = true }
  }, [archiveReload])

  // 보관함에서 다른 분류의 보고서를 고르면 주소에 tid를 붙여 그 분류 화면으로 온다 → 열리자마자 그 보고서를 보여 준다
  const tid = scope.tid
  useEffect(() => {
    if (tid && /^\d+$/.test(tid)) openArchived(Number(tid))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let cancelled = false
    setViewing((v) => (v && period && v.period_from === period.from && v.period_to === period.to ? v : null))
    setState((prev) => (prev ? { ...prev, summary: undefined } : null))
    setError(null)
    const q = new URLSearchParams({ level1, level2, level3, ...(period && { from: period.from, to: period.to }) })
    fetch(`/api/tech-reports?${q}`)
      .then(jsonOrThrow)
      .then((body) => { if (!cancelled) setState(body) })
      .catch((e) => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [level1, level2, level3, period])

  const last = state?.lastCompleteYear
  const years = last ? Array.from({ length: last - FIRST_YEAR + 1 }, (_, i) => last - i) : []
  const changePeriod = (next) => {
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
      const body = await jsonOrThrow(await fetch('/api/tech-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level1, level2, level3, from, to }),
      }))
      setViewing(null)
      setState((s) => ({ ...s, summary: body.summary }))
      setArchiveReload((n) => n + 1)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function openArchived(id) {
    setError(null)
    if (id === state?.summary?.id) { setViewing(null); return }
    try {
      const body = await jsonOrThrow(await fetch(`/api/tech-reports/${id}`))
      setPeriod({ from: body.summary.period_from, to: body.summary.period_to }) // 기간 선택도 그 보고서에 맞춘다
      setViewing(body.summary)
      setShowFacts(false)
    } catch (e) {
      setError(`보관함 보고서를 불러오지 못했어요: ${e.message}`)
    }
  }

  const isHere = (a) => a.level1 === level1 && a.level2 === level2 && a.level3 === level3
  function pickArchived(a) {
    if (isHere(a)) { openArchived(a.id); return }
    const href = scopeHref('summary', a)
    window.location.hash = `${href}${href.includes('?') ? '&' : '?'}kind=tech&tid=${a.id}`
  }
  const archiveShown = archive ? (archiveHere ? archive.filter(isHere) : archive) : []
  const hereCount = archive ? archive.filter(isHere).length : 0

  const shown = viewing ?? (state?.summary || null)
  const stale = shown && state?.criteriaVersion && shown.criteria_version !== state.criteriaVersion

  return (
    <div className="ai-summary">
      <div className="ai-summary-head">
        <h3>{title}</h3>
        {years.length > 0 && from && (
          <div className="period-picker">
            <span className="filter-label">출원 기간</span>
            <select className="filter-input" aria-label="시작 연도" value={from} onChange={(e) => changePeriod({ from: Number(e.target.value) })}>
              {years.filter((y) => y < last).map((y) => <option key={y} value={y}>{y}년</option>)}
            </select>
            <span>~</span>
            <select className="filter-input" aria-label="끝 연도" value={to} onChange={(e) => changePeriod({ to: Number(e.target.value) })}>
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
            <span className="more-label">{busy ? '만드는 중… (1~3분)' : state.summary ? '다시 만들기' : '기술 분석 만들기'}</span>
          </button>
        )}
      </div>

      {showArchive && archive?.length > 0 && (
        <div className="summary-archive">
          <div className="archive-head">
            <p className="table-meta">지금까지 만든 기술 분석 보고서예요. 분류와 기간을 보고 고르면 그 보고서가 열려요. 다시 만들어도 예전 보고서는 지워지지 않아요.</p>
            <div className="filter-group" role="group" aria-label="보관함 범위">
              <button className={`chip ${!archiveHere ? 'active' : ''}`} aria-pressed={!archiveHere} onClick={() => setArchiveHere(false)}>모든 분류 <span className="chip-count">{archive.length}</span></button>
              <button className={`chip ${archiveHere ? 'active' : ''}`} aria-pressed={archiveHere} onClick={() => setArchiveHere(true)}>{scopeName}만 <span className="chip-count">{hereCount}</span></button>
            </div>
          </div>
          {archiveShown.length === 0 && <p className="placeholder-text">{scopeName}에서 만든 기술 분석이 아직 없어요.</p>}
          <ul>
            {archiveShown.map((a) => {
              const n = a.checks?.warnings?.length ?? 0
              const current = shown?.id === a.id
              return (
                <li key={a.id}>
                  <button className={`archive-item ${current ? 'current' : ''}`} onClick={() => pickArchived(a)} aria-current={current || undefined}>
                    <span className={`archive-scope ${isHere(a) ? 'here' : ''}`}>{scopeLabel(a)}</span>
                    <b>{a.period_from}~{a.period_to}년</b>
                    <span>{formatWhen(a.created_at)}</span>
                    <span className="muted">{a.model || '-'}</span>
                    <span className={n ? 'archive-warn' : 'archive-ok'}>{n ? `주의 ${n}` : '검증 통과'}</span>
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
          보관함에서 고른 <b>{scopeLabel(viewing)} · {viewing.period_from}~{viewing.period_to}년</b> 보고서({formatWhen(viewing.created_at)})를 보고 있어요.
          {' '}<button className="more-link" onClick={() => setViewing(null)}>최신 보고서로 돌아가기</button>
        </p>
      )}

      {error && <p className="error">{error}</p>}
      {!state && !error && <p className="placeholder-text">불러오는 중…</p>}
      {state && !state.aiReady && <p className="placeholder-text">AI 설정이 없어 보고서를 만들 수 없어요 (backend/.env 의 AI_BASE_URL, AI_MODEL).</p>}
      {state && state.summary === undefined && !error && <p className="placeholder-text">불러오는 중…</p>}
      {state && state.summary === null && state.aiReady && !busy && !viewing && (
        <p className="placeholder-text">{from}~{to}년 기술 분석은 아직 없어요. "기술 분석 만들기"를 누르면 1~3분 안에 만들어져요.</p>
      )}

      {shown && (
        <>
          <p className="table-meta">
            모델 {shown.model || '-'} · 분류 기준 {shown.criteria_version}
            {stale && <b className="warn-text"> (지금 기준 {state.criteriaVersion}과 달라요. 다시 만들기를 권해요)</b>}
            {' '}· {formatWhen(shown.created_at)}
          </p>
          <div className="summary-actions">
            <button
              className="more-link"
              onClick={async () => { await copyText(reportText(shown)); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
            >
              {copied ? '복사했어요' : '보고서 복사'}
            </button>
            <button
              className="more-link"
              onClick={() => downloadText(reportText(shown), `AI기술분석_${scopeName}_${shown.period_from}-${shown.period_to}_${toLocal(shown.created_at).toISOString().slice(0, 10)}.md`)}
            >
              내려받기 (.md)
            </button>
          </div>
          <TechReport report={shown.report} checks={shown.checks} onOpenPatent={onOpenPatent} />
          <button className="more-link" onClick={() => setShowFacts((v) => !v)} aria-expanded={showFacts}>
            {showFacts ? 'AI에게 준 자료 닫기' : 'AI에게 준 자료 보기'}
          </button>
          {showFacts && <pre className="ai-facts">{shown.facts}</pre>}
        </>
      )}
    </div>
  )
}
