/**
 * Smoke test for the dsh-desktop-ui client bundle: loads the shipped
 * window.__ModuleLoader__ factory in a mocked browser-ish environment and
 * verifies apply() installs the default all-on features, then converges to
 * the served configuration without throwing.
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
const fakeElement = () => ({ dataset: {}, style: {}, children: [], appendChild() {}, remove() {}, classList: { add() {}, remove() {} } })
const headStyles = []
globalThis.document = {
  addEventListener() {},
  removeEventListener() {},
  querySelector() { return null },
  querySelectorAll() { return [] },
  createElement: () => {
    const el = fakeElement()
    headStyles.push(el)
    el.remove = () => {
      const i = headStyles.indexOf(el)
      if (i >= 0) headStyles.splice(i, 1)
    }
    return el
  },
  head: { appendChild() {} },
  body: { appendChild() {} },
  dispatchEvent() {},
}
globalThis.MutationObserver = class { observe() {} disconnect() {} }

// --- minimal module stubs -------------------------------------------------
function makeElement(type, props) {
  return { type, props: props ?? {} }
}
const stubReact = {
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
const stubClientRuntime = {
  createSnapshotStore: (initial) => ({
    snapshot: { ...initial },
    update(fn) {
      fn(this.snapshot)
    },
    getSnapshot() {
      return this.snapshot
    },
    subscribe() {
      return () => {}
    },
  }),
}
const requireStub = (name) => {
  if (name === 'react') return stubReact
  if (name === 'react/jsx-runtime') return stubJsxRuntime
  if (name === 'react-dom') return { createPortal: (node) => node }
  if (name === '@deepseek-ai/dsh-client-runtime/client') return stubClientRuntime
  if (name === '@deepseek-ai/dsh-client-ui-primitives') return {}
  throw new Error(`unexpected require: ${name}`)
}

// --- host config API stub: settingsDrawer off, the rest on -----------------
let servedConfig = { settingsDrawer: false, sessionLogExport: true, statsLine: true }
globalThis.fetch = async (url, options) => {
  if (options?.method === 'POST') return { ok: true }
  return {
    ok: true,
    json: async () => servedConfig,
  }
}
globalThis.location = { reload() {} }

// --- cordis ctx stub -------------------------------------------------------
const registered = []
const ctx = {
  locale: {
    bind: () => (key) => key,
    register() {},
  },
  slots: {
    register(options, component) {
      return { options, component }
    },
    inject(name, factory) {
      // The real service defers the factory until the slot is declared; the
      // overlay + settings slots are always declared, so eager is faithful.
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
    if (name === 'connection') return undefined
    if (name === 'sessionLogDownload') return undefined
    return undefined
  },
  on() {},
  provide() {},
}

// --- load the bundle -------------------------------------------------------
const source = readFileSync(new URL('../plugins/dsh-desktop-ui/lib/client.js', import.meta.url), 'utf8')
;(0, eval)(source)
if (loaded.length !== 1) throw new Error(`bundle should register exactly one loader entry, got ${loaded.length}`)
const entry = loaded[0]
if (entry.id !== 'dsh-desktop-ui') throw new Error(`unexpected loader id: ${entry.id}`)
const moduleExports = entry.factory(requireStub)
if (typeof moduleExports.apply !== 'function') throw new Error('apply export missing')
if (!Array.isArray(moduleExports.inject)) throw new Error('inject export missing')

// --- run apply and let the async config convergence settle ----------------
moduleExports.apply(ctx)
const allOnIds = () => registered.map((r) => r.entry.options?.id).sort()
// 视觉增强现在只有 config 卡片注册 slot 条目（settingsDrawer 走 effect、
// sessionLogExport 因测试环境无 sessionLogDownload 控制器而跳过）。
if (JSON.stringify(allOnIds()) !== JSON.stringify(['dsh-desktop-ui-config'])) {
  throw new Error(`all-on install entries wrong: ${allOnIds().join(', ')}`)
}
// All-on installs every feature style plus the always-on card style.
if (headStyles.length !== 4) {
  throw new Error(`all-on should install 4 style tags, got ${headStyles.length}: ${headStyles.map((s) => s.dataset.pluginCss).join(', ')}`)
}

await new Promise((resolve) => setTimeout(resolve, 10))
// 收敛后 settingsDrawer 关闭：抽屉 CSS 与 shim 被移除，条目不变。
const ids = allOnIds()
if (JSON.stringify(ids) !== JSON.stringify(['dsh-desktop-ui-config'])) {
  throw new Error(`converged entries wrong: ${ids.join(', ')}`)
}
const remainingStyles = headStyles.map((s) => s.dataset.pluginCss).sort()
const expectedStyles = [
  'dsh-desktop-ui/ConfigCard.module.css',
  'dsh-desktop-ui/HeaderAction.module.css',
  'dsh-desktop-ui/StatsLine.module.css',
].sort()
if (JSON.stringify(remainingStyles) !== JSON.stringify(expectedStyles)) {
  throw new Error(`converged styles wrong: ${remainingStyles.join(', ')}`)
}

// --- a fresh page (reload path) with everything off must also be clean ----
servedConfig = { settingsDrawer: false, sessionLogExport: false, statsLine: false }
registered.length = 0
headStyles.length = 0
loaded.length = 0
;(0, eval)(source) // a real reload re-evaluates the whole bundle
const freshEntry = loaded[0]
const freshExports = freshEntry.factory(requireStub)
freshExports.apply(ctx)
await new Promise((resolve) => setTimeout(resolve, 10))
const ids2 = registered.map((r) => r.entry.options?.id).sort()
if (JSON.stringify(ids2) !== JSON.stringify(['dsh-desktop-ui-config'])) {
  throw new Error(`all-off entries wrong: ${ids2.join(', ')}`)
}
// Everything off: only the always-on card style remains.
const offStyles = headStyles.map((s) => s.dataset.pluginCss).sort()
if (JSON.stringify(offStyles) !== JSON.stringify(['dsh-desktop-ui/ConfigCard.module.css'])) {
  throw new Error(`all-off styles wrong: ${offStyles.join(', ')}`)
}

console.log('client smoke test: all assertions passed')
