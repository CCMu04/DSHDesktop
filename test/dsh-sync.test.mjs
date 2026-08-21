import assert from 'node:assert/strict'
import test from 'node:test'

import {
  nextDesktopVersion,
  normalizeDshSelector,
  normalizePublishedVersion,
  pinRuntimePackages,
} from '../lib/dsh-sync.mjs'

test('DSH selector follows latest by default and accepts exact previews', () => {
  assert.equal(normalizeDshSelector(undefined), 'latest')
  assert.equal(normalizeDshSelector('  '), 'latest')
  assert.equal(normalizeDshSelector('next'), 'next')
  assert.equal(normalizeDshSelector(' 0.1.0-rc.8 '), '0.1.0-rc.8')
})

test('DSH selector rejects ranges and package specs', () => {
  assert.throws(() => normalizeDshSelector('>=0.1.0'), /Invalid DSH_VERSION/)
  assert.throws(
    () => normalizeDshSelector('file:../dsh'),
    /Invalid DSH_VERSION/,
  )
  assert.throws(
    () => normalizeDshSelector('@deepseek-ai/dsh'),
    /Invalid DSH_VERSION/,
  )
})

test('published version accepts npm 10 and npm 12 output shapes', () => {
  assert.equal(normalizePublishedVersion('0.1.0-rc.8'), '0.1.0-rc.8')
  assert.equal(normalizePublishedVersion(['0.1.0-rc.8']), '0.1.0-rc.8')
  assert.equal(normalizePublishedVersion(['0.1.0-rc.8', '0.1.0-rc.9']), null)
  assert.equal(normalizePublishedVersion([]), null)
})

test('runtime packages are pinned in their existing dependency bucket', () => {
  const source = {
    dependencies: { '@deepseek-ai/dsh': '0.1.0-rc.7', pnpm: '11.22.0' },
    devDependencies: { '@deepseek-ai/dsh-settings': '0.1.0-rc.7' },
  }
  const pinned = pinRuntimePackages(
    source,
    ['@deepseek-ai/dsh', '@deepseek-ai/dsh-settings'],
    '0.1.0-rc.8',
  )
  assert.equal(pinned.dependencies['@deepseek-ai/dsh'], '0.1.0-rc.8')
  assert.equal(pinned.devDependencies['@deepseek-ai/dsh-settings'], '0.1.0-rc.8')
  assert.equal(pinned.dependencies.pnpm, '11.22.0')
  assert.equal(source.dependencies['@deepseek-ai/dsh'], '0.1.0-rc.7')
  assert.throws(
    () => pinRuntimePackages(source, ['@deepseek-ai/missing'], '0.1.0-rc.8'),
    /undeclared runtime package/,
  )
})

test('desktop version keeps its suffix and advances across DSH releases', () => {
  assert.equal(
    nextDesktopVersion('0.1.0-rc.7.6.6', '0.1.0-rc.8'),
    '0.1.0-rc.8.6.7',
  )
  assert.equal(nextDesktopVersion('0.1.0-rc.8', '0.1.0-rc.8'), '0.1.0-rc.8')
})
