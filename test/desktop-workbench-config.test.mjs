/**
 * Smoke test for the dsh-desktop-workbench host half: boots apply() against a
 * stub cordis ctx and exercises the framework switch config API, the
 * per-session layout persistence API (merge semantics) and the global prefs
 * API (files/git plugin preferences).
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import http from 'node:http'
import { apply } from '../plugins/dsh-desktop-workbench/lib/index.js'

const home = mkdtempSync(join(tmpdir(), 'dsh-desktop-workbench-test-'))
process.env.DSH_HOME = home

const routes = []
const ctx = {
  effect(fn) {
    const disposers = fn()
    return () => {
      for (const d of disposers) d()
    }
  },
  webServer: {
    register(route) {
      routes.push(route)
      return () => {
        const i = routes.indexOf(route)
        if (i >= 0) routes.splice(i, 1)
      }
    },
  },
}

apply(ctx, {})
if (routes.length !== 3) throw new Error(`expected 3 routes, got ${routes.length}`)
const configRoute = routes.find((r) => r.path === '/api/desktop-workbench/config')
const layoutRoute = routes.find((r) => r.path === '/api/desktop-workbench/layout')
const prefsRoute = routes.find((r) => r.path === '/api/desktop-workbench/prefs')
if (!configRoute) throw new Error('config route missing')
if (!layoutRoute) throw new Error('layout route missing')
if (!prefsRoute) throw new Error('prefs route missing')

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://dsh.invalid')
  const route = routes.find((r) => r.path === url.pathname)
  if (!route) {
    res.writeHead(404)
    res.end()
    return
  }
  route.handler(req, res)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`

const getJson = async (path) => {
  const res = await fetch(base + path)
  return { status: res.status, body: await res.json() }
}
const postJson = async (path, body) => {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json() }
}

// --- config API ------------------------------------------------------------
// GET config: default enabled
let r = await getJson('/api/desktop-workbench/config')
if (r.status !== 200 || r.body.enabled !== true) throw new Error(`GET config wrong: ${JSON.stringify(r)}`)

// POST enabled:false persists
r = await postJson('/api/desktop-workbench/config', { enabled: false })
if (r.status !== 200 || r.body.config.enabled !== false) throw new Error(`POST config failed: ${JSON.stringify(r)}`)
let file = JSON.parse(readFileSync(join(home, 'desktop-workbench.json'), 'utf8'))
if (file.enabled !== false) throw new Error(`config file wrong: ${JSON.stringify(file)}`)

// GET reflects override
r = await getJson('/api/desktop-workbench/config')
if (r.body.enabled !== false) throw new Error(`GET config after POST wrong: ${JSON.stringify(r)}`)

// POST rejects non-boolean
r = await postJson('/api/desktop-workbench/config', { enabled: 'yes' })
if (r.status !== 400) throw new Error(`non-boolean should 400, got ${r.status}`)

// --- layout API ------------------------------------------------------------
// GET unknown session: layout null
r = await getJson('/api/desktop-workbench/layout?session=s1')
if (r.status !== 200 || r.body.session !== 's1' || r.body.layout !== null) {
  throw new Error(`GET layout initial wrong: ${JSON.stringify(r)}`)
}

// POST layout persists
r = await postJson('/api/desktop-workbench/layout', {
  session: 's1',
  layout: { open: false, width: 500, activeTabId: 'files', file: 'C:/demo/a.txt' },
})
if (r.status !== 200 || r.body.layout.open !== false) throw new Error(`POST layout failed: ${JSON.stringify(r)}`)

// GET returns the saved layout
r = await getJson('/api/desktop-workbench/layout?session=s1')
if (r.status !== 200 || r.body.layout.activeTabId !== 'files') {
  throw new Error(`GET layout after POST wrong: ${JSON.stringify(r)}`)
}

// Merge semantics: a feature plugin POSTs only its own field (repo) and the
// frame fields survive; null values clear fields.
r = await postJson('/api/desktop-workbench/layout', {
  session: 's1',
  layout: { repo: 'sub/repo' },
})
if (r.status !== 200 || r.body.layout.repo !== 'sub/repo') {
  throw new Error(`repo merge failed: ${JSON.stringify(r)}`)
}
r = await getJson('/api/desktop-workbench/layout?session=s1')
if (r.body.layout.open !== false || r.body.layout.width !== 500 || r.body.layout.activeTabId !== 'files') {
  throw new Error(`merge clobbered frame fields: ${JSON.stringify(r)}`)
}
if (r.body.layout.repo !== 'sub/repo') throw new Error(`repo lost after merge: ${JSON.stringify(r)}`)

// Null clears a field (workbench resets activeTabId/file on session switch).
r = await postJson('/api/desktop-workbench/layout', {
  session: 's1',
  layout: { activeTabId: null, file: null },
})
if (r.status !== 200) throw new Error(`null-clear POST failed: ${JSON.stringify(r)}`)
r = await getJson('/api/desktop-workbench/layout?session=s1')
if (r.body.layout.activeTabId !== null || r.body.layout.file !== null) {
  throw new Error(`null clear did not clear: ${JSON.stringify(r)}`)
}
if (r.body.layout.repo !== 'sub/repo' || r.body.layout.width !== 500) {
  throw new Error(`null clear clobbered other fields: ${JSON.stringify(r)}`)
}

// Layout narrowing: width clamped, unknown fields dropped, file preserved
r = await postJson('/api/desktop-workbench/layout', {
  session: 's2',
  layout: { width: 99999, activeTabId: 'x', junk: true },
})
if (r.status !== 200 || r.body.layout.width !== 720 || 'junk' in r.body.layout) {
  throw new Error(`layout narrowing wrong: ${JSON.stringify(r)}`)
}

// Layouts do not clobber the enabled switch (shared document)
file = JSON.parse(readFileSync(join(home, 'desktop-workbench.json'), 'utf8'))
if (file.enabled !== false) throw new Error(`enabled lost after layout POST: ${JSON.stringify(file)}`)
if (typeof file.layouts?.s1 !== 'object') throw new Error(`layouts missing after POST: ${JSON.stringify(file)}`)

// POST rejects missing/invalid session
r = await postJson('/api/desktop-workbench/layout', { session: '', layout: { open: true } })
if (r.status !== 400) throw new Error(`empty session should 400, got ${r.status}`)

// POST rejects oversized layout
r = await postJson('/api/desktop-workbench/layout', {
  session: 's3',
  layout: { file: 'x'.repeat(40 * 1024) },
})
if (r.status !== 400) throw new Error(`oversized layout should 400, got ${r.status}`)

// --- prefs API --------------------------------------------------------------
// GET unknown prefs: empty object
r = await getJson('/api/desktop-workbench/prefs')
if (r.status !== 200 || typeof r.body.prefs !== 'object') {
  throw new Error(`GET prefs initial wrong: ${JSON.stringify(r)}`)
}

// POST persists whitelisted prefs
r = await postJson('/api/desktop-workbench/prefs', {
  prefs: { 'files.treeCollapsed': true, 'files.treeWidth': 200, junk: 'x' },
})
if (r.status !== 200 || r.body.prefs['files.treeCollapsed'] !== true) {
  throw new Error(`POST prefs failed: ${JSON.stringify(r)}`)
}
if ('junk' in r.body.prefs) throw new Error(`prefs unknown key leaked: ${JSON.stringify(r)}`)

// Values clamped, booleans kept, numbers rounded
r = await postJson('/api/desktop-workbench/prefs', {
  prefs: { 'files.treeWidth': 9999, 'git.listWidth': 100.6, 'git.historyHeight': -5 },
})
if (r.body.prefs['files.treeWidth'] !== 280) throw new Error(`treeWidth clamp wrong: ${JSON.stringify(r)}`)
if (r.body.prefs['git.listWidth'] !== 140) throw new Error(`listWidth clamp wrong: ${JSON.stringify(r)}`)
if (r.body.prefs['git.historyHeight'] !== 64) throw new Error(`historyHeight clamp wrong: ${JSON.stringify(r)}`)

// Non-boolean for a boolean key is dropped entirely
r = await postJson('/api/desktop-workbench/prefs', { prefs: { 'files.treeCollapsed': 'yes' } })
if (r.status !== 400) throw new Error(`all-invalid prefs should 400, got ${r.status}`)

// GET reflects merged store
r = await getJson('/api/desktop-workbench/prefs')
if (r.body.prefs['files.treeCollapsed'] !== true || r.body.prefs['git.listWidth'] !== 140) {
  throw new Error(`GET prefs after POST wrong: ${JSON.stringify(r)}`)
}

// POST rejects missing prefs body
r = await postJson('/api/desktop-workbench/prefs', {})
if (r.status !== 400) throw new Error(`missing prefs should 400, got ${r.status}`)

// Prefs do not clobber layouts / switch (shared document)
file = JSON.parse(readFileSync(join(home, 'desktop-workbench.json'), 'utf8'))
if (typeof file.layouts?.s1 !== 'object') throw new Error(`layouts lost after prefs POST: ${JSON.stringify(file)}`)
if (typeof file.prefs !== 'object') throw new Error(`prefs missing in store: ${JSON.stringify(file)}`)

// Config POST does not clobber layouts (shared document)
await postJson('/api/desktop-workbench/config', { enabled: true })
file = JSON.parse(readFileSync(join(home, 'desktop-workbench.json'), 'utf8'))
if (file.enabled !== true) throw new Error(`enabled not updated: ${JSON.stringify(file)}`)
if (typeof file.layouts?.s1 !== 'object') throw new Error(`layouts lost after config POST: ${JSON.stringify(file)}`)

// Method not allowed
const putRes = await fetch(base + '/api/desktop-workbench/config', { method: 'PUT' })
if (putRes.status !== 405) throw new Error(`PUT should 405, got ${putRes.status}`)
const putPrefs = await fetch(base + '/api/desktop-workbench/prefs', { method: 'PUT' })
if (putPrefs.status !== 405) throw new Error(`prefs PUT should 405, got ${putPrefs.status}`)

server.close()
await once(server, 'close')
rmSync(home, { recursive: true, force: true })
console.log('workbench host test: all assertions passed')
