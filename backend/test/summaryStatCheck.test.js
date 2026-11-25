import test from 'node:test';
import assert from 'node:assert/strict';
import { checkStatistics, verifiedStatisticSubject } from '../src/summaryStatCheck.js';

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

test('화살표의 시작·끝 연도를 보존하여 역순 증감률과 모순된 기간을 승인하지 않는다', () => {
  const scoped = { from: 2023, to: 2024, fields: [field], values: [
    { company: 'own', field, year: 2023, metric: 'count', value: 70 },
    { company: 'own', field, year: 2024, metric: 'count', value: 135 },
    { company: 'own', field, year: 2024, metric: 'change', value: 93 },
  ] };
  const forward = `자사 ${field} 2023년 70건 → 2024년 135건, 증감률 93%`;
  assert.deepEqual(checkStatistics(forward, scoped), { statMismatches: [], statUnverified: [] });
  assert.ok(verifiedStatisticSubject(forward, scoped));
  const sharedPeriod = `2023년 대비 2024년에 자사 ${field} 70건→135건, 증감률 93%`;
  assert.deepEqual(checkStatistics(sharedPeriod, scoped), { statMismatches: [], statUnverified: [] });
  for (const arrow of ['→', '->']) {
    for (const rate of ['93%', '-48%']) {
      for (const line of [
        `자사 ${field} 2024년 135건 ${arrow} 2023년 70건, 증감률 ${rate}`,
        `2024년 자사 ${field} 135건 ${arrow} 2023년 70건, 증감률 ${rate}`,
      ]) {
        const result = checkStatistics(line, scoped);
        assert.deepEqual(result.statMismatches, []);
        assert.equal(result.statUnverified.length, 1, line);
        assert.equal(verifiedStatisticSubject(line, scoped), null);
      }
    }
  }
  const conflict = `자사 ${field} 2024년 135건 → 2023년 70건, 2023년 대비 2024년 증감률 93%`;
  assert.equal(checkStatistics(conflict, scoped).statUnverified.length, 1);
  assert.equal(verifiedStatisticSubject(conflict, scoped), null);
  assert.equal(checkStatistics(forward.replace('93%', '94%'), scoped).statMismatches.length, 1);
  const countsOnly = `자사 ${field} 2024년 135건 → 2023년 70건`;
  assert.deepEqual(checkStatistics(countsOnly, scoped), { statMismatches: [], statUnverified: [] });
});

test('괄호 연도와 분모의 연도를 보존하고 다른 해의 값으로 바꾼 대조 문장을 거부한다', () => {
  const scoped = { from: 2023, to: 2024, fields: [field], totalField: '회로', values: [
    { company: 'own', field, year: 2024, metric: 'share', value: 29 },
    { company: 'own', field: '회로', year: 2023, metric: 'count', value: 299 },
    { company: 'own', field: '회로', year: 2024, metric: 'count', value: 467 },
  ] };
  for (const value of [23, 29]) {
    const line = `자사 ${field} 비중은 ${value}%(2023년)다.`;
    assert.deepEqual(checkStatistics(line, scoped).statMismatches, []);
    assert.equal(checkStatistics(line, scoped).statUnverified.length, 1);
    assert.equal(verifiedStatisticSubject(line, scoped), null);
  }
  const actual = `2023년 자사 ${field} 비중은 전체 299건의 23%다.`;
  assert.deepEqual(checkStatistics(actual, scoped).statMismatches, []);
  assert.equal(checkStatistics(actual, scoped).statUnverified.length, 1);
  const swapped = actual.replace('299건의 23%', '467건의 29%');
  assert.match(checkStatistics(swapped, scoped).statMismatches[0], /회로 \/ 2023 \/ count/);
  assert.equal(verifiedStatisticSubject(swapped, scoped), null);
  const withYear = { ...scoped, values: [...scoped.values, { company: 'own', field, year: 2023, metric: 'share', value: 23 }] };
  assert.deepEqual(checkStatistics(actual, withYear), { statMismatches: [], statUnverified: [] });
  assert.deepEqual(checkStatistics(`자사 ${field} 비중 23%(2023년)`, withYear), { statMismatches: [], statUnverified: [] });
  assert.equal(checkStatistics(`자사 ${field} 비중 29%(2023년)`, withYear).statMismatches.length, 1);
});

