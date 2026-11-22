// 특허 분류기 (팀 문서 "LG디스플레이 특허 트렌드센싱 v0.2 기술 분류 체계"의 4장 판정 순서)
// 기준은 코드에 두지 않는다: classification/*.csv → ipc_map·keyword_map·tag_map 테이블 → 여기서 읽어 판정
// 원본(patents)은 건드리지 않고 결과는 classification·application_tags 테이블에만 쓴다
import fs from 'node:fs';
import { db } from './db.js';

// v0.5.6: IPC 3차 힌트 9개만, 3차 근거 저장, 1차 '전계발광'·구동 회로 IPC (2026-11-22)
// v0.5.7: 2차 — 봉지 코드는 봉지 말이 없으면 넓게, 윈도우·스퍼터·성형·기판 처리·가요성 회로·광원 구동 키워드 (2026-11-22)
// v0.5.8: 3차 키워드 56개 보강(3차 전용 — 2차 점수에는 안 씀), keyword_map.level3_only (2026-11-22)
export const CRITERIA_VERSION = 'v0.5.8';
export const UNCLASSIFIED = '미분류';
const COMMON = '공통';
const TITLE_WEIGHT = 3; // 명칭에 나온 키워드는 초록·청구항보다 3배로 센다 (4-4)

// 마이크로LED 코드는 본문에 이 말이 있을 때만 마이크로LED로 본다 (2장). 나머지는 대부분 일반 LED(백라이트 등)
const MICRO_LED_CODES = ['H10H', 'H01L 33', 'H01L 25/075'];
const MICRO_LED_WORDS = ['마이크로 LED', 'micro LED', '마이크로 발광 다이오드', '마이크로 엘이디'];
const MICRO_LED_CHIP = '마이크로LED 칩';
// 방식 코드도 방식 키워드도 없을 때 구동 회로 IPC로 1차를 정한다 (v0.5.6, 2026-11-22 1차 채점)
// 회로 특허는 명칭이 "표시 장치"처럼 일반적이라 공통으로 갔는데, 공통 표본 20건 중 OLED 전용 회로가 6건이었다
// - G09G 3/30·3/32 계열(전계발광 구동) → OLED, 본문에 마이크로LED 말이 있으면 마이크로LED
// - G09G 3/36(액정 구동) → LCD. G09G 3/34(별도 광원)는 전자종이도 포함해서 단독으로는 보지 않고,
//   3/32와 함께 붙었을 때만 백라이트 LED 구동으로 보고 LCD로 정한다
// - 둘 다 있으면 정하지 않는다(공통)
const EL_DRIVE = /^G09G 3\/3[02]/;
const LCD_DRIVE = /^G09G 3\/36/;
function level1ByDriveCode(ipcCodes, hasMicroLed) {
  const el = ipcCodes.some((c) => EL_DRIVE.test(c));
  const lcd = ipcCodes.some((c) => LCD_DRIVE.test(c));
  if (lcd && !el) return 'LCD';
  if (el && ipcCodes.some((c) => /^G09G 3\/34/.test(c))) return 'LCD'; // 백라이트 LED 구동
  if (el && !lcd) return hasMicroLed ? '마이크로LED' : 'OLED';
  return null;
}
// 1차가 공통일 때 2·3차에 맞춰 1차를 바꾼다 (4-1의 4)
const LCD_LEVEL3 = ['액정 셀·배향', '백라이트·도광판'];
const DEVICE = '소자';

// 방법 판정 (4-2): 청구항 1항, 없으면 명칭이 방법만 가리킬 때
const PROCESS = '공정';
const CIRCUIT = '회로';
const MANUFACTURING_END = /(제조|형성|제작)방법$|METHODOF(MANUFACTURING|FABRICATING)|(MANUFACTURING|FABRICATING)METHOD/;
const DRIVING_END = /(구동|제어)방법$|DRIVINGMETHOD|METHODOFDRIVING/;
const TITLE_MANUFACTURING = /(제조|형성|제작)\s*(방법|공정)\s*$/; // "…액정 셀의 제조공정"도 (v0.5.4)
const TITLE_DRIVING = /(구동|제어)\s*방법\s*$/;
// "표시 장치 및 그 제조 방법", "투명표시장치와 그의 제조방법", "액정표시소자 그 제조방법",
// "액정표시장치와 패널 내 광학패턴층형성방법"처럼 장치와 방법을 함께 가리키는 명칭 (방법 앞부분으로 판단)
const deviceAndMethod = (head) => /및/.test(head)
  || /(장치|패널|소자|기판|트랜지스터|필름|모듈|센서)\s*(와|과|,)/.test(head)
  || /(^|\s)(그|그의|이의|이)\s*$/.test(head);

const METHOD_STEP_MIN = 3; // 초록에 "단계"가 이만큼 나오면 방법 단계를 서술한 것으로 본다

const CSV_DIR = new URL('../classification/', import.meta.url);

