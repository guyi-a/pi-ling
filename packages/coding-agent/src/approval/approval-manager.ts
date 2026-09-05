import type { BeforeToolCallResult } from "@pi-ling/agent-core";
import type { ToolCall } from "@pi-ling/ai";

import type { Effect } from "../effects/effects.js";
import { effectDigest } from "../effects/effects.js";

export interface ApprovalRequest {
  runId: string;
  turnId: string;
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
  promise: Promise<BeforeToolCallResult>;
  resolve: (result: BeforeToolCallResult) => void;
  signal?: AbortSignal;
  abort?: () => void;
}

export class ApprovalManager {
  readonly #pending = new Map<string, PendingApproval>();
  readonly #restoredDecisions = new Map<
    string,
    { effectDigest: string; result: BeforeToolCallResult }
  >();
  readonly #onRequest: (
    request: ApprovalRequest,
  ) => void | Promise<void>;

  constructor(
    onRequest: (request: ApprovalRequest) => void | Promise<void>,
  ) {
    this.#onRequest = onRequest;
  }

  wait(
    call: ToolCall,
    effect: Effect,
    signal: AbortSignal,
    identity: { runId: string; turnId: string },
    reason: string | undefined,
  ): Promise<BeforeToolCallResult> {
    const restoredDecision = this.#restoredDecisions.get(call.id);
    if (restoredDecision) {
      this.#restoredDecisions.delete(call.id);
      const digest = effectDigest(effect, call);
      if (restoredDecision.effectDigest === digest) {
        return Promise.resolve(restoredDecision.result);
      }
      return Promise.resolve({
        allow: false,
        reason: "Restored approval no longer matches this tool call",
      });
    }
    const existing = this.#pending.get(call.id);
    if (existing) {
      this.#attachSignal(existing, signal);
      return existing.promise;
    }
    if (!reason) {
      return Promise.resolve({ allow: true });
    }

    const request: ApprovalRequest = {
      runId: identity.runId,
      turnId: identity.turnId,
      callId: call.id,
      tool: call.name,
      arguments: structuredClone(call.arguments),
      effect,
      effectDigest: effectDigest(effect, call),
      reason,
    };
    const pending = this.#createPending(request);
    this.#pending.set(call.id, pending);
    this.#attachSignal(pending, signal);
    void Promise.resolve(this.#onRequest(request)).catch((error: unknown) => {
      this.#settle(call.id, {
        allow: false,
        reason:
          error instanceof Error
            ? `Approval persistence failed: ${error.message}`
            : "Approval persistence failed",
      });
    });
    return pending.promise;
  }

  restore(request: ApprovalRequest): void {
    if (!this.#pending.has(request.callId)) {
      this.#pending.set(request.callId, this.#createPending(request));
    }
  }

  restoreApproved(request: ApprovalRequest): void {
    this.#restoredDecisions.set(request.callId, {
      effectDigest: request.effectDigest,
      result: { allow: true },
    });
  }

  resolve(callId: string, decision: ApprovalDecision): boolean {
    const pending = this.#pending.get(callId);
    if (!pending || pending.request.effectDigest !== decision.effectDigest) {
      return false;
    }
    const result: BeforeToolCallResult = {
      allow: decision.approved,
      ...(decision.approved
        ? {}
        : { reason: decision.reason?.trim() || "Tool call denied by user" }),
    };
    if (!pending.signal) {
      this.#pending.delete(callId);
      this.#restoredDecisions.set(callId, {
        effectDigest: pending.request.effectDigest,
        result,
      });
      pending.resolve(result);
      return true;
    }
    this.#settle(callId, result);
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

  #createPending(request: ApprovalRequest): PendingApproval {
    let resolve!: (result: BeforeToolCallResult) => void;
    const promise = new Promise<BeforeToolCallResult>((done) => {
      resolve = done;
    });
    return { request, promise, resolve };
  }

  #attachSignal(pending: PendingApproval, signal: AbortSignal): void {
    if (pending.signal === signal) {
      return;
    }
    if (pending.signal && pending.abort) {
      pending.signal.removeEventListener("abort", pending.abort);
    }
    const abort = () =>
      this.#settle(pending.request.callId, {
        allow: false,
        reason: "Tool call cancelled",
      });
    pending.signal = signal;
    pending.abort = abort;
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
    }
  }

  #settle(callId: string, result: BeforeToolCallResult): void {
    const pending = this.#pending.get(callId);
    if (!pending) {
      return;
    }
    this.#pending.delete(callId);
    if (pending.signal && pending.abort) {
      pending.signal.removeEventListener("abort", pending.abort);
    }
    pending.resolve(result);
  }
}
