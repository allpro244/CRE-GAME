// Export a generated city for Unreal ("bw-city/1"): the parcel table, every
// building volume, and the ground layers, in Unreal units.
//
//   node unreal/tools/export-city.mjs [--size metro] [--seed N] [--out file.json]
//
// The conversion itself lives in broadway-and-wall/src/citygen/unrealExport.mjs,
// shared with the web app's Unreal host mode, so a city exported here and one
// the game sends over the bridge are the same city.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BW = join(HERE, "..", "..", "broadway-and-wall");
const { makeCity, PROCEDURAL, REFERENCE_SEED } = await import(pathToFileURL(join(BW, "src", "citygen", "index.mjs")).href);
const { toBwCity } = await import(pathToFileURL(join(BW, "src", "citygen", "unrealExport.mjs")).href);

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const size = arg("--size", "metro");
const seed = Number(arg("--seed", REFERENCE_SEED));
const out = arg("--out", join(HERE, "..", "BroadwayWall", "Data", `city-${seed}-${size}.json`));

const doc = toBwCity(makeCity(PROCEDURAL, seed, { size }));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(doc));
const { minX, maxX, minY, maxY } = doc.bounds;
const km = (v) => (v / 100000).toFixed(2);
console.log(`${doc.city.name} (${size}, seed ${seed}): ${doc.parcels.length} parcels, ${doc.volumes.length} volumes, ${doc.trees.length / 2} trees, ${km(maxX - minX)} x ${km(maxY - minY)} km -> ${out}`);
