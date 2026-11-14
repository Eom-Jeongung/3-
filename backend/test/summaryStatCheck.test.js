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
  assert.ok(checkStatistics(`자사 ${field} 2020년 100 → 2022년 150건`, stats).statUnverified.length);
});
