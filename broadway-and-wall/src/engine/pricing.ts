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
// This is the one law, lifted out of `quote` unchanged so the mortgage sheet
// does not move. Every desk now feeds it the same four facts — its benchmark,
// its spread, the credit window, its own appetite — and its own personality
// through the spread it brings, not through a private formula. Imports nothing.

export interface PriceTerms {
  /** The credit window, econ.creditIdx (1 = an ordinary year). */
  ci: number;
  /** This desk's appetite, 0–1.15 (lenders.ts). */
  app: number;
  /**
   * How much of the window this desk passes on, 1 = all of it. The hometown
   * bank cuts a friend slack in a crunch (0.5); every other desk is 1.
   */
  ease?: number;
  /** The borrower's market-wide record, in points (sponsorStanding.spreadAdd). */
  standingAdd?: number;
  /** The file at this desk, in points off (relDiscount). */
  rel?: number;
  /** Anything else on this deal, in points — the life company's quarter for a standard building, less a strong guarantor's tenth. */
  dealAdd?: number;
}

/**
 * benchmark + spread, widened by the window, plus the window itself, plus what
 * a desk short of capital charges everybody.
 *
 *   spread × (1 + 1.1 × tight)  spreads widen in proportion: a 4-point desk
 *                               moves four times what a 1-point desk does
 *   + 0.9 × tight               and the whole market reprices for risk
 *   + 0.8 × (1 − appetite)      a desk rationing its capital prices it
 *
 * `tight` is 1 − creditIdx, floored at zero. These are the coefficients the
 * mortgage desks have carried since the credit window existed (see `quote`);
 * they are calibrated to the 2007-09 widening of CRE spreads — senior from
 * ~150 to ~350-400bp, mezz from ~600 to ~1,200bp — which is what proportional
 * widening of a desk's own spread reproduces.
 */
export function deskRatePct(bench: number, spread: number, t: PriceTerms): number {
  const tight = Math.max(0, 1 - t.ci);
  const e = t.ease ?? 1;
  return +(bench + spread * (1 + 1.1 * tight * e) + 0.9 * tight * e
    + Math.max(0, 1 - t.app) * 0.8
    + (t.standingAdd ?? 0) - (t.rel ?? 0) + (t.dealAdd ?? 0)).toFixed(2);
}

/** The advance a desk writes against its own sheet, as a multiplier: its balance sheet, not the window. */
export function appetiteAdvance(app: number): number {
  return Math.min(1.02, 0.55 + 0.45 * app);
}

// ---------------------------------------------------------------------------
// A DESK PRICES OFF ITS OWN COSTS (2026-10-28, ONE_ECONOMY_PLAN.md step 5).
//
// `deskRatePct` above is one law for every desk: the sheet, widened by the
// town's credit window, plus a charge for the desk's thin appetite. Two banks
// with the same sheet quoted the same coupon whatever their funding cost,
// whatever their own borrowers were doing, and neither looked at the other.
// That is a table, not a market. (It stays for private credit, which is not a
// desk in s.lenders and prices off the banks' window.)
//
// A lending desk prices a loan the way a credit committee writes it up:
//
//   what the money costs this desk        funding
//   + what this kind of loan loses        expected loss, off its own book
//   + the equity it ties up × its hurdle  capital
//   + what it costs to run                operating cost
//   + what the desk can get               margin — the competitive part
//
// The sheet (debt.ts PRODUCTS) is the price a desk writes its rate card at in
// an ordinary year — what the surveys say each kind of paper costs (ACLI,
// MBA). What moves, moves off it as a DIFFERENCE from that ordinary year,
// computed from the desk's own books every month in lenders.ts
// (`deskPricing`) and published on econ.deskPx, so the pro forma — which may
// not import the banks — prices construction off the numbers the quote desk
// uses:
//
//   dFund   this desk's money against what its own funding mix costs when
//           nothing is wrong: paying up for deposits, leaning on borrowed
//           money, a panic surcharge after a failure nearby;
//   dEl     its loss experience on this kind of loan against the long-run
//           industry rate — a desk that has just written off a year of land
//           loans prices land dear, and one that has not does not;
//   pull    what a desk short of capital, margin or deposits charges
//           everybody: 0.8 × (1 − appetite), the coefficient the sheets have
//           carried for it since the credit window existed;
//   chase   the competitive part: behind its usual share of the town's new
//           lending a desk sharpens toward what its rivals quote; winning too
//           much it widens to slow down (lenders.ts).
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
 * THE SPREAD THIS DESK QUOTES TODAY on paper whose sheet spread is `sheet`.
 * `ease` scales the rationing charge only — the hometown bank cutting a
 * friend slack in a crunch. With no published pricing (a save from before
 * this, the opening month) the sheet stands.
 */
export function liveSpread(px: DeskPx | undefined, sheet: number, cls: LossClass, ease = 1, bench: "long" | "short" = "long"): number {
  if (!px) return sheet;
  const raw = sheet + px.dFund + (px.dEl[cls] ?? 0) + px.pull * ease + px.chase;
  return Math.max(costFloor(px, cls, bench), raw);
}

/**
 * Below this a desk loses money on the loan before its own equity is paid
 * anything: its funding measured against the benchmark the loan is priced
 * off (a bank lending fixed off the ten-year on short deposits earns the
 * curve, and its floor says so), its expected loss and its running cost.
 */
export function costFloor(px: DeskPx, cls: LossClass, bench: "long" | "short" = "long"): number {
  const f = bench === "short" ? (px.fundShort ?? px.fund) : (px.fundLong ?? px.fund);
  return f + (px.el[cls] ?? 0) + px.opex;
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
