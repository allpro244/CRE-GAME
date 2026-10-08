// TAKING A RIVAL PRIVATE — buying a competitor whole (engine/takeprivate.ts).
//
// What must be true of an entity deal, each checked on a live city:
//
//   PRICE     the board's ask is (deeds as they convey − debt) × premium + cash,
//             and the deeds are marked with the same `conveyedValue` the tape's
//             asks use — one number for one quantity.
//   COSTS     the closing charges 2% of the real estate and transfer tax on the
//             deeds' value, and nothing else.
//   TRANSFER  every deed becomes a holding with the roll the quote read, the
//             firm's paper is gone, the firm is off the street.
//   LEDGER    Dcash == books + Dloc + Ddeposits across the close and for a year
//             after it; every acquired deed has its own equity ledger.
//   REFUSALS  a lowball is refused and cools the board; an insult is
//             remembered; an unaffordable offer changes nothing; firms that do
//             not sell (owner-users, a family not in trouble, a book under
//             water, a crane on site) say why.
//   RNG       quoting draws nothing from the world's stream.
//   APPROACH  a board in trouble rings a buyer who could close — as an inbox
//             item routed to the Street desk — and never one who could not.
//
//   pnpm engine && node test/take-private.mjs
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
const M = (n) => `$${(n / 1e6).toFixed(2)}M`;
console.log("\nTAKE PRIVATE — a rival bought whole\n");

const IN = ["noi", "sold", "interest", "borrowed", "lpCalled"];
const OUT = ["debtSvc", "leasing", "capex", "dev", "taxes", "bought", "ga", "lpDistributed"];
const bookTotals = (g) => {
  const t = {};
  for (const k of [...IN, ...OUT]) t[k] = 0;
  for (const y of g.books ?? []) for (const k of [...IN, ...OUT]) t[k] += y[k] ?? 0;
  return t;
};
const depositsHeld = (g) => {
  let d = 0;
  for (const h of Object.values(g.holdings ?? {})) for (const t of h.tenants ?? []) d += t.deposit ?? 0;
  return d;
};
const snap = (g) => ({ cash: g.cash + (g.fund?.cash ?? 0), books: bookTotals(g), loc: g.loc?.balance ?? 0, dep: depositsHeld(g) });
/** Unexplained dollars between two snapshots — conserve's identity. */
const residual = (a, b) => {
  let flow = 0;
  for (const k of IN) flow += b.books[k] - a.books[k];
  for (const k of OUT) flow -= b.books[k] - a.books[k];
  return (b.cash - a.cash) - flow - (b.loc - a.loc) - (b.dep - a.dep);
};

// A lived-in city: rivals with books, leverage and cash of their own.
let base = E.firstListings(E.newGame(12007, parcels, 2_500_000), parcels, bbls);
for (let m = 0; m < 36; m++) {
  base = E.advanceMonth(base, parcels, bbls, adjacency);
  if (base.gameOver) base = { ...base, gameOver: null, cash: 2.5e6 };
}
const noJob = (g, r) => !(g.cityJobs ?? []).some((j) => j.firmId === r.id && !j.orphaned);
const candidates = (g) => E.livingRivals(g)
  .filter((r) => r.bbls.length >= 2 && noJob(g, r))
  .map((r) => E.takePrivateQuote(g, parcels, r.id))
  .filter((q) => q?.available)
  .sort((a, b) => a.gross - b.gross);

// 1. THE PRICE, and that asking costs the world nothing.
const pool = candidates(base);
check(pool.length >= 2, `${pool.length} firms on the street can be quoted`);
const q = pool[0];
{
  const streams = JSON.stringify([base.rng, base.streams]);
  const r = base.rivals.find((x) => x.id === q.firmId);
  let gross = 0;
  for (const b of r.bbls) {
    const rec = E.resolveRec(parcels, base, b);
    gross += Math.round(E.conveyedValue(base, rec, b, false, E.assetGrade(r, rec)));
  }
  check(gross === q.gross, `deeds marked as they convey: ${M(q.gross)} (conveyedValue sums to ${M(gross)})`);
  check(q.debt === Math.round(r.debt) && q.cash === Math.round(r.cash), `debt ${M(q.debt)} and cash ${M(q.cash)} read off the firm`);
  const want = Math.round(((q.gross - q.debt) * q.premium + q.cash) / 1000) * 1000;
  check(q.ask === want, `ask ${M(q.ask)} = (gross − debt) × ${q.premium.toFixed(3)} + cash (${M(want)}) — ${q.situation}`);
  check(q.premium >= 0.85 && q.premium <= 1.30, `premium ${q.premium.toFixed(3)} inside the calibrated band`);
  E.takePrivateTerms(base, parcels, q, q.ask, "debt");
  check(JSON.stringify([base.rng, base.streams]) === streams, "quoting and pricing drew nothing from the world's random streams");
}

