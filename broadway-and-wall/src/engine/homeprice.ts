// WHAT A NEW HOUSE SELLS FOR, AND WHAT THAT LEAVES FOR THE LOT (region map, Phase 3).
//
// For-sale housing is priced the way a homebuilder's sales office prices it:
// by what the households who buy new houses here can carry on a mortgage, and
// by what the street round the plat already trades at. A finished lot is then
// worth what a builder can pay for it — the price of the house it carries,
// less the cost of putting the house up, the cost of selling it, the margin
// the trade needs and the interest on the months in between. That is the
// builder's residual, and it is the honest answer to "what is a finished lot
// worth": in a town where the house would cost more to build than its buyers
// can borrow, the answer is nothing, and the dirt is still a farm.
//
// Everything here is pure: (econ, lot) in, numbers out. The monthly state it
// reads (`econ.homes`, the town's new-home $/sf and each plat's location and
// sell-out) is written by homes.ts.
//
// THE MONEY. The town's dollars (`priceLevel`) reach every line the same way
// the rest of the engine's do: household income through `wageIdx` (1.0 at the
// reference table), construction through `costIdx`, the mortgage through the
// loan index. So a town where pay runs ahead of building costs, or rates are
// low, is one where houses pencil; a cheap-money-dear-rates town is one where
// they do not. Nobody chose which kind this seed is.
import type { Econ } from "./types";

// ---------------------------------------------------------------- the facts [S]
/** US median household income, 2023 (Census, Income in the United States P60-282: $80,610). wageIdx 1.0 is this. */
export const HH_INCOME_REF = 80_610;
/**
 * The spread of household income: lognormal, sigma from the US Gini of 0.485
 * (Census 2023): sigma = sqrt(2) * PhiInv((G + 1) / 2) = 0.92.
 */
export const INCOME_SIGMA = 0.92;
/** The front-end ratio a conventional lender qualifies a buyer at: 28% of gross income to principal, interest, tax and insurance (Fannie Mae / FHA guideline). */
export const DTI = 0.28;
/** Down payment: 10%, about the median for all buyers (NAR Profile of Home Buyers and Sellers 2024: 9% first-time, 23% repeat). */
export const DOWN = 0.10;
/** Property tax (~1.0% effective, US median) and homeowner's insurance (~0.5%), a year, as a share of the price. */
export const TAX_INS = 0.015;
/** The 30-year mortgage over the loan index — the same 1.7 points the households' block uses (market.ts tickHouseholds). */
export const MORTGAGE_SPREAD = 0.017;
/** The engine's construction desk: the loan index plus 2.4 points, interest only (proforma.ts CONSTR_SPREAD). */
const CONSTRUCTION_SPREAD = 0.024;
/**
 * THE REFERENCE NEW HOUSE, 2024: Census New Residential Sales median sales
 * price of a new single-family house $420,000; median floor area of new
 * single-family houses about 2,200 sf (Census Characteristics of New
 * Housing); Freddie Mac PMMS 30-year average 6.72%; and the median lot of a
 * new house sold, about 7,500 sf (same survey, rounded).
 */
export const REF_HOME = { price: 420_000, sf: 2_200, rate: 0.0672, lotSf: 7_500 } as const;
/**
 * WHERE THE MONEY IN A NEW HOUSE GOES — NAHB, Cost of Constructing a Home 2024
 * (shares of the sales price): construction 64.4%, finished lot 13.7%,
 * financing 1.9%, overhead and general expenses 5.2%, marketing 1.3%, sales
 * commission 3.3%, builder's profit 11.0%. Construction there includes the
 * permit, the inspections, the architecture and engineering and the water and
 * sewer taps — the soft costs of the house itself.
 */
