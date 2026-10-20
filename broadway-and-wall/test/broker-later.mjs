// A LEASE WITH NO TI AND NO FREE RENT COSTS ALMOST NOTHING TO SIGN, AND THE
// BROKER CAN WAIT (owner, Oct 2026: "you get the security deposit and first
// months rent on the day of signing ... make it so you can pay the broker's
// fee after you get enough cash or LOC again").
//
// An empty account and no line sign a new lease with no fit-out: the deposit
// comes in, the commission is owed and counts against net worth, and the
// month the cash is there the broker is paid in full and booked.
//
//   pnpm engine && node test/broker-later.mjs
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);

let bad = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "OK  " : "FAIL"}  ${msg}`); if (!ok) bad++; };

let g = E.firstListings(E.newGame(4242, parcels, 25_000_000), parcels, bbls);
// A building with a whole suite empty.
let bbl = null, use = null, free = 0;
for (const li of g.listings) {
  const r = E.resolveRec(parcels, g, li.bbl);
  if (!r || r.class === "land" || r.class === "mixed" || !(r.bldgArea > 0)) continue;
  const b = E.buyListing(g, parcels, li.bbl, "cash");
  if (b.err) continue;
  const f = E.useVacantSf(r, b.s.holdings[li.bbl], r.class, b.s.month);
  if (f < Math.max(1_000, E.minLettableSf(r, r.class))) continue;
  g = b.s; bbl = li.bbl; use = r.class; free = f; break;
}
check(!!bbl, `bought a building with a suite to let (${Math.round(free).toLocaleString()} sf)`);
if (!bbl) process.exit(1);
const rec = E.resolveRec(parcels, g, bbl);
const h = g.holdings[bbl];
const loi = {
  id: 999001, bbl, kind: "new", name: "Test Tenant LLC", sector: "law", credit: 1,   // a trade the engine has books for (FIRM_PROFILE)
  sf: Math.round(free), rentPsf: 40, termM: 60, tiPsf: 0, freeM: 0, net: false,
  use, expiresM: g.month + 3,
};
const lc = E.loiSigningCost(loi);   // no TI on this letter: the whole signing cost is the commission
check(E.loiSigningCash(loi) === 0, `a lease with no TI and no free rent needs no cash to sign (${E.loiSigningCash(loi)})`);

// An empty account. (The line, if any, is not touched at signing: it is what
// pays the broker at the month-end below if the cash is not there.)
g.cash = 0;
const before = h.tenants.length;
E.signLoi(g, rec, h, loi);
check(h.tenants.length === before + 1, "the lease signs");
check(g.cash > 0, `the account does not go negative: it holds the tenant's deposit (${Math.round(g.cash).toLocaleString()})`);
const owed = (g.leasingPayables ?? []).reduce((a, p) => a + p.amount, 0);
check(Math.abs(owed - lc) <= 1, `the commission is owed to the broker: ${owed.toLocaleString()} of ${lc.toLocaleString()}`);
const nwOwing = E.netWorth(g, parcels);
const nwClear = E.netWorth({ ...g, leasingPayables: undefined }, parcels);
check(Math.abs(nwClear - nwOwing - owed) <= 1, `what is owed counts against net worth (${Math.round(nwClear - nwOwing).toLocaleString()} less)`);

// The next month pays the broker in full, from cash or the line.
g.cash += lc * 3;
g = E.advanceMonth(g, parcels, bbls, adjacency);
check(!(g.leasingPayables ?? []).length, "the month the cash is there, the broker is paid");

console.log(bad ? `\n${bad} FAILED` : "\nall clear");
process.exit(bad ? 1 : 0);
