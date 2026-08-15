/**
 * Smoke test for the dsh-desktop-git client bundle: loads the shipped
 * window.__ModuleLoader__ factory in a mocked browser-ish environment and
 * verifies apply() registers the feature-card entry (order 30), waits for
 * the desktop.workbench service, registers the git tab, and that the
 * disabled config disposes everything.
 */
import { readFileSync } from 'node:fs'

// --- minimal browser-ish environment -------------------------------------
const loaded = []
globalThis.window = {
  __ModuleLoader__: {
    load(entry) {
      loaded.push(entry)
    },
  },
  innerWidth: 1280,
  innerHeight: 800,
}
const fakeElement = (className = '') => ({
  dataset: {},
  style: {},
  className,
  children: [],
  appendChild() {},
  remove() {},
  contains() { return false },
  classList: { add() {}, remove() {} },
})
const headStyles = []
globalThis.document = {
  addEventListener() {},
  removeEventListener() {},
  querySelector() { return null },
  querySelectorAll() { return [] },
  createElement: (tag) => {
    if (tag === 'style') {
      const el = fakeElement()
      headStyles.push(el)
      return el
    }
    return fakeElement()
  },
  head: { appendChild() {} },
  body: { appendChild() {} },
  dispatchEvent() {},
}
globalThis.MutationObserver = class { observe() {} disconnect() {} }
globalThis.confirm = () => true

// --- minimal module stubs -------------------------------------------------
function makeElement(type, props, ...children) {
  return { type, props: { ...(props ?? {}), children: children.length > 0 ? children : undefined } }
}
const stubReact = {
  Component: class Component {
    constructor(props) {
      this.props = props
    }
  },
  createElement: makeElement,
  useState: (initial) => {
    let value = initial
    return [value, (next) => {
      value = typeof next === 'function' ? next(value) : next
    }]
  },
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useId: () => 'smoke-id',
  useRef: (initial) => ({ current: initial }),
  useSyncExternalStore: () => null,
}
const stubJsxRuntime = {
  jsx: makeElement,
  jsxs: makeElement,
  Fragment: Symbol('Fragment'),
}
const requireStub = (name) => {
  if (name === 'react') return stubReact
  if (name === 'react/jsx-runtime') return stubJsxRuntime
  if (name === '@deepseek-ai/dsh-client-ui-primitives') return {}
  throw new Error(`unexpected require: ${name}`)
}

// --- host config API stub --------------------------------------------------
let servedConfig = { enabled: true }
globalThis.fetch = async (url, options) => {
  const path = String(url).split('?')[0]
  if (path === '/api/desktop-git/config') {
    if (options?.method === 'POST') return { ok: true }
    return { ok: true, json: async () => servedConfig }
  }
  throw new Error(`unexpected fetch: ${url}`)
}

// --- cordis ctx stub -------------------------------------------------------
const registered = []
// 假 workbench 服务：记录 tab 注册，disposer 真实移除（收敛语义）。
const tabs = []
const fakeWorkbench = {
  registerTab(descriptor) {
    tabs.push(descriptor)
    return () => {
      const i = tabs.indexOf(descriptor)
      if (i >= 0) tabs.splice(i, 1)
    }
  },
  registerViewer() {
    return () => {}
  },
  openFile() {},
  activateTab() {},
}
const sessionsStub = {
  list: {
    getSnapshot: () => ({
      current: 's1',
      items: [{ id: 's1' }],
      byId: { s1: { cwd: 'C:\\work\\demo' } },
    }),
    subscribe: () => () => {},
  },
}
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
      registered.push({ name, entry })
      return () => {}
    },
  },
  effect(fn) {
    const result = fn()
    return typeof result === 'function' ? result : () => {}
  },
  provide() {
    return () => {}
  },
  get(name) {
    if (name === 'desktop.workbench') return fakeWorkbench
    if (name === 'sessions') return sessionsStub
    return undefined
  },
}

// --- load the bundle -------------------------------------------------------
const source = readFileSync(
  new URL('../plugins/dsh-desktop-git/lib/client.js', import.meta.url),
  'utf8',
)
;(0, eval)(source)
if (loaded.length !== 1) throw new Error(`bundle should register exactly one loader entry, got ${loaded.length}`)
const entry = loaded[0]
if (entry.id !== 'dsh-desktop-git') throw new Error(`unexpected loader id: ${entry.id}`)
const moduleExports = entry.factory(requireStub)
if (typeof moduleExports.apply !== 'function') throw new Error('apply export missing')
if (!Array.isArray(moduleExports.inject)) throw new Error('inject export missing')

// --- run apply -------------------------------------------------------------
moduleExports.apply(ctx)

// Feature card registered (order 30).
const card = registered.find((r) => r.name === 'desktop.features.item')
if (!card) throw new Error('desktop.features.item entry missing')
if (card.entry.options?.id !== 'git') throw new Error(`card id wrong: ${card.entry.options?.id}`)
if (card.entry.options?.order !== 30) throw new Error(`card order wrong: ${card.entry.options?.order}`)
const face = card.entry.inject()
if (typeof face?.load !== 'function' || typeof face?.save !== 'function') {
  throw new Error('card data interface incomplete')
}
if (await face.load() !== true) throw new Error('face.load should resolve true')

// 等配置收敛（默认全开 → 真实配置到达 → dispose + 重装），断言取最后一组。
await new Promise((resolve) => setTimeout(resolve, 10))

// Git tab registered into the workbench（主页签栏只挂功能页签）。
const tab = tabs.find((t) => t.id === 'git')
if (!tab) throw new Error('git tab not registered')
if (tab.order !== 30) throw new Error(`git tab order wrong: ${tab.order}`)
if (typeof tab.icon !== 'function') throw new Error('git tab icon missing')
if (typeof tab.component !== 'function') throw new Error('git tab component missing')

// 禁用态收敛：不注册任何 tab。
servedConfig = { enabled: false }
loaded.length = 0
headStyles.length = 0
tabs.length = 0
registered.length = 0
;(0, eval)(source)
const freshExports = loaded[0].factory(requireStub)
freshExports.apply(ctx)
await new Promise((resolve) => setTimeout(resolve, 10))
if (tabs.length !== 0) {
  throw new Error(`disabled config should register nothing, got tabs=${tabs.length}`)
}

console.log('git client smoke test: all assertions passed')
