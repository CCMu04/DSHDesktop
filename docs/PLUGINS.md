# 内置插件规范与工作流

本文档描述 DSH Desktop 内置插件（`plugins/` 下所有 `dsh-desktop-*`）的编写规范、部署机制与开发发布工作流。适用于：新增一个功能增强 / 视觉增强、修改现有插件、排查插件问题。

## 1. 插件体系

内置插件随安装包分发，应用启动时自动部署并注册进 Web Profile（`~/.dsh/profiles/web`），无需用户手动安装。每个插件是**独立目录**，携带两半：

| 半 | 文件 | 运行位置 | 职责 |
| --- | --- | --- | --- |
| host | `lib/index.js` | 后端 Node 进程（`dsh web`） | 开关持久化、提供 HTTP API |
| client | `lib/client.js` | 浏览器渲染进程（官方 Web UI） | 行为实现、UI 注入、开关读写 |

插件目录结构：

```
plugins/dsh-desktop-<name>/
├── package.json          # 包元数据 + dsh.bundle / dsh.client 声明
├── cordis.patch.yml      # 挂载行：把插件行插入 web profile
└── lib/
    ├── index.js          # host 半
    └── client.js         # client 半
```

### 1.1 插件分类

| 分类 | 插件 | 用途 |
| --- | --- | --- |
| 框架 | `dsh-desktop-workbench` | 工作台右侧分栏（AppFrame grid 第四列）与面板布局，提供 `desktop.workbench` 服务（registerTab / registerViewer / openFile），是各功能插件标签页的宿主 |
| 视觉增强 | `dsh-desktop-ui` | 纯视觉定制（设置抽屉、会话日志导出、统计栏整宽），设置页「插件 > 视觉增强」卡片（`settings.plugin.item`，order 100） |
| 功能增强聚合 | `dsh-desktop-features` | 「功能增强」聚合卡片（`settings.plugin.item`，order 110），声明并渲染子槽位 `desktop.features.item` |
| 功能增强 | `dsh-desktop-updates` | 检查更新（`desktop.features.item` order 10 + 设置分区 `settings.section` order 100） |
| 功能增强 | `dsh-desktop-context-menu` | 右键菜单（`desktop.features.item` order 30） |
| 功能增强 | `dsh-desktop-notify` | 完成提醒（`desktop.features.item` order 40） |

功能增强与视觉增强的区别：视觉增强只改外观；功能增强携带真实行为（逻辑 + 可选 UI），且每个功能**独立成插件**，由聚合卡片统一呈现开关。

## 2. 插件声明（package.json）

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

- `exports["./client"]` 指向浏览器 bundle；host 通过 `.` 解析。
- `dsh.client.inject` 声明 client 半可用的官方客户端包（由加载器提供 require 作用域）。
- 插件版本固定为 `1.0.0`；升级判定靠**内容指纹**而非版本号（见 §5）。

`cordis.patch.yml`（挂载行，id 与 `name` 一致）：

```yaml
- insert:
    - id: dsh-desktop-<name>
      name: dsh-desktop-<name>
```

## 3. 宿主端规范（lib/index.js）

职责：开关持久化 + 提供 HTTP API。核心约定：

- 导出 `name`（与 patch 行 id 一致）、`inject = ["webServer"]`、`DEFAULT_CONFIG`、`apply(ctx, config)`。
- **唯一路由**：`/api/desktop-<name>/config`，`kind: "exact"`，一个 handler 分发 GET/HEAD/POST（官方 `dsh-host-webserver` 拒绝重复 `(kind, path)` 注册）。
- **持久化**：`$DSH_HOME/desktop-<name>.json`（默认 `~/.dsh/desktop-<name>.json`），原子写入（临时文件 + rename）。
- **配置合并顺序**：内置默认值 ← 插件行 `config` ← 用户开关文档，后覆盖前。
- 容错读取：文件缺失 / 损坏 → 空覆盖层（回退默认）。

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

## 4. 客户端规范（lib/client.js）

### 4.1 bundle 格式

client 半是官方模块加载器格式，导出 `apply` / `inject`：

