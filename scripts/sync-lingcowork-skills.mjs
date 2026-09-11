#!/usr/bin/env node
import { cp, mkdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BUILTIN_SKILLS = [
  "pdf",
  "pptx",
  "docx",
  "browser-use",
  "browser-bridge",
  "bosszp",
];

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");

function parseArgs(argv) {
  let workspace = repoRoot;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--workspace" && argv[index + 1]) {
      workspace = resolve(argv[index + 1]);
      index += 1;
    }
  }
  return { workspace };
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const { workspace } = parseArgs(process.argv.slice(2));
  const lingcoworkRoot = resolve(
    process.env.PI_LING_LINGCOWORK_PATH ?? join(repoRoot, "..", "LingCoWork"),
  );
  const sourceRoot = join(lingcoworkRoot, "data", "skills", "builtin");
  const targetRoot = join(workspace, ".agents", "skills");

  if (!(await exists(sourceRoot))) {
    console.error(`LingCoWork skills not found: ${sourceRoot}`);
    console.error("Set PI_LING_LINGCOWORK_PATH to your LingCoWork checkout.");
    process.exit(1);
  }

  await mkdir(targetRoot, { recursive: true });

  for (const name of BUILTIN_SKILLS) {
    const source = join(sourceRoot, name);
    const target = join(targetRoot, name);
    if (!(await exists(source))) {
      console.error(`Missing skill source: ${source}`);
      process.exit(1);
    }
    await rm(target, { recursive: true, force: true });
    await cp(source, target, { recursive: true, force: true });
    console.log(`synced ${name}`);
  }

  console.log(`skills copied to ${targetRoot}`);
}

await main();
