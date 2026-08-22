/**
 * THE PORTFOLIO FACILITY — one loan, many deeds, cross-collateralised and
 * cross-defaulted.
 *
 * Everything else in this game lends against ONE building. That is how a
 * first-time buyer borrows and it is not how anybody with a book borrows. Past
 * a handful of assets an owner stops financing buildings and starts financing a
 * BALANCE SHEET: they pledge a pool, the lender sizes a borrowing base against
 * the pool, and one facility replaces a drawer full of mortgages with different
 * maturities, different lenders and different covenants.
 *
 * WHY A LENDER PAYS UP FOR A POOL, which is the whole reason the instrument
 * exists. A single-asset loan is exposed to one building's tenant, one roof and
 * one submarket; the lender prices the tail. Twelve buildings across four
 * classes cannot all go dark in the same quarter, so the same coverage carries
 * more debt at the same risk of loss. That is not a bonus for being big — it is
 * the arithmetic of a narrower loss distribution, and this file computes it from
 * the pool the player actually pledges rather than asserting it:
 *
 *   `poolQuality` measures concentration the same way `collateralHaircut`
 *   measures tenant concentration one level down — a Herfindahl index over
 *   value by building, and a second one over class. A pool of one is a
 *   mortgage with extra paperwork and gets nothing. A pool of fifteen across
 *   four classes gets the full premium.
 *
 * WHAT IT COSTS, and every one of these is a real term in a real facility:
 *
 *   CROSS-DEFAULT      the covenants are tested on the POOL. One building
 *                      going dark cannot breach anything on its own — that is
 *                      the point — but a pool-wide breach traps the cash flow
 *                      of every building in it at once. You have swapped a
 *                      series of small, separable failures for one large,
 *                      simultaneous one.
 *   RELEASE PREMIUM    to sell a pledged building you must repay more than its
 *                      share of the loan — 115% here, which is the market
 *                      convention for a release price on a crossed pool. The
 *                      lender is protecting the quality of what is left, and
 *                      the effect on you is that your portfolio has become
 *                      harder to take apart than it was to put together.
 *   RECOURSE           a bank facility is signed personally. There is no
 *                      handing back the keys on this one.
 *   THE PAYOFF         pledging a mortgaged building repays that mortgage out
 *                      of the proceeds, prepayment penalties and all. On paper
 *                      that is often what kills the deal, and it should.
 *
 * WHERE THE MONEY IS BOOKED. Fees, points and prepayment penalties are an
 * expense and go to `debtSvc` like every other financing cost. Principal that
 * merely replaces the mortgages paid off at the table is a wash. Principal
 * that lands in the operating account (a cash-out draw) is booked to
 * `borrowed`, the same inflow bucket a cash-out refinance uses — so
 * conserve's identity can see it. Voluntary paydowns (release, repay) go to
 * `debtSvc`. Monthly amortisation already did.
 *
 * SO THE DECISION IS A REAL ONE. More proceeds, a lower coupon, one maturity
 * and one payment — against illiquidity, a single point of failure and your
 * own signature. That is the trade every owner who has ever signed one has
 * made, and it is why the ones who signed it in 2006 are a cautionary tale and
 * the ones who signed it in 2011 are a case study.
 */
import type { ParcelTable } from "@/data/types";
import type { ParcelRecord } from "@/data/types";
import type { BuiltClass, GameState, Holding } from "./types";
import { logBooks, monthLabel, cloneState} from "./types";
import { ownedHoldingNoiYr, ownedHoldingValue, ownedMonthlyNoi, resolveRec } from "./value";
import { PRODUCTS, productById, bumpLenderRel, windowOpen, quote, advanceFactor, stackPayoff } from "./debt";
import { distressPrice, sponsorStanding } from "./sponsor";
import { recordComp } from "./comps";
import { firmShort } from "./firm";
import { fundCashNeed, fundableNow, spendable, fundAndBook } from "./credit";

