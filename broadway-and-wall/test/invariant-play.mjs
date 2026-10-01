// INVARIANTS THAT FIRED IN ORDINARY PLAY — the critic's bot ran checkInvariants
// every step of six 30-year campaigns and found, besides the talks fault
// (test/contract-listing.mjs):
//
//   balloon  "15–16 months past maturity without an extension or a filing"
//            (city1, holding 1000960005). A matured note was filed on, pulled
//            back to notice the month its coupon cleared — which set a fresh
//            six-month cure window — and then went unfunded again. With the
//            coupon unfunded the holdover branch never ran, and the file sat
//            in notice until the window closed, past the holdover year.
//   duress   "11 Hanover Row was levied and the account rose 5.23M against
//            4.34M of equity". Measured: NOT a pump. The seizure released
//            exactly its $4.12M of net equity; the same month the live fund's
//            quarterly distribution paid the GP $4.13M of promote and co-invest
//            from the vehicle, which the invariant's ceiling never counted.
//            The fix is the invariant's arithmetic; this test holds it to
//            BOTH halves — a vehicle distribution is not flagged, and cash
//            the seizure could not have released still is.
//
//   pnpm engine && node test/invariant-play.mjs
//   (ENGINE=/abs/path/to/old/.engine.mjs to aim it at another build)
import { assertFreshBundle } from "./fresh.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
if (!process.env.ENGINE) assertFreshBundle();
const E = await import(process.env.ENGINE ?? join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);

let fails = 0;
const ok = (name, cond, detail = "") => {
  if (!cond) { fails++; console.log(`FAIL  ${name}${detail ? " — " + detail : ""}`); }
  else console.log(`PASS  ${name}${detail ? " — " + detail : ""}`);
};
const M = (n) => `$${(n / 1e6).toFixed(3)}M`;
const clone = (g) => structuredClone(g);

let base = E.firstListings(E.newGame(4242, parcels, 20_000_000), parcels, bbls);
for (let m = 0; m < 6; m++) base = E.advanceMonth(base, parcels, bbls, adjacency);
const pick = base.listings.map((l) => ({ l, rec: E.resolveRec(parcels, base, l.bbl) }))
  .filter((x) => x.rec && x.rec.class !== "land" && x.rec.bldgArea > 5000 && x.l.ask < 5_000_000)
  .sort((a, b) => b.l.ask - a.l.ask)[0];
ok("setup: a building on the tape", !!pick);

// ---- BALLOON: a year past maturity, coupon unfunded, inside a notice window
if (pick) {
  const r = E.executePurchase(base, parcels, pick.l.bbl, pick.l.ask, "harbor", false, 1);
  ok("setup: bought on a harbor loan", !r.err && !!r.s.holdings[pick.l.bbl]?.loan, r.err);
  if (!r.err && r.s.holdings[pick.l.bbl]?.loan) {
    const g = clone(r.s);
    const bbl = pick.l.bbl;
    const h = g.holdings[bbl];
    h.loan.maturityM = g.month - 13;
    h.loan.arrearsMs = 1;
    // Filed on, pulled back to notice last month when the coupon cleared:
    // a fresh six-month window, now with nothing to pay the coupon from.
    g.workouts = { [bbl]: { bbl, lender: "First Harbor Bank", startM: h.loan.maturityM, stage: "notice", cause: "balloon",
      cure: Math.round(h.loan.balance * 1.05), decideM: g.month + 5, asks: 0, missedMs: 0 } };
    g.cash = 0;
    g.loc = { ...g.loc, balance: 200_000_000 };
    ok("setup: the coupon cannot be funded", !E.couponFundable(g, parcels, h), `fundable ${M(E.fundableNow(g, parcels))}`);
    E.tickWorkouts(g, parcels);
    const w = g.workouts?.[bbl];
    const ext = (g.holdings[bbl]?.loan?.extensions ?? 0) >= 1;
    ok("a year past maturity with the coupon unfunded, the desk files (or extends) — the notice window does not outrun it",
      w?.stage === "foreclosure" || ext, `stage ${w?.stage}, decideM ${w?.decideM}, month ${g.month}`);
    // and the invariant agrees a month later
    const inv = E.checkInvariants(g, parcels).filter((v) => v.code === "balloon");
    ok("no balloon invariant", inv.length === 0, inv.map((v) => v.detail).join("; "));
  }
}

// ---- DURESS: a seizure in the month the fund distributes to the GP
if (pick) {
  const r = E.executePurchase(base, parcels, pick.l.bbl, pick.l.ask, "cash", false, 1);
  ok("setup: bought all cash", !r.err, r.err);
  if (!r.err) {
    const bbl = pick.l.bbl;
    const prev = clone(r.s);
    prev.fund = {
      raisedM: prev.month - 60, size: 40e6, uncalled: 0, cash: 6_000_000, called: 40e6, distributed: 30e6,
      promotePaid: 0, prefAccrued: 0, investEndM: prev.month - 12, lifeEndM: prev.month + 60,
      pref: 0.08, promote: 0.2, gpCommit: 1.2e6,
    };
    const h = prev.holdings[bbl];
    const gross = Math.round(E.ownedHoldingValue(prev, parcels, h) * 0.8);
    const released = Math.max(0, E.saleTaxQuote(h, gross, prev).net);
    // What the month does: the seizure pays its net equity, and the vehicle's
    // distribution pays the GP its share of $6M while $4.5M goes to the LPs.
    const toGp = 1_500_000, toLp = 4_500_000;
    const mk = (cashRise, fundOut) => {
      const s = clone(prev);
      s.month = prev.month + 1;
      delete s.holdings[bbl];
      s.exits.push({ bbl, address: pick.rec.address, boughtM: h.boughtM, soldM: s.month, price: gross, basis: h.costBasis, gain: gross - h.costBasis, forced: true });
      s.cash = prev.cash + cashRise;
      s.fund.cash = prev.fund.cash - fundOut;
      s.booksMonthly = [...(s.booksMonthly ?? []), { m: s.month, noi: 0, debtSvc: 0, leasing: 0, capex: 0, dev: 0, taxes: 0, bought: 0, sold: released, ga: 0, interest: 0, borrowed: 0, lpCalled: 0, lpDistributed: fundOut ? toLp : 0 }];
      return E.checkInvariants(s, parcels, prev).filter((v) => v.code === "duress");
    };
    const withFund = mk(released + toGp, toGp + toLp);
    ok("a vehicle distribution to the GP in the seizure month is not a levy pump", withFund.length === 0,
      withFund.map((v) => v.detail).join("; "));
    const pumped = mk(released + toGp, 0);
    ok("cash the seizure could not have released is still flagged (the check can fail)", pumped.length > 0,
      `released ${M(released)}, rose ${M(released + toGp)}`);
  }
}

console.log(fails ? `\n${fails} FAILED\n` : "\nall passed\n");
process.exit(fails ? 1 : 0);
