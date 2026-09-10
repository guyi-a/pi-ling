import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

function envInt(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function spillThresholdChars(): number {
  return envInt("TOOL_SPILL_THRESHOLD_CHARS", 12_000);
}

export function spillPreviewChars(): number {
  return envInt("TOOL_SPILL_PREVIEW_CHARS", 2_000);
}

export interface SpillReference {
  path: string;
  lineCount: number;
  byteCount: number;
  preview: string;
}

export async function maybeSpillToolOutput(input: {
  sessionId: string;
  callId: string;
  workspaceRoot: string;
  text: string;
}): Promise<{ text: string; spill?: SpillReference }> {
  const threshold = spillThresholdChars();
  if (input.text.length <= threshold) {
    return { text: input.text };
  }

  const relativePath = join(
    ".pi-ling",
    "spills",
    input.sessionId,
    `${input.callId}.txt`,
  );
  const absolutePath = join(input.workspaceRoot, relativePath);
  await mkdir(join(input.workspaceRoot, ".pi-ling", "spills", input.sessionId), {
    recursive: true,
  });
  await writeFile(absolutePath, input.text, "utf8");

  const previewLimit = spillPreviewChars();
  const preview =
    input.text.length <= previewLimit
      ? input.text
      : `${input.text.slice(0, previewLimit)}\n…[truncated preview]`;
  const lineCount = input.text.split("\n").length;
  const byteCount = Buffer.byteLength(input.text, "utf8");
  const normalizedPath = relativePath.replaceAll("\\", "/");
  const text = [
    preview,
    "",
    `[Output spilled to ${normalizedPath}: ${lineCount} lines, ${byteCount} bytes.]`,
    "Use read_file on that path to inspect the full output.",
  ].join("\n");

  return {
    text,
    spill: {
      path: normalizedPath,
      lineCount,
      byteCount,
      preview,
    },
  };
}

export async function clearSessionSpills(
  workspaceRoot: string,
  sessionId: string,
): Promise<void> {
  const { rm } = await import("node:fs/promises");
  await rm(join(workspaceRoot, ".pi-ling", "spills", sessionId), {
    recursive: true,
    force: true,
  });
}
