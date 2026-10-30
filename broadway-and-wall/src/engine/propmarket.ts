// THE PROPERTY MARKET (ONE_ECONOMY_PLAN.md step 7).
//
// Owner: "cap rates come from what named bidders will actually pay ... a real
// simulated, transactional market"; "everyone is trying to buy the best deal
// they can and sell at the best price they can; that's where the market should
// be created."
//
// So there is no cap-rate equation left. What is here:
//
//   BUYERS. Every firm on the Players list underwrites a building itself: the
//   income in place and the income it settles at, the re-letting capital its
//   leases will eat, the capital plan its plant needs, a loan quoted by the
//   town's own desks for THIS building (lenders.ts / debt.ts — so a crunch is
//   a smaller loan at a wider spread), its own equity target from its strategy,
//   and its own read of where rent is going. That gives the most it would pay.
//   It bids under that by how much competition the broker says is in the room,
//   and never over what it can fund.
//
//   SELLERS. A named firm's reservation comes from its own situation: the loan
//   a sale has to clear, the tax a sale crystallises, what the building is
//   worth to it to keep, and whether it has to sell at all (a fund at the end
//   of its life, a book over its covenant, a firm in arrears).
//
//   DEALS. A price exists only when a bid clears a reservation.
//
//   READ-OUTS. Every closed building, and the best bid on every round that did
//   not close, goes on the cap tape as the cap rate it implies on the
//   appraiser's own income. A class's cap rate is the appraisers' index of
//   that tape — every print restated to a reference building through a
//   time-dummy hedonic grid, and weighed against what they already knew as it
//   arrives (Quan & Quigley 1991) — simply stale when nothing has traded; the
//   grid's location, condition and spec slopes are the appraiser's
//   per-building adjustments. Appraisals (value.ts
//   capRateFor), lenders' sizing and every mark in the game follow.
//
// What a crunch does to prices it does through the bidders: the desks cut the
// advance, widen the spread and tighten coverage, so each buyer's capital
// stack carries more of its own expensive equity, so it pays less. Nothing
// here says "spreads widen in a crunch".
import type { ParcelRecord, ParcelTable } from "@/data/types";
import type { ApprIndex, BuiltClass, CapPrint, CapRead, Condition, Econ, GameState, Listing, Rival, RivalStyle } from "./types";
import { CAP_PLAN_RATE } from "./types";
import { underwrittenGrowthPct, dollarLevel, RENT_BASE, CAP_BASE } from "./market";
import {
  assetValue, capRateFor, initialCondIdx, demandLinear, incomeValueAsIs, initialCondition, inPlace, landValue,
  marketAppraisal, noiYr, resolveRec, specWearMult, taxBorneShare, taxRate, useOccupancy, useRentableSf,
  useRentPsfYr, COND_DECAY, COND_WEAR_REF, overallScore, N_BANDS, landRead, DEV_MARGIN, queueFactor, residualScheme,
} from "./value";
import { uses } from "./mix";
import { catchUpCapex } from "./dev";
import { productOf } from "./products";
import { stabViewFor, streetRefiProceeds } from "./debt";
import { TI_ASK, renewalRefreshShare } from "./leasing";
import {
  livingRivals, paramsOf, fitOf, ownerOf, firmOutlook, deployPressure, contractedEquity, lineRoom,
  minTicket, boughtLastYear, gainsTax, streetSaleCost, spreadAdj, firmMaxPrice, firmMargin, landBanker,
} from "./rivals";
import { dealsPerYear, misreadPp } from "./competitorTraits";
import { rowOn, deskWithRoom } from "./rivalDebt";
import { why, whyGet, whyNation } from "./why";
import { beliefSignals, whyBelief, hearsOfListing } from "./beliefs";
import { money } from "./money";
import { START_YEAR } from "./types";

const K: BuiltClass[] = ["office", "retail", "multifamily", "industrial"];
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

// ---------------------------------------------------------------- the buyer's capital

/**
 * WHAT EACH KIND OF MONEY WANTS ON ITS EQUITY, in points over the loan index
 * (levered, nominal). Strategy target returns as the industry quotes them —
 * PREA Investor Survey and NCREIF fund-style targets across 2005-2023: core
 * ~7-9% levered with the ten-year at 2.5-4%, value-add 11-14%, opportunistic
 * 15-20%; listed REITs' implied cost of equity ~8-9% (Green Street); sovereign
 * and offshore pension money accepts the least (it is buying a dollar asset,
 * not a return target); an owner-user's is its own company's cost of equity;
 * family money is patient and lightly levered. Calibrated facts, one row per
 * strategy — not tuned against any cap rate in this engine.
 */
export const EQUITY_PREMIUM: Record<RivalStyle, number> = {
  foreign: 4.5, core: 5.5, family: 5.0, reit: 6.0, owneruser: 5.0,
  slumlord: 8.0, developer: 9.0, pe: 9.5, merchant: 10.0, opportunistic: 12.0, vulture: 14.0,
};
/**
 * RISK PREMIA RUN HIGH WHEN RISK-FREE YIELDS ARE LOW (Duarte & Rosa 2015): a
 * buyer does not take its equity target down point for point with the last
 * points of a falling rate. The index a buyer adds its premium to is the loan
 * index bent toward ~2% as it approaches zero: i + 2(e^(-i/2) - e^(-5.4/2)),
 * which is the index itself above ~5. A shape parameter carried over from the
 * record of real yields against the ten-year (1990-2021: a slope of 0.6-0.75
 * from 1990 to 2007, 0.0-0.4 after).
 */
const BEND = 2, BEND_REF = 5.4;
const bentIndex = (i: number) => i + BEND * (Math.exp(-i / BEND) - Math.exp(-BEND_REF / BEND));
/** Closing costs a buyer carries on top of the price: legal, title, diligence (closingFinance). */
export const BUY_CLOSING = 0.02;
/** Points on the acquisition loan (streetLoanCost charges about one). */
const LOAN_POINTS = 0.01;
/**
 * HOW FAST AN IN-PLACE INCOME GAP CLOSES: rent and vacancy gaps close about a
 * quarter a year (Wheaton & Torto; the same REVERT_PER_YR builders read in
 * rivals.ts). A lease-up buyer with harder leasing (CARE.lease) closes it
 * faster, which is the value-add trade.
 */
const GAP_CLOSE_YR = 0.25;
/**
 * RENT GROWTH MEAN-REVERTS: annual rent-growth autocorrelation runs 0.5-0.7 in
 * US office and industrial series, so a growth surprise decays at
 * -ln(0.6) a year, and a Gordon buyer capitalises g0 x y/(y + kappa) of it.
 */
const GROWTH_DECAY = -Math.log(0.6);
/**
 * FIRST-PRICE SHADING. A sealed bid lands under the bidder's own number by
 * less the more bidders the broker says are in the room: winning bids in
 * marketed US sales land within a few per cent of the cover bid, and a lone
 * bidder lowballs by about a tenth. A shape parameter, stated as such.
 */
const SHADE = 0.10;
/** A bid with nobody else in the room: a private approach to an owner who has not listed. */
export const loneBid = (max: number) => max * (1 - SHADE);

/**
 * RE-LETTING CAPITAL. A commercial lease costs an allowance and a commission
 * every time it rolls — below NOI, so a buyer reserves for it. Renewal odds
 * underwritten in the investor surveys (PwC Real Estate Investor Survey):
 * office ~60%, retail ~65%, industrial ~70%. A new letter: the market's
 * allowance (TI_ASK, per foot per year of term) and a 4.5% commission
 * (rolloverReserve); a renewal: a refresh of a five-year-old fit-out
 * (renewalRefreshShare) and the 2% renewal commission.
 */
const RENEW_P: Partial<Record<BuiltClass, number>> = { office: 0.60, retail: 0.65, industrial: 0.70 };
const LC_NEW = 0.045, LC_RENEW = 0.02;

/** One building on the table, the parts of the underwriting that do not depend on who is bidding. */
export interface DealView {
  rec: ParcelRecord; bbl: string; k: BuiltClass;
  cond: Condition; condIdx: number;
  /** in-place contract NOI before property tax, $/yr */
  noiPre: number;
  /** stabilised NOI before property tax, $/yr */
  stabPre: number;
  /** the owner-borne property tax, as a share of value a year */
  tau: number;
  /** re-letting capital, $/yr */
  leaseCap: number;
  /** the capital plan the plant needs, as a share of value a year */
  cx: number;
  /** deferred maintenance the buyer pays to bring the plant back to standard, $ once (dev.ts catchUpCapex) */
  catchUp: number;
  /** the street's loan: min(a x price, cap); the desk's rate, % */
  debtA: number; debtCap: number; rd: number;
  /** a special product's thinner buyer pool, points (products.ts capSpread) */
  prod: number;
  /** the dirt, for a buyer who builds */
  land: number;
  /** what buyers have seen of this building's submarket (tickLocBeliefs): a risk premium in points, and income growth against the class, a share a year */
  locPrem: number; locG: number;
}

/**
 * What the street's desks would lend against this building at a price, and at
 * what rate. A buyer takes the banks' permanent money (the regional and the
 * hometown bank) when they will write it, and the bridge desk's dearer
 * floating paper only for a building the banks will not size — a lease-up
 * whose in-place income covers nothing. Sizing on whichever desk wrote the
 * biggest cheque priced every stabilised building on hard money.
 */
const BANK_DESKS = ["savings", "harbor"], BRIDGE_DESKS = ["cordage"];
function streetLoan(s: GameState, rec: ParcelRecord, cond: Condition, condIdx: number, price: number, noi: number, desks: string[]) {
  const stab = stabViewFor(rec, s.econ, cond, price, condIdx);
  return streetRefiProceeds(s, price, noi, 0.95, stab, desks);
}

export function dealView(
  s: GameState, rec: ParcelRecord, bbl: string, pRef: number, cond?: Condition, condIdx?: number,
): DealView | null {
  if (rec.class === "land" || !(rec.bldgArea > 0) || !(pRef > 0)) return null;
  const e = s.econ;
  const li = s.listings?.find((l) => l.bbl === bbl);
  const c = li?.cond ?? cond ?? initialCondition(rec);
  // the building as it stands — the same reading the appraiser takes (marketAppraisal)
  const q = li?.condIdx ?? condIdx ?? s.holdings?.[bbl]?.condIdx ?? initialCondIdx(rec, s.month, c);
  const k = rec.class as BuiltClass;
  const tau = taxRate(e) * taxBorneShare(rec);
  const inP = inPlace(rec, s, bbl, pRef);
  const noiPre = inP.noi + tau * pRef;
  const stabPre = noiYr(rec, e, c, true, q);
  let leaseCap = 0;
  for (const u of uses(rec)) {
    const p = RENEW_P[u];
    if (p === undefined) continue;
    const sf = useRentableSf(rec, u);
    if (!(sf > 0)) continue;
    const rent = useRentPsfYr(rec, e, c, u, q);
    const [lo, hi] = TI_ASK[u] ?? TI_ASK.office;
    const ci = e.costIdx ?? 1;
    const base = RENT_BASE[u];
    const ti = rent > 0 ? (Math.min(lo * ci, (lo / base) * rent) + Math.min(hi * ci, (hi / base) * rent)) / 2 : ((lo + hi) / 2) * ci;
    const perSf = (1 - p) * (ti + LC_NEW * rent) + p * (renewalRefreshShare(5) * ti + LC_RENEW * rent);
    leaseCap += perSf * sf * useOccupancy(rec, e, u, true);
  }
  // The capital plan that holds the line (CAP_PLAN_RATE of value a year,
  // scaled by how fast this building wears — capPlanBillMo), which every
  // owner in this engine pays monthly. The buyer deducts it before it pays.
  const age = Math.max(0, START_YEAR + Math.floor((e.m ?? s.month) / 12) - (rec.yearBuilt || START_YEAR));
  const wear = (COND_DECAY[k] ?? 0.0024) * (1 + Math.min(0.5, age / 220)) * specWearMult(rec.buildSpec);
  const cx = CAP_PLAN_RATE * wear / COND_WEAR_REF;
  // ...and the plan holds a line, it does not restore one: a building that
  // has slipped below standard carries its deferred maintenance into the bid
  // (catchUpCapex — the programmes' own prices, the cheque the player writes).
  const catchUp = catchUpCapex(rec, q, e.costIdx ?? 1, e.m ?? s.month);
  // THE LOAN, from the desks, for this building. Sized twice to learn its
  // shape: on the advance it grows with the price, on coverage or debt yield
  // it does not.
  let desks = BANK_DESKS;
  let q1 = streetLoan(s, rec, c, q, pRef, inP.noi, desks);
  if (!(q1.principal > 0)) { desks = BRIDGE_DESKS; q1 = streetLoan(s, rec, c, q, pRef, inP.noi, desks); }
  let debtA = 0, debtCap = 0;
  if (q1.principal > 0) {
    debtA = q1.principal / pRef;
    const q2 = streetLoan(s, rec, c, q, pRef * 1.5, inP.noi - tau * pRef * 0.5, desks);
    debtCap = q2.principal >= q1.principal * 1.45 ? Infinity : Math.max(q1.principal, q2.principal);
  }
  const prod = rec.product ? (productOf(rec.product)?.capSpread ?? 0) : 0;
  const loc = locBelief(e, rec, k, q);
  return { rec, bbl, k, cond: c, condIdx: q, noiPre, stabPre, tau, leaseCap, cx, catchUp, debtA, debtCap, rd: q1.ratePct, prod, land: landValue(rec, e), locPrem: loc.prem, locG: loc.g };
}

