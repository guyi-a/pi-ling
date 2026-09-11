import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  type Api,
  type Model,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import { appendSkillsIndex, skillRoot } from "@pi-ling/skills";

import { CodingAgent } from "../src/coding-agent.js";

const model: Model<Api> = {
  id: "test-model",
  name: "Test Model",
  api: "openai-completions",
  provider: "deepseek",
  baseUrl: "https://example.test",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1000,
  maxTokens: 100,
};

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

describe("load_skill", () => {
  it("builds a skills index for the system prompt", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-ling-load-skill-"));
    try {
      await writeSkill(root, "pdf", "PDF tasks", "Merge PDF files.");
      const agent = await CodingAgent.create({
        workspaceRoot: root,
        model,
        streamFn: () => {
          throw new Error("unexpected stream");
        },
        emit: () => {},
      });

      expect(agent.skillRegistry.names()).toEqual(["pdf"]);
      const prompt = appendSkillsIndex(
        "You are pi-ling.",
        [...agent.skillRegistry.skills],
      );
      expect(prompt).toContain("## Skills 目录");
      expect(prompt).toContain("**pdf**");
      expect(prompt).toContain("load_skill");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("loads skill body and paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-ling-load-skill-"));
    try {
      await writeSkill(root, "pdf", "PDF tasks", "Merge PDF files.");
      const scriptsDir = join(skillRoot(root), "pdf", "scripts");
      await mkdir(scriptsDir, { recursive: true });
      await writeFile(join(scriptsDir, "merge.py"), "print('merge')\n", "utf8");

      const agent = await CodingAgent.create({
        workspaceRoot: root,
        model,
        streamFn: () => {
          throw new Error("unexpected stream");
        },
        emit: () => {},
      });
      const tool = agent.skillRegistry.get("pdf");
      expect(tool?.content).toBe("Merge PDF files.");

      const loadSkill = (
        await import("../src/tools/load-skill.js")
      ).createLoadSkillTool(agent.skillRegistry);
      const result = await loadSkill.execute!("call-1", { name: "pdf" });
      const payload = JSON.parse(result.content[0]?.text ?? "{}");
      expect(payload).toMatchObject({
        ok: true,
        name: "pdf",
        body: "Merge PDF files.",
        skill_path: join(skillRoot(root), "pdf"),
        scripts_path: join(skillRoot(root), "pdf", "scripts"),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reloads skills and refreshes the system prompt", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-ling-load-skill-"));
    try {
      const agent = await CodingAgent.create({
        workspaceRoot: root,
        model,
        streamFn: () => {
          throw new Error("unexpected stream");
        },
        emit: () => {},
      });
      expect(agent.skillRegistry.names()).toEqual([]);

      await writeSkill(root, "docx", "DOCX tasks", "Edit documents.");
      await agent.reloadSkills();

      expect(agent.skillRegistry.names()).toEqual(["docx"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
