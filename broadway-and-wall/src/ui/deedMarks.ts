import type { GameState } from "@/engine/types";
import type { ParcelTable } from "@/data/types";
import { ownedHoldingValue, ownedContractNoiYr } from "@/engine/value";
import { allocatedAmount } from "@/engine/facility";

/**
 * ONE APPRAISAL PER DEED PER STATE. The Portfolio and Books tables re-ran a
 * full appraisal of every building on every render — opening a row's refinance
 * panel or ticking a bundle box re-appraised a thirty-deed book. The game state
 * is replaced, never mutated, between renders, so a mark keyed on the state
 * object is exactly the mark the engine would compute; a new month is a new
 * state and a fresh read.
 */
const cache = new WeakMap<GameState, Map<string, { v: number; noi: number }>>();

export function deedMark(s: GameState, parcels: ParcelTable, bbl: string): { v: number; noi: number } {
  let m = cache.get(s);
  if (!m) { m = new Map(); cache.set(s, m); }
  let r = m.get(bbl);
  if (!r) {
    const h = s.holdings[bbl];
    r = h ? { v: ownedHoldingValue(s, parcels, h), noi: ownedContractNoiYr(s, parcels, h) } : { v: 0, noi: 0 };
    m.set(bbl, r);
  }
  return r;
}

/**
 * WHAT ONE DEED PUTS IN THE ACCOUNT EACH MONTH: its NOI less its own paper —
 * the mortgage, any mezz, and its share of a pooled facility's payment. One
 * function for the Portfolio row and the map's hover card, so the two cannot
 * print different cash flows for the same building. (The top bar's CF / yr
 * also carries the firm's own lines — construction interest, the revolver,
 * overhead — which belong to no single deed.)
 */
export function deedDebtService(s: GameState, parcels: ParcelTable, bbl: string): { debt: number; dsMo: number } {
  const h = s.holdings[bbl];
  if (!h) return { debt: 0, dsMo: 0 };
  const facBal = allocatedAmount(s, parcels, bbl);
  const facPmt = s.facility && s.facility.balance > 0 ? s.facility.monthlyPmt * (facBal / s.facility.balance) : 0;
  return {
    debt: (h.loan?.balance ?? 0) + (h.mezz?.balance ?? 0) + facBal,
    dsMo: (h.loan?.monthlyPmt ?? 0) + (h.mezz?.monthlyPmt ?? 0) + facPmt,
  };
}