// 2. THE CLOSE, all cash.
let owned = null;   // the player after the close — a buyer with a record, for section 5
{
  let g = structuredClone(base);
  g.cash = Math.max(g.cash, q.ask * 3 + q.gross);  // a firm that can afford it
  const firm = g.rivals.find((x) => x.id === q.firmId);
  const deeds = [...firm.bbls];
  const t = E.takePrivateTerms(g, parcels, q, q.ask, "cash");
  // the vessel each deed will convey, read before the close
  const rolls = {};
  for (const b of deeds) {
    const rec = E.resolveRec(parcels, g, b);
    rolls[b] = E.conveyedDeed(g, rec, b, false, E.assetGrade(firm, rec)).vessel.tenants.map((x) => `${x.name}|${x.sf}|${x.rentPsf}|${x.endM}`).join(";");
  }
  check(t.realEstatePrice === q.ask - q.cash + q.debt, `real estate at ${M(t.realEstatePrice)} = equity price − cash + debt retired`);
  check(t.legs.reduce((a, l) => a + l.price, 0) === t.realEstatePrice, "the allocation sums to the real estate price to the dollar");
  const ttWant = q.deeds.reduce((a, d) => a + Math.round(d.value * E.TRANSFER_TAX), 0);
  check(t.transferTax === ttWant, `transfer tax ${M(t.transferTax)} at ${(E.TRANSFER_TAX * 100).toFixed(1)}% of the deeds' value`);
  const a = snap(g);
  const res = E.offerTakePrivate(g, parcels, q.firmId, q.ask, "cash");
  check(!res.err && !res.refused, `offer at the ask closes (${res.err ?? res.msg})`);
  const n = res.s;
  owned = n;
  const b = snap(n);
  const resid = residual(a, b);
  check(Math.abs(resid) < 1000, `ledger reconciles across the close (residual $${Math.round(resid)})`);
  const out = (a.cash + a.loc) - (b.cash + 0) ;
  const paid = -(b.cash - a.cash) + (b.loc - a.loc) + (b.dep - a.dep);
  const cost = t.realEstatePrice + t.closingCosts + t.transferTax;
  check(Math.abs(paid - cost) <= deeds.length * 2 + 2,
    `cash out net of deposits ${M(paid)} = real estate + 2% + stamps (${M(cost)})`);
  void out;
  const r1 = n.rivals.find((x) => x.id === q.firmId);
  check(deeds.every((d) => n.holdings[d]), `all ${deeds.length} deeds are holdings`);
  check(r1.bbls.length === 0 && r1.debt === 0 && r1.cash === 0, "the firm's sheet is empty");
  check(r1.failedM === n.month && r1.takenPrivateM === n.month, "the firm is off the street, marked as taken private");
  check(!E.livingRivals(n).some((x) => x.id === q.firmId), "and no longer among the living firms");
  check(deeds.every((d) => !(n.rivals ?? []).some((x) => x.bbls.includes(d))), "no firm still claims any of the deeds");
  const sameRoll = deeds.filter((d) => rolls[d] === n.holdings[d].tenants.map((x) => `${x.name}|${x.sf}|${x.rentPsf}|${x.endM}`).join(";")).length;
  check(sameRoll === deeds.length, `every roll conveyed as quoted (${sameRoll}/${deeds.length})`);
  const basis = deeds.reduce((s, d) => s + n.holdings[d].costBasis, 0);
  check(Math.abs(basis - cost) <= deeds.length * 2, `basis ${M(basis)} carries price, closing and stamps`);
  check(deeds.every((d) => n.deedCf?.[d] && !n.deedCf[d].pooled && n.deedCf[d].from === n.month), "each deed opened its own equity ledger at the close");
  check(n.news.some((x) => x.text.startsWith(`${q.name} is yours`)), "one news line for the firm");
  // The lines this close added, and only those: the world's own tape that
  // month (a bank taking a different firm's book, say) is not this deal.
  const added = n.news.slice(0, Math.max(0, n.news.length - g.news.length));
  check(added.some((x) => x.text.startsWith(`${q.name} is yours`)) && !added.some((x) => / has taken .* at \$/.test(x.text)),
    `and no per-building tape prints (${added.length} lines added by the close)`);
  check((n.takePrivate?.done ?? []).length === 1 && n.takePrivate.done[0].deeds === deeds.length, "the closing statement is kept");
  check(E.attentionItems(n, parcels).every((x) => !x.key.startsWith("take-private")), "nothing left in the inbox");

  // ...and the world goes on with the book in it: a year, reconciled monthly.
  let g2 = n, worst = 0;
  for (let m = 0; m < 12; m++) {
    const s0 = snap(g2);
    g2 = E.advanceMonth(g2, parcels, bbls, adjacency);
    worst = Math.max(worst, Math.abs(residual(s0, snap(g2))));
  }
  check(worst < 1000, `a year after the close reconciles every month (worst $${Math.round(worst)})`);
  check(deeds.every((d) => g2.holdings[d]), "and the deeds are still yours");
}