/** One bidder's temperament, as the underwriting reads it. */
export interface Bidder {
  id: string; style: RivalStyle;
  /** -1 contrarian .. +1 extrapolator (firmOutlook) */
  lean: number;
  /** the committee's own error on this building this month, points of yield (Underwriting trait) */
  misPp: number;
  /** leasing effort, 1 = market (CARE.lease) */
  lease: number;
  /** the most of the price it will borrow (its own covenant) */
  ltvCap: number;
  /** its equity premium over the bent index, points, after dry powder and a contrarian's appetite */
  eqPrem: number;
  /** what its file does to its coupon, points (spreadAdj) */
  fileSpread: number;
  /** a builder can always tear down: the dirt is its floor */
  builds: boolean;
}

export function bidderOf(s: GameState, r: Rival, rec: ParcelRecord): Bidder {
  const st = paramsOf(r);
  const shut = Math.max(0, 1 - (s.econ.creditIdx ?? 1));
  // DRY POWDER BURNS A HOLE (deployPressure): a fund paid to deploy takes up
  // to a point and a half less. A CONTRARIAN takes less when the window has
  // shut — buying what nobody else can finance is its whole strategy.
  const eqPrem = (EQUITY_PREMIUM[r.style] ?? 8) - 0.75 * (deployPressure(s, r) - 1) - Math.max(0, st.contra) * shut * 2;
  const local = r.sheet && r.home === rec.district ? 1 - 0.8 * r.sheet.homeTurf / 100 : 1;
  return {
    id: r.id, style: r.style,
    lean: firmOutlook(r),
    misPp: r.sheet ? misreadPp(r.sheet, `${r.id}:${rec.bbl}:${s.month}`) * local : 0,
    lease: st.care?.lease ?? 1,
    ltvCap: Math.max(0, Math.min(r.targetLtv ?? st.maxLtv, st.maxLtv)),
    eqPrem,
    fileSpread: spreadAdj(r),
    builds: st.build > 0,
  };
}

export interface Underwriting {
  /** what the building is worth to this bidder, $ */
  V: number;
  /** its blended cost of capital, its equity target, its debt rate, the debt share, the growth it underwrites — all shares a year */
  r: number; rE: number; rd: number; w: number; g: number;
}

/**
 * WHAT THE BUILDING IS WORTH TO THIS BIDDER.
 *
 *   V (r - g + tau + cx) = stabilised NOI - re-letting capital      (Gordon, on the capital stack)
 *   r = w rd + (1 - w) rE,   w = loan / V,   loan = min(a V, cap)
 *
 * plus the in-place income's gap to stabilised, held for as long as such gaps
 * last (GAP_CLOSE_YR, discounted at r). `g` is the contractual bump and
 * expected inflation over it (underwrittenGrowthPct), plus the share of real
 * growth a yield can capitalise when growth mean-reverts (GROWTH_DECAY) — its
 * class's ten-year record as buyers watched it, tilted by the firm's own lean
 * — and no more growth than the rent at which a rival would build next door
 * allows (siteHurdle; DiPasquale & Wheaton ch. 10).
 */
export function valueTo(e: Econ, v: DealView, b: Bidder, rentSig?: ReturnType<typeof beliefSignals>): Underwriting {
  const i = e.indexRate ?? 5;
  const rE = (bentIndex(i) + b.eqPrem) / 100;
  const rd = v.debtA > 0 ? (v.rd + b.fileSpread) / 100 : rE;
  const a = Math.min(v.debtA, b.ltvCap);
  const gBase = underwrittenGrowthPct(e) / 100;
  // the class's record, and this submarket's own record against it (tickLocBeliefs)
  let belief = (e.growthExp?.[v.k] ?? 0) + v.locG;
  // ...and its own forecast, from what IT has seen (beliefs.ts): its broker's
  // comps, its own rolls and a survey two quarters old — not the town's true
  // rent history, which no buyer has.
  if (rentSig && b.lean !== 0) {
    const sig = rentSig[v.k];
    belief += b.lean > 0 ? b.lean * sig.g : -b.lean * (1 / (1 + sig.dev) - 1) * GAP_CLOSE_YR;
  }
  belief = clamp(belief, -0.06, 0.06);
  const y0 = Math.max(0.01, a * rd + (1 - a) * rE - gBase);
  let gr = (y0 / (y0 + GROWTH_DECAY)) * belief;
  const siteH = e.siteHurdle?.[v.k];
  if (gr > 0 && siteH !== undefined && siteH > 0) gr = Math.min(gr, y0 * (1 - Math.exp(-Math.max(0, -Math.log(siteH)))));
  const g = gBase + gr;
  const load = v.tau + v.cx + v.prod / 100 + v.locPrem / 100 - b.misPp / 100;
  const X = v.stabPre - v.leaseCap;
  // a guard on the denominator, not a price: a required yield under one per
  // cent would be a cost of capital this engine cannot produce
  const den = (x: number) => Math.max(0.01, x);
  let V = X / den(a * rd + (1 - a) * rE - g + load);
  let w = a;
  if (a > 0 && a * V > v.debtCap) {
    const D = v.debtCap;
    V = (X + D * (rE - rd)) / den(rE - g + load);
    w = V > 0 ? D / V : 0;
  }
  const r = w * rd + (1 - w) * rE;
  const kappa = GAP_CLOSE_YR * (v.noiPre < v.stabPre ? b.lease : 1);
  const dur = 1 / Math.max(0.05, 1 - (1 - kappa) / (1 + r));
  V += (v.noiPre - v.stabPre) * dur;
  V -= v.catchUp;
  if (b.builds) V = Math.max(V, v.land);
  return { V: Math.max(0, V), r, rE, rd, w, g };
}

/** The most this bidder pays: its value less the closing and the loan's points. */
export function maxPrice(e: Econ, v: DealView, b: Bidder, rentSig?: ReturnType<typeof beliefSignals>): { max: number; uw: Underwriting } {
  const uw = valueTo(e, v, b, rentSig);
  return { max: uw.V / (1 + BUY_CLOSING + LOAN_POINTS * uw.w), uw };
}

/**
 * WHAT A FIRM CAN FUND: the price at which the equity, the 2% closing and its
 * working reserve use up the account and the corporate line — the same tests
 * closingFinance puts it through at the table.
 */
export function affordable(s: GameState, r: Rival, v: DealView, b: Bidder): number {
  const reserve = Math.max(500_000 * dollarLevel(s.econ), Math.max(0, r.cash) * 0.05);
  const room = Math.max(0, lineRoom(s, r, r.aum ?? 0, r.markNoi ?? 0, r.markLand ?? 0));
  const avail = r.cash - contractedEquity(s, r) + room - reserve;
  if (!(avail > 0)) return 0;
  const a = Math.min(v.debtA, b.ltvCap);
  const p1 = avail / Math.max(0.05, 1 + BUY_CLOSING - a);
  return a * p1 <= v.debtCap ? p1 : (avail + v.debtCap) / (1 + BUY_CLOSING);
}

export interface Bid { r: Rival; max: number; bid: number; uw: Underwriting }

/**
 * A BID ROUND: every firm on the street that would and could buy this,
 * underwriting it on its own books. Sorted best first. `n` is how many were
 * in the room — the broker's read the bidders shade against.
 */
export function bidRound(s: GameState, parcels: ParcelTable, rec: ParcelRecord, li: Pick<Listing, "bbl" | "ask" | "distress"> & { listedM?: number }): { bids: Bid[]; n: number; view: DealView | null } {
  const view = dealView(s, rec, li.bbl, li.ask);
  if (!view) return { bids: [], n: 0, view };
  const seller = ownerOf(s, rec.bbl);
  const distress = !!li.distress;
  const room: Rival[] = [];
  for (const r of livingRivals(s)) {
    if (r === seller || r.stressMs || r.failedM !== undefined || r.homeBy !== undefined) continue;
    // THE LISTING BROKER CALLS ITS OWN BUYERS FIRST (beliefs.ts hearsOfListing).
    if (!hearsOfListing(s, r, li)) continue;
    const st = paramsOf(r);
    if (st.classes && !st.classes.includes(rec.class)) continue;
    if (r.sheet && boughtLastYear(r, s.month) >= dealsPerYear(r.sheet)) continue;
    if (li.ask < minTicket(r)) continue;
    if (distress && r.sheet && r.sheet.distress < 25) continue;
    if (r.sheet && fitOf(s, parcels, r, rec, distress) <= 0) continue;
    room.push(r);
  }
  const n = room.length;
  const bids: Bid[] = [];
  for (const r of room) {
    const b = bidderOf(s, r, rec);
    const { max, uw } = maxPrice(s.econ, view, b, beliefSignals(s, r));
    if (!(max > 0)) continue;
    let bid = Math.min(max * (1 - SHADE / Math.max(1, n)), affordable(s, r, view, b));
    bid = Math.round(bid / 1000) * 1000;
    if (!(bid > 0)) continue;
    // A firm already at its covenant, or with no desk that will take more of
    // its paper, does not get a term sheet and does not bid (rivalBuys).
    const debt = Math.min(view.debtA, b.ltvCap) * bid;
    const aumAfter = (r.aum ?? 0) + bid;
    const cushion = r.sheet ? 0.10 * r.sheet.discipline / 100 : 0;
    if (aumAfter > 0 && (r.debt + debt) / aumAfter > paramsOf(r).maxLtv - cushion) continue;
    if (debt > 0 && !deskWithRoom(s, r.id, debt)) continue;
    bids.push({ r, max, bid, uw });
  }
  bids.sort((x, y) => y.bid - x.bid);
  return { bids, n, view };
}

/**
 * WHAT A FORCED SALE WOULD FETCH TODAY: the best bid the street would put on
 * it as a distress listing (a building), or the best builder's residual (a
 * lot), never above the mark. Zero when nobody in town would bid — which in a
 * shut credit market is the answer. This replaced a fixed 78 cents on the
 * dollar (DURESS_MID) wherever a firm under pressure weighs a sale against
 * handing back the keys.
 */
