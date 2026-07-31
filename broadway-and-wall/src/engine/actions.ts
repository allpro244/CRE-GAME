// Player actions: buy listed or off-market (cash / fixed / floating IO),
// approach owners with assemblage pressure, sell, renovate. Pure — each
// returns a new state or an error string, never mutates the input.
import type { Adjacency, ParcelTable } from "@/data/types";
import type { GameState, Holding } from "./types";
import { rng } from "./market";
import { assetValue, initialCondition, holdingValue, renovationCost, RENO_QUARTERS, noiYr } from "./value";
import { genRentRoll, isCommercial } from "./leasing";
import { PRODUCTS, originate, quote } from "./debt";

const CLOSING_PCT = 0.02;
const SALE_FRICTION = 0.03;

export type BuyProduct = "cash" | "fixed" | "float";

function clone(s: GameState): GameState {
  return JSON.parse(JSON.stringify(s));
}

export function buyQuote(s: GameState, parcels: ParcelTable, bbl: string, price: number, product: BuyProduct) {
  const rec = parcels[bbl];
  const closing = Math.round(price * CLOSING_PCT);
  if (product === "cash" || !rec) return { principal: 0, ratePct: 0, equity: price + closing };
  const prod = PRODUCTS.find((p) => p.id === product)!;
  const q = quote(s, prod, price, noiYr(rec, s.econ, initialCondition(rec)));
  return { principal: q.principal, ratePct: q.ratePct, equity: price - q.principal + closing };
}

function executePurchase(
  s: GameState, parcels: ParcelTable, bbl: string, price: number, product: BuyProduct, offMarket: boolean,
): { s: GameState; err?: string } {
  const rec = parcels[bbl];
  if (!rec) return { s, err: "Unknown parcel." };
  if (s.holdings[bbl]) return { s, err: "You already own it." };
  const bq = buyQuote(s, parcels, bbl, price, product);
  if (s.cash < bq.equity) {
    return { s, err: `This deal needs $${(bq.equity / 1e6).toFixed(2)}M ${product === "cash" ? "all-cash" : "of equity"} — you're short.` };
  }
  const next = clone(s);
  next.cash -= bq.equity;
  const holding: Holding = {
    bbl,
    boughtQ: next.quarter,
    costBasis: price + Math.round(price * CLOSING_PCT),
    loan: null,
    condition: initialCondition(rec),
    tenants: [],
    cfHistory: [],
  };
  if (product !== "cash") {
    const prod = PRODUCTS.find((p) => p.id === product)!;
    holding.loan = originate(next, prod, price, noiYr(rec, next.econ, holding.condition));
  }
  genRentRoll(next, rec, holding); // walk into the in-place rent roll
  next.holdings[bbl] = holding;
  next.listings = next.listings.filter((l) => l.bbl !== bbl);
  delete next.approaches[bbl];
  next.news.unshift({
    q: next.quarter, kind: "deal",
    text: `Deed recorded: ${rec.address} for $${(price / 1e6).toFixed(2)}M${holding.loan ? ` ($${(holding.loan.principal / 1e6).toFixed(1)}M ${holding.loan.product} at ${holding.loan.ratePct}%)` : ", all cash"}${offMarket ? " — off-market" : ""}.`,
  });
  return { s: next };
}

export function buyListing(s: GameState, parcels: ParcelTable, bbl: string, product: BuyProduct): { s: GameState; err?: string } {
  const listing = s.listings.find((l) => l.bbl === bbl);
  if (!listing) return { s, err: "That property is no longer on the market." };
  return executePurchase(s, parcels, bbl, listing.ask, product, false);
}

// ---- off-market: approach the owner ---------------------------------------
// Not everything is for sale. Refusal odds and premiums rise with assemblage
// pressure: the more neighbors you own, the harder the holdout squeezes.
export function assemblagePressure(s: GameState, adjacency: Adjacency, bbl: string): number {
  const nbrs = adjacency[bbl] ?? [];
  if (!nbrs.length) return 0;
  return nbrs.filter((n) => s.holdings[n]).length / nbrs.length;
}

