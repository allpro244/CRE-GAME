// SELL THE LAND, KEEP THE BUILDING — the landlord's sale-leaseback.
//
// An occupier's sale-leaseback (sell your headquarters, lease it back) has no
// meaning for a player who never occupies anything. The landlord's version is
// the ground-lease sale-leaseback: sell the dirt under a building you own to a
// long-money buyer, lease it back for 99 years at a ground rent, and keep the
// building and every lease in it. It is how an owner takes out the land's
// share of value without a mortgage — no coupon reset, no balloon, no
// covenant test — in exchange for a senior rent that rises every year and is
// paid before anything else.
//
// ONE FUNCTION PRICES THE FEE YOU SELL, THE FEE YOU BUY BACK, AND EVERY CITY
// LEASED FEE (value.ts `groundLeasePv`). The fee sells for the land's value;
// the opening ground rent is the rate that makes the lease worth exactly that
// land (`groundRentRate`), so the transaction moves value only by its costs.
// The rent steps 2% a year and resets to market (the land as if vacant, times
// the ground rate) every twenty years, never down (GROUND_FMV_RESET_M). The
// building is marked as its freehold value less the leased fee, which carries
// the land: the lessee is short the dirt until the next reset, and buying the
// fee back costs what the fee is worth — the rent to the reset, then the land.
// What the owner buys with the costs is liquidity, and what they give up is
// the land's appreciation and a rent that compounds whatever the building's
// own rents do.
//
// It used to be a flat perpetuity at today's yield with no reset: measured on
// seed 12007, the land under one building rose to $6.26M in fifteen years and
// the fee bought back for $1.24M, and net worth with the leaseback passed the
// owner who never sold (playtest F4, 2026-11-27).
//
// The fee buyer is not modelled as an owner on the map: the rent leaves the
// book, and when the leasehold is sold the next owner takes it on at a price
// that already carries it.
import type { ParcelTable } from "@/data/types";
import type { GameState, Holding } from "./types";
import { cloneState, logBooks } from "./types";
import { bareLandRec, GROUND_FMV_RESET_M, groundRentRate, landValue, leaseholdGroundPv, ownedHoldingValueFromRec, resolveRec } from "./value";
import { stackPayoff } from "./debt";
import { fundCashNeed, fundableNow } from "./credit";
import { CAP_GAINS_RATE } from "./actions";
import { transferTaxRate } from "./citygov";
import { consentFor } from "./vehicles";

/** Ninety-nine years: the ordinary term for a ground lease a lender will finance under. */
export const LEASEHOLD_TERM_M = 99 * 12;
/**
 * Fixed annual steps. Modern ground leases run either CPI or fixed bumps of
 * about 2% a year; fixed is the common institutional form and needs no index.
 * [S~: fixed steps of 2% a year, or 10% every five years, are the usual form
 * in ground-lease practice guides; Safehold's 10-K (2021) pairs contractual
 * increases with CPI lookbacks capped at 3.0-3.5%.]
 */
export const LEASEHOLD_STEP = 0.02;
/** Counsel, title and the ground buyer's advisers on a fee sale — about a point, a fact of the trade. */
export const LEASEHOLD_DEAL_COST = 0.01;
const GROUND_BUYERS = ["Pelican Life Insurance", "Harrow Ground Trust", "Old Custom Land Co."];

export interface LeaseholdQuote {
  ok: boolean;
  why?: string;
  price: number;
  rentYr: number;
  yieldPct: number;
  costs: number;
  payoff: number;
  tax: number;
  toOwner: number;
  valueBefore: number;
  valueAfter: number;
}

function blocker(s: GameState, h: Holding | undefined, rec: ReturnType<typeof resolveRec>): string | null {
  if (!h || !rec) return "You don't own that.";
  if (rec.class === "land" || !rec.bldgArea) return "No building here; vacant land. Sell it or ground-lease it.";
  if (h.groundLeased || s.groundLeases?.[h.bbl]) return "You are the ground lessor here already.";
  if (h.groundRentOut) return "The land under it is already sold.";
  if (h.jv || h.fundOwned) return consentFor(s, h, "groundLease");
  if (s.facility?.bbls.includes(h.bbl)) return "Pledged to your facility — release it there first.";
  if (s.workouts?.[h.bbl]) return "The lender has a file open on it. Nobody buys the fee under a building in workout.";
  if (h.sale) return "It is on the market. Pull the listing first.";
  if (s.developments?.[h.bbl] || (h.renovatingUntilM !== undefined && s.month < h.renovatingUntilM)) return "Not while it is under construction.";
  return null;
}

