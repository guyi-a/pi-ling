import { existsSync } from "node:fs";
import { watch, type FSWatcher } from "node:fs";

import { loadSkillsFromWorkspace } from "./loader.js";
import { skillRoot } from "./paths.js";
import type { SkillDiagnostic, SkillRecord } from "./types.js";

export class SkillRegistry {
  readonly #workspaceRoot: string;
  #skills: SkillRecord[] = [];
  #diagnostics: SkillDiagnostic[] = [];
  #watcher: FSWatcher | undefined;
  #reloadTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(workspaceRoot: string) {
    this.#workspaceRoot = workspaceRoot;
  }

  get workspaceRoot(): string {
    return this.#workspaceRoot;
  }

  get skills(): readonly SkillRecord[] {
    return this.#skills;
  }

  get diagnostics(): readonly SkillDiagnostic[] {
    return this.#diagnostics;
  }

  async load(): Promise<void> {
    const result = await loadSkillsFromWorkspace(this.#workspaceRoot);
    this.#skills = result.skills;
    this.#diagnostics = result.diagnostics;
  }

  index(): SkillRecord[] {
    return [...this.#skills].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  }

  names(): string[] {
    return this.index().map((skill) => skill.name);
  }

  get(name: string): SkillRecord | undefined {
    return this.#skills.find((skill) => skill.name === name);
  }

  watch(onChange: () => void): void {
    this.unwatch();
    const root = skillRoot(this.#workspaceRoot);
    if (!existsSync(root)) return;
    this.#watcher = watch(root, { recursive: true }, () => {
      if (this.#reloadTimer) clearTimeout(this.#reloadTimer);
      this.#reloadTimer = setTimeout(() => {
        void this.load().then(onChange);
      }, 300);
    });
  }

  unwatch(): void {
    if (this.#reloadTimer) {
      clearTimeout(this.#reloadTimer);
      this.#reloadTimer = undefined;
    }
    this.#watcher?.close();
    this.#watcher = undefined;
  }
}
