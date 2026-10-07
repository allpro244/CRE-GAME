/**
 * THE ECONOMY YOU WALK INTO HAS A PAST.
 *
 * Every game of this once opened on exactly the same board, and the first fix
 * was a table: five "eras" of American property history, one drawn per game,
 * each a box of ranges for inflation, policy, vacancy, rents and caps. That
 * was variety without a mechanism. The opening was an ARRANGEMENT of numbers
 * — inflation drawn from one range, the policy rate from another, so the
 * bank's first meetings spent two years walking a rate it would never have
 * set back to its own rule; and a player who had seen five openings had seen
 * all of them.
 *
 * So there is no table. The national model in market.ts (`tickNation`: the
 * business cycle, the Phillips curve, unanchored expectations, a central bank
 * that misjudges full employment, supply shocks that cluster, governments that
 * lean on the bank) runs for twenty to sixty years before month one, on a
 * private generator, from a neutral long-run state. The credit window runs
 * beside it on the same equation tickEcon uses (`stepCredit`). Whatever that
 * history produced — a bank still earning back its word after an inflation, a
 * labour market two years into a deep recession, a credit window that slammed
 * shut eighteen months ago and is reopening at its usual crawl — is where the
 * player stands. Nothing about it is named or shown; the player reads it off
 * the tape like everyone else.
 *
 * TWO RULES GOVERN THIS FILE.
 *
 * 1. THE OPENING IS AN OUTPUT. Every macro number the player inherits is
 *    state the engine's own equations left behind, and every number the city
 *    opens with is positioned FROM that state — never drawn beside it.
 *
 * 2. IT IS NOT A DIFFICULTY SETTING. A history that ends in a deep recession
 *    is cheap to buy into and impossible to borrow in; one that ends at the
 *    top of a long expansion is easy money with nothing worth owning. Neither
 *    is tuned to score like the other.
 *
 * WHY THE CITY IS NOT SIMULATED TOO. The city's space market is a function of
 * the map: its stock grows only when somebody builds on a real parcel, so a
 * city run for forty years with nobody developing it runs out of space
 * (measured: office vacancy pinned at 5.4% within ten years, against 11.5%
 * natural). So the city opens positioned on the nation's recent history —
 * vacancy on the last three years of unemployment, rents on that vacancy,
 * cap rates at the target tickEcon itself chases — and from month one the
 * full model runs both.
 */
import type { Econ, GameState, MarketPhase } from "./types";
import { mulberry32Step, initStreams, tickNation, stepCredit, capTargetOf, capFlowsOf, inflationOverBumpPct } from "./market";

/**
 * THIS DRAWS FROM ITS OWN GENERATOR. The engine has one shared PRNG for the
 * whole world, and anything that consumes it a different number of times
 * re-rolls the century — the payroll module learned this the expensive way
 * (see staff.ts). The pre-history runs once, before month one, and must not
 * shift the sequence the rest of the simulation is going to draw from.
 */
function rrng(seed: number, step: number): number {
  let st = (seed ^ 0x9e3779b9) | 0;
  for (let i = 0; i <= step; i++) st = mulberry32Step(st).state;
  return mulberry32Step(st).value;
}

/**
 * THE CAP-RATE RAIL, ONCE. The monthly walk in market.ts clamped cap rates to
 * 3.4..11 while the era opener clamped them to 3.2..14 — the same quantity
 * with two answers, and a dear-money era could open at 12.5% and slide to
 * 11.0% over its first months with nothing in the world having moved. Both
 * read this. Measured (30 seeds × 30 years) the ceiling binds 1% of months
 * in a long expansion, 3-4% in a disinflation or the morning after, 10% in a
 * Great Inflation, and the floor essentially never: a guard, not a rail,
 * except at the top of an inflation, which is where 1981's transaction caps
 * actually sat.
 */
export const CAP_RAIL = { lo: 3.4, hi: 11 } as const;

const pick = (r: number, lo: number, hi: number) => lo + r * (hi - lo);

/**
 * THE NATION'S CYCLE IN THE CITY'S VOCABULARY. Before month one there is no
 * city phase machine to consult — it reads the city's vacancy, and the city
 * has not opened — so the credit window in the pre-history reads the phase
 * the nation is in: in a recession (a deep one is a depression), recovering
 * for two years after, at the top once an expansion is past eight years with
 * the labour market tight, and otherwise expanding. Post-war US expansions
 * averaged about five years; eight is where they start being called old.
 */
