// THE RIGHT PURSE — every vehicle dollar where it belongs, every month.
//   pnpm engine && node test/vehicles.mjs
//   SEEDS=9201 HZ=60 node test/vehicles.mjs
//
// `conserve` reconciles the sponsor's cash and the fund's cash TOGETHER, so a
// dollar that lands in the wrong one of the two balances perfectly there. The
// LPs' sale proceeds paid to the sponsor, the sponsor paying the LPs' leasing:
// both invisible. invariants.ts now holds two identities that see it — the
// fund's cash is the sum of its own ledger, and what was booked to a fund deed
// is what the vehicle settled (CAPITAL_RAISING_PLAN.md §0.5, step 1).
//
// This harness walks a sponsor with a live fund through the paths that move a
// vehicle's money — buying cash and levered, leasing, capex, refinancing,
// selling, distributing, the wind-down and the buy-in — and checks both every
// month. It also asserts its own COVERAGE: every kind of vehicle flow must
// have moved, or the run proved nothing (CLAUDE.md, "an identity is only worth
// the question it was asked").
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels: P0, bbls, adjacency } = loadCity(0, E.normalizeParcels);

const SEEDS = (process.env.SEEDS ?? "9201,9202,9203").split(",").map(Number);
const HZ = Number(process.env.HZ ?? 150);
const M = (n) => `$${(n / 1e6).toFixed(3)}M`;
const KINDS = ["call", "dist", "deed", "purchase", "sale", "deposit", "buyIn"];

let fails = 0;
const coverage = Object.fromEntries(KINDS.map((k) => [k, 0]));
const violations = {};

// A fund as `raiseFund` would leave it, with its ledger on.
const freshFund = (m, size) => ({
  raisedM: m, size, uncalled: Math.round(size * 0.5), cash: Math.round(size * 0.5),
  called: Math.round(size * 0.5), distributed: 0, promotePaid: 0, prefAccrued: 0,
  investEndM: m + 36, lifeEndM: m + 84, pref: 0.08, promote: 0.20, gpCommit: Math.round(size * 0.03),
  flows: { call: Math.round(size * 0.5) }, deedTagged: 0, deedSettled: 0,
});

