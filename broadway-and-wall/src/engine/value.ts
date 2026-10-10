// Valuation: honest economics, legible causality. Value = NOI ÷ cap rate;
// land = lot area × evolved land $/sf. Every number here is traceable from
// the parcel record and the market state — no hidden multipliers.
import type { ParcelRecord } from "@/data/types";
import type { Condition, Econ, GameState, Holding, Sector, Tenant } from "./types";
import { serviceSpec, START_YEAR, fundDepositsHeld } from "./types";
export { START_YEAR };
import type { BuiltClass, UseMix } from "./types";
import type { ConstructionQuote } from "./proforma";
import { blend, blendBy, commercialShare, uses, useSf } from "./mix";
import { industryStress, NATURAL_VAC, CAP_BASE, developerOptimism, concessionTarget, CONC_DEPTH } from "./market";
import { gpInterestInFund } from "./fund";
import { developmentProForma, marketConstructionQuote, farMaxFor, underwritingEcon, MAX_COVERAGE } from "./proforma";

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** The most envelope any ground in this city will ever carry, however it is
 *  rezoned and whatever the board grants. The generator's own maximum is 37. */
export const FAR_CEILING = 40;

/**
 * WHAT A LOT MAY HOST: ANYTHING (2026-10-10). This town has no zoning, like
 * Houston — the owner's call, and a real regime (Houston has never adopted
 * use zoning; voters rejected it in 1948, 1962 and 1993). What a lot becomes
 * is what pays there. The plat's district letters survive as a record of what
 * the generator drew and what the neighbourhood was; nothing reads them as
 * law. Kept as one function because every reader — the pencil, the shovel,
 * the residual, the desk — asks it, and one answer is what keeps them agreed.
 */
export function zonePermits(
  zone: string | undefined, use: BuiltClass, demand = 100, econ?: Econ,
): boolean {
  void zone; void use; void demand; void econ;
  return true;
}

/**
 * THE SAME RULE, ASKED BY THE DEVELOP DESK — and why not, in words.
 *
 * `zonePermits` priced the dirt, drew the city's cranes and the rivals' and
 * never once stood between the player and a shovel: the desk would plan and
 * break ground on two storeys of shops on an R6 lot the tape priced as flats
 * only, and measured, 4 of 10 affordable plans that cleared their hurdle were
 * uses the zoning does not host. One quantity, two answers (CLAUDE.md, fake
 * #3). This is the one rule, asked of a whole programme.
 *
 * A mixed programme is permitted when every use in it is — except shops at
 * grade. Street retail under flats or offices is what `withStreetRetail`
 * programmes on any lot (the pro forma does it on the "Always" setting too),
 * i.e. the accessory ground-floor commercial a residential district's
 * overlay allows, so retail up to that ground-floor share (a floor and a
 * quarter, never more than the two-plate cap) does not need the district to
 * host shops. Past it, the building is a shop building and it does.
 *
 * Returns null when the programme is legal here, or the reason it is not.
 */
export function zoneUseBar(
  rec: { zoneDist?: string; demandScore?: number }, use: BuiltClass | "mixed",
  econ?: Econ, mix?: UseMix, floors = 1,
): string | null {
  // No zoning: no programme is barred. See zonePermits.
  void rec; void use; void econ; void mix; void floors;
  return null;
}

/**
 * THE DEMAND SCORE IS A SCALE, NOT A PRICE.
 *
 * The pipeline reshapes raw location gravity with a gamma before it writes
 * `demandScore`. Gamma 1.9 was the un-plateau for a two-term blend that piled
 * at the top. The polycentric blend does not pile, so 1.9 crushed displayed
 * scores under the demand>70 office gate. 1.05 is a mild exclusivity bend
 * on a surface that already has a shape.
 *
 * What it is NOT is a repricing. Everything economic below this line reads the
 * gravity back out through `demandIdx`, so rents, land betas, cap-rate spreads
 * and expense loads are bit-for-bit what they were. Measured both ways over
 * fifty years: leaving the consumers reading the raw reshaped score moved the
 * competent player's median from $92.8M to $1.09B, because a steeper gradient
 * on prime ground is an enormous silent buff to anybody who buys prime ground.
 * A change about how a map READS has no business rebalancing the game, and if
 * the gradient should be steeper that is its own decision, made deliberately
 * with the harnesses and not smuggled in behind this one.
 */
const DEMAND_GAMMA = 1.05;   // must match DEMAND_GAMMA in src/citygen/build.mjs
export function demandIdx(demandScore: number): number {
  // One-entry memo: the pro forma asks this of the same lot dozens of times in
  // a row, and a pow is the whole cost. Pure, so the number cannot change.
  if (Object.is(demandScore, lastDemandIn)) return lastDemandOut;
  lastDemandIn = demandScore;
  return (lastDemandOut = Math.pow(Math.max(0, demandScore) / 100, 1 / DEMAND_GAMMA));
}
let lastDemandIn: number = NaN;
let lastDemandOut: number = NaN;
/** The reshaped score expressed back on the old 0-100 economic scale. */
export function demandLinear(demandScore: number): number {
  return 100 * demandIdx(demandScore);
}

// How hard a parcel's land value rides the cycle: prime demand swings harder.
export function demandBeta(demandScore: number): number {
  return 0.25 + 0.9 * demandIdx(demandScore);
}

// ------------------------------------------------- THE PLATE IS THE BUILDING
//
// A site is not just an area. Three lots of five thousand feet are three
// buildings, each carrying its own core, its own lift bank, its own lobby and
// its own two means of egress out of a floor plate too small to absorb any of
// them. One lot of fifteen thousand is ONE building: one core serving three
// times the area, a floor a tenant with a covenant will actually take, light
// on more than one side, and a lobby somebody can put an address on.
//
// That is the whole of why anybody assembles, and none of it was in the model.
// Measured before this block existed: three lots folded into one produced a
// building with 1.056x the floor area, 1.070x the basis and SEVEN BASIS POINTS
// LESS yield on cost than building on the three lots separately — and on a
// retail site, 1.001x of everything. `sf = lotArea x coverage x floors` is
// exactly additive in lot area, and the zoning envelope binds on 94.9% of
// merged sites against 46.2% of single lots, so merging moves the constraint
// off the plate curve (which rewards size) and onto the FAR curve (which is
// blind to it). Assembling bought you nothing but a legal fee.
//
// Three consequences of plate size, and they are all physical:
//
//   EFFICIENCY  A core is mostly fixed per floor. The share of a plate it eats
//               falls as the plate grows, so a big plate delivers more
//               rentable feet per gross foot you pay to build.
//   RENT        A big regular plate lets better, and lets to better names.
//               Offices and sheds care enormously; flats do not, because a
//               flat wants a window and a deep plate does not have one.
//   LAND        Dirt is worth what can be built on it. A lot too narrow to
//               reach the envelope it is zoned for is not worth its zoning,
//               and that discount is exactly what an assembler is buying up.
export { physicalMaxFloors } from "./structure";
import { physicalMaxFloors } from "./structure";

/**
 * The plate a median NEW building in this city actually carries — measured at
 * 4,325 ft² over 390 vacant lots, each planned at the coverage and height that
 * maximises its profit. Everything below is expressed RELATIVE to it, so the
 * median job's cost, the median building's rent and the median lot's land are
 * all unchanged and only the spread around them is new. This constant is the
 * difficulty dial for the whole of development: raising it makes every
 * building slightly worse and every big site relatively better.
 */
export const REF_PLATE_SF = 4300;
/** The median lot, for the same reason. */
export const REF_LOT_SF = 4950;
/**
 * THE FIXED PART OF A CORE IS VERTICAL CIRCULATION, AND A LOW BUILDING NEEDS
 * LESS OF IT.
 *
 * The 420 ft² a floor was always two exit stairs, a lift and the risers:
 * a code stair enclosure (44" flights, 48" landings) is about 170 ft² a floor,
 * so two are ~340; a passenger hoistway ~60; risers and shafts ~20. It was
 * charged on every floor of every building, which is right for the median
 * mid-rise and wrong at the bottom of the height range, which is exactly where
 * every small lot lives:
 *
 *   ONE STOREY  has no stair and no lift — its exits are doors at grade. What
 *               is left is walls, toilets and plant, the proportional 7%.
 *               (Single-storey retail and industrial are let on the footprint;
 *               the 0.92 ceiling on the ratio still binds.)
 *   NO LIFT     is the law, not a saving: the 2010 ADA Standards 206.2.3,
 *               Exception 1, do not require an accessible route between
 *               storeys in a private building of fewer than three storeys OR
 *               under 3,000 ft² a storey, and the walk-up is the ordinary
 *               small apartment building. Above four storeys nobody builds a
 *               walk-up whatever the code says, so five and up always has one.
 *               Two stairs stay in every case — IBC 1006 single-exit
 *               allowances are narrow and are not modelled.
 *
 * `floors` undefined is the old question (a plate with no height attached)
 * and keeps the full 420, so `plateEfficiency` — an index against the median
 * mid-rise plate — does not move.
 */
const CORE_STAIRS_SF = 360;   // two enclosed exit stairs + risers
const CORE_LIFT_SF = 60;      // one passenger hoistway
function verticalCoreSf(plateSf: number, floors?: number): number {
  if (floors === undefined || !Number.isFinite(floors)) return CORE_STAIRS_SF + CORE_LIFT_SF;
  const fl = Math.round(floors);
  if (fl <= 1) return 0;
  const lift = fl >= 5 || (fl >= 3 && plateSf >= 3000);
  return CORE_STAIRS_SF + (lift ? CORE_LIFT_SF : 0);
}
/** How much of a floor the core, the risers and the corridor take. */
function coreLoss(plateSf: number, floors?: number): number {
  return 0.07 + verticalCoreSf(plateSf, floors) / Math.max(400, plateSf);
}
const REF_CORE_LOSS = coreLoss(REF_PLATE_SF);
/**
 * RENTABLE FEET PER GROSS FOOT. The number the business actually uses.
 *
 * A floor is not all demiseable. The core, the two stairs, the risers and the
 * corridor take a bite that is mostly FIXED, so a big plate gives up a tenth
 * of itself and a narrow one gives up a quarter. `1 - coreLoss` runs 0.72 to
 * 0.92, which is the BOMA office range (BOMA 2017 / typical loss factor
 * 8–28%). This is a measured fact about buildings, not a coefficient.
 *
 * `bldgArea` stays GROSS — zoning counts it, the contractor bills it, the
 * map draws it. Every income, occupancy and space-market read goes through
 * `rentableSf` / `useRentableSf` so rent psf, NOI and cap rate are quoted
 * against the feet a tenant can actually sit in. One function, one answer.
 * A panel that computed its own haircut would be a second opinion.
 */
export function rentableRatio(plateSf: number, floors?: number): number {
  return clamp(1 - coreLoss(plateSf, floors), 0.72, 0.92);
}
/** The floor count the core is sized for — a record with none reads as one storey. */
const floorsOf = (rec: { floors: number }) => Math.max(1, rec.floors || 1);
export function rentableSf(rec: { bldgArea: number; floors: number }): number {
  if (!rec.bldgArea) return 0;
  return rec.bldgArea * rentableRatio(plateOf(rec), floorsOf(rec));
}
/** Rentable feet of a planned shell — same identity, no parcel yet. */
export function rentableFromSpec(gsf: number, floors: number): number {
  if (!(gsf > 0)) return 0;
  return gsf * rentableRatio(gsf / Math.max(1, floors), Math.max(1, floors || 1));
}
export function useRentableSf(rec: ParcelRecord, use: BuiltClass): number {
  return useSf(rec, use) * rentableRatio(plateOf(rec), floorsOf(rec));
}
/**
 * Plate quality against the median plate — an INDEX, not the rentable ratio.
 *
 * The true ratio is `rentableRatio`. This stays relative so a median new
 * building still reads 1.0 for land-quality and assemblage comparisons
 * (`siteQualityMult` divides by `REF_SITE_Q`). Capped at 1.0: rentable
 * cannot exceed gross, and the old un-capped form stored big-plate offices
 * with more area than they were zoned for.
 */
export function plateEfficiency(plateSf: number): number {
  return clamp((1 - coreLoss(plateSf)) / (1 - REF_CORE_LOSS), 0.78, 1.0);
}

// Who cares about a big floor. A shed cares most — a clear-span box IS the
// product. An office cares nearly as much. A shop cares about frontage, which
// a wide site also buys. A flat does not care at all: past about eighty feet
// of depth there is no window, and the extra area is corridor. So assembling
// gets you an office or an industrial site, and not necessarily a residential
// one, which is a decision rather than a bonus.
const PLATE_RENT_BETA: Partial<Record<BuiltClass, number>> = {
  office: 0.07, retail: 0.05, industrial: 0.08, multifamily: 0,
};
export function plateOf(rec: { bldgArea: number; floors: number }): number {
  if (!rec.bldgArea || !rec.floors) return REF_PLATE_SF;
  return rec.bldgArea / Math.max(1, rec.floors);
}
/** What a bigger floor is worth in rent, per doubling, against the median. */
/**
 * A SHOP IS LET BY ITS FRONT.
 *
 * The plate beta above stood in for frontage — "a wide site also buys it" —
 * because no lot in the city had a frontage to read. Street plan 4 measures
 * one, and retail is then priced the way retail is actually valued: the
 * zoning method (RICS; the standard for shop rents in Britain and the logic
 * of every "price per front foot" quote in America). The first 20 ft back
 * from the window is Zone A at full rate; each further 20 ft is worth half the
 * one in front of it; past 60 ft the remainder is an eighth. So a shop's rent
 * per square foot falls with its depth, and the same floor area laid shallow
 * along a wide front lets for more than laid deep behind a narrow one — which
 * is what assembling two 25 ft lots into one 50 ft shop buys.
 *
 * Depth is the building's plate over the lot's frontage. Expressed against
 * REF_SHOP_DEPTH_FT, the median shop's plate depth measured on plan-4 towns
 * (1,881 standing shops over the twelve harness seeds: median 38.3 ft,
 * quartiles 25 and 60; per-seed medians 30-50), so the median
 * shop's rent is unchanged and only the spread around it is new — the same
 * convention as REF_PLATE_SF. The zone width and halving are the method's own
 * constants, not tuned. The clamp is a guard: a plate under 20 ft deep is all
 * Zone A (the ceiling, 1.57) and only a big box past ~250 ft reaches the floor.
 */
const ZONE_FT = 20;
export const REF_SHOP_DEPTH_FT = 38;
function zonedPerSf(depthFt: number): number {
  const d = Math.max(1, depthFt);
  const zoned = Math.min(d, ZONE_FT)
    + 0.5 * Math.min(Math.max(d - ZONE_FT, 0), ZONE_FT)
    + 0.25 * Math.min(Math.max(d - 2 * ZONE_FT, 0), ZONE_FT)
    + 0.125 * Math.max(d - 3 * ZONE_FT, 0);
  return zoned / d;
}
export function shopFrontMult(rec: { bldgArea: number; floors: number; lotFront?: number; lotDepth?: number }): number | null {
  if (!rec.lotFront || rec.lotFront <= 0) return null;
  const depth = plateOf(rec) / rec.lotFront;
  const capped = rec.lotDepth && rec.lotDepth > 0 ? Math.min(depth, rec.lotDepth) : depth;
  return clamp(zonedPerSf(capped) / zonedPerSf(REF_SHOP_DEPTH_FT), 0.3, 1.6);
}
export function plateRentMult(rec: { bldgArea: number; floors: number; lotFront?: number; lotDepth?: number }, use: BuiltClass): number {
  if (use === "retail") {
    const f = shopFrontMult(rec);
    if (f !== null) return f;
  }
  const beta = PLATE_RENT_BETA[use] ?? 0;
  if (!beta) return 1;
  const p = plateOf(rec);
  if (p <= 0) return 1;
  return clamp(1 + beta * (Math.log(p / REF_PLATE_SF) / Math.LN2), 0.85, 1.10);
}

const COVERAGE_LADDER = [0.35, 0.45, 0.55, 0.65, 0.75, 0.85];
/**
 * How much of its own zoning envelope this dirt can physically carry, at the
 * best coverage available to it. A 2,500 ft lot zoned for ten FAR cannot build
 * ten FAR — the plate will not carry the floors — so it is not worth ten FAR.
 */
export function envelopeRealisation(rec: { lotArea: number; farMaxComm: number; farMaxRes: number }): number {
  const far = Math.max(rec.farMaxComm, rec.farMaxRes);
  if (!rec.lotArea || far <= 0) return 1;
  let best = 0;
  for (const cov of COVERAGE_LADDER) {
    const fl = Math.min(Math.floor(far / cov), physicalMaxFloors(rec.lotArea * cov));
    best = Math.max(best, cov * Math.max(1, fl));
  }
  return clamp(best / far, 0.30, 1);
}
/** The median lot reaches 98.5% of its envelope. Measured over three cities. */
const REF_REALISATION = 0.985;
const siteQ = (plateSf: number) => plateEfficiency(plateSf) * plateRentMult({ bldgArea: plateSf, floors: 1 }, "office");
const REF_SITE_Q = siteQ(REF_LOT_SF * 0.70);
/**
 * What a foot of THIS dirt is worth against a foot of median dirt, before the
 * cycle and before location. A site that can reach its envelope and carry a
 * good building is worth more per foot than one that cannot — which is the
 * entire economics of assemblage, stated once, in the one place land is priced.
 * Three narrow lots stuck at 70% of their envelope are each discounted; folded
 * into one site that reaches 100%, all three lots' worth of dirt reprices.
 */
export function siteQualityMult(rec: { lotArea: number; farMaxComm: number; farMaxRes: number }): number {
  if (!rec.lotArea) return 1;
  const useable = envelopeRealisation(rec) / REF_REALISATION;
  return clamp(useable * (siteQ(Math.max(400, rec.lotArea * 0.70)) / REF_SITE_Q), 0.82, 1.22);
}

/**
 * WHAT IT COSTS TO PUT UP A BUILDING — THE LOW-RISE BASE. These live here,
 * below dev.ts, because land is priced as a residual and a residual cannot be
 * computed without them. dev.ts re-exports them, so every caller is untouched.
 *
 * THESE USED TO BE SOLVED BACKWARDS AND THE COMMENT SAID SO: "not observed
 * averages... SOLVED: the cost at which a new building on a median site yields
 * about 150bp over its own exit cap." That is CLAUDE.md's fake number #1 stated
 * out loud — a constant chosen to make an outcome come out right — and it had
 * stopped producing even the outcome it was solved for. Measured by
 * `pnpm breakeven`, which inverts the engine's own residual: office on a median
 * site needed 171% MORE rent than it earned, retail 121% more, multifamily 51%
 * more. Not 150bp over. Underwater, by multiples, on three classes out of four.
 *
 * And the fourth was the tell. Industrial was the only class whose cost had
 * never been inflated to match, so it was the only one that cleared its own
 * bar — which meant a two-floor shed outbid every other use for 82% of the
 * sites in the city, `pnpm devyield` reported 0 office sites pencilling of
 * 1,363 and 0 retail, and the city kept building office anyway because
 * `devPencils` never looked at any of this.
 *
 * So these are observed now, and they are the LOW-RISE BASE — `heightPremium`
 * takes them up a real cost curve from there, which is the structure the old
 * table did not have. Sources are 2024 US, secondary-market (the comparison
 * class is Providence / Charleston / Portland ME, NOT Manhattan — a 250,000
 * -person harbour town does not build at CBD trophy prices, and calibrating to
 * the famous markets is what put $865/sf on a two-storey shop):
 *
 *   office       RSMeans 2025 office range $202-574/sf, single-storey average
 *                $313; secondary-market low-rise clusters $240-350.
 *   retail       RSMeans 2024 retail store national average $214/sf. Strip
 *                centres run $309-371 but carry sitework and parking fields
 *                this game's two-storey street shops do not.
 *   multifamily  mid-rise $210-310/sf, secondary markets $300-350. This is the
 *                low-rise base, so it sits under the mid-rise figure.
 *   industrial   modern warehouse / flex, $90-150/sf. The one number that was
 *                already right, which is exactly why it broke everything else.
 */
export const HARD_COST_PSF: Record<BuiltClass, number> = {
  office: 295,        // RSMeans single-storey office $313; secondary low-rise $240-350
  multifamily: 300,   // low-rise base under the $310 mid-rise national average
  retail: 245,        // RSMeans retail store $214, above it for two-storey urban shell
  industrial: 100,    // modern warehouse/flex $90-150 — was 125; class never cleared hurdle
};

/**
 * HEIGHT COSTS MONEY, AND IT COSTS MORE THAN THIS LADDER USED TO SAY.
 *
 * The same square foot on floor forty needs more structure, more lift, more
 * hoisting and more time than it does on floor two. The old ladder topped out
 * at 1.28 and was WRITTEN OUT FOUR TIMES — value.ts:421, dev.ts:563, dev.ts:690
 * and rivals.ts:260 — four copies of one quantity that happened to agree. They
 * would not have agreed for long: this change alone would have moved one and
 * left three, silently, which is how CLAUDE.md's fault #3 gets created rather
 * than found. One function now, four callers.
 *
 * The old table hid the ladder's weakness because its BASE was already a
 * high-rise number: $560/sf office meant a two-storey building was priced like
 * a tower and a tower was priced like a two-storey building with a 28% tip. On
 * an honest low-rise base the premium has to do real work, and the real curve
 * is much steeper — roughly +15% at 5-8 storeys, +45-50% at 19-30, and +80-100%
 * above that, against low-rise. Checked against the source range: 295 * 1.85 =
 * $546/sf for a forty-storey tower, which lands inside RSMeans' $202-574 office
 * band at the top where a tower belongs.
 *
 * This is also what stops every lot becoming a tower. A ladder that is too flat
 * makes floor area nearly free above the eighth storey, and then the only thing
 * limiting height is the zoning — which is a rule, not an economy.
 *
 * A CURVE, NOT A STAIRCASE. The bands above were written as steps — 1.00 to
 * eight storeys, 1.16 to eighteen, 1.48 to thirty, 1.85 beyond — and a step
 * prices the WHOLE building at the new band the moment one floor crosses it:
 * the 31st storey repriced the thirty below it by 25%, and a plan's yield on
 * cost fell a full point for one more floor (tools/mdga/floor-scan.mjs). The
 * cost surveys the bands come from are band AVERAGES of a smooth rise, and
 * nothing in a building code sits at 9, 19 or 31 storeys. So each band's level
 * now sits at its middle and the premium runs straight between them: 1.00
 * through four storeys, 1.16 at thirteen, 1.48 at twenty-four and a half, 1.85
 * at forty (the tower the RSMeans check above was made on), and on to 2.00 by
 * sixty — inside the +80-100% the source gives above thirty — flat past it,
 * where slenderness (maxFloorsFor) governs rather than cost. A real step does
 * exist where the construction TYPE changes, which is why the wood-frame
 * apartment ladder below keeps its steps: that one is the building code.
 */
const HEIGHT_PREMIUM_PTS: [number, number][] = [[4, 1], [13, 1.16], [24.5, 1.48], [40, 1.85], [60, 2.0]];
export function heightPremium(floors: number): number {
  const fl = Math.max(1, floors || 1);
  const pts = HEIGHT_PREMIUM_PTS;
  if (fl <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    if (fl <= x1) {
      const [x0, y0] = pts[i - 1];
      return y0 + ((y1 - y0) * (fl - x0)) / (x1 - x0);
    }
  }
  return pts[pts.length - 1][1];
}
/**
 * WHAT A LOW-RISE APARTMENT IS BUILT OF (MDGA phase 2).
 *
 * `HARD_COST_PSF.multifamily` is labelled the low-rise base but sits at $300,
 * a hair under the $310 national MID-rise average — the price of a concrete
 * or steel-and-podium building. A three-storey walk-up is not that building:
 * it is wood frame on a slab, and it costs a good deal less per foot. RSMeans
 * 2024 secondary-market apartments: 1-3 storeys about $200/sf, 4-7 storeys
 * (wood over a podium) about $250/sf, against the ~$300 base from eight up.
 * As multiples of that base: 0.68 and 0.83. The ladder for every other class
 * is untouched — an office or a shop is not framed in timber.
 *
 * Measured before this existed, at the opening bell: a three-storey and a
 * six-storey apartment block cost the same $313/sf, so the product a young
 * town actually builds on its edge (the garden walk-up) was priced as a tower
 * and the outskirts, 85% of the vacant land, never paid in fifty years.
 */
