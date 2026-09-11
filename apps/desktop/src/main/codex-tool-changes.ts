import path from "node:path";

export function isFileAffectingCodexTool(
  title: string,
  toolKind?: string,
): boolean {
  const normalized = title.trim().toLowerCase();
  if (toolKind === "edit") return true;
  return ["write_file", "edit_file", "write", "edit"].includes(normalized);
}

export function resolveToolWorkspacePath(
  input: Record<string, unknown>,
  workspaceRoot: string,
): string | undefined {
  for (const key of ["path", "file_path", "filePath"]) {
    const value = input[key];
    if (typeof value !== "string" || !value.trim()) continue;
    const root = path.resolve(workspaceRoot);
    const target = path.resolve(root, value);
    const relative = path.relative(root, target);
    if (
      relative === "" ||
      (!relative.startsWith("..") && !path.isAbsolute(relative))
    ) {
      return target;
    }
  }
  const changes = input["changes"];
  if (Array.isArray(changes) && changes.length > 0) {
    const first = changes[0];
    if (
      typeof first === "object" &&
      first !== null &&
      typeof Reflect.get(first, "path") === "string"
    ) {
      return resolveToolWorkspacePath(
        { path: Reflect.get(first, "path") as string },
        workspaceRoot,
      );
    }
  }
  return undefined;
}
