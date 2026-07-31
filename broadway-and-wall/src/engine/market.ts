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
const PHASE_CFG: Record<MarketPhase, { rateMu: number; rentDrift: number; devDrift: number; nextQ: [number, number]; next: MarketPhase }> = {
  recovery: { rateMu: 5.0, rentDrift: 0.004, devDrift: +0.10, nextQ: [4, 8], next: "expansion" },
  expansion: { rateMu: 5.8, rentDrift: 0.011, devDrift: +0.08, nextQ: [8, 18], next: "peak" },
  peak: { rateMu: 7.0, rentDrift: 0.004, devDrift: +0.04, nextQ: [2, 5], next: "recession" },
  recession: { rateMu: 6.2, rentDrift: -0.014, devDrift: -0.16, nextQ: [4, 8], next: "recovery" },
};

export const CAP_BASE = { office: 5.6, retail: 6.1, mixed: 5.7, multifamily: 4.9 } as const;
export const RENT_BASE = { office: 62, retail: 88, mixed: 58, multifamily: 46 } as const; // $/sf/yr

export function initEcon(s: GameState): Econ {
  const econ: Econ = {
    indexRate: 5.4,
    phase: "expansion",
    phaseQLeft: 0,
    rumoredPhase: null,
    cycleDev: 0.1,
    landIdx: 1.0,
    capRate: { office: CAP_BASE.office, retail: CAP_BASE.retail, mixed: CAP_BASE.mixed, multifamily: CAP_BASE.multifamily },
    rentIdx: { office: RENT_BASE.office, retail: RENT_BASE.retail, mixed: RENT_BASE.mixed, multifamily: RENT_BASE.multifamily },
    history: [],
  };
  econ.phaseQLeft = Math.round(4 + 10 * rng(s));
  recordHistory(econ, 0);
  return econ;
}

function pushNews(s: GameState, kind: NewsItem["kind"], text: string) {
  s.news.unshift({ q: s.quarter, kind, text });
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
  e.phaseQLeft--;
  if (e.phaseQLeft <= 2 && !e.rumoredPhase && rng(s) < 0.6) {
    e.rumoredPhase = cfg.next;
    pushNews(s, "rumor", RUMORS[cfg.next][Math.floor(rng(s) * RUMORS[cfg.next].length)]);
  }
  if (e.phaseQLeft <= 0) {
    e.phase = cfg.next;
    e.rumoredPhase = null;
    const [lo, hi] = PHASE_CFG[e.phase].nextQ;
    e.phaseQLeft = Math.round(lo + (hi - lo) * rng(s));
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
    e.indexRate + 0.25 * (c2.rateMu - e.indexRate) * 0.35 + rrange(s, -0.28, 0.28),
    4.2, 9.2,
  );

  // cycle deviation drifts with phase, spring-loaded toward its bounds
  e.cycleDev = clamp(e.cycleDev + c2.devDrift + rrange(s, -0.05, 0.05), -1, 1);

  // rents per class: phase drift + noise, multifamily steadier than office
  for (const k of BUILT_CLASSES) {
    const vol = k === "multifamily" ? 0.006 : k === "office" ? 0.012 : 0.009;
    e.rentIdx[k] = Math.max(RENT_BASE[k] * 0.55, e.rentIdx[k] * (1 + c2.rentDrift + rrange(s, -vol, vol)));
  }

  // cap rates: anchored to class base, dragged by the loan index, walked
  for (const k of BUILT_CLASSES) {
    const target = CAP_BASE[k] + 0.38 * (e.indexRate - 5.4) - 0.25 * e.cycleDev;
    e.capRate[k] = clamp(e.capRate[k] + 0.3 * (target - e.capRate[k]) + rrange(s, -0.08, 0.08), 3.6, 9.5);
  }

  // citywide land index follows rent power and cycle mood
  const rentPulse = e.rentIdx.office / RENT_BASE.office - 1;
  e.landIdx = Math.max(0.35, e.landIdx * (1 + 0.35 * c2.rentDrift + 0.006 * e.cycleDev + 0.25 * rentPulse * 0.02 + rrange(s, -0.006, 0.006)));

  recordHistory(e, s.quarter);
}

function recordHistory(e: Econ, q: number) {
  e.history.push({
    q,
    indexRate: +e.indexRate.toFixed(2),
    landIdx: +e.landIdx.toFixed(4),
    cycleDev: +e.cycleDev.toFixed(3),
    capOffice: +e.capRate.office.toFixed(2),
    rentOffice: +e.rentIdx.office.toFixed(2),
  });
  if (e.history.length > 80) e.history.shift();
}