```js
window.__ModuleLoader__.load({
  id: "dsh-desktop-<name>",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    // ...实现...
    exports.apply = apply;
    exports.inject = inject; // 例如 ["slots", "locale"]
    return module.exports;
  },
});
```

纯逻辑插件（无 React 组件）可以不 require 任何包；需要 UI 时按需 require `react/jsx-runtime`、`react`、`@deepseek-ai/dsh-client-ui-primitives` 等。

### 4.2 入口与词典

```js
const NS = "desktop-<name>";
const inject = ["slots", "locale"];

function apply(ctx) {
  const t = ctx.locale.bind(NS);
  ctx.effect(
    () => ctx.locale.register(NS, { zh, en }),
    "dsh-desktop-<name>: dictionaries",
  );
  // ...注册槽位 / 安装行为...
}
```

- 词典命名空间 `NS` 与插件名一致；文案键 `feature.title` / `feature.description` 供功能增强聚合卡片显示。
- 翻译函数 `t(key, params)` 支持 `{占位符}` 插值。

### 4.3 功能增强数据接口（desktop.features.item）

功能增强插件**不渲染自己的卡片**，只向聚合卡片注册一个数据接口：

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

契约：`{ load(): Promise<boolean>, save(enabled): Promise<boolean>, title: string, description: string }`。聚合卡片负责加载、草稿、统一「重置 / 保存」。注册保持 always-on（开关永远可调），行为按配置安装/移除。

### 4.4 开关读写与行为安装

- 读取：`fetch("/api/desktop-<name>/config")`，任何失败回退默认（全开），保证页面不因配置缺失缺功能。
- 行为安装：按配置快照安装，每个安装返回 disposer；配置收敛时统一 dispose 再重装：

```js
const installFeature = (config) => {
  const disposers = [];
  if (config.enabled) {
    const dispose = installBehavior(ctx, t);
    if (typeof dispose === "function") disposers.push(dispose);
  }
  return disposers;
};
let active = [];
const applyConfig = (config) => {
  for (const dispose of active) dispose();
  active = installFeature(config);
};
applyConfig({ ...defaultConfig });              // 先按默认全开安装，避免界面先缺功能
void loadConfig().then((config) => applyConfig(config)); // 配置到达后重装收敛
```

### 4.5 服务访问与订阅

- 客户端服务经 `ctx.get(...)` 获取：`ctx.get("sessions")`（会话列表/绑定）、`ctx.get("workspaces")` 等；未就绪时**延迟重试**（500ms × 20）而非直接放弃。
- 会话快照：`sessions.list`（`{ items, current }`）+ `sessions.binding(id).session`（`{ getSnapshot, subscribe }`）。
- 订阅**只在关键状态变化时重建**：列表快照会随会话活动频繁变化，若每次都重建订阅会把状态基线重置（如 running 基线），吞掉完成边缘（true→false）。
- 完成/询问判定用**边缘检测**：首次观察只记录基线，之后状态翻转才触发动作。

### 4.6 样式注入

- CSS 以 `<style>` 标签注入 `document.head`，用 `data-plugin-css` 标记去重（重复注入返回 no-op disposer）。
- 类名使用插件专属前缀（如 `dduiC_`、`dduiFg_`），配色一律用官方 token（`--dsw-alias-*`、`--dsw-shadow-*`），圆角/字号对齐官方卡片（12px 圆角、14px 头部、13px 字段、footer 重置 + 保存）。

## 5. 部署与生命周期

应用启动时（`main.mjs` → `prepareBundledPlugins`）：

1. 扫描 `plugins/` 下所有 `dsh-desktop-*` 目录。
2. 对每个插件计算**内容指纹**（`version + 全文件 sha256`），与 `builtin-plugins.json`（`%APPDATA%\deepseek-harness-desktop\builtin-plugins.json`，按 DSH Home 键控）比对。
3. 指纹匹配 → 跳过（**用户已做的启停选择保持不变**）；指纹变化或首次 → 部署到 `builtin-plugins/<package>` 并执行注册：`dsh plugin --profile web add --offline link:<部署目录>`（幂等：pnpm 更新链接，`reconcilePlugins` 按安装状态维护 `dsh.profile.bundles`，不会重复插入）。

