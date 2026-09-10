# 导学-pi-ling

> 由 /project-guide 生成。本文件回答"这个项目怎么读、怎么学、怎么讲"，
> 把真实源码组织成一份学习路径 + 面试锚点。

## 0. 如何阅读本文件

- `面经-pi-ling.md` 是"简历可用 + 面试口播 + 题库 + 源码证据索引"。
- 本文件是"学习路径"，告诉你从哪个文件开始、为什么、读完能回答什么。
- 所有路径均是仓库相对路径。
- 项目状态是**持续的、阶段推进的**；当前为 Phase 1 大部分落地 + Phase 2 部分落地（见 §4 现状）。读源码前先读 `agent.md` 顶部的"项目目标"和"当前交接状态"，它会告诉你哪些是主线、哪些是探索性分支。

## 1. 这个项目是做什么的

一句话：**用 Electron + React + TS 独立实现的 Coding Agent 产品**，核心主张不是"写一个 agent 内核"，而是**把多个现成 agent 内核收敛到一套可插拔架构 + 一套权威事实源下**。

- 外部 agent Runtime 有三个：Native（`@earendil-works/pi-ai` + 自研 `@pi-ling/agent-core` + `@pi-ling/coding-agent`）、DSH（ACP stdio sidecar）、Claude Agent SDK（Claude Code 子进程）。
- 三套 Runtime 通过统一 `RuntimeAdapter` 接入，产品层只持有**一份 versioned Session Event Log**，Chat / Timeline / Eval 都是它的投影。
- 目标：换内核不改产品行为；事件、审批、权限、恢复、UI 语义在全内核间保持一致。

## 2. 前置知识（面试高频）

| 知识点 | 为何需要 | 在项目里的位置 | 高频度 |
|---|---|---|---|
| Electron 主/渲染/预加载三进程与 IPC 安全 | 理解为什么密钥只在 Main、UI 不能碰文件系统 | `agent.md` 技术栈、`apps/desktop/src/main`、`src/preload` | 高 |
| ReAct 工具循环 | Native 内核的 turn/tool 执行骨架 | `packages/agent-core/src/agent-loop.ts` | 高 |
| agent 工具调用与流式输出 | 理解 delta / 边界 / 幂等 | `apps/desktop/src/main/run-message-buffer.ts` | 高 |
| 事件溯源（event sourcing）与投影 | 权威事实源的全部意义 | `packages/session-events/src/index.ts`、`docs/canonical-transcript-design.md` | 高 |
| 幂等 / 崩溃恢复状态机 | 为什么重放不重复执行 | `apps/desktop/src/main/pi-agent-session.ts`、`agent.md` §会话与事件模型 | 高 |
| 审批三方门控（manual / accept-write / auto） | 产品安全边界核心 | `packages/coding-agent/src/effects`、`dsh-approval-policy.ts` | 高 |
| ACP / stdio 子进程协议 | 为什么 DSH 是 sidecar、为什么插件要注入 | `apps/desktop/src/main/dsh-agent-session.ts`、`dsh-pi-ai-profile.ts` | 中 |
| Agent SDK / 子进程生命周期 | Claude Runtime 怎么管 Claude Code | `packages/claude-transcript`、`docs/canonical-transcript-design.md` | 中 |

## 3. 重点亮点与学习顺序（先看这个）

按顺序读，能建立起"为什么这样设计"的完整因果链：

| # | 亮点 | 为什么重要 | 通用技术关键词 | 先看哪些文件 | 建议顺序 |
|---|---|---|---|---|---|
| 1 | 可插拔运行时内核统一 | 全项目核心主张，三内核收敛成一套 adapter | 适配器模式、能力声明、运行时切换 | `packages/runtime-contracts/src/index.ts`、`apps/desktop/src/main/session-supervisor.ts`、`agent.md` §RuntimeAdapter | 1 |
| 2 | 权威事实源与事件投影 | 一套 event log 投影出 chat / timeline / eval，不各自维护事实 | 事件溯源、投影、幂等合并 | `packages/contracts/src/index.ts`（SessionEvent 联合）、`packages/session-events/src/index.ts`、`docs/canonical-transcript-design.md` | 2 |
| 3 | 跨内核历史桥接插件 | DSH 不接受任意 seed，得注入 sidecar 插件才能共享历史 | sidecar 插件、hist 注入、增量同步 | `packages/dsh-transcript/src/dsh-session-import.ts`、`toDshSeed`、`agent.md` §DSH | 3 |
| 4 | 崩溃可恢复幂等状态机 | 重放不重复执行工具、不重复调用模型 | checkpoint、状态机、幂等 | `apps/desktop/src/main/pi-agent-session.ts`（`#recover`）、`session-store` 的 `RunCheckpoint` | 4 |
| 5 | 展示层分块流式与边界落库 | 完整消息先落库，渲染层再分块播放；解耦持久化边界与展示节奏 | 持久化边界、展示队列、能力差异吸收 | `apps/desktop/src/renderer/src/features/chat/use-message-presentation.ts` | 5 |
| 6 | 共享决策规则的跨内核审批 | Native/DSH 共用 effect 推导，各自独立门控 | 策略复用、决策规则、门控分离 | `packages/coding-agent/src/effects/effects.ts`、`dsh-approval-policy.ts` | 6 |

