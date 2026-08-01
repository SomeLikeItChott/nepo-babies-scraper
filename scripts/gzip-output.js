import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(__dirname, "..", "output", "nepo-babies.json");
const destination = path.join(__dirname, "..", "output", "nepo-babies.json.gz");

const raw = readFileSync(source, "utf8");
writeFileSync(destination, gzipSync(raw));

console.log(`Compressed ${source} -> ${destination}`);
