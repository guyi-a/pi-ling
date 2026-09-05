# Vendored pi-agent-core

This directory is a source snapshot of `packages/agent` from:

- Repository: https://github.com/earendil-works/pi
- Package: `@earendil-works/pi-agent-core`
- Package version: `0.85.0`
- Upstream commit: `dd7e816b57dedbe971d159b388f48317a6139079`
- Local source at import time: `E:\pi\packages\agent`
- Imported on: 2026-09-05

The upstream source and generated `dist` output are kept together for local
study and direct workspace use. The upstream MIT license is preserved in
`LICENSE`.

Product-specific behavior belongs outside this directory. Keep any unavoidable
upstream modifications documented below so the snapshot can be updated later.

## Local patches

- `package.json`: resolve `@earendil-works/pi-ai` through `workspace:*` so both
  vendored packages share one exact set of runtime types.
