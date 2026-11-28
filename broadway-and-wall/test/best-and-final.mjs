// BEST AND FINAL, AND A TYPO IS NOT AN OFFER (playtest 2026-11-27, F13 and F3).
//
// F13. An offer at the ask that a firm on the street outbid was refused with
// "the ask stands", and a second number the same month, even 25% over the
// ask, got "the seller has your offer for this month". A seller holding a
// competing bid who is offered more does not refuse to read it: it calls best
// and final. Now the first refusal calls one (`listing.final`), and the player
// has one more number that month, which must beat the first; it wins when it
// beats every firm's walk-away (the lower of its own number and what it can
// fund — each firm in a best and final puts in its last number), read here
// from the round itself, never hard-coded. A third number the same month is
// the old guard; next month is a fresh offer.
//
// F3. A bid of zero, a negative, NaN or Infinity fell through to the insult
// branch and the seller pulled the listing (or printed "$— of equity").
// Every offer path now answers "Name a real number." and touches nothing.
//
// No draw anywhere in it: every answer is read off the round.
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

const C = loadCity(0, E.normalizeParcels);
const parcels = JSON.parse(JSON.stringify(C.parcels));
let g = E.firstListings(E.newGame(12007, parcels, undefined, undefined), parcels, C.bbls);
g = E.advanceQuarter(g, parcels, C.bbls, C.adjacency);
g = { ...g, cash: g.cash + 20e6 };          // headroom: the test is the seller's answer, not the purse
const rngOf = (s) => JSON.stringify([s.rng, s.streams ?? null]);
const rng0 = rngOf(g);
if (typeof g.rng !== "number") throw new Error("FAIL  the rng state is where this test reads it");
const isBuilding = (bbl) => { const r = E.resolveRec(parcels, g, bbl); return !!r && r.class !== "land" && r.bldgArea > 0; };

// ---- F3: typo bids on every offer path -------------------------------------
console.log("F3 — a typo is not an offer");
const li0 = g.listings.find((l) => isBuilding(l.bbl) && !l.halfBuilt);
ok("a building on the tape to bid on", !!li0);
for (const b of [-1e6, 0, NaN, Infinity, -Infinity]) {
  const x = E.buyListing(g, parcels, li0.bbl, "cash", 1, b);
  ok(`buyListing ${b}: "Name a real number.", listing up, nothing moved`,
    x.err === "Name a real number." && x.s === g && g.listings.some((l) => l.bbl === li0.bbl));
}
// the documented insult still is one: a real number nowhere near theirs
{
  const x = E.buyListing(g, parcels, li0.bbl, "cash", 1, 1);
  ok("a $1 bid is still an insult (the listing is pulled)", !x.err && x.refused && !x.s.listings.some((l) => l.bbl === li0.bbl));
}
// off-market: an owner with an ask, a counter, and the player's own sale's offer and bid list
{
  const bbl = Object.keys(parcels).find((b) => isBuilding(b) && !g.listings.some((l) => l.bbl === b) && !g.holdings[b]
    && !E.coldOnDeed(g, parcels, b));
  const s1 = structuredClone(g);
  s1.approaches[bbl] = { q: s1.month, ask: 1_000_000 };
  for (const b of [NaN, 0, -5]) {
    const x = E.buyOffMarket(s1, parcels, bbl, "cash", 1, b);
    ok(`buyOffMarket ${b}: "Name a real number."`, x.err === "Name a real number." && x.s === s1);
    const y = E.counterOffMarket(s1, parcels, C.adjacency, bbl, b);
    ok(`counterOffMarket ${b}: "Name a real number."`, y.err === "Name a real number." && y.s === s1 && !s1.approaches[bbl].countered);
  }
  // a building of your own on the market with an offer and a bid list
  const mine = g.listings.find((l) => isBuilding(l.bbl) && !l.halfBuilt && l.bbl !== li0.bbl);
  const bought = E.executePurchase(structuredClone(g), parcels, mine.bbl, mine.ask, "cash", false, 1);
  ok("bought a building to sell", !bought.err && !!bought.s.holdings[mine.bbl]);
  const s2 = bought.s;
  s2.holdings[mine.bbl].sale = {
    ask: mine.ask, listedM: s2.month, mode: "marketed",
    offer: { price: Math.round(mine.ask * 0.9), expiresM: s2.month + 2, from: "a firm" },
    bids: [{ name: "a firm", price: Math.round(mine.ask * 0.9), credibility: 0.8 }],
  };
  for (const b of [NaN, 0, -1]) {
    const x = E.counterSale(s2, parcels, mine.bbl, b);
    ok(`counterSale ${b}: "Name a real number."`, x.err === "Name a real number." && x.s === s2);
    const y = E.counterBid(s2, parcels, mine.bbl, 0, b);
    ok(`counterBid ${b}: "Name a real number."`, y.err === "Name a real number." && y.s === s2 && !s2.holdings[mine.bbl].sale.bids[0].countered);
  }
}

