// The market: mean-reverting rate walk, rate-linked cap rates, cyclical
// rents, and a phase machine whose turns are rumored before they land.
// Randomness creates situations, never verdicts.
import type { ParcelTable } from "@/data/types";
import type { BuiltClass, Econ, GameState, MarketPhase, NewsItem, Sector } from "./types";
import { BUILT_CLASSES, SECTOR_CLASSES } from "./types";
import { simulateHistory, driftInflTarget, CAP_RAIL, shortIndexFor } from "./regime";
import { swanClassLevel, swanTradeWave, tickSwans, exposureToTrade } from "./swans";
import { settleSupplyDeliveries } from "./supply";

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
export type RngChannel = "econ" | "leasing" | "rivals" | "sales" | "dev" | "lenders" | "owners" | "indust" | "exit" | "land" | "nation";
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

export const RNG_CHANNELS: RngChannel[] = ["econ", "leasing", "rivals", "sales", "dev", "lenders", "owners", "indust"];

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
// Ordinary inventory used to run ~0.23% of stock at the median against 1–1.5%
// in a calm US office market, because give-back was only the AGGREGATE mismatch
// and emptied whenever the city wanted what it held. The extremes were right
// (dispersion shows up in busts); the ordinary level was not. Background
// marketed space below is the idiosyncratic floor — mergers, relocations,
// contractions in every kind of market — as a share of occupied. Direct
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

/**
 * IDIOSYNCRATIC MARKETED FLOOR — share of occupied that is on the sublet
 * market even when the city as a whole wants the footprint it holds.
 * Calibrated to ordinary US availability: office ~1.2% of stock ≈ ~1.3% of
 * occupied at natural vacancy; retail/industrial thinner; flats none.
 */
