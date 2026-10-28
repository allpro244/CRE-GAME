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
import { rng, rrange, RENT_BASE, NATURAL_VAC, CAP_BASE, shortIndexOf } from "./market";
import type { DeskPx, LossClass } from "./pricing";
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
  /** The rate this bank posts for deposits, % a year — what it competes on. See tickDeposits. */
  rate?: number;
  /** Borrowed money funding what deposits do not: FHLB advances, brokered CDs, repo. */
  wholesale?: number;
  /** Cash and securities held against withdrawals. */
  liquid?: number;
  /** Net deposit flow over the last twelve months, as a share of deposits a year ago. */
  flowYr?: number;
  /** Deposits twelve months ago, for flowYr. */
  hist?: number[];
}

/** One charge-off: whose loan, on what, and how it ended. */
export interface LossEntry {
  m: number;
  /** The borrower's name ("You" for the player). */
  borrower: string;
  /** "player", a firm's id, "h:<holder>" for a private owner. */
  id?: string;
  bbl?: string;
  cls: LossClass;
  amount: number;
  how?: string;
}

export interface LenderIncome {
  interest: number; funding: number; losses: number; opex: number; tax: number;
  /** Named loans resolved at a loss (a deed in lieu, the auction, a street failure) — straight to capital. */
  writeOffs?: number;
}

