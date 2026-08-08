// The market: mean-reverting rate walk, rate-linked cap rates, cyclical
// rents, and a phase machine whose turns are rumored before they land.
// Randomness creates situations, never verdicts.
import type { ParcelTable } from "@/data/types";
import type { BuiltClass, Econ, GameState, MarketPhase, NewsItem, Sector } from "./types";
import { BUILT_CLASSES } from "./types";
import { applyEra, driftInflTarget } from "./regime";
import { swanClassLevel, swanTradeWave, tickSwans } from "./swans";

export function mulberry32Step(a: number): { state: number; value: number } {
  a |= 0; a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return { state: a, value: ((t ^ (t >>> 14)) >>> 0) / 4294967296 };
}

export function rng(s: GameState): number {
  const r = mulberry32Step(s.rng);
  s.rng = r.state;
  return r.value;
}
export const rrange = (s: GameState, a: number, b: number) => a + (b - a) * rng(s);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// ---------------------------------------------------------------------------
// SUBLET SPACE — THE FAST HALF OF THE TENANT'S PRICE RESPONSE, AND IT WAS NOT
// IN THIS ENGINE AT ALL.
//
// The only tenant-side answer to price here was `affordEff`, an EMA whose
// hundred-month time constant is the honest speed of LEASE ROLLOVER: an
// eight-year office term rolls about one per cent of a footprint a month,
// which is exactly what 0.010 says. Nothing else opposed a shortage, so
// nothing opposed a shortage inside a year — and the measurement showed it.
// Over 17 careers of fifty years, the median office owner watched real
// effective rent draw down 92.4%, and did it TWICE, about nine years down and
// nine years back. The worst national US office episode on record (1990-92)
// was -35 to -40% real effective; the deepest episode anywhere in the American
// record — Houston 1983-87, a one-industry town in an oil bust on top of a
// tax-shelter overbuild — was about -65 to -70%, once, in one city, in eighty
// years. This model's MEDIAN career was worse than Houston, twice.
//
// In life the space comes back long before the lease does. A firm that has
// stopped hiring, or that is staring at a rent it can no longer justify, puts
// floors on the sublet market within MONTHS and goes on paying its landlord to
// the end of the term. That inventory is real, large, published and fast: San
// Francisco office sublease space went from about 1.5M sf at the end of 2019
// to about 9M sf by 2023 — roughly a tenth of the city's inventory and about a
// quarter of everything available — with the bulk of the move inside four
// quarters. It drains on the same clock: when space is cheap again a tenant
// takes its floors back off the market rather than sublet them at a loss.
//
// That is a fast ceiling on a shortage and a fast floor under a glut, and it
// is the one that can exist without falsifying lease physics, because the
// sublet decision is not a lease decision. `affordEff` stays exactly where it
// was for office. This runs alongside it, eleven times faster.
//
// `sublet[k]` is square feet INSIDE `occupied` — the landlord is still being
// paid — that are on the market anyway. Rents, concessions and developers all
// read AVAILABILITY (direct vacancy plus sublet), which is what a real market
// report quotes and what a real tenant chooses from.
//
// MEASURED, 6 SEEDS x 50 YEARS, AND IT IS THE LARGEST SINGLE EFFECT IN THE
// FILE. Turning this channel off and changing nothing else takes office
// sd(log) of real effective rent from 0.263 back to 0.696 — a 156% return of
// amplitude — peak-to-trough from 2.84x to 9.81x and the median career's
// worst real drawdown from 47.6% back to 89.8%. Industrial +46%, retail +28%.
// Housing is unaffected by design; its speed comes from its lease term.
//
// AND WHERE IT IS STILL WRONG, because the inventory is checkable. Office
// sublet runs 0.23% of stock at the median here, 6.0% at the 95th and 8.9% at
// the worst; the published figures are 1-1.5% of inventory in an ordinary US
// office market, 2.7% at the national 2023 peak and about 10% at San
// Francisco's. So the extreme is right and the ORDINARY LEVEL IS THREE TIMES
// TOO LOW, because this give-back is driven by the aggregate: when the city as
// a whole wants what it holds, nothing is marketed. In life the inventory
// never empties, because firms merge, contract and relocate idiosyncratically
// in every kind of market — it is the DISPERSION of firm outcomes, not the
// net. Modelling that properly means a background floor on marketed space,
// and a permanent floor cannot be added here without also restating
// NATURAL_VAC as an availability rate rather than a direct-vacancy rate, which
// is a much wider change than this one. Recorded, not fixed.
declare module "./types" {
  interface Econ {
    /** SF under lease and on the sublet market, by class. Counted inside
     *  `occupied`, counted again in availability — that double life is the
     *  whole point of it. */
    sublet?: Record<BuiltClass, number>;
  }
}

/** How fast unwanted space reaches the market, and leaves it again, in months.
 *  San Francisco's sublease inventory did the bulk of its 2020 move in four
 *  quarters and drained on a similar clock after 2023; nine months puts ~74%
 *  of the move inside a year, which is that. */
const SUBLET_TAU = 9;

/** Of the space a tenant no longer wants, the share it can actually MARKET.
 *  This is a physical question about demising, not a preference. An office
 *  floor is separable and the sublet market is the deepest there is. A
 *  warehouse sublets whole or by bay — Amazon marketed something like 10M sf
 *  of it in 2022 — but a small one cannot be cut up. A shop is format- and
 *  location-specific and needs a landlord's consent, so assignments happen and
 *  they happen slowly. There is NO sublet market in flats worth modelling: the
 *  fast quantity response in housing is households doubling up, and that is a
 *  DEMAND response, which is where it now sits — see AFFORD_ROLL, where
 *  housing finally reprices at its own one-year lease term instead of an
 *  office's eight. */
const DEMISABLE: Record<BuiltClass, number> = {
  office: 0.60, industrial: 0.50, retail: 0.25, multifamily: 0,
};

/** A GUARD, NOT A MECHANISM: the most sublet inventory any market has been
 *  observed to carry, as a share of leased space. San Francisco's 2023 peak was
 *  about a tenth of inventory and it is the deepest office sublet market on
 *  record; industrial and retail have never come near it. How often this binds
 *  is measured and reported — if it ever becomes load-bearing it is hiding a
 *  fault rather than guarding against one. */
const SUBLET_MAX: Record<BuiltClass, number> = {
  office: 0.10, industrial: 0.06, retail: 0.04, multifamily: 0,
};

/** HOW FAST A TENANT'S FOOTPRINT CAN REPRICE — one over the lease term in
 *  months, because that is the rate at which leases actually come up. The old
 *  0.010 was right, and it is kept: an eight-year office term rolls about 1% a
 *  month. What was wrong is that it was applied to all four classes, which is a
 *  number measured in one place asserted everywhere. Retail and industrial run
 *  five to ten year terms. AN APARTMENT LEASE IS TWELVE MONTHS — a housing
 *  market reprices its entire footprint eight times faster than an office
 *  market, and this model had it eight times too slow. */
const AFFORD_ROLL: Record<BuiltClass, number> = {
  office: 1 / 96,        // eight-year terms
  retail: 1 / 84,        // seven
  industrial: 1 / 72,    // six
  multifamily: 1 / 12,   // one
};

/** HOW MUCH SPACE A SECTOR'S CYCLE ACTUALLY MOVES. Demand for space is
 *  headcount times feet per head, so this multiplier is sized to the
 *  EMPLOYMENT swing it stands for. Measured, `sectorMom` runs about -0.0117 to
 *  +0.0131, so at the old 11 the sector clock ALONE swung demand for space 27%
 *  peak to trough — against a natural vacancy of 11.5 points, a swing that big
 *  is not an input to the cycle, it is the cycle. Real sector employment
 *  cycles are far smaller: US financial-activities employment fell about 8%
 *  peak to trough over 2008-10, information about 10% over 2001-03, and most
 *  sectors less. At 4 the demand swing is about 10%, which is that. */
const MOM_DEMAND = 4;

/** WHAT PRICE IS ALLOWED TO DO TO THE SPACE ONE WORKER OCCUPIES. Affordability
 *  rations demand — dear space, firms take less of it — but it was unbounded,
 *  and unbounded it manufactured tenants out of cheapness: measured over three
 *  careers it reached 2.34 — the model asserting that cheap rent, by itself,
 *  more than doubles the space the city's existing headcount takes. Space per worker
 *  is set by headcount and by workplace design, not by rent. US office ran
 *  about 250 sf/worker in 1990 and about 190 in 2019 — a quarter, over THIRTY
 *  years, and driven by open plan and hot-desking rather than by price. A
 *  cyclical price response cannot be wider than that, so it is bounded inside
 *  it: plus or minus twelve per cent about the middle of the observed band.
 *
 *  IT DID NOT DAMP THE CYCLE AND THAT IS RECORDED HERE. Removing the bound and
 *  changing nothing else measured office sd(log) 0.263 -> 0.235, RETAIL 0.259
 *  -> 0.224 — the unbounded version is calmer, because manufactured demand is a
 *  stabiliser: a rent collapse conjures the tenants that stop it. It is a
 *  stabiliser built on a fiction, so the bound stays and the model is a little
 *  louder for it. What it did do is stop resting on its own rail: the clamp
 *  bound 58.5% of class-months before and binds 16.7% now, because rent no
 *  longer travels far enough to need it. */
const AFFORD_BAND: [number, number] = [0.88, 1.12];

/**
 * HOW HARD EACH TRADE SWINGS.
 *
 * Not every industry has the same cycle. Technology and media boom and bust on
 * a five-year clock and take their landlords with them; insurance and medical
 * barely notice a recession. This single number scales both the depth of an
 * industry's cycle and how often it turns — which is what makes a rent roll of
 * law firms a bond and a rent roll of startups a bet.
 */
export const SECTORS: Sector[] = [
  "finance", "law", "tech", "media", "insurance",
  "logistics", "apparel", "food", "medical", "design",
];
export const INDUSTRY_VOL: Record<Sector, number> = {
  tech: 2.0, media: 1.6, finance: 1.4, apparel: 1.3, design: 1.2,
  logistics: 1.05, food: 0.8, law: 0.7, medical: 0.6, insurance: 0.5,
};
export const INDUSTRY_LABEL: Record<Sector, string> = {
  finance: "Finance", law: "The law firms", tech: "Technology", media: "Media",
  insurance: "Insurance", logistics: "Shipping and logistics", apparel: "Apparel and retail trade",
  food: "Food and hospitality", medical: "Medical", design: "Architecture and design",
};

/**
 * How much trouble an industry is in, 0 (fine) to 1 (falling apart). Read by
 * tenant default, by renewal, and by what a lender will lend against a rent
 * roll that depends on it.
 */
export function industryStress(e: Econ, k: Sector): number {
  const mom = (e.industryMom?.[k] ?? 0) + swanTradeWave(e, k);
  return clamp(-mom / 0.03, 0, 1);
}

/** …and how hard it is hiring, which is who walks through the door. */
export function industryPull(e: Econ, k: Sector): number {
  const mom = (e.industryMom?.[k] ?? 0) + swanTradeWave(e, k);
  return clamp(1 + mom * 22, 0.35, 1.9);
}
// THE CYCLE PLUS THE LEVEL EVENT, AND THESE TWO FUNCTIONS ARE THE ONLY JOIN.
//
// `industryMom` stays exactly what it was: a boom/steady/bust clock that turns
// and comes back. What swans.ts adds is the ADJUSTMENT still working through a
// trade whose level has permanently moved, in the same units, added here rather
// than written into `industryMom` — because writing it in would be eaten within
// months by the clock's own easing toward its phase aim, and because the two
// really are different things that can happen at once. A trade can be leaving
// town AND in a cyclical bust, and a landlord holding it feels both.
//
// Putting it at these two chokepoints is what makes a level event LAND WHERE IT
// SHOULD without a line of code anywhere else knowing swans exist:
// `renewalIntent`, tenant default and the renewal letter in leasing.ts all read
// `industryStress`, so the damage arrives as move-outs from the buildings that
// housed that trade — not as an index; `pickSector` reads `industryPull`, so
// the prospects that turn up afterwards are permanently tilted away from a
// trade that has gone and toward one that has arrived; and value.ts prices the
// share of a rent roll that is stressed, so the appraisal and the lender see it
// too. That is the whole transmission, and it is other people's code.
//
// ONE READER IS MISSED AND IT IS RECORDED HERE: `tickEmployment` in demand.ts
// reads `e.industryMom` directly rather than through these getters, so a
// block's employment advantage tracks the cycle but not the level event. It is
// a real gap — the blocks full of a departing trade should lose desirability
// faster than the city average — and it is a one-word fix in a file this
// change does not own.

// Rate target and rent drift per phase — the cycle is the game's weather.
// monthly cadence: drifts are a third of the old quarterly values, phase
// durations three times as long in ticks — same weather, finer grain
// rateGap is the cycle's DEVIATION from the monetary era, not an absolute
// level: policy tightens into a peak and is cut in a recession, but whether
// that means 3% or 13% is a question about the era, not about the cycle.
const PHASE_CFG: Record<MarketPhase, { rateGap: number; rentDrift: number; devDrift: number; nextM: [number, number]; next: MarketPhase }> = {
  recovery: { rateGap: -0.75, rentDrift: 0.0014, devDrift: +0.034, nextM: [12, 24], next: "expansion" },
  expansion: { rateGap: +0.35, rentDrift: 0.0037, devDrift: +0.027, nextM: [24, 54], next: "peak" },
  peak: { rateGap: +1.95, rentDrift: 0.0014, devDrift: +0.014, nextM: [6, 15], next: "recession" },
  recession: { rateGap: -1.05, rentDrift: -0.0047, devDrift: -0.054, nextM: [12, 24], next: "recovery" },
};

// How far the loan index may travel. A century of property covers eras that
// look nothing like each other, and the point of the wider band is that the
// deal you underwrote at 4% has to survive being refinanced at 12%.
// A century of the real thing ran from the zero bound (2008-15, 2020-21, where
// a borrower still paid a term premium over a policy rate of 0.25%) to Volcker
// at twenty per cent. The old 1.9-15.5 band could represent neither end, which
// meant the two most consequential rate environments in modern history were
// both outside what this game could express.
const RATE_FLOOR = 1.45, RATE_CEIL = 23.0;


/**
 * DOES A GROUNDBREAK PENCIL TODAY, AND HOW COMFORTABLY? 0 = nothing gets
 * built, 1 = an ordinary market, above 1 = everything pencils.
 *
 * This exists because the cost of capital reached exactly ONE of the three
 * parties that put up buildings in this city. The anonymous quota read the
 * hurdle; the thirty-five named firms and the city's own infill did not, and
 * both of them kept breaking ground at the same rate when the price of money
 * doubled. The audit measured the consequence and could not have been clearer
 * about it: spike the policy rate three hundred basis points and hold it, and
 * office STOCK came back a dead wire — starts fell, and the buildings went up
 * anyway, because most of the cranes in town belonged to somebody who had
 * never heard of the rate. Same for a thirty per cent rise in hard costs.
 *
 * One pro forma, read by everyone who can dig a hole. That is the whole fix.
 */
// The pro forma itself lives in value.ts, with the cost table, the opex table,
// the recovery table and the management fee — the things a pro forma is made
// of. This module cannot import them (value.ts imports this one), and the old
// version's whole defect was that it did not need to: it worked from index
// RATIOS against a single class-blind BASE_YOC and never touched a real
// number. See `devPencils` in value.ts.
export { devPencils } from "./value";

// Each rebased DOWN by the average value of the new vacancy term below, so
// CAP_BASE keeps meaning "the class's long-run average cap" rather than "its
// cap at natural vacancy, which this city rarely sits at". Without the rebase
// an uncentred risk term silently widens every cap by 15-30bp forever.
// THE CAP RATE HAS TO CLEAR THE COST OF DEBT, OR LEVERAGE IS A LAW AGAINST
// ITSELF.
//
// These were 5.30 office and 4.76 multifamily against a loan index whose
// century median is 5.05% and senior spreads of 150-210bp — an all-in
// borrowing cost of 6.5-7.2%. Every levered purchase in this game therefore
// paid about a hundred and sixty basis points MORE for its debt than the
// building yielded, permanently, in every market condition, which is negative
// leverage as a fact of physics rather than as a phase of the cycle. The
// strategy tournament measured exactly what that implies: all-cash returned
// $138M real against $29M for maximum leverage, with a LOWER drawdown and
// zero wipeouts. Debt was a way to lose money and the entire capital-markets
// half of the game was dead.
//
// Real going-in cap rates sit at or above the mortgage rate most of the time —
// US office has averaged around 7%, multifamily around 6% — and the years when
// they do not (2021-23) are remembered as the anomaly that froze the
// transaction market. Set so the long-run average asset yields roughly fifty
// basis points over the long-run average all-in loan, which is thin positive
// leverage: enough that debt earns its risk in a normal market, not so much
// that borrowing is free money.
export const CAP_BASE = { office: 8.50, retail: 7.00, multifamily: 5.60, industrial: 7.00 } as const;

// WHAT A NEW BUILDING YIELDS ON ITS COST when rents and costs are both at their
// opening index, and what the capital stack behind it needs on top of the debt
// index to be worth two years of construction risk. Together they are the
// hurdle every groundbreak in this city has to clear. 8.5% over debt + 220bps
// is the ordinary merchant-build test: at a 5% loan index it pencils
// comfortably, at 12% it does not pencil at all until rents have risen by two
// thirds, and at the zero bound everything pencils — which is why 2021 looked
// the way it did.
// Deliberately set so that at the century's MEDIAN loan index the hurdle is
// exactly neutral: this change was meant to make development ANSWER the rate,
// not to make development harder, and a level shift smuggled in alongside a
// structural one is how a calibration gets quietly lost. Measured before the
// level-match, real office rent growth ran 2.08%/yr against wages at 1.06%.
// WHAT A NEW BUILDING YIELDS ON ITS COST when rents and costs are both at their
// opening index, and what the capital stack needs on top of the debt index to
// be worth two years of construction risk.
//
// THIS IS NOT A CAPITAL-MARKETS NUMBER and briefly it was, which was a
// category error: it was scaled off CAP_BASE so that raising cap rates would
// not choke development. But a yield on cost is a fact about RENTS AGAINST
// CONSTRUCTION COSTS — what the building earns over what it took to put up —
// and it has nothing to do with what buyers are paying for stabilised income.
// Tying them made the numerator of the pro forma a function of the discount
// rate, which is not how a builder's economics work in any market.
//
// What actually reopens development after a hurdle rises is the SUPPLY side of
// the construction industry: the cranes stop, the trades go idle, and idle
// trades cut their prices until the deal pencils again. That loop lives in the
// cost drift below, where it belongs.
const BASE_YOC = 0.073, DEV_SPREAD = 0.022;

/**
 * VACANCY IS THE RISK, AND THE RISK IS PRICED.
 *
 * Cap rates were driven by the loan index, the cycle, a credit-crunch term and
 * sector momentum — and not at all by how empty the class was. An office
 * market at 25% vacancy capitalised the same as one at 8%. Measured over
 * 4,800 observations per class, corr(vacancy, cap rate) was 0.10 for office
 * and 0.07 for multifamily, and even that vanished once the rate was
 * regressed out: the residual correlation was 0.09 for office and NEGATIVE
 * for industrial. Vacancy was noise. The rate was the whole model.
 *
 * A class sitting six points over its natural rate is a class whose next roll
 * gets re-let at a concession, and a buyer capitalises exactly that. Office
 * carries the most because its income is the least defensible; flats the
 * least, because people always need somewhere to live.
 *
 * Points of cap rate added per 100bp of vacancy above natural.
 */
