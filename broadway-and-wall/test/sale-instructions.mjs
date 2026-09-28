// STANDING SALE INSTRUCTIONS — does the broker act without stopping the clock?
//
//   pnpm engine && node test/sale-instructions.mjs
//
// A playtest measured "Offer in hand" at 52-71% of every Yr/Skip/Play stop,
// 3.4-12.8 stops per completed sale. A seller in life tells the broker what
// they will take. This asks four questions:
//
//   A. A listing told to accept at or above a low number sells on its first
//      offer with no `offer:` attention item ever raised for it, and the exit
//      is recorded with the broker's news line.
//   B. The close is the SAME close as a manual accept: on the state the offer
//      landed in, the instruction path and acceptSaleOffer leave identical
//      cash, books, exits and deed ledgers — and the integrated run's exit is
//      the offer the control run received (same month, same price), because
//      instructions draw no dice.
//   C. A floor above every offer leaves the building unsold, with no offer
//      ever on the desk, and the broker's turn-downs on the tape.
//   D. An accept that would leave the account short is held for the owner.
//
// A test that cannot fail is a fake: remove the applySaleInstructions call
// from tickSales and A and C fail (checked when this was written).
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
const clone = (g) => JSON.parse(JSON.stringify(g));
const offerKeys = (g, bbl) => E.attentionItems(g, parcels)
  .map((a) => a.key).filter((k) => k.startsWith(`offer:${bbl}:`) || k.startsWith(`sale-bids:${bbl}:`));

// One unlevered office bought for cash, then listed quietly a touch under the
// mark so offers come.
function setUp(seed, instructions) {
  let g = E.firstListings(E.newGame(seed, parcels, 6_000_000), parcels, bbls);
  for (let m = 0; m < 6; m++) g = E.advanceMonth(g, parcels, bbls, adjacency);
  const li = g.listings.map((l) => ({ l, rec: E.resolveRec(parcels, g, l.bbl) }))
    .filter((x) => x.rec && x.rec.class === "office" && x.rec.bldgArea > 5000 && x.l.ask < 4_000_000)
    .sort((a, b) => b.l.ask - a.l.ask)[0];
  if (!li) throw new Error("no office on the tape");
  const r = E.executePurchase(g, parcels, li.l.bbl, li.l.ask, "cash", false, 1);
  if (r.err) throw new Error(r.err);
  g = r.s;
  for (let m = 0; m < 3; m++) g = E.advanceMonth(g, parcels, bbls, adjacency);
  const bbl = li.l.bbl;
  const ask = Math.round(E.ownedHoldingValue(g, parcels, g.holdings[bbl]) * 0.92);
  const l = E.listForSale(g, parcels, bbl, ask, "quiet", instructions);
  if (l.err) throw new Error(l.err);
  return { g: l.s, bbl, ask };
}

const SEED = 4242;
const HZ = 60;
console.log("\nSTANDING SALE INSTRUCTIONS — the broker takes the call\n");

// ---- control: no instructions — when does the first offer land, and at what?
const ctl = setUp(SEED);
let gC = ctl.g, offerM = -1, offerPx = 0, atOffer = null;
for (let m = 0; m < HZ && offerM < 0; m++) {
  gC = E.advanceMonth(gC, parcels, bbls, adjacency);
  const o = gC.holdings[ctl.bbl]?.sale?.offer;
  if (o) { offerM = gC.month; offerPx = o.price; atOffer = clone(gC); }
}
check(offerM >= 0, `control: an offer landed (${offerM >= 0 ? `${M(offerPx)} in month ${offerM}, ask ${M(ctl.ask)}` : "none in " + HZ + " months"})`);
check(offerM >= 0 && offerKeys(gC, ctl.bbl).length > 0, "control: without instructions it is an attention item, as before");

// ---- A: accept at or above $1 — every offer clears it
{
  const { g: g0, bbl } = setUp(SEED, { acceptAtOrAbove: 1 });
  let g = g0, raised = 0, soldM = -1;
  for (let m = 0; m < HZ && soldM < 0; m++) {
    g = E.advanceMonth(g, parcels, bbls, adjacency);
    raised += offerKeys(g, bbl).length;
    if (!g.holdings[bbl]) soldM = g.month;
  }
  const ex = (g.exits ?? []).find((x) => x.bbl === bbl);
  check(soldM >= 0 && !!ex, `A: it sold (${ex ? `${M(ex.price)} in month ${soldM}` : "still held"})`);
  check(raised === 0, `A: no offer attention item was ever raised for it (${raised})`);
  check(g.news.some((n) => /accepted .* on your standing instruction/.test(n.text)), "A: the tape says the broker accepted on your standing instruction");
  // ---- B1: the integrated run closed the offer the control run received
  check(!!ex && ex.soldM === offerM && ex.price === offerPx,
    `B: same month and price as the control's offer (${ex ? `${ex.soldM} ${M(ex.price)}` : "-"} vs ${offerM} ${M(offerPx)})`);
}

