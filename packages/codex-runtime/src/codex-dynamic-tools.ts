import type { CodexDynamicToolSpec } from "./codex-app-server-types.js";

export const PI_LING_CODEX_DYNAMIC_TOOLS: CodexDynamicToolSpec[] = [
  {
    type: "function",
    name: "create_plan",
    description:
      "Present a markdown implementation plan for user review. Stop and wait for Build after calling it.",
    inputSchema: {
      type: "object",
      properties: {
        plan: { type: "string", minLength: 1 },
      },
      required: ["plan"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "update_plan",
    description:
      "Revise the current markdown implementation plan before the user Builds.",
    inputSchema: {
      type: "object",
      properties: {
        plan: { type: "string", minLength: 1 },
        content: { type: "string", minLength: 1 },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "ask_user",
    description:
      "Ask one or more blocking multiple-choice questions when user input is required.",
    inputSchema: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              question: { type: "string" },
              header: { type: "string" },
              allow_multiple: { type: "boolean" },
              options: {
                type: "array",
                minItems: 2,
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    label: { type: "string" },
                    description: { type: "string" },
                  },
                  required: ["id", "label"],
                  additionalProperties: false,
                },
              },
            },
            required: ["id", "question", "options"],
            additionalProperties: false,
          },
        },
      },
      required: ["questions"],
      additionalProperties: false,
    },
  },
];