export function nationPhase(n: NonNullable<Econ["nat"]>): MarketPhase {
  if ((n.recM ?? 0) > 0) return n.deep ? "depression" : "recession";
  const exp = n.expM ?? 0;
  if (exp < 24) return "recovery";
  if (exp > 96 && n.unemp < 0.048) return "peak";
  return "expansion";
}

export interface History {
  months: number;
  /** national unemployment, mean over the last 36 months */
  uTrail: number;
}

/**
 * RUN THE NATION FORWARD TO THE DAY THE PLAYER ARRIVES, and position the city
 * on it. Called from initEcon after the long-run baseline is laid down.
 *
 * Where the history STARTS is the model's own steady state: inflation at a 2%
 * target, unemployment at the 4.8% the rule calls full, policy where the rule
 * sits there. Two slow variables are drawn because nothing in a twenty-year
 * window would move them far enough to forget a fixed start: the neutral real
 * rate's anchor (anywhere inside the 0.4-3.2% band market.ts lets it wander —
 * Laubach-Williams puts r* near 3.5% in the 1960s and 0.5% after 2010) and how
 * far the public believes the bank (0.45-0.95; credibility is earned and
 * spent by the model from there). The length of the history is drawn too, so
 * the same start does not always arrive at the same point in its own cycle.
 */
export function simulateHistory(econ: Econ, seed: number, natural: Record<string, number>): History {
  let k = 0;
  const d = (lo: number, hi: number) => pick(rrng(seed, k++), lo, hi);
  const anchor = d(0.004, 0.032);
  const cred = d(0.45, 0.95);
  const months = Math.round(d(240, 720));
  const burnSeed = (seed ^ 0x6a09e667) >>> 0;
  const scratchEcon = {
    ...econ,
    nat: {
      infl: 0.02, inflExp: 0.02, inflSm: 0.02, unemp: 0.048, policy: +(100 * (anchor + 0.02)).toFixed(2),
      neutralReal: anchor, neutralAnchor: anchor, inflTarget: 0.02, credibility: cred,
      shockM: 0, shockSev: 0, recM: 0, expM: 60, deep: false, pressureM: 0,
    },
    creditIdx: 1, phase: "expansion" as MarketPhase, unemployment: 0.048,
  } as Econ;
  const streams = initStreams(burnSeed);
  const s = { econ: scratchEcon, seed: burnSeed, month: -months, streams, rng: streams.econ, news: [] } as unknown as GameState;
  const uHist: number[] = [];
  for (let m = -months; m < 0; m++) {
    s.month = m;
    // One city in a nation: in the pre-history its labour market IS the
    // nation's, so the 1% city pull inside tickNation is neutral.
    scratchEcon.unemployment = scratchEcon.nat!.unemp;
    tickNation(s);
    scratchEcon.phase = nationPhase(scratchEcon.nat!);
    stepCredit(s);
    uHist.push(scratchEcon.nat!.unemp);
    s.news.length = 0;
  }
  const n = scratchEcon.nat!;
  econ.nat = { ...n };
  econ.unemployment = n.unemp;
  econ.phase = scratchEcon.phase;
  econ.creditIdx = +scratchEcon.creditIdx.toFixed(3);
  econ.indexRate = scratchEcon.indexRate;
  econ.shortIndex = scratchEcon.shortIndex;
  econ.rateRegime = scratchEcon.rateRegime;
  econ.rateEma = econ.indexRate;
  const tail = uHist.slice(-36);
  const uTrail = tail.reduce((a, x) => a + x, 0) / Math.max(1, tail.length);

  // THE SPACE MARKET, ON THE LABOUR MARKET IT HAS BEEN LIVING THROUGH.
  // Vacancy lags employment by a year or two — tenants give space back at
  // their lease ends, not at the layoff — so it reads three years of national
  // unemployment, as a multiple of each class's own natural rate so a glut is
  // a glut everywhere. CALIBRATED, not tuned: the line runs through the five
  // historical openings this file used to draw from (unemployment / vacancy
  // as a multiple of natural): 1950s-60s 4.8% / 0.84, 1970s 6.7% / 1.00,
  // 1982 9.2% / 1.50, 1990s 6.0% / 1.23, 2010 8.4% / 1.40 — about fifteen
  // points of vacancy multiple per point of unemployment. The 1990s sit
  // furthest off it (vacancy left over from the overbuilt eighties), which is
  // a stock story the map supplies from month one.
  const vacMult = Math.max(0.65, Math.min(1.8, 0.835 + 15 * (uTrail - 0.0475)));
  for (const cls of Object.keys(econ.cityVac) as (keyof typeof econ.cityVac)[]) {
    const jitter = d(0.88, 1.12);
    econ.cityVac[cls] = Math.max(0.02, Math.min(0.40, (natural[cls] ?? 0.11) * vacMult * jitter));
  }
  // Rents follow the vacancy — the same five openings: a long expansion at
  // 0.84x natural vacancy ran rents ~9% over the long-run base, 1982 at 1.5x
  // ran them ~28% under, about 0.55 of rent per unit of vacancy multiple.
  const rentMult = 1.09 - 0.55 * (vacMult - 0.835);
  for (const cls of Object.keys(econ.rentIdx) as (keyof typeof econ.rentIdx)[]) {
    econ.rentIdx[cls] = +(econ.rentIdx[cls] * rentMult * d(0.95, 1.05)).toFixed(2);
  }
  econ.effRentIdx = { ...econ.rentIdx };

  // Cap rates open AT the target the monthly walk chases (capTargetOf) — the
  // same rates, credit window and vacancy the player is shown — so the first
  // year of cap moves is news, not a correction. The allocation term reads
  // the caps themselves at the opening (capFlowsOf), so the target is a fixed
  // point, found by iterating; it settles inside a handful of passes because
  // the term's slope is under one. Without it office opened 0.7-0.8 points
  // over where its own walk took it inside a year (measured over 60 openings,
  // the era table included). Two-tenths of noise per class on top, the spread
  // a month of transactions shows.
  const capIndex = econ.indexRate - inflationOverBumpPct(econ);
  const classes = Object.keys(econ.capRate) as (keyof typeof econ.capRate)[];
  const base = Object.fromEntries(classes.map((c) => [c, capTargetOf(econ, c, capIndex)])) as typeof econ.capRate;
  let caps = { ...base };
  for (let it = 0; it < 12; it++) {
    caps = Object.fromEntries(classes.map((c) => [c, base[c] + capFlowsOf(caps, c)])) as typeof econ.capRate;
  }
  for (const cls of classes) {
    econ.capRate[cls] = +Math.max(CAP_RAIL.lo, Math.min(CAP_RAIL.hi, caps[cls] + d(-0.2, 0.2))).toFixed(2);
  }
  return { months, uTrail };
}