/** Facility money in news copy — never "$0.03M" for a $30k shortfall. */
function dollars(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (a >= 1_000) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

/** Standard annuity payment, monthly, on a level-pay loan. */
function monthlyPayment(principal: number, ratePct: number, years: number): number {
  const r = ratePct / 100 / 12;
  const n = years * 12;
  if (r <= 0) return principal / n;
  return (principal * r) / (1 - Math.pow(1 + r, -n));
}

/**
 * THE FACILITY PAYMENT — one function, four callers.
 *
 * The quote card solved its borrowing base off one expression of this, the
 * closing wrote another, and the monthly tick a third. Three copies of one
 * quantity is how a card and a close come to disagree, and on a pool the
 * disagreement is the whole decision: the coverage covenant is struck against
 * this number the month after you sign it.
 *
 * `ioMLeft` is months of interest-only REMAINING — the tick passes what is left
 * of the IO window, the quote passes the product's whole IO period, and both
 * mean the same thing: is this month's cheque interest, or interest and
 * principal.
 */
export function facilityPmt(principal: number, ratePct: number, ioMLeft: number, amortYears: number): number {
  return ioMLeft > 0
    ? Math.ceil((principal * ratePct) / 100 / 12)
    : Math.round(monthlyPayment(principal, ratePct, amortYears));
}

/** The same payment per dollar of balance, unrounded — what the coverage test solves against. */
export function facilityPmtPerDollar(ratePct: number, ioMLeft: number, amortYears: number): number {
  return ioMLeft > 0 ? ratePct / 100 / 12 : monthlyPayment(1, ratePct, amortYears);
}

/**
 * WHAT A GIVEN DRAW WOULD ACTUALLY COST AND COVER — the two facts a borrower
 * needs before signing a pool, and the two the desk never printed.
 *
 * Coverage is struck here exactly as `facilityMetrics` strikes the live covenant
 * — today's pool NOI over twelve of this month's cheques — so the number on the
 * card before you sign and the number the lender tests you against afterwards
 * are the same arithmetic. Anything else and the borrower is being shown a
 * decision that is not the decision they are taking.
 */
export function facilityDrawTerms(
  draw: number, ratePct: number, ioMLeft: number, amortYears: number, noi: number, value: number,
): { monthlyPmt: number; annualDs: number; dscr: number; ltv: number } {
  const monthlyPmt = facilityPmt(draw, ratePct, ioMLeft, amortYears);
  const annualDs = monthlyPmt * 12;
  return {
    monthlyPmt, annualDs,
    dscr: annualDs > 0 ? noi / annualDs : 0,
    ltv: value > 0 ? draw / value : 0,
  };
}

/**
 * WHAT A RELEASE COSTS, as a multiple of the released building's allocated
 * share of the balance. 115% is the ordinary release price on a crossed pool —
 * the lender takes back more than the asset's share so that every sale
 * IMPROVES the coverage on what remains, which is the entire reason the clause
 * exists. It is also the number that makes a facility a decision rather than a
 * free upgrade: your book is no longer something you can sell one building at
 * a time without thinking about it.
 */
export const RELEASE_PREMIUM = 1.15;

/** How long a breach can run before the facility is accelerated. */
export const FACILITY_CURE_M = 12;

/** The smallest pool anybody will paper as a facility. */
export const FACILITY_MIN_ASSETS = 3;
export const FACILITY_MIN_LOAN = 5_000_000;

/**
 * HOW CONCENTRATED THE POOL IS, and therefore how much of the pooling benefit
 * the borrower has actually earned.
 *
 * Two Herfindahl indices, because there are two ways a "portfolio" can fail to
 * be one. `hhiValue` over the buildings catches a pool that is one tower and
 * four sheds — sell the tower's tenant and the pool is gone. `hhiClass` over
 * office/retail/industrial/flats catches four office towers, which is one bet
 * spelled four times. Both run 0..1, where 1 is everything in one place.
 *
 * The score is the average of the two complements, so a pool has to be spread
 * BOTH ways to earn the whole premium — which is what a credit committee
 * actually asks and why nobody gets a portfolio advance rate on four identical
 * buildings on the same street.
 */
export function poolQuality(
  s: GameState, parcels: ParcelTable, bbls: string[],
): { score: number; hhiValue: number; hhiClass: number; classes: number; value: number; noi: number; why: string } {
  let value = 0, noi = 0;
  const byBldg: number[] = [];
  const byClass = new Map<string, number>();
  for (const bbl of bbls) {
    const h = s.holdings[bbl];
    const rec = resolveRec(parcels, s, bbl);
    if (!h || !rec) continue;
    const v = ownedHoldingValue(s, parcels, h);
    if (v <= 0) continue;
    value += v;
    noi += ownedHoldingNoiYr(s, parcels, h);
    byBldg.push(v);
    const cls = (rec.class as BuiltClass) ?? "office";
    byClass.set(cls, (byClass.get(cls) ?? 0) + v);
  }
  if (value <= 0) {
    return { score: 0, hhiValue: 1, hhiClass: 1, classes: 0, value: 0, noi: 0, why: "nothing to pledge" };
  }
  const hhiValue = byBldg.reduce((a, v) => a + Math.pow(v / value, 2), 0);
  const hhiClass = [...byClass.values()].reduce((a, v) => a + Math.pow(v / value, 2), 0);
  const score = Math.max(0, Math.min(1, ((1 - hhiValue) + (1 - hhiClass)) / 2));
  const top = Math.max(...byBldg) / value;
  const why = byBldg.length < FACILITY_MIN_ASSETS
    ? `a pool of ${byBldg.length} is not a pool`
    : top > 0.45 ? `one building is ${(top * 100).toFixed(0)}% of the collateral`
    : byClass.size === 1 ? `every building in it is ${[...byClass.keys()][0]}`
    : `${byBldg.length} buildings across ${byClass.size} class${byClass.size === 1 ? "" : "es"}`;
  return { score, hhiValue, hhiClass, classes: byClass.size, value, noi, why };
}

export interface FacilityQuote {
  lender: string;
  productId: string;
  ratePct: number;
  /** The borrowing base: the most this desk will advance against this pool. */
  base: number;
  /** ...and which of the three tests produced it. */
  binding: string;
  maxLTV: number;
  minDSCR: number;
  advance: number;          // the pool advance rate actually applied
  spreadCut: number;        // basis points off the single-asset coupon
  amortYears: number;
  termM: number;
  ioM: number;
  points: number;
  /**
   * WHAT IT COSTS TO CARRY, per dollar drawn — the number the coverage test was
   * solved from, handed to the screen so the debt service and the DSCR a
   * borrower is shown before signing are the ones the covenant will use after.
   * They were computed here and thrown away, which is why the pool's payment
   * and its coverage were the two facts a facility never told you.
   */
  pmtPerDollar: number;
  /** …and the monthly cheque at the full borrowing base, for the card. */
  monthlyPmtAtBase: number;
  /** Pool coverage at the full base. Below `minDSCR` the loan opens in breach. */
  dscrAtBase: number;
  /** What has to be repaid out of the proceeds before a penny reaches you. */
  payoff: number;
  penalties: number;
  fees: number;
  netToYou: number;
  quality: ReturnType<typeof poolQuality>;
  available: boolean;
  why?: string;
}

/**
 * The desks that will write a facility at all. A conduit securitises single
 * assets and a mezzanine desk sits behind somebody; a POOL is balance-sheet
 * lending and it is the banks and the life company who do it.
 */
const FACILITY_DESKS = ["savings", "harbor", "life"];

/**
 * THE BORROWING BASE. Three tests on the POOL, and the smallest one binds —
 * exactly the three a single-asset desk runs, one level up:
 *
 *   ADVANCE RATE   the desk's own maxLTV, plus up to six points for a pool
 *                  that is genuinely diversified. Six is the observed spread
 *                  between a one-off mortgage and a pool facility on the same
 *                  collateral, and it is scaled by `poolQuality` so it is
 *                  earned rather than granted.
 *   COVERAGE       pool NOI against the payment the loan would carry, at the
 *                  desk's minimum DSCR. Solved on the actual annuity rather
 *                  than a coupon approximation, because a 25-year amortisation
 *                  costs a great deal more than its interest.
 *   DEBT YIELD     pool NOI over the loan. The test that does not care what
 *                  anybody thinks the buildings are worth, which is why it is
 *                  the one that binds at the top of a cycle.
 */
export function facilityQuotes(s: GameState, parcels: ParcelTable, bbls: string[]): FacilityQuote[] {
  const q = poolQuality(s, parcels, bbls);
  const out: FacilityQuote[] = [];
  // What it costs to clear the existing paper off the pledged deeds. A
  // facility takes a first lien on everything in the pool, so anything already
  // mortgaged gets repaid at the closing — penalty and all.
  let payoff = 0, penalties = 0;
  for (const bbl of bbls) {
    const h = s.holdings[bbl];
    if (!h) continue;
    const stack = stackPayoff(h, s.month);
    payoff += stack.balance;
    penalties += stack.penalty;
  }
  // Replacing a live facility pays the whole pool off at the table, then the
  // new paper attaches. Allocated shares would double-count nothing — pledged
  // deeds have no mortgage — but omitting the facility balance would quote a
  // cash-out that is not there.
  if (s.facility) payoff += s.facility.balance;
  const st = sponsorStanding(s);
  for (const id of FACILITY_DESKS) {
    const p = PRODUCTS.find((x) => x.id === id);
    if (!p) continue;
    const open = windowOpen(s, p);
    // ONE UNDERWRITING MODEL. The coupon comes from `quote` — the same
    // function that prices every other loan in the game, carrying the index,
    // the credit window, this desk's own balance sheet, your record and your
    // relationship with them — and the pool discount comes off the top of it.
    // Recomputing a rate here would be the second answer to a quantity that
    // already has one.
    const single = quote(s, p, q.value, q.noi, undefined);
    const spreadCut = 0.35 * q.score;                       // up to 35bp, earned
    const ratePct = +Math.max(0.5, single.ratePct - spreadCut).toFixed(2);
    // The pool premium, earned, on the ADVANCE RATE — which is the desk's
    // `ltv`, not its covenant `maxLTV`, and it is cut by the cycle and by your
    // own record exactly as it is on a single building. At score 0 this is a
    // mortgage with extra paperwork and gets nothing.
    const advance = Math.min(0.85,
      p.ltv * advanceFactor(s, p.lender) * (1 - st.advanceCut) + 0.06 * q.score);
    const byLtv = advance * q.value;
    // Coverage: the balance whose level payment pool NOI covers minDSCR times.
    const pmtPerDollar = facilityPmtPerDollar(ratePct, p.ioM, p.amortYears);
    const byDscr = q.noi > 0 ? q.noi / 12 / (p.minDSCR * pmtPerDollar) : 0;
    // Debt yield. A facility is underwritten to a floor on income per dollar
    // lent, and a pool does not get a better one than a building — the
    // diversification shows up in the advance rate, not in the income test.
    const MIN_DY = 0.085;
    const byDy = q.noi > 0 ? q.noi / MIN_DY : 0;
    const base = Math.max(0, Math.floor(Math.min(byLtv, byDscr, byDy)));
    const binding = base === Math.floor(byLtv) ? "advance rate"
      : base === Math.floor(byDscr) ? "coverage" : "debt yield";
    const points = Math.round(base * p.points);
    const fees = Math.round(base * 0.01) + points;
    const n = bbls.filter((b) => s.holdings[b]).length;
    const why = n < FACILITY_MIN_ASSETS
      ? `${p.label} will not paper a pool of ${n}. Pledge at least ${FACILITY_MIN_ASSETS} buildings.`
      : !open ? `${p.label} has stopped writing new paper this cycle.`
      : base < FACILITY_MIN_LOAN ? `The base comes to ${Math.round(base / 1e6)}M and nobody documents a facility under $5M.`
      : undefined;
    const atBase = facilityDrawTerms(base, ratePct, p.ioM, p.amortYears, q.noi, q.value);
    out.push({
      lender: p.lender, productId: p.id, ratePct, base, binding,
      maxLTV: p.maxLTV, minDSCR: p.minDSCR, advance, spreadCut,
      amortYears: p.amortYears, termM: p.termM, ioM: p.ioM, points: p.points,
      pmtPerDollar,
      monthlyPmtAtBase: atBase.monthlyPmt,
      dscrAtBase: atBase.dscr,
      payoff, penalties, fees,
      netToYou: base - payoff - penalties - fees,
      quality: q,
      available: !why,
      why,
    });
  }
  return out.sort((a, b) => b.netToYou - a.netToYou);
}

/**
 * SIGN IT. The proceeds clear every mortgage on the pledged deeds, the fees
 * and the prepayment penalties come off the top, and whatever is left is
 * yours.
 *
 * `lev` is the dial: a borrower is not obliged to draw the whole base, and on
 * a facility the sensible ones do not — the covenant is tested against what
 * you drew, so the room you leave is the room you have when the market turns.
 */
export function openFacility(
  s: GameState, parcels: ParcelTable, bbls: string[], productId: string, lev = 1,
): { s: GameState; err?: string } {
  // A live facility is not a wall — the player refinances the book: keep the
  // crossed deeds, add free-and-clear or separately mortgaged ones, and the
  // old paper is repaid at the table. That is how a portfolio refinance works.
  const pool = bbls.filter((b) => s.holdings[b]);
  if (pool.length < FACILITY_MIN_ASSETS) return { s, err: `Pledge at least ${FACILITY_MIN_ASSETS} buildings.` };
  const quotes = facilityQuotes(s, parcels, pool);
  const qt = quotes.find((x) => x.productId === productId);
  if (!qt) return { s, err: "That desk does not write facilities." };
  if (!qt.available) return { s, err: qt.why ?? "That desk will not quote this pool." };
  const draw = Math.floor(qt.base * Math.max(0.1, Math.min(1, lev)));
  if (draw < FACILITY_MIN_LOAN) return { s, err: "Draw at least $5M or there is nothing to document." };
  const points = Math.round(draw * qt.points);
  const fees = Math.round(draw * 0.01) + points;
  const cost = qt.payoff + qt.penalties + fees;
  if (draw + s.cash < cost) {
    return { s, err: `The proceeds do not clear the existing paper — $${((cost - draw) / 1e6).toFixed(2)}M short after $${(qt.penalties / 1e6).toFixed(2)}M of prepayment penalties.` };
  }
  const next: GameState = cloneState(s);
  const replacing = !!next.facility;
  if (next.facility) next.facility = undefined;
  // Clear the deeds. The mortgages are repaid at the closing table out of the
  // facility's proceeds, which is why the principal does not touch the ledger:
  // it is one lender's balance replacing another's, and no expense happens.
  for (const bbl of pool) {
    const h = next.holdings[bbl];
    if (h?.loan) {
      bumpLenderRel(next, productById(h.loan.product).lender, 0.4);
      h.loan = null;
    }
    // Mezz is repaid at the same closing — a facility is a first lien on the
    // pool and will not sit behind Cordage junior.
    if (h?.mezz) {
      bumpLenderRel(next, h.mezz.holder ?? "Cordage Debt Partners", 0.3);
      h.mezz = null;
    }
    // A building cannot be in a workout and in a facility: the file is settled
    // by the payoff, because the loan it was filed against no longer exists.
    if (next.workouts?.[bbl]) delete next.workouts[bbl];
  }
  const io = qt.ioM;
  const pmt = facilityPmt(draw, qt.ratePct, io, qt.amortYears);
  next.facility = {
    bbls: [...pool],
    balance: draw,
    ratePct: qt.ratePct,
    lender: qt.lender,
    productId: qt.productId,
    originM: next.month,
    maturityM: next.month + qt.termM,
    ioUntilM: next.month + io,
    amortYears: qt.amortYears,
    monthlyPmt: pmt,
    minDSCR: qt.minDSCR,
    maxLTV: qt.advance,
    recourse: true,
    drawn: draw,
  };
  next.cash += draw - cost;
  // Fees and prepayment penalties are an expense. Principal that replaces
  // old mortgages is a wash on cash once those mortgages are paid off at the
  // table; any surplus that lands in the operating account is a cash-out
  // draw and belongs in `borrowed`, the same bucket a cash-out refinance uses.
  // conserve's identity used to be blind to both.
  logBooks(next, "debtSvc", fees + qt.penalties);
  const cashOut = draw - qt.payoff;
  if (cashOut > 0) logBooks(next, "borrowed", cashOut);
  else if (cashOut < 0) logBooks(next, "debtSvc", -cashOut);
  next.news.unshift({
    q: next.month, kind: "deal",
    text: `${qt.lender} has ${replacing ? "refinanced the book with" : "papered"} a $${(draw / 1e6).toFixed(1)}M facility across ${pool.length} buildings at `
      + `${qt.ratePct.toFixed(2)}% — ${qt.quality.why}. `
      + (qt.payoff > 0 ? `$${(qt.payoff / 1e6).toFixed(1)}M of existing paper repaid` + (qt.penalties > 0 ? ` and $${(qt.penalties / 1e6).toFixed(2)}M of penalties to break it. ` : ". ") : "")
      + `The pool is crossed: every deed in it stands behind the whole balance, and you have signed personally.`,
  });
  return { s: next };
}

/** A pledged building's share of the balance, allocated by value. */
export function allocatedAmount(s: GameState, parcels: ParcelTable, bbl: string): number {
  const f = s.facility;
  if (!f || !f.bbls.includes(bbl)) return 0;
  let tot = 0, mine = 0;
  for (const b of f.bbls) {
    const h = s.holdings[b];
    const rec = resolveRec(parcels, s, b);
    if (!h || !rec) continue;
    const v = ownedHoldingValue(s, parcels, h);
    tot += v;
    if (b === bbl) mine = v;
  }
  return tot > 0 ? Math.round(f.balance * (mine / tot)) : 0;
}

/**
 * WHAT IT COSTS TO TAKE A BUILDING BACK OUT. The allocated share at the
 * release premium — and the balance comes down by what you pay, so a release
 * is a paydown and not a fee. The premium is the part that hurts: you are
 * repaying more than the building was carrying, so every release deleverages
 * the pool and leaves you with less debt than you wanted on the buildings you
 * kept. That asymmetry is the clause working as intended.
 */
export function releaseCost(s: GameState, parcels: ParcelTable, bbl: string): number {
  const alloc = allocatedAmount(s, parcels, bbl);
  return Math.min(s.facility?.balance ?? 0, Math.round(alloc * RELEASE_PREMIUM));
}

/** Take a deed out of the pool by paying the release price in cash. */
export function releaseFromFacility(s: GameState, parcels: ParcelTable, bbl: string): { s: GameState; err?: string } {
  const f = s.facility;
  if (!f || !f.bbls.includes(bbl)) return { s, err: "That building is not pledged." };
  if (f.bbls.length <= FACILITY_MIN_ASSETS && f.balance > 0) {
    return { s, err: `A facility needs at least ${FACILITY_MIN_ASSETS} deeds behind it. Repay the balance to unwind it.` };
  }
  const price = releaseCost(s, parcels, bbl);
  // A release is what a sponsor pays at a closing table to hand over clean
  // title, and no sponsor lets that closing fail over a thin operating account
  // while the revolver is open — the sale proceeds land the same month. The
  // premium, the three-deed floor and the deleveraging are all untouched: this
  // only stops the refusal that no principal would accept.
  const room = spendable(s, parcels);
  if (room.total < price) {
    return {
      s,
      err: `The release price is $${(price / 1e6).toFixed(2)}M and you can raise `
        + `$${(room.total / 1e6).toFixed(2)}M — $${(room.cash / 1e6).toFixed(2)}M of cash and `
        + `$${(room.line / 1e6).toFixed(2)}M on the line.`,
    };
  }
  const next: GameState = cloneState(s);
  const nf = next.facility!;
  const paid = fundAndBook(next, parcels, price, "debtSvc");
  nf.balance = Math.max(0, nf.balance - paid);
  nf.bbls = nf.bbls.filter((b) => b !== bbl);
  const rec = resolveRec(parcels, next, bbl);
  next.news.unshift({
    q: next.month, kind: "info",
    text: `Released ${rec?.address ?? bbl} from the facility for $${(paid / 1e6).toFixed(2)}M — `
      + `${Math.round((RELEASE_PREMIUM - 1) * 100)}% over its allocated share. Balance $${(nf.balance / 1e6).toFixed(1)}M.`,
  });
  if (nf.balance <= 0) {
    delete next.facility;
    next.news.unshift({ q: next.month, kind: "deal", text: "The facility is repaid and the deeds are unencumbered." });
  }
  return { s: next };
}

/**
 * ORIGINATION COST AT A GIVEN DRAW — one point of fee plus the desk's points.
 * The card quotes this at the base, the close charges it at the draw, and the
 * refinancing charges it again on the rolled balance. Same formula every time.
 */
function facilityFees(draw: number, points: number): number {
  return Math.round(draw * 0.01) + Math.round(draw * points);
}

/**
 * ROLL THE POOL ONTO NEW PAPER. Same deeds, same cross-default, new terms.
 *
 * Returns the dollars taken out of liquidity (fees, plus any paydown when the
 * new base is smaller than the old balance) WITHOUT booking them, because the
 * two callers book on different lines: the monthly tick reports its cash to
 * `sim` which puts it on `debtSvc`, and the player action books it here. A
 * cash-out above the old balance is an inflow either way and is booked to
 * `borrowed` on the spot — the same bucket `openFacility` uses, so conserve's
 * identity can see it.
 */
function takeFacilityRoll(
  s: GameState, parcels: ParcelTable, qt: FacilityQuote, draw: number,
): { spent: number; cashOut: number; oldBal: number; oldRate: number; oldLender: string } {
  const f = s.facility!;
  const q = s.month;
  const oldBal = f.balance, oldRate = f.ratePct, oldLender = f.lender;
  const fees = facilityFees(draw, qt.points);
  const paydown = Math.max(0, oldBal - draw);
  const spent = fundCashNeed(s, parcels, fees + paydown);
  const cashOut = Math.max(0, draw - oldBal);
  if (cashOut > 0) {
    s.cash += cashOut;
    logBooks(s, "borrowed", cashOut);
  }
  // The old desk is repaid in full and remembers it; the new one opens a file.
  bumpLenderRel(s, oldLender, 0.4);
  bumpLenderRel(s, qt.lender, 2);
  // The new lender takes a lien on what is actually there. A deed that left the
  // book by any route cannot stand behind the new paper — the same sweep
  // `tickFacility` runs at the top of every month.
  f.bbls = f.bbls.filter((b) => s.holdings[b]);
  f.balance = draw;
  f.drawn = draw;
  f.ratePct = qt.ratePct;
  f.lender = qt.lender;
  f.productId = qt.productId;
  f.originM = q;
  f.maturityM = q + qt.termM;
  f.ioUntilM = q + qt.ioM;
  f.amortYears = qt.amortYears;
  f.monthlyPmt = facilityPmt(draw, qt.ratePct, qt.ioM, qt.amortYears);
  f.minDSCR = qt.minDSCR;
  // The covenant ceiling is the ADVANCE RATE, exactly as `openFacility` stores
  // it — retesting a refinanced pool against `product.maxLTV` instead would
  // silently move the wall the moment the paper rolled.
  f.maxLTV = qt.advance;
  f.recourse = true;
  // New paper, and the defaults on the old paper died with it: the balance the
  // new desk underwrote is the balance it just funded. Anything unresolved would
  // have stopped the underwriting above.
  f.arrearsMs = 0;
  delete f.breachedSince;
  delete f.sweep;
  delete f.accelM;
  delete f.noticedM;
  // Stamped so the inbox says the pool renewed, once, in the month it happened.
  (f as { renewedM?: number }).renewedM = q;
  return { spent, cashOut, oldBal, oldRate, oldLender };
}

/**
 * THE POOL'S OWN REFINANCING DESK.
 *
 * There was none. `openFacility` refuses while a facility exists and
 * `refiQuotes` marks every product unavailable on a pledged deed, so the only
 * exit from a crossed pool was paying the whole balance in cash — and at
 * maturity the engine accelerated in the tick the loan came due. A borrower
 * with a performing pool and a lender who will write it is not in default, and
 * that is what this function is: re-underwrite the SAME pool at today's rates
 * and values through `facilityQuotes`, so the three tests the new balance must
 * clear are the same three the original close cleared.
 *
 * `lev` scales the new draw off the base the way the opening slider does. Below
 * the old balance it is a paydown out of liquidity; above it, cash out.
 */
export function refinanceFacility(
  s: GameState, parcels: ParcelTable, productId: string, lev = 1,
): { s: GameState; err?: string; msg?: string } {
  const f = s.facility;
  if (!f) return { s, err: "No facility to refinance." };
  if (f.accelM !== undefined) return { s, err: "The facility is accelerated — a receiver has the pool and there is nothing left to refinance." };
  const pool = f.bbls.filter((b) => s.holdings[b]);
  const quotes = facilityQuotes(s, parcels, pool);
  const qt = quotes.find((x) => x.productId === productId);
  if (!qt) return { s, err: "That desk does not write facilities." };
  if (!qt.available) return { s, err: qt.why ?? "That desk will not quote this pool today." };
  const draw = Math.floor(qt.base * Math.max(0.1, Math.min(1, lev)));
  if (draw < FACILITY_MIN_LOAN) return { s, err: "Draw at least $5M or there is nothing to document." };
  const fees = facilityFees(draw, qt.points);
  const need = fees + Math.max(0, f.balance - draw);
  const room = spendable(s, parcels);
  if (room.total < need) {
    return {
      s,
      err: `Closing costs $${(need / 1e6).toFixed(2)}M — $${(fees / 1e6).toFixed(2)}M of fees and points`
        + (f.balance > draw ? ` plus a $${((f.balance - draw) / 1e6).toFixed(2)}M paydown, because ${qt.lender} will only write $${(draw / 1e6).toFixed(1)}M against a $${(f.balance / 1e6).toFixed(1)}M balance` : "")
        + `. You can raise $${(room.total / 1e6).toFixed(2)}M.`,
    };
  }
  const terms = facilityDrawTerms(draw, qt.ratePct, qt.ioM, qt.amortYears, qt.quality.noi, qt.quality.value);
  const next: GameState = cloneState(s);
  const r = takeFacilityRoll(next, parcels, qt, draw);
  logBooks(next, "debtSvc", r.spent);
  next.news.unshift({
    q: next.month, kind: "deal",
    text: `${qt.lender} has refinanced the facility — $${(draw / 1e6).toFixed(1)}M across ${pool.length} buildings at `
      + `${qt.ratePct.toFixed(2)}% for ${Math.round(qt.termM / 12)} years, against ${r.oldRate.toFixed(2)}% on the old paper. `
      + `$${Math.round(terms.monthlyPmt / 1000)}K a month, ${terms.dscr.toFixed(2)}x covered against a ${qt.minDSCR.toFixed(2)}x covenant`
      + (r.cashOut > 0 ? `, and $${(r.cashOut / 1e6).toFixed(2)}M of it came out as cash.` : ".")
      + ` The pool stays crossed and the guarantee stays signed.`,
  });
  return {
    s: next,
    msg: r.cashOut > 0
      ? `Refinanced at ${qt.ratePct.toFixed(2)}% — $${(r.cashOut / 1e6).toFixed(2)}M out.`
      : `Refinanced at ${qt.ratePct.toFixed(2)}%, due ${monthLabel(next.month + qt.termM)}.`,
  };
}

/**
 * THE LENDER'S OWN RENEWAL TEST, at the full outstanding balance.
 *
 * A performing loan renewing at maturity is what happens in life — the desk has
 * twelve years of payment history and would rather roll it than take the
 * collateral. A desk renewing a loan that FAILS its coverage and leverage tests
 * is not; that is the refinancing cliff, and it is one of the named reasons this
 * business is hard. So the split is exactly that and nothing softer: if some
 * desk's borrowing base covers the whole balance plus the closing costs, take
 * the cheapest of them automatically and say so. If none does, the pool does not
 * quietly renew at a fake number — it gets the cure window below.
 *
 * `facilityQuotes` is the underwriting; nothing here bypasses it.
 */
function renewalMarket(s: GameState, parcels: ParcelTable): { best: FacilityQuote | null; base: number } {
  const f = s.facility!;
  const pool = f.bbls.filter((b) => s.holdings[b]);
  // A pool that has shrunk below the smallest anybody papers is not a facility
  // any more, and no desk will re-document it at any price.
  if (pool.length < FACILITY_MIN_ASSETS) return { best: null, base: 0 };
  const open = facilityQuotes(s, parcels, pool).filter((x) => x.available);
  // What today's market will advance against this pool at all — the number the
  // gap is named against when nothing clears.
  const base = open.length ? Math.max(...open.map((x) => x.base)) : 0;
  // A ROLL IS SIZED ON THE BALANCE, NOT ON THE BALANCE PLUS THE FEE.
  //
  // This asked each desk to advance the outstanding balance AND the cost of
  // writing it, and refused the renewal when it could only manage the balance.
  // But the fee is not advanced — the borrower writes that cheque, which is
  // exactly what `takeFacilityRoll` does two lines later. So the test failed by
  // its own fee on the commonest case there is: a pool whose balance was sized
  // off this same underwriting, which therefore quotes at exactly the balance
  // and never a dollar more.
  //
  // What that cost the owner was not a missed renewal, it was the whole firm.
  // The refusal fell through to "retire it out of liquidity", so a performing
  // pool with two desks bidding 4.74% and 4.93% against it emptied the
  // operating account and drew the revolver to the floor — measured on a
  // $5.631M facility: cash $2.000M to zero, $3.643M drawn on the line, term
  // debt in the fives swapped for a callable line at index + 400. The owner
  // reported it as "it draws my line of credit and the debt is still there",
  // and from where they were sitting that is precisely what happened.
  const clears = open.filter((x) => x.base >= f.balance);
  // Best-priced, not first-on-a-list: the borrower takes the lowest coupon that
  // will actually write the whole balance.
  return { best: clears.length ? clears.reduce((a, b) => (b.ratePct < a.ratePct ? b : a)) : null, base };
}

/**
 * Pay the balance down out of cash — and out of cash ONLY, deliberately.
 *
 * Every other refusal in this file now counts the revolver, because a sponsor
 * with an open line does not let a closing or a covenant fail over a thin
 * month. A VOLUNTARY paydown is the one case where drawing it is simply worse
 * money: the facility is term debt in the fives and the line is index plus 400,
 * so funding this from the revolver raises the interest bill and spends the
 * liquidity that keeps the next bad quarter from becoming a default. The
 * mandatory version of this payment — the coupon, the balloon, the cure — draws
 * the line already.
 */
export function repayFacility(s: GameState, amount: number): { s: GameState; err?: string } {
  const f = s.facility;
  if (!f) return { s, err: "No facility." };
  const pay = Math.min(Math.floor(Math.max(0, amount)), f.balance, Math.floor(Math.max(0, s.cash)));
  if (pay <= 0) return { s, err: "Nothing to pay with." };
  const next: GameState = cloneState(s);
  next.cash -= pay;
  logBooks(next, "debtSvc", pay);
  next.facility!.balance -= pay;
  if (next.facility!.balance <= 0) {
    delete next.facility;
    next.news.unshift({ q: next.month, kind: "deal", text: "The facility is repaid in full. Every deed in the pool is unencumbered again." });
  }
  return { s: next };
}

/** Pool coverage and leverage as the lender tests them, for the covenant and the screen. */
export function facilityMetrics(s: GameState, parcels: ParcelTable): {
  value: number; noi: number; dscr: number | null; ltv: number | null; debtYield: number | null; annualDs: number;
} {
  const f = s.facility;
  if (!f) return { value: 0, noi: 0, dscr: null, ltv: null, debtYield: null, annualDs: 0 };
  let value = 0, noi = 0;
  for (const bbl of f.bbls) {
    const h = s.holdings[bbl];
    const rec = resolveRec(parcels, s, bbl);
    if (!h || !rec) continue;
    value += ownedHoldingValue(s, parcels, h);
    noi += ownedHoldingNoiYr(s, parcels, h);
  }
  const annualDs = f.monthlyPmt * 12;
  return {
    value, noi,
    dscr: annualDs > 0 ? noi / annualDs : null,
    ltv: value > 0 ? f.balance / value : null,
    debtYield: f.balance > 0 ? noi / f.balance : null,
    annualDs,
  };
}

/**
 * ONE MONTH OF THE FACILITY. The same shape as `tickLoan` and deliberately so —
 * a payment, a covenant test, an equity cure, a sweep, and an acceleration at
 * the end of the road — because a borrower should not have to learn two sets of
 * rules, and because the pool version of each of those is the interesting half
 * of what a facility does to you.
 */
export function tickFacility(s: GameState, parcels: ParcelTable): number {
  const f = s.facility;
  if (!f) return 0;
  const q = s.month;
  // A deed that has left the book cannot stand behind anything. `acceptSaleOffer`
  // settles the release at the closing table; this is the sweep for every other
  // way a building can leave — a deed in lieu, a receiver, an exchange.
  f.bbls = f.bbls.filter((b: string) => s.holdings[b]);

  if (f.accelM !== undefined) return accelerate(s, parcels);

  const io = q < f.ioUntilM;
  const yearsLeft = Math.max(1, f.amortYears - (q - f.originM) / 12);
  f.monthlyPmt = facilityPmt(f.balance, f.ratePct, io ? f.ioUntilM - q : 0, yearsLeft);
  const interest = (f.balance * f.ratePct) / 100 / 12;
  const principalWanted = io ? 0 : Math.max(0, Math.min(f.balance, f.monthlyPmt - interest));
  // Cash first, then the line — same stack as a single-asset loan. Going
  // straight to `s.cash -=` left the revolver unused while the facility
  // breached on a temporary cash hole.
  //
  // AND ONLY FUNDED DOLLARS AMORTIZE. This used to cut principal and return
  // the full coupon even when fundCashNeed paid $0 — free delever and a
  // Books line that lied about debt service. Amortize and book the dollars
  // that actually cleared.
  const funded = fundCashNeed(s, parcels, f.monthlyPmt);
  const principalPay = f.monthlyPmt > 0
    ? Math.round(principalWanted * (funded / f.monthlyPmt))
    : 0;
  f.balance = Math.max(0, f.balance - principalPay);
  let out = funded;
  // MISSED COUPON. Partial payment used to end here with no clock — covenants
  // could still clear and the unpaid interest vanished. Accrue what was not
  // funded onto the balance and count consecutive short months toward a
  // payment default (same shape as single-asset arrears, pool-wide).
  const unpaid = Math.max(0, f.monthlyPmt - funded);
  if (unpaid > 0) {
    const unpaidInterest = Math.min(unpaid, Math.max(0, interest));
    f.balance = Math.round(f.balance + unpaidInterest);
    f.arrearsMs = (f.arrearsMs ?? 0) + 1;
    if ((f.arrearsMs ?? 0) >= 3) {
      f.breachedSince ??= q;
      f.sweep = true;
      if ((f.arrearsMs ?? 0) >= FACILITY_CURE_M && f.accelM === undefined) {
        f.accelM = q;
        s.news.unshift({
          q, kind: "warn",
          text: `${f.lender} has accelerated the facility after ${f.arrearsMs} months of unpaid debt service. `
            + `The whole balance is due over all ${f.bbls.length} buildings.`,
        });
        return out;
      }
      if (f.arrearsMs === 3) {
        s.news.unshift({
          q, kind: "warn",
          text: `Three months of short facility payments — ${f.lender} has put the pool into default. `
            + `Cash flow is swept and you have ${FACILITY_CURE_M} months to bring it current or they accelerate.`,
        });
      }
    } else {
      // MONTHS ONE AND TWO USED TO BE SILENT. The clock that ends with a
      // receiver selling every building in the pool started with nothing on the
      // screen at all — no news, no inbox row — and the player first heard about
      // it in month three. The runway is unchanged; what changes is that it is
      // now audible from the first missed dollar.
      s.news.unshift({
        q, kind: "warn",
        text: `The facility payment came up ${dollars(unpaid)} short — month ${f.arrearsMs} of `
          + `${f.lender}'s cheque unpaid, and the shortfall is on the balance at ${f.ratePct.toFixed(2)}%. `
          + `A third month puts all ${f.bbls.length} buildings into default with the cash flow swept.`,
      });
    }
  } else {
    f.arrearsMs = 0;
  }

  const m = facilityMetrics(s, parcels);
  const holiday = q < f.originM + 12;
  let breached = !holiday && ((m.dscr !== null && m.dscr < f.minDSCR) || (m.ltv !== null && m.ltv > f.maxLTV));

  // THE EQUITY CURE, POOL-WIDE. Identical in kind to the one on a single loan —
  // pay principal down to the covenant out of CASH (not the revolver). Single-
  // asset cures already refuse the line (`allowLoc: false`) so a thin sponsor
  // cannot immortalize a breach by drawing; the facility used to let them.
  // What is different is the SIZE: a covenant struck against a whole book
  // needs a whole book's worth of cure, and that is the honest reason a
  // facility is dangerous. There is no cure small enough to be painless.
  if (breached && fundableNow(s, parcels, { allowLoc: false }) > 0) {
    let target = f.balance;
    if (m.dscr !== null && m.dscr < f.minDSCR) target = Math.min(target, f.balance * (m.dscr / f.minDSCR));
    if (m.ltv !== null && m.ltv > f.maxLTV && m.value > 0) target = Math.min(target, f.maxLTV * m.value);
    const need = Math.ceil(f.balance - target);
    const pay = fundCashNeed(s, parcels, need, { allowLoc: false });
    if (pay > 0) {
      f.balance -= pay;
      out += pay;
      if (pay >= need) {
        breached = false;
        delete f.breachedSince;
        delete f.sweep;
        s.news.unshift({
          q, kind: "info",
          text: `Cured the facility covenant with a $${(pay / 1e6).toFixed(2)}M paydown. Balance $${(f.balance / 1e6).toFixed(1)}M.`,
        });
      }
    }
  }

  if (breached) {
    if (f.breachedSince === undefined) {
      f.breachedSince = q;
      f.sweep = true;
      s.news.unshift({
        q, kind: "warn",
        text: `${f.lender} has called a default on the facility — `
          + (m.dscr !== null && m.dscr < f.minDSCR
            ? `coverage is ${m.dscr.toFixed(2)}x against a ${f.minDSCR.toFixed(2)}x covenant. `
            : `leverage is ${((m.ltv ?? 0) * 100).toFixed(0)}% against a ${(f.maxLTV * 100).toFixed(0)}% covenant. `)
          + `Every building in the pool is swept, and you have ${FACILITY_CURE_M} months to cure it or they accelerate. `
          + `This is what crossed means.`,
      });
    } else if (q - f.breachedSince >= FACILITY_CURE_M) {
      f.accelM = q;
      s.news.unshift({
        q, kind: "warn",
        text: `${f.lender} has accelerated the facility. The whole balance is due and a receiver is being appointed over `
          + `all ${f.bbls.length} buildings.`,
      });
      return out;
    }
  } else if (f.breachedSince !== undefined && (f.arrearsMs ?? 0) === 0) {
    delete f.breachedSince;
    // A called maturity keeps the sweep on its own account — clearing a
    // covenant test does not un-mature the loan.
    if (f.noticedM === undefined) delete f.sweep;
    s.news.unshift({
      q, kind: "deal",
      text: f.noticedM === undefined
        ? "The facility is back inside its covenants and the sweep has been lifted."
        : "The facility is back inside its covenants, but the maturity is still called and the pool is still swept.",
    });
  }

  // THE SWEEP IS A TRAP, NOT A FLAG. Single-asset loans skim surplus NOI into
  // principal (`tickLoan`); the facility used to announce a pool-wide sweep
  // and still let every building's cash flow reach the sponsor.
  if (f.sweep && f.balance > 0) {
    let poolNoi = 0;
    for (const bbl of f.bbls) {
      const h = s.holdings[bbl];
      if (!h) continue;
      poolNoi += ownedMonthlyNoi(s, parcels, h);
    }
    const surplus = Math.max(0, Math.floor(poolNoi - funded));
    const skim = Math.min(surplus, Math.max(0, Math.floor(s.cash)), f.balance);
    if (skim > 0) {
      s.cash -= skim;
      f.balance = Math.max(0, f.balance - skim);
      out += skim;
    }
  }

  // THE BALLOON. A facility matures like any other term loan and it matures
  // ALL AT ONCE — the single maturity that made the paperwork simple is a
  // single maturity to refinance in whatever market happens to be open that
  // year. Pay it, refinance it, or it is accelerated.
  //
  // AND IT IS A LADDER, NOT A CLIFF EDGE. This used to set `accelM` in the same
  // tick the loan came due whenever liquidity fell short of the balance: no
  // notice, no desk, no extension, and three months later a receiver sold every
  // building in the pool. A single mortgage has walked a whole ladder at its
  // balloon for as long as the engine has had one (tickLoan) — renew it, retire
  // it, write the gap cheque, or open a file with six months' notice. A crossed
  // pool, the biggest loan on the book, had nothing. The steps below are that
  // same ladder, pool-wide:
  //
  //   1  liquidity covers it        pay it off, deeds clear
  //   2  a desk underwrites it      renew automatically at the best price
  //   3  nobody will write it all   CALL the maturity and open the cure window
  //   4  the window runs out        accelerate, receiver, distress sale
  //
  // Step 3 is the refinancing cliff and it still kills the pool. What it no
  // longer does is kill it silently and instantly: for FACILITY_CURE_M months —
  // the same window a covenant breach and a payment default get — the borrower
  // can refinance (the market reopens, values recover), pay the balance down
  // below what somebody will write, or sell into it. The lender keeps collecting
  // the coupon and sweeping the surplus the whole time, which is what a real
  // standstill looks like.
  if (q >= f.maturityM && f.balance > 0) {
    // THE MARKET IS ASKED FIRST, AND IT USED NOT TO BE.
    //
    // This block opened with "can the firm raise the balance?" — counting the
    // REVOLVER — and if it could, the pool was retired on the spot out of every
    // dollar of cash and line the firm had. Nobody ever asked whether a lender
    // would have rolled it. So a performing pool at maturity emptied the
    // operating account, drew the line to the floor, and handed back deeds the
    // bank would happily have kept lending against; from the owner's seat the
    // liquidity simply vanished at maturity and the reason given was that it
    // had been "paid off".
    //
    // It is also backwards on price. The revolver is index + 400 and callable;
    // facility paper is term debt at a spread over the index. Retiring the
    // cheap loan with the expensive one is the single worst trade available at
    // a maturity, and the engine was making it automatically.
    //
    // The order is the ladder a sponsor actually walks: roll it if anyone will
    // write it, retire it out of liquidity only if nobody will, and call the
    // maturity when neither is possible. The renewal branch's own closing line
    // — "a pool that covers its debt service gets renewed; that is what the
    // payment history is for" — could not print at all before this, because
    // solvency short-circuited it.
    const market = renewalMarket(s, parcels);
    const renewal = market.best;
    if (renewal) {
      const rolled = f.balance;
      const wasCalled = f.noticedM !== undefined;
      const r = takeFacilityRoll(s, parcels, renewal, rolled);
      // The fee goes out on the same line as the rest of the month's facility
      // cash — `sim` books what this function returns to debtSvc, so booking it
      // here as well would charge the ledger twice for one cheque.
      out += r.spent;
      const terms = facilityDrawTerms(rolled, renewal.ratePct, renewal.ioM, renewal.amortYears, renewal.quality.noi, renewal.quality.value);
      s.news.unshift({
        q, kind: "deal",
        text: `${renewal.lender} has renewed the facility at maturity — the same ${dollars(rolled)} across `
          + `${f.bbls.length} buildings at ${renewal.ratePct.toFixed(2)}% for ${Math.round(renewal.termM / 12)} years `
          + `(was ${r.oldRate.toFixed(2)}%), ${dollars(r.spent)} of fees and points. `
          + `${dollars(terms.monthlyPmt)} a month, ${terms.dscr.toFixed(2)}x covered against a `
          + `${renewal.minDSCR.toFixed(2)}x covenant, due ${monthLabel(f.maturityM)}. `
          + (wasCalled
            ? "The called maturity is withdrawn and the sweep lifted."
            : "A pool that covers its debt service gets renewed; that is what the payment history is for."),
      });
      return out;
    }
    // NOBODY WILL WRITE IT. Now liquidity is the question, and now spending it
    // is the right answer rather than a reflex: paying the pool off here is what
    // stops a called maturity, a swept pool and a receiver. The line is in scope
    // for exactly that reason — it is a last resort against default, which is
    // the one job it should be doing at a maturity.
    if (fundableNow(s, parcels) >= f.balance) {
      const paid = fundCashNeed(s, parcels, f.balance);
      out += paid;
      const cleared = f.balance;
      f.balance = 0;
      delete s.facility;
      s.news.unshift({
        q, kind: "deal",
        text: `The facility matured, no desk would refinance the pool, and you retired the `
          + `${dollars(cleared)} out of firm liquidity. The deeds are clear.`,
      });
      return out;
    }

    // NOBODY WILL WRITE THE WHOLE BALANCE. Call the maturity and start the clock.
    const base = market.base;
    const gap = Math.max(0, f.balance - base);
    if (f.noticedM === undefined) {
      f.noticedM = q;
      // A matured, unpaid loan is in default whatever the covenants say, and a
      // defaulted crossed pool is swept. Cash flow stops reaching the sponsor
      // here rather than at the receiver's sale.
      f.sweep = true;
      s.news.unshift({
        q, kind: "warn",
        text: `The facility matured with ${dollars(f.balance)} outstanding and no desk will refinance the whole of it — `
          + (base > 0
            ? `today's market writes ${dollars(base)} against this pool, ${dollars(gap)} short. `
            : `nobody will quote this pool at all today. `)
          + `${f.lender} has called the maturity and swept the pool's cash flow. You have ${FACILITY_CURE_M} months `
          + `to refinance it, `
          + (base > 0 ? `pay the balance down under ${dollars(base)}` : "pay it off")
          + `, or sell buildings out of it — after that a receiver sells all ${f.bbls.length} at once, `
          + `and the facility is recourse.`,
      });
    } else if (q - f.noticedM >= FACILITY_CURE_M) {
      f.accelM = q;
      s.news.unshift({
        q, kind: "warn",
        text: `${FACILITY_CURE_M} months since ${f.lender} called the facility's maturity and ${dollars(f.balance)} is `
          + `still outstanding`
          + (base > 0 ? ` against a market that will write ${dollars(base)}` : ", with no desk quoting the pool")
          + `. They have accelerated: a receiver is being appointed over all ${f.bbls.length} buildings.`,
      });
      return out;
    }
  }
  return out;
}

/**
 * THE RECEIVER. When a crossed facility is accelerated the lender does not take
 * one building — the whole pool is security for the whole balance, so the whole
 * pool is sold. What comes back is the distressed price, because a forced sale
 * of a dozen buildings into the same market at the same time is the definition
 * of a distressed price, and any surplus over the balance belongs to the
 * borrower. That surplus is usually nothing, which is the point: the cost of a
 * crossed pool is that one failure takes everything, not one building.
 */
function accelerate(s: GameState, parcels: ParcelTable): number {
  const f = s.facility!;
  const q = s.month;
  // A month of grace between the acceleration and the sale — the receiver has
  // to be appointed and the assets marketed, however briefly.
  if (q - (f.accelM ?? q) < 3) {
    f.balance = Math.round(f.balance + (f.balance * (f.ratePct + 2)) / 100 / 12);   // default rate
    return 0;
  }
  let gross = 0;
  const taken: string[] = [];
  for (const bbl of [...f.bbls]) {
    const h = s.holdings[bbl];
    const rec = resolveRec(parcels, s, bbl);
    if (!h || !rec) continue;
    const px = Math.round(ownedHoldingValue(s, parcels, h) * distressPrice(s));
    gross += px;
    taken.push(rec.address);
    recordComp(s, rec, px, "a receiver", firmShort(s), true, h.condition);
    delete s.holdings[bbl];
    if (s.workouts?.[bbl]) delete s.workouts[bbl];
  }
  // The receiver's costs come out of the collateral before the lender is paid,
  // which is why a borrower almost never sees a surplus.
  const costs = Math.round(gross * 0.06);
  const surplus = Math.max(0, gross - costs - f.balance);
  if (surplus > 0) {
    s.cash += surplus;
    logBooks(s, "sold", surplus);
  }
  s.news.unshift({
    q, kind: "warn",
    text: `The receiver has sold the pool. ${taken.length} buildings gone for $${(gross / 1e6).toFixed(1)}M against a `
      + `$${(f.balance / 1e6).toFixed(1)}M balance`
      + (surplus > 0 ? `, and $${(surplus / 1e6).toFixed(2)}M came back to you.` : ` — nothing came back.`)
      + (f.recourse ? " The facility was recourse, so what it did not cover follows you." : ""),
  });
  // Recourse means the shortfall is yours, not the lender's problem.
  const short = Math.max(0, f.balance - Math.max(0, gross - costs));
  delete s.facility;
  if (short > 0 && f.recourse) {
    s.cash -= short;
    logBooks(s, "debtSvc", short);
  }
  return 0;
}

/** Every building the facility has a lien on, for the panels that need to say so. */
export function pledged(s: GameState, bbl: string): boolean {
  return !!s.facility?.bbls.includes(bbl);
}

/** Which buildings can go into a pool today: owned, standing, and not in a workout. */
export function pledgeable(s: GameState, parcels: ParcelTable): { bbl: string; rec: ParcelRecord; h: Holding; value: number; loan: number }[] {
  const out: { bbl: string; rec: ParcelRecord; h: Holding; value: number; loan: number }[] = [];
  for (const h of Object.values(s.holdings)) {
    const rec = resolveRec(parcels, s, h.bbl);
    // A performing leased fee is income collateral — not vacant dirt — even
    // when resolveRec still says "land" before the lessee tops out.
    const glIncome = h.groundLeased && (s.groundLeases?.[h.bbl]?.rentYr ?? 0) > 0;
    if (!rec || (!glIncome && (rec.class === "land" || !rec.bldgArea))) continue;
    if (s.workouts?.[h.bbl]) continue;
    if (h.sale) continue;
    out.push({
      bbl: h.bbl, rec, h,
      value: ownedHoldingValue(s, parcels, h),
      loan: h.loan?.balance ?? 0,
    });
  }
  return out.sort((a, b) => b.value - a.value);
}

/** A one-line description of where the facility stands, for the top of the page. */
export function facilityStatus(s: GameState, parcels: ParcelTable): string {
  const f = s.facility;
  if (!f) return "";
  const m = facilityMetrics(s, parcels);
  if (f.accelM !== undefined) return "ACCELERATED — the receiver is selling the pool";
  if (f.noticedM !== undefined) {
    const left = FACILITY_CURE_M - (s.month - f.noticedM);
    return `MATURITY CALLED — swept, ${left} month${left === 1 ? "" : "s"} to refinance or pay it down`;
  }
  if (f.breachedSince !== undefined) {
    const left = FACILITY_CURE_M - (s.month - f.breachedSince);
    return `IN DEFAULT — swept, ${left} month${left === 1 ? "" : "s"} to cure`;
  }
  if (f.maturityM - s.month <= 24) return `matures ${monthLabel(f.maturityM)} — start refinancing`;
  return `${(m.dscr ?? 0).toFixed(2)}x covered, ${((m.ltv ?? 0) * 100).toFixed(0)}% levered`;
}
