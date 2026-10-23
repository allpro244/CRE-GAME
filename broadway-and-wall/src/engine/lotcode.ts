// THE LOT CODE: what a district demands of a lot — its minimum area, width and
// yards, how much of it buildings may cover — read by a lot split (lotsplit.ts)
// and by the appraisal of a built parcel's excess land (value.ts excessLand).
import type { ParcelRecord } from "@/data/types";
import type { BuiltClass } from "./types";
import { MAX_COVERAGE } from "./proforma";

// ---------------------------------------------------------------- the code
export interface SplitZoneRule {
  /** minimum lot area, sf */
  minSf: number;
  /** minimum lot width at the street, ft */
  minFt: number;
  /** the side yard a building keeps from a new lot line, ft */
  sideFt: number;
  /** the most of the lot buildings may cover (the district's lot coverage maximum) */
  cov: number;
  /** a lot no deeper than this many times its width (nor wider than this many times its depth) */
  ratio: number;
  /** what kind of district, for the desk */
  family: string;
  src: string;
}
/**
 * MINIMUM LOTS BY DISTRICT [S]. Typical US code values for districts of the
 * character this engine gives each zone (its FAR, its use):
 *   C-4..C-8  high-density downtown commercial (FAR 8-30): no lot minimum in
 *             most downtown codes beyond the residential one — NYC ZR 23-32,
 *             1,700 sf and 18 ft for any residence in R6-R10 and their
 *             commercial equivalents; zero side yard (ZR 33-25, none required).
 *   C-1, C-2  main-street and general commercial (FAR 1-5): 2,500 sf and 25 ft,
 *             the 25-ft storefront lot of most Midwestern downtown districts.
 *   C-N       a neighbourhood shopping district: 10,000 sf and 75 ft, 10 ft side
 *             yards (typical suburban B-1 / C-N districts run 7,500-20,000 sf).
 *   R6, R8    dense residential (FAR 6-11): 1,700 sf and 18 ft, no side yard for
 *             attached buildings (ZR 23-32, 23-46).
 *   R4        the old town's residential, houses and small flats: 3,800 sf and
 *             40 ft with 5-ft side yards, NYC's rule for detached houses in R4
 *             (ZR 23-32, 23-461).
 *   R-1       suburban single-family: 7,500 sf and 60 ft, 7.5-ft side yards.
 *   R-2       two-family: 5,000 sf on 40 ft, 5-ft side yards (the plat desk's
 *             own SPLIT_MIN, citygen region/platdesign.mjs).
 *   M1        light industrial: 20,000 sf and 100 ft, 10-ft side yards (typical
 *             M-1 districts, 10,000-40,000 sf).
 *   I-1       an industrial park: an acre and 150 ft (landdev.ts isIndustrialLot,
 *             NAIOP business-park lots of two acres and up).
 * LOT COVERAGE: commercial districts downtown have none (a commercial ground
 * floor may run lot line to lot line, ZR 33-23); NYC's residential maxima are
 * 55% in R4 (ZR 23-141), 65% in R6 and 70% in R8 (ZR 23-153, interior lots);
 * suburban codes run 35% (R-1), 40% (R-2 and a neighbourhood business district,
 * whose parking takes the rest) and 50% for industry (the truck court and the
 * car park: landdev.ts I-1 carries its box at 35-50%). The building's lot is
 * held to the lesser of this and the engine's own new-building coverage
 * (proforma.ts MAX_COVERAGE).
 * DEPTH RATIO: suburban subdivision regulations commonly cap depth at three
 * times width; urban districts are platted in 20x100 and 25x100 lots (4-5:1),
 * so they cap at five.
 */
