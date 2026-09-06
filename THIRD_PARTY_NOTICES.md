# Third-party notices

## Pi

The design and behavior of `packages/ai` and `packages/agent-core` were
implemented with reference to the Pi project:

- https://github.com/earendil-works/pi
- Copyright (c) 2025 Mario Zechner
- License: MIT

Source snapshots used for comparison are stored in `vendor/pi-ai` and
`vendor/pi-agent-core`. Each snapshot includes the upstream license and exact
commit metadata in `UPSTREAM.md`.

## Runtime libraries

The model transports use the OpenAI JavaScript library and the Anthropic
TypeScript SDK. Their package licenses and notices remain available with the
installed dependencies.

## DeepSeek Harness

The optional DSH Runtime integrates DeepSeek Harness `0.1.3-alpha.1`
(`d347e703908d0406b7a7ef80e3a0e594d86b2215`) under the MIT License:

- https://github.com/deepseek-ai/deepseek-harness

ACP transport uses `@agentclientprotocol/sdk` 1.4.0 under Apache-2.0.
