import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  ensureBundledPlugin,
  ensurePluginRuntimeExports,
  pruneBundledPluginReferences,
} from '../lib/builtin-plugin.mjs'

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

test('exposes the official runtime scopes required by bundled host plugins', t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-desktop-runtime-scopes-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const runtime = path.join(root, 'runtime', 'node_modules')
  const userData = path.join(root, 'user-data')
  for (const scope of ['@deepseek-ai', '@earendil-works']) {
    mkdirSync(path.join(runtime, scope), { recursive: true })
  }

  ensurePluginRuntimeExports({
    userDataDirectory: userData,
    runtimeNodeModulesDirectory: runtime,
  })

  for (const scope of ['@deepseek-ai', '@earendil-works']) {
    const link = path.join(userData, 'builtin-plugins', 'node_modules', scope)
    assert.equal(
      path.resolve(readlinkSync(link)).toLowerCase(),
      path.resolve(runtime, scope).toLowerCase(),
    )
  }
})

test('prunes bundled-plugin references that no longer ship from the web profile', async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-desktop-prune-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const profile = path.join(root, 'web', 'package.json')
  mkdirSync(path.dirname(profile), { recursive: true })
  writeFileSync(
    profile,
    `${JSON.stringify(
      {
        name: 'dsh-web-profile',
        dependencies: {
          'dsh-desktop-shipped': 'link:C:/a/dsh-desktop-shipped',
          'dsh-desktop-browser': 'link:C:/a/dsh-desktop-browser',
          'my-own-plugin': 'link:C:/a/my-own-plugin',
          '@deepseek-ai/dsh': '0.1.0-rc.7',
        },
        dsh: {
          profile: {
            bundles: [
              '@deepseek-ai/dsh-web-app',
              'dsh-desktop-shipped',
              'dsh-desktop-browser',
              'my-own-plugin',
            ],
          },
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  )

  const changed = pruneBundledPluginReferences(profile, ['dsh-desktop-shipped'])
  assert.equal(changed, true)
  const pruned = JSON.parse(readFileSync(profile, 'utf8'))
  assert.deepEqual(Object.keys(pruned.dependencies).sort(), ['@deepseek-ai/dsh', 'dsh-desktop-shipped', 'my-own-plugin'])
  assert.deepEqual(pruned.dsh.profile.bundles, ['@deepseek-ai/dsh-web-app', 'dsh-desktop-shipped', 'my-own-plugin'])

  // Idempotent: a second run over an already-clean profile changes nothing.
  assert.equal(pruneBundledPluginReferences(profile, ['dsh-desktop-shipped']), false)

  // Missing/unreadable profile is a safe no-op.
  assert.equal(pruneBundledPluginReferences(path.join(root, 'nope', 'package.json'), []), false)
})
