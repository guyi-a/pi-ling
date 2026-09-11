import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import type { Plugin } from "vite";

const root = dirname(fileURLToPath(import.meta.url));

function copyBootstrapPlugin(): Plugin {
  return {
    name: "copy-bootstrap",
    closeBundle() {
      const result = spawnSync("node", ["scripts/copy-bootstrap.mjs"], {
        cwd: root,
        stdio: "inherit",
      });
      if (result.status !== 0) {
        throw new Error("copy-bootstrap.mjs failed");
      }
    },
  };
}

/** Bundled into main so Node 24 does not load workspace `src/*.ts` from node_modules. */
const bundledMainDeps = [
  "@agentclientprotocol/sdk",
  "@pi-ling/agent-core",
  "@pi-ling/coding-agent",
  "@pi-ling/coding-eval",
  "@pi-ling/codex-runtime",
  "@pi-ling/compaction",
  "@pi-ling/contracts",
  "@pi-ling/dsh-runtime",
  "@pi-ling/runtime-contracts",
  "@pi-ling/session-events",
  "zod",
];

export default defineConfig({
  main: {
    plugins: [copyBootstrapPlugin()],
    build: {
      externalizeDeps: {
        exclude: bundledMainDeps,
      },
      rollupOptions: {
        external: ["node-pty"],
        input: resolve(root, "src/main/index.ts"),
        output: {
          format: "es",
        },
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: resolve(root, "src/preload/index.ts"),
        output: {
          entryFileNames: "[name].cjs",
          format: "cjs",
        },
      },
    },
  },
  renderer: {
    root: resolve(root, "src/renderer"),
    plugins: [react()],
    optimizeDeps: {
      include: [
        "@shikijs/engine-javascript",
        "@shikijs/themes/github-light",
        "@shikijs/themes/github-dark",
        "@shikijs/langs/typescript",
      ],
    },
  },
});
