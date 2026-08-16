# dsh-desktop-files

文件工作台：在工作台列注册「文件」功能页签——目录树 + 文件子页签分页预览（图片 / 视频 / 音频 / Markdown / PDF / 代码高亮），并拦截官方 `ctx.workspaces.openPath`（对话里点文件链接 → 在文件页签内预览）。

- **框架**：消费 `desktop.workbench` 服务（`registerTab`），不做任何 DOM 注入，不碰官方插槽渲染位（官方插槽只用了 `desktop.features.item` 开关）。
- **数据流**：目录树 / 文本 / 媒体全部经 host 端 `/api/desktop-files/*` 接口，**host 按会话 cwd 白名单校验路径**（client 只负责 UI 与请求拼接）。
- **安全模型**：这是本插件最重要的设计资产——cwd 白名单 + realpath 防符号链接逃逸 + 扩展名/大小白名单（见[第 4 节](#4-安全模型)）。

---

## 目录

1. [架构总览](#1-架构总览)
2. [与官方 DSH 的集成方式](#2-与官方-dsh-的集成方式)
3. [宿主 API 契约](#3-宿主-api-契约)
4. [安全模型](#4-安全模型)
5. [客户端数据模型与行为约定](#5-客户端数据模型与行为约定)
6. [Viewer 与目录树契约](#6-viewer-与目录树契约)
7. [已知缺陷与风险](#7-已知缺陷与风险)
8. [加固建议](#8-加固建议)
9. [维护与升级检查清单](#9-维护与升级检查清单)

---

## 1. 架构总览

```
┌────────────────────────────── 桌面壳 ──────────────────────────────┐
│                                                                    │
│  host 半区（lib/index.js，830 行）                                   │
│    ├─ /api/desktop-files/config         开关（exact）                │
│    ├─ /api/desktop-files/tree           GET 懒加载目录树（prefix）    │
│    ├─ /api/desktop-files/text           GET 读 / POST 原子写（prefix）│
│    ├─ /api/desktop-files/file           GET 媒体（Range 流式, prefix）│
│    ├─ /api/desktop-files/reveal         POST 资源管理器显示（exact）  │
│    └─ /api/desktop-files/open-external  POST 系统应用打开（exact）    │
│    安全：session→cwd 白名单 + realpath 防逃逸 + 白名单/上限           │
│                                                                    │
│  client 半区（lib/client.js，1702 行）                               │
│    ├─ desktop.features.item 条目（id "files", order 10）— 开关       │
│    ├─ desktop.workbench 服务：registerTab("files", order 10)         │
│    ├─ 拦截官方 workspaces.openPath（选择性：匹配预览器才接管）        │
│    ├─ 模块级 store ×3：ddffStore（会话/cwd）/ filesStore（子页签）     │
│    │    / treeStore（树展开+内容缓存）                               │
│    ├─ FilesPanel：文件子页签栏 + 预览区 + 目录树（可隐藏/调宽）        │
│    └─ 6 个内部 viewer：image / video / audio / markdown / pdf / code │
│                                                                    │
│  偏好：/api/desktop-workbench/prefs（与工作台同文档，host 白名单窄化） │
└────────────────────────────────────────────────────────────────────┘
```

依赖注入：client `slots`、`locale`；host `webServer`、`sessions`。

---

## 2. 与官方 DSH 的集成方式

| 位置 | 说明 |
|---|---|
| `desktop.features.item`（id `"files"`, order 10） | 「功能增强」开关（数据接口，组件 `() => null`） |
| `desktop.workbench` 服务（`registerTab`） | 注册「文件」功能页签（order 10，排 Git 前） |
| `ctx.workspaces.openPath`（猴子补丁） | 拦截官方唯一文件打开入口，见 2.1 |
| `/api/desktop-workbench/prefs` | 面板偏好持久化（树显隐/宽度/换行），见 2.2 |

### 2.1 openPath 选择性拦截

官方 `workspaces.openPath` 是"点击会话里的文件链接"（工具行路径 / 生成文件行 / 正文文件提及）的唯一入口。本插件**选择性拦截**：

- 路径解析为绝对路径（相对路径基于会话 cwd）→ 匹配内部 viewer → 命中：`filesStore.open` + `workbench.activateTab("files")`，在文件页签内分页预览；
- 目录 / 无预览器类型 → **放行官方实现**（`.call` 保留 `workspaces` 服务上下文；不劫持右键菜单「在资源管理器中打开」的目录调用）；
- dispose 时恢复原始方法。

### 2.2 偏好持久化

`files.treeCollapsed` / `files.treeWidth` / `files.wrapMode` 走 workbench 的 `/prefs` 接口（同一文档、同一白名单）。**不用 localStorage**：后端端口每次启动随机变化，web origin 随之变化，localStorage 跨重启失效。写入防抖 400ms。

---

## 3. 宿主 API 契约

### 路由总表

| 路由 | 方法 | 请求 | 成功响应 | 主要错误 |
|---|---|---|---|---|
| `/config` | GET/HEAD/POST | POST `{enabled}` | `{enabled}` / `{ok:true}` | 400/405 |
| `/tree` | GET/HEAD | `?session=&path=` | `{path, cwd, entries:[{name,type,size,mtime}]}` | 403/404/400/500 |
| `/text` | GET/HEAD/POST | POST `{session,path,content}` | `{path, content}` / `{ok,path,bytes}` | 403/404/413/415/400/500 |
| `/file` | GET/HEAD | `?session=&path=` | 媒体二进制（音视频 Range 206） | 403/404/413/415/400/500 |
| `/reveal` | POST | `{session,path}` | `{ok,path}` | 404/500/400 |
| `/open-external` | POST | `{session,path}` | `{ok,path}` | 404/500/400 |

### 语义要点

- **`/tree`**：懒加载单层；目录在前文件在后按名称排序；单层上限 1000 条目（超出截断）；忽略隐藏条目（`.` 开头）+ 22 项依赖/构建/缓存/IDE 目录。
- **`/text`**：扩展名白名单（`TEXT_EXTENSIONS`，含 `.gitignore`/`.env` 特例）+ 2MiB 上限；POST 原子写（临时文件 + rename），写入目标可不存在（`realpathNearest` 取最近存在祖先校验）。
- **`/file`**：媒体 MIME 白名单（`MEDIA_TYPES`，图片/PDF ≤10MiB 整读；音视频 Range 流式无大小上限，`parseRange` 支持 `bytes=start-end` 与 suffix `bytes=-n`）；`x-content-type-options: nosniff`。
- **`/reveal`** / **`/open-external`**：不设 cwd 白名单（无读写副作用，注释明示"非本工作区文件也能打开其目录"），但要求路径存在；`systemOpen` 500ms 节流防连点；Windows 用 `cmd /c start`（**实测结论：powershell Invoke-Item 从本宿主进程 spawn 不弹窗**），macOS `open -R` / `open`，Linux `xdg-open`。
- 通用：请求体 64KB 上限；错误统一 `{ok:false, error}`；`cache-control: no-cache`。

---

## 4. 安全模型

```
请求 → session 参数
     → ctx.sessions.get(sessionId).header.cwd   （白名单根目录，取不到即 400）
     → pathResolve(cwd, path)                    （拼接/归一化）
     → realpathNearest(abs)                      （写入目标可能不存在：取最近存在祖先）
     → isWithin(rootReal, targetReal)            （realpath 前缀比较，符号链接逃逸被拒 → 403）
     → 类型白名单 + 大小上限                      （415 / 413）
     → 读/写/流式响应
```

- **cwd 白名单**：每个请求强制 `session`，根目录来自**会话自己的 header.cwd**——跨会话无法读其他工作区（除非该会话 cwd 本就包含它）。
- **符号链接逃逸**：目标与根都用 `realpath` 比较（`isWithin` 前缀 + 分隔符），`..` / 链接跳出 cwd 一律 403。
- **类型白名单**：文本 `TEXT_EXTENSIONS`、媒体 `MEDIA_TYPES`，白名单外 415。
- **大小上限**：文本 2MiB、图片/PDF 10MiB、音视频流式无上限（只读流，不落盘）、目录单层 1000 条、请求体 64KB。
- **忽略清单**：`node_modules`/`.git`/`.hg`/`.svn`/`dist`/`build`/`out`/`.next`/`.nuxt`/`.cache`/`__pycache__`/`.venv`/`venv`/`.idea`/`.vscode`/`.turbo`/`.parcel-cache`/`.pytest_cache`/`coverage`/`target`/`.pnpm-store`/`.pnpm`/`.dsh` 等 22 项 + 所有隐藏条目。
- **输出**：`nosniff`；JSON 响应统一错误结构。

> 信任边界说明：`/open-external` 用 `cmd /c start` 打开任意**已存在**的文件（含 .exe，即执行）——由用户显式点击按钮触发，属可接受信任级别，但应知晓。

---

## 5. 客户端数据模型与行为约定

### 5.1 模块级 store ×3（跨挂载保留）

| store | 内容 | 关键行为 |
|---|---|---|
| `ddffStore` | 当前 `sessionId` / `cwd` | **幂等更新**：官方 sessions.list 在 AI 对话期间高频通知（投影/任务帧），current/cwd 未变不重发，否则目录树持续清空重载 |
| `filesStore` | 打开的文件子页签 `[{path, viewerId}]` + `active` | 同路径去重激活；上限 20，超限**替换最早打开**（FIFO）；关闭时激活邻居页签；关闭最后一个 → `workbench.collapse()` 折叠工作台 |
| `treeStore` | 目录展开状态 + 目录内容缓存 | 页签切换（文件↔Git）组件卸载重挂不丢状态；会话/cwd 变化时清空（不同项目不串扰） |

所有订阅器逐个 try/catch（单个订阅者崩溃不破坏 store）。

### 5.2 FilesPanel 行为

- **布局**：顶部文件子页签栏（横向滚动，滚轮转横向）+ 右侧目录树（默认 140px，范围 100–280 可拖拽，可隐藏）+ 左侧预览区（路径栏 + 预览）。
- **根目录不显示**：直接从 cwd 内容开始渲染；无 cwd / 无激活文件显示空态引导。
- **目录树**：懒加载单层；目录图标开/关即展开指示；点击目录展开/收起，点击文件打开子页签。
- **错误反馈**：reveal / open-external 失败短暂显示后自动消失（2.5s/4s）+ 防连点；目录加载失败显示致命错误态。
- **换行**：代码预览长行折行（`.ddff_previewWrap` 覆盖 ReadBlock 的 `white-space:pre`）。

### 5.3 偏好行为

`treeCollapsed` / `treeWidth` / `wrapMode`：挂载时异步加载（先默认值渲染，到达后收敛）；变更防抖 400ms 写回；组件卸载时清理定时器。

---

## 6. Viewer 与目录树契约

### 6.1 内部 viewer 注册表（`FILES_VIEWERS`，扩展名互斥，按 order 匹配）

| id | order | 扩展名 | 实现 |
|---|---|---|---|
| `files:image` | 10 | png/jpg/jpeg/gif/webp/svg/bmp/ico | 自绘：适应窗口 + 滚轮缩放（0.2–8×，中心为轴）+ 拖拽平移 + 双击复位 |
| `files:video` | 12 | mp4/m4v/webm/ogv/mov | 原生 `<video>`（host Range 流式，可拖进度） |
| `files:audio` | 13 | mp3/wav/ogg/m4a/aac/flac/opus | 原生 `<audio>` |
| `files:markdown` | 20 | md/markdown/mdx | **官方 `MarkdownText`**（GFM+数学+代码高亮） |
| `files:pdf` | 40 | pdf | Chromium 内置 PDF viewer（iframe） |
| `files:code` | 50 | 三十余种代码/文本扩展名 | **官方 `ReadBlock`**（read 工具同款：行号 gutter + shiki 高亮 + 语言标签 + 复制，`maxLines:1000` 折叠） |

关键点：**HTML 走代码视图**（行号 + 高亮），不做 iframe 渲染（避免执行/样式污染）；ReadBlock 的 css-module 类在发布物里被 stub，样式由 `.ddff_read` 补齐。

### 6.2 文件图标与语言映射

- 图标：`fileIconFor`（图片/视频/音频/Markdown/JSON/文本/代码/通用 8 类，lucide-static v1.31.0 内联，**不混用官方 primitives 图标**）；
- 语言：`CODE_LANG_BY_EXT` → shiki 标准名（未知扩展名 → undefined → 纯文本渲染）。

### 6.3 与 workbench 的 viewer 契约（**当前未接上**，见缺陷 7.1）

workbench 服务提供 `registerViewer({id, extensions, component})` 与 `openFile(path)`（按扩展名匹配注册表路由），但本插件**未使用**——viewer 全部留在内部表，`openFile` 通道被绕过。

---

## 7. 已知缺陷与风险

> 状态标注：🟡 已确认未修（功能级，用户决策暂不修复，因缺测试时间）；🔵 卫生级。

### 7.1 🟡 workbench `registerViewer` / `openFile` 契约未接上（架构级）

本插件只 `registerTab`，6 个 viewer 留在内部 `FILES_VIEWERS`；`workbench.openFile()` 的 viewer 注册表是空的（永远 viewerId null → 占位），"对话里点文件链接"走的是自己的 `matchViewerId` + `filesStore.open`，**完全绕过 workbench 的 openFile 通道**。两套匹配逻辑并存：将来若第二个插件注册 viewer，workbench.openFile 会路由到它，而本插件拦截的路径不会——行为分叉。修复方向：`registerViewer` 注册 6 个 viewer，拦截后统一调 `workbench.openFile(path)`。

### 7.2 🟡 与 dsh-desktop-context-menu 的真实功能冲突

目录树行右键 = 复制路径（React 冒泡阶段 `onContextMenu`），但 context-menu 插件在 **document capture 阶段**全局拦截 contextmenu 并 `stopImmediatePropagation`——冒泡阶段事件不会触发。**context-menu 启用时，目录树右键复制路径是死的**。修复方向：context-menu 的 capture 拦截改为"仅命中自身场景（输入框/工作区行/有选中内容）才拦截"，或本插件右键复制改走其他交互（如 toast 反馈菜单）。

### 7.3 🟡 `files.wrapMode` 偏好无法持久化

client 读写 `PREF_WRAP = "files.wrapMode"`（L227），但 workbench host 的 `PREFS_SCHEMA` 白名单只有 `files.treeCollapsed` / `files.treeWidth` / `git.listWidth` / `git.historyHeight`——**没有 `files.wrapMode`**。`narrowPrefs` 白名单外丢弃 → 自动换行偏好每次打开面板重置为 false。修复方向：workbench host 的 `PREFS_SCHEMA` 增加 `"files.wrapMode": { type: "boolean" }`。

### 7.4 🔵 5 处扩展名表重复维护

`DD_IMAGE_EXTS`（图标）、`CODE_LANG_BY_EXT`（语言）、`MEDIA_TYPES`（host MIME）、`TEXT_EXTENSIONS`（host 文本白名单）、`FILES_VIEWERS.extensions`（viewer 匹配）——新增一种文件类型需同步 5 处，漏一处即出现"能读不能看 / 图标不对"的隐性不一致。

### 7.5 🔵 2 处注释漂移

- host 头注释称"2 个 exact + 3 个 prefix"，实际注册 **6 条路由**（`open-external` 后来新增未更新注释）；
- client `revealInExplorer` 注释称 host "用官方同款命令（powershell Invoke-Item）"，host 实际用 **cmd /c start**（`systemOpen` 注释明确说实测 Invoke-Item 不弹窗才换）。

### 7.6 🔵 openPath 猴子补丁（已知风险）

运行时替换官方服务方法。选择性放行 + `.call` 保留 this + dispose 恢复都已处理，但若将来第二个插件也包装同一方法，包装链的恢复顺序敏感；官方若改为内部绑定引用调用，包装失效。

### 7.7 🔵 小问题

- 子页签超限淘汰是 FIFO（最早打开）而非 LRU（最久未用）；
- `FilesPanel` 单组件约 600 行（可读性/可维护性风险，功能密度高但建议拆分）；
- `open-external` 信任边界：`cmd /c start` 可启动任意已存在文件（含 .exe）——用户显式点击触发，可接受，但属已知信任面。

---

## 8. 加固建议

1. **接上 workbench viewer 契约**（7.1）：`registerViewer` 注册 6 个 viewer，openPath 拦截后统一 `workbench.openFile()`——消除双匹配分叉，也让其他插件可复用 files 的预览器。
2. **修 wrapMode 持久化**（7.3）：workbench host `PREFS_SCHEMA` 补一个 boolean 键，一行改动。
3. **协调右键冲突**（7.2）：两插件协商——context-menu 收窄 capture 拦截范围是更根本的修法（它本就应该只拦自己的场景）。
4. **扩展名表收敛**（7.4）：host 导出扩展名集（或共享常量模块），client 从 host 响应/单源派生；至少把 host 的 `TEXT_EXTENSIONS` 与 client 的 `CODE_LANG_BY_EXT` 对齐为同一来源。
5. **注释同步**（7.5）：路由清单与 systemOpen 通道描述按实现修正。
6. **目录树加防抖/取消**：快速连续展开大目录时 `loadingRef` 已做并发守卫，可进一步加请求序号丢弃过期响应。

---

## 9. 维护与升级检查清单

- [ ] `desktop.workbench` 服务签名未变（`registerTab` / `openFile` / `activateTab` / `collapse`）
- [ ] `ctx.workspaces.openPath` 签名未变（拦截点）
- [ ] `ctx.sessions.get(sessionId).header.cwd` 结构未变（host 白名单根）
- [ ] `webServer.register` 的 `exact`/`prefix` 语义未变
- [ ] workbench `/prefs` 接口与 `PREFS_SCHEMA` 白名单未变（若 7.3 已修，确认 `files.wrapMode` 生效）
- [ ] 官方 `MarkdownText` / `ReadBlock` 组件导出未变（预览器依赖）
- [ ] context-menu 插件若修改 capture 拦截逻辑，回归目录树右键复制路径
- [ ] 实测回归：目录树懒加载/展开、六类预览、文件子页签增删/上限、openPath 拦截（对话点文件）、reveal/open-external、树宽度拖拽与偏好恢复、换行开关
