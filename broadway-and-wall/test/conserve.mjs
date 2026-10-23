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
import { assertFreshBundle } from "./fresh.mjs";
import { leaseAtMarket } from "./leasepolicy.mjs";
import { makeConserveBot } from "./conserve-bot.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(pathToFileURL(join(HERE, ".engine.mjs")).href);   // a file URL: Windows paths are not import specifiers
const { loadCity } = await import(pathToFileURL(join(HERE, "city.mjs")).href);

const { parcels: P0, adjacency, bbls } = loadCity(0, E.normalizeParcels);
const SEEDS = (process.env.SEEDS ?? "550991,12007,73303,11,22,33,4242").split(",").map(Number);
const HZ = Number(process.env.HZ ?? 600);
// A dollar is a dollar. The tolerance exists only for the rounding the engine
// does at the edges of a cent, not to give a real leak somewhere to hide.
const TOL = 1000;
// SETUP_JSON='{"inherit":3}' runs the same bot on a setup-page world (engine/setup.ts).
const SETUP = process.env.SETUP_JSON ? JSON.parse(process.env.SETUP_JSON) : undefined;

// `borrowed` is net new mortgage/facility principal drawn into cash — the
// bucket that closes conserve's old blind spot on cash-out refinance and
// facility draws. See BooksYear.borrowed and engine/debt.ts / facility.ts.
// `lpCalled` / `lpDistributed` are fund equity in/out against the vehicle's
// second cash account — conserve reconciles Δ(cash + fund.cash).
const IN = ["noi", "sold", "interest", "borrowed", "lpCalled", "fees"];
const OUT = ["debtSvc", "leasing", "capex", "dev", "taxes", "bought", "ga", "lpDistributed"];
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
const liquidity = (g) => g.cash + (g.fund?.cash ?? 0);

const rows = [];
let totalBreaks = 0, months = 0, syndicated = 0;
// WHAT THE RUN ACTUALLY TOUCHED. An identity is only worth what it is asked
// about: `Dcash == books + Dloc + Ddeposits` holds trivially for a player who
// does nothing, and this file spent a stretch proving exactly that. Every
// category the bot is supposed to exercise has to move, or the run is not a
// test of anything and says so.
const coverage = {};
for (const k of [...IN, ...OUT]) coverage[k] = 0;

for (const seed of SEEDS) {
  const parcels = JSON.parse(JSON.stringify(P0));
  // the region map (BW_CITY=region) is a region game: its growth, homes and land developers run on it
  const where = process.env.BW_CITY === "region" ? { citySize: "region", cityLots: bbls.length } : undefined;
  let g = E.firstListings(E.newGame(seed, parcels, undefined, SETUP, where), parcels, bbls);
  const START = g.cash;
  const bot = makeConserveBot(E, { seed, START });
  let prev = { cash: liquidity(g), books: bookTotals(g), loc: g.loc?.balance ?? 0, dep: depositsHeld(g) };
  const breaks = [];
  let worst = 0, cum = 0;

  for (let m = 0; m < HZ; m++) {
    g = E.advanceQuarter(g, parcels, bbls, adjacency);
    g = bot.step(g, parcels, m);

    const nb = bookTotals(g), nl = g.loc?.balance ?? 0, nd = depositsHeld(g);
    let inflow = 0, outflow = 0;
    for (const k of IN) inflow += nb[k] - prev.books[k];
    for (const k of OUT) outflow += nb[k] - prev.books[k];
    const explained = inflow - outflow + (nl - prev.loc) + (nd - prev.dep);
    const resid = (liquidity(g) - prev.cash) - explained;
    cum += resid;
    months++;
    if (Math.abs(resid) > TOL) {
      if (Math.abs(resid) > Math.abs(worst)) worst = resid;
      if (breaks.length < 6) {
        // WHICH COMPONENT MOVED. A residual says a dollar has no entry; it does
        // not say which line it should have been on. These are the raw deltas
        // for the failing month, so the next reader starts from evidence rather
        // than from a hypothesis about deposits.
        const parts = {};
        for (const k of [...IN, ...OUT]) { const d = nb[k] - prev.books[k]; if (d) parts[k] = Math.round(d); }
        breaks.push({
          m, resid,
          dCash: Math.round(liquidity(g) - prev.cash),
          dLoc: Math.round(nl - prev.loc),
          dDep: Math.round(nd - prev.dep),
          parts,
          news: (g.news ?? []).filter((n) => n.q === g.month).map((n) => n.text.slice(0, 90)),
        });
      }
    }
    prev = { cash: liquidity(g), books: nb, loc: nl, dep: nd };
    if (g.gameOver) break;
  }
  totalBreaks += breaks.length;
  syndicated += bot.syndicated;
  for (const k of [...IN, ...OUT]) coverage[k] += Math.abs(bookTotals(g)[k] ?? 0);
  // HASH=1: the end state's fingerprint, for proving a refactor changed nothing.
  if (process.env.HASH) {
    const { createHash } = await import("node:crypto");
    console.log(`HASH conserve seed ${seed} ${createHash("sha256").update(JSON.stringify(g)).digest("hex").slice(0, 16)}`);
  }
  rows.push({ seed, breaks, worst, cum });
}

