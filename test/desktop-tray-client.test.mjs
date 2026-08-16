/**
 * Smoke test for the dsh-desktop-tray client bundle: loads the shipped
 * window.__ModuleLoader__ factory in a mocked browser-ish environment and
 * verifies that dispatching the tray command event calls the official
 * workspaces services (new-session / add-workspace) and that apply() returns
 * a disposer which removes the listener.
 */
import { readFileSync } from 'node:fs'

// --- minimal browser-ish environment -------------------------------------
const listeners = new Map()
globalThis.window = {
  __ModuleLoader__: {
    load(entry) {
      loaded.push(entry)
    },
  },
  addEventListener(name, handler) {
    listeners.set(name, handler)
  },
  removeEventListener(name) {
    listeners.delete(name)
  },
  dispatchEvent(event) {
    const handler = listeners.get(event.type)
    if (handler) handler(event)
  },
}
const loaded = []

const requireStub = (name) => {
  if (name === '@deepseek-ai/dsh-client-runtime/client') return {}
  throw new Error(`unexpected require: ${name}`)
}

// --- cordis ctx stub with recorded workspaces calls -----------------------
const calls = []
const ctx = {
  workspaces: {
    startSession(workspaceId) {
      calls.push(['startSession', workspaceId])
    },
    async pickDirectory() {
      return '/tmp/picked-dir'
    },
    async create(input) {
      calls.push(['create', input.path])
      return { workspaceId: 'ws-1' }
    },
  },
}

// --- load the bundle -------------------------------------------------------
const source = readFileSync(new URL('../plugins/dsh-desktop-tray/lib/client.js', import.meta.url), 'utf8')
;(0, eval)(source)
if (loaded.length !== 1) throw new Error(`bundle should register exactly one loader entry, got ${loaded.length}`)
const entry = loaded[0]
if (entry.id !== 'dsh-desktop-tray') throw new Error(`unexpected loader id: ${entry.id}`)
const moduleExports = entry.factory(requireStub)
if (typeof moduleExports.apply !== 'function') throw new Error('apply export missing')
if (!Array.isArray(moduleExports.inject)) throw new Error('inject export missing')
if (JSON.stringify(moduleExports.inject) !== JSON.stringify(['workspaces'])) {
  throw new Error(`unexpected inject list: ${moduleExports.inject.join(', ')}`)
}

// --- command dispatch ------------------------------------------------------
const dispose = moduleExports.apply(ctx)

window.dispatchEvent({ type: 'dsh-desktop-tray-command', detail: 'new-session' })
if (JSON.stringify(calls) !== JSON.stringify([['startSession', undefined]])) {
  throw new Error(`new-session command wrong: ${JSON.stringify(calls)}`)
}

calls.length = 0
await window.dispatchEvent({ type: 'dsh-desktop-tray-command', detail: 'add-workspace' })
// allow the promise chain to settle
await new Promise((resolve) => setTimeout(resolve, 10))
const expected = [
  ['create', '/tmp/picked-dir'],
  ['startSession', 'ws-1'],
]
if (JSON.stringify(calls) !== JSON.stringify(expected)) {
  throw new Error(`add-workspace command wrong: ${JSON.stringify(calls)}`)
}

// unknown commands are ignored
calls.length = 0
window.dispatchEvent({ type: 'dsh-desktop-tray-command', detail: 'something-else' })
if (calls.length !== 0) throw new Error('unknown command should be ignored')

// disposer removes the listener
dispose()
window.dispatchEvent({ type: 'dsh-desktop-tray-command', detail: 'new-session' })
if (calls.length !== 0) throw new Error('disposed bridge should ignore commands')

console.log('tray client smoke test: all assertions passed')
