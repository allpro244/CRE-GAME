// EVERY BUYER IS A FIRM ON THE PLAYERS LIST (owner, Oct 2026: "I built the
// largest portfolio then offered it for sale, the person who made the offer
// isn't even on the players list. This should never happen").
//
// The portfolio desk bid from six names that existed nowhere else in the game
// ("Kestrel Core Fund"), the bid list filled half its seats from nine strings
// ("a family office"), the quiet offer came from nobody, and the courthouse
// and the creditors sold to "money from out of town". None of them had a
// balance sheet; the deed went into no book. Now:
//
//   1. a big book listed as one portfolio is bid on only by living roster
//      firms, and closing it puts every deed in the winner's book and takes
//      the cheque out of the winner's account;
//   2. a marketed single sale's bid list is roster firms only, and the deed
//      lands with the bidder taken;
//   3. no firm can fund a cheque bigger than the street — no bid, not a
//      phantom one;
//   4. over two years with buildings on the market, every offer, bid and
//      portfolio indication the player ever sees names a roster firm.
//
//   pnpm engine && node test/visible-buyers.mjs
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
const M = (x) => `$${(x / 1e6).toFixed(1)}M`;
const roster = (g) => new Map(E.livingRivals(g).map((r) => [r.id, r]));
const firmOf = (g, id) => (g.rivals ?? []).find((r) => r.id === id);

// A big book: buy every income building on the opening tape that cash allows.
function bigBook(seed) {
  let g = E.firstListings(E.newGame(seed, parcels, 400_000_000), parcels, bbls);
  for (let m = 0; m < 3; m++) {
    for (const li of [...g.listings].sort((a, b) => b.ask - a.ask)) {
      const rec = E.resolveRec(parcels, g, li.bbl);
      if (!rec || rec.class === "land" || !(rec.bldgArea > 0)) continue;
      if (g.cash < li.ask * 1.2) continue;
      const b = E.buyListing(g, parcels, li.bbl, "cash");
      if (!b.err) g = b.s;
    }
    g = E.advanceMonth(g, parcels, bbls, adjacency);
  }
  for (let i = 0; i < 6; i++) g = E.advanceMonth(g, parcels, bbls, adjacency);
  return g;
}

console.log("\nVISIBLE BUYERS — every counterparty is a firm on the Players list\n");

