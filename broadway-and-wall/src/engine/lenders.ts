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
}

/**
 * Who each desk is, structurally. The kind decides how they are funded and
 * therefore how they behave when it goes wrong: a bank funded by deposits
 * takes losses slowly and survives; a conduit funded by selling paper into a
 * market stops existing the day that market closes.
 */
const KIND: Record<string, { kind: LenderKind; capitalRatio: number; brittle: number; blurb: string }> = {
  "First Harbor Bank": {
    kind: "bank", capitalRatio: 0.11, brittle: 0.5,
    blurb: "Deposits fund the book, so the losses have to be very bad before the lights go out. Small, local, and they remember who paid them in the bad years.",
  },
  "Alden Savings & Trust": {
    kind: "bank", capitalRatio: 0.095, brittle: 0.8,
    blurb: "A regional with a regional's problem: big enough to have made every mistake in the cycle, small enough that three of them matter.",
  },
  "Pelican Life Insurance": {
    kind: "life", capitalRatio: 0.18, brittle: 0.25,
    blurb: "Insurance float against long paper. The most patient money in the city and the most conservative — they are never the reason a crunch happens and never the ones who end it.",
  },
  "Meridian Street Capital": {
    kind: "conduit", capitalRatio: 0.04, brittle: 2.4,
    blurb: "They do not hold the loan; they sell it. Which is fine until nobody is buying, and then this desk is not tightening — it is closed.",
  },
  "Cordage Debt Partners": {
    kind: "fund", capitalRatio: 0.22, brittle: 1.1,
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
    const k = KIND[l.name] ?? { capitalRatio: 0.1, brittle: 1 };
    const spread = 1.9;

    // --- the book earns ------------------------------------------------------
    const performing = l.book * (1 - l.delinquent);
    const interest = (performing * (e.indexRate + spread)) / 100 / 12;
    // what they pay for the money: deposits are cheap, a fund's capital is not
    const fundingRate = l.kind === "bank" ? Math.max(0, e.indexRate - 2.2)
      : l.kind === "life" ? Math.max(0, e.indexRate - 1.4)
      : l.kind === "conduit" ? e.indexRate + 0.3
      : e.indexRate + 1.1;
    const funding = (l.book * fundingRate) / 100 / 12;

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

    // The book grows when they are lending and shrinks when they are not.
    const target = k.capitalRatio;
    const cr = capitalRatio(l);
    // --- appetite ------------------------------------------------------------
    // Above target they lend freely; below it they ration; well below it they
    // stop. A conduit's "appetite" is really whether the bond market is open,
    // which is why it swings furthest.
    const raw = cr / Math.max(0.01, target);
    l.appetite = Math.max(0, Math.min(1.15,
      (raw - 0.55) / 0.6 * (l.kind === "conduit" ? Math.max(0.25, e.creditIdx ?? 1) : 1)));
    l.book = Math.max(20_000_000, Math.round(l.book * (1 + (l.appetite > 0.8 ? 0.0035 : l.appetite > 0.4 ? 0 : -0.006))));

    if (s.month % 12 === 0 && s.month > 0) { l.chargeOffsYr = 0; l.netIncomeYr = 0; }

    // --- and sometimes it ends ----------------------------------------------
    if (l.capital <= 0 && rng(s) < 0.35) {
      l.failedM = s.month;
      l.reopenM = Math.round(rrange(s, 12, 30));
      l.appetite = 0;
      s.news.unshift({
        q: s.month, kind: "warn",
        text: `${l.name} has failed. ${l.kind === "conduit" ? "The securitisation market took it with them" : "The regulators took the book"} — `
          + `every loan they had outstanding is with a receiver now, and one fewer desk is quoting in this town.`,
      });
    } else if (l.appetite < 0.15 && rng(s) < 0.04) {
      s.news.unshift({
        q: s.month, kind: "warn",
        text: `${l.name} has stopped quoting. ${(l.delinquent * 100).toFixed(1)}% of their book is not paying and their capital will not carry new loans.`,
      });
    }
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
