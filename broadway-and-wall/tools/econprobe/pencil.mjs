// For vacant lots at several dates: who sets the land price, and does the pro forma clear
// (a) with land at market, (b) with land at zero (pure building economics), (c) land at texture floor.
import { join } from "node:path";
const APP = process.env.APP ?? new URL("../..", import.meta.url).pathname;
const E = await import(join(APP, "test", ".engine.mjs"));
const { loadCity } = await import(join(APP, "test", "city.mjs"));
const seedIdx = Number(process.env.I ?? 0);
const seed = 1000 + seedIdx * 7919;
const { parcels: P0, adjacency, bbls } = loadCity(seedIdx % 4, E.normalizeParcels);
const parcels = JSON.parse(JSON.stringify(P0));
let g = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
const K = ["office", "retail", "multifamily", "industrial"];
const dates = [24, 120, 240, 360, 480];
for (let m = 0; m <= 480; m++) {
  g = E.advanceQuarter(g, parcels, bbls, adjacency);
  if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
  if (!dates.includes(m)) continue;
  const e = g.econ;
  const win = {}; const hr = { mkt: {}, zero: {} }; let n = 0;
  for (const k of K) { hr.mkt[k] = []; hr.zero[k] = []; }
  for (const b of bbls) {
    const rec = E.resolveRec(parcels, g, b);
    if (!rec || rec.class !== "land" || rec.lotArea < 1500 || g.holdings[b] || g.developments[b] || E.isCivicLand(g, b)) continue;
    if (++n > 120) break;
    const lr = E.landRead(rec, e);
    win[lr.winner] = (win[lr.winner] ?? 0) + 1;
    for (const k of K) {
      if (!E.zonePermits(rec.zoneDist, k, rec.demandScore, e)) continue;
      const plate = E.cityCoverage(k);
      const fl = Math.max(2, Math.min(E.cityInfillCap(g, parcels, rec, k), E.maxFloorsFor(rec, plate, k)));
      const a = E.underwriteDevelopment(g, parcels, b, k, fl, plate);
      const z = E.underwriteDevelopment(g, parcels, b, k, fl, plate, 1);
      if (a) hr.mkt[k].push(a.plan.hurdleRatio);
      if (z) hr.zero[k].push(z.plan.hurdleRatio);
    }
  }
  const q = (a, p) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))]; };
  console.log(`\nseed ${seed} month ${m}: vacant sampled ${n} · price set by ${JSON.stringify(win)} · vac ${K.map(k => k[0] + (100 * e.cityVac[k]).toFixed(1)).join(" ")} · pencil ${JSON.stringify(e.sitePencil)}`);
  for (const k of K) {
    const A = hr.mkt[k], Z = hr.zero[k];
    console.log(`  ${k.padEnd(12)} n=${A.length} hurdle@market p50 ${q(A, .5).toFixed(2)} p97 ${q(A, .97).toFixed(2)} clears ${(100 * A.filter(x => x >= 1).length / Math.max(1, A.length)).toFixed(0)}% · hurdle@free-land p50 ${q(Z, .5).toFixed(2)} p97 ${q(Z, .97).toFixed(2)} clears ${(100 * Z.filter(x => x >= 1).length / Math.max(1, Z.length)).toFixed(0)}%`);
  }
}
