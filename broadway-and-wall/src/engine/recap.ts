/**
 * REFINANCE YOUR PARTNERS OUT AND KEEP THE BUILDING — the recap buyout
 * (CAPITAL_RAISING_PLAN.md §4.5).
 *
 * A common real exit: at stabilisation the sponsor buys its investors out at
 * what they would have been paid on a sale, and keeps 100% of the building.
 * The promote it earned becomes ownership rather than cash.
 *
 * THE PRICE IS WHAT A SALE WOULD HAVE PAID THEM. The deal's waterfall is run
 * on a hypothetical sale at an independent appraisal (the deed's mark), with
 * no selling costs because nobody pays a broker: investors take their
 * capital, their pref and their tiers exactly as if it had sold. Below
 * Proven they also ask a fairness premium (2–5% by band; shape parameter)
 * for selling to the person who knows the building best. Control changing
 * hands (the investors held more than half the capital) pays transfer tax on
 * the share transferred.
 *
 * FUNDED FROM CASH AND THE LINE. A refinance is the sponsor's to run first
 * (its proceeds go through the waterfall like any other) or after, as the
 * sole owner; the buyout itself is a cheque.
 *
 * AFTER: the investors count it as a realised exit (reputation.ts); the
 * purchased share's basis steps up to the price; and if the building is sold
 * within 24 months for more than 15% above the buyout appraisal, investors
 * read it as having been bought out cheap (−10, reputation.ts) — in life, the
 * lawsuit.
 */
import type { ParcelTable } from "@/data/types";
import type { GameState } from "./types";
import { cloneState, logBooks } from "./types";
import { ownedHoldingValue } from "./value";
import { fundableNow, fundCashNeed } from "./credit";
import { TRANSFER_TAX } from "./actions";
import { cloneWaterfall, distribute, lpCapShare, settlePeriod } from "./waterfall";
import { closeSyndication, settleSyndications } from "./syndicate";
import { playerTerms, type Band } from "./reputation";
import { money } from "./money";

/** The fairness premium investors ask a sponsor who buys them out, by band (§4.5: 2–5% below Proven). Shape parameter. */
export const RECAP_PREMIUM: Record<Band, number> = {
  "Toxic": 0.05, "Questioned": 0.05, "Unknown": 0.05, "Emerging": 0.035, "Proven": 0.02, "Institutional": 0, "Blue-chip": 0,
};
/** A deal is a recap candidate once its building has stabilised: a year after delivery (or two after formation, for a deed with no delivery). */
export const RECAP_SEASON_M = 12;

export interface RecapQuote { ok: boolean; why?: string; appraisal: number; equity: number; investorsTake: number; premium: number; transferTax: number; price: number; total: number }

export function recapQuote(s: GameState, parcels: ParcelTable, bbl: string): RecapQuote {
  const none = { appraisal: 0, equity: 0, investorsTake: 0, premium: 0, transferTax: 0, price: 0, total: 0 };
  const w = s.syndications?.[bbl];
  const h = s.holdings[bbl];
  if (!w || !h) return { ok: false, why: "There is no syndicate on that deed.", ...none };
  if (s.developments[bbl]) return { ok: false, why: "Not while it is under construction — investors sell a finished building, not a promise.", ...none };
  const seasoned = h.deliveredM !== undefined ? s.month - h.deliveredM >= RECAP_SEASON_M : s.month - w.formedM >= 2 * RECAP_SEASON_M;
  if (!seasoned) return { ok: false, why: "Not until it has stabilised — a year after delivery.", ...none };
  if (h.sale) return { ok: false, why: "It is on the market. Pull the listing first.", ...none };
  const appraisal = Math.round(ownedHoldingValue(s, parcels, h));
  const equity = Math.max(0, appraisal - (h.loan?.balance ?? 0) - (h.mezz?.balance ?? 0));
  // The open period settles first; then the waterfall runs on the appraisal.
  const t = cloneWaterfall(w);
  settlePeriod(t, s.month, true);
  const investorsTake = distribute(t, equity).lp;
  const rate = RECAP_PREMIUM[playerTerms(s).band];
  const premium = Math.round(investorsTake * rate);
  const price = investorsTake + premium;
  const transferTax = lpCapShare(w) > 0.5 ? Math.round(appraisal * lpCapShare(w) * TRANSFER_TAX) : 0;
  return { ok: true, appraisal, equity, investorsTake, premium, transferTax, price, total: price + transferTax };
}

export function recapBuyout(s: GameState, parcels: ParcelTable, bbl: string): { s: GameState; err?: string; msg?: string } {
  const q = recapQuote(s, parcels, bbl);
  if (!q.ok) return { s, err: q.why };
  if (fundableNow(s, parcels) < q.total) return { s, err: `Investor buyout costs ${money(q.total)}; exceeds cash and line.` };
  const next = cloneState(s);
  // Settle the open period at the real books first (a distribution or a call).
  settleSyndications(next, parcels, false, bbl);
  const w = next.syndications![bbl];
  const capShare = lpCapShare(w);
  const paid = fundCashNeed(next, parcels, q.total);
  if (paid < q.total) return { s, err: `Could not raise the ${money(q.total)}.` };
  logBooks(next, "lpDistributed", q.price);
  if (q.transferTax > 0) logBooks(next, "bought", q.transferTax, bbl);
  w.lpDist += q.price;
  w.lpFlows.push(next.month, q.price);
  // The purchased share's basis steps up to what was paid for it.
  const h = next.holdings[bbl];
  h.costBasis = Math.round(h.costBasis * (1 - capShare) + q.price);
  (next.recaps ??= []).push({ bbl, m: next.month, value: q.appraisal });
  closeSyndication(next, parcels, w, true);
  return { s: next, msg: `Bought your investors out for ${money(q.price)}${q.transferTax ? ` plus ${money(q.transferTax)} transfer tax` : ""}. 100% owned.` };
}
