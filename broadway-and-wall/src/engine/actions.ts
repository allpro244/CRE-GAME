// Player actions: buy listed or off-market (cash / fixed / floating IO),
// approach owners with assemblage pressure, sell, renovate. Pure — each
// returns a new state or an error string, never mutates the input.
import type { Adjacency, ParcelRecord, ParcelTable } from "@/data/types";
import type { GameState, Holding } from "./types";
import { logBooks, monthLabel } from "./types";
import { rng, rrange } from "./market";
import { assetValue, initialCondition, holdingValue, renovationCost, RENO_MONTHS, resolveRec, noiAfterTaxYr } from "./value";
import { marketAppetite, ownerOf, rivalAsk, rivalBuys } from "./rivals";
import { genRentRoll, isCommercial } from "./leasing";
import { originate, quote, productById, prepayPenalty } from "./debt";
import { takeoverDevelopment } from "./dev";
import { settleJV } from "./equity";
import { recordComp } from "./comps";

const CLOSING_PCT = 0.02;
const SALE_FRICTION = 0.012;  // legal, title, diligence — the unavoidable rest
export const CAP_GAINS_RATE = 0.2;    // long-term rate on true appreciation
export const RECAPTURE_RATE = 0.25;   // §1250: depreciation comes back at 25%
export const SALE_BROKERAGE = 0.015;  // the sell-side fee
export const TRANSFER_TAX = 0.006;    // deed stamps, paid at the closing table
export const EXCHANGE_WINDOW_M = 6;  // 1031: redeploy within six months or the tax comes due

export type BuyProduct = string;   // "cash", or any id from debt.PRODUCTS

function clone(s: GameState): GameState {
  return JSON.parse(JSON.stringify(s));
}

export function buyQuote(s: GameState, parcels: ParcelTable, bbl: string, price: number, product: BuyProduct, lev = 1) {
  const rec = parcels[bbl];
  const closing = Math.round(price * CLOSING_PCT);
  if (product === "cash" || !rec) return { principal: 0, ratePct: 0, equity: price + closing, capPremium: 0 };
  const prod = productById(product);
  // the life company will not finance a tired building, and the quote screen
  // has to say so before the closing table does
  if (prod.minCondition === "good" && initialCondition(rec) !== "good") {
    return { principal: 0, ratePct: 0, equity: price + closing, capPremium: 0 };
  }
  const q = quote(s, prod, price, noiAfterTaxYr(rec, s.econ, initialCondition(rec), price));
  const principal = Math.round(q.principal * Math.max(0, Math.min(1, lev)));
  // Floating paper closes with a rate cap the lender insists on, and the
  // premium is part of the equity cheque — the cheaper coupon is not free.
  const prod2 = productById(product);
  const capPremium = prod2.floating ? Math.round(principal * 0.0125) : 0;
  return { principal, ratePct: q.ratePct, equity: price - principal + closing + capPremium, capPremium };
}

export function executePurchase(
  s: GameState, parcels: ParcelTable, bbl: string, price: number, product: BuyProduct, offMarket: boolean, lev = 1,
): { s: GameState; err?: string } {
  const rec = parcels[bbl];
  if (!rec) return { s, err: "Unknown parcel." };
  if (s.holdings[bbl]) return { s, err: "You already own it." };
  const bq = buyQuote(s, parcels, bbl, price, product, lev);
  if (s.cash < bq.equity) {
    return { s, err: `This deal needs $${(bq.equity / 1e6).toFixed(2)}M ${product === "cash" ? "all-cash" : "of equity"} — you're short.` };
  }
  const next = clone(s);
  next.cash -= bq.equity;
  logBooks(next, "bought", bq.equity);
  // If a named firm owned it, they are the seller — the money and the deed
  // both move, and their balance sheet is one building lighter.
  {
    const seller = ownerOf(next, bbl);
    if (seller) {
      seller.bbls = seller.bbls.filter((b) => b !== bbl);
      const relief = Math.min(seller.debt, Math.round(price * seller.targetLtv));
      seller.debt -= relief;
      seller.cash += price - relief;
    }
  }
  const holding: Holding = {
    bbl,
    boughtM: next.month,
    costBasis: price + Math.round(price * CLOSING_PCT),
    assessed: price, // the sale reassesses the property at the deal price
    loan: null,
    condition: initialCondition(rec),
    tenants: [],
    cfHistory: [],
  };
  // Whatever diligence did not find, you now own. It does not appear on the
  // closing statement; it appears eighteen months later as a roof.
  if (product !== "cash") {
    const prod = productById(product);
    holding.loan = originate(next, prod, price, noiAfterTaxYr(rec, next.econ, holding.condition, price), lev, holding.condition);
  }
  // a live 1031: this purchase completes the exchange if it's big enough
  if (next.exchange && price >= next.exchange.minPrice * 0.8) {
    holding.costBasis -= next.exchange.rolledGain; // deferred gain carries into the new basis
    next.news.unshift({
      q: next.month, kind: "deal",
      text: `1031 completed: $${(next.exchange.rolledGain / 1e6).toFixed(2)}M of gain rolled into ${rec.address} — $${(next.exchange.deferredTax / 1e6).toFixed(2)}M of tax deferred.`,
    });
    next.exchange = null;
  }
  genRentRoll(next, rec, holding); // walk into the in-place rent roll
  next.holdings[bbl] = holding;
  // A RECEIVER'S SITE MAY HAVE A BUILDING HALF ON IT. If it does, what you
  // just bought is a job, not a lot, and you take it on at the closing.
  const halfBuilt = next.listings.find((l) => l.bbl === bbl)?.halfBuilt;
  next.listings = next.listings.filter((l) => l.bbl !== bbl);
  delete next.approaches[bbl];
  next.news.unshift({
    q: next.month, kind: "deal",
    text: `Deed recorded: ${rec.address} for $${(price / 1e6).toFixed(2)}M${holding.loan ? ` ($${(holding.loan.principal / 1e6).toFixed(1)}M ${holding.loan.product} at ${holding.loan.ratePct}%)` : ", all cash"}${offMarket ? " — off-market" : ""}.`,
  });
  if (halfBuilt) takeoverDevelopment(next, parcels, bbl, halfBuilt);
  recordComp(next, rec, price, "You", ownerOf(s, bbl)?.name ?? (offMarket ? "a private owner" : "a listed seller"),
    s.listings.find((l) => l.bbl === bbl)?.distress, holding.condition);
  return { s: next };
}

