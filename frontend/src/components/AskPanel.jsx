import { useEffect, useRef, useState } from 'react'

const EXAMPLES = ['자사 소자 분야 최근 추이 알려줘', '삼성이 우리보다 많이 늘린 분야는?', '탠덤 관련 최근 공개 특허 보여줘']
const WINDOW_LABELS = ['최근 12개월', '1년 전', '2년 전']

const formatCount = (n) => n.toLocaleString('ko-KR')
const percent = (change) => (change === null ? '-' : `${change > 0 ? '+' : ''}${change}%`)

function TrendEvidence({ evidence }) {
  return (
    <table className="ask-table">
      <caption>{evidence.field} · 공개 건수</caption>
      <thead>
        <tr>
          <th scope="col">회사</th>
          {[2, 1, 0].map((i) => <th key={i} scope="col" className="num">{WINDOW_LABELS[i]}</th>)}
          <th scope="col" className="num">증감</th>
        </tr>
      </thead>
      <tbody>
        {evidence.series.map((s) => (
          <tr key={s.company}>
            <th scope="row">{s.name}</th>
            {[2, 1, 0].map((i) => <td key={i} className="num">{formatCount(s.counts[i])}</td>)}
            <td className="num">{percent(s.change)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function CompareEvidence({ evidence }) {
  return (
    <table className="ask-table">
      <caption>최근 12개월 공개 건수 · 증감은 1년 전 비교</caption>
      <thead>
        <tr>
          <th scope="col">분야</th>
          <th scope="col" className="num">자사</th>
          <th scope="col" className="num">증감</th>
          <th scope="col" className="num">경쟁사</th>
          <th scope="col" className="num">증감</th>
        </tr>
      </thead>
      <tbody>
        {evidence.fields.map((f) => (
          <tr key={f.field}>
            <th scope="row">{f.field}</th>
            <td className="num">{formatCount(f.own.counts[0])}</td>
            <td className="num">{percent(f.own.change)}</td>
            <td className="num">{formatCount(f.competitor.counts[0])}</td>
            <td className="num">{percent(f.competitor.change)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function PatentEvidence({ evidence, onSelectPatent }) {
  return (
    <div>
      <p className="ask-note">
        찾은 특허 {formatCount(evidence.total)}건 중 최근 공개 {evidence.items.length}건
        {evidence.keywords.length > 0 && ` · 검색어: ${evidence.keywords.join(', ')}`}
      </p>
      <ul className="ask-patents">
        {evidence.items.map((p) => (
          <li key={p.id}>
            <button onClick={() => onSelectPatent(p.id)}>{p.title}</button>
            <span className="muted">{p.company} · {p.openDate ?? '공개일 없음'}{p.field ? ` · ${p.field}` : ''}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Evidence({ evidence, onSelectPatent }) {
  if (evidence.kind === 'trend') return <TrendEvidence evidence={evidence} />
  if (evidence.kind === 'compare') return <CompareEvidence evidence={evidence} />
  return <PatentEvidence evidence={evidence} onSelectPatent={onSelectPatent} />
}

// 오른쪽 AI 질문 패널. 답변은 항상 DB 조회 결과(근거)와 함께 보여 준다
export default function AskPanel({ open, onClose, onSelectPatent }) {
  const [status, setStatus] = useState(null)
  const [statusError, setStatusError] = useState(false)
  const [question, setQuestion] = useState('')
  const [turns, setTurns] = useState([])
  const [asking, setAsking] = useState(false)
  const inputRef = useRef(null)
  const logRef = useRef(null)

  useEffect(() => {
    fetch('/api/ask/status')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setStatus)
      .catch(() => setStatusError(true))
  }, [])

  useEffect(() => {
    if (!open) return undefined
    inputRef.current?.focus()
    const onKey = (e) => {
      // 특허 상세가 위에 열려 있으면 ESC는 상세만 닫는다
      if (e.key === 'Escape' && !document.querySelector('.drawer')) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [turns, asking])

  async function ask(text) {
    const q = text.trim()
    if (!q || asking) return
    setAsking(true)
    setQuestion('')
    setTurns((t) => [...t, { question: q }])
    let result
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error)
      result = body
      setStatus((s) => ({ ...s, remaining: body.remaining }))
    } catch (err) {
      result = { error: err.message }
    }
    setTurns((t) => [...t.slice(0, -1), { question: q, ...result }])
    setAsking(false)
    inputRef.current?.focus()
  }

  const notConfigured = status && !status.configured
  const disabled = asking || notConfigured || statusError || status?.remaining <= 0

  return (
    <aside className="ask-panel" aria-label="AI 질문">
      <header className="ask-head">
        <h2>AI 질문</h2>
        <button className="drawer-close" onClick={onClose} aria-label="AI 질문 닫기">✕</button>
      </header>

      <div className="ask-log" ref={logRef} aria-live="polite">
        {notConfigured && <p className="error">AI 연결 전이에요. backend/.env에 AI_BASE_URL과 AI_MODEL을 넣으면 사용할 수 있어요.</p>}
        {statusError && <p className="error">AI 상태를 불러오지 못했어요.</p>}

        {turns.length === 0 && !notConfigured && !statusError && (
          <div className="ask-intro">
            <p>자사·삼성디스플레이의 국내 공개 특허에 대해 물어보세요. 숫자는 DB에서 가져오고, AI는 문장만 써요.</p>
            {EXAMPLES.map((e) => (
              <button key={e} className="ask-example" onClick={() => ask(e)} disabled={disabled}>{e}</button>
            ))}
          </div>
        )}

        {turns.map((t, i) => (
          <article key={i} className="ask-turn">
            <p className="ask-question">{t.question}</p>
            {t.error && <p className="error">{t.error}</p>}
            {t.answer && <p className="ask-answer">{t.answer}</p>}
            {t.source === 'template' && <p className="ask-note">AI 문장을 검증하지 못해 조회 결과를 그대로 보여 드려요.</p>}
            {t.evidence?.length > 0 && (
              <div className="ask-evidence">
                <h3>근거</h3>
                {t.evidence.map((e, j) => <Evidence key={j} evidence={e} onSelectPatent={onSelectPatent} />)}
              </div>
            )}
            {t.source === 'ai' && <p className="ask-note">AI가 작성한 문장이에요. 위 근거와 함께 확인해 주세요.</p>}
          </article>
        ))}
        {asking && <p className="ask-note" role="status">답변을 만드는 중이에요…</p>}
      </div>

      <form className="ask-form" onSubmit={(e) => { e.preventDefault(); ask(question) }}>
        <input
          ref={inputRef}
          className="filter-input"
          aria-label="질문"
          placeholder="질문을 입력하세요"
          maxLength={300}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={disabled}
        />
        <button type="submit" disabled={disabled || !question.trim()}>질문</button>
      </form>
      {status?.configured && <p className="ask-note ask-remaining">오늘 남은 질문 {status.remaining}회</p>}
    </aside>
  )
}
