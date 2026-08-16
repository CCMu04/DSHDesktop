# dsh-desktop-tray

托盘命令桥：把系统托盘菜单动作（新建任务 / 添加工作区）翻译成官方客户端服务调用。主进程（Electron shell）无法直接调用页面内的官方服务，因此通过 `executeJavaScript` 派发 `dsh-desktop-tray-command` 自定义事件，本插件监听该事件并调用官方 `workspaces` 服务。

- **9 个桌面插件中最小**（client 62 行 + host 17 行空壳），无官方插槽、无 DOM 注入、无 host 能力；
- **唯一带单元测试的插件**（`test/desktop-tray-client.test.mjs`，覆盖两条命令 + 未知命令 + disposer）；
- **失败静默有明确理由**（模块注释）："用户正在页面上时，官方入口仍在；托盘命令只是快捷键"。

---

## 目录

1. [架构总览](#1-架构总览)
2. [桥接契约](#2-桥接契约)
3. [命令契约](#3-命令契约)
4. [测试契约](#4-测试契约)
5. [已知缺陷与风险](#5-已知缺陷与风险)
6. [已修复缺陷](#6-已修复缺陷)
7. [加固建议](#7-加固建议)
8. [维护与升级检查清单](#8-维护与升级检查清单)

---

## 1. 架构总览

```
┌────────────────────────────── 桌面壳 ──────────────────────────────┐
│                                                                    │
│  主进程（main.mjs）                                                 │
│    ├─ 托盘菜单：新建任务 / 添加工作区 / 检查更新 / 关闭行为设置 / 退出 │
│    └─ sendTrayCommand(command)：                                   │
│         ├─ showMainWindow()          先带回前台（用户能看到结果）    │
│         ├─ isBackendUrl 守卫          只在官方后端页面派发            │
│         └─ executeJavaScript 派发     CustomEvent('dsh-desktop-     │
│            tray-command', {detail})   → 失败静默（catch 吞错）       │
│                                                                    │
│  插件 client（lib/client.js，~70 行）                                │
│    ├─ inject: ["workspaces"]                                       │
│    └─ 监听 dsh-desktop-tray-command：                              │
│         ├─ "new-session"    → workspaces.startSession()            │
│         └─ "add-workspace"  → pickDirectory() → create({path})      │
│              → startSession(workspace.workspaceId)                  │
│                                                                    │
│  host 半区（lib/index.js，17 行）：空壳（cordis 安装占位）            │
└────────────────────────────────────────────────────────────────────┘
```

---

## 2. 桥接契约

| 方向 | 通道 | 说明 |
|---|---|---|
| 主进程 → 页面 | `executeJavaScript("window.dispatchEvent(new CustomEvent('dsh-desktop-tray-command', { detail: <JSON 字符串> }))")` | 命令经 `JSON.stringify` 序列化注入——无注入面 |
| 页面 → 官方服务 | 插件 `apply(ctx)` 直接调用 `ctx.workspaces` | 主进程不接触官方服务，全部翻译在页面侧完成 |

要点：

- `sendTrayCommand` 先 `showMainWindow()` 再派发——用户能看到命令结果；
- `isBackendUrl(mainWindow.webContents.getURL())` 守卫——不在官方后端页面时直接返回，不执行；
- 命令事件名 `dsh-desktop-tray-command` 与命令字符串（`new-session` / `add-workspace`）是**主进程 ↔ 插件之间的隐式字符串契约**（见 5.2）。

---

## 3. 命令契约

| 命令 | 行为 | 与官方流程的关系 |
|---|---|---|
| `new-session` | `workspaces.startSession()`（沿用当前工作区新建任务） | 与官方「新会话」按钮同服务 |
| `add-workspace` | `pickDirectory()` → `create({path})` → `startSession(workspace.workspaceId)` | **与官方「添加工作区…」流程逐段一致**（取消返回 null 正确短路） |
| 其他 | 静默忽略 | 未知命令不产生任何调用 |

行为约定：

- 命令执行失败：`add-workspace` 链 `catch + console.warn`；`new-session` 经 `Promise.resolve` 包装后同样 `catch + console.warn`（**本次修复**，见[第 6 节](#6-已修复缺陷)）——不打扰用户（官方入口仍在）；
- 无防重：托盘快速连点会连续创建多个会话（用户主动操作，设计取舍）。

---

## 4. 测试契约

`test/desktop-tray-client.test.mjs`（node 冒烟测试，mock 浏览器环境 + cordis ctx）：

| 断言 | 验证点 |
|---|---|
| bundle 注册单一 loader 条目 + id + apply/inject 导出 | 打包结构契约 |
| `inject` 恰为 `["workspaces"]` | 依赖声明契约 |
| 派发 `new-session` → `startSession(undefined)` | 命令翻译 |
| 派发 `add-workspace` → `create('/tmp/picked-dir')` → `startSession('ws-1')` | 完整流程翻译（含 await 链） |
| 未知命令 → 零调用 | 忽略语义 |
| dispose() 后派发 → 零调用 | disposer 移除监听 |

运行：`node test/desktop-tray-client.test.mjs`。**修改本插件后必须跑该测试**。

---

## 5. 已知缺陷与风险

> 状态：🔵 卫生级（边角，不影响功能）。

1. **🔵 命令字符串是隐式契约**：`'new-session'` / `'add-workspace'` / 事件名在 `main.mjs`、插件 client、测试三处硬编码，无共享常量。桌面壳当前打包结构（client 为独立 bundle、主进程为独立 ESM）下收拢成本高——若未来引入共享包，应把事件名与命令常量集中定义。
2. **🔵 页面未就绪时序**：`executeJavaScript` 在页面加载中可能失败 → 命令静默丢失（窗口已带回前台，用户看到窗口但命令未执行）。修复方向：主进程监听 `did-finish-load` 后重发（改动主进程，风险大于收益，暂缓）。
3. **🔵 无防重**：托盘连点可连续创建多个会话/工作区——用户主动操作，可接受。
4. **🔵 host 空壳的取舍**：插件作为 cordis 插件需要 host 侧占位才能安装到 web profile——空壳是必要的，但容易让维护者误以为 host 缺失。

---

## 6. 已修复缺陷

| 缺陷 | 修复 |
|---|---|
| `new-session` 分支无错误处理：`workspaces.startSession()` 若返回失败 promise → **unhandled rejection**（与 `add-workspace` 分支有 catch 不对称） | `Promise.resolve(startSession())` 包装后 `.catch(console.warn)`——兼容同步 mock（测试）与异步官方服务两种返回，失败记录而非静默丢弃 |

---

## 7. 加固建议

1. **命令常量收拢**：若桌面壳引入共享模块（如 `desktop-shared/`），把 `dsh-desktop-tray-command` 事件名与 `new-session` / `add-workspace` 命令定义为共享导出，main.mjs / client / test 三处引用。
2. **页面未就绪重发**：主进程 `sendTrayCommand` 失败时（或页面 URL 尚非后端页时）挂起命令，`did-finish-load` 后重发一次。
3. **防重节流**：主进程侧对同一命令 1s 节流（连点只执行一次）。

---

## 8. 维护与升级检查清单

- [ ] `ctx.workspaces.startSession` / `pickDirectory` / `create` 签名未变（命令翻译依赖）
- [ ] `create` 返回形状含 `workspaceId`（add-workspace 流程依赖）
- [ ] 主进程 `sendTrayCommand` 的事件名与命令字符串未变（隐式契约）
- [ ] 修改插件后运行 `node test/desktop-tray-client.test.mjs`（全绿）
- [ ] 实测回归：托盘「新建任务」在页面加载完成/未完成两种时序下的行为、添加工作区完整流程、取消目录选择、窗口最小化时托盘命令带回前台
