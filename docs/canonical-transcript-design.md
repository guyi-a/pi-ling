# Canonical Transcript 设计研究

记录时间：2026-09-06  
当前阶段：DSH 与 Claude 数据研究及真实 PoC 已完成  
固定 DSH 版本：`dsh-v0.1.3-alpha.1`  
固定 commit：`d347e703908d0406b7a7ef80e3a0e594d86b2215`

## 产品原则

pi-ling 只维护一套权威 Canonical Transcript。Native、DSH 和未来的
Claude Runtime 都是这套 Transcript 的输入/输出适配器。

Runtime 自己生成的 transcript 可以保留用于原生 Resume，但只能视为
可重建的派生数据，不能成为产品层事实源。

## DSH 的三层数据模型

DSH 将持久化、模型上下文和实际请求分成三层：

```text
Session Event Log
  → Surface
  → Session.deriveMessages()
  → GenerateOptions.messages
  → LLM Adapter
```

### Session Event Log

append-only 的 durable 事实源，每条事件带：

- `type`
- 会话内连续 `seq`
- `time`
- `data`
- 可选 surface metadata

日志除对话外，还包含 turn、step、tool、approval、compaction、retry、
subagent 等运行事实。

### Surface

Surface 决定哪些事件真正进入下一次模型请求。只有三种事件属于模型可见
消息：

```text
user/message
assistant/message
tool/result
```

其他事件用于执行、审计和 UI，不直接进入模型上下文。

Surface 支持：

- `append`：追加模型可见消息；
- `replace`：用摘要替换一段旧消息的模型视图。

DSH Compaction 不删除原始日志，而是通过 replace 改变模型看到的 Surface。

### deriveMessages

`Session.deriveMessages()` 按 Surface 顺序将三种事件转换成 DSH
`Message[]`，这是 Agent Loop 构造下一次 `GenerateOptions.messages` 的唯一
消息来源。

因此判断历史导入是否正确的标准是：

```text
导入后的 session.deriveMessages()
=== 期望的 Canonical Messages
```

## DSH Message

公共字段：

```text
id
role
content[]
source
```

主要角色：

- User Message
- Assistant Message
- Tool Result Message（role 仍为 user）

主要 ContentBlock：

- `text`
- `reasoning`
- `image`
- `file`
- `tool-call`
- `tool-result`

Assistant 的 provider、model 和 adapter 私有 `replayState` 位于
`message.source`。Usage 位于 `assistant/message` 事件，而不是 Message
对象内部。

System prompt 和 Tool schema 不属于 messages，保存在
`request/header` 事件中。

## DSH Session Event 与 Canonical 映射

### Canonical → DSH

- User → `user/message` + `surfaceOp: append`
- Assistant text/reasoning/tool-call → `assistant/message`
- Tool Result → `tool/result` + `surfaceOp: append`
- System/Tools/Provider/Model → `request/header`
- Usage → `assistant/message.data.usage`
- Image/File → DSH Attachment Store 中的 content-addressed reference
- Turn/Step → balanced `turn/start/end` 与 `step/start/end`

导入 Assistant Message 时必须同时生成与 content 一致的最小
`AssistantStreamRecord`，否则 DSH 的 seed 校验会拒绝历史。

### DSH → Canonical

- 模型上下文优先读取 `deriveMessages()`
- 用户完整历史读取 append surface events
- `assistant/message.stream` 可用于重建流式展示
- `tool/call` 用于 Timeline，不在 Canonical 中重复制造第二个 Tool Call
- `request/header` 转换为 Session/Run metadata
- log-only 事件转换为 Timeline/Eval 数据，不进入 Canonical messages

## 不能直接统一的 DSH 字段

以下字段保存在 `rawPayload.dsh`：

- Adapter 私有 `replayState`
- 完整 timed stream
- Tool 私有 meta
- Plugin message source 与 context form
- Surface replace 和 source event 关系
- Compaction shadow 信息
- 原始 event seq、turn、step
- Provider 特有 finish/replay 数据

