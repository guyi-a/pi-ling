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

export function writeWorkspaceTreeCache(
  root: string,
  filesVersion: number,
  snapshot: WorkspaceTreeSnapshot,
): void {
  cache.set(`${root}\0${filesVersion}`, snapshot);
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
