import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('The node-pty ia32 cross-build requires 64-bit Windows.')
}

const shellDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const nodePtyDirectory = path.join(shellDirectory, 'node_modules', 'node-pty')
const outputDirectory = path.join(nodePtyDirectory, 'prebuilds', 'win32-ia32')
const nodeGyp = path.join(shellDirectory, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js')

if (!existsSync(nodeGyp)) throw new Error(`node-gyp is missing: ${nodeGyp}`)

execFileSync(
  process.execPath,
  [nodeGyp, 'rebuild', '--directory', nodePtyDirectory, '--arch=ia32'],
  {
    cwd: shellDirectory,
    env: { ...process.env, npm_config_arch: 'ia32' },
    stdio: 'inherit',
  },
)

const releaseDirectory = path.join(nodePtyDirectory, 'build', 'Release')
const runtimeExtensions = new Set(['.node', '.dll', '.exe'])
const runtimeFiles = readdirSync(releaseDirectory, { withFileTypes: true })
  .filter(entry => entry.isFile() && runtimeExtensions.has(path.extname(entry.name).toLowerCase()))
  .map(entry => entry.name)

for (const required of ['conpty.node', 'conpty_console_list.node', 'pty.node', 'winpty.dll', 'winpty-agent.exe']) {
  if (!runtimeFiles.includes(required)) throw new Error(`node-pty ia32 build did not produce ${required}`)
}

rmSync(outputDirectory, { recursive: true, force: true })
mkdirSync(outputDirectory, { recursive: true })
for (const file of runtimeFiles) {
  cpSync(path.join(releaseDirectory, file), path.join(outputDirectory, file))
}
// node-pty checks build/Release before its architecture-specific prebuilds.
// Remove the ia32 build tree so the x64 package produced in the same job does
// not try to load 32-bit binaries.
rmSync(path.join(nodePtyDirectory, 'build'), { recursive: true, force: true })
console.log(`Prepared node-pty win32-ia32 prebuild (${runtimeFiles.length} files).`)
