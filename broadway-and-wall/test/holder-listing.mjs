// Holder memory on the tape — cold holders block the player, not the market.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

const { parcels, bbls } = loadCity(0, E.normalizeParcels);
let g = E.firstListings(E.newGame(550991, parcels), parcels, bbls);

function ok(label, cond) {
  if (!cond) throw new Error(`FAIL  ${label}`);
  console.log(`  OK   ${label}`);
}

let target = null;
for (let m = 0; m < 48 && !target; m++) {
  g = E.advanceQuarter(g, parcels, bbls, {});
  for (const l of g.listings) {
    const held = E.holderOf(g, parcels, l.bbl);
    if (held) { target = { bbl: l.bbl, id: held.id, name: held.name }; break; }
  }
}
ok("listed building with named holder", !!target);

E.offend(g, target.id, 18);
ok("holder cold after offence", E.isCold(g, target.id));

const buy = E.buyListing(g, parcels, target.bbl, "cash");
ok("buyListing blocked", !!buy.err && buy.err.includes(target.name.split(" ")[0]));

const neg = E.negotiate(g, parcels, target.bbl, Math.round(g.listings.find((l) => l.bbl === target.bbl).ask * 0.85));
ok("negotiate blocked", !!neg.err);

const listing = g.listings.find((l) => l.bbl === target.bbl);
const odds = E.bidOdds(g, parcels, target.bbl, listing, Math.round(listing.ask * 0.9));
ok("bidOdds zero when cold", odds === 0);

console.log("\nholder-listing pass");
