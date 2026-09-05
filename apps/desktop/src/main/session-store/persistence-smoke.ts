import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { PiAgentSession } from "../pi-agent-session.js";
import { SessionStore } from "./session-store.js";

export async function runPersistenceSmoke(): Promise<{
  answer: string;
  messages: number;
}> {
  process.loadEnvFile(path.resolve(process.cwd(), "../../.env"));
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "pi-ling-persistence-"),
  );
  const database = path.join(directory, "pi-ling.db");
  const workspace = path.join(directory, "workspace");
  await fs.mkdir(workspace);

  let store = new SessionStore(database);
  const session = store.createSession({
    workspaceRoot: workspace,
    title: "Persistence smoke",
  });
  let runtime = await PiAgentSession.open({
    store,
    session,
    emit: () => {},
  });
  runtime.startPrompt(
    "run-before-restart",
    "Remember the code word durable-kiwi. Reply only remembered.",
  );
  await runtime.waitForIdle();
  await runtime.dispose();
  store.close();

  store = new SessionStore(database);
  store.reconcile();
  runtime = await PiAgentSession.open({
    store,
    session: store.getSession(session.id)!,
    emit: () => {},
  });
  runtime.startPrompt(
    "run-after-restart",
    "What code word did I ask you to remember? Reply with it only.",
  );
  await runtime.waitForIdle();

  const answer = runtime
    .snapshot()
    .events.filter(
      ({ runId, event }) =>
        runId === "run-after-restart" &&
        event.type === "assistant_text_delta",
    )
    .map(({ event }) =>
      event.type === "assistant_text_delta" ? event.delta : "",
    )
    .join("");
  const messages = store.loadMessages(session.id).length;

  await runtime.dispose();
  store.close();
  await fs.rm(directory, { recursive: true, force: true });
  return { answer, messages };
}
