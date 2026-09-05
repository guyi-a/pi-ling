import { randomUUID } from "node:crypto";
import path from "node:path";

import {
  CodingAgent,
  type ApprovalDecision,
  type CodingAgentEvent,
} from "@pi-ling/coding-agent";
import { createModels } from "@pi-ling/ai";
import { deepseekProvider } from "@pi-ling/ai/providers/deepseek";
import type {
  AgentStatus,
  AgentUsage,
  ChangedFile,
  FileDiff,
  TimelineEnvelope,
  TimelineEvent,
  TimelineSnapshot,
  WorkspaceInfo,
} from "@pi-ling/contracts";

const PROVIDER = "deepseek";
const MODEL = "deepseek-v4-flash";
const models = createModels([deepseekProvider()]);

export class PiAgentSession {
  readonly #emit: (envelope: TimelineEnvelope) => void;
  #agent: CodingAgent | undefined;
  #workspace: WorkspaceInfo | undefined;
  #sessionId = randomUUID();
  #seq = 0;
  #events: TimelineEnvelope[] = [];
  #activeRunId: string | null = null;
  #runOutcome: "completed" | "cancelled" | "error" = "completed";
  #generation = 0;

  constructor(emit: (envelope: TimelineEnvelope) => void) {
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

  snapshot(): TimelineSnapshot {
    return {
      sessionId: this.#sessionId,
      lastSeq: this.#seq,
      events: structuredClone(this.#events),
    };
  }

  async setWorkspace(root: string): Promise<WorkspaceInfo> {
    this.dispose();
    this.#resetTimeline();
    const model = models.getModel(PROVIDER, MODEL);
    if (!model) {
      throw new Error(`Model is unavailable: ${PROVIDER}/${MODEL}`);
    }
    this.#workspace = { root, name: path.basename(root) };
    const generation = ++this.#generation;
    this.#agent = await CodingAgent.create({
      workspaceRoot: root,
      model,
      streamFn: models.stream.bind(models),
      emit: (event) => {
        if (generation === this.#generation) {
          this.#handleCodingEvent(event);
        }
      },
    });
    return this.#workspace;
  }

