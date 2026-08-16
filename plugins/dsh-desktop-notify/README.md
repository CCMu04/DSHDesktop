# dsh-desktop-notify

「完成提醒」功能增强：回复完成或 AI 调起询问（工具审批 / 提问）、且应用窗口不在前台时，弹系统通知（Windows 右下角 toast）提醒；点击通知把窗口带回前台并跳转到对应会话。

- **判定**：与官方侧边栏 completed 提醒同一判定——订阅当前会话快照，按 **running `true→false` 边缘**识别回复完成；按 **pending（待回应交互）空→非空边缘**识别 AI 调起询问；
- **焦点**：`document.hasFocus()` 实时判定（覆盖失焦/最小化），异常回退 focus/blur 事件驱动值；
- **耦合面**：纯服务订阅（`sessions`）+ HTML5 Notification——**9 个桌面插件中耦合面最小**，无 DOM 注入、无官方 DOM 依赖、无插槽渲染；
- **开关**：`desktop.features.item`（「功能增强」卡片）持久化于 host。

---

## 目录

1. [架构总览](#1-架构总览)
2. [判定契约（边缘检测）](#2-判定契约边缘检测)
3. [通知内容契约](#3-通知内容契约)
4. [点击通知的行为契约](#4-点击通知的行为契约)
5. [宿主 API 契约](#5-宿主-api-契约)
6. [已知缺陷与风险](#6-已知缺陷与风险)
7. [已修复缺陷](#7-已修复缺陷)
8. [加固建议](#8-加固建议)
9. [维护与升级检查清单](#9-维护与升级检查清单)

---

## 1. 架构总览

```
┌────────────────────────────── 桌面壳 ──────────────────────────────┐
│                                                                    │
│  host 半区（lib/index.js，149 行）                                   │
│    └─ /api/desktop-notify/config  开关 GET/HEAD/POST                │
│       （持久化：~/.dsh/desktop-notify.json，原子写入）               │
│                                                                    │
│  client 半区（lib/client.js，~420 行）                               │
│    ├─ desktop.features.item 条目（id "notify", order 40）— 开关      │
│    ├─ installCompletionNotify：订阅 sessions.list + 当前会话快照     │
│    │    ├─ running 边缘 → 完成通知                                  │
│    │    ├─ pending 边缘 → 审批/提问通知                             │
│    │    └─ document.hasFocus() 判定窗口前台                          │
│    └─ 系统通知：new Notification + onclick（唤醒 + 跳会话）           │
│                                                                    │
│  桥接：点击通知 → console.log("__DSH_DESKTOP_WAKE__:<sessionId>")    │
│        （主进程 main.mjs 监听后 restore+show+focus 窗口）            │
└────────────────────────────────────────────────────────────────────┘
```

依赖注入：client `slots`、`locale`；host `webServer`。

---

## 2. 判定契约（边缘检测）

### 2.1 完成边缘（running `true→false`）

- 订阅当前会话快照（`sessions.binding(id).session.subscribe`），仅当 `prevRunning === true && running === false` 且窗口不在前台时提醒；
- **首次观察只记录基线不提醒**（`prevRunning === null` 分支）——加载时已在运行的会话也能捕获本次完成，但不会对加载前的状态误报；
- 会话切换时基线重置（每个会话独立判定）。

### 2.2 询问边缘（pending 空→非空）

`prevPendingCount === 0 && pending.length > 0` 且窗口不在前台 → 提醒（approval / question 两类，见[第 3 节](#3-通知内容契约)）。

### 2.3 会话跟随（关键细节）

只订阅**当前会话**（`sessions.list` 的 current）；列表快照会随会话活动（任务、摘要等）**频繁变化**——`attach` 仅在 current 变化时重建订阅，否则 running 基线会被反复重置成「首次观察」，完成边缘将永远被吞掉（注释记录了该坑）。

### 2.4 焦点判定

```
isWindowFocused() → document.hasFocus()（实时，覆盖失焦与最小化）
                  → 抛错时回退 focus/blur 事件驱动值
```

---

## 3. 通知内容契约

| 场景 | 标题 | 正文 |
|---|---|---|
| 回复完成（正常） | 「对话完成」 | 最后一条 assistant 消息的文本预览（多个 text 块合并，空白折叠，120 字符截断 + `…`） |
| 回复完成（空回复） | 同上 | 「回复已生成」 |
| 回复出错（turn-error） | 同上 | 「回复出错了」 |
| 工具审批（approval） | 「需要你的确认」 | `是否允许执行「{tool}」`（工具名 40 字符截断，未知 → 「工具」） |
| AI 提问（question） | 「需要你的回应」 | 第一个问题的文本预览（120 字符截断；无文本 → 「AI 正在等待你的回答」） |

- 正文预览 120 字符上限（`ddnPreviewLimit`），空白折叠；
- 多个待回应交互时只提醒第一个（`pending[0]`，少打扰设计）；
- 通知权限：Electron 默认自动批准；`permission === "default"` 时显式 `requestPermission()` 一次（防受限环境）。

---

## 4. 点击通知的行为契约

点击系统通知：

1. `window.focus()` 尝试带回前台（普通失焦场景）；
2. `console.log("__DSH_DESKTOP_WAKE__:<sessionId>")` ——**最小化时渲染进程 focus() 无法恢复窗口**，经 console-message 标记请求主进程 `restore + show + focus`（`main.mjs` 监听）；
3. `sessions.open(sessionId)` 显式跳回通知对应的会话——**通知发出后用户可能已切到别的会话，必须显式跳回**（注释明示）；会话已不存在等异常静默忽略。

---

## 5. 宿主 API 契约

### `GET|HEAD|POST /api/desktop-notify/config`

与其他 feature 插件同一约定：GET/HEAD 返回 `{enabled}`（`no-cache`）；POST 要求 boolean（否则 400 `enabled-must-be-boolean`）；其他方法 405；请求体 64KB 上限；原子写入；损坏文档回退 `{}`。

配置优先级：`默认值(true) ← 插件行 config ← ~/.dsh/desktop-notify.json`。

---

## 6. 已知缺陷与风险

> 状态：🔵 卫生级（边角，不影响主流程）。**本插件无功能级缺陷。**

1. **🔵 通知权限被拒时无任何提示**：`new Notification` 抛错被静默吞掉（`catch { return; }`）——用户拒绝权限后以为功能坏了，但没有任何反馈渠道（本插件无 toast 设施）。可接受（通知是增值功能），但调试时易困惑。
2. **🔵 多个待回应交互只提醒第一个**（`pending[0]`）：同时挂起多个审批/提问时只通知最早的一个——少打扰设计，信息不完整。
3. **🔵 高频完成无合并**：连续多个回合快速完成时逐条弹通知（完成边缘本身低频，实际影响小）。
4. **🔵 唤醒标记依赖主进程 console-message 监听**：`__DSH_DESKTOP_WAKE__` 通道在 `main.mjs` 侧是隐式契约（与 updates 的 `__DSH_DESKTOP_UPDATE__` 同机制）——主进程改动监听逻辑会静默失效。

---

## 7. 已修复缺陷

| 缺陷 | 修复 |
|---|---|
| **binding 未就绪时永久漏订阅（边缘时序 bug）**：`attach` 中 `sessions.binding(id)` 返回 undefined 时提前 return，但 `currentId` 已设置为该 id——下次列表通知因 `id === currentId` 直接返回，该会话**永远不会被订阅**（直到切换会话） | binding 未就绪时把 `currentId` 重置为 null，等下一次列表通知重试（附注释说明）。正常路径零变化，仅在罕见时序改变行为 |

> **已回退的尝试**：曾将 turn-error 检测从"只看最后一个节点"改为"从后往前扫描（turn-error 优先）"——因无法确认 DSH 节点流中 turn-error 是否可能出现在最终成功的回合里（存在误报"回复出错了"的风险），已恢复原实现。若未来确认节点语义（错误回合是否总以 turn-tail 收尾），可重新评估。

---

## 8. 加固建议

1. **权限拒绝反馈**：`new Notification` 抛错时 `console.warn` +（若未来有 toast 共享设施）提示"通知权限被拒绝"。
2. **pending 通知合并**：多个待回应交互时正文汇总（"3 项等待处理"），而非只提醒第一个。
3. **唤醒标记契约化**：把 `__DSH_DESKTOP_WAKE__` / `__DSH_DESKTOP_UPDATE__` 等 console 标记通道整理成桌面壳共享常量模块（当前散布在各插件与 main.mjs 之间，隐式字符串契约）。
4. **会话绑定重试**：binding 未就绪场景除列表通知外，可加定时重试（当前依赖下一次列表通知，实际总会到来，风险低）。

---

## 9. 维护与升级检查清单

- [ ] `sessions.list` / `sessions.binding(id).session` / `sessions.open` 签名未变（核心依赖）
- [ ] ConversationSnapshot 的 `running` / `pending` / `nodes` 字段结构未变（判定与预览）
- [ ] pending 交互的 `payload.toolName` / `payload.questions[].question` 字段未变（通知内容）
- [ ] `desktop.features.item` 插槽声明未变（features 插件侧）
- [ ] 主进程 `__DSH_DESKTOP_WAKE__` console-message 监听仍在（点击通知恢复窗口）
- [ ] 实测回归：失焦完成弹通知、最小化完成弹通知、审批/提问弹通知、点击通知回前台+跳会话、前台时完成不弹、开关关闭后不弹
