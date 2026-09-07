# DSH 接入状态与待修问题

记录时间：2026-09-06  
固定版本：`dsh-v0.1.3-alpha.1`  
固定 commit：`d347e703908d0406b7a7ef80e3a0e594d86b2215`

## 已打通

- 官方 DSH 固定源码通过 `pnpm dsh:setup` 准备，并由仓库根目录
  `.dsh-source` 指向独立 worktree。
- `DshRuntimeAdapter` 通过 ACP stdio 控制 DSH 子进程。
- 支持 session create/resume/close、prompt、cancel、semantic update 和 permission request。
- fake ACP 测试覆盖消息、thinking、tool、permission、cancel 和子进程 crash。
- 真实 ACP Prompt 返回 `dsh-ok`。
- 临时 Git worktree 中真实 DSH 成功创建 `dsh-smoke.txt`。
- Electron 中 DSH Runtime 已成功启动并执行多次工具调用。
- Native/DSH 在同一个产品 Session 内原地切换，不再创建新的用户可见对话。
- Windows 源码运行使用系统 `node.exe`；`fs-ext` 未使用的 POSIX 静态导入通过隔离 hook 处理，未修改 DSH 源码。

## P0：DSH ACP 当前没有转发 token 级流式输出

当前 DSH ACP 只监听 durable `session/event`。完整 `assistant/message`
提交后，才按 content block 发出 `agent_message_chunk`。

因此现在的行为是：

```text
模型在 DSH 内部流式生成
→ assistant/message 完整提交
→ ACP 一次发送完整 text/reasoning block
→ pi-ling 一次渲染整段
```

这不是 `DshRuntimeAdapter` 漏转 delta。实时 token 位于 DSH 进程内的
`agent/assistant-stream`。`@agentclientprotocol/sdk` 1.4.0 已定义标准
`agent_message_chunk` 和 `agent_thought_chunk`，但 DSH ACP 当前只订阅
durable `session/event`，没有订阅 live stream。

待决定：

1. 接受 DSH 当前的 committed-message 语义；或
2. 对固定版本 DSH ACP plugin 增加 `agent/assistant-stream` 订阅，将
   text/reasoning delta 映射到标准 ACP chunk update。

第二种方案不需要修改 Agent Loop、不需要自定义 ACP extension，也不需要
额外 side channel。实现时必须处理 live delta 与最终 committed block
去重、`messageId`、tool update 顺序、取消后的 partial message 和背压。

## P0：DSH timeline 投影过度切分

截图中 `pwsh`、`glob`、多个 `read` 被渲染为多段独立“执行过程”，视觉上碎片化。

原因：

- ACP 不提供我们的 `turnId`。
- 当前 `DshAgentSession` 根据 tool/message 到达顺序合成 turn。
- 每次 tool 后的下一段内容会创建新的 synthetic turn。
- ChatView 再按 synthetic turn 创建 ExecutionTimeline。

需要调整：

- 保留 ACP `messageId` 并加入 RuntimeEvent。
- 为一个 ACP prompt 建立稳定的 execution group。
- 同一 run 中连续 thinking/tool 进入同一执行时间线。
- 只有最终 committed assistant text 独立成为回答。
- permission 继续绑定对应 `toolCallId`，不额外产生执行分组。

## P1：Usage 语义错误

ACP `usage_update` 的 `used/size` 表示当前上下文占用与窗口容量，不是本轮
input/output usage。

当前 UI 把 `used` 映射成 input、output 显示为 0，含义错误。

修正方向：

- Runtime 协议增加 `contextUsage { used, size }`。
- DSH UI 显示 `8.7k / 1m context`。
- 不伪造 DSH 本轮 input/output。

## P1：工具展示信息不足

- DSH tool title 可能是 `pwsh`、`glob`、`read`，需要按 ACP `kind` 和
  `rawInput` 生成用户可读摘要。
- PowerShell 命令、文件路径和搜索 pattern 应直接显示在工具行。
- 完整 raw input/output 保留在折叠详情中。
- 连续相同 read 应保持独立 call，但视觉密度需要降低。

## P1：Runtime/Session 状态

- 旧的失败调试产生了若干 DSH Session 行，需要提供删除入口或开发态清理。
- 切换 Runtime 必须保持同一个 UI Session；DSH 原生 session id 只是内部映射。
- 切换回 DSH 应恢复原 DSH session，而不是再创建一个。
- Runtime 切换失败时继续保留原 Native Runtime 和 timeline。

## P1：审批映射待实机覆盖

- fake ACP permission allow/reject 已通过。
- 真实 worktree 写入由 DSH 自身策略直接允许，没有触发 ACP permission。
- 需要构造真实 destructive/execute 场景，确认
  `manual / accept-write / auto` 与 ACP option 的映射。
- `delete`、`other`、无法解析的执行和破坏性命令始终人工确认。

## `@pi-ling/ai` Bridge 状态

- `@pi-ling/dsh-llm` 已实现 DSH Context、text/reasoning/tool/usage/finish
  到 `@pi-ling/ai` 的转换。
- 编译和转换单测通过。
- 已定位此前 `session/new` 返回
  `cannot create effect on inactive context` 的原因：使用 `file:` 安装本地
  bundle 后，profile 中复制出的包无法解析其 `link:` 依赖
  `@pi-ling/ai`，Cordis loader tree 先加载失败并被 dispose，随后
  `session/new` 只暴露了二次生命周期错误。
- 在旧 Windows 开发环境的隔离 ACP profile 中改用
  `dsh plugin --profile acp add link:<pi-ling-root>/packages/dsh-llm`
  后，plugin tree、`session/new` 和真实模型 Prompt 均成功；Prompt
  返回了预期的 `dsh-bridge-ok`。
- bundle 默认禁用；产品 DSH Runtime 暂时使用已验证的
  `deepseek-official` route。
- 正式启用前仍需决定可分发的依赖打包方式，不能依赖开发机绝对 `link:`
  路径。
- `@pi-ling/dsh-transcript` Seed Plugin PoC 已验证
  `Canonical → SessionEvent[] → agents.create({ seed })`。导入包含
  `ORANGE-42` 的历史后，下一轮真实模型成功回答该代号，证明 DSH 可以消费
  pi-ling 共享历史。

## 后续实施顺序

研究与 PoC 结论已收敛到 `runtime-architecture-decision.md`。DSH 后续工作：

1. 将 LLM/Transcript PoC 合并为可分发 `@pi-ling/dsh-bridge` bundle。
2. 扩展固定版本 ACP plugin，转发 `agent/assistant-stream`。
3. 补完整 Tool/Reasoning/Attachment Canonical Seed。
4. 修正 RuntimeEvent 的 `messageId` 与 `contextUsage`。
5. 重写 Run activity 投影，解决多段“执行过程”。
6. 验证真实 ACP permission 三档策略。
