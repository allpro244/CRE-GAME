// Export a generated city for Unreal: the parcel table, every building volume,
// and the ground layers, in Unreal units.
//
//   node unreal/tools/export-city.mjs [--size metro] [--seed N] [--out file.json]
//
// Units and axes (UE58_PLAN.md Phase 1): centimetres, origin at the centre of
// the city's bounding box, +X north, +Y east, +Z up — Unreal's left-handed
// frame with north "forward". Coordinates go back through the generator's own
// equirectangular projection (citygen/geom.mjs), so a metre here is the metre
// the generator built with. Rings are flat [x0,y0,x1,y1,...] integer arrays,
// unclosed.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BW = join(HERE, "..", "..", "broadway-and-wall");
const { makeCity, PROCEDURAL, REFERENCE_SEED } = await import(pathToFileURL(join(BW, "src", "citygen", "index.mjs")).href);
const { makeProjection } = await import(pathToFileURL(join(BW, "src", "citygen", "geom.mjs")).href);

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const size = arg("--size", "metro");
const seed = Number(arg("--seed", REFERENCE_SEED));
const out = arg("--out", join(HERE, "..", "BroadwayWall", "Data", `city-${seed}-${size}.json`));

const c = makeCity(PROCEDURAL, seed, { size });
const [w, s, e, n] = c.manifest.bbox;
const lon0 = (w + e) / 2, lat0 = (s + n) / 2;
const proj = makeProjection(lon0, lat0);
// lon/lat -> [X north, Y east] in cm
const ue = (ll) => { const [x, y] = proj.toXY(ll); return [Math.round(y * 100), Math.round(x * 100)]; };
const ring = (coords) => {
  const pts = coords.length > 1 && coords[0][0] === coords.at(-1)[0] && coords[0][1] === coords.at(-1)[1] ? coords.slice(0, -1) : coords;
  return pts.flatMap(ue);
};

// ---- parcels: the static half of the render contract
const parcelRing = new Map();
for (const f of c.parcelFeatures.features) if (f.geometry.type === "Polygon") parcelRing.set(String(f.properties.bbl), ring(f.geometry.coordinates[0]));
const parcels = Object.values(c.parcels).map((p) => ({
  bbl: p.bbl, address: p.address, block: p.block, district: p.district, districtName: p.districtName,
  zone: p.zoneDist, cls: p.class, floors: p.floors, yearBuilt: p.yearBuilt, lotArea: p.lotArea, bldgArea: p.bldgArea,
  ring: parcelRing.get(p.bbl) ?? [],
}));

// ---- volumes: one extruded prism per building tier (the web map's own feed)
const volumes = c.buildings3d.map((b) => ({
  bbl: b.b || "", cls: b.c, year: b.y, z0: Math.round(b.z0 * 100), z1: Math.round(b.z1 * 100),
  deco: b.d ? (b.dk ?? "deco") : "", crown: !!b.x, vacant: !!b.k, ring: b.r.flatMap(ue),
}));

// ---- ground layers, drawn flat in this order (later on top)
const GROUND = ["land", "beach", "marsh", "rock", "esplanade", "apron", "paveland", "pavement", "median", "sidewalk", "park", "pond", "stream"];
const ground = Object.fromEntries(GROUND.map((k) => [k, []]));
let water = [];
const trees = [], labels = [];
for (const f of c.context.features) {
  const k = f.properties?.kind, g = f.geometry;
  if (k === "shallows" && g.type === "Polygon") water.push(ring(g.coordinates[0]));
  else if (k in ground && g.type === "Polygon") ground[k].push(ring(g.coordinates[0]));
  else if (k in ground && g.type === "MultiPolygon") for (const p of g.coordinates) ground[k].push(ring(p[0]));
  else if (k === "tree" && g.type === "Point") trees.push(...ue(g.coordinates));
  else if (k === "label" && g.type === "Point") labels.push({ name: f.properties.name, kind: f.properties.labelKind, at: ue(g.coordinates) });
}

const all = volumes.flatMap((v) => v.ring);
let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
for (let i = 0; i < all.length; i += 2) { minX = Math.min(minX, all[i]); maxX = Math.max(maxX, all[i]); minY = Math.min(minY, all[i + 1]); maxY = Math.max(maxY, all[i + 1]); }

const doc = {
  format: "bw-city/1",
  city: { id: c.id, seed: c.seed, size: c.size, name: c.name, lots: parcels.length },
  origin: { lon: lon0, lat: lat0 },
  bounds: { minX, maxX, minY, maxY },
  parcels, volumes, water, ground, trees, labels,
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(doc));
const km = (v) => (v / 100000).toFixed(2);
console.log(`${c.name} (${size}, seed ${seed}): ${parcels.length} parcels, ${volumes.length} volumes, ${trees.length / 2} trees, ${km(maxX - minX)} x ${km(maxY - minY)} km -> ${out}`);
