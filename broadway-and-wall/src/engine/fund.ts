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
import { money } from "./money";

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
  /**
   * GP ADVANCES OUTSTANDING. What the sponsor paid for the vehicle's buildings
   * when the vehicle had neither cash nor commitments left to call — an LPA
   * lets the GP advance to protect an investment, and repays it ahead of any
   * distribution. The sponsor's receivable, the vehicle's liability; carried
   * at cost (no interest accrues — a simplification, stated). See
   * settleVehicleDeedFlow in types.ts.
   */
  gpAdvance?: number;
  /** Last month the vehicle made a scheduled distribution. */
  lastDistM?: number;
}

/** Two one-year extensions — the common LPA term for a closed-end real estate fund. */
export const FUND_EXTENSION_M = 24;

/** Live vehicle still inside its life (not yet settled). */
export function fundIsLive(s: GameState): boolean {
  return !!s.fund && !s.fund.settled && s.month < s.fund.lifeEndM;
}

/** Purchases may draw vehicle cash during the investment period. */
export function fundCanBuy(s: GameState): boolean {
  // Cash in the vehicle or commitments still to call — deals call capital as they close.
  return !!s.fund && !s.fund.settled && s.month <= s.fund.investEndM && s.fund.cash + s.fund.uncalled > 0;
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
  // Unsettled includes a fund in its extension: it still holds the LPs'
  // buildings, and a second raise would have written over it.
  if (s.fund && !s.fund.settled) {
    return { ok: false, size: 0, reason: s.month < s.fund.lifeEndM ? "You already have a live fund." : "Finish winding down the last fund first — its LPs still own buildings in it." };
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
  // A SUCCESSOR FUND IS SIZED OFF THE LAST ONE. LPs re-up in proportion to
  // what the prior vehicle returned, and a manager's second fund raising a
  // multiple of its first is the ordinary shape of the business; a firm with a
  // returned fund raised exactly what a first-timer did, capped at ~$55M
  // however large it had grown. The multiples below are shape choices keyed
  // to the prior fund's DPI (1.0x back, 1.2x solid, 1.5x strong), not
  // calibrated to a measured outcome.
  const prev = s.fund?.settled && !s.fund.failed ? s.fund : undefined;
  const prevDpi = prev && prev.called > 0 ? prev.distributed / prev.called : 0;
  const reup = !prev ? 0 : prevDpi >= 1.5 ? 2 : prevDpi >= 1.2 ? 1.5 : prevDpi >= 1 ? 1.15 : 0;
  const size = Math.round(Math.max(base * phaseMult, (prev?.size ?? 0) * reup * phaseMult) / 100_000) * 100_000;
  const nth = (s.fundsRaised ?? (prev ? 1 : 0)) + 1;
  // THE QUOTE CARRIES THE CHEQUE. raiseFund refuses without the GP
  // co-invest in cash (a revolver cannot fund a ten-year commitment), and
  // the quote used to say yes regardless — the button lit, the raise failed
  // (81–274 times a run for one bot). Say it here, with the number.
  const gpNeed = Math.round(size * FUND_GP_COINVEST);
  if (s.cash < gpNeed) {
    return { ok: false, size, reason: `LPs would back a $${(size / 1e6).toFixed(0)}M fund, but the GP co-invest is ${money(gpNeed)} in cash — the line cannot fund a ten-year commitment — and you hold ${money(Math.max(0, s.cash))}.` };
  }
  return {
    ok: true, size,
    reason: prev
      ? `Fund ${nth}: your last vehicle returned ${prevDpi.toFixed(2)}x, and a ${monthLabel(s.month)} vintage of $${(size / 1e6).toFixed(0)}M will clear.`
      : `A ${monthLabel(s.month)} vintage of $${(size / 1e6).toFixed(0)}M will clear.`,
  };
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
    return { s, err: `GP co-invest is ${money(gpCommit)} and you do not have it.` };
  }
  // First close: call GP co-invest + ~40% of LP immediately into the vehicle;
  // rest sits uncalled. Shape: 30–50% reserve practice (rivals.ts).
  const lpCommit = q.size - gpCommit;
  // CAPITAL IS CALLED AS DEALS CLOSE, NOT PARKED. This called 60% of LP
  // commitments on day one; the vehicle then sat on $30-35M for years while
  // the pref accrued on money that was doing nothing — measured $25.0M of pref
  // owed on one run, and a "success" that returned 1.04x over ten years. A
  // quarter at first close covers fees and the first deal's deposit; every
  // vehicle purchase calls what it needs from the rest (executePurchase). The
  // quarter is a shape choice, not calibrated.
  const uncalledShare = 0.75;
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
  next.fundsRaised = (s.fundsRaised ?? (s.fund?.settled ? 1 : 0)) + 1;
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
  const gpFrac = gpCapitalShare(f);
  const toGpCoinvest = Math.round((pref + capital + split) * gpFrac);
  return { pref, capital, split, promote, toGpCoinvest, toLp: pref + capital + split - toGpCoinvest };
}

/**
 * THE SPONSOR'S SHARE OF THE VEHICLE'S CAPITAL — its co-invest over all the
 * capital called. The waterfall pays the co-invest pro rata on every tier
 * below the promote at this fraction, and a pass-through vehicle allocates
 * its taxable income and gains to the sponsor at the same fraction (the
 * LPs' shares are taxed on their own returns, off this book).
 */
export function gpCapitalShare(f: PlayerFund | undefined): number {
  if (!f || !(f.called > 0)) return 0;
  return Math.min(1, f.gpCommit / f.called);
}