test('같은 문장의 증감률과 비중을 각각 대조하며 모순된 연도·지표는 추정하지 않는다', () => {
  const scoped = { from: 2024, to: 2025, fields: [field], values: [
    { company: 'competitor', field, year: 2024, metric: 'count', value: 236 },
    { company: 'competitor', field, year: 2025, metric: 'count', value: 82 },
    { company: 'competitor', field, year: 2025, metric: 'change', value: -65 },
    { company: 'competitor', field, year: 2025, metric: 'share', value: 34 },
  ] };
  for (const line of [
    `삼성 ${field} 2024년 236건 → 2025년 82건(증감률 -65%, 2025년 비중 34%)`,
    `삼성 ${field} 2024년 대비 2025년 증감률 -65%(2025년 비중 34%)`,
  ]) {
    assert.deepEqual(checkStatistics(line, scoped), { statMismatches: [], statUnverified: [] }, line);
    assert.match(checkStatistics(line.replace('-65%', '-64%'), scoped).statMismatches[0], /change/);
    assert.match(checkStatistics(line.replace('34%', '35%'), scoped).statMismatches[0], /share/);
  }
  for (const line of [
    `삼성 ${field} 2024년 비중 34%(2025년)`,
    `삼성 ${field} 2025년 증감률 비중 34%`,
    `삼성 ${field} 2025년 비중 34% 증감률`,
  ]) {
    const result = checkStatistics(line, scoped);
    assert.deepEqual(result.statMismatches, []);
    assert.equal(result.statUnverified.length, 1, line);
  }
});

test('건수 화살표 뒤 비중에 마지막 명시 연도를 보존하고 모순된 분모 지표는 승인하지 않는다', () => {
  const scoped = { from: 2023, to: 2024, fields: [field], totalField: '회로', values: [
    { company: 'own', field, year: 2023, metric: 'count', value: 70 },
    { company: 'own', field, year: 2024, metric: 'count', value: 135 },
    { company: 'own', field, year: 2024, metric: 'share', value: 29 },
  ] };
  const line = `2023년 자사 ${field} 70건 → 2024년 135건, 비중 29%`;
  assert.deepEqual(checkStatistics(line, scoped), { statMismatches: [], statUnverified: [] });
  assert.match(checkStatistics(line.replace('29%', '23%'), scoped).statMismatches[0], /2024 \/ share/);
  const conflict = checkStatistics(`자사 ${field} 2024년 증감률 전체 467건의 29%`, scoped);
  assert.deepEqual(conflict.statMismatches, []);
  assert.equal(conflict.statUnverified.length, 1);
});

test('회사·분야 앞에 쓴 비중 연도를 보존하고 다른 연도의 비중을 통과시키지 않는다', () => {
  const current = { from: 2023, to: 2024, fields: [field], totalField: '소자', values: [
    { company: 'own', field, year: 2024, metric: 'share', value: 29 },
  ] };
  for (const value of [23, 29]) {
    const result = checkStatistics(`2023년 자사 ${field} 비중은 ${value}%다.`, current);
    assert.equal(result.statMismatches.length, 0);
    assert.equal(result.statUnverified.length, 1);
  }
  const withYear = { ...current, values: [...current.values,
    { company: 'own', field, year: 2023, metric: 'share', value: 23 }] };
  assert.deepEqual(checkStatistics(`2023년 자사 ${field} 비중은 23%다.`, withYear), { statMismatches: [], statUnverified: [] });
  assert.match(checkStatistics(`2023년 자사 ${field} 비중은 29%다.`, withYear).statMismatches[0], /2023 \/ share: 요약 29, 통계 23/);
});

