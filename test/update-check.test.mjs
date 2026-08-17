import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildUpdateFailedOptions,
  buildUpdateFoundOptions,
  buildUpToDateOptions,
  compareVersions,
  formatReleaseNotes,
  isUpdateAvailable,
  parseVersionParts,
} from '../lib/update-check.mjs'

test('parseVersionParts strips the v prefix and keeps numeric parts numeric', () => {
  assert.deepEqual(parseVersionParts('v0.1.0-rc.6.6.1'), [0, 1, 0, 'rc', 6, 6, 1])
  assert.deepEqual(parseVersionParts('0.10.2'), [0, 10, 2])
})

test('compareVersions orders numeric parts numerically', () => {
  assert.equal(compareVersions('0.1.0-rc.6.6.1', '0.1.0-rc.6.6.0'), 1)
  assert.equal(compareVersions('0.1.0-rc.6.6.0', '0.1.0-rc.6.6.1'), -1)
  assert.equal(compareVersions('0.1.0-rc.6.10.0', '0.1.0-rc.6.9.0'), 1)
  assert.equal(compareVersions('0.1.0-rc.6.6.1', '0.1.0-rc.6.6.1'), 0)
  assert.equal(compareVersions('v0.1.0-rc.6.6.1', '0.1.0-rc.6.6.1'), 0)
})

test('isUpdateAvailable compares latest against current', () => {
  assert.equal(isUpdateAvailable('0.1.0-rc.6.6.0', '0.1.0-rc.6.6.1'), true)
  assert.equal(isUpdateAvailable('0.1.0-rc.6.6.1', '0.1.0-rc.6.6.1'), false)
  assert.equal(isUpdateAvailable('0.1.0-rc.6.6.1', '0.1.0-rc.6.6.0'), false)
})

test('formatReleaseNotes strips markdown headings and HTML and truncates', () => {
  assert.equal(formatReleaseNotes(undefined), '')
  assert.equal(formatReleaseNotes(''), '')
  assert.equal(formatReleaseNotes('# 标题\n正文 <b>x</b>'), '标题\n正文 x')
  const long = 'x'.repeat(900)
  const result = formatReleaseNotes(long)
  assert.equal(result.length, 801)
  assert.ok(result.endsWith('…'))
})

test('update-found dialog lists both versions and offers download', () => {
  const options = buildUpdateFoundOptions('0.1.0-rc.6.6.0', {
    tag_name: 'v0.1.0-rc.6.6.1',
    html_url: 'https://github.com/CCMu04/DSHDesktop/releases/tag/v0.1.0-rc.6.6.1',
    published_at: '2026-08-16T00:00:00Z',
    body: '# 修复\n- something',
  })
  assert.equal(options.message, 'DeepSeek Harness v0.1.0-rc.6.6.1 已发布')
  assert.ok(options.detail.includes('当前版本：0.1.0-rc.6.6.0'))
  assert.ok(options.detail.includes('最新版本：v0.1.0-rc.6.6.1'))
  assert.ok(options.detail.includes('发布时间：2026-08-16'))
  assert.deepEqual(options.buttons, ['前往下载', '暂不'])
  assert.equal(options.defaultId, 0)
  assert.equal(options.cancelId, 1)
})

test('up-to-date and failure dialogs are terse', () => {
  assert.equal(buildUpToDateOptions('0.1.0-rc.6.6.1').message, '已是最新版本')
  assert.ok(buildUpToDateOptions('0.1.0-rc.6.6.1').detail.includes('0.1.0-rc.6.6.1'))
  const failed = buildUpdateFailedOptions('HTTP 403')
  assert.equal(failed.type, 'error')
  assert.ok(failed.detail.includes('HTTP 403'))
  assert.ok(buildUpdateFailedOptions(undefined).detail.includes('无法连接'))
})
