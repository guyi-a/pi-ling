# @pi-ling/claude-runtime

Claude Agent SDK runtime adapter for pi-ling.

## Setup

From repo root:

```powershell
pnpm install --ignore-scripts --filter @pi-ling/claude-runtime...
```

`.env` 至少提供以下之一：

- `DEEPSEEK_API_KEY` — 走 DeepSeek Anthropic 兼容 API
- `ANTHROPIC_API_KEY` — 走官方 Anthropic

DeepSeek 模式下可选（与 [DeepSeek Claude Code 文档](https://api-docs.deepseek.com/quick_start/agent_integrations/claude_code/) 对齐）：

```env
DEEPSEEK_MODEL=deepseek-v4-pro[1m]
DEEPSEEK_SDK_MODEL=claude-sonnet-4-5
DEEPSEEK_ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
CLAUDE_CODE_SUBAGENT_MODEL=deepseek-v4-flash
CLAUDE_CODE_EFFORT_LEVEL=max
CLAUDE_CODE_AUTO_COMPACT_WINDOW=786432
```

说明：`DEEPSEEK_MODEL` 写入 CC 子进程 env（API 路由）；`DEEPSEEK_SDK_MODEL` 是 SDK `query({ model })` 参数。

## Tests

```powershell
pnpm --filter @pi-ling/claude-runtime test
```

Anthropic live probe（需 `ANTHROPIC_API_KEY`，失败即 fail）：

```powershell
$env:RUN_CLAUDE_PROBE = "1"
pnpm --filter @pi-ling/claude-runtime test:probe
```

DeepSeek 兼容性探测（需仅配 `DEEPSEEK_API_KEY`，**预期 fail** 直到 DeepSeek 修兼容层）：

```powershell
$env:RUN_CLAUDE_PROBE_DEEPSEEK = "1"
pnpm --filter @pi-ling/claude-runtime test:probe:deepseek
```

CLI vs SDK 对照（DeepSeek 文档 env）：

```powershell
pnpm --filter @pi-ling/claude-runtime compare:deepseek
```

## 已知限制

- DeepSeek 的 `/anthropic/v1/messages` 简单调用可用。
- **Claude Code agent loop**（CLI 与 SDK 共用 CC 子进程）在 DeepSeek 后端上可能持续 `api_retry (unknown)`；用 `compare:deepseek` 可分别看 CLI / SDK 结果。
- probe 要稳定跑通，请使用 **官方 `ANTHROPIC_API_KEY`**。
