/**
 * THE FUND — LP capital that is not yours.
 *
 * Second cash account: `s.fund.cash` is vehicle cash; `s.cash` remains GP
 * liquidity. The promote is a transfer between them (combined Δcash = 0), so
 * conserve on (cash + fund.cash) stays honest. See PRINCIPAL_CALLS.md #4 and
 * HANDOFF_PRINCIPAL.md §7.
 *
 * Calibrated industry constants (cited):
 *   pref 8% — typical closed-end CRE preferred return
 *   promote 20% — standard promote over pref
 *   investment period 5y / life 10y — common closed-end shape
 */
import type { GameState } from "./types";
import { cloneState, logBooks, monthLabel } from "./types";
import { markSponsor, sponsorStanding } from "./sponsor";

/** Preferred return — annual, accrued on contributed capital. Industry constant. */
export const FUND_PREF = 0.08;

/** Promote over pref — GP catch-up share of profits. Industry constant. */
export const FUND_PROMOTE = 0.20;

/** Investment period (months). Shape: typical closed-end CRE. */
export const FUND_INVEST_M = 60;

/** Fund life (months). Shape: ten-year closed-end. */
export const FUND_LIFE_M = 120;

/** GP co-invest as share of commitments. Shape: 2–5% practice; mid. */
export const FUND_GP_COINVEST = 0.03;

export interface PlayerFund {
  /** Vintage month. */
  raisedM: number;
  /** Total LP + GP commitments. */
  size: number;
  /** Still uncalled. */
  uncalled: number;
  /** Vehicle cash — second account. */
  cash: number;
  /** Cumulative capital called (LP + GP). */
  called: number;
  /** Cumulative distributions to LPs (ex-promote). */
  distributed: number;
  /** Promote paid to GP to date. */
  promotePaid: number;
  /** Pref accrued unpaid (simplified). */
  prefAccrued: number;
  /** Contributed capital already returned, LP and GP alike. Promote waits for all of it. */
  capReturned?: number;
  investEndM: number;
  lifeEndM: number;
  pref: number;
  promote: number;
  gpCommit: number;
  /** Life settled — remaining cash distributed, outcome recorded. */
  settled?: boolean;
  /** True when LPs did not get their capital back. Blocks the next raise. */
  failed?: boolean;
  /**
   * THE EXTENSION. A fund whose life ends with buildings still in it does not
   * vanish on the date: LPAs grant the GP extensions to sell out (two one-year
   * extensions is the market norm). Until this month the vehicle keeps
   * operating and selling; at it, whatever is left is bought in by the sponsor
   * at NAV (see windDownFund in sim.ts).
   */
  extendedTo?: number;
}

/** Two one-year extensions — the common LPA term for a closed-end real estate fund. */
export const FUND_EXTENSION_M = 24;

/** Live vehicle still inside its life (not yet settled). */
export function fundIsLive(s: GameState): boolean {
  return !!s.fund && !s.fund.settled && s.month < s.fund.lifeEndM;
}

/** Purchases may draw vehicle cash during the investment period. */
export function fundCanBuy(s: GameState): boolean {
  return !!s.fund && !s.fund.settled && s.month <= s.fund.investEndM && s.fund.cash > 0;
}

/**
 * Can the street back a first/next fund? Earned, never a menu — standing,
 * phase, and a minimum track record of realised exits.
 */
export function fundRaiseQuote(s: GameState): {
  ok: boolean;
  size: number;
  reason: string;
} {
  if (s.fundFailedM !== undefined) {
    return {
      ok: false, size: 0,
      reason: "Nobody will back you again. The last vehicle did not return capital.",
    };
  }
  if (s.fund && !s.fund.settled && s.month < s.fund.lifeEndM) {
    return { ok: false, size: 0, reason: "You already have a live fund." };
  }
  const st = sponsorStanding(s);
  if (!st.institutional) {
    return { ok: false, size: 0, reason: `LPs will not back you while the street reads "${st.label}".` };
  }
  const phase = s.econ.phase;
  if (phase === "recession" || phase === "depression") {
    return { ok: false, size: 0, reason: "Nobody raised a real estate fund in a crunch. Wait for the thaw." };
  }
  const exits = (s.exits ?? []).filter((e) => !e.forced && e.gain > 0).length;
  if (exits < 2) {
    return { ok: false, size: 0, reason: "Realised returns come first — LPs want two clean exits on the record." };
  }
  // Size from standing and phase — not a menu. Cleaner mark → larger raise.
  const clean = Math.max(0, 1.6 - st.mark);
  const base = 8_000_000 + clean * 25_000_000;
  const phaseMult = phase === "expansion" ? 1.15 : phase === "peak" ? 0.85 : 1;
  const size = Math.round(base * phaseMult / 100_000) * 100_000;
  return { ok: true, size, reason: `A ${monthLabel(s.month)} vintage of $${(size / 1e6).toFixed(0)}M will clear.` };
}

