/**
 * dsh-desktop-git — browser half.
 *
 * 在工作台列注册「Git」功能页签：仓库状态（分支 + 暂存区/工作区文件
 * 列表）、VSCode 式 unified diff 视图（行号 + 增删高亮）、暂存 / 取消
 * 暂存 / 还原 / 提交（Ctrl+Enter）、提交历史列表。
 *
 * 数据流：
 *   - 全部经 host 端 /api/desktop-git/* 接口（git CLI 代理，会话 cwd
 *     白名单校验；本 client 只负责 UI 与请求拼接）；
 *   - 当前会话 id / cwd 经模块级 store 维护（跟随 sessions.list）；
 *   - 无文件 watcher：手动刷新（与 better-sidebar 同款）。
 */
window.__ModuleLoader__.load({
  id: "dsh-desktop-git",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react_jsx_runtime = require("react/jsx-runtime");
    let react = require("react");
    let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
    const { jsx, jsxs } = react_jsx_runtime;
    const { createElement } = react;

    //#region 内置图标库（lucide-static v1.31.0，ISC 许可，内联 SVG path）
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
    const GitBranchIcon = makeLucideIcon([
      jsx("path", { d: "M6 3v12" }),
      jsx("circle", { cx: 18, cy: 6, r: 3 }),
      jsx("circle", { cx: 6, cy: 18, r: 3 }),
      jsx("path", { d: "M18 9a9 9 0 0 1-9 9" }),
    ]);
    const RefreshCwIcon = makeLucideIcon([
      jsx("path", { d: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" }),
      jsx("path", { d: "M21 3v5h-5" }),
      jsx("path", { d: "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" }),
      jsx("path", { d: "M8 16H3v5" }),
    ]);
    const PlusIcon = makeLucideIcon([
      jsx("path", { d: "M5 12h14" }),
      jsx("path", { d: "M12 5v14" }),
    ]);
    const MinusIcon = makeLucideIcon([jsx("path", { d: "M5 12h14" })]);
    const Undo2Icon = makeLucideIcon([
      jsx("path", { d: "M9 14 4 9l5-5" }),
      jsx("path", { d: "M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11" }),
    ]);
    const HistoryIcon = makeLucideIcon([
      jsx("path", { d: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" }),
      jsx("path", { d: "M3 3v5h5" }),
      jsx("path", { d: "M12 7v5l4 2" }),
    ]);
    const ChevronDownIcon = makeLucideIcon([
      jsx("path", { d: "m6 9 6 6 6-6" }),
    ]);
    const CheckIcon = makeLucideIcon([
      jsx("path", { d: "M20 6 9 17l-5-5" }),
    ]);
    const FileIcon = makeLucideIcon([
      jsx("path", {
        d: "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",
      }),
      jsx("path", { d: "M14 2v5a1 1 0 0 0 1 1h5" }),
    ]);
    //#endregion

    //#region 常量与工具
    const NS = "desktop-git";
    const CONFIG_URL = "/api/desktop-git/config";
    const REPOS_URL = "/api/desktop-git/repos";
    const STATUS_URL = "/api/desktop-git/status";
    const DIFF_URL = "/api/desktop-git/diff";
    const LOG_URL = "/api/desktop-git/log";
    const STAGE_URL = "/api/desktop-git/stage";
    const UNSTAGE_URL = "/api/desktop-git/unstage";
    const COMMIT_URL = "/api/desktop-git/commit";
    const RESTORE_URL = "/api/desktop-git/restore";
    /** workbench / sessions 服务未就绪时的重试上限与间隔。 */
    const ddgitRetryMs = 500;
    const ddgitRetryLimit = 20;
    /** 历史条数。 */
    const ddgitLogLimit = 20;
    /**
     * 偏好持久化：
     *   - 分栏尺寸（列表宽度 / 历史高度）走 host 端 /api/desktop-workbench/prefs
     *     （不能用 localStorage——后端端口每次启动随机变化，web origin 随之
     *     变化，localStorage 在重启后整体失效）；
     *   - 仓库选择（工作区）per-session 持久化，走 /api/desktop-workbench/layout
     *     的 repo 字段（host 端 merge 语义，不覆盖框架自己的布局字段）。
     */
    const PREF_URL = "/api/desktop-workbench/prefs";
    const PREF_LIST_WIDTH = "git.listWidth";
    const PREF_HISTORY_HEIGHT = "git.historyHeight";
    const LAYOUT_URL = "/api/desktop-workbench/layout";
    const ddgitPrefSaveDebounceMs = 400;

    /** 读取全局偏好：失败回退空对象。 */
    function loadGitPrefs() {
      return fetch(PREF_URL, {
        headers: { accept: "application/json" },
        cache: "no-store",
      })
        .then((res) =>
          res.ok
            ? res.json()
            : Promise.reject(new Error("prefs-http-" + res.status)),
        )
        .then((body) =>
          body && typeof body.prefs === "object" && body.prefs !== null
            ? body.prefs
            : {},
        )
        .catch(() => ({}));
    }

    /** 写入偏好（白名单字段由 host 端窄化）。 */
    function saveGitPrefs(patch) {
      return fetch(PREF_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prefs: patch }),
      }).catch(() => {});
    }

    /** 读取当前会话的布局（仓库选择恢复用）。 */
    function loadGitLayout(sessionId) {
      return fetch(
        LAYOUT_URL + "?session=" + encodeURIComponent(sessionId),
        { headers: { accept: "application/json" }, cache: "no-store" },
      )
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null);
    }

    /** 持久化当前会话的仓库选择（merge 语义，只写 repo 字段）。 */
    function saveGitLayout(sessionId, repo) {
      return fetch(LAYOUT_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session: sessionId, layout: { repo } }),
      }).catch(() => {});
    }

    /** 当前会话 id / cwd（模块级 store，组件拼 URL 用）。 */
    const ddgitStore = {
      sessionId: null,
      cwd: null,
      listeners: new Set(),
      update(sessionId, cwd) {
        // 幂等保护：官方 sessions.list 在 AI 对话期间会因投影/任务帧
        // 频繁通知（快照本身不比较），current/cwd 未变时不得重发——
        // 否则 GitPanel 会被高频重渲染（对话中面板闪烁）。
        if (this.sessionId === sessionId && this.cwd === cwd) return;
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

    /** 拼接带会话参数的接口 URL；repo 为相对 cwd 的仓库目录（空 = 会话根）。 */
    function ddgitUrl(base, params, repo) {
      const url = new URL(base, "http://dsh.invalid");
      if (typeof ddgitStore.sessionId === "string") {
        url.searchParams.set("session", ddgitStore.sessionId);
      }
      if (typeof repo === "string" && repo !== "") {
        url.searchParams.set("repo", repo);
      }
      if (params) {
        for (const [key, value] of Object.entries(params)) {
          if (value !== null && value !== undefined && value !== "") {
            url.searchParams.set(key, String(value));
          }
        }
      }
      return url.pathname + "?" + url.searchParams.toString();
    }

    /** 读 JSON（网络错误 → throw）。 */
    function fetchJson(url) {
      return fetch(url, { cache: "no-store" }).then((res) =>
        res.ok
          ? res.json()
          : res.json().then((body) => Promise.reject(new Error(body?.error ?? "http-" + res.status))),
      );
    }

    /** POST JSON（非 2xx → reject，带服务端 error 文本）。 */
    function postJson(url, body) {
      return fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session: ddgitStore.sessionId, ...body }),
      }).then((res) =>
        res.ok
          ? res.json()
          : res.json().then((data) => Promise.reject(new Error(data?.error ?? "http-" + res.status))),
      );
    }

    /** 功能开关。 */
    function loadGitConfig() {
      return fetchJson(CONFIG_URL).catch(() => ({ enabled: true }));
    }
    function saveGitConfig(enabled) {
      return postJson(CONFIG_URL, { enabled });
    }

    /** 仓库状态（host 侧已解析；非仓库 → { repo: false }）。 */
    function fetchGitStatus(repo) {
      return fetchJson(ddgitUrl(STATUS_URL, {}, repo));
    }

    /** cwd 内可选的 git 仓库目录（相对路径列表，"" 表示会话根）。 */
    function fetchGitRepos() {
      return fetchJson(ddgitUrl(REPOS_URL)).then((body) => body?.repos ?? []);
    }

    /** 单文件 diff（staged=1 → 暂存区）。 */
    function fetchGitDiff(path, staged, repo) {
      return fetchJson(
        ddgitUrl(DIFF_URL, { path, staged: staged ? "1" : "0" }, repo),
      );
    }

    /** 提交历史。 */
    function fetchGitLog(repo) {
      return fetchJson(
        ddgitUrl(LOG_URL, { limit: String(ddgitLogLimit) }, repo),
      );
    }

    function gitStage(path, repo) {
      return postJson(STAGE_URL, { ...(path ? { path } : {}), repo });
    }
    function gitUnstage(path, repo) {
      return postJson(UNSTAGE_URL, { ...(path ? { path } : {}), repo });
    }
    function gitCommit(message, repo) {
      return postJson(COMMIT_URL, { message, repo });
    }
    function gitRestore(path, repo) {
      return postJson(RESTORE_URL, { path, repo });
    }
    //#endregion

    //#region 样式
    const css =
      ".ddgit_panel{height:100%;display:flex;flex-direction:column;min-width:0}" +
      // 顶部工具行：分支 + 刷新。
      ".ddgit_toolbar{flex:none;display:flex;align-items:center;gap:6px;padding:4px 8px;border-bottom:1px solid var(--dsw-alias-border-l2)}" +
      ".ddgit_branch{flex:1;min-width:0;display:inline-flex;align-items:center;gap:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".ddgit_branchIcon{flex:none;color:var(--dsw-alias-label-tertiary);display:inline-flex}" +
      ".ddgit_repoWrap{position:relative;flex:none}" +
      ".ddgit_repoBtn{appearance:none;height:22px;box-sizing:border-box;max-width:190px;display:inline-flex;align-items:center;justify-content:center;gap:4px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:11px;line-height:1;padding:0 8px;cursor:pointer}" +
      ".ddgit_repoBtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}" +
      ".ddgit_repoBtn:disabled{opacity:.5;cursor:default}" +
      ".ddgit_repoBtnLabel{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".ddgit_repoCaret{flex:none;color:var(--dsw-alias-label-tertiary);display:inline-flex}" +
      ".ddgit_repoMenu{position:absolute;top:calc(100% + 4px);left:0;min-width:200px;max-width:280px;z-index:50;display:flex;flex-direction:column;padding:4px;box-sizing:border-box;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.28)}" +
      ".ddgit_repoMenuTitle{padding:4px 8px 6px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);text-transform:uppercase;letter-spacing:.04em}" +
      ".ddgit_repoItem{appearance:none;width:100%;display:flex;align-items:center;gap:6px;border:0;border-radius:6px;background:0 0;font:inherit;font-size:12px;line-height:18px;padding:4px 8px;color:var(--dsw-alias-label-secondary);cursor:pointer;text-align:left}" +
      ".ddgit_repoItem:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}" +
      ".ddgit_repoItemActive{color:var(--dsw-alias-label-primary);font-weight:600}" +
      ".ddgit_repoItemIcon{flex:none;width:14px;display:inline-flex;color:var(--dsw-alias-label-tertiary)}" +
      ".ddgit_repoItemText{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".ddgit_toolBtn{appearance:none;flex:none;width:22px;height:22px;border:0;border-radius:6px;background:0 0;color:var(--dsw-alias-label-tertiary);cursor:pointer;display:inline-flex;align-items:center;justify-content:center}" +
      ".ddgit_toolBtn:hover:not(:disabled),.ddgit_toolBtn:focus-visible{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}" +
      ".ddgit_toolBtn:disabled{opacity:.5;cursor:default}" +
      // 主区：左文件列表 + 右 diff。
      ".ddgit_body{flex:1;min-height:0;display:flex}" +
      ".ddgit_list{flex:0 0 240px;min-width:0;display:flex;flex-direction:column;overflow:auto;padding-bottom:8px;border-right:1px solid var(--dsw-alias-border-l2)}" +
      ".ddgit_group{flex:none;display:flex;align-items:center;gap:6px;padding:4px 10px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);text-transform:uppercase;letter-spacing:.04em}" +
      ".ddgit_groupBtn{margin-left:auto;appearance:none;border:0;background:0 0;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:11px;line-height:16px;cursor:pointer;padding:0 2px}" +
      ".ddgit_groupBtn:hover:not(:disabled){color:var(--dsw-alias-label-primary)}" +
      ".ddgit_groupBtn:disabled{opacity:.45;cursor:default}" +
      ".ddgit_fileRow{width:100%;box-sizing:border-box;display:flex;align-items:center;gap:6px;padding:3px 8px 3px 10px;border:0;background:0 0;font:inherit;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);cursor:pointer;text-align:left}" +
      ".ddgit_fileRow:hover{background:var(--dsw-alias-interactive-bg-hover)}" +
      ".ddgit_fileRowActive{background:var(--dsw-alias-interactive-bg-selected)}" +
      ".ddgit_fileBadge{flex:none;width:1.4em;font-size:10px;line-height:14px;text-align:center;border-radius:3px;font-weight:600}" +
      ".ddgit_badgeStaged{color:#fff;background:var(--dsw-static-green-600, #2ea043)}" +
      ".ddgit_badgeWork{color:#fff;background:var(--dsw-static-red-600, #f85149)}" +
      ".ddgit_badgeUntracked{color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-2)}" +
      ".ddgit_filePath{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".ddgit_fileActions{flex:none;display:none;align-items:center;gap:2px}" +
      ".ddgit_fileRow:hover .ddgit_fileActions{display:inline-flex}" +
      ".ddgit_fileAction{appearance:none;border:0;border-radius:4px;background:0 0;color:var(--dsw-alias-label-tertiary);cursor:pointer;width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;padding:0}" +
      ".ddgit_fileAction:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}" +
      ".ddgit_fileAction:disabled{opacity:.4;cursor:default}" +
      ".ddgit_fileActionDanger:hover{color:var(--dsw-static-red-600)}" +
      ".ddgit_empty{padding:12px 16px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}" +
      // diff 区。
      ".ddgit_diff{flex:1;min-width:0;display:flex;flex-direction:column}" +
      ".ddgit_diffHead{flex:none;display:flex;align-items:center;gap:6px;padding:4px 8px;border-bottom:1px solid var(--dsw-alias-border-l2)}" +
      ".ddgit_diffPath{flex:1;min-width:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".ddgit_diffToggle{appearance:none;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:0 0;font:inherit;font-size:11px;line-height:16px;padding:1px 8px;color:var(--dsw-alias-label-tertiary);cursor:pointer}" +
      ".ddgit_diffToggle:hover:not(:disabled){color:var(--dsw-alias-label-primary)}" +
      ".ddgit_diffToggleActive{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}" +
      ".ddgit_diffToggle:disabled{opacity:.4;cursor:default}" +
      ".ddgit_diffScroll{flex:1;min-height:0;overflow:auto}" +
      ".ddgit_diffTable{width:100%;border-collapse:collapse;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:18px}" +
      ".ddgit_diffRow{display:flex}" +
      ".ddgit_diffGutter{flex:none;width:3.2em;box-sizing:border-box;padding:0 6px;text-align:right;color:var(--dsw-alias-label-dimmed);background:var(--dsw-alias-bg-base);-webkit-user-select:none;user-select:none}" +
      ".ddgit_diffGutterOld{border-right:1px solid var(--dsw-alias-border-l2)}" +
      ".ddgit_diffText{flex:1;min-width:0;padding:0 10px;white-space:pre;color:var(--dsw-alias-label-primary)}" +
      ".ddgit_diffAdd{background:rgba(46,160,67,.16)}" +
      ".ddgit_diffAdd .ddgit_diffGutter{background:rgba(46,160,67,.22)}" +
      ".ddgit_diffDel{background:rgba(248,81,73,.14)}" +
      ".ddgit_diffDel .ddgit_diffGutter{background:rgba(248,81,73,.2)}" +
      ".ddgit_diffHunk{color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-1)}" +
      ".ddgit_diffMeta{color:var(--dsw-alias-label-dimmed)}" +
      ".ddgit_diffPlaceholder{padding:16px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}" +
      // 提交区。
      ".ddgit_commit{flex:none;display:flex;flex-direction:column;gap:4px;padding:6px 8px;border-top:1px solid var(--dsw-alias-border-l2)}" +
      ".ddgit_commitBox{width:100%;box-sizing:border-box;resize:none;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;padding:4px 8px;min-height:48px;max-height:120px}" +
      ".ddgit_commitBox:focus{outline:none;border-color:var(--dsw-alias-interactive-fg-default)}" +
      ".ddgit_commitRow{display:flex;align-items:center;gap:6px}" +
      ".ddgit_commitBtn{appearance:none;flex:none;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;padding:2px 12px;cursor:pointer}" +
      ".ddgit_commitBtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}" +
      ".ddgit_commitBtn:disabled{opacity:.5;cursor:default}" +
      ".ddgit_commitBtnPrimary{background:var(--dsw-alias-interactive-fg-default, #4c8dff);border-color:transparent;color:#fff}" +
      ".ddgit_hint{flex:1;min-width:0;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".ddgit_hintError{color:var(--dsw-static-red-600)}" +
      ".ddgit_hintOk{color:var(--dsw-static-green-600, #2ea043)}" +
      // 历史。
      ".ddgit_history{flex:none;display:flex;flex-direction:column;border-top:1px solid var(--dsw-alias-border-l2)}" +
      ".ddgit_historyHead{flex:none;display:flex;align-items:center;gap:6px;padding:4px 8px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);text-transform:uppercase;letter-spacing:.04em}" +
      ".ddgit_historyList{flex:1;min-height:0;overflow:auto}" +
      ".ddgit_historyRow{display:flex;align-items:center;gap:8px;padding:2px 8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}" +
      ".ddgit_historyRow:hover{background:var(--dsw-alias-interactive-bg-hover)}" +
      ".ddgit_historyHash{flex:none;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;color:var(--dsw-alias-label-tertiary)}" +
      ".ddgit_historySubject{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".ddgit_historyDate{flex:none;font-size:11px;color:var(--dsw-alias-label-dimmed)}" +
      // 分栏拖拽把手（左右 / 上下）——与文件插件的树把手同款：
      // 6px、透明底、hover/active 用交互 hover 背景色 + 过渡动画。
      ".ddgit_resizeX{flex:none;width:6px;cursor:col-resize;touch-action:none;background:0 0;transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out)}" +
      ".ddgit_resizeY{flex:none;height:6px;cursor:row-resize;touch-action:none;background:0 0;transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out)}" +
      ".ddgit_resizeX:hover,.ddgit_resizeX:active,.ddgit_resizeY:hover,.ddgit_resizeY:active{background:var(--dsw-alias-interactive-bg-hover)}" +
      ".ddgit_placeholder{padding:12px 16px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.6}";
    const cssTagId = "dsh-desktop-git/Git.module.css";
    if (
      typeof document !== "undefined" &&
      document.querySelector("style[data-plugin-css=" + JSON.stringify(cssTagId) + "]") === null
    ) {
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-desktop-git";
      tag.dataset.pluginCss = cssTagId;
      tag.textContent = css;
      document.head.appendChild(tag);
    }
    //#endregion

    //#region diff 解析与渲染
    /** 解析 unified diff 文本 → 行数组（含行号 gutter 数据）。 */
    function parseUnifiedDiff(text) {
      const rows = [];
      let oldNo = 0;
      let newNo = 0;
      let inHunk = false;
      for (const line of text.split("\n")) {
        if (line.startsWith("@@")) {
          const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
          if (match !== null) {
            oldNo = Number(match[1]);
            newNo = Number(match[3]);
            inHunk = true;
            rows.push({ kind: "hunk", text: line, oldNo: null, newNo: null });
            continue;
          }
        }
        if (!inHunk) {
          rows.push({ kind: "meta", text: line, oldNo: null, newNo: null });
          continue;
        }
        if (line.startsWith("+")) {
          rows.push({ kind: "add", text: line, oldNo: null, newNo: newNo++ });
        } else if (line.startsWith("-")) {
          rows.push({ kind: "del", text: line, oldNo: oldNo++, newNo: null });
        } else if (line.startsWith("\\")) {
          rows.push({ kind: "meta", text: line, oldNo: null, newNo: null });
        } else {
          rows.push({ kind: "ctx", text: line, oldNo: oldNo++, newNo: newNo++ });
        }
      }
      return rows;
    }

    /** 单行 diff 渲染（行号双 gutter + 内容）。 */
    function DiffRow({ row }) {
      const kindClass =
        row.kind === "add"
          ? "ddgit_diffAdd"
          : row.kind === "del"
            ? "ddgit_diffDel"
            : row.kind === "hunk"
              ? "ddgit_diffHunk"
              : row.kind === "meta"
                ? "ddgit_diffMeta"
                : "";
      return jsxs("div", {
        className: "ddgit_diffRow " + kindClass,
        children: [
          jsx("span", {
            className: "ddgit_diffGutter ddgit_diffGutterOld",
            children: row.oldNo !== null ? String(row.oldNo) : "",
          }),
          jsx("span", {
            className: "ddgit_diffGutter",
            children: row.newNo !== null ? String(row.newNo) : "",
          }),
          jsx("span", {
            className: "ddgit_diffText",
            children: row.text.length > 0 ? row.text : " ",
          }),
        ],
      });
    }
    //#endregion

    //#region Git 面板
    /**
     * Git 面板：左文件列表（暂存区 / 工作区分组）+ 右 diff 视图 +
     * 底部提交区 + 历史。无 watcher，手动刷新。
     */
    function GitPanel({ ctx, service, t }) {
      const [sessionSnap, setSessionSnap] = react.useState(() =>
        ddgitStore.getSnapshot(),
      );
      const [status, setStatus] = react.useState({
        loading: true,
        repo: false,
        repoPath: "",
        branch: "",
        files: [],
        error: null,
      });
      // 当前 git 仓库目录（相对 cwd 路径，"" = 会话根目录）。
      const [repo, setRepo] = react.useState("");
      // cwd 内可选的 git 仓库（host 扫描结果，相对路径）。
      const [repos, setRepos] = react.useState([]);
      const [selected, setSelected] = react.useState(null); // { path, staged, untracked }
      const [diff, setDiff] = react.useState({
        loading: false,
        binary: false,
        content: "",
        truncated: false,
        error: null,
      });
      const [log, setLog] = react.useState({ loading: false, entries: [], error: null });
      const [message, setMessage] = react.useState("");
      const [busy, setBusy] = react.useState(false);
      const [hint, setHint] = react.useState(null); // { ok, text }
      const hintTimer = react.useRef(null);
      // 分栏尺寸：文件列表宽度 / 历史区高度（可拖拽，host 端 prefs 持久化；
      // localStorage 因后端端口每次启动变化而跨重启失效）。
      const [listWidth, setListWidth] = react.useState(240);
      const [historyHeight, setHistoryHeight] = react.useState(132);
      // 挂载时应用已保存偏好（异步：先默认值渲染，到达后收敛）。
      react.useEffect(() => {
        let current = true;
        loadGitPrefs().then((prefs) => {
          if (!current) return;
          if (typeof prefs[PREF_LIST_WIDTH] === "number" && Number.isFinite(prefs[PREF_LIST_WIDTH])) {
            setListWidth(
              Math.min(420, Math.max(140, Math.round(prefs[PREF_LIST_WIDTH]))),
            );
          }
          if (typeof prefs[PREF_HISTORY_HEIGHT] === "number" && Number.isFinite(prefs[PREF_HISTORY_HEIGHT])) {
            setHistoryHeight(
              Math.min(320, Math.max(64, Math.round(prefs[PREF_HISTORY_HEIGHT]))),
            );
          }
        });
        return () => {
          current = false;
        };
      }, []);
      // 变更 → 防抖写回（初始加载应用旧值不触发，值与 state 相同）。
      const prefsTimer = react.useRef(null);
      const schedulePrefSave = (patch) => {
        if (prefsTimer.current !== null) {
          clearTimeout(prefsTimer.current);
        }
        prefsTimer.current = window.setTimeout(
          () => saveGitPrefs(patch),
          ddgitPrefSaveDebounceMs,
        );
      };
      react.useEffect(() => {
        schedulePrefSave({ [PREF_LIST_WIDTH]: listWidth });
      }, [listWidth]);
      react.useEffect(() => {
        schedulePrefSave({ [PREF_HISTORY_HEIGHT]: historyHeight });
      }, [historyHeight]);
      react.useEffect(
        () => () => {
          if (prefsTimer.current !== null) {
            clearTimeout(prefsTimer.current);
          }
        },
        [],
      );

      // 分栏拖拽：x = 列表宽度，y = 历史区高度（pointer capture 拖动）。
      const resizeRef = react.useRef(null);
      const onResizeStart = (axis) => (event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        resizeRef.current = {
          axis,
          startX: event.clientX,
          startY: event.clientY,
          listWidth,
          historyHeight,
        };
      };
      const onResizeMove = (event) => {
        const drag = resizeRef.current;
        if (drag === null) return;
        if (drag.axis === "x") {
          setListWidth(
            Math.min(420, Math.max(140, Math.round(drag.listWidth + event.clientX - drag.startX))),
          );
        } else {
          setHistoryHeight(
            Math.min(320, Math.max(64, Math.round(drag.historyHeight + drag.startY - event.clientY))),
          );
        }
      };
      const onResizeEnd = (event) => {
        resizeRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      };

      react.useEffect(
        () => ddgitStore.subscribe(setSessionSnap),
        [],
      );

      const showHint = (ok, text) => {
        setHint({ ok, text });
        if (hintTimer.current !== null) clearTimeout(hintTimer.current);
        hintTimer.current = window.setTimeout(() => setHint(null), 4000);
      };

      /** 刷新状态 + 历史（保持选中项重取 diff）。快照绑定当前 repo。 */
      const refresh = react.useCallback(() => {
        setStatus((s) => ({ ...s, loading: true, repoPath: repo, error: null }));
        fetchGitStatus(repo)
          .then((snap) => {
            setStatus({
              loading: false,
              repo: snap.repo,
              repoPath: repo,
              branch: snap.branch ?? "",
              files: snap.files ?? [],
              error: null,
            });
            // 选中项若已不存在则清空。
            setSelected((sel) => {
              if (sel === null) return sel;
              const still = (snap.files ?? []).some((f) => f.path === sel.path);
              return still ? sel : null;
            });
            return fetchGitLog(repo)
              .then((entries) => setLog({ loading: false, entries, error: null }))
              .catch(() =>
                setLog((l) => ({ ...l, loading: false, entries: l.entries })),
              );
          })
          .catch((error) => {
            setStatus((s) => ({
              ...s,
              loading: false,
              error: error instanceof Error ? error.message : String(error),
            }));
          });
      }, [repo]);

      // 初始加载 + 会话变化：重扫仓库列表、恢复上次选择的仓库（保存值在
      // 新 cwd 的仓库列表中才应用，否则回退会话根）、重置选择并刷新。
      const repoRef = react.useRef(repo);
      repoRef.current = repo;
      const refreshRef = react.useRef(refresh);
      refreshRef.current = refresh;
      react.useEffect(() => {
        if (sessionSnap.sessionId === null) return;
        let current = true;
        setSelected(null);
        // 立即清空仓库列表与旧列表，避免切换瞬间点到旧会话的仓库/文件。
        setRepos([]);
        setStatus({ loading: true, repo: false, repoPath: "", branch: "", files: [], error: null });
        Promise.all([
          fetchGitRepos().catch(() => []),
          loadGitLayout(sessionSnap.sessionId),
        ]).then(([list, layoutBody]) => {
          if (!current) return;
          setRepos(list);
          const savedRepo =
            layoutBody &&
            typeof layoutBody.layout?.repo === "string" &&
            layoutBody.layout.repo !== ""
              ? layoutBody.layout.repo
              : "";
          const next =
            savedRepo !== "" && list.includes(savedRepo) ? savedRepo : "";
          if (next !== repoRef.current) {
            setRepo(next);
          } else {
            refreshRef.current();
          }
        });
        return () => {
          current = false;
        };
      }, [sessionSnap.sessionId]);

      // 仓库选择变化 → 刷新（不重置仓库选择本身）。
      react.useEffect(() => {
        if (sessionSnap.sessionId === null) return;
        refreshRef.current();
      }, [repo, sessionSnap.sessionId]);

      /** 选择文件：有暂存改动 → 看暂存区 diff，否则工作区。
       *  列表快照与当前仓库不一致（切换中）时忽略点击。 */
      const selectFile = (file, staged) => {
        if (status.loading || !status.repo || status.repoPath !== repo) return;
        const useStaged = staged ?? (file.staged && !file.untracked);
        setSelected({
          path: file.path,
          staged: useStaged,
          untracked: file.untracked,
        });
      };

      // 选中项变化 → 拉 diff。
      react.useEffect(() => {
        if (selected === null) {
          setDiff({ loading: false, binary: false, content: "", truncated: false, error: null });
          return;
        }
        let current = true;
        setDiff({ loading: true, binary: false, content: "", truncated: false, error: null });
        fetchGitDiff(selected.path, selected.staged, repo)
          .then((result) => {
            if (!current) return;
            setDiff({
              loading: false,
              binary: !!result.binary,
              content: result.content ?? "",
              truncated: !!result.truncated,
              error: null,
            });
          })
          .catch((error) => {
            if (!current) return;
            setDiff({
              loading: false,
              binary: false,
              content: "",
              truncated: false,
              error: error instanceof Error ? error.message : String(error),
            });
          });
        return () => {
          current = false;
        };
      }, [selected, repo]);

      /** 操作封装：执行 + 反馈 + 刷新。 */
      const runAction = (label, action, after) => {
        setBusy(true);
        action()
          .then(() => {
            showHint(true, label);
            refresh();
            if (after) after();
          })
          .catch((error) => {
            showHint(false, error instanceof Error ? error.message : String(error));
          })
          .finally(() => setBusy(false));
      };

      const stagedFiles = status.files.filter((f) => f.staged);
      const workFiles = status.files.filter((f) => !f.staged);

      // 渲染文件列表组。
      const renderGroup = (title, files, badgeFor, extraAction, extraLabel) => {
        if (files.length === 0) return null;
        return jsxs(react.Fragment, {
          children: [
            jsxs("div", {
              className: "ddgit_group",
              children: [
                jsx("span", { children: title + " (" + files.length + ")" }),
                extraAction
                  ? jsx("button", {
                      type: "button",
                      className: "ddgit_groupBtn",
                      disabled:
                        busy ||
                        status.loading ||
                        !status.repo ||
                        status.repoPath !== repo,
                      onClick: (event) => {
                        event.stopPropagation();
                        runAction(
                          extraLabel,
                          () => extraAction(),
                        );
                      },
                      children: extraLabel,
                    })
                  : null,              ],
            }),
            files.map((file) => {
              const active =
                selected !== null && selected.path === file.path;
              const badge = badgeFor(file);
              return jsxs("button", {
                type: "button",
                className:
                  "ddgit_fileRow" + (active ? " ddgit_fileRowActive" : ""),
                onClick: () => selectFile(file, undefined),
                children: [
                  jsx("span", {
                    className: "ddgit_fileBadge " + badge.className,
                    children: badge.label,
                  }),
                  jsx("span", {
                    className: "ddgit_filePath",
                    children: file.path,
                  }),
                  jsx("span", {
                    className: "ddgit_fileActions",
                    children: [
                      jsx("button", {
                        type: "button",
                        className: "ddgit_fileAction",
                        title: file.staged ? t("panel.unstage") : t("panel.stage"),
                        disabled:
                          busy ||
                          status.loading ||
                          !status.repo ||
                          status.repoPath !== repo,
                        onClick: (event) => {
                          event.stopPropagation();
                          runAction(
                            file.staged ? t("panel.unstaged") : t("panel.staged"),
                            () =>
                              file.staged
                                ? gitUnstage(file.path, repo)
                                : gitStage(file.path, repo),
                          );
                        },
                        children: jsx(file.staged ? MinusIcon : PlusIcon, {
                          size: 13,
                        }),
                      }),
                      jsx("button", {
                        type: "button",
                        className: "ddgit_fileAction ddgit_fileActionDanger",
                        title: t("panel.restore"),
                        disabled:
                          busy ||
                          status.loading ||
                          !status.repo ||
                          status.repoPath !== repo,
                        onClick: (event) => {
                          event.stopPropagation();
                          if (!window.confirm(t("panel.restoreConfirm"))) return;
                          runAction(t("panel.restored"), () => gitRestore(file.path, repo));
                        },
                        children: jsx(Undo2Icon, { size: 13 }),
                      }),
                    ],
                  }),
                ],
              });
            }),
          ],
        });
      };

      const commit = () => {
        const text = message.trim();
        if (text.length === 0) return;
        runAction(t("panel.committed"), () => gitCommit(text, repo), () => {
          setMessage("");
          setSelected(null);
        });
      };

      // 仓库选择菜单开关 + 点击外部关闭。
      const [repoOpen, setRepoOpen] = react.useState(false);
      const repoWrapRef = react.useRef(null);
      react.useEffect(() => {
        if (!repoOpen) return;
        const onDown = (event) => {
          if (
            repoWrapRef.current !== null &&
            !repoWrapRef.current.contains(event.target)
          ) {
            setRepoOpen(false);
          }
        };
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
      }, [repoOpen]);

      const repoOptions = repos.filter((r) => r !== "");
      const pickRepo = (value) => {
        setRepoOpen(false);
        if (value === repo) return;
        setSelected(null);
        // 立即清空旧列表（快照绑定旧 repo，防止切换瞬间误操作）。
        setStatus({ loading: true, repo: false, repoPath: value, branch: "", files: [], error: null });
        setRepo(value);
        // 持久化当前会话的仓库选择（失败静默，不影响使用）。
        if (sessionSnap.sessionId !== null) {
          saveGitLayout(sessionSnap.sessionId, value);
        }
      };

      return jsxs("div", {
        className: "ddgit_panel",
        children: [
          // 顶部工具行：仓库选择 + 分支 + 刷新。
          jsxs("div", {
            className: "ddgit_toolbar",
            children: [
              repos.length > 0
                ? jsxs("div", {
                    className: "ddgit_repoWrap",
                    ref: repoWrapRef,
                    children: [
                      jsxs("button", {
                        type: "button",
                        className: "ddgit_repoBtn",
                        disabled: busy,
                        title: t("panel.repoSelect"),
                        onClick: () => setRepoOpen((v) => !v),
                        children: [
                          jsx("span", {
                            className: "ddgit_repoBtnLabel",
                            children:
                              repo === "" ? t("panel.repoRoot") : repo,
                          }),
                          jsx("span", {
                            className: "ddgit_repoCaret",
                            children: jsx(ChevronDownIcon, { size: 12 }),
                          }),
                        ],
                      }),
                      repoOpen
                        ? jsxs("div", {
                            className: "ddgit_repoMenu",
                            children: [
                              jsx("div", {
                                className: "ddgit_repoMenuTitle",
                                children: t("panel.repoSelect"),
                              }),
                              jsx("button", {
                                type: "button",
                                className:
                                  "ddgit_repoItem" +
                                  (repo === "" ? " ddgit_repoItemActive" : ""),
                                onClick: () => pickRepo(""),
                                children: [
                                  jsx("span", {
                                    className: "ddgit_repoItemIcon",
                                    children:
                                      repo === ""
                                        ? jsx(CheckIcon, { size: 12 })
                                        : null,
                                  }),
                                  jsx("span", {
                                    className: "ddgit_repoItemText",
                                    children: t("panel.repoRoot"),
                                  }),
                                ],
                              }),
                              ...repoOptions.map((r) =>
                                jsxs("button", {
                                  type: "button",
                                  className:
                                    "ddgit_repoItem" +
                                    (repo === r ? " ddgit_repoItemActive" : ""),
                                  onClick: () => pickRepo(r),
                                  children: [
                                    jsx("span", {
                                      className: "ddgit_repoItemIcon",
                                      children:
                                        repo === r
                                          ? jsx(CheckIcon, { size: 12 })
                                          : null,
                                    }),
                                    jsx("span", {
                                      className: "ddgit_repoItemText",
                                      children: r,
                                    }),
                                  ],
                                }),
                              ),
                            ],
                          })
                        : null,
                    ],
                  })
                : null,
              jsx("span", {
                className: "ddgit_branch",
                children: [
                  jsx("span", {
                    className: "ddgit_branchIcon",
                    children: jsx(GitBranchIcon, { size: 13 }),
                  }),
                  jsx("span", {
                    children: status.repo
                      ? (repo !== "" ? repo + " · " : "") +
                        (status.branch !== "" ? status.branch : t("panel.detached"))
                      : t("panel.notRepo"),
                  }),
                ],
              }),
              jsx("button", {
                type: "button",
                className: "ddgit_toolBtn",
                title: t("panel.refresh"),
                "aria-label": t("panel.refresh"),
                disabled: busy || status.loading,
                onClick: refresh,
                children: jsx(RefreshCwIcon, { size: 14 }),
              }),
            ],
          }),
          // 主区：列表 + 拖拽把手 + diff。
          jsxs("div", {
            className: "ddgit_body",
            children: [
              jsxs("div", {
                className: "ddgit_list",
                style: { flexBasis: listWidth + "px" },
                children: [
                  status.loading
                    ? jsx("div", { className: "ddgit_placeholder", children: t("viewer.loading") })
                    : status.error !== null
                      ? jsx("div", { className: "ddgit_placeholder", children: t("panel.loadFailed") + " (" + status.error + ")" })
                      : !status.repo
                        ? jsx("div", { className: "ddgit_placeholder", children: t("panel.notRepo") })
                        : jsxs(react.Fragment, {
                            children: [
                              renderGroup(
                                t("panel.staged"),
                                stagedFiles,
                                (f) => ({ label: f.x, className: "ddgit_badgeStaged" }),
                                () => gitUnstage(null, repo),
                                t("panel.unstageAll"),
                              ),
                              renderGroup(
                                t("panel.worktree"),
                                workFiles,
                                (f) =>
                                  f.untracked
                                    ? { label: "U", className: "ddgit_badgeUntracked" }
                                    : { label: f.y, className: "ddgit_badgeWork" },
                                () => gitStage(null, repo),
                                t("panel.stageAll"),
                              ),
                              stagedFiles.length === 0 && workFiles.length === 0
                                ? jsx("div", {
                                    className: "ddgit_empty",
                                    children: t("panel.noChanges"),
                                  })
                                : null,
                            ],
                          }),
                ],
              }),
              // 左右分栏拖拽把手。
              jsx("div", {
                className: "ddgit_resizeX",
                onPointerDown: onResizeStart("x"),
                onPointerMove: onResizeMove,
                onPointerUp: onResizeEnd,
                onPointerCancel: onResizeEnd,
              }),
              // 右侧 diff 视图。
              jsxs("div", {
                className: "ddgit_diff",
                children: [
                  selected !== null
                    ? jsxs("div", {
                        className: "ddgit_diffHead",
                        children: [
                          jsx("span", {
                            className: "ddgit_diffPath",
                            children: selected.path,
                          }),
                          jsx("button", {
                            type: "button",
                            className:
                              "ddgit_diffToggle" +
                              (selected.staged ? " ddgit_diffToggleActive" : ""),
                            disabled: selected.untracked,
                            onClick: () =>
                              setSelected({ ...selected, staged: true }),
                            children: t("panel.diffStaged"),
                          }),
                          jsx("button", {
                            type: "button",
                            className:
                              "ddgit_diffToggle" +
                              (!selected.staged ? " ddgit_diffToggleActive" : ""),
                            onClick: () =>
                              setSelected({ ...selected, staged: false }),
                            children: t("panel.diffWorktree"),
                          }),
                        ],
                      })
                    : null,
                  jsx("div", {
                    className: "ddgit_diffScroll",
                    children: selected === null
                      ? jsx("div", {
                          className: "ddgit_diffPlaceholder",
                          children: t("panel.selectHint"),
                        })
                      : diff.loading
                        ? jsx("div", { className: "ddgit_diffPlaceholder", children: t("viewer.loading") })
                        : diff.error !== null
                          ? jsx("div", {
                              className: "ddgit_diffPlaceholder",
                              children: t("panel.diffFailed") + " (" + diff.error + ")",
                            })
                          : selected.untracked
                            ? jsx("div", {
                                className: "ddgit_diffPlaceholder",
                                children: t("panel.untrackedHint"),
                              })
                            : diff.binary
                              ? jsx("div", {
                                  className: "ddgit_diffPlaceholder",
                                  children: t("panel.binary"),
                                })
                              : diff.content.length === 0
                                ? jsx("div", {
                                    className: "ddgit_diffPlaceholder",
                                    children: t("panel.noDiff"),
                                  })
                                : jsxs("div", {
                                    className: "ddgit_diffTable",
                                    children: [
                                      ...parseUnifiedDiff(diff.content).map(
                                        (row, index) =>
                                          createElement(DiffRow, {
                                            key: index,
                                            row,
                                          }),
                                      ),
                                      diff.truncated
                                        ? jsx("div", {
                                            className: "ddgit_diffPlaceholder",
                                            children: t("panel.diffTruncated"),
                                          })
                                        : null,
                                    ],
                                  }),
                  }),
                ],
              }),
            ],
          }),
          // 提交区。
          jsxs("div", {
            className: "ddgit_commit",
            children: [
              jsx("textarea", {
                className: "ddgit_commitBox",
                value: message,
                placeholder: t("panel.commitPlaceholder"),
                disabled: busy,
                onChange: (event) => setMessage(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault();
                    commit();
                  }
                },
              }),
              jsxs("div", {
                className: "ddgit_commitRow",
                children: [
                  jsx("button", {
                    type: "button",
                    className: "ddgit_commitBtn ddgit_commitBtnPrimary",
                    disabled:
                      busy ||
                      status.loading ||
                      status.repoPath !== repo ||
                      message.trim().length === 0 ||
                      !status.repo,
                    onClick: commit,
                    children: t("panel.commit"),
                  }),
                  jsx("span", {
                    className:
                      "ddgit_hint" +
                      (hint === null ? "" : hint.ok ? " ddgit_hintOk" : " ddgit_hintError"),
                    children: hint === null ? t("panel.commitHint") : hint.text,
                  }),
                ],
              }),
            ],
          }),
          // 历史（上沿可拖拽调高/调低）。
          jsx("div", {
            className: "ddgit_resizeY",
            onPointerDown: onResizeStart("y"),
            onPointerMove: onResizeMove,
            onPointerUp: onResizeEnd,
            onPointerCancel: onResizeEnd,
          }),
          jsxs("div", {
            className: "ddgit_history",
            style: { height: historyHeight + "px" },
            children: [
              jsxs("div", {
                className: "ddgit_historyHead",
                children: [
                  jsx("span", { children: t("panel.history") }),
                ],
              }),
              jsx("div", {
                className: "ddgit_historyList",
                children:
                  log.entries.length === 0
                    ? jsx("div", { className: "ddgit_empty", children: t("panel.noCommits") })
                    : log.entries.map((entry, index) =>
                        jsxs("div", {
                          className: "ddgit_historyRow",
                          title: entry.hash,
                          children: [
                            jsx("span", {
                              className: "ddgit_historyHash",
                              children: entry.short,
                            }),
                            jsx("span", {
                              className: "ddgit_historySubject",
                              children: entry.subject,
                            }),
                            jsx("span", {
                              className: "ddgit_historyDate",
                              children: entry.date,
                            }),
                          ],
                        }),
                      ),
              }),
            ],
          }),
        ],
      });
    }
    //#endregion

    //#region 词典
    const zh = {
      "feature.title": "Git",
      "feature.description": "Git 面板：改动 / 暂存 / 提交 / 历史（diff 视图）",
      "panel.notRepo": "当前目录不是 Git 仓库",
      "panel.detached": "游离 HEAD",
      "panel.repoSelect": "选择 Git 仓库目录",
      "panel.repoRoot": "会话根目录",
      "panel.refresh": "刷新",
      "panel.staged": "暂存区",
      "panel.worktree": "工作区",
      "panel.stageAll": "全部暂存",
      "panel.unstageAll": "全部取消暂存",
      "panel.stage": "暂存",
      "panel.unstage": "取消暂存",
      "panel.staged": "已暂存",
      "panel.unstaged": "已取消暂存",
      "panel.restore": "还原",
      "panel.restored": "已还原",
      "panel.restoreConfirm": "确定丢弃该文件的工作区改动？此操作不可撤销。",
      "panel.noChanges": "没有改动",
      "panel.selectHint": "在左侧选择一个文件查看 diff",
      "panel.diffStaged": "暂存区",
      "panel.diffWorktree": "工作区",
      "panel.binary": "二进制文件，无法显示 diff",
      "panel.untrackedHint": "未跟踪文件（暂存后即可查看 diff）",
      "panel.noDiff": "该视图没有 diff",
      "panel.diffTruncated": "diff 过大，已截断显示",
      "panel.diffFailed": "diff 读取失败",
      "panel.commit": "提交",
      "panel.commitPlaceholder": "提交说明（Ctrl+Enter 提交）",
      "panel.commitHint": "输入提交说明后 Ctrl+Enter 提交",
      "panel.committed": "已提交",
      "panel.history": "历史",
      "panel.noCommits": "暂无提交",
      "panel.loadFailed": "读取失败",
      "viewer.loading": "加载中…",
    };
    const en = {
      "feature.title": "Git",
      "feature.description":
        "Git panel: changes / staging / commit / history (diff view)",
      "panel.notRepo": "Current directory is not a Git repository",
      "panel.detached": "Detached HEAD",
      "panel.repoSelect": "Select Git repository directory",
      "panel.repoRoot": "Session root",
      "panel.refresh": "Refresh",
      "panel.staged": "Staged",
      "panel.worktree": "Worktree",
      "panel.stageAll": "Stage all",
      "panel.unstageAll": "Unstage all",
      "panel.stage": "Stage",
      "panel.unstage": "Unstage",
      "panel.staged": "Staged",
      "panel.unstaged": "Unstaged",
      "panel.restore": "Restore",
      "panel.restored": "Restored",
      "panel.restoreConfirm":
        "Discard worktree changes for this file? This cannot be undone.",
      "panel.noChanges": "No changes",
      "panel.selectHint": "Select a file on the left to view its diff",
      "panel.diffStaged": "Staged",
      "panel.diffWorktree": "Worktree",
      "panel.binary": "Binary file, diff not available",
      "panel.untrackedHint": "Untracked file (stage it to see the diff)",
      "panel.noDiff": "No diff in this view",
      "panel.diffTruncated": "Diff too large, truncated",
      "panel.diffFailed": "Failed to load diff",
      "panel.commit": "Commit",
      "panel.commitPlaceholder": "Commit message (Ctrl+Enter to commit)",
      "panel.commitHint": "Type a message and press Ctrl+Enter to commit",
      "panel.committed": "Committed",
      "panel.history": "History",
      "panel.noCommits": "No commits yet",
      "panel.loadFailed": "Failed to load",
      "viewer.loading": "Loading…",
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
        "dsh-desktop-git: dictionaries",
      );

      // 「功能增强」聚合卡片开关（order 30）。
      ctx.slots.inject("desktop.features.item", () =>
        ctx.slots.register(
          {
            name: "desktop.features.item",
            id: "git",
            order: 30,
            locale: NS,
            inject: () => ({
              load: () => loadGitConfig().then((config) => config.enabled),
              save: (enabled) => saveGitConfig(enabled),
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
          const dispose = installGit(ctx, t);
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
      void loadGitConfig().then(applyConfig);
    }

    /** 等待 workbench 服务并注册 Git 页签；返回 disposer。 */
    function installGit(ctx, t) {
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
          if (attempts < ddgitRetryLimit) {
            attempts += 1;
            setTimeout(install, ddgitRetryMs);
          }
          return;
        }
        workbench = candidate;

        // 会话跟随：维护 ddgitStore 的 sessionId / cwd。
        const followSessions = () => {
          let sessions;
          try {
            sessions = ctx.get("sessions");
          } catch {
            sessions = void 0;
          }
          if (sessions === void 0) return;
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
            ddgitStore.update(id, cwd);
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

        // GitPanel 由 workbench 渲染时会收到 workbench 词典的 t，
        // 这里用 git 自己的 t 覆盖，保证面板文案来自 desktop-git 词典。
        const GitPanelWithT = (props) =>
          createElement(GitPanel, { ...props, t });
        disposers.push(
          workbench.registerTab({
            id: "git",
            title: t("feature.title"),
            icon: GitBranchIcon,
            order: 30,
            component: GitPanelWithT,
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
