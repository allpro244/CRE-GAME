// Density gradient probe: run HZ months, then read every lot by distance from
// the tower cluster — what is built, what the dirt costs, whether anything
// pencils, and what height the town will permit. BW_SEED / BW_SIZE / BW_DENSITY
// pick the map (test/city.mjs). OUT writes the per-lot table as JSON.
import { join } from "node:path";
import { writeFileSync } from "node:fs";
const APP = process.env.APP ?? new URL("../..", import.meta.url).pathname;
const E = await import(join(APP, "test", ".engine.mjs"));
const { loadCity } = await import(join(APP, "test", "city.mjs"));
const HZ = Number(process.env.HZ ?? 1200);
const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);
let g = E.firstListings(E.newGame(Number(process.env.RUN_SEED ?? 4242), parcels), parcels, bbls);
const t0 = Date.now();
for (let m = 0; m < HZ; m++) {
  g = E.advanceQuarter(g, parcels, bbls, adjacency);
  if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
  if (m % 120 === 119) process.stderr.write(`year ${(m + 1) / 12} ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
}
const e = g.econ;
const K = ["office", "retail", "multifamily", "industrial"];
const recs = bbls.map((b) => ({ b, r: E.resolveRec(parcels, g, b) })).filter((x) => x.r && x.r.lotArea > 0 && !E.isCivicLand(g, x.b));
// metres from lng/lat
const [lon0, lat0] = recs[0].r.centroid;
const mx = (c) => [(c[0] - lon0) * 111320 * Math.cos((lat0 * Math.PI) / 180), (c[1] - lat0) * 110540];
// tower cluster: floor-area-weighted centroid of buildings >= 10 floors
let sx = 0, sy = 0, sw = 0;
for (const { r } of recs) if (r.class !== "land" && r.floors >= 10) { const [x, y] = mx(r.centroid); sx += x * r.bldgArea; sy += y * r.bldgArea; sw += r.bldgArea; }
const cx = sx / sw, cy = sy / sw;
const RINGS = [0, 150, 300, 450, 600, 800, 1000, 1300, 99999];
const rows = [];
for (const { b, r } of recs) {
  const [x, y] = mx(r.centroid);
  const d = Math.hypot(x - cx, y - cy);
  const row = { b, d: Math.round(d), cls: r.class, fl: r.floors, far: r.bldgArea / r.lotArea, demand: r.demandScore, zone: r.zoneDist, lot: r.lotArea, year: r.yearBuilt };
  if (r.class === "land" || r.floors <= 2) {
    const lr = E.landRead(r, e);
    row.landPsf = lr.psf; row.winner = lr.winner; row.builder = lr.builder;
    let bestM = -1, bestF = -1, bestUse = "", capFl = 0;
    for (const k of K) {
      if (!E.zonePermits(r.zoneDist, k, r.demandScore, e)) continue;
      const plate = E.cityCoverage(k);
      const env = Math.max(1, Math.min(E.cityInfillCap(g, parcels, r, k), E.maxFloorsFor(r, plate, k)));
      capFl = Math.max(capFl, env);
      if (r.class !== "land") continue;   // hurdle only for vacant dirt
      for (const fl of E.schemeFloorLadder(k, env)) {
        const um = E.underwriteDevelopment(g, parcels, b, k, fl, plate);
        const uf = E.underwriteDevelopment(g, parcels, b, k, fl, plate, 1);
        if (um && um.plan.hurdleRatio > bestM) { bestM = um.plan.hurdleRatio; bestUse = k + fl; }
        if (uf && uf.plan.hurdleRatio > bestF) bestF = uf.plan.hurdleRatio;
      }
    }
    row.hM = bestM; row.hF = bestF; row.bestUse = bestUse; row.capFl = capFl; row.legalFl = Math.round(E.farMaxFor ? E.farMaxFor(r) / 0.62 : 0);
  }
  rows.push(row);
}
const med = (a) => { const s = a.filter(Number.isFinite).sort((p, q) => p - q); return s.length ? s[s.length >> 1] : NaN; };
console.log(`year ${HZ / 12}: tower cluster at (${cx.toFixed(0)}, ${cy.toFixed(0)}) m; office ${(e.stock.office / 1e6).toFixed(2)}M vac ${(e.cityVac.office * 100).toFixed(1)}%  flats ${(e.stock.multifamily / 1e6).toFixed(2)}M vac ${(e.cityVac.multifamily * 100).toFixed(1)}%  pop ${Math.round(e.population)}  demolished ${g.demolished ?? 0}  buildings >=10fl ${recs.filter((x) => x.r.class !== "land" && x.r.floors >= 10).length}`);
console.log("ring(m)     lots  vacant  low(<=2fl)  medFl(built)  medFAR  demand  land$/sf  winner(b/h/t)   vacant: hurdle@mkt p50/max  @free p50/max  cleared  capFl p50  legalFl p50");
for (let i = 0; i < RINGS.length - 1; i++) {
  const rr = rows.filter((x) => x.d >= RINGS[i] && x.d < RINGS[i + 1]);
  if (!rr.length) continue;
  const vac = rr.filter((x) => x.cls === "land"), low = rr.filter((x) => x.cls !== "land" && x.fl <= 2), built = rr.filter((x) => x.cls !== "land");
  const w = (k) => vac.filter((x) => x.winner === k).length;
  const mxv = (a) => a.length ? Math.max(...a).toFixed(2) : "-";
  console.log(`${String(RINGS[i]).padStart(5)}-${String(RINGS[i + 1]).padEnd(5)} ${String(rr.length).padStart(5)} ${String(vac.length).padStart(6)}  ${String(low.length).padStart(9)}  ${String(med(built.map((x) => x.fl))).padStart(11)}  ${med(built.map((x) => x.far)).toFixed(2).padStart(6)}  ${med(rr.map((x) => x.demand)).toFixed(0).padStart(6)}  ${med(vac.map((x) => x.landPsf)).toFixed(0).padStart(8)}  ${w("builder")}/${w("holder")}/${w("texture")}`.padEnd(112)
    + `  ${med(vac.map((x) => x.hM)).toFixed(2)}/${mxv(vac.map((x) => x.hM))}       ${med(vac.map((x) => x.hF)).toFixed(2)}/${mxv(vac.map((x) => x.hF))}   ${vac.filter((x) => x.hM >= 1).length}   ${med(vac.map((x) => x.capFl))}   ${med(vac.map((x) => x.legalFl))}`);
}
const z = {}; for (const x of rows.filter((x) => x.cls === "land" && x.d < 600)) z[x.zone] = (z[x.zone] ?? 0) + 1;
console.log("zoning of vacant lots within 600m:", JSON.stringify(z));
const bu = {}; for (const x of rows.filter((x) => x.cls === "land" && x.d < 600)) { const u = (x.bestUse || "none").replace(/\d+/, ""); bu[u] = (bu[u] ?? 0) + 1; }
console.log("best use of vacant lots within 600m:", JSON.stringify(bu));
if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify({ cx, cy, rows }));
