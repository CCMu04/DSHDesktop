/**
 * Smoke test for the dsh-desktop-browser host half: boots apply() against a
 * stub cordis ctx and exercises the feature switch config API plus the
 * whitelisted prefs API (same shared-document persistence as the workbench).
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import http from 'node:http'
import { apply } from '../plugins/dsh-desktop-browser/lib/index.js'

const home = mkdtempSync(join(tmpdir(), 'dsh-desktop-browser-test-'))
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
if (routes.length !== 2) throw new Error(`expected 2 routes, got ${routes.length}`)
const configRoute = routes.find((r) => r.path === '/api/desktop-browser/config')
const prefsRoute = routes.find((r) => r.path === '/api/desktop-browser/prefs')
if (!configRoute) throw new Error('config route missing')
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
const storeFile = () => JSON.parse(readFileSync(join(home, 'desktop-browser.json'), 'utf8'))

// --- config API -------------------------------------------------------------
let r = await getJson('/api/desktop-browser/config')
if (r.status !== 200 || r.body.enabled !== true) throw new Error(`GET config wrong: ${JSON.stringify(r)}`)

r = await postJson('/api/desktop-browser/config', { enabled: false })
if (r.status !== 200 || r.body.config.enabled !== false) throw new Error(`POST config failed: ${JSON.stringify(r)}`)
let file = storeFile()
if (file.enabled !== false) throw new Error(`config file wrong: ${JSON.stringify(file)}`)

r = await getJson('/api/desktop-browser/config')
if (r.body.enabled !== false) throw new Error(`GET config after POST wrong: ${JSON.stringify(r)}`)

r = await postJson('/api/desktop-browser/config', { enabled: 'yes' })
if (r.status !== 400) throw new Error(`non-boolean enabled should 400, got ${r.status}`)

// --- prefs API --------------------------------------------------------------
r = await getJson('/api/desktop-browser/prefs')
if (r.status !== 200 || typeof r.body.prefs !== 'object' || Object.keys(r.body.prefs).length !== 0) {
  throw new Error(`GET prefs initial wrong: ${JSON.stringify(r)}`)
}

// POST persists whitelisted prefs, drops unknown keys
r = await postJson('/api/desktop-browser/prefs', {
  prefs: { 'browser.splitProtocol': true, 'browser.tabsPersist': false, junk: 'x', 'browser.searchEngine': 'bing' },
})
if (r.status !== 200 || r.body.prefs['browser.splitProtocol'] !== true) {
  throw new Error(`POST prefs failed: ${JSON.stringify(r)}`)
}
if ('junk' in r.body.prefs) throw new Error(`prefs unknown key leaked: ${JSON.stringify(r)}`)
if ('browser.searchEngine' in r.body.prefs === false) throw new Error(`searchEngine missing: ${JSON.stringify(r)}`)

// Invalid value types are dropped; all-invalid → 400
r = await postJson('/api/desktop-browser/prefs', { prefs: { 'browser.splitProtocol': 'yes' } })
if (r.status !== 400) throw new Error(`all-invalid prefs should 400, got ${r.status}`)

// searchEngine length cap: 33 chars rejected (dropped → 400), 32 chars accepted
r = await postJson('/api/desktop-browser/prefs', { prefs: { 'browser.searchEngine': 'x'.repeat(33) } })
if (r.status !== 400) throw new Error(`oversized searchEngine should 400, got ${r.status}`)
r = await postJson('/api/desktop-browser/prefs', { prefs: { 'browser.searchEngine': 'x'.repeat(32) } })
if (r.status !== 200 || r.body.prefs['browser.searchEngine'] !== 'x'.repeat(32)) {
  throw new Error(`32-char searchEngine should be accepted: ${JSON.stringify(r)}`)
}

// viewportRatio: whitelist values accepted, unknown dropped → 400
r = await postJson('/api/desktop-browser/prefs', { prefs: { 'browser.viewportRatio': '16:9' } })
if (r.status !== 200 || r.body.prefs['browser.viewportRatio'] !== '16:9') {
  throw new Error(`viewportRatio 16:9 should be accepted: ${JSON.stringify(r)}`)
}
r = await postJson('/api/desktop-browser/prefs', { prefs: { 'browser.viewportRatio': '9:16' } })
if (r.status !== 200 || r.body.prefs['browser.viewportRatio'] !== '9:16') {
  throw new Error(`viewportRatio 9:16 should be accepted: ${JSON.stringify(r)}`)
}
r = await postJson('/api/desktop-browser/prefs', { prefs: { 'browser.viewportRatio': 'ultrawide' } })
if (r.status !== 400) throw new Error(`unknown viewportRatio should 400, got ${r.status}`)

// GET reflects merged store
r = await getJson('/api/desktop-browser/prefs')
if (r.body.prefs['browser.splitProtocol'] !== true) throw new Error(`splitProtocol lost: ${JSON.stringify(r)}`)

// POST rejects missing prefs body
r = await postJson('/api/desktop-browser/prefs', {})
if (r.status !== 400) throw new Error(`missing prefs should 400, got ${r.status}`)

// Shared document: prefs do not clobber the enabled switch
file = storeFile()
if (file.enabled !== false) throw new Error(`enabled lost after prefs POST: ${JSON.stringify(file)}`)
if (typeof file.prefs !== 'object') throw new Error(`prefs missing in store: ${JSON.stringify(file)}`)

// Config POST does not clobber prefs
r = await postJson('/api/desktop-browser/config', { enabled: true })
file = storeFile()
if (file.enabled !== true) throw new Error(`enabled not updated: ${JSON.stringify(file)}`)
if (file.prefs['browser.splitProtocol'] !== true) throw new Error(`prefs lost after config POST: ${JSON.stringify(file)}`)

// Method not allowed
const putRes = await fetch(base + '/api/desktop-browser/config', { method: 'PUT' })
if (putRes.status !== 405) throw new Error(`config PUT should 405, got ${putRes.status}`)
const putPrefs = await fetch(base + '/api/desktop-browser/prefs', { method: 'PUT' })
if (putPrefs.status !== 405) throw new Error(`prefs PUT should 405, got ${putPrefs.status}`)

server.close()
await once(server, 'close')
rmSync(home, { recursive: true, force: true })
console.log('browser host test: all assertions passed')