let portfolioTested = 0, singleTested = 0;
for (const seed of [4242, 1717, 9001, 31337, 777]) {
  let g = bigBook(seed);
  const owned = Object.keys(g.holdings).filter((b) => !g.holdings[b].sale && !g.developments[b]);
  if (owned.length < 4) continue;

  // ---- 2. a marketed single sale -------------------------------------------
  if (!singleTested) {
    const bbl = owned[owned.length - 1];
    const v = E.ownedHoldingValue(g, parcels, g.holdings[bbl]);
    const L = E.listForSale(g, parcels, bbl, Math.round(v), "marketed");
    if (!L.err) {
      let h = L.s;
      for (let i = 0; i < 12 && !h.holdings[bbl]?.sale?.bids; i++) h = E.advanceMonth(h, parcels, bbls, adjacency);
      const bids = h.holdings[bbl]?.sale?.bids ?? [];
      if (bids.length) {
        singleTested++;
        const ros = roster(h);
        check(bids.every((b) => b.firmId && ros.get(b.firmId)?.name === b.name),
          `seed ${seed}: all ${bids.length} bids on the marketed sale are roster firms (${bids.map((b) => b.name).join(", ")})`);
        const took = E.acceptBid(h, parcels, bbl, 0, bids[0].name);
        check(!took.err, `taking the best bid works${took.err ? ` — ${took.err}` : ""}`);
        if (!took.err) {
          const offer = took.s.holdings[bbl].sale.offer;
          const buyerId = offer.firmId;
          check(!!buyerId && ros.has(buyerId), `the contract names a roster firm (${offer.from})`);
          const closed = E.acceptSaleOffer(took.s, parcels, bbl, false);
          check(!closed.err, `the sale closes${closed.err ? ` — ${closed.err}` : ""}`);
          if (!closed.err) {
            check(!closed.s.holdings[bbl], "the deed left your book");
            check(firmOf(closed.s, buyerId)?.bbls.includes(bbl), `the deed is in ${offer.from}'s book`);
          }
        }
      }
    }
  }

  // ---- 1. the whole book as one portfolio -----------------------------------
  // THE BOOK THE STREET CAN WRITE A CHEQUE FOR. Since the firms'-books
  // rewrite every bidder pays from its own cash, and this town's firms are
  // small (largest ~$6M cash, ~$20M AUM at month 9 on seed 4242) while a
  // $400M player can buy the whole opening tape — so the full ~$40M book
  // honestly has no buyer. Offer the largest bundle of the smallest deeds
  // (at least four) that some firm can close; the $10T check below still
  // asserts that an unfundable book draws nobody.
  const byValue = [...owned].sort((a, b) => E.ownedHoldingValue(g, parcels, g.holdings[a]) - E.ownedHoldingValue(g, parcels, g.holdings[b]));
  let bundle = byValue.slice(0, owned.length - 1), q = E.portfolioQuote(g, parcels, bundle);
  for (let n = owned.length - 2; n >= 4 && q.depth <= 0; n--) {
    bundle = byValue.slice(0, n); q = E.portfolioQuote(g, parcels, bundle);
  }
  // 3. a cheque bigger than every firm in town together has no buyer at all
  check(E.portfolioBuyerDepth(g, parcels, bundle, 1e13) === 0, `seed ${seed}: a $10T book has no buyer — not a phantom one`);
  check(q.depth <= E.livingRivals(g).length, `seed ${seed}: quote depth (${q.depth}) is a count of roster firms, never more`);
  if (q.depth <= 0) { console.log(`  note  seed ${seed}: nobody in town can fund ${M(q.sumOfParts)} — no listing`); continue; }
  const L = E.listPortfolio(g, parcels, bundle, Math.round(q.indicative * 0.97));
  if (L.err) { console.log(`  note  seed ${seed}: ${L.err}`); continue; }
  let h = L.s;
  for (let i = 0; i < 18 && h.portfolioSale && !h.portfolioSale.bids.length; i++) h = E.advanceMonth(h, parcels, bbls, adjacency);
  const bids = h.portfolioSale?.bids ?? [];
  if (!bids.length) { console.log(`  note  seed ${seed}: no indication on ${M(q.sumOfParts)} inside 18 months`); continue; }
  portfolioTested++;
  const ros = roster(h);
  check(bids.every((b) => b.firmId && ros.get(b.firmId)?.name === b.name),
    `seed ${seed}: ${bundle.length}-building ${M(q.sumOfParts)} book — every bidder is a roster firm (${bids.map((b) => b.name).join(", ")})`);
  const winnerId = bids[0].firmId;
  const live = h.portfolioSale.bbls.filter((b) => h.holdings[b]);
  const cashBefore = firmOf(h, winnerId).cash;
  const r = E.acceptPortfolioBid(h, parcels, false);
  check(!r.err, `accepting the portfolio bid closes${r.err ? ` — ${r.err}` : ""}`);
  if (!r.err) {
    const w = firmOf(r.s, winnerId);
    check(live.every((b) => !r.s.holdings[b]), "every deed left your book");
    check(live.every((b) => w.bbls.includes(b)), `every deed is in ${w.name}'s book`);
    check(cashBefore - w.cash > 0, `${w.name} paid out of its own account (${M(cashBefore - w.cash)} of equity)`);
    check(live.every((b) => E.ownerOf(r.s, b)?.id === winnerId), `the register names ${w.name} as the owner of all ${live.length}`);
  }
  if (portfolioTested >= 2 && singleTested) break;
}
check(portfolioTested > 0, `at least one big portfolio drew a bid and closed (${portfolioTested})`);
check(singleTested > 0, `at least one marketed sale drew bids (${singleTested})`);

