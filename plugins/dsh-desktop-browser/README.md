# dsh-desktop-browser

工作台「内置浏览器」：在对话页右侧分栏（`desktop.workbench`）注册「浏览器」页签，内容由 **Electron `WebContentsView` 原生视图**渲染（位于主进程）。

- **路线**：首版即 WebContentsView 真浏览器（不做沙箱 iframe 中间版）——支持登录态 / X-Frame 站点 / 真实历史，并为「agent 操作网页」（U3）预埋主进程级 webContents 基建。完整设计见 [`docs/browser-panel-design.md`](../../docs/browser-panel-design.md)。
- **当前状态**：**P0 桥骨架**——页签注册 + 占位工具栏 + 渲染侧桥 + 主进程控制器 + 开关/偏好持久化 + 单测。多标签 / 完整对齐 / 安全收口 / U2 链接拦截 / U3 agent 工具见文末路线。

---

## 1. 架构总览

```
┌──────────────────── 渲染进程（DSH Web UI）────────────────────┐
│  dsh-desktop-browser（client 半，lib/client.js）              │
│  ├─ desktop.features.item 开关条目（id "browser", order 20）   │
│  ├─ desktop.workbench.registerTab（id "browser", order 20）   │
│  ├─ BrowserPanel（P0：工具栏 + 状态区；内容区由原生视图覆盖）   │
│  ├─ URL 校验镜像（与主进程同规则）                             │
│  └─ browserBridge：console 标记发命令 + CustomEvent 收状态     │
└──────────────┬──────────────────────────────────┬─────────────┘
               │ __DSH_BROWSER_CMD__:<json>       │ dsh-desktop-browser-event
               ▼                                  ▼
┌──────────────────── 主进程 ───────────────────────────────────┐
│  BrowserController（browser-controller.mjs，main.mjs 挂载）    │
│  ├─ 1 个 WebContentsView + 持久分区 persist:dsh-browser       │
│  ├─ 导航执行 + 状态回推（URL/标题/加载/canGoBack/canGoForward）│
│  ├─ 坐标对齐（bounds 上报 × zoomFactor → setBounds）           │
│  ├─ 导航白名单主进程强制（http/https + 环回黑名单）            │
│  ├─ 权限全拒 / 弹窗分流 / 下载默认保存 / Esc 焦点回聊天         │
│  └─ 窗口事件 → request-bounds 让渲染侧补报                    │
└──────────────────────────────────────────────────────────────┘
        │ host 半（lib/index.js，后端 Node 侧）
        ├─ /api/desktop-browser/config   开关
        └─ /api/desktop-browser/prefs    偏好（$DSH_HOME/desktop-browser.json）
```

## 2. 与官方 DSH 的集成方式

| 位置 | 方式 |
|---|---|
| `desktop.workbench.registerTab` | 注册「浏览器」页签（order 20，排在文件 10 与 Git 30 之间） |
| `desktop.features.item` | 「功能增强」开关条目（id `browser`, order 20，数据接口 `{load, save}`） |
| 主进程（`main.mjs`） | 新增 `BrowserController`；复用既有 console 标记 + CustomEvent 双向通道，**不引入 preload IPC** |
| 官方 DOM | 无 DOM 注入；面板由 workbench 列渲染，其根元素仅用于 bounds 上报 |

## 3. 桥协议契约（P0）

### 渲染 → 主（`console.log('__DSH_BROWSER_CMD__:' + JSON.stringify(msg))`）

| type | 负载 | 说明 |
|---|---|---|
| `navigate` | `{url}` | 地址栏导航；主进程强制校验 |
| `back` / `forward` / `reload` | — | 历史/刷新 |
| `new-tab` / `activate-tab` | `{url?}` | P0 单标签占位：带 URL 即导航 |
| `close-tab` | `{tabId}` | P0 忽略 |
| `bounds` | `{rect:{x,y,width,height}}` | 面板根 CSS px 矩形（rAF 节流上报） |
| `visibility` | `{visible}` | 面板收起/浮层打开时 false |
| `open-external` | `{url}` | 原因面板「外部打开」（仍走主进程校验） |

### 主 → 渲染（CustomEvent `dsh-desktop-browser-event`，detail 为消息体）

| type | 负载 | 说明 |
|---|---|---|
| `state` | `{url,title,loading,canGoBack,canGoForward}` | 导航状态回推 |
| `nav-blocked` | `{url,reason}` | 主进程拒绝（`protocol`/`localhost`） |
| `load-error` | `{url,code,description}` | 主 frame 加载失败 |
| `popup` | `{url}` | 视图内 http(s) 弹窗 → 面板新标签 |
| `download-start` | `{filename,url}` | 下载开始 |
| `request-bounds` | — | 窗口几何变化，请求渲染侧补报 |

