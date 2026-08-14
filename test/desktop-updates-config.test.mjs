/**
 * Smoke test for the dsh-desktop-updates host half: boots apply() against a
 * stub cordis ctx and exercises the config + version APIs.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import http from 'node:http'
import { apply } from '../plugins/dsh-desktop-updates/lib/index.js'

const home = mkdtempSync(join(tmpdir(), 'dsh-desktop-updates-test-'))
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
if (routes.some((r) => r.path === '/api/desktop-updates/config') !== true) throw new Error('config route missing')
if (routes.some((r) => r.path === '/api/desktop-updates/version') !== true) throw new Error('version route missing')

const server = http.createServer((req, res) => {
  const route = routes.find((r) => r.path === req.url)
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

// GET config: default enabled
let r = await getJson('/api/desktop-updates/config')
if (r.status !== 200 || r.body.enabled !== true) throw new Error(`GET config wrong: ${JSON.stringify(r)}`)

// POST enabled:false persists
r = await postJson('/api/desktop-updates/config', { enabled: false })
if (r.status !== 200 || r.body.config.enabled !== false) throw new Error(`POST failed: ${JSON.stringify(r)}`)
const file = JSON.parse(readFileSync(join(home, 'desktop-updates.json'), 'utf8'))
if (file.enabled !== false) throw new Error(`file wrong: ${JSON.stringify(file)}`)

// GET reflects override
r = await getJson('/api/desktop-updates/config')
if (r.body.enabled !== false) throw new Error(`GET after POST wrong: ${JSON.stringify(r)}`)

// POST rejects non-boolean
r = await postJson('/api/desktop-updates/config', { enabled: 'yes' })
if (r.status !== 400) throw new Error(`non-boolean should 400, got ${r.status}`)

// version route serves the injected version.json + client info
r = await getJson('/api/desktop-updates/version')
if (
  r.status !== 200 ||
  typeof r.body.currentVersion !== 'string' ||
  typeof r.body.dshVersion !== 'string' ||
  typeof r.body.os !== 'string' ||
  typeof r.body.arch !== 'string' ||
  typeof r.body.platform !== 'string'
) {
  throw new Error(`version wrong: ${JSON.stringify(r)}`)
}

server.close()
await once(server, 'close')
rmSync(home, { recursive: true, force: true })
console.log('updates host test: all assertions passed')
