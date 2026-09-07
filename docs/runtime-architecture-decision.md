# Runtime 与统一会话架构决策

记录时间：2026-09-06  
状态：研究与 PoC 已完成，产品迁移尚未开始

## 决策摘要

pi-ling 采用一套产品级 Session Event Log 作为唯一权威数据源。

```text
Session Event Log
  ├─ Canonical Messages
  ├─ Chat Timeline
  ├─ Cursor-style Run Activity
  ├─ Approval / Changes / Eval
  └─ Runtime-specific projections
```

Native、DSH 和 Claude 不再分别拥有互不相通的产品历史。Runtime 原生
Transcript 允许存在，但只能作为 Resume 所需的派生投影。

## Runtime 选择

### Native

继续使用：

- `@pi-ling/coding-agent`
- `@pi-ling/agent-core`
- `@earendil-works/pi-ai@0.85.0`（仅注册 DeepSeek、Anthropic）

短期仍由 Electron Main 管理，长期应迁入 Worker，避免模型流和工具循环扩大
Main 崩溃半径。

### DSH

保留 ACP，不切换到当前 DSH SDK。

原因：

- 现有 ACP 已完成 Session、Cancel、Permission 和 Resume 接入；
- ACP SDK 已有标准 message/thought chunk 类型；
- DSH 内部已有 `agent/assistant-stream`，扩展 ACP plugin 即可转发 token；
- DSH SDK 同样没有公开 live token stream；
- DSH SDK 没有公开 history seed，Session create/resume 能力不优于 ACP；
- `@pi-ling/dsh-llm` 与 Transcript Seed 已通过真实模型 PoC。

DSH 使用固定版本自定义 Profile，并加载 pi-ling Cordis bundle：

```text
@pi-ling/dsh-bridge
  ├─ LLM adapter
  ├─ Canonical transcript seed
  ├─ ACP live-stream projection
  └─ Session persistence/projection
```

开发期 `link:` 已验证，正式产品必须使用预构建 tarball/package，不能依赖
开发机绝对路径。

### Claude

使用 `@anthropic-ai/claude-agent-sdk`。

SDK Client 由 Electron Main Supervisor 管理，Claude Code 在 SDK 创建的独立
子进程中执行。

Claude 原生支持：

- partial message stream
- Session Resume/Fork
- Tools、Hooks 与 Subagents
- `canUseTool`
- opaque Transcript `sessionStore` mirror

Claude 不支持任意 Canonical Assistant/Tool 历史 cold seed。跨 Runtime
切换到 Claude 时采用：

```text
Canonical delta/summary
  → shouldQuery:false
  → 下一条真实 User Prompt
```

已经存在的 Claude Runtime Session 继续通过 opaque Transcript Resume。

## 进程模型

应用启动时只注册 Adapter，不立即启动所有子进程。

```text
Electron Main Supervisor
  ├─ Native host
  ├─ DSH host
  │    └─ one DSH sidecar, multiple DSH sessions
  └─ Claude host
       └─ Claude Code process per active Query/Session as required by SDK
```

生命周期依据活跃 Session/Run，而不是当前 UI 是否选中：

- 首次使用时 lazy start；
- 切走页面但 Run 仍执行时保持；
- 空闲超时后允许释放；
- 应用退出时停稳取消并清理；
- 可选 prewarm 只优化首次请求延迟。

## 唯一事实源

### Durable Session Event

SQLite 只持久化完整语义边界：

- Session/Run/Turn start/end
- User message
- 完整 Assistant message
- Tool call/result
- Approval requested/resolved
- File changes
- Usage/Context usage
- Compaction
- Runtime/session status

事件使用稳定：

- `sessionId`
- `runId`
- `turnId`
- `messageId`
- `toolCallId`
- 会话内单调递增 `seq`
- `runtimeKind`
- schema version

Canonical Messages、UI Timeline 和 Eval 都由这份 Event Log 投影，不再维护
两套互相独立的消息与 Timeline 事实。

### Transient Frame

不逐条写 SQLite：

- text delta
- reasoning delta
- tool argument delta
- 高频 progress

Frame 进入 Electron Main 的 `RunMessageBuffer`，按 `sessionId + runId`
隔离，约 16ms 合并后通过 Electron IPC 推送。

完整 Assistant message 提交后写入 Session Event Log，并释放已确认持久化的
Buffer。

## Runtime 原生投影

Runtime 原生数据不作为产品事实源，但为精确 Resume 保留。

```text
runtime_sessions
  ├─ product session id
  ├─ runtime kind
  ├─ external session id
  ├─ last synced canonical seq
  ├─ runtime status
  └─ runtime projection version
```

另存 opaque Runtime projection：

- DSH Session Event/raw payload；
- Claude SessionStore entries；
- Native provider-specific replay fields。

