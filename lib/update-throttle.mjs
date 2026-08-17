import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * 自动更新检查节流。
 *
 * electron-updater 启动即检查一次 GitHub Releases（未认证 API，限流
 * 60 次/小时/IP，国内运营商 NAT 下多用户共享出口 IP 很容易耗尽），
 * 用本模块把「成功检查」限为每小时一次；失败（网络/限流）则清除记录，
 * 下次启动立即重试，避免用户长时间收不到更新。
 */

/** 成功检查后的冷却间隔：1 小时。 */
export const AUTO_CHECK_INTERVAL_MS = 60 * 60 * 1000

/** 节流状态文件名（$DSH_HOME 下）。 */
export const AUTO_CHECK_FILE = 'desktop-auto-update.json'

/** 持久化目录（$DSH_HOME 或 ~/.dsh）。 */
function homeDir() {
  return process.env.DSH_HOME?.trim()
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh')
}

/** 节流状态文档路径。 */
function statePath() {
  return join(homeDir(), AUTO_CHECK_FILE)
}

/** 容错读取节流状态；缺失/损坏 → { lastCheckedAt: null }。 */
export function readAutoCheckState() {
  try {
    const raw = JSON.parse(readFileSync(statePath(), 'utf8'))
    if (
      typeof raw === 'object' &&
      raw !== null &&
      typeof raw.lastCheckedAt === 'number'
    ) {
      return { lastCheckedAt: raw.lastCheckedAt }
    }
  } catch {}
  return { lastCheckedAt: null }
}

/** 是否应执行一次自动检查：无记录或距上次成功检查已超过冷却间隔。 */
export function shouldAutoCheck(state = readAutoCheckState(), now = Date.now()) {
  const lastCheckedAt =
    typeof state?.lastCheckedAt === "number" ? state.lastCheckedAt : null;
  if (lastCheckedAt === null) return true;
  return now - lastCheckedAt >= AUTO_CHECK_INTERVAL_MS;
}

/** 记录一次成功的检查时间（原子写入）。 */
export function recordAutoCheck(now = Date.now()) {
  mkdirSync(homeDir(), { recursive: true })
  const target = statePath()
  const temporaryPath = `${target}.${process.pid}.tmp`
  writeFileSync(
    temporaryPath,
    `${JSON.stringify({ lastCheckedAt: now })}\n`,
    'utf8',
  )
  renameSync(temporaryPath, target)
}

/** 清除节流记录（检查失败后调用，下次启动立即重试）。 */
export function clearAutoCheck() {
  try {
    rmSync(statePath())
  } catch {}
}
