/**
 * Smoke test for the dsh-desktop-context-menu client bundle: loads the
 * window.__ModuleLoader__ factory in a mocked browser-ish environment and
 * verifies apply() registers the feature card switch and, when enabled, the
 * feature surfaces (toast + floating-menu overlays).
 */
import { readFileSync } from 'node:fs'

// --- minimal browser-ish environment -------------------------------------
const loaded = []
globalThis.window = {
  __ModuleLoader__: { load(entry) { loaded.push(entry) } },
  innerWidth: 1280,
  innerHeight: 800,
  open() {},
}
const fakeElement = () => ({ dataset: {}, style: {}, children: [], appendChild() {}, remove() {}, classList: { add() {}, remove() {} } })
globalThis.document = {
  addEventListener() {},
  removeEventListener() {},
  querySelector() { return null },
  querySelectorAll() { return [] },
  createElement: fakeElement,
  head: { appendChild() {} },
  body: { appendChild() {} },
  dispatchEvent() {},
  createEvent() { return {} },
}
globalThis.MutationObserver = class { observe() {} disconnect() {} }
globalThis.KeyboardEvent = class {}
globalThis.MouseEvent = class {}
globalThis.DataTransfer = class {}
globalThis.ClipboardEvent = class {}

// --- minimal module stubs -------------------------------------------------
function makeElement(type, props) { return { type, props: props ?? {} } }
const stubReact = {
  useState: (initial) => { let v = initial; return [v, (n) => { v = typeof n === 'function' ? n(v) : n }] },
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useId: () => 'smoke-id',
  useRef: (initial) => ({ current: initial }),
  useSyncExternalStore: () => null,
}
const requireStub = (name) => {
  if (name === 'react') return stubReact
  if (name === 'react/jsx-runtime') return { jsx: makeElement, jsxs: makeElement, Fragment: Symbol('Fragment') }
  if (name === 'react-dom') return { createPortal: (node) => node }
  if (name === '@deepseek-ai/dsh-client-runtime/client') return { createSnapshotStore: (initial) => ({ snapshot: { ...initial }, update(fn) { fn(this.snapshot) }, getSnapshot: () => ({}) }) }
  if (name === '@deepseek-ai/dsh-client-ui-primitives') return {}
  throw new Error(`unexpected require: ${name}`)
}

// --- host config API stub: both enabled ------------------------------------
globalThis.fetch = async () => ({ ok: true, json: async () => ({ enabled: true }) })
globalThis.location = { reload() {} }

// --- cordis ctx stub -------------------------------------------------------
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
    if (name === 'workspaces') return undefined
    return undefined
  },
  on() {},
  provide() {},
}

// --- load the context-menu bundle ------------------------------------------
const contextMenuSource = readFileSync(new URL('../plugins/dsh-desktop-context-menu/lib/client.js', import.meta.url), 'utf8')
;(0, eval)(contextMenuSource)
if (loaded.length !== 1) throw new Error(`expected 1 loader entry, got ${loaded.length}`)
const contextMenuExports = loaded[0].factory(requireStub)

contextMenuExports.apply(ctx)
await new Promise((resolve) => setTimeout(resolve, 10))

// context-menu: feature data face + toast/float overlays
const ctxMenuCard = registered.filter((r) => r.name === 'desktop.features.item' && r.entry.options?.id === 'context-menu')
if (ctxMenuCard.length !== 1) throw new Error('context-menu feature card missing')
// the feature entry must expose the data face (load/save/title/description)
const ctxMenuFace = ctxMenuCard[0].entry.options.inject()
if (typeof ctxMenuFace.load !== 'function' || typeof ctxMenuFace.save !== 'function') {
  throw new Error('context-menu face must provide load/save')
}
if (typeof ctxMenuFace.title !== 'string' || typeof ctxMenuFace.description !== 'string') {
  throw new Error('context-menu face must provide title/description')
}
const overlays = registered.filter((r) => r.name === 'shell.overlay')
if (overlays.length !== 2) throw new Error(`context-menu should register 2 overlays, got ${overlays.length}`)

// --- disabled convergence: a fresh page with enabled=false ----------------
globalThis.fetch = async () => ({ ok: true, json: async () => ({ enabled: false }) })
registered.length = 0
loaded.length = 0
;(0, eval)(contextMenuSource)
loaded[0].factory(requireStub).apply(ctx)
await new Promise((resolve) => setTimeout(resolve, 10))
const remaining = registered.map((r) => `${r.name}:${r.entry.options?.id}`).sort()
// feature card stays (switchboard always available); feature surfaces go.
const expectedRemaining = ['desktop.features.item:context-menu'].sort()
if (JSON.stringify(remaining) !== JSON.stringify(expectedRemaining)) {
  throw new Error(`disabled state wrong: ${remaining.join(', ')}`)
}

console.log('context-menu client test: all assertions passed')
