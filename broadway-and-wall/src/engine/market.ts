// The market: mean-reverting rate walk, rate-linked cap rates, cyclical
// rents, and a phase machine whose turns are rumored before they land.
// Randomness creates situations, never verdicts.
import type { ParcelTable } from "@/data/types";
import type { BuiltClass, Econ, GameState, MarketPhase, NewsItem, Sector } from "./types";
import { BUILT_CLASSES } from "./types";
import { applyEra, driftInflTarget } from "./regime";

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
  const mom = e.industryMom?.[k] ?? 0;
  return clamp(-mom / 0.03, 0, 1);
}

/** …and how hard it is hiring, which is who walks through the door. */
export function industryPull(e: Econ, k: Sector): number {
  const mom = e.industryMom?.[k] ?? 0;
  return clamp(1 + mom * 22, 0.35, 1.9);
}

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
export function devPencils(e: Econ, k: BuiltClass = "office"): number {
  const rentIdx = e.rentIdx?.[k] ?? RENT_BASE[k];
  const underwritten = rentIdx / RENT_BASE[k];
  const required = (e.rateEma ?? e.indexRate) / 100 + DEV_SPREAD;
  const yoc = BASE_YOC * (underwritten / Math.max(0.2, e.costIdx));
  // Expressed as a multiplier on appetite rather than a hard gate, because a
  // developer with a site and a conviction still builds into a thin margin —
  // he just does it less often, and a negative margin stops him dead.
  return clamp((yoc / required - 1) * 3.2 + 0.55, 0, 2.2);
}

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
export const RENT_BASE = { office: 43.65, retail: 42.91, multifamily: 30.22, industrial: 18.00 } as const; // $/sf/yr
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

