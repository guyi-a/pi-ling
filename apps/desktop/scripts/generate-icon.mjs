import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pngToIco = (await import("png-to-ico")).default;
const png = readFileSync(join(root, "assets/icon.png"));
const ico = await pngToIco(png);
writeFileSync(join(root, "assets/icon.ico"), ico);
console.log(`Wrote ${ico.length} bytes to assets/icon.ico`);
