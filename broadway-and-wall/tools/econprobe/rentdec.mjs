import { join } from "node:path";
const APP = process.env.APP ?? new URL("../..", import.meta.url).pathname;
const E = await import(join(APP, "test", ".engine.mjs"));
const { loadCity } = await import(join(APP, "test", "city.mjs"));
const K = ["office", "multifamily", "industrial", "retail"];
for (const i of [0, 2]) {
  const seed = 1000 + i * 7919;
  const { parcels: P0, adjacency, bbls } = loadCity(i % 4, E.normalizeParcels);
  const parcels = JSON.parse(JSON.stringify(P0));
  let g = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
  const acc = {}; for (const k of K) acc[k] = { pin: { n: 0 }, tight: { n: 0 }, soft: { n: 0 } };
  for (let m = 0; m < 600; m++) {
    g = E.advanceQuarter(g, parcels, bbls, adjacency);
    if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
    const e = g.econ;
    const infl = (e.history.length >= 13 ? e.cpi / e.history[e.history.length - 13].cpi - 1 : 0.02) / 12;
    for (const k of K) {
      const rp = e.rentPath?.[k]; if (!rp) continue;
      const fr = E.residenceVac(e, k), v = e.cityVac[k];
      const b = v <= fr + 0.003 ? "pin" : rp.gap < 0 ? "tight" : "soft";
      const a = acc[k][b]; a.n++;
      for (const f of ["vacTerm", "instant", "pressClamped", "anchor", "escalation", "drift", "nomCh"]) a[f] = (a[f] ?? 0) + rp[f];
      a.real = (a.real ?? 0) + rp.nomCh - infl;
      a.st = (a.st ?? 0) + (e.structTight?.[k] ?? 0);
      a.scar = (a.scar ?? 0) + (e.scarcity?.[k] ?? 0);
    }
  }
  console.log(`\nseed ${seed} — mean monthly terms (x100 = %/mo); 'real' = nominal change minus trailing CPI`);
  for (const k of K) for (const b of ["pin", "tight", "soft"]) {
    const a = acc[k][b]; if (!a.n) continue;
    const r = (f) => (100 * a[f] / a.n).toFixed(3).padStart(7);
    console.log(`${k.padEnd(12)} ${b.padEnd(5)} n=${String(a.n).padStart(3)} vacTerm ${r("vacTerm")} instant ${r("instant")} press ${r("pressClamped")} anchor ${r("anchor")} escal ${r("escalation")} drift ${r("drift")} nom ${r("nomCh")} REAL ${r("real")}  (=${(1200 * a.real / a.n).toFixed(1)}%/yr) structTight ${(a.st / a.n).toFixed(3)} scarcityEMA ${(a.scar / a.n).toFixed(3)}`);
  }
}
