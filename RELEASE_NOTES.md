# DSH Desktop v0.1.0-rc.6.5.10 预览版

完成提醒支持 AI 调起询问场景，并修复完成边缘被吞掉的根因。

## 更新内容

### 新增

- AI 调起询问时也弹出通知：待回应交互（pending）从无到有且窗口不在前台时——工具审批弹「需要你的确认」（含工具名），提问弹「需要你的回应」（含问题文本）。同一询问只提醒一次，回应清空后新的询问会再次提醒。与完成提醒共用同一开关（「设置 > 插件 > 功能增强 > 完成提醒」，默认开启）。

### 修复

- 完成提醒的会话跟随逻辑只在当前会话变化时重建订阅：此前 `sessions.list` 快照随会话活动频繁变化，每次变化都会重置 running 基线（被当作首次观察），导致「回复完成」边缘被吞掉、从不触发通知。
- 完成判定实时读取 `document.hasFocus()`，与窗口焦点事件双保险，失焦 / 最小化均可靠识别。

## 验证

- 12 项自动化测试全部通过（配置 API、完成提醒的 running 边缘、焦点过滤、询问提醒的 pending 边缘、不重复提醒、内置插件生命周期等）。
- 实测：回复完成切走窗口弹「对话完成」；工具审批 / 提问切走窗口弹「需要你的确认 / 需要你的回应」。

## 相关文档

- [README.md](https://github.com/CCMu04/DSHDesktop/blob/main/README.md)：项目介绍、下载安装与构建说明
- [CHANGELOG.md](https://github.com/CCMu04/DSHDesktop/blob/main/CHANGELOG.md)：全部版本变更记录
- [docs/TEMPLATES.md](https://github.com/CCMu04/DSHDesktop/blob/main/docs/TEMPLATES.md)：文档格式模板
