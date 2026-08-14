# DSH Desktop v0.1.0-rc.6.5.7 预览版

新增视觉增强与功能增强开关体系：桌面定制全部收敛到设置页，哪些生效由用户自己决定。

## 更新内容

### 新增

- 视觉增强（`dsh-desktop-ui`）：设置页「插件 > 视觉增强」卡片提供三个开关——设置抽屉、会话日志导出、统计栏整宽，全部默认开启，保存后自动刷新；配置持久化在 `~/.dsh/desktop-ui.json`。
- 功能增强（`dsh-desktop-features`）：设置页「插件 > 功能增强」聚合卡片，对齐视觉增强卡片模板，统一「重置 / 保存」，不再每个功能一个保存按钮。
- 检查更新（`dsh-desktop-updates`）：设置侧边栏新增「检查更新」页，显示应用版本 / DSH 组件 / 系统 / 安装方式，手动检查 GitHub Releases，发现新版本时弹窗选择「前往下载」或「暂不」。
- 右键菜单（`dsh-desktop-context-menu`）：右键输入框可剪切 / 复制 / 粘贴 / 全选；右键工作区可打开所在文件夹；右键选中内容可直接复制。
- 每个功能增强都是独立插件（各自携带 host/client 两半），通过数据接口注册进功能增强聚合卡片，新增功能无需改动聚合卡片本身。

### 变更

- 移除「插件列表」页，内置插件无需再手动管理。
- 版本号改为跟随官方 DSH 版本并递增补丁线（`0.1.0-rc.6.5.3 → 0.1.0-rc.6.5.7`），沿用官方 tag 前缀。

## 验证

- 10 项自动化测试全部通过（配置 API、客户端注册、功能数据接口、内置插件生命周期等）。

## 相关文档

- [README.md](https://github.com/CCMu04/DSHDesktop/blob/main/README.md)：项目介绍、下载安装与构建说明
- [CHANGELOG.md](https://github.com/CCMu04/DSHDesktop/blob/main/CHANGELOG.md)：全部版本变更记录
- [docs/TEMPLATES.md](https://github.com/CCMu04/DSHDesktop/blob/main/docs/TEMPLATES.md)：文档格式模板
