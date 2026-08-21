/**
 * Smoke test for the dsh-desktop-browser client bundle: loads the shipped
 * window.__ModuleLoader__ factory in a mocked browser-ish environment and
 * verifies apply() registers the feature-card entry (desktop.features.item)
 * and the workbench browser tab (desktop.workbench.registerTab), that the
 * workbench service being late is handled via the retry loop, and that the
 * panel styles are injected under the plugin's data-plugin attribute.
 */
import { readFileSync } from 'node:fs'

// --- minimal browser-ish environment -------------------------------------
const loaded = []
const registered = []
const headStyles = []
const tabRegistrations = []
const markers = []
const realConsoleLog = console.log
const realSetTimeout = setTimeout
let nextTimerId = 0
const cancelledTimers = new Set()

const listeners = new Map()
globalThis.window = {
  __ModuleLoader__: {
    load(entry) {
      loaded.push(entry)
    },
  },
  addEventListener(name, fn) {
    if (!listeners.has(name)) listeners.set(name, [])
    listeners.get(name).push(fn)
  },
  removeEventListener(name, fn) {
    const arr = listeners.get(name)
    if (!arr) return
    const i = arr.indexOf(fn)
    if (i >= 0) arr.splice(i, 1)
  },
  devicePixelRatio: 1,
}

globalThis.console = {
  ...console,
  log(...args) {
    markers.push(args.map(String).join(' '))
  },
}

// 让 setTimeout 立即以微任务执行：加速 workbench 服务迟到重试路径。
globalThis.setTimeout = (fn) => {
  const id = ++nextTimerId
  queueMicrotask(() => {
    if (!cancelledTimers.has(id)) fn()
  })
  return id
}
globalThis.clearTimeout = (id) => cancelledTimers.add(id)

globalThis.requestAnimationFrame = (fn) => {
  queueMicrotask(fn)
  return 1
}
globalThis.cancelAnimationFrame = () => {}

class FakeMutationObserver {
  constructor() {}
  observe() {}
  disconnect() {}
  takeRecords() {
    return []
  }
}
class FakeResizeObserver {
  constructor() {}
  observe() {}
  disconnect() {}
  takeRecords() {
    return []
  }
}
globalThis.MutationObserver = FakeMutationObserver
globalThis.ResizeObserver = FakeResizeObserver

const documentBody = { dataset: {}, style: {} }
globalThis.document = {
  body: documentBody,
  documentElement: documentBody,
  addEventListener() {},
  removeEventListener() {},
  querySelector() {
    return null
  },
  querySelectorAll() {
    return []
  },
  getElementById() {
    return null
  },
  createElement(tag) {
    if (tag === 'style') {
      const el = {
        id: '',
        textContent: '',
        attributes: {},
        setAttribute(key, value) {
          el.attributes[key] = value ?? ''
        },
        remove() {},
      }
      headStyles.push(el)
      return el
    }
    return { dataset: {}, style: {}, attributes: {}, setAttribute() {}, remove() {} }
  },
  head: {
    appendChild() {},
  },
  dispatchEvent() {},
}

// --- module stubs -----------------------------------------------------------
function makeElement(type, props, ...children) {
  return { type, props: { ...(props ?? {}), children: children.length > 0 ? children : undefined } }
}
const stubReact = {
  createElement: makeElement,
  useState: (initial) => {
    let value = initial
    return [
      value,
      (next) => {
        value = typeof next === 'function' ? next(value) : next
      },
    ]
  },
  useEffect: (fn) => {
    const cleanup = fn()
    if (typeof cleanup === 'function') cleanups.push(cleanup)
  },
  useMemo: (fn) => fn(),
  useRef: (initial) => ({ current: initial }),
}
const cleanups = []
const stubJsxRuntime = {
  jsx: makeElement,
  jsxs: makeElement,
  Fragment: Symbol('Fragment'),
}
const requireStub = (name) => {
  if (name === 'react') return stubReact
  if (name === 'react/jsx-runtime') return stubJsxRuntime
  if (name === '@deepseek-ai/dsh-client-ui-primitives') {
    return { IconGlobeOutline14: () => null }
  }
  throw new Error(`unexpected require: ${name}`)
}

// --- workbench service stub ------------------------------------------------
let workbenchGets = 0
const workbenchStub = {
  registerTab(descriptor) {
    tabRegistrations.push(descriptor)
    return () => {
      const i = tabRegistrations.indexOf(descriptor)
      if (i >= 0) tabRegistrations.splice(i, 1)
    }
  },
}