删除 Runtime projection 后，产品历史仍存在；是否能无损重建由 Runtime
capability 明确声明。

## Canonical Message

Canonical Message 是 Session Event Log 的模型视图，不是第二份事实表。

公共内容至少包括：

- user / assistant / tool role
- text
- reasoning
- tool call/result
- attachment reference
- usage
- source runtime
- stable identity

Runtime 特有字段保存在 `rawPayload`：

- DSH replayState、surface、stream、tool meta；
- Claude thinking signature、redacted data、opaque transcript entry、
  parent chain、subagent/task metadata；
- Native provider wire/replay information。

## Runtime 切换

Runtime 只能在完整消息/Turn 边界切换。

```text
1. 等待当前 Run 到 durable boundary
2. 确认 Canonical seq 已提交
3. 读取目标 Runtime 的 lastSyncedCanonicalSeq
4. 转换并同步缺失历史
5. 激活/Resume 目标 Runtime Session
6. 发送新的 User Prompt
```

DSH：

- 新 Session 使用真实 Canonical Seed；
- 已有 Session 通过 seed/persistence plugin 同步缺失历史。

Claude：

- 已有 Claude Session 使用 opaque Transcript Resume；
- 其他 Runtime 新增的 Canonical delta 通过 `shouldQuery:false` 注入；
- 无法无损 cold seed 时明确标记 capability，不伪装完全等价。

## Session 切换与后台 Run

“当前选中 Session”和“正在运行的 Session”必须分离。

Main Supervisor 从单个 `#active` 改为按 Session 管理的运行集合。切换 UI：

- 不 cancel/dispose 旧 Session；
- 后台 Run 继续产生 Buffer 和 durable events；
- 新页面先加载 SQLite snapshot；
- 再重放该 Session 的 Main Buffer；
- 最后接收实时 frame。

Renderer 不使用全局 event queue，而使用按 Session 隔离的状态/cache，并以
activation revision 丢弃过期 snapshot。

## 统一审批

产品只维护一套 Effect 与 Approval Policy：

- manual
- accept-write
- auto
- sensitive/destructive/unknown 强制询问

Runtime 仅实现薄适配：

- Native：`beforeToolCall`
- DSH：ACP permission
- Claude：`PreToolUse` + `canUseTool`

审批决定和 effect 进入统一 Session Event Log。

## Cursor 式执行渲染

底层保留完整事件，Renderer 按整个 Run 聚合：

```text
累计摘要
  Editing 10 files, explored 10 files, ran 3 commands +175 -28

当前阶段
  Planning next moves / Running verification

当前动作
  Editing Sidebar.tsx
```

Run 完成后默认压缩为一行；展开显示原始 Tool、Approval、Output 和 Error。
渲染投影不得反向成为持久化事实源。

## 数据库迁移目标

保留：

- `workspaces`
- `sessions`
- `pending_approvals`
- `file_baselines`

演进：

- `timeline_events` → 版本化 `session_events`
- `agent_messages` → 从 `session_events` 派生，迁移期只作兼容缓存
- `sessions.runtime_kind/runtime_session_id` → 独立 `runtime_sessions`
- `run_checkpoints` 增加 Runtime/事件水位

新增：

- `runtime_sessions`
- `runtime_projection_entries`
- 必要的 projection/checkpoint version

流式 `RunMessageBuffer` 不建表。

## 已完成的证据

DSH：

- `@pi-ling/dsh-llm` 真实模型调用成功；
- `@pi-ling/dsh-transcript` 通过 `agents.create({ seed })`；
- Seeded DSH 模型正确回忆 `ORANGE-42`；
- ACP SDK 支持标准 chunk，DSH live event 路径已定位。

Claude：

- `@pi-ling/claude-transcript` SQLite SessionStore 已实现；
- Boom KLink + `claude-haiku-4-5-20251001` 真实调用成功；
- `shouldQuery:false` Context Handoff 正确回忆 `VIOLET-73`；
- opaque Transcript mirror 和 Resume 成功；
- 凭据未写入项目文件。

## 实施顺序

1. 定义 versioned Session Event、Canonical projection 与 Runtime
   capabilities。
2. 迁移 SQLite 为 `session_events + runtime_sessions`，保留旧表兼容读取。
3. 实现 Main `RunMessageBuffer`、16ms merge 与按 Session reconnect。
4. 解耦 selected Session 和 active Runs。
5. 让 Native 改用统一 Event Log。
6. 将 DSH PoC 合并为可分发的 bridge bundle，补 token stream 与完整
   Tool/Reasoning 映射。
7. 实现 Claude Runtime Adapter、SessionStore projection 和 Approval
   mapping。
8. 实现 Cursor Run Activity projector。
9. 完成跨 Runtime、跨 Session、崩溃恢复和 Eval 测试。

下一步应先为步骤 1–4 出实施 Plan，不直接继续扩展 UI。
