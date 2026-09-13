export { resolveToolWorkspacePath } from "./tool-workspace-path.js";

export function isFileAffectingCodexTool(
  title: string,
  toolKind?: string,
): boolean {
  const normalized = title.trim().toLowerCase();
  if (toolKind === "edit") return true;
  return ["write_file", "edit_file", "write", "edit"].includes(normalized);
}
