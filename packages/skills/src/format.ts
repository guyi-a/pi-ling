import type { SkillRecord } from "./types.js";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function formatSkillsForSystemPrompt(
  skills: readonly SkillRecord[],
): string {
  const visible = skills.filter((skill) => !skill.disableModelInvocation);
  if (visible.length === 0) return "";

  const lines = [
    "The following skills provide specialized instructions for specific tasks.",
    "Read the full skill file when the task matches its description.",
    "When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.",
    "",
    "<available_skills>",
  ];

  for (const skill of visible) {
    lines.push("  <skill>");
    lines.push(`    <name>${escapeXml(skill.name)}</name>`);
    lines.push(`    <description>${escapeXml(skill.description)}</description>`);
    lines.push(`    <location>${escapeXml(skill.filePath)}</location>`);
    lines.push("  </skill>");
  }

  lines.push("</available_skills>");
  return lines.join("\n");
}

export function formatSkillsIndex(skills: readonly SkillRecord[]): string {
  const visible = skills.filter((skill) => !skill.disableModelInvocation);
  if (visible.length === 0) return "";

  const lines = [
    "",
    "## Skills 目录",
    "",
    "以下是可用的 skill —— 每个 skill 是一份特定任务的详细手册（工作流、纪律、失败处理等）。",
    "看到用户请求匹配下面某条描述，**立刻** `load_skill(name=...)` 拉完整手册，再按手册执行。不要凭感觉自己发挥。",
    "",
  ];

  for (const skill of visible.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    lines.push(`- **${skill.name}** — ${skill.description}`);
  }

  return lines.join("\n");
}

export function appendSkillsIndex(
  basePrompt: string,
  skills: readonly SkillRecord[],
): string {
  const index = formatSkillsIndex(skills);
  return index ? `${basePrompt}${index}` : basePrompt;
}
