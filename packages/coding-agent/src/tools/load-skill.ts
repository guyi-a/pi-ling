import { existsSync } from "node:fs";
import { join } from "node:path";

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@pi-ling/agent-core";
import type { SkillRegistry } from "@pi-ling/skills";

export function createLoadSkillTool(registry: SkillRegistry): AgentTool {
  return {
    name: "load_skill",
    label: "Load skill",
    description:
      "Load a skill: returns its instruction body plus its on-disk directory path. " +
      "Call this the moment a user request matches a skill's trigger description — its body carries the exact " +
      "tool syntax, discipline, and failure recipes for that task. " +
      "The skill directory may contain additional files (REFERENCE.md, FORMS.md, etc.) — read them with read_file as needed. " +
      "If the skill has a scripts/ subdirectory, run its scripts via run_command. " +
      "Do NOT modify files inside the skill directory — copy to workspace/scripts/ first if you need to customize. " +
      "The system prompt's Skills 目录 section lists what is currently available.",
    parameters: Type.Object({
      name: Type.String({
        minLength: 1,
        description:
          "Skill name to load (must match one of the entries listed in the system prompt's Skills index).",
      }),
    }),
    execute: async (_callId, arguments_) => {
      const { name } = arguments_ as { name: string };
      const skill = registry.get(name);
      if (!skill) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ok: false,
                  message: `skill ${JSON.stringify(name)} not found; available: ${registry.names().join(", ")}`,
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }

      const scriptsPath = join(skill.dirPath, "scripts");
      const payload = {
        ok: true,
        name: skill.name,
        body: skill.content,
        skill_path: skill.dirPath,
        ...(existsSync(scriptsPath) ? { scripts_path: scriptsPath } : {}),
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    },
  };
}