export function constructionTypeMult(use: BuiltClass, floors: number): number {
  if (use !== "multifamily") return 1;
  const fl = Math.max(1, floors || 1);
  return fl <= 3 ? 0.68 : fl <= 7 ? 0.83 : 1;
}
export const SOFT_COST = 0.16;    // design, legal, permits, insurance, financing fees
export const CONTINGENCY = 0.06;  // held against change orders; unspent is yours

/**
 * THE DEVELOPER'S MARGIN — what the trade requires to take the risk, as a
 * share of cost. 15-20% on cost is the standard hurdle a lender underwrites
 * to and a developer will not go below; below it, nobody breaks ground.
 */
export const DEV_MARGIN = 0.17;

/** One mathematical hurdle for class orders, parcel plans and land residuals. */
export function developmentHurdle(yieldOnCost: number, exitCap: number): {
  requiredYield: number;
  hurdleRatio: number;
  clears: boolean;
} {
  const requiredYield = exitCap * (1 + DEV_MARGIN);
  const hurdleRatio = yieldOnCost / Math.max(1e-6, requiredYield);
  return { requiredYield, hurdleRatio, clears: hurdleRatio >= 1 };
}
/*
 * A RESIDUAL IS A FUTURE NUMBER AND LAND IS BOUGHT TODAY. This was a fixed
 * BUILD_DISCOUNT of 1/1.12^2.5 = 0.752 on every scheme, and the desk charged
 * the same wait nothing — so a lot bought at exactly its residual read a
 * hurdle well above 1.0 at the desk. It is `landCarryFactor` (proforma.ts)
 * now, at the same 12% land rate, for the scheme's own construction schedule,
 * and the desk carries the identical charge in its basis.
 */
/**
 * AND WHEN NOTHING PENCILS TODAY, THE DIRT IS STILL WORTH SOMETHING.
 *
 * Most land in most cities does not support a new building at today's rents,
 * and it does not therefore trade at zero — it trades on the option. Somebody
 * holds it, pays the taxes and waits for the rent to arrive, and what they
 * will pay is the residual at the rents they expect at the next peak,
 * discounted for the wait. About five years at the same 12%:
 *   1 / 1.12^5 = 0.567
 * and a peak is worth roughly a quarter more than the middle of the cycle,
 * which is the amplitude the rent index actually runs at.
 */
const WAIT_DISCOUNT = 0.567;
const PEAK_RENT_MULT = 1.25;

/**
 * THE SHAPE EACH USE HAS. Shops and sheds are flat — two floor plates is the
 * whole allowance, for the same reason in both cases: the use has a shape.
 * dev.ts re-exports these; they live here because the residual has to know
 * them or it prices a fringe lot as thirty storeys of shops.
 *
 * Getting this wrong was the first draft's biggest error and it is worth
 * writing down: the residual took the best use over the FULL envelope, so a
 * 15.7-FAR lot was priced as fifteen floor-plates of retail at $865/sf
 * against retail rents. That produced a land price nothing could pay, and
 * measurably: zero jobs pencilled anywhere in the city.
 */
export const RETAIL_FLOORS_MAX = 2;
export const INDUSTRIAL_FLOORS_MAX = 2;

/** The four things anybody would consider building here. */
const RESIDUAL_USES: BuiltClass[] = ["office", "retail", "multifamily", "industrial"];
const USE_FLOORS_MAX: Partial<Record<BuiltClass, number>> = {
  retail: RETAIL_FLOORS_MAX,
  industrial: INDUSTRIAL_FLOORS_MAX,
};

/**
 * THE SCHEMES A BUILDER WOULD DRAW HERE, as the desk's own dials: floors and
 * site coverage. The coverage is chosen so the scheme sits inside the envelope
 * the city will permit (`far`), which means the desk — planning against the
 * legal envelope — draws exactly the same building from the same two numbers.
 * Each use at its own coverage limit (`MAX_COVERAGE`: flats 70%, offices 80%,
 * shops and sheds 85%). `developmentProForma` then applies the structure clamp the desk
 * applies, and the scheme reports what it actually drew.
 */
function residualFloorChoices(use: BuiltClass, far: number): { floors: number; coverage: number }[] {
  // THE COVERAGE IS THE USE'S, AND THE DESK'S (MAX_COVERAGE, proforma.ts). The
  // residual held offices and flats to 70% and shops and sheds to 85% while
  // the desk let all four cover 90%, so the desk's land value ran 1.2-1.9x
  // the market's on the same lot. One limit now, read by both.
  const covMax = MAX_COVERAGE[use];
  const envelopeFl = Math.max(1, Math.round(far / covMax));
  // Shops and sheds: every storey up to the use's cap — the one-storey box has
  // no stair to pay for (see the note below), and the two-storey one is drawn
  // even where it cannot fill its plate, because the desk can draw it too.
  const floors = schemeFloorLadder(use, envelopeFl);
  return floors.map((fl) => {
    const usable = Math.min(far, fl * covMax);
    return { floors: fl, coverage: usable / fl };
  }).filter((c) => c.coverage > 0);
}

/**
 * THE HEIGHTS A BUILDER CONSIDERS on a lot whose envelope reaches `envelopeFl`
 * storeys — the land residual's ladder, exported so every reader that asks
 * "does anything pencil here" asks it of the same buildings (dev.ts's site
 * sampler did not, and priced only the envelope).
 */
export function schemeFloorLadder(use: BuiltClass, envelopeFl: number): number[] {
  const cap = USE_FLOORS_MAX[use];
  return cap !== undefined
    ? Array.from({ length: cap }, (_, i) => i + 1)
    // A builder picks the height that maximises residual, not the zoning
    // maximum. Pricing every office/multifamily lot as a tower made
    // heightPremium sink those uses while the desk (capped at 14, coverage
    // 0.6) said they pencilled — one quantity, two answers. Low-rise (no
    // premium), mid-rise, and the envelope are the three rungs the cost
    // ladder actually has.
    //
    // ...AND THE BOTTOM OF THE LADDER HAS RUNGS OF ITS OWN. A one-storey
    // building carries no stair and no lift; two storeys need stairs and no
    // lift; up to four can still be a walk-up on a small plate (see
    // `verticalCoreSf`). On fringe dirt, where eight storeys of anything cost
    // more than they are worth, one of those is what actually gets built —
    // and the Develop desk could already draw it, so the desk found schemes
    // with a positive residual on lots the land market read as having no
    // builder at all (measured: 21 of 434 vacant 3-5k sf lots, 20 of 287
    // 5-8k, at coverage the residual also uses; tools/smalllot-lines.mjs).
    : [...new Set([1, 2, 4, 8, 14].map((f) => Math.min(f, envelopeFl)).concat(envelopeFl))];
}

/**
 * THE RESIDUAL: WHAT A FOOT OF THIS DIRT IS WORTH TO THE ONLY PERSON WHO CAN
 * USE IT.
 *
 * This is the fix for the fault that paid for the whole $6M-to-$200M run.
 * `landPsfNow` used to be `rec.landPsf` — a static number stamped on the
 * parcel by the city generator — multiplied by indices. It never read what
 * could be BUILT on the lot. The only channel from the envelope to the price
 * was `siteQualityMult`, and measured across 1,421 parcels that channel was
 * broken in three separate ways at once: 29.4% of the city rested on its
 * [0.82, 1.22] clamp, its correlation with buildable FAR was -0.305, and its
 * correlation with demand was -0.283. Both BACKWARDS. `pnpm audit` reports
 * backwards as worse than broken, because a wire that transmits the wrong way
 * is a fake that also lies.
 *
 * The consequence was that land price per buildable square foot FELL across
 * the top demand deciles ($157.89 -> $60.74 -> $88.12) while the residual
 * doubled and doubled again ($110.73 -> $202.89 -> $477.73), and land came to
 * 13.6% of an all-in development budget on the best corners in town against
 * 35-50% in life. Buildings were therefore worth far more than they cost, and
 * the difference was simply handed to whoever broke ground.
 *
 * So: land is valued the way land is actually valued. Take the highest and
 * best use, work out what the finished building is worth, subtract what it
 * costs to build and the margin the trade requires, and what is left is what
 * somebody can pay for the dirt. This is the residual method and it is the
 * primary approach for any site whose value is in its development potential.
 *
 * Everything it needs — rent, occupancy, operating cost, recovery, cap rate,
 * construction cost — is already modelled and none of it reads land value, so
 * there is no circularity. The envelope enters where it belongs: multiplied
 * through the buildable area, which is why a 34-FAR lot is now worth many
 * times a 2-FAR lot beside it instead of slightly less.
 */
/**
 * THE WINNING SCHEME AND THE NUMBER IT PRODUCES, WHICH ARE THE SAME CALCULATION.
 *
 * The parcel card used to work this out again in the UI — its own envelope, its
 * own margin algebra, its own cost path through `planDevelopment` — and got a
 * different answer. Median −$0.08M on the card against $0.46M in the engine for
 * the same lots. CLAUDE.md names that fault directly: the same quantity with two
 * different answers means one of them is fiction and the player is being shown a
 * decision that is not the decision they are taking.
 *
 * Four things differed and every one of them was defensible on its own. The card
 * forced 0.6 site coverage and derived floors from FAR, so it never found the
 * best scheme. It took the margin as `value·(1−m)` where the engine takes
 * `value/(1+m)`. It skipped BUILD_DISCOUNT entirely, so it was pricing a
 * completed building and calling it dirt. And it read spot rent where the engine
 * reads `rentExp`. Agreeing on four numbers by hand is not a fix; there being
 * only one number is.
 *
 * So the residual returns its working, `residualLandPsf` is the same call with
 * the working thrown away, and the card renders what the engine decided. The two
 * cannot drift again because there is no longer a second one to drift.
 */
export type ResidualScheme = {
  /** $/sf of LAND, after the builder's margin and the wait. What the dirt is worth. */
  psf: number;
  use: BuiltClass;
  /** $/sf of BUILDING: what it is worth finished, and what it costs all-in to build. */
  valuePsf: number;
  costPsf: number;
  /** The envelope this use can actually reach here, as FAR, and the floors it implies. */
  usable: number;
  floors: number;
  /** Site coverage — with floors, the desk's two dials; the Develop desk opens on both. */
  coverage: number;
  /**
   * EVERY USE THAT WAS CONSIDERED, AND WHAT IT BID — including the ones that
   * could not cover their own construction, which are reported as a negative
   * bid rather than dropped. A residual that only reports its winner cannot be
   * asked the one question worth asking of it, which is WHO ELSE WAS CLOSE.
   * The first time it was asked, the answer was that industrial was the high
   * bidder for nine lots in ten and office for none of them.
   */
  all: { use: BuiltClass; psf: number }[];
};

export function residualLandPsf(rec: ParcelRecord, econ: Econ, rentMult = 1): number {
  return residualScheme(rec, econ, rentMult)?.psf ?? 0;
}

export function residualScheme(rec: ParcelRecord, econ: Econ, rentMult = 1): ResidualScheme | null {
  return residualSchemeIn(rec, econ, rentMult, null);
}

/** `ctx` is landPsfNow's per-market cache; null everywhere else. Same numbers. */
function residualSchemeIn(rec: ParcelRecord, econ: Econ, rentMult: number, ctx: LandCtx | null): ResidualScheme | null {
  if (!rec.lotArea) return null;
  // The envelope you can actually reach, not the one the zoning text allows.
  // This is what siteQualityMult was reaching for and could not express as a
  // price multiplier: a narrow lot that cannot fit an efficient floor plate
  // builds less, and building less is exactly how that fact should reach the
  // price. Folding three such lots into one site raises the realisation for
  // all three, which is the entire economics of assemblage.
  // THE ENVELOPE THE CITY WILL PERMIT, NOT THE ONE THE ZONING TEXT ALLOWS.
  //
  // `envelopeRealisation` is PHYSICAL — can this plate carry that FAR. It is
  // not the whole story, because the city also has a behavioural cornice:
  // `cityInfillCap` (dev.ts) is what a shovel actually gets, and on this
  // city's best corners it runs 5-8 floors against a legal 17-56. Pricing dirt
  // on the legal envelope therefore sold a building nobody would be permitted
  // to build — measured at year 15 on the prime office lot, land at $9,624 per
  // square foot of LAND, struck on a 14-floor scheme where the envelope
  // allowed six, giving 5.29% yield on cost against a 6.68% hurdle while yield
  // on cost EX LAND was 15.0%. The building was never the problem.
  //
  // `econ.infillShare` is the median buildable-over-legal ratio, published
  // once a year by the same sampler that already walks these lots (dev.ts).
  // This function is handed only (rec, econ) and cannot call cityInfillCap
  // itself, which is why the share travels on econ rather than being computed
  // here. Absent on old saves and read as 1, which is the old behaviour.
  //
  // ...AND THE HEIGHT IS THIS LOT'S, NOT THE TOWN'S MEDIAN. A single median
  // share applied to every lot priced dirt for more floors than the city's
  // own height rule allows on lots whose comp set is short (measured, seeds
  // 9001/9005 at years 10 and 18: 2-13% of builder-priced vacant lots, whose
  // residual scheme then planned at hurdle 0.93-0.99 at the floors the shovel
  // actually gets — land priced for a building nobody could put up), and for
  // fewer where the comp set is tall. A record resolved against a state
  // carries its block's cornice datum and the town's maturity, and each use's
  // envelope is capped at `heightCapFloors` on exactly those — the rule
  // `cityInfillCap` applies to every autonomous start. `infillShare` survives
  // only for a record nobody resolved (no state to read the skyline from).
  const legalFar = farMaxFor(rec) * envelopeRealisation(rec);
  const known = rec.cornice !== undefined && rec.maturity !== undefined;
  const far = known ? legalFar : legalFar * clamp(econ.infillShare ?? 1, 0.15, 1);
  if (!(far > 0)) return null;

  let best: ResidualScheme | null = null;
  const all: { use: BuiltClass; psf: number }[] = [];
  const uw = ctx ? ctxUnderwriting(ctx, econ, rentMult) : underwritingEcon(econ, rentMult);
  const quote = ctx
    ? (mix: UseMix) => ctxQuote(ctx, econ, mix)
    : (mix: UseMix, preReserve: number) => marketConstructionQuote(econ, mix, preReserve);
  for (const use of RESIDUAL_USES) {
    if (!zonePermits(rec.zoneDist, use, rec.demandScore, econ)) continue;
    const farUse = known
      ? Math.min(far, heightCapFloors(rec.cornice!, rec.maturity!, econ, rec, use) * MAX_COVERAGE[use])
      : far;
    const choices = residualFloorChoices(use, farUse);
    if (!choices.length) continue;

    let bestForUse = -Infinity;
    for (const { floors, coverage } of choices) {
      // THE DESK'S OWN PRO FORMA, SOLVED FOR THE DIRT.
      //
      // This used to be a second pro forma written out by hand — its own
      // occupancy, its own rent, its own lease-up, its own interest, its own
      // wait — and it disagreed with the desk by -30% to +45% on the same lot
      // and the same scheme (see proforma.ts for the term-by-term account).
      // Now it is `developmentProForma`, the function `planDevelopment` calls,
      // with the two inputs only the desk knows filled the way the market
      // fills them: the construction loan comes from the volume desk on
      // market terms, and the lot is priced as if vacant (demolition is the
      // seller's problem in an appraisal, and a vacant lot has none).
      //
      // Stabilised NOI and the tax-loaded exit yield are the street's own
      // (`noiYr`, `capRateFor` + `taxBorneShare`), read at the underwritten
      // market (`rentExp`, `capExp` — see underwritingEcon). What is left is
      // the algebra of the hurdle, run backwards:
      //
      //   the desk clears exactly when  NOI / basis = exitYield × (1 + margin)
      //   with                          basis = build + reserves + points + land × (1 + carry)
      //   so the dirt can cost          land = (value / (1 + margin) − build − reserves − points) / (1 + carry)
      //
      // which is the residual method with the margin taken on value and the
      // wait charged at the land rate for the scheme's own schedule.
      const pf = developmentProForma(rec, econ, {
        use, floors, coverage, contract: "gmp", spec: 0.5,
        envelopeFar: farUse, asIfVacant: true, rentMult, uw,
        quote,
      });
      if (!pf || !(pf.exitYieldPct > 0)) continue;
      const value = pf.stabNoi / (pf.exitYieldPct / 100);
      const landTotal = (value / (1 + DEV_MARGIN) - pf.nonLandBasis) / (1 + pf.landCarryRate);
      const psf = landTotal / rec.lotArea;
      if (psf > bestForUse) bestForUse = psf;
      if (!(landTotal > 0)) continue;
      if (!best || psf > best.psf) {
        best = {
          psf, use,
          valuePsf: value / pf.gsf,
          costPsf: pf.nonLandBasis / pf.gsf,
          usable: pf.gsf / rec.lotArea,
          floors: pf.floors,
          coverage: pf.coverage,
          all,
        };
      }
    }
    all.push({ use, psf: Number.isFinite(bestForUse) ? bestForUse : 0 });
  }
  return best && { ...best, all };
}

/**
 * WHY THE DIRT COSTS WHAT IT COSTS — the three bids, and which of them won.
 *
 * `landPsfNow` is this with the reasoning discarded. The panel wants the
 * reasoning, and it must not go and work it out again: that is how the residual
 * on the parcel card came to disagree with the residual in the engine.
 */
export type LandRead = {
  /** The price, $/sf of land. Identical to `landPsfNow` by construction. */
  psf: number;
  /** The three bids, each already carrying its own discount, $/sf of land. */
  builder: number;
  holder: number;
  texture: number;
  /** Which bid set the price, and the scheme behind the builder's. */
  winner: "builder" | "holder" | "texture";
  scheme: ResidualScheme | null;
};

/**
 * DOES BUILDING PAY, CITY-WIDE, CLASS BY CLASS — one pro forma, read by
 * everyone who can dig a hole.
 *
 * The distribution half of that sentence was fixed a while ago and the pro
 * forma half was not. This used to live in market.ts and read nothing real:
 *
 *     underwritten = rentIdx[k] / RENT_BASE[k]
 *     required     = rateEma/100 + DEV_SPREAD          // 7.25%, class-blind
 *     yoc          = BASE_YOC * underwritten / costIdx // 7.3% base, class-blind
 *
 * Three faults in three lines. It never touched HARD_COST_PSF, so a cost table
 * that was wrong by a factor of two was invisible to the thing deciding how
 * much got built. It never touched the class's own cap rate, so one hurdle
 * served office at CAP_BASE 8.50 and flats at 5.60 — about 270bp too loose for
 * one and 70bp too strict for the other, in opposite directions, at the same
 * time. And it measured the hurdle against a DEBT index, when what a developer
 * needs to clear is the yield the finished building will trade at.
 *
 * So it is a pro forma now, built from the same tables the residual and the
 * desk read: the class's own effective rent, its own opex, its own recovery,
 * the management fee that `noiYr` charges, its own hard cost, and a hurdle of
 * its own exit cap plus the developer's margin — the same DEV_MARGIN the land
 * residual takes out before it prices dirt. When the three models disagree now
 * it is because they are looking at different sites, not different worlds.
 *
 * WHERE it underwrites matters as much as what. A city builds on its good
 * corners, so this asks the question at `locIdxDevP90` — the ninth decile of
 * the town's buildable lots — through the same `locationRentMult` every other
 * rent in the engine goes through, which is what gives each class its own
 * prime-to-fringe spread. Asked at the mean instead, multifamily yields 5.28%
 * against a 6.55% hurdle and city supply stops dead, while `pnpm devyield`
 * finds 66 multifamily sites that clear. The mean site is not where anybody
 * builds.
 *
 * The response curve is unchanged and it is a SHAPE PARAMETER, stated as such:
 * appetite is a multiplier rather than a gate because a developer with a site
 * and a conviction still builds into a thin margin — he just does it less
 * often — and a negative margin stops him dead.
 */
export function devPencils(e: Econ, k: BuiltClass = "office"): number {
  const pivot = e.locIdxMeanBy?.[k] ?? e.locIdxMean ?? 0.62;
  const shape = LOC_SPREAD[k] ?? LOC_SPREAD.office;
  const where = e.locIdxDevP90 ?? e.locIdxMean ?? 0.62;
  const locMult = Math.min(shape.max, Math.max(shape.min, Math.pow(where / Math.max(0.01, pivot), shape.exp)));

  // Developers chase the trend; the residual does not. developerOptimism
  // already said so and was unused. A jobs shock (spot above rentExp) now
  // underwrites above today's rent, which is how a pipeline overshoots.
  // THE BUILDING OPENS INTO THE MARKET AT DELIVERY, NOT TODAY'S (2026-10-09).
  // Every developer and every construction lender reads the pipeline: space
  // under construction is vacancy on the day it opens, less whatever the
  // market absorbs meanwhile. This read today's vacancy and today's
  // concessions, which in a pinned market stay pinned until the first
  // deliveries land, so every start in that window underwrote the same
  // shortage. Measured on industrial (3 worlds x 50 years): each time sheds
  // finally pencilled, 15-20% of stock started inside five years against a
  // shortage of ~4.5% of stock, and vacancy went to 15-25% for a decade.
  // What the market can absorb by delivery is the unhoused queue plus the
  // tenant base's trend growth over a typical build (18 months), at its own
  // demand elasticity.
  const nat = NATURAL_VAC[k];
  const vacNow = e.cityVac?.[k] ?? nat;
  const stkNow = Math.max(1, e.stock?.[k] ?? 0);
  const pipe = Math.max(0, e.pipeline?.[k] ?? 0);
  // Occupancy as the market publishes it — the vacancy every other line of
  // this pro forma reads — not a second, separately-kept quantity.
  const occNow = stkNow * (1 - vacNow);
  const queue = Math.max(0, e.structTight?.[k] ?? 0) * stkNow;
  const trendGrowth = Math.max(0, (e.classDrvTrend?.[k] ?? 0) * 18) * occNow;
  const vac = e.stock?.[k]
    ? clamp((stkNow + pipe - occNow - queue - trendGrowth) / (stkNow + pipe), 0, 1)
    : vacNow;
  // ...and the concession package that vacancy will command, against the one
  // today's vacancy commands. Both read off the same schedule, so with
  // nothing in the pipeline and nothing to absorb the rent is untouched.
  const effAt = (1 - CONC_DEPTH * concessionTarget(vac - nat))
    / Math.max(0.05, 1 - CONC_DEPTH * concessionTarget(vacNow - nat));
  const rent = (e.effRentIdx?.[k] ?? e.rentIdx?.[k] ?? 0) * effAt * locMult * (1 + developerOptimism(e, k));
  if (!(rent > 0)) return 0;
  // THE PRO FORMA READS THE MARKET'S VACANCY. This underwrote 90% (95% for
  // flats) whatever the market was doing, so the pipeline kept starting into
  // a glut: seed 20603 delivered 78 buildings while office vacancy sat at 30%
  // and the city lost a fifth of its people. A developer's lease-up
  // assumption is the market's, with a margin: untouched up to one and a
  // half times the natural vacancy, then down to half at three times it —
  // at which point nothing pencils, which is what a glut is for.
  const excess = Math.max(0, vac - 1.5 * nat);
  const leaseUp = Math.max(0.5, 1 - excess / (1.5 * nat));
  const occ = (k === "multifamily" ? 0.95 : 0.90) * leaseUp;
  // the P90 site's opex, not the mean's — same station as its rent
  const opex = opexPsf(k, e, false) * Math.pow(locMult, OPEX_LOC_ELASTICITY);
  const recov = RECOVERY_RATE[k] ?? 0;
  const egi = rent * occ + opex * recov * occ;
  const noiPsf = egi - opex - egi * MGMT_FEE;
  if (!(noiPsf > 0)) return 0;

  // A city's infill is low-rise; the tower is the exception and it prices
  // itself through `heightPremium` where it is actually planned — and
  // low-rise apartments are wood frame (constructionTypeMult).
  const costPsf = HARD_COST_PSF[k] * constructionTypeMult(k, 3) * e.costIdx * (1 + SOFT_COST) * (1 + CONTINGENCY);
  const yoc = noiPsf / Math.max(1, costPsf);
  const hurdle = developmentHurdle(yoc, (e.capRate?.[k] ?? CAP_BASE[k]) / 100);
  // THE RESPONSE CURVE WAS CALIBRATED FOR INPUTS THIS FUNCTION NO LONGER HAS.
  //
  // It returned `clamp((yoc / required - 1) * 3.2 + 0.55, 0, 2.2)`, and that
  // shape was fitted when the inputs were index ratios hovering near 1. Once
  // this became a real pro forma read at the ninth decile of buildable sites,
  // the ratio moved: `node tools/rails.mjs` measured the result sitting on the
  // 2.2 ceiling in 57.2% of all calls. A signal that is pinned at its maximum
  // in more than half of all months is a constant, and the pro forma underneath
  // it was being computed and then thrown away.
  //
  // That is the same lesson as everything else this week — change the inputs
  // and the thing downstream that was fitted to the old ones is now the model.
  // So the response is the same elasticity form `buildClimate` uses, for the
  // same reason and from the same literature: development responds to the ratio
  // of what a finished building is worth to what it costs, with a supply
  // elasticity around 1.2 for a land-constrained market. Neutral at parity by
  // construction — a deal that exactly clears its hurdle gets built at the
  // ordinary rate — positive without a floor, and unbounded above without a
  // ceiling, so neither rail carries anything.
  //
  // The clamp that remains is a guard on a ratio, not a shape: `required` is a
  // cap rate and cannot be zero, but a NaN upstream should not become infinite
  // appetite.
  return Math.min(3, Math.pow(Math.max(0, hurdle.hurdleRatio), Q_ELASTICITY_DEV));
}
/** Same supply elasticity `buildClimate` uses; see the note there. */
const Q_ELASTICITY_DEV = 1.2;

