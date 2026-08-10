// GROUND LEASES ARE ABSOLUTELY NET, AND DEFAULT RETURNS CONTROL.
//
//   pnpm engine && pnpm exec node test/groundlease.mjs
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

const { parcels, bbls } = loadCity(0, E.normalizeParcels);
let g = E.newGame(72109, parcels);
const bbl = bbls.find((x) => parcels[x]?.class === "land" && parcels[x]?.lotArea > 2_000);
if (!bbl) throw new Error("No land parcel for ground-lease harness.");
const raw = parcels[bbl];
const price = Math.round(E.landValue(raw, g.econ));
g.holdings[bbl] = {
  bbl, boughtM: 0, costBasis: price, condition: "average",
  tenants: [], loan: null, assessed: price, condIdx: 0.55, svcIdx: 0.55,
  service: 0, stance: 0, plan: 1, cfHistory: [], groundLeased: true,
};
g.built[bbl] = {
  class: "office", mix: { office: 1 }, bldgArea: 100_000,
  floors: 8, yearBuilt: 2025,
};
g.groundLeases = {
  [bbl]: {
    bbl, startM: 0, endM: 720, rentYr: 600_000, openRentYr: 600_000,
    stepPct: 10, stepEveryM: 120, lastStepM: 0,
    tenant: "Test Ground Tenant", review: "fixed",
    use: "office", sf: 100_000, floors: 8, builtM: 24,
  },
};

let bad = 0;
const check = (ok, msg) => {
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${msg}`);
  if (!ok) bad++;
};

console.log("\nABSOLUTELY-NET GROUND LEASE\n");

const rec = E.resolveRec(parcels, g, bbl);
check(rec?.class === "office", "lessee improvement resolves as a standing building");
check(E.holdingNOIYr(rec, g.econ, g.holdings[bbl], g.month) === 0,
  "fee owner pays no tax, insurance, vacancy or operating expense after opening");
check(E.ownedHoldingNoiYr(g, parcels, g.holdings[bbl]) === 600_000,
  "deed NOI is the ground coupon, not vacant-dirt zero");
check(E.portfolioPropertyMonthlyCF(g, parcels) === 600_000 / 12,
  "portfolio property CF counts the ground rent");
check(E.portfolioMonthlyCF(g, parcels) === 600_000 / 12,
  "header CF / yr annualises the same coupon (no other firm debt here)");

const cashFlow = E.groundLeaseExpenseBreakdown(600_000);
check(cashFlow.grossRentYr === 600_000 && cashFlow.netRentYr === 600_000,
  "gross ground rent equals net cash income");
check(cashFlow.propertyTaxYr === 0 && cashFlow.insuranceYr === 0
  && cashFlow.operatingYr === 0 && cashFlow.tiAtSigning === 0
  && cashFlow.brokerageAtSigning === 0 && cashFlow.legalAtSigning === 0,
  "expense breakdown is zero to the fee owner");
const deedValue = E.ownedHoldingValue(g, parcels, g.holdings[bbl]);
check(deedValue === E.netWorth(g, parcels) - g.cash,
  "Portfolio, lenders and net worth use the same leased-fee value");

check(E.defaultGroundLease(g, parcels, bbl), "tenant default terminates the lease");
check(!g.groundLeases[bbl] && !g.holdings[bbl].groundLeased,
  "ground rent stops and the encumbrance is removed");
check(g.built[bbl]?.bldgArea === 100_000 && g.holdings[bbl].tenants.length === 0,
  "land and standing improvement revert vacant under full player control");
check(g.alerts?.[0]?.kind === "ground", "default raises a player-facing popup");

console.log("");
process.exit(bad ? 1 : 0);
