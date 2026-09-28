// THE FUND'S PLUMBING — whose purse each dollar on a vehicle deed goes through.
//   pnpm engine && node test/fund-plumbing.mjs
//
// Three faults, each measured on the old code before it was fixed:
//   1. A portfolio sale of fund deeds paid every leg to the SPONSOR — four fund
//      deeds bundled lifted sponsor cash +$4.29M and net worth +36% in a click.
//      Mixed bundles and unsolicited approaches for a mix were allowed.
//   2. The fund took its buildings' NOI less debt service, but their leasing,
//      capex, payoffs and income tax were written from the sponsor's account —
//      ~20% of the vehicle's NOI (measured $0.490M over 24 months on 8 deeds).
//   3. Nothing distributed on its own: proceeds sat in fund.cash for years past
//      the investment period while the pref accrued on them.
import { assertFreshBundle } from "./fresh.mjs";
if (!process.env.ENGINE) assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(process.env.ENGINE ? join(HERE, "..", process.env.ENGINE) : join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

let fails = 0;
const ok = (name, cond, detail = "") => {
  if (!cond) { fails++; console.log(`FAIL  ${name}${detail ? " — " + detail : ""}`); }
  else console.log(`PASS  ${name}${detail ? " — " + detail : ""}`);
};
const M = (n) => `$${(n / 1e6).toFixed(3)}M`;

const { parcels, bbls, adjacency } = loadCity(0, E.normalizeParcels);

const freshFund = (over = {}) => ({
  raisedM: 0, size: 60_000_000, uncalled: 0, cash: 60_000_000,
  called: 60_000_000, distributed: 0, promotePaid: 0, prefAccrued: 0,
  investEndM: 60, lifeEndM: 120, pref: 0.08, promote: 0.20, gpCommit: 1_800_000,
  ...over,
});

// A firm with a live vehicle that has bought `nFund` stabilised buildings and
// `nOwn` of its own. Same class where it can, so a bundle / approach can form.
function setup(seed, nFund, nOwn, product = "cash", lev = 1) {
  let g = E.firstListings(E.newGame(seed, parcels, 80_000_000), parcels, bbls);
  g.fund = freshFund();
  const fund = [], own = [];
  // The opening tape is thin; walk the months and buy off each one's listings.
  for (let m = 0; m < 48 && (fund.length < nFund || own.length < nOwn); m++) {
    for (const L of [...(g.listings ?? [])]) {
      if (fund.length >= nFund && own.length >= nOwn) break;
      const rec = E.resolveRec(parcels, g, L.bbl);
      if (!rec || rec.class === "land" || !(rec.bldgArea > 0) || L.ask < 300_000 || L.ask > 12_000_000) continue;
      const toFund = fund.length < nFund;
      g.fundPay = toFund;
      const r = E.executePurchase(g, parcels, L.bbl, L.ask, product, false, lev);
      if (r.err || !r.s.holdings[L.bbl]) continue;
      g = r.s;
      (toFund ? fund : own).push(L.bbl);
    }
    g.fundPay = false;
    if (fund.length < nFund || own.length < nOwn) g = E.advanceMonth(g, parcels, bbls, adjacency);
  }
  g.fundPay = false;
  g.fund.investEndM = g.month + 60;
  g.fund.lifeEndM = g.month + 120;
  g.fund.raisedM = g.month;
  return { g, fund: fund.filter((b) => g.holdings[b]), own: own.filter((b) => g.holdings[b]) };
}

// ---- 1. THE PORTFOLIO SALE SETTLES INTO THE FUND ---------------------------
{
  const { g: g0, fund, own } = setup(9101, 4, 2);
  ok("setup: four fund deeds and two of the sponsor's", fund.length === 4 && own.length === 2, `${fund.length} / ${own.length}`);

  const mixed = E.listPortfolio(g0, parcels, [...fund.slice(0, 2), own[0]], 10_000_000);
  ok("a bundle mixing fund deeds with the sponsor's is refused", !!mixed.err, mixed.err ?? "listed");

  const q = E.portfolioQuote(g0, parcels, fund);
  const l = E.listPortfolio(g0, parcels, fund, Math.round(q.indicative));
  ok("a bundle of the fund's own deeds lists", !l.err, l.err);
  if (!l.err) {
    const g = l.s;
    const price = Math.round(q.indicative);
    g.portfolioSale.bids = [{ name: "Test Buyer", price, expiresM: g.month + 3, limit: 1e12 }];
    const book = E.portfolioSettlement(g, parcels, g.portfolioSale.bbls, price);
    const ex = E.acceptPortfolioBid(g, parcels, true);
    ok("the fund's gain cannot roll into the sponsor's 1031", !!ex.err, ex.err ?? "closed into an exchange");
    const nw0 = E.netWorth(g, parcels);
    const a = E.acceptPortfolioBid(g, parcels);
    ok("accept closes", !a.err, a.err);
    if (!a.err) {
      const g1 = a.s;
      const dCash = g1.cash - g.cash;
      const dFund = g1.fund.cash - g.fund.cash;
      const nw1 = E.netWorth(g1, parcels);
      ok("sponsor cash does not take the fund's proceeds", Math.abs(dCash) < 1, `Δcash ${M(dCash)}`);
      ok("the vehicle receives the proceeds net of tax and deposits",
        dFund > 0 && Math.abs(dFund - (book.toSeller - book.tax - fund.reduce((a2, b) => a2 + E.depositsOn(g.holdings[b]), 0))) < 2,
        `Δfund ${M(dFund)} vs settlement ${M(book.toSeller - book.tax)}`);
      // The sponsor's share moves only by what the waterfall says it owns of
      // the vehicle — the bundle discount, costs and tax are shared.
      ok("net worth does not jump on the LPs' sale", Math.abs(nw1 - nw0) / Math.max(1, Math.abs(nw0)) < 0.01,
        `${M(nw0)} → ${M(nw1)}`);
      ok("the settlement card says the proceeds are the fund's", book.toFund === true);
    }
  }

  // The unsolicited approach names a slice wholly on one book. Roll the month's
  // approach die on copies until one lands; a mixed slice is the fault.
  // Test-only surgery: half of each class goes on the fund's book, so a
  // class-only grouping (the old code) would name a mix.
  const { g: ga, own: book } = setup(9102, 0, 16);
  {
    const byClass = {};
    for (const b of book) (byClass[E.resolveRec(parcels, ga, b).class] ??= []).push(b);
    for (const arr of Object.values(byClass)) arr.slice(0, Math.floor(arr.length / 2)).forEach((b) => { ga.holdings[b].fundOwned = true; });
    console.log("      probe book by class:", Object.entries(byClass).map(([k, v]) => `${k} ${v.length}`).join(", "));
  }
  let seen = 0, mixedSeen = 0;
  for (let i = 0; i < 4000 && seen < 12; i++) {
    const t = structuredClone(ga);
    if (typeof t.rng === "number") t.rng = (t.rng + i * 7919) >>> 0;
    if (t.streams) for (const k of Object.keys(t.streams)) if (typeof t.streams[k] === "number") t.streams[k] += i * 7919;
    E.tickPortfolio(t, parcels);
    if (t.portfolioSale?.unsolicited) {
      seen++;
      if (E.mixesVehicles ? E.mixesVehicles(t, t.portfolioSale.bbls)
        : (() => { const f = t.portfolioSale.bbls.filter((b) => t.holdings[b]?.fundOwned).length; return f > 0 && f < t.portfolioSale.bbls.length; })()) mixedSeen++;
    }
  }
  ok("unsolicited approaches arrive in the probe", seen > 0, `${seen} approaches`);
  ok("no unsolicited approach names a mix of fund and sponsor deeds", mixedSeen === 0, `${mixedSeen} of ${seen} mixed`);
}

// ---- 2. THE VEHICLE PAYS ITS OWN BUILDINGS' COSTS --------------------------
{
  const { g: g0, fund } = setup(9103, 3, 0, "harbor", 0.6);
  const levered = fund.find((b) => g0.holdings[b]?.loan);
  ok("setup: a levered fund deed", !!levered, `${fund.length} fund deeds`);
  if (levered) {
    const r = E.payOffLoan(g0, parcels, levered);
    ok("the fund deed's loan pays off", !r.err, r.err);
    if (!r.err) {
      const dCash = r.s.cash - g0.cash;
      const dFund = r.s.fund.cash - g0.fund.cash;
      ok("paying off a fund deed's mortgage does not come out of the sponsor", Math.abs(dCash) < 1, `Δcash ${M(dCash)}`);
      ok("...it comes out of the vehicle", dFund < -100_000, `Δfund ${M(dFund)}`);
    }
  }

  // Month by month: what the vehicle nets equals what its deeds' own ledger
  // says they netted — every lease commission, TI cheque and capex bill on a
  // fund deed runs through fund.cash. January also carries the vehicle's own
  // income tax (the deed ledger is pre-tax), so January is checked apart.
  let g = g0;
  let checked = 0, bad = 0, worst = 0, sponsorPaid = 0;
  for (let i = 0; i < 30; i++) {
    const f0 = { ...g.fund };
    const g1 = E.advanceMonth(g, parcels, bbls, adjacency);
    if (!fund.every((b) => g1.holdings[b]?.fundOwned) || g1.fund.settled) break;
    const f1 = g1.fund;
    const vehicle = (f1.cash - f0.cash) + (f1.distributed - f0.distributed) + (f1.promotePaid - f0.promotePaid)
      - (f1.called - f0.called) + ((f1.gpAdvance ?? 0) - (f0.gpAdvance ?? 0));
    let ledger = 0;
    for (const b of fund) {
      const cf = g1.deedCf?.[b]?.cf ?? [];
      for (let k = 0; k < cf.length; k += 2) if (cf[k] === g1.month) ledger += cf[k + 1];
    }
    if (g1.month % 12 !== 0) {
      checked++;
      const gap = vehicle - ledger;
      if (Math.abs(gap) > 2) { bad++; worst = Math.max(worst, Math.abs(gap)); }
      sponsorPaid += gap;
    }
    g = g1;
  }
  ok("every non-January month: vehicle net flow == its deeds' ledger", checked >= 20 && bad === 0,
    `${checked} months, ${bad} off, worst ${M(worst)}, sponsor-borne ${M(sponsorPaid)}`);

  // Past its cash and its commitments, the vehicle's bill is a GP advance —
  // recorded, repaid first — not a silent gift from the sponsor.
  {
    const t = structuredClone(g0);
    const b = fund[0];
    t.fund.cash = 0; t.fund.uncalled = 0;
    const cash0 = t.cash;
    const nw0 = E.netWorth(t, parcels);
    E.logBooks(t, "capex", 100_000, b); // the bookkeeping door every cost comes through
    t.cash -= 100_000;                  // ...paid from the operating account, as fundAndBook does
    ok("a vehicle with no cash and nothing to call books a GP advance", (t.fund.gpAdvance ?? 0) === 100_000, `advance ${t.fund.gpAdvance}`);
    ok("the advance is the sponsor's receivable in net worth", Math.abs(E.netWorth(t, parcels) - nw0) < 20_000,
      `ΔNW ${M(E.netWorth(t, parcels) - nw0)} on a $0.1M advance`);
    t.fund.cash = 500_000;
    E.applyDistribute(t, 500_000);
    ok("the advance is repaid before the waterfall", (t.fund.gpAdvance ?? 0) === 0 && t.cash >= cash0 - 1, `advance ${t.fund.gpAdvance}, Δcash ${M(t.cash - cash0)}`);
  }
}

// ---- 3. AFTER THE INVESTMENT PERIOD THE VEHICLE DISTRIBUTES ----------------
{
  const { g: g0, fund } = setup(9104, 2, 0);
  ok("setup: two fund deeds", fund.length === 2);
  // Inside the investment period, cash is recycled, not distributed.
  {
    let g = structuredClone(g0);
    g.fund.cash += 5_000_000;
    for (let i = 0; i < 6; i++) g = E.advanceMonth(g, parcels, bbls, adjacency);
    ok("inside the investment period nothing is distributed on its own", g.fund.distributed === 0, `distributed ${M(g.fund.distributed)}`);
  }
  // Past it: sale proceeds and excess cash go out quarterly through the
  // waterfall, keeping the vehicle's reserve.
  {
    let g = structuredClone(g0);
    g.fund.raisedM = g.month - 70;
    g.fund.investEndM = g.month - 10;
    g.fund.lifeEndM = g.month + 50;
    g.fund.cash += 5_000_000;
    const lp0 = (g.books ?? []).reduce((a, y) => a + (y.lpDistributed ?? 0), 0);
    for (let i = 0; i < 4; i++) g = E.advanceMonth(g, parcels, bbls, adjacency);
    const lp1 = (g.books ?? []).reduce((a, y) => a + (y.lpDistributed ?? 0), 0);
    const reserve = E.fundReserve ? E.fundReserve(g) : 250_000;
    ok("past the investment period the vehicle distributes on its own", g.fund.distributed > 4_000_000, `distributed ${M(g.fund.distributed)}`);
    ok("the LP leg is on the ledger", lp1 - lp0 > 3_000_000, `lpDistributed ${M(lp1 - lp0)}`);
    ok("the vehicle keeps a reserve for its own bills", g.fund.cash > 0 && g.fund.cash < reserve + 1_500_000, `cash ${M(g.fund.cash)} vs reserve ${M(reserve)}`);
  }
}

console.log(`\n${fails === 0 ? "fund-plumbing pass" : `${fails} fund-plumbing failure(s)`}`);
process.exit(fails === 0 ? 0 : 1);