/**
 * A MARKET REPRICES ONCE PER GLUT, AND THEN IT IS DONE.
 *
 * `vacOverM` counts the months a class has been over natural. It used to enter
 * the glut term as `min(1, over / 6)` — ramp the capitulation in over half a
 * year and then hold it at FULL STRENGTH for as long as the glut lasts. So rent
 * fell for the entire duration of the oversupply, and the duration of an
 * oversupply is a decade.
 *
 * Measured, 12 seeds x 50 years, office:
 *
 *   glut episodes                     median 6.1 years, longest 17.5
 *   longest unbroken real-rent fall   median 8.4 years, longest 18.5
 *   vacOverM at its peak              median 116 months
 *
 * The first of those is RIGHT — US office vacancy took seven to ten years to
 * clear after 1990, after 2001 and after 2008. The second is not. Rents fell
 * 1990-92, 2001-03, 2008-10 and 2020-23: two to three years each time, and then
 * they sat at the bottom for years while the vacancy ground down. Nothing
 * repriced twice.
 *
 * The reason is not a mystery and it is not a coefficient. Rent stops falling
 * when it reaches the number deals sign at. Below that a landlord would rather
 * hold the floor empty than lock a fifteen-year lease at the bottom of a cycle
 * — which is why shadow space exists — and space starts leaving the market
 * altogether through conversion and mothballing. Meanwhile the tenants who were
 * going to trade down have already trade down. The price adjustment is a
 * FIXED TOTAL that a glut extracts, not a rate it applies forever; how long the
 * glut then lasts decides how long the vacancy takes to clear, not how much
 * further the rent falls.
 *
 * So the clock is a hump. It ramps in over the same six months, holds through
 * the repricing, and then fades.
 *
 * The two numbers are the empirical shape of a capitulation rather than a fit:
 * markets reprice over about two years, and the tail is worth about another
 * fifteen months at full strength. Together that is 39 months of the calibrated
 * rate — at nine points over natural, -40% real, which is Manhattan 1990-92
 * (-35 to -40%) as closely as this can be stated.
 *
 * A DEPTH-SCALED WINDOW WAS TRIED HERE AND REMOVED, and the reason is worth
 * keeping. The argument for it is sound — Houston repriced for five years
 * because at the end of each one the surplus was still there — but it was added
 * to reach a stated frequency of sixty-per-cent collapses, and measured, it
 * pushed the MEDIAN city's worst fifty-year fall from 36.6% to 47.8% of real
 * effective rent. The median town's worst crash in half a century should not be
 * worse than the worst New York has ever had. It was a coefficient sized to an
 * outcome, which is the thing this file is not allowed to contain, and the
 * catastrophes it was reaching for belong in the swan machinery where a
 * structural demand collapse can be modelled as what it is.
 *
 * And it RESETS when the market comes back inside 1.5 points, because a second
 * glut is a second repricing. That is the mechanism, not an exception to it.
 */
const REPRICE_M = 24;    // how long a capitulation runs at full strength
const REPRICE_TAU = 15;  // and the exponential tail after it
function capitulation(over: number): number {
  const rampIn = Math.min(1, over / 6);
  const past = Math.max(0, over - REPRICE_M);
  return rampIn * Math.exp(-past / REPRICE_TAU);
}

export const CAP_VAC_BETA: Record<BuiltClass, number> = {
  office: 0.12, retail: 0.09, multifamily: 0.06, industrial: 0.08,
};
// Rough citywide inventory by class, in sf — the denominator that turns other
// people's construction into a rent effect you can feel.
// Fallback only. The real inventory is COUNTED off the parcels at newGame —
// see stockFromParcels. These numbers described a city seven times the size of
// the one that exists, which meant a 200,000 sf tower you delivered moved
// citywide office vacancy by seven hundredths of a point: "your building is
// supply too" was true in the code and invisible in the game.
export const CITY_STOCK = { office: 5e6, retail: 2e6, multifamily: 7e6, industrial: 1.5e6 } as const;

/**
 * THE MARKET'S INVENTORY IS THE CITY'S INVENTORY.
 *
 * Walk the parcels and add up what is actually standing, class by class. Every
 * city ships its own building stock, so this also stops all six of them
 * sharing one set of hard-coded totals — Sable Harbor has a working port and
 * Kestrel Point does not, and their industrial markets should not be identical.
 *
 * A FLOOR, and an honest reason for it. The parcels are the buildings you can
 * BUY — one island — but the market for the space is regional: industrial
 * tenants in a harbour town take sheds on the mainland too. New Alden maps
 * only 0.58M sf of industrial, which is about ten warehouses, and without a
 * floor a single delivery moved citywide industrial vacancy seventeen points
 * and pinned it on the frictional clamp. The floor is what stops a class that
 * is thin ON THIS MAP from behaving like a market with ten buildings in it.
 */
export function stockFromParcels(parcels: ParcelTable): Record<BuiltClass, number> {
  const out: Record<BuiltClass, number> = { office: 0, retail: 0, multifamily: 0, industrial: 0 };
  for (const bbl in parcels) {
    const r = parcels[bbl];
    if (!r || r.class === "land" || !r.bldgArea) continue;
    const m = r.mix;
    if (m) {
      for (const k of BUILT_CLASSES) out[k] += r.bldgArea * (m[k] ?? 0);
    } else if (r.class in out) {
      out[r.class as BuiltClass] += r.bldgArea;
    }
  }
  // THE FLOOR IS A SHARE OF THE TOWN, NOT A FIXED NUMBER OF FEET.
  //
  // It was 1,200,000 sf flat, which was right for the one island size the game
  // had. It stops being right the moment the map can be a third of that or
  // four times it: on a Hamlet, retail (0.56M sf standing) and industrial
  // (0.20M) both sat BELOW the flat floor, so on a small island two of the
  // four sectors were not priced by the buildings on the map at all — the
  // constant was. A delivery moved vacancy half as much as it should have,
  // and the map stopped being the market.
  //
  // The reason the floor exists is regional spillover — industrial tenants in
  // a harbour town take sheds on the mainland too — and a mainland is
  // proportional to the town in front of it, not a fixed size. 1.2M sf was
  // 7.8% of the standard island's 15.35M sf of stock, so stating it as that
  // share reproduces today's behaviour exactly at standard size and carries
  // correctly to every other. The absolute minimum underneath it is only there
  // so an empty or broken map cannot divide by zero.
  const total = BUILT_CLASSES.reduce((a, k) => a + out[k], 0);
  const floor = Math.max(150_000, total * 0.078);
  for (const k of BUILT_CLASSES) out[k] = Math.max(floor, Math.round(out[k]));
  return out;
}
export const SECTOR_LABEL = { office: "Office", retail: "Retail", multifamily: "Apartments", industrial: "Industrial" } as const;
/**
 * WHAT A SQUARE FOOT RENTS FOR AT AN ORDINARY ADDRESS, $/sf/yr. The location
 * multiplier (`locationRentMult` in value.ts) takes it from here — up to 2.45x
 * for prime office and 3.10x for a prime retail pitch, down to 0.40x and 0.34x
 * on the fringe.
 *
 * INDUSTRIAL WAS THE OUTLIER AND IT BROKE THE LAND MARKET. At $18.00 it earned
 * roughly what an office did in the same town, and since industrial hard cost
 * was the one number nobody had inflated, a two-floor shed was the only use in
 * the game that could pay for dirt. Measured: industrial bid positive for 100%
 * of vacant lots and was the highest and best use on 82% of them, including
 * prime downtown corners a warehouse has no business on.
 *
 * Real industrial rent is nothing like office rent. Rhode Island bulk warehouse
 * runs $5.00-6.00/sf NNN, general-purpose industrial $6.50-7.50, flex about
 * $10; the US national average was $9.90 NNN in Q3 2024. This city's industrial
 * is urban infill on a harbour, which is the dearer end of that, so $8.50 —
 * still less than half what it was, and the correction is a factor of two on
 * the one class that had never been checked.
 *
 * Retail comes down for the same kind of reason. The JLL 2024 national median
 * retail rent is $23.10/sf NNN and strip centres run $18-35; $42.91 was a prime
 * high-street pitch being charged as the city-wide ordinary rate, and then the
 * 3.10x location multiplier was applied ON TOP of it.
 *
 * Office and multifamily stay. Providence Class A asks $26.71-33.51 and the
 * market averages $29.80; this table's ordinary-address office at $43.65 is
 * above that, but it is a GROSS rent in a harbour city with a constrained
 * peninsula, and the measured median-lot achieved rent lands inside the band
 * once the location multiplier has pushed the fringe down. Multifamily at
 * $30.22/sf/yr is $2.52/sf/month, against Providence's ~$2.24 — close enough
 * that moving it would be tuning, not correcting.
 */
export const RENT_BASE = { office: 43.65, retail: 26.00, multifamily: 30.22, industrial: 8.50 } as const; // $/sf/yr
// The natural (frictional) vacancy per class — the rate at which neither side
// of the table has the upper hand. Below it landlords push rents; above it
// tenants extract concessions. Office runs structurally looser than housing.
export const NATURAL_VAC = { office: 0.115, retail: 0.085, multifamily: 0.045, industrial: 0.07 } as const;

/**
 * THE BUILDING TRADES, as a share of a city's payroll.
 *
 * Construction is about 5% of employment in a city of this kind and it is the
 * most cyclical 5% there is — it roughly halves in a real bust and it is the
 * first thing to come back. `REF_PIPE_SHARE` is the pipeline this town runs at
 * in an ordinary year, measured as square feet under construction over square
 * feet standing; it is the point where the employment term is exactly neutral,
 * so it moves nothing about the existing calibration and only prices the swing.
 */
export const CONSTRUCTION_JOB_SHARE = 0.048;
export const REF_PIPE_SHARE = 0.018;
// How long the rest of the market takes to build each class, in months. This
// is the lag that makes the cycle a cycle: the decision to start is taken in
// one market and the building arrives in a different one, and nobody can undo
// a start once the hole is dug.
export const BUILD_MONTHS = { office: [30, 44], retail: [18, 28], multifamily: [22, 34], industrial: [12, 20] } as const;

/**
 * HOW MANY PEOPLE WORK IN THIS TOWN, from the buildings that are standing.
 *
 * Square feet per worker, and these are the SAME ratios `contribution()` in
 * demand.ts uses — deliberately, because two files disagreeing about how many
 * desks fit in an office building is the third kind of fake number and this
 * game has been bitten by it before. An office floor is 230 sf a head, a shed
 * is 550, a shop is 420. Flats employ nobody; they house people, and people
 * arrive here through the labour force rather than through the roof.
 */
const SF_PER_JOB: Record<BuiltClass, number> = { office: 230, industrial: 550, retail: 420, multifamily: 0 };
/** Share of the population in the labour force. See the note at the unemployment term. */
const PARTICIPATION = 0.58;
/** The rate the city opens at, which is what makes the opening state consistent. */
const OPENING_UNEMP = 0.052;

/**
 * THE TOWN'S OPENING SIZE, derived rather than declared.
 *
 * `jobs0` is the stock over the ratios above. `pop0` is what a town with that
 * many jobs has to contain for its own opening unemployment rate to be true:
 * jobs / (1 - u) is the labour force, and the labour force over participation
 * is the population. Feed it the standard island's stock and it returns very
 * nearly the 132,000 / 240,000 the constants used to assert, because that pair
 * WAS this arithmetic — done once, by hand, for one island size, and then left
 * behind when the map became a choice.
 */
export function citySize(stock: Record<BuiltClass, number>): { jobs0: number; pop0: number } {
  let jobs = 0;
  for (const k of BUILT_CLASSES) {
    const per = SF_PER_JOB[k];
    if (per > 0) jobs += (stock[k] ?? 0) / per;
  }
  // A town with no commercial stock at all is still a town — the floor keeps
  // every ratio downstream finite rather than pretending the place is empty.
  jobs = Math.max(2_000, Math.round(jobs));
  const pop0 = Math.round(jobs / (1 - OPENING_UNEMP) / PARTICIPATION);
  return { jobs0: jobs, pop0 };
}

export function initEcon(s: GameState, parcels?: ParcelTable): Econ {
  const CITY = parcels ? stockFromParcels(parcels) : { ...CITY_STOCK };
  const SIZE = citySize(CITY);
  const econ: Econ = {
    indexRate: 5.4,
    phase: "expansion",
    phaseMLeft: 0,
    rumoredPhase: null,
    cycleDev: 0.1,
    landIdx: 1.0,
    capRate: { office: CAP_BASE.office, retail: CAP_BASE.retail, multifamily: CAP_BASE.multifamily, industrial: CAP_BASE.industrial },
    rentIdx: { office: RENT_BASE.office, retail: RENT_BASE.retail, multifamily: RENT_BASE.multifamily, industrial: RENT_BASE.industrial },
    costIdx: 1,
    sectorMom: { office: 0, retail: 0, multifamily: 0, industrial: 0 },
    pipeline: { office: 0, retail: 0, multifamily: 0, industrial: 0 },
    starts: { office: 0, retail: 0, multifamily: 0, industrial: 0 },
    creditIdx: 1,
    employIdx: 1,
    stock: { ...CITY },
    baseStock: { ...CITY },
    baseStock0: { ...CITY },
    occupied: {
      office: CITY.office * (1 - NATURAL_VAC.office),
      retail: CITY.retail * (1 - NATURAL_VAC.retail),
      multifamily: CITY.multifamily * (1 - NATURAL_VAC.multifamily),
      industrial: CITY.industrial * (1 - NATURAL_VAC.industrial),
    },
    cityVac: { ...NATURAL_VAC },
    absorb12: { office: 0, retail: 0, multifamily: 0, industrial: 0 },
    cohorts: { office: [], retail: [], multifamily: [], industrial: [] },
    completions12: { office: 0, retail: 0, multifamily: 0, industrial: 0 },
    history: [],
  };
  econ.phaseMLeft = Math.round(12 + 30 * rng(s));

  // THE MEASURED PIVOTS (ECONOMY.md). The location curves are exponentials
  // pivoted on the city's own sf-weighted mean, so steepening the gradient
  // cannot move the aggregate price level on any map we ever ship; the
  // vintage tilt is renormalised the same way. DEMAND_GAMMA must match
  // value.ts (1.9) — inlined here because value.ts imports this module.
  if (parcels) {
    let wSum = 0, dSum = 0, vSum = 0;
    // ...AND A PIVOT PER CLASS. The citywide mean is set by the offices,
    // because offices are most of the floor area — and a shed measured
    // against an office tower's idea of location is always in a "terrible"
    // spot, which is backwards: industrial land is SUPPOSED to be on cheap
    // fringe dirt, and a shed competes with the other sheds, not with the
    // corner of Broadway & Wall. Measured on New Alden, industrial demand
    // tops out at 28 while the citywide mean sits at 52 — cubed, that read
    // every industrial building in the city as un-lettable, and four of four
    // sheds in the harness never leased at all. Each class pivots on its own
    // stock's mean now, so "a good industrial location" means what a tenant
    // shopping for a shed means by it.
    const wBy: Record<string, number> = {}, dBy: Record<string, number> = {};
    // ...AND WHERE A DEVELOPMENT SITE ACTUALLY IS, which is not the mean of
    // anything. This walk skips land, and land is the only thing anybody
    // builds on. `devPencils` used to underwrite the city's supply at an
    // ordinary address and that is the wrong question: whether a class gets
    // built is a fact about the TOP of the location distribution, not the
    // middle. Measured at the mean, multifamily yields 5.28% against a 6.55%
    // hurdle and city supply would have stopped dead — while `pnpm devyield`
    // finds 66 multifamily sites that clear, all of them good ones.
    const landIdx: number[] = [];
    for (const bbl in parcels) {
      const r = parcels[bbl];
      if (r && r.class === "land" && r.lotArea > 1500) {
        landIdx.push(Math.pow(Math.max(0, r.demandScore) / 100, 1 / 1.9));
      }
      if (!r || r.class === "land" || !r.bldgArea) continue;
      const idx = Math.pow(Math.max(0, r.demandScore) / 100, 1 / 1.9);
      const vin = Math.min(1.7, Math.max(0.5, 0.5 + Math.max(0, 2000 - (r.yearBuilt || 1960)) / 80));
      wSum += r.bldgArea; dSum += r.bldgArea * idx; vSum += r.bldgArea * vin;
      wBy[r.class] = (wBy[r.class] ?? 0) + r.bldgArea;
      dBy[r.class] = (dBy[r.class] ?? 0) + r.bldgArea * idx;
    }
    econ.locIdxMean = wSum > 0 ? +(dSum / wSum).toFixed(4) : 0.62;
    econ.vintageMean = wSum > 0 ? +(vSum / wSum).toFixed(4) : 1.0;
    // The ninth decile of the buildable sites — "a good corner in this town",
    // in the same units as locIdxMean, so the same locationRentMult expression
    // reads it. A property of the MAP, computed once: the set of vacant lots
    // shifts slowly and recomputing it every month for every class would cost
    // more than the answer moves.
    landIdx.sort((a, b) => a - b);
    econ.locIdxDevP90 = landIdx.length
      ? +landIdx[Math.floor(0.90 * (landIdx.length - 1))].toFixed(4)
      : econ.locIdxMean;
    econ.locIdxMeanBy = {
      office: (wBy.office ?? 0) > 0 ? +(dBy.office / wBy.office).toFixed(4) : econ.locIdxMean,
      retail: (wBy.retail ?? 0) > 0 ? +(dBy.retail / wBy.retail).toFixed(4) : econ.locIdxMean,
      multifamily: (wBy.multifamily ?? 0) > 0 ? +(dBy.multifamily / wBy.multifamily).toFixed(4) : econ.locIdxMean,
      industrial: (wBy.industrial ?? 0) > 0 ? +(dBy.industrial / wBy.industrial).toFixed(4) : econ.locIdxMean,
    };
  } else {
    econ.locIdxMean = 0.62;
    econ.vintageMean = 1.0;
  }
  // The pool opens exactly balanced: the tenants the city started with.
  econ.pool = {
    office: econ.stock.office * (1 - NATURAL_VAC.office),
    retail: econ.stock.retail * (1 - NATURAL_VAC.retail),
    multifamily: econ.stock.multifamily * (1 - NATURAL_VAC.multifamily),
    industrial: econ.stock.industrial * (1 - NATURAL_VAC.industrial),
  };
  econ.affordEff = { office: 1, retail: 1, multifamily: 1, industrial: 1 };
  // the closed loops open at their neutral values; everything after this is
  // the economy deciding for itself
  econ.inflExp = 0.02;
  econ.slackEma = 0;
  econ.tightEma = 0;
  econ.buildEma = 0.02;
  // The trades open exactly fully employed and at their ordinary strength, so
  // the cost of building starts neutral and the town discovers the rest.
  econ.crewUtil = 1;
  econ.crewIdx = 1;
  econ.rentExp = { ...econ.rentIdx };
  // The exit cap opens equal to the going-in cap and drifts from there.
  econ.capExp = { ...econ.capRate };
  // THE CITY HAS PEOPLE IN IT ON DAY ONE. These were seeded lazily inside the
  // monthly tick, so between newGame and the first advanceQuarter the economy
  // reported a population of `undefined` — which the stress harness caught as
  // a NaN in the year-zero column of the null-player table, and which anything
  // reading population before the first tick would have inherited.
  econ.jobs0 = SIZE.jobs0; econ.pop0 = SIZE.pop0;
  econ.population = SIZE.pop0; econ.jobs = SIZE.jobs0; econ.unemployment = OPENING_UNEMP;
  econ.wageIdx = 1; econ.outputIdx = 1; econ.cpi = 1;
  econ.nat = { infl: 0.021, inflExp: 0.02, unemp: 0.052, policy: 4.2,
               neutralReal: 0.019, shockM: 0, shockSev: 0, credibility: 0.8,
               recM: 0, expM: 0, deep: false, pressureM: 0 };
  econ.concIdx = { office: 0, retail: 0, multifamily: 0, industrial: 0 };
  econ.vacOverM = { office: 0, retail: 0, multifamily: 0, industrial: 0 };
  econ.effRentIdx = { ...econ.rentIdx };
  // WHICH DECADE YOU WALKED INTO. Applied last, so everything above is the
  // long-run baseline and this is the deliberate departure from it. Drawn from
  // the run seed on a private generator — see regime.ts for why that matters.
  {
    const era = applyEra(econ, s.seed, NATURAL_VAC as unknown as Record<string, number>);
    econ.eraKey = era.key; econ.eraLabel = era.label; econ.eraBlurb = era.blurb;
  }
  recordHistory(econ, 0);
  return econ;
}

function pushNews(s: GameState, kind: NewsItem["kind"], text: string) {
  s.news.unshift({ q: s.month, kind, text });
  if (s.news.length > 120) s.news.length = 120;
}

