import type { ComponentType } from "react";

import { PlanToolCard } from "../features/chat/cards/PlanToolCard";
import { ReadImageToolCard } from "../features/chat/cards/ReadImageToolCard";
import { SubagentToolCard } from "../features/chat/cards/SubagentToolCard";
import { TodoToolCard } from "../features/chat/cards/TodoToolCard";
import { WebSearchToolCard } from "../features/chat/cards/WebSearchToolCard";
import type { ToolTimelineItem } from "../timeline/reducer";
import {
  classifyTool,
  toolAction,
  toolLabel,
  toolNameLabel,
  toolTarget,
  type ToolCategory,
} from "./tool-taxonomy";

export type { ToolCategory };

export interface ToolDescriptor {
  id: string;
  match: (tool: ToolTimelineItem) => boolean;
  label: string | ((tool: ToolTimelineItem) => string);
  category: ToolCategory | ((tool: ToolTimelineItem) => ToolCategory);
  target: (tool: ToolTimelineItem) => string;
  action: (tool: ToolTimelineItem) => { verb: string; target: string };
  renderer?: ComponentType<{ item: ToolTimelineItem }>;
  priority: number;
}

function normalizedName(name: string): string {
  return name.toLowerCase().replaceAll(/[\s-]+/g, "_");
}

function matchesPattern(name: string, pattern: RegExp): boolean {
  return pattern.test(normalizedName(name));
}

function descriptor(
  id: string,
  pattern: RegExp,
  priority: number,
  renderer?: ComponentType<{ item: ToolTimelineItem }>,
): ToolDescriptor {
  return {
    id,
    priority,
    match: (tool) => matchesPattern(tool.tool, pattern),
    label: (tool) => toolNameLabel(tool.tool),
    category: (tool) => classifyTool(tool),
    target: toolTarget,
    action: toolAction,
    ...(renderer ? { renderer } : {}),
  };
}

const DEFAULT_DESCRIPTOR: ToolDescriptor = {
  id: "default",
  priority: 0,
  match: () => true,
  label: (tool) => toolNameLabel(tool.tool),
  category: (tool) => classifyTool(tool),
  target: toolTarget,
  action: toolAction,
};

const BUILTIN_DESCRIPTORS: ToolDescriptor[] = [
  descriptor("todo", /todo_write|update_todo|todowrite/, 20, TodoToolCard),
  descriptor("plan", /exit_plan_mode|^plan$|update_plan|create_plan/, 20, PlanToolCard),
  descriptor("web-search", /web_search/, 15, WebSearchToolCard),
  descriptor("subagent", /subagent_fork|^subagent$|spawn_subagent/, 15, SubagentToolCard),
  descriptor("read-image", /read_image|image_read/, 10, ReadImageToolCard),
  descriptor("fetch", /web_fetch|^fetch$/, 10),
  descriptor("goal", /create_goal|update_goal|get_goal/, 10),
  descriptor("skill", /^skill/, 10),
  descriptor("job", /job_(list|output|kill)|^job$/, 10),
  descriptor("workflow", /workflow/, 10),
  descriptor("ralph", /ralph/, 10),
  descriptor("agent-coord", /list_agents|send_message|interrupt_agent/, 10),
  descriptor("edit", /str_replace_editor|str_replace|edit_file|^edit$|patch/, 5),
  descriptor("write", /write_file|^write$|create_file/, 5),
  descriptor("read", /read_file|^read$/, 5),
  descriptor("list", /glob|list_files/, 5),
  descriptor("grep", /grep|search/, 5),
  descriptor("delete", /delete|remove|unlink/, 5),
  descriptor("command", /pwsh|bash|run_command|shell|terminal|execute/, 5),
];

const sortedDescriptors = [...BUILTIN_DESCRIPTORS].sort(
  (left, right) => right.priority - left.priority,
);

export function resetToolRegistryForTests(): void {
  sortedDescriptors.splice(
    0,
    sortedDescriptors.length,
    ...BUILTIN_DESCRIPTORS.sort((left, right) => right.priority - left.priority),
  );
}

export function registerToolDescriptor(descriptor: ToolDescriptor): void {
  sortedDescriptors.push(descriptor);
  sortedDescriptors.sort((left, right) => right.priority - left.priority);
}

export function resolveToolDescriptor(tool: ToolTimelineItem): ToolDescriptor {
  return (
    sortedDescriptors.find((candidate) => candidate.match(tool)) ??
    DEFAULT_DESCRIPTOR
  );
}

export function resolveToolLabel(tool: ToolTimelineItem): string {
  const descriptor = resolveToolDescriptor(tool);
  return typeof descriptor.label === "function"
    ? descriptor.label(tool)
    : descriptor.label;
}

export function resolveToolTarget(tool: ToolTimelineItem): string {
  return resolveToolDescriptor(tool).target(tool);
}

export function resolveToolAction(tool: ToolTimelineItem): {
  verb: string;
  target: string;
} {
  return resolveToolDescriptor(tool).action(tool);
}

export function resolveToolCategory(tool: ToolTimelineItem): ToolCategory {
  const descriptor = resolveToolDescriptor(tool);
  return typeof descriptor.category === "function"
    ? descriptor.category(tool)
    : descriptor.category;
}

export function resolveToolRenderer(
  tool: ToolTimelineItem,
): ComponentType<{ item: ToolTimelineItem }> | undefined {
  return resolveToolDescriptor(tool).renderer;
}

// Backward-compatible exports for existing taxonomy consumers.
export { toolLabel, toolTarget, toolAction, toolNameLabel, classifyTool };
