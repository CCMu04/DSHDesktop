/**
 * dsh-desktop-ui — browser half.
 *
 * 「视觉增强」：桌面壳的纯视觉定制（不改变官方能力）。每个功能带开关
 * （config.js），开关值由 host 端 /api/desktop-ui/config 提供，在设置页
 * 「视觉增强」卡片（config-card.js）里编辑。
 *
 * Feature inventory（顺序即卡片行序）:
 *   settingsDrawer   — settings panel as a left-side drawer (CSS + close shim)
 *   sessionLogExport — 「导出会话」button next to the session title
 *   statsLine        — full-width centered composer dock stats row
 *
 * 功能增强（逻辑类）已拆分为独立插件：dsh-desktop-plugin-list（插件列表）、
 * dsh-desktop-context-menu（右键菜单）、dsh-desktop-updates（检查更新），
 * 各自带 host/client 两半，开关收纳在「功能增强」聚合卡片里。
 *
 * Wiring (index.js region):
 *   apply() registers the dictionaries, then installFeatures(config) per
 *   snapshot: everything on first so the UI never renders featureless,
 *   converging to the persisted configuration as soon as it arrives. Each
 *   feature install returns a disposer, so re-applying swaps features cleanly.
 *
 * This file is a module-loader bundle (window.__ModuleLoader__), same shape
 * as the official web client bundles; keep the factory export contract.
 */
