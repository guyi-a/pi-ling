import { createRequire, registerHooks } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const shimUrl = new URL("./fs-ext-shim.js", import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (process.platform === "win32" && specifier === "fs-ext") {
      return { url: shimUrl, shortCircuit: true };
    }
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      const moduleRoot = process.env["PI_LING_DSH_MODULE_ROOT"];
      if (!moduleRoot || !specifier.startsWith("@deepseek-ai/")) throw error;
      const require = createRequire(join(moduleRoot, "__resolver.cjs"));
      return {
        url: pathToFileURL(require.resolve(specifier)).href,
        shortCircuit: true,
      };
    }
  },
});
