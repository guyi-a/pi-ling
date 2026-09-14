/**
 * Files 面板的路径约定与重映射。
 *
 * 这个模块**刻意不依赖 store 或 React** —— 它是被 `store.ts`（状态）与
 * `file-operations.ts`（IPC 调用）共同依赖的纯逻辑层。若放进 `file-operations.ts`
 * 会形成循环依赖（store ⇄ file-operations）。
 *
 * 约定（与 main 进程的 `WorkspaceTreeNode.path` 一致）：
 * - 路径用 "/" 分隔
 * - **目录以 "/" 结尾**，文件不带
 * - 工作区根目录表示为空串 ""
 */

/** 取父目录路径（保留结尾 "/"，根目录返回 ""）。 */
export function parentDirOf(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const slash = trimmed.lastIndexOf("/");
  if (slash < 0) return "";
  return `${trimmed.slice(0, slash)}/`;
}

/** 取路径最后一段（名称）。 */
export function baseNameOf(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const slash = trimmed.lastIndexOf("/");
  return slash < 0 ? trimmed : trimmed.slice(slash + 1);
}

/** 把父目录与单段名称拼成完整路径。 */
export function joinWorkspacePath(
  parent: string,
  name: string,
  kind: "file" | "dir",
): string {
  const prefix = parent === "" || parent.endsWith("/") ? parent : `${parent}/`;
  return `${prefix}${name}${kind === "dir" ? "/" : ""}`;
}

/** 目录行的展开键；store 用它记录展开状态。 */
export function directoryKeyOf(root: string, dirPath: string): string {
  return `${root}:${dirPath}`;
}

/**
 * 由「原路径 + 新名称」算出「新路径」。
 *
 * 重命名**只改名字、不移动位置**，所以新路径 = 原路径的父目录 + 新名称。
 * 注意目录路径（`src/`）的父目录是 `parentDirOf("src/")` = `""`，
 * **不是它自己** —— 早期版本在这里误用了 `path` 当父目录，导致目录改名后
 * 所有子路径被算成 `src/lib/...` 而不是 `lib/...`（单测测不到，集成时才暴露）。
 */
export function renamedPathOf(
  path: string,
  newName: string,
): { newPath: string; kind: "file" | "dir" } {
  const kind: "file" | "dir" = path.endsWith("/") ? "dir" : "file";
  return {
    newPath: joinWorkspacePath(parentDirOf(path), newName, kind),
    kind,
  };
}

/**
 * 操作成功后要打开的路径；目录没有"打开"的概念，返回 undefined。
 */
export function openTargetAfterCreate(
  createdPath: string,
  kind: "file" | "dir",
): string | undefined {
  return kind === "file" ? createdPath : undefined;
}

/** 去掉结尾斜杠，便于比较。 */
function stripTrailingSlash(path: string): string {
  return path.replace(/\/+$/, "");
}

/**
 * 把「旧路径」重映射成「新路径」——重命名后修正所有指向旧路径的状态。
 *
 * 三种情况：
 * - 精确命中：`a.ts` → `b.ts`
 * - 子路径命中（目录改名）：`src/a.ts` 在 `src/` → `lib/` 后变成 `lib/a.ts`
 * - 无关：原样返回
 *
 * 必须按**目录边界**匹配，否则 `ab.ts` 会被 `a.ts` 的改名带跑偏。
 * 结尾斜杠要保留（目录路径的约定），所以拼接时用原始串切片。
 */
export function remapPath(
  candidate: string,
  oldPath: string,
  newPath: string,
): string {
  if (!candidate) return candidate;
  const oldBase = stripTrailingSlash(oldPath);
  const newBase = stripTrailingSlash(newPath);
  if (!oldBase) return candidate;
  const candidateBase = stripTrailingSlash(candidate);

  if (candidateBase === oldBase) {
    return candidate.endsWith("/") ? `${newBase}/` : newBase;
  }
  if (candidateBase.startsWith(`${oldBase}/`)) {
    // 用原始 candidate 切片，天然保留结尾斜杠
    return `${newBase}${candidate.slice(oldBase.length)}`;
  }
  return candidate;
}

/**
 * 重映射树的展开状态键。
 *
 * 键的格式是 `${root}:${dirPath}`，目录改名后旧键会变成永不再命中的垃圾，
 * 新目录名则默认折叠 —— 用户刚改完名字，子目录却收起来了，观感很怪。
 */
export function remapExpandedKeys(
  expanded: Record<string, true>,
  root: string,
  oldPath: string,
  newPath: string,
): Record<string, true> {
  const prefix = `${root}:`;
  const next: Record<string, true> = {};
  for (const key of Object.keys(expanded)) {
    if (!key.startsWith(prefix)) {
      next[key] = true;
      continue;
    }
    const dirPath = key.slice(prefix.length);
    next[`${prefix}${remapPath(dirPath, oldPath, newPath)}`] = true;
  }
  return next;
}

/**
 * 文件树的行内输入框该默认选中哪一段。
 *
 * 对齐 VS Code / Cursor：文件只选中**主名**、留下扩展名（改 `a.ts` → `b.ts`
 * 时不用重打扩展名），目录则全选。
 */
export function renameSelectionRange(
  name: string,
  kind: "file" | "dir",
): [number, number] {
  if (kind === "dir") return [0, name.length];
  const dot = name.lastIndexOf(".");
  // 前导点开头的隐藏文件（.env / .gitignore）视作无扩展名，整体选中
  if (dot <= 0) return [0, name.length];
  return [0, dot];
}
