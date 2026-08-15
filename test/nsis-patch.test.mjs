import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  defaultTemplatePath,
  main,
  patchNsisTemplate,
} from '../scripts/patch-nsis-templates.mjs'

const ORIGINAL = [
  '!macro setIsTryToKeepShortcuts',
  '  StrCpy $isTryToKeepShortcuts "true"',
  '  !ifdef allowToChangeInstallationDirectory',
  '    ${ifNot} ${isUpdated}',
  '      StrCpy $isTryToKeepShortcuts "false"',
  '    ${endIf}',
  '  !endif',
  '!macroend',
].join('\n')

const PATCHED = [
  '# DSH Desktop: keep desktop shortcuts on same-directory reinstall',
  '!macro setIsTryToKeepShortcuts',
  '  StrCpy $isTryToKeepShortcuts "true"',
  '!macroend',
].join('\n')

test('patchNsisTemplate removes the allowToChangeInstallationDirectory gate', () => {
  const result = patchNsisTemplate(ORIGINAL)
  assert.equal(result, PATCHED)
  assert.ok(!result.includes('allowToChangeInstallationDirectory'))
  assert.ok(!result.includes('${isUpdated}'))
})

test('patchNsisTemplate is idempotent', () => {
  const once = patchNsisTemplate(ORIGINAL)
  assert.equal(patchNsisTemplate(once), once)
})

test('patchNsisTemplate leaves unrelated template content untouched', () => {
  const template = `# unrelated comment\n${ORIGINAL}\n!macro addDesktopLink keepShortcuts\n  # body\n!macroend\n`
  const result = patchNsisTemplate(template)
  assert.ok(result.includes('# unrelated comment'))
  assert.ok(result.includes('!macro addDesktopLink keepShortcuts'))
  assert.ok(result.includes('  # body'))
  assert.ok(result.includes(PATCHED))
})

test('patchNsisTemplate fails loudly on an unknown template shape', () => {
  assert.throws(() => patchNsisTemplate('!macro somethingElse\n!macroend'), /no longer matches/)
})

test('main patches the file and is idempotent on disk', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-nsis-patch-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const target = path.join(root, 'installUtil.nsh')
  writeFileSync(target, ORIGINAL, 'utf8')

  main(target)
  assert.equal(readFileSync(target, 'utf8'), PATCHED)

  main(target)
  assert.equal(readFileSync(target, 'utf8'), PATCHED)
})

test('defaultTemplatePath points into the pinned app-builder-lib templates', () => {
  const target = defaultTemplatePath()
  assert.ok(target.includes(path.join('node_modules', 'app-builder-lib', 'templates', 'nsis', 'include')))
  assert.ok(target.endsWith('installUtil.nsh'))
})
