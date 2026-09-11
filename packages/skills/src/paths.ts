import { join } from "node:path";

export const SKILL_DIR_NAME = ".agents/skills";

export function skillRoot(workspaceRoot: string): string {
  return join(workspaceRoot, SKILL_DIR_NAME);
}
