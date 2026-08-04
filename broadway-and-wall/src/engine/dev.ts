// Ground-up development (Groundwork's core loop, simplified for v1) plus
// building management: capital programs and rent stance.
//
// Development: on an owned vacant lot, choose use and FAR up to the zoning
// max, pay hard+soft cost per sf, fund with a 60% interest-only construction
// loan, wait 4-6 quarters while the building rises on the map, then lease up
// from empty. A modest random cost/schedule overrun keeps it honest.
import type { ParcelTable } from "@/data/types";
import type { BuiltClass, Contract, DevUse, Development, GameState, UseMix } from "./types";
import { BUILT_CLASSES } from "./types";
import { logBooks, monthLabel, serviceSpec, planSpec } from "./types";
import { demandNow } from "./demand";
import { rng, rrange, NATURAL_VAC, CITY_STOCK, BUILD_MONTHS, SECTOR_LABEL } from "./market";
import { firmShort } from "./firm";
import { resolveRec, marketRentPsfYr, opexPsf, TAX_RATE, capRateFor, landValue, RECOVERY_RATE, demandLinear, plateEfficiency, physicalMaxFloors, condGrade, condCeiling } from "./value";
// The massing curve moved to value.ts, because land pricing needs to ask what
// a lot can physically carry and value.ts cannot import this file. Re-exported
// so it is still `physicalMaxFloors` from "@/engine/dev" everywhere else.
export { physicalMaxFloors, plateEfficiency } from "./value";
import { genAnchorTenant } from "./leasing";
import { claimJob, jobDelivered, ownerOf } from "./rivals";
import { locAvailable } from "./credit";
import { useSf } from "./mix";
import { lenderAppetite, lenderByName, CONSTRUCTION_LENDER } from "./lenders";
import { lenderRelOf, bumpLenderRel } from "./debt";

const clone = (s: GameState): GameState => JSON.parse(JSON.stringify(s));

// hard cost $/sf by use, before the height premium and soft costs.
// Sized so stabilized yield-on-cost lands ~150-250bps over the exit cap —
// a real development margin, not free money.
/**
 * Hard cost per square foot, before the height premium and the contract.
 *
 * These must be read against RENT_BASE, because the ratio between them decides
 * whether a class is buildable at all — and it was wildly out. Retail cost 3.4
 * times its annual rent to build and penciled on literally every site in the
 * city; industrial cost 10.3 times its rent and penciled on none. Real
 * construction runs roughly seven times stabilised rent across the board, and
 * the differences between classes should come from cap rates and location, not
 * from one class being free to build.
 */
/**
 * Calibrated against NET stabilised rent, not gross.
 *
 * The old table was set at roughly seven times each class's headline rent,
 * which sounds disciplined and is not: the classes do not carry remotely the
 * same expense load, and they do not recover it the same way. Triple-net
 * retail keeps almost every dollar it bills; an apartment building keeps
 * fifty-five cents on the dollar after payroll, turns and utilities. Pricing
 * both at seven times the number on the sign made retail free money to build
 * — a sixteen per cent yield on cost against a six per cent exit — while
 * apartments barely cleared.
 *
 * These are solved instead: the cost at which a NEW building on a MEDIAN site
 * yields about 150bp over its own exit cap, after operating cost, after what
 * a typical lease bills back, and after the property tax the owner carries.
 * A better corner still beats the hurdle comfortably; a poor one does not
 * pencil, which is why most land in a real city stays empty.
 */
export const HARD_COST_PSF: Record<BuiltClass, number> = {
  office: 560,        // net $62/sf against a 5.3% exit
  multifamily: 345,   // net $37/sf against a 4.6% exit — the thinnest margin in the book
  retail: 865,        // net $97/sf; podium retail is expensive and earns it
  industrial: 140,    // net $17/sf against a 6.6% exit
};

/**
 * A PROGRAMME, not a class. You do not build "mixed use" — you build shops at
 * grade with offices and flats above, and the budget is the sum of those three
 * jobs. "mixed" here is shorthand for a canonical stack, and the whole of what
 * it means is the mix below: cost, rent, lease-up, lender appetite and
 * neighbourhood effect all follow from the components.
 */
export const MIXED_STACK: UseMix = { retail: 0.15, office: 0.45, multifamily: 0.40 };
/**
 * YOU DECIDE THE STACK.
 *
 * "Mixed use" used to mean one canonical 15/45/40 building and nothing else,
 * which is not a programme — it is a preset. A developer picking mixed use is
 * making the most consequential decision on the site: how much retail the
 * frontage will actually carry, whether the middle is offices or flats, and
 * what that does to the cost, the exit cap and the lender's appetite. All of
 * which already fall out of the mix; there was simply no way to choose it.
 *
 * The custom split is normalised and floored — a leg under three per cent is
 * not a use, it is a lobby — and the canonical stack remains the default so
 * the decision is opt-in rather than homework.
 */
export function normalizeMix(m: UseMix): UseMix {
  const keys = (Object.keys(m) as BuiltClass[]).filter((k) => (m[k] ?? 0) >= 0.03);
  const tot = keys.reduce((a, k) => a + (m[k] ?? 0), 0);
  if (!keys.length || tot <= 0) return { ...MIXED_STACK };
  const out: UseMix = {};
  for (const k of keys) out[k] = +((m[k] ?? 0) / tot).toFixed(4);
  return out;
}
export function devMix(use: DevUse, custom?: UseMix): UseMix {
  if (use !== "mixed") return { [use]: 1 };
  return custom ? normalizeMix(custom) : { ...MIXED_STACK };
}
export function dominantOf(mix: UseMix): BuiltClass {
  return (Object.keys(mix) as BuiltClass[]).sort((a, b) => (mix[b] ?? 0) - (mix[a] ?? 0))[0] ?? "office";
}
/** Weighted average of a per-use number across a programme. */
function overMix(mix: UseMix, f: (u: BuiltClass) => number): number {
  let sum = 0, w = 0;
  for (const u of Object.keys(mix) as BuiltClass[]) { const s = mix[u] ?? 0; sum += f(u) * s; w += s; }
  return w > 0 ? sum / w : 0;
}
/** How much of a programme carries genuine leasing risk before it is built. */
function specShare(mix: UseMix): number {
  return (mix.office ?? 0) + (mix.retail ?? 0);
}
export const SOFT_COST = 0.16;        // design, legal, permits, insurance, financing fees
const CONSTR_SPREAD = 2.4;     // over the index, interest-only
export const CONTINGENCY = 0.06;  // held against change orders; unspent is yours

/**
 * THE CONTRACT.
 *
 * Cost-plus is cheaper on paper and leaves you holding the bag: the price
 * moves with the market between groundbreak and topping out, and every change
 * order is yours. A guaranteed maximum price costs four points more and buys
 * the contractor's balance sheet — escalation stops being your problem and
 * most overruns die at the GMP line.
 *
 * In a boom, when costs are running, the GMP premium is the cheapest money on
 * the board. In a flat market it is four points of nothing. Reading which one
 * you are in is the job.
 */
export const CONTRACT_PREMIUM: Record<Contract, number> = { gmp: 0.04, costplus: 0 };

/**
 * Construction lenders underwrite lease risk, not blueprints, and they
 * underwrite it in a straight line: the more of the building that is already
 * spoken for, the more of the cost they will fund. Spec commercial in a
 * recession gets nothing at all. Residential and industrial carry less lease
 * risk because the space is fungible.
 */
// EVERYTHING IS BUILT ON SPEC.
//
// The old model made you buy anchors before a slab was poured, and paid you
// for it in leverage and punished you for it in months. That is a real thing
// that happens on a minority of large single-tenant jobs, and it was wrong as
// the universal precondition for putting up a building: the overwhelming
// majority of commercial development is started empty, on the developer's read
// of the market, and let while it is going up. Leasing during construction is
// now the mechanic — see tickConstructionLeasing — which is both what actually
// happens and a far more interesting decision, because the market can turn
// underneath you while the steel is going in.
//
// Credit tightens the ceiling in a downturn, and industrial and housing carry
// more than offices and shops, because they always have.
function constructionLtc(mix: UseMix, phase: string, creditIdx: number, appetite = 1): number {
  const spec = specShare(mix);
  // flats and sheds are the financeable end of the market
  const safeLtc = 0.70;
  const specLtc = 0.70;
  const base = specLtc * spec + safeLtc * (1 - spec);
  const tight = phase === "recession" ? 0.72 : phase === "peak" ? 0.94 : 1;
  // Construction paper in this town is written by the regional bank, and the
  // regional bank has a balance sheet you can read on Research. When it is
  // eating losses it does not tighten the market's terms — it tightens YOURS,
  // and a bank that has stopped lending stops financing buildings first,
  // because a half-built tower is the worst collateral there is.
  const app = Math.min(1.05, 0.5 + 0.5 * appetite);
  return Math.max(0, Math.min(0.70, base * tight * app * Math.min(1.12, Math.max(0.55, creditIdx))));
}

/**
 * THE CONSTRUCTION DESKS.
 *
 * Alden wrote every construction loan in this town by fiat, which made the
 * most dangerous paper in banking the one loan you could not shop. Three desks
 * quote it now, priced off the same balance sheets everything else reads: the
 * hometown bank writes small jobs cheaply for names it knows and stops at its
 * hold size, the regional remains the volume desk, and the debt fund will
 * finance a hole in the ground in any market — at fund prices, which is the
 * whole business model. Personality is not invented here: appetite comes off
 * each desk's capital, the relationship discount off the same file the perm
 * quotes read, and a desk in receivership quotes nothing at all.
 */
export interface ConstructionQuote {
  lender: string;
  ratePct: number;
  ltcMax: number;
  points: number;   // origination, as a share of the commitment — cash at close
  open: boolean;
  why?: string;
}

const CONSTRUCTION_DESKS: { name: string; spread: number; points: number; scale: number; cap: number; maxCommit?: number; fund?: boolean }[] = [
  // Small, cheap, and they remember you: the hometown bank's hold stops at
  // $9M, so on anything bigger it funds its piece and no more.
  { name: "First Harbor Bank", spread: 2.15, points: 0.008, scale: 0.92, cap: 0.65, maxCommit: 9_000_000 },
  // The regional — the historical monopoly desk, and still the volume quote.
  { name: CONSTRUCTION_LENDER, spread: CONSTR_SPREAD, points: 0.010, scale: 1, cap: 0.70 },
  // Committed capital and no depositors: they quote through the cycle, and the
  // coupon is why nobody borrows from them twice unless they have to.
  { name: "Cordage Debt Partners", spread: 4.00, points: 0.020, scale: 1.05, cap: 0.75, fund: true },
];

export function constructionQuotes(s: GameState, mix: UseMix, costTotal: number): ConstructionQuote[] {
  const e = s.econ;
  const tight = Math.max(0, 1 - (e.creditIdx ?? 1));
  return CONSTRUCTION_DESKS.map((d) => {
    const app = lenderAppetite(s, d.name);
    const bank = lenderByName(s, d.name);
    // The fund prices the cycle instead of leaving it: its advance rate reads
    // through a recession the way its perm sheet does, at its coupon.
    const base = d.fund
      ? constructionLtc(mix, "expansion", Math.max(0.85, e.creditIdx ?? 1), Math.max(0.5, app))
      : constructionLtc(mix, e.phase, e.creditIdx ?? 1, app);
    const uncapped = Math.min(d.cap, base * d.scale);
    // The 1.1 approximates the interest-reserve gross-up, so the solved
    // commitment lands at the hold size rather than a tenth over it.
    const ltcMax = d.maxCommit && costTotal > 0 ? Math.min(uncapped, d.maxCommit / (costTotal * 1.1)) : uncapped;
    const rel = d.fund ? 0 : Math.min(0.4, Math.max(0, (lenderRelOf(s, d.name) - 20) * 0.005));
    const ratePct = +(e.indexRate + d.spread * (1 + (d.fund ? 0 : 0.9 * tight)) + Math.max(0, 1 - app) * (d.fund ? 0.3 : 0.8) - rel).toFixed(2);
    const open = app >= 0.12 && ltcMax > 0.02;
    const why = bank?.failedM !== undefined ? `${d.name} is in receivership — nobody is answering the phone.`
      : app < 0.12 ? `${d.name} has stopped writing new paper — their capital will not carry it.`
      : ltcMax <= 0.02 ? `${d.name} will not touch spec construction in this market.`
      : d.maxCommit && ltcMax < uncapped - 0.005 ? `A job this size is past ${d.name}'s hold — they will only fund $${(d.maxCommit / 1e6).toFixed(0)}M of it.`
      : undefined;
    return { lender: d.name, ratePct, ltcMax: +Math.max(0, ltcMax).toFixed(3), points: d.points, open, why };
  });
}

