import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readDismissedVersion, recordDismissedVersion } from '../update-prompt.mjs'

const home = mkdtempSync(join(tmpdir(), 'dsh-update-prompt-test-'))
process.env.DSH_HOME = home
after(() => rmSync(home, { recursive: true, force: true }))

test('readDismissedVersion tolerates missing or broken input', () => {
  assert.equal(readDismissedVersion(), null, 'no file yet')
  writeFileSync(join(home, 'desktop-update-prompt.json'), 'not json')
  assert.equal(readDismissedVersion(), null)
  writeFileSync(join(home, 'desktop-update-prompt.json'), '{"dismissedVersion":42}')
  assert.equal(readDismissedVersion(), null, 'non-string version')
})

test('recordDismissedVersion persists and round-trips', () => {
  recordDismissedVersion('v0.1.0-rc.6.6.4')
  assert.equal(readDismissedVersion(), 'v0.1.0-rc.6.6.4')
  recordDismissedVersion('v0.1.0-rc.6.6.5')
  assert.equal(readDismissedVersion(), 'v0.1.0-rc.6.6.5', 'overwrites')
})

test('recordDismissedVersion ignores empty values', () => {
  recordDismissedVersion('')
  recordDismissedVersion(undefined)
  assert.equal(readDismissedVersion(), 'v0.1.0-rc.6.6.5', 'unchanged')
})
