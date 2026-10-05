// QUOTE == CLOSE — no levered closing without the loan it was levered on.
//
// `executePurchase` charges the buyer `buyQuote(...).equity` — price minus the
// QUOTED principal — and then asks `originate` to write that loan. `originate`
// refuses (product not open to this sponsor, window shut, the deed conveys at a
// grade the desk will not lend on, a cheque under $100K) and used to return
// null silently: no loan written, the equity still the only money that left,
// and the building conveyed for the equity alone. The critic's take-private
// made +$3.5M of net worth in one click that way (a sponsor with two seizures
// on the record, whom no institutional desk will lend to, quoted a harbor loan
// anyway); 63 ordinary levered closes in one bot run wrote no loan.
//
// What must be true, on every listing × every desk × two leverage settings,
// for a clean sponsor and for one the institutional desks have shut out:
//   - a quoted principal is exactly the principal the deed carries after close;
//   - no desk quotes a loan and then refuses at the table;
//   - net worth across the close never RISES by more than rounding — a missing
//     loan shows up as a gain the size of the principal (a distress listing,
//     priced under appraisal on purpose, may rise by its discount and no more);
//   - a leverage dial under the $100K minimum cheque quotes all cash;
//   - a debt-financed take-private at a premium never makes net worth.
//
//   pnpm engine && node test/levered-close.mjs
//   (ENGINE=/path/to/old/.engine.mjs node test/levered-close.mjs to aim it at another build)
import { assertFreshBundle } from "./fresh.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
if (!process.env.ENGINE) assertFreshBundle();
const E = await import(process.env.ENGINE ?? join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);

let bad = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "OK  " : "FAIL"}  ${msg}`); if (!ok) bad++; };
const M = (n) => `$${(n / 1e6).toFixed(2)}M`;
console.log("\nLEVERED CLOSE — the quoted loan is the loan the deed carries\n");

let g = E.firstListings(E.newGame(7919, parcels, 2.5e6), parcels, bbls);
for (let i = 0; i < 6; i++) g = E.advanceMonth(g, parcels, bbls, adjacency);
// Give the buyer the purse so no refusal is about money.
g = { ...g, cash: 200e6 };
// Two seizures on the record: the life companies and the agencies stop
// returning calls (sponsorStanding().institutional === false).
const marked = { ...g, sponsor: { events: [
  { m: g.month, kind: "seized", address: "x", amount: 1 },
  { m: g.month, kind: "seized", address: "y", amount: 1 },
] } };
check(!E.sponsorStanding(marked).institutional, "the marked sponsor is shut out of institutional money");

const products = E.PRODUCTS.filter((p) => !p.mezz);
for (const [label, s0] of [["clean sponsor", g], ["shut-out sponsor", marked]]) {
  let closes = 0, levered = 0, mismatched = 0, pumped = 0, refusedAfterQuote = 0, worst = 0;
  const listings = s0.listings.slice(0, 40);
  for (const l of listings) {
    const rec = E.resolveRec(parcels, s0, l.bbl);
    if (!rec) continue;
    for (const p of products) {
      if ((rec.class === "land") !== (p.id === "land")) continue;
      for (const lev of [1, 0.06]) {
        const q = E.buyQuote(s0, parcels, l.bbl, l.ask, p.id, lev);
        const r = E.executePurchase(s0, parcels, l.bbl, l.ask, p.id, false, lev);
        if (r.err) { if (q.principal > 0) refusedAfterQuote++; continue; }
        closes++;
        const written = r.s.holdings[l.bbl]?.loan?.principal ?? 0;
        if (written > 0) levered++;
        if (written !== q.principal) {
          mismatched++;
          if (mismatched <= 4) console.log(`    ${rec.address} ${p.id} lev ${lev}: quoted ${M(q.principal)}, deed carries ${M(written)}`);
        }
        const dNW = E.netWorth(r.s, parcels) - E.netWorth(s0, parcels);
        // A MOTIVATED SELLER IS A REAL BARGAIN. A distress listing is priced
        // under appraisal on purpose (sim.ts: "well under appraisal"), so
        // buying it legitimately marks up by its discount — and by nothing
        // more. A missing loan still shows as a gain the size of the
        // principal on top of that. Every other closing keeps the flat rule.
        const discount = l.distress ? Math.max(0, E.ownedHoldingValue(r.s, parcels, r.s.holdings[l.bbl]) - l.ask) : 0;
        if (dNW > discount + 0.02 * l.ask) { pumped++; worst = Math.max(worst, dNW - discount); }
      }
    }
  }
  console.log(`  ${label}: ${closes} closings across ${listings.length} listings; ${levered} wrote a loan; ${refusedAfterQuote} refused at the table after a quote`);
  check(closes > 40, `${label}: the harness closed deals (${closes}) — a test that closes nothing proves nothing`);
  check(levered > 0, `${label}: some closings were levered (${levered})`);
  check(mismatched === 0, `${label}: every quoted principal is the principal written at close (${mismatched} mismatches)`);
  check(pumped === 0, `${label}: no closing raised net worth by more than 2% of price (${pumped}; worst ${M(worst)})`);
  check(refusedAfterQuote === 0, `${label}: no desk quoted a loan it then refused at the closing (${refusedAfterQuote})`);
}

// A minimum cheque: a leverage dial that lands under $100K is all cash on the
// quote as well as at the table, and the quote says why.
{
  let found = null;
  for (const l of g.listings) {
    const rec = E.resolveRec(parcels, g, l.bbl);
    if (!rec || rec.class === "land") continue;
    for (const p of products.filter((x) => x.id !== "land")) {
      const full = E.buyQuote(g, parcels, l.bbl, l.ask, p.id, 1);
      if (!(full.principal > 200_000)) continue;
      const lev = 60_000 / full.principal;
      found = { q: E.buyQuote(g, parcels, l.bbl, l.ask, p.id, lev), cash: E.buyQuote(g, parcels, l.bbl, l.ask, "cash", 1) };
      break;
    }
    if (found) break;
  }
  check(!!found, "found a desk that lends, to dial under the minimum cheque");
  if (found) {
    check(found.q.principal === 0 && found.q.equity === found.cash.equity,
      `a $60K dial quotes no loan and the all-cash cheque (principal ${M(found.q.principal)}, bind ${found.q.bind})`);
  }
}

// THE TAKE-PRIVATE, both sponsors: each deed of a debt-financed entity deal
// closes through the same machinery, and none of them may make net worth.
for (const [label, s0] of [["clean sponsor", g], ["shut-out sponsor", marked]]) {
  let checked = 0, gained = 0, worst = 0;
  for (const r of E.livingRivals(s0).filter((x) => x.bbls.length > 0).slice(0, 12)) {
    const tq = E.takePrivateQuote(s0, parcels, r.id);
    if (!tq?.available) continue;
    const res = E.offerTakePrivate(s0, parcels, tq.firmId, tq.ask * 1.2, "debt");
    if (res.err || !res.s) continue;
    checked++;
    const dNW = E.netWorth(res.s, parcels) - E.netWorth(s0, parcels);
    if (dNW > 0) { gained++; worst = Math.max(worst, dNW); }
  }
  console.log(`  ${label}: ${checked} take-privates closed on debt at 1.2x the ask`);
  check(checked > 0, `${label}: some take-private closed`);
  check(gained === 0, `${label}: paying a 20% premium for a company never raises net worth (${gained}; worst ${M(worst)})`);
}

console.log(bad ? `\n${bad} FAILED\n` : "\nall passed\n");
process.exit(bad ? 1 : 0);
