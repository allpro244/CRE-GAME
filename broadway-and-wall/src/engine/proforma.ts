// ONE DEVELOPMENT PRO FORMA.
//
// The land residual (value.ts `residualScheme`, which `landRead` prices every
// lot from) and the Develop desk (dev.ts `planDevelopment`, which the player,
// the named firms' `claimJob` and build-to-suit all underwrite with) are the
// same calculation asked from two ends: the desk takes the price of the dirt
// and asks what the building yields; the residual takes the yield the trade
// requires and asks what the dirt can cost. At breakeven they must cross
// together — a lot whose ask equals its builder residual must read a hurdle of
// exactly 1.0 at the desk, for the residual's own scheme.
//
// They did not. Each had its own stack and every term was written out twice,
// and measured across three seeds and four dates (867 lots with a positive
// residual, planned at the residual's own use/floors/coverage with the land
// bought at exactly the residual) the desk's hurdle ran p05 0.81 / p50 1.10 /
// p95 1.54, with only 13% of lots inside ±3% of breakeven. The tape said
// PENCILS on lots the desk scored 0.71, and said no on lots the desk passed.
// The differences, term by term, and which side was the fact:
//
//   massing      the residual assumed 70% coverage and priced a plate the
//                desk's structure clamp would not draw (53 floors priced, 40
//                buildable); the desk opened at 60% coverage. One massing
//                function now, and the scheme carries its coverage.
//   programme    the desk puts shops at grade under offices and flats where
//                the street carries them (`withStreetRetail`); the residual
//                priced a building with no shops. What gets built is what the
//                desk draws, so the residual prices that.
//   hard cost    the desk carries the GMP contract premium the trade builds
//                under; the residual did not.
//   rent         the desk divided effective rent by asking rent TWICE for its
//                lease-up and commissions (marketRentPsfYr is already
//                effective), and read spot; the residual read `rentExp`.
//   income       the residual used a flat 90/95% occupancy on a plate-blind
//                rent; the desk used `noiYr(..., stabilised)` — the stack the
//                street marks the finished building with. The desk was right:
//                one valuation identity.
//   exit         the residual capitalised at the through-cycle cap with a
//                (1 − recovery) tax load; the desk at the spot cap with
//                `taxBorneShare`. Same tax load now; see UNDERWRITING below
//                for which cap.
//   lease-up     the desk carried the operating-deficit reserve and the
//                residual did not; the residual's carry grew with scheme size
//                and the desk's did not. Both are real costs: both sides pay
//                both now.
//   finance      the residual used a flat 65% LTC at index + 2.1 for 2.5
//                years and no points; the desk used the construction desk's
//                actual advance, coupon, schedule and origination. The
//                residual now borrows from the market's volume desk on the
//                same terms the desk quotes.
//   time         the residual discounted the surplus at 12% for a fixed 2.5
//                years; the desk charged the dirt nothing for the months it
//                sits earning nothing while the building goes up. Land carry
//                at the land rate for the scheme's own schedule, on both.
//
// Everything below is the desk's pro forma, moved here so that value.ts can
// solve it for land. There is no second copy. After: 1,095 lots on the same
// probe, every one at hurdle 1.000; `test/residual-recon.mjs` holds it.
import { bankRatePct, liveSpread } from "./pricing";
import type { ParcelRecord } from "@/data/types";
import type { BtsCommitment, BuiltClass, Contract, DevUse, Econ, UseMix } from "./types";
import { BUILT_CLASSES, CONSTRUCTION_LENDER } from "./types";
import { productOf, layoutProduct, productHardCostBase, productBuildMonths, anchorShare, type ProductKey, type ProductSite } from "./products";
import { normalVac, CITY_STOCK, BUILD_MONTHS, LEASE_TERM_M, forwardVacancy, concessionTarget, CONC_DEPTH, rentTrend12 } from "./market";
import {
  HARD_COST_PSF, SOFT_COST, CONTINGENCY, RETAIL_FLOORS_MAX, INDUSTRIAL_FLOORS_MAX, heightPremium, constructionTypeMult,
  rentableRatio, marketRentPsfYr, opexPsf, locOpexMult, RECOVERY_RATE, MGMT_FEE, noiYr, capRateFor,
  taxRate, taxBorneShare, physicalMaxFloors,
} from "./value";

const clampP = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/**
 * A PROGRAMME, not a class. You do not build "mixed use" — you build shops at
 * grade with offices and flats above, and the budget is the sum of those three
 * jobs. "mixed" here is shorthand for a canonical stack, and the whole of what
 * it means is the mix below: cost, rent, lease-up, lender appetite and
 * neighbourhood effect all follow from the components.
 */
/**
 * WHAT IT COSTS TO TAKE A BUILDING DOWN to clean dirt: about $14/sf of
 * standing floor area at the cost index (abatement, demolition, haul-off;
 * NYC interior-demolition-and-wreck bids run $10-20/sf), and never less than
 * a mobilisation of $60,000. One number for everyone: the player clearing a
 * site (dev.ts demolish) and a pro forma that knocks down what stands on its
 * lot (rivals redeveloping) used to price the same wreck at $14 and $12.
 */
export function wreckCost(bldgArea: number, costIdx: number): number {
  return bldgArea > 0 ? Math.round(Math.max(60_000, bldgArea * 14 * costIdx)) : 0;
}

export const MIXED_STACK: UseMix = { retail: 0.15, office: 0.45, multifamily: 0.40 };

/**
 * HOW MUCH OF THE LOT A NEW BUILDING MAY COVER, BY USE — one limit, read by the
 * Develop desk and the land residual alike.
 *
 * The desk let every use cover 90% of the lot and the residual held offices
 * and flats to 70%, so the desk's land value ran 1.2-1.9x the market's and a
 * lot bought at the residual planned at 1.02-1.07 instead of 1.00 (ECONOMY.md,
 * small-lot diagnosis). One quantity, two answers. The plate here is one
 * footprint carried the full height, so each limit is the share of the lot a
 * typical building of that use actually covers, not the ground floor alone.
 * Facts about codes, with the reading taken stated:
 *
 *   flats       0.70  NYC Quality Housing maximum lot coverage for an interior
 *                     lot is 60-70% (R6 60, R7 65, R8-R10 70; ZR 23-153 as it
 *                     stood before 2024); light-and-air and rear-yard rules hold most
 *                     codes to 60-80%. The top of the interior range.
 *   offices     0.80  Commercial districts carry no coverage cap on a
 *                     commercial building, but above the first storey a 20 ft
 *                     rear yard is required (ZR 33-26): 80% of a 100 ft deep
 *                     standard lot. Full-lot is a base, not a building — a
 *                     tower over it sets back further (C5/C6 tower coverage
 *                     40-50%, ZR 33-45), and the player can draw that lower.
 *   shops       0.85  One and two storeys. The ground floor may run to the lot
 *   sheds       0.85  line (rear-yard permitted obstruction, ZR 33-23 / 43-23)
 *                     and the second storey takes the rear yard; sheds give
 *                     up yard to loading berths (ZR 44-50) rather than light.
 *                     A judgement between the two, the residual's long-standing
 *                     figure.
 *
 * A programme is held to the strictest use in it that stacks: one plate runs
 * the full height, so flats over shops take the flats' rear yard.
 */
export const MAX_COVERAGE: Record<BuiltClass, number> = {
  multifamily: 0.70, office: 0.80, retail: 0.85, industrial: 0.85,
};
/**
 * AND THE LEAST: 60% of the lot (owner, Oct 2026, repeatedly). The desk let a
 * new building take 8%, and its "Tower" preset drew 32% — a shaft on an empty
 * lot that New York does not build: its towers stand on bases brought out to
 * the street (the street-wall rules of the contextual and tower-on-base
 * districts), and the tower-in-a-plaza of the 1961 bonus was retired in 1975.
 * There is no minimum by that name in the Zoning Resolution; this is the base
 * those rules produce. A slender tower is a FORM on top of such a base
 * (citygen/forms.mjs), not a narrow plate. A structure already standing
 * (a reuse, a takeover) keeps the footprint it has.
 */
export const MIN_COVERAGE = 0.6;
/** The site coverage a new building of this programme may take. */
export function maxCoverageFor(use: DevUse, mix?: UseMix): number {
  // A single-use programme is a mix of one: its own limit, without building the mix.
  if (use !== "mixed") return Math.min(1, MAX_COVERAGE[use] ?? 1);
  const m = devMix(use, mix);
  let cap = 1;
  for (const k of Object.keys(m) as BuiltClass[]) if ((m[k] ?? 0) > 0) cap = Math.min(cap, MAX_COVERAGE[k] ?? 1);
  return cap;
}
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
  // The same one-key object as `{ [use]: 1 }`, as a literal shape (a computed key is the slow path).
  switch (use) {
    case "office": return { office: 1 };
    case "retail": return { retail: 1 };
    case "multifamily": return { multifamily: 1 };
    case "industrial": return { industrial: 1 };
  }
  if (use !== "mixed") return { [use]: 1 };
  return custom ? normalizeMix(custom) : { ...MIXED_STACK };
}
export function dominantOf(mix: UseMix): BuiltClass {
  // One pass, not a sort: the first key holding the largest share, which is
  // exactly what a stable descending sort put first. Called on every pro forma.
  let best: BuiltClass | undefined, bv = -Infinity;
  for (const k in mix) { const v = mix[k as BuiltClass] ?? 0; if (best === undefined || v > bv) { best = k as BuiltClass; bv = v; } }
  return best ?? "office";
}
/** Weighted average of a per-use number across a programme. */
/**
 * HOW LONG A NEW BUILDING TAKES TO FILL, against an ordinary market (1.0):
 * availability — the vacancy it opens into, `vacOf`, plus sublet space —
 * against natural, shortened by structural unmet demand (the looking book is
 * already there). Logistic to ~[0.35, 2]; the old clamp pinned its floor half
 * the time. The pro forma reads it at forecast delivery vacancy; a merchant's
 * settlement reads it at the vacancy the building actually opened into
 * (`settleMerchant` in dev.ts) — one curve, two readers.
 */
