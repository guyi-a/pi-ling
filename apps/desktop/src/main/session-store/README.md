# Session Store

Electron Main 是唯一 SQLite 写入者。`SessionStore` 保存：

- session 元数据和 lifecycle
- append-only timeline events
- 完整 Agent messages
- run checkpoints 和 pending approvals
- Diff file baselines

Timeline `seq` 在 `BEGIN IMMEDIATE` 事务内分配。消息使用
`user:{runId}`、`assistant:{turnId}`、`tool:{callId}` event key 幂等写入。

恢复规则：

- `awaiting_approval` 重建等待，不重复发布请求。
- `approved_pending_exec` 允许对应 callId 执行一次。
- durable `tool_end` 跳过工具重放。
- `tool_start` 后没有 durable result 标记为 crashed，不自动重试。
