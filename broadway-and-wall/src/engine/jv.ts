// A PARTNER IN ONE BUILDING — sell a minority stake, keep control.
//
// The fund is how a sponsor brings in partners across a book; this is the
// one-deed version, and it is how most small operators actually raise equity:
// sell a passive investor a share of a building, keep running it, and split
// what it makes. The partner owns `share` of the equity and nothing else:
//
//   - the monthly cash after debt splits pro rata, and so does a shortfall —
//     a partner funds its share of a bad month, of the fit-out cheque, of the
//     capital plan (a capital call, pro rata, which is what the operating
//     agreement says);
//   - an exit splits at the closing table after the debt, and each side is
//     taxed on its own share, because a partnership passes its income through;
//   - net worth carries your share of the equity, not the building;
//   - the big decisions — new debt or paying it down, a gut renovation, a
//     conversion, knocking it down, selling the land, pledging it to a
//     facility or a portfolio — need the partner, and the partner's answer is
//     to be bought out first. That is the consent clause in every JV, and the
//     reason minority capital is cheap to raise and expensive to live with.
//
// PRICE. A minority, non-controlling stake in one private building sells at a
// discount to its pro-rata share of equity — no control, no exit of its own.
// Appraisers take 10–25% for lack of control and marketability on stakes like
// this; 12% sits at the shallow end because the building is income-producing
// and the sponsor is paying the partner out on every exit. Buying the partner
// back costs the full pro-rata share: control is what you are buying.
import type { ParcelTable } from "@/data/types";
import type { GameState, Holding } from "./types";
import { cloneState, logBooks } from "./types";
import { ownedHoldingValueFromRec, resolveRec } from "./value";
import { fundCashNeed, fundableNow } from "./credit";
import { CAP_GAINS_RATE, RECAPTURE_RATE, TRANSFER_TAX } from "./actions";

/** Lack of control and marketability on a minority stake — see the note above. */
export const JV_MINORITY_DISCOUNT = 0.12;
/** Counsel on the operating agreement, both ways. About a point. */
export const JV_DEAL_COST = 0.01;
export const JV_SHARES = [0.25, 0.49];
const PARTNERS = ["Ashgrove Family Office", "Northbridge Pension", "Calloway Private Capital", "Merrow Endowment"];

export const JV_CONSENT = "Your partner has consent on that — buy them out first.";

/** The partner's share of this deed, 0 when there is none. */
export function jvShare(h: Holding | undefined): number {
  return h?.jv?.share ?? 0;
}

/** The refusal for a major decision on a JV deed, or null. */
export function jvConsent(h: Holding | undefined): string | null {
  return h?.jv ? JV_CONSENT : null;
}

/**
 * THE PARTNER FUNDS ITS SHARE of a capital outlay the owner has just paid in
 * full — a capital call, booked as partner equity in. Mutates `s`.
 */
export function partnerFunds(s: GameState, h: Holding, paid: number): void {
  const share = jvShare(h);
  if (!(share > 0) || !(paid > 0)) return;
  const call = Math.round(paid * share);
  if (call <= 0) return;
  s.cash += call;
  // On the deed's ledger too: the sponsor's equity in this building is its
  // cash net of the partner's — see GameState.deedCf.
  logBooks(s, "lpCalled", call, h.bbl);
}

/**
 * THE MONTH'S CASH, SPLIT. `cf` is the deed's cash after debt. The partner's
 * share of a surplus leaves as a distribution; its share of a shortfall comes
 * in as a call. Returns what stays with the owner.
 */
export function splitMonthCf(s: GameState, h: Holding, cf: number): number {
  const share = jvShare(h);
  if (!(share > 0) || cf === 0) return cf;
  const part = Math.round(cf * share);
  if (part > 0) logBooks(s, "lpDistributed", part, h.bbl);
  else if (part < 0) logBooks(s, "lpCalled", -part, h.bbl);
  return cf - part;
}

/** Proceeds reaching the owners at an exit, less the partner's share. */
export function ownersShareOfProceeds(h: Holding, toOwners: number): number {
  const share = jvShare(h);
  return share > 0 && toOwners > 0 ? toOwners - Math.round(toOwners * share) : toOwners;
}

function equityOf(s: GameState, parcels: ParcelTable, h: Holding): number {
  const rec = resolveRec(parcels, s, h.bbl);
  if (!rec) return 0;
  return ownedHoldingValueFromRec(s, rec, h) - (h.loan?.balance ?? 0) - (h.mezz?.balance ?? 0);
}

export interface StakeQuote { ok: boolean; why?: string; share: number; equity: number; price: number; costs: number; tax: number; toOwner: number; }