test('다른 비교 기간이나 역방향 기간을 요청 기간의 증감률로 검증하지 않는다', () => {
  const current = { from: 2023, to: 2024, fields: [field], values: [
    { company: 'own', field, year: 2024, metric: 'change', value: 93 },
  ] };
  for (const period of ['2022년 대비 2024년', '2022~2024년', '2024년 대비 2023년']) {
    for (const value of [75, 93]) {
      const result = checkStatistics(`${period} 자사 ${field} 증감률은 ${value}%다.`, current);
      assert.deepEqual(result.statMismatches, []);
      assert.equal(result.statUnverified.length, 1);
    }
  }
  const trailing = `자사 ${field} 증감률 93%(2024년 대비 2023년)`;
  assert.equal(checkStatistics(trailing, current).statUnverified.length, 1);
  assert.deepEqual(checkStatistics(`2023년 대비 2024년 자사 ${field} 증감률은 93%다.`, current), { statMismatches: [], statUnverified: [] });
  assert.equal(checkStatistics(`2023년 대비 2024년 자사 ${field} 증감률은 75%다.`, current).statMismatches.length, 1);
});

test('기간과 전체 건수가 모두 0건이라는 주장을 모든 연도와 대조한다', () => {
  const current = { ...stats, totalField: '소자', values: [2020, 2021, 2022].map((year) => ({
    company: 'china', field: '소자', year, metric: 'count', value: 0,
  })) };
  const line = '중국 2020~2022년 회사 전체 건수가 모두 0건이다.';
  assert.deepEqual(checkStatistics(line, current), { statMismatches: [], statUnverified: [] });
  const changed = { ...current, values: current.values.map((row) => ({ ...row, value: row.year === 2021 ? 1 : 0 })) };
  assert.match(checkStatistics(line, changed).statMismatches[0], /2021/);
});

test('부호 있는 증감률과 전체 출원 중 비중을 해당 분야와 대조한다', () => {
  const scoped = { ...stats, totalField: '소자' };
  const comparison = `삼성 ${other} 2020년 50건 → 2022년 100건(100% 증가), 자사 같은 분야(-20%)와 방향이 다르다.`;
  const share = `자사 ${field}는 2020년 100건에서 2022년 150건으로 50% 증가했으며, 2022년 자사 소자 출원 중 비중은 60%다.`;
  assert.deepEqual(checkStatistics(comparison + '\n' + share, scoped), { statMismatches: [], statUnverified: [] });
  assert.equal(checkStatistics(share.replace('60%', '61%'), scoped).statMismatches.length, 1);
});

test('증감률 순위를 확인하고, 연도가 빠진 건수를 마지막 연도와 비교하지 않는다', () => {
  const ranked = `삼성 ${other} 증감률 순위 1위`;
  assert.deepEqual(checkStatistics(ranked, stats), { statMismatches: [], statUnverified: [] });
  assert.equal(checkStatistics(ranked.replace('1위', '2위'), stats).statMismatches.length, 1);
  const result = checkStatistics(`자사 ${field} 2020년 100건, 2022년 150건과 삼성 같은 분야 (80건, 120건)`, stats);
  assert.equal(result.statMismatches.length, 0);
  assert.equal(result.statUnverified.length, 1);
});

test('모든 해에 해당하는 건수는 기간 전체와 대조한다', () => {
  const periodStats = { ...stats, values: [...values, ...[2020, 2021, 2022].map((year) => ({
    company: 'china', field, year, metric: 'count', value: 0,
  }))] };
  const line = `중국 ${field} 2020~2022년 모든 해 0건`;
  assert.deepEqual(checkStatistics(line, periodStats), { statMismatches: [], statUnverified: [] });
  assert.equal(checkStatistics(line.replace('0건', '1건'), periodStats).statMismatches.length, 3);
});

test('첫해와 마지막 해는 선택 기간 끝점에만 연결한다', () => {
  const line = `자사 ${field} 첫해 100건 → 마지막 해 150건`;
  assert.deepEqual(checkStatistics(line, stats), { statMismatches: [], statUnverified: [] });
  assert.equal(checkStatistics(line.replace('150건', '120건'), stats).statMismatches.length, 1);
});