/**
 * Distribute through the waterfall. Mutates `s` in place. Returns LP dollars
 * booked to `lpDistributed`; the promote and the co-invest's share move from
 * the vehicle to GP cash, which is a transfer inside the firm.
 */
export function applyDistribute(s: GameState, amount: number): number {
  const f = s.fund;
  if (!f || f.settled) return 0;
  let want = Math.round(Math.min(amount, f.cash));
  if (want <= 0) return 0;
  // A GP advance is repaid before the waterfall sees a dollar — it was a loan
  // to the vehicle, not capital in it.
  const adv = Math.min(want, Math.max(0, Math.round(f.gpAdvance ?? 0)));
  if (adv > 0) {
    f.gpAdvance = (f.gpAdvance ?? 0) - adv;
    f.cash -= adv;
    s.cash += adv;
    want -= adv;
    if (want <= 0) return 0;
  }
  const w = waterfall(f, want);
  f.cash -= want;
  f.prefAccrued -= w.pref;
  f.capReturned = (f.capReturned ?? 0) + w.capital;
  // `distributed` is every dollar to the capital accounts — LP and co-invest —
  // so DPI and the pref base stay on the same footing as `called`.
  f.distributed += w.pref + w.capital + w.split;
  f.promotePaid += w.promote;
  s.cash += w.promote + w.toGpCoinvest;
  // CARRIED INTEREST IS THE SPONSOR'S INCOME WHEN IT IS PAID. The co-invest
  // leg is capital coming home (its share of the income was taxed as the
  // vehicle earned it — sim.ts, January); the promote is new money to the GP
  // and goes on its return for the year. Taxed with the rest of the sponsor's
  // income, where a banked loss can reach it as it would on a real return.
  if (w.promote > 0) s.promoteIncomeYr = (s.promoteIncomeYr ?? 0) + w.promote;
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
  // The GP advance comes back first — the sponsor's receivable, as far as the
  // vehicle's NAV reaches — and the waterfall runs on what is left.
  const adv = Math.min(nav, Math.max(0, f.gpAdvance ?? 0));
  const rest = nav - adv;
  if (!(rest > 0)) return adv;
  const w = waterfall(f, rest);
  return adv + w.promote + w.toGpCoinvest;
}

/** The floor under the vehicle's reserve — the same $250K float as `LOC_CASH_RESERVE` in credit.ts. */
export const FUND_RESERVE_FLOOR = 250_000;

/**
 * THE VEHICLE'S WORKING-CAPITAL RESERVE. What a distribution leaves behind so
 * the fund can pay its own buildings' bills without a call: six months of debt
 * service on its deeds, never under the $250K float — the sponsor treasury's
 * own rule (`operatingReserve`, credit.ts) applied to the other purse. Nothing
 * once the vehicle owns nothing.
 */
export function fundReserve(s: GameState): number {
  let pmt = 0, deeds = 0;
  for (const h of Object.values(s.holdings)) {
    if (!h.fundOwned) continue;
    deeds++;
    pmt += (h.loan?.monthlyPmt ?? 0) + (h.mezz?.monthlyPmt ?? 0);
  }
  return deeds ? Math.max(FUND_RESERVE_FLOOR, Math.round(6 * pmt)) : 0;
}

/**
 * SCHEDULED DISTRIBUTIONS. A closed-end LPA recycles proceeds only during the
 * investment period; after it, the GP distributes sale proceeds and excess
 * operating cash, quarterly being the ordinary cadence. This was manual only,
 * so a vehicle past its investment period sat on its sale proceeds for years
 * while the pref accrued on capital that had already come home. Mutates `s`.
 * Returns the dollars sent through the waterfall (0 when nothing was due).
 */
export function scheduledDistribution(s: GameState): number {
  const f = s.fund;
  if (!f || f.settled || s.month <= f.investEndM) return 0;
  if ((s.month - f.raisedM) % 3 !== 0) return 0;
  const excess = Math.floor(f.cash - fundReserve(s));
  if (excess <= 0) return 0;
  const before = f.distributed + f.promotePaid;
  applyDistribute(s, excess);
  f.lastDistM = s.month;
  const out = f.distributed + f.promotePaid - before;
  if (out >= 100_000) {
    s.news.unshift({
      q: s.month, kind: "info",
      text: `The fund distributed $${(out / 1e6).toFixed(2)}M to its partners this quarter, as its LPA requires after the `
        + `investment period; $${(Math.max(0, f.cash) / 1e6).toFixed(2)}M stays in the vehicle as its reserve.`,
    });
  }
  return excess;
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
    return { err: `The vehicle is short ${money((want - (s.fund?.cash ?? 0)))}.` };
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
  scheduledDistribution(s);

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
      text: `Your fund has reached the end of its life. Remaining vehicle cash is ${money(f.cash)}; `
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
      text: `The fund returned ${money(f.distributed)} against ${money(f.called)} called `
        + `(${(dpi * 100).toFixed(0)}¢ on the dollar). Nobody will back you again.`,
    });
  } else {
    s.news.unshift({
      q: s.month, kind: "deal",
      text: `Fund wound down — LPs received ${money(f.distributed)} on ${money(f.called)} called `
        + `(${dpi.toFixed(2)}x). Promote to the house: ${money(f.promotePaid)}.`,
    });
  }
}

/** Combined liquidity for conserve — GP cash + vehicle cash. */
export function totalLiquidity(s: GameState): number {
  return s.cash + (s.fund?.cash ?? 0);
}
