import { useEffect, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { DashLineChart, Donut, Sparkline } from '../components/DashCharts.jsx'

const SERIES = [
  { key: 'own', label: '자사', name: 'LG디스플레이', tag: 'own', icon: 'building' },
  { key: 'competitor', label: '삼성', name: '삼성디스플레이', tag: 'competitor', icon: 'building' },
  { key: 'china', label: '중국 4사', name: '중국 4사', tag: 'china', icon: 'globe' },
]

const formatDate = (iso) => iso.replaceAll('-', '.')
const formatRange = ({ from, to }) => `${formatDate(from)} ~ ${formatDate(to)}`
const WINDOW_LABELS = ['최근 12개월', '1년 전', '2년 전']

const formatCount = (n) => n.toLocaleString('ko-KR')
const signed = (pct) => `${pct > 0 ? '+' : ''}${pct}%`
const pctChange = (cur, prev) => (prev ? Math.round(((cur - prev) / prev) * 100) : null)

// 건수가 적은 분야는 몇 건 차이로 %가 크게 흔들려 표시하지 않는다 (백엔드 changeOf와 같은 기준)
function changeText(current, previous, minCount = 0) {
  if (!previous || previous < minCount) return '-'
  return signed(Math.round(((current - previous) / previous) * 100))
}

// 2차 기술 분야 → 아이콘
const FIELD_ICONS = { 회로: 'circuit', 소자: 'atom', 설계: 'pen', 공정: 'flask', 'TFT 소자': 'chip', 기구: 'gear', 재료: 'stack', 광학: 'sun' }

const fieldLink = (level2, level3) => {
  const q = new URLSearchParams({ level2 })
  if (level3) q.set('level3', level3)
  return `#/field?${q}`
}
const sumGroups = (bySeries, i) => Object.values(bySeries).reduce((s, arr) => s + arr[i], 0)

// 서버 오류 코드를 읽기 쉬운 말로 (502~504는 서버가 꺼졌거나 다시 켜지는 중)
export const httpMessage = (status) => (status >= 502 && status <= 504
  ? `서버가 응답하지 않아요. 잠시 뒤 다시 시도해 주세요. (${status})`
  : `서버에서 오류가 났어요. (${status})`)

// 카드 자리에 띄우는 불러오기 실패 안내 + 다시 시도
function LoadFail({ what, message, onRetry }) {
  return (
    <div className="load-fail" role="alert">
      <p><b>{what} 불러오기에 실패했어요.</b> {message}</p>
      {onRetry && <button type="button" className="more-link" onClick={onRetry}>다시 시도</button>}
    </div>
  )
}

function Delta({ value }) {
  if (value === null) return null
  return (
    <span className={`kpi-delta ${value >= 0 ? 'up' : 'down'}`}>
      {value >= 0 ? '↗' : '↘'} {signed(value)}
    </span>
  )
}

// 증감 배지: 늘면 초록, 줄면 주황. 1년 전 건수가 기준 미만이면 회색 '-'
function ChangeBadge({ current, previous, minCount }) {
  const text = changeText(current, previous, minCount)
  if (text === '-') return <span className="change-badge none" title={`1년 전 ${minCount}건 미만이라 표시하지 않아요`}>-</span>
  const dir = current > previous ? 'up' : current < previous ? 'down' : 'flat'
  const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : ''
  return <span className={`change-badge ${dir}`}>{arrow}{text.replace(/^[+-]/, '')}</span>
}

// 2년 전 → 1년 전 → 최근 12개월 막대 3개 (행마다 자기 최댓값 기준이라 흐름 모양을 본다)
function MiniBars({ counts }) {
  const values = [2, 1, 0].map((i) => counts[i] ?? 0)
  const max = Math.max(...values, 1)
  const label = [2, 1, 0].map((i, k) => `${WINDOW_LABELS[i]} ${formatCount(values[k])}건`).join(', ')
  return (
    <span className="mini-bars" role="img" aria-label={label} title={label}>
      {values.map((v, k) => (
        <i key={k} className={k === 2 ? 'latest' : ''} style={{ height: `${Math.max((v / max) * 100, v > 0 ? 6 : 2)}%` }} />
      ))}
    </span>
  )
}

// 최근 공개 동향: 회사 하나의 분야별 최근 12개월 건수와 증감
function CompanyPanel({ series, fields, minCount }) {
  return (
    <section className={`company-panel tone-${series.tag}`} aria-label={`${series.label} 최근 공개 동향`}>
      <h3 className="company-head"><i className={`dot tone-${series.tag}`} />{series.label}</h3>
      <ul className="company-rows">
        {fields.map((f) => {
          const c = f[series.key]
          return (
            <li key={f.level2}>
              <a className="field-link" href={fieldLink(f.level2)}>{f.level2}</a>
              <MiniBars counts={c} />
              <span className="row-count">
                <b>{formatCount(c[0])}</b>
                <small>1년 전 {formatCount(c[1])}</small>
              </span>
              <ChangeBadge current={c[0]} previous={c[1]} minCount={minCount} />
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export default function HomePage({ overview, overviewError, onRetryOverview, refreshKey }) {
  const [series, setSeries] = useState(null)
  const [seriesError, setSeriesError] = useState(null)
  const [seriesTry, setSeriesTry] = useState(0) // "다시 시도"를 누르면 올려서 다시 받는다
  const [showAllMovers, setShowAllMovers] = useState(false)
  const [showFieldTable, setShowFieldTable] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/trends/series?years=5&unit=year')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(httpMessage(r.status)))))
      .then((body) => { if (!cancelled) { setSeries(body); setSeriesError(null) } })
      .catch((e) => { if (!cancelled) setSeriesError(e.message === 'Failed to fetch' ? '서버에 연결할 수 없어요.' : e.message) })
    return () => { cancelled = true }
  }, [refreshKey, seriesTry])

  const retrySeries = () => { setSeriesError(null); setSeriesTry((n) => n + 1) }
  // 공개 동향(overview)은 앱 전체가 받는다. 실패하면 App의 오류 문구를 그대로 보여 준다
  const overviewFail = !overview && overviewError
    ? <LoadFail what="최근 공개 동향" message={overviewError.replace(/^트렌드를 불러오지 못했습니다: /, '')} onRetry={onRetryOverview} />
    : null
  const seriesFail = !series && seriesError ? <LoadFail what="연간 출원 추이" message={seriesError} onRetry={retrySeries} /> : null
  const loading = <p className="placeholder-text">불러오는 중…</p>

  const windows = overview?.windows ?? []
  const [latest, prev, prev2] = windows
  const fields = overview?.fields ?? []
  const minCount = overview?.minCount ?? 0
  const movers = overview?.movers
  const unclassifiedTotal = overview ? SERIES.reduce((s, c) => s + (overview.unclassified[c.key]?.[0] ?? 0), 0) : 0
  const totalOf = (w) => (w ? SERIES.reduce((s, c) => s + (w[c.key] ?? 0), 0) : 0)

  // KPI 카드: 공개일 기준 최근 12개월, 1년 전과 비교. 작은 선은 2년 전 → 1년 전 → 최근 12개월
  const kpis = latest ? [
    { key: 'all', label: '최근 12개월 전체 공개', icon: 'docs', tone: 'all', value: totalOf(latest), prev: totalOf(prev), trail: [totalOf(prev2), totalOf(prev), totalOf(latest)] },
    ...SERIES.map((s) => ({ key: s.key, label: s.name, icon: s.icon, tone: s.tag, value: latest[s.key], prev: prev?.[s.key], trail: [prev2?.[s.key] ?? 0, prev?.[s.key] ?? 0, latest[s.key]] })),
  ] : []

  // 연간 출원 추이: 회사별로 분야를 합친 출원 건수 (출원일 기준)
  const complete = series ? series.periods.map((p, i) => ({ ...p, i })).filter((p) => !p.incomplete) : []
  const lines = series ? SERIES.map((s) => ({
    key: s.key, label: s.label, tone: s.tag,
    values: series.periods.map((_, i) => sumGroups(series.series[s.key], i)),
  })) : []
  const lastDone = complete.at(-1)
  const beforeDone = complete.at(-2)
  const doneTotal = (p) => (p ? lines.reduce((s, l) => s + l.values[p.i], 0) : 0)

  // 기술 분야별 비중: 공개가 끝난 연도의 1차 분류 누적 (세 회사 합계)
  const slices = series ? series.groups.map((g, gi) => ({
    label: g, color: `var(--series-${gi + 1})`,
    value: complete.reduce((s, p) => s + SERIES.reduce((t, c) => t + series.series[c.key][g][p.i], 0), 0),
  })).sort((a, b) => b.value - a.value) : []
  const sliceTotal = slices.reduce((s, x) => s + x.value, 0)
  const oledShare = sliceTotal ? Math.round(((slices.find((s) => s.label === 'OLED')?.value ?? 0) / sliceTotal) * 1000) / 10 : 0

  // 최근 주요 이슈: 많이 늘어난 세부 기술 (자사·삼성·중국 4사 합쳐 증가율 순)
  const allMovers = movers ? SERIES.flatMap((s) => (movers[s.key] ?? []).map((m) => ({ ...m, company: s }))).sort((a, b) => b.change - a.change) : []
  const shownMovers = showAllMovers ? allMovers : allMovers.slice(0, 3)

  return (
    <div className="page-body dashboard">
      <header className="page-head">
        <div>
          <h1 className="page-title">
            특허 현황 대시보드
            {overview?.lastSyncedAt && <span className="live-badge">최신 데이터</span>}
          </h1>
          <p className="page-desc">LG디스플레이와 주요 경쟁사(삼성디스플레이·중국 4사)의 특허 동향을 한눈에 확인하세요.</p>
        </div>
        <a className="head-btn" href="#/patents"><Icon name="docs" />특허 목록 보기</a>
      </header>

      <section className="kpi-grid" aria-label="최근 12개월 공개 건수">
        {kpis.map((k) => (
          <article key={k.key} className="kpi-card">
            <div className="kpi-top">
              <span className="kpi-label">{k.label}</span>
              <span className={`kpi-icon tone-${k.tone}`}><Icon name={k.icon} /></span>
            </div>
            <div className="kpi-value">
              <strong>{formatCount(k.value)}</strong><span>건</span>
              <Delta value={pctChange(k.value, k.prev)} />
            </div>
            <div className="kpi-bottom">
              <span className="kpi-sub">1년 전 {formatCount(k.prev ?? 0)}건</span>
              <Sparkline values={k.trail} tone={k.tone} />
            </div>
          </article>
        ))}
        {!latest && (overviewFail ?? loading)}
      </section>
      {latest && <p className="footnote kpi-note">공개일 기준 {formatRange(latest)} · 증감은 바로 앞 12개월({formatRange(prev)})과 비교 · 작은 선은 2년 전 → 최근</p>}

      <div className="dash-row">
        <section className="dash-card" aria-labelledby="yearly-title">
          <div className="dash-card-head">
            <div>
              <h2 id="yearly-title" className="dash-title">연간 특허 출원 추이</h2>
              <p className="dash-sub">최근 5년간 기업별 출원 건수 (출원일 기준, 분류된 특허)</p>
            </div>
            <ul className="dash-legend">
              {lines.map((l) => <li key={l.key}><i className={`dot tone-${l.tone}`} />{l.label}</li>)}
            </ul>
          </div>
          {series ? <DashLineChart periods={series.periods} lines={lines} /> : (seriesFail ?? <p className="placeholder-text">그래프를 불러오는 중…</p>)}
          {lastDone && beforeDone && (
            <p className="dash-foot">
              <Icon name="trend" />
              {lastDone.label} 세 회사 합산 {formatCount(doneTotal(lastDone))}건 출원 · 전년 대비 <b>{signed(pctChange(doneTotal(lastDone), doneTotal(beforeDone)))}</b>
              <a href="#/field">자세히 보기</a>
            </p>
          )}
        </section>

        <section className="dash-card" aria-labelledby="share-title">
          <div className="dash-card-head">
            <div>
              <h2 id="share-title" className="dash-title">기술 분야별 출원 비중</h2>
              <p className="dash-sub">1차 기술 분류별 누적 ({complete[0]?.label}~{lastDone?.label}, 세 회사 합계)</p>
            </div>
          </div>
          {series ? (
            <div className="donut-wrap">
              <Donut slices={slices} total={sliceTotal} />
              <ul className="donut-legend">
                {slices.map((s) => (
                  <li key={s.label}>
                    <i className="dot" style={{ background: s.color }} />
                    <span>
                      <a href={`#/field?level1=${encodeURIComponent(s.label)}`}>{s.label}</a>
                      <small>{formatCount(s.value)}건</small>
                    </span>
                    <b>{sliceTotal ? (Math.round((s.value / sliceTotal) * 1000) / 10).toFixed(1) : 0}%</b>
                  </li>
                ))}
              </ul>
            </div>
          ) : (seriesFail ?? loading)}
          {sliceTotal > 0 && <p className="dash-note">OLED가 전체 출원의 <b>{oledShare}%</b>를 차지합니다.</p>}
        </section>
      </div>

      <div className="dash-row">
        <section className="dash-card" aria-labelledby="issues-title">
          <div className="dash-card-head">
            <h2 id="issues-title" className="dash-title">
              많이 늘어난 세부 기술 {allMovers.length > 0 && <span className="new-count">{allMovers.length}</span>}
            </h2>
          </div>
          <p className="dash-sub">최근 12개월과 1년 전 비교 · 1년 전 {minCount}건 이상인 기술만</p>
          {!overview && (overviewFail ?? loading)}
          {overview && allMovers.length === 0 && <p className="placeholder-text">최근 12개월에 눈에 띄게 늘어난 세부 기술이 없어요.</p>}
          <ul className="issue-list">
            {shownMovers.map((m) => (
              <li key={`${m.company.key}${m.level2}${m.level3}`}>
                <a href={fieldLink(m.level2, m.level3)}>
                  <span>
                    <b><span className={`type-tag ${m.company.tag}`}>{m.company.label}</span> {m.level3} 출원 {signed(m.change)}</b>
                    <small>{m.level2} · 1년 전 {m.counts[1]}건 → 최근 {m.counts[0]}건</small>
                  </span>
                  <Icon name="arrowRight" />
                </a>
              </li>
            ))}
          </ul>
          {allMovers.length > 3 && (
            <button className="more-link" onClick={() => setShowAllMovers((s) => !s)} aria-expanded={showAllMovers}>
              {showAllMovers ? '접기' : `전체 ${allMovers.length}개 보기`}
            </button>
          )}
        </section>

        <section className="dash-card dash-card-tint" aria-labelledby="insight-title">
          <div className="dash-card-head">
            <h2 id="insight-title" className="dash-title">기술 분야별 AI 인사이트</h2>
          </div>
          <p className="dash-sub">분야를 누르면 자사·경쟁사를 비교한 AI 동향 요약으로 이동해요.</p>
          {!overview && (overviewFail ?? loading)}
          <div className="insight-grid">
            {fields.map((f) => (
              <a key={f.level2} className="insight-item" href={`#/summary?level2=${encodeURIComponent(f.level2)}`}>
                <span className="insight-icon"><Icon name={FIELD_ICONS[f.level2] ?? 'grid'} /></span>
                <span>{f.level2}</span>
              </a>
            ))}
          </div>
        </section>
      </div>

      {fields.length > 0 && (
        <section className="dash-card card-gap" aria-labelledby="fields-title">
          <h2 id="fields-title" className="dash-title">최근 공개 동향 (기술 분야별)</h2>
          <p className="dash-sub">최근 12개월 공개 건수 · 공개일 기준 {latest && formatRange(latest)} · 증감은 1년 전과 비교 · 막대는 2년 전 → 1년 전 → 최근 12개월</p>
          <div className="company-panels">
            {SERIES.map((s) => <CompanyPanel key={s.key} series={s} fields={fields} minCount={minCount} />)}
          </div>
          <button type="button" className="more-link table-toggle" aria-expanded={showFieldTable} onClick={() => setShowFieldTable((v) => !v)}>
            {showFieldTable ? '숫자 표 접기' : '전체 숫자 표 보기'}
          </button>
          {showFieldTable && <div className="table-wrap">
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
          </div>}
          <p className="footnote">
            최근 12개월 공개 {formatCount(totalOf(latest))}건 중 미분류 {formatCount(unclassifiedTotal)}건은 빠져 있어요.
            분류는 규칙 기반 자동 분류(무작위 검증 정확도 약 85%)이고, 공개된 특허는 대체로 1년 반쯤 전에 출원한 기술이에요.
            1년 전 건수가 {minCount}건 미만이면 증감을 표시하지 않아요. 중국 4사는 한국에 낸 출원만 집계해요.
          </p>
        </section>
      )}

      <p className="dash-stamp">KIPRIS 공개 데이터 · {overview?.lastSyncedAt ? `${new Date(overview.lastSyncedAt).toLocaleDateString('ko-KR')} 갱신 기준` : ''}</p>
    </div>
  )
}
