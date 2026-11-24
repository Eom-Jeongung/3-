import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSummaryInsights } from '../src/summaryInsights.js';
import { checkStatistics } from '../src/summaryStatCheck.js';

const field = '3D 표시';
const other = '전극';
const stats = {
  from: 2022, to: 2024, fields: [field, other], totalField: '소자',
  values: [
    ['own', field, 40], ['competitor', field, 60], ['china', field, 10],
    ['own', other, 60], ['competitor', other, 20], ['china', other, 0],
    ['own', '소자', 100], ['competitor', '소자', 80], ['china', '소자', 10],
  ].map(([company, field, value]) => ({ company, field, value, year: 2024, metric: 'count' })),
};
const insights = (...lines) => buildSummaryInsights(new Map([['핵심 흐름', lines.join('\n')]]), stats);

test('회사나 분야가 여럿이거나 부재를 말하거나 검증할 수치가 없으면 후보에 넣지 않는다', () => {
  const lines = [
    `- 삼성과 자사의 ${field} 및 ${other} 출원은 2024년 60건이다.`,
    `- 삼성 ${field} 2024년 60건으로 보이나 확인되지 않았다.`,
    `- 삼성 ${field} 분야는 집계에서 제외했다.`,
    `- 삼성 ${field} 출원을 살펴볼 수 있다.`,
    `- 삼성 ${field} 출원은 2024년 40건이다.`, // 이 숫자는 자사의 같은 분야 값이다.
    `- 자사의 출원은 2024년 100건이다. ${field} 출원도 언급됐다.`,
    `- 자사의 출원은 2024년 100건이고 ${field} 분야도 함께 언급됐다.`,
  ];
  for (const line of lines) {
    const result = insights(line);
    assert.deepEqual(result.counts, { pair: 0, company: 0, field: 0, insufficient: 1 }, line);
    assert.match(result.text, /자료가 부족하다/);
  }
});

test('같은 회사는 별칭을 통합하고 회사 단독보다 검증된 쌍을 우선한다', () => {
  const result = insights(
    '- 삼성디스플레이(주)의 전체 출원은 2024년 80건이다.',
    `- Samsung Display ${field}의 2024년 출원은 60건이다.`,
    `- 삼성 ${other}의 2024년 출원은 20건이다.`,
    '- LG디스플레이의 전체 출원은 2024년 100건이다.',
    `- 중국 4사 ${field}의 2024년 출원은 10건이다.`,
  );
  assert.deepEqual(result.counts, { pair: 1, company: 1, field: 0, insufficient: 0 });
  assert.equal(result.text, `## 시사점\n- 확인해 볼 점: 삼성디스플레이의 ${field} 출원을 살펴본다.\n- 확인해 볼 점: LG디스플레이의 주요 출원 동향을 살펴본다.`);
});

test('분야명 속 숫자는 보존하고 집계가 맞는 분야 단독 후보를 한 줄로 출력한다', () => {
  const line = `- ${field} 분야 전체 출원은 2024년 110건이다.`;
  assert.deepEqual(checkStatistics(line, stats), { statMismatches: [], statUnverified: [] });
  const result = buildSummaryInsights(new Map([
    ['핵심 흐름', line],
    ['한계', `- 삼성 ${other} 2024년 20건`],
  ]), stats);
  assert.deepEqual(result.counts, { pair: 0, company: 0, field: 1, insufficient: 0 });
  assert.equal(result.text, `## 시사점\n- 확인해 볼 점: ${field} 분야의 출원을 살펴본다.`);
  assert.equal(insights(line.replace('110건', '60건')).counts.insufficient, 1);
});
