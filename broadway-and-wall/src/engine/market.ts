// The market: mean-reverting rate walk, rate-linked cap rates, cyclical
// rents, and a phase machine whose turns are rumored before they land.
// Randomness creates situations, never verdicts.
import { tickBands } from "./bands";
import type { ParcelTable } from "@/data/types";
import type { BuiltClass, Econ, FirmBook, GameState, MarketPhase, NewsItem, Sector } from "./types";
import { OFF_FLOOR_SHARE_NAT } from "./industries";
import { BUILT_CLASSES, SECTOR_CLASSES, raiseAlert } from "./types";
import { tickStreetTenants } from "./tenantBooks";
import { simulateHistory, driftInflTarget, shortIndexFor } from "./regime";
import { swanClassLevel, swanTradeWave, tickSwans, exposureToTrade } from "./swans";
import { whyTrade, why, whyAt, whyMark, whyNation } from "./why";
import { whyVacancy, noteReads } from "./whyReads";
import { whyTown } from "./economy";
import { tickCapRead, tickLandRead } from "./propmarket";
import { settleSupplyDeliveries } from "./supply";
import { readOut } from "./tenantMarket";
import { tickContractors } from "./contractors";

/** Construction materials' real price per log point of real oil (see the cost index) [D]. */
const MATERIALS_OIL = 0.15;

export function mulberry32Step(a: number): { state: number; value: number } {
  a |= 0; a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return { state: a, value: ((t ^ (t >>> 14)) >>> 0) / 4294967296 };
}

/**
 * Named channels for the economic RNG. Cosmetics already use `newsChance`
 * (a separate hash stream). These isolate the load-bearing subsystems from
 * each other so editing how often leasing draws does not reshuffle rival
 * acquisitions and look like a catastrophic rent crash in the baseline.
 *
 * `econ` is the default and mirrors `s.rng` for save/harness compatibility.
 */
export type RngChannel = "econ" | "leasing" | "rivals" | "sales" | "dev" | "lenders" | "owners" | "indust" | "exit" | "land" | "nation" | "shock" | "capital" | "homes" | "growth" | "citygov";
/**
 * THE RENT GROWTH A BUYER UNDERWRITES, in percentage points a year.
 *
 * The contractual bump (a 2% annual step is the standard commercial lease
 * escalator, and it is why US rents did not fall through 2010-15 at 1.5%
 * inflation) or expected inflation when that runs higher. It is one number
 * with two readers: the cap-rate target capitalises against the index less
 * the expected inflation above the bump (see the cap block in tickEcon), and
 * a sponsor's pitch adds the same growth to the going-in yield to get the
 * total return it raises on (rivals.ts, firmEntryPitch). Two answers to what
 * a buyer expects the rent to do would be fake #3.
 */
export const CONTRACT_BUMP_PCT = 2;
/** Expected inflation above the bump, in points — zero at or under target. */
export function inflationOverBumpPct(e: { nat?: { inflExp?: number } }): number {
  return Math.max(0, (e.nat?.inflExp ?? 0.02) - 0.02) * 100;
}
export function underwrittenGrowthPct(e: { nat?: { inflExp?: number } }): number {
  return CONTRACT_BUMP_PCT + inflationOverBumpPct(e);
}

export const RNG_CHANNELS: RngChannel[] = ["econ", "leasing", "rivals", "sales", "dev", "lenders", "owners", "indust", "shock", "citygov"];

/** Seed independent streams from the campaign seed. Called from newGame. */
export function initStreams(seed: number): Record<RngChannel, number> {
  const out = {} as Record<RngChannel, number>;
  for (const ch of RNG_CHANNELS) {
    let h = (2166136261 ^ (seed >>> 0)) >>> 0;
    for (let i = 0; i < ch.length; i++) { h ^= ch.charCodeAt(i); h = Math.imul(h, 16777619); }
    out[ch] = (h >>> 0) || 1;
  }
  // econ channel starts as the historical single-stream seed so a fresh game
  // that only ever calls rng(s) still matches the old opening walk until
  // other channels are drawn.
  out.econ = seed || 1;
  return out;
}

/**
 * Draw from a named stream. Old saves without `streams` keep the single
 * `s.rng` walk — one quantity, no silent re-roll of a mid-campaign save.
 * New games initialize streams in `newGame`; pass a channel when the draw
 * belongs to a subsystem that should not reshuffle the others.
 */
export function rng(s: GameState, channel: RngChannel = "econ"): number {
  if (!s.streams) {
    const r = mulberry32Step(s.rng);
    s.rng = r.state;
    return r.value;
  }
  const cur = s.streams[channel] ?? s.rng;
  const r = mulberry32Step(cur);
  s.streams[channel] = r.state;
  if (channel === "econ") s.rng = r.state;
  return r.value;
}
export const rrange = (s: GameState, a: number, b: number, channel: RngChannel = "econ") =>
  a + (b - a) * rng(s, channel);

/**
 * A DRAW THAT DECIDES ONLY WHAT GETS PRINTED — ON ITS OWN STREAM.
 *
 * News sites were calling `rng(s)` to decide whether to file a line. That is
 * the SAME stream that decides which building sells, whose loan is called and
 * where the crane goes, so a cosmetic decision consumed an economic draw and
 * every later month in the run shifted. Measured: deleting ONE `rng(s) < 0.30`
 * on a teardown notice moved 16 of the 31 numbers in BASELINE.json, none of it
 * because the economy had changed. That makes every news change unverifiable —
 * the baseline can no longer tell "you altered the city" from "you moved the
 * dice" — and it silently couples the newspaper to the market.
 *
 * This is the same fix, and the same reason, as the decoration stream in
 * citygen: removing pier furniture there shifted a landmark's height and an
 * assessed value, because scenery was drawing from the stream the tax roll
 * reads.
 *
 * Stateless and deterministic: hashed off the seed, the month and a caller's
 * key, touching `s.rng` not at all. The key must carry whatever makes the
 * decision distinct — a bbl, a firm id — or two questions in the same month
 * get the same answer.
 */
export function newsChance(s: GameState, key: string, p: number): boolean {
  let h = (2166136261 ^ (s.seed >>> 0) ^ Math.imul(s.month + 1, 0x9e3779b1)) >>> 0;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000 < p;
}
/**
 * Does the player own any of this class? The stake test for anything filed
 * about an ASSET CLASS, as against a trade — `exposureToTrade` in swans.ts
 * answers the trade question and the two are not interchangeable.
 *
 * Read off the holdings rather than the parcel table, because this runs inside
 * the market tick and there are no parcels here: a commercial leg announces
 * itself through its tenants' `use`, and a residential one through `occ`, which
 * only exists on a holding with flats in it.
 */
function ownsClass(s: GameState, k: BuiltClass): boolean {
  for (const bbl in s.holdings) {
    const h = s.holdings[bbl];
    if (!h) continue;
    if (k === "multifamily") { if ((h.occ ?? 0) > 0) return true; continue; }
    for (const t of h.tenants ?? []) if ((t.use ?? "office") === k) return true;
  }
  return false;
}

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
// sublet decision is not a lease decision. (`affordEff`, the lease-speed
// aggregate response it ran beside, is gone: FORMULA_LEDGER #10.)
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
// Ordinary inventory used to run ~0.23% of stock at the median against 1–1.5%
// in a calm US office market, because give-back was only the AGGREGATE mismatch
// and emptied whenever the city wanted what it held. The extremes were right
// (dispersion shows up in busts); the ordinary level was not. A background
// share of occupied was added for that (SUBLET_BG). Since FORMULA_LEDGER #10
// neither the aggregate mismatch nor the background share is here: the
// marketed space is each firm's own floor beyond its own heads' need, so the
// idiosyncratic part is the firms' own fortunes (see the class loop). Direct
// vacancy (cityVac) is unchanged; availability = direct + sublet/stock, which
// is already what rent tightness reads.
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
/** MONTHS FOR NEW DEMAND TO BECOME A SEARCH. A firm decides it needs more
 *  floor on a planning cycle — budget, headcount plan, broker — about three
 *  quarters for an office, two for a shop or a shed operator. A household
 *  that arrives in town is looking the same month and has signed inside two.
 *  Shape parameters, from the length of the process; stated, not fitted. */
/** Shortage-side rent sensitivity relative to office (see `vacTerm`). */
// OFFICE REPRICES AT THE DEAL MARKET'S SPEED, NOT THE LEASE ROLL'S (2026-10-13).
// Office sat at 1.0 on the argument that eight-year leases move asking rent
// slowly — but lease length sets how fast IN-PLACE rent rolls, and this index
// is the rent new deals sign at, which reprices as fast as the deals do. The
// record: Manhattan 1997-2000, vacancy ~5 points under natural, real asking
// +~11%/yr (~2.2%/yr per point); San Francisco 1998-2000, vacancy 1-2%, rents
// about doubled in two years (~5%/yr per point). At 1.0 (0.84%/yr per point)
// a growing city could only raise office rent toward its supply price by
// holding vacancy ~3 points under natural for decades — measured, office
// averaged 8-10% against 11.5% natural and sat under it 65-82% of months, so
// downturns started tight and rarely produced a real repricing. 3.0, as flats:
// ~2.5%/yr per point, the low end of that record. Retail stays at 1.0 for
// want of a comparable source.
const SHORT_SENS: Record<BuiltClass, number> = { office: 3.0, retail: 1.0, industrial: 2.4, multifamily: 3.0 };
const DEMAND_FORM_M: Record<BuiltClass, number> = { office: 9, retail: 6, industrial: 6, multifamily: 2 };
/** MONTHS TO MOVE IN once searching: office tour-to-occupancy including
 *  fit-out ~6 months, a shop ~4, a shed ~3, a flat ~6 weeks. */
const MOVE_IN_M: Record<BuiltClass, number> = { office: 6, retail: 4, industrial: 3, multifamily: 1.5 };
/** MONTHS TO MOVE OUT once space is surplus. Commercial tenants leave at
 *  lease expiry (subletting meanwhile) or by failing; the 2009 record puts a
 *  year's office give-back near 0.35 of the payroll drop, a ~24-month time
 *  constant. Shops and sheds run shorter terms; a renter gives notice. */
const MOVE_OUT_M: Record<BuiltClass, number> = { office: 24, retail: 18, industrial: 18, multifamily: 3 };

/** The typical lease term by class, months — eight years of office paper,
 *  seven of retail, six of industrial, one of housing. */
export const LEASE_TERM_M: Record<BuiltClass, number> = { office: 96, retail: 84, industrial: 72, multifamily: 12 };
/** Months before a building not yet started can deliver: six of planning and the middle of its build (BUILD_MONTHS). */
const SUPPLY_LAG_M: Record<BuiltClass, number> = { office: 27, retail: 29, industrial: 22, multifamily: 30 };
/** The share of a class's leases that roll in a month: what the in-place rent moves at. */
const LEASE_ROLL: Record<BuiltClass, number> = {
  office: 1 / LEASE_TERM_M.office,
  retail: 1 / LEASE_TERM_M.retail,
  industrial: 1 / LEASE_TERM_M.industrial,
  multifamily: 1 / LEASE_TERM_M.multifamily,
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
// RETIRED (2026-10-08): MOM_DEMAND. The class cycle is in each class's
// demand driver now (tenant trades' employment, population), not a momentum
// multiplier on top of it.

/** The share of income renters spend on rent (ACS): the level the household register's opening incomes are solved to. */
export const HH_RENT_SHARE0 = 0.30;
/** Online selling (see ONLINE in the secular block). */
const ONLINE_0 = 0.02;      // share of store-type sales online at the opening (US 2000)
const ONLINE_MAX = 0.4;     // the most of it that can ship (2026-10-17: 0.5 saturated by year 60 in a playthrough)
const ONLINE_TECH = 10;     // logit points per log point of technology: ~11% at year 20 (US 2019), ~24% at 30, ~37% at 50
const ONLINE_COST = 1.5;    // logit points per log point of a shop's rent over a shed's
const ONLINE_GOODS = 0.4;   // share of retail floor selling shippable goods
const ONLINE_SHED = 0.8;    // shed floor gained per unit of online share
const MANUF_FX = 0.1;       // share of factory floor sent abroad a year per unit of log dear dollar
/** Flats per adult: the national headship trend, its response to local job growth over the nation's, and that national job growth (a year). */
const HEADSHIP_TREND = 0.0015;
const HEADSHIP_JOBS = 0.5;
// The nation's payroll growth a year: the trades' 1990-2019 mean less the
// labour-force slowdown (LABOUR_FORCE_SLOWDOWN, below).
const NAT_JOB_TREND = 0.003;
/** A market's normal availability: monthly weight on this month's (twenty-year half-life). */
export const NATVAC_RATE = 1 - Math.exp(-Math.LN2 / 240);


/**
 * INDUSTRIAL EMPLOYMENT SHARE — SECULAR DECLINE.
 *
 * New York, San Francisco and London each lost roughly half their manufacturing
 * floor space between 1970 and 2010. That is ≈ −1.72%/yr, or a monthly factor of
 * 0.5^(1/480). The demand driver for sheds reads `jobIdx * industComp`, so total
 * jobs can still grow while the industrial claim on them shrinks.
 *
 * Sized from that historical record, not from a vacancy target. Where test F
 * (industrial vacancy rails) lands after this is a MEASUREMENT, not a knob.
 *
 * The floor is the residual logistics / last-mile / food-distribution share a
 * dense city keeps after manufacturing has left — not a balance rail. Without
 * it the index drifts toward zero over a long century and the class vanishes
 * as a modelling artefact rather than as a city that still needs warehouses.
 */
// INDUST_COMP_MONTH retired: the -1.72%/yr exodus rate lives on as one era in
// the secular menu (see the SECULAR DEMAND ERAS block), no longer a constant.

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
  // A glut that will not clear: rents still soft, capital still out, and the
  // HUD no longer pretends this is the healing phase.
  depression: { rateGap: -0.95, rentDrift: -0.0022, devDrift: -0.028, nextM: [18, 36], next: "recovery" },
};

// How far the loan index may travel. A century of property covers eras that
// look nothing like each other, and the point of the wider band is that the
// deal you underwrote at 4% has to survive being refinanced at 12%.
// A century of the real thing ran from the zero bound (2008-15, 2020-21, where
// a borrower still paid a term premium over a policy rate of 0.25%) to Volcker
// at twenty per cent. The old 1.9-15.5 band could represent neither end, which
// meant the two most consequential rate environments in modern history were
// both outside what this game could express.

/** The short index, for a save that predates it. */
export { shortIndexFor };
export function shortIndexOf(e: { shortIndex?: number; indexRate: number; creditIdx?: number; nat?: { policy?: number } }): number {
  if (e.shortIndex !== undefined) return e.shortIndex;
  if (e.nat?.policy !== undefined) return shortIndexFor(e.nat.policy, e.creditIdx ?? 1);
  return Math.max(0.05, e.indexRate - 1.40);
}


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
/**
 * HOW FAR A DEVELOPER EXTRAPOLATES THE LAST GOOD YEAR, as a fraction added to
 * the rent they underwrite. Exported because a harness that re-derives it is a
 * second model of it, and this repo has spent a day removing those.
 *
 * `rentExp` is an adaptive lagging belief (a 21-month EMA of the rent index);
 * the gap between it and today's rent is the momentum being extrapolated. Every
 * real overbuild is built out of that gap: three good years become a pro forma,
 * the pro forma becomes a crane, and the crane opens into the glut those pro
 * formas created.
 *
 * NOTE that this deliberately DISAGREES with the land residual, which
 * underwrites `rentExp` itself rather than extrapolating past it. That is not
 * an inconsistency, it is two institutions: a developer chases the trend, and
 * an appraiser prices off closed comparables. Appraisal-based indices are
 * famously smoother than transaction-based ones for exactly this reason. The
 * two were previously written as reciprocal expressions of the same two
 * variables with no comment saying why they pointed opposite ways, which is how
 * a deliberate divergence gets mistaken for a bug.
 */
export function developerOptimism(e: Econ, k: BuiltClass): number {
  const momentum = clamp((e.rentIdx?.[k] ?? 0) / Math.max(1, e.rentExp?.[k] ?? 1) - 1, -0.30, 0.30);
  // Slope at the origin, so the elasticity means what it says where the market
  // spends its time; asymptotes where the old hard clamp used to clip. The
  // asymmetry is the point — developers extrapolate good news further than bad,
  // which is why gluts get built and shortages persist.
  const EXTRAPOLATION = 2.4, OPTIMISM = 0.45, PESSIMISM = 0.28;
  const cap = momentum >= 0 ? OPTIMISM : PESSIMISM;
  return cap * Math.tanh(EXTRAPOLATION * momentum / cap);
}

// The pro forma itself lives in value.ts, with the cost table, the opex table,
// the recovery table and the management fee — the things a pro forma is made
// of. This module cannot import them (value.ts imports this one), and the old
// version's whole defect was that it did not need to: it worked from index
// RATIOS against a single class-blind BASE_YOC and never touched a real
// number. See `devPencils` in value.ts.
import { devPencils, rentableSf, hashNormal } from "./value";
export { devPencils };

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

// Development underwriting lives in value.ts (`devPencils`) and dev.ts
// (`planDevelopment` / `underwriteDevelopment`). There is intentionally no
// class-blind BASE_YOC or debt-index hurdle in the market loop anymore.

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
    // Stock is RENTABLE. Tenants occupy demiseable feet; cores are not vacant
    // office. `bldgArea` stays gross on the parcel (zoning, cost, the map).
    const letSf = rentableSf(r);
    if (m) {
      for (const k of BUILT_CLASSES) out[k] += letSf * (m[k] ?? 0);
    } else if (r.class in out) {
      out[r.class as BuiltClass] += letSf;
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
 * multiplier (`locationRentMult` in value.ts) takes it from here — up to 2.20x
 * for a secondary CBD office and 3.10x for a prime retail pitch, down to 0.40x
 * and 0.34x on the fringe. Density scaling (`densityPriceScales`) then lifts
 * or lowers the whole table for how built-up the generated map is.
 *
 * THE RULE OF THUMB IS A SECONDARY MARKET. Procedural islands are harbour
 * towns and working cities, not a primary CBD. Ordinary office follows
 * Providence Class A asks ($26.71–33.51, market avg ~$29.80 JLL/local 2024)
 * as GROSS rent on a constrained peninsula — $35.50, not a Midtown face rate.
 * Denser build-outs (Harbour / Metropolis) and prime parcels earn more through
 * morphology and location; they do not inherit a primary-city base.
 *
 * Was $43.65: the comment admitted that sat above the Providence band, and a
 * century of wage-tracking then minted ~$110–140/sf real citywide office on
 * mid-rung procedural maps — primary levels on secondary fabric. The level
 * belongs in the opening table; the century path belongs in supply and in
 * `cityClassFactor` (how much chronic-tightness premium a fabric can earn).
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
 * Multifamily at $30.22/sf/yr is $2.52/sf/month, against Providence's ~$2.24 —
 * close enough that moving it would be tuning, not correcting.
 */
export const RENT_BASE = { office: 35.50, retail: 26.00, multifamily: 30.22, industrial: 8.50 } as const; // $/sf/yr
// The natural (frictional) vacancy per class — the rate at which neither side
// of the table has the upper hand. Below it landlords push rents; above it
// tenants extract concessions. Office runs structurally looser than housing.
/**
 * HOW FAR A NET-EFFECTIVE DEAL SITS UNDER THE FACE RENT, per unit of the
 * concession dial. The effective index is asking x (1 - CONC_DEPTH x concIdx).
 *
 * This was 0.14, and 0.14 was not measured against anything — the leasing desk
 * writes its own free-rent and fit-out package on every letter (leasing.ts:
 * `freeM`, `tiPsf`, both driven by the SAME dial), and that package, not a
 * constant, is what a deal actually nets. Measured over four seeds x 15 years,
 * tight markets and a 35%-of-stock glut, 779 deal-months and ~1,400 signed
 * letters, the realised straight-line net effective of signed leases runs, as
 * a discount to the face quote:
 *
 *   median depth by dial   0.06 at conc<0.15   0.18 at 0.35-0.60
 *                          0.24 at 0.60-0.85   0.29 at conc>0.85
 *   deal-weighted fit      depth = 0.075 + 0.212 x conc
 *   through the origin     depth = 0.302 x conc
 *
 * 0.30 is the through-origin fit: it lands the saturated glut on the nose
 * (0.287 against a measured 0.288) and errs by 3pp of rent in a squeeze, where
 * the measured depth is 0.06 and the index says 0.03. That is the right place
 * to spend the error. An intercept would fit the squeeze better and would also
 * mark every asset in the city down 6% in a boom for something that is deal
 * dispersion — growth tenants bidding over the quote, stale space signing
 * under it — rather than a concession the market is granting.
 *
 * A 30% net-effective gap at a saturated dial is not extreme: US office gluts
 * take free rent from ~6 months to 15-20 on a ten-year lease and TI from ~$60
 * to $100-150/sf, which is where the trade quotes 30-40% off face. See the
 * sources in test/glut.mjs.
 *
 * Anything that moves the package in leasing.ts moves this number. `pnpm
 * rent-chart` measures it and fails when the two drift apart.
 */
export const CONC_DEPTH = 0.30;

/**
 * WHERE A TOWN'S MARKETS OPEN: availability by class as US markets have run it
 * over the long run (CBRE / CoStar national series: office ~11.5%, shops
 * ~8.5%, flats ~4.5%, sheds ~7%) [S]. An INITIAL CONDITION — the opening's
 * occupied stock, the pre-game history's starting point, and the normal the
 * town's people carry in their heads before the town has a record of its
 * own (`normalVac`). Nothing reads it after the opening as a cause: since ONE
 * ECONOMY step 4 office, shop and shed rents are the leases landlords and
 * firms sign (tenantMarket.ts), and since FORMULA_LEDGER #4/#5 the flats' are
 * what each block's landlord asks from its own lettings (streetRolls.ts
 * `tickStreetFlats`). This was NATURAL_VAC, the rate every rent in the town
 * was pulled toward, and the flats' MF_NATURAL_VAC.
 */
export const OPENING_VAC = { office: 0.115, retail: 0.085, multifamily: 0.045, industrial: 0.07 } as const;

/**
 * WHAT THIS MARKET'S AVAILABILITY HAS RUN AT — the "normal" its landlords,
 * lenders, developers and appraisers have in their heads, learned from the
 * town's own record (the market tick's `natVac`, a twenty-year memory),
 * from where the town opened. A belief, read by whoever compares today with
 * usual; nothing prices off it (ONE ECONOMY step 4: rents are the leases).
 */
export function normalVac(e: Econ | undefined, k: BuiltClass): number {
  return e?.natVac?.[k] ?? OPENING_VAC[k];
}

/**
 * WHERE THE CONCESSION DIAL IS HEADING, for an availability gap over natural
 * and a phase of the cycle. One function, read by the monthly tick and by the
 * opening of a game, so the town a player walks into is already at the
 * package its own vacancy implies — see `createEcon`.
 */
export function concessionTarget(gap: number, _phase?: Econ["phase"]): number {
  // The package is what a tenant can extract, and that is availability. The
  // label nudge (+0.22 in a recession, -0.10 in an expansion) priced the
  // same slack a second time and stepped when the label flipped. Weighted by
  // how often each label occurred (4 worlds x 50 years) the nudge averaged
  // about -0.01, so dropping it moves the typical package by nothing.
  return clamp(gap * 11, 0, 1);
}

// --- THE CYCLE AS MEASURED (2026-10-09) --------------------------------------
//
// `e.phase` is DATED from payrolls (derivePhase) — a description, the way NBER
// dates a recession. About sixty readers then used that label as a CAUSE,
// through tables keyed on it: a tenant's default hazard jumped 6x, the credit
// target halved, the share of distress on the tape went from 3% to 42%, the
// month payroll growth crossed a threshold. A label cannot cause anything, and
// a step at a threshold is a number nobody measured. These are the quantities
// the label summarised; every former reader reads one of them instead, each
// mapped so that a typical boom and a typical recession land where the old
// table put them — the magnitudes were calibrated, the steps were not.

/** Filled payrolls, trailing twelve months, as a growth rate. */
/**
 * TODAY'S DOLLARS against the opening's (2026-10-13): the seed's opening price
 * level times the town's CPI since. Fixed-dollar floors written in opening
 * money ($500K reserves, $2M lines) bound in every month of play and meant
 * a sixtieth as much by year 100; scaled by this they stay the same real
 * amount.
 */
export function dollarLevel(e: Econ): number {
  return (e.priceLevel ?? 1) * (e.cpi ?? 1);
}

export function payrollGrowth12(e: Econ): number {
  const h = e.history ?? [];
  const then = h.length >= 12 ? h[h.length - 12]?.jobs : undefined;
  if (then && e.jobs) return e.jobs / then - 1;
  // A new game has no year of history yet, but the dating window
  // (`cycHist`, payrolls over the last six months, carried over from the
  // town's pre-history) does: annualise it rather than read the opening
  // month as a stalled economy.
  const c = e.cycHist ?? [];
  if (c.length >= 2 && c[0] > 0) return Math.pow(c[c.length - 1] / c[0], 12 / (c.length - 1)) - 1;
  // No payroll record at all (the pre-history, where the town's labour
  // market IS the nation's): employment grows with the labour force, about
  // 1%/yr, less whatever the unemployment rate has risen — an identity, not
  // a fit.
  return 0.01 - natUnempRise12(e);
}
/** Local unemployment over the town's own natural rate (the matching steady state). */
export function labourSlack(e: Econ): number {
  return (e.unemployment ?? OPENING_UNEMP) - OPENING_UNEMP;
}
/** How far national unemployment has risen over the last year — the national credit signal. */
export function natUnempRise12(e: Econ): number {
  const u = e.nat?.uHist;
  if (u && u.length >= 2) return u[u.length - 1] - u[0];
  const h = e.history ?? [];
  const then = h.length >= 12 ? h[h.length - 12]?.natUnemp : undefined;
  return then !== undefined && e.nat ? e.nat.unemp - then : 0;
}
/** 0..1: payrolls growing at 1.2%/yr or more reads as a full boom. */
export function cycleHot(e: Econ): number {
  return clamp(payrollGrowth12(e) / 0.012, 0, 1);
}
/**
 * 0..1: how much of a downturn this is — payrolls shrinking (1.5%/yr is a full
 * recession) or labour slack lingering (3 points over natural is a recession
 * trough), whichever is worse. A recovery with slack still reads partly down.
 */
export function cycleDown(e: Econ): number {
  return clamp(Math.max(-payrollGrowth12(e) / 0.015, labourSlack(e) / 0.03), 0, 1);
}
/** A class's availability (vacancy + sublet) over what it has normally run at (`normalVac`). */
export function useGap(e: Econ, k: BuiltClass): number {
  return (e.cityVac?.[k] ?? normalVac(e, k)) + (e.sublet?.[k] ?? 0) / Math.max(1, e.stock?.[k] ?? CITY_STOCK[k]) - normalVac(e, k);
}


/**
 * THE FLOOR UNDER VACANCY, and the one rail in this engine that actually binds.
 *
 * Frictional vacancy is space empty purely because tenants are moving in and
 * out, so it scales with how often that happens — and that is not the same in
 * every class. A shed is let whole to one operator who stays a decade; an
 * office floor is carved into suites that churn constantly. Roughly a third of
 * the natural rate, less for industrial.
 *
 * EXPORTED BECAUSE IT IS WATCHED. `tools/baseline.mjs` counts how often each
 * class rests on this floor, and a watcher that mirrors the number it is
 * watching is the third kind of fake — two copies of one quantity, free to
 * drift, with the drift invisible precisely because the watcher is the thing
 * that would have caught it. One definition, two readers.
 */
export function frictionFloor(k: BuiltClass, e?: Econ): number {
  const ratio = k === "industrial" ? 0.22 : k === "multifamily" ? 0.30 : 0.32;
  return normalVac(e, k) * ratio;
}

/**
 * VACANCY AT DELIVERY — what a building started today leases into: today's
 * vacancy, plus everything already in the ground, plus `extraSf` (the
 * developer's own building), less what the market absorbs meanwhile (the
 * unhoused queue and the tenant base's trend growth over a typical 18-month
 * build). A developer's market study counts the competing pipeline and the
 * project itself; so does every reader of this — the class pencil, the site
 * pro forma and the land residual (2026-10-12).
 */
export function forwardVacancy(
  e: Econ, k: BuiltClass, extraSf = 0, monthsAhead = 18,
  /**
   * A developer's own market study (beliefs.ts): the vacancy it believes the
   * class runs at and the demand growth it has seen, a share a month, in place
   * of the true figures it could not know. The stock and the pipeline are
   * public (the assessor's roll, the permits) and stay the town's.
   */
  view?: { vac: number; dg: number },
): number {
  const nat = normalVac(e, k);
  const vacNow = view ? view.vac : e.cityVac?.[k] ?? nat;
  if (!e.stock?.[k]) return vacNow;
  const stkNow = Math.max(1, e.stock[k]);
  const pipe = Math.max(0, e.pipeline?.[k] ?? 0) + Math.max(0, extraSf);
  const occNow = stkNow * (1 - vacNow);
  const queue = Math.max(0, e.structTight?.[k] ?? 0) * stkNow;
  // `monthsAhead`: 18 for a reader pricing the market in general; a developer
  // deciding whether to build reads to its own delivery date (`developerLook`).
  const trendGrowth = Math.max(0, (view ? view.dg : e.classDrvTrend?.[k] ?? 0) * monthsAhead) * occNow;
  return clamp((stkNow + pipe - occNow - queue - trendGrowth) / (stkNow + pipe), 0, 1);
}

/**
 * WHAT THE COMPS DID OVER THE LAST YEAR: the log change in the effective rent
 * the town's leases signed at, twelve months on twelve (the history's
 * `effRent`). What a market study reads when it asks where rent is heading —
 * a trend, not a rule. This replaced `rentDriftAt`, the city's rent equation
 * read at a forecast vacancy, which no rent follows any more (ONE ECONOMY
 * step 4: rents are the leases).
 */
export function rentTrend12(e: Econ, k: BuiltClass): number {
  const h = e.history ?? [];
  const then = h.length >= 12 ? h[h.length - 12] : undefined;
  const a = then?.effRent?.[k] ?? then?.rent?.[k], b = e.effRentIdx?.[k] ?? e.rentIdx?.[k];
  return a && b && a > 0 && b > 0 ? Math.log(b / a) : 0;
}

/**
 * MONTHS A SUITE SITS BETWEEN TENANTS IN AN ORDINARY MARKET. Same clock the
 * player's make-ready uses in leasing.ts — a shop relets faster than a floor,
 * a shed faster than either. The city stock sits on this clock too, or
 * frictional vacancy is a clamp in one place and a residence time in the
 * other.
 *
 * FLATS WERE ON THE SHOPS' CLOCK (2026-10-10): three and a half months dark
 * between households. An apartment turns in about a month — RealPage's "days
 * vacant" runs ~25-40 through the cycle — with a make-ready of one to two
 * weeks. The three and a half months had been standing in for the turnover
 * this model did not have (see TURNOVER_YR): 12.5% of flats turning a year
 * at 3.5 months and 47% at one month both print ~3.7-3.9% frictional, which
 * is why the error never showed in the vacancy.
 */
export function reletMonths(k: BuiltClass): number {
  return k === "office" ? 5.5 : k === "industrial" ? 2.5 : k === "multifamily" ? 1.0 : 3.5;
}

/**
 * THE PART OF A TURN NO QUEUE OF TENANTS CAN SHORTEN — make-ready: paint and
 * clean a flat (one to two weeks), demise and fit out an office floor for
 * the next tenant even when the lease is signed before the last one leaves
 * (~10 weeks for a second-generation suite), re-rack and repair a shed, refit
 * a shop. Months. The rest of `reletMonths` is search, and search is what a
 * tight market shortens.
 */
export const MAKE_READY_M: Record<BuiltClass, number> = { office: 2.5, retail: 1.5, multifamily: 0.4, industrial: 1.0 };

/** Ordinary commercial term. Sector exit rolls on it. */
export const LEASE_TERM_YR = 8;

/**
 * THE SHARE OF OCCUPIED SPACE WHOSE TENANT LEAVES IN A YEAR — the flow that
 * makes frictional vacancy. Commercial space rolls when its lease expires
 * (one eighth a year on an eight-year term) and only the tenants who do not
 * renew leave it dark: office renewal runs about 55% of expiring space (CBRE
 * and JLL lease-expiry studies), shops about 65%, and logistics retention
 * about 75% (Prologis has reported 70-80% for two decades). Flats are let for
 * a year and about 47% of households move out of their unit each year (NMHC /
 * RealPage resident turnover, 2015-2023 range 44-52%).
 *
 * This was every expiry treated as a move-out, at one eighth a year for every
 * class — flats included — which overstated commercial frictional vacancy by
 * the renewal rate and understated flats' turnover four-fold.
 */
const TURNOVER_YR: Record<BuiltClass, number> = {
  office: (1 / LEASE_TERM_YR) * 0.45,
  retail: (1 / LEASE_TERM_YR) * 0.35,
  industrial: (1 / LEASE_TERM_YR) * 0.25,
  multifamily: 0.47,
};

/**
 * ...AND, ONCE THE TOWN HAS A RECORD, WHAT ITS OWN TENANTS DID (2026-10-16):
 * the share of let space the street's firms and households actually handed
 * back over the last two years (streetRolls `turnMeas`) — failures, moves
 * and non-renewals as they happened — rather than the national renewal
 * studies above, which are where a town starts.
 */
export function turnoverYr(e: Econ | undefined, k: BuiltClass): number {
  const m = e?.turnMeas?.[k];
  return m !== undefined && m > 0 ? m : TURNOVER_YR[k];
}

/**
 * Space that is standing but not yet a suite: new deliveries in lease-up.
 * One function so the pool cap, the occupancy cap and a demolition all
 * read the same remaining capacity.
 */
export function darkSfOf(e: Econ, k: BuiltClass): number {
  return Math.max(0, e.darkSf?.[k] ?? 0);
}

export function housableStock(e: Econ, k: BuiltClass): number {
  return Math.max(0, (e.stock?.[k] ?? 0) - darkSfOf(e, k));
}

/**
 * Vacant sf from ordinary turnover × the time a turned suite is dark. Not a
 * floor under vacancy: the flow of tenants leaving times how long their space
 * waits, which is how frictional vacancy is defined. Scales with the occupied
 * book, because only occupied space can roll.
 */
export function betweenTenantsSf(occupied: number, k: BuiltClass, e?: Econ): number {
  return Math.max(0, occupied) * (turnoverYr(e, k) / 12) * reletMonths(k) * reletLag(e, k);
}

/**
 * HOW LONG A TURNED SUITE WAITS DEPENDS ON WHO IS LOOKING FOR IT (2026-10-10),
 * as a multiple of an ordinary turn.
 *
 * A suite is dark for its make-ready (MAKE_READY_M), which nothing shortens,
 * and then until a tenant takes it. That second part is search, and search is
 * a matching process: the rate at which a vacancy meets a tenant rises with
 * the number of tenants looking per vacancy, with an elasticity of about 0.5
 * (Petrongolo & Pissarides 2001, constant returns; Wheaton 1990 for office).
 * Its ordinary length is `reletMonths` at searchers-per-vacancy in balance —
 * the tenants who are moving anyway, against natural vacancy.
 *
 * Searchers are the tenants who are moving this month plus demand the city
 * is not housing (the looking pool above occupied space); vacancies are the
 * space not occupied. So a queue of tenants shortens every turn toward its
 * make-ready, and a glut stretches it.
 *
 * This replaces an availability rule shared with the player's leasing desk,
 * which bounded a turn at 0.7 of ordinary however long the queue — a fixed
 * floor one level down. Here the floor is the make-ready itself, a physical
 * time: turnover x make-ready reads ~1.6% for flats, ~1.2% offices, ~0.5%
 * shops and ~0.2% sheds at an infinite queue, against record lows near 2%
 * for apartments, 1-3% for primary office in 2000 and 0.6-1% for industrial
 * (Inland Empire, 2022). Rent rations the queue long before then.
 *
 * The glut side is bounded at twice an ordinary turn — searchers per vacancy
 * at a quarter of balance — which is the old rule's ceiling; past it a suite
 * is simply vacant, which the vacancy already says.
 */
export function reletLag(e: Econ | undefined, k: BuiltClass): number {
  if (!e?.stock || !e.occupied) return 1;
  const stk = Math.max(1, e.stock[k] ?? 0);
  const occ = Math.max(0, e.occupied[k] ?? 0);
  const nat = normalVac(e, k);
  const movers = occ * (turnoverYr(e, k) / 12);
  const unhoused = Math.max(0, (e.pool?.[k] ?? occ) - occ);
  const vacant = Math.max(stk * 0.001, housableStock(e, k) - occ);
  const theta = (movers + unhoused) / vacant;
  const theta0 = (stk * (1 - nat) * (turnoverYr(e, k) / 12)) / (stk * nat);
  const ratio = Math.max(theta, theta0 / 4) / theta0;
  const d0 = reletMonths(k), dm = Math.min(d0, MAKE_READY_M[k]);
  return (dm + (d0 - dm) * Math.pow(ratio, -0.5)) / d0;
}

/**
 * How empty the city is when every suite that can be let, is. Dark new
 * floor plus turnover still in re-let. The rent mute and tightEma used to
 * treat `frictionFloor` as that point; that number is now only a watcher.
 */
export function residenceVac(e: Econ, k: BuiltClass): number {
  const stk = Math.max(1, e.stock?.[k] ?? 0);
  return (darkSfOf(e, k) + betweenTenantsSf(e.occupied?.[k] ?? 0, k, e)) / stk;
}

/**
 * A CLASS THE CITY CANNOT HOUSE, on the same instruments densify already
 * reads. Vacancy on the frictional rail, or `structTight` saying desired
 * demand is already past housable. Used by the zoning map — a planning
 * board rezones land for a use that is short, not for one that is empty.
 */
export function classIsShort(e: Econ, k: BuiltClass, slack = 0.02): boolean {
  const vac = e.cityVac?.[k] ?? normalVac(e, k);
  if (vac <= frictionFloor(k, e) + slack) return true;
  return (e.structTight?.[k] ?? 0) > 0.06;
}

/**
 * NAMED TENANTS TOUCH THE CITY POOL. Micro lease events used to live in a
 * separate universe from `econ.pool` / absorption — a 20k sf default on your
 * floor never showed up in the city looking queue. Material signed changes
 * (±2,000 sf) adjust the pool: space freed becomes searchers (briefly); space
 * taken comes out of the looking book. Occupied still walks via absorb.
 */
export function noteTenantSfChange(s: GameState, use: BuiltClass, deltaSf: number) {
  // Superseded (2026-10-14): the player's occupied space is reconciled into
  // `occupied` monthly (playerSpace in sim.ts), which is the real draw on the
  // pool. Nudging the pool as well would count every signing twice.
  if (s.econ.playerNow) return;
  if (!Number.isFinite(deltaSf) || Math.abs(deltaSf) < 2_000) return;
  if (use === "multifamily") return; // flats are aggregate, not named suites
  const e = s.econ;
  if (!e.pool) e.pool = { office: 0, retail: 0, multifamily: 0, industrial: 0 };
  const stk = Math.max(1, e.stock?.[use] ?? 1);
  const housable = housableStock(e, use);
  const fringe = stk * normalVac(e, use) * 0.25;
  const cap = housable + fringe;
  const occ = e.occupied?.[use] ?? 0;
  // +deltaSf = space returned to market (departure); −deltaSf = space taken.
  e.pool[use] = clamp((e.pool[use] ?? occ) + deltaSf, occ * 0.85, cap);
}

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
/**
 * ...AND THE NEUTRAL POINT WAS MEASURED OFF A BROKEN MODEL, THEN THE MODEL WAS
 * FIXED AND THIS WAS NOT.
 *
 * This was 0.018, and `dev.ts` says in writing where that came from: "NOT the
 * same quantity as `REF_PIPE_SHARE` in market.ts, which is what THIS town's
 * pipeline ran at UNDER THE OLD CREW WALL... they differed by about the factor
 * the wall was suppressing." The crew wall was removed — `crewCapacity` is a
 * market now rather than a lot-count — so the pipeline runs at its true share
 * and the reference it is divided by is still the suppressed one.
 *
 * The consequence was the loudest employment rail in the engine. With
 * pipeShare/REF at about 0.045/0.018 = 2.5, `trades` came out at 0.048 x 2.5 =
 * 0.12 against a 0.11 ceiling, so it sat ON that ceiling in 56.6% of all months
 * — a permanent +11.6% step on the city's job count, which is most of why the
 * city wanted more workers than it had people. `pnpm rails` found the ceiling;
 * `dev.ts` had written down the reason years before anybody looked.
 *
 * So it is the anchor from the world now, and it is the SAME anchor `dev.ts`
 * already carried for the same quantity: roughly 1.8% of stock delivered a year
 * against a two-and-a-half year build is about 4.5% of the stock under
 * construction at any moment. One number, one file, two readers.
 */
export const REF_PIPE_SHARE = 0.045;
// How long the rest of the market takes to build each class, in months. This
// is the lag that makes the cycle a cycle: the decision to start is taken in
// one market and the building arrives in a different one, and nobody can undo
// a start once the hole is dug.
//
// OFFICE IS BUILT AS A SHELL, FLATS ARE BUILT FINISHED (2026-10-12). A spec
// office building delivers core and shell — structure, skin, lobby, core and
// base-building systems — and each floor is fitted out for its tenant after a
// lease is signed (that cost and time live in TI and lease-up, proforma.ts).
// An apartment building delivers every unit finished: kitchens, baths, floors,
// unit MEP. So at the same size the flats take longer. Census Survey of
// Construction: buildings of 5+ units average ~15-20 months start to
// completion, longer for large high-rise; core-and-shell office runs ~12-18
// months low-rise to ~24-30 for a tower. The old office [30, 44] had no
// source and made office the slowest class, which is backwards.
export const BUILD_MONTHS = { office: [12, 30], retail: [18, 28], multifamily: [15, 34], industrial: [12, 20] } as const;
// And how long it takes to be ALLOWED to dig, which is a different clock and
// was missing entirely. Site control, design, entitlement and a construction
// lender run six to eighteen months on a by-right commercial project in the
// United States; discretionary approval runs longer, sometimes by years. A
// measured fact about the business, in the same register as BUILD_MONTHS above
// — not a shape parameter and not a tuning knob. It is not split by class
// because the dominant term is the municipality, not the use.
export const ENTITLE_MONTHS = [6, 18] as const;
/** Loan documents, final permits and mobilization after approvals are in hand. */
export const CONSTRUCTION_CLOSE_M = 2;

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
export const SF_PER_JOB: Record<BuiltClass, number> = { office: 230, industrial: 550, retail: 420, multifamily: 0 };
/** Share of the population in the labour force. See the note at the unemployment term. */
const PARTICIPATION = 0.58;
/** The rate the city opens at, which is what makes the opening state consistent. */
const OPENING_UNEMP = 0.052;
/** The nation's natural rate — the Phillips curve's u* in tickNation, and the pivot for national pay. */
const NAT_U_STAR = 0.048;
/** How far below zero the price level can fall a year, asymptotically (pay is not cut). */
const DEFLATION_FLOOR = 0.02;
/** Credit gap built per month per point of real money under neutral (share of GDP). */
const CRED_PER_EASY_PT = 0.0008;
/** ...per unit of the lenders' window over normal, and per unit of output over potential. */
const CRED_PER_WINDOW = 0.004, CRED_PER_GAP = 0.03;
/** Written down per month per two points of unemployment over natural-plus-one (defaults). */
const CRED_RECESSION_WRITEOFF = 0.0010;
/** Months for the trend to catch up with the stock (a decade, as the BIS one-sided filter). */
const CRED_TREND_M = 120;
/** The spread a bank's margin is normal at: this economy's own average (~2.5 points). */
const CURVE_NORMAL = 2.5;
/** A fall of this much off the output peak is a contraction (2001's was ~0.3%). */
const REC_DROP = 0.006;
/** Share of corporate debt that floats, and the fixed ladder's average life in months. */
const CORP_FLOAT = 0.35, CORP_LADDER_M = 72;
/**
 * Okun's coefficient: points of output per point of unemployment. 1.2 is the
 * recession-era ratio (1990-92: CBO gap +0.6 to -2.6, unemployment +2.6).
 */
const OKUN = 1.2;
/** Unemployment closes this share of its gap to Okun's level a month — faster up than down. */
const U_UP_SPEED = 0.15, U_DOWN_SPEED = 0.12;
/*
 * Calibration (national block alone, 30 centuries, tools in the session notes):
 * unemployment mean 6.1 / p50 5.8 / p10 3.6 / p90 9.1 (US 1948-2024: 5.7 /
 * 5.5 / 3.9 / ~8.5); output gap sd 2.8 (CBO ~2.2); in recession 15% of months
 * (US ~14%), median length 12 months (US ~10). The depth now depends on the
 * money: median unemployment rise 1.4 points when policy was at or under
 * neutral the year before, 2.3 at 0-1 points over, 2.9 at 1-3, 5.3 above 3.
 * The drawn model gave 3.2-3.5 whatever the money did.
 */

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
  // ...AND THE WORK THAT IS NOT ON A COMMERCIAL FLOOR (2026-10-28, ONE
  // ECONOMY step 2). The ratios above count the desks, counters and sheds;
  // a region also has its hospitals, schools, nursing homes and public
  // payroll, in proportion to its size whatever its floors hold — about a
  // quarter of US jobs (industries.ts OFF_FLOOR_SHARE_NAT: health and
  // education's off-floor part and government's, CES 2023). Counting only the
  // floors put 92% of the town's jobs in street firms against the nation's
  // ~64%, and a region that size short of the people its schools and
  // hospitals employ.
  jobs /= 1 - OFF_FLOOR_SHARE_NAT;
  // A town with no commercial stock at all is still a town — the floor keeps
  // every ratio downstream finite rather than pretending the place is empty.
  jobs = Math.max(2_000, Math.round(jobs));
  const pop0 = Math.round(jobs / (1 - OPENING_UNEMP) / PARTICIPATION);
  return { jobs0: jobs, pop0 };
}

