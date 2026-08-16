/**
 * dsh-desktop-tray — host half.
 *
 * 托盘命令桥的服务端：本插件不需要任何 host 能力（命令由主进程通过
 * dsh-desktop-tray-command DOM 事件注入页面，客户端直接调用官方
 * workspaces 服务），这里只保留一个空壳 apply，让插件作为 cordis 插件
 * 正常安装到 web profile。
 */

/** Stable cordis plugin name (matches the bundle patch insert id). */
export const name = "dsh-desktop-tray";

/** No host services required. */
export const inject = [];

/** Empty host half: everything happens in the browser. */
export function apply() {}