export function landPsfNow(rec: ParcelRecord, econ: Econ): number {
  // A PURE-PERFORMANCE MEMO — it changes no number. `landRead` runs two full
  // residuals (four uses × up to three schemes × one pro forma each) and the
  // tick asks it for the same lot many times a month: every rival mark, every
  // appraisal floor, every listing. The answer depends on exactly the fields
  // named in `landMarketMatches` / `landLotMatches` and nothing else, so it is
  // reused when every one of them is identical (Object.is) to the last call's.
  // A previous cut fingerprinted every scalar on the market and cost what it
  // saved; comparing the read-set in place costs a few dozen property reads.
  // If you make landRead (or anything it calls — residualScheme,
  // developmentProForma, underwritingEcon, noiYr, capRateFor, useOccupancy,
  // marketConstructionQuote...) read a NEW field of the market or the lot,
  // add it to the matching list below or this memo will serve a stale price.
  if (!landMarketMatches(econ)) { LAND_MEMO.clear(); LAND_CTX = null; }
  if (LAND_CTX?.econ !== econ) LAND_CTX = { econ, uw: new Map(), quotes: [] };
  const hit = LAND_MEMO.get(rec.bbl);
  const heat = econ.districtHeat?.[rec.district ?? "—"];
  if (hit && landLotMatches(hit, rec, heat)) return hit.psf;
  const psf = readLand(rec, econ, false, LAND_CTX).psf;
  LAND_MEMO.set(rec.bbl, {
    lotArea: rec.lotArea, farMaxComm: rec.farMaxComm, farMaxRes: rec.farMaxRes,
    zoneDist: rec.zoneDist, demandScore: rec.demandScore, landPsf: rec.landPsf,
    district: rec.district, yearBuilt: rec.yearBuilt, heat, psf,
    cornice: rec.cornice, maturity: rec.maturity,
  });
  return psf;
}

type LandMemoEntry = {
  lotArea: number; farMaxComm: number; farMaxRes: number; zoneDist: unknown; demandScore: number;
  landPsf: number; district: unknown; yearBuilt: number; heat: number | undefined; psf: number;
  cornice: number | undefined; maturity: number | undefined;
};
const LAND_MEMO = new Map<string, LandMemoEntry>();
/** The market fields landRead reads, flattened, as of the entries in LAND_MEMO. */
let LAND_MKT: unknown[] | null = null;
const LAND_DICTS = [
  "locIdxMeanBy", "cityVac", "structTight", "sublet", "stock",
  "rentIdx", "effRentIdx", "rentExp", "capRate", "capExp",
] as const;
const LAND_SCALARS = [
  "locIdxMean", "landIdx", "cpi", "infillShare", "costIdx", "indexRate",
  "creditIdx", "phase", "constructionAppetite", "vintageMean",
] as const;
const LAND_CLASSES: BuiltClass[] = ["office", "retail", "multifamily", "industrial"];
const LAND_MKT_LEN = LAND_SCALARS.length + LAND_DICTS.length * (1 + LAND_CLASSES.length);

function landMarketMatches(econ: Econ): boolean {
  const e = econ as unknown as Record<string, unknown>;
  let snap = LAND_MKT;
  let same = snap !== null;
  if (!snap) snap = LAND_MKT = new Array(LAND_MKT_LEN);
  let i = 0;
  for (const k of LAND_SCALARS) {
    const v = e[k];
    if (same && !Object.is(snap[i], v)) same = false;
    snap[i++] = v;
  }
  for (const k of LAND_DICTS) {
    const d = e[k] as Record<string, unknown> | undefined | null;
    const present = d ? 1 : 0;
    if (same && snap[i] !== present) same = false;
    snap[i++] = present;
    for (const u of LAND_CLASSES) {
      const v = d?.[u];
      if (same && !Object.is(snap[i], v)) same = false;
      snap[i++] = v;
    }
  }
  return same;
}

/**
 * WHAT EVERY LOT'S RESIDUAL SHARES WHILE THE MARKET STANDS STILL. Valid only
 * while `landMarketMatches` holds and for this one econ object — landPsfNow
 * drops it the moment either changes. `underwritingEcon` reads only fields in
 * that list (rentIdx, effRentIdx, rentExp, capRate, capExp) and prototypes the
 * econ it was handed, so it is the same object's worth of numbers each time.
 * The volume desk's quote reads the market (creditIdx, phase, indexRate,
 * constructionAppetite, cityVac, structTight — all in the list) and the
 * programme's four shares, and nothing else: with no hold limit passed, the
 * cost it is handed never enters it.
 */
type LandCtx = {
  econ: Econ;
  uw: Map<number, Econ>;
  quotes: { o: number; r: number; m: number; i: number; q: ConstructionQuote }[];
};
let LAND_CTX: LandCtx | null = null;
function ctxUnderwriting(ctx: LandCtx, econ: Econ, rentMult: number): Econ {
  let uw = ctx.uw.get(rentMult);
  if (!uw) { uw = underwritingEcon(econ, rentMult); ctx.uw.set(rentMult, uw); }
  return uw;
}
function ctxQuote(ctx: LandCtx, econ: Econ, mix: UseMix): ConstructionQuote {
  const o = mix.office ?? 0, r = mix.retail ?? 0, m = mix.multifamily ?? 0, i = mix.industrial ?? 0;
  for (const c of ctx.quotes) {
    if (Object.is(c.o, o) && Object.is(c.r, r) && Object.is(c.m, m) && Object.is(c.i, i)) return c.q;
  }
  const q = marketConstructionQuote(econ, mix, 0);
  if (ctx.quotes.length >= 256) ctx.quotes.length = 0;
  ctx.quotes.push({ o, r, m, i, q });
  return q;
}

function landLotMatches(m: LandMemoEntry, rec: ParcelRecord, heat: number | undefined): boolean {
  return Object.is(m.lotArea, rec.lotArea) && Object.is(m.farMaxComm, rec.farMaxComm)
    && Object.is(m.farMaxRes, rec.farMaxRes) && Object.is(m.zoneDist, rec.zoneDist)
    && Object.is(m.demandScore, rec.demandScore) && Object.is(m.landPsf, rec.landPsf)
    && Object.is(m.district, rec.district) && Object.is(m.yearBuilt, rec.yearBuilt)
    && Object.is(m.heat, heat)
    && Object.is(m.cornice, rec.cornice) && Object.is(m.maturity, rec.maturity);
}

export function landRead(rec: ParcelRecord, econ: Econ): LandRead {
  return readLand(rec, econ, true, null);
}

/**
 * `whole` false is for `landPsfNow`, which keeps only the price: the holder's
 * bid can only set the price when the builder's residual is not positive, so
 * on a lot that pencils the second residual is not run and `holder` comes back
 * as 0. The price is the same number either way.
 */
function readLand(rec: ParcelRecord, econ: Econ, whole: boolean, ctx: LandCtx | null): LandRead {
  // LOCATION PRICES DIRT AT THE LEVEL, NOT ONLY IN THE CYCLE.
  //
  // Demand used to enter only as a multiplier on `cycleDev`, so a block that
  // gained thirty points of desirability put nothing on its land value in a
  // flat market. The level term is centred on the CITY'S OWN mean location
  // index: a better corner gains what a worse one gives up, and the aggregate
  // is not silently shifted by the choice of pivot.
  const mean = econ.locIdxMean ?? 0.62;
  const level = Math.max(0.35, 1 + 0.85 * (demandIdx(rec.demandScore) - mean));

  // THE PRICE OF DIRT IS THE BETTER OF TWO OFFERS, WHICH IS WHAT AN AUCTION IS.
  //
  // A BUILDER bids the residual: what the finished building is worth less what
  // it costs to build less the margin the trade requires. See residualLandPsf.
  //
  // A HOLDER bids the option: most land in most cities does not support a new
  // building at today's rents and does not therefore trade at nothing. Somebody
  // pays the taxes and waits for the rent to arrive, and what they will pay is
  // the residual at the rents they expect at the next peak, discounted for the
  // wait. That bid is what puts a floor under fringe dirt, and it is why a
  // vacant lot on a bad street still costs money.
  //
  // Whichever of them wants it more sets the price. On a prime corner in a good
  // market the builder wins and the number is large; on a fringe lot in a slump
  // the holder wins and the number is small but real; and the crossover between
  // them is exactly where redevelopment pressure starts, which is the most
  // important line in a city and the game could not draw it before.
  const scheme = residualSchemeIn(rec, econ, 1, ctx);
  const builder = scheme?.psf ?? 0;
  const holder = whole || !(builder > 0)
    ? (residualSchemeIn(rec, econ, PEAK_RENT_MULT, ctx)?.psf ?? 0) * WAIT_DISCOUNT
    : 0;

  // AND WHAT THE CITY GENERATOR THOUGHT, which is not nothing.
  //
  // `rec.landPsf` is a static number stamped on the parcel at generation. It
  // was the ENTIRE price before this change and that was the fault; it is not
  // therefore worthless. It carries the map's own texture — the waterfront,
  // the park frontage, the corner, everything about a location that no income
  // model can see because it is not in the rent yet. It is a FLOOR under the
  // auction, not a weight in it: a lot with no income case still does not
  // trade at nothing. The comp wire (tickLandComps → s.landAdj) is what gets
  // tested against sales and multiplies this texture downstream via resolveRec.
  // ...IN TODAY'S DOLLARS. `landIdx` is deliberately homogeneous-of-degree-0
  // (market.ts — a real ratio, rent against cost), and `rec.landPsf` is
  // stamped in opening-year dollars, so this floor never carried the price
  // level: after decades of ordinary CPI the floor under no-income dirt had
  // quietly dissolved to nothing in real terms (measured: fringe lots pricing
  // at year-0 nominal dollars against a 6-7x price level). Dirt with no
  // income case still trades in the dollars of the day it trades.
  const texture = rec.landPsf * econ.landIdx * level * envelopeRealisation(rec) * (econ.cpi ?? 1);

  // HIGHEST AND BEST USE, NOT THE MAX OF THREE APPRAISALS.
  //
  // Two earlier forms priced dirt STRICTLY ABOVE the builder's residual on
  // every lot that pencilled, by construction (a texture blend, then a cycle
  // multiplier on a residual that already underwrites through-cycle). The
  // auction `max(builder, holder, textureFloor)` fixed that arithmetic and
  // then lost the same fight a different way: the holder bid is the residual
  // at a *certain* 25% peak, discounted five years, and on a thin-margin site
  // that number is two to three times today's builder residual. Measured at
  // year thirty: builder won 1.3% of vacant lots, holder 39.6%, texture 59.1%;
  // among lots with a positive residual the ask sat at 2.41× what the builder
  // could pay. The desk and the land market were two worlds, and a $2.5M
  // developer bought zero sites in three fifty-year runs.
  //
  // That holder formula is not an option value. An option to wait is the
  // value of land that does NOT support a building today. If a builder can
  // put a building on this dirt this year and earn the margin, that is the
  // use, and that is the price. Speculators who want to sit on a working
  // site until the next peak are not a second bidder who outranks the person
  // who would actually break ground — they are the current owner choosing
  // not to list. Unlisted land can sit at option value; transacted land that
  // pencils trades at the residual. Holder and texture still set the price
  // when today's residual is zero, which is most of the city, which is why
  // most dirt is still dirt.
  const floor = texture * 0.30;
  const heat = econ.districtHeat?.[rec.district ?? "—"] ?? 1;
  // THE APPRAISAL IS A RECONCILIATION, AND FOR LAND THE SALES COMPARISON
  // GOVERNS. The residual above is the income approach: what the maths says a
  // builder could pay. `districtHeat` is the sales-comparison evidence: what
  // the district's own prints (and, since the no-bid decay, its silences)
  // say buyers actually pay, relative to book. When the two diverge the
  // appraiser does not average them — for land, USPAP practice and every
  // review appraiser lean on the comparable sales and use the residual as
  // support, because the residual is a model and the prints are the market.
  //
  // This was clamped at -6%, which read as reconciliation and was decoration:
  // if the envelope doubles tomorrow and every residual doubles with it while
  // the buyers stay where they were, six per cent does not reconcile anything
  // — asks track the model into territory nobody bids, and the only honest
  // corrections left are the slow no-bid decay and a workout. At 0.55 weight
  // on the comp gap the builder bid concedes up to ~22% to a district whose
  // prints run at the 0.6 heat floor — sales comparison governing, income
  // approach supporting. No symmetric premium on hot districts: a district
  // printing over book already reaches every parcel through `landAdj`, and a
  // second helping here would count the same evidence twice.
  const softDiscount = heat < 1 ? clamp((heat - 1) * 0.55, -0.25, 0) : 0;
  // A TRUE max(builder, holder, floor) WAS TRIED HERE AND REVERTED — keep the
  // measurement. The builder-sets-the-price branch below lets a residual that
  // has thinned to $2/sf price the lot at $2/sf while the holder and the
  // floor stand at $50 beside it, and that cliff is real: measured over 100
  // years, mid-city lots lost 99-100% of real value inside 12 months as the
  // residual thinned, then gained +5,900% to +18,700% off the near-zero base.
  // Pricing the lot at the HIGHEST of the three bids fixed the cliff (worst
  // 12-month falls -43/-75/-49%, spikes +41/+273/+63%) and then starved the
  // city: `dev.affordableLotShare` fell 0.34 -> 0.016 (the pre-#47 disease,
  // from the other side), the office vacancy rail re-welded to 40% of months,
  // and stock/jobs growth halved — because this function serves TWO quantities
  // with one number. An appraisal is a RESERVATION price, where the max is
  // right; the city's start path and every ask price off it are TRANSACTION
  // prices, where dirt clears at what the marginal actual buyer pays, and a
  // holder who outbids the builder is not a buyer — they are the owner not
  // selling. Splitting reservation from transaction, and letting the holder's
  // reservation LEARN from silence (the no-bid decay reaches the texture but
  // never the holder bid), is the real build; it is recorded as an open
  // finding in REALISM_AUDIT_2026-08.md rather than half-shipped here.
  let base: number;
  let winner: LandRead["winner"];
  if (builder > 0) {
    base = builder;
    winner = "builder";
    if (softDiscount < 0) base = builder * (1 + softDiscount);
    // ...BUT NEVER BELOW THE SALES-COMPARISON FLOOR. A residual that has
    // thinned to $2/sf is a bid, not a price: the district's own comp-based
    // texture floor is standing evidence of what dirt clears at, and no owner
    // sells under it to the one bidder whose pro forma happens to be thin
    // this month. This is the half of the reverted max() that cannot starve
    // supply — a builder who cannot pay the comp floor SHOULD lose the site,
    // and the greenfield score (builder − psf) prices exactly that refusal.
    if (base < floor) { base = floor; winner = "texture"; }
  } else if (holder >= floor) {
    base = holder;
    winner = "holder";
  } else {
    base = floor;
    winner = "texture";
  }
  return {
    psf: base,
    builder, holder, texture: floor,
    winner,
    scheme,
  };
}

export function landValue(rec: ParcelRecord, econ: Econ): number {
  return rec.lotArea * landPsfNow(rec, econ);
}

/**
 * WHAT A STANDING BUILDING CANNOT FALL BELOW.
 *
 * Vacant dirt is the residual. A completed building is at least that dirt —
 * nobody demolishes a new tower to sell a lot. The 0.92 haircut is a
 * demolition allowance for old empty fabric, and it was also how a
 * just-delivered office marked below the land it sat on and called the
 * revolver. Lease-up uses the full residual; older stock still pays the
 * demo haircut.
 */
export function landAppraisalFloor(rec: ParcelRecord, econ: Econ, inLeaseUp: boolean | number): number {
  const land = landValue(rec, econ);
  // A number is how new the fabric still is (leaseUpWeight: 1 through the
  // market's lease-up span, fading to 0 at twice it), so the demolition
  // allowance arrives as the building ages rather than as a one-month step
  // the day a calendar window closes.
  const w = typeof inLeaseUp === "number" ? clamp(inLeaseUp, 0, 1) : inLeaseUp ? 1 : 0;
  return land * (0.92 + 0.08 * w);
}

export const CONDITION_RENT_MULT: Record<Condition, number> = {
  obsolete: 0.62, worn: 0.82, standard: 1.0, good: 1.2,
};

/**
 * HOW WELL IT WAS BUILT, on the rent.
 *
 * Condition is the grade of the plant today. Specification is the bones —
 * slab-to-slab, curtain wall, plant room — and it is permanent. Day-one rent
 * used to ignore spec entirely: every new building opened "good", so the
 * specification slider moved cost ±31% and rent not at all. That is not a
 * quality decision, it is a tax on building well.
 *
 * Class A over Class B asking rents in US office run ~25-40% in the broker
 * surveys (CBRE / JLL quarterly, 2015-2024), but much of that gap is location
 * and age. Holding the submarket fixed — the hedonic office-rent studies, and
 * the like-for-like A-vs-B spreads inside one CBD — leaves roughly 10-20%
 * for the building itself, with trophy over commodity at the top of that.
 * Condition is priced separately (CONDITION_RENT_MULT), so this is only the
 * permanent part: ±15% at the extremes of spec, +11% for "Signature" (0.88),
 * −7% for "Box" (0.28). Calibrated against that band, not tuned to an arm.
 * (It was ±10%, off a cited 8-15% that was the unadjusted multifamily gap;
 * measured with `pnpm spec-arms`, every dollar of spec then bought 44¢ of
 * value and the cheapest building was always the right one.)
 */
export function specRentMult(spec = 0.5): number {
  return 1 + 0.30 * (spec - 0.5);
}

/**
 * HOW FAST THE PLANT GOES OFF, per month, on a building of no particular age.
 *
 * Offices are the worst of it: lifts, air handling, risers, and a floorplate
 * that dates faster than the structure it sits in. Industrial is a shed and
 * barely moves. These are the numbers the decay in tickLeasing runs on, and
 * they are deliberately close to the 0.0024 the street already pays in
 * tickAssetManagement — the player and the firms are running the same model.
 */
/**
 * THE WEAR A `Fund` PLAN IS PRICED AGAINST — an ordinary building of no
 * particular age. The plan cheque scales with wear / COND_WEAR_REF, so a 1928
 * office eats more reserve than a 2015 shed and the bill says so. Calibrated
 * against the actual owned book so that Fund costs, to within a few basis
 * points, what the automatic plan cost before there was a choice.
 */
export const COND_WEAR_REF = 0.0038;
export const COND_DECAY: Record<BuiltClass, number> = {
  office: 0.0029, retail: 0.0026, multifamily: 0.0023, industrial: 0.0016,
};

/** Where each grade begins. Condition is a READING of condIdx, not a state. */
export const COND_BANDS: [Condition, number][] = [["good", 0.78], ["standard", 0.52], ["worn", 0.34], ["obsolete", 0]];
export function condGrade(condIdx: number): Condition {
  for (const [g, lo] of COND_BANDS) if (condIdx >= lo) return g;
  return "obsolete";
}

/**
 * HOW GOOD THIS BUILDING CAN EVER BE MADE, which is not "new".
 *
 * A repositioned 1920s walk-up with a new skin and new plant is a good old
 * building. It is not a 2015 tower and no amount of money makes it one — the
 * floorplate, the slab-to-slab and the core are what they are. Without this
 * ceiling the oldest, cheapest stock in the city would also be the highest
 * -return capital project in the city, which is not a decision, it is an
 * arbitrage. It is also why ground-up development is worth doing: new bones
 * are the only bones that start at the top of the scale.
 */
export function condCeiling(rec: { yearBuilt: number; buildSpec?: number }, month = 0): number {
  const age = START_YEAR + Math.floor(month / 12) - rec.yearBuilt;
  // HOW WELL IT WAS BUILT IS PERMANENT, and this is the line that makes the
  // specification slider worth paying for. Anyone can renovate a building; what
  // nobody can retrofit is a floor-to-floor height, a curtain wall that does
  // not leak, a structure that takes the loads, and a plant room with room in
  // it. A building built to a trophy specification ages more slowly and keeps a
  // higher ceiling forever; one built to a budget hits its ceiling in twenty
  // years and no amount of capital lifts it past. spec is 0..1 with 0.5 as
  // ordinary market standard.
  const spec = rec.buildSpec ?? 0.5;
  const lift = (spec - 0.5) * 0.14;                 // +/- 7 points of ceiling
  const wear = 0.0022 * (1 - (spec - 0.5) * 0.45);  // and it goes off more slowly
  return clamp(0.97 + lift - age * wear, 0.58, 0.995);
}

/**
 * What the bricks are worth on the day the deed moves: the age of the building,
 * adjusted by what the last owner did about it. `grade` is the seller's
 * stewardship as rivals.gradeOf reads it, so a corner bought out of a well-run
 * core fund arrives in better order than the same corner bought out of a
 * levered shop that deferred the roof. Nothing starts obsolete.
 */
export function initialCondIdx(rec: ParcelRecord, month = 0, grade?: Condition): number {
  const age = START_YEAR + Math.floor(month / 12) - rec.yearBuilt;
  const notch = grade === "good" ? 0.10 : grade === "worn" ? -0.08 : 0;
  return clamp(0.95 - age * 0.0072 + notch, 0.42, condCeiling(rec, month));
}

// A condition that isn't one of the three silently produced NaN rent, which
// then propagated through NOI, value, DSCR and the lender's sizing without a
// single error. Numbers that quietly become NaN are worse than numbers that
// throw, so this collapses to the honest middle instead.
function condMult(c: Condition): number {
  return CONDITION_RENT_MULT[c] ?? 1.0;
}

/**
 * CONDITION IS A NUMBER; THE GRADE IS A WORD FOR IT.
 *
 * `condIdx` drifts a thousandth a month and the grade is a reading of it
 * (`condGrade`). But rent and the cap rate read the WORD: a building whose
 * index crept from 0.5195 to 0.5200 crossed into "standard" and its market
 * rent rose 19% (`CONDITION_RENT_MULT`), its cap fell 70bp (`qualSpread`)
 * and its mark rose 53% — in one month, with the same tenants paying the
 * same rent. That was the owner's "one building, three appraisals in six
 * months" (HANDOFF 0f), measured on 2856 Old State St: $1.93M in month four,
 * $2.95M in month five. A building does not become a different building
 * because a thousandth ticked over; the market prices what it sees, which is
 * continuous. So every price reader takes the index and interpolates between
 * the grades' centres; the grade keeps its jobs as a label and a gate (the
 * life company's "good", the desk's repairs holdback).
 */
const COND_CENTRE: Record<Condition, number> = { obsolete: 0.17, worn: 0.43, standard: 0.65, good: 0.865 };
function condLerp(idx: number, table: Record<Condition, number>): number {
  const pts: [number, number][] = (["obsolete", "worn", "standard", "good"] as Condition[]).map((g) => [COND_CENTRE[g], table[g]]);
  if (idx <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (idx <= pts[i][0]) { const t = (idx - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]); return pts[i - 1][1] + t * (pts[i][1] - pts[i - 1][1]); }
  }
  return pts[pts.length - 1][1];
}
/** The rent multiplier at a condition index — the grade table, read continuously. */
export function condMultAt(idx: number): number { return condLerp(idx, CONDITION_RENT_MULT); }
const QUAL_SPREAD: Record<Condition, number> = { obsolete: 1.85, worn: 0.70, standard: 0, good: -0.40 };
/** The cap-rate spread for the state of the building, read continuously. */
export function qualSpreadAt(idx: number): number { return condLerp(idx, QUAL_SPREAD); }
/**
 * The index a reader should price at: the holding's own where there is one,
 * else the age-derived index the grade would have been read from. A grade
 * with no index prices at that grade's centre, which is the table value —
 * so every reader that only knows the word gets exactly what it got before.
 */
