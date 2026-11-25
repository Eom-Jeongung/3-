// 검사용 전체 집계. 전체는 선택 범위의 own·competitor·china 합계이며 시장 전체가 아니다.
// 비중의 분모: 회사+전체는 모든 회사의 범위 전체, 전체+분야는 모든 회사의 범위 전체.
// 기존 회사+분야 비중(해당 회사 전체 대비)은 변경하지 않는다.
export function withAggregateStatistics(stats) {
  const total = stats.totalField ?? (stats.fields.length === 1 && stats.fields[0] === '전체' ? '전체' : null);
  if (!total) return stats;
  const companies = ['own', 'competitor', 'china'];
  const values = [...stats.values];
  const key = ({ company, field, year, metric }) => JSON.stringify([company, field, year, metric]);
  const index = new Map(values.map((row) => [key(row), row]));
  const count = (company, field, year) => index.get(key({ company, field, year, metric: 'count' }))?.value;
  const add = (row) => {
    if (!index.has(key(row))) { index.set(key(row), row); values.push(row); }
  };
  const fields = [...new Set([...stats.fields.filter((field) => field !== '전체'), total])];
  for (let year = stats.from; year <= stats.to; year++) {
    for (const field of fields) {
      const counts = companies.map((company) => count(company, field, year));
      // 누락된 회사를 0건으로 가정하지 않는다. 확인된 0건도 명시된 행이 필요하다.
      if (counts.every(Number.isInteger)) add({ company: 'all', field, year, metric: 'count', value: counts.reduce((a, b) => a + b, 0) });
    }
  }
  const denominator = count('all', total, stats.to);
  const aggregates = [...companies.map((company) => ({ company, field: total })),
    ...fields.filter((field) => field !== total).map((field) => ({ company: 'all', field }))];
  for (const { company, field } of aggregates) {
    const first = count(company, field, stats.from);
    const last = count(company, field, stats.to);
    if (Number.isInteger(last) && Number.isInteger(denominator) && denominator > 0) {
      add({ company, field, year: stats.to, metric: 'share', value: Math.round(last / denominator * 100) });
    }
    if (Number.isInteger(first) && Number.isInteger(last)) {
      const minimum = stats.minimumSample ?? 30;
      add({ company, field, year: stats.to, metric: 'change',
        value: first >= minimum && last >= minimum ? Math.round((last - first) / first * 100) : null });
    }
  }
  return { ...stats, values };
}
