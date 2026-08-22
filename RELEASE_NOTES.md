# DSH Dock v0.1.1-rc.2.6.9 预览版

本次发布把官方 DSH 运行时升级到 0.1.1-rc.2，并为 OpenCode Zen / Go 增加实时模型发现。每次在官方 Models 页面主动获取模型时都会读取 OpenCode 当前 `/models`，不再受安装包内旧 catalog 限制。

## 用户可见更新

- OpenCode 与 OpenCode Go 的“获取可用模型”现在返回当前服务端目录，连续刷新可以看到服务端新增或移除的模型。
- `x-preview-f-free`、`nemotron-3.5-lightning-free` 等当前 pi-ai catalog 尚未收录的模型可以正常采用、保存和调用。
- Models.dev API 或公开源码暂时不可达时，不再显示 `Could not reach Models.dev source`；实时列表继续工作，并使用 OpenCode 的默认兼容协议。
- 修复启动时 OpenCode 插件报 `exports is not defined`。
- 随官方 rc.2 获得 DeepSeek 视觉模型更新、Files API 图片上传复用、自动图片缩放与格式转换，以及多项界面、交互和安全修复。

## 实现与安全边界

- 功能由 DSH Dock 内置 Cordis 插件实现，官方 DSH Web UI 和 DeepSeek Harness upstream 源码保持未修改。
- 只接管明确的 `opencode` 与 `opencode-go` route；其他 provider 的 discovery 行为不变。
- 新模型按模型自身协议路由，不给整个 OpenCode route 强制设置统一 `api`，因此现有 GPT Responses、OpenAI-compatible、Anthropic 和 Google 模型可以继续共存。
- API key 仍由 DSH credential service 管理，只在请求时使用；插件不会记录或持久化密钥。磁盘 cache 仅包含经过净化的非敏感模型路由元数据。
- 实时候选列表不缓存；每次用户主动刷新都重新请求 OpenCode。

## 升级说明

- 内部 `appId` 和安装包文件名前缀保持不变，安装版可以直接覆盖升级。
- 继续复用 `~/.dsh`，现有设置、凭据、会话、Profiles 与用户插件无需迁移。
- 首次启动会按内容指纹部署新版内置插件；请在覆盖安装前完全退出旧版 DSH Dock。

## 验证

- 106 项自动化测试全部通过。
- npm 完整依赖图校验通过，0 个已知依赖漏洞。
- Windows x64 NSIS 安装版与便携版均已成功生成并签名。
- 打包 runtime 使用官方 DSH 0.1.1-rc.2 和 Node.js 24.18.1。
- 打包后的 OpenCode host/client 插件与审计源码 SHA-256 完全一致。

## 相关文档

- [README.md](https://github.com/CCMu04/DSHDesktop/blob/main/README.md)：项目介绍、下载安装与构建说明
- [CHANGELOG.md](https://github.com/CCMu04/DSHDesktop/blob/main/CHANGELOG.md)：全部版本变更记录
- [OpenCode 实时模型插件](https://github.com/CCMu04/DSHDesktop/tree/main/plugins/dsh-desktop-opencode-models)：架构、协议、生命周期与安全说明
