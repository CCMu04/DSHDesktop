import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  nextDesktopVersion,
  normalizeDshSelector,
  normalizePublishedVersion,
  pinRuntimePackages,
} from '../lib/dsh-sync.mjs'

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
// 运行时包分散在 dependencies 与 devDependencies 中（见 prepare-runtime.mjs 的
// 说明：dsh-* 运行时全家桶放 devDependencies，避免 electron-builder 分析巨型
// 依赖树）。同步时两者都要扫到并统一升到最新版本。
const runtimePackages = [
  ...Object.keys(manifest.dependencies ?? {}),
  ...Object.keys(manifest.devDependencies ?? {}),
].filter(name => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'))

if (!runtimePackages.includes('@deepseek-ai/dsh')) {
  throw new Error('The desktop shell does not declare @deepseek-ai/dsh.')
}

const dshSelector = normalizeDshSelector(process.env.DSH_VERSION)
const targetDshVersion = normalizePublishedVersion(
  JSON.parse(
    runNpm(['view', `@deepseek-ai/dsh@${dshSelector}`, 'version', '--json'], true).trim(),
  ),
)

if (typeof targetDshVersion !== 'string' || !targetDshVersion) {
  throw new Error(
    `Unable to resolve published DSH version for selector ${dshSelector}.`,
  )
}

console.log(
  `Synchronizing the desktop runtime with DSH ${targetDshVersion} (selector: ${dshSelector})...`,
)
const pinnedManifest = pinRuntimePackages(manifest, runtimePackages, targetDshVersion)
writeFileSync(manifestPath, `${JSON.stringify(pinnedManifest, null, 2)}\n`, 'utf8')
// DSH publishes a large, mutually-referential peer graph. The desktop manifest
// declares the non-DSH peer roots it needs (React and Electron Builder's
// Squirrel backend), while `npm ls --all` in CI verifies the completed tree.
// Avoid npm's exponential peer backtracking while updating the lockfile.
runNpm(['install', '--legacy-peer-deps'])

const installedManifest = JSON.parse(
  readFileSync(path.join(shellDirectory, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8'),
)

if (installedManifest.version !== targetDshVersion) {
  throw new Error(
    `Installed DSH ${installedManifest.version} does not match target ${targetDshVersion}.`,
  )
}

runNpm([
  'version',
  nextDesktopVersion(manifest.version, targetDshVersion),
  '--no-git-tag-version',
  '--allow-same-version',
])
const syncedManifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
console.log(`Desktop package version is now ${syncedManifest.version}.`)
