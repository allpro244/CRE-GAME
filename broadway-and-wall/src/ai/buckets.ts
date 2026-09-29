// NUMBERS INTO WORDS, FOR JEV.
//
// TypeSafe's own guidance for jev-1.13 (model-jaggedness): "Jev is not a
// calculator … keep the arithmetic in code … do the conversion in code and
// pass in either the computed number or a named bucket", and dates are read as
// text, so "compare in code". Every comparison the game wants Jev to weigh is
// therefore made HERE, by code, and handed over as a phrase that carries both
// the verdict and the numbers behind it:
//
//   yieldVs(0.074, 0.061, "the market cap rate")
//     → "well above the market cap rate (7.4% vs 6.1%)"
//
// The thresholds are stated next to each function. They are presentation
// boundaries — where "above" becomes "well above" — not economic parameters:
// nothing in the simulation reads them, and moving one changes only the word
// Jev sees, never a price. Pure; unit-tested in test/jev.mjs.

const pct1 = (x: number) => `${(x * 100).toFixed(1)}%`;
const pct0 = (x: number) => `${Math.round(x * 100)}%`;

/** $ with a sensible unit: $812K, $4.2M, $1.3B. */
export function money(x: number): string {
  const a = Math.abs(x), sgn = x < 0 ? "-" : "";
  if (a >= 1e9) return `${sgn}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${sgn}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${sgn}$${Math.round(a / 1e3)}K`;
  return `${sgn}$${Math.round(a)}`;
}

/**
 * A yield (or any rate) against a reference rate, in percentage points.
 * Thresholds: ±0.25pp is "about the same as"; ±1.0pp separates "above" from
 * "well above". A cap-rate spread of a point is the width of a typical
 * class-to-class gap, so it is the natural "well".
 */
export function yieldVs(y: number, ref: number, refName: string): string {
  const d = (y - ref) * 100;
  const w = d >= 1 ? "well above" : d >= 0.25 ? "above" : d > -0.25 ? "about the same as" : d > -1 ? "below" : "well below";
  return `${w} ${refName} (${pct1(y)} vs ${pct1(ref)})`;
}

/**
 * A price against a value. Thresholds: within ±3% is "at"; ±3–10% is
 * "slightly"; ±10–20% plain; beyond 20% "far". A 3% band is about the
 * round-trip of closing costs, so a price inside it is not a discount.
 */
export function priceVs(price: number, value: number, valueName = "appraisal"): string {
  if (!(value > 0)) return `${money(price)} (no ${valueName} available)`;
  const d = price / value - 1;
  const mag = Math.abs(d);
  const dir = d < 0 ? "below" : "above";
  const w = mag < 0.03 ? `at ${valueName}` : mag < 0.10 ? `slightly ${dir} ${valueName}` : mag < 0.20 ? `${dir} ${valueName}` : `far ${dir} ${valueName}`;
  return `${w} (${money(price)} vs ${money(value)}, ${d >= 0 ? "+" : ""}${pct0(d)})`;
}

/**
 * Debt service coverage against a lender minimum. "thin" is within 0.10x of
 * the minimum above it — one bad lease away from the covenant.
 */
export function dscrVs(dscr: number, min: number): string {
  const w = dscr < min ? "below the lender minimum" : dscr < min + 0.10 ? "thin" : dscr < min + 0.40 ? "adequate" : "comfortable";
  return `${w} — ${dscr.toFixed(2)}x vs lender minimum ${min.toFixed(2)}x`;
}

/** Leverage (debt / assets). Bands at 20 / 45 / 65 / 80%, the usual core / core-plus / value-add / opportunistic lines. */
export function leverage(ltv: number): string {
  if (!(ltv > 0)) return "no debt";
  const w = ltv < 0.20 ? "low" : ltv < 0.45 ? "moderate" : ltv < 0.65 ? "substantial" : ltv < 0.80 ? "high" : "very high";
  return `${w} (${pct0(ltv)} of assets)`;
}

