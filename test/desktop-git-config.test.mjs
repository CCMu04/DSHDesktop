/**
 * Smoke test for the dsh-desktop-git host half: boots apply() against a
 * stub cordis ctx (webServer + sessions), serves the routes over a real
 * http server, and exercises status / diff / log / stage / unstage /
 * commit / restore against real git repositories (cwd root and a nested
 * repo selected via the repo parameter), plus repo scanning, the cwd
 * whitelist and method guards.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import http from 'node:http'
import { apply } from '../plugins/dsh-desktop-git/lib/index.js'

const home = mkdtempSync(join(tmpdir(), 'dsh-desktop-git-home-'))
const work = mkdtempSync(join(tmpdir(), 'dsh-desktop-git-work-'))
const plain = mkdtempSync(join(tmpdir(), 'dsh-desktop-git-plain-'))
// 非仓库根 + 子仓库（验证仓库目录选择）。
const work2 = mkdtempSync(join(tmpdir(), 'dsh-desktop-git-work2-'))
mkdirSync(join(work2, 'sub'))
const subGit = (args) =>
  execFileSync('git', args, { cwd: join(work2, 'sub'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
subGit(['init'])
subGit(['config', 'user.name', 'dsh-test'])
subGit(['config', 'user.email', 'dsh-test@local'])
subGit(['config', 'core.autocrlf', 'false'])
writeFileSync(join(work2, 'sub', 'note.txt'), 'sub hello\n', 'utf8')
subGit(['add', '-A'])
subGit(['commit', '-m', 'sub initial'])
process.env.DSH_HOME = home

/** 准备一个真实 git 仓库：init + 本地身份 + 初始提交。 */
const git = (args) =>
  execFileSync('git', args, { cwd: work, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
git(['init'])
git(['config', 'user.name', 'dsh-test'])
git(['config', 'user.email', 'dsh-test@local'])
// 关闭行尾转换：restore 后工作区字节与提交内容精确一致（Windows 默认 autocrlf=true）。
git(['config', 'core.autocrlf', 'false'])
writeFileSync(join(work, 'README.md'), '# hello\n', 'utf8')
git(['add', '-A'])
git(['commit', '-m', 'initial commit'])

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
      if (id === 's2') return { header: { cwd: plain } }
      if (id === 's3') return { header: { cwd: work2 } }
      return undefined
    },
  },
}

apply(ctx, {})
if (routes.length !== 9) throw new Error(`expected 9 routes, got ${routes.length}`)
const find = (path) => routes.find((r) => r.path === path)
if (!find('/api/desktop-git/config')) throw new Error('config route missing')
if (!find('/api/desktop-git/repos')) throw new Error('repos route missing')
if (!find('/api/desktop-git/status')) throw new Error('status route missing')
if (!find('/api/desktop-git/diff')) throw new Error('diff route missing')
if (!find('/api/desktop-git/log')) throw new Error('log route missing')
if (!find('/api/desktop-git/stage')) throw new Error('stage route missing')
if (!find('/api/desktop-git/unstage')) throw new Error('unstage route missing')
if (!find('/api/desktop-git/commit')) throw new Error('commit route missing')
if (!find('/api/desktop-git/restore')) throw new Error('restore route missing')

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

// --- config ----------------------------------------------------------------
let r = await getJson('/api/desktop-git/config')
if (r.status !== 200 || r.body.enabled !== true) throw new Error(`GET config wrong: ${JSON.stringify(r)}`)
r = await postJson('/api/desktop-git/config', { enabled: false })
if (r.status !== 200 || r.body.config.enabled !== false) throw new Error(`POST config wrong: ${JSON.stringify(r)}`)
r = await getJson('/api/desktop-git/config')
if (r.body.enabled !== false) throw new Error('config not persisted')
r = await postJson('/api/desktop-git/config', { enabled: 'yes' })
if (r.status !== 400) throw new Error(`non-boolean should 400, got ${r.status}`)
await postJson('/api/desktop-git/config', { enabled: true })

// --- status（初始干净） -----------------------------------------------------
r = await getJson('/api/desktop-git/status?session=s1')
if (r.status !== 200 || r.body.repo !== true) throw new Error(`status failed: ${JSON.stringify(r)}`)
if (typeof r.body.branch !== 'string' || r.body.branch.length === 0) throw new Error('branch missing')
if (!Array.isArray(r.body.files) || r.body.files.length !== 0) {
  throw new Error(`clean repo should have no files: ${JSON.stringify(r.body.files)}`)
}

// --- 非仓库目录（会话 cwd 本身不是 git 仓库） --------------------------------
r = await getJson('/api/desktop-git/status?session=s2')
if (r.status !== 200 || r.body.repo !== false) throw new Error(`plain dir should repo:false: ${JSON.stringify(r)}`)

