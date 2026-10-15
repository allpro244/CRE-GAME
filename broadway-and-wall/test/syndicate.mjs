// DEAL-BY-DEAL SYNDICATION — friends and family in one job, end to end.
//   pnpm engine && node test/syndicate.mjs
//   SEEDS=9401 node test/syndicate.mjs
//
// Part A checks the waterfall's arithmetic on deals whose answer is known by
// hand. Part B plays a $1M sponsor (the plan's headline case) who cannot
// build alone: it buys a lot, breaks
// ground with its friends and family in the deal, leases the building, sells
// it, and watches the syndicate wind up. Every month it holds the cash
// identity conserve holds (Δcash = books + Δline + Δdeposits) and the
// syndicate invariants, and it asserts the sponsor's net worth does not jump
// when the investors' money arrives (CAPITAL_RAISING_PLAN.md §4, §0.5 step 4).
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));

let fails = 0;
const ok = (c, m) => { console.log(`  ${c ? "OK  " : "FAIL"}  ${m}`); if (!c) fails++; };
const M = (n) => `$${(n / 1e6).toFixed(3)}M`;
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;

// ── A. THE WATERFALL ────────────────────────────────────────────────────────
console.log("\nA. the waterfall, on deals worked by hand");
const deal = () => ({
  bbl: "x", investor: "t", formedM: 0, lpShare: 0.5, lpCommit: 1e6, lpCalled: 0, lpDist: 0, gpIn: 0, gpDist: 0,
  hurdles: [0.12, 0.15], promotes: [0, 0.10], lpBal: [0, 0], gpBal: 0, lpCap: 0, gpCap: 0,
  pending: 0, tagged: 0, settled: 0, lpFlows: [],
});
{
  // $1M each side, a year, paid out at exactly the 12% pref: each takes 1.12M.
  const w = deal();
  E.contribute(w, 1e6, 1e6);
  for (let m = 0; m < 12; m++) E.accrueMonth(w);
  const r = E.distribute(w, 2_240_000);
  ok(near(r.lp, 1_120_000, 2) && near(r.gp, 1_120_000, 2), `at the pref, pari passu: LP ${r.lp}, GP ${r.gp}`);
}
{
  // Above the 15% hurdle the GP takes 10% of the excess on top of its half.
  // LP owed 1.12M at the pref, then 30K more to reach 15% (60K total at
  // 50/50), then 45% of the rest: of 3.0M, LP = 1.12 + 0.03 + 0.45 × 1.70.
  const w = deal();
  E.contribute(w, 1e6, 1e6);
  for (let m = 0; m < 12; m++) E.accrueMonth(w);
  const r = E.distribute(w, 3_000_000);
  const want = 1_120_000 + 30_000 + 0.45 * (3_000_000 - 2_240_000 - 60_000);
  ok(near(r.lp, want, 3), `above 15%, a 10% promote: LP ${r.lp} (by hand ${Math.round(want)}), GP ${r.gp}`);
  ok(r.lp + r.gp === 3_000_000, "every dollar distributed to someone");
}
{
  // A loss is shared pro rata: half the money back, half to each side.
  const w = deal();
  E.contribute(w, 1e6, 1e6);
  for (let m = 0; m < 12; m++) E.accrueMonth(w);
  const r = E.distribute(w, 1_000_000);
  ok(near(r.lp, 500_000, 2), `a loss is pari passu: LP ${r.lp} of 1.0M`);
}
{
  // NETTING. A month of +100 rent and −60 cost settles as one +40 through the
  // waterfall — never +100 at the promote and −60 pro rata, which would hand
  // the sponsor promote on gross revenue.
  const w = deal();
  E.contribute(w, 1e6, 1e6);
  w.lpBal = [0, 0]; w.gpBal = 0;   // both already past every hurdle
  w.pending = 100 - 60;
  const r = E.settlePeriod(w, 1, true);
  ok(r.lp === Math.round(40 * 0.45) && w.pending === 0, `a month nets before it settles: LP ${r.lp} of +40`);
  // A shortfall is a call at lpShare until the commitment is used, then the sponsor's.
  const v = deal(); v.lpCommit = 300;
  v.pending = -1000;
  const c = E.settlePeriod(v, 1, true);
  ok(c.cash === 300 && v.gpIn === 700, `a call past the commitment is the guarantor's: LP ${c.cash}, GP ${v.gpIn}`);
  const gone = deal(); gone.pending = -1000;
  ok(E.settlePeriod(gone, 1, false).cash === 0, "nobody calls the investors once the deed has gone");
}
{
  const irr = E.seriesIrr([0, -100, 12, 112]);
  ok(irr !== null && near(irr, 0.12, 1e-4), `IRR of −100 then +112 a year on: ${(irr * 100).toFixed(2)}%`);
}

