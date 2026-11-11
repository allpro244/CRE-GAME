// WHAT IS LEFT OF THE OLD LEASING LAW.
//
// This file was where a letter of intent came from: the city's tenant
// requirement each month as an aggregate, every vacant foot's share of it
// (marketing, quality, location, ask, competing supply), and odds a month for
// each of the player's buildings. Since 2026-11-11 a tour at the player's door
// is a firm that chose the building — its broker's shortlist, the same one the
// street is shown (streetRolls.ts shop) — and that law is deleted. What
// remains are two facts about a building the street and the desk both read.

import type { ParcelRecord } from "@/data/types";
import type { BuiltClass, Econ, Holding } from "./types";
import { demandIdx, managedRentPsfYr } from "./value";

const clampA = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** The occupancy this ADDRESS can hold. The pool of tenants who will take a
 *  given corner is finite and thins with the corner: a fringe building runs
 *  out of willing names in the high 70s, a prime one in the high 90s. Both
 *  the arrival odds and the size of the requirement that walks in are gated
 *  on it — pace was always graded by location; this is what grades the
 *  DESTINATION. */
export function supportableOcc(econ: Econ, rec: ParcelRecord, use?: BuiltClass): number {
  const d = demandIdx(rec.demandScore);
  // Pivoted on the CLASS's own mean, not the city's — a shed on the fringe is
  // in an ordinary industrial location, not a terrible office one.
  const cls = (use ?? rec.class) as BuiltClass;
  const pivot = econ.locIdxMeanBy?.[cls] ?? econ.locIdxMean ?? 0.62;
  // ONE-SIDED, and that matters more than the slope. A symmetric line through
  // the city mean sounds fairer and is wrong: it puts the ceiling at 94% for an
  // ORDINARY building, so every merely-average block in town started shedding
  // tenants at the roll, citywide vacancy climbed, industrial never let at all
  // and the player bot went insolvent inside fifty years. Nothing about a
  // perfectly good corner should stop it running full. What is true is the
  // other half: below the city's mean the pool of names willing to take the
  // address thins out fast, and by the worst corner in town it has run out
  // somewhere in the mid-seventies.
  return clampA(0.985 - 0.75 * Math.max(0, pivot - d), 0.70, 0.985);
}

/**
 * WHAT STALE SPACE SIGNS AT — the other half of the "Stale space" factor in
 * `leaseFactors`, and the half that makes it a cost rather than a gift.
 *
 * A floor that has been dark for years does not let at the same number as one
 * that came free last quarter. The agent cut the ask to move it, and the tenant
 * knows exactly how long that lobby has been empty. Same two-year half-life as
 * the arrival factor, because it is the same markdown seen from the other side,
 * bottoming a quarter under market — the observed 15-30% range for space that
 * has sat three years or more once free rent and allowances are counted.
 *
 * This is where passivity is actually paid for: the building fills, and it
 * fills at a rent it keeps for the whole of a ten-year term.
 */
export function staleDiscount(darkMs: number | undefined): number {
  const yrs = (darkMs ?? 0) / 12;
  if (yrs < 1) return 1;
  return 1 - 0.25 * (1 - Math.pow(0.5, (yrs - 1) / 2));
}

/**
 * THE ASK A NEW LEASE ACTUALLY SIGNS AGAINST.
 *
 * `managedRentPsfYr` is the undamaged number — stance, lobby, landmark.
 * Letters arrive at that times `staleDiscount`, because a floor that has
 * been dark for years does not let at last year's ask. The desk, the
 * parcel card and the letting panel all have to quote this one, or a
 * hired agent scores a marked-down letter against an unmarked ask and
 * passes every prospect on a building that has been empty for years.
 */
export function currentAskPsfYr(
  rec: ParcelRecord, econ: Econ, h: Holding, use?: BuiltClass,
): number {
  return managedRentPsfYr(rec, econ, h, use) * staleDiscount(h.darkMs);
}