/**
 * What a lender sets aside to carry a construction loan to delivery.
 *
 * Average outstanding across an S-curve draw is a bit over half the
 * commitment; the 1.16 gross-up covers interest compounding on itself and the
 * schedule contingency every lender builds in, because a job that opens four
 * months late still has to be carried for those four months.
 */
export function reserveFor(commitment: number, ratePct: number, months: number): number {
  return commitment * 0.58 * (ratePct / 100) * (months / 12) * 1.16;
}

export interface DevPlan {
  use: DevUse;
  mix: UseMix;
  floors: number;
  coverage: number;   // share of the lot the floorplate covers
  contract: Contract;
  sf: number;
  far: number;
  farMax: number;
  hardCost: number;
  softCost: number;
  contingency: number;
  demo: number;
  landBasis: number;    // what the site cost you — sunk, but in the yield
  basisTotal: number;   // construction plus land: the denominator of yield on cost
  leaseUp: number;    // fit-out, commissions and carry until it is full
  costTotal: number;
  ltc: number;
  ltcMax: number;
  commitment: number;
  interestReserve: number;
  ratePct: number;
  lender: string;         // whose commitment this is — the desk you picked
  points: number;         // their origination fee, as a share of the commitment
  pointsCost: number;     // ...in dollars, cash at close, on top of the equity
  equity: number;         // the whole equity budget
  equityAtClose: number;  // what you actually write on day one
  months: number;
  yieldOnCost: number;    // stabilised NOI ÷ total cost — the developer's number
  exitCap: number;
  lenderNote?: string;
}

// The buildable envelope, and nothing else. Ashport has no use districts —
// any class on any lot — so the only limit is how much floor area the FAR
// allows, and how much of the lot you choose to cover with it.
export function farMaxFor(rec: { farMaxComm: number; farMaxRes: number }): number {
  return Math.max(rec.farMaxComm, rec.farMaxRes, 2);
}
/**
 * How high a building can PHYSICALLY go on this floor plate — zoning is one
 * limit, engineering is the other, and the old code only knew about zoning,
 * which is how a 216-storey needle ended up permitted on a 414 sf lot.
 *
 * Real New York numbers: an ordinary residential tower runs a 7-12k sf plate;
 * an office tower 20-40k; the pencil towers on 57th Street stand on ~6k sf
 * plates at about 1:15 slenderness with hundred-million-dollar damping
 * systems, and they are the outer limit of what money can do. So:
 *
 *   - anything needs ~600 sf of plate to be a building at all
 *   - a walk-up (≤6 floors) needs 1,200 sf — a Manhattan townhouse plate
 *   - going past 6 floors takes a 4,000 sf plate — you need a core
 *   - past that, slenderness governs: height ≈ 12.5 ft/floor against a plate
 *     ~sqrt(plate) wide at ~15:1 gives floors ≤ 1.2·√plate
 *   - and 90 floors is the ceiling money has actually reached
 */
/** Floor to floor, feet. */
export const FLOOR_HEIGHT_FT = 12.5;
/** Height : plate width. The 57th Street limit, and about where money stops. */
export const MAX_SLENDERNESS = 15;
export const ABS_MAX_FLOORS = 90;

/**
 * HOW TALL THE STRUCTURE WILL GO, and why it was a cliff.
 *
 * This was a staircase — under 600 ft², one floor; under 1,200, three; under
 * 4,000, six; and then, at 4,000 exactly, `1.2·√plate`. On a 6,170 ft² lot the
 * footprint dial crosses 4,000 ft² of plate at 65% coverage, and one
 * percentage point of the slider took the building from six floors to
 * forty-five: 7.5x the floors, 7.6x the area, an $18.6M job becoming a $177.7M
 * one. The player noticed, and they were right.
 *
 * Two real constraints, both smooth, both INCREASING in plate size:
 *
 *   SLENDERNESS. A square-equivalent plate is √plate feet wide, and a tower
 *   stops being buildable past a height-to-width ratio of about fifteen. That
 *   is 15·√plate feet of height, or 1.2·√plate floors — the old formula was
 *   right, it was just fenced off behind a step.
 *
 *   THE CORE. Lifts, stairs, risers and a second means of egress take a fixed
 *   bite out of every floor. A very small plate cannot carry enough of them to
 *   serve height at all, which is what the staircase was standing in for. It
 *   belongs as a ramp, not a step.
 *
 * Zoning (farMax/coverage) is the third constraint and it DECREASES in
 * footprint. The minimum of one falling curve and two rising ones is
 * continuous and unimodal: floors climb while the plate is still too small to
 * build tall on, peak where the curves cross, then fall away as the envelope
 * spreads out. No cliffs anywhere on the dial.
 */
// (the function itself now lives in value.ts and is re-exported at the top of
// this file — see the import block. It had to move so that land pricing could
// ask the same question about a lot that the massing dial asks about a plate.)
/**
 * SHOPS DO NOT STACK.
 *
 * Zoning and structure were the only two things limiting height, and neither
 * of them knows what the building is FOR. Retail does: a shop needs the street
 * to walk into it, the second floor already trades at a discount to the first,
 * and above that nobody goes. There is no such thing as a sixty-storey shop —
 * and the planner was happily approving one, at a 6.89% yield on cost, on the
 * best corner in the city. The city's own growth loop was building them at
 * fifty and forty-eight floors, and every retail job it started in a fifty
 * year run came out over two storeys.
 *
 * What DOES stack is retail underneath something else, and the game already
 * models that as the mixed-use programme: shops at grade, offices and flats
 * above. So the cap belongs on the pure-retail programme only, and a site that
 * can carry more than two floors should be getting a mixed building rather
 * than a squashed one — see `useForZone` and `retailWantsMixed`.
 */
export const RETAIL_FLOORS_MAX = 2;
export const MAX_FLOORS_BY_USE: Partial<Record<DevUse, number>> = { retail: RETAIL_FLOORS_MAX };

/**
 * THE SAME CAP, STATED AS A SHARE, so the dial and the planner cannot hold
 * two opinions about it. Two floor plates of shops is the whole allowance, so
 * in a building of any height the shops are 2/n of it — a quarter of an eight
 * storey stack, eight per cent of a twenty-five storey one. `capRetail`
 * enforces it on the programme after the fact; the development card reads it
 * to bound the dial before the fact, because a slider that offered 95% shops
 * on a twenty-five storey stack was describing a building — 88,730 sf of
 * retail on a 4,218 sf lot, twenty-one FAR of shops — that the planner then
 * quietly rebuilt as 7,472 sf under an office tower.
 */
export function maxRetailShare(floors: number): number {
  return floors > 0 ? Math.min(1, RETAIL_FLOORS_MAX / floors) : 1;
}

/**
 * AND THEY DO NOT STACK INSIDE A MIXED BUILDING EITHER.
 *
 * The two-storey cap was enforced on the pure-retail PROGRAMME — a label —
 * and never on the retail floor AREA. So a mixed-use building dialled to a
 * high retail share sailed straight past it. Measured across 400 vacant lots:
 * at the default 15/45/40 stack, untouched by the player, 55 plans breached
 * the cap and the worst carried nine floors of shops; at a 50% dial every
 * single plan breached; at 100% the worst was a sixty-one storey shop, thirty
 * times over, which delivered as class "retail", 61 floors, and tripped the
 * massing invariant in a live save.
 *
 * The cap belongs on the area: retail floor area may not exceed two floor
 * plates. Anything over that is redistributed to the other uses, because a
 * developer who cannot put shops on the ninth floor puts offices there — they
 * do not shrink the building.
 */
export function capRetail(mix: UseMix, floors: number): UseMix {
  const share = mix.retail ?? 0;
  if (share <= 0 || floors <= 0) return mix;
  const maxShare = maxRetailShare(floors);
  if (share <= maxShare) return mix;
  const others = Object.entries(mix).filter(([k]) => k !== "retail") as [BuiltClass, number][];
  const rest = others.reduce((a, [, v]) => a + v, 0);
  // A programme that is nothing BUT shops has nowhere to put the overflow —
  // that is a two-storey shop building, and the caller caps the floors.
  if (rest <= 0) return { retail: 1 };
  const out: UseMix = { retail: +maxShare.toFixed(4) };
  const scale = (1 - maxShare) / rest;
  for (const [k, v] of others) out[k] = +(v * scale).toFixed(4);
  return out;
}

/**
 * WHAT IT WOULD COST TO BUILD THIS BUILDING AGAIN, TODAY.
 *
 * The single most important number in development economics, and the game did
 * not have it anywhere. It is the hinge of the whole cycle:
 *
 *   When buildings trade ABOVE what it costs to replace them, you build —
 *   because you can create a dollar of value for less than a dollar. Everybody
 *   works that out at once, which is what produces a glut.
 *
 *   When they trade BELOW replacement cost, nobody builds, at any interest
 *   rate, because you would be manufacturing a loss. That is what ENDS a glut,
 *   and it is the only thing that does. Not sentiment, not the cycle turning —
 *   arithmetic.
 *
 * Without it the development cycle had no self-correcting mechanism: a class
 * could sit at 25% vacancy and construction was still governed only by yield
 * on cost against an exit cap. Now the floor is real, and it is readable — a
 * player who can see value at 0.75x replacement knows two things at once: do
 * not build, and every building you buy is worth less than the bricks in it,
 * which is the best moment in the cycle to be an owner.
 *
 * Excludes land, deliberately. Replacement cost is about the BUILDING; land is
 * what you argue about separately, and mixing them is how people talk
 * themselves into bad sites.
 */
export function replacementCostPsf(rec: { class: string; mix?: UseMix; floors: number }, econ: GameState["econ"]): number {
  const mix = rec.mix && Object.keys(rec.mix).length ? rec.mix : ({ [rec.class]: 1 } as UseMix);
  const base = overMix(mix, (u) => HARD_COST_PSF[u]);
  // Height costs money: the same square foot on floor forty needs more
  // structure, more lift and more time than it does on floor two.
  const fl = Math.max(1, rec.floors || 1);
  const heightPrem = fl > 30 ? 1.28 : fl > 18 ? 1.18 : fl > 8 ? 1.07 : 1;
  const hard = base * econ.costIdx * heightPrem;
  return Math.round(hard * (1 + SOFT_COST) * (1 + CONTINGENCY));
}

/** The whole building, to build again from a cleared site. */
export function replacementCost(rec: { class: string; mix?: UseMix; floors: number; bldgArea: number }, econ: GameState["econ"]): number {
  if (!rec.bldgArea || rec.class === "land") return 0;
  return Math.round(replacementCostPsf(rec, econ) * rec.bldgArea);
}

/**
 * WHAT THE WHOLE CITY'S FINISHED PRODUCT TRADES AT, against what it would cost
 * to build it. Above 1.0 the town builds; below it, the town stops.
 *
 * Value per foot is derived the way a developer would: stabilised rent at
 * natural vacancy, capitalised at the class's current cap rate. Weighted by
 * how much of the pipeline each class represents, because a glut in offices
 * does not stop anyone building sheds.
 */
