// THE BANKS ARE FIRMS TOO.
//
// Six lenders have had names, spreads and covenants since the beginning, and
// behind the names there was nothing: an infinite balance sheet that quoted
// the same terms in 2003 and 2009 except for a credit index nobody could see
// the inside of. So "the window slams shut" was a sentence in a blurb rather
// than something happening to somebody.
//
// A lender here now carries a book. It has capital behind it, loans out in
// front of it, borrowers who stop paying, and a capital ratio that decides
// whether it is lending this quarter or apologising. When the cycle turns and
// the delinquencies come, the ratio falls, the appetite goes with it, and the
// desk that was quoting 75% last year will not answer the phone — not because
// a global index moved, but because THAT BANK is in trouble, and you can open
// its books and see it coming.
//
// Which is the whole point: a credit crunch you can read a quarter early is a
// decision. One that arrives as a number going down is weather.
import type { GameState } from "./types";
import { logBooks, BUILT_CLASSES } from "./types";
import { PRODUCTS, underwritingStandards, windowOpen } from "./debt";
import { rng, rrange, RENT_BASE, NATURAL_VAC, CAP_BASE, labourSlack } from "./market";
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export type LenderKind = "bank" | "life" | "conduit" | "fund";

/**
 * WHOSE DEPOSITS THESE ARE — the liability side, which this model did not have.
 *
 * A bank in this game had a loan book and no depositors. It failed AT NOBODY:
 * the regulator walked in on a Friday, the paper went to a receiver, and not
 * one person in the city noticed. That is the half that was missing, and it is
 * the half the owner asked for.
 *
 * `uninsuredShare` is the fact that decides how much a failure hurts, and it is
 * a fact about WHO BANKS THERE rather than about the bank's size. A thrift full
 * of household savings is almost entirely insured and its failure travels by
 * the credit channel — the small businesses who cannot get a working-capital
 * line. A commercial bank full of business operating accounts is badly
 * uninsured, and when it fails payroll does not get made. Silicon Valley Bank
 * was ~94% uninsured in 2023, which is why a bank nobody had heard of nearly
 * took the payroll of half an industry with it; a community thrift runs nearer
 * a third.
 */
export interface Deposits {
  /** Household and business money on the books, in today's dollars. */
  total: number;
  /** Share of it above the insurance limit — see insuredLimit. */
  uninsuredShare: number;
}

export interface Lender {
  id: string;
  name: string;
  kind: LenderKind;
  /**
   * Everything they have lent, to you and to everyone else: the NAMED loans
   * the engine runs (loanbook.ts — yours, the street's, the cranes) plus the
   * anonymous book below. Recomputed every month as the sum of the two.
   */
  book: number;
  /**
   * The paper written to borrowers this game does not run as firms — the
   * owner-occupiers and small holders who own most of the deeds on the map.
   * Modelled as a population: it grows with appetite, goes bad with the
   * city's vacancy and the cycle (`anonDelinq`), and shrinks by what is
   * charged off. Absent on old saves (seeded from `book` on the first tick).
   */
  anonBook?: number;
  /** Share of the anonymous book not paying. The named book's is counted, not modelled. */
  anonDelinq?: number;
  /** Named dollars out, and of them not paying — last month's count, for the statement. */
  namedBook?: number;
  namedDefault?: number;
  /** The equity behind it. Losses come out of here. */
  capital: number;
  /** Share of the book that has stopped paying. */
  delinquent: number;
  /** Realised losses this year, and over the life of the firm. */
  chargeOffsYr: number;
  chargeOffsTotal: number;
  /** Interest earned less funding cost less losses, this year. */
  netIncomeYr: number;
  /** How much they want to lend right now, 0-1. Everything above decides it. */
  appetite: number;
  /** Out of the market entirely, and the month it happened. */
  /**
   * The panic surcharge on this desk's funding today, in points, while another
   * desk in town is in receivership. Zero the rest of the time. Stored rather
   * than recomputed so the Research page can show a player exactly what a
   * neighbour's failure is costing the desk they borrow from.
   */
  panicBps?: number;
  failedM?: number;
  /** Months until the franchise lends again under new owners (a bank: a P&A, days to weeks). */
  reopenM?: number;
  /** The receiver keeps the failed desk's bad paper and sells it down until this month (notes.ts). */
  receiverUntilM?: number;
  /** What they have lent to YOU — the part of the book you are. */
  yours: number;
  /** What the standing book yields — written over years, repricing only as loans roll. */
  bookYield?: number;
  /** What the money costs THIS month. Deposits lag the index; hot money does not. */
  fundCost?: number;
  /** Capital returned to the owners this year — a bank manages to a ratio, not a pile. */
  divYr?: number;
  /** Capital ratio, sampled quarterly. The statement's history. */
  capHist?: number[];
  /** What this desk holds against this town, by asset class. Rebuilt monthly by ledger.ts. */
  classBook?: Record<string, number>;
  /** The liability side. See Deposits. */
  dep?: Deposits;
  /** Where the PLAYER's cash sits, if it sits here. */
  playerDeposits?: number;
}

/**
 * Who each desk is, structurally. The kind decides how they are funded and
 * therefore how they behave when it goes wrong: a bank funded by deposits
 * takes losses slowly and survives; a conduit funded by selling paper into a
 * market stops existing the day that market closes.
 */
/**
 * `wholesale` is the share of the funding that is hot money — brokered CDs,
 * repo, bonds that must be rolled. Core deposits sleep through a rate shock;
 * wholesale money reprices the week the index moves, which is the S&L
 * mechanism and the reason the regional dies in a hiking cycle while the
 * hometown bank merely has a bad year.
 */
/**
 * `adc` is the share of the desk's book in acquisition, development and
 * construction loans — land and buildings that do not yet earn. It is the
 * book that went bad in 2008-10: noncurrent construction loans at US banks
 * reached ~16% (FDIC QBP, 2009-10) as land values fell 20-30% a year, against
 * ~4% on income property, and the banks that failed were the ones that held
 * it at three to five times capital. A typical bank carried 5-10% of its
 * book there; the 2008-10 failures carried 30-50%.
 */
const KIND: Record<string, { kind: LenderKind; capitalRatio: number; brittle: number; wholesale: number; adc: number; blurb: string }> = {
  "First Harbor Bank": {
    kind: "bank", capitalRatio: 0.11, brittle: 0.5, wholesale: 0.2, adc: 0.08,
    blurb: "Deposits fund the book, so the losses have to be very bad before the lights go out. Small, local, and they remember who paid them in the bad years.",
  },
  "Alden Savings & Trust": {
    kind: "bank", capitalRatio: 0.095, brittle: 0.8, wholesale: 0.65, adc: 0.15,
    blurb: "A regional with a regional's problem: big enough to have made every mistake in the cycle, small enough that three of them matter.",
  },
  "Pelican Life Insurance": {
    kind: "life", capitalRatio: 0.18, brittle: 0.25, wholesale: 0.1, adc: 0,
    blurb: "Insurance float against long paper. The most patient money in the city and the most conservative — they are never the reason a crunch happens and never the ones who end it.",
  },
  "Meridian Street Capital": {
    kind: "conduit", capitalRatio: 0.04, brittle: 2.4, wholesale: 1.0, adc: 0,
    blurb: "They do not hold the loan; they sell it. Which is fine until nobody is buying, and then this desk is not tightening — it is closed.",
  },
  // THE BANK THAT GREW ON CRANES (2026-10-13). A small community bank whose
  // book is mostly construction and land — the profile of the ~500 US banks
  // that failed in 2008-12 (FDIC OIG material loss reviews: ADC loans at
  // several times capital, growth funded with brokered deposits, capital
  // managed to the regulatory line). It prices construction a shade under
  // the regional to win the business, lends further on dirt than the
  // hometown bank will, and holds a large share of each job. In a boom it is
  // the cheapest crane in town; in a land-price collapse it is the first
  // name on the receiver's list.
  "Tidewater Community Bank": {
    kind: "bank", capitalRatio: 0.09, brittle: 1.4, wholesale: 0.5, adc: 0.45,
    blurb: "A small bank that grew fast on construction and land loans, funded by brokered deposits. The cheapest construction money in a boom — and the first desk the regulator visits when land stops selling.",
  },
  "Cordage Debt Partners": {
    kind: "fund", capitalRatio: 0.22, brittle: 1.1, wholesale: 0.3, adc: 0,   // bridge and mezz; no sourced ADC share
    blurb: "A fund with committed capital and no depositors to answer to. They lend into a crisis at crisis prices, which is the entire business model.",
  },
};