> 亮点 7、8（上下文压缩、行为评测）**在 pi-ling 当前是 Phase 2 规划**，成熟实现在同一产品线的姊妹仓库。若要把它们纳入面试主干，请直接看 `agent.md` §实施顺序 与 姊妹仓库源码，路径见 §5。

## 4. 项目现状（务必先读）

从 `agent.md`「当前交接状态（2026-09-07）」提炼：

- **主线已落地**：三 Runtime 统一接管；Native 迁移 `pi-ai@0.85.0`（commit `0974fba`）；DSH 固定基线（commit `6f38265`）。
- **DSH 桥接**：PR4 定方案 B（预物化后 resume）；PR5 完成 Canonical Session Bridge MVP（`toDshSeed` 全量导入 + 真实 recall smoke）；PR6 落地增量 delta 同步（append 模式）。
- **Phase 2 待做**：跨内核 handoff 增量同步的 Attachment/Compaction 支持、真正的上下文压缩、Eval 测试、部分 ACP 流式扩展。

结论：**演讲时别说"完成了上下文压缩"——pi-ling 还没做**。如果说，必须指明"这是同一产品线的成熟能力，pi-ling 规划对齐"，并挂到公开可验证的姊妹仓库。这是诚实边界，也是本面试中最容易被追问的点。

## 5. 推荐阅读

| 主题 | 通用技术点 | 建议阅读位置 | 预计时间 | 读完能回答什么 |
|---|---|---|---|---|
| 三内核如何统一 | 适配器、能力声明 | `packages/runtime-contracts/src/index.ts` + `agent.md` §RuntimeAdapter | 20min | "三套内核怎么接到同一个产品？" |
| 权威事实源 | 事件溯源、投影 | `packages/contracts/src/index.ts`（SessionEvent）+ `packages/session-events/src/index.ts` | 25min | "为什么只维护一套 Event Log？Chat/Timeline 从哪来？" |
| 崩溃恢复 | checkpoint 状态机 | `apps/desktop/src/main/pi-agent-session.ts`（`#recover`、`#handleCodingEvent`） | 30min | "重启后怎么保证不重复执行工具？" |
| 流式与持久化 | 展示队列、持久化边界 | `apps/desktop/src/renderer/src/features/chat/use-message-presentation.ts` + `App.tsx`（`liveMessageIds`） | 15min | "为什么不用 token 流驱动 UI？为什么只写完整消息？" |
| 跨内核审批 | 决策规则复用、各自门控 | `packages/coding-agent/src/effects/effects.ts` + `apps/desktop/src/main/dsh-approval-policy.ts` | 25min | "Native 和 DSH 怎么共用同一套审批判断？" |
| 外部内核历史注入 | sidecar 插件、seed | `packages/dsh-transcript/src/dsh-session-import.ts` + `docs/canonical-transcript-design.md` | 30min | "DSH 不接受 seed，怎么把历史喂给它？" |
| 执行循环基础 | ReAct | `packages/agent-core/src/agent-loop.ts` | 30min | "工具调用/审批/取消怎么在循环里跑？" |
| 产品目标与原则 | 架构决策 | `agent.md` 全文 | 15min | "为什么要这么做、不做什么？" |

> 姊妹仓库（同一产品线，含上下文压缩 + 行为评测的成熟实现）：
> `E:\LingCoWork`；关键包 `internal/compaction`（压缩）、`internal/codingeval`（评测）、`docs/eval/01-agent-eval.md`。

## 6. 核心原理解析

### 6.1 可插拔运行时内核
**问题**：换 agent 内核，产品行为和事件语义不该跟着变。
**机制**：定义 `RuntimeAdapter`（initialize/createSession/send/cancel/resolvePermission/closeSession/subscribe/dispose）+ `RuntimeCapabilities` 显式声明能力，Supervisor 按 session 路由。切换只在完整消息/Turn 边界进行。
**落点**：`session-supervisor.ts` 的 `switchRuntime`，仅 idle 时允许，失败回滚。

