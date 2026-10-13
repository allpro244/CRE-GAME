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