/**
 * What each kind's standing book is written at, over the index, and the
 * margin it ordinarily earns over its own funding (`baseFund` in
 * `tickLenders`: deposits at index − 2.2, the general account at index − 0.3, the bond
 * market at index + 0.3, committed capital at index + 1.1). The banks and the
 * insurer keep the number every desk used to carry; the conduit's book is a
 * warehouse of the same paper; the fund's is bridge and mezz.
 */
// A LIFE COMPANY EARNS A LIFE COMPANY'S SPREAD. Its book was carried at a
// bank's yield (index + 1.9, against Pelican's own 1.15 sheet) and funded at
// index − 1.4 like deposits, so it earned 3.2 points and returned ~2% on
// assets, twice what an insurer's mortgage portfolio does. Its sheet plus
// points and the quarter it charges standard buildings is ~1.4 over; its
// money is the general account, credited near the Treasury curve (annuity
// and GIC crediting rates) — index − 0.3. A 1.7-point margin is the ACLI
// portfolio-spread band (1.5-2.5).
const BOOK_SPREAD: Record<LenderKind, number> = { bank: 1.9, life: 1.4, conduit: 1.9, fund: 4.5 };
const NORMAL_NIM: Record<LenderKind, number> = { bank: 4.1, life: 1.7, conduit: 1.6, fund: 3.4 };
/**
 * WHAT IT COSTS TO RUN THE DESK, % of book a year, and what the government
 * takes (2026-10-13). Net income was interest less funding less charge-offs,
 * so the banks earned 3.3-3.8% on assets and 24-26% on capital, against a
 * real community bank's ~1.0-1.2% and 10-12% — which is most of why no bank
 * in a century of play ever failed. Sources: FDIC Quarterly Banking Profile,
 * community banks (non-interest expense ~2.8% of assets, non-interest income
 * ~0.7%: net ~2.0%); life companies' mortgage operations run on ~15bp
 * (ACLI; investment-expense ratios); a conduit's warehouse and servicing
 * ~20bp; a debt fund's management fee and expenses ~1% of assets. Tax: 21%
 * federal plus state, ~25%, on the taxable desks; a fund passes through.
 */
const OPEX_PCT: Record<LenderKind, number> = { bank: 2.0, life: 0.15, conduit: 0.20, fund: 1.0 };
const TAX_RATE: Record<LenderKind, number> = { bank: 0.25, life: 0.25, conduit: 0.25, fund: 0 };

/** Who writes construction paper in this town. Defined in types.ts, which
 * imports nothing, so the pro forma (proforma.ts, under value.ts) can name the
 * volume desk without pulling this module into its import cycle. */
import { CONSTRUCTION_LENDER } from "./types";
import { money } from "./money";
import { cityLoanBook, deskTotals } from "./loanbook";
import type { DeskTotals } from "./loanbook";
export { CONSTRUCTION_LENDER };

export function lenderBlurb(name: string): string {
  return KIND[name]?.blurb ?? "";
}

/** Every distinct lender named on a loan product, in the order they appear. */
export function lenderNames(): string[] {
  return [...new Set(PRODUCTS.map((p) => p.lender))];
}

/**
 * THE SHARE OF THIS TOWN'S PROPERTY DEBT EACH DESK HOLDS.
 *
 * A conduit is enormous and fragile; a hometown bank is neither. These are the
 * relative weights the five original absolute books were in, kept because the
 * SHAPE of the lending market — one dominant securitiser, a patient life
 * company, a regional, a small local, a fund — is a fact about the business.
 * What is no longer asserted is how big the market is; see initLenders.
 */
const BOOK_SHARE: Record<LenderKind | "firstharbor" | "tidewater", number> = {
  // Tidewater's book is ADDED (+70, ~3% more property debt), not carved out of
  // the regional: shrinking the regional pushed the street's loans past its
  // single-name limits onto the hometown bank, which then failed of
  // concentration in two of four measured centuries — a side effect, not the
  // mechanism this desk exists to add.
  conduit: 900 / 2410, life: 640 / 2410, fund: 310 / 2410, bank: 420 / 2410, firstharbor: 140 / 2410, tidewater: 70 / 2410,
};

/**
 * WHAT THE PROPERTY IN THIS TOWN IS WORTH, roughly, from its own rents.
 *
 * Income capitalised — the same way every other price in this engine is
 * discovered. Stock by class, at that class's opening rent net of a typical
 * operating load and its natural vacancy, divided by that class's opening cap
 * rate. It is an order-of-magnitude figure and it only ever has to be one:
 * nothing is priced off it, it only sets how big the banks are.
 */
function cityPropertyValue(stock: Record<string, number>, priceLevel = 1): number {
  let v = 0;
  for (const k of BUILT_CLASSES) {
    const sf = stock[k] ?? 0;
    if (sf <= 0) continue;
    // ~35% of gross goes out as opex and non-recovered costs across classes.
    const noiPsf = RENT_BASE[k] * priceLevel * (1 - NATURAL_VAC[k]) * 0.65;
    v += (sf * noiPsf) / (CAP_BASE[k] / 100);
  }
  return v;
}

export function initLenders(stock?: Record<string, number>, priceLevel = 1): Lender[] {
  // A CITY'S BANKS ARE THE SIZE OF THE CITY, AND THEY DERIVE IT.
  //
  // These five books were absolute numbers, which was fine while there was one
  // island at one size. The first fix was a scale factor against a reference
  // island — which worked, and was still an asserted number: it said "the
  // standard town has 15.35M sf" in a constant, so the engine only knew how
  // big a city was by comparing it to one particular city that happened to
  // ship. That is a label, not a mechanism, and it would have gone stale the
  // first time anybody retuned the generator.
  //
  // A property lender's book is a share of the property debt in its market,
  // and the property debt is a share of what the property is worth. So: value
  // the town from its own rents and cap rates, lend against it at a normal
  // system-wide loan-to-value, and split that between the desks in the
  // proportions their names imply. No reference city, nothing to keep in sync,
  // and a map the generator has never produced before still gets banks the
  // right size for it.
  //
  // 55% is the aggregate loan-to-value of a whole commercial property market
  // rather than of one deal — individual loans are written at 60-75%, plenty
  // of buildings are owned free and clear, and the two together land near
  // here. It reproduces the original $2.41bn on the standard island to within
  // a few per cent, which is the check that it is a restatement and not a
  // rebalance.
  const SYSTEM_LTV = 0.55;
  const total = stock ? cityPropertyValue(stock, priceLevel) * SYSTEM_LTV : 2_410_000_000 * priceLevel;
  return lenderNames().map((name, i) => {
    const k = KIND[name] ?? { kind: "bank" as LenderKind, capitalRatio: 0.10, brittle: 1, adc: 0.08 };
    const share = name === "First Harbor Bank" ? BOOK_SHARE.firstharbor
      : name === "Tidewater Community Bank" ? BOOK_SHARE.tidewater : BOOK_SHARE[k.kind];
    const book = Math.max(20_000_000 * priceLevel, Math.round(total * share));
    return {
      id: "L" + i, name, kind: k.kind,
      book, capital: Math.round(book * k.capitalRatio),
      delinquent: 0.008, chargeOffsYr: 0, chargeOffsTotal: 0, netIncomeYr: 0,
      appetite: 1, yours: 0,
    };
  });
}

/**
 * The capital ratio this kind of institution is supposed to run at. A life
 * company at 12% is in trouble and a conduit at 12% is having its best year —
 * so "is this desk impaired" is only answerable against its own target.
 */
export function targetCapital(name: string): number {
  return KIND[name]?.capitalRatio ?? 0.1;
}

/**
 * HOW BADLY THIS DESK NEEDS THE MONEY, 0 to 1.
 *
 * Zero at 1.15x their target — comfortable, and they will sell you nothing at
 * a price worth paying. One at 0.30x — the regulator is in the building and
 * they are shrinking the book by any means available, which is where the note
 * desk gets its inventory. Measured over 24,000 lender-months: below target
 * 25.4% of the time, below 0.7x target 5.5%, in receivership 3.1%.
 */
export function lenderPressure(l: Lender | undefined): number {
  if (!l) return 0;
  if (l.failedM !== undefined) return 1;   // a receiver is a forced seller by definition
  const t = targetCapital(l.name);
  return Math.max(0, Math.min(1, (t * 1.15 - capitalRatio(l)) / (t * 0.85)));
}

