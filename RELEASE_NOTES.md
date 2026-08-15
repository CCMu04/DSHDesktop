# DSH Desktop v0.1.0-rc.6.6.0 预览版

大版本更新：工作台新增文件工作台与 Git 面板两大功能增强（文件浏览预览 / 查看改动暂存提交），工作台加载默认收起，右键菜单打开工作区可靠性修复。

## 更新内容

### 新增

- **工作台框架**（`dsh-desktop-workbench`）：官方布局右侧分栏容器（grid 第四列，CSS 变量接管渲染值）+ 官方同款两行 header 与下划线页签 + `desktop.workbench` 服务（页签 / 预览器注册、布局按会话持久化）+ 拖拽调宽 / 窄宽自动收起；主页签栏只承载功能插件页签。
- **文件工作台**（`dsh-desktop-files`，功能增强开关，默认开启）：工作台新增「文件」页签。右侧懒加载目录树（过滤依赖 / 缓存 / 版本库目录，类型图标，折叠记忆，拖拽调宽）；打开的文件以子页签分页预览——图片（缩放 / 平移）、视频 / 音频（流式，可拖动进度）、Markdown、PDF、代码 / 文本（行号 + 高亮）、JSON；路径栏支持「在资源管理器中显示」；对话中的文件链接自动在页签打开；无法预览的文件（如 Office）提供「用系统应用打开」按钮调起本机 Word / Excel / PowerPoint。
- **Git 面板**（`dsh-desktop-git`，功能增强开关，默认开启）：工作台新增「Git」页签。顶部分支名与仓库下拉（自动扫描会话目录内子仓库）；左侧暂存区 / 工作区文件分组列表（状态徽标 + 暂存 / 取消暂存 / 还原）；右侧 VSCode 式 unified diff（双行号 + 增删高亮，暂存区 / 工作区切换）；底部提交区（Ctrl+Enter）与提交历史；分栏可拖拽调整尺寸。
- 纯 git CLI 代理（`/api/desktop-git/*`）：不设置身份、无 push / pull / fetch；所有路径与仓库目录经会话 cwd 白名单校验。
- 右键菜单「在资源管理器中打开工作区」可靠性修复：新增 open-workspace 路由（系统 ShellExecute 打开目录）+ 直接调用官方 `workspaces.openPath`。

### 变更

- 工作台会话加载时默认收起：避免面板组件在会话 / 服务未就绪时挂载引发的插件初始化竞态；宽度与活动页签仍按上次记忆恢复。
- 移除 Office（docx / pptx / xlsx）预览支持：浏览器端渲染效果不佳，改为「用系统应用打开」。
- 版本线从 6.5 升至 6.6（补丁线归零）。

## 验证

- 自动化测试全部通过：git 插件 host（真实 git 仓库全链路：状态 / diff / 暂存 / 取消暂存 / 提交 / 还原 / 二进制 / 越界白名单 / 仓库扫描）+ client（tab 注册 / 开关收敛），文件插件与工作台测试保持通过。
- 实测：Git 面板完成一次真实提交（暂存 → 提交 → 历史出现记录）。

## 相关文档

- [README.md](https://github.com/CCMu04/DSHDesktop/blob/main/README.md)：项目介绍、下载安装与构建说明
- [CHANGELOG.md](https://github.com/CCMu04/DSHDesktop/blob/main/CHANGELOG.md)：全部版本变更记录
- [docs/TEMPLATES.md](https://github.com/CCMu04/DSHDesktop/blob/main/docs/TEMPLATES.md)：文档格式模板
