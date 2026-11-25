import test from 'node:test';
import assert from 'node:assert/strict';
import { summaryQuality, summarizeQuality } from '../src/summaryQuality.js';
import { composeSummaryParts, summaryBody } from '../src/summarySources.js';
import { buildSummaryInsights } from '../src/summaryInsights.js';

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
  const source = composeSummaryParts(parts, tasks).origins.get('핵심 메시지')[1];
  const result = summaryQuality({ ...base, parts, finalContent: `## 핵심 메시지\n- [주의] ${mixed}`,
    finalSources: [{ ...source, text: `- [주의] ${mixed}` }],
    insightSources: [{ company: 'competitor', field: '구동 회로', sourceLine: `- ${mixed}`,
      origin: { lineId: source.lineId, sentenceIds: source.sentences.map(({ id }) => id) } }] });
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
  assert.ok(result.parts[0].issues.some(({ type }) => type === 'countOnlyShare'));
  assert.ok(!result.parts.flatMap(({ issues }) => issues).some(({ type }) => type === 'mixedSubjects' || type === 'missingChangePeriod'));
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

test('역순 기간과 비중이 함께 있는 문장의 기간 생략·건수 전용 줄 위반을 기록한다', () => {
  const parts = [...base.parts];
  parts[0] = '## 핵심 메시지\n- 삼성 구동 회로 2024년 대비 2022년 증감률 93%';
  parts[2] = '## 경쟁사 동향\n- 삼성 구동 회로 증감률 93%, 2024년 비중 34%';
  const result = summaryQuality({ ...base, parts, finalContent: '', finalSources: [] });
  assert.ok(result.parts[0].issues.some(({ type }) => type === 'invalidChangePeriod'));
  assert.ok(result.parts[2].issues.some(({ type }) => type === 'missingChangePeriod'));
  assert.ok(result.parts[2].issues.some(({ type }) => type === 'countOnlyShare'));
});

test('역순 화살표의 증감률은 잘못된 비교 기간으로 기록한다', () => {
  const parts = [...base.parts];
  parts[0] = '## 핵심 메시지\n- 삼성 구동 회로 2024년 50건 → 2022년 30건, 증감률 67%';
  const result = summaryQuality({ ...base, parts, finalContent: '', finalSources: [] });
  const issue = result.parts[0].issues.find(({ type }) => type === 'invalidChangePeriod');
  assert.deepEqual(issue.period, [2024, 2022]);
});

test('특허 인용의 분야명은 통계 주체에 섞지 않고 중국 뒤의 순위를 별도로 기록한다', () => {
  const parts = [...base.parts];
  parts[2] = '## 경쟁사 동향\n- 해석: 삼성 구동 회로 2022년 30건 → 2024년 50건 | 1020240000001 | 「전원 회로 및 회로를 포함한다」\n- 삼성 구동 회로 2024년 비중 34%이며 중국 구동 회로 2024년 0건이다.\n- 중국 구동 회로 2024년 1위';
  const result = summaryQuality({ ...base, parts, finalContent: '', finalSources: [], chinaCountOnly: true });
  const issues = result.parts[2].issues;
  assert.ok(!issues.some(({ type, text }) => type === 'mixedSubjects' && text.startsWith('해석:')));
  assert.ok(!issues.some(({ type, text }) => type === 'chinaNonCountMetric' && text.startsWith('삼성')));
  assert.ok(issues.some(({ type, text }) => type === 'chinaNonCountMetric' && text.includes('1위')));
});

