import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { RuntimeEvent } from "@pi-ling/runtime-contracts";
import { skillRoot } from "@pi-ling/skills";
import { afterEach, describe, expect, it } from "vitest";

import { CodexRuntimeAdapter } from "../src/codex-runtime.js";

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

const fakeServer = fileURLToPath(
  new URL("./fake-codex-app-server.mjs", import.meta.url),
);
const adapters: CodexRuntimeAdapter[] = [];

async function adapter() {
  const home = await mkdtemp(join(tmpdir(), "pi-ling-codex-app-server-"));
  const instance = new CodexRuntimeAdapter({
    codexHome: home,
    codexBin: process.execPath,
    appServerArgs: [fakeServer],
  });
  adapters.push(instance);
  await instance.initialize();
  return { instance, home };
}

afterEach(async () => {
  await Promise.all(adapters.splice(0).map((item) => item.dispose()));
});

describe("CodexRuntimeAdapter app-server", () => {
  it("reports capabilities", async () => {
    const { instance, home } = await adapter();
    expect(instance.kind).toBe("codex");
    expect(instance.capabilities.toolApproval).toBe(true);
    await rm(home, { recursive: true, force: true });
  });

  it("maps app-server notifications to runtime events", async () => {
    const { instance, home } = await adapter();
    const events: RuntimeEvent[] = [];
    instance.subscribe((event) => events.push(event));
    await instance.createSession({
      sessionId: "local-1",
      workspaceRoot: process.cwd(),
    });
    await instance.send("local-1", "run-1", "say hello");

    expect(events.map((event) => event.type)).toEqual([
      "run_start",
      "tool",
      "tool",
      "assistant_text",
      "context_usage",
      "run_end",
    ]);
    expect(events.find((event) => event.type === "tool")).toMatchObject({
      type: "tool",
      callId: "run-1:tool-1",
      title: "run_command",
    });
    // 回归：必须取 `last`（最近一次调用），不能取 `total`（thread 累计）。
    // 误取 total 会得到 30000 - 300 = 29700。
    expect(events.find((event) => event.type === "context_usage")).toMatchObject({
      type: "context_usage",
      used: 200,
      size: 1000,
      input: 200,
      output: 300,
      reasoning: 0,
    });
    await rm(home, { recursive: true, force: true });
  });

  it("namespaces reused app-server item ids by run", async () => {
    const { instance, home } = await adapter();
    const events: RuntimeEvent[] = [];
    instance.subscribe((event) => events.push(event));
    await instance.createSession({
      sessionId: "local-items",
      workspaceRoot: process.cwd(),
    });
    await instance.send("local-items", "run-1", "first");
    await instance.send("local-items", "run-2", "second");

    expect(
      events
        .filter((event) => event.type === "tool")
        .filter((event) => event.status === "completed")
        .map((event) => event.callId),
    ).toEqual(["run-1:tool-1", "run-2:tool-1"]);
    await rm(home, { recursive: true, force: true });
  });

  it("round-trips approval decisions before continuing", async () => {
    const { instance, home } = await adapter();
    const events: RuntimeEvent[] = [];
    instance.subscribe((event) => {
      events.push(event);
      if (event.type === "permission") {
        void instance.resolvePermission({
          permissionId: event.permissionId,
          optionId: "accept",
        });
      }
    });
    await instance.createSession({
      sessionId: "approval",
      workspaceRoot: process.cwd(),
    });
    await instance.send("approval", "run-approval", "approval");
    expect(events.some((event) => event.type === "permission")).toBe(true);
    expect(events.at(-1)).toMatchObject({
      type: "run_end",
      status: "completed",
    });
    await rm(home, { recursive: true, force: true });
  });

  it("round-trips user questions", async () => {
    const { instance, home } = await adapter();
    const events: RuntimeEvent[] = [];
    instance.subscribe((event) => {
      events.push(event);
      if (event.type === "question") {
        void instance.resolveQuestion({
          questionId: event.questionId,
          answers: [{ questionId: "mode", optionIds: ["safe"] }],
        });
      }
    });
    await instance.createSession({
      sessionId: "question",
      workspaceRoot: process.cwd(),
    });
    await instance.send("question", "run-question", "question");
    expect(events.find((event) => event.type === "question")).toMatchObject({
      type: "question",
      questions: [{ id: "mode", question: "Which mode?" }],
    });
    await rm(home, { recursive: true, force: true });
  });

  it("lazy-initializes on first createSession", async () => {
    const home = await mkdtemp(join(tmpdir(), "pi-ling-codex-lazy-"));
    const instance = new CodexRuntimeAdapter({
      codexHome: home,
      codexBin: process.execPath,
      appServerArgs: [fakeServer],
    });
    adapters.push(instance);
    await instance.createSession({
      sessionId: "lazy-1",
      workspaceRoot: process.cwd(),
    });
    await rm(home, { recursive: true, force: true });
  });

  it("imports canonical history into a new app-server thread", async () => {
    const { instance, home } = await adapter();
    const imported = await instance.importSession({
      sessionId: "import-1",
      workspaceRoot: process.cwd(),
      canonicalMessages: [
        {
          role: "user",
          content: [{ type: "text", text: "prior question" }],
        },
      ],
    });
    expect(imported.externalSessionId).toBeTruthy();
    await rm(home, { recursive: true, force: true });
  });

  it("starts a fresh thread when resume hits a missing rollout", async () => {
    const { instance, home } = await adapter();
    const handle = await instance.resumeSession({
      sessionId: "stale-resume",
      workspaceRoot: process.cwd(),
      externalSessionId: "stale-thread",
    });
    expect(handle.externalSessionId).not.toBe("stale-thread");
    expect(handle.externalSessionId).toMatch(/^thread-/);
    await rm(home, { recursive: true, force: true });
  });

  it("syncs .agents/skills when a Codex session starts", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-ling-codex-skills-"));
    await writeSkill(root, "pdf", "PDF tasks");
    const { instance, home } = await adapter();
    await expect(
      instance.createSession({
        sessionId: "skills-sync",
        workspaceRoot: root,
      }),
    ).resolves.toMatchObject({ sessionId: "skills-sync" });
    await rm(root, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  });
});