## 4. 宿主 API 契约

```
GET/HEAD/POST /api/desktop-browser/config    → { enabled } / {ok:true} / 400/405
GET/HEAD/POST /api/desktop-browser/prefs     → { prefs } / {ok:true,prefs} / 400/413/405
```

偏好白名单（host/client 键集逐键同步，P0 已实现路由，client 消费在后续阶段）：

| key | 类型 | 默认 | 用途 |
|---|---|---|---|
| `browser.splitProtocol` | boolean | false | 外链分流（false=面板内全开） |
| `browser.tabsPersist` | boolean | false | 跨重启保留标签页 |
| `browser.allowLocalhost` | boolean | false | 放行本机地址（危险项） |
| `browser.allowPermissions` | boolean | false | 单站点临时授权权限（危险项） |
| `browser.searchEngine` | string ≤32 | — | 新标签页搜索引擎 |

持久化：`$DSH_HOME/desktop-browser.json`（原子写；`enabled` 与 `prefs` 同文档互不覆盖）。

## 5. 安全模型（P0 已落地的主进程强制项）

1. **URL 白名单（主进程最终裁决）**：仅 `http:`/`https:`；拒绝 `javascript:`/`data:`/`file:`/`about:`/`chrome:` 等；拒绝环回地址（`localhost`、`127.0.0.0/8`、`0.0.0.0`、`[::1]`、`[0:…:1]`）——防内嵌网页打本地 DSH 服务。渲染侧校验是镜像（即时反馈），主进程才是闸门。
2. **独立分区**：`persist:dsh-browser`，与主界面 Cookie/认证完全隔离。
3. **权限全拒**：`setPermissionRequestHandler` / `setPermissionCheckHandler` 一律 `false`。
4. **弹窗分流**：视图内 `window.open` http(s) → 回推 `popup` 开面板新标签；其它协议 → `shell.openExternal`。
5. **下载**：保存到系统下载目录，回推 `download-start`。
6. **行为校验**：解析输入时「自带 scheme 含点号」视为 host:port（地址栏习惯）；显式 http(s) 前缀但解析失败直接拒绝（防把畸形输入洗成合法 URL）。

## 6. 已知缺陷与风险（P0）

- **坐标对齐未完全覆盖**：bounds 对齐的拖宽/会话切换/轨迹切换/DPI 场景待 P1 全量回归；当前依赖工作台列重渲染时 ResizeObserver 自然触发。
- **z-order（硬约束 + 已落地的解法）**：原生视图永远渲染在 DSH 页面 DOM 之上，无法用 z-index 压到浮层下面——唯一的解法是**浮层打开时隐藏视图**。已实现：`isOverlayVisible()` 覆盖官方全部浮层标记——`[role="dialog"]`（模态/设置/附件/确认）、`[role="menu"]`（模型选择等）、`[role="listbox"]`（/ 命令菜单、输入联想）、`[aria-modal="true"]`、`[data-shell-overlay] > *`（shell 浮层层有内容时），并排除 `display:none`/`visibility:hidden`/无布局节点；MutationObserver 监听 `role`/`aria-modal` 属性变化与子树挂载。**升级运行时需按 §9 清单核对这套选择器**。
- **单标签占位**：P0 忽略 `close-tab`/多标签；历史按钮由 navigationHistory 驱动。
- **主页面重载兜底**：页面刷新瞬间若视图可见，需等待 panel 重新挂载后补报 bounds（P1 在 did-finish-load 补发 `request-bounds`）。

## 7. 路线（接 P1+）

- **P0.5（已落地）**：渲染区固定比例——预设表驱动（16:9 / 4:3 / 1:1 / 9:16 / 自适应铺满，默认 16:9），fit 缩放居中，选择持久化到 host prefs `browser.viewportRatio`（新增设备只需加 `VIEWPORT_RATIOS` 条目 + host 白名单）；视图跟随应用主题——底色 `setBackgroundColor` + 页面 `prefers-color-scheme` 经 CDP `Emulation.setEmulatedMedia` 模拟（复用 `__DSH_TITLEBAR_THEME__:` 标记通道）；空状态（未加载真实页面）隐藏原生视图显示深色/浅色 DOM 提示，`did-navigate` 后才亮出
- **P1**：完整对齐（拖宽/会话/轨迹/开合/窗口事件/DPI）+ overlay 联动收口
- **P2**：UI 全量（多标签、搜索页、加载/错误/原因面板、弹窗分流落地）
- **P3**：安全收口（危险偏好接入、内网保留段策略、下载确认）
- **P4**：U2 聊天区链接选择性预览（capture 层 click 拦截，限 `[data-chat-flow]`）
- **P5**：U3 agent 工具（`browser_open`/`browser_snapshot`/…，同 webContents）
- **P6**：测试补全 + README 完整化 + 打包回归

