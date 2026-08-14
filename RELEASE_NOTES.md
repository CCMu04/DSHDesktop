# DSH Desktop v0.1.0-rc.6.5.8 预览版

新增「完成提醒」功能增强：回复完成且窗口不在前台时，在右下角弹出系统通知。

## 更新内容

### 新增

- 完成提醒（`dsh-desktop-notify`）：订阅当前会话，回复完成（running 结束）且应用窗口不在前台（失焦 / 最小化）时，通过系统通知在右下角提醒；正文带回复文本预览，回复出错时提示「回复出错了」，点击通知回到应用。窗口在前台时不打扰。
- Windows 通知以应用名义显示（AppUserModelID 身份归因），与其他应用的通知一致出现在系统通知中心。
- 开关收纳在「设置 > 插件 > 功能增强」聚合卡片中，配置持久化在 `~/.dsh/desktop-notify.json`。

## 验证

- 12 项自动化测试全部通过（配置 API、完成提醒的 running 边缘判定、焦点过滤、通知内容、内置插件生命周期等）。

## 相关文档

- [README.md](https://github.com/CCMu04/DSHDesktop/blob/main/README.md)：项目介绍、下载安装与构建说明
- [CHANGELOG.md](https://github.com/CCMu04/DSHDesktop/blob/main/CHANGELOG.md)：全部版本变更记录
- [docs/TEMPLATES.md](https://github.com/CCMu04/DSHDesktop/blob/main/docs/TEMPLATES.md)：文档格式模板
