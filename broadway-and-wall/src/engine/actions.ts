// Player actions: buy listed or off-market (cash / fixed / floating IO),
// approach owners with assemblage pressure, sell, renovate. Pure — each
// returns a new state or an error string, never mutates the input.
import type { Adjacency, ParcelTable } from "@/data/types";
import type { GameState, Holding } from "./types";
import { monthLabel } from "./types";
import { rng, rrange } from "./market";
import { assetValue, initialCondition, holdingValue, renovationCost, RENO_MONTHS, noiYr, resolveRec } from "./value";
import { genRentRoll, isCommercial } from "./leasing";
import { PRODUCTS, originate, quote } from "./debt";

const CLOSING_PCT = 0.02;
const SALE_FRICTION = 0.03;
export const CAP_GAINS_RATE = 0.2;   // on gains over depreciated basis
export const EXCHANGE_WINDOW_M = 6;  // 1031: redeploy within six months or the tax comes due

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
    boughtM: next.month,
    costBasis: price + Math.round(price * CLOSING_PCT),
    assessed: price, // the sale reassesses the property at the deal price
    loan: null,
    condition: initialCondition(rec),
    tenants: [],
    cfHistory: [],
  };
  if (product !== "cash") {
    const prod = PRODUCTS.find((p) => p.id === product)!;
    holding.loan = originate(next, prod, price, noiYr(rec, next.econ, holding.condition));
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
  next.listings = next.listings.filter((l) => l.bbl !== bbl);
  delete next.approaches[bbl];
  next.news.unshift({
    q: next.month, kind: "deal",
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
  if (prior && s.month < prior.q + 4) {
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
  next.news.unshift({ q: next.month, kind: "info", text: `${rec.address}: the owner would take $${(ask / 1e6).toFixed(2)}M. The number holds for four quarters.` });
  return { s: next, ask };
}

export function buyOffMarket(s: GameState, parcels: ParcelTable, bbl: string, product: BuyProduct): { s: GameState; err?: string } {
  const a = s.approaches[bbl];
  if (!a || a.refused || !a.ask) return { s, err: "No live ask — approach the owner first." };
  if (s.month > a.q + 4) return { s, err: "That number expired." };
  return executePurchase(s, parcels, bbl, a.ask, product, true);
}

// Selling is a process, not a button: list at an ask, wait for offers, and
// decide. Overprice it and the phone stays quiet.
export function listForSale(s: GameState, parcels: ParcelTable, bbl: string, ask: number): { s: GameState; err?: string } {
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

// What a sale nets and owes: gain runs against depreciated basis (that's
// recapture doing its work), taxed at 20% — unless it rides a 1031.
export function saleTaxQuote(h: Holding, price: number): { net: number; gain: number; tax: number } {
  const net = Math.round(price * (1 - SALE_FRICTION));
  const adjBasis = h.costBasis - (h.deprTaken ?? 0);
  const gain = net - adjBasis;
  return { net, gain, tax: Math.round(Math.max(0, gain) * CAP_GAINS_RATE) };
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
  next.cash += net - (h.loan?.balance ?? 0);
  if (exchange) {
    next.exchange = { deferredTax: tax, rolledGain: gain, minPrice: offer.price, deadlineM: next.month + EXCHANGE_WINDOW_M };
  } else if (tax > 0) {
    next.cash -= tax;
    next.taxesPaid = (next.taxesPaid ?? 0) + tax;
  }
  delete next.holdings[bbl];
  next.lois = next.lois.filter((l) => l.bbl !== bbl);
  next.news.unshift({
    q: next.month, kind: "deal",
    text: `Closed: ${rec.address} at $${(offer.price / 1e6).toFixed(2)}M — ${gain >= 0 ? "a gain" : "a loss"} of $${(Math.abs(gain) / 1e6).toFixed(2)}M against basis`
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
export function tickSales(s: GameState, parcels: ParcelTable) {
  for (const h of Object.values(s.holdings)) {
    const sale = h.sale;
    if (!sale) continue;
    if (sale.offer && s.month > sale.offer.expiresM) {
      delete sale.offer;
      continue;
    }
    const rec = resolveRec(parcels, s, h.bbl);
    if (!rec) continue;
    if (sale.offer) {
      const value = holdingValue(rec, s.econ, h);
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
    const value = holdingValue(rec, s.econ, h);
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
    if (rng(s) < base * priceFactor) {
      if (rng(s) < 0.5) {
        s.news.unshift({ q: s.month, kind: "info", text: `Sold: ${rec.address} went to another buyer at $${(li.ask / 1e6).toFixed(2)}M. You watched it happen.` });
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
