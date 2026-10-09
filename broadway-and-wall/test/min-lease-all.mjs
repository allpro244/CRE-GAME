// ONE MINIMUM NEW LEASE FOR THE WHOLE BOOK — set on every deed, inherited by
// the next one bought, cleared everywhere with 0.
//
//   pnpm engine && node test/min-lease-all.mjs
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels, bbls, adjacency } = loadCity(0, E.normalizeParcels);

let bad = 0;
const ok = (c, m) => { console.log(`  ${c ? "OK  " : "FAIL"}  ${m}`); if (!c) bad++; };
console.log("\nMINIMUM NEW LEASE, ALL BUILDINGS\n");

// Buy whatever built stock the tape offers, all cash, until there are three deeds.
let g = E.firstListings(E.newGame(550991, parcels, 80_000_000), parcels, bbls);
const bought = [];
for (let m = 0; m < 24 && bought.length < 4; m++) {
  for (const L of [...g.listings]) {
    if (bought.length >= 4) break;
    const rec = E.resolveRec(parcels, g, L.bbl);
    if (!rec || rec.class === "land" || !(rec.bldgArea > 0)) continue;
    const r = E.executePurchase(g, parcels, L.bbl, L.ask, "cash", false, 1);
    if (r.err || !r.s.holdings[L.bbl]) continue;
    g = r.s; bought.push(L.bbl);
  }
  if (bought.length < 4) g = E.advanceMonth(g, parcels, bbls, adjacency);
}
ok(bought.length >= 4, `bought ${bought.length} buildings to work with`);
const first = bought.slice(0, 3), later = bought[3];
// Undo the fourth so it can be bought again after the house floor is set.
const g0 = { ...g, holdings: Object.fromEntries(Object.entries(g.holdings).filter(([b]) => b !== later)) };

const g1 = E.setMinLeaseSfAll(g0, 5000);
ok(first.every((b) => g1.holdings[b].minLeaseSf === 5000), "every deed carries the 5,000 sf floor");
ok(g1.minLeaseDefault === 5000, "and it is the house default");
ok(g0.minLeaseDefault === undefined && first.every((b) => g0.holdings[b].minLeaseSf === undefined), "the state it was given is untouched");

const L = g.listings.find((l) => l.bbl === later) ?? { bbl: later, ask: E.ownedHoldingValue(g, parcels, g.holdings[later]) };
const r = E.executePurchase({ ...g1, listings: [...g1.listings.filter((l) => l.bbl !== later), { ...L, bbl: later, ask: L.ask }] }, parcels, later, L.ask, "cash", false, 1);
ok(!r.err && r.s.holdings[later]?.minLeaseSf === 5000, `a building bought afterwards opens on the house floor (${r.err ?? r.s.holdings[later]?.minLeaseSf})`);

const g2 = E.setMinLeaseSfAll(g1, 0);
ok(first.every((b) => g2.holdings[b].minLeaseSf === undefined) && g2.minLeaseDefault === undefined, "0 clears the floor on every deed and the default");

const g3 = E.setMinLeaseSf(g1, first[0], 12000);
ok(g3.holdings[first[0]].minLeaseSf === 12000 && g3.holdings[first[1]].minLeaseSf === 5000, "one building can still be set apart on its own desk");

if (bad) { console.log(`\n${bad} FAILED`); process.exit(1); }
console.log("\nall clear");
