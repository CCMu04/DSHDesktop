import assert from 'node:assert/strict'
import test from 'node:test'
import { AUTO_CHECK_INTERVAL_MS, shouldAutoCheck } from '../update-throttle.mjs'

test('shouldAutoCheck returns true without any record', () => {
  assert.equal(shouldAutoCheck({ lastCheckedAt: null }), true)
  assert.equal(shouldAutoCheck({}), true)
  assert.equal(shouldAutoCheck(undefined), true)
})

test('shouldAutoCheck waits a full interval after a successful check', () => {
  const now = Date.now()
  assert.equal(
    shouldAutoCheck({ lastCheckedAt: now - AUTO_CHECK_INTERVAL_MS + 1 }, now),
    false,
  )
  assert.equal(shouldAutoCheck({ lastCheckedAt: now }, now), false)
})

test('shouldAutoCheck allows a new check once the interval has elapsed', () => {
  const now = Date.now()
  assert.equal(
    shouldAutoCheck({ lastCheckedAt: now - AUTO_CHECK_INTERVAL_MS }, now),
    true,
  )
  assert.equal(
    shouldAutoCheck({ lastCheckedAt: now - AUTO_CHECK_INTERVAL_MS - 60000 }, now),
    true,
  )
})

test('auto-check interval is one hour', () => {
  assert.equal(AUTO_CHECK_INTERVAL_MS, 60 * 60 * 1000)
})