export function forcedSalePrice(s: GameState, parcels: ParcelTable, rec: ParcelRecord, bbl: string, mark: number): number {
  if (!(mark > 0)) return 0;
  if (rec.class === "land" || !(rec.bldgArea > 0)) {
    const seller = ownerOf(s, bbl);
    let best = 0;
    for (const r of livingRivals(s)) if (r !== seller && !r.stressMs) best = Math.max(best, firmMaxPrice(s, r, rec));
    return Math.min(mark, best);
  }
  const round = bidRound(s, parcels, rec, { bbl, ask: mark, distress: true });
  return Math.min(mark, round.bids[0]?.bid ?? 0);
}

// ---------------------------------------------------------------- the seller

/** Why a named firm is selling — what sets how low it will go. */
export type SaleWhy = "duress" | "forced" | "voluntary";

/**
 * A NAMED SELLER'S TERMS, from its own situation.
 *
 *   duress     in arrears or over its covenant: it takes the best bid in the
 *              room (reserve 0) and lists at the appraisal.
 *   forced     a fund at the end of its life, a merchant exit, a book being
 *              cut back to its covenant: it must sell, but not for less than
 *              clears the loan on the building and the cost of selling.
 *   voluntary  it sells only at what the building is worth to it to keep, plus
 *              the gains tax a sale crystallises and the cost of selling —
 *              and lists that at its own patience (how far above it it chases).
 */
export function sellerTerms(
  s: GameState, r: Rival, rec: ParcelRecord, bbl: string, mark: number, why: SaleWhy, grade?: Condition,
): { reserve: number; ask: number; inUse: number } {
  const view = dealView(s, rec, bbl, Math.max(1, mark), grade);
  const inUse = view ? valueTo(s.econ, view, bidderOf(s, r, rec), beliefSignals(s, r)).V : mark;
  const payoff = rowOn(s, r, bbl)?.balance ?? 0;
  const sellCost = streetSaleCost(1_000_000, s) / 1_000_000;
  const clear = payoff / Math.max(0.5, 1 - sellCost);
  const round = (x: number) => Math.round(Math.max(0, x) / 1000) * 1000;
  if (why === "duress") return { reserve: 0, ask: round(Math.max(mark, clear)), inUse };
  if (why === "forced") return { reserve: round(clear), ask: round(Math.max(clear, mark)), inUse };
  const reserve = round(Math.max(clear, inUse + gainsTax(r, inUse) + streetSaleCost(inUse, s)));
  return { reserve, ask: round(reserve * Math.max(1, paramsOf(r).patience)), inUse };
}

/**
 * A HOLDER UNDER NO PRESSURE ASKS ITS ANCHOR: the higher of what the building
 * appraises at today and what it appraised at a year ago (today's value
 * restated at last year's cap read). Sellers who would book a loss against
 * their reference price list higher and sell slower — the loss aversion
 * Genesove & Mayer (2001, Boston condos) and Bokhari & Geltner (2011,
 * commercial) measure — so in a falling market the honest asks vanish and the
 * bid-ask gap opens on its own. In a rising one they ask today's number.
 * This replaced a random "denial" band (FORMULA_LEDGER #23).
 */
export function anchoredAsk(e: Econ, rec: ParcelRecord, value: number): number {
  if (rec.class === "land" || !(rec.bldgArea > 0)) return value;
  const k = rec.class as BuiltClass;
  const h = e.history ?? [];
  const then = h.length >= 13 ? h[h.length - 13]?.cap?.[k] : undefined;
  const now = e.capRate?.[k];
  return then && now && then > 0 ? value * Math.max(1, now / then) : value;
}

/** The least the seller of a listing takes: a named firm's own reservation, else the tape's 92% of ask (a lender's 88%). */
export function listingReserve(li: Listing): number {
  if (li.reserve !== undefined) return li.reserve;
  const lenderSale = !!li.distress && (li.reason === "receiver" || !!li.receiverFor || !!li.loanBasis);
  return li.ask * (lenderSale ? 0.88 : 0.92);
}

// ---------------------------------------------------------------- the tape

const TAPE_MONTHS = 36;
const TAPE_MAX = 600;
/** The reference building a class's cap is quoted for: mid location, standard condition, market spec. */
export const CAP_REF_X: [number, number, number] = [0.5, 0.6, 0.5];

function features(s: GameState, rec: ParcelRecord, cond: Condition, condIdx?: number): [number, number, number] {
  return [
    clamp(demandLinear(rec.demandScore) / 100, 0, 1),
    clamp(condIdx ?? initialCondIdx(rec, s.month, cond), 0, 1),
    clamp(rec.buildSpec ?? 0.5, 0, 1),
  ];
}

/**
 * THE CAP RATE A PRICE IMPLIES ON THE APPRAISER'S OWN INCOME. The appraiser
 * values the building at `mv` by capitalising its income at capRateFor plus
 * the owner's tax; a price that differs says the market's yield on that same
 * income is (cap + tau) x mv / price - tau. Null where the appraisal is the
 * dirt rather than the income (a teardown is not a cap-rate print).
 */
export function impliedCap(s: GameState, rec: ParcelRecord, bbl: string, price: number, cond: Condition, condIdx?: number): number | null {
  if (!(price > 0) || rec.class === "land" || !(rec.bldgArea > 0)) return null;
  const e = s.econ;
  // the condition the appraisal reads (marketAppraisal) when the deal did not say
  condIdx ??= s.holdings?.[bbl]?.condIdx ?? initialCondIdx(rec, s.month, cond);
  const income = incomeValueAsIs(rec, e, cond, condIdx);
  if (!(income > landValue(rec, e) * 1.02)) return null;
  const mv = marketAppraisal(s, rec, bbl, cond);
  if (!(mv > 0)) return null;
  const tau = taxRate(e) * taxBorneShare(rec);
  const cap = capRateFor(rec, e, cond, condIdx) / 100;
  const c = ((cap + tau) * mv / price - tau) * 100;
  return c > 0.5 && c < 40 ? +c.toFixed(3) : null;
}

function pushPrint(s: GameState, p: CapPrint) {
  const t = (s.capTape ??= []);
  t.push(p);
  capSee(s, p);
  const cut = s.month - TAPE_MONTHS;
  let i = 0;
  while (i < t.length && (t[i].m < cut || t.length - i > TAPE_MAX)) i++;
  if (i > 0) s.capTape = t.slice(i);
}

/**
 * A BUILDING CLOSED (comps.ts recordComp calls this for every deed that moves:
 * the street, the player, the courthouse, the quiet treaty). Distress and
 * never-exposed sales are evidence at half weight, as an appraiser weights
 * them. Writes the trade to the cause ledger.
 */
export function printTrade(
  s: GameState, rec: ParcelRecord, price: number, buyer: string, seller: string,
  cond: Condition, distress?: boolean, offMarket?: boolean,
): void {
  if (rec.class === "land" || !(rec.bldgArea > 0)) return;
  const li = s.listings?.find((l) => l.bbl === rec.bbl);
  const condIdx = li?.condIdx ?? s.holdings?.[rec.bbl]?.condIdx;
  const c = impliedCap(s, rec, rec.bbl, price, cond, condIdx);
  if (c === null) return;
  const k = rec.class as BuiltClass;
  const id = why(s, {
    k: "market.trade", a: "rival", name: buyer, bbl: rec.bbl,
    n: { price: Math.round(price), cap: c },
    t: `${buyer} paid ${money(price)} for ${rec.address} · cap ${c.toFixed(2)}%${distress ? " · distress sale" : offMarket ? " · never listed" : ""} · from ${seller}`,
  }, [li?.whyId]);
  pushPrint(s, {
    m: s.month, k, bbl: rec.bbl, kind: "t", c, x: features(s, rec, cond, condIdx),
    w: distress || offMarket ? 0.5 : 1, why: id,
    ...(li?.reason && li.reason !== "voluntary" ? { f: 1 as const } : {}),
  });
}

/** The round that closed: who was in the room and what the winner paid for its debt. */
export function noteRoundClosed(s: GameState, bbl: string, round: { bids: Bid[]; n: number }, askCap: number | null): void {
  const t = s.capTape ?? [];
  const p = t[t.length - 1];
  if (!p || p.bbl !== bbl || p.m !== s.month || p.kind !== "t") return;
  const top = round.bids[0];
  if (top) p.rd = +(top.uw.rd * 100).toFixed(2);
  p.nb = round.n;
  if (askCap !== null) p.ca = askCap;
  const ev = p.why !== undefined ? whyGet(s, p.why) : undefined;
  if (ev && top) {
    ev.n = { ...(ev.n ?? {}), bidders: round.bids.length, debtRate: p.rd ?? 0, ltv: +top.uw.w.toFixed(2) };
    const second = round.bids[1];
    ev.t += ` · ${round.bids.length} bid${round.bids.length === 1 ? "" : "s"}${second ? `, next ${money(second.bid)}` : ""} · debt ${(top.uw.rd * 100).toFixed(1)}% on ${Math.round(top.uw.w * 100)}%`;
    // what the winner believed when it priced the building
    (ev.c ??= []).push(whyBelief(s, top.r, p.k));
  }
}

/** A round that did not close: the best bid is evidence, at half weight; no bid at all is counted. */
export function noteRoundFailed(s: GameState, rec: ParcelRecord, li: Listing, round: { bids: Bid[]; n: number; view: DealView | null }): void {
  const k = rec.class as BuiltClass;
  if (!K.includes(k)) return;
  const v = round.view;
  if (!v) return;
  const top = round.bids[0];
  if (!top) {
    const rd = (s.econ.capRead ??= {})[k];
    if (rd) rd.noBid++;
    return;
  }
  const cb = impliedCap(s, rec, li.bbl, top.bid, v.cond, v.condIdx);
  const ca = impliedCap(s, rec, li.bbl, li.ask, v.cond, v.condIdx);
  if (cb === null || ca === null) return;
  // THE BID IS A FLOOR AND THE ASK A CEILING. A round that did not close says
  // the price lies between them, so the evidence is their midpoint — the bid
  // alone would be the low side of every failed round, read as the market.
  const c = +((cb + ca) / 2).toFixed(3);
  pushPrint(s, {
    m: s.month, k, bbl: li.bbl, kind: "b", c, ca,
    x: features(s, rec, v.cond, v.condIdx), w: 0.5, rd: +(top.uw.rd * 100).toFixed(2), nb: round.n,
    ...(li.reason && li.reason !== "voluntary" ? { f: 1 as const } : {}),
  });
}

// ---------------------------------------------------------------- the read-out

function wMedian(xs: { v: number; w: number }[], q = 0.5): number {
  const a = xs.filter((x) => Number.isFinite(x.v) && x.w > 0).sort((p, r) => p.v - r.v);
  if (!a.length) return NaN;
  const tot = a.reduce((s, x) => s + x.w, 0);
  let acc = 0;
  for (const x of a) { acc += x.w; if (acc >= q * tot) return x.v; }
  return a[a.length - 1].v;
}

