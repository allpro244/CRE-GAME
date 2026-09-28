/**
 * THE BUY BOX — a sponsor's standing acquisition criteria, the thing every
 * acquisitions desk hands its brokers: which product, at what going-in yield,
 * up to what ticket. Brokers rang with first looks on anything, and each one
 * stopped the clock as it lapsed (30–40 stops a run, 15 from one shop). With a
 * box set, only a first look inside it is a decision; the rest wait on the tape.
 *
 * The yield read is the tape's own: in-place NOI off the disclosed roll over
 * the ask (inPlace), the same figure the Marketplace sorts on.
 */
import type { ParcelTable } from "@/data/types";
import type { GameState, BuiltClass } from "./types";
import { inPlace, resolveRec } from "./value";

export interface BuyBox {
  /** Product types wanted; empty or absent means any. */
  uses?: BuiltClass[];
  /** Minimum going-in yield on the ask, %. */
  minCap?: number;
  /** Largest ticket, $. */
  maxAsk?: number;
}

export function buyBoxSet(b: BuyBox | undefined): boolean {
  return !!b && ((b.uses?.length ?? 0) > 0 || (b.minCap ?? 0) > 0 || (b.maxAsk ?? 0) > 0);
}

/** Does this listing sit inside the box? True when no box is set. */
export function inBuyBox(s: GameState, parcels: ParcelTable, bbl: string, ask: number): boolean {
  const b = s.buyBox;
  if (!buyBoxSet(b)) return true;
  const rec = resolveRec(parcels, s, bbl);
  if (!rec) return false;
  if ((b!.maxAsk ?? 0) > 0 && ask > b!.maxAsk!) return false;
  if ((b!.uses?.length ?? 0) > 0 && !b!.uses!.includes(rec.class as BuiltClass)) return false;
  if ((b!.minCap ?? 0) > 0) {
    if (rec.class === "land" || !(rec.bldgArea > 0) || !(ask > 0)) return false;
    const cap = (inPlace(rec, s, bbl, ask).noi / ask) * 100;
    if (!(cap >= b!.minCap!)) return false;
  }
  return true;
}
