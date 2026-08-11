// Build sample generated islands into public/data/<seed>/ plus the picker index.
//
//   node pipeline/build-all.mjs            sample seeds
//   node pipeline/build-all.mjs 550991     just one (still into its subdir)
//
// Each city runs the same three stages the single-city pipeline does —
// generate → process → tiles — with BW_CITY_DIR pointing the output at the
// city's own directory. The index (cities.json) is what the in-game picker
// reads; a city that fails to build simply doesn't appear in it.
//
// NOTE: the live game generates in-browser and does not read public/data/.
// This pipeline is for offline tile builds and diagnostics only.
import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { islandConfig } from "../src/citygen/island.mjs";
import { REFERENCE_SEED } from "../src/citygen/index.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUB = join(ROOT, "out", "data");
mkdirSync(PUB, { recursive: true });

const SAMPLE_SEEDS = [REFERENCE_SEED, 20261, 481923, 550991, 73303];

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const wanted = args.length
  ? args.map((s) => Number(s) >>> 0).filter(Boolean)
  : SAMPLE_SEEDS;

const built = [];
for (const seed of wanted) {
  const cfg = islandConfig(seed);
  const id = String(seed);
  console.log(`\n=== ${cfg.name} (seed ${seed})`);
  const env = { ...process.env, BW_CITY_DIR: id, BW_CITY_SEED: String(seed) };
  for (const step of [
    ["node", [join(ROOT, "build-city.mjs"), String(seed)]],
    ["node", [join(ROOT, "process.mjs")], env],
    ["node", [join(ROOT, "tiles.mjs")], env],
  ]) {
    const [cmd, stepArgs, e] = step;
    const r = spawnSync(cmd, stepArgs, { stdio: ["ignore", "pipe", "inherit"], env: e ?? process.env });
    if (r.status !== 0) { console.error(`${id}: ${stepArgs[0]} failed`); process.exit(1); }
    const out = r.stdout.toString().trim().split("\n");
    for (const line of out) if (/COVERAGE|lots on|pmtiles|Processed/.test(line)) console.log("  " + line.trim());
  }
  const manifest = JSON.parse(readFileSync(join(PUB, id, "manifest.json"), "utf8"));
  built.push({ id, name: cfg.name, tagline: `Generated island, seed ${seed}.`, lots: manifest.lots });
}

built.sort((a, b) => Number(a.id) - Number(b.id));
writeFileSync(join(PUB, "cities.json"), JSON.stringify(built, null, 2));
console.log(`\ncities.json: ${built.map((c) => c.id).join(", ")}`);
