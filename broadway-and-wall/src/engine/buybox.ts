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
import { inPlace, landRead, resolveRec, ownedHoldingNoiYr } from "./value";

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

/**
 * A BUY BOX WRITTEN FROM THE BOOK YOU ALREADY BOUGHT. Brokers' first looks
 * stop the clock as they lapse when no box is set — 124 of them in a fifty-
 * year playthrough, nearly all on product the player never bought. Nobody
 * should have to invent criteria from a blank form to stop that; the book is
 * the criteria. Product types are the ones held; the ticket is half again the
 * largest basis; the yield floor is the lower quartile of what the book earns
 * on what was paid for it, less a point (a box is a net, not a target).
 * Null with fewer than two income deeds — two is the least that says "this is
 * what I buy".
 */
export function suggestBuyBox(s: GameState, parcels: ParcelTable): BuyBox | null {
  const uses = new Set<BuiltClass>();
  const yields: number[] = [];
  let maxBasis = 0;
  for (const h of Object.values(s.holdings)) {
    const rec = resolveRec(parcels, s, h.bbl);
    if (!rec || rec.class === "land" || !(rec.bldgArea > 0) || h.groundLeased) continue;
    uses.add(rec.class as BuiltClass);
    maxBasis = Math.max(maxBasis, h.costBasis ?? 0);
    if ((h.costBasis ?? 0) > 0) yields.push((ownedHoldingNoiYr(s, parcels, h) / h.costBasis) * 100);
  }
  if (yields.length < 2 || !(maxBasis > 0)) return null;
  yields.sort((a, b) => a - b);
  const q1 = yields[Math.floor((yields.length - 1) * 0.25)];
  return {
    uses: [...uses],
    maxAsk: Math.round((maxBasis * 1.5) / 50_000) * 50_000,
    minCap: Math.max(0, Math.round((q1 - 1) * 4) / 4),
  };
}
