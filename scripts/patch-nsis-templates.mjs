/**
 * Patch electron-builder's NSIS templates so that reinstalling over an
 * existing installation keeps the desktop shortcut in place (and therefore
 * at its original position on the desktop).
 *
 * Why: with `allowToChangeInstallationDirectory` enabled, electron-builder's
 * `setIsTryToKeepShortcuts` macro only enables its keep-shortcuts mechanism
 * for auto-updates (`/updated` flag). A manual reinstall therefore runs the
 * old uninstaller WITHOUT `--keep-shortcuts`, which deletes the desktop
 * shortcut; the installer then recreates it, and Windows Explorer treats the
 * delete+recreate as a new icon and moves it to the end of the desktop grid.
 *
 * The patch makes the macro always opt in. The keep-shortcuts mechanism
 * itself still only kicks in when the previous install registered
 * `KeepShortcuts=true` AND the app executable exists at the new install
 * directory, so:
 *   - fresh install: no registry entry → shortcuts created normally;
 *   - reinstall to the same directory: shortcut file untouched → position
 *     kept (same behavior as the official auto-update flow);
 *   - reinstall to a different directory: `$appExe` missing → old shortcut
 *     removed and a new one created, pointing at the new location.
 *
 * electron-builder is pinned (see package.json), and the script fails loudly
 * if the template no longer matches, so a future upgrade is noticed instead
 * of silently patching the wrong file.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

export const PATCH_MARKER = '# DSH Desktop: keep desktop shortcuts on same-directory reinstall'

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
  PATCH_MARKER,
  '!macro setIsTryToKeepShortcuts',
  '  StrCpy $isTryToKeepShortcuts "true"',
  '!macroend',
].join('\n')

export function patchNsisTemplate(content) {
  if (content.includes(PATCH_MARKER)) return content
  if (!content.includes(ORIGINAL_MACRO)) {
    throw new Error(
      'electron-builder NSIS template (installUtil.nsh) no longer matches the expected ' +
        'setIsTryToKeepShortcuts macro — re-evaluate scripts/patch-nsis-templates.mjs before building.',
    )
  }
  return content.replace(ORIGINAL_MACRO, PATCHED_MACRO)
}

export function defaultTemplatePath() {
  const shellRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  return join(
    shellRoot,
    'node_modules',
    'app-builder-lib',
    'templates',
    'nsis',
    'include',
    'installUtil.nsh',
  )
}

export function main(targetPath = defaultTemplatePath()) {
  if (!existsSync(targetPath)) {
    throw new Error(`NSIS template not found: ${targetPath}`)
  }
  const content = readFileSync(targetPath, 'utf8')
  const patched = patchNsisTemplate(content)
  if (patched !== content) {
    writeFileSync(targetPath, patched, 'utf8')
    console.log(`[patch-nsis-templates] patched ${targetPath}`)
  } else {
    console.log('[patch-nsis-templates] already patched, nothing to do')
  }
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectRun) {
  main(process.argv[2])
}