window.__ModuleLoader__.load({
  id: "dsh-desktop-ui",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react_jsx_runtime = require("react/jsx-runtime");
    let react = require("react");
    let react_dom = require("react-dom");
    let _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime/client");
    let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
    //#region lib/client/config.js
    /**
     * Feature-switch config, shared with the host half (lib/index.js keeps the
     * same DEFAULT_CONFIG / CONFIG_KEYS contract). The server composes
     * defaults <- plugin row config <- $DSH_HOME/desktop-ui.json; the browser
     * only ever reads the composed result through the HTTP API.
     */
    /** Every feature switch and its default state (all on). 顺序即卡片行序。 */
    const dduiDefaultConfig = {
      settingsDrawer: true,
      sessionLogExport: true,
      statsLine: true,
    };
    /** Feature keys in stable order (also the settings-card row order). */
    const dduiConfigKeys = Object.keys(dduiDefaultConfig);
    /** Narrow an unknown server body to the boolean fields we own. */
    function dduiNarrowConfig(body) {
      const out = { ...dduiDefaultConfig };
      if (body && typeof body === "object") {
        for (const key of dduiConfigKeys) {
          if (typeof body[key] === "boolean") out[key] = body[key];
        }
      }
      return out;
    }
    /** Fetch the effective configuration; any failure falls back to all-on. */
    function loadDesktopUiConfig() {
      return fetch("/api/desktop-ui/config", {
        headers: { accept: "application/json" },
        cache: "no-store",
      })
        .then((res) =>
          res.ok
            ? res.json()
            : Promise.reject(new Error("config-http-" + res.status)),
        )
        .then((body) => dduiNarrowConfig(body))
        .catch(() => ({ ...dduiDefaultConfig }));
    }
    /** POST a full config section; resolves to whether the write was accepted. */
    function saveDesktopUiConfig(config) {
      return fetch("/api/desktop-ui/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(config),
      }).then((res) => res.ok);
    }
    //#endregion
    //#region styles
    // 样式表：每个功能的 CSS 随功能开关一起安装/移除（dduiInstallCss）
    /** Inject one plugin style tag; the returned disposer removes it. Feature styles are installed with their feature so a disabled switch removes the visual change too. */
    const dduiInstallCss = (cssText, styleTagId) => {
      if (
        typeof document === "undefined" ||
        document.querySelector(
          "style[data-plugin-css=" + JSON.stringify(styleTagId) + "]",
        ) !== null
      )
        return () => {};
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-desktop-ui";
      tag.dataset.pluginCss = styleTagId;
      tag.textContent = cssText;
      document.head.appendChild(tag);
      return () => tag.remove();
    };
    const css =
      ".dshDesktopUi_trigger{min-height:28px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:0;border-radius:6px;align-items:center;gap:3px;padding:3px 2px;font-size:12px;line-height:18px;display:inline-flex}.dshDesktopUi_trigger:hover:not(:disabled),.dshDesktopUi_trigger:focus-visible{color:var(--dsw-alias-label-secondary)}.dshDesktopUi_trigger:disabled{color:var(--dsw-alias-label-dimmed);cursor:wait}.dshDesktopUi_trigger svg,.dshDesktopUi_trigger span{flex:none}.dshDesktopUi_trigger span{white-space:nowrap}";
    const tagId = "dsh-desktop-ui/HeaderAction.module.css";
    const installHeaderActionCss = () => dduiInstallCss(css, tagId);
    //#endregion
    //#region lib/client/settings-drawer.js
    // 设置抽屉：官方居中设置弹窗改为左侧滑出面板（CSS + 关闭动画 shim）
    /**
     * Turn the shipped centered settings modal into a left-side drawer via CSS.
     * The shipped settings panel is
     * `div[role="presentation"] > div[role="dialog"][aria-modal="true"][aria-labelledby]`
     * (the primitives Modal uses `aria-label`, so it stays untouched): the
     * shipped mask stays visible (dim + blur, with a fade-in), the panel docks
     * to the left edge at full height with a slide-in animation. Clicking the
     * mask or pressing Escape closes; the close shim plays the slide-out first.
     */
    const drawerCss =
      'div[role="presentation"]:has(> div[role="dialog"][aria-modal="true"][aria-labelledby]) > div[aria-hidden="true"]{animation:dduiMaskFadeIn .22s ease-out !important}@keyframes dduiMaskFadeIn{from{opacity:0}to{opacity:1}}div[role="presentation"]:has(> div[role="dialog"][aria-modal="true"][aria-labelledby]) > div[aria-hidden="true"].ddui_closing{animation:dduiMaskFadeOut .22s ease-out forwards !important}@keyframes dduiMaskFadeOut{from{opacity:1}to{opacity:0}}div[role="presentation"] > div[role="dialog"][aria-modal="true"][aria-labelledby]{position:fixed !important;top:0 !important;left:0 !important;bottom:0 !important;right:auto !important;width:min(720px,100vw) !important;max-width:min(720px,100vw) !important;height:100vh !important;max-height:100vh !important;margin:0 !important;border-radius:0 24px 24px 0 !important;animation:dduiSettingsSlideIn .22s ease-out !important}@keyframes dduiSettingsSlideIn{from{transform:translateX(-100%)}to{transform:translateX(0)}}div[role="presentation"] > div[role="dialog"][aria-modal="true"][aria-labelledby].ddui_closing{animation:dduiSettingsSlideOut .22s ease-out forwards !important}@keyframes dduiSettingsSlideOut{from{transform:translateX(0)}to{transform:translateX(-100%)}}';
    const drawerTagId = "dsh-desktop-ui/SettingsDrawer.module.css";
    const installDrawerCss = () => dduiInstallCss(drawerCss, drawerTagId);
    /**
     * Close-animation shim: the shipped settings root unmounts the panel
     * instantly on close and CSS cannot animate an unmounted element. This shim
     * intercepts the real close paths (close button, a genuine mask click, and
     * Escape) in the capture phase, plays the slide-out animation, then
     * completes the close through the shipped handlers (re-dispatching the
     * original event, a synthetic click on the mask, or the Escape key). The
     * panel's structural layout mirrors the shipped SettingsPanel DOM.
     */
    function installSettingsDrawerShim() {
      const panelSelector =
        'div[role="presentation"] > div[role="dialog"][aria-modal="true"][aria-labelledby]';
      let pending = null;
      let bypassing = false;
      const finishClose = () => {
        const task = pending;
        pending = null;
        if (task === null) return;
        task.panel.classList.remove("ddui_closing");
        const overlay = task.panel.parentElement;
        const mask = overlay === null ? null : overlay.children[0];
        if (mask !== null) mask.classList.remove("ddui_closing");
        bypassing = true;
        try {
          if (task.mode === "keydown") {
            document.dispatchEvent(
              new KeyboardEvent("keydown", {
                key: task.key,
                bubbles: true,
                cancelable: true,
              }),
            );
          } else if (task.mode === "outside") {
            const overlay = task.panel.parentElement;
            const mask = overlay === null ? null : overlay.children[0];
            if (mask !== null)
              mask.dispatchEvent(
                new MouseEvent("click", { bubbles: true, cancelable: true }),
              );
          } else {
            task.target.dispatchEvent(
              new MouseEvent(task.type, { bubbles: true, cancelable: true }),
            );
          }
        } finally {
          bypassing = false;
        }
      };
      const playClose = (panel, event, mode) => {
        if (pending !== null) return;
        panel.classList.add("ddui_closing");
        const overlay = panel.parentElement;
        const mask = overlay === null ? null : overlay.children[0];
        if (mask !== null) mask.classList.add("ddui_closing");
        pending = {
          panel,
          target: event.target,
          type: event.type,
          key: event.key,
          mode,
        };
        setTimeout(finishClose, 240);
      };
      const onClickCapture = (event) => {
        if (bypassing || pending !== null) return;
        const panel =
          typeof event.target?.closest === "function"
            ? event.target.closest(panelSelector)
            : void 0;
        if (panel !== void 0 && panel !== null) {
          const overlay = panel.parentElement;
          const mask = overlay === null ? void 0 : overlay.children[0];
          const content = panel.children[1];
          const header = content === void 0 ? void 0 : content.children[0];
          const closeButton =
            header === void 0 ? void 0 : header.lastElementChild;
          const isClose =
            closeButton !== void 0 &&
            closeButton !== null &&
            closeButton.contains(event.target);
          const isMask = mask !== void 0 && event.target === mask;
          if (!isClose && !isMask) return;
          event.stopImmediatePropagation();
          playClose(panel, event, "target");
          return;
        }
        const openPanel = document.querySelector(panelSelector);
        if (openPanel === null) return;
        const overlay = openPanel.parentElement;
        const mask = overlay === null ? void 0 : overlay.children[0];
        // Only genuine mask clicks close the drawer. Clicks on portaled
        // UI rendered above the mask (dropdown popups, preset view
        // dialogs, ...) must reach their own handlers, not close the
        // settings page.
        if (mask === void 0 || event.target !== mask) return;
        event.stopImmediatePropagation();
        playClose(openPanel, event, "outside");
      };
      const onKeyDownCapture = (event) => {
        if (bypassing || pending !== null) return;
        if (event.key !== "Escape") return;
        const panel = document.querySelector(panelSelector);
        if (panel === null) return;
        event.stopImmediatePropagation();
        playClose(panel, event);
      };
      document.addEventListener("click", onClickCapture, true);
      document.addEventListener("keydown", onKeyDownCapture, true);
      return () => {
        document.removeEventListener("click", onClickCapture, true);
        document.removeEventListener("keydown", onKeyDownCapture, true);
      };
    }
    //#endregion
    //#region lib/client/stats-line.js
    // 统计行样式：输入框下方统计信息占满整行居中、不截断
    /** Bottom stats line (conversation.composer.dock / StatsLine): use the whole
		dock width instead of the chat column, stay centered, and wrap instead of
		truncating with an ellipsis. The primary selector is the slot outlet's
		stable `data-slot` attribute (every slot renders a `<div data-slot=...>`);
		the hashed `.FJxK0a_root` module class is kept as a fallback in case the
		outlet markup ever changes. */
    const statsCss =
      'div[data-slot="conversation.composer.dock"]>div,.FJxK0a_root{box-sizing:border-box;width:100%!important;max-width:none!important;margin:0 auto!important;text-align:center!important;white-space:normal!important;overflow:visible!important;text-overflow:clip!important}';
    const statsTagId = "dsh-desktop-ui/StatsLine.module.css";
    const installStatsCss = () => dduiInstallCss(statsCss, statsTagId);
    //#endregion
    //#endregion
    //#region lib/client/Dialog.js
    // 会话导出下载对话框（镜像官方文案）
    /** Modal mirroring the shipped Session-log download dialog (same strings, own locale namespace). */
    function SessionLogDownloadDialog({
      sessionId,
      useSessionLogDownload,
      dismiss,
      t,
    }) {
      const entry = useSessionLogDownload(
        (state) => state.bySession[String(sessionId)],
      );
      const status = entry?.status;
      const open = entry?.open === true;
      const error =
        status === "error" ? entry?.error || t("dialog.commandFailed") : null;
      return (0, react_jsx_runtime.jsx)(
        _deepseek_ai_dsh_client_ui_primitives.Modal,
        {
          open,
          onClose: () => {
            dismiss(sessionId);
          },
          title:
            status === "downloading"
              ? t("dialog.preparingTitle")
              : status === "success"
                ? t("dialog.successTitle")
                : t("dialog.errorTitle"),
          description:
            status === "downloading"
              ? t("dialog.preparingDescription")
              : status === "success"
                ? t("dialog.successDescription")
                : (error ?? t("dialog.commandFailed")),
          closeLabel: t("dialog.close"),
          footer: (0, react_jsx_runtime.jsx)(
            _deepseek_ai_dsh_client_ui_primitives.Button,
            {
              variant: "primary",
              onClick: () => {
                dismiss(sessionId);
              },
              children: t("dialog.close"),
            },
          ),
        },
      );
    }
    //#endregion
    //#region lib/client/HeaderAction.js
    // 「导出会话」按钮：会话标题旁的文字按钮 + 下载对话框
    /** Ghost-text header action (icon first) plus the shared download dialog. */
    function ExportMoveHeaderAction(props) {
      const { sessionId, useSessionLogDownload, request, t } = props;
      const busy =
        useSessionLogDownload((state) => state.bySession[String(sessionId)])
          ?.status === "downloading";
      return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
        children: [
          (0, react_jsx_runtime.jsxs)("button", {
            type: "button",
            className: "dshDesktopUi_trigger",
            disabled: busy,
            "aria-busy": busy,
            onClick: () => {
              request(sessionId);
            },
            children: [
              (0, react_jsx_runtime.jsx)(
                _deepseek_ai_dsh_client_ui_primitives.IconDownloadOutline16,
                { size: 12 },
              ),
              (0, react_jsx_runtime.jsx)("span", {
                children: t("trigger.label"),
              }),
            ],
          }),
          (0, react_jsx_runtime.jsx)(SessionLogDownloadDialog, { ...props }),
        ],
      });
    }
    //#endregion
    //#region lib/client/locales.js
    // 中英文案词典（命名空间 NS = "desktop-ui"）
    /** Locale namespace owned by this customization (mirrors the shipped strings). */
    const NS = "desktop-ui";
    const zh = {
      "trigger.label": "导出会话",
      "dialog.preparingTitle": "正在导出 Session",
      "dialog.preparingDescription":
        "正在准备包含当前 Session、子 Session 和附件的 ZIP 文件。",
      "dialog.successTitle": "Session 导出已开始下载",
      "dialog.successDescription": "浏览器正在下载 Session ZIP 文件。",
      "dialog.errorTitle": "Session 导出失败",
      "dialog.close": "关闭",
      "dialog.commandFailed": "无法启动 Session 导出。",
      "plugin.enabled": "已启用",
      "plugin.disabled": "已停用",
      "config.title": "视觉增强",
      "config.description":
        "选择需要启用的视觉增强，保存后页面自动刷新。",
      "config.loading": "正在读取配置…",
      "config.loadFailed": "无法读取视觉增强配置。",
      "config.save": "保存",
      "config.saving": "保存中…",
      "config.reset": "重置",
      "config.saveFailed": "保存失败，请重试。",
      "config.settingsDrawer": "设置抽屉",
      "config.settingsDrawer.desc": "打开设置时从左侧滑出面板，取代居中的弹窗",
      "config.sessionLogExport": "会话日志导出",
      "config.sessionLogExport.desc":
        "在会话标题旁显示「导出会话」按钮，一键打包当前会话",
      "config.statsLine": "统计栏",
      "config.statsLine.desc": "输入框下方的统计信息占满整行居中显示，不被截断",
    };
    const en = {
      "trigger.label": "Session log",
      "dialog.preparingTitle": "Exporting Session",
      "dialog.preparingDescription":
        "Preparing a ZIP containing this Session, its sub-Sessions, and attachments.",
      "dialog.successTitle": "Session download started",
      "dialog.successDescription":
        "The browser is downloading the Session ZIP.",
      "dialog.errorTitle": "Session export failed",
      "dialog.close": "Close",
      "dialog.commandFailed": "Could not start the Session export.",
      "plugin.enabled": "Enabled",
      "plugin.disabled": "Disabled",
      "config.title": "Visual enhancements",
      "config.description":
        "Choose which visual enhancements stay enabled. The page reloads after saving.",
      "config.loading": "Reading configuration…",
      "config.loadFailed":
        "Could not read the visual enhancement configuration.",
      "config.save": "Save",
      "config.saving": "Saving…",
      "config.reset": "Reset",
      "config.saveFailed": "Save failed, please try again.",
      "config.settingsDrawer": "Settings drawer",
      "config.settingsDrawer.desc":
        "Open settings as a slide-in panel from the left instead of a centered modal",
      "config.sessionLogExport": "Session log export",
      "config.sessionLogExport.desc":
        "Show an Export Session button next to the session title to package the session in one click",
      "config.statsLine": "Stats line",
      "config.statsLine.desc":
        "Show the stats row under the input full-width and centered, without truncation",
    };
    //#endregion
    //#region lib/client/config-card.js
    // 设置页「视觉增强」配置卡片：3 个开关 + 重置 + 保存（样式对齐官方插件配置卡片）
    // 卡片样式（常驻注入，卡片本身无开关）。
    const configCardCss =
      ".dduiC_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}.dduiC_card:hover{border-color:var(--dsw-alias-label-dimmed)}.dduiC_cardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}.dduiC_header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}.dduiC_header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}.dduiC_headText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}.dduiC_name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}.dduiC_description{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}.dduiC_chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}.dduiC_chevronOpen{transform:rotate(180deg)}.dduiC_body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}.dduiC_field{flex-direction:column;gap:6px;padding:12px 0;display:flex}.dduiC_field+.dduiC_field{border-top:1px solid var(--dsw-alias-border-l2)}.dduiC_head{align-items:center;gap:8px;display:flex}.dduiC_label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}.dduiC_badges{align-items:center;gap:8px;display:inline-flex}.dduiC_badge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}.dduiC_badgeMuted{white-space:nowrap;color:var(--dsw-alias-label-tertiary);border-radius:999px;padding:1px 8px;font-size:11px;line-height:17px}.dduiC_switch{accent-color:var(--dsw-alias-brand-primary);flex:none;width:16px;height:16px;margin:0;cursor:pointer}.dduiC_hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}.dduiC_footer{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}.dduiC_failed{min-width:0;color:var(--dsw-alias-label-error);flex:1;margin:0;font-size:12px;line-height:1.5}.dduiC_discard,.dduiC_save{appearance:none;font:inherit;cursor:pointer;border:1px solid #0000;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}.dduiC_discard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}.dduiC_discard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}.dduiC_save{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}.dduiC_discard:disabled,.dduiC_save:disabled{opacity:.4;cursor:default}.dduiC_discard:focus-visible,.dduiC_save:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}";
    const configCardTagId = "dsh-desktop-ui/ConfigCard.module.css";
    dduiInstallCss(configCardCss, configCardTagId);
    /** Settings card editing the desktop-ui feature switches (reads/writes the host config API). DOM mirrors the official plugin-configuration card: header (name + description + pending badge + chevron), fields (label + status badge + control + hint), footer (failed note + reset + save). */
    function DesktopUiConfigCard({ t }) {
      const [state, setState] = react.useState({
        status: "loading",
        config: null,
        draft: null,
      });
      const [open, setOpen] = react.useState(false);
      const [saving, setSaving] = react.useState(false);
      const [failed, setFailed] = react.useState(null);
      react.useEffect(() => {
        let current = true;
        loadDesktopUiConfig().then(
          (config) => {
            if (current)
              setState({ status: "ready", config, draft: { ...config } });
          },
          () => {
            if (current) setState({ status: "error" });
          },
        );
        return () => {
          current = false;
        };
      }, []);
      const toggle = (key) => {
        setState((snapshot) =>
          snapshot.status === "ready"
            ? {
                ...snapshot,
                draft: { ...snapshot.draft, [key]: !snapshot.draft[key] },
              }
            : snapshot,
        );
      };
      const save = () => {
        if (state.status !== "ready" || saving) return;
        setSaving(true);
        setFailed(null);
        saveDesktopUiConfig(state.draft).then(
          (ok) => {
            if (ok) {
              globalThis.location.reload();
              return;
            }
            setSaving(false);
            setFailed("config.saveFailed");
          },
          () => {
            setSaving(false);
            setFailed("config.saveFailed");
          },
        );
      };
      const reset = () => {
        if (state.status !== "ready" || saving) return;
        setState({ ...state, draft: { ...dduiDefaultConfig } });
      };
      return (0, react_jsx_runtime.jsxs)("div", {
        className: open ? "dduiC_card dduiC_cardOpen" : "dduiC_card",
        children: [
          (0, react_jsx_runtime.jsxs)("button", {
            type: "button",
            className: "dduiC_header",
            "aria-expanded": open,
            onClick: () => {
              setOpen((value) => !value);
            },
            children: [
              (0, react_jsx_runtime.jsxs)("span", {
                className: "dduiC_headText",
                children: [
                  (0, react_jsx_runtime.jsx)("span", {
                    className: "dduiC_name",
                    children: t("config.title"),
                  }),
                  (0, react_jsx_runtime.jsx)("span", {
                    className: "dduiC_description",
                    children: t("config.description"),
                  }),
                ],
              }),
              (0, react_jsx_runtime.jsx)(
                _deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutline14,
                {
                  className: open
                    ? "dduiC_chevron dduiC_chevronOpen"
                    : "dduiC_chevron",
                  size: 14,
                  "aria-hidden": "true",
                },
              ),
            ],
          }),
          open
            ? (0, react_jsx_runtime.jsxs)("div", {
                className: "dduiC_body",
                children: [
                  state.status === "loading"
                    ? (0, react_jsx_runtime.jsx)("p", {
                        className: "dduiC_hint",
                        children: t("config.loading"),
                      })
                    : state.status === "error"
                      ? (0, react_jsx_runtime.jsx)("p", {
                          className: "dduiC_hint",
                          children: t("config.loadFailed"),
                        })
                      : (0, react_jsx_runtime.jsxs)(
                          react_jsx_runtime.Fragment,
                          {
                            children: [
                              (0, react_jsx_runtime.jsx)("div", {
                                className: "dduiC_fields",
                                children: dduiConfigKeys.map((key) =>
                                  (0, react_jsx_runtime.jsxs)("div", {
                                    className: "dduiC_field",
                                    key: key,
                                    children: [
                                      (0, react_jsx_runtime.jsxs)("div", {
                                        className: "dduiC_head",
                                        children: [
                                          (0, react_jsx_runtime.jsx)("label", {
                                            className: "dduiC_label",
                                            htmlFor: "dsh-desktop-ui-" + key,
                                            children: t("config." + key),
                                          }),
                                          (0, react_jsx_runtime.jsxs)("span", {
                                            className: "dduiC_badges",
                                            children: [
                                              (0, react_jsx_runtime.jsx)(
                                                "span",
                                                {
                                                  className: state.draft[key]
                                                    ? "dduiC_badge"
                                                    : "dduiC_badgeMuted",
                                                  children: state.draft[key]
                                                    ? t("plugin.enabled")
                                                    : t("plugin.disabled"),
                                                },
                                              ),
                                            ],
                                          }),
                                          (0, react_jsx_runtime.jsx)("input", {
                                            id: "dsh-desktop-ui-" + key,
                                            className: "dduiC_switch",
                                            type: "checkbox",
                                            checked: state.draft[key],
                                            onChange: () => {
                                              toggle(key);
                                            },
                                          }),
                                        ],
                                      }),
                                      (0, react_jsx_runtime.jsx)("p", {
                                        className: "dduiC_hint",
                                        children: t("config." + key + ".desc"),
                                      }),
                                    ],
                                  }),
                                ),
                              }),
                              (0, react_jsx_runtime.jsxs)("div", {
                                className: "dduiC_footer",
                                children: [
                                  failed === null
                                    ? null
                                    : (0, react_jsx_runtime.jsx)("p", {
                                        className: "dduiC_failed",
                                        role: "alert",
                                        children: t(failed),
                                      }),
                                  (0, react_jsx_runtime.jsx)("button", {
                                    type: "button",
                                    className: "dduiC_discard",
                                    disabled: saving,
                                    onClick: reset,
                                    children: t("config.reset"),
                                  }),
                                  (0, react_jsx_runtime.jsx)("button", {
                                    type: "button",
                                    className: "dduiC_save",
                                    disabled: saving,
                                    onClick: save,
                                    children: saving
                                      ? t("config.saving")
                                      : t("config.save"),
                                  }),
                                ],
                              }),
                            ],
                          },
                        ),
                ],
              })
            : null,
        ],
      });
    }
    //#endregion
    //#region lib/client/index.js
    // 插件入口：总装基础设施 + 按配置安装各功能（installFeatures 调度）
    /**
     * 插件入口（browser half）：
     *   1. 总装基础设施 —— toast / 浮层 host、中英文案词典（与开关无关，始终启用）；
     *   2. installFeatures(config) —— 按配置快照安装各功能，每个安装返回 disposer；
     *   3. 启动时先按「全开」安装（避免界面先缺功能再补），配置到达后立即按真实
     *      配置重装收敛（dispose 旧的 → 安装新的）。
     */
    const inject = [
      "slots",
      "locale",
      "remote",
      "remote.pluginInventory",
      "connection",
    ];
    function apply(ctx) {
      const t = ctx.locale.bind(NS);
      // --- 总装（always-on）：中英文案词典。
      ctx.effect(
        () =>
          ctx.locale.register(NS, {
            zh,
            en,
          }),
        "dsh-desktop-ui: browser dictionaries",
      );
      /**
       * 按一份配置快照安装所有「可开关功能」。
       * 每个开关为 true 时执行对应安装函数（CSS + 行为），返回的 disposer 收集进
       * disposers；applyConfig 重装时统一 dispose，实现「开关关闭 → 功能完全移除」。
       */
      const installFeatures = (config) => {
        const disposers = [];
        const install = (fn) => {
          const dispose = fn();
          if (typeof dispose === "function") disposers.push(dispose);
        };
        if (config.settingsDrawer) {
          install(() => installDrawerCss());
          install(() =>
            ctx.effect(
              () => installSettingsDrawerShim(),
              "dsh-desktop-ui: settings drawer close shim",
            ),
          );
        }
        if (config.sessionLogExport) {
          install(() => installHeaderActionCss());
          const controller = ctx.get("sessionLogDownload");
          if (controller !== void 0) {
            install(() =>
              ctx.slots.inject("conversation.session.header.utilities", () =>
                ctx.slots.register(
                  {
                    name: "conversation.session.header.utilities",
                    id: "session-log-download",
                    priority: -1,
                  },
                  () => null,
                ),
              ),
            );
            install(() =>
              ctx.slots.inject("conversation.session.header.actions", () =>
                ctx.slots.register(
                  {
                    name: "conversation.session.header.actions",
                    id: "session-log-download",
                    order: 30,
                    locale: NS,
                    inject: () => ({
                      hooks: { sessionLogDownload: controller.store },
                      request: (sessionId) => controller.download(sessionId),
                      dismiss: (sessionId) => {
                        controller.dismiss(sessionId);
                      },
                    }),
                  },
                  ExportMoveHeaderAction,
                ),
              ),
            );
          }
        }
        if (config.statsLine) {
          install(() => installStatsCss());
        }
        // The settings card is always installed: it is the switchboard the
        // user turns the features above on and off with.
        install(() =>
          ctx.slots.inject("settings.plugin.item", () =>
            ctx.slots.register(
              {
                name: "settings.plugin.item",
                id: "dsh-desktop-ui-config",
                order: 100,
                locale: NS,
              },
              DesktopUiConfigCard,
            ),
          ),
        );
        return disposers;
      };
      // 启动调度：先按「全开」安装（界面不闪缺功能），再异步拉取持久化配置并重装收敛。
      // applyConfig 每次先 dispose 上一轮安装（active），再装新的 —— 开关变化后
      // 保存会触发整页刷新，这里覆盖的是「启动瞬间」的收敛场景。
      let active = [];
      const applyConfig = (config) => {
        for (const dispose of active) dispose();
        active = installFeatures(config);
      };
      applyConfig({ ...dduiDefaultConfig });
      void loadDesktopUiConfig().then((config) => {
        applyConfig(config);
      });
    }
    //#endregion
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