/** What selling the land under this building would do, today. Mutates nothing. */
export function leaseholdQuote(s: GameState, parcels: ParcelTable, bbl: string): LeaseholdQuote {
  const h = s.holdings[bbl];
  const rec = resolveRec(parcels, s, bbl);
  const why = blocker(s, h, rec);
  const zero = { price: 0, rentYr: 0, yieldPct: 0, costs: 0, payoff: 0, tax: 0, toOwner: 0, valueBefore: 0, valueAfter: 0 };
  if (why || !h || !rec) return { ok: false, why: why ?? "Unknown parcel.", ...zero };
  const bare = bareLandRec(parcels, s, bbl) ?? rec;
  const price = Math.round(landValue(bare, s.econ));
  // The opening rent that makes the lease worth the land it sells: the 2%
  // steps to the first market reset, then the land. At target inflation the
  // step is the growth a buyer underwrites and this is the ground yield.
  const rentYr = Math.round(price * groundRentRate(s.econ, LEASEHOLD_STEP, 1, Math.min(GROUND_FMV_RESET_M, LEASEHOLD_TERM_M) / 12));
  const yieldPct = price > 0 ? 100 * rentYr / price : 0;
  const costs = Math.round(price * (transferTaxRate(s) + LEASEHOLD_DEAL_COST));
  const stack = stackPayoff(h, s.month, s.econ);
  const payoff = stack.balance + stack.penalty;
  const valueBefore = ownedHoldingValueFromRec(s, rec, h);
  // The land's share of what you paid is the basis that leaves with it.
  const landBasis = Math.round(h.costBasis * Math.min(0.9, Math.max(0, price / Math.max(1, valueBefore))));
  const gain = price - costs - landBasis;
  const tax = Math.max(0, Math.round(gain * CAP_GAINS_RATE));
  const toOwner = price - costs - payoff - tax;
  const after = { ...h, groundRentOut: {
    holder: "", rentYr, stepPct: LEASEHOLD_STEP, startM: s.month, endM: s.month + LEASEHOLD_TERM_M, lastStepM: s.month, price,
    resetEveryM: GROUND_FMV_RESET_M, lastResetM: s.month,
  } } as Holding;
  const valueAfter = ownedHoldingValueFromRec(s, rec, after);
  if (toOwner < 0) {
    return { ok: false, why: `The land sells for less than the mortgage, its break fee and the tax — $${Math.round(-toOwner).toLocaleString()} short. A fee buyer will not take it subject to your lender.`, price, rentYr, yieldPct, costs, payoff, tax, toOwner, valueBefore, valueAfter };
  }
  return { ok: true, price, rentYr, yieldPct, costs, payoff, tax, toOwner, valueBefore, valueAfter };
}

/** Sell the fee, lease the ground back for 99 years, keep the building. */
export function sellLandLeaseBack(
  s: GameState, parcels: ParcelTable, bbl: string,
): { s: GameState; err?: string; msg?: string } {
  const q = leaseholdQuote(s, parcels, bbl);
  if (!q.ok) return { s, err: q.why };
  const next = cloneState(s);
  const h = next.holdings[bbl]!;
  const rec = resolveRec(parcels, next, bbl)!;
  const stack = stackPayoff(h, next.month, next.econ);
  // Booked like a sale: the proceeds net of the loan they retire under `sold`,
  // the break fee as the debt cost it is, the gain's tax under `taxes`.
  // The deed stays on the book, so these land on its own equity ledger too.
  logBooks(next, "sold", q.price - q.costs - stack.balance, bbl);
  if (stack.penalty > 0) logBooks(next, "debtSvc", stack.penalty, bbl);
  next.cash += q.price - q.costs - stack.balance - stack.penalty;
  if (q.tax > 0) {
    next.cash -= q.tax;
    next.taxesPaid = (next.taxesPaid ?? 0) + q.tax;
    logBooks(next, "taxes", q.tax);
  }
  h.loan = null;
  if (h.mezz) h.mezz = null;
  const landBasis = Math.round(h.costBasis * Math.min(0.9, Math.max(0, q.price / Math.max(1, q.valueBefore))));
  h.costBasis = Math.max(0, h.costBasis - landBasis);
  const holder = GROUND_BUYERS[Math.abs(bbl.split("").reduce((a, c) => a * 31 + c.charCodeAt(0), 7)) % GROUND_BUYERS.length];
  h.groundRentOut = {
    holder, rentYr: q.rentYr, stepPct: LEASEHOLD_STEP, startM: next.month,
    endM: next.month + LEASEHOLD_TERM_M, lastStepM: next.month, price: q.price,
    resetEveryM: GROUND_FMV_RESET_M, lastResetM: next.month,
  };
  const addr = rec.address ?? bbl;
  next.news.unshift({
    q: next.month, kind: "deal",
    text: `Sold the land under ${addr} to ${holder} for $${q.price.toLocaleString()} and leased it back for 99 years `
      + `at $${q.rentYr.toLocaleString()} a year, rising 2% a year and reset to market every ${GROUND_FMV_RESET_M / 12} years (never down).`
      + (q.payoff > 0 ? ` The mortgage was retired from the proceeds.` : ""),
  });
  return { s: next, msg: `Land sold for $${q.price.toLocaleString()} — $${Math.round(q.toOwner).toLocaleString()} to you after costs${q.payoff > 0 ? ", the mortgage" : ""} and tax.` };
}

