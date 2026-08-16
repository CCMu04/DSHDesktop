# 桌面端工作台插件拆分设计

> **致谢**：本工作台的功能集参考了 [DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar)（社区侧边栏工作台）——右侧分栏框架、文件预览器集合、Git 面板（status / diff / stage / commit，无 push / pull / fetch 的边界）等思路均源于该项目，特此向作者与贡献者致谢。实现上按 [PLUGINS.md](PLUGINS.md) 的内置插件规范从零编写，未复制其代码。本文档是开发蓝图，落地时每个插件自带配置测试与客户端测试。

## 1. 背景与拆分原则

better-sidebar 把「侧边栏框架 + 7 个 Tab + 6 种文件预览器」塞进一个 npm 包。桌面端不需要这种单体形态：

- **一个功能一个插件**：文件、终端、Git、浏览器、后台任务各自独立，互不依赖、可单独开关、可单独测试与回滚。
- **框架单独成插件**：侧边栏容器（dock）与 Tab/预览器注册服务是基础设施，不属于任何功能，单独一个插件承载，功能插件通过服务注册进框架。
- **开关统一**：每个功能插件向既有「功能增强」聚合卡片（`dsh-desktop-features` 的 `desktop.features.item` 槽位）注册独立开关，复用现有设置 UI，不新增设置入口。
- **桌面端差异**：随安装包分发（builtin-plugins 指纹部署）、仅回环访问、Windows 默认 PowerShell 终端、复用运行时自带 node-pty、原生打开文件位置等，见 §5。

## 2. 插件清单

| 插件 | 分类 | 承载功能 | 依赖 |
| --- | --- | --- | --- |
| `dsh-desktop-workbench` | 框架 | 侧边栏容器、Tab 栏、面板布局、`desktop.workbench` 服务（registerTab / registerViewer / openFile） | 无（其他插件依赖它） |
| `dsh-desktop-files` | 功能增强 | 文件树 + 代码查看/编辑 + 图片/Markdown/HTML/PDF 预览 | workbench |
| `dsh-desktop-terminal` | 功能增强 | 真实终端（xterm.js + node-pty），可选注入 `terminal_*` 工具 | workbench |
| `dsh-desktop-git` | 功能增强 | Git diff / 历史 / 暂存 / 提交 / 还原 | workbench |
| `dsh-desktop-browser` | 功能增强 | 沙箱 iframe 内嵌浏览器 + 本地 HTML 预览 | workbench |
| `dsh-desktop-tasks` | 功能增强 | subagent 拓扑 + 后台任务（实时输出 / 终止） | workbench |

## 3. 各插件设计

### 3.1 dsh-desktop-workbench（框架，先行）

职责：只提供容器与服务，不承载任何功能逻辑。

> ✅ 已实现并定稿（`plugins/dsh-desktop-workbench/`）。落地形态见下。

- **形态：对话页内部右侧分栏（chat 视图内 grid 分栏）**。工作台作为官方对话页根（`[data-phase]`）的第二列挂载、与 scrollBody 平级——位于聊天界面对话页的右边、官方「对话 / 轨迹」页签栏下方；**只有对话页签激活时显示**（conversation.view 槽位按激活视图渲染，切换到轨迹页签时 ChatView 卸载，工作台隐藏，切回对话页恢复）。列不在滚动容器内：聊天文本区滚动条留在其右缘、工作台滚轮只滚动自身内容；列高由 grid 第二行 stretch 决定，撑满对话区视口；列顶是紧凑页签栏（文件 / Git …），**不显示「工作台」标题字样**，页签栏不与官方页签行对齐，也无关闭按钮（收起统一走 [|] 按钮）。
- **打开方式：官方 Header 页签行右端的 [|] 按钮**。工作台在 `conversation.session.header.utilities` 槽位注册 `workbench-toggle`（order 35，与打开工作区 / 导出会话按钮同排同风格），使用官方 `IconPanelLeftOutline16` 水平翻转（右侧面板样式）；点击切换开合，打开时按钮高亮（品牌色）。无右侧细条按钮。
- **拖拽调宽**：列左缘 8px 透明热区（视觉上就是聊天区与工作台之间的分割线），拖动期间给对话页根加 `data-ddwb-dragging` 禁用官方布局过渡（实时跟手）；不做点击收起、窄拖自动收起；钳制 240–720，防抖持久化。
- **服务**：`ctx.provide('desktop.workbench', service)`，消费方 `inject: ['desktop.workbench']`：

```js
service.registerTab({ id, title, order, component, icon, badge }) // 注册面板页签，返回 disposer
service.registerViewer({ id, title, extensions, order, component }) // 注册文件预览器（按扩展名匹配）
service.activateTab(id)      // 激活页签（切换内容区，同时打开面板）
service.updateTab(id, patch) // 原位更新页签描述（如角标）
service.openFile(path)       // 按扩展名路由到第一个匹配的 viewer
service.closeFile()          // 关闭当前打开的文件，回到页签视图
service.collapse()           // 收起面板（轨道归 0）
service.toggle()             // 切换开合（Header [|] 按钮）
service.setOpen(value)       // 打开/收起面板
service.isOpen()             // 当前开合状态
service.onOpenChange(listener) // 订阅开合状态
service.getSnapshot()        // { tabs, viewers }（按 order 排序）
service.subscribe(listener) / service.onAction(handler)  // 均返回 disposer
```