// --- host config API stub: enabled on by default ---------------------------
let servedConfig = { enabled: true }
let saves = 0
globalThis.fetch = async (url, options) => {
  const path = String(url).split('?')[0]
  if (path === '/api/desktop-browser/config') {
    if (options?.method === 'POST') {
      saves += 1
      return { ok: true }
    }
    return { ok: true, json: async () => servedConfig }
  }
  if (path === '/api/desktop-browser/prefs') {
    return { ok: true, json: async () => ({ prefs: {} }) }
  }
  throw new Error(`unexpected fetch: ${url}`)
}

// --- cordis ctx stub -------------------------------------------------------
const ctx = {
  locale: {
    bind: () => (key) => key,
    register() {},
  },
  slots: {
    register(options, component) {
      return { options, component, inject: () => options.inject() }
    },
    inject(name, factory) {
      const entry = factory()
      const record = { name, entry }
      registered.push(record)
      return () => {
        const i = registered.indexOf(record)
        if (i >= 0) registered.splice(i, 1)
      }
    },
  },
  effect(fn) {
    const result = fn()
    return typeof result === 'function' ? result : () => {}
  },
  get(name) {
    if (name === 'desktop.workbench') {
      workbenchGets += 1
      // 前两次返回 undefined：模拟 workbench 服务迟到，触发重试路径。
      return workbenchGets > 2 ? workbenchStub : undefined
    }
    return undefined
  },
}

// --- load the bundle -------------------------------------------------------
const source = readFileSync(
  new URL('../plugins/dsh-desktop-browser/lib/client.js', import.meta.url),
  'utf8',
)
;(0, eval)(source)
if (loaded.length !== 1)
  throw new Error(`bundle should register exactly one loader entry, got ${loaded.length}`)
const entry = loaded[0]
if (entry.id !== 'dsh-desktop-browser') throw new Error(`unexpected loader id: ${entry.id}`)
const moduleExports = entry.factory(requireStub)
if (typeof moduleExports.apply !== 'function') throw new Error('apply export missing')
if (!Array.isArray(moduleExports.inject)) throw new Error('inject export missing')

// --- run apply; config convergence may reinstall, wait for it --------------
moduleExports.apply(ctx)
await new Promise((resolve) => realSetTimeout(resolve, 5))

// Feature card entry registered.
const card = registered.find((r) => r.name === 'desktop.features.item')
if (!card) throw new Error('desktop.features.item entry missing')
if (card.entry.options?.id !== 'browser') throw new Error(`card id wrong: ${card.entry.options?.id}`)
if (card.entry.options?.order !== 20) throw new Error(`card order wrong: ${card.entry.options?.order}`)
const face = card.entry.inject()
if (typeof face?.load !== 'function' || typeof face?.save !== 'function') {
  throw new Error('card data interface incomplete')
}
if ((await face.load()) !== true) throw new Error('face.load should resolve true')
if ((await face.save(false)) !== true) throw new Error('face.save should resolve true')
if (saves !== 1) throw new Error(`expected 1 config save, got ${saves}`)

// Workbench tab registered via the retry loop (service was late).
if (workbenchGets < 3) throw new Error(`retry loop did not run: gets=${workbenchGets}`)
if (tabRegistrations.length !== 1) {
  throw new Error(`expected exactly 1 tab registration, got ${tabRegistrations.length}`)
}
const tab = tabRegistrations[0]
if (tab.id !== 'browser') throw new Error(`tab id wrong: ${tab.id}`)
if (tab.order !== 20) throw new Error(`tab order wrong: ${tab.order}`)
if (typeof tab.component !== 'function') throw new Error('tab component missing')

// Panel styles injected under the plugin's data-plugin attribute.
const styleEl = headStyles.find((s) => s.attributes['data-plugin'] === 'dsh-desktop-browser')
if (!styleEl) throw new Error('plugin style tag not injected')
if (typeof styleEl.textContent !== 'string' || styleEl.textContent.length === 0) {
  throw new Error('plugin style tag empty')
}

// Bridge channel naming: the client must never emit the console marker at
// registration time; it only sends on user interaction (not exercised here).
const cmdMarkers = markers.filter((m) => m.startsWith('__DSH_BROWSER_CMD__:'))
if (cmdMarkers.length !== 0) {
  throw new Error(`unexpected bridge markers during registration: ${cmdMarkers.join(' | ')}`)
}

console.log('browser client test: all assertions passed')
