# dsh-desktop-git

工作台 Git 面板：在工作台列注册「Git」功能页签——仓库状态（分支 + 暂存区/工作区文件列表）、VSCode 式 unified diff 视图（双行号 gutter + 增删高亮）、暂存 / 取消暂存 / 还原 / 提交（Ctrl+Enter）、提交历史。

- **定位**：**纯本地 Git 操作**。host 端明确"绝不设置身份（user.name/email 交给用户环境），无 push/pull/fetch，只暴露本地操作"——状态、diff、历史、暂存、提交、还原。
- **框架**：消费 `desktop.workbench` 服务（`registerTab`），无 DOM 注入；官方插槽只用了 `desktop.features.item` 开关。
- **数据流**：全部经 host 端 `/api/desktop-git/*` 接口（git CLI 代理，会话 cwd 白名单校验）；无文件 watcher，手动刷新（与 files 同款设计）。

> 质量结论：与 `dsh-desktop-files` 同级的实现——安全模型扎实、操作面克制、客户端状态机干净（repo 切换防误操作、选中项失效清理）。**无功能级缺陷**；本次已修复 7 项卫生/性能级问题（见[第 8 节](#8-已修复缺陷)）。

---

## 目录

1. [架构总览](#1-架构总览)
2. [与官方 DSH 的集成方式](#2-与官方-dsh-的集成方式)
3. [宿主 API 契约](#3-宿主-api-契约)
4. [安全模型](#4-安全模型)
5. [客户端行为契约](#5-客户端行为契约)
6. [diff / status / log 解析契约](#6-diff--status--log-解析契约)
7. [已知缺陷与风险](#7-已知缺陷与风险)
8. [已修复缺陷](#8-已修复缺陷)
9. [加固建议](#9-加固建议)
10. [维护与升级检查清单](#10-维护与升级检查清单)

---

## 1. 架构总览

```
┌────────────────────────────── 桌面壳 ──────────────────────────────┐
│                                                                    │
│  host 半区（lib/index.js，~700 行）—— 纯 git CLI 代理                │
│    ├─ /api/desktop-git/config   开关（exact）                       │
│    ├─ /api/desktop-git/repos    GET cwd 内仓库扫描（prefix，异步）   │
│    ├─ /api/desktop-git/status   GET 仓库状态（prefix）               │
│    ├─ /api/desktop-git/diff     GET unified diff（prefix）           │
│    ├─ /api/desktop-git/log      GET 提交历史（prefix）               │
│    ├─ /api/desktop-git/stage     POST git add（exact）              │
│    ├─ /api/desktop-git/unstage   POST git restore --staged（exact） │
│    ├─ /api/desktop-git/commit    POST git commit -m（exact）        │
│    └─ /api/desktop-git/restore   POST git restore（exact）          │
│    安全：session→cwd realpath 白名单 + spawn 参数数组无 shell        │
│                                                                    │
│  client 半区（lib/client.js，~1440 行）                              │
│    ├─ desktop.features.item 条目（id "git", order 30）— 开关        │
│    ├─ desktop.workbench 服务：registerTab("git", order 30)          │
│    ├─ ddgitStore（模块级：sessionId / cwd，幂等更新）                │
│    └─ GitPanel：仓库选择 + 文件列表分组 + diff + 提交区 + 历史        │
│                                                                    │
│  持久化：prefs（git.listWidth / git.historyHeight）+ layout（repo）  │
│          都走 workbench 宿主端点（白名单/merge 语义）               │
└────────────────────────────────────────────────────────────────────┘
```

依赖注入：client `slots`、`locale`；host `webServer`、`sessions`。

---

## 2. 与官方 DSH 的集成方式

| 位置 | 说明 |
|---|---|
| `desktop.features.item`（id `"git"`, order 30） | 「功能增强」开关（数据接口，组件 `() => null`） |
| `desktop.workbench` 服务（`registerTab`） | 注册「Git」功能页签（order 30，files 之后） |
| `/api/desktop-workbench/prefs` | 分栏尺寸持久化：`git.listWidth`（140–420）、`git.historyHeight`（64–320）——与 workbench `PREFS_SCHEMA` 白名单一致 |
| `/api/desktop-workbench/layout` | **仓库选择 per-session 持久化**：只写 `repo` 字段（host merge 语义，不覆盖框架/其他插件的布局字段）；切换会话时校验"保存值在新 cwd 仓库列表中"才应用，否则回退会话根 |

要点：layout/prefs 依赖 workbench 的宿主路由，但 workbench 的路由**无条件注册**（`config.enabled` 只控制其 client 安装）——即使工作台总开关关闭，git 的持久化仍可用（正确依赖）。

---

## 3. 宿主 API 契约

| 路由 | 方法 | 请求 | 成功响应 | 说明 |
|---|---|---|---|---|
| `/config` | GET/HEAD/POST | POST `{enabled}` | `{enabled}` / `{ok:true}` | 通用开关约定 |
| `/repos` | GET/HEAD | `?session=` | `{repos:[相对路径]}` | cwd 内仓库扫描（深度 ≤3），`""` 表示会话根 |
| `/status` | GET/HEAD | `?session=&repo=` | `{repo:false}` 或 `{repo:true, branch, files}` | `repo` 缺省回退 `path`（向后兼容） |
| `/diff` | GET/HEAD | `?session=&path=&staged=0\|1&repo=` | `{binary:true}` 或 `{content, truncated}` | 单文件 diff，256KB 截断标记 |
| `/log` | GET/HEAD | `?session=&repo=&limit=` | `[{hash,short,author,date,subject}]` | limit 钳制 1–100，默认 20 |
| `/stage` | POST | `{session, path?, repo?}` | `{ok:true}` | 无 path → `add -A`（全部暂存） |
| `/unstage` | POST | `{session, path?, repo?}` | `{ok:true}` | 无 path → `reset`（仅动 index，安全） |
| `/commit` | POST | `{session, message, repo?}` | `{ok:true}` | message 非空、≤10000 字符（超限 413） |
| `/restore` | POST | `{session, path, repo?}` | `{ok:true}` | 丢弃工作区改动，**不可撤销** |

语义要点：

- git 命令统一 `runGit(cwd, args)`：`spawn("git", ["-c", "core.quotepath=false", ...args])`，无 shell、`windowsHide`、15s 超时 kill；git 未安装（ENOENT）→ `code: -2` + "git not found"；
- 写操作前置 `requireGitRepo`（rev-parse 校验，友好错误替代 git fatal）；非零退出 → 400 + stderr 原文（如「身份未配置」）；
- 全部路径经 `--` 分隔传入 git；`gitRelPath` 相对仓库根（空串 = 根）、分隔符归一为 `/`；
- 错误统一 `{ok:false, error}`：400/403/404/405/413/415/500 各归其位。

---

## 4. 安全模型

与 `dsh-desktop-files` 同一套设计（两插件共用模式）：

```
请求 → session → ctx.sessions.get(id).header.cwd（白名单根，取不到即 400）
     → resolveWithinCwd：pathResolve + realpathNearest + isWithin（realpath 前缀比较）
     → 符号链接逃逸 / 越界 → 403
     → git spawn 参数数组（无 shell），路径 "--" 分隔，杜绝注入
```

额外边界：

- **操作面克制**：无 push/pull/fetch、绝不写 user.name/email（提交身份失败时 stderr 原样透传，用户自行配置）；
- **commit 校验**：非空、≤10000 字符（413）；
- **diff 上限**：256KB 截断并标记（`truncated: true`），客户端显示"已截断"提示；
- **仓库扫描**：深度 ≤3 + 10 项跳过清单（node_modules/dist/build/out/.venv/venv/__pycache__/.next/.turbo/.pnpm-store/.git）+ 隐藏目录 + 进仓后不深入（嵌套仓库/子模块忽略）。

---

## 5. 客户端行为契约

### 5.1 状态机

| 状态 | 语义 |
|---|---|
| `status` | `{loading, repo, repoPath, branch, files, error}`——快照**绑定当前 repo** |
| `selected` | 选中文件 `{path, staged, untracked}`；刷新后文件消失则自动清空 |
| `diff` | `{loading, binary, content, truncated, error}`——选中项变化时重取（`current` 标志丢弃过期响应） |
| `log` | `{loading, entries, error}`——**失败保留旧条目并显示错误提示**（本次修复） |
| `busy` / `hint` | 操作封装防重入；hint 4s 自动消失（成功绿/失败红） |

### 5.2 关键行为

- **`runAction(label, action, after)`**：执行 → 成功提示 + `refresh()` + after → 失败提示 stderr 原文 → `finally` 解 busy——所有写操作（暂存/取消/还原/提交）统一走这条管道；
- **repo 切换防误操作**：`pickRepo` 时**立即清空旧列表**（`setStatus({loading, repo:false, repoPath:value, ...})`），快照绑定旧 repo 期间点击会被 `status.repoPath !== repo` 守卫拒绝；
- **会话切换**：重置选择、清空仓库列表、并行拉取 repos + 布局，恢复保存的仓库（校验存在于新 cwd 列表）；
- **提交**：Ctrl+Enter（或按钮）→ `runAction`；成功后清空 message 与选中项；
- **还原**：官方 `RiskConfirmation` 模态（勾选"我已了解此操作不可撤销"后才可确认）——本次由原生 `window.confirm` 替换；
- **刷新**：status 与 log **并行**拉取（本次修复），互不拖累。

### 5.3 分栏与持久化

- 文件列表宽度（默认 240，140–420）与历史区高度（默认 132，64–320）可拖拽（pointer capture），变更防抖 400ms 写 prefs；
- 仓库选择变化即写 layout（失败静默）；
- `ddgitStore` 幂等更新（sessions 高频通知不重发，与 files 同款防闪烁设计）。

---

## 6. diff / status / log 解析契约

| 解析 | 实现要点 |
|---|---|
| status | `git status --porcelain=v1 -z`（NUL 分隔，路径不转义）；`XY path` 前缀 3 字符；rename/copy（`x==="R"|"C"`）双字段（`i += 2`，新路径在下一字段）；`staged = x !== " " && x !== "?"`、`untracked = x === "?"` |
| diff | unified diff 文本解析：`@@ -a,b +c,d @@` 头重置双行号；`+`/`-`/上下文行各自递增；`\ No newline` 归为 meta；二进制检测（"Binary files " / "GIT binary patch"）；渲染为双 gutter 行号 + 内容行 |
| log | `--format=%H%x1f%h%x1f%an%x1f%ad%x1f%s%x1e`（`%x1f` 字段 / `%x1e` 记录分隔）；空仓库（"does not have any commits"）视为正常返回 `[]` |

渲染性能：diff 行启用 `content-visibility: auto` + `contain-intrinsic-size: auto 18px`（本次修复）——大 diff 渲染时不可见行由浏览器跳过，滚动条行为不变。

---

## 7. 已知缺陷与风险

> 状态：🔵 卫生级（不影响功能，本次未修）。**本插件无功能级缺陷**。

1. **🔵 diff 仍非完整虚拟化**：`content-visibility` 缓解了渲染成本，但 256KB 上限内的 diff 仍全量进入 DOM（数千行时 DOM 节点数可观）。完整虚拟化（如 react-window）收益有限、风险不小，暂缓。
2. **🔵 `status` 路由的 repo/path 双参数兼容逻辑**：`params.get("repo") ?? requested` 是向后兼容设计（旧客户端只传 path），语义混在一起可读性差，但行为正确（有注释）。
3. **🔵 `GitPanel` 单组件 ~750 行**：功能密度高，建议后续按"工具栏/文件列表/diff/历史"拆分子组件（重构风险大，暂缓）。
4. **🔵 commit 并发无宿主侧锁**：客户端 `busy` 防重入，但同一会话的两个页面（理论场景）可并发提交——桌面应用单页场景可接受。
5. **🔵 repos 扫描无结果缓存**：每次 GET 全量遍历（已异步化不阻塞事件循环，但大工作区仍有 IO 成本）；仓库列表极少变化，可加 TTL 缓存。

---

## 8. 已修复缺陷

| 缺陷 | 修复 |
|---|---|
| host 头注释路由清单与实现不符（漏 `/repos`、数量错误） | 头注释按实际 9 条路由重写 |
| `findGitRepos` 同步 `readdirSync` 递归——大工作区**阻塞 host 事件循环** | 改 `fs/promises.readdir` 异步串行遍历（行为一致：深度/跳过/进仓不深入） |
| log 加载失败**静默**（保留旧条目无任何提示） | 失败进入错误态：保留旧条目 + 渲染"历史读取失败 (原因)" |
| status 与 log 串行拉取（log 拖累 status 展示） | `Promise.all` 并行，各自错误态互不影响 |
| 还原用原生 `window.confirm`（与官方 UI 风格不一致） | 替换为官方 `RiskConfirmation` 模态（勾选不可撤销确认；词典补 `restoreAcknowledge`/`cancel`/`logFailed` 3 键 zh/en） |
| repo 菜单外点关闭用 `mousedown`（与 context-menu 的 `pointerdown` 惯例不一致） | 改 `pointerdown` |
| 大 diff 渲染无优化 | diff 行加 `content-visibility:auto` + `contain-intrinsic-size`（零逻辑风险） |

---

## 9. 加固建议

1. **repos 扫描加 TTL 缓存**（按 cwd 键，如 5s）：仓库列表极少变化，避免每次打开面板全量遍历。
2. **status 双参数逻辑收敛**：若无需兼容旧客户端，删掉 `?? requested` 回退，语义单一。
3. **拆分 GitPanel**：工具栏/列表/diff/提交/历史五个子组件，状态经 props 或 reducer 传递。
4. **diff 虚拟化**：若未来 diff 上限提高或用户反馈大 diff 卡顿，再引入行级虚拟化。
5. **commit 增加"暂存区为空"提示**：提交空暂存区时 git 报 "nothing to commit"，stderr 已透传；可在客户端预检 `stagedFiles.length === 0` 时禁用提交按钮（当前仅靠 busy/message 空判断）。

---

## 10. 维护与升级检查清单

- [ ] `desktop.workbench` 服务签名未变（`registerTab`）
- [ ] `ctx.sessions.get(sessionId).header.cwd` 结构未变（host 白名单根）
- [ ] `webServer.register` 的 `exact`/`prefix` 语义未变
- [ ] workbench `/prefs` 的 `PREFS_SCHEMA` 未变（`git.listWidth` / `git.historyHeight` 键）
- [ ] workbench `/layout` 的 `repo` 字段 merge 语义未变
- [ ] 官方 `RiskConfirmation` / `Modal` 组件导出与 props 未变（还原确认依赖）
- [ ] 实测回归：状态/暂存/取消暂存/提交（Ctrl+Enter）/还原（含确认勾选）/历史/仓库切换（多仓库工作区）/会话切换恢复仓库选择/分栏拖拽与偏好恢复/大 diff 渲染