export interface Lender {
  id: string;
  name: string;
  kind: LenderKind;
  /**
   * Everything they have lent, to you and to everyone else: every loan on
   * the record (loanbook.ts — yours, the firms', the private owners', the
   * cranes). Recomputed every month as their sum.
   */
  book: number;
  /**
   * THE OLD ANONYMOUS BOOK, on saves from before the private owners'
   * mortgages were on the record (streetLoans.ts). Retired on the first tick
   * that has them; nothing reads it after.
   */
  anonBook?: number;
  anonDelinq?: number;
  /** The book is the named loans and nothing else (set on the first tick with the private mortgages on the record). */
  namedOnly?: boolean;
  /**
   * LOSS EXPERIENCE BY LOAN TYPE, for pricing: smoothed losses and smoothed
   * balance (36-month), so the rate is losses over balance across a cycle
   * rather than one bad month over a thin book. `lossM` collects this
   * month's charge-offs as they are booked.
   */
  lossEw?: Partial<Record<LossClass, number>>;
  balEw?: Partial<Record<LossClass, number>>;
  lossM?: Partial<Record<LossClass, number>>;
  /** Every charge-off, against whom, newest first (the last forty). */
  lossLog?: LossEntry[];
  /** The book by loan type, last month: balance, in default, on watch, count. */
  typeBook?: Partial<Record<LossClass, { bal: number; def: number; watch: number; n: number }>>;
  /** Its share of the opening book — the market's shape as this town opened (priceDesks). */
  usual0?: number;
  /** Its share of the town's new term lending over the last twelve months, and its usual share. */
  wonShare?: number;
  usualShare?: number;
  /** This desk's live pricing, as published on econ.deskPx. */
  px?: DeskPx;
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
  /** Points this desk adds to (or, negative, takes off) its sheet to manage its share of the town's book — see lenderChase. */
  chase?: number;
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
  /**
   * THE INCOME STATEMENT, line by line, this calendar year and the last full
   * one — what the Banks page prints. Net income alone said whether a desk
   * was earning; these say why: interest on the performing book, what the
   * money cost, the losses it booked, the cost of running it, and the tax.
   */
  incYr?: LenderIncome;
  incPrevYr?: LenderIncome & { netIncome: number; dividends: number; chargeOffs: number };
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
const KIND: Record<string, { kind: LenderKind; capitalRatio: number; brittle: number; wholesale: number; adc: number; uninsured?: number; blurb: string }> = {
  "First Harbor Bank": {
    kind: "bank", capitalRatio: 0.11, brittle: 0.5, wholesale: 0.2, adc: 0.08, uninsured: 0.30,
    blurb: "Deposits fund the book, so the losses have to be very bad before the lights go out. Small, local, and they remember who paid them in the bad years.",
  },
  "Alden Savings & Trust": {
    kind: "bank", capitalRatio: 0.095, brittle: 0.8, wholesale: 0.65, adc: 0.15, uninsured: 0.40,
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
    kind: "bank", capitalRatio: 0.09, brittle: 1.4, wholesale: 0.5, adc: 0.45, uninsured: 0.25,
    blurb: "A small bank that grew fast on construction and land loans, funded by brokered deposits. The cheapest construction money in a boom — and the first desk the regulator visits when land stops selling.",
  },
  // A THICKER MARKET (2026-10-14). Six desks were the whole lending market of
  // a city — one life company, so one allocation committee's mood was the
  // market's. A metro is lent into by dozens; three more of the kinds that
  // actually carry it:
  //   a money-centre bank — national, wholesale-funded, writes the big
  //   tickets the local banks cannot hold, and is the first to pull back in
  //   a panic because its funding is the market's;
  "Bowline National Bank": {
    kind: "bank", capitalRatio: 0.12, brittle: 0.9, wholesale: 0.8, adc: 0.10, uninsured: 0.55,
    blurb: "A money-centre bank lending into the city from out of town: the biggest checks a bank will write here, funded in the money markets — so when those markets seize, so does Bowline.",
  },
  //   a second life company, so the insurers are a market and not a mood;
  "Ashford Life & Annuity": {
    kind: "life", capitalRatio: 0.17, brittle: 0.3, wholesale: 0.1, adc: 0,
    blurb: "A second insurer's general account: long fixed money for well-kept buildings, a little more leverage than Pelican and a little less patience.",
  },
  //   and the agency desk — the government-sponsored apartment lender, which
  //   kept writing when everybody else stopped (it wrote most multifamily
  //   paper in 2009-10). It cannot fail in this game for the reason it did
  //   not in that one: the guarantee behind its bonds is the Treasury's.
  "Keystone Agency Finance": {
    kind: "life", capitalRatio: 0.20, brittle: 0.05, wholesale: 0, adc: 0,
    blurb: "The agency apartment desk: fixed and floating money for flats only, non-recourse, and still writing in a crisis — that is what it is for.",
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
// A DEBT FUND'S PAPER FLOATS AND SO DOES ITS MONEY (2026-10-28). Its book
// earns the coupons its borrowers pay now — bridge loans at the short index
// plus ~4.1 (the Cordage sheet) — and it is levered with CLO and repo money
// that floats off the same short rate (~1.1 over, with the equity's hurdle in
// it). Funded off the long index it read a 0.7-point margin on a 3-point
// business whenever the curve was steep. Its ordinary margin is the sheet
// less that: 3.0.
const NORMAL_NIM: Record<LenderKind, number> = { bank: 4.1, life: 1.7, conduit: 1.6, fund: 3.0 };
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

/**
 * WHAT KIND OF INSTITUTION THIS IS — the constants behind its behaviour, for
 * the Banks page: how it is funded, how much hot money it carries, what it
 * runs at, what it costs to run, what it is taxed, and what it normally earns.
 * Nothing here is new; it is the table every tick already reads, shown.
 */
export function lenderConstitution(l: Lender): {
  target: number; wholesale: number; brittle: number; adc: number; opexPct: number; taxRate: number; bookSpread: number; normalNim: number;
} {
  const k = KIND[l.name] ?? { capitalRatio: 0.1, brittle: 1, wholesale: 0.5, adc: 0 };
  return {
    target: k.capitalRatio, wholesale: k.wholesale, brittle: k.brittle, adc: k.adc ?? 0,
    opexPct: OPEX_PCT[l.kind] ?? 0, taxRate: TAX_RATE[l.kind] ?? 0,
    bookSpread: BOOK_SPREAD[l.kind] ?? 1.9, normalNim: NORMAL_NIM[l.kind] ?? 4.1,
  };
}

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
const BOOK_SHARE_BY_NAME: Record<string, number> = {
  // The conduit's agency apartment paper moves to the agency desk, and the
  // insurers' share is split between two; the money-centre bank is ADDED
  // capacity, like Tidewater — national money that was not in this town's
  // books before.
  "Meridian Street Capital": 650 / 2410, "Keystone Agency Finance": 250 / 2410,
  "Pelican Life Insurance": 400 / 2410, "Ashford Life & Annuity": 240 / 2410,
  "Bowline National Bank": 250 / 2410,
};
const BOOK_SHARE: Record<LenderKind | "firstharbor" | "tidewater", number> = {
  // Tidewater's book is ADDED (+70, ~3% more property debt), not carved out of
  // the regional: shrinking the regional pushed the street's loans past its
  // single-name limits onto the hometown bank, which then failed of
  // concentration in two of four measured centuries — a side effect, not the
  // mechanism this desk exists to add.
  conduit: 900 / 2410, life: 640 / 2410, fund: 310 / 2410, bank: 420 / 2410, firstharbor: 140 / 2410, tidewater: 70 / 2410,
};

/** A desk's ordinary share of the town's property debt (the weights above). */
export function bookShareOf(name: string, kind: LenderKind): number {
  return BOOK_SHARE_BY_NAME[name] ?? (name === "First Harbor Bank" ? BOOK_SHARE.firstharbor
    : name === "Tidewater Community Bank" ? BOOK_SHARE.tidewater : BOOK_SHARE[kind]);
}

/**
 * DESKS COMPETE FOR THE BUSINESS (2026-10-14). Every desk quoted its own sheet
 * and the cheapest won the deal, but a desk that kept losing did nothing about
 * it and one that won everything did not notice it was full. A lending desk
 * has an origination budget: behind it, it sharpens its pencil to win the
 * next file; over its normal weight in a market, it widens to slow down. The
 * spread a desk gives away or adds, in points, glides with its share of the
 * town's book against its ordinary share — up to a quarter point sharper,
 * three tenths wider. Shape parameters, stated as such; the direction is the
 * one every origination desk runs on, and it is what compressed spreads in
 * 2005-07 when every desk was behind on volume at once.
 */
export function lenderChase(s: GameState, name: string): number {
  return lenderByName(s, name)?.chase ?? 0;
}

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
    const share = bookShareOf(name, k.kind);
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
      + `2.5x the prior limit, permanently, after a bank failure.`,
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
export const OPERATING_DISCOUNT_PCT = 0.5;
export function depositApy(econ: { nat?: { policy?: number } } | undefined, bank?: Lender): number {
  // AN OPERATING ACCOUNT EARNS WHAT ITS BANK POSTS, less what a business
  // account gets under the retail rate (earnings credit, analysis fees): the
  // posted rate is ~0.6 of policy, so at a 4% policy rate this is ~1.75%,
  // and more at a bank paying up for money.
  if (bank?.dep?.rate !== undefined) return Math.max(0, (bank.dep.rate - OPERATING_DISCOUNT_PCT) / 100);
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
    text: `Your bank failed: ${l.name} held ${usdShort(here)}. `
      + `${usdShort(insured)} insured, available Monday; ${usdShort(exposed)} uninsured, `
      + `unsecured claim on the receiver. Expected recovery ~${(recovery * 100).toFixed(0)}c on the dollar `
      + `(${usdShort(eventual)}) in one to two years; ${usdShort(lost)} lost. `
      + (split.inBills > 0 ? `${usdShort(split.inBills)} in Treasury bills unaffected.` : `Treasury bills (Banks page) are not exposed to bank failure.`),
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
      text: `${street} market construction site${street > 1 ? "s" : ""} funded by ${l.name} `
        + `lost their loan draws. Expect stalled projects.`,
    });
  }

