import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { query } from "@anthropic-ai/claude-agent-sdk";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

function loadRepoDotenv() {
  try {
    const text = readFileSync(resolve(repoRoot, ".env"), "utf8");
    for (const line of text.split(/\r?\n/u)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator <= 0) continue;
      const key = trimmed.slice(0, separator).trim();
      const rawValue = trimmed.slice(separator + 1).trim();
      if (process.env[key] === undefined) {
        process.env[key] = rawValue;
      }
    }
  } catch {
    // optional
  }
}

function buildDocEnv(apiKey) {
  return {
    PATH: process.env.PATH || "",
    SystemRoot: process.env.SystemRoot || "",
    USERPROFILE: process.env.USERPROFILE || "",
    TEMP: process.env.TEMP || "",
    TMP: process.env.TMP || "",
    ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic",
    ANTHROPIC_AUTH_TOKEN: apiKey,
    ANTHROPIC_API_KEY: apiKey,
    ANTHROPIC_MODEL: "deepseek-v4-pro[1m]",
    ANTHROPIC_DEFAULT_OPUS_MODEL: "deepseek-v4-pro[1m]",
    ANTHROPIC_DEFAULT_SONNET_MODEL: "deepseek-v4-pro[1m]",
    ANTHROPIC_DEFAULT_HAIKU_MODEL: "deepseek-v4-flash",
    CLAUDE_CODE_SUBAGENT_MODEL: "deepseek-v4-flash",
    CLAUDE_CODE_EFFORT_LEVEL: "max",
    CLAUDE_CODE_AUTO_COMPACT_WINDOW: "786432",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  };
}

function runCli(docEnv, timeoutMs) {
  return new Promise((resolvePromise) => {
    const child = spawn(
      process.platform === "win32" ? "claude.cmd" : "claude",
      [
        "-p",
        "Reply with exactly PROBE_OK and nothing else.",
        "--output-format",
        "text",
        "--dangerously-skip-permissions",
      ],
      {
        cwd: repoRoot,
        env: docEnv,
        stdio: ["ignore", "pipe", "pipe"],
        shell: process.platform === "win32",
      },
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      child.kill();
      resolvePromise({
        ok: false,
        reason: "timeout",
        stdout,
        stderr,
      });
    }, timeoutMs);

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolvePromise({
        ok: code === 0 && stdout.toUpperCase().includes("PROBE"),
        code,
        signal,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
  });
}

async function runSdk(docEnv, { model, timeoutMs }) {
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), timeoutMs);
  const types = [];
  let text = "";
  let result = undefined;

  try {
    for await (const message of query({
      prompt: "Reply with exactly PROBE_OK and nothing else.",
      options: {
        cwd: repoRoot,
        ...(model ? { model } : {}),
        env: docEnv,
        tools: [],
        permissionMode: "dontAsk",
        maxTurns: 1,
        abortController,
        stderr: (data) => {
          if (data.includes("api_retry") || data.includes("error")) {
            process.stderr.write(`[sdk stderr] ${data}`);
          }
        },
      },
    })) {
      const label =
        message.type === "system" && "subtype" in message
          ? `${message.type}:${message.subtype}`
          : message.type;
      types.push(label);
      if (message.type === "assistant") {
        for (const block of message.message.content) {
          if (block.type === "text") text += block.text;
        }
      }
      if (message.type === "result") {
        result = {
          subtype: message.subtype,
          isError: message.is_error,
        };
      }
    }
    return {
      ok: Boolean(result && !result.isError && text.toUpperCase().includes("PROBE")),
      types,
      text: text.trim(),
      result,
    };
  } catch (error) {
    return {
      ok: false,
      types,
      text: text.trim(),
      result,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

loadRepoDotenv();
const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
if (!apiKey) {
  console.error("DEEPSEEK_API_KEY missing in .env");
  process.exit(1);
}

const docEnv = buildDocEnv(apiKey);
const timeoutMs = Number(process.env.DEEPSEEK_COMPARE_TIMEOUT_MS ?? 60_000);

console.log("DeepSeek Claude Code compare (doc env)");
console.log("timeoutMs", timeoutMs);
console.log("");

console.log("=== CLI (claude.cmd -p) ===");
const cli = await runCli(docEnv, timeoutMs);
console.log(JSON.stringify(cli, null, 2));
console.log("");

console.log("=== SDK (model=claude-sonnet-4-5) ===");
const sdkWithModel = await runSdk(docEnv, {
  model: "claude-sonnet-4-5",
  timeoutMs,
});
console.log(JSON.stringify(sdkWithModel, null, 2));
console.log("");

console.log("=== SDK (no model option, env only) ===");
const sdkEnvOnly = await runSdk(docEnv, { timeoutMs });
console.log(JSON.stringify(sdkEnvOnly, null, 2));