## DSH 持久化

默认 ACP Profile 使用 JSONL SessionPersistence：

```text
DSH_HOME/sessions/<project>/<session>/events.v2.jsonl
```

第一行是 Session Header，后续每行是一条 Session Event。

`SessionPersistence` 是 Cordis 可替换服务，不绑定 JSONL。主要接口：

- `create`
- `open`
- `read`
- `append`
- `flush`
- `stat`
- `list`

因此 pi-ling 可以实现自己的 DSH SessionPersistence plugin，将 DSH 的
event log 映射到 pi-ling 数据库，或者根据 Canonical Transcript 生成可供
DSH Resume 的 event seed。

## 历史注入能力

### DSH 内部支持

DSH 内部存在以下能力：

- `agents.create({ seed })`
- `agents.resume(...)`
- `Session.create(seed)`
- `Session.fromRestore(seed)`
- `SessionPersistence.handle.append(events)`
- `Session.append(...)`

所以 DSH 架构本身支持外部历史。

### ACP 对外未暴露

ACP 支持 Session create/resume，但 Session create 不接受 history/seed。
Resume 只能恢复已经存在于 DSH SessionPersistence 中的日志。

### SDK 对外也未暴露

当前 TypeScript SDK JSON-RPC 主要方法：

- `initialize`
- `session/prompt`
- `shutdown`

SDK 首次 prompt 时创建 Session，但不接受 seed；prompt 一定会唤醒模型，
不能作为静默历史导入。

SDK 会转发 durable `session.event`，但同样没有暴露
`agent/assistant-stream` token delta。

## 本阶段关键结论

1. DSH 内部数据结构可以表达 pi-ling Canonical Transcript。
2. 单纯从 ACP 改成 DSH SDK，不能解决历史注入。
3. 当前 SDK 在 Session create/resume 能力上不比 ACP 更适合桌面产品。
4. 共享历史需要一个 pi-ling DSH Cordis plugin，使用内部 seed API；或
   实现 pi-ling SessionPersistence backend 后让 DSH Resume。
5. 推荐优先做小型 seed plugin PoC，验证
   `Canonical → SessionEvent[] → deriveMessages()`。
6. PoC 成功后再决定继续 ACP，还是使用 SDK 作为 transport。

## 最小 PoC（已验证）

构造一轮 Canonical 历史：

```text
User: hello
Assistant: hi
```

转换为合法 DSH seed：

```text
request/header
turn/start
step/start
user/message
assistant/message
step/end
turn/end
```

`@pi-ling/dsh-transcript` 已通过 `agents.create({ seed })` 创建 Agent，并
断言：

```text
session.deriveMessages()
```

返回与 Canonical 相同的 User/Assistant 内容。然后再发送下一条真实 Prompt，
验证模型能够引用导入历史。

真实验证使用以下 Canonical 历史：

```text
User: My test code is ORANGE-42.
Assistant: I will remember that code.
```

在 seeded DSH Agent 中继续询问测试代号，真实 DeepSeek 模型回答包含
`ORANGE-42`。这证明：

```text
Canonical → DSH SessionEvent[] → agents.create({ seed })
→ deriveMessages() → 下一轮真实模型请求
```

整条链路可行。

PoC 当前仅支持完整的 text-only user/assistant pairs。Tool Call、Tool
Result、Reasoning、Attachment、Compaction 和产品持久化接线不在本阶段。

## Claude Agent SDK 数据模型

研究基线：`@anthropic-ai/claude-agent-sdk@0.3.263`，对应 Claude Code
`v2.1.263`。这里指本地 Agent SDK，不是 Anthropic Managed Agents API。

SDK Client 运行在 pi-ling Electron Main 中，实际 Agent 由 SDK 启动的
Claude Code 子进程执行。

### SDKMessage

`SDKMessage` 不只是对话消息，而是一组开放且快速增长的运行事件。产品层应
分为三类投影：

