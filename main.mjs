import { spawn } from 'node:child_process'
import {
  constants,
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, Menu, shell } from 'electron'
import { ensureBundledPlugin } from './builtin-plugin.mjs'
import { prepareDesktopToolchain } from './toolchain.mjs'

const shellDirectory = path.dirname(fileURLToPath(import.meta.url))
const runtimePreloadPath = app.isPackaged
  ? path.join(process.resourcesPath, 'runtime-preload.cjs')
  : path.join(shellDirectory, 'runtime-preload.cjs')
// Root of the bundled plugins: every `dsh-desktop-*` subdirectory is one
// independent plugin (each carries its own host/client halves and patch row).
const bundledPluginsDirectory = app.isPackaged
  ? path.join(process.resourcesPath, 'plugins')
  : path.join(shellDirectory, 'plugins')
// The DSH backend runs on the bundled stock Node.js, never on Electron-as-Node:
// the official native directory picker (koffi) aborts fatally and node-pty
// output goes silent under Electron's runtime. Unpackaged development keeps
// the Electron binary as the fallback Node.
const nodeExecutablePath = app.isPackaged
  ? path.join(process.resourcesPath, 'runtime', 'node.exe')
  : process.execPath
const backendHost = '127.0.0.1'
const startupTimeoutMs = 60_000

let backendProcess
let backendExitCode = null
let backendOrigin
let mainWindow
let quitting = false
let recentBackendOutput = ''
let runtimeDirectory

async function setLoadingStatus(message) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  try {
    await mainWindow.webContents.executeJavaScript(
      `document.querySelector('[data-loading-status]')?.replaceChildren(document.createTextNode(${JSON.stringify(message)}))`,
    )
  } catch {
    // The loading document may already have been replaced by the Web UI.
  }
}

function expandHomePath(value) {
  if (value === '~') return os.homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(os.homedir(), value.slice(2))
  }
  return value
}

function resolveSharedDshHome() {
  const configuredHome = process.env.DSH_HOME
  const selectedHome = configuredHome?.trim() ? configuredHome : path.join(os.homedir(), '.dsh')
  return path.resolve(expandHomePath(selectedHome))
}

function mergeMissingFiles(sourceDirectory, targetDirectory, relativeDirectory = '') {
  let copied = 0
  let skipped = 0
  mkdirSync(targetDirectory, { recursive: true })

  for (const entry of readdirSync(sourceDirectory, { withFileTypes: true })) {
    const relativePath = path.join(relativeDirectory, entry.name)
    if (relativePath === path.join('profiles', 'node_modules') || entry.isSymbolicLink()) {
      skipped += 1
      continue
    }

    const sourcePath = path.join(sourceDirectory, entry.name)
    const targetPath = path.join(targetDirectory, entry.name)
    if (entry.isDirectory()) {
      const result = mergeMissingFiles(sourcePath, targetPath, relativePath)
      copied += result.copied
      skipped += result.skipped
      continue
    }
    if (!entry.isFile()) {
      skipped += 1
      continue
    }

    try {
      copyFileSync(sourcePath, targetPath, constants.COPYFILE_EXCL)
      copied += 1
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      skipped += 1
    }
  }

  return { copied, skipped }
}

function migrateLegacyDshHome(sharedDshHome) {
  const legacyDshHome = path.join(app.getPath('userData'), 'dsh-home')
  const markerPath = path.join(app.getPath('userData'), 'shared-dsh-home-migration-v1.json')
  if (existsSync(markerPath) || !existsSync(legacyDshHome)) return
  if (path.resolve(legacyDshHome) === sharedDshHome) return

  const result = mergeMissingFiles(legacyDshHome, sharedDshHome)
  writeFileSync(
    markerPath,
    `${JSON.stringify({ source: legacyDshHome, target: sharedDshHome, ...result }, null, 2)}\n`,
    'utf8',
  )
}

function getRuntimeDirectory() {
  return runtimeDirectory ?? path.join(shellDirectory, 'node_modules', '@deepseek-ai', 'dsh')
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, windowsHide: true })
    child.stdout.on('data', appendBackendOutput)
    child.stderr.on('data', appendBackendOutput)
    child.once('error', reject)
    child.once('exit', code => {
      if (code === 0) resolve()
      else reject(new Error(`Desktop preparation command exited with code ${code}.`))
    })
  })
}