/**
 * HOW BUILT-UP THE MAP IS, as floor area over lot area.
 *
 * Vacant lots count in the denominator with zero building, so a Frontier town
 * (half the plat still dirt) reads lower than a Metropolis on the same island
 * even before anyone looks at tower heights. This is the morphological density
 * the space market was not reading — stock, jobs and population all scale with
 * the build-out ladder, but demand indexes them to their own opening values, so
 * the LEVEL of rents and wages never moved. Measured at seed 20261 on New
 * Alden: Landing ~0.26, Frontier ~0.65, Young town ~1.25, Metropolis ~3.34.
 */
export function cityFloorIntensity(parcels: ParcelTable): number {
  let lot = 0, bldg = 0;
  for (const bbl in parcels) {
    const r = parcels[bbl];
    if (!r) continue;
    lot += r.lotArea || 0;
    if (r.class === "land" || !(r.floors > 0) || !(r.bldgArea > 0)) continue;
    bldg += r.bldgArea;
  }
  return lot > 0 ? bldg / lot : 0;
}

/**
 * OPENING PRICE LEVEL FROM MAP DENSITY — not a build-out dial.
 *
 * Ahlfeldt & Pietrostefani, "The economic effects of density: a synthesis"
 * (Journal of Urban Economics, 2019), Table 6 recommended elasticities for
 * high-income cities: wages 0.04, rents 0.15, with respect to a log-point of
 * density. Construction-cost elasticity in that paper (0.55) bundles a
 * STRUCTURE effect (taller buildings cost more per sf) that this engine
 * already prices through `heightPremium` in value.ts — applying it again on
 * `costIdx` would double-count. Local construction wages track the urban wage
 * premium, so cost opens with the wage scale.
 *
 * The reference intensity is the fabric `RENT_BASE` was written for: a harbour
 * young-town on the standard island (~1.25 citywide FAR including vacant
 * lots). Intensity 1 leaves every index at 1; denser maps open dearer, emptier
 * ones cheaper. Land opens at the same residual-shaped target the monthly
 * landIdx tracker chases, so dirt is not a year behind the rents that price it.
 */
export const REF_CITY_FAR = 1.25;
export const DENSITY_WAGE_ELAST = 0.04;
export const DENSITY_RENT_ELAST = 0.15;

export function densityPriceScales(cityFar: number): {
  intensity: number; wage: number; rent: number; cost: number; land: number;
} {
  const intensity = clamp(cityFar / REF_CITY_FAR, 0.15, 6);
  const wage = Math.pow(intensity, DENSITY_WAGE_ELAST);
  const rent = Math.pow(intensity, DENSITY_RENT_ELAST);
  const cost = wage;
  const land = Math.pow(rent / Math.pow(cost, 0.35), 1.15);
  return { intensity, wage, rent, cost, land };
}

/**
 * HOW MUCH PRIMARY-MARKET RENT MACHINERY THIS FABRIC HAS EARNED.
 *
 * Morphological intensity (`cityFloorIntensity / REF_CITY_FAR`): Landing ~0.25,
 * Village ~1, Metropolis ~2.5–3. Secondary harbour towns are the rule of thumb
 * for procedural islands; only dense fabric should fully earn the chronic
 * tightness premium and the on-rail scarcity level tax that price a primary
 * CBD. A mid-rung town can still boom and pin vacancy — it must not mint
 * Midtown rent-to-wage from "can't build" alone (ECONOMY.md §F).
 *
 * Returns 0.30..1.00. Not a difficulty dial: it is the same density signal
 * already used to open wages and rents, read again where century compounding
 * used to erase the secondary/primary distinction.
 */
export function cityClassFactor(intensity: number): number {
  return clamp(0.30 + 0.70 * clamp((intensity - 0.35) / 2.4, 0, 1), 0.30, 1);
}

export function initEcon(s: GameState, parcels?: ParcelTable): Econ {
  const CITY = parcels ? stockFromParcels(parcels) : { ...CITY_STOCK };
  const SIZE = citySize(CITY);
  const dens = parcels ? densityPriceScales(cityFloorIntensity(parcels)) : densityPriceScales(REF_CITY_FAR);
  const econ: Econ = {
    indexRate: 5.4,
    phase: "expansion",
    phaseMLeft: 0,
    rumoredPhase: null,
    cycleDev: 0.1,
    landIdx: dens.land,
    capRate: { office: CAP_BASE.office, retail: CAP_BASE.retail, multifamily: CAP_BASE.multifamily, industrial: CAP_BASE.industrial },
    rentIdx: {
      office: RENT_BASE.office * dens.rent,
      retail: RENT_BASE.retail * dens.rent,
      multifamily: RENT_BASE.multifamily * dens.rent,
      industrial: RENT_BASE.industrial * dens.rent,
    },
    costIdx: dens.cost,
    sectorMom: { office: 0, retail: 0, multifamily: 0, industrial: 0 },
    pipeline: { office: 0, retail: 0, multifamily: 0, industrial: 0 },
    starts: { office: 0, retail: 0, multifamily: 0, industrial: 0 },
    creditIdx: 1,
    employIdx: 1,
    stock: { ...CITY },
    baseStock: { ...CITY },
    occupied: {
      office: CITY.office * (1 - OPENING_VAC.office),
      retail: CITY.retail * (1 - OPENING_VAC.retail),
      multifamily: CITY.multifamily * (1 - OPENING_VAC.multifamily),
      industrial: CITY.industrial * (1 - OPENING_VAC.industrial),
    },
    cityVac: { ...OPENING_VAC },
    absorb12: { office: 0, retail: 0, multifamily: 0, industrial: 0 },
    deliveryQueue: [],
    cohorts: { office: [], retail: [], multifamily: [], industrial: [] },
    completions12: { office: 0, retail: 0, multifamily: 0, industrial: 0 },
    history: [],
  };
  econ.phaseMLeft = Math.round(12 + 30 * rng(s));

  // THE MEASURED PIVOTS (ECONOMY.md). The location curves are exponentials
  // pivoted on the city's own sf-weighted mean, so steepening the gradient
  // cannot move the aggregate price level on any map we ever ship; the
  // vintage tilt is renormalised the same way. DEMAND_GAMMA must match
  // value.ts (1.05) — inlined here because value.ts imports this module.
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
        landIdx.push(Math.pow(Math.max(0, r.demandScore) / 100, 1 / 1.05));
      }
      if (!r || r.class === "land" || !r.bldgArea) continue;
      const idx = Math.pow(Math.max(0, r.demandScore) / 100, 1 / 1.05);
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
    office: econ.stock.office * (1 - OPENING_VAC.office),
    retail: econ.stock.retail * (1 - OPENING_VAC.retail),
    multifamily: econ.stock.multifamily * (1 - OPENING_VAC.multifamily),
    industrial: econ.stock.industrial * (1 - OPENING_VAC.industrial),
  };
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
  // Wage (and cost) open at the density premium; output follows jobs × wage.
  econ.wageIdx = dens.wage; econ.outputIdx = dens.wage; econ.cpi = 1;
  // The opening REAL income per worker, stored so the income term is exactly
  // 1.0 in month zero on every map. `wageIdx` opens at dens.wage (a density
  // draw), NOT at 1.0, so an absolute form would shift opening demand on every
  // town whose density is not the reference and re-baseline every standing
  // number in the repo. cpi opens at exactly 1.
  econ.wage0 = dens.wage;
  econ.industComp = 1;
  // City class for rent machinery — updated as stock grows (see rent formation).
  econ.cityIntensity = dens.intensity;
  econ.cityIntensity0 = dens.intensity;
  econ.builtSf0 = BUILT_CLASSES.reduce((a, k) => a + (econ.stock[k] ?? 0), 0);
  econ.nat = { infl: 0.021, inflExp: 0.02, unemp: 0.052, policy: 4.2,
               neutralReal: 0.019, shockM: 0, shockSev: 0, credibility: 0.8,
               recM: 0, expM: 0, deep: false, pressureM: 0 };
  econ.concIdx = { office: 0, retail: 0, multifamily: 0, industrial: 0 };
  econ.vacOverM = { office: 0, retail: 0, multifamily: 0, industrial: 0 };
  econ.effRentIdx = { ...econ.rentIdx };
  // THE ECONOMY HAS A PAST. The national model runs twenty to sixty years
  // before month one on a private generator, and the town opens on whatever
  // that history left behind — see regime.ts. Nothing about it is named.
  // Density sets the LEVEL; the history moves rents and vacancy on top.
  {
    simulateHistory(econ, s.seed, OPENING_VAC as unknown as Record<string, number>);
    // The phase clock opens part-way through the phase the history ended in:
    // a recession runs as long as the nation's has left, anything else a
    // seeded share of its ordinary length. It used to open at ZERO, so the
    // opening phase was over by the first tick whatever it was.
    const n = econ.nat!;
    const [lo, hi] = PHASE_CFG[econ.phase].nextM;
    const u = mulberry32Step(((s.seed ^ 0x3c6ef372) >>> 0) || 1).value;
    econ.phaseMLeft = (econ.phase === "recession" || econ.phase === "depression") && (n.recM ?? 0) > 0
      // recM counts months INTO the recession now (it is dated, not drawn):
      // a post-war contraction runs about a year.
      ? Math.max(3, 12 - (n.recM ?? 0))
      : Math.max(3, Math.round(u * (lo + (hi - lo) * 0.5)));
  }
  // EVERY TOWN OPENS ON ITS OWN SUPPLY PRICE (2026-10-12).
  //
  // The rent table is 2024 secondary-market money and the cost table is 2024
  // RSMeans money, so every town in every seed opened with office at roughly
  // half the rent it takes to build (a 2024 post-pandemic overhang) — in a
  // game that opens in 2000, when construction cost was about 2.4x lower
  // against office rents that rose roughly with prices (ENR BCI 3,539 in 2000
  // against ~8,500 in 2024). The consequence was the same in every town: no
  // office for decades while rent climbed to the supply price, then a boom
  // that overshot. No year's prices need to be the model's (owner,
  // 2026-10-12: "each city and seed can have its unique system"). What a
  // town needs is an opening that is SOMEWHERE in the range real cities
  // occupy. So each class opens at its own Tobin's q — what a new building
  // is worth against what it costs at the sites developers actually pursue
  // (`devPencils`, the P90 location) — centred on 1, the margin a growing
  // city's supply sits at in the long run, with a seeded spread: one town
  // opens with an office glut, the next short of sheds. Only the rent LEVEL
  // moves; the history above still sets where in the cycle the town is.
  // OPEN_Q_SIGMA is a shape parameter (the cross-town spread of the opening),
  // stated as such, not a fit to any outcome.
  {
    const OPEN_Q_SIGMA = 0.15;
    for (const k of BUILT_CLASSES) {
      const u1 = Math.max(1e-6, mulberry32Step(((s.seed ^ (0x51ed27 * (BUILT_CLASSES.indexOf(k) + 3))) >>> 0) || 7).value);
      const u2 = mulberry32Step(((s.seed ^ (0x2545f491 + BUILT_CLASSES.indexOf(k) * 977)) >>> 0) || 11).value;
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      const target = Math.exp(OPEN_Q_SIGMA * z);
      const qAt = (): number => {
        const gap = (econ.cityVac[k] ?? OPENING_VAC[k]) - OPENING_VAC[k];
        econ.effRentIdx = econ.effRentIdx ?? { ...econ.rentIdx };
        econ.effRentIdx[k] = econ.rentIdx[k] * (1 - CONC_DEPTH * concessionTarget(gap, econ.phase));
        const a = devPencils(econ, k);
        return a > 0 ? Math.pow(a, 1 / 1.2) : 0;
      };
      // Secant on log rent: q rises with rent but not proportionally (opex,
      // recoveries), so solve rather than scale once. A class whose pencil
      // reads zero (no rent covers opex) is left as the table drew it.
      let q = qAt();
      if (!(q > 0) || q >= 3 ** (1 / 1.2) - 1e-6) continue;
      for (let it = 0; it < 8 && Math.abs(Math.log(q / target)) > 0.005; it++) {
        const r0 = econ.rentIdx[k];
        econ.rentIdx[k] = r0 * 1.05;
        const q1 = qAt();
        const slope = Math.log(Math.max(1e-6, q1) / q) / Math.log(1.05);
        econ.rentIdx[k] = r0 * Math.exp(clamp(Math.log(target / q) / Math.max(0.3, slope), -1.5, 1.5));
        q = qAt();
        if (!(q > 0)) { econ.rentIdx[k] = r0; break; }
      }
    }
  }
  // EVERY TOWN HAS ITS OWN DOLLARS, AND ITS OWN DEARNESS (2026-10-12).
  //
  // Owner: "you should be able to get a game where office rents are at $10
  // one time and $35 another time ... based on the seed, how built up the
  // city is maybe, and unique to the seed." Two draws, per seed:
  //
  //   PRICE LEVEL  what a dollar buys in this town — rents, construction,
  //                operating cost and pay all move together, so a $12 office
  //                town and a $35 one can run the same economics in different
  //                money (as two eras would). Median 0.45 of the reference
  //                table, which puts a typical town's office in the low $20s.
  //   DEARNESS     how expensive space is against what it costs to build and
  //                what people earn. Rents take all of it, pay about half and
  //                construction about four tenths: construction cost varies
  //                across US metros far less than rent does (RSMeans city
  //                index ~0.8-1.3 against several-fold office rent spreads).
  //                A dear town opens with building that pays; a cheap one
  //                opens where nothing new pencils for years.
  //
  // How built up the city is already moves the level (`densityPriceScales`).
  // Both sigmas are shape parameters for the cross-town spread, stated as
  // such: 0.35 on the price level, 0.20 on dearness.
  {
    const nrm = (salt: number): number => {
      const u1 = Math.max(1e-6, mulberry32Step(((s.seed ^ salt) >>> 0) || 13).value);
      const u2 = mulberry32Step(((s.seed ^ (salt * 7 + 0x9e37)) >>> 0) || 17).value;
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    };
    const P = 0.45 * Math.exp(0.35 * nrm(0x6a09e667));
    const R = Math.exp(0.20 * nrm(0x3c6ef372 ^ 0x5be0cd19));
    econ.priceLevel = P;
    for (const k of BUILT_CLASSES) econ.rentIdx[k] = +(econ.rentIdx[k] * P * R).toFixed(4);
    econ.costIdx = econ.costIdx * P * Math.pow(R, 0.4);
    const w = P * Math.pow(R, 0.5);
    econ.wageIdx = (econ.wageIdx ?? 1) * w;
    econ.outputIdx = (econ.outputIdx ?? 1) * w;
    econ.wage0 = (econ.wage0 ?? 1) * w;
    // THE OPENING COST OF LIVING AGAINST THE NATION (2026-10-13), struck with
    // the same weights the local CPI moves by (SHELTER_W 0.33 on housing,
    // SERVICES_W 0.25 on local pay, the rest national goods): this town's
    // opening flat rent and pay against the national reference, both net of
    // the price level. Stored so real pay against the nation can be read as
    // a level, not only as a change since the opening. Read by the display;
    // nothing in the simulation uses it.
    const shelterGap = econ.rentIdx.multifamily / Math.max(1e-6, RENT_BASE.multifamily * P) - 1;
    const servicesGap = econ.wage0 / Math.max(1e-6, P) - 1;
    econ.col0 = +(1 + 0.33 * shelterGap + 0.25 * servicesGap).toFixed(4);
  }
  // THE TOWN OPENS MID-CYCLE, SO ITS CONCESSIONS DO TOO.
  //
  // The dial used to open at zero — effective rent equal to face in every
  // class — and then chase its target at a quarter a month. The target at an
  // ordinary opening is not zero: retail at 13% against 8.5% natural in a
  // recovery wants ~0.6, eighteen points of net effective. So every game spent
  // its first year marking the whole city down for a concession package the
  // market already had on the day it opened: measured in the playable, a
  // retail building bought in January at the lender's appraisal was marked 9%
  // under it by May, in a recovery, with vacancy falling. Nothing happened in
  // the market; the dial was spinning up. Seeded here at its own target, from
  // the same function the tick reads, the first months move only on news.
  for (const k of BUILT_CLASSES) {
    const gap = (econ.cityVac[k] ?? OPENING_VAC[k]) - OPENING_VAC[k];
    econ.concIdx[k] = concessionTarget(gap, econ.phase);
    econ.effRentIdx[k] = +(econ.rentIdx[k] * (1 - CONC_DEPTH * econ.concIdx[k])).toFixed(4);
  }
  // Land tracks the rent that actually opened (era-adjusted), not the pre-era
  // density scale alone — same identity the monthly landIdx step chases.
  {
    const rentLevel = (econ.effRentIdx?.office ?? econ.rentIdx.office) / RENT_BASE.office;
    const costLevel = Math.max(0.35 * (econ.priceLevel ?? 1), econ.costIdx ?? 1);
    econ.landIdx = clamp(
      Math.pow(rentLevel / costLevel, 1.15),
      0.05, 80,
    );
  }
  // Era rewrote vacancy; occupied has to match or month-zero vacancy is a lie.
  for (const k of BUILT_CLASSES) {
    const vac = econ.cityVac[k] ?? OPENING_VAC[k];
    econ.occupied[k] = econ.stock[k] * (1 - vac);
    econ.pool[k] = econ.occupied[k];
  }
  econ.rentExp = { ...econ.rentIdx };
  econ.effRentIdx = { ...econ.rentIdx };
  for (const k of BUILT_CLASSES) {
    econ.effRentIdx[k] = +(econ.rentIdx[k] * (1 - CONC_DEPTH * econ.concIdx[k])).toFixed(4);
  }
  // Income-anchor parity is this opening print, not the global RENT_BASE table.
  econ.rentAnchor = { ...econ.rentIdx };
  econ.effAnchor = { ...econ.effRentIdx };
  econ.costAnchorReal = (econ.costIdx ?? 1) / Math.max(0.35, econ.cpi ?? 1);
  econ.inPlaceReal = { ...econ.effRentIdx };
  recordHistory(econ, 0);
  return econ;
}

export function pushNewsPublic(s: GameState, kind: NewsItem["kind"], text: string, why?: number) { pushNews(s, kind, text, why); }
function pushNews(s: GameState, kind: NewsItem["kind"], text: string, why?: number) {
  s.news.unshift({ q: s.month, kind, text, ...(why ? { why } : {}) });
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
    "Distressed buyers are active; some see a bottom.",
    "First green shoots: concessions burning off in the best buildings.",
  ],
  depression: [
    "Empty floors are still coming to market — nobody is calling this a recovery.",
    "The brokers have stopped scheduling tours for the secondary stock.",
  ],
};

/**
 * CAPITAL AVAILABILITY, ONE MONTH — shared by tickEcon and the pre-history
 * (regime.ts), so the credit window the player opens into is the one this
 * equation left behind, lag and all.
 */
export function stepCredit(s: GameState) {
  // ONLY BEFORE THERE ARE BANKS (2026-10-28). Once the desks exist the
  // window is what they want to lend — their capital-weighted appetite, read
  // off their own books (lenders.ts tickLenders). This equation now writes
  // only the pre-history (regime.ts), the window the town opens into, when
  // there are no desks to ask.
  if (s.lenders?.length) return;
  const e = s.econ;
  // CREDIT READS WHAT LENDERS READ (2026-10-09), not the label: whether the
  // town's payrolls are growing (+2%/yr opens the window to the old
  // expansion's 1.12) and how fast unemployment is rising nationally — the
  // single best predictor of loan officers tightening in the Fed's senior
  // loan officer survey. Calibrated to the endpoints the old table carried,
  // which were measured: a typical recession (national unemployment up 2.5
  // points, local payrolls down 1.5%) lands at ~0.55, the old recession row;
  // a deep one (6 points, -4%) reaches the 0.4 floor, as recession plus the
  // deep-national event did. A first cut at 6 per point of unemployment left
  // the 10th-percentile window at 0.90 — credit crunches had disappeared.
  // Lender capital (lenders.ts) still drags it as before.
  const g12 = clamp(payrollGrowth12(e), -0.08, 0.04);
  // ...and the bank's own margin (2026-10-13): lenders fund at the short rate
  // and lend at the long one, so a flat or inverted curve is a thin margin
  // on every new loan and loan officers tighten before the economy turns
  // (Adrian, Estrella & Shin 2019; SLOOS tightening leads every post-war
  // inversion). Centred on the US average ten-year-less-policy spread, ~1.2.
  const curve = e.nat ? 0.04 * ((e.indexRate - e.nat.policy) - 1.2) : 0;
  // A PANIC (blackswans.ts) shuts the window whatever the cycle says: 2008's
  // SLOOS reading arrived months before the payrolls that would justify it.
  const panic = 0.7 * (e.panic?.force ?? 0);
  const creditTarget = clamp(1.0 + 6 * g12 - 14 * Math.max(0, natUnempRise12(e)) + curve - panic, 0.4, 1.25);
  const creditSpeed = creditTarget < e.creditIdx ? 0.16 : 0.055;   // slams shut, reopens slowly
  e.creditIdx = clamp(e.creditIdx + creditSpeed * (creditTarget - e.creditIdx) + rrange(s, -0.012, 0.012), 0.4, 1.25);
}

/** The committee's calendar, month-of-year 0-indexed: Jan, Mar, Apr, Jun,
 *  Jul, Sep, Oct, Dec — close to the real FOMC year. */
const FOMC = [0, 2, 3, 5, 6, 8, 9, 11];
const isMeetingMonth = (m: number) => FOMC.includes(((m % 12) + 12) % 12);

/** The maturity the loan index is a yield on: the ten-year, the benchmark
 *  fixed commercial mortgages price over. */
const INDEX_HORIZON_M = 120;
/**
 * How fast the rule's prescription returns to its long-run level, per month.
 * MEASURED, not tuned: the least-squares fit of rho^h to the autocorrelation
 * of (ruleRate - long-run level) at every horizon from 1 to 120 months, in
 * the model's own national economy (40 seeds x 50 years, national block
 * alone; it does not read the index, so the fit is not circular). Measured
 * autocorrelation 0.86 at a year, 0.46 at three, ~0 by seven-and-a-half —
 * a business cycle. The market knows how persistent this economy's cycles
 * are because it has lived through them: model-consistent expectations, not
 * a chosen speed.
 */
// RE-MEASURED 2026-10-15 on the simulated national economy (20 centuries,
// tools in the session notes): autocorrelation 0.76 at a year, 0.05 at
// three, negative by five — cycles turn faster than the drawn model's did
// (0.974 was fitted on that one).
// RE-MEASURED 2026-10-28 (40 national centuries x 100 years, the fit this
// comment describes: least squares of rho^h on the autocorrelation of
// ruleRate less the long-run level, h = 1..120): 0.90, with the 2.0 inflation
// response and the wider r* below; 0.90 on main before them as well, 0.85
// was not the fit. Autocorrelation 0.45 at a year, -0.2 at two. At 0.85 the
// bond market expected every move to be undone inside a few months, so the
// ten-year moved 0.14 points per point of policy over a year (US 0.32).
const RULE_GAP_RHO = 0.90;

/**
 * WHAT THE BOND MARKET THINKS POLICY WILL AVERAGE over the index's life.
 *
 * It runs the committee forward with the committee's own decision rule
 * (`bankStep`, on the real meeting calendar, from the real starting rate):
 * the rule's prescription decays toward its long-run level at the economy's
 * measured persistence, and the bank walks toward it a meeting at a time,
 * under fiscal pressure for as long as the pressure has left to run.
 *
 * The long-run level is r* plus the inflation the market expects in the long
 * run — which is the bank's target only as far as the bank is believed. A
 * bank with no credibility left is expected to let today's inflation become
 * the trend, and the long end prices that in before the short end moves:
 * the bond vigilante, as a mechanism.
 *
 * Simplification, stated: the market expects the Volcker pace only while the
 * bank is still more than three points behind its own rule.
 */
export function expectedPolicyAvg(
  n: NonNullable<Econ["nat"]>, want: number, restoring: boolean, month: number,
): number {
  const tgt = n.inflTarget ?? 0.02;
  const cred = n.credibility;
  // ...plus whatever the market has learned about where this bank actually
  // rests (`endShift`, updated in tickNation).
  const longRun = 100 * (n.neutralReal + cred * tgt + (1 - cred) * n.inflExp) + (n.endShift ?? 0);
  const gap0 = want - longRun;
  let p = n.policy, sum = 0, decay = 1;
  const pressure = n.pressureM ?? 0;
  for (let h = 1; h <= INDEX_HORIZON_M; h++) {
    decay *= RULE_GAP_RHO;
    if (isMeetingMonth(month + h)) {
      const gap = longRun + gap0 * decay - p;
      // The expected cut below zero is the cut times its odds (see the
      // committee's own lower bound in tickNation) — no floor here either.
      let st = bankStep(gap, restoring && Math.abs(gap) > 3, h < pressure);
      if (st < 0 && p + st < 0) st *= Math.exp((p + st) / 0.35);
      p += st;
    }
    sum += p;
  }
  return sum / INDEX_HORIZON_M;
}

