# pi-ling

一个面向编码智能体的工作台项目，提供桌面端应用、Agent 运行时、会话记录与评测等能力。

## 简介

pi-ling 是一个用于运行和展示编码 Agent 会话的工程，核心包括 Electron 桌面端、可复用的 Agent 核心包、运行时适配层以及评测工具链。

## 目录结构

- `apps/desktop/`：Electron 桌面端应用，包含主进程、预加载脚本和渲染层。
- `packages/agent-core/`：Agent 循环与核心类型定义。
- `packages/coding-agent/`：编码 Agent 实现，包含工具、审批与变更追踪。
- `packages/runtime-contracts/`、`packages/native-runtime/`、`packages/dsh-runtime/`：运行时契约与不同适配实现。
- `packages/session-events/`、`packages/dsh-transcript/`：会话事件与转录相关逻辑。
- `packages/coding-eval/`：编码任务评测与打分工具。
- `docs/`：设计与集成文档。
- `scripts/`：辅助脚本。

## 使用说明

1. 安装依赖：

   ```bash
   pnpm install
   ```

2. 运行测试：

   ```bash
   pnpm test
   ```

3. 复制 `.env.example` 为 `.env`，填入 `DEEPSEEK_API_KEY` 等配置。

4. 启动桌面端：

   ```bash
   pnpm dev
   ```

更多细节请参阅 `docs/` 目录下的文档。
