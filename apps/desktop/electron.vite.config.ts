import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
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
  },
});