function readCsv(name) {
  const [header, ...lines] = fs.readFileSync(new URL(name, CSV_DIR), 'utf8').trim().split(/\r?\n/);
  const keys = header.split(',');
  return lines.map((line) => {
    const cells = line.split(',');
    return Object.fromEntries(keys.map((k, i) => [k, cells[i]?.trim() || null]));
  });
}

/** CSV의 기준을 대응표 테이블에 넣는다 (같은 버전은 교체) */
export function seedCriteria(version = CRITERIA_VERSION) {
  const insertIpc = db.prepare('INSERT INTO ipc_map (ipc_prefix, level1, level2, level3, criteria_version) VALUES (@ipc_prefix, @level1, @level2, @level3, @version)');
  const insertKeyword = db.prepare('INSERT INTO keyword_map (level1, level2, level3, keyword, requires, level3_only, criteria_version) VALUES (@level1, @level2, @level3, @keyword, @requires, @level3_only, @version)');
  const insertTag = db.prepare('INSERT INTO tag_map (tag, keyword, ipc_prefix, criteria_version) VALUES (@tag, @keyword, @ipc_prefix, @version)');
  const ipcRows = readCsv('ipc_map.csv');
  const keywordRows = readCsv('keyword_map.csv');
  const tagRows = readCsv('tag_map.csv');
  db.transaction(() => {
    for (const table of ['ipc_map', 'keyword_map', 'tag_map']) db.prepare(`DELETE FROM ${table} WHERE criteria_version = ?`).run(version);
    for (const r of ipcRows) insertIpc.run({ level3: null, ...r, version });
    for (const r of keywordRows) insertKeyword.run({ requires: null, ...r, level3_only: r.level3_only === '1' ? 1 : null, version });
    for (const r of tagRows) insertTag.run({ ...r, version });
  })();
  return { ipc: ipcRows.length, keywords: keywordRows.length, tags: tagRows.length };
}

// 앞자리 비교: "H10K"·"G09G 5"처럼 그룹까지만 적힌 기준은 그 그룹 전체, "G02F 1/13"처럼 / 뒤까지 적힌 기준은 그 숫자로 시작하는 코드
function matchesPrefix(code, prefix) {
  if (!code.startsWith(prefix)) return false;
  if (prefix.includes('/')) return true;
  const next = code[prefix.length];
  return next === undefined || next === ' ' || next === '/';
}

// 같은 코드에 여러 기준이 맞으면 가장 긴(구체적인) 앞자리만 쓴다. 예: G09G 3/32 → G09G 3이 아니라 G09G 3/32
function longestMatches(code, rows) {
  let best = [];
  let bestLength = 0;
  for (const r of rows) {
    if (!matchesPrefix(code, r.ipc_prefix)) continue;
    if (r.ipc_prefix.length > bestLength) { best = [r]; bestLength = r.ipc_prefix.length; }
    else if (r.ipc_prefix.length === bestLength) best.push(r);
  }
  return best;
}

// 특허 문서는 "화소 회로"와 "화소회로"가 섞여 있어 띄어쓰기와 대소문자를 무시한다
const normalize = (s) => (s ?? '').replace(/\s+/g, '').toUpperCase();

function countHits(text, keyword) {
  let n = 0;
  for (let i = text.indexOf(keyword); i !== -1; i = text.indexOf(keyword, i + keyword.length)) n++;
  return n;
}

/** 키워드 점수: 명칭은 3배. requires가 있는 키워드는 그 말 중 하나가 본문에 있을 때만 센다 */
function score(doc, keywords, { skipCommon = false } = {}) {
  let total = 0;
  for (const k of keywords) {
    if (skipCommon && COMMON_WORDS.includes(k.word)) continue;
    if (k.requires && !k.requires.some((r) => doc.all.includes(r))) continue;
    total += TITLE_WEIGHT * countHits(doc.title, k.word) + countHits(doc.body, k.word);
  }
  return total;
}

// [{ name, keywords }] 중 점수가 가장 높은 이름. 동점이면 목록에서 먼저 나온 것, 하나도 안 맞으면 null
// allowTie가 false면 동점일 때 null (방식 키워드처럼 어느 쪽이 많은지만 보는 보조 판정)
function topByScore(doc, groups, { allowTie = true, skipCommon = false } = {}) {
  let top = null;
  let topScore = 0;
  let tied = false;
  for (const g of groups) {
    const s = score(doc, g.keywords, { skipCommon });
    if (s > topScore) { top = g.name; topScore = s; tied = false; }
    else if (s > 0 && s === topScore) tied = true;
  }
  return tied && !allowTie ? null : top;
}

