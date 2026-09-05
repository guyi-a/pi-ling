# @pi-ling/ai

pi-ling 的模型协议层，只包含 DeepSeek 与 Anthropic Claude。

## 调用链

```text
Models.stream()
  → 根据 model.provider 查找 Provider
  → 从显式 options 或环境变量解析 API Key
  → Provider 构造厂商请求
  → SDK 返回原始流
  → Provider 归一化为 AssistantMessageEvent
  → AssistantMessageEventStream 同时支持迭代和 result()
```

## 文件

- `types.ts`：模型、消息、工具、usage 和流事件协议。
- `event-stream.ts`：异步事件队列及最终结果 Promise。
- `models.ts`：Provider 注册、模型查询和认证边界。
- `providers/deepseek.ts`：OpenAI-compatible 请求与流解析。
- `providers/anthropic.ts`：Anthropic Messages 请求与流解析。
- `message-utils.ts`：消息初始化、费用计算和错误终止。

Provider 只负责模型 API，不执行工具，也不维护会话历史。
