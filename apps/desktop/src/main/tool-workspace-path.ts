import path from "node:path";

/**
 * 工具参数里可能承载目标路径的键。
 *
 * 这些键名来自各 runtime 的工具 schema：Native 的 `path`、ACP 的 `file_path`、
 * Codex `fileChange` 的 `changes[].path`（由 `resolveToolWorkspacePath` 单独处理）。
 */
const PATH_KEYS = ["path", "file", "file_path", "filePath"] as const;

/**
 * 把工具给出的路径规范化成**工作区相对路径**。
 *
 * 这个转换是必须的，且容易踩坑：
 *
 * `ChangeTracker.capture()` 内部走 `Workspace.resolve()`，而后者明确拒绝绝对
 * 路径（抛 "Absolute paths are not allowed"）。调用方普遍用 try/catch 静默忽略
 * 失败，于是传绝对路径的后果是「变更永远记录不到」—— Last Agent Run 一直为空，
 * 且没有任何报错。
 *
 * Codex 的 `fileChange.changes[].path` 恰恰是绝对路径，所以必须在这里转换。
 * 落在工作区之外的路径返回 undefined（不记录，避免越界）。
 */
export function normalizeWorkspaceRelativePath(
  userPath: string,
  workspaceRoot: string,
): string | undefined {
  const trimmed = userPath.trim().replaceAll("\\", "/");
  if (!trimmed) return undefined;

  const root = path.resolve(workspaceRoot);
  const absolute = path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(root, trimmed);
  const relative = path.relative(root, absolute);

  // "" 表示路径就是工作区根目录本身；它不是文件，跳过。
  if (relative === "") return undefined;
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    return undefined;
  }
  return relative.split(path.sep).join("/");
}

/**
 * 从工具参数里取出目标文件的工作区相对路径。
 *
 * 支持两种形状：
 * 1. 顶层键 —— `{ path }` / `{ file_path }` / …（Native、ACP 常见）
 * 2. 嵌套 —— `{ changes: [{ path }] }`（Codex 的 `fileChange`，且路径为绝对路径）
 */
export function resolveToolWorkspacePath(
  input: Record<string, unknown>,
  workspaceRoot: string,
): string | undefined {
  for (const key of PATH_KEYS) {
    const value = input[key];
    if (typeof value !== "string" || !value.trim()) continue;
    const relative = normalizeWorkspaceRelativePath(value, workspaceRoot);
    if (relative) return relative;
  }

  const changes = input["changes"];
  if (Array.isArray(changes) && changes.length > 0) {
    const first: unknown = changes[0];
    if (typeof first === "object" && first !== null) {
      const nested = Reflect.get(first, "path");
      if (typeof nested === "string") {
        return resolveToolWorkspacePath({ path: nested }, workspaceRoot);
      }
    }
  }
  return undefined;
}
