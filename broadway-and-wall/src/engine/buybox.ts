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
import type { ParcelRecord } from "@/data/types";
import type { GameState, BuiltClass, Econ } from "./types";
import { inPlace, landRead, resolveRec } from "./value";

/** Closing costs a buyer carries into basis on top of the ask. */
const CLOSING = 0.02;

/**
 * DOES THE DIRT PENCIL — the ask plus closing set against the trade's own
 * residual (landRead: what a builder can pay for this lot after cost, carry
 * and margin at today's rents). One answer, read by the buy box and by the
 * Marketplace's PENCILS chip alike.
 */
export function landPencils(rec: ParcelRecord, econ: Econ, ask: number): { pencils: boolean; builderPsf: number; askPsf: number } {
  if (!(rec.lotArea > 0) || !(ask > 0)) return { pencils: false, builderPsf: 0, askPsf: 0 };
  const lr = landRead(rec, econ);
  const askPsf = ask / rec.lotArea;
  return { pencils: lr.builder > 0 && askPsf * (1 + CLOSING) <= lr.builder, builderPsf: lr.builder, askPsf };
}

export interface BuyBox {
  /** Product types wanted; empty or absent means any. */
  uses?: BuiltClass[];
  /** Minimum going-in yield on the ask, %. */
  minCap?: number;
  /** Largest ticket, $. */
  maxAsk?: number;
  /** Land, but only a lot whose ask plus closing is inside a builder's residual. */
  land?: boolean;
}

export function buyBoxSet(b: BuyBox | undefined): boolean {
  return !!b && ((b.uses?.length ?? 0) > 0 || (b.minCap ?? 0) > 0 || (b.maxAsk ?? 0) > 0 || !!b.land);
}

/** Does this listing sit inside the box? True when no box is set. */
export function inBuyBox(s: GameState, parcels: ParcelTable, bbl: string, ask: number): boolean {
  const b = s.buyBox;
  if (!buyBoxSet(b)) return true;
  const rec = resolveRec(parcels, s, bbl);
  if (!rec) return false;
  if ((b!.maxAsk ?? 0) > 0 && ask > b!.maxAsk!) return false;
  // A lot is in the box only when land was asked for and the dirt pencils;
  // the yield floor does not apply — dirt has no income to test.
  if (rec.class === "land") return !!b!.land && landPencils(rec, s.econ, ask).pencils;
  // Land alone was asked for: a standing building is outside it.
  if (b!.land && !(b!.uses?.length) && !(b!.minCap ?? 0)) return false;
  if ((b!.uses?.length ?? 0) > 0 && !b!.uses!.includes(rec.class as BuiltClass)) return false;
  if ((b!.minCap ?? 0) > 0) {
    if (!(rec.bldgArea > 0) || !(ask > 0)) return false;
    const cap = (inPlace(rec, s, bbl, ask).noi / ask) * 100;
    if (!(cap >= b!.minCap!)) return false;
  }
  return true;
}