1. 对话：User、Assistant、Tool Use、Tool Result。
2. Timeline：Result、Partial Stream、Tool Progress、Hook、Task/Subagent、
   Permission、Compaction、Retry。
3. Runtime 状态：Init、Status、Auth、Rate Limit、Session State、
   Mirror Error。

Assistant 消息包装 Anthropic `BetaMessage`，主要包含：

- API message id
- model
- content blocks
- stop reason
- usage

常见 content blocks：

- text
- thinking
- redacted thinking
- tool use
- tool result
- server/MCP tool blocks

必须区分不同 ID：

- SDK transcript wrapper UUID
- Anthropic API message ID
- Tool Use ID
- User Message UUID
- Parent Tool/Subagent ID

它们不能被合并成一个 Canonical ID。

### Claude 流式

启用 `includePartialMessages` 后，SDK 发送 `stream_event`：

- message start
- content block start
- content block delta
- content block stop
- message delta
- message stop

delta 可包含：

- text delta
- thinking delta
- thinking signature delta
- tool input JSON delta
- citation/compaction delta

Partial 结束后仍会收到完整 Assistant Message。Canonical 只能在完整消息
边界提交一次；Partial 只进入 Main Run Buffer，不能再次写成第二条消息。

### Thinking

Claude Thinking 除文本外还包含不可解释的 `signature`；redacted thinking
包含 opaque data。继续原生 Claude 会话时需要原样保留，因此 Canonical
公共层保存语义，完整块另存于 `rawPayload.claude`。

### Usage

Assistant/API usage 与最终 Result usage 是不同层级。最终成本和完整 Query
统计应保留：

- per-model usage
- total cost
- duration/API duration
- terminal result

Subagent、Compaction 和辅助调用不能仅从最后一条 Assistant usage 推断。

## Claude Transcript 与 SessionStore

Claude Agent SDK 默认 `persistSession: true`，Claude Code 子进程持续写入
自己的内部 JSONL Transcript，并通过 Session ID 支持：

- list
- get messages
- resume
- fork
- resume at message
- delete

`sessionStore` 是 Alpha 外部镜像接口：

```text
append
load
listSessions
listSessionSummaries
delete
listSubkeys
```

它保存的是 opaque `SessionStoreEntry[]`，不是 Canonical Message。Claude
仍会先写本地 JSONL，再异步 mirror 到外部 Store，所以它是 dual-write
机制，不是替换本地 Transcript writer。

pi-ling SQLite 可以成为产品唯一长期数据库，但需要同时保存：

1. 统一 Canonical Session Events；
2. 可重建/恢复 Claude Session 的 opaque Transcript projection。

不能只保存归一化 Message 后删除所有 Claude 私有字段，否则无法保证原生
Resume，尤其是 thinking signature、parent chain、subagent 和 compaction。

## Claude 历史注入能力

Claude Agent SDK 当前没有受支持的任意 Canonical cold seed API。

`importSessionToStore` 只能复制已经存在的 Claude 原生 Session，不能导入
任意 User/Assistant/Tool 历史。

`shouldQuery: false` 可以静默追加 User 消息，并在下一次真实 Prompt 时作为
上下文进入模型，但它：

- 不能导入 Assistant 历史；
- 不能恢复 Tool Use/Result 拓扑；
- 不能保留原 Message ID、Usage 和 Turn；
- 不能无损恢复 Thinking。

因此它只适合作为有损的 Context Handoff 或摘要注入，不等价于 DSH Seed。

## Claude 审批

Claude Runtime 的薄适配层使用：

- `permissionMode`
- `canUseTool`
- `PreToolUse` Hook
- `allowedTools` / `disallowedTools`

`canUseTool` 只在权限流程落到交互询问时触发；已经自动允许的调用不会触发。
如果 pi-ling 要对所有 Tool 做统一安全检查，应使用 `PreToolUse` Hook，再由
公共 Approval Policy 决定 allow/deny/ask。

审批关联至少保存：

- Tool Use ID
- Request ID
- Agent ID
- Tool name/input
- SDK decision reason/suggestions
- pi-ling 最终决定

