// THE TAX DESK — property-tax appeals, and the primitives January runs on.
//
// PROPERTY-TAX APPEALS.
//
// The assessor chases rising values quickly and falling ones slowly. That is
// realistic only if the other half exists: an owner can pay for an appraisal,
// file a challenge, wait for the board, and sometimes force the roll back to
// market. Without this file a downturn's tax bill was deliberately sticky and
// the player had no counterplay to the mechanism the comments described.
//
// INCOME TAX. The blended rate, the basis allocation and the loss carryforward
// live at the bottom of this file, so the January block in sim.ts, the Books
// page and anything that quotes a shelter are all reading one set of numbers
// rather than three copies of them.
import type { ParcelRecord, ParcelTable } from "@/data/types";
import type { Econ, GameState } from "./types";
import { cloneState, logBooks } from "./types";
import { rng } from "./market";
import { landValue, ownedHoldingValue, TAX_RATE } from "./value";
import { recordPropertyEvent } from "./history";

const COOLDOWN_M = 36;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const money = (n: number) =>
  Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : `$${Math.round(n / 1000)}K`;

export function taxAppealQuote(s: GameState, parcels: ParcelTable, bbl: string): {
  assessed: number;
  target: number;
  annualSavings: number;
  fee: number;
  months: number;
  odds: number;
} | null {
  const h = s.holdings[bbl];
  if (!h || h.groundLeased || h.taxAppeal) return null;
  if ((h.lastTaxAppealM ?? -Infinity) + COOLDOWN_M > s.month) return null;
  const assessed = Math.round(h.assessed ?? h.costBasis);
  const target = Math.round(ownedHoldingValue(s, parcels, h));
  if (!(target > 0) || assessed <= target * 1.05) return null;
  const over = assessed / target - 1;
  const annualSavings = Math.round((assessed - target) * TAX_RATE);
  // Tax counsel commonly works for roughly a quarter to two fifths of first-
  // year savings. Use 35%, with a minimum that pays for the appraisal and
  // filing even on a small building.
  const fee = Math.round(Math.max(7_500, annualSavings * 0.35));
  const months = Math.round(8 + Math.min(10, over * 20));
  const odds = clamp(0.25 + over * 1.8, 0.15, 0.90);
  return { assessed, target, annualSavings, fee, months, odds };
}

export function fileTaxAppeal(
  s: GameState, parcels: ParcelTable, bbl: string,
): { s: GameState; err?: string; msg?: string } {
  const h = s.holdings[bbl];
  if (!h) return { s, err: "You do not own that property." };
  if (h.taxAppeal) return { s, err: "That assessment is already under appeal." };
  const q = taxAppealQuote(s, parcels, bbl);
  if (!q) return { s, err: "The assessment is not materially above today's market evidence, or the last appeal is too recent." };
  if (s.cash < q.fee) return { s, err: `The appraisal and tax counsel require ${money(q.fee)} up front.` };
  const next = cloneState(s);
  const nh = next.holdings[bbl];
  next.cash -= q.fee;
  logBooks(next, "taxes", q.fee);
  nh.taxAppeal = {
    filedM: next.month,
    decideM: next.month + q.months,
    assessedAtFile: q.assessed,
    target: q.target,
    fee: q.fee,
    odds: q.odds,
  };
  next.news.unshift({
    q: next.month, kind: "info", bbl,
    text: `Tax appeal filed: ${money(q.assessed)} assessment against ${money(q.target)} of market evidence. `
      + `${money(q.fee)} spent; the board sits in ${q.months} months.`,
  });
  return { s: next, msg: "Assessment appealed." };
}

/** Monthly board decisions. Mutates the monthly tick's cloned state. */
export function tickTaxAppeals(s: GameState, parcels: ParcelTable): void {
  for (const h of Object.values(s.holdings)) {
    const app = h.taxAppeal;
    if (!app || s.month < app.decideM) continue;
    delete h.taxAppeal;
    h.lastTaxAppealM = s.month;
    if (h.groundLeased) continue; // the lessee carries the bill now
    const won = rng(s, "owners") < app.odds;
    if (won) {
      const currentEvidence = Math.round(ownedHoldingValue(s, parcels, h));
      const target = Math.min(app.target, currentEvidence || app.target);
      const before = Math.round(h.assessed ?? app.assessedAtFile);
      h.assessed = Math.min(before, target);
      const annual = Math.max(0, Math.round((before - h.assessed) * TAX_RATE));
      s.news.unshift({
        q: s.month, kind: "deal", bbl: h.bbl,
        text: `Tax appeal won: ${money(before)} assessment reduced to ${money(h.assessed)}. `
          + `About ${money(annual)} a year comes off the property-tax bill.`,
      });
      recordPropertyEvent(s, h.bbl, {
        kind: "planning",
        amount: h.assessed,
        outcome: `Tax appeal won; assessment reduced from ${money(before)} to ${money(h.assessed)}`,
      });
    } else {
      s.news.unshift({
        q: s.month, kind: "warn", bbl: h.bbl,
        text: `Tax appeal denied. The ${money(h.assessed ?? app.assessedAtFile)} assessment stands and the filing cost is spent.`,
      });
      recordPropertyEvent(s, h.bbl, {
        kind: "planning",
        amount: h.assessed ?? app.assessedAtFile,
        outcome: "Tax appeal denied; assessment stands",
      });
    }
  }
}

// ─────────────────────────── INCOME TAX ───────────────────────────

