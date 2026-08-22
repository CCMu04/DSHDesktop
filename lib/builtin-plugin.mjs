import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

function filesBelow(directory, relativeDirectory = '') {
  const files = []
  for (const name of readdirSync(path.join(directory, relativeDirectory)).sort()) {
    const relativePath = path.join(relativeDirectory, name)
    const stats = statSync(path.join(directory, relativePath))
    if (stats.isDirectory()) files.push(...filesBelow(directory, relativePath))
    else if (stats.isFile()) files.push(relativePath)
  }
  return files
}

export function bundledPluginIdentity(sourceDirectory) {
  const manifest = JSON.parse(readFileSync(path.join(sourceDirectory, 'package.json'), 'utf8'))
  const hash = createHash('sha256')
  for (const relativePath of filesBelow(sourceDirectory)) {
    hash.update(relativePath.replaceAll('\\', '/'))
    hash.update('\0')
    hash.update(readFileSync(path.join(sourceDirectory, relativePath)))
    hash.update('\0')
  }
  return `${manifest.version}:${hash.digest('hex')}`
}

function readState(statePath) {
  if (!existsSync(statePath)) return { version: 1, homes: {} }
  try {
    const state = JSON.parse(readFileSync(statePath, 'utf8'))
    if (state?.version === 1 && typeof state.homes === 'object' && state.homes !== null) return state
  } catch {
    // A damaged advisory marker is rebuilt after the plugin is installed successfully.
  }
  return { version: 1, homes: {} }
}

function writeState(statePath, state) {
  mkdirSync(path.dirname(statePath), { recursive: true })
  const temporaryPath = `${statePath}.${process.pid}.tmp`
  writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  renameSync(temporaryPath, statePath)
}

function deployPlugin(sourceDirectory, targetDirectory) {
  mkdirSync(path.dirname(targetDirectory), { recursive: true })
  const temporaryDirectory = `${targetDirectory}.deploying-${process.pid}`
  rmSync(temporaryDirectory, { recursive: true, force: true })
  cpSync(sourceDirectory, temporaryDirectory, { recursive: true, force: true })
  rmSync(targetDirectory, { recursive: true, force: true })
  renameSync(temporaryDirectory, targetDirectory)
}

/**
 * 让 builtin-plugins 里的宿主插件能解析运行时提供的依赖作用域。
 *
 * 插件的物理位置在 `builtin-plugins/<name>` 下（profile 的 link 只指向这里），
 * Node 解析裸说明符沿真实路径向上走，永远够不到运行时的 node_modules——宿主半
 * 一旦 import '@deepseek-ai/*' 或官方 adapter 的公开依赖就会
 * ERR_MODULE_NOT_FOUND。把运行时的 @deepseek-ai 与 @earendil-works 目录
 * junction 到 `builtin-plugins/node_modules` 后，从任何内置插件发出的这些
 * 导入都能命中运行时包（语义与官方插件从运行时 node_modules 解析一致），且不随
 * 插件目录复制任何依赖。
 *
 * @param userDataDirectory - 应用数据根（builtin-plugins 所在目录）。
 * @param runtimeNodeModulesDirectory - 运行时 node_modules 根（含 @deepseek-ai）。
 */
export function ensurePluginRuntimeExports({
  userDataDirectory,
  runtimeNodeModulesDirectory,
}) {
  const linkDirectory = path.join(userDataDirectory, 'builtin-plugins', 'node_modules')
  mkdirSync(linkDirectory, { recursive: true })
  for (const scope of ['@deepseek-ai', '@earendil-works']) {
    const target = path.resolve(path.join(runtimeNodeModulesDirectory, scope))
    if (!existsSync(target)) {
      throw new Error(`Bundled runtime packages are missing: ${target}`)
    }
    const link = path.join(linkDirectory, scope)
    let current = null
    try {
      current = readlinkSync(link)
    } catch {
      current = null
    }
    if (current !== null && path.resolve(current).toLowerCase() === target.toLowerCase()) {
      continue
    }
    rmSync(link, { recursive: true, force: true })
    symlinkSync(target, link, 'junction')
  }
}