export function condIdxOf(rec: ParcelRecord, month: number, condition?: Condition, h?: { condIdx?: number } | null): number {
  if (h?.condIdx !== undefined) return h.condIdx;
  if (condition) return COND_CENTRE[condition] ?? 0.65;
  return initialCondIdx(rec, month);
}

export function initialCondition(rec: ParcelRecord): Condition {
  if (rec.yearBuilt >= 2000) return "good";
  if (rec.yearBuilt >= 1965) return "standard";
  return "worn";
}

// Location multiplier on citywide class rent: demand is the location. Reads
// the gravity, not the display scale — see demandIdx above.
/**
 * WHAT A CORNER CHARGES (ECONOMY.md). The old line — 0.62 + 0.76 x idx — put
 * a 1.5x ceiling on the whole city and the acceptance run measured 1.40x
 * achieved between demand 16 and 98, where a real market runs 2-3x. This is
 * an exponential pivoted on the city's measured sf-weighted mean, so the
 * spread widens to ~2.7x asking while the aggregate price level cannot move:
 * the median block reads ~1.0 on every map the generator can produce.
 * (Exponent measured against the acceptance suite: at 0.9 the ACHIEVED
 * spread between demand 16 and 98 came in at 1.87x — lease vintages and
 * concessions eat a fifth of the asking spread, so asking has to run wider
 * than the 2x the test demands of achieved.) The econ parameter is optional
 * so old callers (and the generator's own pricing, which has no econ yet)
 * fall back to the historical pivot.
 */
export function locationRentMult(rec: ParcelRecord, econ?: Econ, use?: BuiltClass): number {
  // PIVOTED PER CLASS. The citywide mean is set by the offices, so measuring a
  // shed against it priced the entire industrial market at ~0.5x its own
  // calibrated base — a shed on the fringe is in an ordinary industrial
  // location, and its rent multiplier should read ~1.0 there, not 0.5.
  const cls = (use ?? rec.class) as BuiltClass;
  const pivot = (cls !== "land" as string ? econ?.locIdxMeanBy?.[cls] : undefined) ?? econ?.locIdxMean ?? 0.62;
  // LOCATION IS A SEPARATE DIAL FROM THE RENT LEVEL, and it has to be, or the
  // two get traded against each other. Tightening the sustainable rent-to-
  // income ratio — a statement about the LEVEL of rents against wages —
  // compressed the prime-to-fringe SPREAD as a side effect, because the best
  // addresses carry the highest rent-to-income and the anchor bit them
  // hardest: the achieved spread between a demand-16 site and a demand-98 site
  // fell to 1.84x. That is not what the anchor is for. The exponent and the
  // ceiling are what price location, so they are what moves here.
  // ...AND THE SPREAD IS NOT THE SAME WIDTH IN EVERY MARKET.
  //
  // One exponent and one ceiling served all four classes, and combined with the
  // per-class pivot above that produced a real fault: industrial's pivot sits
  // low, because sheds stand on cheap fringe dirt, so a merely good corner was
  // already at the 2.15 ceiling. Measured after land was repriced as a
  // residual, a demand-68 lot paid $32.80/sf/yr for INDUSTRIAL against a
  // citywide industrial median of $11.26 — and because a shed is the cheapest
  // thing there is to build, all 337 vacant lots in New Alden then chose to be
  // sheds at their highest and best use. A two-floor warehouse outbidding a
  // tower for the best dirt in town is not a market.
  //
  // How far rent actually travels from fringe to prime is a fact about each
  // business, and they are wildly different facts:
  //
  //   retail       the most location-sensitive real estate there is. A high
  //                street pitch against a dead parade is many times over —
  //                footfall is the product and it does not travel.
  //   office       about two to two-and-a-half times in a secondary city
  //                (CBD against fringe); primary trophy markets run wider.
  //   multifamily  two to two and a half. People will commute; they will not
  //                pay four times for the same flat.
  //   industrial   the narrowest of the four. A distribution tenant is cost
  //                -driven and will happily drive another twenty minutes, so
  //                infill carries a premium for the last mile and not much
  //                more. This is also why industrial land is cheap, and the
  //                land residual now depends on getting it right.
  // One-entry memo per class: a pure function of (class, demand, pivot), and
  // the pro forma asks it of the same lot and class many times running.
  const hit = LOC_MULT_MEMO[cls];
  if (hit && Object.is(hit.d, rec.demandScore) && Object.is(hit.p, pivot)) return hit.v;
  const shape = LOC_SPREAD[cls] ?? LOC_SPREAD.office;
  const v = Math.min(shape.max, Math.max(shape.min, Math.pow(demandIdx(rec.demandScore) / pivot, shape.exp)));
  LOC_MULT_MEMO[cls] = { d: rec.demandScore, p: pivot, v };
  return v;
}
const LOC_MULT_MEMO: Record<string, { d: number; p: number; v: number }> = Object.create(null);

/**
 * The prime-to-fringe rent spread each class actually runs, as an exponent on
 * the location index and a ceiling on the multiplier. See locationRentMult.
 */
// THE FLOOR IS NOT WHY THE FRINGE STAYS EMPTY (measured 2026-10-08; nothing
// below was changed by it). The table runs wider than the comment in
// locationRentMult says (5.5x for offices, 3.75x for flats) and most of the
// town's spare land sits on the floor (57-74% of vacant lots by year 30), so
// the floors looked like the reason the edge of town never gets built.
// Raising them to the stated spreads (flats 0.87, offices 0.98, sheds 0.86)
// was tried and REJECTED: supply did not move, offices lost almost all
// location premium (98% of office lots on the floor), and a garden-apartment
// scheme on a fringe lot still needed 0.94-1.00 of the city's rent just to
// cover construction on FREE land. At the AVERAGE location new space barely
// covers its replacement cost, so only above-average dirt can ever pay for
// land, whatever the floor. Whether a growing, short city's rents should sit
// above replacement cost (Glaeser, Gyourko & Saks 2005: only elastic cities
// sit at it) is a question about the rent LEVEL, not this spread.
//
// Also measured and NOT adopted: solving each class's pivot so the stock's
// multiplier averages exactly 1.0. The curve is convex and floored, so the
// standing stock averages above 1.0 at the current pivot; making the index
// the true average reprices every typical building down by that gap and the
// life company's quote share fell from >= 8% to 5% (test/advance.mjs). That
// is a citywide repricing to be decided on its own, not a cleanup.
const LOC_SPREAD: Record<BuiltClass, { exp: number; max: number; min: number }> = {
  retail:      { exp: 1.45, max: 3.10, min: 0.34 },
  // Office ceiling was 2.45 — primary CBD trophy vs suburban commodity.
  // Procedural islands are secondary markets as a rule of thumb; ~2.2× is
  // CBD-vs-fringe for a harbour / working city. Density scaling lifts the
  // citywide index on Metropolis fabric; location should not also mint
  // Midtown on every seed's best block.
  office:      { exp: 1.28, max: 2.20, min: 0.40 },
  multifamily: { exp: 1.10, max: 1.95, min: 0.52 },
  industrial:  { exp: 0.82, max: 1.55, min: 0.62 },
};

export function marketRentPsfYr(rec: ParcelRecord, econ: Econ, condition: Condition, condIdx?: number): number {
  if (rec.class === "land") return 0;
  // The blended rent of a building that is shops below and flats above is the
  // area-weighted average of the shop market and the flat market. There is no
  // third market it belongs to.
  // ...and each of those markets pays for the floor plate it is getting. See
  // plateRentMult: an office or a shed cares enormously about a big regular
  // floor, a flat does not care at all.
  return blendBy(rec, (u) => (econ.effRentIdx?.[u] ?? econ.rentIdx[u] ?? 0) * plateRentMult(rec, u) * locationRentMult(rec, econ, u))
    * (condIdx !== undefined ? condMultAt(condIdx) : condMult(condition)) * specRentMult(rec.buildSpec);
}

/** What one component of a building rents for, in its own market. */
export function useRentPsfYr(rec: ParcelRecord, econ: Econ, condition: Condition, use: BuiltClass, condIdx?: number): number {
  // EFFECTIVE, not asking: everything that prices a deal or values an asset
  // reads what deals actually sign at. The Economy page shows both lines.
  return (econ.effRentIdx?.[use] ?? econ.rentIdx[use] ?? 0) * plateRentMult(rec, use) * locationRentMult(rec, econ, use)
    * (condIdx !== undefined ? condMultAt(condIdx) : condMult(condition)) * specRentMult(rec.buildSpec);
}

/**
 * A COMP SET IS WALKING DISTANCE, NOT A PROPERTY LINE.
 *
 * The datum used to read only parcels sharing this parcel's `block` id — a
 * mean of 3.4 lots on this island. So a lot facing a twenty-storey tower
 * across the street inherited nothing from it, and the cornice restarted from
 * zero at every kerb. Measured over 3 seeds x 50 years: block datum p50 3
 * floors against a legal envelope p50 11, with the cornice (not zoning)
 * binding on 72% of lots. Height could not propagate.
 *
 * That is not how the comp set works. A developer arguing for eighteen storeys
 * points at what is standing within a few streets, and a lender underwrites
 * the same set. The adjustment for distance is the appraiser's own: a tower on
 * your own block is a full comparable, one three hundred metres away is worth
 * something and less. So the datum is the best DISTANCE-ADJUSTED comparable
 * rather than the tallest thing sharing a lot line — one mechanism, not a
 * blend of two.
 *
 * 300m is about a four-minute walk and is the radius the retail and station
 * layers in this engine already treat as "here".
 *
 * NEUTRAL IN A FLAT CITY BY CONSTRUCTION. Where nothing nearby is taller than
 * the home block, the home block's own weight of 1 wins and the number is
 * exactly what it was. It moves only where height already varies, which is
 * where a real comp set would have found the argument.
 */
const COMP_RADIUS_M = 300;
const M_PER_DEG_LAT = 111_320;
type BlockGeo = {
  byBlock: Map<string, string[]>;
  neigh: Map<string, { b: string; w: number }[]>;
};
/** Static geometry, computed once per parcel table — same pattern as demand.ts. */
const BLOCK_GEO = new WeakMap<Record<string, ParcelRecord>, BlockGeo>();

function blockGeo(parcels: Record<string, ParcelRecord>): BlockGeo {
  const hit = BLOCK_GEO.get(parcels);
  if (hit) return hit;
  const byBlock = new Map<string, string[]>();
  const acc = new Map<string, [number, number, number]>();
  for (const bbl in parcels) {
    const p = parcels[bbl];
    if (!p?.block) continue;
    const list = byBlock.get(p.block);
    if (list) list.push(bbl); else byBlock.set(p.block, [bbl]);
    const c = p.centroid;
    if (!c) continue;
    const a = acc.get(p.block) ?? [0, 0, 0];
    a[0] += c[0]; a[1] += c[1]; a[2]++;
    acc.set(p.block, a);
  }
  const centre = new Map<string, [number, number]>();
  for (const [b, a] of acc) if (a[2] > 0) centre.set(b, [a[0] / a[2], a[1] / a[2]]);
  const blocks = [...byBlock.keys()];
  const neigh = new Map<string, { b: string; w: number }[]>();
  for (const b of blocks) {
    const out: { b: string; w: number }[] = [{ b, w: 1 }];
    const c0 = centre.get(b);
    if (c0) {
      const mPerLon = M_PER_DEG_LAT * Math.cos((c0[1] * Math.PI) / 180);
      for (const o of blocks) {
        if (o === b) continue;
        const c1 = centre.get(o);
        if (!c1) continue;
        const d = Math.hypot((c1[0] - c0[0]) * mPerLon, (c1[1] - c0[1]) * M_PER_DEG_LAT);
        if (d >= COMP_RADIUS_M) continue;
        out.push({ b: o, w: 1 - d / COMP_RADIUS_M });
      }
    }
    neigh.set(b, out);
  }
  const geo = { byBlock, neigh };
  BLOCK_GEO.set(parcels, geo);
  return geo;
}

export function blockDatumFloors(
  s: GameState, parcels: Record<string, ParcelRecord>, block: string, memo?: Map<string, number>,
): number {
  const { byBlock, neigh } = blockGeo(parcels);
  let datum = 0;
  for (const { b, w } of neigh.get(block) ?? [{ b: block, w: 1 }]) {
    let top = memo?.get(b);
    if (top === undefined) {
      top = blockTopFloors(s, parcels, byBlock.get(b));
      memo?.set(b, top);
    }
    // w > 0, and multiplying by a positive constant is monotone in floating
    // point, so the block's tallest times w is exactly the largest
    // floors * w over its lots — the number the per-lot loop used to find.
    const adjusted = top * w;
    if (adjusted > datum) datum = adjusted;
  }
  return Math.floor(datum);
}

/**
 * The tallest standing building on one block, 0 when there is none. Only
 * class and floors are read, so this skips resolveRec's full copy of the
 * record: they are the delivered building's (s.built) when there is one, and
 * the deed's own otherwise — including on a merged-away child, which
 * resolveRec returns without consulting s.built.
 */
function blockTopFloors(s: GameState, parcels: Record<string, ParcelRecord>, lots: string[] | undefined): number {
  if (!lots) return 0;
  const built = s.built;
  const merged = s.merged;
  let top = 0;
  for (const bbl of lots) {
    const rec = parcels[bbl];
    if (!rec) continue;
    const d = merged?.[bbl] ? undefined : built?.[bbl];
    const cls = d ? d.class : rec.class;
    const floors = d ? d.floors : rec.floors;
    if (cls === "land" || !(floors > 0)) continue;
    if (floors > top) top = floors;
  }
  return top;
}

/**
 * A per-block memo for `cityInfillCap` / `blockDatumFloors`, for a caller that
 * asks about many lots in one pass. Valid only while nothing is built,
 * demolished or merged — make a fresh one for each such pass.
 */
export type DatumMemo = Map<string, number>;


/**
 * THE TOWN'S MATURITY, 0..1 — how far the comp set's height increment has
 * grown (2 floors in year one to 6 by year 65). One reading for every path:
 * the teardown desk used to pass 1 here while the city's greenfield starts,
 * the rivals and the sampler passed month/780, so the same lot had two
 * heights depending on which crane asked.
 */
export function townMaturity(s: { month: number }): number {
  return Math.min(1, Math.max(0, s.month) / 780);
}

/**
 * THE BLOCK'S CORNICE DATUM AS OF THIS STATE, memoised per state object. The
 * standing stock is read once per block per state, so the height rule and the
 * land residual that reads it off `resolveRec` see the same comp set within a
 * tick. A tick clones the state, so each month reads that month's skyline.
 */
const CORNICE = new WeakMap<object, Map<string, number>>();
export function corniceDatum(s: GameState, parcels: Record<string, ParcelRecord>, block: string): number {
  let memo = CORNICE.get(s);
  if (!memo) { memo = new Map(); CORNICE.set(s, memo); }
  const top = memo.get("\u0000" + block);
  if (top !== undefined) return top;
  const d = blockDatumFloors(s, parcels, block, memo);
  memo.set("\u0000" + block, d);
  return d;
}

/**
 * HOW HIGH A SHOVEL GETS ON THIS LOT TODAY — the one envelope rule.
 *
 * Every autonomous start (the anonymous city, a named firm on the city's job
 * or on its own dirt, a teardown), the order book's pencil sampler AND the
 * land residual read this, so "what can be built here" has one answer. The
 * inputs are the lot, the market, the town's maturity and the block's
 * cornice datum (the tallest distance-weighted comparable within a few
 * streets, `blockDatumFloors`); `cityInfillCap` (dev.ts) supplies the last two
 * from the state, and `resolveRec` stamps them on every resolved record
 * (`cornice`, `maturity`) so the residual — which is handed only (rec, econ) —
 * reads the same numbers. See ECONOMY.md "ONE LOT, ONE ENVELOPE".
 */
export function heightCapFloors(
  datum: number, maturity: number, econ: Econ,
  rec: { lotArea: number; farMaxComm?: number; farMaxRes?: number },
  use: BuiltClass = "office",
): number {
  // NO HEIGHT LIMIT BUT THE ENGINEERING (2026-10-10). This was the cornice
  // rule: as-of-right to one step above the block's datum, discretionary
  // review (with its cost, its wait and its odds) above it. Houston has no
  // such review. What stops a building there is what it costs to go up —
  // `heightPremium` in the pro forma — and what the plate can stand up.
  void datum; void maturity; void econ; void use;
  return physicalMaxFloors(rec.lotArea * 0.62);
}


// A delivered development overrides the static record — resolve before use.
// So does the neighbourhood: a block's demand drifts with what gets built and
// occupied around it (see engine/demand.ts), and every reader of demandScore
// below this line gets the live number without knowing the model exists.
export function resolveRec(parcels: Record<string, ParcelRecord>, s: GameState, bbl: string): ParcelRecord | null {
  const r = resolveRecOnly(parcels, s, bbl);
  if (!r) return null;
  // THE HEIGHT THE SHOVEL GETS, ON THE RECORD. The land residual is handed
  // (rec, econ) and nothing else, so the two state-dependent inputs of the
  // one envelope rule (`heightCapFloors`) travel with the lot: the block's
  // cornice datum and the town's maturity. Every reader of the land price
  // then prices the building the city would actually permit here.
  return { ...r, cornice: corniceDatum(s, parcels, r.block), maturity: townMaturity(s) };
}

function resolveRecOnly(parcels: Record<string, ParcelRecord>, s: GameState, bbl: string): ParcelRecord | null {
  const rec = parcels[bbl];
  if (!rec) return null;
  // ASSEMBLED SITES. A merged lot's land has moved into its parent: the parent
  // is as big as the sum of the deeds, and the child is a deed with no
  // buildable area left in it. Everything downstream — the envelope, the land
  // value, what a lender will lend on — reads this without knowing it exists.
  const m = s.merged;
  if (m) {
    if (m[bbl]) return { ...rec, lotArea: 0, farMaxComm: 0, farMaxRes: 0 };
    // A MERGED SITE'S DIRT IS THE DIRT THAT WENT INTO IT. This used to take
    // the sum of the areas and keep the PARENT'S landPsf — and the parent is
    // the biggest lot, which this generator prices cheapest per foot. So
    // merging silently repriced the whole site down to the worst psf in the
    // set: measured over 120 merges, 55% of them DESTROYED land value and the
    // worst lost 16% of the dirt at the moment the deeds were folded together.
    //
    // AND ITS ENVELOPE IS THE ENVELOPE THAT WENT INTO IT. A merged zoning lot
    // carries the floor area of every piece — each lot's area at its own FAR
    // — not the parent's FAR stretched over everybody's dirt. Taking the
    // parent's made the buildable area depend on which deed happened to end up
    // as parent: on the reference map 82% of neighbouring lots on a block
    // differ in FAR (by up to 28%), so the same three lots assembled in a
    // different order planned a different building.
    let extra = 0;
    let psfSum = rec.lotArea * rec.landPsf;
    let commSum = rec.lotArea * rec.farMaxComm;
    let resSum = rec.lotArea * rec.farMaxRes;
    for (const [child, parent] of Object.entries(m)) {
      if (parent !== bbl) continue;
      const c = parcels[child];
      if (!c) continue;
      const a = c.lotArea ?? 0;
      extra += a;
      psfSum += a * c.landPsf;
      commSum += a * c.farMaxComm;
      resSum += a * c.farMaxRes;
    }
    if (extra > 0) {
      const area = rec.lotArea + extra;
      const grown = resolveBase(s, {
        ...rec, lotArea: area, landPsf: psfSum / Math.max(1, area),
        farMaxComm: commSum / Math.max(1, area), farMaxRes: resSum / Math.max(1, area),
      });
      return grown;
    }
  }
  return resolveBase(s, rec);
}

function resolveBase(s: GameState, rec: ParcelRecord): ParcelRecord | null {
  const bbl = rec.bbl;
  const b = s.built?.[bbl];
  const adj = s.landAdj?.[bbl];
  const dd = s.blockD?.[rec.block];
  // ZONING. The district's multiplier, plus anything you won at a hearing on
  // this specific site — and nothing at all if it has been landmarked, which
  // freezes the envelope at what is already standing.
  const zx = s.zoneAdj?.[rec.district] ?? 1;
  const vr = s.variance?.[bbl] ?? 0;
  const marked = s.landmarks?.[bbl] !== undefined;
  const zu = s.zoneUse?.[bbl];
  // WHAT IT WAS BUILT TO, from the save: a delivery stamps `built`, a gut
  // stamps `specOf`. Never from a write to the static parcel table.
  const spec = s.specOf?.[bbl] ?? b?.buildSpec;
  if (!b && !adj && !dd && zx === 1 && !vr && !marked && !zu && spec === undefined) return rec;
  const out = { ...rec };
  if (spec !== undefined) out.buildSpec = spec;
  if (zu) out.zoneDist = zu;
  if (marked) {
    // A landmark's envelope is what is standing on it. The redevelopment
    // option is gone and every reader of FAR below this line sees that.
    const builtFar = rec.lotArea > 0 ? rec.bldgArea / rec.lotArea : 0;
    out.farMaxComm = Math.min(rec.farMaxComm, builtFar);
    out.farMaxRes = Math.min(rec.farMaxRes, builtFar);
  } else if (zx !== 1 || vr) {
    // AN ABSOLUTE CEILING ON THE ENVELOPE. The generator's densest ground is
    // already 37 FAR; multiplying an upzoning on top of that produced 96, and
    // then a variance on top of THAT. No city has ever been 96 FAR. Capping
    // the resolved envelope means upzoning is worth a great deal where there
    // is room for it and nothing at all downtown — which is exactly how a real
    // rezoning works, and why the fights are always about the fringe.
    out.farMaxComm = +Math.min(FAR_CEILING, rec.farMaxComm * zx + vr).toFixed(2);
    out.farMaxRes = +Math.min(FAR_CEILING, rec.farMaxRes * zx + vr).toFixed(2);
  }
  if (adj) out.landPsf = rec.landPsf * adj;
  // THE WIRE FROM DEMAND TO DIRT, WHICH WAS CUT.
  //
  // The generator prices land as `assessedPsf / 0.45 * (0.6 + 0.9 * demand/100)`
  // — see citygen/build.mjs. Cross-sectionally, therefore, the same dirt at
  // demand 79 is worth 1.26x the same dirt at demand 49. At runtime it was
  // worth 1.033x, because `landPsfNow` read the frozen `landPsf` and demand
  // entered only through `demandBeta`, which modulates the CYCLE and not the
  // level. So a block could gain thirty points of desirability, put 13% on its
  // rents, and its ground would not move: the one asset whose entire value IS
  // location was the one asset location did not price.
  //
  // This is not a new number. It is the generator's own curve, applied as a
  // RATIO so day one is bit-for-bit unchanged and only movement reprices. Every
  // reader of landPsfNow, landValue, the appraisal, the lender's sizing and the
  // rivals' land bids gets it without knowing it exists.
  if (dd) {
    const d1 = clamp(rec.demandScore + dd, 2, 100);
    out.demandScore = d1;
    out.landPsf *= (0.6 + 0.9 * d1 / 100) / (0.6 + 0.9 * rec.demandScore / 100);
  }
  if (b) {
    out.class = b.class; out.bldgArea = b.bldgArea; out.floors = b.floors; out.yearBuilt = b.yearBuilt;
    // and its composition — a delivered mixed-use building that reported as
    // single-use was the whole point of the change, undone at the last step
    out.mix = b.mix;
    // ...and how you chose to cut it up, which decides the whole leasing story
    out.suites = b.suites;
  }
  return out;
}

/**
 * THE FACE/EFFECTIVE GROSS-UP — how far a QUOTE sits above what a deal nets.
 *
 * `effRentIdx` is the net-effective index: asking less the concession package
 * a tenant can extract at today's dial (market.ts). Valuation reads it, which
 * is right — an asset is worth what deals actually net.
 *
 * A QUOTE is not a net number. A landlord names the face rate and pays for the
 * deal in free rent and fit-out, and the leasing desk in this engine then
 * writes exactly that package on every letter. Quoting the effective index and
 * ALSO writing the package charged the concession twice: measured over four
 * seeds through a 35%-of-stock glut, letters signed at a straight-line net
 * effective 27% under the line the Economy page draws as "effective", and the
 * asking line was a rate nobody in the game was ever quoted (buildings quoted
 * 11-13% under it). This grosses the quote back to face so that the two lines
 * on the chart mean what the caption says: asking is quoted, effective is
 * struck.
 */
