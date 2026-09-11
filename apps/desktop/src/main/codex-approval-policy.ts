import path from "node:path";

import {
  approvalReason,
  classifyCommand,
  effectDigest,
  type ApprovalMode,
  type Effect,
} from "@pi-ling/coding-agent";
import type { ToolCall } from "@earendil-works/pi-ai";

export interface CodexPermissionEffectInput {
  callId: string;
  title: string;
  toolKind?: string;
  input?: unknown;
}

export interface CodexApprovalEvaluation {
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
  event: CodexPermissionEffectInput,
  input: Record<string, unknown>,
): ToolCall {
  const pathValue = stringValue(input, "path", "file_path", "filePath");
  const command = stringValue(input, "command");
  const name =
    event.toolKind === "edit"
      ? "edit_file"
      : event.toolKind === "execute"
        ? "run_command"
        : event.title;
  return {
    type: "toolCall",
    id: event.callId,
    name,
    arguments: {
      ...input,
      ...(pathValue ? { path: pathValue } : {}),
      ...(command ? { command } : {}),
    },
  };
}

function deriveCodexEffect(
  event: CodexPermissionEffectInput,
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
          operation: "write",
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
  return {
    kind: "unknown",
    note: `No effect mapping for Codex tool ${event.title}`,
  };
}

export function mapCodexApprovalPolicy(
  mode: ApprovalMode,
): "never" | "on-request" | "on-failure" | "untrusted" {
  switch (mode) {
    case "auto":
      return "never";
    case "accept-write":
      return "untrusted";
    case "manual":
      return "untrusted";
  }
}

export function mapCodexSandboxMode(
  composerMode: import("@pi-ling/contracts").ComposerMode,
): "read-only" | "workspace-write" | "danger-full-access" {
  switch (composerMode) {
    case "ask":
    case "plan":
      return "read-only";
    case "agent":
      return "workspace-write";
  }
}

export function buildCodexThreadOptions(
  approvalMode: import("@pi-ling/contracts").ApprovalMode,
  composerMode: import("@pi-ling/contracts").ComposerMode,
): {
  sandboxMode: ReturnType<typeof mapCodexSandboxMode>;
  approvalPolicy: ReturnType<typeof mapCodexApprovalPolicy>;
  composerMode: import("@pi-ling/contracts").ComposerMode;
} {
  return {
    // A read-only sandbox forces workspace mutations through app-server
    // approval requests in manual mode.
    sandboxMode:
      approvalMode === "manual"
        ? "read-only"
        : mapCodexSandboxMode(composerMode),
    approvalPolicy: mapCodexApprovalPolicy(approvalMode),
    composerMode,
  };
}

export function evaluateCodexApproval(
  event: CodexPermissionEffectInput,
  mode: ApprovalMode,
  workspaceRoot: string,
): CodexApprovalEvaluation {
  const input = record(event.input);
  const call = normalizeCall(event, input);
  const effect = deriveCodexEffect(event, input, workspaceRoot);
  const reason = approvalReason(effect, mode, call);
  return {
    effect,
    call,
    effectDigest: effectDigest(effect, call),
    ...(reason ? { reason } : {}),
  };
}