## Canonical 与 Claude 映射

### Claude → Canonical

- User → Canonical User
- Assistant text → Canonical Assistant text
- Thinking → Canonical reasoning + raw signature
- Tool Use → Canonical Tool Call
- Tool Result → 模型可见 result + Runtime/UI structured output
- Partial stream → Main transient Buffer
- Complete Assistant → durable Canonical Message
- Hook/Progress/Task/Status → Timeline
- Result/Usage/Cost → Run/Eval

### rawPayload.claude

需要原样保留：

- opaque SessionStore entry
- SDK wrapper UUID 与 parent UUID
- API message/request IDs
- thinking signature 与 redacted data
- Tool private structured result
- unknown/new content blocks
- hook input/output
- subagent/task metadata
- compaction/internal metadata
- result timing、terminal reason 与 permission detail

## DSH 与 Claude 的关键差异

DSH：

- 内部公开 `agents.create({ seed })`
- Canonical → SessionEvent[] 已通过真实模型 PoC
- 可替换 SessionPersistence
- SDK/ACP 没有直接暴露 seed

Claude：

- 原生 partial streaming、Resume、Fork、Permissions 和 Hooks 完整
- `sessionStore` 可镜像 opaque Transcript
- 没有受支持的任意 Canonical cold seed
- `shouldQuery: false` 只能做有损 User context handoff

因此下一步不能假设两个外部 Runtime 使用同一种历史接入方式：

```text
DSH → 真正的 Canonical Seed
Claude → 原生 Transcript mirror + Canonical handoff
```

Claude 是否能满足产品要求，需要真实 PoC 验证 SessionStore mirror/resume
以及 `shouldQuery: false` 的模型可见效果。

## Claude PoC 状态

已新增 `@pi-ling/claude-transcript`：

- SQLite `SessionStore` opaque entry mirror；
- UUID 幂等去重；
- session/subkey listing；
- load/delete；
- 显式真实 context injection + mirror + resume 测试。

确定性 SQLite 单测、TypeScript 和构建均通过。

真实 SDK PoC 已通过 Boom KLink Anthropic Gateway 和
`claude-haiku-4-5-20251001` 验证，凭据仅临时注入测试进程，未写入项目文件。

验证链路：

```text
Canonical Context (shouldQuery:false)
→ 正常 User Prompt
→ Claude 正确回答测试代号
→ opaque Transcript mirror 到 SQLite SessionStore
→ 使用同一 Session ID resume
→ Claude 再次正确回答测试代号
```

测试同时确认：

- `SessionStore.append` 收到真实 opaque Transcript batches；
- SQLite 保存了对应 Session；
- Resume 触发 `SessionStore.load`；
- context injection、mirror 和 resume 均能在真实子进程中工作。

这仍然是 Context Handoff，不是无损 Assistant/Tool cold seed。Claude 原生
Transcript projection 必须保留，才能进行准确 Resume。

## DSH 关键源码

- `packages/llm/llm/src/message.ts`
- `packages/llm/llm/src/types.ts`
- `packages/core/session/src/types.ts`
- `packages/core/session/src/surface.ts`
- `packages/core/session/src/index.ts`
- `packages/core/agent-loop/src/agent.ts`
- `packages/core/agent-loop/src/index.ts`
- `packages/session/session-persistence/src/index.ts`
- `packages/session/session-persistence-jsonl/src/format.ts`
- `packages/sdk/protocol/src/types.ts`
- `packages/sdk/server/src/server.ts`
- `packages/acp/acp/src/session.ts`

以上路径均位于固定源码目录 `E:\deepseek-harness`。

## Claude 官方参考

- https://platform.claude.com/docs/en/agent-sdk/typescript
- https://platform.claude.com/docs/en/agent-sdk/overview
- https://platform.claude.com/docs/en/agent-sdk/permissions
- https://code.claude.com/docs/en/sessions
- https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.263/sdk.d.ts
