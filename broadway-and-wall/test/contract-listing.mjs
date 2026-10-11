// NOTHING GOES UNDER CONTRACT THAT IS NOT FOR SALE — and nothing under
// contract is sold out from under the buyer without the deposit coming back.
//   pnpm engine && node test/contract-listing.mjs
//   (ENGINE=/abs/path/to/old/.engine.mjs to aim it at another build)
//
// Measured on the critic's bot (checkInvariants every step): "talks: under
// contract on something that is no longer for sale", 9 times in six 30-year
// runs. The mechanism: tickTalks checks the listing early in the month and
// refreshListings lets it LAPSE later in the same month while the seller's
// counter is still on the table; the next morning acceptCounter strikes the
// deal on a building that is no longer on the tape.
//
//   1. a listing under live negotiation does not lapse; accepting the counter
//      after its listing date passes leaves a contract on a live listing;
//   2. accepting a counter on a building that has left the tape is refused;
//   3. a contract whose listing is taken by another route is void and the
//      earnest money comes back, through the books.
import { assertFreshBundle } from "./fresh.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
if (!process.env.ENGINE) assertFreshBundle();
const E = await import(process.env.ENGINE ?? join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels, bbls, adjacency } = loadCity(0, E.normalizeParcels);

let fails = 0;
const ok = (name, cond, detail = "") => {
  if (!cond) { fails++; console.log(`FAIL  ${name}${detail ? " — " + detail : ""}`); }
  else console.log(`PASS  ${name}${detail ? " — " + detail : ""}`);
};
const talkInv = (g) => E.checkInvariants(g, parcels).filter((v) => v.code === "talks");

let g0 = E.firstListings(E.newGame(7919, parcels, 20e6), parcels, bbls);
for (let i = 0; i < 4; i++) g0 = E.advanceMonth(g0, parcels, bbls, adjacency);

// Open a negotiation that ends with a counter on the table: offer well under.
// How far under draws a counter rather than a yes depends on how motivated
// the month's sellers are, so step down until one counters.
let open = null;
for (const f of [0.9, 0.85, 0.8]) {
  for (const l of g0.listings) {
    const rec = E.resolveRec(parcels, g0, l.bbl);
    if (!rec || rec.class === "land") continue;
    const r = E.negotiate(g0, parcels, l.bbl, Math.round(l.ask * f));
    if (r.err || !r.s.talks?.[l.bbl] || r.s.talks[l.bbl].agreed) continue;
    open = { s: r.s, bbl: l.bbl };
    break;
  }
  if (open) break;
}
ok("setup: a negotiation with the seller's counter on the table", !!open);

if (open) {
  // 1. The listing's own date runs out while the counter is on the table.
  const s1 = structuredClone(open.s);
  s1.listings.find((l) => l.bbl === open.bbl).expiresM = s1.month;
  const n1 = E.advanceMonth(s1, parcels, bbls, adjacency);
  const still = !!n1.talks?.[open.bbl];
  const listed = n1.listings.some((l) => l.bbl === open.bbl);
  ok("a listing under live negotiation does not lapse mid-conversation", !still || listed,
    `talk open ${still}, listed ${listed}`);
  if (still) {
    const a = E.acceptCounter(n1, parcels, open.bbl);
    const inv = a.err ? [] : talkInv(a.s);
    ok("accepting the counter never leaves a contract on something not for sale", inv.length === 0,
      a.err ?? inv.map((v) => v.detail).join("; "));
  }

  // 2. Take the listing away outright, then accept.
  const s2 = structuredClone(open.s);
  s2.listings = s2.listings.filter((l) => l.bbl !== open.bbl);
  const a2 = E.acceptCounter(s2, parcels, open.bbl);
  ok("accepting a counter on a building off the tape is refused", !!a2.err && !a2.s.talks?.[open.bbl]?.agreed,
    a2.err ?? "struck");

  // 3. Under contract, then another route takes the listing: void, refund.
  const a3 = E.acceptCounter(structuredClone(open.s), parcels, open.bbl);
  ok("setup: under contract", !a3.err && a3.s.talks?.[open.bbl]?.agreed, a3.err);
  if (!a3.err) {
    const s3 = a3.s;
    const dep = s3.talks[open.bbl].deposit;
    s3.listings = s3.listings.filter((l) => l.bbl !== open.bbl);   // e.g. a receiver's auction
    const cash0 = s3.cash;
    const bought0 = s3.books.at(-1).bought;
    E.reconcileContracts?.(s3, parcels);
    ok("the contract is void when the seller can no longer deliver", !s3.talks?.[open.bbl],
      JSON.stringify(s3.talks?.[open.bbl] ?? null).slice(0, 80));
    ok("the earnest money comes back, booked off `bought`",
      s3.cash - cash0 === dep && bought0 - s3.books.at(-1).bought === dep,
      `deposit ${dep}, cash +${s3.cash - cash0}, bought −${bought0 - s3.books.at(-1).bought}`);
    ok("no talks invariant after the reconcile", talkInv(s3).length === 0);
  }
}

console.log(fails ? `\n${fails} FAILED\n` : "\nall passed\n");
process.exit(fails ? 1 : 0);
