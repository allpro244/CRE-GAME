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
import { inPlace, landRead, landValue, resolveRec, ownedHoldingNoiYr } from "./value";

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

export interface PencilSite {
  bbl: string;
  address: string;
  lotArea: number;
  /** The builder's scheme the land is priced on. */
  use: BuiltClass;
  floors: number;
  /** What the dirt trades at today, all of it — the parcel card's number. */
  value: number;
  /** $/sf of land a builder can pay, which on these lots is also the price. */
  builderPsf: number;
}

/**
 * THE LAND BROKER'S SITE LIST — vacant lots nobody is marketing where the
 * builder's residual sets the price: dirt that pencils for a developer who can
 * buy it at what it trades for. Each lot's parcel card already says so; this is
 * that answer for the whole town at once, which is what a developer pays a land
 * broker for. Measured on the reference city: 14-26 such lots stand at any time
 * against 440 vacant, and in 40 years the open tape carried almost none of them
 * (the best land listing planned at 1.01x), so without this a developer's only
 * way to find a site was to click lots one at a time.
 *
 * It says nothing the cards do not: the owner's number is still the owner's,
 * and most of them want more than the residual (approachOwner).
 */
export function sitesThatPencil(s: GameState, parcels: ParcelTable, limit = 12): PencilSite[] {
  const listed = new Set(s.listings.map((l) => l.bbl));
  const out: PencilSite[] = [];
  for (const bbl of Object.keys(parcels)) {
    const raw = parcels[bbl];
    if (!raw || raw.class !== "land" || (raw.bldgArea ?? 0) > 0) continue;
    if (s.holdings[bbl] || listed.has(bbl) || s.developments?.[bbl] || s.groundLeases?.[bbl]) continue;
    if (s.landmarks?.[bbl] !== undefined || s.civicLand?.[bbl] || s.merged?.[bbl]) continue;
    const rec = resolveRec(parcels, s, bbl);
    if (!rec || rec.class !== "land" || rec.bldgArea > 0 || !(rec.lotArea > 0)) continue;
    const lr = landRead(rec, s.econ);
    if (lr.winner !== "builder" || !(lr.builder > 0) || !lr.scheme) continue;
    out.push({
      bbl, address: rec.address, lotArea: rec.lotArea,
      use: lr.scheme.use, floors: lr.scheme.floors,
      value: Math.round(landValue(rec, s.econ)), builderPsf: lr.builder,
    });
  }
  return out.sort((a, b) => a.value - b.value).slice(0, limit);
}
