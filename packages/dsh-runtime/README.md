# @pi-ling/dsh-runtime

Main-process adapter for DeepSeek Harness over ACP v1.

- DSH source: `E:\deepseek-harness`
- Version: `dsh-v0.1.3-alpha.1`
- Commit: `d347e703908d0406b7a7ef80e3a0e594d86b2215`
- Transport: newline-delimited ACP JSON-RPC over stdio

The adapter owns process startup, session create/resume/close, prompt,
semantic updates, one-shot permission requests, cancellation, bounded stderr,
and deterministic process cleanup.

On Windows the pinned DSH source statically imports the POSIX-only `fs-ext`
package even though its session lease uses a named semaphore. The child is
started with `fs-ext-hook`, which redirects only that unused Windows import to
a fail-closed shim. DSH source is not modified.

Enable the runtime with:

```env
PI_LING_DSH_ENABLED=true
PI_LING_DSH_BIN=E:\deepseek-harness\apps\cli\lib\bin.js
```
