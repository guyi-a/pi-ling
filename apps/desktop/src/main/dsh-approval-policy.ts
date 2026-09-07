import path from "node:path";

import {
  approvalReason,
  classifyCommand,
  effectDigest,
  type ApprovalMode,
  type Effect,
} from "@pi-ling/coding-agent";
import type { ToolCall } from "@earendil-works/pi-ai";

export interface DshPermissionEffectInput {
  callId: string;
  title: string;
  toolKind?: string;
  input?: unknown;
}

export interface DshApprovalEvaluation {
  effect: Effect;
  call: ToolCall;
  effectDigest: string;
  reason?: string;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(
  input: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function workspacePath(
  workspaceRoot: string,
  userPath: string,
): string | undefined {
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(root, userPath);
  const relative = path.relative(root, target);
  return relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
    ? target
    : undefined;
}

function normalizeCall(
  event: DshPermissionEffectInput,
  input: Record<string, unknown>,
): ToolCall {
  const pathValue = stringValue(input, "path", "file_path", "filePath");
  const command = stringValue(input, "command");
  const newText = stringValue(input, "newText", "new_string");
  const arguments_: Record<string, unknown> = {
    ...input,
    ...(pathValue ? { path: pathValue } : {}),
    ...(command ? { command } : {}),
    ...(newText ? { newText } : {}),
  };
  const name =
    event.toolKind === "edit"
      ? newText
        ? "edit_file"
        : "write_file"
      : event.toolKind === "execute"
        ? "run_command"
        : event.title;
  return {
    type: "toolCall",
    id: event.callId,
    name,
    arguments: arguments_,
  };
}

function deriveDshEffect(
  event: DshPermissionEffectInput,
  input: Record<string, unknown>,
  workspaceRoot: string,
): Effect {
  if (event.toolKind === "read" || event.toolKind === "search") {
    const userPath = stringValue(input, "path", "file_path", "filePath") ?? ".";
    const resolved = workspacePath(workspaceRoot, userPath);
    return resolved
      ? {
          kind: "filesystem-read",
          operation: event.toolKind === "search" ? "grep" : "read",
          path: resolved,
          scope: "workspace",
        }
      : { kind: "unknown", note: "read path is outside the workspace" };
  }
  if (event.toolKind === "edit") {
    const userPath = stringValue(input, "path", "file_path", "filePath");
    if (!userPath) return { kind: "unknown", note: "write path is missing" };
    const resolved = workspacePath(workspaceRoot, userPath);
    return resolved
      ? {
          kind: "filesystem-write",
          operation:
            stringValue(input, "newText", "new_string") !== undefined
              ? "edit"
              : "write",
          path: resolved,
          scope: "workspace",
        }
      : { kind: "unknown", note: "write path is outside the workspace" };
  }
  if (event.toolKind === "execute") {
    const command = stringValue(input, "command");
    return command
      ? {
          kind: "process-exec",
          command,
          cwd: workspaceRoot,
          classification: classifyCommand(command),
        }
      : { kind: "unknown", note: "command is missing" };
  }
  if (event.toolKind === "delete") {
    return { kind: "unknown", note: "delete operation requires approval" };
  }
  return {
    kind: "unknown",
    note: `No effect mapping for DSH tool ${event.title}`,
  };
}

export function evaluateDshApproval(
  event: DshPermissionEffectInput,
  mode: ApprovalMode,
  workspaceRoot: string,
): DshApprovalEvaluation {
  const input = record(event.input);
  const call = normalizeCall(event, input);
  const effect = deriveDshEffect(event, input, workspaceRoot);
  const reason = approvalReason(effect, mode, call);
  return {
    effect,
    call,
    effectDigest: effectDigest(effect, call),
    ...(reason ? { reason } : {}),
  };
}