注册结果落在 `~/.dsh/profiles/web`（dependencies + `dsh.profile.bundles` 层）；客户端 bundle 由后端以 `/plugins/<id>/client.js` 提供，页面加载时引用。

### 手动部署到已安装应用（开发验证）

```powershell
# 1) 把插件目录复制到已安装应用的 resources
Copy-Item plugins\dsh-desktop-<name> "C:\Users\<你>\AppData\Local\Programs\DeepSeek Harness\resources\plugins\" -Recurse -Force
# 2) 完全退出并重启应用 → 自动部署 + 注册
```

> 注意：新增插件时**不要**用 no-op install 的手动 `ensureBundledPlugin` 预写指纹标记，否则应用启动会认为已处理而跳过注册。新插件交给应用启动时自动部署注册即可；已注册插件的内容更新可用临时脚本（`test/redeploy-*.mjs`，用后删除）刷新指纹。

## 6. 测试规范

每个插件两个测试文件（`node --test`，`npm test` 运行全部）：

- `test/desktop-<name>-config.test.mjs`（host）：stub cordis ctx（`effect` + `webServer.register`），临时 `DSH_HOME`，真实 HTTP 服务验证 GET 默认值 / POST 持久化 / 非法输入 400 / 路由唯一性。
- `test/desktop-<name>-client.test.mjs`（client）：加载 bundle（`eval` 源码 + stub `window.__ModuleLoader__`），stub 浏览器环境后调用 `apply(ctx)`，断言注册与行为场景。

客户端测试的 stub 清单：`window`（含 `addEventListener`）、`document`、`Notification`、`fetch`、`location`、`MutationObserver`、`ctx`（`locale` / `slots` / `effect` / `get`）、所需服务（如 `sessions.list` / `binding` 的可控桩）。测试通过后新功能才能合入。

## 7. 构建与发布工作流

```powershell
# 1) 构建（sync 官方 DSH → 写插件版本 → 准备运行时 → 打包）
npm run dist          # 版本自动递增（如 6.5.10 → 6.5.11），产物在 dist/
npm run dist:offline  # 离线重建同一版本（不递增）

# 2) 提交推送
git add -A && git commit -m "..." && git push origin main

# 3) 发布（走 CI，不要手动 gh release create）
git tag v0.1.0-rc.<官方版本>.<补丁> && git push origin v0.1.0-rc.<官方版本>.<补丁>
# release.yml：推送 v* tag 触发 → npm test → electron-builder → gh release create（--prerelease）

# 4) 发布后转正式并钉为 Latest（工作流写死了 --prerelease；且旧版可能钉住 Latest）
gh api --method PATCH repos/CCMu04/DSHDesktop/releases/tags/v0.1.0-rc.6.5.10 \
  -f make_latest=true -F prerelease=false
```

- 版本规则：`<官方 DSH 版本>.<major>.<minor>` 形式，补丁线只增不重置（`6.5.10 → 6.5.11`），由 `scripts/sync-dsh.mjs` 自动计算。
- 发布前置：`CHANGELOG.md` 新增版本条目（新增 / 修复 / 变更 / 移除），`RELEASE_NOTES.md` 更新为本次发布说明（会原文作为 release 备注）。
- 发布前清理 `dist/` 旧版本产物，只保留最新。

## 8. 常见坑

- **路由重复**：`(kind, path)` 唯一，GET/HEAD/POST 必须在一个 handler 内分发；旧版本残留路由会导致「already has an entry」。
- **订阅基线重置**：订阅服务快照后，只在关键状态变化时重建订阅，否则边缘检测失效。
- **Windows 通知不显示**：toast 需要主进程 `app.setAppUserModelId`（`main.mjs`），缺失时 HTML5 Notification 静默失败。
- **配置缺失缺功能**：开关读取失败必须回退默认（全开），再等真实配置收敛重装。
- **指纹误写**：手动部署脚本若预写 `builtin-plugins.json` 标记，会导致应用跳过真实注册。
