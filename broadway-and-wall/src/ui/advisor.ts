// THE DESK SPEAKS. One line of grounded read under the numbers on a decision
// card, computed from the same engine helpers the buttons run — never a
// second opinion about a figure already on the card, never an instruction.
// Every function here returns null when there is nothing worth saying,
// because a desk that talks on every card is a desk nobody listens to.
import type { AuctionLot, GameState, Holding, LOI, Workout } from "@/engine/types";
import type { ParcelTable } from "@/data/types";
import { bumpOf, netEffectivePsf } from "@/engine/leasing";
import { ownedHoldingValue } from "@/engine/value";
import { saleProceedsToSeller } from "@/engine/actions";
import { fundableNow, locAvailable } from "@/engine/credit";
import { loiMarketPsf, openingNe } from "@/ui/panels/LoiNegotiate";
import { usd } from "@/ui/format";
import "./advisor.css";

/**
 * Who signs the line under a letter: the leasing hire covering that building
 * if one is assigned, otherwise the house. Read-only — assignment itself is
 * done on the payroll page.
 */
export function leasingDeskName(game: GameState, bbl: string): string {
  const st = (game.staff ?? []).find(
    (x) => x.role === "leasing" && x.assignedBbls?.includes(bbl),
  );
  return st ? `${st.name}, leasing` : "Your leasing desk";
}

/**
 * The leasing desk's read on a letter: where the paper on the table sits
 * against market net effective — the number the tenant is actually judged on,
 * from the same helpers the terms grid quotes. Credit gets a mention only
 * when it is the story: a weak covenant on long paper.
 */
export function loiRead(game: GameState, parcels: ParcelTable, loi: LOI): string | null {
  const market = loiMarketPsf(game, parcels, loi);
  if (!(market > 0)) return null;
  const ne = netEffectivePsf(loi, loi.rentPsf, loi.tiPsf, loi.freeM, bumpOf(loi));
  const pct = (ne / market - 1) * 100;
  const years = Math.round(loi.termM / 12);
  // Seven-plus years from a C covenant: the term is only as good as they are.
  const weakLong = loi.credit === 0 && loi.termM >= 84;

  if (pct >= 5) {
    // The spread above market is what the fit-out is buying back — say how
    // many months of it repay the cheque, in the same dollars the cheque is.
    const spreadMo = ((ne - market) * loi.sf) / 12;
    const payback = loi.tiPsf > 0 && spreadMo > 0
      ? Math.ceil((loi.tiPsf * loi.sf) / spreadMo)
      : 0;
    if (payback > 0 && payback <= loi.termM) {
      return `This paper runs ${pct.toFixed(0)}% over market net effective — the fit-out earns itself back in ${payback} months of that spread${weakLong ? `, if a C covenant lasts ${years} years to pay it` : ""}.`;
    }
    return weakLong
      ? `${pct.toFixed(0)}% over market net effective, and every point of it rests on a C covenant surviving ${years} years of term.`
      : `This paper runs ${pct.toFixed(0)}% over market net effective, and the spread compounds for ${years} years.`;
  }
  if (pct <= -5) {
    const opened = openingNe(loi);
    return ne - opened > 0.05
      ? `Even after the counter this sits ${Math.abs(pct).toFixed(0)}% under market net effective — they opened at $${opened.toFixed(2)} and the gap is still theirs.`
      : `Their letter is ${Math.abs(pct).toFixed(0)}% under market net effective — the concessions are coming out of your side of the table.`;
  }
  if (weakLong) {
    return `The rent is market; the question is the covenant — ${years} years of term from a C credit is paper you collect only while they last.`;
  }
  return null;
}

/**
 * The workout desk's read: the cure against the liquidity that can pay it,
 * and whether the coupon is fundable month to month — the same figures the
 * notice card quotes, from the same helpers. One sentence naming the real
 * choice; the buttons below it are the answer.
 */
