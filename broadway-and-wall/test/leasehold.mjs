// SELL THE LAND, KEEP THE BUILDING — the landlord's sale-leaseback holds its
// books: the deal moves value only by its costs, the ledger reconciles every
// month after, NOI falls by exactly the ground rent, the rent steps, the land
// you no longer own cannot be demolished or leased out, and it can be bought
// back at the rent's value.
//
//   pnpm engine && node test/leasehold.mjs
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
const K = (x) => `$${Math.round(x / 1e3).toLocaleString()}K`;
const IN = ["noi", "sold", "interest", "borrowed", "lpCalled"];
const OUT = ["debtSvc", "leasing", "capex", "dev", "taxes", "bought", "ga", "lpDistributed"];
const ledger = (g) => { let t = 0; for (const e of g.books ?? []) { for (const k of IN) t += e[k] ?? 0; for (const k of OUT) t -= e[k] ?? 0; } return t; };
const deposits = (g) => Object.values(g.holdings).reduce((a, h) => a + h.tenants.reduce((b, t) => b + (t.deposit ?? 0), 0), 0);
const pos = (g) => g.cash - (g.loc?.balance ?? 0) - deposits(g);

console.log("\nLEASEHOLD — sell the land, keep the building\n");

let g = E.firstListings(E.newGame(12007, parcels, 12_000_000), parcels, bbls);
let bbl = null;
for (const li of g.listings) {
  const rec = E.resolveRec(parcels, g, li.bbl);
  if (!rec || rec.class === "land" || !rec.bldgArea || li.halfBuilt || li.ask > 6_000_000) continue;
  for (const prod of ["savings", "harbor", "savings25"]) {
    const r = E.executePurchase(g, parcels, li.bbl, li.ask, prod, false, 1);
    if (!r.err && r.s.holdings[li.bbl]?.loan) { g = r.s; bbl = li.bbl; break; }
  }
  if (bbl) break;
}
check(!!bbl, `a building on a mortgage (${bbl})`);
for (let m = 0; m < 3; m++) g = E.advanceMonth(g, parcels, bbls, adjacency);
// A mortgage bigger than the land cannot be cleared by selling the land: the
// fee buyer will not take it subject to your lender.
{
  const heavy = E.leaseholdQuote(g, parcels, bbl);
  const land = heavy.price, owed = heavy.payoff;
  if (owed > land) check(!heavy.ok && /mortgage/.test(heavy.why ?? ""), `a ${K(owed)} mortgage over ${K(land)} of land is refused, and says why`);
  // pay it down to half the land's value so the sale can retire it
  const target = Math.round(land * 0.5);
  const bal = g.holdings[bbl].loan.balance;
  if (bal > target) { g.cash += bal; const pd = E.paydownLoan(g, parcels, bbl, bal - target); g = pd.s; g.cash -= bal; }
}
const rec = E.resolveRec(parcels, g, bbl);
const q = E.leaseholdQuote(g, parcels, bbl);
check(q.ok, `a quote: land ${K(q.price)}, rent ${K(q.rentYr)}/yr at ${q.yieldPct.toFixed(2)}%, costs ${K(q.costs)}, payoff ${K(q.payoff)}, tax ${K(q.tax)}, to you ${K(q.toOwner)}${q.why ? " — " + q.why : ""}`);
check(Math.abs(q.rentYr - q.price * q.yieldPct / 100) < 2, "the rent is the price at the ground yield");

const nw0 = E.netWorth(g, parcels), cash0 = g.cash, led0 = ledger(g);
const noi0 = E.contractNoiYr(rec, g.econ, g.holdings[bbl], g.month);
const pen = E.stackPayoff(g.holdings[bbl], g.month).penalty;
const r = E.sellLandLeaseBack(g, parcels, bbl);
check(!r.err, `sold${r.err ? ": " + r.err : ""}`);
const g1 = r.s, h1 = g1.holdings[bbl];
check(Math.abs((g1.cash - cash0) - q.toOwner) < 2, `cash rises by exactly what the quote said (${K(g1.cash - cash0)})`);
check(Math.abs((ledger(g1) - led0) - (g1.cash - cash0)) < 2, "every dollar of it is on the ledger");
check(!h1.loan && !!h1.groundRentOut, "the mortgage is retired and the ground lease is on the deed");
const noi1 = E.contractNoiYr(rec, g1.econ, h1, g1.month);
check(Math.abs((noi0 - noi1) - q.rentYr) < 2, `NOI falls by exactly the ground rent (${K(noi0)} → ${K(noi1)})`);
const v0 = E.ownedHoldingValue(g, parcels, g.holdings[bbl]), v1 = E.ownedHoldingValue(g1, parcels, h1);
check(Math.abs((v0 - v1) - q.price) / q.price < 0.01, `the building marks down by the land's price (${K(v0)} → ${K(v1)}, land ${K(q.price)})`);
const dNw = E.netWorth(g1, parcels) - nw0;
const friction = q.costs + q.tax + pen;
check(Math.abs(dNw + friction) < Math.max(5_000, friction * 0.02), `value-neutral but for the costs: net worth ${dNw >= 0 ? "+" : ""}${K(dNw)} against costs + tax + break fee ${K(friction)}`);
check(g.holdings[bbl].loan && !g.holdings[bbl].groundRentOut, "the caller's state is untouched");

// guards
check(!!E.demolish(g1, parcels, bbl).err, "you cannot demolish on land you sold");
check(!!E.offerGroundLease(g1, parcels, bbl, 99).err, "or ground-lease it out");
check(!!E.sellLandLeaseBack(g1, parcels, bbl).err, "or sell it twice");

// two years on the books
let g2 = g1; let drift = 0;
for (let m = 0; m < 24; m++) {
  const p0 = pos(g2), l0 = ledger(g2);
  g2 = E.advanceMonth(g2, parcels, bbls, adjacency);
  drift = Math.max(drift, Math.abs((pos(g2) - p0) - (ledger(g2) - l0)));
}
check(drift < 5, `24 months reconcile to the ledger (worst month $${drift.toFixed(2)})`);
const gr = g2.holdings[bbl]?.groundRentOut;
check(!!gr && Math.abs(gr.rentYr - Math.round(Math.round(q.rentYr * 1.02) * 1.02)) <= 2, `the rent stepped twice at 2% (${K(q.rentYr)} → ${K(gr?.rentYr ?? 0)})`);

// buy it back
const cost = E.landBuybackCost(g2, g2.holdings[bbl]);
const rb = E.buyLandBack(g2, parcels, bbl);
check(!rb.err && !rb.s.holdings[bbl].groundRentOut, `bought back for ${K(cost)}${rb.err ? ": " + rb.err : ""}`);
const noi3 = E.contractNoiYr(rec, rb.s.econ, rb.s.holdings[bbl], rb.s.month), noi2 = E.contractNoiYr(rec, g2.econ, g2.holdings[bbl], g2.month);
check(Math.abs((noi3 - noi2) - gr.rentYr) < 2, "and the ground rent comes off the NOI again");
check(Math.abs((ledger(rb.s) - ledger(g2)) - (pos(rb.s) - pos(g2))) < 2, "the buy-back is on the ledger");

console.log(bad ? `\n${bad} FAILED` : "\nall clear");
process.exit(bad ? 1 : 0);