/**
 * THE APPRAISERS' INDEX: A TIME-DUMMY HEDONIC GRID, READ BY AN APPRAISER WHO
 * WEIGHS EACH NEW COMP AGAINST WHAT IT ALREADY KNEW (PROOF.md #6).
 *
 * WHAT WAS WRONG. A class's cap was the weighted median of a year of prints
 * restated through a ridge fit on the same three years of tape. With 3-13
 * prints a class a year and a print's own scatter about the grid measured at
 * 0.26-0.34 in log cap (2 seeds x 50 years), that median moves ~0.13 in log a
 * year on noise alone — 0.7-1.9 points a year against 0.2-0.5 in NCREIF/RCA —
 * while the market under it moved 0.05-0.12 (method of moments on the year
 * means, same runs). And a grid fitted to 30-odd prints with condition's
 * spread at 0.13 has a standard error on its condition slope of ~0.4: its
 * sign was a coin (econ.capFit "better buildings get higher caps").
 *
 * THE GRID is the time-dummy hedonic regression transaction indices use
 * (Fisher, Geltner & Pollakowski 2007, the MIT/NCREIF TBI; MSCI/RCA's hedonic
 * series): log cap on location, condition and spec, with a free level every
 * calendar year so the characteristics are priced within years and never by
 * a market that moved, fitted on the whole record (the TBI's full sample),
 * kept as running sums. It also prices WHAT KIND of evidence a print is — an
 * unclosed round's bid-ask midpoint, a broker's indication, a distress or
 * never-listed sale, a seller under compulsion (a fund at the end of its
 * life, a merchant builder's exit, a non-core trim, an estate, a receiver —
 * sellerTerms "forced") — so a year rich in failed rounds or forced sellers
 * does not read as a market that moved, and a slope is not a seller's
 * situation (the selection the median could not see). Measured on that grid
 * (2 seeds x 50 years): condition's slope is near zero for office, retail
 * and flats in the prints themselves — bidders priced condition only through
 * the income the appraiser already capitalises (dealView's capital plan read
 * age and spec, not condition; it now also deducts the deferred maintenance a
 * building below standard carries, dev.ts catchUpCapex) — and clearly
 * negative for industrial.
 * The ridge (RIDGE, a shape parameter: about ten prints spread across the town
 * to trust a slope halfway) is the prior that there is no adjustment until
 * the prints show one; +/-2 is a guard only.
 *
 * THE READ is the appraiser's own updating (Quan & Quigley 1991, "Price
 * formation and the appraisal function in real estate markets", JREFE 4;
 * Geltner 1993, JRER 8): each comp, restated to the reference building, moves
 * the read by its reliability against how far the market can have moved since
 * the read was last informed — gain = P / (P + s2/w) — and an outlying comp is
 * weighed at the edge of what is plausible rather than taken at face value
 * (Huber's k = 1.345, the robust Kalman filter of Masreliez & Martin 1977).
 * This IS appraisal smoothing, and it is the appraisers' behaviour, not a dial
 * on the number: s2 is the prints' measured scatter about the grid, and how
 * far the market moves in a year is measured off the appraisers' own record —
 * the year means' squared changes less their sampling noise — starting from a
 * prior worth Q_PRIOR_YRS years of record. The windows (12/24/36 months) say
 * how thin the evidence is and give the raw median the read is compared with.
 */
const RIDGE = 0.4;
/**
 * The prior on a class's true year-on-year move in log cap: about 0.10, the
 * order of the transaction-based (unsmoothed) commercial index's annual
 * volatility (Geltner, Miller, Clayton & Eichholtz, Commercial Real Estate
 * Analysis and Investments, ch. 25: the TBI ~10%/yr against NCREIF's ~5-6%).
 * Worth Q_PRIOR_YRS years of the appraisers' own record (a shape parameter);
 * after that the record speaks.
 */
const CAP_Q0 = 0.10;
/** Land's: commercial land prices swing about twice as hard (Nichols, Oliner & Mulhall 2013, JUE 73: US commercial land prices fell about half in three years after 2007). */
const LAND_Q0 = 0.20;
const Q_PRIOR_YRS = 5;
/** Huber's tuning constant (Huber 1964): 95% efficiency at the normal. A statistical constant, not a fit. */
const HUBER_K = 1.345;
/** Closed years' means kept for the volatility record. */
const YRS_KEPT = 40;
/** The standard lot a land read is quoted for: 25 x 100 ft, the Manhattan standard lot. */
const LAND_REF_LOT = 2500;

const dot = (a: number[], b: number[]) => a.reduce((t, v, i) => t + v * b[i], 0);

function newIndex(nz: number, x: number, s0: number, n0: number, P: number): ApprIndex {
  return { nYr: 0, W: 0, Szz: Array(nz * nz).fill(0), Szy: Array(nz).fill(0), Syy: 0, yrs: [], x, P, s0, n0 };
}

function closeYear(ix: ApprIndex): void {
  const c = ix.cur;
  if (!c || !(c.W > 0)) { ix.cur = undefined; return; }
  const n = c.sz.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) ix.Szz[i * n + j] += c.szz[i * n + j] - c.sz[i] * c.sz[j] / c.W;
    ix.Szy[i] += c.szy[i] - c.sz[i] * c.sy / c.W;
  }
  ix.Syy += c.syy - c.sy * c.sy / c.W;
  ix.W += c.W; ix.nYr++;
  ix.yrs.push({ yr: c.yr, W: c.W, sz: [...c.sz], sy: c.sy });
  if (ix.yrs.length > YRS_KEPT) ix.yrs.shift();
  ix.cur = undefined;
}

function gridAdd(ix: ApprIndex, yr: number, z: number[], y: number, w: number): void {
  if (!(w > 0) || !Number.isFinite(y) || z.some((v) => !Number.isFinite(v))) return;
  if (ix.cur && ix.cur.yr !== yr) closeYear(ix);
  const n = z.length;
  const c = (ix.cur ??= { yr, W: 0, sz: Array(n).fill(0), sy: 0, szz: Array(n * n).fill(0), szy: Array(n).fill(0), syy: 0 });
  c.W += w; c.sy += w * y; c.syy += w * y * y;
  for (let i = 0; i < n; i++) {
    c.sz[i] += w * z[i]; c.szy[i] += w * z[i] * y;
    for (let j = 0; j < n; j++) c.szz[i * n + j] += w * z[i] * z[j];
  }
}

/** The within-year sums, the open year included. */
function within(ix: ApprIndex): { A: number[]; b: number[]; syy: number; W: number; nYr: number } {
  const n = ix.Szy.length;
  const A = [...ix.Szz], b = [...ix.Szy];
  let syy = ix.Syy, W = ix.W, nYr = ix.nYr;
  const c = ix.cur;
  if (c && c.W > 0) {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) A[i * n + j] += c.szz[i * n + j] - c.sz[i] * c.sz[j] / c.W;
      b[i] += c.szy[i] - c.sz[i] * c.sy / c.W;
    }
    syy += c.syy - c.sy * c.sy / c.W; W += c.W; nYr++;
  }
  return { A, b, syy, W, nYr };
}

/** The grid: the ridge solution of the within-year normal equations. */
function gridBeta(ix: ApprIndex): number[] {
  const n = ix.Szy.length;
  const { A, b } = within(ix);
  const M = Array.from({ length: n }, (_, i) => [...A.slice(i * n, i * n + n), b[i]]);
  for (let i = 0; i < n; i++) M[i][i] += RIDGE;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) return Array(n).fill(0);
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j];
    }
  }
  return M.map((row, i) => +clamp(row[n] / row[i], -2, 2).toFixed(4));
}

/** A print's scatter about the grid (log, variance per unit weight), the opening survey's dispersion as its prior. */
function gridS2(ix: ApprIndex, beta: number[]): number {
  const { A, b, syy, W, nYr } = within(ix);
  const n = beta.length;
  let quad = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) quad += beta[i] * A[i * n + j] * beta[j];
  const ss = Math.max(0, syy - 2 * dot(beta, b) + quad);
  const dof = Math.max(0, W - nYr - n);
  const s2 = (ix.s0 * ix.n0 + (dof > 0 ? ss : 0)) / (ix.n0 + dof);
  return Number.isFinite(s2) && s2 > 0 ? s2 : NaN;
}

/**
 * How far the market moves in a year (variance, log): the appraisers' record
 * of year means, net of their sampling noise. Only years that each carried an
 * appraiser's worth of evidence (MIN_EVIDENCE) count: a year "mean" of one
 * comp is that comp, and one 38% industrial print against a 9.8% read
 * (measured, seed 55) taught the appraiser that the market moves a hundred
 * per cent a year.
 */
function gridQ(ix: ApprIndex, beta: number[], s2: number, q0: number): number {
  let acc = 0, n = 0;
  const ys = ix.yrs;
  for (let i = 1; i < ys.length; i++) {
    const a = ys[i - 1], c = ys[i];
    if (c.yr !== a.yr + 1 || !(a.W >= MIN_EVIDENCE) || !(c.W >= MIN_EVIDENCE)) continue;
    const ya = (a.sy - dot(beta, a.sz)) / a.W, yc = (c.sy - dot(beta, c.sz)) / c.W;
    acc += (yc - ya) ** 2 - (Number.isFinite(s2) ? s2 / a.W + s2 / c.W : 0);
    n++;
  }
  return (Q_PRIOR_YRS * q0 * q0 + Math.max(0, acc)) / (Q_PRIOR_YRS + n);
}

/** One comp, restated to the reference (log level y, weight w), weighed by the appraiser. */
function apprSee(ix: ApprIndex, y: number, w: number, s2: number): void {
  if (!Number.isFinite(y) || !(w > 0)) return;
  // no idea yet of how far one comp strays: a level is not read off one or two (it waits for the grid)
  if (!Number.isFinite(s2)) return;
  const S = ix.P + s2 / w;
  const lim = HUBER_K * Math.sqrt(S);
  const v = clamp(y - ix.x, -lim, lim);
  const g = ix.P / S;
  ix.x += g * v;
  ix.P *= 1 - g;
}

/** A cap print's columns: location, condition and spec against the reference building; and what kind of evidence it is. */
function zCap(p: Pick<CapPrint, "x" | "kind" | "w" | "f">): number[] {
  return [
    p.x[0] - CAP_REF_X[0], p.x[1] - CAP_REF_X[1], p.x[2] - CAP_REF_X[2],
    p.kind === "b" ? 1 : 0, p.kind === "s" ? 1 : 0, p.kind === "t" && p.w < 1 ? 1 : 0, p.f ? 1 : 0,
  ];
}
const yrOf = (m: number) => Math.floor(m / 12);

function logVar(xs: number[]): { v: number; n: number; mean: number } {
  const ls = xs.filter((x) => x > 0).map(Math.log);
  const n = ls.length;
  if (n < 2) return { v: 0, n: 0, mean: n ? ls[0] : NaN };
  const mean = ls.reduce((a, x) => a + x, 0) / n;
  return { v: ls.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1), n: n - 1, mean };
}

/** A class's index, started from the read it stands at (an old save, or a class the opening survey missed). */
function capIndex(s: GameState, k: BuiltClass): ApprIndex {
  const e = s.econ;
  const all = (e.capIdx ??= {});
  let ix = all[k];
  if (!ix) {
    const lv = logVar((s.capTape ?? []).filter((p) => p.k === k).map((p) => p.c));
    ix = all[k] = newIndex(7, Math.log(e.capRate[k]), lv.v, lv.n, lv.n ? lv.v / (lv.n + 1) : CAP_Q0 * CAP_Q0);
  }
  return ix;
}

/** A print reaches the appraisers: restated through the grid as it stands, weighed, then added to the grid. */
function capSee(s: GameState, p: CapPrint): void {
  const ix = capIndex(s, p.k);
  const z = zCap(p), y = Math.log(p.c);
  const beta = gridBeta(ix);
  apprSee(ix, y - dot(beta, z), p.w, gridS2(ix, beta));
  gridAdd(ix, yrOf(p.m), z, y, p.w);
}

/** A print restated to the reference building through a grid. */
const toRef = (p: CapPrint, beta: number[]) => p.c * Math.exp(-dot(beta, zCap(p)));

/** A print restated to the reference building through the grid the class's last read used (for the screens and the tests). */
export function capPrintAtRef(e: Econ, p: CapPrint): number {
  const adj = e.capRead?.[p.k]?.adj;
  return adj ? toRef(p, adj) : p.c;
}

const CLASS_WORD: Record<BuiltClass, string> = { office: "office", retail: "retail", multifamily: "apartment", industrial: "industrial" };

