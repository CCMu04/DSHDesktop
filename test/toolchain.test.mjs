import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { prepareDesktopToolchain } from '../lib/toolchain.mjs'

test('creates a self-contained DSH and pnpm Agent toolchain', (t) => {
  if (process.platform !== 'win32') return t.skip('Windows command shims')

  const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-desktop-toolchain-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const runtimeDirectory = path.join(root, 'runtime-cache', 'current', 'node_modules', '@deepseek-ai', 'dsh')
  const pnpmDirectory = path.join(root, 'runtime-cache', 'current', 'node_modules', 'pnpm', 'bin')
  mkdirSync(path.join(runtimeDirectory, 'lib'), { recursive: true })
  mkdirSync(pnpmDirectory, { recursive: true })
  writeFileSync(path.join(runtimeDirectory, 'lib', 'bin.js'), '')
  writeFileSync(
    path.join(pnpmDirectory, '..', 'package.json'),
    JSON.stringify({ bin: { pnpm: 'bin/pnpm.mjs', pnpx: 'bin/pnpx.mjs' } }),
  )
  writeFileSync(path.join(pnpmDirectory, 'pnpm.mjs'), '')
  writeFileSync(path.join(pnpmDirectory, 'pnpx.mjs'), '')

  const result = prepareDesktopToolchain({
    userDataDirectory: path.join(root, 'user-data'),
    runtimeDirectory,
    executablePath: 'C:\\Apps\\DeepSeek Harness.exe',
    preloadPath: 'C:\\Apps\\resources\\app.asar\\runtime-preload.cjs',
    dshHome: 'C:\\Users\\test\\.dsh',
    baseEnvironment: { Path: 'C:\\Windows\\System32' },
  })

  assert.equal(result.environment.DSH_HOME, 'C:\\Users\\test\\.dsh')
  assert.equal(result.environment.HARNESS_DESKTOP_PRELOAD, 'C:\\Apps\\resources\\app.asar\\runtime-preload.cjs')
  assert.equal(result.environment.ELECTRON_RUN_AS_NODE, '1')
  assert.equal(
    result.environment.NODE_OPTIONS,
    '--require="C:/Apps/resources/app.asar/runtime-preload.cjs"',
  )
  assert.equal(result.environment.DSH_DESKTOP_MANAGED_TOOLCHAIN, '1')
  assert.equal(
    result.environment.Path,
    `${result.toolchainDirectory};C:\\Windows\\System32`,
  )
  assert.match(readFileSync(path.join(result.toolchainDirectory, 'dsh.cmd'), 'utf8'), /HARNESS_DESKTOP_DSH_ENTRY/)
  assert.match(readFileSync(path.join(result.toolchainDirectory, 'dsh.cmd'), 'utf8'), /--require "%HARNESS_DESKTOP_PRELOAD%"/)
  assert.match(readFileSync(path.join(result.toolchainDirectory, 'pnpm.cmd'), 'utf8'), /HARNESS_DESKTOP_PNPM_ENTRY/)
  assert.match(readFileSync(path.join(result.toolchainDirectory, 'node.cmd'), 'utf8'), /HARNESS_DESKTOP_NODE/)
})
