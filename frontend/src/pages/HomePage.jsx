import TrendSection from '../components/TrendSection.jsx'

const SERIES = [
  { key: 'own', label: '자사', tag: 'own' },
  { key: 'competitor', label: '경쟁사', tag: 'competitor' },
]


const formatDate = (iso) => iso.replaceAll('-', '.')
const formatRange = ({ from, to }) => `${formatDate(from)} ~ ${formatDate(to)}`
const WINDOW_LABELS = ['최근 12개월', '1년 전', '2년 전']

const formatCount = (n) => n.toLocaleString('ko-KR')
const signed = (pct) => `${pct > 0 ? '+' : ''}${pct}%`

// 건수가 적은 분야는 몇 건 차이로 %가 크게 흔들려 표시하지 않는다 (백엔드 changeOf와 같은 기준)
function changeText(current, previous, minCount = 0) {
  if (!previous || previous < minCount) return '-'
  return signed(Math.round(((current - previous) / previous) * 100))
}

const fieldLink = (level2) => `#/field?level2=${encodeURIComponent(level2)}`

export default function HomePage({ overview, refreshKey }) {
  const windows = overview?.windows ?? []
  const latest = windows[0]
  const fields = overview?.fields ?? []
  const minCount = overview?.minCount ?? 0
  const movers = overview?.movers
  const unclassifiedTotal = overview ? overview.unclassified.own[0] + overview.unclassified.competitor[0] : 0
  const recentTotal = latest ? latest.own + latest.competitor : 0

  return (
    <>
      <header className="hero">
        <h1 className="page-title">트렌드 분석</h1>
        <p className="period">엘지디스플레이(자사) · 삼성디스플레이(경쟁사) 기술 분야별 특허 흐름</p>
        <a className="hero-btn" href="#/patents">특허 목록 &gt;</a>
      </header>


      <div className="page-body">
        <TrendSection refreshKey={refreshKey} showAiSummary={false} />

        {fields.length > 0 && (
          <section className="card card-gap" aria-labelledby="fields-title">
            <h2 id="fields-title" className="card-title">최근 공개 동향</h2>
            <p className="table-meta">공개일 기준 {latest && formatRange(latest)} · 왼쪽부터 2년 전, 1년 전, 최근 12개월 · 증감은 최근 12개월과 1년 전 비교</p>
            <div className="table-wrap">
              <table className="field-table">
                <thead>
                  <tr>
                    <th scope="col" rowSpan="2">기술 분야</th>
                    {SERIES.map((s) => <th key={s.key} scope="colgroup" colSpan="4" className="group-head">{s.label}</th>)}
                  </tr>
                  <tr>
                    {SERIES.flatMap((s) => [
                      ...[2, 1, 0].map((i) => <th key={`${s.key}${i}`} scope="col" className="num" title={formatRange(windows[i])}>{WINDOW_LABELS[i]}</th>),
                      <th key={`${s.key}c`} scope="col" className="num">증감</th>,
                    ])}
                  </tr>
                </thead>
                <tbody>
                  {fields.map((f) => (
                    <tr key={f.level2}>
                      <th scope="row"><a className="field-link" href={fieldLink(f.level2)}>{f.level2}</a></th>
                      {SERIES.flatMap((s) => [
                        ...[2, 1, 0].map((i) => <td key={`${s.key}${i}`} className="num">{formatCount(f[s.key][i])}</td>),
                        <td key={`${s.key}c`} className="num trend-change">{changeText(f[s.key][0], f[s.key][1], minCount)}</td>,
                      ])}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="footnote">
              최근 12개월 공개 {formatCount(recentTotal)}건 중 미분류 {formatCount(unclassifiedTotal)}건은 빠져 있어요.
              분류는 규칙 기반 자동 분류(무작위 검증 정확도 약 85%)이고, 공개된 특허는 대체로 1년 반쯤 전에 출원한 기술이에요.
              1년 전 건수가 {minCount}건 미만이면 증감을 표시하지 않아요.
            </p>
          </section>
        )}

        {movers && (movers.own.length > 0 || movers.competitor.length > 0) && (
          <section className="card card-gap" aria-labelledby="movers-title">
            <h2 id="movers-title" className="card-title">많이 늘어난 세부 기술</h2>
            <p className="table-meta">최근 12개월과 1년 전 비교 · 1년 전 {minCount}건 이상인 기술만</p>
            <div className="movers">
              {SERIES.map((s) => (
                <div key={s.key}>
                  <h3 className="movers-title"><span className={`type-tag ${s.tag}`}>{s.label}</span></h3>
                  <ol className="mover-list">
                    {movers[s.key].map((m) => (
                      <li key={`${m.level2}${m.level3}`}>
                        <span>
                          {m.level3} <span className="muted">{m.level2}</span>
                        </span>
                        <span className="mover-value">
                          <b>{signed(m.change)}</b> <span className="muted">{m.counts[1]} → {m.counts[0]}건</span>
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          </section>
        )}

      </div>
    </>
  )
}
