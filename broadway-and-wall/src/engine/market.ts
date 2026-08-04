// The market: mean-reverting rate walk, rate-linked cap rates, cyclical
// rents, and a phase machine whose turns are rumored before they land.
// Randomness creates situations, never verdicts.
import type { ParcelTable } from "@/data/types";
import type { BuiltClass, Econ, GameState, MarketPhase, NewsItem, Sector } from "./types";
import { BUILT_CLASSES } from "./types";

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
const RATE_FLOOR = 1.9, RATE_CEIL = 15.5;

// Each rebased DOWN by the average value of the new vacancy term below, so
// CAP_BASE keeps meaning "the class's long-run average cap" rather than "its
// cap at natural vacancy, which this city rarely sits at". Without the rebase
// an uncentred risk term silently widens every cap by 15-30bp forever.
export const CAP_BASE = { office: 5.30, retail: 5.91, multifamily: 4.76, industrial: 6.74 } as const;

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
  for (const k of BUILT_CLASSES) out[k] = Math.max(1_200_000, Math.round(out[k]));
  return out;
}
export const SECTOR_LABEL = { office: "Office", retail: "Retail", multifamily: "Apartments", industrial: "Industrial" } as const;
export const RENT_BASE = { office: 62, retail: 88, multifamily: 46, industrial: 16 } as const; // $/sf/yr
// The natural (frictional) vacancy per class — the rate at which neither side
// of the table has the upper hand. Below it landlords push rents; above it
// tenants extract concessions. Office runs structurally looser than housing.
export const NATURAL_VAC = { office: 0.115, retail: 0.085, multifamily: 0.045, industrial: 0.07 } as const;
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
  econ.concIdx = { office: 0, retail: 0, multifamily: 0, industrial: 0 };
  econ.vacOverM = { office: 0, retail: 0, multifamily: 0, industrial: 0 };
  econ.effRentIdx = { ...econ.rentIdx };
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

  // THE POLICY RATE IS A DECISION, NOT A LOOKUP.
  //
  // This was `rateRegime + PHASE_CFG[phase].rateGap` — the rate was a constant
  // per phase label. Which meant that when the owner cheated $10B, flooded the
  // city and drove vacancy to 45%, the phase clock kept saying "expansion" and
  // the loan index therefore ROSE (+0.35) into the worst property depression
  // the city had ever seen. The rate machinery could not see the glut because
  // nothing in it was looking at the economy.
  //
  // A central bank reads two numbers: how far inflation is from target, and
  // how far unemployment is from full employment. It leans hard against the
  // first (more than one-for-one, or inflation is self-fulfilling) and cuts
  // into the second. The monetary ERA is still the neutral level it leans
  // around — that is the thing that makes a loan struck in one decade a
  // different animal in the next — but the cycle in the rate is now EARNED by
  // the economy rather than stamped on by a label. A glut destroys jobs, which
  // cuts rates, which is the refinancing window the survivors live on.
  const uGap = (e.unemployment ?? 0.055) - 0.055;
  const taylor = e.rateRegime
    + 140 * ((e.inflExp ?? 0.02) - 0.02)     // 1.4x on the inflation gap, in points
    - 110 * uGap;                            // and a point of slack is a point of cut
  e.indexRate = clamp(
    e.indexRate + 0.075 * (taylor - e.indexRate) + rrange(s, -0.13, 0.13),
    RATE_FLOOR, RATE_CEIL,
  );

  // cycle deviation drifts with phase, spring-loaded toward its bounds
  e.cycleDev = clamp(e.cycleDev + c2.devDrift + rrange(s, -0.03, 0.03), -1, 1);

  // --- capital availability -------------------------------------------------
  // Money is not a smooth function of the policy rate. It leaves the room in a
  // downturn and comes back late, and that lag is where the bargains are.
  const creditTarget = e.phase === "expansion" ? 1.12 : e.phase === "peak" ? 1.0
    : e.phase === "recession" ? 0.54 : 0.88;
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
  const spacePull = clamp((1 - costOfSpace) * 0.0022, -0.0013, 0.0016);
  e.employIdx = clamp(e.employIdx * (1 + jobDrift + spacePull + rrange(s, -0.0012, 0.0012)), 0.55, 12);

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
    // Jobs track the employment index directly — that IS the employment index,
    // expressed as people rather than as a number between nought and twelve.
    e.jobs = Math.round(132_000 * e.employIdx);
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
    const inflM = e.inflExp / 12 + tight * 0.021 + 0.16 * (cost12 - e.inflExp) / 12;
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
    const PRODUCTIVITY = 0.011;    // ~1.1%/yr real, the long-run US figure
    e.wageIdx = clamp(
      e.wageIdx! * (1 + e.inflExp / 12 + PRODUCTIVITY / 12 + tight * 0.012 + rrange(s, -0.0004, 0.0004)),
      0.7, 400,
    );

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
    const margin = underwritten / e.costIdx - 1;         // profit signal, as BELIEVED
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
    const targetRaw = (e.baseStock?.[k] ?? CITY_STOCK[k]) * (1 - NATURAL_VAC[k])
      * Math.pow(e.employIdx, elastic)
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
    const sustain = 1 + 0.80 * clamp(e.tightEma ?? 0, -0.30, 0.55);
    const dev = rentToIncome / sustain - 1;
    const anchor = dev > 0
      ? -0.0080 * Math.min(1.6, dev)          // outrunning incomes: pulled down hard
      : -0.0028 * Math.max(-0.65, dev);       // cheap against incomes: drifts back up

    const drift = c2.rentDrift * 0.55 + e.sectorMom[k] * 0.42 + vacTerm + scarcity + anchor + (jobDrift * 0.35);
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
    const target = CAP_BASE[k] + 0.38 * (e.indexRate - 5.4) - 0.25 * e.cycleDev + crunch + sector + vacRisk;
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
    const heat = clamp(((e.buildEma ?? 0.014) - 0.014) * 110, -0.8, 1.6);
    const costDrift = (e.inflExp ?? 0.02) / 12 + heat * 0.0016 + (e.phase === "recession" ? -0.0004 : 0);
    e.costIdx = clamp(e.costIdx * (1 + costDrift + rrange(s, -0.0012, 0.0012)), 0.6, 400);
  }

  recordHistory(e, s.month, monthAbs, monthComp);
}

/** Add real square feet to the citywide stock — a delivered building is supply. */
export function addStock(e: Econ, k: keyof typeof CITY_STOCK, sf: number) {
  if (!e.stock) e.stock = { ...CITY_STOCK };
  e.stock[k] = (e.stock[k] ?? CITY_STOCK[k]) + Math.max(0, sf);
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
