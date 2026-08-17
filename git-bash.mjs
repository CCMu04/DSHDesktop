/**
 * Git Bash on-demand provisioning for the DSH Desktop on Windows.
 *
 * DSH's Minimal mode keeps a `bash` tool, but Windows ships without bash: the
 * official preset (`minimal`) relies on a persistent PTY shell that
 * `subprocess-local` cannot start on win32, and the community
 * `minimal-gitbash` preset (dsh-gitbash-preset) maps every bash call onto
 * Git for Windows' bash. This module makes that preset work out of the box:
 *
 *  - if a system Git for Windows is already installed, it is detected in the
 *    same order as the preset probes (GIT_BASH env → install roots → PATH,
 *    skipping the WSL launcher stubs under System32) and used silently;
 *  - otherwise the user is asked (with an explanation of what the download is
 *    for and how big it is), the latest PortableGit release is downloaded
 *    from the official Git for Windows GitHub releases, extracted with the
 *    bundled 7-Zip (dev fallbacks included) into the app's own data
 *    directory, and made available to the backend through the `GIT_BASH`
 *    environment variable plus a PATH prefix (bin + usr\bin).
 *
 * Nothing here touches the system: no installer, no admin rights, no
 * registry. The download decision is remembered in a small state file so the
 * prompt does not nag on every launch. Only the pure helpers are exported
 * for tests; the Electron wiring (fetch / dialogs / notifications / loading
 * status) is injected by main.mjs.
 */

import { spawn } from 'node:child_process'
import {
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

/** GitHub repository whose latest release carries the PortableGit archive. */
export const GIT_FOR_WINDOWS_RELEASES_URL =
  'https://api.github.com/repos/git-for-windows/git/releases/latest'
/** How long a user "skip" decision suppresses the prompt (7 days). */
export const REASK_SKIPPED_MS = 7 * 24 * 60 * 60 * 1000
/** How long a failed download suppresses the prompt (1 day). */
export const REASK_FAILED_MS = 24 * 60 * 60 * 1000
/** Overall download guard; a stalled connection must not block startup forever. */
const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000

const WSL_BASH_DIRECTORY_PATTERN = /(?:\\|\/)(?:system32|sysnative|syswow64)$/i

/**
 * True for the directories that hold Microsoft's bash.exe stubs (the WSL
 * launcher): `<SystemRoot>\System32` and its WoW64 mirrors. The stub only
 * bridges to `wsl.exe` — using it as the shell fails with "no installed
 * distribution" when WSL has no distro. Same rule as dsh-gitbash-preset.
 */
export function isWslBashDirectory(dir) {
  if (typeof dir !== 'string' || dir.length === 0) return false
  return WSL_BASH_DIRECTORY_PATTERN.test(dir)
}

/**
 * Probe for an existing Git for Windows bash in the same order the
 * `minimal-gitbash` preset does: explicit GIT_BASH → standard install roots
 * → every real bash.exe on PATH (WSL launcher stubs skipped). Returns the
 * first path that `exists` accepts, or null.
 */
export function detectSystemGitBash(env = process.env, exists = existsSync) {
  const candidates = [
    env.GIT_BASH,
    env.ProgramFiles === undefined
      ? undefined
      : `${env.ProgramFiles}\\Git\\bin\\bash.exe`,
    env['ProgramFiles(x86)'] === undefined
      ? undefined
      : `${env['ProgramFiles(x86)']}\\Git\\bin\\bash.exe`,
    env.LOCALAPPDATA === undefined
      ? undefined
      : `${env.LOCALAPPDATA}\\Programs\\Git\\bin\\bash.exe`,
  ]
  if (typeof env.PATH === 'string' && env.PATH.length > 0) {
    for (const dir of env.PATH.split(';')) {
      if (dir.length === 0 || isWslBashDirectory(dir)) continue
      candidates.push(`${dir}\\bash.exe`)
    }
  }
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || candidate.length === 0) continue
    if (exists(candidate)) return candidate
  }
  return null
}

