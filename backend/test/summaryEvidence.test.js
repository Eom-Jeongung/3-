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

// 2026-11-18: 근거를 확인하지 못한 줄은 지우지 않고 원문 앞에 표시를 붙인다 (맞는 내용까지 사라지지 않게)
test('없는 원문·다른 회사·없는 특허·근거 없는 해석은 원문을 남기고 주의로 표시한다', () => {
  const inputs = [
    `자사 ${field} 2022년 40건 | 1020240147664 | 「성능이 크게 향상된다」`,
    `삼성 ${field} 2022년 40건 | 1020240147664 | 「터치 센서 전극을 포함하는」`,
    `자사 ${field} 2022년 40건 | 1020240147665 | 「터치 센서 전극을 포함하는」`,
    '근거 없이 투자가 늘었다',
  ];
  for (const input of inputs) {
    const result = groundInterpretations(`- 해석: ${input}`, evidence, stats);
    assert.equal(result.content, `- [주의] 해석: ${input}`);
    assert.equal(result.warnings.length, 1);
  }
  const different = [{ ...evidence[0], field: '패널 구조 설계' }];
  assert.match(groundInterpretations(`- 해석: 자사 ${field} 2022년 40건 | 1020240147664 | 「터치 센서 전극을 포함하는」`, different, stats).content, /^- \[주의\] 해석:/);
});

test('해석의 통계가 비교 문장이어도 숫자가 모두 맞고 원문 인용이 맞으면 확인된 해석으로 정리한다', () => {
  const two = { ...stats, values: [...stats.values, { company: 'own', field, year: 2020, metric: 'count', value: 35 }] };
  const line = `- 해석: 자사 ${field} 2020년 35건 → 2022년 40건 | 1020240147664 | 「터치 센서 전극을 포함하는」`;
  const result = groundInterpretations(line, evidence, two);
  assert.match(result.content, /^- 해석: 자사 터치·센서 2020년 35건 → 2022년 40건 · 특허\(1020240147664\)/);
  assert.deepEqual(result.warnings, []);
});

test('해석의 통계 숫자가 자료와 다르면 숫자 다름으로 표시한다', () => {
  const result = groundInterpretations(`- 해석: 자사 ${field} 2022년 41건 | 1020240147664 | 「터치 센서 전극을 포함하는」`, evidence, stats);
  assert.match(result.content, /^- \[숫자 다름\] 해석: 자사 터치·센서 2022년 41건/);
});

test('확인 안 된 서술은 표시해 남기고, 주목 특허는 실제 명칭과 선정 이유로 표시한다', () => {
  const e = [{ ...evidence[0], company: '자사', reason: '급증 용어' }];
  const text = `## 핵심 흐름\n- 검증 안 된 회사 전략입니다\n- 자사 ${field} 2022년 40건\n- 자사 ${field} 2022년 45건\n## 주목 특허\n- 1020240147664 거짓 주장`;
  const result = groundInterpretations(text, e, stats);
  assert.match(result.content, /- \[주의\] 검증 안 된 회사 전략입니다/);
  assert.match(result.content, /\n- 자사 터치·센서 2022년 40건\n/);
  assert.match(result.content, /- \[숫자 다름\] 자사 터치·센서 2022년 45건/);
  assert.match(result.content, /1020240147664 \(자사\): 표시 장치 \(급증 용어\)/);
  assert.ok(!result.content.includes('거짓 주장'));
});

test('한자·일본 글자가 섞인 줄은 다른 언어로 표시하고 따로 모은다', () => {
  const result = groundInterpretations(`## 경쟁사 동향\n- 중국 4사는 한국 출원이 적다但样本量小`, evidence, stats);
  assert.match(result.content, /- \[다른 언어\] 중국 4사는 한국 출원이 적다但样本量小/);
  assert.equal(result.foreignText.length, 1);
});

test('기간 중 작은 표본이 있으면 사실 인용이 있어도 해석을 주의로 둔다', () => {
  const small = { ...stats, minimumSample: 30, values: [...stats.values, { company: 'own', field, year: 2020, metric: 'count', value: 29 }] };
  const text = `- 해석: 자사 ${field} 2022년 40건 | 1020240147664 | 「터치 센서 전극을 포함하는」`;
  assert.match(groundInterpretations(text, evidence, small).content, /^- \[주의\] 해석:/);
  const sufficient = { ...small, values: small.values.map((v) => v.year === 2020 ? { ...v, value: 30 } : v) };
  assert.match(groundInterpretations(text, evidence, sufficient).content, /특허\(1020240147664\)/);
});

// 2026-11-21: 시사점 칸(담당자님 피드백으로 추가)은 숫자 없이 살펴볼 점을 쓰므로 숫자가 없다고 표시하지 않는다
test('시사점은 숫자가 없어도 표시하지 않고, 근거 목록에 없는 특허나 틀린 숫자만 표시한다', () => {
  const ok = '## 시사점\n- 확인해 볼 점: 자사 터치·센서의 주목 특허(1020240147664)를 더 살펴보면 좋다.';
  const okResult = groundInterpretations(ok, evidence, stats);
  assert.equal(okResult.content, ok);
  assert.deepEqual(okResult.warnings, []);

  const unknown = groundInterpretations('## 시사점\n- 확인해 볼 점: 1020240147665 특허를 살펴본다.', evidence, stats);
  assert.match(unknown.content, /- \[주의\] 확인해 볼 점/);

  const wrong = groundInterpretations(`## 시사점\n- 확인해 볼 점: 자사 ${field} 2022년 99건을 살펴본다.`, evidence, stats);
  assert.match(wrong.content, /- \[숫자 다름\] 확인해 볼 점/);
});
