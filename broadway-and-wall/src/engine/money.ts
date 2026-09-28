/**
 * DOLLARS IN THE ENGINE'S OWN SENTENCES.
 *
 * News lines, toasts and refusals were written with `$${(x / 1e6).toFixed(2)}M`
 * at each call site, so a $280K loss printed as "$0.28M" and a $10K break fee
 * as "$0.01M" beside a UI that prints the same quantities as "$280K" and
 * "$10K". This is the UI's usd() breakpoints (ui/format.ts) — the engine may
 * not import the UI — so a figure reads the same on the tape as on the desk.
 * Display only: nothing here feeds a number back into the simulation.
 */
export function money(n: number): string {
  if (!Number.isFinite(n)) return "$—";
  const a = Math.abs(n);
  const sign = n < 0 ? "\u2212$" : "$";
  if (a >= 1_000_000_000) return sign + (a / 1_000_000_000).toFixed(2) + "B";
  if (a >= 1_000_000) return sign + (a / 1_000_000).toFixed(2) + "M";
  if (a >= 10_000) return sign + Math.round(a / 1000) + "K";
  return sign + Math.round(a).toLocaleString("en-US");
}