/**
 * THE TERM PREMIUM'S LEVEL — what holding a ten-year bond instead of rolling
 * cash is paid, which is mostly a price on not knowing what inflation will be.
 * So it reads the bank's credibility. CALIBRATED against the Adrian-Crump-
 * Moench ten-year premium at its two ends: about zero under a fully believed
 * bank (2010s average; credibility 0.99 here) and about four points at the
 * top of the Great Inflation (1981; credibility on its 0.10 floor here). The
 * line through those two points is 4.4 x (1 - credibility) - 0.05.
 *
 * Plus the credit term this line always had: when the window is frightened
 * the premium a LOAN index carries widens even while policy is being cut.
 */
export function termPremBase(credibility: number, creditIdx: number, inflExp = 0.02, target = 0.02): number {
  // RECALIBRATED 2026-10-13: the believed-bank end was the 2010s' ~0, which
  // is what a decade of central-bank bond buying did to the premium — QE,
  // which this game does not have. A believed bank WITHOUT it is 1995-2007:
  // ACM ten-year premium about 1.0-1.5. With the premium at zero the curve
  // sat inverted 28-78% of months against the US record of ~15%.
  // ...AND 0.6, NOT 1.0 (2026-10-15): with credibility judged on the year
  // against the bank's own target, a believed bank is believed most of the
  // time, and 0.6 puts the median premium at 1.3 (ACM 1961-2024 ~1.2), the
  // curve inverted 18% of months and inversion ahead of 75% of recessions
  // (US ~15-21% and 8 of the last 10).
  // THE PREMIUM PRICES THE RISK OF MORE INFLATION, NOT OF LESS (2026-10-18).
  // A bank that has lost belief by UNDERSHOOTING — a recession's inflation
  // below target — does not make a ten-year bond riskier: with expectations
  // under target, long bonds hedge the downturn and the inflation-risk
  // premium falls (ACM: the premium went negative in the low-inflation 2010s
  // and around 2020). Read symmetrically, a recession's undershoot cost belief
  // and DOUBLED the premium exactly when policy was at zero — measured over
  // 20 centuries, policy under 0.5% came with a 2.8-point premium and a 5.65%
  // ten-year, above the 5.09% of all months. So the credibility term weighs
  // in full once expectations sit at or over target and fades to a quarter as
  // they fall a point under it.
  const upside = Math.max(0.25, Math.min(1, 1 + (inflExp - target) / 0.01));
  return 0.6 + 4.4 * (1 - credibility) * upside + 1.85 * Math.max(0, 1 - creditIdx);
}

/**
 * ONE MEETING'S DECISION, given the gap between where the rule points and
 * where policy sits. The committee uses it, and so does the bond market's
 * forecast of the committee (`expectedPolicyAvg`) — one rule, one answer.
 */
function bankStep(gap: number, restoring: boolean, pressured: boolean, uRise6 = 0): number {
  const abs = Math.abs(gap);
  let step = 0;
  if (abs >= 0.15) {
    // A BANK THAT HAS LOST THE ARGUMENT DOES NOT MOVE IN QUARTER POINTS.
    // At three-quarters a meeting it took five years to climb from 5% to
    // 30%, reading trend inflation through a twelve-month smoothing, so
    // it peaked two years after inflation did and hiked six points a
    // year into a disinflation already under way (measured across forty
    // centuries: peak policy 27-32% against 17% inflation and falling).
    // Volcker took the funds rate from 11% to 17.6% in eight months, cut
    // it to 9% inside a quarter, and had it at 19% six months later —
    // a point and a half a meeting, both ways. That pace is the
    // restore regime's: it reaches the rate that breaks the inflation
    // while the inflation is still rising, which is the only reason
    // the peak is lower.
    const frightened = abs > 7 || restoring;
    // ...and a bank far behind a runaway does not crawl to it at a fixed
    // pace: the restore step is a quarter of the gap when that is larger
    // (Volcker's October 1979 move was ~4 points inside a month; the
    // stabilisations that ended Israel's 1985 and Brazil's 1994 inflations
    // moved rates tens of points at once).
    let unit = restoring ? Math.max(1.5, 0.25 * abs) : frightened ? 0.75 : abs > 3 ? 0.50 : 0.25;
    // RISK MANAGEMENT ON THE WAY DOWN (2026-10-17). A committee watching
    // payrolls roll over does not ease in quarter points: with unemployment up
    // half a point in six months it cuts by halves, and by three-quarters once
    // it is up a point — the Fed of 2001 (eleven cuts, 4.75 points in a year)
    // and of 2007-08 (with intermeeting moves). Easing at a quarter a meeting
    // left recessions running 19-21 months against ~10 in the US record and
    // unemployment rising 4-5 points against ~3.6.
    if (gap < 0 && !restoring && uRise6 >= 0.005) unit = Math.max(unit, uRise6 >= 0.01 ? 0.75 : 0.5);
    step = Math.sign(gap) * unit;
    if (Math.abs(step) > abs) step = gap;
  }
  // A LEANED-ON BANK LEANS BACK, SLOWLY. This froze the rate outright for
  // the whole episode (30-96 months), and measured across forty
  // centuries that freeze was the entire run-away: policy pinned at 0.3%
  // or 4.9% for five to eight years while inflation compounded through
  // easeEma to 20%, credibility hit its floor, expectations pinned their
  // 16% clamp, and the rule then asked for 30% money into a disinflation
  // already under way (peak policy 31.9%; one century in ten pinned the
  // 23% index ceiling). No modern central bank was ever held at zero
  // against 10% inflation for eight years. The Martin Fed under the
  // Vietnam build-out took the funds rate from 4% to 9% between 1965 and
  // 1969 — about a point and a quarter a year, a third of what the rule
  // wanted — and that is the shape here: under pressure the bank moves a
  // quarter point, only on a visible miss, never the frightened
  // three-quarters. Two points a year at most. The mistake still
  // compounds; it no longer compounds unopposed.
  if (pressured && step > 0) step = gap > 1.0 ? 0.25 : 0;
  return step;
}

/**
 * THE NATION, ONE MONTH. Lifted out of tickEcon whole so the same equations
 * can run the economy's history before the player arrives (regime.ts
 * `simulateHistory`) — there is one macro model, not a model and a table of
 * openings. Reads the city only through `e.unemployment` and `e.creditIdx`.
 */
// THE NATION ROLLS ITS OWN DICE (MDGA). The comment below records why the
// national cycle stopped reading the city's property phase: "one town's
// leasing decided the nation's labour market". It still drew from the city's
// stream, so any change to local behaviour — a land price, a listing pick —
// re-rolled whether 1929 happened. Measured while landing MDGA: a holder
// capitulation that changed no national quantity moved one seed's 33-month
// deep national recession from absent to present. Every draw in this
// function is on its own channel now; the town cannot re-roll the nation.
const CHAIR_NAMES = [
  "Hollis Carrow", "Margaret Venn", "Arthur Bellamy", "Ruth Okafor", "Daniel Prescott", "Elena Marsh",
  "Walter Kincaid", "Frances Lowell", "Samuel Achterberg", "Clara Whitcomb", "Leonard Strand", "Ines Calloway",
  "Theodore Haig", "Naomi Fairbanks", "Edwin Rourke", "Judith Selden",
];
/** How a chair reads to the market, from their resolve. */
export function chairStance(resolve: number): "hawk" | "centrist" | "dove" {
  return resolve > 1.25 ? "hawk" : resolve < 0.8 ? "dove" : "centrist";
}
/** The sitting chair of the central bank: a term and a resolve (see the reaction function). */
function centralBankChair(s: GameState, n: NonNullable<Econ["nat"]>): { untilM: number; resolve: number } {
  if (!n.chair || s.month >= n.chair.untilM) {
    const first = !n.chair;
    const u1 = Math.max(1e-9, rng(s, "nation")), u2 = rng(s, "nation");
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const resolve = +Math.exp(0.30 * z).toFixed(3);
    const term = 48 + Math.floor(rng(s, "nation") * 97);    // four to twelve years
    const name = CHAIR_NAMES[Math.floor(rng(s, "nation") * CHAIR_NAMES.length)];
    n.chair = { untilM: s.month + term, resolve, name, sinceM: s.month };
    if (!first) {
      // THE GAME STOPS FOR IT (owner, Oct 2026). A new chair is the one piece
      // of national news that resets where money is going for years, so it
      // takes the screen; `raiseAlert` also files it in the news.
      const stance = chairStance(resolve);
      const infl = ((n.infl ?? 0) * 100).toFixed(1), pol = (n.policy ?? 0).toFixed(2);
      raiseAlert(s, {
        kind: "fed",
        tone: stance === "hawk" ? "bad" : "good",
        title: `${name} takes the chair of the central bank`,
        body: stance === "hawk"
          ? `The market reads a hawk. Inflation is running ${infl}% and the policy rate is ${pol}%; expect it to be fought, whatever it costs — dearer money, wider cap rates, slower lending.`
          : stance === "dove"
            ? `The market reads a dove. Inflation is running ${infl}% and the policy rate is ${pol}%; expect growth first and inflation to be given room — cheaper money for now, and the risk that prices get away.`
            : `The market reads a centrist. Inflation is running ${infl}% and the policy rate is ${pol}%; nobody expects the bank's course to change much.`,
        detail: `The term runs to ${2000 + Math.floor((s.month + term) / 12)}. The bank's stance, the rate it is steering toward and how far the public believes it are on the Economy page under Central bank.`,
      });
    }
  }
  return n.chair;
}

/**
 * HOUSEHOLDS OWN HOMES AND OWE MORTGAGES (2026-10-15).
 *
 * Real home prices chase a fundamental value: real income (national pay
 * against prices) over the user cost of owning — the mortgage rate (the long
 * rate plus a 1.7-point spread), upkeep and property tax (2.5%), less the
 * appreciation buyers expect (last three years' real growth, damped). Prices
 * are sticky and carry momentum — the Case-Shiller index autocorrelates at
 * about 0.5 a year (Case & Shiller 1989) — so they overshoot and correct over
 * years. A point on mortgage rates takes ~9% off the fundamental.
 *
 * Two flows reach spending. Wealth: households spend about four cents a year
 * of each dollar of housing wealth gained or lost (Case, Quigley & Shiller
 * 2005; Mian, Rao & Sufi 2013), and housing is about 1.5x a year's output.
 * Refinancing: when mortgage rates fall below what the stock pays, owners
 * refinance within a couple of years and spend part of the interest saved;
 * when rates rise, the stock reprices only as people move (~1/15 a year).
 */
function tickHouseholds(e: Econ, n: NonNullable<Econ["nat"]>, gapPrev: number) {
  void gapPrev;
  const mort = (e.indexRate ?? 5.4) / 100 + 0.017;
  n.mortCoupon ??= mort;
  n.mortCoupon += (mort - n.mortCoupon) * (mort < n.mortCoupon ? 1 / 24 : 1 / 180);
  n.mortRef = (n.mortRef ?? n.mortCoupon) + (n.mortCoupon - (n.mortRef ?? n.mortCoupon)) / 60;
  // National real income: the model's own output index (potential ~2%/yr
  // plus the gap), at the ~0.4 income elasticity of real house prices that
  // gives the long-run ~0.8%/yr the US real index has shown.
  const realPay = Math.exp(0.4 * (n.lnY ?? 0));
  n.hpi ??= 1;
  n.hpiPay0 ??= realPay;
  const g3 = n.hpiG3 ?? 0;
  const userCost = hhUserCost(mort, g3, n.inflExp ?? 0.02);
  n.hpiUc0 ??= userCost;
  const fundamental = (realPay / n.hpiPay0) * Math.pow(n.hpiUc0 / userCost, HPI_UC_ELAST)
    * (1 + 0.5 * Math.max(-0.2, Math.min(0.2, n.credGap ?? 0)));
  const prev = n.hpiPrev ?? n.hpi;
  n.hpiPrev = n.hpi;
  // Sticky: a third of the gap a year. The momentum is in the expectations
  // (g3 lowers the user cost while prices rise), which is the bubble channel.
  n.hpi = Math.max(0.2, n.hpi + (fundamental - n.hpi) / HPI_CHASE_M);
  // Expected appreciation: the last three years' real growth, annualised.
  n.hpiG3 = g3 + ((n.hpi / Math.max(1e-6, prev) - 1) * 12 - g3) / 36;
  // The trend the wealth effect is measured from: income-driven, slow.
  n.hpiTrend = (n.hpiTrend ?? n.hpi) + (n.hpi - (n.hpiTrend ?? n.hpi)) / 120;
}

/** Real user cost of owning: mortgage rate + upkeep and tax - expected real appreciation - expected inflation. */
function hhUserCost(mort: number, g3: number, inflExp: number): number {
  return Math.max(0.035, mort + 0.025 - 0.3 * Math.max(-0.03, Math.min(0.05, g3)) - inflExp);
}
/** Elasticity of the price fundamental to the user cost (~7% off per mortgage point near 6%). */
const HPI_UC_ELAST = 0.5;
/** Months for prices to close their gap to the fundamental. */
export const HPI_CHASE_M = 30;


/**
 * THE NATION'S SPENDING (2026-10-16). Output is what the country buys, built
 * up from who buys it — not a fitted autoregression with demand noise on top.
 *
 *   consumption  households spend out of their income, smoothed toward what
 *                they think they earn over a couple of years (permanent
 *                income), plus their housing wealth (~4c a year per dollar,
 *                Case-Quigley-Shiller), less when real rates are high, more
 *                when a refinancing wave frees cash, and less when the job
 *                market turns (precautionary saving: rising unemployment is
 *                the best predictor of a consumer pull-back). Taxes come out
 *                and unemployment insurance goes in, so the government
 *                cushions every slump automatically.
 *   investment   firms hold a stock of capital sized to the output they
 *                expect, at the cost of carrying it — the long rate they
 *                borrow at, less inflation, plus wear (Jorgenson's user cost)
 *                — and close the gap over a few years; credit conditions,
 *                the banks' margin and a panic move what they can finance.
 *                Because investment answers the CHANGE in expected output,
 *                a slowdown cuts it hard (the accelerator).
 *   inventories  firms keep about six weeks of sales on hand; when sales fall
 *                the shelves are over-full and orders are cut below sales
 *                until they clear (the inventory cycle — most of the swing in
 *                a mild recession).
 *   housing      home building follows home prices against their trend and
 *                the mortgage rate against what borrowers are used to.
 *   government   spends a steady share, plus what politics adds (a fiscal
 *                expansion under pressure on the bank) and what it does when
 *                the bank is stuck at zero.
 *   the world    exports ride the rest of the world's cycle — the one part of
 *                demand that IS outside the model, and so the one that is drawn.
 *   imports      a share of everything bought leaks abroad.
 *
 * Shares of output at rest are the US's (BEA NIPA, 1990-2019): consumption 68%,
 * business investment 14%, residential 4%, government 17%, net exports -3%.
 * The cycle comes out of the stocks — capital, inventories, what households
 * think they earn — answering each other, not out of a lag polynomial.
 */
/** The rest of the world (see THE WORLD IS AN ECONOMY TOO in tickDemand). */
const ROW = {
  /** its gap's persistence, monthly; output per unit of its real rate gap, a month; its shocks */
  RHO: 0.985, RATE: 0.02, SIG: 0.0035,
  /** its central bank: real rate per unit of gap, months to get there */
  POL: 1.0, POL_M: 6,
  /** log exchange rate per unit of real-rate differential; months to get there */
  UIP: 4, Q_M: 12,
  /** export income and price elasticities; import price elasticity */
  X_INC: 1.5, X_PRICE: 0.5, M_PRICE: 0.3,
};
/*
 * THE CYCLE'S SHAPE, RECALIBRATED (2026-10-17). Measured over 40 simulated
 * centuries of this block alone, the cycle had the right number of recessions
 * but the wrong kind: 21 months long against ~10 in the post-war US record,
 * unemployment up 4.8 points against ~3.6, an output gap swinging 3.6 points
 * (US ~2.2), and expansions running 20 years in a typical century (34 in one
 * in ten; the longest on the US record is 11). Real recessions are sharp and
 * short: inventories liquidated inside two quarters, investment plans cut
 * and restored, and a Fed easing in half points. So:
 *   confidence moods are larger and shorter-lived (monthly persistence 0.85,
 *     a half-life of four months, not two years);
 *   shelves are restocked over six months, not twelve; investment plans lag
 *     six months and capital gaps close over 40;
 *   households cut half as hard on a rise in unemployment, and the profit
 *     squeeze bites three-quarters as hard;
 *   the bank eases in halves and three-quarters once payrolls roll over
 *     (bankStep), and a recession is dated from a 0.6% fall in output, not
 *     every 0.3% wobble.
 * Measured after (40 centuries): 1.7 recessions a decade (US ~1.6), median
 * length 13 months, unemployment up 3.0 points (p25 1.4, p75 5.0), the
 * longest expansion in a century 17 years at the median and 23 at the 90th
 * percentile, inflation above 6% in 8% of months.
 */
const DEM = {
  C0: 0.68, I0: 0.14, IH0: 0.04, G0: 0.17, IMP: 0.15, TAX: 0.25,
  /** transfers per unit of unemployment over natural (UI, SNAP, Medicaid: ~0.4% of output a point) */
  TR_U: 0.4,
  /** depreciation and potential growth, a year */
  DELTA: 0.10, GROW: 0.02,
  /** months for consumption to follow its target; for perceived income to follow income */
  TAU_C: 3, YP_M: 48,
  /** share of spending that follows this year's income rather than what households expect to earn (hand-to-mouth, Campbell-Mankiw ~0.2-0.3) */
  C_NOW: 0.2,
  /** months over which firms read the output they plan for; to close a capital gap; investment plans lag */
  YE_M: 12, TAU_K: 40, I_LAG: 6,
  /** how far the output firms plan capital for follows recent output rather than the trend (Survey of CFOs: plans are mostly trend) */
  YE_W: 0.3,
  /** wage share per unit of unemployment under natural, months to get there, capital wanted per unit of wage share */
  WS_U: 1.0, WS_M: 18, PROF: 1.5,
  /** user-cost elasticity of capital (Chirinko 1993: 0.25-0.5) */
  SIGMA_K: 0.4,
  /** consumption per point of real rate over neutral (intertemporal substitution, ~0.3-0.6) */
  C_RATE: 0.6,
  /** months over which households read the real rate */
  RR_M: 12,
  /** consumption pulled back per point of unemployment rise over six months */
  PREC: 0.4,
  /** inventory to annual sales (~6 weeks), months to restock */
  NU: 0.12, TAU_N: 6,
  /** months for home building to follow; starts per unit of mortgage rate over what borrowers are used to (a 3-point jump takes 30-50% off starts) */
  IH_M: 9, IH_RATE: 6,
  /** consumer and business confidence: monthly shock to the log of what households spend and firms plan */
  CONF_SIG: 0.0035, INV_SIG: 0.006, CONF_RHO: 0.85,
  /** spending out of new borrowing (the credit impulse, ~0.2 of it in total: Biggs, Mayer & Pick 2010) */
  CRED_C: 0.1, CRED_I: 0.1,
  /** capital wanted per unit of the lenders' window off normal (financing constraints) */
  WIN_K: 0.32,
};

function spendNation(
  s: GameState, e: Econ, n: NonNullable<Econ["nat"]>,
  x: { rAvg: number; rStar: number; corpRate: number; corpNeutral: number; shock: number; lbTools: number },
): number {
  const P = DEM;
  const X0 = 1 - (P.C0 + P.I0 + P.IH0 + P.G0) * (1 - P.IMP);
  const K0 = P.I0 / (P.DELTA + P.GROW);
  if (!n.dem) {
    const y = 1 + (n.gap ?? 0);
    n.dem = { C: P.C0 * y, K: K0 * y, I: P.I0 * y, Ih: P.IH0 * y, N: P.NU * y, Yp: y * (1 - P.TAX), Ye: y, Se: y, f: 0, Y: y, sup: 0, uH: [] };
  }
  const d = n.dem;
  const Yprev = d.Y;
  const u = n.unemp;
  const infl = n.inflExp ?? 0.02;
  // HOUSEHOLDS
  const Yd = Yprev * (1 - P.TAX) + P.TR_U * (u - NAT_U_STAR);
  d.Yp += (Yd - d.Yp) / P.YP_M;
  d.uH.push(u); if (d.uH.length > 7) d.uH.shift();
  const du6 = u - d.uH[0];
  const lnH = Math.log((n.hpi ?? 1) / (n.hpiTrend ?? n.hpi ?? 1));
  const refi = (n.mortRef ?? n.mortCoupon ?? 0) - (n.mortCoupon ?? n.mortRef ?? 0);
  // New borrowing is spending while the stock grows faster than output; paying it down is not (Biggs & Mayer 2010).
  const credFlow = ((n.credGap ?? 0) - (n.credGapPrev ?? n.credGap ?? 0)) * 12;
  const panic = e.panic?.force ?? 0;
  // THE NATIONAL SWANS (blackswans.ts natSw): what a pandemic, a war, a
  // foreign crisis, a tech boom or a trade war does to households' spending,
  // firms' plans, the government's, the world's demand and the dollar. Each a
  // level, glided in and out by its own episode; zero in a quiet world.
  const sw = e.natSw;
  // CONFIDENCE. What households and firms believe about the years ahead is
  // the one input to spending no model of this economy can derive — news
  // about the future, a war, an election — so it is drawn, but persistent
  // (monthly 0.97: a mood lasts a few years) and it works only through the
  // spending decisions above: what households set aside, what capital firms
  // plan for. Smets & Wouters (2007) need the same two shocks to fit the US.
  const zc = Math.sqrt(-2 * Math.log(Math.max(1e-9, rng(s, "nation")))) * Math.cos(2 * Math.PI * rng(s, "nation"));
  const zk = Math.sqrt(-2 * Math.log(Math.max(1e-9, rng(s, "nation")))) * Math.cos(2 * Math.PI * rng(s, "nation"));
  d.cc = P.CONF_RHO * (d.cc ?? 0) + P.CONF_SIG * zc;
  d.kc = P.CONF_RHO * (d.kc ?? 0) + P.INV_SIG * zk;
  // Households answer the real rate over the year or two it takes to show up
  // in what they borrow and save — car loans, card balances, deposits.
  d.rr = (d.rr ?? 0) + ((x.rAvg - x.rStar) - (d.rr ?? 0)) / P.RR_M;
  // THE PART OF THIS EQUATION EVERY HOUSEHOLD IN THE COUNTRY SHARES
  // (2026-10-30): the mood, the real rate, a panic and a national swan —
  // not income, home prices or the jobless rate, which the town's households
  // read off their own (households.ts, the buffer-stock rule). The town's
  // households spend by it too, so the nation's consumption cycle reaches
  // the town's shops and not only its exporters.
  d.cMood = d.cc - P.C_RATE * d.rr - 0.03 * panic + (sw?.c ?? 0);
  const cT = P.C0 / (1 - P.TAX) * ((1 - P.C_NOW) * d.Yp + P.C_NOW * Yd)
    * Math.exp(d.cc - P.C_RATE * d.rr + 0.088 * lnH + 0.6 * refi - P.PREC * Math.max(0, du6) - 0.03 * panic + (sw?.c ?? 0))
    + P.CRED_C * credFlow;
  d.C += (cT - d.C) / P.TAU_C;
  // FIRMS: capital for the output they expect, at what it costs to carry
  d.Ye += (Yprev - d.Ye) / P.YE_M;
  const uc = Math.max(0.03, x.corpRate - infl + P.DELTA);
  const uc0 = Math.max(0.03, x.corpNeutral - infl + P.DELTA);
  const fin = (1 + P.WIN_K * ((n.creditNat ?? 1) - 1))
    * (1 + 0.02 * Math.max(-5, Math.min(1, (n.curveSm ?? CURVE_NORMAL) - CURVE_NORMAL)))
    * (1 - 0.2 * panic);
  // THE PROFIT SQUEEZE. A labour market held tight bids pay up faster than
  // output per worker, the wage share climbs and margins thin; firms that
  // earn less on capital want less of it. US corporate profits have peaked
  // and turned down ahead of every post-war recession, usually after two or
  // three years of unemployment under its natural rate (BEA NIPA; Kalecki,
  // Goodwin). Labour's share drifts up about a point of output per point of
  // unemployment held under natural, over a year and a half.
  d.ws = (d.ws ?? 0) + (P.WS_U * (NAT_U_STAR - u) - (d.ws ?? 0)) / P.WS_M;
  const kStar = K0 * (1 + P.YE_W * (d.Ye - 1)) * Math.pow(uc0 / uc, P.SIGMA_K) * fin * Math.exp(d.kc - P.PROF * d.ws + (sw?.k ?? 0));
  const dep = (P.DELTA + P.GROW) * d.K;
  // Capital is easier to stop buying than to sell: gross investment does not fall below a third of replacement.
  const iWant = Math.max(dep * 0.35, dep + (kStar - d.K) / (P.TAU_K / 12)) + P.CRED_I * credFlow;
  d.I += (iWant - d.I) / P.I_LAG;
  d.K += (d.I - dep) / 12;
  // HOMES
  const mortNow = (e.indexRate ?? 5.4) / 100 + 0.017;
  const ihT = P.IH0 * Math.pow((n.hpi ?? 1) / (n.hpiTrend ?? n.hpi ?? 1), 1.5) * Math.exp(-P.IH_RATE * (mortNow - (n.mortRef ?? mortNow)));
  d.Ih += (ihT - d.Ih) / P.IH_M;
  // GOVERNMENT: a steady share, a fiscal expansion under political pressure, the tools at the floor
  const G = P.G0 + ((n.pressureM ?? 0) > 0 && x.shock !== 0 ? 0.6 * Math.abs(x.shock) : 0) + 0.009 * x.lbTools + (sw?.g ?? 0);
  // THE WORLD IS AN ECONOMY TOO (2026-10-16). Exports rode a drawn AR(1)
  // standing in for the rest of the world. Now the rest of the world has its
  // own output gap (`d.f`), which its own spending shocks move and its own
  // central bank leans against (a real policy-rate gap `d.wr` that follows
  // its gap over half a year), and the two economies meet in the exchange
  // rate (`d.q`, log real, + is a dear dollar): money flows to the higher
  // real rate, so a home rate a point over the world's lifts the dollar about
  // 4% over a year (uncovered interest parity with the persistence measured
  // in it — Engel 2014). Exports sell into the world's demand (income
  // elasticity 1.5, Houthakker-Magee) at the exchange rate (price elasticity
  // 0.5); imports get cheaper as the dollar rises (0.3). A tight Fed therefore
  // hurts exporters twice — through the dollar as well as through the rate.
  const z = Math.sqrt(-2 * Math.log(Math.max(1e-9, rng(s, "nation")))) * Math.cos(2 * Math.PI * rng(s, "nation"));
  d.wr = (d.wr ?? 0) + (ROW.POL * d.f - (d.wr ?? 0)) / ROW.POL_M;
  d.f = ROW.RHO * d.f - ROW.RATE * (d.wr ?? 0) + ROW.SIG * z;
  const homeReal = (n.policy ?? 4) / 100 - (n.inflExp ?? 0.02) - (n.neutralReal ?? 0.019);
  d.q = (d.q ?? 0) + (ROW.UIP * (homeReal - (d.wr ?? 0)) + (sw?.q ?? 0) - (d.q ?? 0)) / ROW.Q_M;
  const X = X0 * Math.exp(ROW.X_INC * (d.f + (sw?.f ?? 0)) - ROW.X_PRICE * (d.q ?? 0) + (sw?.x ?? 0));
  const M = P.IMP * (d.C + d.I + d.Ih + G) * Math.exp(ROW.M_PRICE * (d.q ?? 0));
  const S = d.C + d.I + d.Ih + G + X - M;
  // INVENTORIES: shelves follow sales; production is sales plus restocking
  d.Se += (S - d.Se) / 3;
  const invInv = Math.max(-0.06, Math.min(0.06, (P.NU * d.Se - d.N) / (P.TAU_N / 12)));
  d.N += invInv / 12;
  // SUPPLY: an oil shock takes real output while it runs (an adverse one; a favourable one gives it)
  const supShock = (n.pressureM ?? 0) > 0 ? 0 : x.shock;
  d.sup += (0.5 * supShock - d.sup) / 6;
  d.Y = S + invInv - d.sup;
  return d.Y - 1;
}

/**
 * THE FLATS' COMPS: every flat let or renewed in the last six months — its
 * rent over the block's market rent the month it signed (`c`, log) — from
 * which the flats' effective rent is read (streetRolls.ts `tickStreetFlats`).
 * (Offices, shops and sheds are comps in tenantMarket.ts recordLease.)
 */
export function recordDeal(e: Econ, k: BuiltClass, m: number, rel: number, sf: number, renewal = false) {
  if (k !== "multifamily" || !(rel > 0) || !(sf > 0)) return;
  const list = ((e.deals ??= {})[k] ??= []);
  list.push({ m, c: +Math.log(rel).toFixed(5), sf: Math.round(sf), ...(renewal ? { r: 1 } : {}) });
  while (list.length && list[0].m < m - 6) list.shift();
  // (shift, not splice: the same array, and V8 trims the front in place.)
  while (list.length > 400) list.shift();
}

/**
 * THE PRICE LEVEL A RENT IS RE-MARKED TO: the published index for the
 * trailing year, less shelter (a rent marked to a price level that contains
 * it indexes itself), as a lease's CPI clause reads it; expected inflation
 * before there is a year of record.
 */
export function priceLevel12(e: Econ): number {
  const h = e.history.length >= 12 ? e.history[e.history.length - 12] : undefined;
  return h?.cpiXS ? (e.cpiXS ?? 1) / h.cpiXS - 1 : h?.cpi ? (e.cpi ?? 1) / h.cpi - 1 : (e.inflExp ?? 0.02);
}

/** Of the nation's drawn shocks, the share that are supply shocks; the other 0.30 were the wars' finance, now drawn as THE WAR (blackswans.ts). */
const SUPPLY_SHARE = 0.70;

