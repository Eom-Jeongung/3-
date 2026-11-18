export const CHECKS = [
  ['statMismatches', '회사·분야·연도별 통계 불일치'],
  ['statUnverified', '통계 수치의 맥락을 확인할 수 없음'],
  ['evidenceWarnings', '확인이 필요한 줄 (본문에 표시)'],
  ['foreignText', '한국어가 아닌 글자가 섞인 문장'],
  ['strangeNumbers', '자료에 없는 숫자'],
  ['strangePatents', '근거 목록에 없는 출원번호'],
  ['mixups', '다른 특허 내용이 섞였을 수 있는 인용'],
  ['unsupported', '특허 초록에 없는 효과를 덧붙였을 수 있음'],
  ['overreach', '근거보다 강한 해석(회사 의도·산업 단계 단정)'],
  ['missingSections', '빠진 칸(답이 잘렸을 수 있음)'],
  ['wrongReasons', '주목 특허에 다른 특허의 선정 이유를 붙임'],
  ['formatIssues', '형식 또는 분량 확인'],
]

// 경고가 아니라 참고: 요약이 틀렸다는 뜻이 아니라 데이터 자체가 적다는 안내 (요약의 한계 칸에도 적힌다)
export const NOTES = [
  ['dataWarnings', '건수가 적은 회사·분야·연도'],
]

export function summaryCheckStatus(checks) {
  const data = checks && typeof checks === 'object' ? checks : {}
  // 새 검사에서는 확인 못 한 줄마다 evidenceWarnings가 남는다. statUnverified는 같은 줄을 한 번 더 센 것이라 숨긴다
  const covered = Array.isArray(data.evidenceWarnings) ? ['statUnverified'] : []
  const has = (key) => Array.isArray(data[key]) && data[key].length > 0
  const issues = CHECKS.filter(([key]) => !covered.includes(key) && has(key))
  const notes = NOTES.filter(([key]) => has(key))
  const missing = ['statMismatches', 'statUnverified', 'evidenceWarnings', 'dataWarnings'].some((key) => !Array.isArray(data[key]))
  return { issues, notes, missing }
}