export function leaseUpMarketAt(econ: Econ, mix: UseMix, vacOf: (u: BuiltClass) => number): number {
  const availability = overMix(mix, (u) =>
    vacOf(u) + (econ.sublet?.[u] ?? 0) / Math.max(1, econ.stock?.[u] ?? CITY_STOCK[u]));
  const naturalAvailability = overMix(mix, (u) => normalVac(econ, u));
  const struct = overMix(mix, (u) => econ.structTight?.[u] ?? 0);
  const leaseRaw = availability / Math.max(0.001, naturalAvailability) - struct * 2.2;
  return 0.35 + 1.65 / (1 + Math.exp(-(leaseRaw - 1) / 0.4));
}

export function overMix(mix: UseMix, f: (u: BuiltClass) => number): number {
  let sum = 0, w = 0;
  // for..in walks a plain object's own keys in Object.keys order, without
  // allocating the array — this runs hundreds of thousands of times a month.
  for (const k in mix) { const u = k as BuiltClass; const s = mix[u] ?? 0; sum += f(u) * s; w += s; }
  return w > 0 ? sum / w : 0;
}
/** How much of a programme carries genuine leasing risk before it is built. */
/** Share of the job that can take a named commercial pre-let. Industrial is
 *  named-tenant space too — excluding it made every shed open empty no matter
 *  how tight the market was while the shell went up. Flats still lease after
 *  C of O, not off a hole in the ground. */
export function specShare(mix: UseMix): number {
  return (mix.office ?? 0) + (mix.retail ?? 0) + (mix.industrial ?? 0);
}
const CONSTR_SPREAD = 2.4;     // over the index, interest-only

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
export function constructionLtc(mix: UseMix, phase: string, creditIdx: number, appetite = 1, spaceTight = 1): number {
  const spec = specShare(mix);
  // flats and sheds are the financeable end of the market
  const safeLtc = 0.70;
  const specLtc = 0.70;
  const base = specLtc * spec + safeLtc * (1 - spec);
  // The label multiplier (0.72 in a recession) priced the credit window a
  // second time: `creditIdx` below already is the window. `phase` is unread.
  void phase;
  const tight = 1;
  // Construction paper in this town is written by the regional bank, and the
  // regional bank has a balance sheet you can read on Research. When it is
  // eating losses it does not tighten the market's terms — it tightens YOURS,
  // and a bank that has stopped lending stops financing buildings first,
  // because a half-built tower is the worst collateral there is.
  const app = 0.5 + 0.5 * appetite;
  // Space-market tightness (vacancy below natural / unmet structural demand)
  // is why banks fund into a shortage — same signal classAppetite already
  // reads. Caps keep this from becoming free leverage in a boom label alone.
  // THE LEGAL CEILING, NOT A HOUSE ONE (2026-10-13). This stacked four caps
  // (appetite 1.05, space 0.9-1.12, window 0.55-1.12, and 0.72 on the lot)
  // and the 0.72 bound 41% of the time: construction leverage could not
  // loosen in a boom, which is half of how real overbuilding happens. What
  // actually stops a bank is the supervisory loan-to-value limit for
  // construction — 80% for commercial and multifamily (Interagency
  // Guidelines for Real Estate Lending Policies, 12 CFR 365 App. A) — so
  // that is the ceiling, and the desk's balance sheet, the space market and
  // the credit window move the advance freely underneath it.
  return Math.max(0, Math.min(0.80, base * tight * app * spaceTight * creditIdx));
}

