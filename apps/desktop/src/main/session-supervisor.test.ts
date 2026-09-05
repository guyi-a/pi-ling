import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SessionStore } from "./session-store/session-store.js";
import { SessionSupervisor } from "./session-supervisor.js";

describe("SessionSupervisor", () => {
  let root = "";
  let store: SessionStore;
  let supervisor: SessionSupervisor;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ling-supervisor-"));
    store = new SessionStore(path.join(root, "sessions.db"));
    supervisor = new SessionSupervisor(store, () => {});
  });

  afterEach(async () => {
    await supervisor.dispose();
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  it("creates, switches and isolates session snapshots", async () => {
    const first = await supervisor.create({
      workspaceRoot: root,
      title: "First",
    });
    store.appendTimeline(first.session.id, "run-1", {
      type: "run_start",
      userItemId: "run-1:user",
      prompt: "first",
    });
    const second = await supervisor.create({
      workspaceRoot: root,
      title: "Second",
    });

    expect(supervisor.list().map((session) => session.title)).toEqual([
      "Second",
      "First",
    ]);
    expect(second.snapshot.events).toHaveLength(0);

    const restored = await supervisor.activate(first.session.id);
    expect(restored.snapshot.events).toHaveLength(1);
    expect(restored.snapshot.events[0]?.event).toMatchObject({
      type: "run_start",
      prompt: "first",
    });
  });
});