export function cityValueToReplacement(s: GameState): number {
  const e = s.econ;
  let vsum = 0, csum = 0;
  for (const k of BUILT_CLASSES) {
    // stabilised NOI per foot: face rent less operating cost, at natural vacancy
    const occ = 1 - NATURAL_VAC[k];
    const noiPsf = e.rentIdx[k] * occ * 0.62;
    const cap = Math.max(3, e.capRate[k]) / 100;
    const valuePsf = noiPsf / cap;
    const costPsf = HARD_COST_PSF[k] * e.costIdx * (1 + SOFT_COST) * (1 + CONTINGENCY);
    // weight by the class's share of citywide stock, so the blend reflects
    // what this town is actually made of
    const w = Math.max(1, (e.stock?.[k] ?? 1));
    vsum += valuePsf * w;
    csum += costPsf * w;
  }
  return csum > 0 ? vsum / csum : 1;
}

export function maxFloorsFor(
  rec: { farMaxComm: number; farMaxRes: number; lotArea?: number }, coverage: number, use?: DevUse,
): number {
  const zoning = Math.max(1, Math.floor(farMaxFor(rec) / Math.max(0.08, coverage)));
  const plate = (rec.lotArea ?? 0) * Math.max(0.08, coverage);
  const physical = rec.lotArea ? Math.max(1, Math.min(zoning, physicalMaxFloors(plate))) : zoning;
  const byUse = use ? MAX_FLOORS_BY_USE[use] : undefined;
  return byUse === undefined ? physical : Math.min(physical, byUse);
}

/**
 * A site that wants to be taller than a shop can be. Anything the market would
 * put more than two floors on is a mixed building with retail at grade, not a
 * two-storey shop wasting a fifteen-FAR corner.
 */
export function retailWantsMixed(rec: { farMaxComm: number; farMaxRes: number; lotArea?: number }, coverage = 0.6): boolean {
  return maxFloorsFor(rec, coverage) > RETAIL_YIELDS_ABOVE;
}
// Where standalone shops stop making sense. The median vacant lot in this
// city carries six floors — a small plate tops out there on slenderness — so
// a threshold any lower converted literally every site to mixed and the town
// stopped building standalone retail at all. Above six the envelope is worth
// too much to spend on a two-storey shop; at or below it, a shop building is
// what actually gets built, and giving up the unused FAR is the price of the
// use, which is exactly the trade a real developer weighs.
const RETAIL_YIELDS_ABOVE = 6;

// The parcel as it will exist once the building is up — what the rent, the
// cap rate and the leasing costs all have to be read against.
function asBuiltRec(rec: unknown, use: DevUse, sf: number, floors: number) {
  const mix = devMix(use);
  return { ...(rec as object), class: dominantOf(mix), mix, bldgArea: sf, floors } as never;
}

export function planDevelopment(
  s: GameState, parcels: ParcelTable, bbl: string, use: DevUse,
  floors: number, coverage = 0.6,
  contract: Contract = "gmp", ltcWanted?: number,
  custom?: { mix?: UseMix; suites?: Partial<Record<BuiltClass, number>> },
  lender?: string,
): DevPlan | null {
  // THE ENVELOPE YOU ACTUALLY HAVE. Zoning moves, variances are won and lots
  // are assembled — all of which live on the resolved record. Planning against
  // the static one meant the upzoning you read about on the news, and the
  // variance you paid a year of hearings for, bought you nothing at the desk.
  const rec = resolveRec(parcels, s, bbl);
  if (!rec || !rec.lotArea) return null;
  const cov = Math.max(0.08, Math.min(0.9, coverage));
  const farMax = farMaxFor(rec);
  // The mix has to be known before the height, because a programme that is
  // all shops is a two-storey building whatever the envelope allows.
  const raw = devMix(use, custom?.mix);
  const retailOnly = Object.entries(raw).every(([k, v]) => k === "retail" || !v);
  const fl = Math.max(1, Math.min(Math.round(floors), maxFloorsFor(rec, cov, retailOnly ? "retail" : use)));
  // GROSS AND RENTABLE ARE NOT THE SAME NUMBER, and treating them as one was
  // why assembling paid nothing. Zoning counts gross and the contractor bills
  // gross; you let rentable. The core, the two stairs, the risers and the
  // corridor take a bite out of every floor that is mostly FIXED — so a big
  // plate gives up a tenth of itself and a narrow one gives up a third.
  const plate = rec.lotArea * cov;
  const eff = plateEfficiency(plate);
  const gsf = Math.round((rec.lotArea * cov * fl) / 100) * 100;
  const sf = Math.round((gsf * eff) / 100) * 100;
  if (sf < 2000) return null;

  const mix = capRetail(raw, fl);

  const heightPrem = fl > 30 ? 1.28 : fl > 18 ? 1.18 : fl > 8 ? 1.07 : 1;
  // the budget is the sum of the jobs, not a number attached to a label
  // ...priced on GROSS. You pay for the core; you do not let it.
  const hardCost = Math.round(gsf * overMix(mix, (u) => HARD_COST_PSF[u]) * s.econ.costIdx * heightPrem * (1 + CONTRACT_PREMIUM[contract]));
  const softCost = Math.round(hardCost * SOFT_COST);
  const demo = rec.bldgArea > 0 ? Math.round(rec.bldgArea * 12 * s.econ.costIdx) : 0;
  const contingency = Math.round((hardCost + softCost) * CONTINGENCY);

  // THE LEASE-UP RESERVE.
  //
  // A building is not finished when the scaffolding comes down; it is finished
  // when it is full, and getting there costs money that never appears in the
  // headline budget: fit-out for every tenant, commissions to the brokers who
  // found them, and the carry on an empty building for months. Every job is
  // spec, so the whole building carries this — letting it during construction
  // is what claws it back.
  const openSf = sf;
  // apartments have no fit-out, but they do have concessions and marketing
  const tiPsf = overMix(mix, (u) => (u === "office" ? 32 : u === "retail" ? 22 : u === "industrial" ? 5 : 7));
  const lcPsf = overMix(mix, (u) => (u === "multifamily" ? 0 : 1))
    * marketRentPsfYr(asBuiltRec(rec, use, sf, fl), s.econ, "good") * 6 * 0.045;
  const carryMonths = overMix(mix, (u) => (u === "multifamily" ? 6 : 10));
  const carry = Math.round(openSf * overMix(mix, (u) => opexPsf(u, s.econ, false)) * (carryMonths / 12));
  const leaseUp = Math.round(openSf * (tiPsf + lcPsf) * s.econ.costIdx) + carry;

  // THE DIRT IS PART OF THE DEAL.
  //
  // Yield on cost was computed against construction cost alone, as if the site
  // had been free. It is not: it is the first and least recoverable dollar in
  // any development, and it is the whole reason a corner that rents for twice
  // as much does not automatically build for twice the profit. Leaving it out
  // made nearly four sites in five clear a hundred-basis-point hurdle — in a
  // business where most land sits vacant precisely because it does not pencil.
  //
  // It is NOT charged as cash — you already paid for it, and charging twice
  // would be its own lie — but it belongs in the denominator, because that is
  // what yield on cost means.
  const landBasis = Math.round(s.holdings[bbl]?.costBasis ?? landValue(rec, s.econ));
  const buildCost = hardCost + softCost + demo + contingency + leaseUp;
  const costTotal = buildCost;
  const basisTotal0 = buildCost + landBasis;

  // The construction lender funds construction. It does not refinance the
  // equity you already sank into the ground.
  // The lender's max is the ceiling; how much of it you TAKE is your call.
  // Less debt is a slower clock and a smaller reserve; more is more building
  // per dollar of equity and a harder landing if lease-up runs long.
  // The quote is the chosen desk's, not the town's. Rival and city jobs never
  // pass a lender, so they land on the regional — the historical default.
  const cqs = constructionQuotes(s, mix, buildCost);
  const cq = cqs.find((q) => q.lender === lender) ?? cqs.find((q) => q.lender === CONSTRUCTION_LENDER)!;
  const ltcMax = cq.open ? cq.ltcMax : 0;
  // Math.min(x, undefined) is NaN, and a NaN here does not throw — it becomes
  // the commitment, then the equity, then the firm's cash, and the first thing
  // anyone sees is a balance sheet reading NaN twenty months later. Anything
  // that is not a real number is simply not a request.
  const wanted = Number.isFinite(ltcWanted as number) ? (ltcWanted as number) : ltcMax;
  const ltc = Math.max(0, Math.min(ltcMax, wanted));
  const ratePct = cq.ratePct;
  // Foundations, core, a floor every couple of weeks, then facade and fit-out:
  // a mid-rise is a two-year job and a real tower is three to four. Nothing
  // was taking longer than 30 months, which made towers feel like sheds.
  const months = Math.min(54, 10 + Math.round(fl * 0.85));

  // THE INTEREST RESERVE, SIZED TO ACTUALLY DO ITS JOB.
  //
  // A construction lender does not send the borrower a bill. It sizes a pot
  // inside its own commitment, advances the interest to itself out of that pot
  // every month, and takes the whole thing out — principal and capitalised
  // interest together — when the perm lender refinances it at delivery. The
  // borrower's cash goes into the building, not into carry. That is the
  // standard structure and it was not what this was doing.
  //
  // The old figure was simple interest on 55% of the commitment for the
  // scheduled term. But interest here CAPITALISES — it is added to the balance
  // and earns interest itself — and the schedule slips, sometimes by months,
  // and the reserve was never resized when it did. So it ran dry on nearly
  // every job and dumped carry on the player mid-build, which is exactly the
  // thing that does not happen in the real world.
  //
  // Sized on the average outstanding balance, grossed up for compounding and
  // for a schedule that runs long. Anything left over is released at delivery.
  //
  // The reserve is part of the project's cost, and the commitment has to cover
  // its own carry as well as the building — otherwise the loan funds
  // (commitment - reserve) of construction, the equity funds the rest, and the
  // two together come up exactly one reserve short of paying for the job. That
  // shortfall was landing on the player as a capital call at the worst point
  // of the S-curve.
  //
  // Since the reserve is a function of the commitment and the commitment is a
  // function of the reserve, solve it rather than iterate:
  //     C = ltc * (cost + rC)  =>  C = ltc*cost / (1 - ltc*r)
  const rFrac = costTotal > 0 ? reserveFor(1, ratePct, months) : 0;
  const commitment = Math.round((ltc * costTotal) / Math.max(0.35, 1 - ltc * rFrac));
  const interestReserve = Math.round(reserveFor(commitment, ratePct, months));
  // financing cost is a line in every development budget, and it belongs in
  // the basis the yield is measured against
  const projectCost = costTotal + interestReserve;

  // Yield on cost against today's stabilised rents — the number a developer
  // actually lives by, and the spread to the exit cap is the whole margin.
  const asBuilt = asBuiltRec(rec, use, sf, fl);
  const rentPsf = marketRentPsfYr(asBuilt, s.econ, "good");
  const stabOcc = overMix(mix, (u) => (u === "multifamily" ? 0.95 : 0.9));
  const opex = overMix(mix, (u) => opexPsf(u, s.econ, false));
  const recovery = overMix(mix, (u) => RECOVERY_RATE[u]);
  const basisTotal = basisTotal0 + interestReserve;
  const taxLoad = basisTotal * TAX_RATE * (1 - recovery);
  const stabNoi = sf * (rentPsf * stabOcc - opex * (1 - recovery * stabOcc)) - taxLoad;
  // The exit is what THIS building will trade at — new, in good condition, on
  // this corner — not the citywide class average. Using the average understated
  // the spread by most of a point everywhere it mattered, which made every
  // development on the map look like a losing trade.
  const exitCap = capRateFor(asBuilt, s.econ, "good");
  const yieldOnCost = basisTotal > 0 ? (stabNoi / basisTotal) * 100 : 0;

  const lenderNote = ltc === 0
    ? "No construction lender will touch spec commercial in a recession. Pre-lease it, or fund the whole thing yourself."
    : yieldOnCost < exitCap + 0.75
      ? `Yield on cost is ${yieldOnCost.toFixed(2)}% against a ${exitCap.toFixed(2)}% exit. That is not a development spread — it is a way to build a building for more than it is worth.`
      : undefined;

  return {
    use, mix, floors: fl, coverage: cov, contract, sf,
    far: +(gsf / rec.lotArea).toFixed(1), farMax,
    hardCost, softCost, contingency, demo, leaseUp, costTotal, landBasis, basisTotal,
    ltc, ltcMax, commitment, interestReserve, ratePct,
    lender: cq.lender, points: cq.points, pointsCost: commitment > 0 ? Math.round(commitment * cq.points) : 0,
    equity: projectCost - commitment,
    // Equity funds FIRST. The bank does not release a dollar until yours are
    // in the ground, which is why a development eats your balance sheet at the
    // start rather than in even slices.
    equityAtClose: Math.round((projectCost - commitment) * 0.55),
    months, yieldOnCost, exitCap, lenderNote,
  };
}

