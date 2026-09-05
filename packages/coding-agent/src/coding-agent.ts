import {
  Agent,
  type AgentEvent,
  type BeforeToolCallContext,
  type StreamFunction,
} from "@pi-ling/agent-core";
import type { Message, Model, ToolCall } from "@pi-ling/ai";

import {
  ApprovalManager,
  type ApprovalDecision,
  type ApprovalRequest,
} from "./approval/approval-manager.js";
import {
  ChangeTracker,
  type ChangedFile,
  type FileBaseline,
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
      runId: string;
      turnId: string;
      callId: string;
      approved: boolean;
    }
  | {
      type: "changes";
      runId: string;
      turnId: string;
      callId: string;
      files: ChangedFile[];
    };

export interface CodingAgentOptions {
  workspaceRoot: string;
  model: Model;
  streamFn: StreamFunction;
  emit(event: CodingAgentEvent): void | Promise<void>;
  messages?: Message[];
  baselines?: FileBaseline[];
  pendingApprovals?: ApprovalRequest[];
  approvedApprovals?: ApprovalRequest[];
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
    if (options.baselines) {
      this.#changes.hydrateBaselines(options.baselines);
    }
    this.#approvals = new ApprovalManager((approval) => {
      return this.#emit({ type: "approval_requested", approval });
    });
    for (const approval of options.pendingApprovals ?? []) {
      this.#approvals.restore(approval);
    }
    for (const approval of options.approvedApprovals ?? []) {
      this.#approvals.restoreApproved(approval);
    }
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
        messages: options.messages ?? [],
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
          runId: event.runId,
          turnId: event.turnId,
          callId: event.toolCall.id,
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

  baselines(): FileBaseline[] {
    return this.#changes.exportBaselines();
  }

  prompt(text: string, runId?: string): Promise<void> {
    return this.#agent.prompt(text, runId ? { runId } : {});
  }

  cancel(): void {
    this.#approvals.cancelAll();
    this.#agent.abort();
  }

  waitForIdle(): Promise<void> {
    return this.#agent.waitForIdle();
  }

  async reset(): Promise<void> {
    this.cancel();
    await this.#agent.waitForIdle();
    this.#agent.reset();
    this.#changes.reset();
  }

  async resolveApproval(
    callId: string,
    decision: ApprovalDecision,
  ): Promise<boolean> {
    const approval = this.#approvals
      .list()
      .find((item) => item.callId === callId);
    if (!approval || approval.effectDigest !== decision.effectDigest) {
      return false;
    }
    await this.#emit({
      type: "approval_resolved",
      runId: approval.runId,
      turnId: approval.turnId,
      callId,
      approved: decision.approved,
    });
    return this.#approvals.resolve(callId, decision);
  }

  pendingApprovals(): ApprovalRequest[] {
    return this.#approvals.list();
  }

  resumePendingTools(options: {
    runId: string;
    turnId: string;
    turn: number;
  }): Promise<void> {
    return this.#agent.resumePendingTools(options);
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
    return this.#approvals.wait(normalizedCall, effect, signal, {
      runId: context.runId,
      turnId: context.turnId,
    });
  }
}
