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
//   appraiser's own income. A class's cap rate is the median of that tape over
//   a year — widened to two or three when the market is thin, and simply stale
//   when nothing has traded — and the appraiser's per-building adjustments for
//   location, condition and spec are fitted to it. Appraisals (value.ts
//   capRateFor), lenders' sizing and every mark in the game follow.
//
// What a crunch does to prices it does through the bidders: the desks cut the
// advance, widen the spread and tighten coverage, so each buyer's capital
// stack carries more of its own expensive equity, so it pays less. Nothing
// here says "spreads widen in a crunch".
import type { ParcelRecord, ParcelTable } from "@/data/types";
import type { BuiltClass, CapPrint, CapRead, Condition, Econ, GameState, Listing, Rival, RivalStyle } from "./types";
import { CAP_PLAN_RATE } from "./types";
import { underwrittenGrowthPct, dollarLevel, RENT_BASE, CAP_BASE } from "./market";
import {
  assetValue, capRateFor, initialCondIdx, demandLinear, incomeValueAsIs, initialCondition, inPlace, landValue,
  marketAppraisal, noiYr, resolveRec, specWearMult, taxBorneShare, taxRate, useOccupancy, useRentableSf,
  useRentPsfYr, COND_DECAY, COND_WEAR_REF, overallScore, N_BANDS, landRead, landPsfNow, DEV_MARGIN, queueFactor,
} from "./value";
import { uses } from "./mix";
import { productOf } from "./products";
import { stabViewFor, streetRefiProceeds } from "./debt";
import { TI_ASK, renewalRefreshShare } from "./leasing";
import {
  livingRivals, paramsOf, fitOf, ownerOf, firmOutlook, rentSignals, deployPressure, contractedEquity, lineRoom,
  minTicket, boughtLastYear, gainsTax, streetSaleCost, spreadAdj, firmMaxPrice, firmMargin, landBanker,
} from "./rivals";
import { dealsPerYear, misreadPp } from "./competitorTraits";
import { rowOn, deskWithRoom } from "./rivalDebt";
import { why, whyGet, whyNation } from "./why";
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
const BUY_CLOSING = 0.02;
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
  return { rec, bbl, k, cond: c, condIdx: q, noiPre, stabPre, tau, leaseCap, cx, debtA, debtCap, rd: q1.ratePct, prod, land: landValue(rec, e), locPrem: loc.prem, locG: loc.g };
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
export function valueTo(e: Econ, v: DealView, b: Bidder, rentSig?: ReturnType<typeof rentSignals>): Underwriting {
  const i = e.indexRate ?? 5;
  const rE = (bentIndex(i) + b.eqPrem + (e.capitalWave ?? 0)) / 100;
  const rd = v.debtA > 0 ? (v.rd + b.fileSpread) / 100 : rE;
  const a = Math.min(v.debtA, b.ltvCap);
  const gBase = underwrittenGrowthPct(e) / 100;
  // the class's record, and this submarket's own record against it (tickLocBeliefs)
  let belief = (e.growthExp?.[v.k] ?? 0) + v.locG;
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
  if (b.builds) V = Math.max(V, v.land);
  return { V: Math.max(0, V), r, rE, rd, w, g };
}

