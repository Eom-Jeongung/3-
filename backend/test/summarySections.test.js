import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSummary, SECTIONS } from '../src/summaryCheck.js';

const STAT = '자사 회로 2022년 120건 2024년 180건 50%';
const answerWith = (sections) => sections.map((s) => `## ${s}\n- 자사 회로 2022년 120건 → 2024년 180건(50% 증가)`).join('\n');

test('요약은 핵심 메시지와 시사점을 포함한 일곱 칸이다', () => {
  assert.deepEqual(SECTIONS, ['핵심 메시지', '핵심 흐름', '성장 분야', '경쟁사 동향', '주목 특허', '시사점', '한계']);
});

test('일곱 칸을 다 쓰면 빠진 칸이 없다', () => {
  assert.deepEqual(checkSummary(answerWith(SECTIONS), STAT, []).missingSections, []);
});

test('예전 다섯 칸 형식이면 핵심 메시지와 시사점이 빠진 칸으로 잡힌다', () => {
  const old = answerWith(['핵심 흐름 (3줄)', '성장 분야', '경쟁사 동향', '주목 특허', '한계']);
  assert.deepEqual(checkSummary(old, STAT, []).missingSections, ['핵심 메시지', '시사점']);
});

test('시사점에 회사 의도를 단정하는 말을 쓰면 과한 해석으로 잡힌다', () => {
  const answer = `${answerWith(SECTIONS)}\n## 시사점\n- 확인해 볼 점: 삼성의 전략 변화를 살펴볼 필요가 있다`;
  assert.equal(checkSummary(answer, STAT, []).overreach.length, 1);
});

test('필수 자동 안내는 모델 답변이 아니라 최종 한계에서 확인한다', () => {
  const answer = answerWith(SECTIONS.filter((name) => name !== '한계'));
  const required = '- 규칙 기반 자동 분류입니다.';
  const finalContent = `${answer}\n## 한계\n${required}`;
  assert.deepEqual(checkSummary(answer, STAT, [], { finalContent, requiredLimitations: [required] }).missingSections, []);
  assert.deepEqual(checkSummary(answer, STAT, [], {
    finalContent: `${answer}\n${required}\n## 한계\n- 다른 안내`,
    requiredLimitations: [required],
  }).formatIssues, ['최종 한계 안내 1줄 누락']);
});
