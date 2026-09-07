# Third-party notices

## Pi

The Native Runtime uses `@earendil-works/pi-ai` 0.85.0. The design and
behavior of `packages/agent-core` and the transitional DSH model PoC were also
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

## Claude Agent SDK

The Claude Runtime proof of concept uses
`@anthropic-ai/claude-agent-sdk` 0.3.263 and its bundled Claude Code executable:

- https://github.com/anthropics/claude-agent-sdk-typescript

Use and redistribution are subject to the license and service terms shipped
with the installed Anthropic packages.
