# Agent 流式传输、会话连续性与执行渲染

记录时间：2026-09-06

本文记录 pi-ling 中间对话区已经讨论并通过 DSH/Claude PoC 验证的设计方向；用于避免后续把模型流式、进程传输、数据库持久化、Session 切换和 UI 渲染混为一谈。最终架构决策见 `runtime-architecture-decision.md`。

## 需要区分的四层

1. **模型流式**：模型 API 是否逐 token/chunk 返回。
2. **应用传输**：Electron Main 如何把事件发送到 Renderer。
3. **持久化与恢复**：哪些数据写入 SQLite，切换 Session 后如何补回。
4. **UI 投影**：如何把原始事件渲染成用户看到的执行过程。

这四层相互关联，但不能视为同一件事。

## 已确认的传输方向

pi-ling 桌面应用继续使用 Electron IPC，不为 Main 与 Renderer 之间额外引入 HTTP/SSE。

推荐链路参考 KlingWork App：

```text
Model stream
  → Agent Runtime
  → durable semantic events + transient stream frames
  → Electron Main
      ├─ semantic events → SQLite
      └─ stream frames → per-run RunMessageBuffer
  → 完整 Assistant message 先提交 SQLite
  → durable Electron IPC
  → Renderer presentation queue
  → 短语/小段自适应展示
```

Renderer 内部可以使用 `ReadableStream` 适配聊天组件，但数据源仍是 Electron IPC，不是 HTTP SSE。

## 持久化粒度

### 写入 SQLite

以完整、可恢复的语义事件为单位写入：

- User message
- 完整 Assistant message
- Tool requested / started / completed / failed
- Approval requested / resolved
- Run started / completed / cancelled / crashed
- File changes 与 checkpoint

### 不逐条写入 SQLite

以下高频 frame 只进入 Main 内存 Buffer：

- Text delta
- Thinking/reasoning delta
- 高频进度状态

模型每次可能返回一个字、一个 token 或一小段文本。Main 仍可在内存中合并这些 frame，但用户可见的 Assistant 文本不再直接消费 text/reasoning frame。完整 Assistant message 结束后，先将组装完成的消息写入 SQLite，再由 Renderer 按短语、标点和 Markdown 边界自适应释放。

因此数据库中的内容始终完整，文本 chunk 和 Tool 的展示进度只是 Renderer 的临时 presentation state，不属于 Transcript。这不是逐字符打字机，也不是整条消息瞬间出现。

## Main RunMessageBuffer

Buffer 应位于 Electron Main，而不是 Renderer。

建议按 `sessionId + runId` 隔离：

```text
Map<sessionId, Map<runId, BufferedRun>>
```

每个活跃 Run 保存：

- 已发送的 text/reasoning frames
- 当前 Assistant message ID
- 当前阶段与当前动作
- 最后 frame sequence
- Run 是否结束

Buffer 是 Runtime 内部的临时状态，不是长期事实源。Tool status 等瞬态状态仍可消费；Assistant text/reasoning 必须等待完整消息提交后才进入用户可见投影。

## Session 切换行为

目标是“切换不丢、不跳、不停”：

1. 切走 Session A 时，不取消它正在执行的 Run。
2. Session A 继续在 Main 中运行，并持续更新自己的 Buffer。
3. 切到 Session B 时，从 SQLite 加载 B 的完整事件快照。
4. 切回 Session A 时：
   - 先从 SQLite 恢复已完成消息；
   - 历史消息直接显示全文，不重播展示动画；
   - 尚未提交的 Assistant message 只显示统一的 Thinking 状态；
   - 后续 committed message 继续进入实时 presentation queue。

需要防止：

- A 的延迟事件覆盖 B 页面；
- 快速 `A → B → A` 时旧 snapshot 晚到并覆盖当前 Session；
- snapshot 与 Buffer 重复渲染相同内容；
- 切换 Session 时错误地 dispose/cancel 旧 Runtime。

## Cursor 式执行过程渲染

底层保留完整 Timeline，UI 按整个 Run 投影，并明确区分 active 与 settled 两种状态。

### 第一层：累计摘要

示例：

```text
Editing 10 files, explored 10 files, ran 3 commands  +175 -28
```

建议统计：

- `editedFiles`：发生写入/编辑的唯一文件集合；
- `exploredFiles`：读取、搜索、检查过的唯一文件集合；
- `commandCount`：执行命令次数；
- `additions/deletions`：来自最终 Diff；
- `toolCount`、失败次数和审批次数可保留在展开详情中。

### 第二层：运行中明细

active Run 显示默认收起的累计摘要，不显示 `Working`。摘要第二行显示当前原子操作：

