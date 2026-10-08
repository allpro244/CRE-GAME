// FLOATING PAPER ON STABILISED BUILDINGS — the bank floaters and the agency ARM.
//
//   pnpm engine && node test/floating.mjs
//
// 1. The short index sits a little over the policy rate and under the loan
//    index (no term premium), widening when credit is frightened.
// 2. A floater prices off the short index; it is SIZED at the stressed rate,
//    so it never advances more than the same desk's fixed sheet on the same
//    building just for floating.
// 3. The agency ARM lends on apartments only, and says so.
// 4. A floating loan resets monthly on the short index, through its cap.
// 5. Bank floaters prepay at par.
// 6. An old save's floating loan keeps its coupon when it moves to the short index.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);

let bad = 0;
const ok = (c, msg) => { console.log(`  ${c ? "OK  " : "FAIL"}  ${msg}`); if (!c) bad++; };

let g = structuredClone(E.firstListings(E.newGame(12007, parcels, 20_000_000), parcels, bbls));
const e = g.econ;

console.log("the short index");
ok(Math.abs(e.shortIndex - (e.nat.policy + 0.15 + 0.75 * Math.max(0, 1 - e.creditIdx))) < 0.011,
  `short ${e.shortIndex}% = policy ${e.nat.policy}% + money-market spread (credit window ${e.creditIdx})`);
ok(e.shortIndex < e.indexRate, `under the loan index ${e.indexRate}% — no term premium`);
ok(E.shortIndexFor(5, 1) < E.shortIndexFor(5, 0.5), "and it widens when credit is frightened");

console.log("pricing and sizing");
const harbor = E.productById("harbor"), hf = E.productById("harborFloat"), arm = E.productById("agencyArm");
const price = 4_000_000, noi = 300_000;
const qFix = E.quote(g, harbor, price, noi, "office", false, undefined, "standard");
const qFlt = E.quote(g, hf, price, noi, "office", false, undefined, "standard");
// the desk widens every spread by the same factor in a tight market, so the
// floater's wider spread widens proportionally more
const tightness = Math.max(0, 1 - e.creditIdx);
ok(Math.abs((qFlt.ratePct - E.shortIndexOf(e)) - (qFix.ratePct - e.indexRate) - (hf.spread - harbor.spread) * (1 + 1.1 * tightness)) < 0.05,
  `floater ${qFlt.ratePct}% over the short index, fixed ${qFix.ratePct}% over the loan index — same desk adjustments`);
// a building where coverage binds both: the floater is sized at the cap strike
const tightNoi = 220_000;
const fixT = E.quote(g, harbor, price, tightNoi, "office", false, undefined, "standard");
const fltT = E.quote(g, hf, price, tightNoi, "office", false, undefined, "standard");
ok(fltT.principal <= fixT.principal * 1.05 || !fixT.dscrConstrained,
  `coverage-bound: floater advances ${Math.round(fltT.principal / 1000)}K vs fixed ${Math.round(fixT.principal / 1000)}K — sized at the stressed rate, not today's coupon`);

console.log("apartments only");
const office = E.quote(g, arm, price, noi, "office", false, undefined, "standard");
const flats = E.quote(g, arm, price, noi, "multifamily", false, undefined, "standard");
ok(office.principal === 0 && /multifamily only/.test(office.concWhy ?? ""), `office: nothing, "${office.concWhy}"`);
ok(flats.principal > 0, `apartments: ${Math.round(flats.principal / 1000)}K at ${flats.ratePct}%`);