/**
 * Pick the 64-bit PortableGit self-extracting archive from a GitHub release
 * payload (the asset name looks like `PortableGit-2.51.0-64-bit.7z.exe`).
 * Returns null when the release carries no such asset — the caller decides
 * whether that is an error.
 */
export function pickPortableGitAsset(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : []
  const asset = assets.find(
    (item) =>
      typeof item?.name === 'string' &&
      /^PortableGit-[0-9][^-]*-64-bit\.7z\.exe$/i.test(item.name),
  )
  if (!asset) return null
  return {
    name: asset.name,
    url:
      typeof asset.browser_download_url === 'string'
        ? asset.browser_download_url
        : '',
    size: Number.isFinite(asset.size) && asset.size > 0 ? asset.size : 0,
  }
}

/** Human label for a byte count (used in the prompt, e.g. 约 350 MB). */
export function assetSizeLabel(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '未知大小'
  const mb = bytes / (1024 * 1024)
  return mb >= 100
    ? `约 ${Math.round(mb)} MB`
    : `约 ${Math.round(mb * 10) / 10} MB`
}

export function gitBashStatePath(userDataDirectory) {
  return path.join(userDataDirectory, 'runtime-tools', 'git-bash-state.json')
}

/** Where the managed PortableGit installation lives under the app data dir. */
export function managedGitBashPath(userDataDirectory) {
  return path.join(
    userDataDirectory,
    'runtime-tools',
    'git-bash',
    'bin',
    'bash.exe',
  )
}

export function readGitBashState(filePath) {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : null
  } catch {
    return null
  }
}