export function loadCriteria(version = CRITERIA_VERSION) {
  const ipc = db.prepare('SELECT ipc_prefix, level1, level2, level3 FROM ipc_map WHERE criteria_version = ? ORDER BY rowid').all(version);
  const keywords = db.prepare('SELECT level1, level2, level3, keyword, requires, level3_only FROM keyword_map WHERE criteria_version = ? ORDER BY rowid').all(version);
  const tags = db.prepare('SELECT tag, keyword, ipc_prefix FROM tag_map WHERE criteria_version = ? ORDER BY rowid').all(version);
  const toKeyword = (r) => ({ word: normalize(r.keyword), requires: r.requires ? r.requires.split('|').map(normalize) : null });
  const groupBy = (rows, key) => {
    const map = new Map();
    for (const r of rows) {
      if (!r[key]) continue;
      if (!map.has(r[key])) map.set(r[key], []);
      map.get(r[key]).push(toKeyword(r));
    }
    return [...map].map(([name, list]) => ({ name, keywords: list }));
  };
  const level3ByLevel2 = new Map();
  for (const r of keywords) {
    if (r.level2 && !level3ByLevel2.has(r.level2)) {
      level3ByLevel2.set(r.level2, groupBy(keywords.filter((k) => k.level2 === r.level2), 'level3'));
    }
  }
  return {
    level1Ipc: ipc.filter((r) => r.level1),
    level2Ipc: ipc.filter((r) => r.level2),
    level2Order: [...new Set(ipc.filter((r) => r.level2).map((r) => r.level2))],
    level1Keywords: groupBy(keywords.filter((k) => k.level1), 'level1'),
    // 3차 전용 키워드(level3_only)는 2차 점수에 넣지 않는다. 여러 분야 특허에 두루 나오는 말(데이터 라인·정전기 등)이 2차를 끌고 가서 (v0.5.7)
    level2Keywords: groupBy(keywords.filter((k) => k.level2 && !k.level3_only), 'level2'),
    level3ByLevel2,
    tagKeywords: groupBy(tags.filter((t) => t.keyword), 'tag'),
    tagIpc: tags.filter((t) => t.ipc_prefix),
    microWords: MICRO_LED_WORDS.map(normalize),
  };
}

const isMicroLedCode = (code) => MICRO_LED_CODES.some((p) => matchesPrefix(code, p));

// "장치 및 그 제조방법" 특허라도 초록 첫 문장의 주어가 방법이면 방법 발명으로 본다 (v0.2.2)
// 예: "본 발명에 의한 액정표시장치 제조방법은, …단계와; …" / 반대: "본 발명은 표시 장치 및 그 제조 방법에 관한 것으로"
const ABSTRACT_METHOD_SUBJECT = [
  [/^[^.]{0,60}?(제조|형성|제작)\s*방법은/, PROCESS, '제조 방법'],
  [/^[^.]{0,60}?(구동|제어)\s*방법은/, CIRCUIT, '구동 방법'],
];

/** 청구항 1항, 없으면 명칭(장치와 방법이 함께면 초록 첫 문장)으로 제조 방법(공정)·구동 방법(회로) 특허인지 본다 */
function methodOf({ title, abstract, claim1 }) {
  if (claim1) {
    const tail = normalize(claim1).replace(/[.。\s]+$/, '');
    if (MANUFACTURING_END.test(tail)) return { level2: PROCESS, basis: '청구항', detail: '청구항 1항: 제조 방법' };
    if (DRIVING_END.test(tail)) return { level2: CIRCUIT, basis: '청구항', detail: '청구항 1항: 구동 방법' };
    return null; // 청구항이 있으면 청구항이 우선이고, 장치 청구항이면 방법 판정을 하지 않는다
  }
  const t = (title ?? '').trim().replace(/[.。]+$/, ''); // "…제조방법."처럼 끝에 마침표가 붙은 명칭 (v0.5.3)
  for (const [pattern, level2, label] of [[TITLE_MANUFACTURING, PROCESS, '제조 방법'], [TITLE_DRIVING, CIRCUIT, '구동 방법']]) {
    if (!pattern.test(t)) continue;
    if (!deviceAndMethod(t.replace(pattern, ''))) return { level2, basis: '명칭', detail: `명칭: ${label}` };
    const first = (abstract ?? '').trim();
    for (const [subject, l2, l] of ABSTRACT_METHOD_SUBJECT) {
      if (subject.test(first)) return { level2: l2, basis: '초록', detail: `초록 첫 문장: ${l}` };
    }
    // 초록이 "~하는 단계, ~하는 단계 …"로 방법 단계를 늘어놓으면 방법 발명으로 본다 (v0.2.5)
    // 예: "…캐리어 기판 상에 광분해층을 형성하는 단계, … 캐리어 기판을 제거하는 단계를 통해 제조된다"
    if ((first.match(/단계/g) ?? []).length >= METHOD_STEP_MIN) return { level2, basis: '초록', detail: `초록: ${label} 단계 서술` };
    return null;
  }
  return null;
}

