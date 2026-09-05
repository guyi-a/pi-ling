import type { BeforeToolCallResult } from "@pi-ling/agent-core";
import type { ToolCall } from "@pi-ling/ai";

import type { Effect } from "../effects/effects.js";
import { approvalReason, effectDigest } from "../effects/effects.js";

export interface ApprovalRequest {
  callId: string;
  tool: string;
  arguments: Record<string, unknown>;
  effect: Effect;
  effectDigest: string;
  reason: string;
}

export interface ApprovalDecision {
  approved: boolean;
  effectDigest: string;
  reason?: string;
}

interface PendingApproval {
  request: ApprovalRequest;
  resolve: (result: BeforeToolCallResult) => void;
  signal: AbortSignal;
  abort: () => void;
}

export class ApprovalManager {
  readonly #pending = new Map<string, PendingApproval>();
  readonly #onRequest: (request: ApprovalRequest) => void;

  constructor(onRequest: (request: ApprovalRequest) => void) {
    this.#onRequest = onRequest;
  }

  wait(
    call: ToolCall,
    effect: Effect,
    signal: AbortSignal,
  ): Promise<BeforeToolCallResult> {
    const reason = approvalReason(effect);
    if (!reason) {
      return Promise.resolve({ allow: true });
    }
    if (this.#pending.has(call.id)) {
      throw new Error(`Approval already pending for ${call.id}`);
    }

    const request: ApprovalRequest = {
      callId: call.id,
      tool: call.name,
      arguments: structuredClone(call.arguments),
      effect,
      effectDigest: effectDigest(effect, call),
      reason,
    };

    return new Promise((resolve) => {
      const abort = () => {
        this.#settle(call.id, {
          allow: false,
          reason: "Tool call cancelled",
        });
      };
      this.#pending.set(call.id, {
        request,
        resolve,
        signal,
        abort,
      });
      signal.addEventListener("abort", abort, { once: true });
      this.#onRequest(request);
      if (signal.aborted) {
        abort();
      }
    });
  }

  resolve(callId: string, decision: ApprovalDecision): boolean {
    const pending = this.#pending.get(callId);
    if (!pending || pending.request.effectDigest !== decision.effectDigest) {
      return false;
    }
    this.#settle(callId, {
      allow: decision.approved,
      ...(decision.approved
        ? {}
        : { reason: decision.reason?.trim() || "Tool call denied by user" }),
    });
    return true;
  }

  list(): ApprovalRequest[] {
    return [...this.#pending.values()].map(({ request }) =>
      structuredClone(request),
    );
  }

  cancelAll(reason = "Agent cancelled"): void {
    for (const callId of [...this.#pending.keys()]) {
      this.#settle(callId, { allow: false, reason });
    }
  }

  #settle(callId: string, result: BeforeToolCallResult): void {
    const pending = this.#pending.get(callId);
    if (!pending) {
      return;
    }
    this.#pending.delete(callId);
    pending.signal.removeEventListener("abort", pending.abort);
    pending.resolve(result);
  }
}