console.log(`\nCONSERVATION — does every dollar come from somewhere?`);
console.log(`${SEEDS.length} seeds x ${HZ} months, a player leasing at market and buying on a clock\n`);
console.log(`seed        out of balance   worst single month   cumulative unexplained`);
for (const r of rows) {
  console.log(`${String(r.seed).padEnd(12)}${String(r.breaks.length ? ">=" + r.breaks.length : "none").padEnd(17)}${M(r.worst).padStart(14)}${M(r.cum).padStart(24)}`);
  for (const b of r.breaks) {
    console.log(`   m${String(b.m).padStart(3)}  unexplained ${M(b.resid)}${b.resid > 0 ? "   (money APPEARED — a liability released with no entry)" : "   (money VANISHED — a payment nobody booked)"}`);
    console.log(`         dCash ${b.dCash}  dLoc ${b.dLoc}  dDeposits ${b.dDep}  books ${JSON.stringify(b.parts)}`);
    for (const n of b.news.slice(0, 4)) console.log(`         · ${n}`);
    for (const n of b.news) console.log(`        | ${n}`);
  }
}
console.log(`\n${"=".repeat(64)}`);

// DID THE RUN ASK THE QUESTION. Before reporting that every dollar came from
// somewhere, check that dollars went anywhere: an identity nothing exercises
// reports a pass it did not earn. `sold` is exempt — the bot only lists when it
// is short, so a run where it never had to is a healthy run, not a dead one.
// `borrowed` is on the income side of the identity — net new mortgage and
// facility principal drawn into cash. A silent exemption here is the same
// fault as the dead bot: both sides zero, the run prints a pass it did not
// earn. `sold` stays exempt — the bot only lists when it is short.
const REQUIRED = ["noi", "interest", "borrowed", "debtSvc", "leasing", "capex", "taxes", "bought", "dev", "ga", "lpCalled", "lpDistributed"];
const dead = REQUIRED.filter((k) => coverage[k] === 0);
console.log(`ledger exercised: ${[...IN, ...OUT].map((k) => `${k} ${coverage[k] ? "yes" : "NO"}`).join("  ")}`);
console.log(`syndicated jobs: ${syndicated} (friends and family in the deal, settled through this identity)`);
if (!syndicated && SEEDS.some((x) => x % 2 === 1)) {
  console.log(`\nFAIL  no odd seed broke ground with outside equity — the syndicate's flows went untested.`);
  process.exit(1);
}
if (dead.length) {
  console.log(`\nFAIL  the bot never moved ${dead.join(", ")} — this run proved nothing.`);
  console.log(`      An identity holds trivially for a player who does not transact. Check the`);
  console.log(`      bot's cash thresholds against the opening bankroll before reading anything`);
  console.log(`      else in this file: that is exactly how it broke last time.`);
  process.exit(1);
}

if (totalBreaks === 0) {
  console.log(`${months.toLocaleString()} months reconciled. Every dollar came from somewhere.`);
} else {
  console.log(`${totalBreaks} month(s) do not balance across ${months.toLocaleString()} reconciled.`);
  console.log(`A residual is not a rounding error — it is a cash movement with no entry behind it.`);
}
process.exit(totalBreaks === 0 ? 0 : 1);