// 장비 특허 (v0.4.2): 명칭이 공정 말 + 장치·장비·시스템이면 공정으로 본다
// 예: "라미네이션 장치", "액정표시장치용 검사 장치", "표시 패널의 건조 방법 및 건조 장치", "인쇄 장치 시스템 및 …"
// 장비 특허에도 G02F·G06F 같은 패널 코드가 붙어 IPC 점수로는 광학·터치로 가는 일이 많았다
// 명칭이 표시 장치·패널·기판 등으로 끝나면 그 물건이 발명이므로 적용하지 않는다 ("인쇄회로기판 및 이를 포함하는 표시장치")
const DISPLAY_SUBJECT_END = /(표시장치|디스플레이장치|디스플레이|표시패널|패널|소자|기판|모듈|발광장치|조명장치|전자장치|전자기기|필름|센서)$/;
const EQUIPMENT_WORD = /(장치|장비|시스템|설비|검사기|측정기|테스터|마스크|도가니|지그|노즐|합착기|증착기|노광기|세정기|도포기|절단기)/; // 마스크·도가니 등은 그 자체가 공정 도구
const NOT_EQUIPMENT_WORDS = ['불량', '점등'].map(normalize); // 장비가 아니어도 명칭에 나오는 공정 키워드
function equipmentOf(titleNorm, criteria) {
  // "액정표시장치 및 그 리페어 방법"처럼 표시 장치 자체가 끝에 오지 않아도, 리페어·검사 방법이면 검사·리페어로 본다
  if (/(검사|리페어|수리)방법$/.test(titleNorm)) return { level2: PROCESS, basis: '명칭', detail: '명칭: 검사·리페어 방법' };
  // "표시장치" 안의 "장치"는 장비가 아니다
  const stripped = titleNorm.replace(/(표시장치|디스플레이장치|발광장치|전자장치|조명장치)/g, '');
  // "투명전극 제조방법 및 장치"처럼 제조 장치를 직접 말하면 바로 공정 (v0.4.7)
  if (/(제조|형성|증착|가공)(방법)?(및|과|와)?장치/.test(stripped)) return { level2: PROCESS, basis: '명칭', detail: '명칭: 장비' };
  if (DISPLAY_SUBJECT_END.test(titleNorm) || !EQUIPMENT_WORD.test(stripped)) return null;
  const processWords = criteria.level2Keywords.find((g) => g.name === PROCESS)?.keywords ?? [];
  const hit = processWords.find((k) => !NOT_EQUIPMENT_WORDS.includes(k.word) && titleNorm.includes(k.word));
  return hit ? { level2: PROCESS, basis: '명칭', detail: '명칭: 장비' } : null;
}

// ---- 2차: IPC 전체 점수 (v0.2.2) ----
// 첫 IPC 하나만 보면, 첫 코드가 넓은 코드(G02F 1/13 액정 전반)이거나 부수 기술일 때 틀린다 (검토 5건 중 3건)
// 그래서 대응표에 있는 IPC를 모두 보고 2차마다 점수를 더한다
const FIRST_IPC_WEIGHT = 1.5;   // 첫 IPC는 주 IPC일 가능성이 높아 조금 더 쳐준다
const OTHER_IPC_WEIGHT = 1;
const REPEAT_IPC_WEIGHT = 0.5;  // 같은 2차의 두 번째 IPC부터
const BROAD_IPC_WEIGHT = 0.5;   // 넓은 규칙은 내용을 잘 못 알려준다
// 넓은 규칙: 그룹까지만 적힌 규칙(H10K 59, G09G 3, H10K 71 등)과 아래 세부 규칙
// G02F 1/1333은 KIPRIS가 세부 코드를 안 줘서 액정 셀·프레임·어레이 기판이 모두 이 코드로 온다 (v0.2.3 추가)
// (v0.2.3 시험: 넓은 규칙을 목록으로만 정하면 H10K 71·H10D가 제 무게를 받아 장치 특허가 공정·TFT로 몰려 되돌림)
// H10K 59/80(구조 세부)은 OLED 특허 대부분에 붙는 포괄 코드라 넓은 규칙으로 본다 (v0.3.6, TFT 코드 재배치 후 다시 시험)
// H10K 59/12는 "AMOLED 일반"이라 TFT 발명을 뜻하지 않는다 (v0.3.7)
const BROAD_SUBGROUPS = ['G02F 1/13', 'G02F 1/133', 'G02F 1/1333', 'H10K 59/80', 'H10K 59/12']; // (v0.5.0 시험: 59/121까지 넓게 보면 OLED 특허가 TFT로 몰려 되돌림)
// H10K 50/84 계열(봉지·용기)은 커버·보호 필름·지지 부재 같은 기구 특허에도 붙는다. 이 코드로 소자가 된 913건 중 506건은
// 봉지·밀봉·투습 같은 말이 아예 없었다 (v0.5.6, 2026-11-22). 그런 말이 없을 때만 넓은 규칙으로 보고 키워드가 판단하게 한다
// (모두 넓게 보면 TFT 코드가 여러 개 붙은 진짜 봉지 특허가 설계로 밀려났다)
const SEAL_PREFIXES = ['H10K 50/84', 'H10K 50/842', 'H10K 50/844'];
const SEAL_WORDS = ['봉지', '밀봉', '투습', '침투', '실링', '씰링', '실런트', '봉합'].map((w) => w.replace(/\s+/g, '').toUpperCase());
// 그룹까지만 적혀 있어도 내용이 분명한 코드 (장비·증착·검사·소재·3D): 넓은 규칙으로 보지 않는다 (v0.2.8)
// 예: "질소 레벨 센서"(G02F 1/13, H10P 72/00) — H10P를 넓게 보면 명칭의 "센서" 하나로 터치·센서가 된다
const SPECIFIC_GROUPS = ['H10P', 'H10P 72', 'B65G', 'C23C 14', 'C23C 16', 'G03F 7', 'B41J 2', 'G01N 21', 'H04N 13', 'F21V', 'C09K 11', 'C09K 19', 'C07D', 'C07F', 'C07C', 'H10K 85', 'G03F 1', 'B65H', 'B65D', 'B05C', 'C03B 23', 'G06T 5'];
const KEYWORD_POINT = 0.4;      // 나온 키워드 1개당 (명칭에 나오면 2배)
const KEYWORD_CAP = 2;          // 키워드가 IPC를 완전히 뒤집지는 못하게 상한
// 특허의 10% 이상에 나오는 말: IPC가 전부 넓은 규칙이라 모든 2차를 후보로 열 때만 뺀다
// (평소에도 빼면 "액정"을 잃은 진짜 액정 셀 특허가 TFT 소자로 넘어간다)
const COMMON_WORDS = ['액정', '표시 영역', '배선'].map(normalize);

