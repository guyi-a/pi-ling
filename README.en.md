<div align="center">

# pi-ling

**An auditable coding agent workbench**

Swap between three agent runtimes inside one session. Every tool call, every file
change, every model turn lands in the same event log — so you can always rewind and
see exactly what it did.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![pnpm workspace](https://img.shields.io/badge/pnpm-workspace-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![Platform](https://img.shields.io/badge/platform-Windows-0078D4?logo=windows&logoColor=white)](#requirements)

[简体中文](README.md) · English

</div>

## What this is

pi-ling is an **Electron desktop app**: sessions on the left, the conversation in the
middle, and a Workbench on the right that flips between Files / Changes / Terminal /
Plans / Trace / Eval.

It is not "a shell around a CLI." Everything follows from three positions:

| Position | What it means in practice |
| --- | --- |
| **The event log is the source of truth** | Every event is written to the SQLite Session Event Log. The timeline, canonical messages, and run activity are all **projections** of it — not independent state kept in sync by hand |
| **Side effects must be modelled** | Writing files or running commands first derives an effect, which is then cleared against an approval policy. An effect the policy does not recognise always asks the human |
| **Runtimes are swappable** | Native / DSH / Codex share one runtime contract, and their events are normalised into the same timeline vocabulary — so you can change engines mid-conversation |

## Features

**🔀 Three runtimes, one session**

Switch between **Native** (pi-ling's own coding agent), **DeepSeek Harness** (ACP
sidecar), and **DeepSeek Codex** (the Codex agent engine) right next to the composer.
Switching does not start a new session — history is imported into the new engine via
the canonical transcript, with a watermark marking the boundary.

**🧾 Every step is reviewable**

A run is split into runs and turns, and tool calls get their own cards (reading,
editing, running commands, searching, subagents, TODOs, and plans each render
differently). Afterwards the **Trace** panel lets you walk the raw events and model
calls one by one.

**🛑 It asks before it writes**

Read-only actions like `read_file` / `grep` run straight away. `write_file` / `delete`
/ `run_command` derive an effect first, then go through one of three policies:
`manual` (ask for everything), `accept-write` (auto-approve writes), or `auto`
(approve everything). An effect the policy cannot classify always asks.

**🖼️ Inline rendering: let the model draw in the conversation**

The model can emit a ` ```html type="renderer" ` fence with self-contained HTML/SVG,
and pi-ling **renders it as a figure** instead of showing source. This path has the
strictest security posture in the project: DOMPurify sanitisation, a denylist covering
`script` / `foreignObject` / `iframe` and friends, and per-attribute dropping of
external URIs (including CSS `url()` and `@import`). If any step fails it degrades
back to a code block. The core lives in
[`renderer-block.ts`](apps/desktop/src/renderer/src/features/chat/renderer-block.ts),
with the companion skill at
[`.agents/skills/inline-visualization`](.agents/skills/inline-visualization/SKILL.md).

**📁 The workspace sits right there**

Files is a file tree you can create, rename, and delete in, plus a CodeMirror editor.
Markdown, images, audio/video, PDF, DOCX, PPTX, and tables all preview in place, with
git status decorations. Changes offers both unified and side-by-side diffs. Terminal
is a real xterm + node-pty. **Text selected in Files or the terminal can be quoted
into the conversation in one click.**

**🎚️ Decide the permissions before you send**

Pick a mode before sending: **Ask** (read-only tools), **Plan** (read-only plus plan
writing — nothing happens until you hit Build), or **Agent** (all tools). The mode
constrains the tool set, the effect allowlist, and the system prompt together. It is
not a cosmetic switch in the UI.

**🧩 Skills are just files**

They live at `<workspace>/.agents/skills/<name>/SKILL.md`, and all three runtimes —
Native, DSH, and Codex — read the same path. Native loads them lazily through the
`load_skill` tool, so they cost nothing in the standing system prompt.

**🕵️ Subagents**

`spawn_subagent` hands a read-only research task to an isolated explore subagent that
returns a single summary, keeping the intermediate search output out of the main
conversation. It can also be run in the background.

## Getting started

### Requirements

- **Node.js ≥ 22.19 (or ≥ 24)** — sessions are stored with `node:sqlite` and tests run
  on the host Node. `pnpm dsh:setup` checks this range explicitly
- **pnpm 10** (the repo pins `pnpm@10.33.2`)
- **Windows**: the full packaging path (NSIS x64) has only been verified on Windows.
  The code is Electron + electron-vite, so other platforms should work in principle,
  but no packaging config or verification exists for them

### Install

```bash
git clone https://github.com/guyi-a/pi-ling.git
cd pi-ling
pnpm install
```

### Configure a model

Copy `.env.example` to `.env` and fill in at least one provider key:

```env
DEEPSEEK_API_KEY=sk-...
# ANTHROPIC_API_KEY=sk-ant-...
```

You can also configure this in the app, which takes precedence: **Settings → Models &
API**. Resolution order is **settings `llm-config.json` > `.env` > built-in defaults**.

| Provider | Native | DSH | Codex |
| --- | :---: | :---: | :---: |
| DeepSeek | ✅ | ✅ | ✅ |
| Anthropic (Claude) | ✅ | ✅ | — |
| MiniMax / Moonshot (Kimi) / Kimi For Coding / Z.AI (GLM Coding) | ✅ | — | — |

For optional web search, set `TAVILY_API_KEY` or `BOCHA_API_KEY`. With neither set,
the `web_search` tool is simply not registered.

### Run

```bash
pnpm dev          # builds all packages, then starts Electron
```

### Optional: enable the other two runtimes

Both are experimental and **off by default**; you have to opt in.

```bash
# DeepSeek Harness (ACP sidecar, pinned version)
pnpm dsh:setup    # creates a pinned worktree from a local deepseek-harness checkout
pnpm dsh:verify
```

```env
PI_LING_DSH_ENABLED=true
```

```env
# DeepSeek Codex (agent engine; the binary ships with the dependency)
PI_LING_CODEX_ENABLED=true
```

Codex needs `DEEPSEEK_API_KEY` and only supports DeepSeek (via the Responses API).
See [`packages/dsh-runtime/README.md`](packages/dsh-runtime/README.md) and
[`packages/codex-runtime/README.md`](packages/codex-runtime/README.md) for details.

## Architecture

```text
Electron Renderer  (Chat · Files · Changes · Terminal · Plans · Trace · Eval · Settings)
        ↓ typed preload IPC (allow-listed channels, no general-purpose Node API)
Electron Main
  ├─ SessionSupervisor        session routing · lifecycle · runtime switching
  ├─ SessionStore             SQLite (node:sqlite) event log — the source of truth
  ├─ llm-config               settings · .env · userData/llm-config.json
  └─ RuntimeAdapter
        ├─ Native  → @pi-ling/coding-agent → @pi-ling/agent-core → pi-ai
        ├─ DSH     → ACP v1 over stdio → pinned dsh-v0.1.3-alpha.1
        └─ Codex   → @openai/codex-sdk → bundled codex binary
```

Three decisions worth calling out:

1. **The event log is the single source of truth.** The timeline, canonical messages,
   and run activity are all projections, so cross-runtime handoff, session resume, and
   replay share one foundation instead of three states that must be reconciled.
2. **The renderer never touches keys or the filesystem.** It talks only through
   allow-listed preload IPC. API keys are read and written in the main process alone;
   the renderer only ever sees `apiKeyConfigured` and a redacted preview.
3. **The runtime contract is decoupled from the product.** `@pi-ling/runtime-contracts`
   defines session create/resume, prompt, cancel, permissions, and event subscription.
   Native and DSH share it; Codex maps onto the same vocabulary.

## Repository layout

| Path | Purpose |
| --- | --- |
| `apps/desktop/` | Electron main process, preload, and all renderer UI |
| `packages/agent-core/` | Stateful agent and the ReAct loop (no Electron, filesystem, or credentials) |
| `packages/coding-agent/` | Native harness: tools, effects and approvals, change tracking, subagents, skills |
| `packages/native-runtime/` `dsh-runtime/` `codex-runtime/` | The three runtime adapters |
| `packages/runtime-contracts/` | Cross-runtime control-plane contract |
| `packages/session-events/` `dsh-transcript/` | Event projections and the cross-runtime transcript bridge |
| `packages/llm-config/` | Provider catalog and config resolution |
| `packages/skills/` `web-tools/` `compaction/` | Skill loading, web tools, context compaction |
| `packages/coding-eval/` | Regression eval harness |
| `.agents/skills/` | Skills that ship with the repo |
| `vendor/pi-ai` `vendor/pi-agent-core` | Upstream MIT reference copies (not runtime dependencies) |

## Development

```bash
pnpm build:packages   # build each package (also runs before dev / test)
pnpm test             # full test suite (vitest, 135 test files)
pnpm typecheck        # typecheck the whole workspace
pnpm skills:sync      # sync built-in skills from a local checkout into .agents/skills
pnpm dist:win         # Windows packaging (NSIS x64)
```

Conventions and further detail live in [`agent.md`](agent.md). When you change an IPC
contract, the contract, preload, main process, and renderer have to move together.
The project deliberately ships **no** third-party plugin API; capabilities live inside
`packages/coding-agent`.

> [!NOTE]
> `pnpm test` builds every package before running each package's tests, so the first
> run is slow.

## Evaluation

`packages/coding-eval` is a regression eval harness: task catalogs (fixture + verify
command + scoring) run in isolated git worktrees, results go to a ledger, and you can
compare a baseline against a candidate.

```bash
pnpm eval:validate    # validate the task catalog
pnpm eval:reference   # oracle driver; baseline tasks must all pass
pnpm eval:noop        # empty driver; baseline tasks must all fail (proves the grader bites)
pnpm eval:agent       # run the real agent (needs an API key)
```

## Contributing

Issues and pull requests are welcome. Before you start, read [`agent.md`](agent.md) —
it covers the directory conventions, the runtime boundaries, and a few hard rules
(such as "no product-level plugin API" and "DSH dependencies must stay pinned").

- Bug fixes should come with a test that reproduces the issue
- When you change an IPC or event protocol, update the matching contract tests
- Run `pnpm test` before submitting

## License

[MIT](LICENSE). The two packages under `vendor/` are MIT reference copies of upstream
projects, copyright their respective authors. `.agents/skills/pptx` carries its own
[`LICENSE.txt`](.agents/skills/pptx/LICENSE.txt).
