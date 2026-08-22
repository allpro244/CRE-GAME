/**
 * Price-slider math. Kept out of the React control so the band can be
 * tested without mounting a range input.
 *
 * THE FAULT. `widePriceBounds` used to take max(ask, appraisal) × 8. A $3M
 * listing with a $3.375M appraisal swept to $27M, so naming $2.75M meant
 * hunting a few pixels on a bar that also contained a trophy-tower bid.
 * Counters used half-to-double of that same high context.
 *
 * A purchase offer lives around the ASK. Appraisal is a mark, not the
 * range. Typed input can go wider than the track — the mouse should not.
 */

/** Step sized so $2.75M on a $3M listing is a click, not a pixel hunt. */
export function nicePriceStep(anchor: number): number {
  const a = Math.max(1, anchor);
  if (a >= 20_000_000) return 100_000;
  if (a >= 5_000_000) return 50_000;
  if (a >= 1_000_000) return 25_000;
  if (a >= 250_000) return 10_000;
  return 5_000;
}

export function formatUsdExact(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "−\u2060$" : "$";
  return sign + Math.round(Math.abs(n)).toLocaleString("en-US");
}

/** "$2,750,000", "2.75M", "2750k", "2750000" → 2_750_000. */
export function parsePriceInput(s: string): number {
  const t = s.trim().replace(/[$,\s]/g, "");
  if (!t) return NaN;
  const m = t.match(/^(-?[0-9]*\.?[0-9]+)\s*([kmb])?$/i);
  if (!m) return NaN;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return NaN;
  const suf = (m[2] ?? "").toLowerCase();
  const mult = suf === "b" ? 1e9 : suf === "m" ? 1e6 : suf === "k" ? 1e3 : 1;
  return n * mult;
}

export function widePriceBounds(anchor: number, appraisal = anchor) {
  const ask = Math.max(1, anchor);
  const mid = Math.max(1, appraisal);
  return {
    min: Math.max(1, Math.round(ask * 0.55)),
    max: Math.round(Math.max(ask * 1.25, mid * 1.10)),
    step: nicePriceStep(ask),
    typedMin: Math.max(1, Math.round(ask * 0.25)),
    typedMax: Math.round(Math.max(ask * 1.75, mid * 1.35)),
  };
}

export function counterPriceBounds(anchor: number, context = anchor) {
  const bid = Math.max(1, anchor);
  const ctx = Math.max(1, context);
  return {
    min: Math.max(1, Math.round(bid * 0.98)),
    max: Math.round(Math.max(bid * 1.30, ctx * 1.15)),
    step: nicePriceStep(Math.max(bid, ctx)),
    typedMin: Math.max(1, bid + 1),
    typedMax: Math.round(Math.max(bid * 1.60, ctx * 1.35)),
  };
}