export function faceGrossUp(econ: Econ, use: BuiltClass): number {
  const eff = econ.effRentIdx?.[use] ?? 0;
  const ask = econ.rentIdx?.[use] ?? 0;
  if (!(eff > 0) || !(ask > 0)) return 1;
  return ask / eff;
}

// Achievable rent for NEW leases in a managed building: capital programs and
// the owner's rent stance move it off the pure market number.
//
// FACE, NOT EFFECTIVE. This is the number the parcel card prints, the letter
// arrives at, the renewal is scored against and the rent roll is marked to —
// every one of them a FACE rent, because the concession package is written
// separately on the deal itself. See faceGrossUp.
export function managedRentPsfYr(rec: ParcelRecord, econ: Econ, h: Holding, use?: BuiltClass): number {
  // A landmarked building is one people care about, and it lets a little
  // better than the market for the rest of its life. That premium is the
  // entire compensation for never being allowed to knock it down.
  // With a use, the rent of that component in its own market. Without one, the
  // blended number the whole building is worth — which is the right answer for
  // an appraisal and the wrong one for a lease.
  let m = use
    ? useRentPsfYr(rec, econ, h.condition, use, h.condIdx) * faceGrossUp(econ, use)
    : blendBy(rec, (u) => useRentPsfYr(rec, econ, h.condition, u, h.condIdx) * faceGrossUp(econ, u));
  // Programmes used to multiply here AND lift condIdx (PROGRAM_LIFT →
  // CONDITION_RENT_MULT). Measured on a 1940 office: condition lift 1.20×,
  // explicit lobby×1.04×facade×1.08 = 1.12×, both together 1.35× — the same
  // cheque twice. The condition channel stays; the arrival factor in
  // absorption.ts is velocity, not a third price. See QUALITY_BALANCE_PLAN.md §2.
  m *= 1 + 0.08 * (h.stance ?? 0);
  if (h.landmarked) m *= 1.07;
  return m;
}

// OCCUPANCY IS A DISTRIBUTION, NOT A NUMBER.
//
// Every building in the city used to sit within a few points of its class
// norm — the only variation was a small cycle swing and a smaller demand
// nudge, so the whole tape read 90%+ and a "weak" building meant 87%. Real
// stock is nothing like that. Citywide office vacancy of twelve per cent is
// not every building at 88: it is most buildings nearly full and a long tail
// at 70, 55, 40 — the wrong corner, the dark lobby, the floor plates nobody
// wants — and that tail is where every value-add deal in history has lived.
//
// Three terms produce the spread:
//   cycle    — the whole market breathes together, harder than before
//   location — vacancy concentrates at the bottom of the market; a fringe
//              building loses tenants FIRST and re-lets LAST
//   character— a stable per-building idiosyncrasy. Some buildings simply do
//              not lease well and never have; the hash keeps each one's
//              trouble consistent across the whole game, so a 68% building
//              is a 68% building every time you look at it.
// RETIRED. This was the level occupancy sat at, and it disagreed with
// 1 - NATURAL_VAC by 1.5-6.0pp per class — see the derivation at `base` in
// useOccupancy. The level now comes from NATURAL_VAC, which is the same number
// the city's own vacancy model is calibrated to, so there is one answer to
// "how full is this class" instead of two. Kept only as a record of what the
// numbers used to be: office 0.84, retail 0.89, multifamily 0.94, industrial
// 0.87, against 0.885 / 0.915 / 0.955 / 0.930.

/**
 * `occHash(bbl + use)` and `occHash("trouble:" + bbl + use)`, memoised per lot:
 * pure functions of the strings, and hashing them was a tenth of the pro forma.
 */
const OCC_HASHES = new Map<string, Record<string, [number, number]>>();
function occHashes(bbl: string, use: string): [number, number] {
  let byUse = OCC_HASHES.get(bbl);
  if (!byUse) { byUse = Object.create(null) as Record<string, [number, number]>; OCC_HASHES.set(bbl, byUse); }
  return byUse[use] ??= [occHash(bbl + use), occHash("trouble:" + bbl + use)];
}
function occHash(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10000) / 10000;
}
/**
 * A BUILDING THAT OPENED THIS MONTH IS EMPTY.
 *
 * Occupancy was a pure function of class, location and a per-building hash,
 * with no notion of age at all — so the day the city finished a tower it was
 * already 93% let, and every new building in town arrived stabilised. Nobody
 * has ever opened a building full. It takes two to three years of touring,
 * concessions and fit-out to fill one, and that lease-up is the single largest
 * risk in development — which the player carries in full on their own jobs and
 * everyone else was being handed for free.
 *
 * Apartments fill faster than offices because the space is fungible and the
 * leases are twelve months, which is why residential lease-up risk is priced
 * so much lower than commercial.
 */
/** Years from opening to a stabilised roll, by class. */
export const LEASE_UP_YEARS = (apt: boolean) => (apt ? 1.6 : 3.2);

function leaseUpFactor(rec: ParcelRecord, econ: Econ, apt: boolean): number {
  if (!rec.yearBuilt || econ.m === undefined) return 1;
  const nowYr = START_YEAR + econ.m / 12;
  const age = nowYr - rec.yearBuilt;
  if (age < 0 || age > 4) return 1;
  return leaseUpCurve(age, apt);
}

/**
 * The market's lease-up curve: the share of its stabilised occupancy a
 * building `ageYears` old is let at. Opens at a fifth let and climbs — the
 * shape of a real lease-up curve — to stabilised at LEASE_UP_YEARS. Exported
 * so a building with a real roll (tickLeasing's apartment walk) can be read
 * against the same curve the market reads every other new building on.
 */
export function leaseUpCurve(ageYears: number, apt: boolean): number {
  if (!(ageYears >= 0)) return 1;
  const span = LEASE_UP_YEARS(apt);
  if (ageYears >= span) return 1;
  return clamp(0.2 + 0.8 * Math.pow(ageYears / span, 0.75), 0.2, 1);
}

export function useOccupancy(rec: ParcelRecord, econ: Econ, use: BuiltClass, stabilised = false): number {
  const apt = use === "multifamily";
  // The swing*cycleDev term died here (ECONOMY.md): with the vacancy wire
  // below live, it counted the cycle twice — cityVac already carries the
  // phase, honestly now that the space market conserves tenants.
  // Location: 0.16 -> 0.22. Fringe market buildings run ~-9pp, prime ~+8pp,
  // which feeds the submarket table, so fringe neighbourhoods read looser and
  // the local-vacancy channel REINFORCES the arrival gradient instead of
  // fighting it.
  // PIVOTED ON THIS CITY'S OWN MEAN, not on a constant from another map.
  //
  // This read a hardcoded 0.62. `econ.locIdxMeanBy` is the sf-weighted mean
  // demandIdx of the built stock PER CLASS, measured once at init, and its own
  // doc comment says it exists to keep the location curves "mean-neutral on any
  // map" — it was simply never wired to the curve it was made for. Measured on
  // the reference town: the real pivots are office 0.562, retail 0.478,
  // multifamily 0.414, industrial 0.416, so against 0.62 this term was not a
  // location premium at all, it was a flat -1.3pp on office, -3.1pp on retail
  // and -4.5pp on multifamily and industrial, applied to the whole stock.
  // A shed competes with sheds, which is why the per-class pivot is the right
  // one and the town-wide `locIdxMean` is only the fallback.
  const locPivot = econ.locIdxMeanBy?.[use] ?? econ.locIdxMean ?? 0.62;
  const loc = 0.22 * (demandIdx(rec.demandScore) - locPivot);
  // the building's own character, ±11pp commercial, ±6pp residential — and
  // skewed downward, because the tail of this distribution is a tail of pain
  const [u, u2] = occHashes(rec.bbl, use);
  const idio = (apt ? 0.12 : 0.22) * (u - 0.62);
  // ...and one building in eight is simply TROUBLED: the dark lobby, the
  // unleasable plates, the entrance on the wrong street. These are the 50-65%
  // buildings every market carries, they are persistent, and they are the
  // entire value-add trade — the discount is real and so is the reason.
  const trouble = u2 < 0.12 ? (apt ? 0.14 : 0.28) * (1 - u2 / 0.12) : 0;
  // THE SPACE MARKET WAS NOT WIRED TO A SINGLE BUILDING.
  //
  // econ.cityVac[use] is recomputed every month out of stock, deliveries,
  // employment, absorption and price — the whole four-quadrant model the
  // Economy page draws graphs of — and NOTHING downstream ever read it. A
  // building's occupancy was a constant plus a nine-point swing on cycleDev,
  // so citywide office vacancy could go from 4.5% to 30% and every building in
  // town would sit at exactly the occupancy it had before. Measured on the
  // renderer, which is where it finally showed: pushing office vacancy from
  // 4.5% to 30% moved 0.34% of the pixels in the frame, against a noise floor
  // of 0.23%. The market was a set of numbers on a page about a city it could
  // not touch.
  //
  // The wire is a DIFFERENCE from natural vacancy, not a level, so that at the
  // frictional rate this term is exactly zero and the whole existing
  // calibration is untouched — what is new is only the response. It is damped
  // to 0.85 because a building does not reprice the instant the market does:
  // the paper in it has years to run, and that is what stops citywide vacancy
  // from arriving as a step change on every roll in the city.
  const vacNow = econ.cityVac?.[use];
  let mktDelta = Number.isFinite(vacNow) ? (NATURAL_VAC[use] - (vacNow as number)) * 0.85 : 0;
  // QUALITY SEGMENTS THE MARKET (ECONOMY.md): when the market sheds tenants,
  // the 1928 building sheds ~3x what last year's does — flight to quality is
  // the pain of new supply landing on the oldest competing stock. Applied
  // only on the DOWNSIDE (a tight market does not favour old bones), and
  // renormalised by the city's measured vintage mean so the books reconcile.
  if (mktDelta < 0) {
    const age = Math.max(0, 2000 - (rec.yearBuilt || 1960));
    const vintage = Math.min(1.7, Math.max(0.5, 0.5 + age / 80));
    mktDelta *= vintage / (econ.vintageMean ?? 1.0);
  }
  // THE LEVEL IS 1 - NATURAL VACANCY, AND THE SHAPE TERMS DO NOT MOVE IT.
  //
  // `mktDelta` is deliberately written as a DIFFERENCE from natural vacancy so
  // that at the natural rate it is exactly zero and the calibration underneath
  // is untouched. That intent was defeated by the thing it is a difference
  // from: OCC_BASE was a free constant sitting 1.5-6.0pp BELOW 1 - NATURAL_VAC
  // (office 0.84 against 0.885, industrial 0.87 against 0.930), so at the very
  // moment the city model said a class was exactly at its natural rate, this
  // function said its buildings were several points emptier than that.
  //
  // On top of it both shape terms have non-zero means and were spending the
  // level rather than describing a spread: E[idio] = k*(0.5-0.62) = -0.12k and
  // E[trouble] = k*0.06 (integrating k*(1-u/0.12) over u in [0,0.12]), so
  // together they cost commercial 4.32pp and residential 2.28pp of LEVEL for
  // shape nobody asked to pay for. They are still exactly as skewed as they
  // were — one building in eight is still troubled, the tail is still a tail of
  // pain — the mean is simply added back so the skew describes the spread
  // around the market rather than pulling the market down with it.
  //
  // Measured before, sf-weighted over the built stock at month 300: the model
  // ran 9-16pp under 1 - cityVac depending on class and seed, with no mechanism
  // between the two and nothing asserting they should agree. They are the same
  // quantity — how full this city's buildings are — and CLAUDE.md fake number 3
  // says one of two answers to that is fiction.
  const shapeMean = -0.12 * (apt ? 0.12 : 0.22) - 0.06 * (apt ? 0.14 : 0.28);
  const base = clamp((1 - NATURAL_VAC[use]) + mktDelta + loc + idio - trouble - shapeMean, 0.28, 0.99);
  // AS-IF-STABILISED IS THE SAME BUILDING WITHOUT THE CALENDAR. `stabilised`
  // asks for the occupancy this building runs at once it is no longer new —
  // which is what an appraiser means by the phrase, and what the stabilised
  // leg of holdingValue has to be measured against. Everything else on this
  // engine wants the honest as-is number and gets it by default.
  return stabilised ? base : base * leaseUpFactor(rec, econ, apt);
}
export function occupancy(rec: ParcelRecord, econ: Econ): number {
  if (rec.class === "land") return 0;
  return blendBy(rec, (u) => useOccupancy(rec, econ, u));
}

/**
 * PHYSICAL OCCUPANCY OF A BUILDING YOU ACTUALLY OWN — commercial square feet
 * under lease plus residential square feet occupied, over the building.
 * `occupancy` above is the market's read on a building; this is the roll.
 *
 * It lived in the panel, which meant the number on screen and any number the
 * engine wanted to record were two implementations of one quantity. It is here
 * now, and the panel imports it.
 */
export function physicalOcc(rec: ParcelRecord, h: Holding): number {
  if (!rec.bldgArea) return 0;
  const comm = h.tenants.reduce((a, t) => a + t.sf, 0);
  const res = useRentableSf(rec, "multifamily") * (h.occ ?? 0);
  return Math.min(1, (comm + res) / Math.max(1, rentableSf(rec)));
}

// ---------------------------------------------------------------- the opex stack
// A single blended $/sf hides the two things that actually matter: which line
// items a tenant reimburses, and which ones the owner can do anything about.
// Split them, because the split is what a recovery clause is written against.
//
//   controllable — R&M, utilities, cleaning, admin. Systems capex bites here.
//   fixed        — insurance and the like. Property tax is separate; it has
//                  its own assessment and its own reimbursement treatment.
//
// $/sf/yr at costIdx 1.
// Apartments were carrying a 22% expense ratio, a number no operator has ever
// seen. Residential is the most operationally intensive class there is —
// payroll, turns, marketing, utilities the tenant does not pay — and it runs
// 40-45% before the capex reserve. Understating it made multifamily pencil on
// ninety-nine sites out of a hundred.
/**
 * INDUSTRIAL WAS $3.50/SF AND THE BUSINESS RUNS $0.50-1.50.
 *
 * A warehouse is a slab, a shell and a roof. There is no lobby to staff, no
 * lifts to service, no cleaning contract for common areas, no chilled water:
 * landlord-retained opex on a single-tenant shed is roughly $0.50-1.50/sf/yr
 * excluding taxes, and at the bottom of that band on an absolute-net deal
 * where the tenant carries the roof. This carried $2.30 controllable + $1.20
 * fixed = $3.50, which is 2.3x to 7x the real figure and read as 33% of base
 * rent where the business runs 5-12%.
 *
 * Corrected to $0.75 + $0.45 = $1.20/sf. Worth being honest about the size of
 * the consequence: because industrial leases here are overwhelmingly net, the
 * tenant reimburses most of this, so on a fully-let shed the owner's NOI moves
 * about 1% — the visible change is in the operating statement reading like an
 * industrial building instead of an office one, and in what a VACANT shed
 * costs to sit on, which is where the whole difference lands.
 */
export const OPEX_CONTROLLABLE: Record<BuiltClass, number> = { office: 4.17, retail: 3.20, multifamily: 6.21, industrial: 0.50 };
export const OPEX_FIXED: Record<BuiltClass, number> = { office: 1.72, retail: 1.54, multifamily: 2.01, industrial: 0.30 };
export const MGMT_FEE = 0.04;   // of effective gross income, industry standard
/**
 * THE REPLACEMENT RESERVE ON A BLOCK OF FLATS, and it is NOT the management
 * fee — which is the confusion this constant exists to end.
 *
 * Apartments used to carry one 7% line doing two jobs, labelled "Reserves for
 * turns and repairs" on the statement and standing in for the management fee
 * as well. They are different money paid to different people for different
 * reasons: the fee is 3-4% of collections paid to whoever runs the building,
 * and the reserve is capital set aside for carpets, appliances, roofs and
 * turns — roughly $250-350 a unit a year, which on ordinary unit sizes is
 * about three points of collections. Together they are the seven points that
 * were there before, so this splits a number rather than changing one.
 */
export const APT_RESERVE = 0.03;

/** Total operating cost per sf/yr before management fee and property tax. */
export function opexPsf(cls: BuiltClass, econ: Econ, systemsDone: boolean, service?: -1 | 0 | 1): number {
  return (OPEX_CONTROLLABLE[cls] * (systemsDone ? 0.82 : 1) * serviceSpec(service).opex + OPEX_FIXED[cls]) * econ.costIdx;
}

/** Controllable opex only — pmOpexMult applies here, not to fixed costs. */
function controllableOpexPsf(
  cls: BuiltClass, econ: Econ, systemsDone: boolean, service?: -1 | 0 | 1, pmMult = 1,
): number {
  return OPEX_CONTROLLABLE[cls] * (systemsDone ? 0.82 : 1) * serviceSpec(service).opex * econ.costIdx * pmMult;
}

function managedOpexPsf(
  cls: BuiltClass, econ: Econ, systemsDone: boolean, service?: -1 | 0 | 1, pmMult = 1,
): number {
  return controllableOpexPsf(cls, econ, systemsDone, service, pmMult) + OPEX_FIXED[cls] * econ.costIdx;
}

/**
 * A CHEAP BUILDING IS CHEAPER TO RUN.
 *
 * `opexPsf` is one number per class, city-wide, and it was charged to every
 * address alike. Measured at the opening bell across six seeds: apartment
 * rent runs $13.5 a rentable foot on the fringe fifth of the city and $48
 * on the prime fifth — a 3.6x spread, which is already the top of what the
 * location gradient means to produce — but a flat $8.23 of opex against both
 * turned that into a 10.8x spread in NOI (28% margin against 85%) and a
 * 13.9x spread in value per foot ($36 against $502). Half the city's flats
 * sat in a bin whose median value was $77 a foot, a standing 1986 waterfront
 * block appraised at $11, and a fringe building at 73% let earned less than
 * nothing. Real secondary metros run three to four times fringe to prime.
 *
 * The missing fact is that operating cost follows the building's station.
 * Payroll, turns, utilities the owner carries, the standard of the finishes
 * that get repaired: the NAA and IREM income-expense surveys put class-A
 * garden apartments at roughly 1.3x class-C opex per foot against rents
 * about 1.7x apart, which is an elasticity of about one half on the rent
 * level. Property tax is separate and already ad valorem; the management fee
 * is already a share of collections. This is applied through the SAME
 * location multiplier the rent reads, pivoted on the city's mean address, so
 * the average building's expense line does not move — the fringe gets
 * cheaper to run and the prime dearer, which is what the surveys say.
 *
 * Applied at every site that prices a PARCEL. The class-level pro formas
 * (`devPencils` at the P90 site, the order book's class check) read the mean
 * or their own location, as noted at each.
 */
export const OPEX_LOC_ELASTICITY = 0.5;
export function locOpexMult(rec: ParcelRecord, econ: Econ | undefined, cls: BuiltClass): number {
  return Math.pow(locationRentMult(rec, econ, cls), OPEX_LOC_ELASTICITY);
}

// THE LEGACY FLAT TABLE IS GONE. It was "kept for compatibility with anything
// still asking the old question", and the thing still asking was multifamily —
// which billed $10.00/sf while planDevelopment, the land residual and every
// other class read opexPsf() at $8.22. A compatibility shim with one caller is
// not a shim, it is a second answer, and this one was worth 22% of an
// apartment building's operating cost. Deleted so it cannot come back: there
// is one operating-cost model and opexPsf is it.

/**
 * What share of the expense stack a TYPICAL roll of each class bills back.
 *
 * These are not free parameters — they fall out of the lease structures
 * `rollRecovery` actually writes. Retail and industrial are overwhelmingly
 * triple-net, so the owner is close to flat on expenses. Office is mostly
 * base-year, which recovers only the growth above the stop and therefore
 * recovers about a third of the stack across a roll of mixed vintages.
 * Apartments recover nothing: a residential lease is gross, always.
 *
 * This exists so that the income quoted on the tape is the income the
 * building earns. Ignore recoveries and a triple-net retail building looks a
 * third poorer than it is; assume full recovery and a gross office building
 * looks richer. Either way the number on the screen is a lie, and the loan
 * sized against it is a lie too.
 */
export const RECOVERY_RATE: Record<BuiltClass, number> = {
  retail: 0.88, industrial: 0.92, office: 0.50, multifamily: 0,
};

/** The share of the property-tax bill this building's owner actually eats. */
export function taxBorneShare(rec: ParcelRecord): number {
  if (rec.class === "land") return 1;
  return 1 - blendBy(rec, (u) => RECOVERY_RATE[u] * (u === "multifamily" ? 0 : 1));
}

/**
 * How a lease reimburses operating cost. This is the difference between an
 * office building that keeps its margin through an inflation decade and one
 * that quietly gives it all back.
 *
 *   nnn   — tenant pays its pro-rata share of opex AND taxes. Owner is flat.
 *   base  — base-year stop. The tenant reimburses only the growth in expenses
 *           above the level in the year it signed. Signed cheap in a cheap
 *           year and you carry that gap for the whole term; sign in an
 *           expensive year and the stop protects you.
 *   gross — the owner eats everything. Priced into the rent, in theory.
 */
export type Recovery = "nnn" | "base" | "gross";

export function recoveryOf(t: { recovery?: Recovery; net?: boolean }): Recovery {
  return t.recovery ?? (t.net ? "nnn" : "gross");
}

/**
 * What a tenant actually reimburses this year, in dollars, for opex and for
 * property tax. `baseStopPsf` is the expense level frozen at signing.
 */
/**
 * WHAT A TENANT WILL REIMBURSE of the service policy.
 *
 * Institutional service is +12% on the controllable half. An NNN clause
 * recovers the MARKET operating bill — the building's share of heat, tax,
 * insurance — not the extra front desk the landlord chose to staff. Lean
 * recovers lean (you cannot bill more than you spend). Above-market service
 * is an unrecovered amenity. See QUALITY_BALANCE_PLAN.md §3.
 */
export function recoverableService(service?: -1 | 0 | 1): -1 | 0 | 1 {
  return (Math.min(service ?? 0, 0)) as -1 | 0 | 1;
}

export function recoveryFor(
  t: { sf: number; recovery?: Recovery; net?: boolean; baseStopPsf?: number },
  opexNowPsf: number,
  taxNowPsf: number,
): { opex: number; tax: number } {
  const kind = recoveryOf(t);
  if (kind === "nnn") return { opex: t.sf * opexNowPsf, tax: t.sf * taxNowPsf };
  if (kind === "gross") return { opex: 0, tax: 0 };
  const stop = t.baseStopPsf ?? opexNowPsf + taxNowPsf;
  const overage = Math.max(0, opexNowPsf + taxNowPsf - stop);
  // a base-year stop recovers the growth, not the base — and it recovers it
  // against the combined bill, which is how the clause is actually written
  const total = overage * t.sf;
  const share = opexNowPsf + taxNowPsf > 0 ? opexNowPsf / (opexNowPsf + taxNowPsf) : 1;
  return { opex: total * share, tax: total * (1 - share) };
}

// Property tax: ~1.1% of assessed value a year. On net leases the tenant
// reimburses it; the landlord eats the share on vacant space and gross leases.
export const TAX_RATE = 0.011;

// Cap rates aren't one number per class: a trophy on the square trades tighter
// than a tired walk-up on the edge of town. Demand is location; condition is
// quality. Spread runs roughly ±0.6 points around the citywide class cap.
export function capRateFor(rec: ParcelRecord, econ: Econ, condition: Condition, condIdx?: number): number {
  // A buyer underwrites each part against its own comps and adds them up; the
  // blended cap rate is what falls out, not something quoted anywhere.
  const base = rec.class === "land" ? 6 : blend(rec, econ.capRate) || 6;
  // LOCATION IS PRICED, AND IT IS PRICED HARD.
  //
  // This band used to be eight tenths of a point wide across the entire demand
  // scale, which meant a fringe walk-up on a dead street traded within sixty
  // basis points of a corner on the best block in Ashport. That is not a
  // market; it is a spreadsheet with a location column nobody reads. Real
  // prime-to-fringe spreads run two and a half to four points, and that gap is
  // the central trade of the business: the fringe asset pays you more today
  // and asks you to believe the street will change, while the prime one costs
  // a fortune and lets you sleep. Without the spread there was no such choice
  // and no reason ever to buy anything but the highest yield on the tape.
  const locSpread = -((demandLinear(rec.demandScore) - 50) / 50) * 1.1;
  // and so is the state of the building — a tired asset needs a discount to
  // move, because the buyer is pricing the capital they are about to spend
  // and so is the state of the building — a tired asset needs a discount to
  // move, because the buyer is pricing the capital they are about to spend, and
  // an obsolete one is priced as the capital plus a demolition risk
  const qualSpread = condIdx !== undefined ? qualSpreadAt(condIdx) : qualSpreadAt(COND_CENTRE[condition] ?? 0.65);
  // Permanent bones, not today's paint. Class A office trades ~50-100 bp
  // tighter than Class B in the CBRE cap-rate surveys (2015-2024), trophy at
  // the wide end; part of that is the condition gap qualSpread already prices,
  // so the bones carry ±40 bp across spec 0..1 (Signature ~30 bp tighter than
  // market, Box ~18 bp wider). It was ±15 bp, which left a trophy trading
  // like a commodity building with a nicer lobby.
  const specSpread = (0.5 - (rec.buildSpec ?? 0.5)) * 0.80;
  return clamp(base + locSpread + qualSpread + specSpread, 3.2, 13);
}