const RUMORS: Record<MarketPhase, string[]> = {
  expansion: [
    "Leasing brokers report tour volume up for a third straight quarter.",
    "Debt desks are quoting tighter spreads — money wants in.",
  ],
  peak: [
    "A record bid for a Midtown tower has appraisers raising eyebrows.",
    "Lenders start asking harder questions about pro-forma rents.",
  ],
  recession: [
    "Sublease space is quietly piling up downtown.",
    "Two regional banks pulled term sheets this week, sources say.",
  ],
  recovery: [
    "Distressed buyers are circling — the smart money smells a bottom.",
    "First green shoots: concessions burning off in the best buildings.",
  ],
};

export function tickEcon(s: GameState) {
  // The space market needs the calendar: a building that opened last year is
  // not the same asset as one that opened in 1928, and occupancy has to know.
  s.econ.m = s.month;
  const e = s.econ;
  // THE LEVEL BEFORE THE CYCLE. Swans set the ground the rest of this function
  // stands on — how much of each trade the city holds and how much of each kind
  // of space it wants — so they move first and everything below reads one
  // consistent level for the month. See swans.ts; it draws off the campaign
  // seed rather than `s.rng`, so nothing in this file's stream shifts.
  tickSwans(s);
  const cfg = PHASE_CFG[e.phase];

  // phase machine with rumors one or two quarters ahead of the turn
  // --- THE PHASE MACHINE READS THE PROPERTY MARKET ---------------------------
  //
  // It used to be a countdown clock and nothing else: `phaseMLeft--`, then a
  // fixed round-robin. No state of the market it was describing was ever
  // consulted. The consequence is the owner's own bug report — cheat the
  // money, build until the city is 45% empty, and the corner of the screen
  // still says EXPANSION, because the clock cannot see an empty building.
  //
  // Slack is the stock-weighted excess vacancy across all four classes,
  // smoothed over about eight months so the machine reads a sustained
  // condition and never a spot number. A boom carrying real slack dies early;
  // a boom carrying a glut is over. The 36-month guard is what stops one bad
  // year from rattling the cycle into noise.
  {
    let sw = 0, gw = 0;
    for (const k of BUILT_CLASSES) {
      const st = e.stock?.[k] ?? CITY_STOCK[k];
      sw += st;
      gw += st * ((e.cityVac?.[k] ?? NATURAL_VAC[k]) - NATURAL_VAC[k]);
    }
    const gapW = sw > 0 ? gw / sw : 0;
    e.slackEma = (e.slackEma ?? gapW) + 0.08 * (gapW - (e.slackEma ?? gapW));
    const slack = e.slackEma;
    if ((e.phase === "expansion" || e.phase === "peak") && slack > 0.05) {
      e.phaseMLeft -= 2;                       // the boom is running on fumes
      if (slack > 0.09 && s.month - (e.forcedTurnM ?? -999) > 36) {
        e.phaseMLeft = 0;                      // and now it is simply over
        e.forcedTurnM = s.month;
        pushNews(s, "warn",
          "The glut has caught up with the market — there is a year of empty space on the tape "
          + "and everyone has stopped pretending this is an expansion.");
      }
    }
    // ...and the other way: a market that has eaten its slack cannot stay in
    // recession forever on a timer. Absorption ends a downturn, not patience.
    if ((e.phase === "recession" || e.phase === "recovery") && slack < -0.01) e.phaseMLeft -= 1;

    // AND THE NATION OUTRANKS THE CITY. No local property cycle survives a
    // national recession on its own schedule — 1990, 2001 and 2008 each ended
    // every regional boom in the country within a few quarters of each other,
    // because the tenants are national firms and the lenders are national
    // banks. A local boom can outlast a mild downturn for a while; it cannot
    // ignore one.
    if ((e.nat?.recM ?? 0) > 0 && (e.phase === "expansion" || e.phase === "peak")) {
      e.phaseMLeft -= 2;
    }
  }

  e.phaseMLeft--;
  if (e.phaseMLeft <= 6 && !e.rumoredPhase && rng(s) < 0.25) {
    e.rumoredPhase = cfg.next;
    pushNews(s, "rumor", RUMORS[cfg.next][Math.floor(rng(s) * RUMORS[cfg.next].length)]);
  }
  if (e.phaseMLeft <= 0) {
    // A MARKET CANNOT BEGIN AN EXPANSION WITH A YEAR OF EMPTY SPACE ON THE
    // TAPE. Forcing a turn out of a boom was only half of it: the round-robin
    // would then walk recovery -> expansion -> peak again three years later
    // while the city was still 40% vacant, which is the owner's complaint
    // wearing a different hat. Entering a boom is a claim about the market,
    // and slack is the market's answer. The recovery simply continues — which
    // is what a long depression actually looks like from inside.
    let nextPhase = cfg.next;
    if ((nextPhase === "expansion" || nextPhase === "peak") && (e.slackEma ?? 0) > 0.055) {
      nextPhase = "recovery";
    }
    e.phase = nextPhase;
    e.rumoredPhase = null;
    const [lo, hi] = PHASE_CFG[e.phase].nextM;
    e.phaseMLeft = Math.round(lo + (hi - lo) * rng(s));
    const label: Record<MarketPhase, string> = {
      expansion: "The expansion is on — rents push, capital chases.",
      peak: "The market has topped out. Everything is priced to perfection.",
      recession: "The turn is here: tenants retrench, lenders retreat.",
      recovery: "The bleeding has stopped. Recovery begins at the bottom of the stack.",
    };
    pushNews(s, "event", label[e.phase]);
  }

  const c2 = PHASE_CFG[e.phase];

  // --- the monetary era ------------------------------------------------------
  // A slow walk between long regimes, re-aimed roughly every twelve to
  // twenty-five years. This is the layer that makes a mortgage struck in one
  // decade a different animal by the time it matures in the next.
  if (e.rateRegime === undefined) { e.rateRegime = 5.4; e.rateAimTo = 5.4; e.rateAimM = s.month + 180; }
  // NOTE: the era walk below is now vestigial — rateRegime is written by the
  // central bank block as policy + term premium. It survives only to keep
  // rateAimTo/rateAimM alive for old saves and for the era news copy.
  if (s.month >= (e.rateAimM ?? 0)) {
    const was = e.rateAimTo ?? 5.4;
    e.rateAimTo = rrange(s, 2.4, 11.0);
    e.rateAimM = s.month + Math.round(rrange(s, 150, 320));
    if (Math.abs(e.rateAimTo - was) > 1.6) {
      pushNews(s, e.rateAimTo > was ? "warn" : "event", e.rateAimTo > was
        ? "The cost of money is turning. Economists are talking about a decade of dearer credit."
        : "A new monetary era: money is getting cheaper, and everything with a yield is about to be repriced.");
    }
  }
  // half-life around five years — an era arrives slowly and then it is simply
  // the world you underwrite in
  e.rateRegime = clamp(e.rateRegime + 0.012 * ((e.rateAimTo ?? 5.4) - e.rateRegime), RATE_FLOOR, RATE_CEIL);
  // and once in a long while it moves all at once
  if (rng(s) < 0.0035) {
    const jump = rrange(s, 1.1, 3.2) * (rng(s) < 0.55 ? 1 : -1);
    e.rateRegime = clamp(e.rateRegime + jump, RATE_FLOOR, RATE_CEIL);
    pushNews(s, jump > 0 ? "warn" : "event", jump > 0
      ? "An inflation scare. The index jumped this month and every floating coupon in the city went with it."
      : "The central bank cut hard and unexpectedly. Refinancing windows are open that were shut last month.");
  }

  // --- THE NATION, AND THE CENTRAL BANK ------------------------------------
  //
  // Calibrated against a century of the real thing. The federal funds rate sat
  // at 3-4% through the twenties, fell to about 1% in the Depression and was
  // pegged near zero through the war; drifted up through the fifties and
  // sixties; came apart in the seventies as inflation reached 14.8%; peaked at
  // TWENTY PER CENT in June 1981 when Volcker decided to break it and accepted
  // 10.8% unemployment as the price; then declined for forty years, sat at the
  // zero bound 2008-2015 and again in 2020-21, and rose from zero to 5.33% in
  // sixteen months in 2022-23 — the fastest tightening in four decades.
  //
  // Three things follow from that history and all three are in this block.
  // ONE: the range is enormous and the old 1.9-15.5 band could represent
  // neither the zero bound nor Volcker. TWO: regimes last decades, which is
  // what makes a mortgage struck in one era a different animal in the next.
  // THREE: what turns a rate cycle into a rate ERA is whether expectations
  // come unanchored — the Great Inflation was an expectations failure, and the
  // Great Moderation was thirty years of a central bank being believed.
  {
    if (!e.nat) {
      e.nat = { infl: 0.021, inflExp: 0.02, unemp: 0.052, policy: 4.2,
                neutralReal: 0.019, shockM: 0, shockSev: 0, credibility: 0.8,
                recM: 0, expM: 0, deep: false, pressureM: 0 };
    }
    const n = e.nat;
    // r* drifts on a multi-decade clock: ~2% mid-century, closer to 0.5% in
    // the modern era. It is not a constant and it is not fast.
    // ...centred near 1.2%, which is where the real one has spent most of the
    // last century, drifting toward 2%+ mid-century and under 0.5% in the
    // modern era. Mean-reverting, or a century-long walk becomes the model.
    // AND IT REVERTS TO SOMETHING THAT ITSELF MOVES. This pulled toward a
    // hardcoded 1.2% in every game, which is why a century opening at 15%
    // short rates was back at the same 4.5% median within two decades and why
    // twelve of twenty-two centuries never once saw an 11% loan. The neutral
    // rate is not a constant: Laubach-Williams puts r* near 3.5% in the 1960s
    // and near 0.5% after 2010, and it moves on a multi-decade clock, not a
    // business cycle. So the ANCHOR wanders slowly between those two poles and
    // neutralReal reverts to wherever the anchor currently is.
    if (n.neutralAnchor === undefined) n.neutralAnchor = n.neutralReal;
    n.neutralAnchor = clamp(
      n.neutralAnchor + 0.0009 * (0.014 - n.neutralAnchor) + rrange(s, -0.00035, 0.00035),
      0.004, 0.032,
    );
    n.neutralReal = clamp(n.neutralReal + 0.004 * (n.neutralAnchor - n.neutralReal)
      + rrange(s, -0.00020, 0.00020), 0.001, 0.034);
    // Deterministic in (seed, month) rather than a draw from the shared
    // stream: consuming s.rng here would re-roll the whole century and any
    // movement in the acceptance gates would then be reshuffling rather than
    // economics. Same lesson as staff.ts.
    driftInflTarget(e, mulberry32Step((s.seed ^ (s.month * 0x2545f491)) | 0).value);

    // SUPPLY SHOCKS. An oil embargo is not a demand story: it raises prices
    // AND unemployment at once, which is the one thing a central bank cannot
    // fix with a single instrument, and it is how the seventies actually
    // happened. Rare — about one a decade — and they run for a year or two.
    //
    // AND SHOCKS COME IN CLUSTERS. 1973 and 1979 were six years apart and they
    // were the same story twice, because the conditions that produce one — a
    // cartel that has discovered its own power, a strained supply chain, a war
    // in the wrong place — do not clear in eighteen months. One shock roughly
    // trebles the odds of the next for a decade, and that clustering is the
    // difference between a bad year and a bad decade.
    if (n.shockClusterM === undefined) n.shockClusterM = 0;
    if (n.shockClusterM > 0) n.shockClusterM--;
    const shockHaz = 0.0022 + (n.shockClusterM > 0 ? 0.0050 : 0);
    if (n.shockM > 0) { n.shockM--; } else if (rng(s) < shockHaz) {
      n.shockM = Math.round(rrange(s, 10, 26));
      n.shockClusterM = Math.round(rrange(s, 60, 130));
      // SHOCKS CUT BOTH WAYS, and a model where they only ever raise prices
      // has a permanent inflationary bias built into its weather — measured,
      // it pushed the century's median loan rate to 7.4% against a real 4.2%.
      // An embargo is one kind of supply shock; a decade of cheap oil, a
      // productivity boom or a new trade route is the other, and the 1990s
      // were made of exactly that.
      // THREE KINDS OF SHOCK, and the third is the one that writes history.
      // A war or a fiscal expansion raises prices through DEMAND, and it
      // arrives attached to a government that needs to borrow — so the bank is
      // told, politely and then less politely, that this is not the moment.
      // That is not a hypothetical: the Fed was formally subordinated to the
      // Treasury until the 1951 Accord and informally through the Vietnam
      // build-out, and both of the century's real inflations happened to a
      // central bank that was not free to act. A model with no politics in it
      // can only ever produce a bank that does the right thing on time, and
      // such a bank never has an inflation to disinflate from.
      const roll = rng(s);
      if (roll < 0.30) {
        n.shockSev = rrange(s, 0.010, 0.038);
        n.pressureM = Math.round(rrange(s, 30, 96));
        pushNews(s, "warn",
          "The government has opened the spending taps and is financing it in the bond market. "
          + "The central bank has been asked — in the way these things are asked — to keep money "
          + "cheap while it does.");
      } else {
        const adverse = roll < 0.30 + 0.42;
        n.shockSev = (adverse ? 1 : -0.7) * rrange(s, 0.012, 0.055);
        pushNews(s, adverse ? "warn" : "event", adverse
          ? "A supply shock has hit the national economy — prices are rising for reasons that have "
            + "nothing to do with demand, and the central bank cannot cut its way out of this one."
          : "A favourable supply shock: input costs are falling nationally, and the central bank has "
            + "room it did not have last year.");
      }
    }
    const shock = n.shockM > 0 ? n.shockSev : 0;

    // --- THE NATIONAL BUSINESS CYCLE -----------------------------------------
    //
    // This used to be a table of four numbers keyed to the CITY's property
    // phase, hand-balanced to sum to zero over an assumed phase mix. Two things
    // were wrong with it and both mattered. It read the city, so the causation
    // ran backwards — one town's leasing decided the nation's labour market.
    // And because the phase mix is itself state-dependent (a glut forces turns;
    // slack blocks expansions), the hand-balanced weights stopped summing to
    // zero the moment the property market did anything interesting, and the
    // residual drift showed up as a 6.5% mean unemployment rate that nothing
    // chose.
    //
    // So the nation gets a cycle of its own, and the thing that ENDS an
    // expansion is the thing that ends real ones: money that has gone tight.
    // The real policy rate is the hazard. That single wire is what makes a
    // Volcker episode possible as a sequence rather than as a script —
    // inflation runs, the bank hikes past neutral, the hike causes a
    // recession, the recession opens a labour-market gap, the gap kills the
    // inflation, and the bank spends the next decade earning back its word.
    const realPolicy = n.policy / 100 - n.infl;
    if ((n.recM ?? 0) > 0) {
      n.recM = (n.recM ?? 0) - 1;
      if (n.recM === 0) {
        n.expM = 0; n.deep = false;
        pushNews(s, "event", "The national recession is over on paper. Nobody in the room feels it yet.");
      }
    } else {
      n.expM = (n.expM ?? 0) + 1;
      // One recession about every six years at neutral money — the post-war
      // average is 12 in 75 years — and far more often when the real policy
      // rate is punitive. At Volcker's ten points of real money the hazard is
      // better than one in ten a month, which is why 1980 and 1981-82 were two
      // recessions inside three years.
      const haz = 0.0095
        + clamp((realPolicy - 0.022) * 0.70, 0, 0.09)
        + (shock > 0.02 ? 0.010 : 0)
        + ((n.expM ?? 0) > 110 ? 0.004 : 0);
      if (rng(s) < haz) {
        // Most downturns are downturns. About one in fourteen is 1929 or 2008,
        // and those are the ones that redraw a career.
        n.deep = rng(s) < 0.07;
        n.recM = Math.round(n.deep ? rrange(s, 26, 48) : rrange(s, 7, 19));
        // EVERY RECESSION IS AIMED, not integrated. A rate of rise applied for
        // a drawn duration compounds two dice into a third, and a long draw and
        // a fast draw together produced 27 points of unemployment — the model
        // pinned against its own ceiling for years at a time, which then held
        // the Phillips term negative and the policy rate on the floor for a
        // quarter of the century. A downturn has a depth, and the labour market
        // approaches it and decelerates into it, the way a real one does.
        n.uPeak = clamp(n.unemp + (n.deep ? rrange(s, 0.045, 0.135) : rrange(s, 0.016, 0.042)),
          0.03, 0.26);
        pushNews(s, "warn", n.deep
          ? "The country has fallen off a cliff. This is not a soft patch — payrolls are "
            + "collapsing nationally and nobody can say where the bottom is."
          : "The national economy has turned. The recession call is official and everyone "
            + "is revising their numbers down.");
      }
    }
    const inRec = (n.recM ?? 0) > 0;

    // UNEMPLOYMENT RISES LIKE A ROCKET AND FALLS LIKE A FEATHER. That asymmetry
    // is the single most robust fact about the series — 5% to 10% in twenty
    // months in 2008, then ten years to walk back down — and a symmetric
    // mean-reverting process cannot produce it. Firms fire in weeks and hire
    // over years.
    const uMove = inRec
      ? Math.max(0.0008, 0.115 * ((n.uPeak ?? n.unemp + 0.02) - n.unemp))
      : 0.025 * (0.042 - n.unemp);
    n.unemp = clamp(n.unemp + uMove
      + 0.004 * ((e.unemployment ?? 0.055) - n.unemp)   // one city, one per cent of a nation
      + (shock > 0.02 ? 0.0006 : 0) + rrange(s, -0.0007, 0.0007), 0.026, 0.26);

    // National inflation: expectations, plus a Phillips term, plus the shock.
    // THE PHILLIPS CURVE IS CONVEX. Slack disinflates weakly — you cannot get
    // prices to fall much no matter how bad it gets, which is why the 2010s had
    // 8% unemployment and 1.5% inflation instead of the deflation the linear
    // version predicts — while a labour market past full employment bids pay up
    // at an accelerating rate. A straight line through the origin gets both
    // ends wrong.
    const uStar = 0.048;
    const nGap = uStar - n.unemp;
    const phillips = nGap > 0 ? 0.38 * nGap + 4.5 * nGap * nGap : 0.20 * nGap;
    // AND MONEY ITSELF IS A CHANNEL. A labour-market gap of a point or two can
    // move inflation by a point or two; it cannot produce 14.8%, and a model
    // whose only inflationary force is the Phillips curve can never leave the
    // 1-3% band no matter how badly the bank behaves. What produced the Great
    // Inflation was a decade of NEGATIVE REAL RATES — money cheaper than the
    // return on capital, sustained, until everyone stopped believing it would
    // ever be otherwise. easeEma is how far below neutral the bank has been
    // holding, smoothed over about four years, and it is the wire that lets a
    // policy MISTAKE compound into a regime instead of washing out next month.
    if (n.easeEma === undefined) n.easeEma = 0;
    n.easeEma += 0.026 * ((n.neutralReal - realPolicy) - n.easeEma);
    const easy = 0.55 * clamp(n.easeEma, -0.05, 0.10);
    n.infl = clamp(n.inflExp + phillips + easy + shock + rrange(s, -0.004, 0.004), -0.06, 0.22);

    // EXPECTATIONS UNANCHOR WHEN THE BANK IS NOT BELIEVED — and that is what
    // makes an inflation a decade rather than a year. Credibility is spent in
    // proportion to the miss, not by a flat penalty: a bank running 3% over is
    // in trouble, and a bank running 8% over is not in three times the trouble,
    // it is in a different job. It is earned back slowly, and faster when the
    // bank is visibly holding real rates high into a disinflation — that is the
    // whole of what Volcker actually bought with 10.8% unemployment.
    const miss = n.infl - 0.02;
    const am = Math.abs(miss);
    n.credibility = clamp(
      n.credibility + (am < 0.010
        ? 0.0020 + (realPolicy > 0.03 ? 0.0022 : 0)
        : -0.0018 - 0.110 * (am - 0.010)),
      0.10, 0.99);
    // A believed bank's anchor beats the pass-through and expectations sit at
    // target; a disbelieved one's does not, and then last year's inflation
    // becomes next year's baseline. Those two regimes are the Great Moderation
    // and the Great Inflation, and the same four lines produce both.
    const anchorPull = 0.004 + 0.030 * n.credibility;
    n.inflExp = clamp(
      n.inflExp + (1 - 0.70 * n.credibility) * 0.055 * (n.infl - n.inflExp)
        - anchorPull * (n.inflExp - 0.02),
      -0.005, 0.16);

    // THE REACTION FUNCTION — the classic Taylor rule, and it reproduces the
    // history. At 2% inflation and full employment it wants 4%, which is the
    // post-war average. At Volcker's 14.8% inflation and 7% unemployment it
    // wants 21.7%, and he set 20%. At 1% inflation and 10% unemployment it
    // wants MINUS two per cent, which is precisely why 2009 ended at the zero
    // bound with the bank out of room and reaching for other tools.
    // AND THE BANK IS NOT CLAIRVOYANT. It sets policy against what it believes
    // TREND inflation to be — a smoothed reading, published with a lag — and it
    // deliberately looks through a supply shock, because raising rates into an
    // embargo means deepening a recession you did not cause. Both of those are
    // correct practice most of the time and both of them are exactly how a bank
    // ends up behind the curve: 1972-79 was not a bank that wanted inflation,
    // it was a bank that kept calling it transitory. This is the one line that
    // lets the model make that mistake, and therefore the one line that makes
    // the disinflation afterwards mean anything.
    if (n.inflSm === undefined) n.inflSm = n.infl;
    n.inflSm += 0.085 * (n.infl - n.inflSm);
    const seen = n.inflSm - 0.45 * shock;

    // AND IT DOES NOT KNOW WHERE FULL EMPLOYMENT IS. This is not a detail; it
    // is the largest single source of policy error in the historical record.
    // Through the late 1960s and 1970s the Federal Reserve believed the natural
    // rate of unemployment was around 4% when it had risen to nearly 6%, so it
    // read a slack labour market where there was a tight one and held money too
    // easy for a decade — the Orphanides result, and the best explanation
    // anyone has for why competent people produced the Great Inflation. The
    // belief drifts on a decade-plus clock, it is wrong in both directions, and
    // it LEARNS: a bank that has been running hot revises its estimate up,
    // which is what finally ended the mistake in the early eighties.
    if (n.uStarBelief === undefined) n.uStarBelief = uStar;
    n.uStarBelief = clamp(
      n.uStarBelief + 0.006 * (uStar - n.uStarBelief)
        + 0.011 * clamp(n.inflSm - 0.02, -0.012, 0.045)
        + rrange(s, -0.0018, 0.0018),
      0.028, 0.075);

    const okunGap = -2.0 * (n.unemp - n.uStarBelief);
    // The level term reads what the bank BELIEVES trend inflation to be, not
    // what it is. A rule fed spot inflation prices the real rate correctly
    // every month by construction, and a bank that can never be behind the
    // curve can never produce an inflation — which is exactly what the first
    // cut of this block did: credibility sat at 0.99 for four hundred years.
    // THE VOLCKER PREMIUM. A bank whose word is worth nothing cannot disinflate
    // at the rule's prescription, because the rule prices the real rate off
    // expectations and its expectations are the thing that is broken. It has to
    // OVERSHOOT — visibly, painfully, for long enough that the overshoot is the
    // message. Volcker ran real short rates near eight per cent and took 10.8%
    // unemployment for it, and that is the only reason the 1980s were not the
    // 1970s again. Without this term the model can enter a Great Inflation and
    // has no way out of one except waiting.
    const restore = n.credibility < 0.55 && seen > 0.045
      ? (0.55 - n.credibility) * 10.5 : 0;
    // ...against the target the bank actually holds, which drifts. See
    // regime.ts: 0.02 was written here as a constant and it is the reason a
    // century could not contain two different monetary worlds.
    const tgt = n.inflTarget ?? 0.02;
    const want = 100 * (n.neutralReal + seen + 0.5 * (seen - tgt) + 0.5 * okunGap) + restore;
    // Gradualism, except when it is not: a bank moves in quarter points at
    // eight meetings a year, and in three-quarter points when it is frightened.
    const dist = Math.abs(want - n.policy);
    let speed = dist > 7 ? 0.21 : dist > 4 ? 0.16 : dist > 1.5 ? 0.10 : 0.055;
    // ...unless it is not free to move. Under fiscal pressure the bank can
    // still cut freely and can barely tighten, which is the whole asymmetry
    // and the whole mechanism: money stays cheap into a real inflation, the
    // ease compounds through expectations, and when the pressure finally lifts
    // the bank has to break the labour market to undo it.
    if (n.pressureM === undefined) n.pressureM = 0;
    if (n.pressureM > 0) {
      n.pressureM--;
      if (want > n.policy) speed *= 0.22;
      if (n.pressureM === 0) {
        pushNews(s, "event",
          "The central bank has its independence back. Whatever it does next, it is doing on its "
          + "own account — and it has a great deal of ground to make up.");
      }
    }
    n.policy = Math.max(0.25, n.policy + speed * (want - n.policy));

    // THE LOAN INDEX IS THE POLICY RATE PLUS A TERM PREMIUM. What a borrower
    // pays was never the central bank's rate; it is that rate plus what the
    // market charges for time and for risk — and that premium WIDENS when
    // credit is frightened, which is why spreads blow out in a crisis even as
    // the policy rate is being cut.
    const termPrem = 1.55 + 1.85 * Math.max(0, 1 - (e.creditIdx ?? 1));
    e.indexRate = clamp(
      e.indexRate + 0.13 * (n.policy + termPrem - e.indexRate) + rrange(s, -0.07, 0.07),
      RATE_FLOOR, RATE_CEIL,
    );
    // the era, for anything that still reads it — now an OUTPUT of the nation
    e.rateRegime = clamp(n.policy + termPrem, RATE_FLOOR, RATE_CEIL);
  }

  // (retired) THE OLD CITY-LEVEL POLICY RATE read the CITY's unemployment, so
  // a player who wrecked his own city was handed a rate cut for it. The nation
  // sets the price of money now; see the block above.

  // cycle deviation drifts with phase, spring-loaded toward its bounds
  e.cycleDev = clamp(e.cycleDev + c2.devDrift + rrange(s, -0.03, 0.03), -1, 1);

  // --- capital availability -------------------------------------------------
  // Money is not a smooth function of the policy rate. It leaves the room in a
  // downturn and comes back late, and that lag is where the bargains are.
  // ...and a national recession closes it further than a local one, because the
  // balance sheet that has to absorb the loss is the same balance sheet in
  // every city at once.
  const creditTarget = clamp((e.phase === "expansion" ? 1.12 : e.phase === "peak" ? 1.0
    : e.phase === "recession" ? 0.54 : 0.88)
    - ((e.nat?.recM ?? 0) > 0 ? (e.nat?.deep ? 0.26 : 0.13) : 0), 0.4, 1.25);
  const creditSpeed = creditTarget < e.creditIdx ? 0.16 : 0.055;   // slams shut, reopens slowly
  e.creditIdx = clamp(e.creditIdx + creditSpeed * (creditTarget - e.creditIdx) + rrange(s, -0.012, 0.012), 0.4, 1.25);
  if (e.creditIdx < 0.66 && rng(s) < 0.02) {
    pushNews(s, "warn", "The debt markets have effectively closed. Term sheets are being pulled mid-deal.");
  }

  // --- employment: the demand behind every lease -----------------------------
  const jobDrift = e.phase === "expansion" ? 0.0026 : e.phase === "peak" ? 0.0008
    : e.phase === "recession" ? -0.0031 : 0.0015;
  // THE RETURN WIRE. Jobs drove rents and rents drove nothing back, so the
  // causal graph had a dead end where its most important feedback belongs: a
  // city that becomes ruinously expensive relative to what it pays its
  // workers LOSES employers, and a city with cheap space wins them. That is
  // the mechanism by which an overbuilt city eventually recovers (empty space
  // is cheap space, cheap space attracts firms, firms fill the space) and by
  // which an expensive one stagnates. Without it, "the rent is too high" was
  // a fact about the player's spreadsheet and about nothing else in the world.
  const incomeNow = Math.max(0.35, e.wageIdx ?? 1);
  const costOfSpace = (e.rentIdx.office / RENT_BASE.office) / incomeNow;
  // ...AND THE RETURN WIRE SATURATED, WHICH IS THE SAME BUG THE GLUT SIDE OF
  // THE RENT TERM ALREADY HAD.
  //
  // This was clamped at -0.0013/month. Rent-to-income reaches that rail at
  // about 1.6x, and every further point of expensiveness then cost the city
  // nothing: a town at 2.1x shed employers no faster than one at 1.6x, so the
  // brake stopped braking exactly where it was needed. Measured over sixteen
  // seeds, that is precisely where rents ended up — beating the wages that pay
  // them by 0.94pp a year, forever, with the anchor pinned and unable to
  // answer. `sim:accept` F is that number.
  //
  // Leaving a city because the rent is impossible is not a linear decision. A
  // firm paying twenty per cent over what it can afford negotiates; one paying
  // double does not renew, and neither does the firm that would have moved in.
  // Superlinear on the expensive side, and no rail — the same shape, and for
  // the same reason, as the capitulation term in the rent block above.
  //
  // The cheap side keeps its cap: empty space is genuinely a magnet, but a
  // town cannot hire faster than it can find people, and that ceiling is real.
  // ...AND A CITY CANNOT EMPTY OUT AT ANY SPEED IT LIKES.
  //
  // The first cut of this removed the rail entirely and was three to five times
  // too hot: at rent-to-income 1.8x it ran -6.5%/yr, and compounded, so a town
  // shed 37,000 jobs — 24% of its employment — in five years. Rents then
  // collapsed 191 to 31 behind it, occupancy went to 15%, and it killed an
  // ALL-CASH owner, which is not something a market is able to do to somebody
  // with no debt. Measured in the tournament: the safest posture in the game
  // went from $116.8M real with zero wipeouts to -$14.6M with three.
  //
  // Firms cannot leave that fast and neither can people. A lease has a term, a
  // relocation costs money and takes a year to plan, and the staff have houses.
  // The worst year any large metro has ever had is about four per cent, and
  // that is a floor on the RATE, not on the pressure — the term still grows
  // with the overshoot right through the range any real city occupies, and
  // only meets the rail past 2.2x, which is past anywhere that has existed.
  //
  //   1.5x rent-to-income  ->  -1.2%/yr   an expensive city, losing a little
  //   2.0x                 ->  -3.3%/yr   a city genuinely hollowing out
  //   3.0x                 ->  -4.1%/yr   the rail: nobody leaves faster
  // AND THE CHEAP SIDE IS CONSTRAINED BY PEOPLE, NOT BY A NUMBER.
  //
  // Fixing the expensive side left the cheap one saturating in exactly the way
  // I had just condemned: a flat +0.0016/month cap, applied at full strength
  // for as long as space stayed cheap, regardless of whether the city had
  // anybody left to hire. Traced through H's glut: rents collapse 78 to 31,
  // the pull pins at its cap and holds there, and the town absorbs the shock
  // in under two years — city unemployment at 2.0%, which is its own floor,
  // and fifteen thousand JOBS ADDED while 37% of the offices stand empty.
  //
  // Cheap space really does attract employers; that is the mechanism that ends
  // a glut and it stays. What it cannot do is conjure workers. A city at full
  // employment absorbs firms at the rate it can staff them, which is why a
  // boom in a tight labour market shows up as wages rather than as headcount.
  // So the pull is gated on the slack that actually exists — full strength
  // with people to spare, and nothing at all against the unemployment floor.
  const slack = clamp((((e.unemployment ?? 0.055) - 0.018) / 0.04), 0, 1);
  const overCost = Math.max(0, costOfSpace - 1);
  // AND THE CHEAP SIDE IS FAR SMALLER THAN THE DEAR SIDE, because leaving is
  // easier than arriving.
  //
  // This ran at (1 - costOfSpace) * 0.0022 capped at 0.0016/month — up to
  // 1.9%/yr of employment growth, sustained, purely because rents were low.
  // That is a whole city's trend growth rate arriving from a property glut,
  // and it inverted the macro loop: a glut cut rents, cheap rents pulled firms
  // in, employment rose, the labour market tightened, and the CENTRAL BANK
  // RAISED INTO A PROPERTY BUST.
  //
  // Measured through sim:accept H over 30 seeds: glut-attributable drift in
  // the loan index of +0.79pp against a +0.50 bar, of which the term premium
  // accounted for -0.06pp and the policy rate for +1.24pp. The spread was
  // innocent; the rate was doing it, and this is why.
  //
  // Two things are wrong with the old number and only one of them is size.
  //
  // SIZE: rent is roughly 7% of an office employer's cost base, so even a 50%
  // rent collapse is a ~3.5% saving on total costs. The employment response to
  // that is a few tenths of a per cent a year, not two per cent.
  //
  // SHAPE: relocation is ASYMMETRIC and well documented as such. A firm priced
  // out of a city leaves on its own schedule; a firm tempted by cheap space
  // has to want to be here for other reasons first, and mostly does not move
  // at all. So the dear side keeps its magnitude and the cheap side gets about
  // a fifth of it. Cheap space still ends a glut — that mechanism is real and
  // stays — it just no longer ends it by turning a bust into a hiring boom.
  //
  // Houston in the 1980s and New York in the early 1990s both had office
  // gluts AND job losses. Nowhere has had a glut-driven employment boom.
  const spacePull = costOfSpace <= 1
    ? clamp((1 - costOfSpace) * 0.0005, 0, 0.00035) * slack
    : Math.max(-0.0035, -(overCost * 0.0012 + overCost * overCost * 0.0016));
  // A national recession costs this city jobs whether or not the local property
  // cycle has caught up to it yet — payrolls are cut at head office.
  const natPull = (e.nat?.recM ?? 0) > 0 ? (e.nat?.deep ? -0.0026 : -0.0013) : 0.0002;
  // ...AND THE PAYROLL A TRADE TAKES WITH IT WHEN IT GOES, or brings when it
  // arrives. This is the only place a level event touches the aggregate
  // economy, and it is the one that has to exist: without it a trade could
  // leave town and the unemployment rate, migration, wages and the price level
  // would never hear about it. Everything downstream — population following
  // work, housing demand following population, the Phillips term — is the
  // machinery that was already here, answering a shock it can now see.
  // Zero in every month in which no level event is currently landing.
  const swanPull = e.swanJobDrift ?? 0;
  e.employIdx = clamp(
    e.employIdx * (1 + jobDrift + spacePull + natPull + swanPull + rrange(s, -0.0012, 0.0012)), 0.55, 12);

  // --- THE CITY UNDERNEATH THE PROPERTY MARKET -------------------------------
  //
  // Everything above this line is a property cycle. This is the economy it sits
  // on, and every number here is a consequence of the employment index rather
  // than a second simulation running beside it: the point is legibility, not
  // more dice. What it buys is the question every real investor asks first and
  // this game could not answer — is this town growing?
  {
    if (e.population === undefined) {
      e.population = e.pop0 ?? 240_000; e.jobs = e.jobs0 ?? 132_000; e.unemployment = OPENING_UNEMP;
      e.wageIdx = 1; e.outputIdx = 1; e.cpi = 1;
    }
    const prevJobs = e.jobs!;
    // BUILDING IS A JOB, and it was the one job in this city nobody had.
    //
    // Jobs tracked the employment index and nothing else, so the construction
    // industry — the most violently cyclical employer in any real city, and
    // the one this entire game is about commissioning — did not exist as
    // employment. A town could stop building altogether and its labour market
    // would not notice. That is why `sim:accept` H could drop four million
    // square feet of empty office on the city, collapse the rent index from 78
    // to 31, and watch the place ADD fifteen thousand jobs: the only wire from
    // property to payroll was "empty space is cheap space, cheap space
    // attracts firms", which is true and is half the story. The other half is
    // that the crash which produced the empty space put the trades out of work.
    //
    // It is a LEVEL, not a trend. When the cranes stop those jobs are gone;
    // they do not keep going away every month afterwards, and they come back
    // when the cranes do. So it multiplies the index rather than drifting it.
    //
    // Sized on the real thing: construction runs about 5% of employment in a
    // city of this kind, and it is the share that halves in a bust. At the
    // reference pipeline the term is exactly 1.0, so nothing about the
    // existing calibration moves; a full stop costs 4.8% of the city's jobs,
    // which is the order of what 2008-2011 actually did to it.
    let pipeSf = 0, stockSf = 0;
    for (const k of BUILT_CLASSES) {
      pipeSf += e.pipeline?.[k] ?? 0;
      stockSf += e.stock?.[k] ?? 0;
    }
    const pipeShare = stockSf > 0 ? pipeSf / stockSf : REF_PIPE_SHARE;
    const trades = clamp(CONSTRUCTION_JOB_SHARE * (pipeShare / REF_PIPE_SHARE), 0, 0.11);
    e.jobs = Math.round((e.jobs0 ?? 132_000) * e.employIdx * (1 - CONSTRUCTION_JOB_SHARE + trades));
    const jobGrowth = prevJobs > 0 ? e.jobs / prevJobs - 1 : 0;

    // UNEMPLOYMENT IS A LAGGING NUMBER and a sticky one. The labour force does
    // not shrink the month the jobs go; people look for work for a year before
    // they leave town, which is why a bust shows up in the unemployment rate
    // long after it has shown up in the rents.
    // The participation rate is 0.58 and not 0.62 for a reason that only
    // became visible once anything READ unemployment: at 0.62 the opening
    // state describes 240,000 people, 148,800 of them in the labour force and
    // 132,000 jobs — an 11.3% unemployment rate, while the same object
    // initialises `unemployment: 0.052`. The city was born with a number that
    // contradicted its own population. 0.58 makes the opening state true.
    const labourForce = e.population! * PARTICIPATION;
    const slackTarget = clamp(1 - e.jobs / Math.max(1, labourForce), 0.018, 0.24);
    e.unemployment = clamp(e.unemployment! + 0.18 * (slackTarget - e.unemployment!), 0.015, 0.26);

    // POPULATION FOLLOWS WORK, slowly and asymmetrically. People move to a
    // boom within a couple of years; they leave a bust over a decade, because
    // leaving means selling a house and telling your family. That asymmetry is
    // why cities hollow out rather than empty.
    //
    // AND MIGRATION ANSWERS THE LABOUR MARKET, which is the loop that was
    // missing. Population carried an unconditional +0.42%/yr while jobs
    // carried nothing of the sort, so the city accumulated permanent
    // unemployment: measured over fifty years, 240k people and 132k jobs
    // became 364k people and 160k jobs — a 24% unemployment rate nobody chose
    // and nothing corrected. It was invisible while unemployment was a
    // read-out; the moment prices and the policy rate began reading it, the
    // whole economy deflated into its floor. People do not move to a city
    // with no work, and they leave one that has run out — that is what keeps
    // a labour market anchored, and it is now in the model.
    const pull = jobGrowth > 0 ? 0.35 : 0.09;
    const uGapPop = e.unemployment! - 0.055;
    let migration = jobGrowth * pull - clamp(uGapPop * 0.020, -0.0010, 0.0030);

    // ...AND PEOPLE CANNOT MOVE INTO HOUSING THAT DOES NOT EXIST.
    //
    // This read the labour market and nothing else, so the city admitted
    // everyone the jobs attracted regardless of whether there was a flat for
    // them. Measured over sixty years on the shipped island: population +86%
    // against a housing stock of +40%, housing per head down from 106 to 73 sf,
    // multifamily vacancy driven through its frictional floor and PINNED at
    // 1.35% for fifty of those sixty years, and real housing rent up 3.3x. A
    // variable resting on its rail in normal play is the rail holding up the
    // model — and since land is the residual after construction cost, rents
    // that compound like that are what detonate land prices. This is the third
    // and last mechanism behind that.
    //
    // The constraint is real and it is one-sided. A town with no empty flats
    // does not stop being attractive; it stops being ENTERABLE, and the people
    // who would have come go somewhere else or double up. So in-migration is
    // choked as vacancy approaches the frictional floor and is untouched when
    // there is slack. Out-migration is NOT gated: nothing about a housing
    // shortage keeps anybody from leaving.
    //
    // It is also the loop that closes the system. Scarce housing slows the
    // inflow, which lets the builders catch up, which lifts vacancy off the
    // floor, which stops rent compounding — without anybody being told to stop
    // it. Widening crewCapacity alone did not do this: more housing simply let
    // more people in and the vacancy stayed on the rail.
    if (migration > 0) {
      const floor = NATURAL_VAC.multifamily * 0.30;         // the frictional rail in tickSpace
      const slack = clamp(((e.cityVac?.multifamily ?? NATURAL_VAC.multifamily) - floor)
        / Math.max(1e-6, NATURAL_VAC.multifamily - floor), 0, 1);
      // At the floor a fifth of the inflow still arrives — people do double up,
      // convert lofts and take the spare room, and a city with no vacancy has
      // never had literally zero net in-migration.
      migration *= 0.20 + 0.80 * slack;
    }
    // THE BOUNDS ARE A SHARE OF THIS TOWN, NOT A NUMBER OF PEOPLE, and that
    // distinction was load-bearing the moment the town's size stopped being a
    // constant. This read `clamp(…, 60_000, 4_000_000)`. The old hardcoded
    // opening population was 240,000, so the floor sat a long way below and
    // never bound — it was a guard. Deriving the population from the buildings
    // actually standing put the standard island at 43,735, i.e. BELOW ITS OWN
    // FLOOR: population pinned at 60,000 against 24,000 jobs, the labour force
    // came out at 34,800, slack railed at its 24% ceiling, and the Phillips
    // term died. Measured, that alone took the fifty-year price level from
    // 2.015 to 1.147 — three quarters of the city's inflation, removed by a
    // clamp nobody had looked at, in a change that was supposed to be neutral.
    //
    // A city can lose three quarters of its people over a century — Detroit
    // did — and it can grow many times over. What it cannot do is go to zero,
    // and that is all a bound here is for.
    const popFloor = Math.max(1_000, (e.pop0 ?? 240_000) * 0.25);
    const popCeil = Math.max(popFloor * 4, (e.pop0 ?? 240_000) * 16);
    e.population = Math.round(clamp(e.population! * (1 + 0.00016 + migration), popFloor, popCeil));

    // --- THE WAGE-PRICE SYSTEM ---------------------------------------------
    //
    // This block used to be two scripted drifts, and between them they were
    // the single largest lie in the game. Wages compounded at 0.42% a year
    // NOMINAL while the price level ran at 1.94%, so the workers of this city
    // got 60% poorer in real terms over a campaign — and rents, which are
    // paid out of exactly those wages, tripled in real terms at the same time.
    // Measured across three fifty-year runs: rent-to-income rose 9.87x. That
    // is not a property market, it is two spreadsheets that never met, and it
    // is the whole reason office rents reached $1,000/sf by 2050.
    //
    // So prices and wages are one system now, with the three parts a real one
    // has: EXPECTATIONS (what everybody assumes next year looks like, which
    // is what makes an inflation persistent), a PHILLIPS term (a tight labour
    // market bids pay up and pay pushes prices), and a COST-PUSH term (what
    // the builders and the utilities are charging). Slack damps all of it.
    // Nothing here is scripted to a phase; the phase is downstream.
    if (e.inflExp === undefined) e.inflExp = 0.02;
    const tight = 0.055 - e.unemployment!;
    // realised inflation over the trailing year, straight off the history the
    // engine already keeps — expectations chase THIS, not a constant
    const h12 = e.history.length >= 12 ? e.history[e.history.length - 12] : undefined;
    const infl12 = h12?.cpi ? e.cpi! / h12.cpi - 1 : e.inflExp;
    const cost12 = h12 && (h12 as { costIdx?: number }).costIdx
      ? e.costIdx / (h12 as { costIdx?: number }).costIdx! - 1 : e.inflExp;
    // Prices: what everyone expects, plus what the labour market is doing to
    // pay, plus what materials are doing — with slack pulling all three down.
    // ...and a city does not have its own price level. Rent, wages and the
    // cost of a haircut in this town are dominated by what is happening to
    // prices nationally; the local labour market only makes it a little
    // hotter or a little colder than the country. Without this link the city
    // could sit at 2% while the nation ran at 14%, which is not a thing that
    // has ever happened to anywhere.
    const natInfl = e.nat?.infl ?? e.inflExp;
    const inflM = (0.72 * natInfl + 0.28 * e.inflExp) / 12
      + tight * 0.014 + 0.14 * (cost12 - e.inflExp) / 12;
    e.cpi = clamp(e.cpi! * (1 + clamp(inflM, -0.0035, 0.0115)), 0.8, 400);
    // ...and expectations follow realised inflation slowly. This is the anchor
    // that keeps the spiral from either exploding or dying: fast enough that a
    // decade of 6% becomes the new normal, slow enough that one bad year is
    // not a regime.
    e.inflExp = clamp(e.inflExp + 0.020 * (infl12 - e.inflExp), -0.008, 0.14);

    // WAGES ARE NOMINAL AND THEY TRACK PRICES. A worker whose pay does not
    // move with the price level is a worker who cannot pay next year's rent —
    // which is precisely the state this city was in. Expected inflation, plus
    // real productivity growth (where a century of genuine compounding
    // actually comes from), plus what a tight or slack labour market does on
    // top. Real wage growth therefore lands near productivity, which is the
    // number a real economy delivers.
    // PRODUCTIVITY IS NOT A CONSTANT, AND WHILE IT WAS ONE IT WAS A FLOOR
    // UNDER REAL WAGES THAT NO REAL ECONOMY HAS.
    //
    // This was a flat 0.011 — 1.1%/yr real, forever, in every month of every
    // run. Since expectations track realised inflation closely, real wage
    // growth reduces to roughly PRODUCTIVITY + tight*0.012, which at 9%
    // unemployment still comes out around +0.6%/yr. Real wages could only
    // fall when inflation SURPRISED expectations, and expectations reset at
    // 2%/month, so the fall was always brief and always shallow.
    //
    // MEASURED over 12 seeds x 50 years, 7,188 months: the nominal wage index
    // fell in 0.0% of them — not once — and the worst twelve-month real wage
    // change in any run was -3.35%. The nominal figure is defensible and
    // should stay near zero: downward nominal wage rigidity is one of the most
    // robust findings in macro and aggregate nominal wages essentially never
    // fall. The real figure is not. US real average hourly earnings fell about
    // 2.8% in 2022 alone, and real wages fell for three consecutive years
    // through 1979-81 for a cumulative loss near 7%.
    //
    // What actually varies is productivity, on two timescales, and both are
    // measured facts rather than shape parameters:
    //
    // BY ERA. US labour productivity grew ~2.8%/yr in 1947-73, ~1.4% in
    // 1973-95, ~2.9% in 1995-2004 and ~1.3% since. That is a 2-point spread
    // between regimes that each lasted twenty years, and it is the single
    // largest fact about why one generation got richer faster than the next.
    // Modelled as a slow wave keyed on the seed and the month so a run passes
    // through regimes without needing a new field on the save — a productivity
    // era is not a decision anybody makes, so it does not need to be stored,
    // only to be the same every time this town is rebuilt.
    //
    // BY CYCLE. Productivity is procyclical, and the mechanism is labour
    // hoarding: firms carry staff they cannot use into a downturn, so output
    // per worker falls first and rebounds hard in the recovery. 2022 was
    // -1.7%, the worst since 1947. That is where a genuinely negative
    // productivity year comes from, and with it a real wage that gives back
    // ground rather than merely growing more slowly.
    // THE SPREAD IS THE NEW FACT. THE CENTRE WAS ALREADY CALIBRATED.
    //
    // First attempt centred this at 2.05%/yr, reading the era figures above as
    // the thing to average. That was wrong and it broke the economy: real wage
    // growth went to 2.78%/yr against a 0.0-2.5 band and dragged all four rent
    // classes out with it (+1.86 office to +2.59 retail, against a -1.0/+1.5
    // band). Raw productivity and real COMPENSATION are not the same series —
    // they have diverged since the 1970s, which is the productivity-pay gap —
    // and 1.1% was the figure this whole economy was balanced against.
    //
    // So the centre stays exactly where it was and only the variation is new.
    // The amplitude is the measured era spread: roughly +/-0.8 points between
    // the 1.3-1.4%/yr regimes and the 2.8-2.9% ones.
    const PRODUCTIVITY = 0.011;    // ~1.1%/yr real, the long-run US figure
    const prodEra = PRODUCTIVITY + 0.0075 * Math.sin(
      (s.seed % 1000) / 159.1549 + s.month / 47.75,   // ~25-year regimes, seeded phase
    );
    // Labour hoarding: firms carry staff they cannot use into a downturn, so
    // output per worker falls first and rebounds in the recovery.
    //
    // KEYED ON THE RECESSION, NOT ON SLACK, and the first version got that
    // wrong in a way worth recording. It read `tight * 0.55` — the same
    // tightness the Phillips term below already uses at `tight * 0.012` — so
    // the two were the same signal counted twice, and because `tight` is
    // `0.055 - unemployment` against a city that averages below 5.5%, its mean
    // is POSITIVE. A term meant to add cyclical texture was quietly adding
    // about 0.275%/yr of permanent trend: real wage growth went 1.18% to
    // 1.71%/yr and industrial real rent to +1.81% against a +1.5 band. That is
    // a fake number nobody typed — it arrived as the mean of a term that was
    // supposed to average out.
    //
    // A recession is an EVENT, so keying on it is mean-negative by
    // construction and cannot smuggle in a trend. It is also the honest read:
    // 2022's -1.7% was a labour-hoarding year, not a slack-labour-market year.
    const hoarding = -((e.nat?.recM ?? 0) > 0 ? (e.nat?.deep ? 0.021 : 0.011) : 0);
    const productivity = clamp(prodEra + hoarding, -0.028, 0.042);
    // AND NOMINAL PAY DOES NOT GET CUT. It gets FROZEN, and inflation does the
    // rest — which is the whole reason real wages fall while nominal ones do
    // not, and the mechanism behind 1974-75 and 2021-22 alike.
    //
    // Downward nominal wage rigidity is one of the most heavily evidenced
    // facts in labour economics: the distribution of annual nominal wage
    // changes has a large spike sitting exactly at zero and almost no mass
    // below it (Card & Hyslop; Kahn). Flooring the growth factor at zero
    // reproduces that spike rather than approximating it.
    //
    // It also has to be here rather than left to the arithmetic. Letting
    // productivity vary made the nominal index fall in 4.00% of twelve-month
    // windows, worst -2.22% — a quarter of a century of runs producing an
    // outright cut in average pay, which does not happen to real economies.
    // With the floor the same variation lands entirely on the real wage, which
    // is where it belongs and where it was missing.
    // ...AND THE FREEZE IS PAID FOR LATER, WHICH IS WHAT MAKES IT RIGIDITY
    // RATHER THAN A SUBSIDY.
    //
    // Flooring alone truncates the bottom of a noisy series and keeps the top,
    // so it RAISES the mean — measured, trend real wage growth went from
    // 1.18%/yr to 1.71% and industrial real rent to +1.77% against a +1.5
    // band, purely as an artefact of the clamp. That is a fake number arriving
    // through the back door: nobody typed it, and it was still a thumb on the
    // scale.
    //
    // Pent-up wage deflation is the real mechanism and it fixes the bias
    // mechanically. The cut a firm could not make is not forgiven, it is owed:
    // the shortfall accumulates and is worked off by under-granting later
    // raises. Pay plateaus for years instead of ratcheting, which is the shape
    // rigidity actually has, and the trend ends up where it would have been.
    //
    // It is worked off at 12%/month rather than instantly, because a firm that
    // has frozen pay through a bad year does not claw it all back in the first
    // good month — it grants a thin raise for a while, which is the observed
    // pattern after every freeze.
    const growth = e.inflExp / 12 + productivity / 12 + tight * 0.012 + rrange(s, -0.0004, 0.0004);
    if (e.wageDebt === undefined) e.wageDebt = 0;
    if (growth < 0) {
      e.wageDebt -= growth;          // the cut nobody took, owed
      e.wageIdx = clamp(e.wageIdx!, 0.7, 400);   // frozen: no cut, no rise
    } else {
      // Later raises are thinned until the debt is worked off.
      const repay = Math.min(e.wageDebt, growth * 0.12 + 0.00008);
      e.wageDebt -= repay;
      e.wageIdx = clamp(e.wageIdx! * (1 + growth - repay), 0.7, 400);
    }
    e.wageDebt = clamp(e.wageDebt, 0, 0.25);

    // Output is what the place makes: people working, times what each of them
    // produces. It is the broadest number in the game and the slowest to move.
    e.outputIdx = +((e.jobs / (e.jobs0 ?? 132_000)) * e.wageIdx!).toFixed(4);
  }

  // --- each class runs its own cycle -----------------------------------------
  // This used to be an AR(1) walk with a +/-0.02 cap and noise so small that
  // its stationary spread was about a tenth of that: sectorMom sat near zero
  // for a century and the four classes moved as one market wearing four
  // labels. Now every class carries an explicit boom / steady / bust clock,
  // long enough to live through and independent of its neighbours, so office
  // can be three years into a bust while apartments are booming — which is the
  // ordinary condition of a real property market, not an exotic one.
  if (!e.sectorPhase) {
    e.sectorPhase = { office: "steady", retail: "steady", multifamily: "steady", industrial: "steady" };
    e.sectorPhaseM = { office: 0, retail: 0, multifamily: 0, industrial: 0 };
    for (const k of BUILT_CLASSES) e.sectorPhaseM[k] = Math.round(rrange(s, 8, 60));
  }
  const SECTOR_AIM = { boom: 0.0125, steady: 0, bust: -0.0115 };
  for (const k of BUILT_CLASSES) {
    if ((e.sectorPhaseM![k] -= 1) <= 0) {
      const cur = e.sectorPhase![k];
      // A tight market is what tempts capital into a sector, and a sector that
      // has just boomed is the one carrying the new supply that ends it. The
      // transition is not a coin toss — it leans on where vacancy actually is.
      const gap = (e.cityVac?.[k] ?? NATURAL_VAC[k]) - NATURAL_VAC[k];
      const tight = clamp(0.5 - gap * 6, 0.1, 0.9);
      let nextPhase: "boom" | "steady" | "bust";
      if (cur === "steady") nextPhase = rng(s) < tight ? "boom" : "bust";
      else if (cur === "boom") nextPhase = rng(s) < 0.45 ? "bust" : "steady";
      else nextPhase = rng(s) < 0.72 ? "steady" : "boom";
      e.sectorPhase![k] = nextPhase;
      e.sectorPhaseM![k] = Math.round(
        nextPhase === "boom" ? rrange(s, 20, 56)
          : nextPhase === "bust" ? rrange(s, 16, 42)
            : rrange(s, 26, 74),
      );
      if (nextPhase !== "steady" && cur !== nextPhase) {
        pushNews(s, nextPhase === "boom" ? "event" : "warn", nextPhase === "boom"
          ? `${SECTOR_LABEL[k]} is turning. Tenants in that sector are expanding hard and every landlord in it knows.`
          : `${SECTOR_LABEL[k]} demand is rolling over. Brokers are quietly cutting asking rents.`);
      }
    }
    // ease toward the phase's level rather than jumping: a sector turn is
    // something you notice over a year, not in a month
    const aim = SECTOR_AIM[e.sectorPhase![k]];
    e.sectorMom[k] = clamp(e.sectorMom[k] + 0.055 * (aim - e.sectorMom[k]) + rrange(s, -0.0006, 0.0006), -0.02, 0.02);
  }

  // --- what the tenants do for a living -------------------------------------
  //
  // Ten industries, each on its own clock, at its own volatility. This is a
  // DIFFERENT cycle from the asset-class one above: office can be a landlord's
  // market while finance is shedding staff, and the building let to five
  // startups empties while the one across the street let to insurers does not.
  // That distinction did not exist — sector was a name on a lease and nothing
  // else — and it is the difference between a rent roll and a list.
  if (!e.industryPhase) {
    e.industryPhase = {} as Record<Sector, "boom" | "steady" | "bust">;
    e.industryPhaseM = {} as Record<Sector, number>;
    e.industryMom = {} as Record<Sector, number>;
    for (const k of SECTORS) {
      e.industryPhase[k] = "steady";
      e.industryPhaseM[k] = Math.round(rrange(s, 6, 70));
      e.industryMom[k] = 0;
    }
  }
  for (const k of SECTORS) {
    const vol = INDUSTRY_VOL[k];
    if ((e.industryPhaseM![k] -= 1) <= 0) {
      const cur = e.industryPhase![k];
      // Industries lean on the macro cycle without being it: a recession makes
      // a bust likelier everywhere, and an expansion makes a boom likelier,
      // but each one still turns on its own schedule.
      const macro = e.phase === "recession" ? -0.22 : e.phase === "recovery" ? 0.06
        : e.phase === "expansion" ? 0.14 : -0.06;
      const up = clamp(0.45 + macro, 0.12, 0.85);
      let next: "boom" | "steady" | "bust";
      if (cur === "steady") next = rng(s) < up ? "boom" : "bust";
      else if (cur === "boom") next = rng(s) < 0.5 ? "bust" : "steady";
      else next = rng(s) < 0.7 ? "steady" : "boom";
      e.industryPhase![k] = next;
      // Volatile industries run shorter, sharper cycles; a stable one can sit
      // steady for the better part of a decade.
      const len = next === "boom" ? rrange(s, 18, 48) : next === "bust" ? rrange(s, 12, 36) : rrange(s, 30, 96);
      e.industryPhaseM![k] = Math.round(len / Math.max(0.6, vol));
      if (next !== "steady" && cur !== next) {
        pushNews(s, next === "boom" ? "event" : "warn", next === "boom"
          ? `${INDUSTRY_LABEL[k]} is hiring hard. Anyone with space let to that trade is about to have a good few years.`
          : `${INDUSTRY_LABEL[k]} is in trouble. Look at how much of your rent roll depends on it before somebody hands you the keys.`);
      }
    }
    const aim = (e.industryPhase![k] === "boom" ? 0.016 : e.industryPhase![k] === "bust" ? -0.015 : 0) * vol;
    e.industryMom![k] = clamp(
      e.industryMom![k] + 0.05 * (aim - e.industryMom![k]) + rrange(s, -0.0008, 0.0008) * vol,
      -0.05, 0.05,
    );
  }

  // --- the construction pipeline --------------------------------------------
  // Everyone else builds when it pays, and delivers three years later into a
  // market that has usually turned. Starts scale with the spread between what
  // rent supports and what construction costs, and with whether anyone will
  // lend. Deliveries land as supply, and supply is what ends a boom.
  const monthAbs: Record<string, number> = {};
  const monthComp: Record<string, number> = {};
  // Demand that PHYSICALLY CANNOT BE HOUSED, as a share of stock. When a city
  // runs out of space the extra tenants do not vanish — they bid. Without this
  // the model just pinned occupancy at its ceiling and sat there: a permanent
  // shortage with flat rents, which is not a market, it is a clamp. Routing
  // the overflow into rent closes the loop — price rises, price rations
  // demand, and eventually price makes building pencil again.
  // HOW SHORT OF SPACE THIS CITY HAS CHRONICALLY BEEN. A twenty-year memory,
  // which is the timescale on which a place actually earns the right to be
  // expensive. Read by the income anchor as the sustainable rent-to-income
  // ratio: a generation of tightness buys a premium, a permanent glut spends it.
  //
  // AND IT IS FED OFF AVAILABILITY, BECAUSE DIRECT VACANCY IS PINNED. This
  // read `cityVac.office`, which rested on its frictional rail 26.9% of all
  // months in runs of five to eight years. While it is pinned the input to
  // this EMA is a CONSTANT — the city cannot report being any tighter than its
  // floor — so a town that merely touched the floor earned the full Manhattan
  // premium on rent-to-income and then carried it two decades into the bust,
  // defeating the income anchor at exactly the moment the anchor was needed.
  // Availability does not pin: when a city is that tight, rent pressure puts
  // sublet space on the market, and the market can report the difference
  // between short of space and desperately short of it.
  //
  // Feeding it off `unmet` instead was tried and REJECTED on measurement.
  // `unmet` carries a large structural positive offset — median 0.030 of
  // stock, 26% of natural vacancy, because the demand pool always leads
  // occupancy — so a balanced city would have read as chronically tight and
  // been handed a permanent premium, which is the opposite of the intent.
  {
    const availNow = (e.cityVac?.office ?? NATURAL_VAC.office)
      + (e.sublet?.office ?? 0) / Math.max(1, e.stock?.office ?? CITY_STOCK.office);
    const tightNow = (NATURAL_VAC.office - availNow) / NATURAL_VAC.office;
    e.tightEma = (e.tightEma ?? 0) + 0.004 * (tightNow - (e.tightEma ?? 0));
  }

  const unmet: Record<string, number> = {};
  for (const k of BUILT_CLASSES) {
    const stk = e.stock?.[k] ?? CITY_STOCK[k];
    // A DEVELOPER COUNTS THE SUBLET SPACE. It is the cheapest competition a new
    // building will ever face — already built, already fitted out, offered at a
    // discount by somebody who only wants to stop the bleeding — and no lender
    // sizes a construction loan without it in the availability figure.
    const vacNow = (e.cityVac?.[k] ?? NATURAL_VAC[k])
      + (e.sublet?.[k] ?? 0) / Math.max(1, e.stock?.[k] ?? CITY_STOCK[k]);
    // DEVELOPERS UNDERWRITE THE RENT THEY EXPECT, NOT THE RENT THAT EXISTS.
    // This read today's rent, so supply responded to the present and the
    // cycle had to be supplied by the phase clock. Every real overbuild is
    // built out of extrapolation: three good years become a pro forma, the
    // pro forma becomes a crane, and the crane opens into the glut those
    // pro formas created. rentExp is an adaptive, lagging belief; the gap
    // between it and today's rent is the momentum being extrapolated.
    if (!e.rentExp) e.rentExp = { ...e.rentIdx };
    e.rentExp[k] += 0.045 * (e.rentIdx[k] - e.rentExp[k]);
    const momentum = clamp(e.rentIdx[k] / Math.max(1, e.rentExp[k]) - 1, -0.30, 0.30);
    const underwritten = (e.rentIdx[k] / RENT_BASE[k]) * (1 + clamp(momentum * 2.4, -0.28, 0.45));

    // THE COST OF CAPITAL — A DEVELOPER'S FIRST NUMBER, AND IT WAS NOT HERE.
    //
    // This compared the rent a developer expects to what it costs to build,
    // and then stopped, which means the single most important input to every
    // real development decision — what money costs — had no vote. The stress
    // test made it unmissable: pinned at a permanent SIXTEEN per cent for
    // fifty years, this city built 31% more office than it did at five, which
    // is not a simulation of anything. The real 1981 answer is that nothing
    // gets built at all, for years, and then rents explode because nothing
    // got built.
    //
    // So the pro forma reads like a pro forma. A project makes a yield on
    // cost; the capital stack behind it requires a return, which is what debt
    // costs plus the spread a merchant builder needs to be paid for two years
    // of risk. Build when the first exceeds the second. Everything else in
    // this block — the extrapolated rent, the vacancy gate, the credit index —
    // is unchanged, and it still self-corrects: fewer starts mean lower
    // vacancy, which means higher rents, which eventually pencils even at
    // twelve per cent. It just takes a decade and a much higher rent to get
    // there, which is precisely what happened.
    //
    // The rate is smoothed over about a year because a developer underwrites
    // a two-year construction period, not a single month's print — a project
    // is not killed by one bad meeting and not saved by one good one.
    e.rateEma = (e.rateEma ?? e.indexRate) + 0.085 * (e.indexRate - (e.rateEma ?? e.indexRate));
    const required = e.rateEma / 100 + DEV_SPREAD;
    const yieldOnCost = BASE_YOC * (underwritten / e.costIdx);
    const margin = yieldOnCost / required - 1;           // profit signal, as BELIEVED
    // Nobody starts a building into a glut, whatever the pro forma says —
    // vacancy above natural chokes starts long before the margin math does.
    // The shortage signal has to be strong enough to actually pull supply
    // through. Housing gets the sharpest response of the four, because a
    // housing shortage is the most profitable thing that can happen to a
    // builder and the model should behave like builders notice.
    // HOW HARD OVERSUPPLY SHUTS THE CRANES DOWN.
    //
    // At gain 7, a class sitting two and a half points over its natural rate
    // still broke ground at 83% of full pace, and six points over — a real
    // glut — still ran at 58%. So the market kept feeding a market that was
    // already full, and the statistics showed it: every class spent a MEDIAN
    // of eight to ten years at a stretch above natural, which is not a cycle,
    // it is a permanent condition with a wobble.
    //
    // Lenders and boards are far less patient than that. Two points over and
    // the pace halves; five points over and almost nothing starts, which lets
    // absorption actually catch up and turns the glut back into a phase.
    const gain = k === "multifamily" ? 22 : 17;
    const ceiling = k === "multifamily" ? 2.3 : 1.7;
    const vacGate = clamp(1 - gain * (vacNow - NATURAL_VAC[k]), 0.08, ceiling);
    const appetite = Math.max(0, margin + 0.06 * e.cycleDev) * e.creditIdx * vacGate;
    // This coefficient is not the knob it looks like. Starts are gated on
    // vacancy, so the loop is self-correcting: halve this and vacancy falls,
    // which opens the gate, and supply comes back to the same fixed point.
    // Measured over many centuries, moving it 6% moved long-run overbuild by
    // nothing at all. The gate's SLOPE is the real control, not this.
    const start = stk * 0.0016 * Math.min(2.4, appetite * 5) * (0.7 + 0.6 * rng(s));
    e.starts[k] = Math.round(start);

    // THE QUEUE. A start becomes a dated cohort; it delivers when its month
    // arrives and not before. Everything downstream — the delivery schedule,
    // the forward vacancy projection, the "what is coming" chart — falls out
    // of this one change, because the pipeline now knows WHEN as well as HOW
    // MUCH.
    if (!e.cohorts) e.cohorts = { office: [], retail: [], multifamily: [], industrial: [] };
    if (!e.completions12) e.completions12 = { office: 0, retail: 0, multifamily: 0, industrial: 0 };
    const [bLo, bHi] = BUILD_MONTHS[k];

    // TWO SUPPLY UNIVERSES THAT NEVER MET, and this was the seam.
    //
    // This line pushed the month's construction into an anonymous cohort
    // queue. That queue is what moves vacancy, rents and cap rates — and it is
    // the ONLY thing that did. Meanwhile tickCityGrowth separately placed real
    // buildings on real parcels, and the two numbers had nothing to do with
    // each other.
    //
    // Measured over fifty years: the space market grew the city from 13.34M to
    // 21.32M square feet, SIXTY PER CENT, while the map gained four buildings.
    // The economy built twenty-eight times more floor area than the city ever
    // showed — seven hundred buildings' worth of supply that moved the
    // player's rents and appeared nowhere. You watched a chart climb sixty per
    // cent while looking at a skyline that was pixel-identical to the one you
    // started with. It is also why the demand model never moved: it is fed by
    // changes in occupied stock per block, and the map placed four buildings
    // in half a century.
    //
    // So the number stops being a cohort and becomes a BUDGET. tickCityGrowth
    // spends it on actual lots, and pushes the cohort when a crane actually
    // goes up. The total square footage the city builds does not change by one
    // foot — every calibration downstream is untouched. The supply just has an
    // address now.
    e.startOwed = e.startOwed ?? { office: 0, retail: 0, multifamily: 0, industrial: 0 };
    if (start > 1) e.startOwed[k] += Math.round(start);
    // A BACKLOG IS A BUFFER, NOT A LEDGER. Demand that has gone unmet for two
    // years has not been sitting there waiting — the tenants found space
    // somewhere else, or did not expand, and the market moved on. Left
    // uncapped it accumulated forever: 8.1M square feet of permanently
    // demanded, permanently unbuilt city by year fifty. Eighteen months of
    // orders is a real order book; anything older has expired.
    e.startOwed[k] = Math.min(e.startOwed[k], Math.round(start * 18) || 0);
    void bLo; void bHi;
    let delivered = 0;
    e.cohorts[k] = e.cohorts[k].filter((c) => {
      if (c.m <= s.month) { delivered += c.sf; return false; }
      return true;
    });
    e.pipeline[k] = e.cohorts[k].reduce((a, c) => a + c.sf, 0);
    e.completions12[k] = e.completions12[k] * (11 / 12) + delivered;
    e.supplyPress = e.supplyPress ?? {};
    e.supplyPress[k] = delivered / stk;

    // --- the space market itself -------------------------------------------
    // Deliveries add stock. Employment decides how much space the city's
    // tenants WANT; occupancy chases that target a few per cent a month —
    // firms sign leases slowly on the way up and shed space slowly on the way
    // down, which is why vacancy is a lagging, cycle-length variable and not
    // a monthly jitter. Rent level pushes back: space priced over its long-run
    // relation to incomes gets used more sparingly.
    if (!e.stock) e.stock = { ...CITY_STOCK };
    if (!e.occupied) e.occupied = {
      office: CITY_STOCK.office * (1 - NATURAL_VAC.office),
      retail: CITY_STOCK.retail * (1 - NATURAL_VAC.retail),
      multifamily: CITY_STOCK.multifamily * (1 - NATURAL_VAC.multifamily),
      industrial: CITY_STOCK.industrial * (1 - NATURAL_VAC.industrial),
    };
    if (!e.cityVac) e.cityVac = { ...NATURAL_VAC };
    if (!e.absorb12) e.absorb12 = { office: 0, retail: 0, multifamily: 0, industrial: 0 };
    e.stock[k] = stk + delivered;
    const elastic = k === "office" ? 1.0 : k === "industrial" ? 0.9 : k === "retail" ? 0.7 : 0.75;
    // PRICE RATIONS DEMAND. Affordability is rent against INCOME, not rent
    // against construction cost — deflating by cost cancelled most of rent
    // growth and left price with almost no say, which is how industrial ended
    // up pegged at half a per cent vacancy with tenants who could not possibly
    // pay for it. Space is a normal good: when it gets dear relative to what
    // the city earns, firms take less of it.
    // CONSERVATION OF DEMAND (ECONOMY.md). The old code chased a target that
    // repriced at monthly speed off affordability with a -0.58 exponent — a
    // supply shock that cut rents 18% MANUFACTURED ~11% more demand through
    // cheapness alone, which is most of how +12% stock conjured tenants equal
    // to 39.4% of itself in the acceptance run. Price still rations demand,
    // but at era speed: the exponent softens and the multiplier is damped
    // with a ~6-year half-life. Firms do not materialise because rent dipped
    // this quarter.
    // ...and the price is measured against INCOME PER WORKER, not against the
    // NUMBER of workers. This deflator was `employIdx` — total jobs, which
    // reached 1.83x by 2050 — so a city that merely GREW licensed an
    // unbounded rise in rent per square foot: more firms in town was read as
    // every firm being able to pay more. What rations space is what one
    // tenant earns, and that is the wage index.
    // ...and it is BOUNDED, because feet per worker is a physical quantity with
    // a known range and this had none. See AFFORD_BAND.
    const affordRaw = clamp(Math.pow(
      (e.rentIdx[k] / RENT_BASE[k]) / Math.max(0.35, e.wageIdx ?? 1),
      k === "multifamily" ? -0.50 : -0.40,
    ), AFFORD_BAND[0], AFFORD_BAND[1]);
    if (!e.affordEff) e.affordEff = { office: 1, retail: 1, multifamily: 1, industrial: 1 };
    // At the lease-rollover rate of THIS class, not of an office. See AFFORD_ROLL.
    e.affordEff[k] += AFFORD_ROLL[k] * (affordRaw - e.affordEff[k]);

    // A SECTOR PRICED OUT OF A CITY DOES NOT PAY FOUR TIMES THE RENT. IT LEAVES.
    //
    // affordEff above is a REVERSIBLE discount — dear space, firms take less
    // of it; cheap space, they take more again. That is right for the cycle
    // and it is not what happens to a sector over a generation. When the rent
    // a use can pay is permanently beyond it, the use does not shrink its
    // footprint and wait, it goes somewhere else, and the building it left
    // becomes something else. Nobody reopens the foundry when rents dip.
    //
    // Without this the model had no exit at all. `baseStock` was frozen at
    // month zero, so demand was forever a multiple of the city's ORIGINAL
    // stock: a class the city cannot build more of — industrial, capped at two
    // floors and confined to M-zoned land, of which this island has sixty-one
    // vacant lots — met rising demand with a fixed supply and the only free
    // variable left was price. Measured over fifty years, real rent growth by
    // class: industrial +2.14%/yr and retail +1.52%/yr against office +1.11%
    // and housing -0.47%. 2.3x real rent for a shed, and the tenants stayed
    // and paid it, because there was nowhere in the model for them to go.
    //
    // This is the going. It is a RATCHET — `Math.min`, never recovering —
    // because that is the asymmetry that makes it different from affordEff
    // and it is the asymmetry real cities show: New York, San Francisco and
    // London each lost more than half their manufacturing floor space between
    // 1970 and 2010 and not one square foot of it came back when a recession
    // made space cheap again.
    //
    // WHAT COUNTS AS PRICED OUT: rent per square foot against what the city
    // earns, versus where that ratio started. A sector paying its historical
    // share of income is fine at any nominal rent. The threshold is a fifth
    // above it, which is roughly the point at which relocation beats renewal
    // once moving costs are counted.
    //
    // NOBODY MOVES OUT MID-LEASE, AND THE RATE HAS TO SAY SO.
    //
    // The pace was a bare `LEAVE_RATE * over`, a tenth of the overshoot a year,
    // with nothing bounding it — and the comment asserted that was "slow enough
    // that a cyclical spike does nothing", which is a claim about behaviour
    // that nothing in the code guaranteed. The missing mechanism is that A
    // SECTOR CAN ONLY LEAVE AT THE RATE ITS LEASES ROLL: a tenant priced out in
    // March with four years to run is a tenant who is still there in March.
    // Terms here and in life average something like eight years, so about an
    // eighth of a footprint faces renew-or-go in a year and nothing else can
    // move at all; how many of those at the table go scales with the overshoot
    // and cannot exceed all of them. Structural exit is therefore bounded near
    // 1.2%/yr — half a sector over forty years, which is the fact this exists
    // to reproduce.
    //
    // AND IT CHANGED NOTHING MEASURABLE, WHICH IS RECORDED HERE BECAUSE IT
    // MATTERS. `ROLL_YR * GO_RATE` is 0.125 * 0.80 = 0.10, exactly the old
    // LEAVE_RATE, so below the cap the two are the same expression; and `over`
    // does not reach the 1.25 where the cap starts to bind. Output was
    // byte-identical across two seeds x 50 years — same rents, same vacancies,
    // same demand anchors to the digit. The bound is kept because it is the
    // honest form and it holds at extremes the calibration has not seen, but it
    // is NOT a fix for anything, and the estimate that motivated it was wrong:
    // `over` peaks near 0.45, not 1.2, so this ratchet sheds about 4.4%/yr at
    // the top of a cycle rather than the 12% first claimed.
    //
    // What that rules out is the important part. The demand anchor walks down
    // smoothly — 0.93, 0.87, 0.80, 0.71, 0.71 by decade for office — while real
    // office rent swings $14 to $95 and back on a ~28-year period. A slow trend
    // and a violent cycle are different timescales, so the oscillator is not
    // here. It is in the supply-and-rent feedback, and that is where to look.
    //
    // HOUSING IS EXEMPT and that is not a special case, it is the mechanism
    // being right: people priced out of a city's housing leave, and the
    // housing does not. The building stays and somebody poorer or somebody
    // richer lives in it. Demand for shelter in a place is not a footprint
    // that can relocate.
    // AND A DEPARTURE SOMEBODY IS QUEUING TO BACKFILL IS NOT A SECTOR LEAVING.
    //
    // The trigger above is a PRICE and nothing else, and high rent has two
    // opposite causes that a price cannot tell apart:
    //
    //   priced out — firms go, hand the space back, and vacancy RISES
    //   starved    — firms want more and cannot get it, vacancy sits on its FLOOR
    //
    // Measured over 12 seeds x 50 years, asking what vacancy was doing on the
    // months this fired, it was BELOW natural for 91.3% of office firings, 84.7%
    // of retail and 93.4% of industrial — and for industrial, 43.4% of firings
    // happened with the class pinned at its absolute frictional floor, median
    // vacancy 1.8% against a natural rate of 7.0%. Industrial fired in 42.4% of
    // all months and had a quarter of its base demand removed by year fifty.
    //
    // So nine times in ten this was not modelling an exodus. It was modelling a
    // shortage and calling it an exodus — and `useForZone` in dev.ts then
    // converts M-zoned land to housing in proportion to how much has "gone",
    // one way and never back, which removes the very capacity that would have
    // relieved the shortage. Shortage, higher rent, less land for the starved
    // use, deeper shortage. The paragraph at the top of this block names the
    // supply constraint as the reason it was built; deleting the demand is not
    // the fix for supply that cannot respond.
    //
    // The mechanism stays — New York, San Francisco and London really did each
    // lose more than half their manufacturing floor space, and none came back.
    // What changes is that exit is NET OF THE QUEUE. A tenant priced out at
    // renewal whose floor is immediately taken by another firm of the same use
    // that could not find space is a tenant swap, and the sector's footprint in
    // the city has not moved. You cannot have a waiting list and an exodus at
    // the same time. The queue is a level of demand that has nowhere to go and
    // departures are drawn against it before any of them count as the sector
    // leaving, which is why a monthly flow is differenced against a stock here.
    if (k !== "multifamily") {
      const RELOCATE_AT = 1.20;    // a fifth above its historical rent-to-income
      const ROLL_YR = 1 / 8;       // an eight-year term: an eighth comes up each year
      const GO_RATE = 0.80;        // of those at renewal, per point of overshoot
      const burden = (e.rentIdx[k] / RENT_BASE[k]) / Math.max(0.35, e.wageIdx ?? 1);
      const over = Math.max(0, burden - RELOCATE_AT);
      if (over > 0 && e.baseStock) {
        const leaving = Math.min(1, over * GO_RATE);      // cannot exceed everyone at the table
        const goes = (ROLL_YR * leaving) / 12;            // share of the footprint walking this month
        // Last month's unhoused demand for this use — the same expression the
        // rent block calls `unmet`, read a month stale because the pool has not
        // been rolled forward yet, which is also what a landlord can see.
        const stk = Math.max(1, e.stock?.[k] ?? CITY_STOCK[k]);
        const queue = Math.max(0, ((e.pool?.[k] ?? 0) - (e.occupied?.[k] ?? 0) - (e.sublet?.[k] ?? 0)) / stk);
        const net = Math.max(0, goes - queue);
        if (net > 0) e.baseStock[k] = Math.min(e.baseStock[k], e.baseStock[k] * (1 - net));
      }
    }
    // WHAT EACH KIND OF SPACE IS ACTUALLY DEMANDED BY, and this was the single
    // largest hole the economy audit found.
    //
    // Every class's demand was driven by `employIdx` — jobs — including
    // housing and including shops. So a city whose population rose eighteen per
    // cent saw NO new demand for flats, and the audit measured exactly the
    // absurdity that implies: population +18% moved multifamily rent DOWN
    // 23.9% and retail rent DOWN 67.1%, because the extra people raised
    // unemployment, unemployment cut wages, and the affordability term then
    // rationed demand. More people made housing cheaper. That is backwards in
    // a way no amount of tuning fixes, because the wire itself was wrong.
    //
    // Offices and sheds are leased by FIRMS, so jobs is right for them. Flats
    // are rented by HOUSEHOLDS, so housing reads population. Shops are a
    // blend: most trade is residents spending near where they live, and the
    // rest is the daytime population of workers — which is why a retail
    // parade in a business district dies at six o'clock and one in a
    // residential quarter does not.
    const pop0 = e.pop0 ?? 240_000;   // this town's opening population, so popIdx opens at exactly 1
    const popIdx = (e.population ?? pop0) / pop0;
    const driver = k === "multifamily" ? popIdx
      : k === "retail" ? Math.pow(popIdx, 0.68) * Math.pow(e.employIdx, 0.32)
      : e.employIdx;
    // AND THE LEVEL EVENTS RIDE UNDERNEATH ALL OF IT. `swanClassLevel` is 1.0
    // in a city nothing structural has happened to, and it is the permanent
    // restatement of what this class is wanted for once something has: less
    // office per job after remote work, fewer desks of any kind once the trade
    // that sat at them has gone, more shed once the shopping moved into one.
    // It multiplies rather than adding because it is a LEVEL, and it sits
    // outside `sectorMom` and `affordEff` because neither of those ever stops
    // reverting and this never reverts at all. See swans.ts.
    const swanLvl = swanClassLevel(e, k);
    const targetRaw = (e.baseStock?.[k] ?? CITY_STOCK[k]) * (1 - NATURAL_VAC[k])
      * Math.pow(driver, elastic)
      * (1 + e.sectorMom[k] * MOM_DEMAND)
      * e.affordEff[k]
      * swanLvl;
    // THE POOL. Demand takes about a year to form or dissolve, and demand
    // that cannot be housed here stops looking here within months — the
    // mainland takes it, exactly the fiction stockFromParcels already tells.
    // Note targetRaw reads baseStock, frozen at newGame: supply NEVER touches
    // the demand side. That sentence is the whole rebuild.
    const frictionRatio = k === "industrial" ? 0.22 : k === "multifamily" ? 0.30 : 0.32;
    const friction = NATURAL_VAC[k] * frictionRatio;
    const housable = e.stock[k] * (1 - friction);
    if (!e.pool) e.pool = { ...e.occupied };
    e.pool[k] += 0.10 * (targetRaw - e.pool[k]);
    e.pool[k] -= 0.25 * Math.max(0, e.pool[k] - housable * 1.02);
    // ABSORPTION IS FINITE, and it is a property of TENANTS, not buildings.
    // The clamps and the noise used to scale with stock — a bigger city of
    // buildings signed leases faster. Now they scale with occupied: a bigger
    // city of tenants does.
    const absorb = clamp(0.055 * (e.pool[k] - e.occupied[k]), -0.006 * e.occupied[k], 0.010 * e.occupied[k])
      + e.occupied[k] * rrange(s, -0.0005, 0.0005);
    // FRICTIONAL VACANCY IS A FLOOR, and it is not zero. Some share of every
    // market is empty purely because tenants are moving in and out of it —
    // roughly a third of the natural rate. A flat half-a-percent clamp was a
    // numerical guard pretending to be economics; this is the real thing, and
    // it differs by class because moving costs differ by class.
    // Frictional vacancy is space empty purely because tenants are moving in
    // and out, so it scales with how often that happens — and it does not
    // happen at the same rate in every class. A shed is let whole to one
    // operator who stays for a decade; an office floor is carved into suites
    // that churn constantly. Running one ratio across all four put the
    // industrial clamp above where that market actually clears, and it sat on
    // it a tenth of the century.
    // THE 0.55 x STOCK FLOOR IS DELETED — an occupancy floor that scales with
    // supply is a tenant printer, and it was the named leak in the acceptance
    // run. The honest floor on how fast a market can empty is the -0.006 x
    // occupied absorb bound above; the only hard floor is zero.
    e.occupied[k] = clamp(e.occupied[k] + absorb, 0, housable);

    // THE GIVE-BACK. What a tenant would take AT TODAY'S RENT, against what it
    // is contractually sitting in — and the difference goes on the market at
    // sublet speed rather than at lease speed. Same demand equation as
    // `targetRaw` above, same bounded affordability, but read off `affordRaw`
    // instead of the hundred-month `affordEff`: the footprint a firm has
    // LEASED can only reprice when the lease rolls, and the footprint it
    // ADVERTISES reprices the month the board decides to.
    //
    // That single distinction is the mechanism. It gives price a channel with a
    // nine-month lag where before it had only a hundred-month one, and a loop
    // that oscillates because it is PHASE-limited — this one was, by the
    // Barkhausen arithmetic and by measurement — is damped by shortening the
    // lag, not by weakening the gain.
    //
    // Both directions matter and they are the same expression. In a boom
    // `affordRaw` falls below `affordEff`, tenants want less than they hold,
    // and inventory appears on the market while direct vacancy is still pinned
    // at its frictional floor — which is the fast ceiling. In a bust the sign
    // flips, the wanted footprint runs ahead of the leased one, the marketed
    // space is withdrawn inside a year, and availability tightens long before
    // a single lease expires — the fast floor.
    if (!e.sublet) e.sublet = { office: 0, retail: 0, multifamily: 0, industrial: 0 };
    // …and the swan level is in here too, which is where the FAST half of a
    // level event comes from and is the single most realistic thing about the
    // way this lands. A firm that has decided it needs a third less office does
    // not wait eight years for its lease to expire — it puts the floors on the
    // sublet market inside two quarters and goes on paying rent to the end of
    // the term. That is exactly what happened in 2020-23: US office sublease
    // inventory tripled while direct vacancy was still barely moving, and San
    // Francisco's went from about 1.5M sf to about 9M sf. Because the level
    // enters `wantedNow` as well as `targetRaw`, availability moves within
    // months of an announcement and direct vacancy takes years.
    //
    // MEASURED, and this is the claim I would least have trusted unmeasured.
    // Five paired forks — warm the city up fifteen years, clone it, inject a
    // finance exodus into ONE clone and nothing else, run both fifteen more
    // years off the same stream. The office availability gap opens like this:
    //
    //   months  1-12   +0.16pp,  of which sublet 0.09 and direct 0.07
    //   months 13-24   +1.02pp,  of which sublet 0.43 and direct 0.59
    //   months 25-60   +3.10pp,  of which sublet 0.30 and direct 2.80
    //   months 61-180  +3.22pp,  of which sublet -1.10 and direct 4.32
    //
    // The first year is more than half sublet and the fifth year is almost
    // entirely direct, which is the observed order of events in 2020-23 rather
    // than an asserted one. And the last row is the give-back's OTHER half
    // doing its job: by then real office rent is 25% lower in the treated
    // clone, the footprint firms want at that rent exceeds the one they hold,
    // and the marketed space is withdrawn — a fast floor under a glut,
    // arriving long before a single lease expires.
    const wantedNow = (e.baseStock?.[k] ?? CITY_STOCK[k]) * (1 - NATURAL_VAC[k])
      * Math.pow(driver, elastic)
      * (1 + e.sectorMom[k] * MOM_DEMAND)
      * affordRaw
      * swanLvl;
    const marketable = clamp(
      (e.occupied[k] - wantedNow) * DEMISABLE[k],
      0, e.occupied[k] * SUBLET_MAX[k],
    );
    e.sublet[k] += (marketable - e.sublet[k]) / SUBLET_TAU;
    e.sublet[k] = clamp(e.sublet[k], 0, e.occupied[k]);

    e.cityVac[k] = clamp(1 - e.occupied[k] / e.stock[k], friction, 0.45);
    // Demand that cannot be housed nets off the sublet market first, because a
    // tenant who needs space this year takes a sublease — that is what the
    // sublet market is FOR, and it is why a shortage with sublet inventory
    // standing in it is not the same shortage.
    unmet[k] = Math.max(0, (e.pool[k] - e.occupied[k] - e.sublet[k]) / Math.max(1, e.stock[k]));
    e.absorb12[k] = e.absorb12[k] * (11 / 12) + absorb;
    monthAbs[k] = absorb;
    monthComp[k] = delivered;
  }

  // RENTS MOVE ON AVAILABILITY. The gap between the space a tenant can
  // actually go and lease — empty floors plus everything on the sublet market
  // — and the natural rate is the whole of the landlord-tenant power balance.
  // Five points of shortage moves rents about 2.7% a year; five points of
  // excess takes them down about 6.5% and nine points about 14.7%, because
  // the glut branch is superlinear and a capitulation is not a straight line.
  // Those are the figures the code below actually delivers, checked against
  // 1990-92 and 2020-23; an earlier version of this paragraph asserted three
  // per cent on both sides and neither branch obeyed it. Phase drift and
  // sector momentum ride on top as sentiment.
  for (const k of BUILT_CLASSES) {
    const vol = k === "multifamily" ? 0.002 : k === "office" ? 0.004 : k === "industrial" ? 0.0024 : 0.003;
    // ...AND ON AVAILABILITY, NOT ON DIRECT VACANCY. A prospective tenant does
    // not choose from the space landlords have empty, it chooses from the space
    // it can move into, and a quarter of that in a bad office market is
    // somebody else's lease. Direct vacancy is the landlord's accounting;
    // availability is the market. Quoting off the first is how the model ended
    // up with real rent compounding at double digits for eight straight years
    // while its vacancy sat welded to a frictional floor — the floor is a
    // statement about DIRECT vacancy and it was never a statement about how
    // much space you could go and lease.
    const gap = (e.cityVac?.[k] ?? NATURAL_VAC[k])
      + (e.sublet?.[k] ?? 0) / Math.max(1, e.stock?.[k] ?? CITY_STOCK[k])
      - NATURAL_VAC[k];

    // WHERE THE VACANCY-TO-RENT LAG IS NOT. `pnpm leadlag` says this leg runs
    // SIMULTANEOUS (0 months) where a real one runs 3 to 24, and the obvious
    // explanation — that a landlord cannot see this month's vacancy print, so
    // `vacTerm` should read a trailing average — was built, measured and is
    // WRONG. Identification test: driving the observation lag from 0 months to
    // 24 moved the measured leg from 0mo to MINUS 3, not toward positive at
    // all, while the total loop fell from 5.7 years to 4.7. If a 24-month lag
    // on this term cannot move the leg, this term is not what carries the
    // correlation. See HANDOFF.md; the live hypothesis is `scarcity` and the
    // rollover-weighted index, not this.
    // The vacancy gap has to be able to OVERPOWER the cycle's sentiment, or a
    // glut politely coexists with rising rents forever. Six points of excess
    // availability takes rents down about 8.4% a year, which is what a real
    // oversupply does.
    // STICKY ASKING, MOVING EFFECTIVE (ECONOMY.md). A shortage pushes asking
    // up immediately; cuts ramp in only after the landlord has stared at the
    // empty floor for half a year — the capitulation clock. Meanwhile the
    // concession dial moves in months, so what deals actually sign at falls
    // long before the face rate admits anything.
    if (!e.vacOverM) e.vacOverM = { office: 0, retail: 0, multifamily: 0, industrial: 0 };
    if (!e.concIdx) e.concIdx = { office: 0, retail: 0, multifamily: 0, industrial: 0 };
    if (!e.effRentIdx) e.effRentIdx = { ...e.rentIdx };
    // ...AND A CAPITULATION IS RENEWED WHEN IT GETS WORSE.
    //
    // The clock only ever knew how LONG a glut had run, and it reset only when
    // the market came back to balance. But gluts BUILD: measured over 10 seeds
    // x 100 years, the deepest gap of an episode arrives 43 to 117 months in,
    // by which time the repricing window has closed and the exponential tail
    // has taken the term to nothing. So the market took its very worst quarter
    // with no price reaction whatsoever, which is the opposite of what happens.
    //
    // Houston 1983-87 was not one slide. It was five successive rounds of cuts,
    // each set off by the market being worse again than the last time anybody
    // had repriced for. That is this: when availability makes a new high for
    // this episode by a material margin — a point and a half, enough that it is
    // a fresh shock and not drift — the capitulation starts again, past the
    // ramp-in because the landlords have done this before and know the drill.
    // A glut that builds to nine points and stabilises still reprices once.
    if (!e.vacWorst) e.vacWorst = { office: 0, retail: 0, multifamily: 0, industrial: 0 };
    if (gap > 0.015) {
      // THREE POINTS, NOT ONE AND A HALF. Gluts build slowly, so a small
      // threshold fires on the drift itself — a market walking from five points
      // to fifteen over five years crosses a 1.5-point step six times and
      // reprices six times, which is the fall-forever behaviour arriving by a
      // new road. Three points is a step somebody notices: a wave of deliveries
      // landing, a tenant of size leaving. Measured, it renews once or twice in
      // an ordinary glut and more in a bad one, which is the shape Houston had.
      if (gap > (e.vacWorst[k] ?? 0) + 0.03) {
        e.vacWorst[k] = gap;
        e.vacOverM[k] = Math.min(e.vacOverM[k] ?? 0, 6);
      } else {
        e.vacWorst[k] = Math.max(e.vacWorst[k] ?? 0, gap);
        e.vacOverM[k] = (e.vacOverM[k] ?? 0) + 1;
      }
    } else {
      e.vacOverM[k] = 0;
      e.vacWorst[k] = 0;
    }
    const phaseNudge = e.phase === "recession" ? 0.22 : e.phase === "recovery" ? 0.08 : e.phase === "peak" ? -0.04 : -0.10;
    const concTarget = clamp(gap * 11 + phaseNudge, 0, 1);
    e.concIdx[k] += 0.25 * (concTarget - e.concIdx[k]);
    // EMPTY SPACE IS NEVER FREE. This term was capped at -0.9%/month, so at
    // ten points over natural it saturated and EVERY FURTHER POINT OF VACANCY
    // COST NOTHING — a 45% glut was priced exactly like a 20% one, which is
    // most of why rents went flat at $31 through a depression instead of
    // collapsing. Superlinear now: the second ten points hurt more than the
    // first ten, the way a real capitulation works.
    //
    // THE SHORTAGE SIDE DISAGREED WITH THE PARAGRAPH ABOVE IT, and the
    // paragraph was right. The header on this block says five points of
    // shortage moves rents about three per cent a year; 0.090 delivered 5.5%,
    // and it is on the shortage branch that the whole of this loop's gain sits
    // — the glut coefficients were measured and halving either of them moved
    // amplitude by nothing. So this is a correction to a calibration RECORD,
    // not a new constant: the code now says what the comment always said it
    // said. The clamp moves with it and remains what it was, a guard that has
    // never bound (the deepest shortage this model can reach is the frictional
    // floor, 7.8 points, which is 0.0035/month at this coefficient).
    //
    // The glut branch is left exactly as it was, and its arithmetic is written
    // down here because it is NOT what the header claims either — at five
    // points over it delivers -6.5%/yr, at nine points -14.7%/yr. Reality is
    // closer to the code than to the comment on this side: US office 2020-23
    // ran about seven points over natural and lost 10-15% of nominal effective
    // rent in three years, and 1990-92 ran about nine points over and lost
    // 35-40% real in three. The shallow end is a little hot and the deep end
    // is right, which is not worth moving a coefficient over.
    // ...AND A FIT IS NOT A LAW OUTSIDE THE RANGE IT WAS FITTED ON.
    //
    // Every anchor in the paragraph above lives between five and nine points
    // over natural, and the quadratic is right there — -14.7%/yr at nine points
    // is 1990-92 to the digit. It was then being evaluated wherever the market
    // went, and once the crew wall stopped truncating the supply cycle the
    // market went a very long way: measured over 12 seeds x 50 years, office
    // availability reaches 23.5 points over natural and spends 12.2% of all
    // months past nine. At 23.5 points the quadratic asks for -76%/yr.
    //
    // Nothing has ever done that. The worst overbuilds on record are Houston
    // 1983-87, which hit about thirty per cent office vacancy and lost 50-60%
    // of real effective rent over four years, and Manhattan 1990-92 at 35-40%
    // over three — call it -15 to -18%/yr at the very bottom of the worst
    // markets anyone has measured. The quadratic term carries a fifth of the
    // decline at nine points and three quarters of it at twenty-three, so past
    // the fit it stops being a calibration and becomes an artefact of the
    // curve's shape.
    //
    // WHAT THE RECORD ACTUALLY SAYS PAST NINE POINTS, and it is not a curve
    // going anywhere. There are two deep overbuilds measured well enough to
    // use, and between them the decline barely steepens:
    //
    //   Manhattan 1990-92   ~9pp over natural    -35 to -40% real over 3y   ~-14%/yr
    //   Houston  1983-87    ~15-20pp over        -50 to -55% real over 5y   ~-16%/yr
    //
    // Twice the glut, a tenth more decline. A market that deep is not falling
    // faster, it is falling for LONGER — which is a statement about duration
    // and this term is a rate. So the honest shape saturates, and the quadratic
    // asking for -76%/yr at 23.5 points is not a deep-end calibration, it is a
    // curve evaluated 2.6x outside the range anything was measured on.
    //
    // Below nine points nothing moves: the fit is untouched where its anchors
    // live, and the continuation leaves it at exactly the slope it already had,
    // so there is no kink. Past that it approaches the Houston rate. The only
    // new number is that rate, and it is a measurement with a source rather
    // than a coefficient that made a median look better.
    //
    // A straight tangent past the fit was tried first and REJECTED on the
    // record, not on the outcome — it reaches -45%/yr at 23.5 points, which is
    // still nearly three times Houston. Measured paired over 24 seeds it also
    // did nothing at all (drawdown delta median -1.07pp, 10 seeds up and 13
    // down), because it only bites past twelve points and the drawdown
    // accumulates between five and twelve.
    const FIT_MAX = 0.09;                                  // the deepest anchor above
    const glut = (gp: number) => gp * 0.070 + gp * gp * 0.85;
    const SLOPE_AT_FIT = 0.070 + 2 * 0.85 * FIT_MAX;       // d/dgap of the same curve
    const DEEP_RATE = 0.0155;   // -18.6%/yr, the Houston 1983-87 asymptote
    const atFit = glut(FIT_MAX);
    const span = DEEP_RATE - atFit;
    const vacTerm = gap <= 0
      ? clamp(-gap * 0.045, 0, 0.0045)
      : -(gap <= FIT_MAX
        ? glut(gap)
        // C1-continuous at FIT_MAX: same value, same slope, asymptote DEEP_RATE.
        : atFit + span * (1 - Math.exp(-SLOPE_AT_FIT * (gap - FIT_MAX) / span)))
        * capitulation(e.vacOverM[k] ?? 0);
    const scarcity = clamp((unmet[k] ?? 0) * 0.10, 0, 0.016);

    // THE INCOME ANCHOR — the line that makes rent a by-product of the economy.
    //
    // Every other term here is a FLOW: sentiment, momentum, vacancy, jobs.
    // Flows have no opinion about the LEVEL, which is why fifty years of them
    // compounded to a rent-to-income ratio of 9.87x and nothing anywhere
    // objected. Rent is a payment out of a wage. When the rent per square foot
    // has outrun the income of the people paying it, tenants take less space,
    // they take worse space, they leave — and the landlord discovers the
    // number he can actually get. That discovery is this term.
    //
    // It is not a clamp: it is a pull whose strength grows with the overshoot,
    // and the ratio it pulls toward is EARNED. A city chronically short of
    // space sustains a higher one — that is the Manhattan premium, and
    // tightEma is a twenty-year memory of having genuinely been tight rather
    // than a constant somebody typed. A city with a permanent glut loses it.
    const income = Math.max(0.35, e.wageIdx ?? 1);
    const rentToIncome = (e.rentIdx[k] / RENT_BASE[k]) / income;
    // HOW MUCH OF A PREMIUM A CHRONICALLY TIGHT CITY IS ALLOWED TO EARN. At
    // 0.80 this let a tight market sustain a rent-to-income ratio 44% above
    // parity, which is most of a Manhattan premium granted to any town that
    // spent twenty years mildly short of space — and it is the slack that let
    // real rents grow 1.72%/yr against real wages at 1.03%. Measured, rents
    // reached 3.18x their base while construction costs reached 1.79x, and
    // costs were the ones tracking inflation correctly. A premium is still
    // earned here; it is just a quarter rather than a half.
    const sustain = 1 + 0.45 * clamp(e.tightEma ?? 0, -0.30, 0.55);
    const dev = rentToIncome / sustain - 1;
    // Tightened from 0.0080 when housing and retail demand were rewired onto
    // population: giving those two classes their real driver let real rent
    // growth run at 1.97%/yr against real wages at 1.01%, which is the same
    // failure the anchor was built to prevent, arriving through a new door.
    // This is the correct place to absorb it — the anchor's whole job is to
    // police the real relationship between rent and pay, whatever pushed it.
    const anchor = dev > 0
      ? -0.0124 * Math.min(1.6, dev)          // outrunning incomes: pulled down hard
      : -0.0028 * Math.max(-0.65, dev);       // cheap against incomes: drifts back up

    // AND RENT CARRIES THE PRICE LEVEL. Every other term above is REAL — a
    // sentiment, a vacancy, a job — and none of them knows what a dollar is
    // worth. That was survivable only while inflation happened to be a
    // by-product of the same city drivers that moved rent; the moment the
    // price level became a national object, the two came apart and the failure
    // was immediate and measurable: inflation fell from 2.77% to 2.18%, wages
    // fell with it because wages are indexed to expectations, and rent did not
    // fall with either, so rent outran the incomes paying it by a point a year
    // for fifty years. A landlord does not re-let at last decade's number in a
    // world where everything else has repriced, and every lease in this game
    // already contains an escalation. So the nominal escalation is explicit
    // here, and the income anchor above is left to do the job it is actually
    // for — policing the REAL relationship between rent and pay — instead of
    // being asked to carry the whole price level on a spring.
    const escalation = (e.inflExp ?? 0.02) / 12;
    const drift = c2.rentDrift * 0.55 + e.sectorMom[k] * 0.42 + vacTerm + scarcity
      + anchor + (jobDrift * 0.35) + escalation;
    // THE HALF-OF-BASE FLOOR IS NOW A GUARD AGAIN, WHICH IS ALL IT WAS EVER
    // MEANT TO BE. It used to be load-bearing and it used to be the reason the
    // amplitude above looked survivable: removing it took office peak-to-trough
    // from 12.5x to 94x, and it bound 9.5% of all months with 16 of 17 careers
    // touching it — a rail holding up the model. Measured after the sublet
    // channel: it binds 0.0% of months in every class over 6 seeds x 50 years,
    // and deleting it entirely reproduces every statistic in this file to the
    // digit. Left in place because a guard that never fires is a guard.
    e.rentIdx[k] = Math.max(RENT_BASE[k] * 0.5, e.rentIdx[k] * (1 + drift + rrange(s, -vol, vol)));
    e.effRentIdx[k] = +(e.rentIdx[k] * (1 - 0.14 * e.concIdx[k])).toFixed(4);
  }

  // cap rates: class base, dragged by the loan index and the cycle, and gapped
  // out when nobody will lend — a credit crunch reprices everything at once
  for (const k of BUILT_CLASSES) {
    const crunch = 1.6 * Math.max(0, 1 - e.creditIdx);
    // A sector in favour reprices harder than it used to: capital rotating
    // into a class is most of what moves its cap rate, and at 14x a full
    // sector cycle was worth under two-tenths of a point.
    const sector = -30 * e.sectorMom[k];
    // Asymmetric on purpose. Compression floors out at 60bp — nobody
    // underwrites a shortage lasting forever — while a glut has much further
    // to run, because a buyer staring at empty floors is pricing the years it
    // takes to fill them.
    const vacGap = (e.cityVac?.[k] ?? NATURAL_VAC[k]) - NATURAL_VAC[k];
    const vacRisk = clamp(CAP_VAC_BETA[k] * vacGap * 100, -0.6, 2.0);
    // ...and they TRACK the cost of debt, at about half a point of cap for a
    // point of rate, which is what the real relationship looks like. At 0.38
    // the spread between yield and borrowing cost barely moved across a
    // century of rates, so the fix-or-float decision and the timing of a
    // levered purchase were both weather rather than judgement. At 0.55 a rate
    // spike genuinely flips leverage negative and a rate collapse genuinely
    // makes it free — which is the trade the player is supposed to be reading.
    const target = CAP_BASE[k] + 0.55 * (e.indexRate - 5.4) - 0.25 * e.cycleDev + crunch + sector + vacRisk;
    e.capRate[k] = clamp(e.capRate[k] + 0.1 * (target - e.capRate[k]) + rrange(s, -0.045, 0.045), 3.4, 11);
    // THE EXIT CAP A DEVELOPER UNDERWRITES, which is not this month's.
    //
    // Land is bought against a sale three or four years out, so the yield that
    // prices it is a through-cycle one. Without this the land residual took a
    // peak rent and capitalised it at a peak-compressed cap — the cycle counted
    // twice inside a difference of large numbers, which is most of why land
    // drew down 83-93% in every seed. A four-year memory, matching the horizon
    // it is underwriting. See `residualLandPsf` in value.ts.
    if (!e.capExp) e.capExp = { ...e.capRate };
    e.capExp[k] += 0.021 * (e.capRate[k] - e.capExp[k]);
  }

  // Citywide land index TRACKS the rent level rather than compounding off it —
  // over a 100-year campaign a feedback term would run away into absurdity.
  // Land is levered to rents (exponent > 1) and moody with the cycle, but it
  // is always pulled back toward what the income actually supports.
  // ...and it is RESIDUAL-SHAPED (ECONOMY.md): what a builder would pay is
  // rents against construction cost, and NO BUILDER PAYS UP INTO A GLUT — the
  // excess-vacancy discount is what finally lets a supply cycle reach the
  // dirt. EFFECTIVE rents, because a builder underwrites what deals sign at,
  // not what landlords quote.
  const rentLevel = (e.effRentIdx?.office ?? e.rentIdx.office) / RENT_BASE.office;
  const vacDisc = 1 - 1.2 * Math.max(0, (e.cityVac?.office ?? NATURAL_VAC.office) - NATURAL_VAC.office);
  const target = Math.pow(rentLevel / Math.pow(e.costIdx, 0.35), 1.15) * (1 + 0.16 * e.cycleDev) * Math.max(0.25, vacDisc);
  e.landIdx = clamp(e.landIdx + 0.024 * (target - e.landIdx) + e.landIdx * rrange(s, -0.003, 0.003), 0.25, 40);

  // COSTS INFLATE AT LEAST AS FAST AS RENTS.
  //
  // Letting expenses grow at 85% of rent growth looked conservative and was in
  // fact a machine for printing margin: over a century it silently widened
  // every operating margin in the city, which made asset appreciation a
  // one-way escalator, which made maximum leverage the dominant strategy by a
  // factor of two with an eight per cent failure rate. Real long-run rent
  // growth is roughly inflation, and operating costs track it — labour,
  // insurance and utilities do not politely lag.
  //
  // Setting them level is also what finally gives the recovery structures
  // their teeth: an owner on triple-net paper passes the inflation through, an
  // owner on base-year stops eats the first slice of it, and an owner on gross
  // leases watches a decade of cost inflation walk straight out of their NOI.
  // Now the lease you signed ten years ago decides whether you survive the
  // next ten.
  // COSTS TRACK RENTS' OWN DRIFT, not the phase drift they used to.
  //
  // When rent growth was cut to 0.55x the cycle's sentiment — because vacancy
  // now does that work — construction cost was left compounding at 1.02x, and
  // the two quietly diverged. By year fifty costs were at 188 against rents at
  // 119 and NOTHING penciled anywhere in the city, forever. That is not a
  // lesson about discipline, it is a broken denominator.
  //
  // Matching the base drift and adding a small real-terms creep keeps the
  // long-run ratio stable, which puts the decision to build back where it
  // belongs: with the space market. If rents are high relative to cost it is
  // because vacancy is low, not because of a term nobody chose.
  // THE TRADES ARE A MARKET TOO — and this is the brake a supply cycle needs.
  //
  // Construction cost drifted with the PHASE, which meant that when everybody
  // in the city broke ground at once the trades charged exactly what they had
  // charged when nobody was building. Measured: corr(share of stock under
  // construction, next year's real cost growth) = -0.18. Backwards. So a boom
  // had no cost consequence and nothing stopped it but the calendar.
  //
  // Real construction cost inflation is materials and labour, and both are
  // bid up by how much is being built. Costs now run at expected inflation
  // plus a premium for how busy the city is — so a boom raises the cost of
  // the next building, which thins the margin, which chokes the boom. That
  // is a cycle the economy produces rather than one a phase table asserts.
  {
    let pipe = 0, stk = 0;
    for (const k of BUILT_CLASSES) {
      pipe += e.pipeline?.[k] ?? 0;
      stk += e.stock?.[k] ?? CITY_STOCK[k];
    }
    const buildRate = stk > 0 ? pipe / stk : 0;
    e.buildEma = (e.buildEma ?? buildRate) + 0.06 * (buildRate - (e.buildEma ?? buildRate));
    // Pivoted on what this city ACTUALLY builds, measured rather than assumed:
    // the smoothed share under construction runs from about 0.4% of stock in
    // a dead market to 2.0% at the top of a cycle, median 1.4%. The first
    // draft pivoted at 2.0% — the very top of the observed range — so heat was
    // pinned at its floor essentially always and the whole term did nothing.
    // A boom is 2% of the city under way with every trade booked; a bust is
    // half a per cent and men looking for work.
    // THE TRADES CUT THEIR PRICES WHEN THE CRANES STOP, and this is the loop
    // that reopens development after anything closes it — a rate spike, a cost
    // spike, a glut, a rise in what buyers demand as a yield. Nobody fixes an
    // unpenciled deal by lowering their return requirement; the deal gets
    // fixed because the contractor who has laid off half his men bids the next
    // job at a number he would have laughed at two years ago.
    //
    // The floor was -0.8 against a ceiling of +1.6, which made a dead
    // construction market cost about the same as a normal one: at full idle the
    // drift came to -0.0001/month, flat in nominal terms, so real costs fell
    // only as fast as inflation and a hurdle once raised stayed unmet for
    // decades. Both ends are wider now and the DOWNSIDE IS STEEPER than the
    // upside, because a boom bids the trades up slowly — you cannot conjure
    // steelworkers — while a bust puts their price on the floor within a year.
    // At full idle real construction costs now fall about six per cent a year,
    // which is roughly what happened to the real thing in 2009-10.
    // THE PIVOT IS WHERE THE TRADES ARE FULLY EMPLOYED, and it has to be the
    // rate this city actually builds at or the cost index has a permanent
    // drift. Measured over three fifty-year runs the equilibrium share of
    // stock under construction is 0.0124; the pivot said 0.0140, so heat sat
    // negative in an ordinary market and real construction costs fell forever.
    // The consequence was a pro forma that never bound: rents reached 3.17x
    // base while costs reached only 1.49x, yield on cost averaged 14.98%
    // against a 7.50% hurdle, and development ran flat out at its ceiling in
    // 83% of months. A margin that wide is not a decision, it is a formality.
    //
    // AND IT IS THE SAME QUANTITY AS `REF_PIPE_SHARE`, WHICH SAID 0.018.
    // Two constants, two hundred lines apart, both defined as "the share of
    // stock this town has under construction in an ordinary year", with
    // different answers — which is the third kind of fake number, and the
    // symptom was exactly what a wrong pivot predicts: with the pipeline
    // running hot of the pivot, heat sat at its +1.6 CEILING 45.3% of months
    // and never once reached its floor, so real construction cost rose through
    // every bust instead of falling about six per cent a year at idle, and the
    // loop this whole block exists to close — the trades cutting their prices
    // until development reopens — could not fire.
    //
    // Re-measured after the teardown pipeline was made to queue for the same
    // crews as everything else (dev.ts), because that is what sets the number:
    // median pipeline share over 6 seeds x 50 years is 0.0175, and buildEma's
    // median is 0.0178. `REF_PIPE_SHARE` was right and this one was stale. It
    // is now the same symbol so the two cannot part company again. Measured
    // after: the ceiling binds 4.7% of months instead of 45.3%, and buildEma's
    // median lands at 0.0189 against a pivot of 0.018 — the permanent drift is
    // gone. The FLOOR is still never reached, and that is honest rather than
    // broken: reaching it needs the pipeline at a dead stop, and the quietest
    // 5% of months now run 0.0106 where they used to run 0.0002, because the
    // teardown pipeline can no longer swing between everything and nothing.
    // AND THE QUANTITY IT READ WAS RATIONED BEFORE IT GOT HERE.
    //
    // Every word of the paragraphs above is about what the trades CHARGE when
    // they are busy, and the number it read — the share of stock under
    // construction — is what the town MANAGED TO BUILD. Those are the same
    // quantity only in a market that clears. This one did not: `crewCapacity`
    // in dev.ts was a hard ceiling on simultaneous jobs, and measured over 6
    // seeds x 50 years the town wanted a median 2.7 cranes for every one it
    // could run, with headroom fully exhausted in 64-88% of months. So the
    // pipeline was pinned near the wall whatever the market wanted, and the
    // cost index could not tell a boom from an ordinary year:
    //
    //   corr(supplied quantity, next 12m real cost growth)   0.50 .. 0.83
    //   corr(DEMANDED quantity, next 12m real cost growth)  -0.10 .. 0.59, median 0.13
    //
    // A price that tracks the rationed quantity and not the demand for it is
    // not a price. The consequence was measurable and it ran the wrong way:
    // real construction cost FELL 0.3-2.2%/yr across fifty years in a town
    // with a permanent unbuilt order book, while real rent ROSE — so the
    // pro forma got easier the more desperate the shortage, and the only thing
    // left to ration space was rent. That is where the ~30-year rent cycle
    // with its 40-70% real drawdown came from.
    //
    // So the trades price off HOW BOOKED THEY ARE: the jobs running plus the
    // orders not yet started, against the crews available to take them. Both
    // ends of the existing calibration are kept and both now sit at a
    // utilisation that means something physically — the floor at about a third
    // employed, which is the 2009-10 anchor of real costs falling ~6%/yr. The
    // gain follows from that anchor rather than being chosen. `crewUtil` carries
    // the trades' non-speculative load — repair and fit-out, about 45% of all
    // construction work — so it bottoms out at 0.45 when there is no new build
    // to be had rather than at nothing, and 1.9 / 0.55 ~= 3.5.
    //
    // AND THE PIVOT IS NOW DEFINITIONAL. It was `REF_PIPE_SHARE`, an observed
    // equilibrium share that had to be re-measured twice and went stale twice —
    // once at 0.014 against a true 0.018, which put a permanent downward drift
    // on real costs. Full employment is 1.0 by construction. It cannot go
    // stale, and it is what the header of this block always said it wanted:
    // "THE PIVOT IS WHERE THE TRADES ARE FULLY EMPLOYED."
    //
    // BOTH ENDS OF THE CLAMP ARE THE REAL EXTREMES OF COST ESCALATION, and the
    // ceiling was not. Each bound is an annual real cost move divided by the
    // slope on that side, so the two are the same kind of statement:
    //
    //   floor    -6%/yr real / (0.0026 x 12) = -1.9     ENR/Turner, 2009-10
    //   ceiling  +6%/yr real / (0.0016 x 12) = +3.1     ENR/Turner, 2005-07 and 2021-22
    //
    // At +1.6 the ceiling asserted that the hottest construction market this
    // model can produce escalates at 3.1%/yr real — half of what a real boom
    // does — and it BOUND in 9-25% of months once the crew wall stopped
    // truncating utilisation upstream of it. That truncation was also a
    // permanent downward drift on real cost, because it cut the top off every
    // boom while leaving the busts intact, which is the same fault the stale
    // pivot had and arriving through a different door.
    const heat = clamp(((e.crewUtil ?? 1) - 1) * 3.5, -1.9, 3.1);
    const slope = heat < 0 ? 0.0026 : 0.0016;
    const costDrift = (e.inflExp ?? 0.02) / 12 + heat * slope + (e.phase === "recession" ? -0.0004 : 0);
    e.costIdx = clamp(e.costIdx * (1 + costDrift + rrange(s, -0.0012, 0.0012)), 0.6, 400);
  }

  recordHistory(e, s.month, monthAbs, monthComp);
}

