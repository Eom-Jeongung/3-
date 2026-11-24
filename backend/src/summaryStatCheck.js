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

// 한 조각에서 숫자 주장 꺼내기: [{ metric, year, value }], 해석할 수 없는 숫자는 problems에
function claimsIn(piece, stats, changeAllowed, problems, earlierYear, lineIsChange) {
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
    return ' ';
  });
  text = text.replace(/([+-]?\d+(?:\.\d+)?)\s*%/g, (whole, num, offset, str) => {
    const before = str.slice(0, offset).split(/[,。]|\.\s/).at(-1);
    const after = str.slice(offset + whole.length).split(/[,。]|\.\s/)[0];
    const nearby = `${before.slice(-18)} ${after.slice(0, 12)}`;
    const isShare = /비중|점유율|회사 전체 대비/.test(nearby);
    // "증가율(20%)이 자사(66%)보다"처럼 바로 옆에 말이 없어도, 줄이 증감률 이야기면 증감률로 본다
    const isChange = !isShare && (/^[+-]/.test(num) || /증가|상승|늘|감소|하락|줄|증감|변화율/.test(nearby) || lineIsChange);
    if (isShare === isChange) { problems.push('비중인지 증감률인지 알 수 없는 %'); return ' '; }
    if (isChange && !changeAllowed) { problems.push('증감률의 비교 기간을 알 수 없음'); return ' '; }
    let value = Number(num);
    if (isChange && /감소|하락|줄/.test(nearby) && !/^[+-]/.test(num)) value = -value;
    const shareYear = [...before.matchAll(/(\d{4})\s*년/g)].at(-1);
    claims.push({ metric: isShare ? 'share' : 'change', year: isShare && shareYear ? Number(shareYear[1]) : stats.to, value });
    return ' ';
  });
  text = text.replace(/(\d{4})(?:\s*년)?\s*(?:[~–-]|부터)\s*(\d{4})\s*년(?:까지)?\s*(?:모든 해|모두|연간|매년)\s*(\d+)\s*건/g,
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
  if (/\d/.test(text.replace(/\d{4}\s*년/g, ''))) problems.push('지표나 단위가 불분명한 숫자');
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

const normalizeCountYears = (line) => line
  .replace(/(\d),(?=\d{3}(?!\d))/g, '$1')
  .replace(/(\d+)\s*건\s*\(\s*(\d{4})\s*년\s*(\)|,\s*)/g, (_, n, y, rest) => `${y}년 ${n}건${rest === ')' ? '' : '('}`);

const UNSTATED_OR_EXCLUDED = /확인\s*(?:되지\s*않|할\s*수\s*없|불가|못)|미확인|제외|누락|부재|미포함|아닌|(?:출원|건수|자료|근거|분야)(?:[이가은는도]\s*|\s+)(?:없|부족)|집계\s*대상(?:이\s*아니|에서\s*빠)/;
const STAT_METRIC = /\d\s*(?:건|%|위)|(?:→|->)\s*\d/;

/** 한 문장에서 주체와 수치가 모두 확인된 경우에만 시사점에 쓸 집계 주체를 돌려준다. */
export function verifiedStatisticSubject(raw, stats) {
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
  const text = normalizeCountYears(masked.join(''));
  const years = [...text.matchAll(/(\d{4})\s*년/g)].map((match) => Number(match[1]));
  const periodMatches = new Set(years).size === 2 && years.includes(stats.from) && years.includes(stats.to);
  const explicitChangePeriod = !years.length || periodMatches;
  const problems = [];
  const claims = claimsIn(text, stats, explicitChangePeriod, problems, null, false);
  if (!claims.length || problems.length || claims.some((claim) => claim.newSubject || claim.laterSentence)) return null;
  if (!claims.every(({ metric, year, value }) => {
    if (company) return lookupStatistic(stats, company, scope, year, metric)?.value === value;
    // 분야 단독은 회사별 건수가 모두 있는 경우에만 해당 분야의 합계로 확인한다.
    if (metric !== 'count') return false;
    const counts = Object.keys(ALIASES).map((key) => lookupStatistic(stats, key, scope, year, metric)?.value);
    return counts.every(Number.isInteger) && counts.reduce((sum, count) => sum + count, 0) === value;
  })) return null;
  return { company, field, hasActivity: claims.some(({ metric, value }) => metric !== 'count' || value > 0) };
}

export function checkStatistics(answer, stats) {
  const statMismatches = [];
  const statUnverified = [];
  const defaultField = stats.totalField ?? (stats.fields.length === 1 && stats.fields[0] === '전체' ? '전체' : null);

  let section = '';
  for (const raw of answer.split('\n')) {
    if (/^\s*##/.test(raw)) { section = raw; continue; }
    if (/한계|주목 특허/.test(section)) continue;
    const line = normalizeCountYears(raw
      .replace(/\d{13}/g, '')
      .replace(/\d+\s*건\s*(?:미만|이상|이하|초과)/g, '')
      .replace(/중국\s*4\s*사/g, '중국')
      .replace(/자료 범위\s*\([^)]*\)/g, '')
      .replace(/\d{4}\s*[~–-]\s*\d{4}\s*년(?!\s*(?:모든 해|모두|연간|매년)\s*\d+\s*건)/g, '')
    );
    if (!/\d/.test(line.replace(/\d{4}\s*년/g, ''))) continue;

    const lineYears = [...line.matchAll(/(\d{4})\s*년/g)].map((m) => Number(m[1]));
    // 증감률은 자료에서 늘 첫해 대비 마지막 해 값이다. "증가율·증가폭"이라고 쓴 줄도 그 값으로 본다
    const lineIsChange = /증가율|증가폭|감소율|감소폭|증감률/.test(line) && !/비중|점유율/.test(line);
    // 연도를 하나도 적지 않은 "자사 출원이 31% 증가" 같은 줄도 자료의 증감률(첫해 대비 마지막 해)로 본다.
    // 연도를 하나만 적은 "2022년 50% 증가"처럼 기간이 어긋날 수 있는 줄만 확인 불가로 남긴다
    const changeAllowed = lineIsChange || lineYears.length === 0 || /\d\s*건?\s*(?:→|->)\s*(?:\d{4}\s*년\s*)?\d/.test(line) || (lineYears.includes(stats.from) && lineYears.includes(stats.to));
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
      const piece = line.slice(start, cuts[k + 1]);
      // "2022년 자사 소자 320건"처럼 연도가 이름보다 앞에 오면 줄 앞부분의 마지막 연도를 쓴다
      const preceding = line.slice(0, start).split(/\d+\s*건/).at(-1);
      const earlier = [...preceding.matchAll(/(\d{4})\s*년/g)].at(-1);
      const claims = claimsIn(piece, stats, changeAllowed, problems, earlier ? Number(earlier[1]) : null, lineIsChange);
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
      if (!company || !f) { problems.push('회사나 분야를 알 수 없음'); continue; }
      // 회사·분야를 앞 조각에서 이어받았고 줄에 회사·분야가 여럿이면, 숫자가 달라도 짝을 잘못 지었을 수 있다
      // 예: "삼성: A 증가율(20%)이 자사(66%)보다 낮고, 봉지(-37%)는 감소" — 봉지는 삼성 숫자인데 바로 앞은 자사
      const carriedAmbiguous = (!companyDirect && lineCompanies.size > 1) || (!fieldDirect && lineFields.size > 1);
      for (const c of claims) {
        if (c.newSubject) { problems.push('새 문장 주제의 분야를 알 수 없음'); continue; }
        const fact = lookupStatistic(stats, company, f, c.year, c.metric);
        if (!fact || fact.value === null) { problems.push(`대응 통계 없음(${f} ${c.year}년)`); continue; }
        if (fact.value === c.value) continue;
        if (carriedAmbiguous || (c.laterSentence && lineCompanies.size > 1)) problems.push('누구의 숫자인지 확인 필요(앞 문장에서 이어받음)');
        else mismatches.push(`${company} / ${f} / ${c.year} / ${c.metric}: 요약 ${c.value}, 통계 ${fact.value}`);
      }
    }
    if (!mismatches.length && problems.length && verifiedStatisticSubject(raw, stats)) continue;
    for (const m of mismatches) statMismatches.push(`${m} — ${raw.trim()}`);
    if (problems.length) statUnverified.push(`${[...new Set(problems)].join(', ')}: ${raw.trim()}`);
  }
  return { statMismatches, statUnverified };
}