async function preparePackagedRuntime() {
  if (!app.isPackaged) return

  const resourceDirectory = path.join(process.resourcesPath, 'runtime')
  const archivePath = path.join(resourceDirectory, 'dsh-runtime.7z')
  const metadata = JSON.parse(readFileSync(path.join(resourceDirectory, 'runtime.json'), 'utf8'))
  const cacheRoot = path.join(app.getPath('userData'), 'runtime-cache')
  const finalDirectory = path.join(cacheRoot, 'current')
  const markerPath = path.join(finalDirectory, 'runtime.json')
  let previousMetadata

  if (existsSync(markerPath)) {
    previousMetadata = JSON.parse(readFileSync(markerPath, 'utf8'))
    if (previousMetadata.archiveSha256 === metadata.archiveSha256) {
      runtimeDirectory = path.join(finalDirectory, 'node_modules', '@deepseek-ai', 'dsh')
      await setLoadingStatus('正在启动本地服务…')
      return
    }
  }

  mkdirSync(cacheRoot, { recursive: true })
  const temporaryDirectory = path.join(cacheRoot, `${metadata.dshVersion}.extracting-${process.pid}`)
  rmSync(temporaryDirectory, { recursive: true, force: true })
  mkdirSync(temporaryDirectory, { recursive: true })

  const previousPackages = previousMetadata?.packages ?? {}
  const nextPackages = metadata.packages ?? {}
  const changedPackages = Object.keys(nextPackages).filter(
    packagePath => previousPackages[packagePath] !== nextPackages[packagePath],
  )
  const removedPackages = Object.keys(previousPackages).filter(
    packagePath => !(packagePath in nextPackages),
  )

  await setLoadingStatus(
    previousMetadata
      ? `正在更新 DSH 运行环境（${changedPackages.length} 个组件）…`
      : '首次启动正在准备运行环境，后续启动会更快…',
  )

  for (const packagePath of [...changedPackages, ...removedPackages]) {
    if (!packagePath.startsWith('node_modules/')) {
      throw new Error(`Invalid runtime package path: ${packagePath}`)
    }
  }

  if (changedPackages.length > 0) {
    const extractionListPath = path.join(temporaryDirectory, 'extract-list.txt')
    writeFileSync(
      extractionListPath,
      `${changedPackages.map(packagePath => `${packagePath.replaceAll('/', '\\')}\\*`).join('\r\n')}\r\n`,
      'utf8',
    )

    await runProcess(path.join(resourceDirectory, `7za-${process.arch}.exe`), [
      'x',
      archivePath,
      `@${extractionListPath}`,
      `-o${temporaryDirectory}`,
      '-y',
      '-bb0',
    ])
    rmSync(extractionListPath, { force: true })
  }

  mkdirSync(finalDirectory, { recursive: true })
  for (const packagePath of removedPackages) {
    rmSync(path.join(finalDirectory, packagePath), { recursive: true, force: true })
  }
  for (const packagePath of changedPackages) {
    const source = path.join(temporaryDirectory, packagePath)
    const destination = path.join(finalDirectory, packagePath)
    mkdirSync(path.dirname(destination), { recursive: true })
    rmSync(destination, { recursive: true, force: true })
    renameSync(source, destination)
  }
  writeFileSync(markerPath, JSON.stringify(metadata), 'utf8')
  rmSync(temporaryDirectory, { recursive: true, force: true })
  runtimeDirectory = path.join(finalDirectory, 'node_modules', '@deepseek-ai', 'dsh')
  await setLoadingStatus('正在启动本地服务…')
}

function appendBackendOutput(chunk) {
  recentBackendOutput = `${recentBackendOutput}${chunk}`.slice(-8_000)
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, backendHost, () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : undefined
      server.close(error => {
        if (error) reject(error)
        else if (port) resolve(port)
        else reject(new Error('Unable to reserve a local port.'))
      })
    })
  })
}

function probe(url) {
  return new Promise(resolve => {
    const request = http.get(url, response => {
      response.resume()
      resolve(response.statusCode === 200)
    })
    request.setTimeout(1_000, () => request.destroy())
    request.once('error', () => resolve(false))
  })
}

