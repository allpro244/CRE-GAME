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

// Service recovery: letters only land on a deed you hold. Stamp one office,
// tick two years, count recoveryOf (not the legacy net flag — new letters
// set both, and recovery wins). Office rollRecovery is 30% nnn / 58% base /
// 12% gross. The owner's "~80% net" is the legacy flag in leasing.ts.
let gTick = g;
const stamp = bbls.find((b) => parcels[b]?.class === "office" && (parcels[b]?.bldgArea ?? 0) > 40_000);
if (stamp && !gTick.holdings[stamp]) {
  gTick.holdings[stamp] = {
    bbl: stamp, boughtM: 0, costBasis: 10_000_000, loan: null,
    condition: "average", condIdx: 0.70, tenants: [], cfHistory: [],
    programsDone: {}, service: 1,
  };
}
for (let i = 0; i < 24; i++) gTick = E.advanceMonth(gTick, parcels, bbls, {});
const recCounts = { nnn: 0, base: 0, gross: 0 };
let tot = 0, legacyNet = 0;
const tally = (t) => {
  tot++;
  const k = E.recoveryOf(t);
  recCounts[k] = (recCounts[k] ?? 0) + 1;
  if (t.net) legacyNet++;
};
for (const h0 of Object.values(gTick.holdings)) {
  if ((parcels[h0.bbl]?.class) !== "office") continue;
  for (const t of h0.tenants ?? []) tally(t);
}
for (const loi of gTick.lois ?? []) {
  if (loi.use !== "office") continue;
  tally(loi);
}
const mktOpex = E.opexPsf("office", g.econ, false, 0);
const instOpex = E.opexPsf("office", g.econ, false, 1);
const recovOpex = E.opexPsf("office", g.econ, false, E.recoverableService(1));
console.log("\nInstitutional service — recoverable vs spent (office, generated city)");
console.log(`  market opex $${mktOpex.toFixed(2)}/sf`);
console.log(`  institutional opex $${instOpex.toFixed(2)}/sf  (+${((instOpex / mktOpex - 1) * 100).toFixed(1)}%)`);
console.log(`  NNN recovers $${recovOpex.toFixed(2)}/sf  (landlord eats $${(instOpex - recovOpex).toFixed(2)}/sf)`);

console.log("\nOffice recovery clauses after 24 months on one stamped deed");
if (!tot) {
  console.log("  no letters on a stamped empty deed (inbound path wants a purchased roll)");
  console.log("  source draw, leasing.ts rollRecovery(office): 30% nnn / 58% base / 12% gross");
  console.log("  source draw, legacy net flag: 80%  — recoveryOf reads recovery first");
} else {
  const pct = (n) => ((n / tot) * 100).toFixed(0);
  console.log(`  recoveryOf  nnn ${recCounts.nnn} (${pct(recCounts.nnn)}%)  base ${recCounts.base} (${pct(recCounts.base)}%)  gross ${recCounts.gross} (${pct(recCounts.gross)}%)  of ${tot}`);
  console.log(`  legacy net flag ${legacyNet} of ${tot} (${pct(legacyNet)}%)  — not what recoveryOf reads`);
}
console.log("Above-market service is an unrecovered amenity. OPS_SERVICE untouched.\n");
