export const CHECKS = [
  ['statMismatches', '회사·분야·연도별 통계 불일치'],
  ['statUnverified', '통계 수치의 맥락을 확인할 수 없음'],
  ['evidenceWarnings', '근거·통계로 확인하지 못한 문장'],
  ['foreignText', '한국어가 아닌 글자가 섞인 문장'],
  ['dataWarnings', '소수 데이터 또는 자료 부족'],
  ['strangeNumbers', '자료에 없는 숫자'],
  ['strangePatents', '근거 목록에 없는 출원번호'],
  ['mixups', '다른 특허 내용이 섞였을 수 있는 인용'],
  ['unsupported', '특허 초록에 없는 효과를 덧붙였을 수 있음'],
  ['overreach', '근거보다 강한 해석(회사 의도·산업 단계 단정)'],
  ['missingSections', '빠진 칸(답이 잘렸을 수 있음)'],
  ['wrongReasons', '주목 특허에 다른 특허의 선정 이유를 붙임'],
  ['formatIssues', '형식 또는 분량 확인'],
]

export function summaryCheckStatus(checks) {
  const data = checks && typeof checks === 'object' ? checks : {}
  const issues = CHECKS.filter(([key]) => Array.isArray(data[key]) && data[key].length)
  const missing = ['statMismatches', 'statUnverified', 'evidenceWarnings', 'dataWarnings'].some((key) => !Array.isArray(data[key]))
  return { issues, missing }
}