export function writeGitBashState(filePath, state) {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

/**
 * Whether the user should be asked again, given the remembered state:
 * no state → ask; a recent skip (7 days) or failure (1 day) → stay quiet;
 * anything older (or a bare `installed` record with the payload missing
 * again) → ask once more.
 */
export function shouldPromptGitBash(state, nowMs) {
  if (!state) return true
  if (
    typeof state.skippedAt === 'number' &&
    nowMs - state.skippedAt < REASK_SKIPPED_MS
  )
    return false
  if (
    typeof state.failedAt === 'number' &&
    nowMs - state.failedAt < REASK_FAILED_MS
  )
    return false
  return true
}

/**
 * Make the backend see the bash: `GIT_BASH` (the first probe source of the
 * minimal-gitbash preset) plus a PATH prefix for bin and usr\bin, so git and
 * the MSYS coreutils are reachable too. Existing path keys are reused
 * whatever their casing; nothing is added twice within one launch.
 */
export function applyGitBashEnvironment(environment, bashPath) {
  if (!environment) return bashPath
  environment.GIT_BASH = bashPath
  const binDir = path.dirname(bashPath)
  const usrBinDir = path.join(binDir, '..', 'usr', 'bin')
  const pathKeys = Object.keys(environment).filter(
    (key) => key.toLowerCase() === 'path',
  )
  const pathKey = pathKeys[0] ?? 'Path'
  const current = environment[pathKey] ?? ''
  for (const duplicateKey of pathKeys.slice(1)) delete environment[duplicateKey]
  const prefix = [binDir, usrBinDir]
    .filter((dir) => existsSync(dir))
    .join(path.delimiter)
  if (prefix !== '' && !current.startsWith(`${prefix}${path.delimiter}`)) {
    environment[pathKey] = current
      ? `${prefix}${path.delimiter}${current}`
      : prefix
  }
  return bashPath
}

/**
 * Dialog copy that explains what the download is for: DSH's Minimal mode
 * (Git Bash) preset needs a bash on Windows, and Git for Windows provides
 * it. The detail lists the purpose, the size, that it stays inside the app
 * data directory, and that installing Git manually is the alternative.
 */
export function buildGitBashPromptOptions(asset) {
  const source =
    typeof asset?.url === 'string' && asset.url !== ''
      ? asset.url
      : (asset?.name ?? '')
  return {
    type: 'question',
    title: '需要下载 Git Bash',
    message: '「极简模式 (Git Bash)」需要 bash 环境',
    detail: [
      '这是干什么用的：DSH 的极简模式预设通过 bash 工具执行命令，但 Windows 默认没有 bash，',
      '所以该预设目前在你的电脑上不可用。桌面端将自动下载 Git for Windows 便携版并解压到',
      '应用数据目录（不修改系统、不需要管理员权限），之后「极简模式 (Git Bash)」就能直接使用。',
      '',
      `将下载：${source}（${assetSizeLabel(asset?.size)}）`,
      '也可选择「稍后再说」，自行安装 Git for Windows（https://git-scm.com/download/win），重启应用后会自动识别。',
    ].join('\n'),
    buttons: ['立即下载', '稍后再说'],
    defaultId: 0,
    cancelId: 1,
    checkboxLabel: '不再询问',
    noLink: true,
  }
}

export function buildGitBashReadyNotification() {
  return {
    title: 'Git Bash 已就绪',
    body: '「极简模式 (Git Bash)」现在可以在 Windows 上使用了。',
  }
}

export function buildGitBashFailedOptions(errorMessage) {
  return {
    type: 'error',
    title: 'Git Bash 下载失败',
    message: '未能自动安装 Git Bash',
    detail: [
      errorMessage
        ? `原因：${errorMessage}`
        : '无法连接到 Git for Windows 下载服务。',
      '',
      '其他会话不受影响。可稍后自行安装 Git for Windows（https://git-scm.com/download/win），',
      '或重新启动应用重试（一天内不会重复弹窗）。',
    ].join('\n'),
    buttons: ['好的'],
    noLink: true,
  }
}

/**
 * Resolve the PortableGit asset of the latest stable Git for Windows
 * release. The GitHub API is rate-limited for anonymous callers, so a
 * failure here is not fatal: the caller reports it and lets the user install
 * Git manually.
 */
async function resolveLatestPortableGitAsset(fetch) {
  const response = await fetch(GIT_FOR_WINDOWS_RELEASES_URL, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'deepseek-harness-desktop',
    },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`GitHub API 返回 HTTP ${response.status}`)
  const release = await response.json()
  const asset = pickPortableGitAsset(release)
  if (!asset)
    throw new Error('Git for Windows 最新版本中没有找到 PortableGit 资源')
  return asset
}

/**
 * Stream the archive into `<downloads>/portable-git.7z.exe.tmp`, throttled
 * loading-status updates on total size, then rename into place.
 */
async function downloadPortableGit(
  fetch,
  url,
  destination,
  totalBytes,
  loadingStatus,
) {
  const temporary = `${destination}.tmp`
  rmSync(temporary, { force: true })
  const response = await fetch(url, {
    headers: {
      'user-agent': 'deepseek-harness-desktop',
      accept: 'application/octet-stream',
    },
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`下载返回 HTTP ${response.status}`)
  const length =
    totalBytes > 0
      ? totalBytes
      : Number(response.headers.get('content-length')) > 0
        ? Number(response.headers.get('content-length'))
        : 0
  const reader = response.body?.getReader?.()
  if (!reader) throw new Error('无法读取下载响应')
  const writer = createWriteStream(temporary)
  let transferred = 0
  let lastReportAt = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      transferred += value.byteLength
      if (!writer.write(Buffer.from(value))) {
        await new Promise((resolve) => writer.once('drain', resolve))
      }
      if (loadingStatus && length > 0 && Date.now() - lastReportAt > 400) {
        lastReportAt = Date.now()
        await loadingStatus(
          `正在下载 Git Bash（${assetSizeLabel(length)}）…${Math.min(99, Math.floor((transferred * 100) / length))}%`,
        )
      }
    }
  } finally {
    reader.releaseLock?.()
  }
  await new Promise((resolve, reject) => {
    writer.once('finish', resolve)
    writer.once('error', reject)
    writer.end()
  })
  renameSync(temporary, destination)
}