export function tickNation(s: GameState) {
  const e = s.econ;
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
  // ...AND IT ACTUALLY GETS THERE (2026-10-28). The walk above pulled toward
  // 1.4% at 0.0009 a month (a 64-year half-life) on noise of +/-0.035 points,
  // a stationary spread of about half a point: measured over 40 national
  // centuries the ten-year index never went under 2.6% in nine of ten, and a
  // whole century could run its policy rate between 2% and 7% (market seed
  // 550991, 100 years: sd 0.9 points). Laubach-Williams r* fell about three
  // points between the 1960s and the 2010s — a 25-year clock, not a 64-year
  // one — and it is that wander, not inflation, that gives a century a
  // high-rate era and a zero-rate era with ordinary inflation in both.
  // Reversion 0.0023 a month is a 25-year half-life; noise +/-0.13 points a
  // month holds a stationary spread of about 1.1 points round 1.4%, so the
  // anchor spends most of its time inside Laubach-Williams' 0-3.5% and a
  // century can visit either end. Shape parameters read off that record.
  if (n.neutralAnchor === undefined) n.neutralAnchor = n.neutralReal;
  n.neutralAnchor = clamp(
    n.neutralAnchor + 0.0023 * (0.014 - n.neutralAnchor) + rrange(s, -0.0013, 0.0013, "nation"),
    -Infinity, Infinity,
  );
  n.neutralReal = clamp(n.neutralReal + 0.004 * (n.neutralAnchor - n.neutralReal)
    + rrange(s, -0.00020, 0.00020, "nation"), -Infinity, Infinity);
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
  // THE HAZARD NOW MATCHES THE COMMENT ABOVE IT. "About one a decade" was
  // written next to 0.0022/month, which is one every thirty-eight years —
  // measured over 3 seeds x 50 years, the whole apparatus above (fiscal
  // pressure, credibility, the ease channel) fired so rarely that CPI came
  // out at sd 1.0% with zero years over 5% in a hundred and forty-seven.
  // The US record 1946-2025 has an episode roughly every decade: 1946-48,
  // 1951, 1969-71, 1973-75, 1978-82, 1990, 2021-23. At 0.006/month the base
  // rate alone is one per fourteen years, and clustering carries the rest of
  // the way to the record's cadence — the seventies stay a cluster, not a
  // constant.
  const shockHaz = SUPPLY_SHARE * (0.006 + (n.shockClusterM > 0 ? 0.0050 : 0));
  if (n.shockM > 0) { n.shockM--; } else if (rng(s, "nation") < shockHaz) {
    n.shockM = Math.round(rrange(s, 10, 26, "nation"));
    n.shockClusterM = Math.round(rrange(s, 60, 130, "nation"));
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
    // ...AND SINCE THE SWANS SPLIT, THAT THIRD KIND IS THE WAR (2026-10-30).
    // Three in ten of these draws were the bond-financed fiscal expansion —
    // the record above, 1951 and the Vietnam build-out — and THE WAR
    // (blackswans.ts, #529) is drawn there off the same record (Korea,
    // Vietnam, the Gulf, Iraq, Ukraine) with its own defense spending and its
    // own pressure on the bank. The same episodes came twice. So the nation
    // now draws only the supply shocks, at their own rate (seven tenths of
    // the 0.006 and the cluster's 0.005, of which 0.42 adverse), and the war
    // brings its own finance and its own pressure on the bank, once.
    // MEASURED (national block with the swans on, 20 seeds x 100 years, with
    // the rule at 1.5 below): recession months 22.6% -> 19.2%; inflation's
    // p90 6.6% -> 4.6% — the nation's fiscal draw held the bank 30-96 months,
    // the war's record says 9-18 and only for the largest (blackswans.ts).
    const adverse = rng(s, "nation") < 0.42 / SUPPLY_SHARE;
    n.shockSev = (adverse ? 1 : -0.7) * rrange(s, 0.012, 0.055, "nation");
    pushNews(s, adverse ? "warn" : "event", adverse
      ? "National supply shock: prices rising without demand; "
        + "rate cuts will not help."
      : "Favourable supply shock: input costs falling nationally; "
        + "room for rate cuts.");
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

  // --- THE NATIONAL ECONOMY IS SIMULATED, NOT DRAWN (2026-10-15) -------------
  //
  // A recession used to be a dice roll: a monthly hazard read off the yield
  // curve, then a depth and a length drawn from the post-war record. The same
  // depth was expected whether money stood at 6% or at 20%, and nothing about
  // rates touched output except the odds of the roll.
  //
  // Now the output gap is a state and spending moves it. The core is the
  // Rudebusch-Svensson (1999) demand equation fitted on US data 1961-96 —
  //   y(t) = 1.16 y(t-1) - 0.26 y(t-2) - 0.09 (i - pi - r*)(4-qtr avg, lagged)
  // — restated monthly with the same roots (0.95 and 0.67 a month) and the
  // same long-run multiplier (0.9 points of output per point of real rate held
  // over neutral). Higher money slows spending with a hump-shaped lag of about
  // a year; held long enough it tips output into decline, and that decline is
  // what a recession IS — dated afterwards from output, as the NBER dates one.
  //
  // Split across the channels rates actually travel through:
  //  · the real short rate, averaged over the last year (consumers, inventory,
  //    housing turnover, the bank-lending margin);
  //  · what companies PAY on their debt — about a third floats and reprices
  //    every month, the rest is fixed and rolls over a six-year ladder at the
  //    long rate of the day (Fed Z.1 nonfinancial corporate debt; Compustat
  //    maturity profiles). A spike that reverses costs little; years of high
  //    rates walk through the whole book. Same multiplier in total.
  //  · credit availability (the national window: a crunch cuts lending to
  //    anyone who needs it — Bernanke-Gertler's financial accelerator, since
  //    the window itself tightens as unemployment rises);
  //  · a bank panic, an oil shock (supply: prices up AND output down), a
  //    fiscal expansion (demand: both up), and ordinary demand noise.
  // Unemployment follows output by Okun's law (two points of output a point
  // of unemployment), rising fast and falling slowly — firms fire in weeks and
  // hire over years.
  const rStar = n.neutralReal;
  const exAnte = n.policy / 100 - (n.inflExp ?? n.infl);
  (n.rHist ??= []).push(exAnte);
  if (n.rHist.length > 13) n.rHist.shift();
  const rAvg = n.rHist.length > 1
    ? n.rHist.slice(0, -1).reduce((acc, v) => acc + v, 0) / (n.rHist.length - 1) : exAnte;
  // The corporate book: floating legs at the short index plus a credit spread,
  // the fixed ladder rolling 1/72 a month at the long rate plus a spread.
  const longRate = (e.indexRate ?? 5.4) / 100;
  const shortRate = n.policy / 100;
  n.corpFixed ??= longRate + 0.015;
  n.corpFixed += (longRate + 0.015 - n.corpFixed) / CORP_LADDER_M;
  // ...plus whatever a national swan has done to credit spreads (blackswans.ts natSw.sp: a foreign crisis).
  const corpRate = CORP_FLOAT * (shortRate + 0.02) + (1 - CORP_FLOAT) * n.corpFixed + (e.natSw?.sp ?? 0);
  n.corpRate = corpRate;
  // Against what that book would cost at neutral money: r* plus expected
  // inflation, plus the same blended spread.
  const corpNeutral = rStar + (n.inflExp ?? 0.02) + CORP_FLOAT * 0.02 + (1 - CORP_FLOAT) * 0.015;
  if (n.gap === undefined) { n.gap = -2 * (n.unemp - NAT_U_STAR); n.gap1 = n.gap; }
  const y1 = n.gap;
  // THE OTHER TOOLS. A bank at its floor whose rule wants far lower does not
  // sit still and neither does the government: asset purchases, forward
  // guidance and fiscal stimulus (2009-14, Japan after 2013) push demand
  // where the rate cannot — about a point of output per point the rule sits
  // under the floor, at most five.
  const lbTools = n.policy <= 0.5 ? Math.min(5, Math.max(0, n.policy - (n.ruleRate ?? n.policy) - 1)) : 0;
  n.gap1 = y1;
  n.gap = spendNation(s, e, n, { rAvg, rStar, corpRate, corpNeutral, shock, lbTools });
  // THE CREDIT CYCLE (2026-10-15). Private credit against its trend, as a
  // share of output (the BIS credit-to-GDP gap; US range roughly -10 to +12
  // points, +12 at the 2007 top). It builds while money is cheap against
  // neutral, lenders' standards are loose and the economy runs hot; it is
  // written down in recessions as loans default; and the trend catches up
  // with it over about a decade. A bank panic's odds read it
  // (blackswans.ts): credit booms are the best single predictor of financial
  // crises there is (Schularick & Taylor 2012).
  {
    const g0 = n.credGap ?? 0;
    n.credGapPrev = g0;
    const build = CRED_PER_EASY_PT * Math.max(-3, Math.min(4, (rStar - rAvg) * 100))
      + CRED_PER_WINDOW * ((n.creditNat ?? 1) - 1)
      + CRED_PER_GAP * Math.max(0, y1);
    // Defaults follow the labour market: about 1.5% of output a year per two
    // points of unemployment over its natural rate (US charge-offs 2009-10
    // ran ~2.5-3% of loans, loans ~1.5x GDP... less recoveries).
    const writeOff = CRED_RECESSION_WRITEOFF * Math.max(0, n.unemp - NAT_U_STAR - 0.01) / 0.02;
    n.credGap = g0 + build - writeOff - g0 / CRED_TREND_M;
  }
  tickHouseholds(e, n, y1);
  // The curve banks lend on: long minus short, smoothed over a year (loan
  // books reprice slowly, and a bank's margin is its whole book's).
  n.curveSm = (n.curveSm ?? ((e.indexRate ?? 5.4) - n.policy)) + (((e.indexRate ?? 5.4) - n.policy) - (n.curveSm ?? 0)) / 12;
  // Output itself — potential grows ~2%/yr — so the cycle can be dated.
  n.lnY = (n.lnY ?? 0) + 0.02 / 12 + (n.gap - y1);
  const inRecNow = (n.recM ?? 0) > 0;
  if (!inRecNow) {
    n.expM = (n.expM ?? 0) + 1;
    n.yPeak = Math.max(n.yPeak ?? n.lnY, n.lnY);
    // Half a per cent off the peak is a contraction, not a soft quarter.
    if (n.lnY < (n.yPeak ?? n.lnY) - REC_DROP) {
      n.recM = 1; n.uStart = n.unemp; n.uPeak = n.unemp; n.yTrough = n.lnY; n.deep = false;
      pushNews(s, "warn", "National recession: output falling, "
        + "payrolls next.");
    }
  } else {
    n.recM = (n.recM ?? 0) + 1;
    n.yTrough = Math.min(n.yTrough ?? n.lnY, n.lnY);
    // Over once output has climbed back half a per cent off the trough.
    if (n.lnY > (n.yTrough ?? n.lnY) + 0.005) {
      n.recM = 0; n.expM = 0; n.deep = false; n.yPeak = n.lnY;
      pushNews(s, "event", "National recession officially over; recovery not yet felt.");
    }
  }

  // Okun's law, with the labour market's own asymmetry.
  // ...WHICH BENDS AT THE BOTTOM. A boom cannot hire people who are not
  // there: past ~3.5% the remaining unemployed are between jobs, and the
  // post-war lows were 2.5% (1953) and 3.4-3.5% (1969, 2000, 2019). Below
  // 3.5% Okun's level approaches 2.5% and never passes it; the excess demand
  // goes into pay and prices instead (the Phillips curve already sees it).
  const okunRaw = NAT_U_STAR - n.gap / OKUN;
  const uTarget = okunRaw >= 0.035 ? okunRaw : 0.025 + 0.01 * Math.exp((okunRaw - 0.035) / 0.01);
  const uMove = (uTarget - n.unemp) * (uTarget > n.unemp ? U_UP_SPEED : U_DOWN_SPEED);
  n.unemp = clamp(n.unemp + uMove
    + (shock > 0.02 && !((n.pressureM ?? 0) > 0) ? 0.0003 : 0) + rrange(s, -0.0004, 0.0004, "nation"), 0, 1);
  if ((n.recM ?? 0) > 0) {
    n.uPeak = Math.max(n.uPeak ?? n.unemp, n.unemp);
    if (!n.deep && n.unemp - (n.uStart ?? n.unemp) >= 0.05) {
      n.deep = true;
      pushNews(s, "warn", "Deep national recession: payrolls collapsing, "
        + "no bottom in sight.");
    }
  }

  // National inflation: expectations, plus a Phillips term, plus the shock.
  // THE PHILLIPS CURVE IS CONVEX. Slack disinflates weakly — you cannot get
  // prices to fall much no matter how bad it gets, which is why the 2010s had
  // 8% unemployment and 1.5% inflation instead of the deflation the linear
  // version predicts — while a labour market past full employment bids pay up
  // at an accelerating rate. A straight line through the origin gets both
  // ends wrong.
  // The nation keeps its own year of unemployment, so the credit window can
  // read how fast it is rising even in the pre-history, where the town keeps
  // no record (natUnempRise12).
  (n.uHist ??= []).push(n.unemp);
  if (n.uHist.length > 13) n.uHist.shift();
  const uStar = NAT_U_STAR;
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
  // AND THE CHANNEL IS STICKY DOWNWARD, like the Phillips curve above it.
  // Money held DEAR disinflates far more weakly than money held cheap
  // inflates, because wages and contract rents are rarely cut in nominal
  // terms (downward nominal rigidity: Akerlof-Dickens-Perry 1996; Daly-Hobijn
  // 2014). The symmetric form was a deflation trap: at the zero bound
  // falling prices raise the real rate, the real rate pushed prices down
  // further through this term, and nothing stopped it. Measured on the
  // national model alone (40 centuries): prices under -2% in 4.4% of months,
  // twenty deflations longer than two years, the longest SEVENTEEN years, the
  // policy rate pinned at the floor 16.6% of the time. The post-war US record
  // has CPI under -2% only for a few months of 1949 and 2009, and Japan spent
  // fifteen years at zero with prices drifting -0.3% a year, not spiralling.
  // Half-strength on the tight side is a shape parameter, the weakest that
  // ends the trap: under -2% 1.6%, longest spell 50 months, floor 11.1% (the
  // US since 1950: ~11%); the inflation side is untouched (months over 6%
  // 5.2% either way, median century peak 9.4 → 9.1%). A third (0.3) moved
  // the deflation share only another point.
  // ...AND CHEAP MONEY ONLY INFLATES WHAT IT CAN FILL (2026-10-13). With slack
  // in the labour market easy money mostly fills the slack: the US held
  // policy at zero with real rates near -2% through 2009-15 and inflation ran
  // ~1.5%; Japan held zero for fifteen years without inflating (the liquidity
  // trap — Krugman 1998). At full strength this channel added ~+2 points
  // DURING a deep recession, more than the slack took off, so prices rose
  // through the worst slumps and median inflation drifted up with recession
  // depth. Its pass-through now falls with slack: e^(-slack / 2 points),
  // which leaves 2009-15 (about three points of slack) near target, and the
  // 1970s and 2021 — easy money into a tight labour market — at full force.
  const passThrough = Math.exp(-Math.max(0, n.unemp - NAT_U_STAR) / 0.02);
  const easy = 0.55 * (n.easeEma >= 0 ? n.easeEma * passThrough : 0.5 * n.easeEma);
  // DOWNWARD NOMINAL RIGIDITY BENDS THE CURVE AT ZERO (2026-10-13). Pay and
  // contract rents are rarely cut in nominal terms, so the forces pulling
  // inflation DOWN — slack and dear money — lose their grip as inflation
  // nears zero and past it (Akerlof, Dickens & Perry 1996; Daly & Hobijn
  // 2014, "Downward nominal wage rigidities bend the Phillips curve"). The
  // record: Volcker's disinflation landed at ~3%, not below zero; 2009 ran
  // -0.4% at 10% unemployment; Japan's lost decades -0.3%/yr. Without the
  // bend, a low-credibility disinflation overshot to -3% with unemployment
  // at 4.3% (12 deflation years in one measured century against 3 in the US
  // since 1945). The downward terms are scaled by e^((last inflation - 1%)
  // / 1%) below 1%: whole at 1% and above, about a third at zero, a seventh
  // at -1%. Deflation stays possible; a spiral at full employment does not.
  const down = Math.min(0, phillips) + Math.min(0, easy);
  const bend = n.infl >= 0.01 ? 1 : Math.exp((n.infl - 0.01) / 0.01);
  const inflRaw = n.inflExp + (phillips - Math.min(0, phillips)) + (easy - Math.min(0, easy)) + down * bend
    + shock + (e.natSw?.infl ?? 0) + rrange(s, -0.004, 0.004, "nation");
  // PRICES FOLLOW PAY, AND PAY IS NOT CUT (2026-10-15). With the bank's word
  // gone, expectations could follow realised deflation down without limit: one
  // measured century ran -6%/yr for a decade at 7-8% unemployment while
  // nominal pay sat frozen (downward rigidity), so real pay rose 75% in a
  // slump. Post-war deflations under fiat money were shallow — Japan
  // 1998-2012 about -0.3%/yr, the US 2009 -0.4%, Hong Kong 1999-2003 about
  // -2% at worst — because the largest cost in every price is a wage that is
  // not cut. Below zero the price level falls toward a soft floor near -2%:
  // deflation stays possible, a spiral does not.
  n.infl = inflRaw >= 0 ? inflRaw : -DEFLATION_FLOOR * (1 - Math.exp(inflRaw / DEFLATION_FLOOR));

  // EXPECTATIONS UNANCHOR WHEN THE BANK IS NOT BELIEVED — and that is what
  // makes an inflation a decade rather than a year. Credibility is spent in
  // proportion to the miss, not by a flat penalty: a bank running 3% over is
  // in trouble, and a bank running 8% over is not in three times the trouble,
  // it is in a different job. It is earned back slowly, and faster when the
  // bank is visibly holding real rates high into a disinflation — that is the
  // whole of what Volcker actually bought with 10.8% unemployment.
  // Earned back at 0.35 points a month on target (2026-10-13; was 0.20):
  // from a collapse to a believed bank in about twenty years rather than
  // thirty-five — the US re-anchored long-run expectations within a decade
  // or so of 1983 (Michigan 5-10yr expectations ~3% by the mid-1990s).
  // JUDGED ON THE YEAR, AGAINST THE BANK'S OWN TARGET (2026-10-15). This read
  // the month's print — which carries +/-0.4 points of noise by itself — against
  // a hard-coded 2%, so a bank sitting on its own drifting target lost belief
  // most months by arithmetic: measured over 30 centuries, credibility under
  // 0.5 in 51% of months and a median ten-year term premium of 3.4 points
  // (ACM 1961-2024: median ~1.2, p90 ~3.5; low credibility was ~1970-85). The
  // public reads inflation as a year-on-year rate and measures the bank
  // against the target it has announced.
  // A DISINFLATION TOWARD PRICE STABILITY IS NOT A MISS (2026-10-28). The
  // target drifts toward realised inflation while the bank is disbelieved
  // (regime.ts driftInflTarget), so after an inflation it sits at 4-6%. Read
  // symmetrically against that drifted target, a bank that then brought
  // inflation DOWN to 1-2% was "missing" by three or four points and kept
  // spending belief it did not have: measured on the national block alone
  // (market seed 73303), credibility sat under 0.1 for thirty years straight
  // through a decade of 1% inflation, and every supply shock in that stretch
  // became a 10-16% inflation because nobody believed anything. The public
  // judges an overshoot against what the bank has let itself drift to, and an
  // undershoot against price stability (2%): the Volcker disinflation BOUGHT
  // credibility, it did not cost it (Michigan long-run expectations fell from
  // ~9% in 1980 to ~3% by the mid-1990s as inflation came down).
  const tgtNow = n.inflTarget ?? 0.02;
  const inflSeen = n.inflSm ?? n.infl;
  const miss = inflSeen >= tgtNow ? inflSeen - tgtNow : Math.min(0, inflSeen - Math.min(tgtNow, 0.02));
  const am = Math.abs(miss);
  // NO STOPS (2026-10-13). This was clamped to 0.10..0.99 and rested on the
  // 0.99 stop 47% of months. The walk is unchanged wherever belief is more
  // than a couple of points from certainty or collapse; within that, each
  // step shrinks with the room that is left, so the share approaches 0 and 1
  // and never reaches either. (A log-odds walk was tried first: a long calm
  // then stockpiled so much belief that no inflation could spend it, and
  // the Volcker episodes disappeared.)
  const c = n.credibility;
  n.credibility = c + (am < 0.010
    ? (0.0035 + (realPolicy > 0.03 ? 0.0022 : 0)) * (n.chair?.resolve ?? 1) * (1 - c) / (1 - c + 0.02)
    : c * Math.expm1(-(0.003 + 0.20 * (am - 0.010)) / (c + 0.02)));
  // A believed bank's anchor beats the pass-through and expectations sit at
  // target; a disbelieved one's does not, and then last year's inflation
  // becomes next year's baseline. Those two regimes are the Great Moderation
  // and the Great Inflation, and the same four lines produce both.
  const anchorPull = 0.034 * n.credibility;
  n.inflExp = clamp(
    n.inflExp + (1 - 0.70 * n.credibility) * 0.08 * (n.infl - n.inflExp)
      - anchorPull * (n.inflExp - 0.02),
    -Infinity, Infinity);

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
      + 0.011 * 0.045 * Math.tanh((n.inflSm - 0.02) / 0.045)
      + rrange(s, -0.0018, 0.0018, "nation"),
    0.005, Infinity);

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
  // THE CHAIR CHANGES HANDS (2026-10-13). One reaction function for a whole
  // century made the bank a single mind: a regime that lost its nerve kept
  // losing it until the credibility arithmetic alone turned it round. Real
  // banks are run by people on terms — Martin, Burns, Miller, Volcker,
  // Greenspan, Bernanke, Yellen, Powell, four to twelve years apiece — and
  // the regime breaks line up with them: Burns let the 1970s run, Volcker
  // broke them inside three years. Each chair draws a RESOLVE: the willingness
  // to take the pain — how hard the Volcker restore term bites once
  // credibility is gone, and how fast credibility is earned back on target.
  // NOT the Taylor weight: scaling that made a hawk swing rates harder both
  // ways, and with the channel sticky downward (easy money inflates more than
  // tight money disinflates) the swings ratcheted prices UP — measured, a
  // hawkish-skewed draw averaged 2.7%/yr against 2.2% on main. Most
  // chairs are ordinary (resolve near 1); the lognormal's tails are the
  // Burnses and the Volckers. Credibility carries over: a new chair inherits
  // whatever the public believes. Term and spread are shape parameters.
  const chair = centralBankChair(s, n);
  const restore = n.credibility < 0.55 && seen > 0.045
    ? (0.55 - n.credibility) * 10.5 * chair.resolve : 0;
  // ...against the target the bank actually holds, which drifts. See
  // regime.ts: 0.02 was written here as a constant and it is the reason a
  // century could not contain two different monetary worlds.
  const tgt = n.inflTarget ?? 0.02;
  // THE BANK LEANS ON INFLATION HARDER THAN TAYLOR'S 1993 HALF (2026-10-28).
  // Taylor's rule put 1.5 on inflation in all; estimated on the record since
  // 1979 the Fed's response is about 2 (Clarida, Gali & Gertler 2000: 2.15
  // for Volcker-Greenspan, 0.83 before). At 1.5 the bank moved so little that
  // measured over 40 national centuries the policy rate spent 1.6% of months
  // under 1% and a median century never saw it below zero or above 12%:
  // shocks were absorbed by inflation and unemployment instead of by the
  // price of money. At 2.0, the same century's rate cuts toward zero in a
  // slump and hikes into a boom (policy under 1% in 6-9% of months; US
  // 1954-2024 ~15%), with inflation no higher on average and its worst
  // centuries lower.
  // BUT 2.15 IS THE RESPONSE TO A FORECAST, AND THIS RULE READS THE PAST
  // (2026-10-30). Clarida, Gali & Gertler's rule is forward-looking: the rate
  // answers expected inflation a year AHEAD. `seen` is a smoothed trailing
  // reading (inflSm, a monthly weight of 0.085: about a year behind), which is
  // Taylor's (1993) input — inflation over the previous four quarters — and
  // 1.5 is the coefficient estimated on that input. Two points on a reading a
  // year late, with policy reaching output 18-20 months after that, is a bank
  // steering by the wake: measured on the national block alone (20 seeds x
  // 100 years), 2.0 here put 27% of months in recession (US post-war ~14%)
  // against 20% at 1.5, recessions 16 months long against 13.6 (US ~11), and
  // applying CGG's output weight as well (0.93) made it worse still (40%) —
  // the overshoot of a rule fed late data, not a hawk. The wider swings the
  // 2.0 was reaching for come from the wandering neutral rate above (policy
  // under 1% in 3-6% of months, against 1.6% before that walk widened).
  const want = 100 * (n.neutralReal + seen + 0.5 * (seen - tgt) + 0.5 * okunGap) + restore;
  n.ruleRate = +want.toFixed(3);
  // Gradualism, except when it is not: a bank moves in quarter points at
  // eight meetings a year, and in three-quarter points when it is frightened.
  //
  // THE CODE USED TO BE A MONTHLY EMA. That is not how a central bank
  // works, and it is why a player could read the next print from the last
  // one: once the rule pointed up (or down) the rate ticked that way every
  // month. Eight scheduled meetings, a hold when the gap is noise, a
  // quarter-point ordinary move, a half when the gap is large, three
  // quarters when the bank is frightened. Between meetings the policy rate
  // does not move. The loan index still has a little market noise so the
  // tape is not frozen.
  //
  // Calendar is month-of-year 0-indexed: Jan, Mar, Apr, Jun, Jul, Sep,
  // Oct, Dec — close to the real FOMC year.
  const meeting = isMeetingMonth(s.month);
  // ...unless it is not free to move. Under fiscal pressure the bank can
  // still cut freely and can barely tighten, which is the whole asymmetry
  // and the whole mechanism: money stays cheap into a real inflation, the
  // ease compounds through expectations, and when the pressure finally lifts
  // the bank has to break the labour market to undo it.
  if (n.pressureM === undefined) n.pressureM = 0;
  if (n.pressureM > 0) {
    // INFLATION ENDS FISCAL DOMINANCE (2026-10-14). A government leans on
    // its central bank only while cheap money is popular; once inflation is
    // the country's problem, the politics flip and the bank is set free —
    // the 1951 Treasury-Fed Accord came after 1950-51 inflation near 9%, and
    // Volcker was appointed in 1979 with it running 11-13%. Without this the
    // pressure ran its full term into a 70% inflation and a 105% policy rate.
    if ((n.inflSm ?? n.infl) > 0.10) n.pressureM = 1;
    n.pressureM--;
    if (n.pressureM === 0) {
      pushNews(s, "event",
        "Central bank independence restored; "
        + "expect tightening to catch up on inflation.");
    }
  }
  if (meeting) {
    const uRise6 = n.uHist && n.uHist.length >= 7 ? n.unemp - n.uHist[n.uHist.length - 7] : 0;
    let step = bankStep(want - n.policy, restore > 0, n.pressureM > 0, uRise6);
    // No floor (2026-10-13): the rule may take the rate below zero, as the
    // ECB, the SNB and the Bank of Japan did — but each cut below zero is
    // harder to make than the last, because cash pays zero. Past the cost of
    // vaulting it, deposits leave the banks for currency and the cut stops
    // transmitting (Rogoff 2016, "The Curse of Cash"; the deepest real rates
    // were the SNB's -0.75% and the Danmarks Nationalbank's -0.75%). So a
    // committee that wants to go lower makes the cut with odds that fall
    // with the depth it would reach: about 50/50 at -0.25, one in nine at
    // -0.75, one in eighteen at -1. A lower bound that emerges, not a stop.
    if (step < 0 && n.policy + step < 0
        && rng(s, "nation") > Math.exp((n.policy + step) / 0.35)) step = 0;
    const was = n.policy;
    n.policy = n.policy + step;
    // A RATE DECISION IS NEWS. It once stopped the game like a new chair and
    // a swan (the policy rate is what every floater resets on next month and
    // what the bond market prices the fixed index off); see below for why it
    // no longer does. A meeting that holds is not news at all.
    if (Math.abs(step) >= 0.01) {
      const up = step > 0;
      const infl = ((n.inflSm ?? n.infl ?? 0) * 100).toFixed(1), un = ((n.unemp ?? 0) * 100).toFixed(1);
      const turn = n.lastStep !== undefined && n.lastStep !== 0 && Math.sign(n.lastStep) !== Math.sign(step);
      const title = `The central bank ${up ? "raises" : "cuts"} rates ${Math.abs(step).toFixed(2)} to ${n.policy.toFixed(2)}%${turn ? ` — the first ${up ? "hike" : "cut"} of a new cycle` : ""}`;
      const body = `${up ? "Tightening" : "Easing"} from ${was.toFixed(2)}% with inflation at ${infl}% and unemployment at ${un}%. `
        + `Floating loans reset on the new rate next month (through any cap you bought); the short index is now ${shortIndexFor(n.policy, e.creditIdx ?? 1).toFixed(2)}%. `
        + (up ? "Dearer money reaches cap rates and lending before it reaches rents." : "Cheaper money reaches refinancing and land bids first, rents later.");
      // ONLY THE MASSIVE MOVES STOP THE GAME (owner, Oct 2026: "it should only
      // pop up when something massive happens or the chair's switched"). A
      // point or more in one meeting — the Volcker-scale moves — always takes
      // the screen; a crisis-sized three-quarters takes it once, the first
      // time after a calm year, and the meetings that follow it are in the
      // news. Everything else, a new cycle's first move included, is in the
      // news. (It used to stop on every turn of the cycle and every half
      // point, which in a recession was most meetings.)
      //
      // AND THEN NOT AT ALL (owner, Oct 2026: "it pops up almost every month,
      // very annoying ... don't even show pop ups for when rates move, only
      // when the fed changes"). In an inflation fight the committee moves a
      // full point at meeting after meeting, and every one took the screen.
      // A rate decision is news; only a new chair stops the game (above).
      s.news.unshift({ q: s.month, kind: "info", text: `${title}. ${body}` });
      n.lastStep = step;
    }
  }

  // THE LOAN INDEX IS A FORECAST, PLUS A PRICE FOR BEING WRONG ABOUT IT.
  //
  // This used to be policy + premium: the index moved point for point with
  // every step the committee took. Measured over 12 cities x 50 years against
  // FRED (10-year Treasury vs fed funds, 1954-2026), that made the one rate a
  // borrower locks in the most predictable number in the game:
  //   12m change in the index per point of 12m policy change   1.00 (US 0.32)
  //   R2, next-12m index change on last-6m short-index change  0.13 (US 0.01)
  //   months the curve was inverted                            0.0% (US 20.8%)
  //   recessions preceded by an inversion                    0 of 78 (US 8 of 10)
  // A player who saw the short rate climb could lock fixed and beat a hiking
  // cycle the bond market would, in life, have priced at its first step.
  //
  // So the index is what a ten-year bond is: the market's expectation of the
  // policy rate averaged over the next ten years (`expectedPolicyAvg`, the
  // committee's own rule run forward), plus a term premium. Expected hikes are
  // in the price before they happen; at the top of a cycle, with cuts ahead,
  // the long rate sits under the short one and the curve inverts on its own.
  //
  // THE PREMIUM IS A MARKET, NOT A CONSTANT. It is state: it mean-reverts
  // toward `termPremBase` while real market noise hits it every month, so
  // direction month to month stays a coin flip (the earlier fix: an EMA index
  // had 66-70% of monthly moves continuing). The noise bound is a calibrated
  // shape: +/-0.30 uniform is ~17bp/month sd, inside the 15-25bp a 10-year
  // yield shows month over month. Reversion 0.10/mo is the noise's, not the
  // premium's: the LEVEL it reverts to moves on credibility's own decade-long
  // clock. Bounds -1.5..6 bracket the observed range (ACM: about -1 in 2020,
  // about 5 in 1981) — guards, not rails.
  // THE NATION'S CREDIT, NOT THIS TOWN'S (2026-10-14). The premium read the
  // city's credit index, which reads the city's payrolls — so a developer's
  // cranes moved the ten-year yield, and through the curve the recession
  // hazard. The national window is the same equation as `stepCredit` on
  // national inputs only: the unemployment rise, the curve, a panic.
  {
    const curveN = 0.08 * (((e.indexRate ?? 5.4) - n.policy) - 1.2);
    const tgt = clamp(1.0 - 14 * Math.max(0, natUnempRise12(e)) + curveN - 0.7 * (e.panic?.force ?? 0), 0.4, 1.25);
    const cn = n.creditNat ?? 1;
    n.creditNat = clamp(cn + (tgt < cn ? 0.16 : 0.055) * (tgt - cn), 0.4, 1.25);
  }
  const premBase = termPremBase(n.credibility, n.creditNat ?? 1, n.inflExp, n.inflTarget ?? 0.02);
  if (n.termPrem === undefined) n.termPrem = premBase;
  n.termPrem = n.termPrem + 0.10 * (premBase - n.termPrem) + rrange(s, -0.30, 0.30, "nation");
  // THE MARKET LEARNS WHERE THE BANK RESTS (2026-10-13). The forecast assumed
  // the rule's gap always closes at the economy's cycle speed, so a bank that
  // held three points over the model's long-run level for a decade left the
  // ten-year under the short rate for that whole decade — a playthrough found
  // the curve inverted 2002-2013 through an expansion. Real long rates move
  // their endpoint when the short rate stays put (Kozicki & Tinsley 2001;
  // Gurkaynak, Sack & Swanson 2005): the market's long-run level is learned
  // from where policy has actually sat, at about the gain Kozicki-Tinsley
  // estimate (~0.02 a quarter, here 1/144 a month — a twelve-year memory).
  {
    const cr = n.credibility, tg = n.inflTarget ?? 0.02;
    const modelLR = 100 * (n.neutralReal + cr * tg + (1 - cr) * n.inflExp);
    n.endShift = (n.endShift ?? 0) + (n.policy - modelLR - (n.endShift ?? 0)) / 144;
  }
  const path = expectedPolicyAvg(n, want, restore > 0, s.month);
  e.indexRate = path + n.termPrem;
  e.shortIndex = shortIndexFor(n.policy, e.creditIdx ?? 1);
  // the era, for anything that still reads it — now an OUTPUT of the nation
  e.rateRegime = path + premBase;
}


// ---------------------------------------------------------------------------
// THE CITY'S INDUSTRIES, AND THE CYCLE THEY MAKE.
//
// RETIRED 2026-10-28 (ONE ECONOMY step 2): the ten trades' national trends,
// cycle betas, shocks, local fortunes, the composite of export and local
// work at a fixed multiplier (Moretti's 1.6), the boom/bust episodes and the
// trades' own aggregate books. The town's work is its industries' now
// (economy.ts): what the nation buys of each — its CES trend and its cycle
// (industries.ts NAT_TREND, CYCLE_BETA), the town's share of it moving with
// what the town costs and its firms' fortunes — and what the town and its
// people buy, through the input-output table and the register's spending.
// The multiplier is what the leaks leave, not a constant. Each trade's
// employment and sales are its industries' (`tickIndustryCycle`, a read-out);
// the phase is still dated off the payroll. The constants that moved with the
// trades into the industries' export side are below.
// ---------------------------------------------------------------------------
/**
 * THE WORKERS THOSE TRENDS WERE HIRING HAVE STOPPED ARRIVING (2026-10-28).
 *
 * The 1990-2019 payroll trends above carry the labour force growth of their
 * years: the US civilian labour force grew about 0.9% a year over 1990-2019
 * (BLS CPS, 125.8M to 163.5M), the tail of the baby boom and of women joining
 * the workforce. That supply is spent. CBO's long-term outlook (2024) has the
 * potential labour force growing about 0.3-0.4% a year over 2024-54, as the
 * boomers retire and fertility sits under replacement. A trade cannot grow its
 * payroll at 1990s rates on 2030s labour supply, so each trade's national
 * trend centres half a point under its 1990-2019 rate: the trades keep their
 * order (tech and medical up, apparel and media down), the nation's payrolls
 * grow at what its people allow.
 *
 * Measured before this (4 region towns x 100 years): jobs grew 2.3-3.2x, and
 * of forty decades four shrank — every trade compounding a labour supply that
 * no longer exists, so nearly every decade brought the town another tenth of
 * its size in new demand.
 */
export const LABOUR_FORCE_SLOWDOWN = 0.005;
/**
 * EACH TRADE KEEPS BOOKS (2026-10-15).
 *
 * A trade in town is the sum of its firms, and it now carries their accounts
 * in aggregate — an income statement and a balance sheet, in real terms, with
 * the opening month's sales as 1:
 *
 *   sales              what it sells: national cycle, trend, shocks, money
 *   - wages            staff x what local pay costs against national pay
 *   - rent             staff x what its space costs against the opening
 *   - other costs      materials, services, upkeep — scale with sales
 *   = EBITDA
 *   - interest         debt x the rate the trade's debt actually carries:
 *                      a floating share reprices each month off the short
 *                      rate; the rest is fixed and rolls over a five-year
 *                      ladder at the long rate of the day
 *   - tax
 *   = cash flow        into cash; surplus cash is paid out; debt is drawn
 *                      when the lenders' window is open and repaid when not
 *
 * Staff follow sales, are trimmed when margins thin and cut hard when cash
 * runs short; firms whose interest cover collapses fail — their jobs go and
 * their debt is written off — and new firms enter as margins recover. So the
 * same rise in rates hits a thin-margin, floating-rate, levered trade (apparel,
 * logistics) through its interest bill and its customers, and barely touches a
 * cash-rich one (law): the difference is in the books, not in a table of
 * sensitivities.
 *
 * Profiles are rounded US industry figures — payroll and occupancy as a share
 * of revenue (BLS / Census Economic Census), EBITDA margins and net debt to
 * EBITDA (Damodaran industry data, 2000-2024 averages), floating share from
 * bank-loan vs bond mix. `rateDem` is how much the trade's own CUSTOMERS
 * borrow to buy from it, per point of real money over neutral, on top of the
 * national cycle: architects sell to builders, freight to inventory.
 */
export interface FirmProfile { wage: number; rent: number; margin: number; lev: number; float: number; spread: number; rateDem: number; space: Partial<Record<BuiltClass, number>> }
export const FIRM_PROFILE: Record<Sector, FirmProfile> = {
  finance:   { wage: 0.35, rent: 0.06, margin: 0.28, lev: 2.0, float: 0.50, spread: 0.020, rateDem: 0.6, space: { office: 1 } },
  law:       { wage: 0.45, rent: 0.08, margin: 0.25, lev: 0.5, float: 0.70, spread: 0.020, rateDem: 0.0, space: { office: 1 } },
  tech:      { wage: 0.40, rent: 0.05, margin: 0.22, lev: 1.2, float: 0.40, spread: 0.030, rateDem: 0.6, space: { office: 1 } },
  media:     { wage: 0.35, rent: 0.05, margin: 0.20, lev: 2.8, float: 0.40, spread: 0.030, rateDem: 0.3, space: { office: 1 } },
  insurance: { wage: 0.25, rent: 0.04, margin: 0.15, lev: 1.0, float: 0.20, spread: 0.015, rateDem: 0.0, space: { office: 1 } },
  logistics: { wage: 0.33, rent: 0.10, margin: 0.12, lev: 3.0, float: 0.45, spread: 0.030, rateDem: 0.8, space: { industrial: 1 } },
  apparel:   { wage: 0.22, rent: 0.09, margin: 0.10, lev: 3.0, float: 0.55, spread: 0.035, rateDem: 1.0, space: { retail: 0.6, industrial: 0.4 } },
  food:      { wage: 0.32, rent: 0.09, margin: 0.11, lev: 2.8, float: 0.45, spread: 0.030, rateDem: 0.2, space: { retail: 0.7, industrial: 0.3 } },
  medical:   { wage: 0.50, rent: 0.06, margin: 0.15, lev: 2.2, float: 0.30, spread: 0.025, rateDem: 0.0, space: { retail: 1 } },
  design:    { wage: 0.45, rent: 0.08, margin: 0.14, lev: 1.2, float: 0.50, spread: 0.030, rateDem: 1.0, space: { office: 1 } },
};
/** The interest cover a lender underwrites new debt to (bank leveraged-loan practice ~3x). */
export const LENDER_COVER = 3;
/**
 * A TOWN'S SHARE OF EACH NATIONAL TRADE WANDERS, FOR DECADES (2026-10-15).
 * Every town grew each trade at the nation's own trend, so sixty-year job
 * growth ran 1.16x-1.79x across seeds — 0.25-1%/yr — and no town ever shrank.
 * Metros spread far wider: state employment growth differs by about 1%/yr
 * over forty-year spans and the gaps last (Blanchard & Katz 1992), and the
 * spread comes from what a place makes — Detroit's cars, Pittsburgh's steel,
 * Manhattan's garment trade (-20% city jobs 1969-77) against Seattle's
 * software. Each trade's local trend now carries its own mean-reverting
 * offset: stationary spread 2%/yr, twenty-year memory. Shape parameters,
 * stated; the cost brake (`locationCost`) still answers a town that grows
 * dear or cheap. (Since step 2, each INDUSTRY's share of the nation's demand
 * for it carries them; since FORMULA_LEDGER #9 that share is the orders the
 * town's firms win on their own unit cost: economy.ts `tickExports`. The
 * per-industry fortune walk, FORTUNE_SD over FORTUNE_TAU_M, went with it.)
 */