// --- 仓库列表扫描 -----------------------------------------------------------
// s1：cwd 本身就是仓库 → 只有根（""）。
r = await getJson('/api/desktop-git/repos?session=s1')
if (r.status !== 200 || JSON.stringify(r.body.repos) !== JSON.stringify([''])) {
  throw new Error(`repos(s1) wrong: ${JSON.stringify(r)}`)
}
// s3：cwd 非仓库，子目录 sub 是仓库 → ["sub"]。
r = await getJson('/api/desktop-git/repos?session=s3')
if (r.status !== 200 || JSON.stringify(r.body.repos) !== JSON.stringify(['sub'])) {
  throw new Error(`repos(s3) wrong: ${JSON.stringify(r)}`)
}
// s2：没有仓库 → []。
r = await getJson('/api/desktop-git/repos?session=s2')
if (r.status !== 200 || JSON.stringify(r.body.repos) !== JSON.stringify([])) {
  throw new Error(`repos(s2) wrong: ${JSON.stringify(r)}`)
}

// --- 仓库目录选择（repo 参数） ----------------------------------------------
// s3 根不是仓库；指定 repo=sub 后一切操作都作用于子仓库。
r = await getJson('/api/desktop-git/status?session=s3')
if (r.status !== 200 || r.body.repo !== false) throw new Error(`s3 root should not be repo: ${JSON.stringify(r)}`)
r = await getJson(`/api/desktop-git/status?session=s3&repo=${encodeURIComponent('sub')}`)
if (r.status !== 200 || r.body.repo !== true || r.body.branch.length === 0) {
  throw new Error(`status with repo failed: ${JSON.stringify(r)}`)
}
// 子仓库 diff。
writeFileSync(join(work2, 'sub', 'note.txt'), 'sub hello\n\nsub two\n', 'utf8')
r = await getJson(`/api/desktop-git/diff?session=s3&repo=${encodeURIComponent('sub')}&path=${encodeURIComponent('note.txt')}&staged=0`)
if (r.status !== 200 || !r.body.content.includes('+sub two')) {
  throw new Error(`sub repo diff wrong: ${JSON.stringify(r)}`)
}
// 子仓库暂存 + 提交。
r = await postJson('/api/desktop-git/stage', { session: 's3', repo: 'sub', path: join(work2, 'sub', 'note.txt') })
if (r.status !== 200) throw new Error(`sub stage failed: ${JSON.stringify(r)}`)
r = await postJson('/api/desktop-git/commit', { session: 's3', repo: 'sub', message: 'sub second' })
if (r.status !== 200) throw new Error(`sub commit failed: ${JSON.stringify(r)}`)
r = await getJson(`/api/desktop-git/log?session=s3&repo=${encodeURIComponent('sub')}&limit=5`)
if (r.status !== 200 || r.body[0].subject !== 'sub second') throw new Error(`sub log wrong: ${JSON.stringify(r)}`)
// 越界 repo → 403。
r = await getJson(`/api/desktop-git/status?session=s1&repo=${encodeURIComponent(join(work, '..', 'outside'))}`)
if (r.status !== 403) throw new Error(`repo escape should 403, got ${r.status}`)
r = await postJson('/api/desktop-git/stage', { session: 's1', repo: join(work, '..', 'outside') })
if (r.status !== 403) throw new Error(`repo escape POST should 403, got ${r.status}`)

// --- 修改 + 新增 untracked -------------------------------------------------
writeFileSync(join(work, 'README.md'), '# hello\n\nline two\n', 'utf8')
writeFileSync(join(work, 'untracked.txt'), 'new file\n', 'utf8')
r = await getJson('/api/desktop-git/status?session=s1')
if (r.status !== 200) throw new Error(`status after edit failed: ${JSON.stringify(r)}`)
const readme = r.body.files.find((f) => f.path === 'README.md')
const untracked = r.body.files.find((f) => f.path === 'untracked.txt')
if (!readme || readme.worktree !== true || readme.staged !== false) {
  throw new Error(`README status wrong: ${JSON.stringify(readme)}`)
}
if (!untracked || untracked.untracked !== true) {
  throw new Error(`untracked status wrong: ${JSON.stringify(untracked)}`)
}

// --- diff（工作区） ---------------------------------------------------------
r = await getJson(`/api/desktop-git/diff?session=s1&path=${encodeURIComponent('README.md')}&staged=0`)
if (r.status !== 200) throw new Error(`diff failed: ${JSON.stringify(r)}`)
if (r.body.binary !== false || typeof r.body.content !== 'string') throw new Error(`diff shape wrong: ${JSON.stringify(r.body)}`)
if (!r.body.content.includes('+line two')) throw new Error(`diff content wrong: ${r.body.content}`)