// Appraisals are opinions. Each parcel's appraisal carries a stable bias off
// true value, and the honest range around it is about ±6%. Offers and lender
// sizing run off true value — the band is what YOU get to see.
export function appraise(bbl: string, value: number): { lo: number; mid: number; hi: number } {
  let hsh = 2166136261;
  for (let i = 0; i < bbl.length; i++) { hsh ^= bbl.charCodeAt(i); hsh = Math.imul(hsh, 16777619); }
  const bias = (((hsh >>> 8) % 1000) / 1000 - 0.5) * 0.07; // ±3.5%, fixed per parcel
  const mid = value * (1 + bias);
  return { lo: mid * 0.94, mid, hi: mid * 1.06 };
}

// market-implied NOI before property tax (unowned parcels; also the
// stabilized case for owned). Tax is capitalized in assetValue.
export function noiYr(rec: ParcelRecord, econ: Econ, condition: Condition, stabilised = false, condIdx?: number): number {
  if (rec.class === "land" || !rec.bldgArea) {
    // carry: taxes and insurance bleed on idle land
    return -landValue(rec, econ) * 0.012;
  }
  // ONE OPERATING-COST MODEL.
  //
  // This used to apply a flat expense RATIO per class while an owned building
  // was run through the line-item stack — two different numbers for the same
  // building. Worse, those ratios were all-in figures that already carried
  // property tax, so `noiAfterTaxYr` then took the tax off a second time. The
  // effect was that a building's NOI rose by a median of 31% the moment you
  // bought it: the tape, the acquisition panel and the loan desk were all
  // quoting income a third below what the asset actually earned.
  //
  // So it is the line-item stack here too — rent, less operating cost per
  // square foot, less the management fee — and property tax is subtracted
  // exactly once, in `noiAfterTaxYr`, where it says it is. A useful property
  // falls out for free: because operating cost is per square foot and rent is
  // not, an expensive corner runs a LOWER expense ratio than a cheap one,
  // which is how the business actually works and which no flat ratio can say.
  let rent = 0, recovered = 0, opex = 0;
  for (const use of uses(rec)) {
    // Income and opex on RENTABLE feet. Industry $/sf is BOMA rentable;
    // quoting it on gross (core, stairs, risers in) was the largest fake
    // number still standing — every rent, NOI and cap rate ~17% high.
    const sf = useRentableSf(rec, use);
    if (sf <= 0) continue;
    const occ = useOccupancy(rec, econ, use, stabilised);
    const op = sf * opexPsf(use, econ, false) * locOpexMult(rec, econ, use);
    rent += sf * useRentPsfYr(rec, econ, condition, use, condIdx) * occ;
    opex += op;
    // ...and what a typical roll of that class bills back. Recovery is
    // pro-rata on LET space, so an empty building eats its own expenses.
    recovered += op * occ * RECOVERY_RATE[use];
  }
  const egi = rent + recovered;
  return egi - opex - egi * MGMT_FEE;
}

/**
 * NET OPERATING INCOME, the way the industry defines it: after real estate
 * taxes. `noiYr` above deliberately stops short of them, because valuation
 * capitalises pre-tax income at a tax-loaded cap rate — algebraically the same
 * answer, and it avoids the circularity of taxing a value you have not
 * computed yet. But that number must never reach a player or a lender.
 *
 * It was reaching both. The tape, the acquisition panel and the loan desk were
 * all quoting income that ignored a bill running about 1.1% of value a year,
 * so every building looked roughly 110 basis points better than it was, every
 * loan was sized against income the building would never earn, and NOI fell
 * the moment you closed — because owned assets were computed correctly and
 * unowned ones were not.
 */
export function noiAfterTaxYr(rec: ParcelRecord, econ: Econ, condition: Condition, price: number): number {
  if (rec.class === "land" || !rec.bldgArea) return noiYr(rec, econ, condition);
  return noiYr(rec, econ, condition) - price * TAX_RATE * taxBorneShare(rec);
}

/**
 * THE STABILISED PRO-FORMA, AND IT IS NOT THE GOING-IN NUMBER.
 *
 * What this building earns once it is full — the same expense stack, the same
 * recoveries, the same tax bill, run against the occupancy the market says an
 * asset like this one settles at rather than the occupancy it has today. An
 * offering memorandum shows it, and it should: the SPREAD between this and
 * `inPlace().noi` below is the entire value-add trade, and a player who cannot
 * see it cannot tell a bargain from a leasing problem.
 *
 * It must never be the headline. It is a forecast, it is the seller's forecast,
 * and getting there costs money and years that this number does not carry.
 */
export function proFormaNOIYr(rec: ParcelRecord, econ: Econ, condition: Condition, price: number): number {
  if (rec.class === "land" || !rec.bldgArea) return noiYr(rec, econ, condition, true);
  return noiYr(rec, econ, condition, true) - price * TAX_RATE * taxBorneShare(rec);
}

/**
 * WHAT THE SELLER HAS DISCLOSED: the rent roll, the residential occupancy, and
 * the grade the deed will convey. This is a FACT about the building, not an
 * estimate of one — see Listing.roll and Approach.roll for why it is written
 * once, when the building comes to market or the conversation opens, and never
 * regenerated.
 */
export interface Disclosure {
  roll?: Tenant[];
  occ?: number;
  cond?: Condition;
  condIdx?: number;
  resRentPsf?: number;
}

/**
 * ONE APPRAISAL FOR A BUILDING YOU DO NOT OWN YET.
 *
 * The parcel desk appraised a listed building with `assetValue` — the class
 * model's opinion of a building like this one, at market occupancy, with no
 * roll and no roll-quality spread — while the ask was struck on
 * `conveyedValue` (the roll, taxed at nothing) and the deed, the day it
 * closed, marked at `holdingValue` (the roll, taxed at the price). Three
 * readers, three numbers, and "vs appraisal −7%" on a card whose appraisal
 * was not an appraisal of this building. Measured on the tape (six seeds,
 * `askmark`): the class model ran 35% over the roll-based value on a 96%-let
 * shop with one short tenant, and under it on a full block of flats.
 *
 * A lender's appraiser, a buyer's underwriter and the seller's broker all
 * read the same thing: the rent roll in hand, capitalised at the cap rate
 * the roll's quality earns, taxed at the standing assessment. That is
 * `holdingValue` on the disclosed roll, which is the same function the deed
 * will be marked with after the closing — so the only thing that changes at
 * the closing table is the tax reassessment at the price, and the card says
 * so. A building with no disclosure (nobody has listed it, nobody has rung)
 * still gets the class model, because there is nothing else to read.
 */
export function marketAppraisal(s: GameState, rec: ParcelRecord, bbl: string, grade?: Condition): number {
  const own = s.holdings?.[bbl];
  if (own) return ownedHoldingValueFromRec(s, rec, own);
  const d = rec.class !== "land" && rec.bldgArea > 0 ? disclosureFor(s, bbl) : null;
  const cond = d?.cond ?? grade ?? initialCondition(rec);
  const idx = d?.condIdx ?? initialCondIdx(rec, s.month, grade);
  if (!d) return assetValue(rec, s.econ, cond, idx);
  const vessel = { ...asIfOwned(s, bbl, 0, d, rec), costBasis: 0, assessed: assetValue(rec, s.econ, cond, idx) } as Holding;
  return holdingValue(rec, s.econ, vessel, s.month);
}

/**
 * THE SIZE OF A BUILDING IN THIS TOWN, for the desks' minimum cheques. The
 * median value of the built stock over a $4M reference — the city the
 * product sheet's minimums were written against — clamped 0.25 to 4. Every
 * third parcel is enough for a median and keeps a yearly pass cheap.
 */
export function cityLoanScale(s: GameState, parcels: Record<string, ParcelRecord>): number {
  const vals: number[] = [];
  let i = 0;
  for (const bbl of Object.keys(parcels)) {
    if (i++ % 3 !== 0) continue;
    const rec = resolveRec(parcels, s, bbl);
    if (!rec || rec.class === "land" || !(rec.bldgArea > 0)) continue;
    const v = assetValue(rec, s.econ, initialCondition(rec), initialCondIdx(rec, s.month));
    if (v > 0) vals.push(v);
  }
  if (vals.length < 20) return 1;
  vals.sort((a, b) => a - b);
  const med = vals[Math.floor(vals.length / 2)];
  return +Math.max(0.25, Math.min(4, med / 4_000_000)).toFixed(3);
}

/** The disclosure on a building the player could buy today, or null. */
export function disclosureFor(s: GameState, bbl: string): Disclosure | null {
  const li = s.listings?.find((l) => l.bbl === bbl);
  if (li && (li.roll !== undefined || li.occ !== undefined)) return { roll: li.roll, occ: li.occ, cond: li.cond, condIdx: li.condIdx, resRentPsf: li.resRentPsf };
  // A conversation that was refused is not a disclosure — there is no
  // conversation. Everything else that is open has had the paper sent over.
  const a = s.approaches?.[bbl];
  if (a && !a.refused && (a.roll !== undefined || a.occ !== undefined)) return { roll: a.roll, occ: a.occ, cond: a.cond, condIdx: a.condIdx, resRentPsf: a.resRentPsf };
  return null;
}

/**
 * THE DISCLOSED BUILDING, SHAPED LIKE ONE YOU ALREADY OWN.
 *
 * Every function in this engine that prices a building you own — holdingNOIYr,
 * operatingStatement, heldOccupancy, physicalOcc — walks a `Holding`. So the
 * way to guarantee that the number on the screen before the closing is the
 * number the deed hands over is not to write a second pricing path that agrees
 * with the first; it is to put the disclosed facts in the shape the first one
 * already reads. Two implementations of one quantity is how the gap opened in
 * the first place.
 *
 * The vessel is built exactly the way `executePurchase` builds the real
 * holding: `assessed` at the price you would pay, because a sale reassesses at
 * the deal price; the ops policy you close on, because `opexPsf` reads it; and
 * the grade the memorandum was priced at, distress knock already applied.
 */
export function asIfOwned(s: GameState, bbl: string, price: number, d: Disclosure, rec?: ParcelRecord): Holding {
  return {
    bbl,
    boughtM: s.month,
    costBasis: price,
    assessed: price,
    loan: null,
    condition: d.cond ?? (rec ? initialCondition(rec) : "standard"),
    condIdx: d.condIdx ?? (rec ? initialCondIdx(rec, s.month, d.cond) : undefined),
    tenants: (d.roll ?? []) as Tenant[],
    cfHistory: [],
    // IT CLOSES ON THE HOUSE POLICY — the same two lines executePurchase
    // writes. They are not cosmetic: `opexPsf` reads `service`, so a vessel
    // without them prices the building at a different operating cost from the
    // one it will be run at the day after the deed moves. Measured on 37
    // listings by dropping the field back out: worth nothing at the default
    // stance, $5,909 of NOI a building on the high-service policy and $4,924
    // on the lean one. Inert until the player touches the dial, and a silent
    // gap at the closing table the moment they do.
    service: s.opsPolicy?.service ?? 0,
    stance: s.opsPolicy?.stance ?? 0,
    plan: s.opsPolicy?.plan ?? 1,
    ...(d.occ !== undefined ? { occ: d.occ } : {}),
    ...(d.resRentPsf !== undefined ? { resRentPsf: d.resRentPsf } : {}),
    ...(s.landmarks?.[bbl] !== undefined ? { landmarked: true } : {}),
  } as unknown as Holding;
}

/**
 * IN-PLACE INCOME AND IN-PLACE OCCUPANCY — the going-in numbers, off the
 * disclosed roll, and there is nothing to guess.
 *
 * The owner's instruction, verbatim: "there will be no hidden or guessing work
 * in the noi or occupancy when buying a property. You need to know exactly what
 * you are buying." That is also how the business works — a seller hands over a
 * rent roll and a trailing twelve, and in-place income is a disclosed fact.
 *
 * It was being guessed. Every going-in cap the player saw came out of
 * `noiAfterTaxYr`, which takes a ParcelRecord and therefore STRUCTURALLY cannot
 * see a rent roll; inside it, `useOccupancy` — documented as "the market read
 * on a building" — stood in for the roll. Measured over 3,195 listings across
 * twelve seeds: the read ran 89% median against an actual roll of 69%, and the
 * roll was below the read in 88% of them. Worse, it was ADVERSELY SELECTED.
 * Quartiled by the quoted going-in cap the read was flat — 93/90/87/87 — while
 * the roll collapsed 83/80/67/46, because a quoted cap is high precisely when
 * the estimate underneath it is wrong. A buyer screening the tape on yield
 * bought a median 44%-let building against an 86% read and earned $35K where
 * $152K was underwritten.
 *
 * `disclosed` is the flag a panel needs: TRUE means this is the offering
 * memorandum and the number is a fact. FALSE means nobody has shown you
 * anything — an unlisted building you have not rung about — and the number is
 * the class model's estimate, which is honest as long as it is LABELLED as one.
 * You cannot buy a building in that state, so it never prices a decision.
 */
/**
 * IS AN UNSOLICITED PITCH WORTH THE PHONE CALL?
 *
 * The owner's rule, and it is a rule about respect for the player's time:
 * never ring a principal about a building priced ABOVE its own appraisal
 * unless the yield is in the best quarter of what is publicly for sale. Paying
 * up is allowed — an off-market building that never comes to market is worth
 * hearing about — but paying up for an ordinary yield is not, and somebody who
 * takes that call twice stops taking the call.
 *
 * It lives here, in one function, because TWO channels ring the player and they
 * must not drift apart: `tickBrokerCalls` in actions.ts, and the grudge payoff
 * in rivals.ts where a firm that beat you to a corner offers it back before the
 * tape. Two copies of one rule is the third kind of fake number by this
 * codebase's own definition.
 *
 * The comparison set is the LIVE TAPE because that is the alternative the
 * player literally has — not a constant, not a class average. A tape too thin
 * to support a quartile cannot refuse anything, and on a tape that thin an
 * off-market file is worth hearing anyway.
 */
export function worthTheCall(
  s: GameState, parcels: Record<string, ParcelRecord>, rec: ParcelRecord, bbl: string, ask: number, value: number,
): boolean {
  // A discount to appraisal needs no defence — the discount is the reason.
  if (!(ask > value)) return true;
  const yieldOf = (r: ParcelRecord, price: number, at: string): number => {
    if (!(price > 0) || r.class === "land" || !r.bldgArea) return -1;
    const noi = inPlace(r, s, at, price).noi;
    return noi > 0 ? noi / price : -1;
  };
  const mine = yieldOf(rec, ask, bbl);
  if (!(mine > 0)) return false;
  const tape: number[] = [];
  for (const l of s.listings ?? []) {
    const r = resolveRec(parcels, s, l.bbl);
    if (!r) continue;
    const y = yieldOf(r, l.ask, l.bbl);
    if (y > 0) tape.push(y);
  }
  if (tape.length < 6) return true;
  tape.sort((a, b) => a - b);
  return mine >= tape[Math.floor(0.75 * (tape.length - 1))];
}

export function inPlace(
  rec: ParcelRecord, s: GameState, bbl: string, price: number,
): { noi: number; occ: number; disclosed: boolean; h: Holding | null } {
  const own = s.holdings?.[bbl];
  if (own) {
    // You own it. The roll IS the roll; nothing is disclosed to you because
    // nothing is hidden from you.
    // `physicalOcc`, not `heldOccupancy`: on a mixed-use building the latter
    // divides the commercial roll by the WHOLE building and never sees the
    // flats, so a full block of shops over full flats read as a third let.
    // A leased fee has no roll of yours — the going-in figure is the ground
    // coupon, not a vacant shell's zero NOI.
    if (own.groundLeased) {
      return { noi: ownedHoldingNoiYrFromRec(s, rec, own), occ: 1, disclosed: true, h: own };
    }
    return { noi: contractNoiYr(rec, s.econ, own, s.month), occ: physicalOcc(rec, own), disclosed: true, h: own };
  }
  if (rec.class === "land" || !rec.bldgArea) {
    return { noi: noiAfterTaxYr(rec, s.econ, "standard", price), occ: 0, disclosed: true, h: null };
  }
  const d = disclosureFor(s, bbl);
  if (!d) {
    const cond = initialCondition(rec);
    return { noi: noiAfterTaxYr(rec, s.econ, cond, price), occ: occupancy(rec, s.econ), disclosed: false, h: null };
  }
  const h = asIfOwned(s, bbl, price, d, rec);
  return { noi: contractNoiYr(rec, s.econ, h, s.month), occ: physicalOcc(rec, h), disclosed: true, h };
}

/**
 * IN-PLACE NOI IS THE CONTRACT, NOT THIS MONTH'S CHEQUE.
 *
 * `holdingNOIYr(…, month)` is the cash statement: a tenant inside a free-rent
 * period contributes nothing to it, which is right for the bank balance and
 * wrong for every desk that printed it as "In-place NOI / yr". Measured over
 * three campaigns: 56 one-month NOI moves of more than 50% on buildings over
 * half let — an anchor's two abated months read as the income falling by
 * two thirds and coming back, with the appraisal and the lender's coverage
 * moving with it. An appraiser and a lender both underwrite the contract
 * rent and carry the abatement as a reserve — which is exactly what
 * `holdingValue` already did with its `contractNoi` and `remainingAbatement`.
 * This is that reading, for the desks: every lease counts at its contract
 * rent; a gut renovation still reads as one (nothing is earned while the
 * crews are in). The cash tick keeps `holdingNOIYr(…, month)`.
 */
export function contractNoiYr(rec: ParcelRecord, econ: Econ, h: Holding, month: number): number {
  const inGut = h.renovatingUntilM !== undefined && month < h.renovatingUntilM;
  return holdingNOIYr(rec, econ, h, inGut ? month : Number.POSITIVE_INFINITY);
}

/** The canonical deed NOI on the contract basis — ground coupon on a leased fee, contract rent on a building. */
export function ownedContractNoiYr(
  s: GameState, parcels: Record<string, ParcelRecord>, h: Holding,
): number {
  const rec = resolveRec(parcels, s, h.bbl);
  if (!rec) return 0;
  if (h.groundLeased) return ownedHoldingNoiYrFromRec(s, rec, h);
  return contractNoiYr(rec, s.econ, h, s.month);
}

// The landlord's share of the property-tax bill: net leases reimburse it,
// so you pay on the vacant + gross-leased fraction of the building.
/** The gross property-tax bill, before anyone reimburses anything. */
export function grossTaxYr(rec: ParcelRecord, h: Holding): number {
  const assessed = h.assessed ?? h.costBasis;
  if (rec.class === "land" || !rec.bldgArea) return 0; // land carry already covers it
  return assessed * TAX_RATE;
}

/**
 * The landlord's net share of the tax bill after recoveries. NNN tenants pay
 * their pro-rata share in full; base-year tenants pay only the growth above
 * their stop; gross tenants and vacant space are the owner's problem.
 */
export function propertyTaxYr(rec: ParcelRecord, h: Holding, econ?: Econ): number {
  const bill = grossTaxYr(rec, h);
  if (!bill) return 0;
  if (rec.class === "multifamily") return bill;   // residential leases are gross
  const taxPsf = bill / Math.max(1, rec.bldgArea);
  const opexNowPsf = econ ? opexPsf(rec.class as BuiltClass, econ, h.programsDone?.systems !== undefined, recoverableService(h.service)) * locOpexMult(rec, econ, rec.class as BuiltClass) : taxPsf;
  let recovered = 0;
  for (const t of h.tenants) recovered += recoveryFor(t, opexNowPsf, taxPsf).tax;
  return Math.max(0, bill - recovered);
}

// in-place NOI from the actual rent roll (owned assets, Phase 3 onward)
export function holdingNOIYr(rec: ParcelRecord, econ: Econ, h: Holding, currentQ: number): number {
  if (h.renovatingUntilM !== undefined && currentQ < h.renovatingUntilM) {
    return -Math.max(0, rec.bldgArea) * 1.2 - (h.groundRentOut?.rentYr ?? 0); // dark during the gut; the ground rent is not
  }
  // A ground-leased lot does not carry: the lessee pays the taxes and the
  // insurance, which is what "absolutely net" means. Its income arrives
  // separately as ground rent, so charging carry here would bill it twice.
  //
  // This must be checked BEFORE the resolved parcel class. Once the lessee's
  // improvement opened, resolveRec correctly returned a building instead of
  // land — and this function then charged the fee owner that building's tax,
  // insurance, operating cost and vacancy despite the ground lease explicitly
  // putting every one of them on the lessee.
  if (h.groundLeased) return 0;
  if (rec.class === "land" || !rec.bldgArea) return -landValue(rec, econ) * 0.012;
  const cls = rec.class as BuiltClass;
  if (cls === "multifamily") {
    // units turn over and things break: a 7% reserve off collections for
    // turns, appliances, roofs. Appraisers skip it; owners never get to.
    const occ = h.occ ?? occupancy(rec, econ);
    // the roll in place, not the spot market — see Holding.resRentPsf
    const egi = rentableSf(rec) * (h.resRentPsf ?? marketRentPsfYr(rec, econ, h.condition, h.condIdx)) * occ;
    // ONE OPERATING-COST MODEL, AND APARTMENTS ARE NOT AN EXCEPTION. This read
    // the legacy flat table at $10.00/sf while planDevelopment, the land
    // residual and every other class read opexPsf() at $8.22 — so a block of
    // flats was UNDERWRITTEN at one operating cost and OPERATED at another 22%
    // higher. It also skipped the two things opexPsf carries and a flat number
    // cannot: the service policy moving the CONTROLLABLE half only (a manager
    // cannot economise on insurance), and the systems programme.
    const systemsDone = h.programsDone?.systems !== undefined;
    const opexBill = rentableSf(rec) * managedOpexPsf(cls, econ, systemsDone, h.service, h.pmOpexMult ?? 1) * locOpexMult(rec, econ, cls);
    return egi * (1 - MGMT_FEE - APT_RESERVE) - opexBill - propertyTaxYr(rec, h) - (h.groundRentOut?.rentYr ?? 0);
  }
  // Rent first, then the expense stack, then what comes back through the
  // recovery clauses. Vacant space reimburses nothing and still costs money —
  // that gap is the whole reason occupancy matters more than headline rent.
  const systemsDone = h.programsDone?.systems !== undefined;
  // YOUR MANAGEMENT, ON YOUR BUILDING. See Holding.pmOpexMult. Applied to the
  // controllable half only — fixed costs do not care who manages the building.
  const opexNowPsf = managedOpexPsf(cls, econ, systemsDone, h.service, h.pmOpexMult ?? 1) * locOpexMult(rec, econ, cls);
  const opexRecoverPsf = managedOpexPsf(cls, econ, systemsDone, recoverableService(h.service), h.pmOpexMult ?? 1) * locOpexMult(rec, econ, cls);
  const taxBill = grossTaxYr(rec, h);
  const taxNowPsf = taxBill / Math.max(1, rec.bldgArea);

  let baseRent = 0, leasedSf = 0, recoveredOpex = 0, recoveredTax = 0;
  for (const t of h.tenants) {
    leasedSf += t.sf;
    // Recoveries keep running through a free-rent period — free rent is a
    // concession on BASE rent, not on the tenant's share of the boiler.
    const r = recoveryFor(t, opexRecoverPsf, taxNowPsf);
    recoveredOpex += r.opex;
    recoveredTax += r.tax;
    if (t.freeUntilM !== undefined && currentQ < t.freeUntilM) continue;
    baseRent += t.rentPsf * t.sf;
  }
  const egi = baseRent + recoveredOpex + recoveredTax;
  const opexBill = opexNowPsf * rentableSf(rec);               // the owner pays it all, then bills it out
  const mgmt = egi * MGMT_FEE;
  // A LEASEHOLD PAYS ITS GROUND RENT BEFORE ANYTHING ELSE. It is an operating
  // cost of the building, not a financing cost, so every reader of NOI — the
  // month's cash, the DSCR test, the lender's sizing — sees it.
  return egi - opexBill - mgmt - taxBill - (h.groundRentOut?.rentYr ?? 0);
}