/** Labour-augmenting technology: stationary spread of its growth, a year, and its memory. */
const TFP_SD = 0.005;
const TFP_TAU_M = 240;
/** Capital's share of output (BLS multifactor productivity accounts). */
const CAPITAL_SHARE = 0.33;
/** Each trade's national trend: spread around its 1990-2019 mean, and its memory. */
export const NAT_TREND_SD = 0.008;
export const NAT_TREND_TAU_M = 360;
/** Points of a trade's sales per point of the national output gap, before its cycle beta. */
export const NAT_SALES_PER_GAP = 1.25;
/**
 * `industryMom`'s readers (tenant staffing, default stress, renewals, the
 * comps tape) were calibrated in "boom units", where 0.016 x vol was a trade
 * in full boom. A boom here is excess hiring of about 0.4% a month, so the
 * conversion is 4. Units, not a dial: change the readers and this goes.
 */
const MOM_UNITS = 4;

// ---------------------------------------------------------------------------
// THE TOWN'S OWN GROWTH, AND WHAT STOPS IT (2026-10-10).
//
// Every trade here grew at its NATIONAL trend, so every town grew like the
// average American town — about 1% a year, 2.5x in a century — and nothing
// made an employer choose this one. Measured over six 100-year Frontier towns:
// population 58.6k at year 100 from 22k, the outskirts still empty.
//
// Places do not grow at the national rate. Blanchard & Katz (1992) find US
// states' employment growth differs from the nation's by persistent amounts —
// over 1950-90 Arizona, Florida and Nevada ran about 3% a year over it and
// New York about 1% under, with the differences lasting decades — and young
// regions are the fast ones: the West and South grew while the old cores
// lagged. So the town draws one persistent regional trend at founding, the
// mean set by how young the town is (the share of its lots still empty: a
// Frontier town ~0.56 opens about +1.1%/yr, a settled one ~0.15 a little
// under nil) and a spread of 0.8%/yr across towns, the order of the
// cross-state spread. Drawn from the seed, not a stream: no other draw moves.
//
// AND IT DOES NOT RUN FOREVER, because employers come for what the town
// costs. The pull is braked by the town's unit cost against the nation's —
// pay against national pay (~85% of the bill), rent on offices and sheds
// against national rent (~15%) — less what its size adds to output.
// Firms' location responds to business costs with a long-run elasticity of
// about 0.2-0.6 reached over a decade or so (Bartik 1991); 0.4 over ten years
// is a pull of 4% of the log cost gap a year. Agglomeration: output per
// worker rises about 4% per doubling of the town's employment (Ciccone & Hall
// 1996 ~5% for density; Combes et al. 2008 2-4% after sorting). A town that
// grows dear stops being chosen; one that grows big and stays cheap keeps
// being chosen. Shape parameters with sources, stated as such.
//
// RETIRED 2026-10-28 (step 2): the drawn regional trend and its wandering
// edge. A town grows now as its export industries do — the nation's demand
// for them and its share of it. RETIRED with FORMULA_LEDGER #9: the cost
// brake on that share (LOCATION_PULL, 4% a year of the log cost gap). The
// share is the orders the town's firms win, each on its own price against
// the nation's (economy.ts `tickExports`); `locationCost` below is now read
// only by an anchor employer choosing the city (blackswans.ts).
// ---------------------------------------------------------------------------
const AGGLOM = 0.04;                  // output elasticity to employment
export const WAGE_CURVE = -0.10;             // pay level to local unemployment (Blanchflower & Oswald 1994)
export const WAGE_GAP_HALF_M = 24;           // months for a firm's pay to close half its gap to what it takes to hire here (economy.ts)
export const WAGE_SHARE = 0.85;

/**
 * THE REGION AND THE ISLAND (2026-10-10). The town's population is a region:
 * it is derived from the island's jobs (citySize), and most of it lives on the
 * mainland the island anchors — at the opening about one resident in six
 * lives on the map. This is who does: occupied flats, at the generator's own
 * 900 sf a home of rentable space (`unitsres` in citygen), times 2.51 people a
 * household (US Census 2020). Commuters are the island's jobs less the
 * residents who hold them.
 */
export const SF_PER_HOME = 900;
export const PEOPLE_PER_HOME = 2.51;
export function islandResidents(e: Econ): { residents: number; homes: number; commuters: number } {
  const homes = Math.max(0, (e.occupied?.multifamily ?? 0) / SF_PER_HOME);
  const residents = Math.round(homes * PEOPLE_PER_HOME);
  const pop = Math.max(1, e.population ?? 1);
  // The island's residents work at the region's rate: employed / population.
  const workRate = Math.min(1, (e.jobs ?? 0) / pop);
  const commuters = Math.max(0, Math.round((e.jobs ?? 0) - residents * workRate));
  return { residents, homes: Math.round(homes), commuters };
}

/** Business rent against the nation's (offices and sheds, geometric mean), RENT_BASE at national prices. */
function businessRentVsNation(e: Econ): number {
  const natP = Math.max(0.1, e.natCpi ?? e.cpi ?? 1);
  const rentOf = (k: "office" | "industrial") =>
    Math.max(0.05, (e.effRentIdx?.[k] ?? e.rentIdx[k]) / (RENT_BASE[k] * natP));
  return Math.sqrt(rentOf("office") * rentOf("industrial"));
}

/**
 * WHAT THIS TOWN COSTS AN EMPLOYER AGAINST THE NATION, in log points against
 * its own opening: pay against national pay (WAGE_SHARE of the bill), rent on
 * offices and sheds against the opening's (the rest), less what its size adds
 * to output (AGGLOM). An anchor employer choosing the city reads it (blackswans.ts).
 */
export function locationCost(e: Econ): number {
  const wageRatio = (e.wageIdx ?? 1) / Math.max(1e-6, e.natWageIdx ?? e.wageIdx ?? 1);
  if (e.regionRent0 === undefined) e.regionRent0 = businessRentVsNation(e);
  const rentRatio = businessRentVsNation(e) / Math.max(0.05, e.regionRent0);
  const scale = Math.max(0.2, (e.jobs ?? 1) / Math.max(1, e.jobs0 ?? e.jobs ?? 1));
  return WAGE_SHARE * Math.log(wageRatio) + (1 - WAGE_SHARE) * Math.log(rentRatio) - AGGLOM * Math.log(scale);
}

/**
 * THE TRADES, READ OFF THE INDUSTRIES (2026-10-28, ONE ECONOMY step 2). Each
 * trade's employment and real sales against the opening are its industries'
 * (economy.ts `economyToEngine`, by the heads the trade's own firms had in
 * each), written into `firmBooks` and `indIdx` for everything that reads a
 * trade — the street's firms' sales per head, a starting firm's margin, the
 * renewal term — and its momentum is its growth against its own five-year
 * trend, in the units its readers were calibrated in (MOM_UNITS). The
 * cycle's index is the town's payroll against the first filled one, and the
 * phase is dated off it. Before the books open (the opening months) the
 * opening's trades stand.
 */
export function tickIndustryCycle(s: GameState) {
  const e = s.econ;
  if (!e.indIdx) e.indIdx = Object.fromEntries(SECTORS.map((k) => [k, 1])) as Record<Sector, number>;
  if (!e.industryMom) e.industryMom = Object.fromEntries(SECTORS.map((k) => [k, 0])) as Record<Sector, number>;
  if (!e.industryPhase) e.industryPhase = Object.fromEntries(SECTORS.map((k) => [k, "steady"])) as Record<Sector, "boom" | "steady" | "bust">;
  if (e.regionRent0 === undefined) locationCost(e);
  const tr = e.eco?.trade;
  if (tr) {
    e.firmBooks ??= {} as Record<Sector, FirmBook>;
    const trend = (e.indTrend ??= {});
    for (const k of SECTORS) {
      const t = tr[k];
      if (!t) continue;
      const before = e.indIdx[k] ?? t.emp;
      const b = (e.firmBooks[k] ??= { sales: t.sales, emp: t.emp, cash: 0, debt: 0, fixed: 0, fail: 0, cover: 0, margin: t.margin });
      b.sales = t.sales; b.emp = t.emp; b.margin = t.margin;
      e.indIdx[k] = t.emp;
      const g = before > 0 ? t.emp / before - 1 : 0;
      const g0 = trend[k] ?? g;
      trend[k] = g0 + (g - g0) / 60;
      e.industryMom[k] = clamp(e.industryMom[k] + (MOM_UNITS * (g - g0) - e.industryMom[k]) / 6, -0.05, 0.05);
      const vol = INDUSTRY_VOL[k], m = e.industryMom[k];
      const was = e.industryPhase[k];
      e.industryPhase[k] = m > 0.008 * vol ? "boom" : m < -0.0075 * vol ? "bust" : "steady";
      // A trade the player leases to turns: say so, with the industries behind it (why.ts)
      if (was !== e.industryPhase[k] && e.industryPhase[k] !== "steady" && exposureToTrade(s, k) > 0.10) {
        const up = e.industryPhase[k] === "boom";
        s.news.unshift({ q: s.month, kind: up ? "event" : "warn", why: whyTrade(s, k),
          text: up ? `${INDUSTRY_LABEL[k]} hiring strongly; good for landlords leasing to that sector.` : `${INDUSTRY_LABEL[k]} shedding staff; check your rent roll exposure to it.` });
        if (s.news.length > 120) s.news.length = 120;
      }
    }
  }
  const jobs0 = e.jobsFilled0 ?? e.jobs0 ?? e.jobs ?? 1;
  const comp = (e.jobs ?? jobs0) / Math.max(1, jobs0);
  const prevComp = e.cycIdx ?? comp;
  e.cycIdx = comp; e.exportIdx = comp; e.localIdx = comp;
  e.cycDrift = prevComp > 0 ? comp / prevComp - 1 : 0;
  derivePhase(s);
}

/**
 * THE PHASE IS DATED, NOT SCHEDULED. Read off the city's payrolls the
 * way NBER dates a cycle — after the fact, from the data — with the same
 * thresholds every month. Definitions, not tuning: a contraction is jobs
 * falling at an annualised half a point over six months; a recovery runs
 * until the old peak is regained; a depression is a recession that has taken
 * more than five per cent off the peak and kept going for a year.
 */
