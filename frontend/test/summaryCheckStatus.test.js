import test from 'node:test'
import assert from 'node:assert/strict'
import { summaryCheckStatus } from '../src/components/summaryCheckStatus.js'

const complete = { statMismatches: [], statUnverified: [], evidenceWarnings: [], dataWarnings: [] }

test('새 검사에 경고가 없으면 경고 없음 상태로 구분한다', () => {
  assert.deepEqual(summaryCheckStatus(complete), { issues: [], notes: [], missing: false })
})

// 2026-11-18: 같은 줄을 두 번 세지 않고(statUnverified는 evidenceWarnings가 덮음), 자료 부족은 경고가 아닌 참고로 분리
test('통계 불일치·확인 필요 줄은 경고로, 자료 부족은 참고로 나눈다', () => {
  const result = summaryCheckStatus({ ...complete, statMismatches: ['다른 회사'], statUnverified: ['연도 누락'], evidenceWarnings: ['확인 못 한 줄'], dataWarnings: ['30건 미만'] })
  assert.deepEqual(result.issues.map(([key]) => key), ['statMismatches', 'evidenceWarnings'])
  assert.deepEqual(result.notes.map(([key]) => key), ['dataWarnings'])
  assert.equal(result.missing, false)
})

test('이전 요약은 기존 경고를 보존하면서 새 검사가 미적용된 것으로 표시한다', () => {
  const result = summaryCheckStatus({ strangeNumbers: ['99건'] })
  assert.equal(result.missing, true)
  assert.equal(result.issues[0][0], 'strangeNumbers')
  assert.equal(summaryCheckStatus(null).missing, true)
})
