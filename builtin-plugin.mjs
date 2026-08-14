import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
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