export function startDevelopment(
  s: GameState, parcels: ParcelTable, bbl: string, use: DevUse,
  floors: number, coverage = 0.6,
  contract: Contract = "gmp", ltcWanted?: number,
  custom?: { mix?: UseMix; suites?: Partial<Record<BuiltClass, number>> },
  lender?: string,
): { s: GameState; err?: string } {
  const rec = resolveRec(parcels, s, bbl);
  if (!rec) return { s, err: "Unknown parcel." };
  if (!s.holdings[bbl]) return { s, err: "Buy the dirt first." };
  if (rec.class !== "land") return { s, err: "Clear the site first — demolish what's standing before you build." };
  if (s.developments[bbl]) return { s, err: "Construction is already underway." };
  // You cannot break ground on a site you are trying to sell. Somebody is
  // marketing this lot to buyers right now.
  if (s.holdings[bbl].sale) return { s, err: "It's on the market — pull the listing before you put a crane on it." };
  if (s.landmarks?.[bbl] !== undefined) return { s, err: "It is landmarked — the envelope is what is already standing." };
  if (s.groundLeases?.[bbl]) return { s, err: "That site is ground-leased. Somebody else builds on it until the term runs out." };
  if (s.merged?.[bbl]) return { s, err: "That lot is part of an assemblage — build on the site, not the piece." };
  const plan = planDevelopment(s, parcels, bbl, use, floors, coverage, contract, ltcWanted, custom, lender);
  if (!plan) return { s, err: "That's too small to be worth building — add floors or cover more of the lot." };
  // YOU HAVE TO BE ABLE TO FUND THE WHOLE THING.
  //
  // This used to test only the day-one cheque, which is 55% of the equity —
  // so a player with exactly that much could break ground on a job whose
  // remaining 45% was going to be drawn out of an account that did not have
  // it, month after month, while the building went up. That is not a hard
  // decision, it is a trap: the number on the button was not the number, and
  // the rest arrived without warning.
  //
  // No construction lender on earth closes without evidence the sponsor can
  // fund its whole share — that is the first thing they ask for. The line of
  // credit counts, because it is committed money and that is what it is for.
  const commitCap = plan.equity + plan.pointsCost + Math.round(plan.costTotal * 0.06);   // and a margin for change orders — origination is cash at close too
  const fundable = s.cash + locAvailable(s, parcels);
  if (fundable < commitCap) {
    return {
      s,
      err: `This job needs $${(plan.equity / 1e6).toFixed(2)}M of equity in total — $${(plan.equityAtClose / 1e6).toFixed(2)}M at close `
        + `and the rest drawn as it goes up, plus a margin for change orders. You can fund $${(fundable / 1e6).toFixed(2)}M `
        + `including the line. No lender closes without evidence you can finish it.`,
    };
  }
  if (s.cash < plan.equityAtClose + plan.pointsCost) {
    return { s, err: `The bank funds nothing until your equity is in the ground. That is $${((plan.equityAtClose + plan.pointsCost) / 1e6).toFixed(2)}M at close — equity plus origination — of $${((plan.equity + plan.pointsCost) / 1e6).toFixed(2)}M total. You're short.` };
  }
  const next = clone(s);
  // The origination fee is the lender's, paid at close and never part of the
  // job's own budget — folding it into the prefund would hand it back later as
  // free construction money.
  next.cash -= plan.equityAtClose + plan.pointsCost;
  logBooks(next, "dev", plan.equityAtClose + plan.pointsCost);
  if (plan.commitment > 0) bumpLenderRel(next, plan.lender, 2);   // a closed loan starts a file
  noteRecordPlan(next, parcels, bbl, dominantOf(plan.mix), plan.sf, plan.floors, firmShort(next));
  // YOUR CRANE IS IN THE SAME SKY AS EVERYBODY ELSE'S. A city job enters
  // econ.cohorts the month the hole is dug (tickCityGrowth), and a rival's own
  // job does too (startOwnJob) — but the player's never did. Two million
  // square feet of your office appeared in no delivery schedule, moved no
  // projected vacancy, and then landed on the market as a surprise the month
  // it opened. Same queue as everyone now, tagged with the parcel so a
  // schedule slip can move it and an abandoned job can pull it back out; and
  // it fills part of the order the space market has already placed
  // (startOwed), exactly as an anonymous start on the same corner would have.
  if (!next.econ.cohorts) next.econ.cohorts = { office: [], retail: [], multifamily: [], industrial: [] };
  for (const [u, share] of Object.entries(plan.mix)) {
    const usf = Math.round(plan.sf * (share as number));
    if (usf <= 0) continue;
    next.econ.cohorts[u as BuiltClass].push({ m: next.month + plan.months, sf: usf, bbl });
    if (next.econ.startOwed) {
      next.econ.startOwed[u as BuiltClass] = Math.max(0, (next.econ.startOwed[u as BuiltClass] ?? 0) - usf);
    }
  }
  next.developments[bbl] = {
    bbl, use, mix: plan.mix, sf: plan.sf, floors: plan.floors,
    suites: custom?.suites,
    costTotal: plan.costTotal, hardCost: plan.hardCost, contract,
    contingency: plan.contingency, contingencyUsed: 0,
    lender: plan.lender,
    commitment: plan.commitment, drawn: 0, loanBalance: 0,
    interestReserve: plan.interestReserve, reserveUsed: 0,
    leaseUpReserve: plan.leaseUp,
    equityBudget: plan.equity, equitySpent: plan.equityAtClose,
    // paid on day one, not yet applied against any work
    equityPrefunded: plan.equityAtClose,
    ratePct: plan.ratePct,
    startM: next.month, deliverM: next.month + plan.months, baseMonths: plan.months,
    piped: true,   // its cohort is in the market's queue, pushed above
    signed: [],
    events: 0,
  } satisfies Development;
  next.news.unshift({
    q: next.month, kind: "deal",
    text: `Ground broken at ${rec.address}: ${plan.floors} floors, ${(plan.sf / 1000).toFixed(0)}k sf of ${use === "mixed" ? "mixed-use" : use} at ${plan.far} FAR on a ${contract === "gmp" ? "guaranteed max price" : "cost-plus"} contract. $${(plan.costTotal / 1e6).toFixed(1)}M budget, ${(plan.ltc * 100).toFixed(0)}% funded by ${plan.lender}, on spec. Delivery ${monthLabel(next.month + plan.months)}.`,
  });
  return { s: next };
}

/**
 * YOU BOUGHT SOMEBODY ELSE'S HALF-FINISHED BUILDING.
 *
 * The frame is up, the sponsor is gone, and the receiver has taken your money
 * for the site and the steel on it. What you inherit is a job in progress: the
 * schedule that is left, the cost that is left, and a design you did not draw.
 * This is the cheapest way to own a new building and the reason a developer
 * watches the obituaries — and until the street could actually fail mid-job,
 * the game had no way to put one in front of you.
 *
 * Called from the closing, not by the player: buying the site IS taking the
 * job on. Mutates in place; the caller already cloned.
 */
export function takeoverDevelopment(
  s: GameState, parcels: ParcelTable, bbl: string,
  half: { use: string; sf: number; floors: number; progress: number; costToComplete: number },
) {
  const rec = resolveRec(parcels, s, bbl);
  if (!rec || !rec.lotArea || s.developments[bbl]) return;
  const use = half.use as DevUse;
  const floors = Math.max(1, Math.round(half.floors));
  const coverage = Math.max(0.08, Math.min(0.9, half.sf / Math.max(1, rec.lotArea * floors)));
  const plan = planDevelopment(s, parcels, bbl, use, floors, coverage, "gmp");
  if (!plan) return;
  const done = Math.max(0, Math.min(0.95, half.progress));
  // What is left to build, plus the lease-up money — which the dead sponsor's
  // budget no longer contains, because they spent it staying alive.
  const remaining = Math.max(0, Math.round(half.costToComplete)) + plan.leaseUp;
  const months = Math.max(3, Math.round(plan.months * (1 - done)) + 2);   // a stalled job restarts slowly
  // A takeover is financed, but not on construction-loan terms: the lender is
  // pricing a job somebody already failed at, so less of it and dearer.
  const commitment = Math.round(remaining * Math.max(0.35, plan.ltc - 0.12));
  s.developments[bbl] = {
    bbl, use, mix: plan.mix, sf: half.sf, floors,
    costTotal: remaining, hardCost: Math.round(remaining * 0.8), contract: "gmp",
    contingency: Math.round(remaining * CONTINGENCY), contingencyUsed: 0,
    commitment, drawn: 0, loanBalance: 0,
    interestReserve: Math.round(commitment * 0.05), reserveUsed: 0,
    leaseUpReserve: plan.leaseUp,
    equityBudget: Math.max(0, remaining - commitment), equitySpent: 0,
    equityPrefunded: 0,   // a takeover writes no cheque at close
    ratePct: +(s.econ.indexRate + 3.2).toFixed(2),
    startM: s.month, deliverM: s.month + months, baseMonths: months,
    // the dead sponsor's start already queued this building's square feet in
    // econ.cohorts; the market has been expecting it since their groundbreak
    piped: true,
    signed: [],
    events: 0,
  } satisfies Development;
  s.cityJobs = (s.cityJobs ?? []).filter((j) => j.bbl !== bbl);
  s.news.unshift({
    q: s.month, kind: "deal",
    text: `You have taken over the job at ${rec.address} — ${(done * 100).toFixed(0)}% built, `
      + `$${(remaining / 1e6).toFixed(1)}M to finish and open, delivery ${monthLabel(s.month + months)}. `
      + `Somebody else paid for the hole in the ground.`,
  });
}

// Take a building down to clean dirt. The rubble costs real money, but a
// three-storey walk-up on a site that carries thirty floors is worth more as
// a hole in the ground.
export function demolitionCost(rec: { bldgArea: number }, s: GameState): number {
  return Math.round(Math.max(60_000, rec.bldgArea * 14 * s.econ.costIdx));
}

export function demolish(s: GameState, parcels: ParcelTable, bbl: string): { s: GameState; err?: string } {
  const h = s.holdings[bbl];
  const rec = resolveRec(parcels, s, bbl);
  if (!h || !rec) return { s, err: "You don't own that." };
  if (rec.class === "land" || !rec.bldgArea) return { s, err: "There's nothing standing on it." };
  if (s.landmarks?.[bbl] !== undefined) return { s, err: "It is landmarked. Nobody knocks that down, including you." };
  if (s.developments[bbl]) return { s, err: "Construction is already underway." };
  if (h.sale) return { s, err: "It's on the market — pull the listing first." };
  // OCCUPIED SPACE IS OCCUPIED SPACE — including the flats, which this used to
  // ignore entirely, so a full apartment block with no commercial roll could be
  // knocked down with people living in it.
  const leased = h.tenants.reduce((sum, t) => sum + t.sf, 0)
    + useSf(rec, "multifamily") * (h.occ ?? 0);
  if (leased / Math.max(1, rec.bldgArea) > 0.2) {
    return {
      s,
      err: "You can't demolish over occupied space. Stop letting it and wait the roll out, or buy the leases out — both are on the leasing desk.",
    };
  }
  const cost = demolitionCost(rec, s);
  if (s.cash < cost) return { s, err: `Demolition runs $${(cost / 1e6).toFixed(2)}M — you're short.` };
  const next = clone(s);
  next.cash -= cost;
  logBooks(next, "capex", cost);
  next.built[bbl] = { class: "land" as unknown as BuiltClass, bldgArea: 0, floors: 0, yearBuilt: 0 };
  const nh = next.holdings[bbl];
  nh.tenants = [];
  delete nh.occ;
  delete nh.makeReady;
  delete nh.deliveredM;
  nh.condition = "standard";
  nh.lastCapM = s.month;
  next.lois = next.lois.filter((l) => l.bbl !== bbl);
  next.news.unshift({
    q: next.month, kind: "warn",
    text: `${rec.address} came down — $${(cost / 1e6).toFixed(2)}M to clear it. The site is dirt again.`,
  });
  return { s: next };
}