/** Close a fund — commitments, GP co-invest cheque, uncalled reserve. */
export function raiseFund(s: GameState): { s: GameState; err?: string } {
  const q = fundRaiseQuote(s);
  if (!q.ok) return { s, err: q.reason };
  const next = cloneState(s);
  const gpCommit = Math.round(q.size * FUND_GP_COINVEST);
  // CASH ONLY, AND ON PURPOSE. Nothing is spent here — the co-invest moves
  // from `s.cash` into `s.fund.cash`, so this is not a cost the revolver can
  // bridge, it is liquidity being CONVERTED into a ten-year locked commitment
  // in a vehicle the GP cannot unwind. A revolver is callable at the bank's
  // option and shrinks with net worth in exactly the quarter a fund is
  // underwater; funding a decade of illiquidity out of it is the duration
  // mismatch that ends firms, and it would let a sponsor with no capital at
  // all raise a vehicle on borrowed skin. Two clean exits and real cash in the
  // account is what the LPs are buying. The vehicle's own purchases are
  // likewise fenced to `fund.cash` in `executePurchase`, for the same reason
  // from the other side.
  if (next.cash < gpCommit) {
    return { s, err: `GP co-invest is $${(gpCommit / 1e6).toFixed(2)}M and you do not have it.` };
  }
  // First close: call GP co-invest + ~40% of LP immediately into the vehicle;
  // rest sits uncalled. Shape: 30–50% reserve practice (rivals.ts).
  const lpCommit = q.size - gpCommit;
  const uncalledShare = 0.40;
  const lpCalled0 = Math.round(lpCommit * (1 - uncalledShare));
  const gpCalled0 = gpCommit; // GP funds at close
  next.cash -= gpCalled0;
  logBooks(next, "lpCalled", lpCalled0); // LP equity in — not income
  // GP co-invest is a transfer from GP cash into the vehicle — combined
  // liquidity unchanged for the GP chip, but fund.cash rises. Book the LP
  // call only as lpCalled; GP move is cash→fund.cash with no income bucket.
  const fundCash = lpCalled0 + gpCalled0;
  next.fund = {
    raisedM: next.month,
    size: q.size,
    uncalled: lpCommit - lpCalled0,
    cash: fundCash,
    called: lpCalled0 + gpCalled0,
    distributed: 0,
    promotePaid: 0,
    prefAccrued: 0,
    investEndM: next.month + FUND_INVEST_M,
    lifeEndM: next.month + FUND_LIFE_M,
    pref: FUND_PREF,
    promote: FUND_PROMOTE,
    gpCommit,
  };
  next.fundPay = true; // new vintage buys from the vehicle by default
  next.news.unshift({
    q: next.month, kind: "event",
    text: `You have raised a $${(q.size / 1e6).toFixed(0)}M fund — vintage ${monthLabel(next.month)}. `
      + `$${(fundCash / 1e6).toFixed(1)}M is called; $${((lpCommit - lpCalled0) / 1e6).toFixed(1)}M sits uncalled. `
      + `The promote is ${(FUND_PROMOTE * 100).toFixed(0)}% over an ${(FUND_PREF * 100).toFixed(0)}% pref.`,
  });
  return { s: next };
}

