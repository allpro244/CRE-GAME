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
const site = bbls.map((b) => parcels[b])
  .filter((r) => r && !owned.has(r.bbl) && (r.lotArea ?? 0) > 12_000)
  .sort((a, b) => b.lotArea - a.lotArea)[0];
if (!site) {
  console.error("no large lot");
  process.exit(1);
}
// THE BUILDING THAT TRIPPED THE LINE. The plat's biggest office is ~72k sf.
// The fault was a 400k sf empty tower: TI-on-gross ate 15–25% extra fill
// and the 0.92 floor printed below residual dirt. Build that building on
// a real lot so the harness is the case, not the stock that happens to ship.
const rec = {
  ...site,
  class: "office",
  bldgArea: 400_000,
  floors: 32,
  mix: undefined,
};

let bad = 0;
const check = (ok, msg) => {
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${msg}`);
  if (!ok) bad++;
};

const land = E.landValue(rec, g.econ);
check(E.landAppraisalFloor(rec, g.econ, true) === land, "lease-up floor is the residual, not 92% of it");
// OLD FABRIC IS FLOORED AT THE CLEAR SITE: the land less taking the building
// down (proforma wreckCost, what the Build desk charges), and less buying out
// whoever is in it. It was land x 0.92 whatever the building or its leases.
const wreck = E.wreckCost(rec.bldgArea, g.econ.costIdx);
check(Math.abs(E.landAppraisalFloor(rec, g.econ, false) - Math.max(0, land - wreck)) < 1,
  `old empty fabric is floored at the land less its demolition (${(land / 1e6).toFixed(2)}M - ${(wreck / 1e6).toFixed(2)}M)`);
{
  const m0 = g.month;
  const hLet = { bbl: rec.bbl, tenants: [{ sf: 200_000, rentPsf: 40, endM: m0 + 96 }], occ: 0, condition: "good", condIdx: 0.92 };
  const hEnd = { ...hLet, tenants: [{ sf: 200_000, rentPsf: 40, endM: m0 + 3 }] };
  const cLet = E.vacantPossessionCost(rec, g.econ, hLet, m0), cEnd = E.vacantPossessionCost(rec, g.econ, hEnd, m0);
  check(Math.abs(cLet - 200_000 * 40 / 12 * 96 * E.BUYOUT_PREMIUM) < 1, `eight years of lease left costs its remaining rent and the premium to buy out (${(cLet / 1e6).toFixed(1)}M)`);
  check(cEnd < cLet / 20, `a lease three months from expiry costs little to clear (${(cEnd / 1e6).toFixed(2)}M)`);
  // on a small building, where the dirt outweighs the wrecking: the leases come off the floor dollar for dollar
  const small = { ...rec, bldgArea: 5_000, floors: 1 };
  const f0 = E.landAppraisalFloor(small, g.econ, false, 0), f1 = E.landAppraisalFloor(small, g.econ, false, 100_000);
  check(f0 > 100_000 && Math.abs(f0 - f1 - 100_000) < 1,
    `the site under a let building is worth the clear site less buying out its leases (${(f0 / 1e3).toFixed(0)}K -> ${(f1 / 1e3).toFixed(0)}K)`);
}

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
