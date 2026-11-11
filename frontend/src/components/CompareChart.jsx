import { useEffect, useRef, useState } from 'react'

// 분류별 비교 (PRD v3 "그래프 하나 안에서 자사와 경쟁사를 비교"): 분야 하나에 회사별 선을 겹쳐 그린 작은 그래프
// 눈금은 패널마다 따로 잡는다 (분야마다 건수 차이가 커서 같은 눈금이면 작은 분야는 바닥에 붙는다)

const HEIGHT = 170
const MARGIN = { top: 12, right: 10, bottom: 22, left: 38 }

export const COMPANY_LABELS = { own: '자사', competitor: '삼성', china: '중국 4사' }

const niceMax = (max) => {
  if (max <= 0) return 10
  const step = 10 ** Math.floor(Math.log10(max))
  return [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((n) => max / step <= n) * step
}
const compact = (n) => (n >= 1000 ? `${Math.round(n / 100) / 10}K` : String(n))
const signed = (pct) => (pct === null || pct === undefined ? '-' : `${pct > 0 ? '+' : ''}${pct}%`)

export default function CompareChart({ title, href, periods, series, companies, summaryRow, summaryRange }) {
  const wrapRef = useRef(null)
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState(null)

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(wrapRef.current)
    return () => observer.disconnect()
  }, [])

  const innerWidth = Math.max(width - MARGIN.left - MARGIN.right, 0)
  const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom
  const yMax = niceMax(Math.max(1, ...companies.flatMap((c) => series[c] ?? [])))
  const step = periods.length > 1 ? innerWidth / (periods.length - 1) : 0
  const x = (i) => MARGIN.left + (periods.length > 1 ? i * step : innerWidth / 2)
  const y = (v) => MARGIN.top + innerHeight - (v / yMax) * innerHeight

  // 공개가 덜 된 구간: 음영 + 점선
  const firstIncomplete = periods.findIndex((p) => p.incomplete)
  const done = firstIncomplete === -1 ? periods.length - 1 : Math.max(firstIncomplete - 1, 0)
  const shadeX = firstIncomplete === -1 ? null : Math.max(MARGIN.left, x(firstIncomplete) - step / 2)
  const xLabel = (p) => (p.key.includes('-H') ? `${p.key.slice(2, 4)}.${p.key.endsWith('1') ? '상' : '하'}` : p.key)
  const labelIdx = [...new Set([0, done, periods.length - 1])]

  const pick = (clientX) => {
    if (!periods.length || !innerWidth) return
    const box = wrapRef.current.getBoundingClientRect()
    const i = periods.length > 1 ? Math.round((clientX - box.left - MARGIN.left) / step) : 0
    setHover(Math.min(Math.max(i, 0), periods.length - 1))
  }
  const pts = (values, from, to) => values.slice(from, to + 1).map((v, k) => `${x(from + k)},${y(v)}`).join(' ')

  return (
    <figure className="compare-panel">
      <figcaption className="compare-head">
        {href ? <a href={href}>{title}</a> : <span>{title}</span>}
        {summaryRow && (
          <span className="compare-change" title={`${summaryRange} 출원 증감 (공개가 끝난 구간끼리)`}>
            {companies.map((c) => (
              <span key={c} className={`tone-text-${c}`}>{COMPANY_LABELS[c]} {signed(summaryRow[c]?.change)}</span>
            ))}
          </span>
        )}
      </figcaption>
      <div
        className="compare-box"
        ref={wrapRef}
        tabIndex={0}
        role="group"
        aria-label={`${title} 회사별 출원 추이. 좌우 화살표로 구간을 옮기면 값을 볼 수 있어요`}
        onPointerMove={(e) => pick(e.clientX)}
        onPointerLeave={() => setHover(null)}
        onFocus={() => setHover((h) => h ?? done)}
        onBlur={() => setHover(null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') setHover((h) => Math.max((h ?? 0) - 1, 0))
          if (e.key === 'ArrowRight') setHover((h) => Math.min((h ?? 0) + 1, periods.length - 1))
        }}
      >
        {width > 0 && (
          <svg width={width} height={HEIGHT} aria-hidden="true">
            {shadeX !== null && <rect x={shadeX} y={MARGIN.top} width={MARGIN.left + innerWidth - shadeX} height={innerHeight} className="chart-shade" />}
            {[0, 0.5, 1].map((t) => (
              <g key={t}>
                <line x1={MARGIN.left} x2={MARGIN.left + innerWidth} y1={y(t * yMax)} y2={y(t * yMax)} className="chart-grid" />
                <text x={MARGIN.left - 6} y={y(t * yMax) + 4} textAnchor="end" className="chart-axis">{compact(t * yMax)}</text>
              </g>
            ))}
            {labelIdx.map((i) => (
              <text key={i} x={x(i)} y={HEIGHT - 6} textAnchor={i === 0 ? 'start' : i === periods.length - 1 ? 'end' : 'middle'} className={`chart-axis ${periods[i].incomplete ? 'axis-dim' : ''}`}>{xLabel(periods[i])}</text>
            ))}
            {companies.map((c) => {
              const values = series[c] ?? []
              return (
                <g key={c} className={`line-${c}`}>
                  <polyline points={pts(values, 0, done)} fill="none" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
                  {done < values.length - 1 && (
                    <polyline points={pts(values, done, values.length - 1)} fill="none" strokeWidth="1.8" strokeDasharray="3 4" strokeLinecap="round" opacity="0.6" />
                  )}
                  {hover !== null && <circle cx={x(hover)} cy={y(values[hover])} r="3.5" className="chart-dot" />}
                </g>
              )
            })}
            {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={MARGIN.top} y2={MARGIN.top + innerHeight} className="chart-cross" />}
          </svg>
        )}
        {hover !== null && (
          <div className="chart-tip" style={x(hover) < width / 2 ? { left: x(hover) + 10 } : { right: width - x(hover) + 10 }}>
            <strong>{periods[hover].label}</strong>
            {periods[hover].incomplete && <span className="chart-tip-note">미공개 출원 반영 전</span>}
            {companies.map((c) => (
              <div key={c} className="chart-tip-row">
                <i className={`tone-bg-${c}`} />
                <b>{(series[c]?.[hover] ?? 0).toLocaleString('ko-KR')}</b>
                <span>{COMPANY_LABELS[c]}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </figure>
  )
}
