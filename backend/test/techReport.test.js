import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
const { db } = await import('../src/db.js');
const { splitPeriods, parseJsonAnswer, checkStatement, checkPatentAnalysis, missingTerms, unsupportedEffects, reversedDoping, guessedPurpose, latestTechReport, listTechReports } = await import('../src/techReport.js');

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

// 2026-11-25 천안 실제 생성(#8·#9) 검증에서 나온 사례
test('괄호 속 약어 키워드는 원문에 따로 있으면 통과하고, 원문에 없는 말을 붙이면 걸린다', () => {
  const source = '광의 피크 파장의 반치폭(Full Width at Half Maximum; FWHM)은 26nm 내지 36nm이다.';
  assert.deepEqual(missingTerms(['반치폭(FWHM)', '피크 파장'], source), []);
  assert.deepEqual(missingTerms(['구동 모드'], '제1 모드 또는 제2 모드로 영상을 표시하는 표시 패널'), ['구동 모드']);
});

test('도핑 관계가 원문과 뒤바뀌면 찾는다', () => {
  const source = '상기 제2전극은 11족 금속에 무기물이 도핑되어 있고, 전자 주입층이 위치한다.';
  assert.deepEqual(reversedDoping('삼성은 11족 금속을 도핑한 제2전극을 쓰는 구조를 다뤘다.', source), ['금속']);
  assert.deepEqual(reversedDoping('삼성은 11족 금속에 무기물을 도핑한 제2전극을 다뤘다.', source), []);
  assert.deepEqual(reversedDoping('무기물이 도핑된 제2전극', source), []);
  // 원문에서 도핑 물질로 쓰인 말은 걸리지 않는다
  assert.deepEqual(reversedDoping('붕소를 도핑한 층', '실리콘에 붕소를 도핑하고, 붕소가 도핑된 층'), []);
  assert.deepEqual(checkPatentAnalysis({ topic: '11족 금속을 도핑한 전극', keywords: [] }, source),
    ['원문과 도핑 관계가 다름: 원문은 "금속에 … 도핑"']);
});

test('인용 특허 목적이 모두 (추정)인데 목적을 단정하듯 쓰면 표시한다', () => {
  const text = '게이트 구동부가 전원 배선을 공유하며, 배선을 줄이기 위한 것으로 보인다.';
  assert.equal(guessedPurpose(text, [{ inferred: true }, { inferred: true }]), true);
  assert.equal(guessedPurpose(text, [{ inferred: true }, { inferred: false }]), false);
  assert.equal(guessedPurpose('게이트 구동부가 전원 배선을 공유한다.', [{ inferred: true }]), false);
  assert.equal(guessedPurpose(text, []), false);
});
