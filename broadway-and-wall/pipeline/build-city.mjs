// Generate a procedural island into pipeline/raw/, then report.
//
//   node pipeline/build-city.mjs 550991
//   node pipeline/build-city.mjs --all --dry     (coverage only, writes nothing)
//
// The number that matters is COVERAGE: the share of buildable land that is
// under a block cell, a park, or a park's frontage road. Anything else is bare
// ground. The district partition guarantees the interior is covered, so what
// is left is the fringe between the last block and the waterline — the four
// districts tile the land, but a convex cell can only approximate a curved
// shore. Expect 96-99%; anything materially below that is a bad cut, and the
// bare patches are listed with coordinates so it can be found rather than
// hunted for. `pipeline/plan.mjs` draws the same misses in red.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { islandConfig } from "../src/citygen/island.mjs";
import { generateCity } from "../src/citygen/citygen.mjs";
import { REFERENCE_SEED } from "../src/citygen/index.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const RAW = join(ROOT, "raw");

const SAMPLE_SEEDS = [REFERENCE_SEED, 20261, 481923, 550991, 73303];

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const all = args.includes("--all");
const seeds = all
  ? SAMPLE_SEEDS
  : args.filter((a) => !a.startsWith("--")).map((s) => Number(s) >>> 0).filter(Boolean);
if (!seeds.length) {
  console.error(`usage: node pipeline/build-city.mjs <seed> [seed…] [--dry]  or  --all`);
  process.exit(1);
}

for (const seed of seeds) {
  const cfg = islandConfig(seed);
  const t0 = Date.now();
  const city = generateCity({ ...cfg, seed });
  const s = city.stats;
  const cov = s.coverage;

  console.log(`\n${cfg.name} (seed ${seed})  ${Date.now() - t0} ms`);
  console.log(`  ${s.lots} lots on ${s.blocks} blocks (${s.unbuiltPct}% unbuilt), ${s.buildings} buildings`);
  console.log(`  districts: ${Object.entries(s.byDistrict).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  console.log(`  COVERAGE ${cov.pct.toFixed(2)}%  of ${(cov.landM2 / 1e6).toFixed(2)} km2 buildable` +
    (cov.voidM2 ? `  — ${(cov.voidM2 / 1e3).toFixed(0)}k m2 bare` : "  — no bare ground"));
  if (cov.voids.length) {
    const clusters = [];
    for (const p of cov.voids) {
      const near = clusters.find((c) => Math.hypot(c.x / c.n - p[0], c.y / c.n - p[1]) < 90);
      if (near) { near.x += p[0]; near.y += p[1]; near.n++; }
      else clusters.push({ x: p[0], y: p[1], n: 1 });
    }
    clusters.sort((a, b) => b.n - a.n);
    console.log(`  ${clusters.length} bare patches; biggest: ` +
      clusters.slice(0, 5).map((c) => `${(c.n / 10).toFixed(1)}k m2 @ ${Math.round(c.x / c.n)},${Math.round(c.y / c.n)}`).join("; "));
  }
  if (Object.keys(s.reject).length) console.log(`  rejections: ${JSON.stringify(s.reject)}`);

  if (!dry) {
    mkdirSync(RAW, { recursive: true });
    writeFileSync(join(RAW, "parcels.geojson"), JSON.stringify(city.parcels));
    writeFileSync(join(RAW, "buildings.geojson"), JSON.stringify(city.buildings));
    writeFileSync(join(RAW, "stations.geojson"), JSON.stringify(city.stations));
    writeFileSync(join(RAW, "employment.geojson"), JSON.stringify(city.employment));
    writeFileSync(join(RAW, "context.geojson"), JSON.stringify(city.context));
    writeFileSync(join(RAW, "manifest.json"), JSON.stringify(city.manifest, null, 2));
    console.log(`  -> pipeline/raw/  (run process.mjs && tiles.mjs)`);
  }
}
