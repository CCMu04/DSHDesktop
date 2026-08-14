/**
 * Smoke test for the dsh-desktop-notify client bundle: loads the
 * window.__ModuleLoader__ factory in a mocked browser-ish environment and
 * verifies the feature data face plus the completion-reminder behavior
 * (running true→false edge, only while the window is not focused).
 */
import { readFileSync } from 'node:fs'

// --- minimal browser-ish environment -------------------------------------
const loaded = []
const windowListeners = {}
globalThis.window = {
  __ModuleLoader__: { load(entry) { loaded.push(entry) } },
  innerWidth: 1280,
  innerHeight: 800,
  open() {},
  focus() {},
  addEventListener(type, fn) {
    ;(windowListeners[type] ??= []).push(fn)
  },
  removeEventListener(type, fn) {
    const list = windowListeners[type]
    if (!list) return
    const i = list.indexOf(fn)
    if (i >= 0) list.splice(i, 1)
  },
}
let focused = false
const fakeElement = () => ({ dataset: {}, style: {}, children: [], appendChild() {}, remove() {}, classList: { add() {}, remove() {} } })
globalThis.document = {
  hasFocus: () => focused,
  addEventListener() {},
  removeEventListener() {},
  querySelector() { return null },
  querySelectorAll() { return [] },
  createElement: fakeElement,
  head: { appendChild() {} },
  body: { appendChild() {} },
  dispatchEvent() {},
}
globalThis.MutationObserver = class { observe() {} disconnect() {} }

// --- Notification stub ------------------------------------------------------
const notifications = []
globalThis.Notification = class {
  static permission = 'granted'
  static requestPermission() { return Promise.resolve('granted') }
  constructor(title, options) {
    this.title = title
    this.options = options
    this.onclick = null
    notifications.push(this)
  }
}

// --- host API stub ----------------------------------------------------------
let notifyEnabled = true
globalThis.fetch = async (url) => {
  if (String(url).endsWith('/api/desktop-notify/config')) {
    return { ok: true, json: async () => ({ enabled: notifyEnabled }) }
  }
  return { ok: true, json: async () => ({}) }
}
globalThis.location = { reload() {} }

// --- sessions stub ----------------------------------------------------------
let sessionListener = null
let listListener = null
let sessionSnap = { running: false, nodes: [] }
const sessions = {
  list: {
    getSnapshot: () => ({ current: 's1' }),
    subscribe(fn) {
      listListener = fn
      return () => { listListener = null }
    },
  },
  binding(id) {
    if (id !== 's1') return void 0
    return {
      session: {
        getSnapshot: () => ({ ...sessionSnap }),
        subscribe(fn) {
          sessionListener = fn
          return () => { if (sessionListener === fn) sessionListener = null }
        },
      },
    }
  },
}

// --- cordis ctx stub ----------------------------------------------------------
const registered = []
const ctx = {
  locale: { bind: () => (key) => key, register() {} },
  slots: {
    register(options, component) { return { options, component } },
    inject(name, factory) {
      const entry = factory()
      registered.push({ name, entry })
      return () => {
        const i = registered.findIndex((r) => r.entry === entry)
        if (i >= 0) registered.splice(i, 1)
      }
    },
  },
  effect(fn) {
    const result = fn()
    return typeof result === 'function' ? result : () => {}
  },
  get(name) {
    if (name === 'sessions') return sessions
    return void 0
  },
  on() {},
  provide() {},
}

// --- load the bundle ----------------------------------------------------------
const source = readFileSync(new URL('../plugins/dsh-desktop-notify/lib/client.js', import.meta.url), 'utf8')
;(0, eval)(source)
if (loaded.length !== 1) throw new Error(`expected 1 loader entry, got ${loaded.length}`)
const exports = loaded[0].factory(() => { throw new Error('notify bundle must not require anything') })

exports.apply(ctx)
await new Promise((resolve) => setTimeout(resolve, 10)) // 等待配置收敛（enabled=true）

// feature data face is registered always
const items = registered.filter((r) => r.name === 'desktop.features.item' && r.entry.options?.id === 'notify')
if (items.length !== 1) throw new Error('notify feature face missing')
const face = items[0].entry.options.inject()
if (typeof face.load !== 'function' || typeof face.save !== 'function') throw new Error('face must provide load/save')
if (typeof face.title !== 'string' || typeof face.description !== 'string') throw new Error('face must provide title/description')

