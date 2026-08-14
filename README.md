# DSH Desktop

> 面向 Windows 的非官方 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 桌面客户端。不修改官方源码，直接运行并呈现官方 Web UI。

## 为什么做这个项目

DeepSeek Harness 原生提供 Web 界面，但日常使用仍需要在终端中启动和管理服务。DSH Desktop 把这套官方 Web UI 包装成可直接双击运行的桌面程序，同时保留原生 DSH 的配置、会话、插件和工作区习惯。

## 功能特性

- **官方页面，零前端分叉**：直接加载官方 `dsh web`，界面与能力与对应版本的 DSH 保持一致。
- **无缝衔接原生 DSH**：默认共用 `~/.dsh`，设置、凭据、会话、Profiles 与已装插件互通。
- **无需全局安装**：安装包自带匹配版本的 DSH、官方 Node.js 运行时与 `pnpm` 工具链。
- **安静的运行环境**：在不破坏 Windows ACL 沙箱的前提下隐藏 PowerShell、Command Prompt 与 `conhost` 窗口；Agent 的输出、退出码与文件操作不受影响。
- **更轻的运行时升级**：运行时缓存按包增量更新，相同版本不重复解压。
- **跟随官方版本**：构建命令自动同步 npm 上最新的 DSH 组件，Dependabot 每周检查更新。
- **桌面体验优化**：原生窗口、简洁标题栏、会话头部空白区域可拖动窗口、单实例运行、外部链接安全打开。
- **内置 desktop-ui 增强**：设置抽屉样式、右键菜单（在资源管理器中打开工作区、复制粘贴）、会话日志导出等。
- **本地优先**：Web 服务仅监听随机本机回环端口。

## 下载与安装

前往 [Releases](https://github.com/CCMu04/DSHDesktop/releases) 下载：

- `DSH-Desktop-Setup-<版本>-x64.exe`：标准安装包（推荐）。
- `DSH-Desktop-Portable-<版本>-x64.exe`：免安装便携版。

支持 Windows 10 / 11 x64。首次启动需要展开约 300 MB 官方运行组件，比后续启动稍慢。

## 与原生 DSH 的数据关系

桌面端遵循官方 DSH Home 规则：

1. 设置了非空的 `DSH_HOME` 时，使用该目录。
2. 否则使用 `~/.dsh`。

因此将来安装官方 DSH 后，可以继续使用已有设置、会话和插件。用户创建的插件应放在 `~/.dsh/plugins`（或自己的项目目录）；Web Profile 的安装记录位于 `~/.dsh/profiles/web`。这些目录都不属于桌面端可替换的运行时缓存。

内置插件采用多插件结构：`plugins/` 下的每个 `dsh-desktop-*` 目录都是一个独立插件（各自携带 host/client 两半与 patch 行），启动时逐个按内容指纹部署并注册。目前内置四个插件：

- `dsh-desktop-ui` — **视觉增强**（见下）
- `dsh-desktop-features` — **功能增强**聚合卡片（插件配置页中的分组入口，各功能插件把开关注册进它的子槽位）
- `dsh-desktop-updates` — **功能增强：检查更新**
- `dsh-desktop-context-menu` — **功能增强：右键菜单**

### 视觉增强开关（dsh-desktop-ui）

纯视觉定制，全部默认开启。设置入口在「设置 > 插件 > 视觉增强」，保存后页面自动刷新：

| 开关 | 功能 |
| --- | --- |
| 设置抽屉 | 设置页以左侧抽屉样式打开 |
| 会话日志导出 | 会话标题旁的导出按钮（替代右上角原始入口） |
| 统计栏整宽 | 输入框下方统计信息整行居中显示 |

开关配置持久化在 `$DSH_HOME/desktop-ui.json`（默认 `~/.dsh/desktop-ui.json`），关闭应用后也可以直接编辑该文件；无效字段会被忽略并回退默认值。若在 profile 的插件行中为 `dsh-desktop-ui` 配置了 `config`（如 `dsh plugin` 方式安装时的 patch 层），它作为中间层参与合并：内置默认值 < 插件行 `config` < `desktop-ui.json`。

### 功能增强开关（dsh-desktop-features 下的独立插件）

每个功能增强是独立插件，开关收纳在「设置 > 插件 > 功能增强」聚合卡片里，配置分别持久化在 `$DSH_HOME/desktop-*.json`：

| 功能 | 插件 | 说明 |
| --- | --- | --- |
| 检查更新 | dsh-desktop-updates | 「设置 > 检查更新」显示当前版本，手动检查 GitHub Releases，有新版本时弹窗选择「前往下载」或「暂不」 |
| 右键菜单 | dsh-desktop-context-menu | 右键输入框剪切 / 复制 / 粘贴 / 全选；右键工作区打开所在文件夹；右键选中内容直接复制 |

## 更新机制

应用不会在每次启动时强制联网更新。发布新版时：

- `npm run dist` 会先同步 npm 上最新的 `@deepseek-ai/dsh` 及配套包，再打包。
- `npm run dist:offline` 只使用锁定版本，适合离线重建同一版本。
- 安装包生成 block map；运行时缓存按包增量替换，避免每次重新处理数万个文件。

## 本地构建

要求 Windows 10 / 11 与 Node.js 22.19+ 或 24（构建机自带即可，目标机不需要）：

```powershell
git clone https://github.com/CCMu04/DSHDesktop.git
cd DSHDesktop
npm install
npm run dist
```

产物位于 `dist/`。如需复现锁定版本（`build/runtime/node-x64.exe` 已下载过时可离线完成）：

```powershell
npm ci
npm run dist:offline
```

## 工作原理

桌面壳启动官方 DSH Web 服务并加载到隔离的 Electron 窗口。后端运行在安装包内置的官方 Node.js 运行时（DSH 的原生目录选择器依赖的 koffi 绑定与 node-pty 输出在 Electron-as-Node 下不可用，因此后端不能借用 Electron 进程）；桌面兼容层只调整 Windows 进程窗口的显示状态，不取消控制台，也不绕过 DSH 的 ACL 沙箱。官方包在磁盘上保持原样。

设置页的配置文件打开请求与目录打开请求由官方 Host 原样处理：官方 opener（Windows `Invoke-Item`）负责校验和打开，桌面端仅通过后端 preload 在派生 opener 子进程时清除 `ELECTRON_RUN_AS_NODE` / `NODE_OPTIONS`，避免这些变量污染 VS Code 等被打开的应用。不会修改官方 Host 或 Web UI 源码。

## 安全与隐私

- 仅监听 `127.0.0.1` 上的随机空闲端口。
- Electron 页面关闭 Node 集成，启用上下文隔离与沙箱。
- 非本地链接交给系统默认浏览器打开。
- 不上传、不迁移用户的 DSH 配置、会话、凭据与插件。

## 声明

本项目是社区维护的非官方桌面封装，与 DeepSeek 无隶属或背书关系。"DeepSeek"、"DeepSeek Harness" 及相关标识归其权利人所有。官方 DSH 使用 MIT License，详见[上游项目](https://github.com/deepseek-ai/deepseek-harness)与[第三方声明](THIRD_PARTY_NOTICES.md)。

本项目自身代码使用 [MIT License](LICENSE)。
