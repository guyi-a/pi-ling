import type { WorkspaceTreeNode } from "@pi-ling/contracts";
import { ChevronRight, File as FileIcon, Folder } from "lucide-react";

import {
  GIT_DECORATION_LABEL,
  GIT_DECORATION_LETTER,
  type GitDecorations,
} from "./git-decorations";
import { useFilesStore } from "./store";

export type WorkspaceTreeNodeT = {
  entry: WorkspaceTreeNode;
  children: WorkspaceTreeNodeT[];
};

export function buildTree(entries: WorkspaceTreeNode[]): WorkspaceTreeNodeT[] {
  const byPath = new Map<string, WorkspaceTreeNodeT>();
  const roots: WorkspaceTreeNodeT[] = [];
  for (const entry of entries) {
    const node: WorkspaceTreeNodeT = { entry, children: [] };
    byPath.set(entry.path, node);
    const dirPath = parentDirPath(entry.path);
    const parent = dirPath ? byPath.get(dirPath) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sortNodes = (nodes: WorkspaceTreeNodeT[]) => {
    nodes.sort((a, b) => {
      if (a.entry.kind !== b.entry.kind) {
        return a.entry.kind === "dir" ? -1 : 1;
      }
      return a.entry.name.localeCompare(b.entry.name);
    });
    for (const node of nodes) sortNodes(node.children);
  };
  sortNodes(roots);
  return roots;
}

function parentDirPath(path: string): string {
  const trimmed = path.replace(/\/$/, "");
  const slash = trimmed.lastIndexOf("/");
  if (slash === -1) return "";
  return `${trimmed.slice(0, slash)}/`;
}

/** 文件行尾部的单字母 git 徽标。 */
function FileStatus(props: { state: keyof typeof GIT_DECORATION_LETTER }) {
  const label = GIT_DECORATION_LABEL[props.state];
  return (
    <span
      className="ptree-status"
      data-state={props.state}
      title={label}
      aria-label={label}
    >
      {GIT_DECORATION_LETTER[props.state]}
    </span>
  );
}

/** 目录行尾部的聚合圆点：子树内存在改动时显示。 */
function DirectoryStatus(props: { state: keyof typeof GIT_DECORATION_LETTER }) {
  const label = GIT_DECORATION_LABEL[props.state];
  return (
    <span
      className="ptree-dot"
      data-state={props.state}
      title={label}
      aria-label={label}
    />
  );
}

export function WorkspaceTreeList(props: {
  root: string;
  nodes: WorkspaceTreeNodeT[];
  selectedPath?: string | null;
  compact?: boolean;
  decorations?: GitDecorations | undefined;
}) {
  return (
    <div className={props.compact ? "ptree ptree-compact" : "ptree"}>
      {props.nodes.map((node) => (
        <TreeItem
          key={node.entry.path}
          root={props.root}
          node={node}
          depth={0}
          selectedPath={props.selectedPath ?? null}
          compact={props.compact ?? false}
          decorations={props.decorations}
        />
      ))}
    </div>
  );
}

function TreeItem(props: {
  root: string;
  node: WorkspaceTreeNodeT;
  depth: number;
  selectedPath: string | null;
  compact: boolean;
  decorations?: GitDecorations | undefined;
}) {
  const { node, depth, selectedPath, compact, root, decorations } = props;
  const { entry, children } = node;
  const isDir = entry.kind === "dir";
  const directoryKey = `${root}:${entry.path}`;
  const open = useFilesStore(
    (state) => state.expandedDirectories[directoryKey] === true,
  );
  const toggleDirectory = useFilesStore((state) => state.toggleDirectory);
  const requestOpenFile = useFilesStore((state) => state.requestOpenFile);
  const isSelected = entry.path === selectedPath;
  const dirState = isDir ? decorations?.dirs.get(entry.path) : undefined;
  const fileState = isDir ? undefined : decorations?.files.get(entry.path);

  if (isDir) {
    return (
      <div className="ptree-node" role="treeitem" aria-expanded={open}>
        <button
          className="ptree-row"
          type="button"
          style={{ paddingLeft: `${8 + depth * 14}px` }}
          onClick={() => toggleDirectory(directoryKey)}
          title={entry.path}
        >
          <ChevronRight
            className={`ptree-chevron${open ? " is-expanded" : ""}`}
          />
          <Folder className="ptree-icon" />
          <span className="ptree-name">{entry.name}</span>
          {dirState ? <DirectoryStatus state={dirState} /> : null}
        </button>
        {open ? (
          <div className="ptree-children">
            {children.length === 0 ? (
              <div className="ptree-message">空目录。</div>
            ) : (
              children.map((child) => (
                <TreeItem
                  key={child.entry.path}
                  root={root}
                  node={child}
                  depth={depth + 1}
                  selectedPath={selectedPath}
                  compact={compact}
                  decorations={decorations}
                />
              ))
            )}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <button
      className={`ptree-row${isSelected ? " is-selected" : ""}`}
      type="button"
      style={{ paddingLeft: `${8 + depth * 14}px` }}
      onClick={() => requestOpenFile(entry.path)}
      role="treeitem"
      aria-selected={isSelected}
      title={entry.path}
    >
      <FileIcon className="ptree-icon" />
      <span className="ptree-name">{entry.name}</span>
      {fileState ? <FileStatus state={fileState} /> : null}
    </button>
  );
}