// --- completion scenarios ------------------------------------------------------
// 1) idle → running → finished, window NOT focused → notification
sessionSnap = { running: false, nodes: [] }
sessionListener() // first observation records the running bit only
sessionSnap = { running: true, nodes: [] }
sessionListener()
sessionSnap = {
  running: false,
  nodes: [
    { kind: 'user', seq: 1 },
    { kind: 'assistant', seq: 2, blocks: [{ kind: 'text', text: ' 你好，世界！ ' }] },
  ],
}
sessionListener()
if (notifications.length !== 1) throw new Error(`expected 1 notification, got ${notifications.length}`)
const n1 = notifications[0]
if (n1.title !== 'notify.title') throw new Error(`title wrong: ${n1.title}`)
if (n1.options.body !== '你好，世界！') throw new Error(`body wrong: ${n1.options.body}`)

// 2) window focused → no notification
notifications.length = 0
focused = true
for (const fn of windowListeners.focus ?? []) fn()
sessionSnap = { running: true, nodes: [] }
sessionListener()
sessionSnap = { running: false, nodes: [{ kind: 'assistant', seq: 3, blocks: [{ kind: 'text', text: 'x' }] }] }
sessionListener()
if (notifications.length !== 0) throw new Error(`focused should not notify, got ${notifications.length}`)

// 3) no true→false edge (first observation already idle) → no notification
focused = false
for (const fn of windowListeners.blur ?? []) fn()
sessionSnap = { running: false, nodes: [] }
sessionListener() // records idle; no edge
if (notifications.length !== 0) throw new Error(`idle edge should not notify, got ${notifications.length}`)

// 4) turn-error → error copy
sessionSnap = { running: true, nodes: [] }
sessionListener()
sessionSnap = { running: false, nodes: [{ kind: 'turn-error', seq: 4, message: 'boom' }] }
sessionListener()
if (notifications.length !== 1) throw new Error(`error should notify once, got ${notifications.length}`)
if (notifications[0].options.body !== 'notify.error') throw new Error(`error body wrong: ${notifications[0].options.body}`)

// 5) assistant without text → fallback copy
notifications.length = 0
sessionSnap = { running: true, nodes: [] }
sessionListener()
sessionSnap = { running: false, nodes: [{ kind: 'assistant', seq: 5, blocks: [{ kind: 'tool-call', callId: 'c', name: 'fs', argsRaw: '{}' }] }] }
sessionListener()
if (notifications.length !== 1) throw new Error(`empty should notify once, got ${notifications.length}`)
if (notifications[0].options.body !== 'notify.empty') throw new Error(`empty body wrong: ${notifications[0].options.body}`)

// 6) long preview truncated with ellipsis
notifications.length = 0
const longText = '字'.repeat(150)
sessionSnap = { running: true, nodes: [] }
sessionListener()
sessionSnap = { running: false, nodes: [{ kind: 'assistant', seq: 6, blocks: [{ kind: 'text', text: longText }] }] }
sessionListener()
if (notifications.length !== 1) throw new Error(`long should notify once, got ${notifications.length}`)
const body = notifications[0].options.body
if (body.length >= 150 || !body.endsWith('…')) throw new Error(`body not truncated: length=${body.length}`)

// --- disabled: no reminder logic installed -----------------------------------
notifyEnabled = false
registered.length = 0
notifications.length = 0
const fresh = []
globalThis.window.__ModuleLoader__ = { load(entry) { fresh.push(entry) } }
;(0, eval)(source)
const freshExports = fresh[0].factory(() => { throw new Error('notify bundle must not require anything') })
freshExports.apply(ctx)
await new Promise((resolve) => setTimeout(resolve, 10))
sessionSnap = { running: true, nodes: [] }
if (sessionListener !== null) sessionListener()
sessionSnap = { running: false, nodes: [{ kind: 'assistant', seq: 7, blocks: [{ kind: 'text', text: 'y' }] }] }
if (sessionListener !== null) sessionListener()
if (notifications.length !== 0) throw new Error(`disabled should not notify, got ${notifications.length}`)
// the data face is still registered
const face2 = registered.filter((r) => r.name === 'desktop.features.item' && r.entry.options?.id === 'notify')
if (face2.length !== 1) throw new Error('feature face must stay registered when disabled')

console.log('notify client test: all assertions passed')
