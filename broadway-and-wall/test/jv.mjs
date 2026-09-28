// A PARTNER IN ONE BUILDING, AND THE FUND'S WATERFALL.
//
// The stake sells at a minority discount and moves net worth by exactly that
// discount, its costs and its tax; the partner then takes its share of every
// month's cash and every exit and funds its share of every call, all on the
// ledger; the big decisions wait on a buy-out. The fund pays the pref, then
// the capital, and only then the promote — and the sponsor's net worth holds
// what that waterfall would pay them, not the vehicle's buildings at 100%.
//
//   pnpm engine && node test/jv.mjs
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
const book = (g, k) => (g.books ?? []).reduce((a, e) => a + (e[k] ?? 0), 0);
const deposits = (g) => Object.values(g.holdings).reduce((a, h) => a + h.tenants.reduce((b, t) => b + (t.deposit ?? 0), 0), 0);
const pos = (g) => g.cash + (g.fund?.cash ?? 0) - (g.loc?.balance ?? 0) - deposits(g);

console.log("\nJV — a partner in one building\n");
let g = E.firstListings(E.newGame(12007, parcels, 12_000_000), parcels, bbls);
let bbl = null;
for (const li of g.listings) {
  const rec = E.resolveRec(parcels, g, li.bbl);
  if (!rec || rec.class === "land" || !rec.bldgArea || li.halfBuilt || li.ask > 6_000_000) continue;
  const r = E.executePurchase(g, parcels, li.bbl, li.ask, "savings", false, 1);
  if (!r.err && r.s.holdings[li.bbl]?.loan) { g = r.s; bbl = li.bbl; break; }
}
check(!!bbl, `a let building on a mortgage (${bbl})`);
for (let m = 0; m < 3; m++) g = E.advanceMonth(g, parcels, bbls, adjacency);

const q = E.stakeQuote(g, parcels, bbl, 0.25);
check(q.ok, `a quote on 25%: equity ${K(q.equity)}, they pay ${K(q.price)}, tax ${K(q.tax)}${q.why ? " — " + q.why : ""}`);
check(Math.abs(q.price - q.equity * 0.25 * (1 - E.JV_MINORITY_DISCOUNT) * (1 - E.JV_DEAL_COST)) < 2, "priced at the pro-rata equity less the minority discount and counsel");
check(!E.stakeQuote(g, parcels, bbl, 0.6).ok, "a controlling stake is not on offer");
const nw0 = E.netWorth(g, parcels), cash0 = g.cash, led0 = ledger(g);
const r = E.sellStake(g, parcels, bbl, 0.25);
check(!r.err, `sold${r.err ? ": " + r.err : ""}`);
const g1 = r.s;
check(Math.abs((g1.cash - cash0) - q.toOwner) < 2 && Math.abs((ledger(g1) - led0) - (g1.cash - cash0)) < 2, `cash rises by the quote (${K(g1.cash - cash0)}) and it is on the ledger`);
const give = q.equity * 0.25 - q.price;
const dNw = E.netWorth(g1, parcels) - nw0;
check(Math.abs(dNw + give + q.tax) < Math.max(5_000, 0.02 * (give + q.tax)), `net worth moves by the discount, counsel and tax: ${K(dNw)} against ${K(give + q.tax)}`);

// guards
for (const [name, fn] of [["refinance to a new product is allowed", null], ["pay-down", () => E.paydownLoan(g1, parcels, bbl, 1000)], ["payoff", () => E.payOffLoan(g1, parcels, bbl)], ["renovation", () => E.startRenovation(g1, parcels, bbl)], ["selling the land", () => E.sellLandLeaseBack(g1, parcels, bbl)], ["demolition", () => E.demolish(g1, parcels, bbl)], ["a second stake", () => E.sellStake(g1, parcels, bbl, 0.25)]]) {
  if (!fn) continue;
  const x = fn();
  check(!!x.err, `${name} needs the partner (${(x.err ?? "went through").slice(0, 60)})`);
}

// two years: the month's cash splits, the calls come in, the books reconcile
let g2 = g1, drift = 0;
const dist0 = book(g1, "lpDistributed"), call0 = book(g1, "lpCalled");
for (let m = 0; m < 24; m++) {
  const p0 = pos(g2), l0 = ledger(g2);
  g2 = E.advanceMonth(g2, parcels, bbls, adjacency);
  drift = Math.max(drift, Math.abs((pos(g2) - p0) - (ledger(g2) - l0)));
}
check(drift < 5, `24 months reconcile to the ledger (worst month $${drift.toFixed(2)})`);
const dist = book(g2, "lpDistributed") - dist0, calls = book(g2, "lpCalled") - call0;
check(dist > 0, `the partner was paid its share: ${K(dist)} out, ${K(calls)} called in over two years`);