// --- 暂存 / 取消暂存 --------------------------------------------------------
r = await postJson('/api/desktop-git/stage', { session: 's1', path: join(work, 'README.md') })
if (r.status !== 200) throw new Error(`stage failed: ${JSON.stringify(r)}`)
r = await getJson('/api/desktop-git/status?session=s1')
const stagedReadme = r.body.files.find((f) => f.path === 'README.md')
if (!stagedReadme || stagedReadme.staged !== true) throw new Error(`stage did not apply: ${JSON.stringify(stagedReadme)}`)
// 暂存区 diff。
r = await getJson(`/api/desktop-git/diff?session=s1&path=${encodeURIComponent('README.md')}&staged=1`)
if (!r.body.content.includes('+line two')) throw new Error(`staged diff wrong: ${r.body.content}`)
r = await postJson('/api/desktop-git/unstage', { session: 's1', path: join(work, 'README.md') })
if (r.status !== 200) throw new Error(`unstage failed: ${JSON.stringify(r)}`)
r = await getJson('/api/desktop-git/status?session=s1')
if (r.body.files.find((f) => f.path === 'README.md').staged !== false) throw new Error('unstage did not apply')

// --- 全部暂存 + 提交 --------------------------------------------------------
r = await postJson('/api/desktop-git/stage', { session: 's1' })
if (r.status !== 200) throw new Error(`stage all failed: ${JSON.stringify(r)}`)
// 空消息 → 400。
r = await postJson('/api/desktop-git/commit', { session: 's1', message: '   ' })
if (r.status !== 400) throw new Error(`empty commit message should 400, got ${r.status}`)
// 正常提交。
r = await postJson('/api/desktop-git/commit', { session: 's1', message: 'second commit' })
if (r.status !== 200) throw new Error(`commit failed: ${JSON.stringify(r)}`)
// 提交后工作区干净。
r = await getJson('/api/desktop-git/status?session=s1')
if (r.body.files.length !== 0) throw new Error(`worktree should be clean after commit: ${JSON.stringify(r.body.files)}`)
// log。
r = await getJson('/api/desktop-git/log?session=s1&limit=10')
if (r.status !== 200 || r.body.length < 2) throw new Error(`log wrong: ${JSON.stringify(r)}`)
if (r.body[0].subject !== 'second commit' || typeof r.body[0].short !== 'string' || typeof r.body[0].hash !== 'string') {
  throw new Error(`log entry wrong: ${JSON.stringify(r.body[0])}`)
}

// --- 还原（丢弃工作区改动） --------------------------------------------------
writeFileSync(join(work, 'README.md'), '# hello\n\nline three\n', 'utf8')
r = await getJson('/api/desktop-git/status?session=s1')
if (r.body.files.find((f) => f.path === 'README.md') === undefined) throw new Error('edit not visible')
r = await postJson('/api/desktop-git/restore', { session: 's1', path: join(work, 'README.md') })
if (r.status !== 200) throw new Error(`restore failed: ${JSON.stringify(r)}`)
if (readFileSync(join(work, 'README.md'), 'utf8') !== '# hello\n\nline two\n') {
  throw new Error('restore did not revert content')
}
// restore 缺 path → 400。
r = await postJson('/api/desktop-git/restore', { session: 's1' })
if (r.status !== 400) throw new Error(`restore without path should 400, got ${r.status}`)

// --- 二进制 diff ------------------------------------------------------------
writeFileSync(join(work, 'blob.bin'), Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]))
r = await postJson('/api/desktop-git/stage', { session: 's1', path: join(work, 'blob.bin') })
if (r.status !== 200) throw new Error(`stage binary failed: ${JSON.stringify(r)}`)
r = await getJson(`/api/desktop-git/diff?session=s1&path=${encodeURIComponent('blob.bin')}&staged=1`)
if (r.body.binary !== true) throw new Error(`binary diff should be flagged: ${JSON.stringify(r.body)}`)

// --- 越界（cwd 之外）→ 403 --------------------------------------------------
r = await postJson('/api/desktop-git/stage', { session: 's1', path: join(work, '..', 'outside.txt') })
if (r.status !== 403) throw new Error(`stage escape should 403, got ${r.status}`)
r = await getJson(`/api/desktop-git/diff?session=s1&path=${encodeURIComponent(join(work, '..', 'outside.txt'))}`)
if (r.status !== 403) throw new Error(`diff escape should 403, got ${r.status}`)

// --- 缺失 session → 400 -----------------------------------------------------
r = await getJson('/api/desktop-git/status')
if (r.status !== 400) throw new Error(`missing session should 400, got ${r.status}`)

// --- 方法守卫 ---------------------------------------------------------------
const stageGet = await fetch(base + '/api/desktop-git/stage')
if (stageGet.status !== 405) throw new Error(`GET stage should 405, got ${stageGet.status}`)
const statusPut = await fetch(base + '/api/desktop-git/status', { method: 'PUT' })
if (statusPut.status !== 405) throw new Error(`PUT status should 405, got ${statusPut.status}`)

server.close()
await once(server, 'close')
// Windows 下 git 子进程句柄可能延迟释放，清理带重试。
for (const dir of [home, work, plain, work2]) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  } catch {
    // 清理失败不影响断言结果。
  }
}
console.log('git host test: all assertions passed')