// ── B. A SPONSOR WHO CANNOT BUILD ALONE ─────────────────────────────────────
console.log("\nB. friends and family in one job, groundbreak to wind-up");
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels: P0, bbls, adjacency } = loadCity(0, E.normalizeParcels);
// Whether a $1M sponsor finds a lot that nearly pencils inside fifteen years
// moves with the economy; five seeds keep at least two deals in reach.
const SEEDS = (process.env.SEEDS ?? "9401,9402,9403,9404,9405").split(",").map(Number);
const HZ = Number(process.env.HZ ?? 180);
const IN = ["noi", "sold", "interest", "borrowed", "lpCalled", "fees"];
const OUT = ["debtSvc", "leasing", "capex", "dev", "taxes", "bought", "ga", "lpDistributed"];
const books = (g) => { let t = 0; for (const y of g.books ?? []) { for (const k of IN) t += y[k] ?? 0; for (const k of OUT) t -= y[k] ?? 0; } return t; };
const deposits = (g) => { let d = 0; for (const h of Object.values(g.holdings)) for (const t of h.tenants ?? []) d += t.deposit ?? 0; return d; };

let formed = 0, closed = 0, worstResid = 0, viol = 0, firstViol = null;
// One sponsor, one deal, groundbreak to wind-up. `band` pins how investors
// read the sponsor at the closing (the terms, and the fees, lock in then).
function play(seed, band) {
  let lastRec = null, lastG = null;
  const parcels = JSON.parse(JSON.stringify(P0));
  let g = E.firstListings(E.newGame(seed, parcels, 1_000_000), parcels, bbls);
  let lot = null, prev = null, formedAt = null, soldListed = false;
  for (let m = 0; m < HZ && !g.gameOver; m++) {
    prev = { cash: g.cash, books: books(g), loc: g.loc?.balance ?? 0, dep: deposits(g) };
    // FIND, BUY AND BREAK GROUND: a land listing with a scheme that (nearly)
    // pencils and needs more cash than the sponsor has — so the investors are
    // load-bearing. Most dirt does not pencil (CLAUDE.md), so the bot takes a
    // thin margin (hurdle ≥ 0.85): this harness tests the plumbing of the deal,
    // and an investor loss is a path it should walk too.
    if (!formedAt && g.month % 3 === 0) {
      const own0 = E.fundableNow(g, parcels);
      let pick = null;
      for (const L of g.listings ?? []) {
        const rec = E.resolveRec(parcels, g, L.bbl);
        if (!rec || rec.class !== "land" || L.ask > own0 * 0.8) continue;
        for (const u of ["multifamily", "office", "retail", "industrial"]) for (const f of [2, 3, 4, 6, 8, 12]) {
          const p = E.planDevelopment(g, parcels, L.bbl, u, f, 0.6, "gmp");
          if (!p || p.hurdleRatio < 0.85) continue;
          const need = E.devFundingNeed(p).whole;
          if (need <= own0 - L.ask || need > (own0 - L.ask) * 2.2) continue;   // needs the investors, within 1:1 reach
          if (!pick || p.hurdleRatio > pick.p.hurdleRatio) pick = { L, u, f, p };
        }
      }
      if (pick) {
        const r = E.executePurchase(g, parcels, pick.L.bbl, pick.L.ask, "cash", false, 1);
        if (!r.err && r.s.holdings[pick.L.bbl]) {
          const g1 = r.s, b = pick.L.bbl;
          const own = E.fundableNow(g1, parcels);
          const land = E.ownedHoldingValue(g1, parcels, g1.holdings[b]);
          const p = E.planDevelopment(g1, parcels, b, pick.u, pick.f, 0.6, "gmp");
          const need = p ? E.devFundingNeed(p).whole : Infinity;
          const outside = E.maxOutside(g1, need, land);
          const nw0 = E.netWorth(g1, parcels), c0 = g1.cash;
          // The same groundbreaking without investors, for comparison: points
          // and a rate hedge are cash that leaves net worth either way.
          // (Topped up with idle cash so it can close; idle cash moves nothing.)
          const rich = { ...g1, cash: g1.cash + need };
          const nwRich = E.netWorth(rich, parcels);
          const solo = p ? E.startDevelopment(rich, parcels, b, pick.u, pick.f, 0.6, "gmp") : { err: "no plan" };
          const dNwSolo = solo.err ? null : E.netWorth(solo.s, parcels) - nwRich;
          if (band) g1.reputation = { band, score: 30, rank: 1, of: 30, m: g1.month };
          const rr = p ? E.startDevelopment(g1, parcels, b, pick.u, pick.f, 0.6, "gmp", undefined, { syndicate: { outside } }) : { err: "no plan" };
          if (!rr.err) {
            g = rr.s; lot = b;
            const w = g.syndications[lot];
            const dNw = E.netWorth(g, parcels) - nw0;
            console.log(`seed ${seed} m${g.month}: ${pick.u} ${pick.f}fl on ${lot} (hurdle ${p.hurdleRatio.toFixed(2)}) · cash equity ${M(need)} · own ${M(own)} · friends and family ${M(w.lpCommit)} (${Math.round(w.lpShare * 100)}% of calls) · called at close ${M(w.lpCalled)} · Δcash ${M(g.cash - c0)} · Δnet worth ${M(dNw)}`);
            ok(w.lpCalled > 0 && w.lpCalled <= w.lpCommit, `seed ${seed}: the investors funded their share of the close`);
            // Their money arriving moves net worth only as the same groundbreaking
            // done alone would, at the sponsor's share of the capital: the
            // costs a closing sinks (points, a rate hedge) are the deal's,
            // and the investors carry their share of them. A groundbreaking that
            // marks UP is a gain the waterfall splits with the promote, so the
            // sponsor's share of it is its capital share plus at most the top
            // promote on the investors' share.
            const gp = 1 - E.lpCapShare(w);
            const vs = (dNwSolo ?? 0) * gp;
            const top = (dNwSolo ?? 0) > 0 ? (dNwSolo ?? 0) * (gp + (1 - gp) * Math.max(0, ...w.promotes)) : vs;
            ok(dNw >= Math.min(vs, top) - 0.01 * need && dNw <= Math.max(vs, top) + 0.01 * need, `seed ${seed}: net worth does not jump when their money arrives (${M(dNw)}; alone ${dNwSolo === null ? "n/a" : M(dNwSolo)} × your ${Math.round(gp * 100)}% = ${M(vs)}${top !== vs ? `, up to ${M(top)} with the promote on a gain` : ""})`);
            formedAt = g.month;
            formed++;
          }
        }
      }
    }
    // LEASE what is built.
    for (const loi of [...(g.lois ?? [])]) {
      const rec = E.resolveRec(parcels, g, loi.bbl), h = g.holdings[loi.bbl];
      if (!rec || !h) continue;
      const ask = E.managedRentPsfYr(rec, g.econ, h, loi.use);
      const r = E.respondLOI(g, parcels, loi.id, loi.rentPsf >= ask * 0.85 ? "accept" : "pass", true);
      if (!r.err) g = r.s;
    }
    // SELL two years after delivery: the build-to-sell plan the investors bought.
    const h = formedAt !== null && lot ? g.holdings[lot] : null;
    if (h && !g.developments[lot] && h.deliveredM !== undefined && g.month - h.deliveredM >= 24 && !h.sale && !soldListed) {
      const v = E.ownedHoldingValue(g, parcels, h);
      const r = E.listForSale(g, parcels, lot, Math.round(v * 0.97), "marketed");
      if (!r.err) { g = r.s; soldListed = true; }
    }
    if (h?.sale) {
      if (h.sale.offer && !(h.sale.offer.contract && !h.sale.offer.held)) { const r = E.acceptSaleOffer(g, parcels, lot); if (!r.err) g = r.s; }
      else if (h.sale.bids?.length) { const i = h.sale.bids.findIndex((x) => !x.dropped); if (i >= 0) { const r = E.acceptBid(g, parcels, lot, i); if (!r.err) g = r.s; } }
    }
    const before = g;
    g = E.advanceMonth(g, parcels, bbls, adjacency);
    // THE CASH IDENTITY, every month, the syndicate's calls and distributions included.
    const resid = (g.cash - prev.cash) - ((books(g) - prev.books) + ((g.loc?.balance ?? 0) - prev.loc) + (deposits(g) - prev.dep));
    if (Math.abs(resid) > Math.abs(worstResid)) worstResid = resid;
    for (const v of E.checkInvariants(g, parcels, before)) {
      if (v.code !== "vehicle") continue;
      viol++;
      firstViol ??= `seed ${seed} m${g.month}: ${v.detail}`;
    }
    if (formedAt !== null && !g.syndications?.[lot] && (g.synClosed ?? []).some((x) => x.bbl === lot)) break;
  }
  const rec = (g.synClosed ?? []).find((x) => x.bbl === lot);
  if (rec) {
    closed++;
    console.log(`  wound up m${rec.closedM}: investors in ${M(rec.lpIn)}, out ${M(rec.lpOut)} (${(rec.lpOut / rec.lpIn).toFixed(2)}x, IRR ${rec.lpIrr === null ? "n/a" : (rec.lpIrr * 100).toFixed(1) + "%"}) · sponsor in ${M(rec.gpIn)} (site and cash), out ${M(rec.gpOut)} · network now ${M(g.ffNetwork?.cap ?? 0)}`);
  } else if (formedAt !== null) {
    const w = g.syndications?.[lot];
    console.log(`  still live at m${g.month}: investors in ${M(w?.lpCalled ?? 0)}, paid ${M(w?.lpDist ?? 0)}`);
  }
  return { g, lot, rec: (g.synClosed ?? []).find((x) => x.bbl === lot) };
}
for (const seed of SEEDS) play(seed);
const formedA = formed, closedA = closed;   // part B alone; C plays again below

