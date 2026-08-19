// HOW BIG THE TOWN IS, as a number the economy can read.
//
// The generator scales geography by `SIZES[id].k` (cities.mjs). Lot count and
// standing stock go roughly as k². Banks already size books off stock. Rival
// equity and permanent hold caps used to ignore k entirely — Hamlet and Great
// City opened with the same $2.5–10M wallets and the same $6M/$25M desk holds —
// so the big map felt empty of competition and the small one felt crowded with
// giants. One table, one scale, no new RNG draws.

export const SIZE_K: Record<string, number> = {
  hamlet: 0.55,
  town: 0.78,
  city: 1.0,
  metro: 1.45,
  giant: 2.0,
};

/**
 * The standard island's lot count, measured: `makeCity("somewhere", 1)` at the
 * default size cuts 1,298 lots. It is the denominator for a town that has no
 * declared size — see `sizeKOf`.
 */
const STANDARD_LOTS = 1298;

/**
 * Linear size factor from the start-menu choice (default City = 1).
 *
 * TWO SOURCES, ONE QUESTION, and which one applies is not a matter of taste.
 * The question is "how big is this market against the standard island". A
 * generated island DECLARES its answer — the player picked a size and the
 * generator multiplied every extent by that k — so the declared k is the
 * answer, and computing a second one from the stock would silently rebalance
 * five sizes that nobody asked to change. Measured, the two disagree by up to
 * 21%: lots per preset are 308 / 754 / 1298 / 2882 / 5885, which is 0.24 /
 * 0.58 / 1.00 / 2.22 / 4.53 of standard against k² of 0.30 / 0.61 / 1.00 /
 * 2.10 / 4.00, because a small island loses proportionally more of itself to
 * the esplanade and a big one less.
 *
 * A WRITTEN-DOWN CITY DECLARES NOTHING. Manhattan is not the standard island
 * times anything — it is a traced coastline at true scale, and `scaleCity` is
 * meaningless on it. So for a town with no preset the only honest answer is to
 * COUNT, which is what `cityLots` carries.
 */
export function sizeKOf(s: { citySize?: string; cityLots?: number } | null | undefined): number {
  const declared = SIZE_K[s?.citySize ?? "city"];
  if (declared !== undefined) return declared;
  const lots = s?.cityLots;
  return lots && lots > 0 ? Math.sqrt(lots / STANDARD_LOTS) : 1;
}

/**
 * Area / market scale — lot count and stock go as k².
 *
 * THE CEILING WAS LOAD-BEARING AND IS NOW A GUARD, which is the difference
 * between a rail that holds up the model and a rail that catches an absurdity.
 * It was 4, and Great City sits at exactly k² = 4.0 — resting ON the clamp, so
 * the largest city anybody could play had its rival equity and its per-asset
 * hold caps set by the guard rather than by its own size. A written-down
 * Manhattan makes that worse rather than revealing it: at 14,909 lots it wants
 * 11.5 and would have been handed 4, facing rivals and lenders sized for a town
 * a third its size.
 *
 * The ceiling is 24 now — about twice the largest city this game can build, so
 * it can still catch a nonsense value and cannot set one. Nothing about the
 * five presets moves: their k is declared and 4.0 is well inside the new bound.
 */
export function sizeAreaScale(s: { citySize?: string; cityLots?: number } | null | undefined): number {
  const k = sizeKOf(s);
  return Math.max(0.35, Math.min(24, k * k));
}
