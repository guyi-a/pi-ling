import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pngToIco from "png-to-ico";
import { PNG } from "pngjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const assetsDir = join(root, "assets");

function stripWhiteCorners(pngBuffer) {
  const png = PNG.sync.read(pngBuffer);
  let changed = 0;
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const idx = (png.width * y + x) << 2;
      const r = png.data[idx];
      const g = png.data[idx + 1];
      const b = png.data[idx + 2];
      if (r === 255 && g === 255 && b === 255) {
        png.data[idx + 3] = 0;
        changed += 1;
      }
    }
  }
  return { buffer: PNG.sync.write(png), changed };
}

function generateFromSource(sourceName, outputName) {
  const sourcePath = join(assetsDir, sourceName);
  const outputPath = join(assetsDir, outputName);
  const source = readFileSync(sourcePath);
  const { buffer, changed } = stripWhiteCorners(source);
  writeFileSync(outputPath, buffer);
  console.log(`Wrote ${outputPath} (${changed} corner pixels transparent)`);
  return buffer;
}

const iconPng = generateFromSource("icon-source.png", "icon.png");
const ico = await pngToIco(iconPng);
writeFileSync(join(assetsDir, "icon.ico"), ico);
console.log(`Wrote ${ico.length} bytes to assets/icon.ico`);
