import test from 'node:test';
import assert from 'node:assert/strict';

// Importing db initializes the schema; keep all test data in memory.
process.env.DB_PATH = ':memory:';
const { db } = await import('../src/db.js');
const { getSummaryStats } = await import('../src/summaryStats.js');
const { buildSummaryInput, generateTrendSummary, selectSummaryEvidence, SUMMARY_TASKS, splitSummaryPrompt, combineSummaryParts } = await import('../src/trendSummary.js');
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
  const { statText, facts, structuredStats } = buildSummaryInput(scope);
  assert.match(statText, /연도: 2020, 2021, 2022/);
  assert.match(statText, /자사\(LG디스플레이\): 165, 60, 210/);
  for (const field of fields) assert.ok(statText.includes(field));
  assert.ok(!statText.includes('그 외'));
  assert.ok(facts.includes('[구조화 통계:'));
  assert.ok(structuredStats.values.some((r) => r.company === 'own' && r.field === fields[0] && r.year === 2022 && r.metric === 'count' && r.value === 40));
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

test('다섯 3차 기술 각각에서 세 회사의 마지막 해 근거 특허를 선정한다', () => {
  for (const field of fields) {
    const selectedScope = { ...scope, level3: field };
    const { evidence } = buildSummaryInput(selectedScope);
    assert.deepEqual(evidence.map((e) => e.companyKey).sort(), [...companies].sort(), field);
    for (const item of evidence) {
      assert.equal(item.field, field);
      assert.match(item.reason, /^증감이 큰 분야/);
      assert.ok(item.reason.includes(field));
      assert.ok(item.date >= '2022-01-01' && item.date <= '2022-12-31');
      const row = db.prepare(`SELECT p.applicant_type, p.application_date, c.level1, c.level2, c.level3, c.is_primary, c.criteria_version
        FROM patents p JOIN classification c ON c.application_number = p.application_number WHERE p.application_number = ?`).get(item.number);
      assert.deepEqual(row, { applicant_type: item.companyKey, application_date: item.date, level1: 'OLED', level2: '설계', level3: field, is_primary: 1, criteria_version: CRITERIA_VERSION });
    }
  }
});

test('특허 검사에는 AI에게 전달한 300자 초록만 사용한다', () => {
  db.exec('SAVEPOINT abstract_test');
  try {
    db.prepare('UPDATE patents SET abstract = ? WHERE application_number IN (SELECT application_number FROM classification WHERE level2 = ? AND level3 = ?)')
      .run('가'.repeat(320) + '초록 뒤쪽 비공개 검사 문구', '설계', fields[0]);
    const { evidence, facts } = buildSummaryInput({ ...scope, level3: fields[0] });
    assert.ok(evidence.length);
    for (const item of evidence) {
      assert.equal(item.fullText, `${item.title} ${item.abstract}`);
      assert.equal(item.abstract.length, 300);
      assert.ok(!item.fullText.includes('초록 뒤쪽'));
      assert.ok(facts.includes(item.abstract));
    }
  } finally {
    db.exec('ROLLBACK TO abstract_test');
    db.exec('RELEASE abstract_test');
  }
});

test('급증 용어 후보는 다른 회사·분야·기간·분류 버전·부 분류를 제외하고 다음 후보를 선택한다', () => {
  add({ year: 2024, field: fields[0] });
  const selectedScope = { ...scope, level3: fields[0] };
  const lookup = db.prepare(`SELECT p.application_number number FROM patents p JOIN classification c ON c.application_number = p.application_number
    WHERE p.applicant_type = @company AND substr(p.application_date, 1, 4) = @year AND c.level1 = @level1
      AND c.level2 = @level2 AND c.level3 = @level3 AND c.is_primary = @primary AND c.criteria_version = @version LIMIT 1`);
  const find = (overrides = {}) => lookup.get({ company: 'own', year: '2020', level1: 'OLED', level2: '설계', level3: fields[0], primary: 1, version: CRITERIA_VERSION, ...overrides }).number;
  const valid = find();
  const invalid = [find({ company: 'competitor' }), find({ level3: fields[1] }), find({ year: '2019' }), find({ year: '2024' }),
    find({ level1: 'LCD' }), find({ primary: 0 }), find({ version: 'old' })];
  const data = getSummaryStats(db, selectedScope, CRITERIA_VERSION);
  const bursts = { own: [{ term: '검증 용어', examples: [...invalid, valid] }], competitor: [], china: [] };
  const evidence = selectSummaryEvidence({ scope: selectedScope, from: 2020, to: 2022, data, bursts });
  assert.equal(evidence.find((e) => e.reason.startsWith('급증 용어'))?.number, valid);
  assert.ok(invalid.every((number) => !evidence.some((e) => e.number === number)));
});

