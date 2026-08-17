import assert from 'node:assert/strict'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  applyGitBashEnvironment,
  assetSizeLabel,
  buildGitBashFailedOptions,
  buildGitBashPromptOptions,
  buildGitBashReadyNotification,
  detectSystemGitBash,
  ensureMinimalGitBashPreset,
  gitBashStatePath,
  isWslBashDirectory,
  managedGitBashPath,
  minimalGitBashPresetTarget,
  MINIMAL_GITBASH_PRESET_NAME,
  pickPortableGitAsset,
  readGitBashState,
  REASK_FAILED_MS,
  REASK_SKIPPED_MS,
  shouldPromptGitBash,
  writeGitBashState,
} from '../lib/git-bash.mjs'

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
    'C:\\Windows\\system',
    '',
  ]) {
    assert.equal(isWslBashDirectory(dir), false)
  }
  assert.equal(isWslBashDirectory(undefined), false)
})

test('detectSystemGitBash probes GIT_BASH then install roots then PATH, skipping WSL stubs', () => {
  const env = {
    GIT_BASH: 'C:\\tools\\git\\bin\\bash.exe',
    ProgramFiles: 'C:\\Program Files',
    'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local',
    PATH: 'C:\\Windows\\System32;C:\\Users\\test\\AppData\\Local\\Programs\\Git\\cmd',
  }
  const existing = new Set([
    env.GIT_BASH,
    `${env.ProgramFiles}\\Git\\bin\\bash.exe`,
    `${env.LOCALAPPDATA}\\Programs\\Git\\bin\\bash.exe`,
    'C:\\Users\\test\\AppData\\Local\\Programs\\Git\\cmd\\bash.exe',
  ])
  const exists = (candidate) => existing.has(candidate)

  assert.equal(detectSystemGitBash(env, exists), env.GIT_BASH)

  const withoutExplicit = { ...env, GIT_BASH: undefined }
  assert.equal(
    detectSystemGitBash(withoutExplicit, exists),
    `${env.ProgramFiles}\\Git\\bin\\bash.exe`,
  )

  const withoutProgramFiles = { ...withoutExplicit, ProgramFiles: undefined }
  assert.equal(
    detectSystemGitBash(withoutProgramFiles, exists),
    `${env.LOCALAPPDATA}\\Programs\\Git\\bin\\bash.exe`,
  )

  const withoutLocalAppData = {
    ...withoutProgramFiles,
    LOCALAPPDATA: undefined,
  }
  assert.equal(
    detectSystemGitBash(withoutLocalAppData, exists),
    'C:\\Users\\test\\AppData\\Local\\Programs\\Git\\cmd\\bash.exe',
  )

  const onlyWsl = {
    ...withoutProgramFiles,
    LOCALAPPDATA: undefined,
    PATH: 'C:\\Windows\\System32;C:\\Windows\\SysWOW64',
  }
  assert.equal(detectSystemGitBash(onlyWsl, exists), null)

  assert.equal(detectSystemGitBash({}, exists), null)
  assert.equal(
    detectSystemGitBash({}, (candidate) => candidate === 'fallback'),
    null,
  )
})

test('pickPortableGitAsset selects the 64-bit PortableGit 7z.exe asset', () => {
  const release = {
    assets: [
      { name: 'Git-2.51.0-64-bit.exe', size: 65000000 },
      { name: 'PortableGit-2.51.0-32-bit.7z.exe', size: 300000000 },
      {
        name: 'PortableGit-2.51.0-64-bit.7z.exe',
        browser_download_url: 'https://example.invalid/PortableGit.7z.exe',
        size: 350000000,
      },
      { name: 'MinGit-2.51.0-64-bit.zip', size: 50000000 },
    ],
  }
  const asset = pickPortableGitAsset(release)
  assert.equal(asset.name, 'PortableGit-2.51.0-64-bit.7z.exe')
  assert.equal(asset.url, 'https://example.invalid/PortableGit.7z.exe')
  assert.equal(asset.size, 350000000)

  assert.equal(pickPortableGitAsset({ assets: [] }), null)
  assert.equal(pickPortableGitAsset({}), null)
  assert.equal(
    pickPortableGitAsset({
      assets: [{ name: 'MinGit-2.51.0-64-bit.zip', size: 1 }],
    }),
    null,
  )
  assert.equal(pickPortableGitAsset(undefined), null)
})

