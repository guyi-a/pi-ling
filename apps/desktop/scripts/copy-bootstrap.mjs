import { copyFileSync, cpSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const outDir = join(root, "../out/main");
const catalogDir = join(outDir, "catalog");
mkdirSync(catalogDir, { recursive: true });
copyFileSync(
  join(root, "../src/main/bootstrap.cjs"),
  join(outDir, "bootstrap.cjs"),
);
copyFileSync(
  join(root, "../../../packages/coding-eval/catalog/catalog.json"),
  join(catalogDir, "catalog.json"),
);

const dshRuntimeDist = join(root, "../../../packages/dsh-runtime/dist");
for (const file of [
  "fs-ext-hook.js",
  "fs-ext-shim.js",
  "dsh-approval-policy.js",
]) {
  copyFileSync(join(dshRuntimeDist, file), join(outDir, file));
}

const dshTranscriptDist = join(root, "../../../packages/dsh-transcript/dist");
const dshTranscriptOut = join(outDir, "dsh-transcript");
mkdirSync(dshTranscriptOut, { recursive: true });
for (const file of readdirSync(dshTranscriptDist)) {
  if (file.endsWith(".js") || file.endsWith(".js.map")) {
    copyFileSync(join(dshTranscriptDist, file), join(dshTranscriptOut, file));
  }
}