/** A count of months to a date, computed in code, as a phrase. */
export function monthsAway(m: number): string {
  if (m <= 0) return "due now";
  if (m <= 6) return `within 6 months (${m} months)`;
  if (m <= 12) return `within a year (${m} months)`;
  if (m <= 36) return `in 1 to 3 years (${Math.round(m / 12 * 10) / 10} years)`;
  return `more than 3 years away (${Math.round(m / 12)} years)`;
}

/** How long something has been held. */
export function heldFor(m: number): string {
  if (m < 12) return `under a year (${m} months)`;
  const y = Math.round(m / 12 * 10) / 10;
  return m < 36 ? `${y} years (short)` : m < 96 ? `${y} years` : `${y} years (long)`;
}

/** Occupancy against the market's. ±3 points is "in line". */
export function occupancyVs(occ: number, market: number): string {
  const d = (occ - market) * 100;
  const w = d >= 3 ? "above the market" : d > -3 ? "in line with the market" : d > -10 ? "below the market" : "far below the market";
  return `${pct0(occ)} let, ${w} (${pct0(market)})`;
}

/** Location from the demand score (0-100). Quintiles of the scale. */
export function location(demand: number): string {
  const w = demand >= 80 ? "prime" : demand >= 60 ? "strong" : demand >= 40 ? "average" : demand >= 20 ? "weak" : "poor";
  return `${w} location (demand ${Math.round(demand)}/100)`;
}

/** Floor area, as a size class. */
export function size(sf: number): string {
  const w = sf < 10_000 ? "small" : sf < 50_000 ? "mid-size" : sf < 200_000 ? "large" : "very large";
  return `${w} (${Math.round(sf).toLocaleString("en-US")} sf)`;
}

/** Vacancy against its natural rate. ±1.5 points is "normal". */
export function vacancyVs(vac: number, natural: number): string {
  const d = (vac - natural) * 100;
  const w = d <= -1.5 ? "tight" : d < 1.5 ? "normal" : d < 5 ? "soft" : "glutted";
  return `${w} (${pct1(vac)} vacant vs ${pct1(natural)} normal)`;
}

/** The credit index (1 = normal lending). */
export function credit(ci: number): string {
  return ci >= 1.1 ? "lenders are eager" : ci >= 0.95 ? "credit is normal" : ci >= 0.8 ? "credit is tightening" : "credit is shut";
}

/** The cycle phase, as a sentence a principal would say. */
export function phase(p: string): string {
  switch (p) {
    case "recovery": return "recovery — values rising off the bottom";
    case "expansion": return "expansion — rents and values rising";
    case "peak": return "peak — values high, the turn is near";
    case "recession": return "recession — values falling";
    case "depression": return "depression — deep distress, few buyers";
    default: return p;
  }
}

/** Cash against a need. "can fund" leaves at least a 25% cushion over the need. */
export function cashVs(cash: number, need: number): string {
  if (!(need > 0)) return `${money(cash)} cash`;
  const r = cash / need;
  const w = r >= 1.25 ? "can fund it comfortably" : r >= 1 ? "can just fund it" : r >= 0.6 ? "would need the credit line" : "cannot fund it";
  return `${w} (${money(cash)} cash vs ${money(need)} needed)`;
}

/** A share of a whole (e.g. of the book). Bands at 10 / 25 / 50%. */
export function shareOf(x: number, whole: number, of: string): string {
  if (!(whole > 0)) return `none of ${of}`;
  const r = x / whole;
  const w = r < 0.10 ? "a small part" : r < 0.25 ? "a meaningful part" : r < 0.50 ? "a large part" : "most";
  return `${w} of ${of} (${pct0(r)})`;
}

/** Yield on cost against the required yield, for a development scheme. */
export function marginOnCost(yoc: number, req: number): string {
  const d = yoc - req;   // both in %
  const w = d < 0 ? "does not clear" : d < 0.25 ? "barely clears" : d < 1 ? "clears" : "clears comfortably";
  return `${w} the required yield (${yoc.toFixed(2)}% on cost vs ${req.toFixed(2)}% required)`;
}
