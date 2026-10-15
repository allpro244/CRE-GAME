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
import { cloneState, logBooks, monthLabel, moveFundCash, pnlAdd } from "./types";
import { markSponsor } from "./sponsor";
import { money } from "./money";
import { bandIdx, playerTerms } from "./reputation";
import { INVESTOR_TYPES, poolLeft, investorPool } from "./investors";

/**
 * THE MANAGEMENT FEE (CAPITAL_RAISING_PLAN.md §5.3): 1–1.5% a year of
 * commitments through the investment period, then of the capital still
 * invested. Industry convention; 1.25% here. It is how a fund sponsor
 * survives the J-curve before the promote ever pays — GP income, taxed.
 */
export const FUND_MGMT_FEE = 0.0125;
/** The smallest fund the market will close: below it nobody pays for a blind pool's overhead. Today's dollars. */
export const FUND_MIN_SIZE = 5_000_000;

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
  /**
   * Deeds that went to the LPs' liquidating trust in kind at the wind-down —
   * the sponsor could not buy them in. A fund that ends that way was not
   * "raised and returned", whatever its DPI reads.
   */
  inKind?: number;
  /**
   * THE VEHICLE'S OWN LEDGER (2026-10, CAPITAL_RAISING_PLAN.md §0.5). Every
   * dollar into or out of `cash`, by kind, written by `moveFundCash` at the
   * one place each movement happens. `invariants.ts` holds `cash` to the sum:
   * a write that bypasses it is money in the vehicle nobody can account for.
   * Absent on saves written before it; the check skips those.
   */
  flows?: Partial<Record<import("./types").FundFlowKind, number>>;
  /**
   * THE RIGHT-PURSE IDENTITY. `deedTagged` is every owner-side dollar booked
   * against a live fund deed (`logBooks`, signed: + into the owner, − out);
   * `deedSettled` is what the vehicle actually settled for those bookings
   * (`vehicleCollect` / `vehicleReimburse`, GP advances included) and the
   * `purchase` / `sale` flows callers moved directly. They must agree: a
   * fund deed's money landing in the sponsor's account, or the sponsor paying
   * the LPs' bills, shows up as the gap.
   */
  deedTagged?: number;
  deedSettled?: number;
  /** The management fee the LPA signed (a year, FUND_MGMT_FEE at the raise), and what it has paid the sponsor. */
  mgmtFee?: number;
  feesPaid?: number;
}

/**
 * THE SPONSOR'S NOTE ON THE LIQUIDATING TRUST. What the waterfall paid the
 * GP out of an in-kind distribution — the advance (senior), the co-invest's
 * pro-rata share and any promote — is a claim on the trust, not cash: the
 * trust pays it as it sells the buildings. Carried at face in net worth
 * (the trust's assets were marked at NAV the day it was formed) and paid in
 * equal monthly instalments over TRUST_NOTE_M months — a stated
 * simplification of a trust's sell-down, not a calibrated schedule.
 */
