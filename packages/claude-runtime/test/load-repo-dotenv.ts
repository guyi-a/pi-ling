import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function loadRepoDotenv(): void {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const envPath = resolve(root, ".env");
  try {
    const text = readFileSync(envPath, "utf8");
    for (const line of text.split(/\r?\n/u)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator <= 0) continue;
      const key = trimmed.slice(0, separator).trim();
      const rawValue = trimmed.slice(separator + 1).trim();
      const value =
        (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
        (rawValue.startsWith("'") && rawValue.endsWith("'"))
          ? rawValue.slice(1, -1)
          : rawValue;
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {
    // Optional local .env
  }
}
