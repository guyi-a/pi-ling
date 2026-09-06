# pi-ling 开发指南

## 项目目标

在本仓库独立开发 Electron Coding Agent 产品，统一提供聊天、代码修改、终端、Diff、审批、会话恢复和评测体验。

- 不修改或复制 LingCoWork 主工程。
- LingCoWork 仅作为需求、设计和评测参考。
- 产品统一支持 Native、DeepSeek Harness 和 Claude Agent SDK Runtime；
  Native 模型层限定为 DeepSeek 和 Anthropic Claude。

## 技术栈与架构

- Electron + React + TypeScript。
- 采用 monorepo，分离 Renderer、Main、Preload、共享协议和 Runtime 实现。
- Renderer 只负责 UI，不持有密钥，不直接访问文件系统或执行命令。
- Renderer 通过类型安全的 Preload IPC 调用 Electron Main。
- Main Supervisor 负责 Runtime 注册、会话路由、凭据存储、effect 审批策略和 Worker 生命周期。
- Runtime 必须运行在独立 Worker、子进程或 sidecar 中，不能嵌入 Renderer，也不能用长任务阻塞 Main。

推荐依赖方向：

```text
Electron Renderer
  └─ React UI: Chat / Diff / Files / Terminal / Approval
        ↓ typed preload IPC
Electron Main Supervisor
  ├─ Runtime registry
  ├─ Session routing
  ├─ Canonical Session Event Log
  ├─ RunMessageBuffer
  ├─ Credential storage
  ├─ Effect approval policy
  └─ Worker lifecycle
        ↓ RuntimeAdapter
        ├─ NativeRuntime
        │     └─ @pi-ling/coding-agent
        │           ├─ @pi-ling/agent-core
        │           └─ @pi-ling/ai
        ├─ DshRuntime
        │     └─ ACP stdio → custom DSH Profile sidecar
        └─ ClaudeRuntime
              └─ Claude Agent SDK → Claude Code subprocess
```

## Runtime 规划

### Native Runtime

- `@pi-ling/ai` 负责模型协议，只实现 DeepSeek OpenAI-compatible Chat Completions 与 Anthropic Messages。
- `@pi-ling/agent-core` 负责状态、事件、上下文、取消和 ReAct 工具循环。
- `@pi-ling/coding-agent` 负责 Coding Harness 和全部产品内置 Agent 能力。
- `vendor/pi-ai` 与 `vendor/pi-agent-core` 保留为 MIT 源码参考，不作为运行依赖。
- 产品层负责统一 Session Event、Canonical Messages、effect 审批、权限边界、
  持久化、恢复和 Eval。

### DSH Runtime

- 固定 `dsh-v0.1.3-alpha.1` / `d347e703908d0406b7a7ef80e3a0e594d86b2215`，不跟随 latest。
- Electron Main 使用 `@agentclientprotocol/sdk` 驱动 `dsh --profile acp`，不嵌入 Cordis。
- DSH_HOME 按版本隔离，DSH 原生 session id 与产品 session id 分开持久化。
- DSH 使用 pi-ling Cordis bridge bundle，承载 `@pi-ling/ai` Adapter、
  Canonical Transcript Seed 和 ACP live stream。
- 产品审批模式映射 ACP one-shot permission；未知、删除和破坏性执行不自动允许。
- DSH developer preview 未经安全审计，只能在 feature flag 和首次安全确认后启用。

### Claude Runtime

- Electron Main 使用 `@anthropic-ai/claude-agent-sdk` 管理 Claude Code 子进程。
- Claude partial message 作为 transient frame，完整 Assistant Message 才写入
  durable Session Event。
- Claude `sessionStore` 将 opaque Transcript 投影镜像到 pi-ling SQLite，
  用于原生 Resume。
- 跨 Runtime 切换到 Claude 使用 `shouldQuery:false` 注入 Canonical
  delta/summary；不得宣称为无损 cold seed。
- `PreToolUse` 与 `canUseTool` 映射到产品统一 Effect Approval Policy。

## Coding Harness

