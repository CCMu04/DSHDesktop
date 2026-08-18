/**
 * browser-controller.mjs — 工作台内置浏览器的主进程控制器（P0 骨架）。
 *
 * 职责：
 *   - 生命周期：懒创建单个 WebContentsView（多标签 = 单 view 切 URL，
 *     渲染侧维护标签/历史栈），挂进主窗口 contentView；
 *   - 隔离：独立持久分区 session "persist:dsh-browser"（登录态跨重启保留，
 *     与主界面 Cookie 完全隔离）；权限请求默认全拒；
 *   - 导航：渲染侧经 console 标记 __DSH_BROWSER_CMD__:<json> 发命令，
 *     本模块执行并回推状态（CustomEvent dsh-desktop-browser-event）；
 *   - 对齐：渲染侧上报面板根 boundingClientRect（CSS px），本模块按主页面
 *     zoomFactor 换算成 DIP 后 setBounds；窗口 move/resize/全屏等事件回发
 *     request-bounds 让渲染侧补报；
 *   - 安全：导航目标在主进程强制校验（仅 http/https + 拒绝环回地址），
 *     渲染侧校验只是镜像；
 *   - 焦点：视图内按 Esc → 聚焦回主页面。
 *   - 诊断：构造时可注入 log 回调（main.mjs 传 appendBackendOutput），
 *     关键路径落 backend.log，便于定位「视图不出画面」等问题。
 *
 * 通道约定与既有桌面壳一致：渲染→主 = console-message 标记；主→渲染 =
 * executeJavaScript 派发 CustomEvent。不引入 preload IPC 新面。
 */
import * as electronNs from "electron";
import path from "node:path";

const { WebContentsView, session, shell, app, nativeTheme } = electronNs;

/** 视图底色：跟随 DSH 主题（与 loading.html / 主窗口 backgroundColor 一致）。 */
const THEME_BG_LIGHT = "#ffffff";
const THEME_BG_DARK = "#151517";

/** 渲染→主 命令标记前缀（与 main.mjs 拼接完整前缀使用）。 */
export const CMD_MARKER = "__DSH_BROWSER_CMD__:";
/** 主→渲染 事件名（CustomEvent detail 承载消息体）。 */
export const EVENT_NAME = "dsh-desktop-browser-event";

/** 导航白名单：仅 http/https。 */
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/** 环回/本机地址模式（拒绝导航与外部打开，防打内网与本地 DSH 服务）。 */
const LOOPBACK_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^::1$/,
  /^0:0:0:0:0:0:0:1$/,
];

/**
 * 解析输入；带「寄主:端口」启发式：
 * WHATWG 规定 scheme 可含点号，导致 "example.com:8080" 会被解析成 scheme
 * "example.com:"——但地址栏里这是 host:port。凡解析出的 scheme 含点号，
 * 一律视为无 scheme 输入，走补协议路径。
 */
