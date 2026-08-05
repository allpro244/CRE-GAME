// CONSERVATION — every dollar came from somewhere.
//
//   pnpm conserve                 seven seeds, fifty years each
//   SEEDS=11,22 pnpm conserve     a subset
//   HZ=120 pnpm conserve          a quick pass
//
// The engine records a P&L through `logBooks` and it enforces nothing. There
// are eighty places that write `s.cash` against fifty-nine that write to the
// ledger, and for most of this project's life nobody had checked whether those
// two agree. They did not. A NaN once ate the player's entire bankroll in
// silence because there was nothing in the model whose job was to notice.
//
// This is that job. Every month, the change in cash must equal what the books
// say happened, plus the two balance-sheet movements that ARE cash and are not
// income or expense — drawing or repaying the revolver, and taking or handing
// back a tenant deposit:
//
//   Dcash  ==  (noi + sold + interest)
//            - (debtSvc + leasing + capex + dev + taxes + bought + ga)
//            + Dloc.balance
//            + Ddeposits
//
// Anything left over is a dollar that moved without telling anyone. The sign
// says what kind of fault it is: money DISAPPEARING is a payment nobody
// booked, money APPEARING is a liability released without recording the gain.
// Both were real and both were found by this file — the balloon shortfall at
// a maturity, which is the largest cheque a levered owner ever writes and was
// invisible on the Books page, and the forfeited deposit of a tenant who went
// dark, which improved net worth with no entry anywhere.
//
// It is a MEASUREMENT, not a runtime assertion. It belongs in the harnesses
// where it can run a hundred thousand months, not in the tick where it would
// cost every player a reconciliation they did not ask for.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

const { parcels: P0, adjacency, bbls } = loadCity(0, E.normalizeParcels);
const SEEDS = (process.env.SEEDS ?? "550991,12007,73303,11,22,33,4242").split(",").map(Number);
const HZ = Number(process.env.HZ ?? 600);
// A dollar is a dollar. The tolerance exists only for the rounding the engine
// does at the edges of a cent, not to give a real leak somewhere to hide.
const TOL = 1000;

const IN = ["noi", "sold", "interest"];
const OUT = ["debtSvc", "leasing", "capex", "dev", "taxes", "bought", "ga"];
const M = (n) => `$${(n / 1e6).toFixed(3)}M`;

const bookTotals = (g) => {
  const t = {};
  for (const k of [...IN, ...OUT]) t[k] = 0;
  for (const y of g.books ?? []) for (const k of [...IN, ...OUT]) t[k] += y[k] ?? 0;
  return t;
};
const depositsHeld = (g) => {
  let d = 0;
  for (const h of Object.values(g.holdings ?? {})) for (const t of h.tenants ?? []) d += t.deposit ?? 0;
  return d;
};

const rows = [];
let totalBreaks = 0, months = 0;

