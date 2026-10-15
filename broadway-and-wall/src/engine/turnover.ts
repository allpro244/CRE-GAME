/**
 * GROSS LEASING TURNOVER, in a leaf module: bands.ts reads it, and importing it
 * from absorption.ts closed an import cycle (market → bands → absorption →
 * demand → acquire → actions → dev → market) that left the dev server a blank
 * page ("Cannot access 'REF_PIPE_SHARE' before initialization"). absorption.ts
 * re-exports it; the numbers are unchanged.
 */
import type { BuiltClass } from "./types";

/**
 * GROSS NEW-LEASE VOLUME, as a share of citywide stock per year.
 *
 * Not net absorption — that is the change in occupied space, and it is a small
 * residual of a much larger churn. In a real market five to ten per cent of
 * the stock signs a NEW lease every year (relocations, expansions, arrivals,
 * backfill) while net absorption is a point or two either way. Renewals in
 * place are excluded: an incumbent renewing is not in the market and is not
 * touring your building.
 *
 * Shops turn over fastest and sheds slower than the headline suggests, because
 * an industrial lease is long but a shed changes hands whole.
 */
// Rebased for the churn base moving stock -> OCCUPIED (ECONOMY.md): empty
// buildings do not generate move-outs, and the rebase keeps citywide letter
// volume bit-identical at natural vacancy (old x stock = new x occupied).
export const GROSS_TURNOVER: Record<BuiltClass, number> = {
  office: 0.099, retail: 0.079, industrial: 0.091, multifamily: 0,
};
