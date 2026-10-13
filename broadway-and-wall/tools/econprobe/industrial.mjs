// Industrial supply probe: every 5 years, real rent, vacancy, demand state, and the
// P97 / max development hurdle over industrial-permitted vacant lots at market and
// at free land. SEEDS, OFF, HZ as in series.mjs. Output is a table per world.
import { join } from "node:path";
const APP = process.env.APP ?? new URL("../..", import.meta.url).pathname;
const E = await import(join(APP, "test", ".engine.mjs"));
const { loadCity } = await import(join(APP, "test", "city.mjs"));
const N = Number(process.env.SEEDS ?? 2), HZ = Number(process.env.HZ ?? 600), OFF = Number(process.env.OFF ?? 0);
const k = "industrial";
for (let i = OFF; i < OFF + N; i++) {
  const seed = 1000 + i * 7919;
  const { parcels: P0, adjacency, bbls } = loadCity(i % 4, E.normalizeParcels);
  const parcels = JSON.parse(JSON.stringify(P0));
  let g = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
  const r0 = g.econ.rentIdx[k];
  console.log(`seed ${seed} city ${i%4}  open rent ${r0.toFixed(2)} anchor ${g.econ.rentAnchor?.[k]} base ${g.econ.baseStock?.[k]?.toFixed(0)} stock ${g.econ.stock[k].toFixed(0)}`);
  console.log("yr  realRent  vac   pool/hous  sTight  affE  incE  secIdx  base/base0  jobs   stock   starts12  pinnedM  hurM(p97,max) hurFree(p97,max) nLots loc(p50,max) cap");
  const base0 = g.econ.baseStock?.[k] ?? 1;
  let pinned = 0, starts = 0;
  for (let m = 0; m < HZ; m++) {
    g = E.advanceQuarter(g, parcels, bbls, adjacency);
    if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
    const e = g.econ;
    if ((e.cityVac[k]) <= E.frictionFloor(k) + 0.015) pinned++;
    starts += e.starts?.[k] ?? 0;
    if (m % 60 !== 59) continue;
    const hm = [], hf = [], loc = [];
    for (const b of bbls) {
      const rec = E.resolveRec(parcels, g, b);
      if (!rec || rec.class !== "land" || rec.lotArea < 3000 || E.isCivicLand(g, b)) continue;
      if (!E.zonePermits(rec.zoneDist, k, rec.demandScore, e)) continue;
      const plate = E.cityCoverage(k);
      const fl = Math.max(1, Math.min(E.cityInfillCap(g, parcels, rec, k), E.maxFloorsFor(rec, plate, k)));
      const u = E.underwriteDevelopment(g, parcels, b, k, fl, plate);
      const uf = E.underwriteDevelopment(g, parcels, b, k, fl, plate, 1);
      if (u) hm.push(u.plan.hurdleRatio); if (uf) hf.push(uf.plan.hurdleRatio);
      loc.push(E.locationRentMult(rec, e, k));
    }
    const q = (a, p) => { a.sort((x, y) => x - y); return a.length ? a[Math.floor(p * (a.length - 1))].toFixed(2) : "-"; };
    const real = e.rentIdx[k] / r0 / (e.cpi ?? 1);
    const hous = E.housableStock(e, k);
    console.log(`${String((m+1)/12).padStart(2)}  ${real.toFixed(3)}   ${(e.cityVac[k]*100).toFixed(1).padStart(4)}  ${(e.pool[k]/hous).toFixed(3)}   ${(e.structTight?.[k]??0).toFixed(3)}  ${e.affordEff[k].toFixed(3)} ${e.incomeEff[k].toFixed(3)} ${(e.secular?.industrial?.idx ?? e.industComp ?? 1).toFixed(3)}   ${((e.baseStock?.[k]??0)/base0).toFixed(3)}     ${(e.jobs/1000).toFixed(0).padStart(4)}k ${(e.stock[k]/1e6).toFixed(2)}M ${(starts/1e3).toFixed(0).padStart(6)}k  ${String(pinned).padStart(3)}    ${q(hm,.97)},${q(hm,1)}     ${q(hf,.97)},${q(hf,1)}   ${String(hm.length).padStart(4)}  ${q(loc,.5)},${q(loc,1)}  ${e.capRate[k].toFixed(2)}`);
    pinned = 0; starts = 0;
  }
}
