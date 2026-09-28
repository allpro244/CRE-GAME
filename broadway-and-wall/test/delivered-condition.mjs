// NEW BONES READ AS NEW — a ground-up delivery opens at the top of the
// condition scale, a conversion keeps its old bones, and the desk that priced
// the scheme at "good" gets the building it priced.
//
//   pnpm engine && node test/delivered-condition.mjs
//
// The fault this guards: dev.ts deliver() read condCeiling off the STATIC
// parcel record, whose yearBuilt on a lot that was land is 0, so every
// delivery was clamped to 0.58 ("standard") for life while the word beside it
// said "good". Measured on four deliveries: value at delivery 4-56% of basis.
import { permittedUse } from "./permitted-use.mjs";
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);

let bad = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "OK  " : "FAIL"}  ${msg}`); if (!ok) bad++; };

console.log("\nDELIVERED CONDITION — ground-up opens new, a conversion keeps its bones\n");

let g = E.firstListings(E.newGame(12007, parcels, 120_000_000), parcels, bbls);
// A year in, then until a lot of size is on the tape: which month one lists is
// the market's business, not this test's, and pinning month 12 made the fixture
// hostage to every change upstream of the tape.
const lotsNow = () => g.listings.map((l) => ({ l, rec: parcels[l.bbl] })).filter((x) => x.rec?.class === "land" && x.rec.lotArea > 4000).sort((a, b) => b.rec.demandScore - a.rec.demandScore);
for (let m = 0; m < 12 || (m < 48 && lotsNow().length === 0); m++) g = E.advanceMonth(g, parcels, bbls, adjacency);
const lots = lotsNow();
check(lots.length > 0, `a lot on the tape (${lots.length})`);
const { l, rec } = lots[0];
g = E.executePurchase(g, parcels, l.bbl, l.ask, "cash", false, 1).s;
const landIdx = g.holdings[l.bbl].condIdx;
check(landIdx !== undefined && landIdx < 0.7, `the dirt carries a middling index while it is dirt (${landIdx?.toFixed(2)})`);
// Offices where the zoning hosts them, else the first use it does.
const use = permittedUse(E, E.resolveRec(parcels, g, l.bbl), g.econ, ["office", "multifamily"]);
check(!!use, `a use the zoning hosts (${use} on ${rec.zoneDist})`);
const fl = Math.max(2, Math.round(E.maxFloorsFor(rec, 0.6, use) * 0.8));
const plan = E.planDevelopment(g, parcels, l.bbl, use, fl, 0.6, "gmp");
check(!!plan, "the desk prices the scheme");
const r = E.startDevelopment(g, parcels, l.bbl, use, fl, 0.6, "gmp");
check(!r.err, `ground breaks${r.err ? `: ${r.err}` : ""}`);
g = r.s;
let deliveredAt = -1;
for (let m = 0; m < 72 && deliveredAt < 0; m++) {
  g = E.advanceMonth(g, parcels, bbls, adjacency);
  if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
  if (!g.developments[l.bbl]) deliveredAt = m;
}
check(deliveredAt >= 0, `delivered after ${deliveredAt + 1} months`);
check(g.milestones?.tower1 !== undefined, "and it is your first development delivered — the milestone fires on your own delivery");
const h = g.holdings[l.bbl];
const built = E.resolveRec(parcels, g, l.bbl);
check(h.condition === "good", `the word is "good" (${h.condition})`);
check((h.condIdx ?? 0) >= 0.9, `the index is new bones, not the dirt's (${(h.condIdx ?? 0).toFixed(3)} ≥ 0.90)`);
check(E.condGrade(h.condIdx ?? 0) === "good", `the index grades as the word says (${E.condGrade(h.condIdx ?? 0)})`);
const rentNew = E.marketRentPsfYr(built, g.econ, h.condition, h.condIdx);
const rentStd = E.marketRentPsfYr(built, g.econ, "standard", 0.58);
check(rentNew > rentStd * 1.05, `new bones rent over the old clamp ($${rentNew.toFixed(2)} vs $${rentStd.toFixed(2)} at 0.58)`);
const arrival = E.leaseFactors(g, built, h, "office").find((f) => f.label === "Condition");
check(!!arrival && arrival.mult > 1, `the leasing desk sees a good building (Condition ×${arrival?.mult})`);
const v = E.checkInvariants(g, parcels);
check(!v.some((x) => x.code === "delivered"), `no "delivered" invariant fires on the fresh building (${v.filter((x) => x.code === "delivered").map((x) => x.detail).join("; ") || "clean"})`);
// a year on, the ceiling still holds it near the top (wear is slow on new bones)
for (let m = 0; m < 12; m++) g = E.advanceMonth(g, parcels, bbls, adjacency);
check((g.holdings[l.bbl].condIdx ?? 0) >= 0.85, `a year on it still reads new (${(g.holdings[l.bbl].condIdx ?? 0).toFixed(3)})`);

// A CONVERSION KEEPS ITS BONES: the invariant must not fire on a reuse, and the
// index it opens at is bounded by the old building's ceiling.
const old = g.listings.map((x) => ({ x, rec: E.resolveRec(parcels, g, x.bbl) })).filter((y) => y.rec?.class === "office" && y.rec.bldgArea > 6000 && y.rec.yearBuilt > 0 && y.rec.yearBuilt < 1975).sort((a, b) => a.rec.yearBuilt - b.rec.yearBuilt)[0];
if (old) {
  const ceiling = E.condCeiling(old.rec, g.month);
  check(ceiling < 0.9, `an old shell's ceiling is below new bones (${old.rec.yearBuilt}: ${ceiling.toFixed(2)})`);
} else console.log("  (no old office shell on the tape to check the conversion bound — skipped)");

console.log(bad ? `\n${bad} FAILED` : "\nall clear");
process.exit(bad ? 1 : 0);
