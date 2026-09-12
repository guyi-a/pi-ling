function collectErrorMessages(error: unknown): string {
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
  return parts.join("\n");
}

export function isDshSessionNotResumableError(error: unknown): boolean {
  return /session is not resumable/i.test(collectErrorMessages(error));
}

/** Import/resume targeted a DSH session id that no longer exists on disk. */
export function isDshStaleSessionImportError(error: unknown): boolean {
  const haystack = collectErrorMessages(error);
  return (
    isDshSessionNotResumableError(error) ||
    /SessionPersistenceNotFoundError/i.test(haystack) ||
    /session "[^"]+" not found/i.test(haystack)
  );
}