// ---- 4. two years of the market, nobody unnamed --------------------------
{
  let g = bigBook(2468);
  let seen = 0, phantom = [];
  const look = (g) => {
    const ros = new Set(E.livingRivals(g).map((r) => r.name));
    for (const h of Object.values(g.holdings)) {
      const sale = h.sale;
      if (!sale) continue;
      if (sale.offer) { seen++; if (!ros.has(sale.offer.from) && !(g.rivals ?? []).some((r) => r.id === sale.offer.firmId)) phantom.push(sale.offer.from ?? "(no name)"); }
      for (const b of sale.bids ?? []) { seen++; if (!(g.rivals ?? []).some((r) => r.id === b.firmId && r.name === b.name)) phantom.push(b.name); }
    }
    for (const b of g.portfolioSale?.bids ?? []) { seen++; if (!(g.rivals ?? []).some((r) => r.id === b.firmId && r.name === b.name)) phantom.push(b.name); }
  };
  const ids = Object.keys(g.holdings);
  ids.forEach((bbl, i) => {
    const v = E.ownedHoldingValue(g, parcels, g.holdings[bbl]);
    const L = E.listForSale(g, parcels, bbl, Math.round(v * 1.02), i % 2 ? "quiet" : "marketed");
    if (!L.err) g = L.s;
  });
  for (let m = 0; m < 24; m++) {
    g = E.advanceMonth(g, parcels, bbls, adjacency);
    look(g);
  }
  check(seen > 0, `${seen} offers and bids seen over two years`);
  check(phantom.length === 0, `none from a name off the Players list${phantom.length ? ` — ${[...new Set(phantom)].join(", ")}` : ""}`);
}

// ---- 5. the builders are on the street from day one ------------------------
// Owner: "Every developer needs to be a visible player as well, as soon as the
// game starts. Only the 'ghost' holders can sell." The town's builders are
// founded before the opening frames are seeded, and every frame standing at
// the bell is one of theirs, on their book.
{
  for (const seed of [4242, 1717]) {
    const g = E.firstListings(E.newGame(seed, parcels, 5_000_000), parcels, bbls);
    const live = new Map(E.livingRivals(g).map((r) => [r.id, r]));
    const builders = [...live.values()].filter((r) => r.builderProf);
    check(g.month === 0 && builders.length > 0, `seed ${seed}: ${builders.length} builder firms on the list at month 0`);
    const jobs = g.cityJobs ?? [];
    const named = jobs.filter((j) => j.firmId && live.has(j.firmId));
    check(jobs.length > 0 && named.length === jobs.length,
      `seed ${seed}: all ${jobs.length} frames standing at the opening belong to a firm on the list (${named.length})`);
    check(named.every((j) => live.get(j.firmId).bbls.includes(j.bbl)), `seed ${seed}: each frame's site is on its builder's book`);
  }
  // ...and nothing opens later in nobody's name.
  let g = E.firstListings(E.newGame(9001, parcels, 5_000_000), parcels, bbls);
  let anon = 0, jobsSeen = 0, outsider = 0;
  for (let m = 0; m < 36; m++) {
    g = E.advanceMonth(g, parcels, bbls, adjacency);
    for (const j of g.cityJobs ?? []) { if (j.groundLease) continue; jobsSeen++; if (!j.firmId) anon++; }
    for (const c of g.comps ?? []) if (c.m === g.month && /Hartford|1031 buyer|out of town|out-of-state|nominee|family trust|doctors|name withheld/.test(c.buyer ?? "")) outsider++;
  }
  check(jobsSeen > 0 && anon === 0, `three years: ${jobsSeen} job-months under construction, none without a firm (${anon})`);
  check(outsider === 0, `three years: no tape sale to a buyer off the list (${outsider})`);
}

console.log(bad ? `\nFAIL — ${bad}` : "\nPASS — every buyer is somebody you can see");
process.exit(bad ? 1 : 0);
