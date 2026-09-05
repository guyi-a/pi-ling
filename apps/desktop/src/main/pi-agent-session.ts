import { randomUUID } from "node:crypto";

import { Agent, type AgentEvent } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import type {
  AgentEventEnvelope,
  AgentStatus,
  AgentUiEvent,
  AgentUsage,
} from "@pi-ling/contracts";

const PROVIDER = "deepseek";
const MODEL = "deepseek-v4-flash";

const models = createModels();
models.setProvider(deepseekProvider());

export class PiAgentSession {
  readonly #agent: Agent;
  readonly #emit: (envelope: AgentEventEnvelope) => void;
  #requestId: string | null = null;

  constructor(emit: (envelope: AgentEventEnvelope) => void) {
    const model = models.getModel(PROVIDER, MODEL);
    if (!model) {
      throw new Error(`Model is unavailable: ${PROVIDER}/${MODEL}`);
    }

    this.#emit = emit;
    this.#agent = new Agent({
      initialState: {
        systemPrompt:
          "You are pi-ling, a concise and helpful coding assistant.",
        model,
        thinkingLevel: "high",
        tools: [],
      },
      sessionId: randomUUID(),
      streamFn: models.streamSimple.bind(models),
    });
    this.#agent.subscribe((event) => this.#handleEvent(event));
  }

  get status(): AgentStatus {
    return {
      provider: PROVIDER,
      model: MODEL,
      configured: Boolean(process.env["DEEPSEEK_API_KEY"]?.trim()),
    };
  }

  startPrompt(requestId: string, prompt: string): void {
    if (this.#requestId || this.#agent.state.isStreaming) {
      throw new Error("Agent is already processing a prompt");
    }

    this.#requestId = requestId;
    void this.#agent.prompt(prompt).finally(() => {
      if (this.#requestId === requestId) {
        this.#requestId = null;
      }
    });
  }

  cancel(requestId: string): boolean {
    if (this.#requestId !== requestId) {
      return false;
    }
    this.#agent.abort();
    return true;
  }

  async reset(): Promise<void> {
    if (this.#agent.state.isStreaming) {
      this.#agent.abort();
      await this.#agent.waitForIdle();
    }
    this.#agent.reset();
    this.#requestId = null;
  }

  dispose(): void {
    this.#agent.abort();
    this.#requestId = null;
  }

  #send(event: AgentUiEvent): void {
    if (this.#requestId) {
      this.#emit({ requestId: this.#requestId, event });
    }
  }

  #handleEvent(event: AgentEvent): void {
    switch (event.type) {
      case "agent_start":
        this.#send({ type: "agent_start" });
        break;
      case "message_start":
        if (event.message.role === "assistant") {
          this.#send({ type: "assistant_start" });
        }
        break;
      case "message_update":
        if (event.assistantMessageEvent.type === "text_delta") {
          this.#send({
            type: "text_delta",
            delta: event.assistantMessageEvent.delta,
          });
        } else if (
          event.assistantMessageEvent.type === "thinking_delta"
        ) {
          this.#send({
            type: "thinking_delta",
            delta: event.assistantMessageEvent.delta,
          });
        }
        break;
      case "message_end":
        if (event.message.role === "assistant") {
          const usage: AgentUsage = {
            input: event.message.usage.input,
            output: event.message.usage.output,
            totalTokens: event.message.usage.totalTokens,
            cost: event.message.usage.cost.total,
          };
          if (event.message.usage.reasoning !== undefined) {
            usage.reasoning = event.message.usage.reasoning;
          }

          const finished: Extract<
            AgentUiEvent,
            { type: "assistant_end" }
          > = {
            type: "assistant_end",
            stopReason: event.message.stopReason,
            usage,
          };
          if (event.message.errorMessage) {
            finished.error = event.message.errorMessage;
          }
          this.#send(finished);
        }
        break;
      case "agent_end":
        this.#send({ type: "agent_end" });
        break;
    }
  }
}
