// Only assert a match when company, field, year and metric can be resolved.
// Ambiguous prose is reported for review, never silently treated as verified.
export function checkStatistics(answer, stats) {
  const statMismatches = [];
  const statUnverified = [];
  const aliases = {
    own: /자사|LG(?:디스플레이)?/i,
    competitor: /삼성(?:디스플레이)?|(?<!중국\s)경쟁사/,
    china: /중국|BOE|CSOT|Tianma|Visionox/i,
  };
  let section = '';
  for (const raw of answer.split('\n')) {
    if (/^\s*##/.test(raw)) { section = raw; continue; }
    if (/한계/.test(section)) continue;
    const line = raw.replace(/\d{13}/g, '').replace(/(\d),(?=\d{3}(?!\d))/g, '$1');
    const otherNumbers = line.replace(/\d{4}\s*년/g, '').replace(/[+-]?\d+(?:\.\d+)?\s*(?:건|%)/g, '').replace(/중국\s*4\s*사/g, '');
    if (/\d/.test(otherNumbers)) statUnverified.push(`지표나 단위가 불분명한 숫자: ${raw.trim()}`);
    if (!/\d\s*(?:건|%)/.test(line)) continue;
    const companies = Object.keys(aliases).filter((key) => aliases[key].test(line));
    const fields = stats.fields.filter((field) => field !== '전체' && line.includes(field));
    const selected = fields.length === 0 && stats.fields.length === 1 && stats.fields[0] === '전체'
      ? ['전체'] : fields;
    const years = [...line.matchAll(/(\d{4})\s*년/g)].map((m) => Number(m[1]));
    const claims = [...line.matchAll(/([+-]?\d+(?:\.\d+)?)\s*(건|%)/g)];
    if (companies.length !== 1 || selected.length !== 1 || !years.length) {
      statUnverified.push(`회사·분야·연도를 특정할 수 없음: ${raw.trim()}`);
      continue;
    }
    const [company] = companies;
    const [field] = selected;
    for (const claim of claims) {
      const before = line.slice(0, claim.index);
      const after = line.slice(claim.index + claim[0].length);
      const nearby = `${before.slice(-12)} ${after.slice(0, 12)}`;
      const yearMatches = [...before.matchAll(/(\d{4})\s*년/g)];
      const year = yearMatches.length ? Number(yearMatches.at(-1)[1]) : null;
      let metric = 'count';
      let value = Number(claim[1]);
      if (claim[2] === '%') {
        const isShare = /비중|점유율/.test(nearby);
        const isChange = /증가|상승|늘|감소|하락|줄|증감|변화율/.test(nearby);
        if (isShare === isChange) { statUnverified.push(`비중 또는 증감률을 구별할 수 없음: ${raw.trim()}`); continue; }
        metric = isShare ? 'share' : 'change';
        if (metric === 'change' && /감소|하락|줄/.test(nearby) && !/^[+-]/.test(claim[1])) value = -value;
      }
      // Change is always first-to-last; explicit comparison years must match.
      if (metric === 'change' && (years.length < 2 || years[0] !== stats.from || years.at(-1) !== stats.to || year !== stats.to)) {
        statUnverified.push(`증감률의 비교 기간을 확인해야 함: ${raw.trim()}`); continue;
      }
      if (year === null) { statUnverified.push(`수치의 연도를 확인해야 함: ${raw.trim()}`); continue; }
      const fact = stats.values.find((item) => item.company === company && item.field === field && item.year === year && item.metric === metric);
      if (!fact || fact.value === null) { statUnverified.push(`대응 통계가 없거나 계산되지 않음: ${raw.trim()}`); continue; }
      if (fact.value !== value) statMismatches.push(`${company} / ${field} / ${year} / ${metric}: 요약 ${value}, 통계 ${fact.value} — ${raw.trim()}`);
    }
  }
  return { statMismatches, statUnverified };
}
