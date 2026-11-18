// 자동 갱신: 마지막으로 성공한 갱신(수동·자동 모두)에서 SYNC_INTERVAL_DAYS일이 지나면 새 특허를 받아온다
// - 기본 90일(분기). 담당자님 답변: 갱신 주기는 분기
// - 정해진 날짜에 맞추지 않고 "마지막 갱신으로부터 며칠"로 센다.
//   그래서 서버가 그날 꺼져 있었어도, 다시 켜지면 밀린 갱신을 바로 한다
// - 서버가 켜져 있는 동안 한 시간마다 확인한다 (확인은 DB 조회 한 번이라 부담 없음)
// - SYNC_INTERVAL_DAYS=0 이면 자동 갱신을 끈다
import { db } from './db.js';
import { runSync, isSyncRunning } from './sync.js';
import { isAiConfigured } from './ai.js';
import { currentQuarter, pendingScopes, runQuarterlySummaries, isAutoSummaryRunning } from './autoSummary.js';

const CHECK_EVERY_MS = 60 * 60 * 1000; // 1시간
const FIRST_CHECK_MS = 60 * 1000; // 서버가 켜지고 1분 뒤 첫 확인

const lastSuccess = db.prepare("SELECT MAX(run_at) at FROM sync_log WHERE status = 'success'");
const lastScheduledTry = db.prepare("SELECT MAX(run_at) at FROM sync_log WHERE source = 'scheduled'");

const daysSince = (sqliteUtc) => (Date.now() - new Date(`${sqliteUtc.replace(' ', 'T')}Z`).getTime()) / 86_400_000;

async function checkAndSync(intervalDays) {
  if (isSyncRunning()) return;
  const last = lastSuccess.get().at;
  // 전체 수집 직후처럼 갱신 기록이 하나도 없으면 지금을 기준으로 삼는다 (켜자마자 KIPRIS를 부르지 않게)
  if (!last) return;
  if (daysSince(last) < intervalDays) return;
  // 실패했을 때 한 시간마다 다시 부르지 않게, 마지막 자동 시도에서 하루는 쉰다
  const tried = lastScheduledTry.get().at;
  if (tried && daysSince(tried) < 1) return;

  console.log(`[자동 갱신] 마지막 갱신 후 ${Math.floor(daysSince(last))}일 지남 → 새 특허를 받아옵니다`);
  try {
    const r = await runSync({ source: 'scheduled' });
    console.log(`[자동 갱신] 끝: 받은 ${r.fetched}건, 새 특허 ${r.added}건, 바뀐 ${r.changed}건, KIPRIS 호출 ${r.calls}회`);
  } catch (err) {
    console.error(`[자동 갱신] 실패: ${err.message} (내일 다시 시도해요)`);
  }
}

// ---- 분기 자동 요약 (autoSummary.js) ----
// AUTO_SUMMARY=1 일 때만 켠다 (노트북과 서버가 같은 AI 키로 둘 다 만들면 무료 한도를 두 번 쓰므로 서버에서만 켠다)
// 분기가 바뀌면(1·4·7·10월) 한 번 만들고, 실패한 범위는 6시간 뒤 확인 때 이어서 만든다
const RETRY_AFTER_HOURS = 6;
const lastSummaryRun = db.prepare('SELECT MAX(started_at) at FROM summary_runs WHERE quarter = ?');

async function checkAndSummarize() {
  if (isAutoSummaryRunning() || isSyncRunning()) return;
  const quarter = currentQuarter();
  const last = lastSummaryRun.get(quarter.key).at;
  if (last && daysSince(last) * 24 < RETRY_AFTER_HOURS) return;
  if (!pendingScopes(quarter).length) return;
  try {
    const r = await runQuarterlySummaries();
    console.log(`[자동 요약] 끝: 새로 ${r.made}개, 실패 ${r.failed.length}개 (${r.quarter})`);
  } catch (err) {
    console.error(`[자동 요약] 실패: ${err.message}`);
  }
}

function startSummaryScheduler() {
  if (process.env.AUTO_SUMMARY !== '1') {
    console.log('[자동 요약] 꺼짐 (켜려면 .env에 AUTO_SUMMARY=1)');
    return;
  }
  if (!isAiConfigured()) {
    console.log('[자동 요약] AI 설정이 없어 켜지 않았어요');
    return;
  }
  console.log(`[자동 요약] 켜짐: 분기마다 (지금 ${currentQuarter().label})`);
  setTimeout(checkAndSummarize, FIRST_CHECK_MS * 3).unref(); // 자동 갱신 확인보다 조금 늦게
  setInterval(checkAndSummarize, CHECK_EVERY_MS).unref();
}

export function startScheduler() {
  startSummaryScheduler();
  const raw = process.env.SYNC_INTERVAL_DAYS;
  const intervalDays = raw === undefined || raw === '' ? 90 : Number(raw);
  if (!Number.isFinite(intervalDays) || intervalDays <= 0) {
    console.log('[자동 갱신] 꺼짐 (SYNC_INTERVAL_DAYS=0)');
    return;
  }
  if (!process.env.KIPRIS_API_KEY) {
    console.log('[자동 갱신] KIPRIS_API_KEY가 없어 켜지 않았어요');
    return;
  }
  console.log(`[자동 갱신] 켜짐: 마지막 갱신 후 ${intervalDays}일마다`);
  const tick = () => checkAndSync(intervalDays);
  setTimeout(tick, FIRST_CHECK_MS).unref();
  setInterval(tick, CHECK_EVERY_MS).unref();
}
