// A 1031 THAT BUYS LESS THAN IT SOLD PAYS TAX ON THE SHORTFALL (playtest F5).
//
// Under IRC §1031(b) a replacement worth less than the relinquished property
// leaves the difference as boot: recognised gain = min(realised gain,
// relinquished price − replacement price). Only the rest rolls into the new
// basis, the basis never goes negative, several purchases inside the window
// count together, and what is still unreplaced when the window closes is taxed
// then — through the ledger, so cash and books move together.
//
// It used to be: any purchase of 80% of the sale price completed the exchange
// and deferred all of the gain, and a fully depreciated sale rolled into a
// smaller deed left a negative basis.
//
//   pnpm engine && node test/exchange-boot.mjs
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);

let bad = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "OK  " : "FAIL"}  ${msg}`); if (!ok) bad++; };
const M = (x) => `$${(x / 1e6).toFixed(3)}M`;
const IN = ["noi", "sold", "interest", "borrowed", "lpCalled", "fees"];
const OUT = ["debtSvc", "leasing", "capex", "dev", "taxes", "bought", "ga", "lpDistributed"];
const books = (g) => { let t = 0; for (const e of g.books ?? []) { for (const k of IN) t += e[k] ?? 0; for (const k of OUT) t -= e[k] ?? 0; } return t; };
const taxes = (g) => (g.books ?? []).reduce((a, e) => a + (e.taxes ?? 0), 0);
const deposits = (g) => Object.values(g.holdings).reduce((a, h) => a + (h.tenants ?? []).reduce((b, t) => b + (t.deposit ?? 0), 0), 0);
/** Δcash − (Δbooks + Δloc + Δdeposits): zero when every dollar is on the ledger. */
const leak = (a, b) => ((b.cash + (b.fund?.cash ?? 0)) - (a.cash + (a.fund?.cash ?? 0)))
  - ((books(b) - books(a)) + ((b.loc?.balance ?? 0) - (a.loc?.balance ?? 0)) + (deposits(b) - deposits(a)));

console.log("\n1031 BOOT — a replacement short of the sale price is taxed on the shortfall\n");

let g0 = E.firstListings(E.newGame(12007, parcels), parcels, bbls);
g0 = { ...g0, cash: g0.cash + 30e6 };
const isBldg = (l) => { const r = E.resolveRec(parcels, g0, l.bbl); return r && r.class !== "land" && r.bldgArea > 0 && !l.halfBuilt; };
const bigs = g0.listings.filter((l) => isBldg(l) && l.ask > 1e6 && l.ask < 6e6);
const smalls = g0.listings.filter((l) => isBldg(l) && l.ask > 2e5 && l.ask < 1e6);
check(bigs.length >= 2 && smalls.length >= 1, `listings to buy (${bigs.length} large, ${smalls.length} small)`);
const A = bigs[0], B = bigs[1], S = smalls[0];

/** Buy `li` at its ask against an exchange; returns the state and the deed's basis without an exchange. */
function buyInto(base, li) {
  const plain = E.executePurchase({ ...base, exchange: null }, parcels, li.bbl, li.ask, "cash", false, 1);
  const r = E.executePurchase(base, parcels, li.bbl, li.ask, "cash", false, 1);
  return { r, basis0: plain.s.holdings[li.bbl]?.costBasis ?? NaN };
}
/** Advance until the exchange closes (at most four months). */
function runOut(s) {
  for (let i = 0; i < 4 && s.exchange; i++) s = E.advanceMonth(s, parcels, bbls, adjacency);
  return s;
}
const ex = (P, G, T, extra = {}) => ({ deferredTax: T, rolledGain: G, minPrice: P, deadlineM: g0.month + 1, replaced: 0, rolled: 0, ...extra });

// CASE 1 — the playtest's: replacement at 80% of the relinquished price.
{
  const Q = A.ask, P = Math.round(Q / 0.8), G = Math.round(P * 0.5), T = Math.round(G * 0.2);
  const base = { ...g0, exchange: ex(P, G, T) };
  const { r, basis0 } = buyInto(base, A);
  const h = r.s.holdings[A.bbl];
  const boot = Math.min(G, P - Q), rolled = G - boot;
  check(!r.err, `bought ${M(Q)} against a ${M(P)} sale with ${M(G)} of gain${r.err ? ": " + r.err : ""}`);
  check(!!r.s.exchange && r.s.exchange.replaced === Q && r.s.exchange.rolled === rolled,
    `the exchange stays open: ${M(r.s.exchange?.replaced ?? 0)} replaced, ${M(r.s.exchange?.rolled ?? 0)} of gain rolled (expected ${M(rolled)})`);
  check(h.costBasis === basis0 - rolled, `basis is price + closing less the rolled gain only (${M(h.costBasis)} = ${M(basis0)} − ${M(rolled)})`);
  check(Math.abs(leak(base, r.s)) < 2, "the purchase is on the ledger");
  const t0 = taxes(r.s);
  const done = runOut(r.s);
  const due = Math.round(T * boot / G);
  check(!done.exchange, "the window closes");
  check(Math.abs((taxes(done) - t0) - due) <= 1,
    `the shortfall is boot: ${M(taxes(done) - t0)} of tax booked at the close, ${M(T)} × ${M(boot)}/${M(G)} = ${M(due)}`);
  check(Math.abs(leak(r.s, done)) < 2, "and paid from cash through the ledger (Δcash = Δbooks + Δloc + Δdeposits)");
}

// CASE 2 — a gain as large as the price (fully depreciated): the basis can
// fall to its closing costs, never below.
{
  const Q = S.ask, P = Math.round(Q / 0.8), G = P, T = Math.round(G * 0.2);
  const { r, basis0 } = buyInto({ ...g0, exchange: ex(P, G, T) }, S);
  const h = r.s.holdings[S.bbl];
  check(h.costBasis >= 0 && h.costBasis === basis0 - Q,
    `gain = price: basis ${M(h.costBasis)} — the closing costs, not negative (was −$0.103M on this case)`);
}

// CASE 3 — a replacement at or above the price completes at once, all deferred.
{
  const Q = A.ask, P = Math.round(Q * 0.9), G = Math.round(P * 0.4), T = Math.round(G * 0.2);
  const base = { ...g0, exchange: ex(P, G, T) };
  const { r, basis0 } = buyInto(base, A);
  check(r.s.exchange === null && r.s.holdings[A.bbl].costBasis === basis0 - G && taxes(r.s) === taxes(base),
    `Q ≥ P: completed, ${M(G)} rolled, basis ${M(r.s.holdings[A.bbl].costBasis)}, no tax`);
}

// CASE 4 — so small that the shortfall exceeds the whole gain: nothing rolls,
// and the whole deferred tax falls due at the close.
{
  const Q = S.ask, P = Q * 5, G = Math.round(P * 0.3), T = Math.round(G * 0.2);
  const { r, basis0 } = buyInto({ ...g0, exchange: ex(P, G, T) }, S);
  check(r.s.exchange?.rolled === 0 && r.s.holdings[S.bbl].costBasis === basis0, `Q < P − G: nothing rolls, basis ${M(basis0)}`);
  const t0 = taxes(r.s);
  const done = runOut(r.s);
  check(!done.exchange && Math.abs((taxes(done) - t0) - T) <= 1, `the whole ${M(T)} is due at the close (${M(taxes(done) - t0)})`);
}

// CASE 5 — two purchases inside the window that together reach the price.
{
  const P = A.ask + B.ask, G = Math.round(P * 0.5), T = Math.round(G * 0.2);
  const base = { ...g0, exchange: ex(P, G, T, { deadlineM: g0.month + 6 }) };
  const one = buyInto(base, A);
  check(!!one.r.s.exchange, `first purchase ${M(A.ask)} of ${M(P)}: still open, ${M(one.r.s.exchange?.rolled ?? 0)} rolled`);
  const two = buyInto(one.r.s, B);
  const rolledA = one.basis0 - one.r.s.holdings[A.bbl].costBasis;
  const rolledB = two.basis0 - two.r.s.holdings[B.bbl].costBasis;
  check(two.r.s.exchange === null && rolledA + rolledB === G,
    `second purchase ${M(B.ask)} completes it: ${M(rolledA)} + ${M(rolledB)} = ${M(G)} rolled, nothing due`);
}

// CASE 6 — nothing bought: the whole deferred tax at the close, as before.
{
  const P = 2e6, G = 8e5, T = 1.6e5;
  const s0 = { ...g0, exchange: ex(P, G, T) };
  const done = runOut(s0);
  check(!done.exchange && Math.abs((taxes(done) - taxes(s0)) - T) <= 1, `lapse with nothing bought: ${M(taxes(done) - taxes(s0))} taxes`);
  check(Math.abs(leak(s0, done)) < 2, "on the ledger");
}

// THE HELPER, on a package: the deferral is spread by price and no basis goes negative.
{
  const s = structuredClone(g0);
  s.exchange = ex(1_000_000, 900_000, 180_000);
  const h1 = { costBasis: 306_000 }, h2 = { costBasis: 510_000 };
  E.applyExchangeReplacement(s, [{ h: h1, price: 300_000 }, { h: h2, price: 500_000 }], "test package");
  // 800k of 1M bought: boot 200k, 700k rolls, 3/8 and 5/8.
  check(s.exchange?.rolled === 700_000 && h1.costBasis === 306_000 - 262_500 && h2.costBasis === 510_000 - 437_500,
    `a package of 0.3M + 0.5M against 1M: 0.7M rolled by price share (${h1.costBasis}, ${h2.costBasis})`);
  check(E.exchangeTaxAtRisk(s.exchange) === 40_000, `with 0.2M of gain unreplaced, 40K of tax at risk (${E.exchangeTaxAtRisk(s.exchange)})`);
}

console.log(bad ? `\n${bad} FAILED` : "\nall clear");
process.exit(bad ? 1 : 0);
