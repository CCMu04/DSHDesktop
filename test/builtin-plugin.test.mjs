import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { ensureBundledPlugin } from '../builtin-plugin.mjs'

function fixture(root, version = '1.0.0', body = 'first') {
  const sourceDirectory = path.join(root, 'source')
  mkdirSync(path.join(sourceDirectory, 'lib'), { recursive: true })
  writeFileSync(path.join(sourceDirectory, 'package.json'), `${JSON.stringify({ name: 'dsh-desktop-ui', version })}\n`)
  writeFileSync(path.join(sourceDirectory, 'lib', 'index.js'), `${body}\n`)
  return sourceDirectory
}

test('enables a bundled revision once and then preserves the user choice', async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-desktop-plugin-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const sourceDirectory = fixture(root)
  const userDataDirectory = path.join(root, 'user-data')
  const installs = []
  const options = {
    sourceDirectory,
    userDataDirectory,
    dshHome: path.join(root, 'dsh-home'),
    packageName: 'dsh-desktop-ui',
    install: async target => installs.push(target),
  }

  assert.equal((await ensureBundledPlugin(options)).changed, true)
  assert.equal((await ensureBundledPlugin(options)).changed, false)
  assert.equal(installs.length, 1)
  assert.equal(
    readFileSync(path.join(userDataDirectory, 'builtin-plugins', 'dsh-desktop-ui', 'lib', 'index.js'), 'utf8'),
    'first\n',
  )
})

test('enables again after bundled content changes or for another DSH Home', async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-desktop-plugin-update-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const sourceDirectory = fixture(root)
  const userDataDirectory = path.join(root, 'user-data')
  let installs = 0
  const base = {
    sourceDirectory,
    userDataDirectory,
    packageName: 'dsh-desktop-ui',
    install: async () => { installs += 1 },
  }

  await ensureBundledPlugin({ ...base, dshHome: path.join(root, 'home-a') })
  writeFileSync(path.join(sourceDirectory, 'lib', 'index.js'), 'updated\n')
  await ensureBundledPlugin({ ...base, dshHome: path.join(root, 'home-a') })
  await ensureBundledPlugin({ ...base, dshHome: path.join(root, 'home-b') })

  assert.equal(installs, 3)
  assert.equal(
    readFileSync(path.join(userDataDirectory, 'builtin-plugins', 'dsh-desktop-ui', 'lib', 'index.js'), 'utf8'),
    'updated\n',
  )
})