export const NAHB = { construction: 0.644, lot: 0.137, financing: 0.019, overhead: 0.052, marketing: 0.013, commission: 0.033, profit: 0.110 } as const;
/**
 * VERTICAL COST, $/sf at costIdx 1: NAHB's construction share applied to the
 * Census median new house — 0.644 x $420,000 / 2,200 sf = $123/sf. A median
 * production house, not NAHB's survey average ($162/sf on a 2,647-sf,
 * $665,000 house): the survey over-represents the custom end, and the median
 * buyer does not buy that house.
 */
export const VERTICAL_PSF = (NAHB.construction * REF_HOME.price) / REF_HOME.sf;
/** Start to completion for a house built for sale, about seven months (Census Survey of Construction 2024, built-for-sale single-family). */
export const BUILD_M = 7;
/** A finished spec house sits on the market about three months before it sells (Census, median months for sale since completion, 2.5-3.5 in 2023-24). */
export const SELL_M = 3;
/** Average household size, 2024 (Census CPS): 2.51. Households = population / this. */
export const HH_SIZE = 2.51;
/** New single-family houses sold a year per household: 683,000 sold in 2024 (Census New Residential Sales) over 131.4M households (ACS). */
export const NEW_HOME_RATE = 683_000 / 131_400_000;
/** National household growth, a year: about 1.0M a year on 131M households, 2023-24 (Census HVS) = 0.77%. */
export const HH_GROWTH_NAT = 0.0077;
/**
 * The share of new-house demand that comes from household GROWTH rather than
 * replacement, move-up and second homes. Net household formation (~1.0M a
 * year) against all housing completions (~1.6M, 2024) puts it near 0.6 — a
 * shape parameter [K] read off those two numbers, not fitted to anything here.
 */
const GROWTH_SHARE = 0.6;
/**
 * HOW SHARPLY A COMMUNITY'S SALES ANSWER ITS PRICE AGAINST THE NEIGHBOURS'.
 * New communities in one town are close substitutes; builder incentives of
 * 5-8% of price moved 2023's volumes by a fifth or more (NAHB HMI, public
 * builders' reports). Elasticity 4 is a shape parameter [K] in that range: 5%
 * under the going price sells about a fifth faster.
 */
export const PRICE_ELAST = 4;
/**
 * The discount rate a buyer of finished lots in bulk applies to the sell-out:
 * the PwC Real Estate Investor Survey's national land-development market,
 * about 18-20% a year (2023-24). A lot that will not sell for six years is
 * worth a third of one that sells this year.
 */
export const LOT_SELLOUT_RATE = 0.19;
/**
 * The cost of distance. Each extra kilometre between the plat and the town's
 * edge is two more kilometres a working day (1.3 on the road for each one as
 * the crow flies) for 1.25 commuters a household, 250 days a year: driving at
 * about 19 cents a km (AAA 2024, fuel, tyres and upkeep, ~30 cents a mile)
 * and time at 50 km/h valued at half the wage (US DOT value-of-travel-time
 * guidance, personal local travel). Capitalised into the price at the
 * buyer's cost of carrying it (Alonso-Muth: the house next to the job costs
 * what the commute saves).
 */
export const COMMUTE = { km: 2 * 1.3 * 1.25 * 250, perKm: 0.19, kmh: 50, vot: 0.5 };

// ---------------------------------------------------------------- mortgage arithmetic
export const mortgageRate = (e: Pick<Econ, "indexRate">): number => (e.indexRate ?? 5.4) / 100 + MORTGAGE_SPREAD;
const amort = (rate: number) => { const m = rate / 12; return m / (1 - Math.pow(1 + m, -360)); };
/** Monthly principal, interest, tax and insurance per dollar of price. */
export const paymentPerDollar = (rate: number) => (1 - DOWN) * amort(rate) + TAX_INS / 12;
/** The price a household earning `income` qualifies for at `rate`. */
export const qualifyingPrice = (income: number, rate: number) => (income * DTI) / 12 / paymentPerDollar(rate);
/** The income it takes to buy at `price`. */
export const incomeToBuy = (price: number, rate: number) => (price * paymentPerDollar(rate) * 12) / DTI;
/** The town's median household income, this month, in its own dollars. */
export const medianIncome = (e: Pick<Econ, "wageIdx">) => HH_INCOME_REF * (e.wageIdx ?? 1);

