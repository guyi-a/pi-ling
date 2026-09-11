import type { AgentTool } from "@pi-ling/agent-core";

import type { Effect } from "./effects/effects.js";

export type ComposerMode = "plan" | "ask" | "agent";

export const READ_TOOL_NAMES = new Set([
  "read_file",
  "list_files",
  "grep",
  "glob",
  "read_image",
]);

export const PLAN_TOOL_NAMES = new Set(["create_plan", "update_plan"]);

export const ALWAYS_ALLOWED_TOOLS = new Set(["ask_user", "load_skill"]);

function allowedToolNamesForMode(mode: ComposerMode): Set<string> | null {
  if (mode === "agent") return null;
  if (mode === "ask") {
    return new Set([...READ_TOOL_NAMES, ...ALWAYS_ALLOWED_TOOLS]);
  }
  return new Set([
    ...READ_TOOL_NAMES,
    ...PLAN_TOOL_NAMES,
    ...ALWAYS_ALLOWED_TOOLS,
  ]);
}

export function toolsForComposerMode(
  allTools: AgentTool[],
  mode: ComposerMode,
): AgentTool[] {
  const allowed = allowedToolNamesForMode(mode);
  if (!allowed) return allTools;
  return allTools.filter((tool) => allowed.has(tool.name));
}

export function systemPromptForComposerMode(
  basePrompt: string,
  mode: ComposerMode,
): string {
  if (mode === "agent") return basePrompt;
  const suffix =
    mode === "plan"
      ? "\nYou are in plan mode. Use create_plan and update_plan to draft plans for user review. You may read the workspace but must not write files or run commands until the user Builds."
      : "\nYou are in ask mode. Answer questions using read-only exploration tools. Do not write files, run commands, or create plans.";
  return `${basePrompt}${suffix}`;
}

export function wrapPromptForComposerMode(
  prompt: string,
  mode: ComposerMode,
): string {
  if (mode === "agent") return prompt;
  if (mode === "plan") {
    return [
      "[Composer mode: Plan]",
      "Current composer mode is Plan. Draft or update an implementation plan only. Do not modify files or run shell commands until the user Builds.",
      "",
      prompt,
    ].join("\n");
  }
  return [
    "[Composer mode: Ask]",
    "Current composer mode is Ask. Answer using read-only exploration. Do not modify files, run shell commands, or create build plans.",
    "",
    prompt,
  ].join("\n");
}

export function isEffectAllowedInComposerMode(
  mode: ComposerMode,
  effect: Effect,
): boolean {
  if (effect.kind === "subagent-spawn") {
    return mode === "agent";
  }
  if (mode === "agent") return true;
  if (mode === "ask") {
    if (
      effect.kind === "meta" &&
      (effect.operation === "question" || effect.operation === "skill")
    ) {
      return true;
    }
    return effect.kind === "filesystem-read";
  }
  if (effect.kind === "filesystem-read") return true;
  if (effect.kind === "meta") {
    return (
      effect.operation === "plan" ||
      effect.operation === "question" ||
      effect.operation === "skill"
    );
  }
  return false;
}