const TITLE_TOPICS = [
  ['터치', '설계'], ['지문', '설계'], ['커버 윈도우', '기구'], ['윈도우', '기구'], ['폴더블', '기구'], ['롤러블', '기구'],
  ['스트레처블', '기구'], ['스트레쳐블', '기구'], ['편광', '광학'], ['렌즈', '설계'],
  ['화합물', '재료'], ['조성물', '재료'], ['소자용 재료', '재료'], ['발광 재료', '재료'],
].map(([w, l2]) => [normalize(w), l2]);

const isBroadRule = (prefix) => (!prefix.includes('/') && !SPECIFIC_GROUPS.includes(prefix)) || BROAD_SUBGROUPS.includes(prefix);

function keywordPoints(doc, keywords, { skipCommon = false } = {}) {
  let points = 0;
  for (const k of keywords) {
    if (skipCommon && COMMON_WORDS.includes(k.word)) continue;
    if (k.requires && !k.requires.some((r) => doc.all.includes(r))) continue;
    if (doc.title.includes(k.word)) points += 2 * KEYWORD_POINT;
    else if (doc.body.includes(k.word)) points += KEYWORD_POINT;
  }
  return Math.min(points, KEYWORD_CAP);
}

/** @returns {{ level2: string, code: string, keywordDecided: boolean }} code는 고른 2차에 가장 크게 기여한 IPC */
function level2ByAllIpc(mappedCodes, ipcRowsOf, doc, criteria) {
  const ipcScore = new Map();
  const bestCode = new Map(); // 2차 → [점수, 코드]
  const codeCount = new Map(); // 2차 → 지금까지 센 IPC 수
  mappedCodes.forEach((code, i) => {
    const rows = ipcRowsOf(code);
    const names = [...new Set(rows.map((r) => r.level2))];
    const broad = isBroadRule(rows[0].ipc_prefix) || (SEAL_PREFIXES.includes(rows[0].ipc_prefix) && !SEAL_WORDS.some((w) => doc.all.includes(w)));
    const base = (i === 0 ? FIRST_IPC_WEIGHT : OTHER_IPC_WEIGHT) * (broad ? BROAD_IPC_WEIGHT : 1) / names.length;
    for (const name of names) {
      // 같은 2차를 가리키는 두 번째 IPC부터는 절반만 센다 (v0.3.1)
      // OLED 특허는 TFT 코드(H10K 59/121·123·124…)가 여러 개 붙어 개수만으로 TFT 소자가 되는 일이 많았다
      const weight = base * (codeCount.get(name) ? REPEAT_IPC_WEIGHT : 1);
      codeCount.set(name, (codeCount.get(name) ?? 0) + 1);
      ipcScore.set(name, (ipcScore.get(name) ?? 0) + weight);
      if (!bestCode.has(name) || bestCode.get(name)[0] < weight) bestCode.set(name, [weight, code]);
    }
  });
  // IPC가 전부 넓은 규칙이면 IPC가 기술 영역을 거의 알려주지 않으므로, 모든 2차를 키워드 후보로 연다 (v0.2.3)
  // 예: G02F 1/1333 하나뿐인 "어레이 기판 및 그 제조 방법"(사진 식각·마스크) → 공정
  // 그래도 IPC 후보는 넓은 규칙 점수(0.5~0.75)를 갖고 시작하므로, 키워드가 그보다 분명할 때만 바뀐다
  const allBroad = mappedCodes.every((code) => isBroadRule(ipcRowsOf(code)[0].ipc_prefix));
  const keywordsOf = new Map(criteria.level2Keywords.map((g) => [g.name, g.keywords]));
  // 명칭에 분명한 주제어(터치·커버 윈도우·폴더블 등)가 있으면 IPC에 없어도 후보로 연다 (v0.4.5)
  // 예: "터치 센서가 내장된 액정 표시 장치"(G02F 코드뿐) → 설계 / 터치·센서
  const strongTitle = new Set(TITLE_TOPICS.filter(([w]) => doc.title.includes(w)).map(([, l2]) => l2));
  const candidates = criteria.level2Order.filter((name) => ipcScore.has(name) || allBroad || strongTitle.has(name));

  // 명칭 우선 (v0.2.5): 명칭에 키워드가 나오는 후보가 딱 하나면 그 2차로 정한다
  // 명칭은 발명의 핵심을 가장 짧게 적은 것이라, IPC 개수보다 믿을 만하다
  // 예: "터치 기능을 구비한 액정표시장치"(광학 IPC 2개, 터치 IPC 1개) → 설계, "커버 윈도우 및 그 제조 방법" → 기구
  // "액정"·"배선" 같은 흔한 말은 명칭에 있어도 세지 않는다 ("액정표시장치"는 거의 모든 LCD 특허의 명칭이다)
  const inTitle = candidates.filter((name) => (keywordsOf.get(name) ?? []).some((k) => !COMMON_WORDS.includes(k.word)
    && doc.title.includes(k.word) && (!k.requires || k.requires.some((r) => doc.all.includes(r)))));
  if (process.env.CLS_DEBUG) console.error(`  명칭 키워드 후보: ${inTitle.join(", ") || "없음"}, allBroad=${allBroad}`);
  if (inTitle.length === 1) {
    const [name] = inTitle;
    const byIpc = [...ipcScore].sort((a, b) => b[1] - a[1])[0]?.[0];
    return { level2: name, code: bestCode.get(name)?.[1] ?? mappedCodes[0], keywordDecided: name !== byIpc, margin: Infinity, ranked: [name] };
  }

  const totals = []; // [2차, 점수] — 1등과 2등 차이로 애매한 특허를 고른다 (v0.4.9)
  let best = null;
  let bestTotal = -1;
  let bestByIpcOnly = null;
  let bestIpc = -1;
  for (const name of criteria.level2Order) { // 동점이면 대응표에서 먼저 나온 2차
    if (!ipcScore.has(name) && !allBroad) continue;
    const ipc = ipcScore.get(name) ?? 0;
    const total = ipc + keywordPoints(doc, keywordsOf.get(name) ?? [], { skipCommon: true });
    if (process.env.CLS_DEBUG) console.error(`  ${name}: IPC ${ipc.toFixed(2)} + 키워드 ${(total - ipc).toFixed(2)}`);
    totals.push([name, total]);
    if (total > bestTotal) { best = name; bestTotal = total; }
    if (ipc > bestIpc) { bestByIpcOnly = name; bestIpc = ipc; }
  }
  const ranked = totals.sort((a, b) => b[1] - a[1]);
  const margin = ranked.length > 1 ? ranked[0][1] - ranked[1][1] : Infinity;
  return { level2: best, code: bestCode.get(best)?.[1] ?? mappedCodes[0], keywordDecided: best !== bestByIpcOnly, margin, ranked: ranked.map(([n]) => n) };
}

