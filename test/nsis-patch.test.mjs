import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  defaultTemplatePaths,
  main,
  patchCommonNsh,
  patchInstallSection,
  patchInstallUtil,
  patchNsisTemplate,
} from '../scripts/patch-nsis-templates.mjs'

const ORIGINAL_MACRO = [
  '!macro setIsTryToKeepShortcuts',
  '  StrCpy $isTryToKeepShortcuts "true"',
  '  !ifdef allowToChangeInstallationDirectory',
  '    ${ifNot} ${isUpdated}',
  '      StrCpy $isTryToKeepShortcuts "false"',
  '    ${endIf}',
  '  !endif',
  '!macroend',
].join('\n')

const PATCHED_MACRO = [
  '# DSH Desktop: keep desktop shortcuts on same-directory reinstall',
  '!macro setIsTryToKeepShortcuts',
  '  StrCpy $isTryToKeepShortcuts "true"',
  '!macroend',
].join('\n')

const ORIGINAL_COMMON = 'ShowInstDetails nevershow'
const PATCHED_COMMON = '# DSH Desktop: show install details in the installer UI\nShowInstDetails show'

const ORIGINAL_SECTION = ['${IfNot} ${Silent}', '  SetDetailsPrint none', '${endif}'].join('\n')
const PATCHED_SECTION = '# DSH Desktop: keep install details visible'

test('patchInstallUtil removes the allowToChangeInstallationDirectory gate', () => {
  const result = patchInstallUtil(ORIGINAL_MACRO)
  assert.equal(result, PATCHED_MACRO)
  assert.ok(!result.includes('allowToChangeInstallationDirectory'))
  assert.ok(!result.includes('${isUpdated}'))
})

test('patchInstallUtil is idempotent', () => {
  const once = patchInstallUtil(ORIGINAL_MACRO)
  assert.equal(patchInstallUtil(once), once)
})

test('patchInstallUtil leaves unrelated template content untouched', () => {
  const template = `# unrelated comment\n${ORIGINAL_MACRO}\n!macro addDesktopLink keepShortcuts\n  # body\n!macroend\n`
  const result = patchInstallUtil(template)
  assert.ok(result.includes('# unrelated comment'))
  assert.ok(result.includes('!macro addDesktopLink keepShortcuts'))
  assert.ok(result.includes(PATCHED_MACRO))
})

test('patchInstallUtil fails loudly on an unknown template shape', () => {
  assert.throws(() => patchInstallUtil('!macro somethingElse\n!macroend'), /no longer matches/)
})

test('patchCommonNsh switches to showing install details', () => {
  const result = patchCommonNsh(ORIGINAL_COMMON)
  assert.equal(result, PATCHED_COMMON)
  assert.ok(!result.includes('nevershow'))
  assert.equal(patchCommonNsh(result), result, 'idempotent')
  assert.throws(() => patchCommonNsh('ShowInstDetails show'), /no longer matches/)
})

test('patchInstallSection drops the SetDetailsPrint none call', () => {
  const result = patchInstallSection(ORIGINAL_SECTION)
  assert.equal(result, PATCHED_SECTION)
  assert.ok(!result.includes('SetDetailsPrint'))
  assert.equal(patchInstallSection(result), result, 'idempotent')
  assert.throws(() => patchInstallSection('${IfNot} ${Silent}\n  SetDetailsPrint lastused\n${endif}'), /no longer matches/)
})

test('patchNsisTemplate stays a working alias of patchInstallUtil', () => {
  assert.equal(patchNsisTemplate(ORIGINAL_MACRO), PATCHED_MACRO)
})

test('main patches all three template files and is idempotent on disk', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-nsis-patch-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const paths = {
    installUtil: path.join(root, 'installUtil.nsh'),
    commonNsh: path.join(root, 'common.nsh'),
    installSection: path.join(root, 'installSection.nsh'),
  }
  writeFileSync(paths.installUtil, ORIGINAL_MACRO, 'utf8')
  writeFileSync(paths.commonNsh, ORIGINAL_COMMON, 'utf8')
  writeFileSync(paths.installSection, ORIGINAL_SECTION, 'utf8')

  main(paths)
  assert.equal(readFileSync(paths.installUtil, 'utf8'), PATCHED_MACRO)
  assert.equal(readFileSync(paths.commonNsh, 'utf8'), PATCHED_COMMON)
  assert.equal(readFileSync(paths.installSection, 'utf8'), PATCHED_SECTION)

  main(paths)
  assert.equal(readFileSync(paths.installUtil, 'utf8'), PATCHED_MACRO)
  assert.equal(readFileSync(paths.commonNsh, 'utf8'), PATCHED_COMMON)
  assert.equal(readFileSync(paths.installSection, 'utf8'), PATCHED_SECTION)
})

test('defaultTemplatePaths point into the pinned app-builder-lib templates', () => {
  const paths = defaultTemplatePaths()
  assert.ok(paths.installUtil.endsWith(path.join('nsis', 'include', 'installUtil.nsh')))
  assert.ok(paths.commonNsh.endsWith(path.join('nsis', 'common.nsh')))
  assert.ok(paths.installSection.endsWith(path.join('nsis', 'installSection.nsh')))
})
