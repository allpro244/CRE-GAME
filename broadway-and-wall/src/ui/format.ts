export const usd = (n: number): string => {
  const a = Math.abs(n);
  const sign = n < 0 ? "−$" : "$";
  if (a >= 1_000_000_000) return sign + (a / 1_000_000_000).toFixed(2) + "B";
  if (a >= 1_000_000) return sign + (a / 1_000_000).toFixed(2) + "M";
  if (a >= 10_000) return sign + Math.round(a / 1000) + "K";
  return sign + Math.round(a).toLocaleString();
};

export const sf = (n: number) => Math.round(n).toLocaleString() + " sf";
export const pct = (n: number) => n.toFixed(2) + "%";

/** Remaining term on a lease, in the unit a person can read at a glance.
 *  Under two years that is months — "0.7 yrs left" next to "exp Sep 2000"
 *  was misread as 8.7, and WALT on the row above is already in years. */
export function termLeft(endM: number, now: number): string {
  const mo = endM - now;
  if (mo <= 0) return "holding over";
  if (mo < 24) return `${mo} mo left`;
  return `${(mo / 12).toFixed(1)} yrs left`;
}
