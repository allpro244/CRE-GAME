/**
 * THE DEAL WATERFALL — how one syndicated deal's cash splits between its
 * investors (the LPs) and the sponsor (the GP). CAPITAL_RAISING_PLAN.md §4.
 *
 * The method is the hurdle-account ("accretion") waterfall that real
 * operating agreements write: every hurdle is a balance the LPs are owed,
 * grown monthly at that hurdle's rate on what they put in and cut by what they
 * have been paid. A distribution walks the tiers in order:
 *
 *   1. the PREF, pari passu: every partner, GP co-invest included, is paid
 *      pro rata to its own pref balance (capital plus the pref on it) until
 *      all are whole;
 *   2. each promote tier: the LPs take their capital share of
 *      (1 − that tier's promote), the GP the rest, until the LPs' balance at
 *      the next hurdle is paid down to zero;
 *   3. above the last hurdle, the same split at the top promote.
 *
 * Because the balances carry the LPs' IRR position, the same function serves a
 * monthly operating distribution, a refinance, a sale and a hypothetical
 * liquidation (net worth), and the promote is earned only on returns already
 * delivered. A sponsor cannot take promote on gross revenue while sharing
 * costs pro rata — the caller nets a period's flows before calling (see
 * `syndicate.ts`), which is the money pump this order of operations closes.
 *
 * PURE. No imports beyond types; the ownership layer (`vehicles.ts`) reads it,
 * and that module must stay light (see its header).
 */
import type { Syndication } from "./types";

/** Grow every hurdle balance one month at its own rate. Mutates `w`. */
export function accrueMonth(w: Syndication): void {
  for (let k = 0; k < w.hurdles.length; k++) {
    if (w.lpBal[k] > 0) w.lpBal[k] *= Math.pow(1 + w.hurdles[k], 1 / 12);
  }
  if (w.gpBal > 0) w.gpBal *= Math.pow(1 + w.hurdles[0], 1 / 12);
}

/** Capital in from each side. Mutates `w`. */
export function contribute(w: Syndication, lp: number, gp: number): void {
  for (let k = 0; k < w.hurdles.length; k++) w.lpBal[k] += lp;
  w.gpBal += gp;
  w.lpCap += lp;
  w.gpCap += gp;
}

/** The LPs' share of capital contributed (the pro-rata share below the promote). */
export function lpCapShare(w: Syndication): number {
  const t = w.lpCap + w.gpCap;
  return t > 0 ? w.lpCap / t : 0;
}

function payLp(w: Syndication, a: number) {
  for (let k = 0; k < w.lpBal.length; k++) w.lpBal[k] = Math.max(0, w.lpBal[k] - a);
}

/**
 * Split `amount` (≥ 0) through the tiers. Mutates the balances in `w`; the
 * caller decides whether that is a real distribution or a what-if on a copy.
 * Returns whole dollars that sum to `amount`.
 */
export function distribute(w: Syndication, amount: number): { lp: number; gp: number } {
  if (!(amount > 0)) return { lp: 0, gp: 0 };
  let rest = amount, lp = 0;
  // 1. the pref, pari passu on each partner's own balance
  const due0 = w.lpBal[0] + w.gpBal;
  if (due0 > 0) {
    const x = Math.min(rest, due0);
    const a = x * (w.lpBal[0] / due0);
    lp += a;
    payLp(w, a);
    w.gpBal = Math.max(0, w.gpBal - (x - a));
    rest -= x;
  }
  const cap = lpCapShare(w);
  // 2. the promote tiers, each until the LPs reach the next hurdle
  for (let k = 1; k < w.hurdles.length && rest > 0; k++) {
    const f = (1 - w.promotes[k - 1]) * cap;
    if (!(f > 0) || !(w.lpBal[k] > 0)) continue;
    const z = Math.min(rest, w.lpBal[k] / f);
    lp += z * f;
    payLp(w, z * f);
    rest -= z;
  }
  // 3. above the last hurdle
  if (rest > 0) {
    const f = (1 - w.promotes[w.promotes.length - 1]) * cap;
    lp += rest * f;
    payLp(w, rest * f);
  }
  const lpR = Math.round(lp);
  return { lp: lpR, gp: amount - lpR };
}

/** A copy safe to run a what-if on. */
export function cloneWaterfall(w: Syndication): Syndication {
  return { ...w, lpBal: [...w.lpBal], lpFlows: [...w.lpFlows] };
}

/**
 * SETTLE THE PERIOD. `w.pending` is the net of every owner-side flow booked to
 * the deed since the last settlement. A surplus is distributed through the
 * waterfall; a shortfall is a capital call — the investors fund their
 * `lpShare` of it until their commitment is used up, and the sponsor funds the
 * rest, which is the completion guarantee every first-time sponsor signs.
 * Once the deed has left the book (`held` false) nobody calls the investors
 * for more: what is left to pay is the guarantor's.
 *
 * Mutates `w`. Returns the cash that moves to the sponsor's account (+, the
 * investors' call) or out of it (−, their distribution), and the parts.
 */
