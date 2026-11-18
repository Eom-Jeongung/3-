import { useEffect, useState } from 'react'
import { jsonOrThrow } from '../format.js'

const CHECKS = [
  ['strangeNumbers', '특허에 없는 숫자'],
  ['unsupported', '초록에 없는 효과를 덧붙였을 수 있음'],
  ['missingSections', '빠진 칸(답이 잘렸을 수 있음)'],
]

// 특허 상세의 "개별 요약" 칸: 버튼을 누르면 AI가 이 특허의 명칭·초록(+ 받아 둔 대표 청구항)만 보고 요약한다
export default function PatentSummary({ id }) {
  const [state, setState] = useState(null) // { summary, aiReady, enoughText }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    setState(null)
    setError(null)
    fetch(`/api/patents/${id}/summary`)
      .then(jsonOrThrow)
      .then(setState)
      .catch((e) => setError(e.message))
  }, [id])

  async function generate() {
    setBusy(true)
    setError(null)
    try {
      const body = await jsonOrThrow(await fetch(`/api/patents/${id}/summary`, { method: 'POST' }))
      setState((s) => ({ ...s, summary: body.summary }))
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const summary = state?.summary
  const issues = summary ? CHECKS.filter(([k]) => summary.checks[k]?.length) : []

  return (
    <div className="patent-summary">
      {!state && !error && <p className="placeholder-text">불러오는 중…</p>}
      {state && !state.aiReady && <p className="placeholder-text">AI 설정이 없어 요약을 만들 수 없어요.</p>}
      {state && state.aiReady && !state.enoughText && <p className="placeholder-text">초록이 없거나 너무 짧아서 요약할 내용이 부족해요.</p>}
      {state && state.aiReady && state.enoughText && (
        <button className="more-btn" onClick={generate} disabled={busy}>
          <span className="more-label">{busy ? '요약하는 중… (30초~2분)' : summary ? '다시 만들기' : 'AI로 요약하기'}</span>
        </button>
      )}
      {error && <p className="error">{error}</p>}
      {summary && (
        <>
          <div className="patent-summary-body">
            {summary.content.split('\n').map((raw, i) => {
              const line = raw.trim()
              if (!line) return null
              if (line.startsWith('#')) return <h4 key={i}>{line.replace(/^#+\summary*/, '')}</h4>
              return <p key={i}>{line}</p>
            })}
          </div>
          {issues.length > 0 && (
            <div className="check-warn">
              <b>자동 검사에서 확인이 필요한 부분이 있어요</b>
              <ul>{issues.map(([k, label]) => <li key={k}>{label}: {summary.checks[k].join(', ')}</li>)}</ul>
            </div>
          )}
          <p className="muted">
            AI가 이 특허의 명칭·초록{summary.used_claim ? '·대표 청구항' : ''}만 보고 쓴 요약이에요. 원문과 함께 확인해 주세요.
            · {new Date(`${summary.created_at.replace(' ', 'T')}Z`).toLocaleString('ko-KR')} · {summary.model}
          </p>
        </>
      )}
      {!summary && state?.enoughText && state?.aiReady && (
        <p className="muted">한 줄 요약, 해결하려는 문제, 핵심 해결 수단, 기존 기술과의 차이, 핵심 키워드로 정리해요. 청구항을 먼저 불러오면 청구항도 함께 봐요.</p>
      )}
    </div>
  )
}
