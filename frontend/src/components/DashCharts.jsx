import { useEffect, useRef, useState } from 'react'
import { formatCount, niceAxisMax } from '../format.js'

// KPI 카드 오른쪽 아래 작은 선 그래프
export function Sparkline({ values, tone }) {
  const WIDTH = 120
  const HEIGHT = 36
  const max = Math.max(...values, 1)
  const min = Math.min(...values)
  const span = max - min || 1
  const points = values.map((v, i) => [(i / Math.max(values.length - 1, 1)) * (WIDTH - 4) + 2, HEIGHT - 4 - ((v - min) / span) * (HEIGHT - 8)])
  return (
    <svg className={`sparkline tone-${tone}`} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width={WIDTH} height={HEIGHT} aria-hidden="true">
      <polyline points={points.map((p) => p.join(',')).join(' ')} fill="none" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {points.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={i === points.length - 1 ? 3 : 0} />)}
    </svg>
  )
}

// 연간 출원 추이: 회사별 선 + 옅은 면. 공개가 덜 된 연도는 음영
export function DashLineChart({ periods, lines }) {
  const wrapRef = useRef(null)
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState(null)
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(wrapRef.current)
    return () => observer.disconnect()
  }, [])

  const HEIGHT = 260
  const MARGIN = { top: 16, right: 16, bottom: 28, left: 44 }
  const innerWidth = Math.max(width - MARGIN.left - MARGIN.right, 0)
  const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom
  const yMax = niceAxisMax(Math.max(1, ...lines.flatMap((l) => l.values)))
  const step = periods.length > 1 ? innerWidth / (periods.length - 1) : 0
  const x = (i) => MARGIN.left + i * step
  const y = (v) => MARGIN.top + innerHeight - (v / yMax) * innerHeight
  const firstIncomplete = periods.findIndex((p) => p.incomplete)
  const shadeX = firstIncomplete === -1 ? null : Math.max(MARGIN.left, x(firstIncomplete) - step / 2)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * yMax)

  const hoverAt = (clientX) => {
    if (!innerWidth) return
    const i = Math.round((clientX - wrapRef.current.getBoundingClientRect().left - MARGIN.left) / step)
    setHover(Math.min(Math.max(i, 0), periods.length - 1))
  }

  return (
    <div
      className="dash-chart"
      ref={wrapRef}
      tabIndex={0}
      role="group"
      aria-label="연간 출원 추이 그래프. 좌우 화살표로 연도를 옮기면 값을 볼 수 있어요"
      onPointerMove={(e) => hoverAt(e.clientX)}
      onPointerLeave={() => setHover(null)}
      onFocus={() => setHover((h) => h ?? periods.length - 1)}
      onBlur={() => setHover(null)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') setHover((h) => Math.max((h ?? 0) - 1, 0))
        if (e.key === 'ArrowRight') setHover((h) => Math.min((h ?? 0) + 1, periods.length - 1))
      }}
    >
      {width > 0 && (
        <svg width={width} height={HEIGHT} aria-hidden="true">
          <defs>
            {lines.map((l) => (
              <linearGradient key={l.key} id={`fill-${l.key}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" className={`grad-${l.tone}`} stopOpacity="0.16" />
                <stop offset="1" className={`grad-${l.tone}`} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>
          {shadeX !== null && (
            <>
              <rect x={shadeX} y={MARGIN.top} width={MARGIN.left + innerWidth - shadeX} height={innerHeight} className="chart-shade" />
              <text x={MARGIN.left + innerWidth - 6} y={MARGIN.top + 14} textAnchor="end" className="chart-shade-label">미공개 출원 반영 전</text>
            </>
          )}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={MARGIN.left} x2={MARGIN.left + innerWidth} y1={y(t)} y2={y(t)} className="chart-grid" />
              <text x={MARGIN.left - 8} y={y(t) + 4} textAnchor="end" className="chart-axis">{formatCount(t)}</text>
            </g>
          ))}
          {periods.map((p, i) => (
            <text key={p.key} x={x(i)} y={HEIGHT - 6} textAnchor="middle" className={`chart-axis ${p.incomplete ? 'axis-dim' : ''}`}>{p.key}</text>
          ))}
          {lines.map((l) => {
            // 공개가 끝난 연도까지는 실선+면, 그 뒤(미공개 반영 전)는 점선으로 이어서 '줄어든 것처럼' 보이지 않게 한다
            const lastComplete = firstIncomplete === -1 ? l.values.length - 1 : Math.max(firstIncomplete - 1, 0)
            const pointsBetween = (from, to) => l.values.slice(from, to + 1).map((v, k) => `${x(from + k)},${y(v)}`).join(' ')
            return (
              <g key={l.key} className={`line-${l.tone}`}>
                <path d={`M${x(0)},${y(0)} ${l.values.slice(0, lastComplete + 1).map((v, i) => `L${x(i)},${y(v)}`).join(' ')} L${x(lastComplete)},${y(0)} Z`} fill={`url(#fill-${l.key})`} stroke="none" />
                <polyline points={pointsBetween(0, lastComplete)} fill="none" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
                {lastComplete < l.values.length - 1 && (
                  <polyline points={pointsBetween(lastComplete, l.values.length - 1)} fill="none" strokeWidth="2" strokeDasharray="4 5" strokeLinecap="round" opacity="0.6" />
                )}
                {l.values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={hover === i ? 5 : 3} className="chart-dot" opacity={i > lastComplete ? 0.6 : 1} />)}
              </g>
            )
          })}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={MARGIN.top} y2={MARGIN.top + innerHeight} className="chart-cross" />}
        </svg>
      )}
      {hover !== null && (
        <div className="chart-tip" style={x(hover) < width / 2 ? { left: x(hover) + 12 } : { right: width - x(hover) + 12 }}>
          <strong>{periods[hover].label}</strong>
          {periods[hover].incomplete && <span className="chart-tip-note">미공개 출원 반영 전</span>}
          {lines.map((l) => (
            <div key={l.key} className="chart-tip-row">
              <i className={`tone-bg-${l.tone}`} />
              <b>{formatCount(l.values[hover])}</b>
              <span>{l.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// 기술 분야별 비중 도넛
export function Donut({ slices, total }) {
  const RADIUS = 70
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS
  // 조각마다 앞 조각들의 길이만큼 밀어서 그린다
  const lengths = slices.map((s) => (total ? (s.value / total) * CIRCUMFERENCE : 0))
  const offsetOf = (index) => lengths.slice(0, index).reduce((sum, len) => sum + len, 0)
  return (
    <div className="donut" role="img" aria-label={`전체 출원 ${formatCount(total)}건의 1차 분류별 비중`}>
      <svg viewBox="0 0 200 200" aria-hidden="true">
        <circle cx="100" cy="100" r={RADIUS} fill="none" className="donut-track" strokeWidth="28" />
        {slices.map((s, i) => (
          <circle
            key={s.label} cx="100" cy="100" r={RADIUS} fill="none" stroke={s.color} strokeWidth="28"
            strokeDasharray={`${Math.max(lengths[i] - 1.5, 0)} ${CIRCUMFERENCE}`} strokeDashoffset={-offsetOf(i)}
            transform="rotate(-90 100 100)"
          />
        ))}
      </svg>
      <div className="donut-center">
        <small>전체 출원</small>
        <strong>{formatCount(total)}</strong>
        <small>건</small>
      </div>
    </div>
  )
}
