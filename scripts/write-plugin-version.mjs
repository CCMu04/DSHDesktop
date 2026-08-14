/**
 * Write the desktop-shell version into the feature-enhancement updates plugin
 * so its host half can serve the current version to the settings page.
 *
 * The plugin directory is copied verbatim into the packaged resources (and
 * deployed to the user-data builtin-plugins folder on launch), so a small
 * `version.json` next to the plugin's package.json travels with it. Wired as
 * `prestart` / `predist` so both the unpackaged dev run and packaged builds
 * carry the version of the shell that ships them.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const SHELL_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const shellPackage = JSON.parse(readFileSync(join(SHELL_ROOT, 'package.json'), 'utf8'))
const version = typeof shellPackage.version === 'string' ? shellPackage.version : '0.0.0'
const dshVersion =
  typeof shellPackage.dependencies?.['@deepseek-ai/dsh'] === 'string'
    ? shellPackage.dependencies['@deepseek-ai/dsh']
    : null
const target = join(SHELL_ROOT, 'plugins', 'dsh-desktop-updates', 'version.json')
writeFileSync(target, `${JSON.stringify({ version, dshVersion }, null, 2)}\n`, 'utf8')
console.log(`[write-plugin-version] wrote ${target} (${version}, dsh ${dshVersion})`)
