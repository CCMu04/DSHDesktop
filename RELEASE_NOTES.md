# DSH Desktop v0.1.0-rc.6.5.9 预览版

修复「完成提醒」在 Windows 上不显示通知的问题。

## 更新内容

### 修复

- 主进程设置 AppUserModelID（`ai.deepseek.harness.desktop`）：Windows 的 HTML5 通知（toast）只有在应用持有有效 AppUserModelID 时才会显示，此前通知会静默失败。
- 完成提醒在 `sessions` 客户端服务尚未就绪时延迟重试安装，不再因插件先于核心服务启动而永久失效。

### 说明

- v0.1.0-rc.6.5.8 的「完成提醒」功能保持不变：回复完成且应用窗口不在前台（失焦 / 最小化）时，在右下角弹出系统通知，正文带回复预览，点击回到应用；窗口在前台时不打扰。

## 验证

- 12 项自动化测试全部通过（配置 API、完成提醒的 running 边缘判定、焦点过滤、通知内容、内置插件生命周期等）。

## 相关文档

- [README.md](https://github.com/CCMu04/DSHDesktop/blob/main/README.md)：项目介绍、下载安装与构建说明
- [CHANGELOG.md](https://github.com/CCMu04/DSHDesktop/blob/main/CHANGELOG.md)：全部版本变更记录
- [docs/TEMPLATES.md](https://github.com/CCMu04/DSHDesktop/blob/main/docs/TEMPLATES.md)：文档格式模板
