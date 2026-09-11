import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { parseFrontmatter } from "./frontmatter.js";
import { skillRoot } from "./paths.js";
import type { LoadSkillsResult, SkillDiagnostic, SkillRecord } from "./types.js";

const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;
const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function validateName(name: string, directoryName: string): string | null {
  if (name !== directoryName) {
    return `name "${name}" does not match parent directory "${directoryName}"`;
  }
  if (name.length > MAX_NAME_LENGTH) {
    return `name exceeds ${MAX_NAME_LENGTH} characters (${name.length})`;
  }
  if (!NAME_PATTERN.test(name)) {
    return "name must be lowercase alphanumerics and single hyphens";
  }
  if (name.startsWith("-") || name.endsWith("-") || name.includes("--")) {
    return "name has invalid hyphen placement";
  }
  return null;
}

function validateDescription(description: string | undefined): string | null {
  if (!description || description.trim() === "") {
    return "description is required";
  }
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return `description exceeds ${MAX_DESCRIPTION_LENGTH} characters (${description.length})`;
  }
  return null;
}

async function loadSkillFromDirectory(
  dirPath: string,
  directoryName: string,
): Promise<{ skill: SkillRecord | null; diagnostics: SkillDiagnostic[] }> {
  const diagnostics: SkillDiagnostic[] = [];
  const filePath = join(dirPath, "SKILL.md");
  if (!existsSync(filePath)) {
    return { skill: null, diagnostics };
  }

  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    diagnostics.push({
      type: "warning",
      code: "read_failed",
      message: error instanceof Error ? error.message : String(error),
      path: filePath,
    });
    return { skill: null, diagnostics };
  }

  const { frontmatter, body } = parseFrontmatter(raw);
  const description =
    typeof frontmatter.description === "string"
      ? frontmatter.description
      : undefined;
  const descriptionError = validateDescription(description);
  if (descriptionError) {
    diagnostics.push({
      type: "warning",
      code: "invalid_metadata",
      message: descriptionError,
      path: filePath,
    });
    return { skill: null, diagnostics };
  }

  const name = frontmatter.name?.trim() || directoryName;
  const nameError = validateName(name, directoryName);
  if (nameError) {
    diagnostics.push({
      type: "warning",
      code: "invalid_metadata",
      message: nameError,
      path: filePath,
    });
    return { skill: null, diagnostics };
  }

  return {
    skill: {
      name,
      description: description!,
      content: body,
      dirPath,
      filePath,
      ...(frontmatter["disable-model-invocation"]
        ? { disableModelInvocation: true }
        : {}),
    },
    diagnostics,
  };
}

export async function loadSkillsFromRoot(
  root: string,
): Promise<LoadSkillsResult> {
  const skills: SkillRecord[] = [];
  const diagnostics: SkillDiagnostic[] = [];
  const byName = new Map<string, SkillRecord>();

  if (!existsSync(root)) {
    return { skills, diagnostics };
  }

  let entries: string[];
  try {
    entries = await readdir(root);
  } catch (error) {
    diagnostics.push({
      type: "warning",
      code: "read_failed",
      message: error instanceof Error ? error.message : String(error),
      path: root,
    });
    return { skills, diagnostics };
  }

  for (const entry of entries.sort((left, right) => left.localeCompare(right))) {
    if (entry.startsWith(".")) continue;
    const dirPath = join(root, entry);
    let info;
    try {
      info = await stat(dirPath);
    } catch {
      continue;
    }
    if (!info.isDirectory()) continue;

    const loaded = await loadSkillFromDirectory(dirPath, entry);
    diagnostics.push(...loaded.diagnostics);
    if (!loaded.skill) continue;

    if (byName.has(loaded.skill.name)) {
      diagnostics.push({
        type: "warning",
        code: "duplicate",
        message: `skill "${loaded.skill.name}" shadowed by an earlier entry`,
        path: loaded.skill.filePath,
      });
      continue;
    }
    byName.set(loaded.skill.name, loaded.skill);
    skills.push(loaded.skill);
  }

  return { skills, diagnostics };
}

export async function loadSkillsFromWorkspace(
  workspaceRoot: string,
): Promise<LoadSkillsResult> {
  return loadSkillsFromRoot(skillRoot(workspaceRoot));
}
