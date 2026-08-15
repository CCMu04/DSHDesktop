/**
 * dsh-desktop-workbench — browser half.
 *
 * 工作台框架：作为「对话页内部右侧分栏」存在——聊天界面对话视图（chat）的
 * 右边、官方「对话 / 轨迹」页签栏下方；只有对话页签激活时显示，切换到轨迹
 * 页签时自动隐藏（ChatView 卸载即消失）。
 *
 * 职责边界（框架不承载任何功能）：
 *   - 在官方 ChatView 根（[data-chat-flow] 的祖先容器）上做两列 grid 分栏：
 *     左列 = 官方消息流，右列 = 工作台；工作台列高度钉在滚动视口
 *     （[data-conversation-scroll] 的 clientHeight）内，消息流滚动时工作台
 *     保持可见；
 *   - 打开方式：官方 Header 页签行右端（conversation.session.header.utilities
 *     槽位）注册 [|] 图标按钮（官方 IconPanelLeftOutline16），点击切换开合；
 *   - 无独立标题行：不显示「工作台」字样，页签栏（文件 / Git …）紧凑排在
 *     列顶，不与官方页签行对齐；
 *   - 提供服务 ctx.provide('desktop.workbench')：
 *       registerTab / registerViewer / activateTab / updateTab /
 *       openFile / closeFile / collapse / getSnapshot / subscribe / onAction；
 *   - 在「功能增强」聚合卡片注册框架总开关（order 5）。
 *
 * 功能插件（文件 / Git 等）通过 inject: ['desktop.workbench'] 拿到服务，
 * 注册自己的 Tab 与文件预览器。会话级布局（打开状态 / 宽度 / 激活 tab /
 * 打开的文件）经 host 端 /api/desktop-workbench/layout 持久化。
 *
 * 关于注入的稳健性：
 *   - ChatView 只在对话页签激活时挂载（conversation.view 槽位按激活视图
 *     渲染），视图切换时整棵子树卸载；用 MutationObserver 跟随
 *     [data-chat-flow] 的出现/消失，重新挂载列并恢复布局状态；
 *   - React 收敛子节点时可能摘掉我们追加的列，childList 观察器自愈重挂；
 *   - 滚动视口高度变化（窗口 resize / 官方 details 开合）由 ResizeObserver
 *     跟随，工作台列高度实时同步。
 */
