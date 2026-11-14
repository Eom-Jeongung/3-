import test from 'node:test'
import assert from 'node:assert/strict'
import { summaryCheckStatus } from '../src/components/summaryCheckStatus.js'

const complete = { statMismatches: [], statUnverified: [], evidenceWarnings: [] }

test('새 검사에 경고가 없으면 경고 없음 상태로 구분한다', () => {
  assert.deepEqual(summaryCheckStatus(complete), { issues: [], missing: false })
})

test('통계 불일치·검증 불가·근거 부족 경고를 각각 표시 대상으로 반환한다', () => {
  const result = summaryCheckStatus({ ...complete, statMismatches: ['다른 회사'], statUnverified: ['연도 누락'], evidenceWarnings: ['후보 부족'] })
  assert.deepEqual(result.issues.map(([key]) => key), ['statMismatches', 'statUnverified', 'evidenceWarnings'])
  assert.equal(result.missing, false)
})

test('이전 요약은 기존 경고를 보존하면서 새 검사가 미적용된 것으로 표시한다', () => {
  const result = summaryCheckStatus({ strangeNumbers: ['99건'] })
  assert.equal(result.missing, true)
  assert.equal(result.issues[0][0], 'strangeNumbers')
  assert.equal(summaryCheckStatus(null).missing, true)
})