/**
 * 剪除 web profile 里「不再随包分发」的内置插件引用。
 *
 * 背景：桌面壳内置插件随安装包分发，通过 `dsh plugin add --offline link:…`
 * 注册进 `~/.dsh/profiles/web/package.json`（dependencies 的 `link:` 条目 +
 * `dsh.profile.bundles` 里的名字）。当某个插件从安装包移除后（如开发中暂不
 * 分发的 dsh-desktop-browser），这些注册记录仍留在 profile——而 profile 属于
 * 用户数据，重装/升级都不清——后端每次启动都会去解析指向
 * `builtin-plugins/<name>` 的幽灵 link：目标目录不复存在，插件树加载失败，
 * 表现为 App 启动报错且「重装也无法恢复」。
 *
 * 这里做幂等剪除：把 profile 中所有 `dsh-desktop-*` 的依赖与 bundle 行里、
 * 不在当前分发包集合（shippedNames）中的条目移除。只动 `dsh-desktop-*`
 * 名字空间，绝不触碰用户自建的插件；将来某个插件恢复随包分发时，部署流程
 * 会重新注册它。
 *
 * @param profileWebPackagePath - `~/.dsh/profiles/web/package.json` 绝对路径。
 * @param shippedNames - 当前安装包实际分发的插件名集合（不含版本号）。
 * @returns 是否发生了剪除（写回了文件）。
 */
export function pruneBundledPluginReferences(profileWebPackagePath, shippedNames) {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(profileWebPackagePath, 'utf8'))
  } catch {
    return false
  }
  if (typeof parsed !== 'object' || parsed === null) return false
  const shipped = new Set(shippedNames)
  let changed = false

  const dependencies = parsed.dependencies
  if (typeof dependencies === 'object' && dependencies !== null) {
    for (const name of Object.keys(dependencies)) {
      if (!name.startsWith('dsh-desktop-')) continue
      if (shipped.has(name)) continue
      delete dependencies[name]
      changed = true
    }
  }

  const bundles = parsed.dsh?.profile?.bundles
  if (Array.isArray(bundles)) {
    const kept = bundles.filter((name) => {
      if (typeof name !== 'string' || !name.startsWith('dsh-desktop-')) return true
      if (shipped.has(name)) return true
      changed = true
      return false
    })
    parsed.dsh.profile.bundles = kept
  }

  if (!changed) return false
  writeFileSync(
    profileWebPackagePath,
    `${JSON.stringify(parsed, null, 2)}\n`,
    'utf8',
  )
  return true
}

/**
 * Install and enable a bundled plugin once for each DSH Home and bundled revision.
 * A matching marker is authoritative: later launches do not repair, reinstall,
 * or re-enable the plugin, so the user's current choice remains untouched.
 */
export async function ensureBundledPlugin({
  sourceDirectory,
  userDataDirectory,
  dshHome,
  packageName,
  install,
}) {
  if (!existsSync(sourceDirectory)) throw new Error(`Bundled plugin is missing: ${sourceDirectory}`)

  const identity = bundledPluginIdentity(sourceDirectory)
  const statePath = path.join(userDataDirectory, 'builtin-plugins.json')
  const state = readState(statePath)
  const homeKey = path.resolve(dshHome).toLowerCase()
  if (state.homes[homeKey]?.[packageName] === identity) {
    return { changed: false, identity }
  }

  const targetDirectory = path.join(userDataDirectory, 'builtin-plugins', packageName)
  deployPlugin(sourceDirectory, targetDirectory)
  await install(targetDirectory)

  state.homes[homeKey] = { ...(state.homes[homeKey] ?? {}), [packageName]: identity }
  writeState(statePath, state)
  return { changed: true, identity, targetDirectory }
}
