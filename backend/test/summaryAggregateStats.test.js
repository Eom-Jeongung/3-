import test from 'node:test';
import assert from 'node:assert/strict';
import { withAggregateStatistics } from '../src/summaryAggregateStats.js';
import { checkStatistics, verifiedStatisticSubject } from '../src/summaryStatCheck.js';

const field = '구동 회로';
const totalField = '회로';
const values = [
  ['own', field, 20, 40], ['competitor', field, 60, 100], ['china', field, 0, 0],
  ['own', totalField, 60, 100], ['competitor', totalField, 100, 150], ['china', totalField, 40, 50],
].flatMap(([company, field, first, last]) => [
  { company, field, year: 2022, metric: 'count', value: first },
  { company, field, year: 2024, metric: 'count', value: last },
]);
const stats = { from: 2022, to: 2024, fields: [field], totalField, minimumSample: 30, values };
const clean = { statMismatches: [], statUnverified: [] };

test('회사+전체와 전체+분야를 건수에서 계산하며 기존 회사+분야 비중을 보존한다', () => {
  const original = { ...stats, values: [...values,
    { company: 'competitor', field, year: 2024, metric: 'share', value: 67 }] };
  const enriched = withAggregateStatistics(original);
  const value = (company, field, metric) => enriched.values.find((row) =>
    row.company === company && row.field === field && row.metric === metric && row.year === 2024)?.value;
  assert.equal(value('competitor', totalField, 'share'), 50);
  assert.equal(value('competitor', totalField, 'change'), 50);
  assert.equal(value('all', field, 'count'), 140);
  assert.equal(value('all', field, 'share'), 47);
  assert.equal(value('all', field, 'change'), 75);
  assert.equal(value('competitor', field, 'share'), 67);
  assert.equal(original.values.length, values.length + 1);
  assert.deepEqual(withAggregateStatistics(enriched), enriched);
});

test('회사만 명시한 전체 비중과 회사가 생략된 분야 증감률을 대조한다', () => {
  const company = '삼성의 전체 비중은 2024년 50%다.';
  const fieldLine = `${field} 분야 2022년 대비 2024년 증감률은 75%다.`;
  assert.deepEqual(checkStatistics(company, stats), clean);
  assert.deepEqual(checkStatistics(fieldLine, stats), clean);
  assert.match(checkStatistics(company.replace('50%', '48%'), stats).statMismatches[0], /competitor.*share/);
  assert.match(checkStatistics(fieldLine.replace('75%', '74%'), stats).statMismatches[0], /all.*change/);
  assert.deepEqual(checkStatistics(`${field} 2024년 140건`, stats), clean);
  assert.deepEqual(checkStatistics(`${field} 2024년 비중 47%`, stats), clean);
  assert.equal(verifiedStatisticSubject(company, stats)?.company, 'competitor');
  assert.equal(verifiedStatisticSubject(fieldLine, stats)?.field, field);
  assert.equal(verifiedStatisticSubject(fieldLine.replace('75%', '74%'), stats), null);
});

test('누락된 회사의 집계를 0으로 취급하거나 비중을 단순 합산하지 않는다', () => {
  const missing = { ...stats, values: values.filter((row) => row.company !== 'china') };
  assert.ok(checkStatistics(`${field} 2024년 140건`, missing).statUnverified.length);
  assert.ok(checkStatistics('삼성 전체 2024년 비중 50%', missing).statUnverified.length);
  const zero = { ...stats, values: values.map((row) => ({ ...row, value: 0 })) };
  assert.ok(checkStatistics('삼성 전체 2024년 비중 0%', zero).statUnverified.length);
  assert.deepEqual(checkStatistics(`${field} 2024년 0건`, zero), clean);
});

test('소표본 전체 분야의 증감률은 산출하지 않고, 여러 회사의 혼합을 전체로 바꾸지 않는다', () => {
  const small = { ...stats, values: values.map((row) => ({ ...row, value: row.field === field ? 1 : row.value })) };
  assert.ok(checkStatistics(`${field} 2022년 대비 2024년 증감률 0%`, small).statUnverified.length);
  assert.ok(checkStatistics(`자사와 삼성 ${field} 2024년 140건`, stats).statUnverified.length);
  assert.ok(checkStatistics('2024년 비중 50%', stats).statUnverified.length);
});
