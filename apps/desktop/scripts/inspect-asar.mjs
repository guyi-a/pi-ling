import fs from "node:fs";

const asarPath = process.argv[2];
if (!asarPath) {
  console.error("usage: node inspect-asar.mjs <path-to-app.asar>");
  process.exit(1);
}

const buf = fs.readFileSync(asarPath);
const headerSize = buf.readUInt32LE(4);
const header = JSON.parse(buf.slice(16, 16 + headerSize).toString("utf8"));
const files = Object.keys(header.files);
const patterns = ["schema-deserialize", "node_modules/zod", "agentclientprotocol"];
for (const pattern of patterns) {
  const hits = files.filter((file) => file.includes(pattern));
  console.log(`\n${pattern} (${hits.length}):`);
  for (const hit of hits.slice(0, 15)) {
    console.log(`  ${hit}`);
  }
}