## 8. 开发期验证（两条路径，首选 A）

### 路径 A：仓库 dev 模式（零手工，推荐）

```powershell
# 先完全退出已安装的 DSH Dock（单实例锁，否则 npm start 直接退给现有实例）
cd C:\Workspace\GitHub\DSHDesktop\desktop-shell
npm start
```

启动时 `prepareBundledPlugins`（`main.mjs` → `lib/builtin-plugin.mjs`）扫描 `plugins/`：
新插件（`builtin-plugins.json` 无指纹）→ **自动部署**到
`%APPDATA%\deepseek-harness-desktop\builtin-plugins\<name>` 并执行
`dsh plugin --profile web add --offline link:<部署目录>` **注册**——9 个既有插件
当初就是这套流程装上的，**无需手工复制与改 profile**。

> ⚠️ **部署语义（重要）**：DSH 服务端提供的 `/plugins/<id>/client.js` 来自
> `builtin-plugins` 的**部署拷贝**（profile node_modules 的 Junction 指向它），
> **不是仓库里的源文件**。因此：
> - **仓库 `plugins/` 源码的任何改动（client 或 host）都必须重启应用**——
>   启动时指纹（`version + 全文件 sha256`）变化才会重新部署；
> - 「刷新页面即可生效」只适用于**直接改了 `builtin-plugins` 里的拷贝**
>   （如路径 B 的 `Copy-Item` 覆盖 `lib`）之后的场景；
> - 排查「改了没生效」时，先确认 `builtin-plugins\<name>\lib\client.js`
>   是否已包含新代码。

### 路径 B：已安装应用上手动同步（无源码 dev 流程时）

> ⚠️ **打包状态**：本插件当前**未随安装包分发**（开发中；`package.json` 的
> `build.extraResources.plugins` filter 排除了 `dsh-desktop-browser`）。因此
> 已安装/打包版应用里没有本插件——手动同步只适用于开发机（仓库 `npm start`
> 会自动部署），或将插件目录（含 `browser-controller.mjs` 入 `build.files`）
> 手动补进安装包 `resources\plugins\` 并重启（指纹变更即自动注册）后验证。

```powershell
# ① 新插件必须拷「整个目录」（package.json + lib + cordis.patch.yml），不是只拷 lib
Copy-Item C:\Workspace\GitHub\DSHDesktop\desktop-shell\plugins\dsh-desktop-browser `
  "$env:APPDATA\deepseek-harness-desktop\builtin-plugins\dsh-desktop-browser" -Recurse -Force

# ② 注册两步（编辑 ~/.dsh/profiles/web/package.json）：
#    - dependencies 加：  "dsh-desktop-browser": "link:C:/…/builtin-plugins/dsh-desktop-browser"
#    - dsh.profile.bundles 数组追加："dsh-desktop-browser"

# ③ 在 ~/.dsh/profiles/web 执行 pnpm install（生成 node_modules junction）
# ④ 重启已安装的应用
```

> 已注册插件的内容增量更新只需覆盖 `builtin-plugins\<name>\lib`（profile 的
> node_modules 是 Junction，指到 builtin-plugins）；指纹过期无碍（指纹只在
> 应用更新/部署时判定是否从安装包重拷）。**不要手改 `builtin-plugins.json`**。

## 9. 升级检查清单（维护必读）

- [ ] `desktop.workbench.registerTab` 描述符字段（id/title/icon/order/component）未变
- [ ] `desktop.features.item` 数据接口契约未变
- [ ] 主进程 console-message 标记通道仍存在（`console-message` 事件签名）
- [ ] `WebContentsView` / `contentView.addChildView` API 未变（Electron ≥30）
- [ ] `webContents.navigationHistory` 可用（Electron 32+）
- [ ] 官方浮层标记未变：`[role="dialog"]` / `[role="menu"]` / `[role="listbox"]` / `[aria-modal]` / `[data-shell-overlay]`（z-order 隐藏判定）
- [ ] 实测回归：设置页/命令菜单/模型选择/附件选择打开时视图隐藏、关闭后恢复
- [ ] P1 对齐回归：面板开合/拖宽/会话切换/轨迹切换/窗口 move-resize/全屏/DPI 六项