// Nobody pays the ask without asking. `bid` is what you're offering against
// the asking price; the seller weighs it against how motivated they are and
// how hot the market is. Push too far and the deal dies rather than merely
// being refused — a listing you blew up goes to somebody else.
export function bidOdds(s: GameState, listing: { ask: number; distress?: boolean }, bid: number): number {
  const disc = 1 - bid / Math.max(1, listing.ask);        // 0 at full ask
  const phase = s.econ.phase === "recession" ? 0.16 : s.econ.phase === "expansion" ? -0.12 : 0;
  const motivated = listing.distress ? 0.18 : 0;
  // A seller refuses a lowball because somebody else will pay more. How much
  // that is true depends on who else has money today — which is the whole
  // reason to know what the other firms on the street are doing.
  const room = (marketAppetite(s) - 1) * 0.22;
  return Math.max(0.02, Math.min(0.98, 1.02 - disc * 6.2 + phase + motivated - room));
}

export function buyListing(
  s: GameState, parcels: ParcelTable, bbl: string, product: BuyProduct, lev = 1, bid?: number,
): { s: GameState; err?: string; msg?: string } {
  const listing = s.listings.find((l) => l.bbl === bbl);
  if (!listing) return { s, err: "That property is no longer on the market." };
  const price = Math.round(bid ?? listing.ask);
  // THE AS-IS PATH. This is a real offer — full price, no contingencies, close
  if (price >= listing.ask) {
    const st = clone(s);
    return executePurchase(st, parcels, bbl, listing.ask, product, false, lev);
  }

  // check the money is there before spending a negotiation on it
  const q = buyQuote(s, parcels, bbl, price, product, lev);
  if (s.cash < q.equity) return { s, err: `That bid still needs $${(q.equity / 1e6).toFixed(2)}M of equity — you're short.` };

  const next = clone(s);
  const p = bidOdds(next, listing, price);
  const roll = rng(next);
  if (roll < p) {
    const done = executePurchase(next, parcels, bbl, price, product, false, lev);
    if (done.err) return { s, err: done.err };
    return { s: done.s, msg: `They took $${(price / 1e6).toFixed(2)}M.` };
  }
  if (roll < p + 0.45) {
    next.news.unshift({ q: next.month, kind: "info", text: `Your $${(price / 1e6).toFixed(2)}M on ${parcels[bbl]?.address} was refused — the ask stands.` });
    return { s: next, msg: "Refused. The ask stands." };
  }
  // insulted: the listing goes away
  next.listings = next.listings.filter((l) => l.bbl !== bbl);
  next.news.unshift({ q: next.month, kind: "warn", text: `The seller at ${parcels[bbl]?.address} took the listing elsewhere after your offer.` });
  return { s: next, msg: "They walked, and pulled the listing." };
}

// ---- off-market: approach the owner ---------------------------------------
// Not everything is for sale. Refusal odds and premiums rise with assemblage
// pressure: the more neighbors you own, the harder the holdout squeezes.
export function assemblagePressure(s: GameState, adjacency: Adjacency, bbl: string): number {
  const nbrs = adjacency[bbl] ?? [];
  if (!nbrs.length) return 0;
  return nbrs.filter((n) => s.holdings[n]).length / nbrs.length;
}

/**
 * MERGE THE LOTS YOU HAVE BEEN BUYING.
 *
 * Assemblage pressure has been in this file since the beginning: the more of a
 * block you own, the harder the last holdout squeezes, and every approach you
 * make gets dearer. That was a tax with no payoff — you could pay the premium
 * and still only ever build on one lot at a time.
 *
 * This is the payoff, and it is the whole reason anyone assembles: three lots
 * that carry six floors each carry one building of eighteen, on a plate three
 * times the size, with one core and one lobby instead of three. The envelope
 * is the sum of the deeds; the address is the biggest of them.
 *
 * Cost is real but small — survey, title, the lawyers who write it — because
 * the expensive part already happened at the closing table.
 */
export function mergeCost(s: GameState, lots: number): number {
  return Math.round((45_000 + 30_000 * lots) * s.econ.costIdx);
}

export function assembleLots(
  s: GameState, parcels: ParcelTable, adjacency: Adjacency, bbls: string[],
): { s: GameState; err?: string; msg?: string } {
  const list = [...new Set(bbls)];
  if (list.length < 2) return { s, err: "Assemblage takes at least two lots." };
  for (const b of list) {
    if (!s.holdings[b]) return { s, err: "You have to own every lot in the assemblage." };
    if (s.merged?.[b]) return { s, err: "One of those is already part of an assemblage." };
    const rec = resolveRec(parcels, s, b);
    if (!rec) return { s, err: "Unknown parcel." };
    if (rec.class !== "land" || rec.bldgArea > 0) return { s, err: "Clear the site first — you cannot merge a lot with a building on it." };
    if (s.developments[b]) return { s, err: "Construction is already underway on one of those." };
    if (s.holdings[b].sale) return { s, err: "One of those is on the market — pull the listing first." };
    if (s.jvs?.[b]) return { s, err: "A partner is in one of those deals. Buy them out before you fold it into anything." };
    if (s.groundLeases?.[b]) return { s, err: "One of those is under a ground lease. It is not yours to build on." };
  }
  // CONTIGUOUS, or it is not a site — it is two sites. Walk the adjacency
  // graph from the first lot and every lot has to be reachable through the
  // set, which is exactly what "one site" means to a surveyor.
  const set = new Set(list);
  const seen = new Set([list[0]]);
  const queue = [list[0]];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const n of adjacency[cur] ?? []) {
      if (set.has(n) && !seen.has(n)) { seen.add(n); queue.push(n); }
    }
  }
  if (seen.size !== list.length) return { s, err: "Those lots do not touch. An assemblage has to be one contiguous site." };

  const cost = mergeCost(s, list.length);
  if (s.cash < cost) return { s, err: `The survey, the title work and the lawyers run $${(cost / 1e3).toFixed(0)}k — you're short.` };

  // the parent is the biggest lot; it keeps the address
  const sorted = [...list].sort((a, b) => (parcels[b]?.lotArea ?? 0) - (parcels[a]?.lotArea ?? 0));
  const parent = sorted[0];
  const next = clone(s);
  next.cash -= cost;
  logBooks(next, "dev", cost);
  if (!next.merged) next.merged = {};
  let area = parcels[parent]?.lotArea ?? 0;
  for (const b of sorted.slice(1)) {
    next.merged[b] = parent;
    area += parcels[b]?.lotArea ?? 0;
    // the child's basis folds into the site it is now part of
    next.holdings[parent].costBasis += next.holdings[b].costBasis;
    next.holdings[b].costBasis = 0;
  }
  const rec = resolveRec(parcels, next, parent)!;
  next.news.unshift({
    q: next.month, kind: "deal",
    text: `Assembled: ${list.length} lots at ${rec.address} are now one site of ${Math.round(area).toLocaleString()} sf, `
      + `${(rec.lotArea * Math.max(rec.farMaxComm, rec.farMaxRes) / 1000).toFixed(0)}k sf buildable. `
      + `That is what all those premiums were for.`,
  });
  return { s: next, msg: `${list.length} lots merged into one site.` };
}