/**
 * ONE MONTH OF CONSTRUCTION.
 *
 * A job is not a timer with a cheque at the end. Money goes out on an S-curve
 * — slow while the hole is dug, fast through the structure, slow through
 * fit-out — and the bank funds its share against work actually in place, after
 * your equity is in. Interest runs on what has been drawn and is paid from a
 * reserve inside the loan until the reserve is gone, and then it is your
 * problem. Costs move under you unless you bought a guaranteed price. And
 * things go wrong on their own schedule, not at a convenient midpoint.
 */
export function tickDevelopments(s: GameState, parcels: ParcelTable) {
  for (const d of Object.values(s.developments)) {
    const rec = parcels[d.bbl];
    if (!rec || !s.holdings[d.bbl]) {
      // The job dies with the deed — pull its square feet back out of the
      // pipeline too, or the market absorbs a building nobody is building.
      if (s.econ.cohorts) {
        for (const k of Object.keys(s.econ.cohorts) as BuiltClass[]) {
          s.econ.cohorts[k] = s.econ.cohorts[k].filter((c) => c.bbl !== d.bbl);
        }
      }
      delete s.developments[d.bbl];
      continue;
    }
    // SELF-HEAL, once, for jobs in flight from saves written before player
    // starts entered the pipeline: register the square feet now, tagged. New
    // jobs are marked at the desk (startDevelopment) or already covered by
    // their original sponsor's cohort (takeoverDevelopment). If the schedule
    // is already due, the cohort matures on the next econ tick — deliver() no
    // longer adds stock itself, so it still lands exactly once.
    if (!d.piped) {
      d.piped = true;
      if (!s.econ.cohorts) s.econ.cohorts = { office: [], retail: [], multifamily: [], industrial: [] };
      for (const [u, share] of Object.entries(d.mix ?? devMix(d.use))) {
        const usf = Math.round(d.sf * (share as number));
        if (usf > 0) s.econ.cohorts[u as BuiltClass].push({ m: d.deliverM, sf: usf, bbl: d.bbl });
      }
    }
    const span = Math.max(1, d.deliverM - d.startM);
    const t0 = Math.max(0, Math.min(1, (s.month - 1 - d.startM) / span));
    const t1 = Math.max(0, Math.min(1, (s.month - d.startM) / span));
    // the classic S-curve of spend against time
    const curve = (t: number) => t * t * (3 - 2 * t);
    const spendShare = Math.max(0, curve(t1) - curve(t0));
    // The lease-up reserve is in the budget and financed with everything else,
    // but it is NOT construction spend — it does not buy steel, it buys
    // tenants, and it is released at delivery. Pouring it into the S-curve is
    // why a developer arrived at handover with an empty building and no money
    // to fit anybody out: the reserve existed on the pro forma and had already
    // been spent on the building it was supposed to fill.
    const buildSpend = Math.max(0, d.costTotal - (d.leaseUpReserve ?? 0));
    const spendNow = Math.round(buildSpend * spendShare);

    if (spendNow > 0) {
      // THE CHEQUE YOU ALREADY WROTE PAYS FIRST, and it costs nothing further.
      // Without this the S-curve spent the full build cost ON TOP of the
      // day-one equity, and the gap surfaced as a silent capital call at 90%
      // complete — the single worst bug in the game, because it emptied your
      // account in the three months before a building you were about to have
      // to fit out.
      const fromPre = Math.min(d.equityPrefunded ?? 0, spendNow);
      d.equityPrefunded = (d.equityPrefunded ?? 0) - fromPre;
      const rest = spendNow - fromPre;
      // equity next, to the extent any is left; the bank funds the remainder
      const equityLeft = Math.max(0, d.equityBudget - d.equitySpent);
      const fromEquity = Math.min(equityLeft, rest);
      // the loan's construction bucket is the commitment LESS the reserve it
      // is holding back for its own interest; interest draws are tracked in
      // reserveUsed, so construction-to-date is drawn minus that
      const hardRoom = Math.max(0, (d.commitment - d.interestReserve) - (d.drawn - d.reserveUsed));
      const fromLoan = Math.min(hardRoom, rest - fromEquity);
      const unfunded = rest - fromEquity - fromLoan;
      d.equitySpent += fromEquity;
      d.drawn += fromLoan;
      d.loanBalance += fromLoan;
      // anything neither side will fund is a capital call, today. On a job that
      // runs to plan this is now zero; it fires for overruns, which is what a
      // capital call is actually for.
      s.cash -= fromEquity + unfunded;
      logBooks(s, "dev", fromEquity + unfunded);
      if (unfunded > 0) d.equitySpent += unfunded;
    }

    // INTEREST, AND WHO PAYS IT BEFORE THE BUILDING OPENS. Nobody. It accrues
    // on the drawn balance, capitalises into the loan, and is advanced by the
    // lender out of the reserve it sized for exactly this. Not one dollar of
    // the player's cash leaves for construction carry, which is how these are
    // structured: the whole balance, interest included, is taken out by the
    // perm lender at delivery.
    //
    // If the schedule slips far enough to exhaust the reserve, the lender
    // re-sizes it rather than calling the borrower — it wants the building
    // finished at least as much as you do — and it charges for the privilege
    // by adding it to the balance you have to refinance.
    if (d.loanBalance > 0) {
      const interest = Math.round((d.loanBalance * d.ratePct) / 100 / 12);
      if (d.reserveUsed + interest > d.interestReserve) {
        const extra = Math.round(reserveFor(d.commitment, d.ratePct, Math.max(3, d.deliverM - s.month)) * 0.5) + interest;
        d.interestReserve += extra;
        d.commitment += extra;
        s.news.unshift({
          q: s.month, kind: "info",
          text: `The schedule at ${rec.address} has run past its interest reserve. The lender topped it up — it goes on the balance the takeout has to cover, not on your cheque book.`,
        });
      }
      d.reserveUsed += interest;
      d.loanBalance += interest;   // capitalised, repaid by the mini-perm
      d.drawn += interest;         // and it is a draw against the commitment
    }

    // COST ESCALATION. Under cost-plus the unspent balance of the job moves
    // with the market; under a guaranteed maximum price it does not, and that
    // is what the four-point premium bought.
    if (d.contract === "costplus" && s.month > d.startM) {
      const remaining = Math.max(0, d.hardCost * (1 - curve(t1)));
      const drift = s.econ.phase === "expansion" || s.econ.phase === "peak" ? rrange(s, 0.0012, 0.0038) : rrange(s, -0.001, 0.0016);
      const escal = Math.round(remaining * drift);
      if (escal > 0) { d.costTotal += escal; d.hardCost += escal; d.equityBudget += escal; }
    }

    // SITE RISK, month by month. Each is rare; a two-year job runs the gauntlet
    // twenty-odd times, which is why schedules slip and budgets grow.
    const progress = curve(t1);
    if (progress > 0.04 && progress < 0.97) {
      const roll = rng(s);
      const gmpShield = d.contract === "gmp" ? 0.35 : 1;   // the GC eats most of it
      if (roll < 0.028 * gmpShield) {
        // change order
        const bump = rrange(s, 0.015, 0.07);
        const extra = Math.round(d.costTotal * bump);
        const fromContingency = Math.min(Math.max(0, d.contingency - d.contingencyUsed), extra);
        d.contingencyUsed += fromContingency;
        const overrun = extra - fromContingency;
        d.costTotal += overrun;
        d.hardCost += overrun;
        d.equityBudget += overrun;
        d.events++;
        s.news.unshift({
          q: s.month, kind: overrun > 0 ? "warn" : "info",
          text: overrun > 0
            ? `Change orders at ${rec.address}: $${(extra / 1e6).toFixed(2)}M, of which $${(overrun / 1e6).toFixed(2)}M is past the contingency and lands on you.`
            : `Change orders at ${rec.address}: $${(extra / 1e6).toFixed(2)}M, absorbed by the contingency.`,
        });
      } else if (roll < 0.055) {
        d.deliverM += 1 + Math.round(rng(s));
        syncDevCohorts(s, d);
        d.events++;
        s.news.unshift({ q: s.month, kind: "warn", text: `Weather and inspections at ${rec.address} — delivery moves to ${monthLabel(d.deliverM)}.` });
      } else if (roll < 0.062) {
        // a sub goes under: time AND money, and the GMP does not help much
        const extra = Math.round(d.costTotal * rrange(s, 0.03, 0.09));
        const fromContingency = Math.min(Math.max(0, d.contingency - d.contingencyUsed), extra);
        d.contingencyUsed += fromContingency;
        const overrun = extra - fromContingency;
        d.costTotal += overrun; d.hardCost += overrun; d.equityBudget += overrun;
        d.deliverM += 2 + Math.round(rng(s) * 3);
        syncDevCohorts(s, d);
        d.events++;
        s.news.unshift({
          q: s.month, kind: "warn",
          text: `A subcontractor at ${rec.address} defaulted. Re-tendering costs $${(extra / 1e6).toFixed(2)}M and pushes delivery to ${monthLabel(d.deliverM)}.`,
        });
      }
    }

    if (s.month >= d.deliverM) deliver(s, parcels, d, rec);
  }
}

/**
 * LEASING A BUILDING THAT DOES NOT EXIST YET.
 *
 * This is the mechanic that replaces pre-letting, and it is the one that
 * actually happens. Nobody signs against a drawing, but once the structure is
 * up and a tenant can walk a floor, space in a building with a delivery date
 * lets perfectly well — at a discount, because the tenant is carrying the risk
 * that you are late, and that discount narrows as the date gets close.
 *
 * It makes the whole development arc a live decision instead of a wait. A job
 * started into a strong market and delivered into a weak one lets nothing on
 * the way up and opens empty against a mini-perm clock; one whose market holds
 * opens half-full and covers itself from month one.
 */
export function tickConstructionLeasing(s: GameState, parcels: ParcelTable) {
  for (const d of Object.values(s.developments)) {
    const rec = parcels[d.bbl];
    if (!rec) continue;
    const span = Math.max(1, d.deliverM - d.startM);
    const t = (s.month - d.startM) / span;
    // you cannot show space that is not enclosed
    if (t < 0.35) continue;
    if (!d.signed) d.signed = [];
    const takenSf = d.signed.reduce((a, x) => a + x.sf, 0);
    const leasable = Math.round(d.sf * specShare(d.mix ?? devMix(d.use)));
    const openSf = leasable - takenSf;
    if (openSf < 1500) continue;

    const lead = dominantOf(d.mix ?? devMix(d.use));
    // a tight market lets a building before it opens; a glut does not
    const appetite = classAppetite(s, lead);
    const months = Math.max(1, d.deliverM - s.month);
    // interest builds as the date approaches — the risk a tenant is taking
    // shrinks, and so does what they will hold out for
    const near = clamp(1.35 - months / 18, 0.35, 1.35);
    const p = clamp(0.055 * appetite * near * (0.55 + demandLinear(rec.demandScore) / 130), 0, 0.42);
    if (rng(s) >= p) continue;

    const want = Math.round(openSf * rrange(s, 0.16, 0.5));
    if (want < 1500) continue;
    // The delivery-risk discount: steep when the building is a frame and a
    // promise, nearly gone by the time the scaffolding comes down.
    const discount = clamp(1 - (0.16 * (months / Math.max(1, span))), 0.86, 0.99);
    d.signed.push({ sf: want, use: lead, discount, name: "" });
    s.news.unshift({
      q: s.month, kind: "deal",
      text: `Let before it opens: ${(want / 1000).toFixed(0)}k sf at ${rec.address}, ${((1 - discount) * 100).toFixed(0)}% under market for taking delivery risk. `
        + `${(((takenSf + want) / Math.max(1, leasable)) * 100).toFixed(0)}% of the building is spoken for.`,
    });
  }
}