export function settlePeriod(w: Syndication, month: number, held: boolean): { cash: number; lp: number; gp: number } {
  const p = w.pending;
  w.pending = 0;
  w.settled += p;
  if (p > 0) {
    const { lp, gp } = distribute(w, p);
    w.lpDist += lp;
    w.gpDist += gp;
    if (lp) w.lpFlows.push(month, lp);
    return { cash: -lp, lp, gp };
  }
  if (p < 0) {
    const need = -p;
    const room = held ? Math.max(0, w.lpCommit - w.lpCalled) : 0;
    const lp = Math.min(room, Math.round(need * w.lpShare));
    contribute(w, lp, need - lp);
    w.lpCalled += lp;
    w.gpIn += need - lp;
    if (lp) w.lpFlows.push(month, -lp);
    return { cash: lp, lp: -lp, gp: -(need - lp) };
  }
  return { cash: 0, lp: 0, gp: 0 };
}

/**
 * WHAT THE SPONSOR'S POSITION IN THE DEAL IS WORTH TODAY, given `equity`, the
 * deed's equity at its mark (work in progress included). Settles the open
 * period on a copy (the sponsor's account holds the investors' share of a
 * surplus, or is owed their share of a shortfall), then liquidates the deal
 * at `equity` through the waterfall. Underwater, the investors' claim is
 * nothing and the deficit is the sponsor's, who holds the deed and its debt.
 *
 * Net worth adds this instead of the deed's equity: the sponsor's cash already
 * includes whatever the open period moved through it.
 */
export function sponsorPosition(w: Syndication, equity: number, month: number, held: boolean): number {
  const t = cloneWaterfall(w);
  const { cash } = settlePeriod(t, month, held);
  if (!(equity > 0)) return cash + equity;
  return cash + distribute(t, equity).gp;
}

/**
 * WHAT THE INVESTORS TAKE OF AN EXIT: `toOwners` reaching the deal's side of a
 * closing table, settled through the waterfall with whatever else is open
 * this period. Display only — the closing pays the sponsor's account and the
 * month's settlement pays the investors (syndicate.ts).
 */
export function investorsTakeOfExit(w: Syndication, toOwners: number, month: number): number {
  const t = cloneWaterfall(w);
  t.pending += toOwners;
  return Math.max(0, -settlePeriod(t, month, false).cash);
}

/**
 * WHAT A PROJECTION PROMISES THE INVESTORS. A deal pitched at a project IRR
 * pays its investors less than that once the sponsor's promote comes out, so
 * judging their realised IRR against the project's number would call a deal
 * delivered exactly on plan a miss. This runs the projection — one equity
 * cheque in, `(1 + projIrr)^years` out — through the same tiers `distribute`
 * pays: the pref in full, then each band above it net of that band's promote.
 * The investors' share of the equity cancels, so it is per dollar. Returns
 * their projected net IRR.
 */
export function lpNetIrr(projIrr: number, years: number, hurdles: number[], promotes: number[]): number {
  if (!(years > 0) || !(projIrr > -1) || !hurdles.length) return projIrr;
  const total = Math.pow(1 + projIrr, years);
  const bal = (h: number) => Math.pow(1 + h, years);
  let rest = total, lp = Math.min(rest, bal(hurdles[0]));
  rest -= lp;
  for (let k = 1; k < hurdles.length && rest > 0; k++) {
    const f = 1 - (promotes[k - 1] ?? 0);
    const need = Math.max(0, bal(hurdles[k]) - lp);
    if (!(f > 0) || !(need > 0)) continue;
    const z = Math.min(rest, need / f);
    lp += z * f;
    rest -= z;
  }
  if (rest > 0) lp += rest * (1 - (promotes[promotes.length - 1] ?? 0));
  return Math.pow(Math.max(1e-9, lp), 1 / years) - 1;
}

/**
 * Monthly IRR of a [month, amount, month, amount, …] series, annualised; null
 * when it has no sign change or does not converge. Bisection: robust, and the
 * series are short.
 */
export function seriesIrr(cf: number[]): number | null {
  if (cf.length < 4) return null;
  const m0 = cf[0];
  let pos = false, neg = false;
  for (let i = 1; i < cf.length; i += 2) { if (cf[i] > 0) pos = true; if (cf[i] < 0) neg = true; }
  if (!pos || !neg) return null;
  const npv = (r: number) => { let v = 0; for (let i = 0; i < cf.length; i += 2) v += cf[i + 1] / Math.pow(1 + r, cf[i] - m0); return v; };
  let lo = -0.99, hi = 1.0;
  let flo = npv(lo), fhi = npv(hi);
  if (flo * fhi > 0) return null;
  for (let it = 0; it < 200; it++) {
    const mid = (lo + hi) / 2, fm = npv(mid);
    if (Math.abs(fm) < 1e-6) { lo = hi = mid; break; }
    if (flo * fm <= 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  return Math.pow(1 + (lo + hi) / 2, 12) - 1;
}
