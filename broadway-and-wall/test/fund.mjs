// THE FUND — must work AND bite (facility's standard).
//   pnpm engine && node test/fund.mjs
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

const { parcels, bbls } = loadCity(0, E.normalizeParcels);

// Second cash account: LP call raises fund.cash, not s.cash; promote moves to GP.
{
  let g = E.newGame(4242, parcels);
  g.fund = {
    raisedM: 0, size: 10_000_000, uncalled: 5_000_000, cash: 0,
    called: 0, distributed: 0, promotePaid: 0, prefAccrued: 0,
    investEndM: 60, lifeEndM: 120, pref: 0.08, promote: 0.20, gpCommit: 300_000,
  };
  const cash0 = g.cash;
  const r = E.callFundCapital(g, 2_000_000);
  ok("call ok", !r.err);
  g = r.s;
  ok("LP call → fund.cash", g.fund.cash === 2_000_000);
  ok("GP cash unchanged on LP call", g.cash === cash0);
  ok("lpCalled booked", (g.books?.[0]?.lpCalled ?? 0) === 2_000_000);

  const liq0 = E.totalLiquidity(g);
  const d = E.distributeFund(g, 1_000_000);
  ok("distribute ok", !d.err);
  g = d.s;
  // LP leg leaves the system; promote is a transfer (Δliq = −lpDistributed).
  const lpOut = g.books?.[0]?.lpDistributed ?? 0;
  ok("liquidity falls by LP distributions only", Math.abs((liq0 - E.totalLiquidity(g)) - lpOut) < 1);
  ok("LP distribution booked", lpOut > 0);
}

// Pref bites: with accrued pref unpaid, 100% of a distribution goes to LPs — no promote.
{
  let g = E.newGame(4243, parcels);
  g.fund = {
    raisedM: 0, size: 10_000_000, uncalled: 0, cash: 1_000_000,
    called: 5_000_000, distributed: 0, promotePaid: 0, prefAccrued: 800_000,
    investEndM: 60, lifeEndM: 120, pref: 0.08, promote: 0.20, gpCommit: 300_000,
  };
  const cash0 = g.cash;
  const d = E.distributeFund(g, 500_000);
  g = d.s;
  // The GP's co-invest is capital like the LPs' and takes its pro-rata share
  // of the pref tier; what it never takes while pref is owed is the promote.
  const gpPref = Math.round(500_000 * 300_000 / 5_000_000);
  ok("pref-first: no promote while pref unpaid", g.fund.promotePaid === 0 && Math.abs(g.cash - cash0 - gpPref) <= 1, `GP cash +${g.cash - cash0} vs its co-invest share ${gpPref}`);
  ok("pref-first: LP got the whole cheque", g.fund.distributed === 500_000);
  ok("pref-first: pref accrued reduced", g.fund.prefAccrued === 300_000);
}

// Promote crystallises only after pref is current.
{
  let g = E.newGame(4244, parcels);
  g.fund = {
    raisedM: 0, size: 10_000_000, uncalled: 0, cash: 1_000_000,
    called: 5_000_000, distributed: 5_000_000, capReturned: 5_000_000, promotePaid: 0, prefAccrued: 0,
    investEndM: 60, lifeEndM: 120, pref: 0.08, promote: 0.20, gpCommit: 300_000,
  };
  // Pref current AND capital back (the LPA order: pref, capital, then split),
  // so the whole cheque is in the split: 20% promote, 80% to the capital
  // accounts pro rata — the GP's co-invest included.
  const w = E.waterfall(g.fund, 1_000_000);
  const cash0 = g.cash;
  const liq0 = E.totalLiquidity(g);
  const d = E.distributeFund(g, 1_000_000);
  g = d.s;
  ok("promote after pref: GP received the 20% promote plus its co-invest share", w.promote === 200_000 && g.cash === cash0 + w.promote + w.toGpCoinvest, `cash +${g.cash - cash0} vs ${w.promote + w.toGpCoinvest}`);
  ok("promote after pref: 80% to the capital accounts", g.fund.distributed === 5_800_000);
  ok("promote after pref: Δliq = −LP share", Math.abs((liq0 - E.totalLiquidity(g)) - w.toLp) < 1, `${liq0 - E.totalLiquidity(g)} vs ${w.toLp}`);
}

// Raise is gated — no menu.
{
  const g = E.newGame(1, parcels);
  const q = E.fundRaiseQuote(g);
  ok("fresh firm cannot raise", !q.ok);
  const r = E.raiseFund(g);
  ok("raiseFund refuses", !!r.err);
}

