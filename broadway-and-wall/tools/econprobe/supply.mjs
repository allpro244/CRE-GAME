import { join } from "node:path";
import { writeFileSync } from "node:fs";
const APP = process.env.APP ?? new URL("../..", import.meta.url).pathname;
const E = await import(join(APP, "test", ".engine.mjs"));
const { loadCity } = await import(join(APP, "test", "city.mjs"));
const N = Number(process.env.SEEDS ?? 2), HZ = Number(process.env.HZ ?? 600), OFF = Number(process.env.OFF ?? 0);
const K = ["office", "retail", "multifamily", "industrial"];
const out = [];
for (let i = OFF; i < OFF + N; i++) {
  const seed = 1000 + i * 7919;
  const { parcels: P0, adjacency, bbls } = loadCity(i % 4, E.normalizeParcels);
  const parcels = JSON.parse(JSON.stringify(P0));
  let g = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
  const rows = []; let natP = 1;
  const yb0 = {}; for (const b of bbls) yb0[b] = P0[b]?.yearBuilt;
  for (let m = 0; m < HZ; m++) {
    g = E.advanceQuarter(g, parcels, bbls, adjacency);
    if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
    const e = g.econ;
    natP *= 1 + (e.nat?.infl ?? 0) / 12;
    const r = { m, cpi: e.cpi, natP, natInfl: e.nat?.infl, inflExp: e.inflExp, natInflExp: e.nat?.inflExp, unemp: e.unemployment, nUnemp: e.nat?.unemp,
      jobVac: e.jobVac, wage: e.wageIdx, natWage: e.natWageIdx, crewUtil: e.crewUtil, crewIdx: e.crewIdx, cost: e.costIdx,
      cityJobs: (g.cityJobs ?? []).filter((j) => !j.orphaned).length, devs: Object.keys(g.developments ?? {}).length,
      demolished: g.demolished ?? 0, credit: e.creditIdx, phase: e.phase };
    for (const k of K) r[k] = { vac: e.cityVac[k], fric: E.residenceVac ? E.residenceVac(e, k) : NaN, pencil: e.sitePencil?.[k], owed: e.startOwed?.[k], st: e.structTight?.[k], starts: e.starts[k], scar: e.scarcity?.[k] };
    if (m % 12 === 11) {
      const vacant = [], all = []; let rebuilt = 0, nB = 0, nVacant = 0;
      for (const b of bbls) {
        const rec = E.resolveRec(parcels, g, b); if (!rec) continue;
        const lp = E.landPsfNow(rec, e);
        if (Number.isFinite(lp)) { all.push(lp); if (rec.class === "land") vacant.push(lp); }
        if (rec.class === "land") nVacant++;
        if (rec.bldgArea > 0) { nB++; if (g.built?.[b] && yb0[b] && P0[b].bldgArea > 0) rebuilt++; }
      }
      const md = (a) => { a.sort((x, y) => x - y); return a[a.length >> 1]; };
      Object.assign(r, { landAll: md(all), landVac: md(vacant), nVacant, rebuilt, nB });
    }
    rows.push(r);
  }
  out.push({ seed, rows });
  process.stderr.write(`seed ${seed} done\n`);
}
writeFileSync(process.env.OUT, JSON.stringify(out));