export function initEcon(s: GameState, parcels?: ParcelTable): Econ {
  const CITY = parcels ? stockFromParcels(parcels) : { ...CITY_STOCK };
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
    for (const bbl in parcels) {
      const r = parcels[bbl];
      if (!r || r.class === "land" || !r.bldgArea) continue;
      const idx = Math.pow(Math.max(0, r.demandScore) / 100, 1 / 1.9);
      const vin = Math.min(1.7, Math.max(0.5, 0.5 + Math.max(0, 2000 - (r.yearBuilt || 1960)) / 80));
      wSum += r.bldgArea; dSum += r.bldgArea * idx; vSum += r.bldgArea * vin;
      wBy[r.class] = (wBy[r.class] ?? 0) + r.bldgArea;
      dBy[r.class] = (dBy[r.class] ?? 0) + r.bldgArea * idx;
    }
    econ.locIdxMean = wSum > 0 ? +(dSum / wSum).toFixed(4) : 0.62;
    econ.vintageMean = wSum > 0 ? +(vSum / wSum).toFixed(4) : 1.0;
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
  econ.rentExp = { ...econ.rentIdx };
  // THE CITY HAS PEOPLE IN IT ON DAY ONE. These were seeded lazily inside the
  // monthly tick, so between newGame and the first advanceQuarter the economy
  // reported a population of `undefined` — which the stress harness caught as
  // a NaN in the year-zero column of the null-player table, and which anything
  // reading population before the first tick would have inherited.
  econ.population = 240_000; econ.jobs = 132_000; econ.unemployment = 0.052;
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
  const spacePull = costOfSpace <= 1
    ? clamp((1 - costOfSpace) * 0.0022, 0, 0.0016) * slack
    : Math.max(-0.0035, -(overCost * 0.0012 + overCost * overCost * 0.0016));
  // A national recession costs this city jobs whether or not the local property
  // cycle has caught up to it yet — payrolls are cut at head office.
  const natPull = (e.nat?.recM ?? 0) > 0 ? (e.nat?.deep ? -0.0026 : -0.0013) : 0.0002;
  e.employIdx = clamp(
    e.employIdx * (1 + jobDrift + spacePull + natPull + rrange(s, -0.0012, 0.0012)), 0.55, 12);

  // --- THE CITY UNDERNEATH THE PROPERTY MARKET -------------------------------
  //
  // Everything above this line is a property cycle. This is the economy it sits
  // on, and every number here is a consequence of the employment index rather
  // than a second simulation running beside it: the point is legibility, not
  // more dice. What it buys is the question every real investor asks first and
  // this game could not answer — is this town growing?
  {
    if (e.population === undefined) {
      e.population = 240_000; e.jobs = 132_000; e.unemployment = 0.052;
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
    e.jobs = Math.round(132_000 * e.employIdx * (1 - CONSTRUCTION_JOB_SHARE + trades));
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
    const labourForce = e.population! * 0.58;
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
    const migration = jobGrowth * pull - clamp(uGapPop * 0.020, -0.0010, 0.0030);
    e.population = Math.round(clamp(e.population! * (1 + 0.00016 + migration), 60_000, 4_000_000));

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
    e.outputIdx = +((e.jobs / 132_000) * e.wageIdx!).toFixed(4);
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
  {
    const tightNow = (NATURAL_VAC.office - (e.cityVac?.office ?? NATURAL_VAC.office)) / NATURAL_VAC.office;
    e.tightEma = (e.tightEma ?? 0) + 0.004 * (tightNow - (e.tightEma ?? 0));
  }

  const unmet: Record<string, number> = {};
  for (const k of BUILT_CLASSES) {
    const stk = e.stock?.[k] ?? CITY_STOCK[k];
    const vacNow = e.cityVac?.[k] ?? NATURAL_VAC[k];
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
    const affordRaw = Math.pow(
      (e.rentIdx[k] / RENT_BASE[k]) / Math.max(0.35, e.wageIdx ?? 1),
      k === "multifamily" ? -0.50 : -0.40,
    );
    if (!e.affordEff) e.affordEff = { office: 1, retail: 1, multifamily: 1, industrial: 1 };
    e.affordEff[k] += 0.010 * (affordRaw - e.affordEff[k]);

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
    // once moving costs are counted; the pace, a tenth of the overshoot a
    // year, is slow enough that a cyclical spike does nothing and a
    // generation of pressure does most of it. Both are shape parameters and
    // both are stated as such.
    //
    // HOUSING IS EXEMPT and that is not a special case, it is the mechanism
    // being right: people priced out of a city's housing leave, and the
    // housing does not. The building stays and somebody poorer or somebody
    // richer lives in it. Demand for shelter in a place is not a footprint
    // that can relocate.
    if (k !== "multifamily") {
      const RELOCATE_AT = 1.20;    // a fifth above its historical rent-to-income
      const LEAVE_RATE = 0.10;     // of the overshoot, per year
      const burden = (e.rentIdx[k] / RENT_BASE[k]) / Math.max(0.35, e.wageIdx ?? 1);
      const over = Math.max(0, burden - RELOCATE_AT);
      if (over > 0 && e.baseStock) {
        const shed = 1 - (LEAVE_RATE * over) / 12;
        e.baseStock[k] = Math.min(e.baseStock[k], e.baseStock[k] * shed);
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
    const pop0 = 240_000;   // the opening population, so popIdx opens at exactly 1
    const popIdx = (e.population ?? pop0) / pop0;
    const driver = k === "multifamily" ? popIdx
      : k === "retail" ? Math.pow(popIdx, 0.68) * Math.pow(e.employIdx, 0.32)
      : e.employIdx;
    const targetRaw = (e.baseStock?.[k] ?? CITY_STOCK[k]) * (1 - NATURAL_VAC[k])
      * Math.pow(driver, elastic)
      * (1 + e.sectorMom[k] * 11)
      * e.affordEff[k];
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
    unmet[k] = Math.max(0, (e.pool[k] - e.occupied[k]) / Math.max(1, e.stock[k]));
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
    e.cityVac[k] = clamp(1 - e.occupied[k] / e.stock[k], friction, 0.45);
    e.absorb12[k] = e.absorb12[k] * (11 / 12) + absorb;
    monthAbs[k] = absorb;
    monthComp[k] = delivered;
  }

  // RENTS MOVE ON VACANCY. The gap between where vacancy sits and its natural
  // rate is the whole of the landlord-tenant power balance: five points of
  // excess vacancy grinds rents down about three per cent a year until either
  // demand absorbs it or nothing new gets built; five points of shortage does
  // the opposite. Phase drift and sector momentum ride on top as sentiment.
  for (const k of BUILT_CLASSES) {
    const vol = k === "multifamily" ? 0.002 : k === "office" ? 0.004 : k === "industrial" ? 0.0024 : 0.003;
    const gap = (e.cityVac?.[k] ?? NATURAL_VAC[k]) - NATURAL_VAC[k];
    // The vacancy gap has to be able to OVERPOWER the cycle's sentiment, or a
    // glut politely coexists with rising rents forever. Six points of excess
    // vacancy now takes rents down about five per cent a year, which is what a
    // real oversupply does.
    // STICKY ASKING, MOVING EFFECTIVE (ECONOMY.md). A shortage pushes asking
    // up immediately; cuts ramp in only after the landlord has stared at the
    // empty floor for half a year — the capitulation clock. Meanwhile the
    // concession dial moves in months, so what deals actually sign at falls
    // long before the face rate admits anything.
    if (!e.vacOverM) e.vacOverM = { office: 0, retail: 0, multifamily: 0, industrial: 0 };
    if (!e.concIdx) e.concIdx = { office: 0, retail: 0, multifamily: 0, industrial: 0 };
    if (!e.effRentIdx) e.effRentIdx = { ...e.rentIdx };
    e.vacOverM[k] = gap > 0.015 ? (e.vacOverM[k] ?? 0) + 1 : 0;
    const phaseNudge = e.phase === "recession" ? 0.22 : e.phase === "recovery" ? 0.08 : e.phase === "peak" ? -0.04 : -0.10;
    const concTarget = clamp(gap * 11 + phaseNudge, 0, 1);
    e.concIdx[k] += 0.25 * (concTarget - e.concIdx[k]);
    // EMPTY SPACE IS NEVER FREE. This term was capped at -0.9%/month, so at
    // ten points over natural it saturated and EVERY FURTHER POINT OF VACANCY
    // COST NOTHING — a 45% glut was priced exactly like a 20% one, which is
    // most of why rents went flat at $31 through a depression instead of
    // collapsing. Superlinear now: the second ten points hurt more than the
    // first ten, the way a real capitulation works.
    const vacTerm = gap <= 0
      ? clamp(-gap * 0.090, 0, 0.009)
      : -(gap * 0.070 + gap * gap * 0.85) * Math.min(1, (e.vacOverM[k] ?? 0) / 6);
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
    const HEAT_PIVOT = 0.0124;
    const heat = clamp(((e.buildEma ?? HEAT_PIVOT) - HEAT_PIVOT) * 110, -1.9, 1.6);
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
