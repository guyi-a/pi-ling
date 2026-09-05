import {
  Agent,
  type AgentEvent,
  type BeforeToolCallContext,
  type StreamFunction,
} from "@pi-ling/agent-core";
import type { Model, ToolCall } from "@pi-ling/ai";

import {
  ApprovalManager,
  type ApprovalDecision,
  type ApprovalRequest,
} from "./approval/approval-manager.js";
import {
  ChangeTracker,
  type ChangedFile,
  type FileDiff,
} from "./diff/change-tracker.js";
import { deriveEffect } from "./effects/effects.js";
import { createBuiltinTools } from "./tools/builtins.js";
import { Workspace } from "./workspace/workspace.js";

export type CodingAgentEvent =
  | { type: "agent"; event: AgentEvent }
  | { type: "approval_requested"; approval: ApprovalRequest }
  | {
      type: "approval_resolved";
      callId: string;
      approved: boolean;
    }
  | { type: "changes"; files: ChangedFile[] };

export interface CodingAgentOptions {
  workspaceRoot: string;
  model: Model;
  streamFn: StreamFunction;
  emit(event: CodingAgentEvent): void | Promise<void>;
}

export class CodingAgent {
  readonly workspace: Workspace;
  readonly #agent: Agent;
  readonly #changes: ChangeTracker;
  readonly #approvals: ApprovalManager;
  readonly #emit: CodingAgentOptions["emit"];

  private constructor(
    workspace: Workspace,
    options: CodingAgentOptions,
  ) {
    this.workspace = workspace;
    this.#emit = options.emit;
    this.#changes = new ChangeTracker(workspace);
    this.#approvals = new ApprovalManager((approval) => {
      void this.#emit({ type: "approval_requested", approval });
    });
    const tools = createBuiltinTools({
      workspace,
      changes: this.#changes,
    });
    this.#agent = new Agent({
      initialState: {
        systemPrompt: [
          "You are pi-ling, a coding agent.",
          `The workspace root is ${workspace.root}.`,
          "Use the provided tools to inspect and modify the workspace.",
          "Never claim a file or command changed unless the tool succeeded.",
        ].join("\n"),
        model: options.model,
        thinkingLevel: "high",
        tools,
      },
      streamFn: options.streamFn,
      beforeToolCall: (context, signal) =>
        this.#beforeToolCall(context, signal),
    });
    this.#agent.subscribe(async (event) => {
      await this.#emit({ type: "agent", event });
      if (event.type === "tool_execution_end") {
        await this.#emit({
          type: "changes",
          files: await this.#changes.changedFiles(),
        });
      }
    });
  }

  static async create(options: CodingAgentOptions): Promise<CodingAgent> {
    return new CodingAgent(await Workspace.open(options.workspaceRoot), options);
  }

  get isStreaming(): boolean {
    return this.#agent.state.isStreaming;
  }

  get messages() {
    return this.#agent.state.messages;
  }

  prompt(text: string): Promise<void> {
    return this.#agent.prompt(text);
  }

  cancel(): void {
    this.#approvals.cancelAll();
    this.#agent.abort();
  }

  async reset(): Promise<void> {
    this.cancel();
    await this.#agent.waitForIdle();
    this.#agent.reset();
    this.#changes.reset();
  }

  resolveApproval(callId: string, decision: ApprovalDecision): boolean {
    const resolved = this.#approvals.resolve(callId, decision);
    if (resolved) {
      void this.#emit({
        type: "approval_resolved",
        callId,
        approved: decision.approved,
      });
    }
    return resolved;
  }

  pendingApprovals(): ApprovalRequest[] {
    return this.#approvals.list();
  }

  changedFiles(): Promise<ChangedFile[]> {
    return this.#changes.changedFiles();
  }

  diff(path: string): Promise<FileDiff | undefined> {
    return this.#changes.diff(path);
  }

  async #beforeToolCall(
    context: BeforeToolCallContext,
    signal: AbortSignal,
  ) {
    const normalizedCall: ToolCall = {
      ...context.toolCall,
      arguments: context.arguments as Record<string, unknown>,
    };
    const effect = await deriveEffect(normalizedCall, this.workspace);
    return this.#approvals.wait(normalizedCall, effect, signal);
  }
}
