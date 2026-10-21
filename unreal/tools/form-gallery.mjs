// A gallery of building forms, photographed in the game.
//   node unreal/tools/form-gallery.mjs [city.json] [forms.json] [looks.json]
// For each massing form the city generator knows (src/citygen/massing.mjs:
// courtyard, wedding cake, campanile, twins...), finds a real lot downtown on
// which that form can stand at a height it is built to, replaces the building
// there with the form's tiers, and writes a camera view of it. Then:
//   UnrealEditor.exe <project> -game -City=<forms.json> -LookFile=<looks.json> -Shots=<dir>
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, "..", "BroadwayWall", "Data");
const { massingStack } = await import(pathToFileURL(join(HERE, "..", "..", "broadway-and-wall", "src", "citygen", "massing.mjs")).href);

const cityPath = process.argv[2] ?? join(DATA, "city-1-metro.json");
const outCity = process.argv[3] ?? join(DATA, "city-1-metro-forms.json");
const outLooks = process.argv[4] ?? join(DATA, "forms-looks.json");

// form, height (m), use, year it would be built
const FORMS = [
  ["dumbbell", 22, "multifamily", 1905], ["lightcourt", 42, "office", 1912], ["courtyard", 32, "multifamily", 1925],
  ["campanile", 105, "office", 1914], ["cake", 95, "office", 1928], ["ferriss", 150, "office", 1930],
  ["base", 75, "office", 1926], ["step", 62, "office", 1922], ["crest", 70, "multifamily", 1932],
  ["terrace", 40, "multifamily", 1936], ["endtowers", 62, "multifamily", 1930], ["twins", 115, "multifamily", 1931],
  ["retail base", 60, "office", 1968], ["podium", 125, "office", 1985], ["taper", 100, "office", 1975],
  ["cruciform", 92, "multifamily", 1964], ["shifted", 100, "office", 1990], ["notch", 72, "office", 1988],
  ["zigzag", 125, "office", 1991], ["telescope", 150, "office", 2010], ["quarter", 160, "office", 2012],
  ["chamfertaper", 210, "office", 2015], ["twist", 230, "office", 2016],
];

const city = JSON.parse(readFileSync(cityPath, "utf8"));
const pts = (flat, s = 0.01) => { const o = []; for (let i = 0; i < flat.length; i += 2) o.push([flat[i] * s, flat[i + 1] * s]); return o; };
const area = (r) => { let a = 0; for (let i = 0; i < r.length; i++) { const [x0, y0] = r[i], [x1, y1] = r[(i + 1) % r.length]; a += x0 * y1 - x1 * y0; } return Math.abs(a) / 2; };
const centroid = (r) => r.reduce((c, p) => [c[0] + p[0] / r.length, c[1] + p[1] / r.length], [0, 0]);
const hash = (s, k) => { let h = 2166136261 ^ k; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } h = Math.imul(h ^ (h >>> 13), 0x5bd1e995); return ((h ^ (h >>> 15)) >>> 0) / 4294967296; };

const byBbl = new Map();
for (const v of city.volumes) { if (!v.bbl) continue; (byBbl.get(v.bbl) ?? byBbl.set(v.bbl, []).get(v.bbl)).push(v); }
const lots = new Map(city.parcels.map((p) => [p.bbl, p]));
// downtown: the centre of the tallest tenth of the buildings
const tall = [...city.volumes].sort((a, b) => b.z1 - a.z1).slice(0, Math.max(10, city.volumes.length / 10 | 0));
const mid = centroid(tall.map((v) => centroid(pts(v.ring))));

// candidates: single-volume buildings on their own lot, nearest downtown first
const cands = [];
for (const [bbl, vs] of byBbl) {
  if (vs.length !== 1 || !lots.has(bbl)) continue;
  // a standing building: the game draws a "land" lot (parking, vacant) as open ground whatever stands on it
  const lot = lots.get(bbl);
  if (lot.cls === "land" || vs[0].vacant || vs[0].z1 < 900 || (lot.floors ?? 0) < 3) continue;
  const ring = pts(vs[0].ring), a = area(ring);
  if (a < 350 || a > 6000) continue;
  const c = centroid(ring);
  cands.push({ bbl, ring, lot: pts(lots.get(bbl).ring), a, c, d: Math.hypot(c[0] - mid[0], c[1] - mid[1]), v: vs[0] });
}
cands.sort((x, y) => x.d - y.d);

const taken = [], looks = [], made = [];
for (const [form, hM, klass, year] of FORMS) {
  let got = null;
  for (const c of cands) {
    if (taken.some((t) => Math.hypot(t[0] - c.c[0], t[1] - c.c[1]) < 140)) continue;
    const r = massingStack({ ring: c.ring, lotRing: c.lot, hM, year, klass, u: (k) => hash(c.bbl, k), families: [form] });
    if (!r || r.tiers.length < 2) continue;
    got = { c, r };
    break;
  }
  if (!got) { console.log(`${form}: no lot downtown takes it`); continue; }
  const { c, r } = got;
  taken.push(c.c);
  const top = Math.max(...r.tiers.map((t) => t.top));
  const base = { ...c.v, year, cls: klass };
  const vols = r.tiers.map((t) => ({ ...base, z0: Math.round(t.base * 100), z1: Math.round(t.top * 100), crown: t.top === top, ring: t.ring.flatMap(([x, y]) => [Math.round(x * 100), Math.round(y * 100)]) }));
  byBbl.set(c.bbl, vols);
  const span = Math.sqrt(c.a);
  // three-quarter aerial, the whole building in frame: far enough for its height and its spread
  const dist = Math.max(top * 2.7, span * 3.6, 80) * 100;
  looks.push({ name: `form-${form.replace(/ /g, "")}`, x: c.c[0] * 100, y: c.c[1] * 100, z: top * 100 * 0.5, yaw: 215, pitch: -22, dist, r: Math.max(55, span * 1.6) });
  made.push(`${form} = "${r.name}" on ${c.bbl} (${Math.round(c.a)} m2, ${r.tiers.length} tiers, ${Math.round(top)} m)`);
}
// a gallery, not the city: the neighbours round each example come down to a few
// storeys so the form reads whole from the camera
const clear = looks.map((l) => [l.x / 100, l.y / 100, l.r]);
const chosen = new Set(made.map((m) => m.split(" on ")[1].split(" ")[0]));
for (const [bbl, vs] of byBbl) {
  if (chosen.has(bbl)) continue;
  const kept = [];
  for (const v of vs) {
    const c = centroid(pts(v.ring));
    if (!clear.some(([x, y, r]) => Math.hypot(c[0] - x, c[1] - y) < r)) { kept.push(v); continue; }
    if (v.z0 >= 1500) continue;
    kept.push({ ...v, z1: Math.min(v.z1, 1500) });
  }
  byBbl.set(bbl, kept);
}
for (const l of looks) delete l.r;
city.volumes = [...byBbl.values()].flat().concat(city.volumes.filter((v) => !v.bbl));
writeFileSync(outCity, JSON.stringify(city));
writeFileSync(outLooks, JSON.stringify(looks, null, 1));
console.log(made.join("\n"));
console.log(`${looks.length} forms placed -> ${outCity}`);
