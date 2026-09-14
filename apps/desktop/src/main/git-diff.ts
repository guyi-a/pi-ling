import { execFile } from "node:child_process";
import path from "node:path";

import type { ChangedFile, FileDiff } from "@pi-ling/contracts";

const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_DIFF_FILE_BYTES = 2 * 1024 * 1024;
const GIT_TIMEOUT_MS = 30_000;

// 面板反复开关时避免重跑 git 进程。以 mtime+size 为签名，只算真正变化的文件。
const DIFF_CACHE = new Map<
  string,
  { signature: string; diff: FileDiff | undefined }
>();
const DIFF_CACHE_MAX = 500;

async function fileSignature(root: string, filePath: string): Promise<string> {
  const { stat } = await import("node:fs/promises");
  try {
    const stats = await stat(path.join(root, filePath));
    if (!stats.isFile()) return "missing";
    return `${stats.mtimeMs}:${stats.size}`;
  } catch {
    return "missing";
  }
}

function cacheDiff(
  key: string,
  signature: string,
  diff: FileDiff | undefined,
): void {
  if (DIFF_CACHE.size >= DIFF_CACHE_MAX) {
    const oldest = DIFF_CACHE.keys().next();
    if (!oldest.done) DIFF_CACHE.delete(oldest.value);
  }
  DIFF_CACHE.set(key, { signature, diff });
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

async function fileIsoMeta(
  root: string,
  filePath: string,
): Promise<{ binary: boolean; tooLarge: boolean }> {
  const absolute = path.join(root, filePath);
  const { readFile, stat } = await import("node:fs/promises");
  try {
    const stats = await stat(absolute);
    if (!stats.isFile()) return { binary: false, tooLarge: true };
    const tooLarge = stats.size > MAX_DIFF_FILE_BYTES;
    if (tooLarge) return { binary: false, tooLarge: true };
    const content = await readFile(absolute);
    const binary = content.subarray(0, 8192).includes(0);
    return { binary, tooLarge: false };
  } catch {
    return { binary: false, tooLarge: false };
  }
}

function runGit(
  root: string,
  args: string[],
  signal?: AbortSignal,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = execFile(
      "git",
      args,
      { cwd: root, maxBuffer: 10 * 1024 * 1024, timeout: GIT_TIMEOUT_MS },
      (error, stdout, stderr) => {
        const code =
          error && typeof error.code === "number"
            ? error.code
            : error
              ? 1
              : 0;
        resolve({ code, stdout, stderr });
      },
    );
    if (signal) signal.addEventListener("abort", () => child.kill());
  });
}

/** 变更作用域：staged=暂存区(index)、unstaged=工作区、uncommitted=两者之和 */
export type GitChangeScope = "staged" | "unstaged" | "uncommitted";

/**
 * 读取某个 revision（或 index）里文件的内容，用于 diff 的 before 侧。
 *
 * `ref` 取 `"HEAD"` 时是提交内容；取 `":path"` 形式可用 index 内容。
 * 文件在该 revision 不存在（新增文件）返回 `undefined`。
 */
export async function gitShowFile(
  root: string,
  ref: string,
  filePath: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const result = await runGit(
    root,
    ["show", `${ref}:${filePath}`],
    signal,
  );
  if (result.code !== 0) return undefined;
  return result.stdout;
}

/** 读取 index 里文件的内容（`git show :path`），用于 staged 的 after 侧。 */
export async function gitShowIndexFile(
  root: string,
  filePath: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const result = await runGit(root, ["show", `:${filePath}`], signal);
  if (result.code !== 0) return undefined;
  return result.stdout;
}

interface GitStatusEntry {
  path: string;
  status: ChangedFile["status"];
  staged: boolean;
}

/** 解析 `git status --porcelain=v1` 的一行 "XY path"。 */
function parsePorcelain(
  x: string,
  y: string,
  filePath: string,
): GitStatusEntry | undefined {
  if (!filePath) return undefined;
  if (x === "?" && y === "?") {
    return { path: filePath, status: "added", staged: false };
  }
  const isStaged = x !== " " && x !== "?";
  const kind: ChangedFile["status"] =
    x === "D" || y === "D"
      ? "deleted"
      : x === "A" || y === "A"
        ? "added"
        : "modified";
  return { path: filePath, status: kind, staged: isStaged };
}

