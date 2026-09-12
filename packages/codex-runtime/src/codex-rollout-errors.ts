export function isMissingCodexRolloutError(error: unknown): boolean {
  const parts: string[] = [];
  let current: unknown = error;
  while (current) {
    if (current instanceof Error) {
      parts.push(current.message);
      current = current.cause;
    } else if (typeof current === "string") {
      parts.push(current);
      break;
    } else {
      break;
    }
  }
  return /no rollout found for thread id/i.test(parts.join("\n"));
}