/**
 * Extract the PortableGit self-extracting archive into the managed target
 * directory. Preferred extractor is the 7-Zip console binary: bundled in the
 * packaged runtime (`runtime/7za-<arch>.exe`, the same one that unpacks
 * dsh-runtime.7z), present as a devDependency in source checkouts, or on
 * PATH — 7za can open the 7z payload inside the SFX exe. As a last resort
 * run the archive itself with `-y -o<dir>`. Each failed attempt cleans the
 * partial target so retries start from a clean slate.
 */
async function extractPortableGit({
  archivePath,
  targetDirectory,
  shellDirectory,
  resourcesPath,
  arch,
  run,
  exists,
  bashPath,
}) {
  const candidates = [
    resourcesPath
      ? {
          command: path.join(resourcesPath, 'runtime', `7za-${arch}.exe`),
          probe: true,
        }
      : null,
    shellDirectory
      ? {
          command: path.join(
            shellDirectory,
            'node_modules',
            '7zip-bin',
            'win',
            arch,
            '7za.exe',
          ),
          probe: true,
        }
      : null,
    { command: '7za.exe', probe: false },
    { command: '7z.exe', probe: false },
  ].filter(Boolean)
  for (const { command, probe } of candidates) {
    if (probe && !exists(command)) continue
    rmSync(targetDirectory, { recursive: true, force: true })
    mkdirSync(targetDirectory, { recursive: true })
    try {
      await run(command, [
        'x',
        archivePath,
        `-o${targetDirectory}`,
        '-y',
        '-bb0',
      ])
      if (exists(bashPath)) return bashPath
    } catch {
      // Try the next extractor.
    }
  }
  rmSync(targetDirectory, { recursive: true, force: true })
  mkdirSync(targetDirectory, { recursive: true })
  await run(archivePath, ['-y', `-o${targetDirectory}`])
  if (!exists(bashPath)) throw new Error('解压完成后未找到 bash.exe')
  return bashPath
}

/**
 * Provision Git Bash so the windowed backend sees it. Never throws: every
 * failure path reports through the injected dialog and returns null. Returns
 * the resolved bash path (and mutates `environment`) when bash is available.
 *
 * Order of resolution:
 *  1. managed PortableGit already installed in the app data directory;
 *  2. a system Git for Windows found on this machine (silent, no prompt);
 *  3. otherwise, if the prompt is not suppressed by remembered state, ask
 *     the user, download the latest PortableGit, extract it, and wire the
 *     environment.
 */
export async function ensureGitBash({
  userDataDirectory,
  shellDirectory,
  environment,
  resourcesPath = process.resourcesPath,
  arch = process.arch,
  platform = process.platform,
  fetch,
  showMessageBox,
  notify,
  loadingStatus,
  exists = existsSync,
  now = Date.now,
}) {
  if (platform !== 'win32') return null
  try {
    const stateFile = gitBashStatePath(userDataDirectory)
    const state = readGitBashState(stateFile)

    const managedBash = managedGitBashPath(userDataDirectory)
    if (exists(managedBash)) {
      applyGitBashEnvironment(environment, managedBash)
      return managedBash
    }

    const systemBash = detectSystemGitBash(process.env, exists)
    if (systemBash !== null) {
      applyGitBashEnvironment(environment, systemBash)
      return systemBash
    }

    if (!shouldPromptGitBash(state, now())) return null

    const asset = await resolveLatestPortableGitAsset(fetch)
    const { response, checkboxChecked } = await showMessageBox(
      buildGitBashPromptOptions(asset),
    )
    if (response !== 0 || checkboxChecked) {
      writeGitBashState(stateFile, { ...state, skippedAt: now() })
      return null
    }

    const targetDirectory = path.join(
      userDataDirectory,
      'runtime-tools',
      'git-bash',
    )
    const downloadDirectory = path.join(
      userDataDirectory,
      'runtime-tools',
      'downloads',
    )
    mkdirSync(downloadDirectory, { recursive: true })
    const archivePath = path.join(downloadDirectory, 'portable-git.7z.exe')

    await downloadPortableGit(
      fetch,
      asset.url,
      archivePath,
      asset.size,
      loadingStatus,
    )
    if (loadingStatus) await loadingStatus('正在解压 Git Bash…')
    const bashPath = await extractPortableGit({
      archivePath,
      targetDirectory,
      shellDirectory,
      resourcesPath,
      arch,
      run: spawnRunner,
      exists,
      bashPath: managedBash,
    })
    rmSync(downloadDirectory, { recursive: true, force: true })

    applyGitBashEnvironment(environment, bashPath)
    writeGitBashState(stateFile, {
      ...state,
      installed: {
        name: asset.name,
        url: asset.url,
        at: new Date(now()).toISOString(),
      },
    })
    try {
      notify(buildGitBashReadyNotification())
    } catch {}
    return bashPath
  } catch (error) {
    try {
      const options = buildGitBashFailedOptions(
        error instanceof Error ? error.message : String(error),
      )
      await showMessageBox(options)
    } catch {}
    try {
      const stateFile = gitBashStatePath(userDataDirectory)
      const state = readGitBashState(stateFile)
      writeGitBashState(stateFile, {
        ...state,
        failedAt: new Date(now()).getTime(),
      })
    } catch {}
    return null
  }
}

