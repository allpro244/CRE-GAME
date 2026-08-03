// Build EVERY city into public/data/<id>/ plus the picker index.
//
//   node pipeline/build-all.mjs            all six
//   node pipeline/build-all.mjs kestrel    just one (still into its subdir)
//
// Each city runs the same three stages the single-city pipeline does —
// generate → process → tiles — with BW_CITY_DIR pointing the output at the
// city's own directory. The index (cities.json) is what the in-game picker
// reads; a city that fails to build simply doesn't appear in it.
import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CITIES, TAGLINES } from "../src/citygen/cities.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUB = join(ROOT, "out", "data");
mkdirSync(PUB, { recursive: true });

const names = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const wanted = names.length ? names : Object.keys(CITIES);

const built = [];
for (const id of wanted) {
  if (!CITIES[id]) { console.error(`unknown city: ${id}`); process.exit(1); }
  console.log(`\n=== ${CITIES[id].name} (${id})`);
  const env = { ...process.env, BW_CITY_DIR: id };
  for (const step of [
    ["node", [join(ROOT, "build-city.mjs"), id]],
    ["node", [join(ROOT, "process.mjs")], env],
    ["node", [join(ROOT, "tiles.mjs")], env],
  ]) {
    const [cmd, args, e] = step;
    const r = spawnSync(cmd, args, { stdio: ["ignore", "pipe", "inherit"], env: e ?? process.env });
    if (r.status !== 0) { console.error(`${id}: ${args[0]} failed`); process.exit(1); }
    const out = r.stdout.toString().trim().split("\n");
    for (const line of out) if (/COVERAGE|lots on|pmtiles|Processed/.test(line)) console.log("  " + line.trim());
  }
  const manifest = JSON.parse(readFileSync(join(PUB, id, "manifest.json"), "utf8"));
  built.push({ id, name: CITIES[id].name, tagline: TAGLINES[id] ?? "", lots: manifest.lots });
}

// keep the index's order the order of CITIES, not the build order
built.sort((a, b) => Object.keys(CITIES).indexOf(a.id) - Object.keys(CITIES).indexOf(b.id));
writeFileSync(join(PUB, "cities.json"), JSON.stringify(built, null, 2));
console.log(`\ncities.json: ${built.map((c) => c.id).join(", ")}`);
