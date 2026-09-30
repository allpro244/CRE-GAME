// THE FUND'S END GAME — what the GP is owed when the vehicle winds down in
// kind, and who pays a vehicle deed's leases.
//   pnpm engine && node test/fund-endgame.mjs
//   (ENGINE=/abs/path/to/old/.engine.mjs to aim it at another build)
//
// Two faults, each measured on the old engine before it was fixed:
//   1. IN KIND WIPED THE GP. A sponsor who could not buy the vehicle's deeds
//      in at the end of the extension sent them to the LPs' liquidating trust,
//      and windDownFund booked the whole of their equity to `distributed` —
//      the GP's $3.37M advance and $0.57M co-invest share included. Net worth
//      $2.87M → −$1.16M in one month, bankruptcy, the LPs "returned 1.05x" on
//      the GP's own money, and the "fund raised and returned" milestone fired.
//      Now the trust runs the waterfall: advance senior, co-invest pro rata,
//      promote only past pref and capital; the GP's share is a note on the
//      trust that pays in cash as the trust sells.
//   2. A FUND DEED COULD NOT SIGN A LEASE WHEN THE GP WAS SHORT. respondLOI
//      checked the sponsor's cash and line only — never the vehicle's cash or
//      its uncalled commitments — so 736 letters were refused on one run and
//      the fund's occupancy went 0.76 → 0.15. The signing is the vehicle's
//      cost and settles through the vehicle (settleVehicleDeedFlow).
import { assertFreshBundle } from "./fresh.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
if (!process.env.ENGINE) assertFreshBundle();
const E = await import(process.env.ENGINE ?? join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels, bbls, adjacency } = loadCity(0, E.normalizeParcels);

let fails = 0;
const ok = (name, cond, detail = "") => {
  if (!cond) { fails++; console.log(`FAIL  ${name}${detail ? " — " + detail : ""}`); }
  else console.log(`PASS  ${name}${detail ? " — " + detail : ""}`);
};
const M = (n) => `$${(n / 1e6).toFixed(3)}M`;
const clone = (g) => structuredClone(g);

const freshFund = (over = {}) => ({
  raisedM: 0, size: 60_000_000, uncalled: 0, cash: 60_000_000,
  called: 60_000_000, distributed: 0, promotePaid: 0, prefAccrued: 0,
  investEndM: 60, lifeEndM: 120, pref: 0.08, promote: 0.20, gpCommit: 1_800_000,
  ...over,
});

// A sponsor whose vehicle bought `nFund` stabilised buildings, all cash.
function setup(seed, nFund) {
  let g = E.firstListings(E.newGame(seed, parcels, 80_000_000), parcels, bbls);
  g.fund = freshFund();
  const fund = [];
  for (let m = 0; m < 48 && fund.length < nFund; m++) {
    for (const L of [...(g.listings ?? [])]) {
      if (fund.length >= nFund) break;
      const rec = E.resolveRec(parcels, g, L.bbl);
      if (!rec || rec.class === "land" || !(rec.bldgArea > 0) || L.ask < 300_000 || L.ask > 12_000_000) continue;
      g.fundPay = true;
      const r = E.executePurchase(g, parcels, L.bbl, L.ask, "cash", false, 1);
      if (r.err || !r.s.holdings[L.bbl]) continue;
      g = r.s;
      fund.push(L.bbl);
    }
    g.fundPay = false;
    if (fund.length < nFund) g = E.advanceMonth(g, parcels, bbls, adjacency);
  }
  g.fundPay = false;
  return { g, fund: fund.filter((b) => g.holdings[b]) };
}

