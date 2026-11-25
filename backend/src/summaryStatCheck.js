// 요약 문장의 숫자를 통계와 대조한다.
// 회사·분야·연도·지표를 알아낼 수 있을 때만 맞다/틀리다를 판단하고, 모호하면 확인 불가(statUnverified)로 남긴다.
// - 줄을 회사·분야 이름이 나오는 자리에서 나누고, 숫자는 바로 앞에 나온 회사·분야의 것으로 본다
//   예: "자사: 전극·화소 정의(100→166, 66% 증가)와 봉지(50→69, 38% 증가)" → 자사·전극·화소 정의, 자사·봉지
// - 숫자 앞에 회사(또는 분야)가 둘 이상 나란히 나오면("자사와 삼성 …") 누구의 숫자인지 모호하므로 확인 불가
// - "2022년 320건 → 2024년 420건", "100→166"은 첫해·마지막 해 건수로 본다 (연도를 적었으면 그 연도)
// - 증감률(%)은 첫해 대비 마지막 해 값이다. 줄에 첫해와 마지막 해가 모두 나오거나 "N→M" 비교가 있을 때만 확인한다
// - 분야를 적지 않은 숫자는 고른 범위 전체(stats.totalField)의 합계로 본다
// - "251건(2022년) → 288건(2024년, 15% 증가)"처럼 연도가 숫자 뒤 괄호에 오면 "2022년 251건 → 2024년 288건(15% 증가)"로 바꿔 읽는다
//   (그대로 두면 288건 앞의 마지막 연도인 2022년을 288건의 연도로 잘못 짝지었다. 2026-11-21 배포 요약)
// - "30건 미만" 같은 기준 숫자, "중국 4사", 연도 범위(2022~2024년)는 대조하지 않는다
import { withAggregateStatistics } from './summaryAggregateStats.js';

const ALIASES = {
  own: /자사|\bLG(?:\s*디스플레이|\s+Display\b)?(?:\s*\(주\))?/gi,
  competitor: /삼성(?:\s*디스플레이)?(?:\s*\(주\))?|\bSamsung\s+Display\b|(?<!중국[ \t]*)경쟁사/gi,
  china: /중국(?:[ \t]*(?:4[ \t]*사|경쟁사))?|BOE|CSOT|Tianma|Visionox/gi,
};
const ARROW = /(?:(\d{4})\s*년\s*)?(\d+)\s*건?\s*(?:→|->)\s*(?:(\d{4})\s*년\s*)?(\d+)\s*건?/g;

// 줄에서 회사·분야 이름이 나오는 자리 (더 긴 분야 이름 안에 든 짧은 이름은 뺀다: "기타 소자" 안의 "소자")
function mentionsIn(line, stats) {
  const marks = [];
  for (const [company, re] of Object.entries(ALIASES)) {
    for (const m of line.matchAll(re)) marks.push({ idx: m.index, end: m.index + m[0].length, type: 'company', value: company });
  }
  const names = [...new Set([...stats.fields.filter((f) => f !== '전체'), stats.totalField].filter(Boolean))].sort((a, b) => b.length - a.length);
  const taken = [];
  for (const name of names) {
    let i = line.indexOf(name);
    while (i !== -1) {
      const end = i + name.length;
      if (!taken.some(([s, e]) => i >= s && end <= e)) { taken.push([i, end]); marks.push({ idx: i, end, type: 'field', value: name }); }
      i = line.indexOf(name, end);
    }
  }
  return marks.sort((a, b) => a.idx - b.idx);
}

// 운영 점검에서도 검사기와 같은 별칭·분야 인식을 사용한다.
export function statisticSubjects(line, stats) {
  const mentions = mentionsIn(line, stats);
  return {
    companies: [...new Set(mentions.filter((mark) => mark.type === 'company').map((mark) => mark.value))],
    fields: [...new Set(mentions.filter((mark) => mark.type === 'field').map((mark) => mark.value))],
  };
}