/**
 * 특허 하나를 판정한다.
 * @returns {{ rows: object[], tags: string[] }} rows의 첫 행이 주분류, 나머지가 부분류
 */
export function classifyPatent({ ipcCodes, title, abstract, claims = [] }, criteria) {
  const doc = {
    title: normalize(title),
    body: normalize(`${abstract ?? ''} ${claims.join(' ')}`),
  };
  doc.all = doc.title + doc.body;
  const hasMicroLed = criteria.microWords.some((w) => doc.all.includes(w));

  // 4-1. 1차: 모든 IPC 중 먼저 나온 방식 코드 → 없으면 방식 키워드 → 없으면 구동 회로 IPC → 그래도 없으면 공통
  // 마이크로LED 코드는 본문에 "마이크로 LED"가 있을 때만 인정한다. 아니면 건너뛰어 G02F 1/13이 있으면 LCD, 없으면 공통이 된다
  let level1 = null;
  for (const code of ipcCodes) {
    const [match] = longestMatches(code, criteria.level1Ipc);
    if (!match) continue;
    if (match.level1 === '마이크로LED' && !hasMicroLed) continue;
    level1 = match.level1;
    break;
  }
  level1 ??= topByScore(doc, criteria.level1Keywords, { allowTie: false }) ?? level1ByDriveCode(ipcCodes, hasMicroLed) ?? COMMON;

  const ipcRowsOf = (code) => longestMatches(code, criteria.level2Ipc);
  const level2NamesOf = (code) => {
    const names = new Set(ipcRowsOf(code).map((r) => r.level2));
    return criteria.level2Order.filter((n) => names.has(n)); // 동점일 때 대응표에서 먼저 나온 2차
  };
  const pickLevel2 = (names) => (names.length > 1
    ? topByScore(doc, criteria.level2Keywords.filter((g) => names.includes(g.name))) ?? names[0]
    : names[0] ?? null);
  // 4-4. 3차: 키워드 → 그 2차를 정한 IPC의 3차 힌트 → 기타
  // 3차도 "액정" 같은 흔한 말은 세지 않는다 (v0.4.5: 도광판·컬러필터 특허가 "액정" 때문에 액정 셀로 가던 문제)
  // level3_basis: 키워드 / IPC / 기타. IPC로 정한 3차는 화면에서 'IPC 추정'으로 표시한다 (2026-11 담당자님 피드백)
  // level3Check: 키워드 3차와 IPC 힌트를 둘 다 남겨 IPC 규칙별 정확도를 잰다 (scripts/ipc-level3-check.js)
  let level3Check = null;
  const level3Of = (level2, code) => {
    const keyword = topByScore(doc, criteria.level3ByLevel2.get(level2) ?? [], { skipCommon: true });
    const hint = code ? ipcRowsOf(code).find((r) => r.level2 === level2 && r.level3) : null;
    level3Check = { level2, keyword, ipc: hint?.level3 ?? null, prefix: hint?.ipc_prefix ?? null };
    if (keyword) return { level3: keyword, level3_basis: '키워드' };
    if (hint) return { level3: hint.level3, level3_basis: 'IPC' };
    return { level3: `기타 ${level2}`, level3_basis: '기타' };
  };

  // 대응표에 있는 IPC가 하나도 없으면 디스플레이와 무관할 수 있어 방법 판정도 하지 않는다 (로봇 아암 같은 오분류 방지)
  const mappedCodes = ipcCodes.filter((c) => ipcRowsOf(c).length);

  let primary;
  let doubt = { margin: Infinity, candidates: [] }; // 1등·2등 점수 차와 후보 순위 (애매한 특허를 AI에 맡길 때 쓴다)
  // 대응표 IPC가 전부 재료(화합물·조성물)이면 "제조방법"이어도 재료 발명이다 (v0.4.7, 예: 고순도 글리콜계 화합물의 제조방법)
  const onlyMaterial = mappedCodes.length && mappedCodes.every((c) => ipcRowsOf(c).every((r) => r.level2 === '재료'));
  const method = mappedCodes.length && !onlyMaterial
    ? methodOf({ title, abstract, claim1: claims[0] }) ?? equipmentOf(doc.title, criteria)
    : null;
  if (method) {
    // 4-2. 방법 판정: 공정·회로 안의 키워드로 3차, 안 맞으면 기타
    // 3차 키워드가 없으면 같은 2차를 가리키는 IPC의 3차 힌트를 쓴다 (v0.2.6, 예: H01L 21 → TFT 공정)
    const hintCode = mappedCodes.find((c) => ipcRowsOf(c).some((r) => r.level2 === method.level2 && r.level3));
    primary = { level2: method.level2, ...level3Of(method.level2, hintCode), basis: method.basis, basis_detail: method.detail };
  } else if (mappedCodes.length) {
    // 4-3. 2차: 모든 IPC의 점수를 더해 가장 높은 2차 (v0.2.2)
    const { level2, code, keywordDecided, margin, ranked } = level2ByAllIpc(mappedCodes, ipcRowsOf, doc, criteria);
    primary = { level2, ...level3Of(level2, code), basis: keywordDecided ? '키워드' : 'IPC', basis_detail: code };
    doubt = { margin, candidates: ranked };
  } else {
    primary = { level2: UNCLASSIFIED, level3: null, level3_basis: null, basis: UNCLASSIFIED, basis_detail: ipcCodes[0] ?? null };
  }

  // 4-1의 4. 1차가 공통이면 2·3차에 맞춘다
  // 일반 LED 코드(마이크로LED 아님)로 소자가 된 특허는 OLED가 아니므로 공통으로 둔다
  if (level1 === COMMON) {
    const fromPlainLed = primary.basis_detail && isMicroLedCode(primary.basis_detail) && !hasMicroLed;
    if (primary.level3 === MICRO_LED_CHIP) level1 = '마이크로LED';
    else if (primary.level2 === DEVICE && !fromPlainLed) level1 = 'OLED';
    else if (LCD_LEVEL3.includes(primary.level3)) level1 = 'LCD';
  }

  // 4-3의 5. 나머지 IPC가 가리키는 다른 2차는 부분류로 저장만 한다 (주분류와 같은 2차는 다시 넣지 않는다)
  const rows = [{ level1, ...primary, is_primary: 1 }];
  const seen = new Set([primary.level2]);
  for (const code of mappedCodes) {
    const name = pickLevel2(level2NamesOf(code));
    if (!name || seen.has(name)) continue;
    seen.add(name);
    rows.push({ level1, level2: name, level3: null, level3_basis: null, is_primary: 0, basis: 'IPC', basis_detail: code });
  }

  // 7장. 응용 태그: 명칭·초록 키워드 또는 IPC (여러 개 가능)
  const tags = new Set(criteria.tagKeywords.filter((g) => score(doc, g.keywords) > 0).map((g) => g.name));
  for (const t of criteria.tagIpc) if (ipcCodes.some((c) => matchesPrefix(c, t.ipc_prefix))) tags.add(t.tag);

  return { rows, tags: [...tags], level3Check, ...doubt };
}

