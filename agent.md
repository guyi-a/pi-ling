# pi-ling 开发指南

## 项目目标

在本仓库独立开发 Electron Coding Agent 产品，统一提供聊天、代码修改、终端、Diff、审批、会话恢复和评测体验。

- 不修改或复制 LingCoWork 主工程。
- LingCoWork 仅作为需求、设计和评测参考。
- 三套 Runtime 并列设计、分阶段实现，Phase 1 只实现 Pi Runtime。

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
        ├─ PiRuntime Worker
        ├─ ClaudeRuntime CLI
        └─ DshRuntime Sidecar
```

## Runtime 规划

### Pi Runtime（主 Runtime）

- 使用 `@earendil-works/pi-coding-agent`。
- 底层使用其现有的 `pi-agent-core + pi-ai` 体系。
- 使用 `pi-ai` 完成多模型和 provider 适配。
- 不使用裸 `pi-agent-core` 重新实现 Coding Harness。
- 产品层必须补充 effect 审批、权限边界和沙箱。

### Claude Agent SDK（Phase 2）

- Electron 优先采用 TypeScript SDK。
- Runtime 本质上管理 Claude Code CLI 子进程，通常一个活跃会话对应一个进程。
- 模型层由 Anthropic 管理，不得替换为 `pi-ai`。
- 接入前确认 Anthropic Commercial Terms。

### DeepSeek Harness（Phase 3）

- 使用 Cordis 插件架构，可复用已有 `llm-pi-ai` provider。
- 通过 SDK/ACP sidecar 接入，不把 Cordis 嵌入 Renderer。
- developer preview 阶段必须固定版本、使用 feature flag，并隔离适配层。
- `E:\dsh-for-humans` 只是教程，不作为 DSH 源码。

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

- 每个会话只能由一个 Runtime 持有。
- 同时保存 Runtime 原始事件和标准 UI 投影。
- 原始事件用于恢复、调试和完整保真。
- UI 投影至少包含 `text`、`thinking`、`tool`、`approval`、`usage`、`status`。
- 标准投影必须可版本化，不能破坏原始事件。
- 第一版不转换不同 Runtime 的原生历史。
- 跨 Runtime handoff 必须创建新会话，只传递显式摘要和用户选定的文件。
- 持久化应支持应用崩溃后的会话恢复，并明确区分可恢复、已取消、失败和已完成状态。

## 安全边界

- API Key 和其他凭据只能由 Main 安全存储和使用。
- 文件写入、命令执行、网络访问等副作用由产品层统一建模并审批。
- 插件默认视为不可信代码。
- 默认禁止三套 Runtime 同时修改同一工作区。
- 多 Runtime 对比必须在独立 Git worktree 中运行。
- IPC 必须使用白名单通道、结构化参数和运行时校验，禁止暴露通用 Node/Electron 能力。

## 实施顺序

### Phase 1：Pi Runtime

1. 建立 Electron + React + TypeScript monorepo。
2. 定义 RuntimeAdapter、capabilities 和共享领域类型。
3. 实现 PiRuntime Worker 的最小适配。
4. 打通 Main / Preload / Renderer 的类型安全 IPC。
5. 实现 Chat/Event Stream。
6. 实现 Workspace、Diff、Terminal。
7. 实现 Effect Approval。
8. 实现 Session 持久化、取消和崩溃恢复。

第一条端到端流程必须覆盖：

```text
Renderer 输入 Prompt
  → Preload IPC
  → Main Supervisor 路由会话
  → PiRuntime Worker 执行
  → 原始事件持久化
  → 标准事件投影
  → IPC 流式推送
  → Renderer 更新消息和状态
```

同时覆盖错误、取消、审批请求和进程异常退出。

### Phase 2

接入 Claude Agent SDK，用真实实现验证 RuntimeAdapter 的通用性，避免为 Claude 修改 Pi 专属语义。

### Phase 3

通过 SDK/ACP sidecar 接入 DSH，并使用 feature flag 开启。

### Phase 4

实现 Runtime handoff、并行 worktree 和 A/B Eval。

## 工程原则

- 优先建立稳定的领域协议，Runtime 专属类型留在各自适配层。
- 不为尚未接入的 Runtime 编写虚假实现；只保留必要扩展点。
- 所有跨进程消息必须可序列化、可版本化并可关联会话与事件 ID。
- 副作用审批应基于 effect，而不是仅基于工具名称。
- 会话路由、事件持久化和 UI 投影需支持幂等处理。
- 对依赖 Runtime 私有行为的代码添加适配层，避免泄漏到 UI。
- 新增功能应包含与风险相称的类型检查、单元测试或端到端验证。
- Coding Eval 最终应作为统一的黑盒 Harness 测试三套 Runtime，并借鉴 LingCoWork `internal/codingeval` 的确定性评测思路。

## 当前本地参考

- `E:\LingCoWork`：Go + Eino + Electron 工作站，仅供参考。
- `E:\pi`：Pi 0.85.0，MIT。
- `E:\claude-agent-sdk-python`：Python SDK 参考。
- `E:\dsh-for-humans`：DSH 教程，不是源码。

## 开发约束

- 开发前先检查现有结构和依赖，不盲目复制参考项目。
- Phase 1 范围内优先完成可运行的纵向闭环，再扩展 UI 和工具能力。
- 修改公共协议时同步检查 Main、Preload、Renderer 和 Runtime Worker。
- 提交前运行项目已有的格式化、类型检查和测试命令。
- 未经明确要求，不引入 Claude 或 DSH 的运行时依赖。
