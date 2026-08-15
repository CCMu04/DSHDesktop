/**
 * dsh-desktop-files — browser half.
 *
 * 文件工作台：在工作台列注册「文件」功能页签。打开的文件以**子页签**
 * 形式显示在「文件」页签内部（目录树 → 文件子页签栏 → 预览区），
 * 主页签栏保持只有功能页签。
 *
 * 数据流：
 *   - 目录树 / 文本 / 媒体 / HTML 全部经 host 端 /api/desktop-files/* 接口，
 *     由 host 按会话 cwd 白名单校验（本 client 只负责 UI 与请求拼接）；
 *   - 当前会话 id / cwd 经模块级 store 维护（跟随 sessions.list）；
 *   - 打开的文件（子页签列表 + 激活项）在插件内模块级 store 维护：
 *     目录树点击与 openPath 拦截共用，FilesPanel 订阅渲染；
 *   - 拦截官方 ctx.workspaces.openPath（工具行路径 / 生成文件行 / 正文
 *     文件提及的唯一打开入口）→ 解析为绝对路径 → 打开子页签并激活
 *     「文件」功能页签。
 */
window.__ModuleLoader__.load({
  id: "dsh-desktop-files",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react_jsx_runtime = require("react/jsx-runtime");
    let react = require("react");
    let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
    const { jsx, jsxs } = react_jsx_runtime;
    const { createElement } = react;
    const { MarkdownText, ReadBlock } = _deepseek_ai_dsh_client_ui_primitives;

    //#region 内置图标库（lucide-static v1.31.0，ISC 许可，内联 SVG path）
    // 本插件全部图标统一使用此库，不混用官方 primitives 图标。
    function makeLucideIcon(children) {
      return function LucideIcon({ size = 14, className }) {
        return jsxs("svg", {
          viewBox: "0 0 24 24",
          width: size,
          height: size,
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 2,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          className,
          "aria-hidden": true,
          children,
        });
      };
    }
    const FolderIcon = makeLucideIcon([
      jsx("path", {
        d: "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z",
      }),
    ]);
    const FolderOpenIcon = makeLucideIcon([
      jsx("path", {
        d: "m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2",
      }),
    ]);
    const RefreshCwIcon = makeLucideIcon([
      jsx("path", { d: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" }),
      jsx("path", { d: "M21 3v5h-5" }),
      jsx("path", { d: "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" }),
      jsx("path", { d: "M8 16H3v5" }),
    ]);
    const EyeIcon = makeLucideIcon([
      jsx("path", {
        d: "M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0",
      }),
      jsx("circle", { cx: 12, cy: 12, r: 3 }),
    ]);
    const EyeOffIcon = makeLucideIcon([
      jsx("path", {
        d: "M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49",
      }),
      jsx("path", { d: "M14.084 14.158a3 3 0 0 1-4.242-4.242" }),
      jsx("path", {
        d: "M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143",
      }),
      jsx("path", { d: "m2 2 20 20" }),
    ]);
    const FileIcon = makeLucideIcon([
      jsx("path", {
        d: "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",
      }),
      jsx("path", { d: "M14 2v5a1 1 0 0 0 1 1h5" }),
    ]);
    const FileTextIcon = makeLucideIcon([
      jsx("path", {
        d: "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",
      }),
      jsx("path", { d: "M14 2v5a1 1 0 0 0 1 1h5" }),
      jsx("path", { d: "M10 9H8" }),
      jsx("path", { d: "M16 13H8" }),
      jsx("path", { d: "M16 17H8" }),
    ]);
    const FileCodeIcon = makeLucideIcon([
      jsx("path", {
        d: "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",
      }),
      jsx("path", { d: "M14 2v5a1 1 0 0 0 1 1h5" }),
      jsx("path", { d: "M10 12.5 8 15l2 2.5" }),
      jsx("path", { d: "m14 12.5 2 2.5-2 2.5" }),
    ]);
    const FileJsonIcon = makeLucideIcon([
      jsx("path", {
        d: "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",
      }),
      jsx("path", { d: "M14 2v5a1 1 0 0 0 1 1h5" }),
      jsx("path", {
        d: "M10 12a1 1 0 0 0-1 1v1a1 1 0 0 1-1 1 1 1 0 0 1 1 1v1a1 1 0 0 0 1 1",
      }),
      jsx("path", {
        d: "M14 18a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1 1 1 0 0 1-1-1v-1a1 1 0 0 0-1-1",
      }),
    ]);
    const FileImageIcon = makeLucideIcon([
      jsx("path", {
        d: "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",
      }),
      jsx("path", { d: "M14 2v5a1 1 0 0 0 1 1h5" }),
      jsx("circle", { cx: 10, cy: 12, r: 2 }),
      jsx("path", { d: "m20 17-1.296-1.296a2.41 2.41 0 0 0-3.408 0L9 22" }),
    ]);
    const XIcon = makeLucideIcon([
      jsx("path", { d: "M18 6 6 18" }),
      jsx("path", { d: "m6 6 12 12" }),
    ]);
    const FolderSearchIcon = makeLucideIcon([
      jsx("path", {
        d: "M10.7 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v4.1",
      }),
      jsx("path", { d: "m21 21-1.9-1.9" }),
      jsx("circle", { cx: 17, cy: 17, r: 3 }),
    ]);
    const WrapTextIcon = makeLucideIcon([
      jsx("path", { d: "m16 16-3 3 3 3" }),
      jsx("path", { d: "M3 12h14.5a1 1 0 0 1 0 7H13" }),
      jsx("path", { d: "M3 19h6" }),
      jsx("path", { d: "M3 5h18" }),
    ]);
    const FileVideoIcon = makeLucideIcon([
      jsx("path", {
        d: "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",
      }),
      jsx("path", { d: "M14 2v5a1 1 0 0 0 1 1h5" }),
      jsx("path", {
        d: "M15.033 13.44a.647.647 0 0 1 0 1.12l-4.065 2.352a.645.645 0 0 1-.968-.56v-4.704a.645.645 0 0 1 .967-.56z",
      }),
    ]);
    const FileAudioIcon = makeLucideIcon([
      jsx("path", {
        d: "M4 6.835V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2h-.343",
      }),
      jsx("path", { d: "M14 2v5a1 1 0 0 0 1 1h5" }),
      jsx("path", {
        d: "M2 19a2 2 0 0 1 4 0v1a2 2 0 0 1-4 0v-4a6 6 0 0 1 12 0v4a2 2 0 0 1-4 0v-1a2 2 0 0 1 4 0",
      }),
    ]);

    /** 图片扩展名集合（文件图标按类型区分）。 */
    const DD_IMAGE_EXTS = new Set([
      ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico",
    ]);
    /** 按扩展名选文件图标：图片 / 视频 / 音频 / Markdown / JSON / 代码 / 文本 / 通用。 */
    function fileIconFor(path) {
      const dot = path.lastIndexOf(".");
      const ext = dot >= 0 ? path.slice(dot).toLowerCase() : "";
      if (DD_IMAGE_EXTS.has(ext)) return FileImageIcon;
      if (
        ext === ".mp4" || ext === ".m4v" || ext === ".webm" ||
        ext === ".ogv" || ext === ".mov"
      ) {
        return FileVideoIcon;
      }
      if (
        ext === ".mp3" || ext === ".wav" || ext === ".ogg" ||
        ext === ".m4a" || ext === ".aac" || ext === ".flac" || ext === ".opus"
      ) {
        return FileAudioIcon;
      }
      if (ext === ".md" || ext === ".markdown" || ext === ".mdx") {
        return FileTextIcon;
      }
      if (ext === ".json" || ext === ".jsonc") return FileJsonIcon;
      if (ext === ".txt" || ext === ".log") return FileTextIcon;
      if (CODE_LANG_BY_EXT[ext.slice(1)] !== void 0) return FileCodeIcon;
      return FileIcon;
    }
    //#endregion

    /**
     * 文件子页签横向滚动：overflow-x 滚动条已隐藏，把鼠标滚轮的
     * 垂直滚动转成横向位移（React 的 onWheel 是 passive，必须原生绑定）。
     */
    function onTabsWheel(event) {
      const el = event.currentTarget;
      // 没有溢出时不消费滚轮，避免挡住页面本身的滚动。
      if (el.scrollWidth <= el.clientWidth) return;
      if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
        el.scrollLeft += event.deltaY;
        event.preventDefault();
      }
    }

    //#region 常量与工具
    const NS = "desktop-files";
    const CONFIG_URL = "/api/desktop-files/config";
    const TREE_URL = "/api/desktop-files/tree";
    const TEXT_URL = "/api/desktop-files/text";
    const FILE_URL = "/api/desktop-files/file";
    const REVEAL_URL = "/api/desktop-files/reveal";
    const OPEN_EXTERNAL_URL = "/api/desktop-files/open-external";
    /** workbench / sessions 服务未就绪时的重试上限与间隔。 */
    const ddffRetryMs = 500;
    const ddffRetryLimit = 20;
    /** 文件子页签上限。 */
    const ddffMaxFiles = 20;
    /** 目录树隐藏状态持久化 key（localStorage）。 */
    const TREE_COLLAPSED_KEY = "dsh-desktop-files:treeCollapsed";
    /** 代码预览自动换行状态持久化 key（localStorage）。 */
    const WRAP_KEY = "dsh-desktop-files:wrap";

    /** 当前会话 id / cwd（模块级 store，viewer 组件拼 URL 用）。 */
    const ddffStore = {
      sessionId: null,
      cwd: null,
      listeners: new Set(),
      update(sessionId, cwd) {
        this.sessionId = sessionId;
        this.cwd = cwd;
        for (const listener of Array.from(this.listeners)) {
          try {
            listener({ sessionId, cwd });
          } catch {
            // A failing listener must not break the store.
          }
        }
      },
      getSnapshot() {
        return { sessionId: this.sessionId, cwd: this.cwd };
      },
      subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
      },
    };

    /** 打开的文件子页签 store（目录树与 openPath 拦截共用）。 */
    const filesStore = {
      files: [], // [{ path, viewerId }]
      active: null,
      listeners: new Set(),
      notify() {
        const snapshot = this.getSnapshot();
        for (const listener of Array.from(this.listeners)) {
          try {
            listener(snapshot);
          } catch {
            // A failing listener must not break the store.
          }
        }
      },
      /** 打开文件：同路径去重并激活；viewerId 为空时按扩展名匹配。 */
      open(path, viewerId) {
        if (typeof path !== "string" || path.length === 0) return;
        const existing = this.files.findIndex((f) => f.path === path);
        if (existing >= 0) {
          this.active = path;
          this.notify();
          return;
        }
        if (this.files.length >= ddffMaxFiles) {
          // 超出上限：替换最早打开的页签。
          this.files = [
            ...this.files.slice(1),
            { path, viewerId: viewerId ?? matchViewerId(path) },
          ];
        } else {
          this.files = [
            ...this.files,
            { path, viewerId: viewerId ?? matchViewerId(path) },
          ];
        }
        this.active = path;
        this.notify();
      },
      /** 关闭文件子页签：激活相邻页签。 */
      close(path) {
        const index = this.files.findIndex((f) => f.path === path);
        if (index < 0) return;
        this.files = this.files.filter((_, i) => i !== index);
        if (this.active === path) {
          const neighbor = this.files[index] ?? this.files[index - 1];
          this.active = neighbor ? neighbor.path : null;
        }
        this.notify();
      },
      /** 激活文件子页签。 */
      activate(path) {
        if (this.files.some((f) => f.path === path)) {
          this.active = path;
          this.notify();
        }
      },
      getSnapshot() {
        return { files: [...this.files], active: this.active };
      },
      subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
      },
    };

    /** 拼接带会话与路径参数的接口 URL。 */
    function ddffUrl(base, path) {
      const params = new URLSearchParams();
      if (typeof ddffStore.sessionId === "string") {
        params.set("session", ddffStore.sessionId);
      }
      params.set("path", path);
      return base + "?" + params.toString();
    }

    /** 拼接父子路径（统一用 / 分隔，Node 侧可解析 Windows 盘符路径）。 */
    function ddffJoin(parent, name) {
      if (parent === "" || parent === null) return name;
      return parent.replace(/[\\/]+$/, "") + "/" + name;
    }

    /** 把 openPath 给的路径解析为绝对路径（相对路径基于会话 cwd）。 */
    function ddffResolveAbsolute(path) {
      if (typeof path !== "string" || path.length === 0) return path;
      if (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)) return path;
      const cwd = ddffStore.cwd;
      return cwd ? ddffJoin(cwd, path) : path;
    }

    /** 路径取文件名（子页签标题）。 */
    function ddffBasename(path) {
      const at = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
      return at === -1 ? path : path.slice(at + 1);
    }

    /**
     * 相对化：以当前会话 cwd 为根，返回相对路径（分隔符统一为 /）；
     * 不在 cwd 内时原样返回。用于预览区路径栏。
     */
    function ddffRelativeToCwd(path) {
      const cwd = ddffStore.cwd;
      if (cwd === null || typeof path !== "string" || path.length === 0) {
        return path;
      }
      const norm = (p) => p.replace(/\\/g, "/").replace(/\/+$/, "");
      const base = norm(cwd).toLowerCase();
      const target = norm(path);
      if (target.toLowerCase() === base) return "";
      if (target.toLowerCase().startsWith(base + "/")) {
        return target.slice(base.length + 1);
      }
      return path;
    }

    /** 读取功能开关：失败回退默认（全开）。 */
    function loadFilesConfig() {
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
              : true,
        }))
        .catch(() => ({ enabled: true }));
    }

    /** 写入功能开关。 */
    function saveFilesConfig(enabled) {
      return fetch(CONFIG_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      })
        .then((res) => res.ok)
        .catch(() => false);
    }

    /**
     * 在系统文件管理器中打开文件所在目录：host 端用官方同款命令
     * （powershell Invoke-Item）执行。返回 HTTP 状态码（网络错误 → 0）。
     */
    function revealInExplorer(path) {
      return fetch(REVEAL_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session: ddffStore.sessionId, path }),
      })
        .then((res) => res.status)
        .catch(() => 0);
    }

    /**
     * 用系统默认应用打开文件（无法预览的文件 → 用户的 Word / Excel 等）。
     * 返回 HTTP 状态码（网络错误 → 0）。
     */
    function openExternal(path) {
      return fetch(OPEN_EXTERNAL_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session: ddffStore.sessionId, path }),
      })
        .then((res) => res.status)
        .catch(() => 0);
    }
    //#endregion

    //#region 样式
    const css =
      ".ddff_panel{height:100%;display:flex;flex-direction:column;min-width:0}" +
      // 顶部 tab 栏：左文件子页签（分页预览，可横向滚动）+ 右功能按钮。
      // 页签区域撑满整行，功能按钮固定在右侧；上下 padding 对称保证
      // 整体垂直居中；tabsScroll 超出时横向滚动（滚动条隐藏）。
      ".ddff_fileTabs{flex:none;display:flex;align-items:center;gap:2px;padding:4px 8px 4px;border-bottom:1px solid var(--dsw-alias-border-l2)}" +
      ".ddff_tabsScroll{flex:1;min-width:0;display:flex;align-items:center;gap:2px;overflow-x:auto;scrollbar-width:none}" +
      ".ddff_tabsScroll::-webkit-scrollbar{display:none}" +
      ".ddff_toolBtn{appearance:none;flex:none;width:22px;height:22px;border:0;border-radius:6px;background:0 0;color:var(--dsw-alias-label-tertiary);cursor:pointer;display:inline-flex;align-items:center;justify-content:center}" +
      ".ddff_toolBtn:hover:not(:disabled),.ddff_toolBtn:focus-visible{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}" +
      // 左右布局：左预览 + 右目录树（可隐藏、可调宽）。
      ".ddff_body{flex:1;min-height:0;display:flex;flex-direction:row}" +
      // 左：预览区。
      ".ddff_main{flex:1;min-width:0;display:flex;flex-direction:column}" +
      // 预览区顶部路径栏：相对 cwd 路径（等宽小字，超出省略）+
      // 右侧「在资源管理器中显示」按钮。
      ".ddff_pathBar{flex:none;display:flex;align-items:center;gap:4px;padding:2px 8px 2px 16px;background:var(--dsw-alias-bg-base);border-bottom:1px solid var(--dsw-alias-border-l2)}" +
      ".ddff_pathText{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace)}" +
      ".ddff_revealBtn{appearance:none;flex:none;width:22px;height:22px;border:0;border-radius:6px;background:0 0;color:var(--dsw-alias-label-tertiary);cursor:pointer;display:inline-flex;align-items:center;justify-content:center}" +
      ".ddff_revealBtn:hover:not(:disabled),.ddff_revealBtn:focus-visible{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}" +
      ".ddff_revealBtn:disabled{opacity:.5;cursor:default}" +
      // 换行激活态：品牌色高亮。
      ".ddff_toolActive{color:var(--dsw-alias-brand-primary)}" +
      ".ddff_revealError{flex:none;font-size:11px;line-height:16px;color:var(--dsw-static-red-600)}" +
      // 空状态里「用系统应用打开」按钮与失败提示。
      ".ddff_openBtn{appearance:none;margin-top:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 18px;font:inherit;font-size:13px;line-height:18px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);cursor:pointer}" +
      ".ddff_openBtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}" +
      ".ddff_openBtn:disabled{opacity:.5;cursor:default}" +
      ".ddff_openError{margin-top:6px;font-size:12px;line-height:16px;color:var(--dsw-static-red-600)}" +
      // 树与预览之间的拖拽调宽手柄（hover 高亮）。
      ".ddff_treeHandle{flex:none;width:6px;cursor:col-resize;touch-action:none;background:0 0;transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out)}" +
      ".ddff_treeHandle:hover,.ddff_treeHandle:active{background:var(--dsw-alias-interactive-bg-hover)}" +
      // 右：目录树（宽度由 inline flexBasis 控制，默认 140px）。
      ".ddff_treePane{flex:0 0 auto;min-width:0;overflow:auto;padding:6px 0 12px;border-left:1px solid var(--dsw-alias-border-l2)}" +
      ".ddff_treePaneCollapsed{display:none}" +
      ".ddff_row{display:flex;align-items:center;gap:4px;width:100%;border:0;background:0 0;font:inherit;color:var(--dsw-alias-label-secondary);text-align:left;padding:3px 12px;font-size:13px;line-height:20px;cursor:pointer;white-space:nowrap}" +
      ".ddff_row:hover:not(:disabled),.ddff_row:focus-visible{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}" +
      ".ddff_dirIcon{flex:none;color:var(--dsw-alias-label-tertiary);display:inline-flex}" +
      ".ddff_fileIcon{flex:none;color:var(--dsw-alias-label-tertiary);display:inline-flex}" +
      ".ddff_name{overflow:hidden;text-overflow:ellipsis}" +
      ".ddff_dir{color:var(--dsw-alias-label-primary);font-weight:500}" +
      ".ddff_size{flex:none;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;margin-left:auto;padding-left:8px}" +
      ".ddff_fileTab{appearance:none;flex:none;width:140px;box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;border:0;background:0 0;font:inherit;color:var(--dsw-alias-label-tertiary);padding:4px 8px;font-size:12px;line-height:18px;cursor:pointer;border-radius:6px 6px 0 0;white-space:nowrap}" +
      ".ddff_fileTab:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}" +
      ".ddff_fileTabActive{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);font-weight:500}" +
      // 页签名：flex:1 撑满剩余空间（关闭按钮固定右侧）；button 的 UA
      // 默认 text-align:center 会让被拉伸的 span 内文字居中，需显式靠左。
      ".ddff_fileTabIcon{flex:none;color:var(--dsw-alias-label-tertiary);display:inline-flex}" +
      ".ddff_fileTabName{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;text-align:left}" +
      ".ddff_fileTabClose{flex:none;width:14px;height:14px;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1}" +
      ".ddff_fileTab:hover .ddff_fileTabClose,.ddff_fileTabClose:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}" +
      // 预览区与空状态。
      ".ddff_preview{flex:1;min-height:0;display:flex;flex-direction:column;overflow:auto}" +
      ".ddff_empty{margin:auto;display:flex;flex-direction:column;align-items:center;gap:6px;padding:24px 20px;text-align:center}" +
      ".ddff_emptyIcon{color:var(--dsw-alias-label-dimmed);display:inline-flex;margin-bottom:6px}" +
      ".ddff_emptyTitle{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:600;line-height:1.5}" +
      ".ddff_emptyText{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.6;max-width:240px}" +
      ".ddff_placeholder{padding:12px 16px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.6}" +
      // 文本类渲染（Markdown / JSON）的内边距容器；官方渲染组件自带
      // 主题样式（md-code-block / markdown / json 类）。
      ".ddff_rendered{padding:12px 16px}" +
      // ReadBlock 样式覆盖：官方 css-module（hash 类）在此环境生效，自带
      // read 布局（外框背景/圆角、banner、body 内部横向滚动、行号右对齐
      // 宽列）。这里按固定 DOM 结构只保留「行号 + 代码」的内部渲染效果：
      // 根块透明铺满（无框）、banner 隐藏、body 滚动交给外层预览区（横向
      // 滚动条固定在预览区底部）、行号左对齐窄列、sticky 固定且背景与
      // 代码区（面板背景）一致。
      ".ddff_read{margin:0!important;background:transparent!important;border-radius:0!important}" +
      ".ddff_read>div:first-child{display:none!important}" +
      ".ddff_read>div:last-child{padding:8px 0;overflow:visible!important}" +
      ".ddff_read>div:last-child>div>span:first-child{flex:none;position:sticky;left:0;width:2.5em;text-align:left;padding:0 0.5em 0 12px;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-base);-webkit-user-select:none;user-select:none}" +
      ".ddff_read>div:last-child>button{padding:4px 14px}" +
      // 自动换行：长行折行显示（覆盖 ReadBlock 行内容的 white-space:pre）。
      ".ddff_previewWrap .ddff_read>div:last-child>div>span:last-child{white-space:pre-wrap;word-break:break-word}" +
      ".ddff_imgWrap{flex:1;min-height:0;overflow:hidden;display:flex;align-items:center;justify-content:center;cursor:grab;touch-action:none}" +
      ".ddff_imgWrap:active{cursor:grabbing}" +
      ".ddff_img{display:block;max-width:100%;max-height:100%;object-fit:contain;transform-origin:center center;user-select:none;-webkit-user-drag:none}" +
      // 视频 / 音频：居中，限宽。
      ".ddff_video{display:block;max-width:100%;max-height:100%;margin:auto;background:#000}" +
      ".ddff_audio{display:block;width:min(420px,100%);margin:24px auto;padding:0 16px;box-sizing:border-box}" +
      ".ddff_iframe{flex:1;min-height:0;width:100%;border:0;background:var(--dsw-alias-bg-layer-1)}";
    const cssTagId = "dsh-desktop-files/Files.module.css";
    if (
      typeof document !== "undefined" &&
      document.querySelector("style[data-plugin-css=" + JSON.stringify(cssTagId) + "]") === null
    ) {
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-desktop-files";
      tag.dataset.pluginCss = cssTagId;
      tag.textContent = css;
      document.head.appendChild(tag);
    }
    //#endregion

    //#region 预览器（插件内部注册表，扩展名互斥）
    /**
     * 图片预览：适应窗口显示；滚轮缩放（以中心为轴，0.2–8 倍）、
     * 拖拽平移（放大后）、双击复位。
     */
    function ImageViewer({ path, t }) {
      const [view, setView] = react.useState({ scale: 1, tx: 0, ty: 0 });
      const wrapRef = react.useRef(null);
      const viewRef = react.useRef(view);
      viewRef.current = view;
      const dragRef = react.useRef(null);

      // 滚轮缩放：原生绑定（React onWheel 是 passive，无法 preventDefault）。
      react.useEffect(() => {
        const el = wrapRef.current;
        if (el === null) return;
        const onWheel = (event) => {
          event.preventDefault();
          const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
          const v = viewRef.current;
          setView({
            scale: Math.min(8, Math.max(0.2, v.scale * factor)),
            tx: v.tx,
            ty: v.ty,
          });
        };
        el.addEventListener("wheel", onWheel, { passive: false });
        return () => el.removeEventListener("wheel", onWheel);
      }, []);

      const onPointerDown = (event) => {
        if (viewRef.current.scale <= 1) return; // 适应态无需平移
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = {
          x: event.clientX,
          y: event.clientY,
          tx: viewRef.current.tx,
          ty: viewRef.current.ty,
        };
      };
      const onPointerMove = (event) => {
        const drag = dragRef.current;
        if (drag === null) return;
        setView((v) => ({
          ...v,
          tx: drag.tx + (event.clientX - drag.x),
          ty: drag.ty + (event.clientY - drag.y),
        }));
      };
      const onPointerUp = (event) => {
        dragRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      };

      return jsx("div", {
        className: "ddff_imgWrap",
        ref: wrapRef,
        onPointerDown,
        onPointerMove,
        onPointerUp,
        onPointerCancel: onPointerUp,
        onDoubleClick: () => setView({ scale: 1, tx: 0, ty: 0 }),
        children: jsx("img", {
          className: "ddff_img",
          src: ddffUrl(FILE_URL, path),
          alt: path,
          draggable: false,
          style:
            view.scale !== 1 || view.tx !== 0 || view.ty !== 0
              ? {
                  transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
                }
              : undefined,
        }),
      });
    }

    /** 拉取文本内容（loading / ready / error 三态，供文本类 viewer 共用）。 */
    function useFileText(path, url = TEXT_URL) {
      const [state, setState] = react.useState({ status: "loading" });
      react.useEffect(() => {
        let current = true;
        setState({ status: "loading" });
        fetch(ddffUrl(url, path), { cache: "no-store" })
          .then((res) =>
            res.ok
              ? res.json()
              : Promise.reject(new Error("http-" + res.status)),
          )
          .then((body) => {
            if (current) {
              setState({
                status: "ready",
                content:
                  body && typeof body.content === "string" ? body.content : "",
              });
            }
          })
          .catch(() => {
            if (current) setState({ status: "error" });
          });
        return () => {
          current = false;
        };
      }, [path, url]);
      return state;
    }

    /** 视频预览：原生 video（host 端 Range 流式，可拖动进度）。 */
    function VideoViewer({ path, t }) {
      return jsx("video", {
        className: "ddff_video",
        controls: true,
        preload: "metadata",
        src: ddffUrl(FILE_URL, path),
      });
    }

    /** 音频预览：原生 audio（host 端 Range 流式）。 */
    function AudioViewer({ path, t }) {
      return jsx("audio", {
        className: "ddff_audio",
        controls: true,
        preload: "metadata",
        src: ddffUrl(FILE_URL, path),
      });
    }

    /** 文本类 viewer 的加载 / 失败占位。 */
    function TextState({ state, t }) {
      if (state.status === "loading") {
        return jsx("div", {
          className: "ddff_placeholder",
          children: t("viewer.loading"),
        });
      }
      return jsx("div", {
        className: "ddff_placeholder",
        children: t("viewer.loadFailed"),
      });
    }

    /** 扩展名 → shiki 语言（CodeBlock 内再走官方别名解析，传标准名）。 */
    const CODE_LANG_BY_EXT = {
      js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "jsx",
      ts: "typescript", tsx: "tsx",
      py: "python", rb: "ruby", go: "go", rs: "rust",
      java: "java", c: "c", h: "c", cpp: "cpp", hpp: "cpp", cs: "csharp",
      php: "php", sh: "bash", bash: "bash", zsh: "bash", ps1: "powershell",
      sql: "sql", css: "css", scss: "scss", less: "less",
      xml: "xml", yml: "yaml", yaml: "yaml", toml: "toml",
      html: "html", htm: "html",
      json: "json", jsonc: "json",
      ini: "ini", cfg: "ini", conf: "ini",
      vue: "vue", svelte: "svelte", diff: "diff",
      kt: "kotlin", lua: "lua", dart: "dart", swift: "swift",
    };

    /** 按扩展名取 shiki 语言（未知扩展名 → undefined → 纯文本渲染）。 */
    function codeLangFor(path) {
      const dot = path.lastIndexOf(".");
      if (dot < 0) return void 0;
      return CODE_LANG_BY_EXT[path.slice(dot + 1).toLowerCase()];
    }

    /** Markdown 预览：官方 MarkdownText 渲染（GFM + 数学 + 代码块高亮）。 */
    function MarkdownViewer({ path, t }) {
      const state = useFileText(path);
      if (state.status !== "ready") {
        return jsx(TextState, { state, t });
      }
      return jsx("div", {
        className: "ddff_rendered",
        children: jsx(MarkdownText, { text: state.content }),
      });
    }

    /** JSON 预览：与代码一致（行号 + json 语法高亮），不再用树形。 */
    function JsonViewer({ path, t }) {
      const state = useFileText(path);
      if (state.status !== "ready") {
        return jsx(TextState, { state, t });
      }
      const content = state.content;
      const lines = content.split("\n").map((text, index) => ({
        number: index + 1,
        text,
      }));
      return jsx(ReadBlock, {
        label: ddffBasename(path),
        lines,
        totalLines: lines.length,
        lang: "json",
        maxLines: 1000,
        className: "ddff_read",
      });
    }

    /**
     * 代码 / 纯文本预览：官方 ReadBlock（read 工具同款——行号 gutter +
     * shiki 语法高亮 + 语言标签 + 复制，只读）。ReadBlock 的 css-module
     * 类在发布物里被 stub，官方全局 css 不含这些类，故用 .ddff_read
     * 传入根类并在此插件 css 里补齐样式。
     */
    function CodeViewer({ path, t }) {
      const state = useFileText(path);
      if (state.status !== "ready") {
        return jsx(TextState, { state, t });
      }
      const content = state.content;
      // 行对象数组（ReadBlock 的行号 gutter 数据源）；保留末尾空行。
      const lines = content.split("\n").map((text, index) => ({
        number: index + 1,
        text,
      }));
      // 直接铺满预览区（无外框）；横向/纵向滚动由外层 ddff_preview 负责，
      // 横向滚动条因此固定在预览区底部，不用滚到底才出现。
      return jsx(ReadBlock, {
        label: ddffBasename(path),
        lines,
        totalLines: lines.length,
        lang: codeLangFor(path),
        // 超过 1000 行折叠为头尾窗口 + 展开按钮（避免大文件全量渲染卡顿）。
        maxLines: 1000,
        className: "ddff_read",
      });
    }

    /** PDF 预览：Chromium 内置 PDF viewer。 */
    function PdfViewer({ path, t }) {
      return jsx("iframe", {
        className: "ddff_iframe",
        src: ddffUrl(FILE_URL, path),
        title: path,
      });
    }

    /** 插件内部 viewer 注册表（按 order 匹配，扩展名互斥）。
     *  HTML 也走代码视图（行号 + 高亮），不做 iframe 渲染。 */
    const FILES_VIEWERS = [
      { id: "files:image", order: 10, extensions: [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico"], component: ImageViewer },
      { id: "files:video", order: 12, extensions: [".mp4", ".m4v", ".webm", ".ogv", ".mov"], component: VideoViewer },
      { id: "files:audio", order: 13, extensions: [".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac", ".opus"], component: AudioViewer },
      { id: "files:markdown", order: 20, extensions: [".md", ".markdown", ".mdx"], component: MarkdownViewer },
      { id: "files:pdf", order: 40, extensions: [".pdf"], component: PdfViewer },
      { id: "files:code", order: 50, extensions: [".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py", ".rb", ".go", ".rs", ".java", ".c", ".h", ".cpp", ".hpp", ".cs", ".php", ".sh", ".bash", ".ps1", ".sql", ".json", ".jsonc", ".yml", ".yaml", ".toml", ".ini", ".cfg", ".conf", ".txt", ".log", ".xml", ".css", ".scss", ".less", ".vue", ".svelte", ".diff", ".html", ".htm"], component: CodeViewer },
    ];

    /** 按扩展名匹配 viewer id。 */
    function matchViewerId(path) {
      const dot = path.lastIndexOf(".");
      const ext = dot >= 0 ? path.slice(dot).toLowerCase() : "";
      const viewer = FILES_VIEWERS.find((v) =>
        v.extensions.some((e) => e === ext),
      );
      return viewer ? viewer.id : null;
    }

    /** 按 id 取 viewer 描述符。 */
    function viewerById(id) {
      return FILES_VIEWERS.find((v) => v.id === id) ?? null;
    }
    //#endregion

    //#region 目录树
    /** 文件大小显示。 */
    function ddffSize(bytes) {
      if (typeof bytes !== "number" || bytes < 0) return "";
      if (bytes < 1024) return bytes + " B";
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
      return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    }

    /**
     * 文件页签内容：「文件」功能页签的正文——目录树（可折叠）+
     * 文件子页签栏（分页预览）+ 预览区。
     */
    function FilesPanel({ ctx, service, t }) {
      const [sessionSnap, setSessionSnap] = react.useState(() =>
        ddffStore.getSnapshot(),
      );
      const [filesSnap, setFilesSnap] = react.useState(() =>
        filesStore.getSnapshot(),
      );
      const [entries, setEntries] = react.useState({}); // path -> entries[]
      const [expanded, setExpanded] = react.useState({}); // path -> true
      const [loading, setLoading] = react.useState(null); // 正在加载的目录
      const [fatal, setFatal] = react.useState(null);
      // 资源管理器显示失败反馈（短暂显示后自动消失）+ 防连点。
      const [revealError, setRevealError] = react.useState(false);
      const revealErrorTimer = react.useRef(null);
      const [revealPending, setRevealPending] = react.useState(false);
      // 系统应用打开失败反馈（短暂显示后自动消失）+ 防连点。
      const [openError, setOpenError] = react.useState(false);
      const openErrorTimer = react.useRef(null);
      const [openPending, setOpenPending] = react.useState(false);
      // 目录树隐藏状态：localStorage 持久化（关闭工作台再打开时保持上次选择）。
      const [treeCollapsed, setTreeCollapsed] = react.useState(() => {
        try {
          return localStorage.getItem(TREE_COLLAPSED_KEY) === "1";
        } catch {
          return false;
        }
      });
      react.useEffect(() => {
        try {
          localStorage.setItem(TREE_COLLAPSED_KEY, treeCollapsed ? "1" : "0");
        } catch {
          // localStorage 不可用时仅失去持久化，不影响使用。
        }
      }, [treeCollapsed]);
      // 代码预览自动换行：长行折行显示（localStorage 持久化）。
      const [wrapMode, setWrapMode] = react.useState(() => {
        try {
          return localStorage.getItem(WRAP_KEY) === "1";
        } catch {
          return false;
        }
      });
      react.useEffect(() => {
        try {
          localStorage.setItem(WRAP_KEY, wrapMode ? "1" : "0");
        } catch {
          // localStorage 不可用时仅失去持久化，不影响使用。
        }
      }, [wrapMode]);

      // 会话 / cwd 变化 → 重置树与文件页签，并自动加载根目录内容
      // （根目录行不显示，直接从 cwd 的内容开始展示）。
      react.useEffect(() => {
        const offSession = ddffStore.subscribe((next) => {
          setSessionSnap(next);
          setEntries({});
          setExpanded({});
          setFatal(null);
          if (next.cwd !== null) loadDir(next.cwd);
        });
        const offFiles = filesStore.subscribe(setFilesSnap);
        // 挂载即加载：工作台关闭再打开时组件重新挂载，但 store 没有
        // 新事件、订阅不会触发，需按当前快照立即加载根目录，
        // 否则目录树空白（要手动点刷新才出现）。
        const initial = ddffStore.getSnapshot();
        if (initial.cwd !== null) loadDir(initial.cwd);
        return () => {
          offSession();
          offFiles();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);

      const loadDir = (dirPath) => {
        if (loading !== null) return;
        setLoading(dirPath);
        fetch(ddffUrl(TREE_URL, dirPath), { cache: "no-store" })
          .then((res) =>
            res.ok
              ? res.json()
              : Promise.reject(new Error("http-" + res.status)),
          )
          .then((body) => {
            setEntries((prev) => ({
              ...prev,
              [dirPath]: Array.isArray(body?.entries) ? body.entries : [],
            }));
            setLoading(null);
          })
          .catch(() => {
            setLoading(null);
            setFatal(t("panel.loadFailed"));
          });
      };

      const toggleDir = (dirPath) => {
        if (expanded[dirPath] !== true) {
          setExpanded((prev) => ({ ...prev, [dirPath]: true }));
          if (entries[dirPath] === undefined) loadDir(dirPath);
        } else {
          setExpanded((prev) => ({ ...prev, [dirPath]: false }));
        }
      };

      const openFile = (filePath) => {
        filesStore.open(filePath);
      };

      const copyPath = (filePath) => {
        try {
          void navigator.clipboard?.writeText(filePath);
        } catch {
          // Clipboard may be unavailable; ignore.
        }
      };

      // 文件子页签横向滚动：滚轮垂直滚动转横向位移（无滚动条）。
      const tabsScrollRef = react.useRef(null);
      const setTabsScroll = (el) => {
        if (tabsScrollRef.current === el) return;
        if (tabsScrollRef.current !== null) {
          tabsScrollRef.current.removeEventListener("wheel", onTabsWheel);
        }
        tabsScrollRef.current = el;
        if (el !== null) {
          el.addEventListener("wheel", onTabsWheel, { passive: false });
        }
      };

      // 目录树宽度（px，可拖拽调整）：默认窄（140px），范围 100–280。
      const [treeWidth, setTreeWidth] = react.useState(140);
      const treeDragRef = react.useRef(null);
      const onTreeHandleDown = (event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        treeDragRef.current = {
          startX: event.clientX,
          startWidth: treeWidthRef.current,
        };
      };
      const onTreeHandleMove = (event) => {
        const drag = treeDragRef.current;
        if (drag === null) return;
        // 分隔线向左拖 → 树变宽。
        const width = Math.min(
          280,
          Math.max(100, drag.startWidth + (drag.startX - event.clientX)),
        );
        setTreeWidth(width);
      };
      const onTreeHandleUp = (event) => {
        const drag = treeDragRef.current;
        if (drag === null) return;
        treeDragRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      };
      const treeWidthRef = react.useRef(treeWidth);
      treeWidthRef.current = treeWidth;

      const cwd = sessionSnap.cwd;
      const activeFile =
        filesSnap.active !== null
          ? filesSnap.files.find((f) => f.path === filesSnap.active) ?? null
          : null;
      const activeViewer =
        activeFile !== null ? viewerById(activeFile.viewerId) : null;

      // 递归渲染目录行（依赖组件内 entries/expanded/loading 状态）。
      const renderChildren = (dirPath, depth) => {
        const list = entries[dirPath];
        if (list === undefined) return null;
        return list.map((entry) => {
          const entryPath = ddffJoin(dirPath, entry.name);
          const isDir = entry.type === "dir";
          const indent = { paddingLeft: 12 + depth * 14 + "px" };
          const row = jsxs("button", {
            type: "button",
            className: "ddff_row",
            style: indent,
            title: entryPath,
            onClick: () => (isDir ? toggleDir(entryPath) : openFile(entryPath)),
            onContextMenu: (event) => {
              event.preventDefault();
              copyPath(entryPath);
            },
            children: [
              // 目录图标：展开 = 打开的文件夹，收起 = 关闭的文件夹
              // （不用箭头，文件夹开/关状态即展开指示）。
              isDir
                ? jsx("span", {
                    className: "ddff_dirIcon",
                    children: jsx(
                      expanded[entryPath] === true
                        ? FolderOpenIcon
                        : FolderIcon,
                      { size: 14 },
                    ),
                  })
                : null,
              // 文件图标：按类型（代码 / JSON / 文本 / 图片 / 通用）。
              !isDir
                ? jsx("span", {
                    className: "ddff_fileIcon",
                    children: jsx(fileIconFor(entryPath), { size: 14 }),
                  })
                : null,
              jsx("span", {
                className: isDir ? "ddff_name ddff_dir" : "ddff_name",
                children: entry.name,
              }),
              !isDir
                ? jsx("span", {
                    className: "ddff_size",
                    children: ddffSize(entry.size),
                  })
                : null,
            ],
          });
          if (!isDir) return jsx(react.Fragment, { key: entryPath, children: row });
          return jsxs(react.Fragment, {
            key: entryPath,
            children: [
              row,
              expanded[entryPath] === true
                ? renderChildren(entryPath, depth + 1)
                : null,
            ],
          });
        });
      };

      // 预览区：激活文件页签渲染对应 viewer；无 cwd / 无激活文件时空状态。
      let preview;
      if (cwd === null) {
        preview = jsxs("div", {
          className: "ddff_empty",
          children: [
            jsx("span", {
              className: "ddff_emptyIcon",
              children: jsx(FolderIcon, {
                size: 28,
              }),
            }),
            jsx("span", {
              className: "ddff_emptyTitle",
              children: t("panel.emptyTitle"),
            }),
            jsx("span", {
              className: "ddff_emptyText",
              children: t("panel.emptyHint"),
            }),
          ],
        });
      } else if (activeFile !== null) {
        preview =
          activeViewer !== null
            ? createElement(activeViewer.component, {
                path: activeFile.path,
                t,
              })
            : jsxs("div", {
                className: "ddff_empty",
                children: [
                  jsx("span", {
                    className: "ddff_emptyIcon",
                    children: jsx(FileIcon, {
                      size: 28,
                    }),
                  }),
                  jsx("span", {
                    className: "ddff_emptyTitle",
                    children: t("viewer.noViewerTitle"),
                  }),
                  jsx("span", {
                    className: "ddff_emptyText",
                    children: t("viewer.noViewerHint"),
                  }),
                  // 无法预览 → 用系统默认应用（Word / Excel / 播放器等）打开。
                  jsx("button", {
                    type: "button",
                    className: "ddff_openBtn",
                    disabled: openPending,
                    onClick: () => {
                      setOpenPending(true);
                      openExternal(activeFile.path)
                        .then((status) => {
                          if (status !== 200) {
                            setOpenError(status);
                            if (openErrorTimer.current !== null) {
                              clearTimeout(openErrorTimer.current);
                            }
                            openErrorTimer.current = window.setTimeout(
                              () => setOpenError(false),
                              4000,
                            );
                          }
                        })
                        .finally(() => setOpenPending(false));
                    },
                    children: t("panel.openExternal"),
                  }),
                  openError
                    ? jsx("span", {
                        className: "ddff_openError",
                        children:
                          t("panel.openExternalFailed") +
                          (openError ? " (" + openError + ")" : ""),
                      })
                    : null,
                ],
              });
      } else {
        preview = jsxs("div", {
          className: "ddff_empty",
          children: [
            jsx("span", {
              className: "ddff_emptyIcon",
              children: jsx(FileIcon, {
                size: 28,
              }),
            }),
            jsx("span", {
              className: "ddff_emptyTitle",
              children: t("panel.hintTitle"),
            }),
            jsx("span", {
              className: "ddff_emptyText",
              children: t("panel.hint"),
            }),
          ],
        });
      }

      return jsxs("div", {
        className: "ddff_panel",
        children: [
          // 顶部 tab 栏：目录显隐 + 刷新 + 文件子页签（分页预览）。
          cwd === null
            ? null
            : jsxs("div", {
                className: "ddff_fileTabs",
                children: [
                  // 左：文件子页签（分页预览，可横向滚动）。
                  jsx("div", {
                    className: "ddff_tabsScroll",
                    ref: setTabsScroll,
                    children: filesSnap.files.map((file) => {
                      const title = ddffBasename(file.path);
                      const active = file.path === filesSnap.active;
                      return jsxs(
                        "button",
                        {
                          type: "button",
                          className: active ? "ddff_fileTab ddff_fileTabActive" : "ddff_fileTab",
                          title: file.path,
                          onClick: () => filesStore.activate(file.path),
                          children: [
                            jsx("span", {
                              className: "ddff_fileTabIcon",
                              children: jsx(fileIconFor(file.path), {
                                size: 14,
                              }),
                            }),
                            jsx("span", {
                              className: "ddff_fileTabName",
                              children: title,
                            }),
                            jsx("span", {
                              role: "button",
                              className: "ddff_fileTabClose",
                              "aria-label": t("panel.closeTab"),
                              onClick: (event) => {
                                event.stopPropagation();
                                filesStore.close(file.path);
                                // 关闭最后一个预览页签 → 同步折叠工作台。
                                if (
                                  filesStore.getSnapshot().files.length === 0 &&
                                  typeof service.collapse === "function"
                                ) {
                                  service.collapse();
                                }
                              },
                              children: jsx(XIcon, { size: 12 }),
                            }),
                          ],
                        },
                        file.path,
                      );
                    }),
                  }),
                  // 右：目录树显隐（眼睛：开=树显示，关=树隐藏）+ 刷新。
                  jsx("button", {
                    type: "button",
                    className: "ddff_toolBtn",
                    title: t("panel.toggleTree"),
                    "aria-label": t("panel.toggleTree"),
                    onClick: () => setTreeCollapsed((value) => !value),
                    children: jsx(treeCollapsed ? EyeOffIcon : EyeIcon, {
                      size: 16,
                    }),
                  }),
                  jsx("button", {
                    type: "button",
                    className: "ddff_toolBtn",
                    title: t("panel.refresh"),
                    "aria-label": t("panel.refresh"),
                    onClick: () => {
                      setEntries({});
                      setExpanded({});
                      setFatal(null);
                      loadDir(cwd);
                    },
                    children: jsx(RefreshCwIcon, {
                      size: 16,
                    }),
                  }),
                ],
              }),
          // 左右布局：左预览区 + 右目录树（可隐藏、可调宽）。
          jsxs("div", {
            className: "ddff_body",
            children: [
              // 左：预览区（顶部路径栏 + 内容）。
              jsx("div", {
                className: "ddff_main",
                children: [
                  // 路径栏：当前打开文件的路径（以会话 cwd 为根；
                  // 悬停显示绝对路径）+ 资源管理器显示按钮。
                  activeFile !== null
                    ? jsxs("div", {
                        className: "ddff_pathBar",
                        children: [
                          jsx("div", {
                            className: "ddff_pathText",
                            title: activeFile.path,
                            children: ddffRelativeToCwd(activeFile.path),
                          }),
                          revealError
                            ? jsx("span", {
                                className: "ddff_revealError",
                                children:
                                  t("panel.revealFailed") +
                                  (revealError ? " (" + revealError + ")" : ""),
                              })
                            : null,
                          jsx("button", {
                            type: "button",
                            className: "ddff_revealBtn",
                            disabled: revealPending,
                            title: t("panel.revealInExplorer"),
                            "aria-label": t("panel.revealInExplorer"),
                            onClick: () => {
                              setRevealPending(true);
                              revealInExplorer(activeFile.path)
                                .then((status) => {
                                  if (status !== 200) {
                                    setRevealError(status);
                                    if (revealErrorTimer.current !== null) {
                                      clearTimeout(revealErrorTimer.current);
                                    }
                                    revealErrorTimer.current = window.setTimeout(
                                      () => setRevealError(false),
                                      2500,
                                    );
                                  }
                                })
                                .finally(() => setRevealPending(false));
                            },
                            children: jsx(FolderSearchIcon, { size: 16 }),
                          }),
                          // 自动换行切换：代码预览长行折行显示。
                          jsx("button", {
                            type: "button",
                            className: wrapMode
                              ? "ddff_revealBtn ddff_toolActive"
                              : "ddff_revealBtn",
                            title: t("panel.toggleWrap"),
                            "aria-label": t("panel.toggleWrap"),
                            onClick: () => setWrapMode((value) => !value),
                            children: jsx(WrapTextIcon, { size: 16 }),
                          }),
                        ],
                      })
                    : null,
                  jsx("div", {
                    className: wrapMode
                      ? "ddff_preview ddff_previewWrap"
                      : "ddff_preview",
                    children: preview,
                  }),
                ],
              }),
              // 右：目录树（可隐藏；宽度可拖拽调整，默认 140px）。
              cwd === null
                ? null
                : jsxs(react.Fragment, {
                    children: [
                      // 拖拽调宽手柄（树与预览之间；树隐藏时一并隐藏）。
                      treeCollapsed
                        ? null
                        : jsx("div", {
                            className: "ddff_treeHandle",
                            onPointerDown: onTreeHandleDown,
                            onPointerMove: onTreeHandleMove,
                            onPointerUp: onTreeHandleUp,
                            onPointerCancel: onTreeHandleUp,
                          }),
                      jsxs("div", {
                        className: treeCollapsed
                          ? "ddff_treePane ddff_treePaneCollapsed"
                          : "ddff_treePane",
                        style: { flexBasis: treeWidth + "px" },
                        children: [
                          fatal !== null
                            ? jsx("div", {
                                className: "ddff_placeholder",
                                children: fatal,
                              })
                            : jsxs(react.Fragment, {
                                children: [
                                  // 根目录行不显示：直接从 cwd 内容开始。
                                  renderChildren(cwd, 0),
                                  loading !== null
                                    ? jsx("div", {
                                        className: "ddff_placeholder",
                                        children: t("viewer.loading"),
                                      })
                                    : null,
                                ],
                              }),
                        ],
                      }),
                    ],
                  }),
            ],
          }),
        ],
      });
    }
    //#endregion

    //#region 词典
    const zh = {
      "feature.title": "文件",
      "feature.description": "目录树与文件预览（图片 / 视频 / 音频 / Markdown / PDF / 代码高亮）",
      "panel.emptyTitle": "暂无工作区目录",
      "panel.emptyHint": "打开工作区后，即可在这里浏览与预览文件",
      "panel.hintTitle": "没有打开的文件",
      "panel.hint": "点击右侧目录树中的文件，或点击对话里的文件链接，预览会在这里以页签形式打开",
      "panel.toggleTree": "显示 / 隐藏目录树",
      "panel.refresh": "刷新",
      "panel.revealInExplorer": "在资源管理器中显示",
      "panel.revealFailed": "打开失败",
      "panel.openExternal": "用系统应用打开",
      "panel.openExternalFailed": "打开失败",
      "panel.toggleWrap": "自动换行：长行折行显示",
      "panel.loadFailed": "读取目录失败",
      "panel.closeTab": "关闭文件页签",
      "viewer.loading": "正在读取…",
      "viewer.loadFailed": "读取文件失败",
      "viewer.noViewerTitle": "无法预览此文件",
      "viewer.noViewerHint": "没有匹配的预览器，可用下方按钮调用系统应用打开",
    };
    const en = {
      "feature.title": "Files",
      "feature.description":
        "Directory tree and file previews (image / video / audio / Markdown / PDF / code highlight)",
      "panel.emptyTitle": "No workspace directory",
      "panel.emptyHint": "Open a workspace to browse and preview files here",
      "panel.hintTitle": "No open files",
      "panel.hint":
        "Click a file in the tree on the right, or a file link in the conversation; previews open here as tabs",
      "panel.toggleTree": "Show / hide directory tree",
      "panel.refresh": "Refresh",
      "panel.revealInExplorer": "Reveal in Explorer",
      "panel.revealFailed": "Reveal failed",
      "panel.openExternal": "Open in system app",
      "panel.openExternalFailed": "Failed to open",
      "panel.toggleWrap": "Word wrap: wrap long lines",
      "panel.loadFailed": "Failed to read directory",
      "panel.closeTab": "Close file tab",
      "viewer.loading": "Loading…",
      "viewer.loadFailed": "Failed to read file",
      "viewer.noViewerTitle": "Cannot preview this file",
      "viewer.noViewerHint": "No matching viewer; open it with your system apps below",
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
        "dsh-desktop-files: dictionaries",
      );

      // 「功能增强」聚合卡片开关（order 10）。
      ctx.slots.inject("desktop.features.item", () =>
        ctx.slots.register(
          {
            name: "desktop.features.item",
            id: "files",
            order: 10,
            locale: NS,
            inject: () => ({
              load: () => loadFilesConfig().then((config) => config.enabled),
              save: (enabled) => saveFilesConfig(enabled),
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
          const dispose = installFiles(ctx, t);
          if (typeof dispose === "function") disposers.push(dispose);
        }
        return disposers;
      };
      let active = [];
      const applyConfig = (config) => {
        for (const dispose of active) dispose();
        active = installFeature(config);
      };
      applyConfig({ enabled: true });
      void loadFilesConfig().then(applyConfig);
    }

    /** 等待 workbench 服务并注册文件页签；返回 disposer。 */
    function installFiles(ctx, t) {
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
          if (attempts < ddffRetryLimit) {
            attempts += 1;
            setTimeout(install, ddffRetryMs);
          }
          return;
        }
        workbench = candidate;

        // 会话跟随：维护 ddffStore 的 sessionId / cwd。
        const followSessions = () => {
          let sessions;
          try {
            sessions = ctx.get("sessions");
          } catch {
            sessions = void 0;
          }
          if (sessions === void 0) return; // install 已带重试，这里仅订阅
          const onList = () => {
            let snap;
            try {
              snap = sessions.list.getSnapshot();
            } catch {
              return;
            }
            const id = snap?.current ?? null;
            const cwd =
              id !== null && snap?.byId?.[id]?.cwd
                ? snap.byId[id].cwd
                : null;
            ddffStore.update(id, cwd);
          };
          let listOff = () => {};
          try {
            listOff = sessions.list.subscribe(onList);
          } catch {
            return () => {};
          }
          onList();
          return listOff;
        };
        const listOff = followSessions();
        disposers.push(() => {
          if (typeof listOff === "function") listOff();
        });

        // FilesPanel 由 workbench 渲染时会收到 workbench 词典的 t，
        // 这里用 files 自己的 t 覆盖，保证面板文案来自 desktop-files 词典。
        const FilesPanelWithT = (props) =>
          createElement(FilesPanel, { ...props, t });
        disposers.push(
          workbench.registerTab({
            id: "files",
            title: t("feature.title"),
            icon: FolderOpenIcon,
            order: 10,
            component: FilesPanelWithT,
          }),
        );

        // 拦截官方唯一文件打开入口 ctx.workspaces.openPath：点击会话里的
        // 文件链接（工具行路径 / 生成文件行 / 正文文件提及）→ 在「文件」
        // 页签内分页打开并激活该页签，而不是交给宿主 OS。
        // **选择性拦截**：只有匹配到预览器的文件才进页签；目录 / 未知
        // 类型放行官方实现——否则会连右键菜单「在资源管理器中打开」
        // （传目录）一起劫持。包装与恢复语义同 better-sidebar。
        let workspaces;
        try {
          workspaces = ctx.get("workspaces");
        } catch {
          workspaces = void 0;
        }
        if (workspaces !== void 0 && typeof workspaces.openPath === "function") {
          const originalOpenPath = workspaces.openPath;
          workspaces.openPath = (path) => {
            const absolute = ddffResolveAbsolute(path);
            const viewerId = matchViewerId(absolute);
            if (viewerId === null) {
              // 目录 / 无可预览类型：放行官方实现（如右键菜单打开工作区）。
              // 与 better-sidebar 同款：.call 保留 this——官方方法体依赖
              // workspaces 服务上下文，裸调会内部报错。
              return originalOpenPath.call(workspaces, path);
            }
            filesStore.open(absolute, viewerId);
            // 激活「文件」功能页签，让预览可见。
            workbench.activateTab("files");
            return Promise.resolve();
          };
          disposers.push(() => {
            workspaces.openPath = originalOpenPath;
          });
        }
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
