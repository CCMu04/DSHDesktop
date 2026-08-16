/**
 * Smoke test for the dsh-desktop-files client bundle: loads the shipped
 * window.__ModuleLoader__ factory in a mocked browser-ish environment and
 * verifies apply() registers the feature-card entry, waits for the
 * desktop.workbench service, registers the files tab plus the five viewers,
 * and tracks the current session cwd through the sessions service.
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
  if (path === '/api/desktop-files/config') {
    if (options?.method === 'POST') return { ok: true }
    return { ok: true, json: async () => servedConfig }
  }
  throw new Error(`unexpected fetch: ${url}`)
}

// --- cordis ctx stub -------------------------------------------------------
const registered = []
// 假 workbench 服务：记录 tab / viewer 注册，disposer 真实移除（收敛语义）。
const tabs = []
const viewers = []
const activatedTabs = []
const fakeWorkbench = {
  registerTab(descriptor) {
    tabs.push(descriptor)
    return () => {
      const i = tabs.indexOf(descriptor)
      if (i >= 0) tabs.splice(i, 1)
    }
  },
  registerViewer(descriptor) {
    viewers.push(descriptor)
    return () => {
      const i = viewers.indexOf(descriptor)
      if (i >= 0) viewers.splice(i, 1)
    }
  },
  openFile() {},
  activateTab(id) {
    activatedTabs.push(id)
  },
}
// 官方 workspaces 服务：openPath 是唯一文件打开入口（将被包装拦截）。
const originalOpenPath = (path) => Promise.resolve('host-opened:' + path)
const workspacesStub = { openPath: originalOpenPath }
// 记录 sessions.list 订阅回调：模拟 AI 对话期间官方高频通知（投影/任务帧）。
let listSubscriber = null
let mockCurrent = 's1'
const sessionsStub = {
  list: {
    getSnapshot: () => ({
      current: mockCurrent,
      items: [{ id: 's1' }],
      byId: { s1: { cwd: 'C:\\work\\demo' } },
    }),
    subscribe: (fn) => {
      listSubscriber = fn
      return () => {
        listSubscriber = null
      }
    },
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
    if (name === 'workspaces') return workspacesStub
    return undefined
  },
}

// --- load the bundle -------------------------------------------------------
const source = readFileSync(
  new URL('../plugins/dsh-desktop-files/lib/client.js', import.meta.url),
  'utf8',
)
;(0, eval)(source)
if (loaded.length !== 1) throw new Error(`bundle should register exactly one loader entry, got ${loaded.length}`)
const entry = loaded[0]
if (entry.id !== 'dsh-desktop-files') throw new Error(`unexpected loader id: ${entry.id}`)
const moduleExports = entry.factory(requireStub)
if (typeof moduleExports.apply !== 'function') throw new Error('apply export missing')
if (!Array.isArray(moduleExports.inject)) throw new Error('inject export missing')

// --- run apply -------------------------------------------------------------
moduleExports.apply(ctx)

// Feature card registered (order 10).
const card = registered.find((r) => r.name === 'desktop.features.item')
if (!card) throw new Error('desktop.features.item entry missing')
if (card.entry.options?.id !== 'files') throw new Error(`card id wrong: ${card.entry.options?.id}`)
if (card.entry.options?.order !== 10) throw new Error(`card order wrong: ${card.entry.options?.order}`)
const face = card.entry.inject()
if (typeof face?.load !== 'function' || typeof face?.save !== 'function') {
  throw new Error('card data interface incomplete')
}
if (await face.load() !== true) throw new Error('face.load should resolve true')

// 等配置收敛（默认全开 → 真实配置到达 → dispose + 重装），断言取最后一组。
await new Promise((resolve) => setTimeout(resolve, 10))
const tabsNow = tabs.slice(-1)

// Files tab registered into the workbench（主页签栏只挂功能页签）。
const tab = tabsNow.find((t) => t.id === 'files')
if (!tab) throw new Error('files tab not registered')
if (tab.order !== 10) throw new Error(`files tab order wrong: ${tab.order}`)

// 预览器不再注册到 workbench（文件子页签由插件内部管理）。
if (viewers.length !== 0) {
  throw new Error(`files should not register viewers into workbench, got ${viewers.length}`)
}

// workspaces.openPath 已被拦截：打开文件子页签并激活「文件」功能页签。
activatedTabs.length = 0
await workspacesStub.openPath('C:/work/demo/src/main.ts')
if (activatedTabs.length !== 1 || activatedTabs[0] !== 'files') {
  throw new Error(`openPath should activate files tab: ${activatedTabs.join('|')}`)
}
// 相对路径基于会话 cwd 解析（不抛错即可；子页签状态在面板内）。
await workspacesStub.openPath('docs/readme.md')

// AI 对话期间官方 sessions.list 因投影/任务帧高频通知（快照本身不比较），
// current/cwd 未变时 store 必须幂等（不重发——否则目录树被反复清空重载，
// 对话中持续闪烁；回归保护）。
if (typeof listSubscriber !== 'function') throw new Error('sessions subscriber not registered')
for (let i = 0; i < 20; i += 1) listSubscriber()

// 会话真正切换时订阅仍正常处理（current 变化 → 不抛错）。
mockCurrent = 's2'
listSubscriber()
mockCurrent = 's1'
listSubscriber()

// 选择性拦截：目录（无可预览类型）放行官方实现——右键菜单
// 「在资源管理器中打开」传的是目录，不能被劫持。
activatedTabs.length = 0
await workspacesStub.openPath('C:/work/demo')
if (activatedTabs.length !== 0) {
  throw new Error(`directory should pass through to original openPath, got ${activatedTabs.join('|')}`)
}

// 禁用态收敛：不注册任何 tab。
servedConfig = { enabled: false }
loaded.length = 0
headStyles.length = 0
tabs.length = 0
viewers.length = 0
activatedTabs.length = 0
// 两个 eval 共享同一 workspaces stub：模拟真实页面重载，先还原原始方法。
workspacesStub.openPath = originalOpenPath
;(0, eval)(source)
const freshExports = loaded[0].factory(requireStub)
freshExports.apply(ctx)
await new Promise((resolve) => setTimeout(resolve, 10))
if (tabs.length !== 0) {
  throw new Error(`disabled config should register nothing, got tabs=${tabs.length}`)
}
await workspacesStub.openPath('C:/work/demo/x.ts')
if (activatedTabs.length !== 0) {
  throw new Error(`disabled config should not intercept openPath, got ${activatedTabs.join('|')}`)
}

console.log('files client smoke test: all assertions passed')
