import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const shellDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = path.join(shellDirectory, 'package.json')

function runNpm(args, capture = false) {
  const npmCli = process.env.npm_execpath
  const command = npmCli ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const commandArgs = npmCli ? [npmCli, ...args] : args
  return execFileSync(command, commandArgs, {
    cwd: shellDirectory,
    encoding: capture ? 'utf8' : undefined,
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  })
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const runtimePackages = Object.keys(manifest.dependencies ?? {}).filter(
  name => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'),
)

if (!runtimePackages.includes('@deepseek-ai/dsh')) {
  throw new Error('The desktop shell does not declare @deepseek-ai/dsh.')
}

const latestDshVersion = JSON.parse(
  runNpm(['view', '@deepseek-ai/dsh', 'dist-tags.latest', '--json'], true).trim(),
)

if (typeof latestDshVersion !== 'string' || !latestDshVersion) {
  throw new Error('Unable to resolve the latest published DSH version.')
}

console.log(`Synchronizing the desktop runtime with DSH ${latestDshVersion}...`)
runNpm([
  'install',
  '--save-exact',
  ...runtimePackages.map(name => `${name}@${latestDshVersion}`),
])

const installedManifest = JSON.parse(
  readFileSync(path.join(shellDirectory, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8'),
)

if (installedManifest.version !== latestDshVersion) {
  throw new Error(
    `Installed DSH ${installedManifest.version} does not match registry latest ${latestDshVersion}.`,
  )
}

/**
 * Desktop-shell patch version: <official DSH version>.<major>.<minor>.
 * The patch line is owned by the shell's release history (e.g. the 6.5.x
 * series) and only ever advances: each `dist` bumps minor, keeping the
 * maintainer's line continuous across DSH upgrades.
 * Examples: 0.1.0-rc.6.5.3 → 0.1.0-rc.6.5.4 → ... → (DSH rc.7) 0.1.0-rc.7.5.5
 * @param currentVersion - the shell version before this sync.
 * @param latestDshVersion - the official DSH version this build follows.
 */
function nextDesktopVersion(currentVersion, latestDshVersion) {
  if (typeof currentVersion === 'string') {
    // The patch number is the last two dot-separated numeric segments,
    // regardless of the official prefix (which may itself contain digits).
    const segments = currentVersion.split('.')
    const major = Number.parseInt(segments[segments.length - 2] ?? '', 10)
    const minor = Number.parseInt(segments[segments.length - 1] ?? '', 10)
    if (Number.isInteger(major) && major >= 1 && Number.isInteger(minor)) {
      return `${latestDshVersion}.${major}.${minor + 1}`
    }
  }
  // No patch number on the current version: keep the bare official version.
  // The shell patch line is maintained manually, so we never invent a number.
  return latestDshVersion
}

runNpm([
  'version',
  nextDesktopVersion(manifest.version, latestDshVersion),
  '--no-git-tag-version',
  '--allow-same-version',
])
const syncedManifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
console.log(`Desktop package version is now ${syncedManifest.version}.`)
