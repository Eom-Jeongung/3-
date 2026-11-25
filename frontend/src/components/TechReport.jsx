import { Fragment, useEffect, useState } from 'react'
import { formatAppNo } from '../format.js'

// AI 기술 분석 보고서 본문 (backend/src/techReport.js가 만든 JSON을 그린다)
// 순서(팀장님 보고서 기초 형식): 핵심 결론 → 정량 스냅샷 → 시기별 기술 발전 방향 → 경쟁사 비교 → 근거 특허 기술 분석 → 시사점 → 자동 검증
// 숫자(지표·차트·차트 제목)는 DB 값, 문장은 AI. [n]을 누르면 근거 특허 표의 그 줄로, 출원번호를 누르면 특허 상세가 열린다
// 처음 만든 형식(version 1)에는 기술 주제·목적·요약 문장이 없어 그 칸은 비워 둔다

const COMPANY_SHORT = { own: '자사', competitor: '삼성', china: '중국 4사' }

// 근거 특허 표는 처음에 이만큼만 보이고 나머지는 '더보기'로 연다 (2026-11-26: 표가 너무 길다는 의견)
const PATENTS_SHOWN = 3
const SHOW_ALL_EVENT = 'tech-patents-show-all'

const goToPatent = (no) => {
  const row = document.getElementById(`tech-patent-${no}`)
  if (!row) return
  // 접혀 있는 줄이면 표를 먼저 펼친 뒤 그 줄로 간다
  if (row.hidden) {
    window.dispatchEvent(new Event(SHOW_ALL_EVENT))
    requestAnimationFrame(() => goToPatent(no))
    return
  }
  row.scrollIntoView({ behavior: 'smooth', block: 'center' })
  row.classList.remove('flash')
  void row.offsetWidth // 같은 줄을 다시 눌러도 깜빡이게
  row.classList.add('flash')
}

function Refs({ refs }) {
  if (!refs?.length) return null
  return (
    <span className="tech-refs">
      {refs.map((n) => <button key={n} type="button" className="tech-ref" onClick={() => goToPatent(n)} title={`근거 특허 [${n}] 보기`}>[{n}]</button>)}
    </span>
  )
}

// 자동 검증에 걸린 문장 옆 표시. 이유는 마우스를 올리거나 아래 '자동 검증' 칸에서 볼 수 있다
function Caution({ reason }) {
  if (!reason) return null
  return <span className="flag-badge flag-caution" title={reason}>주의</span>
}

// "(추정)"이 붙은 목적은 원문이 아니라 일반 기술 지식으로 추정한 것이라 표시를 따로 한다
function Purpose({ text }) {
  if (!text) return null
  const inferred = text.includes('(추정)')
  return (
    <span className={inferred ? 'tech-purpose inferred' : 'tech-purpose'}>
      {inferred && <span className="tech-inferred" title="원문에 없어 일반 기술 지식으로 추정한 목적이에요">추정</span>}
      목적: {text.replace('(추정)', '').trim()}
    </span>
  )
}

function SectionHead({ title, lead, caution }) {
  return (
    <>
      <h4>{title}</h4>
      {lead && <p className="tech-lead">{lead} <Caution reason={caution} /></p>}
    </>
  )
}

function YearlyBars({ yearly }) {
  const max = Math.max(1, ...Object.values(yearly.series).flat())
  return (
    <figure className="tech-chart">
      <figcaption>{yearly.title || '연도별 출원 건수'}</figcaption>
      <div className="tech-bars" role="img" aria-label="회사별 연도별 출원 건수 막대 그래프">
        {yearly.years.map((year, i) => (
          <div key={year} className="tech-bar-group">
            <div className="tech-bar-stack">
              {Object.entries(yearly.series).map(([c, counts]) => (
                <div key={c} className={`tech-bar tone-bg-${c}`} style={{ height: `${(counts[i] / max) * 100}%` }} title={`${COMPANY_SHORT[c]} ${year}년 ${counts[i].toLocaleString()}건`}>
                  <span>{counts[i].toLocaleString()}</span>
                </div>
              ))}
            </div>
            <span className="tech-bar-year">{year}{yearly.incomplete?.includes(year) ? '*' : ''}</span>
          </div>
        ))}
      </div>
      <div className="tech-legend">
        {Object.keys(yearly.series).map((c) => <span key={c}><i className={`dot tone-${c}`} />{COMPANY_SHORT[c]}</span>)}
      </div>
    </figure>
  )
}

