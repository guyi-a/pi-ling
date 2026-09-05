import { createHash } from "node:crypto";

import type { ToolCall } from "@pi-ling/ai";

import type { Workspace } from "../workspace/workspace.js";

export type Effect =
  | {
      kind: "filesystem-read";
      operation: "read" | "list" | "grep";
      path: string;
      scope: "workspace";
    }
  | {
      kind: "filesystem-write";
      operation: "write" | "edit";
      path: string;
      scope: "workspace";
    }
  | {
      kind: "process-exec";
      command: string;
      cwd: string;
      classification: "harmless" | "normal" | "destructive";
    }
  | { kind: "unknown"; note: string };

const DESTRUCTIVE_COMMANDS = [
  /\brm\s+(-\S*r\S*f|-rf|-fr)\b/i,
  /\brmdir\s+\/s\b/i,
  /\bdel\s+\/[a-z]*s/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-\S*f/i,
  /\bformat(?:\.com)?\b/i,
  /\bshutdown\b/i,
];

const HARMLESS_COMMANDS = [
  /^pwd$/,
  /^(?:ls|dir)(?:\s+[^;&|<>]*)?$/i,
  /^(?:cat|type)\s+[^;&|<>]+$/i,
  /^git\s+(?:status|diff|log|show)(?:\s+[^;&|<>]*)?$/i,
  /^(?:rg|grep)\s+[^;&|<>]+$/i,
];

export function classifyCommand(
  command: string,
): "harmless" | "normal" | "destructive" {
  const value = command.trim();
  if (DESTRUCTIVE_COMMANDS.some((pattern) => pattern.test(value))) {
    return "destructive";
  }
  if (HARMLESS_COMMANDS.some((pattern) => pattern.test(value))) {
    return "harmless";
  }
  return "normal";
}

export async function deriveEffect(
  call: ToolCall,
  workspace: Workspace,
): Promise<Effect> {
  const arguments_ = call.arguments;
  if (
    call.name === "read_file" ||
    call.name === "list_files" ||
    call.name === "grep"
  ) {
    const userPath =
      typeof arguments_["path"] === "string" ? arguments_["path"] : ".";
    return {
      kind: "filesystem-read",
      operation:
        call.name === "read_file"
          ? "read"
          : call.name === "grep"
            ? "grep"
            : "list",
      path: await workspace.resolve(userPath),
      scope: "workspace",
    };
  }
  if (call.name === "write_file" || call.name === "edit_file") {
    const userPath = arguments_["path"];
    if (typeof userPath !== "string") {
      return { kind: "unknown", note: "write path is missing" };
    }
    return {
      kind: "filesystem-write",
      operation: call.name === "write_file" ? "write" : "edit",
      path: await workspace.resolve(userPath),
      scope: "workspace",
    };
  }
  if (call.name === "run_command") {
    const command = arguments_["command"];
    if (typeof command !== "string") {
      return { kind: "unknown", note: "command is missing" };
    }
    return {
      kind: "process-exec",
      command,
      cwd: workspace.root,
      classification: classifyCommand(command),
    };
  }
  return {
    kind: "unknown",
    note: `No effect derivation for tool ${call.name}`,
  };
}

export function approvalReason(effect: Effect): string | undefined {
  if (effect.kind === "filesystem-read") {
    return undefined;
  }
  if (effect.kind === "filesystem-write") {
    return `${effect.operation} ${effect.path}`;
  }
  if (effect.kind === "process-exec") {
    return effect.classification === "harmless"
      ? undefined
      : `${effect.classification} command`;
  }
  return effect.note;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function effectDigest(effect: Effect, call: ToolCall): string {
  return createHash("sha256")
    .update(canonical({ effect, tool: call.name, arguments: call.arguments }))
    .digest("hex");
}
