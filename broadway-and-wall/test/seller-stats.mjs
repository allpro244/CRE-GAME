// One seller for every buyer (PARITY_PLAN.md P1). An offer under the ask on
// the tape goes into the month's bid round: it is taken when it clears the
// seller's own floor (listingReserve) and beats every bid from a firm that can
// close. This checks the rule through buyListing itself, then reports what a
// player must pay, as a share of the ask, across seeds.
//   pnpm engine && pnpm seller-stats
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

const { parcels, bbls, adjacency } = loadCity(0, E.normalizeParcels);

let fails = 0;
const ok = (name, cond, detail = "") => {
  if (!cond) { fails++; console.log(`FAIL  ${name}${detail ? " — " + detail : ""}`); }
  else console.log(`PASS  ${name}${detail ? " — " + detail : ""}`);
};

/** What it takes to win this listing this month: the seller's floor and the best bid that can close. */
function bar(g, li) {
  const rec = E.resolveRec(parcels, g, li.bbl);
  const building = rec.class !== "land" && rec.bldgArea > 0;
  const top = building ? E.bidRound(g, parcels, rec, li).bids[0]
    : !li.halfBuilt ? E.landBidRound(g, parcels, rec, li).bids[0] : undefined;
  return { floor: E.listingReserve(li), top: top?.bid ?? 0 };
}

// --- The rule, on one seed ---
{
  let g = E.firstListings(E.newGame(550991, parcels), parcels, bbls);
  for (let m = 0; m < 24; m++) g = E.advanceMonth(g, parcels, bbls, adjacency ?? {});
  g = { ...g, cash: 1e10 };
  // A voluntary building whose bar sits under its ask, so there is a number to win it with.
  const li = g.listings.find((l) => {
    const rec = E.resolveRec(parcels, g, l.bbl);
    if (l.distress || !rec || rec.class === "land" || !(rec.bldgArea > 0)) return false;
    const b = bar(g, l);
    return Math.max(b.floor, b.top) + 1000 < l.ask;
  });
  ok("tape has a voluntary building winnable under its ask", !!li);
  if (!li) process.exit(1);
  const b = bar(g, li);
  const win = Math.round(Math.max(b.floor, b.top) + 1000);

  const under = E.buyListing(g, parcels, li.bbl, "cash", 1, Math.round(Math.max(b.floor, b.top) - 1000));
  ok("an offer under the bar is refused", !!under.refused && !under.s.holdings[li.bbl], under.msg ?? under.err);
  const again = E.buyListing(under.s, parcels, li.bbl, "cash", 1, win);
  ok("a second number the same month is not taken", !!again.err && !again.s.holdings?.[li.bbl], again.err);

  const took = E.buyListing(g, parcels, li.bbl, "cash", 1, win);
  ok("an offer over the floor and every closing bid is taken", !!took.s.holdings?.[li.bbl],
    `${took.msg ?? took.err} · floor ${Math.round(b.floor)} · top bid ${Math.round(b.top)} · ask ${li.ask}`);

  // A cold holder does not take your call at any price.
  const held = E.holderOf(g, parcels, li.bbl);
  if (held) {
    const g2 = structuredClone(g);
    E.offend(g2, held.id, 18, parcels);
    const cold = E.buyListing(g2, parcels, li.bbl, "cash", 1, win);
    ok("cold holder refuses", !cold.s.holdings?.[li.bbl], cold.err ?? cold.msg);
  } else {
    console.log("SKIP  cold-holder case (no named holder on sample listing)");
  }

  // The negotiation desk still reads the kind table (acquire.ts reservationOf).
  ok("estate reservation sits under a local", E.reserveMidOf("estate") < E.reserveMidOf("local"));
  ok("institution reservation sits over a local", E.reserveMidOf("institution") > E.reserveMidOf("local"));
}

// --- Report: what a player must pay, as a share of the ask ---
{
  const SEEDS = [550991, 11, 22, 33, 4242];
  const YEARS = 30;
  const rows = { voluntary: [], distressed: [], contested: [] };
  for (const seed of SEEDS) {
    let g = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
    for (let m = 0; m < YEARS * 12; m++) {
      if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
      if (m % 12 === 0) {
        for (const li of g.listings) {
          if (!(li.ask > 250_000)) continue;
          const b = bar(g, li);
          const need = Math.max(b.floor, b.top) / li.ask;
          (li.distress ? rows.distressed : rows.voluntary).push(need);
          rows.contested.push(b.top > b.floor ? 1 : 0);
        }
      }
      g = E.advanceMonth(g, parcels, bbls, adjacency ?? null);
    }
  }
  const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(p * (s.length - 1))] : NaN; };
  const fmt = (a) => `n=${a.length}  p10=${q(a, 0.1).toFixed(3)}  median=${q(a, 0.5).toFixed(3)}  p90=${q(a, 0.9).toFixed(3)}`;
  console.log(`\nwhat it takes to win, as a share of the ask (${SEEDS.length} seeds × ${YEARS}y, annual tape):`);
  console.log(`  voluntary     ${fmt(rows.voluntary)}`);
  console.log(`  distressed    ${fmt(rows.distressed)}`);
  const share = rows.contested.reduce((a, x) => a + x, 0) / Math.max(1, rows.contested.length);
  console.log(`  a firm's bid over the seller's floor on ${(share * 100).toFixed(0)}% of listings`);
  ok("sampled listings", rows.voluntary.length >= 50, `n=${rows.voluntary.length}`);
  if (rows.distressed.length >= 10) {
    ok("distress clears cheaper than voluntary (median)", q(rows.distressed, 0.5) <= q(rows.voluntary, 0.5) + 1e-9,
      `distressed=${q(rows.distressed, 0.5).toFixed(3)} voluntary=${q(rows.voluntary, 0.5).toFixed(3)}`);
  } else console.log("SKIP  distress vs voluntary (thin sample)");
}

console.log(`\n${fails === 0 ? "seller-stats pass" : `${fails} seller-stats failure(s)`}`);
process.exit(fails === 0 ? 0 : 1);
