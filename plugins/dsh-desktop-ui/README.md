# dsh-desktop-ui

「视觉增强」插件：为官方 DSH Web UI 提供设置抽屉、会话导出、统计栏、打开工作区和聊天界面微调；开关位于「设置 > 插件 > 视觉增强」。

- **框架/宿主**：host 提供五键配置的读取、校验和持久化 API；client 注册官方 slot、视觉样式和交互行为。
- **数据流**：client 从 `/api/desktop-ui/config` 读取 host 合并配置，POST 前由 host 按 boolean 白名单校验，再写入 `$DSH_HOME/desktop-ui.json`。
- **安全模型**：本插件不读取或写入工作区文件；配置接口仅接受 JSON，限制 64KiB 请求体，写入使用唯一临时文件、fsync 和 rename。
- **开关**：`settingsDrawer`、`sessionLogExport`、`statsLine`、`openWorkspace`、`chatPolish`，默认全开。

> 质量结论：核心入口使用官方 slot、服务和 primitives；视觉适配仍需要登记的官方 DOM/CSS 兼容层，升级 DSH 时必须逐条执行第 10 节清单。

---

## 目录

1. [架构总览](#1-架构总览)
2. [与官方 DSH 的集成方式](#2-与官方-dsh-的集成方式)
3. [宿主 API 契约](#3-宿主-api-契约)
4. [安全模型](#4-安全模型)
5. [客户端行为契约](#5-客户端行为契约)
6. [解析 / 渲染契约](#6-解析--渲染契约)
7. [已知缺陷与风险](#7-已知缺陷与风险)
8. [已修复缺陷](#8-已修复缺陷)
9. [加固建议](#9-加固建议)
10. [维护与升级检查清单](#10-维护与升级检查清单)

---

## 1. 架构总览

```
┌────────────────────────────── 桌面壳 ──────────────────────────────┐
│ host（lib/index.js）                                               │
│   └─ /api/desktop-ui/config  exact GET/HEAD/POST                  │
│      五键配置合并、校验、持久化                                    │
│ client（lib/client.js）                                            │
│   ├─ settings.plugin.item：视觉增强配置卡片                       │
│   ├─ conversation.session.header.utilities：导出/工作区按钮       │
│   └─ 按开关安装 CSS、事件 shim 和官方服务调用                     │
└────────────────────────────────────────────────────────────────────┘
```

依赖注入声明：client `slots`、`locale`、`sessionLogDownload`、`workspaces`、`sessions`；host `webServer`。

## 2. 与官方 DSH 的集成方式

| 位置 / 服务 | 条目或依赖 | 用途 |
|---|---|---|
| `settings.plugin.item` | `dsh-desktop-ui-config`, order 100 | 视觉增强五键配置卡片 |
| `conversation.session.header.utilities` | `open-workspace`, order 20 | 打开当前工作区 |
| `conversation.session.header.utilities` | `dsh-desktop-ui-session-log-download`, order 30 | 导出当前 Session |
| `sessionLogDownload` | `ctx.get()` | 导出状态、下载和关闭对话框 |
| `workspaces` / `sessions` | `ctx.get()` | 解析当前工作区并调用官方打开服务 |
| `@deepseek-ai/dsh-client-ui-primitives` | `Modal`、`Button`、官方图标 | 导出对话框和按钮 |

### 2.1 集成机制说明

配置卡片和头部按钮使用官方 slot；配置卡片和导出对话框复用官方 primitives。设置抽屉、统计栏、聊天微调和官方导出按钮兼容处理没有对应的官方视觉 slot，因此集中在 client bundle 的样式区域中处理。功能 CSS 随开关安装和移除；`sessionLogExport` 关闭时官方导出按钮隐藏 CSS 也会移除。

### 2.2 DOM / 服务依赖清单

| 依赖 | 用途 | 失效后果 |
|---|---|---|
| `div[role="presentation"] > div[role="dialog"][aria-modal="true"][aria-labelledby]` | 设置抽屉 CSS 和关闭 shim | 抽屉退回默认或关闭动画失效 |
| Modal 的 mask/content/header 子节点 | 识别 mask、关闭按钮和 Escape 关闭路径 | 关闭 shim 降级或失效 |
| `[data-slot="conversation.session.header"]` 的 header 子结构 | 将 utilities 放到页签行右端 | 按钮位置恢复默认 |
| `[data-slot="conversation.composer.dock"]` | 统计栏整宽样式 | 统计栏样式失效 |
| `[data-variant="think"]`、`[data-chat-flow]` | 思考文案和历史提示样式 | chatPolish 样式失效 |
| 官方 `sessionLogDownload`、`workspaces`、`sessions` | 导出和工作区行为 | 对应入口安全降级 |

## 3. 宿主 API 契约

| 路由 | 方法 | 请求 | 成功响应 | 错误响应 |
|---|---|---|---|---|
| `/api/desktop-ui/config` | GET | 无 | 当前五键有效配置 | 读取异常回退默认并记录 warning |
| `/api/desktop-ui/config` | HEAD | 无 | 与 GET 相同响应头、无 body | 同 GET |
| `/api/desktop-ui/config` | POST | JSON boolean 子集 | `{ ok: true, config }` | 400 / 413 / 415 / 500 |

语义要点：默认值 ← patch 层 ← `desktop-ui.json`；POST 是部分 merge；未知或非 boolean 字段被忽略；空补丁返回 `400 no-boolean-fields`；非 JSON 返回 `415 content-type-must-be-application-json`；超过 64KiB 返回 `413 body-too-large`；写入失败返回 `500 config-write-failed`；其他方法返回 405。JSON 响应包含 `x-content-type-options: nosniff`。

## 4. 安全模型

本插件没有工作区文件访问、系统命令执行或外部路径读取路由，因此不适用 cwd 白名单和 spawn 安全模型。配置 API 只处理受白名单限制的 boolean 配置项，限制请求体大小，使用 `application/json` 校验，配置文件写入使用唯一临时文件、fsync、rename，并在异常时清理临时文件。缺失配置回退默认；权限或其他 I/O 错误记录 warning 并回退读取结果。

## 5. 客户端行为契约

- 启动先按五项全开安装，配置到达后 dispose 旧功能并按真实配置重装。
- 配置读取失败时启动回退全开；设置卡片显示读取错误，不伪装为成功配置。
- 关闭开关会移除对应 slot、事件监听和功能 CSS；配置卡片始终保留。
- Escape、mask、关闭按钮均通过关闭 shim 完成动画后重放官方关闭事件；Escape 使用 `KeyboardEvent` 路径。
- `openWorkspace` 在服务缺失、路径为空或桥接失败时安全返回，不抛出未处理异常。
- 配置保存成功后刷新页面，使所有仅在 apply 时读取配置的功能统一收敛。

## 6. 解析 / 渲染契约

本插件不解析用户文件、Markdown、diff 或外部数据；渲染内容为 React slot 组件和 CSS。导出对话框使用官方 `Modal` / `Button` primitives；用户可见文案全部来自 `desktop-ui` 命名空间的 zh/en 双语词典。

## 7. 已知缺陷与风险

> 状态：🟡 功能级（已确认未修）/ 🔵 卫生级或升级风险。

### 7.1 🔵 官方 DOM/CSS 兼容层升级风险

抽屉、统计栏和聊天微调仍依赖官方 DOM 属性、子节点结构及部分 CSS-module 后缀，并使用必要的样式优先级覆盖。官方 Web UI 重构可能导致样式静默失效。修复方向：推动官方提供对应视觉 slot；每次 DSH 升级执行第 10 节清单。

### 7.2 🔵 配置卡片样式重复

视觉增强卡片与功能增强聚合卡片存在同构样式源，后续视觉调整可能漂移。修复方向：抽取共享 UI kit。

### 7.3 🔵 保存后整页刷新

保存配置会刷新页面，设置面板状态会丢失。当前各功能按 apply 时读取配置，刷新是统一收敛手段。修复方向：未来增加配置变更订阅，改为局部重应用。

## 8. 已修复缺陷

| 缺陷 | 修复 |
|---|---|
| host/client 五键不同步 | host 补齐五键并扩展白名单，新增五键持久化测试 |
| Escape 重放为错误事件 | 明确使用 `playClose(panel, event, "keydown")` |
| 关闭导出开关仍隐藏官方按钮 | 隐藏 CSS 随 `sessionLogExport` 安装/移除 |
| 写入异常导致请求无响应 | 写入包在 try/catch 内，失败返回 500 |
| 超大请求体错误码不正确 | 超限返回 413；非 JSON 返回 415 |
| 常驻 CSS 缺少生命周期清理 | 保留配置卡片 disposer，并在 client 生命周期结束时清理 |
| 配置卡片无法显示读取错误 | 启动 fallback 与卡片读取行为分离 |
| 安装产物 client bundle 过期 | 重建 dist 并完成 source/dist SHA-256 校验 |

## 9. 加固建议

1. 推动官方增加设置抽屉、composer dock 和会话 header 的稳定视觉扩展点。
2. 将重复的配置卡片样式抽取到无开关的共享插件。
3. 为真实 Electron DOM、服务就绪和安装版 dist 增加 smoke test。
4. 将配置保存从整页刷新逐步迁移为配置变更订阅和局部重应用。

## 10. 维护与升级检查清单

- [ ] `settings.plugin.item`、`conversation.session.header.utilities` slot 仍存在，id/order 未冲突。
- [ ] `sessionLogDownload`、`workspaces`、`sessions` 服务签名和快照结构未变。
- [ ] Modal selector、mask/content/header/closeButton 结构未变。
- [ ] `[data-slot="conversation.session.header"]` header 子结构未变。
- [ ] `conversation.composer.dock`、`[data-variant="think"]`、`[data-chat-flow]` 仍存在。
- [ ] 五个开关分别关闭、保存、刷新后仍然生效。
- [ ] sessionLogExport 关闭时官方导出按钮恢复。
- [ ] Escape、mask、关闭按钮三种设置关闭路径均可用。
- [ ] GET/HEAD/POST、400/413/415/500 错误语义回归通过。
- [ ] `npm test` 全绿；`npm run dist:offline` 成功；源码与 dist client/host 文件 hash 一致。