/** Add real square feet to the citywide stock — a delivered building is supply. */
/**
 * Add or REMOVE square feet from the citywide inventory.
 *
 * The clamp was on the DELTA — `+ Math.max(0, sf)` — so every negative was
 * silently discarded, and there is exactly one caller that passes a negative:
 * the wrecking ball. Every building this city has ever torn down came off the
 * map and stayed in the economy's inventory forever. Measured over fifty
 * years, three seeds: 170 to 190 demolitions apiece, not one of them reducing
 * stock by a foot, and the economy finishing with 13-14% more space than is
 * standing on the map — multifamily worst at +24 to +31%, and industrial
 * pinned at its 1.2M floor from month zero while the real thing decayed to
 * 0.85M, a 42% overstatement.
 *
 * It is not a cosmetic number. `cityVac = 1 - occupied / stock` — the
 * denominator of citywide vacancy, which sets rent, which sets value, which
 * sets what pencils and what gets built. Phantom stock reads as slack, and
 * slack suppresses rent, so this was a downward bias on the entire rent
 * surface that grew for the length of the run.
 *
 * The clamp belongs on the RESULT, which is surely what was meant: a class can
 * be demolished down toward nothing, and it cannot go negative.
 */
export function addStock(e: Econ, k: keyof typeof CITY_STOCK, sf: number) {
  if (!e.stock) e.stock = { ...CITY_STOCK };
  e.stock[k] = Math.max(0, (e.stock[k] ?? CITY_STOCK[k]) + sf);
}