window.__ModuleLoader__.load({
  id: "dsh-desktop-workbench",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react_jsx_runtime = require("react/jsx-runtime");
    let react = require("react");
    let react_dom_client = require("react-dom/client");
    let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
    const { jsx, jsxs } = react_jsx_runtime;
    const { createElement } = react;
    const {
      IconPanelLeftOutline16,
      IconChevronRightOutline14,
    } = _deepseek_ai_dsh_client_ui_primitives;

    //#region 常量与工具
    const NS = "desktop-workbench";
    const CONFIG_URL = "/api/desktop-workbench/config";
    const LAYOUT_URL = "/api/desktop-workbench/layout";
    const ddwbDefaultConfig = { enabled: true };
    /** sessions 服务未就绪时的重试上限与间隔（客户端插件可能先于核心加载）。 */
    const ddwbSessionRetryMs = 500;
    const ddwbSessionRetryLimit = 20;
    const ddwbLayoutWidthDefault = 380;
    const ddwbLayoutWidthMin = 240;
    const ddwbLayoutWidthMax = 720;
    const ddwbLayoutSaveDebounceMs = 400;
    /** 拖拽到该宽度以下时自动收起面板（小于最小可见宽度 240）。 */
    const ddwbCollapseWidth = 200;
    /** ChatView 根的特征：消息流容器（对话视图独有，轨迹视图不渲染）。 */
    const ddwbChatFlowSelector = '[data-chat-flow]';

    /**
     * 功能页签横向滚动：滚动条已隐藏，把鼠标滚轮的垂直滚动转成横向位移
     * （React 的 onWheel 是 passive，必须原生绑定）；无溢出时不消费滚轮，
     * 避免挡住页面本身的滚动。
     */
    function onTabsWheel(event) {
      const el = event.currentTarget;
      if (el.scrollWidth <= el.clientWidth) return;
      if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
        el.scrollLeft += event.deltaY;
        event.preventDefault();
      }
    }

    function ddwbClampWidth(width) {
      if (typeof width !== "number" || !Number.isFinite(width)) {
        return ddwbLayoutWidthDefault;
      }
      return Math.min(
        ddwbLayoutWidthMax,
        Math.max(ddwbLayoutWidthMin, Math.round(width)),
      );
    }

    /** 读取框架开关：失败回退默认（全开）。 */
    function loadWorkbenchConfig() {
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
              : ddwbDefaultConfig.enabled,
        }))
        .catch(() => ({ ...ddwbDefaultConfig }));
    }

    /** 写入框架开关；解析为是否被接受。 */
    function saveWorkbenchConfig(enabled) {
      return fetch(CONFIG_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      })
        .then((res) => res.ok)
        .catch(() => false);
    }
    //#endregion

    //#region 样式（紧凑页签栏 + 内容区；无标题行；对话页内分栏）
    // 工作台列顶：单行页签栏（文件 / Git …），不显示「工作台」标题字样，
    // 不与官方页签行对齐；列高度由 JS 钉在滚动视口内，内容区自行滚动。
    // 打开/关闭由官方 Header 页签行右端的 [|] 按钮控制，无右侧细条按钮。
    const css =
      ".ddwb_col{border-left:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);flex-direction:column;min-width:0;display:flex;position:relative;overflow:hidden}" +
      ".ddwb_header{border-bottom:1px solid var(--dsw-alias-border-l2);flex:none;position:relative;padding:4px 6px 0 10px}" +
      ".ddwb_tabsRow{flex:1;min-width:0;z-index:1;position:relative;display:flex;align-items:flex-end;gap:6px}" +
      ".ddwb_tabs{flex:1;min-width:0;display:flex;align-items:flex-end;gap:14px;overflow-x:auto;scrollbar-width:none}" +
      ".ddwb_tabs::-webkit-scrollbar{display:none}" +
      ".ddwb_toolBtn{appearance:none;flex:none;width:22px;height:22px;margin-bottom:5px;border:0;border-radius:6px;background:0 0;color:var(--dsw-alias-label-tertiary);cursor:pointer;display:inline-flex;align-items:center;justify-content:center}" +
      ".ddwb_toolBtn:hover:not(:disabled),.ddwb_toolBtn:focus-visible{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}" +
      ".ddwb_tab{color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;padding:0 0 7px;font-size:13px;font-weight:500;line-height:16px;white-space:nowrap;position:relative;display:inline-flex;align-items:center;gap:6px}" +
      ".ddwb_tabIcon{display:inline-flex;color:var(--dsw-alias-label-tertiary)}" +
      ".ddwb_tab:hover:not(:disabled),.ddwb_tab:focus-visible{color:var(--dsw-alias-label-primary)}" +
      ".ddwb_tab:after{content:\"\";background:0 0;border-radius:2px;height:2px;position:absolute;bottom:1px;left:0;right:0}" +
      ".ddwb_tabActive{color:var(--dsw-alias-label-primary)}" +
      ".ddwb_tabActive:after{background:var(--dsw-alias-brand-primary)}" +
      ".ddwb_tabBadge{min-width:16px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-layer-1);border-radius:999px;padding:0 5px;font-size:10px;line-height:16px;text-align:center}" +
      ".ddwb_handle{cursor:col-resize;z-index:3;touch-action:none;width:8px;margin-left:-4px;position:absolute;top:0;bottom:0;left:0;background:0 0;border:none;padding:0;display:grid;place-items:center;transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out)}" +
      ".ddwb_handle:hover,.ddwb_handle:active,.ddwb_handle:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}" +
      ".ddwb_handle:after{content:\"\";box-sizing:border-box;width:2px;height:100%;border-radius:2px;background:var(--dsw-alias-border-l2);transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out)}" +
      ".ddwb_handle:hover:after,.ddwb_handle:active:after,.ddwb_handle:focus-visible:after{background:var(--dsw-alias-brand-primary)}" +
      ".ddwb_body{flex:1;min-height:0;overflow:auto}" +
      ".ddwb_placeholder{padding:24px 16px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.6}" +
      ".ddwb_placeholderTitle{display:block;color:var(--dsw-alias-label-secondary);font-size:14px;font-weight:600;margin-bottom:4px}" +
      // Header 页签行右端的 [|] 开合按钮：与打开工作区/导出会话同排。
      ".ddwb_toggleBtn{box-sizing:border-box;min-height:28px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:0;border-radius:6px;align-items:center;gap:4px;padding:0 8px;display:inline-flex}.ddwb_toggleBtn:hover:not(:disabled),.ddwb_toggleBtn:focus-visible{color:var(--dsw-alias-label-secondary)}.ddwb_toggleBtnActive{color:var(--dsw-alias-brand-primary)}.ddwb_toggleBtnActive:hover:not(:disabled){color:var(--dsw-alias-brand-primary)}.ddwb_toggleBtn svg{flex:none}" +
      ".ddwb_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;padding:14px 16px;margin:12px}" +
      ".ddwb_cardTitle{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:600;line-height:1.4;margin-bottom:6px}" +
      ".ddwb_cardText{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.6;margin-bottom:10px}" +
      ".ddwb_row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}" +
      ".ddwb_btn{appearance:none;font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-module-platform);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:5px 10px;font-size:12px;line-height:18px;cursor:pointer}" +
      ".ddwb_btn:hover:not(:disabled),.ddwb_btn:focus-visible{border-color:var(--dsw-alias-label-dimmed)}" +
      ".ddwb_code{color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);font-size:12px;word-break:break-all}";
    const cssTagId = "dsh-desktop-workbench/Workbench.module.css";
    if (
      typeof document !== "undefined" &&
      document.querySelector("style[data-plugin-css=" + JSON.stringify(cssTagId) + "]") === null
    ) {
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-desktop-workbench";
      tag.dataset.pluginCss = cssTagId;
      tag.textContent = css;
      document.head.appendChild(tag);
    }
    //#endregion

    //#region 服务：desktop.workbench
    /**
     * Tab / viewer 注册表 + 动作通道 + 开合状态。
     *   - 注册表（tabs / viewers）经 getSnapshot / subscribe 暴露；
     *   - UI 状态（激活 tab / 打开的文件）属于列组件，动作经 onAction 分发，
     *     列未挂载时动作安全丢弃；开合状态（open）由服务持有，Header 按钮
     *     与列组件共享，视图切换（对话 ↔ 轨迹）后重新挂载时恢复。
     */
    function createWorkbenchService() {
      const tabs = new Map();
      const viewers = new Map();
      const listeners = new Set();
      const actionHandlers = new Set();
      const stateListeners = new Set();
      let open = false;
      const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);
      const snapshot = () => ({
        tabs: Array.from(tabs.values()).sort(byOrder),
        viewers: Array.from(viewers.values()).sort(byOrder),
      });
      const emit = () => {
        const snap = snapshot();
        for (const listener of Array.from(listeners)) {
          try {
            listener(snap);
          } catch {
            // A failing subscriber must not break the registry.
          }
        }
      };
      const emitState = () => {
        for (const listener of Array.from(stateListeners)) {
          try {
            listener(open);
          } catch {
            // A failing subscriber must not break the toggle.
          }
        }
      };
      const dispatchAction = (action) => {
        for (const handler of Array.from(actionHandlers)) {
          try {
            handler(action);
          } catch {
            // A failing column must not break the service.
          }
        }
      };
      return {
        /** 注册一个面板 Tab；返回 disposer。 */
        registerTab(descriptor) {
          if (
            !descriptor ||
            typeof descriptor.id !== "string" ||
            descriptor.id.length === 0
          ) {
            throw new Error("desktop.workbench: registerTab requires id");
          }
          if (tabs.has(descriptor.id)) {
            throw new Error(
              "desktop.workbench: duplicate tab id " + descriptor.id,
            );
          }
          tabs.set(descriptor.id, { order: 0, badge: 0, ...descriptor });
          emit();
          return () => {
            if (tabs.delete(descriptor.id)) emit();
          };
        },
        /** 注册一个文件预览器（按扩展名匹配，小写、含点）；返回 disposer。 */
        registerViewer(descriptor) {
          if (
            !descriptor ||
            typeof descriptor.id !== "string" ||
            descriptor.id.length === 0
          ) {
            throw new Error("desktop.workbench: registerViewer requires id");
          }
          if (viewers.has(descriptor.id)) {
            throw new Error(
              "desktop.workbench: duplicate viewer id " + descriptor.id,
            );
          }
          viewers.set(descriptor.id, { order: 0, extensions: [], ...descriptor });
          emit();
          return () => {
            if (viewers.delete(descriptor.id)) emit();
          };
        },
        /** 激活一个 Tab（切换内容区，关闭已打开的文件，同时打开面板）。 */
        activateTab(id) {
          if (!tabs.has(id)) return;
          this.setOpen(true);
          dispatchAction({ type: "activateTab", id });
        },
        /** 原位更新 Tab 描述（如角标）。 */
        updateTab(id, patch) {
          const tab = tabs.get(id);
          if (!tab || !patch || typeof patch !== "object") return;
          Object.assign(tab, patch);
          emit();
        },
        /** 打开一个文件：按扩展名匹配第一个 viewer，未匹配 viewerId 为 null。 */
        openFile(path) {
          if (typeof path !== "string" || path.length === 0) return;
          const dot = path.lastIndexOf(".");
          const ext = dot >= 0 ? path.slice(dot).toLowerCase() : "";
          const viewer = Array.from(viewers.values())
            .sort(byOrder)
            .find((v) =>
              (Array.isArray(v.extensions) ? v.extensions : []).some(
                (e) => String(e).toLowerCase() === ext,
              ),
            );
          dispatchAction({
            type: "openFile",
            path,
            viewerId: viewer ? viewer.id : null,
          });
        },
        /** 关闭当前打开的文件，回到 Tab 视图。 */
        closeFile() {
          dispatchAction({ type: "closeFile" });
        },
        /** 折叠面板（外部触发，如最后一个文件页签关闭时）。 */
        collapse() {
          this.setOpen(false);
          dispatchAction({ type: "collapsePanel" });
        },
        /** 切换面板开合（Header [|] 按钮）。 */
        toggle() {
          this.setOpen(!open);
        },
        /** 打开/收起面板（外部触发，如点击会话里的文件链接）。 */
        setOpen(value) {
          open = value === true;
          emitState();
        },
        /** 当前开合状态（Header 按钮高亮用）。 */
        isOpen() {
          return open;
        },
        /** 订阅开合状态；返回 disposer。 */
        onOpenChange(listener) {
          stateListeners.add(listener);
          return () => stateListeners.delete(listener);
        },
        getSnapshot: snapshot,
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        /** 列组件订阅动作通道；返回 disposer。 */
        onAction(handler) {
          actionHandlers.add(handler);
          return () => actionHandlers.delete(handler);
        },
      };
    }
    //#endregion

    //#region ChatView grid 集成
    /**
     * 找到对话视图根：消息流容器（[data-chat-flow]）向上两级。
     * 页面核心 bundle 可能晚于插件加载，调用方负责重试。
     */
    function findChatRoot() {
      try {
        const flow = document.querySelector(ddwbChatFlowSelector);
        if (flow === null) return null;
        return flow.parentElement?.parentElement ?? null;
      } catch {
        return null;
      }
    }

    /**
     * 找到对话区滚动视口（[data-conversation-scroll]），用于钉住工作台列高度。
     */
    function findChatViewport() {
      try {
        return document.querySelector('[data-conversation-scroll]');
      } catch {
        return null;
      }
    }

    /**
     * 把工作台列接进 ChatView 根：
     *   - ChatView 根变两列 grid（左 = 官方消息流，右 = 工作台），轨道宽度
     *     由 --ddwb-chat-track 变量控制（0 = 收起）；
     *   - 列高钉在滚动视口高度（[data-conversation-scroll].clientHeight），
     *     ResizeObserver 跟随视口变化；消息流滚动时工作台保持可见；
     *   - 视图切换（对话 ↔ 轨迹）时 ChatView 卸载，列随之消失；[data-chat-flow]
     *     重新出现时本插件重新挂载（见 installDock 的观察器）。
     * 返回 { setTrack(width), setOpenHeight(), dispose }。
     */
    function attachToChatRoot(root, column) {
      const WIDTH_VAR = "--ddwb-chat-track";
      const observers = [];
      let lastWidth = 0;
      let lastHeight = 0;
      const applyTrack = () => {
        column.style.gridColumn = "2";
        column.style.gridRow = "1";
        column.style.alignSelf = "start";
        // sticky：消息流（左列）在滚动视口内滚动时，工作台列钉在视口顶部。
        column.style.position = "sticky";
        column.style.top = "0";
        root.style.setProperty(WIDTH_VAR, String(lastWidth) + "px");
        // grid 分栏：左列 = 官方消息流（第一子元素），右列 = 工作台。
        root.style.display = "grid";
        root.style.gridTemplateColumns =
          "minmax(0, 1fr) var(--ddwb-chat-track, 0px)";
      };
      applyTrack();
      const syncHeight = () => {
        const viewport = findChatViewport();
        const height =
          viewport !== null && viewport.clientHeight > 0
            ? viewport.clientHeight
            : 0;
        if (height === lastHeight) return;
        lastHeight = height;
        if (height > 0) column.style.height = height + "px";
      };
      syncHeight();
      const viewportEl = findChatViewport();
      if (viewportEl !== null) {
        const viewportObserver = new ResizeObserver(() => {
          syncHeight();
        });
        viewportObserver.observe(viewportEl);
        observers.push(viewportObserver);
      }
      // React 重渲染可能摘掉列，childList 观察器自愈重挂。
      const childObserver = new MutationObserver(() => {
        if (!root.contains(column)) root.appendChild(column);
      });
      childObserver.observe(root, { childList: true });
      observers.push(childObserver);
      return {
        setTrack(width) {
          lastWidth = Math.max(0, Math.round(width));
          applyTrack();
        },
        setOpenHeight() {
          syncHeight();
        },
        dispose() {
          for (const observer of observers) observer.disconnect();
          root.style.removeProperty(WIDTH_VAR);
          root.style.removeProperty("display");
          root.style.removeProperty("grid-template-columns");
          column.remove();
        },
      };
    }
    //#endregion

    //#region 工作台列
    /**
     * 对话页右侧分栏：列顶页签栏 + 内容区 + 拖拽调宽 + 按会话持久化布局。
     * 内容区优先级：打开的文件（viewer）> 激活的 Tab > 空态提示。
     * 开合状态由服务持有（Header [|] 按钮切换），列渲染与否由宽度决定。
     */
    /** installDock 与列组件之间的桥：列节点、轨道 setter、当前轨道宽度。 */
    const ddwbBridge = { node: null, setTrack: null, trackWidth: 0 };

    /**
     * 列内错误边界：任何渲染错误显示占位文本而不是死空白，
     * 便于定位问题（正常情况不会触发）。
     */
    class WorkbenchErrorBoundary extends react.Component {
      constructor(props) {
        super(props);
        this.state = { error: null };
      }
      static getDerivedStateFromError(error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
      render() {
        if (this.state.error !== null) {
          return jsx("div", {
            className: "ddwb_placeholder",
            children: "dsh-desktop-workbench: " + this.state.error,
          });
        }
        return this.props.children;
      }
    }

    function WorkbenchColumn({ ctx, service, t }) {
      const [snap, setSnap] = react.useState(() => service.getSnapshot());
      const [open, setOpenState] = react.useState(() => service.isOpen());
      const [layout, setLayout] = react.useState({
        width: ddwbLayoutWidthDefault,
        activeTabId: null,
        file: null,
      });
      const [ready, setReady] = react.useState(false);
      const layoutRef = react.useRef(layout);
      layoutRef.current = layout;
      const currentIdRef = react.useRef(null);
      /** 左边缘把手拖拽状态：起点 X / 起始宽度 / 是否已产生位移。 */
      const dragRef = react.useRef(null);
      /** tab 栏引用：绑定滚轮横向滚动（无滚动条，直接滚动）。 */
      const tabsRef = react.useRef(null);
      const setTabsRef = (el) => {
        if (tabsRef.current === el) return;
        if (tabsRef.current !== null) {
          tabsRef.current.removeEventListener("wheel", onTabsWheel);
        }
        tabsRef.current = el;
        if (el !== null) {
          el.addEventListener("wheel", onTabsWheel, { passive: false });
        }
      };

      // 注册表快照订阅。
      react.useEffect(() => service.subscribe(setSnap), [service]);
      // 开合状态订阅（Header 按钮切换）。
      react.useEffect(
        () => service.onOpenChange(setOpenState),
        [service],
      );

      // 动作通道订阅：激活 tab / 打开文件 / 关闭文件。
      react.useEffect(
        () =>
          service.onAction((action) => {
            if (action.type === "activateTab") {
              setLayout((prev) => ({
                ...prev,
                activeTabId: action.id,
                file: null,
              }));
            } else if (action.type === "openFile") {
              setLayout((prev) => ({
                ...prev,
                activeTabId: null,
                file: { path: action.path, viewerId: action.viewerId },
              }));
            } else if (action.type === "closeFile") {
              setLayout((prev) => ({ ...prev, file: null }));
            }
          }),
        [service],
      );

      // 会话跟随 + 布局加载（只安装一次；列表快照频繁变化，仅 current 变化时重建）。
      react.useEffect(() => {
        let disposed = false;
        let attempts = 0;
        let retryTimer = null;
        let listOff = () => {};
        let currentId = null;
        const applyLayout = (id) => {
          currentIdRef.current = id;
          fetch(LAYOUT_URL + "?session=" + encodeURIComponent(id), {
            headers: { accept: "application/json" },
            cache: "no-store",
          })
            .then((res) => (res.ok ? res.json() : null))
            .then((body) => {
              if (disposed) return;
              const saved =
                body && typeof body.layout === "object" && body.layout !== null
                  ? body.layout
                  : null;
              setLayout((prev) => ({
                // 会话加载一律默认收起；宽度与活动页签仍按上次记忆。
                width: ddwbClampWidth(saved?.width ?? prev.width),
                activeTabId:
                  saved && typeof saved.activeTabId === "string"
                    ? saved.activeTabId
                    : prev.activeTabId,
                file: null,
              }));
              setReady(true);
            })
            .catch(() => {
              if (!disposed) setReady(true);
            });
        };
        const attach = () => {
          let sessions;
          try {
            sessions = ctx.get("sessions");
          } catch {
            sessions = void 0;
          }
          if (sessions === void 0) {
            if (attempts < ddwbSessionRetryLimit) {
              attempts += 1;
              retryTimer = setTimeout(attach, ddwbSessionRetryMs);
            } else {
              // 重试耗尽：不再等会话服务，直接就绪（布局降级为默认值），
              // 避免工作台列永久空白。
              setReady(true);
            }
            return;
          }
          const onList = () => {
            let listSnap;
            try {
              listSnap = sessions.list.getSnapshot();
            } catch {
              return;
            }
            const id = listSnap?.current ?? void 0;
            if (id === currentId) return;
            currentId = id ?? null;
            if (id === void 0) {
              currentIdRef.current = null;
              setReady(true);
              return;
            }
            applyLayout(id);
          };
          try {
            listOff = sessions.list.subscribe(onList);
          } catch {
            return;
          }
          onList();
        };
        attach();
        return () => {
          disposed = true;
          if (retryTimer !== null) clearTimeout(retryTimer);
          listOff();
        };
      }, [ctx, service]);

      // 布局变更 → 防抖持久化到当前会话。
      react.useEffect(() => {
        if (!ready || currentIdRef.current === null) return;
        const timer = setTimeout(() => {
          fetch(LAYOUT_URL, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              session: currentIdRef.current,
              layout: {
                open: service.isOpen(),
                width: layoutRef.current.width,
                activeTabId: layoutRef.current.activeTabId,
                file: layoutRef.current.file
                  ? layoutRef.current.file.path
                  : null,
              },
            }),
          }).catch(() => {});
        }, ddwbLayoutSaveDebounceMs);
        return () => clearTimeout(timer);
      }, [layout, open, ready, service]);

      // 打开状态 / 宽度 → 同步 grid 轨道（写 bridge 由 attach 的 setTrack 消费）。
      react.useEffect(() => {
        const width = open ? layout.width : 0;
        ddwbBridge.trackWidth = width;
        if (typeof ddwbBridge.setTrack === "function") {
          ddwbBridge.setTrack(width);
        }
      }, [open, layout.width]);

      if (!ready) return null;

      const activeTab =
        layout.activeTabId === null
          ? null
          : snap.tabs.find((tab) => tab.id === layout.activeTabId) ?? null;
      let view;
      if (layout.file !== null) {
        const viewer = snap.viewers.find(
          (v) => v.id === layout.file.viewerId,
        );
        view =
          viewer && typeof viewer.component === "function"
            ? createElement(viewer.component, {
                path: layout.file.path,
                t,
              })
            : jsxs("div", {
                className: "ddwb_placeholder",
                children: [
                  jsx("span", {
                    className: "ddwb_placeholderTitle",
                    children: t("noViewerTitle"),
                  }),
                  t("noViewerHint"),
                ],
              });
      } else if (activeTab && typeof activeTab.component === "function") {
        view = createElement(activeTab.component, { ctx, service, t });
      } else {
        view = jsxs("div", {
          className: "ddwb_placeholder",
          children: [
            jsx("span", {
              className: "ddwb_placeholderTitle",
              children: t("emptyTitle"),
            }),
            t("emptyHint"),
          ],
        });
      }

      return jsxs("div", {
        className: "ddwb_col",
        children: [
          // 左边缘拖拽条：常驻长条（无图标），拖拽调宽——按下时缓存基准
          // 宽度，拖拽中 rAF 节流后直接写轨道（不经过 React state），
          // 松手收敛一次状态触发持久化；无位移的按下释放 = 点击 → 收起。
          jsx("button", {
            type: "button",
            className: "ddwb_handle",
            title: t("resizePanel"),
            "aria-label": t("resizePanel"),
            onPointerDown: (event) => {
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              dragRef.current = {
                startX: event.clientX,
                startWidth: layoutRef.current.width,
                moved: false,
                rawWidth: layoutRef.current.width,
                lastWidth: layoutRef.current.width,
                raf: null,
              };
            },
            onPointerMove: (event) => {
              const drag = dragRef.current;
              if (drag === null) return;
              const dx = event.clientX - drag.startX;
              if (Math.abs(dx) > 3) drag.moved = true;
              if (!drag.moved) return;
              // rawWidth 不钳制：用于「拖到很窄自动收起」判断。
              drag.rawWidth = drag.startWidth - dx;
              drag.lastWidth = ddwbClampWidth(drag.rawWidth);
              if (drag.raf !== null) return;
              drag.raf = requestAnimationFrame(() => {
                drag.raf = null;
                // 拖到很窄（< 200px）→ 自动收起：轨道归 0、结束拖拽状态。
                if (drag.rawWidth < ddwbCollapseWidth) {
                  dragRef.current = null;
                  if (typeof ddwbBridge.setTrack === "function") {
                    ddwbBridge.setTrack(0);
                  }
                  service.setOpen(false);
                  return;
                }
                // 常规拖拽：rAF 节流后同步轨道（写 CSS 变量，不经过 React state）。
                if (typeof ddwbBridge.setTrack === "function") {
                  ddwbBridge.setTrack(drag.lastWidth);
                }
              });
            },
            onPointerUp: (event) => {
              const drag = dragRef.current;
              if (drag === null) return;
              dragRef.current = null;
              if (drag.raf !== null) {
                cancelAnimationFrame(drag.raf);
                drag.raf = null;
              }
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
              if (drag.moved) {
                if (drag.rawWidth < ddwbCollapseWidth) {
                  // 快速拖放：rAF 未及触发但宽度已低于收起阈值 → 直接收起。
                  if (typeof ddwbBridge.setTrack === "function") {
                    ddwbBridge.setTrack(0);
                  }
                  service.setOpen(false);
                } else {
                  // 拖拽结束：收敛一次状态（触发布局持久化），列宽已实时写入轨道。
                  setLayout((prev) => ({ ...prev, width: drag.lastWidth }));
                }
              } else {
                // 未产生位移 = 点击 → 收起。
                service.setOpen(false);
              }
            },
          }),
          jsxs("div", {
            className: "ddwb_header",
            children: [
              jsxs("div", {
                className: "ddwb_tabsRow",
                children: [
                  jsxs("div", {
                    className: "ddwb_tabs",
                    ref: setTabsRef,
                    children: snap.tabs.map((tab) =>
                      jsxs(
                        "button",
                        {
                          type: "button",
                          className:
                            tab.id === layout.activeTabId
                              ? "ddwb_tab ddwb_tabActive"
                              : "ddwb_tab",
                          onClick: () => service.activateTab(tab.id),
                          title: tab.title,
                          children: [
                            typeof tab.icon === "function"
                              ? jsx("span", {
                                  className: "ddwb_tabIcon",
                                  children: jsx(tab.icon, {
                                    size: 14,
                                    "aria-hidden": true,
                                  }),
                                })
                              : null,
                            typeof tab.title === "string" ? tab.title : tab.id,
                            typeof tab.badge === "number" && tab.badge > 0
                              ? jsx("span", {
                                  className: "ddwb_tabBadge",
                                  children: String(tab.badge),
                                })
                              : null,
                          ],
                        },
                        tab.id,
                      ),
                    ),
                  }),
                  // 右侧工具按钮：关闭工作台（收起面板，轨道归 0）。
                  jsx("button", {
                    type: "button",
                    className: "ddwb_toolBtn",
                    "aria-label": t("closePanel"),
                    title: t("closePanel"),
                    onClick: () => service.setOpen(false),
                    children: jsx(IconChevronRightOutline14, {
                      size: 14,
                      "aria-hidden": true,
                    }),
                  }),
                ],
              }),
            ],
          }),
          jsx("div", { className: "ddwb_body", children: view }),
        ],
      });
    }

    /** 挂载工作台列（对话页右侧分栏）；返回 disposer。 */
    function installDock(ctx, service, t) {
      const disposers = [];
      const column = document.createElement("div");
      column.className = "ddwb_col";
      column.dataset.ddwbTrack = String(ddwbBridge.trackWidth);
      ddwbBridge.node = column;
      const root = react_dom_client.createRoot(column);
      root.render(
        createElement(
          WorkbenchErrorBoundary,
          null,
          createElement(WorkbenchColumn, { ctx, service, t }),
        ),
      );
      disposers.push(() => {
        root.unmount();
      });

      // 接入 ChatView grid：对话视图可能晚于插件出现（页面加载 / 视图切换），
      // 用 MutationObserver 跟随 [data-chat-flow] 的出现与消失。
      // dispose 必须终止观察：否则已卸载的列会在后续 attach 时被“复活”。
      let attached = null;
      let disposed = false;
      const tryAttach = () => {
        if (attached !== null || disposed) return;
        const chatRoot = findChatRoot();
        if (chatRoot === null) return;
        if (!chatRoot.contains(column)) chatRoot.appendChild(column);
        attached = attachToChatRoot(chatRoot, column);
        ddwbBridge.setTrack = (width) => attached.setTrack(width);
        ddwbBridge.setTrack(ddwbBridge.trackWidth);
      };
      const detach = () => {
        if (attached !== null) {
          attached.dispose();
          attached = null;
        }
        ddwbBridge.setTrack = null;
      };
      // 监听 [data-chat-flow] 出现（对话视图挂载）→ attach；
      // 消失（切到轨迹页 / 会话关闭）→ detach。
      const flowObserver = new MutationObserver(() => {
        if (disposed) return;
        if (findChatRoot() !== null) tryAttach();
        else detach();
      });
      flowObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });
      disposers.push(() => {
        flowObserver.disconnect();
      });
      tryAttach();

      return () => {
        disposed = true;
        flowObserver.disconnect();
        for (const dispose of disposers) dispose();
        if (attached !== null) attached.dispose();
        ddwbBridge.setTrack = null;
        if (ddwbBridge.node === column) ddwbBridge.node = null;
      };
    }
    //#endregion

    //#region Header [|] 开合按钮
    /** 官方 Header 页签行右端的 [|] 按钮：切换工作台开合（开着时高亮）。 */
    function WorkbenchToggleHeaderAction({ workbench, t }) {
      const [open, setOpen] = react.useState(() => workbench.isOpen());
      react.useEffect(
        () => workbench.onOpenChange(setOpen),
        [workbench],
      );
      return jsx("button", {
        type: "button",
        className: "ddwb_toggleBtn" + (open ? " ddwb_toggleBtnActive" : ""),
        title: open ? t("closePanel") : t("openPanel"),
        "aria-label": open ? t("closePanel") : t("openPanel"),
        onClick: () => workbench.toggle(),
        children: jsx(IconPanelLeftOutline16, {
          size: 16,
          "aria-hidden": true,
        }),
      });
    }
    //#endregion

    //#region 词典
    const zh = {
      "feature.title": "工作台框架",
      "feature.description":
        "对话页右侧分栏工作台：文件 / Git 等功能面板与对话并存显示（页签行 [|] 按钮开关）",
      "openPanel": "打开工作台",
      "closePanel": "关闭工作台",
      "resizePanel": "拖拽调整宽度，点击收起",
      "emptyTitle": "工作台为空",
      "emptyHint": "功能插件（文件 / Git）安装后，它们的标签页会出现在这里",
      "noViewerTitle": "无法预览此文件",
      "noViewerHint": "没有匹配的文件预览器，请安装对应的预览插件",
    };
    const en = {
      "feature.title": "Workbench framework",
      "feature.description":
        "Side workbench inside the chat view: Files / Git panels show beside the conversation (toggled by the [|] header button)",
      "openPanel": "Open workbench",
      "closePanel": "Close workbench",
      "resizePanel": "Drag to resize, click to collapse",
      "emptyTitle": "Workbench is empty",
      "emptyHint":
        "Feature plugins (Files / Git) will appear here once installed",
      "noViewerTitle": "Cannot preview this file",
      "noViewerHint": "No matching file viewer; install the corresponding preview plugin",
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
        "dsh-desktop-workbench: dictionaries",
      );

      // 服务无条件提供：即使框架被关闭，功能插件 inject 仍能解析。
      const service = createWorkbenchService();
      ctx.effect(
        () => ctx.provide("desktop.workbench", service),
        "dsh-desktop-workbench: service",
      );

      // 「功能增强」聚合卡片开关（order 5：框架排在最前）。
      ctx.slots.inject("desktop.features.item", () =>
        ctx.slots.register(
          {
            name: "desktop.features.item",
            id: "workbench",
            order: 5,
            locale: NS,
            inject: () => ({
              load: () => loadWorkbenchConfig().then((config) => config.enabled),
              save: (enabled) => saveWorkbenchConfig(enabled),
              title: t("feature.title"),
              description: t("feature.description"),
            }),
          },
          () => null,
        ),
      );

      // Header 页签行右端 [|] 开合按钮（与打开工作区 / 导出会话同排）。
      const installToggle = () =>
        ctx.slots.inject("conversation.session.header.utilities", () =>
          ctx.slots.register(
            {
              name: "conversation.session.header.utilities",
              id: "workbench-toggle",
              order: 35,
              locale: NS,
              inject: () => ({ workbench: service }),
            },
            WorkbenchToggleHeaderAction,
          ),
        );

      // 行为安装：默认全开先装，配置到达后收敛。
      const installFeature = (config) => {
        const disposers = [];
        if (config.enabled) {
          const dispose = installDock(ctx, service, t);
          if (typeof dispose === "function") disposers.push(dispose);
          disposers.push(installToggle());
        }
        return disposers;
      };
      let active = [];
      const applyConfig = (config) => {
        for (const dispose of active) dispose();
        active = installFeature(config);
      };
      applyConfig({ ...ddwbDefaultConfig });
      void loadWorkbenchConfig().then(applyConfig);
    }
    //#endregion

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
