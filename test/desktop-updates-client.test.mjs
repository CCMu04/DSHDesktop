/**
 * Smoke test for the dsh-desktop-updates + dsh-desktop-features client
 * bundles: loads each window.__ModuleLoader__ factory in a mocked browser-ish
 * environment and verifies apply() installs the expected registrations
 * (feature card always, settings section gated by the enabled switch).
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
const requireStub = (name) => {
  if (name === 'react') return stubReact
  if (name === 'react/jsx-runtime') return { jsx: makeElement, jsxs: makeElement, Fragment: Symbol('Fragment') }
  if (name === 'react-dom') return { createPortal: (node) => node }
  if (name === '@deepseek-ai/dsh-client-runtime/client') return { createSnapshotStore: () => ({ update() {}, getSnapshot: () => ({}) }) }
  if (name === '@deepseek-ai/dsh-client-ui-primitives') return {}
  throw new Error(`unexpected require: ${name}`)
}

// --- host API stub: updates disabled, version served ----------------------
let updatesConfig = { enabled: false }
globalThis.fetch = async (url, options) => {
  if (String(url).endsWith('/api/desktop-updates/config')) {
    if (options?.method === 'POST') return { ok: true }
    return { ok: true, json: async () => updatesConfig }
  }
  if (String(url).includes('api.github.com')) {
    return { ok: true, json: async () => ({ tag_name: 'v9.9.9', html_url: 'https://example.com/releases' }) }
  }
  return { ok: true, json: async () => ({ currentVersion: '0.1.0-rc.6.5.3' }) }
}
globalThis.location = { reload() {} }

// --- cordis ctx stub -------------------------------------------------------
const registered = []
function makeCtx() {
  return {
    locale: {
      bind: () => (key) => key,
      register() {},
    },
    slots: {
      register(options, component) {
        return { options, component }
      },
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
    get() { return undefined },
    on() {},
    provide() {},
  }
}

// --- load both bundles ------------------------------------------------------
const updatesSource = readFileSync(new URL('../plugins/dsh-desktop-updates/lib/client.js', import.meta.url), 'utf8')
const featuresSource = readFileSync(new URL('../plugins/dsh-desktop-features/lib/client.js', import.meta.url), 'utf8')
const ctx = makeCtx()

;(0, eval)(updatesSource)
;(0, eval)(featuresSource)
if (loaded.length !== 2) throw new Error(`expected 2 loader entries, got ${loaded.length}`)
const updatesExports = loaded.find((e) => e.id === 'dsh-desktop-updates').factory(requireStub)
const featuresExports = loaded.find((e) => e.id === 'dsh-desktop-features').factory(requireStub)

// --- apply: feature card always registered; section gated by switch --------
updatesExports.apply(ctx)
featuresExports.apply(ctx)
await new Promise((resolve) => setTimeout(resolve, 10)) // 等待配置收敛（enabled=false）

const ids = () => registered.map((r) => r.entry.options?.id).sort()
// updates: feature card (updates) + features: group card (dsh-desktop-features)
// — the settings section must NOT be registered while enabled=false.
if (JSON.stringify(ids()) !== JSON.stringify(['dsh-desktop-features', 'updates'])) {
  throw new Error(`disabled state wrong: ${ids().join(', ')}`)
}
// the features group card declares the child slot
const group = registered.find((r) => r.entry.options?.id === 'dsh-desktop-features')
if (!group.entry.options.children?.['desktop.features.item']) {
  throw new Error('features card must declare desktop.features.item child slot')
}
// the updates entry exposes the data face consumed by the group card
const updatesItem = registered.find(
  (r) => r.name === 'desktop.features.item' && r.entry.options?.id === 'updates',
)
if (typeof updatesItem.entry.options.inject !== 'function') {
  throw new Error('updates feature must expose an inject face')
}
const updatesFace = updatesItem.entry.options.inject()
if (typeof updatesFace.load !== 'function' || typeof updatesFace.save !== 'function') {
  throw new Error('updates face must provide load/save')
}
if (
  typeof updatesFace.title !== 'string' ||
  typeof updatesFace.description !== 'string'
) {
  throw new Error('updates face must provide title/description')
}

// enable: a fresh page with enabled=true registers the settings section too
updatesConfig = { enabled: true }
registered.length = 0
;(0, eval)(updatesSource) // fresh page re-evaluates the bundle
const freshExports = loaded[loaded.length - 1].factory(requireStub)
freshExports.apply(ctx)
await new Promise((resolve) => setTimeout(resolve, 10))
const idsEnabled = registered.map((r) => r.entry.options?.id).sort()
// updates feature card + settings section ('updates' section id is also
// 'updates' — the slot name differs: settings.section vs desktop.features.item)
const sections = registered.filter((r) => r.name === 'settings.section')
if (sections.length !== 1 || sections[0].entry.options?.id !== 'updates') {
  throw new Error(`settings section missing when enabled: ${JSON.stringify(sections)}`)
}
const items = registered.filter((r) => r.name === 'desktop.features.item')
if (items.length !== 1) throw new Error(`feature card missing: ${JSON.stringify(items)}`)
console.log('updates/features client test: all assertions passed')