- Native Harness 能力直接实现于 `packages/coding-agent`，不建立产品级扩展系统。
- 内部按 `tools`、`workspace`、`effects`、`approval`、`sessions`、`mcp`、`skills`、`hooks`、`validation` 分模块组织。
- Native 模块不提供 extension API、插件注册器、第三方动态加载或插件市场；
  DSH 自身 Cordis 插件只在隔离 sidecar 和受控 Profile 中运行。
- Workspace 校验、effect 审批和凭据边界属于强制安全机制，任何内部模块均不得绕过。
- `agent-core` 只保留领域无关的工具接口及 `beforeToolCall`、`afterToolCall` 等必要调用点，具体策略由 `coding-agent` 实现。

## RuntimeAdapter

所有 Runtime 通过统一接口接入，至少支持：

```ts
interface RuntimeAdapter {
  createSession(...args: unknown[]): Promise<unknown>;
  send(...args: unknown[]): Promise<void>;
  events(...args: unknown[]): AsyncIterable<unknown>;
  approve(...args: unknown[]): Promise<void>;
  cancel(...args: unknown[]): Promise<void>;
  resume(...args: unknown[]): Promise<unknown>;
  fork(...args: unknown[]): Promise<unknown>;
  dispose(...args: unknown[]): Promise<void>;
  getCapabilities(): RuntimeCapabilities;
}
```

实际开发时应用明确的领域类型替换 `unknown`，并保持接口位于共享协议包中。

每个 Runtime 必须显式声明能力，不得假定能力一致：

- model switching
- partial streaming
- tool approval
- MCP
- hooks
- sandbox
- subagents
- resume/fork
- file checkpoint

## 会话与事件模型

- 产品只维护一套 versioned Session Event Log 作为权威事实源。
- Canonical Messages、Chat Timeline、Cursor Run Activity 和 Eval 都从
  Session Event Log 投影，不维护互相独立的消息与 Timeline 事实。
- Runtime 原生 Transcript 只作为可重建的 Resume projection；通过
  `runtime_sessions` 保存 external id、同步水位和 capability。
- Durable Event 只在完整语义边界写 SQLite；text/reasoning delta 进入
  Electron Main `RunMessageBuffer`，约 16ms 合并后通过 IPC 推送。
- 事件统一使用 `sessionId`、`runId`、`turnId`、`messageId`、
  `toolCallId` 和会话内单调递增 `seq`。
- “当前选中 Session”与“正在运行的 Session”分离；切换页面不得
  cancel/dispose 后台 Run。
- snapshot、Main Buffer 和实时 frame 按 Session 隔离并幂等合并；过期
  activation/snapshot 不得覆盖当前页面。
- Renderer 按整个 Run 聚合执行活动，完成后压缩摘要，展开后显示原始
  Tool、Approval、Output 和 Error。
- 页面采用紧凑暗色工作台布局，不使用宣传式 Hero；用户消息气泡与 assistant 平铺内容保持清晰区分。
- Workspace 作为 Project 在侧栏分组，Session 隶属于 Workspace；添加目录和新建会话都从侧栏进入，不使用顶部全局选择器。
- 每个 Session 持久化 `manual`、`accept-write`、`auto` 三档审批模式，切换入口位于 Composer。
- 标准投影必须可版本化，不能破坏原始事件。
- Runtime 只能在完整消息/Turn 边界切换；目标 Runtime 从同一 Canonical
  Message projection 获取缺失历史。
- DSH 使用真实 SessionEvent Seed；Claude 使用 opaque Transcript Resume
  与 Canonical Context Handoff。
- 私有 checkpoint、thinking signature、surface/replay state 和执行中状态
  进入 Runtime raw projection，不强行混用。
- 持久化应支持应用崩溃后的会话恢复，并明确区分可恢复、已取消、失败和已完成状态。
- Electron Main 使用 `node:sqlite` 保存 Workspace、Session Event、
  Runtime projection、run checkpoint、pending approval 和 file baseline。
- 消息以稳定 event key 幂等写入；approval resolve 必须先持久化再解除工具门控。
- 已有 `tool_end` 的 callId 不得重复执行；只有 `tool_start` 而无 durable result 的工具标记 crashed，不自动重试。

## 安全边界

