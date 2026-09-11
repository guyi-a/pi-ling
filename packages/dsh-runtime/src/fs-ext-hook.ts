import { registerHooks } from "node:module";
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
      const resolveParent = process.env["PI_LING_DSH_RESOLVE_PARENT"]?.trim();
      if (!resolveParent || !specifier.startsWith("@deepseek-ai/")) {
        throw error;
      }
      return nextResolve(specifier, {
        ...context,
        parentURL: pathToFileURL(resolveParent).href,
      });
    }
  },
});
