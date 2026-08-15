/**
 * Close-behavior config and user-facing copy for the "close to tray" feature.
 *
 * The main process owns the config file ($DSH_HOME/desktop-close.json): the
 * web UI never touches it, so the choice survives updates and stays readable
 * without the backend running. The file is written only when the user asked
 * to remember the choice; otherwise every close asks again.
 */

export const CLOSE_BEHAVIOR_FILE = 'desktop-close.json'

export function defaultCloseBehavior() {
  return { remembered: false }
}

export function parseCloseBehavior(text) {
  const fallback = defaultCloseBehavior()
  if (typeof text !== 'string') return fallback
  try {
    const value = JSON.parse(text)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return fallback
    const behavior = value.behavior === 'quit' ? 'quit' : value.behavior === 'minimize' ? 'minimize' : undefined
    return { behavior, remembered: value.remembered === true }
  } catch {
    return fallback
  }
}

export function serializeCloseBehavior(config) {
  return `${JSON.stringify(config, null, 2)}\n`
}

/**
 * Native dialog shown when closing the window while no behavior is remembered
 * (and again from the tray menu). Checking the checkbox stores the choice;
 * when a previous choice was remembered, leaving it unchecked clears the
 * memory (the checkbox itself always starts unchecked).
 */
export function buildCloseDialogOptions(remembered) {
  return {
    type: 'question',
    title: '关闭 DeepSeek Harness',
    message: '关闭窗口后希望怎么处理？',
    detail:
      '「最小化到后台」：应用继续在后台运行，本地 Web 服务与地址保持不变，正在进行的任务不受影响。\n\n' +
      '「直接关闭」：应用完全退出，本地服务随之停止；下次启动会重新分配端口，Web 地址将发生变化。',
    buttons: ['最小化到后台', '直接关闭'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    checkboxLabel: '记住我的选择，以后不再询问',
  }
}

export const MINIMIZE_TO_TRAY_NOTIFICATION = {
  title: 'DeepSeek Harness',
  body: '已最小化到后台运行，Web 地址保持不变。需要彻底退出时，请右键系统托盘图标选择「退出」。',
}
