// 분기 자동 요약: 분기마다 한 번, 정해 둔 분야들의 AI 동향 요약을 새로 만든다
// - 범위: 전체 + 방식(1차) 전부 + 기술 분야(2차) 전부 ("미분류" 제외). 지금 기준 13개 안팎
// - 기간: 공개가 끝난 마지막 연도까지 최근 3개 연도 (화면 기본값과 같다)
// - 한 번에 하나씩 만들고, 무료 모델이 바쁘면(429·시간 초과) 잠깐 쉬었다가 다시 시도한다
// - 중간에 멈추거나 실패한 범위는 다음 확인 때 이어서 만든다 (이번 분기에 이미 만든 범위는 건너뛴다)
// - 서버 스케줄러(scheduler.js)가 한 시간마다 확인하고, 명령으로도 돌릴 수 있다 (npm run auto-summary)
import { db } from './db.js';
import { generateTrendSummary, lastCompleteYear, scopeLabel } from './trendSummary.js';
import { CRITERIA_VERSION } from './classification.js';

const HIDDEN = '미분류';
const RETRIES = 2; // 범위마다 처음 시도 + 2번 더
const WAIT_MS = { busy: 90_000, between: 20_000 }; // 무료 모델 공용 한도를 피하려고 사이사이 쉰다

/** 한국 시간 기준 분기 (예: 2026-Q4)와 그 분기 시작 시각(UTC, SQLite datetime 형식) */
export function currentQuarter(now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 3600_000);
  const y = kst.getUTCFullYear();
  const q = Math.floor(kst.getUTCMonth() / 3) + 1;
  const startKst = Date.UTC(y, (q - 1) * 3, 1) - 9 * 3600_000;
  return { key: `${y}-Q${q}`, label: `${y}년 ${q}분기`, startUtc: new Date(startKst).toISOString().slice(0, 19).replace('T', ' ') };
}

/** 자동으로 만들 범위: 전체 → 1차 → 2차 (건수 많은 순) */
export function autoScopes() {
  const rows = db.prepare(`
    SELECT level1, level2, COUNT(*) n FROM classification
    WHERE is_primary = 1 AND criteria_version = ? GROUP BY 1, 2
  `).all(CRITERIA_VERSION);
  const sum = (key) => {
    const m = new Map();
    for (const r of rows) if (r[key] && r[key] !== HIDDEN) m.set(r[key], (m.get(r[key]) ?? 0) + r.n);
    return [...m].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  };
  return [
    { level1: '', level2: '', level3: '' },
    ...sum('level1').map((level1) => ({ level1, level2: '', level3: '' })),
    ...sum('level2').map((level2) => ({ level1: '', level2, level3: '' })),
  ];
}

const madeThisQuarter = db.prepare(`
  SELECT 1 FROM trend_summaries
  WHERE level1 = @level1 AND level2 = @level2 AND level3 = @level3 AND period_from = @from AND period_to = @to
    AND criteria_version = @version AND created_at >= @since
  LIMIT 1
`);

/** 이번 분기에 아직 요약이 없는 범위 */
export function pendingScopes(quarter = currentQuarter()) {
  const to = lastCompleteYear();
  const from = to - 2;
  return autoScopes()
    .map((s) => ({ ...s, from, to }))
    .filter((s) => !madeThisQuarter.get({ ...s, version: CRITERIA_VERSION, since: quarter.startUtc }));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isBusy = (err) => /HTTP 429|HTTP 5\d\d|timeout|aborted/i.test(err.message);

let running = false;
export const isAutoSummaryRunning = () => running;

/**
 * 이번 분기에 빠진 범위의 요약을 만든다
 * @returns {Promise<{ quarter: string, total: number, made: number, failed: string[] }>}
 */
export async function runQuarterlySummaries({ log = console.log, waits = WAIT_MS } = {}) {
  if (running) throw new Error('이미 자동 요약을 만드는 중이에요');
  running = true;
  const quarter = currentQuarter();
  let runId = null;
  let made = 0;
  const failed = [];
  try {
    const todo = pendingScopes(quarter);
    const total = autoScopes().length;
    runId = db.prepare('INSERT INTO summary_runs (quarter, total) VALUES (?, ?)').run(quarter.key, total).lastInsertRowid;
    log(`[자동 요약] ${quarter.label}: ${total}개 중 ${todo.length}개를 만듭니다 (${todo[0]?.from ?? '-'}~${todo[0]?.to ?? '-'}년 출원)`);
    for (const [i, scope] of todo.entries()) {
      const name = scopeLabel(scope);
      for (let attempt = 0; ; attempt++) {
        try {
          const s = await generateTrendSummary(scope, { source: 'auto' });
          made++;
          const warn = Object.values(s.checks).some((v) => v.length) ? ' (자동 검사에서 확인할 부분 있음)' : '';
          log(`[자동 요약] ${i + 1}/${todo.length} ${name} 완료 #${s.id}, ${(s.elapsed_ms / 1000).toFixed(0)}초${warn}`);
          break;
        } catch (err) {
          if (attempt < RETRIES && isBusy(err)) {
            log(`[자동 요약] ${name}: ${err.message} → ${waits.busy / 1000}초 쉬고 다시 (${attempt + 1}/${RETRIES})`);
            await sleep(waits.busy);
            continue;
          }
          failed.push(`${name}: ${err.message}`);
          log(`[자동 요약] ${name} 실패: ${err.message} (다음 확인 때 다시 만들어요)`);
          break;
        }
      }
      if (i < todo.length - 1) await sleep(waits.between);
    }
    return { quarter: quarter.key, total, made, failed };
  } finally {
    if (runId) {
      db.prepare(`UPDATE summary_runs SET finished_at = datetime('now'), made = ?, failed = ?, note = ? WHERE id = ?`)
        .run(made, failed.length, failed.join('\n') || null, runId);
    }
    running = false;
  }
}
