/**
 * dsh-desktop-updates — browser half.
 *
 * 「检查更新」功能增强：
 *   - 设置侧边栏「检查更新」分区（settings.section，order 100）：显示当前版本，
 *     手动检查 GitHub Releases，有更新时弹窗询问是否前往下载页；
 *   - 「功能增强」配置卡片子项（desktop.features.item）：启用/停用开关。
 *
 * 开关由 host 端持久化（/api/desktop-updates/config），当前版本由 host 提供
 * （/api/desktop-updates/version），最新版本直接请求 GitHub Releases API
 * （Electron 浏览器走系统代理）。
 */
window.__ModuleLoader__.load({
  id: "dsh-desktop-updates",
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
    const dduUpdatesDefaultConfig = { enabled: true };
    /** 读取生效配置；任何失败回退默认（全开）。 */
    function loadUpdatesConfig() {
      return fetch("/api/desktop-updates/config", {
        headers: { accept: "application/json" },
        cache: "no-store",
      })
        .then((res) =>
          res.ok
            ? res.json()
            : Promise.reject(new Error("config-http-" + res.status)),
        )
        .then((body) => ({
          enabled:
            typeof body?.enabled === "boolean" ? body.enabled : true,
        }))
        .catch(() => ({ ...dduUpdatesDefaultConfig }));
    }
    /** 写入开关；返回是否被接受。 */
    function saveUpdatesConfig(config) {
      return fetch("/api/desktop-updates/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(config),
      }).then((res) => res.ok);
    }
    //#endregion

    //#region 样式
    /** 注入一个插件样式标签；返回的 disposer 移除它。 */
    const dduInstallCss = (cssText, styleTagId) => {
      if (
        typeof document === "undefined" ||
        document.querySelector(
          "style[data-plugin-css=" + JSON.stringify(styleTagId) + "]",
        ) !== null
      )
        return () => {};
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-desktop-updates";
      tag.dataset.pluginCss = styleTagId;
      tag.textContent = cssText;
      document.head.appendChild(tag);
      return () => tag.remove();
    };
    // 「检查更新」分区面板样式。
    const updatesCss =
      ".dduiU_section{width:100%;max-width:760px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:16px;display:flex}.dduiU_block{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;flex-direction:column;gap:12px;padding:14px 16px;display:flex}.dduiU_row{align-items:center;justify-content:space-between;gap:12px;display:flex}.dduiU_rowLabel{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}.dduiU_rowValue{color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:13px;line-height:1.5}.dduiU_hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}";
    const updatesTagId = "dsh-desktop-updates/UpdatesSection.module.css";
    const installUpdatesCss = () => dduInstallCss(updatesCss, updatesTagId);
    //#endregion

    //#region 版本比较
    /** 简易版本比较：去掉 v 前缀，按 -/. 分段比较（数字段按数值，字母段按字典序）。 */
    function compareVersions(a, b) {
      const parse = (v) =>
        String(v)
          .replace(/^v/i, "")
          .split(/[-.]/g)
          .map((s) => {
            const n = Number.parseInt(s, 10);
            return Number.isNaN(n) ? s : n;
          });
      const pa = parse(a);
      const pb = parse(b);
      const len = Math.max(pa.length, pb.length);
      for (let i = 0; i < len; i++) {
        const x = i < pa.length ? pa[i] : 0;
        const y = i < pb.length ? pb[i] : 0;
        if (typeof x === "number" && typeof y === "number") {
          if (x !== y) return x - y;
        } else {
          const xs = String(x);
          const ys = String(y);
          if (xs !== ys) return xs < ys ? -1 : 1;
        }
      }
      return 0;
    }
    //#endregion

    //#region 检查更新分区
    /** 设置侧边栏「检查更新」分区：客户端信息 + 检查按钮 + 更新弹窗。 */
    function UpdatesSection({ t }) {
      const [info, setInfo] = react.useState(null); // 本机客户端信息
      const [infoFailed, setInfoFailed] = react.useState(false);
      const [checking, setChecking] = react.useState(false);
      const [dialog, setDialog] = react.useState(null); // 有更新时的弹窗数据
      // 挂载即读取本机客户端信息（版本、系统、安装方式），无需等待检查。
      react.useEffect(() => {
        let current = true;
        fetch("/api/desktop-updates/version", {
          headers: { accept: "application/json" },
          cache: "no-store",
        })
          .then((res) =>
            res.ok
              ? res.json()
              : Promise.reject(new Error("version-http-" + res.status)),
          )
          .then((body) => {
            if (!current) return;
            setInfo({
              currentVersion:
                typeof body?.currentVersion === "string"
                  ? body.currentVersion
                  : null,
              dshVersion:
                typeof body?.dshVersion === "string" ? body.dshVersion : null,
              os: typeof body?.os === "string" ? body.os : null,
              arch: typeof body?.arch === "string" ? body.arch : null,
              installKind:
                body?.installKind === "installer" ||
                body?.installKind === "portable" ||
                body?.installKind === "dev"
                  ? body.installKind
                  : null,
            });
          })
          .catch(() => {
            if (current) setInfoFailed(true);
          });
        return () => {
          current = false;
        };
      }, []);
      const check = () => {
        if (checking) return;
        setChecking(true);
        // 最新版本走 GitHub Releases（经系统代理）。
        fetch("https://api.github.com/repos/CCMu04/DSHDesktop/releases/latest", {
          headers: { accept: "application/vnd.github+json" },
        })
          .then((res) =>
            res.ok
              ? res.json()
              : Promise.reject(new Error("github-http-" + res.status)),
          )
          .catch(() => null)
          .then((latest) => {
            setChecking(false);
            if (latest === null || typeof latest?.tag_name !== "string") {
              showToast("error", t("updates.checkFailed"));
              return;
            }
            const currentVersion = info?.currentVersion ?? null;
            const newer =
              currentVersion !== null &&
              compareVersions(latest.tag_name, currentVersion) > 0;
            if (newer) {
              setDialog({
                tag: latest.tag_name,
                url:
                  typeof latest.html_url === "string"
                    ? latest.html_url
                    : "https://github.com/CCMu04/DSHDesktop/releases",
                publishedAt:
                  typeof latest.published_at === "string"
                    ? latest.published_at
                    : "",
                body: typeof latest.body === "string" ? latest.body : "",
              });
            } else {
              showToast("success", t("updates.upToDate"));
            }
          });
      };
      const goDownload = () => {
        const data = dialog;
        if (data === null) return;
        setDialog(null);
        // Electron 窗口打开处理器会把外部链接交给系统浏览器。
        globalThis.window.open(data.url, "_blank");
      };
      const infoRows = [
        {
          label: t("updates.appVersion"),
          value:
            info === null || info.currentVersion === null
              ? t("updates.unknownVersion")
              : "v" + info.currentVersion,
        },
        {
          label: t("updates.dshVersion"),
          value:
            info === null || info.dshVersion === null
              ? t("updates.unknownVersion")
              : "v" + info.dshVersion,
        },
        {
          label: t("updates.system"),
          value:
            info === null || info.os === null
              ? t("updates.unknownVersion")
              : info.arch === null
                ? info.os
                : info.os + " · " + info.arch,
        },
        {
          label: t("updates.installKind"),
          value:
            info === null || info.installKind === null
              ? t("updates.unknownVersion")
              : t("updates.installKind." + info.installKind),
        },
      ];
      return (0, react_jsx_runtime.jsxs)("div", {
        className: "dduiU_section",
        children: [
          (0, react_jsx_runtime.jsx)("div", {
            className: "dduiU_block",
            children: [
              infoFailed
                ? (0, react_jsx_runtime.jsx)("p", {
                    className: "dduiU_hint",
                    children: t("updates.infoFailed"),
                  })
                : infoRows.map((row) =>
                    (0, react_jsx_runtime.jsxs)("div", {
                      className: "dduiU_row",
                      key: row.label,
                      children: [
                        (0, react_jsx_runtime.jsx)("span", {
                          className: "dduiU_rowLabel",
                          children: row.label,
                        }),
                        (0, react_jsx_runtime.jsx)("span", {
                          className: "dduiU_rowValue",
                          children: row.value,
                        }),
                      ],
                    }),
                  ),
              (0, react_jsx_runtime.jsx)(
                _deepseek_ai_dsh_client_ui_primitives.Button,
                {
                  variant: "primary",
                  disabled: checking,
                  onClick: check,
                  children: checking
                    ? t("updates.checking")
                    : t("updates.check"),
                },
              ),
            ],
          }),
          (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
            open: dialog !== null,
            onClose: () => {
              setDialog(null);
            },
            title:
              dialog === null
                ? t("updates.updateAvailable")
                : t("updates.updateAvailable") + " " + dialog.tag,
            description:
              dialog === null
                ? ""
                : [
                    dialog.publishedAt === ""
                      ? ""
                      : t("updates.releasedAt") +
                        " " +
                        dialog.publishedAt.slice(0, 10),
                    dialog.body === "" ? "" : t("updates.releaseNotes"),
                  ]
                    .filter(Boolean)
                    .join(" · "),
            closeLabel: t("updates.notNow"),
            footer: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
              children: [
                (0, react_jsx_runtime.jsx)(
                  _deepseek_ai_dsh_client_ui_primitives.Button,
                  {
                    variant: "outline",
                    onClick: () => {
                      setDialog(null);
                    },
                    children: t("updates.notNow"),
                  },
                ),
                (0, react_jsx_runtime.jsx)(
                  _deepseek_ai_dsh_client_ui_primitives.Button,
                  {
                    variant: "primary",
                    onClick: goDownload,
                    children: t("updates.download"),
                  },
                ),
              ],
            }),
          }),
        ],
      });
    }
    //#endregion

    //#region 功能增强数据接口
    /**
     * 「功能增强」卡片中的「检查更新」数据接口（desktop.features.item）：
     * 只提供 load/save/title/description，开关渲染与保存由功能增强卡片统一完成。
     */
    function updatesFeatureFace(t) {
      return {
        load: () => loadUpdatesConfig().then((config) => config.enabled),
        save: (enabled) => saveUpdatesConfig({ enabled }),
        title: t("feature.title"),
        description: t("feature.description"),
      };
    }
    //#endregion

    //#region 词典
    /** 本插件文案命名空间。 */
    const NS = "desktop-updates";
    const zh = {
      "updates.nav": "检查更新",
      "updates.appVersion": "应用版本",
      "updates.dshVersion": "DSH 组件",
      "updates.system": "系统",
      "updates.installKind": "安装方式",
      "updates.installKind.installer": "安装版",
      "updates.installKind.portable": "便携版",
      "updates.installKind.dev": "开发版",
      "updates.unknownVersion": "未知",
      "updates.infoFailed": "无法读取客户端信息",
      "updates.check": "检查更新",
      "updates.checking": "正在检查…",
      "updates.upToDate": "已是最新版本",
      "updates.checkFailed": "检查更新失败，请稍后重试",
      "updates.updateAvailable": "发现新版本",
      "updates.releasedAt": "发布于",
      "updates.releaseNotes": "更新说明：",
      "updates.download": "前往下载",
      "updates.notNow": "暂不",
      "feature.title": "检查更新",
      "feature.description": "在设置中显示「检查更新」入口，手动检查 DSH Desktop 新版本并跳转下载",
    };
    const en = {
      "updates.nav": "Check for updates",
      "updates.appVersion": "App version",
      "updates.dshVersion": "DSH component",
      "updates.system": "System",
      "updates.installKind": "Install type",
      "updates.installKind.installer": "Installer",
      "updates.installKind.portable": "Portable",
      "updates.installKind.dev": "Development",
      "updates.unknownVersion": "Unknown",
      "updates.infoFailed": "Could not read the client info",
      "updates.check": "Check for updates",
      "updates.checking": "Checking…",
      "updates.upToDate": "You are up to date",
      "updates.checkFailed": "Update check failed, please try again later",
      "updates.updateAvailable": "New version available",
      "updates.releasedAt": "Released",
      "updates.releaseNotes": "Release notes:",
      "updates.download": "Go to download",
      "updates.notNow": "Not now",
      "feature.title": "Check for updates",
      "feature.description":
        "Show the update-check entry in settings, manually check for new DSH Desktop versions and jump to the download page",
    };
    //#endregion

    //#region 入口
    /** 所需客户端服务。 */
    const inject = ["slots", "locale"];
    /**
     * 插件入口：
     *   - 「功能增强」卡片子项（desktop.features.item）始终注册 —— 开关由用户在
     *     功能增强卡片里控制；
     *   - 设置侧边栏「检查更新」分区按 enabled 开关安装/移除。
     */
    function apply(ctx) {
      const t = ctx.locale.bind(NS);
      ctx.effect(
        () =>
          ctx.locale.register(NS, {
            zh,
            en,
          }),
        "dsh-desktop-updates: dictionaries",
      );
      // 功能增强卡片子项（always-on：数据接口永远可调）。
      ctx.slots.inject("desktop.features.item", () =>
        ctx.slots.register(
          {
            name: "desktop.features.item",
            id: "updates",
            order: 10,
            locale: NS,
            inject: () => updatesFeatureFace(t),
          },
          // 该槽位由「功能增强」卡片消费数据接口，不渲染组件。
          () => null,
        ),
      );
      // 设置分区「检查更新」：按配置快照安装/移除。
      const installSection = (config) => {
        const disposers = [];
        const install = (fn) => {
          const dispose = fn();
          if (typeof dispose === "function") disposers.push(dispose);
        };
        if (config.enabled) {
          install(() => installUpdatesCss());
          install(() =>
            ctx.slots.inject("settings.section", () =>
              ctx.slots.register(
                {
                  name: "settings.section",
                  id: "updates",
                  order: 100,
                  label: () => t("updates.nav"),
                  locale: NS,
                },
                UpdatesSection,
              ),
            ),
          );
        }
        return disposers;
      };
      let active = [];
      const applyConfig = (config) => {
        for (const dispose of active) dispose();
        active = installSection(config);
      };
      applyConfig({ ...dduUpdatesDefaultConfig });
      void loadUpdatesConfig().then((config) => {
        applyConfig(config);
      });
    }
    //#endregion

    /** 轻量 toast（复用 desktop-ui 的样式约定；本插件独立实现，避免跨包依赖）。 */
    let dduToastSeq = 0;
    function showToast(kind, text) {
      const id = "dsh-desktop-updates-toast-" + ++dduToastSeq;
      const tag = document.createElement("div");
      tag.id = id;
      tag.style.cssText =
        "position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:3000;max-width:min(480px,calc(100vw - 32px));padding:9px 14px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);box-shadow:var(--dsw-shadow-lv2);color:var(--dsw-alias-label-primary);border-radius:10px;font-size:13px;line-height:20px;overflow-wrap:anywhere";
      if (kind === "error") {
        tag.style.borderColor =
          "color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent)";
      }
      tag.textContent = text;
      document.body.appendChild(tag);
      setTimeout(() => tag.remove(), 3200);
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
