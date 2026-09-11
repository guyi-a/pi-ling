import type { WorkspaceTreeNode as WorkspaceTreeEntry } from "@pi-ling/contracts";
import { useEffect, useMemo, useState } from "react";

import { buildTree, WorkspaceTreeList } from "./workspace-tree";
import {
  readWorkspaceTreeCacheLatest,
  treeSnapshotSignature,
  writeWorkspaceTreeCache,
} from "./workspace-tree-cache";
import { useFilesStore } from "./store";

type TreeState = {
  entries: WorkspaceTreeEntry[] | null;
  rootName: string;
  truncated: boolean;
  error: string | null;
  signature: string;
};

function initialTreeState(
  root: string,
  cacheEpoch: number,
): TreeState {
  const cached = readWorkspaceTreeCacheLatest(root, cacheEpoch);
  if (!cached) {
    return {
      entries: null,
      rootName: "",
      truncated: false,
      error: null,
      signature: "",
    };
  }
  return {
    entries: cached.entries,
    rootName: cached.rootName,
    truncated: cached.truncated,
    error: null,
    signature: treeSnapshotSignature(cached),
  };
}

export function useWorkspaceTree(root: string) {
  const filesVersion = useFilesStore((state) => state.filesVersion);
  const treeEpoch = useFilesStore((state) => state.treeEpoch);
  const cacheEpoch = filesVersion * 1_000_000 + treeEpoch;
  const [state, setState] = useState(() =>
    initialTreeState(root, cacheEpoch),
  );

  useEffect(() => {
    setState(initialTreeState(root, cacheEpoch));
  }, [root, filesVersion]);

  useEffect(() => {
    let cancelled = false;

    void window.piLing
      .workspaceTree(root)
      .then((result) => {
        if (cancelled) return;
        const snapshot = {
          entries: result.entries,
          rootName: result.workspaceRootName,
          truncated: Boolean(result.truncated),
        };
        const signature = treeSnapshotSignature(snapshot);
        writeWorkspaceTreeCache(root, cacheEpoch, snapshot);
        setState((current) => {
          if (current.signature === signature) return current;
          return { ...snapshot, error: null, signature };
        });
      })
      .catch((err) => {
        if (!cancelled) {
          setState((current) => ({
            ...current,
            error: err instanceof Error ? err.message : String(err),
          }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [root, cacheEpoch]);

  const roots = useMemo(
    () => (state.entries ? buildTree(state.entries) : []),
    [state.entries],
  );

  return {
    roots,
    loading: state.entries === null && !state.error,
    rootName: state.rootName,
    truncated: state.truncated,
    error: state.error,
  };
}

export function WorkspaceTree(props: { root: string }) {
  const { roots, loading, rootName, truncated, error } = useWorkspaceTree(
    props.root,
  );

  if (loading) {
    return <div className="files-tree-message">正在加载…</div>;
  }
  if (error) {
    return <div className="files-tree-message">加载失败：{error}</div>;
  }

  return (
    <div className="files-tree" role="tree" aria-label="Files">
      <div className="files-tree-root">
        <span className="files-tree-root-label" title={rootName}>
          {rootName}
        </span>
      </div>
      {roots.length === 0 ? (
        <div className="files-tree-message">空目录。</div>
      ) : (
        <WorkspaceTreeList root={props.root} nodes={roots} />
      )}
      {truncated ? (
        <div className="files-tree-message">目录项过多，已截断显示。</div>
      ) : null}
    </div>
  );
}
