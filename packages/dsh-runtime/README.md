# @pi-ling/dsh-runtime

Main-process adapter for DeepSeek Harness over ACP v1.

- Version: `dsh-v0.1.3-alpha.1`
- Commit: `d347e703908d0406b7a7ef80e3a0e594d86b2215`
- ACP SDK: `1.4.0`
- Transport: newline-delimited ACP JSON-RPC over stdio

The adapter owns process startup, session create/resume/close, prompt,
semantic updates, one-shot permission requests, cancellation, bounded stderr,
and deterministic process cleanup.

## Prepare the pinned DSH source

Keep an existing DeepSeek Harness clone on `master`; pi-ling creates a separate
detached worktree for the pinned release:

```sh
pnpm dsh:setup
pnpm --dir .dsh-source install --frozen-lockfile
pnpm --dir .dsh-source build:lib
pnpm dsh:verify
```

Defaults:

- source repository: sibling `../deepseek-harness`
- pinned worktree: sibling `../deepseek-harness-d347e703`
- local pi-ling alias: `.dsh-source`

Override the first two locations with `PI_LING_DSH_REPO` and
`PI_LING_DSH_WORKTREE`. The setup script verifies the tag, full commit, DSH
package versions, ACP SDK version, and Node version before creating the local
alias. Re-running it is safe.

On Windows the pinned DSH source statically imports the POSIX-only `fs-ext`
package even though its session lease uses a named semaphore. The child is
started with `fs-ext-hook`, which redirects only that unused Windows import to
a fail-closed shim. DSH source is not modified.

## Enable the runtime

`PI_LING_DSH_BIN` is required when DSH is enabled. Use an absolute path to the
binary built in the pinned worktree:

```env
PI_LING_DSH_ENABLED=true
PI_LING_DSH_BIN=/absolute/path/to/deepseek-harness-d347e703/apps/cli/lib/bin.js
```

`PI_LING_NODE_BIN` is optional. The Electron desktop defaults to `node` from
`PATH`; non-Electron callers default to `process.execPath`. The desktop app
checks the CLI and root package versions before registering the runtime; a
missing configured path or version mismatch leaves DSH disabled.

The desktop writes a deterministic profile overlay into the versioned
`DSH_HOME`. It activates the pinned DSH `@deepseek-ai/dsh-llm-pi-ai` adapter
with only `deepseek` and `anthropic` routes; ACP defaults to
`deepseek/deepseek-v4-flash`. Optional `DEEPSEEK_BASE_URL` and
`ANTHROPIC_BASE_URL` override their endpoints.

Real DSH process tests remain opt-in. They use the pinned DSH test-support LLM
server, so they exercise ACP and persistence without network credentials:

```sh
RUN_REAL_DSH_UNIFIED_SMOKE=1 pnpm --filter @pi-ling/desktop test
RUN_REAL_DSH_LIFECYCLE_SMOKE=1 pnpm --filter @pi-ling/desktop test
RUN_REAL_DSH_APPROVAL_SMOKE=1 pnpm --filter @pi-ling/desktop test
```

Provider tests that contact a real model remain separate and require
`DEEPSEEK_API_KEY`.