  startPrompt(runId: string, prompt: string): void {
    if (!this.#agent) {
      throw new Error("Select a workspace before sending a prompt");
    }
    if (this.#activeRunId || this.#agent.isStreaming) {
      throw new Error("Agent is already processing a prompt");
    }

    this.#activeRunId = runId;
    this.#runOutcome = "completed";
    this.#publish(runId, {
      type: "run_start",
      userItemId: `${runId}:user`,
      prompt,
    });
    void this.#agent
      .prompt(prompt, runId)
      .catch((error: unknown) => {
        this.#runOutcome = "error";
        this.#publish(runId, {
          type: "run_end",
          status: "error",
        });
        console.error("Coding agent run failed", error);
      })
      .finally(() => {
        if (this.#activeRunId === runId) {
          this.#activeRunId = null;
        }
      });
  }

  cancel(runId: string): boolean {
    if (this.#activeRunId !== runId || !this.#agent) {
      return false;
    }
    this.#runOutcome = "cancelled";
    this.#agent.cancel();
    return true;
  }

  async reset(): Promise<void> {
    if (this.#agent) {
      await this.#agent.reset();
    }
    this.#activeRunId = null;
    this.#resetTimeline();
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
    this.#generation += 1;
    this.#agent?.cancel();
    this.#agent = undefined;
    this.#activeRunId = null;
  }

  #publish(runId: string, event: TimelineEvent): void {
    const envelope: TimelineEnvelope = {
      sessionId: this.#sessionId,
      runId,
      seq: ++this.#seq,
      emittedAt: Date.now(),
      event,
    };
    this.#events.push(envelope);
    this.#emit(envelope);
  }

  #resetTimeline(): void {
    this.#sessionId = randomUUID();
    this.#seq = 0;
    this.#events = [];
  }

  #handleCodingEvent(event: CodingAgentEvent): void {
    if (event.type === "approval_requested") {
      const approval = event.approval;
      this.#publish(approval.runId, {
        type: "approval_requested",
        turnId: approval.turnId,
        itemId: `${approval.callId}:approval`,
        toolItemId: approval.callId,
        approval: {
          callId: approval.callId,
          tool: approval.tool,
          arguments: approval.arguments,
          effect: { ...approval.effect },
          effectDigest: approval.effectDigest,
          reason: approval.reason,
        },
      });
      return;
    }
    if (event.type === "approval_resolved") {
      this.#publish(event.runId, {
        type: "approval_resolved",
        turnId: event.turnId,
        itemId: `${event.callId}:approval`,
        toolItemId: event.callId,
        callId: event.callId,
        approved: event.approved,
      });
      return;
    }
    if (event.type === "changes") {
      this.#publish(event.runId, {
        type: "changes",
        turnId: event.turnId,
        itemId: `${event.callId}:changes`,
        callId: event.callId,
        files: event.files,
      });
      return;
    }

    const agentEvent = event.event;
    const runId = agentEvent.runId;
    switch (agentEvent.type) {
      case "agent_start":
        break;
      case "turn_start":
        this.#publish(runId, {
          type: "turn_start",
          turnId: agentEvent.turnId,
          turn: agentEvent.turn,
        });
        break;
      case "turn_end":
        this.#publish(runId, {
          type: "turn_end",
          turnId: agentEvent.turnId,
        });
        break;
      case "message_start":
        if (
          agentEvent.message.role === "assistant" &&
          agentEvent.turnId
        ) {
          this.#publish(runId, {
            type: "assistant_start",
            turnId: agentEvent.turnId,
            itemId: `${agentEvent.turnId}:assistant`,
          });
        }
        break;
      case "message_update":
        if (agentEvent.assistantMessageEvent.type === "text_delta") {
          this.#publish(runId, {
            type: "assistant_text_delta",
            turnId: agentEvent.turnId,
            itemId: `${agentEvent.turnId}:assistant`,
            delta: agentEvent.assistantMessageEvent.delta,
          });
        } else if (
          agentEvent.assistantMessageEvent.type === "thinking_delta"
        ) {
          this.#publish(runId, {
            type: "assistant_thinking_delta",
            turnId: agentEvent.turnId,
            itemId: `${agentEvent.turnId}:assistant`,
            delta: agentEvent.assistantMessageEvent.delta,
          });
        }
        break;
      case "message_end":
        if (
          agentEvent.message.role === "assistant" &&
          agentEvent.turnId
        ) {
          const usage: AgentUsage = {
            input: agentEvent.message.usage.input,
            output: agentEvent.message.usage.output,
            totalTokens: agentEvent.message.usage.totalTokens,
            cost: agentEvent.message.usage.cost.total,
          };
          if (agentEvent.message.usage.reasoning !== undefined) {
            usage.reasoning = agentEvent.message.usage.reasoning;
          }
          this.#publish(runId, {
            type: "assistant_end",
            turnId: agentEvent.turnId,
            itemId: `${agentEvent.turnId}:assistant`,
            stopReason: agentEvent.message.stopReason,
            usage,
            ...(agentEvent.message.errorMessage
              ? { error: agentEvent.message.errorMessage }
              : {}),
          });
          for (const block of agentEvent.message.content) {
            if (block.type === "toolCall") {
              this.#publish(runId, {
                type: "tool_requested",
                turnId: agentEvent.turnId,
                itemId: block.id,
                callId: block.id,
                tool: block.name,
                arguments: block.arguments,
              });
            }
          }
          if (agentEvent.message.stopReason === "error") {
            this.#runOutcome = "error";
          } else if (agentEvent.message.stopReason === "aborted") {
            this.#runOutcome = "cancelled";
          }
        }
        break;
      case "tool_execution_start":
        this.#publish(runId, {
          type: "tool_start",
          turnId: agentEvent.turnId,
          itemId: agentEvent.toolCall.id,
          callId: agentEvent.toolCall.id,
          tool: agentEvent.toolCall.name,
          arguments: agentEvent.toolCall.arguments,
        });
        break;
      case "tool_execution_end":
        this.#publish(runId, {
          type: "tool_end",
          turnId: agentEvent.turnId,
          itemId: agentEvent.toolCall.id,
          callId: agentEvent.toolCall.id,
          tool: agentEvent.toolCall.name,
          isError: agentEvent.result.isError,
          output: agentEvent.result.content
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("\n"),
        });
        break;
      case "agent_end":
        this.#publish(runId, {
          type: "run_end",
          status: this.#runOutcome,
        });
        break;
    }
  }
}