test('2차 기술 분야와 전체 범위에서도 후보의 회사와 기간을 지킨다', () => {
  for (const selectedScope of [{ level2: '설계' }, {}]) {
    const { evidence } = buildSummaryInput({ ...selectedScope, from: 2020, to: 2022 });
    assert.ok(evidence.length > 0);
    for (const item of evidence) {
      const row = db.prepare(`SELECT p.applicant_type, p.application_date, c.level2 FROM patents p
        JOIN classification c ON c.application_number = p.application_number AND c.is_primary = 1 AND c.criteria_version = ?
        WHERE p.application_number = ?`).get(CRITERIA_VERSION, item.number);
      assert.equal(row.applicant_type, item.companyKey);
      assert.ok(row.application_date >= '2020-01-01' && row.application_date <= '2022-12-31');
      if (selectedScope.level2) assert.equal(row.level2, selectedScope.level2);
    }
  }
});

test('범위에 맞는 근거가 없으면 다른 분야의 특허를 사용하지 않는다', () => {
  const selectedScope = { ...scope, level3: '존재하지 않는 기술' };
  const data = getSummaryStats(db, selectedScope, CRITERIA_VERSION);
  const other = db.prepare('SELECT application_number number FROM patents LIMIT 1').get().number;
  const bursts = { own: [{ term: '검증 용어', examples: [other] }], competitor: [], china: [] };
  assert.deepEqual(selectSummaryEvidence({ scope: selectedScope, from: 2020, to: 2022, data, bursts }), []);
});

test('요청 버전 주 분류가 없으면 다른 버전이 있어도 명확히 거부한다', () => {
  assert.throws(() => getSummaryStats(db, scope, 'v999'), (error) => {
    assert.equal(error.code, 'SUMMARY_CLASSIFICATION_VERSION_MISSING');
    assert.match(error.message, /v999/);
    assert.ok(error.message.includes(CRITERIA_VERSION));
    return true;
  });
});

test('분류 데이터가 전혀 없거나 부 분류만 있으면 주 분류 없음으로 거부한다', () => {
  db.exec('SAVEPOINT classification_test');
  try {
    db.prepare('DELETE FROM classification').run();
    assert.throws(() => getSummaryStats(db, scope, CRITERIA_VERSION), /DB에 있는 주 분류 기준: 없음/);
    add({ primary: 0 });
    assert.throws(() => getSummaryStats(db, scope, CRITERIA_VERSION), /주 분류 데이터가 없습니다/);
  } finally {
    db.exec('ROLLBACK TO classification_test');
    db.exec('RELEASE classification_test');
  }
});

test('유효한 버전에서 선택한 조건에 출원이 없으면 버전 오류가 아닌 0건으로 표시한다', () => {
  const emptyScope = { ...scope, level3: '존재하지 않는 기술' };
  const result = getSummaryStats(db, emptyScope, CRITERIA_VERSION);
  assert.equal(result.noMatches, true);
  assert.ok(result.totals.every((row) => row.counts.every((n) => n === 0)));
  assert.match(buildSummaryInput(emptyScope).statText, /선택한 범위·기간에 해당 분류 기준으로 분류된 출원이 없습니다/);
  assert.equal(stats().noMatches, false);
});

test('기존 30건 주의 기준을 분야·회사·연도에 적용하고 양 끝 중 하나가 적으면 증감률을 생략한다', () => {
  const chosen = buildSummaryInput({ ...scope, level3: fields[0] });
  assert.ok(chosen.dataWarnings.some((w) => w.includes('2021년 10건')));
  assert.match(chosen.statText, /집계 기준 차이: 출원 건수/);
  assert.match(chosen.statText, /초록 앞 200자 기준 중복 제거/);
  const result = getSummaryStats(db, { ...scope, level3: fields[0], from: 2020, to: 2021 }, CRITERIA_VERSION);
  const row = result.table.find((r) => r.company === 'own');
  assert.deepEqual(row.counts, [30, 10]);
  assert.equal(row.change, null);
});

test('버전 불일치 시 AI 요청과 요약 저장 전에 생성을 중단한다', async () => {
  const originalFetch = globalThis.fetch;
  const oldBase = process.env.AI_BASE_URL;
  const oldModel = process.env.AI_MODEL;
  let called = false;
  process.env.AI_BASE_URL = 'https://example.invalid';
  process.env.AI_MODEL = 'test';
  globalThis.fetch = () => { called = true; throw new Error('unexpected AI request'); };
  db.exec('SAVEPOINT version_test');
  const before = db.prepare('SELECT COUNT(*) n FROM trend_summaries').get().n;
  try {
    db.prepare('UPDATE classification SET criteria_version = ? WHERE is_primary = 1').run('v0.1');
    await assert.rejects(generateTrendSummary(scope), (error) => {
      assert.equal(error.code, 'SUMMARY_CLASSIFICATION_VERSION_MISSING');
      assert.match(error.message, /v0\.1/);
      return true;
    });
    assert.equal(called, false);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM trend_summaries').get().n, before);
  } finally {
    db.exec('ROLLBACK TO version_test');
    db.exec('RELEASE version_test');
    globalThis.fetch = originalFetch;
    if (oldBase === undefined) delete process.env.AI_BASE_URL; else process.env.AI_BASE_URL = oldBase;
    if (oldModel === undefined) delete process.env.AI_MODEL; else process.env.AI_MODEL = oldModel;
  }
});

