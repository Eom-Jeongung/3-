import { createHash } from 'node:crypto';
import { statisticSubjects } from './summaryStatCheck.js';

const BUDGETS = [145, 430, 290];
const bodyOf = (text) => text.trim().replace(/^[-*]\s+/, '').replace(/\[(?:확인 필요|숫자 다름|다른 언어)\]\s*/g, '');
const canonical = (text) => bodyOf(text).replace(/\s+/g, ' ');

/** 자동 관찰 기록이다. 사실 오류율이나 사람이 확인한 판정을 뜻하지 않는다. */
export function summaryQuality({ prompts, parts, tasks, finalContent, stats, insightSources = [], chinaCountOnly = false }) {
  const finalLines = finalContent.split('\n').filter((line) => /^\s*[-*]\s/.test(line)).map(canonical);
  const segmenter = new Intl.Segmenter('ko', { granularity: 'sentence' });
  const records = parts.map((part, index) => {
    const issues = [];
    const add = (type, text, details = {}) => {
      const body = canonical(text);
      issues.push({ type, text, ...details,
        finalPresence: !body ? 'not_applicable'
          : (/^##/.test(text) ? finalContent.includes(text) : finalLines.some((line) => line === body || line.includes(body)))
            ? 'retained' : 'changed_or_omitted',
        usedForInsight: Boolean(body) && insightSources.some(({ sourceLine }) => canonical(sourceLine) === body || canonical(sourceLine).includes(body)),
      });
    };
    const headings = [...part.matchAll(/^##[ \t]+([^\r\n]+)$/gm)]
      .map(([, heading]) => heading.trim().replace(/^핵심 흐름 \(3줄\)$/, '핵심 흐름'));
    for (const heading of headings.filter((heading) => !tasks[index].includes(heading))) add('unexpectedHeading', `## ${heading}`);
    for (const heading of tasks[index].filter((heading) => !headings.includes(heading))) add('missingHeading', `## ${heading}`);
    if (BUDGETS[index] && part.length > BUDGETS[index]) {
      add('partBudgetExceeded', '', { actual: part.length, limit: BUDGETS[index] });
    }
    if (index < 3) {
      for (const line of part.split('\n').filter((line) => /^\s*[-*]\s/.test(line))) {
        for (const { segment } of segmenter.segment(bodyOf(line))) {
          const text = segment.trim();
          const { companies, fields } = statisticSubjects(text, stats);
          if (companies.length > 1 || fields.length > 1) add('mixedSubjects', text, { companies, fields });
          if (/\d+(?:\.\d+)?\s*%/.test(text) && /증감|증가|감소|상승|하락/.test(text) && !/비중|점유율/.test(text)) {
            const years = new Set([...text.matchAll(/(\d{4})(?=\s*(?:년|[~–-]))/g)].map(([, year]) => Number(year)));
            if (!(years.has(stats.from) && years.has(stats.to))) add('missingChangePeriod', text);
          }
          if (chinaCountOnly && companies.includes('china') && /\d+(?:\.\d+)?\s*%/.test(text)) add('chinaNonCountMetric', text);
        }
      }
    }
    return { part: index + 1, length: part.length, issues };
  });
  return {
    schemaVersion: 1,
    checkerVersion: 'year-period-aggregate-v1',
    promptVersion: createHash('sha256').update(JSON.stringify(prompts)).digest('hex'),
    // 요약 수와 내부 요청 수를 각각 분모로 쓸 수 있도록 분리한다.
    requestCount: parts.length,
    requestsWithIssues: records.filter(({ issues }) => issues.length).length,
    hasIssues: records.some(({ issues }) => issues.length),
    finalLength: finalContent.length,
    insightSources,
    parts: records,
  };
}

/** 수치 경고 건수와 원응답 규칙 위반 횟수를 별도로 집계한다. 수동 판정된 사실 오류율은 아니다. */
export function summarizeQuality(rows) {
  const groups = new Map();
  let unaudited = 0;
  for (const row of rows) {
    const checks = typeof row.checks === 'string' ? JSON.parse(row.checks) : row.checks;
    const audit = checks?.quality;
    if (!audit) { unaudited++; continue; }
    const key = JSON.stringify([row.model, row.criteria_version, audit.promptVersion, audit.checkerVersion]);
    if (!groups.has(key)) groups.set(key, {
      model: row.model, criteriaVersion: row.criteria_version, promptVersion: audit.promptVersion, checkerVersion: audit.checkerVersion,
      summaries: 0, summariesWithIssues: 0, requests: 0, requestsWithIssues: 0,
      summariesWithRetainedIssues: 0, retainedIssues: 0, changedOrOmittedIssues: 0,
      mismatchSummaries: 0, unverifiedSummaries: 0, issueCounts: {},
    });
    const group = groups.get(key);
    group.summaries++;
    group.summariesWithIssues += Number(audit.hasIssues);
    group.requests += audit.requestCount;
    group.requestsWithIssues += audit.requestsWithIssues;
    const issues = audit.parts.flatMap(({ issues }) => issues);
    group.summariesWithRetainedIssues += Number(issues.some(({ finalPresence }) => finalPresence === 'retained'));
    for (const { type, finalPresence } of issues) {
      group.issueCounts[type] = (group.issueCounts[type] ?? 0) + 1;
      group.retainedIssues += Number(finalPresence === 'retained');
      group.changedOrOmittedIssues += Number(finalPresence === 'changed_or_omitted');
    }
    group.mismatchSummaries += Number(Boolean(checks.statMismatches?.length));
    group.unverifiedSummaries += Number(Boolean(checks.statUnverified?.length));
  }
  return { totalSummaries: rows.length, unauditedSummaries: unaudited, groups: [...groups.values()] };
}
