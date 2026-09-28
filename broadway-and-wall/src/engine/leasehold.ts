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
// ONE PRICE, TWO READERS. The fee sells for the land's value; the ground rent
// is that price times the ground-lease yield (value.ts `groundYieldPct`). The
// building is then marked as its freehold value less that same rent at that
// same yield (`leaseholdGroundPv`), so the transaction moves value only by its
// costs. What the owner buys with those costs is liquidity, and what they
// give up is the land's appreciation and a rent that compounds at 2% whatever
// the building's own rents do.
//
// The fee buyer is not modelled as an owner on the map: the rent leaves the
// book, and when the leasehold is sold the next owner takes it on at a price
// that already carries it. Buying the land back is at the rent's value today.
import type { ParcelTable } from "@/data/types";
import type { GameState, Holding } from "./types";
import { cloneState, logBooks } from "./types";
import { bareLandRec, groundYieldPct, landValue, leaseholdGroundPv, ownedHoldingValueFromRec, resolveRec } from "./value";
import { stackPayoff } from "./debt";
import { fundCashNeed, fundableNow } from "./credit";
import { CAP_GAINS_RATE, TRANSFER_TAX } from "./actions";

/** Ninety-nine years: the ordinary term for a ground lease a lender will finance under. */
export const LEASEHOLD_TERM_M = 99 * 12;
/**
 * Fixed annual steps. Modern ground leases run either CPI or fixed bumps of
 * about 2% a year; fixed is the common institutional form and needs no index.
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
  if (rec.class === "land" || !rec.bldgArea) return "There is no building to keep — this is dirt. Sell it, or ground-lease it out.";
  if (h.groundLeased || s.groundLeases?.[h.bbl]) return "You are the ground lessor here already.";
  if (h.groundRentOut) return "The land under it is already sold.";
  if (h.jv) return "Your partner has consent on that — buy them out first.";
  if (h.fundOwned) return "The fund's documents do not allow selling the land out from under a vehicle deed.";
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
  const yieldPct = groundYieldPct(s.econ);
  const rentYr = Math.round(price * yieldPct / 100);
  const costs = Math.round(price * (TRANSFER_TAX + LEASEHOLD_DEAL_COST));
  const stack = stackPayoff(h, s.month);
  const payoff = stack.balance + stack.penalty;
  const valueBefore = ownedHoldingValueFromRec(s, rec, h);
  // The land's share of what you paid is the basis that leaves with it.
  const landBasis = Math.round(h.costBasis * Math.min(0.9, Math.max(0, price / Math.max(1, valueBefore))));
  const gain = price - costs - landBasis;
  const tax = Math.max(0, Math.round(gain * CAP_GAINS_RATE));
  const toOwner = price - costs - payoff - tax;
  const after = { ...h, groundRentOut: { holder: "", rentYr, stepPct: LEASEHOLD_STEP, startM: s.month, endM: s.month + LEASEHOLD_TERM_M, lastStepM: s.month, price } } as Holding;
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
  const stack = stackPayoff(h, next.month);
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
  };
  const addr = rec.address ?? bbl;
  next.news.unshift({
    q: next.month, kind: "deal",
    text: `Sold the land under ${addr} to ${holder} for $${q.price.toLocaleString()} and leased it back for 99 years `
      + `at $${q.rentYr.toLocaleString()} a year, rising 2% a year.`
      + (q.payoff > 0 ? ` The mortgage was retired from the proceeds.` : ""),
  });
  return { s: next, msg: `Land sold for $${q.price.toLocaleString()} — $${Math.round(q.toOwner).toLocaleString()} to you after costs${q.payoff > 0 ? ", the mortgage" : ""} and tax.` };
}

/** What the fee costs to buy back today: the ground rent at the ground yield, plus the transfer. */
export function landBuybackCost(s: GameState, h: Holding): number {
  const pv = leaseholdGroundPv(h, s.econ);
  return Math.round(pv * (1 + TRANSFER_TAX + LEASEHOLD_DEAL_COST));
}

/** Buy the land back and own the building freehold again. */
export function buyLandBack(
  s: GameState, parcels: ParcelTable, bbl: string,
): { s: GameState; err?: string; msg?: string } {
  const h0 = s.holdings[bbl];
  if (!h0?.groundRentOut) return { s, err: "You own the land here." };
  const cost = landBuybackCost(s, h0);
  if (fundableNow(s, parcels) < cost) return { s, err: `The fee costs $${cost.toLocaleString()} today — you cannot raise it.` };
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

/** The annual step, on each lease's own anniversary. Mutates `s`. */
export function tickLeaseholds(s: GameState): void {
  for (const h of Object.values(s.holdings)) {
    const g = h.groundRentOut;
    if (!g) continue;
    if (s.month - g.lastStepM >= 12) {
      g.rentYr = Math.round(g.rentYr * (1 + g.stepPct));
      g.lastStepM += 12;
    }
  }
}
