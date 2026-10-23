// Layout audit: where things in a generated city overlap things they should
// not. Separates generator faults (the data) from placement faults (rules the
// Unreal builder applies on top: lamps, parked cars, traffic lanes).
//
//   node unreal/tools/audit-layout.mjs [city.json]
import { readFileSync } from "node:fs";

const path = process.argv[2] ?? "unreal/BroadwayWall/Data/city-1-metro.json";
const c = JSON.parse(readFileSync(path, "utf8"));
const pts = (flat) => { const o = []; for (let i = 0; i + 1 < flat.length; i += 2) o.push([flat[i], flat[i + 1]]); return o; };
const bbox = (r) => { let a = [1e18, 1e18, -1e18, -1e18]; for (const [x, y] of r) { a[0] = Math.min(a[0], x); a[1] = Math.min(a[1], y); a[2] = Math.max(a[2], x); a[3] = Math.max(a[3], y); } return a; };
const inside = (r, [x, y]) => { let s = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i][1] > y) !== (r[j][1] > y) && x < ((r[j][0] - r[i][0]) * (y - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) s = !s; return s; };

// spatial index of polygons
function index(polys) {
  const cell = 5000, grid = new Map();
  const items = polys.map((r) => ({ r, b: bbox(r) }));
  items.forEach((it, k) => {
    for (let gx = Math.floor(it.b[0] / cell); gx <= Math.floor(it.b[2] / cell); gx++)
      for (let gy = Math.floor(it.b[1] / cell); gy <= Math.floor(it.b[3] / cell); gy++) {
        const key = gx + "," + gy; (grid.get(key) ?? grid.set(key, []).get(key)).push(k);
      }
  });
  return (p) => { const ks = grid.get(Math.floor(p[0] / cell) + "," + Math.floor(p[1] / cell)) ?? []; return ks.some((k) => { const b = items[k].b; return p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3] && inside(items[k].r, p); }); };
}

const buildings = c.volumes.filter((v) => !v.vacant && !v.deco).map((v) => pts(v.ring));
const lots = c.parcels.map((p) => pts(p.ring)).filter((r) => r.length >= 3);
const inBuilding = index(buildings);
const g = (k) => (c.ground[k] ?? []).map(pts);
// the roadway: paved, but outside every sidewalk ring (whose outer ring includes its block)
const inPaved = index([...g("pavement"), ...g("paveland")]);
const inSidewalkOuter = index(g("sidewalk"));
const inGreen = index([...g("park"), ...g("median"), ...g("esplanade")]);
const inStreet = (p) => inPaved(p) && !inSidewalkOuter(p) && !inGreen(p);
const inSidewalk = index(g("sidewalk"));
const inPark = index(g("park"));
// the sea polygon has the island as a hole, which the export drops; ponds and streams are real water
const inWater = index([...g("pond"), ...g("stream")]);
const inLot = index(lots);

const pct = (n, d) => d ? `${n} / ${d} (${((100 * n) / d).toFixed(1)}%)` : "0";
const sampleRing = (r, step) => { const o = []; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); for (let s = 0; s < L; s += step) o.push([a[0] + ((b[0] - a[0]) * s) / L, a[1] + ((b[1] - a[1]) * s) / L]); } return o; };
const centroid = (r) => r.reduce((a, p) => [a[0] + p[0] / r.length, a[1] + p[1] / r.length], [0, 0]);

console.log(`\nLAYOUT AUDIT — ${c.city.name} (${c.city.size}), ${c.parcels.length} lots, ${buildings.length} building volumes\n`);
console.log("GENERATOR (the data itself)");
// building footprints reaching into the street / park / water: sample points just inside each footprint
let bS = 0, bP = 0, bW = 0, bn = 0;
for (const r of buildings) {
  const [cx, cy] = centroid(r);
  const ps = sampleRing(r, 300).map(([x, y]) => [x + (cx - x) * 0.04, y + (cy - y) * 0.04]);
  bn++;
  if (ps.some(inStreet)) bS++;
  if (ps.some(inPark)) bP++;
  if (ps.some(inWater)) bW++;
}
console.log("  buildings reaching into the street     ", pct(bS, bn));
console.log("  buildings reaching into a park         ", pct(bP, bn));
console.log("  buildings reaching into water          ", pct(bW, bn));
const trees = pts(c.trees);
console.log("  trees inside a building                ", pct(trees.filter(inBuilding).length, trees.length));
console.log("  trees in the roadway                   ", pct(trees.filter(inStreet).length, trees.length));
let clB = 0, clN = 0;
for (const cl of c.markings?.centerlines ?? []) { const ps = sampleRing(pts(cl.line), 400); clN += ps.length; clB += ps.filter(inBuilding).length; }
console.log("  centreline samples inside buildings    ", pct(clB, clN));
let clL = 0;
for (const cl of c.markings?.centerlines ?? []) clL += sampleRing(pts(cl.line), 400).filter(inLot).length;
console.log("  centreline samples inside lots         ", pct(clL, clN));

console.log("\nUNREAL PLACEMENT (rules on top of the data)");
// replicate the lamp / kerb-car rule: every sidewalk edge >= 15 m, outward normal
let lampB = 0, lampN = 0, carB = 0, carS = 0, carN = 0;
for (const r of g("sidewalk")) {
  const n = r.length; if (n < 3) continue;
  let a2 = 0; for (let i = 0; i < n; i++) a2 += r[i][0] * r[(i + 1) % n][1] - r[(i + 1) % n][0] * r[i][1];
  for (let i = 0; i < n; i++) {
    const A = r[i], B = r[(i + 1) % n], L = Math.hypot(B[0] - A[0], B[1] - A[1]); if (L < 1500) continue;
    const d = [(B[0] - A[0]) / L, (B[1] - A[1]) / L], out = a2 > 0 ? [d[1], -d[0]] : [-d[1], d[0]];
    const cnt = Math.max(1, Math.floor(L / 2500));
    for (let k = 0; k < cnt; k++) { const s = (L * (k + 0.5)) / cnt; const p = [A[0] + d[0] * s - out[0] * 70, A[1] + d[1] * s - out[1] * 70]; lampN++; if (inBuilding(p)) lampB++; }
    for (let s = 900; s < L - 900; s += 650) { const p = [A[0] + d[0] * s + out[0] * 230, A[1] + d[1] * s + out[1] * 230]; carN++; if (inBuilding(p) || inLot(p)) carB++; if (!inStreet(p)) carS++; }
  }
}
console.log("  street lamps inside a building         ", pct(lampB, lampN));
console.log("  kerb-parking spots inside a building/lot", pct(carB, carN));
console.log("  kerb-parking spots not on the roadway  ", pct(carS, carN));
