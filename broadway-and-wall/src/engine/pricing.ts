// THE PRICE OF MONEY, ONCE.
//
// Five places priced debt and each had its own law. The mortgage desks
// (`quote`) widened the spread with the credit window and charged for a desk's
// thin appetite; the construction desks did half of that; the mezzanine was
// index + 8 in a boom and index + 8 in a panic; the revolver was index + 4
// whatever its bank was doing; and private credit was a random draw from six
// to nine points over, unconnected to anything. So in a crunch the most
// expensive money in town got relatively CHEAPER, and a revolver at a bank in
// receivership priced like one at a bank looking for paper.
//
// It is one law now: every desk's spread is its own costs plus a competitive
// margin (below), whoever is borrowing and for what. Imports nothing.

/** The advance a desk writes against its own sheet, as a multiplier: its balance sheet, not the window. */
export function appetiteAdvance(app: number): number {
  return Math.min(1.02, 0.55 + 0.45 * app);
}

// ---------------------------------------------------------------------------
// A DESK PRICES OFF ITS OWN COSTS (2026-10-28, ONE_ECONOMY_PLAN.md step 5).
//
// A lending desk prices a loan the way a credit committee writes it up:
//
//   what the money costs this desk        funding
//   + what this kind of loan loses        expected loss, off its own book
//   + the equity it ties up × its hurdle  capital
//   + what it costs to run                operating cost
//   + what the desk can get               margin — the competitive part
//
// There is no rate card underneath (2026-11-11): the spread IS those five
// parts, computed from the desk's own books every month in lenders.ts
// (`deskPricing`, `priceDesks`) and published on econ.deskPx, so the pro
// forma — which may not import the banks — prices construction off the
// numbers the quote desk uses. The expected loss on a mortgage is worked out
// per loan, at its own advance, term and schedule (debt.ts loanEl); the
// competitive part is a margin over the desk's own cost, set by where its
// rivals price and the share of the town's lending it is winning:
//
//   fund    this desk's money against the market rate the loan is written
//           on: paying up for deposits, leaning on borrowed money, a panic
//           surcharge after a failure nearby (dFund is the same against its
//           own ordinary mix, kept for the cause ledger);
//   el      its expected loss — the loan's own, or its loss experience on
//           the class against the long-run industry rate;
//   cap     the equity the loan ties up × its hurdle over the money the
//           equity replaces;
//   pull    what a desk short of capital, margin or deposits charges
//           everybody: 0.8 × (1 − appetite);
//   chase   the competitive margin over its own cost (lenders.ts).
//
// The floor: no desk lends below what the money, the losses and the running
// cost come to — margin and the return on capital can go to zero, not below.
// And no coupon is written under 0.05%.

/** What a loan is, for its expected loss and the capital held against it. */
export type LossClass = "income" | "construction" | "land" | "junior";

/** One desk's live pricing, in points a year (lenders.ts deskPricing). */
export interface DeskPx {
  /** Funding over the market rate the desk's own money prices off (short for banks and funds, long for insurers and the conduit). */
  fund: number;
  /** The same funding over the ten-year and over the short index — what a fixed or a floating loan is priced against. */
  fundLong?: number;
  fundShort?: number;
  /** Funding against this desk's ordinary mix — what passes into the quote. */
  dFund: number;
  /** Expected annual loss by class (two-thirds own experience, a third the industry's long-run rate). */
  el: Partial<Record<LossClass, number>>;
  /** Expected loss against the long-run rate — what passes into the quote. */
  dEl: Partial<Record<LossClass, number>>;
  /** What its capital needs, by class: target ratio × risk weight × pre-tax hurdle. */
  cap: Partial<Record<LossClass, number>>;
  /** Running cost, % of book a year. */
  opex: number;
  /** 0.8 × (1 − appetite): the price of a desk rationing its balance sheet. */
  pull: number;
  /** The competitive adjustment — negative is sharper. */
  chase: number;
}

/**
 * THE SPREAD THIS DESK QUOTES TODAY, built from its own costs — no rate card
 * underneath (2026-11-11, REAL_ECONOMY_PLAN "Banks, the rest of the sheet").
 *
 *   funding      its money against the market (px.fund)
 *   + loss       the expected loss on THIS loan, a year (`el`, worked out by
 *                the caller off the loan's own leverage and term — debt.ts
 *                loanEl — or the desk's loss experience on the class)
 *   + opex       its running cost
 *   + capital    the equity the loan ties up × the return its owners want
 *   + pull       rationing, when it is short of capital (× `ease`)
 *   + chase      the competitive margin: what its rivals' prices let it
 *                charge over its own cost, or what it gives up to win share
 *
 * FUNDING IS MATCHED TO THE LOAN (funds-transfer pricing): a desk prices a
 * fixed loan off the term rate and a floater off the short rate, and charges
 * its own funding spread against whichever the loan is written on — a bank
 * swaps or term-funds the fixed book rather than betting its margin on the
 * curve (OCC Comptroller's Handbook, "Interest Rate Risk", 2020: matched-
 * maturity FTP as the standard method) [S]. So one funding spread serves
 * both benchmarks.
 */
export function liveSpread(px: DeskPx, cls: LossClass, ease = 1, el?: number): number {
  const loss = el ?? px.el[cls] ?? 0;
  const raw = px.fund + loss + px.opex + (px.cap[cls] ?? 0) + px.pull * ease + px.chase;
  return Math.max(costFloor(px, cls, el), raw);
}

/**
 * Below this a desk loses money on the loan before its own equity is paid
 * anything: its funding, the loan's expected loss and its running cost.
 */
export function costFloor(px: DeskPx, cls: LossClass, el?: number): number {
  return px.fund + (el ?? px.el[cls] ?? 0) + px.opex;
}

/** What a desk's flagship paper costs it before any margin: funding, loss, running cost, capital. */
export function economicCost(px: DeskPx, cls: LossClass, el?: number): number {
  return costFloor(px, cls, el) + (px.cap[cls] ?? 0);
}

/** The coupon: benchmark + the desk's live spread + the borrower's own file. Never under 0.05%. */
export function bankRatePct(bench: number, spread: number, t: { standingAdd?: number; rel?: number; dealAdd?: number } = {}): number {
  return +Math.max(0.05, bench + spread + (t.standingAdd ?? 0) - (t.rel ?? 0) + (t.dealAdd ?? 0)).toFixed(2);
}

/** Which loss class a sheet is. Land sheets lend on dirt; the fund's bridge and mezz are transitional paper. */
export function lossClassOf(p: { id: string; mezz?: boolean; bridge?: boolean }): LossClass {
  if (p.id === "land" || p.id === "tideLand") return "land";
  if (p.mezz || p.bridge || p.id === "cordage" || p.id === "private") return "junior";
  return "income";
}
