// WHAT THE CITY BUYS FROM OUTSIDE, PRICED (ONE_ECONOMY_PLAN.md step 8).
//
// The nation's oil price lives here, in the live world, because the things
// that read it are live: the war swan's oil premium (blackswans.ts), the
// materials in a contractor's bid (contractors.ts) and the energy line of a
// building's operating cost. It was computed inside the firm books' shadow
// (economy.ts tickOil), which nothing in the world may read; the shadow now
// reads this one, so there is one oil price and not two.
//
// [S] a fact with a source, [D] derived from one by stated arithmetic, [K] a
// shape parameter, stated as one (CLAUDE.md).
import type { GameState } from "./types";
import { OIL_PRICE_2000, OIL_PER_SHOCK, OIL_RISE_M, OIL_HALF_LIFE_M } from "./industries";

/**
 * THE NATION'S OIL PRICE, a month on (industries.ts OIL_*). Its real level
 * runs toward OIL_PER_SHOCK x the supply shock in force (market.ts — a shock
 * under fiscal pressure is demand and moves no oil, as the engine's own
 * output block reads it), fast on the way up and back with a three-year
 * half-life. On top of that sits whatever premium a national swan carries
 * this month (a war's: blackswans.ts natSw.oil), which comes and goes with
 * the war itself — 1990's doubled in three months and was gone in six. The
 * dollar price is that times the nation's prices since the opening.
 * Deterministic; draws nothing.
 */
export function tickOilPrice(s: GameState): void {
  const e = s.econ;
  if (!e) return;
  const n = e.nat;
  const sup = n && (n.shockM ?? 0) > 0 && !((n.pressureM ?? 0) > 0) ? (n.shockSev ?? 0) : 0;
  const target = OIL_PER_SHOCK * sup;
  const cur = e.oilBaseLn ?? s.economy?.lnOil ?? 0;
  const k = target > cur ? 1 / OIL_RISE_M : 1 - Math.pow(0.5, 1 / OIL_HALF_LIFE_M);
  e.oilBaseLn = cur + (target - cur) * k;
  e.oilLn = e.oilBaseLn + (e.natSw?.oil ?? 0);
  const natCpi = e.natCpi ?? e.cpi ?? 1;
  e.oilCpi0 ??= s.economy?.natCpi0 ?? natCpi;
  e.oil = OIL_PRICE_2000 * (natCpi / Math.max(1e-6, e.oilCpi0)) * Math.exp(e.oilLn);
}

/** Real oil against the opening (1 = the opening's price in its own dollars). */
export function oilReal(e: { oilLn?: number } | undefined): number {
  return Math.exp(e?.oilLn ?? 0);
}
