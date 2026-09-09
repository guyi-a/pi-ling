# @pi-ling/coding-eval

Regression eval harness for pi-ling: task catalog, isolated git worktrees, code-based graders, and baseline/candidate comparison.

## Commands

From repo root:

```bash
pnpm eval:validate
pnpm eval:reference   # oracle driver, must pass all baseline tasks
pnpm eval:noop        # must fail all baseline tasks
pnpm eval:agent       # native CodingAgent driver (requires DEEPSEEK_API_KEY)
```

Package-local:

```bash
pnpm --filter @pi-ling/coding-eval run-suite --driver agent --runtime dsh
pnpm --filter @pi-ling/coding-eval compare --experiment exp1 --baseline baseline --candidate candidate
```

## Windows notes

- Verify commands run under Git Bash when available (WSL `bash.exe` is skipped).
- Fixture commands use `python` instead of `python3`.

## Layout

- `catalog/catalog.json` — tasks (fixture, verify, scoring, optional judge)
- `src/runner.ts` — worktree harness
- `src/agent-drivers/` — native (`CodingAgent`) and DSH (`DshRuntimeAdapter`)
- `.coding-eval/ledger.jsonl` — run results (gitignored)