function parseNavInput(input) {
  try {
    const parsed = new URL(input);
    if (parsed.protocol.slice(0, -1).includes(".")) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 规范化 + 校验导航目标（主进程强制版本）。
 * - 无协议前缀时补全：形如 "host:port"（数字端口）→ http；否则 → https；
 * - 输入自带非 http(s) 协议（file:/javascript:/data: 等）直接拒绝——
 *   不能靠补前缀绕过去；
 * - 自带 scheme 是环回名（如 "localhost:8080" 被 URL 规范拆成 scheme
 *   "localhost:"）→ 按「本机地址被拦截」回报，而非协议错误。
 * @param {string} raw
 * @returns {{ ok: true, url: string } | { ok: false, reason: string }}
 */
export function parseTargetUrl(raw) {
  let input = String(raw ?? "").trim();
  if (input.length === 0) return { ok: false, reason: "empty" };
  let parsed = parseNavInput(input);
  if (parsed === null) {
    // 显式写了 http(s):// 却解析失败（如 "http://::1"）→ 直接拒绝。
    if (/^https?:\/\//i.test(input)) return { ok: false, reason: "protocol" };
    const prefix = /^(?:[a-z0-9.-]+):\d+(?:[/?#]|$)/i.test(input)
      ? "http://"
      : "https://";
    try {
      parsed = new URL(prefix + input);
    } catch {
      return { ok: false, reason: "protocol" };
    }
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    const scheme = parsed.protocol.slice(0, -1).toLowerCase();
    if (LOOPBACK_PATTERNS.some((pattern) => pattern.test(scheme))) {
      return { ok: false, reason: "localhost" };
    }
    return { ok: false, reason: "protocol" };
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  for (const pattern of LOOPBACK_PATTERNS) {
    if (pattern.test(host)) return { ok: false, reason: "localhost" };
  }
  return { ok: true, url: parsed.href };
}

const WINDOW_GEOMETRY_EVENTS = [
  "move",
  "resize",
  "maximize",
  "unmaximize",
  "enter-full-screen",
  "leave-full-screen",
];

/**
 * @typedef {object} BrowserControllerOptions
 * @property {() => import("electron").BrowserWindow} getWindow
 * @property {(url: string) => boolean} isBackendUrl
 * @property {(message: string) => void} [log]
 */
export class BrowserController {
  constructor({ getWindow, isBackendUrl, log }) {
    this.getWindow = getWindow;
    this.isBackendUrl = isBackendUrl;
    this.log = typeof log === "function" ? log : () => {};
    /** @type {import("electron").WebContentsView | null} */
    this.view = null;
    /** @type {import("electron").Session | null} */
    this.ses = null;
    this.visible = false;
    /** @type {{ x, y, width, height } | null} */
    this.lastBounds = null;
    this.currentTitle = "";
    this.windowEventOffs = [];
    this.viewHandlers = [];
    /** 主题（由 main.mjs 的主题标记转发）；未收到时按系统深色模式。 */
    this.darkTheme = null;
    /**
     * 是否已加载过真实页面（非 about:blank）。空状态时原生视图保持隐藏，
     * 显示深色 DOM 提示，避免 about:blank 的白底破坏深色模式观感。
     */
    this.hasContent = false;
  }

  // ---------------------------------------------------------------- 主题
  /**
   * 跟随应用主题：
   * 1) 原生视图底色（页面加载前/透明页时可见）；
   * 2) 视图内网页的 prefers-color-scheme（CDP Emulation）——网页默认跟随
   *    OS 配色，不模拟的话「OS 深色 + 应用浅色」时支持深色的站点仍渲染深色。
   */
  setTheme(dark) {
    this.darkTheme = Boolean(dark);
    if (!this.view) return;
    try {
      this.view.setBackgroundColor(
        this.darkTheme ? THEME_BG_DARK : THEME_BG_LIGHT,
      );
    } catch {
      // 视图可能已销毁。
    }
    void this.applyColorScheme(this.darkTheme);
  }

  /** CDP 模拟 prefers-color-scheme，让视图内网页跟随应用主题。 */
  async applyColorScheme(dark) {
    const wc = this.view?.webContents;
    if (!wc || wc.isDestroyed()) return;
    try {
      if (!wc.debugger.isAttached()) wc.debugger.attach("1.3");
      await wc.debugger.sendCommand("Emulation.setEmulatedMedia", {
        features: [
          { name: "prefers-color-scheme", value: dark ? "dark" : "light" },
        ],
      });
      this.log(`color-scheme → ${dark ? "dark" : "light"}`);
    } catch (error) {
      this.log(`color-scheme emulation failed: ${String(error)}`);
    }
  }

  // ---------------------------------------------------------------- 命令入口
  /** 处理渲染侧发来的命令消息（main.mjs 的 console-message 分支调用）。 */
  handleCommand(message) {
    if (!message || typeof message !== "object") return;
    this.log(
      `cmd ${message.type}${message.url ? ` ${String(message.url).slice(0, 120)}` : ""}${message.note ? ` ${message.note}` : ""}${message.value !== undefined ? ` ${JSON.stringify(message.value)}` : ""}`,
    );
    switch (message.type) {
      case "navigate":
        this.navigate(String(message.url ?? ""));
        break;
      case "back":
        this.go(-1);
        break;
      case "forward":
        this.go(1);
        break;
      case "reload":
        this.reload();
        break;
      case "new-tab":
        // P0：单标签占位；带 URL 时直接导航，否则仅确保视图就绪。
        if (message.url) this.navigate(String(message.url));
        else this.setVisible(true);
        break;
      case "activate-tab":
        if (message.url) this.navigate(String(message.url));
        else this.setVisible(true);
        break;
      case "close-tab":
        // P0：单标签占位，忽略。
        break;
      case "bounds":
        this.updateBounds(message.rect);
        break;
      case "visibility":
        this.setVisible(Boolean(message.visible));
        break;
      case "open-external":
        this.openExternal(String(message.url ?? ""));
        break;
      case "debug":
        // 诊断标记：仅记录，无行为。
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------- 导航行为
  navigate(raw) {
    const target = parseTargetUrl(raw);
    if (!target.ok) {
      this.log(`navigate blocked: ${raw} (${target.reason})`);
      this.dispatch({ type: "nav-blocked", url: raw, reason: target.reason });
      return;
    }
    this.log(`navigate → ${target.url}`);
    const view = this.ensureView();
    this.setVisible(true);
    view.webContents
      .loadURL(target.url)
      .then(() => this.log(`loadURL ok ${target.url}`))
      .catch((error) => {
        // did-fail-load 会另行回推错误；这里只记录。
        this.log(`loadURL failed ${target.url}: ${String(error)}`);
      });
  }

  go(direction) {
    const view = this.ensureView();
    const history = view.webContents.navigationHistory;
    try {
      if (direction < 0 && history.canGoBack()) history.goBack();
      else if (direction > 0 && history.canGoForward()) history.goForward();
      else return;
    } catch (error) {
      this.log(`history error: ${String(error)}`);
      return;
    }
    this.setVisible(true);
  }

  reload() {
    const view = this.ensureView();
    view.webContents.reload();
    this.setVisible(true);
  }

  openExternal(raw) {
    // 仍走主进程校验：外部打开也不能绕过协议/环回黑名单。
    const target = parseTargetUrl(raw);
    if (!target.ok) {
      this.log(`open-external blocked: ${raw} (${target.reason})`);
      return;
    }
    this.log(`open-external → ${target.url}`);
    void shell.openExternal(target.url).catch((error) => {
      this.log(`openExternal error: ${String(error)}`);
    });
  }

  // ---------------------------------------------------------------- 对齐与可见
  updateBounds(rect) {
    if (!rect || typeof rect !== "object") return;
    const n = (v, min) => (Number.isFinite(v) ? Math.max(min, Math.round(v)) : null);
    const x = n(rect.x, 0);
    const y = n(rect.y, 0);
    const width = n(rect.width, 1);
    const height = n(rect.height, 1);
    if (x === null || y === null || width === null || height === null) return;
    const previous = this.lastBounds;
    this.lastBounds = { x, y, width, height };
    // 诊断：bounds 每次变化都记录（rAF 节流后频率可接受）。
    if (
      previous === null ||
      previous.x !== x ||
      previous.y !== y ||
      previous.width !== width ||
      previous.height !== height
    ) {
      this.log(`bounds ${x},${y} ${width}x${height}`);
    }
    // bounds 到达即应用；若此前 visibility:true 已到（视图尚未有实时尺寸），
    // 这里补上显示，避免视图以默认/全窗尺寸闪出。
    if (this.view && this.visible) {
      this.applyBounds();
      this.view.setVisible(true);
    }
  }

  /** 按主页面 zoomFactor 把 CSS px 换算为 DIP 并 setBounds。 */
  applyBounds() {
    if (!this.view || !this.visible || !this.lastBounds) return;
    const win = this.getWindow();
    if (!win || win.isDestroyed()) return;
    let zoom = 1;
    try {
      zoom = win.webContents.getZoomFactor?.() ?? 1;
    } catch {
      zoom = 1;
    }
    if (!Number.isFinite(zoom) || zoom <= 0) zoom = 1;
    const b = this.lastBounds;
    this.view.setBounds({
      x: Math.round(b.x * zoom),
      y: Math.round(b.y * zoom),
      width: Math.max(1, Math.round(b.width * zoom)),
      height: Math.max(1, Math.round(b.height * zoom)),
    });
  }

  setVisible(visible) {
    const changed = this.visible !== Boolean(visible);
    this.visible = Boolean(visible);
    if (!this.view) return;
    if (this.visible) {
      // 尚无实时 bounds：保持隐藏（防全窗闪屏），要一次 bounds，
      // 到达后 updateBounds 会补上显示。
      if (!this.lastBounds) {
        this.dispatch({ type: "request-bounds" });
        return;
      }
      this.applyBounds();
      if (!this.hasContent) {
        // 空状态（尚未加载出真实页面）：保持视图隐藏——about:blank 是
        // 不透明白底，亮出来会把深色 DOM 提示盖成白块。加载成功后
        // did-navigate 会补上显示。
        this.view.setVisible(false);
        if (changed) this.log(`view held hidden (no content)`);
        return;
      }
      this.view.setVisible(true);
      this.pushState();
      if (changed) {
        this.log(`view visible ${JSON.stringify(this.lastBounds)}`);
      }
    } else {
      this.view.setVisible(false);
      if (changed) this.log(`view hidden`);
    }
  }

  /** 视图存在性：上电（懒创建）。 */
  ensureView() {
    if (this.view) return this.view;
    const win = this.getWindow();
    if (!win || win.isDestroyed()) throw new Error("browser: no main window");

    this.ses = session.fromPartition("persist:dsh-browser");
    // 权限默认全拒（camera/mic/geolocation/notifications/clipboard-read…）。
    this.ses.setPermissionRequestHandler(
      (webContents, permission, callback) => callback(false),
    );
    this.ses.setPermissionCheckHandler(() => false);
    // 下载：保存到系统下载目录（P0 默认行为），并回推事件。
    this.ses.on("will-download", (event, item) => {
      try {
        const filename = item.getFilename();
        item.setSavePath(path.join(app.getPath("downloads"), filename));
        this.dispatch({
          type: "download-start",
          filename,
          url: item.getURL(),
        });
      } catch {
        // 下载失败不阻塞浏览器。
      }
    });

    this.view = new WebContentsView({
      webPreferences: {
        session: this.ses,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    // 视图底色跟随主题（页面加载前/透明页时可见，防深色模式白闪）。
    try {
      const dark =
        this.darkTheme !== null
          ? this.darkTheme
          : Boolean(nativeTheme.shouldUseDarkColors);
      this.view.setBackgroundColor(dark ? THEME_BG_DARK : THEME_BG_LIGHT);
      // prefers-color-scheme 也同步（网页默认跟随 OS，需显式对齐应用主题）。
      void this.applyColorScheme(dark);
    } catch {
      // 忽略：底色缺失不影响浏览。
    }
    win.contentView.addChildView(this.view);
    this.view.setVisible(false);
    this.wireView();
    this.wireWindow(win);
    this.log("view created (WebContentsView attached)");
    // 视图刚创建时渲染侧可能已报过 bounds（当时 view 尚不存在）——
    // 主动要一次实时 bounds，保证「首次导航即定位」。
    this.dispatch({ type: "request-bounds" });
    return this.view;
  }

  // ---------------------------------------------------------------- 事件接线
  wireView() {
    const wc = this.view.webContents;
    const on = (name, handler) => {
      wc.on(name, handler);
      this.viewHandlers.push([name, handler]);
    };

    on("did-navigate", (event, url) => {
      // 真实页面加载成功：标记有内容，并补上视图显示（空状态时它被
      // setVisible 逻辑保持隐藏）。
      if (url && url !== "about:blank") {
        this.hasContent = true;
        if (this.visible && this.lastBounds) {
          this.applyBounds();
          this.view.setVisible(true);
        }
      }
      this.pushState();
    });
    on("did-navigate-in-page", () => this.pushState());
    on("page-title-updated", (event, title) => {
      this.currentTitle = title;
      this.pushState();
    });
    on("did-start-loading", () => {
      this.pushState();
    });
    on("did-stop-loading", () => {
      this.dispatch({ type: "state", ...this.snapshot(), loading: false });
    });
    on("did-fail-load", (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      this.log(`fail-load ${validatedURL} code=${errorCode} ${errorDescription}`);
      if (!isMainFrame || errorCode === -3) return; // -3 = ERR_ABORTED（用户取消）
      this.dispatch({
        type: "load-error",
        url: validatedURL ?? "",
        code: errorCode,
        description: errorDescription ?? "",
      });
    });
    // 弹窗：http(s) → 回推 popup（渲染侧开新标签）；其余 → 系统浏览器。
    wc.setWindowOpenHandler(({ url }) => {
      const target = parseTargetUrl(url);
      if (target.ok) {
        this.log(`popup → ${target.url}`);
        this.dispatch({ type: "popup", url: target.url });
      } else {
        void shell.openExternal(url).catch(() => {});
      }
      return { action: "deny" };
    });
    // Esc → 聚焦回主页面（聊天区），浏览器不再持有键盘焦点。
    on("before-input-event", (event, input) => {
      if (input.type === "keyDown" && input.key === "Escape") {
        const win = this.getWindow();
        if (win && !win.isDestroyed()) win.webContents.focus();
      }
    });
  }

  wireWindow(win) {
    const requestBounds = () => this.dispatch({ type: "request-bounds" });
    for (const eventName of WINDOW_GEOMETRY_EVENTS) {
      win.on(eventName, requestBounds);
      this.windowEventOffs.push(() => win.removeListener(eventName, requestBounds));
    }
  }

  // ---------------------------------------------------------------- 状态回推
  snapshot() {
    if (!this.view) {
      return { url: "", title: "", loading: false, canGoBack: false, canGoForward: false };
    }
    const wc = this.view.webContents;
    let canGoBack = false;
    let canGoForward = false;
    try {
      canGoBack = wc.navigationHistory.canGoBack();
      canGoForward = wc.navigationHistory.canGoForward();
    } catch {
      // navigationHistory 不可用时回退 false。
    }
    return {
      url: wc.getURL(),
      title: this.currentTitle || (wc.getTitle?.() ?? "") || wc.getURL(),
      loading: wc.isLoading(),
      canGoBack,
      canGoForward,
    };
  }

  pushState() {
    this.dispatch({ type: "state", ...this.snapshot() });
  }

  /** 主→渲染 事件（仅当主页面是 backend 页时派发）。 */
  dispatch(payload) {
    const win = this.getWindow();
    if (!win || win.isDestroyed()) return;
    if (!this.isBackendUrl(win.webContents.getURL())) return;
    void win.webContents
      .executeJavaScript(
        `window.dispatchEvent(new CustomEvent(${JSON.stringify(EVENT_NAME)}, { detail: ${JSON.stringify(payload)} }))`,
      )
      .catch(() => {});
  }

  // ---------------------------------------------------------------- 清理
  destroy() {
    this.log("browser controller destroyed");
    for (const off of this.windowEventOffs) off();
    this.windowEventOffs = [];
    if (this.view) {
      for (const [name, handler] of this.viewHandlers) {
        try {
          this.view.webContents.removeListener(name, handler);
        } catch {
          // 忽略清理期异常
        }
      }
      this.viewHandlers = [];
      // 主题模拟用的 CDP debugger：随视图一起释放。
      try {
        if (this.view.webContents.debugger.isAttached()) {
          this.view.webContents.debugger.detach();
        }
      } catch {
        // 忽略
      }
      const win = this.getWindow();
      try {
        if (win && !win.isDestroyed()) win.contentView.removeChildView(this.view);
      } catch {
        // 窗口可能已销毁
      }
      this.view = null;
    }
    if (this.ses) {
      try {
        this.ses.removeAllListeners("will-download");
      } catch {
        // 忽略
      }
      this.ses = null;
    }
  }
}