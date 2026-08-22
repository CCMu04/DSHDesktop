# dsh-desktop-opencode-models

DSH Dock 内置的 host 增强：让官方 Models 页对 OpenCode Zen / Go 执行“获取可用模型”时，每次从对应 `/models` 端点读取实时候选列表。

- **宿主**：装饰官方 `@deepseek-ai/dsh-llm-pi-ai` 的公开 model-discovery 注册；adapter、settings、credentials 和 provider directory 仍由官方插件实现。
- **数据流**：官方 Models 页草稿 → `llm.discoverModels` → OpenCode `/models` 活跃 ID + Models.dev 逐模型协议元数据 → `LlmDiscoveredModel[]` → 官方选择器与可保存的官方 pi-ai catalog。
- **安全模型**：API key 仅作为该次请求的 Bearer header 使用，不记录、不持久化，也不附到错误 cause。
- **开关**：无。它是 OpenCode Zen / Go provider 的发现兼容层，不创建第二份设置或静态模型表。

> 质量结论：使用正式 Cordis bundle patch 和 DSH `llm.registerModelDiscovery` 服务接缝；无 DOM 依赖、无 Web UI patch、无 upstream 文件修改。

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

```text
┌────────────────────────────── DSH Dock ──────────────────────────────┐
│ bundle patch                                                        │
│   ├─ disabled: 官方 llm-pi-ai composition row                       │
│   └─ insert: dsh-desktop-opencode-models                            │
│                                                                     │
│ host 半区（lib/index.js）                                            │
│   ├─ 在同一 Cordis fiber 调用未修改的官方 llm-pi-ai apply()          │
│   ├─ 保留官方 adapter / directory / settings / credentials 行为      │
│   └─ 装饰 registerModelDiscovery("llm-pi-ai", callback)             │
│          ├─ provider = opencode / opencode-go → 实时 GET /models    │
│          ├─ Models.dev API / 公开源码 fallback → 逐模型协议          │
│          ├─ 动态扩充 pi-ai 公开 provider catalog，支持官方保存校验   │
│          └─ 其余请求 → 官方 callback                                │
│                                                                     │
│ client 半区（lib/client.js）                                        │
│   └─ 最小 no-op bundle；不注册插槽、不渲染或修改 UI                   │
└─────────────────────────────────────────────────────────────────────┘
```

host 依赖注入沿用官方 `dsh-llm-pi-ai` 的 `inject` 声明；client `exports.inject = []`。插件不提供自有服务或设置文档。它只在 `$DSH_HOME/desktop-opencode-model-metadata.json` 保存非敏感的目录外模型路由元数据，供保存后的下一次启动恢复；候选列表本身从不缓存。

### Root cause

0.1.1-rc.2 的官方 `dsh-llm-pi-ai` discovery 对 pi-ai 已知 provider 先调用内置 `catalogModels(provider)`。只要 catalog 非空就直接返回打包快照，不读取请求中的 `baseURL`，也不发网络请求。`opencode` 与 `opencode-go` 都是 pi-ai 已知的混合协议 provider；它们的原生 Models 卡片还不会提供统一 `baseURL`，实际 discovery payload 通常只有 provider 名。因此 OpenCode 客户端能够直接查询最新服务端 catalog，而 DSH 的“获取可用模型”只得到随当前 pi-ai 包发布的快照。

仅替换 discovery 结果还不够：官方 Models UI 采用候选后会把 ID 写入 profile 的 `models`。OpenCode 是混合协议 provider，目录外模型没有内置 `api`；官方保存校验因此报 `model ... needs an api`。不能给整个 route 写死一个协议，否则会把 GPT Responses、Anthropic Messages、Google Generative AI 和 OpenAI-compatible 模型错误合并。本插件改为使用 OpenCode 同源的 Models.dev provider metadata 为每个新 ID 解析协议，再动态补入 pi-ai 的公开 provider catalog；已安装条目始终优先。若 Models.dev CDN 在 Node/Bun 网络栈中不可达，则只对内置目录尚未认识的少量活跃 ID读取其公开 GitHub TOML 源文件中的 `[provider].npm`，不会退化成整路由写死协议。

