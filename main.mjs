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
import { app, BrowserWindow, dialog, Menu, nativeImage, nativeTheme, net as electronNet, Notification, screen, shell, Tray } from 'electron'
import electronUpdater from 'electron-updater'
import { ensureBundledPlugin } from './builtin-plugin.mjs'
import { prepareDesktopToolchain } from './toolchain.mjs'
import {
  buildCloseDialogOptions,
  CLOSE_BEHAVIOR_FILE,
  MINIMIZE_TO_TRAY_NOTIFICATION,
  parseCloseBehavior,
  serializeCloseBehavior,
} from './close-behavior.mjs'
import {
  buildUpdateFailedOptions,
  buildUpdateFoundOptions,
  buildUpToDateOptions,
  isUpdateAvailable,
  LATEST_RELEASE_URL,
} from './update-check.mjs'
import { clearAutoCheck, recordAutoCheck, shouldAutoCheck } from './update-throttle.mjs'
import {
  parseWindowState,
  sanitizeWindowState,
  serializeWindowState,
  WINDOW_STATE_FILE,
} from './window-state.mjs'

const { autoUpdater } = electronUpdater

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

// Window controls overlay: the minimize / maximize / close glyphs are native
// chrome drawn by the OS and cannot be styled by the page's CSS. The overlay
// background stays transparent so the buttons sit on the page header; only
// the symbol color must follow the theme, or the glyphs vanish on a dark
// header. The loading page follows the OS color scheme; the backend page
// reports its own theme (body[data-ds-dark-theme], the palette switch the
// official UI and every bundled skin key off) through the console marker.
const titleBarOverlayOptions = { color: '#00000000', height: 38 }
const titleBarSymbolLight = '#22252b'
const titleBarSymbolDark = '#ebeef2'
const titleBarThemeMarker = '__DSH_TITLEBAR_THEME__:'
// 渲染进程 → 主进程的「唤醒窗口」信标（console 标记通道，与主题标记同款）：
// 完成提醒通知被点击时，渲染进程 window.focus() 无法恢复最小化窗口，
// 主进程收到该标记后 restore + show + focus。
const desktopWakeMarker = '__DSH_DESKTOP_WAKE__:'

// Windows toasts (HTML5 Notification → system notifications) are attributed
// through the AppUserModelID: without it Electron falls back to a generic
// identity and the notification may not surface under the app's name/icon.
app.setAppUserModelId('ai.deepseek.harness.desktop')

let backendProcess
let backendExitCode = null
let backendOrigin
let mainWindow
let tray
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

function syncTitleBarOverlay(window, symbolColor) {
  if (!window || window.isDestroyed()) return
  window.setTitleBarOverlay({ ...titleBarOverlayOptions, symbolColor })
}

function syncTitleBarOverlayFromNativeTheme(window) {
  syncTitleBarOverlay(window, nativeTheme.shouldUseDarkColors ? titleBarSymbolDark : titleBarSymbolLight)
}

// --- Close behavior: minimize to tray vs. full quit -----------------------
// Closing the window stops the local backend and with it the reserved port,
// so the next launch gets a new Web address. The first close asks once (with
// a remember option); by default the window minimizes to the tray instead,
// and only the tray menu's 退出 fully quits.

function getCloseBehaviorPath() {
  return path.join(resolveSharedDshHome(), CLOSE_BEHAVIOR_FILE)
}

// --- Window geometry persistence ------------------------------------------
// The window bounds (normal bounds, so maximized/full-screen windows restore
// their pre-maximize geometry), maximized and full-screen flags are saved to
// $DSH_HOME/desktop-window.json and restored on the next launch.

function getWindowStatePath() {
  return path.join(resolveSharedDshHome(), WINDOW_STATE_FILE)
}

function loadWindowState() {
  try {
    const parsed = parseWindowState(readFileSync(getWindowStatePath(), 'utf8'))
    return sanitizeWindowState(
      parsed,
      screen.getAllDisplays().map(display => display.workArea),
    )
  } catch {
    return parseWindowState(undefined)
  }
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const state = {
    bounds: mainWindow.getNormalBounds(),
    isMaximized: mainWindow.isMaximized(),
    isFullScreen: mainWindow.isFullScreen(),
  }
  try {
    mkdirSync(path.dirname(getWindowStatePath()), { recursive: true })
    writeFileSync(getWindowStatePath(), serializeWindowState(state), 'utf8')
  } catch {
    // Persisting window geometry must never break the app.
  }
}

function loadCloseBehavior() {
  try {
    return parseCloseBehavior(readFileSync(getCloseBehaviorPath(), 'utf8'))
  } catch {
    return parseCloseBehavior(undefined)
  }
}

