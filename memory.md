# pi-ling 项目参考记忆

本文件记录本机可供架构设计、技术选型和实现对照的项目。参考代码只用于理解设计，不直接复制到本项目。

## 本地参考仓库

- Pi：`E:\pi`
  - 远程仓库：`https://github.com/earendil-works/pi.git`
  - 当前本地版本信息：monorepo `0.0.3`，交接记录中的 Pi 版本为 `0.85.0`。
  - 重点参考：`packages/coding-agent`、`packages/ai`、`packages/agent`、协议和 session backend。
  - Phase 1 应使用 `@earendil-works/pi-coding-agent`，不能仅用裸 `pi-agent-core` 重写 Coding Harness。
  - `packages/ai` 的源码快照已复制到本项目 `vendor/pi-ai`，版本和提交信息见其 `UPSTREAM.md`。
  - 产品代码通过 `packages/model-adapter` 使用 vendored pi-ai，不直接修改上游快照。

- LingCoWork：`E:\LingCoWork`
  - 远程仓库：`https://github.com/guyi-a/LingCoWork.git`
  - 重点参考：Workspace、Diff、Problems、Terminal、effect-based approval、SSE 事件、会话恢复和 `internal/codingeval`。
  - 仅作为需求、设计和评测参考，不修改或复制主工程。

- KlingWork App：`E:\klingwork-app`
  - 远程仓库：`https://git.corp.kuaishou.com/kling-agent/kling-work/klingwork-app.git`
  - 重点参考：pnpm monorepo、Electron + React + TypeScript、`electron-vite`、Main/Preload/Renderer 分层、桌面打包。
  - 参考当前技术版本时，应先检查其 `package.json` 和实际构建配置。

- DeepSeek Harness 源码：路径待确认
  - 官方仓库：`https://github.com/deepseek-ai/deepseek-harness`
  - 当前在 `E:\` 顶层 Git 仓库中未发现对应源码 checkout。
  - `E:\dsh-for-humans` 是教程仓库，不是 DeepSeek Harness 源码，不得作为 SDK 源码依赖。
  - 找到或补充本地源码后，应在此处记录准确路径和固定版本。

## 选型原则

- 遇到 Electron 工程、IPC、窗口生命周期和打包问题，优先对照 KlingWork App 与 LingCoWork。
- 遇到 Coding Agent loop、工具、session、模型 provider 和流式事件问题，优先对照 Pi。
- 遇到 effect 审批、崩溃恢复、事件持久化和黑盒评测问题，优先对照 LingCoWork。
- 遇到 DSH/Cordis 插件边界时，只参考官方 DeepSeek Harness 源码；教程用于理解概念，不替代源码验证。
- 参考项目中的实现不能自动视为适合 pi-ling；采用前应核对许可证、安全边界、当前版本和 RuntimeAdapter 约束。

## 当前实施顺序

1. 先建立可运行的 Electron + React + TypeScript 框架。
2. 打通 Main、Preload、Renderer 的最小类型安全 IPC。
3. 验证开发启动、类型检查和生产构建。
4. 再设计模型适配层，优先接入 Pi 体系中的 `pi-ai`。
5. 模型适配稳定后再进入 Pi Coding Runtime 和完整 Agent Harness。
