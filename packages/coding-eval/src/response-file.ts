import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { RESPONSE_FILE_NAME } from "./types.js";

export function responseFilePath(worktree: string): string {
  return join(worktree, RESPONSE_FILE_NAME);
}

export function readResponseFile(worktree: string): string | undefined {
  try {
    const value = readFileSync(responseFilePath(worktree), "utf8");
    return value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

export function writeResponseFile(worktree: string, content: string): void {
  if (!content.trim()) return;
  writeFileSync(responseFilePath(worktree), content, "utf8");
}