/**
 * THE RATE THE SPONSOR PAYS, BLENDED — not a corporate rate.
 *
 * Commercial real estate is overwhelmingly held in pass-throughs, LLCs and
 * LPs, so there is no entity-level tax sitting between the building and the
 * owner and nothing here can be restructured away by changing the wrapper.
 * The income lands on the sponsor's personal return: ordinary brackets, less
 * the §199A deduction where the activity qualifies, plus state income tax and
 * the 3.8% net investment income tax on the passive share. 25% is what that
 * stack blends to for a sponsor at this scale.
 *
 * Deliberately ONE number. A full bracket model would add arithmetic without
 * adding a decision, because nothing the player can do moves a bracket — the
 * choices that actually change the bill are the ones already modelled: when to
 * sell, whether to exchange, and how much depreciation the basis allocation
 * lets you take.
 */
export const INCOME_TAX_RATE = 0.25;

/**
 * §172(a), as amended by the TCJA: a post-2017 net operating loss carries
 * forward INDEFINITELY — there is no expiry to model — but it can only offset
 * 80% of the taxable income of the year it is used in. That cap is the one
 * real limit and it is worth having, because it is why a developer sitting on
 * a decade of paper losses still writes a cheque in a good year.
 */
export const NOL_SHELTER_CAP = 0.80;

/**
 * HOW MUCH OF THE DIRT IS IN THE PRICE — the band, not the number.
 *
 * Anchors the city is measured against (`pnpm exec node test/landshare.mjs`):
 * land is roughly 10-20% of improved value on cheap fringe industrial ground,
 * 30-50% across US metros, and 60-80% on a prime CBD corner. The floor exists
 * because there is always dirt under a building; the ceiling because a price
 * at or below the land value is a teardown, where the improvement basis is
 * nominal rather than nothing. Measured on this city, the median deed sits at
 * a land share near 0.25-0.35 — inside the band, so the clamp is a guard on
 * the tail and not the number doing the work.
 */
export const LAND_SHARE_MIN = 0.10;
export const LAND_SHARE_MAX = 0.80;

/**
 * THE DEPRECIABLE HALF OF WHAT YOU PAID — allocated, not asserted.
 *
 * This used to be `costBasis * 0.8` on every deed in the city: a flat 80/20
 * standing in for an allocation the engine already has the parts to make. It
 * matters twice — the annual shelter and the §1250 recapture bill on the way
 * out both scale with it — so a constant here is wrong in both directions at
 * once, over-sheltering a downtown tower whose land is half the price and
 * under-sheltering a suburban shed whose land is a fifth.
 *
 * The mechanism is the one practice uses: the ASSESSMENT-RATIO METHOD. Split
 * the price you paid in the same proportion the roll splits today's value, and
 * depreciate the improvement half. The engine prices dirt per parcel already
 * (`landValue`, the residual-versus-holder read), and the denominator is the
 * same `ownedHoldingValue` mark the assessor, the lender and the header use —
 * so the split cannot disagree with the value it came from.
 *
 * The one thing this does not do that the code does: an allocation is fixed at
 * acquisition and stays fixed, and this re-reads the ratio each January
 * because a holding carries no acquisition-time land mark. The drift that
 * causes is bounded by the band and by the remaining-basis cap; what it buys
 * is that a development (cost capitalised entirely to improvements) and a
 * §1014 step-up (basis reset to market) both flow through correctly with no
 * stale figure left behind.
 */
export function depreciableBasis(
  rec: ParcelRecord, econ: Econ, costBasis: number, marketValue: number,
): number {
  if (rec.class === "land" || !(costBasis > 0)) return 0;
  const total = marketValue > 0 ? marketValue : costBasis;
  const land = landValue(rec, econ);
  if (!(land > 0) || !(total > 0)) return costBasis * (1 - LAND_SHARE_MIN);
  return costBasis * (1 - clamp(land / total, LAND_SHARE_MIN, LAND_SHARE_MAX));
}

/** Straight-line life. Residential rental runs 27.5 years, everything else 39. */
export function deprLifeYrs(cls: string): number {
  return cls === "multifamily" ? 27.5 : 39;
}

export interface TaxYear {
  /** Portfolio taxable income before any carried loss is applied. */
  taxable: number;
  /** Carried loss consumed against this year's income. */
  sheltered: number;
  /** Loss still banked after the year closes. */
  carry: number;
  /** Income the carry could not reach — the 80% cap, or no bank to draw on. */
  taxed: number;
  tax: number;
}

/**
 * THE LOSS CARRIES — one function, so the news line, the Books page and the
 * cheque cannot disagree about what was sheltered.
 *
 * January used to compute `max(0, taxable) * 0.25` and drop the negative on
 * the floor. That inverts the defining fact of the business: depreciation
 * exists to throw a paper loss against a property that pays cash, and the
 * whole value of the loss is that it does not expire with the year. A
 * development year, a lease-up year or a soft year banks the shelter and the
 * income that follows arrives already covered. Thrown away, a sheltered year
 * was silently a wasted one and the next bill came at full freight.
 */
export function settleIncomeTax(taxable: number, carryIn: number): TaxYear {
  const bank = Math.max(0, carryIn);
  if (!(taxable > 0)) {
    // A loss year banks the whole loss. Nothing is due and nothing is spent.
    return { taxable, sheltered: 0, carry: Math.round(bank - Math.min(0, taxable)), taxed: 0, tax: 0 };
  }
  const sheltered = Math.min(bank, taxable * NOL_SHELTER_CAP);
  const taxed = taxable - sheltered;
  return {
    taxable,
    sheltered: Math.round(sheltered),
    carry: Math.round(bank - sheltered),
    taxed: Math.round(taxed),
    tax: Math.round(taxed * INCOME_TAX_RATE),
  };
}
