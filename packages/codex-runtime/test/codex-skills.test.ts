import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { skillRoot } from "@pi-ling/skills";
import { describe, expect, it, vi } from "vitest";

import type { CodexAppServerClient } from "../src/codex-app-server-client.js";
import { syncCodexWorkspaceSkills } from "../src/codex-skills.js";

async function writeSkill(
  root: string,
  name: string,
  description: string,
): Promise<void> {
  const dir = join(skillRoot(root), name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: "${description}"\n---\nBody\n`,
    "utf8",
  );
}

describe("syncCodexWorkspaceSkills", () => {
  it("registers .agents/skills when Codex list is empty", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-ling-codex-skills-"));
    try {
      await writeSkill(root, "pdf", "PDF tasks");
      const agentsRoot = skillRoot(root);
      const listSkills = vi
        .fn<CodexAppServerClient["listSkills"]>()
        .mockResolvedValueOnce({
          data: [{ cwd: root, skills: [], errors: [] }],
        })
        .mockResolvedValueOnce({
          data: [
            {
              cwd: root,
              skills: [
                {
                  name: "pdf",
                  description: "PDF tasks",
                  path: join(agentsRoot, "pdf/SKILL.md"),
                  scope: "project",
                  enabled: true,
                  pluginId: null,
                },
              ],
              errors: [],
            },
          ],
        });
      const setSkillsExtraRoots = vi
        .fn<CodexAppServerClient["setSkillsExtraRoots"]>()
        .mockResolvedValue(undefined);
      const client = {
        listSkills,
        setSkillsExtraRoots,
      } as unknown as CodexAppServerClient;

      await syncCodexWorkspaceSkills(client, root);

      expect(setSkillsExtraRoots).toHaveBeenCalledWith([agentsRoot]);
      expect(listSkills).toHaveBeenCalledTimes(2);
      expect(listSkills.mock.calls[1]?.[0]).toEqual({
        cwds: [root],
        forceReload: true,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("skips extra roots when Codex already lists workspace skills", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-ling-codex-skills-"));
    try {
      await writeSkill(root, "pdf", "PDF tasks");
      const agentsRoot = skillRoot(root);
      const listSkills = vi.fn<CodexAppServerClient["listSkills"]>().mockResolvedValue({
        data: [
          {
            cwd: root,
            skills: [
              {
                name: "pdf",
                description: "PDF tasks",
                path: join(agentsRoot, "pdf/SKILL.md"),
                scope: "project",
                enabled: true,
                pluginId: null,
              },
            ],
            errors: [],
          },
        ],
      });
      const setSkillsExtraRoots = vi.fn<CodexAppServerClient["setSkillsExtraRoots"]>();
      const client = {
        listSkills,
        setSkillsExtraRoots,
      } as unknown as CodexAppServerClient;

      await syncCodexWorkspaceSkills(client, root);

      expect(setSkillsExtraRoots).not.toHaveBeenCalled();
      expect(listSkills).toHaveBeenCalledTimes(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