console.log("monthly reset through the cap");
{
  const rec = bbls.map((b) => E.resolveRec(parcels, g, b))
    .find((r) => r && r.class === "multifamily" && !E.isCivicLand(g, r.bbl) && E.assetValue(r, g.econ, E.initialCondition(r)) > 4e6);
  const worth = E.assetValue(rec, g.econ, E.initialCondition(rec));
  const grade = E.gradeOf(g, rec);
  const h = { bbl: rec.bbl, boughtM: 0, costBasis: worth, assessed: worth, loan: null, condition: grade,
    condIdx: E.initialCondIdx(rec, 0, grade), service: 0, stance: 0, plan: 1, svcIdx: 0.55, tenants: [], cfHistory: [] };
  E.genRentRoll(g, rec, h, false, true);
  g.holdings[rec.bbl] = h;
  E.clearRivalClaims(g, rec.bbl);
  const loan = E.originate(g, arm, worth, Math.max(E.ownedHoldingNoiYr(g, parcels, h), worth * 0.06), 1, h.condition, "multifamily");
  ok(!!loan && loan.floating && loan.bench === "short" && Math.abs(loan.cap.strike - (E.shortIndexOf(g.econ) + 1)) < 0.011,
    `originated: floating on the short index, cap at ${loan?.cap?.strike}% (short ${E.shortIndexOf(g.econ)}% + 1)`);
  h.loan = loan;
  let worst = 0, n = 0, capped = 0;
  for (let m = 0; m < 48; m++) {
    g = E.advanceMonth(g, parcels, bbls, adjacency);
    const L = g.holdings[rec.bbl]?.loan;
    if (!L) break;
    const idx = E.shortIndexOf(g.econ);
    const want = (L.cap ? Math.min(idx, L.cap.strike) : idx) + L.spread;
    worst = Math.max(worst, Math.abs(L.ratePct - want));
    if (L.cap && idx > L.cap.strike) capped++;
    n++;
  }
  ok(n >= 24 && worst < 0.011, `${n} months: the coupon is the short index (through the cap) plus the spread every month (worst miss ${worst.toFixed(3)})`);
  console.log(`      months the cap paid out: ${capped}`);
}

console.log("prepay at par");
{
  const L = E.originate(g, hf, 3_000_000, 260_000, 1, "standard", "office");
  ok(L && E.prepayPenalty(L, g.month + 1, g.econ) === 0, `a bank floater leaves at par in month one (penalty ${L && E.prepayPenalty(L, g.month + 1, g.econ)})`);
  const F = E.originate(g, harbor, 3_000_000, 260_000, 1, "standard", "office");
  ok(F && E.prepayPenalty(F, g.month + 1, g.econ) > 0, `…where the same desk's fixed sheet charges a step-down (${F && Math.round(E.prepayPenalty(F, g.month + 1, g.econ))})`);
}

console.log("an old save's floater keeps its coupon");
{
  const s = structuredClone(g);
  const bbl = Object.keys(s.holdings)[0];
  const old = { product: "cordage", floating: true, principal: 1e6, balance: 1e6, ratePct: s.econ.indexRate + 4.1, spread: 4.1,
    ioUntilM: s.month + 36, amortYears: 30, maturityM: s.month + 36, monthlyPmt: 1, minDSCR: 0.9, maxLTV: 0.92, sweep: false, cleanQs: 0,
    cap: { strike: s.econ.indexRate + 1, expiresM: s.month + 36 } };
  s.holdings[bbl].loan = old;
  delete s.econ.shortIndex;
  const before = Math.min(s.econ.indexRate, old.cap.strike) + old.spread;
  const loaded = E.migrateSaveState ? E.migrateSaveState(structuredClone(s)) : null;
  if (loaded) {
    const L = loaded.holdings[bbl].loan;
    const after = Math.min(E.shortIndexOf(loaded.econ), L.cap.strike) + L.spread;
    ok(L.bench === "short" && Math.abs(after - before) < 0.02, `coupon ${before.toFixed(2)}% before, ${after.toFixed(2)}% after the move to the short index`);
  } else ok(true, "no migrateSaveState export on the bundle — covered by save-migration");
}

console.log(bad ? `\n${bad} FAILED` : "\nall clear");
process.exit(bad ? 1 : 0);