/**
 * THE TARGET IS NOT A CONSTANT OF NATURE.
 *
 * Called once a month from tickEcon. A credible bank's target barely moves —
 * that is what credibility IS. A bank that has lost the public drifts toward
 * whatever inflation has actually been running, which is the mechanism behind
 * every real inflation that got away: the target follows the outcome instead
 * of the outcome following the target.
 *
 * Bounded 1.2% to 6%. The floor is the modern world; the ceiling is roughly
 * where the United States actually got to before somebody decided to stop it,
 * and the engine's existing Volcker restore term is what stops it here too.
 */
export function driftInflTarget(econ: Econ, rnd: number) {
  const n = econ.nat;
  if (!n) return;
  if (n.inflTarget === undefined) n.inflTarget = 0.02;
  const cred = n.credibility ?? 0.8;
  // pull toward realised inflation, at a speed set by how little anyone
  // believes the bank; and a slow anchor back toward 2% when they do
  const drag = (1 - cred) * 0.010;
  const anchor = cred * 0.004;
  n.inflTarget = Math.max(0.012, Math.min(0.060,
    n.inflTarget + drag * ((n.inflExp ?? n.infl ?? 0.02) - n.inflTarget)
    + anchor * (0.02 - n.inflTarget)
    + (rnd - 0.5) * 0.00035));
}

/**
 * THE SHORT INDEX, from the policy rate. A money-market benchmark sits a
 * little over the policy rate — 10-25bp in calm years (SOFR/LIBOR against
 * fed funds) — and blows out when banks stop trusting each other: three-month
 * LIBOR ran 3.6 points over the funds rate in October 2008. 0.15 calm and up
 * to 0.75 more at a shut window is that range; it moves with the same
 * creditIdx the loan index's term premium reads, so the two indexes agree
 * about how frightened the market is. No noise of its own: a short benchmark
 * follows the committee, it does not trade like a ten-year.
 */
export function shortIndexFor(policy: number, creditIdx: number): number {
  return +Math.max(0.05, Math.min(23, policy + 0.15 + 0.75 * Math.max(0, 1 - creditIdx))).toFixed(2);
}
