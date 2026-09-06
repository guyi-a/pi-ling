# pi-ling 开发指南

## 项目目标

在本仓库独立开发 Electron Coding Agent 产品，统一提供聊天、代码修改、终端、Diff、审批、会话恢复和评测体验。

- 不修改或复制 LingCoWork 主工程。
- LingCoWork 仅作为需求、设计和评测参考。
- 当前只实现自研 Runtime，模型层限定为 DeepSeek 和 Anthropic Claude。

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
  ├─ Credential storage
  ├─ Effect approval policy
  └─ Worker lifecycle
        ↓ RuntimeAdapter
        ├─ NativeRuntime
        │     └─ @pi-ling/coding-agent
        │           ├─ @pi-ling/agent-core
        │           └─ @pi-ling/ai
        └─ DshRuntime
              └─ ACP stdio → DSH sidecar
```

## Runtime 规划

### 自研 Runtime（主 Runtime）

- `@pi-ling/ai` 负责模型协议，只实现 DeepSeek OpenAI-compatible Chat Completions 与 Anthropic Messages。
- `@pi-ling/agent-core` 负责状态、事件、上下文、取消和 ReAct 工具循环。
- `@pi-ling/coding-agent` 负责 Coding Harness 和全部产品内置 Agent 能力。
- `vendor/pi-ai` 与 `vendor/pi-agent-core` 保留为 MIT 源码参考，不作为运行依赖。
- DeepSeek Harness 通过固定版本的 ACP sidecar 作为 Experimental Runtime 接入。
- Claude Agent SDK 和其他模型 Provider 不在当前实现范围。
- 产品层继续负责 effect 审批、权限边界、沙箱、持久化和恢复。

### DSH Runtime

- 固定 `dsh-v0.1.3-alpha.1` / `d347e703908d0406b7a7ef80e3a0e594d86b2215`，不跟随 latest。
- Electron Main 使用 `@agentclientprotocol/sdk` 驱动 `dsh --profile acp`，不嵌入 Cordis。
- DSH_HOME 按版本隔离，DSH 原生 session id 与产品 session id 分开持久化。
- 产品审批模式映射 ACP one-shot permission；未知、删除和破坏性执行不自动允许。
- DSH developer preview 未经安全审计，只能在 feature flag 和首次安全确认后启用。

## Coding Harness

- 所有 Harness 能力直接实现于 `packages/coding-agent`，不建立扩展系统。
- 内部按 `tools`、`workspace`、`effects`、`approval`、`sessions`、`mcp`、`skills`、`hooks`、`validation` 分模块组织。
- 上述模块均为产品内置代码，不提供 extension API、插件注册器、第三方动态加载或插件市场。
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

- 每个会话同一时刻只能有一个活跃 Runtime；前一个结束并释放后允许顺序切换。
- 同时保存 Runtime 原始事件和标准 UI 投影。
- 原始事件用于恢复、调试和完整保真。
- UI 投影至少包含 `text`、`thinking`、`tool`、`approval`、`usage`、`status`。
- UI 事件统一使用 `sessionId`、`runId`、`turnId`、`itemId` 和会话内单调递增 `seq`。
- Main 按执行顺序发布 timeline；snapshot 与实时事件必须经过同一个幂等 reducer。
- 每个 ReAct assistant turn、tool call 和 approval 都是独立 timeline item，不得按 Prompt 合并。
- Renderer 只从 timeline 投影 Chat；assistant 使用流式 Markdown，tool output 保持等宽纯文本。
- thinking 与工具步骤进入可折叠执行过程，pending approval 必须保持展开可见。
- 页面采用紧凑暗色工作台布局，不使用宣传式 Hero；用户消息气泡与 assistant 平铺内容保持清晰区分。
- Workspace 作为 Project 在侧栏分组，Session 隶属于 Workspace；添加目录和新建会话都从侧栏进入，不使用顶部全局选择器。
- 每个 Session 持久化 `manual`、`accept-write`、`auto` 三档审批模式，切换入口位于 Composer。
- 标准投影必须可版本化，不能破坏原始事件。
- 第一版不转换不同 Runtime 的原生历史。
- Runtime 切换可以继续传递标准消息；私有 checkpoint、thinking 签名和执行中状态不得混用。
- 持久化应支持应用崩溃后的会话恢复，并明确区分可恢复、已取消、失败和已完成状态。
- Electron Main 使用 `node:sqlite` 保存 session、timeline、完整 transcript、run checkpoint、pending approval 和 file baseline。
- 消息以稳定 event key 幂等写入；approval resolve 必须先持久化再解除工具门控。
- 已有 `tool_end` 的 callId 不得重复执行；只有 `tool_start` 而无 durable result 的工具标记 crashed，不自动重试。

## 安全边界

- API Key 和其他凭据只能由 Main 安全存储和使用。
- 文件写入、命令执行、网络访问等副作用由产品层统一建模并审批。
- `manual` 询问写入和普通命令；`accept-write` 自动允许工作区写入；`auto` 自动允许普通操作。未知 effect、破坏性命令和敏感写入在任何模式下都必须询问。
- 不执行第三方插件代码，不提供动态插件加载。
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
- `E:\claude-agent-sdk-python`：Python SDK 参考。
- `E:\deepseek-harness`：DSH 0.1.3-alpha.1 官方源码。
- `E:\dsh-for-humans`：DSH 教程，不是源码。

## 开发约束

- 开发前先检查现有结构和依赖，不盲目复制参考项目。
- Phase 1 范围内优先完成可运行的纵向闭环，再扩展 UI 和工具能力。
- 修改公共协议时同步检查 Main、Preload、Renderer 和 Runtime Worker。
- 提交前运行项目已有的格式化、类型检查和测试命令。
- DSH 依赖必须固定版本并通过 ACP 契约测试；未经明确要求不引入 Claude Runtime。
