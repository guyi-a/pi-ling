import path from "node:path";

import {
  CodingAgent,
  type ApprovalDecision,
  type CodingAgentEvent,
} from "@pi-ling/coding-agent";
import { createModels } from "@pi-ling/ai";
import { deepseekProvider } from "@pi-ling/ai/providers/deepseek";
import type {
  AgentEventEnvelope,
  AgentStatus,
  AgentUiEvent,
  AgentUsage,
  ChangedFile,
  FileDiff,
  WorkspaceInfo,
} from "@pi-ling/contracts";

const PROVIDER = "deepseek";
const MODEL = "deepseek-v4-flash";
const models = createModels([deepseekProvider()]);

export class PiAgentSession {
  readonly #emit: (envelope: AgentEventEnvelope) => void;
  #agent: CodingAgent | undefined;
  #workspace: WorkspaceInfo | undefined;
  #requestId: string | null = null;

  constructor(emit: (envelope: AgentEventEnvelope) => void) {
    this.#emit = emit;
  }

  get status(): AgentStatus {
    return {
      provider: PROVIDER,
      model: MODEL,
      configured: Boolean(process.env["DEEPSEEK_API_KEY"]?.trim()),
      ...(this.#workspace ? { workspace: this.#workspace } : {}),
    };
  }

  async setWorkspace(root: string): Promise<WorkspaceInfo> {
    this.dispose();
    const model = models.getModel(PROVIDER, MODEL);
    if (!model) {
      throw new Error(`Model is unavailable: ${PROVIDER}/${MODEL}`);
    }
    this.#workspace = { root, name: path.basename(root) };
    this.#agent = await CodingAgent.create({
      workspaceRoot: root,
      model,
      streamFn: models.stream.bind(models),
      emit: (event) => this.#handleCodingEvent(event),
    });
    return this.#workspace;
  }

  startPrompt(requestId: string, prompt: string): void {
    if (!this.#agent) {
      throw new Error("Select a workspace before sending a prompt");
    }
    if (this.#requestId || this.#agent.isStreaming) {
      throw new Error("Agent is already processing a prompt");
    }

    this.#requestId = requestId;
    void this.#agent
      .prompt(prompt)
      .catch((error: unknown) => {
        this.#send({
          type: "assistant_end",
          stopReason: "error",
          usage: {
            input: 0,
            output: 0,
            totalTokens: 0,
            cost: 0,
          },
          error: error instanceof Error ? error.message : String(error),
        });
        this.#send({ type: "agent_end" });
      })
      .finally(() => {
        if (this.#requestId === requestId) {
          this.#requestId = null;
        }
      });
  }

  cancel(requestId: string): boolean {
    if (this.#requestId !== requestId || !this.#agent) {
      return false;
    }
    this.#agent.cancel();
    return true;
  }

  async reset(): Promise<void> {
    if (this.#agent) {
      await this.#agent.reset();
    }
    this.#requestId = null;
  }

  resolveApproval(
    callId: string,
    decision: ApprovalDecision,
  ): boolean {
    return this.#agent?.resolveApproval(callId, decision) ?? false;
  }

  changedFiles(): Promise<ChangedFile[]> {
    return this.#agent?.changedFiles() ?? Promise.resolve([]);
  }

  diff(userPath: string): Promise<FileDiff | undefined> {
    return this.#agent?.diff(userPath) ?? Promise.resolve(undefined);
  }

  dispose(): void {
    this.#agent?.cancel();
    this.#agent = undefined;
    this.#requestId = null;
  }

  #send(event: AgentUiEvent): void {
    if (this.#requestId) {
      this.#emit({ requestId: this.#requestId, event });
    }
  }

  #handleCodingEvent(event: CodingAgentEvent): void {
    if (event.type === "approval_requested") {
      this.#send({
        type: "approval_requested",
        approval: event.approval,
      });
      return;
    }
    if (event.type === "approval_resolved") {
      this.#send({
        type: "approval_resolved",
        callId: event.callId,
        approved: event.approved,
      });
      return;
    }
    if (event.type === "changes") {
      this.#send({ type: "changes", files: event.files });
      return;
    }

    const agentEvent = event.event;
    switch (agentEvent.type) {
      case "agent_start":
        this.#send({ type: "agent_start" });
        break;
      case "message_start":
        if (agentEvent.message.role === "assistant") {
          this.#send({ type: "assistant_start" });
        }
        break;
      case "message_update":
        if (agentEvent.assistantMessageEvent.type === "text_delta") {
          this.#send({
            type: "text_delta",
            delta: agentEvent.assistantMessageEvent.delta,
          });
        } else if (
          agentEvent.assistantMessageEvent.type === "thinking_delta"
        ) {
          this.#send({
            type: "thinking_delta",
            delta: agentEvent.assistantMessageEvent.delta,
          });
        }
        break;
      case "tool_execution_start":
        this.#send({
          type: "tool_start",
          callId: agentEvent.toolCall.id,
          tool: agentEvent.toolCall.name,
          arguments: agentEvent.toolCall.arguments,
        });
        break;
      case "tool_execution_end":
        this.#send({
          type: "tool_end",
          callId: agentEvent.toolCall.id,
          tool: agentEvent.toolCall.name,
          isError: agentEvent.result.isError,
          output: agentEvent.result.content
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("\n"),
        });
        break;
      case "message_end":
        if (agentEvent.message.role === "assistant") {
          const usage: AgentUsage = {
            input: agentEvent.message.usage.input,
            output: agentEvent.message.usage.output,
            totalTokens: agentEvent.message.usage.totalTokens,
            cost: agentEvent.message.usage.cost.total,
          };
          if (agentEvent.message.usage.reasoning !== undefined) {
            usage.reasoning = agentEvent.message.usage.reasoning;
          }
          this.#send({
            type: "assistant_end",
            stopReason: agentEvent.message.stopReason,
            usage,
            ...(agentEvent.message.errorMessage
              ? { error: agentEvent.message.errorMessage }
              : {}),
          });
        }
        break;
      case "agent_end":
        this.#send({ type: "agent_end" });
        break;
    }
  }
}
