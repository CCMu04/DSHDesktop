# 第三方声明

DSH Desktop 下载或打包了第三方维护的软件。这些组件仍遵循其各自的开源许可。

## DeepSeek Harness

- 项目：<https://github.com/deepseek-ai/deepseek-harness>
- 版权：2026 DeepSeek
- 许可：MIT

DSH Desktop 是独立的社区封装项目，不修改 DeepSeek Harness 源码。"DeepSeek" 与 "DeepSeek Harness" 的名称和标识归其权利人所有；此处引用仅用于标识兼容性与被封装软件，不表示任何背书关系。

## 其他依赖

应用还打包了 `package.json` 与 `package-lock.json` 中声明的 Electron 与 npm 包。各包的许可文本与包元数据随安装的运行时一并提供（由各包发布者提供时）。

## 内置「极简模式 (Git Bash)」agent preset 的灵感来源

桌面端内置的 `presets/minimal-gitbash/` 是本项目自研实现，其中 `gitbash-executor.mjs` 的 shell 接缝设计参考了以下 MIT 许可的开源项目，并保留其版权声明精神（MIT 要求对实质性复制保留版权声明；本实现为基于其设计思路的重写）：

- 项目：[liceses/dsh-gitbash-preset](https://github.com/liceses/dsh-gitbash-preset)（DeepSeek Harness 社区插件，把极简模式的 bash 调用映射到 Git for Windows 的 bash）
- 版权：liceses
- 许可：MIT

参考资料（MIT）：

- [sjh9714/dsh-win32](https://github.com/sjh9714/dsh-win32) —— 写围栏与沙箱适配思路（深色预设改为带 `sandboxMode` 上报的 `dsh-fs-sandbox` 后端，对应其上报的 deepseek-harness discussion #2066）