export function lenderByName(s: GameState, name: string): Lender | undefined {
  return s.lenders?.find((l) => l.name === name);
}

/**
 * WHAT A LENDER ASKS FOR A BUILDING IT DID NOT WANT.
 *
 * A flush desk markets at the mark; an impaired one puts the asset out at loan
 * basis — the carrying value that clears the charge-off. `lenderPressure`
 * interpolates between the two.
 */
export function reoAsk(s: GameState, mark: number, basis: number, lender: string): number {
  const p = lenderPressure(lenderByName(s, lender));
  const clears = Math.min(mark, Math.max(0, basis));
  return Math.max(0, Math.round((mark * (1 - p) + clears * p) / 1000) * 1000);
}

/** Capital over book — the one number that decides whether a desk is open. */
/**
 * WHERE YOUR MONEY SITS, AND WHAT HAPPENS WHEN THE DOOR IS PADLOCKED.
 *
 * The firm's cash used to be one abstract number that lived nowhere. It sits
 * at a bank now, and a bank is a thing that can fail — which turns "who do I
 * bank with" from flavour into a decision a real treasurer makes every week.
 *
 * Above the insurance limit you are an UNSECURED CREDITOR of the receiver.
 * You do not lose it all: the receiver sells the assets and pays out over a
 * year or two, historically 60-90 cents on the dollar for uninsured
 * depositors, with an advance dividend early and the rest when the book is
 * cleared. What you lose immediately is the USE of it, which for a developer
 * with a capital call due next month is frequently worse than the haircut.
 *
 * THE REWARD FOR SPREADING DEPOSITS IS AVOIDED LOSS, NEVER YIELD. Every desk
 * pays the same operating-account rate (`depositApy`: the policy rate less
 * DEPOSIT_SPREAD_PCT, the earnings-credit gap commercial balances actually
 * get), so splitting your balance across desks earns nothing extra; it only
 * means a Friday afternoon does not take all of it. That is exactly the trade a real treasurer makes, and it is
 * free until the one week it is not.
 */
export function insuredLimit(s: GameState): number {
  // THE LIMIT ON THE CALENDAR THE GAME OPENS ON. The game's clock starts in
  // START_YEAR (2000), when the FDIC limit was $100,000 (set 1980, raised to
  // $250,000 only in 2008), and every price in the engine is year-2000
  // dollars carried forward by costIdx. It used to be looked up by which of
  // five historical "eras" the seed drew; there are no eras now.
  return 100_000 * (s.depositCover ?? 1) * (s.econ.costIdx ?? 1);
}

/**
 * THE LIMIT MOVES IN A PANIC. The insurance limit was $100,000 from 1980 until
 * a run on the banking system in October 2008, when Congress raised it to
 * $250,000 in the same bill as the bank rescue (EESA, made permanent by
 * Dodd-Frank in 2010) — because the uninsured balances of ordinary businesses
 * were what was running. Here it is the same trigger: the first bank to fail
 * while the economy is in recession, or while another desk is already in
 * receivership, raises the limit two and a half times, once, for good.
 */
function maybeRaiseInsurance(s: GameState, failing: Lender) {
  if ((s.depositCover ?? 1) > 1 || failing.kind !== "bank") return;
  // A national recession, not the town's descriptive label (2026-10-13): the
  // phase is dated from local payrolls for the reader and drives nothing.
  const systemic = (s.econ.nat?.recM ?? 0) > 0
    || (s.lenders ?? []).some((x) => x !== failing && x.failedM !== undefined);
  if (!systemic) return;
  s.depositCover = 2.5;
  s.news.unshift({
    q: s.month, kind: "info",
    text: `Washington has raised the deposit insurance limit to ${usdShort(insuredLimit(s))} a depositor, per bank — `
      + `two and a half times what it was, and for good. A bank failing into a bad year did it: the money that runs `
      + `is business operating accounts over the limit, and this is how a government stops a run.`,
  });
}

// ---- where the firm's cash actually is -----------------------------------
//
// THE INTEREST RULE AND THE FAILURE RULE DISAGREED. sweepApy pays the firm's
// whole balance the government-money-fund yield because "a treasury desk
// sweeps idle balances into money funds and T-bills nightly" — and then a bank
// failure seized the whole balance as an uninsured deposit. One quantity, two
// answers. A firm's cash is in two places: an operating account at its bank
// (payroll, payables, the next debt service), which is a deposit and is
// exposed above the insurance limit; and everything else, swept into Treasury
// bills, which a bank failure does not touch. The sweep is on unless the
// player turns it off — keeping everything at the bank earns the deposit rate
// and puts all of it on the bank's balance sheet.

/** Commercial operating balances price ~100-200bp under fed funds (earnings-credit and MMDA rates); 150bp, floored at zero. */
export const DEPOSIT_SPREAD_PCT = 1.5;
export function depositApy(econ: { nat?: { policy?: number } } | undefined): number {
  const pol = econ?.nat?.policy;
  if (!Number.isFinite(pol)) return 0.005;
  return Math.max(0, ((pol as number) - DEPOSIT_SPREAD_PCT) / 100);
}
/** The operating balance a firm keeps at its bank unless it sets one: a float of $1M in year-2000 dollars. */
export function defaultOperatingBalance(s: GameState): number {
  return Math.round(1_000_000 * (s.econ.costIdx ?? 1));
}
export interface CashSplit { bank?: Lender; sweep: boolean; keep: number; atBank: number; inBills: number; insured: number; exposed: number }
/** Where the firm's cash is today: at the bank (insured / exposed) and in Treasury bills. */
//
// THE CASH IS SAFE, AND THAT IS NOT A SIMPLIFICATION. The owner found the
// bank choice a mess — pick a desk, set an operating balance, toggle a sweep,
// watch capital ratios, and still lose money in every regional crisis — and
// asked for it gone. It goes, and it goes the way a real treasury runs: an
// operating account kept inside the insurance limit (reciprocal-deposit
// networks — ICS, CDARS — exist to do exactly this for every balance over
// it), and everything else in Treasury bills, which no bank failure reaches.
// A firm's cash is therefore never a creditor of a receiver. Lenders still
// fail, and a failure still stops the loans and commitments they wrote
// (repudiateCommitments) — that is where a bank failure actually hurts a
// developer — but it never takes the money in the account. The old fields
// (bankId, cashMgmt) are left on saves and ignored.
export function cashSplit(s: GameState): CashSplit {
  const cash = Math.max(0, s.cash);
  const atBank = Math.min(cash, insuredLimit(s));
  return { bank: bankOf(s), sweep: true, keep: atBank, atBank, inBills: cash - atBank, insured: atBank, exposed: 0 };
}

/** Which desk the firm banks with, defaulting to its deepest relationship. */
export function bankOf(s: GameState): Lender | undefined {
  const live = (s.lenders ?? []).filter((l) => l.failedM === undefined && l.kind !== "conduit");
  if (!live.length) return undefined;
  return live.find((l) => l.id === s.bankId) ?? live[0];
}

function seizeDeposits(s: GameState, l: Lender) {
  // only what is AT the bank: swept Treasury bills are not the bank's to lose
  const split = cashSplit(s);
  const here = split.atBank;
  if (here <= 0) return;
  const insured = split.insured;
  const exposed = split.exposed;
  // Always insured now (cashSplit): nothing to seize and nothing to say.
  if (exposed <= 0) return;
  // The receiver's advance dividend lands with the insured money; the rest is
  // a certificate and a wait. Recovery drawn from the real range.
  const recovery = clamp(0.60 + rng(s, "lenders") * 0.30, 0.60, 0.90);
  const eventual = Math.round(exposed * recovery);
  const lost = exposed - eventual;
  s.cash -= exposed;
  // THE WHOLE UNINSURED BALANCE LEAVES THE ACCOUNT TODAY, not just the part
  // that never comes back. Booking only the haircut left the receiver's
  // eventual dividend as cash that walked out with no entry behind it —
  // six months out of balance across 3,546 the first time a seizure ever
  // actually fired, which it never had before the losses on the street
  // started reaching the desks that funded them. The dividend is booked back
  // as it arrives in tickReceivership, so the net expense over the whole
  // episode is exactly the haircut.
  //
  // AND ONLY THE HAIRCUT IS A LOSS. The whole exposed balance leaves the
  // account (above), but what the receiver will pay back is not spent — it is
  // a claim, an asset the firm now holds instead of cash. Booked as the whole
  // exposure under firm overhead, a $226M seizure printed as a $226M overhead
  // year and net worth fell by all of it, when the expected loss was the
  // haircut. Now: the haircut is the expense; the claim is exchanged for the
  // cash (a balance-sheet movement, "bought"), counted in net worth at its
  // expected recovery (portfolioMark), and redeemed as "sold" when the
  // receiver pays — so the cash identity still closes to the dollar.
  logBooks(s, "ga", lost);
  logBooks(s, "bought", eventual);
  (s.receivership ??= []).push({ from: l.name, amount: eventual, payM: s.month + Math.round(rrange(s, 12, 36, "lenders")), seizedM: s.month, lost });
  s.news.unshift({
    q: s.month, kind: "warn",
    text: `YOUR BANK HAS FAILED. ${usdShort(here)} of the firm's money was at ${l.name}. `
      + `${usdShort(insured)} is insured and available Monday; ${usdShort(exposed)} was over the limit and you are `
      + `an unsecured creditor of the receiver. They expect to return about ${(recovery * 100).toFixed(0)}c on the dollar — `
      + `${usdShort(eventual)} — but not for another year or two. The ${usdShort(lost)} difference is gone. `
      + (split.inBills > 0 ? `The ${usdShort(split.inBills)} swept into Treasury bills was never the bank's and is untouched.` : `Cash swept into Treasury bills (the Banks page) would not have been the bank's to lose.`),
  });
}

