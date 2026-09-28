// THE SHEET AND THE NET WORTH ARE ONE NUMBER, AND A FUND ENDS AT NAV.
//
// Two faults, one fixture. Books' balance sheet summed every deed at 100% —
// the fund's buildings, a JV partner's share, no mezz — and its equity line
// disagreed with the engine net worth printed above it on the same page (by
// +47% on one measured run). And settling a fund paid the LPs from cash alone
// and left the vehicle's buildings on the sponsor's books at 100%: $5.00M →
// $10.72M of sponsor net worth in the settlement month. This holds the sheet
// to portfolioMark every month of a run with a live fund, a JV and a wind-down,
// and holds the wind-down to the continuity a buy-in at NAV implies.
//
//   pnpm engine && node test/fundsheet.mjs
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

console.log("\nFUND SHEET — the balance sheet is net worth; a fund ends at NAV\n");
let g = E.firstListings(E.newGame(7919, parcels, 40_000_000), parcels, bbls);
// Stand the vehicle up the way raiseFund does (a fresh firm is not eligible
// to raise): the co-invest moves from GP cash, the LPs' first call arrives.
{
  const size = 30_000_000, gpCommit = Math.round(size * 0.03), lp = Math.round((size - gpCommit) * 0.6);
  g = structuredClone(g);
  g.cash -= gpCommit;
  g.fund = { raisedM: g.month, size, uncalled: size - gpCommit - lp, cash: lp + gpCommit, called: lp + gpCommit,
    distributed: 0, promotePaid: 0, prefAccrued: 0, investEndM: g.month + 18, lifeEndM: g.month + 30,
    pref: 0.08, promote: 0.2, gpCommit };
}
const buy = (fromFund, maxAsk) => {
  for (const li of g.listings) {
    const rec = E.resolveRec(parcels, g, li.bbl);
    if (!rec || rec.class === "land" || !rec.bldgArea || li.halfBuilt || li.ask > maxAsk) continue;
    const s0 = { ...g, fundPay: fromFund };
    const r = E.executePurchase(s0, parcels, li.bbl, li.ask, "savings", false, 1);
    if (!r.err && r.s.holdings[li.bbl]) { g = { ...r.s, fundPay: false }; return li.bbl; }
  }
  return null;
};
const f1 = buy(true, 12_000_000), f2 = buy(true, 12_000_000);
const own = buy(false, 8_000_000);
check(!!f1 && !!f2 && g.holdings[f1]?.fundOwned && g.holdings[f2]?.fundOwned, `two vehicle deeds (${f1}, ${f2})`);
check(!!own && !g.holdings[own]?.fundOwned, `one of the sponsor's own (${own})`);
for (let m = 0; m < 3; m++) g = E.advanceMonth(g, parcels, bbls, adjacency);
const st = E.sellStake(g, parcels, own, 0.25);
if (!st.err) g = st.s;
check(!!g.holdings[own]?.jv, `a JV partner in it${st.err ? " — " + st.err : ""}`);

let worst = 0, worstM = -1, extended = false, settledM = -1, jump = 0, months = 0;
let prevNw = E.netWorth(g, parcels);
for (let m = 0; m < 60; m++) {
  g = E.advanceMonth(g, parcels, bbls, adjacency);
  if (g.gameOver) g = { ...g, gameOver: null, cash: Math.max(g.cash, 6e6) };
  months++;
  const sh = E.buildBalanceSheet(g, parcels);
  const gap = Math.abs(sh.equity - sh.nwEngine);
  if (gap > worst) { worst = gap; worstM = g.month; }
  if (g.fund?.extendedTo !== undefined) extended = true;
  const nw = E.netWorth(g, parcels);
  if (settledM < 0 && g.fund?.settled) { settledM = g.month; jump = (nw - prevNw) / Math.max(1, Math.abs(prevNw)); }
  prevNw = nw;
}
check(worst < 2, `the sheet's equity is the engine net worth every month for ${months} months (worst gap ${K(worst)}${worstM >= 0 ? ` at m${worstM}` : ""})`);
check(extended, "a fund whose life ends with buildings in it runs into its extension rather than settling on cash");
check(settledM >= 0, `the fund settles (m${settledM})`);
check(!Object.values(g.holdings).some((h) => h.fundOwned), "no vehicle deed is left behind on the sponsor's book after settlement");
check(Math.abs(jump) < 0.05, `net worth moves by the GP's unearned share at the buy-in, not by the LPs' buildings (${(jump * 100).toFixed(1)}% in the settlement month)`);

console.log(bad ? `\n${bad} FAILED` : "\nall clear");
process.exit(bad ? 1 : 0);