/**
 * EACH CLASS'S CAP RATE, READ OFF THE TAPE, monthly (tickEcon). The read is
 * the appraisers' index (above: every print restated through the hedonic grid
 * and weighed as it arrived); the window says how thin the evidence behind it
 * is. The window is a year; with fewer than MIN_EVIDENCE prints' worth of
 * evidence it widens to two years, then three, and the window's own median
 * restated to the reference is published beside the read (`raw`); with none
 * in three years the read stands where the last evidence left it, and says
 * so. A cap rate is never set here — only read.
 *
 * MIN_EVIDENCE is five: an appraiser wants three to five comparable sales
 * (Appraisal Institute practice), and a median of three implied caps that
 * each carry a bidder's own idiosyncrasy moved office two and a half points in
 * a year in a measured run. Widening the window instead trades that noise for
 * lag, which is what a thin market is.
 */
const MIN_EVIDENCE = 5;
export function tickCapRead(s: GameState): void {
  tickLocBeliefs(s.econ);
  tickCapReadInner(s);
}

// ---------------------------------------------------------------- what buyers have seen of a submarket

/**
 * THE PRICE OF A SUBMARKET'S RISK. A buyer asks more of income that has swung
 * more, and the market's price for a point of property income volatility is
 * about four tenths of a point of return: NCREIF unlevered excess returns
 * over their de-smoothed volatility, 1978-2019, run a Sharpe ratio of
 * roughly 0.3-0.5. The equity targets (EQUITY_PREMIUM) are for the class's
 * ordinary building, so only a submarket's volatility over the class's mean
 * is charged — and a calmer one is credited. A calibrated fact, not a spread.
 */
const RISK_PRICE = 0.4;
/** A ten-year memory, as `growthExp`: what a submarket has done over a cycle, not a season. */
const LOC_MEMORY_M = 120;

/**
 * WHAT BUYERS SEE OF EACH SUBMARKET, monthly. The street's stock is kept in
 * ten quality bands per class (bands.ts — the address and the building
 * blended), each with its own occupancy and its own rent swing. A buyer
 * watching the town sees each band's income (rent swing x occupancy) move,
 * and remembers two things: how it has grown against the class, and how
 * much it has swung. Nobody tells it that the edge of town is risky; it has
 * watched the edge of town empty first in every glut (bands.ts: absorption
 * leaves from the bottom of the scale).
 */
export function tickLocBeliefs(e: Econ): void {
  if (!e.bands) return;
  const seen = (e.locSeen ??= {});
  const a = 1 / LOC_MEMORY_M;
  for (const k of K) {
    const bk = e.bands[k];
    if (!bk) continue;
    let incC = 0, stC = 0;
    const inc = bk.stock.map((st, b) => {
      if (!(st > 0)) return NaN;
      incC += bk.rent[b] * bk.occ[b]; stC += st;
      return Math.log(Math.max(1e-6, bk.rent[b] * bk.occ[b] / st));
    });
    if (!(stC > 0) || !(incC > 0)) continue;
    const lc = Math.log(incC / stC);
    const prev = seen[k];
    if (!prev) { seen[k] = { li: inc, lc, g: inc.map(() => 0), v: inc.map(() => 0), n: 0 }; continue; }
    for (let b = 0; b < inc.length; b++) {
      // a band too thin to measure, or one that only just came into being, says nothing this month
      if (!Number.isFinite(inc[b]) || !Number.isFinite(prev.li[b]) || bk.stock[b] < 0.005 * stC) continue;
      const d = (inc[b] - prev.li[b]) - (lc - prev.lc);
      prev.g[b] += a * (d - prev.g[b]);
      prev.v[b] += a * (d * d - prev.v[b]);
    }
    prev.li = inc; prev.lc = lc; prev.n++;
  }
}

/** The premium and relative growth a buyer reads for this building's band, from what it has seen. */
function locBelief(e: Econ, rec: ParcelRecord, k: BuiltClass, condIdx: number): { prem: number; g: number } {
  const seen = e.locSeen?.[k], bk = e.bands?.[k];
  if (!seen || !bk || seen.n < 12) return { prem: 0, g: 0 };
  // an exponential memory started from nothing reads too calm until it has filled: correct for it
  const fill = 1 - Math.pow(1 - 1 / LOC_MEMORY_M, seen.n);
  const sig = seen.v.map((v) => Math.sqrt(Math.max(0, v / fill) * 12) * 100);   // annual, points
  let mean = 0, w = 0;
  for (let b = 0; b < sig.length; b++) if (bk.stock[b] > 0) { mean += sig[b] * bk.stock[b]; w += bk.stock[b]; }
  mean = w > 0 ? mean / w : 0;
  const score = overallScore(rec, e, k, condIdx);
  const b = Math.max(0, Math.min(N_BANDS - 1, Math.floor(score / 10)));
  if (!(bk.stock[b] > 0)) return { prem: 0, g: 0 };
  // HOW MUCH TO BELIEVE A THIN SUBMARKET. A band holding a few buildings
  // swings with every tenant who moves, and a buyer credits its record in
  // proportion to how much of the market it is (Buhlmann credibility: a band
  // with a tenth of the class's stock is believed halfway; a shape parameter).
  const cred = (bk.stock[b] / w) / (bk.stock[b] / w + 0.1);
  return { prem: cred * RISK_PRICE * (sig[b] - mean), g: cred * (seen.g[b] / fill) * 12 };
}

function tickCapReadInner(s: GameState): void {
  const e = s.econ;
  const tape = s.capTape ?? [];
  const reads = (e.capRead ??= {});
  const fits = (e.capFit ??= {});
  for (const k of K) {
    const all = tape.filter((p) => p.k === k && p.m >= s.month - TAPE_MONTHS);
    const ix = capIndex(s, k);
    const beta = gridBeta(ix);
    fits[k] = [beta[0], beta[1], beta[2]];
    // a month passes: the market may have moved by as much as the record says it does
    const s2 = gridS2(ix, beta);
    ix.P += gridQ(ix, beta, s2, CAP_Q0) / 12;
    const idx = +Math.exp(ix.x).toFixed(3);
    let win = 0, sel: CapPrint[] = [];
    for (const w of [12, 24, 36]) {
      sel = all.filter((p) => p.m > s.month - w);
      if (sel.reduce((a, p) => a + p.w, 0) >= MIN_EVIDENCE) { win = w; break; }
    }
    if (!win && sel.length) win = 36;
    const prev = reads[k];
    if (!win) {
      if (Number.isFinite(idx) && idx > 0) e.capRate[k] = idx;
      reads[k] = { n: 0, win: 0, med: e.capRate[k], p25: e.capRate[k], p75: e.capRate[k], ageM: prev ? prev.ageM + 1 : 0, noBid: decay(prev?.noBid), trades: 0, why: prev?.why, adj: beta };
      continue;
    }
    const pts = sel.map((p) => ({ v: toRef(p, beta), w: p.w }));
    const raw = wMedian(pts);
    const med = idx;
    if (!Number.isFinite(med) || !(med > 0)) continue;
    const trades = sel.filter((p) => p.kind === "t");
    const rdNow = wMedian(sel.filter((p) => p.rd !== undefined).map((p) => ({ v: p.rd!, w: 1 })));
    const before = all.filter((p) => p.rd !== undefined && p.m <= s.month - win && p.m > s.month - win - 12);
    const rdThen = wMedian(before.map((p) => ({ v: p.rd!, w: 1 })));
    const ba = sel.filter((p) => p.ca !== undefined);
    const read: CapRead = {
      n: +sel.reduce((a, p) => a + p.w, 0).toFixed(1), win,
      med: +med.toFixed(3), p25: +wMedian(pts, 0.25).toFixed(3), p75: +wMedian(pts, 0.75).toFixed(3),
      ...(Number.isFinite(raw) ? { raw: +raw.toFixed(3) } : {}), se: +(med * Math.sqrt(ix.P)).toFixed(3), adj: beta,
      ageM: Math.round(wMedian(sel.map((p) => ({ v: s.month - p.m, w: 1 })))),
      // a closed round's gap is price against ask; an open one's is the best
      // bid against the ask (twice its midpoint's distance from the ask)
      ...(ba.length ? { bidAsk: +wMedian(ba.map((p) => ({ v: (p.kind === "b" ? 2 : 1) * (p.c - p.ca!), w: 1 }))).toFixed(2) } : {}),
      ...(Number.isFinite(rdNow) ? { debt: +rdNow.toFixed(2) } : {}),
      ...(Number.isFinite(rdNow) && Number.isFinite(rdThen) ? { dDebt: +(rdNow - rdThen).toFixed(2) } : {}),
      noBid: decay(prev?.noBid), trades: trades.length,
    };
    const moved = Math.abs(med - e.capRate[k]) >= 0.05 || !prev?.why || s.month % 12 === 0;
    e.capRate[k] = read.med;
    if (moved) {
      const tradeIds = trades.slice(-3).reverse().map((p) => p.why);
      const debtBit = read.dDebt !== undefined && Math.abs(read.dDebt) >= 0.05
        ? `, buyers' debt cost ${read.dDebt >= 0 ? "+" : ""}${read.dDebt.toFixed(1)}pp` : read.debt !== undefined ? `, buyers' debt ${read.debt.toFixed(1)}%` : "";
      const evidence = trades.length
        ? `${trades.length} ${CLASS_WORD[k]} trade${trades.length === 1 ? "" : "s"} in ${win} months`
        : `no ${CLASS_WORD[k]} trade in ${win} months; ${[
          sel.some((p) => p.kind === "b") ? `${sel.filter((p) => p.kind === "b").length} round(s) bid but not closed` : "",
          sel.some((p) => p.kind === "s") ? `${sel.filter((p) => p.kind === "s").length} broker indications` : "",
        ].filter(Boolean).join(", ")}`;
      read.why = why(s, {
        k: "market.cap", a: "trade", aid: k,
        n: { cap: read.med, n: read.n, win, trades: trades.length, ...(read.debt !== undefined ? { debt: read.debt } : {}), ...(read.bidAsk !== undefined ? { bidAsk: read.bidAsk } : {}) },
        t: `${CLASS_WORD[k]} cap ${read.med.toFixed(2)}%: ${evidence}, appraisers read ${read.med.toFixed(1)}%${read.raw !== undefined ? ` (the deals alone ${read.raw.toFixed(1)}%)` : ""}${debtBit}`
          + (read.bidAsk !== undefined ? `, bid-ask ${read.bidAsk.toFixed(1)}pp` : "")
          + (win > 12 ? " — a thin market, the evidence is old" : ""),
      }, [...tradeIds, whyNation(s)]);
    } else read.why = prev?.why;
    reads[k] = read;
  }
}
/** Rounds with no bid fade over about a year. */
const decay = (x?: number) => Math.round((x ?? 0) * 0.92 * 100) / 100;

// ---------------------------------------------------------------- the broker's survey

/**
 * WHAT THE STREET SAYS IT WOULD PAY, for a spread of a class's buildings: for
 * each, every firm that buys the class gives its own number, and the second
 * best — where a competitive sale clears — is read through the appraiser's
 * income as a cap rate. The cap-rate surveys brokers publish are exactly this
 * (CBRE, the RERC and PwC surveys: indications from active investors).
 */
function surveyClass(s: GameState, parcels: ParcelTable, k: BuiltClass, want: number): { c: number; x: [number, number, number]; bbl: string }[] {
  const e = s.econ;
  const firms = livingRivals(s).filter((r) => !r.stressMs && r.failedM === undefined && (!paramsOf(r).classes || paramsOf(r).classes!.includes(k)));
  if (!firms.length) return [];
  const recs: ParcelRecord[] = [];
  for (const bbl of Object.keys(parcels)) {
    const rec = resolveRec(parcels, s, bbl);
    if (rec && rec.class === k && rec.bldgArea > 0) recs.push(rec);
  }
  recs.sort((a, b) => a.demandScore - b.demandScore || (a.bbl < b.bbl ? -1 : 1));
  if (!recs.length) return [];
  const step = Math.max(1, Math.floor(recs.length / want));
  const out: { c: number; x: [number, number, number]; bbl: string }[] = [];
  for (let i = Math.floor(step / 2); i < recs.length; i += step) {
    const rec = recs[i];
    const cond = initialCondition(rec);
    const mark = assetValue(rec, e, cond);
    const view = dealView(s, rec, rec.bbl, mark, cond);
    if (!view) continue;
    const maxes = firms.map((r) => maxPrice(e, view, bidderOf(s, r, rec), beliefSignals(s, r)).max).filter((m) => m > 0).sort((a, b) => b - a);
    const px = maxes[1] ?? maxes[0];
    if (!px) continue;
    const c = impliedCap(s, rec, rec.bbl, px, cond, view.condIdx);
    if (c !== null) out.push({ c, x: features(s, rec, cond, view.condIdx), bbl: rec.bbl });
  }
  return out;
}

