/**
 * Smoke test for the dsh-desktop-workbench client bundle: loads the shipped
 * window.__ModuleLoader__ factory in a mocked browser-ish environment and
 * verifies apply() provides the desktop.workbench service, registers the
 * feature-card entry, attaches the workbench column as a 4th grid track of
 * the AppFrame (and skips everything when disabled), and that the service
 * registry + action channel behave.
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
  style: {
    setProperty(key, value) {
      this[key] = value
    },
    removeProperty(key) {
      delete this[key]
    },
  },
  attributes: {},
  className,
  children: [],
  appendChild() {},
  remove() {},
  contains() { return false },
  classList: { add() {}, remove() {} },
  setAttribute(key, value) {
    this.attributes[key] = value ?? ''
  },
  removeAttribute(key) {
    delete this.attributes[key]
  },
})
const headStyles = []
const bodyHosts = []
// AppFrame 三栏容器：唯一带内联 grid-template-columns 的元素。
// React 始终只写 inline 三列；实际渲染值由 --ddwb-grid-template 变量接管。
const frame = fakeElement()
frame.style.gridTemplateColumns = '280px minmax(0, 1fr) 0px'
frame.appendChild = (el) => {
  frame.children.push(el)
  el.remove = () => {
    const i = frame.children.indexOf(el)
    if (i >= 0) frame.children.splice(i, 1)
  }
}
frame.contains = (el) => frame.children.includes(el)

// MutationObserver 桩：记录实例并打上观察类型标签，供测试手动触发回调。
const observers = []
globalThis.MutationObserver = class {
  constructor(callback) {
    this.callback = callback
    observers.push(this)
  }
  observe(target, options) {
    this._kind = options?.attributeFilter ? 'style' : 'child'
    this.target = target
  }
  disconnect() {}
  takeRecords() { return [] }
}

globalThis.document = {
  addEventListener() {},
  removeEventListener() {},
  querySelector(selector) {
    if (String(selector).includes('grid-template-columns')) return frame
    return null
  },
  querySelectorAll() { return [] },
  createElement: (tag) => {
    if (tag === 'style') {
      const el = fakeElement()
      headStyles.push(el)
      return el
    }
    return fakeElement()
  },
  head: {
    appendChild() {},
  },
  body: {
    appendChild(el) {
      bodyHosts.push(el)
    },
  },
  dispatchEvent() {},
}

// --- minimal module stubs -------------------------------------------------
function makeElement(type, props, ...children) {
  return { type, props: { ...(props ?? {}), children: children.length > 0 ? children : undefined } }
}
const cleanups = []
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
  useEffect: (fn) => {
    const cleanup = fn()
    if (typeof cleanup === 'function') cleanups.push(cleanup)
  },
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
let renderedRoot = null
let mountedContainer = null
const requireStub = (name) => {
  if (name === 'react') return stubReact
  if (name === 'react/jsx-runtime') return stubJsxRuntime
  if (name === 'react-dom') return { createPortal: (node) => node }
  if (name === '@deepseek-ai/dsh-client-ui-primitives') return {}
  if (name === 'react-dom/client') {
    return {
      createRoot: (container) => {
        mountedContainer = container
        return {
          render(node) {
            renderedRoot = node
          },
          unmount() {},
        }
      },
    }
  }
  throw new Error(`unexpected require: ${name}`)
}

// --- host config API stub: enabled on by default --------------------------
let servedConfig = { enabled: true }
globalThis.fetch = async (url, options) => {
  const path = String(url).split('?')[0]
  if (path === '/api/desktop-workbench/config') {
    if (options?.method === 'POST') return { ok: true }
    return { ok: true, json: async () => servedConfig }
  }
  if (path === '/api/desktop-workbench/layout') {
    if (options?.method === 'POST') {
      return { ok: true, json: async () => ({ ok: true }) }
    }
    return { ok: true, json: async () => ({ session: 's1', layout: null }) }
  }
  throw new Error(`unexpected fetch: ${url}`)
}

// --- cordis ctx stub -------------------------------------------------------
const registered = []
const provided = new Map()
const sessionsStub = {
  list: {
    getSnapshot: () => ({ current: 's1', items: [] }),
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
  provide(name, value) {
    provided.set(name, value)
    return () => provided.delete(name)
  },
  get(name) {
    if (name === 'sessions') return sessionsStub
    return undefined
  },
}

// --- load the bundle -------------------------------------------------------
const source = readFileSync(
  new URL('../plugins/dsh-desktop-workbench/lib/client.js', import.meta.url),
  'utf8',
)
;(0, eval)(source)
if (loaded.length !== 1) throw new Error(`bundle should register exactly one loader entry, got ${loaded.length}`)
const entry = loaded[0]
if (entry.id !== 'dsh-desktop-workbench') throw new Error(`unexpected loader id: ${entry.id}`)
const moduleExports = entry.factory(requireStub)
if (typeof moduleExports.apply !== 'function') throw new Error('apply export missing')
if (!Array.isArray(moduleExports.inject)) throw new Error('inject export missing')

// --- run apply and let the async config convergence settle ----------------
moduleExports.apply(ctx)

// Service is provided unconditionally.
if (!provided.has('desktop.workbench')) throw new Error('desktop.workbench service not provided')
const service = provided.get('desktop.workbench')
if (typeof service.registerTab !== 'function' || typeof service.openFile !== 'function') {
  throw new Error('service API incomplete')
}

// Feature card registered (framework switch, first row).
const card = registered.find((r) => r.name === 'desktop.features.item')
if (!card) throw new Error('desktop.features.item entry missing')
if (card.entry.options?.id !== 'workbench') throw new Error(`card id wrong: ${card.entry.options?.id}`)
if (card.entry.options?.order !== 5) throw new Error(`card order wrong: ${card.entry.options?.order}`)
const face = card.entry.inject()
if (typeof face?.load !== 'function' || typeof face?.save !== 'function') {
  throw new Error('card data interface incomplete')
}

// face.load() resolves through the config API.
if (await face.load() !== true) throw new Error('face.load should resolve true')

// 等配置收敛（默认全开 → 真实配置到达 → 重装），再捕获当前列实例。
await new Promise((resolve) => setTimeout(resolve, 10))

// Default all-on attaches the column as a 4th grid track.
if (frame.children.length !== 1) throw new Error(`expected 1 frame child, got ${frame.children.length}`)
const column = frame.children[0]
if (column.className !== 'ddwb_col') throw new Error(`column class wrong: ${column.className}`)
if (column.style.gridColumn !== '4' || column.style.gridRow !== '1') {
  throw new Error(`column grid placement wrong: ${JSON.stringify(column.style)}`)
}
if (mountedContainer !== column) throw new Error('createRoot was not called with the column')
if (!renderedRoot || renderedRoot.type?.name !== 'WorkbenchErrorBoundary') {
  throw new Error(`column root render wrong: ${String(renderedRoot?.type)}`)
}
if (renderedRoot.props?.children?.[0]?.type?.name !== 'WorkbenchColumn') {
  throw new Error(`boundary child wrong: ${String(renderedRoot.props?.children?.[0]?.type)}`)
}
// 渲染值由 CSS 变量接管：inline 模板保持 React 的三列原文，
// --ddwb-grid-template 变量持有含工作台轨道的实际模板。
// 工作台默认关闭（trackWidth 初始 0），因此初始轨道为 0。
const variable = () => frame.style['--ddwb-grid-template']
const inline = () => frame.style.gridTemplateColumns
if (inline() !== '280px minmax(0, 1fr) 0px') {
  throw new Error(`inline template should stay untouched: ${inline()}`)
}
if (variable() !== '280px minmax(0, 1fr) 0px 0px') {
  throw new Error(`grid track not appended: ${variable()}`)
}
let snap = service.getSnapshot()
// 框架不再内置任何页签：主页签栏只显示功能插件注册的页签（当前为空）。
if (snap.tabs.length !== 0) {
  throw new Error(`framework should register no built-in tabs, got ${snap.tabs.length}`)
}

// --- grid self-healing ------------------------------------------------------
// 配置收敛重装后 observers 里可能残留旧实例的观察器，只取每种 kind 最新一个。
const latestObserver = (kind) => {
  const list = observers.filter((o) => o._kind === kind)
  return list[list.length - 1]
}

// React rewrites the frame style to the official 3 tracks: the inline template
// changes but the variable (actual render value) must stay authoritative.
frame.style.gridTemplateColumns = '280px minmax(0, 1fr) 0px'
latestObserver('style').callback()
if (variable() !== '280px minmax(0, 1fr) 0px 0px') {
  throw new Error(`style observer lost the track: ${variable()}`)
}

// 官方 details 列打开时，工作台轨道必须钳 0（避免右侧两列挤没对话区）。
frame.style.gridTemplateColumns = '280px minmax(0, 1fr) 360px'
latestObserver('style').callback()
if (variable() !== '280px minmax(0, 1fr) 360px 0px') {
  throw new Error(`details open should clamp workbench track to 0: ${variable()}`)
}
// details 收起后自动恢复工作台轨道（默认关闭 → 恢复为 0）。
frame.style.gridTemplateColumns = '280px minmax(0, 1fr) 0px'
latestObserver('style').callback()
if (variable() !== '280px minmax(0, 1fr) 0px 0px') {
  throw new Error(`details closed should restore workbench track: ${variable()}`)
}

// React removes the appended column: the child observer must re-append it.
frame.children.length = 0
latestObserver('child').callback()
if (frame.children.length !== 1 || frame.children[0] !== column) {
  throw new Error('child observer did not re-attach the column')
}

// --- service registry behavior ---------------------------------------------
// registerTab / duplicate guard / disposer.
const tabOff = service.registerTab({ id: 't1', title: 'T1', order: 10, component: () => null })
let threw = false
try {
  service.registerTab({ id: 't1', title: 'T1' })
} catch {
  threw = true
}
if (!threw) throw new Error('duplicate tab id should throw')
if (!service.getSnapshot().tabs.some((tab) => tab.id === 't1')) {
  throw new Error('registered tab missing from snapshot')
}

// Action channel.
const actions = []
const actionOff = service.onAction((action) => actions.push(action))

// activateTab dispatches only for known tabs.
service.activateTab('t1')
service.activateTab('nope')
if (actions.length !== 1 || actions[0].type !== 'activateTab' || actions[0].id !== 't1') {
  throw new Error(`activateTab dispatch wrong: ${JSON.stringify(actions)}`)
}

tabOff()
if (service.getSnapshot().tabs.some((tab) => tab.id === 't1')) {
  throw new Error('disposed tab still in snapshot')
}

// registerViewer + extension matching through openFile.
service.registerViewer({ id: 'v1', title: 'V1', extensions: ['.md'], order: 10, component: () => null })
service.openFile('notes/readme.md')
if (actions.length !== 2 || actions[1].type !== 'openFile' || actions[1].viewerId !== 'v1') {
  throw new Error(`openFile routing wrong: ${JSON.stringify(actions)}`)
}
service.openFile('data.bin')
if (actions[2].viewerId !== null) throw new Error('unmatched extension should route to null viewer')

// updateTab mutates the descriptor and re-emits.
service.registerTab({ id: 't2', title: 'T2', order: 10, component: () => null })
service.updateTab('t2', { badge: 3 })
snap = service.getSnapshot()
const sampleTab = snap.tabs.find((tab) => tab.id === 't2')
if (sampleTab?.badge !== 3) throw new Error('updateTab badge not applied')

service.closeFile()
if (actions[3]?.type !== 'closeFile') throw new Error('closeFile action missing')
actionOff()

// --- disabled config converges to no column ---------------------------------
await new Promise((resolve) => setTimeout(resolve, 10))
if (frame.children.length !== 1) throw new Error('enabled config should keep exactly 1 frame child')

// A fresh page (reload path) with the framework disabled must not attach.
servedConfig = { enabled: false }
loaded.length = 0
frame.children.length = 0
headStyles.length = 0
renderedRoot = null
mountedContainer = null
;(0, eval)(source)
const freshEntry = loaded[0]
const freshExports = freshEntry.factory(requireStub)
freshExports.apply(ctx)
await new Promise((resolve) => setTimeout(resolve, 10))
if (frame.children.length !== 0) throw new Error(`disabled config should attach no column, got ${frame.children.length}`)
if (await face.load() !== false) throw new Error('face.load should resolve false when disabled')

console.log('workbench client smoke test: all assertions passed')