官方 Models UI 本身已经支持动态结果：每次点击都会把卡片当前显示的 `provider`、`baseURL`、协议和一次性 key 发送给 `llm.discoverModels`，成功结果即时进入候选选择器，不需要 client UI。

## 2. 与官方 DSH 的集成方式

| 位置                             | 条目                          | 说明                                                                                                        |
| -------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `cordis.patch.yml`               | `llm-pi-ai`                   | 用 name guard 确认目标仍是官方 `@deepseek-ai/dsh-llm-pi-ai` 后暂停原 composition 行，避免重复注册。         |
| `cordis.patch.yml`               | `dsh-desktop-opencode-models` | 插入装饰器 host/client 行。                                                                                 |
| `ctx.llm.registerModelDiscovery` | `llm-pi-ai`                   | 官方 apply 仍发起唯一注册；facade 只包装 callback。                                                         |
| 官方 `llm-pi-ai` apply           | 原 config                     | 在本插件的 Cordis fiber 中原样建立 adapter、provider directory、settings section 和 credential resolution。 |

### 2.1 精确注册路径

```text
Web Profile bundles
→ dsh-desktop-opencode-models/cordis.patch.yml
→ dsh-desktop-opencode-models.apply(ctx, config)
→ official dsh-llm-pi-ai.apply(contextFacade, config)
→ contextFacade.llm.registerModelDiscovery("llm-pi-ai", officialDiscover)
→ real ctx.llm.registerModelDiscovery("llm-pi-ai", decoratedDiscover)
```

settings namespace 保持官方的 `llm-pi-ai`。没有新 namespace，也没有重复的 configurable-provider registration。仅当 `request.provider` 明确等于 `opencode` 或 `opencode-go` 时走实时分支：请求携带非空 `baseURL` 就优先使用；原生 provider 卡片省略它时，分别使用经过真实只读验证的 `https://opencode.ai/zen/v1` 与 `https://opencode.ai/zen/go/v1`。其他 provider 和其他 namespace 委托给官方 callback。

### 2.2 DOM / 服务依赖清单

| 依赖                                                             | 用途                                     | 失效后果                                                                                         |
| ---------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------ |
| bundle entry `id: llm-pi-ai` + name `@deepseek-ai/dsh-llm-pi-ai` | 以 name guard 暂停原行                   | 上游改名时 patch 被安全跳过，随后因 duplicate discovery 暴露明确启动错误，需升级适配。           |
| 官方包导出 `apply`、`inject`                                     | 在装饰后的 Context 内启动原实现          | 导出契约变化时 host 加载失败，需更新 wrapper。                                                   |
| pi-ai 公开 OpenCode model exports                                | 动态扩充官方 adapter 实际读取的目录      | 由 `ensurePluginRuntimeExports` 暴露 `@earendil-works` runtime scope；缺失时 host 明确加载失败。 |
| `ctx.llm.registerModelDiscovery(settingsNs, discover)`           | 正式 discovery extension point           | 签名或唯一注册语义变化时需回归 facade。                                                          |
| `LlmModelDiscoveryRequest` 的 `provider/baseURL/apiKey/signal`   | 判定 OpenCode、请求 endpoint、认证与取消 | 字段变化会使实时分支退化或拒绝。                                                                 |
| Models.dev `provider.npm` / model `provider.npm`                 | 将模型映射到 pi-ai wire protocol         | 新增未知 AI SDK provider 时该模型不会被静默错误路由，需升级映射。                                |
| pi-ai 公开 `OPENCODE_MODELS` / `OPENCODE_GO_MODELS`              | 生命周期内补充目录外逐模型路由           | 导出或模型契约变化时需升级；官方原有 entry 不覆盖。                                              |

无 DOM 选择器、CSS hash、官方组件结构或 client service method replacement。

## 3. 宿主 API 契约

无自有 HTTP 路由。浏览器仍使用官方 Host API proxy 的 `llm.discoverModels` RPC；插件只在 Cordis host 内服务该正式调用。