for (const seed of SEEDS) {
  const parcels = JSON.parse(JSON.stringify(P0));
  let g = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
  let prev = { cash: g.cash, books: bookTotals(g), loc: g.loc?.balance ?? 0, dep: depositsHeld(g) };
  const breaks = [];
  let worst = 0, cum = 0;

  for (let m = 0; m < HZ; m++) {
    g = E.advanceQuarter(g, parcels, bbls, adjacency);
    // A PLAYER WHO ACTUALLY DOES THINGS. An idle run exercises almost none of
    // the cash paths: no purchases, no debt, no leasing, no capex, no balloon.
    // Leasing at market and buying on a clock walks most of the ledger.
    for (const loi of [...g.lois]) {
      const rec = E.resolveRec(parcels, g, loi.bbl), h = g.holdings[loi.bbl];
      if (!rec || !h) continue;
      const mkt = E.managedRentPsfYr(rec, g.econ, h, loi.use);
      const r = E.respondLOI(g, parcels, loi.id, loi.rentPsf >= mkt * 0.92 ? "accept" : "pass");
      if (!r.err) g = r.s;
    }
    // ...AND IT KEEPS A RESERVE, because a bot that buys on a clock regardless
    // of its balance is not exercising the ledger, it is racing to insolvency.
    //
    // This file stops at gameOver, so how long the bot lives IS how many
    // months get reconciled — and that fell from 3,385 to 1,987 across two
    // changes that stopped rents compounding. Diagnosed rather than assumed:
    // it died at year 4 to 17 every time with a POSITIVE net worth ($7M to
    // $105M peak) and cash of -$0.1M to -$2.5M. Not a firm the economy broke;
    // a levered buyer with no liquidity management, which used to be bailed
    // out by rent growth that was itself the bug.
    //
    // Fixing the bot rather than the economy is the whole point of the
    // distinction: conserve tests the LEDGER IDENTITY, and it needs the bot
    // alive to test it over fifty years, not to prove the bot is any good.
    // Nothing here touches an engine number.
    if (m % 9 === 0 && g.cash > 4_000_000) {
      for (const li of [...g.listings].slice(0, 5)) {
        const rec = E.resolveRec(parcels, g, li.bbl);
        if (!rec || g.holdings[li.bbl] || rec.class === "land") continue;
        if (li.ask > E.assetValue(rec, g.econ, E.initialCondition(rec))) continue;
        // Leave a working balance behind, the way anybody solvent does.
        if (li.ask * 0.35 > g.cash - 2_500_000) continue;
        const r = E.executePurchase(g, parcels, li.bbl, li.ask, "senior", false, 1);
        if (!r.err) { g = r.s; break; }
      }
    }
    // A LANDLORD SHORT OF CASH SELLS SOMETHING. Without an exit the bot can
    // only ever accumulate, so one bad decade ends it no matter how much
    // equity it is sitting on — which is a fact about the bot, not the world.
    if (g.cash < 1_200_000) {
      const own = Object.keys(g.holdings).filter((b) => !g.holdings[b].sale);
      if (own.length > 1) {
        const bbl = own[0];
        const rec = E.resolveRec(parcels, g, bbl);
        if (rec) {
          const r = E.listForSale(g, parcels, bbl, Math.round(E.assetValue(rec, g.econ, E.initialCondition(rec)) * 0.92));
          if (!r.err) g = r.s;
        }
      }
    }
    for (const bbl of Object.keys(g.holdings)) {
      const off = g.holdings[bbl].sale?.offer;
      if (off && g.cash < 3_000_000) {
        const r = E.acceptSaleOffer(g, parcels, bbl);
        if (!r.err) g = r.s;
      }
    }

    const nb = bookTotals(g), nl = g.loc?.balance ?? 0, nd = depositsHeld(g);
    let inflow = 0, outflow = 0;
    for (const k of IN) inflow += nb[k] - prev.books[k];
    for (const k of OUT) outflow += nb[k] - prev.books[k];
    const explained = inflow - outflow + (nl - prev.loc) + (nd - prev.dep);
    const resid = (g.cash - prev.cash) - explained;
    cum += resid;
    months++;
    if (Math.abs(resid) > TOL) {
      if (Math.abs(resid) > Math.abs(worst)) worst = resid;
      if (breaks.length < 6) {
        breaks.push({ m, resid, news: (g.news ?? []).filter((n) => n.q === g.month).map((n) => n.text.slice(0, 90)) });
      }
    }
    prev = { cash: g.cash, books: nb, loc: nl, dep: nd };
    if (g.gameOver) break;
  }
  totalBreaks += breaks.length;
  rows.push({ seed, breaks, worst, cum });
}

console.log(`\nCONSERVATION — does every dollar come from somewhere?`);
console.log(`${SEEDS.length} seeds x ${HZ} months, a player leasing at market and buying on a clock\n`);
console.log(`seed        out of balance   worst single month   cumulative unexplained`);
for (const r of rows) {
  console.log(`${String(r.seed).padEnd(12)}${String(r.breaks.length ? ">=" + r.breaks.length : "none").padEnd(17)}${M(r.worst).padStart(14)}${M(r.cum).padStart(24)}`);
  for (const b of r.breaks) {
    console.log(`   m${String(b.m).padStart(3)}  unexplained ${M(b.resid)}${b.resid > 0 ? "   (money APPEARED — a liability released with no entry)" : "   (money VANISHED — a payment nobody booked)"}`);
    for (const n of b.news) console.log(`        | ${n}`);
  }
}
console.log(`\n${"=".repeat(64)}`);
if (totalBreaks === 0) {
  console.log(`${months.toLocaleString()} months reconciled. Every dollar came from somewhere.`);
} else {
  console.log(`${totalBreaks} month(s) do not balance across ${months.toLocaleString()} reconciled.`);
  console.log(`A residual is not a rounding error — it is a cash movement with no entry behind it.`);
}
process.exit(totalBreaks === 0 ? 0 : 1);
