/**
 * Smoke test for the dsh-desktop-workbench client bundle: loads the shipped
 * window.__ModuleLoader__ factory in a mocked browser-ish environment and
 * verifies apply() provides the desktop.workbench service, registers the
 * feature-card entry and the header [|] toggle (utilities slot), attaches the
 * workbench column into the official ChatView root as a right-side grid split
 * (chat view only; detaches when the chat view unmounts), and that the service
 * registry + action channel + open-state behave.
 */
import { readFileSync } from 'node:fs'

// --- minimal browser-ish environment -------------------------------------
const observers = []
const resizeObservers = []
const cleanups = []
const loaded = []
const headStyles = []
const registered = []
const provided = new Map()

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
  parentElement: null,
  appendChild(el) {
    this.children.push(el)
    el.parentNode = this
    el.parentElement = this
  },
  remove() {
    if (this.parentNode) {
      const i = this.parentNode.children.indexOf(this)
      if (i >= 0) this.parentNode.children.splice(i, 1)
    }
  },
  contains(el) {
    return this.children.includes(el)
  },
  classList: { add() {}, remove() {} },
  setAttribute(key, value) {
    this.attributes[key] = value ?? ''
  },
  removeAttribute(key) {
    delete this.attributes[key]
  },
  clientHeight: 600,
})

globalThis.MutationObserver = class {
  constructor(callback) {
    this.callback = callback
    observers.push(this)
  }
  observe(target, options) {
    this._kind = options?.subtree ? 'flow' : options?.childList ? 'child' : 'unknown'
    this.target = target
  }
  disconnect() {}
  takeRecords() { return [] }
}
globalThis.ResizeObserver = class {
  constructor(callback) {
    this.callback = callback
    resizeObservers.push(this)
  }
  observe() {}
  disconnect() {}
  takeRecords() { return [] }
}

const documentBody = fakeElement()
const inTree = (el, root = documentBody) =>
  el === root || (el.parentElement !== null && inTree(el.parentElement, root))

