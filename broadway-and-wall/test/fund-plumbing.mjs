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
      // PASS-THROUGH: the vehicle pays no tax; the sponsor pays its co-invest
      // share of the gain, and nothing else, from its own account.
      const share = E.gpCapitalShare(g.fund);
      const fullTax = book.legs.reduce((a2, leg) => a2 + E.saleTaxQuote(g.holdings[leg.bbl], leg.price, g).tax, 0);
      ok("the sponsor's tax is its co-invest share of the vehicle's gain", share > 0 && share < 0.1 && Math.abs(book.tax - fullTax * share) <= book.legs.length,
        `${M(book.tax)} = ${(share * 100).toFixed(1)}% of ${M(fullTax)}`);
      ok("sponsor cash does not take the fund's proceeds — only its own tax leaves it", Math.abs(dCash + book.tax) < 1, `Δcash ${M(dCash)} vs tax ${M(-book.tax)}`);
      ok("the vehicle receives the proceeds net of deposits, and pays no entity tax",
        dFund > 0 && Math.abs(dFund - (book.toSeller - fund.reduce((a2, b) => a2 + E.depositsOn(g.holdings[b]), 0))) < 2,
        `Δfund ${M(dFund)} vs settlement ${M(book.toSeller)}`);
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
  // An approach needs three well-let deeds of one class on one book, which
  // depends on what the opening tape offered; walk setup seeds from 9102 until
  // the probe book can attract one (the town decides, not the assertion).
  let seen = 0, mixedSeen = 0;
  for (let seed = 9102; seed < 9112 && seen === 0; seed++) {
  const { g: ga, own: book } = setup(seed, 0, 16);
  {
    const byClass = {};
    for (const b of book) (byClass[E.resolveRec(parcels, ga, b).class] ??= []).push(b);
    for (const arr of Object.values(byClass)) arr.slice(0, Math.floor(arr.length / 2)).forEach((b) => { ga.holdings[b].fundOwned = true; });
    console.log(`      probe book by class (seed ${seed}):`, Object.entries(byClass).map(([k, v]) => `${k} ${v.length}`).join(", "));
  }
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
  // fund deed runs through fund.cash. January included: the vehicle is a
  // partnership and pays no income tax of its own (the deed ledger is pre-tax).
  let g = g0;
  // Tenant deposits on fund deeds are the vehicle's to hold (moveDeposit):
  // they arrive in and leave from fund.cash with no books entry, so the
  // vehicle's cash moves by the ledger PLUS the change in deposits it holds.
  const fundDeps = (x) => fund.reduce((a, b) => a + (x.holdings[b]?.tenants ?? []).reduce((n, t) => n + (t.deposit ?? 0), 0), 0);
  let checked = 0, bad = 0, worst = 0, sponsorPaid = 0, depMonths = 0, januaries = 0;
  // Thirty months, or on until a fund deed's roll has turned once (to 96,
  // inside the vehicle's 120-month life): the deposit leg is only exercised
  // when a commercial lease ends or starts, and when that first happens is the
  // luck of which buildings the vehicle bought — flats hold no deposits, and
  // on the plan-8 reference town the one office's lease runs to month 78.
  for (let i = 0; i < 96 && (i < 30 || depMonths === 0); i++) {
    const f0 = { ...g.fund };
    const g1 = E.advanceMonth(g, parcels, bbls, adjacency);
    if (!fund.every((b) => g1.holdings[b]?.fundOwned) || g1.fund.settled) break;
    const f1 = g1.fund;
    const dDep = fundDeps(g1) - fundDeps(g);
    if (Math.abs(dDep) > 0) depMonths++;
    const vehicle = (f1.cash - f0.cash) + (f1.distributed - f0.distributed) + (f1.promotePaid - f0.promotePaid)
      - (f1.called - f0.called) + ((f1.gpAdvance ?? 0) - (f0.gpAdvance ?? 0)) - dDep;
    let ledger = 0;
    for (const b of fund) {
      const cf = g1.deedCf?.[b]?.cf ?? [];
      for (let k = 0; k < cf.length; k += 2) if (cf[k] === g1.month) ledger += cf[k + 1];
    }
    checked++;
    if (g1.month % 12 === 0) januaries++;
    const gap = vehicle - ledger;
    if (Math.abs(gap) > 2) { bad++; worst = Math.max(worst, Math.abs(gap)); }
    sponsorPaid += gap;
    g = g1;
  }
  ok("every month, January included: vehicle net flow == its deeds' ledger", checked >= 20 && januaries >= 1 && bad === 0,
    `${checked} months (${januaries} January), ${bad} off, worst ${M(worst)}, sponsor-borne ${M(sponsorPaid)}`);
  ok("...including months in which the fund deeds' tenant deposits moved", depMonths >= 1, `${depMonths} months with deposit movement`);

  // DEPOSITS, END TO END. Collected into the vehicle at the closing, handed
  // back out of it at a sale and when a deed goes to the LPs' trust in kind.
  {
    const dep0 = fundDeps(g0);
    ok("setup: the fund deeds carry tenant deposits", dep0 > 0, M(dep0));
    // A single fund-deed sale: the deposits leave from fund.cash, never GP cash.
    const b = fund.find((x) => (g0.holdings[x]?.tenants ?? []).some((t) => (t.deposit ?? 0) > 0)) ?? fund[0];
    const l = E.listForSale(g0, parcels, b, 1, "quiet");
    if (!l.err) {
      const t = l.s;
      t.holdings[b].sale.offer = { price: 2_000_000, expiresM: t.month + 2, from: "X" };
      const px = E.saleProceedsToSeller(t, parcels, t.holdings[b], 2_000_000);
      const dep = E.depositsOn(t.holdings[b]);
      const a = E.acceptSaleOffer(t, parcels, b);
      ok("a fund deed's sale hands its deposits over from the vehicle, not the sponsor",
        !a.err && Math.abs(a.s.cash - t.cash + px.tax) < 1 && Math.abs(a.s.fund.cash - t.fund.cash - (px.toSeller - dep)) < 1,
        a.err ?? `Δcash ${M(a.s.cash - t.cash)} (its tax share ${M(px.tax)}), Δfund ${M(a.s.fund.cash - t.fund.cash)} vs ${M(px.toSeller - dep)}`);
    }
    // In kind to the liquidating trust: an underwater deed at the end of the
    // extension leaves with its deposits paid out of the vehicle's cash.
    if (E.windDownFund) {
      const t = structuredClone(g0);
      for (const x of fund) { if (x !== b) delete t.holdings[x]; }
      const h = t.holdings[b];
      const v = E.ownedHoldingValue(t, parcels, h);
      h.loan = { ...(h.loan ?? { product: "harbor", ratePct: 6, amortYears: 25, originM: t.month, maturityM: t.month + 60, monthlyPmt: 1 }), balance: v * 3, principal: v * 3 };
      t.fund.cash = 3_000_000; t.fund.gpAdvance = 0;
      t.fund.lifeEndM = t.month; t.fund.extendedTo = t.month;
      const dep = E.depositsOn(h);
      const w = E.waterfall(t.fund, t.fund.cash - dep);
      const cash0 = t.cash;
      E.windDownFund(t, parcels);
      ok("the deed went to the trust in kind", !t.holdings[b] && t.fund.settled);
      ok("its deposits left from the vehicle — the sponsor got the waterfall on what remained", Math.abs((t.cash - cash0) - (w.promote + w.toGpCoinvest)) < 2,
        `Δcash ${M(t.cash - cash0)} vs ${M(w.promote + w.toGpCoinvest)} (deposits ${M(dep)})`);
    } else ok("windDownFund is reachable from the harness", false);
  }

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

// ---- 4. THE VEHICLE IS PASS-THROUGH ------------------------------------------
// A fund is a partnership: no entity tax. The sponsor carries its co-invest
// share of the vehicle's taxable income on its own return, and the promote
// when it is paid.
{
  // Two deeds whose taxable income is big enough to read a pro-rata split
  // off: walk setup seeds from 9104 until the vehicle's year clears $10K.
  let g, fund;
  const januaryTax = (share, promote = 0) => {
    const t = structuredClone(g);
    // The sponsor's own idle cash would earn December's sweep interest inside
    // the very month advanced here, and that is the sponsor's income, not the
    // vehicle's: hold no idle balance so the probe reads only the fund's leg.
    t.taxLossCarry = 0; t.depositInterestYr = 0; t.cash = 0;
    t.fund.gpCommit = Math.round(t.fund.called * share);
    if (promote) t.promoteIncomeYr = promote;
    const f0 = t.fund.cash, tax0 = t.taxesPaid ?? 0;
    const t1 = E.advanceMonth(t, parcels, bbls, adjacency);
    return { tax: (t1.taxesPaid ?? 0) - tax0, t1, t };
  };
  // A 3% co-invest on two small deeds is under the $1K the January cheque
  // bothers with, so the pro-rata rule is read at a half share.
  for (let seed = 9104; seed < 9116; seed++) {
    const r = setup(seed, 2, 0);
    g = r.g; fund = r.fund;
    while (g.month % 12 !== 11) g = E.advanceMonth(g, parcels, bbls, adjacency);
    const onlyFund = Object.values(g.holdings).every((h) => h.fundOwned);
    if (fund.length === 2 && onlyFund && januaryTax(1).tax > 10_000) break;
  }
  const none = januaryTax(0), half = januaryTax(0.5), all = januaryTax(1), coinvest = januaryTax(0.03);
  ok("setup: a January with only fund deeds on the book", fund.length === 2 && Object.values(g.holdings).every((h) => h.fundOwned) && none.t1.month % 12 === 0);
  ok("a sponsor with no capital in the vehicle pays none of its income tax", none.tax < 1_000, `tax ${M(none.tax)}`);
  ok("its share of the vehicle's income is on the sponsor's return, pro rata",
    all.tax > 10_000 && Math.abs(half.tax - all.tax * 0.5) < Math.max(1_000, all.tax * 0.01),
    `50%: ${M(half.tax)}  100%: ${M(all.tax)}`);
  const promo = januaryTax(0.03, 1_000_000);
  ok("the promote paid in the year is taxed as the sponsor's income",
    Math.abs((promo.tax - coinvest.tax) - 1_000_000 * E.INCOME_TAX_RATE) < 5_000, `+${M(promo.tax - coinvest.tax)} on a $1.000M promote`);
  // applyDistribute is where the promote is recorded for January.
  const d = structuredClone(g);
  d.fund.cash = 20_000_000; d.fund.prefAccrued = 0; d.fund.capReturned = d.fund.called; d.promoteIncomeYr = 0;
  E.applyDistribute(d, 10_000_000);
  ok("a distribution records the promote paid as the year's promote income", d.promoteIncomeYr > 0 && Math.abs(d.promoteIncomeYr - d.fund.promotePaid + g.fund.promotePaid) < 1,
    `${M(d.promoteIncomeYr)}`);
}

console.log(`\n${fails === 0 ? "fund-plumbing pass" : `${fails} fund-plumbing failure(s)`}`);
process.exit(fails === 0 ? 0 : 1);
