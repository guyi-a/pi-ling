import type { WorkspaceTreeNode } from "@pi-ling/contracts";
import {
  ChevronRight,
  File as FileIcon,
  FilePlus,
  Folder,
  FolderPlus,
  Trash2,
} from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import {
  GIT_DECORATION_LABEL,
  GIT_DECORATION_LETTER,
  type GitDecorations,
} from "./git-decorations";
import { useFileOperations, directoryKeyOf } from "./file-operations";
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

/* ---------- 树的操作上下文 ---------- */

interface TreeActions {
  root: string;
  /** 右键某行：打开菜单（坐标为视口坐标）。 */
  openMenu: (
    event: React.MouseEvent,
    path: string,
    kind: "file" | "dir",
  ) => void;
  /** 提交新建；返回 false 表示失败（保留输入，便于改名重试）。 */
  create: (parent: string, name: string, kind: "file" | "dir") => Promise<boolean>;
}

const TreeActionsContext = createContext<TreeActions | null>(null);

function useTreeActions(): TreeActions {
  const actions = useContext(TreeActionsContext);
  if (!actions) throw new Error("TreeActionsContext is missing");
  return actions;
}

/**
 * 行内命名输入。
 *
 * 自己持有草稿文本（不进 store），避免每敲一个字符就让整棵树重渲染。
 * Enter 提交、Esc 取消、失焦时若非空则提交（与 VS Code / Cursor 一致）。
 */
function DraftRow(props: {
  depth: number;
  parent: string;
  kind: "file" | "dir";
}) {
  const actions = useTreeActions();
  const cancelDraft = useFilesStore((state) => state.cancelDraft);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function commit() {
    if (busy) return;
    const name = text.trim();
    if (!name) {
      cancelDraft();
      return;
    }
    setBusy(true);
    const ok = await actions.create(props.parent, name, props.kind);
    setBusy(false);
    // 失败时不动：store 里已经写了错误信息，输入框保留原文本供改名重试
    if (ok) cancelDraft();
  }

  return (
    <div
      className="ptree-row ptree-draft"
      style={{ paddingLeft: `${8 + props.depth * 14}px` }}
    >
      {props.kind === "dir" ? (
        <Folder className="ptree-icon" />
      ) : (
        <FileIcon className="ptree-icon" />
      )}
      <input
        ref={inputRef}
        className="ptree-draft-input"
        value={text}
        disabled={busy}
        aria-label={props.kind === "dir" ? "新建文件夹名称" : "新建文件名"}
        placeholder={props.kind === "dir" ? "文件夹名称" : "文件名，含扩展名"}
        spellCheck={false}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void commit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            cancelDraft();
          }
        }}
        onBlur={() => void commit()}
      />
    </div>
  );
}

export function WorkspaceTreeList(props: {
  root: string;
  nodes: WorkspaceTreeNodeT[];
  selectedPath?: string | null;
  compact?: boolean;
  decorations?: GitDecorations | undefined;
}) {
  const [menu, setMenu] = useState<{
    path: string;
    kind: "file" | "dir";
    x: number;
    y: number;
  } | null>(null);
  const beginDraft = useFilesStore((state) => state.beginDraft);
  const beginDelete = useFilesStore((state) => state.beginDelete);
  const expandDirectory = useFilesStore((state) => state.expandDirectory);
  const draft = useFilesStore((state) => state.draft);
  const { createEntry } = useFileOperations(props.root);

  /**
   * 开始新建之前先展开目标目录。
   *
   * 输入行渲染在目标目录的子树里 —— 若目录是折叠的，用户点「新建文件」
   * 会看不到任何变化（输入框被渲染在折叠区域内）。实测踩过这个坑。
   */
  function startDraft(parent: string, kind: "file" | "dir") {
    if (parent !== "") expandDirectory(directoryKeyOf(props.root, parent));
    beginDraft(parent, kind);
  }

  const actions: TreeActions = {
    root: props.root,
    openMenu: (event, path, kind) => {
      event.preventDefault();
      event.stopPropagation();
      setMenu({ path, kind, x: event.clientX, y: event.clientY });
    },
    create: createEntry,
  };

  return (
    <TreeActionsContext.Provider value={actions}>
      <div className={props.compact ? "ptree ptree-compact" : "ptree"}>
        {/* 在工作区根目录新建时没有"根目录行"来承载输入框，这里补一行 */}
        {draft !== null && draft.parent === "" ? (
          <DraftRow depth={0} parent="" kind={draft.kind} />
        ) : null}
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
      {menu ? (
        <TreeContextMenu
          menu={menu}
          onClose={() => setMenu(null)}
          onNewFile={() => {
            startDraft(
              menu.kind === "dir" ? menu.path : parentDirPath(menu.path),
              "file",
            );
            setMenu(null);
          }}
          onNewFolder={() => {
            startDraft(
              menu.kind === "dir" ? menu.path : parentDirPath(menu.path),
              "dir",
            );
            setMenu(null);
          }}
          onDelete={() => {
            beginDelete(menu.path);
            setMenu(null);
          }}
        />
      ) : null}
    </TreeActionsContext.Provider>
  );
}

function TreeContextMenu(props: {
  menu: { path: string; kind: "file" | "dir"; x: number; y: number };
  onClose: () => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  onDelete: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ left: props.menu.x, top: props.menu.y });

  // 贴边时翻转，避免菜单被视口裁掉
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    setPosition({
      left: Math.min(props.menu.x, window.innerWidth - rect.width - 8),
      top: Math.min(props.menu.y, window.innerHeight - rect.height - 8),
    });
  }, [props.menu.x, props.menu.y]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && ref.current?.contains(target)) return;
      props.onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [props]);

  return (
    <div
      ref={ref}
      className="ptree-menu"
      role="menu"
      style={{ left: position.left, top: position.top }}
    >
      <button type="button" role="menuitem" onClick={props.onNewFile}>
        <FilePlus size={13} />
        新建文件
      </button>
      <button type="button" role="menuitem" onClick={props.onNewFolder}>
        <FolderPlus size={13} />
        新建文件夹
      </button>
      <div className="ptree-menu-sep" />
      <button
        type="button"
        role="menuitem"
        className="is-danger"
        onClick={props.onDelete}
      >
        <Trash2 size={13} />
        删除
      </button>
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
  const draft = useFilesStore((state) => state.draft);
  const actions = useTreeActions();
  // 只有本目录是草稿的目标父目录时才渲染输入行
  const isDraftParent = draft !== null && draft.parent === entry.path;
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
          onContextMenu={(event) => actions.openMenu(event, entry.path, "dir")}
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
            {/* 新建在空目录里也必须看得见，所以输入行要排在"空目录"提示之前 */}
            {isDraftParent ? (
              <DraftRow depth={depth + 1} parent={entry.path} kind={draft.kind} />
            ) : null}
            {children.length === 0 && !isDraftParent ? (
              <div className="ptree-message">空目录。</div>
            ) : (
              <>
                {children.map((child) => (
                  <TreeItem
                    key={child.entry.path}
                    root={root}
                    node={child}
                    depth={depth + 1}
                    selectedPath={selectedPath}
                    compact={compact}
                    decorations={decorations}
                  />
                ))}
              </>
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
      onContextMenu={(event) => actions.openMenu(event, entry.path, "file")}
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
