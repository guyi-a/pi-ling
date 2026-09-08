import path from "node:path";

export function filePathFromToolInput(
  input: Record<string, unknown>,
): string | undefined {
  for (const key of ["path", "file", "file_path", "filePath"]) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim().replaceAll("\\", "/");
    }
  }
  return undefined;
}

/** DSH 可能传绝对路径；ChangeTracker 只接受工作区相对路径。 */
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
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    return undefined;
  }
  return relative === "" ? "." : relative.split(path.sep).join("/");
}

export function resolveToolWorkspacePath(
  input: Record<string, unknown>,
  workspaceRoot: string,
): string | undefined {
  const raw = filePathFromToolInput(input);
  if (!raw) return undefined;
  return normalizeWorkspaceRelativePath(raw, workspaceRoot);
}

export function isFileAffectingDshTool(
  title: string,
  toolKind?: string,
): boolean {
  if (toolKind === "edit") return true;
  const name = title.toLowerCase().replaceAll(/[\s-]+/g, "_");
  return /(write|edit|patch|create|str_replace|delete|rename|move|mkdir|rm|mv|cp)/.test(
    name,
  );
}
