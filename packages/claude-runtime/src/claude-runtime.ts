import { randomUUID } from "node:crypto";

import {
  query,
  type CanUseTool,
  type PermissionResult,
  type SDKMessage,
  type SessionStore,
} from "@anthropic-ai/claude-agent-sdk";
import { SqliteClaudeSessionStore } from "@pi-ling/claude-transcript";
import type {
  RuntimeAdapter,
  RuntimeCapabilities,
  RuntimeEvent,
  RuntimeEventListener,
  RuntimePermissionDecision,
  RuntimeSessionHandle,
  RuntimeSessionOptions,
} from "@pi-ling/runtime-contracts";

import {
  buildClaudeSubprocessEnv,
  detectClaudeModelBackend,
  resolveClaudeSdkModel,
  type ClaudeModelBackend,
  type ClaudeRuntimeEnvOptions,
} from "./claude-env.js";

export interface ClaudeRuntimeOptions extends ClaudeRuntimeEnvOptions {
  sessionStore?: SessionStore;
  sessionStorePath?: string;
  model?: string;
  permissionMode?: "default" | "dontAsk" | "acceptEdits" | "bypassPermissions";
  maxTurns?: number;
  /** Empty array disables built-in tools for probe-style runs. */
  tools?: string[];
  stderr?: (data: string) => void;
}

interface SessionState {
  workspaceRoot: string;
  claudeSessionId: string;
  started: boolean;
  abortController?: AbortController;
}

interface PendingPermission {
  sessionId: string;
  runId: string;
  toolName: string;
  input: Record<string, unknown>;
  resolve: (result: PermissionResult) => void;
}

function executionGroupId(runId: string): string {
  return `${runId}:exec`;
}

function assistantText(message: SDKMessage): string {
  if (message.type !== "assistant") return "";
  return message.message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("");
}

function streamDelta(
  message: SDKMessage,
): { channel: "text" | "thought"; delta: string } | undefined {
  if (message.type !== "stream_event") return undefined;
  const event = message.event;
  if (event.type !== "content_block_delta") return undefined;
  const delta = event.delta;
  if (delta.type === "text_delta") {
    return { channel: "text", delta: delta.text };
  }
  if (delta.type === "thinking_delta") {
    return { channel: "thought", delta: delta.thinking };
  }
  return undefined;
}

export class ClaudeRuntimeAdapter implements RuntimeAdapter {
  readonly kind = "claude" as const;
  readonly capabilities: RuntimeCapabilities = {
    modelSwitching: true,
    partialStreaming: true,
    toolApproval: true,
    mcp: true,
    hooks: true,
    sandbox: false,
    subagents: true,
    resume: true,
    fork: true,
    fileCheckpoint: false,
  };

  readonly #options: ClaudeRuntimeOptions;
  readonly #listeners = new Set<RuntimeEventListener>();
  readonly #sessions = new Map<string, SessionState>();
  readonly #permissions = new Map<string, PendingPermission>();
  readonly #sessionStore: SessionStore;
  readonly #ownsSessionStore: boolean;
  readonly #backend: ClaudeModelBackend;
  readonly #model: string;

  constructor(options: ClaudeRuntimeOptions = {}) {
    this.#options = options;
    this.#backend =
      detectClaudeModelBackend(process.env, options) ?? "anthropic";
    this.#model =
      options.model ?? resolveClaudeSdkModel(this.#backend, process.env);
    if (options.sessionStore) {
      this.#sessionStore = options.sessionStore;
      this.#ownsSessionStore = false;
    } else {
      this.#sessionStore = new SqliteClaudeSessionStore(
        options.sessionStorePath ?? ":memory:",
      );
      this.#ownsSessionStore = true;
    }
  }

  get modelBackend(): ClaudeModelBackend {
    return this.#backend;
  }

  get model(): string {
    return this.#model;
  }

  async initialize(): Promise<void> {}

