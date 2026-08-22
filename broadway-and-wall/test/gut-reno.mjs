// A GUT LIFTS THE INDEX, NOT THE LABEL.
//
//   pnpm engine && pnpm gut-reno
//
// QUALITY_BALANCE_PLAN.md §1. sim.ts used to write h.condition = "good" and
// leave h.condIdx alone. tickLeasing then recomputed the label from the
// unlifted index, so $210/sf bought one month of grade. This asserts the
// completion path sets condIdx to condCeiling (after the bones step) and that
// the grade still holds the month after.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

const { parcels, bbls } = loadCity(0, E.normalizeParcels);
let fails = 0;
const ok = (name, cond, detail = "") => {
  if (!cond) { fails++; console.log(`FAIL  ${name}${detail ? " — " + detail : ""}`); }
  else console.log(`PASS  ${name}${detail ? " — " + detail : ""}`);
};

const bbl = "gutreno0001";
parcels[bbl] = {
  bbl,
  address: "1 Gut St",
  borough: "test",
  lot: "1",
  bldgClass: "O",
  class: "office",
  bldgArea: 80_000,
  floors: 8,
  unitsRes: 0,
  mix: { office: 1 },
  lotArea: 12_000,
  yearBuilt: 1928,
  buildSpec: 0.45,
  landPsf: 80,
  landPsfHistory: [80],
  demandScore: 50,
  farMaxComm: 8,
  farMaxRes: 0,
  zoneDist: "C6-4",
  district: "test",
  block: "test-1",
  assessedLand: 1,
  assessedTotal: 1,
  imputed: [],
  centroid: [0, 0],
};
const extra = [...bbls, bbl];
const g0 = E.firstListings(E.newGame(4242, parcels), parcels, extra);
g0.holdings[bbl] = {
  bbl,
  boughtM: 0,
  costBasis: 8_000_000,
  loan: null,
  condition: "worn",
  condIdx: 0.40,
  tenants: [],
  cfHistory: [],
  renovatingUntilM: g0.month,
};
const spec0 = parcels[bbl].buildSpec;
const g1 = E.advanceMonth(g0, parcels, extra, {});
const h1 = g1.holdings[bbl];
const ceiling = E.condCeiling(
  { yearBuilt: parcels[bbl].yearBuilt, buildSpec: parcels[bbl].buildSpec },
  g1.month,
);
ok("condIdx is the ceiling, not the old 0.40",
  h1 && Math.abs((h1.condIdx ?? 0) - ceiling) < 1e-9,
  `condIdx=${h1?.condIdx} ceiling=${ceiling}`);
ok("grade is a reading of that index",
  h1 && h1.condition === E.condGrade(h1.condIdx),
  `${h1?.condition} vs ${E.condGrade(h1?.condIdx ?? 0)}`);
ok("bones stepped toward 0.75, not to it",
  parcels[bbl].buildSpec > spec0 && parcels[bbl].buildSpec < 0.75,
  `${spec0} -> ${parcels[bbl].buildSpec}`);
ok("yearBuilt is still 1928", parcels[bbl].yearBuilt === 1928);
ok("renovating flag is gone", h1 && h1.renovatingUntilM === undefined);
ok("a 1928 gut is not trophy-new — ceiling stays under 0.90",
  ceiling < 0.90, `ceiling=${ceiling.toFixed(3)}`);

const g2 = E.advanceMonth(g1, parcels, extra, {});
const h2 = g2.holdings[bbl];
ok("grade survives the next month (the original bug)",
  h2 && h2.condition === h1.condition && Math.abs((h2.condIdx ?? 0) - (h1.condIdx ?? 0)) < 0.01,
  `${h2?.condition} ${h2?.condIdx} vs ${h1?.condition} ${h1?.condIdx}`);

const last = (g2.econ.history ?? []).at(-1);
ok("history stamps stock and occupied",
  last?.stock?.office != null && last?.occupied?.office != null,
  `stock=${last?.stock?.office} occ=${last?.occupied?.office}`);

if (fails) {
  console.log(`\n${fails} failed`);
  process.exit(1);
}
console.log("\nall checks passed");
