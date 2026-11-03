// 특허 분류기 (팀 문서 "특허 분류 기준 v0.1"의 판정 순서)
// 기준은 코드에 두지 않는다: classification/*.csv → ipc_map·keyword_map 테이블 → 여기서 읽어 판정
// 원본(patents)은 건드리지 않고 결과는 classification 테이블에만 쓴다
import fs from 'node:fs';
import { db } from './db.js';

export const CRITERIA_VERSION = 'v0.1';
export const UNCLASSIFIED = '미분류';
const COMMON = '공통';
// 이 2차는 해당 1차일 때만 쓴다
const LEVEL2_ONLY_FOR = { 'OLED 소자': 'OLED', '마이크로LED 소자': '마이크로LED' };

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
  const insertIpc = db.prepare('INSERT INTO ipc_map (ipc_prefix, level1, level2, criteria_version) VALUES (@ipc_prefix, @level1, @level2, @version)');
  const insertKeyword = db.prepare('INSERT INTO keyword_map (level1, level2, level3, keyword, criteria_version) VALUES (@level1, @level2, @level3, @keyword, @version)');
  const ipcRows = readCsv('ipc_map.csv');
  const keywordRows = readCsv('keyword_map.csv');
  db.transaction(() => {
    db.prepare('DELETE FROM ipc_map WHERE criteria_version = ?').run(version);
    db.prepare('DELETE FROM keyword_map WHERE criteria_version = ?').run(version);
    for (const r of ipcRows) insertIpc.run({ ...r, version });
    for (const r of keywordRows) insertKeyword.run({ ...r, version });
  })();
  return { ipc: ipcRows.length, keywords: keywordRows.length };
}

// 앞자리 비교: "H10K"·"G09G 5"처럼 그룹까지만 적힌 기준은 그 그룹 전체, "G02F 1/13"처럼 / 뒤까지 적힌 기준은 그 숫자로 시작하는 코드
function matchesPrefix(code, prefix) {
  if (!code.startsWith(prefix)) return false;
  if (prefix.includes('/')) return true;
  const next = code[prefix.length];
  return next === undefined || next === ' ' || next === '/';
}

// 같은 코드에 여러 기준이 맞으면 가장 긴(구체적인) 앞자리만 쓴다. 예: G02F 1/1362 → G02F 1/13이 아니라 G02F 1/136
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

// [{ name, keywords }] 중 키워드가 가장 많이 나온 이름. 없거나 동점이면 null
function topByHits(text, groups, { allowTie = false } = {}) {
  let top = null;
  let topHits = 0;
  let tied = false;
  for (const g of groups) {
    const hits = g.keywords.reduce((sum, k) => sum + countHits(text, k), 0);
    if (hits > topHits) { top = g.name; topHits = hits; tied = false; }
    else if (hits > 0 && hits === topHits) tied = true;
  }
  return tied && !allowTie ? null : top;
}

function loadCriteria(version) {
  const ipc = db.prepare('SELECT ipc_prefix, level1, level2 FROM ipc_map WHERE criteria_version = ?').all(version);
  const keywords = db.prepare('SELECT level1, level2, level3, keyword FROM keyword_map WHERE criteria_version = ?').all(version);
  const groupBy = (rows, key) => {
    const map = new Map();
    for (const r of rows) {
      if (!r[key]) continue;
      if (!map.has(r[key])) map.set(r[key], []);
      map.get(r[key]).push(normalize(r.keyword));
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
    level1Keywords: groupBy(keywords.filter((k) => k.level1), 'level1'),
    level2Keywords: groupBy(keywords.filter((k) => k.level2), 'level2'),
    level3ByLevel2,
  };
}

/** 특허 하나를 판정한다. 첫 행이 주분류, 나머지가 부분류 */
export function classifyPatent({ ipcCodes, title, abstract }, criteria) {
  const text = normalize(`${title} ${abstract}`);

  // 1차: 모든 IPC 중 먼저 나온 방식 코드 → 없으면 방식 키워드 → 그래도 없으면 공통
  let level1 = null;
  for (const code of ipcCodes) {
    const [match] = longestMatches(code, criteria.level1Ipc);
    if (match) { level1 = match.level1; break; }
  }
  // 방식 키워드는 어느 쪽이 많은지 보는 보조 수단이라 동점이면 공통으로 둔다
  level1 ??= topByHits(text, criteria.level1Keywords) ?? COMMON;

  const allowed = (level2) => !LEVEL2_ONLY_FOR[level2] || LEVEL2_ONLY_FOR[level2] === level1;
  const candidatesOf = (code) => [...new Set(longestMatches(code, criteria.level2Ipc).map((r) => r.level2))].filter(allowed);
  const byKeywords = (names) => topByHits(text, criteria.level2Keywords.filter((g) => names.includes(g.name)));
  const level3Of = (level2) => {
    const groups = criteria.level3ByLevel2.get(level2) ?? [];
    return topByHits(text, groups, { allowTie: true }); // 동점이면 표에서 먼저 나온 3차
  };

  // 2차 주분류: 첫 번째 IPC → 여러 2차에 걸리면 그 후보끼리 키워드로 → 못 정하면 미분류
  // 대응표에 없는 코드는 키워드로 추정하지 않는다 (로봇 아암이 광학으로 가는 식의 오분류가 트렌드에 섞임)
  const [firstCode, ...restCodes] = ipcCodes;
  const candidates = firstCode ? candidatesOf(firstCode) : [];
  const level2 = candidates.length > 1 ? byKeywords(candidates) : candidates[0] ?? null;
  const basis = candidates.length > 1 ? '키워드' : 'IPC';

  const primary = level2
    ? { level1, level2, level3: level3Of(level2) ?? `기타 ${level2}`, is_primary: 1, basis, basis_detail: firstCode ?? null }
    : { level1, level2: UNCLASSIFIED, level3: null, is_primary: 1, basis: UNCLASSIFIED, basis_detail: firstCode ?? null };

  // 나머지 IPC: 부분류로 저장 (주분류와 같은 2차는 다시 넣지 않는다)
  const seen = new Set([primary.level2]);
  const rows = [primary];
  for (const code of restCodes) {
    const names = candidatesOf(code);
    const name = names.length > 1 ? byKeywords(names) : names[0];
    if (!name || seen.has(name)) continue;
    seen.add(name);
    rows.push({ level1, level2: name, level3: null, is_primary: 0, basis: 'IPC', basis_detail: code });
  }
  return rows;
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

  const deleteIpc = db.prepare('DELETE FROM patent_ipc WHERE application_number = ?');
  const deleteResult = db.prepare('DELETE FROM classification WHERE application_number = ? AND criteria_version = ?');
  const insertIpc = db.prepare('INSERT INTO patent_ipc (application_number, ipc_code, seq) VALUES (?, ?, ?)');
  const insertResult = db.prepare(`
    INSERT INTO classification (application_number, level1, level2, level3, is_primary, basis, basis_detail, criteria_version)
    VALUES (@application_number, @level1, @level2, @level3, @is_primary, @basis, @basis_detail, @criteria_version)
  `);

  db.transaction(() => {
    for (const p of patents) {
      const ipcCodes = parseIpc(p.ipc_codes);
      deleteIpc.run(p.application_number);
      ipcCodes.forEach((code, i) => insertIpc.run(p.application_number, code, i + 1));
      deleteResult.run(p.application_number, version);
      for (const row of classifyPatent({ ipcCodes, title: p.title, abstract: p.abstract }, criteria)) {
        insertResult.run({ ...row, application_number: p.application_number, criteria_version: version });
      }
    }
  })();
  return patents.length;
}
