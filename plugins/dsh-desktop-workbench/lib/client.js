/**
 * dsh-desktop-workbench — browser half.
 *
 * 工作台框架：作为官方 AppFrame 布局的「右侧分栏」（grid 第四列）存在，
 * 不是浮层抽屉——sidebar | 对话 | details | workbench 四列并排，随窗口
 * 一起伸缩，样式对齐官方右侧列（DetailsPanel 同款 token 与结构）。
 *
 * 职责边界（框架不承载任何功能）：
 *   - 在 AppFrame 的 grid-template-columns 上追加第 4 条轨道（工作台列），
 *     自身作为 grid item（grid-column: 4 / grid-row: 1）挂载；官方三列
 *     （sidebar / 对话 / details）原样保留；
 *   - 列顶横向页签栏 + 内容区；收起后轨道归 0，右侧边缘出现细条按钮；
 *   - 提供服务 ctx.provide('desktop.workbench')：
 *       registerTab / registerViewer / activateTab / updateTab /
 *       openFile / closeFile / getSnapshot / subscribe / onAction；
 *   - 自身注册「示例」Tab 与「示例预览」viewer，验证 注册 → 服务分发 → 渲染 链路；
 *   - 在「功能增强」聚合卡片注册框架总开关（order 5）。
 *
 * 功能插件（文件 / 终端 / Git / 浏览器 / 后台任务）通过
 * inject: ['desktop.workbench'] 拿到服务，注册自己的 Tab 与文件预览器。
 * 会话级布局（打开状态 / 宽度 / 激活 tab / 打开的文件）经 host 端
 * /api/desktop-workbench/layout 持久化。
 *
 * 关于 grid 注入的稳健性：
 *   - AppFrame 每次重渲染都会重写 frame 的内联 gridTemplateColumns，
 *     用 MutationObserver 跟随重写，始终把第 4 条轨道钳在末尾；
 *   - React 收敛子节点时可能摘掉我们追加的列，用 childList 观察器自愈重挂。
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
    let react_dom = require("react-dom");
    let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
    const { jsx, jsxs } = react_jsx_runtime;
    const { createElement } = react;
    const { IconChevronLeftOutline14, IconChevronRightOutline14 } =
      _deepseek_ai_dsh_client_ui_primitives;

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
    /** AppFrame 容器特征：唯一带内联 grid-template-columns 的元素。 */
    const ddwbFrameSelector = '[style*="grid-template-columns"]';

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

    //#region 样式（复刻官方 ConversationRoot 的 header/tab 视觉）
    // 结构对齐：官方 header 是「titleRow（min-height 32px）+ tabs
    // （margin-top 4px / padding-left 8px / gap 36px）」两行结构；工作台
    // 列完全照搬——第一行用隐形文字占位（.ddwb_ghost，撑出与官方相同的
    // 行高），第二行 tabs 用官方一模一样的选择器值，因此 tab 顶自动落在
    // 与官方「对话 / 轨迹」页签完全相同的 48px 处，无需猜高度。
    // 列从 y=0 开始（grid item 全高）：顶部 38px 与窗口按钮区重叠，
    // 但该区域只有隐形占位行，被按钮盖住无影响；tab 行在 48px 起，
    // 完全位于按钮区下方。
    // 收起入口：官方 DragHandle 同款 hover-reveal 左边缘把手——平时
    // 透明（opacity 0），鼠标移入列或把手时淡入小圆钮，点击收起；
    // 不占头部空间，也不与 tabs 行争位置。
    const css =
      ".ddwb_col{border-left:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);flex-direction:column;min-width:0;height:100%;display:flex;position:relative}" +
      // 左 padding 取官方值 20px：标题行与页签行都落在与官方主列内容
      // 相同的左边缘（20px）；右侧收窄到 8px（本列无 breadcrumb/utilities，
      // 右端只有关闭按钮，无需官方 28px）。
      // （tab 顶 48px 与官方页签对齐由垂直结构保证，不受水平 padding 影响）
      ".ddwb_header{border-bottom:1px solid #0000;flex:none;position:relative;padding:12px 8px 0 20px;-webkit-app-region:drag}" +
      ".ddwb_header:after{content:\"\";z-index:0;background:var(--dsw-alias-border-l2);pointer-events:none;height:1px;position:absolute;bottom:1px;left:0;right:0}" +
      // 第一行标题：官方 crumb 同款节奏（14px/500），撑出行高的同时
      // 让 0–32px 区域有内容；左 padding 继承 header 的 20px，
      // 与下方第一个 tab 及官方主列左边缘对齐。
      ".ddwb_titleRow{min-height:32px;align-items:center;gap:10px;display:flex}" +
      ".ddwb_title{white-space:nowrap;font-size:14px;font-weight:500;line-height:20px;color:var(--dsw-alias-label-secondary)}" +
      ".ddwb_tabsRow{flex:1;min-width:0;z-index:1;position:relative;margin-top:4px;display:flex;align-items:flex-end;gap:6px}" +
      ".ddwb_tabs{flex:1;min-width:0;display:flex;align-items:flex-end;gap:16px;overflow-x:auto;scrollbar-width:none}" +
      ".ddwb_tabs::-webkit-scrollbar{display:none}" +
      // 右侧工具按钮（关闭工作台）：22px 高 + margin-bottom 8px 使图标
      // 中心与 tab 文字中心对齐；位于 tab 栏右侧空白区，不占 tab 宽度。
      ".ddwb_toolBtn{appearance:none;flex:none;width:22px;height:22px;margin-bottom:8px;border:0;border-radius:6px;background:0 0;color:var(--dsw-alias-label-tertiary);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;-webkit-app-region:no-drag}" +
      ".ddwb_toolBtn:hover:not(:disabled),.ddwb_toolBtn:focus-visible{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}" +
      ".ddwb_tab{color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;padding:0 0 11px;font-size:13px;font-weight:500;line-height:16px;white-space:nowrap;position:relative;display:inline-flex;align-items:center;gap:6px;-webkit-app-region:no-drag}" +
      ".ddwb_tabIcon{display:inline-flex;color:var(--dsw-alias-label-tertiary)}" +
      ".ddwb_tab:hover:not(:disabled),.ddwb_tab:focus-visible{color:var(--dsw-alias-label-primary)}" +
      ".ddwb_tab:after{content:\"\";background:0 0;border-radius:2px;height:2px;position:absolute;bottom:1px;left:0;right:0}" +
      ".ddwb_tabActive{color:var(--dsw-alias-label-primary)}" +
      ".ddwb_tabActive:after{background:var(--dsw-alias-brand-primary)}" +
      ".ddwb_tabBadge{min-width:16px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-layer-1);border-radius:999px;padding:0 5px;font-size:10px;line-height:16px;text-align:center}" +
      ".ddwb_handle{cursor:col-resize;z-index:3;touch-action:none;width:8px;margin-left:-4px;position:absolute;top:0;bottom:0;left:0;background:0 0;border:none;padding:0;-webkit-app-region:no-drag;display:grid;place-items:center;transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out)}" +
      // 高亮与 tab 激活下划线同色（--dsw-alias-brand-primary），
      // hover/拖拽背景用常规交互 hover 色。
      ".ddwb_handle:hover,.ddwb_handle:active,.ddwb_handle:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}" +
      ".ddwb_handle:after{content:\"\";box-sizing:border-box;width:2px;height:100%;border-radius:2px;background:var(--dsw-alias-border-l2);transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out)}" +
      ".ddwb_handle:hover:after,.ddwb_handle:active:after,.ddwb_handle:focus-visible:after{background:var(--dsw-alias-brand-primary)}" +
      ".ddwb_body{flex:1;min-height:0;overflow:auto}" +
      ".ddwb_placeholder{padding:24px 16px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.6}" +
      ".ddwb_placeholderTitle{display:block;color:var(--dsw-alias-label-secondary);font-size:14px;font-weight:600;margin-bottom:4px}" +
      ".ddwb_rail{position:fixed;top:50%;right:0;transform:translateY(-50%);width:28px;height:64px;border:1px solid var(--dsw-alias-border-l2);border-right:0;border-radius:10px 0 0 10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);cursor:pointer;box-shadow:-4px 0 12px rgba(0,0,0,.06);z-index:60;display:inline-flex;align-items:center;justify-content:center}" +
      ".ddwb_rail:hover:not(:disabled),.ddwb_rail:focus-visible{color:var(--dsw-alias-label-primary)}" +
      // 实际模板由 CSS 变量接管（!important 覆盖 React 的 inline 三列，
      // 避免与 React 争夺样式导致的列闪烁/自动关闭）；默认回退官方三列。
      "div[style*=\"grid-template-columns\"]{grid-template-columns:var(--ddwb-grid-template, 280px minmax(0, 1fr) 0px) !important}" +
      // 拖拽中关掉官方 frame 的 grid-template-columns transition（不跟手根因）。
      "div[style*=\"grid-template-columns\"][data-dragging]{transition:none}" +
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
     * Tab / viewer 注册表 + 动作通道。
     *   - 注册表（tabs / viewers）经 getSnapshot / subscribe 暴露；
     *   - UI 状态（激活 tab / 打开的文件）属于列组件，动作经 onAction 分发，
     *     列未挂载时动作安全丢弃。
     */
    function createWorkbenchService() {
      const tabs = new Map();
      const viewers = new Map();
      const listeners = new Set();
      const actionHandlers = new Set();
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
        /** 激活一个 Tab（切换内容区，关闭已打开的文件）。 */
        activateTab(id) {
          if (!tabs.has(id)) return;
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
          dispatchAction({ type: "collapsePanel" });
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

    //#region AppFrame grid 集成
    /**
     * 找到官方三栏 frame（唯一带内联 grid-template-columns 的元素）。
     * 页面核心 bundle 可能晚于插件加载，调用方负责重试。
     */
    function findAppFrame() {
      try {
        return document.querySelector(ddwbFrameSelector);
      } catch {
        return null;
      }
    }

    /**
     * 解析 grid-template-columns 轨道列表。
     * 不能用简单的空白 split：minmax(0, 1fr) 内部有空格，
     * 必须感知括号层级再切分。
     */
    function parseGridTracks(template) {
      const tracks = [];
      let depth = 0;
      let current = "";
      for (const ch of String(template)) {
        if (ch === "(") depth += 1;
        else if (ch === ")") depth -= 1;
        if ((ch === " " || ch === "\t") && depth === 0) {
          if (current.length > 0) {
            tracks.push(current);
            current = "";
          }
        } else {
          current += ch;
        }
      }
      if (current.length > 0) tracks.push(current);
      return tracks;
    }

    /**
     * 把工作台列接进 frame —— 用 CSS 变量接管渲染值，不与 React 争夺
     * inline style：
     *   - 注入规则 `div[style*="grid-template-columns"]{grid-template-columns:
     *     var(--ddwb-grid-template, <官方默认>) !important}`，实际模板由
     *     变量决定；React 重写 inline 模板（3 轨）不影响渲染，列永不闪没；
     *   - 变量同步：读 React 写下的 inline 三列 → 拼上工作台轨道（含
     *     details 协调）→ 写入变量；lastSynced 短路避免自身写入触发循环；
     *   - 拖拽：setDragging(true/false) 切换官方 `data-dragging` 属性，
     *     关掉官方 frame 的 grid-template-columns transition（不跟手的
     *     根因就是它：我们每帧改模板，动画把列宽拖着走）。
     * 返回 { setTrack(width), setDragging(on), dispose }。
     */
    function attachToFrame(frame, column) {
      const observers = [];
      const WIDTH_VAR = "--ddwb-grid-template";
      let lastSynced = null;
      /** 由 React 的 inline 三列模板 + 工作台宽度，拼出实际模板字符串。 */
      const targetTemplate = (inlineTemplate, width) => {
        const tracks = parseGridTracks(inlineTemplate);
        if (tracks.length < 3) return null; // 官方三列尚未就绪
        // 与官方 details 列协调：details 打开时把工作台轨道钳 0。
        const detailsOpen = tracks[2] !== "0px" && tracks[2] !== "0";
        return (
          tracks.slice(0, 3).join(" ") + " " + (detailsOpen ? 0 : width) + "px"
        );
      };
      /** 读 React inline 模板 → 同步变量（lastSynced 短路防循环）。 */
      const sync = (width) => {
        const target = targetTemplate(frame.style?.gridTemplateColumns ?? "", width);
        if (target === null || target === lastSynced) return;
        lastSynced = target;
        frame.style.setProperty(WIDTH_VAR, target);
      };
      const ensureColumn = () => {
        if (!frame.contains(column)) frame.appendChild(column);
      };
      ensureColumn();
      // style 观察器：React 重写 inline 模板时（或我们 setProperty 变量时，
      // 被 lastSynced 短路）重新同步变量。
      const styleObserver = new MutationObserver(() => {
        const raw = Number(column.dataset.ddwbTrack);
        sync(Number.isFinite(raw) ? raw : ddwbLayoutWidthDefault);
      });
      styleObserver.observe(frame, { attributes: true, attributeFilter: ["style"] });
      observers.push(styleObserver);
      const childObserver = new MutationObserver(ensureColumn);
      childObserver.observe(frame, { childList: true });
      observers.push(childObserver);
      return {
        setTrack(width) {
          column.dataset.ddwbTrack = String(width);
          sync(width);
        },
        setDragging(on) {
          if (on) frame.setAttribute("data-dragging", "");
          else frame.removeAttribute("data-dragging");
        },
        dispose() {
          for (const observer of observers) observer.disconnect();
          frame.style.removeProperty(WIDTH_VAR);
          column.remove();
        },
      };
    }
    //#endregion

    //#region 工作台列
    /**
     * 右侧分栏：列顶页签栏 + 内容区 + 收起/展开 + 按会话持久化布局。
     * 内容区优先级：打开的文件（viewer）> 激活的 Tab > 空态提示。
     */
    /** installDock 与列组件之间的桥：列节点、轨道 setter、当前轨道宽度。 */
    const ddwbBridge = { node: null, setTrack: null, setDragging: null, trackWidth: 0 };

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
      // 默认关闭：新会话加载时工作台保持收起（不恢复上次的开合状态——
      // 会话加载时面板组件不挂载，避免各功能插件初始化竞态；用户在当前
      // 会话内的开合/宽度选择仍实时持久化）。
      const [layout, setLayout] = react.useState({
        open: false,
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

      // 动作通道订阅：激活 tab / 打开文件 / 关闭文件。
      react.useEffect(
        () =>
          service.onAction((action) => {
            if (action.type === "activateTab") {
              // 激活页签的同时打开面板：外部触发（如点击对话里的文件
              // 链接 → openPath 拦截）时工作台可能处于关闭状态，
              // 需要自动弹出让预览可见。
              setLayout((prev) => ({
                ...prev,
                open: true,
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
            } else if (action.type === "collapsePanel") {
              // 外部请求折叠（如最后一个文件页签关闭）：收起面板，
              // 轨道归 0 由 layout 同步 effect 处理。
              setLayout((prev) => ({ ...prev, open: false }));
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
                // 会话加载一律默认收起（避免面板组件在会话/服务未就绪时
                // 挂载导致插件初始化问题）；宽度与活动页签仍按上次记忆。
                open: false,
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
                open: layoutRef.current.open,
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
      }, [layout, ready]);

      // 打开状态 / 宽度 → 同步 grid 轨道（写 dataset 供 attachToFrame 的
      // style 观察器兜底，已挂载时直接走 setTrack）。
      react.useEffect(() => {
        const width = layout.open ? layout.width : 0;
        ddwbBridge.trackWidth = width;
        if (ddwbBridge.node !== null) {
          ddwbBridge.node.dataset.ddwbTrack = String(width);
        }
        if (typeof ddwbBridge.setTrack === "function") {
          ddwbBridge.setTrack(width);
        }
      }, [layout.open, layout.width]);

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

      // 收起态：轨道归 0，列内容不渲染，改用 body 级细条按钮（portal）。
      if (!layout.open) {
        return react_dom.createPortal(
          jsx("button", {
            type: "button",
            className: "ddwb_rail",
            title: t("openPanel"),
            onClick: () => setLayout((prev) => ({ ...prev, open: true })),
            children: jsx(IconChevronLeftOutline14, {
              size: 14,
              "aria-hidden": true,
            }),
          }),
          document.body,
        );
      }

      return jsxs("div", {
        className: "ddwb_col",
        children: [
          // 左边缘拖拽条：常驻长条（无图标），拖拽调宽——按下时缓存官方
          // 三列基准模板，拖拽中 rAF 节流后直接拼接模板字符串写轨道
          // （零解析开销、不经过 React state），松手收敛一次状态触发持久化；
          // 无位移的按下释放 = 点击 → 收起面板。
          jsx("button", {
            type: "button",
            className: "ddwb_handle",
            title: t("resizePanel"),
            "aria-label": t("resizePanel"),
            onPointerDown: (event) => {
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              // 拖拽期间用官方 data-dragging 机制关掉 frame 的
              // grid-template-columns transition，列宽才跟手。
              if (typeof ddwbBridge.setDragging === "function") {
                ddwbBridge.setDragging(true);
              }
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
                  if (typeof ddwbBridge.setDragging === "function") {
                    ddwbBridge.setDragging(false);
                  }
                  dragRef.current = null;
                  if (typeof ddwbBridge.setTrack === "function") {
                    ddwbBridge.setTrack(0);
                  }
                  setLayout((prev) => ({ ...prev, open: false }));
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
              if (typeof ddwbBridge.setDragging === "function") {
                ddwbBridge.setDragging(false);
              }
              if (drag.moved) {
                if (drag.rawWidth < ddwbCollapseWidth) {
                  // 快速拖放：rAF 未及触发但宽度已低于收起阈值 → 直接收起。
                  if (typeof ddwbBridge.setDragging === "function") {
                    ddwbBridge.setDragging(false);
                  }
                  if (typeof ddwbBridge.setTrack === "function") {
                    ddwbBridge.setTrack(0);
                  }
                  setLayout((prev) => ({ ...prev, open: false }));
                } else {
                  // 拖拽结束：收敛一次状态（触发布局持久化），列宽已实时写入轨道。
                  setLayout((prev) => ({ ...prev, width: drag.lastWidth }));
                }
              } else {
                // 未产生位移 = 点击 → 收起。
                setLayout((prev) => ({ ...prev, open: false }));
              }
            },
          }),
          jsxs("div", {
            className: "ddwb_header",
            children: [
              // 第一行标题：与官方 titleRow（min-height 32px）同构撑高，
              // 让 tabs 行落在与官方页签相同的水平线；同时显示「工作台」
              // 标题，0–32px 区域不再空白。
              jsx("div", {
                className: "ddwb_titleRow",
                children: jsx("span", {
                  className: "ddwb_title",
                  children: t("panel.title"),
                }),
              }),
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
                    onClick: () =>
                      setLayout((prev) => ({ ...prev, open: false })),
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

    /** 挂载工作台列 + 注册示例 Tab/viewer；返回 disposer。 */
    function installDock(ctx, service, t) {
      const disposers = [];
      const column = document.createElement("div");
      column.className = "ddwb_col";
      column.style.gridColumn = "4";
      column.style.gridRow = "1";
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

      // 接入 AppFrame grid：frame 可能晚于插件出现，重试直至挂上。
      // dispose 必须终止重试：否则已卸载的列会在后续 attach 时被“复活”，
      // 造成列叠加 / Tab 重复。
      let attached = null;
      let disposed = false;
      let retryTimer = null;
      let attempts = 0;
      const tryAttach = () => {
        if (attached !== null || disposed) return;
        const frame = findAppFrame();
        if (frame === null) {
          if (attempts < 50) {
            attempts += 1;
            retryTimer = setTimeout(tryAttach, ddwbSessionRetryMs);
          }
          return;
        }
        attached = attachToFrame(frame, column);
        ddwbBridge.setTrack = (width) => attached.setTrack(width);
        ddwbBridge.setDragging = (on) => attached.setDragging(on);
        ddwbBridge.setTrack(ddwbBridge.trackWidth);
      };
      tryAttach();

      return () => {
        disposed = true;
        if (retryTimer !== null) clearTimeout(retryTimer);
        for (const dispose of disposers) dispose();
        if (attached !== null) attached.dispose();
        ddwbBridge.setTrack = null;
        ddwbBridge.setDragging = null;
        if (ddwbBridge.node === column) ddwbBridge.node = null;
      };
    }
    //#endregion

    //#region 词典
    const zh = {
      "feature.title": "工作台框架",
      "feature.description": "右侧分栏工作台容器与面板布局，文件 / 终端 / Git 等功能的宿主",
      "panel.title": "工作台",
      "openPanel": "打开工作台",
      "closePanel": "关闭工作台",
      "resizePanel": "拖拽调整宽度，点击收起",
      "emptyTitle": "工作台为空",
      "emptyHint": "功能插件（文件 / 终端 / Git）安装后，它们的标签页会出现在这里",
      "noViewerTitle": "无法预览此文件",
      "noViewerHint": "没有匹配的文件预览器，请安装对应的预览插件",
    };
    const en = {
      "feature.title": "Workbench framework",
      "feature.description":
        "Right-column workbench container and panel layout; host for the Files / Terminal / Git features",
      "panel.title": "Workbench",
      "openPanel": "Open workbench",
      "closePanel": "Close workbench",
      "resizePanel": "Drag to resize, click to collapse",
      "emptyTitle": "Workbench is empty",
      "emptyHint":
        "Feature plugins (Files / Terminal / Git) will appear here once installed",
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

      // 行为安装：默认全开先装，配置到达后收敛。
      const installFeature = (config) => {
        const disposers = [];
        if (config.enabled) {
          const dispose = installDock(ctx, service, t);
          if (typeof dispose === "function") disposers.push(dispose);
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
