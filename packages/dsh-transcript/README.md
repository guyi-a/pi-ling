# @pi-ling/dsh-transcript

Proof-of-concept Cordis plugin for seeding a DeepSeek Harness Agent from a
pi-ling canonical transcript.

The PoC intentionally supports complete text-only user/assistant pairs. It:

- preserves canonical message ids
- converts messages to balanced DSH turn/step SessionEvents
- writes valid Surface append events
- embeds a replayable assistant stream record
- creates an Agent through `ctx.agents.create({ seed })`

Run the deterministic projection test:

```powershell
pnpm --filter @pi-ling/dsh-transcript test
```

Run the explicit real-model proof:

```powershell
$env:RUN_REAL_DSH_SEED_POC = "1"
pnpm --filter @pi-ling/dsh-transcript test
```

This is not the production canonical transcript schema. Tool calls, tool
results, reasoning, attachments, compaction and persistence integration remain
outside this PoC.
