# @pi-ling/claude-transcript

Proof-of-concept SQLite mirror for the Claude Agent SDK `SessionStore`
interface.

Implemented:

- opaque `SessionStoreEntry` append/load
- UUID idempotency
- session listing
- subkey listing for subagents
- delete
- append/load diagnostics for resume tests

Run deterministic tests:

```powershell
pnpm --filter @pi-ling/claude-transcript test
```

Run the explicit real-model context/mirror/resume proof:

```powershell
$env:RUN_REAL_CLAUDE_TRANSCRIPT_POC = "1"
pnpm --filter @pi-ling/claude-transcript test
```

The real proof requires a usable Claude Agent SDK credential. It has been
verified with `claude-haiku-4-5-20251001` via an Anthropic-compatible API;
no credential is stored in this package.