export function stakeQuote(s: GameState, parcels: ParcelTable, bbl: string, share: number): StakeQuote {
  const h = s.holdings[bbl];
  const rec = resolveRec(parcels, s, bbl);
  const none = { share, equity: 0, price: 0, costs: 0, tax: 0, toOwner: 0 };
  const no = (why: string): StakeQuote => ({ ok: false, why, ...none });
  if (!h || !rec) return no("You don't own that.");
  if (!JV_SHARES.includes(share)) return no("A minority stake: a quarter, or just under half.");
  if (rec.class === "land" || !rec.bldgArea || h.groundLeased) return no("A partner buys into a building with income, not dirt or a ground coupon.");
  if (h.jv) return no("There is a partner in it already.");
  if (h.fundOwned) return no("It is a fund deed — the fund's LPs are its partners.");
  if (s.facility?.bbls.includes(bbl)) return no("Pledged to your facility — release it there first.");
  if (s.workouts?.[bbl]) return no("Nobody buys into a building in workout.");
  if (h.sale) return no("It is on the market. Pull the listing first.");
  if (s.developments?.[bbl] || (h.renovatingUntilM !== undefined && s.month < h.renovatingUntilM)) return no("Not while it is under construction.");
  const equity = Math.round(equityOf(s, parcels, h));
  if (equity <= 0) return no("There is no equity in it to sell a share of.");
  const gross = Math.round(equity * share * (1 - JV_MINORITY_DISCOUNT));
  const costs = Math.round(gross * JV_DEAL_COST);
  const price = gross - costs;
  // The share of your basis and of the depreciation taken goes with the stake.
  const basisOut = share * h.costBasis, deprOut = share * (h.deprTaken ?? 0);
  const gain = price - (basisOut - deprOut);
  const recapture = Math.max(0, Math.min(deprOut, gain));
  const tax = Math.max(0, Math.round(recapture * RECAPTURE_RATE + Math.max(0, gain - recapture) * CAP_GAINS_RATE));
  return { ok: true, share, equity, price, costs, tax, toOwner: price - tax };
}

export function sellStake(
  s: GameState, parcels: ParcelTable, bbl: string, share: number,
): { s: GameState; err?: string; msg?: string } {
  const q = stakeQuote(s, parcels, bbl, share);
  if (!q.ok) return { s, err: q.why };
  const next = cloneState(s);
  const h = next.holdings[bbl]!;
  next.cash += q.price;
  logBooks(next, "sold", q.price, bbl);
  if (q.tax > 0) {
    next.cash -= q.tax;
    next.taxesPaid = (next.taxesPaid ?? 0) + q.tax;
    logBooks(next, "taxes", q.tax);
  }
  h.costBasis = Math.round(h.costBasis * (1 - share));
  if (h.deprTaken) h.deprTaken = Math.round(h.deprTaken * (1 - share));
  const partner = PARTNERS[Math.abs(bbl.split("").reduce((a, c) => a * 31 + c.charCodeAt(0), 11)) % PARTNERS.length];
  h.jv = { partner, share, sinceM: next.month, price: q.price };
  const addr = resolveRec(parcels, next, bbl)?.address ?? bbl;
  next.news.unshift({
    q: next.month, kind: "deal",
    text: `${partner} bought ${Math.round(share * 100)}% of ${addr} for $${q.price.toLocaleString()} — `
      + `${Math.round(JV_MINORITY_DISCOUNT * 100)}% under its share of the equity, the price of a seat with no vote. They fund their share of every call and take their share of every cheque.`,
  });
  return { s: next, msg: `Sold ${Math.round(share * 100)}% to ${partner} — $${Math.round(q.toOwner).toLocaleString()} to you after tax.` };
}

/** What buying the partner out costs today: the full pro-rata share of equity, plus counsel and transfer. */
export function buyoutCost(s: GameState, parcels: ParcelTable, h: Holding): number {
  const equity = Math.max(0, equityOf(s, parcels, h));
  return Math.round(equity * jvShare(h) * (1 + JV_DEAL_COST + TRANSFER_TAX));
}

export function buyOutPartner(
  s: GameState, parcels: ParcelTable, bbl: string,
): { s: GameState; err?: string; msg?: string } {
  const h0 = s.holdings[bbl];
  if (!h0?.jv) return { s, err: "There is no partner in it." };
  const cost = buyoutCost(s, parcels, h0);
  if (fundableNow(s, parcels) < cost) return { s, err: `Their share costs $${cost.toLocaleString()} today — you cannot raise it.` };
  const next = cloneState(s);
  const paid = fundCashNeed(next, parcels, cost);
  if (paid < cost) return { s, err: `Could not raise the $${cost.toLocaleString()}.` };
  logBooks(next, "bought", cost, bbl);
  const h = next.holdings[bbl]!;
  const partner = h.jv!.partner;
  h.costBasis += cost;
  delete h.jv;
  next.news.unshift({ q: next.month, kind: "deal", text: `Bought ${partner} out of ${resolveRec(parcels, next, bbl)?.address ?? bbl} for $${cost.toLocaleString()}. It is all yours again.` });
  return { s: next, msg: `Bought ${partner} out for $${cost.toLocaleString()}.` };
}
