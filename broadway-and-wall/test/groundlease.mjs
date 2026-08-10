// GROUND LEASES ARE ABSOLUTELY NET, AND THE LEASED FEE SURVIVES A SALE.
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
  floors: 8, yearBuilt: 2002,
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
check(!E.isVacantLandLoanCollateral(g, g.holdings[bbl], rec),
  "a performing leased fee is not vacant land-loan collateral");

// Debt-page style aggregate used to sum holdingNOIYr (zero on a leased fee) and
// paint "after debt service" red while the coupon was still arriving.
{
  const deedNoi = E.ownedHoldingNoiYr(g, parcels, g.holdings[bbl]);
  const ds = 120_000; // hypothetical annual debt service under the coupon
  check(deedNoi - ds === 480_000, "NOI against debt includes the ground coupon");
  check(deedNoi - ds > 0, "after debt service is not painted negative on a performing leased fee");
}

console.log("\nMONTH TICK BOOKS THE COUPON ONCE\n");
{
  const cash0 = g.cash;
  const next = E.advanceMonth(structuredClone(g), parcels, bbls, {});
  const gained = next.cash - cash0;
  // Coupon arrives; no mortgage on the fixture. Overhead / GA may take a bite.
  check(gained > 0, `month tick leaves the firm richer after the ground coupon (Δ ${Math.round(gained)})`);
  const last = next.holdings[bbl].cfHistory[next.holdings[bbl].cfHistory.length - 1];
  check(last === Math.round(600_000 / 12),
    `holding cfHistory records the coupon (${last} vs ${Math.round(600_000 / 12)})`);
}

const { quotes } = E.refiQuotes(g, parcels, bbl);
const landDesk = quotes.find((q) => q.id === "land");
const incomeOk = quotes.some((q) => q.id !== "land" && q.available && q.maxProceeds > 0);
check(incomeOk, "an income desk will quote traditional debt against the ground rent");
check(landDesk && !landDesk.available, "land money refuses a fee that has income to underwrite");
check(quotes.find((q) => q.id === "savings")?.noiUw === 600_000
  || quotes.find((q) => q.id === "harbor")?.noiUw === 600_000
  || quotes.find((q) => q.id === "cordage")?.noiUw === 600_000,
  "refi underwriting NOI is the ground rent");

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

console.log("\nLAND LOAN BLOCKS THE OFFER\n");
{
  const landBbl = bbls.find((x) =>
    x !== bbl && parcels[x]?.class === "land" && (parcels[x]?.lotArea ?? 0) > 2_000
    && !g.holdings[x] && !g.built?.[x]);
  if (!landBbl) throw new Error("No second land parcel for offer gate.");
  const landPx = Math.round(E.landValue(parcels[landBbl], g.econ));
  let g2 = structuredClone(g);
  g2.holdings[landBbl] = {
    bbl: landBbl, boughtM: 0, costBasis: landPx, condition: "average",
    tenants: [], loan: {
      product: "land", principal: Math.round(landPx * 0.5),
      balance: Math.round(landPx * 0.5), ratePct: 8, margin: 0,
      ioUntilM: 36, amortYears: 0, maturityM: 36, monthlyPmt: Math.round(landPx * 0.5 * 0.08 / 12),
      minDSCR: 0, maxLTV: 0.65, sweep: false, cleanQs: 0,
    },
    assessed: landPx, condIdx: 0.55, svcIdx: 0.55,
    service: 0, stance: 0, plan: 1, cfHistory: [],
  };
  const blocked = E.offerGroundLease(g2, parcels, landBbl, 60, "fixed");
  check(!!blocked.err && /mortgage|lender/i.test(blocked.err),
    "offer refused while a land loan is outstanding");
  delete g2.holdings[landBbl].loan;
  const open = E.offerGroundLease(g2, parcels, landBbl, 60, "fixed");
  check(!open.err && !!open.s.holdings[landBbl].groundOffer,
    "offer opens once the land loan is gone");
}

console.log("\nSALE TRANSFERS THE LEASED FEE\n");
{
  let g3 = structuredClone(g);
  E.transferGroundLeaseOffBook(g3, bbl);
  check(!g3.groundLeases?.[bbl] && !!g3.cityGroundLeases?.[bbl],
    "sale helper moves the lease off-book instead of deleting it");
  check(g3.cityGroundLeases[bbl].rentYr === 600_000,
    "off-book lease keeps the same coupon");
  check(!!g3.built?.[bbl]?.bldgArea,
    "lessee improvement remains standing after the fee trades");
  const buy = E.executePurchase(g3, parcels, bbl, 1_000_000, "cash", false, 1);
  check(!!buy.err && /ground lease/i.test(buy.err),
    "off-book leased fee is not freehold inventory you can buy");
}