/**
 * THE OPENING, BEFORE ANYTHING HAS TRADED: the broker's survey of every class,
 * run at newGame once the street exists (sim.ts). The provisional rates it
 * replaces (CAP_BASE) are only the appraiser's guess for the opening books the
 * firms bring with them. Two passes, because the appraiser's income the
 * survey reads through depends on the rate it is reading.
 */
export function openingCapSurvey(s: GameState, parcels: ParcelTable): void {
  const e = s.econ;
  if (!livingRivals(s).length) return;
  const last: Partial<Record<BuiltClass, ReturnType<typeof surveyClass>>> = {};
  for (let pass = 0; pass < 2; pass++) {
    for (const k of K) {
      const pts = (last[k] = surveyClass(s, parcels, k, 16));
      const med = wMedian(pts.map((p) => ({ v: p.c, w: 1 })));
      if (Number.isFinite(med)) e.capRate[k] = +med.toFixed(3);
    }
  }
  for (const k of K) if (!(e.capRate[k] > 0)) e.capRate[k] = CAP_BASE[k];
  // THE APPRAISERS START FROM THE SURVEY: its median is their read, its
  // spread their first idea of how far one indication strays (the prior on a
  // comp's scatter, and the read's own uncertainty, s2 / n), and its
  // indications the grid's first rows (a broker's indication, half weight).
  const idx = (e.capIdx = {} as Partial<Record<BuiltClass, ApprIndex>>);
  for (const k of K) {
    const pts = last[k] ?? [];
    const lv = logVar(pts.map((p) => p.c));
    const ix = (idx[k] = newIndex(7, Math.log(e.capRate[k]), lv.v, lv.n, lv.n ? lv.v / (lv.n + 1) : CAP_Q0 * CAP_Q0));
    for (const p of pts) gridAdd(ix, yrOf(s.month), zCap({ x: p.x, kind: "s", w: 0.5 }), Math.log(p.c), 0.5);
  }
  // (The opening land texture level stays the appraiser's provisional one:
  // a survey of bids is not a sale — see tickLandRead.)
  e.capExp = { ...e.capRate };
  const reads = (e.capRead ??= {});
  for (const k of K) reads[k] = { n: 0, win: 0, med: e.capRate[k], p25: e.capRate[k], p75: e.capRate[k], ageM: 0, noBid: 0, trades: 0 };
}

/**
 * A CLASS NOTHING HAS PRINTED IN FOR A YEAR gets the broker's survey once a
 * year (sim.ts, monthly; each class on its own month): six indications, half
 * weight each — about one and a half trades' worth of evidence. So a thin
 * market reads stale for a year and then moves on what the bidders say,
 * rather than holding a crunch's number through a decade of nothing. The
 * prints are the bidders' own numbers; nothing here is a formula for a cap.
 */
export function tickBrokerSurvey(s: GameState, parcels: ParcelTable): void {
  const tape = s.capTape ?? [];
  K.forEach((k, i) => {
    if ((s.month + 3 * i) % 12 !== 0) return;
    if (tape.some((p) => p.k === k && p.m > s.month - 12)) return;
    for (const p of surveyClass(s, parcels, k, 6)) {
      pushPrint(s, { m: s.month, k, bbl: p.bbl, kind: "s", c: p.c, x: p.x, w: 0.5 });
    }
  });
}

// ---------------------------------------------------------------- big books (step 7b)

/**
 * A NEW FIRM DOES NOT BUY A BOOK (owner's rule: newcomers enter small, low on
 * the list, with cash and no buildings, and never arrive as the biggest). A
 * firm bids on a package once it has run a book of its own for three years —
 * long enough to have the investors, the desks and the staff a portfolio
 * closing needs. A shape parameter for "a track record".
 */
const PACKAGE_TRACK_M = 36;

export interface PackageBid {
  r: Rival;
  /** the firm's own number for the whole book, and its bid */
  max: number; bid: number;
}

/**
 * WHO CAN BUY A WHOLE BOOK, AND FOR WHAT (step 7b). Every firm with a track
 * record values the package building by building on its own underwriting
 * (the same numbers it bids on the tape) and shades for the room — and then
 * has to write the cheque itself: its account, its corporate line and the
 * desks' loan on the book (owner's decision: no fund raise, no joint venture
 * for now). When nobody can, there is no bid; that is the market.
 *
 * There is no size discount. A book trades back from the sum of its parts
 * only because the list of people who can write the cheque is short, and
 * shorter in a bad year, when the desks cut the advance.
 */
export function packageBids(s: GameState, parcels: ParcelTable, bbls: string[], sellerId?: string, distress = false): PackageBid[] {
  const recs = bbls.map((b) => resolveRec(parcels, s, b)).filter((r): r is ParcelRecord => !!r);
  if (recs.length < 2) return [];
  const views = recs.map((rec) => rec.class === "land" || !(rec.bldgArea > 0)
    ? null : dealView(s, rec, rec.bbl, Math.max(1, assetValue(rec, s.econ, initialCondition(rec)))));
  const firms = livingRivals(s).filter((r) => r.id !== sellerId && !r.stressMs && r.failedM === undefined
    && s.month - (r.bornM ?? 0) >= PACKAGE_TRACK_M
    && !bbls.some((b) => ownerOf(s, b) === r)
    && recs.every((rec) => !paramsOf(r).classes || paramsOf(r).classes!.includes(rec.class))
    && (!r.sheet || recs.every((rec) => fitOf(s, parcels, r, rec, distress) > 0)));
  const n = firms.length;
  const shade = 1 - SHADE / Math.max(1, n);
  const out: PackageBid[] = [];
  for (const r of firms) {
    // its own number, deed by deed, and the desks' loan on each at its own leverage
    let max = 0, debtShare = 0, ok = true;
    for (let i = 0; i < recs.length; i++) {
      const v = views[i];
      const b = v ? bidderOf(s, r, recs[i]) : null;
      const m = v && b ? maxPrice(s.econ, v, b, beliefSignals(s, r)).max : landMaxPrice(s, r, recs[i]);
      if (!(m > 0)) { ok = false; break; }
      max += m;
      if (v && b) debtShare += Math.min(v.debtA, b.ltvCap) * m;
    }
    if (!ok || !(max > 0)) continue;
    const bid = Math.round(max * shade / 1000) * 1000;
    const debt = bid * (debtShare / max);
    const reserve = Math.max(1_000_000 * dollarLevel(s.econ), Math.max(0, r.cash) * 0.05);
    const room = Math.max(0, lineRoom(s, r, r.aum ?? 0, r.markNoi ?? 0, r.markLand ?? 0));
    if (bid * (1 + BUY_CLOSING) - debt > r.cash - contractedEquity(s, r) + room - reserve) continue;
    out.push({ r, max, bid });
  }
  return out.sort((a, b) => b.bid - a.bid);
}


// ---------------------------------------------------------------- land (FORMULA_LEDGER #24)

/**
 * WHAT A FIRM WOULD PAY FOR A LOT, ON ITS OWN BOOKS.
 *
 *   A BUILDER bids its own residual: the street's best scheme for the lot
 *   (landRead — highest and best use, the envelope, the queue it waits in),
 *   with the margin taken at THIS firm's number (firmMargin) instead of the
 *   trade's. The scheme's own wait and carry are kept: they are facts about
 *   the lot, not the firm.
 *   A LAND BANKER, which does not build, bids the option: the residual at the
 *   rents a holder expects at the next peak, discounted for the wait
 *   (landRead's holder bid), or the builder's residual where that is higher.
 *
 * Nobody here bids the map's texture: that number is the appraiser's, and it
 * is what the prints test.
 */
export function landMaxPrice(s: GameState, r: Rival, rec: ParcelRecord): number {
  if (!(rec.lotArea > 0)) return 0;
  const p = paramsOf(r);
  const builds = p.build > 0;
  if (!builds && !landBanker(r)) return 0;
  const lr = landRead(rec, s.econ);
  const sc = lr.scheme;
  let own = 0;
  if (sc && sc.psf > 0) {
    const gsf = sc.usable * rec.lotArea;
    const value = sc.valuePsf * gsf, nonLand = sc.costPsf * gsf;
    const atTrade = value / (1 + DEV_MARGIN) - nonLand;
    if (atTrade > 0) {
      // the scheme's wait and carry, per dollar of residual
      let f = (sc.psf * rec.lotArea) / atTrade;
      if (builds) {
        // A BUILDER WHO BUYS IS AT THE FRONT OF THE QUEUE: it breaks ground,
        // so the lot's wait behind better sites (queueFactor — what the
        // appraisal of a lot nobody is building on carries) is not its cost;
        // the carry through construction is. The queue is backed out of the
        // scheme's own factor at the residual it was struck on.
        let q = queueFactor(s.econ, sc.use, sc.psf);
        for (let it = 0; it < 2; it++) q = queueFactor(s.econ, sc.use, (sc.psf / Math.max(1e-6, q)));
        if (q > 0) f /= q;
      }
      own = Math.max(0, f * (value / (1 + (builds ? firmMargin(r, s.month) : DEV_MARGIN)) - nonLand));
    }
  }
  return builds ? own : Math.max(own, bankerHoldValue(s, r, rec));
}

// ---------------------------------------------------------------- the land banker's number

/**
 * THE YEARS A LAND BANKER LOOKS AHEAD. Land funds run seven-to-ten-year lives
 * with extensions (closed-end real estate vehicles; NCREIF / Preqin fund
 * terms); a lot that only pencils past fifteen years is not in any fund's
 * plan. The banker takes the best year inside that to sell to a builder.
 */
const BANK_HORIZONS = [0, 1, 2, 3, 5, 7, 10, 15];

/** What a land fund prices off: its rent view, its equity target, its leverage, its file. */
export interface BankerView { id: string; lean: number; eqPrem: number; ltvCap: number; fileSpread: number }

export function bankerViewOf(s: GameState, r: Rival, rec: ParcelRecord): BankerView {
  const b = bidderOf(s, r, rec);
  return { id: r.id, lean: b.lean, eqPrem: b.eqPrem, ltvCap: b.ltvCap, fileSpread: b.fileSpread };
}

/** A fund being raised, before it has a sheet: the land banker's equity target, no lean, its leverage. */
export function entrantBankerView(): BankerView {
  return { id: "entrant", lean: 0, eqPrem: EQUITY_PREMIUM.pe, ltvCap: 0.15, fileSpread: 0 };
}

/** Five-point Gauss-Hermite nodes and weights for a standard normal. */
const GH_Z = [0, -1.355626, 1.355626, -2.856970, 2.856970];
const GH_W = [0.533333, 0.222076, 0.222076, 0.011257, 0.011257];
/**
 * WHAT A CLASS'S REAL RENT DOES IN A YEAR, sd of the twelve-month log change,
 * off the town's own record once it has three years of it. Before that, the
 * national record: CBRE-EA / NCREIF real rent growth 1990-2019 runs about 6%
 * a year sd for office, 5% industrial, 4% retail, 3% apartments.
 */
