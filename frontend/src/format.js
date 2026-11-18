// 화면 여러 곳에서 함께 쓰는 이름표·표시 형식·서버 응답 처리

export const COMPANY_LABELS = { own: '자사', competitor: '삼성', china: '중국 4사' }
export const APPLICANT_TYPE_LABELS = { own: '자사', competitor: '경쟁사', china: '중국 경쟁사' }
export const COMPANY_OPTIONS = [
  { value: '', label: '전체' },
  ...Object.entries(COMPANY_LABELS).map(([value, label]) => ({ value, label })),
]

export const formatCount = (n) => n.toLocaleString('ko-KR')

// 1020230116992 -> 10-2023-0116992
export const formatAppNo = (n) => (n?.length === 13 ? `${n.slice(0, 2)}-${n.slice(2, 6)}-${n.slice(6)}` : n)

// 서버 오류 코드를 읽기 쉬운 말로 (502~504는 서버가 꺼졌거나 다시 켜지는 중)
export const httpMessage = (status) => (status >= 502 && status <= 504
  ? `서버가 응답하지 않아요. 잠시 뒤 다시 시도해 주세요. (${status})`
  : `서버에서 오류가 났어요. (${status})`)

// 응답을 JSON으로 읽는다. 실패 응답이면 서버가 준 안내(없으면 상태 코드 안내)로 오류를 낸다
// 서버가 다시 켜지는 중에는 JSON이 아닌 오류 화면이 올 수 있다
export async function jsonOrThrow(res) {
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(body?.error ?? httpMessage(res.status))
  return body
}

// 그래프 눈금의 맨 위 값: 최댓값보다 크면서 읽기 좋은 수
export const niceAxisMax = (max) => {
  if (max <= 0) return 10
  const step = 10 ** Math.floor(Math.log10(max))
  return [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((n) => max / step <= n) * step
}

// 그래프 가로축 이름: '2024' → 2024, '2024-H1' → 24.상
export const periodAxisLabel = (period) => (period.key.includes('-H')
  ? `${period.key.slice(2, 4)}.${period.key.endsWith('1') ? '상' : '하'}`
  : period.key)
