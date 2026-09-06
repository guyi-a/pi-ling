import { fileURLToPath } from "node:url";

import { Context } from "@deepseek-ai/cordis";
import AgentRegistry from "@deepseek-ai/dsh-agent";
import AgentLoop from "@deepseek-ai/dsh-agent-loop";
import LlmRuntime, {
  createUserMessage,
} from "@deepseek-ai/dsh-llm";
import SessionStore, {
  Session,
  SessionId,
} from "@deepseek-ai/dsh-session";
import SessionProjectionRegistry from "@deepseek-ai/dsh-session-projection";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime from "@deepseek-ai/dsh-tools";
import { PiLingLlmAdapter } from "@pi-ling/dsh-llm";
import { describe, expect, it } from "vitest";

import * as TranscriptSeedPlugin from "../src/index.js";
import {
  PiLingTranscriptSeedService,
  serviceName,
  toDshSeed,
} from "../src/index.js";

const canonicalHistory = [
  {
    id: "canonical-user-1",
    role: "user" as const,
    text: "My test code is ORANGE-42.",
  },
  {
    id: "canonical-assistant-1",
    role: "assistant" as const,
    text: "I will remember that code.",
    provider: "pi-ling-deepseek",
    model: "deepseek-v4-flash",
  },
];

describe("DSH transcript seed plugin", () => {
  it("projects canonical messages onto the DSH model surface", () => {
    const session = Session.create(
      SessionId("seed-projection"),
      toDshSeed(canonicalHistory, 1),
    );
    expect(
      session.deriveMessages().map((message) => ({
        id: message.id,
        role: message.role,
        text:
          message.content[0]?.type === "text"
            ? message.content[0].text
            : "",
      })),
    ).toEqual([
      {
        id: "canonical-user-1",
        role: "user",
        text: "My test code is ORANGE-42.",
      },
      {
        id: "canonical-assistant-1",
        role: "assistant",
        text: "I will remember that code.",
      },
    ]);
  });

  it.skipIf(process.env["RUN_REAL_DSH_SEED_POC"] !== "1")(
    "lets a real DSH turn use imported canonical history",
    async () => {
      process.loadEnvFile(
        fileURLToPath(new URL("../../../.env", import.meta.url)),
      );
      const ctx = new Context();
      let handle:
        | Awaited<ReturnType<PiLingTranscriptSeedService["createAgent"]>>
        | undefined;
      try {
        await ctx.plugin(LlmRuntime);
        await ctx.plugin(SessionStore);
        await ctx.plugin(SessionProjectionRegistry);
        await ctx.plugin(SystemPrompt, {
          persona: "Answer briefly and use the supplied conversation history.",
        });
        await ctx.plugin(ToolRuntime);
        await ctx.plugin(AgentRegistry);
        await ctx.plugin(AgentLoop, { agents: [] });
        ctx.llm.registerAdapter(
          ["pi-ling-deepseek"],
          new PiLingLlmAdapter(["pi-ling-deepseek"]),
        );
        await ctx.plugin(TranscriptSeedPlugin);
        const service = ctx.get(serviceName) as
          | PiLingTranscriptSeedService
          | undefined;
        if (!service) throw new Error("Transcript seed service was not loaded");
        handle = await service.createAgent({
          sessionId: "real-seed-poc",
          cwd: "E:/pi-ling",
          provider: "pi-ling-deepseek",
          model: "deepseek-v4-flash",
          messages: canonicalHistory,
        });
        const idle = new Promise<void>((resolve) => {
          const dispose = ctx.on(
            "agent/status",
            ({ agent, status }) => {
              if (agent === handle?.agent && status === "idle") {
                dispose();
                resolve();
              }
            },
          );
        });
        handle.agent.followup(
          createUserMessage({
            content: [
              {
                type: "text",
                text: "What test code did I give you? Reply with only the code.",
              },
            ],
            source: { kind: "user" },
          }),
        );
        await idle;
        const messages = handle.agent.session.deriveMessages();
        const answer = [...messages]
          .reverse()
          .find((message) => message.role === "assistant");
        expect(JSON.stringify(answer?.content)).toContain("ORANGE-42");
      } finally {
        await handle?.dispose();
        await ctx.fiber.dispose();
      }
    },
  );
});
