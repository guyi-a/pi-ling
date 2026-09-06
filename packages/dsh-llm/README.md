# @pi-ling/dsh-llm

Experimental DSH `ctx.llm` adapter backed by `@pi-ling/ai`.

The package implements:

- DSH message/tool history to pi-ling Context conversion
- DeepSeek and Anthropic model catalog projection
- text, reasoning, tool-call, usage, and finish chunk conversion
- an isolated Cordis bundle definition

It compiles and its conversion contract is tested against the pinned DSH
`0.1.3-alpha.1` interfaces. The bundle row remains disabled by default:
mounting an external LLM adapter in the current alpha ACP profile causes DSH
to reject `session/new` with `cannot create effect on inactive context`.

The production DSH Runtime therefore uses the verified
`deepseek-official` route. Re-enable this row only after the upstream Cordis
activation issue is resolved and the real profile test passes.