/**
 * GRANT A GROUND LEASE ON A LOT YOU ARE NOT GOING TO BUILD ON.
 *
 * Land in this game cost 1.2% a year to hold and did nothing else, which makes
 * a land bank a parking meter rather than a position. A ground lease is the
 * real answer: somebody else puts a building on your dirt, you take a coupon
 * with fixed reviews and no operating risk whatsoever, and you do not get the
 * site back for a very long time. The trade is income now against every cycle
 * you will sit through unable to build on it.
 */
export function groundLeaseQuote(s: GameState, parcels: ParcelTable, bbl: string, years: number) {
  const rec = resolveRec(parcels, s, bbl);
  if (!rec || rec.class !== "land" || !rec.lotArea) return null;
  const land = assetValue(rec, s.econ, "standard");
  // A ground lessee prices against the risk-free plus a spread, and pays less
  // for a longer term because a longer term is worth more to them.
  const capPct = Math.max(3.4, s.econ.indexRate * 0.62 + 2.5) * (years >= 75 ? 0.9 : years >= 50 ? 0.96 : 1.04);
  const rentYr = Math.round(land * (capPct / 100));
  return {
    land, rentYr, capPct: +capPct.toFixed(2), years,
    stepPct: +(years >= 75 ? 12 : 10).toFixed(0),
    stepEveryM: 120,
  };
}

export function grantGroundLease(
  s: GameState, parcels: ParcelTable, bbl: string, years: number,
): { s: GameState; err?: string; msg?: string } {
  if (!s.holdings[bbl]) return { s, err: "You don't own that." };
  if (s.groundLeases?.[bbl]) return { s, err: "It is already ground-leased." };
  if (s.holdings[bbl].sale) return { s, err: "It's on the market — pull the listing before you encumber it." };
  if (s.developments[bbl]) return { s, err: "Construction is already underway." };
  if (s.merged?.[bbl]) return { s, err: "That lot is part of an assemblage — lease the whole site or none of it." };
  const q = groundLeaseQuote(s, parcels, bbl, years);
  if (!q || q.rentYr <= 0) return { s, err: "Nobody will ground-lease that." };
  const next = clone(s);
  if (!next.groundLeases) next.groundLeases = {};
  next.holdings[bbl].groundLeased = true;
  next.groundLeases[bbl] = {
    bbl, startM: next.month, endM: next.month + years * 12,
    rentYr: q.rentYr, stepPct: q.stepPct, stepEveryM: q.stepEveryM, lastStepM: next.month,
    tenant: groundTenant(next),
  };
  const rec = resolveRec(parcels, next, bbl)!;
  next.news.unshift({
    q: next.month, kind: "deal",
    text: `Ground lease signed at ${rec.address}: $${(q.rentYr / 1e6).toFixed(2)}M a year for ${years} years, `
      + `${q.stepPct}% every ten. You keep the dirt and you do not touch it again until ${monthLabel(next.month + years * 12)}.`,
  });
  return { s: next, msg: `Ground-leased for ${years} years.` };
}

const GROUND_TENANTS = [
  "a hotel operator", "a grocery chain", "a self-storage operator", "a hospital system",
  "a car dealership group", "a data-centre developer", "a church", "a university",
];
function groundTenant(s: GameState): string {
  return GROUND_TENANTS[Math.floor(rng(s) * GROUND_TENANTS.length)];
}

/** Ground rent in, and the ten-year reviews. Called once a month. */
export function tickGroundLeases(s: GameState, parcels: ParcelTable) {
  for (const [bbl, gl] of Object.entries(s.groundLeases ?? {})) {
    if (!s.holdings[bbl]) { delete s.groundLeases![bbl]; continue; }
    if (s.month >= gl.endM) {
      const rec = resolveRec(parcels, s, bbl);
      delete s.groundLeases![bbl];
      delete s.holdings[bbl].groundLeased;
      s.news.unshift({
        q: s.month, kind: "event",
        text: `The ground lease at ${rec?.address ?? bbl} has run out. The land is yours again, and whatever they built on it is yours too.`,
      });
      continue;
    }
    if (s.month - gl.lastStepM >= gl.stepEveryM) {
      gl.rentYr = Math.round(gl.rentYr * (1 + gl.stepPct / 100));
      gl.lastStepM = s.month;
      const rec = resolveRec(parcels, s, bbl);
      s.news.unshift({
        q: s.month, kind: "info",
        text: `Rent review at ${rec?.address ?? bbl}: the ground rent steps to $${(gl.rentYr / 1e6).toFixed(2)}M.`,
      });
    }
    s.cash += gl.rentYr / 12;
    logBooks(s, "noi", gl.rentYr / 12);
  }
}