const erf = (x: number) => {
  // Abramowitz & Stegun 7.1.26, |error| < 1.5e-7
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
};
const normCdf = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));
/** Share of the town's households who could buy at `price` at `rate`. */
export function affordShare(price: number, rate: number, income: number): number {
  if (!(price > 0) || !(income > 0)) return 0;
  return 1 - normCdf(Math.log(incomeToBuy(price, rate) / income) / INCOME_SIGMA);
}
/**
 * THE NEW-HOUSE BUYER. Nationally, the household that qualifies for the
 * median new house at the 2024 rate earns 1.58x the median household — about
 * the 69th percentile, which is where new-house buyers sit (NAHB and the AHS
 * put recent new-home buyers' median income near $120-130k). Derived from the
 * facts above, not typed in.
 */
export const NEW_BUYER_MULT = incomeToBuy(REF_HOME.price, REF_HOME.rate) / HH_INCOME_REF;
/** At the reference, the share of households who could buy the median new house (~31%; NAHB's "priced out" series puts it at 25-30%). */
export const AFFORD_REF = affordShare(REF_HOME.price, REF_HOME.rate, HH_INCOME_REF);

/**
 * WHAT THE STANDARD NEW HOUSE AT THE TOWN'S EDGE IS WORTH, $/sf: the price
 * its buyer (NEW_BUYER_MULT x the median household) qualifies for at today's
 * mortgage rate, over its 2,200 sf. The fundamental that `econ.homes.psf`
 * chases — sticky, as house prices are (homes.ts).
 */
export function fundamentalHomePsf(e: Pick<Econ, "wageIdx" | "indexRate">): number {
  return qualifyingPrice(NEW_BUYER_MULT * medianIncome(e), mortgageRate(e)) / REF_HOME.sf;
}

/** The house a builder puts on a lot: the median new house on the median lot, larger on a larger lot (floor area ~ sqrt(lot), a shape [K]), inside the zoning. */
export function homeSfFor(lotSf: number, far = 0.6): number {
  const sf = REF_HOME.sf * Math.sqrt(Math.max(1, lotSf) / REF_HOME.lotSf);
  return Math.round(Math.max(900, Math.min(sf, far * lotSf, 4_500)));
}

/**
 * What distance costs, as a multiple on the price: the commute's yearly cost
 * capitalised at the buyer's carrying rate (mortgage + tax and insurance).
 */
export function commuteMult(e: Pick<Econ, "wageIdx" | "indexRate">, edgeM: number, priceAtEdge: number): number {
  if (!(edgeM > 0) || !(priceAtEdge > 0)) return 1;
  const income = NEW_BUYER_MULT * medianIncome(e);
  const level = (e.wageIdx ?? 1);     // driving costs in the town's dollars, as its pay
  const yrPerKm = COMMUTE.km * COMMUTE.perKm * level + (COMMUTE.km / COMMUTE.kmh) * COMMUTE.vot * (income / 2080);
  const cap = mortgageRate(e) + TAX_INS;
  return Math.max(0.5, 1 - (yrPerKm * (edgeM / 1000)) / cap / priceAtEdge);
}

export type HomeQuote = {
  /** the house: floor area, and what it sells for */
  sf: number; price: number;
  /** what it costs to put up (vertical + overhead), sell, and carry, and the margin the trade needs */
  vertical: number; overhead: number; selling: number; carry: number; margin: number;
  /** the builder's residual for the lot, $ (negative: no builder can pay anything for it) */
  residual: number;
  /** the same over the lot, $/sf, floored at 0 */
  residualPsf: number;
};

/**
 * THE BUILDER'S RESIDUAL. `psf` is the going new-house price per foot at this
 * plat (econ.homes, location applied); `adj` is a builder's own price against
 * it. The lot pays for itself last: price less vertical, overhead, selling
 * costs and margin, less the construction interest, then discounted for the
 * months the lot is carried (build + sell) at the construction rate.
 */