function saveCloseBehavior(config) {
  mkdirSync(path.dirname(getCloseBehaviorPath()), { recursive: true })
  writeFileSync(getCloseBehaviorPath(), serializeCloseBehavior(config), 'utf8')
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function minimizeToTray() {
  ensureTray()
  mainWindow?.hide()
}

function ensureTray() {
  if (tray) return
  tray = new Tray(nativeImage.createFromPath(path.join(shellDirectory, 'assets', 'icon.png')))
  tray.setToolTip('DeepSeek Harness')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示主窗口', click: showMainWindow },
      { type: 'separator' },
      { label: '新建任务', click: () => sendTrayCommand('new-session') },
      { label: '添加工作区', click: () => sendTrayCommand('add-workspace') },
      { type: 'separator' },
      { label: '检查更新', click: () => void checkForUpdates() },
      { type: 'separator' },
      { label: '关闭行为设置…', click: () => void askCloseBehavior() },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() },
    ]),
  )
  tray.on('click', showMainWindow)
}

// Tray commands run inside the web page: the shell has no IPC bridge into the
// UI, so the command is dispatched as a DOM event handled by the
// dsh-desktop-tray plugin, which calls the official client services
// (workspaces.startSession / pickDirectory / create). The window is brought
// to the foreground first so the user sees the new session / workspace.
function sendTrayCommand(command) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  showMainWindow()
  if (!isBackendUrl(mainWindow.webContents.getURL())) return
  void mainWindow.webContents
    .executeJavaScript(
      `window.dispatchEvent(new CustomEvent('dsh-desktop-tray-command', { detail: ${JSON.stringify(command)} }))`,
    )
    .catch(() => {})
}

// Update check runs in the main process against the same GitHub Releases
// source the settings-page updater uses; the result lands in a native dialog
// (the window is brought up first so the dialog is visible).
async function checkForUpdates() {
  showMainWindow()
  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined
  const currentVersion = app.getVersion()
  try {
    const response = await electronNet.fetch(LATEST_RELEASE_URL, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'deepseek-harness-desktop' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const release = await response.json()
    const latestVersion = typeof release?.tag_name === 'string' ? release.tag_name : ''
    if (latestVersion && isUpdateAvailable(currentVersion, latestVersion)) {
      const { response: choice } = await dialog.showMessageBox(parent, buildUpdateFoundOptions(currentVersion, release))
      if (choice === 0 && typeof release?.html_url === 'string') void shell.openExternal(release.html_url)
    } else {
      await dialog.showMessageBox(parent, buildUpToDateOptions(currentVersion))
    }
  } catch (error) {
    await dialog.showMessageBox(
      parent,
      buildUpdateFailedOptions(error instanceof Error ? error.message : String(error)),
    )
  }
}

function applyCloseBehavior(behavior, remembered) {
  if (remembered) saveCloseBehavior({ behavior, remembered: true })
  else if (loadCloseBehavior().remembered) saveCloseBehavior({ behavior, remembered: false })
  if (behavior === 'minimize') {
    minimizeToTray()
    // The notification shows only when the user checks 「记住我的选择」 with
    // minimize (i.e. opts out of the dialog): it explains how to fully quit.
    // Un-remembering and checking it again notifies once more; plain
    // minimize-to-tray afterwards stays silent.
    if (remembered) new Notification(MINIMIZE_TO_TRAY_NOTIFICATION).show()
  } else {
    mainWindow?.destroy()
  }
}

async function askCloseBehavior() {
  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined
  const remembered = loadCloseBehavior().remembered
  const { response, checkboxChecked } = await dialog.showMessageBox(parent, buildCloseDialogOptions(remembered))
  applyCloseBehavior(response === 0 ? 'minimize' : 'quit', checkboxChecked)
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
    if (!isBackendUrl(window.webContents.getURL())) {
      // The loading page follows the OS color scheme; the backend page below
      // reports its own theme instead.
      syncTitleBarOverlayFromNativeTheme(window)
      return
    }
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
    void window.webContents.executeJavaScript(`
      if (!window.__dshTitlebarThemeObserver) {
        const reportTitlebarTheme = () => {
          console.log(
            '${titleBarThemeMarker}' + (document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light'),
          )
        }
        window.__dshTitlebarThemeObserver = new MutationObserver(reportTitlebarTheme)
        window.__dshTitlebarThemeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
        reportTitlebarTheme()
      }
    `)
  })

  // The backend page reports its theme through the console marker above; the
  // Window Controls Overlay symbol color follows it. While the loading page
  // is up (it follows the OS scheme), track OS theme changes too — once the
  // backend page loads, its own report takes over.
  // The completion-reminder plugin raises the desktop wake marker when a
  // system notification is clicked: restore/focus the window (window.focus()
  // in the renderer cannot unminimize), so the click always lands on the chat.
  window.webContents.on('console-message', details => {
    const message = details?.message
    if (typeof message !== 'string') return
    if (message.startsWith(desktopWakeMarker)) {
      showMainWindow()
      return
    }
    if (!message.startsWith(titleBarThemeMarker)) return
    const dark = message.slice(titleBarThemeMarker.length).includes('dark')
    syncTitleBarOverlay(window, dark ? titleBarSymbolDark : titleBarSymbolLight)
  })

  nativeTheme.on('updated', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (isBackendUrl(mainWindow.webContents.getURL())) return
    syncTitleBarOverlayFromNativeTheme(mainWindow)
  })
}