const RENT_VOL_PRIOR: Record<BuiltClass, number> = { office: 0.06, industrial: 0.05, retail: 0.04, multifamily: 0.03 };
function rentVol(e: Econ, k: BuiltClass): number {
  const h = e.history ?? [];
  const real = (p: (typeof h)[number] | undefined) => p?.rent?.[k] && (p.cpi ?? 1) > 0 ? p.rent[k] / (p.cpi ?? 1) : NaN;
  const xs: number[] = [];
  for (let i = Math.max(12, h.length - 240); i < h.length; i++) {
    const a = real(h[i]), b = real(h[i - 12]);
    if (a > 0 && b > 0) xs.push(Math.log(a / b));
  }
  if (xs.length < 36) return RENT_VOL_PRIOR[k];
  const m = xs.reduce((a, x) => a + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length);
}

let bankMemo: { e: Econ | null; m: number; scheme: Map<string, number>; val: Map<string, number>; vol: Map<BuiltClass, number> } = { e: null, m: -1, scheme: new Map(), val: new Map(), vol: new Map() };

/**
 * WHAT A LOT IS WORTH TO SOMEBODY WHO WILL HOLD IT FOR A BUILDER.
 *
 * A land banker does not build. It buys dirt today and sells it to the builder
 * who will put a building on it — this year if one would pay more than it is
 * worth held, or in some later year when rents have grown into it. So its
 * number is the best, over the years it can wait, of:
 *
 *   the builder's residual in year T, at the rents the banker expects then
 *   (the street's own residual scheme for the lot, residualScheme, at today's
 *   costs and caps with rents grown by the banker's view), discounted at the
 *   banker's own cost of capital in real terms,
 *   less the property tax it pays on the lot while it waits.
 *
 * The rent view is the class's record as the street watched it (growthExp,
 * real), tilted by the firm's own lean on the last three years' rents, as in
 * valueTo, and decaying the way rent growth mean-reverts (GROWTH_DECAY): a
 * growth surprise is not carried for fifteen years. The cost of capital is the
 * firm's equity target over the bent index (EQUITY_PREMIUM: a land fund is
 * private equity), with the land desk's half-advance at the firm's own
 * leverage. Nothing here reads the land level: when builders' prospects rise,
 * this number rises, and the dirt it buys prints it (tickLandRead).
 */
export function bankerHoldValue(s: GameState, r: Rival, rec: ParcelRecord, waitOnly = false): number {
  return holdValueFor(s, bankerViewOf(s, r, rec), rec, waitOnly);
}

/** `waitOnly`: the lot's worth to a holder who does NOT sell this year — what a builder's bid has to beat for a banker to let it go. */
export function holdValueFor(s: GameState, bv: BankerView, rec: ParcelRecord, waitOnly = false): number {
  if (!(rec.lotArea > 0) || rec.ag || rec.homeLot || rec.tract) return 0;
  const e = s.econ;
  if (bankMemo.e !== e || bankMemo.m !== s.month) bankMemo = { e, m: s.month, scheme: new Map(), val: new Map(), vol: new Map() };
  const vk = `${bv.id}|${rec.bbl}|${waitOnly ? 1 : 0}`;
  const hit = bankMemo.val.get(vk);
  if (hit !== undefined) return hit;
  const schemeAt = (mult: number): { psf: number; use?: BuiltClass } => {
    const sk = `${rec.bbl}|${mult.toFixed(3)}`;
    const c = bankMemo.scheme.get(sk);
    if (c !== undefined) return { psf: c };
    const sc = residualScheme(rec, e, mult);
    const psf = sc?.psf ?? 0;
    bankMemo.scheme.set(sk, psf);
    return { psf, use: sc?.use as BuiltClass | undefined };
  };
  // the lot's natural use: today's best scheme, or the use closest to covering its cost
  const now = residualScheme(rec, e, 1);
  let use: BuiltClass | undefined = now?.psf && now.psf > 0 ? now.use as BuiltClass : undefined;
  if (!use && now?.all?.length) use = [...now.all].sort((a, b) => b.psf - a.psf)[0].use;
  const k: BuiltClass = use && (K as string[]).includes(use) ? use : "multifamily";
  let belief = e.growthExp?.[k] ?? 0;
  if (bv.lean !== 0) {
    const sig = beliefSignals(s, { id: bv.id })[k]; // the fund's own belief (beliefs.ts), not the town's true trend
    belief += bv.lean > 0 ? bv.lean * sig.g : -bv.lean * (1 / (1 + sig.dev) - 1) * GAP_CLOSE_YR;
  }
  belief = clamp(belief, -0.06, 0.06);
  // its cost of capital, real: the equity target and the land desk's loan at its leverage
  const i = e.indexRate ?? 5;
  const rE = (bentIndex(i) + bv.eqPrem) / 100;
  const land = streetRefiProceeds(s, 1_000_000, 0, 0.95);
  const w = Math.min(bv.ltvCap, land.principal / 1_000_000);
  const rd = (land.ratePct + bv.fileSpread) / 100;
  const k$ = w * rd + (1 - w) * rE;
  const infl = e.nat?.inflExp ?? 0.02;
  const kr = Math.max(0.01, (1 + k$) / (1 + infl) - 1);
  const taxYr = taxRate(e) * landValue(rec, e);
  // RENTS ARE UNCERTAIN, AND THAT IS WHAT DIRT NOBODY CAN BUILD ON IS WORTH.
  // A lot that pencils only if rents rise a third is worth something even to a
  // holder who expects them flat, because it is sold to the builder only in
  // the years they did rise (Titman 1985; Capozza & Helsley 1990; Quigg 1993
  // measured the option premium on Seattle land at ~6% of its value). The
  // rent level in year T is lognormal about the banker's expectation, its
  // spread the class's own year-on-year real rent volatility (rentVol),
  // integrated through the growth persistence the street already assumes
  // (rho 0.6, GROWTH_DECAY): sd(T) = sigma sqrt(T) / (1 - rho). Expected
  // residual by five-point Gauss-Hermite quadrature.
  let vol = bankMemo.vol.get(k);
  if (vol === undefined) { vol = rentVol(e, k); bankMemo.vol.set(k, vol); }
  const sig = vol / (1 - Math.exp(-GROWTH_DECAY));
  let best = 0;
  for (const T of BANK_HORIZONS) {
    if (waitOnly && T === 0) continue;
    const G = T === 0 ? 0 : belief * (1 - Math.exp(-GROWTH_DECAY * T)) / GROWTH_DECAY;
    const sd = sig * Math.sqrt(T);
    let ev = 0;
    for (let q = 0; q < GH_Z.length; q++) {
      if (T === 0 && q > 0) break;
      const psf = schemeAt(Math.exp(G - 0.5 * sd * sd + sd * GH_Z[q])).psf;
      if (psf > 0) ev += (T === 0 ? 1 : GH_W[q]) * psf;
    }
    if (!(ev > 0)) continue;
    const carry = T === 0 ? 0 : taxYr * (1 - Math.pow(1 + kr, -T)) / kr;
    const v = ev * rec.lotArea / Math.pow(1 + kr, T) - carry;
    if (v > best) best = v;
  }
  best = Math.max(0, Math.round(best));
  bankMemo.val.set(vk, best);
  return best;
}

/** A land bid round: builders and land bankers, each on its own number, shaded by the room and capped by its cash. */
export function landBidRound(s: GameState, parcels: ParcelTable, rec: ParcelRecord, li: Pick<Listing, "bbl" | "ask" | "distress">): { bids: Bid[]; n: number } {
  const seller = ownerOf(s, rec.bbl);
  const room: Rival[] = [];
  for (const r of livingRivals(s)) {
    if (r === seller || r.stressMs || r.failedM !== undefined || r.homeBy !== undefined) continue;
    const p = paramsOf(r);
    if (!(p.build > 0) && !landBanker(r)) continue;
    if (p.classes && !p.classes.includes("land") && !(p.build > 0)) continue;
    if (r.sheet && boughtLastYear(r, s.month) >= dealsPerYear(r.sheet)) continue;
    if (r.sheet && fitOf(s, parcels, r, rec, !!li.distress) <= 0) continue;
    room.push(r);
  }
  const n = room.length;
  const bids: Bid[] = [];
  // a lot is bought with equity and the land desk's half-advance (debt.ts "land")
  const land = streetRefiProceeds(s, li.ask, 0, 0.95);
  const a = li.ask > 0 ? land.principal / li.ask : 0;
  for (const r of room) {
    const max = landMaxPrice(s, r, rec);
    if (!(max > 0)) continue;
    const reserve = Math.max(500_000 * dollarLevel(s.econ), Math.max(0, r.cash) * 0.05);
    const room$ = Math.max(0, lineRoom(s, r, r.aum ?? 0, r.markNoi ?? 0, r.markLand ?? 0));
    const avail = r.cash - contractedEquity(s, r) + room$ - reserve;
    if (!(avail > 0)) continue;
    const bid = Math.round(Math.min(max * (1 - SHADE / Math.max(1, n)), avail / Math.max(0.05, 1 + BUY_CLOSING - a)) / 1000) * 1000;
    if (!(bid > 0)) continue;
    bids.push({ r, max, bid, uw: { V: max, r: 0, rE: 0, rd: land.ratePct / 100, w: a, g: 0 } });
  }
  bids.sort((x, y) => y.bid - x.bid);
  return { bids, n };
}

/**
 * Which lots a price is evidence about the texture level on: lots the texture
 * prices, whoever buys them — a builder's purchase counts the same as a land
 * banker's. A farm, a plat lot or a subdivision tract trades to its own buyer
 * (the farmer, the homebuilder, the land developer), and the urban texture
 * says nothing about it.
 *
 * A LOT A BUILDER'S RESIDUAL PRICES IS NOT EVIDENCE ABOUT THE TEXTURE, and
 * that was measured three ways (six seeds, 25 years; the old formula held the
 * level at 0.9-1.8 and the built sample's land at 39 real $/sf):
 *  - price per unit of texture: a builder buys only where its residual clears
 *    the floor, so every builder's print sits above the level; with sellers
 *    holding their reservations the level ratcheted to 2-15x on five seeds of
 *    six (built-sample land 39 -> 86 $/sf), and with sellers giving lots away
 *    it whipsawed 0.08-5.3.
 *  - price over appraisal (a sales-ratio study): a builder-priced lot's
 *    appraisal does not carry the level, so each builder's purchase at
 *    1.4-2x appraisal (it breaks ground; the appraiser's queue wait is not
 *    its cost) compounded the level, and each one below divided it: one seed
 *    fell 0.95 -> 0.017.
 * The residual is the price on those lots already (value.ts readLand): a
 * builder's purchase there tests the residual, not the dirt nobody builds on.
 */
function urbanLot(rec: ParcelRecord, e: Econ): boolean {
  if (rec.ag || rec.homeLot || rec.tract) return false;
  return landRead(rec, e).winner === "texture";
}

/** A lot's columns: location against mid-town, lot size against the standard lot (plottage), and what kind of evidence it is. */
function landX(rec: ParcelRecord): [number, number] {
  return [+clamp(demandLinear(rec.demandScore) / 100, 0, 1).toFixed(4), +Math.log(Math.max(1, rec.lotArea) / LAND_REF_LOT).toFixed(4)];
}
function zLand(p: { x?: [number, number]; kind: "t" | "b" | "s" }): number[] {
  const x = p.x ?? [0.5, 0];
  return [x[0] - 0.5, x[1], p.kind === "b" ? 1 : 0, p.kind === "s" ? 1 : 0];
}

/**
 * THE LAND INDEX: the same appraisers' index as a class's cap (above), on
 * the texture level each lot's price implies. The texture already adjusts for
 * the map's location; the grid prices what it leaves — location the texture
 * did not capture, and plottage (a big lot sells for less a foot: Colwell &
 * Sirmans 1978, Haughwout, Orr & Bedoll 2008 for New York) — and the kind of
 * evidence. A level read off five lots swung x3 a year (PROOF.md #6).
 */