// ---- F13: best and final -----------------------------------------------------
console.log("F13 — the seller calls best and final");
let found = 0;
for (const li of g.listings) {
  if (!isBuilding(li.bbl) || li.halfBuilt) continue;
  const rec = E.resolveRec(parcels, g, li.bbl);
  const first = E.buyListing(g, parcels, li.bbl, "cash", 1);
  if (!first.refused) continue;
  const at = `${parcels[li.bbl].address} (ask ${money(li.ask)})`;
  ok(`${at}: an offer at the ask outbid by a firm calls best and final`,
    /best and final/i.test(first.msg) && first.s.listings.find((l) => l.bbl === li.bbl)?.final?.first === li.ask
    && first.s.listings.find((l) => l.bbl === li.bbl)?.ask === li.ask);
  const s1 = first.s;
  // the bar is the room's best walk-away, read off the round on the same state
  const round = E.bidRound(s1, parcels, rec, s1.listings.find((l) => l.bbl === li.bbl));
  const bar = Math.max(...round.bids.map((b) => Math.round(Math.min(b.max, b.afford ?? b.max) / 1000) * 1000));
  ok(`${at}: the bar (${money(bar)}) is at or over the best sealed bid (${money(round.bids[0].bid)}) and the ask`,
    bar >= round.bids[0].bid && bar >= li.ask);
  // a final that does not beat the first is not a final
  const same = E.buyListing(s1, parcels, li.bbl, "cash", 1, li.ask);
  ok(`${at}: a final at the first offer is an error, nothing changes`, /has to beat/.test(same.err ?? "") && same.s === s1);
  // a final at the bar loses (a tie goes to the firm), and then the month is closed
  const lose = E.buyListing(s1, parcels, li.bbl, "cash", 1, bar);
  ok(`${at}: a final at the bar is refused, the ask stands`,
    lose.refused && /Best and final went to a firm/.test(lose.msg) && !lose.s.holdings[li.bbl]
    && lose.s.listings.find((l) => l.bbl === li.bbl)?.final === undefined);
  const third = E.buyListing(lose.s, parcels, li.bbl, "cash", 1, bar * 2);
  ok(`${at}: a third number the same month gets the old guard`, /has your offer for this month/.test(third.err ?? ""));
  // a final over the bar takes it
  const win = E.buyListing(s1, parcels, li.bbl, "cash", 1, bar + 1000);
  ok(`${at}: a final over the bar (${money(bar + 1000)}) takes it`, !win.err && !win.refused && !!win.s.holdings[li.bbl]
    && !win.s.listings.some((l) => l.bbl === li.bbl));
  // a best and final called last month does not carry over: next month is a fresh offer
  const s2 = structuredClone(s1);
  const l2 = s2.listings.find((l) => l.bbl === li.bbl);
  l2.offeredM = s2.month - 1; l2.final = { m: s2.month - 1, first: li.ask * 2 };
  const fresh = E.buyListing(s2, parcels, li.bbl, "cash", 1, li.ask);
  ok(`${at}: next month a normal offer is read (last month's final does not bind)`,
    !fresh.err && /best and final/i.test(fresh.msg ?? "") && fresh.s.listings.find((l) => l.bbl === li.bbl)?.final?.m === s2.month);
  ok(`${at}: no draw in any of it`, [first, same, lose, third, win, fresh].every((x) => rngOf(x.s) === rng0));
  if (++found >= 3) break;
}
ok(`found listings outbid at the ask to test (${found})`, found >= 1);
console.log("best-and-final: OK");