/** 지금 기준이 아닌 예전 버전의 분류 결과를 지운다. 화면·집계는 가장 최신 버전만 읽는다 (버전 하나에 약 35MB) */
export function removeOtherVersions(version = CRITERIA_VERSION) {
  const removed = db.prepare('DELETE FROM classification WHERE criteria_version <> ?').run(version).changes;
  db.prepare('DELETE FROM application_tags WHERE criteria_version <> ?').run(version);
  return removed;
}

/** 대응표가 채워져 있는지 (npm run classify를 아직 안 돌린 DB에서는 새로고침 때 분류를 건너뛴다) */
export function hasCriteria(version = CRITERIA_VERSION) {
  return Boolean(db.prepare('SELECT 1 FROM ipc_map WHERE criteria_version = ? LIMIT 1').get(version));
}

const parseIpc = (s) => (s ?? '').split('|').map((c) => c.trim()).filter(Boolean);

/** 주어진 특허들의 patent_ipc와 분류 결과를 다시 만든다. 출원번호를 안 주면 전체 */
export function classifyPatents({ numbers = null, version = CRITERIA_VERSION } = {}) {
  const criteria = loadCriteria(version);
  if (!criteria.level2Ipc.length) throw new Error(`대응표(${version})가 비어 있습니다. npm run classify로 먼저 채우세요`);

  const selectAll = db.prepare('SELECT application_number, title, abstract, ipc_codes FROM patents');
  const selectOne = db.prepare('SELECT application_number, title, abstract, ipc_codes FROM patents WHERE application_number = ?');
  const patents = numbers ? numbers.map((n) => selectOne.get(n)).filter(Boolean) : selectAll.all();

  // 청구항은 상세 화면에서 불러온 특허에만 있다 (1건당 KIPRIS 1회)
  const claimsOf = new Map();
  for (const c of db.prepare('SELECT application_number, claim FROM patent_claims ORDER BY application_number, seq').all()) {
    if (!claimsOf.has(c.application_number)) claimsOf.set(c.application_number, []);
    claimsOf.get(c.application_number).push(c.claim);
  }

  const deleteIpc = db.prepare('DELETE FROM patent_ipc WHERE application_number = ?');
  // +criteria_version: 버전 색인을 고르면 특허마다 그 버전 전체를 훑어 수십 분 걸린다. 출원번호 색인을 쓰게 한다
  const deleteResult = db.prepare('DELETE FROM classification WHERE application_number = ? AND +criteria_version = ?');
  const deleteTags = db.prepare('DELETE FROM application_tags WHERE application_number = ? AND criteria_version = ?');
  const insertIpc = db.prepare('INSERT INTO patent_ipc (application_number, ipc_code, seq) VALUES (?, ?, ?)');
  const insertResult = db.prepare(`
    INSERT INTO classification (application_number, level1, level2, level3, level3_basis, is_primary, basis, basis_detail, criteria_version)
    VALUES (@application_number, @level1, @level2, @level3, @level3_basis, @is_primary, @basis, @basis_detail, @criteria_version)
  `);
  const insertTag = db.prepare('INSERT INTO application_tags (application_number, tag, criteria_version) VALUES (?, ?, ?)');

  db.transaction(() => {
    for (const p of patents) {
      const ipcCodes = parseIpc(p.ipc_codes);
      deleteIpc.run(p.application_number);
      ipcCodes.forEach((code, i) => insertIpc.run(p.application_number, code, i + 1));
      deleteResult.run(p.application_number, version);
      deleteTags.run(p.application_number, version);
      const { rows, tags } = classifyPatent({ ipcCodes, title: p.title, abstract: p.abstract, claims: claimsOf.get(p.application_number) }, criteria);
      for (const row of rows) insertResult.run({ ...row, application_number: p.application_number, criteria_version: version });
      for (const tag of tags) insertTag.run(p.application_number, tag, version);
    }
  })();
  return patents.length;
}