export function approachOwner(
  s: GameState, parcels: ParcelTable, adjacency: Adjacency, bbl: string,
): { s: GameState; err?: string; refused?: boolean; ask?: number } {
  const rec = parcels[bbl];
  if (!rec) return { s, err: "Unknown parcel." };
  if (s.holdings[bbl]) return { s, err: "You own it." };
  if (s.listings.some((l) => l.bbl === bbl)) return { s, err: "It's already listed — hit the Market tab." };
  const prior = s.approaches[bbl];
  if (prior && s.month < prior.q + 6) {
    return { s, err: prior.refused ? "You knocked recently — the owner hasn't changed their mind." : "You already have their number — it's good for a while." };
  }
  const next = clone(s);
  const pressure = assemblagePressure(next, adjacency, bbl);
  const refuseP = Math.min(0.9, Math.max(0.1,
    0.34 + 0.35 * pressure
    - (rec.class === "land" ? 0.12 : 0)
    - (next.econ.phase === "recession" ? 0.10 : 0)
    + (rec.demandScore - 50) / 500,
  ));
  if (rng(next) < refuseP) {
    next.approaches[bbl] = { q: next.month, refused: true };
    next.news.unshift({ q: next.month, kind: "info", text: `${rec.address}: the owner isn't selling${pressure > 0.4 ? " — they know what you're assembling" : ""}.` });
    return { s: next, refused: true };
  }
  const premium = 1.06 + 0.5 * Math.pow(rng(next), 2) + 0.22 * pressure;
  const ask = Math.round(assetValue(rec, next.econ, initialCondition(rec)) * premium / 1000) * 1000;
  next.approaches[bbl] = { q: next.month, refused: false, ask };
  next.news.unshift({ q: next.month, kind: "info", text: `${rec.address}: the owner would take $${(ask / 1e6).toFixed(2)}M. The number holds for six months.` });
  return { s: next, ask };
}

export function buyOffMarket(
  s: GameState, parcels: ParcelTable, bbl: string, product: BuyProduct, lev = 1, bid?: number,
): { s: GameState; err?: string; msg?: string } {
  const a = s.approaches[bbl];
  if (!a || a.refused || !a.ask) return { s, err: "No live ask — approach the owner first." };
  if (s.month > a.q + 6) return { s, err: "That number expired." };
  const price = Math.round(bid ?? a.ask);
  if (price >= a.ask) return executePurchase(s, parcels, bbl, a.ask, product, true, lev);

  const q = buyQuote(s, parcels, bbl, price, product, lev);
  if (s.cash < q.equity) return { s, err: `That bid still needs $${(q.equity / 1e6).toFixed(2)}M of equity — you're short.` };
  const next = clone(s);
  // an owner who wasn't selling in the first place has no reason to bend:
  // off-market discounts come much harder than they do on the open tape
  const disc = 1 - price / Math.max(1, a.ask);
  const p = Math.max(0.02, Math.min(0.9, 0.92 - disc * 11.0 + (next.econ.phase === "recession" ? 0.12 : 0)));
  const roll = rng(next);
  if (roll < p) {
    const done = executePurchase(next, parcels, bbl, price, product, true, lev);
    if (done.err) return { s, err: done.err };
    return { s: done.s, msg: `Done at $${(price / 1e6).toFixed(2)}M, off-market.` };
  }
  if (roll < p + 0.4) {
    next.news.unshift({ q: next.month, kind: "info", text: `${parcels[bbl]?.address}: the owner didn't move off $${(a.ask / 1e6).toFixed(2)}M.` });
    return { s: next, msg: "They held their number." };
  }
  const na = next.approaches[bbl];
  na.refused = true;
  delete na.ask;
  next.news.unshift({ q: next.month, kind: "warn", text: `${parcels[bbl]?.address}: the owner ended the conversation.` });
  return { s: next, msg: "They ended the conversation." };
}

// One counter per approach, at YOUR number off the slider. The deeper you
// cut, the worse the odds — they take it, hold firm, or hang up entirely.
export function counterOffMarket(
  s: GameState, parcels: ParcelTable, adjacency: Adjacency, bbl: string, offerPx?: number,
): { s: GameState; err?: string; msg?: string } {
  const a = s.approaches[bbl];
  const rec = parcels[bbl];
  if (!a || a.refused || !a.ask || !rec) return { s, err: "No live ask to counter." };
  if (a.countered) return { s, err: "You already countered — the number on the table is the number." };
  if (s.month > a.q + 6) return { s, err: "That number expired." };
  const next = clone(s);
  const na = next.approaches[bbl];
  na.countered = true;
  const px = Math.round(offerPx ?? a.ask * 0.88);
  const cut = Math.max(0, 1 - px / a.ask);                     // how deep you went
  const pressure = assemblagePressure(next, adjacency, bbl);
  const pTake = Math.max(0.05, Math.min(0.8,
    0.48
    - (cut - 0.12) * 2.6                                       // 12% under is the reference cut
    - 0.35 * pressure                                          // holdouts don't blink
    + (next.econ.phase === "recession" ? 0.18 : 0)             // fear is your friend
    - (next.econ.phase === "expansion" ? 0.08 : 0),
  ));
  const roll = rng(next);
  if (roll < pTake) {
    na.ask = Math.round(px / 1000) * 1000;
    next.news.unshift({ q: next.month, kind: "deal", text: `${rec.address}: the owner grumbled and took your number — $${(na.ask / 1e6).toFixed(2)}M.` });
    return { s: next, msg: "They took it." };
  }
  if (roll < pTake + 0.45) {
    next.news.unshift({ q: next.month, kind: "info", text: `${rec.address}: the owner didn't move. $${(a.ask / 1e6).toFixed(2)}M stands.` });
    return { s: next, msg: "They held firm." };
  }
  na.refused = true;
  delete na.ask;
  next.news.unshift({ q: next.month, kind: "info", text: `${rec.address}: the owner hung up. The door is closed for a while.` });
  return { s: next, msg: "They walked." };
}

