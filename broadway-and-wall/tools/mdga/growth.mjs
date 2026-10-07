// MDGA instrument — DOES THE CITY GROW INTO ITS DEMAND? (MDGA_PLAN.md, F1)
// Every five years of a 50-year run with no player: jobs, population,
// buildings, floor area, vacant lots, vacancy by class, rate, cost index, CPI.
//   pnpm engine && node tools/mdga/growth.mjs
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, "..", "..", "test", ".engine.mjs"));
const { loadCity } = await import(join(HERE, "..", "..", "test", "city.mjs"));
const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);
let g = E.firstListings(E.newGame(7919, parcels), parcels, bbls);
const snap = () => {
  let vac = 0, bld = 0, area = 0;
  for (const b of bbls) { const r = E.resolveRec(parcels, g, b); if (!r) continue; if (r.class === "land") vac++; else if (r.bldgArea > 0) { bld++; area += r.bldgArea; } }
  const v = g.econ.cityVac ?? {};
  return `yr ${String(g.month / 12).padStart(2)} jobs ${g.econ.jobs} pop ${g.econ.population} | buildings ${bld} floor ${(area / 1e6).toFixed(2)}M sf vacant lots ${vac} | vac off ${(100 * v.office).toFixed(1)} ret ${(100 * v.retail).toFixed(1)} mf ${(100 * v.multifamily).toFixed(1)} ind ${(100 * v.industrial).toFixed(1)} | rate ${g.econ.indexRate?.toFixed(2)} costIdx ${g.econ.costIdx?.toFixed(2)} cpi ${g.econ.cpi?.toFixed(2)} | demolished ${g.demolished ?? 0} ${g.econ.phase}`;
};
console.log(snap());
for (let m = 1; m <= 600; m++) { g = E.advanceMonth(g, parcels, bbls, adjacency); if (g.gameOver) g = { ...g, gameOver: null, cash: 5e6 }; if (m % 60 === 0) console.log(snap()); }
