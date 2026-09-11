import type { WorkspaceTreeNode } from "@pi-ling/contracts";

export type WorkspaceTreeSnapshot = {
  entries: WorkspaceTreeNode[];
  rootName: string;
  truncated: boolean;
};

const cache = new Map<string, WorkspaceTreeSnapshot>();

export function readWorkspaceTreeCache(
  root: string,
  filesVersion: number,
): WorkspaceTreeSnapshot | undefined {
  return cache.get(`${root}\0${filesVersion}`);
}

/** Prefer the current version, but keep the latest cached tree while refreshing. */
export function readWorkspaceTreeCacheLatest(
  root: string,
  filesVersion: number,
): WorkspaceTreeSnapshot | undefined {
  for (let version = filesVersion; version >= 0; version -= 1) {
    const snapshot = readWorkspaceTreeCache(root, version);
    if (snapshot) return snapshot;
  }
  return undefined;
}

export function writeWorkspaceTreeCache(
  root: string,
  filesVersion: number,
  snapshot: WorkspaceTreeSnapshot,
): void {
  cache.set(`${root}\0${filesVersion}`, snapshot);
}

export function treeSnapshotSignature(
  snapshot: WorkspaceTreeSnapshot,
): string {
  return `${snapshot.rootName}\0${snapshot.truncated ? 1 : 0}\0${snapshot.entries
    .map((entry) => `${entry.kind}:${entry.path}`)
    .join("\n")}`;
}

export function clearWorkspaceTreeCache(root?: string): void {
  if (!root) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key.startsWith(`${root}\0`)) cache.delete(key);
  }
}