// Selling is a process, not a button: list at an ask, wait for offers, and
// decide. Overprice it and the phone stays quiet.
export function listForSale(s: GameState, parcels: ParcelTable, bbl: string, ask: number): { s: GameState; err?: string } {
  // A merged deed has no land left in it — selling it alone would hand over a
  // piece of paper and keep the dirt. The site sells as a site.
  if (s.merged?.[bbl]) return { s, err: "That deed is part of an assemblage. Sell the site, not the piece." };
  // The leased fee is a bond with a deed attached and this desk does not trade
  // it. Granting the lease was the decision; living with it is the rest of it.
  if (s.groundLeases?.[bbl]) return { s, err: "It is ground-leased. You do not get that corner back until the term runs out." };
  const h = s.holdings[bbl];
  if (!h) return { s, err: "You don't own that parcel." };
  if (h.renovatingUntilM !== undefined && s.month < h.renovatingUntilM) {
    return { s, err: "Can't market it mid-renovation — finish the work first." };
  }
  if (s.developments[bbl]) return { s, err: "Can't sell with cranes on site — deliver the building first." };
  const rec = resolveRec(parcels, s, bbl);
  if (!rec) return { s, err: "Unknown parcel." };
  if (!Number.isFinite(ask) || ask <= 0) return { s, err: "Name a real number." };
  const next = clone(s);
  next.holdings[bbl].sale = { ask: Math.round(ask), listedM: next.month };
  next.news.unshift({ q: next.month, kind: "info", text: `${rec.address} goes to market at $${(ask / 1e6).toFixed(2)}M.` });
  return { s: next };
}

export function delist(s: GameState, bbl: string): GameState {
  const next = clone(s);
  if (next.holdings[bbl]?.sale) delete next.holdings[bbl].sale;
  return next;
}

// What a sale nets and owes. Friction first — sell-side brokerage, transfer
// tax, legal and title all come off the top before anyone computes a gain.
export function saleTaxQuote(h: Holding, price: number): { net: number; gain: number; tax: number; recapture: number; appreciation: number } {
  const net = Math.round(price * (1 - SALE_BROKERAGE - TRANSFER_TAX - SALE_FRICTION));
  const depr = h.deprTaken ?? 0;
  const adjBasis = h.costBasis - depr;
  const gain = net - adjBasis;
  // Depreciation is a loan from the government, not a gift. On the way out,
  // every dollar of it comes back at 25% before a cent of the real
  // appreciation is taxed at the long-term rate. A player who levers hard and
  // depreciates fast has been borrowing against this the whole time.
  const recapture = Math.max(0, Math.min(depr, gain));
  const appreciation = Math.max(0, gain - recapture);
  const tax = Math.round(recapture * RECAPTURE_RATE + appreciation * CAP_GAINS_RATE);
  return { net, gain, tax, recapture, appreciation };
}

export function acceptSaleOffer(s: GameState, parcels: ParcelTable, bbl: string, exchange = false): { s: GameState; err?: string } {
  const h = s.holdings[bbl];
  const offer = h?.sale?.offer;
  if (!h || !offer) return { s, err: "No live offer." };
  if (s.month > offer.expiresM) return { s, err: "That offer lapsed." };
  const rec = resolveRec(parcels, s, bbl);
  if (!rec) return { s, err: "Unknown parcel." };
  const { net, gain, tax } = saleTaxQuote(h, offer.price);
  if (exchange && s.exchange) return { s, err: "One exchange at a time — close the live 1031 first." };
  if (exchange && tax <= 0) return { s, err: "No gain to shelter — just take the cash." };
  const next = clone(s);
  // Participating paper takes its cut here, and only here. That is the whole
  // trade: you borrowed at a third of a point over the index for years, and
  // the lender collects on the way out.
  const kick = h.loan?.kicker && gain > 0 ? Math.round(gain * h.loan.kicker) : 0;
  // Leaving a loan inside its lockout costs the same on a sale as on a refi.
  const breakFee = h.loan ? prepayPenalty(h.loan, next.month) : 0;
  const toSeller = net - (h.loan?.balance ?? 0) - kick - breakFee;
  next.cash += toSeller;
  logBooks(next, "sold", toSeller);
  // THE WATERFALL. If a partner is in this deal they are made whole out of
  // these proceeds before a dollar of profit is split, and the promote — the
  // thing the whole structure exists to pay you — is settled here or not at
  // all. A deal that sold for less than the partner put in pays you nothing,
  // however long you ran it.
  const jvOut = settleJV(next, bbl, toSeller);
  if (jvOut.lpCash > 0) {
    next.cash -= jvOut.lpCash;
    logBooks(next, "sold", -jvOut.lpCash);
  }
  if (kick + breakFee > 0) logBooks(next, "debtSvc", kick + breakFee);
  if (exchange) {
    next.exchange = { deferredTax: tax, rolledGain: gain, minPrice: offer.price, deadlineM: next.month + EXCHANGE_WINDOW_M };
  } else if (tax > 0) {
    next.cash -= tax;
    next.taxesPaid = (next.taxesPaid ?? 0) + tax;
    logBooks(next, "taxes", tax);
  }
  next.exits = next.exits ?? [];
  next.exits.push({ bbl, address: rec.address, boughtM: h.boughtM, soldM: next.month, price: offer.price, basis: h.costBasis, gain });
  recordComp(next, rec, offer.price, "a buyer", "You", undefined, h.condition);
  if (next.exits.length > 200) next.exits.shift();
  // AN ASSEMBLED SITE SELLS AS ONE SITE. The child deeds go with it — their
  // land, their basis and their value were folded into this one the day it was
  // assembled, and the buyer is paying for all of it.
  for (const [child, parent] of Object.entries(next.merged ?? {})) {
    if (parent !== bbl) continue;
    delete next.merged![child];
    delete next.holdings[child];
  }
  // The encumbrances leave with the deed, HERE, not on the next tick. The
  // invariant sweep reads the state the moment the sale returns, and a lease
  // that outlives its land for even one call is a lease on somebody else's
  // property.
  if (next.groundLeases?.[bbl]) delete next.groundLeases[bbl];
  delete next.holdings[bbl];
  next.lois = next.lois.filter((l) => l.bbl !== bbl);
  next.news.unshift({
    q: next.month, kind: "deal",
    text: `Closed: ${rec.address} at $${(offer.price / 1e6).toFixed(2)}M — ${gain >= 0 ? "a gain" : "a loss"} of $${(Math.abs(gain) / 1e6).toFixed(2)}M against basis`
      + (kick > 0 ? `. Your lender took $${(kick / 1e6).toFixed(2)}M of the gain` : "")
      + (breakFee > 0 ? `, and $${(breakFee / 1e6).toFixed(2)}M to break the loan early` : "")
      + (exchange ? `. 1031 clock running: buy for ≥ $${(offer.price * 0.8 / 1e6).toFixed(1)}M by ${monthLabel(next.month + EXCHANGE_WINDOW_M)} or $${(tax / 1e6).toFixed(2)}M of tax comes due.`
        : tax > 0 ? ` ($${(tax / 1e6).toFixed(2)}M capital-gains tax withheld).` : "."),
  });
  if (jvOut.lpCash > 0 || jvOut.promote > 0) {
    next.news.unshift({
      q: next.month, kind: "deal",
      text: `Partnership settled at ${rec.address}: $${(jvOut.lpCash / 1e6).toFixed(2)}M out to the partner`
        + (jvOut.promote > 0 ? `, $${(jvOut.promote / 1e6).toFixed(2)}M of promote to you` : ", and no promote — the deal never cleared the pref")
        + `. ${jvOut.note}`,
    });
  }
  return { s: next };
}