const SUBLET_BG: Record<BuiltClass, number> = {
  office: 0.013, industrial: 0.006, retail: 0.004, multifamily: 0,
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
// RETIRED (2026-10-08): MOM_DEMAND. The class cycle is in each class's
// demand driver now (tenant trades' employment, population), not a momentum
// multiplier on top of it.

/** WHAT PRICE IS ALLOWED TO DO TO THE SPACE ONE WORKER OCCUPIES. Affordability
 *  rations demand — dear space, firms take less of it — but it was unbounded,
 *  and unbounded it manufactured tenants out of cheapness: measured over three
 *  careers it reached 2.34 — the model asserting that cheap rent, by itself,
 *  more than doubles the space the city's existing headcount takes. Space per
 *  worker is set by headcount and by workplace design, not by rent. US office
 *  ran about 250 sf/worker in 1990 and about 190 in 2019 — a quarter, over
 *  THIRTY years.
 *
 *  ASYMMETRIC ON PURPOSE. Cheapness still cannot manufacture tenants: the
 *  upper rail stays at +12%. Dearness may compress toward that observed
 *  secular densification floor (190/250 ≈ 0.76) — a century of elevated
 *  rent-to-income with the old ±12% band left affordEff glued near 0.88 while
 *  a permanent unhousable search queue minted scarcity rent (see pool search
 *  fringe below). The lower rail is that densification floor, not a CAGR dial:
 *  firms can end up as dense as the historical record, and no denser from
 *  price alone.
 *
 *  Symmetric ±12% DID NOT DAMP THE CYCLE AND THAT IS RECORDED HERE. Removing
 *  the bound entirely measured office sd(log) 0.263 -> 0.235 — calmer because
 *  manufactured demand is a stabiliser built on a fiction. The cheap-side rail
 *  stays; only the dear side opens to the densification floor. */
const AFFORD_BAND: [number, number] = [0.76, 1.12];

/**
 * THE INCOME ELASTICITY OF DEMAND FOR SPACE — the argument this model did not have.
 *
 * `affordRaw` used to read ONE quantity, `burden = rent/wage`. Because rent and
 * income entered only as a ratio, the specification forced the INCOME elasticity
 * of space demand to equal the PRICE elasticity — a restriction the literature
 * rejects (office price elasticity is reported at -0.19..-0.24 against an income
 * elasticity near 0.67). And because they shared one expression, they shared one
 * clamp: AFFORD_BAND is an honest bound on the substitution response, and it was
 * silently bounding the income response too, which has no such bound. Measured
 * with tools/rails.mjs, that clamp sat at its CEILING in 70-95% of calls and at
 * its floor in 0.0% — a one-sided rail, pinned open, which is the fingerprint of
 * the mis-specification rather than a coincidence.
 *
 * What it cost, measured over 6 seeds x 100y: the city enters a mild permanent
 * glut around decade three (office vacancy parks ~4pp over natural and never
 * leaves), demand growth decays from 1.4%/yr to ~0.2%/yr, and real office rent
 * bleeds -0.2 to -2.1%/yr for seventy years. Feet per job is FLAT across the
 * whole run, so this is not densification — it is the one feedback that should
 * arrest a glut (space gets cheap relative to income, so firms take more of it)
 * being dead against a ceiling.
 *
 * These are SHAPE PARAMETERS, not industry constants, and the evidence behind
 * each is uneven — so each carries its own reasoning and its own doubt:
 *
 *  office 0.45 — the reported estimate is ~0.67 (Hendershott/MacGregor/Tse
 *    family, City of London). That figure is UNVERIFIED against the primary
 *    paper and rests on a single attribution, so it is a direction, not a point.
 *    It also measures total OCCUPANCY demand, and the modern record puts much of
 *    that on the QUALITY axis (prime rents ~84% over market average, up from
 *    ~60% pre-pandemic) — an axis this engine does not have, carrying one rent
 *    index per class. 0.45 is the quantity-only share of a 0.35-0.5 band.
 *  retail 0.00 — the cross-country record is flatly against an income effect
 *    here: retail floor space per capita is 23.5 sf in the US, 5.0 in France,
 *    4.6 in the UK, under 5 in Germany and Japan (ICSC 2018). That ordering is
 *    planning and land, not income.
 *  multifamily 0.25 — the housing literature's income elasticity is the best
 *    measured of any class (~0.7 short-run, ~1.0 long-run; Mulford, RAND
 *    R-2449-HUD 1979) and this number is deliberately far below it, because US
 *    floor space per HOUSEHOLD is roughly flat (~1,970 sf 1900 -> ~2,060 sf
 *    today) — the doubling of space per PERSON is household shrinkage, and this
 *    engine already carries that as the household-formation leg of the
 *    multifamily secular menu. 0.25 is what is left after refusing to count it
 *    twice, and it is the number here I trust least.
 *  industrial 0.40 — US warehouse floor space per capita grew ~1.0%/yr against
 *    real GDP per capita of ~1.5-1.6%/yr over the last three decades, implying
 *    ~0.6; discounted because logistics rent is under 5% of the cost to supply
 *    a good (Prologis: $1 rent per $5-7 labour per ~$10 transport), so space is
 *    not the margin a shipper optimises.
 *
 * IF THESE MOVE, THEY MOVE BECAUSE THE EVIDENCE MOVED. They must never be
 * turned until a harness passes: `pnpm income` reports the consequence, and a
 * consequence outside its band is a finding about the rest of the model.
 */
const INCOME_ELAST: Record<BuiltClass, number> = {
  office: 0.45, retail: 0.00, multifamily: 0.25, industrial: 0.40,
};

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
const INDUST_COMP_FLOOR = 0.50;

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
const RATE_FLOOR = 1.45, RATE_CEIL = 23.0;

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
import { devPencils, rentableSf } from "./value";
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

export const NATURAL_VAC = { office: 0.115, retail: 0.085, multifamily: 0.045, industrial: 0.07 } as const;

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
export function payrollGrowth12(e: Econ): number {
  const h = e.history ?? [];
  const then = h.length >= 12 ? h[h.length - 12]?.jobs : undefined;
  return then && e.jobs ? e.jobs / then - 1 : 0;
}
/** Local unemployment over the town's own natural rate (the matching steady state). */
export function labourSlack(e: Econ): number {
  return (e.unemployment ?? OPENING_UNEMP) - OPENING_UNEMP;
}
/** How far national unemployment has risen over the last year — the national credit signal. */
export function natUnempRise12(e: Econ): number {
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
/** A class's availability (vacancy + sublet) over its natural vacancy. */
export function useGap(e: Econ, k: BuiltClass): number {
  return (e.cityVac?.[k] ?? NATURAL_VAC[k]) + (e.sublet?.[k] ?? 0) / Math.max(1, e.stock?.[k] ?? CITY_STOCK[k]) - NATURAL_VAC[k];
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
export function frictionFloor(k: BuiltClass): number {
  const ratio = k === "industrial" ? 0.22 : k === "multifamily" ? 0.30 : 0.32;
  return NATURAL_VAC[k] * ratio;
}

/**
 * MONTHS A SUITE SITS BETWEEN TENANTS. Same clock the player's make-ready
 * uses in leasing.ts — a shop relets faster than a floor, a shed faster
 * than either. The city stock has to sit on this clock too, or frictional
 * vacancy is a clamp in one place and a residence time in the other.
 */
export function reletMonths(k: BuiltClass): number {
  return k === "office" ? 5.5 : k === "industrial" ? 2.5 : 3.5;
}

/** Ordinary commercial term. Sector exit and between-tenants both roll on it. */
export const LEASE_TERM_YR = 8;

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
 * Expected vacant sf from ordinary turnover × re-let latency. Not a floor
 * under vacancy — the months a moved-out suite is dark. Scales with the
 * occupied book, because only occupied space can roll.
 */
export function betweenTenantsSf(occupied: number, k: BuiltClass): number {
  return Math.max(0, occupied) * (1 / LEASE_TERM_YR / 12) * reletMonths(k);
}

/**
 * How empty the city is when every suite that can be let, is. Dark new
 * floor plus turnover still in re-let. The rent mute and tightEma used to
 * treat `frictionFloor` as that point; that number is now only a watcher.
 */
export function residenceVac(e: Econ, k: BuiltClass): number {
  const stk = Math.max(1, e.stock?.[k] ?? 0);
  return (darkSfOf(e, k) + betweenTenantsSf(e.occupied?.[k] ?? 0, k)) / stk;
}

/**
 * A CLASS THE CITY CANNOT HOUSE, on the same instruments densify already
 * reads. Vacancy on the frictional rail, or `structTight` saying desired
 * demand is already past housable. Used by the zoning map — a planning
 * board rezones land for a use that is short, not for one that is empty.
 */
export function classIsShort(e: Econ, k: BuiltClass, slack = 0.02): boolean {
  const vac = e.cityVac?.[k] ?? NATURAL_VAC[k];
  if (vac <= frictionFloor(k) + slack) return true;
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
  if (!Number.isFinite(deltaSf) || Math.abs(deltaSf) < 2_000) return;
  if (use === "multifamily") return; // flats are aggregate, not named suites
  const e = s.econ;
  if (!e.pool) e.pool = { office: 0, retail: 0, multifamily: 0, industrial: 0 };
  const stk = Math.max(1, e.stock?.[use] ?? 1);
  const housable = housableStock(e, use);
  const fringe = stk * (NATURAL_VAC[use] ?? 0.1) * 0.25;
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
export const BUILD_MONTHS = { office: [30, 44], retail: [18, 28], multifamily: [22, 34], industrial: [12, 20] } as const;
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
const SF_PER_JOB: Record<BuiltClass, number> = { office: 230, industrial: 550, retail: 420, multifamily: 0 };
/** Share of the population in the labour force. See the note at the unemployment term. */
const PARTICIPATION = 0.58;
/** The rate the city opens at, which is what makes the opening state consistent. */
const OPENING_UNEMP = 0.052;
/** The nation's natural rate — the Phillips curve's u* in tickNation, and the pivot for national pay. */
const NAT_U_STAR = 0.048;

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
    baseStock0: { ...CITY },
    occupied: {
      office: CITY.office * (1 - NATURAL_VAC.office),
      retail: CITY.retail * (1 - NATURAL_VAC.retail),
      multifamily: CITY.multifamily * (1 - NATURAL_VAC.multifamily),
      industrial: CITY.industrial * (1 - NATURAL_VAC.industrial),
    },
    cityVac: { ...NATURAL_VAC },
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
    office: econ.stock.office * (1 - NATURAL_VAC.office),
    retail: econ.stock.retail * (1 - NATURAL_VAC.retail),
    multifamily: econ.stock.multifamily * (1 - NATURAL_VAC.multifamily),
    industrial: econ.stock.industrial * (1 - NATURAL_VAC.industrial),
  };
  econ.affordEff = { office: 1, retail: 1, multifamily: 1, industrial: 1 };
  econ.incomeEff = { office: 1, retail: 1, multifamily: 1, industrial: 1 };
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
    simulateHistory(econ, s.seed, NATURAL_VAC as unknown as Record<string, number>);
    // The phase clock opens part-way through the phase the history ended in:
    // a recession runs as long as the nation's has left, anything else a
    // seeded share of its ordinary length. It used to open at ZERO, so the
    // opening phase was over by the first tick whatever it was.
    const n = econ.nat!;
    const [lo, hi] = PHASE_CFG[econ.phase].nextM;
    const u = mulberry32Step(((s.seed ^ 0x3c6ef372) >>> 0) || 1).value;
    econ.phaseMLeft = (econ.phase === "recession" || econ.phase === "depression") && (n.recM ?? 0) > 0
      ? Math.max(3, n.recM ?? 0)
      : Math.max(3, Math.round(u * (lo + (hi - lo) * 0.5)));
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
    const gap = (econ.cityVac[k] ?? NATURAL_VAC[k]) - NATURAL_VAC[k];
    econ.concIdx[k] = concessionTarget(gap, econ.phase);
    econ.effRentIdx[k] = +(econ.rentIdx[k] * (1 - CONC_DEPTH * econ.concIdx[k])).toFixed(4);
  }
  // Land tracks the rent that actually opened (era-adjusted), not the pre-era
  // density scale alone — same identity the monthly landIdx step chases.
  {
    const rentLevel = (econ.effRentIdx?.office ?? econ.rentIdx.office) / RENT_BASE.office;
    const costLevel = Math.max(0.35, econ.costIdx ?? 1);
    econ.landIdx = clamp(
      Math.pow(rentLevel / costLevel, 1.15),
      0.05, 80,
    );
  }
  // Era rewrote vacancy; occupied has to match or month-zero vacancy is a lie.
  for (const k of BUILT_CLASSES) {
    const vac = econ.cityVac[k] ?? NATURAL_VAC[k];
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
  depression: [
    "Empty floors are still coming to market — nobody is calling this a recovery.",
    "The brokers have stopped scheduling tours for the secondary stock.",
  ],
};

/**
 * THE ALLOCATION TERM of a class's cap target: half a point of cap per point
 * its expected return sits over the four-class mean, guarded at +/-1.3. See
 * tickEcon for the calibration. A market with no trailing rent history
 * expects each class to return its own cap, so at the opening this reads the
 * caps themselves.
 */
export function capFlowsOf(ret: Record<BuiltClass, number>, k: BuiltClass): number {
  const mean = BUILT_CLASSES.reduce((a, c) => a + ret[c], 0) / BUILT_CLASSES.length;
  return clamp(-0.65 * (ret[k] - mean), -1.3, 1.3);
}

/**
 * WHERE A CLASS'S CAP RATE IS HEADING — the monthly walk in tickEcon chases
 * this, and the opening (regime.ts) starts AT it, so the first months move on
 * news rather than on a cap rate correcting its own opening. `sector` and
 * `flows` are the allocation terms; both are zero on a market with no
 * trailing returns yet. See the long note in tickEcon for every term.
 */
export function capTargetOf(e: Econ, k: BuiltClass, capIndex: number, sector = 0, flows = 0): number {
  const crunch = 1.6 * Math.max(0, 1 - e.creditIdx);
  const vacGap = (e.cityVac?.[k] ?? NATURAL_VAC[k]) - NATURAL_VAC[k];
  const vacRisk = clamp(CAP_VAC_BETA[k] * vacGap * 100, -0.6, 2.0);
  return CAP_BASE[k] + 0.55 * (capIndex - 5.4) - 0.25 * (e.cycleDev ?? 0) + crunch + sector + vacRisk + flows;
}

/**
 * CAPITAL AVAILABILITY, ONE MONTH — shared by tickEcon and the pre-history
 * (regime.ts), so the credit window the player opens into is the one this
 * equation left behind, lag and all.
 */
export function stepCredit(s: GameState) {
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
  const creditTarget = clamp(1.0 + 6 * g12 - 14 * Math.max(0, natUnempRise12(e)), 0.4, 1.25);
  const creditSpeed = creditTarget < e.creditIdx ? 0.16 : 0.055;   // slams shut, reopens slowly
  e.creditIdx = clamp(e.creditIdx + creditSpeed * (creditTarget - e.creditIdx) + rrange(s, -0.012, 0.012), 0.4, 1.25);
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
  if (n.neutralAnchor === undefined) n.neutralAnchor = n.neutralReal;
  n.neutralAnchor = clamp(
    n.neutralAnchor + 0.0009 * (0.014 - n.neutralAnchor) + rrange(s, -0.00035, 0.00035, "nation"),
    0.004, 0.032,
  );
  n.neutralReal = clamp(n.neutralReal + 0.004 * (n.neutralAnchor - n.neutralReal)
    + rrange(s, -0.00020, 0.00020, "nation"), 0.001, 0.034);
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
  const shockHaz = 0.006 + (n.shockClusterM > 0 ? 0.0050 : 0);
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
    const roll = rng(s, "nation");
    if (roll < 0.30) {
      n.shockSev = rrange(s, 0.010, 0.038, "nation");
      n.pressureM = Math.round(rrange(s, 30, 96, "nation"));
      pushNews(s, "warn",
        "The government has opened the spending taps and is financing it in the bond market. "
        + "The central bank has been asked — in the way these things are asked — to keep money "
        + "cheap while it does.");
    } else {
      const adverse = roll < 0.30 + 0.42;
      n.shockSev = (adverse ? 1 : -0.7) * rrange(s, 0.012, 0.055, "nation");
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
    if (rng(s, "nation") < haz) {
      // Most downturns are downturns. About one in fourteen is 1929 or 2008,
      // and those are the ones that redraw a career.
      n.deep = rng(s, "nation") < 0.07;
      n.recM = Math.round(n.deep ? rrange(s, 26, 48, "nation") : rrange(s, 7, 19, "nation"));
      // EVERY RECESSION IS AIMED, not integrated. A rate of rise applied for
      // a drawn duration compounds two dice into a third, and a long draw and
      // a fast draw together produced 27 points of unemployment — the model
      // pinned against its own ceiling for years at a time, which then held
      // the Phillips term negative and the policy rate on the floor for a
      // quarter of the century. A downturn has a depth, and the labour market
      // approaches it and decelerates into it, the way a real one does.
      n.uPeak = clamp(n.unemp + (n.deep ? rrange(s, 0.045, 0.135, "nation") : rrange(s, 0.016, 0.042, "nation")),
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
    + (shock > 0.02 ? 0.0006 : 0) + rrange(s, -0.0007, 0.0007, "nation"), 0.026, 0.26);

  // National inflation: expectations, plus a Phillips term, plus the shock.
  // THE PHILLIPS CURVE IS CONVEX. Slack disinflates weakly — you cannot get
  // prices to fall much no matter how bad it gets, which is why the 2010s had
  // 8% unemployment and 1.5% inflation instead of the deflation the linear
  // version predicts — while a labour market past full employment bids pay up
  // at an accelerating rate. A straight line through the origin gets both
  // ends wrong.
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
  const easy = 0.55 * (n.easeEma >= 0 ? Math.min(n.easeEma, 0.10) : 0.5 * Math.max(n.easeEma, -0.05));
  n.infl = clamp(n.inflExp + phillips + easy + shock + rrange(s, -0.004, 0.004, "nation"), -0.06, 0.22);

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
      + rrange(s, -0.0018, 0.0018, "nation"),
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
  const FOMC = [0, 2, 3, 5, 6, 8, 9, 11];
  const meeting = FOMC.includes(((s.month % 12) + 12) % 12);
  // ...unless it is not free to move. Under fiscal pressure the bank can
  // still cut freely and can barely tighten, which is the whole asymmetry
  // and the whole mechanism: money stays cheap into a real inflation, the
  // ease compounds through expectations, and when the pressure finally lifts
  // the bank has to break the labour market to undo it.
  if (n.pressureM === undefined) n.pressureM = 0;
  if (n.pressureM > 0) {
    n.pressureM--;
    if (n.pressureM === 0) {
      pushNews(s, "event",
        "The central bank has its independence back. Whatever it does next, it is doing on its "
        + "own account — and it has a great deal of ground to make up.");
    }
  }
  if (meeting) {
    const gap = want - n.policy;
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
      const frightened = abs > 7 || restore > 0;
      const unit = restore > 0 ? 1.5 : frightened ? 0.75 : abs > 3 ? 0.50 : 0.25;
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
    if (n.pressureM > 0 && step > 0) step = gap > 1.0 ? 0.25 : 0;
    n.policy = Math.max(0.25, n.policy + step);
  }

  // THE LOAN INDEX IS THE POLICY RATE PLUS A TERM PREMIUM. What a borrower
  // pays was never the central bank's rate; it is that rate plus what the
  // market charges for time and for risk — and that premium WIDENS when
  // credit is frightened, which is why spreads blow out in a crisis even as
  // the policy rate is being cut.
  //
  // AND THE PREMIUM IS A MARKET, NOT A CONSTANT. This line used to EMA the
  // index toward policy + 1.55 with seven basis points of noise, which undid
  // the FOMC fix one street over: the committee now holds and steps like a
  // committee, and then the index glided monotonically toward each new level
  // for months — the player read next month's print off this month's all the
  // same (measured: 66-70% of monthly moves continued the previous
  // direction; monthly change sd 7-8bp against the ~20-25bp a real loan
  // index runs; runs of one direction to 62 months).
  //
  // So the premium is state now: it mean-reverts toward its structural level
  // — 1.55, widened when credit is frightened — while real market noise hits
  // it every month. The index IS policy plus that premium, no smoothing: a
  // bond market reprices a policy step the day it happens, not over a year.
  // Retracements inside a trend fall out of the mean-reversion arithmetic
  // (near equilibrium the expected next change opposes this one), which is
  // exactly the property that makes direction a coin flip in the data.
  //
  // The noise bound is a calibrated shape: +/-0.30 uniform is ~17bp/month
  // sd, sitting in the 15-25bp a 10-year yield or a loan index shows month
  // over month. The reversion (0.10/mo) and the level bounds (0.2 to 4.5)
  // bracket the observed range of term premia without ever binding in an
  // ordinary decade — they are guards, not rails.
  const premBase = 1.55 + 1.85 * Math.max(0, 1 - (e.creditIdx ?? 1));
  if (n.termPrem === undefined) n.termPrem = premBase;
  n.termPrem = clamp(
    n.termPrem + 0.10 * (premBase - n.termPrem) + rrange(s, -0.30, 0.30, "nation"),
    0.2, 4.5);
  e.indexRate = clamp(n.policy + n.termPrem, RATE_FLOOR, RATE_CEIL);
  e.shortIndex = shortIndexFor(n.policy, e.creditIdx ?? 1);
  // the era, for anything that still reads it — now an OUTPUT of the nation
  e.rateRegime = clamp(n.policy + premBase, RATE_FLOOR, RATE_CEIL);
}


// ---------------------------------------------------------------------------
// THE CITY'S INDUSTRIES, AND THE CYCLE THEY MAKE (2026-10-08).
//
// An export-base city. Its tradable industries — the ten trades its tenants
// work in — sell outside the city, so their employment follows the NATION by
// each trade's own cyclical sensitivity, grows at its own long-run trend, and
// takes its own shocks (a plant closes, a sector booms). Local-serving work —
// shops, schools, trades, government — follows the export base with a lag:
// Moretti (2010) finds about 1.6 local jobs for each tradable one, which is
// where a downturn in one industry spreads to the whole town. The city's
// demand for workers moves with that composite, and the PHASE is read off
// it afterwards, the way a statistician dates a cycle: nothing here consults
// a label to decide what jobs do.
//
// INDUSTRY_TREND and INDUSTRY_BETA are stated facts about US industries,
// rounded: long-run payroll growth by sector (BLS CES, 1990-2019) and the
// sector's employment swing per unit of the national swing (BLS recession
// employment declines by industry, 1990-91, 2001, 2008-09). Medical barely
// moves; logistics, apparel and design swing harder than the nation.
// INDUSTRY_VOL keeps its role as relative idiosyncratic volatility.
// ---------------------------------------------------------------------------
const INDUSTRY_TREND: Record<Sector, number> = {      // per year
  finance: 0.008, law: 0.005, tech: 0.025, media: -0.005, insurance: 0.005,
  logistics: 0.015, apparel: -0.015, food: 0.012, medical: 0.020, design: 0.008,
};
const INDUSTRY_BETA: Record<Sector, number> = {
  finance: 1.0, law: 0.5, tech: 1.3, media: 1.0, insurance: 0.5,
  logistics: 1.4, apparel: 1.6, food: 1.1, medical: 0.2, design: 1.4,
};
/** Local-serving jobs per tradable job (Moretti 2010, "Local Multipliers"). */
const LOCAL_MULT = 1.6;
/** Months for local-serving employment to close half its gap to the base. */
const LOCAL_HALF_M = 12;
/** A trade's own shocks: about one notable one a decade at unit volatility (more often for volatile trades), half-life 18 months. */
const IND_SHOCK_HAZ = 1 / 120, IND_SHOCK_HALF_M = 18;
/**
 * `industryMom`'s readers (tenant staffing, default stress, renewals, the
 * comps tape) were calibrated in "boom units", where 0.016 x vol was a trade
 * in full boom. A boom here is excess hiring of about 0.4% a month, so the
 * conversion is 4. Units, not a dial: change the readers and this goes.
 */
const MOM_UNITS = 4;

export function tickIndustryCycle(s: GameState) {
  const e = s.econ;
  const n = e.nat;
  // The nation's employment swing this month, against its trend. Payrolls
  // fall about 1.5% for each point unemployment rises, because people also
  // leave the labour force: 2008-10 took 6.3% off US payrolls against a 2%
  // trend while unemployment rose 5.5 points. One-for-one was tried first
  // and a 6-point national recession left this city flat — the trend growth
  // simply cancelled it.
  const NAT_EMP_PER_U = 1.5;
  const uNow = n?.unemp ?? 0.05;
  const uPrev = e.natUnempPrev ?? uNow;
  e.natUnempPrev = uNow;
  const natDev = -NAT_EMP_PER_U * (uNow - uPrev);

  if (!e.indIdx) e.indIdx = Object.fromEntries(SECTORS.map((k) => [k, 1])) as Record<Sector, number>;
  if (!e.indShock) e.indShock = Object.fromEntries(SECTORS.map((k) => [k, 0])) as Record<Sector, number>;
  if (!e.industryMom) e.industryMom = Object.fromEntries(SECTORS.map((k) => [k, 0])) as Record<Sector, number>;
  if (!e.industryPhase) e.industryPhase = Object.fromEntries(SECTORS.map((k) => [k, "steady"])) as Record<Sector, "boom" | "steady" | "bust">;
  const decay = Math.exp(-Math.LN2 / IND_SHOCK_HALF_M);
  let base = 0, wsum = 0;
  for (const k of SECTORS) {
    const vol = INDUSTRY_VOL[k];
    e.indShock[k] *= decay;
    if (rng(s) < IND_SHOCK_HAZ * vol) {
      const up = rng(s) < 0.5;
      // A shock's whole effect is about 26x its first month (18-month half-
      // life), so this moves a unit-volatility trade 4-12% of its local
      // employment — a plant closing, a sector boom — and tech up to ~16%.
      const size = Math.sqrt(vol) * rrange(s, 0.0015, 0.0045);
      e.indShock[k] += up ? size : -size;
      const exposed = exposureToTrade(s, k) > 0.10;
      pushNews(s, exposed ? (up ? "event" : "warn") : "info", up
        ? `${INDUSTRY_LABEL[k]} is hiring hard. Anyone with space let to that trade is about to have a good few years.`
        : `${INDUSTRY_LABEL[k]} is in trouble. Look at how much of your rent roll depends on it before somebody hands you the keys.`);
    }
    const dev = INDUSTRY_BETA[k] * natDev + e.indShock[k] + rrange(s, -0.0008, 0.0008) * vol;
    e.indIdx[k] *= 1 + INDUSTRY_TREND[k] / 12 + dev;
    // Momentum is smoothed excess hiring, in the units its readers expect.
    e.industryMom[k] = clamp(e.industryMom[k] + (MOM_UNITS * dev - e.industryMom[k]) / 6, -0.05, 0.05);
    const was = e.industryPhase[k];
    const m = e.industryMom[k];
    e.industryPhase[k] = m > 0.008 * vol ? "boom" : m < -0.0075 * vol ? "bust" : "steady";
    void was;
    const w = e.sectorShare?.[k] ?? 1 / SECTORS.length;
    base += w * e.indIdx[k];
    wsum += w;
  }
  const exportIdx = wsum > 0 ? base / wsum : 1;
  e.exportIdx = exportIdx;
  const local = e.localIdx ?? exportIdx;
  e.localIdx = local + (exportIdx - local) * (1 - Math.exp(-Math.LN2 / LOCAL_HALF_M));
  const comp = (exportIdx + LOCAL_MULT * e.localIdx) / (1 + LOCAL_MULT);
  const prevComp = e.cycIdx ?? comp;
  e.cycIdx = comp;
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
    case "recession": if (dwell && g6 > 0.002) next = "recovery"; else if (dd > 0.05 && e.phaseAge >= 12) next = "depression"; break;
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
      expansion: "The expansion is on — rents push, capital chases.",
      peak: "The market has topped out. Everything is priced to perfection.",
      recession: "The turn is here: tenants retrench, lenders retreat.",
      recovery: "The bleeding has stopped. Recovery begins at the bottom of the stack.",
      depression: "This is not a recovery — the city has lost more than one job in twenty and is still losing them.",
    };
    pushNews(s, "event", label[e.phase]);
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
  const c2 = PHASE_CFG[e.phase];

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
  void c2;
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
  if (e.creditIdx < 0.66 && rng(s) < 0.02) {
    pushNews(s, "warn", "The debt markets have effectively closed. Term sheets are being pulled mid-deal.");
  }

  // --- employment: the demand behind every lease -----------------------------
  // A LOCAL PROPERTY SLUMP IS NOT A LOCAL DEPRESSION. The phase machine is a
  // property cycle — vacancy, rents, capital — and its "recession" and
  // "depression" phases bled jobs at 3.7% and 1.2% a year whether or not the
  // nation was in one. A city whose glut kept the phase machine in
  // "depression" for twelve years (harness seed 20603: office vacancy 30%,
  // national recession in two of those years) lost 28% of its jobs and 22%
  // of its people while the country expanded, and that is not what a glut
  // does — Houston in 1986 and Dallas in 1988 lost jobs with the oil bust
  // and the S&L failures, and recovered on the national cycle inside six
  // years with their vacancy still in the twenties. The local phase's job
  // drift now runs at less than half its rate when the nation is expanding;
  // the national recession (`natPull`, below) is what costs a city jobs.
  // Job growth is what the city's industries are doing, export and local
  // (`tickIndustryCycle`). It replaces a table of rates by phase label.
  const jobDrift = e.cycDrift ?? 0;
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
  //
  // ...AND IT HAS TO COST MORE THAN THE TREND GIVES. The old −0.0013/mo
  // (−1.6%/yr) sat almost exactly on top of trend job growth (+1–2%/yr), so a
  // national recession netted to ZERO here: measured over 3 seeds × 50y,
  // 12-month city job growth in recession months ran +0.4% to +1.9% — the sign
  // never turned — tenants never handed space back, and the deepest rent fall
  // any recession window could produce was 3.9% while gluts alone did 17.7%
  // (econ:accept C, the audit's [9] found effective rents falling in only
  // 14.9% of recession months). Recessions were a label on rents, not an event
  // in demand.
  //
  // The record (BLS payrolls, against ~+1.5%/yr trend): 1990–91 and 2001 shed
  // ~1.5–2% net over ~a year — a gross cyclical shock near −3.5%/yr; 2008–09
  // shed 6.3% net over two years; the deep-flag episodes here run 26–48
  // months, the 1930s class, where −4 to −5%/yr gross for the duration is the
  // measured shape. Sized so the trend PAUSES AND TURNS, which is what the
  // word recession means on a payroll chart.
  // The national recession reaches the city through each industry's beta
  // (tickIndustryCycle); a second flat pull here would count it twice.
  const natPull = 0;
  // ...AND THE PAYROLL A TRADE TAKES WITH IT WHEN IT GOES, or brings when it
  // arrives. This is the only place a level event touches the aggregate
  // economy, and it is the one that has to exist: without it a trade could
  // leave town and the unemployment rate, migration, wages and the price level
  // would never hear about it. Everything downstream — population following
  // work, housing demand following population, the Phillips term — is the
  // machinery that was already here, answering a shock it can now see.
  // Zero in every month in which no level event is currently landing.
  const swanPull = e.swanJobDrift ?? 0;
  // A FIRM THAT CANNOT STAFF A CITY STOPS TRYING TO GROW IN IT.
  //
  // `employIdx` is desire and it had no idea whether the desire was being met.
  // The labour block caps hiring at what the town can staff and files the
  // remainder as `jobVac`, and nothing anywhere reduced the desire — so
  // unfilled demand accumulated month after month, for decades, to a quarter
  // of the labour force. No labour market does that. What happens in life is
  // that the second distribution centre opens in the next state, the back
  // office goes where the graduates are, and the expansion that could not be
  // staffed here simply happens somewhere else.
  //
  // So sustained unfilled demand is a drag on further growth, proportional to
  // how bad the shortage is. It is not a cap and it does not reverse anything
  // already hired: at a 2% vacancy gap it removes a fifth of a point of annual
  // job growth, and at 10% it removes most of what a boom was adding. That is
  // the negative feedback the block was missing, and with it `jobVac`
  // equilibrates instead of compounding.
  const staffDrag = 0.55 * (e.jobVac ?? 0) * Math.abs(jobDrift + spacePull > 0 ? jobDrift + spacePull : 0);
  e.employIdx = clamp(
    e.employIdx * (1 + jobDrift + spacePull + natPull + swanPull - staffDrag + rrange(s, -0.0012, 0.0012)), 0.55, 12);

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
    // A JOB NOBODY CAN FILL IS A VACANCY, NOT A JOB.
    //
    // This expression is labour DEMAND — what the city's employers want, driven
    // by the employment index and the trades. It was being written straight
    // into `e.jobs` and read everywhere as employment, and it never once looked
    // at whether there was anybody to do the work.
    //
    // `pnpm rails` found it from the other end. `slackTarget` at line 1413 is
    // `clamp(1 - jobs/labourForce, 0.018, 0.24)` and it sat on its floor in
    // 47.7% of all months. Measured raw, before the clamp, over 4 towns x 50
    // years:
    //
    //     months with slack below the 1.8% floor      37.0%
    //     months with slack below ZERO                21.8%
    //     worst reading                               jobs = 107% of the labour force
    //
    // For a fifth of its life this city employed more people than lived in it,
    // and a clamp reported 1.8% unemployment while it happened. The cause is a
    // speed mismatch that no floor can fix: jobs grow at a median 1.88%/yr and
    // reach 9.6% in a boom, while population manages 0.89% and tops out at
    // 3.2%, because people have to move house and hiring only has to sign a
    // contract. Raising the floor would have hidden it again.
    //
    // So employment is what it is in life: the smaller of what employers want
    // and what the town can staff. The frictional share is people between jobs
    // at any instant and is why even the tightest real labour market has some —
    // US metro unemployment bottomed near 3.4% in 1969 and 3.5% in 2019, and
    // nothing sustained below about 2.5% has ever been recorded, so 2.8% is the
    // floor of the observed range rather than a number picked to make this come
    // out.
    //
    // The demand that cannot be met is not discarded, which is the part that
    // makes this a mechanism rather than a rail: it becomes UNFILLED VACANCIES,
    // and vacancies are how a labour market that has run out of people goes on
    // transmitting pressure to wages and to migration. See `e.jobVac` at the
    // Phillips term below.
    // ...AND THEN THE FLOOR ITSELF WAS THE RAIL (2026-10-08). `min(wanted,
    // force x (1 - 0.028))` put local unemployment on exactly 2.80% in 8-48%
    // of months over four 50-year worlds, and at exactly 2.80% at its lowest
    // in every one. No labour market sits on a number. What a real one does
    // as it tightens is make each additional hire harder: openings go
    // unfilled, pay rises, people come back into the labour force and move
    // to town. So employment is now a stock moved by FLOWS, the way the
    // labour statistics measure it:
    //
    //   separations   s x E a month                      SEPARATION_RATE
    //   openings      V = (positions wanted - E) + separations
    //   hires         H = min(V, f(theta) x U),  theta = V / U
    //                 f(theta) = 1 - exp(-lambda x sqrt(theta))
    //   employment    E' = E - separations + hires
    //
    // The job-finding rate f rises with tightness at the square-root
    // elasticity of the empirical matching function (Petrongolo & Pissarides
    // 2001) and saturates below one, the urn-ball shape: no labour market
    // hires every searcher in a month. A plain Cobb-Douglas was tried first
    // and does exactly that once openings pass about twice the searchers —
    // unemployment then sat on s/(s+1) = 2.52% in 10-27% of months, a new
    // floor made of the formula. `lambda` is not tuned: it is solved so the
    // opening town, whose unemployment is OPENING_UNEMP, is a steady state —
    // hires exactly replace separations. That gives a job-finding rate of
    // about 47% a month at the opening, against roughly 45% in US data
    // (Shimer 2005), which is a check, not a fit. Unemployment then
    // bottoms out wherever the pace of hiring and the pool of searchers
    // leave it: a fast boom runs into ever-harder hires and unfilled
    // openings, which bid up pay (`jobVac` in the Phillips term) and pull in
    // movers (migration, below). The Beveridge curve falls out of this; it is
    // not written anywhere.
    //
    // Layoffs are immediate (positions wanted below employment), because
    // firms cut payroll faster than they can hire it back — the asymmetry
    // every recession shows.
    const SEPARATION_RATE = 0.026;   // monthly employment-to-unemployment flow, CPS (Shimer 2005)
    // At the opening steady state openings are just replacements (V = sE),
    // so theta0 = s(1-u0)/u0 and the finding rate must equal it too.
    const THETA0 = SEPARATION_RATE * (1 - OPENING_UNEMP) / OPENING_UNEMP;
    const MATCH_LAMBDA = -Math.log(1 - THETA0) / Math.sqrt(THETA0);
    // A DEAR WORKFORCE IS HIRED LESS (2026-10-08). Employers here compare
    // what this town pays with what the same worker costs elsewhere (the
    // national wage path: expected inflation plus productivity, with none of
    // this town's tightness — `natWageIdx`, below). Local pay above it trims
    // how many they want, and local pay below it draws work in. Without this
    // the only answer to a labour shortage was migration, and unfilled
    // openings ran to 7-17% of the labour force against a US maximum of
    // about 7.4%, so national recessions trimmed vacancies and cost nobody a
    // job. Elasticity 0.5: Hamermesh (1993) surveys -0.15 to -0.75, and a
    // firm that can also hire in another city sits in the upper half. Read
    // through a two-year average, because hiring plans move slowly.
    const premRaw = (e.wageIdx ?? 1) / Math.max(0.1, e.natWageIdx ?? (e.wageIdx ?? 1));
    e.wagePremEma = (e.wagePremEma ?? premRaw) + (premRaw - (e.wagePremEma ?? premRaw)) / 24;
    const wageDemand = Math.pow(Math.max(0.3, e.wagePremEma), -0.5);
    const wanted = Math.round((e.jobs0 ?? 132_000) * e.employIdx * wageDemand * (1 - CONSTRUCTION_JOB_SHARE + trades));
    // PARTICIPATION ANSWERS THE MARKET. People come back to work when jobs are
    // easy to find and stop looking when they are not — the discouraged-
    // worker effect. About 0.3 points of participation per point of
    // unemployment against normal, adjusting over a year (Erceg & Levin 2014
    // put the cyclical response at 0.2-0.4). The guard is wider than any
    // US metro has recorded and should never bind.
    const partPrev = e.participation ?? PARTICIPATION;
    // ...and on WHO lives here: a working-age adult participates at about 80%,
    // a retiree at about 19% (BLS CPS), children not at all. An ageing town
    // works less per head without anything telling it to.
    const ag = e.ages;
    const ageMix = ag ? (0.80 * ag.work + 0.19 * ag.old) / Math.max(1, ag.kids + ag.work + ag.old) : 0.80 * 0.61 + 0.19 * 0.17;
    const ageFactor = ageMix / (0.80 * 0.61 + 0.19 * 0.17);
    const partAim = PARTICIPATION * ageFactor + 0.3 * (OPENING_UNEMP - (e.unemployment ?? OPENING_UNEMP));
    e.participation = clamp(partPrev + (partAim - partPrev) / 12, 0.50, 0.66);
    const force = e.population! * e.participation;
    const empStart = Math.min(prevJobs, wanted);                 // layoffs first
    const seps = SEPARATION_RATE * empStart;
    const searchers = Math.max(0, force - empStart);
    const openings = Math.max(0, wanted - empStart) + seps;
    const theta = searchers > 0 ? openings / searchers : 0;
    const finding = 1 - Math.exp(-MATCH_LAMBDA * Math.sqrt(theta));
    const hires = Math.min(openings, finding * searchers);
    // People leaving town take their jobs with them: employment cannot exceed
    // the labour force. A guard — the flows above cannot reach it unless the
    // population falls faster than firms shed staff.
    e.jobs = Math.round(clamp(empStart - seps + hires, 0, force));
    // Unfilled positions beyond ordinary turnover, as a share of the labour
    // force — what the Phillips term and migration read as tightness.
    e.jobVac = Math.max(0, (wanted - e.jobs) / Math.max(1, force));
    const jobGrowth = prevJobs > 0 ? e.jobs / prevJobs - 1 : 0;

    // UNEMPLOYMENT IS WHAT THE FLOWS LEAVE. It still lags the cycle — the
    // labour force does not shrink the month the jobs go; people look for a
    // year before they stop or leave town — but the lag is now participation
    // and migration doing it, not a smoothing coefficient on the rate.
    const labourForce = force;
    e.unemployment = clamp(1 - e.jobs / Math.max(1, labourForce), 0, 0.5);

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
    // AGAINST THE NATION, NOT AGAINST 5.5% (2026-10-09). People leave a town
    // whose unemployment is worse than elsewhere and come to one where it is
    // better; Blanchard & Katz (1992) measure exactly that relative rate. A
    // fixed 5.5% pivot read a town at 4.4% as permanently attractive even
    // while the whole nation sat at 4%.
    const uGapPop = e.unemployment! - (e.nat?.unemp ?? OPENING_UNEMP);
    // PEOPLE MOVE TO WHERE THE UNFILLED JOBS ARE, and this was the wire the
    // block above already claimed to have — "vacancies are how a labour market
    // that has run out of people goes on transmitting pressure to wages and to
    // migration" — while `jobVac` was in fact read in exactly one place, the
    // Phillips term, and never touched population at all.
    //
    // It matters because `jobGrowth` is measured on FILLED jobs, and filled
    // jobs are pinned to the labour force the moment the town runs out of
    // people. So in the one situation where a city most needs to attract
    // workers, the only signal pulling them in had gone flat: the shortage
    // could not call anybody. A tenth of the vacancy gap a year is a slow
    // answer, which is right — moving house takes a year — and it is enough to
    // close a shortage over a decade instead of never.
    // UNFILLED JOBS DRAW PEOPLE. A local boom is staffed mostly by movers:
    // Blanchard & Katz (1992) find a state's employment shock is absorbed
    // largely by migration with a half-life of a few years, so the pull of
    // unfilled openings closes the gap at ln2/36 a month. It used to be a
    // tenth a year, which left the labour cap to do the work.
    const vacPull = Math.min(0.04, (e.jobVac ?? 0)) * (Math.LN2 / 36);
    // PEOPLE MOVE FOR REAL PAY (2026-10-09). Migration read jobs, unfilled
    // jobs and unemployment, and never the wage: measured over 4 worlds x 50
    // years the town's nominal pay ended 1.24-2.08x the nation's, with
    // nobody moving in for it, and local prices 1.39-1.42x. In the spatial
    // equilibrium every urban model rests on (Rosen 1979; Roback 1982),
    // movers equalise REAL wages net of amenity — what pay buys after rent —
    // and the premium closes because the inflow loosens the labour market.
    // The real premium here is local pay over local prices against national
    // pay over national prices, and the price level now carries the town's
    // rent (see the CPI block), so a dear-to-live-in town is correctly a
    // less attractive one. Shape parameter, stated: a 10% real premium draws
    // about 1% of population a year, the order of the migration responses in
    // Blanchard & Katz (1992) and Kennan & Walker (2011). Read through the
    // same two-year average the employers use.
    const realPrem = ((e.wageIdx ?? 1) / Math.max(0.1, e.cpi ?? 1))
      / Math.max(1e-6, (e.natWageIdx ?? e.wageIdx ?? 1) / Math.max(0.1, e.natCpi ?? e.cpi ?? 1));
    e.realPremEma = (e.realPremEma ?? realPrem) + (realPrem - (e.realPremEma ?? realPrem)) / 24;
    const premPull = 0.10 * Math.log(Math.max(0.2, e.realPremEma)) / 12;
    let migration = jobGrowth * pull + vacPull + premPull - clamp(uGapPop * 0.020, -0.0010, 0.0030);

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
    // RETIRED (2026-10-09): out-migration on a rent-burden threshold
    // (`mfBurden > 1.25` against the global RENT_BASE table, capped at
    // 0.25%/mo). Rent now reaches movers through the real wage — it is a third
    // of the price level the premium is deflated by — continuously and in both
    // directions, rather than through a step at a ratio nobody measured.
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
    // PEOPLE ARE BORN, AGE AND DIE (2026-10-08). Natural increase was a
    // constant 0.016% a month for a population with no ages. Now the city has
    // three groups and the vital rates of the US, rounded: births 11 per 1,000
    // people a year, all to the working-age group (CDC NVSS 2019); deaths 0.3,
    // 3 and 45 per 1,000 among children, working-age and over-65s (CDC
    // age-specific mortality); children reach working age over 18 years and
    // workers retire over 47. The opening mix is the 2020 Census (22 / 61 / 17).
    // Movers are mostly working-age adults, some with children (Census CPS
    // mobility): 75 / 20 / 5. Natural increase is now an outcome — about
    // +0.15%/yr at the opening, falling as the town ages, rising when young
    // movers arrive — and so is the age mix that participation and household
    // formation read.
    {
      const pop = e.population!;
      if (!e.ages) e.ages = { kids: pop * 0.22, work: pop * 0.61, old: pop * 0.17 };
      if (e.adults0 === undefined) e.adults0 = (e.pop0 ?? pop) * 0.78;
      const a = e.ages;
      const births = a.work * (0.011 / 0.61) / 12;
      const grow = a.kids / 18 / 12, retire = a.work / 47 / 12;
      const mig = pop * migration;
      a.kids += births + 0.20 * mig - grow - a.kids * 0.0003 / 12;
      a.work += grow + 0.75 * mig - retire - a.work * 0.003 / 12;
      a.old += retire + 0.05 * mig - a.old * 0.045 / 12;
      a.kids = Math.max(0, a.kids); a.work = Math.max(0, a.work); a.old = Math.max(0, a.old);
      const total = a.kids + a.work + a.old;
      // The guard below is a share of this town (see above); if it ever binds,
      // every group is scaled alike.
      const bounded = clamp(total, popFloor, popCeil);
      if (total > 0 && bounded !== total) { const f = bounded / total; a.kids *= f; a.work *= f; a.old *= f; }
      e.population = Math.round(bounded);
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
    const vacRate = Math.min(0.075, (e.jobVac ?? 0) / (1 + (e.jobVac ?? 0)));
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
    const tight = Math.max(-0.06, Math.min(0.055, OPENING_UNEMP - e.unemployment! + vacRate));
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
    const SHELTER_W = 0.33, SERVICES_W = 0.25;
    const natCpiPrev = e.natCpi ?? e.cpi!;
    e.natCpi = natCpiPrev * (1 + natInfl / 12);
    const natCpi12 = h12?.natCpi ? e.natCpi / h12.natCpi - 1 : natInfl;
    const shelter12 = h12?.rent?.multifamily ? e.rentIdx.multifamily / h12.rent.multifamily - 1 : natCpi12;
    const wage12 = h12?.wageIdx ? (e.wageIdx ?? 1) / h12.wageIdx - 1 : 0;
    const natWage12 = h12?.natWageIdx ? (e.natWageIdx ?? 1) / h12.natWageIdx - 1 : wage12;
    const inflM = natInfl / 12
      + (SHELTER_W * (shelter12 - natCpi12) + SERVICES_W * (wage12 - natWage12)) / 12;
    void cost12;
    // The old monthly floor (-0.05%/mo unless the nation deflated) and the
    // 1.15%/mo ceiling were there to stop the labour term running away. With
    // the price level built from traded goods and two local relatives, those
    // are wide guards: a month the town deflates faster than 1% is a month
    // its rents fell by a third.
    e.cpi = clamp(e.cpi! * (1 + clamp(inflM, -0.01, 0.02)), 0.5, 1000);
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
    // PAY IS SET AGAINST THE NATION'S EXPECTED INFLATION, NOT THE TOWN'S
    // (2026-10-09). With the town's rent inside its price level, reading local
    // `inflExp` here closed a direct indexation loop — rent up, local CPI up,
    // local expectations up, local pay up, local services up, local CPI up —
    // with a gain of about 0.58 per turn, and measured over 4 worlds x 50
    // years it carried local pay to 1.24-2.08x the national path. Employers
    // set raises against the price outlook every employer in the country
    // shares and against how hard it is to hire HERE (`tight`). What a dear
    // town costs its workers reaches their pay the way it does in life: some
    // of them leave (the real-wage premium in migration), the labour market
    // tightens, and pay is bid up through `tight` — the compensating
    // differential as a consequence, not as an indexation clause.
    //
    // ...AND PAY CATCHES UP WITH THE INFLATION IT MISSED. Pure expectations
    // left a permanent forecast error in pay: measured over 4 worlds x 50
    // years the nation's expected inflation sat about half a point under
    // realised, so real pay grew 0.1-1.0%/yr against 1.1% productivity — a
    // workforce fooled for half a century. Wage setting indexes partly to
    // last year's prices; Smets & Wouters (2007) estimate the indexation
    // share at about 0.58, which is used here against the national CPI.
    const payExp = 0.42 * (e.nat?.inflExp ?? e.inflExp) + 0.58 * natCpi12;
    const growth = payExp / 12 + productivity / 12 + tight * 0.012 + rrange(s, -0.0004, 0.0004);
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
    // What the same worker earns elsewhere: the national path, expectations
    // plus productivity, none of this town's tightness or slack.
    // ...and the NATION's expectations and labour market, not this town's
    // (2026-10-09). This read the local `inflExp`, so "what a worker earns
    // elsewhere" moved with this town's own inflation, and a dear town looked
    // ordinary to its employers. National pay is national expected inflation
    // plus productivity plus the same Phillips slope on the nation's gap.
    {
      const n = e.nat;
      const natTight = n ? Math.max(-0.06, Math.min(0.055, NAT_U_STAR - n.unemp)) : 0;
      const natGrowth = (0.42 * (n?.inflExp ?? e.inflExp) + 0.58 * natCpi12) / 12 + productivity / 12 + natTight * 0.012;
      e.natWageIdx = (e.natWageIdx ?? e.wageIdx!) * (1 + Math.max(0, natGrowth));
    }

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
    const availNow = (e.cityVac?.office ?? NATURAL_VAC.office)
      + (e.sublet?.office ?? 0) / stock;
    const tightNow = (NATURAL_VAC.office - availNow) / NATURAL_VAC.office;
    const friction = residenceVac(e, "office");
    const pinned = (e.cityVac?.office ?? NATURAL_VAC.office) <= friction + 1e-6;
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
        [-0.024, 2],   // densification + telework era
        [-0.009, 3],   // slow space-per-worker compression
        [0.0, 2],      // steady state
        [0.008, 2],    // services boom pulls desks
      ],
      retail: [
        [-0.02, 2],    // the browser eats the high street
        [-0.008, 3],   // slow erosion
        [0.0, 2],      // steady state
        [0.005, 1],    // urban retail renaissance
      ],
      multifamily: [
        [-0.004, 1],   // suburban exodus
        [0.0, 2],      // steady state
        [0.007, 3],    // household-formation wave
        [0.013, 1],    // urbanization surge
      ],
      industrial: [
        [-0.0172, 3],  // the manufacturing exodus (the old constant, now one era)
        [-0.006, 2],   // slow thinning
        [0.0, 2],      // steady state
        [0.012, 2],    // logistics / fulfilment boom
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
      sec.idx = clamp(sec.idx * (1 + (coupled / 12) * Math.max(0, span)), 0.45, 2.2);
    }
    // sheds keep their floor: last-mile and food distribution never leave
    e.secular.industrial.idx = Math.max(INDUST_COMP_FLOOR, e.secular.industrial.idx);
    // legacy mirror, for anything that still reads it
    e.industComp = e.secular.industrial.idx;
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
    const sites = rawSites === undefined ? 1 : Math.max(0, rawSites);
    const appetite = devPencils(e, k) * credit * sites;
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
    const catchUp = 1 + clamp(e.structTight?.[k] ?? 0, 0, 0.45) * 4.5;
    const start = stk * 0.0016 * Math.min(2.4, appetite) * catchUp * (0.7 + 0.6 * jitter);
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
    // Housing is households at different incomes, not one citywide elasticity.
    // Lower-income share rises with unemployment (who is exposed); each tier
    // densifies / doubles up at its own rate. Commercial stays a single firm
    // footprint response.
    // TWO ARGUMENTS, NOT ONE RATIO. `burden = rent/wage` forced the income
    // elasticity to equal the price elasticity and put both under one clamp —
    // see INCOME_ELAST. The price argument is now a REAL RENT INDEX measured
    // against this town's own opening print (rentAnchor, not RENT_BASE, so a
    // dense map does not start off-parity), and income is its own argument.
    // Both are exactly 1.0 in month zero on every seed and every map.
    const cpiNow = Math.max(0.35, e.cpi ?? 1);
    const anchor = e.rentAnchor?.[k] ?? RENT_BASE[k];
    const relRent = (e.rentIdx[k] / Math.max(1e-6, anchor)) / cpiNow;
    const burden = relRent;
    let affordRaw: number;
    if (k === "multifamily") {
      const u = e.unemployment ?? 0.055;
      const low = clamp(0.30 + (u - 0.05) * 1.5, 0.22, 0.48);
      const hi = clamp(0.28 - (u - 0.05) * 0.8, 0.15, 0.35);
      const mid = Math.max(0.15, 1 - low - hi);
      affordRaw = low * clamp(Math.pow(burden, -0.70), AFFORD_BAND[0], AFFORD_BAND[1])
        + mid * clamp(Math.pow(burden, -0.50), AFFORD_BAND[0], AFFORD_BAND[1])
        + hi * clamp(Math.pow(burden, -0.35), AFFORD_BAND[0], AFFORD_BAND[1]);
    } else {
      affordRaw = clamp(Math.pow(burden, -0.40), AFFORD_BAND[0], AFFORD_BAND[1]);
    }
    if (!e.affordEff) e.affordEff = { office: 1, retail: 1, multifamily: 1, industrial: 1 };
    // At the lease-rollover rate of THIS class, not of an office. See AFFORD_ROLL.
    e.affordEff[k] += AFFORD_ROLL[k] * (affordRaw - e.affordEff[k]);

    // THE INCOME ARGUMENT. A city that gets richer occupies more and better
    // space; a city that gets poorer gives it back. Real income per worker
    // against the town's opening real income — the INTENSIVE margin only,
    // because headcount is already in `employIdx^elastic` above and counting it
    // here would count the same workers twice.
    //
    // REAL, NOT NOMINAL, AND THIS IS NOT NEGOTIABLE. `wageIdx` is nominal (see
    // its declaration in types.ts). Reading it raw would make physical square
    // feet a function of the price level — a city needing more floor because
    // prices rose — and would close a positive loop: prices up, nominal wage
    // up, more space demanded, rent up, construction cost catch-up, prices up.
    //
    // ROLLED AT THE CLASS'S LEASE SPEED, for the same reason the price term is:
    // feet per worker adjusts at lease events, not continuously (Hakfoort & Lie
    // 1996). That damping also disarms a hazard this term would otherwise carry
    // — real pay per SURVIVING worker RISES in a deflationary bust, because
    // nominal wages are downward-rigid while cpi can fall, so an undamped term
    // would hand a dying city extra office demand. At an eight-year roll a
    // two-year deflation moves it by almost nothing.
    if (!e.incomeEff) e.incomeEff = { office: 1, retail: 1, multifamily: 1, industrial: 1 };
    const realWage = (e.wageIdx ?? 1) / cpiNow;
    const w0 = e.wage0 ?? (e.wage0 = realWage);
    const relWage = Math.max(0.25, realWage / Math.max(1e-6, w0));
    const incomeRaw = Math.pow(relWage, INCOME_ELAST[k]);
    e.incomeEff[k] += AFFORD_ROLL[k] * (incomeRaw - e.incomeEff[k]);

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
        // Physical unhousable looking demand — not the absorption queue.
        const house = housableStock(e, k);
        const queue = Math.max(0, ((e.pool?.[k] ?? 0) - house - (e.sublet?.[k] ?? 0)) / stk);
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
    // ...AND IT IS THE JOBS THAT EXIST, NOT THE JOBS SOMEBODY WANTED.
    //
    // This read `employIdx`, which is what employers WANT to hire. Since the
    // labour block above caps actual employment at what the town can staff,
    // the two numbers separate the moment a boom outruns the population — and
    // they separated permanently. Measured over the first ten years on three
    // seeds, unfilled positions ran from nothing to 8-24% OF THE LABOUR FORCE
    // and never came back, which means a fifth of the office demand pricing
    // this city's rents was demand from desks that had nobody to sit at them.
    // Office vacancy fell to 3.7% by year five, rents went 2.4x in ten years
    // and the median lot went 4.8x.
    //
    // A firm does not lease a floor for a headcount it cannot hire. Demand for
    // space is demand from people who turned up, and `e.jobs` — the same
    // number the unemployment rate and the wage bill are struck on — is that
    // number. One quantity, one answer.
    const jobs0 = e.jobs0 ?? 132_000;
    const jobIdx = (e.jobs ?? jobs0) / jobs0;
    // Sheds are leased by industrial firms. Total jobs is the right scale for
    // office; for industrial it has to be multiplied by the secular share of
    // employment that still wants a shed — see `industComp` / INDUST_COMP_MONTH.
    // Without that factor, a growing services city manufactures warehouse
    // demand it cannot supply and the vacancy floor becomes load-bearing.
    // WHO LEASES THIS CLASS, AND HOW MANY OF THEM THERE ARE. Office is let to
    // finance, law, tech, media, insurance and design; sheds to logistics,
    // food and apparel. Their employment moves with the city's industries
    // (`tickIndustryCycle`), so a class's driver is the city's jobs times how
    // its tenant trades are doing against the city as a whole: a tech bust
    // empties offices, a logistics boom fills sheds. This replaces adding
    // industry MOMENTUM on top of job counts, which, now that jobs come from
    // the same industries, would count one cycle twice.
    const tradeMix = (() => {
      const trades = SECTOR_CLASSES[k] ?? [];
      if (!trades.length || !e.indIdx) return 1;
      let w = 0, acc = 0;
      for (const sec of trades) {
        const share = e.sectorShare?.[sec] ?? (1 / Math.max(1, trades.length));
        acc += share * (e.indIdx[sec] ?? 1);
        w += share;
      }
      const own = w > 0 ? acc / w : 1;
      return own / Math.max(0.05, e.exportIdx ?? 1);
    })();
    const secIdx = e.secular?.[k]?.idx ?? (k === "industrial" ? (e.industComp ?? 1) : 1);
    // Flats are rented by HOUSEHOLDS, and households are formed by adults —
    // an ageing town with fewer children forms more, smaller households per
    // head. Adults against the opening's adults.
    const hhIdx = e.ages && e.adults0 ? (e.ages.work + e.ages.old) / e.adults0 : popIdx;
    const driver = (k === "multifamily" ? hhIdx
      : k === "retail" ? Math.pow(popIdx, 0.68) * Math.pow(jobIdx, 0.32)
      : jobIdx * tradeMix) * secIdx;
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
            ? `${SECTOR_LABEL[k]} is turning. Tenants in that sector are expanding hard and every landlord in it knows.`
            : `${SECTOR_LABEL[k]} demand is rolling over. Brokers are quietly cutting asking rents.`);
        }
      }
    }
    // AND THE LEVEL EVENTS RIDE UNDERNEATH ALL OF IT. `swanClassLevel` is 1.0
    // in a city nothing structural has happened to, and it is the permanent
    // restatement of what this class is wanted for once something has: less
    // office per job after remote work, fewer desks of any kind once the trade
    // that sat at them has gone, more shed once the shopping moved into one.
    // It multiplies rather than adding because it is a LEVEL, and it sits
    // outside `sectorMom` and `affordEff` because neither of those ever stops
    // reverting and this never reverts at all. See swans.ts.
    const swanLvl = swanClassLevel(e, k);
    // The cycle is already in the driver (the tenants' own employment or
    // population); adding momentum on top would count it twice.
    const cycleTerm = 1;
    const targetRaw = (e.baseStock?.[k] ?? CITY_STOCK[k]) * (1 - NATURAL_VAC[k])
      * Math.pow(driver, elastic)
      * cycleTerm
      * e.affordEff[k]
      * (e.incomeEff?.[k] ?? 1)   // the income argument — see INCOME_ELAST
      * swanLvl;
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
    const searchFringe = e.stock[k] * NATURAL_VAC[k] * 0.25;
    const poolTarget = Math.min(targetRaw, housable + searchFringe);
    if (!e.pool) e.pool = { ...e.occupied };
    e.pool[k] += 0.10 * (poolTarget - e.pool[k]);
    e.pool[k] -= 0.25 * Math.max(0, e.pool[k] - housable * 1.02);
    // SPACE CAPS PAYROLL DESIRE. Jobs drove the looking pool with no return
    // wire from "there is no floor left" — only from rent via spacePull. So a
    // city could staff 2× the desks it can house, keep those jobs on the books,
    // and have the truncated pool still press rents while headcount marched on.
    // Desired demand that exceeds the housable search fringe is firms that will
    // not grow payroll here; bleed that excess out of employIdx at lease-plan
    // speed (capped — not the uncapped spacePull disaster at 1.8× RTI).
    if (k === "office" && targetRaw > housable + searchFringe) {
      const excess = (targetRaw - housable - searchFringe) / Math.max(1, targetRaw);
      e.employIdx = Math.max(0.55, (e.employIdx ?? 1) * (1 - Math.min(0.0015, excess * 0.004)));
    }
    // ABSORPTION IS FINITE, and it is a property of TENANTS, not buildings.
    // The clamps and the noise used to scale with stock — a bigger city of
    // buildings signed leases faster. Now they scale with occupied: a bigger
    // city of tenants does.
    //
    // MATCHING FRICTION. When empty floors sit beside a looking queue, some of
    // that queue is the wrong class, size or district — search, not clearing.
    // Slow the absorb rate with the excess vacancy rather than pretending every
    // searcher can take every empty suite this month.
    const vacNow = e.cityVac?.[k] ?? NATURAL_VAC[k];
    const matchFrict = (vacNow > NATURAL_VAC[k] && e.pool[k] > e.occupied[k])
      ? clamp(1 - (vacNow - NATURAL_VAC[k]) * 2.2, 0.55, 1)
      : 1;
    const absorb = clamp(0.055 * matchFrict * (e.pool[k] - e.occupied[k]), -0.006 * e.occupied[k], 0.010 * e.occupied[k])
      + e.occupied[k] * rrange(s, -0.0005, 0.0005);
    // FRICTIONAL VACANCY IS RESIDENCE TIME, not a rail. Suites sit dark
    // between tenants for `reletMonths`; new floor sits dark until it
    // has been a suite. Occupied cannot eat either. The hard floor on how
    // fast a market can empty is still the -0.006 × occupied absorb bound;
    // vacancy itself is 1 − occ/stock, allowed to print what the flows did.
    const inTransit = betweenTenantsSf(e.occupied[k], k);
    e.occupied[k] = clamp(e.occupied[k] + absorb, 0, Math.max(0, housable - inTransit));

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
      * cycleTerm
      * affordRaw
      * incomeRaw   // the give-back reads the SAME two arguments targetRaw does
      * swanLvl;
    const cyclical = Math.max(0, (e.occupied[k] - wantedNow) * DEMISABLE[k]);
    const background = e.occupied[k] * (SUBLET_BG[k] ?? 0);
    const marketable = clamp(cyclical + background, 0, e.occupied[k] * SUBLET_MAX[k]);
    e.sublet[k] += (marketable - e.sublet[k]) / SUBLET_TAU;
    e.sublet[k] = clamp(e.sublet[k], 0, e.occupied[k]);

    e.cityVac[k] = clamp(1 - e.occupied[k] / e.stock[k], 0, 0.45);
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
    // THE QUEUE IS PRICED AT TODAY'S RENT (2026-10-09). It read `targetRaw`,
    // demand at the hundred-month `affordEff` — what sitting tenants hold, which
    // can only reprice as leases roll. Once the queue began to bid (see
    // `effGap` in the rent block) that lag made a cobweb: measured, seed 8919
    // industrial asking tripled in five years against a queue that did not
    // shrink as the price rose, then a quarter of the demand left town and
    // vacancy sat at 45% for thirty years. The people in a queue are
    // searchers, and a searcher answers the asking rent the month it is
    // quoted — the same distinction the give-back draws for marketed space.
    // So the queue is `wantedNow` (today's price, today's income) over what
    // the city can house.
    e.structTight[k] = Math.max(0, (wantedNow - housable) / Math.max(1, e.stock[k]));
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
  // is fixed at NATURAL_VAC - frictionFloor = 7.82pp, and depth*railSat peaks
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
    const gap = (e.cityVac?.[k] ?? NATURAL_VAC[k])
      + (e.sublet?.[k] ?? 0) / Math.max(1, e.stock?.[k] ?? CITY_STOCK[k])
      - NATURAL_VAC[k];

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
    e.concIdx[k] += (opening ? 0.25 : CONC_DECAY[k]) * (concTarget - e.concIdx[k]);
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
    const vacNow = e.cityVac?.[k] ?? NATURAL_VAC[k];
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
    // answers it, and two things do: tenants economise on dear space
    // (`affordEff`, the real-rent elasticity in the demand target) and
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
    // (`affordEff`, migration, firms leaving) or until a building pencils.
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
    const vacTerm = effGap <= 0
      ? -effGap * 0.070
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
    const scarcity = pinned
      ? clamp(Math.max(0, dSt) * 1.8 + st * onRailLevel, 0, 0.0045)
      : clamp(st * 0.045 * railSat + Math.max(0, dSt) * 1.8 * (1 - railSat), 0, 0.006);

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
    void scarcity;
    const instant = vacTerm;
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
    // (affordEff), which is where a shortage really stops.
    // Hard rail on the EMA itself — see the press clamp at the drift line.
    // A GUARD, NOT THE ADJUSTMENT SPEED (2026-10-09). This was -0.8%/+0.75% a
    // month — the speed limit on how fast a market may reprice, and with the
    // queue joining the gap it would have been the number doing the work.
    // At 3%/mo either way it is a statement that no asking sheet moves 40% in
    // a year, which none has.
    e.rentPress[k] = clamp(e.rentPress[k], -0.03, 0.03);

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
    // Parity is the town's OWN opening print (rentAnchor), not RENT_BASE.
    // Density-scaled openings sit well below the global table; measuring
    // against RENT_BASE made every young town look "cheap" and the under-
    // shoot term HELPED rents compound until they hit the table — measured
    // as hot seeds at +3–4%/yr real and land residuals from $50 to $3,000/sf.
    const base = e.rentAnchor?.[k] ?? RENT_BASE[k];
    const rentToIncome = (e.rentIdx[k] / Math.max(1e-6, base)) / income;
    // HOW MUCH OF A PREMIUM A CHRONICALLY SHORT CITY EARNS (2026-10-08).
    //
    // This read an office-only `tightEma` that REFUSED to grow while a class
    // sat on its vacancy floor ("a Manhattan premium is earned by demand, not
    // by a supply failure"), loaded at 0.28 x the city-class factor and capped
    // at 0.55 — at most +15% rent-to-income, less in a secondary town. That is
    // the economics backwards. A price above replacement cost is what a supply
    // shortfall looks like: Manhattan and San Francisco sit far above cost
    // because supply cannot answer (Glaeser & Gyourko 2005; Saiz 2010), and
    // the premium lasts as long as the shortfall does. Measured with the old
    // rule, new space at the city's AVERAGE location was worth only 1.00-1.09x
    // its full cost on free land for twenty years while classes sat on their
    // vacancy floor 30-50% of months — so nothing beyond the best dirt could
    // ever be built, and the shortage could not end.
    //
    // Now each class keeps its own memory of how short it has been: on the
    // floor, how much desired demand the city cannot house (`structTight`, 10%
    // of stock counting as fully short — a shape parameter, stated); off it,
    // availability against natural, as before; a glut reads negative. A decade
    // to build or lose (1/120 a month): long enough that one tight year earns
    // nothing, short enough that the premium goes once supply catches up. At
    // full shortage the sustainable rent-to-income is +60%, about the spread
    // between the most supply-constrained US metros and ordinary ones
    // (rent-to-income, rounded). A small town that cannot build prices like
    // any other place that cannot build; the city-class haircut is gone.
    // The level is still held where it should be: tenants economise on dear
    // space (`affordEff`), households leave (migration), firms hire elsewhere
    // (the wage and space pulls on employment) — and builders build.
    if (!e.scarcity) e.scarcity = { office: 0, retail: 0, multifamily: 0, industrial: 0 };
    {
      const short = pinned
        ? clamp((e.structTight?.[k] ?? 0) / 0.10, 0, 1)
        : clamp(-gap / NATURAL_VAC[k], -0.3, 1);
      e.scarcity[k] += (short - e.scarcity[k]) / 120;
    }
    const sustain = 1 + 0.6 * e.scarcity[k];
    const dev = rentToIncome / sustain - 1;
    // Pull hard when rent outruns pay; barely nudge when rent is cheap —
    // cheap space is what supply is for, not a reason to reprice the city up.
    // Soft weight fades asking's CPI/cycle lift over the first ~3pp of surplus
    // availability (ECONOMY.md soft-market escalator). Keep the cheap-side
    // undershoot nudge even while soft — muting it trapped some seeds at
    // absurdly low rent-to-income because vacTerm's hump dies and nothing
    // reconstituted a clearing face rate.
    const softW = clamp(gap / 0.03, 0, 1);   // 0 at natural, 1 by +3pp soft
    const firmW = 1 - softW;
    // Cheap-side pull is weak off-rail (supply is what clears a glut of cheap
    // space). Near/on the rail, do NOT pull all the way to earned sustain —
    // that reminted pin-month real growth once scarcity was muted. Pull only
    // toward a floor RTI, hard enough to track wages (partial CPI alone
    // cannot hold a ratio against ~1.4%/yr real pay), then stop once there.
    const rtiFloor = 0.65;
    const belowFloor = rentToIncome / rtiFloor - 1; // negative when under the floor
    // RETIRED (2026-10-09): the income anchor as a force on the price. It
    // pulled rent down up to 3.6%/mo whenever rent-to-income outran an
    // "earned" ratio, and pushed it up toward a 0.65 floor on the rail — a
    // second price rule on top of a demand side that already prices the same
    // thing: tenants take less of dear space (`affordEff`), households leave
    // a town whose rent eats its pay (the real-wage premium in migration, now
    // that rent is in the price level), firms hire elsewhere (`wageDemand`),
    // and builders build into a rent that clears replacement cost. A level
    // held by those is discovered; a level held by this was asserted. Measured
    // before removal (counterfactual X1, 4 worlds x 50 years): taking away its
    // downward pull moved nothing, because the shortage slope was so slow that
    // rent never reached it — once the queue bids, it would have been the
    // ceiling. `dev` is still computed: the cycle-lift gate and the
    // cheap-rent CPI carry read it.
    void belowFloor; void sustain;
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
    const cheapFloor = dev < 0 ? clamp(-dev / 0.30, 0, 0.75) : 0;
    // RAIL-BOUND ESCALATOR. Soft markets already refuse full CPI in asking.
    // On/near the frictional rail, firmW=1 (gap≤0) used to keep full inflExp
    // forever on practically saturated availability. In-place leases keep
    // escalating in leasing.ts; the asking index carries only a lease-roll
    // fraction of CPI — more if rent is already cheap against pay.
    // On the rail at/above the RTI floor: lease-roll fraction of CPI only.
    // Below the floor: track the price level (and a bit more) so the floor is
    // reachable against rising wages; once restored, the mute returns.
    const underFloor = belowFloor < 0 ? clamp(-belowFloor / 0.25, 0, 1) : 0;
    // RETIRED (2026-10-08): the rail escalator. Asking carried 35% of CPI on
    // or near the frictional floor, which made a tight market the one place
    // where a dollar's falling value was NOT passed on — real asking fell in
    // a shortage. A firm market passes on the price level in full (it is the
    // soft market that cannot, and `softW` above already says so). The level
    // risk this guarded against is the income anchor's job.
    void underFloor;
    const railEscal = 1;
    const escalGate = Math.max(firmW, cheapFloor) * railEscal;
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
    const hRent = e.history.length >= 12 ? e.history[e.history.length - 12] : undefined;
    const realised12 = hRent?.cpi ? (e.cpi ?? 1) / hRent.cpi - 1 : (e.inflExp ?? 0.02);
    const escalation = (realised12 / 12) * escalGate;
    // Cap the lagged pressure term: chronic shortage was holding ~+1.6%/mo of
    // scarcity in rentPress and overpowering the income anchor for a decade.
    const press = e.rentPress[k];
    const clampBound = pressEma <= -0.03 + 1e-12;
    // Phase / job / sector sentiment must not LIFT asking while soft, on/near
    // the frictional rail, or once rent is already near earned pay. Soft:
    // empty floors on the shelf. Rail-bound: availability is saturated (same
    // reason tightEma refuses to mint Manhattan from "can't build"). Near
    // parity: further weather lift is what made every sim compound ~1.4%+
    // real on top of CPI — cycle may help a CHEAP market recover, not keep
    // marking up a clearing one. Growing unmet demand still prices through
    // scarcity → rentPress. Negative cycle terms still cut in every state.
    const liftGate = (railBound || softW > 0 || dev > -0.08) ? 0 : 1;
    // The label's own rent drift (+0.37%/mo in an "expansion", -0.47% in a
    // "recession") is gone: the jobs behind the label are already in
    // `cycleJobs`, and the vacancy they leave behind in `vacTerm`.
    const cycleRent = 0;
    const cycleJobs = jobDrift * 0.28 * (jobDrift > 0 ? liftGate : 1);
    const cycleMom = e.sectorMom[k] * 0.42 * (e.sectorMom[k] > 0 ? liftGate : 1);
    const drift = cycleRent + cycleMom + press + anchor + cycleJobs + escalation;
    // THE HALF-OF-BASE FLOOR IS NOW A GUARD AGAIN, WHICH IS ALL IT WAS EVER
    // MEANT TO BE. It used to be load-bearing and it used to be the reason the
    // amplitude above looked survivable: removing it took office peak-to-trough
    // from 12.5x to 94x, and it bound 9.5% of all months with 16 of 17 careers
    // touching it — a rail holding up the model. Measured after the sublet
    // channel: it binds 0.0% of months in every class over 6 seeds x 50 years,
    // and deleting it entirely reproduces every statistic in this file to the
    // digit. Left in place because a guard that never fires is a guard.
    const beforeRent = e.rentIdx[k];
    e.rentIdx[k] = Math.max(RENT_BASE[k] * 0.5, e.rentIdx[k] * (1 + drift + rrange(s, -vol, vol)));
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

  // cap rates: class base, dragged by the loan index and the cycle, and gapped
  // out when nobody will lend — a credit crunch reprices everything at once
  //
  // ...AND BY THE MONEY CHASING LAST YEAR'S WINNER. Before this term the class
  // bases were constants, so a class could out-earn the others indefinitely
  // and nothing ever repriced it. Measured: office took the highest rent
  // growth AND the highest yield on every seed — a 3-4 point crude-return
  // spread held for fifty years, and every player learned the same lesson:
  // only build office. No real market permits that, because allocators chase
  // trailing returns: money floods the winning class, bids its prices up,
  // compresses its cap, and keeps arriving until its forward return no longer
  // beats the field (industrial under a 4-cap by 2021 is the textbook case).
  // The flows term below is that mechanism: each class's trailing realized
  // return, EMA'd over ~4 years because institutional allocation moves on
  // committee time, measured RELATIVE to the four-class mean so flows shuffle
  // capital between classes without moving the overall level of yields.
  {
    const h12 = e.history.length >= 12 ? e.history[e.history.length - 12] : undefined;
    if (!e.retExp) e.retExp = { ...e.capRate };
    for (const k of BUILT_CLASSES) {
      const then = h12?.rent?.[k];
      const g12 = then && then > 0 ? (e.rentIdx[k] / then - 1) * 100 : 0;
      e.retExp[k] += 0.021 * ((g12 + e.capRate[k]) - e.retExp[k]);
    }
  }
  // THE INFLATION INSIDE A NOMINAL RATE IS ALSO INSIDE NEXT YEAR'S RENT.
  //
  // This term read the NOMINAL loan index, at 0.55 of cap per point. Measured
  // over eight procedural cities x 100 years (`pnpm capvsrate`, Sep 2026):
  // with the index above 10% the office cap sat ON the 11% ceiling in the
  // median month, and the ceiling bound in 17.4% of ALL months (multifamily
  // 7.7%) — because a Great Inflation puts the index at 12-16 and
  // 0.55 x (14 - 5.4) asks for a 13% cap. The real record refused that every
  // time it was asked: in 1981 the ten-year was 14% and office traded at
  // 9-10; in 1978 it was 8.4% against caps of 8.5; through the whole of
  // 1979-84 the spread of property yields over the ten-year was NEGATIVE, by
  // as much as four points. A building is a real asset: its yield is a real
  // rate plus a risk premium less growth, and when the public expects 8%
  // inflation it expects 8% on the rent too, so the buyer capitalises against
  // the index LESS that expectation.
  //
  // AND THE PASS-THROUGH IS ONE-SIDED, because rents are sticky downward. A
  // lease carries a fixed 2-3% annual bump whatever the CPI does — which is
  // why US rent growth never turned negative through 2010-15 at 1.5%
  // inflation, and why office traded at 6.5-7% on a 2% ten-year then, not
  // the 7.5-8% a symmetric real-rate model would ask for. The growth a buyer
  // underwrites is floored at the contractual bump, so expected inflation
  // enters only ABOVE the 2% target it is anchored to; at or under it this is
  // exactly the nominal expression it replaces, and the modern-era
  // calibration (office ~6.7 at a 2% index in a functioning market, 8.5 at
  // 5.4) does not move by a basis point. Only the inflation eras move, and
  // they move to where they were. Measured in cheap money the engine's own
  // `inflExp` sits at ZERO in the median month, so the symmetric form was
  // tried and rejected: it lifted every cheap-money cap by about a point,
  // against the record. `inflExp` rather than realised inflation because a
  // bond yield embeds what people EXPECT, and the engine already models
  // expectations coming unanchored — which is exactly when this matters.
  // Measured after: office on the ceiling 17.4% → 4.5% of months, multifamily
  // 7.7% → 0.5%; what still touches it is a Volcker with a 7.6% REAL policy
  // rate, which is the bank's number to answer for. Full table in ECONOMY.md.
  const inflOver = inflationOverBumpPct(e);
  const capIndex = e.indexRate - inflOver;
  for (const k of BUILT_CLASSES) {
    // A sector in favour reprices harder than it used to: capital rotating
    // into a class is most of what moves its cap rate, and at 14x a full
    // sector cycle was worth under two-tenths of a point.
    const sector = -30 * e.sectorMom[k];
    // Asymmetric on purpose. Compression floors out at 60bp — nobody
    // underwrites a shortage lasting forever — while a glut has much further
    // to run, because a buyer staring at empty floors is pricing the years it
    // takes to fill them.
    // ...and they TRACK the cost of debt, at about half a point of cap for a
    // point of rate net of above-target inflation (see above), which is what
    // the real relationship looks like. At 0.38 the spread between yield and
    // borrowing cost barely moved across a century of rates, so the
    // fix-or-float decision and the timing of a levered purchase were both
    // weather rather than judgement. At 0.55 a rate spike genuinely flips
    // leverage negative and a rate collapse genuinely makes it free — which
    // is the trade the player is supposed to be reading.
    // Half a point of cap per point of trailing excess return, bracketed at
    // +/-1.1 as a guard: the historical spread between the most- and
    // least-favoured class's cap moved about two points across an allocation
    // cycle (office vs industrial, 2007 to 2021), and this term's full swing
    // matches that without ever being the largest term in the sum.
    const flows = capFlowsOf(e.retExp!, k);
    const target = capTargetOf(e, k, capIndex, sector, flows);
    e.capRate[k] = clamp(e.capRate[k] + 0.1 * (target - e.capRate[k]) + rrange(s, -0.045, 0.045), CAP_RAIL.lo, CAP_RAIL.hi);
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
  const costLevel = Math.max(0.35, e.costIdx ?? 1);
  const vacDisc = 1 - 1.2 * Math.max(0, (e.cityVac?.office ?? NATURAL_VAC.office) - NATURAL_VAC.office);
  // Homogeneous of degree 0 under a pure nominal scale: rent and cost both ×λ
  // leave the ratio unchanged. The old cost^0.35 form grew as λ^0.75 under
  // inflation alone, so a century of ordinary CPI pinned the landIdx rail at
  // 40 even before real rents overheated — a load-bearing clamp, which is a
  // fake (CLAUDE.md). The residual is rent against construction cost.
  const target = Math.pow(rentLevel / costLevel, 1.15) * (1 + 0.16 * e.cycleDev) * Math.max(0.25, vacDisc);
  e.landIdx = clamp(e.landIdx + 0.024 * (target - e.landIdx) + e.landIdx * rrange(s, -0.003, 0.003), 0.05, 80);

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
    // ONE SLOPE (2026-10-09). This was 0.0026 below full employment and 0.0016
    // above, each set so its own extreme hit an ENR figure. Two gains on one
    // signal make the MEAN of an oscillating utilisation a drift: a market
    // that is as often 10% idle as 10% booked lost real cost every year for
    // that reason alone. The midpoint keeps the extremes in the record's range
    // (-4.8%/yr real at the idle floor, +7.8%/yr at the ceiling — 2009-10 and
    // 2021-22) and puts zero drift where utilisation averages one.
    const slope = 0.0021;
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
    // cheaper. `heat` stays the premium for how busy the trades are.
    const LABOUR_SHARE = 0.45;
    const cpiNow = Math.max(0.35, e.cpi ?? 1), wageNow = Math.max(0.1, e.wageIdx ?? 1);
    const prevIn = e.costInputsPrev;
    const inputGrowth = prevIn
      ? (1 - LABOUR_SHARE) * (cpiNow / prevIn.cpi - 1) + LABOUR_SHARE * (wageNow / prevIn.wage - 1)
      : (e.inflExp ?? 0.02) / 12;
    e.costInputsPrev = { cpi: cpiNow, wage: wageNow };
    // The recession term (-0.0004/mo whenever the label read recession) is
    // gone: an idle trade is already in `heat`, and a label is not a cost.
    const costDrift = inputGrowth + heat * slope;
    // RETIRED (2026-10-08): the office-rent catch-up. This pulled the cost
    // index toward the OFFICE asking level whenever rents ran a quarter ahead
    // of it, for every class — flats and sheds priced their concrete off
    // office quotes. Nothing in the world does that: a contractor's bid is
    // materials, labour and how busy the trades are, which is `costDrift`
    // above (inflation plus `heat`, the share of the city under
    // construction). Measured over four 50-year worlds it fired in 22-63% of
    // months, and it fired exactly when a shortage lifted rents — so the
    // margin a shortage should open for builders was handed to the cost
    // index instead, the residual stayed flat, and the class stayed on its
    // vacancy floor. When rents outrun cost now, the residual rises, land
    // pencils, cranes go up, and THEN the trades get dear through `heat`.
    const catchUp = 0;
    // RETIRED (2026-10-09): the "fair real cost" path. Real cost was pulled
    // toward an asserted 1.004^years whenever it strayed 20-25% off it — a
    // number written down rather than discovered, and load-bearing: its floor
    // push was active in 41-89% of all months over 8 cities x 50 years,
    // propping up a cost index that the maintenance-load bug in `tickCrews`
    // was dragging down. Cost is now its inputs (CPI and wages, at the labour
    // share) plus how booked the trades are, and nothing else.
    const realPull = 0;
    e.costIdx = clamp(
      e.costIdx * (1 + costDrift + catchUp + realPull + rrange(s, -0.0012, 0.0012)),
      0.6, 400,
    );
  }

  recordHistory(e, s.month, monthAbs, monthComp);

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
          `A broker on the street: office vacancy is ${dpp.toFixed(1)} points higher than a year ago. `
          + `When that happens, real rents are usually lower three years out — not a prophecy, a confirmation. `
          + `You are already past the top; about a third of the fall is typically still ahead.`);
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
    natUnemp: e.nat?.unemp !== undefined ? +e.nat.unemp.toFixed(4) : undefined,
    wageIdx: e.wageIdx !== undefined ? +e.wageIdx.toFixed(4) : undefined,
    natWageIdx: e.natWageIdx !== undefined ? +e.natWageIdx.toFixed(4) : undefined,
    natCpi: e.natCpi !== undefined ? +e.natCpi.toFixed(4) : undefined,
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