console.log("\nREVERSION AGES THE BUILDING\n");
{
  let g4 = structuredClone(g);
  g4.month = 720; // term end
  g4.groundLeases[bbl].endM = 720;
  E.tickGroundLeases(g4, parcels);
  check(!g4.groundLeases?.[bbl] && !g4.holdings[bbl].groundLeased,
    "term expiry clears the encumbrance");
  check(g4.holdings[bbl].deliveredM === 24,
    "reversion keeps the lessee's opening month — not a fresh delivery mark");
  check(g4.holdings[bbl].tenants.length === 0 && g4.holdings[bbl].occ === 0,
    "reverted shell arrives vacant");
  const ageYrs = 2000 + Math.floor(720 / 12) - 2002;
  check(ageYrs >= 50 && g4.holdings[bbl].condIdx < 0.7,
    "sixty-year bones are worn, not marked as new");
}

console.log("\nDEFAULT STILL REVERTS CONTROL\n");
{
  let g5 = structuredClone(g);
  check(E.defaultGroundLease(g5, parcels, bbl), "tenant default terminates the lease");
  check(!g5.groundLeases?.[bbl] && !g5.holdings[bbl].groundLeased,
    "ground rent stops and the encumbrance is removed");
  check(g5.built[bbl]?.bldgArea === 100_000 && g5.holdings[bbl].tenants.length === 0,
    "land and standing improvement revert vacant under full player control");
  check(g5.holdings[bbl].deliveredM === 24,
    "defaulted shell also keeps the original opening month");
  check(g5.alerts?.[0]?.kind === "ground", "default raises a player-facing popup");
}

console.log("\nFEE OWNER IS NOT THE LANDLORD\n");
{
  // After the lessee's tower is standing, resolveRec reads as a building —
  // and every landlord path used to treat the fee owner as the operator.
  let g6 = structuredClone(g);
  g6.holdings[bbl].broker = true;
  g6.lois = [{
    id: 1, bbl, name: "Fake Tenant LLC", kind: "new", use: "office",
    sf: 10_000, rentPsf: 40, tiPsf: 60, freeM: 3, termM: 120,
    expiresM: g6.month + 3, credit: 1, stage: "open",
  }];
  g6.asks = [{
    id: 1, bbl, name: "Nobody", tenantStartM: 0, askPsf: 30, currentPsf: 40,
    addM: 36, expiresM: g6.month + 3,
  }];
  const cashBefore = g6.cash;
  // Advance several months — LOIs must not regenerate, capital plan must not
  // debit the fee owner, and attention must not stop Skip for landlord paper.
  for (let i = 0; i < 6; i++) {
    g6 = E.advanceMonth(g6, parcels, bbls, {});
  }
  check(!(g6.lois ?? []).some((l) => l.bbl === bbl),
    "no LOIs land on a ground-leased fee after the lessee opens");
  check(!(g6.asks ?? []).some((a) => a.bbl === bbl),
    "no tenant-relief asks on a ground-leased fee");
  check(!g6.holdings[bbl].broker, "leasing exclusive is cleared / not kept on a leased fee");
  check(g6.holdings[bbl].tenants.length === 0, "fee owner has no rent roll of their own");
  const attn = E.attentionItems(g6).filter((a) =>
    a.key.startsWith("loi:") || a.key.startsWith("tenant-ask:")
    || a.key.startsWith("lease-roll:") || a.key.startsWith("capital-plan:"));
  check(attn.length === 0, "attention list has no landlord chores for the leased fee");
  // Capital plan used to debit fee cash against the lessee's SF.
  // Allow ordinary GA / overhead; forbid a large unexplained capex hole.
  check(g6.cash > cashBefore - 50_000,
    "fee owner is not drained by the lessee building's capital plan");

  const demo = E.demolish(g6, parcels, bbl);
  check(!!demo.err && /lessee/i.test(demo.err), "demolish refused while ground lease is live");
  const reno = E.startRenovation(g6, parcels, bbl);
  check(!!reno.err && /lessee/i.test(reno.err), "renovation refused while ground lease is live");
  const prog = E.startProgram(g6, parcels, bbl, "lobby");
  check(!!prog.err && /lessee/i.test(prog.err), "capital program refused while ground lease is live");
  const brok = E.setBroker(g6, parcels, bbl, true);
  check(!!brok.err && /lessee/i.test(brok.err), "leasing exclusive refused on a leased fee");
  const spec = E.buildSpecSuites(g6, parcels, bbl, "office", 5_000);
  check(!!spec.err && /lessee/i.test(spec.err), "spec suites refused on a leased fee");
}

console.log("");
process.exit(bad ? 1 : 0);