// ---- B2: on the very state the offer landed in, instruction path == manual accept
if (atOffer) {
  const man = E.acceptSaleOffer(clone(atOffer), parcels, ctl.bbl, false);
  const auto = clone(atOffer);
  auto.holdings[ctl.bbl].sale.instructions = { acceptAtOrAbove: offerPx };
  E.applySaleInstructions(auto, parcels);
  check(!man.err, `B: manual accept succeeds (${man.err ?? "ok"})`);
  check(!auto.holdings[ctl.bbl], "B: the instruction path closed it");
  check(auto.cash === man.s.cash, `B: cash moved by the same amount (auto ${M(auto.cash - atOffer.cash)}, manual ${M(man.s.cash - atOffer.cash)})`);
  const lastBooks = (s) => JSON.stringify(s.books?.[s.books.length - 1]);
  check(lastBooks(auto) === lastBooks(man.s), "B: identical books");
  check(JSON.stringify(auto.exits) === JSON.stringify(man.s.exits), "B: identical exit record");
  check(JSON.stringify(auto.deedCf ?? null) === JSON.stringify(man.s.deedCf ?? null), "B: identical deed ledgers");
  check((auto.loc?.balance ?? 0) === (man.s.loc?.balance ?? 0), "B: the revolver swept the same");
  check(!auto.exchange, "B: never a 1031");
}

// ---- C: decline anything below a number no offer reaches
{
  // Run past the month the control run's first offer landed: when offers
  // arrive is the market's business (it moved from month 11 to month 57 when
  // the land pro forma was reconciled), and a fixed three years made this
  // fixture hostage to it.
  const { g: g0, bbl } = setUp(SEED, { declineBelow: 1e12 });
  let g = g0, raised = 0, declines = 0;
  const horizon = Math.max(36, (offerM >= 0 ? offerM - g0.month : HZ) + 12);
  for (let m = 0; m < horizon; m++) {
    g = E.advanceMonth(g, parcels, bbls, adjacency);
    raised += offerKeys(g, bbl).length;
    declines += g.news.filter((n) => n.q === g.month && /turned down .* on your standing instruction/.test(n.text)).length;
  }
  check(!!g.holdings[bbl]?.sale, `C: still owned and still listed after ${Math.round(horizon / 12)} years`);
  check(!(g.exits ?? []).some((x) => x.bbl === bbl), "C: no exit");
  check(raised === 0, `C: no offer attention item was ever raised for it (${raised})`);
  check(declines > 0, `C: offers did arrive and the broker turned them down (${declines} on the tape)`);
}

// ---- D: an accept that would leave the account short waits for the owner
if (atOffer) {
  // A buyer at a token price: the tenants' deposits leave with the deed and
  // the proceeds do not cover them, so closing costs the seller money.
  const g = clone(atOffer);
  g.cash = 0;
  g.holdings[ctl.bbl].sale.offer.price = 1_000;
  // Build the shortfall rather than hope the roll carries one: a tenant's
  // deposit leaves with the deed, and a token price does not cover it.
  // A mortgage the token price cannot pay off does the same on a vacant one.
  const hD = g.holdings[ctl.bbl];
  if (hD.tenants.length) hD.tenants[0].deposit = Math.max(hD.tenants[0].deposit ?? 0, 50_000);
  else hD.loan = {
    product: "harbor", principal: 100_000, balance: 100_000, ratePct: 6, spread: 2, ioUntilM: g.month + 36,
    amortYears: 30, maturityM: g.month + 60, monthlyPmt: 500, minDSCR: 1.2, maxLTV: 0.8, sweep: false,
    cleanQs: 0, originM: g.month - 12, origValue: 1_000_000, prepay: "open", prepayUntilM: g.month - 1,
  };
  g.holdings[ctl.bbl].sale.instructions = { acceptAtOrAbove: 1 };
  const man = E.acceptSaleOffer(clone(g), parcels, ctl.bbl, false);
  check(!man.err && man.s.cash < 0, `D: precondition — the manual close would leave cash at ${M(man.s.cash)}`);
  E.applySaleInstructions(g, parcels);
  check(!!g.holdings[ctl.bbl]?.sale?.offer?.held, "D: a short close is held for the owner, not signed by the broker");
  check(g.cash === 0 && !(g.exits ?? []).some((x) => x.bbl === ctl.bbl && x.soldM === g.month), "D: no money moved, no exit");
  check(E.attentionItems(g, parcels).some((a) => a.key.startsWith(`offer:${ctl.bbl}:`)), "D: it is on the owner's desk");
}

console.log(bad ? `\n${bad} FAILED` : "\nall clear");
process.exit(bad ? 1 : 0);