/**
 * The operating statement, line by line, the way it would be presented in an
 * offering memorandum. The number that matters and never gets shown anywhere
 * is `leakage` — the share of the expense bill that no lease reimburses. On a
 * building full of triple-net paper it is nearly nothing; on a gross-leased
 * building in year twelve of an inflation run it is the whole margin.
 */
/**
 * HOW FULL THIS BUILDING ACTUALLY IS.
 *
 * `h.occ` is only maintained for apartments — a commercial building's
 * occupancy IS its rent roll, and there is no field carrying it. So every
 * caller that reached for `h.occ ?? occupancy(rec, econ)` on an office
 * building silently got the CITYWIDE market number instead of the truth about
 * this asset: a tower with two tenants in it read as 84% let, and an empty new
 * one read the same. One accessor, one answer, both classes.
 */
export function heldOccupancy(rec: ParcelRecord, econ: Econ, h: Holding): number {
  if (rec.class === "multifamily") return clamp(h.occ ?? occupancy(rec, econ), 0, 1);
  if (!rec.bldgArea) return 0;
  let leased = 0;
  for (const t of h.tenants ?? []) leased += t.sf;
  return clamp(leased / Math.max(1, rentableSf(rec)), 0, 1);
}

export function operatingStatement(rec: ParcelRecord, econ: Econ, h: Holding, month: number) {
  // Fee owner is not the landlord — `holdingNOIYr` already returns 0. Callers
  // that reach for this statement on a leased fee must not invent vacant-shell
  // tax/opex fiction against the lessee's tower.
  if (h.groundLeased) {
    return {
      baseRent: 0, freeRent: 0, recoveredOpex: 0, recoveredTax: 0, egi: 0,
      opex: 0, mgmt: 0, reserve: 0, tax: 0, noi: 0, groundRent: 0,
      leasedSf: 0, vacantSf: 0, leakage: 0, opexPsf: 0, taxPsf: 0,
    };
  }
  // Apartments never ran this statement honestly: the machinery below walks a
  // rent roll, and a residential building does not keep one — its roll is an
  // occupancy (see holdingNOIYr), every lease is gross, and nothing is ever
  // recovered. So the statement is assembled from the same lines that
  // function nets — collections, the flat opex load, the 7% reserve for turns
  // and roofs, the full tax bill — and the two can never quote different NOIs
  // for one building.
  const groundRent = h.groundRentOut?.rentYr ?? 0;
  if (rec.class === "multifamily") {
    const occ = h.occ ?? occupancy(rec, econ);
    const letSf = rentableSf(rec);
    const egi = letSf * (h.resRentPsf ?? marketRentPsfYr(rec, econ, h.condition, h.condIdx)) * occ;
    // The same opexPsf every other class reads — see holdingNOIYr, where the
    // flat legacy table used to disagree with it by 22%.
    const systemsDone = h.programsDone?.systems !== undefined;
    const opexBill = letSf * managedOpexPsf("multifamily", econ, systemsDone, h.service, h.pmOpexMult ?? 1) * locOpexMult(rec, econ, "multifamily");
    const taxBill = grossTaxYr(rec, h);
    return {
      baseRent: egi, freeRent: 0, recoveredOpex: 0, recoveredTax: 0, egi,
      opex: opexBill, mgmt: egi * MGMT_FEE, reserve: egi * APT_RESERVE, tax: taxBill,
      noi: egi * (1 - MGMT_FEE - APT_RESERVE) - opexBill - taxBill - groundRent, groundRent,
      leasedSf: Math.round(letSf * occ), vacantSf: Math.round(letSf * (1 - occ)),
      // gross leases bill nothing back; the whole expense stack is the owner's
      leakage: opexBill + taxBill > 0 ? 1 : 0,
      opexPsf: opexBill / Math.max(1, letSf), taxPsf: taxBill / Math.max(1, letSf),
    };
  }
  const cls = rec.class as BuiltClass;
  const systemsDone = h.programsDone?.systems !== undefined;
  // YOUR MANAGEMENT, ON YOUR BUILDING. See Holding.pmOpexMult. Applied to the
  // controllable half only — fixed costs do not care who manages the building.
  const opexNowPsf = managedOpexPsf(cls, econ, systemsDone, h.service, h.pmOpexMult ?? 1) * locOpexMult(rec, econ, cls);
  const opexRecoverPsf = managedOpexPsf(cls, econ, systemsDone, recoverableService(h.service), h.pmOpexMult ?? 1) * locOpexMult(rec, econ, cls);
  const taxBill = grossTaxYr(rec, h);
  const taxNowPsf = taxBill / Math.max(1, rec.bldgArea);
  let baseRent = 0, leasedSf = 0, recOpex = 0, recTax = 0, free = 0;
  for (const t of h.tenants) {
    leasedSf += t.sf;
    const r = recoveryFor(t, opexRecoverPsf, taxNowPsf);
    recOpex += r.opex; recTax += r.tax;
    if (t.freeUntilM !== undefined && month < t.freeUntilM) { free += t.rentPsf * t.sf; continue; }
    baseRent += t.rentPsf * t.sf;
  }
  const opexBill = opexNowPsf * rentableSf(rec);
  const egi = baseRent + recOpex + recTax;
  const mgmt = egi * MGMT_FEE;
  const noi = egi - opexBill - mgmt - taxBill - groundRent;
  const billed = opexBill + taxBill;
  return {
    baseRent, freeRent: free, recoveredOpex: recOpex, recoveredTax: recTax, egi,
    opex: opexBill, mgmt, tax: taxBill, noi, groundRent,
    leasedSf, vacantSf: Math.max(0, rentableSf(rec) - leasedSf),
    // what you pay and never bill back, as a share of the whole expense stack
    leakage: billed > 0 ? Math.max(0, billed - recOpex - recTax) / billed : 0,
    opexPsf: opexNowPsf, taxPsf: taxNowPsf,
  };
}

export function assetValue(rec: ParcelRecord, econ: Econ, condition: Condition, condIdx?: number): number {
  const land = landValue(rec, econ);
  if (rec.class === "land" || !rec.bldgArea) return land;
  const sinceM = rec.yearBuilt && econ.m !== undefined
    ? Math.round((START_YEAR + econ.m / 12 - rec.yearBuilt) * 12) : 999;
  // an underbuilt lot is worth the greater of its income or its dirt.
  // A building still in lease-up is never worth less than the lot. The weight
  // is the same fade holdingValue applies; here it is 1 whenever there is a
  // mark at all, because a record read off the market's own lease-up curve
  // reaches its stabilised occupancy exactly when the curve ends.
  return Math.max(incomeValueAsIs(rec, econ, condition, condIdx), landAppraisalFloor(rec, econ, leaseUpWeight(rec, sinceM)));
}

/**
 * WHAT THE BUILDING IS WORTH AS A BUILDING — its income capitalised, with no
 * floor at the land under it. `assetValue` is this or the dirt, whichever is
 * more, which is the right price for a buyer; it is the wrong cost for a
 * redevelopment, because the dirt's residual IS the redevelopment.
 */
export function incomeValueAsIs(rec: ParcelRecord, econ: Econ, condition: Condition, condIdx?: number): number {
  if (rec.class === "land" || !rec.bldgArea) return 0;
  // Pre-tax NOI capitalised at the cap plus the tax the OWNER carries. A
  // triple-net building bills its tax bill to its tenants, so loading the full
  // rate onto every class priced net-leased retail as if it paid its own taxes.
  const income = noiYr(rec, econ, condition, false, condIdx) / (capRateFor(rec, econ, condition, condIdx) / 100 + TAX_RATE * taxBorneShare(rec));
  // A BUILDING STILL FILLING IS NOT PRICED OFF THE MONTH IT IS HAVING.
  //
  // Capitalising a lease-up roll at a stabilised cap rate counts the same risk
  // twice — once in a numerator that is a fifth of where it is going, and
  // again in a cap rate meant for an asset that has already arrived. The
  // result is that anything under about four years old marks below its dirt.
  // Priced properly it is the stabilised value less the cost and the risk of
  // getting there, which is both lower than a full building and higher than a
  // hole in the ground.
  const sinceM = rec.yearBuilt && econ.m !== undefined
    ? Math.round((START_YEAR + econ.m / 12 - rec.yearBuilt) * 12) : 999;
  const asIs = leaseUpMarkAt(
    rec, econ, condition, sinceM, occupancy(rec, econ),
    clamp(capRateFor(rec, econ, condition, condIdx), 2.8, 13) / 100,
  );
  return asIs === null ? income : income + leaseUpWeight(rec, sinceM) * Math.max(0, asIs - income);
}

/**
 * Appraisal-facing value — adds the hedonic location premium on the land
 * component only. Sim paths (acquisition, development, order book) use
 * `assetValue`; panels and vs-appraisal readouts use this.
 */
export function appraisalAssetValue(rec: ParcelRecord, econ: Econ, condition: Condition): number {
  const base = assetValue(rec, econ, condition);
  const prem = rec.locPremium ?? 1;
  if (prem <= 1.001) return base;
  const land = landValue(rec, econ);
  return Math.round(base + land * (prem - 1));
}

/** Panel/appraisal readout — location premium on the land slice, sim unchanged. */
export function displayValue(rec: ParcelRecord, econ: Econ, simValue: number): number {
  const prem = rec.locPremium ?? 1;
  if (prem <= 1.001) return simValue;
  return Math.round(simValue + landValue(rec, econ) * (prem - 1));
}

// owned assets appraise on a blend of in-place income and stabilized market —
// an empty building isn't worthless, but it isn't stabilized either
/**
 * What a BUYER pays for this specific rent roll, expressed as a spread to the
 * class cap. Two buildings with identical NOI are not worth the same money:
 * one let to investment-grade covenants on ten-year paper is bond-like, and
 * one rolling forty per cent of its income next year is a leasing project. The
 * market prices that difference in basis points, and so should this.
 */
/**
 * THE LARGEST *TRADE'S* SHARE OF THE RENT ROLL, and how much trouble it is in.
 *
 * A building let to five different law firms is concentrated in exactly one
 * way that matters and the single-tenant measure below cannot see it: five
 * names, one industry, one cycle. When that cycle turns they do not fail one
 * at a time. This is what a buyer is actually asking when they ask who the
 * tenants are.
 */
export function industryConcentration(h: Holding, econ?: Econ): { share: number; sector: Sector | null; stressed: number } {
  let total = 0;
  const by = new Map<Sector, number>();
  for (const t of h.tenants) {
    const annual = t.rentPsf * t.sf;
    total += annual;
    by.set(t.sector, (by.get(t.sector) ?? 0) + annual);
  }
  if (total <= 0) return { share: 0, sector: null, stressed: 0 };
  let top: Sector | null = null, topV = 0, stressed = 0;
  for (const [k, v] of by) {
    if (v > topV) { topV = v; top = k; }
    if (econ) stressed += v * industryStress(econ, k);
  }
  return { share: topV / total, sector: top, stressed: stressed / total };
}

/** The largest tenant's share of the rent roll. */
export function concentration(h: Holding): number {
  let top = 0, total = 0;
  for (const t of h.tenants) {
    const annual = t.rentPsf * t.sf;
    total += annual;
    if (annual > top) top = annual;
  }
  return total > 0 ? top / total : 0;
}

/**
 * Residential does not have a rent roll to grade — it has an occupancy, and
 * every lease on it is a twelve-month lease to an unrated household. Grading
 * it through the commercial machinery gave the same answer every time: no
 * named tenants, therefore "an empty building is a project", therefore a flat
 * 55bp penalty on the cap, forever, on a building running at 96% full. Price
 * it on the only thing that actually varies.
 */
function residentialSpread(h: Holding): number {
  const occ = h.occ ?? 0.95;
  return clamp((0.94 - occ) * 2.2, -0.12, 0.85);
}

export function rollQualitySpread(rec: ParcelRecord, h: Holding, month: number, econ?: Econ): number {
  if (rec.class === "land" || !rec.bldgArea) return 0.55;
  // The commercial part is what the tenants lease. Measuring a rent roll
  // against the WHOLE building marked a full block of flats with shops at
  // grade as 12% occupied and priced it as a shell.
  const commSf = rec.bldgArea * clamp(commercialShare(rec), 0, 1);
  const resShare = clamp(1 - commSf / rec.bldgArea, 0, 1);
  if (!h.tenants.length) {
    return resShare > 0.5 ? residentialSpread(h) : 0.55;   // an empty commercial building really is a project
  }
  let sfTot = 0, wCredit = 0, wYears = 0, nnnSf = 0, wRev = 0;
  for (const t of h.tenants) {
    sfTot += t.sf;
    wCredit += t.credit * t.sf;
    wYears += Math.max(0, (t.endM - month) / 12) * t.sf;
    if (recoveryOf(t) === "nnn") nnnSf += t.sf;
    // THE REVERSION MARK.
    //
    // A rent roll is not only how long and how good — it is where the contract
    // sits against the market, and for how long you are stuck with the answer.
    // Paper twenty per cent UNDER market with nine years to run is a building
    // whose income cannot grow: the reversion a buyer is paying for is a decade
    // away, so they cap it wider. Paper twenty per cent OVER market is worse,
    // and asymmetrically so — the income is going to FALL on a date everybody
    // underwriting it can read. Only paper near market, or short paper
    // anywhere, earns the tight number.
    //
    // Without this the spread was blind to rent level, so a seven-year lease at
    // three quarters of market graded as good covenant. Measured over 945
    // arriving letters: 94.4% of them, if signed, IMPROVED the building's grade
    // (median 31bps tighter) and only 4.1% worsened it. Signing was a free
    // upgrade on every axis the engine priced, which is most of why "Accept"
    // was the right answer to 52% of the decisions in the game.
    if (econ) {
      const mkt = managedRentPsfYr(rec, econ, h, t.use);
      if (mkt > 0.5) {
        const off = Math.abs(1 - t.rentPsf / mkt);       // how far from market, either way
        const yrs = Math.max(0, (t.endM - month) / 12);  // how long you are stuck with it
        const over = t.rentPsf > mkt ? 1.4 : 1;          // over-rented is the harder problem
        wRev += clamp((off - 0.05) * 3.0 * Math.min(1, yrs / 6) * over, -0.25, 0.70) * t.sf;
      }
    }
  }
  if (!sfTot) return resShare > 0.5 ? residentialSpread(h) : 0.55;
  const occ = sfTot / Math.max(1, commSf);
  const walt = wYears / sfTot;
  const credit = wCredit / sfTot;                       // 0..2
  // long paper and good covenants compress the cap; short paper widens it
  const waltSpread = clamp(0.45 - 0.11 * walt, -0.30, 0.55);
  const creditSpread = 0.18 - 0.20 * credit;            // +0.18 unrated, −0.22 investment grade
  const occSpread = clamp((0.9 - occ) * 1.4, -0.10, 0.75);
  const structSpread = -0.10 * (nnnSf / sfTot);         // net paper is easier to finance
  // CONCENTRATION. A building where one name is most of the income is not an
  // income stream, it is a bet on that name, and the market prices it as one.
  // Single-tenant assets trade wide unless the covenant is bond-grade and the
  // term is long — which is exactly the combination that makes them trade
  // tight. Both halves of that live in `concSpread`.
  const conc = concentration(h);
  const covenantRelief = credit >= 1.6 && walt >= 8 ? 0.55 : credit >= 1.6 ? 0.25 : 0;
  const concSpread = clamp((Math.max(0, conc - 0.35) / 0.65) * 0.75 * (1 - covenantRelief), 0, 0.75);
  // INDUSTRY CONCENTRATION, which the single-name measure above cannot see.
  // Five law firms is five names and one cycle, and a building whose one trade
  // is currently in a bust is a leasing project wearing a rent roll — the
  // market prices both, and it prices the second one harder.
  const ind = industryConcentration(h, econ);
  const indSpread = clamp((Math.max(0, ind.share - 0.45) / 0.55) * 0.40 + ind.stressed * 0.55, 0, 0.85);
  const revSpread = wRev / sfTot;
  const comm = waltSpread + creditSpread + occSpread + structSpread + concSpread + indSpread + revSpread;
  // A mixed building is graded as what it is: part rent roll, part occupancy.
  return resShare > 0.02 ? comm * (1 - resShare) + residentialSpread(h) * resShare : comm;
}

/**
 * The abatement a buyer still has to fund: months of free rent already granted
 * to the sitting roll that have not yet burned off, at contract rent.
 *
 * This is a line BELOW the net operating income, not a hole in it. Nobody
 * capitalises a free-rent period — the building is not worth ten times less
 * because six months of concession are running. The buyer takes the contract
 * rent roll, capitalises it, and knocks the remaining abatement off the price
 * as a dollar-for-dollar credit at closing, because that is what it costs.
 */
export function remainingAbatement(h: Holding, month: number): number {
  let owed = 0;
  for (const t of h.tenants) {
    if (t.freeUntilM === undefined || t.freeUntilM <= month) continue;
    owed += t.rentPsf * t.sf * ((t.freeUntilM - month) / 12);
  }
  return owed;
}

/**
 * WHAT A BUILDING IS WORTH THE MONTH IT OPENS.
 *
 * Nothing in this engine hurt a developer more than this, and the number was
 * not a judgement — it was an accident of arithmetic. holdingValue capitalises
 * in-place NOI. A building that opened last month has no tenants, so its
 * in-place NOI is *negative* — it pays the boiler, the insurance and the tax
 * bill and collects nothing — and dividing a negative income by a cap rate
 * produces a negative capital value. Measured on a 174,300 sf tower on the best
 * corner in New Alden, delivered on programme: basis $158.7M, debt $94.1M,
 * in-place leg −$69.9M, blended mark −$27.6M, and the only thing standing
 * between the developer and a negative balance sheet was the floor under the
 * dirt. It carried at $23.0M. Every single job in `pnpm devyield` marked
 * between 0.07x and 0.26x of cost the day the scaffolding came down.
 *
 * That is not a valuation. Net worth sets the revolver (locLimit), the revolver
 * funds the carry through lease-up, and the mark sets every LTV test the loan
 * has to pass — so finishing a building on time and on budget triggered a
 * margin call on the sponsor, in the exact month their costs peaked and their
 * income was still zero. Ground-up development could not be made to pay,
 * however good the site, because the accounting took the building away.
 *
 * The trade has a standard answer and this is it: a completed building in
 * lease-up is worth its AS-IF-STABILISED value, less what it costs to fill,
 * less the income given up while it fills, less a discount for the risk that it
 * does not. That is the appraiser's "as-is on completion", and it lands where
 * it should — a shade under cost for a good building on a good corner, well
 * under for a bad one. Nobody capitalises an empty building's negative NOI,
 * because nobody would sell it for less than nothing.
 *
 * IT ENDS WHEN THE BUILDING STABILISES, NOT ON A DATE. This used to switch
 * off at a fixed 19 / 38 months after delivery whatever the roll looked like,
 * and the ordinary blend took over the next month. Measured on a player office
 * delivered on programme and 87% let at month 37: the mark fell 26% between
 * month 37 and month 38 with nothing about the building changed; a block of
 * flats 65% let fell 44% at month 19. And the calendar ran the wrong way
 * inside the window too: an office still EMPTY at month 37 marked 13% above
 * the day it opened, because the forgone income was measured against the time
 * left on the clock rather than the space left to let.
 *
 * So the mark is struck against the roll: it applies while the building is
 * short of the occupancy its corner stabilises at, the years still to run are
 * read off the market's own lease-up curve from where the roll actually is,
 * and the value it is struck from is THIS building's ordinary mark with the
 * missing space let at market — so as the gap closes the deductions go to
 * zero and the mark lands exactly on the ordinary blend. There is no step to
 * fall off.
 *
 * A building that is still well short twice the market's lease-up time after
 * it opened is no longer new; its vacancy is information about the asset, which
 * is what the in-place leg is there to price. The as-is premium over the blend
 * fades out linearly between one and two market spans (see leaseUpWeight).
 */
function leaseUpMark(
  rec: ParcelRecord, econ: Econ, h: Holding, month: number,
  capNoRoll: number, cap: number, contractNoi: number, stabNoi: number,
): { mark: number; weight: number } | null {
  if (h.deliveredM === undefined || !rec.bldgArea) return null;
  const sinceM = month - h.deliveredM;
  const weight = leaseUpWeight(rec, sinceM);
  if (!(weight > 0)) return null;
  const letShare = heldOccupancy(rec, econ, h);
  const stabOcc = stabilisedOccupancy(rec, econ);
  const gap = clamp(stabOcc - letShare, 0, 1);
  if (!(gap > 0)) return null;
  // THE SAME BUILDING, WITH THE GAP LET AT MARKET, marked the ordinary way —
  // both legs of holdingValue's blend, on the owner's own operating statement
  // (its own tax bill, its own opex, the leases it has actually signed).
  // The roll spread on the cap belongs to the part of the stabilised roll that
  // exists; the part that does not exist yet is priced by the deductions in
  // leaseUpMarkAt (its risk line is the "empty building is a project" spread
  // in dollars), so charging both would price the same vacancy twice. At a
  // full gap it is the plain cap, at no gap it is exactly the blend's cap.
  const inPlaceShare = clamp(letShare / Math.max(0.01, stabOcc), 0, 1);
  const capFilled = capNoRoll + (cap - capNoRoll) * inPlaceShare;
  const filledNoi = contractNoi + leaseUpGapNoiYr(rec, econ, h, gap * rentableSf(rec));
  const filled = Math.max(0, filledNoi) / capFilled * 0.55
    + stabNoi / (capFilled + TAX_RATE * taxBorneShare(rec)) * 0.45;
  const mark = leaseUpMarkAt(rec, econ, h.condition, sinceM, letShare, capNoRoll, filled);
  return mark === null ? null : { mark, weight };
}

/**
 * The owner's NOI on `gapSf` more feet let at market — the same line items
 * holdingNOIYr runs the real roll through, on a lease of the class's typical
 * recovery. After tax, like holdingNOIYr, because it is added to it.
 */
function leaseUpGapNoiYr(rec: ParcelRecord, econ: Econ, h: Holding, gapSf: number): number {
  if (!(gapSf > 0)) return 0;
  const cls = rec.class as BuiltClass;
  const rent = marketRentPsfYr(rec, econ, h.condition, h.condIdx);
  if (cls === "multifamily") return gapSf * rent * (1 - MGMT_FEE - APT_RESERVE);
  const systemsDone = h.programsDone?.systems !== undefined;
  const opexRecoverPsf = managedOpexPsf(cls, econ, systemsDone, recoverableService(h.service), h.pmOpexMult ?? 1) * locOpexMult(rec, econ, cls);
  const taxNowPsf = grossTaxYr(rec, h) / Math.max(1, rec.bldgArea);
  return gapSf * (rent + RECOVERY_RATE[cls] * (opexRecoverPsf + taxNowPsf)) * (1 - MGMT_FEE);
}

/**
 * The occupancy this building runs at once it is no longer the new one, on
 * this corner, in this market — `occupancy` without the calendar. It is the
 * level a lease-up is heading for, and the level at which it has arrived.
 */
export function stabilisedOccupancy(rec: ParcelRecord, econ: Econ): number {
  if (rec.class === "land") return 0;
  return blendBy(rec, (u) => useOccupancy(rec, econ, u, true));
}

/**
 * How much of the as-is lease-up premium an appraiser still gives a building
 * `sinceM` months after it opened: all of it for the market's lease-up span
 * (LEASE_UP_YEARS), fading linearly to none at twice that. SHAPE PARAMETER,
 * not calibrated: the outer bound is a judgement that a building still far
 * short of stabilised after twice the time the market takes to fill one is
 * telling you something about itself, and the linear fade exists only so that
 * judgement does not arrive as a one-month step in the mark.
 */
export function leaseUpWeight(rec: ParcelRecord, sinceM: number): number {
  if (sinceM < 0) return 0;
  const spanM = Math.round(LEASE_UP_YEARS((rec.class as BuiltClass) === "multifamily") * 12);
  return clamp(2 - sinceM / spanM, 0, 1);
}

/**
 * The same mark for a building NOBODY OWNS — the tape, a rival's book, an
 * appraisal on a lot you are only looking at. `leaseUpMark` needs a rent roll
 * and a delivery date, and an unowned record has neither; what it has is a
 * year built and the market's own read of how full a building that age is. So
 * the arithmetic lives here once, and both callers bring their own answer to
 * "how new is it" and "how much of it is let".
 *
 * Without this, `assetValue` still capitalised a lease-up roll at a stabilised
 * cap rate — the same double count, on every new building in town except the
 * ones the player happened to have built themselves.
 */
