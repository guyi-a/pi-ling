export {
  normalizeWorkspaceRelativePath,
  resolveToolWorkspacePath,
} from "./tool-workspace-path.js";

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
