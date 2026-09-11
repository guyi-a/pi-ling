import { existsSync } from "node:fs";

import { loadSkillsFromWorkspace, skillRoot } from "@pi-ling/skills";

import type { CodexAppServerClient } from "./codex-app-server-client.js";
import type { CodexSkillsListEntry } from "./codex-app-server-types.js";

function entryForCwd(
  entries: readonly CodexSkillsListEntry[],
  cwd: string,
): CodexSkillsListEntry | undefined {
  return entries.find((entry) => entry.cwd === cwd);
}

function codexCoversLocalSkills(
  entry: CodexSkillsListEntry | undefined,
  localNames: readonly string[],
  agentsSkillsRoot: string,
): boolean {
  if (localNames.length === 0) return true;
  if (!entry) return false;
  const codexNames = new Set(entry.skills.map((skill) => skill.name));
  if (!localNames.every((name) => codexNames.has(name))) {
    return false;
  }
  return entry.skills.some((skill) =>
    String(skill.path).startsWith(agentsSkillsRoot),
  );
}

export async function syncCodexWorkspaceSkills(
  client: CodexAppServerClient,
  workspaceRoot: string,
): Promise<void> {
  const agentsSkillsRoot = skillRoot(workspaceRoot);
  if (!existsSync(agentsSkillsRoot)) return;

  const local = await loadSkillsFromWorkspace(workspaceRoot);
  if (local.skills.length === 0) return;

  const localNames = local.skills.map((skill) => skill.name);
  let response = await client.listSkills({ cwds: [workspaceRoot] });
  let entry = entryForCwd(response.data, workspaceRoot);

  if (codexCoversLocalSkills(entry, localNames, agentsSkillsRoot)) {
    return;
  }

  await client.setSkillsExtraRoots([agentsSkillsRoot]);
  response = await client.listSkills({
    cwds: [workspaceRoot],
    forceReload: true,
  });
  entry = entryForCwd(response.data, workspaceRoot);
  codexCoversLocalSkills(entry, localNames, agentsSkillsRoot);
}

export async function refreshCodexWorkspaceSkills(
  client: CodexAppServerClient,
  workspaceRoots: Iterable<string>,
): Promise<void> {
  const cwds = [...new Set(workspaceRoots)];
  if (cwds.length === 0) return;
  await client.listSkills({ cwds, forceReload: true });
}
