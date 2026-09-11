import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { formatSkillsIndex } from "../src/format.js";
import { loadSkillsFromWorkspace } from "../src/loader.js";
import { skillRoot } from "../src/paths.js";
import { SkillRegistry } from "../src/registry.js";

async function writeSkill(
  root: string,
  name: string,
  description: string,
  body: string,
): Promise<void> {
  const dir = join(skillRoot(root), name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: "${description}"\n---\n${body}\n`,
    "utf8",
  );
}

describe("loadSkillsFromWorkspace", () => {
  it("loads skills from .agents/skills", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-ling-skills-"));
    try {
      await writeSkill(root, "example", "Example skill", "Use this skill.");
      const result = await loadSkillsFromWorkspace(root);
      expect(result.diagnostics).toEqual([]);
      expect(result.skills).toEqual([
        expect.objectContaining({
          name: "example",
          description: "Example skill",
          content: "Use this skill.",
        }),
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns empty when skills directory is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-ling-skills-"));
    try {
      const result = await loadSkillsFromWorkspace(root);
      expect(result.skills).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("SkillRegistry", () => {
  it("formats a skills index for the system prompt", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-ling-skills-"));
    try {
      await writeSkill(root, "pdf", "PDF tasks", "Body");
      const registry = new SkillRegistry(root);
      await registry.load();
      expect(formatSkillsIndex(registry.skills)).toContain("**pdf**");
      expect(formatSkillsIndex(registry.skills)).toContain("load_skill");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
