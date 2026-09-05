import { promises as fs } from "node:fs";
import path from "node:path";

import { createTwoFilesPatch } from "diff";

import type { Workspace } from "../workspace/workspace.js";

const MAX_DIFF_FILE_BYTES = 2 * 1024 * 1024;
const MAX_DIFF_OUTPUT_BYTES = 1024 * 1024;

interface FileSnapshot {
  existed: boolean;
  content?: Buffer;
  size: number;
  modifiedAt: number;
  binary: boolean;
  sensitive: boolean;
  tooLarge: boolean;
}

export interface ChangedFile {
  path: string;
  status: "added" | "modified" | "deleted";
  binary: boolean;
  sensitive: boolean;
  tooLarge: boolean;
}

export interface FileDiff {
  path: string;
  patch: string;
  truncated: boolean;
}

function isSensitive(filePath: string): boolean {
  const name = path.basename(filePath).toLowerCase();
  return (
    name === ".env" ||
    name.startsWith(".env.") ||
    name.endsWith(".pem") ||
    name.endsWith(".key") ||
    name.includes("credential") ||
    name.includes("secret")
  );
}

async function snapshot(absolute: string): Promise<FileSnapshot> {
  const sensitive = isSensitive(absolute);
  try {
    const stats = await fs.stat(absolute);
    if (!stats.isFile()) {
      return {
        existed: true,
        size: stats.size,
        modifiedAt: stats.mtimeMs,
        binary: true,
        sensitive,
        tooLarge: true,
      };
    }
    const tooLarge = stats.size > MAX_DIFF_FILE_BYTES;
    if (sensitive || tooLarge) {
      return {
        existed: true,
        size: stats.size,
        modifiedAt: stats.mtimeMs,
        binary: false,
        sensitive,
        tooLarge,
      };
    }
    const content = await fs.readFile(absolute);
    const binary = content.subarray(0, 8192).includes(0);
    return {
      existed: true,
      ...(!binary ? { content } : {}),
      size: stats.size,
      modifiedAt: stats.mtimeMs,
      binary,
      sensitive,
      tooLarge: false,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        existed: false,
        size: 0,
        modifiedAt: 0,
        binary: false,
        sensitive,
        tooLarge: false,
      };
    }
    throw error;
  }
}

function changed(before: FileSnapshot, after: FileSnapshot): boolean {
  if (before.existed !== after.existed) {
    return true;
  }
  if (!before.existed) {
    return false;
  }
  if (before.content && after.content) {
    return !before.content.equals(after.content);
  }
  return (
    before.size !== after.size || before.modifiedAt !== after.modifiedAt
  );
}

export class ChangeTracker {
  readonly #workspace: Workspace;
  readonly #baselines = new Map<string, FileSnapshot>();

  constructor(workspace: Workspace) {
    this.#workspace = workspace;
  }

  async capture(userPath: string): Promise<void> {
    const absolute = await this.#workspace.resolve(userPath);
    const relative = this.#workspace.relative(absolute);
    if (!this.#baselines.has(relative)) {
      this.#baselines.set(relative, await snapshot(absolute));
    }
  }

  async changedFiles(): Promise<ChangedFile[]> {
    const output: ChangedFile[] = [];
    for (const [relative, before] of this.#baselines) {
      const absolute = await this.#workspace.resolve(relative);
      const after = await snapshot(absolute);
      if (!changed(before, after)) {
        continue;
      }
      output.push({
        path: relative,
        status: !before.existed
          ? "added"
          : !after.existed
            ? "deleted"
            : "modified",
        binary: before.binary || after.binary,
        sensitive: before.sensitive || after.sensitive,
        tooLarge: before.tooLarge || after.tooLarge,
      });
    }
    return output.sort((left, right) => left.path.localeCompare(right.path));
  }

  async diff(userPath: string): Promise<FileDiff | undefined> {
    const absolute = await this.#workspace.resolve(userPath);
    const relative = this.#workspace.relative(absolute);
    const before = this.#baselines.get(relative);
    if (!before) {
      return undefined;
    }
    const after = await snapshot(absolute);
    if (
      !changed(before, after) ||
      before.binary ||
      after.binary ||
      before.sensitive ||
      after.sensitive ||
      before.tooLarge ||
      after.tooLarge
    ) {
      return undefined;
    }
    const patch = createTwoFilesPatch(
      `a/${relative}`,
      `b/${relative}`,
      before.content?.toString("utf8") ?? "",
      after.content?.toString("utf8") ?? "",
      "",
      "",
      { context: 3 },
    );
    const bytes = Buffer.from(patch);
    const truncated = bytes.length > MAX_DIFF_OUTPUT_BYTES;
    return {
      path: relative,
      patch: truncated
        ? bytes.subarray(0, MAX_DIFF_OUTPUT_BYTES).toString("utf8")
        : patch,
      truncated,
    };
  }

  reset(): void {
    this.#baselines.clear();
  }
}
