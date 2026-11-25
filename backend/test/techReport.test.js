import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
const { db } = await import('../src/db.js');
const { splitPeriods, parseJsonAnswer, checkStatement, checkPatentAnalysis, missingTerms, unsupportedEffects, latestTechReport, listTechReports } = await import('../src/techReport.js');

test('원문에 없는 용어 찾기: 띄어쓰기·대소문자는 무시하고, 없는 영어 약어는 걸린다', () => {
  const source = '제1 발광 스택과 제2 발광스택 사이에 전하 생성층을 둔다. OLED';
  assert.deepEqual(missingTerms(['발광 스택', '전하생성층', 'oled'], source), []);
  assert.deepEqual(missingTerms(['2-Stack Tandem', '전하생성층'], source), ['2-Stack Tandem']);
  // 조사를 줄인 말은 통과
  assert.deepEqual(missingTerms(['개구 직경', '곡률 모서리'], '제1 개구의 직경은 … 소정의 곡률을 갖는 모서리'), []);
});

test('제목의 목적·효과 말은 근거 원문에 있어야 한다', () => {
  assert.deepEqual(unsupportedEffects('광학층 배치로 신뢰성 확보', '봉지 부재 위에 광학 부재를 배치'), ['신뢰성']);
  assert.deepEqual(unsupportedEffects('측면 투습 방지로 신뢰성 확보', '투습을 방지해 박막 트랜지스터의 신뢰성을 향상'), []);
});

test('기간 나누기: 4년 이하는 1년씩', () => {
  assert.deepEqual(splitPeriods(2022, 2024).map((p) => p.label), ['2022년', '2023년', '2024년']);
  assert.equal(splitPeriods(2021, 2024).length, 4);
});

test('기간 나누기: 5년 이상은 3묶음, 남는 해는 앞 묶음부터', () => {
  assert.deepEqual(splitPeriods(2018, 2024).map((p) => p.label), ['2018~2020년', '2021~2022년', '2023~2024년']);
  assert.deepEqual(splitPeriods(2020, 2024).map((p) => p.label), ['2020~2021년', '2022~2023년', '2024년']);
  const p = splitPeriods(2010, 2024);
  assert.equal(p[0].from, 2010);
  assert.equal(p.at(-1).to, 2024);
  assert.ok(p.every((x, i) => i === 0 || x.from === p[i - 1].to + 1));
});

test('JSON 읽기: 코드 블록·앞뒤 설명이 붙어도 읽는다', () => {
  assert.deepEqual(parseJsonAnswer('```json\n[{"no":1}]\n```'), [{ no: 1 }]);
  assert.deepEqual(parseJsonAnswer('결과입니다.\n{"headline":"a"}\n끝'), { headline: 'a' });
  assert.throws(() => parseJsonAnswer('JSON이 없어요'));
  assert.throws(() => parseJsonAnswer('{"a": '));
});

test('문장 검사: 자료에 없는 숫자, 단정 표현, 다른 시기의 근거 번호', () => {
  const allowedNumbers = new Set(['2022', '120']);
  assert.deepEqual(checkStatement('2022년 120건으로 봉지 기술이 늘었다 [3]', { allowedNumbers, refs: [3], allowedRefs: new Set([3]) }), []);
  const r = checkStatement('2022년 150건으로 시장을 선점했다', { allowedNumbers, refs: [9], allowedRefs: new Set([3]), refScope: '이 시기' });
  assert.equal(r.length, 3);
  assert.match(r[0], /150/);
  assert.match(r[1], /시장/);
  assert.match(r[2], /\[9\]/);
  assert.deepEqual(checkStatement('중국 4사의 화소 회로 특허를 살펴볼 만하다', { allowedNumbers: new Set() }), []);
});

test('특허 분석 검사: 원문에 없는 숫자와 효과', () => {
  const source = '명칭: 표시 장치\n초록: 봉지층을 2개 층으로 형성해 투습을 줄인다';
  const ok = { topic: '이중 봉지층', problem: '투습', baseline: '원문에 명시되지 않음', improvement: '봉지층을 2개 층으로 형성', keywords: ['봉지층'] };
  assert.deepEqual(checkPatentAnalysis(ok, source), []);
  const bad = { ...ok, improvement: '봉지층 3개로 신뢰성을 높인다' };
  const reasons = checkPatentAnalysis(bad, source);
  assert.equal(reasons.length, 2);
});

test('특허 분석 검사: (추정) 목적은 효과 말 검사에서 뺀다', () => {
  const source = '명칭: 표시 장치\n초록: 보조 전극을 뱅크 아래에 둔다';
  const item = { theme: '대면적 캐소드', purpose: '(추정) 대면적 패널의 휘도 균일성을 높이기 위한 구조', topic: '보조 전극', problem: '원문에 명시되지 않음', baseline: '원문에 명시되지 않음', improvement: '보조 전극을 뱅크 아래에 둔다', keywords: ['보조 전극'] };
  assert.deepEqual(checkPatentAnalysis(item, source), []);
  assert.equal(checkPatentAnalysis({ ...item, purpose: '휘도를 높인다' }, source).length, 1);
});

test('기술 분석은 건수 요약과 다른 표(tech_reports)에 저장하고 찾는다', () => {
  db.prepare(`INSERT INTO tech_reports (level1, level2, level3, period_from, period_to, criteria_version, content, facts, checks)
    VALUES ('OLED', '', '', 2022, 2024, 'v', @content, '', '{"warnings":[]}')`).run({ content: JSON.stringify({ headline: '보고서' }) });
  const scope = { level1: 'OLED', level2: '', level3: '', from: 2022, to: 2024 };
  assert.equal(latestTechReport(scope).report.headline, '보고서');
  assert.equal(listTechReports(null).length, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM trend_summaries').get().n, 0);
});
