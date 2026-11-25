import test from 'node:test';
import assert from 'node:assert/strict';
import { summaryQuality, summarizeQuality } from '../src/summaryQuality.js';

const stats = { from: 2022, to: 2024, fields: ['구동 회로', '전원 회로'] };
const tasks = [['핵심 메시지'], ['핵심 흐름', '성장 분야'], ['경쟁사 동향'], ['주목 특허']];
const base = {
  prompts: ['a', 'b', 'c', 'd'], tasks, stats,
  parts: ['## 핵심 메시지\n- 삼성 구동 회로 2022년 10건 → 2024년 20건',
    '## 핵심 흐름\n- 자사 전원 회로 2022년 30건 → 2024년 40건\n## 성장 분야\n- 해석: 판단 근거 부족',
    '## 경쟁사 동향\n- 삼성 구동 회로 2024년 20건',
    '## 주목 특허\n- 후보 없음'],
};

test('원응답의 위반과 최종본 잔존을 구분하고 시사점 근거를 기록한다', () => {
  const mixed = '삼성 구동 회로와 자사 전원 회로가 각각 2024년 20건이다.';
  const noPeriod = '삼성 구동 회로 증감률 93%';
  const parts = [...base.parts];
  parts[0] = `## 핵심 메시지\n- ${mixed}`;
  parts[2] = `## 경쟁사 동향\n- ${noPeriod}`;
  const result = summaryQuality({ ...base, parts, finalContent: `## 핵심 메시지\n- [확인 필요] ${mixed}`,
    insightSources: [{ company: 'competitor', field: '구동 회로', sourceLine: `- ${mixed}` }] });
  const mixedIssue = result.parts[0].issues.find(({ type }) => type === 'mixedSubjects');
  assert.equal(mixedIssue.finalPresence, 'retained');
  assert.equal(mixedIssue.usedForInsight, true);
  assert.equal(result.parts[2].issues[0].type, 'missingChangePeriod');
  assert.equal(result.parts[2].issues[0].finalPresence, 'changed_or_omitted');
  assert.equal(result.requestCount, 4);
  assert.equal(result.requestsWithIssues, 2);
});

test('전체 집계 문장을 혼합 주체로 세지 않고 비중을 증감률로 세지 않는다', () => {
  const parts = [...base.parts];
  parts[0] = '## 핵심 메시지\n- 삼성 전체 2024년 비중 48%';
  parts[2] = '## 경쟁사 동향\n- 구동 회로 2022년 대비 2024년 증감률 75%';
  const result = summaryQuality({ ...base, parts, finalContent: parts.join('\n') });
  assert.equal(result.hasIssues, false);
  const changed = summaryQuality({ ...base, prompts: ['changed', ...base.prompts.slice(1)], finalContent: '' });
  assert.notEqual(changed.promptVersion, result.promptVersion);
});

test('파트 분량 초과는 최종 의미 오류와 구분하고 중국 비중·무단 제목도 기록한다', () => {
  const parts = [...base.parts];
  parts[1] += '\n- ' + '가'.repeat(440);
  parts[2] += '\n- 중국 구동 회로 2024년 비중 20%\n## 결론\n- 무단 내용';
  const result = summaryQuality({ ...base, parts, chinaCountOnly: true, finalContent: '' });
  assert.equal(result.parts[1].issues.find(({ type }) => type === 'partBudgetExceeded').finalPresence, 'not_applicable');
  assert.ok(result.parts[2].issues.some(({ type }) => type === 'chinaNonCountMetric'));
  assert.ok(result.parts[2].issues.some(({ type }) => type === 'unexpectedHeading'));
});

test('관찰 이전 기록을 위반 0으로 세지 않고 요약·요청 분모와 프롬프트 버전을 분리한다', () => {
  const audit = summaryQuality({ ...base, finalContent: base.parts.join('\n') });
  const row = { model: 'test', criteria_version: 'v1', checks: { quality: audit, statMismatches: [], statUnverified: [] } };
  const altered = { ...audit, hasIssues: true, requestsWithIssues: 1,
    parts: [{ part: 1, issues: [{ type: 'mixedSubjects', finalPresence: 'retained' }] }] };
  const result = summarizeQuality([row, { ...row, checks: JSON.stringify({ quality: altered, statUnverified: ['unverified'] }) },
    { ...row, checks: { quality: { ...audit, promptVersion: 'other' } } }, { ...row, checks: {} }]);
  assert.equal(result.unauditedSummaries, 1);
  assert.equal(result.groups.length, 2);
  assert.equal(result.groups[0].summaries, 2);
  assert.equal(result.groups[0].requests, 8);
  assert.equal(result.groups[0].summariesWithIssues, 1);
  assert.equal(result.groups[0].requestsWithIssues, 1);
  assert.equal(result.groups[0].unverifiedSummaries, 1);
  assert.equal(result.groups[0].retainedIssues, 1);
});
