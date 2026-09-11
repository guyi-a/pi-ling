import path from "node:path";
import { fileURLToPath } from "node:url";
import { readdir } from "node:fs/promises";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
console.log("workspace root:", root);

// Simulate what TreeNode passes: a child dir path like "apps/" or "apps/desktop/"
async function tryDir(subpath) {
  const base = path.resolve(root);
  const target = base === path.resolve(base, subpath) && subpath === ""
    ? base
    : path.resolve(base, subpath);
  const relative = path.relative(base, target);
  console.log(`\nsubpath="${subpath}" -> target="${target}" relative="${relative}"`);
  if (relative !== "" && (relative.startsWith("..") || path.isAbsolute(relative))) {
    console.log("  ! PATH ESCAPE");
    return;
  }
  try {
    const entries = await readdir(target, { withFileTypes: true });
    console.log("  entries:", entries.length, "->", entries.slice(0, 5).map(e => e.name).join(", "));
  } catch (e) {
    console.log("  readdir error:", e.code, e.message);
  }
}

await tryDir("");
await tryDir("apps");
await tryDir("apps/");
await tryDir("packages/");
await tryDir("apps/desktop");
