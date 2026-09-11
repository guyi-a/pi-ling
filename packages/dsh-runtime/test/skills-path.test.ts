import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { loadSkillsFromWorkspace, skillRoot, SKILL_DIR_NAME } from "@pi-ling/skills";
import { describe, expect, it } from "vitest";

describe("DSH skill discovery path", () => {
  it("uses the same workspace-local .agents/skills root as Native and Codex", async () => {
    expect(SKILL_DIR_NAME).toBe(".agents/skills");

    const root = await mkdtemp(join(tmpdir(), "pi-ling-dsh-skills-"));
    try {
      const dir = join(skillRoot(root), "pdf");
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, "SKILL.md"),
        '---\nname: pdf\ndescription: "PDF tasks"\n---\nBody\n',
        "utf8",
      );

      const loaded = await loadSkillsFromWorkspace(root);
      expect(loaded.skills.map((skill) => skill.name)).toEqual(["pdf"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
