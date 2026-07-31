// Player actions: buy (all-cash or financed), sell, renovate. Pure — each
// returns a new state or an error string, never mutates the input.
import type { ParcelTable } from "@/data/types";
import type { GameState, Holding } from "./types";
import { assetValue, initialCondition, holdingValue, renovationCost, RENO_QUARTERS } from "./value";

const CLOSING_PCT = 0.02;      // legal, transfer, diligence
const SALE_FRICTION = 0.03;    // broker + transfer on exit
export const LOAN_LTV = 0.65;
export const LOAN_SPREAD = 1.6; // over the index, pct
const LOAN_AMORT_YEARS = 30;

function clone(s: GameState): GameState {
  return JSON.parse(JSON.stringify(s));
}

function quarterlyPayment(principal: number, ratePct: number, years: number): number {
  const i = ratePct / 100 / 4;
  const n = years * 4;
  return (principal * i) / (1 - Math.pow(1 + i, -n));
}

export function loanQuote(s: GameState, price: number) {
  const principal = Math.round(price * LOAN_LTV);
  const ratePct = +(s.econ.indexRate + LOAN_SPREAD).toFixed(2);
  return { principal, ratePct, quarterlyPmt: Math.round(quarterlyPayment(principal, ratePct, LOAN_AMORT_YEARS)) };
}

export function buyListing(
  s: GameState, parcels: ParcelTable, bbl: string, financed: boolean,
): { s: GameState; err?: string } {
  const listing = s.listings.find((l) => l.bbl === bbl);
  if (!listing) return { s, err: "That property is no longer on the market." };
  const rec = parcels[bbl];
  if (!rec) return { s, err: "Unknown parcel." };
  const price = listing.ask;
  const closing = Math.round(price * CLOSING_PCT);
  const quote = financed ? loanQuote(s, price) : null;
  const equityNeeded = price - (quote?.principal ?? 0) + closing;
  if (s.cash < equityNeeded) {
    return { s, err: `Not enough cash — this deal needs $${(equityNeeded / 1e6).toFixed(2)}M ${financed ? "of equity" : "all-cash"}.` };
  }
  const next = clone(s);
  next.cash -= equityNeeded;
  const holding: Holding = {
    bbl,
    boughtQ: next.quarter,
    costBasis: price + closing,
    loan: quote ? { principal: quote.principal, balance: quote.principal, ratePct: quote.ratePct, quarterlyPmt: quote.quarterlyPmt, originQ: next.quarter } : null,
    condition: initialCondition(rec),
    cfHistory: [],
  };
  next.holdings[bbl] = holding;
  next.listings = next.listings.filter((l) => l.bbl !== bbl);
  next.news.unshift({
    q: next.quarter, kind: "deal",
    text: `Deed recorded: ${rec.address} for $${(price / 1e6).toFixed(2)}M${quote ? ` (${Math.round(LOAN_LTV * 100)}% LTV at ${quote.ratePct}%)` : ", all cash"}.`,
  });
  return { s: next };
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
  const cost = renovationCost(rec);
  if (s.cash < cost) return { s, err: `Renovation costs $${(cost / 1e6).toFixed(2)}M cash — you're short.` };
  const next = clone(s);
  next.cash -= cost;
  next.holdings[bbl] = { ...h, renovatingUntilQ: next.quarter + RENO_QUARTERS };
  next.news.unshift({
    q: next.quarter, kind: "info",
    text: `Scaffolding up at ${rec.address} — $${(cost / 1e6).toFixed(2)}M gut renovation, ${RENO_QUARTERS} quarters.`,
  });
  return { s: next };
}

export { assetValue };