export const SPLIT_RULES: Record<string, SplitZoneRule> = {
  "C-4": { minSf: 1_700, minFt: 18, sideFt: 0, ratio: 5, cov: 1, family: "downtown", src: "NYC ZR 23-32 / 33-25" },
  "C-5": { minSf: 1_700, minFt: 18, sideFt: 0, ratio: 5, cov: 1, family: "downtown", src: "NYC ZR 23-32 / 33-25" },
  "C-6": { minSf: 1_700, minFt: 18, sideFt: 0, ratio: 5, cov: 1, family: "downtown", src: "NYC ZR 23-32 / 33-25" },
  "C-8": { minSf: 1_700, minFt: 18, sideFt: 0, ratio: 5, cov: 1, family: "downtown", src: "NYC ZR 23-32 / 33-25" },
  "C-1": { minSf: 2_500, minFt: 25, sideFt: 0, ratio: 5, cov: 1, family: "main street", src: "typical downtown business district, 25-ft lot" },
  "C-2": { minSf: 2_500, minFt: 25, sideFt: 0, ratio: 5, cov: 1, family: "main street", src: "typical downtown business district, 25-ft lot" },
  "C-N": { minSf: 10_000, minFt: 75, sideFt: 10, ratio: 3, cov: 0.4, family: "neighbourhood centre", src: "typical B-1 / C-N district" },
  R6: { minSf: 1_700, minFt: 18, sideFt: 0, ratio: 5, cov: 0.65, family: "dense residential", src: "NYC ZR 23-32 / 23-46" },
  R8: { minSf: 1_700, minFt: 18, sideFt: 0, ratio: 5, cov: 0.7, family: "dense residential", src: "NYC ZR 23-32 / 23-46" },
  R4: { minSf: 3_800, minFt: 40, sideFt: 5, ratio: 5, cov: 0.55, family: "residential", src: "NYC ZR 23-32 / 23-461, detached" },
  "R-1": { minSf: 7_500, minFt: 60, sideFt: 7.5, ratio: 3, cov: 0.35, family: "single-family", src: "typical suburban R-1" },
  "R-2": { minSf: 5_000, minFt: 40, sideFt: 5, ratio: 3, cov: 0.4, family: "two-family", src: "typical R-2 (platdesign SPLIT_MIN)" },
  M1: { minSf: 20_000, minFt: 100, sideFt: 10, ratio: 4, cov: 0.5, family: "industrial", src: "typical M-1" },
  "I-1": { minSf: 43_560, minFt: 150, sideFt: 10, ratio: 4, cov: 0.5, family: "industrial park", src: "NAIOP park lots; landdev isIndustrialLot" },
};
/** A district this table does not name: a middling suburban rule [S, typical]. */
const DEFAULT_RULE: SplitZoneRule = { minSf: 5_000, minFt: 50, sideFt: 5, ratio: 4, cov: 0.5, family: "other", src: "typical" };
export const splitRule = (zone: string): SplitZoneRule => SPLIT_RULES[zone] ?? DEFAULT_RULE;

/**
 * WHAT A MINOR SPLIT COSTS: a boundary survey and the new legal descriptions
 * ($2-5k on a town lot), title and counsel ($1.5-4k), the planning
 * department's application fee and county recording ($0.5-2k) [S, typical
 * 2020s fee schedules and survey quotes]: about $9k for two lots, $14k for four,
 * carried by the construction-cost index.
 */
export const MINOR_FIXED = 4_000;
export const MINOR_PER_LOT = 2_500;

/** The city's corner premium and demand curvature (citygen build.mjs cornerK, DEMAND_GAMMA): read, not chosen. */
export const CORNER_K = 1.18;
export const DEMAND_GAMMA = 1.05;

/** The strictest new-building coverage of the uses in a building (proforma.ts MAX_COVERAGE). */
export function coverageMax(rec: ParcelRecord): number {
  if (rec.mix) {
    let c = 1;
    for (const [k, v] of Object.entries(rec.mix)) if ((v ?? 0) > 0.03) c = Math.min(c, MAX_COVERAGE[k as BuiltClass] ?? 1);
    return c;
  }
  return MAX_COVERAGE[rec.class as BuiltClass] ?? 1;
}
