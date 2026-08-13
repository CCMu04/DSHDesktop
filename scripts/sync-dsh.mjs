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

runNpm([
  'version',
  latestDshVersion,
  '--no-git-tag-version',
  '--allow-same-version',
])
console.log(`Desktop package version is now ${latestDshVersion}.`)