test('괄호 안의 비교 대상은 검증하되, 괄호 밖 건수의 회사에 영향을 주지 않는다', () => {
  const counts = { ...stats, totalField: '소자', values: [
    ...[2020, 2021, 2022].flatMap((year) => [
      { company: 'competitor', field, year, metric: 'count', value: year === 2020 ? 1 : 0 },
      { company: 'own', field: '소자', year, metric: 'count', value: 0 },
    ]),
  ] };
  const line = `- 삼성: 삼성디스플레이 ${field} 분야는 2020년 1건이며 2021년과 2022년은 0건으로, 자사(LG디스플레이, 전 분야 0건)와 달리 2020년에 1건이 있었다.`;
  assert.deepEqual(checkStatistics(line, counts), { statMismatches: [], statUnverified: [] });
  for (const wrong of [line.replace('2020년 1건', '2020년 2건'), line.replace('2020년에 1건', '2020년에 2건')]) {
    const result = checkStatistics(wrong, counts);
    assert.equal(result.statMismatches.length, 1);
    assert.match(result.statMismatches[0], /^competitor .*2020 \/ count: 요약 2, 통계 1/);
  }
  const ambiguous = checkStatistics(line.replace('전 분야 0건', '2020년 0건'), counts);
  assert.deepEqual(ambiguous.statMismatches, []);
  assert.equal(ambiguous.statUnverified.length, 1);
});

test('전체 건수와 분야 비중은 증감률과 각각 대조한다', () => {
  const counts = { ...stats, totalField: '소자', values: [
    ...values, { company: 'competitor', field: '소자', year: 2022, metric: 'count', value: 300 },
  ] };
  const line = `삼성 ${field} 2020년 80건 → 2022년 120건(50% 증가)으로 전체 300건의 40%를 차지했다.`;
  assert.deepEqual(checkStatistics(line, counts), { statMismatches: [], statUnverified: [] });
  assert.match(checkStatistics(line.replace('40%', '50%'), counts).statMismatches[0], /share: 요약 50, 통계 40/);
  assert.match(checkStatistics(line.replace('300건', '310건'), counts).statMismatches[0], /소자 \/ 2022 \/ count: 요약 310, 통계 300/);
});

test('분야명 뒤의 모든 해 0건도 선택 기간의 각 해를 검사한다', () => {
  const zeros = [2020, 2021, 2022].map((year) => ({ company: 'china', field, year, metric: 'count', value: 0 }));
  const line = `중국 2020~2022년 ${field} 출원이 모든 해 0건이다.`;
  assert.deepEqual(checkStatistics(line, { ...stats, values: [...values, ...zeros] }), { statMismatches: [], statUnverified: [] });
  zeros[1].value = 1;
  assert.match(checkStatistics(line, { ...stats, values: [...values, ...zeros] }).statMismatches[0], /2021.*통계 1/);
  assert.equal(checkStatistics(line.replace('2020~2022년', '2019~2022년'), {
    ...stats, values: [...values, ...zeros],
  }).statUnverified.length, 1);
});

test('기간 동안 각 건수를 쓴 주장과 변조한 값을 해마다 검사한다', () => {
  const counts = { ...stats, values: [2020, 2021, 2022].map((year) => ({ company: 'china', field, year, metric: 'count', value: 0 })) };
  const line = `중국 4사: ${field} 분야 출원은 2020~2022년 각 0건이다.`;
  assert.deepEqual(checkStatistics(line, counts), { statMismatches: [], statUnverified: [] });
  assert.equal(checkStatistics(line.replace('각 0건', '각 1건'), counts).statMismatches.length, 3);
  assert.deepEqual(checkStatistics(line.replace('각 0건', '각 0건, 0건, 0건'), counts), { statMismatches: [], statUnverified: [] });
});

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

// 2026-11-21 배포 요약(OLED > 소자): 연도를 숫자 뒤 괄호에 쓰면 뒤 숫자를 앞 연도로 잘못 짝지어 "숫자 다름"이 났다
test('연도를 숫자 뒤 괄호에 쓴 "100건(2020년) → 150건(2022년, 50% 증가)"도 맞게 읽는다', () => {
  const result = checkStatistics(`자사 ${field} 100건(2020년) → 150건(2022년, 50% 증가)\n삼성 ${field} 80건(2020년) → 120건(2022년)`, stats);
  assert.deepEqual(result, { statMismatches: [], statUnverified: [] });
  const wrong = checkStatistics(`자사 ${field} 100건(2020년) → 140건(2022년)`, stats);
  assert.equal(wrong.statMismatches.length, 1);
  assert.match(wrong.statMismatches[0], /2022 \/ count: 요약 140, 통계 150/);
});
