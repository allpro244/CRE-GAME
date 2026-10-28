// A COUNTER THE BIDDER AGREED TO IS THE PRICE THE BUILDING SELLS AT (owner,
// Oct 2026: "when you counter an offer while looking at the bid list ... that
// counter might be fake. I countered someone to be 20% higher, they agreed,
// but when accepting their offer it went to the original").
//
// The bid list is read as best-first everywhere a "take the best bid" button
// lives — the building file's footer, the pipeline's "Take best", the inbox,
// the bids-are-in card, the Deals desk — and every one of them takes index 0.
// counterBid moved a bidder's price without re-ranking the list, so the buyer
// who had just come up past the field sat in second place while "Take best"
// signed the old top bidder at the number they first bid.
//
//   1. a bidder who comes up past the field is the top of the list;
//   2. taking the top of the list takes them, at the countered price, and the
//      sale closes at that price;
//   3. a stale index (the list re-ranked under the click) still takes the
//      bidder the player was looking at, when the caller names them;
//   4. a bidder who walks drops to the bottom, so index 0 is always live;
//   5. the single-offer counter closes at the countered number too.
//
//   pnpm engine && node test/bid-counter.mjs
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels, bbls, adjacency } = loadCity(0, E.normalizeParcels);

let bad = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "OK  " : "FAIL"}  ${msg}`); if (!ok) bad++; };
const usd = (n) => `$${Math.round(n).toLocaleString()}`;

// Own a building for a few months, then run a marketed campaign to a bid list.
function withBidList(seed) {
  let g = E.firstListings(E.newGame(seed, parcels, 60_000_000), parcels, bbls);
  let bbl = null;
  for (const li of g.listings) {
    const r = E.resolveRec(parcels, g, li.bbl);
    if (!r || r.class === "land" || !(r.bldgArea > 0)) continue;
    const b = E.buyListing(g, parcels, li.bbl, "cash");
    if (b.err) continue;
    g = b.s; bbl = li.bbl; break;
  }
  if (!bbl) return null;
  for (let i = 0; i < 3; i++) g = E.advanceMonth(g, parcels, bbls, adjacency);
  const rec = E.resolveRec(parcels, g, bbl);
  const ask = Math.round(E.assetValue(rec, g.econ, E.initialCondition(rec)));
  const L = E.listForSale(g, parcels, bbl, ask, "marketed");
  if (L.err) return null;
  g = L.s;
  for (let i = 0; i < 12 && !g.holdings[bbl]?.sale?.bids; i++) g = E.advanceMonth(g, parcels, bbls, adjacency);
  const live = (g.holdings[bbl]?.sale?.bids ?? []).filter((b) => !b.dropped);
  return live.length >= 2 ? { g, bbl } : null;
}

// Run the contract to its closing date and return the exit it printed.
function closeOut(g, bbl) {
  for (let i = 0; i < 4 && g.holdings[bbl]; i++) g = E.advanceMonth(g, parcels, bbls, adjacency);
  return { g, exit: g.exits.filter((x) => x.bbl === bbl).at(-1) };
}

// --- 1 & 2: counter a lower bidder past the top, then "take best" ----------
let tested = 0;
for (const seed of [4242, 1717, 9001, 31337]) {
  const set = withBidList(seed);
  if (!set) continue;
  const { g, bbl } = set;
  const bids = g.holdings[bbl].sale.bids;
  const top = bids[0].price;
  for (let i = 1; i < bids.length && !tested; i++) {
    const b = bids[i];
    if (b.dropped) continue;
    const px = Math.round(Math.max(top * 1.01, b.price * 1.02));
    const c = E.counterBid(g, parcels, bbl, i, px);
    if (c.err) continue;
    const after = c.s.holdings[bbl].sale.bids;
    const me = after.find((x) => x.name === b.name);
    if (me.dropped || me.price <= top) continue;           // walked, or split under the old top
    console.log(`seed ${seed}: ${b.name} ${usd(b.price)} -> ${usd(me.price)} (top was ${usd(top)} from ${bids[0].name})`);
    check(after[0].name === b.name && after[0].price === me.price,
      `the bidder who came up past the field heads the list (head: ${after[0].name} ${usd(after[0].price)})`);
    // What every "Take best" button does.
    const a = E.acceptBid(c.s, parcels, bbl, 0);
    check(!a.err, `take best${a.err ? `: ${a.err}` : ""}`);
    if (a.err) { tested++; break; }
    const offer = a.s.holdings[bbl].sale.offer;
    check(offer.from === b.name, `take best signs the bidder you countered (${offer.from})`);
    if (offer.retrade) {
      // A retrade is a real outcome, and it is struck off the countered number.
      check(offer.price < me.price, `retrade struck off the countered number (${usd(offer.price)} < ${usd(me.price)})`);
      continue;
    }
    check(offer.price === me.price, `contract at the countered price ${usd(me.price)} (got ${usd(offer.price)}, original bid ${usd(b.price)})`);
    const { exit } = closeOut(a.s, bbl);
    check(!!exit && exit.price === me.price, `the sale closes at the countered price (exit ${exit ? usd(exit.price) : "none"})`);
    tested++;
  }
  if (tested) break;
}
check(tested > 0, "found a bidder who came up past the field and a clean contract to test");

// --- 3 & 4: stale index with a name, and a walk-away -----------------------
{
  const set = withBidList(4242);
  check(!!set, "setup: a bid list");
  if (set) {
    const { g, bbl } = set;
    const bids = g.holdings[bbl].sale.bids;
    const want = bids[bids.length - 1];
    const a = E.acceptBid(g, parcels, bbl, 0, want.name);
    check(!a.err && a.s.holdings[bbl].sale.offer.from === want.name,
      `a named take signs that bidder even from a stale index (${a.err ?? a.s.holdings[bbl].sale.offer.from})`);
    // Push the top bidder far past anything they would pay: they walk, and the
    // head of the list is somebody still at the table.
    const w = E.counterBid(g, parcels, bbl, 0, Math.round(bids[0].price * 1.6));
    const after = w.s.holdings[bbl].sale.bids;
    check(!w.err && after.some((x) => x.dropped), "the top bidder walked at +60%");
    check(!after[0].dropped, `index 0 is a live bid after a walk (${after[0].name})`);
    check(after.every((x, i) => i === 0 || (after[i - 1].dropped ? 1 : 0) <= (x.dropped ? 1 : 0)),
      "walked bidders sort to the bottom");
  }
}

// --- 5: the single-offer counter --------------------------------------------
{
  let done = false;
  for (const seed of [4242, 1717, 9001, 31337, 777, 2024]) {
    let g = E.firstListings(E.newGame(seed, parcels, 60_000_000), parcels, bbls);
    let bbl = null;
    for (const li of g.listings) {
      const r = E.resolveRec(parcels, g, li.bbl);
      if (!r || r.class === "land" || !(r.bldgArea > 0)) continue;
      const b = E.buyListing(g, parcels, li.bbl, "cash");
      if (b.err) continue;
      g = b.s; bbl = li.bbl; break;
    }
    if (!bbl) continue;
    for (let i = 0; i < 3; i++) g = E.advanceMonth(g, parcels, bbls, adjacency);
    const rec = E.resolveRec(parcels, g, bbl);
    const ask = Math.round(E.assetValue(rec, g.econ, E.initialCondition(rec)) * 1.05);
    g = E.listForSale(g, parcels, bbl, ask, "quiet").s;
    for (let i = 0; i < 24 && !g.holdings[bbl]?.sale?.offer; i++) g = E.advanceMonth(g, parcels, bbls, adjacency);
    const offer = g.holdings[bbl]?.sale?.offer;
    if (!offer) continue;
    const c = E.counterSale(g, parcels, bbl, Math.round(offer.price * 1.02));
    const o2 = c.s.holdings[bbl]?.sale?.offer;
    if (c.err || !o2 || o2.price <= offer.price) continue;
    const a = E.acceptSaleOffer(c.s, parcels, bbl);
    check(!a.err, `accept the countered offer${a.err ? `: ${a.err}` : ""}`);
    const exit = a.s.exits.filter((x) => x.bbl === bbl).at(-1);
    check(!!exit && exit.price === o2.price,
      `single offer closes at the countered ${usd(o2.price)} (exit ${exit ? usd(exit.price) : "none"}, they bid ${usd(offer.price)})`);
    done = true; break;
  }
  check(done, "found a quiet offer to counter");
}

console.log(bad ? `\n${bad} FAILED` : "\nall clear");
process.exit(bad ? 1 : 0);
