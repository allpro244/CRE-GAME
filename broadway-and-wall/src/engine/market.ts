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
const PHASE_CFG: Record<MarketPhase, { rateMu: number; rentDrift: number; devDrift: number; nextM: [number, number]; next: MarketPhase }> = {
  recovery: { rateMu: 5.0, rentDrift: 0.0014, devDrift: +0.034, nextM: [12, 24], next: "expansion" },
  expansion: { rateMu: 5.8, rentDrift: 0.0037, devDrift: +0.027, nextM: [24, 54], next: "peak" },
  peak: { rateMu: 7.0, rentDrift: 0.0014, devDrift: +0.014, nextM: [6, 15], next: "recession" },
  recession: { rateMu: 6.2, rentDrift: -0.0047, devDrift: -0.054, nextM: [12, 24], next: "recovery" },
};

export const CAP_BASE = { office: 5.6, retail: 6.1, mixed: 5.7, multifamily: 4.9, industrial: 6.9 } as const;
// Rough citywide inventory by class, in sf — the denominator that turns other
// people's construction into a rent effect you can feel.
export const CITY_STOCK = { office: 26e6, retail: 11e6, mixed: 9e6, multifamily: 31e6, industrial: 14e6 } as const;
export const SECTOR_LABEL = { office: "Office", retail: "Retail", mixed: "Mixed-use", multifamily: "Apartments", industrial: "Industrial" } as const;
export const RENT_BASE = { office: 62, retail: 88, mixed: 58, multifamily: 46, industrial: 16 } as const; // $/sf/yr

export function initEcon(s: GameState): Econ {
  const econ: Econ = {
    indexRate: 5.4,
    phase: "expansion",
    phaseMLeft: 0,
    rumoredPhase: null,
    cycleDev: 0.1,
    landIdx: 1.0,
    capRate: { office: CAP_BASE.office, retail: CAP_BASE.retail, mixed: CAP_BASE.mixed, multifamily: CAP_BASE.multifamily, industrial: CAP_BASE.industrial },
    rentIdx: { office: RENT_BASE.office, retail: RENT_BASE.retail, mixed: RENT_BASE.mixed, multifamily: RENT_BASE.multifamily, industrial: RENT_BASE.industrial },
    costIdx: 1,
    sectorMom: { office: 0, retail: 0, mixed: 0, multifamily: 0, industrial: 0 },
    pipeline: { office: 0, retail: 0, mixed: 0, multifamily: 0, industrial: 0 },
    starts: { office: 0, retail: 0, mixed: 0, multifamily: 0, industrial: 0 },
    creditIdx: 1,
    employIdx: 1,
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

  // loan index: mean-reverting walk toward the phase's rate regime
  e.indexRate = clamp(
    e.indexRate + 0.03 * (c2.rateMu - e.indexRate) + rrange(s, -0.16, 0.16),
    4.2, 9.2,
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

  // --- sector momentum ------------------------------------------------------
  // Slow independent walks, mean-reverting to zero. Occasionally one class gets
  // a shock of its own — a sector rotation the rest of the market doesn't feel.
  for (const k of BUILT_CLASSES) {
    const persist = k === "multifamily" ? 0.985 : 0.975;
    e.sectorMom[k] = clamp(e.sectorMom[k] * persist + rrange(s, -0.0009, 0.0009), -0.02, 0.02);
  }
  if (rng(s) < 0.012) {
    const k = BUILT_CLASSES[Math.floor(rng(s) * BUILT_CLASSES.length) % BUILT_CLASSES.length];
    const up = rng(s) < 0.5;
    e.sectorMom[k] = clamp(e.sectorMom[k] + (up ? 0.009 : -0.009), -0.02, 0.02);
    pushNews(s, up ? "event" : "warn", up
      ? `${SECTOR_LABEL[k]} is having a moment — tenants in that sector are expanding hard.`
      : `${SECTOR_LABEL[k]} demand is rolling over. Brokers are quietly cutting asking rents.`);
  }

  // --- the construction pipeline --------------------------------------------
  // Everyone else builds when it pays, and delivers three years later into a
  // market that has usually turned. Starts scale with the spread between what
  // rent supports and what construction costs, and with whether anyone will
  // lend. Deliveries land as supply, and supply is what ends a boom.
  for (const k of BUILT_CLASSES) {
    const margin = (e.rentIdx[k] / RENT_BASE[k]) / e.costIdx - 1;         // profit signal
    const appetite = Math.max(0, margin + 0.06 * e.cycleDev) * e.creditIdx;
    const start = CITY_STOCK[k] * 0.0016 * Math.min(2.4, appetite * 5) * (0.7 + 0.6 * rng(s));
    e.starts[k] = Math.round(start);
    e.pipeline[k] += start;
    const delivered = e.pipeline[k] / 30;                                  // ~30-month build
    e.pipeline[k] = Math.max(0, e.pipeline[k] - delivered);
    // supply pressure: new stock as a share of the class's inventory
    e.supplyPress = e.supplyPress ?? {};
    e.supplyPress[k] = delivered / CITY_STOCK[k];
  }

  // rents per class: phase drift + sector momentum − supply, plus noise
  for (const k of BUILT_CLASSES) {
    const vol = k === "multifamily" ? 0.002 : k === "office" ? 0.004 : k === "industrial" ? 0.0024 : 0.003;
    const supply = (e.supplyPress?.[k] ?? 0) * 26;      // deliveries bite on rent
    const drift = c2.rentDrift + e.sectorMom[k] * 0.5 - supply + (jobDrift * 0.35);
    e.rentIdx[k] = Math.max(RENT_BASE[k] * 0.5, e.rentIdx[k] * (1 + drift + rrange(s, -vol, vol)));
  }

  // cap rates: class base, dragged by the loan index and the cycle, and gapped
  // out when nobody will lend — a credit crunch reprices everything at once
  for (const k of BUILT_CLASSES) {
    const crunch = 1.6 * Math.max(0, 1 - e.creditIdx);
    const sector = -14 * e.sectorMom[k];
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
  const costDrift = c2.rentDrift * 1.02 + (e.phase === "recession" ? 0.0006 : 0);
  e.costIdx = clamp(e.costIdx * (1 + costDrift + rrange(s, -0.0015, 0.0015)), 0.6, 60);

  recordHistory(e, s.month);
}

function recordHistory(e: Econ, q: number) {
  e.history.push({
    q,
    indexRate: +e.indexRate.toFixed(2),
    landIdx: +e.landIdx.toFixed(4),
    cycleDev: +e.cycleDev.toFixed(3),
    capOffice: +e.capRate.office.toFixed(2),
    rentOffice: +e.rentIdx.office.toFixed(2),
    creditIdx: +e.creditIdx.toFixed(3),
    employIdx: +e.employIdx.toFixed(3),
  });
  if (e.history.length > 240) e.history.shift();
}