  if (!jobs) return;
  s.news.unshift({
    q: s.month, kind: mine > 0 ? "warn" : "info",
    text: mine > 0
      ? `Construction funding stopped on your project${mine > 1 ? "s" : ""}. ${l.name} had ${usdShort(exposed)} of undrawn `
        + `commitment across ${jobs} site${jobs > 1 ? "s" : ""} in this town, ${mine} of them your${mine > 1 ? "s" : " s"}. `
        + `The receiver will not fund further draws. Drawn balance stays outstanding; interest now `
        + `paid from your cash, not the reserve. `
        + `Refinance the construction loan within a season.`
      : `${usdShort(exposed)} of undrawn construction commitment died with ${l.name}. `
        + `${jobs} site${jobs > 1 ? "s" : ""} lost funding.`,
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
      text: `Receivership distribution · ${r.from} · ${usdShort(r.amount)} returned to you.`,
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
  if (l.kind === "conduit" && econ && ((econ as { nat?: { creditNat?: number } }).nat?.creditNat ?? econ.creditIdx ?? 1) < 0.6) return { word: "the bond window is shut — not writing", bad: true };
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
  if (l.kind === "conduit" && (s.econ.nat?.creditNat ?? s.econ.creditIdx ?? 1) < 0.6) return { word: "closed", why: "The bond market it sells into is shut." };
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

// ---- THE DEPOSIT MARKET (2026-10-14) ---------------------------------------
//
// A bank's funding was a formula: deposits at the index less 2.2 points, the
// same for every bank in town, and no depositor ever moved. So nobody competed
// for money, a bank short of funding paid what a flush one did, and a run was
// a surcharge rather than money leaving. The deposits are now a market.
//
// THE TOWN'S DEPOSITS. Loans create deposits — the money a bank lends lands in
// somebody's account — so the system's deposit base follows the banks' own
// lending (a core-funded share of each book, at a ~85% loan-to-deposit ratio,
// the FDIC aggregate in 2005-07). It DRAINS when the banks' posted rates lag
// the money-market rate by more than usual: the "deposits channel"
// (Drechsler, Savov & Schnabl, QJE 2017 — core deposits shrink a few per cent
// for each point the deposit spread widens; 1980-81, 1994, 2022-23 when money
// funds took in a trillion dollars).
//
// WHO HOLDS THEM. Each bank posts a rate. Depositors drift toward the better
// rate, slowly — deposit relationships are sticky, which is the franchise
// value of a bank (a share moves ~3% of the way to where rates point each
// month) — and AWAY from a bank that looks unsafe, fast, in proportion to how
// much of its money is over the insurance limit: SVB's uninsured deposits
// left at a quarter of the bank in a day; a community bank whose money is
// three-quarters insured barely noticed 2008. What leaves a weak bank lands
// at the strong ones (the flight to quality of March 2023).
//
// WHAT A BANK POSTS. Its rate sits under the policy rate by a spread that
// widens as rates rise (a deposit beta of 0.6: DSS 2017), plus what it
// needs: a bank leaning on borrowed money beyond its usual mix pays up for
// deposits; a bank sitting on idle cash cuts. Rates go up slowly and down
// fast (Neumark & Sharpe, QJE 1992). A bank under its capital target may not
// pay more than 75bp over the market — the brokered-deposit rate cap on
// banks that are not well capitalised (FDIA §29; 12 CFR 337.6).
//
// WHAT FUNDS THE GAP. Whatever the book needs that deposits do not supply is
// borrowed — FHLB advances, brokered CDs, repo — at the short rate plus a
// spread, and it is the borrowed money that a panic reprices. Cash and
// securities, ~12% of deposits, earn the bill rate. A bank's cost of funds is
// therefore what its own deposits, its own borrowing and its own liquidity
// cost it — and differs bank to bank.
const LDR = 0.85;              // loan-to-deposit, core-funded share
const LIQ_TARGET = 0.12;       // cash and securities, share of deposits
const WHOLESALE_SPREAD = 0.2;  // FHLB/brokered over the short rate
/**
 * WHAT BORROWED MONEY COSTS A BANK OVER THE SHORT RATE, TODAY. In an ordinary
 * year FHLB advances and brokered CDs run ~0.2 over; when the national credit
 * market seizes (econ.nat.creditNat, the bond market this town cannot move)
 * the term money market reprices with it — three-month LIBOR over OIS ran
 * ~0.1 before 2007, ~1 point through 2008 and 3.6 at its peak (Sengupta &
 * Tam 2008; Fed H.15). 1.5 points per unit of national window lost puts the
 * 0.4 floor (2008Q4) at +0.9: a cycle average, not the one-week peak.
 */
function wholesaleSpread(e: { nat?: { creditNat?: number } }): number {
  return WHOLESALE_SPREAD + 1.5 * Math.max(0, 1 - (e.nat?.creditNat ?? 1));
}
const RATE_PULL = 0.5;         // share preference per point of rate gap (log)
const STICKY = 0.03;           // monthly share adjustment toward where rates point
// A deposit beta of 0.6: banks pass on about six tenths of a policy move to
// depositors (DSS 2017 measure ~0.5-0.6 across cycles; the average cost of
// interest-bearing deposits was ~3.3% with fed funds at 5.25% in 2007, and
// ~0.3% at the zero bound in 2013).
function postedBase(policy: number): number {
  return Math.max(0.05, 0.6 * policy - 0.15);
}
function fundable(l: Lender): number { return Math.max(0, l.book - Math.max(0, l.capital)); }
/** Deposits a bank's book would carry at its usual funding mix. */
function coreNeed(l: Lender): number {
  const k = KIND[l.name] ?? { wholesale: 0.5 };
  return fundable(l) * (1 - k.wholesale) / LDR;
}
/** The deposit-weighted rate the town's banks are posting — what a depositor shops against. */
export function marketDepositRate(s: GameState): number | undefined {
  const b = (s.lenders ?? []).filter((l) => l.kind === "bank" && l.failedM === undefined && l.dep?.rate !== undefined);
  const T = b.reduce((a, l) => a + (l.dep?.total ?? 0), 0);
  return T > 0 ? b.reduce((a, l) => a + (l.dep!.total * l.dep!.rate!), 0) / T : undefined;
}
function tickDeposits(s: GameState, panic: number) {
  const e = s.econ;
  const policy = e.nat?.policy ?? Math.max(0.05, shortIndexOf(e) - 0.15);
  const banks = (s.lenders ?? []).filter((l) => l.kind === "bank" && l.failedM === undefined);
  if (!banks.length) return;
  for (const l of banks) {
    if (l.dep?.rate !== undefined) continue;
    const k = KIND[l.name] ?? { uninsured: 0.35 };
    const D = coreNeed(l);
    l.dep = { total: Math.round(D), uninsuredShare: k.uninsured ?? 0.35, rate: +postedBase(policy).toFixed(3) };
  }
  const T = banks.reduce((a, l) => a + l.dep!.total, 0);
  const rbar = T > 0 ? banks.reduce((a, l) => a + l.dep!.total * l.dep!.rate!, 0) / T : postedBase(policy);
  // the pool: follows lending, drains when bank rates lag the money funds by more than usual
  const usualGap = policy - postedBase(policy);
  const drain = Math.exp(-0.04 * Math.max(0, (policy - rbar) - usualGap));
  const need = banks.reduce((a, l) => a + coreNeed(l), 0);
  const Tnext = T + (need * drain - T) / 12;
  // the shares
  const safety = new Map<Lender, number>();
  let wsum = 0, nsum = 0;
  for (const l of banks) nsum += coreNeed(l);
  const want = new Map<Lender, number>();
  for (const l of banks) {
    const k = KIND[l.name] ?? { capitalRatio: 0.1 };
    const weak = Math.max(0, Math.min(1, 1 - capitalRatio(l) / Math.max(0.01, k.capitalRatio)));
    const fear = 1.5 * weak + (panic > 0 ? panic * (0.35 + weak) * 0.5 : 0);
    const sf = Math.max(0.15, 1 - l.dep!.uninsuredShare * fear);
    safety.set(l, sf);
    const w = (nsum > 0 ? coreNeed(l) / nsum : 1 / banks.length) * Math.exp(RATE_PULL * (l.dep!.rate! - rbar)) * sf;
    want.set(l, w); wsum += w;
  }
  const share = new Map<Lender, number>();
  let ssum = 0;
  for (const l of banks) {
    const cur = T > 0 ? l.dep!.total / T : 1 / banks.length;
    const tgt = wsum > 0 ? want.get(l)! / wsum : cur;
    // a bank that looks unsafe loses its uninsured money fast; a rate gap moves money slowly
    const speed = tgt < cur ? STICKY + 0.25 * (1 - safety.get(l)!) : STICKY;
    const sh = Math.max(0, cur + speed * (tgt - cur));
    share.set(l, sh); ssum += sh;
  }
  for (const l of banks) {
    const d = l.dep!;
    const D = Math.round(Tnext * (ssum > 0 ? share.get(l)! / ssum : 0));
    d.hist = [...(d.hist ?? []), D].slice(-13);
    d.flowYr = d.hist.length >= 13 && d.hist[0] > 0 ? +(D / d.hist[0] - 1).toFixed(4) : d.flowYr;
    d.total = D;
    const F = fundable(l);
    d.wholesale = Math.round(Math.max(0, F + LIQ_TARGET * D - D));
    d.liquid = Math.round(D + d.wholesale - F);
    // next month's posted rate
    const k = KIND[l.name] ?? { wholesale: 0.5, capitalRatio: 0.1 };
    const lean = F > 0 ? d.wholesale / F - k.wholesale : 0;
    const idle = D > 0 ? Math.max(0, d.liquid / D - 0.2) : 0;
    let adj = Math.max(-0.5, Math.min(1.25, 1.5 * lean - 2 * idle));
    if (capitalRatio(l) < k.capitalRatio * 0.8) adj = Math.min(adj, (rbar - postedBase(policy)) + 0.75);
    const tgt = Math.max(0.05, postedBase(policy) + adj);
    const r = d.rate!;
    d.rate = +(r + (tgt > r ? 0.15 : 0.3) * (tgt - r)).toFixed(3);
  }
}

/** A bank's all-in cost of funds this month, % of its book a year, and the share of the book borrowed (what a panic reprices). */
function bankFunding(s: GameState, l: Lender): { cost: number; borrowed: number } | undefined {
  const d = l.dep;
  if (l.kind !== "bank" || !d || d.rate === undefined || !(l.book > 0)) return undefined;
  const e = s.econ;
  const short = shortIndexOf(e);
  const bills = Math.max(0, (e.nat?.policy ?? short) - 0.1);
  const W = d.wholesale ?? 0, L = d.liquid ?? 0;
  const annual = d.total * d.rate + W * (short + wholesaleSpread(e)) - L * bills;
  return { cost: annual / l.book, borrowed: W / l.book };
}

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
    if (shut && !e.debtShut) s.news.unshift({ q: s.month, kind: "warn", text: "Debt markets closed: CMBS buyers gone, banks lending only to existing relationships, term sheets pulled." });
    if (!shut && e.debtShut) s.news.unshift({ q: s.month, kind: "event", text: "Lenders quoting again, selectively and at higher spreads." });
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
  // THE TAPE OF NEW LENDING — who wrote last month's term paper, by dollars,
  // twelve months deep. The competitive half of the price reads it (below).
  {
    const by: Record<string, number> = {};
    for (const [k, t] of Object.entries(desks)) if (t.orig > 0) by[k] = Math.round(t.orig);
    s.loanTape = [...(s.loanTape ?? []), { m: s.month - 1, by }].slice(-12);
  }
  const e = s.econ;

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
  // ...and a panic from outside the town (blackswans.ts) reprices every
  // desk's hot money the same way a failure next door does.
  panic = Math.max(panic, e.panic?.force ?? 0);
  tickDeposits(s, panic);

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
    if (l.failedM !== undefined && l.namedOnly) l.book = l.namedBook;
    if (l.failedM !== undefined) {
      if (s.month - l.failedM >= (l.reopenM ?? 18)) {
        const k = KIND[l.name] ?? { capitalRatio: 0.1 };
        // The receiver sells the franchise: the named loans that were on it
        // are still the named loans (still paying, or still not), and the
        // acquirer recapitalises it above its target.
        if (l.dep) l.dep.total = Math.round(l.dep.total * 0.55);  // the franchise's deposits, smaller
        l.book = desks[l.name]?.named ?? 0;
        l.capital = Math.round(Math.max(l.book, 20_000_000 * (e.priceLevel ?? 1)) * k.capitalRatio * 1.15);   // a resolved bank opens overcapitalised
        l.delinquent = (desks[l.name]?.defaulted ?? 0) / Math.max(1, l.book);
        l.appetite = 0.75;
        l.chargeOffsYr = 0; l.netIncomeYr = 0;
        const rec = [...(s.bankFails ?? [])].reverse().find((b) => b.lender === l.name && b.reopenedM === undefined);
        if (rec) rec.reopenedM = s.month;
        delete l.failedM; delete l.reopenM;
        l.lossM = {};
        s.news.unshift({
          q: s.month, kind: "info",
          text: `${l.name} is lending again after recapitalization by new owners. `
            + `Bad loans stayed with the receiver; smaller book, tighter standards.`,
        });
      }
      // The receiver's losses are the receiver's: nothing carries into the
      // reopened desk's first statement.
      l.lossM = {};
      continue;
    }
    const k = KIND[l.name] ?? { capitalRatio: 0.1, brittle: 1, wholesale: 0.5, adc: 0.08 };
    // --- THE BOOK IS THE LOANS ----------------------------------------------
    // Every loan on the record (loanbook.ts): yours, the firms', the private
    // owners' (streetLoans.ts), the cranes. There is no anonymous book any
    // more: a desk's size is what its borrowers owe it.
    const named = desks[l.name] ?? { named: 0, defaulted: 0, watch: 0, yours: 0, byClass: {}, byCls: {}, couponYr: 0, rated: 0, orig: 0 };
    if (!l.namedOnly && s.streetLoans) {
      // ONCE, on the first tick with the private mortgages on the record: the
      // opening books (initLenders) were sized off a market-wide loan-to-value,
      // and the deeds, counted, come to less (ownership.ts says so in as many
      // words). The desk keeps its capital RATIO, not its capital pile — on a
      // new game that is its own target; on an old save the ratio it had.
      const before = l.book;
      const after = named.named;
      const floor = 20_000_000 * (e.priceLevel ?? 1) * k.capitalRatio;
      if (before > 0) l.capital = Math.round(Math.max(floor, l.capital * after / before));
      // ...and the deposits that funded the old book shrink with it: loans
      // make deposits, and a bank does not sit on a book's worth of money it
      // has no loans for.
      if (l.dep && before > 0) {
        const f = Math.max(after, 1) / before;
        l.dep.total = Math.round(l.dep.total * f);
        if (l.dep.wholesale !== undefined) l.dep.wholesale = Math.round(l.dep.wholesale * f);
        if (l.dep.liquid !== undefined) l.dep.liquid = Math.round(l.dep.liquid * f);
        if (l.dep.hist) l.dep.hist = l.dep.hist.map((x) => Math.round(x * f));
      }
      delete l.anonBook; delete l.anonDelinq;
      l.namedOnly = true;
    }
    l.book = Math.round(named.named);
    const spread = BOOK_SPREAD[l.kind] ?? 1.9;

    // --- the book earns WHAT ITS BORROWERS PAY -------------------------------
    // Each loan's own coupon, on the loans that are paying: a desk that won
    // its book by sharpening its price earns the sharper price, and one whose
    // borrowers have stopped paying earns nothing on them. Paper that carries
    // no coupon of its own on the record (the firms' lines, the merchants'
    // construction loans) earns the kind's book spread over today's index.
    const performing = Math.max(0, l.book - named.defaulted);
    const unrated = Math.max(0, performing - named.rated);
    const interestYr = named.couponYr + unrated * (e.indexRate + spread) / 100;
    l.bookYield = +(performing > 0 ? (interestYr / performing) * 100 : (l.bookYield ?? e.indexRate + spread)).toFixed(4);
    const interest = interestYr / 12;
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
      : shortIndexOf(e) + 1.1;
    const then = e.history[e.history.length - 13]?.indexRate ?? e.indexRate;
    const hot = Math.max(0, e.indexRate - then - 0.6);
    // A CONDUIT DOES NOT CARRY A RATE BET. It writes a loan, warehouses it for
    // a few weeks and sells it into a trust priced off the same index, so its
    // margin is the gain on sale — fixed at the kind's normal margin, whatever
    // the index does — for as long as the bond window is open (the same test
    // `windowOpen` puts to the desk). When the window shuts the warehouse is
    // stuck on repo and the old funding law is exactly right.
    const natWin = e.nat?.creditNat ?? e.creditIdx ?? 1;
    const conduitOpen = l.kind === "conduit" && natWin >= 0.6;   // = windowOpen (debt.ts): the national bond market
    const fundTarget = conduitOpen ? (l.bookYield ?? e.indexRate + spread) - (NORMAL_NIM.conduit ?? 1.6) : baseFund + hot * k.wholesale;
    if (l.fundCost === undefined) l.fundCost = baseFund;
    // AN INSURER'S MONEY IS AS LONG AS ITS LOANS: the general account
    // reprices at the speed its book does (2.5% a month), both ways.
    const bf = bankFunding(s, l);
    l.fundCost = bf ? +bf.cost.toFixed(4)
      : conduitOpen ? +fundTarget.toFixed(4)
      : l.kind === "life" ? +(l.fundCost + 0.025 * (fundTarget - l.fundCost)).toFixed(4)
      : +(l.fundCost + (fundTarget > l.fundCost ? 0.22 : 0.07) * (fundTarget - l.fundCost)).toFixed(4);
    // The panic surcharge, priced off how much this desk resembles the one in
    // receivership. A desk at its capital target pays the base share; one at
    // half its target pays nearly three times that.
    const weak = Math.max(0, Math.min(1.5, 1 - capitalRatio(l) / Math.max(0.01, k.capitalRatio)));
    // A bank's panic lands on what it actually borrows this month; the others on their structural mix.
    l.panicBps = panic > 0 ? +(PANIC_PEAK * panic * (bf ? bf.borrowed : k.wholesale) * (0.35 + weak)).toFixed(3) : 0;
    const allIn = Math.max(0, l.fundCost + (l.panicBps ?? 0));
    const funding = (l.book * allIn) / 100 / 12;

    // --- and it goes bad: COUNTED -------------------------------------------
    // A loan the engine runs is either being paid or it is not, and the
    // desk's delinquency line is what its own borrowers are actually doing:
    // your arrears, a firm's missed payment, a private owner whose buildings
    // stopped carrying their mortgage, a frame whose sponsor died. Losses are
    // booked when they happen — the deed in lieu, the auction, the short
    // sale, the desk's own foreclosure — at the size the collateral fetched,
    // against the borrower by name (chargeLenderLoss).
    l.delinquent = Math.min(1, named.defaulted / Math.max(1, l.book));
    l.typeBook = named.byCls;
    // This month's charge-offs, as booked against capital by chargeLenderLoss
    // the moment each loan was resolved: through the income statement now,
    // with the tax they save (a loss is deductible; carried back, so a loss
    // month books a tax asset).
    const losses = Object.values(l.lossM ?? {}).reduce((a, v) => a + (v ?? 0), 0);
    trackLosses(l, named);
    const opex = (l.book * (OPEX_PCT[l.kind] ?? 0)) / 100 / 12;
    const pre = interest - funding - losses - opex;
    const net = Math.round(pre * (1 - (TAX_RATE[l.kind] ?? 0)));
    {
      const y = (l.incYr ??= { interest: 0, funding: 0, losses: 0, opex: 0, tax: 0 });
      y.interest += Math.round(interest); y.funding += Math.round(funding);
      y.losses += Math.round(losses); y.opex += Math.round(opex);
      y.tax += Math.round(pre - net);
    }
    l.netIncomeYr += net;
    // the losses already left capital when they were booked
    l.capital = Math.round(l.capital + net + losses);

    // --- CAPITAL IS MANAGED, NOT HOARDED -------------------------------------
    // Measured before this existed: retained earnings compounded untouched for
    // a century, the three deposit-funded desks ended every 600-month run at
    // 60-72% capital against 9.5-18% targets, and their appetite sat pinned at
    // the 1.15 cap for an average of 1.15 over 2,400 lender-months — the
    // credit cycle only ever happened to the conduit. A bank above its buffer
    // pays the excess out, which is what keeps a loss in year forty as
    // dangerous as one in year four.
    const target = k.capitalRatio;
    // THE CONDUIT BUSINESS IS RECAPITALISED BY THE BOND MARKET (2026-10-14). A
    // conduit is never seized, so a desk whose thin first-loss capital had
    // been eaten sat at zero appetite for decades while the bond window was
    // open — measured, 48% of all months over fifty years, and with it the one
    // desk with no hold size. That is not the business: after 2009 new sponsors
    // and recapitalised shelves were issuing again inside two years (CMBS 2.0,
    // 2010-12). While the national window is open, the desk is brought back
    // toward its target over about a year. Measured over fifty years: the
    // conduit unable to quote fell from 54% of months to 10%, nearly all of
    // them the national window itself shut (9%).
    if (l.kind === "conduit" && conduitOpen && l.capital < l.book * target) {
      l.capital = Math.round(l.capital + (l.book * target - Math.max(l.capital, 0)) / 12 + Math.max(0, -l.capital) / 12);
    }
    // (A desk with almost nothing on its book keeps the capital it opened
    // with — the $20M floor initLenders sizes a desk at — rather than paying
    // itself down to nothing and being closed for having no capital.)
    const buffer = Math.max(l.book, 20_000_000 * (e.priceLevel ?? 1)) * target * 1.15;
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
    // ...ON ITS OWN WATCH LIST (2026-10-28). A credit committee does not wait
    // for the charge-offs to tighten: the loans whose buildings no longer
    // cover their coupon, and the ones already not paying, are on its desk
    // every month, and they are the first thing the Fed's loan-officer survey
    // finds behind tightening (SLOOS: "deterioration in the bank's current or
    // expected capital position" and "less favorable outlook for CRE"). Half
    // weight on watch, full on default; nothing below 3% of the book, the
    // ordinary noncurrent-plus-criticised share in a quiet year, and the most
    // it cuts is to 0.4 — a shape stated as such, not fitted.
    const stressed = l.book > 0 ? (named.defaulted + 0.5 * named.watch) / l.book : 0;
    const watchFac = Math.max(0.4, Math.min(1, 1 - 4 * Math.max(0, stressed - 0.03)));
    // ...AND ON ITS DEPOSITS. A bank losing its funding stops growing its
    // loans before it has to sell any: a tenth of its deposits gone in a year
    // takes a fifth off what it will write (shape, stated). Nothing while
    // the money is flat or arriving.
    const flow = l.kind === "bank" ? (l.dep?.flowYr ?? 0) : 0;
    const liqFac = Math.max(0.5, Math.min(1, 1 + 2 * Math.min(0, flow + 0.05)));
    l.appetite = Math.max(0, Math.min(1.15,
      (raw - 0.55) / 0.6 * nimFac * watchFac * liqFac * (l.kind === "conduit" ? Math.max(0.25, Math.min(1, natWin)) : 1)));

    if (s.month % 12 === 0 && s.month > 0) {
      if (l.incYr) l.incPrevYr = { ...l.incYr, netIncome: l.netIncomeYr, dividends: l.divYr ?? 0, chargeOffs: l.chargeOffsYr };
      l.incYr = { interest: 0, funding: 0, losses: 0, opex: 0, tax: 0 };
      l.chargeOffsYr = 0; l.netIncomeYr = 0; l.divYr = 0;
    }

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
            text: `${l.name} failed and was acquired the same weekend. All deposits transferred, `
              + `insured or not; no loss to your account.`,
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
        stops: (l.yours ?? 0) > 0 || wasOurs,
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
        text: `${l.name} stopped lending: ${(l.delinquent * 100).toFixed(1)}% of their book delinquent, capital constrained.`,
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
  // --- WHAT EACH DESK CHARGES, AND WHO IS PITCHING AT WHOM -----------------
  priceDesks(s);

  // --- THE CREDIT WINDOW IS WHAT THE BANKS WANT TO LEND (2026-10-28) --------
  // creditIdx was an equation (market.ts stepCredit): payroll growth and the
  // national unemployment rise, with the desks' appetite dragging it at a
  // third of the pull. It is now the desks' appetite and nothing else —
  // capital-weighted, because a desk's capital is what its appetite can
  // actually put to work — read off their books: capital against target,
  // margin, the watch list, the deposits. A desk in receivership wants to
  // lend nothing and still counts at the capital it should have, so a failure
  // shuts the window by exactly the capacity it took out. The field and its
  // scale are unchanged for every reader: 1 is an ordinary year (desks at
  // their targets, margins normal), 0.4 the bottom of 2008-09 (nobody
  // lending). The pace is the one the equation had and the Fed's survey
  // shows: standards slam shut in a quarter or two and loosen over years
  // (SLOOS 2008Q4 vs 2010-12).
  {
    let w = 0, a = 0;
    for (const l of s.lenders) {
      const t = targetCapital(l.name);
      const cap = l.failedM !== undefined ? t * Math.max(0, l.book) : Math.max(0, l.capital);
      w += cap;
      a += cap * (l.failedM !== undefined ? 0 : Math.min(1.15, l.appetite));
    }
    const sysApp = w > 0 ? a / w : 0;
    s.bankApp = +sysApp.toFixed(3);
    const want = 0.4 + 0.6 * sysApp;
    const ci = e.creditIdx ?? 1;
    e.creditIdx = Math.max(0.4, Math.min(1.25, ci + (want < ci ? 0.16 : 0.055) * (want - ci)));
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
  // ...and counts last month's new term paper for the competitive tape.
  // ONE COUNT, FROM THE LOAN BOOK. This walked first mortgages and
  // construction only, so a borrower could put $40M on a desk through its
  // portfolio facility, stack mezzanine behind every senior and draw the
  // line, and still read as a stranger to the single-name test in
  // `concentrationRoom` — the one test whose whole purpose is to see that.
  const by = deskTotals(cityLoanBook(s), s.month - 1);
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
export function chargeLenderLoss(
  s: GameState, lender: string, loss: number,
  who?: { borrower: string; id?: string; bbl?: string; cls?: LossClass; how?: string },
) {
  const l = lenderByName(s, lender);
  if (!l || loss <= 0) return;
  const borne = borneLoss(l, loss);
  l.capital = Math.round(l.capital - borne);
  l.chargeOffsYr += loss;
  l.chargeOffsTotal += loss;
  // THE PLAYER'S share of the book comes down only for a loss on the
  // player's own paper; a private owner's foreclosure is not yours.
  if (!who || who.id === "player") l.yours = Math.max(0, l.yours - loss);
  // ...and it is EXPERIENCE: the loss rate this desk prices the next loan of
  // the kind off (trackLosses), and a line on its statement with a name on it.
  const cls = who?.cls ?? "income";
  (l.lossM ??= {})[cls] = (l.lossM[cls] ?? 0) + borne;
  (l.lossLog ??= []).unshift({
    m: s.month, borrower: who?.borrower ?? "unattributed", id: who?.id, bbl: who?.bbl, cls,
    amount: Math.round(loss), how: who?.how,
  });
  if (l.lossLog.length > 40) l.lossLog.length = 40;
}

// ---- WHAT A DESK CHARGES (2026-10-28) --------------------------------------
//
// pricing.ts says what the parts are; these are the facts behind them.

/**
 * THE LONG-RUN LOSS RATE BY LOAN TYPE, % of balance a year — what a desk
 * with no experience of its own prices against, and a third of what every
 * desk prices against. Federal Reserve charge-off rates on bank CRE loans
 * (1991-2019) and FDIC Quarterly Banking Profile series by type: income
 * property ~0.3-0.4% a year through the cycle (peaks near 2% in 1991 and
 * 2010); construction and development ~1% (peak ~5-6% in 2009-10); land worse
 * than construction; mezzanine and transitional bridge paper behind or
 * ahead of the senior book ~1.5% (Trepp/CRE CLO loss histories).
 */
export const PRIOR_EL: Record<LossClass, number> = { income: 0.35, construction: 1.0, land: 1.5, junior: 1.5 };
/**
 * CAPITAL HELD PER DOLLAR, as a multiple of the desk's own target: income
 * property at 100% risk weight, construction and land at 150% (the HVCRE
 * weight, 12 CFR 324.32(j)), subordinate and bridge paper at 150%.
 */
const RISK_WEIGHT: Record<LossClass, number> = { income: 1, construction: 1.5, land: 1.5, junior: 1.5 };
/**
 * THE RETURN ITS OWNERS WANT on that capital, after tax: banks ~11% (cost of
 * equity, Damodaran's bank sector 2000-2024 ~9-12%), life companies' general
 * accounts ~10%, the conduit's first-loss buyers ~15% (B-piece yields), the
 * debt fund's LPs ~12% net. Shown on the Banks page as the capital line.
 */
const HURDLE: Record<LenderKind, number> = { bank: 11, life: 10, conduit: 15, fund: 12 };
const CLASSES: LossClass[] = ["income", "construction", "land", "junior"];

/** Fold this month's losses and balances into the desk's 36-month experience. */
function trackLosses(l: Lender, named: DeskTotals) {
  const lossEw = (l.lossEw ??= {}), balEw = (l.balEw ??= {});
  for (const c of CLASSES) {
    const bal = named.byCls[c]?.bal ?? 0;
    if (balEw[c] === undefined) { balEw[c] = bal; lossEw[c] = bal * PRIOR_EL[c] / 100; }
    balEw[c] = balEw[c]! + (bal - balEw[c]!) / 36;
    lossEw[c] = lossEw[c]! + (((l.lossM?.[c] ?? 0) * 12) - lossEw[c]!) / 36;
  }
  l.lossM = {};
}

/** Expected loss by class: two-thirds this desk's own experience, a third the industry's long-run rate. */
function expectedLoss(l: Lender, c: LossClass): number {
  const b = l.balEw?.[c] ?? 0;
  const own = b > 1 ? 100 * (l.lossEw?.[c] ?? 0) / b : PRIOR_EL[c];
  return PRIOR_EL[c] / 3 + (2 / 3) * own;
}

/**
 * ONE DESK'S PRICE PARTS. Funding is measured against the market rate the
 * desk's money is priced off — the short index for a deposit bank (its
 * transfer price: what a dollar of its own funding costs against what the
 * money market charges), the long index for the insurers and the fund — and
 * the part that passes into the quote is its funding against what its OWN
 * mix costs when nothing is wrong, so the rate cycle's effect on every
 * bank's deposits is not a reason for one bank to quote differently from
 * another, and paying up for money, leaning on brokered CDs or a panic
 * surcharge is.
 */
export function deskPricing(s: GameState, l: Lender): DeskPx {
  const e = s.econ;
  const k = KIND[l.name] ?? { capitalRatio: 0.1, wholesale: 0.5 };
  const short = shortIndexOf(e);
  const panic = l.panicBps ?? 0;
  let fund: number, dFund: number;
  if (l.kind === "bank" && l.dep?.rate !== undefined && l.book > 0) {
    const d = l.dep;
    const policy = e.nat?.policy ?? Math.max(0.05, short - 0.15);
    const base = postedBase(policy);
    // THE MARGINAL DOLLAR, not the average one: a new loan is funded at the
    // rate this bank posts for deposits and, for the share it borrows, at
    // what borrowed money costs it today — at its usual mix, or at the mix it
    // is actually running if it is leaning on borrowed money harder than that.
    const F = fundable(l);
    const W = d.wholesale ?? 0;
    const wsh = Math.max(k.wholesale, F > 0 ? Math.min(1, W / F) : k.wholesale);
    const ws = short + wholesaleSpread(e);
    const marg = (1 - wsh) * d.rate! + wsh * ws + panic;
    const usual = (1 - k.wholesale) * base + k.wholesale * (short + WHOLESALE_SPREAD);
    fund = marg - short;
    dFund = marg - usual;
  } else if (l.kind === "conduit") {
    const open = (e.nat?.creditNat ?? e.creditIdx ?? 1) >= 0.6;
    fund = open ? 0.3 + panic : (l.fundCost ?? e.indexRate + 0.3) + panic - e.indexRate;
    dFund = fund - 0.3;
  } else {
    const ref = l.kind === "life" ? -0.3 : l.kind === "fund" ? 1.1 : -2.2;
    const mkt = l.kind === "fund" ? short : e.indexRate;
    fund = (l.fundCost ?? mkt + ref) + panic - mkt;
    dFund = fund - ref;
  }
  const el: DeskPx["el"] = {}, dEl: DeskPx["dEl"] = {}, cap: DeskPx["cap"] = {};
  const tax = TAX_RATE[l.kind] ?? 0;
  for (const c of CLASSES) {
    el[c] = +expectedLoss(l, c).toFixed(3);
    dEl[c] = +(el[c]! - PRIOR_EL[c]).toFixed(3);
    cap[c] = +(k.capitalRatio * RISK_WEIGHT[c] * (HURDLE[l.kind] ?? 11) / (1 - tax)).toFixed(3);
  }
  const app = l.failedM !== undefined ? 0 : l.appetite;
  return {
    fund: +fund.toFixed(3), dFund: +dFund.toFixed(3), el, dEl, cap,
    opex: OPEX_PCT[l.kind] ?? 0, pull: +(0.8 * Math.max(0, 1 - app)).toFixed(3), chase: +(l.chase ?? 0).toFixed(3),
  };
}

/**
 * THE COMPETITIVE HALF OF THE PRICE. Each desk has a share of the town's new
 * term lending it is built to write — its usual share of the market
 * (bookShareOf), which is its origination budget — and it reads two things
 * every month: the share it has actually won over the last twelve months
 * (s.loanTape, counted off the record), and where its rivals are pitching
 * (their price against their sheets, their own costs included).
 *
 *   behind its share  it prices under its rivals, by up to a quarter point
 *                     the further behind it is — the 2005-07 pencil
 *                     sharpening, when every desk was behind on volume;
 *   ahead of it       it prices over them, by up to a quarter point, to slow
 *                     down before it is full;
 *   in between        it holds.
 *
 * Its own funding and loss experience come along whatever it does — a desk
 * with dear money prices dearer than one with cheap money pitching at the
 * same place — and its rationing charge (pull) is never competed away: a
 * desk short of capital or deposits pulls back whatever its rivals do. The
 * glide is a sixth a month (rate sheets are reset every few weeks) and the
 * pitch is bounded at ±0.75 points as a guard; the floor in pricing.ts stops
 * any desk pricing under its own costs. Shape parameters, stated as such.
 */
export function priceDesks(s: GameState) {
  const lenders = s.lenders ?? [];
  if (lenders.some((l) => l.usual0 === undefined) && lenders.every((l) => l.namedOnly)) {
    const tot = lenders.reduce((a, l) => a + Math.max(0, l.book), 0);
    for (const l of lenders) l.usual0 = tot > 0 ? +(Math.max(0, l.book) / tot).toFixed(4) : bookShareOf(l.name, l.kind);
  }
  const live = lenders.filter((l) => l.failedM === undefined);
  const won: Record<string, number> = {};
  let tot = 0;
  for (const t of s.loanTape ?? []) for (const [k, v] of Object.entries(t.by)) { won[k] = (won[k] ?? 0) + v; tot += v; }
  // THE USUAL SHARE is the market's shape as this town opened: each desk's
  // share of the opening book (set once, when the book became the named
  // loans). A conduit whose minimum cheque is bigger than most buildings in
  // town is not "behind" on a share of a market it was never in.
  const usualOf = (l: Lender) => l.usual0 ?? bookShareOf(l.name, l.kind);
  const shareSum = live.reduce((a, l) => a + usualOf(l), 0) || 1;
  const px = new Map<Lender, DeskPx>();
  for (const l of lenders) px.set(l, deskPricing(s, l));
  const own = (l: Lender) => px.get(l)!.dFund + (px.get(l)!.dEl.income ?? 0);
  for (const l of live) {
    const usual = usualOf(l) / shareSum;
    l.usualShare = +usual.toFixed(4);
    l.wonShare = tot > 0 ? +((won[l.name] ?? 0) / tot).toFixed(4) : undefined;
    // Half a year of the tape before a desk reads a share off it: two
    // months of a small town's lending is a coin toss, not a market.
    if (!(tot > 0) || (s.loanTape?.length ?? 0) < 6) continue;
    let w = 0, r = 0;
    for (const o of live) {
      if (o === l) continue;
      const wt = usualOf(o);
      w += wt; r += wt * (own(o) + (o.chase ?? 0));
    }
    const rivals = w > 0 ? r / w : 0;
    const behind = (won[l.name] ?? 0) / tot / Math.max(1e-6, usual) - 1;
    const chase = l.chase ?? 0;
    const want = behind < -0.15 ? rivals - own(l) - 0.25 * Math.min(1, -behind)
      : behind > 0.25 ? rivals - own(l) + 0.25 * Math.min(1, behind - 0.25)
      : chase;
    l.chase = +Math.max(-0.75, Math.min(0.75, chase + (want - chase) / 6)).toFixed(4);
    px.get(l)!.chase = +l.chase.toFixed(3);
  }
  const out: Record<string, DeskPx> = {};
  for (const l of lenders) { l.px = px.get(l)!; out[l.name] = l.px; }
  s.econ.deskPx = out;
}