// 3. THE CLOSE ON DEBT — each deed financed at its own desk.
{
  const q2 = pool[1];
  let g = structuredClone(base);
  g.cash = Math.max(g.cash, q2.ask + q2.gross * 0.6);
  const t = E.takePrivateTerms(g, parcels, q2, q2.ask, "debt");
  const a = snap(g);
  const res = E.offerTakePrivate(g, parcels, q2.firmId, q2.ask, "debt");
  check(!res.err && !res.refused, `a financed close (${res.err ?? res.msg})`);
  if (!res.err) {
    const n = res.s;
    const loans = t.legs.reduce((s, l) => s + (n.holdings[l.bbl]?.loan?.principal ?? 0), 0);
    check(t.loans > 0 && Math.abs(loans - t.loans) <= t.legs.length, `new mortgages ${M(loans)} as quoted (${M(t.loans)})`);
    check(t.need < t.realEstatePrice, `equity cheque ${M(t.need)} under the real estate price ${M(t.realEstatePrice)}`);
    const resid = residual(a, snap(n));
    check(Math.abs(resid) < 1000, `ledger reconciles across a financed close (residual $${Math.round(resid)})`);
  }
}

// 4. REFUSALS.
{
  // a lowball: refused, cooled, remembered
  let g = structuredClone(base);
  g.cash = Math.max(g.cash, q.ask * 3 + q.gross);
  const low = Math.round(q.ask * 0.6);
  const before = g.street?.[q.firmId]?.insults ?? 0;
  const r = E.offerTakePrivate(g, parcels, q.firmId, low, "cash");
  check(!r.err && r.refused, `${M(low)} against a ${M(q.ask)} ask is refused`);
  check(r.s.rivals.find((x) => x.id === q.firmId).failedM === undefined && Object.keys(r.s.holdings).length === Object.keys(g.holdings).length, "nothing changed hands");
  check((r.s.street?.[q.firmId]?.insults ?? 0) === before + 1, "and the insult is on the file");
  const again = E.takePrivateQuote(r.s, parcels, q.firmId);
  check(!again.available && /turned you down/.test(again.why), `the board will not take the call again (${again.why})`);

  // just under the ask: inside the floor for some boards, never below 80% of premium
  const near = E.offerTakePrivate(g, parcels, q.firmId, q.ask - 1000, "cash");
  check(!near.err, `an offer a hair under the ask is answered (${near.refused ? "refused" : "taken"})`);

  // unaffordable: a clear reason, state untouched
  const poor = structuredClone(base);
  poor.cash = 10_000;
  const u = E.offerTakePrivate(poor, parcels, q.firmId, q.ask, "cash");
  check(!!u.err && /short/.test(u.err) && u.s === poor, `unaffordable says why and changes nothing (${u.err})`);

  // firms that do not sell
  const h = structuredClone(base);
  const [f1, f2, f3] = E.livingRivals(h).filter((x) => x.bbls.length >= 2 && noJob(h, x) && x.style !== "family" && x.style !== "owneruser").slice(0, 4);
  f1.style = "owneruser";
  f2.style = "family"; f2.stressMs = 0; f2.debt = 0; f2.occ = undefined;
  f3.debt = 1e12;
  const tests = [[f1, "owns its own premises"], [f2, "not for sale"], [f3, "no longer cover"]];
  for (const [f, word] of tests) {
    const x = E.takePrivateQuote(h, parcels, f.id);
    check(!x.available && x.why.includes(word), `${f.style} firm ${f.name}: ${x.why?.slice(0, 70)}…`);
  }
  // The crane must be the ONLY reason: a firm whose quote is already open, so
  // an underwater book on this world's path cannot answer first.
  const f4 = E.livingRivals(h).find((x) => ![f1, f2, f3].includes(x) && x.bbls.length >= 2 && noJob(h, x)
    && E.takePrivateQuote(h, parcels, x.id).available);
  if (f4) {
    (h.cityJobs ??= []).push({ bbl: f4.bbls[0], firmId: f4.id, startM: h.month, deliverM: h.month + 20, sf: 1, use: "office", floors: 1 });
    const x = E.takePrivateQuote(h, parcels, f4.id);
    check(!x.available && x.why.includes("under construction"), "a crane on site stops a change of control");
  }
  // A FAMILY SELLS ONLY IN TROUBLE. There is no succession any more (nobody
  // ages or dies — ECONOMY.md "No age, no mortality"): a family near its
  // limits still will not sell, and a family in arrears will, under NAV.
  {
    const st = structuredClone(h);
    const fs = E.livingRivals(st).find((x) => x.id === f2.id);
    fs.occ = 0.10; fs.mktOcc = 0.95;       // losing the leasing war: strained, not distressed
    const xs = E.takePrivateQuote(st, parcels, f2.id);
    check(xs.situation === "strained" && !xs.available && xs.why.includes("not for sale"), `a strained family still does not sell (${xs.situation})`);
    const sd = structuredClone(h);
    E.livingRivals(sd).find((x) => x.id === f2.id).stressMs = 2;
    const xd = E.takePrivateQuote(sd, parcels, f2.id);
    check(xd.available && xd.situation === "distressed" && xd.premium <= 0.95, `a family in arrears sells at ${xd.premium.toFixed(3)}× property equity`);
  }
}

