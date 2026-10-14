// MDGA instrument — HOW BIG IS THE FIT-OUT ASK AGAINST THE RENT IT BUYS?
// For every commercial building in the city, at a few points in a long run:
// the space's market rent and the mid of the second-generation allowance a
// letter would roll (TI_ASK through the fit-out market and the cost index),
// per year of term, as a share of that rent. Read by quintile of rent.
//   pnpm engine && node tools/mdga/ti-vs-rent.mjs
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(process.env.ENGINE ?? join(HERE, "..", "..", "test", ".engine.mjs"));
const { loadCity } = await import(join(HERE, "..", "..", "test", "city.mjs"));
const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);
const SEED = Number(process.env.SEED ?? 550991);
const AT = (process.env.AT ?? "12,120,240,360").split(",").map(Number);
let g = E.firstListings(E.newGame(SEED, parcels), parcels, bbls);
const q = (a, p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
for (let m = 0; m <= Math.max(...AT); m++) {
  if (g.gameOver) g = { ...g, gameOver: null, cash: 5e6 };
  if (AT.includes(m)) {
    console.log(`\nmonth ${m}  costIdx ${g.econ.costIdx.toFixed(2)}  cpi ${(g.econ.cpi ?? 1).toFixed(2)}`);
    for (const use of ["office", "retail", "industrial"]) {
      const rows = [];
      for (const b of bbls) {
        const rec = E.resolveRec(parcels, g, b);
        if (!rec || !(rec.bldgArea > 0) || !(E.useSf(rec, use) > 0)) continue;
        const h = { condition: E.initialCondition(rec) };
        const rent = E.useRentPsfYr(rec, g.econ, h.condition, use);
        if (!(rent > 0)) continue;
        // the band this building's letters roll (on an older bundle, the city-wide dollar band)
        const [lo, hi] = E.tiBandPsfYr
          ? E.tiBandPsfYr(g, rec, h, use).map((x) => x * E.tiPressure(E.concessionPressure(g.econ, use)))
          : E.marketTiPsfYr(g, use);
        rows.push({ rent, ti: (lo + hi) / 2, sf: E.useSf(rec, use) });
      }
      rows.sort((a, b) => a.rent - b.rent);
      if (!rows.length) continue;
      const bands = [0.1, 0.25, 0.5, 0.75, 0.9].map((p) => q(rows, p));
      console.log(`  ${use.padEnd(10)} n ${String(rows.length).padStart(5)}  rent p10/p25/p50/p75/p90 ${bands.map((r) => "$" + r.rent.toFixed(2)).join(" ")}`
        + `\n  ${"".padEnd(10)}   TI mid ${bands.map((r) => "$" + r.ti.toFixed(2)).join(" ")}/sf·yr → ${bands.map((r) => (100 * r.ti / r.rent).toFixed(0) + "%").join(" ")} of the year's rent`);
    }
  }
  g = E.advanceMonth(g, parcels, bbls, adjacency);
}
