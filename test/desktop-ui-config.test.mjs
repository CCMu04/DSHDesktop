/**
 * Smoke test for the dsh-desktop-ui host half: boots apply() against a stub
 * cordis ctx (webServer collects routes), then exercises the config API.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import http from 'node:http'
import { apply } from '../plugins/dsh-desktop-ui/lib/index.js'

const home = mkdtempSync(join(tmpdir(), 'dsh-desktop-ui-test-'))
process.env.DSH_HOME = home

const routes = []
const ctx = {
  effect(fn) {
    const disposers = fn()
    return () => { for (const d of disposers) d() }
  },
  webServer: {
    register(route) {
      routes.push(route)
      return () => { const i = routes.indexOf(route); if (i >= 0) routes.splice(i, 1) }
    },
  },
}

// 1. apply with empty config (defaults) and check the route mounted
apply(ctx, {})
if (routes.length !== 1) throw new Error(`expected 1 route, got ${routes.length}`)
const [route] = routes
if (route.path !== '/api/desktop-ui/config') throw new Error(`unexpected path ${route.path}`)

// 2. spin an http server on the route and exercise it (the handler dispatches
//    on the request method, mirroring the webserver's exact-table match)
const server = http.createServer((req, res) => {
  const match = routes.find((r) => r.path === req.url)
  if (!match) { res.writeHead(404); res.end(); return }
  match.handler(req, res)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const base = `http://127.0.0.1:${port}`

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

// GET defaults: everything on
let r = await getJson('/api/desktop-ui/config')
if (r.status !== 200 || r.body.settingsDrawer !== true || r.body.sessionLogExport !== true || r.body.statsLine !== true) {
  throw new Error(`GET defaults wrong: ${JSON.stringify(r)}`)
}

// POST partial patch persists
r = await postJson('/api/desktop-ui/config', { settingsDrawer: false })
if (r.status !== 200 || r.body.config.settingsDrawer !== false) throw new Error(`POST failed: ${JSON.stringify(r)}`)

// persisted file contains the patch
const file = JSON.parse(readFileSync(join(home, 'desktop-ui.json'), 'utf8'))
if (file.settingsDrawer !== false || file.sessionLogExport !== undefined) throw new Error(`file wrong: ${JSON.stringify(file)}`)

// GET now reflects the override
r = await getJson('/api/desktop-ui/config')
if (r.body.settingsDrawer !== false || r.body.sessionLogExport !== true) throw new Error(`GET after patch wrong: ${JSON.stringify(r)}`)

// POST rejects non-boolean patches
r = await postJson('/api/desktop-ui/config', { settingsDrawer: 'yes' })
if (r.status !== 400) throw new Error(`non-boolean should 400, got ${r.status}`)

// POST empty patch rejects
r = await postJson('/api/desktop-ui/config', {})
if (r.status !== 400) throw new Error(`empty patch should 400, got ${r.status}`)

// GET with HEAD
const head = await fetch(base + '/api/desktop-ui/config', { method: 'HEAD' })
if (head.status !== 200) throw new Error(`HEAD failed: ${head.status}`)

// plugin row config is a layer below the user file
routes.length = 0
apply(ctx, { sessionLogExport: false })
r = await getJson('/api/desktop-ui/config')
if (r.body.sessionLogExport !== false) throw new Error(`patch layer should win over default: ${JSON.stringify(r)}`)
if (r.body.settingsDrawer !== false) throw new Error(`user file should win over patch layer: ${JSON.stringify(r)}`)

server.close()
await once(server, 'close')
rmSync(home, { recursive: true, force: true })
console.log('host smoke test: all assertions passed')