export function declineSaleOffer(s: GameState, bbl: string): GameState {
  const next = clone(s);
  const sale = next.holdings[bbl]?.sale;
  if (sale?.offer) delete sale.offer;
  return next;
}

// Monthly: buyers circle listed assets. Offer flow scales with how honest
// the ask is, the market phase, and how long it has sat. A live offer on a
// well-priced asset sometimes draws a second bidder who pushes the number.
/**
 * INBOUND BROKERAGE.
 *
 * Twenty years of play produced five decisions. Not because the simulation was
 * wrong — a two-tenant building genuinely does not generate much — but because
 * the only deal flow that reached the player was a public tape they had to go
 * and read. That is not how this business works. Brokers call you, unprompted,
 * about a building that is not for sale, because they know what you own and
 * they want the fee.
 *
 * This is the existing off-market channel run in the other direction: it
 * writes an Approach exactly as walking up to an owner would, so the same
 * counter-and-close path applies. Nothing new to learn, and something to
 * think about most quarters instead of most decades.
 */
export function tickBrokerCalls(s: GameState, parcels: ParcelTable, bbls: string[]) {
  // A broker's interest in you scales with what you already own — the first
  // deal is the hard one, and after that the phone does not stop.
  const owned = Object.keys(s.holdings).length;
  const hot = s.econ.phase === "expansion" || s.econ.phase === "peak";
  // A real broker with a real off-market file calls a few times a YEAR, not
  // most months. The old rate — up to 30% a month — meant the phone rang
  // thirty-odd times a decade and the calls stopped being events. A fifth of
  // that: an occasional knock, worth picking up.
  const p = Math.min(0.06, (0.011 + 0.004 * Math.min(8, owned)) * (hot ? 1.25 : 0.7) * Math.max(0.5, s.econ.creditIdx ?? 1));
  if (rng(s) >= p) return;

  // they pitch near what you already buy: same class, similar size, better corner
  const ref = Object.values(s.holdings).map((h) => resolveRec(parcels, s, h.bbl)).filter(Boolean) as ParcelRecord[];
  const wantClass = ref.length && rng(s) < 0.65 ? ref[Math.floor(rng(s) * ref.length) % ref.length].class : null;
  let best: ParcelRecord | null = null;
  for (let i = 0; i < 90; i++) {
    const bbl = bbls[Math.floor(rng(s) * bbls.length)];
    if (s.holdings[bbl] || s.approaches[bbl] || s.listings.some((l) => l.bbl === bbl)) continue;
    const rec = resolveRec(parcels, s, bbl);
    if (!rec || rec.class === "land" || !rec.bldgArea) continue;
    if (wantClass && rec.class !== wantClass && rng(s) < 0.7) continue;
    const v = assetValue(rec, s.econ, initialCondition(rec));
    if (v <= 0 || v > Math.max(6_000_000, netWorthLike(s) * 1.6)) continue;
    best = rec;
    break;
  }
  if (!best) return;

  // An unsolicited pitch is rarely cheap — you are paying for not competing.
  // In a soft market the whisper number gets a good deal more reasonable. And
  // if the building belongs to a firm you can name, the number is THEIR
  // number: a family trust that owns it outright quotes a silly price, and a
  // shop that is three months from a margin call quotes inside appraisal.
  // A BROKER'S CALL IS A FILTER, NOT A FIREHOSE. The reason to pick up the
  // phone for an off-market pitch is that it is priced to move — an owner who
  // wants retail-plus for their building lists it like everybody else. So the
  // broker only rings when the whisper number is a real discount to value:
  // an estate that wants out, a fund past its hold period, a rival that needs
  // the cash. If today's file has nothing under 92 cents on the dollar, the
  // phone stays quiet.
  const owner = ownerOf(s, best.bbl);
  const value = assetValue(best, s.econ, initialCondition(best));
  let ask: number;
  let who: string;
  if (owner) {
    const q = rivalAsk(s, parcels, owner, best.bbl);
    ask = Math.round(q.ask / 1000) * 1000;
    who = q.note;
  } else {
    const motivated = s.econ.phase === "recession" ? rrange(s, 0.78, 0.90) : rrange(s, 0.84, 0.92);
    ask = Math.round(value * motivated / 1000) * 1000;
    who = "Their client needs it done this quarter — that is why you are hearing about it.";
  }
  if (ask > value * 0.92) return;   // not good enough to bother you with
  s.approaches[best.bbl] = { q: s.month, refused: false, ask, inbound: true };
  s.news.unshift({
    q: s.month, kind: "deal",
    text: `A broker called about ${best.address} — ${best.bldgArea.toLocaleString()} sf, off market, whisper number $${(ask / 1e6).toFixed(2)}M against roughly $${(value / 1e6).toFixed(2)}M of value. ${who}`,
  });
}

