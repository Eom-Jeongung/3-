import test from 'node:test';
import assert from 'node:assert/strict';
import { checkStatistics } from '../src/summaryStatCheck.js';

const field = '화소 배열·레이아웃';
const other = '터치·센서';
const values = [];
for (const [company, group, first, last, share] of [
  ['own', field, 100, 150, 60], ['competitor', field, 80, 120, 40],
  ['own', other, 100, 80, 32], ['competitor', other, 50, 100, 60],
]) {
  values.push({ company, field: group, year: 2020, metric: 'count', value: first });
  values.push({ company, field: group, year: 2022, metric: 'count', value: last });
  values.push({ company, field: group, year: 2022, metric: 'share', value: share });
  values.push({ company, field: group, year: 2022, metric: 'change', value: Math.round((last - first) / first * 100) });
}
const stats = { from: 2020, to: 2022, fields: [field, other], values };

test('회사·분야·연도·지표가 맞는 수치를 확인한다', () => {
  const result = checkStatistics(`자사 ${field} 2020년 100건, 2022년 150건 (50% 증가)\n자사 ${field} 2022년 비중 60%`, stats);
  assert.deepEqual(result, { statMismatches: [], statUnverified: [] });
});

test('다른 회사나 분야의 건수·비중 및 증감률을 잘못 연결하면 경고한다', () => {
  const result = checkStatistics(`자사 ${field} 2022년 120건\n삼성 ${field} 2022년 비중 60%\n자사 ${other} 2020년 대비 2022년 50% 증가`, stats);
  assert.equal(result.statMismatches.length, 3);
  assert.deepEqual(result.statUnverified, []);
});

test('연도와 감소 방향을 확인한다', () => {
  const ok = checkStatistics(`자사 ${other} 2020년 대비 2022년 20% 감소`, stats);
  assert.deepEqual(ok.statMismatches, []);
  const wrong = checkStatistics(`자사 ${other} 2020년 대비 2022년 20% 증가`, stats);
  assert.equal(wrong.statMismatches.length, 1);
  assert.equal(checkStatistics(`자사 ${field} 2021년 150건`, stats).statUnverified.length, 1);
});

test('회사·분야·연도나 지표가 모호하면 검증 불가로 표시한다', () => {
  for (const text of [`${field} 2022년 150건`, `자사 2022년 150건`, `자사 ${field} 150건`, `자사 ${field} 2022년 60%`, `자사와 삼성 ${field} 2022년 150건`]) {
    assert.ok(checkStatistics(text, stats).statUnverified.length, text);
  }
  assert.ok(checkStatistics(`자사 ${field} 2022년 50% 증가`, stats).statUnverified.length);
});

// 2026-11-18: AI가 실제로 쓰는 비교 문장("첫해 → 마지막 해")도 숫자를 하나하나 대조한다
test('첫해 → 마지막 해 비교 문장을 대조한다', () => {
  assert.deepEqual(checkStatistics(`자사 ${field} 2020년 100 → 2022년 150건`, stats), { statMismatches: [], statUnverified: [] });
  assert.deepEqual(checkStatistics(`- 자사: ${field}(100→150, 50% 증가)와 ${other}(100→80, 20% 감소)`, stats), { statMismatches: [], statUnverified: [] });
  assert.equal(checkStatistics(`- 자사: ${field}(100→160, 50% 증가)`, stats).statMismatches.length, 1);
});

test('분야를 적지 않으면 고른 범위 전체 합계와 대조한다', () => {
  const total = '소자';
  const withTotal = {
    ...stats, totalField: total,
    values: [...values, { company: 'own', field: total, year: 2020, metric: 'count', value: 320 }, { company: 'own', field: total, year: 2022, metric: 'count', value: 420 },
      { company: 'own', field: total, year: 2022, metric: 'change', value: 31 }],
  };
  assert.deepEqual(checkStatistics(`- ${total} 분야에서 자사 출원이 2020년 320건→2022년 420건(31% 증가)`, withTotal), { statMismatches: [], statUnverified: [] });
  assert.equal(checkStatistics('- 자사 2020년 300건 → 2022년 420건', withTotal).statMismatches.length, 1);
});

test('"증가율"이라고 쓴 줄의 %는 첫해 대비 마지막 해 증감률로 대조한다', () => {
  assert.deepEqual(checkStatistics(`- 삼성: ${field} 증가율(50%)이 자사(50%)와 같다`, stats), { statMismatches: [], statUnverified: [] });
  assert.deepEqual(checkStatistics(`- 삼성: ${other} 증가율 100%`, stats), { statMismatches: [], statUnverified: [] });
  assert.equal(checkStatistics(`- 삼성: ${field} 증가율(70%)`, stats).statMismatches.length, 1);
});

test('앞 문장에서 회사를 이어받은 숫자가 다르면 틀렸다고 하지 않고 확인 필요로 둔다', () => {
  // 실제 AI 문장 모양: 봉지(-20%)는 삼성 이야기인데 바로 앞에 나온 회사는 자사
  const r = checkStatistics(`- 삼성: ${field} 증가율(50%)이 자사(50%)와 같고, ${other}(100%)는 늘었다`, stats);
  assert.deepEqual(r.statMismatches, []);
  assert.equal(r.statUnverified.length, 1);
});

test('연도를 하나도 적지 않은 증감률은 첫해 대비 마지막 해 값으로 대조한다', () => {
  assert.deepEqual(checkStatistics(`- 자사 ${field} 출원이 50% 증가한 반면 삼성 ${other}는 100% 증가`, stats), { statMismatches: [], statUnverified: [] });
  assert.equal(checkStatistics(`- 자사 ${field} 출원이 30% 증가`, stats).statMismatches.length, 1);
});

test('기준 숫자(30건 미만)와 중국 4사는 대조 대상이 아니다', () => {
  assert.deepEqual(checkStatistics('- 중국 4사는 연간 30건 미만이라 추세를 단정하지 않는다', stats), { statMismatches: [], statUnverified: [] });
});
