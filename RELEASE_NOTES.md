# DSH Desktop v0.1.0-rc.8.6.7 预览版

本次升级将官方 DSH 运行时从 0.1.0-rc.7 更新到 0.1.0-rc.8，同时完成桌面端品牌调整、依赖同步加固和 rc.8 插件生命周期兼容修复。

## 用户可见更新

- **官方 DSH rc.8**：支持 DeepSeek 原生多模态请求；图片附件可传入 slash command，图片也能用于仅图片的计划请求；新增文件与会话引用。
- **Windows Agent 体验**：PowerShell 改为可持续复用的 PTY，会话内的状态与输出处理更稳定。
- **Codex / Claude Code 子代理**：Provider 可直接安装，支持命名实例、非交互权限模式和更完整的失败信息保留。
- **Web UI 与模型配置**：模型选择器支持批量选择；默认模型重试次数统一为 5；补齐 OpenAI 兼容网关开关；修复文件打开失败反馈、工作区搜索、消息反馈编辑器与多项布局问题。
- **全新桌面品牌**：应用名、快捷方式、加载页和托盘统一显示 `DSH Desktop`，使用独立终端窗口图标；内部应用 ID 保留，现有安装可直接覆盖升级。

## 桌面端修复与构建改进

- 修复 rc.8 下文件 / Git 插件等待工作台服务时可能被重复注册的问题，页面不再出现 `duplicate tab id` 错误。
- DSH 同步命令支持通过 `DSH_VERSION` 精确指定预览版本，并兼容 npm 10 / npm 12 的版本查询输出。
- pnpm 更新到 11.22.0；移除无用的根 `node-gyp` 依赖，原生模块继续使用 Electron 构建链提供的兼容版本。
- CI 和发布构建新增完整依赖树校验；React / ReactDOM 与 Windows Squirrel 构建 peer 已显式锁定。

## 升级说明

- 桌面端继续复用 `~/.dsh`，现有设置、凭据、会话、Profiles 与用户插件保持不变。
- 默认 Web Profile 使用 JSONL 会话持久化，本版本没有启用 rc.8 的可选 SQLite v2 布局，普通用户无需迁移数据。
- 如果你自行启用了 SQLite 持久化插件，请先备份 DSH Home，并根据上游 rc.8 的 SQLite v2 布局说明单独评估迁移。

## 验证

- 82 项自动化测试全部通过。
- Node.js 24 + npm 10 标准 `npm ci` 和完整 `npm ls --all` 通过。
- rc.8 Web UI 首次使用页、主工作区与内置文件 / Git 标签完成隔离启动验证，浏览器控制台无错误。
- Windows x64 的 NSIS 安装包与便携版均已成功构建；运行时归档确认包含 DSH 0.1.0-rc.8。

## 相关文档

- [README.md](https://github.com/CCMu04/DSHDesktop/blob/main/README.md)：项目介绍、下载安装与构建说明
- [CHANGELOG.md](https://github.com/CCMu04/DSHDesktop/blob/main/CHANGELOG.md)：全部版本变更记录
- [DSH rc.8 上游提交](https://github.com/deepseek-ai/deepseek-harness/commit/141eb6fef83422698aef7a981029e843e8161534)：官方版本基线