// net worth without importing the whole valuation graph — cash plus equity
function netWorthLike(s: GameState): number {
  let n = s.cash;
  for (const h of Object.values(s.holdings)) n += Math.max(0, h.costBasis - (h.loan?.balance ?? 0));
  return n;
}

/**
 * COUNTER A BID ON YOUR OWN BUILDING.
 *
 * Selling was accept-or-decline, which is not selling — declining a bid you
 * would have taken five per cent higher just throws the buyer away, and every
 * seller in the world picks up the phone instead.
 *
 * The buyer has a reservation price: what the building is worth to them, which
 * is what it appraises at, adjusted for how badly the market wants product
 * right now and for who they turned out to be. Counter inside it and they take
 * it. Counter a little over and they split the difference, because a deal in
 * hand is worth the last two per cent. Counter well over and they are gone —
 * and if they came to you unbidden, so is the whole approach.
 *
 * One round per offer. Grinding is not a mechanic.
 */
export function counterSale(
  s: GameState, parcels: ParcelTable, bbl: string, price: number,
): { s: GameState; err?: string; msg?: string } {
  const h0 = s.holdings[bbl];
  if (!h0?.sale?.offer) return { s, err: "There is no offer to counter." };
  if (h0.sale.offer.countered) return { s, err: "You have already been back to them once on this offer." };
  const rec = resolveRec(parcels, s, bbl);
  if (!rec) return { s, err: "Unknown parcel." };
  const px = Math.round(price);
  const next = clone(s);
  const h = next.holdings[bbl]!;
  const sale = h.sale!;
  const offer = sale.offer!;
  if (px <= offer.price) return { s, err: "That is not a counter — it is an acceptance at a worse price." };

  const value = holdingValue(rec, next.econ, h, next.month);
  // how far a buyer will stretch past appraisal: a boom with open credit buys
  // aggressively, a downturn with shut credit does not buy at all
  const hot = next.econ.phase === "expansion" || next.econ.phase === "peak";
  const money = Math.max(0.4, next.econ.creditIdx ?? 1);
  const stretch = (hot ? 1.10 : 0.99) * (0.94 + 0.12 * money);
  const reservation = Math.max(offer.price, Math.round(value * stretch * rrange(next, 0.97, 1.05)));

  if (px <= reservation) {
    const was = offer.price;
    offer.price = px;
    offer.countered = true;
    offer.expiresM = next.month + 2;
    next.news.unshift({
      q: next.month, kind: "deal",
      text: `They took your counter at ${rec.address}: $${(px / 1e6).toFixed(2)}M, up from $${(was / 1e6).toFixed(2)}M.`,
    });
    return { s: next, msg: `Countered and taken — $${(px / 1e6).toFixed(2)}M.` };
  }
  if (px <= reservation * 1.06) {
    const split = Math.round((px + reservation) / 2);
    offer.price = split;
    offer.countered = true;
    offer.expiresM = next.month + 2;
    next.news.unshift({
      q: next.month, kind: "deal",
      text: `They came back at ${rec.address}: $${(split / 1e6).toFixed(2)}M and no further. Good until ${monthLabel(offer.expiresM)}.`,
    });
    return { s: next, msg: `They split it — $${(split / 1e6).toFixed(2)}M.` };
  }
  // too far. They are gone.
  const wasUnsolicited = sale.unsolicited;
  delete sale.offer;
  if (wasUnsolicited) delete h.sale;
  next.news.unshift({
    q: next.month, kind: "warn",
    text: `Your counter at ${rec.address} ended it — they walked.`
      + (wasUnsolicited ? " They were never on the market for it; they just wanted the building." : ""),
  });
  return { s: next, msg: "They walked." };
}

export function tickSales(s: GameState, parcels: ParcelTable) {
  for (const h of Object.values(s.holdings)) {
    // UNSOLICITED APPROACHES. Nobody in this business only sells when they
    // decide to — the phone rings on the building you were not thinking about,
    // usually at a number that is almost enough. Holding becomes a decision
    // rather than the absence of one.
    if (!h.sale && !s.developments[h.bbl]) {
      const rec0 = resolveRec(parcels, s, h.bbl);
      // RARE, AND RARE ACROSS THE WHOLE BOOK. The per-building odds were 1% a
      // month in a boom, which sounds small until you own twenty buildings and
      // it becomes a call every three months, then every six weeks as the book
      // grows — the phone ringing constantly is not the feeling. It should be
      // the unusual event it is in life: a handful of times in a career, on the
      // building you were not thinking about.
      //
      // So: a fifth of the old per-building rate, only one live approach at a
      // time across the portfolio, and a cooling-off period afterwards. The
      // odds no longer scale with how much you own.
      const anyLive = Object.values(s.holdings).some((x) => x.sale?.unsolicited);
      const quiet = s.month - (s.lastUnsolicitedM ?? -60) > 30;
      if (rec0 && s.month - h.boughtM > 18 && !anyLive && quiet) {
        const hot = s.econ.phase === "expansion" || s.econ.phase === "peak";
        const money = Math.max(0.4, s.econ.creditIdx ?? 1);
        const p = (hot ? 0.0020 : 0.0006) * money * (1 + rec0.demandScore / 140);
        if (rng(s) < p) {
          s.lastUnsolicitedM = s.month;
          const v = holdingValue(rec0, s.econ, h, s.month);
          // over the top when money is loose, cheeky when it isn't
          const px = Math.round(v * (hot ? rrange(s, 1.02, 1.24) : rrange(s, 0.82, 0.98)));
          h.sale = { ask: px, listedM: s.month, unsolicited: true };
          h.sale.offer = { price: px, expiresM: s.month + 2 };
          s.news.unshift({
            q: s.month, kind: "deal",
            text: `An unsolicited offer for ${rec0.address}: $${(px / 1e6).toFixed(2)}M, ${px >= v ? `${Math.round((px / Math.max(1, v) - 1) * 100)}% over` : `${Math.round((1 - px / Math.max(1, v)) * 100)}% under`} appraisal. It's good for two months.`,
          });
        }
      }
    }
    const sale = h.sale;
    if (!sale) continue;
    if (sale.offer && s.month > sale.offer.expiresM) {
      delete sale.offer;
      if (sale.unsolicited) delete h.sale;      // they were never on the market
      continue;
    }
    if (sale.unsolicited && !sale.offer) { delete h.sale; continue; }
    const rec = resolveRec(parcels, s, h.bbl);
    if (!rec) continue;
    if (sale.offer) {
      const value = holdingValue(rec, s.econ, h, s.month);
      if (sale.offer.price < sale.ask && sale.ask / Math.max(1, value) < 1.1 && rng(s) < 0.12) {
        const bumped = Math.min(sale.ask, Math.round(sale.offer.price * rrange(s, 1.02, 1.06)));
        if (bumped > sale.offer.price) {
          sale.offer = { price: bumped, expiresM: s.month + 2 };
          s.news.unshift({
            q: s.month, kind: "deal",
            text: `A second bidder surfaced at ${rec.address} — the offer moves to $${(bumped / 1e6).toFixed(2)}M.`,
          });
        }
      }
      continue;
    }
    const value = holdingValue(rec, s.econ, h, s.month);
    const ratio = sale.ask / Math.max(1, value);
    const phaseAdj = s.econ.phase === "expansion" ? 1.3 : s.econ.phase === "recession" ? 0.5 : 1;
    const staleness = Math.min(0.06, (s.month - sale.listedM) * 0.004); // word gets around
    const p = Math.max(0.01, Math.min(0.5, (0.55 - 0.42 * ratio) * phaseAdj + staleness));
    if (rng(s) < p) {
      const bid = Math.min(sale.ask, value * (0.9 + rng(s) * 0.13));
      sale.offer = { price: Math.round(bid), expiresM: s.month + 2 };
      s.news.unshift({
        q: s.month, kind: "deal",
        text: `Offer in: $${(sale.offer.price / 1e6).toFixed(2)}M for ${rec.address} (ask $${(sale.ask / 1e6).toFixed(2)}M). Good for two months.`,
      });
    }
  }
}