export interface TrustNote { balance: number; monthly: number; fromM: number }
export const TRUST_NOTE_M = 12;

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
  // Unsettled includes a fund in its extension: it still holds the LPs'
  // buildings, and a second raise would have written over it.
  if (s.fund && !s.fund.settled) {
    return { ok: false, size: 0, reason: s.month < s.fund.lifeEndM ? "You already have a live fund." : "Finish winding down the last fund first — its LPs still own buildings in it." };
  }
  // A BLIND POOL IS BACKED ON A RECORD (§3.4): pensions and endowments take
  // the meeting from Institutional up. A failed fund is on that record — it
  // replaced the old "nobody will back you again", which was too blunt: a
  // sponsor whose fund lost money with everyone else's did raise again.
  const band = playerTerms(s).band;
  if (bandIdx(band) < bandIdx("Institutional")) {
    return { ok: false, size: 0, reason: `Pensions and endowments back a blind pool on a record. They read you as ${band}; a fund needs Institutional — a score of 40 from three good deals worth eight of experience, one of them with outside investors, and a place in the street's top 13%.` };
  }
  // LPs commit when the credit window is open — the denominator effect and
  // the debt they lever their own commitments with — not when a label says so.
  const ciFund = s.econ.creditIdx ?? 1;
  if (ciFund < 0.7) {
    return { ok: false, size: 0, reason: "Nobody raised a real estate fund in a crunch. Wait for the thaw." };
  }
  // SIZE FROM DEMAND, NOT A FORMULA (§5.6): what the investor types the band
  // opens still have to put to work in this city this year (investors.ts) —
  // the raise draws it down, so a fund raised in a year the rivals have
  // already raised in is smaller. A successor fund's sponsor ranks higher on
  // the record its last fund left, which is how it raises more.
  let open = 0;
  for (const t of INVESTOR_TYPES) if (bandIdx(band) >= bandIdx(t.band)) open += poolLeft(s, t.id);
  const size = Math.round(open / 100_000) * 100_000;
  const floor = FUND_MIN_SIZE * (s.econ.priceLevel ?? 1) * (s.econ.cpi ?? 1);
  if (size < floor) {
    return { ok: false, size, reason: `The investors who back funds have ${money(open)} left to put to work here this year — not a fund's worth (${money(floor)}). Next year's money opens in January.` };
  }
  const prev = s.fund?.settled && !s.fund.failed ? s.fund : undefined;
  const prevDpi = prev && prev.called > 0 ? prev.distributed / prev.called : 0;
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
    mgmtFee: FUND_MGMT_FEE,
    raisedM: next.month,
    size: q.size,
    uncalled: lpCommit - lpCalled0,
    cash: fundCash,
    flows: { call: fundCash },
    deedTagged: 0,
    deedSettled: 0,
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
  // The LPs' commitments come out of the year's pool (investors.ts), type by
  // type in the band's order — the money is not there for anyone else.
  {
    const pool = investorPool(next);
    const band = playerTerms(next).band;
    let rest = lpCommit;
    for (const t of INVESTOR_TYPES) {
      if (bandIdx(band) < bandIdx(t.band) || rest <= 0) continue;
      const take = Math.min(rest, poolLeft(next, t.id));
      pool.used[t.id] = (pool.used[t.id] ?? 0) + take;
      rest -= take;
    }
  }
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
  moveFundCash(f, want, "call");
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
    moveFundCash(f, -adv, "advRepay");
    s.cash += adv;
    want -= adv;
    if (want <= 0) return 0;
  }
  const w = waterfall(f, want);
  moveFundCash(f, -want, "dist");
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
 * AN IN-KIND DISTRIBUTION, THROUGH THE WATERFALL. `nav` is the equity of the
 * deeds the LPs' liquidating trust just took. The GP advance comes back first
 * (it was a loan to the vehicle, not capital in it); the rest runs the
 * waterfall exactly as cash would — pref, capital, then the promote, which a
 * trust that does not clear the pref and the capital simply never reaches.
 * The GP's legs (advance, co-invest share, promote) become a note on the
 * trust; the LPs' legs are booked as distributed. No cash moves here, so
 * nothing is booked to the ledger — the note pays in cash later
 * (`tickTrustNote`). An advance larger than the trust is written off.
 * Mutates `s`.
 */
export function distributeInKind(s: GameState, nav: number): { advance: number; coinvest: number; promote: number; writtenOff: number; total: number } {
  const f = s.fund;
  const out = { advance: 0, coinvest: 0, promote: 0, writtenOff: 0, total: 0 };
  if (!f || f.settled) return out;
  let rest = Math.max(0, Math.round(nav));
  const owed = Math.max(0, Math.round(f.gpAdvance ?? 0));
  out.advance = Math.min(rest, owed);
  rest -= out.advance;
  f.gpAdvance = 0;
  out.writtenOff = owed - out.advance;
  if (rest > 0) {
    const w = waterfall(f, rest);
    f.prefAccrued -= w.pref;
    f.capReturned = (f.capReturned ?? 0) + w.capital;
    f.distributed += w.pref + w.capital + w.split;
    f.promotePaid += w.promote;
    out.coinvest = w.toGpCoinvest;
    out.promote = w.promote;
    if (w.promote > 0) s.promoteIncomeYr = (s.promoteIncomeYr ?? 0) + w.promote;
  }
  out.total = out.advance + out.coinvest + out.promote;
  if (out.total > 0) {
    const bal = (s.trustNote?.balance ?? 0) + out.total;
    s.trustNote = { balance: bal, monthly: Math.ceil(bal / TRUST_NOTE_M), fromM: s.month };
  }
  return out;
}

