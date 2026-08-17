import assert from 'node:assert/strict'
import test from 'node:test'
import {
  detectShellPath,
  isWslBashDirectory,
  resolveConfig,
  toWindowsPath,
} from '../presets/minimal-gitbash/gitbash-executor.mjs'

test('isWslBashDirectory recognizes the WSL launcher stub directories', () => {
  for (const dir of [
    'C:\\Windows\\System32',
    'C:\\Windows\\Sysnative',
    'C:\\Windows\\SysWOW64',
    'c:/windows/system32',
  ]) {
    assert.equal(isWslBashDirectory(dir), true)
  }
  for (const dir of [
    'C:\\Program Files\\Git\\bin',
    'C:\\Program Files\\Git',
    'C:\\Windows',
    '',
  ]) {
    assert.equal(isWslBashDirectory(dir), false)
  }
  assert.equal(isWslBashDirectory(undefined), false)
})

test('toWindowsPath converts MSYS drive paths and leaves non-drive paths untouched', (t) => {
  if (process.platform !== 'win32')
    return t.skip('MSYS path conversion is win32-specific')

  assert.equal(toWindowsPath('/d/foo'), 'D:\\foo')
  assert.equal(toWindowsPath('/d'), 'D:\\')
  assert.equal(toWindowsPath('/d/'), 'D:\\')
  assert.equal(toWindowsPath('D:\\foo'), 'D:\\foo')
  assert.equal(toWindowsPath('D:/foo'), 'D:/foo')
  assert.equal(toWindowsPath('/usr/bin'), '/usr/bin')
  assert.equal(toWindowsPath('//server/share'), '//server/share')
  assert.equal(toWindowsPath(''), '')
  assert.equal(toWindowsPath(undefined), undefined)
})

const WINDOWS_ENV = {
  GIT_BASH: 'C:\\tools\\git-bash\\bin\\bash.exe',
  ProgramFiles: 'C:\\Program Files',
  'ProgramFiles(x86)': 'C:\\Program Files (x86)',
  LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local',
  PATH: 'C:\\Windows\\System32;C:\\tools\\bin',
}

test('detectShellPath prefers explicit config, then GIT_BASH, then roots, then PATH', (t) => {
  if (process.platform !== 'win32') return t.skip('Windows Git Bash probing')

  const existing = new Set([
    'C:\\explicit\\bash.exe',
    WINDOWS_ENV.GIT_BASH,
    `${WINDOWS_ENV.ProgramFiles}\\Git\\bin\\bash.exe`,
    `${WINDOWS_ENV.LOCALAPPDATA}\\Programs\\Git\\bin\\bash.exe`,
    'C:\\tools\\bin\\bash.exe',
  ])
  const exists = (candidate) => existing.has(candidate)

  // explicit config wins over everything
  assert.equal(
    detectShellPath('C:\\explicit\\bash.exe', WINDOWS_ENV, exists),
    'C:\\explicit\\bash.exe',
  )
  // GIT_BASH beats install roots
  assert.equal(
    detectShellPath(undefined, WINDOWS_ENV, exists),
    WINDOWS_ENV.GIT_BASH,
  )
  // install roots beat PATH
  const withoutExplicitEnv = { ...WINDOWS_ENV, GIT_BASH: undefined }
  assert.equal(
    detectShellPath(undefined, withoutExplicitEnv, exists),
    `${WINDOWS_ENV.ProgramFiles}\\Git\\bin\\bash.exe`,
  )
  // PATH scan skips System32 (WSL stub) and picks a real bash.exe
  const rootsOnly = {
    ...withoutExplicitEnv,
    ProgramFiles: undefined,
    'ProgramFiles(x86)': undefined,
    LOCALAPPDATA: undefined,
  }
  assert.equal(
    detectShellPath(undefined, rootsOnly, exists),
    'C:\\tools\\bin\\bash.exe',
  )
  // nothing found falls back to the bare name so spawn reports the resolution error
  const nothing = {
    ...rootsOnly,
    PATH: 'C:\\Windows\\System32;C:\\Windows\\SysWOW64',
  }
  assert.equal(detectShellPath(undefined, nothing, exists), 'bash')
})

test('resolveConfig applies defaults and validates numeric bounds', () => {
  const resolved = resolveConfig({})
  assert.equal(resolved.timeoutMs, 120000)
  assert.equal(resolved.maxTimeoutMs, 600000)
  assert.equal(resolved.maxOutputBytes, 64000)
  assert.equal(resolved.maxSpillBytes, 64 * 1024 * 1024)
  assert.equal(resolved.graceMs, 3000)

  assert.throws(() => resolveConfig({ timeoutMs: -1 }), /timeoutMs/)
  assert.throws(() => resolveConfig({ maxOutputBytes: 0 }), /maxOutputBytes/)
  assert.throws(() => resolveConfig({ graceMs: 2147483648 }), /graceMs/)
})
