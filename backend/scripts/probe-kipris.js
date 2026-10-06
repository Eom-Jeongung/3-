// 체크리스트 3번: 출원인명으로 호출해 원본 응답과 검색 파라미터 동작 확인
import { searchPatents, APPLICANTS, STATUS_CODES } from '../src/kipris.js';

for (const [type, applicant] of Object.entries(APPLICANTS)) {
  const all = await searchPatents({ applicant, numOfRows: '1' });
  console.log(`\n[${type}] ${applicant}: 전체 ${all.totalCount}건`);

  for (const [label, code] of Object.entries(STATUS_CODES)) {
    const r = await searchPatents({ applicant, lastvalue: code, numOfRows: '1' });
    console.log(`  상태 ${label}(${code}): ${r.totalCount}건, 예시 상태값=${r.items[0]?.registerStatus ?? '-'}`);
  }

  const ranged = await searchPatents({ applicant, applicationDate: '20061005~20070405', lastvalue: 'R', numOfRows: '3' });
  console.log(`  등록 & 출원일 2006-10-05~2007-04-05 (6개월 내 만료 후보): ${ranged.totalCount}건`);
  for (const it of ranged.items) console.log(`    ${it.applicationNumber} ${it.applicationDate} ${it.registerStatus} ${it.inventionTitle}`);
}