globalThis.document = {
  addEventListener() {},
  removeEventListener() {},
  body: documentBody,
  querySelector(selector) {
    if (String(selector).includes('data-chat-flow')) {
      return inTree(flow) ? flow : null
    }
    if (String(selector).includes('data-conversation-scroll')) return viewport
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
  dispatchEvent() {},
}

// ChatView 结构：[data-chat-flow] → scroll → root（ChatView 根）。
// 组装：scrollBody > [viewArea > root] + composerSeat（与官方一致：
// scrollBody 是对话区外层滚动视口，含消息流槽与输入框）。
const flow = fakeElement()
flow.dataset.chatFlow = ''
const chatScroll = fakeElement()
chatScroll.appendChild(flow)
const chatRoot = fakeElement('Md3f7G_root')
chatRoot.appendChild(chatScroll)
const viewArea = fakeElement()
viewArea.appendChild(chatRoot)
const composerSeat = fakeElement()
composerSeat.dataset.composerSeat = ''
const viewport = fakeElement()
viewport.clientHeight = 640
viewport.dataset.conversationScroll = ''
const scrollBody = fakeElement()
scrollBody.appendChild(viewport)
viewport.appendChild(viewArea)
viewport.appendChild(composerSeat)
documentBody.appendChild(scrollBody)

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
if (typeof service.toggle !== 'function' || typeof service.isOpen !== 'function' || typeof service.onOpenChange !== 'function') {
  throw new Error('open-state API incomplete')
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

// Header [|] toggle registered in the utilities slot.
const toggleEntry = registered.find((r) => r.name === 'conversation.session.header.utilities')
if (!toggleEntry) throw new Error('utilities toggle entry missing')
if (toggleEntry.entry.options?.id !== 'workbench-toggle') throw new Error(`toggle id wrong: ${toggleEntry.entry.options?.id}`)
if (toggleEntry.entry.options?.order !== 35) throw new Error(`toggle order wrong: ${toggleEntry.entry.options?.order}`)

// face.load() resolves through the config API.
if (await face.load() !== true) throw new Error('face.load should resolve true')

// 等配置收敛（默认全开 → 真实配置到达 → 重装），再捕获当前列实例。
await new Promise((resolve) => setTimeout(resolve, 10))

// Default all-on attaches the column into the scrollBody (outer viewport)
// as grid column 2, spanning all rows (message flow + composer).
const column = viewport.children.find((el) => el.className === 'ddwb_col')
if (!column) throw new Error('workbench column not attached to scrollBody')
if (viewport.style.gridTemplateColumns !== 'minmax(0, 1fr) var(--ddwb-chat-track, 0px)') {
  throw new Error(`scrollBody grid wrong: ${viewport.style.gridTemplateColumns}`)
}
if (column.style.gridColumn !== '2') throw new Error(`column grid placement wrong: ${column.style.gridColumn}`)
if (column.style.gridRow !== '1 / -1') throw new Error(`column grid row wrong: ${column.style.gridRow}`)
if (column.style.position !== 'sticky') throw new Error('column should be sticky inside the scrollBody')
if (column.style.height !== '640px') throw new Error(`column height should track the viewport: ${column.style.height}`)
if (mountedContainer !== column) throw new Error('createRoot was not called with the column')
if (!renderedRoot || renderedRoot.type?.name !== 'WorkbenchErrorBoundary') {
  throw new Error(`column root render wrong: ${String(renderedRoot?.type)}`)
}
let snap = service.getSnapshot()
// 框架不再内置任何页签：主页签栏只显示功能插件注册的页签（当前为空）。
if (snap.tabs.length !== 0) {
  throw new Error(`framework should register no built-in tabs, got ${snap.tabs.length}`)
}

// 工作台默认收起：轨道宽度 0。
if (service.isOpen() !== false) throw new Error('workbench should start collapsed')

// --- open-state behavior ----------------------------------------------------
const openStates = []
const openOff = service.onOpenChange((value) => openStates.push(value))
service.toggle()
if (service.isOpen() !== true) throw new Error('toggle should open the workbench')
service.toggle()
if (service.isOpen() !== false) throw new Error('toggle should close the workbench')
service.setOpen(true)
if (service.isOpen() !== true) throw new Error('setOpen(true) should open')
if (openStates.length < 3 || openStates[0] !== true || openStates[1] !== false || openStates[2] !== true) {
  throw new Error(`open-state notifications wrong: ${JSON.stringify(openStates)}`)
}
openOff()

// --- grid self-healing ------------------------------------------------------
// React rewrites the scrollBody children: the child observer must re-append.
const latestChildObserver = () => {
  const list = observers.filter((o) => o._kind === 'child')
  return list[list.length - 1]
}
viewport.children.length = 0
latestChildObserver().callback()
if (!viewport.children.includes(column)) {
  throw new Error('child observer did not re-attach the column')
}

// 视图切换：移除 [data-chat-flow]（切到轨迹页）→ 列本体保留（挂在
// scrollBody 外层），轨道钳 0；重新出现 → 轨道恢复。列不销毁，
// 因此会话切换后开关仍然可用。
const latestFlowObserver = () => {
  const list = observers.filter((o) => o._kind === 'flow')
  return list[list.length - 1]
}
const trackVar = () => viewport.style['--ddwb-chat-track']
// 模拟 ChatView 卸载：把 flow 从滚动容器摘除。
chatScroll.children.length = 0
flow.parentElement = null
latestFlowObserver().callback()
if (!viewport.children.includes(column)) {
  throw new Error('column should stay attached to scrollBody when chat view unmounts')
}
if (trackVar() !== '0px') {
  throw new Error(`track should clamp to 0 when chat view unmounts: ${trackVar()}`)
}
// 重新挂载：flow 回来 → 轨道恢复。
chatScroll.appendChild(flow)
latestFlowObserver().callback()
if (!viewport.children.includes(column)) {
  throw new Error('column should stay attached when chat view remounts')
}
if (viewport.style.gridTemplateColumns !== 'minmax(0, 1fr) var(--ddwb-chat-track, 0px)') {
  throw new Error(`grid template lost after remount: ${viewport.style.gridTemplateColumns}`)
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

// activateTab dispatches only for known tabs and opens the panel.
service.activateTab('t1')
service.activateTab('nope')
if (actions.length !== 1 || actions[0].type !== 'activateTab' || actions[0].id !== 't1') {
  throw new Error(`activateTab dispatch wrong: ${JSON.stringify(actions)}`)
}
if (service.isOpen() !== true) throw new Error('activateTab should open the workbench')

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

// collapse closes the panel and dispatches.
service.setOpen(true)
const collapseActions = []
const collapseOff = service.onAction((action) => collapseActions.push(action))
service.collapse()
if (collapseActions.length !== 1 || collapseActions[0].type !== 'collapsePanel') {
  throw new Error(`collapse dispatch wrong: ${JSON.stringify(collapseActions)}`)
}
if (service.isOpen() !== false) throw new Error('collapse should close the workbench')
collapseOff()

// --- disabled config converges to no column / no toggle ---------------------
await new Promise((resolve) => setTimeout(resolve, 10))
if (!viewport.children.includes(column)) throw new Error('enabled config should keep the column attached')

// A fresh page (reload path) with the framework disabled must not attach.
servedConfig = { enabled: false }
loaded.length = 0
registered.length = 0
viewport.children.length = 0
headStyles.length = 0
renderedRoot = null
mountedContainer = null
;(0, eval)(source)
const freshEntry = loaded[0]
const freshExports = freshEntry.factory(requireStub)
freshExports.apply(ctx)
await new Promise((resolve) => setTimeout(resolve, 10))
if (viewport.children.some((el) => el.className === 'ddwb_col')) {
  throw new Error('disabled config should attach no column')
}
if (registered.some((r) => r.entry.options?.id === 'workbench-toggle')) {
  throw new Error('disabled config should register no toggle')
}
if (await face.load() !== false) throw new Error('face.load should resolve false when disabled')

console.log('workbench client smoke test: all assertions passed')
