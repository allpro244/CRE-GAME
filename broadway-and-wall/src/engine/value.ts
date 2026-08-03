// Valuation: honest economics, legible causality. Value = NOI ÷ cap rate;
// land = lot area × evolved land $/sf. Every number here is traceable from
// the parcel record and the market state — no hidden multipliers.
import type { ParcelRecord } from "@/data/types";
import type { Condition, Econ, GameState, Holding, Sector } from "./types";
import type { BuiltClass } from "./types";
import { blend, blendBy, commercialShare, uses, useSf } from "./mix";
import { industryStress } from "./market";

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** The most envelope any ground in this city will ever carry, however it is
 *  rezoned and whatever the board grants. The generator's own maximum is 37. */
export const FAR_CEILING = 40;

/**
 * THE DEMAND SCORE IS A SCALE, NOT A PRICE.
 *
 * The pipeline reshapes raw location gravity with a gamma before it writes
 * `demandScore`, because the linear blend it used to write was a plateau: the
 * median lot in New Alden read 63 out of 100 and a third of the city read over
 * 70, so every block looked like a good block. The reshaped score has a median
 * of 41 and a top decile that starts at 85, which is what land actually looks
 * like — and it is the number on the panel and under the demand lens.
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
const DEMAND_GAMMA = 1.9;   // must match DEMAND_GAMMA in pipeline/process.mjs
export function demandIdx(demandScore: number): number {
  return Math.pow(Math.max(0, demandScore) / 100, 1 / DEMAND_GAMMA);
}
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
const ABS_MAX_FLOORS_V = 90;
/** The tallest structure a plate this size can carry: slenderness, and core. */
export function physicalMaxFloors(plateSf: number): number {
  if (plateSf < 400) return 1;                       // below this it is not a building
  const slender = 1.2 * Math.sqrt(plateSf);          // MAX_SLENDERNESS / FLOOR_HEIGHT_FT
  // The core ramp: a 1,200 ft² plate carries about six floors, and the ability
  // to serve height grows roughly linearly with the area left over after the
  // core takes its fixed bite.
  const core = 1 + (plateSf - 400) / 135;
  return Math.max(1, Math.min(ABS_MAX_FLOORS_V, Math.floor(Math.min(slender, core))));
}

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
/** How much of a floor the core, the risers and the corridor take. */
function coreLoss(plateSf: number): number { return 0.07 + 420 / Math.max(400, plateSf); }
const REF_CORE_LOSS = coreLoss(REF_PLATE_SF);
/** Rentable feet per gross foot built, against the median plate. */
export function plateEfficiency(plateSf: number): number {
  return clamp((1 - coreLoss(plateSf)) / (1 - REF_CORE_LOSS), 0.78, 1.14);
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
export function plateRentMult(rec: { bldgArea: number; floors: number }, use: BuiltClass): number {
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

export function landPsfNow(rec: ParcelRecord, econ: Econ): number {
  return rec.landPsf * siteQualityMult(rec) * econ.landIdx * (1 + 0.22 * demandBeta(rec.demandScore) * econ.cycleDev);
}

export function landValue(rec: ParcelRecord, econ: Econ): number {
  return rec.lotArea * landPsfNow(rec, econ);
}

export const CONDITION_RENT_MULT: Record<Condition, number> = {
  worn: 0.82, standard: 1.0, good: 1.2,
};

// A condition that isn't one of the three silently produced NaN rent, which
// then propagated through NOI, value, DSCR and the lender's sizing without a
// single error. Numbers that quietly become NaN are worse than numbers that
// throw, so this collapses to the honest middle instead.
function condMult(c: Condition): number {
  return CONDITION_RENT_MULT[c] ?? 1.0;
}

export function initialCondition(rec: ParcelRecord): Condition {
  if (rec.yearBuilt >= 2000) return "good";
  if (rec.yearBuilt >= 1965) return "standard";
  return "worn";
}

// Location multiplier on citywide class rent: demand is the location. Reads
// the gravity, not the display scale — see demandIdx above.
export function locationRentMult(rec: ParcelRecord): number {
  return 0.62 + 0.76 * demandIdx(rec.demandScore);
}

export function marketRentPsfYr(rec: ParcelRecord, econ: Econ, condition: Condition): number {
  if (rec.class === "land") return 0;
  // The blended rent of a building that is shops below and flats above is the
  // area-weighted average of the shop market and the flat market. There is no
  // third market it belongs to.
  // ...and each of those markets pays for the floor plate it is getting. See
  // plateRentMult: an office or a shed cares enormously about a big regular
  // floor, a flat does not care at all.
  return blendBy(rec, (u) => (econ.rentIdx[u] ?? 0) * plateRentMult(rec, u)) * locationRentMult(rec) * condMult(condition);
}

/** What one component of a building rents for, in its own market. */
export function useRentPsfYr(rec: ParcelRecord, econ: Econ, condition: Condition, use: BuiltClass): number {
  return (econ.rentIdx[use] ?? 0) * plateRentMult(rec, use) * locationRentMult(rec) * condMult(condition);
}

// A delivered development overrides the static record — resolve before use.
// So does the neighbourhood: a block's demand drifts with what gets built and
// occupied around it (see engine/demand.ts), and every reader of demandScore
// below this line gets the live number without knowing the model exists.
export function resolveRec(parcels: Record<string, ParcelRecord>, s: GameState, bbl: string): ParcelRecord | null {
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
    let extra = 0;
    let psfSum = rec.lotArea * rec.landPsf;
    for (const [child, parent] of Object.entries(m)) {
      if (parent !== bbl) continue;
      const c = parcels[child];
      if (!c) continue;
      extra += c.lotArea ?? 0;
      psfSum += (c.lotArea ?? 0) * c.landPsf;
    }
    if (extra > 0) {
      const area = rec.lotArea + extra;
      const grown = resolveBase(s, { ...rec, lotArea: area, landPsf: psfSum / Math.max(1, area) });
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
  if (!b && !adj && !dd && zx === 1 && !vr && !marked) return rec;
  const out = { ...rec };
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
  if (dd) out.demandScore = clamp(rec.demandScore + dd, 2, 100);
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

// Achievable rent for NEW leases in a managed building: capital programs and
// the owner's rent stance move it off the pure market number.
export function managedRentPsfYr(rec: ParcelRecord, econ: Econ, h: Holding, use?: BuiltClass): number {
  // A landmarked building is one people care about, and it lets a little
  // better than the market for the rest of its life. That premium is the
  // entire compensation for never being allowed to knock it down.
  // With a use, the rent of that component in its own market. Without one, the
  // blended number the whole building is worth — which is the right answer for
  // an appraisal and the wrong one for a lease.
  let m = use ? useRentPsfYr(rec, econ, h.condition, use) : marketRentPsfYr(rec, econ, h.condition);
  const done = h.programsDone ?? {};
  if (done.lobby !== undefined) m *= 1.04;
  if (done.facade !== undefined) m *= 1.08;
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
const OCC_BASE: Record<BuiltClass, number> = { office: 0.84, retail: 0.89, multifamily: 0.94, industrial: 0.87 };
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
function leaseUpFactor(rec: ParcelRecord, econ: Econ, apt: boolean): number {
  if (!rec.yearBuilt || econ.m === undefined) return 1;
  const nowYr = 2000 + econ.m / 12;
  const age = nowYr - rec.yearBuilt;
  if (age < 0 || age > 4) return 1;
  const span = apt ? 1.6 : 3.2;               // years to stabilised
  if (age >= span) return 1;
  // opens at a fifth let and climbs — the shape of a real lease-up curve
  return clamp(0.2 + 0.8 * Math.pow(age / span, 0.75), 0.2, 1);
}

export function useOccupancy(rec: ParcelRecord, econ: Econ, use: BuiltClass): number {
  const apt = use === "multifamily";
  const swing = apt ? 0.04 : 0.09;
  // fringe empties first: −10pp at demand 5, +6pp at demand 95
  const loc = 0.16 * (demandIdx(rec.demandScore) - 0.6);
  // the building's own character, ±11pp commercial, ±6pp residential — and
  // skewed downward, because the tail of this distribution is a tail of pain
  const u = occHash(rec.bbl + use);
  const idio = (apt ? 0.12 : 0.22) * (u - 0.62);
  // ...and one building in eight is simply TROUBLED: the dark lobby, the
  // unleasable plates, the entrance on the wrong street. These are the 50-65%
  // buildings every market carries, they are persistent, and they are the
  // entire value-add trade — the discount is real and so is the reason.
  const u2 = occHash("trouble:" + rec.bbl + use);
  const trouble = u2 < 0.12 ? (apt ? 0.14 : 0.28) * (1 - u2 / 0.12) : 0;
  const base = clamp(OCC_BASE[use] + swing * econ.cycleDev + loc + idio - trouble, 0.35, 0.99);
  return base * leaseUpFactor(rec, econ, apt);
}
export function occupancy(rec: ParcelRecord, econ: Econ): number {
  if (rec.class === "land") return 0;
  return blendBy(rec, (u) => useOccupancy(rec, econ, u));
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
export const OPEX_CONTROLLABLE: Record<BuiltClass, number> = { office: 9.2, retail: 5.4, multifamily: 13.0, industrial: 2.3 };
export const OPEX_FIXED: Record<BuiltClass, number> = { office: 3.8, retail: 2.6, multifamily: 4.2, industrial: 1.2 };
export const MGMT_FEE = 0.04;   // of effective gross income, industry standard

/** Total operating cost per sf/yr before management fee and property tax. */
export function opexPsf(cls: BuiltClass, econ: Econ, systemsDone: boolean): number {
  return (OPEX_CONTROLLABLE[cls] * (systemsDone ? 0.82 : 1) + OPEX_FIXED[cls]) * econ.costIdx;
}

// Kept for compatibility with anything still asking the old question.
export const OPEX_PSF: Record<BuiltClass, number> = { office: 13, retail: 8, multifamily: 10, industrial: 3.5 };

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
export function capRateFor(rec: ParcelRecord, econ: Econ, condition: Condition): number {
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
  const qualSpread = condition === "good" ? -0.40 : condition === "worn" ? 0.70 : 0;
  return clamp(base + locSpread + qualSpread, 3.2, 13);
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
export function noiYr(rec: ParcelRecord, econ: Econ, condition: Condition): number {
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
    const sf = useSf(rec, use);
    if (sf <= 0) continue;
    const occ = useOccupancy(rec, econ, use);
    const op = sf * opexPsf(use, econ, false);
    rent += sf * useRentPsfYr(rec, econ, condition, use) * occ;
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
  const opexNowPsf = econ ? opexPsf(rec.class as BuiltClass, econ, h.programsDone?.systems !== undefined) : taxPsf;
  let recovered = 0;
  for (const t of h.tenants) recovered += recoveryFor(t, opexNowPsf, taxPsf).tax;
  return Math.max(0, bill - recovered);
}

// in-place NOI from the actual rent roll (owned assets, Phase 3 onward)
export function holdingNOIYr(rec: ParcelRecord, econ: Econ, h: Holding, currentQ: number): number {
  if (h.renovatingUntilM !== undefined && currentQ < h.renovatingUntilM) {
    return -Math.max(0, rec.bldgArea) * 1.2; // dark during the gut
  }
  // A ground-leased lot does not carry: the lessee pays the taxes and the
  // insurance, which is what "absolutely net" means. Its income arrives
  // separately as ground rent, so charging carry here would bill it twice.
  if (rec.class === "land" || !rec.bldgArea) return h.groundLeased ? 0 : -landValue(rec, econ) * 0.012;
  const cls = rec.class as BuiltClass;
  if (cls === "multifamily") {
    // units turn over and things break: a 7% reserve off collections for
    // turns, appliances, roofs. Appraisers skip it; owners never get to.
    const occ = h.occ ?? occupancy(rec, econ);
    const egi = rec.bldgArea * marketRentPsfYr(rec, econ, h.condition) * occ;
    return egi * 0.93 - rec.bldgArea * OPEX_PSF[cls] * econ.costIdx - propertyTaxYr(rec, h);
  }
  // Rent first, then the expense stack, then what comes back through the
  // recovery clauses. Vacant space reimburses nothing and still costs money —
  // that gap is the whole reason occupancy matters more than headline rent.
  const systemsDone = h.programsDone?.systems !== undefined;
  const opexNowPsf = opexPsf(cls, econ, systemsDone);
  const taxBill = grossTaxYr(rec, h);
  const taxNowPsf = taxBill / Math.max(1, rec.bldgArea);

  let baseRent = 0, leasedSf = 0, recoveredOpex = 0, recoveredTax = 0;
  for (const t of h.tenants) {
    leasedSf += t.sf;
    // Recoveries keep running through a free-rent period — free rent is a
    // concession on BASE rent, not on the tenant's share of the boiler.
    const r = recoveryFor(t, opexNowPsf, taxNowPsf);
    recoveredOpex += r.opex;
    recoveredTax += r.tax;
    if (t.freeUntilM !== undefined && currentQ < t.freeUntilM) continue;
    baseRent += t.rentPsf * t.sf;
  }
  const egi = baseRent + recoveredOpex + recoveredTax;
  const opexBill = opexNowPsf * rec.bldgArea;                 // the owner pays it all, then bills it out
  const mgmt = egi * MGMT_FEE;
  return egi - opexBill - mgmt - taxBill;
}

/**
 * The operating statement, line by line, the way it would be presented in an
 * offering memorandum. The number that matters and never gets shown anywhere
 * is `leakage` — the share of the expense bill that no lease reimburses. On a
 * building full of triple-net paper it is nearly nothing; on a gross-leased
 * building in year twelve of an inflation run it is the whole margin.
 */
export function operatingStatement(rec: ParcelRecord, econ: Econ, h: Holding, month: number) {
  const cls = rec.class as BuiltClass;
  const systemsDone = h.programsDone?.systems !== undefined;
  const opexNowPsf = opexPsf(cls, econ, systemsDone);
  const taxBill = grossTaxYr(rec, h);
  const taxNowPsf = taxBill / Math.max(1, rec.bldgArea);
  let baseRent = 0, leasedSf = 0, recOpex = 0, recTax = 0, free = 0;
  for (const t of h.tenants) {
    leasedSf += t.sf;
    const r = recoveryFor(t, opexNowPsf, taxNowPsf);
    recOpex += r.opex; recTax += r.tax;
    if (t.freeUntilM !== undefined && month < t.freeUntilM) { free += t.rentPsf * t.sf; continue; }
    baseRent += t.rentPsf * t.sf;
  }
  const opexBill = opexNowPsf * rec.bldgArea;
  const egi = baseRent + recOpex + recTax;
  const mgmt = egi * MGMT_FEE;
  const noi = egi - opexBill - mgmt - taxBill;
  const billed = opexBill + taxBill;
  return {
    baseRent, freeRent: free, recoveredOpex: recOpex, recoveredTax: recTax, egi,
    opex: opexBill, mgmt, tax: taxBill, noi,
    leasedSf, vacantSf: Math.max(0, rec.bldgArea - leasedSf),
    // what you pay and never bill back, as a share of the whole expense stack
    leakage: billed > 0 ? Math.max(0, billed - recOpex - recTax) / billed : 0,
    opexPsf: opexNowPsf, taxPsf: taxNowPsf,
  };
}

export function assetValue(rec: ParcelRecord, econ: Econ, condition: Condition): number {
  const land = landValue(rec, econ);
  if (rec.class === "land" || !rec.bldgArea) return land;
  // Pre-tax NOI capitalised at the cap plus the tax the OWNER carries. A
  // triple-net building bills its tax bill to its tenants, so loading the full
  // rate onto every class priced net-leased retail as if it paid its own taxes.
  const income = noiYr(rec, econ, condition) / (capRateFor(rec, econ, condition) / 100 + TAX_RATE * taxBorneShare(rec));
  // an underbuilt lot is worth the greater of its income or its dirt
  return Math.max(income, land * 0.92);
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

export function holdingValue(rec: ParcelRecord, econ: Econ, h: Holding, month?: number): number {
  if (rec.class === "land" || !rec.bldgArea) return landValue(rec, econ);
  const quality = month === undefined ? 0 : rollQualitySpread(rec, h, month, econ);
  const cap = clamp(capRateFor(rec, econ, h.condition) + quality, 2.8, 13) / 100;
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
  const contractNoi = holdingNOIYr(rec, econ, h, inGut ? month : Number.POSITIVE_INFINITY);
  const inPlace = contractNoi / cap;                                    // after-tax NOI, plain cap
  const stabilized = noiYr(rec, econ, h.condition) / (cap + TAX_RATE);  // pre-tax NOI, tax-loaded cap
  const blended = inPlace * 0.55 + stabilized * 0.45;
  const abate = month === undefined ? 0 : remainingAbatement(h, month);
  return Math.max(landValue(rec, econ) * 0.92, blended - abate);
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

export function netWorth(s: GameState, parcels: Record<string, ParcelRecord>): number {
  let nw = s.cash;
  for (const h of Object.values(s.holdings)) {
    const rec = resolveRec(parcels, s, h.bbl);
    if (!rec) continue;
    nw += holdingValue(rec, s.econ, h, s.month) - (h.loan?.balance ?? 0);
  }
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
  }
  nw -= s.loc?.balance ?? 0;   // the line is real money owed
  // SECURITY DEPOSITS ARE NOT YOUR MONEY. They arrive as cash at signing and
  // sit in the bank looking exactly like equity until the day the tenant leaves
  // and takes them back. A landlord with a large roll is holding a real
  // liability here, and counting it as net worth is the oldest flattering
  // mistake in the business.
  for (const h of Object.values(s.holdings)) {
    for (const t of h.tenants) nw -= t.deposit ?? 0;
  }
  return nw;
}