/**
 * THE TRUST PAYS ITS NOTE as it sells. Cash in from outside the firm —
 * the trust's sale proceeds — booked to `sold` (it is real estate sold, by
 * the trust, for the sponsor's account). Mutates `s`.
 */
export function tickTrustNote(s: GameState): void {
  const n = s.trustNote;
  if (!n || !(n.balance > 0) || s.month <= n.fromM) return;
  const pay = Math.min(n.balance, n.monthly);
  n.balance -= pay;
  s.cash += pay;
  logBooks(s, "sold", pay);
  if (n.balance <= 0) {
    s.trustNote = null;
    s.news.unshift({ q: s.month, kind: "info", text: "The fund's liquidating trust has paid off your note — its last building is sold." });
  }
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
  moveFundCash(s.fund!, -want, "purchase");
  return {};
}

/** Sale / operating proceeds into the vehicle. Mutates `s`. */
export function creditFundCash(s: GameState, amount: number, kind: import("./types").FundFlowKind = "sale"): void {
  if (!s.fund || s.fund.settled) return;
  moveFundCash(s.fund, Math.round(amount), kind);
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
  // THE MANAGEMENT FEE, a month of it: on commitments through the investment
  // period, then on the capital still invested. Paid from the vehicle's cash,
  // called from the LPs when the cash is short; the sponsor's income. Within
  // the firm's two purses no cash enters or leaves, so it is on the income
  // statement, not the cash books (conserve reconciles the two purses together).
  // The rate is a term of the fund's agreement, signed at the raise; a fund
  // raised before fees were modelled (an old save) agreed none.
  if (f.mgmtFee && f.mgmtFee > 0) {
    const base = s.month <= f.investEndM ? f.size : netOut;
    const fee = Math.round(base * f.mgmtFee / 12);
    if (fee > 0) {
      const short = fee - Math.max(0, f.cash);
      if (short > 0 && f.uncalled > 0) {
        const call = Math.min(short, f.uncalled);
        f.uncalled -= call;
        f.called += call;
        moveFundCash(f, call, "call");
        logBooks(s, "lpCalled", call);
      }
      const pay = Math.min(fee, Math.max(0, f.cash));
      if (pay > 0) {
        moveFundCash(f, -pay, "fee");
        s.cash += pay;
        // The sponsor's co-invest pays its own share of the fee: what it earns
        // (and is taxed on) is the LPs' share.
        const lpPart = Math.round(pay * (1 - gpCapitalShare(f)));
        pnlAdd(s, "fees", lpPart);
        s.feeIncomeYr = (s.feeIncomeYr ?? 0) + lpPart;
        f.feesPaid = (f.feesPaid ?? 0) + pay;
      }
    }
  }
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
  // ON THE RECORD (reputation.ts): a realised fund is investor evidence, and
  // Blue-chip needs one.
  (s.fundHistory ??= []).push({ raisedM: f.raisedM, closedM: s.month, size: f.size, called: f.called, distributed: f.distributed, gpCommit: f.gpCommit });
  if (dpi < 1.0) {
    f.failed = true;
    s.fundFailedM = s.month;
    markSponsor(s, "forced", "fund wind-down", Math.max(0, f.called - f.distributed));
    s.news.unshift({
      q: s.month, kind: "warn",
      text: `The fund returned ${money(f.distributed)} against ${money(f.called)} called `
        + `(${(dpi * 100).toFixed(0)}¢ on the dollar). It goes on your record with every investor, and they will read it for a decade.`,
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