test('선택한 범위에 분류된 특허가 없으면 AI를 부르지 않고 저장도 하지 않는다', async () => {
  const originalFetch = globalThis.fetch;
  const oldBase = process.env.AI_BASE_URL;
  const oldModel = process.env.AI_MODEL;
  let called = false;
  process.env.AI_BASE_URL = 'https://example.invalid';
  process.env.AI_MODEL = 'test';
  globalThis.fetch = () => { called = true; throw new Error('unexpected AI request'); };
  const before = db.prepare('SELECT COUNT(*) n FROM trend_summaries').get().n;
  try {
    await assert.rejects(generateTrendSummary({ ...scope, level3: '존재하지 않는 기술' }), (error) => {
      assert.equal(error.status, 422);
      assert.match(error.message, /분류된 특허가 없어/);
      return true;
    });
    assert.equal(called, false);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM trend_summaries').get().n, before);
  } finally {
    globalThis.fetch = originalFetch;
    if (oldBase === undefined) delete process.env.AI_BASE_URL; else process.env.AI_BASE_URL = oldBase;
    if (oldModel === undefined) delete process.env.AI_MODEL; else process.env.AI_MODEL = oldModel;
  }
});

test('각 프롬프트는 담당 항목만 요청하고 수치 정확성 규칙을 유지한다', () => {
  const prompts = splitSummaryPrompt();
  assert.equal(prompts.length, 4);
  prompts.forEach((prompt, i) => {
    assert.match(prompt, /담당 범위:/);
    assert.match(prompt, /다른 항목의 제목·내용/);
    assert.deepEqual([...prompt.matchAll(/^## (.+)$/gm)].map((m) => m[1].replace(/ \(3줄\)$/, '')), SUMMARY_TASKS[i]);
    assert.match(prompt, /비중·차이·합계·배율을 새로 계산하지 않는다/);
    assert.match(prompt, /한 문장에는 한 회사와 한 분야/);
    assert.match(prompt, /30건 미만/);
  });
  assert.doesNotMatch(prompts.slice(0, 3).join('\n'), /시사점에는 새 숫자|주목 특허.*4~5건/);
  assert.doesNotMatch(prompts[3], /핵심 흐름은 정확히 3줄|칸에는 첫해보다/);
  assert.deepEqual(SUMMARY_TASKS.flat(), ['핵심 메시지', '핵심 흐름', '성장 분야', '경쟁사 동향', '주목 특허', '시사점', '한계']);
});

test('네 응답은 지정된 기존 항목만 기존 순서로 조합한다', () => {
  const answers = SUMMARY_TASKS.map((names) => names.map((name) => `## ${name}\n- ${name}`).join('\n'));
  answers[1] += '\n## 주목 특허\n- 원치 않는 항목';
  const answer = combineSummaryParts(answers);
  assert.deepEqual([...answer.matchAll(/^## (.+)$/gm)].map((m) => m[1]), SUMMARY_TASKS.flat());
  assert.doesNotMatch(answer, /원치 않는 항목/);
});

test('요약 생성 시 구조화 통계를 전달하고 수치 검사와 최종 저장 길이를 기록한다', async () => {
  const originalFetch = globalThis.fetch;
  const oldBase = process.env.AI_BASE_URL;
  const oldModel = process.env.AI_MODEL;
  const sent = [];
  process.env.AI_BASE_URL = 'https://example.invalid';
  process.env.AI_MODEL = 'test';
  globalThis.fetch = async (_url, options) => {
    sent.push(JSON.parse(options.body));
    const longLimitation = '가'.repeat(1650);
    return { ok: true, json: async () => ({ choices: [{ message: { content: `## 핵심 흐름\n- 자사 ${fields[0]} 2022년 41건\n## 성장 분야\n## 경쟁사 동향\n## 주목 특허\n## 한계\n- ${longLimitation}` } }] }) };
  };
  db.exec('SAVEPOINT generation_test');
  try {
    const result = await generateTrendSummary(scope);
    assert.equal(sent.length, 4);
    assert.ok(sent.every((request) => request.messages[1].content.includes('[구조화 통계:')));
    assert.match(sent[3].messages[1].content, /\[앞 칸\][\s\S]*## 핵심 흐름/);
    assert.equal(result.checks.statMismatches.length, 1);
    assert.equal(result.checks.statUnverified.length, 0);
    assert.ok(result.checks.dataWarnings.length);
    assert.match(result.content, /30건은 기존 주의 기준/);
    assert.match(result.content, /급증 용어는 유사 초록 중복 제거/);
    assert.ok(result.content.length > 1800);
    assert.ok(result.checks.formatIssues.includes(`최종 요약 ${result.content.length}자 (1,800자 이하여야 함)`));
  } finally {
    db.exec('ROLLBACK TO generation_test');
    db.exec('RELEASE generation_test');
    globalThis.fetch = originalFetch;
    if (oldBase === undefined) delete process.env.AI_BASE_URL; else process.env.AI_BASE_URL = oldBase;
    if (oldModel === undefined) delete process.env.AI_MODEL; else process.env.AI_MODEL = oldModel;
  }
});
