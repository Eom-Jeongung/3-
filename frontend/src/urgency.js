// 만료 임박 단계: 남은 일수로 나눈다 (색만으로 구분하지 않도록 라벨도 함께 쓴다)
//   긴급 30일 이내 / 주의 90일 이내 / 임박 그 이후(서버가 정한 임박 기간 안)
export const URGENT_DAYS = 30
export const WARNING_DAYS = 90

export const URGENCY_LABEL = { critical: '긴급', warning: '주의', soon: '임박' }

export const daysUntil = (date) => Math.ceil((new Date(date) - new Date()) / 86_400_000)

// 임박 대상이 아니면 null
export function urgencyOf(isExpiring, expiryDate) {
  if (!isExpiring || !expiryDate) return null
  const days = daysUntil(expiryDate)
  if (days <= URGENT_DAYS) return 'critical'
  if (days <= WARNING_DAYS) return 'warning'
  return 'soon'
}

// 배지 문구: 긴급만 라벨을 붙여 한눈에 구분되게 한다  예) "긴급 D-9", "D-45"
export function urgencyBadgeText(level, expiryDate) {
  const d = `D-${daysUntil(expiryDate)}`
  return level === 'critical' ? `${URGENCY_LABEL.critical} ${d}` : d
}
