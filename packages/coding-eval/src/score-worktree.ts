import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { minimatch } from "minimatch";

import { RESPONSE_FILE_NAME, type Score, type ScoringPolicy } from "./types.js";

function gitOutput(worktree: string, args: string[]): string {
  return execFileSync("git", ["-C", worktree, ...args], {
    encoding: "utf8",
  });
}

function lineCount(data: Buffer | string): number {
  const text = typeof data === "string" ? data : data.toString("utf8");
  if (text.length === 0) return 0;
  let count = 0;
  for (const ch of text) {
    if (ch === "\n") count += 1;
  }
  if (!text.endsWith("\n")) count += 1;
  return count;
}

export function changedPaths(worktree: string): string[] {
  const output = gitOutput(worktree, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  const paths: string[] = [];
  const records = output.split("\0");
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index] ?? "";
    if (record.length < 4) continue;
    let name = record.slice(3).replace(/\\/g, "/");
    if (record[0] === "R" || record[1] === "R") {
      index += 1;
      const renamed = records[index];
      if (renamed) name = renamed.replace(/\\/g, "/");
    }
    if (name === RESPONSE_FILE_NAME) continue;
    paths.push(name);
  }
  return [...paths].sort();
}

export function scoreWorktree(
  worktree: string,
  policy: ScoringPolicy,
): Score {
  const paths = changedPaths(worktree);
  const diff = {
    changed_files: paths.length,
    added_lines: 0,
    deleted_lines: 0,
    paths,
  };
  const seen = new Set<string>();
  const tracked = gitOutput(worktree, ["diff", "--numstat", "HEAD", "--"]);
  for (const line of tracked.trim().split("\n")) {
    if (!line.trim()) continue;
    const fields = line.split(/\s+/);
    if (fields.length < 3) continue;
    diff.added_lines += Number.parseInt(fields[0] ?? "0", 10) || 0;
    diff.deleted_lines += Number.parseInt(fields[1] ?? "0", 10) || 0;
    seen.add(fields[2]!.replace(/\\/g, "/"));
  }
  for (const name of paths) {
    if (seen.has(name)) continue;
    try {
      diff.added_lines += lineCount(
        readFileSync(join(worktree, ...name.split("/"))),
      );
    } catch {
      // ignore unreadable paths
    }
  }

  const violations: string[] = [];
  for (const name of paths) {
    for (const pattern of policy.forbidden_paths) {
      if (minimatch(name, pattern, { dot: true, nocase: false })) {
        violations.push(`forbidden path changed: ${name}`);
      }
    }
  }
  if (diff.changed_files > policy.max_changed_files) {
    violations.push(
      `changed files ${diff.changed_files} exceeds ${policy.max_changed_files}`,
    );
  }
  if (diff.added_lines > policy.max_added_lines) {
    violations.push(
      `added lines ${diff.added_lines} exceeds ${policy.max_added_lines}`,
    );
  }
  if (diff.deleted_lines > policy.max_deleted_lines) {
    violations.push(
      `deleted lines ${diff.deleted_lines} exceeds ${policy.max_deleted_lines}`,
    );
  }

  return {
    passed: violations.length === 0,
    violations,
    diff,
  };
}