语义要点：每次 model discovery 都重新查询活跃 ID，不缓存成功、失败或空候选。它不写 settings、不写 credential store，也不形成调用白名单。仅成功解析出的目录外模型协议元数据会原子写入本地 bootstrap cache，使官方 adapter 在保存后和重启后都能解释该 ID。

## 4. 安全模型

- endpoint 来自官方 Models 表单的 discovery request；只接受 `http:` / `https:` URL，并拒绝 URL 内嵌用户名或密码。
- `apiKey` 复用官方 `normalizeApiKey` 校验，存在时发送 `Authorization: Bearer <key>`；现有 provider 卡片不回传已存 key 时，只通过官方 settings / credentials service 临时解析其 `apiKeyEnv` 引用。
- key 不进入日志、错误 message、错误 cause、插件配置或持久化文件。网络异常会被替换为不包含底层异常文本的 `LlmError`。
- 传递并合并 `request.signal`；调用方 abort 返回 `ABORTED`。另有 15 秒本地超时，返回 `DISCOVERY_TIMEOUT`。
- 每次并行发送 OpenCode `/models` 与 `https://models.dev/api.json`；Models.dev CDN 失败时，从 `raw.githubusercontent.com/anomalyco/models.dev` 读取目录外 ID 的对应公开源文件。两个辅助元数据源都不可达时，不阻塞已经成功的 OpenCode 实时列表，而是采用该 provider 声明的 OpenAI-compatible 默认协议；后续刷新仍会重新尝试逐模型 override。
- Models.dev 响应限制为 8 MiB；本地 cache 只接受允许的协议、容量、模态和成本字段，并重新派生官方 endpoint，cache 中的任意 URL 不会用于请求。
- 本插件不读工作区文件、不 spawn 进程，因此无 cwd/realpath 或 shell 边界。

## 5. 客户端行为契约

client half 是 loader 规范要求的最小 no-op，不注册插槽、事件、样式或服务。所有用户交互继续由未修改的官方 Models UI 提供：点击“获取可用模型”发起一次 discovery；成功后打开官方候选选择器；采用候选前不写配置。

连续两次点击会执行两次独立 HTTP 请求，因此服务端模型变化可以在第二次刷新中出现。空 `data` 合法返回 `[]`；官方 UI 会按自身现有文案提示没有候选。

## 6. 解析 / 渲染契约

### 6.1 URL contract

- `https://opencode.ai/zen/go/v1` 和尾随 `/` 都归一为 `https://opencode.ai/zen/go/v1/models`。
- 原生 `opencode` 请求省略 baseURL 时使用 `https://opencode.ai/zen/v1/models`；原生 `opencode-go` 请求省略时使用 `https://opencode.ai/zen/go/v1/models`。
- 已是 `/models` 时不重复追加；重复的尾部 `/models` 会折叠为一个。
- 误填完整 `/chat/completions` 或 `/completions` endpoint 时，先退回 inference base 再追加 `/models`。
- 不自行插入 `v1`，因此不会从合法 `/v1` base 生成 `/v1/v1/models`。
- 保留 caller 提供的查询参数，移除 fragment。

### 6.2 response contract

接受 OpenAI 风格顶层 `{ data: [...] }`。每个 entry 只读取非空字符串 `id`，返回 `{ id, name: id }`；invalid entry 单独忽略、duplicate id 保持首个与服务端顺序。未知字段忽略，空数组合法。展示结果不从 `/models` 猜测能力；保存路由所需的 protocol、容量和输入模态只接受 Models.dev 的对应字段，Models.dev 尚未列出的活跃 ID使用该 OpenCode provider 声明的 OpenAI-compatible 默认协议和官方 route fallback capacities。

malformed JSON 和缺少顶层 `data` 数组是明确失败，不伪装成空列表。401/403、404、429、5xx、网络错误、timeout 与 abort 都向官方 Models UI 返回有意义的错误信息。

## 7. 已知缺陷与风险

> 状态：🟡 功能级（已确认未修）/ 🔵 卫生级。

### 7.1 🔵 上游 composition 包装点需要随 rc 版本复核

