import { useEffect, useRef, useState } from 'react'

const formatCount = (n) => n.toLocaleString('ko-KR')

// KPI 카드 오른쪽 아래 작은 선 그래프
export function Sparkline({ values, tone }) {
  const W = 120
  const H = 36
  const max = Math.max(...values, 1)
  const min = Math.min(...values)
  const span = max - min || 1
  const pts = values.map((v, i) => [(i / Math.max(values.length - 1, 1)) * (W - 4) + 2, H - 4 - ((v - min) / span) * (H - 8)])
  return (
    <svg className={`sparkline tone-${tone}`} viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true">
      <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={i === pts.length - 1 ? 3 : 0} />)}
    </svg>
  )
}

const niceMax = (max) => {
  if (max <= 0) return 10
  const step = 10 ** Math.floor(Math.log10(max))
  return [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((n) => max / step <= n) * step
}

// 연간 출원 추이: 회사별 선 + 옅은 면. 공개가 덜 된 연도는 음영
export function DashLineChart({ periods, lines }) {
  const ref = useRef(null)
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState(null)
  useEffect(() => {
    const ob = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ob.observe(ref.current)
    return () => ob.disconnect()
  }, [])

  const H = 260
  const M = { top: 16, right: 16, bottom: 28, left: 44 }
  const iw = Math.max(width - M.left - M.right, 0)
  const ih = H - M.top - M.bottom
  const yMax = niceMax(Math.max(1, ...lines.flatMap((l) => l.values)))
  const step = periods.length > 1 ? iw / (periods.length - 1) : 0
  const x = (i) => M.left + i * step
  const y = (v) => M.top + ih - (v / yMax) * ih
  const firstInc = periods.findIndex((p) => p.incomplete)
  const shadeX = firstInc === -1 ? null : Math.max(M.left, x(firstInc) - step / 2)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * yMax)

  const pick = (clientX) => {
    if (!iw) return
    const i = Math.round((clientX - ref.current.getBoundingClientRect().left - M.left) / step)
    setHover(Math.min(Math.max(i, 0), periods.length - 1))
  }

  return (
    <div
      className="dash-chart"
      ref={ref}
      tabIndex={0}
      role="group"
      aria-label="연간 출원 추이 그래프. 좌우 화살표로 연도를 옮기면 값을 볼 수 있어요"
      onPointerMove={(e) => pick(e.clientX)}
      onPointerLeave={() => setHover(null)}
      onFocus={() => setHover((h) => h ?? periods.length - 1)}
      onBlur={() => setHover(null)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') setHover((h) => Math.max((h ?? 0) - 1, 0))
        if (e.key === 'ArrowRight') setHover((h) => Math.min((h ?? 0) + 1, periods.length - 1))
      }}
    >
      {width > 0 && (
        <svg width={width} height={H} aria-hidden="true">
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
              <rect x={shadeX} y={M.top} width={M.left + iw - shadeX} height={ih} className="chart-shade" />
              <text x={M.left + iw - 6} y={M.top + 14} textAnchor="end" className="chart-shade-label">미공개 출원 반영 전</text>
            </>
          )}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={M.left + iw} y1={y(t)} y2={y(t)} className="chart-grid" />
              <text x={M.left - 8} y={y(t) + 4} textAnchor="end" className="chart-axis">{formatCount(t)}</text>
            </g>
          ))}
          {periods.map((p, i) => (
            <text key={p.key} x={x(i)} y={H - 6} textAnchor="middle" className={`chart-axis ${p.incomplete ? 'axis-dim' : ''}`}>{p.key}</text>
          ))}
          {lines.map((l) => {
            // 공개가 끝난 연도까지는 실선+면, 그 뒤(미공개 반영 전)는 점선으로 이어서 '줄어든 것처럼' 보이지 않게 한다
            const done = firstInc === -1 ? l.values.length - 1 : Math.max(firstInc - 1, 0)
            const pts = (from, to) => l.values.slice(from, to + 1).map((v, k) => `${x(from + k)},${y(v)}`).join(' ')
            return (
              <g key={l.key} className={`line-${l.tone}`}>
                <path d={`M${x(0)},${y(0)} ${l.values.slice(0, done + 1).map((v, i) => `L${x(i)},${y(v)}`).join(' ')} L${x(done)},${y(0)} Z`} fill={`url(#fill-${l.key})`} stroke="none" />
                <polyline points={pts(0, done)} fill="none" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
                {done < l.values.length - 1 && (
                  <polyline points={pts(done, l.values.length - 1)} fill="none" strokeWidth="2" strokeDasharray="4 5" strokeLinecap="round" opacity="0.6" />
                )}
                {l.values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={hover === i ? 5 : 3} className="chart-dot" opacity={i > done ? 0.6 : 1} />)}
              </g>
            )
          })}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={M.top} y2={M.top + ih} className="chart-cross" />}
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
  const R = 70
  const C = 2 * Math.PI * R
  let offset = 0
  return (
    <div className="donut" role="img" aria-label={`전체 출원 ${formatCount(total)}건의 1차 분류별 비중`}>
      <svg viewBox="0 0 200 200" aria-hidden="true">
        <circle cx="100" cy="100" r={R} fill="none" className="donut-track" strokeWidth="28" />
        {slices.map((s) => {
          const len = total ? (s.value / total) * C : 0
          const el = (
            <circle
              key={s.label} cx="100" cy="100" r={R} fill="none" stroke={s.color} strokeWidth="28"
              strokeDasharray={`${Math.max(len - 1.5, 0)} ${C}`} strokeDashoffset={-offset}
              transform="rotate(-90 100 100)"
            />
          )
          offset += len
          return el
        })}
      </svg>
      <div className="donut-center">
        <small>전체 출원</small>
        <strong>{formatCount(total)}</strong>
        <small>건</small>
      </div>
    </div>
  )
}
