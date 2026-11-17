import test from 'node:test';
import assert from 'node:assert/strict';
import { groundInterpretations } from '../src/summaryEvidence.js';

const field = '터치·센서';
const stats = { from: 2020, to: 2022, fields: [field], values: [{ company: 'own', field, year: 2022, metric: 'count', value: 40 }] };
const evidence = [{ number: '1020240147664', companyKey: 'own', field, title: '표시 장치', abstract: '터치 센서 전극을 포함하는 표시 장치' }];

test('같은 회사·분야의 검증된 통계와 실제 전달 원문을 연결한다', () => {
  const line = `- 해석: 자사 ${field} 2022년 40건 | 1020240147664 | 「터치 센서 전극을 포함하는」`;
  const result = groundInterpretations(line, evidence, stats);
  assert.match(result.content, /2022년 40건.*1020240147664.*터치 센서 전극/);
  assert.deepEqual(result.warnings, []);
});

test('없는 원문·다른 회사·다른 분야·잘못된 통계·없는 특허는 판단을 보류한다', () => {
  const inputs = [
    `자사 ${field} 2022년 40건 | 1020240147664 | 「성능이 크게 향상된다」`,
    `삼성 ${field} 2022년 40건 | 1020240147664 | 「터치 센서 전극을 포함하는」`,
    `자사 ${field} 2022년 41건 | 1020240147664 | 「터치 센서 전극을 포함하는」`,
    `자사 ${field} 2022년 40건 | 1020240147665 | 「터치 센서 전극을 포함하는」`,
    '근거 없이 투자가 늘었다',
  ];
  for (const input of inputs) {
    const result = groundInterpretations(`- 해석: ${input}`, evidence, stats);
    assert.equal(result.content, '- 해석: 판단 근거 부족');
    assert.equal(result.warnings.length, 1);
  }
  const different = [{ ...evidence[0], field: '패널 구조 설계' }];
  assert.match(groundInterpretations(`- 해석: 자사 ${field} 2022년 40건 | 1020240147664 | 「터치 센서 전극을 포함하는」`, different, stats).content, /판단 근거 부족/);
});

test('자유 서술은 보류하고 주목 특허는 실제 명칭과 선정 이유로 표시한다', () => {
  const e = [{ ...evidence[0], company: '자사', reason: '급증 용어' }];
  const text = `## 핵심 흐름\n- 검증 안 된 회사 전략입니다\n- 자사 ${field} 2022년 40건\n## 주목 특허\n- 1020240147664 거짓 주장`;
  const result = groundInterpretations(text, e, stats);
  assert.match(result.content, /판단 근거 부족/);
  assert.match(result.content, /자사 터치·센서 2022년 40건/);
  assert.match(result.content, /1020240147664 \(자사\): 표시 장치 \(급증 용어\)/);
  assert.ok(!result.content.includes('거짓 주장'));
});

test('기간 중 작은 표본이 있으면 사실 인용이 있어도 해석을 보류한다', () => {
  const small = { ...stats, minimumSample: 30, values: [...stats.values, { company: 'own', field, year: 2020, metric: 'count', value: 29 }] };
  const text = `- 해석: 자사 ${field} 2022년 40건 | 1020240147664 | 「터치 센서 전극을 포함하는」`;
  assert.equal(groundInterpretations(text, evidence, small).content, '- 해석: 판단 근거 부족');
  const sufficient = { ...small, values: small.values.map((v) => v.year === 2020 ? { ...v, value: 30 } : v) };
  assert.match(groundInterpretations(text, evidence, sufficient).content, /특허\(1020240147664\)/);
});