export function homeQuote(e: Pick<Econ, "costIdx" | "indexRate">, lotSf: number, psf: number, far = 0.6, adj = 0): HomeQuote {
  const sf = homeSfFor(lotSf, far);
  const price = Math.round(psf * sf * (1 + adj));
  const vertical = Math.round(VERTICAL_PSF * sf * (e.costIdx ?? 1));
  const overhead = Math.round(NAHB.overhead * price);
  const selling = Math.round((NAHB.commission + NAHB.marketing) * price);
  const margin = Math.round(NAHB.profit * price);
  const r = (e.indexRate ?? 5.4) / 100 + CONSTRUCTION_SPREAD;
  // the draws go in evenly, so on average half the vertical is out for the build
  const carry = Math.round((vertical + overhead) * 0.5 * (BUILD_M / 12) * r);
  const pre = price - vertical - overhead - selling - margin - carry;
  const residual = Math.round(pre / (1 + r * (BUILD_M + SELL_M) / 12));
  return { sf, price, vertical, overhead, selling, carry, margin, residual, residualPsf: Math.max(0, residual) / Math.max(1, lotSf) };
}

/**
 * THE HOMES MARKET THE ENGINE EXPECTS `months` FROM NOW, for a forecast (a
 * land developer pricing lots it will sell when its streets are in): the going
 * new-house price closing its gap to the fundamental at the market's own
 * speed (HPI_CHASE_M, 30 months — market.ts), the fundamental and the cost of
 * building both carried at expected inflation (pay and construction move with
 * the price level), and today's rates (the loan index is a forecast of itself
 * no better than the market's). An estimate, not a promise: the board, the
 * cycle and the rates will move it.
 */
export function forwardHomeEcon(e: Econ, months: number): { psf: number; costIdx: number; indexRate: number } {
  const m = Math.max(0, months);
  const infl = Math.pow(1 + ((e as { inflExp?: number }).inflExp ?? e.nat?.inflExp ?? 0.02), m / 12);
  const fund = fundamentalHomePsf(e) * infl;
  const now = e.homes?.psf ?? fundamentalHomePsf(e);
  const psf = fund + (now - fundamentalHomePsf(e)) * Math.pow(1 - 1 / 30, m);
  return { psf, costIdx: (e.costIdx ?? 1) * infl, indexRate: e.indexRate };
}

/** A plat's market, as homes.ts writes it each month. */
export type PlatMarket = {
  /** location multiple on the town's new-house $/sf: resale comps nearby, and the commute */
  loc: number;
  /** of which, the commute alone */
  commute: number;
  /** expected lot absorption here, lots a month, and the sell-out discount on the unsold lots */
  pace: number; disc: number;
  /** unsold, unbuilt lots left on the plat */
  left: number;
  /**
   * THE APPRAISED MARK on the plat's unsold lots: the inputs of the builder's
   * residual as they stood at the last appraisal — the plat's completion, each
   * January 1 (the owner's annual appraisal, as for every other property) and
   * any month lots on this plat change hands (a comp). A residual is a small
   * difference of big numbers; re-deriving it from each month's rate, cost and
   * sell-out pace swung 157 unsold lots by ±$2.5M a month with no cash moving.
   */
  mark?: { psfHere: number; disc: number; costIdx: number; indexRate: number };
};
export type HomeMarket = {
  /** the standard new house at the town's edge, $/sf — chases fundamentalHomePsf */
  psf: number;
  /** that fundamental, this month */
  fund: number;
  /** bumped whenever any of this moves: the land memo keys on it (value.ts LAND_SCALARS) */
  stamp: number;
  plats: Record<string, PlatMarket>;
};

