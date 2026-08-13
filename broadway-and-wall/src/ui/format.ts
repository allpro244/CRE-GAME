export const usd = (n: number): string => {
  if (!Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  const sign = n < 0 ? "−$" : "$";
  if (a >= 1_000_000_000) return sign + (a / 1_000_000_000).toFixed(2) + "B";
  if (a >= 1_000_000) return sign + (a / 1_000_000).toFixed(2) + "M";
  if (a >= 10_000) return sign + Math.round(a / 1000) + "K";
  return sign + Math.round(a).toLocaleString();
};

export const sf = (n: number) => Number.isFinite(n) ? Math.round(n).toLocaleString() + " sf" : "—";
export const pct = (n: number) => Number.isFinite(n) ? n.toFixed(2) + "%" : "—";
