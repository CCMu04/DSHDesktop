# 文档模板

本目录存放 DSH Desktop 各类文档的固定格式模板。编写或更新文档时，复制对应模板并填写 `<...>` 占位符；不要改变章节顺序与标题层级。

所有文档一律使用简体中文，不使用截图或图片。

## README.md 模板

````markdown
# DSH Desktop

> 面向 Windows 的非官方 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 桌面客户端。不修改官方源码，直接运行并呈现官方 Web UI。

## 为什么做这个项目

（一段话说明项目背景与定位）

## 功能特性

- （每条一个特性，写行为而非口号）

## 下载与安装

（Releases 链接、安装包命名约定、系统要求与首次启动说明）

## 与原生 DSH 的数据关系

（DSH_HOME 规则、共享数据目录、内置插件一次性启用机制）

## 更新机制

（`npm run dist` / `npm run dist:offline` / 增量运行时缓存）

## 本地构建

（前置要求、构建命令、产物位置）

## 工作原理

（后端运行于内置官方 Node.js 运行时、路径打开走官方 opener、子进程环境清洗）

## 安全与隐私

- （回环端口、沙箱与上下文隔离、外部链接、数据不上传）

## 声明

（非官方封装声明与许可链接）
````

## CHANGELOG.md 模板

````markdown
# 更新日志

本文件记录 DSH Desktop 各版本的变更，新版本在上。格式固定为：版本标题（`## v<版本号> — <日期>`）+ 分类小节（新增 / 修复 / 变更 / 移除）。模板见 [docs/TEMPLATES.md](docs/TEMPLATES.md)。

## v<版本号> — <日期>

<一句话版本简介>

### 新增

- ...

### 修复

- ...

### 变更

- ...

### 移除

- ...
````

分类小节按需使用：没有对应内容的分类可以不写；分类出现顺序固定为 新增 → 修复 → 变更 → 移除。

## RELEASE_NOTES.md 模板

````markdown
# DSH Desktop v<版本号> 预览版

<一句话版本简介>

## 更新内容

### 新增

- ...

### 修复

- ...

### 变更

- ...

## 验证

- <自动化测试与冒烟验证结果>

## 相关文档

- [README.md](https://github.com/CCMu04/DSHDesktop/blob/main/README.md)：项目介绍、下载安装与构建说明
- [CHANGELOG.md](https://github.com/CCMu04/DSHDesktop/blob/main/CHANGELOG.md)：全部版本变更记录
- [docs/TEMPLATES.md](https://github.com/CCMu04/DSHDesktop/blob/main/docs/TEMPLATES.md)：文档格式模板
````

该文件会原文作为 GitHub Release 备注发布，只写与当前版本相关的内容；「相关文档」小节保持固定不变。

## THIRD_PARTY_NOTICES.md 模板

````markdown
# 第三方声明

DSH Desktop 下载或打包了第三方维护的软件。这些组件仍遵循其各自的开源许可。

## <组件名>

- 项目：<项目地址>
- 版权：<版权方与年份>
- 许可：<许可名称>

（一段话说明该组件与本项目的关系）

## 其他依赖

应用还打包了 `package.json` 与 `package-lock.json` 中声明的 Electron 与 npm 包。各包的许可文本与包元数据随安装的运行时一并提供（由各包发布者提供时）。
````
