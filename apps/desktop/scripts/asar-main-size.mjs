import { readFileSync } from "node:fs";

const asar = process.argv[2];
const buf = readFileSync(asar);
const header = JSON.parse(buf.slice(16, 16 + buf.readUInt32LE(4)).toString("utf8"));
const key = Object.keys(header.files).find((f) => f.endsWith("out/main/index.js"));
if (!key) {
  console.log(JSON.stringify({ error: "main index not found", sample: Object.keys(header.files).slice(0, 10) }));
  process.exit(1);
}
console.log(JSON.stringify({ path: key, size: header.files[key].size, unpacked: header.files[key].unpacked ?? false }));