/**
 * THE RECEIVER REPUDIATES THE UNDRAWN COMMITMENT.
 *
 * Deposits are the loud half of a bank failure and the smaller one. The half
 * that ends firms is this: a construction loan is a promise to advance against
 * work in place, and a receiver does not advance. Every job in the failed
 * desk's pipeline stops funding on the same Friday — not because the job went
 * wrong, but because the lender did.
 *
 * The borrower's position afterwards is genuinely brutal and entirely real.
 * The drawn balance stays outstanding and keeps accruing, and the interest
 * reserve inside the dead commitment is as unfundable as everything else, so
 * carry that was capitalising into the loan becomes cash out of the firm's
 * account every month. The contractor is still on site under a contract the
 * developer signed. And the only way out is a replacement facility, which
 * takes a season to paper because a new desk has to re-underwrite a job it did
 * not originate and the receiver has to sign an intercreditor.
 *
 * This is not applied only to the player's own bank — the desk that holds your
 * deposits and the desk that wrote your construction loan are usually not the
 * same desk, and it is the second one that matters here.
 *
 * IT DOES NOT YET REACH THE CITY'S OWN CRANES. Rival and anonymous jobs live
 * in econ.cityJobs, which carries a balance and a rate but no lender, so there
 * is nothing to match a failed name against. Until that is wired, a bank
 * failure stops the player's sites and not the town's, which understates it:
 * the reason a seizure moved a whole market was that every borrower on that
 * desk's book stopped in the same week. See tickRepudiation in dev.ts for what
 * the borrower can do about it.
 */
function repudiateCommitments(s: GameState, l: Lender) {
  let jobs = 0;
  let exposed = 0;
  let mine = 0;
  for (const d of Object.values(s.developments ?? {})) {
    const desk = d.lender ?? CONSTRUCTION_LENDER;
    if (desk !== l.name || d.repudiatedM !== undefined) continue;
    // A job that has already drawn everything it was ever going to draw is not
    // harmed by the promise dying — there was nothing left in it.
    const room = Math.max(0, d.commitment - d.drawn);
    if (room <= 0) continue;
    d.repudiatedM = s.month;
    d.replaceM = s.month + Math.round(rrange(s, 3, 9, "lenders"));
    jobs++;
    exposed += room;
    if (s.holdings[d.bbl]) mine++;
  }
  // AND THE STREET'S CRANES, WHICH ARE THE MAJORITY OF THEM. A rival's job
  // carries a balance and a rate but no commitment — they are modelled more
  // coarsely than the player's — so repudiation for them means one thing: the
  // draws stop and the sponsor funds it out of their own account or the
  // contractor walks off. See fundJobs in rivals.ts.
  let street = 0;
  for (const j of s.cityJobs ?? []) {
    if (!j.firmId || j.orphaned || j.repudiatedM !== undefined) continue;
    if ((j.lender ?? CONSTRUCTION_LENDER) !== l.name) continue;
    j.repudiatedM = s.month;
    j.replaceM = s.month + Math.round(rrange(s, 3, 9, "lenders"));
    street++;
  }
  if (street) {
    s.news.unshift({
      q: s.month, kind: "info",
      text: `${street} site${street > 1 ? "s" : ""} on the street ${street > 1 ? "were" : "was"} being funded by ${l.name}. `
        + `The draws stopped on Friday. Whoever cannot carry their own job out of pocket is going to leave a frame `
        + `standing, and a frame that stops is a frame that ends up on the tape.`,
    });
  }

  if (!jobs) return;
  s.news.unshift({
    q: s.month, kind: mine > 0 ? "warn" : "info",
    text: mine > 0
      ? `THE RECEIVER HAS STOPPED FUNDING YOUR JOB${mine > 1 ? "S" : ""}. ${l.name} had ${usdShort(exposed)} of undrawn `
        + `commitment across ${jobs} site${jobs > 1 ? "s" : ""} in this town, ${mine} of them your${mine > 1 ? "s" : " s"}. `
        + `A receiver liquidates a book; it does not advance against work in place. The balance you have already drawn `
        + `stays outstanding and its interest now comes out of your account instead of the reserve. `
        + `You have a season to find a desk that will take the job out, and a contractor on site the whole time.`
      : `${usdShort(exposed)} of undrawn construction commitment died with ${l.name}. `
        + `${jobs} site${jobs > 1 ? "s" : ""} in this town stopped funding on Friday — watch which of them come back.`,
  });
}

/**
 * THE ENGINE SAYING "THIS ONE" — re-exported, not reimplemented.
 *
 * There used to be a copy of this here and a byte-identical private copy in
 * swans.ts, each carrying a comment asking for the other to be deleted. The one
 * implementation now sits next to the `Alert` interface in types.ts, which is
 * where both comments said it belonged. This line keeps the existing importers
 * working and is the only thing left of the duplicate.
 */
export { raiseAlert } from "./types";
import { raiseAlert } from "./types";

const usdShort = (n: number) => (n >= 1e6 ? `${money(n)}` : `$${Math.round(n / 1000)}k`);

/**
 * The receiver pays out, eventually. Called once a month from tickLenders.
 *
 * The haircut was booked as `ga` on the Friday and the claim the receiver
 * owes as `bought` (an asset exchanged for cash — see seizeDeposits), so the
 * dividend arriving here is that claim redeemed: `sold`, a balance-sheet
 * movement, not income. Claims from saves made before the claim was booked as
 * an asset have no `seizedM` and still come back as `interest`, which is how
 * they went out, so those books keep closing.
 */
export function tickReceivership(s: GameState) {
  if (!s.receivership?.length) return;
  const due = s.receivership.filter((r) => s.month >= r.payM);
  if (!due.length) return;
  for (const r of due) {
    s.cash += r.amount;
    // the claim redeemed: an asset turned back into cash, not income earned
    // (claims from saves made before the claim was booked as an asset came in
    // as interest, and still do, so those books keep closing)
    logBooks(s, r.seizedM !== undefined ? "sold" : "interest", r.amount);
    s.news.unshift({
      q: s.month, kind: "deal",
      text: `The receiver for ${r.from} has finished selling the book. ${usdShort(r.amount)} of your money comes back — `
        + `later than you needed it, which was the whole cost of it.`,
    });
  }
  s.receivership = s.receivership.filter((r) => s.month < r.payM);
}

export function capitalRatio(l: Lender): number {
  return l.book > 0 ? l.capital / l.book : 1;
}

/** In words, for the panel. `econ` lets a conduit say its bond window is shut. */
export function lenderHealth(l: Lender, econ?: { creditIdx?: number; phase?: string }): { word: string; bad: boolean } {
  if (l.failedM !== undefined) {
    const back = Math.max(0, (l.failedM + (l.reopenM ?? 18)));
    return { word: `in receivership — the franchise is being sold, back around month ${back}`, bad: true };
  }
  const cr = capitalRatio(l);
  const target = KIND[l.name]?.capitalRatio ?? 0.1;
  if (l.kind === "conduit" && econ && (econ.creditIdx ?? 1) < 0.78) return { word: "the bond window is shut — not writing", bad: true };
  if (cr < target * 0.45) return { word: "undercapitalised — not lending to anybody", bad: true };
  if (cr < target * 0.7) return { word: "impaired — rationing hard", bad: true };
  if (l.delinquent > 0.055) return { word: "working out problem loans", bad: true };
  if (cr > target * 1.25 && l.delinquent < 0.02) return { word: "flush and looking for paper", bad: false };
  return { word: "open for business", bad: false };
}

