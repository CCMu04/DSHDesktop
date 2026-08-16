# dsh-desktop-ui

「视觉增强」：桌面壳的纯视觉定制（不改变官方能力）。每个功能带独立开关，在设置页「视觉增强」卡片里编辑，保存后整页刷新生效。

**功能清单（5 个开关，顺序即卡片行序）**：

| 开关 | 效果 |
|---|---|
| `settingsDrawer` | 官方居中设置弹窗改为左侧滑出抽屉（CSS + 关闭动画 shim） |
| `sessionLogExport` | 页签行右端显示中文「导出会话」按钮（替代官方英文按钮）+ 下载对话框 |
| `statsLine` | 组合器下方统计行占满整行居中，超出省略号收尾 |
| `openWorkspace` | 页签行右端「打开工作区」按钮（在资源管理器中打开当前工作区） |
| `chatPolish` | 思考文案限高可滚动；「载入历史…」提示居中 |

> ⚠️ **已知功能级缺陷**：`openWorkspace` 与 `chatPolish` 两个开关**无法持久化**（host 配置键集未同步，见[第 7.1 节](#71--功能级hostclient-配置键集不同步)）——当前这两个功能永远生效，设置页的开关是摆设。

---

## 目录

1. [架构总览](#1-架构总览)
2. [与官方 DSH 的集成方式](#2-与官方-dsh-的集成方式)
3. [CSS / DOM 契约](#3-css--dom-契约)
4. [宿主 API 契约](#4-宿主-api-契约)
5. [行为契约](#5-行为契约)
6. [实现细节](#6-实现细节)
7. [已知缺陷与风险](#7-已知缺陷与风险)
8. [已修复缺陷](#8-已修复缺陷)
9. [加固建议](#9-加固建议)
10. [维护与升级检查清单](#10-维护与升级检查清单)

---

## 1. 架构总览

```
┌────────────────────────────── 桌面壳 ──────────────────────────────┐
│                                                                    │
│  host 半区（lib/index.js，180 行）                                   │
│    └─ /api/desktop-ui/config  开关 GET/HEAD/POST（单 handler 分发）  │
│       （持久化：~/.dsh/desktop-ui.json，原子写入，部分 POST merge）  │
│                                                                    │
│  client 半区（lib/client.js，~840 行）                               │
│    ├─ 常驻注入：卡片样式 + 隐藏官方 sessionLog 按钮 CSS               │
│    ├─ settings.plugin.item 条目（id "dsh-desktop-ui-config",        │
│    │    order 100）→ 「视觉增强」配置卡片（5 开关 + 重置 + 保存）      │
│    ├─ conversation.session.header.utilities 条目 ×2：               │
│    │    open-workspace（order 20）/ 会话导出（order 30）              │
│    ├─ 功能 CSS 按开关安装/卸载（dduiInstallCss 返回 disposer）        │
│    └─ settingsDrawer：CSS 抽屉 + capture 事件 shim（关闭动画）        │
└────────────────────────────────────────────────────────────────────┘
```

依赖注入：client `slots`、`locale`（**本次修复**：移除未使用的 `remote` / `remote.pluginInventory` / `connection` 硬依赖）；host `webServer`。

---

## 2. 与官方 DSH 的集成方式

| 位置 | 条目 | 说明 |
|---|---|---|
| `settings.plugin.item` | `id: "dsh-desktop-ui-config"`, order 100 | 「视觉增强」配置卡片（**始终安装**——它是开关的总控台） |
| `conversation.session.header.utilities` | `id: "open-workspace"`, order 20 | 「打开工作区」按钮（`config.openWorkspace` 开启时） |
| `conversation.session.header.utilities` | `id: "dsh-desktop-ui-session-log-download"`, order 30 | 「导出会话」按钮 + 下载对话框（`config.sessionLogExport` 开启时） |
| CSS 覆盖 | — | statsLine / chatPolish / settingsDrawer 三项纯 CSS，按开关注入/移除 |

**集成风格**：插槽只做"入口按钮 + 配置卡片"，视觉改造走**官方 DOM 的 CSS 覆盖**（`!important`）——比 workbench 的 JS 注入浅、比 features 的纯插槽深。隐藏官方按钮（`display:none!important`）与事件 shim（见 3.3）已越过"纯视觉"边界，属功能性干预，升级需回归。

---

## 3. CSS / DOM 契约

> 本插件是 9 个桌面插件中**对官方 DOM 结构依赖最深**的一个。以下选择器/结构变化都会静默失效。

### 3.1 依赖的官方结构

| 选择器 / 结构 | 用途 | 失效后果 |
|---|---|---|
| `div[role="presentation"] > div[role="dialog"][aria-modal="true"][aria-labelledby]` | 设置面板 Modal 定位（抽屉化 + 关闭 shim） | 抽屉变回居中弹窗（`settingsDrawer`） |
| 上述 dialog 的 `parentElement.children[0]`（mask）、`children[1].children[0].lastElementChild`（关闭按钮） | 关闭 shim 的 mask/关闭按钮识别 | 关闭动画/点击关闭失效 |
| `[data-slot="conversation.session.header"] header > div:first-child > div:last-child` | utilities 容器定位到页签行右端 | 按钮回到原位（`sessionLogExport` / `openWorkspace`） |
| `[data-slot="conversation.composer.dock"]>div`（+ hash 类兜底） | 统计行整宽居中 | 统计行恢复窄宽（`statsLine`） |
| `[data-variant="think"] [class*="thinkBody"]` | 思考文案限高 | 限高失效（`chatPolish`） |
| `[data-chat-flow]>div:first-child[class$="_hint"]` | 历史提示居中 | 居中失效 |
| `[data-slot="conversation.session.header.utilities"] [class*="sessionLogButton"]` | 隐藏官方导出按钮 | 官方按钮重新出现（双按钮） |
| 官方 `sessionLogDownload` 服务（`ctx.get`） | 导出按钮的请求/状态通道 | 按钮不安装（已守卫降级） |

### 3.2 选择器设计要点（值得保留的做法）

- **优先用官方 `data-slot` 属性**（槽位出口稳定），hash 类（CSS-module）只做兜底——statsLine 是范例；
- 抽屉选择器刻意**只命中 `aria-labelledby`**：官方 primitives `Modal` 用 `aria-label`，不受抽屉影响（有注释明示边界）。

### 3.3 settingsDrawer 关闭 shim（事件流干预）

官方设置面板关闭时直接卸载 DOM，CSS 无法动画。shim 在 capture 阶段拦截三条关闭路径（关闭按钮点击 / 真实 mask 点击 / Escape）：

1. `stopImmediatePropagation` 阻止官方立即关闭；
2. 给 panel + mask 加 `ddui_closing` 类播放滑出动画（220ms）；
3. 240ms 后**重放合成事件**（`KeyboardEvent` / 对 mask 的合成 `MouseEvent` / 原事件）完成官方关闭；`bypassing` 标志防止重放被再次拦截。

合成事件是 **untrusted** 的——依赖官方 handler 不检查 `isTrusted`；`240ms` 与动画时长 `0.22s` 硬编码配对。

---

## 4. 宿主 API 契约

### `GET|HEAD|POST /api/desktop-ui/config`

- GET/HEAD：返回生效配置（三层合并：`内置默认值 ← 插件行 config(patch 层) ← desktop-ui.json`），`cache-control: no-cache`；
- POST：`narrowPatch` 白名单收窄（只取 `CONFIG_KEYS` 内的 boolean），**部分 POST 与既有 overrides merge**（只更新携带字段）；空补丁 → 400 `no-boolean-fields`；
- 其他方法 → 405；请求体 64KB 上限；原子写入（tmp + rename）；损坏文档回退 `{}`。

### ⚠️ 配置键集：host 3 键 vs client 5 键（见 7.1）

---

## 5. 行为契约

| 行为 | 约定 |
|---|---|
| 启动调度 | 先按「全开」安装（界面不闪缺功能）→ `loadDesktopUiConfig()` 到达后 `applyConfig` 收敛（dispose 旧的 → 装新的） |
| 开关粒度 | 每个功能独立 CSS 标签 + disposer；关闭即移除视觉变更（**常驻两项除外**：卡片样式、隐藏官方按钮） |
| 配置卡片 | 5 开关行（label `htmlFor` ↔ checkbox `id`）+ 启用/停用徽标 + 描述；加载中/失败态；保存中禁用 |
| 保存 | POST 完整 draft → 成功 **整页 reload**（收敛手段，与 features 同款） |
| 重置 | 恢复**默认全开**（与 features 卡片的"撤销草稿回已加载值"语义不同，见 7.7） |
| 导出会话 | 按钮 busy 时 `aria-busy` + 禁用；对话框镜像官方三态（preparing/success/error） |
| 打开工作区 | 当前工作区 = `sessionIds.includes(current)` 的工作区，找不到退回第一个；路径空则忽略 |

---

## 6. 实现细节

| 机制 | 实现 |
|---|---|
| 配置读取 | `dduiNarrowConfig` 以默认 5 键为基底 + 服务端 boolean 覆盖（失败回退全开） |
| CSS 注入 | `dduiInstallCss` 幂等（`data-plugin-css` 查重）+ 返回移除函数；功能 CSS 随开关安装 |
| 常驻注入 | 卡片样式与隐藏官方按钮 CSS 在模块顶层注入（有意常驻，无 disposer） |
| 抽屉动画 | mask fade（`dduiMaskFadeIn/Out`）+ panel slide（`dduiSettingsSlideIn/Out`），`:has()` 选择器限定设置面板 |
| 词典 | `desktop-ui` 命名空间，zh/en 全键对（含配置卡片 5 开关文案） |

---

## 7. 已知缺陷与风险

> 状态：🟡 功能级（已确认未修）/ 🔵 卫生级。

### 7.1 🟡 host/client 配置键集不同步（最严重）

client `dduiDefaultConfig` 有 **5 键**（含 `openWorkspace` / `chatPolish`），host `DEFAULT_CONFIG` / `CONFIG_KEYS` 只有 **3 键**。后果：设置页保存时 host `narrowPatch` 丢弃 2 键 → 无法持久化 → reload 后按默认值补全 → **「打开工作区按钮」「聊天界面微调」两个开关永远生效，无法关闭**。修复：host `DEFAULT_CONFIG` 补两键（一行级）。已在 client 头注释标注（本次修复时同步）。

### 7.2 🟡 关闭 sessionLogExport 会连带失去官方导出入口

隐藏官方按钮的 CSS **无条件常驻**（L493–496，注释明示有意）：关闭 `sessionLogExport` → 本插件按钮不装 + 官方按钮被藏 = **导出功能完全不可用**（而非恢复官方按钮）。语义"关开关 = 功能消失"是设计决策，但副作用链需知晓；修复方向：隐藏 CSS 随开关安装。

### 7.3 🔵 settingsDrawer 深度耦合官方 Modal 关闭路径

capture 拦截 + `stopImmediatePropagation` + 合成事件重放（untrusted + 240ms 硬编码）：官方 Modal 结构/关闭路径一变即静默失效或出现双关闭。`isTrusted` 检查的官方实现会直接破坏 shim。

### 7.4 🔵 打开工作区失败静默

`OpenWorkspaceHeaderAction` 的 `workspaces.openPath(path).catch(() => {})` 无任何反馈（context-menu 同类操作有 toast）。原因：本插件的 toast 设施已迁移至 context-menu 插件，无现成反馈通道。

### 7.5 🔵 重置语义与 features 卡片不一致

本插件 reset = 恢复默认全开；features 卡片 reset = 撤销草稿回已加载值。两者自洽但语义不同，用户跨卡片操作时可能困惑。

### 7.6 🔵 常驻 CSS 无 disposer

`configCardCss` / `hideOfficialSessionLogCss` 模块顶层注入丢弃 disposer——插件热卸载时样式残留（当前桌面壳无热卸载场景，影响有限）。

### 7.7 🔵 样式镜像重复

`dduiC_*`（视觉增强卡片）与 features 的 `dduiFg_*`（功能增强卡片）是同构样式表的两份拷贝（features 注释明示镜像本插件）——改一处需同步两处。

### 7.8 🔵 保存 = 整页 reload

与 features 同款收敛手段（子功能无配置变更订阅）；改一个开关 → 整个应用重载、设置面板状态丢失。

---

## 8. 已修复缺陷

| 缺陷 | 修复 |
|---|---|
| `inject` 声明 3 个未使用的硬依赖（`remote` / `remote.pluginInventory` / `connection`，历史迁移遗留） | 收敛为 `["slots", "locale"]`（硬依赖语义下多余声明会无谓挂起插件） |
| 头注释 Feature inventory 只列 3 个功能 | 补全 5 个，并**标注 7.1 的键集不同步**（防止后人误以为开关有效） |
| zh 词典 `config.sessionLogExport.desc` 文案残留"（中文）" | 去掉，与 en 语义对齐 |

---

## 9. 加固建议

1. **同步 host 配置键集（最高优先级）**：host `DEFAULT_CONFIG` 补 `openWorkspace: true` / `chatPolish: true` 两键，两个假开关立即变真（一行级，但属功能修复，按用户决策暂缓）。
2. **隐藏官方按钮随开关**：`hideOfficialSessionLogCss` 移入 `installFeatures` 的 `config.sessionLogExport` 分支（开关关闭 → 官方按钮恢复，导出入口不再消失）。
3. **抽屉 shim 加契约检查**：安装时校验 `panelSelector` 命中且结构符合（mask/header/closeButton 三件套齐全），不满足则跳过 shim 只保留 CSS（抽屉可用、无动画）——把"静默失效"变成"明确降级"。
4. **打开工作区失败反馈**：复用 context-menu 的 toast 通道（或将 toast 抽回共享设施），失败时提示。
5. **重置语义对齐**：与 features 统一为"撤销草稿回已加载值"。
6. **样式镜像收敛**：与 features 共用一份卡片样式源（桌面壳共享包）。

---

## 10. 维护与升级检查清单

- [ ] 设置面板 Modal 仍为 `div[role="presentation"] > div[role="dialog"][aria-modal="true"][aria-labelledby]` 结构（抽屉 + shim 依赖）
- [ ] 官方 primitives Modal 未改用 `aria-labelledby`（否则抽屉会误伤其他对话框）
- [ ] `[data-slot="conversation.session.header"]` 内 header 子结构未变（utilities 定位）
- [ ] `conversation.session.header.utilities` 插槽仍存在（两个按钮注册不炸）
- [ ] 官方 `sessionLogDownload` 服务签名未变（导出按钮/对话框依赖）
- [ ] `conversation.composer.dock` 出口的 `data-slot` 属性仍渲染（statsLine）
- [ ] `[data-variant="think"]` / `[data-chat-flow]` 结构未变（chatPolish）
- [ ] 若 7.1 已修：实测 openWorkspace / chatPolish 开关可持久化关闭
- [ ] 实测回归：5 开关各自开/关后保存 reload 生效、抽屉开合动画与关闭路径、导出按钮与对话框三态、打开工作区、统计行样式、思考限高
