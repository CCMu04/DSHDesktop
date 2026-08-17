import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

function writeIfChanged(filePath, content) {
  if (existsSync(filePath) && readFileSync(filePath, 'utf8') === content) return
  writeFileSync(filePath, content, 'utf8')
}

function prependPath(environment, directory) {
  const pathKeys = Object.keys(environment).filter(key => key.toLowerCase() === 'path')
  const pathKey = pathKeys[0] ?? (process.platform === 'win32' ? 'Path' : 'PATH')
  const currentPath = environment[pathKey] ?? ''
  for (const duplicateKey of pathKeys.slice(1)) delete environment[duplicateKey]
  environment[pathKey] = currentPath ? `${directory}${path.delimiter}${currentPath}` : directory
}

function packageCommand(packageDirectory, commandName) {
  const manifestPath = path.join(packageDirectory, 'package.json')
  if (!existsSync(manifestPath)) throw new Error(`Bundled package manifest is missing: ${manifestPath}`)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const relativeEntry = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[commandName]
  if (typeof relativeEntry !== 'string' || relativeEntry.length === 0) {
    throw new Error(`Bundled package exposes no ${commandName} command: ${manifestPath}`)
  }
  return path.resolve(packageDirectory, relativeEntry)
}

/**
 * Create command shims that make the packaged runtime usable by DSH Agents.
 * The shims contain no installation-specific paths: the backend supplies those
 * through its environment on every launch, so a runtime update cannot leave a
 * stale command behind.
 */
export function prepareDesktopToolchain({
  userDataDirectory,
  runtimeDirectory,
  executablePath,
  preloadPath,
  dshHome,
  baseEnvironment = process.env,
}) {
  if (process.platform !== 'win32') {
    throw new Error('The bundled Desktop toolchain currently supports Windows only.')
  }

  const nodeModulesDirectory = path.resolve(runtimeDirectory, '..', '..')
  const dshEntry = path.join(runtimeDirectory, 'lib', 'bin.js')
  const pnpmDirectory = path.join(nodeModulesDirectory, 'pnpm')
  const pnpmEntry = packageCommand(pnpmDirectory, 'pnpm')
  const pnpxEntry = packageCommand(pnpmDirectory, 'pnpx')

  for (const [label, entry] of [['DSH', dshEntry], ['pnpm', pnpmEntry], ['pnpx', pnpxEntry]]) {
    if (!existsSync(entry)) throw new Error(`Bundled ${label} entry is missing: ${entry}`)
  }

  const toolchainDirectory = path.join(userDataDirectory, 'runtime-tools')
  mkdirSync(toolchainDirectory, { recursive: true })
  writeIfChanged(
    path.join(toolchainDirectory, 'dsh.cmd'),
    '@echo off\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n"%HARNESS_DESKTOP_NODE%" --require "%HARNESS_DESKTOP_PRELOAD%" "%HARNESS_DESKTOP_DSH_ENTRY%" %*\r\n',
  )
  writeIfChanged(
    path.join(toolchainDirectory, 'pnpm.cmd'),
    '@echo off\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n"%HARNESS_DESKTOP_NODE%" --require "%HARNESS_DESKTOP_PRELOAD%" "%HARNESS_DESKTOP_PNPM_ENTRY%" %*\r\n',
  )
  writeIfChanged(
    path.join(toolchainDirectory, 'pnpx.cmd'),
    '@echo off\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n"%HARNESS_DESKTOP_NODE%" --require "%HARNESS_DESKTOP_PRELOAD%" "%HARNESS_DESKTOP_PNPX_ENTRY%" %*\r\n',
  )
  writeIfChanged(
    path.join(toolchainDirectory, 'node.cmd'),
    '@echo off\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n"%HARNESS_DESKTOP_NODE%" --require "%HARNESS_DESKTOP_PRELOAD%" %*\r\n',
  )

  const environment = {
    ...baseEnvironment,
    DSH_HOME: dshHome,
    DSH_DESKTOP_MANAGED_TOOLCHAIN: '1',
    HARNESS_DESKTOP_NODE: executablePath,
    HARNESS_DESKTOP_PRELOAD: preloadPath,
    HARNESS_DESKTOP_DSH_ENTRY: dshEntry,
    HARNESS_DESKTOP_PNPM_ENTRY: pnpmEntry,
    HARNESS_DESKTOP_PNPX_ENTRY: pnpxEntry,
    ELECTRON_RUN_AS_NODE: '1',
    NODE_OPTIONS: [baseEnvironment.NODE_OPTIONS, `--require=${JSON.stringify(preloadPath.replaceAll('\\', '/'))}`]
      .filter(Boolean)
      .join(' '),
  }
  prependPath(environment, toolchainDirectory)

  return { environment, toolchainDirectory, dshEntry, pnpmEntry, pnpxEntry }
}
