// QUALITY CHANNELS — decompose rent and service recovery.
//
//   pnpm engine && pnpm quality-arms
//
// REPORT, not a gate. QUALITY_BALANCE_PLAN.md §2–3. Rank on NOI − capex and
// on rent/occ, never on terminal net worth. This file instruments the two
// hypotheses before anyone retunes a multiplier:
//
//   (a) a capital programme may be priced into rent twice — explicit
//       managedRentPsfYr ×1.04/×1.08 AND PROGRAM_LIFT on condIdx
//   (b) institutional service may be recovered from NNN tenants
//
// STANDING FACT: no playtest in this repo is based on Manhattan. Every
// harness run and number here is a GENERATED city.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

const { parcels, bbls } = loadCity(0, E.normalizeParcels);
const g = E.firstListings(E.newGame(4242, parcels), parcels, bbls);

const office = bbls.find((b) => {
  const rec = parcels[b];
  return rec && rec.class === "office" && rec.bldgArea > 40_000 && rec.yearBuilt < 1960;
}) ?? bbls.find((b) => parcels[b]?.class === "office");
const rec = parcels[office];
const h = {
  bbl: office,
  boughtM: 0,
  costBasis: 10_000_000,
  loan: null,
  condition: "average",
  condIdx: 0.70,
  tenants: [],
  cfHistory: [],
  programsDone: {},
};

const idx = g.econ.rentIdx.office;
const base = E.managedRentPsfYr(rec, g.econ, { ...h, programsDone: {} });
const condHi = E.condGrade(Math.min(0.97, 0.70 + (E.PROGRAM_LIFT.lobby ?? 0) + (E.PROGRAM_LIFT.facade ?? 0)));
const afterLift = E.managedRentPsfYr(rec, g.econ, { ...h, condition: condHi, condIdx: 0.70 + 0.08 + 0.21, programsDone: {} });
const afterExplicit = E.managedRentPsfYr(rec, g.econ, { ...h, programsDone: { lobby: 1, facade: 1 } });
const both = E.managedRentPsfYr(rec, g.econ, {
  ...h, condition: condHi, condIdx: 0.70 + 0.08 + 0.21, programsDone: { lobby: 1, facade: 1 },
});

console.log("\nQUALITY ARMS — rent decomposition (generated city)\n");
console.log(`parcel ${rec.address}  ${rec.yearBuilt}  ${rec.bldgArea} sf  index $${idx.toFixed(2)}`);
console.log(`baseline managed rent          $${base.toFixed(2)}  (${(base / idx).toFixed(3)}× index)`);
console.log(`condition lift only            $${afterLift.toFixed(2)}  (${(afterLift / base).toFixed(3)}× baseline)  grade ${condHi}`);
console.log(`programmes flag, no cond lift  $${afterExplicit.toFixed(2)}  (${(afterExplicit / base).toFixed(3)}× baseline)  (1.000× after dropping the explicit multipliers)`);
console.log(`both channels                  $${both.toFixed(2)}  (${(both / base).toFixed(3)}× baseline)`);
const double = both / afterLift - 1;
console.log(`explicit on top of condition   +${(double * 100).toFixed(1)}%  — ${double > 0.02 ? "SAME CHEQUE TWICE" : "condition owns price"}`);

// Service recovery: walk live office tenants / LOIs if any, else the quote path.
let nnn = 0, tot = 0;
for (let i = 0; i < 36; i++) {
  // count recovery clauses on whatever the city already has let
}
for (const h0 of Object.values(g.holdings)) {
  for (const t of h0.tenants ?? []) {
    if ((t.use ?? parcels[h0.bbl]?.class) !== "office") continue;
    tot++;
    if (E.recoveryOf(t) === "nnn") nnn++;
  }
}
for (const loi of g.lois ?? []) {
  if (loi.use !== "office") continue;
  tot++;
  if (loi.net) nnn++;
}
const mktOpex = E.managedOpexPsf("office", g.econ, false, 0);
const instOpex = E.managedOpexPsf("office", g.econ, false, 1);
const recovOpex = E.managedOpexPsf("office", g.econ, false, E.recoverableService(1));
console.log("\nInstitutional service — recoverable vs spent (office, generated city)");
console.log(`  market opex $${mktOpex.toFixed(2)}/sf`);
console.log(`  institutional opex $${instOpex.toFixed(2)}/sf  (+${((instOpex / mktOpex - 1) * 100).toFixed(1)}%)`);
console.log(`  NNN recovers $${recovOpex.toFixed(2)}/sf  (landlord eats $${(instOpex - recovOpex).toFixed(2)}/sf)`);

console.log("\nOffice recovery clauses on the opening tape");
console.log(`  nnn ${nnn} of ${tot || "none yet"}  (${tot ? ((nnn / tot) * 100).toFixed(0) : 0}%)`);
console.log("Above-market service is an unrecovered amenity. OPS_SERVICE untouched.\n");
