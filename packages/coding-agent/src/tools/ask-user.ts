import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@pi-ling/agent-core";
import type { AskUserQuestion } from "@pi-ling/contracts";

import type { QuestionManager } from "../question/question-manager.js";

export function createAskUserTool(
  questions: QuestionManager,
  getIdentity: () => { runId: string; turnId: string } | null,
): AgentTool {
  const tool: AgentTool = {
    name: "ask_user",
    label: "Ask user",
    description:
      "Ask the user a concise question when you need confirmation, a choice, or missing information before proceeding. " +
      "Send one or more questions, each with a stable id echoed in the answer. " +
      "If you recommend an option, put it first and append (Recommended) to that label.",
    parameters: Type.Object({
      questions: Type.Array(
        Type.Object({
          id: Type.String({ minLength: 1 }),
          question: Type.String({ minLength: 1 }),
          header: Type.Optional(Type.String()),
          options: Type.Optional(
            Type.Array(
              Type.Object({
                label: Type.String({ minLength: 1 }),
                description: Type.Optional(Type.String()),
              }),
            ),
          ),
        }),
        { minItems: 1 },
      ),
    }),
    execute: async (callId, arguments_, signal) => {
      const identity = getIdentity();
      if (!identity) {
        throw new Error("ask_user is unavailable outside an active tool turn");
      }
      const { questions: payload } = arguments_ as {
        questions: AskUserQuestion[];
      };
      const answers = await questions.wait(
        identity,
        callId,
        payload,
        signal,
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ answers }),
          },
        ],
      };
    },
  };
  return tool;
}