/** Call more LP capital into the vehicle. */
export function callFundCapital(s: GameState, amount: number): { s: GameState; err?: string } {
  if (!s.fund || s.fund.settled) return { s, err: "No fund." };
  const want = Math.round(Math.min(amount, s.fund.uncalled));
  if (want <= 0) return { s, err: "Nothing left to call." };
  const next = cloneState(s);
  const f = next.fund!;
  f.uncalled -= want;
  f.cash += want;
  f.called += want;
  logBooks(next, "lpCalled", want);
  return { s: next };
}

/**
 * THE WATERFALL, IN THE ORDER EVERY LPA WRITES IT: the pref, then the capital
 * back, and only then the promote on what is left. Pure — what an `amount`
 * would pay each side today, given the fund's state.
 *
 * This used to take the promote on everything after the pref, the LPs' own
 * returned capital included: a fund that sold its first building at cost paid
 * the sponsor 20% of the investors' money back to them. The GP's co-invest is
 * capital like any other and takes its pro-rata share of every tier below the
 * promote.
 */
export function waterfall(f: PlayerFund, amount: number): { pref: number; capital: number; split: number; promote: number; toGpCoinvest: number; toLp: number } {
  let rest = Math.max(0, Math.round(amount));
  const pref = Math.min(rest, Math.max(0, Math.round(f.prefAccrued)));
  rest -= pref;
  const capital = Math.min(rest, Math.max(0, f.called - (f.capReturned ?? 0)));
  rest -= capital;
  const promote = Math.round(rest * f.promote);
  const split = rest - promote;
  const gpFrac = f.called > 0 ? Math.min(1, f.gpCommit / f.called) : 0;
  const toGpCoinvest = Math.round((pref + capital + split) * gpFrac);
  return { pref, capital, split, promote, toGpCoinvest, toLp: pref + capital + split - toGpCoinvest };
}

/**
 * Distribute through the waterfall. Mutates `s` in place. Returns LP dollars
 * booked to `lpDistributed`; the promote and the co-invest's share move from
 * the vehicle to GP cash, which is a transfer inside the firm.
 */
export function applyDistribute(s: GameState, amount: number): number {
  const f = s.fund;
  if (!f || f.settled) return 0;
  const want = Math.round(Math.min(amount, f.cash));
  if (want <= 0) return 0;
  const w = waterfall(f, want);
  f.cash -= want;
  f.prefAccrued -= w.pref;
  f.capReturned = (f.capReturned ?? 0) + w.capital;
  // `distributed` is every dollar to the capital accounts — LP and co-invest —
  // so DPI and the pref base stay on the same footing as `called`.
  f.distributed += w.pref + w.capital + w.split;
  f.promotePaid += w.promote;
  s.cash += w.promote + w.toGpCoinvest;
  if (w.toLp > 0) logBooks(s, "lpDistributed", w.toLp);
  return w.toLp;
}

/**
 * WHAT THE GP OWNS OF THE FUND TODAY: what the co-invest and the promote would
 * take if the vehicle were wound up at `nav` — the waterfall, applied to the
 * whole of it. This, not the buildings at 100%, is the sponsor's net worth in
 * a vehicle that is mostly other people's money.
 */
export function gpInterestInFund(f: PlayerFund | undefined, nav: number): number {
  if (!f || f.settled || !(nav > 0)) return 0;
  const w = waterfall(f, nav);
  return w.promote + w.toGpCoinvest;
}

/**
 * Distribute to LPs from fund cash. Pref first, then promote crystallises to
 * GP cash on profits over pref.
 */
export function distributeFund(s: GameState, amount: number): { s: GameState; err?: string } {
  if (!s.fund || s.fund.settled) return { s, err: "No fund." };
  const want = Math.round(Math.min(amount, s.fund.cash));
  if (want <= 0) return { s, err: "The vehicle has no cash to distribute." };
  const next = cloneState(s);
  applyDistribute(next, want);
  return { s: next };
}

/** Charge equity from the vehicle. Mutates `s`. */
export function chargeFundEquity(s: GameState, amount: number): { err?: string } {
  if (!fundCanBuy(s)) {
    return { err: "The vehicle is not buying — investment period closed or no cash." };
  }
  const want = Math.round(amount);
  if ((s.fund?.cash ?? 0) < want) {
    return { err: `The vehicle is short $${((want - (s.fund?.cash ?? 0)) / 1e6).toFixed(2)}M.` };
  }
  s.fund!.cash -= want;
  return {};
}