/**
 * A SLIPPED JOB SLIPS ITS COHORT TOO. The month ground broke, the job's square
 * feet entered econ.cohorts tagged with this parcel; when weather or a dead
 * subcontractor moves deliverM, the pipeline's date moves with it.
 */
function syncDevCohorts(s: GameState, d: Development) {
  if (!s.econ.cohorts) return;
  for (const arr of Object.values(s.econ.cohorts)) {
    for (const c of arr) if (c.bbl === d.bbl) c.m = d.deliverM;
  }
}

function deliver(s: GameState, parcels: ParcelTable, d: Development, rec: { address: string }) {
  // Buildings you have put up. The city notices a developer.
  s.delivered = (s.delivered ?? 0) + 1;
  const dmix = d.mix ?? devMix(d.use);
  s.built[d.bbl] = { class: dominantOf(dmix), mix: dmix, bldgArea: d.sf, floors: d.floors, yearBuilt: 2000 + Math.floor(s.month / 12), suites: d.suites };
  // YOUR BUILDING IS SUPPLY TOO. A tower you deliver competes with everybody
  // else's space, including your own — and if you build enough of one class
  // you will move its vacancy against yourself, which is the correct lesson.
  // NOTE: no addStock here — the same rule as city deliveries in
  // tickCityGrowth. The square feet went into econ.cohorts the month ground
  // broke (startDevelopment), or with the original sponsor's start for a
  // takeover, and the cohort matures into citywide stock on its own in
  // tickEcon. Adding it again on delivery double-counted the building:
  // measured at exactly 2x the job's sf landing in stock across the delivery
  // month.
  const h = s.holdings[d.bbl];
  h.condition = "good";
  // NEW BONES. Ground-up is the only way to own the top of the condition scale —
  // see condCeiling: no amount of capital gets an old building here. That is a
  // real part of what a developer is buying and it was not modelled at all.
  h.condIdx = 0.96;
  h.service = s.opsPolicy?.service ?? 0;
  h.plan = s.opsPolicy?.plan ?? 1;
  h.svcIdx = 0.70;   // a building that opens this year opens well run
  h.lastCapM = s.month;
  h.tenants = [];
  h.deliveredM = s.month;
  if ((dmix.multifamily ?? 0) > 0) h.occ = 0.1;
  h.costBasis += d.costTotal;
  h.assessed = (h.assessed ?? h.costBasis - d.costTotal) + d.costTotal;

  // unspent contingency is a rebate, not a rounding error
  const saved = Math.max(0, d.contingency - d.contingencyUsed);
  if (saved > 0) {
    s.cash += saved;
    logBooks(s, "dev", -saved);
  }

  // THE LEASE-UP RESERVE IS RELEASED. This is the money that fills the
  // building — fit-out, commissions and the carry until it is full. It was
  // financed on day one along with everything else, and now that there is a
  // building to lease it comes across as cash. Without this a developer who
  // had spent correctly to plan still could not afford the TI on the first
  // tenant through the door.
  // AND IT IS FINANCED, NOT MINTED. The reserve was handed over as free cash,
  // which quietly conjured money into the game. It is part of the loan
  // commitment — the bank is advancing it now that there is a building to
  // lease — so it draws like any other advance and the balance goes up.
  const lease = d.leaseUpReserve ?? 0;
  if (lease > 0) {
    const room = Math.max(0, d.commitment - d.drawn);
    const advance = Math.min(lease, room);
    d.drawn += advance;
    d.loanBalance += advance;
    s.cash += lease;
    logBooks(s, "dev", -lease);
    s.news.unshift({
      q: s.month, kind: "info",
      text: `The lease-up reserve at ${rec.address} — $${(lease / 1e6).toFixed(2)}M — is released. That is what fits out the first tenants.`,
    });
  }

  // TENANTS WHO SIGNED WHILE IT WAS GOING UP. They took delivery risk on a
  // hole in the ground and were paid for it in rent; now the building exists
  // and they move in. A job that let well during construction opens part-full
  // and covers its mini-perm; one that let nothing opens empty, which is the
  // developer's real risk and always was.
  for (const sg of d.signed ?? []) {
    const built = resolveRec(parcels, s, d.bbl);
    if (built) genAnchorTenant(s, built, h, sg.sf, sg.discount, sg.use as BuiltClass);
  }

  // THE TAKEOUT. The construction loan does not evaporate — it rolls into a
  // mini-perm that is interest-only for a year and matures in three, and the
  // whole job now is to stabilise the building before that clock runs out.
  // A developer's real risk is not building it. It is owning it empty.
  h.loan = {
    product: "cordage",
    floating: true,
    principal: d.loanBalance,
    balance: d.loanBalance,
    ratePct: +(s.econ.indexRate + 2.1).toFixed(2),
    spread: 2.1,
    // A THREE-YEAR CLOCK WAS TOO SHORT. Filling a building at this market's
    // pace takes longer than that, so every job arrived at its balloon still
    // half empty and un-refinanceable. A construction takeout is a three-plus
    // -two or a five-year in practice, and interest-only while it fills.
    ioUntilM: s.month + 24,
    amortYears: 30,
    maturityM: s.month + 60,
    monthlyPmt: Math.round((d.loanBalance * (s.econ.indexRate + 2.1)) / 100 / 12),
    minDSCR: 1.05,
    maxLTV: 0.9,
    sweep: false,
    cleanQs: 0,
    originM: s.month,
    // A building that delivered empty cannot cover anything, and every lender
    // who writes construction paper knows it. The holiday runs three years —
    // long enough to fill it, short enough that failing to is fatal.
    holidayUntilM: s.month + 36,
    prepay: "open",
    prepayUntilM: s.month,
    // The mini-perm is the construction lender rolling its own facility — the
    // balance stays on the desk that carried the job, which is what its
    // statement on Research shows and whose capital a default would eat.
    holder: d.lender ?? CONSTRUCTION_LENDER,
  };
  bumpLenderRel(s, d.lender ?? CONSTRUCTION_LENDER, 2);   // a job delivered is the best line in the file
  delete s.developments[d.bbl];
  bumpLand(s, d.bbl, 1.06);

  const over = d.costTotal - (d.hardCost + Math.round(d.hardCost * SOFT_COST));
  void over;
  s.news.unshift({
    q: s.month, kind: "deal",
    text: `Delivered: ${(d.sf / 1000).toFixed(0)}k sf of ${d.use} at ${rec.address}, ${d.events === 0 ? "on programme" : `after ${d.events} problem${d.events > 1 ? "s" : ""}`}, $${(d.costTotal / 1e6).toFixed(1)}M all in`
      + (saved > 0 ? `, with $${(saved / 1e6).toFixed(2)}M of contingency returned` : "")
      + `. The mini-perm matures ${monthLabel(s.month + 60)} — stabilise it before then.`,
  });
}

// ---- building management ---------------------------------------------------
export interface CapProgram {
  id: string;
  label: string;
  costPsf: number;
  months: number;
  blurb: string;
}
export const PROGRAMS: CapProgram[] = [
  { id: "lobby", label: "Lobby refresh", costPsf: 14, months: 3, blurb: "+4% new-lease rents, more LOIs" },
  { id: "systems", label: "Systems & HVAC", costPsf: 22, months: 6, blurb: "−15% operating costs" },
  { id: "facade", label: "Facade program", costPsf: 30, months: 6, blurb: "+8% new-lease rents" },
];

/**
 * WHAT A PROGRAMME IS WORTH TO THE BRICKS.
 *
 * These were three permanent stat buffs that did nothing whatever to condition
 * and did not even reset the neglect clock, which meant there was no way to
 * improve a building you actually operate: the only route back up was a gut,
 * and startRenovation refuses one until the roll burns below 35% leased. On a
 * stabilised 98k sf office that is a $20.5M job you are not allowed to do.
 *
 * A facade or a plant replacement moves a grade on its own — and at $30 and $22
 * a foot against a $210/sf gut, that is the correct real-world arithmetic: a
 * repositioning is a fraction of a rebuild. A lobby is a first impression and
 * buys a third of a grade. This is now the whole answer to age, and it is a
 * decision taken once a decade per building, not once a month.
 */
export const PROGRAM_LIFT: Record<string, number> = { lobby: 0.08, systems: 0.17, facade: 0.21 };

/** How long each job holds before the same one is due again. */
export const PROGRAM_CYCLE_M: Record<string, number> = { lobby: 180, systems: 300, facade: 420 };

export function programCost(rec: { bldgArea: number }, s: GameState, p: CapProgram): number {
  return Math.round(rec.bldgArea * p.costPsf * s.econ.costIdx);
}

export function startProgram(s: GameState, parcels: ParcelTable, bbl: string, programId: string): { s: GameState; err?: string } {
  const h = s.holdings[bbl];
  const rec = resolveRec(parcels, s, bbl);
  const p = PROGRAMS.find((x) => x.id === programId);
  if (!h || !rec || !p) return { s, err: "No such program." };
  if (rec.class === "land" || !rec.bldgArea) return { s, err: "Nothing to improve on a vacant lot." };
  if (h.program) return { s, err: "A capital program is already running." };
  // A PROGRAMME COMES ROUND AGAIN. These were once-per-building-forever, which
  // over a century is three capital decisions and then nothing — no answer to
  // age, and a building whose menu was spent had only a gut left, which a full
  // rent roll forbids. Real capital is a cycle, and this is its period.
  const last = h.programsDone?.[programId];
  if (last !== undefined && s.month - last < (PROGRAM_CYCLE_M[programId] ?? 240)) {
    return { s, err: `${p.label} was done here in ${monthLabel(last)}. It does not need doing again yet.` };
  }
  const cost = programCost(rec, s, p);
  if (s.cash < cost) return { s, err: `${p.label} costs $${(cost / 1e6).toFixed(2)}M — you're short.` };
  const next = clone(s);
  next.cash -= cost;
  logBooks(next, "capex", cost);
  const nh = next.holdings[bbl];
  nh.program = { id: programId, untilM: next.month + p.months };
  next.news.unshift({ q: next.month, kind: "info", text: `${p.label} underway at ${rec.address} ($${(cost / 1e6).toFixed(2)}M).` });
  return { s: next };
}

export function tickPrograms(s: GameState, parcels: ParcelTable) {
  for (const h of Object.values(s.holdings)) {
    if (h.program && s.month >= h.program.untilM) {
      h.programsDone = { ...(h.programsDone ?? {}), [h.program.id]: s.month };
      const rec = resolveRec(parcels, s, h.bbl);
      const p = PROGRAMS.find((x) => x.id === h.program!.id);
      // THE MONEY BUYS THE BRICKS BACK. New plant, a new skin or a new front
      // door is the difference between a building the market still rings about
      // and one it has stopped calling — capped by what the bones will carry,
      // because you cannot make a 1928 walk-up read as new construction.
      if (rec) {
        h.condIdx = Math.min(condCeiling(rec, s.month), (h.condIdx ?? 0.7) + (PROGRAM_LIFT[h.program!.id] ?? 0));
        h.condition = condGrade(h.condIdx);
        h.lastCapM = s.month;
      }
      if (rec && p) s.news.unshift({ q: s.month, kind: "info", text: `${p.label} complete at ${rec.address} — the building reads as ${h.condition} now.` });
      delete h.program;
    }
  }
}