test('같은 문장이 다른 요청의 무단 섹션에 있어도 채택된 출처만 잔존·시사점 사용으로 기록한다', () => {
  const parts = [...base.parts];
  const text = '- 삼성 구동 회로 증감률 33%';
  parts[0] = `## 핵심 메시지\n${text}`;
  parts[2] = `## 경쟁사 동향\n- 해석: 판단 근거 부족\n## 핵심 메시지\n${text}`;
  const actualStats = { ...stats, values: [{ company: 'competitor', field: '구동 회로', year: 2024, metric: 'change', value: 33 }] };
  const composed = composeSummaryParts(parts, tasks);
  const insights = buildSummaryInsights(composed.sections, actualStats, composed.origins);
  assert.equal(insights.sources[0].origin.request, 1);
  const finalSources = [...composed.origins.values()].flat();
  const result = summaryQuality({ ...base, parts, stats: actualStats, finalContent: composed.content, finalSources, insightSources: insights.sources });
  const first = result.parts[0].issues.find(({ type }) => type === 'missingChangePeriod');
  const excluded = result.parts[2].issues.find(({ type }) => type === 'missingChangePeriod');
  assert.equal(first.finalPresence, 'retained');
  assert.equal(first.usedForInsight, true);
  assert.equal(excluded.finalPresence, 'changed_or_omitted');
  assert.equal(excluded.usedForInsight, false);
  assert.notEqual(first.source.id, excluded.source.id);
  assert.equal(result.parts[2].issues.find(({ type }) => type === 'unexpectedHeading').finalPresence, 'changed_or_omitted');
});

test('같은 요청의 중복 섹션도 구분하고 출처 없는 재처리에서는 잔존을 추정하지 않는다', () => {
  const parts = [...base.parts];
  const text = '- 삼성 구동 회로 증감률 33%';
  parts[0] = `## 핵심 메시지\n${text}\n## 핵심 메시지\n${text}`;
  const composed = composeSummaryParts(parts, tasks);
  const result = summaryQuality({ ...base, parts, finalContent: composed.content, finalSources: [...composed.origins.values()].flat() });
  const missing = result.parts[0].issues.filter(({ type }) => type === 'missingChangePeriod');
  assert.deepEqual(missing.map(({ finalPresence }) => finalPresence), ['retained', 'changed_or_omitted']);
  assert.ok(result.parts[0].issues.some(({ type }) => type === 'duplicateHeading'));
  const legacy = summaryQuality({ ...base, parts, finalContent: composed.content });
  assert.equal(legacy.parts[0].issues.find(({ type }) => type === 'missingChangePeriod').finalPresence, 'unknown');
});

test('건수 연도가 앞에 있어도 증감률 자체의 기간 생략은 기록하고 뒤 괄호 기간은 인정한다', () => {
  const parts = [...base.parts];
  parts[0] = '## 핵심 메시지\n- 삼성 구동 회로 2022년 30건 → 2024년 50건, 증감률 67%';
  parts[2] = '## 경쟁사 동향\n- 삼성 구동 회로 증감률 67%(2022년 대비 2024년)';
  const result = summaryQuality({ ...base, parts, finalContent: '', finalSources: [] });
  assert.ok(result.parts[0].issues.some(({ type }) => type === 'missingChangePeriod'));
  assert.ok(!result.parts[2].issues.some(({ type }) => /ChangePeriod/.test(type)));
});

test('출처를 유지한 후처리와 탈락을 구분하고 여러 문장의 인용을 통계로 읽지 않는다', () => {
  const parts = [...base.parts];
  parts[0] = '## 핵심 메시지\n- 삼성 구동 회로 증감률 93%';
  parts[2] = '## 경쟁사 동향\n- 해석: 삼성 구동 회로 2022년 30건 → 2024년 50건 | 1020240000001 | 「전원 회로다. 구동 회로와 연결된다.」';
  const source = composeSummaryParts(parts, tasks).origins.get('핵심 메시지')[1];
  const result = summaryQuality({ ...base, parts, finalContent: '- 삼성 구동 회로 건수만 표시',
    finalSources: [{ ...source, text: '- 삼성 구동 회로 건수만 표시' }] });
  assert.equal(result.parts[0].issues[0].finalPresence, 'transformed');
  assert.ok(!result.parts[2].issues.some(({ type }) => type === 'mixedSubjects'));
});

// 2026-11-25: 기술 분석 병합 때 '확인 필요' 표시를 '주의'로 바꿨다. 출처 추적은 두 표시 모두 떼고 비교한다
test('출처 추적은 [주의]와 예전 [확인 필요] 표시를 모두 떼고 비교한다', () => {
  assert.equal(summaryBody('- [주의] 자사 봉지 2024년 69건'), '자사 봉지 2024년 69건');
  assert.equal(summaryBody('- [확인 필요] 자사 봉지 2024년 69건'), '자사 봉지 2024년 69건');
});
