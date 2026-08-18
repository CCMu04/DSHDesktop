/**
 * electron-builder.mjs — electron-builder 启动包装（Windows 桌面壳构建用）。
 *
 * 为什么存在：electron-builder 每次构建都要联网拉取两样东西——
 *   1. Electron 发行包（zip + SHASUMS256.txt 校验文件，@electron/get 对校验
 *      文件强制绕过缓存、每次现拉）；
 *   2. electron-builder-binaries 工具集（winCodeSign / nsis / nsis-resources /
 *      7zip / icons，仅缓存缺失时拉取）。
 * 在 GitHub 二进制下载被墙/不稳定的网络下（国内常见），这两处会直接
 * connect ETIMEDOUT 导致构建失败。本包装脚本在缺省时把下载源指到 npmmirror
 * 镜像（全球可达），并打印实际生效的镜像地址：
 *   - ELECTRON_MIRROR                        → Electron 发行包镜像
 *   - ELECTRON_BUILDER_BINARIES_MIRROR       → electron-builder-binaries 镜像
 * 已设置的环境变量永远优先（想用 GitHub 直连或其他镜像时自行设置即可）。
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const shellDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const ELECTRON_MIRROR_DEFAULT = 'https://registry.npmmirror.com/-/binary/electron/'
const BINARIES_MIRROR_DEFAULT = 'https://registry.npmmirror.com/-/binary/electron-builder-binaries/'

if (!process.env.ELECTRON_MIRROR) {
  process.env.ELECTRON_MIRROR = ELECTRON_MIRROR_DEFAULT
  console.log(`[electron-builder] ELECTRON_MIRROR unset; using ${ELECTRON_MIRROR_DEFAULT}`)
} else {
  console.log(`[electron-builder] ELECTRON_MIRROR=${process.env.ELECTRON_MIRROR}`)
}
if (!process.env.ELECTRON_BUILDER_BINARIES_MIRROR) {
  process.env.ELECTRON_BUILDER_BINARIES_MIRROR = BINARIES_MIRROR_DEFAULT
  console.log(`[electron-builder] ELECTRON_BUILDER_BINARIES_MIRROR unset; using ${BINARIES_MIRROR_DEFAULT}`)
} else {
  console.log(`[electron-builder] ELECTRON_BUILDER_BINARIES_MIRROR=${process.env.ELECTRON_BUILDER_BINARIES_MIRROR}`)
}

const cliEntry = path.join(
  shellDirectory,
  'node_modules',
  'electron-builder',
  'out',
  'cli',
  'cli.js',
)
const result = spawnSync(process.execPath, [cliEntry, ...process.argv.slice(2)], {
  cwd: shellDirectory,
  stdio: 'inherit',
})
if (result.error) {
  console.error(`[electron-builder] failed to spawn electron-builder: ${result.error.message}`)
  process.exit(1)
}
process.exit(result.status ?? 0)