function landIndex(s: GameState): ApprIndex {
  const e = s.econ;
  if (!e.landIx) {
    const lv = logVar((s.landTape ?? []).map((p) => p.L));
    e.landIx = newIndex(4, Math.log(Math.max(1e-9, e.landIdx)), lv.v, lv.n, LAND_Q0 * LAND_Q0);
  }
  return e.landIx;
}

function pushLandPrint(s: GameState, p: { m: number; L: number; w: number; kind: "t" | "b" | "s"; x?: [number, number] }) {
  const t = (s.landTape ??= []);
  t.push(p);
  const ix = landIndex(s);
  const z = zLand(p), y = Math.log(p.L);
  const beta = gridBeta(ix);
  apprSee(ix, y - dot(beta, z), p.w, gridS2(ix, beta));
  gridAdd(ix, yrOf(p.m), z, y, p.w);
  const cut = s.month - TAPE_MONTHS;
  let i = 0;
  while (i < t.length && (t[i].m < cut || t.length - i > TAPE_MAX)) i++;
  if (i > 0) s.landTape = t.slice(i);
}

/**
 * THE LEVEL A PRICE IMPLIES: what the lot fetched per unit of the map's
 * texture (the sales-comparison floor, `landRead().texture`, at the level of
 * the day), times that level. The texture adjusts for location the way an
 * appraiser adjusts a comparable; what is left is what dirt in this town
 * sells for. Each print is a level in its own right — the floor is
 * proportional to the level, so the print does not depend on the level it was
 * struck at. (Which lots count, and why not the builder-priced ones: urbanLot.)
 */
function impliedLandLevel(s: GameState, rec: ParcelRecord, price: number): number | null {
  if (!(price > 0) || !(rec.lotArea > 0) || !urbanLot(rec, s.econ)) return null;
  const mark = landRead(rec, s.econ).texture * rec.lotArea;
  if (!(mark > 0)) return null;
  const L = s.econ.landIdx * price / mark;
  return Number.isFinite(L) && L > 0 ? L : null;
}

/** A lot closed (comps.ts recordComp), to any arm's-length buyer. */
export function printLandTrade(s: GameState, rec: ParcelRecord, price: number, _buyer: string, distress?: boolean, offMarket?: boolean): void {
  // MARKET VALUE ASSUMES NEITHER PARTY UNDER COMPULSION (USPAP; the
  // Interagency Appraisal Guidelines). A forced sale of dirt to the one bidder
  // in the room is the price of the compulsion, not of the land; nor is a lot
  // never exposed to the market. Measured with them in at half weight (when
  // only land bankers printed): the level fell 87% over 25 years. Neither is
  // a print.
  if (distress || offMarket) return;
  // ...AND A SELLER AGAINST A DEADLINE IS UNDER COMPULSION too: a fund at the
  // end of its life, a merchant builder's exit, a non-core trim, an estate or a
  // receiver (sellerTerms "forced": the reserve is only the loan, so unlevered
  // dirt goes at any bid). Measured with them in: lots sold at 1-13% of
  // appraisal to a builder bidding its thin residual, and the level fell
  // 1.22 -> 0.04 in three years (seed 1).
  const li = s.listings?.find((l) => l.bbl === rec.bbl);
  if (li?.reason && li.reason !== "voluntary") return;
  const L = impliedLandLevel(s, rec, price);
  if (L !== null) pushLandPrint(s, { m: s.month, L, w: 1, kind: "t", x: landX(rec) });
}

/** A land round that did not close: the best bid and the ask met halfway, at half weight — read only when sales are thin. */
export function noteLandRoundFailed(s: GameState, rec: ParcelRecord, li: Listing, round: { bids: Bid[] }): void {
  const top = round.bids[0];
  if (!top || li.distress || (li.reason && li.reason !== "voluntary")) return;
  const L = impliedLandLevel(s, rec, (top.bid + li.ask) / 2);
  if (L !== null) pushLandPrint(s, { m: s.month, L, w: 0.5, kind: "b", x: landX(rec) });
}

/**
 * THE TEXTURE LEVEL, READ OFF THE LAND TAPE, monthly (market.ts) — the same
 * rules as a cap rate: a year of prints, two or three when thin, stale when
 * there are none. It used to be set: rent against construction cost to the
 * 1.15, times the cycle, a vacancy discount and a bidders' term, closed 4% a
 * month (FORMULA_LEDGER #24, Removed).
 */
export function tickLandRead(s: GameState): void {
  const e = s.econ;
  // WHAT EVERY ARM'S-LENGTH BUYER PAID for texture-priced dirt, builders and
  // land bankers alike (urbanLot). The level is the land index (landIndex):
  // closed sales at full weight (USPAP: the sales comparison), a round that
  // did not close and a broker's indication at half, each restated through
  // the grid's own measure of how such evidence sits against a sale. The
  // window below says how thin that evidence is; its median (sales alone
  // where they make the evidence, as before) is published beside the read.
  const tape = (s.landTape ?? []).filter((p) => p.m >= s.month - TAPE_MONTHS && p.m < s.month + 1);
  let win = 0, sel: typeof tape = [];
  const evidence = (xs: typeof tape) => xs.reduce((a, p) => a + p.w, 0) >= MIN_EVIDENCE;
  for (const w of [12, 24, 36]) {
    const inW = tape.filter((p) => p.m > s.month - w);
    const sales = inW.filter((p) => p.kind === "t");
    if (evidence(sales)) { sel = sales; win = w; break; }
    if (evidence(inW)) { sel = inW; win = w; break; }
  }
  // A LEVEL IS NOT READ OFF ONE OR TWO LOTS: with less than MIN_EVIDENCE in
  // three years the read stands where it was (a stale appraisal says so).
  // a month passes for the land index too (the appraisers' read: landIndex)
  const ix = landIndex(s);
  const beta = gridBeta(ix);
  ix.P += gridQ(ix, beta, gridS2(ix, beta), LAND_Q0) / 12;
  const prev = e.landReadOut;
  if (!win) {
    if (Number.isFinite(ix.x)) e.landIdx = Math.exp(ix.x);
    e.landReadOut = { n: 0, win: 0, ageM: (prev?.ageM ?? 0) + 1, why: prev?.why };
    return;
  }
  const raw = wMedian(sel.map((p) => ({ v: p.L * Math.exp(-dot(beta, zLand(p))), w: p.w })));
  const med = Math.exp(ix.x);
  if (!(med > 0) || !Number.isFinite(med)) return;
  const moved = Math.abs(Math.log(med / Math.max(1e-9, e.landIdx))) >= 0.02 || s.month % 12 === 0;
  e.landIdx = med;
  const trades = sel.filter((p) => p.kind === "t").length;
  const bids = sel.filter((p) => p.kind === "b").length, surveyed = sel.filter((p) => p.kind === "s").length;
  const out = { n: +sel.reduce((a, p) => a + p.w, 0).toFixed(1), win, ageM: Math.round(wMedian(sel.map((p) => ({ v: s.month - p.m, w: 1 })))), why: prev?.why, ...(Number.isFinite(raw) ? { raw: +raw.toFixed(4) } : {}) };
  if (moved) {
    out.why = why(s, {
      k: "market.land", a: "trade", aid: "land",
      n: { level: +med.toFixed(4), n: out.n, win, trades, bids, surveyed },
      t: `land: ${trades} lot sale${trades === 1 ? "" : "s"} in ${win} months`
        + `${bids ? `, ${bids} unclosed bid${bids === 1 ? "" : "s"} at half weight` : ""}`
        + `${surveyed ? `, ${surveyed} broker's indication${surveyed === 1 ? "" : "s"} of what land funds and builders would pay` : ""}`
        + ` — appraisers read dirt at ${med.toFixed(2)}x the map's opening texture`
        + (Number.isFinite(raw) ? ` (the window's median ${raw.toFixed(2)}x)` : ""),
    }, [whyNation(s)]);
  }
  e.landReadOut = out;
}

/**
 * DIRT NOTHING HAS PRINTED ON FOR A YEAR gets the broker's survey once a year,
 * the same rule a cap rate with no print gets (tickBrokerSurvey): six
 * texture-priced lots across the town's range of locations, each priced at
 * what the room would pay — the best of the land funds' and builders' own
 * numbers (landMaxPrice), shaded for the room exactly as a land round bids —
 * at half weight. Without it a land level nobody tests stands at the appraiser's
 * opening number for decades: the lots it prices are the ones nobody can
 * build on, their owners list only when somebody would pay their
 * reservation, and the only other sales are forced. The prints are the
 * bidders' own numbers; nothing here is a formula for land.
 *
 * The sample is every vacant town lot, not only the texture-priced ones, and
 * that was measured: surveyed on texture-priced lots alone, each lower level
 * moved the better lots out of the texture set (their builders' residuals now
 * cleared the lower floor), the lots left were worse, and the next survey
 * read lower again — 1.31 to 0.06 in nine years (seed 3). A fixed sample has
 * no such selection: the funds' and builders' numbers do not read the level.
 * It runs when nothing has printed in a year, and whenever the read is stale.
 */
export function tickLandSurvey(s: GameState, parcels: ParcelTable): void {
  if (s.month % 12 !== 6) return;
  const tape = s.landTape ?? [];
  const stale = !(s.econ.landReadOut?.win);
  if (!stale && tape.some((p) => p.kind !== "s" && p.m > s.month - 12)) return;
  const firms = livingRivals(s).filter((r) => !r.stressMs && r.failedM === undefined && (paramsOf(r).build > 0 || landBanker(r)));
  if (!firms.length) return;
  const recs: ParcelRecord[] = [];
  for (const bbl of Object.keys(parcels)) {
    const rec = resolveRec(parcels, s, bbl);
    if (rec && (rec.class === "land" || !(rec.bldgArea > 0)) && rec.lotArea > 0 && !rec.ag && !rec.homeLot && !rec.tract) recs.push(rec);
  }
  if (!recs.length) return;
  recs.sort((a, b) => a.demandScore - b.demandScore || (a.bbl < b.bbl ? -1 : 1));
  const want = 6;
  const step = Math.max(1, Math.floor(recs.length / want));
  let n = 0;
  for (let i = Math.floor(step / 2); i < recs.length && n < want; i += step) {
    const rec = recs[i];
    const maxes = firms.map((r) => landMaxPrice(s, r, rec)).filter((m) => m > 0).sort((a, b) => b - a);
    if (!maxes.length) continue;
    // the best number, shaded for the room as a land round bids (landBidRound)
    const px = maxes[0] * (1 - SHADE / maxes.length);
    // per unit of the map's texture, whoever's number it is (a fixed sample,
    // not the lots the level itself makes texture-priced: see below)
    const mark = landRead(rec, s.econ).texture * rec.lotArea;
    const L = mark > 0 ? s.econ.landIdx * px / mark : NaN;
    if (Number.isFinite(L) && L > 0) { pushLandPrint(s, { m: s.month, L, w: 0.5, kind: "s", x: landX(rec) }); n++; }
  }
}

/** For the UI: the read's line, numbers first. */
export function capReadLine(e: Econ, k: BuiltClass): string | null {
  const r = e.capRead?.[k];
  if (!r) return null;
  if (!r.win) return `${CLASS_WORD[k]} cap ${e.capRate[k].toFixed(2)}%: no ${CLASS_WORD[k]} sale or bid in three years — the read is stale`;
  return `${CLASS_WORD[k]} cap ${r.med.toFixed(2)}%: ${r.trades} trade${r.trades === 1 ? "" : "s"} in ${r.win} months (${r.p25.toFixed(1)}-${r.p75.toFixed(1)}%)`
    + (r.debt !== undefined ? `, buyers' debt ${r.debt.toFixed(1)}%` : "")
    + (r.bidAsk !== undefined ? `, bid-ask ${r.bidAsk.toFixed(1)}pp` : "");
}