// Spawn runner used by ensureGitBash (extraction); the module owns process
// spawning so tests only exercise the pure helpers. stdout/stderr are
// ignored: 7za is quiet with -bb0 and the SFX fallback prints nothing
// useful on success.
function spawnRunner(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: 'ignore' })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${path.basename(command)} 退出码 ${code}`))
    })
  })
}

// ── 内置「极简模式 (Git Bash)」agent preset 部署 ───────────────────────────
//
// bash 环境之外，Web 界面还需要 preset 本体才可选。DSH 的预设发现机制是
// 启动时扫描 `${DSH_HOME}/.agent-presets/*/agent.cordis.yml`（每个目录名即
// 一个 roster 行），因此把打包的 presets/minimal-gitbash/ 幂等地复制到
// 用户预设根即可，无需任何插件行或注册表。复制必须在后端启动前完成。

/** 内置预设的目录名（同时是 DSH roster 的 preset id）。 */
export const MINIMAL_GITBASH_PRESET_NAME = 'minimal-gitbash'

/** 内置预设的目标目录：`${dshHome}/.agent-presets/minimal-gitbash/`。 */
export function minimalGitBashPresetTarget(dshHome) {
  return path.join(dshHome, '.agent-presets', MINIMAL_GITBASH_PRESET_NAME)
}

/**
 * 把打包的 minimal-gitbash 预设部署到用户的 DSH_HOME。已存在（用户可能改过）
 * 或源缺失时不动；出错也不抛——由返回值汇报，桌面端启动绝不能被预设部署打断。
 * 返回 { status: 'installed' | 'present' | 'skipped' | 'failed', error? }。
 */
export function ensureMinimalGitBashPreset({
  dshHome,
  presetsDirectory,
  exists = existsSync,
}) {
  try {
    if (typeof dshHome !== 'string' || dshHome === '')
      return { status: 'skipped' }
    if (typeof presetsDirectory !== 'string' || presetsDirectory === '')
      return { status: 'skipped' }

    const sourceDirectory = path.join(
      presetsDirectory,
      MINIMAL_GITBASH_PRESET_NAME,
    )
    if (!exists(path.join(sourceDirectory, 'agent.cordis.yml')))
      return { status: 'skipped' }

    const targetDirectory = minimalGitBashPresetTarget(dshHome)
    if (exists(targetDirectory)) return { status: 'present' }

    mkdirSync(path.dirname(targetDirectory), { recursive: true })
    cpSync(sourceDirectory, targetDirectory, { recursive: true, force: false })
    return { status: 'installed' }
  } catch (error) {
    return {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
