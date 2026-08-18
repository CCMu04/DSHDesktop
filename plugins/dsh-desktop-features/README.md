# dsh-desktop-features

「功能增强」聚合卡片：在官方插件配置页（`settings.plugin.item`）渲染一张分组卡片，把各功能增强插件（workbench / context-menu / notify / updates …）的开关聚合到一处统一管理。

- **本插件不承载任何功能**：只提供聚合 UI 与 `desktop.features.item` 子插槽的声明。每个功能增强由独立插件提供（详见[第 5 节](#5-新增功能增强插件的步骤)）。
- **结构对齐**：卡片外观完全镜像「视觉增强」卡片（`dsh-desktop-ui` 的 `DesktopUiConfigCard`，`dduiC_*` 模板），本插件自带一套同构样式（`dduiFg_*`）。
- **宿主端为空壳**：`lib/index.js` 是 no-op，所有行为都在浏览器 bundle 里。开关的持久化由各子功能插件自己的 host 端点负责。

> 这是桌面壳 9 个插件中**唯一一个完全走官方插槽体系、零 DOM 注入**的插件：注册进官方 `settings.plugin.item`，通过 `children` 声明表声明自己的子插槽，子插件向该插槽注册数据接口。详见[第 3 节](#3-与官方-dsh-的集成方式)。

---

## 目录

1. [架构总览](#1-架构总览)
2. [与官方 DSH 的集成方式](#2-与官方-dsh-的集成方式)
3. [数据接口契约：desktop.features.item](#3-数据接口契约desktopfeaturesitem)
4. [聚合卡片行为契约](#4-聚合卡片行为契约)
5. [新增功能增强插件的步骤](#5-新增功能增强插件的步骤)
6. [实现细节](#6-实现细节)
7. [已知缺陷与风险](#7-已知缺陷与风险)
8. [已修复缺陷](#8-已修复缺陷)
9. [加固建议](#9-加固建议)
10. [维护与升级检查清单](#10-维护与升级检查清单)

---

## 1. 架构总览

```
┌──────────────────────────── 浏览器侧（client） ────────────────────────────┐
│                                                                            │
│  dsh-desktop-features（本插件，host 仅注册 settings 命名空间）              │
│    └─ 注册进官方 settings.plugin.item（key "desktop-features"，rc.7 keyed 契约）│
│        ├─ 声明子插槽 desktop.features.item（list / root）                    │
│        └─ 渲染 FeaturesGroupCard（聚合 UI）                                  │
│              │  entries() + subscribe()                                     │
│              ▼                                                             │
│  desktop.features.item 槽位（list，可多个条目）                               │
│    ├─ dsh-desktop-workbench   (id "workbench",      order 5)  → 框架总开关   │
│    ├─ dsh-desktop-context-menu(id "context-menu")           → 右键菜单开关   │
│    ├─ dsh-desktop-notify      (id "notify")                 → 完成提醒开关   │
│    └─ dsh-desktop-updates     (id "updates")                → 更新检查开关   │
│        每个条目：组件渲染 null，inject 提供数据接口                           │
│        { load(): Promise<boolean>, save(v): Promise<void>,                  │
│          title: string, description: string }                               │
│                     │ load / save                                           │
│                     ▼                                                       │
│  各子插件的 host 端点（/api/desktop-*/config …）                             │
└────────────────────────────────────────────────────────────────────────────┘
```

依赖注入声明：`slots`、`locale`（`package.json` → `dsh.client.inject`：`dsh-client-locale`、`dsh-client-runtime`、`dsh-client-ui-primitives`）。

---

## 2. 与官方 DSH 的集成方式

### 2.1 注册的官方插槽

| 插槽 | 注册条目 | 用途 |
|---|---|---|
| `settings.plugin.item` | `key: "desktop-features"` + `id: "dsh-desktop-features"` | 插件配置页（可配置页签）里的一张卡片 |

rc.7 起 `settings.plugin.item` 是**按 settings 命名空间 keyed** 的槽：宿主半必须先用
`@deepseek-ai/dsh-settings` 登记同名命名空间（`settingsNamespace("desktop-features")`，
本插件 schema 为空——聚合卡不编辑自有字段，命名空间仅用于 tab 配对调度），client 卡片
以 `key: "desktop-features"` 注册（**同时保留 `id` 作迁移桥**：rc.6 旧运行时把该槽声明
为 list、校验要求 id，rc.7 keyed 槽忽略 id；官方运行时全线 rc.7 后 id 可移除）。卡片
本身是「功能增强」分组，内部通过子插槽 `desktop.features.item` 渲染各功能开关。

### 2.2 声明的子插槽

通过注册条目的 `children` 声明表声明：

```js
children: {
  "desktop.features.item": { kind: "list", scope: "root" },
}
```

语义与官方 SlotCore 完全一致：**声明 = 渲染授权 = 运行时规范**。子功能插件向 `desktop.features.item` 注册条目；本插件（或其声明）卸载时，子插槽随之塌缩，所有子条目一并清除。

### 2.3 对比其他桌面插件

| 插件 | 集成方式 |
|---|---|
| **本插件** | ✅ 纯官方插槽：注册官方槽 + 声明子槽 + 子插件注册条目，零 DOM 依赖 |
| dsh-desktop-workbench | ⚠️ 混合：2 个小插槽做入口 + 面板本体 DOM 注入（见 workbench README） |
| dsh-desktop-ui | ⚠️ 混合：插槽注册 + 官方 DOM 内联样式覆盖（`!important`） |

---

## 3. 数据接口契约：desktop.features.item

子功能插件**不渲染 UI**（组件注册 `() => null`），只通过 `inject` 提供数据接口：

```ts
interface FeatureFace {
  load: () => Promise<boolean>;          // 读取当前开关状态（true = 启用）
  save: (enabled: boolean) => Promise<void>;  // 写入开关状态
  title: string;                          // 卡片行标题（如「工作台框架」）
  description: string;                    // 卡片行说明文案
}

// 注册方式（子插件侧）：
ctx.slots.inject("desktop.features.item", () =>
  ctx.slots.register(
    {
      name: "desktop.features.item",
      id: "<feature-id>",       // 必填，行 key
      order: <number>,          // 行顺序（升序，workbench 用 5 排最前）
      locale: <NS>,
      inject: () => face,       // 每次加载时调用，返回上述接口
    },
    () => null,                 // 不渲染任何 UI
  ),
);
```

契约要点：

- `load` 失败时（HTTP 错误 / 抛错）由聚合卡片统一降级处理（见 4.2），子插件**不要**在 load 内部吞错返回 `true`（否则用户无法感知配置读失败）；
- `save` 的持久化落在子插件自己的 host 端点（各插件的 `/api/desktop-*/config`），本插件不接触任何配置存储；
- `title` / `description` 由子插件自己的词典提供，聚合卡片不负责本地化子项文案；
- 条目可随时注册/注销（插件热装卸、配置重应用），聚合卡片订阅槽位变化自动重载。

---

## 4. 聚合卡片行为契约

`FeaturesGroupCard`（`FeaturesGroupCard` 组件，`lib/client.js`）：

### 4.1 状态机

```
status: "loading"（初始，展开区显示「正在读取配置…」）
   │  Promise.all(entries → inject() → face.load())
   ▼
status: "ready"（rows + draft，展示开关行）      status: "error"（显示「无法读取配置」）
   │  toggle() 只改 draft
   ▼
保存：Promise.all(rows → face.save(draft[id])) → 成功 → location.reload()
   │                                   失败 → status 回 ready，显示「保存失败」
重置：draft ← rows 的已加载值（value），丢弃未保存修改
```

### 4.2 行为要点

| 行为 | 约定 |
|---|---|
| 展开/收起 | 头部按钮 `aria-expanded`；收起时不加载（保持挂载，状态不丢） |
| 开关行 | label `htmlFor` ↔ checkbox `id`（`dsh-desktop-feature-<id>`）配对；`checked` 仅当 draft 为 `true` |
| 草稿 | `draft[id]` 暂存；`status !== "ready"` 时 `toggle` 忽略（防加载中误改） |
| 重置 | 回滚到 `rows` 的已加载值（不是已保存值）；保存中禁用 |
| 保存 | 并行写所有行；**成功后整页 reload**（配置收敛手段，见 6.1）；失败显示 `role="alert"` 提示；**无修改时保存按钮禁用**（draft 与已加载值一致，脏检查） |
| 子项增删 | 订阅 `desktop.features.item` 变化 → 全量重载；过期异步结果由 `current` 标志丢弃 |

### 4.3 词典

`desktop-features` 命名空间（zh/en）：`title`「功能增强」、`description`、`loading`、`loadFailed`、`enabled`、`disabled`、`save`、`saving`、`reset`、`saveFailed`。

---

## 5. 新增功能增强插件的步骤

模块头的核心承诺：**新增功能增强不需要改动本插件**。流程：

1. 新建独立插件（如 `dsh-desktop-xxx`），host 端提供 `/api/desktop-xxx/config`（GET/POST `{enabled}`，与既有插件同一约定）；
2. client 端 `apply()` 里注册 `desktop.features.item` 条目（见[第 3 节](#3-数据接口契约desktopfeaturesitem)），组件传 `() => null`；
3. 提供 `load`（读 host 配置）与 `save`（写 host 配置）；
4. 功能本体（面板、DOM 注入、事件监听等）按自己需求安装，开关关闭时卸载；
5. 无需改动 `dsh-desktop-features` 任何代码——卡片自动出现该行。

注意：`id` 必须唯一（行 key、React key、draft key 三重依赖）；`order` 决定行顺序（workbench 用 5 抢占最前）。

---

## 6. 实现细节

| 机制 | 实现 |
|---|---|
| 聚合数据源 | 注入面提供 `features.entries()` + `features.subscribe(listener)`（包装 `ctx.slots` 的 entries / subscribe） |
| 并行加载 | `Promise.all(entries.map(entry => entry.inject().load()))`，全部就绪才进 ready |
| 草稿模型 | `draft: Record<id, boolean>`，`toggle` 只翻转 draft；reset 从 rows 重建 |
| 保存并发 | `Promise.all(rows.map(row => row.face.save(draft[id])))`，`saving` 标志防重入 |
| 配置收敛 | 保存成功后 `globalThis.location.reload()`——子插件均为"apply 时读一次配置"模式，无配置变更订阅，reload 是统一收敛手段 |
| 样式 | 自带 `dduiFg_*` CSS module（幂等注入），镜像 `dsh-desktop-ui` 的 `dduiC_*` 卡片模板，全用官方 token |
| 可访问性 | header 按钮 `aria-expanded`；checkbox 与 label 关联；失败提示 `role="alert"`；焦点轮廓 `focus-visible` |
| host | no-op（`apply(ctx) {}`），无任何路由 |

---

## 7. 已知缺陷与风险

> 状态：🟡 功能级（已确认未修）。卫生级缺陷（entriesOfSlot 投影、failed 直存文案、脏检查、reload 防抖）已修复，见[第 8 节](#8-已修复缺陷)。

### 7.1 🟡 保存成功 = 整页 reload（产品体验最重）

`save()` 成功后直接 `globalThis.location.reload()`。原因：子插件都是"apply 时读一次配置"、没有配置变更订阅，reload 是统一收敛手段。代价：改一个开关 → 整个应用重载、设置面板状态全丢、正在进行的会话界面闪断。子插件越多，这个问题越明显。

### 7.2 🟡 Promise.all 的部分失败无归因（可靠性最重）

保存用 `Promise.all`：任一子项 `save` 失败 → 整卡显示笼统的「保存失败，请重试」，但**前面成功的子项已经持久化了**。用户不知道哪个成功、哪个失败；重试是全量重写（幂等，但浪费且掩盖了坏项）。

### 7.3 🟡 单子项崩溃拖垮整卡

`entries.map` 中直接调用 `entry.inject()`：一个子插件 inject 抛错或它的 config 端点临时不可用 → `Promise.all` 整体 reject → 整张「功能增强」卡进入 error 态，**其余功能开关一起不可见**。无逐行隔离。

### 7.4 🔵 样式镜像重复（代码卫生）

`dduiFg_*` 是 `dsh-desktop-ui` 的 `dduiC_*` 卡片样式镜像（注释明示"本插件自带"）。两份近同样式表各自维护，视觉模板一变要同步两处。桌面壳拥有全部插件，可抽共享卡片组件/样式包。

---

## 8. 已修复缺陷

| 缺陷 | 修复 |
|---|---|
| 聚合投影用原始 `entries()`：同 id 不同 priority 注册时影子条目渲染为两行（React 重复 key + draft 互相覆盖） | 改用 `ctx.slots.entriesOfSlot()`（runtime 已暴露）——只投影每格胜者，正常流程零变化 |
| `failed` 状态存 key 字符串再 `t(failed)` 间接查表 | 直接存已翻译文案（`setFailed(t("saveFailed"))` + 渲染原值） |
| 保存按钮未做任何修改时也可点（白 reload 一次） | 新增 `dirty` 判定（draft 与已加载值比较），无修改时禁用保存按钮 + `save()` 内守卫 |
| `reload()` 无防抖：子插件热重注册触发并发全量 re-fetch | 订阅回调改 `scheduleReload`（100ms 防抖），cleanup 清定时器 |

---

## 9. 加固建议

1. **去掉整页 reload（最高优先级）**：子插件暴露 `onConfigChange` 订阅（或在 client 注册表上提供 `config` 服务），features 保存后只通知各子插件重新 apply，不 reload。若短期不改子插件，可退一步：reload 前 `confirm` 或仅在有实际变更时保存（脏检查已实现，见第 8 节）。
2. **保存改 `Promise.allSettled`**：逐行收集失败项，失败行标红 + 提示具体 `id`/title，成功项不重复写。
3. **逐行隔离**：`entry.inject()` / `face.load()` 用 `allSettled` + 单行错误占位，单子项故障不影响整卡。
4. **抽取共享卡片组件**：把 `dduiC_*` / `dduiFg_*` 的卡片结构（头部 + 字段行 + 重置/保存）提到桌面壳共享包，features 与 ui 共同消费。

---

## 10. 维护与升级检查清单

- [ ] `settings.plugin.item` 仍为 keyed 契约（`key: "desktop-features"`），且宿主半登记的 `desktop-features` 命名空间存在（tab 按命名空间配对调度卡片）
- [ ] `ctx.slots.inject` / `register` / `entriesOfSlot` / `subscribe` 的运行时签名未变（`dsh-client-runtime`；已从 `entries` 切到 `entriesOfSlot`）
- [ ] 各子插件的 `/api/desktop-*/config` 端点路径与响应格式未变
- [ ] 实测回归：展开卡片、加载各开关状态、单个切换、重置、保存（含"无修改时保存禁用"）、保存后各功能实际生效、子插件注销后行消失