/**
 * THE HOMEBUILDER'S BID FOR A FINISHED LOT, $/sf of land: the residual on the
 * house this lot carries, at this plat's going price, discounted for the
 * sell-out of the lots still unsold on the plat — a buyer of a lot is buying
 * its place in the queue. 0 where no homes market reaches the lot.
 *
 * A LOT BY A PARK SELLS A DEARER HOUSE. `homePrem` is the hedonic premium a
 * household pays for the house on this lot because of the plat's amenities
 * (platdesign.ts lotPremium: fronting a park, backing onto the greenway, the
 * pool on every house); the builder's costs do not move with it, so most of
 * it reaches the lot.
 */
export function homeLotBidPsf(rec: { lotArea: number; block?: string; farMaxRes?: number; homePrem?: number }, e: Econ): number {
  const hm = e.homes;
  const pm = hm && rec.block ? hm.plats[rec.block] : undefined;
  if (!hm || !pm) return 0;
  // a holding is marked at the plat's last appraisal (PlatMarket.mark); absent one, today's residual
  const m = pm.mark;
  if (m) return m.disc > 0 ? homeQuote({ costIdx: m.costIdx, indexRate: m.indexRate }, rec.lotArea, m.psfHere * (1 + (rec.homePrem ?? 0)), rec.farMaxRes ?? 0.6).residualPsf * m.disc : 0;
  if (!(pm.disc > 0)) return 0;
  return homeQuote(e, rec.lotArea, hm.psf * pm.loc * (1 + (rec.homePrem ?? 0)), rec.farMaxRes ?? 0.6).residualPsf * pm.disc;
}

/**
 * What a builder's per-foot price for a plat's lots comes to on THIS lot: its
 * residual with its premium over its residual without (1 on a lot with none).
 * A builder pricing a plat by the foot pays it on the standard lot and more on
 * the lot by the park, because it sells that house for more (homes.ts sellLot).
 */
export function lotPremiumMult(e: Pick<Econ, "costIdx" | "indexRate">, lotSf: number, psfHere: number, far: number, prem: number): number {
  if (!(prem > 0)) return 1;
  const base = homeQuote(e, lotSf, psfHere, far).residual;
  if (!(base > 0)) return 1;
  return Math.max(1, homeQuote(e, lotSf, psfHere * (1 + prem), far).residual / base);
}

/**
 * Today's value of selling `left` lots one after another at `pace` a month,
 * against selling them all today: the mean of (1 + r)^-(k / pace / 12).
 */
export function selloutDiscount(left: number, pace: number): number {
  if (!(left > 0)) return 1;
  if (!(pace > 1e-3)) return 0;
  const q = Math.pow(1 + LOT_SELLOUT_RATE, -1 / (12 * pace));
  // sum_{k=1..n} q^k / n
  return (q * (1 - Math.pow(q, left))) / (1 - q) / left;
}

/**
 * HOMES A MONTH, for one builder selling in this town: the households who buy
 * a new house here this month (households x the national new-house rate,
 * scaled by how fast the town is adding households), the share of them who
 * can carry this house at today's rate against the share who could carry the
 * median new house nationally, split among the builders with houses to sell,
 * and answering this builder's price against the going one.
 *
 * `qualityAdjPrice` is the price with location taken out (price / loc): a
 * buyer pays more for a better street or a shorter drive and is no poorer for
 * it, so affordability is read on the standard house, not the location.
 */
export function salesPace(e: Econ, qualityAdjPrice: number, adj: number, sellers: number): number {
  const pop = e.population ?? 0;
  const g = e.homesG12 ?? HH_GROWTH_NAT;
  const growth = Math.max(0, Math.min(4, g / HH_GROWTH_NAT));
  const base = (pop / HH_SIZE) * (NEW_HOME_RATE / 12) * ((1 - GROWTH_SHARE) + GROWTH_SHARE * growth);
  const afford = affordShare(qualityAdjPrice, mortgageRate(e), medianIncome(e)) / AFFORD_REF;
  return (base * afford / Math.max(1, sellers)) * Math.pow(1 + adj, -PRICE_ELAST);
}