/**
 * WHAT THIS DESK WILL DO FOR YOU TODAY, as a multiplier on the advance rate.
 *
 * This is the whole payoff of giving them books. A lender whose capital is
 * intact lends at its stated terms; one that has just eaten losses cuts the
 * advance rate for everybody, and one that is genuinely broken quotes nothing
 * at all. It is not a hidden index — you can read exactly this on Research a
 * quarter before it bites.
 */
/**
 * STAYING POWER, IN ONE WORD — will this desk still be there in a crunch, and
 * still be funding your job when it is half built? Read off the same numbers
 * as lenderHealth (capital against the desk's own target, the share of its
 * book not paying, whether it is quoting at all), collapsed to four words a
 * borrower can choose by. The point is the trade it exposes: the cheapest
 * construction money in a boom often comes from the desk with the least
 * behind it.
 */
export type StayingPower = "solid" | "stretched" | "at risk" | "closed";
export function stayingPower(s: GameState, l: Lender): { word: StayingPower; why: string } {
  if (l.failedM !== undefined) return { word: "closed", why: "In receivership." };
  if (l.appetite < 0.12) return { word: "closed", why: "Not quoting — its capital will not carry new loans." };
  if (l.kind === "conduit" && (s.econ.creditIdx ?? 1) < 0.78) return { word: "closed", why: "The bond market it sells into is shut." };
  const mult = capitalRatio(l) / Math.max(0.01, KIND[l.name]?.capitalRatio ?? 0.1);
  const adc = KIND[l.name]?.adc ?? 0;
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const base = `Capital at ${mult.toFixed(2)}x its own target; ${pct(l.delinquent)} of its book not paying.`;
  if (mult < 0.7 || l.delinquent > 0.10) return { word: "at risk", why: base + " Examiners close a bank near 0.22x." };
  if (mult < 0.95 || l.delinquent > 0.04 || adc >= 0.3) {
    return { word: "stretched", why: base + (adc >= 0.3 ? ` ${Math.round(adc * 100)}% of its book is construction and land — the first loans to go bad when land prices fall.` : "") };
  }
  return { word: "solid", why: base };
}

export function lenderAppetite(s: GameState, name: string): number {
  const l = lenderByName(s, name);
  if (!l) return 1;
  if (l.failedM !== undefined) return 0;
  return l.appetite;
}

/**
 * One month of being a bank.
 *
 * Interest comes in on the performing book. Borrowers go bad at a rate set by
 * the credit cycle and by how empty the city is — this is a property lender,
 * and its losses are property losses. What goes bad gets charged off against
 * capital over the following year. Capital decides appetite; appetite decides
 * what anybody in this city can borrow, which is what makes a crunch a real
 * event with a cause instead of a slider.
 */