/**
 * What the fee costs to buy back today: what it is worth to its owner — the
 * rent to the next market reset, then the land at that reset (groundLeasePv,
 * on the lot as if vacant) — plus the transfer tax and legal.
 */
export function landBuybackCost(s: GameState, parcels: ParcelTable, h: Holding): number {
  if (!h.groundRentOut) return 0;
  const bare = bareLandRec(parcels, s, h.bbl);
  const land = bare ? landValue(bare, s.econ) : 0;
  const pv = leaseholdGroundPv(h, s.econ, land, s.month, resolveRec(parcels, s, h.bbl)?.bldgArea ?? 0);
  return Math.round(pv * (1 + transferTaxRate(s) + LEASEHOLD_DEAL_COST));
}

/** Buy the land back and own the building freehold again. */
export function buyLandBack(
  s: GameState, parcels: ParcelTable, bbl: string,
): { s: GameState; err?: string; msg?: string } {
  const h0 = s.holdings[bbl];
  if (!h0?.groundRentOut) return { s, err: "You own the land here." };
  const cost = landBuybackCost(s, parcels, h0);
  if (fundableNow(s, parcels) < cost) return { s, err: `Land buyback costs $${cost.toLocaleString()}; not enough cash or line.` };
  const next = cloneState(s);
  const paid = fundCashNeed(next, parcels, cost);
  if (paid < cost) return { s, err: `Could not raise the $${cost.toLocaleString()}.` };
  logBooks(next, "bought", cost, bbl);
  const h = next.holdings[bbl]!;
  const holder = h.groundRentOut!.holder;
  h.costBasis += cost;
  delete h.groundRentOut;
  next.news.unshift({ q: next.month, kind: "deal", text: `Bought the land under ${resolveRec(parcels, next, bbl)?.address ?? bbl} back from ${holder} for $${cost.toLocaleString()}. Freehold again.` });
  return { s: next, msg: `Bought the land back for $${cost.toLocaleString()}.` };
}

/**
 * The annual step, on each lease's own anniversary, and the market reset every
 * `resetEveryM` (GROUND_FMV_RESET_M): the rent goes to the land as if vacant
 * times the opening rate for the stretch ahead — the same rate the fee sold
 * at — unless the stepped rent is already above it (no-decrease clause). The
 * step clock restarts at the reset. Mutates `s`.
 */
export function tickLeaseholds(s: GameState, parcels: ParcelTable): void {
  for (const h of Object.values(s.holdings)) {
    const g = h.groundRentOut;
    if (!g) continue;
    if (s.month - g.lastStepM >= 12) {
      g.rentYr = Math.round(g.rentYr * (1 + g.stepPct));
      g.lastStepM += 12;
    }
    const every = g.resetEveryM ?? GROUND_FMV_RESET_M;
    if (s.month - (g.lastResetM ?? g.startM) < every || s.month >= g.endM) continue;
    const bare = bareLandRec(parcels, s, h.bbl);
    if (!bare) continue;
    const yrsLeft = (g.endM - s.month) / 12;
    const market = Math.round(landValue(bare, s.econ) * groundRentRate(s.econ, g.stepPct, 1, Math.min(every / 12, yrsLeft)));
    const old = g.rentYr;
    g.rentYr = Math.max(old, market);
    g.lastResetM = s.month;
    g.lastStepM = s.month;
    const addr = resolveRec(parcels, s, h.bbl)?.address ?? h.bbl;
    s.news.unshift({
      q: s.month, kind: g.rentYr > old ? "warn" : "info",
      text: g.rentYr > old
        ? `Ground rent under ${addr} reset to market by ${g.holder}: $${old.toLocaleString()} → $${g.rentYr.toLocaleString()} a year (${every / 12}-year review).`
        : `Ground rent under ${addr} reviewed at market by ${g.holder}; stays $${old.toLocaleString()} a year (no-decrease clause).`,
    });
  }
}
