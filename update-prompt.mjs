import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * 更新弹窗「不再提醒」持久化。
 *
 * 用户勾选「下次不再自动提醒」后记录对应版本号；同一版本再次被
 * electron-updater 检测到时不再自动弹窗（侧边栏「更新」按钮不受影响），
 * 新版本出现后会重新提醒。
 */

/** 弹窗状态文件名（$DSH_HOME 下）。 */
export const UPDATE_PROMPT_FILE = 'desktop-update-prompt.json'

/** 持久化目录（$DSH_HOME 或 ~/.dsh）。 */
function homeDir() {
  return process.env.DSH_HOME?.trim()
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh')
}

/** 弹窗状态文档路径。 */
function statePath() {
  return join(homeDir(), UPDATE_PROMPT_FILE)
}

/** 容错读取「不再提醒」的版本号；缺失/损坏 → null。 */
export function readDismissedVersion() {
  try {
    const raw = JSON.parse(readFileSync(statePath(), 'utf8'))
    if (
      typeof raw === 'object' &&
      raw !== null &&
      typeof raw.dismissedVersion === 'string'
    ) {
      return raw.dismissedVersion
    }
  } catch {}
  return null
}

/** 记录「不再提醒」的版本号（原子写入）。 */
export function recordDismissedVersion(version) {
  if (typeof version !== 'string' || version.length === 0) return
  mkdirSync(homeDir(), { recursive: true })
  const target = statePath()
  const temporaryPath = `${target}.${process.pid}.tmp`
  writeFileSync(
    temporaryPath,
    `${JSON.stringify({ dismissedVersion: version })}\n`,
    'utf8',
  )
  renameSync(temporaryPath, target)
}
