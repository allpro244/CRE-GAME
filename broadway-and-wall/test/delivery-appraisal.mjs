// A JUST-DELIVERED BUILDING IS NOT WORTH LESS THAN THE LOT.
//
// holdingValue floored at 0.92 × land, and leaseUpMarkAt charged TI/LC on
// gross area. A 400k sf empty office then marked below its residual dirt
// and the revolver, sized on net worth, called the over-advance.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

const { parcels, bbls } = loadCity(0, E.normalizeParcels);
const g = E.firstListings(E.newGame(88117, parcels), parcels, bbls);
const owned = new Set(Object.keys(g.holdings ?? {}));
const rec = bbls.map((b) => parcels[b]).filter((r) => r?.class === "office" && r.bldgArea > 80_000 && !owned.has(r.bbl))
  .sort((a, b) => b.bldgArea - a.bldgArea)[0];
if (!rec) {
  console.error("no large office parcel");
  process.exit(1);
}

let bad = 0;
const check = (ok, msg) => {
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${msg}`);
  if (!ok) bad++;
};

const land = E.landValue(rec, g.econ);
check(E.landAppraisalFloor(rec, g.econ, true) === land, "lease-up floor is the residual, not 92% of it");
check(Math.abs(E.landAppraisalFloor(rec, g.econ, false) - land * 0.92) < 1, "old empty fabric still pays the demo haircut");

const year = E.START_YEAR + Math.floor(g.month / 12);
const newborn = { ...rec, yearBuilt: year };
g.econ.m = g.month;
const h = {
  bbl: rec.bbl,
  boughtM: g.month,
  tenants: [],
  condition: "good",
  condIdx: 0.92,
  costBasis: land + rec.bldgArea * 400,
  deliveredM: g.month,
  occ: 0,
  loan: null,
};

const mark = E.holdingValue(newborn, g.econ, h, g.month);
const dirt = E.landValue(newborn, g.econ);
check(mark + 1 >= dirt, `empty delivery marks at or above land ($${(mark / 1e6).toFixed(2)}M vs dirt $${(dirt / 1e6).toFixed(2)}M on ${(rec.bldgArea / 1000).toFixed(0)}k sf)`);

const asIs = E.leaseUpMarkAt(
  newborn, g.econ, "good", 0, 0,
  Math.max(0.028, Math.min(0.13, (g.econ.capRate?.office ?? 6.5) / 100)),
);
check(asIs !== null && asIs + 1 >= dirt, `as-is-on-completion is not below the lot ($${(asIs / 1e6).toFixed(2)}M)`);

// THE LOC CALL. The revolver is 60% of net worth. CIP carries at money
// sunk; on delivery that is replaced by the empty mark minus a mini-perm
// sized to the job. The old 0.92 × land floor was an 8% haircut on the
// lot the month the crane came down, and TI-on-gross could put as-is
// under the dirt. Either one shrinks the line.
parcels[rec.bbl] = newborn;
const takeout = Math.round(rec.bldgArea * 400 * 0.65);
const nwBefore = E.netWorth(g, parcels);
g.holdings[rec.bbl] = {
  ...h,
  loan: { balance: takeout, principal: takeout, ratePct: 7, monthlyPmt: 1, maturityM: g.month + 60 },
};
const added = E.netWorth(g, parcels) - nwBefore;
const addedAtOldFloor = dirt * 0.92 - takeout;
check(added + 1 >= dirt - takeout, "booked equity is the mark minus the takeout, and the mark is not below dirt");
check(added > addedAtOldFloor + 1, "lease-up does not take the demolition haircut that used to call the revolver");

console.log("");
process.exit(bad ? 1 : 0);
