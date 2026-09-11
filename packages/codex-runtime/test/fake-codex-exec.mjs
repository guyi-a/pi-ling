#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
const experimentalJson = args.includes("--experimental-json");
const resumeIndex = args.indexOf("resume");
const threadId =
  resumeIndex >= 0 ? args[resumeIndex + 1] : process.env.FAKE_THREAD_ID;
const effectiveThreadId = threadId ?? randomUUID();

function emit(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

async function readPrompt() {
  const rl = createInterface({ input: process.stdin });
  const chunks = [];
  for await (const line of rl) {
    chunks.push(line);
  }
  return chunks.join("\n");
}

async function main() {
  if (process.env.FAKE_CRASH === "1") {
    process.exit(17);
  }
  if (!experimentalJson) {
    console.error("fake-codex-exec requires exec --experimental-json");
    process.exit(2);
  }

  const prompt = await readPrompt();
  emit({ type: "thread.started", thread_id: effectiveThreadId });
  emit({ type: "turn.started" });

  if (process.env.FAKE_PERMISSION === "1") {
    emit({
      type: "item.started",
      item: {
        id: "cmd-1",
        type: "command_execution",
        command: "npm test",
        aggregated_output: "",
        status: "in_progress",
      },
    });
  }

  emit({
    type: "item.started",
    item: {
      id: "reason-1",
      type: "reasoning",
      text: "thinking",
    },
  });
  emit({
    type: "item.completed",
    item: {
      id: "reason-1",
      type: "reasoning",
      text: "thinking",
    },
  });

  emit({
    type: "item.started",
    item: {
      id: "tool-1",
      type: "command_execution",
      command: "echo hello",
      aggregated_output: "",
      status: "in_progress",
    },
  });
  emit({
    type: "item.completed",
    item: {
      id: "tool-1",
      type: "command_execution",
      command: "echo hello",
      aggregated_output: "hello\n",
      exit_code: 0,
      status: "completed",
    },
  });

  const text =
    process.env.FAKE_TEXT ??
    (prompt.includes("history") ? "History imported." : "Hello from Codex fake.");
  emit({
    type: "item.completed",
    item: {
      id: "msg-1",
      type: "agent_message",
      text,
    },
  });

  emit({
    type: "turn.completed",
    usage: {
      input_tokens: 12,
      cached_input_tokens: 0,
      cache_write_input_tokens: 0,
      output_tokens: 8,
      reasoning_output_tokens: 2,
    },
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