/** Sale / operating proceeds into the vehicle. Mutates `s`. */
export function creditFundCash(s: GameState, amount: number): void {
  if (!s.fund || s.fund.settled) return;
  s.fund.cash += Math.round(amount);
}

/**
 * Monthly pref accrual; at life end, settle remaining cash and record whether
 * LPs got their capital back. A failed vehicle is the second death — you
 * survive, and nobody will back you again.
 */
export function tickFund(s: GameState): void {
  const f = s.fund;
  if (!f || f.settled) return;
  // Pref on net contributed capital still outstanding.
  const netOut = Math.max(0, f.called - f.distributed);
  f.prefAccrued += netOut * (f.pref / 12);

  const deeds = Object.values(s.holdings).filter((h) => h.fundOwned).length;
  // The LPs' calendar, told ahead: two years and one year out from the end of
  // life, with the buildings still to sell.
  if (deeds > 0 && (s.month === f.lifeEndM - 24 || s.month === f.lifeEndM - 12)) {
    s.news.unshift({
      q: s.month, kind: "warn",
      text: `Your fund's life ends ${monthLabel(f.lifeEndM)} with ${deeds} building${deeds === 1 ? "" : "s"} still in the vehicle. `
        + `The LPs are paid from sales; what is unsold at the end of any extension you buy in at NAV.`,
    });
  }
  if (s.month === f.lifeEndM) {
    s.news.unshift({
      q: s.month, kind: "warn",
      text: `Your fund has reached the end of its life. Remaining vehicle cash is $${(f.cash / 1e6).toFixed(2)}M; `
        + (deeds > 0
          ? `${deeds} building${deeds === 1 ? "" : "s"} still to sell — the LPs grant a ${FUND_EXTENSION_M}-month extension, and anything unsold by ${monthLabel(f.lifeEndM + FUND_EXTENSION_M)} is bought in by you at NAV.`
          : `LPs expect distributions. A sponsor who cannot finish does not raise the next one.`),
    });
  }

  if (s.month >= f.lifeEndM) {
    // A vehicle with buildings in it cannot settle on cash alone — that was
    // how the LPs' buildings stayed on the sponsor's books at 100% the day the
    // fund closed. It runs into its extension; sim.ts buys in what is left.
    if (deeds === 0) settleFund(s);
    else if (f.extendedTo === undefined) f.extendedTo = f.lifeEndM + FUND_EXTENSION_M;
  }
}

/** Wind the vehicle: distribute remaining cash, stamp success or the second death. */
export function settleFund(s: GameState): void {
  const f = s.fund;
  if (!f || f.settled) return;
  if (f.cash > 0) applyDistribute(s, f.cash);
  f.settled = true;
  s.fundPay = false;
  // DPI on contributed capital. Below 1.0x means LPs lost principal — failed.
  const dpi = f.called > 0 ? f.distributed / f.called : 1;
  if (dpi < 1.0) {
    f.failed = true;
    s.fundFailedM = s.month;
    markSponsor(s, "forced", "fund wind-down", Math.max(0, f.called - f.distributed));
    s.news.unshift({
      q: s.month, kind: "warn",
      text: `The fund returned $${(f.distributed / 1e6).toFixed(2)}M against $${(f.called / 1e6).toFixed(2)}M called `
        + `(${(dpi * 100).toFixed(0)}¢ on the dollar). Nobody will back you again.`,
    });
  } else {
    s.news.unshift({
      q: s.month, kind: "deal",
      text: `Fund wound down — LPs received $${(f.distributed / 1e6).toFixed(2)}M on $${(f.called / 1e6).toFixed(2)}M called `
        + `(${dpi.toFixed(2)}x). Promote to the house: $${(f.promotePaid / 1e6).toFixed(2)}M.`,
    });
  }
}

/** Combined liquidity for conserve — GP cash + vehicle cash. */
export function totalLiquidity(s: GameState): number {
  return s.cash + (s.fund?.cash ?? 0);
}