export function setStance(s: GameState, bbl: string, stance: -1 | 0 | 1): GameState {
  const next = clone(s);
  if (next.holdings[bbl]) next.holdings[bbl].stance = stance;
  return next;
}

/**
 * HOW THIS BUILDING IS RUN. Free to change and slow to matter, which is the
 * honest shape: you can switch the service level this afternoon and the
 * tenants will not have noticed for three years.
 */
export function setOps(
  s: GameState, bbl: string, ops: { service?: -1 | 0 | 1; plan?: 0 | 1 | 2 },
): GameState {
  const next = clone(s);
  const h = next.holdings[bbl];
  if (!h) return next;
  if (ops.service !== undefined) h.service = ops.service;
  if (ops.plan !== undefined) h.plan = ops.plan;
  return next;
}

/**
 * THE HOUSE POLICY, and it applies to the book you already own.
 *
 * This is the one control that keeps the whole system out of chore territory.
 * Set it once and every deed you close after it arrives configured; set it
 * again and the existing book follows, because a firm that decides to start
 * running its buildings properly does not do it one address at a time.
 */
export function setOpsPolicy(
  s: GameState, ops: { service: -1 | 0 | 1; plan: 0 | 1 | 2 }, applyToBook = true,
): GameState {
  const next = clone(s);
  next.opsPolicy = ops;
  if (applyToBook) {
    for (const h of Object.values(next.holdings)) { h.service = ops.service; h.plan = ops.plan; }
    next.news.unshift({
      q: next.month, kind: "info",
      text: `House policy: buildings run ${serviceSpec(ops.service).label.toLowerCase()}, capital plan ${planSpec(ops.plan).label.toLowerCase()}. `
        + `It applies to everything on the book from this month.`,
    });
  }
  return next;
}

// ---- the city builds itself ------------------------------------------------
// Over a lifetime the market fills in the vacant lots around you — fastest in
// booms, near-stalled in recessions, always working outward from the demand
// peaks. Every delivery lifts land values on its block, so watching where the
// cranes go is a market signal.
//
// TWO THINGS WERE WRONG WITH THIS.
//
// It ran at 0.88 deliveries a MONTH in an expansion — better than ten new
// buildings a year in a town of sixteen hundred lots, which is a construction
// boom in perpetuity and nothing like a real small city, where two or three a
// year is a busy market and a bad year has none.
//
// And a building appeared the instant it was decided, its square feet landing
// on the market complete. Nothing works that way. The decision to build is
// taken in one market and the building arrives in a different one, two or
// three years later, and that lag is the entire reason property cycles
// overshoot: everybody starts at the top and everybody delivers into the
// bottom. Now a city start is a hole in the ground with a delivery date, its
// space enters the pipeline the day it starts, and it competes with you only
// when it opens.
// HOW OFTEN ANYBODY BREAKS GROUND, by phase.
//
// Cut to a quarter of what it was. The old rate put 3.7 cranes up across the
// town at any given moment and peaked at ten, in a city of 1,600 lots — a
// skyline permanently under scaffolding, which is not what a real town looks
// like even in a boom. A building is a three-year commitment somebody makes a
// handful of times a decade, and it should read that way on the map.
// THE CITY HAS TO BUILD, OR NOTHING EVER CHANGES.
//
// These were cut hard once, correctly, because the town was a forest of
// cranes. They were cut too far: measured over fifty years the city started
// THIRTEEN buildings, and forty of those fifty years had zero starts, on a map
// with 476 vacant lots. That is not a quiet market, it is a stopped one — and
// it starved the demand model, which can only move when the built environment
// moves. Median parcel demand drifted 0.5 points in fifty years and not one
// parcel of 1,662 moved more than five. The scenic backdrop the player
// complained about was this, not the model behind it.
//
// Roughly 2.5x, still well under where it started, and now with the
// replacement-cost brake underneath it so the rate is high in a boom and near
// zero in a glut rather than flat.
const START_RATE: Record<string, number> = {
  expansion: 0.14, peak: 0.09, recovery: 0.065, recession: 0.012,
};

/**
 * THE BLOCK'S CORNICE DATUM, ENGINE SIDE.
 *
 * The citygen has a cornice-datum machine that makes the GENERATED town read
 * as a town; the engine had nothing, so infill was sized off the ZONING
 * envelope. Under the default "village" preset the standing city is p50 3
 * floors, p99 8, max 14 — while vacant-lot farMax is p50 15.6, p90 30.5.
 * Measured over 20 years x 2 seeds: 51 city/rival groundbreaks per run at
 * MEDIAN 15-17 floors, max 32, with 26-35 of them more than twice the tallest
 * standing neighbour. A village sprouted a forest of towers in a decade.
 *
 * No speculative builder does that. Infill is priced off the block's comps,
 * and the comp set is what is standing: a developer builds one increment above
 * the cornice line, because the increment is what the lenders and the tenants
 * have already underwritten. Tall arrives the way it arrives in life — block
 * by block, each cycle ratcheting the datum a few floors, over decades.
 *
 * The PLAYER is deliberately not capped: zoning is their envelope and
 * overbuilding their own market is their risk to take.
 */
export function blockDatumFloors(s: GameState, parcels: ParcelTable, block: string): number {
  let datum = 0;
  for (const bbl in parcels) {
    const p = parcels[bbl];
    if (!p || p.block !== block) continue;
    const r = resolveRec(parcels, s, bbl);
    if (r && r.class !== "land" && r.floors > datum) datum = r.floors;
  }
  return datum;
}

/** How high the market will speculatively build on this lot TODAY. */
export function cityInfillCap(
  s: GameState, parcels: ParcelTable, rec: { block: string; lotArea: number }, maturity: number,
): number {
  const datum = blockDatumFloors(s, parcels, rec.block);
  // one increment above the datum; the increment itself grows as the town
  // matures and its comps deepen — 2 floors in year one, 6 by year 65
  const step = 2 + Math.round(maturity * 4);
  return Math.max(2, Math.min(Math.max(1, datum) + step, physicalMaxFloors(rec.lotArea * 0.62)));
}

export function useForZone(zone: string, demand: number, r: number): DevUse {
  if (zone.startsWith("M")) return "industrial";
  if (zone.startsWith("R")) return "multifamily";
  if (demand > 70) return r < 0.55 ? "office" : r < 0.85 ? "mixed" : "retail";
  if (demand > 45) return r < 0.4 ? "mixed" : r < 0.8 ? "multifamily" : "retail";
  return r < 0.7 ? "multifamily" : "retail";
}

/**
 * Would anybody sensibly break ground in this class right now?
 *
 * Vacancy against its natural rate, softened by what is already coming. A
 * class three points tight gets built hard; a class in a glut with a full
 * pipeline does not get built at all, which is what stops the city cheerfully
 * paving itself through a downturn.
 */
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function classAppetite(s: GameState, k: BuiltClass): number {
  const e = s.econ;
  const vac = e.cityVac?.[k] ?? NATURAL_VAC[k];
  const gap = vac - NATURAL_VAC[k];
  const stk = e.stock?.[k] ?? CITY_STOCK[k];
  const coming = (e.pipeline?.[k] ?? 0) / Math.max(1, stk);   // pipeline as a share of stock
  const tight = clamp(1 - gap * 13 - coming * 5, 0, 2.1);
  return tight * clamp(e.creditIdx ?? 1, 0.25, 1.25);
}

/**
 * A RECORD GOES ON THE TAPE, AND THE TAPE TAKES YOU THERE.
 *
 * A city notices when somebody plans the biggest office building it has ever
 * seen — that is front-page news in any real town, and it is exactly the event
 * a principal wants to fly to and stare at, because the supply it represents is
 * pointed at their rent roll. The record is seeded LAZILY from the standing
 * stock, so the first two-storey shop of a young campaign does not make the
 * tape: a plan is only news when it beats everything built as well as
 * everything planned.
 */
export function noteRecordPlan(
  s: GameState, parcels: ParcelTable, bbl: string, use: BuiltClass, sf: number, floors: number, who: string,
) {
  if (!s.recordPlan) {
    s.recordPlan = { office: 0, retail: 0, multifamily: 0, industrial: 0 };
    for (const b in parcels) {
      const r = parcels[b];
      if (!r || r.class === "land" || !r.bldgArea) continue;
      const k = r.class as BuiltClass;
      if (k in s.recordPlan && r.bldgArea > s.recordPlan[k]) s.recordPlan[k] = r.bldgArea;
    }
  }
  if (sf <= (s.recordPlan[use] ?? 0)) return;
  s.recordPlan[use] = sf;
  const rec = resolveRec(parcels, s, bbl);
  s.news.unshift({
    q: s.month, kind: "event", bbl,
    text: `${who} filed plans for the largest ${SECTOR_LABEL[use].toLowerCase()} building this city has ever ` +
      `seen: ${Math.round(sf).toLocaleString()} sf, ${floors} floors, at ${rec?.address ?? bbl}. ` +
      `Every landlord in the class just read the same paragraph you did.`,
  });
}

