// Normalize raw source data (real or synthetic) into the game's data files:
//   public/data/<city>/parcels.json.gz   — attribute table keyed by BBL
//   public/data/<city>/adjacency.json.gz — BBL -> neighbouring BBLs
//   public/data/<city>/{stations,manifest}.json, context.geojson
//   public/data/<city>/buildings3d.json.gz — the mesh feed
//   pipeline/out/{parcels,buildings}.geojson — inputs for tiles.mjs
//
// THE WORK ITSELF LIVES IN src/citygen/build.mjs. This file used to be four
// hundred lines of computation wrapped in reads and writes, which meant the
// only way to get a city was to run Node and write a directory — and that is
// exactly why the game shipped two cities instead of making one per run. The
// computation is a pure function now; this is the part that touches disk, and
// it is kept because the pre-baked cities are still what the test harnesses
// read and what a plain static host serves.
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCityData } from "../src/citygen/build.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const RAW = join(ROOT, "raw");
const OUT = join(ROOT, "out");
// Per-city output: the app serves several cities side by side, each in its own
// directory under public/data/. BW_CITY_DIR names it; unset writes flat.
const PUB = join(ROOT, "out", "data", process.env.BW_CITY_DIR ?? "");
mkdirSync(OUT, { recursive: true });
mkdirSync(PUB, { recursive: true });

const read = (f) => JSON.parse(readFileSync(join(RAW, f), "utf8"));
if (!existsSync(join(RAW, "parcels.geojson"))) {
  console.error("No raw data found. Run `node pipeline/build-city.mjs <city>` (or fetch.mjs / synth.mjs) first.");
  process.exit(1);
}

const out = buildCityData({
  rawParcels: read("parcels.geojson"),
  rawBuildings: read("buildings.geojson"),
  rawStations: read("stations.geojson"),
  manifest: read("manifest.json"),
  employment: existsSync(join(RAW, "employment.geojson")) ? read("employment.geojson") : null,
});

// the two big payloads ship gzipped; the app inflates via DecompressionStream
writeFileSync(join(PUB, "parcels.json.gz"), gzipSync(JSON.stringify(out.parcels), { level: 9 }));
writeFileSync(join(PUB, "adjacency.json.gz"), gzipSync(JSON.stringify(out.adjacency), { level: 9 }));
for (const f of ["parcels.json", "adjacency.json"]) rmSync(join(PUB, f), { force: true });
writeFileSync(join(PUB, "stations.json"), JSON.stringify(out.stations));
if (existsSync(join(RAW, "context.geojson")))
  writeFileSync(join(PUB, "context.geojson"), readFileSync(join(RAW, "context.geojson")));
writeFileSync(join(PUB, "manifest.json"), JSON.stringify(out.manifest, null, 2));
writeFileSync(join(OUT, "parcels.geojson"), JSON.stringify(out.tileParcels));
writeFileSync(join(OUT, "buildings.geojson"), JSON.stringify(out.tileBuildings));
writeFileSync(join(PUB, "buildings3d.json.gz"), gzipSync(JSON.stringify(out.buildings3d), { level: 9 }));

const s = out.stats;
console.log(`  ${s.stacked} buildings got stacked massing over ${s.tiersTotal} volumes: ${JSON.stringify(s.shapes)}`);
console.log(`  buildings3d.json.gz: ${out.buildings3d.length} volumes for the mesh renderer`);
console.log(`  Processed ${s.lots} lots (${s.withNeighbours} with neighbors, ${s.edges} edges, `
  + `avg ${(s.lots ? (2 * s.edges) / s.lots : 0).toFixed(1)}/lot), ${s.buildings} buildings (${s.heightsImputed} heights imputed).`);