function derivePhase(s: GameState) {
  const e = s.econ;
  // Payrolls actually filled (last month's — the data a statistician has),
  // not employers' demand for staff: a boom short of workers is still a
  // boom, and a bust is jobs lost, not jobs no longer wanted.
  // The opening's `jobs` is the size the town was drawn at, not a payroll the
  // labour market has filled: the first month's solve moves it 3-5%, and
  // dating that step read as a recession through most of year one (2026-10-13).
  // Only the opening record is in `history` until the first month is filed.
  if ((e.history?.length ?? 0) <= 1) return;
  const T = (e.jobs ?? e.jobs0 ?? 1) / Math.max(1, e.jobs0 ?? 1);
  const hist = (e.cycHist ??= []);
  hist.push(T);
  if (hist.length > 7) hist.shift();
  const T6 = hist[0];
  const g6 = T6 > 0 ? Math.pow(T / T6, 12 / Math.max(1, hist.length - 1)) - 1 : 0;
  if (e.cycPeak === undefined || ((e.phase === "expansion" || e.phase === "peak") && T > e.cycPeak)) e.cycPeak = T;
  const dd = e.cycPeak > 0 ? 1 - T / e.cycPeak : 0;
  e.phaseAge = (e.phaseAge ?? 0) + 1;
  const dwell = e.phaseAge >= 3;
  let next = e.phase;
  switch (e.phase) {
    case "expansion": if (dwell && g6 < 0.004) next = "peak"; break;
    case "peak": if (dwell && g6 < -0.005) next = "recession"; else if (g6 > 0.012) next = "expansion"; break;
    // A DEPRESSION IS NOT A BAD RECESSION (2026-10-14). The bar was five per
    // cent off the peak after a year, which is 2008-09 (US payrolls -6.3%) —
    // the worst recession since the war, and still a recession. Playthroughs
    // put the label on episodes of 8-12% unemployment. A city in depression
    // has lost one job in ten and is still losing them after eighteen months:
    // the 1930s (US payrolls about -20%), Detroit 2008-10, Flint.
    case "recession": if (dwell && g6 > 0.002) next = "recovery"; else if (dd > 0.10 && e.phaseAge >= 18) next = "depression"; break;
    case "depression": if (dwell && g6 > 0.002) next = "recovery"; break;
    case "recovery": if (T >= (e.cycPeak ?? T)) next = "expansion"; else if (dwell && g6 < -0.005) next = "recession"; break;
  }
  // The street sees a turn coming from the same numbers, a little early.
  const near: Partial<Record<MarketPhase, boolean>> = {
    expansion: g6 < 0.008, peak: g6 < -0.002, recession: g6 > 0, depression: g6 > 0,
    recovery: dd < 0.01,
  };
  if (next === e.phase && !e.rumoredPhase && near[e.phase] && rng(s) < 0.25) {
    const ahead: Record<MarketPhase, MarketPhase> = { expansion: "peak", peak: "recession", recession: "recovery", depression: "recovery", recovery: "expansion" };
    e.rumoredPhase = ahead[e.phase];
    pushNews(s, "rumor", RUMORS[e.rumoredPhase][Math.floor(rng(s) * RUMORS[e.rumoredPhase].length)]);
  }
  if (next !== e.phase) {
    e.phase = next;
    e.phaseAge = 0;
    e.rumoredPhase = null;
    if (next === "expansion") e.cycPeak = T;
    const label: Record<MarketPhase, string> = {
      expansion: "Market expansion: rents rising, capital flowing in.",
      peak: "Market peak: pricing at cycle highs.",
      recession: "Market downturn: tenants retrenching, lenders pulling back.",
      recovery: "Market recovery: declines have stopped.",
      depression: "Depression: the city has lost over 10% of jobs and losses continue.",
    };
    // WHY (why.ts): the town's month — its payrolls, its spending, the export industries that moved them
    s.news.unshift({ q: s.month, kind: "event", text: label[e.phase], why: whyTown(s) });
    if (s.news.length > 120) s.news.length = 120;
  }
}

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
  // THE CITY'S CYCLE IS NOT A CLOCK (2026-10-08). This was a countdown —
  // a random length per phase, a fixed round robin, shortened by a glut, a
  // tight market or a national recession — and the label then SET the city's
  // job growth (+0.26%/month in an expansion, -0.14% in a recession). Measured
  // over four 50-year worlds, 52-71% of local recession months fell while the
  // nation was not worsening: the clock made half the city's recessions up,
  // and a "recovery" averaged falling jobs on two seeds. Post-war expansions
  // do not die of old age (Diebold & Rudebusch); recessions are caused. The
  // cycle now comes from the city's industries (`tickIndustryCycle`, after
  // the nation moves) and the phase is a DESCRIPTION of what jobs did.
  //
  // RETIRED with it: the "monetary era" block that rolled a secular rate
  // target and random jumps ("An inflation scare. The index jumped this
  // month..."). `tickNation` overwrites `rateRegime` from the policy rate
  // every month and the loan index never read it, so the news reported rate
  // moves that did not happen.
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
  tickNation(s);
  tickIndustryCycle(s);

  // (retired) THE OLD CITY-LEVEL POLICY RATE read the CITY's unemployment, so
  // a player who wrecked his own city was handed a rate cut for it. The nation
  // sets the price of money now; see the block above.

  // cycle deviation drifts with phase, spring-loaded toward zero at the extremes
  // instead of pinning on hard rails — the restoring force is the mechanism.
  // ...and what moves it is payrolls, not the label (2026-10-09). The table
  // stepped it +0.027/mo in an "expansion" and -0.054 in a "recession"; the
  // same sentiment now builds at 1.8x trailing-year payroll growth, which is
  // those two numbers at +1.5%/yr and -3%/yr, continuously. It feeds cap
  // rates and land through `cycleDev`, so that channel is now caused.
  const step = clamp(1.8 * payrollGrowth12(e), -0.08, 0.06) + rrange(s, -0.03, 0.03);
  const spring = -0.048 * e.cycleDev;
  e.cycleDev = clamp(e.cycleDev + step + spring, -1, 1);

  // --- capital availability -------------------------------------------------
  // Money is not a smooth function of the policy rate. It leaves the room in a
  // downturn and comes back late, and that lag is where the bargains are.
  // ...and a national recession closes it further than a local one, because the
  // balance sheet that has to absorb the loss is the same balance sheet in
  // every city at once.
  stepCredit(s);
  // (Whether the debt markets are closed is read in tickLenders — lenders.ts —
  // off the desks' own standards and the securitisation window.)

  // --- employment: the demand behind every lease -----------------------------
  // THE TOWN'S JOBS ARE ITS FIRMS' (2026-10-28, ONE ECONOMY step 2). This
  // block drifted an employment index by the trades' composite cycle, a rent
  // pull, a swan pull and a staffing drag, and the labour block below turned
  // it into jobs by matching flows, with migration, participation and an age
  // model of its own. All of that is the household register's now: the firms'
  // heads (economy.ts — what the nation buys of the town's exports and what
  // the town and its people buy of each other) are the labour demand, the
  // register's earners fill them, its households arrive for the work and
  // leave without it, age, have children and retire (households.ts). The
  // index is read off the payroll it fills, for the screens that chart it.
  // (Each retired mechanism's measurement is in the commit history: the
  // return wire on rent, the staffing drag, the construction level, the
  // matching function, the housing choke on migration.)

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
    // THE REGISTER IS THE TOWN'S PEOPLE AND ITS LABOUR MARKET (2026-10-28,
    // step 2): last month's earners in work are the town's jobs, its jobless
    // its unemployment, its labour force over its people its participation,
    // its households' members its population and age mix, its arrivals and
    // departures its migration (economy.ts `economyToEngine`). Unfilled
    // heads are the vacancies the Phillips term reads. Before the register
    // exists (the opening month) the opening's numbers stand.
    const d = e.eco;
    if (d && d.persons > 0) {
      e.jobs = Math.round(d.jobs);
      e.unemployment = clamp(d.unemp, 0, 0.5);
      e.participation = d.lf / d.persons;
      e.population = Math.round(d.persons);
      e.ages = { ...d.ages };
      e.adults0 ??= d.ages.work + d.ages.old;
      e.jobVac = d.heads > 0 ? Math.max(0, (d.heads - d.jobs) / Math.max(1, d.lf)) : 0;
      e.migRate = (d.arrived - d.left) / Math.max(1, d.households);
      e.employIdx = e.jobs / Math.max(1, e.jobsFilled0 ?? e.jobs0 ?? e.jobs);
    }

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
    // TIGHTNESS IS VACANCIES AGAINST UNEMPLOYMENT, not unemployment alone.
    //
    // This read `0.055 - unemployment`, and while employment could exceed the
    // labour force that was a signal with a ceiling on it: the clamp on
    // `slackTarget` pinned unemployment at 1.8% in nearly half of all months,
    // so the hottest labour market this city can have looked exactly like the
    // fourth-hottest. Now that employment stops at the people available, the
    // pressure that used to disappear into impossible unemployment shows up as
    // unfilled positions instead, and it has no ceiling.
    //
    // Summed rather than weighted, because the standard measure of labour
    // market tightness is the vacancy-to-unemployment gap and an unfilled
    // vacancy is worth about what a missing unemployed worker is worth: both
    // say one job's worth of pressure on pay. `jobVac` is zero for the whole of
    // a slack market, so nothing about the loose end of the curve moves.
    // HOW TIGHT THIS TOWN'S LABOUR MARKET IS, in units a labour market can
    // actually reach.
    //
    // This was `0.055 - unemployment + jobVac` with no bound on the second
    // term, and it went to 0.27 — a claim that unfilled positions equalled a
    // QUARTER of everybody available to work. The US vacancy rate has never
    // exceeded about 7.4%, at the tightest moment ever recorded, and the
    // vacancy-to-unemployment gap has never exceeded about four points. So the
    // signal is expressed as the real one: unfilled positions as a share of
    // all positions, against the unemployment rate, saturating where the
    // observed series does.
    //
    // The saturation is not a rail hiding the fault — the fault is fixed
    // upstream, where demand for staff now answers whether staff exist. It is
    // here because a tightness measure that can read 27% is not a measure of
    // anything, and because the term it feeds is multiplied by a coefficient
    // calibrated for a gap of a point or two.
    // (Openings were capped here at 7.5% of the labour force — the US record,
    // used as a ceiling. Removed 2026-10-13 with the dead read below.)
    // AGAINST THIS TOWN'S OWN NATURAL RATE (2026-10-09). The pivot was 0.055,
    // a third natural rate of unemployment in one engine: the nation reverts
    // to 4.2% in an expansion and prices off a 4.8% u*, and this town pivoted
    // on 5.5%. The town's natural rate is not a free number — it is the
    // steady state its own matching function was calibrated to
    // (OPENING_UNEMP, where hires exactly replace separations), so that is
    // the pivot. Whatever this town's labour market does relative to the
    // nation then shows up as a wage premium, which is what moves hiring
    // (`wageDemand`) and movers (`wagePremEma`) — the loop that pulls a tight
    // town back.
    // (A capped local `tight` lived here and nothing read it: pay runs off the
    // wage curve below. Removed 2026-10-13.)
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
    // A TOWN'S PRICE LEVEL IS THE NATION'S, PLUS WHAT IS MADE AND HOUSED HERE
    // (2026-10-09).
    //
    // This was `0.72 x national + 0.28 x local expectations + 0.014 x tight +
    // 0.14 x construction-cost push`. Two things were wrong with it, and the
    // second is the important one. The labour term pivoted on 5.5% while the
    // town averaged 4.2% unemployment, so it was positive in nearly every
    // month: measured over 4 worlds x 50 years, local CPI ran 0.5-0.7pp/yr
    // ahead of the nation and finished 1.27-1.39x the national price level,
    // out of a term that described nothing anybody buys. And the town's own
    // RENT — a third of every real CPI basket — was not in its price level at
    // all, so a housing shortage could never make the town dear to live in.
    //
    // Metro CPIs do diverge from the national one, and the record says how:
    // through shelter and through local services, which are local labour
    // (BLS metro CPI; the Balassa-Samuelson channel). Goods are traded and
    // cost what they cost everywhere. So the basket is built from those
    // three, each read as its trailing-year change against the nation's:
    //
    //   shelter  0.33  — the town's apartment rent (BLS relative importance
    //                    of shelter, ~33-36% of CPI-U)
    //   services 0.25  — local pay against national pay (services less
    //                    energy and shelter, ~25%; labour is most of it)
    //   goods    0.42  — the national rate, untouched
    //
    // The national rate already contains national shelter and services, so
    // only the LOCAL DIFFERENCE is added; a town that looks exactly like the
    // nation inflates exactly like it. Trailing-year changes because that is
    // what the index measures — CPI shelter is famously a year behind asking
    // rents, since it samples sitting tenants. This closes the loop the
    // engine was missing: a shortage raises rents, rents raise the price
    // level, the price level is what wages and leases escalate by, and real
    // pay is what tenants economise against.
    const SHELTER_W = 0.33;
    const natCpiPrev = e.natCpi ?? e.cpi!;
    e.natCpi = natCpiPrev * (1 + natInfl / 12);
    const natCpi12 = h12?.natCpi ? e.natCpi / h12.natCpi - 1 : natInfl;
    const shelter12 = h12?.rent?.multifamily ? e.rentIdx.multifamily / h12.rent.multifamily - 1 : natCpi12;
    const wage12 = h12?.wageIdx ? (e.wageIdx ?? 1) / h12.wageIdx - 1 : 0;
    const natWage12 = h12?.natWageIdx ? (e.natWageIdx ?? 1) / h12.natWageIdx - 1 : wage12;
    // THE NATION'S RENT RISES WITH THE NATION'S PAY, NOT WITH ITS PRICES
    // (2026-10-10). The town's shelter was read against national CPI, which
    // says national real rent is flat — so every point of rent a richer
    // nation pays everywhere was booked as this town getting dear. It is not
    // flat: the share of income households spend on rent is about constant
    // across US metros and over time (Davis & Ortalo-Magné 2011), so the
    // nation's rent moves with the nation's pay; HUD's median two-bed rent
    // rose 2.6x over 2000-2025 against prices 1.86x. Measured before this,
    // over two 100-year Frontier towns, local prices ended 1.15-1.37x the
    // nation's — above San Francisco, for a town of 50-70k, where the BEA's
    // price parities put small metros at 0.88-0.95 of the US.
    const natShelter12 = natWage12;
    void cost12;
    // The old monthly floor (-0.05%/mo unless the nation deflated) and the
    // 1.15%/mo ceiling were there to stop the labour term running away. With
    // the price level built from traded goods and two local relatives, those
    // are wide guards: a month the town deflates faster than 1% is a month
    // its rents fell by a third.
    // THE NATION'S RATE PASSES THROUGH WHOLE (2026-10-14). The guard was on
    // the whole monthly rate (+2%), sized for a national rate that could not
    // pass 22%. With the national model uncapped, a fiscal-dominance century
    // ran the nation at 70-100% a year while this town's prices were held at
    // 26.8% — and pay, which follows the nation's, ran six times ahead of the
    // town's prices: real wages, jobs and real rents exploded. Only the LOCAL
    // difference is guarded now (a point a month either way).
    // THE TOWN'S OWN GOODS AND SERVICES ARE PRICED BY ITS FIRMS (2026-10-29,
    // §6c-D). This was SERVICES_W 0.25 of the basket moving with local pay
    // against the nation's — pay standing in for prices. Now it is what the
    // town's firms charge against the nation's for the same industries
    // (economy.ts `postPayAndPrices`: unit cost and the demand they face,
    // sticky), at the share of the non-shelter basket the register's
    // households buy in town (`localShare`, the books' own), read a month on.
    const priceRel = e.eco?.priceRel;
    const localW = (1 - SHELTER_W) * (e.eco?.localShare ?? 0);
    const dLocal = priceRel !== undefined && e.priceRelPrev !== undefined ? Math.log(priceRel / Math.max(1e-6, e.priceRelPrev)) : 0;
    if (priceRel !== undefined) e.priceRelPrev = priceRel;
    void wage12;
    const localM = SHELTER_W * (shelter12 - natShelter12) / 12 + localW * dLocal;
    e.cpi = e.cpi! * (1 + natInfl / 12 + localM);
    // ...AND THE SAME BASKET WITHOUT THE RENT, which is what rents escalate
    // by (see `escalation` in the rent block). Asking rents marked to a price
    // level that contains them index themselves: measured over 4 worlds x 50
    // years, that loop (gain ~0.33) carried one town's price level to 1.63x
    // the nation's, beyond any US metro on record (San Francisco's CPI-U
    // outran the national index by about 12% over 1984-2023). BLS publishes
    // this series — "all items less shelter" — for the same reason.
    const inflXS = natInfl / 12 + (localW / (1 - SHELTER_W)) * dLocal;
    e.cpiXS = clamp((e.cpiXS ?? e.cpi!) * (1 + clamp(inflXS, -0.01, 0.02)), 0.5, 1000);
    // ...and expectations follow realised inflation slowly. This is the anchor
    // that keeps the spiral from either exploding or dying: fast enough that a
    // decade of 6% becomes the new normal, slow enough that one bad year is
    // not a regime.
    e.inflExp = e.inflExp + 0.020 * (infl12 - e.inflExp);

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
    // NOW TWO MOVING PARTS, NEITHER OF THEM A CLOCK (2026-10-16). The era
    // was a sine wave keyed on the seed: every town passed through the same
    // regimes in the same order at the same pace. Labour productivity grows
    // by (a) the technology a worker has to hand — a persistent process with a
    // generation's memory centred on the 1.1%/yr this economy is balanced
    // against, its stationary spread the era spread above (±0.5 points one sd,
    // so the 1.3% and 2.9% regimes are both ordinary draws) — and (b) capital
    // per worker, from the nation's own investment (the capital stock in the
    // spending block, against its trend): output per hour rises a third of a
    // point for each point capital grows faster than its trend (capital's
    // share, about a third: BLS multifactor productivity accounts). An
    // investment boom raises pay a few years on; an investment bust that
    // leaves the stock short of trend holds it back.
    const PRODUCTIVITY = 0.011;    // ~1.1%/yr real, the long-run US figure
    const nn = e.nat!;
    nn.tfpG ??= PRODUCTIVITY + TFP_SD * hashNormal(`${s.seed}|tfp`);
    nn.tfpG += (PRODUCTIVITY - nn.tfpG) / TFP_TAU_M
      + TFP_SD * Math.sqrt(2 / TFP_TAU_M) * Math.sqrt(3) * (2 * rng(s, "nation") - 1);
    const kNow = nn.dem?.K;
    const kDeep = kNow && nn.kSeen ? clamp(12 * Math.log(kNow / nn.kSeen), -0.05, 0.05) : 0;
    if (kNow) nn.kSeen = kNow;
    const prodEra = nn.tfpG + CAPITAL_SHARE * kDeep;
    // The level of the technology a worker has to hand (log, from the opening):
    // what the cost of selling at a distance falls with (see ONLINE below).
    nn.techLn = (nn.techLn ?? 0) + nn.tfpG / 12;
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
    const productivity = prodEra + hoarding;
    // THE TOWN'S PAY IS WHAT ITS FIRMS POST (2026-10-29, ONE_ECONOMY_PLAN
    // §6c-D; FORMULA_LEDGER #15, removed). It was set here: pay closing toward
    // national pay x local prices over national x a wage curve on the town's
    // unemployment x a size term, with a freeze and an owed raise. Each firm
    // now posts its own pay from its own books and how hard it is to hire —
    // the town's slack at the wage curve, its industry's unfilled openings,
    // rent sharing — with the same downward rigidity, firm by firm
    // (economy.ts `postPayAndPrices`), and the town's wage index is the
    // heads-weighted average of what was posted, read a month on, as a
    // statistician reads last month's payrolls. Before the books open, the
    // town's employers grant what every employer in the country grants: the
    // nation's path below.
    //
    // What the same worker earns elsewhere: the national path, expectations
    // plus productivity, none of this town's tightness or slack — the
    // NATION's expectations and labour market (2026-10-09), indexed partly to
    // last year's prices (Smets & Wouters 2007: about 0.58), and not cut in
    // nominal terms.
    const natPrev = e.natWageIdx ?? e.wageIdx!;
    {
      const n = e.nat;
      const natTight = n ? Math.max(-0.06, Math.min(0.055, NAT_U_STAR - n.unemp)) : 0;
      const natGrowth = (0.42 * (n?.inflExp ?? e.inflExp) + 0.58 * natCpi12) / 12 + productivity / 12 + natTight * 0.012;
      e.natWageIdx = natPrev * (1 + Math.max(0, natGrowth));
    }
    const posted = e.eco?.wage;
    e.wageIdx = posted !== undefined && posted > 0 ? posted : e.wageIdx! * (e.natWageIdx / Math.max(1e-9, natPrev));

    // Output is what the place makes: people working, times what each of them
    // produces. It is the broadest number in the game and the slowest to move.
    e.outputIdx = +(((e.jobs ?? 0) / (e.jobs0 ?? 132_000)) * e.wageIdx!).toFixed(4);
  }

  // --- each class runs its own cycle -----------------------------------------
  // This used to be an AR(1) walk with a +/-0.02 cap and noise so small that
  // its stationary spread was about a tenth of that: sectorMom sat near zero
  // for a century and the four classes moved as one market wearing four
  // labels. Now every class carries an explicit boom / steady / bust clock,
  // long enough to live through and independent of its neighbours, so office
  // can be three years into a bust while apartments are booming — which is the
  // ordinary condition of a real property market, not an exotic one.
  // (Each property class ran its own boom/steady/bust clock here, and its
  // momentum fed rents, cap rates, leasing pace and tenant stress. It is now
  // read off the class's own demand driver in the space loop below — a class
  // booms when the people who lease it are hiring or arriving.)

  // --- what the tenants do for a living -------------------------------------
  //
  // Ten industries, each on its own clock, at its own volatility. This is a
  // DIFFERENT cycle from the asset-class one above: office can be a landlord's
  // market while finance is shedding staff, and the building let to five
  // startups empties while the one across the street let to insurers does not.
  // That distinction did not exist — sector was a name on a lease and nothing
  // else — and it is the difference between a rent roll and a list.
  // (The trades' boom/steady/bust clocks lived here. See tickIndustryCycle.)

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
    // A MANHATTAN PREMIUM IS EARNED BY DEMAND, NOT BY A SUPPLY FAILURE.
    //
    // Vacancy pinned at the frictional floor for decades used to mint a
    // permanent `tightEma` premium — the income anchor then defended a rising
    // rent-to-wage ratio because, by its own measure, the city was "genuinely
    // tight." That is backwards when the floor is binding because stock cannot
    // keep up with jobs (ECONOMY.md §F #3).
    //
    // A first cut faded only when `!supplyAnswering`. That bar is low (any
    // thin pipeline), so a town glued to the rail with a few cranes still
    // fed saturated `tightNow` into the EMA — measured avg tightEma WHILE
    // pinned sat ABOVE the unconditional average, and seeds spent half a
    // century on the rail at maxTE ≈ 0.53. The availability instrument is
    // saturated on the rail; it cannot tell "desperately short" from "at
    // the floor." Refuse to mint or renew premium from it. Growing unmet
    // demand still prices through scarcity → rentPress; this EMA only stores
    // chronic tightness read from an UNPINNED availability signal. Fade
    // faster on the rail so a decade of supply failure does not defend a
    // Manhattan ratio into the next cycle.
    const stock = Math.max(1, e.stock?.office ?? CITY_STOCK.office);
    const natO = normalVac(e, "office");
    const availNow = (e.cityVac?.office ?? natO)
      + (e.sublet?.office ?? 0) / stock;
    const tightNow = (natO - availNow) / natO;
    const friction = residenceVac(e, "office");
    const pinned = (e.cityVac?.office ?? natO) <= friction + 1e-6;
    const target = pinned ? 0 : tightNow;
    const gain = pinned ? 0.012 : 0.004;
    e.tightEma = (e.tightEma ?? 0) + gain * (target - (e.tightEma ?? 0));
  }

  // SECULAR DEMAND ERAS — the slow tide under the business cycle, per class.
  //
  // This block replaces a single hardcoded decline. `industComp` shrank sheds'
  // job share at the 1970-2010 manufacturing-exodus rate on every seed, always
  // downward — measured, industrial real rents fell 1.6-2.1%/yr for fifty
  // years on every seed while its vacancy sat pinned at the frictional floor,
  // and the class was never once the best answer. The exodus was real; making
  // it the ONLY possible industrial era is how one slice of history became a
  // permanent thumb on the scale. The same record has the opposite eras too:
  // sheds were the best-performing class in the country from 2015, office
  // space-per-worker fell a third between 2000 and 2020, the high street lost
  // a decade to the browser, and household formation ran in waves.
  //
  // Each class carries a compounding composition index whose annual drift
  // re-rolls every 12-25 years from a menu of eras sized off that record.
  // The menus lean where history leans — sheds and shopfronts spend more of
  // the century declining than growing in a dense city — so the old behaviour
  // is still the most likely single era; it is no longer the certain one.
  //
  // ONE COUPLING, because it is an economic identity rather than a flavour:
  // when retail draws its erosion era, the goods still move — they move
  // through fulfilment floors instead of shopfronts — so sheds pick up part of
  // what the high street loses, which is exactly what 2015-2024 looked like.
  //
  // Guards, not rails: the index is bracketed at [0.45, 2.2]; the industrial
  // floor keeps the residual last-mile/food share a dense city never loses.
  {
    if (!e.secular) {
      // Old saves arrive with industComp already partway down its decline —
      // adopt it as sheds' starting index so a loaded game does not jump.
      e.secular = {
        office: { idx: 1, drift: 0, leftM: 0 },
        retail: { idx: 1, drift: 0, leftM: 0 },
        multifamily: { idx: 1, drift: 0, leftM: 0 },
        industrial: { idx: e.industComp ?? 1, drift: 0, leftM: 0 },
      };
    }
    // Annual drift menus: [drift, weight] pairs, each an era with a name in
    // the comment. Weighted toward history's base case per class.
    const MENUS: Record<string, [number, number][]> = {
      office: [
        // Space-per-worker fell from ~250sf to ~150sf between 2000 and 2020 —
        // about -2.5%/yr of claim compression sustained for two decades — and
        // the telework shock stacked a level drop on top. The deep era below
        // is that record, not a balance choice; office demand per job has
        // spent more of the modern record shrinking than growing.
        // NO TELEWORK ERA (owner, 2026-10-12): offices keep the demand they
        // had before the 2020s work-from-home shift. The -2.4%/yr era carried
        // that shift; the pre-2020 slow compression stays.
        [-0.009, 3],   // slow space-per-worker compression
        [0.0, 2],      // steady state
        [0.008, 2],    // services boom pulls desks
        // EVERY CLASS CAN WIN A CENTURY (owner, 2026-10-15: "any of the 4
        // asset types could be the winner or loser"). The office menu only
        // ran from compression to an ordinary boom; the towns that became
        // headquarters towns — finance, law, HQ relocations — had an era of
        // their own. Mean now ~0 (was -0.16%/yr).
        [0.014, 1],    // headquarters town
      ],
      // Retail keeps a lean down (e-commerce is real) but no longer a certain
      // loser: a downtown renaissance or a destination-retail boom is as
      // likely as the browser era. Mean -0.28%/yr (was -0.74%).
      retail: [
        [-0.02, 1.5],  // the browser eats the high street
        [-0.008, 2],   // slow erosion
        [0.0, 2],      // steady state
        [0.005, 2],    // urban retail renaissance
        [0.012, 1],    // destination / experiential retail boom
      ],
      // Weighted to the record (2026-10-09). These are demand for flats PER
      // ADULT — the adults themselves come from the age model — so their
      // long-run mean is the headship trend: US households per adult went
      // 0.455 (1960: 52.8M households, 116M adults) to 0.498 (2020: 128.5M,
      // 258M), +0.15%/yr. The old weights (1/2/3/1) averaged +0.43%/yr, about
      // three times that, and measured over 4 worlds x 50 years they added
      // +0.11 to +0.37 log points of flat demand per adult — a trend nobody
      // had observed. Same eras, weights 2/3/2/0.5: mean +0.17%/yr.
      // AND A CITY'S FLATS CAN HAVE A BAD GENERATION TOO (2026-10-16). The
      // deepest era here was -0.4%/yr while offices, shops and sheds each had
      // one of -0.9 to -2%/yr, so flats were the one class that could not lose
      // a century. Cities did lose theirs: 1950-80 central-city renters left
      // for the suburbs — New York lost a tenth of its people in the 1970s,
      // St Louis, Cleveland and Detroit a third or more over three decades
      // (Census). Urban flight is that era. The formation wave is weighted up
      // a step to hold the mean near the headship trend (+0.08%/yr).
      multifamily: [
        [-0.012, 1],   // urban flight
        [-0.004, 2],   // suburban exodus
        [0.0, 3],      // steady state
        [0.007, 3],    // household-formation wave
        [0.013, 0.5],  // urbanization surge
      ],
      // A shed town is as likely to be a fulfilment hub as a rust belt: the
      // logistics boom weighs what the manufacturing exodus does. Mean
      // -0.12%/yr (was -0.44%).
      industrial: [
        [-0.0172, 2],  // the manufacturing exodus (the old constant, now one era)
        [-0.006, 2],   // slow thinning
        [0.0, 2],      // steady state
        [0.012, 3],    // logistics / fulfilment boom
      ],
    };
    let retailErosion = 0;
    for (const k of BUILT_CLASSES) {
      const sec = e.secular[k];
      if (sec.leftM <= 0) {
        const menu = MENUS[k];
        const totW = menu.reduce((a, [, w]) => a + w, 0);
        let roll = rng(s) * totW;
        let drift = menu[0][0];
        for (const [d, w] of menu) { roll -= w; if (roll <= 0) { drift = d; break; } }
        sec.drift = drift;
        sec.leftM = Math.round(rrange(s, 144, 300));
      }
      sec.leftM--;
      // FLATS FOLLOW THE TOWN, NOT A MENU (2026-10-16). Demand for flats per
      // adult drew its eras independently of the town, so a town losing a
      // sixth of its people drew a household-formation wave and an
      // urbanisation surge and its flats ran 37% fuller per adult (measured).
      // Household formation is local: young adults form households where the
      // jobs are and double up or leave where they are not (headship falls
      // in a weak local labour market and recovers with it — Haurin & Rosenthal
      // 2007; Paciorek 2016). The drift is the national headship trend
      // (+0.15%/yr, 1960-2020) plus half of the town's job growth over the
      // nation's, read over five years; the menu above stays only for what
      // a menu still stands for elsewhere.
      // OFFICES, SHOPS AND SHEDS FOLLOW THEIR CAUSES, NOT A MENU (2026-10-16).
      // The eras above were drawn: a town rolled "the browser eats the high
      // street" or "a logistics boom" whether or not anything in it had
      // happened. Each is now the thing that made the era:
      //  - offices: no era. What an office is wanted for is the firms in it —
      //    their headcount, their trades and what space costs them (their own
      //    books and choices); a headquarters town is a finance and
      //    law town, which the trades already are.
      //  - shops lose the goods that go online, and ONLINE (below) grows as the
      //    technology of selling at a distance improves (this town's own
      //    productivity path, market.ts tfpG) and as a shop's rent rises
      //    against a shed's.
      //  - sheds gain the fulfilment floor those online sales need, and lose
      //    the factories a dear dollar sends abroad (the exchange rate of the
      //    world block) — and win them back when it is cheap.
      if (k === "office") sec.drift = 0;
      if (k === "retail" || k === "industrial") sec.drift = 0;
      if (k === "multifamily") {
        const lj = Math.log(Math.max(1, e.jobs ?? 1));
        e.jobsLogRef ??= lj;
        e.jobsLogRef += (lj - e.jobsLogRef) / 60;
        const g = (lj - e.jobsLogRef) / 5;
        sec.drift = HEADSHIP_TREND + HEADSHIP_JOBS * (g - NAT_JOB_TREND);
      }
      if (k === "retail" && sec.drift < -0.005) retailErosion = -sec.drift;
      const coupled = k === "industrial" ? sec.drift + 0.6 * retailErosion : sec.drift;
      // A SHARE DECELERATES AS IT APPROACHES ITS IRREDUCIBLE CORE. THIS WAS AN
      // UNREVERTING WALK INTO A CLAMP, AND THE CLAMP WAS DOING THE WORK.
      //
      // `sec.idx * (1 + coupled/12)` is a biased multiplicative random walk —
      // the office menu's expected drift is -0.656%/yr and retail's is
      // negative too — so E[ln idx] fell linearly forever and the only thing
      // stopping it was the bracket. Measured in this engine over 6 seeds x
      // 100 years: office rested ON the 0.45 bound 13.8% of months, retail
      // 7.0% with a MEDIAN CENTURY ENDING OF 0.453 — the guard was the value.
      // The comment below still calls these "guards, not rails", and fake
      // number five is precisely a bound that is load-bearing rather than a
      // guard. It also explains retail's measured -1.22%/yr real rent for a
      // century that never recovers: composition ground into the floor and
      // stayed.
      //
      // The fix is arithmetic about SHARES and introduces no new number. A use
      // has an irreducible core — a dense city always needs some desks, some
      // shopfronts, some sheds — which is a fact this file already asserts for
      // industrial (INDUST_COMP_FLOOR, "last-mile and food distribution never
      // leave"). Generalising it: the drift applies to the REDUCIBLE portion,
      // the distance from the bound, so the bound is approached and never
      // reached. `room` and `head` are exactly 1.0 at idx = 1, so the menu's
      // calibrated rates are untouched at the reference point and only the
      // approach to the extremes decelerates.
      //
      // WHAT THIS COSTS, stated rather than hidden: a single deep era no
      // longer travels as far. The manufacturing exodus (-1.72%/yr) took the
      // index to ~0.50 in forty years under the old form and reaches ~0.61
      // under this one, because the last part of a share is the part nobody
      // can remove. The historical anchor was "roughly half over ~40 years";
      // this now under-shoots that on a single era and reaches it across two.
      // That is the honest trade for a bound that is a guard again.
      const span = coupled < 0 ? (sec.idx - 0.45) / (1 - 0.45)
                               : (2.2 - sec.idx) / (2.2 - 1);
      if (k === "office") { sec.idx = 1; continue; }
      if (k === "retail" || k === "industrial") continue;
      sec.idx = clamp(sec.idx * (1 + (coupled / 12) * Math.max(0, span)), 0.45, 2.2);
    }
    // ONLINE. The share of the town's shop-type sales made at a distance runs
    // toward the share at which shopping online and in a shop cost the same,
    // given (a) the technology of selling at a distance, which improves with
    // this economy's own technology level — log points since the opening,
    // times ONLINE_TECH — and (b) what a shop's floor costs against a shed's
    // (both real, against the opening). Measured US anchors: about 2% of
    // store-type sales online in 2000 and 15% by 2020 (Census e-commerce
    // series), which ONLINE_TECH reproduces at this economy's central
    // technology growth; at most about two fifths of what a high street sells
    // can ship at all (groceries, services, food and drink, the clinic), so the
    // share runs toward ONLINE_MAX, and only goods leave the shop: about
    // ONLINE_GOODS of retail floor sells shippable goods. Households move
    // their buying over about five years. A sale online needs about three
    // times the warehouse floor a sale in a shop does (Prologis 2020), so
    // the sheds gain ONLINE_SHED of their floor per unit of share.
    {
      const nn = e.nat;
      const techLn = nn?.techLn ?? 0;
      const realOf = (k: "retail" | "industrial") =>
        Math.log(Math.max(1e-6, ((e.effRentIdx?.[k] ?? e.rentIdx[k]) / Math.max(1e-6, e.cpi ?? 1))
          / Math.max(1e-6, (e.effAnchor?.[k] ?? e.rentAnchor?.[k] ?? e.rentIdx[k]))));
      const adv = ONLINE_TECH * techLn + ONLINE_COST * (realOf("retail") - realOf("industrial"));
      const z0 = Math.log(ONLINE_0 / (ONLINE_MAX - ONLINE_0));
      const target = ONLINE_MAX / (1 + Math.exp(-(z0 + adv)));
      e.online = (e.online ?? ONLINE_0) + (target - (e.online ?? ONLINE_0)) / 60;
      const lost = ONLINE_GOODS * (e.online - ONLINE_0) / (1 - ONLINE_0);
      e.secular.retail.idx = Math.max(0.3, 1 - lost);
      // Factories follow the exchange rate: a 10% dear dollar sends about 1%
      // of manufacturing floor a year abroad (the 1980s and 2000s episodes).
      const q = nn?.dem?.q ?? 0;
      e.manufIdx = Math.max(0.3, (e.manufIdx ?? 1) * (1 - MANUF_FX * q / 12));
      e.secular.industrial.idx = e.manufIdx * (1 + ONLINE_SHED * (e.online - ONLINE_0));
      void retailErosion;
    }
    // (The extra industrial stop at INDUST_COMP_FLOOR is gone, 2026-10-13: the
    // `span` deceleration above already approaches the bound without reaching it.)
    // THE SHARE OF THE TOWN'S WORK THAT WANTS A SHED, for the developers who
    // read it (dev.ts): since step 2 the firms' own — the floor the
    // industrial industries' heads take per job, against the first month's
    // (economy.ts) — not the secular index above. One answer.
    const ec = e.eco, ec0 = e.eco0;
    e.industComp = ec?.floorSf?.industrial && ec0?.floorSf?.industrial && ec0.jobs && ec.jobs > 0
      ? (ec.floorSf.industrial / ec.jobs) / (ec0.floorSf.industrial / ec0.jobs)
      : e.secular.industrial.idx;
  }

  // UNREAD AS OF THIS COMMIT. `unmet` is written once per class per month at
  // the bottom of the demand block and consumed by nothing — it is a function
  // local, so nothing outside can see it, and inside the file every other
  // occurrence is prose. Rent pressure forms from `vacTerm + scarcity`, and
  // scarcity reads `e.structTight`, not this. The long comment at its write
  // site argues about which form the line should take; that argument is now
  // moot until something reads it again. Left in place because the comment is
  // the only record of the investigation — see there.
  const unmet: Record<string, number> = {};
  // ONE QUEUE SETTLES ONCE. Mixed-use projects arrive atomically and a stalled
  // or cancelled physical job cannot leak an anonymous leg into stock.
  const monthDeliveries = settleSupplyDeliveries(s);
  for (const k of BUILT_CLASSES) {
    const stk = e.stock?.[k] ?? CITY_STOCK[k];
    // Keep the adaptive rent belief for the residual/land market. The decision
    // to order construction below now reads the same effective-rent pro forma
    // as the actual parcel desk, rather than a second optimism formula.
    if (!e.rentExp) e.rentExp = { ...e.rentIdx };
    e.rentExp[k] += 0.045 * (e.rentIdx[k] - e.rentExp[k]);
    // THE RATE EMA IS NOW READ BY NOTHING, and this comment used to claim it
    // was "a published market belief used by reports". It is not: grep finds
    // the write below, the reset in regime.ts, the declaration in types.ts, a
    // comment in value.ts quoting the RETIRED `rateEma/100 + DEV_SPREAD`
    // hurdle, and tools/econaudit.mjs perturbing it in the DEAD KNOB sweep —
    // which is the repo's own tool already reporting it dead. recordHistory
    // does not carry it, so it reaches no chart and no report.
    // Kept because old saves carry the field and a regime reset writes it;
    // it costs one EMA a month and no longer justifies itself as a belief
    // anybody consults. devPencils reads the shared class pro forma in
    // value.ts. If it is still unread next time somebody passes through, delete it.
    e.rateEma = (e.rateEma ?? e.indexRate) + 0.085 * (e.indexRate - (e.rateEma ?? e.indexRate));

    // ONE ORDER HURDLE. The class-level pro forma reads effective rent (and
    // therefore vacancy/concessions), operating cost, recoveries, hard and
    // soft cost, management, exit cap and the same developer margin as the
    // land residual and parcel desk. Credit availability remains a separate
    // real constraint on how much of a clearing pipeline gets financed.
    //
    // `vacGate` and the `cycleDev` start nudge are gone. They were duplicate
    // verdicts layered on top of economics: one said "do not build because
    // vacancy is high" after effective rent and exit cap had already priced
    // that vacancy; the other ordered cranes because a phase label said boom
    // even when the common pro forma said the project destroyed value.
    const credit = clamp(e.creditIdx ?? 1, 0.25, 1.25);
    // sitePencil is the P97 parcel pro forma — greenfield AND densify, sampled
    // separately so worn buildings cannot zero a class that still has dirt.
    // A zero pencil is a shut class. The old structFloor (0.35 / 0.55 of
    // appetite when no sampled site cleared) was the city ordering buildings
    // the desk said did not pencil, which is how office stock grew 0.11%/yr
    // while `pnpm devyield` reported 0 office sites of 1,291. Densify is in
    // the sample now; if neither greenfield nor redevelopment clears, the
    // honest response is that rents have to rise, not that supply appears
    // anyway. `rawSites === undefined` is the first year before the annual
    // refresh has run — treat as unconstrained so the book can form.
    const rawSites = e.sitePencil?.[k];
    // A RAMP, NOT A SWITCH (2026-10-15). `sitePencil` is zero unless the best
    // sampled site clears the full hurdle, so construction flipped on and off
    // from one annual refresh to the next (measured: apartment starts 0, 9,650,
    // 0, 3,430 in alternate years on one seed). Builders do not share one
    // hurdle — a merchant builder holding land, a family office, a pension fund
    // with a lower cost of capital will each go a little under the street's
    // line — so when the best sites stand within a tenth of clearing
    // (`siteHurdle`, the same P97 including the ones that fail), some still
    // start, in proportion to how close they are. Continuous at the hurdle.
    const nearH = e.siteHurdle?.[k];
    const ramp = nearH !== undefined && nearH < 1 ? Math.max(0, (nearH - 0.9) / 0.1) : 0;
    const sites = rawSites === undefined ? 1 : Math.max(0, rawSites > 0 ? rawSites : ramp);
    // ONE ANSWER TO "DOES IT PAY" (2026-10-13). This multiplied two of them:
    // `devPencils` (a generic scheme on a top-decile corner, no land, ~0.66 in
    // an ordinary month) times `sites` (the best real sites' own
    // hurdleRatio^1.2, already zero when none clears). The site read is the
    // honest one — real lots, real basis — and the generic one cut every
    // month's order by about a third on top of it. Measured over 75 years:
    // sites cleared in 71-93% of months while office sat 3 points under
    // natural vacancy and real rents outran real build cost by 0.4-0.8%/yr.
    const appetite = credit * sites;
    // ONE DRAW, TWO JOBS. This month's noise sizes the order AND sets how long
    // it will take to entitle, below. Capturing it rather than calling `rng`
    // twice keeps the random stream byte-identical to before the entitlement
    // queue existed, so an A/B on the same seed is a clean partial rather than
    // a different world — and it carries a fact besides: a bigger programme
    // takes longer to get through planning than a smaller one.
    const jitter = rng(s);
    // SUPPLY ANSWERS EMPLOYMENT (ECONOMY.md §F #2). Sticky startOwed shelves
    // when pinned were tried and rejected — they raised phantom crane demand
    // without buildable envelopes. This is different: when desired demand
    // already exceeds housable (`structTight`), the MONTHLY ORDER itself must
    // rise so densify/teardown/infill have a book to fill. Not a vac-floor
    // hike and not minting tenants — more floor ordered against a measured
    // capacity shortfall.
    const catchUp = 1 + Math.max(0, e.structTight?.[k] ?? 0) * 4.5;
    const start = stk * 0.0016 * appetite * catchUp * (0.7 + 0.6 * jitter);
    e.starts[k] = Math.round(start);

    // THE QUEUE. A start becomes a dated cohort; it delivers when its month
    // arrives and not before. Everything downstream — the delivery schedule,
    // the forward vacancy projection, the "what is coming" chart — falls out
    // of this one change, because the pipeline now knows WHEN as well as HOW
    // MUCH.
    if (!e.cohorts) e.cohorts = { office: [], retail: [], multifamily: [], industrial: [] };
    if (!e.completions12) e.completions12 = { office: 0, retail: 0, multifamily: 0, industrial: 0 };
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
    // A DECISION TO BUILD IS NOT A GROUNDBREAK, and until now it was.
    //
    // This line used to put the month's order straight into the book, and
    // `tickCityGrowth` spent the book the same month — so the distance between
    // the space market wanting four hundred thousand feet of office and a hole
    // in the ground was zero. `pnpm leadlag` read the leg as contemporaneous,
    // and negative once the draining of the book was allowed for, against a
    // band of 0-18 months.
    //
    // ENTITLE_MONTHS is a fact about the business, not a shape parameter. Site
    // control, design, entitlement and a construction lender run six to
    // eighteen months on a by-right commercial project in the United States,
    // and longer wherever the approval is discretionary. The harness's 0-18
    // band was written from the same fact, so agreement with it is not an
    // independent confirmation and is not claimed as one. The independent
    // prediction is the TOTAL LOOP, which nothing in the engine sets: it read
    // 5.3 years against real property cycles of 7-12, and a real
    // pre-development lag should push it up.
    e.entitling = e.entitling ?? { office: [], retail: [], multifamily: [], industrial: [] };
    e.entitling[k] = e.entitling[k] ?? [];
    if (start > 1) {
      const [eLo, eHi] = ENTITLE_MONTHS;
      const lag = Math.round(eLo + jitter * (eHi - eLo));
      e.entitling[k].push({ m: s.month + lag + CONSTRUCTION_CLOSE_M, sf: Math.round(start) });
    }
    // An entitled order has an eighteen-month expected shelf life. Decay the
    // existing book by 1/18 each month before newly-ready work joins it. The
    // old `min(book, thisMonthOrder * 18)` was not expiry: one weak month could
    // erase years of already-entitled projects instantly, which made observed
    // groundbreaks lead the orders that supposedly created them.
    //
    // Lengthening the shelf while the frictional floor binds was tried and
    // REJECTED on measurement: a sticky book raised `wanted` cranes that then
    // burned crew slots on sites that would not underwrite, and median office
    // stock CAGR fell (0.52% → 0.37% over six century seeds) — the opposite of
    // ECONOMY.md §F #2. The pool-service fix in rivals.ts is the supply answer
    // that measured forward; the shelf stays an eighteen-month fact.
    e.startOwed[k] *= 17 / 18;
    // …and what finished its entitlement this month joins the book a crane can
    // be pointed at.
    const ready = e.entitling[k];
    e.entitling[k] = [];
    for (const p of ready) {
      if (p.m <= s.month) e.startOwed[k] += p.sf; else e.entitling[k].push(p);
    }
    const delivered = monthDeliveries[k];
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
      office: CITY_STOCK.office * (1 - OPENING_VAC.office),
      retail: CITY_STOCK.retail * (1 - OPENING_VAC.retail),
      multifamily: CITY_STOCK.multifamily * (1 - OPENING_VAC.multifamily),
      industrial: CITY_STOCK.industrial * (1 - OPENING_VAC.industrial),
    };
    if (!e.cityVac) e.cityVac = { ...OPENING_VAC };
    if (!e.absorb12) e.absorb12 = { office: 0, retail: 0, multifamily: 0, industrial: 0 };
    e.stock[k] = stk + delivered;
    // ONE HOME PER HOUSEHOLD (2026-10-10). Flats read households at 0.75,
    // which no source in this file gives: twice the households wanting 68%
    // more homes. Household size is already in the driver (`hhIdx` counts
    // adults, and headship rides the secular menu), so each further household
    // needs a dwelling — and in a spatial equilibrium the island keeps its
    // share of the region's households at given relative prices, so its
    // demand for flats moves one-for-one with them. Price rations it through
    // the households' own choices (households.ts).
    // WHAT DEALS SIGN AT, rolled at the class's lease speed: the in-place
    // rent a sitting tenant pays (tenantBooks.ts and value.ts read it). It is
    // a record, not a demand term: since FORMULA_LEDGER #10 nothing here
    // prices space down or up — the firms do, choosing.
    const effNow = e.effRentIdx?.[k] ?? e.rentIdx[k];
    if (!e.inPlaceReal) e.inPlaceReal = { ...(e.effAnchor ?? e.rentAnchor ?? e.rentIdx) };
    e.inPlaceReal[k] += LEASE_ROLL[k] * (effNow / Math.max(0.35, e.cpi ?? 1) - e.inPlaceReal[k]);

    // WHAT EACH KIND OF SPACE IS ACTUALLY DEMANDED BY.
    //
    // History, each step a measured fault: every class once read jobs, so a
    // town whose people rose 18% saw no new demand for flats (the economy
    // audit); then flats read adults and the tenure margin, shops a blend of
    // people and jobs, offices and sheds jobs times how their trades were
    // doing, all of them against the first FILLED payroll (`jobsFilled0`,
    // 2026-10-14: the drawn size opened every town with space for tenants the
    // first labour solve removed).
    //
    // WHO LEASES THIS CLASS, AND HOW MUCH OF IT THEY NEED (2026-10-28, ONE
    // ECONOMY step 2). It is the firms' own floor now: every industry's heads
    // on the floor it rents — offices, shops, sheds — not at home and not in a
    // hospital, school, depot or yard (industries.ts OFF_FLOOR, REMOTE), at its
    // feet a worker, against the first month's (economy.ts `economyToEngine`).
    // A shop's heads are what its sales pay for, so shops follow the register's
    // spending (and the share of it that ships from a shed, `online`); a
    // plant's are what the nation buys of it (and what a dear dollar sends
    // abroad); an office's are its industry's sales. Flats follow the
    // register's renter households — who rent rather than own, household by
    // household, on what each costs (households.ts `tickTenure`), and less the
    // ones the plats' new houses took. Retired with it: the secular indices
    // as demand (the online shift and the factory floor are the industries'
    // now), the tenure index and the household-credit term (the register's
    // households carry their own card rates and their own choice to buy).
    // Before the books open (the opening months) the opening's level stands.
    if (e.jobsFilled0 === undefined && (e.history?.length ?? 0) > 1 && (e.jobs ?? 0) > 0) e.jobsFilled0 = e.jobs;
    const eco = e.eco, eco0 = e.eco0;
    // Flats: the renter households that want an island flat at the going
    // rents (households stage 2), against the first month they chose.
    const driver = k === "multifamily"
      ? (eco?.islandWant !== undefined && eco0?.islandWant ? Math.max(0.05, eco.islandWant / eco0.islandWant) : 1)
      : (eco?.floorSf && eco0?.floorSf?.[k] ? Math.max(0.05, (eco.floorSf[k] ?? 0) / eco0.floorSf[k]!) : 1);
    // A CLASS'S MOMENTUM IS ITS TENANTS' GROWTH AGAINST NORMAL. Monthly growth
    // of the driver less its own five-year average, smoothed over six months,
    // in the "boom units" its readers (rents, cap rates, absorption, tenant
    // stress) were calibrated in — see MOM_UNITS. The class booms when its
    // tenant base is growing faster than usual and busts when it shrinks; no
    // clock decides it.
    {
      if (!e.classDrv) e.classDrv = {} as Record<BuiltClass, number>;
      if (!e.classDrvTrend) e.classDrvTrend = {} as Record<BuiltClass, number>;
      const prevD = e.classDrv[k] ?? driver;
      e.classDrv[k] = driver;
      const g = prevD > 0 ? driver / prevD - 1 : 0;
      const tr = (e.classDrvTrend[k] ??= g);
      e.classDrvTrend[k] = tr + (g - tr) / 60;
      e.sectorMom[k] = clamp(e.sectorMom[k] + (MOM_UNITS * (g - tr) - e.sectorMom[k]) / 6, -0.02, 0.02);
      if (!e.sectorPhase) e.sectorPhase = { office: "steady", retail: "steady", multifamily: "steady", industrial: "steady" };
      const ph = e.sectorMom[k] > 0.006 ? "boom" : e.sectorMom[k] < -0.006 ? "bust" : "steady";
      if (ph !== e.sectorPhase[k]) {
        e.sectorPhase[k] = ph;
        if (ph !== "steady") {
          const exposed = ownsClass(s, k);
          pushNews(s, exposed ? (ph === "boom" ? "event" : "warn") : "info", ph === "boom"
            ? `${SECTOR_LABEL[k]} upturn: tenants expanding.`
            : `${SECTOR_LABEL[k]} demand softening; asking rents being cut.`);
        }
      }
    }
    // AND THE LEVEL EVENTS RIDE UNDERNEATH ALL OF IT. `swanClassLevel` is 1.0
    // in a city nothing structural has happened to, and it is the permanent
    // restatement of what this class is wanted for once something has: less
    // office per worker after remote work, fewer desks of any kind once the trade
    // that sat at them has gone, more shed once the shopping moved into one.
    // It multiplies rather than adding because it is a LEVEL, and it sits
    // outside `sectorMom` because that never stops reverting and this never
    // reverts at all. See swans.ts.
    // ...and the space a national swan has emptied for a while (a pandemic's
    // offices: blackswans.ts swanSpace), which comes back as it ends.
    const swanLvl = swanClassLevel(e, k) * (e.swanSpace?.[k] ?? 1);
    // It is the feet a worker takes on the class's floor, so every firm on it
    // takes it (streetRolls.ts `lvlNow`).
    if (k !== "multifamily") (e.spaceLvl ??= {})[k] = swanLvl;
    // THE STREET'S FIRMS DECIDE WHAT IS LET (streetRolls.ts, 2026-10-16).
    // Offices and shops are all on the map: what is occupied is what the
    // town's firms hold — the street's rolls and the player's — and what is
    // looking is the firms still searching. Sheds run half and half: the
    // region's off the map stays on the aggregate below (`aggOcc`), the
    // mapped ones are the firms'.
    // (flats: the street's households since households stage 2 — who stays,
    // who leaves, who chose a block from across the water; households.ts)
    const firms = k !== "multifamily" ? e.streetSpace?.[k] : e.flatSpace;
    const offShare = firms ? Math.max(0, 1 - (firms.cap + (e.playerNow?.sf?.[k] ?? 0)) / Math.max(1, e.stock[k])) : 0;
    // The class's ledger and the map drift a few per cent apart over decades
    // (deliveries and demolitions are booked to the stock as they happen);
    // at 2% that sliver alone sent the shops back to the aggregate equation,
    // which no longer describes the town's firms, and it read a 10-40%
    // shortage at 4-13% vacancy (retail rents x2.7 in six years, measured).
    // The offices and shops stay the firms' market; the sliver off the map is
    // let as the street is.
    // ALWAYS, for offices and shops (2026-10-16): even a 10% threshold was
    // crossed in a boom (seed 32, year 54: the ledger ran ahead of the map as
    // the town grew 30% in seven years), the shops fell back to the aggregate
    // equation and read a 98% shortage at 12% vacancy, and real shop rents
    // went 11 -> 85 in five years. Sheds stay split (most are off the map).
    const firmsOnly = !!firms && (k === "office" || k === "retail" || k === "multifamily" || offShare < 0.10);
    // WHAT THE FLOOR OFF THE MAP IS WANTED FOR (FORMULA_LEDGER #10). Every
    // foot the town's named firms demand is theirs (streetRolls.ts); what the
    // aggregate below still carries is the floor of the firms off the map —
    // the region's sheds — and, in a town with no mapped commercial stock,
    // the whole class. It is those firms' own need: every industry's
    // employment on a floor of this class at its feet a worker (economy.ts
    // `workSf`, the same heads × feet a named firm's need is), moved one for
    // one from the floor the off-map stock held when the books opened (an
    // initial condition: OPENING_VAC on the off-map share). Why the whole
    // class's industries and not only the heads the named firms do not hold:
    // the books do not keep the region's shed tenants apart from the
    // island's — measured on map 1, the industrial industries' on-floor heads
    // beyond the named firms' were 0-170k sf of need against 540k sf of
    // occupied sheds off the map, and a driver read off that sliver swung the
    // region's shed demand twentyfold month to month. So the off-map sheds
    // move with the class's industries as a whole, which is what the region's
    // distributors and makers are. No
    // affordability, income or Cobb-Douglas term: rent reaches the off-map
    // firms through their own books (economy.ts: their rent is a cost, and a
    // dear region employs fewer of them), and the street's through its firms'
    // choices. (Retired with it: AFFORD_BAND, SIGMA_KL and the street's
    // rent share, INCOME_ELAST, the sector-exit ratchet on `baseStock`.)
    // Before the books open, the opening's level stands.
    let targetRaw: number;
    const base = (e.baseStock?.[k] ?? CITY_STOCK[k]) * (1 - OPENING_VAC[k]);
    if (k === "multifamily") targetRaw = base * driver * swanLvl;
    else {
      const f = firms ? Math.max(0.02, offShare) : 1;
      const w = eco?.workSf?.[k], w0 = e.eco0?.workSf?.[k];
      const work = w && w0 ? Math.max(0.05, w / w0) : 1;
      const ref = ((e.offRef ??= {})[k] ??= (firms ? (e.aggOcc?.[k] ?? e.occupied[k]) : e.occupied[k]) * f);
      const want = ref * work * swanLvl;
      (e.offWant ??= {})[k] = want;
      targetRaw = want / f;
    }
    // THE POOL. Demand takes about a year to form or dissolve, and demand
    // that cannot be housed here stops looking here within months — the
    // mainland takes it, exactly the fiction stockFromParcels already tells.
    // Note targetRaw reads baseStock, frozen at newGame: supply NEVER touches
    // the demand side. That sentence is the whole rebuild.
    //
    // SEARCH FRINGE. Tenants looking for space are real; a permanent queue of
    // 8% of stock that can never be housed is not. Measured on century seeds
    // after the rent-rail fixes: with vacancy pinned, `pool` chased a job-driven
    // `targetRaw` far above `housable` every month, the 25% drain lost to the
    // 10% formation chase, and `unmet` grew to ~0.08 — minting scarcity rent
    // of nearly a point a month from tenants who do not exist as occupants and
    // never will. Real asking rents compounded to ~5× real over a century.
    //
    // Desired demand may still be huge (jobs outran floors). The LOOKING pool
    // only holds what the city can house plus a normal fringe of active
    // searchers — about a quarter of natural vacancy, the share between leases.
    // Beyond that, unhousable demand has already left for the mainland; it does
    // not keep refilling from a headcount that assumes infinite floors.
    // Housable is standing floor that is actually a suite — not new
    // deliveries still in lease-up. Capping the pool on `stock × (1 -
    // friction)` made every delivery raise the cap and occupy the same
    // month. Dark floor keeps the looking book from counting a crane's
    // last pour as already let.
    if (!e.darkSf) e.darkSf = { office: 0, retail: 0, multifamily: 0, industrial: 0 };
    const housable = housableStock(e, k);
    const searchFringe = e.stock[k] * normalVac(e, k) * 0.25;
    const poolTarget = Math.min(targetRaw, housable + searchFringe);
    if (!e.pool) e.pool = { ...e.occupied };
    // HOW FAST DEMAND TURNS INTO A SEARCH, BY CLASS (2026-10-09). One rate
    // (10%/mo) for every class meant a household arriving in town took as long
    // to start looking for a flat as a firm takes to decide it needs another
    // floor. See DEMAND_FORM_M.
    e.pool[k] += (poolTarget - e.pool[k]) / DEMAND_FORM_M[k];
    e.pool[k] -= 0.25 * Math.max(0, e.pool[k] - housable * 1.02);
    // (RETIRED 2026-10-28, step 2: "space caps payroll desire" bled the
    // employment index, and the trades' indices for sheds, when the class's
    // demand ran past what the island could house. A firm that cannot find a
    // floor here now stays off the map — the region's — and its heads are
    // the off-map firms' (economy.ts); the island's floor caps the island's
    // firms, not the region's payroll.)
    // ABSORPTION IS FINITE, and it is a property of TENANTS, not buildings.
    // The clamps and the noise used to scale with stock — a bigger city of
    // buildings signed leases faster. Now they scale with occupied: a bigger
    // city of tenants does.

    // ABSORPTION RUNS AT THE SPEED OF A LEASE, BY CLASS AND BY DIRECTION
    // (2026-10-09). This was 5.5%/mo for every class in both directions, slowed
    // by up to 45% when vacancy was high ("matching friction"), and capped at
    // +1.0% / -0.6% of occupied a month. Measured over 8 worlds x 50 years,
    // a year of office job growth showed up as 0.17-0.20 of itself in occupied
    // office (r ~0.2), occupied office fell in only 44-53% of years in which
    // payrolls fell, and a year of population growth reached occupied flats
    // at 0.24-0.36 — against a record in which office absorption tracks
    // office-using jobs about one-for-one within a year or so and turns
    // negative in essentially every recession (Wheaton & Torto), and in which
    // a household that arrives in town is housed within weeks.
    //
    // MOVING IN is the leasing process: tour, LOI, lease, fit-out for offices
    // and shops; a lease and a set of keys for a flat. MOVING OUT runs at the
    // speed leases let a tenant leave — a shrinking firm sublets and goes at
    // expiry (in 2009 office net absorption was about -1.5 to -2% of stock
    // against -5% office employment, ~0.35 inside the year), a renter gives a
    // month or two of notice. See MOVE_IN_M / MOVE_OUT_M.
    //
    // The vacancy "friction" is gone: in a glut a looking tenant finds space
    // FASTER, not slower (Wheaton 1990, search with vacancy); a glut's
    // absorption is limited by how many tenants there are, which is the gap
    // itself. The old caps become a guard at 3% of occupied a month, a pace no
    // market has sustained.
    // THE PLAYER'S LEASING MOVES THE CITY TOTAL (see playerSpace, sim.ts): the
    // change in what the player's buildings actually hold since last month is
    // the city's change too, before the street's absorption runs on the gap.
    const pNow = e.playerNow?.occ?.[k];
    if (firms && !firmsOnly) e.occupied[k] = (e.aggOcc ??= {})[k] ?? e.occupied[k];
    let absorb = 0;
    if (firmsOnly) {
      const before = e.occupied[k];
      const onMap = firms!.cap + (e.playerNow?.sf?.[k] ?? 0), letMap = firms!.let + (pNow ?? 0);
      e.occupied[k] = Math.min(e.stock[k], letMap + Math.max(0, e.stock[k] - onMap) * Math.min(1, letMap / Math.max(1, onMap)));
      absorb = e.occupied[k] - before;
      e.pool[k] = e.occupied[k] + firms!.seek;
      if (pNow !== undefined) (e.playerOcc ??= { office: 0, retail: 0, multifamily: 0, industrial: 0 })[k] = pNow;
    } else if (pNow !== undefined) {
      const pPrev = e.playerOcc?.[k];
      if (pPrev !== undefined) e.occupied[k] = Math.max(0, e.occupied[k] + (pNow - pPrev));
      // The first count (a new game, or a save from before this): the total
      // still assumes the player's floors are let at the market's rate —
      // swap that assumption for what they actually hold, once.
      else e.occupied[k] = Math.max(0, e.occupied[k] + pNow
        - (e.playerNow?.sf?.[k] ?? 0) * (e.occupied[k] / Math.max(1, e.stock[k])));
      (e.playerOcc ??= { office: 0, retail: 0, multifamily: 0, industrial: 0 })[k] = pNow;
    }
    if (!firmsOnly) {
    // STREET TENANTS FAIL OFF THEIR OWN BOOKS (2026-10-15): representative
    // tenants per trade and covenant (tenantBooks.ts), the same accounts the
    // player's tenants keep. Their failures above the background the churn
    // already carries hand space back at once, and are gone as demand too.
    if (k !== "multifamily") {
      // From the street's own rolls when it keeps them (streetRolls.ts); the
      // representative cohorts only for a town with no mapped commercial stock.
      // The street's own firms fail off their own books (streetRolls.ts); the
      // representative cohorts only for a town with no mapped commercial stock.
      const share = e.streetRolls ? 0
        : tickStreetTenants(e, k, SECTOR_CLASSES[k] ?? [], e.sectorShare ?? {}, s.month);
      if (share > 0) {
        const street = Math.max(0, e.occupied[k] - (pNow ?? 0));
        const shed = street * share;
        e.occupied[k] -= shed;
        e.pool[k] = Math.max(0, e.pool[k] - shed);
        (e.failedSf ??= { office: 0, retail: 0, multifamily: 0, industrial: 0 })[k] += shed;
      }
    }
    const gapSf = e.pool[k] - e.occupied[k];
    absorb = clamp(gapSf / (gapSf > 0 ? MOVE_IN_M[k] : MOVE_OUT_M[k]), -0.03 * e.occupied[k], 0.03 * e.occupied[k])
      + e.occupied[k] * rrange(s, -0.0005, 0.0005);
    // FRICTIONAL VACANCY IS RESIDENCE TIME, not a rail. Suites sit dark
    // between tenants for `reletMonths`; new floor sits dark until it
    // has been a suite. Occupied cannot eat either. The hard floor on how
    // fast a market can empty is still the -0.006 × occupied absorb bound;
    // vacancy itself is 1 − occ/stock, allowed to print what the flows did.
    const inTransit = betweenTenantsSf(e.occupied[k], k, e);
    // ...and the street cannot move its tenants into the player's empty floors.
    const playerDark = pNow !== undefined ? Math.max(0, (e.playerNow?.sf?.[k] ?? 0) - pNow) : 0;
    const streetCap = Math.max(pNow ?? 0, housable - inTransit - playerDark);
    // ABOVE THE CAP, TENANTS STILL MOVE OUT (2026-10-15). This held occupied
    // wherever it already was once it sat over the cap, so a flat market
    // could stay fuller than physically possible: measured, apartment vacancy
    // 0.12% against a 1.9% residence floor (the flats between tenants), i.e.
    // nobody moving for a year. The suites in transit are empty by
    // definition; occupied above the cap now drains to it at half the gap a
    // month, as leases turn — not in one step, so a demolition or a stock
    // count does not print a cliff.
    const next = clamp(e.occupied[k] + absorb, 0, Math.max(streetCap, Math.min(e.occupied[k], housable)));
    e.occupied[k] = next > streetCap ? next - 0.5 * (next - streetCap) : next;
    if (firms) {
      // The region's sheds keep the aggregate; the mapped ones are the firms'.
      e.aggOcc![k] = e.occupied[k];
      e.occupied[k] = Math.min(e.stock[k], e.occupied[k] * offShare + firms.let + (pNow ?? 0));
    }
    }

    // THE SUBLET MARKET IS WHAT FIRMS HOLD BEYOND WHAT THEIR HEADS NEED
    // (FORMULA_LEDGER #10). It was a give-back read off an aggregate demand
    // equation at today's rent (`wantedNow`: the opening stock × drivers ×
    // a bounded affordability term) against what the class occupied, plus an
    // idiosyncratic background share of occupied (SUBLET_BG). Now it is each
    // named firm's own floor against its own need — the feet it leases less
    // its heads × its industry's feet a worker (streetRolls.ts `excess`) — and
    // the off-map firms' occupied floor against theirs (`offWant`). The
    // share a tenant can physically demise (DEMISABLE) reaches the market at
    // sublet speed (SUBLET_TAU), and is withdrawn as fast when the heads come
    // back. A firm that shrinks, a firm that signed a suite bigger than its
    // people, a trade the swan sent home: each is its own line here.
    if (!e.sublet) e.sublet = { office: 0, retail: 0, multifamily: 0, industrial: 0 };
    let excess = k !== "multifamily" ? (firms as { excess?: number } | undefined)?.excess ?? 0 : 0;
    if (!firmsOnly && k !== "multifamily") {
      const heldOff = firms ? (e.aggOcc?.[k] ?? 0) * offShare : e.occupied[k];
      excess += Math.max(0, heldOff - (e.offWant?.[k] ?? heldOff));
    }
    const marketable = clamp(excess * DEMISABLE[k], 0, e.occupied[k] * SUBLET_MAX[k]);
    e.sublet[k] += (marketable - e.sublet[k]) / SUBLET_TAU;
    e.sublet[k] = clamp(e.sublet[k], 0, e.occupied[k]);

    e.cityVac[k] = clamp(1 - e.occupied[k] / e.stock[k], 0, 0.45);
    // THE STREET'S VACANCY, WHICH IS NOT THE CITY'S WHEN YOU OWN PART OF IT
    // (2026-10-15). Every building the player does not own read the CITY
    // rate — which counts the player's empty floors. So a player who built a
    // million empty feet marked every incumbent in town as if it shared them,
    // and when those floors filled by taking the incumbents' tenants, the
    // city rate did not move and nobody else felt a thing. Measured on a
    // town overbuilt by the player: new core towers at 22-54% leased for a
    // decade while the street's books held 85-89%. Real overbuilding runs the
    // other way — the new Class A fills out of the old stock and the old stock
    // empties (Houston 1983-88, Manhattan 1990-93). The market's read on a
    // building it does not own is the vacancy of the buildings like it.
    {
      const pSf = e.playerNow?.sf?.[k] ?? 0, pOcc = e.playerNow?.occ?.[k] ?? 0;
      const streetSf = e.stock[k] - pSf;
      (e.streetVac ??= { ...e.cityVac })[k] = streetSf > e.stock[k] * 0.05
        ? clamp(1 - Math.max(0, e.occupied[k] - pOcc) / streetSf, 0, 0.45)
        : e.cityVac[k];
    }
    // ...and the street by quality (bands.ts): which of its floors the vacancy is in.
    tickBands(e, k);
    // New deliveries age out of lease-up on the same clock a vacated suite
    // does. No draw: the months are a property of the use, already named.
    e.darkSf[k] = Math.max(0, (e.darkSf[k] ?? 0) * (1 - 1 / Math.max(1, reletMonths(k))));
    // Demand that cannot be housed nets off the sublet market first, because a
    // tenant who needs space this year takes a sublease — that is what the
    // sublet market is FOR, and it is why a shortage with sublet inventory
    // standing in it is not the same shortage.
    /**
     * THIS IS THE ABSORPTION QUEUE WEARING THE WORD "SHORTAGE", AND FIXING IT
     * NAIVELY HALVES THE PROPERTY CYCLE. Both halves of that are measured.
     *
     * `pool - occupied` IS the absorption queue: `absorb = 0.055 * (pool -
     * occupied)` thirty lines up is this same expression, so it is a mechanical
     * statement about how fast the queue clears and it is positive whenever
     * demand grows at all. Demand that physically cannot be housed is demand
     * against CAPACITY — `housable`, the quantity the pool is already trimmed
     * to at line 2252.
     *
     * The engine had already caught this and written it down one screen up, in
     * the tightness EMA: feeding that off `unmet` was "tried and REJECTED on
     * measurement" because `unmet` "carries a large structural positive offset
     * ... because the demand pool always leads occupancy". Judged unusable
     * there, load-bearing here, with the reason on the page.
     *
     * Measured, office, 1,800 months over three seeds and fifty years:
     *
     *                        mean      > 0
     *   as coded          0.01806    79.7%
     *   as documented     0.00292    12.9%
     *
     * and the line that ought to settle it: the city is in GLUT — availability
     * above natural — in 67.2% of months, and as coded it reports unhoused
     * demand AT THE SAME TIME in 49.7% OF ALL MONTHS. Half the game, the model
     * asserts tenants cannot be housed while 14.6% of the stock stands empty.
     * As documented that contradiction happens in 0.0% of months, not once in
     * 1,800.
     *
     * SO WHY IS THE LINE STILL AS CODED. Because switching it to `housable`
     * BREAKS THE LINK BETWEEN ORDERING A BUILDING AND BUILDING ONE. Measured on
     * `pnpm leadlag` after its estimator was itself fixed — the first reading of
     * this was taken with an argmax-per-town estimator that turned out to be
     * medianing coin tosses, so these are the numbers that can bear the weight:
     *
     *                     as coded            as documented
     *   TOTAL LOOP        75mo (6.3 yr)       43mo (3.6 yr)
     *   orders -> breaks  +7mo, r 0.31        -19mo, r 0.16  <-- NO SIGNAL
     *
     * The lag flipping is not the finding; r collapsing from 0.31 to 0.16 is.
     * The order book stops predicting groundbreaks at all. The city goes on
     * asking for buildings and the shovels no longer answer.
     *
     * AND THE REASON IS VISIBLE IN THE SAME RUN: with the phantom shortage
     * gone, the share of lots a builder could actually afford falls from 4.26%
     * to 1.38% and median land falls 42%. Development stops pencilling. So the
     * near-permanent rent push — present in 79.7% of months — had been holding
     * rents high enough to keep the pipeline clearing, and the seven-year cycle
     * was resting on it.
     *
     * AND THE PRO FORMA IS NOT THE FAULT — I checked before blaming it, and an
     * earlier version of this comment blamed it anyway. Measured on 609 vacant
     * lots at year 25, best use each:
     *
     *                     p10     p50     p90
     *   yield on cost    4.42%   5.94%   7.13%
     *   exit cap         4.41%   6.44%   6.96%
     *   spread          -1.54    0.06    1.28  pp
     *
     * Both levels sit inside the real band — merchant development underwrites
     * 6-8% on cost against a 5-7% exit in a secondary metro — so construction
     * cost, the required yield and the exit cap are all calibrated. And a
     * MEDIAN SPREAD OF ZERO IS THE DESIGN, not a defect: most dirt does not
     * pencil, which is why most dirt is still dirt, and econstress says so in
     * writing where the hurdle is set. 6.7% of lots clear +1.5pp at year 25 and
     * 13.3% across all months, so the cranes do move.
     *
     * So the open question is NARROWER than "the city cannot build", which is
     * what this comment said before the measurement was taken. Development is
     * meant to be thin; the phantom shortage was making it artificially less
     * thin, and removing it thins it past the point where the ORDER BOOK still
     * predicts groundbreaks at all. What to work out is why that correlation
     * depends on the rent push rather than on the queue — `e.starts` is driven
     * by `appetite`, which reads margin, so orders and shovels may be being
     * driven by the same rent term instead of by one another, which would make
     * that leg a mirror rather than a mechanism.
     *
     * CLAUDE.md's rule applies to whatever comes back: DO NOT tune a
     * coefficient to put the cycle back. That would be a constant chosen to
     * make an outcome look right, which is the first thing it forbids.
     *
     * ---------------------------------------------------------------------
     * RE-TESTED after the order book was made real, and STILL PARKED — but the
     * prop is measurably weaker and the reason it is still needed has a name.
     *
     * The diagnosis above was that `orders -> breaks` collapsed because the
     * phantom rent push was the only thing tying the two series together. That
     * implied a prediction: give the leg a mechanism of its own and the prop
     * should come out. `useForZone` now picks the use from the order book's own
     * composition and `econ.entitling` gives the queue a six-to-eighteen month
     * duration, so the prediction was testable. Measured on EIGHT towns, which
     * is the power this leg needs — four towns flattered it:
     *
     *                        as coded      as documented
     *   orders -> breaks    +14mo r 0.37   +14mo r 0.25   <-- NO SIGNAL
     *   legs out of order         2              4
     *
     * So the prop did weaken: r fell to 0.16 when this was last tried and only
     * to 0.25 now, with the lag staying put at +14 instead of flipping to -19.
     * Two mechanisms took most of the load off it. It is not off yet.
     *
     * THE LOOP LENGTH LOOKED LIKE A WIN AND IS NOT. It reads 116mo (9.7 years),
     * inside the real 7-12 band where the current engine reads 6.8. But the
     * loop is the SUM of the legs, and `value -> orders` lands at 57mo against
     * a MAXLAG of 60 — three months off the search boundary, which is the
     * file's own definition of unidentified. A leg whose argmax has run out of
     * road is not a long lag, and a loop length built out of one is not a cycle.
     *
     * It also starts a rail that had never bound: `rail.cap.multifamily.lo`
     * goes from 0 to 7.3% of months on the 3.4% cap-rate floor, with median
     * land -10% and the dead-leg share up 5.9%.
     *
     * FIX (demand depth): unmet is now physical capacity shortage of the
     * LOOKING pool against housable. Rent scarcity reads `structTight` —
     * desired demand (targetRaw) against housable — so true job/floor imbalance
     * still presses rents and keeps underwriting alive when the city is short
     * of space, without minting pressure from a mere absorption queue in a glut.
     */
    unmet[k] = Math.max(0, (e.pool[k] - housable - (e.sublet[k] ?? 0)) / Math.max(1, e.stock[k]));
    if (!e.structTight) e.structTight = { office: 0, retail: 0, multifamily: 0, industrial: 0 };
    // THE QUEUE OFF THE MAP: the off-map firms' need (`targetRaw`, their
    // heads × their industries' feet a worker) over what the city can house.
    // (It read `wantedNow`, an aggregate demand at today's rent, until
    // FORMULA_LEDGER #10: the rent works through the firms' own choices.)
    e.structTight[k] = Math.max(0, (targetRaw - housable) / Math.max(1, e.stock[k]));
    // Where the town's firms ARE the market (streetRolls.ts), the queue is the
    // firms actually looking that the empty floors could not take — not the
    // aggregate equation's wish list. In a glut that is nothing, and rents
    // fall as a glut's should.
    // ...and where the sheds run half and half, too (FORMULA_LEDGER #10): the
    // off-map firms' need beyond the off-map stock is a firm that leases on
    // the mainland — the region's — not a queue at the island's door. Read
    // as one, it was the region's whole payroll growth against a stock of
    // sheds off the map that never grows, a shortage no island floor could
    // answer (measured, map 1: industrial `structTight` over the builders'
    // 6% trigger most months, sheds built into a falling occupancy).
    if (firms) e.structTight[k] = Math.max(0, (firms!.seek - Math.max(0, housable - e.occupied[k])) / Math.max(1, e.stock[k]));
    e.absorb12[k] = e.absorb12[k] * (11 / 12) + absorb;
    monthAbs[k] = absorb;
    monthComp[k] = delivered;
  }

  // RENTS MOVE ON AVAILABILITY. The gap between the space a tenant can
  // actually go and lease — empty floors plus everything on the sublet market
  // — and the natural rate is the whole of the landlord-tenant power balance.
  // Five points of EXCESS takes rents down about 6.5% a year and nine points
  // about 14.7%, because the glut branch is superlinear and a capitulation is
  // not a straight line. Those two are exact and were checked against 1990-92
  // and 2020-23.
  //
  // THE SHORTAGE FIGURE IN THIS PARAGRAPH WAS STALE AND IS CORRECTED. It said
  // "five points of shortage moves rents about 2.7% a year", which was true of
  // `depth * 0.045` before `railSat` was introduced (the firm-near-rail fix in
  // ECONOMY.md). With saturation the branch is
  //     clamp(depth * 0.045 * railSat, 0, 0.0045),  railSat = room/(room+0.025)
  // and at five points of office shortage vacancy is 6.5%, room above friction
  // 2.8pp, railSat 0.53 — so it delivers 1.44%/yr, barely half the figure this
  // comment claimed. The reachable MAXIMUM for office is 1.45%/yr (depth+room
  // is fixed at the natural rate - frictionFloor = 7.82pp, and depth*railSat peaks
  // at 0.0266 near room = 2.5pp); retail 0.91%, industrial 0.83%,
  // multifamily 0.34%. The 0.0045 ceiling on that branch is consequently
  // unreachable by 3.7x — it is a guard, and nothing rests on it.
  //
  // That asymmetry is deliberate and worth stating plainly: a glut can take
  // rents down far faster than a shortage can push them up, because a market
  // cannot get tighter than its frictional floor. Phase drift and sector
  // momentum ride on top as sentiment.
  //
  // City class tracks build-out: a Landing that fills in earns more of the
  // primary rent channel; intensity is morphological FAR / REF at open,
  // scaled by stock growth so a century of cranes can graduate the town.
  {
    const built0 = Math.max(1, e.builtSf0 ?? 1);
    const built = BUILT_CLASSES.reduce((a, k) => a + (e.stock?.[k] ?? 0), 0);
    const i0 = e.cityIntensity0 ?? e.cityIntensity ?? 1;
    e.cityIntensity = clamp(i0 * (built / built0), 0.15, 6);
  }
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
    // ...AGAINST THE RATE THIS MARKET IS USED TO (2026-10-16). The natural
    // rate was one number per class for every town and every decade. It is
    // not one number: it differs across metros by several points and drifts
    // within one (Voith & Crone 1988; Gabriel & Nothaft 2001), and the way
    // the people in a market know it is the way they know anything else
    // about it — what availability has run at, over a long memory. The
    // national figures are where a town starts; from there each market's
    // normal is its own twenty-year history (half-life).
    const avail = (e.cityVac?.[k] ?? normalVac(e, k))
      + (e.sublet?.[k] ?? 0) / Math.max(1, e.stock?.[k] ?? CITY_STOCK[k]);
    const nv = (e.natVac ??= { ...OPENING_VAC });
    // ...BUT NOT FROM A SHORTAGE. A month the market spends on its
    // between-tenants floor with tenants still queueing (`structTight`) is not
    // evidence of what normal is: it is the shortage itself, and learning from
    // it taught a market short for eighty years that short was normal (natural
    // vacancy 4.3% → 3.1%, the gap that should have raised rents erased).
    if (!((e.structTight?.[k] ?? 0) > 0.005)) nv[k] += (avail - nv[k]) * NATVAC_RATE;
    const gap = avail - nv[k];

    // WHERE THE VACANCY-TO-RENT LAG IS NOT (OBSERVATION). `pnpm leadlag` says
    // this leg runs SIMULTANEOUS (0 months) where a real one runs 3 to 24, and
    // lagging the vacancy OBSERVATION — feeding `vacTerm` a trailing average
    // instead of this month's gap — was built, measured and is WRONG.
    // Identification test: driving the observation lag from 0 months to 24
    // moved the measured leg from 0mo to MINUS 3, not toward positive at all,
    // while the total loop fell from 5.7 years to 4.7. If a 24-month lag on
    // what landlords SEE cannot move the leg, the lag is not in the print — it
    // is in the APPLICATION of pressure into rentIdx. See `rentPress` below:
    // vacTerm+scarcity form instantly; asking rents move only after that
    // pressure has sat on the quote sheet for months (lease-quote lag, not
    // capitulation and not a data delay).
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
    // OFFICES, SHOPS AND SHEDS: THE RENT IS WHAT THE LEASES SAY (ONE ECONOMY
    // step 4, tenantMarket.ts). Where the town's firms are the market, each
    // landlord prices its own space and each firm shops; the indices below —
    // asking, effective, and the concession level between them — are the
    // comps of the last six months read back, not an equation of vacancy.
    // A month with no deal in the window leaves them standing.
    // THE FLATS: THE RENT IS WHAT EACH BLOCK'S LANDLORD ASKS (FORMULA_LEDGER
    // #4/#5). The households choose the blocks (households.ts); each block's
    // landlord re-marks its ask from its own lettings against the vacancy it
    // has learned to expect, and the flats' indices are read off the blocks'
    // asks and the leases signed (streetRolls.ts `tickStreetFlats`). The
    // vacancy equation below never prices a flat.
    if (k === "multifamily") continue;
    if (e.streetRolls) {
      const before = e.rentIdx[k];
      const ro = readOut(e, k, s.month);
      if (ro) {
        e.rentIdx[k] = +ro.face.toFixed(4);
        e.effRentIdx[k] = +ro.eff.toFixed(4);
        e.concIdx[k] = +ro.conc.toFixed(4);
      }
      const nomCh = before > 0 ? e.rentIdx[k] / before - 1 : 0;
      if (!e.rentPath) e.rentPath = {} as NonNullable<Econ["rentPath"]>;
      e.rentPath[k] = { gap, vacTerm: 0, instant: 0, pressEma: 0, pressClamped: 0, clampBound: false, escalation: 0, anchor: 0, drift: nomCh, nomCh };
      if (Math.abs(nomCh) >= 0.006 && ro) {
        const line = `${SECTOR_LABEL[k]} asking rents ${nomCh < 0 ? "fell" : "rose"} ${Math.abs(nomCh * 100).toFixed(1)}% this month — ${ro.n} leases in the last six months, ${(ro.sf / 1000).toFixed(0)}k sf, signed at $${ro.face.toFixed(2)} asking and $${ro.eff.toFixed(2)} after concessions.`;
        e.rentWhy = { ...(e.rentWhy ?? {}), [k]: line };
        // THE CAUSE LEDGER: the move, its leases, and the market they signed in.
        const rid = whyMark(s, `rent:${k}`, why(s, {
          k: "market.rent", a: "trade", aid: k, name: SECTOR_LABEL[k],
          n: { rent: e.rentIdx[k], eff: e.effRentIdx[k], ch: nomCh, leases: ro.n, sf: ro.sf },
          t: `${SECTOR_LABEL[k]} asking rent $${e.rentIdx[k].toFixed(2)}/sf, ${nomCh >= 0 ? "+" : "−"}${Math.abs(nomCh * 100).toFixed(1)}% this month · ${ro.n} leases in six months, $${ro.eff.toFixed(2)} after concessions`,
        }, [whyAt(s, `vac:${k}`) ?? whyVacancy(s, k), whyNation(s)]));
        if (Math.abs(nomCh) >= 0.012 || (ownsClass(s, k) && newsChance(s, `rentwhy:${k}`, 0.22))) {
          s.news.unshift({ q: s.month, kind: nomCh < 0 ? "warn" : "info", text: line, why: rid });
        }
      }
      continue;
    }
    const concTarget = concessionTarget(gap, e.phase);
    // A CONCESSION IS GIVEN IN A MONTH AND TAKEN BACK OVER A LEASE.
    //
    // This chased its target at 0.25/month in BOTH directions, so the giveaway
    // evaporated as fast as it arrived — and because `concTarget` is a level
    // function of TODAY's availability, it returned to zero the moment vacancy
    // normalised. Measured with `pnpm glut`: at a 10% office glut the dial is
    // back to 0.00 by month 60 with availability still 5.7pp above the paired
    // control, and effective rent has re-converged on asking exactly. The
    // consequence is that the ASKING index ends up carrying 74-86% of the whole
    // effective-rent adjustment at three years, across every class and every
    // dose — twelve readings out of twelve — because `rentIdx` integrates the
    // same pressure permanently while this dial forgets it.
    //
    // Real markets are not symmetric here and the record is unusually clear.
    // Opening: US gateway free rent went 9.7 months (Q1 2020) to 12.5 (Q1 2021),
    // +29% in four quarters. Closing: Manhattan went 13 months (2019) to 17
    // (2022) to 16 (Q1 2023) and was still near 17 in Midtown in 2024 — five
    // years and essentially nothing given back. Four years after the shock,
    // Manhattan asking was -3.3% while net effective was -17.3%.
    //
    // The mechanism behind that asymmetry is not sentiment. A landlord can
    // concede this month, but he cannot UN-concede until the paper rolls: the
    // giveaway is written into leases that run for years, and the comparables
    // the next tenant's broker points at are those same signed deals. So the
    // market's concession level decays at the rate its leases turn over, not at
    // the rate its vacancy does. These are the classes' own lease terms — the
    // same numbers `rollRecovery`/term draws already work from, roughly five
    // years of office and retail paper, three of industrial, one of housing.
    const CONC_DECAY: Record<BuiltClass, number> = {
      office: 1 / 60, retail: 1 / 60, multifamily: 1 / 12, industrial: 1 / 36,
    };
    //
    // WHAT THIS DID AND DID NOT DO, measured with `pnpm glut`, office, 10% of
    // stock, five paired seeds, nominal, at fixed horizons:
    //   the dial now persists          m120 treatment 0.00 -> 0.17
    //   the BALANCED market now has a package at all, which it did not:
    //                                  control dial 0.00 -> 0.38 at the drop,
    //                                  0.15 at five years
    //   the concession lead improved    m6 3.03x -> 4.99x, m12 2.10x -> 2.27x
    //   THE FAULT IT WAS AIMED AT DID NOT MOVE MUCH:
    //     face's share of the adjustment  m36 84.1% -> 78.7%, m60 99.9% -> 90.6%
    //     against a pre-registered <=35%, so this is not the fix for that.
    //   and asking fell FURTHER          m36 -16.7% -> -23.5%, m60 -13.9% -> -33.2%
    //
    // Kept anyway, because the mechanism is right on its own terms and the
    // balanced-market package is a separately measured fault it does close: a
    // landlord cannot un-give a concession, and this engine had him doing it
    // every month. The face-share fault has a different cause and needs a
    // different mechanism — `rentIdx` INTEGRATES pressure permanently while
    // this dial is bounded at 1, so once it saturates every further month of
    // distress goes into the headline by construction. Slowing the decay
    // cannot fix that, and the measurement above is the proof.
    const opening = concTarget > e.concIdx[k];
    const concWas = e.concIdx[k];
    e.concIdx[k] += (opening ? 0.25 : CONC_DECAY[k]) * (concTarget - e.concIdx[k]);
    // What this month's move in the package did to net effective rent, as a
    // log change: positive when concessions deepened (effective fell).
    const concCut = Math.log((1 - CONC_DEPTH * concWas) / (1 - CONC_DEPTH * e.concIdx[k]));
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
    // (that target predates `railSat`; the branch now tops out near 1.45%/yr
    //  for office — see the corrected paragraph above the vacTerm definition),
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
    // PINNED FLOOR ⇒ MUTE THE GAP. Direct vacancy cannot go below friction, so
    // once it rests on that rail the gap is a constant (~−7.8pp for office) and
    // a linear shortage term becomes a permanent monthly rent tax — the mirror
    // of the saturating-glut bug, and the named fault in ECONOMY.md §F #1.
    // Near the floor, saturation also bites: the last points of tightening
    // cannot pretend to add the same pressure as the first — a market that
    // cannot get any tighter stops minting a constant shortage tax.
    const friction = residenceVac(e, k);
    const vacNow = e.cityVac?.[k] ?? normalVac(e, k);
    const pinned = vacNow <= friction + 1e-6;
    // Room above the frictional rail — 0 on the pin, rising as the market has
    // somewhere left to tighten. Same saturation the vacTerm shortage branch
    // already uses; scarcity level must share it (below).
    const roomAboveFriction = Math.max(0, vacNow - friction);
    const railSat = roomAboveFriction / (roomAboveFriction + 0.025);
    // Within ~1.2pp of the rail, availability is practically saturated — the
    // same economics as pinned for asking escalators / stored press. Measured
    // after pin-only mute: "firm" months at vac∈(friction, friction+2pp) still
    // printed +4–5%/yr real and were the late-century hockey stick.
    const railBound = vacNow <= friction + 0.012;
    // SUPPLY SHUT ≠ SATURATED AVAILABILITY. Muting vacTerm on the pin is
    // right when the city can still break ground — frictional tightness, the
    // desk is open, asking should not mint a permanent shortage tax. It is
    // wrong when the pin is a supply failure: sitePencil has examined the
    // town and found ZERO lots that clear the same pro forma the crane will
    // be judged on, while jobs still want more floors than housable.
    //
    // Measured, seed 550991, years 7–30: office vacancy welded to 3.68%
    // every month, pipeline 0, startOwed 0, sitePencil.office 0, 1,230
    // office pro formas run at year 30 and the best hurdle was 0.86. Jobs
    // +37%, office stock −3% (teardowns converting the short class to
    // housing, the one use that still penciled). The Economy tape is a
    // ruler because nothing delivered.
    //
    // Asking has to walk toward the clearing hurdle or the mute is
    // load-bearing. The walk TURNS OFF the moment a site clears
    // (sitePencil > 0) — self-limiting, not a new rail. First-year
    // `undefined` is unconstrained (refresh has not run); that is not shut.
    const siteP = e.sitePencil?.[k];
    const supplyShut = pinned
      && (e.structTight?.[k] ?? 0) > 0.06
      && siteP !== undefined
      && siteP <= 0;
    // A SHORTAGE PRICES UNTIL IT ENDS (2026-10-08). The shortage branch was
    // muted to zero on the frictional floor and scaled by `railSat` (room
    // above it) near the floor, on the argument that a pinned gap is a
    // constant and so a "permanent rent tax". It is permanent only if nothing
    // answers it, and two things do: firms priced out of a dear floor
    // do not start or do not stay (their own books and shopping) and
    // builders build once the residual clears (`startCityJob`). Muted, the
    // engine ran a class on its vacancy floor in 55-67% of months over four
    // 50-year worlds with real asking up 0.2-2.5%/yr — no faster than a
    // balanced market — and with 10-25% of desired demand unhoused. The
    // coefficient is this block's own documented one (five points of
    // shortage ≈ 2.7%/yr, the header above), now applied wherever the
    // market is short, including on the floor. The income anchor below still
    // bounds the LEVEL against what tenants earn.
    void railSat; void supplyShut;
    // THE QUEUE IS NEGATIVE AVAILABILITY, AND IT BIDS (2026-10-09).
    //
    // Once direct vacancy reaches its frictional floor it cannot fall further,
    // and the excess demand went into `structTight` — tenants the city cannot
    // house — which reached rent only through a ten-year EMA (`scarcity`) and
    // a shortage slope of 0.045/mo per unit of gap, clamped at 0.45%/mo. That
    // is a queue, and a queue is quantity rationing: measured over 4 worlds x
    // 50 years, office sat on its floor 33-55% of months and flats 52-72%,
    // real rents rose only ~3%/yr while pinned, and the best vacant site in
    // the city could not pay for its building even on FREE land (office P97
    // 6-68% of the required yield). In a market the people in the queue are
    // bidders. Unhoused demand is exactly availability below zero, so it
    // joins the gap, and the rent moves until enough of it is priced out
    // (migration, starts, firms leaving) or until a building pencils.
    //
    // ONE SLOPE THROUGH ZERO. The glut side's linear term is 0.070/mo per
    // unit of gap (0.84%/yr of rent per point of vacancy), fitted to the
    // overbuilds in the notes above; the shortage side was 0.045 with a clamp,
    // so the curve had a kink at natural vacancy and a ceiling on one side.
    // Wheaton & Torto (1988) estimate the rent adjustment as symmetric and
    // linear in the vacancy deviation, so the shortage side takes the glut
    // side's linear slope and no ceiling of its own. The quadratic and the
    // capitulation hump stay where they were fitted: on gluts.
    const effGap = gap - (e.structTight?.[k] ?? 0);
    // ...AND HOW HARD A SHORTAGE BITES DEPENDS ON HOW OFTEN THE CLASS REPRICES
    // (2026-10-09). 0.070 is the office fit; with eight-year leases a tight
    // office market moves asking about 0.84%/yr per point of vacancy. Flats
    // reprice every twelve months under revenue management: apartment rent
    // growth runs about 2.5%/yr per point of occupancy around its neutral
    // level (RealPage / Axiometrics, 2010-2023), ~3x office. Sheds sat
    // 3-4 points under natural through 2015-22 with real rent growth of
    // 5-10%/yr (CBRE / Cushman), ~2%/yr per point, ~2.4x. Measured before
    // this, flats sat on their vacancy floor 75-83% of months with real rent
    // rising only ~0.7%/yr — the office slope applied to a market that
    // reprices every year. Shortage side only: on the soft side apartment and
    // shed landlords answer with concessions first, which `effRentIdx`
    // already carries, and the glut curve is fitted on the record as it is.
    const vacTerm = effGap <= 0
      ? -effGap * 0.070 * SHORT_SENS[k]
      : -(effGap <= FIT_MAX
        ? glut(effGap)
        // C1-continuous at FIT_MAX: same value, same slope, asymptote DEEP_RATE.
        : atFit + span * (1 - Math.exp(-SLOPE_AT_FIT * (effGap - FIT_MAX) / span)))
        * capitulation(e.vacOverM[k] ?? 0);
    // Scarcity from CAPACITY shortage (jobs/floors), not the absorption queue.
    if (!e.structTightPrev) {
      e.structTightPrev = { office: 0, retail: 0, multifamily: 0, industrial: 0 };
    }
    const st = e.structTight?.[k] ?? 0;
    const stPrev = e.structTightPrev[k] ?? st;
    const dSt = st - stPrev;
    e.structTightPrev[k] = st;
    // Level scarcity scales with room above friction (`railSat`). On the pin,
    // sat=0 → mostly flow plus a thin city-class level tax. Near the pin, sat
    // is small → mostly flow. Far from the rail (still tight vs natural),
    // full level rations. Paying full `st×0.045` in the last points above the
    // floor was the firm-near-rail hockey stick: +5%/yr real at 4–5% vac.
    //
    // SECONDARY FABRIC GETS A THINNER ON-RAIL LEVEL TAX. The same 0.010 on
    // every map let mid-rung procedural towns spend half a century on the rail
    // and graduate into primary real $/sf. Dense cities still ration at the
    // full rate; Landing/Village ration enough to clear without minting Midtown.
    const classF = cityClassFactor(e.cityIntensity ?? e.cityIntensity0 ?? 1);
    const onRailLevel = 0.0035 + 0.0065 * classF;
    // (The capped `scarcity` term computed here was dead — read by nothing
    // since the queue moved into `effGap` — and showed up in the rails audit
    // as a bound on rent growth that bound nothing. Removed 2026-10-13.)
    void dSt; void onRailLevel; void pinned;

    // Lease-quote lag: market pressure (vacancy gap + unmet demand) forms this
    // month; landlords adjust asking rents only after it has sat on the quote
    // sheet. Not the rejected observation lag above — that delayed the INPUT;
    // this delays the OUTPUT into rentIdx.
    if (!e.rentPress) e.rentPress = { office: 0, retail: 0, multifamily: 0, industrial: 0 };
    const RENT_PRESS_TAU: Record<BuiltClass, number> = {
      office: 8, retail: 6, multifamily: 5, industrial: 10,
    };
    // `scarcity` (the on-rail level tax and the flow of new tightness) priced
    // the same queue a second time; the queue is in `effGap` now.
    // ...AND THE GAP TO EQUILIBRIUM RENT (2026-10-11). The rent adjustment
    // literature this block cites has TWO terms, and only the first was here:
    //
    //   d ln r = a (v* - v) + b (ln r* - ln r)
    //
    // the vacancy gap and the gap between rent and the equilibrium rent r* —
    // the rent at which new space is supplied (Hendershott 1996; Hendershott,
    // MacGregor & Tse 2002, who estimate b at roughly 0.15-0.30 a year on
    // office markets; 0.20 is the middle of that range, a shape parameter
    // taken from it, not fitted here). Without it, a class sitting on its
    // vacancy floor priced its full ten-point shortage every month for as long
    // as the boom lasted: measured on map 2002, real office rent rose 8-9% a
    // year for eight years and ended 1.6-1.8x the rent at which the city's
    // best sites already penciled, while 12-14% of the stock was in the ground.
    // Everybody in the market can see that pipeline and that pencil; the rent
    // a tenant will sign for ten years stops running away from the price at
    // which the building next door is coming. The reverse holds too, with the
    // ONE-SIDED, BECAUSE STOCK IS DURABLE. The supply price is a ceiling, not
    // a floor: rent above it brings cranes, rent below it brings nothing,
    // because buildings already standing do not disappear when their rent
    // falls under what it would cost to build them again — which is the
    // normal state of most of the stock in most of a century (Glaeser &
    // Gyourko 2005; the kinked supply curve of DiPasquale & Wheaton). Pulled
    // both ways, measured over five towns, the term lifted rents ~14% a year
    // in markets where nothing penciled, priced tenants and firms out, and
    // three towns of five shrank to 21-25k people. Below the supply price
    // rent answers vacancy alone.
    //
    // r* is read off `siteHurdle` — how far rent stands from the level at
    // which the best sites the city examines clear (1/hurdle) — so it carries
    // the cost of building, of money and of land, and it is absent (no pull)
    // for a use no vacant site permits.
    const siteHk = e.siteHurdle?.[k];
    const eqGap = siteHk !== undefined && siteHk > 1 ? -Math.log(siteHk) : 0;   // ln(r*/r), only when r > r*
    const RENT_EQ_PULL = 0.20 / 12;
    // ...WEIGHTED BY HOW MUCH OF THE LEASE THE NEXT BUILDING CAN REACH
    // (2026-10-17). The pull toward the supply price is the tenant pricing in
    // the building that is coming: a lease prices the rent it expects over its
    // term, and a building not yet started arrives a planning period plus a
    // build away (SUPPLY_LAG_M). Of an eight-year office lease most of the term
    // lies after that, so most of the pull applies; a one-year apartment lease
    // ends before any crane now unstarted can deliver, so its rent is today's
    // scarcity and nothing else. Applied at full weight to flats it held their
    // rents at the cost of building through 80 years of shortage — vacancy
    // pinned at the between-tenants floor while builders ran flat out at
    // twice the supply price (measured, metro Frontier, seed 655720).
    const leaseReach = Math.max(0, (LEASE_TERM_M[k] - SUPPLY_LAG_M[k]) / LEASE_TERM_M[k]);
    const instant = vacTerm + RENT_EQ_PULL * eqGap * leaseReach;
    const tau = RENT_PRESS_TAU[k];
    e.rentPress[k] += (instant - e.rentPress[k]) / tau;
    const pressEma = e.rentPress[k];
    // Near/on the frictional rail, bleed stored POSITIVE shortage pressure so
    // the lag EMA cannot keep paying real rent after availability has
    // saturated. Soft-side (negative) press is left to the ordinary tau chase
    // so gluts still clear through the quote sheet.
    // Bleed stored shortage press on a saturated rail — unless the rail is
    // a supply failure. Bleeding then is how asking never reaches the
    // hurdle that would reopen the desk (550991: 23 years, pencil 0).
    //
    // RETIRED (2026-10-08). Draining a shortage out of the quote sheet while
    // the shortage is still there is the reason a class sat on its vacancy
    // floor for decades with asking rents flat in real terms: measured over
    // four 50-year worlds, real asking growth on the pin was 0-1%/yr for
    // office, retail and flats, no faster than in a balanced market, while
    // soft markets fell 1-6%/yr. A landlord with no vacancy and a queue at
    // the door does not mark his quote DOWN. The bleed was added because a
    // rising pin rent compounded when supply never came; supply now answers
    // (startCityJob builds the scheme that pencils), and the level is held
    // by the income anchor below and by tenants economising on dear space
    // (their own choices), which is where a shortage really stops.
    // Hard rail on the EMA itself — see the press clamp at the drift line.
    // A GUARD, NOT THE ADJUSTMENT SPEED (2026-10-09). This was -0.8%/+0.75% a
    // month — the speed limit on how fast a market may reprice, and with the
    // queue joining the gap it would have been the number doing the work.
    // At 3%/mo either way it is a statement that no asking sheet moves 40% in
    // a year, which none has.
    // (The 3%-a-month guard on the press is gone, 2026-10-16: it bound in no
    // month of 3 towns x 60 years.)

    // THE INCOME ANCHOR AND ITS EARNED PREMIUM — RETIRED (2026-10-09).
    //
    // A rent-to-income ratio, measured against the town's opening print and
    // an "earned" premium built from a ten-year memory of shortage
    // (`scarcity`, up to +60%), pulled asking down up to 3.6%/mo when rent
    // outran it and up toward a 0.65 floor on the rail. It held the LEVEL of
    // rent by rule. The level is now held by what holds it in life: tenants
    // shop elsewhere, start less and fail more (their own books), households leave a town whose
    // rent eats its real pay (migration, with rent inside the price level),
    // firms hire elsewhere (`wageDemand`), and builders build once rent
    // clears replacement cost. See `anchor` below for the measurement.
    //
    // Soft weight fades asking's CPI/cycle lift over the first ~3pp of surplus
    // availability (ECONOMY.md soft-market escalator).
    const softW = clamp(gap / 0.03, 0, 1);   // 0 at natural, 1 by +3pp soft
    const firmW = 1 - softW;
    // Cheap-side pull is weak off-rail (supply is what clears a glut of cheap
    // space). Near/on the rail, do NOT pull all the way to earned sustain —
    // that reminted pin-month real growth once scarcity was muted. Pull only
    // toward a floor RTI, hard enough to track wages (partial CPI alone
    // cannot hold a ratio against ~1.4%/yr real pay), then stop once there.
    // RETIRED (2026-10-09): the income anchor as a force on the price. It
    // pulled rent down up to 3.6%/mo whenever rent-to-income outran an
    // "earned" ratio, and pushed it up toward a 0.65 floor on the rail — a
    // second price rule on top of a demand side that already prices the same
    // thing: firms shop cheaper floors, start less and fail more, households leave
    // a town whose rent eats its pay (the real-wage premium in migration, now
    // that rent is in the price level), firms hire elsewhere (`wageDemand`),
    // and builders build into a rent that clears replacement cost. A level
    // held by those is discovered; a level held by this was asserted. Measured
    // before removal (counterfactual X1, 4 worlds x 50 years): taking away its
    // downward pull moved nothing, because the shortage slope was so slow that
    // rent never reached it — once the queue bids, it would have been the
    // ceiling. (The earned-ratio memory `scarcity`, its `sustain`, the 0.65
    // floor and the deviation they produced are gone with it.)
    const anchor = 0;

    // AND RENT CARRIES THE PRICE LEVEL — BUT ONLY WHEN THE MARKET IS FIRM.
    //
    // Every other term above is REAL — a sentiment, a vacancy, a job — and
    // none of them knows what a dollar is worth. The moment the price level
    // became a national object, rent had to carry CPI explicitly or it
    // outran wages by a point a year for fifty years. That escalation stays.
    //
    // What it must NOT do is escalate ASKING while availability is soft
    // (ECONOMY.md §F remainder / soft-market escalator). In-place leases
    // already step in leasing.ts; putting inflExp into the asking index on
    // a soft sheet is a fake escalator — capitulation dies after ~24 months,
    // press→0, and asking then compounds at ~CPI forever with empty floors
    // still on the shelf. Real CRE asking sits flat-to-down in a soft market;
    // CPI keeps rising, so REAL rents fall until space clears.
    //
    // Exception: when rent is already far below earned pay (dev deeply
    // negative), keep a partial CPI carry even while soft. Full soft-mute
    // plus the vacTerm hump dying produced a rent-to-income death spiral on
    // some seeds (~0.2x RTI) — asking cannot forget the price level entirely
    // once it has already under-shot wages by that much.
    // RAIL-BOUND ESCALATOR. Soft markets already refuse full CPI in asking.
    // On/near the frictional rail, firmW=1 (gap≤0) used to keep full inflExp
    // forever on practically saturated availability. In-place leases keep
    // escalating in leasing.ts; the asking index carries only a lease-roll
    // fraction of CPI — more if rent is already cheap against pay.
    // On the rail at/above the RTI floor: lease-roll fraction of CPI only.
    // Below the floor: track the price level (and a bit more) so the floor is
    // reachable against rising wages; once restored, the mute returns.
    // RETIRED (2026-10-08): the rail escalator. Asking carried 35% of CPI on
    // or near the frictional floor, which made a tight market the one place
    // where a dollar's falling value was NOT passed on — real asking fell in
    // a shortage. A firm market passes on the price level in full (it is the
    // soft market that cannot, and `softW` above already says so). The level
    // risk this guarded against is the income anchor's job.
    const railEscal = 1;
    // RETIRED (2026-10-09): the cheap-rent carry (`cheapFloor`, up to 75% of
    // CPI on a soft sheet whenever rent sat under the income anchor's
    // parity). It was the soft-market escalator this block calls fake,
    // re-admitted through an exception, and it was load-bearing (at its 0.75
    // ceiling in 75% of calls): nominal effective rent ROSE in 61-76% of
    // office and industrial months with availability five points over
    // natural. The anchor it served is gone; a glut now holds asking flat
    // or cuts it while CPI runs, which is how real rents fall, and the
    // glut clears through cheap space being taken up (firms choosing it) and
    // through supply leaving — not through a floor under the quote.
    // ONE GAP, ONE TERM (2026-10-15). This was `firmW * railEscal`: a market
    // one point over natural passed on two-thirds of inflation, three points
    // over none — and the same gap was already cutting rent through `vacTerm`.
    // The gap priced twice. Measured: a town sitting 1-2 points soft (no glut
    // at all) lost 2.5%/yr of real office rent for seventeen years, and a
    // long glut kept bleeding the full rate of inflation every year after
    // `capitulation` had finished repricing it (real effective -76% and
    // still falling at year 16). The rent adjustment literature has REAL
    // rent answer the vacancy gap (Wheaton & Torto 1988; Hendershott 1996):
    // nominal = inflation + the gap term. So asking carries the price level
    // and `vacTerm` alone decides whether the real rent falls — in a glut it
    // falls hard and then sits at the bottom until the space is taken up,
    // which is the shape of Houston 1983-90 and Manhattan 1990-96.
    void firmW;
    const escalGate = railEscal;
    // THE PRICE LEVEL THE RENT IS PAID IN, AS IT WAS (2026-10-08). This read
    // EXPECTED inflation, which the central bank anchors near 2%, while the
    // city's own price level ran 0.3-0.8 points a year faster (measured over
    // four 50-year worlds: realised CPI 1.9-3.8%/yr against expectations of
    // 1.6-2.4%). So even a firm market's asking lost ground to its own
    // currency every year, rent-to-income fell to 0.4-0.9 of the opening, and
    // new space at an average address stayed at replacement cost for decades.
    // A lease's CPI clause reads the published index for the trailing year,
    // and a landlord re-marking an asking sheet reads the same number; so
    // does this. The soft-market gate is unchanged: empty floors still do not
    // escalate.
    // Prices LESS SHELTER (see the CPI block): `priceLevel12`.
    const realised12 = priceLevel12(e);
    const escalation = (realised12 / 12) * escalGate;
    // Cap the lagged pressure term: chronic shortage was holding ~+1.6%/mo of
    // scarcity in rentPress and overpowering the income anchor for a decade.
    // THE CURVE IS A NET EFFECTIVE CURVE, SO ASKING CARRIES ONLY THE REST
    // (2026-10-11). Every anchor the glut curve was fitted to is a decline in
    // EFFECTIVE rent — Manhattan 1990-92 35-40% real, Houston 1983-87 50-55%
    // real — and it was applied to the ASKING index, with the concession dial
    // then cutting effective by up to another 30% on top. The same fall was
    // taken twice. Measured over five 100-year towns: real office asking fell
    // 70% peak to trough and effective 79% (map 2002), worse than Houston in
    // the typical run, and the face rate carried 80-90% of every adjustment
    // where the record has it carrying a fifth (Manhattan four years on:
    // asking -3.3%, net effective -17.3%). So the package moves first, as it
    // does in life, and the face rate takes only what the package has not
    // already delivered — never moving against the market: a deepening package
    // does not lift asking in a glut, and a package burning off in a recovery
    // does not cut it.
    const press = e.rentPress[k] < 0
      ? Math.min(0, e.rentPress[k] + concCut)
      : Math.max(0, e.rentPress[k] + concCut);
    const clampBound = pressEma <= -0.03 + 1e-12;
    // Phase / job / sector sentiment must not LIFT asking while soft, on/near
    // the frictional rail, or once rent is already near earned pay. Soft:
    // empty floors on the shelf. Rail-bound: availability is saturated (same
    // reason tightEma refuses to mint Manhattan from "can't build"). Near
    // parity: further weather lift is what made every sim compound ~1.4%+
    // real on top of CPI — cycle may help a CHEAP market recover, not keep
    // marking up a clearing one. Growing unmet demand still prices through
    // scarcity → rentPress. Negative cycle terms still cut in every state.
    // (The "near parity" clause read the retired income anchor's parity.)
    const liftGate = (railBound || softW > 0) ? 0 : 1;
    // The label's own rent drift (+0.37%/mo in an "expansion", -0.47% in a
    // "recession") is gone: the jobs behind the label are already in
    // `cycleJobs`, and the vacancy they leave behind in `vacTerm`.
    const cycleRent = 0;
    // RENT MOVES ON THE BALANCE OF SPACE, NOT ON THE NEWS (2026-10-09). Job
    // growth (x0.28) and the class's demand momentum (x0.42) were added to
    // the rent directly, on top of the vacancy and queue they produce — the
    // same demand priced twice — and gated one way: a positive lift only in
    // a firm market off its floor, a negative one always, which is a
    // downward bias over any cycle. The rent adjustment literature (Wheaton &
    // Torto 1988; Hendershott 1996) has rent answer the vacancy gap and the
    // gap to equilibrium rent, not employment directly; demand reaches rent
    // here the same way, through absorption, the queue and `effGap`.
    void liftGate;
    const cycleJobs = 0;
    const cycleMom = 0;
    const drift = cycleRent + cycleMom + press + anchor + cycleJobs + escalation;
    // THE HALF-OF-BASE FLOOR IS NOW A GUARD AGAIN, WHICH IS ALL IT WAS EVER
    // MEANT TO BE. It used to be load-bearing and it used to be the reason the
    // amplitude above looked survivable: removing it took office peak-to-trough
    // from 12.5x to 94x, and it bound 9.5% of all months with 16 of 17 careers
    // touching it — a rail holding up the model. Measured after the sublet
    // channel: it binds 0.0% of months in every class over 6 seeds x 50 years,
    // and deleting it entirely reproduces every statistic in this file to the
    // digit. Left in place because a guard that never fires is a guard.
    const noise = rrange(s, -vol, vol);
    const beforeRent = e.rentIdx[k];
    // (The floor at half the base rent is gone, 2026-10-16: measured over
    // 3 towns x 60 years it bound in no month.)
    e.rentIdx[k] = e.rentIdx[k] * (1 + drift + noise);
    if (!e.rentPath) e.rentPath = {} as NonNullable<Econ["rentPath"]>;
    e.rentPath[k] = {
      gap, vacTerm, instant, pressEma, pressClamped: press, clampBound,
      escalation, anchor, drift,
      nomCh: beforeRent > 0 ? e.rentIdx[k] / beforeRent - 1 : 0,
    };
    e.effRentIdx[k] = +(e.rentIdx[k] * (1 - CONC_DEPTH * e.concIdx[k])).toFixed(4);
    // EXPLAIN THE MOVE. Defaults, tenant exits and district shifts already
    // write a cause. Asking rent did not — the Economy page showed a chart
    // with no sentence tying the month's move to vacancy, incomes or jobs.
    const pctMove = beforeRent > 0 ? (e.rentIdx[k] - beforeRent) / beforeRent : 0;
    if (Math.abs(pctMove) >= 0.006) {
      const supply = e.supplyPress?.[k] ?? 0;
      const candidates: { w: number; why: string }[] = [
        { w: Math.abs(press), why: press < 0 ? "vacancy and soft absorption" : "tight space and unmet demand" },
        { w: Math.abs(anchor), why: anchor < 0 ? "rents outrunning local incomes" : "rents cheap against local pay" },
        { w: Math.abs(cycleJobs), why: cycleJobs < 0 ? "employment slipping in the tenant base" : "employment supporting tenant demand" },
        { w: Math.abs(supply) * 0.5, why: supply > 0.004 ? "new deliveries pressing the market" : "a thin delivery calendar" },
      ];
      candidates.sort((a, b) => b.w - a.w);
      const dir = pctMove < 0 ? "fell" : "rose";
      const line = `${SECTOR_LABEL[k]} asking rents ${dir} this month — ${candidates[0].why}.`;
      e.rentWhy = { ...(e.rentWhy ?? {}), [k]: line };
      // Sparse news: material moves, or a coin that does not touch the RNG stream.
      if (Math.abs(pctMove) >= 0.012 || (ownsClass(s, k) && newsChance(s, `rentwhy:${k}`, 0.22))) {
        s.news.unshift({ q: s.month, kind: pctMove < 0 ? "warn" : "info", text: line });
      }
    }
  }

  // CAP RATES ARE WHAT THE DEALS SAY (ONE_ECONOMY_PLAN.md step 7). The class
  // equation that lived here — a base, a pass-through of the loan index, the
  // cycle, a crunch term, a vacancy beta, money chasing last year's winner —
  // is gone (FORMULA_LEDGER.md, Removed). Named bidders underwrite buildings
  // on their own capital (propmarket.ts); the read is the median of what
  // closed. What is kept here is what the bidders READ: each class's real
  // rent growth as they have watched it.
  {
    const h12 = e.history.length >= 12 ? e.history[e.history.length - 12] : undefined;
    if (!e.growthExp) e.growthExp = { office: 0, retail: 0, multifamily: 0, industrial: 0 };
    for (const k of BUILT_CLASSES) {
      const then = h12?.rent?.[k];
      const realG12 = then && then > 0 && h12?.cpi
        ? (e.rentIdx[k] / then) / ((e.cpi ?? 1) / h12.cpi) - 1 : 0;
      // A TEN-YEAR memory: a cap capitalises LONG-run growth, and survey
      // expectations of it move slowly (Clayton, Ling & Naranjo 2009).
      e.growthExp[k] += (1 / 120) * (clamp(realG12, -0.15, 0.15) - e.growthExp[k]);
      // The econ stream drew a month of cap-rate noise per class here. The
      // draw stays so the national path does not re-roll (HANDOFF §4); its
      // value is no longer read by anything.
      void rrange(s, -0.045, 0.045);
    }
  }
  tickCapRead(s);
  for (const k of BUILT_CLASSES) {
    // THE EXIT CAP A DEVELOPER UNDERWRITES, which is not this month's. Land is
    // bought against a sale three or four years out, so the yield that prices
    // it is a through-cycle memory of the read (see `residualLandPsf`).
    if (!e.capExp) e.capExp = { ...e.capRate };
    e.capExp[k] += 0.021 * (e.capRate[k] - e.capExp[k]);
  }

  // THE LAND TEXTURE LEVEL IS WHAT LOTS SELL FOR (FORMULA_LEDGER #24). It
  // was set here: rent over construction cost to the 1.15, the cycle, a
  // vacancy discount and a bidders' term, closed 4% a month. Now builders bid
  // their own residuals and land bankers the option (propmarket.ts), and the
  // level is read off the lots that sold or were bid on. The month's draw is
  // kept so the national path does not re-roll (HANDOFF §4).
  void rrange(s, -0.003, 0.003);
  tickLandRead(s);

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
    // A DEEPER LULL (2026-10-14). The idle floor (-1.9 here, -4.8%/yr real)
    // was shallower than the record: the Turner Building Cost Index fell ~7%
    // nominal in 2009 (~9% real) and again in 2010, contractors' bids came in
    // 10-15% lower through 2009-11 as builders cut margin to keep crews, and
    // construction costs fell about a quarter over 1929-33. At -4 the deepest
    // lull runs ~-10%/yr real before wages; the busy ceiling is unchanged.
    //
    // A MARGIN, NOT A DRIFT (2026-10-14). `heat` was a monthly RATE of change
    // clamped to -1.9..+3.1, so the deepest lull could only ever shave ~5%/yr
    // off real cost, a boom could only add ~8%/yr, and a long lull compounded
    // into a permanently cheaper industry. A contractor's bid is inputs plus a
    // margin, and the margin is a LEVEL set by the order book: bids came in
    // 10-15% under cost through 2009-11 (and fell about a quarter over
    // 1929-33) and ran 15-30% over it in 2021-22. So cost = inputs x (1 +
    // premium), the premium chases 0.35 per unit of excess utilisation with no
    // bound, and it gets there within about a year — bids reprice on every
    // tender. A deep lull is a quick 10-20% drop; firms bidding under cost go
    // under (`tickCrews`), and the order book comes back to a smaller trade.
    // (2026-10-29) The premium below was an equation of `crewUtil`; it is now
    // the named contractors' winning bids (contractors.ts), each priced off
    // the bidder's own book with the same slope.
    // ONE SLOPE (2026-10-09). This was 0.0026 below full employment and 0.0016
    // above, each set so its own extreme hit an ENR figure. Two gains on one
    // signal make the MEAN of an oscillating utilisation a drift: a market
    // that is as often 10% idle as 10% booked lost real cost every year for
    // that reason alone. The midpoint keeps the extremes in the record's range
    // (-4.8%/yr real at the idle floor, +7.8%/yr at the ceiling — 2009-10 and
    // 2021-22) and puts zero drift where utilisation averages one.
    // WHAT A BUILDING COSTS IS WHAT ITS INPUTS COST (2026-10-08). The base
    // drift was EXPECTED inflation, which sits near its 2% anchor while
    // realised CPI ran 1.9-3.8%/yr across four 50-year worlds, and it gave
    // the trades none of the city's real wage growth. On-site labour is
    // roughly 45% of hard cost (RSMeans / BLS construction cost shares) and
    // is paid what the town's wages pay; the rest is materials, equipment and
    // overhead, which move with the price level. With only `inflExp` the real
    // index slid 0.5-0.7%/yr whenever the trades were not fully booked, and
    // the office-rent catch-up below had been propping it up. Realised
    // inputs, not a target: a wage boom makes building dearer, a deflation
    // cheaper. `bidPremium` stays the premium for how busy the trades are.
    const LABOUR_SHARE = 0.45;
    // Materials are traded goods: they cost what they cost nationally
    // (2026-10-09; this read the local CPI, which now carries local rent, so a
    // housing shortage would have raised the price of steel).
    const cpiNow = Math.max(0.35, e.natCpi ?? e.cpi ?? 1), wageNow = Math.max(0.1, e.wageIdx ?? 1);
    // ...AND OIL (2026-10-29): diesel, asphalt, resin and the energy in steel
    // and cement. Construction materials' real price moves about 0.15 per log
    // point of real oil — 1974: materials +30% against CPI +11% with real
    // crude up about 1.1 log points (BLS PPI; EIA) [D]. This is what an
    // embargo does to building costs now, through the oil price, rather than
    // a jump the swan wrote into the index.
    const matNow = cpiNow * Math.exp(MATERIALS_OIL * (e.oilLn ?? 0));
    const prevIn = e.costInputsPrev;
    // ...LESS WHAT THE TRADES LEARN (2026-10-14). Pay rises with the town's
    // productivity; a site crew's output rises far more slowly — the Baumol
    // problem, and the reason real construction cost rose 27-35% over sixty
    // years here and apartment rent (which tracks replacement cost) with it.
    // Construction labour productivity grew ~1-2%/yr in the first half of the
    // last century and has been flat-to-falling in the US since about 1970
    // (Goolsbee & Syverson 2023); 0.7%/yr is a mid-century reading of that
    // range, applied to the labour share only.
    const TRADES_PRODUCTIVITY = 0.007;
    const inputGrowth = prevIn
      ? (1 - LABOUR_SHARE) * (matNow / (prevIn.mat ?? prevIn.cpi) - 1) + LABOUR_SHARE * ((wageNow / prevIn.wage - 1) - TRADES_PRODUCTIVITY / 12)
      : (e.inflExp ?? 0.02) / 12;
    e.costInputsPrev = { cpi: cpiNow, wage: wageNow, mat: matNow };
    // The recession term (-0.0004/mo whenever the label read recession) is
    // gone: an idle trade is already in `bidPremium`, and a label is not a cost.
    const costDrift = inputGrowth;
    // RETIRED (2026-10-08): the office-rent catch-up. This pulled the cost
    // index toward the OFFICE asking level whenever rents ran a quarter ahead
    // of it, for every class — flats and sheds priced their concrete off
    // office quotes. Nothing in the world does that: a contractor's bid is
    // materials, labour and how busy the trades are, which is `costDrift`
    // above (inflation plus `bidPremium`, the share of the city under
    // construction). Measured over four 50-year worlds it fired in 22-63% of
    // months, and it fired exactly when a shortage lifted rents — so the
    // margin a shortage should open for builders was handed to the cost
    // index instead, the residual stayed flat, and the class stayed on its
    // vacancy floor. When rents outrun cost now, the residual rises, land
    // pencils, cranes go up, and THEN the trades get dear through `bidPremium`.
    const catchUp = 0;
    // RETIRED (2026-10-09): the "fair real cost" path. Real cost was pulled
    // toward an asserted 1.004^years whenever it strayed 20-25% off it — a
    // number written down rather than discovered, and load-bearing: its floor
    // push was active in 41-89% of all months over 8 cities x 50 years,
    // propping up a cost index that the maintenance-load bug in `tickCrews`
    // was dragging down. Cost is now its inputs (CPI and wages, at the labour
    // share) plus how booked the trades are, and nothing else.
    const realPull = 0;
    // The guards are in this town's dollars (`priceLevel`, drawn at the
    // opening): an absolute 0.6 floor lifted a cheap town's construction to
    // twice its own price level on the first tick (2026-10-12).
    // The 0.6x-400x guards on `costIdx` are gone with the drift form: inputs
    // follow prices and wages, and the margin follows the order book.
    // THE NAMED CONTRACTORS BID (contractors.ts). Every job that broke ground
    // goes to tender, each contractor prices it off its own book, and the
    // index is the average winning bid's markup over direct cost. A new game
    // (or a save from before them) opens at the index it already had: the
    // input index is struck so that cost does not move on the day they arrive.
    const opening = !e.gcs;
    const wasMarkup = e.bidPremium;
    if (e.costInputIdx !== undefined) {
      e.costInputIdx = e.costInputIdx * Math.max(0.5, 1 + costDrift + catchUp + realPull + rrange(s, -0.0012, 0.0012));
    } else rrange(s, -0.0012, 0.0012);
    const markupNow = tickContractors(s);
    if (opening) {
      if (e.costInputIdx === undefined || wasMarkup === undefined) e.costInputIdx = e.costIdx / (1 + markupNow);
      else e.gcs!.idx = wasMarkup;
      delete e.bidPremium;
    }
    // A bid can be under cost, never under nothing.
    e.costIdx = e.costInputIdx! * Math.max(0.2, 1 + e.gcs!.idx);
    e.costShock = 0;
  }

  recordHistory(e, s.month, monthAbs, monthComp);
  // What moved on the screens this month, and why (whyReads.ts): ledger writes only.
  noteReads(s);

  // THE VACANCY TELL — said out loud by a broker.
  //
  // Measured across century windows: when office vacancy is ≥2pp higher than a
  // year ago, real rents were lower three years later ~93% of the time. It is
  // confirmation (median ~17 months past the real-rent peak), not prophecy —
  // and it was invisible. Put it on the paper once per soft episode.
  {
    const hist = e.history ?? [];
    if (hist.length > 12) {
      const now = e.cityVac?.office ?? 0;
      const then = hist[hist.length - 13]?.vac?.office ?? now;
      const dpp = (now - then) * 100;
      const cool = s.month - (e.vacTellM ?? -999) >= 24;
      if (dpp >= 2 && cool) {
        e.vacTellM = s.month;
        pushNews(s, "rumor",
          `Office vacancy is ${dpp.toFixed(1)} points higher than a year ago. `
          + `Historically, real rents are lower three years out; `
          + `about a third of the decline is typically still ahead.`);
      }
    }
  }
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
  if (!e.darkSf) e.darkSf = { office: 0, retail: 0, multifamily: 0, industrial: 0 };
  if (sf > 0) e.darkSf[k] = (e.darkSf[k] ?? 0) + sf;
  else if (sf < 0) {
    const dark = e.darkSf[k] ?? 0;
    const fromDark = Math.min(dark, -sf);
    e.darkSf[k] = dark - fromDark;
  }
}