插件需要以正式 patch 暂停原 `llm-pi-ai` composition 行，再从公开导出调用同一官方实现。虽然没有复制或修改 upstream 代码，但上游若改 entry id、包名、exports 或 discovery namespace，需要同步升级 wrapper。name guard 会避免静默命中错误条目。

### 7.2 🔵 仅接管明确的 OpenCode 原生 routes

实时分支只匹配 `opencode` 与 `opencode-go`；自定义 route 名即使使用 OpenAI-compatible API，也仍由官方 generic discovery 处理。这样避免把其他 provider 错误导向 OpenCode 默认 endpoint。

无已知功能级缺陷。

## 8. 已修复缺陷

| 缺陷                                                                                  | 修复                                                                                                            |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| OpenCode Zen / Go 的“获取可用模型”返回 pi-ai 打包 catalog，无法可靠看到服务端最新模型 | 对两个明确 provider 执行无缓存实时 `/models` 查询，其余逻辑仍委托官方插件。                                     |
| 目录外实时模型采用后保存报 `needs an api`                                             | 结合 Models.dev 的逐模型 provider override 动态扩充官方 pi-ai catalog，不设置破坏混合路由的 route-level `api`。 |
| Models.dev API 与公开源码都不可达时，实时刷新报 `Could not reach Models.dev source`   | 元数据 enrichment 改为非阻塞；保留 caller abort，网络失败则采用 OpenCode provider 的默认协议继续发现和保存。    |

## 9. 加固建议

1. 每次升级官方 DSH 时先验证第 10 节的 composition 与注册契约；若 upstream 原生支持“已知 provider 强制 probe endpoint”，删除本装饰器并恢复官方行。
2. 只有新增 OpenCode provider route 具备稳定 listing endpoint 后，才扩展精确 provider 映射；不能仅以 `api = openai-compatible` 判断。

## 10. 维护与升级检查清单

- [ ] `dsh-base/cordis.patch.yml` 仍以 `llm-pi-ai` / `@deepseek-ai/dsh-llm-pi-ai` 挂载官方插件。
- [ ] 官方包仍导出 `apply` 和 `inject`，且 wrapper config 可原样传入。
- [ ] `registerModelDiscovery("llm-pi-ai", callback)` 仍是唯一且随 fiber dispose 的正式注册路径。
- [ ] `LlmModelDiscoveryRequest` 仍提供 `provider`、`baseURL`、`apiKey`、`signal`。
- [ ] Models UI 每次 Fetch/Refresh 仍发送当前表单草稿并动态展示返回 candidates。
- [ ] OpenCode Zen / Go 默认 inference base 与 OpenAI 风格 `GET /models` response contract 仍有效。
- [ ] Models.dev 仍提供 `opencode` / `opencode-go` provider、provider-level `npm` 与可选 model-level `provider.npm`。
- [ ] Models.dev CDN 不可达时，公开源码 fallback 仍只读取内置目录外 ID，并能识别 TOML `[provider].npm`。
- [ ] pi-ai 仍公开导出 `OPENCODE_MODELS` / `OPENCODE_GO_MODELS`，且官方 catalog entry 的逐模型协议不被覆盖。
- [ ] `ensurePluginRuntimeExports` 仍把运行时 `@earendil-works` scope 链接到已部署的 builtin plugins。
- [ ] 目录外模型采用后，`settings.mutate` 可保存；包含不同协议的模型列表仍各自保持协议。
- [ ] 401/403/404/429/5xx、malformed JSON、network、timeout、abort 的错误仍可在 Models UI 阅读。
- [ ] 两次连续 discovery 可观察到不同服务端列表；bootstrap cache 不替代实时候选请求。
- [ ] `opencode` / `opencode-go` 之外的 provider 仍调用官方 discovery callback。
- [ ] plugin unload 会释放唯一 discovery registration、adapter、directory 与 settings resources。
- [ ] client bundle 仍为 no-op，官方 Web UI 无 patch、DOM 注入或替换。
- [ ] `npm test`、定向 format check、只读真实 endpoint 验证和离线打包链路均完成。
