# dsh-desktop-workbench

桌面端「对话页内部右侧分栏」工作台框架：把聊天界面的右侧劈出一列，承载文件 / Git 等功能面板，与对话并存显示。

- **框架本身不承载任何功能**：只提供分栏容器、页签/预览器注册表服务、开合与宽度控制、按会话的布局持久化。功能（文件、Git …）由独立插件通过 `desktop.workbench` 服务注入。
- **定位**：对话视图（chat 页签）内部，官方「对话 / 轨迹」页签栏下方、消息流右侧；切到轨迹页签或会话未就绪时自动隐藏。
- **入口**：官方会话头 `conversation.session.header.utilities` 槽位里的 `[|]` 按钮（`order: 35`）。

> 本插件是桌面壳私有的扩展，**不是**官方插件体系的标准用法——它采用了「官方插槽 + 私有 DOM 注入」的混合方案，原因、契约与缺陷详见下文。

---

## 目录

1. [架构总览](#1-架构总览)
2. [与官方 DSH 的集成方式](#2-与官方-dsh-的集成方式)
3. [DOM 契约（本插件最大的耦合点）](#3-dom-契约本插件最大的耦合点)
4. [服务契约：desktop.workbench](#4-服务契约desktopworkbench)
5. [Tab / Viewer 描述符契约](#5-tab--viewer-描述符契约)
6. [宿主 API 与持久化](#6-宿主-api-与持久化)
7. [功能增强开关](#7-功能增强开关)
8. [关键实现细节](#8-关键实现细节)
9. [已知缺陷与风险](#9-已知缺陷与风险)
10. [加固建议](#10-加固建议)
11. [维护与升级检查清单](#11-维护与升级检查清单)

---

## 1. 架构总览

```
┌────────────────────────────── 桌面壳（electron） ──────────────────────────────┐
│                                                                              │
│  ┌─────────────── host 半区（lib/index.js，Node 侧）───────────────────┐      │
│  │  三条 HTTP 路由（注入 webServer 服务）：                              │      │
│  │    /api/desktop-workbench/config   框架总开关                        │      │
│  │    /api/desktop-workbench/layout   按会话布局（merge 语义）           │      │
│  │    /api/desktop-workbench/prefs    全局偏好（文件/Git 插件状态）      │      │
│  │  持久化文件：$DSH_HOME/desktop-workbench.json（原子写入）             │      │
│  └──────────────────────────────────────────────────────────────────────┘      │
│                              ▲ fetch                                          │
│  ┌─────────────── client 半区（lib/client.js，浏览器侧）───────────────┐      │
│  │  ctx.provide('desktop.workbench')                                  │      │
│  │    ├─ registerTab / registerViewer / activateTab / updateTab       │      │
│  │    ├─ openFile / closeFile / collapse / toggle / setOpen / isOpen  │      │
│  │    ├─ getSnapshot / subscribe / onAction / onOpenChange            │      │
│  │    └─ setHistoryLoading / isHistoryLoading / onHistoryLoadingChange │      │
│  │  官方插槽：conversation.session.header.utilities → [|] 按钮          │      │
│  │  官方插槽：desktop.features.item        → 「功能增强」总开关         │      │
│  │  DOM 注入：[data-phase] 根上做两列 grid → 工作台列                   │      │
│  └──────────────────────────────────────────────────────────────────────┘      │
│                              ▲ 服务注入                                        │
│  ┌─────────────── 功能插件（files / git / …）────────────────────────┐       │
│  │  inject: ['desktop.workbench'] → registerTab({id, title, icon,    │       │
│  │  order, component}) / registerViewer({id, extensions, component}) │       │
│  └────────────────────────────────────────────────────────────────────┘      │
└──────────────────────────────────────────────────────────────────────────────┘
```

依赖注入声明（`package.json` → `dsh.client.inject`）：`dsh-client-locale`、`dsh-client-runtime`、`dsh-client-ui-primitives`。

---

## 2. 与官方 DSH 的集成方式

### 2.1 使用的官方插槽（只有 2 个，且都是"入口/开关"性质）

| 插槽 | 注册条目 | 用途 |
|---|---|---|
| `conversation.session.header.utilities` | `id: "workbench-toggle"`, `order: 35` | 会话头右侧的 `[|]` 开合按钮（与打开工作区 / 导出会话同排） |
| `desktop.features.item`（桌面壳私有插槽，由 `dsh-desktop-features` 声明） | `id: "workbench"`, `order: 5` | 「功能增强」聚合卡片里的框架总开关（数据接口，渲染 null） |

面板本体**不经过任何官方插槽**（详见 2.2）。官方 42 个插槽中不存在"中列内部右侧分栏"这一追加式座位：

- `conversation.view` 是整页切换语义（加页签 ≠ 并排显示）
- `details` / `conversation.details.tool` 在 AppFrame 最右列、单占用座，会挤掉工具详情且位置不同
- `shell.overlay` 是浮层，不参与布局流
- `conversation` / `conversation.session` 是整体替换座，需要连带扛起草稿镜像、视图环、输入区职责

### 2.2 DOM 注入：面板本体如何挂载

`installDock()`（client.js）在 `document.body` 上挂一个 `MutationObserver`（`subtree: true`），跟随官方 ConversationRoot 的出现 / 消失 / 重建：

1. `findRoot()`：`document.querySelector('[data-conversation-scroll]')` 的 `parentElement` —— 即官方 `[data-phase]` 根容器。
2. 创建 `.ddwb_col` 列节点（React root，渲染 `WorkbenchColumn`），`appendChild` 进官方根，与 `[data-conversation-scroll]`（scrollBody）**平级**。
3. `attachToRoot()` 把官方根改造成两行两列 grid（见 [3.2](#32-attachtoroot-对官方根做的修改)），工作台列落在第二行第二列，**跨消息流与输入框两行**——输入框不会顶起工作台。
4. 轨道宽度由 CSS 变量 `--ddwb-chat-track` 控制：`0` = 收起（grid 列宽 0，列仍挂载但不可见）。
5. 自愈机制：
   - React 收敛子节点可能摘掉追加的列 → 官方根上的 `childList` MutationObserver 检测到缺失就重新 `appendChild`；
   - 会话切换时官方根整棵重建（列随销毁）→ body 级观察器检测宿主变化后重新挂载；
   - `[data-chat-flow]` 消失（切到轨迹页 / 会话未就绪）→ 轨道钳 0（隐藏），重新出现时恢复；
   - 卸载（dispose）时还原所有内联样式并移除列。

---

## 3. DOM 契约（本插件最大的耦合点）

> ⚠️ 本插件**依赖以下官方 DOM 结构与选择器**。它们是 ChatView 的内部实现细节，不是官方发布的接口契约。**升级 DSH 运行时前必须逐条核对**（见[第 11 节](#11-维护与升级检查清单)）。

### 3.1 依赖的官方选择器与元素

| 选择器 / 结构 | 含义 | 使用方 |
|---|---|---|
| `[data-phase]` | ConversationRoot 根容器（flex column：header + scrollBody） | `findRoot()` 的宿主；grid 改造目标 |
| `[data-conversation-scroll]` | 会话滚动体（scrollBody），消息流的滚动容器 | `findRoot()` 的锚点；grid 第 1 列第 2 行 |
| `[data-chat-flow]` | ChatView 消息流容器，**对话视图独有**（轨迹视图不渲染） | 视图切换判定：存在 = 对话页激活 |
| `[data-slot="conversation.session.header"]` 内的 `header` 元素 | 官方会话头（`header` 标签） | grid 第 1 行横跨两列（`grid-column: 1 / -1`） |
| `[data-chat-flow]` 内的"载入历史…"提示 div | `openState === "loading"` 时渲染的纯文本叶子 div（内容「载入历史…」/ "Loading history…"） | 历史加载闸门：加载期间禁止打开面板 |

### 3.2 attachToRoot 对官方根做的修改

对 `[data-phase]` 根（内联样式，dispose 时全部还原）：

```css
/* 根 */
display: grid;
grid-template-rows: auto minmax(0, 1fr);
grid-template-columns: minmax(0, 1fr) var(--ddwb-chat-track, 0px);  /* 0 = 收起 */
/* 官方 header */
grid-column: 1 / -1; grid-row: 1; min-width: 0;
/* 官方 scrollBody */
grid-column: 1; grid-row: 2; min-width: 0;
/* 工作台列 .ddwb_col */
grid-column: 2; grid-row: 2; min-width: 0; align-self: stretch;
```

- 列高度 = 第二行高度 = scrollBody 视口高度（grid stretch 自动跟随窗口 resize / 官方 details 开合，无需显式监听）；
- 列是 scrollBody 的**兄弟**而不是子节点，因此消息流滚动时工作台保持可见；
- 拖拽期间给根加 `data-ddwb-dragging` 属性，CSS 里用 `[data-phase][data-ddwb-dragging]{transition:none!important}` 禁用根的布局过渡，否则列宽不跟手。

### 3.3 契约隐含假设（升级时最易被打破的点）

1. `[data-conversation-scroll]` 的直接父元素就是 ConversationRoot 根，且根是 flex column（header + scrollBody 两段式）；
2. 官方会话头是 `header` 标签，且是根的直接子元素；
3. 对话视图 / 轨迹视图切换通过"`[data-chat-flow]` 挂载/卸载"实现（而不是别的判定方式）；
4. 官方对根没有自己的 `display: grid` / `grid-template-*` 内联样式（否则与本插件的写入直接冲突）；
5. 历史加载提示是消息流内**唯一无子元素的叶子 div**（与消息节点、分页按钮区分——后者有子结构）。

---

## 4. 服务契约：desktop.workbench

`ctx.provide('desktop.workbench', service)` **无条件提供**（即使框架总开关关闭，功能插件 `inject` 仍能解析——开关只控制面板挂载与按钮，不控制服务存在性）。

### 4.1 API 一览

| 方法 | 签名 | 说明 |
|---|---|---|
| `registerTab` | `(descriptor: TabDescriptor) => disposer` | 注册页签；`id` 必填且**不得重复**（重复抛错）；返回的 disposer 注销页签 |
| `registerViewer` | `(descriptor: ViewerDescriptor) => disposer` | 注册文件预览器；`id` 必填且不得重复 |
| `activateTab` | `(id: string) => void` | 激活页签（关掉已打开的文件，同时打开面板）；未知 id 忽略 |
| `updateTab` | `(id: string, patch: Partial<TabDescriptor>) => void` | 原位更新页签（如角标） |
| `openFile` | `(path: string) => void` | 按扩展名匹配第一个 viewer（按 `order` 升序），未匹配 `viewerId: null`；经动作通道交给列 |
| `closeFile` | `() => void` | 关闭当前文件，回到页签视图 |
| `collapse` | `() => void` | 收起面板（外部触发，如最后一个文件页签关闭） |
| `toggle` | `() => void` | 切换开合；历史消息加载中禁止打开 |
| `setOpen` | `(value: boolean) => void` | 打开/收起；`true` 且历史加载中时拒绝 |
| `isOpen` | `() => boolean` | 当前开合状态 |
| `onOpenChange` | `(listener: (open: boolean) => void) => disposer` | 订阅开合状态 |
| `setHistoryLoading` | `(value: boolean) => void` | 写入历史加载状态（由 DOM 观察器调用） |
| `isHistoryLoading` | `() => boolean` | 历史加载状态 |
| `onHistoryLoadingChange` | `(listener) => disposer` | 订阅历史加载状态 |
| `getSnapshot` | `() => { tabs, viewers }` | 注册表快照（按 `order` 升序） |
| `subscribe` | `(listener: (snap) => void) => disposer` | 订阅注册表变化 |
| `onAction` | `(handler: (action) => void) => disposer` | 订阅动作通道（`activateTab` / `openFile` / `closeFile` / `collapsePanel`）；列未挂载时动作**安全丢弃** |

### 4.2 可靠性语义

- 所有订阅器/动作处理器**逐个 try/catch**：某个订阅者崩溃不影响注册表与开关；
- 开合状态（open）由服务持有，Header 按钮与列组件共享——视图切换（对话 ↔ 轨迹）后重新挂载时能恢复；
- 页签/文件等**内容状态**属于列组件（不跨会话保留），切换会话时一律重置（见 6.2）。

---

## 5. Tab / Viewer 描述符契约

### 5.1 TabDescriptor

```ts
{
  id: string        // 必填，唯一
  title: string     // 页签文案
  icon?: (props) => ReactNode   // 页签图标组件（size 14 传入）
  order?: number    // 排序，升序（默认 0）
  badge?: number    // 角标数字，> 0 时显示
  component: (props: { ctx, service, t }) => ReactNode   // 面板组件
}
```

### 5.2 ViewerDescriptor

```ts
{
  id: string              // 必填，唯一
  extensions: string[]    // 匹配的扩展名，小写含点，如 ".md"、".png"
  order?: number          // 匹配优先级，升序（默认 0）
  component: (props: { path: string, t }) => ReactNode  // 预览组件
}
```

### 5.3 内置消费方（现状）

| 插件 | 注册内容 | order |
|---|---|---|
| `dsh-desktop-files` | Tab `files` + 6 个 viewer（`files:image` `.png/.jpg/.jpeg/.gif/.webp/.svg/.bmp/.ico`、`files:video`、`files:audio`、`files:markdown` `.md/.markdown/.mdx`、`files:pdf` `.pdf`、`files:code` 三十余种代码/文本扩展名） | tab 10，viewer 10–50 |
| `dsh-desktop-git` | Tab `git` | 30 |

另有约定：

- 功能插件通过 `ctx.get("desktop.workbench")` 获取服务，**带重试**（服务可能晚于插件出现）；
- 面板组件收到的 `t` 来自 workbench 词典，功能插件通常用自己的 `t` 包装覆盖（`FilesPanelWithT`），保证文案归属自己的词典；
- `dsh-desktop-files` 还**选择性拦截** `ctx.workspaces.openPath`：仅当路径匹配到预览器时才改道进文件页签（`filesStore.open` + `workbench.activateTab("files")`），目录/未知类型放行官方实现（避免劫持右键菜单「在资源管理器中打开」）；恢复时用 `.call` 保留 `workspaces` 服务上下文。

---

## 6. 宿主 API 与持久化

### 6.1 三条路由（`kind: exact`，注册进 `webServer` 服务）

#### `GET|HEAD|POST /api/desktop-workbench/config`
框架总开关。响应 `{ enabled: boolean }`。POST 要求 `body.enabled` 为 boolean，写入持久化文件。

#### `GET|HEAD|POST /api/desktop-workbench/layout`
按会话布局。GET 带 `?session=<id>`；POST body：`{ session, layout }`。
- **merge 语义**：`layouts[session] = { ...旧值, ...新值 }`——框架与功能插件各写各的字段互不覆盖；`null` 字段表示"清除该项"；
- 字段白名单：`open: boolean`、`width: number`（钳制 240–720）、`activeTabId: string`（≤128 字符）、`file: string`（≤4096 字符）、`repo: string`（≤128 字符，git 插件使用）；未知字段丢弃；
- 边界：布局 payload ≤ 32KB（**先查原始大小再收窄**，防止收窄后变小绕过限制）；会话数上限 200，超出按插入顺序淘汰最旧；
- 请求体上限 64KB；session 参数 ≤ 128 字符。

#### `GET|HEAD|POST /api/desktop-workbench/prefs`
全局偏好（跨会话、跨重启）。白名单 schema：

| key | 类型 | 范围 | 用途 |
|---|---|---|---|
| `files.treeCollapsed` | boolean | — | 文件面板目录树显隐 |
| `files.treeWidth` | number | 100–280 | 文件面板目录树宽度 |
| `git.listWidth` | number | 140–420 | Git 面板文件列表宽度 |
| `git.historyHeight` | number | 64–320 | Git 面板历史区高度 |

- 偏好上限 4KB；**不用 localStorage** 的原因：后端端口每次启动变化，web origin（连带 localStorage）随之改变。

### 6.2 持久化文件

`$DSH_HOME/desktop-workbench.json`（未设置 `DSH_HOME` 时为 `~/.dsh/desktop-workbench.json`），原子写入（临时文件 + rename）。

结构（同一文件同时存开关、布局与偏好）：

```jsonc
{
  "enabled": true,              // 框架总开关（config 路由）
  "layouts": {                  // 按会话 id 索引
    "<sessionId>": {
      "open": true, "width": 380,
      "activeTabId": "files",
      "file": "/abs/path.md",   // 或 null
      "repo": "/abs/repo"       // git 插件字段
    }
  },
  "prefs": { "files.treeCollapsed": false, "git.listWidth": 260 }
}
```

### 6.3 会话级行为约定

- 会话切换：**一律默认收起**；宽度按上次记忆恢复，激活页签与打开文件**一律重置**（避免不同会话/项目之间内容串扰）；
- 布局保存：`layout` / `open` / 宽度变化后防抖 400ms POST；
- `sessions` 服务未就绪时重试：500ms × 20 次，耗尽后直接就绪（布局降级为默认值，避免工作台列永久空白）。

---

## 7. 功能增强开关

`desktop.features.item` 条目（`id: "workbench"`, `order: 5`）注册的是**数据接口**而非 UI（组件渲染 `null`）：

```ts
{
  load: () => Promise<boolean>,          // GET config → enabled
  save: (enabled: boolean) => Promise<boolean>,  // POST config，返回是否被接受
  title: string,   // "工作台框架"
  description: string,
}
```

宿主配置优先级：`默认值(true) ← cordis.patch.yml 注入层 ← $DSH_HOME/desktop-workbench.json 用户覆盖`。

行为安装（client 侧）：默认全开先装（`installDock` + 按钮），配置到达后收敛（`applyConfig` 先 dispose 旧安装再按新配置重装）。服务本身无条件提供。

---

## 8. 关键实现细节

| 机制 | 实现 |
|---|---|
| 面板挂载 | body 级 `MutationObserver`（subtree）跟随 `[data-phase]` 根；React 摘列由根上 `childList` 观察器自愈重挂 |
| 宽度控制 | `--ddwb-chat-track` CSS 变量 → grid 列宽；`0` = 收起（列不卸载，DOM 常驻） |
| 拖拽调宽 | 左缘 8px 透明热区；**不用 setPointerCapture**（列宽变化引发 grid 重排/重渲染时 capture 随节点替换隐式释放），改在 `window` 上监听原生 pointer 事件；`rawWidth` 不钳制用于"拖到 <200px 自动收起"判定，`lastWidth` 钳制 240–720 实时写轨道；拖拽结束收敛一次状态触发持久化 |
| 默认/边界宽度 | 默认 380，最小 240，最大 720，自动收起阈值 200 |
| 历史加载闸门 | `[data-chat-flow]` 内"载入历史…"叶子 div 检测（内容匹配 + 无子元素双条件）；加载期间 `toggle`/`setOpen(true)` 拒绝，Header 按钮禁用——网格重排与官方滚动调整互相干扰是已知根因 |
| 页签栏横滚 | 隐藏滚动条（`scrollbar-width:none`），原生 `wheel` 事件把垂直滚动转横向位移；无溢出时不消费滚轮 |
| 渲染容错 | `WorkbenchErrorBoundary`：列内任何渲染错误显示占位文本而不是死空白 |
| 图标 | 官方图标库只有左面板图标 `IconPanelLeftOutline16`，`scaleX(-1)` 水平翻转成"右侧面板" |
| 会话跟随 | 订阅 `sessions.list`，current 变化时重置内容 + 拉取布局；`ctx.get("sessions")` 失败带 500ms×20 重试 |
| 词典 | `desktop-workbench` 命名空间，zh/en 双语 |

---

## 9. 已知缺陷与风险

> 本节是**维护必读**。本插件的集成方式在当前约束下（官方无对应插槽 + 桌面壳锁定运行时版本）是务实的，但以下风险是真实存在的。

### 9.1 耦合官方私有 DOM（最高风险）

依赖 `[data-phase]` / `[data-conversation-scroll]` / `[data-chat-flow]` / `header` 标签等内部结构（见[第 3 节](#3-dom-契约本插件最大的耦合点)）。官方一旦重构 ConversationRoot（给 scrollBody 加 wrapper、改 header 结构、换视图切换判定方式），**不会报错，而是静默布局错乱**：列漂移、grid 覆盖错元素、面板消失但按钮还在。

### 9.2 内联样式劫持官方根

`root.style.display = "grid"` + 拖拽时 `[data-phase][data-ddwb-dragging]{transition:none!important}`。如果官方代码未来自己给该根写 `display` / `grid-template-*`（例如官方自己做双列布局），两边**同时写内联样式，无协调仲裁**，谁后执行谁赢，行为不可预测。

### 9.3 绕过插槽系统的生命周期保障

官方插槽体系有声明代次、卸载级联、崩溃让位（abdicate）、stale 授权检查；DOM 注入一个都没有。若插件在写样式过程中崩溃，grid 内联样式可能残留在官方根上，把对话视图弄坏直到刷新。错误边界只保护列内渲染，**不保护"写官方根样式"这一步**。

### 9.4 全局 MutationObserver 成本

`observe(document.body, { subtree: true })`：每次 DOM 变化都跑回调（findRoot / findChatFlow / 历史加载检测）。当前规模下成本可忽略，但属于"每时每刻都在付"的税，且随官方 DOM 复杂度线性增长。

### 9.5 多插件冲突无仲裁

目前只有本插件做 DOM 注入；将来若有第二个插件也想 hack 同一个官方根（如加左侧面板），两者之间**没有任何优先级/协调机制**——插槽系统本应提供的就是这个。

### 9.6 注释与实现漂移（代码卫生问题）

模块头与 `attachToRoot` 注释曾提到"ResizeObserver 跟随视口高度"、"sticky top 0"，但代码里并不存在——实际靠 grid 第二行 `align-self: stretch` 自动跟随（列是 scrollBody 的兄弟节点，滚动时天然可见）。该漂移已随本 README 同步修正（见 `lib/client.js` 模块头与 `attachToRoot` 注释）。列高跟随视口变化是 grid 布局的隐式行为，后续修改时不要在注释里重新引入不存在的监听器/定位描述。

### 9.7 假安全感：版本锁定

桌面壳锁定 DSH 运行时版本（当前 0.1.0-rc.6），DOM 契约实际上是冻结的——这缓解了 9.1，但也制造了"永远安全"的错觉。**升级运行时 = 契约可能失效**，必须走第 11 节清单。

---

## 10. 加固建议

1. **契约检查 + 静默降级**（最高优先级）：`attachToRoot` 前校验 `[data-phase]` / `[data-conversation-scroll]` / `[data-chat-flow]` 全部命中、`scrollBody.parentElement` 结构符合预期、根上没有冲突的内联 grid 样式；不满足就**打日志 + 隐藏面板**，而不是把 grid 写上去。把"静默错乱"变成"明确降级"。
2. **收敛耦合面**：DOM 操作已集中在 `findRoot` / `findChatFlow` / `findHistoryLoading` / `attachToRoot` / `installDock`，保持这个边界，禁止在功能面板组件里直接查官方 DOM。
3. **上游提案**：推动官方在 `conversation` 槽的 children 声明里增加追加式座位（如 `conversation.view.dock`，list 类型），或在 `conversation.view` 条目上开放 children 声明——插槽系统设计出来就是为了让"官方 UI 随便改、插件不破"。这是治本方案。
4. **写保护**：把 `attachToRoot` 的所有样式写入集中成一个可审计的"补丁对象"，dispose 时逐项还原（已实现），并加一条自检：dispose 后断言官方根没有残留 `ddwb` 样式。
5. **性能**：body 观察器回调里加"仅当变更目标与 `[data-phase]` 子树相关才继续"的快速短路（如 `target.closest('[data-phase]')`）。

---

## 11. 维护与升级检查清单

升级 DSH 运行时（或官方 UI 包）前，逐条验证：

- [ ] `[data-conversation-scroll]` 选择器仍存在，且其 `parentElement` 仍是 ConversationRoot 根（flex column）
- [ ] 官方会话头仍是 `header` 标签且为根的直接子元素
- [ ] 对话/轨迹切换仍通过 `[data-chat-flow]` 挂载/卸载表达
- [ ] 官方根没有自带的 `display: grid` / `grid-template-*` 内联样式
- [ ] 「载入历史…」提示仍是消息流内唯一无子元素的叶子 div
- [ ] `conversation.session.header.utilities` 插槽仍存在（按钮注册不炸）
- [ ] `desktop.features.item` 插槽声明未变（features 插件侧）
- [ ] `ctx.workspaces.openPath` 签名未变（files 插件的拦截点）
- [ ] 实测：打开/收起/拖拽调宽/会话切换/轨迹页切换/历史加载禁用 六项回归
