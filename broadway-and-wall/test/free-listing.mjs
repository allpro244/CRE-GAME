// LISTING COSTS NOTHING; YOU PAY WHEN IT TRADES (owner, Oct 2026: "it costs
// absolutely $0 to sell a property and you only pay if a property transacts,
// like real life"). Put a building on the market quietly and with a broker's
// campaign, pull it, and the firm's cash and books have not moved a dollar.
//
//   pnpm engine && node test/free-listing.mjs
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels, bbls } = loadCity(0, E.normalizeParcels);

let bad = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "OK  " : "FAIL"}  ${msg}`); if (!ok) bad++; };

let g = E.firstListings(E.newGame(4242, parcels, 25_000_000), parcels, bbls);
let bbl = null;
for (const li of g.listings) {
  const r = E.resolveRec(parcels, g, li.bbl);
  if (!r || r.class === "land" || !(r.bldgArea > 0)) continue;
  const b = E.buyListing(g, parcels, li.bbl, "cash");
  if (b.err) continue;
  g = b.s; bbl = li.bbl; break;
}
check(!!bbl, "bought a building to sell");
if (bbl) {
  const rec = E.resolveRec(parcels, g, bbl);
  const ask = Math.round(E.assetValue(rec, g.econ, E.initialCondition(rec)));
  const books = (s) => JSON.stringify(s.books ?? []);
  for (const mode of ["quiet", "marketed"]) {
    const cash0 = g.cash, books0 = books(g);
    const listed = E.listForSale(g, parcels, bbl, ask, mode);
    check(!listed.err, `a ${mode} listing goes up${listed.err ? `: ${listed.err}` : ""}`);
    if (listed.err) continue;
    check(listed.s.cash === cash0, `a ${mode} listing costs nothing (cash ${cash0.toLocaleString()} -> ${listed.s.cash.toLocaleString()})`);
    check(books(listed.s) === books0, `a ${mode} listing books nothing`);
    const pulled = E.delist(listed.s, bbl);
    check(pulled.cash === cash0, `pulling a ${mode} listing costs nothing`);
  }
}
console.log(bad ? `\n${bad} FAILED` : "\nall clear");
process.exit(bad ? 1 : 0);
