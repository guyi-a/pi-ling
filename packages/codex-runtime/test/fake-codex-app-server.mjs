import { createInterface } from "node:readline";

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
let threadCounter = 0;
let turnCounter = 0;
const pending = new Map();
const extraSkillRoots = new Set();
const skillsRequests = [];

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function result(id, value) {
  send({ id, result: value });
}

function notify(method, params) {
  send({ method, params });
}

async function completeTurn(threadId, turnId, prompt) {
  if (prompt === "approval") {
    const approval = new Promise((resolve) => pending.set("approval-1", resolve));
    send({
      id: "approval-1",
      method: "item/commandExecution/requestApproval",
      params: {
        threadId,
        turnId,
        itemId: "tool-1",
        command: "echo hello",
        cwd: process.cwd(),
      },
    });
    const response = await approval;
    if (response?.decision !== "accept" && response?.decision !== "acceptForSession") {
      notify("turn/completed", {
        threadId,
        turn: { id: turnId, status: "completed", items: [], error: null },
      });
      return;
    }
  }
  if (prompt === "question") {
    const question = new Promise((resolve) => pending.set("question-1", resolve));
    send({
      id: "question-1",
      method: "item/tool/requestUserInput",
      params: {
        threadId,
        turnId,
        itemId: "question-tool",
        isBlocking: true,
        questions: [
          {
            id: "mode",
            header: "Mode",
            question: "Which mode?",
            options: [
              { label: "safe", description: "Safe mode" },
              { label: "fast", description: "Fast mode" },
            ],
          },
        ],
      },
    });
    await question;
  }
  const item = {
    id: "tool-1",
    type: "commandExecution",
    command: "echo hello",
    cwd: process.cwd(),
    status: "inProgress",
    aggregatedOutput: null,
  };
  notify("item/started", { threadId, turnId, item, startedAtMs: Date.now() });
  notify("item/completed", {
    threadId,
    turnId,
    item: {
      ...item,
      status: "completed",
      aggregatedOutput: "hello\n",
      exitCode: 0,
    },
    completedAtMs: Date.now(),
  });
  notify("item/agentMessage/delta", {
    threadId,
    turnId,
    itemId: "message-1",
    delta: "Hello from Codex app-server.",
  });
  notify("thread/tokenUsage/updated", {
    threadId,
    turnId,
    tokenUsage: {
      total: { totalTokens: 20 },
      last: { totalTokens: 20 },
      modelContextWindow: 1000,
    },
  });
  notify("turn/completed", {
    threadId,
    turn: { id: turnId, status: "completed", items: [], error: null },
  });
}

lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (!message.method && message.id !== undefined) {
    const resolve = pending.get(String(message.id));
    if (resolve) {
      pending.delete(String(message.id));
      resolve(message.result);
    }
    return;
  }
  switch (message.method) {
    case "initialize":
      result(message.id, { userAgent: "fake-codex" });
      break;
    case "initialized":
      break;
    case "thread/start": {
      const id = `thread-${++threadCounter}`;
      result(message.id, { thread: { id, turns: [] } });
      notify("thread/started", { thread: { id, turns: [] } });
      break;
    }
    case "thread/resume":
      if (message.params.threadId === "stale-thread") {
        send({
          id: message.id,
          error: {
            code: -32603,
            message: "no rollout found for thread id stale-thread",
          },
        });
        break;
      }
      result(message.id, {
        thread: { id: message.params.threadId, turns: [] },
      });
      break;
    case "turn/start": {
      const turnId = `turn-${++turnCounter}`;
      result(message.id, {
        turn: { id: turnId, status: "inProgress", items: [], error: null },
      });
      notify("turn/started", {
        threadId: message.params.threadId,
        turn: { id: turnId, status: "inProgress", items: [], error: null },
      });
      const prompt = message.params.input?.map((part) => part.text ?? "").join("") ?? "";
      void completeTurn(message.params.threadId, turnId, prompt);
      break;
    }
    case "turn/interrupt":
      result(message.id, {});
      notify("turn/completed", {
        threadId: message.params.threadId,
        turn: {
          id: message.params.turnId,
          status: "interrupted",
          items: [],
          error: null,
        },
      });
      break;
    case "skills/list": {
      skillsRequests.push(message.params ?? {});
      const cwds = message.params?.cwds?.length
        ? message.params.cwds
        : [process.cwd()];
      const data = cwds.map((cwd) => {
        const skills = [];
        for (const root of extraSkillRoots) {
          if (root.startsWith(cwd)) {
            skills.push({
              name: "pdf",
              description: "PDF tasks",
              path: `${root}/pdf/SKILL.md`,
              scope: "project",
              enabled: true,
              pluginId: null,
            });
          }
        }
        return { cwd, skills, errors: [] };
      });
      result(message.id, { data });
      break;
    }
    case "skills/extraRoots/set": {
      extraSkillRoots.clear();
      for (const root of message.params?.extraRoots ?? []) {
        extraSkillRoots.add(root);
      }
      notify("skills/changed", {});
      result(message.id, {});
      break;
    }
    default:
      if (message.id !== undefined) {
        send({
          id: message.id,
          error: { code: -32601, message: `unknown method ${message.method}` },
        });
      }
  }
});