export function tickLenders(s: GameState) {
  // CLOSED IS WHAT LENDERS DO, NOT WHAT THEY HAVE LOST (2026-10-13). This
  // fired when half the town's book sat at desks too impaired to quote, and
  // across 75-year runs it never fired — because 2008-09 was not that. Most
  // banks still had capital; what closed was the market. CMBS issuance went
  // to nearly nothing, and loan officers tightened as hard as the Fed's
  // survey has ever recorded (SLOOS net tightening on CRE ~80%, 2008Q4).
  // So closed is the securitisation window shut AND bank standards on their
  // "shut" reading (`underwritingStandards`, the same index the desks
  // underwrite on); it reopens when the window does. Measured: 4-9 episodes
  // per 75 years, against 1990-91, 2001, 2008-09 and 2020 in the survey's
  // thirty-odd years.
  {
    const e = s.econ;
    const conduit = PRODUCTS.find((p) => p.window);
    const windowShut = conduit ? !windowOpen(s, conduit) : false;
    // In at "shut" standards with the window closed; out when either the
    // window reopens or standards are back to ordinary (standardsWord).
    const st = underwritingStandards(s);
    const shut = e.debtShut ? windowShut && st <= -0.15 : windowShut && st <= -0.5;
    if (shut && !e.debtShut) s.news.unshift({ q: s.month, kind: "warn", text: "The debt markets have effectively closed. The bond buyers have gone, the banks are lending only to names they already know, and term sheets are being pulled mid-deal." });
    if (!shut && e.debtShut) s.news.unshift({ q: s.month, kind: "event", text: "The lenders are quoting again. Not cheaply, and not to everyone, but the phones are being answered." });
    e.debtShut = shut;
  }

  // The receiver pays out on its own clock, whatever the banks are doing.
  tickReceivership(s);
  // A save from before banks were sized to the city, or a state built without
  // parcels: the econ already knows the stock, so use it.
  if (!s.lenders?.length) {
    s.lenders = initLenders(s.econ?.stock, s.econ?.priceLevel ?? 1);
  }
  const desks = recountYours(s);
  const e = s.econ;
  const vac = e.cityVac ?? {};
  // The average excess vacancy across the city: the single best predictor of
  // whether the loans behind those buildings are being paid.
  const nat = { office: 0.115, retail: 0.085, multifamily: 0.045, industrial: 0.07 } as Record<string, number>;
  let stress = 0, n = 0;
  for (const k of Object.keys(nat)) { stress += Math.max(0, (vac[k as never] ?? nat[k]) - nat[k]); n++; }

  // --- CONTAGION: WHAT ONE FRIDAY COSTS EVERYBODY ELSE ----------------------
  //
  // A seizure was a private event between a desk and its regulator. It is not.
  // The morning after a regional property lender is closed, every OTHER
  // regional property lender in the same market discovers that its brokered
  // CDs, its repo and its bond investors have repriced it — not because rates
  // moved, but because the counterparty risk they had been ignoring was just
  // demonstrated on the front page. Comparable institutions paid roughly 50 to
  // 150 basis points more for hot money after a failure nearby, and the ones
  // that looked most like the deceased paid several hundred.
  //
  // Modelled through the two things that already exist and are already
  // justified, rather than as a penalty:
  //
  //   `wholesale` — how much of this desk is hot money at all. First Harbor
  //   funds itself with sleeping deposits and barely notices; the conduit IS
  //   the bond market and closes with it. That distribution is not invented
  //   here, it is the same table that makes a rate shock asymmetric.
  //
  //   capital against target — the market does not reprice everyone equally,
  //   it reprices whoever resembles the failure. A fat desk pays a token; a
  //   desk sitting on its own target pays real money.
  //
  // And it is a LIVE SURCHARGE, not a level fed through fundCost's slow
  // adjustment. Funding reprices up fast and down slowly because depositors
  // are like that; a panic reprices in a week, which is the entire difference
  // between a panic and a trend. It decays with distance from the failure and
  // holds a floor while the receiver is still selling the book, because a
  // receiver liquidating into your market is itself a live signal.
  //
  // The loop this closes: the surcharge lands on net interest margin, nimFac
  // cuts appetite the SAME month, and it eats capital every month it lasts —
  // so a failure genuinely can take the next desk with it, without anything
  // in the model being told to arrange that.
  const PANIC_PEAK = 1.5;      // pp on hot money at the moment of a seizure
  const PANIC_HALFLIFE = 9;    // months; spreads normalised inside a year or two
  const down = s.lenders.filter((l) => l.failedM !== undefined);
  let panic = 0;
  if (down.length) {
    const newest = Math.max(...down.map((l) => l.failedM ?? 0));
    const since = Math.max(0, s.month - newest);
    // A second name going down in the same crisis is worse than the first.
    panic = Math.max(0.25, Math.exp(-since / PANIC_HALFLIFE)) * Math.min(1.6, 0.75 + 0.45 * down.length);
  }
  stress = n ? stress / n : 0;
  // How far land has fallen over the trailing year (0 when it has risen).
  const h13 = e.history?.[e.history.length - 13];
  const landFall12 = h13?.landIdx ? Math.max(0, 1 - (e.landIdx ?? h13.landIdx) / h13.landIdx) : 0;

  for (const l of s.lenders) {
    // --- RESOLUTION ---------------------------------------------------------
    // A failed bank is not a hole in the market forever. A receiver sells the
    // franchise — the branches, the deposits and the name — and inside a year
    // or two somebody is lending out of the same building under new ownership,
    // recapitalised, smaller, and far more careful than the firm that died.
    // Without this the city loses a desk permanently every crisis and by year
    // forty there is nobody left to borrow from, which is not a hard game, it
    // is a broken one.
    // What the named borrowers owe this desk, counted every month whether it
    // is lending or in receivership — the statement is true either way.
    l.namedBook = Math.round(desks[l.name]?.named ?? 0);
    l.namedDefault = Math.round(desks[l.name]?.defaulted ?? 0);
    if (l.failedM !== undefined && l.anonBook !== undefined) l.book = Math.round(l.anonBook + l.namedBook);
    if (l.failedM !== undefined) {
      if (s.month - l.failedM >= (l.reopenM ?? 18)) {
        const k = KIND[l.name] ?? { capitalRatio: 0.1 };
        // The receiver sells the franchise and keeps the bad paper: the
        // anonymous book comes back smaller, and the named loans that were
        // on it are still the named loans (still paying, or still not).
        l.anonBook = Math.round((l.anonBook ?? l.book) * 0.55);
        l.anonDelinq = 0.004;                                     // the bad paper stayed with the receiver
        l.book = l.anonBook + (desks[l.name]?.named ?? 0);
        l.capital = Math.round(l.book * k.capitalRatio * 1.15);   // a resolved bank opens overcapitalised
        l.delinquent = (l.anonBook * l.anonDelinq + (desks[l.name]?.defaulted ?? 0)) / Math.max(1, l.book);
        l.appetite = 0.75;
        l.chargeOffsYr = 0; l.netIncomeYr = 0;
        const rec = [...(s.bankFails ?? [])].reverse().find((b) => b.lender === l.name && b.reopenedM === undefined);
        if (rec) rec.reopenedM = s.month;
        delete l.failedM; delete l.reopenM;
        s.news.unshift({
          q: s.month, kind: "info",
          text: `${l.name} is lending again. The receiver sold the franchise, the new owners put fresh capital `
            + `behind it and the bad paper stayed behind — the name on the door is the same and the credit `
            + `committee is not. Smaller book, tighter standards, and one more desk answering the phone.`,
        });
      }
      continue;
    }
    const k = KIND[l.name] ?? { capitalRatio: 0.1, brittle: 1, wholesale: 0.5, adc: 0.08 };
    // --- THE BOOK IS THE LOANS ----------------------------------------------
    // Named paper (loanbook.ts: yours, the street's, the cranes) plus the
    // anonymous book of borrowers the game does not run as firms. A loan you
    // close lands on this desk's balance sheet the month you close it, and
    // takes capital ratio with it — the book used to be one number that grew
    // by an appetite rule whatever anybody borrowed, so a desk could lend you
    // half its capital and read exactly as healthy as before.
    const named = desks[l.name] ?? { named: 0, defaulted: 0 };
    // The anonymous book is carried in `anon` and written back at the end.
    // Until the street's mortgage record exists (it is written after this
    // tick in the opening month) the desk runs on its stated book alone.
    let anon = l.anonBook ?? l.book;
    if (l.anonBook === undefined && s.cityLoans) {
      const before = l.book;
      anon = Math.max(l.book * 0.25, l.book - named.named);
      l.anonDelinq = l.delinquent;
      // AND THE CAPITAL COMES WITH IT. The opening books are sized from the
      // city's value (initLenders); the street's opening mortgages are part of
      // that value and come out of the anonymous share, but where a desk's
      // named paper is more than three quarters of its stated book the book
      // grows instead, and a desk opens the game at its own capital target
      // whatever its book turns out to contain. Once, not a running top-up.
      const after = anon + named.named;
      if (after > before && before > 0) l.capital = Math.round(l.capital * (after / before));
    }
    l.book = Math.round(anon + named.named);
    // A DESK'S BOOK EARNS THAT DESK'S SPREAD. Every lender in town earned
    // index + 1.9 on its book, which is a bank's number — and the debt fund
    // was FUNDED at index + 1.1, so its margin was eight tenths of a point
    // and the margin factor below sat on its floor in every month of every
    // run. Measured over six seeds and thirty years: Cordage's appetite ran
    // 0.24-0.66, median 0.31, with its capital at 23-26% against a 22%
    // target — flush, and rationing forever, because a bank's margin formula
    // had been applied to a fund whose paper is written at index + 4.1
    // floating and index + 8 on the mezz. The 80% bridge desk was writing
    // 53%, under the hometown bank, which is the opposite of what a bridge
    // desk is for. The book yields the desk's own spread now.
    const spread = BOOK_SPREAD[l.kind] ?? 1.9;

    // --- the book earns WHAT IT WAS WRITTEN AT -------------------------------
    // The margin used to be arithmetic: the book earned index+1.9 and the
    // deposits cost index-2.2, both off the LIVE index, so the spread was a
    // constant 4.1 points in every month of every run and a rate shock was a
    // non-event for a bank. A real book was written over years and reprices
    // only as loans roll (~3%/mo here, a ~30-month lag) — which is the entire
    // asset-liability problem of banking, and the reason 1980 and 2023 have
    // the same obituaries.
    if (l.bookYield === undefined) l.bookYield = e.indexRate + spread;
    l.bookYield = +(l.bookYield + 0.025 * (e.indexRate + spread - l.bookYield)).toFixed(4);
    const performing = l.book * (1 - l.delinquent);
    const interest = (performing * l.bookYield) / 100 / 12;
    // --- and the funding reprices at the speed of its source -----------------
    // Core deposits sleep. Wholesale money — brokered CDs, repo, the bond
    // market — reprices the week the index moves, and when the index has run
    // up more than a point inside a year, even depositors wake up and chase
    // it. `hot` is that overflow; `wholesale` is how much of this desk is
    // exposed to it. Funding reprices UP fast and DOWN slowly, because that
    // asymmetry is what depositors are like.
    const baseFund = l.kind === "bank" ? Math.max(0, e.indexRate - 2.2)
      : l.kind === "life" ? Math.max(0, e.indexRate - 0.3)
      : l.kind === "conduit" ? e.indexRate + 0.3
      : e.indexRate + 1.1;
    const then = e.history[e.history.length - 13]?.indexRate ?? e.indexRate;
    const hot = Math.max(0, e.indexRate - then - 0.6);
    // A CONDUIT DOES NOT CARRY A RATE BET. It writes a loan, warehouses it for
    // a few weeks and sells it into a trust priced off the same index, so its
    // margin is the gain on sale — fixed at the kind's normal margin, whatever
    // the index does — for as long as the bond window is open (the same test
    // `windowOpen` puts to the desk). It was funded like a regional, at the
    // index plus a hot-money term against a book that repriced over thirty
    // months, and it died of rate shocks in the middle of expansions: 9
    // seizures in 360 city-years, 7 of them with delinquency under 5%. When
    // the window shuts the warehouse is stuck on repo and the old funding law
    // is exactly right.
    const conduitOpen = l.kind === "conduit" && (e.creditIdx ?? 1) >= 0.78;   // = windowOpen (debt.ts): a national market
    const fundTarget = conduitOpen ? (l.bookYield ?? e.indexRate + spread) - (NORMAL_NIM.conduit ?? 1.6) : baseFund + hot * k.wholesale;
    if (l.fundCost === undefined) l.fundCost = baseFund;
    // AN INSURER'S MONEY IS AS LONG AS ITS LOANS. The general account is
    // annuity and policy reserves credited over years, and the life company
    // matches the duration of its mortgages to them — so its funding reprices
    // at the speed its book does (2.5% a month), both ways. Funded like a
    // deposit bank, it lost its margin in every hiking cycle and stopped
    // quoting for a year at a time (appetite 0.2 through two rate spikes in
    // one thirty-year playthrough), which is the one thing a life company
    // famously does not do.
    l.fundCost = conduitOpen ? +fundTarget.toFixed(4)
      : l.kind === "life" ? +(l.fundCost + 0.025 * (fundTarget - l.fundCost)).toFixed(4)
      : +(l.fundCost + (fundTarget > l.fundCost ? 0.22 : 0.07) * (fundTarget - l.fundCost)).toFixed(4);
    // The panic surcharge, priced off how much this desk resembles the one in
    // receivership. A desk at its capital target pays the base share; one at
    // half its target pays nearly three times that. See the block above.
    // The ratio the market can SEE — the one on the last statement, entering
    // this month. It cannot price a number the desk has not booked yet.
    const weak = Math.max(0, Math.min(1.5, 1 - capitalRatio(l) / Math.max(0.01, k.capitalRatio)));
    l.panicBps = panic > 0 ? +(PANIC_PEAK * panic * k.wholesale * (0.35 + weak)).toFixed(3) : 0;
    const allIn = Math.max(0, l.fundCost + (l.panicBps ?? 0));
    const funding = (l.book * allIn) / 100 / 12;

    // --- and it goes bad -----------------------------------------------------
    // THE ANONYMOUS BOOK is a population, and it goes bad the way a
    // population does: it follows the property cycle with a lag — buildings
    // empty, then owners burn reserves, then they stop paying. A recession
    // alone is not enough; it is a recession with vacancy behind it.
    const badTarget = 0.006 + stress * 0.55 * k.brittle
      // borrowers whose tenants are laying off: 0.6 x slack reads 1.8% at a
      // three-point recession trough, as the old recession term did
      + 0.6 * Math.max(0, labourSlack(e)) * k.brittle
      + Math.max(0, 1 - (e.creditIdx ?? 1)) * 0.03 * k.brittle
      // ...and the construction and land book goes bad with the price of dirt
      // (2026-10-13): noncurrent ADC loans reached ~16% as land fell 20-30% a
      // year (FDIC QBP 2009-10), so 0.65 per unit of the trailing year's land
      // fall, on the desk's ADC share.
      + k.adc * 0.65 * landFall12;
    const ad = l.anonDelinq ?? l.delinquent;
    l.anonDelinq = Math.max(0.002, Math.min(0.35, ad + 0.10 * (badTarget - ad) + rrange(s, -0.0015, 0.0015, "lenders")));
    // THE NAMED BOOK IS COUNTED. A loan the engine runs is either being paid
    // or it is not, and the desk's delinquency line is what its own borrowers
    // are actually doing: your arrears, your matured balloon with no takeout,
    // the street firm whose whole book is in workout, the frame whose sponsor
    // died. It used to be the city's vacancy for everyone, so a desk whose
    // biggest borrower had stopped paying read exactly as healthy as one
    // whose borrowers were all current.
    l.delinquent = Math.min(0.4, (anon * l.anonDelinq + named.defaulted) / Math.max(1, l.book));

    // A third of what is delinquent in the anonymous book is eventually
    // written off, spread over a year — and written-off paper leaves the book.
    // Named losses are not estimated here: they are booked when they happen,
    // at the deed in lieu or the auction (chargeLenderLoss), at the size the
    // collateral actually fetched.
    const chargeOff = Math.round(anon * l.anonDelinq * 0.33 / 12);
    anon = Math.max(0, anon - chargeOff);
    l.chargeOffsYr += chargeOff;
    l.chargeOffsTotal += chargeOff;
    const opex = (l.book * (OPEX_PCT[l.kind] ?? 0)) / 100 / 12;
    // Taxed symmetrically: a loss month books a tax asset (carrybacks).
    const net = Math.round((interest - funding - borneLoss(l, chargeOff) - opex) * (1 - (TAX_RATE[l.kind] ?? 0)));
    l.netIncomeYr += net;
    l.capital = Math.round(l.capital + net);

    // --- CAPITAL IS MANAGED, NOT HOARDED -------------------------------------
    // Measured before this existed: retained earnings compounded untouched for
    // a century, the three deposit-funded desks ended every 600-month run at
    // 60-72% capital against 9.5-18% targets, and their appetite sat pinned at
    // the 1.15 cap for an average of 1.15 over 2,400 lender-months — the
    // credit cycle only ever happened to the conduit. A bank above its buffer
    // pays the excess out, which is what keeps a loss in year forty as
    // dangerous as one in year four.
    const target = k.capitalRatio;
    const buffer = l.book * target * 1.15;
    if (l.capital > buffer) {
      const div = Math.round((l.capital - buffer) * 0.08);
      l.capital -= div;
      l.divYr = (l.divYr ?? 0) + div;
    }
    const cr = capitalRatio(l);
    // --- appetite ------------------------------------------------------------
    // Above target they lend freely; below it they ration; well below it they
    // stop. A conduit's "appetite" is really whether the bond market is open,
    // which is why it swings furthest.
    const raw = cr / Math.max(0.01, target);
    // A DESK RATIONS ON ITS MARGIN AS WELL AS ITS CAPITAL. Capital is the
    // slow variable — losses take years to eat it — but the margin can be
    // gone in eighteen months of hiking, and a bank earning 1.5 points over
    // funding that used to earn 4 does not write new loans at old advance
    // rates while it waits to find out which. At the normal ~4-point margin
    // this factor is 1 and nothing changes; it only exists for the squeeze.
    // ALL-IN, panic included — otherwise the surcharge eats capital for a year
    // and the desk goes on quoting as if its funding were free. The margin is
    // what it actually costs to hold the book this month, and that is the
    // number a credit committee rations on.
    const nim = (l.bookYield ?? e.indexRate + spread) - Math.max(0, (l.fundCost ?? 0) + (l.panicBps ?? 0));
    // ...AND RATIONS AGAINST ITS OWN NORMAL MARGIN, not a bank's. The curve
    // is the bank's original one expressed as a share of the kind's ordinary
    // margin (a bank's 4.1 points: index + 1.9 on the book against deposits
    // at index − 2.2), so a bank is numerically unchanged, and a conduit
    // earning its whole 1.6-point gain-on-sale margin is at 1, not at half.
    const nimRel = nim / (NORMAL_NIM[l.kind] ?? 4.1);
    const nimFac = Math.max(0.25, Math.min(1, 0.35 + 0.65 * (nimRel - 0.195) / 0.683));
    l.appetite = Math.max(0, Math.min(1.15,
      (raw - 0.55) / 0.6 * nimFac * (l.kind === "conduit" ? Math.max(0.25, e.creditIdx ?? 1) : 1)));
    // Growth at 0.35%/mo compounded to an 8x book over fifty years while the
    // town's whole rival debt stayed under a quarter of one desk — the banks
    // outgrew the city they lend to. Half that pace keeps them in it.
    // The anonymous book is what grows or runs off with appetite; the named
    // book is whatever the named borrowers have actually taken.
    // The $20M floor is on the desk's whole book, as it always was — flooring
    // the anonymous half alone re-inflated a small town's desk past the book
    // its capital was sized for.
    anon = Math.max(Math.max(0, 20_000_000 - named.named), Math.round(anon * (1 + (l.appetite > 0.8 ? 0.0017 : l.appetite > 0.4 ? 0 : -0.006))));
    l.book = Math.round(anon + named.named);
    if (s.cityLoans) l.anonBook = anon;

    if (s.month % 12 === 0 && s.month > 0) { l.chargeOffsYr = 0; l.netIncomeYr = 0; l.divYr = 0; }

    // --- and sometimes it ends, ON A FRIDAY ----------------------------------
    // The regulator does not wait for zero. A desk critically under its own
    // target — a fifth of it — is operating on the examiners' patience, and
    // one Friday afternoon the patience ends. This is what makes failure a
    // cliff you can watch a desk walking toward on Research rather than an
    // asymptote it can hug forever.
    // A CONDUIT IS NEVER SEIZED. It has no depositors and no regulator to
    // close it: when the bonds will not sell it stops writing (windowOpen), and
    // the losses past its retained first-loss piece are the bondholders'
    // (borneLoss). The banks and the life company are closed by examiners; the
    // fund by running out of committed capital.
    const seizable = l.kind === "bank" || l.kind === "life";
    if (l.kind !== "conduit" && ((l.capital <= 0 && rng(s, "lenders") < 0.35) || (seizable && cr < target * 0.22 && rng(s, "lenders") < 0.09))) {
      // ASK WHOSE BANK THIS IS BEFORE YOU CLOSE IT. bankOf() only considers
      // LIVE desks, so calling seizeDeposits after failedM was set meant the
      // failing bank had already been filtered out of its own question and the
      // player's balance was never touched — measured at 8 failures across 8
      // runs and not one cut. Establish it first, then padlock the door.
      const wasOurs = bankOf(s)?.id === l.id;
      l.failedM = s.month;
      maybeRaiseInsurance(s, l);
      // HOW LONG THE DOOR STAYS SHUT DEPENDS ON WHO CLOSED IT. A failed bank is
      // resolved by the deposit insurer in a purchase-and-assumption: an
      // acquirer is lined up before the Friday closing and the branches open
      // under new ownership on Monday — FDIC practice for nearly every failure
      // since the 1990s. The new owner writes loans again within a quarter
      // (one to three months here, while it integrates the book); the BAD
      // paper stays with the receiver, which sells it down over a year or two
      // (receiverUntilM — notes.ts). A life company goes into state
      // rehabilitation, which takes years, and a fund that has lost its
      // committed capital winds down and is raised again as a new vintage.
      l.reopenM = l.kind === "bank" ? Math.round(rrange(s, 1, 3, "lenders"))
        : Math.round(rrange(s, 24, 48, "lenders"));
      l.receiverUntilM = s.month + Math.round(rrange(s, 12, 30, "lenders"));
      l.appetite = 0;
      // In most resolutions the acquirer assumes every deposit and the
      // uninsured are made whole; in the rest it takes only the insured ones
      // and the remainder is a claim on the receiver. Three in four is the
      // rough post-2008 share of whole-bank and all-deposit transactions — a
      // shape, not a measured constant.
      if (wasOurs) {
        if (l.kind === "bank" && rng(s, "lenders") < 0.75) {
          s.news.unshift({
            q: s.month, kind: "info",
            text: `${l.name} failed on Friday and was sold to an acquirer the same weekend. Every deposit moved with it, `
              + `insured or not — the firm's account opens Monday under a new name with nothing missing.`,
          });
        } else seizeDeposits(s, l);
      }
      // The paper's memory of it (stories.ts) — a record, not a mechanism.
      (s.bankFails ??= []).push({
        lender: l.name, kind: l.kind, m: s.month, book: Math.round(l.book),
        delinq: +l.delinquent.toFixed(4), yours: Math.round(l.yours ?? 0),
      });
      if (s.bankFails.length > 60) s.bankFails.shift();
      // And whether or not you banked with them, their cranes stop.
      repudiateCommitments(s, l);
      // A DESK GOING DOWN IS NOT A LINE IN THE PAPER. Whether or not the
      // player banked here, this is the month their borrowing capacity in this
      // town changed: a receiver does not lend, does not extend, and does not
      // advance against work in place, and it is about to be selling a book at
      // whatever clears. The detail line is the one number that decides what
      // they do about it — what this desk was lending THEM.
      raiseAlert(s, {
        kind: "bank", tone: "bad",
        title: `${l.name} has been closed`,
        body: l.kind === "bank"
          ? `The examiners closed them on Friday and the deposit insurer sold the franchise to an acquirer the same `
            + `weekend. The branches open Monday under new owners, who will be writing loans again in a month or two. `
            + `The bad paper stays with the receiver, which will be selling it for the next year or two — watch the tape. `
            + `Undrawn construction commitments died with the old bank; a job that was drawing on them needs a new desk.`
          : l.kind === "life"
            ? `The insurance commissioner has taken them into rehabilitation. A rehabilitator collects what is owed and `
              + `writes nothing new for years; the loans are with a receiver now, and a receiver does not extend or haggle.`
            : `The fund has burned through its committed capital and is winding down. It will not write or extend a `
              + `loan until a new vintage is raised, and what it holds will be sold as it can be.`,
        detail: l.yours > 0
          ? `They held ${usdShort(l.yours)} of your debt. ${(l.delinquent * 100).toFixed(1)}% of their book had stopped paying.`
          : `${(l.delinquent * 100).toFixed(1)}% of their book had stopped paying, against a ${(targetCapital(l.name) * 100).toFixed(1)}% capital target.`,
      });
      // THE SAME FAILURE, FILED TWICE, IN THE SAME MONTH. `raiseAlert` above
      // already unshifts a warn (types.ts:906) carrying this exact event in
      // more detail — measured, the two counts were identical by construction
      // and identical in fact, 58 and 58 over a passive run. A paper that says
      // the same thing twice is not twice as informative; it is a paper the
      // reader learns to skim.
    } else if (l.appetite < 0.15 && rng(s, "lenders") < 0.04) {
      s.news.unshift({
        q: s.month, kind: "warn",
        text: `${l.name} has stopped quoting. ${(l.delinquent * 100).toFixed(1)}% of their book is not paying and their capital will not carry new loans.`,
      });
    }
  }
  // The statement keeps a history — capital ratio, sampled quarterly, fifty
  // years deep. The chart of a bank walking toward its seizure is the single
  // most readable object in the game.
  if (s.month % 3 === 0) {
    for (const l of s.lenders) {
      (l.capHist ??= []).push(+capitalRatio(l).toFixed(4));
      if (l.capHist.length > 200) l.capHist.shift();
    }
  }
  // --- THE BANKS ARE THE CREDIT MARKET ---------------------------------------
  // creditIdx was pure macro weather: the phase set a target and the banks'
  // own capital never touched it, so five impaired balance sheets and a
  // boom-time credit index could coexist. The book-weighted appetite of the
  // live desks now drags the index — gently, at a third of the macro pull, so
  // the cycle still leads — which closes the loop the file promises at the
  // top: losses eat capital, capital is appetite, appetite IS the availability
  // of credit in this town.
  {
    const live = s.lenders.filter((l) => l.failedM === undefined);
    const wSum = live.reduce((a, l) => a + l.book, 0);
    const sysApp = wSum > 0 ? live.reduce((a, l) => a + l.appetite * l.book, 0) / wSum : 0.4;
    s.bankApp = +sysApp.toFixed(3);
    const pull = Math.max(0.45, Math.min(1.2, 0.45 + 0.6 * sysApp));
    e.creditIdx = Math.max(0.4, Math.min(1.25, e.creditIdx + 0.025 * (pull - e.creditIdx)));
  }
  // The volume construction desk's appetite, published for the land market.
  // Every builder in town borrows from the same desks the player does, so the
  // residual (proforma.ts, marketConstructionQuote) prices dirt against this
  // bank's actual terms — a wounded Alden lends less to everybody, not only
  // to you. value.ts is handed only (rec, econ), which is why it travels here.
  e.constructionAppetite = +lenderAppetite(s, CONSTRUCTION_LENDER).toFixed(4);
}

