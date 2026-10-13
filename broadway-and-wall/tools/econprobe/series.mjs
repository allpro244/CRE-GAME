// Monthly-series probe: N cities x HZ months, no player. Dumps JSON for analysis.
import { join } from "node:path";
import { writeFileSync } from "node:fs";
const APP = process.env.APP ?? new URL("../..", import.meta.url).pathname;
const E = await import(join(APP, "test", ".engine.mjs"));
const { loadCity } = await import(join(APP, "test", "city.mjs"));
const N = Number(process.env.SEEDS ?? 4), HZ = Number(process.env.HZ ?? 600), OFF = Number(process.env.OFF ?? 0);
const K = ["office", "retail", "multifamily", "industrial"];
const out = [];
for (let i = OFF; i < OFF + N; i++) {
  const seed = 1000 + i * 7919;
  const { parcels: P0, adjacency, bbls } = loadCity(i % 4, E.normalizeParcels);
  const parcels = JSON.parse(JSON.stringify(P0));
  let g = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
  const rows = [];
  const t0 = Date.now();
  for (let m = 0; m < HZ; m++) {
    g = E.advanceQuarter(g, parcels, bbls, adjacency);
    if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
    const e = g.econ;
    const r = { m, phase: e.phase, idx: e.indexRate, policy: e.nat?.policy, nInfl: e.nat?.infl, nUnemp: e.nat?.unemp, inflExp: e.inflExp,
      cpi: e.cpi, wage: e.wageIdx, cost: e.costIdx, land: e.landIdx, pop: e.population, jobs: e.jobs, unemp: e.unemployment,
      part: e.participation, credit: e.creditIdx, cyc: e.cycIdx, crew: e.crewUtil, jobVac: e.jobVac };
    for (const k of K) {
      r[k] = { rent: e.rentIdx[k], eff: e.effRentIdx?.[k], vac: e.cityVac[k], cap: e.capRate[k], stock: e.stock[k], occ: e.occupied[k],
        starts: e.starts[k], pipe: e.pipeline[k], abs: e.absorb12[k], comp12: e.completions12?.[k], pool: e.pool?.[k], dark: e.darkSf?.[k] };
    }
    if (m % 12 === 11) {
      // parcel-level: mean age of built stock, landPsf median, count
      let ageSum = 0, n = 0, lp = [];
      for (const b of bbls) { const rec = E.resolveRec(parcels, g, b); if (!rec) continue; if (rec.bldgArea > 0 && rec.yearBuilt) { ageSum += (2026 + m / 12) - rec.yearBuilt; n++; } if (rec.landPsf) lp.push(rec.landPsf); }
      lp.sort((a, b) => a - b);
      r.age = ageSum / Math.max(1, n); r.landMed = lp[lp.length >> 1]; r.nBuilt = n;
      r.comps = (g.comps ?? []).filter((c) => c.m === undefined || c.m > m - 12).length;
      r.rivals = (g.rivals ?? []).filter((x) => !x.dead && !x.gone).length;
    }
    rows.push(r);
  }
  out.push({ seed, city: i % 4, rows });
  process.stderr.write(`seed ${seed} done ${(Date.now() - t0) / 1000}s\n`);
}
writeFileSync(process.env.OUT ?? "series.json", JSON.stringify(out));
