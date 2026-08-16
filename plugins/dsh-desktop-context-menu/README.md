# dsh-desktop-context-menu

「右键菜单」功能增强：官方应用没有右键菜单，本插件补齐三类右键行为——

- **输入框**：剪切 / 复制 / 粘贴 / 全选（+ 刷新）；
- **侧栏工作区行**：「在资源管理器中打开」；
- **任意选中内容 / 图片**：直接复制（图片优先复制位图，失败降级复制地址）。

开关由 host 持久化（`~/.dsh/desktop-context-menu.json`），开关项注册进「功能增强」卡片（`desktop.features.item`）。复制 / 打开等操作通过轻量 toast 反馈。

> 集成模式：**官方插槽（`desktop.features.item` + `shell.overlay`）+ 全局事件监听**，无 DOM 注入、无官方 DOM 样式覆盖——比 workbench / ui 插件规范。`shell.overlay` 的两个条目是纯生命周期/注入载体，实际渲染经 `createPortal` 到 `document.body`（见[第 3 节](#3-与官方-dsh-的集成方式)）。

---

## 目录

1. [架构总览](#1-架构总览)
2. [与官方 DSH 的集成方式](#2-与官方-dsh-的集成方式)
3. [DOM 契约](#3-dom-契约)
4. [行为契约](#4-行为契约)
5. [宿主 API 与持久化](#5-宿主-api-与持久化)
6. [功能增强开关](#6-功能增强开关)
7. [实现细节](#7-实现细节)
8. [已修复缺陷（2025 收尾）](#8-已修复缺陷)
9. [已知缺陷与风险](#9-已知缺陷与风险)
10. [加固建议](#10-加固建议)
11. [维护与升级检查清单](#11-维护与升级检查清单)

---

## 1. 架构总览

```
┌────────────────────────────── 桌面壳 ──────────────────────────────┐
│                                                                    │
│  host 半区（lib/index.js）                                          │
│    └─ /api/desktop-context-menu/config  开关 GET/HEAD/POST          │
│       （持久化：~/.dsh/desktop-context-menu.json，原子写入）          │
│                                                                    │
│  client 半区（lib/client.js）                                       │
│    ├─ desktop.features.item 条目（id "context-menu", order 30）      │
│    │    └─ 数据接口 {load, save, title, description}（渲染 null）     │
│    ├─ shell.overlay 条目 ×2（生命周期/注入载体，实际 portal 到 body）  │
│    │    ├─ "…-toast"  → DesktopUiToastHost（顶中 toast，3.2s 自动消失）│
│    │    └─ "…-float"  → DesktopUiFloatHost（右键菜单浮层）            │
│    └─ 全局监听：contextmenu / pointerdown / keydown（Escape）         │
│                                                                    │
│  功能本体：installChatContextMenu()                                  │
│    ├─ 输入框菜单：cut/copy/paste/selectAll + reload                  │
│    ├─ 工作区行菜单：openInExplorer（走官方 workspaces.openPath）      │
│    └─ 选中内容菜单：copySel（文本 / 图片位图→地址降级）                │
└────────────────────────────────────────────────────────────────────┘
```

依赖注入声明：`slots`、`locale`（client）；`webServer`（host）。

---

## 2. 与官方 DSH 的集成方式

| 位置 | 注册条目 | 用途 |
|---|---|---|
| `desktop.features.item` | `id: "context-menu"`, `order: 30` | 「功能增强」卡片开关（数据接口，组件 `() => null`） |
| `shell.overlay` | `id: "dsh-desktop-context-menu-toast"` | toast 宿主的生命周期/注入载体 |
| `shell.overlay` | `id: "dsh-desktop-context-menu-float"` | 右键菜单浮层的生命周期/注入载体 |

### 2.1 shell.overlay 的用法：生命周期载体 + 注入通道

官方 `shell.overlay` 是整框浮层（list/root，官方未占用——纯扩展位）。本插件的两个宿主组件**注册进该槽位，但实际渲染 `createPortal(…, document.body)`**：

- 插槽只承担**生命周期**（随开关安装/卸载）与 **store 注入**（`inject: () => ({ hooks: { toastState / floatState } })`，两个模块级 `createSnapshotStore` 经 hooks 进组件）；
- portal 到 body 的原因（源码注释）：`position: fixed` 元素若挂在被 `transform` / `filter` 的祖先下会被困住，body portal 保证浮层永远在应用自己的叠加层之上（toast/菜单 `z-index: 3000`）。

这是对"官方空扩展位"的合理用法：注册进官方槽位获得生命周期管理，渲染细节（portal）自决。

### 2.2 打开工作区目录：走官方通道

右键工作区行 → 菜单「在资源管理器中打开」→ **`workspaces.openPath(path)`**（官方服务，桌面壳各插件同款通道），失败 toast 反馈。host 端**不设** open-workspace 路由（旧版本曾自建 `cmd /c start` 通道，属死代码，已删除，见[第 8 节](#8-已修复缺陷)）。

---

## 3. DOM 契约

本插件**不修改任何官方 DOM 样式**，但依赖以下结构与事件：

| 依赖 | 用途 | 失效后果 |
|---|---|---|
| 全局 `contextmenu`（capture）+ `stopImmediatePropagation` + `preventDefault` | 接管应用内所有右键 | 官方/其他插件未来的 contextmenu 监听被阻断（见 9.1） |
| `[role="treeitem"][aria-expanded]` | 识别侧栏**工作区行**（会话行是 `aria-selected`，据此区分） | 结构/语义变化后工作区右键菜单失效 |
| `[data-composer-card] textarea` | 组合器输入框定位（粘贴走官方粘贴管线） | 组合器粘贴菜单失效 |
| `textarea, input[type="text"], input[type="search"], input:not([type])` | 输入框菜单的作用域 | 新输入类型（如 contenteditable）不在覆盖范围 |
| `workspaces.list.getSnapshot().items` | 工作区行 label → 目录路径解析（按 title 或路径 basename 匹配） | 同名工作区可能误匹配 |
| `workspaces.openPath(path)` | 打开目录（官方通道） | 官方签名变化 → 打开失败（有 toast 反馈） |

aria 属性比 class 稳定，但仍是官方 DOM 的隐式契约——升级 DSH 运行时需回归验证（见[第 11 节](#11-维护与升级检查清单)）。

---

## 4. 行为契约

### 4.1 菜单项

| 场景 | 菜单项 | 禁用条件 |
|---|---|---|
| 输入框（有焦点选区上下文） | 剪切 / 复制 / 粘贴 / 全选 / ─ / 刷新 | cut：无选区或只读；copy：无选区；paste：只读；selectAll：无文本 |
| 工作区行（`treeitem[aria-expanded]`） | 在资源管理器中打开 | 路径解析失败时**不弹自定义菜单**（放行原生菜单） |
| 其余任意位置（含选中文本 / 图片） | 复制 / ─ / 刷新 | 既无选中文本也无图片时复制禁用 |

### 4.2 浮层行为

- **定位**：菜单显示在光标处，近右缘/近底缘自动翻转（宽度按 132px、行高按 26px 估算）；
- **关闭**：Escape、菜单外 `pointerdown`（capture，`closest(".dduiCtx")` 排除菜单自身）；
- **刻意不做 scroll 关闭**（源码注释）：菜单是 `position: fixed`，滚动不影响位置（桌面应用惯例）；且真实滚动事件不会传到 window/document 的 capture 监听，只有合成 scroll 会触发——该路径只会误伤；
- **焦点保持**：菜单 `onMouseDown` `preventDefault`，点击菜单项后焦点仍留在原输入框（剪切/粘贴依赖选区）；
- **toast**：单槽位（新消息替换旧消息），3.2s 自动消失，`role="status"`，success/error 双态（error 边框 + 警告图标）。

### 4.3 剪贴板行为

| 动作 | 实现 | 降级 |
|---|---|---|
| 复制选中文本 | 官方 `writeClipboard` 原语 | — |
| 复制图片 | `ClipboardItem` 位图写入 | fetch/CORS/权限失败 → 复制图片地址（`writeClipboard`） |
| 输入框复制/剪切 | `writeClipboard` +（剪切）`setRangeText` 移除选区 + 派发 `input` 事件 | 写剪贴板失败则不修改字段 |
| 粘贴（组合器） | `navigator.clipboard.readText` → 合成 `ClipboardEvent("paste")` 走官方粘贴管线（chip 感知） | 权限拒绝 / 剪贴板为空 → 错误 toast |
| 粘贴（普通输入框） | `readText` → `setRangeText` 替换选区 + `input` 事件 | 同上 |

所有动作反馈文案走词典（zh/en），随活动语言切换（`dduiT` 模块级绑定，见[第 7 节](#7-实现细节)）。

---

## 5. 宿主 API 与持久化

### `GET|HEAD|POST /api/desktop-context-menu/config`

与桌面壳各 feature 插件同一约定：GET/HEAD 返回 `{ enabled: boolean }`（`cache-control: no-cache`）；POST 要求 `body.enabled` 为 boolean，非法返回 400 `{ ok: false, error }`；其他方法 405。

配置优先级：`默认值(true) ← cordis.patch.yml 注入层 ← ~/.dsh/desktop-context-menu.json 用户覆盖`。

持久化文件：`$DSH_HOME/desktop-context-menu.json`（未设 `DSH_HOME` 时为 `~/.dsh/`）——独立文件，与其他插件的持久化文档（如 workbench 的 `desktop-workbench.json`）互不干扰；原子写入（临时文件 + rename），容错读取（损坏 → `{}`）。

---

## 6. 功能增强开关

`desktop.features.item` 条目注册数据接口（组件 `() => null`）：

```ts
{
  load: () => loadConfig().then(c => c.enabled),   // GET config
  save: (enabled) => saveConfig({ enabled }),       // POST config
  title: t("feature.title"),        // "右键菜单"
  description: t("feature.description"),
}
```

行为安装：默认全开先装（toast + 浮层 + 全局监听），`loadConfig()` 到达后 `applyConfig` 收敛（先 dispose 旧的再按新配置重装）。**开关条目本身 always-on**（数据接口永远可调，即使功能关闭）。

---

## 7. 实现细节

| 机制 | 实现 |
|---|---|
| 浮层状态 | 两个模块级 `createSnapshotStore`（`dshFloatStore` / `dshToastStore`），经插槽 `inject.hooks` 注入组件——组件卸载后 store 仍在，动作安全丢弃 |
| 菜单构建 | `showFloatingMenu(x, y, items, target, payload)`：估算宽高 + 边缘翻转；`runContextAction` 从 `getSnapshot()` 读当前菜单（避免闭包捕获过期菜单） |
| 动作分发 | `runContextAction(id)` 按 id 分发：openInExplorer / reload / copySel / cut / copy / paste / selectAll |
| 词典绑定 | `apply()` 里 `dduiT = ctx.locale.bind(NS)`——菜单项标签在构建时用 `t()`，动作时刻的 toast 文案用模块级 `dduiT`（菜单项与 toast 全部双语，zh/en 键集完整） |
| 样式 | 自带 CSS module 注入（toast + 菜单各一标签，`data-plugin-css` 幂等，`data-plugin` 归属本插件） |
| 工作区路径解析 | label 与 `workspaces.list` 的 `title` 或路径 basename 匹配（尾部斜杠归一） |
| 全局监听 | `contextmenu` / `pointerdown` / `keydown` 均 capture 阶段；disposer 统一移除 + 隐藏菜单 |
| 开关收敛 | `applyConfig` 模式与 workbench/notify/updates 一致（默认 → 配置到达重装） |

---

## 8. 已修复缺陷

| 缺陷 | 修复 |
|---|---|
| toast 样式标签 `data-plugin` 误写为 `"dsh-desktop-ui"`（自 ui 迁移的复制残留） | 改为 `"dsh-desktop-context-menu"`（否则按插件归属的样式清理会漏删/误删） |
| host 端 `/api/desktop-context-menu/open-workspace` 路由 + `openInSystem` 是死代码（客户端实际走官方 `workspaces.openPath`，注释与实现矛盾） | 删除路由与 `openInSystem`（含 `spawn`/`statSync`/`pathResolve` 导入与节流变量），host 头注释同步改写 |
| 菜单项文案（剪切/复制/粘贴/全选/刷新）硬编码中文，en 词典缺失 | 全部走 `t()`，zh/en 补齐（含 6 条 toast 反馈键） |
| `document.execCommand` ×3（`cut` / `copy` / `insertText`，已废弃 API） | 复制/剪切换官方 `writeClipboard` 原语（剪切：写成功后再 `setRangeText` 移除选区 + 派发 `input` 事件，避免"剪了但剪贴板失败"的数据丢失）；普通输入框粘贴换 `setRangeText` + `input` 事件 |

> 已知取舍（修复时有意保留）：`setRangeText` 不产生撤销栈条目（execCommand 曾有）；组合器粘贴仍走合成 `ClipboardEvent`（官方管线，chip 感知）。

---

## 9. 已知缺陷与风险

### 9.1 全局 capture 劫持所有右键（有意取舍，但需知晓）

`contextmenu` capture + `stopImmediatePropagation` + `preventDefault`：应用内**任何位置**右键都进自定义菜单（空白处也弹「复制(禁用)+刷新」），并阻断官方或其他插件未来的 contextmenu 监听。桌面端可接受（官方本无右键菜单），但升级 DSH 时若官方自己加右键菜单会直接冲突——届时需要改为"未命中本插件场景时放行"。

### 9.2 DOM 契约依赖（见[第 3 节](#3-dom-契约)）

`[data-composer-card] textarea`、`[role="treeitem"][aria-expanded]`、`workspaces.openPath` 均为官方内部结构/接口。结构变化时**静默失效**（toast 可能仍显示成功——组合器粘贴路径无失败反馈）。

### 9.3 菜单尺寸估算硬编码

翻转判定用固定 `width 132 / itemHeight 26`：实际菜单 `min-width: 132` 可更宽（更长 label），右缘翻转可能偏一格；分隔符按 26px 计入高度，翻转阈值略偏。纯视觉小问题。

### 9.4 a11y 契约不完整

`role="menu"` + `menuitem` 按钮已具备（Tab 可达、Escape 关闭、label 关联），但**无方向键导航**（role=menu 的键盘契约：↑↓ 移动、Home/End）；window resize / blur 不关闭菜单（fixed 定位不会错位，但菜单可能留在原地）。

### 9.5 开关 fail-open

`loadConfig` 失败回退默认（全开）——配置端点不可用时功能仍安装。对便捷性功能可接受（与各 feature 插件一致），但意味着"开关不可达"时行为是启用而非禁用。

### 9.6 工作区行识别依赖 aria 语义

`treeitem[aria-expanded]` 假定官方用 `aria-expanded` 区分工作区行与会话行（会话行 `aria-selected`）。官方若改变语义标记，工作区菜单静默失效（不会误弹菜单——解析失败时放行原生菜单，见 4.1）。

---

## 10. 加固建议

1. **右键劫持收窄**：第三分支（非输入框/非工作区行）只在确有可复制内容（选中文本或图片）时才 `preventDefault`，空白处放行原生菜单——减少对官方/其他插件的侵入面。
2. **DOM 契约检查 + 静默降级**：安装时校验 `[data-composer-card]`、工作区行选择器命中；不满足时打日志并跳过对应场景（不装监听），把"静默失效"变成"明确降级"。
3. **菜单尺寸改为实测**：渲染后按 `getBoundingClientRect` 二次校正翻转，或用 `max-content` 布局替代估算。
4. **补 a11y**：菜单加 ↑↓/Home/End 键盘导航与 `aria-activedescendant`（或退化为 `role="listbox"` 语义）。
5. **组合器粘贴加反馈**：合成 `ClipboardEvent` 后无法得知官方是否消费——可监听同一 textarea 的 `input` 事件作为"已被消费"信号，超时未触发则提示。
6. **上游提案**：若官方未来提供 `conversation` 内的通用浮层/菜单锚点插槽，迁移到官方渲染位，去掉 body portal。

---

## 11. 维护与升级检查清单

- [ ] `shell.overlay` 插槽仍存在（两个宿主条目注册不炸）
- [ ] `desktop.features.item` 插槽声明未变（features 插件侧）
- [ ] `workspaces.openPath` 签名未变（工作区打开通道）
- [ ] 侧栏工作区行仍带 `[role="treeitem"][aria-expanded]`（会话行 `aria-selected`）
- [ ] 组合器结构仍含 `[data-composer-card] textarea`（粘贴管线）
- [ ] `/api/desktop-context-menu/config` 端点路径与响应格式未变
- [ ] 实测回归：输入框四操作、工作区打开、选区复制、图片复制、菜单翻转、Escape/点击关闭、开关关闭后监听移除
