# DSH Desktop v0.1.0-rc.6.6.2 预览版

新增自动更新：安装版自动检查并下载更新、退出时自动安装；便携版启动时提示新版本；发布流程同步发布更新元数据。

## 更新内容

### 新增

- **自动更新（安装版）**：启动后自动检查 GitHub Releases 是否有新版本，有则后台自动下载，退出时自动安装；下载完成后弹窗「立即重启并安装 / 稍后」，点「立即重启并安装」即刻完成升级。更新失败不影响正常使用（静默记录，可到设置页手动检查）。
- **便携版启动检查**：便携版无法在运行中替换自身 exe，启动时静默检查新版本，发现更新在窗口顶部弹可点击提示「发现新版本 X，点击下载」（15 秒自动消失），点击直达对应安装包下载。
- **检查更新直达下载**：设置页「检查更新」发现新版本后，按安装方式（便携版 / 安装版）直接跳转对应安装包直链下载，不再停留在 Release 页面。
- **更新元数据随发布上线**：GitHub Releases 随安装包一并发布 electron-updater 所需的 `latest.yml` 与 `*.blockmap`（差分更新），自动更新依赖此元数据。

### 变更

- 版本号升级至 0.1.0-rc.6.6.2。此前版本（≤ v0.1.0-rc.6.6.1）的安装包不含更新元数据，请手动下载升级到本版本，之后即可享受自动更新。
- 本功能由 [Can-can2026](https://github.com/Can-can2026) 贡献（[PR #5](https://github.com/CCMu04/DSHDesktop/pull/5)）。

## 验证

- 自动化测试全部通过（48 项）。
- CI 实证：`--publish never` 下 `latest.yml` 与 blockmap 正常生成，并随 release 校验上传。

## 相关文档

- [README.md](https://github.com/CCMu04/DSHDesktop/blob/main/README.md)：项目介绍、下载安装与构建说明
- [CHANGELOG.md](https://github.com/CCMu04/DSHDesktop/blob/main/CHANGELOG.md)：全部版本变更记录
- [docs/TEMPLATES.md](https://github.com/CCMu04/DSHDesktop/blob/main/docs/TEMPLATES.md)：文档格式模板
