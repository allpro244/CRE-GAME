// IS THIS FILE A "bw-city/1"?
//
//   node test/bwcity-contract.mjs file.json
//
// The shape unreal/BroadwayWall/Source/BroadwayWall/CityData.cpp parses
// (citygen/unrealExport.mjs toBwCity writes it): centimetres as integers,
// flat unclosed rings, ground layers the builder has materials for, volumes
// whose deed is a parcel in the file, centrelines with a carriageway width.
// Exits 1 naming the first faults.
import { readFileSync } from "node:fs";

const file = process.argv[2];
const d = JSON.parse(readFileSync(file, "utf8"));
const faults = [];
const bad = (m) => { if (faults.length < 40) faults.push(m); };
const KNOWN_GROUND = new Set(["land", "beach", "marsh", "rock", "esplanade", "paveland", "apron", "pavement", "median", "sidewalk", "block", "park", "pond", "stream", "farm", "woods", "yard"]);
let closed = 0;
const isInt = (v) => Number.isInteger(v);
const ringOk = (r, what) => {
  if (!Array.isArray(r) || r.length % 2 || r.length < 6) return bad(`${what}: ring of ${r?.length} numbers`);
  for (const v of r) if (!isInt(v)) return bad(`${what}: non-integer coordinate ${v}`);
  // (the island export has always sent some massing tiers closed; the parser tolerates it, so this is counted, not failed)
  if (r[0] === r.at(-2) && r[1] === r.at(-1)) closed++;
};

if (d.format !== "bw-city/1") bad(`format ${d.format}`);
for (const k of ["city", "origin", "bounds", "parcels", "volumes", "water", "ground", "trees", "labels", "markings", "benches"]) if (!(k in d)) bad(`missing ${k}`);
for (const k of ["id", "seed", "size", "name", "lots"]) if (!(k in (d.city ?? {}))) bad(`city.${k} missing`);
if (d.city?.lots !== d.parcels?.length) bad(`city.lots ${d.city?.lots} != parcels ${d.parcels?.length}`);
for (const k of ["minX", "maxX", "minY", "maxY"]) if (!Number.isFinite(d.bounds?.[k])) bad(`bounds.${k}`);
const bbls = new Set();
for (const p of d.parcels ?? []) {
  for (const k of ["bbl", "address", "district", "zone", "cls", "floors", "yearBuilt", "lotArea", "bldgArea", "ring"]) if (!(k in p)) { bad(`parcel ${p.bbl} lacks ${k}`); break; }
  if (bbls.has(p.bbl)) bad(`duplicate parcel ${p.bbl}`);
  bbls.add(p.bbl);
  if (!(p.lotArea > 0)) bad(`parcel ${p.bbl} lotArea ${p.lotArea}`);
  if (p.bldgArea < 0 || !Number.isFinite(p.bldgArea)) bad(`parcel ${p.bbl} bldgArea ${p.bldgArea}`);
  ringOk(p.ring, `parcel ${p.bbl}`);
}
const decos = {};
for (const v of d.volumes ?? []) {
  for (const k of ["bbl", "cls", "year", "z0", "z1", "deco", "crown", "vacant", "ring"]) if (!(k in v)) { bad(`volume lacks ${k}`); break; }
  if (!(v.z1 >= v.z0)) bad(`volume ${v.bbl} z1 ${v.z1} < z0 ${v.z0}`);
  if (v.bbl && !bbls.has(v.bbl)) bad(`volume names unknown parcel ${v.bbl}`);
  decos[v.deco || "(building)"] = (decos[v.deco || "(building)"] ?? 0) + 1;
  ringOk(v.ring, `volume ${v.bbl}`);
}
const layers = Object.keys(d.ground ?? {});
for (const k of layers) { if (!KNOWN_GROUND.has(k)) bad(`unknown ground layer ${k}`); for (const r of d.ground[k]) ringOk(r, `ground ${k}`); }
if (d.trees.length % 2) bad("trees not pairs");
let zeroW = 0;
for (const c of d.markings?.centerlines ?? []) { if (!isInt(c.w) || c.w < 0) bad(`centerline w ${c.w}`); if (c.w === 0) zeroW++; if (c.line.length < 4 || c.line.length % 2) bad("centerline line"); }
for (const l of d.labels ?? []) if (!l.name || !Array.isArray(l.at) || l.at.length !== 2) bad(`label ${l.name}`);

const counts = Object.fromEntries(layers.map((k) => [k, d.ground[k].length]));
const tenure = {}; for (const p of d.parcels) if (p.tenure) tenure[p.tenure] = (tenure[p.tenure] ?? 0) + 1;
console.log(`${file}: ${d.city?.name} (${d.city?.size}), ${d.parcels.length} parcels (reserved ${JSON.stringify(tenure)}), ${d.volumes.length} volumes ${JSON.stringify(decos)}, ${d.trees.length / 2} trees, ${d.markings.centerlines.length} centrelines`);
console.log(`  ground, in draw order: ${JSON.stringify(counts)}`);
console.log(`  tolerated, as the island export has always sent them: ${closed} closed rings, ${zeroW} zero-width lane centrelines`);
console.log(`  bounds ${((d.bounds.maxX - d.bounds.minX) / 1e5).toFixed(2)} x ${((d.bounds.maxY - d.bounds.minY) / 1e5).toFixed(2)} km`);
if (faults.length) { console.log("FAULTS:\n  " + faults.join("\n  ")); process.exit(1); }
console.log("  bw-city/1: OK");