/**
 * How hard the citywide space market pushes prospects at YOUR door for a
 * given class. Tight market: everyone else is full, so the tenant that would
 * rather be elsewhere ends up touring your building. Glutted market: three
 * other landlords with empty floors return every call first.
 */
export function vacancyPull(e: Econ, use: BuiltClass): number {
  const vac = e.cityVac?.[use] ?? normalVac(e, use);
  return Math.max(0.4, Math.min(1.7, Math.pow(normalVac(e, use) / Math.max(0.005, vac), 0.9)));
}

function recordHistory(e: Econ, q: number, abs?: Record<string, number>, comp?: Record<string, number>) {
  e.history.push({
    q,
    indexRate: +e.indexRate.toFixed(2),
    ...(e.nat?.policy !== undefined ? { policy: +e.nat.policy.toFixed(2) } : {}),
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
    natUnemp: e.nat?.unemp !== undefined ? +e.nat.unemp.toFixed(4) : undefined,
    wageIdx: e.wageIdx !== undefined ? +e.wageIdx.toFixed(4) : undefined,
    natWageIdx: e.natWageIdx !== undefined ? +e.natWageIdx.toFixed(4) : undefined,
    natCpi: e.natCpi !== undefined ? +e.natCpi.toFixed(4) : undefined,
    cpiXS: e.cpiXS !== undefined ? +e.cpiXS.toFixed(4) : undefined,
    outputIdx: e.outputIdx,
    cpi: e.cpi !== undefined ? +e.cpi.toFixed(4) : undefined,
    vac: e.cityVac ? {
      office: +e.cityVac.office.toFixed(4), retail: +e.cityVac.retail.toFixed(4),
      multifamily: +e.cityVac.multifamily.toFixed(4), industrial: +e.cityVac.industrial.toFixed(4),
    } : undefined,
    // Availability is what a broker quotes and what rent tightness reads —
    // direct vacancy plus sublet/stock. Direct `vac` sits on its frictional
    // floor for years in a shortage (the clamp is a statement about empty
    // landlord floors, not about space a tenant can take). The Economy tape
    // has to record the quantity that actually moves, or twenty years of a
    // tight office market prints as a ruler at 3.68%.
    avail: e.cityVac ? {
      office: +((e.cityVac.office ?? 0) + (e.sublet?.office ?? 0) / Math.max(1, e.stock?.office ?? 1)).toFixed(4),
      retail: +((e.cityVac.retail ?? 0) + (e.sublet?.retail ?? 0) / Math.max(1, e.stock?.retail ?? 1)).toFixed(4),
      multifamily: +((e.cityVac.multifamily ?? 0) + (e.sublet?.multifamily ?? 0) / Math.max(1, e.stock?.multifamily ?? 1)).toFixed(4),
      industrial: +((e.cityVac.industrial ?? 0) + (e.sublet?.industrial ?? 0) / Math.max(1, e.stock?.industrial ?? 1)).toFixed(4),
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
    // STOCKS, not the month's flow. The Economy page plots these against each
    // other — standing inventory vs space actually leased — over the whole
    // history. Completions and absorption stay on `comp`/`abs`.
    stock: e.stock ? {
      office: Math.round(e.stock.office ?? 0), retail: Math.round(e.stock.retail ?? 0),
      multifamily: Math.round(e.stock.multifamily ?? 0), industrial: Math.round(e.stock.industrial ?? 0),
    } : undefined,
    occupied: e.occupied ? {
      office: Math.round(e.occupied.office ?? 0), retail: Math.round(e.occupied.retail ?? 0),
      multifamily: Math.round(e.occupied.multifamily ?? 0), industrial: Math.round(e.occupied.industrial ?? 0),
    } : undefined,
  });
  if (e.history.length > 1260) e.history.shift();
}
