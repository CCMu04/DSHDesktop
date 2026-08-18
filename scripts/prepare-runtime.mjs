import {
  createHash,
} from 'node:crypto'
import {
  existsSync,
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
const nodeModulesRoot = path.join(shellDirectory, 'node_modules')

/**
 * 求 node_modules 下某个包目录的真实路径。
 * - bare 名称：`node_modules/<name>`；带 `@scope` 的为 `node_modules/<scope>/<name>`。
 * - npm 依赖可能被提升（node_modules 顶层）或嵌套（node_modules/<pkg>/node_modules/…）。
 *   这里按 npm 语义解析：先在当前包的 node_modules 找，找不到就向上级目录找。
 * @param name - 依赖名（可带 scope，如 `@deepseek-ai/dsh`）。
 * @param fromDirectory - 从哪个包目录出发（其 node_modules 优先）。
 * @returns 命中目录或 null。
 */
function resolveDependencyDirectory(name, fromDirectory) {
  const parts = name.split('/')
  const lookupDirs = []
  let cursor = fromDirectory
  for (;;) {
    lookupDirs.push(path.join(cursor, 'node_modules', ...parts))
    if (path.dirname(cursor) === cursor) break
    cursor = path.dirname(cursor)
  }
  for (const candidate of lookupDirs) {
    if (existsSync(path.join(candidate, 'package.json'))) return candidate
  }
  return null
}

/** 读一个包目录的 package.json（缺失/损坏 → null）。 */
function readManifest(packageDirectory) {
  try {
    return JSON.parse(
      readFileSync(path.join(packageDirectory, 'package.json'), 'utf8'),
    )
  } catch {
    return null
  }
}

/**
 * 收集运行时闭包：从一组「运行时根」出发，沿 node_modules 依赖图 BFS。
 *
 * 运行时根 = 全部 `dependencies` + `devDependencies` 里所有 `@deepseek-ai/dsh*`
 * 运行时包。注意不能只以 `@deepseek-ai/dsh` 的闭包为准：桌面端 web profile
 * 在运行时真实加载整套 dsh-*（各自主张自己的依赖），它们并不都挂进 dsh 元包的
 * package.json。BFS 同时跟进 `dependencies` 与 `optionalDependencies`——
 * 后者承载平台原生二进制（sharp-win32-x64 / koffi-win32-x64 等），漏了它们
 * 运行时图像处理/原生调用会失效。
 *
 * 为什么不继续用 `npm ls --omit=dev`：DSH 运行时包放 devDependencies 后，
 * `--omit=dev` 会把整套运行时排除掉；而把它们留在 production dependencies
 * 又会让 electron-builder 为 App asar 分析巨型依赖树（rc.7 起在 CI 上会卡死在
 * "searching for node modules"）。这里与 electron-builder 完全解耦：开发者只需
 * 在 devDependencies 里声明 `@deepseek-ai/dsh*` 运行时包，闭包自动随之扩大。
 */
function collectRuntimeClosure(rootNames) {
  const pending = [...rootNames]
  const visited = new Set()
  const roots = []
  while (pending.length > 0) {
    const name = pending.shift()
    if (visited.has(name)) continue
    visited.add(name)
    const directory = resolveDependencyDirectory(name, shellDirectory)
    if (directory === null) {
      console.warn(`[prepare-runtime] warning: dependency not found: ${name}`)
      continue
    }
    roots.push(directory)
    const manifest = readManifest(directory)
    const deps = {
      ...(manifest?.dependencies ?? {}),
      ...(manifest?.optionalDependencies ?? {}),
    }
    for (const depName of Object.keys(deps)) {
      if (!visited.has(depName)) pending.push(depName)
    }
  }
  // 去重（同一包可能被多个父包引用，只保留最上层的实例即可）。
  return [...roots].sort((left, right) => left.length - right.length)
}

mkdirSync(outputDirectory, { recursive: true })
rmSync(archiveTempPath, { force: true })

const manifest = JSON.parse(
  readFileSync(path.join(shellDirectory, 'package.json'), 'utf8'),
)
const runtimeRoots = [
  ...Object.keys(manifest.dependencies ?? {}),
  ...Object.keys(manifest.devDependencies ?? {}).filter(
    name => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'),
  ),
]
const packageRoots = collectRuntimeClosure(runtimeRoots)

const archiveEntries = packageRoots
  .map(packagePath => path.relative(shellDirectory, packagePath))
  .sort()

writeFileSync(listPath, `${archiveEntries.join('\r\n')}\r\n`, 'utf8')
const { execFileSync } = await import('node:child_process')
execFileSync(
  sevenZipPath,
  ['a', '-t7z', '-mx=3', '-mmt=on', archiveTempPath, `@${listPath}`],
  { cwd: shellDirectory, stdio: 'inherit' },
)
rmSync(archivePath, { force: true })
renameSync(archiveTempPath, archivePath)
rmSync(listPath, { force: true })

const dshVersion = JSON.parse(
  readFileSync(path.join(nodeModulesRoot, '@deepseek-ai', 'dsh', 'package.json'), 'utf8'),
).version
const archiveSha256 = createHash('sha256').update(readFileSync(archivePath)).digest('hex')
const packages = Object.fromEntries(
  archiveEntries.map(packagePath => {
    const packageManifest = readManifest(path.join(shellDirectory, packagePath)) ?? {}
    return [packagePath.replaceAll('\\', '/'), packageManifest.version ?? null]
  }),
)

writeFileSync(
  path.join(outputDirectory, 'runtime.json'),
  `${JSON.stringify({ dshVersion, archiveSha256, packages }, null, 2)}\n`,
  'utf8',
)
console.log(`Prepared cached DSH runtime ${dshVersion} (${archiveEntries.length} package roots).`)