/**
 * Patch electron-builder's NSIS templates for DSH Desktop:
 *
 * 1. installUtil.nsh — keep the desktop shortcut in place on same-directory
 *    reinstall. With `allowToChangeInstallationDirectory` enabled, the
 *    `setIsTryToKeepShortcuts` macro only enables electron-builder's
 *    keep-shortcuts mechanism for auto-updates (`/updated` flag); a manual
 *    reinstall runs the old uninstaller WITHOUT `--keep-shortcuts`, which
 *    deletes the desktop shortcut and recreates it (Windows then moves the
 *    icon to the end of the desktop grid). The patch makes the macro always
 *    opt in; the mechanism itself still only kicks in when the previous
 *    install registered `KeepShortcuts=true` AND the app executable exists
 *    at the new install directory, so fresh installs and directory changes
 *    behave exactly as before.
 *
 * 2. common.nsh / installSection.nsh — show the install details in the
 *    installer UI. electron-builder ships `ShowInstDetails nevershow` and
 *    (for the assisted installer) `SetDetailsPrint none`, so the user only
 *    sees a progress bar. The patch switches to `ShowInstDetails show` and
 *    drops the `SetDetailsPrint none` call, surfacing the per-file details.
 *
 * electron-builder is pinned (see package.json), and the script fails loudly
 * if any template no longer matches, so a future upgrade is noticed instead
 * of silently patching the wrong file.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

export const PATCH_MARKER_INSTALL_UTIL = '# DSH Desktop: keep desktop shortcuts on same-directory reinstall'
export const PATCH_MARKER_COMMON = '# DSH Desktop: show install details in the installer UI'
export const PATCH_MARKER_INSTALL_SECTION = '# DSH Desktop: keep install details visible'

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
  PATCH_MARKER_INSTALL_UTIL,
  '!macro setIsTryToKeepShortcuts',
  '  StrCpy $isTryToKeepShortcuts "true"',
  '!macroend',
].join('\n')

const ORIGINAL_SHOW_DETAILS = 'ShowInstDetails nevershow'
const PATCHED_SHOW_DETAILS = `${PATCH_MARKER_COMMON}\nShowInstDetails show`

const ORIGINAL_DETAILS_PRINT = [
  '${IfNot} ${Silent}',
  '  SetDetailsPrint none',
  '${endif}',
].join('\n')
const PATCHED_DETAILS_PRINT = PATCH_MARKER_INSTALL_SECTION

export function patchInstallUtil(content) {
  if (content.includes(PATCH_MARKER_INSTALL_UTIL)) return content
  if (!content.includes(ORIGINAL_MACRO)) {
    throw new Error(
      'electron-builder NSIS template (installUtil.nsh) no longer matches the expected ' +
        'setIsTryToKeepShortcuts macro — re-evaluate scripts/patch-nsis-templates.mjs before building.',
    )
  }
  return content.replace(ORIGINAL_MACRO, PATCHED_MACRO)
}

export function patchCommonNsh(content) {
  if (content.includes(PATCH_MARKER_COMMON)) return content
  if (!content.includes(ORIGINAL_SHOW_DETAILS)) {
    throw new Error(
      'electron-builder NSIS template (common.nsh) no longer matches the expected ' +
        'ShowInstDetails directive — re-evaluate scripts/patch-nsis-templates.mjs before building.',
    )
  }
  return content.replace(ORIGINAL_SHOW_DETAILS, PATCHED_SHOW_DETAILS)
}

export function patchInstallSection(content) {
  if (content.includes(PATCH_MARKER_INSTALL_SECTION)) return content
  if (!content.includes(ORIGINAL_DETAILS_PRINT)) {
    throw new Error(
      'electron-builder NSIS template (installSection.nsh) no longer matches the expected ' +
        'SetDetailsPrint block — re-evaluate scripts/patch-nsis-templates.mjs before building.',
    )
  }
  return content.replace(ORIGINAL_DETAILS_PRINT, PATCHED_DETAILS_PRINT)
}

/** Backward-compatible alias: patch the installUtil template only. */
export function patchNsisTemplate(content) {
  return patchInstallUtil(content)
}

export function defaultTemplatePaths() {
  const shellRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const templatesRoot = join(shellRoot, 'node_modules', 'app-builder-lib', 'templates', 'nsis')
  return {
    installUtil: join(templatesRoot, 'include', 'installUtil.nsh'),
    commonNsh: join(templatesRoot, 'common.nsh'),
    installSection: join(templatesRoot, 'installSection.nsh'),
  }
}

export function main(paths = defaultTemplatePaths()) {
  const jobs = [
    [paths.installUtil, patchInstallUtil, 'installUtil.nsh'],
    [paths.commonNsh, patchCommonNsh, 'common.nsh'],
    [paths.installSection, patchInstallSection, 'installSection.nsh'],
  ]
  for (const [targetPath, patch, label] of jobs) {
    if (!existsSync(targetPath)) {
      throw new Error(`NSIS template not found: ${targetPath}`)
    }
    const content = readFileSync(targetPath, 'utf8')
    const patched = patch(content)
    if (patched !== content) {
      writeFileSync(targetPath, patched, 'utf8')
      console.log(`[patch-nsis-templates] patched ${targetPath}`)
    } else {
      console.log(`[patch-nsis-templates] ${label} already patched, nothing to do`)
    }
  }
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectRun) {
  main()
}
