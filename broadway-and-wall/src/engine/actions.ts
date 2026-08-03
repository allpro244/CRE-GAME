// Player actions: buy listed or off-market (cash / fixed / floating IO),
// approach owners with assemblage pressure, sell, renovate. Pure — each
// returns a new state or an error string, never mutates the input.
import type { Adjacency, ParcelRecord, ParcelTable } from "@/data/types";
import type { Bid, GameState, Holding } from "./types";
import { logBooks, monthLabel } from "./types";
import { firmShort, describeFirm } from "./firm";
import { rng, rrange } from "./market";
import { assetValue, initialCondition, holdingValue, renovationCost, RENO_MONTHS, resolveRec, noiAfterTaxYr, demandLinear } from "./value";
import { marketAppetite, ownerOf, rivalAsk, rivalBuys, livingRivals } from "./rivals";
import { genRentRoll, isCommercial, depositsOn } from "./leasing";
import { originate, quote, productById, prepayPenalty } from "./debt";
import { takeoverDevelopment } from "./dev";
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
  // THE RESOLVED RECORD, ALWAYS. The static table is what the lot looked like
  // at generation; `resolveRec` is what is standing on it today, after
  // deliveries, rezonings, variances and assemblage. Sizing a loan against the
  // static one underwrote a delivered tower as the vacant lot it used to be.
  const rec = resolveRec(parcels, s, bbl);
  const closing = Math.round(price * CLOSING_PCT);
  if (product === "cash" || !rec) return { principal: 0, ratePct: 0, equity: price + closing, capPremium: 0, bind: "none" as const, ltvCap: 0, uwDscr: 0 };
  const prod = productById(product);
  // the life company will not finance a tired building, and the quote screen
  // has to say so before the closing table does
  if (prod.minCondition === "good" && initialCondition(rec) !== "good") {
    return { principal: 0, ratePct: 0, equity: price + closing, capPremium: 0, bind: "condition" as const, ltvCap: prod.ltv, uwDscr: prod.uwDscr };
  }
  const q = quote(s, prod, price, noiAfterTaxYr(rec, s.econ, initialCondition(rec), price));
  const principal = Math.round(q.principal * Math.max(0, Math.min(1, lev)));
  // WHAT ACTUALLY LIMITED THE LOAN. The desk sizes on three tests and takes
  // the smallest: the advance rate, the coverage ratio, and the debt yield.
  // The engine has always known which one bound and never told anybody, which
  // is why a 72% lender quoting 47% looked arbitrary rather than arithmetical.
  const capped = prod.ltv * price;
  // Floating paper closes with a rate cap the lender insists on, and the
  // premium is part of the equity cheque — the cheaper coupon is not free.
  const prod2 = productById(product);
  const capPremium = prod2.floating ? Math.round(principal * 0.0125) : 0;
  return {
    principal, ratePct: q.ratePct, equity: price - principal + closing + capPremium, capPremium,
    bind: q.dscrConstrained ? "dscr" : q.dyConstrained ? "dy" : q.principal < capped * 0.995 ? "credit" : "ltv",
    ltvCap: prod.ltv, uwDscr: prod.uwDscr,
  };
}