export function tickCityGrowth(
  s: GameState, parcels: ParcelTable, bbls: string[], adjacency: Record<string, string[]> | null,
) {
  if (!s.cityJobs) s.cityJobs = [];

  // ---- deliveries first: today's opening was somebody's decision years ago --
  const still: NonNullable<GameState["cityJobs"]> = [];
  for (const j of s.cityJobs) {
    // An orphaned frame does not finish itself. It stands there until the
    // receiver sells it, and the buyer decides whether it ever opens.
    if (j.orphaned) { if (!s.built[j.bbl] && !s.holdings[j.bbl]) still.push(j); continue; }
    if (s.month < j.deliverM) { still.push(j); continue; }
    const rec = parcels[j.bbl];
    if (!rec || s.holdings[j.bbl] || s.built[j.bbl]) continue;   // you bought the site out from under them
    const cmix = devMix(j.use as DevUse);
    s.built[j.bbl] = {
      class: dominantOf(cmix), mix: cmix, bldgArea: j.sf, floors: j.floors,
      yearBuilt: 2000 + Math.floor(s.month / 12),
    };
    s.cityBuilt.push(j.bbl);
    // If it had a name on it, the name now owns a building.
    if (j.firmId) jobDelivered(s, parcels, j.bbl, j.firmId, j.cost ?? 0);
    // NOTE: no addStock here. The square feet went into the econ pipeline the
    // month the job STARTED and land in the citywide stock when its cohort
    // matures — counting them again on delivery would double the building.
    bumpLand(s, j.bbl, 1.05);
    for (const nb of adjacency?.[j.bbl] ?? []) bumpLand(s, nb, 1.03);
    if (!j.firmId && rng(s) < 0.55) {
      s.news.unshift({
        q: s.month, kind: "info",
        text: j.floors >= 8
          ? `A ${j.floors}-story ${j.use} building opened at ${rec.address}.`
          : `New ${j.use} construction delivered at ${rec.address}.`,
      });
    }
  }
  s.cityJobs = still;

  // ---- starts --------------------------------------------------------------
  // NOBODY BUILDS BELOW REPLACEMENT COST.
  //
  // The pipeline was governed by the phase of the cycle and nothing else, so a
  // class could sit at twenty-five per cent vacancy with buildings trading at
  // two thirds of what it costs to put them up, and the cranes kept turning.
  // That is not a thing that happens. When finished product trades under
  // replacement cost, development stops — at any interest rate, in any phase —
  // because you would be manufacturing a loss, and that is the only mechanism
  // that has ever ended a glut.
  //
  // It is a smooth brake rather than a cliff: at parity the market builds at
  // its normal rate, at 0.85x it has nearly stopped, and above 1.15x it is a
  // boom, which is exactly the overshoot that creates the NEXT glut.
  const vtr = cityValueToReplacement(s);
  // RECENTRED. The first cut of this braked on (vtr - 0.80) / 0.25, which
  // reads fine until you measure where the ratio actually sits: median 0.71
  // across real runs, so the brake pinned at its 0.05 floor and shut the
  // pipeline for good. A brake that is always fully on is not a brake, it is
  // a wall — and it made the demand model's starvation worse. Same mechanism,
  // same thirteen-fold swing across the cycle, centred where the game lives.
  const brake = Math.max(0.12, Math.min(1.5, (vtr - 0.55) / 0.45));
  const rate = (START_RATE[s.econ.phase] ?? 0.1) * brake;
  // THE STREET'S JOBS COME OUT OF THIS QUOTA, NOT ON TOP OF IT.
  //
  // A firm that broke ground on its own land this month has already added that
  // building to the city. Counting it and then building the full anonymous
  // quota as well put roughly half again as much construction into a town
  // whose start rate was calibrated against its vacancy — every extra delivery
  // bumped its own land and its neighbours', the whole map inflated, and both
  // the player and the street ended a century four times richer for no reason
  // anyone earned. The city grows at the rate the market supports; who owns
  // the cranes is a different question.
  // Named starts are banked against the quota rather than merely netted off
  // the month they happen: the rate is a third of a building a month, so a
  // month in which two firms broke ground cannot absorb them, and clamping at
  // zero silently let the overflow through. The debt is worked off over the
  // following months, which is also how a real pipeline behaves — a burst of
  // starts is followed by a quiet stretch.
  const named = (s.cityJobs ?? []).filter((j) => j.startM === s.month && j.firmId).length;
  s.startDebt = Math.min(24, (s.startDebt ?? 0) + named);

  // WHAT THE MARKET ASKED FOR, SPENT ON ACTUAL LOTS.
  //
  // The rate above used to be the whole story, and it had nothing to do with
  // the square footage the space market was simultaneously adding to rents in
  // an anonymous queue. Now that queue is a debt (econ.startOwed) and this is
  // where it gets worked off: enough cranes to cover the floor area the market
  // has demanded, at whatever size the sites around here actually carry.
  //
  // The phase rate and the replacement-cost brake still matter — they cap how
  // fast the debt can be worked off, so a boom cannot break ground on five
  // years of demand in one month, and a market below replacement cost stops
  // building even with a backlog. That is the whole cycle: demand accumulates,
  // cranes appear, then a quiet stretch while it is absorbed.
  const owed = s.econ.startOwed
    ? Object.values(s.econ.startOwed).reduce((a, v) => a + Math.max(0, v), 0) : 0;
  // a typical city building here, so the budget converts to a crane count.
  // 42,000 sf was right when infill was sized off the zoning envelope; under
  // the cornice-datum cap the measured median city building is ~26,000 sf, and
  // leaving the old figure in place silently halved the square footage the
  // space market ordered. The market's demand arrives as more, smaller
  // buildings now — which is what a low town growing visibly looks like.
  const TYPICAL_SF = 26_000;
  const wanted = owed / TYPICAL_SF;
  // The phase rate now only shapes URGENCY — capacity and the replacement-cost
  // brake are the real constraints, because in reality the space market's
  // appetite is what drives construction and there is no separate metronome
  // sitting above it. Left as a hard ceiling it throttled the pipeline below
  // what the economics justified and the unbuilt backlog grew in 87% of
  // months, reaching 8.1M sf — sixty per cent of the entire city, permanently
  // demanded and never built.
  const ceiling = Math.max(0.6, rate * 8);
  // AND THE TOWN ONLY HAS SO MANY CONTRACTORS.
  //
  // A backlog cleared at full speed put twenty-nine cranes up at once, which
  // is a boomtown, not a harbour city of sixteen hundred lots. The real
  // constraint is not demand, it is capacity: there are only so many general
  // contractors, tower cranes and steel crews in a town this size, and when
  // they are all working the next job waits its turn. That is why real
  // construction booms show up as cost escalation and schedule slippage rather
  // than as unlimited simultaneous starts.
  //
  // Scaled to the size of the place, so a bigger city carries more of them.
  const capacity = Math.max(4, Math.round(bbls.length / 165));
  const live = (s.cityJobs ?? []).filter((j) => !j.orphaned).length;
  let n = Math.min(wanted, ceiling, Math.max(0, capacity - live));
  n = Math.floor(n) + (rng(s) < n % 1 ? 1 : 0);
  const paid = Math.min(n, s.startDebt ?? 0);
  s.startDebt = (s.startDebt ?? 0) - paid;
  n -= paid;
  // the town matures: later buildings are bigger than the first ones
  const maturity = Math.min(1, s.month / 780);

  while (n-- > 0) {
    // sample a handful of candidates, build on the most in-demand of them
    let best: { bbl: string; rec: (typeof parcels)[string] } | null = null;
    let bestScore = -1;
    for (let i = 0; i < 36; i++) {
      const bbl = bbls[Math.floor(rng(s) * bbls.length)];
      if (s.holdings[bbl] || s.built[bbl] || s.developments[bbl]) continue;
      if (s.cityJobs.some((j) => j.bbl === bbl)) continue;
      // A NAMED FIRM'S DIRT IS NOT THE CITY'S TO BUILD ON. Two owners on one
      // parcel is the invariant this broke: the anonymous picker took any
      // vacant lot, a developer then claimed the job on it, and the deed was
      // suddenly on two balance sheets. Their own land is built on by them,
      // in `startOwnJob`, which is where a land bank is supposed to go.
      if (ownerOf(s, bbl)) continue;
      // Resolved, not static: a lot that has had a building DELIVERED on it is
      // no longer vacant, and the static table still says it is.
      const rec = resolveRec(parcels, s, bbl);
      if (!rec || rec.class !== "land" || rec.lotArea < 1500) continue;
      // the city builds where the neighbourhood has BECOME good, not where it
      // started good — which is how your first tower pulls the market to you
      const score = demandNow(s, rec) + rng(s) * 25;
      if (score > bestScore) { bestScore = score; best = { bbl, rec }; }
    }
    if (!best) continue;
    const { bbl, rec } = best;
    const dNow = demandNow(s, rec);
    let use = useForZone(rec.zoneDist, dNow, rng(s));
    // A corner that carries twenty floors does not get a two-storey shop on
    // it: it gets shops at grade with something above them.
    if (use === "retail" && retailWantsMixed(rec)) use = "mixed";
    const cmix = devMix(use);
    // Nobody builds into a glut. The class this site would be has to want the
    // space before a shovel moves, which is the single link that turns the
    // supply side from a metronome into a market.
    const lead = dominantOf(cmix);
    if (rng(s) > Math.min(1, classAppetite(s, lead) * 0.85)) continue;

    const farMax = farMaxFor(rec);
    // young town builds small; a mature one builds to the envelope
    const frac = Math.min(0.95, 0.22 + 0.45 * maturity + 0.3 * (dNow / 100) * maturity + rng(s) * 0.15);
    let sf = Math.max(3000, Math.round((rec.lotArea * farMax * frac) / 100) * 100);
    let floors = Math.max(1, Math.round(sf / (rec.lotArea * 0.62)));
    // THE CITY BUILDS TO ITS OWN CORNICE LINE. Sized off the envelope alone, a
    // three-storey town broke ground at a median of fifteen floors. The datum
    // cap is what makes twenty years of growth read like twenty years.
    const infill = cityInfillCap(s, parcels, rec, maturity);
    if (floors > infill) {
      floors = infill;
      sf = Math.max(3000, Math.round((rec.lotArea * 0.62 * floors) / 100) * 100);
    }
    // …and where it IS a shop, it is two storeys, with the area cut to match
    // rather than the same square footage squeezed into a taller-than-legal
    // plate. Capping floors alone would have kept the absurd density.
    const cap = MAX_FLOORS_BY_USE[use];
    if (cap !== undefined && floors > cap) {
      floors = cap;
      sf = Math.max(3000, Math.round((rec.lotArea * 0.62 * floors) / 100) * 100);
    }
    const [bLo, bHi] = BUILD_MONTHS[lead];
    const months = Math.round(bLo + rng(s) * (bHi - bLo));
    const deliverM = s.month + months;
    s.cityJobs.push({ bbl, use, sf, floors, startM: s.month, deliverM });
    noteRecordPlan(s, parcels, bbl, lead, sf, floors, "The city");

    // Into the pipeline the day the hole is dug: the Economy page's delivery
    // schedule and forward vacancy are reading this queue, so what is coming
    // is visible for years before it lands.
    if (!s.econ.cohorts) s.econ.cohorts = { office: [], retail: [], multifamily: [], industrial: [] };
    for (const [u, share] of Object.entries(cmix)) {
      const usf = Math.round(sf * (share as number));
      if (usf > 0) {
        s.econ.cohorts[u as BuiltClass].push({ m: deliverM, sf: usf });
        // and the market's order is that much closer to filled
        if (s.econ.startOwed) {
          s.econ.startOwed[u as BuiltClass] = Math.max(0, (s.econ.startOwed[u as BuiltClass] ?? 0) - usf);
        }
      }
    }

    // Before it is anonymous, it is offered to the street. A developer with
    // the dry powder buys the dirt and puts their name on the crane; if
    // nobody takes it, the city builds it the way it always did.
    const nearPlayer = (adjacency?.[bbl] ?? []).some((a) => !!s.holdings[a]);
    const claimed = claimJob(s, parcels, bbl, use, sf, floors, deliverM, nearPlayer);
    if (!claimed && rng(s) < 0.4) {
      s.news.unshift({
        q: s.month, kind: "info",
        text: `Ground broken at ${rec.address} — ${(sf / 1000).toFixed(0)}k sf of ${use}, due ${monthLabel(deliverM)}.`,
      });
    }
  }
}

export function bumpLand(s: GameState, bbl: string, mult: number) {
  s.landAdj[bbl] = Math.min(4, (s.landAdj[bbl] ?? 1) * mult);
}

/**
 * HOW SMALL AND HOW LARGE A SPACE CAN BE.
 *
 * Setting the unit count is a real programming decision and it has physical
 * bounds. You cannot put ten shops in three thousand square feet — a shop
 * needs frontage, a lavatory, a back of house and a door onto the street, and
 * two thousand feet is the floor for any commercial tenancy. Nor can you sell a single
 * "unit" that is an entire two-hundred-thousand-foot tower and call it a
 * building of one: at the top end you are describing a single-tenant
 * headquarters, which is a real product and a rare one.
 *
 * Flats are the tightest band in the book, because a flat is a flat: a studio
 * is about four hundred and fifty feet and anything past two thousand is a
 * penthouse, not a unit type you programme a whole building around.
 */
export const SUITE_BOUNDS: Record<BuiltClass, { min: number; max: number; typical: number }> = {
  // 2,000 sf is the floor for any commercial tenancy — see COMMERCIAL_SUITE_MIN
  // in leasing.ts. Below it you are describing a kiosk or a serviced desk.
  office:      { min: 2_000, max: 60_000,  typical: 4_500 },
  retail:      { min: 2_000, max: 30_000,  typical: 3_200 },
  industrial:  { min: 5_000, max: 200_000, typical: 25_000 },
  multifamily: { min: 450,   max: 2_200,   typical: 850 },
};

/** The legal range of unit counts for a given amount of floor area in a use. */
export function unitRange(useSfArea: number, use: BuiltClass): { min: number; max: number; typical: number } {
  const b = SUITE_BOUNDS[use];
  const sfArea = Math.max(0, useSfArea);
  return {
    min: Math.max(1, Math.floor(sfArea / b.max)),
    max: Math.max(1, Math.floor(sfArea / b.min)),
    typical: Math.max(1, Math.round(sfArea / b.typical)),
  };
}

/**
 * A unit count, turned back into the sf-per-space the engine actually uses,
 * clamped to what is physically possible.
 */
export function suiteSfForUnits(useSfArea: number, use: BuiltClass, units: number): number {
  const b = SUITE_BOUNDS[use];
  const r = unitRange(useSfArea, use);
  const n = Math.max(r.min, Math.min(r.max, Math.round(units)));
  return Math.max(b.min, Math.min(b.max, Math.round(useSfArea / Math.max(1, n))));
}
