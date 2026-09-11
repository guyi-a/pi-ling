import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

const NODE_EXECUTABLE =
  process.platform === "win32" ? "node.exe" : "node";

/** Prefer a real Node binary over Electron when spawning DSH. */
export function resolveDshNodeExecutable(
  env: NodeJS.ProcessEnv = process.env,
  fallback = process.execPath,
): string {
  const configured = env["PI_LING_NODE_BIN"]?.trim();
  if (configured) return resolve(configured);
  const pathEnv = env["PATH"] ?? process.env["PATH"] ?? "";
  for (const entry of pathEnv.split(process.platform === "win32" ? ";" : ":")) {
    const dir = entry.trim();
    if (!dir) continue;
    const candidate = join(dir, NODE_EXECUTABLE);
    if (existsSync(candidate)) return candidate;
  }
  const fallbackResolved = resolve(fallback);
  if (isAbsolute(fallbackResolved) && existsSync(fallbackResolved)) {
    const base = fallbackResolved.split(/[/\\]/u).pop()?.toLowerCase();
    if (base !== "electron.exe" && base !== "electron") {
      return fallbackResolved;
    }
  }
  return fallback;
}
