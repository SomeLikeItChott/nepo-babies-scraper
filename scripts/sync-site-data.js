import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(__dirname, "..", "output");
const publicDir = path.join(__dirname, "..", "site", "public");

const files = [
  { name: "films.json", command: "npm run scrape" },
  { name: "parents.json", command: "npm run scrape" },
  { name: "yearly-stats.json", command: "npm run scrape:yearly" },
];

for (const { name, command } of files) {
  const source = path.join(outputDir, name);
  if (!existsSync(source)) {
    console.error(`Missing ${source} — run \`${command}\` at least once before syncing site data.`);
    process.exitCode = 1;
    process.exit();
  }
}

mkdirSync(publicDir, { recursive: true });

for (const { name } of files) {
  copyFileSync(path.join(outputDir, name), path.join(publicDir, name));
  console.log(`Copied ${name} -> site/public/${name}`);
}