test('assetSizeLabel renders human sizes', () => {
  assert.equal(assetSizeLabel(350 * 1024 * 1024), '约 350 MB')
  assert.equal(assetSizeLabel(Math.round(1.5 * 1024 * 1024)), '约 1.5 MB')
  assert.equal(assetSizeLabel(0), '未知大小')
  assert.equal(assetSizeLabel(undefined), '未知大小')
  assert.equal(assetSizeLabel(NaN), '未知大小')
})

test('git-bash state round-trips through the state file', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-git-bash-state-'))
  try {
    const filePath = path.join(root, 'nested', 'git-bash-state.json')
    assert.equal(readGitBashState(filePath), null)
    writeGitBashState(filePath, { skippedAt: 42 })
    assert.deepEqual(JSON.parse(readFileSync(filePath, 'utf8')), {
      skippedAt: 42,
    })
    assert.deepEqual(readGitBashState(filePath), { skippedAt: 42 })
    writeFileSync(filePath, '{broken', 'utf8')
    assert.equal(readGitBashState(filePath), null)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('shouldPromptGitBash respects skip and failure windows', () => {
  const now = 1_000_000
  assert.equal(shouldPromptGitBash(null, now), true)
  assert.equal(shouldPromptGitBash({}, now), true)
  assert.equal(
    shouldPromptGitBash({ skippedAt: now - REASK_SKIPPED_MS + 1 }, now),
    false,
    'recent skip stays quiet',
  )
  assert.equal(
    shouldPromptGitBash({ skippedAt: now - REASK_SKIPPED_MS - 1 }, now),
    true,
    'expired skip asks again',
  )
  assert.equal(
    shouldPromptGitBash({ failedAt: now - REASK_FAILED_MS + 1 }, now),
    false,
    'recent failure stays quiet',
  )
  assert.equal(
    shouldPromptGitBash({ failedAt: now - REASK_FAILED_MS - 1 }, now),
    true,
    'expired failure asks again',
  )
  assert.equal(
    shouldPromptGitBash({ installed: { at: '2025-01-01' } }, now),
    true,
    'payload gone again asks again',
  )
})

test('buildGitBashPromptOptions explains the purpose and sizes the download', () => {
  const options = buildGitBashPromptOptions({
    name: 'PortableGit-2.51.0-64-bit.7z.exe',
    url: 'https://example.invalid/PortableGit.7z.exe',
    size: 350 * 1024 * 1024,
  })
  assert.equal(options.type, 'question')
  assert.equal(options.title, '需要下载 Git Bash')
  assert.match(options.message, /极简模式/)
  assert.match(options.detail, /Windows 默认没有 bash/)
  assert.match(options.detail, /不修改系统/)
  assert.match(options.detail, /约 350 MB/)
  assert.match(options.detail, /https:\/\/example\.invalid/)
  assert.deepEqual(options.buttons, ['立即下载', '稍后再说'])
  assert.equal(options.defaultId, 0)
  assert.equal(options.cancelId, 1)
  assert.equal(options.checkboxLabel, '不再询问')
})

test('ready notification and failure dialog carry the right copy', () => {
  const ready = buildGitBashReadyNotification()
  assert.match(ready.title, /Git Bash 已就绪/)
  assert.match(ready.body, /极简模式/)

  const failed = buildGitBashFailedOptions('网络超时')
  assert.equal(failed.type, 'error')
  assert.match(failed.detail, /网络超时/)
  assert.match(failed.detail, /git-scm\.com/)
  assert.match(failed.detail, /一天内不会重复弹窗/)
})

test('applyGitBashEnvironment sets GIT_BASH and prefixes PATH once', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-git-bash-env-'))
  try {
    const binDir = path.join(root, 'git-bash', 'bin')
    mkdirSync(binDir, { recursive: true })
    const bashPath = path.join(binDir, 'bash.exe')

    const environment = { Path: `C:\\Windows\\System32` }
    applyGitBashEnvironment(environment, bashPath)
    assert.equal(environment.GIT_BASH, bashPath)
    assert.equal(
      environment.Path,
      `${binDir}${path.delimiter}C:\\Windows\\System32`,
    )

    applyGitBashEnvironment(environment, bashPath)
    assert.equal(
      environment.Path,
      `${binDir}${path.delimiter}C:\\Windows\\System32`,
      'same launch applies the prefix only once',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('path helpers anchor the managed installation under the app data dir', () => {
  const userData = 'C:\\Users\\test\\AppData\\Roaming\\DeepSeek Harness'
  assert.equal(
    managedGitBashPath(userData),
    'C:\\Users\\test\\AppData\\Roaming\\DeepSeek Harness\\runtime-tools\\git-bash\\bin\\bash.exe',
  )
  assert.ok(
    gitBashStatePath(userData).endsWith('runtime-tools\\git-bash-state.json'),
  )
})

test('minimalGitBashPresetTarget anchors under the shared DSH home', () => {
  assert.equal(
    minimalGitBashPresetTarget('C:\\Users\\test\\.dsh'),
    'C:\\Users\\test\\.dsh\\.agent-presets\\minimal-gitbash',
  )
  assert.ok(
    minimalGitBashPresetTarget('C:\\Users\\test\\.dsh').endsWith(
      MINIMAL_GITBASH_PRESET_NAME,
    ),
  )
})

test('ensureMinimalGitBashPreset installs idempotently and never overwrites', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-preset-deploy-'))
  try {
    const dshHome = path.join(root, 'dsh-home')
    const presetsDirectory = path.join(root, 'bundled-presets')
    const sourceDirectory = path.join(
      presetsDirectory,
      MINIMAL_GITBASH_PRESET_NAME,
    )
    mkdirSync(sourceDirectory, { recursive: true })
    writeFileSync(
      path.join(sourceDirectory, 'agent.cordis.yml'),
      'preset: bundled\n',
      'utf8',
    )
    writeFileSync(
      path.join(sourceDirectory, 'gitbash-executor.mjs'),
      '// executor\n',
      'utf8',
    )

    const first = ensureMinimalGitBashPreset({ dshHome, presetsDirectory })
    assert.equal(first.status, 'installed')
    assert.equal(
      readFileSync(
        path.join(minimalGitBashPresetTarget(dshHome), 'agent.cordis.yml'),
        'utf8',
      ),
      'preset: bundled\n',
    )
    assert.equal(
      readFileSync(
        path.join(minimalGitBashPresetTarget(dshHome), 'gitbash-executor.mjs'),
        'utf8',
      ),
      '// executor\n',
    )

    // User edits the installed copy; a later boot must not overwrite it.
    writeFileSync(
      path.join(minimalGitBashPresetTarget(dshHome), 'agent.cordis.yml'),
      'preset: user tweaks\n',
      'utf8',
    )
    const second = ensureMinimalGitBashPreset({ dshHome, presetsDirectory })
    assert.equal(second.status, 'present')
    assert.equal(
      readFileSync(
        path.join(minimalGitBashPresetTarget(dshHome), 'agent.cordis.yml'),
        'utf8',
      ),
      'preset: user tweaks\n',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('ensureMinimalGitBashPreset skips without a bundle and reports failures without throwing', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-preset-missing-'))
  try {
    assert.deepEqual(
      ensureMinimalGitBashPreset({ dshHome: root, presetsDirectory: '' }),
      {
        status: 'skipped',
      },
    )
    assert.deepEqual(
      ensureMinimalGitBashPreset({ dshHome: '', presetsDirectory: root }),
      {
        status: 'skipped',
      },
    )
    assert.deepEqual(
      ensureMinimalGitBashPreset({
        dshHome: root,
        presetsDirectory: path.join(root, 'no-such-dir'),
      }),
      { status: 'skipped' },
    )

    // Target parent occupied by a file makes the mkdir fail: reported, not thrown.
    const blocked = path.join(root, 'blocked')
    mkdirSync(blocked, { recursive: true })
    writeFileSync(
      path.join(blocked, '.agent-presets'),
      'not a directory',
      'utf8',
    )
    const presetsDirectory = path.join(root, 'presets')
    mkdirSync(path.join(presetsDirectory, MINIMAL_GITBASH_PRESET_NAME), {
      recursive: true,
    })
    writeFileSync(
      path.join(
        presetsDirectory,
        MINIMAL_GITBASH_PRESET_NAME,
        'agent.cordis.yml',
      ),
      'x',
      'utf8',
    )
    const outcome = ensureMinimalGitBashPreset({
      dshHome: blocked,
      presetsDirectory,
    })
    assert.equal(outcome.status, 'failed')
    assert.equal(typeof outcome.error, 'string')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