async function waitForBackend(url) {
  const deadline = Date.now() + startupTimeoutMs
  while (Date.now() < deadline) {
    if (backendExitCode !== null) {
      throw new Error(`The local Web service exited with code ${backendExitCode}.`)
    }
    if (await probe(url)) return
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error('The local Web service did not become ready within 60 seconds.')
}

function prepareBackendContext() {
  const selectedRuntimeDirectory = getRuntimeDirectory()
  const entry = path.join(selectedRuntimeDirectory, 'lib', 'bin.js')
  if (!existsSync(entry)) {
    throw new Error(`Bundled DeepSeek Harness runtime is missing: ${entry}`)
  }

  const dshHome = resolveSharedDshHome()
  mkdirSync(dshHome, { recursive: true })
  migrateLegacyDshHome(dshHome)
  const toolchain = prepareDesktopToolchain({
    userDataDirectory: app.getPath('userData'),
    runtimeDirectory: selectedRuntimeDirectory,
    executablePath: nodeExecutablePath,
    preloadPath: runtimePreloadPath,
    dshHome,
  })
  // Tell the backend how this client was installed, so the update page can
  // report it: portable builds carry PORTABLE_EXECUTABLE_DIR; packaged
  // installs run from resourcesPath; anything else is an unpackaged dev run.
  const installKind = process.env.PORTABLE_EXECUTABLE_DIR
    ? 'portable'
    : app.isPackaged
      ? 'installer'
      : 'dev'
  toolchain.environment.DSH_DESKTOP_INSTALL_KIND = installKind
  return { selectedRuntimeDirectory, dshHome, ...toolchain }
}

async function prepareBundledPlugins(context) {
  // Every bundled plugin is its own directory under the plugins root; each
  // keeps an independent fingerprint + install record (builtin-plugins.json
  // keys by package name), so adding or removing a plugin never touches the
  // others' enablement state.
  const names = readdirSync(bundledPluginsDirectory)
    .filter((name) => name.startsWith('dsh-desktop-'))
    .sort()
  for (const packageName of names) {
    await ensureBundledPlugin({
      sourceDirectory: path.join(bundledPluginsDirectory, packageName),
      userDataDirectory: app.getPath('userData'),
      dshHome: context.dshHome,
      packageName,
      install: targetDirectory => runProcess(
        nodeExecutablePath,
        [
          '--require', runtimePreloadPath,
          '--expose-internals', context.dshEntry,
          'plugin', '--profile', 'web',
          'add', '--offline', `link:${targetDirectory.replaceAll('\\', '/')}`,
        ],
        { cwd: os.homedir(), env: context.environment },
      ),
    })
  }
}

function startBackend(port, context) {
  app.setAppLogsPath()
  const logStream = createWriteStream(path.join(app.getPath('logs'), 'backend.log'), { flags: 'a' })

  backendExitCode = null
  // Plain pipes, not a pty: node-pty output events never fire under
  // Electron's runtime, which would leave backend.log permanently silent.
  // The bundled stock Node.js runs the backend; windowsHide keeps the
  // console window off the desktop.
  backendProcess = spawn(
    nodeExecutablePath,
    [
      '--require', runtimePreloadPath,
      '--expose-internals', context.dshEntry, 'web', '--port', String(port),
    ],
    {
      cwd: os.homedir(),
      env: context.environment,
      windowsHide: true,
    },
  )

  const appendOutput = data => {
    appendBackendOutput(data)
    logStream.write(data)
  }
  backendProcess.stdout.on('data', appendOutput)
  backendProcess.stderr.on('data', appendOutput)
  backendProcess.once('error', error => {
    appendBackendOutput(`Backend spawn failed: ${String(error)}\n`)
    backendExitCode = 'spawn-failed'
  })
  backendProcess.once('exit', code => {
    backendExitCode = code
    logStream.end()
  })
}

function isBackendUrl(target) {
  try {
    return new URL(target).origin === backendOrigin
  } catch {
    return false
  }
}

function configureNavigation(window) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isBackendUrl(url)) return { action: 'allow' }
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    if (isBackendUrl(url)) return
    event.preventDefault()
    void shell.openExternal(url)
  })

  // The session header is the window drag surface: its empty areas (top
  // padding, title-row gaps, tab spacing) drag the window, while buttons and
  // other interactive elements inside it opt out via no-drag and stay fully
  // clickable. Every slot outlet wraps its content in a <div data-slot=...>
  // (display: contents), so the header is matched through that anchor, and
  // the scope stays limited to the conversation header so headers of dialogs
  // or panels never become drag regions.
  //
  // Electron hit-tests drag regions at the window level (WM_NCHITTEST), so
  // any overlay above the header - such as the left-docked settings drawer
  // whose top row lands inside the header's rect - swallows clicks as window
  // dragging. While an aria-modal dialog is open the drag surface is
  // disabled, so the dialog's own header row stays fully clickable, and it
  // is restored when the dialog closes.
  window.webContents.on('did-finish-load', () => {
    if (!isBackendUrl(window.webContents.getURL())) return
    void window.webContents.executeJavaScript(`
      if (!document.getElementById('dsh-desktop-drag-style')) {
        const dragStyle = document.createElement('style')
        dragStyle.id = 'dsh-desktop-drag-style'
        dragStyle.textContent = [
          '[data-slot="conversation.session.header"] header { -webkit-app-region: drag; }',
          '[data-slot="conversation.session.header"] header button,',
          '[data-slot="conversation.session.header"] header input,',
          '[data-slot="conversation.session.header"] header select,',
          '[data-slot="conversation.session.header"] header textarea,',
          '[data-slot="conversation.session.header"] header a,',
          '[data-slot="conversation.session.header"] header [role="tab"],',
          '[data-slot="conversation.session.header"] header [role="button"],',
          '[data-slot="conversation.session.header"] header [role="menuitem"],',
          '[data-slot="conversation.session.header"] header [role="listbox"],',
          '[data-slot="conversation.session.header"] header [role="menu"],',
          '[data-slot="conversation.session.header"] header [role="dialog"],',
          '[data-slot="conversation.session.header"] header [contenteditable="true"],',
          '[data-slot="conversation.session.header"] header label,',
          '[data-slot="conversation.session.header"] header summary {',
          '  -webkit-app-region: no-drag;',
          '}',
        ].join('\\n')
        document.documentElement.appendChild(dragStyle)
        let dragSyncPending = false
        const syncDragRegion = () => {
          if (dragSyncPending) return
          dragSyncPending = true
          queueMicrotask(() => {
            dragSyncPending = false
            dragStyle.disabled = document.querySelector('[role="dialog"][aria-modal="true"]') !== null
          })
        }
        const dragObserver = new MutationObserver(syncDragRegion)
        dragObserver.observe(document.documentElement, { childList: true, subtree: true })
        syncDragRegion()
      }
    `)
  })
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#f7f8fa',
    icon: path.join(shellDirectory, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#00000000',
      symbolColor: '#22252b',
      height: 38,
    },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  configureNavigation(mainWindow)
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  await mainWindow.loadFile(path.join(shellDirectory, 'loading.html'))
}