/** The most this bidder pays: its value less the closing and the loan's points. */
export function maxPrice(e: Econ, v: DealView, b: Bidder, rentSig?: ReturnType<typeof rentSignals>): { max: number; uw: Underwriting } {
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
export function bidRound(s: GameState, parcels: ParcelTable, rec: ParcelRecord, li: Pick<Listing, "bbl" | "ask" | "distress">): { bids: Bid[]; n: number; view: DealView | null } {
  const view = dealView(s, rec, li.bbl, li.ask);
  if (!view) return { bids: [], n: 0, view };
  const seller = ownerOf(s, rec.bbl);
  const distress = !!li.distress;
  const room: Rival[] = [];
  for (const r of livingRivals(s)) {
    if (r === seller || r.stressMs || r.failedM !== undefined) continue;
    const st = paramsOf(r);
    if (st.classes && !st.classes.includes(rec.class)) continue;
    if (r.sheet && boughtLastYear(r, s.month) >= dealsPerYear(r.sheet)) continue;
    if (li.ask < minTicket(r)) continue;
    if (distress && r.sheet && r.sheet.distress < 25) continue;
    if (r.sheet && fitOf(s, parcels, r, rec, distress) <= 0) continue;
    room.push(r);
  }
  const n = room.length;
  const sig = rentSignals(s);
  const bids: Bid[] = [];
  for (const r of room) {
    const b = bidderOf(s, r, rec);
    const { max, uw } = maxPrice(s.econ, view, b, sig);
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
  const inUse = view ? valueTo(s.econ, view, bidderOf(s, r, rec), rentSignals(s)).V : mark;
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
 * THE APPRAISER'S GRID: weighted ridge regression of log cap on location,
 * condition and spec over three years of prints. The ridge is the prior that
 * there is no adjustment until the prints show one — about ten prints spread
 * across the town to trust it halfway (a shape parameter). Bounded at +/-2 as
 * a guard only.
 */
const RIDGE = 0.4;
function fitGrid(rows: CapPrint[]): [number, number, number] {
  const n = rows.length;
  if (n < 4) return [0, 0, 0];
  // centre on the weighted means, then solve the 3x3 ridge system
  let W = 0; const mx = [0, 0, 0]; let my = 0;
  for (const r of rows) { W += r.w; for (let j = 0; j < 3; j++) mx[j] += r.w * r.x[j]; my += r.w * Math.log(r.c); }
  if (!(W > 0)) return [0, 0, 0];
  for (let j = 0; j < 3; j++) mx[j] /= W;
  my /= W;
  const A = [[RIDGE, 0, 0], [0, RIDGE, 0], [0, 0, RIDGE]];
  const b = [0, 0, 0];
  for (const r of rows) {
    const d = [r.x[0] - mx[0], r.x[1] - mx[1], r.x[2] - mx[2]];
    const y = Math.log(r.c) - my;
    for (let i = 0; i < 3; i++) { b[i] += r.w * d[i] * y; for (let j = 0; j < 3; j++) A[i][j] += r.w * d[i] * d[j]; }
  }
  // Gaussian elimination
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) return [0, 0, 0];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let j = c; j < 4; j++) M[r][j] -= f * M[c][j];
    }
  }
  return [0, 1, 2].map((i) => +clamp(M[i][3] / M[i][i], -2, 2).toFixed(4)) as [number, number, number];
}

/** A print restated to the reference building through the grid. */
const toRef = (p: CapPrint, beta: [number, number, number]) =>
  p.c * Math.exp(-(beta[0] * (p.x[0] - CAP_REF_X[0]) + beta[1] * (p.x[1] - CAP_REF_X[1]) + beta[2] * (p.x[2] - CAP_REF_X[2])));

const CLASS_WORD: Record<BuiltClass, string> = { office: "office", retail: "retail", multifamily: "apartment", industrial: "industrial" };

