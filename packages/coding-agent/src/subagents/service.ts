import { randomUUID } from "node:crypto";

import {
  Agent,
  type AgentEvent,
  type StreamFunction,
} from "@pi-ling/agent-core";
import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";
import type { SubagentSpec } from "@pi-ling/contracts";

import { Workspace } from "../workspace/workspace.js";
import { createBuiltinTools } from "../tools/builtins.js";
import { buildExploreSubagentPrompt } from "./prompt.js";
import type { SpawnedSubagent, SubagentResult } from "./runtime.js";

const exploreToolNames = new Set([
  "read_file",
  "list_files",
  "grep",
  "glob",
]);

const maximumSummaryLength = 8_000;

export type SpawnForegroundSubagentInput = {
  spec: SubagentSpec;
  parentSessionId: string;
  workspaceRoot: string;
  model: Model<Api>;
  streamFn: StreamFunction;
  signal?: AbortSignal;
  onSpawned?(child: SpawnedSubagent): Promise<void>;
};

function assistantText(message: AssistantMessage): string {
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

export class SubagentService {
  async spawnForeground(
    input: SpawnForegroundSubagentInput,
  ): Promise<SubagentResult> {
    const childSessionId = randomUUID();
    const childRunId = randomUUID();
    const child: SpawnedSubagent = { childSessionId, childRunId };

    await input.onSpawned?.(child);

    const workspace = await Workspace.open(input.workspaceRoot);
    const exploreTools = createBuiltinTools({
      workspace,
      changes: { capture: async () => {} },
    }).filter((tool) => exploreToolNames.has(tool.name));

    let summary = "";
    let interrupted = false;

    const agent = new Agent({
      initialState: {
        systemPrompt: buildExploreSubagentPrompt({
          workspaceRoot: input.workspaceRoot,
          description: input.spec.description,
        }),
        model: input.model,
        thinkingLevel: "high",
        tools: exploreTools,
        messages: [],
      },
      streamFn: input.streamFn,
      maxTurns: 50,
      beforeToolCall: async () => ({ allow: true }),
    });

    agent.subscribe((event: AgentEvent) => {
      if (event.type === "turn_end") {
        const text = assistantText(event.message);
        if (text) summary = text;
      } else if (event.type === "agent_end") {
        const lastAssistant = [...event.messages]
          .reverse()
          .find((message) => message.role === "assistant");
        if (lastAssistant?.role === "assistant") {
          const text = assistantText(lastAssistant);
          if (text) summary = text;
        }
      }
    });

    const signal = input.signal ?? new AbortController().signal;
    if (signal.aborted) {
      throw new Error("The explore subagent was interrupted.");
    }

    const abortListener = () => {
      interrupted = true;
      agent.abort(new Error("The explore subagent was interrupted."));
    };
    signal.addEventListener("abort", abortListener, { once: true });

    try {
      await agent.prompt(input.spec.prompt, { runId: childRunId });
    } finally {
      signal.removeEventListener("abort", abortListener);
    }

    if (interrupted || signal.aborted) {
      throw new Error("The explore subagent was interrupted.");
    }
    if (!summary) {
      throw new Error("The explore subagent completed without a summary.");
    }

    return {
      ...child,
      summary:
        summary.length > maximumSummaryLength
          ? `${summary.slice(0, maximumSummaryLength)}\n…[truncated]`
          : summary,
    };
  }
}
