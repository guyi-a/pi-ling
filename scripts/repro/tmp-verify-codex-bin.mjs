import { pathToFileURL } from "node:url";
const mod = await import(pathToFileURL("C:/Users/ASUS/AppData/Local/Programs/pi-ling/resources/app.asar/node_modules/@pi-ling/codex-runtime/dist/codex-bin.js").href);
console.log("bin", mod.resolveBundledCodexBin());