export function leaseUpMarkAt(
  rec: ParcelRecord, econ: Econ, condition: Condition,
  sinceM: number, letShare: number, capNoRoll: number,
  /** This building's ordinary mark with the gap let at market. Defaults to the
   *  as-if-stabilised value below, which is exactly that for a record with no
   *  rent roll of its own. */
  filled?: number,
): number | null {
  if (!rec.bldgArea || sinceM < 0 || !(leaseUpWeight(rec, sinceM) > 0)) return null;
  const apt = (rec.class as BuiltClass) === "multifamily";
  // HOW FAR IT HAS TO GO, not how long it has been open. The gap is to the
  // occupancy this corner stabilises at — the market's structural vacancy is
  // already in the stabilised NOI, and charging fit-out, forgone income and
  // risk on it as well priced the same empty floor twice. A building let to
  // its stabilised level has arrived and leaves the lease-up mark, whatever
  // the calendar says.
  const stabOcc = stabilisedOccupancy(rec, econ);
  const gap = clamp(stabOcc - letShare, 0, 1);
  if (!(gap > 0) || !(stabOcc > 0)) return null;
  const gapFrac = gap / stabOcc;                  // share of the stabilised roll still to sign
  // YEARS STILL TO RUN, from the roll. Read off the same curve leaseUpFactor
  // draws (a fifth let on opening, climbing on a 0.75 power to stabilised over
  // LEASE_UP_YEARS): find where on it a building this full sits, and the time
  // left is the rest of the curve. For a record priced off the market's own
  // read of its age this is exactly the calendar; for a building that let
  // slower than the market it is longer, and for one that let faster, shorter.
  const spanY = LEASE_UP_YEARS(apt);
  const f = clamp(letShare / stabOcc, 0, 1);
  const along = f <= 0.2 ? 0 : spanY * Math.pow((f - 0.2) / 0.8, 1 / 0.75);
  const left = Math.max(0, spanY - along);   // years still to run

  // AS IF STABILISED. Not "as if full" — at the occupancy this building runs
  // at when it is no longer the new one, on this corner, in this market. The
  // cap is the one WITHOUT the empty-roll penalty, because a stabilised
  // building by definition has a roll; charging that spread here would price
  // the vacancy a second time, which is the mistake this whole function exists
  // to undo.
  // The tax the OWNER carries, not the statutory rate — a net-leased roll
  // bills its tax to the tenants. assetValue and planDevelopment's exit yield
  // both load the cap this way (taxBorneShare); this leg loading the FULL rate
  // was the third answer to one question, worth ~14% on stabilised retail.
  const taxLoad = TAX_RATE * taxBorneShare(rec);
  const stab = noiYr(rec, econ, condition, true) / (capNoRoll + taxLoad);
  if (!(stab > 0)) return null;

  // THE CHEQUE IS ON RENTABLE FEET. planDevelopment reserves TI and LC on
  // rentable, and this used `bldgArea` — the core, the risers and the lobby
  // being fitted out as if they were suites. On a 400k sf tower that is
  // another 15–25% of fill cost, and it is how a just-delivered building
  // marked below its own dirt.
  const vacantSf = gap * rentableSf(rec);

  // THE THREE DEDUCTIONS.
  // 1. The cheque to fill it: fit-out and the commissions on the space still
  //    to let. Same money planDevelopment reserves, on the part still empty.
  const cls = (rec.class as BuiltClass) ?? "office";
  const tiPsf = cls === "office" ? 32 : cls === "retail" ? 22 : cls === "industrial" ? 5 : 7;
  const lcPsf = apt ? 0 : marketRentPsfYr(rec, econ, condition) * 6 * 0.045;
  const fill = vacantSf * (tiPsf * econ.costIdx + lcPsf);
  // 2. The income it does not earn on the way there. Space lets in over the
  //    window rather than all at the end, so on average half of what is empty
  //    today is empty for the time that is left.
  const forgone = stab * (capNoRoll + taxLoad) * gapFrac * left * 0.5;
  // 3. And the part nobody underwrites away: it may not let. A wholly empty
  //    building is a project, and it is priced like one.
  const risk = stab * 0.08 * gapFrac;
  // A COMPLETED BUILDING IS NOT WORTH LESS THAN THE LOT. The residual already
  // prices the dirt as what a builder would pay to put this tower up; the
  // tower, empty, is that lot plus a shell. The deductions can eat the
  // improvement. They cannot eat the land.
  return Math.max(landValue(rec, econ), (filled ?? stab) - fill - forgone - risk);
}

/**
 * The lot under a ground lease, stripped of the lessee's improvement so land
 * value is the dirt — not an empty building's failed NOI.
 */
export function bareLandRec(
  parcels: Record<string, ParcelRecord>, s: GameState, bbl: string,
): ParcelRecord | null {
  const base = parcels[bbl];
  if (!base) return null;
  const r = resolveRec(parcels, s, bbl);
  if (!r) return null;
  return { ...r, class: "land", bldgArea: 0, floors: 0, unitsRes: 0, mix: undefined };
}

/**
 * THE LEASED FEE — a bond with a deed attached.
 *
 * Cap the coupon at a ground-lease yield (tighter than a building cap), then
 * add the discounted reversion of the dirt (and, near term, a haircut on the
 * improvements that come back with it). This is what trades when you sell a
 * ground-leased lot, and what net worth must read while you hold one — not
 * landValue (which ignores the coupon) and not an empty-building appraisal
 * (which pretends the lessee's tower is yours to let).
 */
/**
 * THE GROUND-LEASE YIELD — what a ground rent is capitalised at, as a cap rate
 * on the rent in force. A ground rent is the most senior claim on a building
 * (it is paid before the mortgage, and the fee owner takes the improvements if
 * it is not), so it prices like a long bond with a small spread: about half
 * the policy rate plus two points, never under 3.2%. One number for the leased
 * fee you own (`leasedFeeValue`) and the fee you sold (`leaseholdGroundPv`).
 */
export function groundYieldPct(econ: Econ): number {
  return Math.max(3.2, econ.indexRate * 0.55 + 2.1);
}

/**
 * WHAT THE GROUND RENT UNDER A LEASEHOLD IS WORTH — to the fee owner, and so
 * what comes off the building's value. Struck at the same yield the fee sold
 * at, so selling the dirt is value-neutral before costs: the owner swaps land
 * value for cash and takes on a senior, rising rent. Any gain from the deal is
 * liquidity and the absence of a lender, not an arbitrage in the mark.
 */
export function leaseholdGroundPv(h: Holding, econ: Econ): number {
  const g = h.groundRentOut;
  return g ? Math.round(g.rentYr / (groundYieldPct(econ) / 100)) : 0;
}

export function leasedFeeValue(
  gl: import("./types").GroundLease,
  bare: ParcelRecord,
  econ: Econ,
  month: number,
  improvementSf = 0,
): number {
  const yld = groundYieldPct(econ);
  const yearsLeft = Math.max(0.25, (gl.endM - month) / 12);
  const disc = Math.pow(1 + yld / 100, yearsLeft);
  const annuity = 1 - 1 / disc;
  const income = (gl.rentYr / (yld / 100)) * annuity;
  const land = landValue(bare, econ);
  // Near reversion the bones start to matter; far out they are a rounding error.
  const bldgShare = improvementSf > 0 && yearsLeft < 30
    ? Math.max(0, (30 - yearsLeft) / 30) * 0.35 * land
    : 0;
  const reversion = (land + bldgShare) / disc;
  return Math.max(Math.round(land * 0.55), Math.round(income + reversion));
}

/**
 * ONE VALUE FOR A DEED THE PLAYER OWNS.
 *
 * A ground-leased parcel is the leased fee (coupon + reversion), not bare dirt
 * and not the lessee's building. Every balance sheet, lender and player-facing
 * panel should call this when GameState is available.
 */
export function ownedHoldingValue(
  s: GameState, parcels: Record<string, ParcelRecord>, h: Holding,
): number {
  const rec = resolveRec(parcels, s, h.bbl);
  if (!rec) return 0;
  return ownedHoldingValueFromRec(s, rec, h);
}

/**
 * THE FEE OWNER IS NOT THE LANDLORD.
 *
 * Once a ground lease is live the improvement — LOIs, renewals, capital plan,
 * demolish, renovation, staff load — belongs to the lessee. `resolveRec` still
 * overlays `s.built` so the parcel reads as a building (correct for appraisal
 * of the bones / neighbour competition); every landlord path has to ask this
 * before treating the holding like one you operate.
 */
export function isLeasedFee(h: Holding | null | undefined): boolean {
  return !!h?.groundLeased;
}

/**
 * ONE NOI FOR A DEED THE PLAYER OWNS.
 *
 * `holdingNOIYr` correctly returns 0 on a ground-leased fee so the fee owner
 * is not billed the lessee's tax, insurance and vacancy. Cash still arrives as
 * the absolutely-net ground coupon (`tickGroundLeases`). Debt, DSCR and every
 * player-facing cash-flow figure have to count that coupon — otherwise a
 * performing leased fee is vacant dirt to First Harbor and the header CF / yr
 * pretends the income does not exist. Mirrors `ownedHoldingValue`.
 */
export function ownedHoldingNoiYr(
  s: GameState, parcels: Record<string, ParcelRecord>, h: Holding,
): number {
  const rec = resolveRec(parcels, s, h.bbl);
  if (!rec) return 0;
  return ownedHoldingNoiYrFromRec(s, rec, h);
}

/** Same canonical deed NOI when the caller already resolved the parcel. */
export function ownedHoldingNoiYrFromRec(
  s: GameState, rec: ParcelRecord, h: Holding,
): number {
  if (h.groundLeased) {
    const gl = s.groundLeases?.[h.bbl];
    return gl ? Math.max(0, gl.rentYr) : 0;
  }
  return holdingNOIYr(rec, s.econ, h, s.month);
}

/** Monthly deed NOI — ground coupon or building NOI, never vacant-dirt zero on a leased fee. */
export function ownedMonthlyNoi(
  s: GameState, parcels: Record<string, ParcelRecord>, h: Holding,
): number {
  return ownedHoldingNoiYr(s, parcels, h) / 12;
}

/**
 * Vacant dirt with no income — the only collateral First Harbor's land loan
 * is for. A leased fee with a coupon is not vacant dirt, even when the
 * resolved class is still "land" before the lessee tops out.
 */
export function isVacantLandLoanCollateral(
  s: GameState, h: Holding, rec: ParcelRecord,
): boolean {
  if (h.groundLeased && (s.groundLeases?.[h.bbl]?.rentYr ?? 0) > 0) return false;
  return rec.class === "land" || !rec.bldgArea;
}

/** Same canonical deed value when the caller already resolved the parcel. */
export function ownedHoldingValueFromRec(
  s: GameState, rec: ParcelRecord, h: Holding,
): number {
  const gl = s.groundLeases?.[h.bbl];
  if (h.groundLeased && gl) {
    const bare = {
      ...rec, class: "land" as const, bldgArea: 0, floors: 0, unitsRes: 0, mix: undefined,
    };
    return leasedFeeValue(gl, bare, s.econ, s.month, gl.sf ?? s.built?.[h.bbl]?.bldgArea ?? 0);
  }
  const v = holdingValue(rec, s.econ, h, s.month);
  // The roll that is about to roll — see leasing.ts rolloverReserve. Registered
  // rather than imported because leasing.ts imports this file.
  // Capped at a quarter of the mark: a re-tenanting bill bigger than that is
  // a project, and projects are priced by the lease-up mark, not by a reserve.
  // (Measured without the cap: a one-tenant shop worth $110 a foot carried a
  // third of its value in reserve and sold at 148% of its own listing mark
  // three months later when the tenant renewed.)
  const roll = rolloverReader && rec.class !== "land" && rec.bldgArea > 0 ? Math.min(rolloverReader(s, rec, h), v * 0.25) : 0;
  // A leasehold owns no dirt, so there is no land floor under its mark.
  if (h.groundRentOut) return roll > 0 ? Math.max(0, v - roll) : v;
  return roll > 0 ? Math.max(landAppraisalFloor(rec, s.econ, true), v - roll) : v;
}

/**
 * THE ROLLOVER READER, supplied by leasing.ts at module load. The reserve a
 * buyer takes off the price for commercial leases inside twelve months that
 * the renewal read says are leaving needs `renewalIntent`, which lives in the
 * leasing engine; that module imports this one, so the reader is registered
 * rather than imported. Absent (a bundle that never loaded leasing.ts) the
 * mark is the plain capitalised contract, as before.
 */
let rolloverReader: ((s: GameState, rec: ParcelRecord, h: Holding) => number) | null = null;
export function registerRolloverReader(fn: (s: GameState, rec: ParcelRecord, h: Holding) => number): void {
  rolloverReader = fn;
}

export function holdingValue(rec: ParcelRecord, econ: Econ, h: Holding, month?: number): number {
  // Ground-leased fee: callers with the lease record should use leasedFeeValue.
  // Without it, never appraise the lessee's building as if it were yours.
  if (h.groundLeased) {
    const bare = { ...rec, class: "land" as const, bldgArea: 0, floors: 0, unitsRes: 0, mix: undefined };
    return landValue(bare, econ);
  }
  if (rec.class === "land" || !rec.bldgArea) return landValue(rec, econ);
  const quality = month === undefined ? 0 : rollQualitySpread(rec, h, month, econ);
  const capNoRoll = clamp(capRateFor(rec, econ, h.condition, h.condIdx), 2.8, 13) / 100;
  const cap = clamp(capRateFor(rec, econ, h.condition, h.condIdx) + quality, 2.8, 13) / 100;
  // CONTRACT rent, not the rent that happens to be arriving this month.
  //
  // This line used to read `h.renovatingUntilM ?? -1`, and month −1 is inside
  // every free-rent period ever granted — so an appraisal ran the rent roll
  // with the base rent of every tenant the player had ever signed switched
  // off, permanently, while their expense recoveries kept billing. In-place
  // NOI came out at or below zero on a full building, the value collapsed to
  // 45% of the stabilised mark, and it never came back: the concession never
  // "expired", because the clock never moved. Ground-up development wore it
  // worst, because a developer's whole roll is leases they signed themselves.
  const inGut = month !== undefined && h.renovatingUntilM !== undefined && month < h.renovatingUntilM;
  // A leasehold is marked as the freehold less the ground rent's value, so the
  // in-place leg is struck on the NOI before the ground rent and the rent is
  // taken off once, at the end, at the yield it trades at.
  const contractNoi = holdingNOIYr(rec, econ, h, inGut ? month : Number.POSITIVE_INFINITY) + (h.groundRentOut?.rentYr ?? 0);
  // AND YOU CANNOT DIVIDE A NEGATIVE NOI BY A CAP RATE AT ALL.
  //
  // A building with no tenants pays operating costs and taxes and bills
  // nobody, so its in-place NOI is negative — and $-315k over a 5.7% cap is
  // "minus five and a half million dollars", which is not a conservative
  // opinion of value, it is a category error with a decimal point. Fifty-five
  // per cent of it then dragged the blend below the land floor on every empty
  // building in town.
  //
  // The lease-up window above is one place that happens and it is now handled.
  // This is the other, and the general one: a building that empties out in
  // year twenty is not new, gets no lease-up mark, and hits exactly the same
  // arithmetic. A negative income stream contributes NOTHING to value — the
  // asset is then worth its stabilised mark less what it costs to get there,
  // which is what the other leg already measures. It is never worth less than
  // nothing, because nobody would pay to give it away.
  const inPlace = Math.max(0, contractNoi) / cap;                       // after-tax NOI, plain cap
  // THE STABILISED LEG HAS TO BE STABILISED. This read noiYr's default, which
  // runs occupancy through leaseUpFactor — so for a building under four years
  // old the "stabilised" mark was itself cut to as little as 12% of stabilised
  // NOI, and the blend then applied the in-place penalty for the same vacancy
  // on top of it. One lease-up, counted twice, in the two legs that were
  // supposed to be measuring different things. Nothing older than four years
  // moves by a cent: leaseUpFactor is already 1 there.
  // Pre-tax NOI over the cap plus the tax the OWNER carries — the same
  // taxBorneShare load assetValue uses at its own capitalisation line. This
  // read the FULL rate while the street's answer read the pass-through share,
  // so an identical stabilised net-leased building had two values ~14% apart
  // depending on which desk was asked (one quantity, two answers — CLAUDE.md).
  const stabNoi = noiYr(rec, econ, h.condition, true, h.condIdx);
  const stabilized = stabNoi / (cap + TAX_RATE * taxBorneShare(rec));
  const blended = inPlace * 0.55 + stabilized * 0.45;
  const abate = month === undefined ? 0 : remainingAbatement(h, month);
  // A BUILDING IN ITS FIRST LEASE-UP IS NOT A BUILDING WITH A VACANCY PROBLEM.
  // Until it stabilises the as-is-on-completion mark governs, and it retires
  // on its own as the space lets — see leaseUpMark. It never marks BELOW the
  // ordinary blend, so a job that fills fast keeps the upside the roll has
  // earned it. And it never marks below the dirt: the 0.92 floor is a
  // demolition allowance for old empty fabric, not a haircut on a tower that
  // opened this month.
  const asIs = month === undefined ? null : leaseUpMark(rec, econ, h, month, capNoRoll, cap, contractNoi, stabNoi);
  // The dirt floor follows the age of the fabric, not the roll: a new tower
  // that let fast is no more a demolition candidate than one still filling.
  const floor = landAppraisalFloor(rec, econ,
    h.deliveredM !== undefined && month !== undefined ? leaseUpWeight(rec, month - h.deliveredM) : 0);
  const marked = asIs !== null ? blended + asIs.weight * Math.max(0, asIs.mark - blended) : blended;
  const freehold = Math.max(floor, marked - abate);
  return h.groundRentOut ? Math.max(0, freehold - leaseholdGroundPv(h, econ)) : freehold;
}

export function monthlyNOI(rec: ParcelRecord, econ: Econ, h: Holding, currentQ: number): number {
  return holdingNOIYr(rec, econ, h, currentQ) / 12;
}

export const RENO_COST_PSF: Record<BuiltClass, number> = { office: 210, retail: 150, multifamily: 165, industrial: 90 };
export const RENO_MONTHS = 6;

export function renovationCost(rec: ParcelRecord, econ: Econ): number {
  if (rec.class === "land" || !rec.bldgArea) return 0;
  return Math.round(rec.bldgArea * RENO_COST_PSF[rec.class as BuiltClass] * econ.costIdx);
}

/**
 * WHAT A BUILDING IS WORTH THE DAY YOU TAKE IT OFF A RECEIVER.
 *
 * Not assetValue. assetValue prices a building at MARKET occupancy in a stated
 * condition, and a building whose owner stopped paying the mortgage is neither
 * at market occupancy nor in stated condition — he stopped leasing a year
 * before he stopped paying, and he stopped fixing the roof a year before that.
 *
 * Measured (n=400 commercial parcels, month 120): assetValue(worn) is 0.69x
 * assetValue(standard); a worn building holding half its roll marks at 0.49x
 * assetValue(worn), a full one at 0.70x and an empty one at 0.18x. So a half-
 * let worn building is worth 0.43x a clean comparable, and that number is the
 * entire reason buying notes is a business rather than an arbitrage.
 */
export function collateralAsIs(rec: ParcelRecord, econ: Econ, occ: number): number {
  const o = Math.max(0.15, Math.min(0.95, occ));
  return assetValue(rec, econ, "worn") * Math.max(0.18, Math.min(0.72, 0.18 + 0.74 * o));
}

/**
 * One walk of the book: net worth AND gross asset value.
 *
 * The month tick used to call `holdingValue` once for overhead (GAV) and again
 * inside `netWorth` — two full appraisals of every deed, every month. Year
 * advance pays that twelve times.
 */
export function portfolioMark(s: GameState, parcels: Record<string, ParcelRecord>): { nw: number; gav: number } {
  let nw = s.cash;
  let gav = 0;
  // ONE LOAN AGAINST MANY DEEDS IS STILL A LOAN. Every building's own mortgage
  // is netted off its value below; a facility has no single building to be
  // netted against, so it comes off here or it does not come off at all — and
  // a borrower whose net worth ignores their largest liability is being shown
  // a number that would let them borrow against it twice.
  nw -= s.facility?.balance ?? 0;
  // THE FUND IS MOSTLY THE LPs' MONEY. Vehicle deeds used to count at 100%
  // here while the vehicle's cash counted at nothing, so the co-invest left
  // net worth at the raise and the LPs' capital arrived in it the day it
  // bought a building. The sponsor owns what the waterfall would pay them.
  const liveFund = s.fund && !s.fund.settled ? s.fund : undefined;
  // The vehicle holds its own tenants' deposits (moveDeposit), so they are
  // its liability against its cash, not the sponsor's.
  let fundNav = liveFund ? liveFund.cash - fundDepositsHeld(s) : 0;
  for (const h of Object.values(s.holdings)) {
    const v = ownedHoldingValue(s, parcels, h);
    gav += v;
    const eq = v - (h.loan?.balance ?? 0) - (h.mezz?.balance ?? 0);
    if (liveFund && h.fundOwned) { fundNav += eq; continue; }
    // A JV partner owns its share of the equity, not of the building.
    nw += eq * (1 - (h.jv?.share ?? 0));
  }
  if (liveFund) nw += gpInterestInFund(liveFund, fundNav);
  // The note on a wound-down fund's liquidating trust — see fund.ts TrustNote.
  nw += s.trustNote?.balance ?? 0;
  // A CLAIM ON A FAILED BANK'S RECEIVER IS AN ASSET, at its expected recovery:
  // the frozen deposit is not gone, only the haircut is (seizeDeposits). Only
  // claims booked as an asset count — an old save's claims were expensed whole
  // and come back as income, and counting them here too would count them twice.
  for (const r of s.receivership ?? []) if (r.seizedM !== undefined) nw += r.amount;
  // CONSTRUCTION IN PROGRESS CARRIES AT MONEY SUNK, NOT AT THE BUDGET.
  //
  // This booked `costTotal` — the WHOLE build budget — the instant a shovel
  // moved, against a loan balance that starts at zero. Measured on one
  // groundbreaking: a $16.78M cheque lifted reported net worth $62.25M and the
  // line of credit $41.16M. Over a run that develops continuously the worst
  // overstatement was $1.35 BILLION, forty-five per cent of reported net
  // worth — and because locLimit sizes the revolver off net worth and
  // startDevelopment counts locAvailable toward its funding test, the phantom
  // equity partly authorised the NEXT job.
  //
  // A half-built building is worth what has been put into it. That is what an
  // accountant carries and it is what a lender lends against.
  for (const d of Object.values(s.developments ?? {})) {
    const sunk = (d.equitySpent ?? 0) + (d.drawn ?? 0) - (d.reserveUsed ?? 0);
    nw += Math.max(0, sunk - d.loanBalance);
    // Overhead still sizes against the committed budget — same as before.
    gav += d.costTotal;
  }
  // PAPER YOU OWN, AT THE LOWER OF COST AND COLLATERAL.
  //
  // A performing note carries at what you paid. A defaulted one carries at the
  // lesser of that and what the building behind it is actually worth today —
  // so a note whose collateral has fallen through it writes itself down, and a
  // note bought at a discount never writes itself UP. The gain shows up when
  // you collect or when you take the deed, which is where it belongs.
  for (const n of s.notes ?? []) {
    if (n.perf === "performing") { nw += n.basis; continue; }
    const rec = resolveRec(parcels, s, n.bbl);
    if (!rec) continue;
    const r = s.rivals?.find((x) => x.id === n.obligorId);
    nw += Math.min(n.basis, Math.round(collateralAsIs(rec, s.econ, r?.occ ?? 0.5)));
  }
  nw -= s.loc?.balance ?? 0;   // the line is real money owed
  // SECURITY DEPOSITS ARE NOT YOUR MONEY. They arrive as cash at signing and
  // sit in the bank looking exactly like equity until the day the tenant leaves
  // and takes them back. A landlord with a large roll is holding a real
  // liability here, and counting it as net worth is the oldest flattering
  // mistake in the business.
  for (const h of Object.values(s.holdings)) {
    if (liveFund && h.fundOwned) continue; // the vehicle's — netted in fundNav above
    for (const t of h.tenants) nw -= t.deposit ?? 0;
  }
  return { nw, gav };
}

export function netWorth(s: GameState, parcels: Record<string, ParcelRecord>): number {
  return portfolioMark(s, parcels).nw;
}