// 수치에 붙은 지표와 연도는 한 경로로 읽는다. 뒤의 다른 지표가 앞의 %를 덮어쓰지 않는다.
function percentageReading(text, start, end, stats, { earlierYear = null, context = '', lineIsChange = false } = {}) {
  const before = text.slice(0, start).split(/[,。]|\.\s/).at(-1);
  const after = text.slice(end).split(/[,。]|\.\s/)[0];
  const labels = [...before.matchAll(/비중|점유율|증감률|증가율|감소율|변화율/g)];
  const leading = labels.at(-1)?.[0];
  const trailing = after.match(/^\s*(?:\(\s*)?(비중|점유율|증감률|증가율|감소율|변화율)/)?.[1];
  const kind = (label) => /비중|점유율/.test(label) ? 'share' : 'change';
  const previousLabel = labels.at(-2);
  const competingLabels = previousLabel && kind(previousLabel[0]) !== kind(leading)
    && !/\d|%/.test(before.slice(previousLabel.index + previousLabel[0].length, labels.at(-1).index));
  const conflictingMetric = competingLabels || (leading && trailing && kind(leading) !== kind(trailing));
  let metric = leading ? kind(leading) : trailing ? kind(trailing) : null;
  if (!metric && (/전체(?:\s*출원)?(?:\s*\d+\s*건)?의\s*$/.test(before) || /^\s*(?:을|를)?\s*차지/.test(after))) metric = 'share';
  if (!metric && (/^[+-]/.test(text.slice(start, end)) || /증가|상승|늘|감소|하락|줄/.test(`${before.slice(-18)} ${after.slice(0, 12)}`) || lineIsChange)) metric = 'change';
  const yearContext = text.slice(0, start).split(/。|\.\s/).at(-1);
  const previousYear = [...yearContext.matchAll(/(\d{4})\s*년/g)].at(-1)?.[1];
  const followingYear = after.match(/^\s*\(\s*(\d{4})\s*년\s*\)/)?.[1];
  const attachedYear = followingYear ? Number(followingYear) : null;
  const inheritedYear = previousYear ? Number(previousYear) : earlierYear;
  const yearConflict = attachedYear !== null && inheritedYear != null && attachedYear !== inheritedYear;
  const beforePeriod = [...(context + before).matchAll(/(\d{4})\s*년?\s*(?:대비|부터|[~–-])\s*(\d{4})\s*년/g)].at(-1);
  const afterPeriod = after.match(/^\s*\(\s*(\d{4})\s*년?\s*(?:대비|부터|[~–-])\s*(\d{4})\s*년\s*\)/);
  const period = afterPeriod ?? beforePeriod;
  return { metric: conflictingMetric ? null : metric,
    year: yearConflict ? null : attachedYear ?? inheritedYear ?? stats.to,
    yearConflict,
    period: period ? [Number(period[1]), Number(period[2])] : null,
    periodConflict: Boolean(beforePeriod && afterPeriod && (beforePeriod[1] !== afterPeriod[1] || beforePeriod[2] !== afterPeriod[2])),
    decrease: /감소율/.test(leading ?? trailing ?? '') || /감소|하락|줄/.test(after.slice(0, 12)),
  };
}

// 운영 기록은 수치 해석을 재구현하지 않고 같은 지표·기간 판독을 사용한다.
export function percentageReadings(text, stats) {
  return [...text.matchAll(/[+-]?\d+(?:\.\d+)?\s*%/g)].map((match) => ({
    ...percentageReading(text, match.index, match.index + match[0].length, stats),
    start: match.index, value: Number(match[0].replace(/\s*%$/, '')),
  }));
}

export function statisticCompanyAt(text, position, stats) {
  return mentionsIn(text, stats).filter((mark) => mark.type === 'company' && mark.end <= position).at(-1)?.value ?? null;
}

// 한 조각에서 숫자 주장 꺼내기: [{ metric, year, value }], 해석할 수 없는 숫자는 problems에
function claimsIn(piece, stats, changeAllowed, problems, earlierYear, lineIsChange, context = '') {
  const claims = [];
  const hasNewSubject = (prefix) => /,\s*[^,.;\d]+(?:은|는)\s+[^,]*$/.test(prefix);
  let text = piece.replace(/증감률\s*순위\s*(\d+)\s*위/g, (_, rank) => {
    claims.push({ metric: 'changeRank', year: stats.to, value: Number(rank) });
    return ' ';
  });
  text = text.replace(ARROW, (_, y1, n1, y2, n2, offset, str) => {
    const laterSentence = /[.。]\s/.test(str.slice(0, offset));
    const newSubject = hasNewSubject(str.slice(0, offset));
    claims.push({ metric: 'count', year: y1 ? Number(y1) : stats.from, value: Number(n1), laterSentence, newSubject });
    claims.push({ metric: 'count', year: y2 ? Number(y2) : stats.to, value: Number(n2), laterSentence, newSubject });
    // 건수는 대조했지만, 뒤의 비중이 참조할 수 있도록 명시 연도는 남긴다.
    return [y1 && `${y1}년`, y2 && `${y2}년`].filter(Boolean).join(' ') + ' ';
  });
  // "전체 147건의 88%"는 분야의 비중과 회사 전체의 건수 두 주장이다.
  text = text.replace(/(?:회사\s*)?전체(?:\s*출원)?\s+(\d+)\s*건의\s*(\d+(?:\.\d+)?)\s*%/g,
    (whole, total, share, offset, str) => {
      const shareStart = offset + whole.lastIndexOf(share);
      const reading = percentageReading(str, shareStart, offset + whole.length, stats, { earlierYear, context });
      if (reading.metric !== 'share') { problems.push('분모 비중과 지표 표기가 충돌함'); return ' '.repeat(whole.length); }
      const year = reading.year;
      if (year === null) { problems.push('비중과 분모 건수의 연도가 충돌함'); return ' '.repeat(whole.length); }
      claims.push({ metric: 'count', year, value: Number(total), totalField: true });
      claims.push({ metric: 'share', year, value: Number(share) });
      return ' '.repeat(whole.length);
    });
  text = text.replace(/([+-]?\d+(?:\.\d+)?)\s*%/g, (whole, num, offset, str) => {
    const reading = percentageReading(str, offset, offset + whole.length, stats, { earlierYear, context, lineIsChange });
    const isShare = reading.metric === 'share';
    const isChange = reading.metric === 'change';
    if (!reading.metric) { problems.push('비중인지 증감률인지 알 수 없는 %'); return ' '; }
    if (isShare && reading.year === null) { problems.push('비중의 연도가 충돌함'); return ' '; }
    if (isChange && (!changeAllowed || reading.periodConflict || (reading.period && (reading.period[0] !== stats.from || reading.period[1] !== stats.to)))) {
      problems.push('증감률의 비교 기간에 대응하는 통계가 없음'); return ' ';
    }
    let value = Number(num);
    if (isChange && reading.decrease && !/^[+-]/.test(num)) value = -value;
    claims.push({ metric: reading.metric, year: isShare ? reading.year : stats.to, value });
    return ' ';
  });
  text = text.replace(/(\d{4})(?:\s*년)?\s*(?:[~–-]|부터)\s*(\d{4})\s*년(?:까지)?\s*(?:모든 해|모두|연간|매년|각)\s*(\d+)\s*건/g,
    (_, first, last, num) => {
      if (Number(first) < stats.from || Number(last) > stats.to || Number(first) > Number(last)) {
        problems.push('건수의 연도 범위가 자료와 다름');
      } else {
        for (let year = Number(first); year <= Number(last); year++) claims.push({ metric: 'count', year, value: Number(num) });
      }
      return ' ';
    });
  text = text.replace(/(\d+)\s*건/g, (whole, num, offset, str) => {
    const prefix = str.slice(0, offset);
    const yearMatch = [...prefix.matchAll(/(\d{4})\s*년/g)].at(-1);
    // 한 건수에 붙은 연도를 다음 건수에 재사용하지 않는다.
    const sinceYear = prefix.slice(yearMatch?.index ?? 0);
    const year = /\d+\s*건/.test(sinceYear) ? null : yearMatch ? Number(yearMatch[1]) : earlierYear;
    if (!year) { problems.push('건수의 연도를 알 수 없음'); return ' '; }
    claims.push({ metric: 'count', year, value: Number(num), laterSentence: /[.。]\s/.test(prefix), newSubject: hasNewSubject(prefix) });
    return ' ';
  });
  if (/\d/.test(text.replace(/\d{4}(?:\s*년)?\s*[~–-]\s*\d{4}\s*년/g, '').replace(/\d{4}\s*년/g, ''))) problems.push('지표나 단위가 불분명한 숫자');
  return claims;
}

function lookupStatistic(stats, company, field, year, metric) {
  if (metric === 'changeRank') {
    const ranked = stats.values.filter((v) => v.company === company && v.year === year
      && v.metric === 'change' && v.value !== null && stats.fields.includes(v.field))
      .sort((a, b) => b.value - a.value);
    const index = ranked.findIndex((v) => v.field === field);
    return index < 0 ? undefined : { value: index + 1 };
  }
  return stats.values.find((v) => v.company === company && v.field === field && v.year === year && v.metric === metric);
}

function normalizeCountYears(line, stats) {
  return line
    .replace(/(\d),(?=\d{3}(?!\d))/g, '$1')
    .replace(/(\d+)\s*건\s*\(\s*(\d{4})\s*년\s*(\)|,\s*)/g, (_, n, y, rest) => `${y}년 ${n}건${rest === ')' ? '' : '('}`)
    .replace(/첫\s*해\s+(\d+)\s*건\s*(?:→|->)\s*마지막\s*해\s+(\d+)\s*건/g,
      (_, first, last) => `${stats.from}년 ${first}건 → ${stats.to}년 ${last}건`)
    .replace(/(\d{4})\s*년\s*(?:과|와)\s*(\d{4})\s*년(?:은|는|도)?\s*(\d+)\s*건/g,
      (_, first, last, count) => `${first}년 ${count}건, ${last}년 ${count}건`)
    // 기간 합계가 0건이면 그 기간의 각 해도 0건이다.
    .replace(/(\d{4}\s*[~–-]\s*\d{4}\s*년)\s*0\s*건/g, '$1 각 0건')
    .replace(/각\s+(\d+\s*건(?:\s*,\s*\d+\s*건)+)/g, (text, list, offset, whole) => {
      const clause = whole.slice(0, offset).split(/[.!?。]\s/).at(-1);
      const range = [...clause.matchAll(/(\d{4})\s*[~–-]\s*(\d{4})\s*년/g)].at(-1);
      const counts = list.split(/\s*,\s*/);
      if (!range || Number(range[2]) - Number(range[1]) + 1 !== counts.length) return text;
      return counts.map((count, i) => `${Number(range[1]) + i}년 ${count}`).join(', ');
    })
    .replace(/(?:모든\s*해|연도별|전\s*분야(?:\s*출원)?|(?:회사\s*)?전체\s*건수[가는은는]?\s*모두)\s*0\s*건/g, (text, offset, whole) => {
      const before = whole.slice(0, offset);
      if (/\d{4}\s*[~–-]\s*\d{4}\s*년\s*$/.test(before) && !/전체\s*건수/.test(text)) return text; // 단순 기간 표현은 기존 검사 사용
      const clause = before.split(/[,。]|\.\s/).at(-1);
      const bound = clause.match(/(\d{4})\s*[~–-]\s*(\d{4})\s*년[^\d]*$/);
      if (bound) return `${bound[1]}~${bound[2]}년 각 0건`;
      const years = new Set([...whole.matchAll(/(\d{4})(?=\s*(?:년|[~–-]\s*\d{4}\s*년))/g)].map(([, year]) => Number(year)));
      if (years.size && (years.size !== 2 || !years.has(stats.from) || !years.has(stats.to))) return text;
      return `${stats.from}~${stats.to}년 모든 해 0건`;
    });
}

function separateComparison(line, stats) {
  // 앞의 "삼성:"은 칸 이름일 수 있다. 뒤에 직접 적힌 문장의 주어를 우선한다.
  const heading = line.match(/^\s*[-*]?\s*([^:\n]{1,20}):\s*/);
  if (heading && mentionsIn(heading[1], stats).some((m) => m.type === 'company')) {
    const after = line.slice(heading[0].length);
    if (mentionsIn(after, stats).some((m) => m.type === 'company' && m.idx === 0)) line = after;
  }
  // 괄호 속 비교 대상의 0건을 따로 대조한다. 괄호가 닫히면 본래 회사의 문장이 이어진다.
  const references = [];
  line = line.replace(/(자사|삼성|경쟁사|중국 경쟁사)\s*\((?:([^(),]+),\s*)?(?:전 분야|회사 전체)\s*0건\)\s*(?:와|과)\s*달리\s*/g,
    (whole, label, name, offset, text) => {
      const companies = (s) => new Set(mentionsIn(s, stats).filter((m) => m.type === 'company').map((m) => m.value));
      const before = companies(text.slice(0, offset));
      const comparison = companies(`${label} ${name ?? ''}`);
      if (before.size !== 1 || comparison.size !== 1 || before.has([...comparison][0])) return whole;
      references.push(`${label} ${name ?? ''} ${stats.from}~${stats.to}년 각 0건`);
      return ' ';
    });
  return [line, ...references];
}

const UNSTATED_OR_EXCLUDED = /확인\s*(?:되지\s*않|할\s*수\s*없|불가|못)|미확인|제외|누락|부재|미포함|아닌|(?:출원|건수|자료|근거|분야)(?:[이가은는도]\s*|\s+)(?:없|부족)|집계\s*대상(?:이\s*아니|에서\s*빠)/;
const STAT_METRIC = /\d\s*(?:건|%|위)|(?:→|->)\s*\d/;

/** 한 문장에서 주체와 수치가 모두 확인된 경우에만 시사점에 쓸 집계 주체를 돌려준다. */
export function verifiedStatisticSubject(raw, stats) {
  stats = withAggregateStatistics(stats);
  const line = raw.trim().replace(/^[-*]\s+/, '');
  if (/^\[|^\**해석\s*:|[.!?。！？;]\s+\S|\d{13}|반면|각각|보다|비교해/.test(line)
    || UNSTATED_OR_EXCLUDED.test(line)) return null;
  const mentions = mentionsIn(line, stats);
  const companies = [...new Set(mentions.filter((m) => m.type === 'company').map((m) => m.value))];
  const fields = [...new Set(mentions.filter((m) => m.type === 'field').map((m) => m.value))];
  if (companies.length > 1 || fields.length > 1 || !mentions.length) return null;
  const [company = null] = companies;
  const [field = null] = fields;
  // BOE 등 개별 기업의 숫자를 중국 경쟁사 합계로 검증하지 않는다.
  if (company === 'china' && !/중국/.test(line)) return null;
  const scope = field ?? stats.totalField ?? (stats.fields.length === 1 && stats.fields[0] === '전체' ? '전체' : null);
  if (!scope) return null;

  // 분류명 속 3D나 8.6세대처럼 정식 이름에 포함된 숫자는 통계 주장이 아니다.
  const masked = line.split('');
  for (const { idx, end } of mentions) masked.fill(' ', idx, end);
  const subjectEnd = Math.max(
    mentions.find((m) => m.type === 'company')?.end ?? 0,
    mentions.find((m) => m.type === 'field')?.end ?? 0,
  );
  const prefix = masked.slice(0, subjectEnd).join('');
  if (STAT_METRIC.test(prefix)) return null;
  if (!company && !/^(?:\s|\d{4}\s*년|전체|합계|합산|분야|[:：()·*])+$/u.test(prefix)) return null;
  const text = normalizeCountYears(masked.join(''), stats);
  const years = [...text.matchAll(/(\d{4})\s*년/g)].map((match) => Number(match[1]));
  const periodMatches = new Set(years).size === 2 && years.includes(stats.from) && years.includes(stats.to);
  const explicitChangePeriod = !years.length || periodMatches;
  const problems = [];
  const claims = claimsIn(text, stats, explicitChangePeriod, problems, null, false);
  if (!claims.length || problems.length || claims.some((claim) => claim.newSubject || claim.laterSentence)) return null;
  if (!claims.every(({ metric, year, value, totalField }) => {
    if (company) return lookupStatistic(stats, company, totalField ? stats.totalField : scope, year, metric)?.value === value;
    const aggregate = lookupStatistic(stats, 'all', scope, year, metric);
    if (aggregate) return aggregate.value !== null && aggregate.value === value;
    // 분야 단독은 회사별 건수가 모두 있는 경우에만 해당 분야의 합계로 확인한다.
    if (metric !== 'count') return false;
    const counts = Object.keys(ALIASES).map((key) => lookupStatistic(stats, key, scope, year, metric)?.value);
    return counts.every(Number.isInteger) && counts.reduce((sum, count) => sum + count, 0) === value;
  })) return null;
  return { company, field, claims, hasActivity: claims.some(({ metric, value }) => metric !== 'count' || value > 0) };
}

/** 소표본에 대한 단정은 검증된 건수만 남길 수 있을 때 바로잡는다. */
export function smallSampleTrendCounts(line, stats) {
  if (!stats.minimumSample || !/(?:증가|감소)\s*추세|상승세|하락세/.test(line)
    || /(?:단정|판단|해석).{0,12}(?:어렵|없|않|불가)|판단\s*근거\s*부족/.test(line)) return null;
  const subject = verifiedStatisticSubject(line, stats);
  if (!subject?.company) return null;
  const { company, field, claims } = subject;
  const sample = stats.values.filter((v) => v.company === company && v.field === (field ?? stats.totalField)
    && v.metric === 'count' && v.year >= stats.from && v.year <= stats.to);
  if (!sample.some(({ value }) => value < stats.minimumSample)) return null;
  const counts = new Map(claims.filter(({ metric, totalField }) => metric === 'count' && !totalField)
    .map(({ year, value }) => [year, value]));
  return counts.size ? { company, field, counts: [...counts].sort(([a], [b]) => a - b) } : null;
}

function* statisticLines(answer, stats) {
  let section = '';
  for (const raw of answer.split('\n')) {
    if (/^\s*##/.test(raw)) { section = raw; continue; }
    if (/한계|주목 특허/.test(section)) continue;
    for (const source of separateComparison(raw, stats)) yield { raw, source };
  }
}

export function checkStatistics(answer, stats) {
  stats = withAggregateStatistics(stats);
  const statMismatches = [];
  const statUnverified = [];
  const defaultField = stats.totalField ?? (stats.fields.length === 1 && stats.fields[0] === '전체' ? '전체' : null);
  for (const { raw, source } of statisticLines(answer, stats)) {
    const line = normalizeCountYears(source, stats)
      .replace(/\d{13}/g, '')
      .replace(/\d+\s*건\s*(?:미만|이상|이하|초과)/g, '')
      .replace(/중국\s*4\s*사/g, '중국')
      .replace(/자료 범위\s*\([^)]*\)/g, '');
    if (!/\d/.test(line.replace(/\d{4}\s*년/g, ''))) continue;

    const lineYears = [...line.matchAll(/(\d{4})(?=\s*(?:년|[~–-]\s*\d{4}\s*년))/g)].map((m) => Number(m[1]));
    // 증감률은 자료에서 늘 첫해 대비 마지막 해 값이다. "증가율·증가폭"이라고 쓴 줄도 그 값으로 본다
    const lineIsChange = /증가율|증가폭|감소율|감소폭|증감률/.test(line) && !/비중|점유율/.test(line);
    // 명시한 연도는 지표명이나 화살표보다 우선한다. 다른 기간을 요청 기간으로 대체하지 않는다.
    // 연도 없는 과거 응답은 기존 요청 기간으로 읽되, 출력 규칙 위반은 운영 기록에서 별도로 센다.
    const distinctYears = new Set(lineYears);
    const changeAllowed = distinctYears.size === 0 || (distinctYears.size === 2 && distinctYears.has(stats.from) && distinctYears.has(stats.to));
    const mentions = mentionsIn(line, stats);
    // "전극 … 2024년 자사 소자 출원 중 비중"에서 소자는 분모다.
    const denominatorMarks = new Set();
    mentions.forEach((mark, i) => {
      if (mark.type !== 'field' || mark.value !== defaultField) return;
      const next = mentions[i + 1];
      if (next?.type === 'field' && /^\s*$/.test(line.slice(mark.end, next.idx))) {
        denominatorMarks.add(mark);
        return;
      }
      if (!/^\s*(?:전체\s*)?출원\s*중\s*(?:비중|점유율)/.test(line.slice(mark.end))) return;
      const previousCompany = mentions.slice(0, i).findLast((m) => m.type === 'company');
      const previousField = mentions.slice(0, i).findLast((m) => m.type === 'field');
      if (!previousCompany || !previousField || previousField.value === defaultField) return;
      if (previousCompany.idx > previousField.idx) {
        const owner = mentions.slice(0, i).reverse().find((m) => m.type === 'company' && m.idx < previousField.idx);
        if (owner?.value !== previousCompany.value) return;
        denominatorMarks.add(previousCompany);
      }
      denominatorMarks.add(mark);
    });
    const marks = mentions.filter((m) => !denominatorMarks.has(m));
    const lineCompanies = new Set(marks.filter((m) => m.type === 'company').map((m) => m.value));
    const lineFields = new Set(marks.filter((m) => m.type === 'field').map((m) => m.value));
    const cuts = [0, ...marks.map((m) => m.idx), line.length];
    const problems = [];
    const mismatches = [];
    let company = null;
    let field = null;
    const pending = { company: new Set(), field: new Set() }; // 숫자 없이 나란히 나온 이름들

    for (let k = 0; k < cuts.length - 1; k++) {
      const mark = k > 0 ? marks[k - 1] : null;
      if (mark) pending[mark.type].add(mark.value);
      const start = mark ? mark.end : 0;
      let piece = line.slice(start, cuts[k + 1]);
      const comparisonEnd = piece.match(/\)\s*(?:와|과)\s*달리/);
      if (lineCompanies.size > 1 && comparisonEnd && STAT_METRIC.test(piece.slice(comparisonEnd.index + comparisonEnd[0].length))) {
        problems.push('괄호 뒤 숫자의 회사를 알 수 없음');
        piece = piece.slice(0, comparisonEnd.index + 1);
      }
      // "2022년 자사 소자 320건"처럼 연도가 이름보다 앞에 오면 줄 앞부분의 마지막 연도를 쓴다
      const preceding = line.slice(0, start).split(/\d+\s*건/).at(-1);
      const sameYearList = mark?.type === 'field' && !pending.company.size && /\d+\s*건\s*,\s*$/.test(line.slice(0, mark.idx));
      const yearContext = sameYearList ? line.slice(0, start).split(/[.!?。]\s/).at(-1) : preceding;
      const earlier = [...yearContext.matchAll(/(\d{4})\s*년/g)].at(-1);
      const claims = claimsIn(piece, stats, changeAllowed, problems, earlier ? Number(earlier[1]) : null, lineIsChange, line.slice(0, start));
      if (!claims.length) continue;
      const manyCompanies = pending.company.size > 1;
      const manyFields = pending.field.size > 1;
      // 모호해도 하나로 정해지는 쪽(분야 또는 회사)은 다음 조각을 위해 기억해 둔다
      if (pending.company.size === 1) company = [...pending.company][0];
      if (pending.field.size === 1) field = [...pending.field][0];
      const companyDirect = pending.company.size === 1;
      const fieldDirect = pending.field.size === 1;
      pending.company.clear();
      pending.field.clear();
      if (manyCompanies) { company = null; problems.push('누구의 숫자인지 모호함(회사 여럿)'); continue; }
      if (manyFields) { field = null; problems.push('어느 분야의 숫자인지 모호함(분야 여럿)'); continue; }
      const f = field ?? defaultField;
      // 회사가 줄 전체에 없고 분야가 명시된 독립 주장만 전체 회사 집계로 읽는다.
      // 여러 회사가 섞여 주체를 잃은 조각은 전체로 바꾸지 않는다.
      const claimCompany = company ?? (lineCompanies.size === 0 && field ? 'all' : null);
      if (!claimCompany || !f) { problems.push('회사나 분야를 알 수 없음'); continue; }
      // 회사·분야를 앞 조각에서 이어받았고 줄에 회사·분야가 여럿이면, 숫자가 달라도 짝을 잘못 지었을 수 있다
      // 예: "삼성: A 증가율(20%)이 자사(66%)보다 낮고, 봉지(-37%)는 감소" — 봉지는 삼성 숫자인데 바로 앞은 자사
      const carriedAmbiguous = (!companyDirect && lineCompanies.size > 1) || (!fieldDirect && lineFields.size > 1);
      for (const c of claims) {
        if (c.newSubject) { problems.push('새 문장 주제의 분야를 알 수 없음'); continue; }
        const fieldName = c.totalField ? defaultField : f;
        const fact = lookupStatistic(stats, claimCompany, fieldName, c.year, c.metric);
        if (!fact || fact.value === null) { problems.push(`대응 통계 없음(${fieldName} ${c.year}년)`); continue; }
        if (fact.value === c.value) continue;
        if (carriedAmbiguous || (c.laterSentence && lineCompanies.size > 1)) problems.push('누구의 숫자인지 확인 필요(앞 문장에서 이어받음)');
        else mismatches.push(`${claimCompany} / ${fieldName} / ${c.year} / ${c.metric}: 요약 ${c.value}, 통계 ${fact.value}`);
      }
    }
    if (!mismatches.length && problems.length && verifiedStatisticSubject(source, stats)) continue;
    for (const m of mismatches) statMismatches.push(`${m} — ${raw.trim()}`);
    if (problems.length) statUnverified.push(`${[...new Set(problems)].join(', ')}: ${raw.trim()}`);
  }
  return { statMismatches, statUnverified };
}