async function createWindow() {
  // The loading page follows the OS color scheme (loading.html), so the
  // initial background and window-control glyph colors do too; once the
  // backend page loads, its own theme report takes over.
  const systemDark = nativeTheme.shouldUseDarkColors
  // Restore the window geometry remembered from the previous run; bounds are
  // validated against the current displays, so a window saved on a monitor
  // that is no longer connected falls back to the defaults below.
  const savedWindowState = loadWindowState()
  const windowOptions = {
    minWidth: 900,
    minHeight: 600,
    show: false,
    // Matches loading.html which mirrors the official boot screen tokens
    // (--dsw-alias-bg-base: #ffffff light / #151517 dark).
    backgroundColor: systemDark ? '#151517' : '#ffffff',
    icon: path.join(shellDirectory, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      ...titleBarOverlayOptions,
      symbolColor: systemDark ? titleBarSymbolDark : titleBarSymbolLight,
    },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  }
  if (savedWindowState?.bounds) {
    Object.assign(windowOptions, savedWindowState.bounds)
  } else {
    windowOptions.width = 1280
    windowOptions.height = 800
  }
  mainWindow = new BrowserWindow(windowOptions)
  configureNavigation(mainWindow)
  // Closing the window stops the local backend and its reserved port, which
  // changes the Web address on next launch. Unless the user chose to fully
  // quit (and remembered it), the window minimizes to the tray instead; the
  // tray menu's 退出 is the only way to fully quit while minimized.
  mainWindow.on('close', event => {
    if (quitting) return
    const config = loadCloseBehavior()
    if (config.remembered && config.behavior === 'minimize') {
      event.preventDefault()
      minimizeToTray()
      return
    }
    if (config.remembered) return
    event.preventDefault()
    void askCloseBehavior()
  })
  // Persist the window geometry (bounds + maximized / full-screen flags) on
  // any change, debounced; a final flush happens in before-quit.
  let windowStatePending = false
  const scheduleWindowStateSave = () => {
    if (windowStatePending) return
    windowStatePending = true
    setTimeout(() => {
      windowStatePending = false
      saveWindowState()
    }, 300)
  }
  for (const eventName of ['resize', 'move', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) {
    mainWindow.on(eventName, scheduleWindowStateSave)
  }
  mainWindow.once('ready-to-show', () => {
    if (savedWindowState?.isFullScreen) mainWindow?.setFullScreen(true)
    else if (savedWindowState?.isMaximized) mainWindow?.maximize()
    mainWindow?.show()
  })
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

function initAutoUpdater() {
  // 仅打包版本启用自动更新（开发模式无发布通道）。
  if (!app.isPackaged) return
  // 便携版无法静默替换运行中的 exe：跳过自动更新，改用设置里的手动「检查更新」。
  if (process.env.PORTABLE_EXECUTABLE_DIR) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('update-downloaded', (info) => {
    void dialog
      .showMessageBox({
        type: 'info',
        title: '更新已就绪',
        message: `新版本 ${info.version} 已下载完成`,
        detail: '应用将在退出时自动安装更新。',
        buttons: ['立即重启并安装', '稍后'],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall()
      })
  })
  autoUpdater.on('error', (error) => {
    // 静默记录：自动更新失败不影响正常使用，可到 设置 → 检查更新 手动检查。
    appendBackendOutput(`Auto-update error: ${String(error)}\n`)
    // 失败（网络 / GitHub API 限流）时清除节流记录，下次启动立即重试。
    clearAutoCheck()
  })
  autoUpdater.on('update-available', () => recordAutoCheck())
  autoUpdater.on('update-not-available', () => recordAutoCheck())
  // GitHub 未认证 API 限流保护：成功检查后 1 小时内不再重复检查，
  // 避免每次启动都消耗配额（运营商 NAT 下多用户共享出口 IP）。
  if (!shouldAutoCheck()) return
  autoUpdater.checkForUpdates().catch(() => {})
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()

app.on('second-instance', () => {
  showMainWindow()
})

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return
  Menu.setApplicationMenu(null)
  try {
    await launch()
    initAutoUpdater()
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
  saveWindowState()
  tray?.destroy()
  stopBackend()
})
