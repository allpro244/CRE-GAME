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
import { PRODUCTS } from "./debt";
import { rng, rrange } from "./market";

export type LenderKind = "bank" | "life" | "conduit" | "fund";

export interface Lender {
  id: string;
  name: string;
  kind: LenderKind;
  /** Everything they have lent, to you and to everyone else. */
  book: number;
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
  failedM?: number;
  /** How many months the receiver takes to sell the franchise on. */
  reopenM?: number;
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
const KIND: Record<string, { kind: LenderKind; capitalRatio: number; brittle: number; wholesale: number; blurb: string }> = {
  "First Harbor Bank": {
    kind: "bank", capitalRatio: 0.11, brittle: 0.5, wholesale: 0.2,
    blurb: "Deposits fund the book, so the losses have to be very bad before the lights go out. Small, local, and they remember who paid them in the bad years.",
  },
  "Alden Savings & Trust": {
    kind: "bank", capitalRatio: 0.095, brittle: 0.8, wholesale: 0.65,
    blurb: "A regional with a regional's problem: big enough to have made every mistake in the cycle, small enough that three of them matter.",
  },
  "Pelican Life Insurance": {
    kind: "life", capitalRatio: 0.18, brittle: 0.25, wholesale: 0.1,
    blurb: "Insurance float against long paper. The most patient money in the city and the most conservative — they are never the reason a crunch happens and never the ones who end it.",
  },
  "Meridian Street Capital": {
    kind: "conduit", capitalRatio: 0.04, brittle: 2.4, wholesale: 1.0,
    blurb: "They do not hold the loan; they sell it. Which is fine until nobody is buying, and then this desk is not tightening — it is closed.",
  },
  "Cordage Debt Partners": {
    kind: "fund", capitalRatio: 0.22, brittle: 1.1, wholesale: 0.3,
    blurb: "A fund with committed capital and no depositors to answer to. They lend into a crisis at crisis prices, which is the entire business model.",
  },
};

/** Who writes construction paper in this town. */
export const CONSTRUCTION_LENDER = "Alden Savings & Trust";

export function lenderBlurb(name: string): string {
  return KIND[name]?.blurb ?? "";
}

/** Every distinct lender named on a loan product, in the order they appear. */
export function lenderNames(): string[] {
  return [...new Set(PRODUCTS.map((p) => p.lender))];
}

export function initLenders(): Lender[] {
  return lenderNames().map((name, i) => {
    const k = KIND[name] ?? { kind: "bank" as LenderKind, capitalRatio: 0.10, brittle: 1 };
    // Book size is scale, and scale is what decides whether they can write your
    // cheque. A conduit is enormous and fragile; a hometown bank is neither.
    const book = k.kind === "conduit" ? 900_000_000
      : k.kind === "life" ? 640_000_000
      : k.kind === "fund" ? 310_000_000
      : name === "First Harbor Bank" ? 140_000_000 : 420_000_000;
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

/** Capital over book — the one number that decides whether a desk is open. */
export function capitalRatio(l: Lender): number {
  return l.book > 0 ? l.capital / l.book : 1;
}

/** In words, for the panel. */
export function lenderHealth(l: Lender): { word: string; bad: boolean } {
  if (l.failedM !== undefined) {
    const back = Math.max(0, (l.failedM + (l.reopenM ?? 18)));
    return { word: `in receivership — the franchise is being sold, back around month ${back}`, bad: true };
  }
  const cr = capitalRatio(l);
  const target = KIND[l.name]?.capitalRatio ?? 0.1;
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
  if (!s.lenders?.length) s.lenders = initLenders();
  recountYours(s);
  const e = s.econ;
  const vac = e.cityVac ?? {};
  // The average excess vacancy across the city: the single best predictor of
  // whether the loans behind those buildings are being paid.
  const nat = { office: 0.115, retail: 0.085, multifamily: 0.045, industrial: 0.07 } as Record<string, number>;
  let stress = 0, n = 0;
  for (const k of Object.keys(nat)) { stress += Math.max(0, (vac[k as never] ?? nat[k]) - nat[k]); n++; }
  stress = n ? stress / n : 0;

  for (const l of s.lenders) {
    // --- RESOLUTION ---------------------------------------------------------
    // A failed bank is not a hole in the market forever. A receiver sells the
    // franchise — the branches, the deposits and the name — and inside a year
    // or two somebody is lending out of the same building under new ownership,
    // recapitalised, smaller, and far more careful than the firm that died.
    // Without this the city loses a desk permanently every crisis and by year
    // forty there is nobody left to borrow from, which is not a hard game, it
    // is a broken one.
    if (l.failedM !== undefined) {
      if (s.month - l.failedM >= (l.reopenM ?? 18)) {
        const k = KIND[l.name] ?? { capitalRatio: 0.1 };
        l.book = Math.round(l.book * 0.55);
        l.capital = Math.round(l.book * k.capitalRatio * 1.15);   // a resolved bank opens overcapitalised
        l.delinquent = 0.004;                                     // the bad paper stayed with the receiver
        l.appetite = 0.75;
        l.chargeOffsYr = 0; l.netIncomeYr = 0;
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
    const k = KIND[l.name] ?? { capitalRatio: 0.1, brittle: 1, wholesale: 0.5 };
    const spread = 1.9;

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
      : l.kind === "life" ? Math.max(0, e.indexRate - 1.4)
      : l.kind === "conduit" ? e.indexRate + 0.3
      : e.indexRate + 1.1;
    const then = e.history[e.history.length - 13]?.indexRate ?? e.indexRate;
    const hot = Math.max(0, e.indexRate - then - 0.6);
    const fundTarget = baseFund + hot * k.wholesale;
    if (l.fundCost === undefined) l.fundCost = baseFund;
    l.fundCost = +(l.fundCost + (fundTarget > l.fundCost ? 0.22 : 0.07) * (fundTarget - l.fundCost)).toFixed(4);
    const funding = (l.book * Math.max(0, l.fundCost)) / 100 / 12;

    // --- and it goes bad -----------------------------------------------------
    // Delinquency follows the property cycle with a lag: buildings empty, then
    // owners burn reserves, then they stop paying. A recession alone is not
    // enough — it is a recession with vacancy behind it that does this.
    const badTarget = 0.006 + stress * 0.55 * k.brittle
      + (e.phase === "recession" ? 0.018 : e.phase === "recovery" ? 0.008 : 0) * k.brittle
      + Math.max(0, 1 - (e.creditIdx ?? 1)) * 0.03 * k.brittle;
    l.delinquent = Math.max(0.002, Math.min(0.35, l.delinquent + 0.10 * (badTarget - l.delinquent) + rrange(s, -0.0015, 0.0015)));

    // A third of what is delinquent is eventually written off, spread over a
    // year. That is the number that eats capital.
    const chargeOff = Math.round(l.book * l.delinquent * 0.33 / 12);
    l.chargeOffsYr += chargeOff;
    l.chargeOffsTotal += chargeOff;
    const net = Math.round(interest - funding - chargeOff);
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
    const nim = (l.bookYield ?? e.indexRate + spread) - Math.max(0, l.fundCost ?? 0);
    const nimFac = Math.max(0.25, Math.min(1, 0.35 + 0.65 * (nim - 0.8) / 2.8));
    l.appetite = Math.max(0, Math.min(1.15,
      (raw - 0.55) / 0.6 * nimFac * (l.kind === "conduit" ? Math.max(0.25, e.creditIdx ?? 1) : 1)));
    // Growth at 0.35%/mo compounded to an 8x book over fifty years while the
    // town's whole rival debt stayed under a quarter of one desk — the banks
    // outgrew the city they lend to. Half that pace keeps them in it.
    l.book = Math.max(20_000_000, Math.round(l.book * (1 + (l.appetite > 0.8 ? 0.0017 : l.appetite > 0.4 ? 0 : -0.006))));

    if (s.month % 12 === 0 && s.month > 0) { l.chargeOffsYr = 0; l.netIncomeYr = 0; l.divYr = 0; }

    // --- and sometimes it ends, ON A FRIDAY ----------------------------------
    // The regulator does not wait for zero. A desk critically under its own
    // target — a fifth of it — is operating on the examiners' patience, and
    // one Friday afternoon the patience ends. This is what makes failure a
    // cliff you can watch a desk walking toward on Research rather than an
    // asymptote it can hug forever.
    const seizable = l.kind === "bank" || l.kind === "life";   // the conduit dies by market, not by regulator
    if ((l.capital <= 0 && rng(s) < 0.35) || (seizable && cr < target * 0.22 && rng(s) < 0.09)) {
      l.failedM = s.month;
      l.reopenM = Math.round(rrange(s, 12, 30));
      l.appetite = 0;
      s.news.unshift({
        q: s.month, kind: "warn",
        text: `${l.name} has failed. ${l.kind === "conduit" ? "The securitisation market took it with them" : "The regulators walked in on a Friday afternoon and the name on the door meant nothing by Monday"} — `
          + `every loan they had outstanding is with a receiver now, and the receiver is not a lender. `
          + `Watch the note desk: a receiver sells the book, and a receiver does not haggle.`,
      });
    } else if (l.appetite < 0.15 && rng(s) < 0.04) {
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
}

/**
 * How much of each book is YOU, counted rather than tracked.
 *
 * Deltas drift — a payoff missed here, a deed handed back there, and by year
 * thirty the number is fiction. This walks the holdings every month, which is
 * cheap and cannot be wrong, and it is the number that tells you whether you
 * are a customer of this desk or a concentration on it.
 */
function recountYours(s: GameState) {
  const by: Record<string, number> = {};
  for (const h of Object.values(s.holdings)) {
    if (!h.loan) continue;
    const lender = PRODUCTS.find((p) => p.id === h.loan!.product)?.lender;
    if (lender) by[lender] = (by[lender] ?? 0) + h.loan.balance;
  }
  // Construction paper has never carried a product id, but somebody writes it,
  // and in every city this size it is the regional bank — which is precisely
  // why regionals are the ones that die in a development bust.
  for (const d of Object.values(s.developments ?? {})) {
    by[CONSTRUCTION_LENDER] = (by[CONSTRUCTION_LENDER] ?? 0) + d.loanBalance;
  }
  for (const l of s.lenders ?? []) l.yours = Math.round(by[l.name] ?? 0);
}

/**
 * YOUR DEFAULT IS THEIR LOSS.
 *
 * Handing back a building is not a private event — it lands on a specific
 * desk, eats a specific pot of capital, and that desk remembers. A big enough
 * hole moves their delinquency, their appetite and, if you are large enough
 * relative to them, whether they are still in business.
 */
export function chargeLenderLoss(s: GameState, lender: string, loss: number) {
  const l = lenderByName(s, lender);
  if (!l || loss <= 0) return;
  l.capital = Math.round(l.capital - loss);
  l.chargeOffsYr += loss;
  l.chargeOffsTotal += loss;
  l.yours = Math.max(0, l.yours - loss);
  l.delinquent = Math.min(0.4, l.delinquent + loss / Math.max(1, l.book) * 0.6);
}
