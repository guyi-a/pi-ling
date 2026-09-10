import type { EvalRunResultView } from "@pi-ling/contracts";

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function statusLabel(
  status: EvalRunResultView["status"] | "missing",
): string {
  switch (status) {
    case "passed":
      return "通过";
    case "failed":
      return "失败";
    case "skipped":
      return "跳过";
    case "error":
      return "错误";
    default:
      return "缺失";
  }
}

export function statusClass(
  status: EvalRunResultView["status"] | "missing",
): string {
  switch (status) {
    case "passed":
      return "is-passed";
    case "failed":
      return "is-failed";
    case "skipped":
      return "is-skipped";
    case "error":
      return "is-error";
    default:
      return "is-missing";
  }
}

export function formatPassRate(rate: number): string {
  return `${Math.round(rate * 1000) / 10}%`;
}

export function runLabel(input: {
  variant: string;
  driver: string;
  runtime?: string;
  passed: number;
  total: number;
}): string {
  const runtime = input.runtime ? ` · ${input.runtime}` : "";
  return `${input.variant} (${input.driver}${runtime}) · ${input.passed}/${input.total}`;
}