// ---- 1. AN IN-KIND WIND-DOWN RUNS THROUGH THE WATERFALL --------------------
{
  const { g: g0, fund } = setup(9101, 4);
  ok("setup: four fund deeds", fund.length === 4, `${fund.length}`);
  const g = clone(g0);
  let eq = 0;
  for (const b of fund) { const h = g.holdings[b]; eq += E.ownedHoldingValue(g, parcels, h) - (h.loan?.balance ?? 0); }
  // The end of the extension, with the vehicle out of cash and commitments,
  // a GP advance outstanding worth 60% of the deeds' equity, and a sponsor
  // with nothing to buy them in with.
  const f = g.fund;
  f.investEndM = g.month - 60; f.lifeEndM = g.month - 24; f.extendedTo = g.month; f.raisedM = g.month - 120;
  f.cash = 0; f.uncalled = 0;
  f.gpAdvance = Math.round(0.6 * eq);
  f.distributed = Math.round(f.called - 0.5 * eq);
  f.capReturned = f.distributed;
  f.prefAccrued = 0;
  g.cash = 0;
  g.loc = { ...g.loc, balance: 0 };
  // no line to buy in on: the line is sized off the book, and there is no book
  g.goal = E.newGoal ? E.newGoal("manager", g.month - 200, g) : g.goal;
  const gpClaim = E.gpInterestInFund(f, eq);
  const nw0 = E.netWorth(g, parcels);
  const n = clone(g);
  E.windDownFund(n, parcels);
  const inKind = fund.filter((b) => !n.holdings[b]).length;
  ok("the sponsor could not buy the deeds in — they went in kind", inKind > 0, `${inKind} of ${fund.length} in kind`);
  const nw1 = E.netWorth(n, parcels);
  ok("net worth survives the wind-down: the GP keeps its advance and co-invest share",
    nw1 >= nw0 - Math.max(50_000, 0.02 * gpClaim),
    `NW ${M(nw0)} → ${M(nw1)}; the GP's claim on the vehicle was ${M(gpClaim)}`);
  const note = n.trustNote?.balance ?? 0;
  ok("the GP's share of the trust is a note on it: advance senior + co-invest pro rata",
    inKind === fund.length ? Math.abs(note - gpClaim) <= Math.max(1000, 0.01 * gpClaim) : note > 0,
    `note ${M(note)} vs claim ${M(gpClaim)}`);
  const dpi = n.fund.distributed / n.fund.called;
  ok("the LPs are not credited with the GP's money", dpi < 1, `DPI ${dpi.toFixed(3)}x`);
  const miles = E.checkMilestones ? null : null;
  // The month itself, on the tick: no "raised and returned" milestone.
  const t = E.advanceMonth(clone(g), parcels, bbls, adjacency);
  const fired = t.news.some((x) => x.q === t.month && /Milestone: A fund raised and returned/.test(x.text));
  ok("the fund-returned milestone does not fire on an in-kind wind-down", !fired);
  // The note pays out in cash over the trust's sell-down, booked as it lands.
  let s = t;
  const cash0 = s.cash;
  let paid = 0;
  const noteStart = s.trustNote?.balance ?? 0;
  for (let i = 0; i < 14; i++) {
    const before = s.trustNote?.balance ?? 0;
    s = E.advanceMonth(s, parcels, bbls, adjacency);
    paid += before - (s.trustNote?.balance ?? 0);
    if (s.gameOver) s = { ...s, gameOver: null };
  }
  ok("the trust pays the note off within its sell-down", noteStart > 0 && !(s.trustNote?.balance > 0), `${M(noteStart)} → ${M(s.trustNote?.balance ?? 0)}, ${M(paid)} paid`);
  void cash0; void miles;
}

// ---- 2. A FUND DEED SIGNS ITS LEASES FROM THE VEHICLE ----------------------
{
  const { g: g0, fund } = setup(9202, 3);
  let g = clone(g0);
  g.fund.investEndM = g.month + 24; g.fund.lifeEndM = g.month + 84;
  // Walk until a letter lands on a fund deed.
  let loi = null;
  for (let m = 0; m < 36 && !loi; m++) {
    loi = (g.lois ?? []).find((l) => g.holdings[l.bbl]?.fundOwned && !l.agreed);
    if (!loi) g = E.advanceMonth(g, parcels, bbls, adjacency);
  }
  ok("setup: a letter arrived on a fund deed", !!loi);
  if (loi) {
    // The GP's own account is empty and it has no line; the vehicle has cash
    // and commitments. This is the vehicle's lease to sign.
    g.cash = 0;
    g.loc = { ...g.loc, balance: 50_000_000 };   // the line is fully drawn
    ok("setup: the GP has no line left", E.locAvailable(g, parcels) === 0, M(E.locAvailable(g, parcels)));
    g.fund.cash = 0;
    g.fund.uncalled = 5_000_000;
    const r = E.respondLOI(g, parcels, loi.id, "accept");
    ok("the lease signs, funded by a capital call on the vehicle", !r.err, r.err ?? r.msg);
    if (!r.err) {
      const s = r.s;
      const called = g.fund.uncalled - s.fund.uncalled;
      ok("the sponsor's account did not pay it", s.cash >= g.cash - 1, `GP cash ${M(g.cash)} → ${M(s.cash)}`);
      ok("the vehicle called capital for it", called > 0, `called ${M(called)}`);
      ok("no GP advance was needed", !((s.fund.gpAdvance ?? 0) > 0), `advance ${M(s.fund.gpAdvance ?? 0)}`);
    }
    // The treasury-reserve check reads the vehicle's reserve, not the GP's.
    const items = E.attentionItems({ ...g, lois: [loi] }, parcels);
    ok("an empty GP account does not flag the vehicle's lease as breaching the GP's reserve",
      !items.some((a) => a.key === "ti-book"), items.map((a) => a.key).join(","));
  }
}

console.log(fails ? `\n${fails} FAILED\n` : "\nall passed\n");
process.exit(fails ? 1 : 0);