/**
 * How hard the citywide space market pushes prospects at YOUR door for a
 * given class. Tight market: everyone else is full, so the tenant that would
 * rather be elsewhere ends up touring your building. Glutted market: three
 * other landlords with empty floors return every call first.
 */
export function vacancyPull(e: Econ, use: keyof typeof NATURAL_VAC): number {
  const vac = e.cityVac?.[use] ?? NATURAL_VAC[use];
  return Math.max(0.4, Math.min(1.7, Math.pow(NATURAL_VAC[use] / Math.max(0.005, vac), 0.9)));
}

function recordHistory(e: Econ, q: number, abs?: Record<string, number>, comp?: Record<string, number>) {
  e.history.push({
    q,
    indexRate: +e.indexRate.toFixed(2),
    // The era the index is orbiting. Recorded because the GAP between the two
    // is the readable thing — a 6% rate is cheap money inside a 1970s and dear
    // money inside a 2010s — and a chart of the base rate alone cannot show it.
    rateRegime: e.rateRegime !== undefined ? +e.rateRegime.toFixed(2) : undefined,
    landIdx: +e.landIdx.toFixed(4),
    costIdx: +e.costIdx.toFixed(4),
    inflExp: e.inflExp !== undefined ? +e.inflExp.toFixed(5) : undefined,
    cycleDev: +e.cycleDev.toFixed(3),
    capOffice: +e.capRate.office.toFixed(2),
    rentOffice: +e.rentIdx.office.toFixed(2),
    creditIdx: +e.creditIdx.toFixed(3),
    employIdx: +e.employIdx.toFixed(3),
    population: e.population,
    jobs: e.jobs,
    unemployment: e.unemployment !== undefined ? +e.unemployment.toFixed(4) : undefined,
    wageIdx: e.wageIdx !== undefined ? +e.wageIdx.toFixed(4) : undefined,
    outputIdx: e.outputIdx,
    cpi: e.cpi !== undefined ? +e.cpi.toFixed(4) : undefined,
    vac: e.cityVac ? {
      office: +e.cityVac.office.toFixed(4), retail: +e.cityVac.retail.toFixed(4),
      multifamily: +e.cityVac.multifamily.toFixed(4), industrial: +e.cityVac.industrial.toFixed(4),
    } : undefined,
    rent: {
      office: +e.rentIdx.office.toFixed(2), retail: +e.rentIdx.retail.toFixed(2),
      multifamily: +e.rentIdx.multifamily.toFixed(2), industrial: +e.rentIdx.industrial.toFixed(2),
    },
    // what deals actually strike — asking net of the concession dial. The gap
    // between the two lines IS the state of the market (ECONOMY.md §2c).
    effRent: e.effRentIdx ? {
      office: +e.effRentIdx.office.toFixed(2), retail: +e.effRentIdx.retail.toFixed(2),
      multifamily: +e.effRentIdx.multifamily.toFixed(2), industrial: +e.effRentIdx.industrial.toFixed(2),
    } : undefined,
    cap: {
      office: +e.capRate.office.toFixed(2), retail: +e.capRate.retail.toFixed(2),
      multifamily: +e.capRate.multifamily.toFixed(2), industrial: +e.capRate.industrial.toFixed(2),
    },
    abs: abs ? {
      office: Math.round(abs.office ?? 0), retail: Math.round(abs.retail ?? 0),
      multifamily: Math.round(abs.multifamily ?? 0), industrial: Math.round(abs.industrial ?? 0),
    } : undefined,
    comp: comp ? {
      office: Math.round(comp.office ?? 0), retail: Math.round(comp.retail ?? 0),
      multifamily: Math.round(comp.multifamily ?? 0), industrial: Math.round(comp.industrial ?? 0),
    } : undefined,
  });
  if (e.history.length > 1260) e.history.shift();
}
