import { useEffect, useState } from 'react'

const SERIES = [
  { key: 'own', label: '자사 (엘지디스플레이)' },
  { key: 'competitor', label: '경쟁사 (삼성디스플레이)' },
]

const pct = (n, total) => (total ? (n / total) * 100 : 0)
const fmtPct = (v) => `${v < 1 ? v.toFixed(2) : v.toFixed(1)}%`

// 자사 vs 경쟁사 기술분야 비교. 분류 체계·키워드는 인터뷰에서 검증할 가정이라 화면에 그대로 노출한다
export default function TechCategoryCompare({ refreshKey }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch('/api/tech-categories/compare')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch((e) => setError(e.message))
  }, [refreshKey])

  if (error) return <p className="error">기술분야 비교를 불러오지 못했습니다: {error}</p>
  if (!data) return null

  const { totals, categories } = data
  const rows = categories.filter((c) => c.portfolio)
  const unclassified = categories.find((c) => !c.portfolio)
  // 막대 길이 = 회사별 전체 출원 대비 비중. 가장 큰 값을 100% 폭으로
  const maxShare = Math.max(...rows.flatMap((c) => SERIES.map((s) => pct(c.portfolio[s.key], totals[s.key]))))

  return (
    <section className="card compare">
      <div className="compare-head">
        <div>
          <h2>자사 vs 경쟁사 기술분야 비교</h2>
          <p className="subtitle">
            KIPRIS 전체 출원 기준 · 자사 {totals.own.toLocaleString()}건 / 경쟁사 {totals.competitor.toLocaleString()}건 중
            분야 키워드가 초록에 등장하는 비중
          </p>
        </div>
        <div className="legend">
          {SERIES.map((s) => (
            <span key={s.key} className="legend-item"><i className={`swatch ${s.key}`} />{s.label}</span>
          ))}
        </div>
      </div>

      <p className="assumption">
        <strong>가정</strong> 아래 분류(대형OLED · P-OLED · 차량용 · 폴더블·탠덤)와 키워드는 임시로 정한 것입니다.
        실제 사내 분류 기준과 맞나요?
      </p>

      <div className="compare-rows">
        {rows.map((c) => (
          <div key={c.name} className="compare-row">
            <div className="compare-label">
              <strong>{c.name}</strong>
              <div className="keywords">
                {c.keywords.map((k) => <span key={k} className="kw">{k}</span>)}
                {c.ipcPrefixes.map((k) => <span key={k} className="kw ipc">IPC {k}</span>)}
              </div>
            </div>
            <div className="bars">
              {SERIES.map((s) => {
                const n = c.portfolio[s.key]
                const share = pct(n, totals[s.key])
                return (
                  <div key={s.key} className="bar-line" title={`${c.name} · ${s.label}: ${n.toLocaleString()}건 (${fmtPct(share)})`}>
                    <div className="bar-track">
                      <div className={`bar ${s.key}`} style={{ width: `${(share / maxShare) * 100}%` }} />
                    </div>
                    <span className="bar-value">{n.toLocaleString()}건 <span className="muted">{fmtPct(share)}</span></span>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <p className="footnote">
        한 특허가 여러 분야 키워드를 포함하면 중복 집계됩니다. 위 대시보드 샘플 100건에 같은 규칙을 적용하면{' '}
        {unclassified.sample.own + unclassified.sample.competitor}건이 미분류입니다 — 샘플 대부분이 만료임박
        시연을 위한 2006~2007년 출원(LCD 위주)이기 때문입니다.
      </p>
    </section>
  )
}
