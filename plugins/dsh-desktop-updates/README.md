# dsh-desktop-updates

「检查更新」功能增强：设置侧边栏「检查更新」分区（当前版本 / 系统 / 安装方式 + 手动检查按钮）、侧栏底部「更新」按钮（有新版本时显示）、更新弹窗（发现新版本 → 下载进度 → 重启安装）与便携版下载提示。

- **更新源**：GitHub Releases API（`CCMu04/DSHDesktop`，未认证，60 次/小时/IP）——带 **1 小时本地缓存**（host 持久化跨重启）与失败兜底；
- **安装方式三态**：installer 走 electron-updater（主进程下载/进度/重启安装），portable 退化为"打开下载页"，dev 不打扰；
- **开关**：`desktop.features.item`（「功能增强」卡片）持久化于 host。

> 质量结论：架构决策大多有实证注释（React 事件委托不可用、API 配额策略、缓存兜底、三态安装）——9 个桌面插件中**决策依据最充分**的一个。有一处反馈误导缺陷（缓存兜底掩盖检查失败，见[7.1](#71--功能级检查失败被缓存兜底掩盖)）未修，卫生级问题本次已修 4 项（见[第 8 节](#8-已修复缺陷)）。

---

## 目录

1. [架构总览](#1-架构总览)
2. [与官方 DSH 的集成方式](#2-与官方-dsh-的集成方式)
3. [更新流程状态机](#3-更新流程状态机)
4. [宿主 API 契约](#4-宿主-api-契约)
5. [缓存与配额策略](#5-缓存与配额策略)
6. [安全与渲染契约](#6-安全与渲染契约)
7. [已知缺陷与风险](#7-已知缺陷与风险)
8. [已修复缺陷](#8-已修复缺陷)
9. [加固建议](#9-加固建议)
10. [维护与升级检查清单](#10-维护与升级检查清单)

---

## 1. 架构总览

```
┌────────────────────────────── 桌面壳 ──────────────────────────────┐
│                                                                    │
│  host 半区（lib/index.js，354 行）                                   │
│    ├─ /api/desktop-updates/config       开关（GET/HEAD/POST）        │
│    ├─ /api/desktop-updates/version      当前版本/系统/安装方式/       │
│    │                                    dismissedVersion（代读）     │
│    └─ /api/desktop-updates/latest-cache 最新版本缓存读写（白名单收窄）│
│    版本号来自构建注入 version.json（scripts/write-plugin-version.mjs）│
│                                                                    │
│  client 半区（lib/client.js，~1200 行）                              │
│    ├─ desktop.features.item 条目（id "updates", order 10）— 开关     │
│    ├─ settings.section 条目（id "updates", order 100）→ 设置分区      │
│    ├─ sidebar.footer.action 条目（id "updates", order 10）→ 更新按钮  │
│    ├─ 更新状态机（模块级 store + 快照订阅）                           │
│    ├─ 原生 DOM 更新弹窗（mountNativeDialog，随开关安装）              │
│    ├─ 主进程事件监听（dsh-desktop-update-event，无条件注册）          │
│    ├─ GitHub Releases 抓取 + 1h 本地缓存 + 失败兜底                  │
│    └─ 轻量 Markdown 渲染（发布说明，先转义后渲染）                    │
│                                                                    │
│  桥接：渲染→主进程 console.log("__DSH_DESKTOP_UPDATE__:start|dismiss|  │
│        quit-install")（与主题标记同通道）；主进程→页面 window 事件     │
└────────────────────────────────────────────────────────────────────┘
```

依赖注入：client `slots`、`locale`；host `webServer`。

---

## 2. 与官方 DSH 的集成方式

| 位置 | 条目 | 说明 |
|---|---|---|
| `desktop.features.item` | `id: "updates"`, order 10 | 「功能增强」开关（数据接口，`() => null`，always-on） |
| `settings.section` | `id: "updates"`, order 100 | 设置侧边栏「检查更新」分区（随开关安装/移除） |
| `sidebar.footer.action` | `id: "updates"`, order 10 | 侧栏底部「更新」按钮（**仅展开态 + 有新版本时**渲染） |

### 2.1 桥接通道

| 方向 | 通道 | 消息 |
|---|---|---|
| 渲染 → 主进程 | `console.log("__DSH_DESKTOP_UPDATE__:…")` | `start`（开始下载）/ `dismiss`（不再提醒）/ `quit-install`（重启安装） |
| 主进程 → 渲染 | window 事件 `dsh-desktop-update-event` | `update-available` / `download-progress` / `update-downloaded` / `update-pending` |

事件监听**无条件注册**（不随开关）：关闭开关期间主进程事件仍更新状态但无 UI 渲染；本次修复在关闭时重置状态，避免重开时弹出残留旧窗（见 8.3）。

---

## 3. 更新流程状态机

```
        （主进程事件 / 手动检查 / 启动刷新）
idle ────────────────────────────────► available ──► downloading ──► downloaded
  ▲                                      │              │               │
  └──────────────────────────────────────┴──────────────┴───────────────┘
                （关闭开关重置 / 无更新清除）
```

| 状态 | 触发 | UI |
|---|---|---|
| `available` | update-available 事件 / 手动检查命中 / 启动刷新命中 | 弹窗（安装版自动；便携版弹可点击下载提示）；侧栏按钮出现 |
| `downloading` | installer 点「立即更新」或主进程进度事件 | 弹窗变进度条（流动渐变 + 百分比 + 已下载/总大小） |
| `downloaded` | 主进程 update-downloaded | 弹窗变「立即重启安装 / 暂不」 |

**快照语义**：`setUpdateState` 发**新对象引用**——React `useState` 对同一引用会 bail-out（此前原地变更导致弹窗宿主永不刷新，注释记录了该坑）。

### 3.1 自动弹窗判定（安装版）

`refreshUpdateState` 发现新版本后，同时满足才弹窗：`installKind === "installer"`、未「不再提醒」（`dismissedVersion !== latest.tag_name`）、非下载/已下载阶段、当前无弹窗。**不依赖 electron-updater 的慢速检查**（页面侧自行比较版本号）。

### 3.2 状态清除守卫

无新版本时仅当 `knownTag === null || compareVersions(knownTag, latest.tag_name) < 0` 才清除按钮状态——避免主进程事件带来的新版本被过期缓存误清。

---

## 4. 宿主 API 契约

### `GET|HEAD|POST /api/desktop-updates/config`
通用开关约定：GET 返回 `{enabled}`；POST 要求 boolean，否则 400。

### `GET|HEAD /api/desktop-updates/version`
返回 `{ currentVersion, dshVersion, platform, arch, os, installKind, dismissedVersion }`：

- `currentVersion` / `dshVersion` 来自构建注入的 `version.json`（缺失 → null）；
- `os` 为展示名（Windows 按内核 build 映射：≥22000 → Win11，≥10240 → Win10）；
- `installKind` 推断链：`DSH_DESKTOP_INSTALL_KIND` 注入 → `PORTABLE_EXECUTABLE_DIR` → `HARNESS_DESKTOP_NODE` 含 `resources/runtime` → dev；
- `dismissedVersion` 由 host **代读**主进程写入的 `$DSH_HOME/desktop-update-prompt.json`。

### `GET|HEAD|POST /api/desktop-updates/latest-cache`
缓存读写：GET 返回缓存（缺失 → `{}`）；POST 白名单收窄后原子写（`tag_name`≤128、`html_url`≤512、`published_at`≤64、`body`≤16KB、`assets`≤32 个 × URL≤512；形状不符 → 400 `invalid-cache-entry`）。

持久化文件：`$DSH_HOME/desktop-updates.json`（开关）+ `desktop-updates-cache.json`（缓存），均原子写入、容错读取。

---

## 5. 缓存与配额策略

```
fetchLatestRelease():
  读缓存 → 未过期（<1h）→ 直接返回（不打 GitHub API）
        → 已过期/无缓存 → fetch GitHub Releases API（走系统代理）
              → 成功 → 精简字段 + 写缓存 + 返回
              → 失败 → 有旧缓存 → 返回旧缓存兜底
                      → 无缓存 → 返回 { error: "http-<status>" | "network" | "invalid" }
```

- 403/429 → 「GitHub 接口限流」专属文案；network → 「网络连接异常」文案；其余通用——用户得到可操作反馈；
- `pickAsset` 按安装方式挑资产：portable → 匹配 `/portable/i` 的 exe；installer → `/setup/i`；兜底任意 `.exe`；
- 启动刷新（`autoCheckOnLaunch`）：安装版只更新侧栏按钮（自动弹窗归主进程事件）；**便携版额外弹可点击下载提示（15s 自动消失）**，避免与安装版双重通知。

---

## 6. 安全与渲染契约

### 6.1 发布说明渲染（XSS 防护）

GitHub Release body 是**第三方内容**，渲染链路：

```
dduRenderMarkdown(source)
  → 每行 dduRenderInline：先 dduEscapeHtml（& < > " '）→ 再行内替换
      （行内代码 / 链接 / 加粗 / 斜体）
  → 链接只放行 /^https?:\/\//i，非法 URL 只留 label 不生成 <a>
  → 块级组装（标题 #~###### / 列表 / 分隔线 / 段落），输出 <ul>/<li>/<hN>/<hr>/<p>
  → notesEl.innerHTML（已转义，安全）
```

弹窗内链接点击 → `preventDefault` + `window.open`（系统浏览器），不拦截。

### 6.2 原生 DOM 弹窗（为什么不用 React）

注释实证："独立 React root 的事件委托在本环境不可用——原生探针证实点击落在容器上但不触发任何 React 处理器"。弹窗用原生 DOM + 原生事件监听（与 toast / 托盘同机制），随开关 `mountNativeDialog` 安装/卸载；Escape / mask 点击 / 关闭按钮三条关闭路径齐全；发布说明限高滚动；下载进度条按状态重绘。

### 6.3 轻量版本比较

`compareVersions`：剥离 `v` 前缀，按 `-`/`.` 分段；数字段数值比较、字母段字典序、缺段补 0。

---

## 7. 已知缺陷与风险

> 状态：🟡 功能级（已确认未修）/ 🔵 卫生级。

### 7.1 🟡 检查失败被缓存兜底掩盖（反馈误导）

`fetchLatestRelease` 失败时**有旧缓存就返回缓存**（而非 `{error}`）→ 手动检查时若缓存版本不比当前新 → 显示 **"已是最新版本"**，用户把网络失败当成检查成功。缓存兜底是降限流的设计，但 UI 未区分"实时结果"与"缓存结果"。修复方向：返回 `{ fromCache: true }` 标记，检查时提示"网络不可用，显示上次缓存结果"。

### 7.2 🔵 侧栏 foot 布局依赖 CSS-module hash 后缀

`body.ddu-update-available [class$="_footArea"]` 等 3 个选择器靠 `_footArea` / `_settingsArea` / `_footerActions` 类名后缀定位官方侧栏 foot 结构（更新按钮悬浮在设置按钮右侧）。官方类名一变即失效——失效时只退回默认布局（按钮独立成行），无破坏但视觉错位。

### 7.3 🔵 toast 独立实现（全插件第三份）

本插件自带轻量 toast（注释"复用 desktop-ui 的样式约定；本插件独立实现，避免跨包依赖"）——context-menu、updates 各一份近同实现，样式/行为漂移风险（已含本次的 `role="status"` 修复）。

### 7.4 🔵 关闭开关期间主进程事件仍在写入状态

事件监听无条件注册：关闭开关时 update-available 仍更新状态（无 UI）。本次已修"重开时残留弹窗"（applyConfig 重置），但"关闭期间收到事件 → 重开后立即弹窗"仍可能发生（新事件，语义上可接受）。

### 7.5 🔵 发布说明无"更新说明"标题与发布时间

弹窗直接渲染 markdown，未显示 `releasedAt`（发布时间）与「更新说明：」前缀（原词典键已删除，见 8.4）——信息完整度取舍。

---

## 8. 已修复缺陷

| 缺陷 | 修复 |
|---|---|
| 启动时 `/version` 重复请求（`UpdatesSection` 挂载 + `refreshUpdateState` 各 fetch 一次） | 共享 `fetchVersionInfo()`（模块级 promise 缓存，失败返回 null），两处共用 |
| toast（成功/失败/更新提示）无 `role`，屏幕阅读器不可感知 | `showToast` / `showUpdateToast` 均设 `role="status"` |
| 关闭开关后主进程事件残留状态：重新开启时 `mountNativeDialog` 立即按残留 `dialogOpen` 弹旧窗 | `applyConfig` 在关闭分支重置状态机（available/tag/latest/phase/percent/transferred/total/dialogOpen 全清） |
| 死词典键 `updates.releasedAt` / `updates.releaseNotes`（代码从未使用） | 删除（zh/en 各 27 键保持平衡） |

---

## 9. 加固建议

1. **缓存来源标记（修 7.1）**：`fetchLatestRelease` 返回 `fromCache` 标志，`check()` 命中缓存时提示"网络不可用，显示上次缓存结果（1 小时内）"，弹窗/按钮流程不变。
2. **hash 后缀选择器加固（7.2）**：给侧栏 foot 布局加 `data-slot` 优先选择器（`sidebar.footer.action` / `sidebar.settings` 出口），hash 后缀降级为兜底——与 statsLine 的"data-slot 主 + hash 兜底"模式对齐。
3. **toast 收敛**：与 context-menu 共用一份轻量 toast 实现（或抽到共享包），消除第三份拷贝。
4. **弹窗信息补全**：发布说明前加「更新说明：」标签行 + 发布时间（`published_at` 已缓存，词典键可恢复）。
5. **检查按钮的缓存态文案**：手动检查命中缓存且未过期时，按钮下方显示"来自缓存"小字，避免误判实时性。

---

## 10. 维护与升级检查清单

- [ ] `settings.section` / `sidebar.footer.action` / `desktop.features.item` 插槽仍存在（三处注册不炸）
- [ ] 官方侧栏 foot 区 CSS-module 类名后缀未变（`_footArea` / `_settingsArea` / `_footerActions`，更新按钮悬浮布局）
- [ ] 构建脚本仍生成 `version.json`（`scripts/write-plugin-version.mjs`）
- [ ] 主进程桥接通道未变（`console.log` 标记 + `dsh-desktop-update-event` 事件）
- [ ] 主进程 `desktop-update-prompt.json` 的 `dismissedVersion` 字段未变（host 代读）
- [ ] GitHub Releases API 响应形状未变（`tag_name` / `html_url` / `body` / `assets[].browser_download_url`）
- [ ] 实测回归：设置分区信息展示、手动检查（有更新/无更新/断网/限流四态）、安装版自动弹窗与"不再提醒"、下载进度、重启安装、便携版下载提示、侧栏按钮显隐与阶段文案、开关关闭后一切 UI 消失且重开无残留弹窗