- API Key 和其他凭据只能由 Main 安全存储和使用。
- 文件写入、命令执行、网络访问等副作用由产品层统一建模并审批。
- `manual` 询问写入和普通命令；`accept-write` 自动允许工作区写入；`auto` 自动允许普通操作。未知 effect、破坏性命令和敏感写入在任何模式下都必须询问。
- Native Runtime 不执行第三方插件代码；DSH 插件仅在隔离 sidecar 中通过
  明确安装、版本固定和用户确认后执行。
- 默认禁止多个活跃会话同时修改同一工作区。
- IPC 必须使用白名单通道、结构化参数和运行时校验，禁止暴露通用 Node/Electron 能力。

## 实施顺序

### Phase 1：自研 Runtime

1. 建立 Electron + React + TypeScript monorepo。
2. 实现 `@pi-ling/ai` 共享协议和 DeepSeek、Anthropic Provider。
3. 实现 `@pi-ling/agent-core` 状态、事件和 ReAct 循环。
4. 实现 `@pi-ling/coding-agent` 及内置 Harness 模块。
5. 打通 Main / Preload / Renderer 的类型安全 IPC。
6. 实现 Chat/Event Stream。
7. 实现 Workspace、Diff、Terminal。
8. 实现 Effect Approval。
9. 实现 Session 持久化、取消和崩溃恢复。

第一条端到端流程必须覆盖：

```text
Renderer 输入 Prompt
  → Preload IPC
  → Main Supervisor 路由会话
  → Agent Core 执行
  → DeepSeek 或 Anthropic Provider
  → 原始事件持久化
  → 标准事件投影
  → IPC 流式推送
  → Renderer 更新消息和状态
```

同时覆盖错误、取消、审批请求和进程异常退出。

### Phase 2：统一 Runtime 与会话架构

1. 定义 versioned Session Event 与 Canonical Message projection。
2. 将 SQLite 迁移为 `session_events + runtime_sessions`，保留旧表兼容。
3. 实现 Main `RunMessageBuffer`、16ms delta merge 和 Session reconnect。
4. 解耦 selected Session 与 active Runs。
5. 让 Native 使用统一 Event Log。
6. 将 DSH LLM/Transcript PoC 合并为可分发 Cordis bridge bundle，并补
   ACP token stream。
7. 实现 Claude Agent SDK Runtime、opaque SessionStore projection 与
   Approval mapping。
8. 实现 Cursor 风格 Run Activity projector。
9. 完成跨 Runtime、跨 Session、崩溃恢复和 Eval 测试。

## 工程原则

- 优先建立稳定的领域协议，Runtime 专属类型留在各自适配层。
- 不设计 extension API 或动态插件机制；产品能力直接作为 `coding-agent` 内部模块实现。
- 所有跨进程消息必须可序列化、可版本化并可关联会话与事件 ID。
- 副作用审批应基于 effect，而不是仅基于工具名称。
- 会话路由、事件持久化和 UI 投影需支持幂等处理。
- 对依赖 Runtime 私有行为的代码添加适配层，避免泄漏到 UI。
- 新增功能应包含与风险相称的类型检查、单元测试或端到端验证。
- Coding Eval 应作为当前 Runtime 的黑盒 Harness，并借鉴 LingCoWork `internal/codingeval` 的确定性评测思路。

## 当前本地参考

- `E:\LingCoWork`：Go + Eino + Electron 工作站，仅供参考。
- `E:\pi`：Pi 0.85.0，MIT。
- `@anthropic-ai/claude-agent-sdk`：Claude Runtime 的 TypeScript SDK，
  当前 PoC 固定 `0.3.263`。
- `E:\deepseek-harness`：DSH 0.1.3-alpha.1 官方源码。
- `E:\dsh-for-humans`：DSH 教程，不是源码。

## 开发约束

- 开发前先检查现有结构和依赖，不盲目复制参考项目。
- Phase 1 范围内优先完成可运行的纵向闭环，再扩展 UI 和工具能力。
- 修改公共协议时同步检查 Main、Preload、Renderer 和 Runtime Worker。
- 提交前运行项目已有的格式化、类型检查和测试命令。
- DSH 依赖必须固定版本并通过 ACP/Bridge 契约测试；Claude Agent SDK
  必须固定版本并保留 KLink/官方 Anthropic 配置边界。
