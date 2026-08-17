/**
 * Update-check logic and user-facing copy for the tray "check for updates"
 * action. The main process queries the GitHub Releases API directly (same
 * source the settings-page updater uses) and shows a native dialog; only the
 * version comparison and the dialog copy live here so they stay testable.
 */

export const LATEST_RELEASE_URL = 'https://api.github.com/repos/CCMu04/DSHDesktop/releases/latest'

export function parseVersionParts(version) {
  const [core, prerelease] = String(version).replace(/^v/i, '').split('-', 2)
  const parts = prerelease === undefined ? core.split('.') : [...core.split('.'), ...prerelease.split('.')]
  return parts.map(part => (/^\d+$/.test(part) ? Number(part) : part))
}

/**
 * Compare two dotted version strings (each part numeric or a string tag such
 * as `rc`). Returns 1 / 0 / -1 for a > b / a === b / a < b.
 */
export function compareVersions(a, b) {
  const pa = parseVersionParts(a)
  const pb = parseVersionParts(b)
  const length = Math.max(pa.length, pb.length)
  for (let i = 0; i < length; i += 1) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x === y) continue
    if (typeof x === 'number' && typeof y === 'number') return x > y ? 1 : -1
    return String(x) > String(y) ? 1 : -1
  }
  return 0
}

export function isUpdateAvailable(currentVersion, latestVersion) {
  return compareVersions(latestVersion, currentVersion) > 0
}

/** Trim a release body to a readable dialog detail without HTML. */
export function formatReleaseNotes(body) {
  if (typeof body !== 'string' || body === '') return ''
  const plain = body.replace(/<[^>]+>/g, '').replace(/^#+\s*/gm, '').trim()
  return plain.length > 800 ? `${plain.slice(0, 800)}…` : plain
}

export function buildUpdateFoundOptions(currentVersion, release) {
  const tag = typeof release?.tag_name === 'string' ? release.tag_name : '未知版本'
  const notes = formatReleaseNotes(release?.body)
  const lines = [`当前版本：${currentVersion}`, `最新版本：${tag}`]
  if (typeof release?.published_at === 'string') lines.push(`发布时间：${release.published_at.slice(0, 10)}`)
  if (notes) lines.push('', notes)
  return {
    type: 'info',
    title: '发现新版本',
    message: `DeepSeek Harness ${tag} 已发布`,
    detail: lines.join('\n'),
    buttons: ['前往下载', '暂不'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  }
}

export function buildUpToDateOptions(currentVersion) {
  return {
    type: 'info',
    title: '检查更新',
    message: '已是最新版本',
    detail: `当前版本：${currentVersion}`,
    buttons: ['好的'],
    noLink: true,
  }
}

export function buildUpdateFailedOptions(errorMessage) {
  return {
    type: 'error',
    title: '检查更新',
    message: '检查更新失败，请稍后重试',
    detail: errorMessage ? `原因：${errorMessage}` : '无法连接到更新服务。',
    buttons: ['好的'],
    noLink: true,
  }
}
