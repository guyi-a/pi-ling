import type { AgentRunOptions } from "./types.js";

export function agentTimeoutMs(timeoutMs?: number): number | undefined {
  if (timeoutMs === undefined || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return undefined;
  }
  return timeoutMs;
}

export async function waitUntil(
  predicate: () => boolean,
  options: AgentRunOptions & { timeoutMs?: number; onTimeout?: () => void } = {},
): Promise<void> {
  if (options.abortSignal?.aborted) return;
  await new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = agentTimeoutMs(options.timeoutMs);
    const finish = () => {
      clearInterval(poll);
      if (timer) clearTimeout(timer);
      options.abortSignal?.removeEventListener("abort", onAbort);
      resolve();
    };
    const onAbort = () => finish();
    const poll = setInterval(() => {
      if (predicate() || options.abortSignal?.aborted) {
        finish();
      }
    }, 25);
    if (timeout !== undefined) {
      timer = setTimeout(() => {
        options.onTimeout?.();
        finish();
      }, timeout);
    }
    options.abortSignal?.addEventListener("abort", onAbort, { once: true });
  });
}
