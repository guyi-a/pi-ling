# @pi-ling/coding-agent

pi-ling 的内置 Coding Harness。它组合 `@pi-ling/agent-core` 与以下产品能力：

- Workspace 路径边界
- `read_file`、`list_files`、`grep`
- `write_file`、`edit_file`、`run_command`
- effect 推导与 Allow once / Deny 审批
- 本轮文件 baseline、changed files 和 Diff

## 调用链

```text
CodingAgent.prompt
  → Agent Core
  → 模型产生 tool call
  → effect 推导
  → 无副作用则直接执行
  → 有副作用则等待 ApprovalManager
  → 工具执行
  → toolResult 回填模型
  → ChangeTracker 发布 Diff
```

所有能力均为产品内部模块，不提供 extension API 或第三方插件加载。

Coding Agent 事件保留 Core 的 `runId`、`turnId`，并把 approval、tool 和 changes 绑定到同一个 `callId`。Electron Main 再为事件分配 `sessionId` 与单调 `seq`。

Electron Main 通过 `node:sqlite` 持久化 transcript、pending approval、run checkpoint 和 file baseline。Coding Agent 本身不依赖具体数据库，通过构造参数 hydrate 这些状态。