/** 生成一个作用域下的 ChangedFile[]。staged 只看 index 列，unstaged 只看工作区列 */
export async function gitScopedFiles(
  root: string,
  scope: GitChangeScope,
): Promise<ChangedFile[]> {
  const result = await runGit(
    root,
    ["status", "--porcelain=v1", "--untracked-files=all", "--null"],
  );
  if (result.code !== 0) return [];

  const entries: Array<{
    path: string;
    status: ChangedFile["status"];
    staged: boolean;
    isUntracked: boolean;
  }> = [];
  for (const chunk of result.stdout.split("\0")) {
    if (chunk.length < 3) continue;
    const x = chunk[0]!;
    const y = chunk[1]!;
    const filePath = chunk.slice(3);
    const entry = parsePorcelain(x, y, filePath);
    if (!entry) continue;
    const indexChanged = entry.staged;
    const worktreeChanged = y !== " " && y !== "?" || (x === "?" && y === "?");
    if (scope === "staged" && !indexChanged) continue;
    if (scope === "unstaged" && !worktreeChanged) continue;
    entries.push({
      path: entry.path,
      status: entry.status,
      staged: entry.staged,
      isUntracked: x === "?" && y === "?",
    });
  }

  const metas = await Promise.all(
    entries.map((entry) =>
      entry.isUntracked
        ? fileIsoMeta(root, entry.path)
        : Promise.resolve({ binary: false, tooLarge: false }),
    ),
  );

  return entries.map((entry, index) => {
    const meta = metas[index]!;
    return {
      path: entry.path,
      status: entry.status,
      binary: meta.binary,
      sensitive: isSensitive(entry.path),
      tooLarge: meta.tooLarge,
      staged: entry.staged,
    };
  });
}

/** 生成一个文件的 diff。staged 用 index 作基准、unstaged 用工作区作基准、uncommitted 用 HEAD。 */
export async function gitDiff(
  root: string,
  filePath: string,
  signal?: AbortSignal,
  scope: GitChangeScope = "uncommitted",
): Promise<FileDiff | undefined> {
  const signature = await fileSignature(root, filePath);
  const cacheKey = `${root}\0${scope}\0${filePath}`;
  const cached = DIFF_CACHE.get(cacheKey);
  if (cached && cached.signature === signature) return cached.diff;

  const status = await runGit(root, ["status", "--porcelain=v1", "--", filePath]);
  const tracked = status.stdout.trim();
  const isUntracked = /^\?\?/.test(tracked);

  let patch: string | undefined;
  let truncated = false;

  if (isUntracked) {
    const { binary, tooLarge } = await fileIsoMeta(root, filePath);
    if (binary || tooLarge) patch = undefined;
    // 未跟踪：文件只在工作区，git 里无基准，手动生成整体 +patch。
    const absolute = path.join(root, filePath);
    const { readFile } = await import("node:fs/promises");
    try {
      const content = (await readFile(absolute, "utf8")).replace(/\r\n/g, "\n");
      // git 的行计数规则：末尾带换行时不算额外空行。a\nb\n = 2 行（split 出 3，末位是 ""）。
      const split = content.split("\n");
      const lineCount = split[split.length - 1] === "" ? split.length - 1 : split.length;
      const body = split.slice(0, lineCount).map((line) => `+${line}`).join("\n");
      patch = `--- /dev/null\n+++ b/${filePath}\n@@ -0,0 +1,${lineCount} @@\n${body}${content.endsWith("\n") ? "\n" : ""}`;
    } catch {
      patch = undefined;
    }
  } else {
    const base =
      scope === "staged"
        ? ["--cached"]
        : scope === "unstaged"
          ? []
          : ["HEAD"];
    const diff = await runGit(root, [
      "diff",
      ...base,
      "--",
      filePath,
      "--no-ext-diff",
    ]);
    if (diff.code !== 0) {
      patch = undefined;
    } else if (/^Binary files .* differ/m.test(diff.stdout.trim())) {
      patch = undefined;
    } else if (diff.stdout) {
      patch = diff.stdout;
    }
  }

  if (patch === undefined) {
    cacheDiff(cacheKey, signature, undefined);
    return undefined;
  }

  const bytes = Buffer.byteLength(patch, "utf8");
  if (bytes > MAX_OUTPUT_BYTES) {
    truncated = true;
    patch = patch.slice(0, MAX_OUTPUT_BYTES);
  }
  const diff: FileDiff = { path: filePath, patch, truncated };
  cacheDiff(cacheKey, signature, diff);
  return diff;
}
