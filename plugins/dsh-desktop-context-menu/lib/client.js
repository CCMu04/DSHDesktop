/**
 * dsh-desktop-context-menu — browser half.
 *
 * 「右键菜单」功能增强：输入框剪切 / 复制 / 粘贴 / 全选、工作区右键「在资源
 * 管理器中打开」、选中内容复制（官方无右键菜单）。开关由 host 持久化
 * （/api/desktop-context-menu/config），开关项注册进「功能增强」卡片。
 */
window.__ModuleLoader__.load({
  id: "dsh-desktop-context-menu",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react_jsx_runtime = require("react/jsx-runtime");
    let react = require("react");
    let react_dom = require("react-dom");
    let _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime/client");
    let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

    //#region 配置工具
    /** 功能开关默认值。 */
    const dduDefaultConfig = { enabled: true };
    /** 读取生效配置；任何失败回退默认（全开）。 */
    function loadConfig() {
      return fetch("/api/desktop-context-menu/config", {
        headers: { accept: "application/json" },
        cache: "no-store",
      })
        .then((res) =>
          res.ok
            ? res.json()
            : Promise.reject(new Error("config-http-" + res.status)),
        )
        .then((body) => ({
          enabled: typeof body?.enabled === "boolean" ? body.enabled : true,
        }))
        .catch(() => ({ ...dduDefaultConfig }));
    }
    /** 写入开关；返回是否被接受。 */
    function saveConfig(config) {
      return fetch("/api/desktop-context-menu/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(config),
      }).then((res) => res.ok);
    }
    //#endregion

    //#region 样式
    /** 注入一个插件样式标签；返回的 disposer 移除它。 */
    const dduiInstallCss = (cssText, styleTagId) => {
      if (
        typeof document === "undefined" ||
        document.querySelector(
          "style[data-plugin-css=" + JSON.stringify(styleTagId) + "]",
        ) !== null
      )
        return () => {};
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-desktop-context-menu";
      tag.dataset.pluginCss = styleTagId;
      tag.textContent = cssText;
      document.head.appendChild(tag);
      return () => tag.remove();
    };
    //#endregion

    //#region toast（自 dsh-desktop-ui 迁移）
    // 轻量 toast 通知：复制、打开文件等操作的反馈
    /** Lightweight toast styles (top-center, auto-dismiss). */
    const toastCss =
      ".dduiToast{box-sizing:border-box;position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:3000;align-items:flex-start;gap:8px;max-width:min(480px,calc(100vw - 32px));padding:9px 14px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);box-shadow:var(--dsw-shadow-lv2);color:var(--dsw-alias-label-primary);border-radius:10px;display:flex;animation:dduiToastIn .2s ease-out}.dduiToast[data-kind=error]{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent)}.dduiToastIcon{flex:none;margin-top:2px;display:inline-flex}.dduiToast[data-kind=success] .dduiToastIcon{color:var(--dsw-alias-state-success-primary)}.dduiToast[data-kind=error] .dduiToastIcon{color:var(--dsw-alias-state-error-primary)}.dduiToastText{min-width:0;font-size:13px;line-height:20px;overflow-wrap:anywhere}@keyframes dduiToastIn{from{opacity:0;transform:translateX(-50%) translateY(-8px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}";
    const toastTagId = "dsh-desktop-context-menu/Toast.module.css";
    if (
      typeof document !== "undefined" &&
      document.querySelector(
        "style[data-plugin-css=" + JSON.stringify(toastTagId) + "]",
      ) === null
    ) {
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-desktop-ui";
      tag.dataset.pluginCss = toastTagId;
      tag.textContent = toastCss;
      document.head.appendChild(tag);
    }
    /** Single-slot toast state: the newest message replaces the previous one. */
    const dshToastStore = (0,
    _deepseek_ai_dsh_client_runtime_client.createSnapshotStore)({
      toast: null,
    });
    /** Monotonic toast sequence so re-showing the same text restarts the timer. */
    let dshToastSeq = 0;
    /** Show one lightweight toast (kind: "success" | "error"). */
    function showDesktopToast(kind, text) {
      dshToastStore.update((state) => {
        state.toast = {
          id: ++dshToastSeq,
          kind,
          text,
        };
      });
    }
    /** Toast host: renders the current toast in the frame-wide overlay seat. */
    function DesktopUiToastHost({ useToastState }) {
      const toast = useToastState((state) => state.toast);
      react.useEffect(() => {
        if (toast === null) return;
        const timer = setTimeout(() => {
          dshToastStore.update((state) => {
            state.toast = null;
          });
        }, 3200);
        return () => {
          clearTimeout(timer);
        };
      }, [toast]);
      if (toast === null) return null;
      /* Body portal so a transformed/filtered ancestor cannot trap the
			fixed banner below the app's own overlays. */
      return react_dom.createPortal(
        (0, react_jsx_runtime.jsxs)("div", {
          className: "dduiToast",
          "data-kind": toast.kind,
          role: "status",
          children: [
            (0, react_jsx_runtime.jsx)("span", {
              className: "dduiToastIcon",
              "aria-hidden": "true",
              children:
                toast.kind === "error"
                  ? (0, react_jsx_runtime.jsx)(
                      _deepseek_ai_dsh_client_ui_primitives.IconWarningOutline16,
                      { size: 14 },
                    )
                  : (0, react_jsx_runtime.jsx)(
                      _deepseek_ai_dsh_client_ui_primitives.IconCheckOutline16,
                      { size: 14 },
                    ),
            }),
            (0, react_jsx_runtime.jsx)("span", {
              className: "dduiToastText",
              children: toast.text,
            }),
          ],
        }),
        document.body,
      );
    }
    //#endregion

    //#region 右键菜单（自 dsh-desktop-ui 迁移）
    // 右键菜单：输入框剪切/复制/粘贴/全选、工作区右键打开文件夹、选中内容复制
    /** Right-click / selection-copy styles. */
    const ctxCss =
      ".dduiCtx{box-sizing:border-box;position:fixed;z-index:3000;min-width:132px;padding:3px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);box-shadow:var(--dsw-shadow-lv3);border-radius:8px;flex-direction:column;gap:1px;margin:0;list-style:none;display:flex;animation:dduiCtxIn .12s ease-out}.dduiCtx button{box-sizing:border-box;width:100%;min-height:26px;color:var(--dsw-alias-label-primary);text-align:left;cursor:pointer;background:0 0;border:0;border-radius:6px;align-items:center;gap:8px;padding:4px 8px;font:inherit;font-size:12px;line-height:18px;display:flex}.dduiCtx button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.dduiCtx button:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}.dduiCtxSep{height:1px;background:var(--dsw-alias-border-l2);flex:none;margin:3px 6px}@keyframes dduiCtxIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}";
    const ctxTagId = "dsh-desktop-context-menu/ContextMenu.module.css";
    const installCtxCss = () => dduiInstallCss(ctxCss, ctxTagId);
    /** Floating surface state: the right-click menu (with its copy payload). */
    const dshFloatStore = (0,
    _deepseek_ai_dsh_client_runtime_client.createSnapshotStore)({
      menu: null,
    });
    /** Workspace directory open handler installed by apply(); runContextAction dispatches into it. */
    let desktopOpenWorkspacePath = null;
    /** Show the right-click menu at a viewport point, flipping near the edges. */
    function showFloatingMenu(x, y, items, target, payload) {
      const itemHeight = 26;
      const pad = 3;
      const gap = 1;
      const width = 132;
      const height =
        items.length * itemHeight + (items.length - 1) * gap + pad * 2 + 2;
      const left =
        x + width > window.innerWidth - 8 ? Math.max(8, x - width) : x;
      const top =
        y + 6 + height > window.innerHeight - 8
          ? Math.max(8, y - 6 - height)
          : y + 6;
      dshFloatStore.update((state) => {
        state.menu = { x: left, y: top, items, target, payload };
      });
    }
    /** Hide the right-click menu (if any). */
    function hideFloatingMenu() {
      dshFloatStore.update((state) => {
        state.menu = null;
      });
    }
    /** The floating host: renders the right-click menu above everything. */
    function DesktopUiFloatHost({ useFloatState }) {
      const { menu } = useFloatState((state) => state);
      react.useEffect(() => {
        if (menu === null) return;
        const onKeyDown = (event) => {
          if (event.key === "Escape") hideFloatingMenu();
        };
        const onScroll = () => hideFloatingMenu();
        document.addEventListener("keydown", onKeyDown, true);
        document.addEventListener("scroll", onScroll, true);
        return () => {
          document.removeEventListener("keydown", onKeyDown, true);
          document.removeEventListener("scroll", onScroll, true);
        };
      }, [menu]);
      if (menu === null) return null;
      const menuStyle =
        menu === null
          ? void 0
          : {
              left: menu.x,
              top: menu.y,
            };
      return react_dom.createPortal(
        (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
          children: [
            menu !== null
              ? (0, react_jsx_runtime.jsx)("ul", {
                  className: "dduiCtx",
                  role: "menu",
                  style: menuStyle,
                  onMouseDown: (event) => {
                    event.preventDefault();
                  },
                  children: menu.items.map((item) =>
                    item.sep === true
                      ? (0, react_jsx_runtime.jsx)("li", {
                          className: "dduiCtxSep",
                          "aria-hidden": "true",
                        })
                      : (0, react_jsx_runtime.jsx)(
                          "li",
                          {
                            children: (0, react_jsx_runtime.jsx)("button", {
                              type: "button",
                              role: "menuitem",
                              disabled: item.disabled === true,
                              onClick: () => {
                                runContextAction(item.id);
                              },
                              children: item.label,
                            }),
                          },
                          item.id,
                        ),
                  ),
                })
              : null,
          ],
        }),
        document.body,
      );
    }
    /** Locate the composer textarea (the app's chip-aware input). */
    function composerTextarea() {
      return document.querySelector("[data-composer-card] textarea");
    }
    /** Paste the clipboard text into any input: the composer uses the app pipeline, others insert directly. */
    async function pasteIntoField(field) {
      if (typeof navigator === "undefined" || navigator.clipboard === void 0) {
        showDesktopToast("error", "无法访问剪贴板");
        return;
      }
      let text;
      try {
        text = await navigator.clipboard.readText();
      } catch (error) {
        showDesktopToast("error", "无法读取剪贴板（权限被拒绝）");
        return;
      }
      if (text === "") {
        showDesktopToast("error", "剪贴板为空");
        return;
      }
      if (field.closest("[data-composer-card]") !== null) {
        const dataTransfer = new DataTransfer();
        dataTransfer.setData("text/plain", text);
        field.dispatchEvent(
          new ClipboardEvent("paste", {
            clipboardData: dataTransfer,
            bubbles: true,
            cancelable: true,
          }),
        );
        return;
      }
      field.focus();
      document.execCommand("insertText", false, text);
    }
    /** Execute one context-menu action against its target field. */
    function runContextAction(id) {
      const snapshot = dshFloatStore.getSnapshot();
      const menu = snapshot.menu;
      hideFloatingMenu();
      if (id === "openInExplorer") {
        const path =
          menu !== null && menu.payload !== void 0
            ? menu.payload.workspacePath
            : void 0;
        if (
          typeof path === "string" &&
          path !== "" &&
          desktopOpenWorkspacePath !== null
        ) {
          desktopOpenWorkspacePath(path);
        }
        return;
      }
      if (id === "reload") {
        globalThis.location?.reload();
        return;
      }
      if (id === "copySel") {
        const payload =
          menu !== null && menu.payload !== void 0 ? menu.payload : null;
        if (payload === null) return;
        if (
          payload.imageSrc !== null &&
          payload.imageSrc !== void 0 &&
          payload.imageSrc !== ""
        ) {
          void copyImageSource(payload.imageSrc).then((kind) => {
            if (kind === "image") showDesktopToast("success", "已复制图片");
            else if (kind === "url")
              showDesktopToast("success", "已复制图片地址");
          });
          return;
        }
        if (
          payload.text !== null &&
          payload.text !== void 0 &&
          payload.text.trim() !== ""
        ) {
          (0, _deepseek_ai_dsh_client_ui_primitives.writeClipboard)(
            payload.text,
          ).then((ok) => {
            if (ok) showDesktopToast("success", "已复制");
          });
        }
        return;
      }
      const field =
        menu !== null && menu.target !== void 0
          ? menu.target
          : composerTextarea();
      if (field === null || typeof field.focus !== "function") return;
      field.focus();
      if (id === "selectAll") {
        field.select();
        return;
      }
      if (id === "paste") {
        void pasteIntoField(field);
        return;
      }
      if (id === "cut") {
        document.execCommand("cut");
        showDesktopToast("success", "已剪切");
        return;
      }
      if (id === "copy") {
        document.execCommand("copy");
        showDesktopToast("success", "已复制");
      }
    }
    /** Copy an image: bitmap when the clipboard API allows it, otherwise its URL. */
    async function copyImageSource(src) {
      if (
        typeof ClipboardItem !== "undefined" &&
        typeof navigator !== "undefined" &&
        navigator.clipboard !== void 0
      ) {
        try {
          const response = await fetch(src);
          if (response.ok) {
            const blob = await response.blob();
            await navigator.clipboard.write([
              new ClipboardItem({ "image/png": blob }),
            ]);
            return "image";
          }
        } catch (error) {
          /* fall through to the URL copy */
        }
      }
      const ok = await (0,
      _deepseek_ai_dsh_client_ui_primitives.writeClipboard)(src);
      return ok ? "url" : "";
    }
    /**
     * Install the right-click behaviors.
     * @param options.t - bound locale lookup for the workspace row's menu labels.
     * @param options.resolveWorkspacePath - map a workspace row label to its directory path.
     * @param options.openWorkspacePath - open one workspace directory (host.openPath).
     */
    function installChatContextMenu({
      t,
      resolveWorkspacePath,
      openWorkspacePath,
    } = {}) {
      desktopOpenWorkspacePath = openWorkspacePath ?? null;
      const FIELD_SELECTOR =
        'textarea, input[type="text"], input[type="search"], input:not([type])';
      const onContextMenu = (event) => {
        const target = event.target;
        if (typeof target?.closest !== "function") return;
        // Workspace rows in the sidebar tree carry aria-expanded (session
        // rows carry aria-selected instead), so the treeitem + expanded
        // pair pins the workspace folder rows exactly.
        const workspaceRow = target.closest('[role="treeitem"][aria-expanded]');
        if (workspaceRow !== null) {
          const label = (workspaceRow.textContent ?? "").trim();
          const path = resolveWorkspacePath(label);
          if (path !== void 0) {
            event.preventDefault();
            event.stopImmediatePropagation();
            showFloatingMenu(
              event.clientX,
              event.clientY,
              [{ id: "openInExplorer", label: t("openWorkspace") }],
              void 0,
              { workspacePath: path },
            );
          }
          return;
        }
        const field = target.closest(FIELD_SELECTOR);
        if (field !== null) {
          event.preventDefault();
          event.stopImmediatePropagation();
          const readOnly = field.readOnly === true || field.disabled === true;
          const start =
            typeof field.selectionStart === "number" ? field.selectionStart : 0;
          const end =
            typeof field.selectionEnd === "number" ? field.selectionEnd : 0;
          const selected = start !== end;
          const hasText = String(field.value ?? "").length > 0;
          showFloatingMenu(
            event.clientX,
            event.clientY,
            [
              { id: "cut", label: "剪切", disabled: !selected || readOnly },
              { id: "copy", label: "复制", disabled: !selected },
              { id: "paste", label: "粘贴", disabled: readOnly },
              { id: "selectAll", label: "全选", disabled: !hasText },
              { id: "sep", sep: true },
              { id: "reload", label: "刷新", disabled: false },
            ],
            field,
          );
          return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        let copyText = "";
        const selection = window.getSelection();
        if (
          selection !== null &&
          !selection.isCollapsed &&
          selection.rangeCount > 0
        ) {
          const text = selection.toString();
          if (text.trim() !== "") copyText = text;
        }
        let copyImageSrc = "";
        const imageEl = target.closest("img");
        if (imageEl !== null)
          copyImageSrc = imageEl.currentSrc || imageEl.src || "";
        const canCopy = copyText !== "" || copyImageSrc !== "";
        showFloatingMenu(
          event.clientX,
          event.clientY,
          [
            { id: "copySel", label: "复制", disabled: !canCopy },
            { id: "sep", sep: true },
            { id: "reload", label: "刷新", disabled: false },
          ],
          void 0,
          { text: copyText, imageSrc: copyImageSrc },
        );
      };
      const onPointerDown = (event) => {
        const target = event.target;
        if (typeof target?.closest !== "function") return;
        if (target.closest(".dduiCtx") !== null) return;
        hideFloatingMenu();
      };
      document.addEventListener("contextmenu", onContextMenu, true);
      document.addEventListener("pointerdown", onPointerDown, true);
      return () => {
        document.removeEventListener("contextmenu", onContextMenu, true);
        document.removeEventListener("pointerdown", onPointerDown, true);
        hideFloatingMenu();
      };
    }
    //#endregion

    //#region 功能增强数据接口
    /**
     * 「功能增强」卡片中的「右键菜单」数据接口（desktop.features.item）：
     * 只提供 load/save/title/description，开关渲染与保存由功能增强卡片统一完成。
     */
    function contextMenuFeatureFace(t) {
      return {
        load: () => loadConfig().then((config) => config.enabled),
        save: (enabled) => saveConfig({ enabled }),
        title: t("feature.title"),
        description: t("feature.description"),
      };
    }
    //#endregion

    //#region 词典
    const NS = "desktop-context-menu";
    const zh = {
      "feature.title": "右键菜单",
      "feature.description": "右键输入框可剪切 / 复制 / 粘贴 / 全选；右键工作区可打开所在文件夹；右键选中内容可直接复制",
      "openWorkspace": "在资源管理器中打开",
      "openWorkspace.error": "无法打开工作区目录",
    };
    const en = {
      "feature.title": "Context menu",
      "feature.description": "Right-click inputs for cut / copy / paste / select-all, workspaces to open their folder, and selections to copy",
      "openWorkspace": "Open in Explorer",
      "openWorkspace.error": "Could not open the workspace directory",
    };
    //#endregion

    //#region 入口
    /** 所需客户端服务。 */
    const inject = ["slots", "locale"];
    /**
     * 插件入口：
     *   - 「功能增强」卡片开关项（desktop.features.item）始终注册；
     *   - toast + 浮层 + 右键事件按 enabled 开关安装/移除。
     */
    function apply(ctx) {
      const t = ctx.locale.bind(NS);
      ctx.effect(
        () =>
          ctx.locale.register(NS, {
            zh,
            en,
          }),
        "dsh-desktop-context-menu: dictionaries",
      );
      // 功能增强卡片子项（always-on：数据接口永远可调）。
      ctx.slots.inject("desktop.features.item", () =>
        ctx.slots.register(
          {
            name: "desktop.features.item",
            id: "context-menu",
            order: 30,
            locale: NS,
            inject: () => contextMenuFeatureFace(t),
          },
          // 该槽位由「功能增强」卡片消费数据接口，不渲染组件。
          () => null,
        ),
      );
      const installFeature = (config) => {
        const disposers = [];
        const install = (fn) => {
          const dispose = fn();
          if (typeof dispose === "function") disposers.push(dispose);
        };
        if (config.enabled) {
          install(() => installCtxCss());
          install(() =>
            ctx.slots.inject("shell.overlay", () =>
              ctx.slots.register(
                {
                  name: "shell.overlay",
                  id: "dsh-desktop-context-menu-toast",
                  inject: () => ({ hooks: { toastState: dshToastStore } }),
                },
                DesktopUiToastHost,
              ),
            ),
          );
          install(() =>
            ctx.slots.inject("shell.overlay", () =>
              ctx.slots.register(
                {
                  name: "shell.overlay",
                  id: "dsh-desktop-context-menu-float",
                  inject: () => ({ hooks: { floatState: dshFloatStore } }),
                },
                DesktopUiFloatHost,
              ),
            ),
          );
          install(() =>
            ctx.effect(
              () =>
                installChatContextMenu({
                  t,
                  resolveWorkspacePath: (label) => {
                    const workspaces = ctx.get("workspaces");
                    if (workspaces === void 0) return void 0;
                    const items = workspaces.list.getSnapshot().items;
                    const match = items.find(
                      (item) =>
                        item.title === label ||
                        String(item.path ?? "")
                          .replace(/[/\\]+$/, "")
                          .split(/[/\\]/)
                          .pop() === label,
                    );
                    return match === void 0 ? void 0 : match.path;
                  },
                  openWorkspacePath: (path) => {
                    const workspaces = ctx.get("workspaces");
                    if (workspaces === void 0) return;
                    workspaces.openPath(path).catch(() => {
                      showDesktopToast("error", t("openWorkspace.error"));
                    });
                  },
                }),
              "dsh-desktop-context-menu: chat context menu",
            ),
          );
        }
        return disposers;
      };
      let active = [];
      const applyConfig = (config) => {
        for (const dispose of active) dispose();
        active = installFeature(config);
      };
      applyConfig({ ...dduDefaultConfig });
      void loadConfig().then((config) => {
        applyConfig(config);
      });
    }
    //#endregion

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});