/**
 * EACH CLASS'S CAP RATE, READ OFF THE TAPE, monthly (tickEcon). The window is
 * a year; with fewer than MIN_EVIDENCE prints' worth of evidence it widens to
 * two years, then three; with none in three years the read stands where the
 * last evidence left it, and says so. A cap rate is never set here — only read.
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
    const beta = fitGrid(all);
    fits[k] = beta;
    let win = 0, sel: CapPrint[] = [];
    for (const w of [12, 24, 36]) {
      sel = all.filter((p) => p.m > s.month - w);
      if (sel.reduce((a, p) => a + p.w, 0) >= MIN_EVIDENCE) { win = w; break; }
    }
    if (!win && sel.length) win = 36;
    const prev = reads[k];
    if (!win) {
      reads[k] = { n: 0, win: 0, med: e.capRate[k], p25: e.capRate[k], p75: e.capRate[k], ageM: prev ? prev.ageM + 1 : 0, noBid: decay(prev?.noBid), trades: 0, why: prev?.why };
      continue;
    }
    const pts = sel.map((p) => ({ v: toRef(p, beta), w: p.w }));
    const med = wMedian(pts);
    if (!Number.isFinite(med)) continue;
    const trades = sel.filter((p) => p.kind === "t");
    const rdNow = wMedian(sel.filter((p) => p.rd !== undefined).map((p) => ({ v: p.rd!, w: 1 })));
    const before = all.filter((p) => p.rd !== undefined && p.m <= s.month - win && p.m > s.month - win - 12);
    const rdThen = wMedian(before.map((p) => ({ v: p.rd!, w: 1 })));
    const ba = sel.filter((p) => p.ca !== undefined);
    const read: CapRead = {
      n: +sel.reduce((a, p) => a + p.w, 0).toFixed(1), win,
      med: +med.toFixed(3), p25: +wMedian(pts, 0.25).toFixed(3), p75: +wMedian(pts, 0.75).toFixed(3),
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
        t: `${CLASS_WORD[k]} cap ${read.med.toFixed(2)}%: ${evidence}, median ${read.med.toFixed(1)}%${debtBit}`
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
  const sig = rentSignals(s);
  const out: { c: number; x: [number, number, number]; bbl: string }[] = [];
  for (let i = Math.floor(step / 2); i < recs.length; i += step) {
    const rec = recs[i];
    const cond = initialCondition(rec);
    const mark = assetValue(rec, e, cond);
    const view = dealView(s, rec, rec.bbl, mark, cond);
    if (!view) continue;
    const maxes = firms.map((r) => maxPrice(e, view, bidderOf(s, r, rec), sig).max).filter((m) => m > 0).sort((a, b) => b - a);
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
  for (let pass = 0; pass < 2; pass++) {
    for (const k of K) {
      const med = wMedian(surveyClass(s, parcels, k, 16).map((p) => ({ v: p.c, w: 1 })));
      if (Number.isFinite(med)) e.capRate[k] = +med.toFixed(3);
    }
  }
  for (const k of K) if (!(e.capRate[k] > 0)) e.capRate[k] = CAP_BASE[k];
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
  const sig = rentSignals(s);
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
      const m = v && b ? maxPrice(s.econ, v, b, sig).max : landMaxPrice(s, r, recs[i]);
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
  return builds ? own : Math.max(own, lr.holder * rec.lotArea);
}

/** A land bid round: builders and land bankers, each on its own number, shaded by the room and capped by its cash. */
export function landBidRound(s: GameState, parcels: ParcelTable, rec: ParcelRecord, li: Pick<Listing, "bbl" | "ask" | "distress">): { bids: Bid[]; n: number } {
  const seller = ownerOf(s, rec.bbl);
  const room: Rival[] = [];
  for (const r of livingRivals(s)) {
    if (r === seller || r.stressMs || r.failedM !== undefined) continue;
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
 * Which lots a price is evidence about the town's dirt on: any lot a builder,
 * a holder or the texture prices. A farm, a plat lot or a subdivision tract
 * trades to its own buyer (the farmer, the homebuilder, the land developer),
 * and the urban texture says nothing about it.
 */
function urbanLot(rec: ParcelRecord, e: Econ): boolean {
  if (rec.ag || rec.homeLot || rec.tract) return false;
  const w = landRead(rec, e).winner;
  return w === "texture" || w === "builder" || w === "holder";
}

function pushLandPrint(s: GameState, p: { m: number; L: number; w: number; kind: "t" | "b" | "s" }) {
  const t = (s.landTape ??= []);
  t.push(p);
  const cut = s.month - TAPE_MONTHS;
  let i = 0;
  while (i < t.length && (t[i].m < cut || t.length - i > TAPE_MAX)) i++;
  if (i > 0) s.landTape = t.slice(i);
}

/**
 * THE LEVEL A PRICE IMPLIES — A SALES-RATIO STUDY (IAAO Standard on Ratio
 * Studies): the level on the day times what the lot fetched over what it
 * appraised at. A builder's purchase counts the same as a land banker's: both
 * are arm's-length buyers paying what the lot is worth to them, and the read
 * moves until the town's land sells at its appraisals.
 *
 * Measured and reverted: price per unit of the TEXTURE (the floor) instead of
 * the appraisal. A builder pays the residual, which has nothing to do with the
 * map's texture, and only lots whose residual clears the floor sell to one, so
 * every builder's print read high, the floor rose, and the level whipsawed
 * 0.08-5.3 across six seeds in 25 years, frozen for years at the extremes
 * when nothing could sell. The ratio is neutral where a lot sells at its
 * appraisal and moves only on what the buyers say about the appraisals.
 */
function impliedLandLevel(s: GameState, rec: ParcelRecord, price: number): number | null {
  if (!(price > 0) || !(rec.lotArea > 0) || !urbanLot(rec, s.econ)) return null;
  const mark = landPsfNow(rec, s.econ) * rec.lotArea;
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
  const L = impliedLandLevel(s, rec, price);
  if (L !== null) pushLandPrint(s, { m: s.month, L, w: 1, kind: "t" });
}

/** A land round that did not close: the best bid and the ask met halfway, at half weight — read only when sales are thin. */
export function noteLandRoundFailed(s: GameState, rec: ParcelRecord, li: Listing, round: { bids: Bid[] }): void {
  const top = round.bids[0];
  if (!top || li.distress) return;
  const L = impliedLandLevel(s, rec, (top.bid + li.ask) / 2);
  if (L !== null) pushLandPrint(s, { m: s.month, L, w: 0.5, kind: "b" });
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
  // WHAT EVERY ARM'S-LENGTH BUYER PAID: builders on their residuals and land
  // bankers on the option, alike. Read off land bankers alone, the level fell
  // 87% in 25 years (land median 61 -> 8 $/sf, six seeds): the bankers are the
  // low bidders on most lots, and the builders who set most land prices were
  // left out. Closed sales govern (USPAP: the sales comparison); a round that
  // did not close is an indication at half weight, read only where the sales
  // alone do not make the evidence in the window — as a cap read takes the
  // broker's survey only when nothing has printed.
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
  const prev = e.landReadOut;
  if (!win) { e.landReadOut = { n: 0, win: 0, ageM: (prev?.ageM ?? 0) + 1, why: prev?.why }; return; }
  const med = wMedian(sel.map((p) => ({ v: p.L, w: p.w })));
  if (!(med > 0)) return;
  const moved = Math.abs(Math.log(med / Math.max(1e-9, e.landIdx))) >= 0.02 || s.month % 12 === 0;
  e.landIdx = med;
  const trades = sel.filter((p) => p.kind === "t").length;
  const out = { n: +sel.reduce((a, p) => a + p.w, 0).toFixed(1), win, ageM: Math.round(wMedian(sel.map((p) => ({ v: s.month - p.m, w: 1 })))), why: prev?.why };
  if (moved) {
    out.why = why(s, {
      k: "market.land", a: "trade", aid: "land",
      n: { level: +med.toFixed(4), n: out.n, win, trades },
      t: `land: ${trades} lot sale${trades === 1 ? "" : "s"} in ${win} months`
        + `${sel.length > trades ? `, ${sel.length - trades} unclosed bid${sel.length - trades === 1 ? "" : "s"} at half weight` : ""}`
        + ` — dirt sells at ${med.toFixed(2)}x the map's opening texture`,
    }, [whyNation(s)]);
  }
  e.landReadOut = out;
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