### 6.2 权威事实源与投影
**问题**：多内核各自有 transcript/持久化，若产品层也各存一份，事实会分叉。
**机制**：只维护一套 versioned Session Event Log，`projectCanonicalMessages`/`projectTimelineSnapshot` 是只读投影，Runtime 原生 transcript 仅作可重建的恢复投影。
**落点**：`packages/session-events/src/index.ts`、`docs/canonical-transcript-design.md`。

### 6.3 跨内核历史桥接
**问题**：DSH 的 ACP/SDK 不暴露任意 seed。
**机制**：注入 Cordis sidecar 插件，轮询 `DSH_HOME/pi-ling-import/`。`toDshSeed` 把 Canonical → DSH SessionEvent[]，`agents.create({ seed })` 消费；`append` 模式按 `lastSyncedCanonicalSeq` 水位增量追平。
**落点**：`packages/dsh-transcript/src/dsh-session-import.ts`。

### 6.4 崩溃可恢复的幂等状态机
**问题**：进程崩溃后重启，不能重复执行工具、不能白烧一次模型调用。
**机制**：`RunCheckpoint` 记录 `started/streaming/awaiting_approval/approved_pending_exec/executing_tool/between_turns/terminal`。恢复时按状态幂等推进：已有 `tool_end` 不重执行；只有 `tool_start` 无结果标记 crashed；`awaiting_approval` 重发请求前先查事件日志是否已有。
**落点**：`pi-agent-session.ts` 的 `#recover`。

### 6.5 展示层分块流式
**问题**：token 流直接驱动 UI 会让库里出现半条消息，历史回放和实时渲染变成两套路径，而且依赖内核提供 token 流（DSH 经 ACP 拿不到）。
**机制**：完整消息先落 `session_events`；Renderer 收到 `assistant_end` 后把 messageId 放入 `liveMessageIds`，`useMessagePresentation` 对完整文本按标点/长度/代码块分块，按剩余块数以 24–55ms 自适应间隔逐块 reveal。历史消息不播动画，直接全文。
**落点**：`apps/desktop/src/renderer/src/features/chat/use-message-presentation.ts`、`App.tsx`。
**遗留**：`RunMessageBuffer`（16ms delta 合并）仍在主进程运行，但改造后已无消费者，属于待清理的死管道。

## 7. 关键技术决策

| 决策 | 备选/取舍 | 风险 | 验证 |
|---|---|---|---|
| 三内核统一 adapter vs 各自 UI | 各内核差异大，统一要付出抽象成本 | 能力被低估、功能被阉割 | 用 `RuntimeCapabilities` 显式声明，不做能力一致的假设 |
| 只维护一套 Event Log vs 各自持久化 | 统一更干净，但外核 resume 要保留原生数据 | 无损恢复、thinking signature 丢失 | Runtime 原生 projection 另存，不强行混用 |
| DSH 用 ACP + sidecar 插件 vs 官方 SDK | SDK 不给 seed、resume 受限 | 插件安全性 | 隔离 sidecar、固定版本、用户确认 |
| 审批按 effect 而非仅工具名 | 按工具名拦不准，会漏拦/误拦 | 需建 effect 建模 | `deriveEffect`/`classifyCommand`/`effectDigest` |
| 崩溃恢复幂等重放 | 简单做法是重试整轮 | 重复执行副作用 | checkpoint 状态机 + 事件日志查重 |

## 8. 量化与验证（建议）

- DSH 桥接链路的真实性验证：**真实 DeepSeek 模型**导入含代号历史后，下一轮 prompt 回答出该代号（`docs/canonical-transcript-design.md` §真实 PoC）。这是"DSH 能消费共享历史"的硬证明，面试最值得讲。
- 恢复语义的验证方式：单测覆盖四种 checkpoint 状态对应的重放行为；建议补崩溃注入测试。
- 待测：跨内核 handoff 的增量同步在真实长会话下的水位正确性；审批误拦/漏拦率；Compaction 加入后的事实问答一致率（与姊妹仓库一致）。

## 9. 自学提醒

看不懂某文件或原理时，继续追问 AI / 结合 `agent.md` 的「当前交接状态」对照着读。本文件负责给路径与结论，不提供逐行讲解；请按 §3 顺序建立因果链，而不是孤立背文件。