// 5. THE BOARD RINGS YOU — and only if you could close.
{
  const g = structuredClone(owned);      // a buyer with seven buildings of its own
  const firm = E.livingRivals(g).find((x) => x.id === pool[1].firmId);
  firm.stressMs = 2;                       // in arrears: a reason to sell
  let offered = null, rich = null;
  for (let y = 0; y < 12 && !offered; y++) {
    const t = structuredClone(g);
    t.month = Math.floor(g.month / 12) * 12 + 6 + 12 * y;
    t.cash = 1e10;
    E.tickTakePrivateApproach(t, parcels);
    if (t.takePrivate?.offer) { offered = t.takePrivate.offer; rich = t; }
  }
  check(!!offered, `a board with a reason to sell rang a buyer who could close (${offered?.name ?? "never"})`);
  if (rich) {
    const item = E.attentionItems(rich, parcels).find((x) => x.key.startsWith("take-private:"));
    check(!!item && item.lastM === offered.expiresM, `it is an inbox item: "${item?.label}"`);
    { const rt = E.routeAttention(item.key, rich); check(rt.page === "research" && rt.rtab === "street", "routed to the Street desk"); }
    const later = structuredClone(rich);
    later.month = offered.expiresM + 1;
    E.tickTakePrivateApproach(later, parcels);
    check(!later.takePrivate.offer, "and it lapses when the four months are up");
  }
  let pauper = 0;
  for (let y = 0; y < 12; y++) {
    const t = structuredClone(g);
    t.month = Math.floor(g.month / 12) * 12 + 6 + 12 * y;
    t.cash = 0; t.loc = { balance: 1e12, drawnTotal: 0, interestPaid: 0 };   // no cash, no line
    E.tickTakePrivateApproach(t, parcels);
    if (t.takePrivate?.offer) pauper++;
  }
  check(pauper === 0, "no banker calls a buyer who cannot close");
  let stranger = 0;
  for (let y = 0; y < 12; y++) {
    const t = structuredClone(g);
    t.month = Math.floor(g.month / 12) * 12 + 6 + 12 * y;
    t.cash = 1e10; t.holdings = {};
    E.tickTakePrivateApproach(t, parcels);
    if (t.takePrivate?.offer) stranger++;
  }
  check(stranger === 0, "nor a rich name that has never owned a building");
}

console.log(bad ? `\n${bad} FAILED\n` : "\nall good\n");
process.exit(bad ? 1 : 0);
