// NO BID IS A BANK BALANCE (owner, 2026-11-27; playtest F7).
//
// A bid in the street's round was min(the firm's shaded number, what it can
// fund), so a firm whose purse sat below its number bid its purse, however
// small: the player listing 673 State St at $5.66M was offered $123K with
// "next best $47K", and on the town's own tape 62 of 283 bids in a year (seed
// 12007) were purses under the seller's reserve, 18 of them the top bid — one
// firm bid $1K on a $1.68M building. A buyer who cannot fund a deal at a price
// the seller would take does not bid (propmarket.ts bidRound, landBidRound).
//
// Asserted on every round the tape holds, every other month for eight months:
// no bid is under the seller's floor (purseFloor) while the firm could not
// fund its own shaded number. A firm that values the deed under the floor and
// can fund that still bids it (evidence the round prints); that is allowed.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

function ok(label, cond) {
  if (!cond) throw new Error(`FAIL  ${label}`);
  console.log(`  OK   ${label}`);
}
const money = (n) => `$${(n / 1e6).toFixed(3)}M`;

const MONTHS = Number(process.env.MONTHS ?? 8);
const C = loadCity(0, E.normalizeParcels);
const parcels = JSON.parse(JSON.stringify(C.parcels));
let g = E.firstListings(E.newGame(12007, parcels, undefined, undefined), parcels, C.bbls);
let rounds = 0, bids = 0, ownUnderFloor = 0;
const bad = [];
for (let m = 0; m < MONTHS; m++) {
  if (m % 2 === 1) {
    for (const li of g.listings) {
      const rec = E.resolveRec(parcels, g, li.bbl);
      if (!rec || li.halfBuilt || g.holdings[li.bbl]) continue;
      const building = rec.class !== "land" && rec.bldgArea > 0;
      const rd = building ? E.bidRound(g, parcels, rec, li) : E.landBidRound(g, parcels, rec, li);
      const floor = E.purseFloor(li);   // the seller's reserve, or the tape's floor from one that takes any bid
      rounds++;
      for (const b of rd.bids) {
        bids++;
        const want = E.shadedBid(b.max, rd.n);
        const purse = (b.afford ?? Infinity) < want - 1000;
        if (purse && b.bid < floor) bad.push(`m${g.month} ${rec.address}: ${b.r.name} bid ${money(b.bid)} (ask ${money(li.ask)}, floor ${money(floor)}) on a purse of ${money(b.afford)} against its own ${money(want)}`);
        if (!purse && b.bid < floor) ownUnderFloor++;
      }
    }
  }
  g = E.advanceQuarter(g, parcels, C.bbls, C.adjacency);
}
for (const t of bad.slice(0, 5)) console.log(`  purse bid: ${t}`);
// coverage: the rounds ran and drew bids, or the zero below means nothing
ok(`rounds held (${rounds}) and bids drawn (${bids})`, rounds >= 50 && bids >= 100);
ok(`firms that value a deed under the seller's floor still bid their own number (${ownUnderFloor})`, ownUnderFloor >= 1);
ok(`no bid is a purse under the seller's floor (${bad.length})`, bad.length === 0);
console.log("no-purse-bids: OK");