// Monthly: other buyers work the same tape you do. Fairly-priced listings get
// taken out from under you — dawdle and the deal is gone.
export function tickListingAbsorption(s: GameState, parcels: ParcelTable) {
  const base = s.econ.phase === "expansion" ? 0.10 : s.econ.phase === "peak" ? 0.07 : s.econ.phase === "recovery" ? 0.05 : 0.02;
  const survivors: typeof s.listings = [];
  for (const li of s.listings) {
    const rec = resolveRec(parcels, s, li.bbl);
    if (!rec) continue;
    const value = assetValue(rec, s.econ, initialCondition(rec));
    const ratio = li.ask / Math.max(1, value);
    const priceFactor = Math.max(0.3, Math.min(1.8, 1.9 - ratio)); // bargains go first
    if (rng(s) < base * priceFactor * Math.max(0.25, marketAppetite(s))) {
      // Somebody takes it, and somebody has a name. Losing the same corner to
      // the same firm twice in a year is information; "another buyer" was not.
      const buyer = rivalBuys(s, rec, li.ask);
      if (buyer) {
        s.news.unshift({
          q: s.month, kind: "info",
          text: `${buyer.name} took ${rec.address} at $${(li.ask / 1e6).toFixed(2)}M. You watched it happen.`,
        });
      } else if (rng(s) < 0.5) {
        s.news.unshift({ q: s.month, kind: "info", text: `Sold: ${rec.address} went to a buyer from out of town at $${(li.ask / 1e6).toFixed(2)}M.` });
      }
      continue; // absorbed — off the tape
    }
    survivors.push(li);
  }
  s.listings = survivors;
}

// Toggle a leasing broker exclusive on an owned commercial building.
export function setBroker(s: GameState, parcels: ParcelTable, bbl: string, on: boolean): { s: GameState; err?: string } {
  const h = s.holdings[bbl];
  const rec = resolveRec(parcels, s, bbl);
  if (!h || !rec) return { s, err: "You don't own that." };
  if (on && !isCommercial(rec)) return { s, err: "Brokers work commercial space — multifamily leases itself." };
  const next = clone(s);
  const nh = next.holdings[bbl];
  if (on) nh.broker = true; else delete nh.broker;
  next.news.unshift({
    q: next.month, kind: "info",
    text: on ? `Leasing exclusive signed at ${rec.address} — the brokers start working the phones.` : `Broker dismissed at ${rec.address}.`,
  });
  return { s: next };
}

export function startRenovation(s: GameState, parcels: ParcelTable, bbl: string): { s: GameState; err?: string } {
  const h = s.holdings[bbl];
  if (!h) return { s, err: "You don't own that parcel." };
  const rec = resolveRec(parcels, s, bbl);
  if (!rec || rec.class === "land" || !rec.bldgArea) return { s, err: "Nothing to renovate on this lot." };
  if (h.condition === "good") return { s, err: "Already in top condition." };
  if (h.renovatingUntilM !== undefined) return { s, err: "Crews are already on site." };
  if (isCommercial(rec)) {
    const leased = h.tenants.reduce((sum, t) => sum + t.sf, 0);
    if (leased / rec.bldgArea > 0.35) {
      return { s, err: "Too much of the building is under lease to gut it — let the roll burn down below 35% first." };
    }
  }
  const cost = renovationCost(rec, s.econ);
  if (s.cash < cost) return { s, err: `Renovation costs $${(cost / 1e6).toFixed(2)}M cash — you're short.` };
  const next = clone(s);
  next.cash -= cost;
  logBooks(next, "capex", cost);
  const nh = next.holdings[bbl];
  nh.renovatingUntilM = next.month + RENO_MONTHS;
  nh.tenants = []; // remaining tenants are bought out as part of the job
  if (rec.class === "multifamily") nh.occ = 0;
  next.lois = next.lois.filter((l) => l.bbl !== bbl);
  next.news.unshift({
    q: next.month, kind: "info",
    text: `Scaffolding up at ${rec.address} — $${(cost / 1e6).toFixed(2)}M gut renovation, ${RENO_MONTHS} quarters.`,
  });
  return { s: next };
}

export { assetValue };

// ---------------------------------------------------------------- acquisition