for (const seed of SEEDS) {
  const parcels = JSON.parse(JSON.stringify(P0));
  let g = E.firstListings(E.newGame(seed, parcels, 60_000_000), parcels, bbls);
  g.fund = freshFund(0, 60_000_000);
  const fundDeeds = [], own = [];
  let stake = null, refis = 0, sales = 0, months = 0, firstBad = null;

  for (let m = 0; m < HZ && !g.gameOver; m++) {
    const prev = g;
    // BUY: the vehicle buys while it is investing; the sponsor buys a couple of its own.
    if (g.month <= g.fund.investEndM && fundDeeds.length < 6 || own.length < 2) {
      for (const L of [...(g.listings ?? [])]) {
        const rec = E.resolveRec(parcels, g, L.bbl);
        if (!rec || rec.class === "land" || !(rec.bldgArea > 0) || L.ask < 300_000 || L.ask > 9_000_000) continue;
        const toFund = g.month <= g.fund.investEndM && fundDeeds.length < 6;
        if (!toFund && own.length >= 2) break;
        g.fundPay = toFund;
        // Half the vehicle's deeds levered, so debt service, refis and balloons run through it.
        const lev = toFund && fundDeeds.length % 2 === 1;
        let r = E.executePurchase(g, parcels, L.bbl, L.ask, lev ? "harbor" : "cash", false, lev ? 0.6 : 1);
        if (r.err && lev) r = E.executePurchase(g, parcels, L.bbl, L.ask, "cash", false, 1);
        g.fundPay = false;
        if (r.err || !r.s.holdings[L.bbl]) continue;
        g = r.s;
        (toFund ? fundDeeds : own).push(L.bbl);
        break;
      }
    }
    // A JV PARTNER on one of the sponsor's own deeds — its flows must stay out of the vehicle.
    if (!stake && own.length) {
      for (const b of own) {
        const q = E.stakeQuote(g, parcels, b, 0.25);
        if (!q.ok) continue;
        const r = E.sellStake(g, parcels, b, 0.25);
        if (!r.err) { g = r.s; stake = b; break; }
      }
    }
    // LEASE at market so NOI, TI, commissions and deposits all move.
    for (const loi of [...g.lois]) {
      const rec = E.resolveRec(parcels, g, loi.bbl), h = g.holdings[loi.bbl];
      if (!rec || !h) continue;
      const ask = E.managedRentPsfYr(rec, g.econ, h, loi.use);
      const r = E.respondLOI(g, parcels, loi.id, loi.rentPsf >= ask * 0.9 ? "accept" : "pass", true);
      if (!r.err) g = r.s;
    }
    // REFINANCE a levered fund deed once a year: loan proceeds belong to the vehicle.
    if (g.month % 12 === 6) {
      for (const b of fundDeeds) {
        const h = g.holdings[b];
        if (!h?.loan) continue;
        const { quotes } = E.refiQuotes(g, parcels, b);
        const qq = quotes.find((x) => x.available && x.maxProceeds > h.loan.balance * 1.05);
        if (!qq) continue;
        const r = E.refinance(g, parcels, b, qq.id, 1);
        if (!r.err) { g = r.s; refis++; break; }
      }
    }
    // SELL a fund deed after the investment period: proceeds belong to the vehicle.
    if (g.month > g.fund.investEndM && g.month % 6 === 0) {
      // ...all but one: the last is left for the wind-down to buy in at NAV.
      const left = fundDeeds.filter((x) => g.holdings[x]?.fundOwned);
      const b = left.length > 1 ? left.find((x) => !g.holdings[x].sale) : null;
      if (b) {
        const v = E.ownedHoldingValue(g, parcels, g.holdings[b]);
        const r = E.listForSale(g, parcels, b, Math.round(v * 0.97), "marketed");
        if (!r.err) g = r.s;
      }
    }
    for (const b of fundDeeds) {
      const h = g.holdings[b];
      if (!h?.sale) continue;
      if (h.sale.offer && !(h.sale.offer.contract && !h.sale.offer.held)) {
        const r = E.acceptSaleOffer(g, parcels, b);
        if (!r.err) { g = r.s; sales++; }
      } else if (h.sale.bids?.length) {
        const i = h.sale.bids.findIndex((x) => !x.dropped);
        if (i >= 0) { const r = E.acceptBid(g, parcels, b, i); if (!r.err) { g = r.s; sales++; } }
      }
    }
    const gapOf = (x) => Math.round((x.fund?.deedTagged ?? 0) - (x.fund?.deedSettled ?? 0));
    const g0 = gapOf(prev), g1 = gapOf(g);
    g = E.advanceMonth(g, parcels, bbls, adjacency);
    months++;
    if (process.env.DEBUG && gapOf(g) !== g1) {
      const fd = Object.values(g.holdings).filter((h) => h.fundOwned).map((h) => h.bbl);
      const was = Object.values(prev.holdings).filter((h) => h.fundOwned).map((h) => h.bbl);
      let tag = 0;
      for (const b of new Set([...fd, ...was])) {
        const cf = g.deedCf?.[b]?.cf ?? [];
        for (let i = 0; i < cf.length; i += 2) if (cf[i] === g.month) { tag += cf[i + 1]; console.log(`  deed ${b} ${g.holdings[b]?.fundOwned ? "fund" : "NOT fund now"} ledger ${cf[i + 1]}`); }
      }
      console.log(`  tagged Δ ${Math.round((g.fund.deedTagged ?? 0) - (prev.fund?.deedTagged ?? 0))} settled Δ ${Math.round((g.fund.deedSettled ?? 0) - (prev.fund?.deedSettled ?? 0))} ledger Σ ${Math.round(tag)} adv ${Math.round(g.fund.gpAdvance ?? 0)} cash ${Math.round(g.fund.cash)}`);
    }
    if (process.env.DEBUG && (g1 !== g0 || gapOf(g) !== g1)) {
      console.log(`DEBUG m${g.month}: gap after actions ${g1 - g0}, after the month ${gapOf(g) - g1}`);
      console.log("  books", JSON.stringify(g.booksMonthly?.at(-1)));
      for (const n of (g.news ?? []).filter((x) => x.q >= g.month - 1).slice(0, 6)) console.log("  news", n.text.slice(0, 160));
    }
    for (const v of E.checkInvariants(g, parcels, prev)) {
      if (v.code !== "vehicle") continue;
      const k = v.detail.replace(/-?\d[\d,.]*/g, "N").slice(0, 90);
      violations[k] = (violations[k] ?? 0) + 1;
      if (!firstBad) firstBad = `seed ${seed} m${g.month}: ${v.detail}`;
    }
  }
  const fl = g.fund?.flows ?? {};
  for (const k of KINDS) if (Math.abs(fl[k] ?? 0) > 0) coverage[k]++;
  console.log(`seed ${seed}: ${months} months · fund deeds ${fundDeeds.length} · own ${own.length} · JV ${stake ? "yes" : "no"} · refis ${refis} · sales ${sales}`
    + ` · fund ${g.fund?.settled ? "settled" : "live"} · flows ${Object.entries(fl).map(([k, v]) => `${k} ${M(v)}`).join(", ")}`);
  if (firstBad) console.log(`  first violation: ${firstBad}`);
}

const nViol = Object.values(violations).reduce((a, b) => a + b, 0);
console.log(`\nvehicle violations: ${nViol}`);
for (const [k, n] of Object.entries(violations).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);
if (nViol) fails++;
const dead = KINDS.filter((k) => coverage[k] === 0);
console.log(`coverage: ${KINDS.map((k) => `${k} ${coverage[k]}/${SEEDS.length}`).join(" · ")}`);
if (dead.length) { console.log(`DEAD flows (the run never moved them): ${dead.join(", ")}`); fails++; }
console.log(fails ? `\nFAIL` : `\nPASS — every vehicle dollar in the right purse, ${SEEDS.length} seeds`);
process.exit(fails ? 1 : 0);
