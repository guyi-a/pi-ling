import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@pi-ling/agent-core";
import type { SubagentMode, SubagentSpec, SubagentType } from "@pi-ling/contracts";

import type { SubagentRuntime } from "./runtime.js";

function toSpec(input: {
  description: string;
  prompt: string;
  subagent_type?: SubagentType;
  run_in_background?: boolean;
}): SubagentSpec {
  return {
    type: input.subagent_type ?? "explore",
    mode: input.run_in_background ? "background" : "foreground",
    description: input.description,
    prompt: input.prompt,
  };
}

export function createSpawnSubagentTool(
  runtime: SubagentRuntime,
): AgentTool {
  return {
    name: "spawn_subagent",
    label: "Spawn subagent",
    description:
      "Delegate a focused, read-only codebase research task to an isolated " +
      "explore agent. Use when intermediate search output would clutter the main " +
      "conversation. Set run_in_background when the task can run in parallel.",
    parameters: Type.Object({
      description: Type.String({
        minLength: 1,
        description: "A short user-facing description of the delegated research.",
      }),
      prompt: Type.String({
        minLength: 1,
        description: "A self-contained task with all context the subagent needs.",
      }),
      subagent_type: Type.Optional(
        Type.Literal("explore", {
          description: "Subagent specialization.",
        }),
      ),
      run_in_background: Type.Optional(
        Type.Boolean({
          description:
            "Run independently and return a task id immediately.",
        }),
      ),
    }),
    execute: async (toolCallId, arguments_, signal) => {
      const input = arguments_ as {
        description: string;
        prompt: string;
        subagent_type?: SubagentType;
        run_in_background?: boolean;
      };
      const spec = toSpec(input);
      const result = await runtime.spawn(spec, {
        parentToolCallId: toolCallId,
        signal,
      });

      if ("taskId" in result) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                taskId: result.taskId,
                status: result.status,
                mode: "background" as SubagentMode,
              }),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              childSessionId: result.childSessionId,
              childRunId: result.childRunId,
              summary: result.summary,
              mode: "foreground" as SubagentMode,
            }),
          },
        ],
      };
    },
  };
}
