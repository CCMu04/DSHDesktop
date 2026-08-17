import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AUTO_CHECK_INTERVAL_MS, shouldAutoCheck } from '../lib/update-throttle.mjs'

// 隔离真实用户数据：默认参数路径会读 $DSH_HOME/desktop-auto-update.json，
// 用户机器上存在真实文件时会让「无记录」断言失败。
const home = mkdtempSync(join(tmpdir(), 'dsh-update-throttle-test-'))
process.env.DSH_HOME = home
after(() => rmSync(home, { recursive: true, force: true }))

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