function Distribution({ distribution }) {
  return (
    <figure className="tech-chart">
      <figcaption>{distribution.title || `${distribution.year}년 분야 분포 (회사별 100%)`}</figcaption>
      <div className="tech-dist">
        {distribution.rows.map((r) => (
          <div key={r.company} className="tech-dist-row">
            <span className="tech-dist-name">{COMPANY_SHORT[r.company]}</span>
            <div className="tech-dist-bar">
              {r.items.map((it, i) => (
                <div
                  key={it.label}
                  className={`tech-dist-seg tone-bg-${r.company}`}
                  style={{ width: `${it.share}%`, opacity: it.label === '그 외' ? 0.25 : 1 - i * 0.15 }}
                  title={`${it.label} ${it.count.toLocaleString()}건 (${it.share}%)`}
                >
                  {it.share >= 12 && <span>{it.label}</span>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="table-meta">막대에 마우스를 올리면 분야 이름과 건수가 보여요.</p>
    </figure>
  )
}

export default function TechReport({ report, checks, onOpenPatent }) {
  const warnings = checks?.warnings ?? []
  const byNo = new Map(report.patents.map((p) => [p.no, p]))
  const inferredCount = report.patents.filter((p) => p.purpose?.includes('(추정)')).length
  const [showAllPatents, setShowAllPatents] = useState(false)
  useEffect(() => {
    const open = () => setShowAllPatents(true)
    window.addEventListener(SHOW_ALL_EVENT, open)
    return () => window.removeEventListener(SHOW_ALL_EVENT, open)
  }, [])
  const hiddenPatents = Math.max(0, report.patents.length - PATENTS_SHOWN)
  return (
    <article className="tech-report">
      <header className="tech-head">
        <p className="tech-eyebrow">기술 분석 보고서 · {report.scopeLabel}</p>
        <h3 className="tech-headline">{report.headline || '핵심 결론을 만들지 못했어요'} <Caution reason={report.headlineCaution} /></h3>
        <p className="table-meta">
          분석 대상 자사·삼성디스플레이·중국 4사 · {report.from}~{report.to}년 출원 · 근거 특허 {report.patents.length}건
          {' · '}
          <a href="#tech-checks" className={warnings.length ? 'warn-text' : undefined}>자동 검증: {warnings.length ? `주의 ${warnings.length}건` : '주의 없음'}</a>
        </p>
      </header>

      <section className="tech-section">
        <SectionHead title={report.quantTitle ? `정량 스냅샷: ${report.quantTitle}` : '정량 스냅샷'} />
        <div className="tech-kpis">
          {report.kpis.map((k) => (
            <div key={k.key} className="tech-kpi">
              <span className="kpi-label"><i className={`dot tone-${k.tone}`} aria-hidden="true" />{k.label}</span>
              <strong>{k.value}</strong>
              <span className="kpi-sub">{k.detail}</span>
            </div>
          ))}
        </div>
        <div className="tech-charts">
          <YearlyBars yearly={report.charts.yearly} />
          {report.charts.distribution && <Distribution distribution={report.charts.distribution} />}
        </div>
        {report.charts.yearly.incomplete?.length > 0 && <p className="table-meta">* 공개가 덜 된 연도라 건수가 적게 보일 수 있어요.</p>}
      </section>

      <section className="tech-section">
        <SectionHead
          title={report.flowSummary ? `시기별 기술 발전 방향: ${report.flowSummary}` : '시기별 기술 발전 방향'}
          lead="시기마다 기술의 무게중심이 어떻게 이동했는지 비교해요. 문장 끝 번호를 누르면 아래 근거 특허로 이동해요."
          caution={report.flowSummaryCaution}
        />
        <ol className="tech-timeline" style={{ '--cols': report.periods.length }}>
          {report.periods.map((p, i) => (
            <li key={p.label} className={`tech-period ${i === report.periods.length - 1 ? 'latest' : ''}`}>
              <div className="tech-period-top">
                <span className="tech-period-label">{p.label}</span>
                <span className="tech-stage">{p.stage}</span>
              </div>
              <b className="tech-period-title">{p.title} <Caution reason={p.titleCaution} /></b>
              <ul>
                {p.points.map((pt, j) => (
                  <li key={j}>{pt.text} <Refs refs={pt.refs} /> <Caution reason={pt.caution} /></li>
                ))}
              </ul>
              {p.keywords.length > 0 && <p className="tech-keywords"><b>핵심 키워드:</b> {p.keywords.join(', ')} <Caution reason={p.keywordsCaution} /></p>}
            </li>
          ))}
        </ol>
      </section>

      <section className="tech-section">
        <SectionHead title="경쟁사별 기술 집중도와 차별점 비교" lead={report.competitorLead} caution={report.competitorLeadCaution} />
        <div className="tech-table-wrap">
          <table className="tech-table">
            <thead><tr><th>기업</th><th>집중 기술 분야</th><th>핵심 키워드</th><th>주요 기술 개선 방향 (무엇이 다른가)</th><th>근거</th></tr></thead>
            <tbody>
              {report.competitors.map((c) => (
                <tr key={c.company}>
                  <td className="tech-company"><i className={`dot tone-${c.company}`} /> <b title={c.companyLabel}>{COMPANY_SHORT[c.company]}</b></td>
                  <td>{c.focus}</td>
                  <td>{c.keywords.join(', ')}</td>
                  <td>{c.direction} <Caution reason={c.caution} /></td>
                  <td><Refs refs={c.refs} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="tech-section">
        <SectionHead
          title="주요 근거 특허 기술 분석: 해결 문제와 기존 대비 개선점"
          lead={`시기·회사마다 급증한 기술 용어가 나온 특허와 늘어난 분야의 특허를 골랐어요. 초록이 짧은 특허는 대표 청구항까지 읽혔어요.${inferredCount ? ` '추정' 표시는 원문에 목적이 없어 일반 기술 지식으로 추정한 내용이에요(${inferredCount}건).` : ''}`}
        />
        <div className="tech-table-wrap">
          <table className="tech-table tech-patents">
            <thead><tr><th>번호</th><th>출원인 · 기술 주제</th><th>해결하려는 기술적 문제</th><th>기존 기술 대비 차이점</th><th>핵심 개선 사항</th></tr></thead>
            <tbody>
              {/* 접힌 줄도 그려 둔다: [n] 링크가 줄을 찾아 표를 펼칠 수 있게 */}
              {report.patents.map((p, i) => (
                <tr key={p.no} id={`tech-patent-${p.no}`} hidden={!showAllPatents && i >= PATENTS_SHOWN}>
                  <td className="tech-no">[{p.no}]</td>
                  <td>
                    <b><i className={`dot tone-${p.company}`} /> {COMPANY_SHORT[p.company]}</b> <span className="muted">{p.period}</span>
                    {p.theme && <><br /><span className="tech-theme">{p.theme}</span></>}
                    <br /><button type="button" className="appno-link" onClick={() => onOpenPatent(p.id)} title={p.title}>{formatAppNo(p.number)}</button>
                    <br /><span className="muted">{p.source}{p.reason ? ` · ${p.reason}` : ''}</span>
                  </td>
                  <td>{p.problem}{p.purpose && <><br /><Purpose text={p.purpose} /></>}</td>
                  <td className={/명시되지 않음/.test(p.baseline) ? 'muted' : undefined}>{p.baseline}</td>
                  <td>{p.improvement} <Caution reason={p.caution} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {hiddenPatents > 0 && (
          <div className="more-area">
            <div className="more-buttons">
              {showAllPatents ? (
                <button className="more-btn more-btn-quiet" onClick={() => setShowAllPatents(false)} aria-expanded="true">
                  <span className="more-label">접기</span>
                  <span className="more-arrow">⌃</span>
                </button>
              ) : (
                <button className="more-btn" onClick={() => setShowAllPatents(true)} aria-expanded="false">
                  <span className="more-label">더보기</span>
                  <span className="more-arrow">⌄</span>
                </button>
              )}
            </div>
            <p className="more-hint">{showAllPatents ? `근거 특허 ${report.patents.length}건을 모두 표시했어요` : `${PATENTS_SHOWN}건 표시 · 남은 ${hiddenPatents}건`}</p>
          </div>
        )}
      </section>

      {report.takeaways.length > 0 && (
        <section className="tech-section">
          <SectionHead title="시사점" />
          <ul>{report.takeaways.map((t, i) => <li key={i}>{t.text} <Caution reason={t.caution} /></li>)}</ul>
        </section>
      )}

      <section className="tech-section tech-checks" id="tech-checks">
        <h4>자동 검증 및 신뢰도 안내</h4>
        {warnings.length === 0
          ? <p>규칙 기반 자동 검증에서 주의할 문장을 찾지 못했어요. 모든 내용의 정확성을 보장하지는 않으니 근거 특허를 확인해 주세요.</p>
          : (
            <>
              <p>아래 {warnings.length}곳은 자동 검증에 걸렸어요. 본문의 <span className="flag-badge flag-caution">주의</span> 표시에 마우스를 올려도 이유가 보여요.</p>
              <ul className="check-items">
                {warnings.map((w, i) => {
                  const no = Number(w.where.match(/\[(\d+)\]/)?.[1])
                  return (
                    <li key={i}>
                      <b>{w.where}</b>: {w.reason}
                      {byNo.has(no) && <Fragment> <button type="button" className="more-link" onClick={() => goToPatent(no)}>보기</button></Fragment>}
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        <ul className="tech-notes">
          {report.notes.map((n, i) => <li key={i}>{n}</li>)}
          <li>숫자(지표·차트·차트 제목)는 DB에서 계산한 값이고, 문장은 AI가 근거 특허의 명칭·초록·청구항을 보고 쓴 초안이에요.</li>
          <li>분류는 규칙 기반 자동 분류이며, 근거 특허는 시기·회사마다 몇 건씩만 고른 표본이에요.</li>
          <li>모델: 특허 분석 {report.models?.patents || '-'} · 흐름·비교·결론 {report.models?.insight || '-'}</li>
        </ul>
      </section>
    </article>
  )
}
