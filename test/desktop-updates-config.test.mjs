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
if (routes.length !== 3) throw new Error(`expected 3 routes, got ${routes.length}`)
if (routes.some((r) => r.path === '/api/desktop-updates/config') !== true) throw new Error('config route missing')
if (routes.some((r) => r.path === '/api/desktop-updates/version') !== true) throw new Error('version route missing')
if (routes.some((r) => r.path === '/api/desktop-updates/latest-cache') !== true) throw new Error('latest-cache route missing')

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

// latest-cache: empty by default
r = await getJson('/api/desktop-updates/latest-cache')
if (r.status !== 200 || Object.keys(r.body).length !== 0) {
  throw new Error(`empty cache wrong: ${JSON.stringify(r)}`)
}

// latest-cache: rejects malformed entries
r = await postJson('/api/desktop-updates/latest-cache', { tag_name: 42 })
if (r.status !== 400) throw new Error(`bad entry should 400, got ${r.status}`)

// latest-cache: valid entry round-trips (sanitized subset only)
const entry = {
  tag_name: 'v0.1.0-rc.6.6.3',
  fetchedAt: 123456,
  html_url: 'https://github.com/CCMu04/DSHDesktop/releases/tag/v0.1.0-rc.6.6.3',
  published_at: '2026-08-16T00:00:00Z',
  body: 'release notes '.repeat(1000),
  assets: [
    { browser_download_url: 'https://example.com/setup.exe', extra: 'dropped' },
    { browser_download_url: 42 },
  ],
  junk: 'dropped',
}
r = await postJson('/api/desktop-updates/latest-cache', entry)
if (r.status !== 200) throw new Error(`cache POST failed: ${JSON.stringify(r)}`)
r = await getJson('/api/desktop-updates/latest-cache')
if (r.body.tag_name !== entry.tag_name || r.body.fetchedAt !== entry.fetchedAt) {
  throw new Error(`cache round-trip wrong: ${JSON.stringify(r)}`)
}
if (r.body.junk !== undefined || r.body.assets?.length !== 1) {
  throw new Error(`cache sanitize wrong: ${JSON.stringify(r)}`)
}
if (r.body.assets[0]?.extra !== undefined || typeof r.body.body !== 'string') {
  throw new Error(`cache asset sanitize wrong: ${JSON.stringify(r)}`)
}
const cacheFile = JSON.parse(readFileSync(join(home, 'desktop-updates-cache.json'), 'utf8'))
if (cacheFile.tag_name !== entry.tag_name) throw new Error(`cache file wrong: ${JSON.stringify(cacheFile)}`)

server.close()
await once(server, 'close')
rmSync(home, { recursive: true, force: true })
console.log('updates host test: all assertions passed')
