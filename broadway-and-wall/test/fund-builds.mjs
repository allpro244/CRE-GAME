// A FUND BUILDS ON ITS OWN DIRT, WITH ITS OWN MONEY (CAPITAL_RAISING_PLAN.md §0.5, step 4).
//   pnpm engine && node test/fund-builds.mjs
//
// A fund deed's money is the vehicle's: a groundbreaking on a lot the fund
// owns must be underwritten against what the fund can call, and its day-one
// cheque must come out of the fund's purse, not the sponsor's. Before this the
// engine read the SPONSOR's liquidity, so a $3M sponsor running a $60M fund
// could not break ground on the fund's own lot — and had it been allowed, the
// sponsor would have paid the LPs' construction.
//
// The run: a poor sponsor, a well-funded vehicle, a land lot bought by the
// fund, the biggest job that plans, built to delivery. Asserted: the sponsor's
// cash does not move at close, the fund's falls by exactly the close cheque,
// the delivered building is still the fund's, and the vehicle identities
// (invariants.ts) hold every month.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels, bbls, adjacency } = loadCity(0, E.normalizeParcels);

const SEEDS = (process.env.SEEDS ?? "9301,9302,9303").split(",").map(Number);
const M = (n) => `$${(n / 1e6).toFixed(2)}M`;
let fails = 0, built = 0;
const fail = (m) => { console.log("  FAIL " + m); fails++; };

for (const seed of SEEDS) {
  let g = E.firstListings(E.newGame(seed, parcels, 3_000_000), parcels, bbls);
  g.fund = { raisedM: 0, size: 6e7, uncalled: 3e7, cash: 3e7, called: 3e7, distributed: 0, promotePaid: 0, prefAccrued: 0,
    investEndM: 36, lifeEndM: 84, pref: 0.08, promote: 0.2, gpCommit: 1.8e6, flows: { call: 3e7 }, deedTagged: 0, deedSettled: 0 };
  let lot = null;
  for (let m = 0; m < 24 && !lot; m++) {
    for (const L of g.listings) {
      const rec = E.resolveRec(parcels, g, L.bbl);
      if (!rec || rec.class !== "land" || L.ask > 2e6 || rec.lotArea < 4000) continue;
      g.fundPay = true;
      const r = E.executePurchase(g, parcels, L.bbl, L.ask, "cash", false, 1);
      g.fundPay = false;
      if (!r.err && r.s.holdings[L.bbl]) { g = r.s; lot = L.bbl; break; }
    }
    if (!lot) g = E.advanceMonth(g, parcels, bbls, adjacency);
  }
  if (!lot) { fail(`seed ${seed}: the fund found no lot to buy`); continue; }
  let best = null;
  for (const u of ["multifamily", "office", "retail"]) for (const f of [3, 6, 10, 15, 20]) {
    const p = E.planDevelopment(g, parcels, lot, u, f, 0.6, "gmp");
    // Bigger than the sponsor could ever carry alone, inside what the fund can.
    if (p && p.equity > g.cash * 1.5 && p.equity < g.fund.cash * 0.8 && (!best || p.costTotal > best.p.costTotal)) best = { u, f, p };
  }
  if (!best) { fail(`seed ${seed}: no job on ${lot} sized between the sponsor's purse and the fund's`); continue; }
  const c0 = g.cash, f0 = g.fund.cash;
  const r = E.startDevelopment(g, parcels, lot, best.u, best.f, 0.6, "gmp");
  if (r.err) { fail(`seed ${seed}: groundbreaking refused — ${r.err.slice(0, 160)}`); continue; }
  g = r.s;
  const dSponsor = Math.round(g.cash - c0), dFund = Math.round(g.fund.cash - f0);
  console.log(`seed ${seed}: ${best.u} ${best.f} fl on ${lot}, cost ${M(best.p.costTotal)}, equity ${M(best.p.equity)} · at close sponsor ${M(dSponsor)} fund ${M(dFund)}`);
  if (dSponsor !== 0) fail(`seed ${seed}: the sponsor paid ${M(-dSponsor)} toward the fund's groundbreaking`);
  if (!(dFund < 0)) fail(`seed ${seed}: the fund paid nothing at close`);
  if (Math.round(-(g.fund.flows.build ?? 0)) !== -dFund) fail(`seed ${seed}: close cheque ${M(-dFund)} vs build flow ${M(-(g.fund.flows.build ?? 0))}`);
  let viol = 0, first = null;
  for (let m = 0; m < 48 && !g.gameOver; m++) {
    const prev = g;
    g = E.advanceMonth(g, parcels, bbls, adjacency);
    for (const v of E.checkInvariants(g, parcels, prev)) if (v.code === "vehicle") { viol++; first ??= `m${g.month}: ${v.detail}`; }
  }
  const stillBuilding = !!g.developments?.[lot];
  const h = g.holdings[lot];
  console.log(`  after 48 mo: ${stillBuilding ? "still building" : "delivered"} · fund deed ${!!h?.fundOwned} · fund flows ${Object.entries(g.fund.flows).map(([k, v]) => `${k} ${M(v)}`).join(", ")}`);
  if (viol) fail(`seed ${seed}: ${viol} vehicle violations, first ${first}`);
  if (!stillBuilding && h && !h.fundOwned && !g.fund.settled) fail(`seed ${seed}: the delivered building left the fund`);
  if (!stillBuilding) built++;
}
if (!built) fail("no job delivered on any seed — the run proved nothing past groundbreaking");
console.log(fails ? "\nFAIL" : `\nPASS — the fund broke ground on its own lots with its own money, ${built}/${SEEDS.length} delivered`);
process.exit(fails ? 1 : 0);
