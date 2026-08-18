export const usd = (n: number): string => {
  if (!Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  // WORD JOINER between minus and dollar so a 62px table cell cannot split
  // "−$121K" into a bare dash over the number — the same lie as an empty
  // column. `"−" + usd(abs)` at the call site is the other half of that fault.
  const sign = n < 0 ? "−\u2060$" : "$";
  if (a >= 1_000_000_000) return sign + (a / 1_000_000_000).toFixed(2) + "B";
  if (a >= 1_000_000) return sign + (a / 1_000_000).toFixed(2) + "M";
  if (a >= 10_000) return sign + Math.round(a / 1000) + "K";
  return sign + Math.round(a).toLocaleString();
};

export const sf = (n: number) => Number.isFinite(n) ? Math.round(n).toLocaleString() + " sf" : "—";
export const pct = (n: number) => Number.isFinite(n) ? n.toFixed(2) + "%" : "—";

/** Remaining term on a lease, in the unit a person can read at a glance.
 *  Under two years that is months — "0.7 yrs left" next to "exp Sep 2000"
 *  was misread as 8.7, and WALT on the row above is already in years. */
export function termLeft(endM: number, now: number): string {
  const mo = endM - now;
  if (mo <= 0) return "holding over";
  if (mo < 24) return `${mo} mo left`;
  return `${(mo / 12).toFixed(1)} yrs left`;
}

/** A CHANGE in dollars, signed both ways. Delegates to usd() so a delta can
 *  never disagree with the level it was computed from — same breakpoints,
 *  same rounding, same word joiner holding the sign to the figure. The plus
 *  gets the joiner too: "+" orphaned on its own line reads as a footnote
 *  mark, not a gain. Zero prints signless — no movement is not a small win. */
export const usdSigned = (n: number): string => {
  if (!Number.isFinite(n)) return "—";
  return n > 0 ? "+\u2060" + usd(n) : usd(n);
};

/** A MOVE in a rate, in percentage points. A cap rate going 5.0% to 5.6%
 *  moved 0.6 pp; calling that 12% is how a spread widening gets mistaken for
 *  rent growth. One decimal, and the sign rides the ROUNDED figure so a hair
 *  under zero cannot print as "−0.0 pp". Real minus, same as usd(). */
export const pp = (n: number): string => {
  if (!Number.isFinite(n)) return "—";
  const r = Math.round(n * 10) / 10;
  const sign = r > 0 ? "+" : r < 0 ? "−" : "";
  return sign + Math.abs(r).toFixed(1) + " pp";
};

/** A duration in months, in the unit a person plans in. Under two years it
 *  stays in months — the same threshold termLeft() uses, for the same
 *  misreading — and past that it goes to whole years and months, dropping a
 *  zero remainder ("3 yr", never "3 yr 0 mo"). */
export function monthsWord(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const mo = Math.round(Math.abs(n));
  const sign = n < 0 && mo > 0 ? "−" : "";
  if (mo < 24) return `${sign}${mo} mo`;
  const yr = Math.floor(mo / 12);
  const rem = mo % 12;
  return rem === 0 ? `${sign}${yr} yr` : `${sign}${yr} yr ${rem} mo`;
}
