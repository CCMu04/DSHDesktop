# DSH Desktop v0.1.0-rc.6.6.3 预览版

修复「检查更新」在 GitHub API 限流或网络异常时报「检查更新失败」的问题：检查结果带 1 小时本地缓存与失败兜底，失败提示区分原因；安装版启动自动检查增加节流保护。

## 更新内容

### 修复

- **检查更新失败兜底**：检查结果写入本地缓存（`$DSH_HOME/desktop-updates-cache.json`，跨重启可用）。1 小时内重复检查直接读缓存，不再重复请求 GitHub API（未认证接口限流 60 次/小时/IP）；请求失败且存在旧缓存时用旧缓存兜底展示，不再一律弹「检查更新失败」。
- **失败提示区分原因**：接口限流（HTTP 403/429）提示「GitHub 接口限流，请稍后再试」；网络异常提示「请检查网络或代理设置」；仅在完全无缓存且请求失败时提示。
- **安装版自动检查节流**：electron-updater 启动自动检查在成功检查后 1 小时内不再重复（GitHub API 限流保护）；检查失败时清除节流记录，下次启动立即重试，不影响更新发现时效。

## 验证

- 自动化测试全部通过（52 项，含新增的更新节流单测与缓存接口冒烟测试）。

## 相关文档

- [README.md](https://github.com/CCMu04/DSHDesktop/blob/main/README.md)：项目介绍、下载安装与构建说明
- [CHANGELOG.md](https://github.com/CCMu04/DSHDesktop/blob/main/CHANGELOG.md)：全部版本变更记录
- [docs/TEMPLATES.md](https://github.com/CCMu04/DSHDesktop/blob/main/docs/TEMPLATES.md)：文档格式模板