- **主页签栏只承载功能页签**（文件 / Git 等，由各功能插件注册；框架自身不内置任何页签）。打开的文件**不在主页签栏显示**——由功能插件在自己的页签内容区内实现子页签（如 files 插件的文件子页签分页预览）。`openFile` / `registerViewer` 为对外契约（供未来生态使用），当前 files 插件在内部实现文件预览，不占用主页签。
- 开合状态由服务持有（Header 按钮与列组件共享），视图切换后重新挂载时恢复；**切换会话自动关闭工作台并重置页签/文件内容**（避免不同会话/项目内容串扰）；框架关闭（enabled=false）时列不挂载、按钮不注册；会话级布局（开合 / 宽度）按会话经 `/api/desktop-workbench/layout` 持久化，会话加载时默认收起以避免插件初始化竞态。
- **host**：`/api/desktop-workbench/config`（框架总开关，走 §4 通用约定）+ `/api/desktop-workbench/layout`（GET/POST 会话布局持久化到 `$DSH_HOME/desktop-workbench.json`，与开关共用同一文件、原子写入；宽度钳制 240–720、每会话布局 ≤ 32 KiB、最多 200 个会话）。
- Tab 组件渲染时收到 `{ ctx, service, t }`，viewer 组件收到 `{ path, t }`；`t` 为工作台词典的翻译函数。

### 3.2 dsh-desktop-files（文件工作台）

> ✅ 已实现（`plugins/dsh-desktop-files/`）。功能增强卡片 order 10，主页签 order 10。

- **host**（`inject: ["webServer", "sessions"]`，全部按会话 cwd 白名单 + realpath 校验，拒绝越界/符号链接逃逸）：
  - `/api/desktop-files/tree`：懒加载目录树（忽略依赖/缓存/构建/版本库/IDE 目录与隐藏条目，目录在前按名称排序，单层 ≤ 1000 条）
  - `/api/desktop-files/text`：文本读取/原子写入（大小上限 2 MiB，扩展名白名单）
  - `/api/desktop-files/file`：媒体文件（图片/PDF，≤ 10 MiB，类型白名单，`nosniff`）
  - `/api/desktop-files/html`：HTML 预览（≤ 1 MiB，响应带 CSP `sandbox; script-src 'none'` + `nosniff`）
  - 会话 cwd 取自 host 端 `ctx.sessions.get(id).header.cwd`；无会话/无 cwd 时拒绝（400）
- **client（文件页签内部 = 分页预览）**：向 workbench 注册 `files` 主页签。页签内容自上而下：工具栏（cwd + 目录树折叠/展开 + 刷新）→ 目录树（可折叠，懒加载，右键复制路径）→ **文件子页签栏**（打开的文件，同路径去重、标题为文件名、单个 × 关闭、激活相邻页签，≤ 20 个，插件内模块级 store 维护）→ 预览区（图片 / Markdown / HTML / PDF / 代码，插件内部按扩展名匹配渲染，不占用主页签栏）。
- **openPath 拦截**：包装官方唯一文件打开入口 `ctx.workspaces.openPath`（工具行路径 / 生成文件行 / 正文文件提及的打开都走它）——相对路径按会话 cwd 解析 → 打开文件子页签并 `activateTab('files')`，不再交给宿主 OS；dispose 时还原原始方法（链式包装安全）。
- 桌面端差异：文件即本机文件（与官方 fs 工具同一套文件系统）；Office 预览不做（留给生态插件）；「在文件管理器中显示」暂未实现（右键复制路径可代替）。

### 3.3 dsh-desktop-terminal（终端）

- **host**：`registerUpgrade('/api/desktop-terminal/ws')` WebSocket（会话级 cwd、PTY 尺寸同步、断线重连回放）；`terminal_*` 工具注入做成配置项（默认关，与 better-sidebar 一致）。
- **client**：xterm.js 终端视图，注册 `terminal` tab；拖到另一分栏重挂载（shell 重开）为已知限制。
- 桌面端差异：默认 shell 为 PowerShell（桌面端主环境）；node-pty 用运行时自带版本（runtime 已内置 1.1.0 预编译产物），不新增 npm 运行时依赖。

### 3.4 dsh-desktop-git（Git 面板）✅ 已落地

- **host**：`/api/desktop-git/*`（repos / status / diff / log / stage / unstage / commit / restore），只调 git CLI、绝不设置身份、无 push/pull/fetch（安全边界与 better-sidebar 相同）；工作区目录校验（必须位于当前会话 cwd 内）；`repo` 参数可在会话 cwd 内选择任意 git 仓库（`repos` 扫描 cwd 深度 ≤ 3 的子仓库）；diff 上限 256 KiB（截断标记），git 命令 15s 超时。
- **client**：注册 `git` tab（order 30）：顶部仓库下拉（自动列出 cwd 内子仓库，切换即重载）+ 分支名 + 暂存区/工作区文件分组列表（状态徽标 + hover 暂存/取消暂存/还原）+ VSCode 式 diff 视图（行号双 gutter、增删高亮、暂存区/工作区切换、二进制提示）+ 底部提交区（Ctrl+Enter）与提交历史列表。
- 无文件 watcher（手动刷新），同 better-sidebar。