/**
 * How much of each book is YOU, counted rather than tracked.
 *
 * Deltas drift — a payoff missed here, a deed handed back there, and by year
 * thirty the number is fiction. This walks the holdings every month, which is
 * cheap and cannot be wrong, and it is the number that tells you whether you
 * are a customer of this desk or a concentration on it.
 */
function recountYours(s: GameState): Record<string, DeskTotals> {
  // ONE COUNT, FROM THE LOAN BOOK. This walked first mortgages and
  // construction only, so a borrower could put $40M on a desk through its
  // portfolio facility, stack mezzanine behind every senior and draw the
  // line, and still read as a stranger to the single-name test in
  // `concentrationRoom` — the one test whose whole purpose is to see that.
  const by = deskTotals(cityLoanBook(s));
  for (const l of s.lenders ?? []) l.yours = Math.round(by[l.name]?.yours ?? 0);
  return by;
}

/**
 * WHAT A LOSS COSTS THE DESK THAT WROTE THE LOAN. Everyone but the conduit
 * holds its loans and eats all of it. A conduit sold the loan into a trust and
 * kept only the first-loss slice (the B-piece, and since 2016 the 5% risk
 * retention): losses come out of its capital until that is gone, and past it
 * they belong to the bondholders, not to the desk.
 */
function borneLoss(l: Lender, loss: number): number {
  if (l.kind !== "conduit") return loss;
  return Math.max(0, Math.min(loss, l.capital));
}

/**
 * YOUR DEFAULT IS THEIR LOSS.
 *
 * Handing back a building is not a private event — it lands on a specific
 * desk, eats a specific pot of capital, and that desk remembers. A big enough
 * hole moves their capital, their appetite and, if you are large enough
 * relative to them, whether they are still in business.
 *
 * It no longer bumps the delinquency line: a named loan's delinquency is
 * COUNTED off the loan book every month (loanbook.ts) — it was delinquent
 * while it sat in workout, and once it is resolved it is a realised loss,
 * not a delinquent loan. Adding a guessed share on top counted it twice.
 */
export function chargeLenderLoss(s: GameState, lender: string, loss: number) {
  const l = lenderByName(s, lender);
  if (!l || loss <= 0) return;
  l.capital = Math.round(l.capital - borneLoss(l, loss));
  l.chargeOffsYr += loss;
  l.chargeOffsTotal += loss;
  l.yours = Math.max(0, l.yours - loss);
}
