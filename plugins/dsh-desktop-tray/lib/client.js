/**
 * dsh-desktop-tray — browser half.
 *
 * 托盘命令桥：主进程（Electron shell）无法直接调用页面内的官方客户端服务，
 * 因此通过 `executeJavaScript` 派发 `dsh-desktop-tray-command` 自定义事件，
 * 本插件监听该事件并把命令翻译成官方服务调用：
 *
 *   new-session    → ctx.workspaces.startSession()（新建任务，沿用当前工作区）
 *   add-workspace  → 原生目录选择器 pickDirectory() → workspaces.create()
 *                    → 在新工作区里 startSession()（与官方「添加工作区…」流程一致）
 *
 * 命令执行失败静默（用户正在页面上时，官方入口仍在；托盘命令只是快捷键）。
 *
 * This file is a module-loader bundle (window.__ModuleLoader__), same shape
 * as the official web client bundles; keep the factory export contract.
 */
window.__ModuleLoader__.load({
  id: "dsh-desktop-tray",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    //#region lib/client/index.js
    /** Required client service: the workspaces store (startSession / pickDirectory / create). */
    const inject = ["workspaces"];
    /**
     * Register the DOM command bridge.
     * @param ctx - client root context.
     * @returns disposer that removes the listener.
     */
    function apply(ctx) {
      const handleCommand = (event) => {
        const command = typeof event?.detail === "string" ? event.detail : "";
        if (command === "new-session") {
          // startSession 可能返回 promise（官方服务）也可能同步完成（测试
          // mock）——Promise.resolve 包装统一处理，失败记录而非静默丢弃
          // （与 add-workspace 分支的 catch 对齐，避免 unhandled rejection）。
          void Promise.resolve(ctx.workspaces.startSession()).catch((error) => {
            console.warn("dsh-desktop-tray: new-session failed:", error);
          });
        } else if (command === "add-workspace") {
          ctx.workspaces
            .pickDirectory()
            .then((path) => {
              if (!path) return null;
              return ctx.workspaces.create({ path });
            })
            .then((workspace) => {
              if (!workspace) return;
              ctx.workspaces.startSession(workspace.workspaceId);
            })
            .catch((error) => {
              console.warn("dsh-desktop-tray: add-workspace failed:", error);
            });
        }
      };
      window.addEventListener("dsh-desktop-tray-command", handleCommand);
      return () => {
        window.removeEventListener("dsh-desktop-tray-command", handleCommand);
      };
    }
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
    //#endregion
  },
});
