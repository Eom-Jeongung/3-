// KIPRIS Plus API 호출 래퍼 (특허·실용 공개·등록공보 > getAdvancedSearch)
import { XMLParser } from 'fast-xml-parser';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = 'http://plus.kipris.or.kr/kipo-api/kipi/patUtiModInfoSearchSevice/getAdvancedSearch';
// 무료 한도(월 1,000회)를 아끼기 위해 개발 중에는 같은 요청을 디스크에 캐싱
const CACHE_DIR = path.join(path.dirname(process.env.DB_PATH || './data/patents.db'), 'kipris-cache');

// 출원번호 등 긴 숫자가 Number로 바뀌어 깨지지 않도록 모든 값을 문자열로 유지
const parser = new XMLParser({ parseTagValue: false, isArray: (name) => name === 'item' });

// KIPRIS에는 출원인명이 한글 표기로 등록돼 있다 ("LG디스플레이"로는 0건)
export const APPLICANTS = {
  own: '엘지디스플레이',
  competitor: '삼성디스플레이',
};

// lastvalue 파라미터의 상태 코드
export const STATUS_CODES = { 공개: 'A', 취하: 'C', 소멸: 'F', 포기: 'G', 무효: 'I', 거절: 'J', 등록: 'R' };

/**
 * @param {object} params applicant, applicationDate('YYYYMMDD~YYYYMMDD'), lastvalue, numOfRows, pageNo 등
 * @param {{ useCache?: boolean }} options
 * @returns {Promise<{ totalCount: number, items: object[] }>}
 */
export async function searchPatents(params, { useCache = true } = {}) {
  const key = process.env.KIPRIS_API_KEY;
  if (!key) throw new Error('KIPRIS_API_KEY가 .env에 없습니다');

  const query = new URLSearchParams({ patent: 'true', utility: 'true', numOfRows: '20', pageNo: '1', ...params });
  const cacheFile = path.join(CACHE_DIR, crypto.createHash('sha1').update(query.toString()).digest('hex') + '.xml');

  let xml;
  if (useCache && fs.existsSync(cacheFile)) {
    xml = fs.readFileSync(cacheFile, 'utf8');
  } else {
    const res = await fetch(`${BASE_URL}?${query}&ServiceKey=${encodeURIComponent(key)}`);
    if (!res.ok) throw new Error(`KIPRIS HTTP ${res.status}`);
    xml = await res.text();
  }

  const { response } = parser.parse(xml);
  const header = response?.header ?? {};
  if (header.successYN !== 'Y') {
    throw new Error(`KIPRIS 오류 ${header.resultCode}: ${header.resultMsg}`);
  }
  if (useCache) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cacheFile, xml);
  }

  const items = response.body?.items?.item ?? [];
  return { totalCount: Number(response.count?.totalCount ?? 0), items };
}