```text
Thinking
⟳ explored 3 files, ran 1 command
  Reading session-store.ts
```

阶段是产品级语义状态，不直接展示模型隐藏思维。可以根据最新 Assistant/Tool/Run 事件推导：

- planning
- exploring
- editing
- running
- verifying
- awaiting approval
- completed / failed

当前工具使用 `Reading / Searching / Listing / Editing / Writing / Running` 等动词和目标。每个操作有最短展示时间，摘要数字只随已经展示的操作增长；完整 Tool 历史需要用户展开摘要。

### 展开与收起

- Run 进行中：显示 spinner、动态累计摘要和固定单行 current action，Tool 详情默认收起。
- Tool 前说明和 Tool 之间的中间文本属于 Activity segment，只在展开详情中显示；Activity 外只渲染最终回答。
- Run 完成后：默认压缩为一行累计摘要。
- Run 已结束但 presentation queue 尚未追平时仍视为 active；队列完成后再切换完成勾。
- 最后一个 current action 与正文首个文本 chunk 在同一次 Renderer 状态更新中交接，避免空白帧和位置抖动。
- 用户展开后：显示原始 Tool、Approval、输出和错误详情。
- 原始 Timeline 仍是事实源，聚合视图只是可重建的 Renderer projection。

## 当前实现

- `session_events` 按完整语义边界持久化，Assistant delta 不写 SQLite。
- Renderer 只用 committed Assistant message 驱动用户可见文字，并按短语/小段 chunk 自适应展示。
- presentation queue 按 message durable 顺序串行播放；Tool UI 不会越过前一段文字。
- `tool.call.committed` 只表示 requested；Tool 行在真实
  `tool.execution.started` 或 approval requested 后才出现。极快的连续 Tool
  在 Renderer 中以最小间隔依次呈现。
- Approval、错误和取消会快进当前文字，优先显示阻塞状态。
- Tool 行只镜像 approval 状态；审批交互位于 Composer 上方的 FIFO Dock，
  多个 pending approval 一次只展示一个。
- selected Session 与后台 active Runs 已解耦；snapshot/history 不重播动画。
- Run Activity 的 active 与 settled 都使用默认收起的摘要；active 额外显示 spinner 和 current action。

## 跨 Runtime 上下文是另一项问题

UI Timeline 连续不代表模型上下文连续。

当前：

- Native transcript 存在 pi-ling `agent_messages`；
- DSH transcript 存在 DSH external session；
- 产品 Timeline 是第三份展示数据。

Native 与 DSH 切换时没有自动同步模型历史。该问题需要 canonical transcript 与 Runtime context handoff，但不应与 Buffer 或 Cursor 渲染混成一个实现。

## DSH 已确认边界

已经确认：

- DSH 的 DeepSeek LLM Adapter 内部通过 HTTP SSE 接收模型流式输出；
- DSH 内部通过 `agent/assistant-stream` 保留 text/reasoning delta；
- ACP SDK 1.4.0 已支持标准 message/thought chunk，当前缺失的是 DSH ACP
  对 live stream 的订阅和转发；
- DSH 支持通过 `LlmAdapter` 与 Cordis plugin 替换模型适配层；
- 官方本地开发支持 `--patch`，持久 bundle 支持 `dsh plugin --profile ... add`。
- `@pi-ling/dsh-llm` 的加载失败已定位为 `file:` 安装后无法解析
  `@pi-ling/ai`；改用开发期 `link:` 后真实 Prompt 已成功。

实现时仍需覆盖：

- DSH ACP live stream 去重、message identity、顺序和取消语义；
- 完整 Tool/Reasoning/Attachment Canonical Seed；
- DSH committed message 与 pi-ling Main Buffer 如何统一映射。

## 实施顺序建议

研究和 PoC 已完成。后续实施顺序：

1. 定义 Runtime 无关的 durable event 与 transient frame 合约。
2. 实现 Main `RunMessageBuffer` 和 16ms delta 合并。
3. 解耦“当前选中 Session”与“后台运行 Session”。
4. 实现 snapshot + buffer reconnect。
5. 接入 DSH/Claude Runtime projection。
6. 实现 Cursor 式 Run activity projector。

## 参考

- DeepSeek Harness：第一个插件  
  https://deepseek-harness.github.io/deepseek-harness/develop/basic/
- DeepSeek Harness：LLM 适配器  
  https://deepseek-harness.github.io/deepseek-harness/develop/practice/llm-adapter
- DeepSeek Harness：LLM 流式输出  
  https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/llm-streaming
- Cursor Agent Overview  
  https://cursor.com/docs/agent/overview
- Cursor Hooks  
  https://cursor.com/docs/hooks
