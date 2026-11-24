import test from 'node:test';
import assert from 'node:assert/strict';
import { patentExcerptSentences, renderPatentExcerpts } from '../src/summaryPatentExcerpts.js';

const original = '패턴 영역은 주변보다 거친 표면 개질 영역을 포함하되 기판과 직접 접촉하지 않는다.';
const other = '게이트 라인과 직렬로 연결된 제어 회로를 포함한다.';
const evidence = [
  { number: '1020240194116', company: '경쟁사(삼성디스플레이)', excerptSentences: [original, other] },
  { number: '1020240029000', company: '자사(LG디스플레이)', excerptSentences: [other] },
];

test('완결된 한 문장과 그 조건·부정을 그대로 표시한다', () => {
  assert.deepEqual(patentExcerptSentences(`증착 기술에 관한 것이다. ${original} 후속 설명이 잘린 부분`),
    ['증착 기술에 관한 것이다.', original]);
  const view = renderPatentExcerpts('## 주목 특허\n- 1020240194116 | 1', evidence, 500);
  assert.match(view.content, /원문 발췌: 「패턴 영역은 주변보다 거친 표면 개질 영역을 포함하되 기판과 직접 접촉하지 않는다\.」/);
  assert.deepEqual(view.warnings, []);
});

test('다른 특허의 문장 번호, 이어 붙인 인용과 추세 설명은 표시하지 않는다', () => {
  const input = '## 주목 특허\n- 1020240029000 | 2\n- 1020240194116 | 1, 2\n- 1020240194116 | 1 증가 추세와 연결됨';
  const view = renderPatentExcerpts(input, evidence, 500);
  assert.equal(view.warnings.length, 3);
  assert.doesNotMatch(view.content, /원문 발췌:|증가 추세/);
});

test('두 문장이 예산을 넘으면 한 문장을 통째로 제외한다', () => {
  const first = renderPatentExcerpts('## 주목 특허\n- 1020240194116 | 1', evidence, 500).content;
  const input = '## 주목 특허\n- 1020240194116 | 1\n- 1020240029000 | 1';
  assert.equal(renderPatentExcerpts(input, evidence, first.length).content, first);
});
