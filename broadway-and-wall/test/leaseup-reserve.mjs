// LEASE-UP RESERVE — held by the lender, drawn as the costs arrive.
//
//   pnpm engine && pnpm exec node test/leaseup-reserve.mjs
//
// A GATE on the reserve's promises:
//   - delivery puts the reserve on the takeout as undrawn room, not in cash
//   - a new commercial building opens on auto-lease
//   - a signing's fit-out and commission come from the room first: the loan
//     balance rises by exactly what the room fell, and the firm's cash moves
//     only by what the room could not cover
//   - a taller plan never costs less per foot, and one more floor never moves
//     hard cost per foot by more than a few per cent (heightPremium is a curve)
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

let bad = 0;
const check = (ok, msg) => {
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${msg}`);
  if (!ok) bad++;
};
console.log("\nLEASE-UP RESERVE\n");

// the height curve: monotone, no cliff
{
  let prev = E.heightPremium(1), worst = 0, mono = true;
  for (let fl = 2; fl <= 80; fl++) {
    const v = E.heightPremium(fl);
    if (v < prev - 1e-12) mono = false;
    worst = Math.max(worst, v / prev - 1);
    prev = v;
  }
  check(mono, "height premium never falls with height");
  check(worst < 0.03, `one more floor moves the premium at most ${(worst * 100).toFixed(1)}% (< 3%)`);
}

const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);
let w = E.firstListings(E.newGame(7919, parcels), parcels, bbls);
for (let m = 0; m < 24; m++) w = E.advanceMonth(w, parcels, bbls, adjacency);
let b = null;
for (const x of bbls) {
  const rec = E.resolveRec(parcels, w, x);
  if (rec?.class !== "land" || w.holdings[x] || !(rec.lotArea >= 5000) || E.zoneUseBar(rec, "office", w.econ)) continue;
  if (!b || (rec.demandScore ?? 0) > (E.resolveRec(parcels, w, b).demandScore ?? 0)) b = x;
}
let g = structuredClone(w);
const rec0 = E.resolveRec(parcels, g, b);
g.holdings[b] = { bbl: b, costBasis: Math.round(E.landValue(rec0, g.econ)), tenants: [], boughtM: g.month, condition: "good", loan: null, cfHistory: [], stance: 0 };
g.cash = 1e9;
const r = E.startDevelopment(g, parcels, b, "office", 6, E.MAX_COVERAGE.office ?? 0.7, "gmp");
if (r.err) throw new Error(r.err);
g = r.s;
const budget = g.developments[b].leaseUpReserve ?? 0;
let cashBefore = 0;
while (g.developments[b]) { cashBefore = g.cash; g = E.advanceMonth(g, parcels, bbls, adjacency); g.cash = Math.max(g.cash, 1e8); }
const h = g.holdings[b];
check(budget > 0, `the plan carried a lease-up reserve (${(budget / 1e6).toFixed(2)}M)`);
// the delivery month's own shortfall may already have drawn a little of it
check((h.loan?.leaseUpRoom ?? 0) > 0.8 * budget && h.loan.leaseUpRoom <= budget + 1, `delivery left it on the takeout as undrawn room (${((h.loan?.leaseUpRoom ?? 0) / 1e6).toFixed(2)}M of ${(budget / 1e6).toFixed(2)}M)`);
check(!g.news.slice(0, 20).some((n) => /is released/.test(n.text)), "and did not pay it out as cash");
check(h.autoLease === true, "the delivered building opened on auto-lease");

// a signing draws the room: plant one letter, sign it by hand
h.autoLease = false;
const rec = E.resolveRec(parcels, g, b);
const market = E.managedRentPsfYr(rec, g.econ, h, "office");
g.lois = [{
  id: 9001, bbl: b, kind: "new", use: "office", name: "Test Tenant", sector: "tech", credit: 1,
  sf: Math.min(5000, Math.round(E.useVacantSf(rec, h, "office", g.month) * 0.4)), rentPsf: +market.toFixed(2),
  termM: 120, tiPsf: 80, freeM: 4, net: true, expiresM: g.month + 3, arrivedM: g.month,
}];
const room0 = h.loan.leaseUpRoom, bal0 = h.loan.balance, cash0 = g.cash;
const cost = E.loiSigningCost(g.lois[0], 0.04);
const x = E.respondLOI(g, parcels, 9001, "accept", true);
check(!x.err, `the letter signs${x.err ? ` (${x.err})` : ""}`);
const h2 = x.s.holdings[b];
const drew = room0 - (h2.loan.leaseUpRoom ?? 0);
check(drew > 0 && Math.abs(drew - Math.min(room0, cost)) <= cost * 0.5 + 1, `the room paid the fit-out and commission (${Math.round(drew).toLocaleString()} of ~${Math.round(cost).toLocaleString()})`);
check(Math.abs((h2.loan.balance - bal0) - drew) <= 1, "the loan balance rose by exactly what the room fell");
check(Math.abs(x.s.cash - cash0) < Math.max(1, cost - drew) + 0.25 * cost, `the firm's cash moved by ${Math.round(x.s.cash - cash0).toLocaleString()} — the deposit and what the room did not cover`);

console.log(bad ? `\n${bad} FAILED\n` : "\nall OK\n");
process.exit(bad ? 1 : 0);
