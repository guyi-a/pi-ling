# @pi-ling/dsh-sdk-runtime

Side-by-side proof of concept for controlling DeepSeek Harness through
`@deepseek-ai/dsh-sdk-client`.

It intentionally does not replace the production ACP adapter.

Verified/represented capabilities:

- SDK-owned DSH subprocess
- multiple named sessions in one process
- durable `session.event` mapping
- same-process conversation continuity
- whole-process cancellation fallback

Confirmed SDK protocol gaps in DSH `0.1.3-alpha.1`:

- no wire-level prompt cancel
- no permission/approval request channel
- no explicit session resume/close method
- no live `agent/assistant-stream` notification

Because cancellation closes the shared process and approval cannot reach the
pi-ling UI, this adapter is experimental only.
