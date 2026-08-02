// The market: mean-reverting rate walk, rate-linked cap rates, cyclical
// rents, and a phase machine whose turns are rumored before they land.
// Randomness creates situations, never verdicts.
import type { Econ, GameState, MarketPhase, NewsItem } from "./types";
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

export const CAP_BASE = { office: 5.6, retail: 6.1, multifamily: 4.9, industrial: 6.9 } as const;
// Rough citywide inventory by class, in sf — the denominator that turns other
// people's construction into a rent effect you can feel.
export const CITY_STOCK = { office: 30e6, retail: 15e6, multifamily: 35e6, industrial: 14e6 } as const;
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

export function initEcon(s: GameState): Econ {
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
    stock: { ...CITY_STOCK },
    occupied: {
      office: CITY_STOCK.office * (1 - NATURAL_VAC.office),
      retail: CITY_STOCK.retail * (1 - NATURAL_VAC.retail),
      multifamily: CITY_STOCK.multifamily * (1 - NATURAL_VAC.multifamily),
      industrial: CITY_STOCK.industrial * (1 - NATURAL_VAC.industrial),
    },
    cityVac: { ...NATURAL_VAC },
    absorb12: { office: 0, retail: 0, multifamily: 0, industrial: 0 },
    cohorts: { office: [], retail: [], multifamily: [], industrial: [] },
    completions12: { office: 0, retail: 0, multifamily: 0, industrial: 0 },
    history: [],
  };
  econ.phaseMLeft = Math.round(12 + 30 * rng(s));
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
  const e = s.econ;
  const cfg = PHASE_CFG[e.phase];

  // phase machine with rumors one or two quarters ahead of the turn
  e.phaseMLeft--;
  if (e.phaseMLeft <= 6 && !e.rumoredPhase && rng(s) < 0.25) {
    e.rumoredPhase = cfg.next;
    pushNews(s, "rumor", RUMORS[cfg.next][Math.floor(rng(s) * RUMORS[cfg.next].length)]);
  }
  if (e.phaseMLeft <= 0) {
    e.phase = cfg.next;
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

  // loan index: the era, plus where the cycle sits against it. Reversion is
  // fast enough (half-life about nine months) that the cycle is legible in the
  // rate, which at 0.03 it never was.
  e.indexRate = clamp(
    e.indexRate + 0.075 * (e.rateRegime + c2.rateGap - e.indexRate) + rrange(s, -0.13, 0.13),
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
  e.employIdx = clamp(e.employIdx * (1 + jobDrift + rrange(s, -0.0012, 0.0012)), 0.55, 12);

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
  const unmet: Record<string, number> = {};
  for (const k of BUILT_CLASSES) {
    const stk = e.stock?.[k] ?? CITY_STOCK[k];
    const vacNow = e.cityVac?.[k] ?? NATURAL_VAC[k];
    const margin = (e.rentIdx[k] / RENT_BASE[k]) / e.costIdx - 1;         // profit signal
    // Nobody starts a building into a glut, whatever the pro forma says —
    // vacancy above natural chokes starts long before the margin math does.
    // The shortage signal has to be strong enough to actually pull supply
    // through. Housing gets the sharpest response of the four, because a
    // housing shortage is the most profitable thing that can happen to a
    // builder and the model should behave like builders notice.
    const gain = k === "multifamily" ? 11 : 7;
    const ceiling = k === "multifamily" ? 2.3 : 1.7;
    const vacGate = clamp(1 - gain * (vacNow - NATURAL_VAC[k]), 0.08, ceiling);
    const appetite = Math.max(0, margin + 0.06 * e.cycleDev) * e.creditIdx * vacGate;
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
    if (start > 1) e.cohorts[k].push({ m: s.month + bLo + Math.round(rng(s) * (bHi - bLo)), sf: Math.round(start) });
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
    const affordability = Math.pow(
      (e.rentIdx[k] / RENT_BASE[k]) / Math.max(0.35, e.employIdx),
      k === "multifamily" ? -0.62 : -0.58,
    );
    const target = CITY_STOCK[k] * (1 - NATURAL_VAC[k])
      * Math.pow(e.employIdx, elastic)
      // Sector coupling was calibrated against a sectorMom that never left
      // +/-0.002; now that the class cycles actually reach their level, 26x
      // turned every boom into a demand shock that ran occupancy into the
      // frictional floor and held it there. 11x is still a big sector cycle —
      // a boom moves the space a class wants by about a seventh — but supply
      // and price get a chance to answer it.
      * (1 + e.sectorMom[k] * 11)
      * affordability;
    const absorb = clamp(0.05 * (target - e.occupied[k]), -0.005 * e.stock[k], 0.007 * e.stock[k])
      + e.stock[k] * rrange(s, -0.0006, 0.0006);
    unmet[k] = Math.max(0, (target - e.occupied[k]) / Math.max(1, e.stock[k]));
    // FRICTIONAL VACANCY IS A FLOOR, and it is not zero. Some share of every
    // market is empty purely because tenants are moving in and out of it —
    // roughly a third of the natural rate. A flat half-a-percent clamp was a
    // numerical guard pretending to be economics; this is the real thing, and
    // it differs by class because moving costs differ by class.
    const friction = NATURAL_VAC[k] * 0.32;
    e.occupied[k] = clamp(e.occupied[k] + absorb, e.stock[k] * 0.55, e.stock[k] * (1 - friction));
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
    const vacTerm = clamp(-gap * 0.090, -0.009, 0.009);
    const scarcity = clamp((unmet[k] ?? 0) * 0.078, 0, 0.013);
    const drift = c2.rentDrift * 0.55 + e.sectorMom[k] * 0.42 + vacTerm + scarcity + (jobDrift * 0.35);
    e.rentIdx[k] = Math.max(RENT_BASE[k] * 0.5, e.rentIdx[k] * (1 + drift + rrange(s, -vol, vol)));
  }

  // cap rates: class base, dragged by the loan index and the cycle, and gapped
  // out when nobody will lend — a credit crunch reprices everything at once
  for (const k of BUILT_CLASSES) {
    const crunch = 1.6 * Math.max(0, 1 - e.creditIdx);
    // A sector in favour reprices harder than it used to: capital rotating
    // into a class is most of what moves its cap rate, and at 14x a full
    // sector cycle was worth under two-tenths of a point.
    const sector = -30 * e.sectorMom[k];
    const target = CAP_BASE[k] + 0.38 * (e.indexRate - 5.4) - 0.25 * e.cycleDev + crunch + sector;
    e.capRate[k] = clamp(e.capRate[k] + 0.1 * (target - e.capRate[k]) + rrange(s, -0.045, 0.045), 3.4, 11);
  }

  // Citywide land index TRACKS the rent level rather than compounding off it —
  // over a 100-year campaign a feedback term would run away into absurdity.
  // Land is levered to rents (exponent > 1) and moody with the cycle, but it
  // is always pulled back toward what the income actually supports.
  const rentLevel = e.rentIdx.office / RENT_BASE.office;
  const target = Math.pow(rentLevel, 1.15) * (1 + 0.16 * e.cycleDev);
  e.landIdx = clamp(e.landIdx + 0.024 * (target - e.landIdx) + e.landIdx * rrange(s, -0.003, 0.003), 0.3, 40);

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
  const costDrift = c2.rentDrift * 0.55 + (e.phase === "recession" ? 0.0005 : 0.0002);
  e.costIdx = clamp(e.costIdx * (1 + costDrift + rrange(s, -0.0015, 0.0015)), 0.6, 60);

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
    cycleDev: +e.cycleDev.toFixed(3),
    capOffice: +e.capRate.office.toFixed(2),
    rentOffice: +e.rentIdx.office.toFixed(2),
    creditIdx: +e.creditIdx.toFixed(3),
    employIdx: +e.employIdx.toFixed(3),
    vac: e.cityVac ? {
      office: +e.cityVac.office.toFixed(4), retail: +e.cityVac.retail.toFixed(4),
      multifamily: +e.cityVac.multifamily.toFixed(4), industrial: +e.cityVac.industrial.toFixed(4),
    } : undefined,
    rent: {
      office: +e.rentIdx.office.toFixed(2), retail: +e.rentIdx.retail.toFixed(2),
      multifamily: +e.rentIdx.multifamily.toFixed(2), industrial: +e.rentIdx.industrial.toFixed(2),
    },
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
