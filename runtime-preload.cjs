'use strict'

// The packaged Electron executable doubles as the Node.js runtime used by DSH.
// Make ordinary Windows child processes background-safe for a GUI application.
const childProcess = require('node:child_process')
const { registerHooks, syncBuiltinESMExports } = require('node:module')
const path = require('node:path')

// DSH's restricted-token child must share its host console, but it can still
// ask Windows not to show that shared console window. Apply STARTF_USESHOWWINDOW
// with SW_HIDE while the official module is loaded; no installed DSH file is
// changed, and the exact-match guard makes an upstream layout change fail safe.
registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context)
    if (!/[/\\]@deepseek-ai[/\\]dsh-sandbox-windows-acl[/\\]lib[/\\]types-[^/\\]+\.js$/iu.test(url)) {
      return result
    }

    const source = Buffer.isBuffer(result.source)
      ? result.source.toString('utf8')
      : String(result.source)
    const signature = 'dwFlags: 256,\n\t\thStdInput:'
    const matches = source.split(signature).length - 1
    if (matches !== 2) {
      process.emitWarning(`DSH desktop console-hiding shim expected 2 spawn signatures, found ${matches}.`)
      return result
    }

    return {
      ...result,
      source: source.replaceAll(signature, 'dwFlags: 257,\n\t\twShowWindow: 0,\n\t\thStdInput:'),
    }
  },
})

function isWindowsAclRunner(command, args) {
  if (command.toLowerCase() !== process.execPath.toLowerCase()) return false
  return args.some(arg => typeof arg === 'string'
    && /dsh-sandbox-windows-acl[\\/].*runner\.js$/i.test(arg))
}

function isNativePathOpener(command, args) {
  const executable = path.basename(command).toLowerCase()
  if (executable !== 'powershell.exe' && executable !== 'powershell' && executable !== 'pwsh.exe' && executable !== 'pwsh') {
    return false
  }
  return args.some(arg => typeof arg === 'string' && /\bInvoke-Item\s+-LiteralPath\b/iu.test(arg))
}

function nativeOpenEnvironment(options) {
  const environment = { ...(options?.env ?? process.env) }
  delete environment.ELECTRON_RUN_AS_NODE
  delete environment.NODE_OPTIONS
  return { ...(options ?? {}), env: environment, windowsHide: true }
}

function desktopOptions(command, args, options) {
  // DSH's restricted-token sandbox explicitly requires an inherited console:
  // CREATE_NO_WINDOW makes the confined child fail during DLL initialization.
  if (isWindowsAclRunner(command, args)) return options ?? {}
  return { ...(options ?? {}), windowsHide: true }
}

const spawn = childProcess.spawn
childProcess.spawn = function desktopSpawn(command, args, options) {
  if (Array.isArray(args)) return spawn.call(this, command, args, desktopOptions(command, args, options))
  return spawn.call(this, command, desktopOptions(command, [], args))
}

const spawnSync = childProcess.spawnSync
childProcess.spawnSync = function desktopSpawnSync(command, args, options) {
  if (Array.isArray(args)) return spawnSync.call(this, command, args, desktopOptions(command, args, options))
  return spawnSync.call(this, command, desktopOptions(command, [], args))
}

const execFile = childProcess.execFile
childProcess.execFile = function desktopExecFile(command, args, options, callback) {
  if (!Array.isArray(args) || !isNativePathOpener(command, args)) {
    return execFile.apply(this, arguments)
  }
  if (typeof options === 'function') {
    const nativeOptions = nativeOpenEnvironment(undefined)
    return execFile.call(this, command, args, nativeOptions, options)
  }
  const nativeOptions = nativeOpenEnvironment(options)
  return execFile.call(this, command, args, nativeOptions, callback)
}

// Refresh named ESM imports such as `import { spawn } from 'node:child_process'`.
syncBuiltinESMExports()

// Keep ELECTRON_RUN_AS_NODE: DSH intentionally uses process.execPath for its
// ACL sandbox runner and other Node-side helpers. The native opener receives a
// clean environment so an Electron-based editor does not inherit Node mode.

module.exports = { isNativePathOpener, nativeOpenEnvironment }
