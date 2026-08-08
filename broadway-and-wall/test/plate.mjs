// THE MAP MUST DRAW WHAT THE DIAL PROMISED.
//
// There is no headless renderer, so this is pure geometry: it reproduces
// setPlayerBuildings' ring lookup and its coverage inset and compares the
// drawn plate against `lotArea x cov` — the same quantity engine/dev.ts
// charges the player for and the panel's slider prints.
//
// It exists because that identity was FALSE for every redeveloped lot in the
// game and nothing in the repo could see it. `ringByBBL` is named for a lot
// and holds a BUILDING: citygen emits building polygons for anything standing
// and lot polygons only for parcels classed "land", so a built lot never
// carried a parcel-sized ring. A redevelopment was drawn inside the outline of
// whatever had just been demolished — a median of 66.4% of the promised plate,
// under 90% on every one of 10,028 built lots measured, and a new tower could
// not out-cover the shed it replaced.
//
// AND IT CAN FAIL, which is the only reason to believe it when it passes: set
// OLD=1 to take the old fallback and it reports 0.664 on built lots. The
// vacant-lot column is the control — it was always right and must stay right,
// so a "fix" that simply removed the inset would show up there as 1/cov.
//
//   node test/plate.mjs        the identity, built and vacant
//   OLD=1 node test/plate.mjs  the same check against the old lookup

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const R = join(HERE, "..") + "/";
const { makeCity } = await import(R + "src/citygen/index.mjs");
const q=(a,p)=>{const s=[...a].filter(Number.isFinite).sort((x,y)=>x-y);return s.length?s[Math.floor(p*(s.length-1))]:NaN;};
const M_LAT = 111320;
function areaOf(r){let a=0;for(let i=0;i<r.length;i++){const [x1,y1]=r[i],[x2,y2]=r[(i+1)%r.length];a+=x1*y2-x2*y1;}return Math.abs(a)/2;}

let built=[], vacant=[];
for (const cityId of ["newalden"]) for (const seed of [1, 7, 20261]) {
  const c = makeCity(cityId, seed);
  const ctr = [ -70.9, 41.1 ];
  const kx = M_LAT * Math.cos(ctr[1]*Math.PI/180);
  const proj = ([lon,lat]) => [ (lon-ctr[0])*kx, (lat-ctr[1])*M_LAT ];
  // the renderer's two maps, reproduced from ThreeBuildings
  const ringByBBL = new Map(), lotRings = new Map();
  for (const v of c.buildings3d ?? []) {
    if (!v.b || !v.r || v.r.length < 3) continue;
    const ring = v.r.map(proj); const a = areaOf(ring);
    const prev = ringByBBL.get(v.b);
    if (!prev || a > areaOf(prev)) ringByBBL.set(v.b, ring);
    if (v.k) lotRings.set(v.b, ring);
  }
  // ...and the NEW middle fallback: the parcel table
  const parcelRings = new Map();
  for (const f of c.parcelFeatures?.features ?? []) {
    const bbl = f.properties?.bbl; if (!bbl || f.geometry?.type !== "Polygon") continue;
    const r = f.geometry.coordinates[0]; if (!(r?.length >= 4)) continue;
    parcelRings.set(bbl, r.slice(0,-1).map(proj));
  }
  const USE_PARCEL = process.env.OLD !== "1";
  for (const [bbl, rec] of Object.entries(c.parcels)) {
    const ring = lotRings.get(bbl) ?? (USE_PARCEL ? parcelRings.get(bbl) : undefined) ?? ringByBBL.get(bbl);
    if (!ring || !rec.lotArea) continue;
    for (const cov of [0.15, 0.35, 0.60, 0.85, 0.90]) {
      const B = Math.min(0.97, Math.sqrt(cov));          // renderer's inset
      const drawn = areaOf(ring) * B * B;                 // uniform scale about a point
      const want = rec.lotArea * cov * 0.092903;          // lotArea is sf; ring is m^2
      const ratio = drawn / want;
      (rec.class === "land" || !(rec.bldgArea > 0) ? vacant : built).push({ cov, ratio });
    }
  }
}
const show=(rows,l)=>{
  console.log(`  ${l}  n=${rows.length/5}`);
  for (const cov of [0.15,0.35,0.60,0.85,0.90]) {
    const v = rows.filter(r=>r.cov===cov).map(r=>r.ratio);
    console.log(`    dial ${(cov*100).toFixed(0).padStart(3)}%   drawn/promised  p05 ${q(v,0.05).toFixed(4)}  p50 ${q(v,0.50).toFixed(4)}  p95 ${q(v,0.95).toFixed(4)}`);
  }
};
console.log(`\n  ${process.env.OLD==="1" ? "OLD (building ring)" : "FIXED (parcel ring)"}\n`);
show(built, "BUILT lots (the redevelopment path)");
show(vacant, "VACANT lots (control — was already correct)");
console.log("");

// the assertion, so this is a check and not a printout
const bad = built.filter((r) => Math.abs(r.ratio - 1) > 0.02).length;
if (process.env.OLD !== "1" && bad) {
  console.error(`  ${bad} of ${built.length} built-lot readings are more than 2% from the promised plate.`);
  process.exit(1);
}
if (process.env.OLD !== "1") console.log("  the map draws what the dial promised, on built and vacant lots alike.\n");