export function workoutRead(
  game: GameState, parcels: ParcelTable, w: Workout, h: Holding,
): string | null {
  if (!h.loan) return null;
  const filed = w.stage === "foreclosure";
  // Same liquidity the card's own row quotes: cash, plus the line — unless
  // the breach IS the covenant, because a revolver does not cure itself.
  const allowLoc = w.cause !== "covenant";
  const liquidity = Math.max(0, Math.floor(game.cash)) + (allowLoc ? locAvailable(game, parcels) : 0);
  const canCure = liquidity >= w.cure;
  const couponOk = !filed && fundableNow(game, parcels) >= h.loan.monthlyPmt;

  if (filed) {
    return canCure
      ? `Past the filing a payment is not a cure — it takes the full ${usd(w.cure)}, and the liquidity is there if the building is worth the fight.`
      : `Past the filing it takes the full ${usd(w.cure)}, and ${usd(liquidity)} of liquidity does not reach it — what is left of this file is the sale calendar.`;
  }
  if (canCure && couponOk) {
    return `Curing costs ${usd(w.cure)} of liquidity you have, and the building covers its coupon — time is the asset here.`;
  }
  if (canCure) {
    return `The ${usd(w.cure)} cure is fundable, but the coupon is not — that cheque buys back a building that cannot carry itself.`;
  }
  if (couponOk) {
    return `The cure is ${usd(w.cure)} against ${usd(liquidity)} of liquidity, but the coupon holds month to month — this window is a selling window, not a cheque-writing one.`;
  }
  return `The cure is ${usd(w.cure)}, the liquidity is ${usd(liquidity)}, and the coupon is not fundable — every month left on this file is a month of the sale.`;
}

/**
 * The broker's read on an offer for one of your buildings: the price against
 * the same mark net worth carries it at, the multiple of your basis, and
 * whether a 1031 clock comes with the cheque — tax from the same waterfall
 * the Accept button runs.
 */
export function saleOfferRead(
  game: GameState, parcels: ParcelTable, h: Holding, offer: { price: number },
): string | null {
  const mark = ownedHoldingValue(game, parcels, h);
  if (mark <= 0 || offer.price <= 0) return null;
  const rel = (offer.price / mark - 1) * 100;
  const mult = h.costBasis > 0 ? offer.price / h.costBasis : 0;
  const p = saleProceedsToSeller(game, parcels, h, offer.price);
  const vsMark = Math.abs(rel) < 1
    ? "Right on the mark"
    : `${Math.abs(rel).toFixed(0)}% ${rel > 0 ? "over" : "under"} the mark`;
  const basisBit = mult > 0 ? `, ${mult.toFixed(1)}x your basis` : "";
  const clockBit = p.tax > 0 && !game.exchange
    ? "; the 1031 clock would start at closing"
    : "";
  return `${vsMark}${basisBit}${clockBit}.`;
}

/**
 * The broker's read on a docket lot: the daylight between the referee's floor
 * and the flyer's own estimate — the only spread a bidder gets before the
 * room opens its mouth. Your own foreclosure gets silence; you do not bid it.
 */
export function auctionRead(game: GameState, lot: AuctionLot): string | null {
  void game;
  if (lot.kind === "yours") return null;
  if (lot.kind === "note") {
    // Your debt already bids here — the read is what the flyer says the
    // collateral recovers against what the note is owed.
    if (lot.debt <= 0 || lot.est <= 0) return null;
    const rel = (lot.est / lot.debt - 1) * 100;
    if (rel <= -10) {
      return `The flyer's ${usd(lot.est)} sits ${Math.abs(rel).toFixed(0)}% under the ${usd(lot.debt)} you are owed — if nobody outbids the paper, the recovery is the building.`;
    }
    if (rel >= 10) {
      return `The flyer reads ${usd(lot.est)} against the ${usd(lot.debt)} you are owed — a full-price room pays the note off with change above it.`;
    }
    return null;
  }
  if (lot.upset <= 0 || lot.est <= 0) return null;
  const spread = (lot.est / lot.upset - 1) * 100;
  if (spread >= 15) {
    return `The flyer guesses ${usd(lot.est)} against a ${usd(lot.upset)} floor — ${spread.toFixed(0)}% of daylight if the room stays quiet.`;
  }
  if (spread <= -5) {
    return `The floor sits ${Math.abs(spread).toFixed(0)}% above the flyer's own estimate — the debt is doing the bidding on this one.`;
  }
  // A thin spread is not a story.
  return null;
}
