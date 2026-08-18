/**
 * dsh-desktop-browser — client half.
 *
 * 「内置浏览器」工作台页签（P0 骨架）：
 *   - 注册进 desktop.workbench（registerTab id "browser", order 20）；
 *   - 「功能增强」聚合卡片开关（desktop.features.item，id "browser", order 20）；
 *   - BrowserPanel 占位 UI：工具栏（后退/前进/刷新/地址栏/新标签）+ 状态区，
 *     内容区域由主进程 WebContentsView 原生视图覆盖渲染；
 *   - browserBridge（渲染侧桥）：经 console 标记 __DSH_BROWSER_CMD__:<json>
 *     发命令给主进程（navigate/back/forward/reload/bounds/visibility/…），
 *     经 CustomEvent dsh-desktop-browser-event 收主进程回推的状态；
 *   - 面板根元素 ResizeObserver + rAF 节流上报 bounds；aria-modal 浮层打开时
 *     通知主进程隐藏原生视图（z-order 联动）。
 *
 * P0 范围：桥骨架 + 占位面板。多标签/历史/搜索页/安全收口/U2/U3 见设计文档
 * （desktop-shell/docs/browser-panel-design.md）后续阶段。
 */
window.__ModuleLoader__.load({
  id: "dsh-desktop-browser",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react_jsx_runtime = require("react/jsx-runtime");
    let react = require("react");
    let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
    const { jsx, jsxs, Fragment } = react_jsx_runtime;
    const { createElement } = react;
    const { IconGlobeOutline14 } = _deepseek_ai_dsh_client_ui_primitives;

    //#region 常量
    const NS = "desktop-browser";
    const CONFIG_URL = "/api/desktop-browser/config";
    const PREFS_URL = "/api/desktop-browser/prefs";
    const CMD_MARKER = "__DSH_BROWSER_CMD__:";
    const EVENT_NAME = "dsh-desktop-browser-event";
    const ddbrRetryMs = 500;
    const ddbrRetryLimit = 20;
    const ddbrDefaultConfig = { enabled: true };
    const ddbrCollapseWidth = 4; // bounds 宽度低于该值视为面板已收起
    /**
     * 渲染区比例预设表：新增设备（iPhone/iPad 等）只往这里加条目，
     * 并同步 host 端 prefs 白名单（lib/index.js 的 VIEWPORT_RATIO_VALUES）。
     * ratio: null 表示「自适应」铺满面板。
     */
    const VIEWPORT_RATIOS = {
      "16:9": { label: "16:9", ratio: 16 / 9 },
      "4:3": { label: "4:3", ratio: 4 / 3 },
      "1:1": { label: "1:1", ratio: 1 },
      "9:16": { label: "9:16", ratio: 9 / 16 },
      fill: { label: "fill", ratio: null },
    };
    const ddbrDefaultRatio = "16:9";
    //#endregion

    //#region 渲染侧桥
    /** 发命令给主进程（console 标记通道，与托盘/更新同款）。 */
    const bridge = {
      send(message) {
        try {
          console.log(CMD_MARKER + JSON.stringify(message));
        } catch {
          /* 命令丢失不影响主界面 */
        }
      },
      /** 订阅主进程回推事件；返回 disposer。 */
      onEvent(handler) {
        const listener = (event) => {
          try {
            handler(event.detail);
          } catch {
            /* 单个事件损坏不影响面板 */
          }
        };
        window.addEventListener(EVENT_NAME, listener);
        return () => window.removeEventListener(EVENT_NAME, listener);
      },
    };
    //#endregion

    //#region URL 校验（镜像主进程规则；P0 只做协议 + 环回地址）
    const LOOPBACK_PATTERNS = [
      /^localhost$/i,
      /^127\./,
      /^0\.0\.0\.0$/,
      /^::1$/,
      /^0:0:0:0:0:0:0:1$/,
    ];
    /**
     * 解析输入；带「寄主:端口」启发式（镜像主进程）：
     * WHATWG 的 scheme 允许点号，"example.com:8080" 会被解析成 scheme
     * "example.com:"——但地址栏里这是 host:port，凡 scheme 含点号即视为
     * 无 scheme 输入，走补 https 路径。
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
     * 规范化 + 校验导航目标（镜像主进程规则）。
     * 输入自带非 http(s) 协议（file:/javascript:/data: 等）直接拒绝，
     * 不能靠补前缀绕过去；无协议前缀时：形如 "host:port"（数字端口）按 http
     * 补全，其余按 https；自带 scheme 是环回名（"localhost:8080" 被 URL 规范
     * 解析成 scheme "localhost:"）回报 localhost 而非协议错误。
     * @returns {{ ok: true, url: string } | { ok: false, reason: string }}
     */
    function validateNavUrl(raw) {
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
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        const scheme = parsed.protocol.slice(0, -1).toLowerCase();
        for (const pattern of LOOPBACK_PATTERNS) {
          if (pattern.test(scheme)) return { ok: false, reason: "localhost" };
        }
        return { ok: false, reason: "protocol" };
      }
      const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
      for (const pattern of LOOPBACK_PATTERNS) {
        if (pattern.test(host)) return { ok: false, reason: "localhost" };
      }
      return { ok: true, url: parsed.href };
    }
    //#endregion

    //#region 样式（P0 最小工具栏样式，官方 token——以 dsh-client-ui-theme 的
    // design-platform.css 为准：边框是 --dsw-alias-border-*、悬停是
    // --dsw-alias-interactive-bg-*、强调色是 --dsw-alias-brand-*、警示是
    // --dsw-alias-state-warn-*。勿自造不存在的 token 名，否则深色模式
    // 回退浅色兜底值（此前 --dsw-alias-line-* / bg-input / hover / accent
    // 均不存在，导致深色模式下工具栏发白）。
    const STYLE_TEXT = [
      ".ddbr_root{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base, #ffffff)}",
      ".ddbr_toolbar{flex:none;display:flex;align-items:center;gap:4px;padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06))}",
      ".ddbr_btn{flex:none;width:26px;height:26px;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary, #81858c);cursor:pointer;background:transparent;border:none}",
      ".ddbr_btn:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06))}",
      ".ddbr_btn:disabled{opacity:.35;cursor:default}",
      ".ddbr_addr{flex:1;min-width:0;height:26px;border:1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.12));border-radius:8px;background:var(--dsw-alias-bg-layer-1, #ffffff);padding:0 9px;font-size:12px;color:var(--dsw-alias-label-primary, #0f1115);outline:none}",
      ".ddbr_addr:focus{border-color:var(--dsw-alias-brand-primary, #3964fe);box-shadow:0 0 0 2px var(--dsw-alias-interactive-bg-hover-accent, rgba(65,118,230,.15))}",
      ".ddbr_vw_wrap{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative;background:var(--dsw-alias-bg-base, #ffffff)}",
      ".ddbr_viewport{flex:none;position:relative;overflow:hidden;background:var(--dsw-alias-bg-base, #ffffff)}",
      ".ddbr_hint{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary, #81858c);font-size:12px;gap:8px;pointer-events:none}",
      ".ddbr_banner{flex:none;padding:6px 10px;font-size:11.5px;line-height:1.5;color:var(--dsw-alias-state-warn-label, #b45309);background:var(--dsw-alias-state-warn-tertiary, rgba(245,158,11,.12));border-top:1px solid var(--dsw-alias-state-warn-primary, rgba(245,158,11,.35))}",
      ".ddbr_status{flex:none;display:flex;align-items:center;gap:8px;padding:0 8px 4px;font-size:10.5px;color:var(--dsw-alias-label-tertiary, #81858c)}",
      ".ddbr_ratio{flex:none;margin-left:auto;height:20px;border:1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08));border-radius:6px;background:var(--dsw-alias-bg-layer-1, #ffffff);color:var(--dsw-alias-label-secondary, #61666b);font-size:10.5px;padding:0 4px;outline:none}",
    ].join("\n");
    /** 注入样式（data-plugin 归属本插件，重复注入 no-op）。 */
    function installStyle() {
      if (document.getElementById("dsh-desktop-browser-style")) return () => {};
      const style = document.createElement("style");
      style.id = "dsh-desktop-browser-style";
      style.setAttribute("data-plugin", "dsh-desktop-browser");
      style.textContent = STYLE_TEXT;
      document.head.appendChild(style);
      return () => {
        style.remove();
      };
    }
    //#endregion

    //#region 简明化辅助
    function clampBoundsRect(rect) {
      const n = (v, min) => (Number.isFinite(v) ? Math.max(min, Math.round(v)) : null);
      const x = n(rect?.x, 0);
      const y = n(rect?.y, 0);
      const width = n(rect?.width, 0);
      const height = n(rect?.height, 0);
      if (x === null || y === null || width === null || height === null) {
        return null;
      }
      return { x, y, width, height };
    }
    //#endregion

    //#region 浮层检测（z-order 联动）
    /**
     * 官方浮层标记（运行时时源码核实，dsh-client-ui-* 包）：
     *   - 模态/设置/附件选择/确认框 = role="dialog"（primitive Modal 另带 aria-modal）
     *   - 命令菜单（/）与输入联想 = role="listbox"
     *   - 模型选择/通用菜单 = role="menu"
     *   - 官方 shell 浮层层 = [data-shell-overlay]（有内容时）
     * 命中即隐藏原生视图（原生视图永远渲染在 DOM 之上，隐藏是唯一的 z-order 解法）。
     */
    const OVERLAY_SELECTORS = [
      '[role="dialog"]',
      '[role="menu"]',
      '[role="listbox"]',
      '[aria-modal="true"]',
      '[data-shell-overlay] > *',
    ];
    /** 当前是否有可见的官方浮层（排除 display:none / visibility:hidden / 无布局）。 */
    function isOverlayVisible() {
      if (typeof document.querySelector !== "function") return false;
      for (const selector of OVERLAY_SELECTORS) {
        let node = null;
        try {
          node = document.querySelector(selector);
        } catch {
          return false;
        }
        if (node === null) continue;
        const rects = node.getClientRects();
        if (rects.length === 0) continue;
        let style = null;
        try {
          style = window.getComputedStyle(node);
        } catch {
          return true; // 拿不到样式时保守视为可见浮层
        }
        if (style.display === "none" || style.visibility === "hidden") continue;
        return true;
      }
      return false;
    }
    //#endregion

    //#region BrowserPanel（P0 占位：工具栏 + 状态区；内容区由原生视图覆盖）
    function BrowserPanel(props) {
      const t = props.t;
      const rootRef = react.useRef(null);
      // 渲染区（工具栏/横幅/状态栏之外的那块）：原生视图的 bounds 必须对齐
      // 这块，而不是整个面板根——否则视图会把工具栏盖住、页面撑满面板。
      const viewportRef = react.useRef(null);
      // 渲染区宿主：按比例适配时负责居中；fill 时铺满。
      const wrapRef = react.useRef(null);
      const reportRef = react.useRef(null);
      const mountedRef = react.useRef(true);
      // 首帧尺寸未算出前不向主进程报 bounds（主进程保持隐藏，防闪屏）。
      const sizeReadyRef = react.useRef(false);
      const [address, setAddress] = react.useState("");
      const [ratio, setRatio] = react.useState(ddbrDefaultRatio);
      const [viewportSize, setViewportSize] = react.useState({ width: 0, height: 0 });
      const [state, setState] = react.useState({
        url: "",
        title: "",
        loading: false,
        canGoBack: false,
        canGoForward: false,
        blocked: null,
      });

      // 主进程回推 → 更新面板状态（P0 只展示；后续阶段驱动标签/历史）。
      react.useEffect(() => {
        const off = bridge.onEvent((message) => {
          if (!message || typeof message !== "object") return;
          if (message.type === "state") {
            setState((s) => ({
              ...s,
              url: typeof message.url === "string" ? message.url : s.url,
              title: typeof message.title === "string" ? message.title : s.title,
              loading: Boolean(message.loading),
              canGoBack: Boolean(message.canGoBack),
              canGoForward: Boolean(message.canGoForward),
              blocked: null,
            }));
          } else if (message.type === "nav-blocked") {
            setState((s) => ({
              ...s,
              blocked: { url: message.url ?? "", reason: message.reason ?? "protocol" },
            }));
          } else if (message.type === "load-error") {
            setState((s) => ({
              ...s,
              blocked: {
                url: message.url ?? "",
                reason: "load-error",
                detail: message.description ?? "",
              },
            }));
          } else if (message.type === "request-bounds") {
            // 主进程（窗口移动等）请求刷新 bounds → 立即补报。
            if (typeof reportRef.current === "function") reportRef.current(true);
          }
        });
        return off;
      }, []);

      // 面板根：尺寸上报 + 可见性 + 浮层联动。
      react.useEffect(() => {
        mountedRef.current = true;
        const root = rootRef.current;
        if (!root) return;
        let raf = 0;
        const report = (force) => {
          if (!mountedRef.current) return;
          if (!force && raf !== 0) return;
          raf = 0;
          const rootRect = root.getBoundingClientRect();
          const collapsed =
            rootRect.width < ddbrCollapseWidth || rootRect.height < 1;
          if (collapsed || isOverlayVisible()) {
            bridge.send({ type: "visibility", visible: false });
            return;
          }
          const viewport = viewportRef.current;
          // 比例适配的首帧尺寸未算好前不报 bounds（主进程保持隐藏，防闪屏）。
          if (!viewport || !sizeReadyRef.current) return;
          const clamped = clampBoundsRect(viewport.getBoundingClientRect());
          if (clamped === null) return;
          bridge.send({ type: "bounds", rect: clamped });
          bridge.send({ type: "visibility", visible: true });
        };
        const schedule = () => {
          if (raf !== 0) return;
          raf = requestAnimationFrame(() => report(false));
        };
        reportRef.current = (force) => report(Boolean(force));
        let ro = null;
        try {
          ro = new ResizeObserver(schedule);
          ro.observe(root);
          // 渲染区自身也观察：切比例时 root/wrap 尺寸不变、只有渲染区
          // 变（16:9↔9:16），不观察它 bounds 就永远不会重报。
          const viewportEl = viewportRef.current;
          if (viewportEl) ro.observe(viewportEl);
        } catch {
          ro = null;
        }
        const onResize = () => schedule();
        window.addEventListener("resize", onResize);
        let overlayObserver = null;
        try {
          overlayObserver = new MutationObserver(schedule);
          overlayObserver.observe(document.documentElement ?? document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["aria-modal", "role"],
          });
        } catch {
          overlayObserver = null;
        }
        schedule();
        return () => {
          mountedRef.current = false;
          reportRef.current = null;
          bridge.send({ type: "visibility", visible: false });
          if (raf !== 0) cancelAnimationFrame(raf);
          if (ro !== null) ro.disconnect();
          window.removeEventListener("resize", onResize);
          if (overlayObserver !== null) overlayObserver.disconnect();
        };
      }, []);

      // 渲染区按比例适配：wrap 尺寸变化 → 计算 fit 后的 viewport 尺寸。
      // 比例预设见 VIEWPORT_RATIOS（新增设备只加条目 + host 白名单同步）。
      react.useEffect(() => {
        const wrap = wrapRef.current;
        if (!wrap) return;
        let ro = null;
        const apply = () => {
          const rect = wrap.getBoundingClientRect();
          const w = Math.max(0, rect.width);
          const h = Math.max(0, rect.height);
          const preset =
            VIEWPORT_RATIOS[ratio] ?? VIEWPORT_RATIOS[ddbrDefaultRatio];
          let size;
          if (preset.ratio === null) {
            size = { width: w, height: h };
          } else {
            let bw = w;
            let bh = bw / preset.ratio;
            if (bh > h) {
              bh = h;
              bw = bh * preset.ratio;
            }
            size = {
              width: Math.max(1, Math.round(bw)),
              height: Math.max(1, Math.round(bh)),
            };
          }
          sizeReadyRef.current = true;
          setViewportSize((prev) => {
            if (prev.width === size.width && prev.height === size.height) {
              return prev;
            }
            // 尺寸真的变了：记录 + 主动补报 bounds（双保险：即使 RO 链路
            // 有问题，这里也会在样式应用后的下一帧重报）。
            bridge.send({
              type: "debug",
              note: "ratio-fit",
              value: `${ratio} ${size.width}x${size.height}`,
            });
            requestAnimationFrame(() => {
              if (typeof reportRef.current === "function") {
                reportRef.current(true);
              }
            });
            return size;
          });
        };
        apply();
        try {
          ro = new ResizeObserver(apply);
          ro.observe(wrap);
        } catch {
          ro = null;
        }
        return () => {
          if (ro !== null) ro.disconnect();
        };
      }, [ratio]);

      // 读取持久化比例偏好（host /prefs；不用 localStorage，端口每次启动变化）。
      react.useEffect(() => {
        let cancelled = false;
        fetch(PREFS_URL, {
          headers: { accept: "application/json" },
          cache: "no-store",
        })
          .then((res) =>
            res.ok ? res.json() : Promise.reject(new Error("prefs-http")),
          )
          .then((body) => {
            const value = body?.prefs?.["browser.viewportRatio"];
            if (
              !cancelled &&
              typeof value === "string" &&
              value in VIEWPORT_RATIOS
            ) {
              setRatio(value);
            }
          })
          .catch(() => {});
        return () => {
          cancelled = true;
        };
      }, []);

      const changeRatio = (event) => {
        const value = event.target.value;
        setRatio(value);
        // 诊断标记：确认选择器 onChange 是否触发（backend.log 可见）。
        bridge.send({ type: "debug", note: "ratio-change", value });
        void fetch(PREFS_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prefs: { "browser.viewportRatio": value } }),
        }).catch(() => {});
      };

      const navigate = (event) => {
        event.preventDefault();
        const result = validateNavUrl(address);
        if (!result.ok) {
          setState((s) => ({
            ...s,
            blocked: { url: address, reason: result.reason },
          }));
          return;
        }
        setState((s) => ({ ...s, blocked: null }));
        bridge.send({ type: "navigate", url: result.url });
      };

      const goBack = () => bridge.send({ type: "back" });
      const goForward = () => bridge.send({ type: "forward" });
      const reload = () => bridge.send({ type: "reload" });
      const newTab = () => bridge.send({ type: "new-tab", url: "" });

      const blockedText =
        state.blocked === null
          ? null
          : state.blocked.reason === "localhost"
            ? t("blocked.localhost")
            : state.blocked.reason === "load-error"
              ? `${t("blocked.loadError")}${state.blocked.detail ? `：${state.blocked.detail}` : ""}`
              : t("blocked.protocol");

      return jsx("div", {
        ref: rootRef,
        className: "ddbr_root",
        children: [
          jsx("div", {
            className: "ddbr_toolbar",
            children: [
              jsx("button", {
                type: "button",
                className: "ddbr_btn",
                title: t("toolbar.back"),
                disabled: !state.canGoBack,
                onClick: goBack,
                children: jsx("svg", {
                  width: 15,
                  height: 15,
                  viewBox: "0 0 16 16",
                  fill: "none",
                  stroke: "currentColor",
                  strokeWidth: 1.6,
                  strokeLinecap: "round",
                  strokeLinejoin: "round",
                  children: jsx("path", { d: "M10 3 5 8l5 5" }),
                }),
              }),
              jsx("button", {
                type: "button",
                className: "ddbr_btn",
                title: t("toolbar.forward"),
                disabled: !state.canGoForward,
                onClick: goForward,
                children: jsx("svg", {
                  width: 15,
                  height: 15,
                  viewBox: "0 0 16 16",
                  fill: "none",
                  stroke: "currentColor",
                  strokeWidth: 1.6,
                  strokeLinecap: "round",
                  strokeLinejoin: "round",
                  children: jsx("path", { d: "m6 3 5 5-5 5" }),
                }),
              }),
              jsx("button", {
                type: "button",
                className: "ddbr_btn",
                title: t("toolbar.reload"),
                disabled: state.loading,
                onClick: reload,
                children: jsx(IconRefresh14Fallback, { loading: state.loading }),
              }),
              jsx("form", {
                className: "ddbr_addr_form",
                style: { flex: 1, minWidth: 0, display: "flex" },
                onSubmit: navigate,
                children: jsx("input", {
                  className: "ddbr_addr",
                  type: "text",
                  spellCheck: false,
                  placeholder: t("address.placeholder"),
                  value: address,
                  onChange: (event) => setAddress(event.target.value),
                }),
              }),
              jsx("button", {
                type: "button",
                className: "ddbr_btn",
                title: t("toolbar.newTab"),
                onClick: newTab,
                children: jsx("svg", {
                  width: 15,
                  height: 15,
                  viewBox: "0 0 16 16",
                  fill: "none",
                  stroke: "currentColor",
                  strokeWidth: 1.6,
                  strokeLinecap: "round",
                  strokeLinejoin: "round",
                  children: jsx("path", { d: "M8 3v10M3 8h10" }),
                }),
              }),
            ],
          }),
          state.blocked !== null
            ? jsx("div", { className: "ddbr_banner", children: blockedText })
            : null,
          jsx("div", {
            ref: wrapRef,
            className: "ddbr_vw_wrap",
            children: jsx("div", {
              ref: viewportRef,
              className: "ddbr_viewport",
              style: {
                width:
                  viewportSize.width > 0 ? `${viewportSize.width}px` : undefined,
                height:
                  viewportSize.height > 0 ? `${viewportSize.height}px` : undefined,
              },
              children: jsxs(Fragment, {
                children: [
                  jsx("div", {
                    className: "ddbr_hint",
                    children: jsxs(Fragment, {
                      children: [
                        jsx(IconGlobeOutline14, { size: 14 }),
                        state.url === "" ? t("viewport.placeholder") : state.url,
                      ],
                    }),
                  }),
                ],
              }),
            }),
          }),
          jsx("div", {
            className: "ddbr_status",
            children: [
              state.loading
                ? t("status.loading")
                : t("status.ready", {
                    url: state.title || state.url || "—",
                  }),
              jsx("select", {
                className: "ddbr_ratio",
                title: t("ratio.title"),
                value: ratio,
                onChange: changeRatio,
                children: Object.keys(VIEWPORT_RATIOS).map((key) =>
                  jsx("option", {
                    key,
                    value: key,
                    children: t(`ratio.${key}`),
                  }),
                ),
              }),
            ],
          }),
        ],
      });
    }

    /** P0 刷新图标：用官方 IconRefreshOutline16 外观兜底的内联 SVG。 */
    function IconRefresh14Fallback({ loading }) {
      if (loading) {
        return jsx("svg", {
          width: 15,
          height: 15,
          viewBox: "0 0 16 16",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.6,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          children: jsx("path", { d: "M8 3a5 5 0 1 1-4.9 6" }),
        });
      }
      return jsx("svg", {
        width: 15,
        height: 15,
        viewBox: "0 0 16 16",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.6,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        children: jsx("path", { d: "M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3" }),
      });
    }
    //#endregion

    //#region 配置读写
    /** 读开关：失败回退默认（全开）。 */
    function loadBrowserConfig() {
      return fetch(CONFIG_URL, {
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
            body && typeof body.enabled === "boolean"
              ? body.enabled
              : ddbrDefaultConfig.enabled,
        }))
        .catch(() => ({ ...ddbrDefaultConfig }));
    }

    /** 写开关；解析为是否被接受。 */
    function saveBrowserConfig(enabled) {
      return fetch(CONFIG_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      })
        .then((res) => res.ok)
        .catch(() => false);
    }
    //#endregion

    //#region 词典
    const zh = {
      "feature.title": "内置浏览器",
      "feature.description": "工作台「浏览器」页签：原生视图渲染网页，支持登录态、前后进与多标签（P0 骨架阶段）。",
      "tab.title": "浏览器",
      "address.placeholder": "输入网址，回车打开…",
      "toolbar.back": "后退",
      "toolbar.forward": "前进",
      "toolbar.reload": "刷新",
      "toolbar.newTab": "新标签页",
      "viewport.placeholder": "浏览器视图（按地址栏回车或输入网址开始浏览）",
      "status.loading": "加载中…",
      "status.ready": "{url}",
      "blocked.protocol": "该地址仅支持 http/https 协议。",
      "blocked.localhost": "出于安全考虑，已拦截本机地址（保护本地的 DSH 服务）。",
      "blocked.loadError": "页面加载失败",
      "ratio.title": "渲染区比例",
      "ratio.16:9": "16:9 桌面",
      "ratio.4:3": "4:3",
      "ratio.1:1": "1:1",
      "ratio.9:16": "9:16 竖屏",
      "ratio.fill": "自适应铺满",
    };
    const en = {
      "feature.title": "Built-in Browser",
      "feature.description": "Browser tab in the workbench: native view rendering, login-aware, back/forward and tabs (P0 skeleton).",
      "tab.title": "Browser",
      "address.placeholder": "Enter a URL and press Enter…",
      "toolbar.back": "Back",
      "toolbar.forward": "Forward",
      "toolbar.reload": "Reload",
      "toolbar.newTab": "New tab",
      "viewport.placeholder": "Browser view (enter a URL above to start)",
      "status.loading": "Loading…",
      "status.ready": "{url}",
      "blocked.protocol": "Only http/https addresses are allowed.",
      "blocked.localhost": "Local addresses are blocked for security (protects the local DSH service).",
      "blocked.loadError": "Page failed to load",
      "ratio.title": "Viewport ratio",
      "ratio.16:9": "16:9 Desktop",
      "ratio.4:3": "4:3",
      "ratio.1:1": "1:1",
      "ratio.9:16": "9:16 Portrait",
      "ratio.fill": "Fill panel",
    };
    //#endregion

    //#region 入口
    const inject = ["slots", "locale"];
    function apply(ctx) {
      const t = ctx.locale.bind(NS);
      ctx.effect(
        () =>
          ctx.locale.register(NS, {
            zh,
            en,
          }),
        "dsh-desktop-browser: dictionaries",
      );

      // 「功能增强」聚合卡片开关（order 20）。
      ctx.slots.inject("desktop.features.item", () =>
        ctx.slots.register(
          {
            name: "desktop.features.item",
            id: "browser",
            order: 20,
            locale: NS,
            inject: () => ({
              load: () => loadBrowserConfig().then((config) => config.enabled),
              save: (enabled) => saveBrowserConfig(enabled),
              title: t("feature.title"),
              description: t("feature.description"),
            }),
          },
          () => null,
        ),
      );

      // 行为安装：默认全开先装，配置到达后收敛。
      const installFeature = (config) => {
        const disposers = [];
        if (config.enabled) {
          const disposeStyle = installStyle();
          disposers.push(disposeStyle);
          const disposeTab = installBrowserTab(ctx, t);
          if (typeof disposeTab === "function") disposers.push(disposeTab);
        }
        return disposers;
      };
      let active = [];
      const applyConfig = (config) => {
        for (const dispose of active) dispose();
        active = installFeature(config);
      };
      applyConfig({ ...ddbrDefaultConfig });
      void loadBrowserConfig().then(applyConfig);
    }

    /** 等待 workbench 服务并注册浏览器页签；返回 disposer。 */
    function installBrowserTab(ctx, t) {
      const disposers = [];
      let attempts = 0;
      let workbench = null;
      const install = () => {
        if (workbench !== null) return;
        let candidate;
        try {
          candidate = ctx.get("desktop.workbench");
        } catch {
          candidate = void 0;
        }
        if (candidate === void 0) {
          if (attempts < ddbrRetryLimit) {
            attempts += 1;
            setTimeout(install, ddbrRetryMs);
          }
          return;
        }
        workbench = candidate;
        // 面板由 workbench 渲染时会收到 workbench 词典的 t，这里用本插件
        // 自己的 t 覆盖，保证面板文案归属 desktop-browser 词典。
        const BrowserPanelWithT = (props) =>
          createElement(BrowserPanel, { ...props, t });
        disposers.push(
          workbench.registerTab({
            id: "browser",
            title: t("tab.title"),
            icon: IconGlobeOutline14,
            order: 20,
            component: BrowserPanelWithT,
          }),
        );
      };
      install();
      return () => {
        for (const dispose of disposers) dispose();
      };
    }
    //#endregion

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});