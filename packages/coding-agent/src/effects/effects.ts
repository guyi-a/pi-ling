import { createHash } from "node:crypto";

import type { ToolCall } from "@earendil-works/pi-ai";

import { isPrivateUrl } from "@pi-ling/web-tools";

import type { Workspace } from "../workspace/workspace.js";

export type Effect =
  | {
      kind: "filesystem-read";
      operation: "read" | "list" | "grep" | "glob" | "read_image";
      path: string;
      scope: "workspace";
    }
  | {
      kind: "filesystem-write";
      operation: "write" | "edit" | "delete";
      path: string;
      scope: "workspace";
    }
  | {
      kind: "process-exec";
      command: string;
      cwd: string;
      classification: "harmless" | "normal" | "destructive";
    }
  | { kind: "meta"; operation: "plan" | "todo" | "question" | "skill" }
  | {
      kind: "network";
      operation: "fetch";
      /** 目标 URL / 查询串。 */
      target: string;
      /** 目标是否为本机 / 内网（fetch 专用；search 恒为 false）。 */
      privateHost: boolean;
    }
  | { kind: "subagent-spawn"; readonly: true }
  | { kind: "unknown"; note: string };

export type ApprovalMode = "manual" | "accept-write" | "auto";

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
    call.name === "grep" ||
    call.name === "glob" ||
    call.name === "read_image"
  ) {
    const userPath =
      call.name === "glob"
        ? typeof arguments_["target_directory"] === "string"
          ? arguments_["target_directory"]
          : "."
        : typeof arguments_["path"] === "string"
          ? arguments_["path"]
          : ".";
    const operation =
      call.name === "read_file"
        ? "read"
        : call.name === "grep"
          ? "grep"
          : call.name === "glob"
            ? "glob"
            : call.name === "read_image"
              ? "read_image"
              : "list";
    return {
      kind: "filesystem-read",
      operation,
      path: await workspace.resolve(userPath),
      scope: "workspace",
    };
  }
  if (
    call.name === "write_file" ||
    call.name === "edit_file" ||
    call.name === "delete" ||
    call.name === "delete_file"
  ) {
    const userPath = arguments_["path"];
    if (typeof userPath !== "string") {
      return { kind: "unknown", note: "write path is missing" };
    }
    const operation =
      call.name === "write_file"
        ? "write"
        : call.name === "delete" || call.name === "delete_file"
          ? "delete"
          : "edit";
    return {
      kind: "filesystem-write",
      operation,
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
  if (call.name === "ask_user") {
    return { kind: "meta", operation: "question" };
  }
  if (
    call.name === "create_plan" ||
    call.name === "update_plan" ||
    call.name === "todo_write"
  ) {
    return {
      kind: "meta",
      operation: call.name === "todo_write" ? "todo" : "plan",
    };
  }
  if (call.name === "spawn_subagent") {
    return { kind: "subagent-spawn", readonly: true };
  }
  if (call.name === "load_skill") {
    return { kind: "meta", operation: "skill" };
  }
  if (call.name === "web_fetch" || call.name === "web_search") {
    const isFetch = call.name === "web_fetch";
    const raw = isFetch ? arguments_["url"] : arguments_["query"];
    const target = typeof raw === "string" ? raw.trim() : "";
    return {
      kind: "network",
      operation: "fetch",
      target,
      privateHost: isFetch && isPrivateUrl(target),
    };
  }
  return {
    kind: "unknown",
    note: `No effect derivation for tool ${call.name}`,
  };
}

function sensitiveReason(
  effect: Effect,
  call: ToolCall,
): string | undefined {
  if (effect.kind !== "filesystem-write") return undefined;
  const name = effect.path.toLowerCase();
  if (
    /(?:^|[\\/])\.env(?:\.|$)/.test(name) ||
    /\.(?:pem|key)$/.test(name) ||
    /credential|secret|token/.test(name)
  ) {
    return "sensitive file";
  }
  const content = [call.arguments["content"], call.arguments["newText"]]
    .filter((value): value is string => typeof value === "string")
    .join("\n");
  return /(?:api[_-]?key|secret|token|password)\s*[:=]/i.test(content)
    ? "content may contain credentials"
    : undefined;
}

export function approvalReason(
  effect: Effect,
  mode: ApprovalMode = "manual",
  call?: ToolCall,
): string | undefined {
  if (effect.kind === "meta" || effect.kind === "subagent-spawn") {
    return undefined;
  }
  if (effect.kind === "unknown") {
    return effect.note;
  }
  if (effect.kind === "network") {
    if (effect.privateHost) return "private network URL is blocked";
    return undefined; // 只读出网，不打扰用户
  }
  if (
    effect.kind === "process-exec" &&
    effect.classification === "destructive"
  ) {
    return "destructive command";
  }
  if (call) {
    const sensitive = sensitiveReason(effect, call);
    if (sensitive) return sensitive;
  }
  if (effect.kind === "filesystem-read") {
    return undefined;
  }
  if (effect.kind === "filesystem-write") {
    return mode === "manual"
      ? `${effect.operation} ${effect.path}`
      : undefined;
  }
  if (effect.kind === "process-exec") {
    if (effect.classification === "harmless" || mode === "auto") {
      return undefined;
    }
    return `${effect.classification} command`;
  }
  return undefined;
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
