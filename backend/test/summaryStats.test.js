import test from 'node:test';
import assert from 'node:assert/strict';

// Importing db initializes the schema; keep all test data in memory.
process.env.DB_PATH = ':memory:';
const { db } = await import('../src/db.js');
const { getSummaryStats } = await import('../src/summaryStats.js');
const { buildSummaryInput } = await import('../src/trendSummary.js');
const { CRITERIA_VERSION } = await import('../src/classification.js');

const fields = ['화소 배열·레이아웃', '패널 구조 설계', '마이크로렌즈·광추출 구조', '마이크로LED 어레이 구조', '터치·센서'];
const companies = ['own', 'competitor', 'china'];
let id = 0;
const patent = db.prepare(`INSERT INTO patents (application_number, applicant_name, applicant_type, title, application_date, open_date, legal_status, last_synced_at)
  VALUES (@number, 'test', @company, 'test', @date, '2025-12-31', '공개', '2025-12-31')`);
const classification = db.prepare(`INSERT INTO classification (application_number, level1, level2, level3, is_primary, basis, criteria_version)
  VALUES (@number, @level1, @level2, @level3, @primary, 'test', @version)`);
function add({ company = 'own', year = 2020, field = fields[0], level1 = 'OLED', level2 = '설계', primary = 1, version = CRITERIA_VERSION }) {
  const number = String(++id).padStart(13, '0');
  patent.run({ number, company, date: `${year}-06-01` });
  classification.run({ number, level1, level2, level3: field, primary, version });
}
db.transaction(() => {
  companies.forEach((company, c) => fields.forEach((field, f) => {
    for (const [year, count] of [[2020, 30 + c + f], [2021, 10 + c + f], [2022, 40 + c + f]]) {
      for (let i = 0; i < count; i++) add({ company, field, year });
    }
  }));
  // More than eight groups catches accidental reuse of the chart's 'other' bucket.
  for (let i = 0; i < 5; i++) add({ field: `추가 분야 ${i}` });
  add({ field: fields[0], year: 2019 });
  add({ field: fields[0], year: 2024, level2: '공정' });
  add({ field: fields[0], year: 2020, primary: 0 });
  add({ field: fields[0], year: 2020, version: 'old' });
  add({ field: fields[0], year: 2020, level1: 'LCD' });
})();

const scope = { level1: 'OLED', level2: '설계', from: 2020, to: 2022 };
const stats = () => getSummaryStats(db, scope, CRITERIA_VERSION);

test('설계 세부 기술별 회사·연도별 건수와 합계, 비중, 증감률', () => {
  const result = stats();
  assert.deepEqual(result.periods.map((p) => p.key), ['2020', '2021', '2022']);
  assert.equal(result.groupLevel, 'level3');
  companies.forEach((company, c) => {
    const total = result.totals.find((r) => r.company === company);
    assert.deepEqual(total.counts, [160 + 5 * c + (c === 0 ? 5 : 0), 60 + 5 * c, 210 + 5 * c]);
    assert.equal(total.change, Math.round((total.counts[2] - total.counts[0]) / total.counts[0] * 100));
    fields.forEach((field, f) => {
      const row = result.table.find((r) => r.company === company && r.group === field);
      assert.deepEqual(row.counts, [30 + c + f, 10 + c + f, 40 + c + f]);
      assert.equal(row.change, Math.round(10 / (30 + c + f) * 100));
      assert.equal(row.share, Math.round((40 + c + f) / total.counts[2] * 100));
    });
  });
});

test('모든 분야를 유지하고 그 외로 합치지 않는다', () => {
  const result = stats();
  assert.equal(result.groups.length, 10);
  for (const field of fields) assert.ok(result.groups.includes(field));
  assert.ok(!result.groups.includes('그 외'));
});

test('실제 요약 입력에 요청 기간과 각 분야가 반영된다', () => {
  const { statText } = buildSummaryInput(scope);
  assert.match(statText, /연도: 2020, 2021, 2022/);
  assert.match(statText, /자사\(LG디스플레이\): 165, 60, 210/);
  for (const field of fields) assert.ok(statText.includes(field));
  assert.ok(!statText.includes('그 외'));
});

test('빈 연도는 0으로 유지하고 소수 표본의 증감률은 계산하지 않는다', () => {
  const result = getSummaryStats(db, { ...scope, level3: fields[0], from: 2019, to: 2022 }, CRITERIA_VERSION);
  const row = result.table.find((r) => r.company === 'competitor');
  assert.deepEqual(row.counts, [0, 31, 11, 41]);
  assert.equal(row.change, null);
  assert.equal(row.group, '전체');
});

test('DB에 없는 마지막 연도와 유효하지 않은 기간은 거부한다', () => {
  assert.throws(() => getSummaryStats(db, { ...scope, to: 2025 }, CRITERIA_VERSION), /마지막 연도/);
  assert.throws(() => getSummaryStats(db, { ...scope, to: 2020 }, CRITERIA_VERSION), /period/);
});