export function approachOwner(
  s: GameState, parcels: ParcelTable, adjacency: Adjacency, bbl: string,
): { s: GameState; err?: string; refused?: boolean; ask?: number } {
  const rec = parcels[bbl];
  if (!rec) return { s, err: "Unknown parcel." };
  if (s.holdings[bbl]) return { s, err: "You own it." };
  if (s.listings.some((l) => l.bbl === bbl)) return { s, err: "It's already listed — hit the Market tab." };
  const prior = s.approaches[bbl];
  if (prior && s.quarter < prior.q + 4) {
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
    next.approaches[bbl] = { q: next.quarter, refused: true };
    next.news.unshift({ q: next.quarter, kind: "info", text: `${rec.address}: the owner isn't selling${pressure > 0.4 ? " — they know what you're assembling" : ""}.` });
    return { s: next, refused: true };
  }
  const premium = 1.06 + 0.5 * Math.pow(rng(next), 2) + 0.22 * pressure;
  const ask = Math.round(assetValue(rec, next.econ, initialCondition(rec)) * premium / 1000) * 1000;
  next.approaches[bbl] = { q: next.quarter, refused: false, ask };
  next.news.unshift({ q: next.quarter, kind: "info", text: `${rec.address}: the owner would take $${(ask / 1e6).toFixed(2)}M. The number holds for four quarters.` });
  return { s: next, ask };
}

export function buyOffMarket(s: GameState, parcels: ParcelTable, bbl: string, product: BuyProduct): { s: GameState; err?: string } {
  const a = s.approaches[bbl];
  if (!a || a.refused || !a.ask) return { s, err: "No live ask — approach the owner first." };
  if (s.quarter > a.q + 4) return { s, err: "That number expired." };
  return executePurchase(s, parcels, bbl, a.ask, product, true);
}

export function sellHolding(s: GameState, parcels: ParcelTable, bbl: string): { s: GameState; err?: string } {
  const h = s.holdings[bbl];
  if (!h) return { s, err: "You don't own that parcel." };
  if (h.renovatingUntilQ !== undefined && s.quarter < h.renovatingUntilQ) {
    return { s, err: "Can't sell mid-renovation — finish the work first." };
  }
  const rec = parcels[bbl];
  if (!rec) return { s, err: "Unknown parcel." };
  const gross = holdingValue(rec, s.econ, h);
  const proceeds = Math.round(gross * (1 - SALE_FRICTION)) - (h.loan?.balance ?? 0);
  const next = clone(s);
  next.cash += proceeds;
  delete next.holdings[bbl];
  next.lois = next.lois.filter((l) => l.bbl !== bbl);
  const gain = proceeds + (h.loan?.balance ?? 0) - h.costBasis;
  next.news.unshift({
    q: next.quarter, kind: "deal",
    text: `Sold ${rec.address} for $${(gross / 1e6).toFixed(2)}M — ${gain >= 0 ? "a gain" : "a loss"} of $${(Math.abs(gain) / 1e6).toFixed(2)}M against basis.`,
  });
  return { s: next };
}

export function startRenovation(s: GameState, parcels: ParcelTable, bbl: string): { s: GameState; err?: string } {
  const h = s.holdings[bbl];
  if (!h) return { s, err: "You don't own that parcel." };
  const rec = parcels[bbl];
  if (!rec || rec.class === "land" || !rec.bldgArea) return { s, err: "Nothing to renovate on this lot." };
  if (h.condition === "good") return { s, err: "Already in top condition." };
  if (h.renovatingUntilQ !== undefined) return { s, err: "Crews are already on site." };
  if (isCommercial(rec)) {
    const leased = h.tenants.reduce((sum, t) => sum + t.sf, 0);
    if (leased / rec.bldgArea > 0.35) {
      return { s, err: "Too much of the building is under lease to gut it — let the roll burn down below 35% first." };
    }
  }
  const cost = renovationCost(rec);
  if (s.cash < cost) return { s, err: `Renovation costs $${(cost / 1e6).toFixed(2)}M cash — you're short.` };
  const next = clone(s);
  next.cash -= cost;
  const nh = next.holdings[bbl];
  nh.renovatingUntilQ = next.quarter + RENO_QUARTERS;
  nh.tenants = []; // remaining tenants are bought out as part of the job
  if (rec.class === "multifamily") nh.occ = 0;
  next.lois = next.lois.filter((l) => l.bbl !== bbl);
  next.news.unshift({
    q: next.quarter, kind: "info",
    text: `Scaffolding up at ${rec.address} — $${(cost / 1e6).toFixed(2)}M gut renovation, ${RENO_QUARTERS} quarters.`,
  });
  return { s: next };
}

export { assetValue };
