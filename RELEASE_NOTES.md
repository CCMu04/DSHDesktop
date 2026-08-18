# DSH Desktop v0.1.0-rc.7.6.6 预览版

官方 DSH 运行时升级 0.1.0-rc.6 → 0.1.0-rc.7；两张设置卡片迁移到 rc.7 的 keyed 设置插槽契约；内置浏览器开发中暂不随安装包分发。

## 更新内容

- **官方 DSH 0.1.0-rc.7**：跟随上游新功能（插件可自行注册设置卡片、Codex/Claude Code 子代理接入 Job Panel、DeepSeek 模型 `low` 推理强度、提问卡片折叠保留草稿等）与修复（极简模式持久 Bash 卡顿、max-token 截断会话续跑、大历史分页栈溢出、node-pty 1.2 beta PTY 兼容性）。
- **设置卡片兼容 rc.7 keyed 契约**：官方 rc.7 将 `settings.plugin.item` 改为按 settings 命名空间 keyed（插件自注册设置卡片）。「功能增强」聚合卡（`desktop-features`）与「视觉增强」配置卡（`desktop-ui`）均已迁移：宿主半登记同名命名空间、client 卡片以 key 注册；`desktop-ui` 的配置读写优先走 DSH 设置存储，旧 `desktop-ui.json` 自动并入并持续镜像，降级不丢配置。
- **内置浏览器开发中**（`dsh-desktop-browser`，工作台网页浏览）：暂不随安装包分发，仓库源码保留、开发模式可部署调试。
- **启动修复**：插件宿主半的运行时依赖解析（`builtin-plugins` 部署目录 junction 到运行时 `@deepseek-ai`）与 `dsh-desktop-features` 宿主半重复导出问题均已修复，直接 `dsh web` 可正常启动。
- **桌面端启动修复**：修复 `prepareBundledPlugins` 计算运行时 `node_modules` 根时的路径错误（此前把 DSH 包目录误当运行时根，导致安装版每次启动都报「Bundled runtime packages are missing」）；并新增「剪除不再分发插件在 web profile 里的引用」，避免插件从安装包移除后留下幽灵 link 令 App 启动失败且重装无法恢复。

## 验证

- 自动化测试全部通过（76 项）。
- 新安装包产物（NSIS + 便携版）已构建并校验：运行时为 rc.7、插件目录不含 dsh-desktop-browser。

## 相关文档

- [README.md](https://github.com/CCMu04/DSHDesktop/blob/main/README.md)：项目介绍、下载安装与构建说明
- [CHANGELOG.md](https://github.com/CCMu04/DSHDesktop/blob/main/CHANGELOG.md)：全部版本变更记录
- [docs/TEMPLATES.md](https://github.com/CCMu04/DSHDesktop/blob/main/docs/TEMPLATES.md)：文档格式模板