  async createSession(
    options: RuntimeSessionOptions,
  ): Promise<RuntimeSessionHandle> {
    const claudeSessionId = options.externalSessionId ?? options.sessionId;
    this.#sessions.set(options.sessionId, {
      workspaceRoot: options.workspaceRoot,
      claudeSessionId,
      started: false,
    });
    return {
      sessionId: options.sessionId,
      externalSessionId: claudeSessionId,
    };
  }

  resumeSession(
    options: RuntimeSessionOptions,
  ): Promise<RuntimeSessionHandle> {
    const existing = this.#sessions.get(options.sessionId);
    if (existing) {
      existing.workspaceRoot = options.workspaceRoot;
      return Promise.resolve({
        sessionId: options.sessionId,
        externalSessionId: existing.claudeSessionId,
      });
    }
    return this.createSession({
      ...options,
      externalSessionId: options.externalSessionId ?? options.sessionId,
    });
  }

  async send(sessionId: string, runId: string, prompt: string): Promise<void> {
    const state = this.#sessions.get(sessionId);
    if (!state) throw new Error(`Claude session not found: ${sessionId}`);

    const abortController = new AbortController();
    state.abortController = abortController;
    await this.#emit({ type: "run_start", sessionId, runId });

    const subprocessEnv = buildClaudeSubprocessEnv(process.env, this.#options);
    const permissionMode = this.#options.permissionMode ?? "default";
    const canUseTool =
      permissionMode === "default"
        ? this.#buildCanUseTool(sessionId, runId)
        : undefined;

    const queryOptions = {
      cwd: state.workspaceRoot,
      model: this.#model,
      env: subprocessEnv,
      sessionStore: this.#sessionStore,
      sessionStoreFlush: "eager" as const,
      persistSession: true,
      includePartialMessages: true,
      abortController,
      permissionMode,
      tools: this.#options.tools ?? [],
      ...(this.#options.stderr ? { stderr: this.#options.stderr } : {}),
      ...(canUseTool ? { canUseTool } : {}),
      ...(this.#options.maxTurns !== undefined
        ? { maxTurns: this.#options.maxTurns }
        : {}),
      ...(state.started
        ? { resume: state.claudeSessionId }
        : { sessionId: state.claudeSessionId }),
    };

    let terminalStatus: "completed" | "cancelled" | "error" = "completed";
    let terminalError: string | undefined;

    try {
      for await (const message of query({ prompt, options: queryOptions })) {
        if (abortController.signal.aborted) {
          terminalStatus = "cancelled";
          break;
        }
        const outcome = await this.#handleMessage(sessionId, runId, message);
        if (outcome?.status) {
          terminalStatus = outcome.status;
          terminalError = outcome.error;
          if (outcome.status === "error") {
            abortController.abort();
            break;
          }
        }
      }
      state.started = true;
      if (abortController.signal.aborted && terminalStatus === "completed") {
        terminalStatus = "cancelled";
      }
      if (terminalStatus === "error") {
        throw new Error(terminalError ?? "Claude runtime failed");
      }
    } catch (error) {
      terminalStatus = "error";
      terminalError = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      delete state.abortController;
      await this.#emit({
        type: "run_end",
        sessionId,
        runId,
        status: terminalStatus,
        ...(terminalError ? { error: terminalError } : {}),
      });
    }
  }

  async cancel(sessionId: string): Promise<void> {
    this.#sessions.get(sessionId)?.abortController?.abort();
  }

  async resolvePermission(
    decision: RuntimePermissionDecision,
  ): Promise<boolean> {
    const pending = this.#permissions.get(decision.permissionId);
    if (!pending) return false;
    this.#permissions.delete(decision.permissionId);
    pending.resolve(
      decision.cancelled || decision.optionId === "reject-once"
        ? { behavior: "deny", message: "User rejected tool execution" }
        : { behavior: "allow", updatedInput: pending.input },
    );
    return true;
  }

  async closeSession(sessionId: string): Promise<void> {
    await this.cancel(sessionId);
    this.#sessions.delete(sessionId);
  }

  subscribe(listener: RuntimeEventListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async dispose(): Promise<void> {
    for (const sessionId of [...this.#sessions.keys()]) {
      await this.closeSession(sessionId);
    }
    this.#listeners.clear();
    if (this.#ownsSessionStore && this.#sessionStore instanceof SqliteClaudeSessionStore) {
      this.#sessionStore.close();
    }
  }

  #buildCanUseTool(sessionId: string, runId: string): CanUseTool {
    return (toolName, input, _options) =>
      new Promise<PermissionResult>((resolve) => {
        const permissionId = randomUUID();
        this.#permissions.set(permissionId, {
          sessionId,
          runId,
          toolName,
          input,
          resolve,
        });
        void this.#emit({
          type: "permission",
          sessionId,
          runId,
          executionGroupId: executionGroupId(runId),
          permissionId,
          callId: permissionId,
          title: toolName,
          input,
          options: [
            {
              optionId: "allow-once",
              label: "Allow once",
              kind: "allow_once",
            },
            {
              optionId: "reject-once",
              label: "Reject",
              kind: "reject_once",
            },
          ],
        });
      });
  }

  async #handleMessage(
    sessionId: string,
    runId: string,
    message: SDKMessage,
  ): Promise<{ status?: "completed" | "cancelled" | "error"; error?: string } | undefined> {
    const groupId = executionGroupId(runId);

    const partial = streamDelta(message);
    if (partial) {
      await this.#emit({
        type: partial.channel === "text" ? "assistant_text" : "assistant_thought",
        sessionId,
        runId,
        executionGroupId: groupId,
        delta: partial.delta,
        ...(message.type === "stream_event" && message.uuid
          ? { messageId: message.uuid }
          : {}),
      });
      return undefined;
    }

    if (message.type === "assistant") {
      const text = assistantText(message);
      if (text) {
        await this.#emit({
          type: "assistant_text",
          sessionId,
          runId,
          executionGroupId: groupId,
          delta: text,
          messageId: message.uuid,
        });
      }
      return undefined;
    }

    if (message.type === "system" && message.subtype === "api_retry") {
      if (message.attempt >= 3) {
        return {
          status: "error",
          error:
            `Claude Code API retry failed (${message.error ?? "unknown"}). ` +
            "DeepSeek Anthropic 兼容层目前无法稳定驱动 Claude Code agent loop（CLI 与 SDK 共用 CC 子进程）；" +
            "请改用官方 ANTHROPIC_API_KEY，或等待 DeepSeek 侧兼容完善。",
        };
      }
      return undefined;
    }

    if (message.type === "tool_progress") {
      await this.#emit({
        type: "tool",
        sessionId,
        runId,
        executionGroupId: groupId,
        callId: message.tool_use_id,
        title: message.tool_name,
        status: "running",
      });
      return undefined;
    }

    if (message.type === "result") {
      if (message.subtype !== "success") {
        return {
          status: "error",
          error: message.subtype,
        };
      }
      if (message.is_error) {
        return {
          status: "error",
          error: message.result || "Claude runtime returned an API error",
        };
      }
      return { status: "completed" };
    }

    return undefined;
  }

  async #emit(event: RuntimeEvent): Promise<void> {
    for (const listener of this.#listeners) {
      await listener(event);
    }
  }
}
