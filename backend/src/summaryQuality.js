import { createHash } from 'node:crypto';
import { percentageReadings, statisticCompanyAt, statisticSubjects } from './summaryStatCheck.js';
import { canonicalSummaryBody, composeSummaryParts, statisticPart, summaryBody } from './summarySources.js';

const BUDGETS = [145, 430, 290];

/** 자동 관찰 기록이다. 사실 오류율이나 사람이 확인한 판정을 뜻하지 않는다. */
export function summaryQuality({ prompts, parts, tasks, finalContent, stats, insightSources = [], finalSources, chinaCountOnly = false }) {
  const composed = composeSummaryParts(parts, tasks);
  const finalByOrigin = new Map((finalSources ?? []).map((row) => [row.lineId, row]));
  const records = parts.map((part, index) => {
    const issues = [];
    const add = (type, text, origin = null, details = {}) => {
      if (issues.some((issue) => issue.type === type && issue.source?.id === (origin?.id ?? origin?.lineId) && issue.text === text)) return;
      const row = origin && finalByOrigin.get(origin.lineId);
      const source = origin ? { id: origin.id ?? origin.lineId, request: origin.request, section: origin.section,
        sectionNumber: origin.sectionNumber, line: origin.line, sentence: origin.sentence ?? 0 } : null;
      issues.push({ type, text, source, ...details,
        // 출처 없는 과거 재처리는 문자열로 역추정하지 않는다.
        finalPresence: !origin ? 'not_applicable' : finalSources === undefined ? 'unknown'
          : row ? canonicalSummaryBody(row.text).includes(canonicalSummaryBody(text)) ? 'retained' : 'transformed' : 'changed_or_omitted',
        usedForInsight: origin?.id && finalSources === undefined ? null
          : Boolean(origin?.id) && insightSources.some(({ origin: used }) => used?.sentenceIds.includes(origin.id)),
      });
    };
    const blocks = composed.requests[index];
    const headings = blocks.map(({ section }) => section);
    for (const block of blocks) {
      if (!tasks[index].includes(block.section)) add('unexpectedHeading', block.lines[0].text, block.lines[0]);
      else if (composed.origins.get(block.section)?.[0].lineId !== block.lines[0].lineId) add('duplicateHeading', block.lines[0].text, block.lines[0]);
    }
    for (const heading of tasks[index].filter((heading) => !headings.includes(heading))) add('missingHeading', `## ${heading}`);
    if (BUDGETS[index] && part.length > BUDGETS[index]) {
      add('partBudgetExceeded', '', null, { actual: part.length, limit: BUDGETS[index] });
    }
    if (index < 3) {
      for (const line of blocks.flatMap(({ lines }) => lines).filter(({ text }) => /^\s*[-*]\s/.test(text))) {
        const statisticalLine = statisticPart(summaryBody(line.text));
        for (const sentence of line.sentences) {
          const text = sentence.text;
          const statistical = statisticalLine.slice(sentence.start, sentence.end).trim();
          if (!statistical) continue;
          const { companies, fields } = statisticSubjects(statistical, stats);
          if (companies.length > 1 || fields.length > 1) add('mixedSubjects', text, sentence, { companies, fields });
          const interpretation = /^해석\s*:/.test(statisticPart(line.text).replace(/^[-*]\s*/, ''));
          for (const reading of percentageReadings(statistical, stats)) {
            if (reading.metric === 'change') {
              // 건수의 연도 표기와 증감률 자체의 비교 기간 표기 준수는 구분한다.
              const period = reading.period;
              if (!period) add('missingChangePeriod', text, sentence);
              else if (reading.periodConflict || period[0] !== stats.from || period[1] !== stats.to) add('invalidChangePeriod', text, sentence, { period });
            }
            if (reading.metric === 'share' && !interpretation) add('countOnlyShare', text, sentence);
            if (chinaCountOnly && statisticCompanyAt(statistical, reading.start, stats) === 'china') add('chinaNonCountMetric', text, sentence);
          }
          if (chinaCountOnly) for (const rank of statistical.matchAll(/\d+\s*위/g)) {
            if (statisticCompanyAt(statistical, rank.index, stats) === 'china') add('chinaNonCountMetric', text, sentence);
          }
        }
      }
    }
    return { part: index + 1, length: part.length, issues };
  });
  return {
    schemaVersion: 2,
    checkerVersion: 'per-number-source-v2',
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
      summariesWithRetainedIssues: 0, retainedIssues: 0, changedOrOmittedIssues: 0, transformedIssues: 0, unknownPresenceIssues: 0,
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
      group.transformedIssues += Number(finalPresence === 'transformed');
      group.unknownPresenceIssues += Number(finalPresence === 'unknown');
    }
    group.mismatchSummaries += Number(Boolean(checks.statMismatches?.length));
    group.unverifiedSummaries += Number(Boolean(checks.statUnverified?.length));
  }
  return { totalSummaries: rows.length, unauditedSummaries: unaudited, groups: [...groups.values()] };
}
