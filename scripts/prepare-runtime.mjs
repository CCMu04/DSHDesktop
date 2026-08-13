import { execFileSync } from 'node:child_process'
import {
  createHash,
} from 'node:crypto'
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const shellDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputDirectory = path.join(shellDirectory, 'build', 'runtime')
const archivePath = path.join(outputDirectory, 'dsh-runtime.7z')
const archiveTempPath = `${archivePath}.tmp`
const listPath = path.join(outputDirectory, 'runtime-files.txt')
const sevenZipPath = path.join(
  shellDirectory,
  'node_modules',
  '7zip-bin',
  'win',
  'x64',
  '7za.exe',
)

function npmOutput(args) {
  const npmCli = process.env.npm_execpath
  const command = npmCli ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const commandArgs = npmCli ? [npmCli, ...args] : args
  return execFileSync(command, commandArgs, {
    cwd: shellDirectory,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  })
}

mkdirSync(outputDirectory, { recursive: true })
rmSync(archiveTempPath, { force: true })

const productionPaths = npmOutput(['ls', '--omit=dev', '--all', '--parseable'])
  .split(/\r?\n/u)
  .map(value => value.trim())
  .filter(Boolean)
  .filter(value => path.resolve(value) !== shellDirectory)
  .sort((left, right) => left.length - right.length)

const packageRoots = []
for (const packagePath of productionPaths) {
  const alreadyIncluded = packageRoots.some(root => packagePath.startsWith(`${root}${path.sep}`))
  if (!alreadyIncluded) packageRoots.push(packagePath)
}

const archiveEntries = packageRoots
  .map(packagePath => path.relative(shellDirectory, packagePath))
  .sort()

writeFileSync(listPath, `${archiveEntries.join('\r\n')}\r\n`, 'utf8')
execFileSync(
  sevenZipPath,
  ['a', '-t7z', '-mx=3', '-mmt=on', archiveTempPath, `@${listPath}`],
  { cwd: shellDirectory, stdio: 'inherit' },
)
rmSync(archivePath, { force: true })
renameSync(archiveTempPath, archivePath)
rmSync(listPath, { force: true })

const dshVersion = JSON.parse(
  readFileSync(path.join(shellDirectory, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8'),
).version
const archiveSha256 = createHash('sha256').update(readFileSync(archivePath)).digest('hex')
const packages = Object.fromEntries(
  archiveEntries.map(packagePath => {
    const packageManifest = JSON.parse(
      readFileSync(path.join(shellDirectory, packagePath, 'package.json'), 'utf8'),
    )
    return [packagePath.replaceAll('\\', '/'), packageManifest.version]
  }),
)

writeFileSync(
  path.join(outputDirectory, 'runtime.json'),
  `${JSON.stringify({ dshVersion, archiveSha256, packages }, null, 2)}\n`,
  'utf8',
)
console.log(`Prepared cached DSH runtime ${dshVersion} (${archiveEntries.length} package roots).`)
