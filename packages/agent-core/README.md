# @pi-ling/agent-core

pi-ling 的有状态 Agent 与 ReAct 循环。

## 一轮 Prompt

```text
Agent.prompt()
  → 追加 user message
  → 调用 @pi-ling/ai stream
  → 转发 assistant 流事件
  → 完成 assistant message
  → 没有 tool call：结束
  → 存在 tool call：校验参数并执行工具
  → 追加 toolResult
  → 再次调用模型
```

## 文件

- `types.ts`：Agent 状态、工具和生命周期事件。
- `agent-loop.ts`：模型调用、工具执行及多轮 ReAct 控制流。
- `agent.ts`：transcript、订阅、取消、reset 和运行互斥。

Core 不访问 Electron、文件系统或凭据。具体工具及审批策略由上层 Runtime 提供。