export function executePurchase(
  s: GameState, parcels: ParcelTable, bbl: string, price: number, product: BuyProduct, offMarket: boolean, lev = 1,
): { s: GameState; err?: string } {
  const rec = resolveRec(parcels, s, bbl);
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
    // A landmark stays a landmark when the deed moves.
    ...(s.landmarks?.[bbl] !== undefined ? { landmarked: true } : {}),
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
    // REPORTED, NOT NARRATED. This said "Deed recorded" in the passive voice of
    // a clerk. The same trade by a rival reads like a newspaper — name, an
    // appositive clause about who they are, and the number. The player got a
    // filing receipt. Now the paper covers them too, and the clause is earned:
    // every epithet behind it is a fact the player could have looked up.
    text: `${describeFirm(s)} has taken ${rec.address} at $${(price / 1e6).toFixed(2)}M`
      + `${holding.loan ? ` on $${(holding.loan.principal / 1e6).toFixed(1)}M of ${productById(holding.loan.product).lender} paper at ${holding.loan.ratePct}%` : ", all cash"}`
      + `${offMarket ? ", off-market" : ""}.`,
  });
  if (halfBuilt) takeoverDevelopment(next, parcels, bbl, halfBuilt);
  recordComp(next, rec, price, firmShort(s), ownerOf(s, bbl)?.name ?? (offMarket ? "a private owner" : "a listed seller"),
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
    // THE SITE HAS TO BE CLEAR.
    //
    // A merged lot's land moves into the parent and the child becomes a deed
    // with no area left in it — which is coherent for dirt and incoherent for
    // a building, because the building would then be standing on nothing. So
    // this stays a rule, and what changed is that the panel now SAYS so: it
    // lists every adjacent deed you own and names what is stopping each one,
    // instead of rendering nothing at all and leaving you to guess.
    if (rec.class !== "land" || rec.bldgArea > 0) {
      return { s, err: `${rec.address} still has a building on it. Clear the site before folding the deeds together.` };
    }
    if (s.landmarks?.[b] !== undefined) return { s, err: "One of those is landmarked. Its envelope is frozen and it cannot be folded into a bigger site." };
    if (s.developments[b]) return { s, err: "Construction is already underway on one of those." };
    if (s.holdings[b].sale) return { s, err: "One of those is on the market — pull the listing first." };
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
  // THE LIVE RECORD. Pricing an owner's ask off the STATIC table is what
  // produced asks at a fraction of the appraisal on this panel: a lot that has
  // had a building delivered on it, or that was reclassified, was quoted as
  // the dirt it used to be while the card beside it appraised the building.
  const rec = resolveRec(parcels, s, bbl);
  if (!rec) return { s, err: "Unknown parcel." };
  if (s.holdings[bbl]) return { s, err: "You own it." };
  if (s.listings.some((l) => l.bbl === bbl)) return { s, err: "It's already listed — hit the Market tab." };
  const prior = s.approaches[bbl];
  if (prior && s.month < prior.q + 6) {
    return { s, err: prior.refused ? "You knocked recently — the owner hasn't changed their mind." : "You already have their number — it's good for a while." };
  }
  const next = clone(s);
  const pressure = assemblagePressure(next, adjacency, bbl);
  // WHO OWNS IT DECIDES THE ANSWER, and this function never asked.
  //
  // Refusal was a flat 0.34 and the premium a flat 1.06-1.78x whether the lot
  // belonged to a family trust at 12% leverage that has held it for two
  // generations, to an opportunistic shop three months from a margin call, or
  // to nobody at all. The four styles behave measurably differently — family
  // firms sit at 0.12 LTV and never fail, opportunistic shops at 0.71 and fail
  // 70% of the time — and none of that reached the one table where the player
  // meets them.
  //
  // Now it does, and the holdout is real: a family firm that knows what you
  // are assembling will not sell at any sane price, for years. That is the
  // single most interesting thing a competitor can do, and it is only fair
  // because there are three ways out of it that already exist — build the
  // L-shaped site, wait for their cycle to break, or buy their whole position
  // as a bundle.
  const owner = ownerOf(next, bbl);
  const stressed = (owner?.stressMs ?? 0) > 4;
  const styleHold = owner
    ? (owner.style === "family" ? 0.30 : owner.style === "core" ? 0.14 : owner.style === "developer" ? 0.05 : -0.04)
    : 0;
  const refuseP = Math.min(0.94, Math.max(0.05,
    0.34 + 0.35 * pressure + styleHold
    // A firm that needs money answers the phone. A firm that does not, does not.
    - (stressed ? 0.42 : 0)
    - (owner && owner.cash < 0 ? 0.15 : 0)
    - (rec.class === "land" ? 0.12 : 0)
    - (next.econ.phase === "recession" ? 0.10 : 0)
    + (demandLinear(rec.demandScore) - 50) / 500,
  ));
  if (rng(next) < refuseP) {
    next.approaches[bbl] = { q: next.month, refused: true };
    next.news.unshift({
      q: next.month, kind: "info",
      text: owner
        ? `${rec.address}: ${owner.name} is not selling`
          + (pressure > 0.4 ? " — and they know exactly what you are assembling." : ".")
          + (owner.style === "family" ? " They have owned it for two generations and do not need the money." : "")
        : `${rec.address}: the owner isn't selling${pressure > 0.4 ? " — they know what you're assembling" : ""}.`,
    });
    return { s: next, refused: true };
  }
  // What they want for it, and who they are is most of it. A family firm that
  // has finally decided to sell names a number that reflects two generations
  // of not needing to; a stressed shop takes what clears the loan.
  const styleAsk = owner
    ? (owner.style === "family" ? 0.20 : owner.style === "core" ? 0.06 : owner.style === "opportunistic" ? 0.10 : 0.04)
    : 0;
  const premium = Math.max(0.80,
    1.06 + 0.5 * Math.pow(rng(next), 2) + 0.22 * pressure + styleAsk
    - (stressed ? rrange(next, 0.16, 0.30) : 0));
  const ask = Math.round(assetValue(rec, next.econ, initialCondition(rec)) * premium / 1000) * 1000;
  next.approaches[bbl] = { q: next.month, refused: false, ask };
  next.news.unshift({
    q: next.month, kind: "info",
    text: `${rec.address}: ${owner ? owner.name + " would take" : "the owner would take"} $${(ask / 1e6).toFixed(2)}M`
      + (stressed ? " — they are under pressure and it shows in the number." : ".")
      + " The number holds for six months.",
  });
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
  const rec = resolveRec(parcels, s, bbl);
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
export function listForSale(
  s: GameState, parcels: ParcelTable, bbl: string, ask: number, mode: "quiet" | "marketed" = "quiet",
): { s: GameState; err?: string } {
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
  // It cannot be in two processes at once. A building shown to the market both
  // on its own and inside a bundle is a building whose seller does not know
  // what he is selling, and every buyer works that out in an afternoon.
  if (s.portfolioSale?.bbls.includes(bbl)) {
    return { s, err: "That one is inside the portfolio you have in the market. Pull it out of the bundle first." };
  }
  const rec = resolveRec(parcels, s, bbl);
  if (!rec) return { s, err: "Unknown parcel." };
  if (!Number.isFinite(ask) || ask <= 0) return { s, err: "Name a real number." };
  const next = clone(s);
  if (mode === "marketed") {
    // A campaign takes as long as it takes to get the book in front of
    // everybody who might buy it. Two to four months, then offers are due on a
    // date everyone knows, which is the entire mechanism by which a marketed
    // sale finds a price a quiet one never will.
    // A CAMPAIGN IS NOT A FREE OPTION ON SIX DRAWS.
    //
    // Listing cost nothing and delisting cost nothing — the fee only bit on a
    // close. So the optimal play was to run a process, read up to six bids,
    // walk away unless one landed in the tail, and rerun it next year.
    // Measured: 557 campaigns, 427 walked away from at zero cost, 98 sales at
    // a realised median 1.21x appraisal. You sold at the ceiling of the
    // distribution every single time and paid nothing for the misses.
    //
    // In life you pay the broker's marketing budget up front — the book, the
    // photography, the mailing — and you pay it whether or not it trades. And
    // a building the market has already been shown twice is a building
    // everyone has already passed on.
    const since = next.month - (next.holdings[bbl].lastCampaignM ?? -999);
    if (since < 24) {
      return { s, err: `You ran a process on this one ${since} months ago and pulled it. `
        + `Every buyer in town has seen the book — going back out now tells them only that nobody bid. `
        + `Wait until ${monthLabel((next.holdings[bbl].lastCampaignM ?? 0) + 24)}, or sell it quietly.` };
    }
    const marketing = Math.round(ask * 0.0035);
    if (next.cash < marketing) return { s, err: `A campaign costs $${(marketing / 1000).toFixed(0)}K in marketing up front. You do not have it.` };
    next.cash -= marketing;
    logBooks(next, "ga", marketing);
    const weeks = Math.round(rrange(next, 2, 4));
    next.holdings[bbl].sale = {
      ask: Math.round(ask), listedM: next.month, mode: "marketed",
      callM: next.month + weeks, round: 0,
    };
    next.news.unshift({
      q: next.month, kind: "info",
      text: `${rec.address} is on the market properly: a whisper of $${(ask / 1e6).toFixed(2)}M, `
        + `offers due ${monthLabel(next.month + weeks)}. The broker takes 2.5% and earns it if the book is any good.`,
    });
    return { s: next };
  }
  next.holdings[bbl].sale = { ask: Math.round(ask), listedM: next.month, mode: "quiet" };
  next.news.unshift({ q: next.month, kind: "info", text: `${rec.address} goes to market at $${(ask / 1e6).toFixed(2)}M. No broker, no campaign — you wait for the phone.` });
  return { s: next };
}

// The sell-side fee. A quiet listing costs a point and a half and gets you a
// sign on the door; a run process costs a point more and gets you every buyer
// in the city in the same room on the same day.
export function saleFeeRate(h: Holding): number {
  return h.sale?.mode === "marketed" ? 0.025 : SALE_BROKERAGE;
}

const BIDDER_NAMES = [
  "a pension fund adviser", "a family office", "a listed REIT", "an overseas buyer",
  "a local operator", "a debt fund taking equity risk", "a 1031 buyer on a clock",
  "an insurance company", "a private syndicate",
];

/**
 * OFFERS ARE DUE TODAY.
 *
 * Every buyer who was going to bid, bidding at once. The depth of the list is
 * the market: in a hot cycle with money everywhere you get five names and the
 * top one is well over the whisper; in a crunch you get one, or none, and the
 * whisper was a work of fiction.
 *
 * The spread across the list is the information. A tight list means the market
 * agrees with your number and there is nothing more to get. A wide one means
 * the top bidder wants it much more than the rest — which is exactly when best
 * and final is worth the risk of losing them.
 */
function runCallForOffers(s: GameState, parcels: ParcelTable, h: Holding) {
  const rec = resolveRec(parcels, s, h.bbl);
  const sale = h.sale;
  if (!rec || !sale) return;
  const value = holdingValue(rec, s.econ, h, s.month);
  const ratio = sale.ask / Math.max(1, value);
  const appetite = marketAppetite(s);
  const phase = s.econ.phase === "peak" ? 1.5 : s.econ.phase === "expansion" ? 1.25
    : s.econ.phase === "recovery" ? 0.8 : 0.35;
  // how many people actually turned up
  const expected = Math.max(0, 3.4 * phase * Math.max(0.3, appetite) * Math.max(0.25, 2.1 - ratio));
  let n = Math.floor(expected) + (rng(s) < expected % 1 ? 1 : 0);
  n = Math.min(6, n);
  const bids: Bid[] = [];
  const used = new Set<string>();
  // THE PEOPLE YOU COMPETE WITH ALL CENTURY SHOULD TURN UP WHEN YOU SELL.
  //
  // Measured over six fifty-year runs: rival bids in the player's own sale
  // process, zero. Not rare — zero. The pool was nine anonymous strings and
  // the twelve named firms were not in it, so you could run a best-and-final
  // every year for fifty years and never once see a name you recognised.
  // Losing to "a family office" is a dice roll; losing to Kestrel Capital,
  // who outbid you on the Drydock block in 2009, is a story.
  //
  // Who actually turns up is filtered by who can pay: a firm bids on your
  // building only if it has the cash and is not already in trouble.
  const live = livingRivals(s).filter((r) => !r.stressMs && r.cash > value * 0.22);
  for (let i = 0; i < n; i++) {
    // roughly half the room is the street, by name, when the street is liquid
    const firm = live.length && rng(s) < 0.55
      ? live[Math.floor(rng(s) * live.length)] : null;
    let name = firm && !used.has(firm.name)
      ? firm.name
      : BIDDER_NAMES[Math.floor(rng(s) * BIDDER_NAMES.length)];
    let guard = 0;
    while (used.has(name) && guard++ < 12) name = BIDDER_NAMES[Math.floor(rng(s) * BIDDER_NAMES.length)];
    used.add(name);
    // Bids cluster around value with a real tail. The outlier at the top of a
    // good list is the whole reason to run a process.
    // The point of a process is the TOP of the list, not its middle. A single
    // buyer who happens to ring bids around the mark; the best of five bids in
    // a live market bids over it, and that gap — not the fee, not the speed —
    // is the entire reason anyone runs a campaign. Calibrated so a normal
    // three-bid list clears a per cent or two above appraisal and a thin
    // one-bid market clears just under it, which is the honest trade.
    const enthusiasm = rng(s);
    // CENTRED ON APPRAISAL, NOT ABOVE IT.
    //
    // This ran [0.90, 1.251] at the top of the cycle: the mean single bid was
    // 1.076x appraisal and the expected MAX OF SIX was 1.201x. The comment two
    // lines up claims a normal three-bid list clears "a per cent or two above
    // appraisal" — it was clearing sixteen. Since the tape sells to you at a
    // median 0.951x, that is a structural eighteen-point round trip against
    // appraisal, repeatable, on 29% equity.
    //
    // Measured: bolted onto an ordinary bot it took the 50-year median from
    // $73M to $619M, and with the 1031 to $706M with ZERO failures — the tenth
    // percentile of the exploit beat the disciplined reference median by 40%.
    // Now [0.86, 1.09] at peak: E[max of 3] ~1.03, E[max of 6] ~1.06, which is
    // what the calibration always claimed.
    const price = Math.round(value * (0.86 + 0.20 * enthusiasm * Math.max(0.55, Math.min(1.15, phase))));
    // A buyer stretching past the pack is the one most likely to find a reason
    // to come back to you about it later.
    const credibility = Math.max(0.2, Math.min(0.97, 1.0 - 0.55 * enthusiasm + (rng(s) - 0.5) * 0.3));
    bids.push({
      name, price, credibility,
      note: credibility > 0.75 ? "Cash to close, no financing condition."
        : credibility > 0.5 ? "Financed, but the lender is known."
        : "Aggressive number. Read the covenant before you count on it.",
    });
  }
  bids.sort((a, b) => b.price - a.price);
  sale.bids = bids;
  delete sale.callM;
  if (!bids.length) {
    s.news.unshift({
      q: s.month, kind: "warn",
      text: `Offers were due at ${rec.address} and nobody bid. The book went out to the whole market and the whole market passed — that is information about your number, or about the building.`,
    });
    return;
  }
  const top = bids[0].price;
  s.news.unshift({
    q: s.month, kind: "deal",
    text: `${bids.length} bid${bids.length === 1 ? "" : "s"} in at ${rec.address}. `
      + `Best is $${(top / 1e6).toFixed(2)}M from ${bids[0].name}`
      + (bids.length > 1 ? `, against $${(bids[1].price / 1e6).toFixed(2)}M second` : "")
      + `. ${top >= sale.ask ? "Over the whisper." : `${Math.round((1 - top / Math.max(1, sale.ask)) * 100)}% under the whisper.`}`,
  });
}

/**
 * BEST AND FINAL.
 *
 * Go back to the top of the list and tell them there is another number they
 * have to beat. Most of them sharpen. Some of them, correctly, tell you they
 * were at their best the first time and walk — and if the one who walks was
 * your top bid, you have just talked yourself down the list. One round only,
 * because a second is how a seller becomes a story.
 */
export function bestAndFinal(s: GameState, parcels: ParcelTable, bbl: string): { s: GameState; err?: string; msg?: string } {
  const h = s.holdings[bbl];
  const sale = h?.sale;
  if (!sale?.bids?.length) return { s, err: "There is no bid list to go back to." };
  if ((sale.round ?? 0) > 0) return { s, err: "You have already been back to them once. Twice and you are the story, not the building." };
  const next = clone(s);
  const ns = next.holdings[bbl].sale!;
  const live = (ns.bids ?? []).filter((b) => !b.dropped).slice(0, 3);
  const rec = resolveRec(parcels, next, bbl);
  let walked = 0, lifted = 0;
  for (const b of live) {
    // The ones who can afford to be patient are the ones who walk.
    const pWalk = 0.30 * (1 - b.credibility) + (next.econ.phase === "recession" ? 0.18 : 0);
    if (rng(next) < pWalk) { b.dropped = true; walked++; continue; }
    const bump = 1 + rrange(next, 0.005, 0.055) * b.credibility;
    const before = b.price;
    b.price = Math.round(b.price * bump);
    if (b.price > before) lifted++;
  }
  ns.round = 1;
  ns.bids = (ns.bids ?? []).sort((a, b) => (a.dropped ? 1 : 0) - (b.dropped ? 1 : 0) || b.price - a.price);
  const best = ns.bids.find((b) => !b.dropped);
  next.news.unshift({
    q: next.month, kind: best ? "deal" : "warn",
    text: `Best and final at ${rec?.address ?? bbl}: ${lifted} sharpened, ${walked} walked. `
      + (best ? `The number to beat is $${(best.price / 1e6).toFixed(2)}M from ${best.name}.`
        : `Everybody left the table. That was the risk and it came in.`),
  });
  return { s: next, msg: best ? "Bids refreshed." : "They all walked." };
}

/**
 * TAKE A BID — and find out whether they meant it.
 *
 * A number on a bid list is not a closing. The weaker the covenant behind it,
 * the likelier the buyer comes back after they have been through the building
 * with a reason the price should be lower. A retrade is not a refusal; it is a
 * new offer at a worse number, and you already have the machinery to accept it,
 * counter it, or tell them to go away.
 */
export function acceptBid(s: GameState, parcels: ParcelTable, bbl: string, index: number): { s: GameState; err?: string; msg?: string } {
  const h = s.holdings[bbl];
  const sale = h?.sale;
  const bid = sale?.bids?.[index];
  if (!bid || bid.dropped) return { s, err: "That bid is not on the table." };
  const next = clone(s);
  const ns = next.holdings[bbl].sale!;
  const b = ns.bids![index];
  const rec = resolveRec(parcels, next, bbl);
  const pRetrade = 0.42 * (1 - b.credibility);
  if (rng(next) < pRetrade) {
    const cut = rrange(next, 0.02, 0.08);
    const price = Math.round(b.price * (1 - cut));
    const reasons = [
      "their engineer found the roof",
      "their lender resized the loan",
      "they read the rent roll properly and did not like the rollover",
      "their committee would not approve the number",
      "the environmental report came back with a question",
    ];
    const reason = reasons[Math.floor(rng(next) * reasons.length)];
    ns.offer = { price, expiresM: next.month + 2, from: b.name, retrade: reason };
    delete ns.bids;
    next.news.unshift({
      q: next.month, kind: "warn",
      text: `${b.name} has retraded ${rec?.address ?? bbl} — ${reason}. `
        + `They are at $${(price / 1e6).toFixed(2)}M now, down from $${(b.price / 1e6).toFixed(2)}M. Take it, counter it, or tell them no.`,
    });
    return { s: next, msg: "They retraded you." };
  }
  ns.offer = { price: b.price, expiresM: next.month + 2, from: b.name };
  delete ns.bids;
  next.news.unshift({
    q: next.month, kind: "deal",
    text: `${b.name} is under contract at ${rec?.address ?? bbl} for $${(b.price / 1e6).toFixed(2)}M, clean. Close it.`,
  });
  return { s: next, msg: "Under contract." };
}

/**
 * WHO WANTS IT, AND WHAT THAT IS WORTH.
 *
 * An unsolicited approach is not a random number — it is a specific firm with
 * a specific reason, and the reason is the price. A neighbour assembling a
 * site will pay well over the mark because the lot is worth more to them than
 * it is to the market; a fund adding to a position pays a modest premium for
 * not having to compete for it; an opportunist who noticed your building is
 * half empty is not paying a premium at all.
 *
 * This is the same assemblage logic that has been making YOUR approaches
 * dearer since the first one, pointed back at you — which is exactly how it
 * works from the other side of the table.
 */
function unsolicitedBidder(
  s: GameState, parcels: ParcelTable, adjacency: Adjacency | null, rec: ParcelRecord, h: Holding,
): { name: string; why: string; mult: number } {
  const firms = livingRivals(s).filter((r) => !r.stressMs);
  // Does anybody own the lots around this one?
  const nbrs = new Set(adjacency?.[rec.bbl] ?? []);
  const neighbour = nbrs.size ? firms.find((r) => r.bbls.filter((b) => nbrs.has(b)).length >= 2) : undefined;
  if (neighbour && rec.class === "land") {
    return {
      name: neighbour.name,
      why: `They own ${neighbour.bbls.filter((b) => nbrs.has(b)).length} of the lots around it and they are assembling a site. `
        + `This is the number somebody pays when your dirt is the last piece.`,
      mult: rrange(s, 1.22, 1.55),
    };
  }
  if (neighbour) {
    return {
      name: neighbour.name,
      why: `They have the deeds either side. A building on the corner of somebody else's assemblage is worth more to `
        + `them than it is to the market, and they have just told you how much more.`,
      mult: rrange(s, 1.12, 1.34),
    };
  }
  // Somebody accumulating this asset class, who would rather not bid against
  // the whole city for the next one.
  const collector = firms
    .map((r) => ({
      r, n: r.bbls.filter((b) => (resolveRec(parcels, s, b)?.class ?? "") === rec.class).length,
    }))
    .filter((x) => x.n >= 3)
    .sort((a, b) => b.n - a.n)[0];
  if (collector && rng(s) < 0.7) {
    return {
      name: collector.r.name,
      why: `They already own ${collector.n} like it and would rather buy yours quietly than bid against the city for the next one.`,
      mult: rrange(s, 1.04, 1.16),
    };
  }
  // The opportunist. Reads the rent roll, notices the vacancy, and prices it.
  const occ = rec.bldgArea > 0
    ? Math.min(1, h.tenants.reduce((a, t) => a + t.sf, 0) / rec.bldgArea + (h.occ ?? 0) * 0.5) : 1;
  const who = firms.length ? firms[Math.floor(rng(s) * firms.length)].name : "An out-of-town buyer";
  return occ < 0.7
    ? { name: who, why: "They have read the rent roll and they are pricing the empty floors, not the building.", mult: rrange(s, 0.84, 0.96) }
    : { name: who, why: "No particular reason beyond wanting it. Those are the ones worth listening to.", mult: rrange(s, 0.98, 1.14) };
}

export function delist(s: GameState, bbl: string): GameState {
  const next = clone(s);
  const h = next.holdings[bbl];
  if (h?.sale) {
    // A pulled campaign is remembered. The market saw the book.
    if (h.sale.mode === "marketed") h.lastCampaignM = next.month;
    delete h.sale;
  }
  return next;
}

// What a sale nets and owes. Friction first — sell-side brokerage, transfer
// tax, legal and title all come off the top before anyone computes a gain.
export function saleTaxQuote(h: Holding, price: number): { net: number; gain: number; tax: number; recapture: number; appreciation: number } {
  // A run process costs a point more in fees than a sign on the door, and that
  // point is the price of finding out what the market would actually pay.
  const net = Math.round(price * (1 - saleFeeRate(h) - TRANSFER_TAX - SALE_FRICTION));
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
  recordComp(next, rec, offer.price, "a buyer", firmShort(next), undefined, h.condition);
  if (next.exits.length > 200) next.exits.shift();
  // AN ASSEMBLED SITE SELLS AS ONE SITE. The child deeds go with it — their
  // land, their basis and their value were folded into this one the day it was
  // assembled, and the buyer is paying for all of it.
  for (const [child, parent] of Object.entries(next.merged ?? {})) {
    if (parent !== bbl) continue;
    delete next.merged![child];
    delete next.holdings[child];
    if (next.workouts?.[child]) delete next.workouts[child];
  }
  // The encumbrances leave with the deed, HERE, not on the next tick. The
  // invariant sweep reads the state the moment the sale returns, and a lease
  // that outlives its land for even one call is a lease on somebody else's
  // property.
  if (next.groundLeases?.[bbl]) delete next.groundLeases[bbl];
  // The security deposits go with the deed — they were the tenants' money and
  // they are the buyer's obligation now.
  next.cash -= depositsOn(next.holdings[bbl]);
  delete next.holdings[bbl];
  // A SALE OUT OF DEFAULT CLOSES THE FILE. It is the best outcome available in
  // a workout — the lender is repaid at closing and nobody takes a loss — and
  // the file has to die with the deed, not linger and foreclose on a building
  // somebody else owns.
  if (next.workouts?.[bbl]) delete next.workouts[bbl];
  next.lois = next.lois.filter((l) => l.bbl !== bbl);
  next.news.unshift({
    q: next.month, kind: "deal",
    text: `Closed: ${rec.address} at $${(offer.price / 1e6).toFixed(2)}M — ${gain >= 0 ? "a gain" : "a loss"} of $${(Math.abs(gain) / 1e6).toFixed(2)}M against basis`
      + (kick > 0 ? `. Your lender took $${(kick / 1e6).toFixed(2)}M of the gain` : "")
      + (breakFee > 0 ? `, and $${(breakFee / 1e6).toFixed(2)}M to break the loan early` : "")
      + (exchange ? `. 1031 clock running: buy for ≥ $${(offer.price * 0.8 / 1e6).toFixed(1)}M by ${monthLabel(next.month + EXCHANGE_WINDOW_M)} or $${(tax / 1e6).toFixed(2)}M of tax comes due.`
        : tax > 0 ? ` ($${(tax / 1e6).toFixed(2)}M capital-gains tax withheld).` : "."),
  });
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
  // NOBODY RINGS A STRANGER.
  //
  // An off-market call is a favour, and a favour is something you are owed.
  // A broker sitting on a file they can only show to one buyer shows it to a
  // name they have closed with — not to somebody who arrived in town in
  // January with six million dollars and no record. The first year is the one
  // where you work the public tape like everybody else, and the phone starting
  // to ring is the first sign that the street has noticed you exist.
  if (s.month < 12) return;
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
    // THE FLOOR MOVES WITH YOUR BOOK.
    //
    // There was a ceiling here and no floor, so a firm running a hundred
    // million kept getting rung about three-million-dollar walk-ups. No broker
    // does that twice: the file you get shown is the file that matches the
    // cheque you can write, and pitching a principal a deal that would move
    // their net worth by three per cent is how you stop being called back.
    // Roughly a twentieth of net worth at the bottom, capped so it never
    // filters out the whole city early on.
    const nw = netWorthLike(s);
    const floor = Math.min(20_000_000, Math.max(0, nw * 0.05));
    if (v <= 0 || v < floor || v > Math.max(6_000_000, nw * 1.6)) continue;
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
  // A GATE THAT REJECTED EVERYTHING. This asked for a price under 92% of
  // appraisal, and measured across 150 live rival-owned buildings the asks
  // came in at 1.10x to 1.29x — so it passed ZERO of them, ever. rivalAsk is
  // the only function in the codebase that gives a firm a personality at a
  // negotiating table, and it was unreachable.
  //
  // A broker calling about somebody's building is not necessarily calling
  // with a bargain — they are calling because it is AVAILABLE, which is worth
  // hearing on a building that never comes to market. An owner's number is
  // where the conversation starts, not where it ends. Only a genuinely silly
  // ask gets filtered, and a stressed seller still has to be a real discount
  // to be worth the call.
  const cap = owner ? (owner.stressMs ? 0.97 : 1.34) : 0.92;
  if (ask > value * cap) return;
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

export function tickSales(s: GameState, parcels: ParcelTable, adjacency: Adjacency | null = null) {
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
      const anyLive = Object.values(s.holdings).some((x) => x.sale?.unsolicited)
        || (s.portfolioSale?.bbls.includes(h.bbl) ?? false);
      const quiet = s.month - (s.lastUnsolicitedM ?? -60) > 30;
      if (rec0 && s.month - h.boughtM > 18 && !anyLive && quiet) {
        const hot = s.econ.phase === "expansion" || s.econ.phase === "peak";
        const money = Math.max(0.4, s.econ.creditIdx ?? 1);
        const p = (hot ? 0.0020 : 0.0006) * money * (1 + rec0.demandScore / 140);
        if (rng(s) < p) {
          s.lastUnsolicitedM = s.month;
          const v = holdingValue(rec0, s.econ, h, s.month);
          // WHO IS CALLING, AND WHY.
          //
          // "An unsolicited offer" arrived from nobody, for no reason, at a
          // number drawn out of the phase. That is a dice roll wearing a
          // sentence. Every real approach has a name attached and a motive
          // behind it, and the motive is the whole content of the call: the
          // firm that owns the two lots either side of you is not paying the
          // same number as a fund rebalancing into your asset class, because
          // they are not buying the same thing. They are buying the block.
          const bidder = unsolicitedBidder(s, parcels, adjacency, rec0, h);
          const px = Math.round(v * bidder.mult * (hot ? rrange(s, 1.00, 1.10) : rrange(s, 0.86, 0.98)));
          h.sale = { ask: px, listedM: s.month, unsolicited: true };
          h.sale.offer = { price: px, expiresM: s.month + 2, from: bidder.name };
          s.news.unshift({
            q: s.month, kind: "deal",
            text: `${bidder.name} rang about ${rec0.address}: $${(px / 1e6).toFixed(2)}M, `
              + `${px >= v ? `${Math.round((px / Math.max(1, v) - 1) * 100)}% over` : `${Math.round((1 - px / Math.max(1, v)) * 100)}% under`} appraisal. `
              + `${bidder.why} It's good for two months.`,
          });
        }
      }
    }
    const sale = h.sale;
    if (!sale) continue;
    // The date everybody was told about arrives and the bids land at once.
    if (sale.callM !== undefined && s.month >= sale.callM) runCallForOffers(s, parcels, h);
    // A bid list is a decision sitting on your desk, not a queue to be topped
    // up: while it is live nothing else happens to this building.
    if (sale.bids && !sale.bids.length) {
      // Nobody bid. The campaign is over; the building stays on the market the
      // quiet way, because a late call from somebody who missed the date is a
      // real thing and the alternative is a listing that can never sell.
      delete sale.bids;
      sale.mode = "quiet";
    }
    if (sale.bids?.length) {
      // …but it goes stale. Nobody holds a number open forever.
      if (s.month - sale.listedM > 14) {
        const rec0 = resolveRec(parcels, s, h.bbl);
        delete sale.bids;
        delete h.sale;
        s.news.unshift({
          q: s.month, kind: "warn",
          text: `The bids on ${rec0?.address ?? h.bbl} have expired. You sat on the list too long and the buyers moved on.`,
        });
      }
      continue;
    }
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
    // A building you are under contract on is not on the market. Somebody else
    // buying it out from under a signed contract is not competition, it is a
    // bug — and it was the one thing that could make the funding window
    // unwinnable through no fault of the player.
    if (s.talks?.[li.bbl]?.agreed) { survivors.push(li); continue; }
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


/**
 * GOING BACK TO ONE BIDDER.
 *
 * Best-and-final puts the whole list in the room on the same day and is the
 * blunt instrument. This is the other move every seller makes: the private
 * call to the one number you would take five per cent more of. It risks
 * exactly that bidder — the rest of the list never hears about it — and a
 * credible buyer who is already at their limit simply leaves.
 *
 * One per bid. Grinding the same buyer is not negotiating.
 */
export function counterBid(
  s: GameState, parcels: ParcelTable, bbl: string, index: number, price: number,
): { s: GameState; err?: string; msg?: string } {
  const h0 = s.holdings[bbl];
  const b0 = h0?.sale?.bids?.[index];
  if (!h0?.sale || !b0) return { s, err: "There is no bid there." };
  if (b0.dropped) return { s, err: "They already walked." };
  if (b0.countered) return { s, err: "You have been back to them once. That is what the etiquette allows." };
  const rec = resolveRec(parcels, s, bbl);
  if (!rec) return { s, err: "Unknown parcel." };
  const px = Math.round(price);
  if (px <= b0.price) return { s, err: "That is not a counter — it is an acceptance at a worse price." };

  const next = clone(s);
  const bid = next.holdings[bbl]!.sale!.bids![index];
  bid.countered = true;

  // How far this buyer will actually stretch. Credibility is the whole read:
  // the institution that bid with a committee behind it has room, and the
  // syndicate that bid to be in the running does not.
  const value = holdingValue(rec, next.econ, next.holdings[bbl]!, next.month);
  const hot = next.econ.phase === "expansion" || next.econ.phase === "peak";
  const headroom = (0.02 + b0.credibility * 0.09) * (hot ? 1.25 : 0.85);
  const limit = Math.round(Math.max(b0.price, Math.min(value * 1.18, b0.price * (1 + headroom))));

  if (px <= limit) {
    bid.price = px;
    bid.note = "Came up on a private call.";
    next.news.unshift({
      q: next.month, kind: "deal",
      text: `${b0.name} came up to $${(px / 1e6).toFixed(2)}M at ${rec.address}, from $${(b0.price / 1e6).toFixed(2)}M.`,
    });
    return { s: next, msg: `They came up — $${(px / 1e6).toFixed(2)}M.` };
  }
  if (px <= limit * 1.05) {
    const split = Math.round((px + limit) / 2);
    bid.price = split;
    bid.note = "Split the difference and stopped.";
    next.news.unshift({
      q: next.month, kind: "info",
      text: `${b0.name} split it at ${rec.address}: $${(split / 1e6).toFixed(2)}M and no further.`,
    });
    return { s: next, msg: `They split it — $${(split / 1e6).toFixed(2)}M.` };
  }
  bid.dropped = true;
  bid.note = "Walked when you went back to them.";
  next.news.unshift({
    q: next.month, kind: "warn",
    text: `${b0.name} walked at ${rec.address}. You went back to them for $${(px / 1e6).toFixed(2)}M and they were done.`,
  });
  return { s: next, msg: `${b0.name} walked.` };
}

/**
 * A NEW NUMBER ON THE SAME SIGN.
 *
 * Repricing used to mean delisting and relisting, which throws away the
 * campaign, the bid list and every month the building has been on the market.
 * No seller does that; they ring the broker. What it costs is what it costs in
 * life: a cut tells every bidder you are motivated, and a raise mid-campaign
 * loses the buyers who were nearly there.
 */
export function repriceListing(
  s: GameState, parcels: ParcelTable, bbl: string, ask: number,
): { s: GameState; err?: string; msg?: string } {
  const h0 = s.holdings[bbl];
  if (!h0?.sale) return { s, err: "That is not on the market." };
  const rec = resolveRec(parcels, s, bbl);
  if (!rec) return { s, err: "Unknown parcel." };
  const px = Math.round(ask);
  if (!Number.isFinite(px) || px <= 0) return { s, err: "Name a real number." };
  if (px === h0.sale.ask) return { s, err: "That is the number you are already asking." };

  const next = clone(s);
  const sale = next.holdings[bbl]!.sale!;
  const was = sale.ask;
  const cut = px < was;
  sale.ask = px;
  // A cut restarts the clock the market judges you on — a repriced listing is
  // a fresher listing, and that is most of why sellers cut.
  if (cut) sale.listedM = next.month;
  // Raising mid-campaign costs you the bidders who were close to the old ask.
  if (!cut && sale.bids?.length) {
    for (const b of sale.bids) {
      if (b.dropped) continue;
      if (b.price < px * 0.9 && rng(next) < 0.5) { b.dropped = true; b.note = "Left when the ask went up."; }
    }
  }
  if (!cut && sale.offer && sale.offer.price < px * 0.92 && rng(next) < 0.45) {
    delete sale.offer;
  }
  next.news.unshift({
    q: next.month, kind: cut ? "info" : "warn",
    text: cut
      ? `Cut the ask at ${rec.address} to $${(px / 1e6).toFixed(2)}M from $${(was / 1e6).toFixed(2)}M. The phone starts again — and everybody now knows you want out.`
      : `Raised the ask at ${rec.address} to $${(px / 1e6).toFixed(2)}M from $${(was / 1e6).toFixed(2)}M. Anyone who was close to the old number has other buildings to look at.`,
  });
  return { s: next, msg: cut ? "Repriced down." : "Repriced up." };
}
