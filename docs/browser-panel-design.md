# 工作台内置浏览器 —— 设计方案（V2 首版）

> 版本：v2（评审稿）· **首版即 WebContentsView 真浏览器路线**
> 适用范围：`desktop-shell`（Electron 43 + DSH 0.1.0-rc.6，Windows 桌面壳）
> 目标：在「对话页内部右侧分栏」工作台（`dsh-desktop-workbench`）中新增「浏览器」功能页签，基于 Electron 原生视图渲染（支持登录态 / X-Frame 站点 / 真实历史），为 U3（agent 操作网页）预埋主进程级 webContents 基建。
> 路线决策：经评审确认**直接以 V2 起步**，不先做沙箱 iframe 中间版（理由见[§1.5](#15-路线决策记录)）。线上版本稳定、不急于发版，质量与完整性优先。

---

## 1. 背景与约束

### 1.1 桌面壳架构（事实核查结论）

- **壳**：Electron 43.4.0 单窗口；渲染进程 `sandbox: true` + `contextIsolation: true` + `nodeIntegration: false`，加载 `http://127.0.0.1:<随机端口>/`（DSH 后端，端口每次启动变化）。
- **内置插件**：`desktop-shell/plugins/dsh-desktop-*`（9 个），每个插件双半结构：
  - **host 半**（`lib/index.js`，后端 Node 侧）：注册 `webServer` HTTP 路由（`/api/desktop-<name>/config` 开关 + 功能路由），持久化到 `$DSH_HOME/*.json`（原子写）。
  - **client 半**（`lib/client.js`，浏览器侧）：`window.__ModuleLoader__.load` bundle，可 `require("react")` / `@deepseek-ai/dsh-client-ui-primitives`。
- **工作台框架**（`dsh-desktop-workbench`）：在官方 ChatView 根做两列 grid 的 **DOM 注入**分栏（右列 = 工作台），提供 `desktop.workbench` 服务：`registerTab({id, title, icon?, order?, badge?, component})`。文件页签（order 10）、Git 页签（order 30）已注册。**新功能面板零新增 DOM 注入**——只需注册页签。
- **功能开关模式**（`dsh-desktop-features`）：官方 `settings.plugin.item` 聚合卡片（rc.7 keyed 契约，key `desktop-features`）→ 子插槽 `desktop.features.item` 数据接口 `{load, save, title, description}`，开关持久化走各插件自己的 host 端点。
- **主进程 ↔ 渲染进程既有通道**（本方案直接沿用）：
  - 渲染 → 主：`console-message` 标记（`__DSH_TITLEBAR_THEME__:` / `__DSH_DESKTOP_WAKE__:` / `__DSH_DESKTOP_UPDATE__:`）；
  - 主 → 渲染：`webContents.executeJavaScript` 派发 CustomEvent（`dsh-desktop-tray-command` / `dsh-desktop-update-event`）。
- **导航安全（现状）**：`configureNavigation` 只放行 backend 源的主 frame 导航；非 backend 源的 `window.open` / 新窗口 → `shell.openExternal`（系统浏览器）。

### 1.2 对本方案的关键约束

1. **后端端口随机**：不能依赖 localStorage 持久化（origin 每次启动变化），偏好必须走 host 端点。
2. **本方案必须动主进程**：WebContentsView 是原生视图，创建/定位/导航/事件全部在主进程；渲染进程沙箱化，插件 bundle 只能经既有标记/CustomEvent 通道与主进程通信（**不引入 preload IPC 新面**）。
3. **原生视图永远盖在 DSH 页面之上**：DSH 自己的弹层（设置抽屉 aria-modal、命令菜单、确认框）会被视图遮挡——必须做 overlay 联动隐藏（见[§4.5](#45-z-order-与-dsh-浮层联动)）。
4. **安全底线**：浏览器视图与 DSH 主界面必须隔离（独立会话分区）；绝不能让它打到 `127.0.0.1:<dsh端口>` 的本地 API（信任栅栏之外的自带 token 接口、`/api/*`、`/plugins/*`）。

### 1.3 目标用途与用户场景（已确认）

| # | 场景 | 描述 | 规划 |
|---|---|---|---|
| U1 | 临时查资料 | 手动唤起工作台 → 「浏览器」页签 → 地址栏/搜索进入目标页面，边查边聊 | **首版核心** |
| U2 | 聊天区链接点击预览 | 点聊天消息流里的 http/https 链接 → 内置浏览器页签内预览。**选择性拦截**：只拦聊天消息流内的链接，其余位置保持原行为（系统浏览器） | **首版同版本**（面板在即，拦截器是独立小件） |
| U3 | Agent 唤起/操作浏览器 | Agent 在项目测试时主动开网页，读页面 / 点击 / 填写（类比 zcode browser-use、dsh-chrome） | **紧随首版**（同基建增量：webContents 从第一天就存在） |

### 1.4 关键事实：聊天区 URL 链接没有官方服务入口

- 官方客户端只有 `host.openPath`（文件/目录打开）——`dsh-desktop-files` 插件的「选择性拦截」包装的就是它。**URL 链接没有等价服务**（已在 `dsh-client-ui-conversation` 源码核实：聊天链接是普通 `<a href>`，无 `_blank`/拦截逻辑）。
- 桌面壳主进程 `will-navigate` + `setWindowOpenHandler` 把非 backend 源导航一律转 `shell.openExternal`——这就是现状「聊天链接 → 系统浏览器」的来源。
- **结论**：U2 的拦截点只能在 **DOM 层**（capture 阶段 click 监听、限定 `[data-chat-flow]` 消息流、匹配 `a[href^="http"]`）。符合 PLUGIN_STANDARDS §4.3（第 ④ 级 DOM 干预）：单点集中封装 + README 登记契约 + 升级检查清单；`[data-chat-flow]` 已是 workbench 既有依赖面，不新增第二处私有选择器。

### 1.5 路线决策记录

| 时间 | 决策 | 说明 |
|---|---|---|
| 评审 1 | 外链分流默认 **面板内全开**（选项 A） | 被 X-Frame 拒绝的站点才提示外部打开 |
| 评审 2 | **直接 V2 起步**，跳过沙箱 iframe 中间版 | 理由：① 用户核心站点（Google/X/需登录站点）多为 iframe 不可嵌，V1 价值打折；② U3 必须主进程级 webContents，V1 给不了；③ 首版 UI 层（地址栏/标签/工具栏/设置/持久化/校验）两版共享，V2 不做无用功；④ 线上版本稳定、不急发版，可承担 V2 更长开发周期与更高首版风险 |
| 备选（不采用） | 沙箱 iframe 方案（better-sidebar 内核） | 保留为「若 V2 桥卡死」的回退参考；其 UI/校验/持久化设计仍可复用到 V2 的 BrowserPanel |

---

## 2. 社区调研结论（better-sidebar 与插件生态）

| 项目 | 形态 | 与本需求的关系 |
|---|---|---|
| [omdsh-dev/DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) | 通用侧边栏/底部双工作台框架，内置「内嵌浏览器」：沙箱 iframe、多 tab、后退/前进/刷新、地址栏拒绝 `javascript:`/`data:`/`file:`/localhost、X-Frame 拒绝站点显示原因面板 + 「在浏览器中打开」 | **UI/交互/安全设计参照**（其 iframe 内核不采用）；稳妥做法参考其设置项、会话隔离、插件接入 |
| [anweat/dsh-browser](https://github.com/anweat/dsh-browser) | GitHub 上的 dsh 浏览器插件（文档源受限） | 同类候选，成熟度/维护状态不明，不引入 |
| [Lum1104/dsh-browser](https://github.com/Lum1104/dsh-browser) | Chrome MV3 扩展桥：agent 接真实浏览器标签页（读/点/填/滚/导航，保留登录态） | **U3 的能力对标**（受控标签页模型），桌面端用 V2 主进程桥实现，不依赖 Chrome 扩展 |
| [dsh-chrome](https://www.npmjs.com/package/dsh-chrome) | Chrome 侧面板内嵌 dsh web UI，agent 读当前页 / 抓 HTTP 流量 / 驱动浏览器 | 同上，Chrome 侧方案 |
| [dsh-jiey-browser](https://www.npmjs.com/package/dsh-jiey-browser) | MCP 驱动 Jiey Browser（Chromium agent 工具） | 外部浏览器方案，不引入 |
| [dsh-workbench](https://www.npmjs.com/package/dsh-workbench) | 独立的右侧文件工作台插件 | 社区版 workbench；桌面壳已有私有 workbench，不并轨 |

**结论**：
1. 社区没有「工作台内原生浏览器视图」的现成实现——这是桌面壳独有的优势面（普通 DSH Web 无法建原生视图，桌面壳可以）。
2. 交互/安全设计参照 better-sidebar；U3 能力对标浏览器桥方案，但走主进程桥而非 Chrome 扩展。
3. **不引入 better-sidebar 本体**（双工作台、双持久化体系、DOM 注入冲突风险）。

---

## 3. 总体架构（V2 首版）

```
┌──────────────────────── 渲染进程（DSH Web UI）────────────────────────┐
│  dsh-desktop-browser（client 半）                                     │
│  ├─ desktop.features.item 开关条目（id "browser"）                     │
│  ├─ desktop.workbench.registerTab({ id: "browser", ... })            │
│  ├─ BrowserPanel UI：地址栏/标签行/工具栏/新标签页/加载状态/原因面板      │
│  ├─ 安全校验镜像：协议白名单 + 本机地址黑名单（与主进程同步规则）         │
│  └─ browserBridge（渲染侧桥模块，插件内聚，不碰 preload）               │
│        ├─ 渲染→主：console 标记 __DSH_BROWSER_CMD__:<json>            │
│        │    （navigate / back / forward / reload / new-tab /          │
│        │      close-tab / activate-tab / bounds / visibility）        │
│        └─ 主→渲染：监听 CustomEvent dsh-desktop-browser-event          │
│             （url / title / loading / canGoBack / canGoForward /      │
│               blocked-nav / download / permission）                   │
└──────────────┬───────────────────────────────────────┬───────────────┘
               │ console-message 通道（既有）          │ executeJavaScript 派发
               ▼                                       ▼ CustomEvent（既有）
┌──────────────────────── 主进程（main.mjs）────────────────────────────┐
│  BrowserController（新模块 browser-controller.mjs，main.mjs 挂载）      │
│  ├─ 1 个 WebContentsView（多标签 = 单 view 切 URL + 渲染侧历史栈）      │
│  ├─ 独立持久分区 session `persist:dsh-browser`（登录态跨重启/跨 DSH    │
│  │    会话保留；与主界面 Cookie 完全隔离）                              │
│  ├─ 导航与事件：did-navigate / page-title-updated / did-start|stop-    │
│  │    loading / did-fail-load / favicon? / navigationHistory           │
│  ├─ 导航白名单主进程强制（协议 + 本机地址）+ 渲染侧镜像双保险            │
│  ├─ 坐标对齐：渲染侧 bounds 上报（ResizeObserver + rAF 节流）→ setBounds│
│  │    + 窗口 move/resize/maximize/fullscreen 重算                       │
│  ├─ overlay 联动：`[role=dialog][aria-modal=true]` / 设置抽屉 / 命令菜单│
│  │    打开 → 隐藏视图（复用主进程现有 drag-region 同款判定脚本）         │
│  ├─ 焦点管理：进入视图自动聚焦；Esc / 点击聊天区 → 回主页面              │
│  └─ 权限/下载：session 权限请求默认全拒；下载走系统默认保存              │
└───────────────────────────────────────────────────────────────────────┘
        │ host 半（后端 Node 侧，与桥无关）
        ├─ /api/desktop-browser/config      开关
        └─ /api/desktop-browser/prefs       偏好（$DSH_HOME/desktop-browser.json 原子写）
```

职责边界：

- **client 半**：UI、标签/历史栈（URL 列表）、安全校验镜像、桥消息编解码、U2 拦截器。
- **主进程 BrowserController**：视图生命周期、定位、导航执行、事件回推、分区与安全强制——**浏览器的一切行为最终都由主进程落地**。
- **host 半**：开关/偏好持久化（纯 HTTP，与浏览器行为无关）。

---

## 4. 详细设计

### 4.1 桥协议（v1 提案）

渲染 → 主（`console.log('__DSH_BROWSER_CMD__:' + JSON.stringify(msg))`）：

```ts
type RendererToMain =
  | { type: "navigate"; url: string }        // 地址栏/链接导航
  | { type: "back" } | { type: "forward" } | { type: "reload" }
  | { type: "new-tab"; url?: string }
  | { type: "close-tab"; tabId: string }
  | { type: "activate-tab"; tabId: string; url: string }
  | { type: "bounds"; rect: { x, y, width, height } }   // CSS px，rAF 节流
  | { type: "visibility"; visible: boolean } // 面板开合/视图切换/overlay
  | { type: "open-external"; url: string }   // 原因面板「外部打开」
  | { type: "set-pref"; key: string; value: unknown }
```

主 → 渲染（CustomEvent `dsh-desktop-browser-event`，detail 同构）：

```ts
type MainToRenderer =
  | { type: "state"; url: string; title: string; loading: boolean;
      canGoBack: boolean; canGoForward: boolean; favicon?: string }
  | { type: "nav-blocked"; url: string; reason: "protocol" | "localhost" }
  | { type: "load-error"; url: string; code: number; description: string }
  | { type: "popup"; url: string }           // http(s) 弹窗 → 面板开新标签
  | { type: "download-start"; filename: string; url: string }
  | { type: "permission-denied"; permission: string }
```

### 4.2 BrowserPanel UI（与 iframe 方案共享的设计，全部保留）

```
┌───────────────────────────────────────────────┐
│ ◀ ▶ ⟳ ◉  [ https://example.com        ] ⭐  ➕ │ ← 工具栏
│ ┌─tab1─┐ ┌─tab2─┐   (favicon + 标题 + ✕)        │ ← 标签行（横滚，中键关闭）
│ ├─────────────────────────────────────────────┤
│ │          （WebContentsView 覆盖此区域）        │ ← 原生视图
│ │                                             │
│ └─────────────────────────────────────────────┘
│ 安全指示：🔒 白名单域名 · ⚠ 导航被拒（原因面板）    │
└───────────────────────────────────────────────┘
```

- **多标签**：renderer 维护 `{ tabId, url, title, history: string[] }` 列表；激活 tab 时通知主进程把 view 导航到该 tab 的当前 URL。后退/前进优先用 `webContents.navigationHistory.goBack()/goForward()`，主进程回推 `canGoBack/canGoForward`，renderer 据此启用禁用按钮。
- **地址栏校验（双侧）**：协议白名单 `http:`/`https:`；拒绝 `javascript:`/`data:`/`file:`/`about:`/`chrome:` 及本机地址（`localhost`、`127.0.0.0/8`、`0.0.0.0`、`[::1]`、内网保留段默认拒绝可设豁免）——**主进程强制 + 渲染镜像**，任一拒批即 `nav-blocked`。
- **加载状态**：主进程 `did-start-loading / did-stop-loading / did-fail-load` 回推；失败显示错误/原因面板。
- **新标签页**：内置（纯前端，不走网络）：搜索框（Bing/百度/Google 可配）+ 常用站点格子。
- **外部打开**：原因面板「在系统浏览器打开」→ renderer 发 `open-external` → 主进程 `shell.openExternal`（或直接 `window.open` 走既有通道，二选一，P0 实测定）。
- **弹窗分流**：view 内 `window.open`（http/https）→ 主进程回推 `popup` → renderer 开新标签；其余协议 → `shell.openExternal`。
- **渲染区固定比例（已落地）**：默认 16:9，预设表驱动（16:9 / 4:3 / 1:1 / 9:16 / 自适应铺满），fit 缩放居中；新增设备（iPhone/iPad 等）只加预设条目 + host prefs 白名单（`browser.viewportRatio`）。视图底色跟随应用主题（`view.setBackgroundColor`，复用 `__DSH_TITLEBAR_THEME__:` 标记通道）。

### 4.3 多标签与历史（决策）

| 决策点 | 选项 | 采用 |
|---|---|---|
| 视图复用 | 单 view 切 URL / 每标签一个 view | **单 view 复用**（内存友好、事件归一）；标签历史栈在 renderer 维护 |
| 会话隔离 | 每 DSH 会话一个分区 / 一个分区全共享 | **一个 `persist:dsh-browser` 分区**：浏览器登录态随浏览器保留，不随 DSH 会话清空（对标真实浏览器心智） |
| 标签持久化 | 跨重启保留 / 不保留 | **默认不保留**（`browser.tabsPersist` 可设 true）；后端端口每次变、分区 cookie 保留但标签页不硬留 |
| 历史 | webContents.navigationHistory / renderer URL 栈 | 后退/前进用 navigationHistory（真实历史）；tab 切换时若 history 与当前 URL 不符则以 URL 为准重建 |

### 4.4 坐标对齐（V2 最高风险点）

- 触发源：renderer 对工作台列根元素 `ResizeObserver` + `window resize` 监听，rAF 节流（~10Hz）后把 `getBoundingClientRect()`（CSS px）经 `bounds` 消息上报；主进程 `view.setBounds(rect)`。
- 时机覆盖：面板开合（track 0⇄非 0）、拖拽调宽、会话切换（列重建）、对话⇄轨迹视图切换（隐藏↔重挂）、窗口 move/resize/最大化/全屏、DSH details 列开合。
- **DPI/缩放**：页面 `webFrame.getZoomFactor()` 参与换算（视图 bounds 是 DIP；页面 CSS px 在非 100% 缩放时需乘 zoomFactor）——P1 实测确认。
- 防御：上报间隔内主进程只采纳最后一次；视图不可见（`visibility:false`）时不 setBounds，恢复时强制重报一次。

### 4.5 z-order 与 DSH 浮层联动

- WebContentsView 覆盖在主窗口 webContents 之上：**只要 view 可见，DSH 页面的一切弹层都会被它压住**——原生视图无法用 z-index 压到 DOM 浮层之下，**隐藏是唯一解法**。
- 联动规则（渲染侧 `isOverlayVisible()`，已落地）：命中以下官方浮层标记即发 `visibility:false` 隐藏视图，关闭后恢复并重报 bounds：
  `[role="dialog"]`（模态/设置/附件/确认）、`[role="menu"]`（模型选择等）、`[role="listbox"]`（/ 命令菜单、输入联想）、`[aria-modal="true"]`、`[data-shell-overlay] > *`（shell 浮层层有内容时）；排除 `display:none`/`visibility:hidden`/无布局节点。MutationObserver 监听 `role`/`aria-modal` 属性变化与子树挂载。
- 已知残留：Toast/小浮层可能被遮（低危，登记 README）；**任何 DSH 官方弹层不得出现在浏览器视图之上**是本方案的不变量。

### 4.6 焦点与键盘

- 点击视图内部 → 原生聚焦（DSH 快捷键天然不抢，不同 webContents）。
- 视图聚焦时按 `Esc`（`before-input-event`）→ 主页面 `webContents.focus()` 回到聊天。
- 点击工作台列其它 UI / 聊天区 → 主页面聚焦（视图仍可见但不聚焦）。

### 4.7 安全模型

1. **分区隔离**：`persist:dsh-browser` 独立分区，不共享主界面任何 Cookie/存储/认证；DSH 后端 token 等凭据对视图不可见。
2. **导航白名单（主进程强制）**：协议白名单 + 本机地址黑名单，违反 → `nav-blocked` + 原因面板；主进程是最终裁决（渲染侧只是镜像 + 即时反馈）。
3. **权限请求**：`session.setPermissionRequestHandler` 默认全拒（camera/mic/geolocation/notifications/clipboard-read）。
4. **弹窗**：http(s) → 面板新标签；其余 → 系统浏览器（`shell.openExternal`）。
5. **下载**：`will-download` 走系统默认保存；文件名/路径由系统处理，不注入主界面。
6. **危险偏好**（均默认 false + 警告文案）：`allowLocalhost`（放行本机地址）、`allowUnsandbox` 不适用（无沙箱属性可卸，改为 `allowPermissions` 单站点临时授权）、`allowAllProtocols` 不提供。

### 4.8 宿主端契约

```
GET/HEAD/POST /api/desktop-browser/config    → { enabled } / {ok:true} / 400/405
GET/HEAD/POST /api/desktop-browser/prefs     → 白名单偏好（$DSH_HOME/desktop-browser.json 原子写）
```

偏好白名单（host/client 键集逐键同步，遵守 PLUGIN_STANDARDS §8）：

| key | 类型 | 范围 | 用途 |
|---|---|---|---|
| `browser.splitProtocol` | boolean | — | 外链分流（默认 **false** = 面板内全开；true = HTTPS 走系统浏览器） |
| `browser.tabsPersist` | boolean | — | 跨重启保留标签页（默认 false） |
| `browser.allowLocalhost` | boolean | — | 放行本机地址（默认 false，危险项） |
| `browser.allowPermissions` | boolean | — | 允许单站点临时授权权限（默认 false，危险项） |
| `browser.searchEngine` | string | ≤32 | 新标签页搜索引擎（bing/baidu/google） |

---

## 5. 主进程改动清单（main.mjs）

新增 `browser-controller.mjs`（独立模块，main.mjs 挂载），不改既有通道约定：

| 改动 | 说明 |
|---|---|
| `BrowserController` 类 | 创建/销毁 view、分区管理、导航执行、事件回推、bounds 同步、overlay/焦点联动 |
| `webContents.on('console-message')` 分支 | 解析 `__DSH_BROWSER_CMD__:` 标记（与既有 theme/wake/update 标记并列） |
| `configureNavigation` 扩展 | 仅当 view 存在且命令为浏览器命令时消费，**不得改变现有 `will-navigate`/`setWindowOpenHandler` 行为** |
| 窗口事件 | `move/resize/maximize/unmaximize/enter-full-screen/leave-full-screen` → 重算 bounds |
| 生命周期 | `before-quit` 时 view 销毁；面板随窗口最小化/隐藏联动 |
| 渲染侧注入脚本 | overlay 检测（`[role="dialog"][aria-modal="true"]` + 设置抽屉/命令菜单标记）→ 触发 visibility |
| `webFrame.getZoomFactor` 桥 | 上报 bounds 时附带 zoomFactor，主进程换算 |

> 安全红线：浏览器视图**绝不加载 backend 源页面**（白名单本机地址黑名单天然覆盖）；view 永不获得访问主界面 session 的能力。

---

## 6. 实施步骤（质量优先，不设发版压力）

| 阶段 | 内容 | 验收 |
|---|---|---|
| P0 | **桥骨架**：BrowserController 创建单 view + 命令/状态双通道 + 窗口级对齐（面板固定宽度下 setBounds）；BrowserPanel 占位 UI（地址栏可用） | 面板内出现真实 Chromium 视图并完成首次导航；状态（URL/标题/加载）回推正确 |
| P1 | **完整对齐**：拖宽/会话切换/轨迹切换/开合/窗口 move/resize/全屏/DPI 缩放全部跟随；overlay 联动隐藏/恢复 | 六项对齐回归 + DSH 弹层不再被遮 |
| P2 | **UI 全量**：多标签、后退/前进/刷新、新标签页（搜索）、favicon/标题、加载/错误/原因面板、弹窗分流 | 手动回归：多 tab、真实历史、弹窗开新标签 |
| P3 | **安全收口**：分区会话、主进程导航白名单强制、权限全拒、下载处理、危险偏好设置 | 导航白名单/权限/本机地址用例全过 |
| P4 | **U2 聊天链接拦截**（DOM capture 监听，限 `[data-chat-flow]`） | 聊天链接 → 面板新标签；工作台列/设置页链接不拦 |
| P5 | **U3 agent 工具**（同基建增量）：host 端 agent 工具 → webContents 读页/点击/填写；受控标签页模型（对标 Lum1104 心智） | agent 可打开/读取/操作面板内页面 |
| P6 | 测试 + README（按模板，含桥协议契约 + DOM 契约 + 升级清单）+ 打包回归 | `node --test` 全绿；安装包实测 |

## 7. 回归清单（每个里程碑都跑）

- [ ] 面板开合 / 拖拽调宽 / 会话切换 / 对话⇄轨迹切换：视图跟随无残影、无错位、无遮挡残留
- [ ] DSH 浮层（设置抽屉 / 命令菜单 / aria-modal 弹窗）打开时视图隐藏、关闭后恢复
- [ ] 窗口移动 / 缩放 / 最大化 / 全屏 / 多显示器 DPI：bounds 对齐
- [ ] 焦点：视图内打字不影响 DSH；Esc / 点聊天区回到聊天；DSH 快捷键不误触
- [ ] 安全：`javascript:` / `data:` / `file:` / localhost / 内网段全部被拒（nav-blocked）
- [ ] 权限：camera/mic/geo/通知全部被拒且不弹系统提示
- [ ] 弹窗分流：http(s) 弹窗 → 面板新标签；其它 → 系统浏览器
- [ ] U2：聊天链接 → 面板；工作台列 / 设置页链接 → 原行为
- [ ] 后端重启（端口变化）：浏览器分区/cookie 仍在，无旧 origin 残留
- [ ] 开关关闭：页签、桥、监听、偏好入口全部移除；主进程 view 销毁

## 8. 风险登记

| 风险 | 等级 | 缓解 |
|---|---|---|
| 坐标桥跟随 DOM 注入列（workbench 本身是私有 hack，两层耦合） | 高 | 单一 bounds 上报模块 + rAF 节流；P1 全量对齐回归；升级运行时走 workbench 既有清单 |
| z-order：原生视图盖住 DSH 弹层 | 高 | overlay 联动隐藏（§4.5）；P6 打包实测 |
| 焦点/键盘边界 | 中 | Esc 回聊天、进入视图自动聚焦；P1/P6 回归 |
| DPI/缩放换算错误 | 中 | zoomFactor 桥 + 多显示器实测 |
| 多标签历史与 navigationHistory 语义冲突 | 中 | renderer 历史栈为准、navigationHistory 为辅；P2 回归 |
| 分区 cookie 与「会话隔离」预期不符 | 低 | 设计决策已定（登录态跨会话保留），README 明示 |
| 主进程复杂度上升引入回归 | 中 | BrowserController 独立模块 + 不改既有通道行为 + 单测 |

## 9. 未来扩展点（承接 U3，紧随首版）

- **agent 工具集**（P5）：`browser_open` / `browser_snapshot`（结构化文本 + 编号交互元素，敏感值掩码）/ `browser_click` / `browser_type` / `browser_scroll` / `browser_back|forward|reload`——同一 webContents，对标 Lum1104 受控标签页：agent 操作的页面 = 用户看到的页面，跨域导航需用户批准。
- **多实例**：每 DSH 会话独立 view（若用户明确要求会话间登录态隔离）。
- **历史/收藏**：书签、最近访问（持久化走 host prefs）。

## 10. 相关资源

- better-sidebar（UI/安全设计参照）：<https://github.com/omdsh-dev/DSH-better-sidebar>
- DSH 插件生态：<https://dshfind.com/zh/plugins>、GitHub topic `dsh-plugin` / `dsh-better-sidebar`
- 浏览器桥对标：<https://github.com/Lum1104/dsh-browser>、npm `dsh-chrome` / `dsh-jiey-browser`
- Electron WebContentsView（Electron ≥30 推荐 API）：<https://www.electronjs.org/docs/latest/api/web-contents-view>