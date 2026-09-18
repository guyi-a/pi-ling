<div align="center">

# pi-ling

**一个可审阅的编码 Agent 工作台**

同一个会话里切换三套 Agent Runtime，每一次工具调用、每一处文件改动、
每一轮模型输出都落进同一条事件日志 —— 你随时能倒回去看它到底做了什么。

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![pnpm workspace](https://img.shields.io/badge/pnpm-workspace-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![Platform](https://img.shields.io/badge/platform-Windows-0078D4?logo=windows&logoColor=white)](#环境要求)

简体中文 · [English](README.en.md)

</div>

## 这是什么

pi-ling 是一个 **Electron 桌面应用**：左边是会话，中间是对话流，右边是一个可以随时切到
Files / Changes / Terminal / Plans / Trace / Eval 的 Workbench。

它不是「给 CLI 套一层壳」。整套东西围绕三个立场来设计：

| 立场 | 具体做法 |
| --- | --- |
| **会话是事实源** | 所有事件写进 SQLite 的 Session Event Log；时间线、Canonical Messages、Run Activity 全都是它的**投影**，不是各自维护的状态 |
| **副作用必须被建模** | 写文件、跑命令这类动作先推导出 effect，再按审批策略放行；未知 effect 一律问人 |
| **Runtime 可替换** | Native / DSH / Codex 三套引擎共用同一套 runtime 契约，事件被归一成同一种 timeline 词汇，所以能在同一个会话里换引擎接着聊 |

## 特性

**🔀 一个会话，三套 Runtime**

输入框旁边就能切换 **Native**（本项目自研的 Coding Agent）、**DeepSeek Harness**（ACP sidecar）
和 **DeepSeek Codex**（Codex agent engine）。切换不是新开一个会话 —— 历史通过 Canonical
Transcript 导入新引擎，用 watermark 标记边界，接着往下聊。

**🧾 每一步都能审**

一次运行被拆成 Run / Turn，工具调用有各自的卡片（读文件、改文件、跑命令、搜索、子代理、
TODO、计划各有不同呈现）。跑完还能在 **Trace** 面板里逐条看原始事件和模型调用。

**🛑 写之前先问**

`read_file` / `grep` 这类只读动作直接执行；`write_file` / `delete` / `run_command` 这类先算
effect，再按三档策略处理：`manual`（全部询问）、`accept-write`（写入类自动放行）、`auto`
（全部放行）。策略认不出来的 effect 永远走询问。

**🖼️ 内联渲染：让模型直接把图画在对话里**

模型可以用 ` ```html type="renderer" ` 围栏输出自包含 HTML/SVG，pi-ling 会把它**渲染成图**
而不是展示源码。这条路是整个项目里安全口径最严的一处：DOMPurify 消毒 + 禁掉
`script` / `foreignObject` / `iframe` 等标签 + 按属性名精确丢弃外部 URI（含 CSS `url()` 与
`@import`），任何一步失败就降级回代码块。内核见
[`renderer-block.ts`](apps/desktop/src/renderer/src/features/chat/renderer-block.ts)，
配套 Skill 是 [`.agents/skills/inline-visualization`](.agents/skills/inline-visualization/SKILL.md)。

**📁 工作区就在旁边**

Files 面板是一棵可增删改名的文件树 + CodeMirror 编辑器，Markdown / 图片 / 音视频 / PDF /
DOCX / PPTX / 表格都能直接预览，还带 git 状态装饰；Changes 面板同时提供统一 diff 和并排
diff；Terminal 面板是真正的 xterm + node-pty。**文件和终端里选中的文本都能一键引用进对话**。

**🎚️ 输入框先定权限**

发消息前选模式：**Ask**（只用只读工具）、**Plan**（只读 + 写计划，你点了 Build 才动手）、
**Agent**（全量工具）。模式会同时约束能用的工具集、effect 白名单和系统提示词，不是前端假装的开关。

**🧩 Skills 只是文件**

放在 `<workspace>/.agents/skills/<name>/SKILL.md`，Native / DSH / Codex 三套引擎认同一个路径。
Native 通过 `load_skill` 工具按需加载，不占系统提示词的常驻预算。

**🕵️ 子代理**

`spawn_subagent` 可以把一段只读的代码调研丢给隔离的 explore 子代理，跑完只回一份摘要，
中间那些搜索结果不会污染主对话；要并行也可以丢到后台。

## 快速开始

### 环境要求

- **Node.js ≥ 22.19（或 ≥ 24）** —— 会话存库用的是 `node:sqlite`，测试直接跑在本机 Node 上；
  `pnpm dsh:setup` 会显式校验这个版本区间
- **pnpm 10**（仓库锁在 `pnpm@10.33.2`）
- Windows：完整打包链路（NSIS x64）只在 Windows 上验过；代码本身是 Electron + electron-vite，
  其他平台理论上可跑，但未做打包配置与验证

### 安装

```bash
git clone https://github.com/guyi-a/pi-ling.git
cd pi-ling
pnpm install
```

`pnpm install` 会执行 `electron-rebuild -f -w node-pty`。

### 配置模型

复制 `.env.example` 为 `.env`，至少填一个 Provider 的 Key：

```env
DEEPSEEK_API_KEY=sk-...
# ANTHROPIC_API_KEY=sk-ant-...
```

也可以在应用里配置，优先级更高：**设置 → 模型与 API**。三者的解析顺序是
**设置页 `llm-config.json` > `.env` > 内置默认**。

| Provider | Native | DSH | Codex |
| --- | :---: | :---: | :---: |
| DeepSeek | ✅ | ✅ | ✅ |
| Anthropic (Claude) | ✅ | ✅ | — |
| MiniMax / Moonshot (Kimi) / Kimi For Coding / Z.AI (GLM Coding) | ✅ | — | — |

可选的联网搜索配 `TAVILY_API_KEY` 或 `BOCHA_API_KEY`，两把都不填就不注册 `web_search` 工具。

### 启动

```bash
pnpm dev          # 先构建所有 packages，再起 Electron
```

### 可选：启用另外两套 Runtime

两套都是**默认关闭**的实验能力，需要显式打开。

```bash
# DeepSeek Harness（ACP sidecar，固定版本）
pnpm dsh:setup    # 从本地 deepseek-harness 检出建一个 pinned worktree
pnpm dsh:verify
```

```env
PI_LING_DSH_ENABLED=true
```

```env
# DeepSeek Codex（agent engine，二进制随依赖一起装好）
PI_LING_CODEX_ENABLED=true
```

Codex 需要 `DEEPSEEK_API_KEY`，只支持 DeepSeek（走 Responses API）。细节见
[`packages/dsh-runtime/README.md`](packages/dsh-runtime/README.md) 与
[`packages/codex-runtime/README.md`](packages/codex-runtime/README.md)。

## 架构

```text
Electron Renderer  (Chat · Files · Changes · Terminal · Plans · Trace · Eval · Settings)
        ↓ 类型化 preload IPC（白名单通道，无通用 Node API）
Electron Main
  ├─ SessionSupervisor        会话路由 · 生命周期 · Runtime 切换
  ├─ SessionStore             SQLite（node:sqlite）事件日志 —— 唯一权威事实源
  ├─ llm-config               设置 · .env · userData/llm-config.json
  └─ RuntimeAdapter
        ├─ Native  → @pi-ling/coding-agent → @pi-ling/agent-core → pi-ai
        ├─ DSH     → ACP v1 over stdio → pinned dsh-v0.1.3-alpha.1
        └─ Codex   → @openai/codex-sdk → 随包分发的 codex binary
```

三个值得说的设计决定：

1. **事件日志是唯一事实源。** 时间线、Canonical Messages、Run Activity 都是投影。
   这样跨 Runtime 交接、会话恢复、回放才有共同底座，而不是三份状态互相对账。
2. **Render 层不碰密钥、不碰文件系统。** 它只通过 preload 暴露的白名单 IPC 说话，
   API Key 只在 Main 进程读写，Renderer 拿到的只是 `apiKeyConfigured` 和一个脱敏 preview。
3. **Runtime 契约与产品解耦。** `@pi-ling/runtime-contracts` 定义会话创建/恢复、prompt、
   cancel、权限、事件订阅，Native 与 DSH 共用；Codex 走同一套映射。

## 目录结构

| 路径 | 说明 |
| --- | --- |
| `apps/desktop/` | Electron 主进程、preload、Renderer 全部 UI |
| `packages/agent-core/` | 有状态 Agent 与 ReAct 循环（不碰 Electron / 文件系统 / 凭据） |
| `packages/coding-agent/` | Native Harness：工具、effect 与审批、变更追踪、子代理、Skills |
| `packages/native-runtime/` `dsh-runtime/` `codex-runtime/` | 三套 RuntimeAdapter |
| `packages/runtime-contracts/` | 跨 Runtime 的控制面契约 |
| `packages/session-events/` `dsh-transcript/` | 事件投影与跨 Runtime 转录桥 |
| `packages/llm-config/` | Provider 目录与配置解析 |
| `packages/skills/` `web-tools/` `compaction/` | Skill 加载、联网工具、上下文压缩 |
| `packages/coding-eval/` | 回归评测工具链 |
| `.agents/skills/` | 仓库自带 Skills |
| `vendor/pi-ai` `vendor/pi-agent-core` | 上游 MIT 参考副本（不是运行依赖） |

## 开发

```bash
pnpm build:packages   # 逐个构建 packages（dev / test 前都会自动跑）
pnpm test             # 全仓测试（vitest，135 个测试文件）
pnpm typecheck        # 全仓类型检查
pnpm skills:sync      # 从本地 checkout 同步内置 Skills 到 .agents/skills
pnpm dist:win         # Windows 打包（NSIS x64）
```

约定与更多细节写在 [`agent.md`](agent.md)。改 IPC 契约时，契约、preload、Main、Renderer
四处要一起动；项目**不提供**第三方插件 API，能力都放在 `packages/coding-agent` 内部。

> [!NOTE]
> `pnpm test` 会先构建全部 packages 再逐个包跑测试，第一次会比较慢。

## 评测

`packages/coding-eval` 是一个回归评测工具链：任务目录（fixture + verify 命令 + 打分）跑在
隔离的 git worktree 里，结果写进 ledger，可以拿 baseline 和 candidate 对比。

```bash
pnpm eval:validate    # 校验任务目录
pnpm eval:reference   # oracle driver，基线任务必须全过
pnpm eval:noop        # 空 driver，基线任务必须全挂（用于验证打分器没放水）
pnpm eval:agent       # 真实 Agent 跑一遍（需要 API Key）
```

## 参与贡献

欢迎 Issue 和 PR。上手前建议先看 [`agent.md`](agent.md) —— 里面写了目录约定、Runtime 边界
和几条硬约束（比如「不引入产品级插件 API」「DSH 依赖必须锁版本」）。

- 修 bug 请尽量带一个能复现的测试
- 改 IPC 或事件协议时，请同时更新对应的契约测试
- 提交前跑一遍 `pnpm test`

## 许可证

[MIT](LICENSE)。仓库里 `vendor/` 下的两个包是上游项目的 MIT 参考副本，版权归各自作者所有；
`.agents/skills/pptx` 另附 [`LICENSE.txt`](.agents/skills/pptx/LICENSE.txt)。