### 3.5 dsh-desktop-browser（内嵌浏览器）

- **host**：`/api/desktop-browser/html` 本地 HTML 预览路由（不透明源沙箱 iframe + CSP sandbox，拒绝 `javascript:`/`data:`/`file:` 与 localhost 等本机地址）。
- **client**：注册 `browser` tab：多开网页 tab（后退/前进/刷新），内容渲染在沙箱 iframe；会话内识别的外链默认在面板中打开。
- 桌面端差异：单窗口应用内浏览，不弹新窗口；登录态/第三方 Cookie 受限为已知限制。

### 3.6 dsh-desktop-tasks（后台任务）

- **host**：`/api/desktop-tasks/*` 只读代理官方 `jobs` / `subagent` 服务数据（任务列表、实时输出、退出码、终止请求）。
- **client**：注册 `tasks` tab：subagent 拓扑树 + 后台任务卡片（实时输出 / 强制终止按钮）。
- 数据源复用官方服务，不重复造任务系统。

## 4. 公共约定（对齐 PLUGINS.md）

- 目录 `plugins/dsh-desktop-<name>/`：`package.json`（version 固定 1.0.0，exports `.` + `./client`，`dsh.bundle.patch`，`dsh.client.inject` 按需声明）+ `cordis.patch.yml`（insert id/name 与包名一致）+ `lib/index.js` + `lib/client.js`。
- host：导出 `name` / `inject: ['webServer']` / `DEFAULT_CONFIG` / `apply(ctx, config)`；**唯一开关路由** `/api/desktop-<name>/config`（kind exact，GET/HEAD/POST 一个 handler 分发）；持久化 `$DSH_HOME/desktop-<name>.json` 原子写入；配置合并 默认值 ← 插件行 config ← 用户开关文档。
- client：`window.__ModuleLoader__.load` 格式；词典命名空间与插件名一致（zh/en，`feature.title`/`feature.description` 供聚合卡片显示）；CSS 注入用 `data-plugin-css` 去重、类名带插件专属前缀、配色用官方 `--dsw-alias-*` token；行为按配置快照安装、disposer 收敛重装；配置读取失败回退默认（全开）。
- 功能开关：`ctx.slots.inject('desktop.features.item', ...)`，id 与插件名一致，order：files 10 / terminal 20 / git 30 / browser 40 / tasks 50。
- 测试：每个插件 `test/desktop-<name>-config.test.mjs`（host，stub cordis ctx + 临时 DSH_HOME）+ `test/desktop-<name>-client.test.mjs`（client，stub `window.__ModuleLoader__` 与浏览器环境）。
- 部署：应用启动自动指纹部署（builtin-plugins.json 键控），无需用户安装；开发验证按 PLUGINS.md §5 手动 Copy-Item 到已安装应用 resources/plugins 后重启。

## 5. 与 better-sidebar 的桌面端差异

| 维度 | better-sidebar | 桌面端内置 |
| --- | --- | --- |
| 分发 | npm 包 / 一键脚本 | 随安装包内置，启动自动部署注册 |
| 开关 | 自建设置分区 | 既有「功能增强」聚合卡片，每插件一行 |
| 网络边界 | 需 trustedHosts 信任围栏（可能远程访问） | 仅 127.0.0.1 回环，无远程场景 |
| 终端 | 默认 shell 随平台 | 默认 PowerShell（Windows 桌面主环境） |
| 文件定位 | 自实现 | 复用桌面 runtime-preload 原生打开器 |
| 布局持久化 | localStorage | host 端 `$DSH_HOME` JSON（跨设备一致、可备份） |
| 架构 | 单体包 + 服务 | 框架插件 + 功能插件，服务注册对等 |
| 不做 | — | Office 预览、移动端适配、复杂拖拽分栏（v1） |

## 6. 实施顺序

1. ✅ **workbench**：框架 + 服务 API + 面板容器（主页签栏只承载功能页签，框架不内置页签）。示例页签在 files 落地后已移除。
2. ✅ **files**：目录树 + 文件子页签分页预览（图片 / Markdown / HTML / PDF / 代码）+ openPath 拦截。
3. **terminal**：WS + xterm + node-pty（桌面端差异化最大的一块，尽早验证）。
4. ✅ **git**：diff / 提交（纯 CLI 代理，独立可测）。
5. **browser**：沙箱 iframe + HTML 预览。
6. **tasks**：官方服务只读代理（工作量最小，可最后）。

每步交付：插件源码 + 两个测试文件 + 手动部署验证 + CHANGELOG 条目。所有插件完成后统一发布版本。
