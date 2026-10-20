// Copy a surveyed City Sample kit (and exactly its dependency closure) into the
// game project, at the same /Game paths so every reference inside it holds.
// City Sample content is never committed (UE58_PLAN.md §2): this script plus
// unreal/kits/kit-<KIT>.json (from tools/kit-survey.py) rebuild it on any
// machine that has City Sample.
//
//   node unreal/tools/migrate-kit.mjs CHF [D:/Projects/CitySample]
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const kit = process.argv[2] ?? "CHF";
const sample = process.argv[3] ?? "D:/Projects/CitySample";
const survey = JSON.parse(readFileSync(join(HERE, "..", "kits", `kit-${kit}.json`), "utf8"));
const from = join(sample, "Content"), to = join(HERE, "..", "BroadwayWall", "Content");

let copied = 0, skipped = 0, bytes = 0;
for (const rel of survey.files) {
  const src = join(from, rel), dst = join(to, rel);
  if (!existsSync(src)) { console.warn("missing in City Sample:", rel); continue; }
  const s = statSync(src);
  if (existsSync(dst) && statSync(dst).size === s.size) { skipped++; continue; }
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  copied++; bytes += s.size;
}
console.log(`kit ${kit}: ${copied} files copied (${(bytes / 1e6).toFixed(0)} MB), ${skipped} already there -> ${to}`);
