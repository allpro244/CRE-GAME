import type { GameState } from "@/engine/types";
import type { ParcelTable } from "@/data/types";
import { ownedHoldingValue, ownedContractNoiYr } from "@/engine/value";

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
