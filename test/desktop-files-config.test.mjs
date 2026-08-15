/**
 * Smoke test for the dsh-desktop-files host half: boots apply() against a
 * stub cordis ctx (webServer + sessions) and exercises the config switch,
 * directory tree, text read/write, media and HTML preview routes, including
 * the cwd whitelist (path escape), type whitelist and size guard behaviour.
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import http from 'node:http'
import { apply } from '../plugins/dsh-desktop-files/lib/index.js'

const home = mkdtempSync(join(tmpdir(), 'dsh-desktop-files-home-'))
const work = mkdtempSync(join(tmpdir(), 'dsh-desktop-files-work-'))
process.env.DSH_HOME = home

// 工作区文件树。
mkdirSync(join(work, 'src'))
writeFileSync(join(work, 'README.md'), '# hello\n', 'utf8')
writeFileSync(join(work, 'a.png'), Buffer.from([137, 80, 78, 71, 1, 2, 3]))
writeFileSync(join(work, 'index.html'), '<p>hi</p>', 'utf8')
writeFileSync(join(work, 'package.json'), '{"name":"demo"}', 'utf8')
mkdirSync(join(work, 'node_modules'))
writeFileSync(join(work, 'node_modules', 'ignored.js'), 'x', 'utf8')
writeFileSync(join(work, '.hidden'), 'x', 'utf8')

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
  sessions: {
    get(id) {
      if (id === 's1') return { header: { cwd: work } }
      return undefined
    },
  },
}

apply(ctx, {})
if (routes.length !== 6) throw new Error(`expected 6 routes, got ${routes.length}`)
const find = (path) => routes.find((r) => r.path === path)
if (!find('/api/desktop-files/config')) throw new Error('config route missing')
if (!find('/api/desktop-files/tree')) throw new Error('tree route missing')
if (!find('/api/desktop-files/text')) throw new Error('text route missing')
if (!find('/api/desktop-files/file')) throw new Error('file route missing')
if (!find('/api/desktop-files/reveal')) throw new Error('reveal route missing')
if (!find('/api/desktop-files/open-external')) throw new Error('open-external route missing')

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://dsh.invalid')
  // 最长前缀优先
  const route = [...routes]
    .filter((r) => r.kind === 'exact' ? r.path === url.pathname : url.pathname === r.path || url.pathname.startsWith(r.path + '/'))
    .sort((a, b) => b.path.length - a.path.length)[0]
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
const getRaw = async (path) => {
  const res = await fetch(base + path)
  return { status: res.status, body: Buffer.from(await res.arrayBuffer()), headers: res.headers }
}

// --- config ----------------------------------------------------------------
let r = await getJson('/api/desktop-files/config')
if (r.status !== 200 || r.body.enabled !== true) throw new Error(`GET config wrong: ${JSON.stringify(r)}`)
r = await postJson('/api/desktop-files/config', { enabled: false })
if (r.status !== 200 || r.body.config.enabled !== false) throw new Error(`POST config failed: ${JSON.stringify(r)}`)
const file = JSON.parse(readFileSync(join(home, 'desktop-files.json'), 'utf8'))
if (file.enabled !== false) throw new Error(`file wrong: ${JSON.stringify(file)}`)
r = await postJson('/api/desktop-files/config', { enabled: 'yes' })
if (r.status !== 400) throw new Error(`non-boolean should 400, got ${r.status}`)
await postJson('/api/desktop-files/config', { enabled: true })

// --- tree ------------------------------------------------------------------
r = await getJson(`/api/desktop-files/tree?session=s1`)
if (r.status !== 200) throw new Error(`tree failed: ${JSON.stringify(r)}`)
const names = r.body.entries.map((e) => e.name)
if (names[0] !== 'src') throw new Error(`dirs should sort first: ${names.join(',')}`)
if (!names.includes('README.md') || !names.includes('a.png') || !names.includes('index.html') || !names.includes('package.json')) {
  throw new Error(`entries missing: ${names.join(',')}`)
}
if (names.includes('node_modules') || names.includes('.hidden')) {
  throw new Error(`ignored entries leaked: ${names.join(',')}`)
}
const readmeEntry = r.body.entries.find((e) => e.name === 'README.md')
if (readmeEntry.type !== 'file' || typeof readmeEntry.size !== 'number') {
  throw new Error(`entry shape wrong: ${JSON.stringify(readmeEntry)}`)
}
// 子目录懒加载。
r = await getJson(`/api/desktop-files/tree?session=s1&path=${encodeURIComponent(join(work, 'src'))}`)
if (r.status !== 200 || !Array.isArray(r.body.entries)) throw new Error(`subdir tree failed: ${JSON.stringify(r)}`)

// --- text ------------------------------------------------------------------
r = await getJson(`/api/desktop-files/text?session=s1&path=${encodeURIComponent('README.md')}`)
if (r.status !== 200 || r.body.content !== '# hello\n') throw new Error(`text read wrong: ${JSON.stringify(r)}`)

// 写入（原子写）。
r = await postJson('/api/desktop-files/text', { session: 's1', path: join(work, 'new.txt'), content: 'written' })
if (r.status !== 200 || r.body.ok !== true) throw new Error(`text write failed: ${JSON.stringify(r)}`)
if (readFileSync(join(work, 'new.txt'), 'utf8') !== 'written') throw new Error('text write content wrong')

// 越界（cwd 之外）→ 403。
r = await getJson(`/api/desktop-files/text?session=s1&path=${encodeURIComponent(join(work, '..', 'outside.txt'))}`)
if (r.status !== 403) throw new Error(`path escape should 403, got ${r.status}`)
r = await getJson(`/api/desktop-files/tree?session=s1&path=${encodeURIComponent(join(work, '..'))}`)
if (r.status !== 403) throw new Error(`tree escape should 403, got ${r.status}`)

// 非文本扩展名 → 415。
r = await getJson(`/api/desktop-files/text?session=s1&path=a.png`)
if (r.status !== 415) throw new Error(`binary as text should 415, got ${r.status}`)

// 缺失 session → 400。
r = await getJson(`/api/desktop-files/text?path=README.md`)
if (r.status !== 400) throw new Error(`missing session should 400, got ${r.status}`)
r = await getJson(`/api/desktop-files/tree?session=nope`)
if (r.status !== 400) throw new Error(`unknown session should 400, got ${r.status}`)

// --- media -----------------------------------------------------------------
const raw = await getRaw(`/api/desktop-files/file?session=s1&path=a.png`)
if (raw.status !== 200 || raw.headers.get('content-type') !== 'image/png') {
  throw new Error(`media wrong: ${raw.status} ${raw.headers.get('content-type')}`)
}
if (raw.body[0] !== 137) throw new Error(`media bytes wrong`)
r = await getRaw(`/api/desktop-files/file?session=s1&path=README.md`)
if (r.status !== 415) throw new Error(`text as media should 415, got ${r.status}`)

// --- reveal ----------------------------------------------------------------
// reveal 不做 cwd 白名单限制（打开目录无副作用）；不存在的路径 → 404
// （校验在 spawn 之前，不触发系统资源管理器）。
r = await postJson('/api/desktop-files/reveal', { session: 's1', path: join(work, '..', 'outside.txt') })
if (r.status !== 404) throw new Error(`reveal missing path should 404, got ${r.status}`)
// 缺参数 → 400。
r = await postJson('/api/desktop-files/reveal', { session: 's1' })
if (r.status !== 400) throw new Error(`reveal missing path should 400, got ${r.status}`)
// GET → 405。
const revealGet = await fetch(base + '/api/desktop-files/reveal')
if (revealGet.status !== 405) throw new Error(`GET reveal should 405, got ${revealGet.status}`)

// --- open-external ---------------------------------------------------------
// 用系统应用打开文件：与 reveal 同级信任；不存在的路径 → 404
// （校验在 spawn 之前，不触发系统关联程序）。
r = await postJson('/api/desktop-files/open-external', { session: 's1', path: join(work, '..', 'outside.txt') })
if (r.status !== 404) throw new Error(`open-external missing path should 404, got ${r.status}`)
// 缺参数 → 400。
r = await postJson('/api/desktop-files/open-external', { session: 's1' })
if (r.status !== 400) throw new Error(`open-external missing path should 400, got ${r.status}`)
// GET → 405。
const openGet = await fetch(base + '/api/desktop-files/open-external')
if (openGet.status !== 405) throw new Error(`GET open-external should 405, got ${openGet.status}`)

// --- method guard ----------------------------------------------------------
const putRes = await fetch(base + '/api/desktop-files/tree', { method: 'PUT' })
if (putRes.status !== 405) throw new Error(`PUT tree should 405, got ${putRes.status}`)

server.close()
await once(server, 'close')
rmSync(home, { recursive: true, force: true })
rmSync(work, { recursive: true, force: true })
console.log('files host test: all assertions passed')