/** Mix-weighted construction advance boost from class vacancy / structural tightness. */
export function constructionSpaceTight(e: Econ, mix: UseMix): number {
  let w = 0, t = 0;
  for (const u of BUILT_CLASSES) {
    const share = mix[u] ?? 0;
    if (share <= 0) continue;
    const vac = e.cityVac?.[u] ?? normalVac(e, u);
    const gap = vac - normalVac(e, u); // negative = tight
    const struct = e.structTight?.[u] ?? 0;
    // Up to ~12% more advance when the class is short space; asymptotic cap
    // replaces a hard rail that bound 73% of calls at 1.12 (pnpm rails).
    const tightSignal = -gap * 6 + struct * 1.4;
    const boost = Math.max(0.9, 1 + 0.12 * Math.tanh(tightSignal / 0.22));
    t += share * boost;
    w += share;
  }
  return w > 0 ? t / w : 1;
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

export type ConstructionDesk = { name: string; spread: number; points: number; scale: number; cap: number; holdShare?: number; fund?: boolean };
// Built on first use rather than at module load: this module sits in the
// import cycle under value.ts, and CONSTRUCTION_LENDER is not initialised yet
// when it is evaluated.
let DESKS: ConstructionDesk[] | null = null;
export function constructionDesks(): ConstructionDesk[] {
  return DESKS ??= makeConstructionDesks();
}
const makeConstructionDesks = (): ConstructionDesk[] => [
  // Small, cheap, and they remember you: the hometown bank's hold stops at
  // $9M, so on anything bigger it funds its piece and no more.
  // A HOLD LIMIT IS A SHARE OF A BALANCE SHEET, not a number of dollars.
  // This was a flat $9M, which is right for a small local desk in the town
  // that shipped and meaningless in a town four times the size — the same
  // hometown bank, still the hometown bank, but a $9M hold against jobs that
  // cost ten times that is not "they only fund their piece", it is a desk that
  // never appears. 6.4% of its own book is what $9M was against the $140M it
  // used to carry, and the book is now derived from the city (see initLenders),
  // so this follows the town without being told about it.
  { name: "First Harbor Bank", spread: 2.15, points: 0.008, scale: 0.92, cap: 0.65, holdShare: 0.064 },
  // The regional — the historical monopoly desk, and still the volume quote.
  { name: CONSTRUCTION_LENDER, spread: CONSTR_SPREAD, points: 0.010, scale: 1, cap: 0.70 },
  // Committed capital and no depositors: they quote through the cycle, and the
  // coupon is why nobody borrows from them twice unless they have to.
  // The construction-heavy community bank: under the regional on price to win
  // the job, and it keeps a big piece of every one — a fifth of its own book
  // on a single job is the concentration that failed banks carried.
  { name: "Tidewater Community Bank", spread: 2.05, points: 0.009, scale: 1, cap: 0.75, holdShare: 0.20 },
  { name: "Cordage Debt Partners", spread: 4.00, points: 0.020, scale: 1.05, cap: 0.75, fund: true },
];

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

/**
 * THE SPECIFICATION PREMIUM.
 *
 * A budget building and a trophy building on the same lot are not the same
 * project, and the difference is mostly hard cost: the curtain wall, the
 * floor-to-floor, the lift count, the lobby, the plant. Roughly thirty per cent
 * either side of market standard, which is about the real spread between a
 * value-engineered box and a building people want their name on.
 *
 * What the money buys is in `condCeiling` and it is PERMANENT — the building
 * ages more slowly and keeps a higher ceiling forever — plus a better roll,
 * because the tenants who pay the top of the market will not take space in a
 * building that leaks.
 */
export const specCostMult = (spec: number) => 1 + 0.62 * (clamp01(spec) - 0.5);
export const clamp01 = (x: number) => Math.max(0, Math.min(1, x ?? 0.5));

// The buildable envelope, and nothing else. Ashport has no use districts —
// any class on any lot — so the only limit is how much floor area the FAR
// allows, and how much of the lot you choose to cover with it.
// ...WITH ONE EXCEPTION: land zoned for agriculture (the region map's farms)
// carries no building envelope at all until the board rezones it
// (landdev.ts) — the town-wide FAR-2 floor is for town lots, not for a field.
export function farMaxFor(rec: { farMaxComm: number; farMaxRes: number; zoneDist?: string }): number {
  // farmland, and a plat's common land (OS: its parks and pond, landdev.ts hoaRecords), carry no envelope
  if (rec.zoneDist === "AG" || rec.zoneDist === "OS") return 0;
  // A SUBURBAN DISTRICT MEANS WHAT IT SAYS. The town-wide FAR-2 floor is the
  // island's (every downtown lot carries at least a walk-up); a rezoning to
  // R-2 at FAR 0.6 is the board granting houses and two-flats, and flooring it
  // at 2 handed every plat lot a three-storey apartment envelope nobody
  // approved (landdev.ts REZONE).
  if (LOW_DENSITY_ZONES.has(rec.zoneDist ?? "")) return Math.max(rec.farMaxComm, rec.farMaxRes);
  return Math.max(rec.farMaxComm, rec.farMaxRes, 2);
}
/** Districts whose stated envelope is the envelope: the region's suburban residential zones (landdev.ts; an unpacked neighbourhood's R-1, unpack.ts; a farm rezoned for a neighbourhood centre, C-N, towngrowth.ts). */
export const LOW_DENSITY_ZONES: ReadonlySet<string> = new Set(["R-2", "R-1", "C-N"]);

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
 * THE GROUND FLOOR IS SHOPS, AND THAT IS WHERE URBAN RETAIL COMES FROM.
 *
 * Nobody builds a parade of standalone shops in a city with land worth
 * building on — they build the offices and the flats the market wants and put
 * the retail at grade underneath, because the ground floor of a tower is worth
 * more as a shop than as a lobby and the tenants upstairs want somewhere to
 * buy lunch. Almost all the retail floor space added to a dense city in the
 * last century arrived this way.
 *
 * The model had every piece of this and never joined them. `MIXED_STACK` put
 * 15% retail in a building only when a developer explicitly chose "mixed";
 * `capRetail` and `maxRetailShare` already knew retail is a ground-floor thing
 * capped at two plates. But an office or a housing programme carried no retail
 * at all, so the only shops the city ever built were standalone ones — capped
 * at two storeys, and therefore tiny. Measured over fifty years: 27 retail
 * groundbreakings averaging 13,300 sf, against office at 70,200. Retail stock
 * grew 0.04%/yr.
 *
 * MORE LAND DOES NOT FIX THAT, and it was worth checking before building
 * anything, because it was the obvious first idea. The size dial IS more land.
 * Retail stock growth over fifty years: -0.12%/yr on a Hamlet, -0.04% on the
 * standard island, +0.05% on a Great City, and +0.04% on a Great City opened
 * at 42% vacant — four times the island and half again the dirt, and the line
 * does not move. It was never a land constraint. It was a form constraint.
 *
 * THE SHARE IS ONE FLOOR OUT OF N, which is the mechanism rather than a
 * number: a four-storey walk-up is a quarter shops, a forty-storey tower is
 * two and a half per cent, and it falls out of the geometry with nothing to
 * tune. The 1.25 is real — a retail ground floor is taller and deeper than the
 * plates above it, typically 18-22 feet against 11-14, so it is worth more
 * than its share of the stack.
 *
 * IT IS NOT EVERY STREET. Shops need footfall, so this reads the same demand
 * score the rest of the engine prices off. A quiet residential block gets a
 * lobby, which is what a quiet residential block has.
 */
const STREET_RETAIL_DEMAND = 38;   // below this a shop at grade has no trade
export function withStreetRetail(mix: UseMix, floors: number, demand: number, econ?: Econ, force = false): UseMix {
  const lead = dominantOf(mix);
  if (lead !== "office" && lead !== "multifamily") return mix;
  if ((mix.retail ?? 0) > 0) return mix;                 // already a mixed programme
  if (floors < 2) return mix;
  // THE OWNER'S CALL. A developer can programme shops on a quiet street or
  // into a glutted retail market; the market then decides whether they let.
  // `force` is that choice (DevDraft.groundRetail = "on"): the geometry's
  // share, the street's and the market's gates skipped.
  if (force) {
    const share = Math.min(maxRetailShare(floors), 1.25 / floors);
    const out: UseMix = { retail: +share.toFixed(4) };
    const rest = 1 - share;
    const others = Object.entries(mix).filter(([k]) => k !== "retail") as [BuiltClass, number][];
    const tot = others.reduce((a, [, v]) => a + v, 0) || 1;
    for (const [k, v] of others) out[k] = +((v / tot) * rest).toFixed(4);
    return out;
  }
  if (demand < STREET_RETAIL_DEMAND) return mix;
  // ...AND IT IS NOT EVERY MARKET. This rule read footfall and never the
  // retail market itself, so every tower stapled shops onto a street already
  // drowning in them — measured over 80 years, retail stock grew five times
  // faster than retail demand (+41% vs +8%), median retail vacancy ran 15.5%
  // against an 8.5% natural rate, and real retail rents bled −2.6%/yr for
  // fifty years while the by-product kept arriving. A developer facing a
  // glutted street programmes a lobby, amenity space, or a bigger residential
  // ground floor — not another vacant shopfront. The share fades linearly
  // with retail slack and is gone 8pp over natural (shape parameter: the
  // depth at which ground-floor retail visibly stops being programmed —
  // post-2008 and post-2020 corridors — not a fitted number).
  const natR = normalVac(econ, "retail");
  const slack = Math.max(0, (econ?.cityVac?.retail ?? natR) - natR);
  // ...AND WHETHER A SHOP PAYS (2026-10-14). Slack alone let towers keep
  // stapling shopfronts onto a street whose rents had fallen far behind the
  // floors above — retail stock outgrew retail demand and real retail rent
  // halved over sixty years in measured runs. A developer lets the ground
  // floor as a shop when a shop pays at least what the lead use pays per foot,
  // against the two classes' opening relationship; less than that, the share
  // shrinks in proportion (lobby, amenity, more of the lead use).
  const rOf = (k: BuiltClass) => (econ?.effRentIdx?.[k] ?? econ?.rentIdx?.[k] ?? 1);
  const aOf = (k: BuiltClass) => (econ?.effAnchor?.[k] ?? econ?.rentAnchor?.[k] ?? 1);
  const rel = econ ? (rOf("retail") / Math.max(1e-6, rOf(lead))) / Math.max(1e-6, aOf("retail") / Math.max(1e-6, aOf(lead))) : 1;
  const street = Math.max(0, 1 - slack / 0.08) * Math.max(0, Math.min(1, rel));
  const share = Math.min(maxRetailShare(floors), 1.25 / floors) * street;
  if (share <= 0.01) return mix;
  const out: UseMix = { retail: +share.toFixed(4) };
  const rest = 1 - share;
  const others = Object.entries(mix).filter(([k]) => k !== "retail") as [BuiltClass, number][];
  const tot = others.reduce((a, [, v]) => a + v, 0) || 1;
  for (const [k, v] of others) out[k] = +((v / tot) * rest).toFixed(4);
  return out;
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

export function maxFloorsFor(
  rec: { farMaxComm: number; farMaxRes: number; lotArea?: number; lotFront?: number; lotDepth?: number }, coverage: number, use?: DevUse,
): number {
  // THE TOP FLOOR DOES NOT HAVE TO BE A FULL PLATE, AND ROUNDING IT AWAY MADE A
  // BIGGER FOOTPRINT BUILD A SMALLER BUILDING.
  //
  // This was `floor(FAR / coverage)`, which discards the fractional top floor.
  // The floor count then multiplies the footprint, so the loss lands on the
  // area — and because the discarded fraction depends on how coverage divides
  // into FAR, the area is not monotone in coverage at all. On a 10,000 sf lot
  // at FAR 4 it went:
  //
  //     coverage 0.50  ->  8 floors  ->  40,000 sf
  //     coverage 0.60  ->  6 floors  ->  36,000 sf
  //     coverage 0.70  ->  5 floors  ->  35,000 sf
  //     coverage 0.80  ->  5 floors  ->  40,000 sf
  //
  // Widening the footprint from half the lot to seven tenths cost 5,000 sf of
  // building. That is not a trade-off anybody chose; it is a rounding artefact
  // wearing the costume of a design decision, and it is what the owner reported
  // as "the higher of a footprint you use, the smaller the building will be".
  //
  // Zoning caps AREA, not floors. A builder allowed 4.0 FAR who wants a plate
  // covering 70% of the site puts up five full floors and a sixth that is
  // partially set back — which is what the top of a real building looks like
  // and why setbacks exist. So the storey allowance rounds UP, and
  // `planDevelopment` caps the resulting area at the envelope, so the last
  // floor is the part that gives way rather than the whole building.
  const zoning = Math.max(1, Math.ceil(farMaxFor(rec) / Math.max(0.08, coverage)));
  const plate = (rec.lotArea ?? 0) * Math.max(0.08, coverage);
  const physical = rec.lotArea ? Math.max(1, Math.min(zoning, physicalMaxFloors(plate, rec))) : zoning;
  // MAX_FLOORS_BY_USE (dev.ts) is these two, read at call time for the same
  // import-cycle reason as constructionDesks.
  const byUse = use === "retail" ? RETAIL_FLOORS_MAX : use === "industrial" ? INDUSTRIAL_FLOORS_MAX : undefined;
  return byUse === undefined ? physical : Math.min(physical, byUse);
}

// The parcel as it will exist once the building is up — what the rent, the
// cap rate and the leasing costs all have to be read against.
// ...AS IT WILL BE DELIVERED. This took `devMix(use)` and ignored the
// programme actually planned, so the desk charged the shops at grade in hard
// cost and then valued a building without them — and a custom mixed stack was
// valued as the canonical one. The delivered record carries `plan.mix`; so
// does the pro forma now.
export function asBuiltRec(rec: unknown, use: DevUse, sf: number, floors: number, spec = 0.5, mix: UseMix = devMix(use)): ParcelRecord {
  return { ...(rec as object), class: dominantOf(mix), mix, bldgArea: sf, floors, buildSpec: spec } as never;
}


/**
 * THE MARKET'S CONSTRUCTION TERMS — the volume desk, to a borrower it has no
 * history with. This is what a land buyer who is not you can borrow on, and so
 * what the dirt is priced against. It is `constructionQuotes`' regional row:
 * the bank's appetite is the one tickLenders publishes on econ, and the
 * relationship discount — which is yours, not the market's — is held at zero.
 * The credit cycle reaches it through `phase` and `creditIdx`, the space
 * market through `constructionSpaceTight`, and the rate through the index.
 */
export function marketConstructionQuote(econ: Econ, mix: UseMix, costTotal = 0): ConstructionQuote {
  const d = constructionDesks().find((x) => x.name === CONSTRUCTION_LENDER)!;
  return deskQuote(econ, d, mix, costTotal, econ.constructionAppetite ?? 1, 0);
}

/**
 * ONE DESK'S QUOTE. `constructionQuotes` (dev.ts) reads each desk's appetite,
 * relationship and hold off the GameState and asks this; the market quote
 * above asks it with those held at neutral. One formula, two callers.
 */
export function deskQuote(
  e: Econ, d: ConstructionDesk, mix: UseMix, costTotal: number, app: number, rel: number, maxCommit?: number,
): ConstructionQuote & { held: boolean } {
  const tight = Math.max(0, 1 - (e.creditIdx ?? 1));
  const space = constructionSpaceTight(e, mix);
  // The fund prices the cycle instead of leaving it: its advance rate reads
  // through a recession the way its perm sheet does, at its coupon.
  const base = d.fund
    ? constructionLtc(mix, "expansion", Math.max(0.85, e.creditIdx ?? 1), Math.max(0.5, app), space)
    : constructionLtc(mix, e.phase, e.creditIdx ?? 1, app, space);
  const uncapped = Math.min(d.cap, base * d.scale);
  // The 1.1 approximates the interest-reserve gross-up, so the solved
  // commitment lands at the hold size rather than a tenth over it.
  const ltcMax = maxCommit && costTotal > 0 ? Math.min(uncapped, maxCommit / (costTotal * 1.1)) : uncapped;
  // THE SAME PRICE LAW AS THE PERM DESKS (pricing.ts). The fund passes none
  // of the window on — committed capital that prices the cycle into its
  // spread instead of re-pricing with it, which is the whole reason a
  // developer calls them in a crunch — and charges its own thin appetite like
  // anybody else. This desk used to run a private version of the law with a
  // smaller window term and a third of the appetite charge for the fund.
  //
  // AND NOW THE DESK'S OWN COSTS (pricing.ts liveSpread, 2026-10-28): its
  // funding, its loss experience on construction paper, its rationing and its
  // pitch against the other desks, published by tickLenders on econ.deskPx so
  // this file never imports the banks. The fund's ease is its own now: it
  // prices off its own book like every other desk.
  void tight;
  const ratePct = bankRatePct(e.indexRate, liveSpread(e.deskPx?.[d.name], d.spread, "construction"), { rel });
  const open = app >= 0.12 && ltcMax > 0.02;
  return {
    lender: d.name, ratePct, ltcMax: +Math.max(0, ltcMax).toFixed(3), points: d.points, open,
    held: !!maxCommit && ltcMax < uncapped - 0.005,
  };
}

/**
 * UNDERWRITING IS A FORECAST, NOT A MARK.
 *
 * A building planned today is let three or four years from now and sold
 * after that, so what it is underwritten on is the rent the trade expects then
 * and the yield it expects to exit at — not this month's print. `market.ts`
 * made that correction to the start decision first ("DEVELOPERS UNDERWRITE THE
 * RENT THEY EXPECT, NOT THE RENT THAT EXISTS"), and the land residual made it
 * next, with a measurement: underwriting dirt on spot rent capitalised at the
 * spot cap drew every seed down 83-93% over 50 years. The desk still read spot
 * — so at a peak the desk passed deals the tape priced as dear, and in a slump
 * the reverse, and the two disagreed by exactly the cycle.
 *
 * `rentExp` (a 21-month adaptive belief) and `capExp` (a slow memory of the
 * cap) are that expectation. They enter as ratios on the effective-rent and
 * cap indices, so every per-parcel adjustment — location, plate, condition,
 * spec, corner — survives untouched and the NOI stack is exactly `noiYr`'s.
 * The bounds are guards on a ratio of two indices that track each other; they
 * are not meant to bind. `rentMult` is the holder's peak scenario (value.ts).
 */
/** Months from a groundbreak to the middle of its lease-up — the horizon of a delivery forecast. */
const DELIVERY_FORECAST_M = 30;
export function underwritingEcon(econ: Econ, rentMult = 1): Econ {
  // An overlay, not a copy: the three indices are replaced and every other
  // field reads through to the live econ. Spreading the whole econ object
  // here was 60% of the land market's run time.
  const rentIdx = { ...econ.rentIdx };
  const effRentIdx = econ.effRentIdx ? { ...econ.effRentIdx } : undefined;
  const capRate = { ...econ.capRate };
  for (const u of BUILT_CLASSES) {
    const belief = econ.rentExp?.[u] && econ.rentIdx?.[u]
      ? clampP(econ.rentExp[u] / econ.rentIdx[u], 0.55, 1.75) : 1;
    // ...and the concessions the market will be giving when it lets: the
    // package at delivery vacancy against today's (2026-10-12), the ratio
    // `devPencils` prices. Nothing in the pipeline, nothing changes.
    // (`nat`: what the market has normally run at, market.ts normalVac.)
    const nat = normalVac(econ, u);
    const vNow = econ.cityVac?.[u] ?? nat;
    const vAt = econ.stock?.[u] ? forwardVacancy(econ, u) : vNow;
    const conc = (1 - CONC_DEPTH * concessionTarget(vAt - nat))
      / Math.max(0.05, 1 - CONC_DEPTH * concessionTarget(vNow - nat));
    // ...and the rent itself at delivery: where the comps have gone over the
    // last year (market.ts rentTrend12), carried half the ~30 months to the
    // middle of the lease-up — a market study extrapolates the trend and
    // expects some of it to revert [K: half]. This read the city's rent
    // equation at the delivery vacancy (`rentDriftAt`), which no rent follows
    // any more (ONE ECONOMY step 4).
    const drift = econ.stock?.[u] ? Math.exp(Math.max(-0.25, Math.min(0.25, 0.5 * rentTrend12(econ, u) * DELIVERY_FORECAST_M / 12))) : 1;
    const k = belief * rentMult;
    if (rentIdx[u] !== undefined) rentIdx[u] = rentIdx[u] * k;
    if (effRentIdx && effRentIdx[u] !== undefined) effRentIdx[u] = effRentIdx[u] * k * conc * drift;
    const capBelief = econ.capExp?.[u] && econ.capRate?.[u]
      ? clampP(econ.capExp[u] / econ.capRate[u], 0.6, 1.7) : 1;
    if (capRate[u] !== undefined) capRate[u] = capRate[u] * capBelief;
  }
  const uw = Object.create(econ) as Econ;
  uw.rentIdx = rentIdx;
  uw.effRentIdx = effRentIdx;
  uw.capRate = capRate;
  return uw;
}

/**
 * `underwritingEcon` behind a one-entry memo, for the desk's pro formas (the
 * land residual keeps its own). The overlay prototypes the econ it was built
 * on, so it is reused only for that same object, and only while every field
 * the overlay copies or reads — the three indices it rewrites, whole and in
 * key order, and each class's expectation, vacancy, stock, pipeline, unmet
 * demand and trend — is identical to what it was built from.
 */
const UW_COPIED = ["rentIdx", "effRentIdx", "capRate"] as const;
const UW_READ = ["rentExp", "capExp", "cityVac", "stock", "pipeline", "structTight", "classDrvTrend"] as const;
let UW_MEMO: { econ: Econ; rentMult: number; snap: unknown[]; uw: Econ } | null = null;
function underwritingSnap(econ: Econ): unknown[] {
  const e = econ as unknown as Record<string, Record<string, unknown> | undefined>;
  const out: unknown[] = [];
  for (const f of UW_COPIED) {
    const d = e[f];
    out.push(d);
    if (d) for (const k in d) out.push(k, d[k]);
    out.push("|");
  }
  for (const f of UW_READ) {
    const d = e[f];
    out.push(!!d);
    for (const u of BUILT_CLASSES) out.push(d?.[u]);
  }
  return out;
}
/** `underwritingSnap(econ)` equals `snap`, walked in place without building a new one. */
function snapHolds(econ: Econ, snap: unknown[]): boolean {
  const e = econ as unknown as Record<string, Record<string, unknown> | undefined>;
  let i = 0;
  for (const f of UW_COPIED) {
    const d = e[f];
    if (snap[i++] !== d) return false;
    if (d) for (const k in d) { if (snap[i++] !== k || !Object.is(snap[i++], d[k])) return false; }
    if (snap[i++] !== "|") return false;
  }
  for (const f of UW_READ) {
    const d = e[f];
    if (snap[i++] !== !!d) return false;
    for (const u of BUILT_CLASSES) if (!Object.is(snap[i++], d?.[u])) return false;
  }
  return i === snap.length;
}
function underwritingEconOf(econ: Econ, rentMult: number): Econ {
  const m = UW_MEMO;
  if (m && m.econ === econ && Object.is(m.rentMult, rentMult) && snapHolds(econ, m.snap)) return m.uw;
  const uw = underwritingEcon(econ, rentMult);
  UW_MEMO = { econ, rentMult, snap: underwritingSnap(econ), uw };
  return uw;
}

/**
 * THE DIRT EARNS NOTHING WHILE THE BUILDING GOES UP.
 *
 * Land is paid for at the start and the building it carries is worth
 * something at the end, so the site's money is tied up for the whole
 * schedule at the rate the trade applies to land — about 12%, well above
 * what a finished building is priced at, because a site earns nothing while
 * it waits. This was BUILD_DISCOUNT in the residual (1/1.12^2.5 = 0.752, a
 * fixed two and a half years for every scheme) and nothing at all on the desk,
 * which is why the desk passed lots the tape had priced as dear. Now it is the
 * scheme's own schedule on both: a shed that goes up in a year carries its
 * dirt for a year; a tower carries it for three and a half.
 *
 * It is not cash — the site is already paid for — so like the land itself it
 * sits in the basis the yield is measured on, not in the budget.
 */
export const LAND_CARRY_RATE = 0.12;
/** A food retailer's total occupancy cost as a share of sales, median (Karabus survey: 2.43-4.88%, median 3.16%) [S]. */
export const GROCER_OCCUPANCY = 0.0316;
export function landCarryFactor(months: number): number {
  return Math.pow(1 + LAND_CARRY_RATE, Math.max(0, months) / 12) - 1;
}

/** The market's absorption shape, 0.2 + 0.8·(t/N)^0.75, memoised by span — pure. */
const CURVES = new Map<number, Float64Array>();
function absorptionCurve(n: number): Float64Array {
  let c = CURVES.get(n);
  if (!c) {
    c = new Float64Array(n);
    for (let t = 0; t < n; t++) c[t] = Math.min(1, 0.2 + 0.8 * Math.pow(t / n, 0.75));
    CURVES.set(n, c);
  }
  return c;
}

/**
 * The exterior closure's share of a building's hard cost (RSMeans square-foot
 * models, division B20 "exterior enclosure": about 12-18% for mid- and
 * high-rise; 15% taken). A form with more wall per square foot pays for the
 * extra wall in proportion; the rest of the building does not change.
 */
export const EXTERIOR_CLOSURE_SHARE = 0.15;

export interface ProFormaInput {
  use: DevUse;
  floors: number;
  coverage: number;
  contract?: Contract;
  spec?: number;
  custom?: {
    mix?: UseMix; bts?: BtsCommitment; groundRetail?: "auto" | "on" | "off";
    /** The massing is a structure already standing (a conversion, a takeover): no new-build coverage limit. */
    shell?: boolean;
    /** This project's hard cost against the market index — see `projectCostMult` (dev.ts). */
    costMult?: number;
    /** A chosen building form (BuildingDesign.form): floor area kept and facade per sf, against the plain block. */
    form?: { retained: number; skin: number };
    /**
     * A PRODUCT TYPE (products.ts): the scheme is that product's building on
     * its own site plan — one storey, the coverage its car park and truck
     * court leave, its own cost, lease, anchors and cap. `draw` is the demand
     * score of the anchor's trade area (dev.ts tradeAreaDemand), the address
     * an anchored centre's inline shops trade at.
     */
    product?: { key: ProductKey; draw?: number };
  };
  /**
   * The floor area the scheme may reach, as FAR. The desk plans against the
   * legal envelope; the residual against what the city will actually permit
   * (value.ts, `infillShare`). A scheme the residual reports always sits
   * inside both, so the desk draws the same building from it.
   */
  envelopeFar?: number;
  /** The tax abatement to price (citygov.ts); omitted = the council's current one, null = none. */
  abate?: { pct: number; years: number } | null;
  /** The construction desk's quote, sized on the pre-reserve cost. */
  quote: (mix: UseMix, preReserve: number) => ConstructionQuote;
  ltcWanted?: number;
  /** Land is priced as if vacant (appraisal practice): the residual skips demolition. */
  asIfVacant?: boolean;
  /** The holder's peak-rent scenario; 1 everywhere else. */
  rentMult?: number;
  /** underwritingEcon(econ, rentMult), when the caller prices many schemes on one lot. */
  uw?: Econ;
}

export interface ProForma {
  asBuilt: ParcelRecord;
  mix: UseMix;
  floors: number;
  coverage: number;
  gsf: number;
  rentable: number;
  hardCost: number;
  softCost: number;
  demo: number;
  contingency: number;
  leaseUp: number;
  anchorCost: number;
  costTotal: number;
  months: number;
  ltc: number;
  ltcMax: number;
  ratePct: number;
  lender: string;
  points: number;
  commitment: number;
  interestReserve: number;
  pointsCost: number;
  /** Everything in the basis except the dirt: build, reserves, points. */
  nonLandBasis: number;
  stabNoi: number;
  /** Bare exit cap, % — and the tax-loaded yield the mark and the hurdle use. */
  exitCap: number;
  exitYieldPct: number;
  /** The landlord's tax in the first stabilised year after any abatement, and the abatement priced (citygov.ts). */
  taxYr1: number;
  abate: { pct: number; years: number } | null;
  /** Land carry to completion, as a share of the land basis. */
  landCarryRate: number;
  bts?: BtsCommitment;
  btsShare: number;
  /** A product scheme: the type, its site plan, and the tenants signed before ground breaks (unnamed; dev.ts names them). */
  product?: { key: ProductKey; site: ProductSite; anchors: BtsCommitment[]; draw?: number };
}

export function developmentProForma(rec: ParcelRecord, econ: Econ, o: ProFormaInput): ProForma | null {
  if (!rec || !rec.lotArea) return null;
  const spec = o.spec ?? 0.5;
  const contract: Contract = o.contract ?? "gmp";
  if (!Number.isFinite(o.floors) || !Number.isFinite(o.coverage) || !Number.isFinite(spec)) return null;
  const custom = o.custom;
  // A PRODUCT IS ITS OWN SITE PLAN (products.ts). One storey on the coverage
  // its car park, truck court and open ground leave — the downtown massing
  // rules below (the 60% street-wall base, the plate ladder) are about a
  // building on a street, and a centre or a distribution box is not one.
  const prod = custom?.product && !custom.shell ? productOf(custom.product.key) : undefined;
  // the grocer's own store is underwritten on its sales; where they are not known (the islands) there is no such scheme
  if (prod?.key === "grocery" && rec.grocerSales === undefined) return null;
  if (custom?.product && (!prod || prod.use !== o.use)) return null;
  const site = prod ? layoutProduct(prod, rec.lotArea, o.coverage) : null;
  if (prod && !site) return null;
  // The mix has to be known before the height, because a programme that is
  // all shops is a two-storey building whatever the envelope allows.
  const raw = prod ? devMix(prod.use) : devMix(o.use, custom?.mix);
  // ...and before the footprint: the coverage limit is the use's (MAX_COVERAGE).
  // A shell that already stands keeps the footprint it has — a conversion or a
  // half-built takeover is not a new building's massing.
  const cov = site ? site.coverage : Math.max(custom?.shell ? 0.08 : MIN_COVERAGE, Math.min(custom?.shell ? 0.9 : maxCoverageFor(o.use, raw), o.coverage));
  let retailOnly = true;
  for (const k in raw) if (k !== "retail" && raw[k as BuiltClass]) { retailOnly = false; break; }
  const fl = site ? 1 : Math.max(1, Math.min(Math.round(o.floors), maxFloorsFor(rec, cov, retailOnly ? "retail" : o.use)));
  // GROSS AND RENTABLE ARE NOT THE SAME NUMBER, and treating them as one was
  // why assembling paid nothing. Zoning counts gross and the contractor bills
  // gross; you let rentable. The core, the two stairs, the risers and the
  // corridor take a bite out of every floor that is mostly FIXED — so a big
  // plate gives up a tenth of itself and a narrow one gives up a third.
  // A FORM keeps less floor than the block it is cut from (a court, a
  // setback's terraces) and wraps it in more wall: both measured on the
  // form's own tiers (citygen/forms.mjs formMetrics), 1 for the plain block
  // (never above 1: a podium that fills the lot past the scheme's coverage
  // is not floor area the coverage limit lets it have)
  // (a product's form is its site plan: no form, no facade multiplier)
  const formKept = custom?.form && !site ? clampP(custom.form.retained, 0.3, 1) : 1;
  const formSkin = custom?.form && !site ? clampP(custom.form.skin, 0.8, 3) : 1;
  const plate = rec.lotArea * cov * formKept;
  // GROSS is what we store and what zoning/cost read. Rentable is what you
  // let — `rentableRatio`, not the plate-efficiency INDEX (median = 1.0),
  // which is why every new building's income used to be struck on cores.
  const envelope = rec.lotArea * (o.envelopeFar ?? farMaxFor(rec));
  // A product inside its envelope draws its site plan; one the envelope cannot
  // hold (a farm, FAR 0) is not offered — shrinking it would be another building.
  if (site && site.gsf > envelope + 1) return null;
  const gsf = site ? site.gsf : Math.round(Math.min(rec.lotArea * cov * fl * formKept, envelope) / 100) * 100;
  const rentable = Math.round((gsf * rentableRatio(plate, fl)) / 100) * 100;
  if (rentable < 2000) return null;

  // Shops at grade wherever the street will carry them — see withStreetRetail —
  // or wherever the owner says: "on" programmes them regardless, "off" is a
  // lobby. Applied before the cap, so the cap still has the last word.
  // (A product is single-use by definition: nothing is stapled to its ground floor.)
  const groundRetail = custom?.groundRetail ?? "auto";
  const mix = prod ? raw : capRetail(groundRetail === "off" ? raw : withStreetRetail(raw, fl, rec.demandScore ?? 50, econ, groundRetail === "on"), fl);
  const proposedBts = prod?.anchors.length ? undefined : custom?.bts;
  const bts = proposedBts
    && proposedBts.use !== "multifamily"
    && proposedBts.use in mix
    && proposedBts.sf > 0
    ? { ...proposedBts, sf: Math.min(rentable * (mix[proposedBts.use] ?? 0), proposedBts.sf) }
    : undefined;
  // A product's anchors (or its one tenant) are let before the slab, at the
  // product's own share of the building (products.ts).
  const preLet = prod ? Math.max(0, Math.min(1, anchorShare(prod))) : 0;
  const btsShare = bts ? Math.max(0, Math.min(1, bts.sf / Math.max(1, rentable))) : preLet;

  // the budget is the sum of the jobs, not a number attached to a label
  // ...priced on GROSS. You pay for the core; you do not let it.
  const specK = specCostMult(spec);
  // A product is priced as its own job — shell, power, the paved acres and the
  // landscaped ones (products.ts) — and then exactly as every other building:
  // the cost index, the contract, the spec, this site's own bid.
  const hardCost = site && prod
    ? Math.round(productHardCostBase(prod, site) * econ.costIdx * (1 + CONTRACT_PREMIUM[contract]) * specK * (custom?.costMult ?? 1))
    : Math.round(gsf * overMix(mix, (u) => HARD_COST_PSF[u] * constructionTypeMult(u, fl)) * econ.costIdx * heightPremium(fl) * (1 + CONTRACT_PREMIUM[contract]) * specK * (custom?.costMult ?? 1) * (1 + EXTERIOR_CLOSURE_SHARE * (formSkin - 1)));
  const softCost = Math.round(hardCost * SOFT_COST);
  const demo = !o.asIfVacant ? wreckCost(rec.bldgArea, econ.costIdx) : 0;
  const contingency = Math.round((hardCost + softCost) * CONTINGENCY);

  // What the finished building will be underwritten on — see underwritingEcon.
  const uw = o.uw ?? underwritingEconOf(econ, o.rentMult ?? 1);
  const asBuilt0 = asBuiltRec(rec, o.use, gsf, fl, spec, mix);
  // The product travels on the record, as it will on the delivered building
  // (value.ts reads it for the shop depth and the cap), and so does the
  // anchor's draw: an anchored centre's inline shops trade at its trade
  // area's address (value.ts retailDemandOf).
  const draw = prod?.tradeRadiusM && prod.anchors.length ? custom?.product?.draw : undefined;
  const asBuilt = prod
    ? ({ ...asBuilt0, product: prod.key, ...(draw !== undefined ? { retailDraw: draw } : {}) } as ParcelRecord)
    : asBuilt0;

  // THE LEASE-UP RESERVE.
  //
  // A building is not finished when the scaffolding comes down; it is finished
  // when it is full, and getting there costs money that never appears in the
  // headline budget: fit-out for every tenant, commissions to the brokers who
  // found them, and the carry on an empty building for months. Every job is
  // spec, so the whole building carries this — letting it during construction
  // is what claws it back.
  // AND THE OPERATING DEFICIT, WHICH IS THE PART THAT KILLED PEOPLE.
  //
  // The old reserve carried TEN MONTHS of operating cost. A commercial
  // building takes thirty-eight months to fill — that is the lease-up curve
  // the space market itself runs — and for every one of those months the
  // mini-perm charges interest on the whole balance. Ten months of opex on a
  // job carrying a $620k-a-year coupon is not a reserve, it is a down payment
  // on one.
  //
  // Traced end to end: a $11.5M office job delivered on programme, on budget,
  // with $0.6M of contingency handed back. Its reserve ran dry sixteen months
  // later, with the building 65% empty and still filling exactly as the model
  // said it would. The lender took it. Nothing had gone wrong — the budget
  // simply did not contain the cost of owning the thing until it earned.
  //
  // A real development budget carries an operating deficit reserve sized to
  // the gap between debt service and income across the whole absorption
  // period. It is expensive, it is financed, and it is the single biggest
  // reason a marginal deal does not pencil. That is the point.
  const openSf = rentable;
  // apartments have no fit-out, but they do have concessions and marketing
  const tiPsf = prod ? prod.tiPsf : overMix(mix, (u) => (u === "office" ? 32 : u === "retail" ? 22 : u === "industrial" ? 5 : 7));
  // Underwrite the rent tenants actually pay after market-wide concessions —
  // `marketRentPsfYr` already reads the EFFECTIVE index. This used to be
  // multiplied by effRentIdx/rentIdx a second time, so the desk's commissions
  // and its deficit were struck on a rent with the concessions taken off twice.
  const rentPsf0 = marketRentPsfYr(asBuilt, uw, "good");
  // A product's spec space pays its own commission on its own term (products.ts lcPct x termY).
  const lcPsf = prod
    ? rentPsf0 * prod.lease.termY * prod.lcPct
    : overMix(mix, (u) => (u === "multifamily" ? 0 : 1)) * rentPsf0 * 6 * 0.045;
  // LEASE-UP DURATION IS A MARKET NUMBER. The old reserve assumed 19 months
  // for every apartment project and 38 for every commercial project, whether
  // vacancy was 2% or 20%. Scale that observed base duration by availability
  // against natural vacancy: tight markets fill faster; gluts take longer.
  // (A product carries its own observed base [ABS]: a box lets whole, a strip
  // a shop at a time.)
  const baseCarryMonths = prod ? Math.max(1, prod.leaseUpM) : overMix(mix, (u) => (u === "multifamily" ? 19 : 38));
  // ...AT DELIVERY, AND WITH THIS BUILDING IN IT (2026-10-12): the vacancy
  // the scheme will open into — the pipeline already in the ground and the
  // scheme's own floor area (`forwardVacancy`). A tower the size of half the
  // town's office stock prices the glut it would create; nothing else needs
  // to cap it.
  const leaseUpMarket = leaseUpMarketAt(econ, mix, (u) => forwardVacancy(econ, u, rentable * (mix[u] ?? 0)));
  // A BIG SCHEME FILLS AT THE MARKET'S PACE, NOT AT ITS OWN. Tenants arrive at
  // the market's absorption rate; a floor of them a quarter is a strong
  // programme for a big building (which is why Manhattan towers pre-lease for
  // years), so lease-up TIME grows with the scheme, sub-linearly because
  // bigger jobs run bigger leasing programmes. One-sided above the city's
  // typical ~45k sf scheme, so ordinary jobs keep their carry to the digit.
  // The 3x bracket is a guard. (This lived only in the land residual; the desk
  // underwrote a 500k sf tower as if the market would swallow it in one gulp.)
  // (A product's base duration is already for its own size [ABS] — a bulk box
  // lets whole, in one deal — so it takes no size factor; the market's own
  // absorption below still bounds it.)
  const sizeFactor = !prod && gsf > 45_000 ? Math.min(3, Math.pow(gsf / 45_000, 0.7)) : 1;
  // ...AND NEVER FASTER THAN THE WHOLE MARKET TAKES UP SPACE (2026-10-11).
  // The size factor above is measured against a typical scheme, not against
  // the town, and its 3x bracket was binding exactly where it mattered: at an
  // office peak on map 3003 the land residual priced a 90-floor, 1.5M sf tower
  // on one downtown lot — half again the size of the town's whole 3.2M sf
  // office stock — as filling in 114 months, and valued the lot at $4.1B. A
  // building cannot lease faster than the market absorbs space, and that rate
  // is measured (`econ.landQueue[use].absYr`, the class's net take-up plus the
  // stock it replaces, over five years). Assuming the scheme captures ALL of
  // it is the generous case; even so a tower the market cannot swallow now
  // carries the years of empty floors it would really carry, and the
  // operating-deficit reserve sizes the scheme to the town — with no cap on
  // floors anywhere.
  //
  // ...AND THE MARKET THAT FILLS IT IS EVERY TENANT SHOPPING, NOT ONLY THE NEW
  // ONES (2026-10-12). The rate above was net absorption — growth — and a new
  // building does not lease from growth alone: it leases from every tenant
  // whose lease is up, which is how it fills in a flat market (flight to
  // quality; the occupied stock re-lets once a lease term, LEASE_TERM_M).
  // Net take-up alone made the bound a cliff — at a 5-year net of nearly zero
  // every project carried decades of empty floors and nothing pencilled, at
  // exactly zero the bound vanished — and read monthly it shut construction
  // for whole busts (six-town bench: population at year 100 down 15%).
  // Capturing all of the town's gross leasing is still the generous case.
  const fillMonths = overMix(mix, (u) => {
    const net = econ.landQueue?.[u]?.absYr;
    if (net === undefined) return 0;
    const occ = (econ.stock?.[u] ?? 0) * (1 - (econ.cityVac?.[u] ?? normalVac(econ, u)));
    const a = Math.max(0, net) + occ / (LEASE_TERM_M[u] / 12);
    return a > 0 ? (rentable * (1 - preLet) * (u === "multifamily" ? 0.95 : 0.9)) / (a / 12) : 0;
  });
  const carryMonths = Math.round(Math.max(baseCarryMonths * leaseUpMarket * sizeFactor, fillMonths));
  const opex0 = overMix(mix, (u) => opexPsf(u, econ, false) * locOpexMult(rec, econ, u));
  const recovery0 = overMix(mix, (u) => RECOVERY_RATE[u]);
  const stabOcc0 = overMix(mix, (u) => (u === "multifamily" ? 0.95 : 0.9));
  // Mean occupancy across the absorption curve the market actually runs
  // (0.2 + 0.8·t^0.75 over the span) is 0.657 of stabilised. Useful for the
  // opex carry, which is a total; useless for the deficit, which is not.
  const fillOcc = stabOcc0 * 0.657;
  // Debt service during lease-up is interest-only on the takeout, which is
  // sized off construction cost — a circular reference resolved the honest
  // way, by estimating it off the cost known so far rather than pretending it
  // is zero.
  const preReserve = hardCost + softCost + demo + contingency;

  // The construction lender funds construction. It does not refinance the
  // equity you already sank into the ground.
  // The lender's max is the ceiling; how much of it you TAKE is your call.
  // Less debt is a slower clock and a smaller reserve; more is more building
  // per dollar of equity and a harder landing if lease-up runs long.
  //
  // Quoted on the construction cost before the reserves, because the reserves
  // are sized off the leverage and the leverage cannot wait for them. The
  // difference to the desk's own sizing is a rounding error; the difference to
  // the borrower of getting the reserve wrong is the building.
  // ONE VALUATION IDENTITY. Stabilised NOI is the same stack the street marks
  // with (`noiYr(..., true)`), and the exit yield is the same tax-loaded
  // capitalisation `assetValue` uses — read at the underwritten market (see
  // underwritingEcon). BTS overlays the committed share on top of that read.
  // ...LESS WHAT THIS BUILDING DOES TO ITS OWN RENT (2026-10-12). A scheme
  // that adds a fifth of the town's office stock lets into the glut it
  // creates: the concession package at delivery vacancy WITH it against the
  // package without it, taken off its stabilised rent. A shed on a big lot
  // barely moves it; a tower the size of the market prices its own glut.
  const ownConc = overMix(mix, (u) => {
    const nat = normalVac(econ, u);
    const vAt = forwardVacancy(econ, u);
    const vOwn = forwardVacancy(econ, u, rentable * (mix[u] ?? 0));
    return (1 - CONC_DEPTH * concessionTarget(vOwn - nat))
      / Math.max(0.05, 1 - CONC_DEPTH * concessionTarget(vAt - nat));
  });
  const marketStabNoi = noiYr(asBuilt, uw, "good", true)
    - rentPsf0 * rentable * stabOcc0 * Math.max(0, 1 - ownConc);
  let stabNoi = marketStabNoi;
  if (btsShare > 0 && bts) {
    const opex = overMix(mix, (u) => opexPsf(u, econ, false) * locOpexMult(asBuilt, econ, u));
    const recovery = overMix(mix, (u) => RECOVERY_RATE[u]);
    const egiPsf = bts.rentPsf + opex * recovery;
    const btsNoi = rentable * (egiPsf - opex - egiPsf * MGMT_FEE);
    stabNoi = marketStabNoi * (1 - btsShare) + btsNoi * btsShare;
  }
  // THE ANCHORS SIGN BEFORE THE SLAB, AT THEIR OWN RENT (products.ts). A
  // grocer pays about half what the shops behind it pay, for twenty years; a
  // pad's one tenant pays the market for fifteen. Each is a lease like a
  // build-to-suit's (the same NOI stack), and delivery hands each one its
  // space (dev.ts deliver). The inline shops are let at the market — at the
  // address the anchor gives them, which is the co-tenancy (asBuilt.retailDraw).
  const anchors: BtsCommitment[] = [];
  let anchorFree = 0;   // the fixturing months the anchors occupy rent-free, $
  if (prod && site) {
    for (const a of prod.anchors) {
      const each = Math.floor((rentable * a.share) / a.n);
      if (each <= 0) continue;
      // A GROCER PAYS OUT OF ITS SALES (region: rec.grocerSales, towngrowth.ts).
      // Where the trade area's food spending is known, the grocer's rent is
      // what its sales carry: a food retailer's whole occupancy cost — base
      // rent plus the NNN charges — runs a median 3.16% of sales (Karabus
      // food-retail occupancy survey: 2.43-4.88%, median 3.16%; appraisal
      // practice caps grocers' total occupancy near 4%) [S]. The NNN part is
      // what this building recovers from it (the same opex and recovery the
      // NOI stack below charges), so the base rent is the rest. Elsewhere
      // (the islands) it is the inline rent times the product's ratio, as before.
      let rentRaw = rentPsf0 * a.rentRatio;
      if (a.label === "grocer" && rec.grocerSales !== undefined) {
        const nnn = overMix(mix, (u) => opexPsf(u, econ, false) * locOpexMult(asBuilt, econ, u)) * overMix(mix, (u) => RECOVERY_RATE[u]);
        rentRaw = Math.max(0, (GROCER_OCCUPANCY * rec.grocerSales) / (each * a.n) - nnn);
      }
      for (let i = 0; i < a.n; i++) {
        anchors.push({
          name: "", sector: prod.use === "industrial" ? "logistics" : a.label === "big box" ? "apparel" : "food",
          credit: a.credit, use: prod.use, sf: each, rentPsf: +rentRaw.toFixed(2),
          termM: a.termY * 12, tiPsf: a.tiPsf, recovery: "nnn", signedM: econ.m ?? 0, bumpPct: a.bumpPct,
          floors: 1, coverage: cov,
        });
        anchorFree += rentRaw * each * a.freeM / 12;
      }
    }
  }
  const anchorSf = anchors.reduce((t, x) => t + x.sf, 0);
  if (anchorSf > 0) {
    const opex = overMix(mix, (u) => opexPsf(u, econ, false) * locOpexMult(asBuilt, econ, u));
    const recovery = overMix(mix, (u) => RECOVERY_RATE[u]);
    let aNoi = 0;
    for (const x of anchors) {
      const egiPsf = x.rentPsf + opex * recovery;
      aNoi += x.sf * (egiPsf - opex - egiPsf * MGMT_FEE);
    }
    const inlineShare = Math.max(0, 1 - anchorSf / Math.max(1, rentable));
    stabNoi = marketStabNoi * inlineShare + aNoi;
  }
  const exitCap = capRateFor(asBuilt, uw, "good");
  const taxLoad = taxRate(uw) * taxBorneShare(asBuilt);
  const fullYieldPct = exitCap + taxLoad * 100;
  // AN ABATEMENT IS WORTH WHAT IT FORGIVES (citygov.ts: 421-a / ICAP). The
  // building is assessed at full value and billed `1 - pct` of the tax for
  // `years`; a buyer pays the full-tax value plus the present value of the
  // tax not charged, discounted at the building's own all-in yield:
  //   V' = V (1 + t·pct·a(years, y))  =>  y' = y / (1 + t·pct·a)
  // so every reader of the exit yield — the desk's hurdle, the lender's 75%
  // of value, the land residual — sees the same abated value. A job carries
  // the abatement in force when it was planned (`o.abate`, else the
  // council's current one).
  const abate = o.abate !== undefined ? o.abate : econ.gov?.policy.abate ?? null;
  let exitYieldPct = fullYieldPct;
  if (abate && abate.pct > 0 && abate.years > 0 && taxLoad > 0) {
    const y = fullYieldPct / 100;
    const ann = y > 0 ? (1 - Math.pow(1 + y, -abate.years)) / y : abate.years;
    exitYieldPct = fullYieldPct / (1 + taxLoad * abate.pct * ann);
  }
  // The tax the finished building pays in its first stabilised year, after any abatement.
  const taxYr1 = fullYieldPct > 0 ? (stabNoi / (fullYieldPct / 100)) * taxLoad * (1 - (abate?.pct ?? 0)) : 0;

  const cq = o.quote(mix, preReserve);
  let ltcMax = cq.open ? cq.ltcMax : 0;
  // THE BANK APPRAISES THE BUILDING, NOT THE DEVELOPER'S HOPES (2026-10-14).
  // The supervisory ceiling cited in constructionLtc is a loan-to-VALUE limit
  // on the as-completed appraisal (80% for commercial construction, Interagency
  // Guidelines, 12 CFR 365 App. A), and a bank's house limit sits inside it —
  // 65-75% of as-stabilised value is the common term sheet. This desk lent up
  // to 80% of COST whatever the building would be worth, so a scheme worth
  // nine-tenths of its cost borrowed like a good one: measured, 68% of the
  // street's starts were worth less than they cost on their own pro forma
  // the day they broke ground, and half opened under water. The advance is
  // now the lesser of the cost test and 75% of the stabilised value.
  // On the cost the advance is quoted on (before the reserves, as above).
  if (preReserve > 0 && exitYieldPct > 0) {
    const ltvCap = 0.75 * (stabNoi / (exitYieldPct / 100)) / preReserve;
    ltcMax = Math.max(0, Math.min(ltcMax, ltvCap));
  }
  // A bankable lease turns speculative construction into contracted credit.
  // The boost is bounded by anchor share and covenant; it cannot exceed an
  // ordinary senior construction advance.
  // The let share borrows at the credit-lease advance; the rest of the
  // building (shops at grade under an anchored office, say) at what the desk
  // would lend on it spec. Taking the let share alone, as this used to, lent
  // nothing at all against the unlet floors — so an 85%-let office borrowed
  // less than the same building bare.
  if (bts && bts.credit >= 1) {
    const btsAdvance = (bts.credit === 2 ? 0.68 : 0.58) * btsShare + ltcMax * (1 - btsShare);
    ltcMax = Math.max(ltcMax, btsAdvance);
  }
  // ...and so does a product's signed anchor paper, share by share.
  const anchorLet = anchorSf / Math.max(1, rentable);
  if (anchorSf > 0) {
    let adv = 0;
    for (const x of anchors) adv += (x.credit === 2 ? 0.68 : 0.58) * (x.sf / Math.max(1, rentable));
    ltcMax = Math.max(ltcMax, adv + ltcMax * (1 - anchorLet));
  }
  // Math.min(x, undefined) is NaN, and a NaN here does not throw — it becomes
  // the commitment, then the equity, then the firm's cash, and the first thing
  // anyone sees is a balance sheet reading NaN twenty months later. Anything
  // that is not a real number is simply not a request.
  const wanted = Number.isFinite(o.ltcWanted as number) ? (o.ltcWanted as number) : ltcMax;
  const ltc = Math.max(0, Math.min(ltcMax, wanted));
  // ...AND IT PRICES TIGHTER. A construction loan against a signed credit
  // lease is underwritten to the tenant, not to lease-up: pre-leased credit
  // deals are commonly quoted 50-100bp inside spec. Estimate, scaled by how
  // much of the building is let and how good the name is.
  const anchorCut = anchors.reduce((t, x) => t + (x.credit === 2 ? 0.75 : 0.5) * (x.sf / Math.max(1, rentable)), 0);
  const ratePct = bts && bts.credit >= 1
    ? +(cq.ratePct - (bts.credit === 2 ? 0.75 : 0.5) * btsShare).toFixed(3)
    : anchorSf > 0 ? +(cq.ratePct - anchorCut).toFixed(3)
    : cq.ratePct;

  // THE DEFICIT IS AN INTEGRAL, NOT AN AVERAGE.
  //
  // Averaging income across the whole lease-up and comparing it to average
  // debt service reserves nothing, because the stream is deeply negative for
  // eighteen months and positive for twenty, and the two cancel. A reserve
  // sized that way is exactly zero on a job that needs half a million dollars
  // — which is the arithmetic that took the first building. What the reserve
  // has to cover is the SHORTFALL WHILE THERE IS ONE: sum the months the
  // building cannot pay its own coupon, and ignore the months it can, because
  // by then the money has already been spent.
  const dsMonthly = (preReserve * ltc * ((econ.indexRate + 2.1) / 100)) / 12;
  let deficit = 0;
  if (dsMonthly > 0) {
    const curve = absorptionCurve(carryMonths);
    for (let t = 0; t < carryMonths; t++) {
      const occT = stabOcc0 * curve[t];
      const noiT = (openSf * (rentPsf0 * occT - opex0 * (1 - recovery0 * occT))) / 12;
      // Income only rises along the curve, so the first month the building
      // covers its coupon is the last month the reserve has to fund.
      if (noiT >= dsMonthly) break;
      deficit += dsMonthly - noiT;
    }
  }
  deficit = Math.round(deficit);
  const carry = Math.round(openSf * opex0 * (1 - fillOcc) * (carryMonths / 12));
  // TI tracks construction cost. Lease commissions are already a fraction of
  // today's rent (months × rate) — multiplying them by costIdx double-counts
  // a century of rent inflation and made lease-up reserves larger than hard
  // cost late-century, so densify could not clear a structural office short
  // even when stab NOI / build cost cleared the hurdle. Same split
  // `leaseUpValue` already uses for the vacant-building fill cheque.
  const specLeaseUp = Math.round(openSf * (tiPsf * econ.costIdx + lcPsf)) + carry + deficit;
  // The commission on the anchor's lease steps down with the term, as
  // landlord schedules do: the full 2% of rent on the first ten years, half
  // that on the next ten, nothing past twenty. Charged flat on every year, a
  // fifty-year lease paid a whole year's rent to the broker and the longest,
  // best paper on the desk penciled worst.
  const commissionYears = bts ? Math.min(bts.termM / 12, 10) + 0.5 * Math.max(0, Math.min(bts.termM / 12, 20) - 10) : 0;
  // A product's anchors: the same allowance and stepped commission, and the
  // fixturing months they occupy rent-free [LEASE].
  const anchorYears = (termM: number) => Math.min(termM / 12, 10) + 0.5 * Math.max(0, Math.min(termM / 12, 20) - 10);
  const anchorCost = bts
    ? Math.round(bts.sf * bts.tiPsf * econ.costIdx
      + bts.rentPsf * bts.sf * commissionYears * 0.02)
    : anchors.length && prod
      ? Math.round(anchorFree + anchors.reduce((t, x) => t + x.sf * x.tiPsf * econ.costIdx + x.rentPsf * x.sf * anchorYears(x.termM) * 0.02, 0))
      : 0;
  const leaseUp = Math.round(specLeaseUp * (1 - btsShare));
  const costTotal = hardCost + softCost + demo + contingency + leaseUp + anchorCost;

  // Foundations, core, facade and fit-out: use the same class schedule the
  // market's delivery controls are calibrated to, then move toward its slow
  // end as height rises. The old player-only `10 + floors*0.85` made a
  // fourteen-storey office a 22-month job while every other office builder
  // took 30–44; after unifying the hurdle that split showed up immediately as
  // a 21-month breaks→deliveries cycle.
  const scheduleClass = dominantOf(mix);
  const [monthsLo, monthsHi] = BUILD_MONTHS[scheduleClass];
  const heightShare = Math.max(0, Math.min(1, (fl - 1) / 20));
  // (A product keeps its own schedule [BUILD]: a tilt-up box is not a tower.)
  const months = prod ? productBuildMonths(prod, gsf) : Math.round(monthsLo + (monthsHi - monthsLo) * heightShare);

  // THE INTEREST RESERVE, SIZED TO ACTUALLY DO ITS JOB.
  //
  // A construction lender does not send the borrower a bill. It sizes a pot
  // inside its own commitment, advances the interest to itself out of that pot
  // every month, and takes the whole thing out — principal and capitalised
  // interest together — when the perm lender refinances it at delivery. The
  // borrower's cash goes into the building, not into carry.
  //
  // Sized on the average outstanding balance, grossed up for compounding and
  // for a schedule that runs long. Anything left over is released at delivery.
  // The commitment has to cover its own carry as well as the building, and
  // since the reserve is a function of the commitment and the commitment is a
  // function of the reserve, solve it rather than iterate:
  //     C = ltc * (cost + rC)  =>  C = ltc*cost / (1 - ltc*r)
  const rFrac = costTotal > 0 ? reserveFor(1, ratePct, months) : 0;
  const commitment = Math.round((ltc * costTotal) / Math.max(0.35, 1 - ltc * rFrac));
  const interestReserve = Math.round(reserveFor(commitment, ratePct, months));
  // ORIGINATION IS A COST OF THE PROJECT, not a fee that happens next to it —
  // paid in cash at close and capitalised into project cost by every developer
  // who has ever filled one in. Computed here rather than added to costTotal
  // because the commitment is sized off costTotal.
  const pointsCost = commitment > 0 ? Math.round(commitment * cq.points) : 0;


  return {
    asBuilt, mix, floors: fl, coverage: cov, gsf, rentable,
    hardCost, softCost, demo, contingency, leaseUp, anchorCost, costTotal, months,
    ltc, ltcMax, ratePct, lender: cq.lender, points: cq.points, commitment, interestReserve, pointsCost,
    nonLandBasis: costTotal + interestReserve + pointsCost,
    stabNoi, exitCap, exitYieldPct, taxYr1, abate,
    landCarryRate: landCarryFactor(months),
    bts, btsShare,
    ...(prod && site ? { product: { key: prod.key, site, anchors, ...(draw !== undefined ? { draw } : {}) } } : {}),
  };
}
