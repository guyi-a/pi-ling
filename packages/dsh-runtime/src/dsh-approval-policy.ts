type PreToolDecision =
  | { kind: "allow" }
  | { kind: "deny"; reason: string }
  | { kind: "ask"; reason?: string };

export interface DshToolExecution {
  name: string;
  arguments: unknown;
}

interface DshToolContext {
  on(
    event: "tools/pre-execute",
    listener: (
      execution: DshToolExecution,
      next: () => Promise<PreToolDecision>,
    ) => Promise<PreToolDecision>,
  ): unknown;
}

const READ_ONLY_TOOLS = new Set(["read", "read_image", "glob", "grep"]);

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function shouldAskBeforeDshTool(
  execution: DshToolExecution,
): boolean {
  if (READ_ONLY_TOOLS.has(execution.name)) return false;
  const arguments_ = record(execution.arguments);
  if (
    typeof arguments_?.["sandbox_permissions"] === "string" &&
    typeof arguments_["justification"] === "string"
  ) {
    return false;
  }
  return true;
}

export const name = "pi-ling-approval-policy";
export const inject = ["tools"];

export function apply(ctx: DshToolContext): void {
  ctx.on("tools/pre-execute", (execution, next) =>
    shouldAskBeforeDshTool(execution)
      ? Promise.resolve({
          kind: "ask",
          reason: `pi-ling approval policy: ${execution.name}`,
        })
      : next(),
  );
}