// exit: the partner is paid at the closing table, and taxed on its own share
const h2 = g2.holdings[bbl];
const price = Math.round(E.ownedHoldingValue(g2, parcels, h2));
const px = E.saleProceedsToSeller(g2, parcels, h2, price);
const owners = px.toSeller + px.partner;
check(Math.abs(px.partner - Math.round(owners * 0.25)) <= 1, `a sale at ${K(price)}: ${K(owners)} to the owners, ${K(px.partner)} of it to the partner`);
const full = E.saleTaxQuote(h2, price, g2).tax;
check(px.tax <= full, `and you are taxed on your share (${K(px.tax)} against ${K(full)} on the whole)`);

// buy-out
const cost = E.buyoutCost(g2, parcels, h2);
const rb = E.buyOutPartner(g2, parcels, bbl);
check(!rb.err && !rb.s.holdings[bbl].jv, `bought out for ${K(cost)}${rb.err ? ": " + rb.err : ""}`);
check(Math.abs((ledger(rb.s) - ledger(g2)) - (pos(rb.s) - pos(g2))) < 2, "the buy-out is on the ledger");
check(!E.paydownLoan(rb.s, parcels, bbl, 1000).err, "and the decisions are yours again");

console.log("\nTHE FUND'S WATERFALL\n");
const f = { called: 10_000_000, gpCommit: 300_000, prefAccrued: 400_000, capReturned: 0, promote: 0.2 };
const w1 = E.waterfall(f, 5_000_000);
check(w1.pref === 400_000 && w1.capital === 4_600_000 && w1.promote === 0, `$5M out of a $10M fund: pref ${K(w1.pref)}, capital ${K(w1.capital)}, promote ${K(w1.promote)} — no promote before the capital is back`);
const w2 = E.waterfall(f, 12_000_000);
check(w2.capital === 10_000_000 && w2.promote === Math.round(1_600_000 * 0.2), `$12M out: capital back in full, promote ${K(w2.promote)} on the ${K(1_600_000)} of profit`);
check(Math.abs(w2.toGpCoinvest - (w2.pref + w2.capital + w2.split) * 0.03) < 2, `the 3% co-invest takes its share of every tier below the promote (${K(w2.toGpCoinvest)})`);
check(E.gpInterestInFund({ ...f, settled: false, prefAccrued: 0 }, 10_000_000) === 300_000, "at cost, the sponsor's interest in the fund is exactly the co-invest");

// the raise does not move net worth; buying with LP money does not add it
{
  let s = E.firstListings(E.newGame(7919, parcels, 40_000_000), parcels, bbls);
  s = { ...s, sponsor: { ...(s.sponsor ?? {}) } };
  const quote = E.fundRaiseQuote(s);
  if (quote.ok) {
    const n0 = E.netWorth(s, parcels);
    const rr = E.raiseFund(s);
    const n1 = E.netWorth(rr.s, parcels);
    check(Math.abs(n1 - n0) < 5_000, `raising the fund leaves net worth where it was (${K(n0)} → ${K(n1)})`);
  } else {
    // Not eligible to raise on a fresh firm — stand the vehicle up the way
    // raiseFund does: the co-invest moves from GP cash, the LPs' call arrives.
    const n0 = E.netWorth(s, parcels);
    const size = 20_000_000, gpCommit = Math.round(size * 0.03), lp = Math.round((size - gpCommit) * 0.6);
    const s1 = structuredClone(s);
    s1.cash -= gpCommit;
    s1.fund = { raisedM: s1.month, size, uncalled: size - gpCommit - lp, cash: lp + gpCommit, called: lp + gpCommit,
      distributed: 0, promotePaid: 0, prefAccrued: 0, investEndM: s1.month + 60, lifeEndM: s1.month + 120,
      pref: 0.08, promote: 0.2, gpCommit };
    const n1 = E.netWorth(s1, parcels);
    check(Math.abs(n1 - n0) < 5, `a vehicle stood up leaves net worth where it was (${K(n0)} → ${K(n1)}; it moved by the co-invest before)`);
  }
}

console.log(bad ? `\n${bad} FAILED` : "\nall clear");
process.exit(bad ? 1 : 0);
