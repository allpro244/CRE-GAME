// Generate one of pipeline/cities.mjs into pipeline/raw/, then report.
//
//   node pipeline/build-city.mjs kestrel
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
import { CITIES } from "./cities.mjs";
import { generateCity } from "./lib/citygen.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const RAW = join(ROOT, "raw");

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const all = args.includes("--all");
const names = all ? Object.keys(CITIES) : args.filter((a) => !a.startsWith("--"));
if (!names.length) {
  console.error(`usage: node pipeline/build-city.mjs <${Object.keys(CITIES).join("|")}> [--dry]`);
  process.exit(1);
}

for (const name of names) {
  const cfg = CITIES[name];
  if (!cfg) { console.error(`unknown city: ${name}`); process.exit(1); }
  const t0 = Date.now();
  const city = generateCity(cfg);
  const s = city.stats;
  const cov = s.coverage;

  console.log(`\n${cfg.name} (${name})  ${Date.now() - t0} ms`);
  console.log(`  ${s.lots} lots on ${s.blocks} blocks (${s.unbuiltPct}% unbuilt), ${s.buildings} buildings`);
  console.log(`  districts: ${Object.entries(s.byDistrict).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  console.log(`  COVERAGE ${cov.pct.toFixed(2)}%  of ${(cov.landM2 / 1e6).toFixed(2)} km2 buildable` +
    (cov.voidM2 ? `  — ${(cov.voidM2 / 1e3).toFixed(0)}k m2 bare` : "  — no bare ground"));
  if (cov.voids.length) {
    // where the holes are, so a bad cut is findable instead of hunted for
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
