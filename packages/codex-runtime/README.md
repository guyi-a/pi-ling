# @pi-ling/codex-runtime

DeepSeek Codex runtime adapter for pi-ling. Uses `@openai/codex-sdk` to drive the Codex agent engine (`codex exec --experimental-json`), not the interactive CLI TUI.

## Setup

1. Install Codex CLI or rely on SDK-bundled binary via `@openai/codex` optional deps.
2. Set `PI_LING_CODEX_ENABLED=true` and `DEEPSEEK_API_KEY`.
3. Optional: `PI_LING_CODEX_BIN` to override the codex executable path.

## Capabilities

- Thread resume via Codex thread ids
- Sandbox modes mapped from ComposerMode
- Plan tools (`update_plan`) surfaced to Timeline
- History seed via `importSession` canonical bridge

## Tests

```bash
pnpm --filter @pi-ling/codex-runtime test
```

Tests use `test/fake-codex-exec.mjs` as a JSONL shim instead of a real Codex binary.
