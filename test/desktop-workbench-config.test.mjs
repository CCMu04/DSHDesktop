/**
 * Smoke test for the dsh-desktop-workbench host half: boots apply() against a
 * stub cordis ctx and exercises the framework switch config API plus the
 * per-session layout persistence API.
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
if (routes.length !== 2) throw new Error(`expected 2 routes, got ${routes.length}`)
const configRoute = routes.find((r) => r.path === '/api/desktop-workbench/config')
const layoutRoute = routes.find((r) => r.path === '/api/desktop-workbench/layout')
if (!configRoute) throw new Error('config route missing')
if (!layoutRoute) throw new Error('layout route missing')

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

// Config POST does not clobber layouts (shared document)
await postJson('/api/desktop-workbench/config', { enabled: true })
file = JSON.parse(readFileSync(join(home, 'desktop-workbench.json'), 'utf8'))
if (file.enabled !== true) throw new Error(`enabled not updated: ${JSON.stringify(file)}`)
if (typeof file.layouts?.s1 !== 'object') throw new Error(`layouts lost after config POST: ${JSON.stringify(file)}`)

// Method not allowed
const putRes = await fetch(base + '/api/desktop-workbench/config', { method: 'PUT' })
if (putRes.status !== 405) throw new Error(`PUT should 405, got ${putRes.status}`)

server.close()
await once(server, 'close')
rmSync(home, { recursive: true, force: true })
console.log('workbench host test: all assertions passed')
