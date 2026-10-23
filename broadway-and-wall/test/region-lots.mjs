// THE LOT-SIZE GRADIENT ON THE REGION MAP.
//
//   node test/region-lots.mjs [seed ...]
//
// Median lot area (sf) by distance from the city's landing, for every parcel
// the map has: the market's lots, the neighbourhoods' own average lot, rural
// homes and farm tracts. The owner's rule: small near downtown, larger outward,
// smoothly — no band where the median steps back down.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const { makeCity, REGION } = await import(join(HERE, "..", "src", "citygen", "index.mjs"));

const BANDS = [0, 250, 500, 750, 1000, 1500, 2000, 3000, 9e9];
const seeds = process.argv.slice(2).map(Number);
for (const seed of seeds.length ? seeds : [1, 2, 3]) {
  const c = makeCity(REGION, seed);
  const [lon0, lat0] = c.manifest.region.centre;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const d = (ll) => Math.hypot((ll[0] - lon0) * kx, (ll[1] - lat0) * 111320);
  const rows = [];
  for (const p of Object.values(c.parcels)) rows.push({ d: d(p.centroid), a: p.lotArea, kind: "market" });
  for (const r of Object.values(c.reserved)) rows.push({ d: d(r.centroid), a: r.kind === "neighbourhood" ? r.avgLotSf : r.lotArea, kind: r.kind });
  const med = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[s.length >> 1] : null; };
  console.log(`\nseed ${seed} — ${c.name}: median lot (sf) by distance from the landing [n]`);
  for (let i = 0; i + 1 < BANDS.length; i++) {
    const inB = rows.filter((r) => r.d >= BANDS[i] && r.d < BANDS[i + 1]);
    if (!inB.length) continue;
    const by = (k) => { const x = inB.filter((r) => (Array.isArray(k) ? k.includes(r.kind) : r.kind === k)).map((r) => r.a); return x.length ? `${Math.round(med(x)).toLocaleString()} [${x.length}]` : "—"; };
    const lots = inB.filter((r) => r.kind !== "farm" && r.kind !== "woodlot").map((r) => r.a);
    const label = `${(BANDS[i] / 1000).toFixed(2)}-${BANDS[i + 1] > 1e8 ? "" : (BANDS[i + 1] / 1000).toFixed(2)} km`;
    console.log(`  ${label.padEnd(12)} all lots ${lots.length ? Math.round(med(lots)).toLocaleString().padStart(8) : "—".padStart(8)} [${lots.length}]   market ${by("market")}   neighbourhood lot ${by("neighbourhood")}   rural ${by("rural")}   farm/woods ${by(["farm", "woodlot"])}`);
  }
}