async function launch() {
  await createWindow()
  await preparePackagedRuntime()
  const context = prepareBackendContext()
  await setLoadingStatus('正在准备内置桌面插件…')
  await prepareBundledPlugins(context)
  await setLoadingStatus('正在启动本地服务…')
  const port = await reservePort()
  backendOrigin = `http://${backendHost}:${port}`
  startBackend(port, context)
  await waitForBackend(`${backendOrigin}/`)
  await mainWindow.loadURL(`${backendOrigin}/`)
}

function stopBackend() {
  if (!backendProcess || backendExitCode !== null) return
  const backendPid = backendProcess.pid
  try {
    backendProcess.kill()
  } catch {}
  if (backendPid) {
    try {
      process.kill(backendPid)
    } catch {}
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()

app.on('second-instance', () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
})

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return
  Menu.setApplicationMenu(null)
  try {
    await launch()
  } catch (error) {
    const details = recentBackendOutput.trim()
    await dialog.showMessageBox({
      type: 'error',
      title: 'DeepSeek Harness failed to start',
      message: error instanceof Error ? error.message : String(error),
      detail: details || 'See backend.log in the application log directory for details.',
    })
    quitting = true
    stopBackend()
    app.quit()
  }
})

app.on('window-all-closed', () => app.quit())

app.on('before-quit', () => {
  if (quitting) return
  quitting = true
  stopBackend()
})
