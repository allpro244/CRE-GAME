// Seller reservation curve — bidOdds monotonicity and median near ask (#33).
//   pnpm engine && pnpm seller-stats
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

const { parcels, bbls } = loadCity(0, E.normalizeParcels);
let g = E.firstListings(E.newGame(550991, parcels), parcels, bbls);

let fails = 0;
const ok = (name, cond, detail = "") => {
  if (!cond) { fails++; console.log(`FAIL  ${name}${detail ? " — " + detail : ""}`); }
  else console.log(`PASS  ${name}${detail ? " — " + detail : ""}`);
};

const listing = g.listings.find((l) => l.ask > 500_000);
ok("tape has a listing", !!listing);
if (!listing) process.exit(1);

const bbl = listing.bbl;
let prev = -0.01;
for (const pct of [0.65, 0.75, 0.85, 0.90, 0.94, 0.97, 1.0]) {
  const p = E.bidOdds(g, parcels, bbl, listing, Math.round(listing.ask * pct));
  ok(`odds rise at ${(pct * 100).toFixed(0)}% of ask`, p >= prev - 1e-9, `p=${p.toFixed(3)} prev=${prev.toFixed(3)}`);
  prev = p;
}

const mid = E.bidOdds(g, parcels, bbl, listing, Math.round(listing.ask * 0.94));
ok("94% of ask is near coin flip", mid > 0.35 && mid < 0.75, `p=${mid.toFixed(3)}`);

const low = E.bidOdds(g, parcels, bbl, listing, Math.round(listing.ask * 0.70));
ok("70% of ask is long shot", low < 0.05, `p=${low.toFixed(4)}`);

const distress = { ...listing, distress: true };
const distressMid = E.bidOdds(g, parcels, bbl, distress, Math.round(listing.ask * 0.94));
ok("distress listing accepts lower bids", distressMid > mid,
  `distress=${distressMid.toFixed(3)} normal=${mid.toFixed(3)}`);

// Cold holder blocks the tape door entirely.
for (let m = 0; m < 48 && !E.holderOf(g, parcels, bbl); m++) {
  g = E.advanceQuarter(g, parcels, bbls, {});
  const li = g.listings.find((l) => l.bbl === bbl);
  if (!li) break;
}
const held = E.holderOf(g, parcels, bbl);
if (held) {
  E.offend(g, held.id, 18, parcels);
  const li2 = g.listings.find((l) => l.bbl === bbl) ?? listing;
  ok("cold holder → bidOdds 0", E.bidOdds(g, parcels, bbl, li2, li2.ask) === 0);
} else {
  console.log("SKIP  cold-holder case (no named holder on sample listing)");
}

console.log(`\n${fails === 0 ? "seller-stats pass" : `${fails} seller-stats failure(s)`}`);
process.exit(fails === 0 ? 0 : 1);
