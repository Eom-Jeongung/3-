import { useEffect, useRef, useState } from 'react'
import { periodAxisLabel } from '../format.js'

const HEIGHT = 300
const MARGIN = { top: 28, right: 14, bottom: 30, left: 44 }
const MAX_X_LABELS = 7

const OTHERS = ['미분류', '그 외']

/** 색은 분야를 따라간다. 기간이나 회사를 바꿔도 같은 분야는 같은 색 */
export function seriesColor(group, groups) {
  if (OTHERS.includes(group)) return 'var(--series-other)'
  const named = groups.filter((g) => !OTHERS.includes(g))
  return `var(--series-${named.indexOf(group) + 1})`
}

const niceMax = (max) => {
  if (max <= 0) return 10
  const step = 10 ** Math.floor(Math.log10(max))
  const ratio = max / step
  return ([1, 2, 3, 4, 6, 8, 10].find((n) => ratio <= n)) * step
}

const compact = (n) => (n >= 1000 ? `${n / 1000}K` : String(n))

/** 여러 패널이 같은 눈금을 쓰도록 부모가 넘겨줄 최댓값 */
export const chartMax = (data) => niceMax(Math.max(0, ...data.companies.flatMap((c) => Object.values(data.series[c]).flat())))

// 회사 하나의 분야별 출원 추이. 눈금(yMax)은 패널끼리 같아야 비교할 수 있다
export default function TrendChart({ title, periods, groups, series, yMax }) {
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
  const step = periods.length > 1 ? innerWidth / (periods.length - 1) : 0
  const x = (i) => MARGIN.left + (periods.length > 1 ? i * step : innerWidth / 2)
  const y = (v) => MARGIN.top + innerHeight - (v / yMax) * innerHeight

  const firstIncomplete = periods.findIndex((p) => p.incomplete)
  const shadeStart = firstIncomplete === -1 ? null
    : firstIncomplete === 0 ? MARGIN.left : x(firstIncomplete) - step / 2
  const shadeWidth = shadeStart === null ? 0 : MARGIN.left + innerWidth - shadeStart

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * yMax)
  const labelEvery = Math.ceil(periods.length / MAX_X_LABELS)

  const hoverAt = (clientX) => {
    if (!periods.length || !innerWidth) return
    const box = wrapRef.current.getBoundingClientRect()
    const i = periods.length > 1 ? Math.round((clientX - box.left - MARGIN.left) / step) : 0
    setHover(Math.min(Math.max(i, 0), periods.length - 1))
  }

  const tipOnRight = hover !== null && x(hover) < width / 2

  return (
    <figure className="trend-chart" aria-label={`${title} 분야별 출원 추이`}>
      <figcaption>{title}</figcaption>
      <div
        className="chart-box"
        ref={wrapRef}
        tabIndex={0}
        role="group"
        aria-label={`${title} 그래프. 좌우 화살표로 구간을 옮기면 값을 볼 수 있어요`}
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
            {shadeStart !== null && (
              <>
                <rect x={shadeStart} y={MARGIN.top} width={shadeWidth} height={innerHeight} className="chart-shade" />
                <text x={shadeStart + shadeWidth - 6} y={MARGIN.top + 14} textAnchor="end" className="chart-shade-label">미공개 출원 반영 전</text>
              </>
            )}
            {ticks.map((t) => (
              <g key={t}>
                <line x1={MARGIN.left} x2={MARGIN.left + innerWidth} y1={y(t)} y2={y(t)} className="chart-grid" />
                <text x={MARGIN.left - 8} y={y(t) + 4} textAnchor="end" className="chart-axis">{compact(t)}</text>
              </g>
            ))}
            {periods.map((p, i) => (i % labelEvery === (periods.length - 1) % labelEvery) && (
              <text key={p.key} x={x(i)} y={HEIGHT - 8} textAnchor="middle" className="chart-axis">{periodAxisLabel(p)}</text>
            ))}
            {groups.map((g) => (
              <polyline
                key={g}
                fill="none"
                stroke={seriesColor(g, groups)}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                points={series[g].map((v, i) => `${x(i)},${y(v)}`).join(' ')}
              />
            ))}
            {periods.length === 1 && groups.map((g) => (
              <circle key={g} cx={x(0)} cy={y(series[g][0])} r="4" fill={seriesColor(g, groups)} />
            ))}
            {hover !== null && (
              <>
                <line x1={x(hover)} x2={x(hover)} y1={MARGIN.top} y2={MARGIN.top + innerHeight} className="chart-cross" />
                {groups.map((g) => (
                  <circle key={g} cx={x(hover)} cy={y(series[g][hover])} r="4" fill={seriesColor(g, groups)} className="chart-dot" />
                ))}
              </>
            )}
          </svg>
        )}
        {hover !== null && (
          <div className="chart-tip" style={tipOnRight ? { left: x(hover) + 12 } : { right: width - x(hover) + 12 }}>
            <strong>{periods[hover].label}</strong>
            {periods[hover].incomplete && <span className="chart-tip-note">미공개 출원 반영 전</span>}
            {[...groups].sort((a, b) => series[b][hover] - series[a][hover]).map((g) => (
              <div key={g} className="chart-tip-row">
                <i style={{ background: seriesColor(g, groups) }} />
                <b>{series[g][hover].toLocaleString('ko-KR')}</b>
                <span>{g}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </figure>
  )
}
