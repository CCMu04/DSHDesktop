# DSH 桌面插件开发规范

> 适用范围：`desktop-shell/plugins/` 下所有内置插件（`dsh-desktop-*`）。
> 本文档是插件开发、修改、排查与发布的**规范**——只写「应 / 不应 / 禁止」，不含任何插件的现状与实现细节（各插件现状见其自身 README）。
> 反例均为描述性写法（违规行为本身），不指向具体插件。

---

## 目录

1. [插件体系](#1-插件体系)
2. [插件声明](#2-插件声明packagejson--cordispatchyml)
3. [代码组织：子文件拆分 + 主文件聚合](#3-代码组织子文件拆分--主文件聚合)
4. [集成方式优先级（插槽优先序）](#4-集成方式优先级插槽优先序)
5. [UI / 布局复用](#5-ui--布局复用)
6. [host 端通用约定](#6-host-端通用约定)
7. [client 端通用约定](#7-client-端通用约定)
8. [配置契约同步](#8-配置契约同步)
9. [持久化契约](#9-持久化契约)
10. [测试与文档要求](#10-测试与文档要求)
11. [部署与生命周期](#11-部署与生命周期)
12. [构建与发布工作流](#12-构建与发布工作流)
13. [常见坑](#13-常见坑)

---

## 1. 插件体系

内置插件随安装包分发，应用启动时自动部署并注册进 Web Profile（`~/.dsh/profiles/web`），无需用户手动安装。每个插件是**独立目录**，携带两半：

| 半 | 文件 | 运行位置 | 职责 |
| --- | --- | --- | --- |
| host | `lib/index.js` | 后端 Node 进程（`dsh web`） | 开关持久化、提供 HTTP API |
| client | `lib/client.js` | 浏览器渲染进程（官方 Web UI） | 行为实现、UI 注入、开关读写 |

```
plugins/dsh-desktop-<name>/
├── package.json          # 包元数据 + dsh.bundle / dsh.client 声明
├── cordis.patch.yml      # 挂载行：把插件行插入 web profile
├── README.md             # 必备：架构 / 集成方式 / API 契约 / 缺陷 / 升级清单（见 §10）
└── lib/
    ├── index.js          # host 半
    └── client.js         # client 半（过大时按 §3 拆分子文件）
```

**插件分类**：功能增强（携带真实行为，每个功能独立成插件，开关进「功能增强」聚合卡片）、视觉增强（只改外观）、框架（承载服务与容器，其他插件依赖它）。

## 2. 插件声明（package.json + cordis.patch.yml）

```jsonc
{
  "name": "dsh-desktop-<name>",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "main": "./lib/index.js",
  "exports": {
    ".": "./lib/index.js",
    "./client": "./lib/client.js",
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./package.json": "./package.json"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-client-ui-primitives"
      ]
    }
  }
}
```

- `exports["./client"]` 指向浏览器 bundle；host 通过 `.` 解析；`dsh.client.inject` 声明 client 半**可 require 的官方 npm 包**（加载器提供 require 作用域）；
- 插件版本固定 `1.0.0`；升级判定靠**内容指纹**而非版本号（见 §11）；
- `cordis.patch.yml`：`- insert: [{ id: dsh-desktop-<name>, name: dsh-desktop-<name> }]`，id 与 `name` 一致；
- 注意区分两个「inject」：本节的 `dsh.client.inject` 是 **npm 包**声明；`client.js` 的 `exports.inject` 是 **cordis 服务**依赖（见 §7.1），后者只声明实际用到的服务——硬依赖语义下多余声明会无谓挂起插件。

## 3. 代码组织：子文件拆分 + 主文件聚合

**原则**：插件功能或代码过多时，按功能拆成子文件，由主文件聚合加载。

| 判定标准 | 说明 |
|---|---|
| 单文件 > 约 600 行 | 应拆分（超过即视为过载信号） |
| 功能域清晰可切分 | 如 diff 渲染、目录树、预览器、配置卡片、事件监听——各自独立成文件 |
| 有明显独立生命周期 | 如弹窗宿主、事件桥、状态机——应独立 |

**应**：按功能域拆分（如 `config.js` / `panel.js` / `viewers.js` / `dialog.js` / `locales.js` / `index.js`），主文件 `apply()` 聚合各模块安装函数；若沿用 `window.__ModuleLoader__` 单 bundle 结构，可用清晰的 `//#region` 分节替代物理拆分。

**不应**：为拆而拆——耦合紧密、单处使用的小工具留在原地。

## 4. 集成方式优先级（插槽优先序）

**原则**：与官方 UI 的接缝越「正规」越好。按以下优先级逐级降级，**只有上级全部不可行时才允许进入下一级**：

```
① 官方插槽（settings.plugin.item / conversation.session.header.utilities /
   sidebar.footer.action / shell.overlay / settings.section …）
   │  （官方插槽无法实现目标效果时 ↓）
② 自定义插槽（仿 desktop.features.item 模式：由聚合插件声明 children，
   功能插件注册条目 + inject 数据接口）
   │  （自定义插槽仍无法实现时 ↓）
③ 官方服务 / 组件复用（workspaces / sessions / primitives 组件）
   │  （以上全部无法实现时 ↓）
④ DOM 注入（最后手段，受 §4.3 约束）
```

### 4.1 各级正例

| 级 | 用法示例 |
|---|---|
| ① | 聚合卡片 → `settings.plugin.item`（keyed，key = 宿主登记的 settings 命名空间）；功能开关条目 → `desktop.features.item` 数据接口；会话头按钮 → `conversation.session.header.utilities`；整框浮层 → `shell.overlay`；设置页 → `settings.section` |
| ② | 聚合插件在注册条目的 `children` 声明子插槽，功能插件注册条目 + inject 数据接口 |
| ③ | 预览复用官方 `MarkdownText` / `ReadBlock`；确认对话框复用官方 `RiskConfirmation`；剪贴板用官方 `writeClipboard` |
| ④ | 不应出现正例——进入该级意味着前三级的约束已全部失败 |

### 4.2 禁止事项（硬性）

> 以下禁止项均针对**定位/覆盖官方 UI**；插件自己渲染的元素（自有前缀类名）不受此限（见 §7.6）。

- **禁止**用「不固定的类名」定位：CSS-module hash 类（`[class$="_footArea"]`、`[class*="thinkBody"]` 等）是构建产物，官方大更必然变化；
- **禁止**用 `!important` 覆盖官方组件样式；
- **禁止**依赖官方 DOM 结构定位（`[data-phase]` 根、`header > div:first-child`、Modal 的 role 层级）；
- **禁止**运行时替换官方服务方法（如包装 `workspaces.openPath` 改变其行为）；必须拦截时需在 README 登记并进升级清单。

### 4.3 「实在不行」分支（第 ④ 级约束）

若全部无法实现，允许最小化 DOM 干预，但必须同时满足：

1. **只依赖稳定属性**：优先用官方 `data-slot` 出口属性（插槽出口的 `data-slot` 是官方渲染机制的一部分，比类名稳定一个量级）；CSS-module 类名只作兜底且必须注释；
2. **集中封装**：所有 DOM 查询/样式写入收敛在单一模块（如 `attachToRoot`），禁止散落在组件里；
3. **契约检查 + 静默降级**：安装前校验依赖结构存在，不满足则打日志并降级（隐藏功能而非写坏布局）；
4. **README 登记**：在插件「DOM 契约」章节列出全部依赖，升级检查清单逐条打勾；
5. **升级即回归**：官方运行时大版本升级前按登记清单实测。

## 5. UI / 布局复用

**原则**：重复使用的布局或 UI 组件，**先查官方 primitives**（`@deepseek-ai/dsh-client-ui-primitives`：Button / Modal / RiskConfirmation / MarkdownText / ReadBlock / JsonBlock / Toast / 图标库等）；官方没有的，注册到**公用插件**上，公用插件**不设开关、默认必须启用**。

```
需要 UI 组件
  ├─ 官方 primitives 存在 → 直接复用（禁止自造同功能组件）
  ├─ 官方不存在
  │    ├─ 仅在单插件内使用 → 留在该插件私有
  │    └─ 多插件共用（或预判会共用）→ 注册到公用插件（如 dsh-desktop-ui-kit）
  │         ├─ 不设任何开关（默认启用、不可关闭）
  │         └─ 组件导出为独立模块，功能插件 import
```

**需要警惕的重复形态**（出现即应收敛到公用插件或官方组件）：同构样式表的多份拷贝（如两张同结构配置卡片各自带一份样式）、同一轻量组件（toast 等）的多份独立实现、跨插件共享的字符串常量（事件名、命令名、主进程标记）散落各处硬编码。

**公用插件约定**：不注册 `desktop.features.item` 条目、不提供 config 路由；代码按"必须存在"编写；保持轻量，只放确定复用的内容。

## 6. host 端通用约定

职责：开关持久化 + 提供 HTTP API。核心约定：

- 导出 `name`（与 patch 行 id 一致）、`inject = ["webServer"]`、`DEFAULT_CONFIG`、`apply(ctx, config)`；
- **宿主半可以 import 运行时提供的 `@deepseek-ai/*` 包**（如 `dsh-settings`、`schemastery`）：部署期 `main.mjs` 会把运行时的 `@deepseek-ai` 目录 junction 到 `builtin-plugins/node_modules/@deepseek-ai`（见 §11 步骤 0），插件裸导入即可命中运行时版本；**不应**在插件目录内自带 node_modules；
- **开关配置路由统一为**：`/api/desktop-<name>/config`，`kind: "exact"`，一个 handler 分发 GET/HEAD/POST（官方 `dsh-host-webserver` 拒绝重复 `(kind, path)` 注册）；**功能路由按需增加**（如目录树、文本读写、状态/diff 等功能路由），全部受 §6.1 安全基线约束，并在 README「宿主 API 契约」登记；
- **配置合并顺序**：内置默认值 ← 插件行 `config`（patch 层）← 用户开关文档，后覆盖前；
- 需在官方「插件设置」页出卡片的插件，宿主半**必须登记一个 settings 命名空间**（`@deepseek-ai/dsh-settings` 的 `settingsNamespace` + `installSettingsSection` 或 `ctx.settings.register`），否则 rc.7 起 keyed 的 `settings.plugin.item` 槽永远不调度该卡片（见 §7.4.1）；登记时若无自有编辑字段（聚合卡），schema 用空对象即可。
- 容错读取：文件缺失 / 损坏 → 空覆盖层（回退默认）；
- 请求体 64KB 上限；错误统一 `{ok:false, error}`，状态码语义完整（400/403/404/405/413/415/500）。

```js
export const name = "dsh-desktop-<name>";
export const inject = ["webServer"];
export const DEFAULT_CONFIG = Object.freeze({ enabled: true });

export function apply(ctx, config = {}) {
  const patchLayer =
    typeof config.enabled === "boolean" ? { enabled: config.enabled } : {};
  const resolve = () => ({ ...DEFAULT_CONFIG, ...patchLayer, ...readOverrides() });
  const route = {
    kind: "exact",
    path: "/api/desktop-<name>/config",
    handler: (req, res) => {
      // GET/HEAD → resolve()；POST {enabled} → 写入；其他 → 405
    },
  };
  ctx.effect(() => {
    const dispose = ctx.webServer.register(route);
    return () => dispose();
  }, "dsh-desktop-<name>: config route");
}
```

### 6.1 文件访问安全基线

任何读取/写入工作区文件的 host 路由，必须按会话 cwd 白名单校验：

- 请求强制携带 `session`，从 `ctx.sessions.get(id).header.cwd` 取白名单根；
- 目标路径 `resolve + realpath`（写入目标可能不存在 → 取最近存在祖先）后必须位于根内（前缀 + 分隔符比较），符号链接逃逸 → 403；
- 按内容类型设白名单与大小上限（文本 2MiB、媒体 10MiB、diff 256KB 等）；
- 返回 `x-content-type-options: nosniff`；
- 系统命令执行（spawn）一律参数数组无 shell，路径经 `--` 分隔；
- reveal / open-external 等"用户显式触发可放宽白名单"的接口，需在代码注释与 README 写明信任边界。

## 7. client 端通用约定

### 7.1 bundle 格式与入口

```js
window.__ModuleLoader__.load({
  id: "dsh-desktop-<name>",
  factory: (require) => {
    // ...实现...
    exports.apply = apply;
    exports.inject = inject; // 例如 ["slots", "locale"]（只用到的才声明）
    return module.exports;
  },
});
```

纯逻辑插件可不 require 任何包；需要 UI 时按需 require `react/jsx-runtime`、`react`、`@deepseek-ai/dsh-client-ui-primitives` 等。

```js
const NS = "desktop-<name>";
const inject = ["slots", "locale"];

function apply(ctx) {
  const t = ctx.locale.bind(NS);
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "…: dictionaries");
  // ...注册槽位 / 安装行为...
}
```

### 7.2 双语词典（硬性）

- 所有用户可见文案（菜单、toast、对话框、卡片、设置项）必须走 `t()`，zh/en 键集**逐键一致**；
- 动作时刻（事件回调内）的文案通过模块级绑定 `t` 或回调注入获取，禁止硬编码；
- 新增文案时词典键同步补 zh/en。

### 7.3 功能增强数据接口（desktop.features.item）

功能增强插件**不渲染自己的卡片**，只向聚合卡片注册数据接口：

```js
ctx.slots.inject("desktop.features.item", () =>
  ctx.slots.register(
    {
      name: "desktop.features.item",
      id: "<name>",          // 列表槽位必须提供 id
      order: 10,             // 卡片内排列顺序
      locale: NS,
      inject: () => ({
        load: () => loadConfig().then((c) => c.enabled),   // Promise<boolean>
        save: (enabled) => saveConfig({ enabled }),        // Promise<boolean>
        title: t("feature.title"),
        description: t("feature.description"),
      }),
    },
    () => null,              // 该槽位不渲染组件
  ),
);
```

契约：`{ load(): Promise<boolean>, save(enabled): Promise<boolean>, title: string, description: string }`。注册保持 always-on（开关永远可调），行为按配置安装/移除。

### 7.4 开关语义

- 功能开关关闭 = **该功能的全部痕迹移除**（含样式标签、事件监听、插槽条目）；
- 开关关闭**不得**隐藏官方替代入口（反例：无条件隐藏官方按钮，导致关开关后该功能整体消失——应随开关一起安装/移除）；
- 聚合类/框架类代码（公用插件、卡片壳、数据接口）**不设开关**；
- 启动收敛模式统一：先按默认（全开）安装 → 配置到达后 dispose 旧的并按真实配置重装；配置读取失败回退默认（全开），保证页面不因配置缺失缺功能：

```js
const installFeature = (config) => { /* 按配置安装，返回 disposer 数组 */ };
let active = [];
const applyConfig = (config) => {
  for (const dispose of active) dispose();
  active = installFeature(config);
};
applyConfig({ ...defaultConfig });                       // 先默认全开安装
void loadConfig().then((config) => applyConfig(config)); // 配置到达后收敛重装
```

### 7.4.1 设置卡片（settings.plugin.item）keyed 契约

官方 DSH ≥ 0.1.0-rc.7 起，`settings.plugin.item` 从 list 槽改为**按 settings 命名空间 keyed** 的槽（「插件可自行注册设置卡片」功能）。旧写法 `{ id, order, label }` 不再生效，**必须**按新契约迁移：

- **宿主半先登记命名空间**：用 `@deepseek-ai/dsh-settings` 的 `settingsNamespace("desktop-<name>")` + `installSettingsSection(ctx, ns, schema, entry, hooks)`（或 `ctx.settings.register(ns, schema, { base })`）把命名空间登记进设置存储。tab 只调度「宿主已 served 的命名空间 ∩ 注册了的卡片 key」；未登记的命名空间就算注册了卡片也**永远不渲染**。
- **client 卡片用 key 注册**，不再提供 `id`/`order`（keyed 槽按 priority 排序，id/order 忽略）：

```js
ctx.slots.inject("settings.plugin.item", () =>
  ctx.slots.register(
    {
      name: "settings.plugin.item",
      key: "desktop-<name>",   // 必须与宿主登记的命名空间一致
      id: "dsh-desktop-<name>", // 迁移桥：rc.6 list 契约校验需要 id（rc.7 忽略）
      locale: NS,
      // children / inject 等其余字段照旧
    },
    <CardComponent>,
  ),
);
```

> **双兼容迁移桥**：官方运行时尚未全线升到 rc.7 时（旧版安装包还在线），注册需
> **同时携带 `key` 与 `id`**——槽位校验按声明种类走：rc.6 声明 list 要求 `id`，
> rc.7 声明 keyed 要求 `key`；rc.7 的 keyed 渲染完全忽略多余的 `id`，带两个字段
> 在两个运行时都能注册并渲染。官方运行时全线 rc.7 后，`id` 可移除。

- 聚合类卡片（如「功能增强」分组板）不编辑自有字段：schema 用 `z.object({})`（`z` 来自 `@deepseek-ai/schemastery`）仅作配对 key；编辑类卡片（如配置卡）应让 schema 如实描述所编辑字段，值写入即进设置存储（`scope.update(patch)`），可保留 host 端点作为兼容/兜底。
- 依赖声明：宿主半新增 `@deepseek-ai/dsh-settings`、`@deepseek-ai/schemastery`（随桌面壳依赖安装，运行时由 DSH 运行时提供）；无 settings 服务的环境（单测桩）必须显式防护（`typeof ctx.inject === "function"` 守卫），退化为纯文件存储。
- 迁移检查清单：宿主命名空间存在 → client key 一致 → 设置页插件 tab 能看到卡片并正常读写。

### 7.5 服务访问与订阅

- 客户端服务经 `ctx.get(...)` 获取；未就绪时**延迟重试**（500ms × 20）而非直接放弃；
- 会话快照：`sessions.list`（`{ items, current }`）+ `sessions.binding(id).session`（`{ getSnapshot, subscribe }`）；**binding 未就绪时不得提前设置 currentId**（否则该会话永不订阅，直到切换会话）；
- 订阅**只在关键状态变化时重建**：列表快照随会话活动频繁变化，每次都重建会把状态基线重置（如 running 基线），吞掉完成边缘（true→false）；
- 完成/询问判定用**边缘检测**：首次观察只记录基线，之后状态翻转才触发动作。

### 7.6 样式注入

- CSS 以 `<style>` 标签注入 `document.head`，用 `data-plugin-css` 标记去重（重复注入返回 no-op disposer），`data-plugin` 必须写本插件名（归属错误会导致卸载清理漏删/误删样式）；
- 类名使用插件专属前缀（**仅限插件自有元素**——定位官方元素见 §4.2 禁止项），配色一律用官方 token（`--dsw-alias-*`、`--dsw-shadow-*`），圆角/字号对齐官方卡片；
- 功能 CSS 随功能开关安装/移除（disposer 由安装函数返回）。

## 8. 配置契约同步

**原则**：host/client 两侧的配置键集**必须逐键一致**，缺一不可。

- host 的 `DEFAULT_CONFIG` / `CONFIG_KEYS`（或白名单 schema）与 client 默认配置必须同步；
- 键集不同步的典型症状：client 能配置的键在 host 白名单之外——保存被 `narrowPatch` 丢弃、无法持久化、reload 后回退默认值，**设置页开关形同虚设**；偏好键不在 workbench prefs 白名单时同理（写入被静默丢弃）；
- 新增配置项 checklist：client 默认值 + host 默认值 + host 白名单 + 词典文案 + 卡片行序，五处同步。

## 9. 持久化契约

- 所有持久化走 **host 端点**（`$DSH_HOME/*.json`，原子写：临时文件 + rename，容错读损坏回退默认）；
- **禁止**用 localStorage（后端端口每次启动变化，web origin 随之变化，跨重启失效）；
- 偏好类数据若走 workbench 的 `/prefs`，必须先确认键已加入其白名单（见 §8）；
- 会话级状态（如仓库选择）走 workbench `/layout` 的 merge 语义字段，只写自己拥有的字段。

## 10. 测试与文档要求

### 10.1 测试

每个插件两个测试文件（`node --test`，`npm test` 运行全部）；**无 host 能力或 host 为空壳的插件可只写 client 测试**：

- `test/desktop-<name>-config.test.mjs`（host）：stub cordis ctx（`effect` + `webServer.register`），临时 `DSH_HOME`，真实 HTTP 服务验证 GET 默认值 / POST 持久化 / 非法输入 400 / 路由唯一性；
- `test/desktop-<name>-client.test.mjs`（client）：加载 bundle（`eval` 源码 + stub `window.__ModuleLoader__`），stub 浏览器环境后调用 `apply(ctx)`，断言注册与行为场景。

客户端测试 stub 清单：`window`（含 `addEventListener`）、`document`、`Notification`、`fetch`、`location`、`MutationObserver`、`ctx`（`locale` / `slots` / `effect` / `get`）、所需服务（如 `sessions.list` / `binding` 的可控桩）。**测试通过后新功能才能合入**。

> 补测优先级：涉及解析或状态机的逻辑优先补测试（如 diff / status 解析、版本比较、边缘检测）。

### 10.2 README

每个插件必须有 README（**固定格式见 [docs/PLUGIN-README-TEMPLATE.md](../docs/PLUGIN-README-TEMPLATE.md)**），至少包含：架构总览、与官方 DSH 的集成方式（插槽/服务/DOM 依赖清单）、宿主 API 契约、已知缺陷与风险（如实标注功能级/卫生级）、升级检查清单。README 中登记的任何 DOM/服务依赖，修改或升级时必须逐条核对。

## 11. 部署与生命周期

应用启动时（`main.mjs` → `prepareBundledPlugins`）：

0. **建立运行时依赖 junction**（`ensurePluginRuntimeExports`）：把运行时的 `@deepseek-ai` 目录 junction 到 `builtin-plugins/node_modules/@deepseek-ai`——插件物理位置在 builtin-plugins 下，Node 裸导入沿真实路径向上解析够不到运行时 node_modules，宿主半一旦 import `@deepseek-ai/*` 就会 `ERR_MODULE_NOT_FOUND`；运行时目录变化（升级）时自动重建。**目标路径注意**：运行时 `node_modules` 根 = `path.dirname(path.dirname(selectedRuntimeDirectory))`（`selectedRuntimeDirectory` 指向 `…/@deepseek-ai/dsh`，向上两级才是 node_modules 根），不要在它下面再拼 `node_modules`。**手动把插件拷进 builtin-plugins 调试宿主半的 `@deepseek-ai/*` 导入时，需确认该 junction 存在**（缺失时用 `New-Item -ItemType Junction` 重建）。
1. 扫描 `plugins/` 下所有 `dsh-desktop-*` 目录；
2. 对每个插件计算**内容指纹**（`version + 全文件 sha256`），与 `builtin-plugins.json`（`%APPDATA%\deepseek-harness-desktop\builtin-plugins.json`，按 DSH Home 键控）比对；
3. 指纹匹配 → 跳过（**用户已做的启停选择保持不变**）；指纹变化或首次 → 部署到 `builtin-plugins/<package>` 并注册：`dsh plugin --profile web add --offline link:<部署目录>`（幂等）。
4. **剪除不再分发的内置插件引用**（`pruneBundledPluginReferences`）：把 `~/.dsh/profiles/web/package.json` 中所有不在当前分发包集合内的 `dsh-desktop-*` 依赖与 bundles 行移除——插件从安装包移除后旧注册不会自动消失（profile 属用户数据、重装不清），残留的幽灵 link 会让后端启动失败；只动 `dsh-desktop-*`，不碰用户自建插件。

注册结果落在 `~/.dsh/profiles/web`；客户端 bundle 由后端以 `/plugins/<id>/client.js` 提供。

### 手动部署到已安装应用（开发验证）

```powershell
Copy-Item plugins\dsh-desktop-<name> "…\resources\plugins\" -Recurse -Force  # 复制到安装包 resources
# 完全退出并重启应用 → 自动部署 + 注册
```

> 新增插件时**不要**预写指纹标记（否则应用启动认为已处理而跳过注册）；已注册插件的内容更新可用临时脚本（`test/redeploy-*.mjs`，用后删除）。

### 未纳入安装包的插件（开发中）

开发中的插件（如 `dsh-desktop-browser`）可以保留在仓库 `plugins/` 下继续开发——`npm start` 开发模式仍会自动部署并注册它——但**默认不随安装包分发**：

- `package.json` → `build.extraResources` 的 `plugins` 条目带 `filter: ["**/*", "!dsh-desktop-browser/**"]`，打包时排除该目录；被排除后安装版应用不会部署该插件（无卡片、无功能）；
- 若插件带主进程模块（如 `browser-controller.mjs`），该模块仍须加入 `build.files` 打包（`main.mjs` 顶层 import 依赖它在安装包内存在），控制器实例化无副作用、命令无来源时不产生任何 UI；
- 转正式时：移除 filter 排除项 → 该插件随下一版安装包分发。

### 开发期快速同步（直接改 builtin-plugins，绕过打包）

```powershell
Copy-Item plugins\dsh-desktop-<name>\lib "$env:APPDATA\deepseek-harness-desktop\builtin-plugins\dsh-desktop-<name>\lib" -Recurse -Force
```

- `~/.dsh/profiles/web/node_modules/dsh-desktop-<name>` 是 **Junction**，指向 builtin-plugins（pnpm link 落地形态）——覆盖 `node_modules` 等于写进 builtin-plugins；
- **指纹过期无碍**：指纹只在应用更新/部署时用于决定是否从安装包拷贝，日常启动不校验；
- **新插件（从未部署过）**：`builtin-plugins\<name>` 尚不存在，必须拷**整个插件目录**（`package.json` + `lib` + `cordis.patch.yml`），并完成下方两步注册；只拷 `lib` 仅适用于已注册插件的增量更新；
- **快速起新插件（推荐）**：直接从仓库目录跑 `npm start`（dev 模式）——`prepareBundledPlugins` 会扫描 `plugins/` 并**自动部署 + 注册**新的 `dsh-desktop-*`（与打包安装同一套流程），零手工复制与改 profile；前置：完全退出已在运行的已安装应用（单实例锁）；
- **新插件只放目录不加载**：必须手动注册两步（`~/.dsh/profiles/web/package.json`）：`dependencies` 加 `link:` 条目 + `dsh.profile.bundles` 数组加插件名；
- **不要手改 `builtin-plugins.json`**：它是部署指纹清单，算错会触发异常覆盖；
- **重启后验证**：`/api/desktop-<name>/config` 200（host 已加载）+ `/plugins/<id>/client.js` 200（client 已注册）。

## 12. 构建与发布工作流

```powershell
npm run dist          # 构建（sync 官方 DSH → 写插件版本 → 准备运行时 → 打包），版本自动递增
npm run dist:offline  # 离线重建同一版本（不递增）
git add -A && git commit -m "..." && git push origin main
git tag v0.1.0-rc.<官方版本>.<补丁> && git push origin v0.1.0-rc.<官方版本>.<补丁>  # 触发 CI 发布
```

- 版本规则：`<官方 DSH 版本>.<major>.<minor>` 形式，补丁位只增不重置；**官方 DSH 大版本线升级时补丁位归零**（如 `6.5.10 → 6.5.11 → 6.6.0`），由 `scripts/sync-dsh.mjs` 自动计算；
- 发布前置：`CHANGELOG.md` 新增版本条目（新增 / 修复 / 变更 / 移除）、`RELEASE_NOTES.md` 更新为本次发布说明（会原文作为 release 备注）；
- 发布走 CI（`release.yml`），不要手动 `gh release create`；发布后如需转正式并钉为 Latest，用 `gh api --method PATCH`；
- 发布前清理 `dist/` 旧版本产物。

## 13. 常见坑

- **路由重复**：`(kind, path)` 唯一，GET/HEAD/POST 必须在一个 handler 内分发；
- **订阅基线重置**：订阅服务快照后，只在关键状态变化时重建订阅，否则边缘检测失效（§7.5）；
- **binding 未就绪漏订阅**：`sessions.binding(id)` 返回 undefined 时不得提前设置 `currentId`（§7.5）；
- **Windows 通知不显示**：toast 需要主进程 `app.setAppUserModelId`（`main.mjs`），缺失时 HTML5 Notification 静默失败；
- **配置缺失缺功能**：开关读取失败必须回退默认（全开），再等真实配置收敛重装；
- **CSS 花括号失衡**：插件 CSS 是 JS 字符串拼接，漏一个 `}` 会让浏览器把该规则之后的所有规则吞进未闭合声明块（"样式整块丢失（白底裸排）"且只影响该插件）。改完 CSS 用 `{`/`}` 计数验证配平；
- **指纹误写**：手动部署脚本若预写 `builtin-plugins.json` 标记，会导致应用跳过真实注册（§11）；
- **配置键不同步**：host/client 键集不一致 → 开关无法持久化、形同虚设（§8）；
- **样式归属错误**：`<style>` 标签的 `data-plugin` 必须写本插件名，否则卸载清理会漏删/误删（§7.6）。
