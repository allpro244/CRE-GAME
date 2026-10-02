// THE INCOME STATEMENT AGREES WITH THE LEDGER AND THE RETURN.
//
//   pnpm engine && node test/pnl.mjs          SEEDS=11,22 HZ=180
//
// The accrual statement on the Books page (engine/books.ts pnlView) is a
// second reading of the same firm, and a second reading is only worth having
// if it cannot drift from the first. A levered buy-and-hold book, leased at
// market, and three identities checked every year:
//
//   1. every line the P&L takes from the cash ledger (NOI, leasing, capital
//      work, overhead, interest on cash, tax) equals the ledger's own figure —
//      no fund in play, so nothing is consolidated out;
//   2. revenue less property operating cost IS the ledger's NOI;
//   3. depreciation on the closed years sums to what the returns took
//      (`deprTaken` on every deed — nothing is sold, so nothing leaves);
//
// and the statement must not be trivially satisfied: revenue, interest
// expense and depreciation all have to move, or the run says so and fails.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { leaseAtMarket } from "./leasepolicy.mjs";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const SEEDS = (process.env.SEEDS ?? "11,22").split(",").map(Number);
const HZ = Number(process.env.HZ ?? 180);

let bad = 0;
const fail = (m) => { bad++; console.log(`  FAIL  ${m}`); };
const near = (a, b) => Math.abs(a - b) <= Math.max(2, Math.abs(b) * 1e-9);
const moved = { rev: 0, intExp: 0, depr: 0 };

console.log("\nINCOME STATEMENT — does the P&L agree with the ledger and the return?\n");
for (const seed of SEEDS) {
  const { parcels: P0, bbls } = loadCity(0, E.normalizeParcels);
  const parcels = JSON.parse(JSON.stringify(P0));
  let g = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
  g = { ...g, cash: 60e6 };
  for (let m = 0; m < HZ; m++) {
    if (Object.keys(g.holdings).length < 5 && m % 4 === 0) {
      for (const L of g.listings ?? []) {
        const rec = E.resolveRec(parcels, g, L.bbl);
        if (!rec || rec.class === "land" || !rec.bldgArea || g.holdings[L.bbl]) continue;
        const r = E.executePurchase(g, parcels, L.bbl, L.ask, "harbor", false, 0.6);
        if (r?.s?.holdings[L.bbl]) { g = r.s; break; }
      }
    }
    g = E.advanceQuarter(g, parcels, bbls, null);
    if (g.gameOver) break;
    g = leaseAtMarket(E, g, parcels);
  }
  const books = new Map((g.books ?? []).map((b) => [b.yr, b]));
  let years = 0;
  for (const e of g.pnl ?? []) {
    const b = books.get(e.yr);
    if (!b) { fail(`seed ${seed} yr ${e.yr}: P&L year with no ledger year`); continue; }
    years++;
    for (const [pk, bk] of [["noi", "noi"], ["leasing", "leasing"], ["capex", "capex"], ["ga", "ga"], ["intInc", "interest"], ["taxes", "taxes"]]) {
      if (!near(e[pk], b[bk] ?? 0)) fail(`seed ${seed} yr ${e.yr}: P&L ${pk} ${e[pk].toFixed(0)} vs ledger ${bk} ${(b[bk] ?? 0).toFixed(0)}`);
    }
    const v = E.pnlView(g, e);
    if (!near(v.rev - v.propOpex, b.noi)) fail(`seed ${seed} yr ${e.yr}: revenue less opex ${(v.rev - v.propOpex).toFixed(0)} is not NOI ${b.noi.toFixed(0)}`);
    for (const [k, x] of Object.entries(v)) if (typeof x === "number" && !Number.isFinite(x)) fail(`seed ${seed} yr ${e.yr}: ${k} is ${x}`);
    if (e.rev > 0) moved.rev++;
    if (e.intExp > 0) moved.intExp++;
    if (e.depr > 0) moved.depr++;
  }
  const closed = (g.pnl ?? []).filter((e) => e.deprFinal).reduce((a, e) => a + e.depr, 0);
  const taken = Object.values(g.holdings).reduce((a, h) => a + (h.deprTaken ?? 0), 0);
  const sold = (g.exits ?? []).length;
  if (sold === 0 && Math.abs(closed - taken) > 2 * (g.pnl ?? []).length) {
    fail(`seed ${seed}: closed-year depreciation ${closed.toFixed(0)} vs the returns' ${taken.toFixed(0)}`);
  }
  const last = (g.pnl ?? []).filter((e) => e.deprFinal).at(-1);
  const lv = last ? E.pnlView(g, last) : null;
  console.log(`  seed ${seed}: ${years} years, ${Object.keys(g.holdings).length} deeds, ${sold} sold · closed depr ${(closed / 1e6).toFixed(2)}M vs returns ${(taken / 1e6).toFixed(2)}M`
    + (lv ? ` · ${lv.label}: revenue ${(lv.totalRev / 1e6).toFixed(2)}M, interest ${(lv.intExp / 1e6).toFixed(2)}M, net ${(lv.net / 1e6).toFixed(2)}M` : ""));
}
for (const [k, n] of Object.entries(moved)) if (!n) fail(`${k} never moved — the statement is reconciling nothing`);
console.log(bad ? `\n${bad} failure(s)\n` : "\nThe income statement reads the same firm the ledger and the return do.\n");
process.exit(bad ? 1 : 0);