// ── C. A PROVEN SPONSOR'S DEAL PAYS FEES ────────────────────────────────────
// A sponsor investors read as Proven raises on Proven terms — a 9% pref, 20%
// and 30% promote tiers — and charges a 3% development fee and a 1% asset-
// management fee. The fees are a cost to the deal its investors fund their
// share of, and income to the sponsor; the cash identity above holds through it.
console.log("\nC. a Proven sponsor's deal, with fees");
{
  // The first seed on which a sponsor finds a deal at all.
  let formedBefore = formed, out = null;
  for (const sd of SEEDS) { formedBefore = formed; out = play(sd, "Proven"); if (formed > formedBefore) break; }
  const { g, lot, rec } = out;
  const w = rec ? null : g.syndications?.[lot];
  const fees = (g.books ?? []).reduce((a, y) => a + (y.fees ?? 0), 0);
  const terms = rec ? null : w;
  console.log(`  fee income booked ${M(fees)}${rec ? ` · investors in ${M(rec.lpIn)}, out ${M(rec.lpOut)}` : ""}`);
  ok(formed > formedBefore, "the Proven sponsor broke ground with outside equity");
  ok(fees > 0, "the deal paid its sponsor fees");
  ok(!terms || terms.hurdles[0] === 0.09, "on Proven terms");
}
console.log();
ok(formedA >= 2, `a syndicate formed on ${formedA} of ${SEEDS.length} seeds`);
ok(closedA >= 1, `and wound up through a sale on ${closedA}`);
ok(Math.abs(worstResid) <= 1, `cash identity every month: worst residual ${worstResid.toFixed(2)}`);
ok(viol === 0, `syndicate and vehicle invariants: ${viol} violations${firstViol ? ` — first ${firstViol}` : ""}`);
console.log(fails ? "\nFAIL" : "\nPASS — friends and family in, paid through the waterfall, every dollar on the ledger");
process.exit(fails ? 1 : 0);
