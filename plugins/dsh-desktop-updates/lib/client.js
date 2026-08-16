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
    // 「检查更新」分区面板样式 + 原生更新弹窗样式。
    const updatesCss =
      ".dduiU_section{width:100%;max-width:760px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:16px;display:flex}.dduiU_block{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;flex-direction:column;gap:12px;padding:14px 16px;display:flex}.dduiU_row{align-items:center;justify-content:space-between;gap:12px;display:flex}.dduiU_rowLabel{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}.dduiU_rowValue{color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:13px;line-height:1.5}.dduiU_hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}@keyframes dduiU_fadeIn{from{opacity:0}}@keyframes dduiU_progressFlow{0%{background-position:0 0}100%{background-position:24px 0}}.dduiU_dlgOverlay{position:fixed;inset:0;z-index:3000;display:none;align-items:center;justify-content:center;padding:24px;animation:dduiU_fadeIn .15s ease-out}.dduiU_dlgMask{position:absolute;inset:0;background:rgba(0,0,0,.24);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}.dduiU_dlgPanel{position:relative;z-index:1;display:flex;flex-direction:column;gap:14px;width:min(400px,100%);max-height:calc(100vh - 48px);overflow:auto;box-sizing:border-box;padding:22px 24px 24px;border-radius:24px;border:1px solid var(--dsw-alias-border-inverted);background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-shadow-lv3);color:var(--dsw-alias-label-primary);font-size:14px}.dduiU_dlgHeader{display:flex;align-items:center;justify-content:space-between;gap:8px}.dduiU_dlgTitle{margin:0;font-size:16px;line-height:24px;font-weight:500;color:var(--dsw-alias-label-primary)}.dduiU_dlgClose{flex:none;width:28px;height:28px;border:none;border-radius:8px;background:transparent;cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:16px;line-height:1;display:inline-flex;align-items:center;justify-content:center}.dduiU_dlgClose:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.dduiU_dlgVersionRow{display:flex;align-items:center;gap:8px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-secondary)}.dduiU_dlgVersionRow .dduiU_dlgArrow{color:var(--dsw-alias-label-tertiary)}.dduiU_dlgVersionRow .dduiU_dlgNew{color:var(--dsw-alias-state-info-primary,#3b82f6);font-weight:600}.dduiU_dlgDesc{margin:0;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary);word-break:break-word}.dduiU_dlgNotes{max-height:180px;overflow:auto;box-sizing:border-box;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.6;word-break:break-word}.dduiU_dlgNotes a{color:var(--dsw-alias-state-info-primary,#3b82f6);text-decoration:none}.dduiU_dlgNotes a:hover{text-decoration:underline}.dduiU_dlgNotes ul{margin:4px 0;padding-left:20px}.dduiU_dlgNotes li{margin:2px 0}.dduiU_dlgNotes p{margin:4px 0}.dduiU_dlgNotes h1,.dduiU_dlgNotes h2,.dduiU_dlgNotes h3{font-size:14px;font-weight:600;margin:8px 0 4px}.dduiU_dlgNotes h4,.dduiU_dlgNotes h5,.dduiU_dlgNotes h6{font-size:13px;font-weight:600;margin:6px 0 4px}.dduiU_dlgNotes code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:4px;padding:1px 4px}.dduiU_dlgNotes hr{border:none;border-top:1px solid var(--dsw-alias-border-l2);margin:8px 0}.dduiU_dlgBody{display:flex;flex-direction:column;min-width:0;gap:10px}.dduiU_dlgFooter{display:flex;align-items:center;justify-content:flex-end;gap:8px}.dduiU_dlgBtn{height:36px;padding:0 16px;border-radius:12px;font-size:14px;line-height:1;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-family:inherit;background:transparent;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);transition:background .12s ease-out}.dduiU_dlgBtn:hover{background:var(--dsw-alias-interactive-bg-hover)}.dduiU_dlgBtnPrimary{background:var(--dsw-alias-button-elevated-fill);border:1px solid transparent;color:var(--dsw-alias-label-primary);transition:filter .12s ease-out}.dduiU_dlgBtnPrimary:hover{filter:brightness(1.08);background:var(--dsw-alias-button-elevated-fill)}.dduiU_dlgProgress{height:6px;border-radius:3px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}.dduiU_dlgProgressBar{height:100%;border-radius:3px;background:linear-gradient(90deg,#3b82f6,#60a5fa);background-size:24px 100%;animation:dduiU_progressFlow .8s linear infinite;transition:width .15s ease-out}.dduiU_dlgProgressText{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}.dduiU_dlgRemind{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.5;cursor:pointer}.dduiU_dlgRemind input{accent-color:var(--dsw-alias-state-info-primary,#3b82f6);width:14px;height:14px;margin:0;cursor:pointer}";
    const updatesTagId = "dsh-desktop-updates/UpdatesSection.module.css";
    const installUpdatesCss = () => dduInstallCss(updatesCss, updatesTagId);
    // 侧边栏底部「更新」按钮。有更新时（body 标记）foot 区改横排：
    // 槽位顺序是 footerActions 在前、settingsArea 在后，row-reverse 后
    // 视觉为 设置(flex:1 占满剩余) + 更新(flex:0 自然宽度)，互不交叠、
    // hover 高亮各自独立；无更新时布局完全还原。收起态（wide=false）
    // 组件不渲染，设置按钮图标不受影响。
    const sidebarCss =
      ".dduiU_sideBtn{height:32px;padding:0 12px;border-radius:12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1;white-space:nowrap;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}.dduiU_sideBtn:hover{background:var(--dsw-alias-button-floating-hover)}body.ddu-update-available [class$=\"_footArea\"]{flex-direction:row-reverse;align-items:center;gap:8px}body.ddu-update-available [class$=\"_settingsArea\"]{flex:1 1 auto;min-width:0;width:auto}body.ddu-update-available [class$=\"_footerActions\"]{flex:0 0 auto;width:auto;height:auto;overflow:visible}";
    const sidebarTagId = "dsh-desktop-updates/SidebarUpdateAction.module.css";
    const installSidebarCss = () => dduInstallCss(sidebarCss, sidebarTagId);
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

    //#region 更新状态
    /** 更新流程状态机：available → downloading → downloaded（安装版由主进程事件驱动）。 */
    const dduUpdateState = {
      available: false, // 存在新版本（决定侧栏「更新」按钮显隐）
      tag: null, // 新版本号（如 "v0.1.0-rc.6.6.4"）
      latest: null, // 最新版本信息（GitHub Release 精简字段）
      currentVersion: null, // 当前应用版本
      phase: "idle", // idle | available | downloading | downloaded
      percent: 0,
      transferred: 0,
      total: 0,
      dialogOpen: false,
    };
    /** 本机安装方式（installer | portable | dev），由 version 接口注入。 */
    let dduInstallKind = null;
    let dduUpdateListeners = new Set();
    /** 有更新时给 body 加标记（侧栏 foot 区据此切换横排布局）。 */
    function syncUpdateBodyClass() {
      try {
        if (typeof document === "undefined") return;
        document.body.classList.toggle(
          "ddu-update-available",
          getUpdateState().available,
        );
      } catch {}
    }
    function setUpdateState(patch) {
      Object.assign(dduUpdateState, patch);
      // 发给监听器的是新引用快照：React setState 对同一对象引用会
      // bail-out 不重渲染（此前的原地变更导致弹窗宿主永不刷新）。
      const snapshot = { ...dduUpdateState };
      for (const fn of dduUpdateListeners) fn(snapshot);
      syncUpdateBodyClass();
    }
    function getUpdateState() {
      return dduUpdateState;
    }
    function subscribeUpdateState(fn) {
      dduUpdateListeners.add(fn);
      return () => {
        dduUpdateListeners.delete(fn);
      };
    }
    /** React 订阅更新状态。 */
    function useUpdateState() {
      const [state, setState] = react.useState(getUpdateState());
      react.useEffect(() => subscribeUpdateState(setState), []);
      return state;
    }

    /** 打开更新弹窗。 */
    function openUpdateDialog() {
      dduDbg("openUpdateDialog called");
      setUpdateState({ dialogOpen: true });
    }
    function closeUpdateDialog() {
      dduDbg("closeUpdateDialog called");
      setUpdateState({ dialogOpen: false });
    }
    /** 立即更新：安装版通知主进程开始下载；便携版直接打开下载页。 */
    function startUpdateDownload() {
      dduDbg("startUpdateDownload called, kind=" + String(dduInstallKind));
      const state = getUpdateState();
      if (dduInstallKind === "installer") {
        setUpdateState({
          phase: "downloading",
          percent: 0,
          transferred: 0,
          total: 0,
        });
        console.log(desktopUpdateMarker + "start");
        return;
      }
      const latest = state.latest;
      const asset = pickAsset(latest?.assets, dduInstallKind ?? null);
      const url =
        (typeof asset?.browser_download_url === "string"
          ? asset.browser_download_url
          : null) ??
        (typeof latest?.html_url === "string"
          ? latest.html_url
          : "https://github.com/CCMu04/DSHDesktop/releases");
      closeUpdateDialog();
      globalThis.window.open(url, "_blank");
    }
    /** 勾选「下次不再自动提醒」：通知主进程记录版本，之后不再自动弹窗。 */
    function dismissUpdateReminder() {
      console.log(desktopUpdateMarker + "dismiss");
    }
    /** 立即重启并安装（更新已下载完成后）。 */
    function quitAndInstallUpdate() {
      console.log(desktopUpdateMarker + "quit-install");
    }

    /**
     * 刷新「是否有新版本」状态（决定侧栏按钮显隐）并补齐版本信息。
     * 走本地缓存与 host 接口，不额外消耗 GitHub API 配额。
     */
    async function refreshUpdateState() {
      let info = null;
      let latest = null;
      try {
        const infoRes = await fetch("/api/desktop-updates/version", {
          headers: { accept: "application/json" },
          cache: "no-store",
        });
        info = infoRes.ok ? await infoRes.json() : null;
      } catch {}
      try {
        latest = await fetchLatestRelease();
      } catch {}
      if (
        info !== null &&
        typeof info === "object" &&
        (info.installKind === "installer" ||
          info.installKind === "portable" ||
          info.installKind === "dev")
      ) {
        dduInstallKind = info.installKind;
      }
      const currentVersion =
        info !== null && typeof info?.currentVersion === "string"
          ? info.currentVersion
          : null;
      if (currentVersion !== null) {
        setUpdateState({ currentVersion });
      }
      const newer =
        latest !== null &&
        typeof latest === "object" &&
        typeof latest?.tag_name === "string" &&
        currentVersion !== null &&
        compareVersions(latest.tag_name, currentVersion) > 0;
      const knownTag = getUpdateState().tag;
      if (newer) {
        setUpdateState({ available: true, tag: latest.tag_name, latest });
        // 安装版自动弹窗（不依赖 electron-updater 的慢速检查）：
        // 有更新、未「不再提醒」、且当前没有弹窗/下载流程时弹出。
        const dismissed =
          info !== null && typeof info?.dismissedVersion === "string"
            ? info.dismissedVersion
            : null;
        const state = getUpdateState();
        dduDbg(
          "refresh: newer=" + latest.tag_name +
            " kind=" + String(dduInstallKind) +
            " dismissed=" + String(dismissed) +
            " phase=" + state.phase +
            " dialogOpen=" + state.dialogOpen,
        );
        if (
          dduInstallKind === "installer" &&
          dismissed !== latest.tag_name &&
          state.phase !== "downloading" &&
          state.phase !== "downloaded" &&
          state.dialogOpen === false
        ) {
          setUpdateState({ phase: "available", dialogOpen: true });
          dduDbg("refresh: auto-popup opened");
        }
      } else if (
        latest !== null &&
        typeof latest === "object" &&
        typeof latest?.tag_name === "string" &&
        // 仅当取到的版本不比已知的新版本旧时才清除按钮状态：
        // 主进程事件带来的版本（tag）比过期缓存更新时保留事件状态，
        // 避免刷新/事件后按钮被缓存里的旧版本误清。
        (knownTag === null || compareVersions(knownTag, latest.tag_name) < 0)
      ) {
        // 查询成功且无新版本（或已同步到最新）：清除按钮状态。
        setUpdateState({ available: false, tag: null, latest: null });
      }
      // 查询失败（latest 为 { error } 或 null）：保留现有状态，
      // 不影响已打开的弹窗与侧栏按钮（等下次成功刷新再更新）。
      return { info, latest };
    }

    /** 主进程 → 页面事件（electron-updater 状态变更）。 */
    function onUpdateEvent(event) {
      const detail = event?.detail;
      if (detail === null || typeof detail !== "object") return;
      if (detail.type === "update-available") {
        setUpdateState({
          available: true,
          tag: typeof detail.version === "string" ? detail.version : null,
          phase: "available",
          dialogOpen: true,
        });
        // 补齐 release 详情（走缓存；无缓存时失败也不影响弹窗）。
        void refreshUpdateState();
      } else if (detail.type === "download-progress") {
        setUpdateState({
          phase: "downloading",
          percent: typeof detail.percent === "number" ? detail.percent : 0,
          transferred:
            typeof detail.transferred === "number" ? detail.transferred : 0,
          total: typeof detail.total === "number" ? detail.total : 0,
        });
      } else if (detail.type === "update-downloaded") {
        setUpdateState({ phase: "downloaded", dialogOpen: true });
      } else if (detail.type === "update-pending") {
        // 页面重新加载后主进程补发的轻量通知：恢复按钮状态，但不自动弹窗。
        setUpdateState({
          available: true,
          tag: typeof detail.version === "string" ? detail.version : null,
        });
        void refreshUpdateState();
      }
    }
    //#endregion

    //#region 自动检查辅助
    /** 渲染进程 → 主进程的自动更新命令标记（与主题标记同通道）。 */
    const desktopUpdateMarker = "__DSH_DESKTOP_UPDATE__:";
    /** 渲染进程 → 主进程的诊断标记：主进程会把内容写入 backend.log。 */
    const desktopUpdateDbgMarker = "__DSH_DESKTOP_UPDATE_DBG__:";
    function dduDbg(message) {
      try {
        console.log(desktopUpdateDbgMarker + message);
      } catch {}
    }
    /** GitHub Releases API（未认证，60 次/小时/IP；配合本地缓存降低占用）。 */
    const LATEST_RELEASE_URL =
      "https://api.github.com/repos/CCMu04/DSHDesktop/releases/latest";
    /** 最新版本缓存有效期：1 小时。 */
    const LATEST_CACHE_TTL_MS = 60 * 60 * 1000;

    /** 读取本地最新版本缓存（host 持久化，跨重启可用）；无缓存/损坏返回 null。 */
    function readLatestCache() {
      return fetch("/api/desktop-updates/latest-cache", {
        headers: { accept: "application/json" },
        cache: "no-store",
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((body) =>
          body !== null &&
          typeof body === "object" &&
          typeof body?.tag_name === "string"
            ? body
            : null,
        )
        .catch(() => null);
    }

    /** 写入本地最新版本缓存（host 持久化，跨重启可用）。 */
    function writeLatestCache(entry) {
      return fetch("/api/desktop-updates/latest-cache", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(entry),
      }).catch(() => {});
    }

    /**
     * 抓取 GitHub Releases 最新版本（走系统代理），带 1 小时本地缓存：
     *   - 缓存未过期 → 直接返回缓存，不打 GitHub API；
     *   - 请求成功 → 精简字段后写缓存并返回；
     *   - 请求失败 → 有缓存则用旧缓存兜底，无缓存返回 { error: 原因 }。
     */
    async function fetchLatestRelease() {
      const cache = await readLatestCache();
      if (
        cache !== null &&
        Date.now() - Number(cache.fetchedAt ?? 0) < LATEST_CACHE_TTL_MS
      ) {
        return cache;
      }
      try {
        const res = await fetch(LATEST_RELEASE_URL, {
          headers: { accept: "application/vnd.github+json" },
        });
        if (res.ok) {
          const body = await res.json();
          if (body === null || typeof body?.tag_name !== "string") {
            return cache ?? { error: "invalid" };
          }
          const entry = {
            tag_name: body.tag_name,
            html_url:
              typeof body.html_url === "string" ? body.html_url : "",
            published_at:
              typeof body.published_at === "string" ? body.published_at : "",
            body:
              typeof body.body === "string" ? body.body.slice(0, 16 * 1024) : "",
            assets: Array.isArray(body.assets)
              ? body.assets
                  .filter(
                    (a) => typeof a?.browser_download_url === "string",
                  )
                  .slice(0, 32)
                  .map((a) => ({
                    browser_download_url: a.browser_download_url,
                  }))
              : [],
            fetchedAt: Date.now(),
          };
          void writeLatestCache(entry);
          return entry;
        }
        return cache ?? { error: "http-" + res.status };
      } catch {
        return cache ?? { error: "network" };
      }
    }
    /** 检查失败提示：按原因给可操作的文案。 */
    function checkFailedMessage(t, reason) {
      if (reason === "http-403" || reason === "http-429") {
        return t("updates.checkFailedLimit");
      }
      if (reason === "network") {
        return t("updates.checkFailedNetwork");
      }
      return t("updates.checkFailed");
    }
    /** 按安装方式挑选下载资产（便携版→portable，安装版→setup，兜底任意 .exe）。 */
    function pickAsset(assets, installKind) {
      if (!Array.isArray(assets) || assets.length === 0) return null;
      const isExe = (a) =>
        typeof a?.browser_download_url === "string" &&
        /\.exe$/i.test(a.browser_download_url);
      const preferred =
        installKind === "portable"
          ? /portable/i
          : installKind === "installer"
            ? /setup/i
            : null;
      if (preferred) {
        const match = assets.find(
          (a) => isExe(a) && preferred.test(a.browser_download_url),
        );
        if (match) return match;
      }
      return assets.find(isExe) ?? null;
    }
    //#endregion

    //#region 检查更新分区
    /** 设置侧边栏「检查更新」分区：客户端信息 + 检查按钮 + 更新弹窗。 */
    function UpdatesSection({ t }) {
      const [info, setInfo] = react.useState(null); // 本机客户端信息
      const [infoFailed, setInfoFailed] = react.useState(false);
      const [checking, setChecking] = react.useState(false);
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
        // 最新版本走 GitHub Releases（经系统代理）；带 1 小时本地缓存与失败兜底。
        fetchLatestRelease().then((latest) => {
          setChecking(false);
          if (latest === null || typeof latest?.tag_name !== "string") {
            showToast(
              "error",
              checkFailedMessage(
                t,
                typeof latest?.error === "string" ? latest.error : "",
              ),
            );
            return;
          }
          const currentVersion = info?.currentVersion ?? null;
          const newer =
            currentVersion !== null &&
            compareVersions(latest.tag_name, currentVersion) > 0;
          if (newer) {
            setUpdateState({
              available: true,
              tag: latest.tag_name,
              latest,
              dialogOpen: true,
            });
          } else {
            showToast("success", t("updates.upToDate"));
          }
        });
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
        ],
      });
    }
    //#endregion

    //#region 更新弹窗与侧栏按钮
    /** 字节数人类可读格式化。 */
    function formatBytes(value) {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        return "—";
      }
      if (value < 1024) return value + " B";
      if (value < 1024 * 1024) return (value / 1024).toFixed(0) + " KB";
      if (value < 1024 * 1024 * 1024) {
        return (value / (1024 * 1024)).toFixed(1) + " MB";
      }
      return (value / (1024 * 1024 * 1024)).toFixed(2) + " GB";
    }

    //#region 轻量 Markdown 渲染（发布说明用）
    /** HTML 转义（渲染前必须经过，杜绝注入）。 */
    function dduEscapeHtml(text) {
      return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    /** 行内 Markdown：行内代码 / 链接 / 加粗 / 斜体。 */
    function dduRenderInline(text) {
      let out = dduEscapeHtml(text);
      out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
      out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label, url) => {
        const safe = /^https?:\/\//i.test(url) ? url : "";
        return safe
          ? '<a href="' + safe + '">' + label + "</a>"
          : label;
      });
      out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      out = out.replace(
        /(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g,
        "$1<em>$2</em>",
      );
      return out;
    }

    /**
     * 极简 Markdown → 安全 HTML（发布说明支持子集）：
     * 标题 #~######、无序/有序列表、分隔线、段落、行内代码/链接/加粗/斜体。
     */
    function dduRenderMarkdown(source) {
      const lines = String(source ?? "").split(/\r?\n/);
      const blocks = [];
      let paragraph = [];
      const flushParagraph = () => {
        if (paragraph.length > 0) {
          blocks.push("<p>" + paragraph.join("<br>") + "</p>");
          paragraph = [];
        }
      };
      for (const raw of lines) {
        const trimmed = raw.trim();
        if (trimmed === "") {
          flushParagraph();
          continue;
        }
        if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
          flushParagraph();
          blocks.push("<hr>");
          continue;
        }
        const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
        if (heading) {
          flushParagraph();
          const level = heading[1].length;
          blocks.push(
            "<h" + level + ">" + dduRenderInline(heading[2]) + "</h" + level + ">",
          );
          continue;
        }
        const item = trimmed.match(/^([-*+]|\d+[.)])\s+(.*)$/);
        if (item) {
          flushParagraph();
          blocks.push("<li>" + dduRenderInline(item[2]) + "</li>");
          continue;
        }
        paragraph.push(dduRenderInline(raw.trimEnd()));
      }
      flushParagraph();
      let html = "";
      let inList = false;
      const closeList = () => {
        if (inList) {
          html += "</ul>";
          inList = false;
        }
      };
      for (const block of blocks) {
        if (block.startsWith("<li>")) {
          if (!inList) {
            html += "<ul>";
            inList = true;
          }
          html += block;
        } else {
          closeList();
          html += block;
        }
      }
      closeList();
      return html;
    }
    //#endregion

    //#region 更新弹窗（原生 DOM 实现）
    /**
     * 更新弹窗（标准更新流程），纯原生 DOM 实现：
     *   - 发现新版本：版本对比（当前 → 新）+ 发布说明 + 立即更新 / 稍后
     *     + 「下次不再自动提醒」勾选（安装版）；
     *   - 下载中：渐变流动进度条 + 已下载/总大小；
     *   - 已下载：立即重启安装 / 稍后（退出时自动安装）。
     * 便携版无 electron-updater：动作退化为「前往下载」（浏览器打开安装包直链）。
     *
     * 不用 React 渲染弹窗：独立 React root 的事件委托在本环境不可用
     * （原生探针证实点击落在容器上但不触发任何 React 处理器）。
     * 原生 DOM + 原生事件监听与 toast/托盘同机制，可靠可点。
     */
    /** 弹窗 DOM 引用（mount 时创建，按状态更新）。 */
    let dduNativeDialog = null;

    /** 创建原生按钮。 */
    function makeDialogButton(label, primary, onClick) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.className = primary ? "dduiU_dlgBtn dduiU_dlgBtnPrimary" : "dduiU_dlgBtn";
      button.addEventListener("click", onClick);
      return button;
    }

    /** 按当前状态重绘弹窗内容。 */
    function renderNativeDialog(t) {
      if (dduNativeDialog === null) return;
      const state = getUpdateState();
      const { overlay, titleEl, versionRowEl, notesEl, bodyEl, footerEl } =
        dduNativeDialog;
      if (state.dialogOpen === false) {
        overlay.style.display = "none";
        return;
      }
      overlay.style.display = "flex";
      const latest = state.latest;
      const tag = state.tag ?? (latest ? latest.tag_name : null);
      const isInstaller = dduInstallKind === "installer";
      const downloading = state.phase === "downloading";
      const downloaded = state.phase === "downloaded";
      titleEl.textContent =
        (downloaded
          ? t("updates.downloadedTitle")
          : t("updates.updateAvailable")) +
        (tag === null ? "" : " " + tag);
      // 版本对比行：当前版本 → 新版本。
      versionRowEl.replaceChildren();
      const currentText = document.createElement("span");
      currentText.textContent =
        "v" +
        (typeof state.currentVersion === "string"
          ? state.currentVersion
          : "?");
      const arrow = document.createElement("span");
      arrow.className = "dduiU_dlgArrow";
      arrow.textContent = " → ";
      const newText = document.createElement("span");
      newText.className = "dduiU_dlgNew";
      newText.textContent = tag === null ? "?" : tag;
      versionRowEl.appendChild(currentText);
      versionRowEl.appendChild(arrow);
      versionRowEl.appendChild(newText);
      // 发布说明（限高滚动，Markdown 渲染）。
      const notesText = latest?.body ? String(latest.body) : "";
      notesEl.innerHTML = notesText === "" ? "" : dduRenderMarkdown(notesText);
      notesEl.style.display = notesText === "" ? "none" : "";
      bodyEl.replaceChildren();
      if (downloading) {
        const block = document.createElement("div");
        block.style.cssText = "display:flex;flex-direction:column;gap:6px;";
        const bar = document.createElement("div");
        bar.className = "dduiU_dlgProgress";
        const fill = document.createElement("div");
        fill.className = "dduiU_dlgProgressBar";
        fill.style.width =
          Math.min(100, Math.max(0, state.percent)) + "%";
        bar.appendChild(fill);
        const text = document.createElement("div");
        text.className = "dduiU_dlgProgressText";
        text.textContent =
          Math.round(state.percent) +
          "% · " +
          formatBytes(state.transferred) +
          " / " +
          formatBytes(state.total);
        block.appendChild(bar);
        block.appendChild(text);
        bodyEl.appendChild(block);
      } else if (isInstaller && !downloaded) {
        const label = document.createElement("label");
        label.className = "dduiU_dlgRemind";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.addEventListener("change", () => {
          if (input.checked) dismissUpdateReminder();
        });
        const span = document.createElement("span");
        span.textContent = t("updates.dismissReminder");
        label.appendChild(input);
        label.appendChild(span);
        bodyEl.appendChild(label);
      }
      footerEl.replaceChildren();
      if (!downloading) {
        if (downloaded) {
          footerEl.appendChild(
            makeDialogButton(t("updates.notNow"), false, closeUpdateDialog),
          );
          footerEl.appendChild(
            makeDialogButton(
              t("updates.restartInstall"),
              true,
              quitAndInstallUpdate,
            ),
          );
        } else {
          footerEl.appendChild(
            makeDialogButton(t("updates.notNow"), false, closeUpdateDialog),
          );
          footerEl.appendChild(
            makeDialogButton(
              isInstaller ? t("updates.installNow") : t("updates.download"),
              true,
              startUpdateDownload,
            ),
          );
        }
      }
    }

    /** 挂载原生弹窗宿主（订阅状态，变化即重绘）。 */
    function mountNativeDialog(t) {
      if (typeof document === "undefined") return () => {};
      // 非浏览器环境（如冒烟测试的 DOM mock 无 addEventListener）跳过挂载。
      const probeEl = document.createElement("div");
      if (typeof probeEl.addEventListener !== "function") return () => {};
      const overlay = document.createElement("div");
      overlay.className = "dduiU_dlgOverlay";
      const mask = document.createElement("div");
      mask.className = "dduiU_dlgMask";
      mask.addEventListener("click", closeUpdateDialog);
      const panel = document.createElement("div");
      panel.className = "dduiU_dlgPanel";
      const header = document.createElement("div");
      header.className = "dduiU_dlgHeader";
      const titleEl = document.createElement("h2");
      titleEl.className = "dduiU_dlgTitle";
      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.textContent = "×";
      closeBtn.className = "dduiU_dlgClose";
      closeBtn.setAttribute("aria-label", t("updates.notNow"));
      closeBtn.addEventListener("click", closeUpdateDialog);
      header.appendChild(titleEl);
      header.appendChild(closeBtn);
      const versionRowEl = document.createElement("div");
      versionRowEl.className = "dduiU_dlgVersionRow";
      const notesEl = document.createElement("div");
      notesEl.className = "dduiU_dlgNotes";
      // 发布说明里的链接交给系统浏览器打开。
      notesEl.addEventListener("click", (event) => {
        const anchor =
          typeof event?.target?.closest === "function"
            ? event.target.closest("a")
            : null;
        const href =
          anchor !== null && anchor !== undefined
            ? anchor.getAttribute("href")
            : null;
        if (typeof href === "string" && href !== "") {
          event.preventDefault();
          globalThis.window.open(href, "_blank");
        }
      });
      const bodyEl = document.createElement("div");
      bodyEl.className = "dduiU_dlgBody";
      const footerEl = document.createElement("div");
      footerEl.className = "dduiU_dlgFooter";
      panel.appendChild(header);
      panel.appendChild(versionRowEl);
      panel.appendChild(notesEl);
      panel.appendChild(bodyEl);
      panel.appendChild(footerEl);
      overlay.appendChild(mask);
      overlay.appendChild(panel);
      document.body.appendChild(overlay);
      dduNativeDialog = { overlay, titleEl, versionRowEl, notesEl, bodyEl, footerEl };
      renderNativeDialog(t);
      const unsubscribe = subscribeUpdateState(() => renderNativeDialog(t));
      // Escape 关闭（原生监听，与 React 无关）。
      const onKeyDown = (event) => {
        if (event.key === "Escape" && getUpdateState().dialogOpen) {
          closeUpdateDialog();
        }
      };
      document.addEventListener("keydown", onKeyDown);
      dduDbg("native dialog host: mounted");
      return () => {
        unsubscribe();
        document.removeEventListener("keydown", onKeyDown);
        if (dduNativeDialog !== null && dduNativeDialog.overlay === overlay) {
          dduNativeDialog = null;
        }
        overlay.remove();
      };
    }
    //#endregion

    /**
     * 侧边栏底部「更新」按钮（sidebar.footer.action）：
     *   - 仅展开态显示（wide），收起侧栏不显示、不影响设置按钮图标；
     *   - 仅存在新版本时显示；按阶段显示文案（更新 → 下载中 x% → 重启安装）；
     *   - 点击打开更新弹窗。
     * 布局：footer 槽位行高度压为 0，按钮悬浮在设置按钮行右侧空白处
     * （设置按钮保持全宽，右侧本来无内容；匹配失败时退化为独立一行，不影响设置）。
     */
    function SidebarUpdateAction({ wide, t }) {
      const state = useUpdateState();
      if (!wide || !state.available) return null;
      let label;
      if (state.phase === "downloading") {
        label = t("updates.sidebarDownloading") + " " + Math.round(state.percent) + "%";
      } else if (state.phase === "downloaded") {
        label = t("updates.restartInstall");
      } else {
        label = t("updates.sidebarUpdate");
      }
      return (0, react_jsx_runtime.jsx)("button", {
        type: "button",
        className: "dduiU_sideBtn",
        title:
          state.tag === null
            ? t("updates.updateAvailable")
            : t("updates.updateAvailable") + " " + state.tag,
        onClick: openUpdateDialog,
        children: label,
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
      "updates.checkFailedLimit": "检查更新失败（GitHub 接口限流，请稍后再试）",
      "updates.checkFailedNetwork": "检查更新失败（网络连接异常，请检查网络或代理设置）",
      "updates.updateAvailable": "发现新版本",
      "updates.releasedAt": "发布于",
      "updates.releaseNotes": "更新说明：",
      "updates.download": "前往下载",
      "updates.notNow": "暂不",
      "updates.sidebarUpdate": "更新",
      "updates.sidebarDownloading": "下载中",
      "updates.installNow": "立即更新",
      "updates.restartInstall": "立即重启安装",
      "updates.downloadedTitle": "更新已就绪",
      "updates.dismissReminder": "下次不再自动提醒",
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
      "updates.checkFailedLimit":
        "Update check failed (GitHub API rate limit, please try again later)",
      "updates.checkFailedNetwork":
        "Update check failed (network error, please check your connection or proxy)",
      "updates.updateAvailable": "New version available",
      "updates.releasedAt": "Released",
      "updates.releaseNotes": "Release notes:",
      "updates.download": "Go to download",
      "updates.notNow": "Not now",
      "updates.sidebarUpdate": "Update",
      "updates.sidebarDownloading": "Downloading",
      "updates.installNow": "Update now",
      "updates.restartInstall": "Restart and install",
      "updates.downloadedTitle": "Update ready",
      "updates.dismissReminder": "Don't remind me again",
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
          install(() => installSidebarCss());
          // 更新弹窗：原生 DOM 宿主（独立 React root 的事件委托在本环境
          // 不可用，原生实现与 toast 同机制，全局可见可点）。
          install(() => mountNativeDialog(t));
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
          // 侧边栏底部「更新」按钮（设置按钮旁边，仅展开态 + 有新版本时显示）。
          install(() =>
            ctx.slots.inject("sidebar.footer.action", () =>
              ctx.slots.register(
                {
                  name: "sidebar.footer.action",
                  id: "updates",
                  order: 10,
                  locale: NS,
                },
                SidebarUpdateAction,
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
      // 主进程自动更新事件（electron-updater：发现更新 / 下载进度 / 下载完成）。
      ctx.effect(
        () => {
          if (
            typeof window === "undefined" ||
            typeof window.addEventListener !== "function"
          ) {
            return () => {};
          }
          window.addEventListener("dsh-desktop-update-event", onUpdateEvent);
          return () =>
            window.removeEventListener(
              "dsh-desktop-update-event",
              onUpdateEvent,
            );
        },
        "dsh-desktop-updates: update events",
      );
      void loadUpdatesConfig().then((config) => {
        applyConfig(config);
        // 启动时刷新「是否有新版本」状态（走缓存），决定侧栏按钮显隐；
        // 便携版额外弹可点击的下载提示。
        if (config.enabled) void autoCheckOnLaunch();
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

    /** 可点击的更新提示：点击直接打开下载链接，15 秒后自动消失。 */
    function showUpdateToast(version, url) {
      const id = "dsh-desktop-updates-toast-" + ++dduToastSeq;
      const tag = document.createElement("div");
      tag.id = id;
      tag.style.cssText =
        "position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:3000;max-width:min(540px,calc(100vw - 32px));padding:10px 16px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);box-shadow:var(--dsw-shadow-lv2);color:var(--dsw-alias-label-primary);border-radius:10px;font-size:13px;line-height:20px;cursor:pointer;overflow-wrap:anywhere";
      tag.textContent = "发现新版本 " + version + "，点击下载";
      tag.addEventListener("click", () => {
        globalThis.window.open(url, "_blank");
        tag.remove();
      });
      document.body.appendChild(tag);
      setTimeout(() => tag.remove(), 15000);
    }

    /**
     * 启动时刷新更新状态（走缓存）：安装版据此显示侧栏「更新」按钮
     * （自动弹窗由主进程 electron-updater 事件负责）；便携版额外弹
     * 可点击的下载提示，避免与安装版的双重通知。
     */
    async function autoCheckOnLaunch() {
      try {
        const { info } = await refreshUpdateState();
        if (info?.installKind !== "portable") return;
        const state = getUpdateState();
        if (!state.available || state.tag === null) return;
        const latest = state.latest;
        const asset = pickAsset(latest?.assets, "portable");
        const url =
          (typeof asset?.browser_download_url === "string"
            ? asset.browser_download_url
            : null) ??
          (typeof latest?.html_url === "string"
            ? latest.html_url
            : "https://github.com/CCMu04/DSHDesktop/releases");
        showUpdateToast(state.tag, url);
      } catch {
        // 启动期静默失败，不打扰用户。
      }
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