// Raise works with standing + exits + expansion.
{
  let g = E.firstListings(E.newGame(12007, parcels, 20_000_000), parcels, bbls);
  g.econ.phase = "expansion";
  g.exits = [
    { bbl: "x", address: "x", boughtM: 0, soldM: 1, price: 2, basis: 1, gain: 1, forced: false },
    { bbl: "y", address: "y", boughtM: 0, soldM: 2, price: 2, basis: 1, gain: 1, forced: false },
  ];
  g.sponsor = { events: [] };
  const q = E.fundRaiseQuote(g);
  ok("eligible to raise", q.ok, q.reason);
  const cash0 = g.cash;
  const r = E.raiseFund(g);
  ok("raise closes", !r.err, r.err);
  g = r.s;
  ok("fund seated", !!g.fund && g.fund.cash > 0);
  ok("GP co-invest left GP cash", g.cash < cash0);
  ok("uncalled positive", g.fund.uncalled > 0);
  ok("lpCalled on books", (g.books?.reduce((a, y) => a + (y.lpCalled ?? 0), 0) ?? 0) > 0);
  ok("fundPay default on after raise", g.fundPay === true);
}

// IT BITES — a fund that cannot return capital stamps the second death.
{
  let g = E.newGame(4245, parcels);
  g.fund = {
    raisedM: 0, size: 10_000_000, uncalled: 0, cash: 100_000,
    called: 5_000_000, distributed: 0, promotePaid: 0, prefAccrued: 0,
    investEndM: 60, lifeEndM: 10, pref: 0.08, promote: 0.20, gpCommit: 300_000,
  };
  g.month = 10;
  E.settleFund(g);
  ok("failed fund settled", g.fund.settled && g.fund.failed);
  ok("fundFailedM stamped", g.fundFailedM === 10);
  const q = E.fundRaiseQuote(g);
  ok("nobody will back you again", !q.ok && /Nobody will back you again/.test(q.reason), q.reason);
  const r = E.raiseFund(g);
  ok("raiseFund refuses after failure", !!r.err);
}

// Vehicle purchase tags the deed and leaves GP cash alone.
{
  let g = E.firstListings(E.newGame(77, parcels, 50_000_000), parcels, bbls);
  g.fund = {
    raisedM: 0, size: 20_000_000, uncalled: 0, cash: 20_000_000,
    called: 20_000_000, distributed: 0, promotePaid: 0, prefAccrued: 0,
    investEndM: 60, lifeEndM: 120, pref: 0.08, promote: 0.20, gpCommit: 600_000,
  };
  g.fundPay = true;
  const cash0 = g.cash;
  const fund0 = g.fund.cash;
  let bought = null;
  for (const L of g.listings ?? []) {
    const rec = E.resolveRec(parcels, g, L.bbl);
    if (!rec || rec.class === "land" || !rec.bldgArea) continue;
    if (L.ask > 8_000_000) continue;
    const r = E.executePurchase(g, parcels, L.bbl, L.ask, "cash", false, 1);
    if (!r.err && r.s.holdings[L.bbl]) { g = r.s; bought = L.bbl; break; }
  }
  ok("bought with vehicle", !!bought);
  if (bought) {
    ok("deed tagged fundOwned", g.holdings[bought].fundOwned === true);
    ok("GP cash untouched on fund buy", g.cash === cash0);
    ok("vehicle cash fell", g.fund.cash < fund0);
  }
}

// Capital is called as deals close: a vehicle holding less cash than a deal's
// equity calls the rest from uncalled commitments, on the ledger as lpCalled.
{
  let g = E.firstListings(E.newGame(78, parcels, 50_000_000), parcels, bbls);
  g.fund = {
    raisedM: 0, size: 20_000_000, uncalled: 15_000_000, cash: 500_000,
    called: 5_000_000, distributed: 0, promotePaid: 0, prefAccrued: 0,
    investEndM: 60, lifeEndM: 120, pref: 0.08, promote: 0.20, gpCommit: 600_000,
  };
  g.fundPay = true;
  const lp0 = (g.books ?? []).reduce((a, e) => a + (e.lpCalled ?? 0), 0);
  let bought = null;
  for (const L of g.listings ?? []) {
    const rec = E.resolveRec(parcels, g, L.bbl);
    if (!rec || rec.class === "land" || !rec.bldgArea || L.ask < 1_000_000 || L.ask > 8_000_000) continue;
    const r = E.executePurchase(g, parcels, L.bbl, L.ask, "cash", false, 1);
    if (!r.err && r.s.holdings[L.bbl]) { g = r.s; bought = L.bbl; break; }
  }
  const called = g.fund.called - 5_000_000;
  const lp1 = (g.books ?? []).reduce((a, e) => a + (e.lpCalled ?? 0), 0);
  ok("a deal bigger than vehicle cash calls the shortfall", !!bought && called > 0 && g.fund.uncalled === 15_000_000 - called && g.fund.cash >= 0, `called ${called}, cash ${g.fund.cash}`);
  ok("the call is on the ledger as LP equity in", Math.abs((lp1 - lp0) - called) < 1);
}

console.log(`\n${fails === 0 ? "fund pass" : `${fails} fund failure(s)`}`);
process.exit(fails === 0 ? 0 : 1);
