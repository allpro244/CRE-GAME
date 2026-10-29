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
import { why, whyNation } from "./why";

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

// ---------------------------------------------------------------- what a building costs to run

/**
 * The energy an owner buys (electricity, gas, heating oil) against real crude:
 * about 0.2 per log point [K, from the shares: fuel is about a third of the
 * cost of commercial electricity (EIA Annual Energy Outlook), and gas tracked
 * oil closely until 2009], on top of the nation's prices.
 */
const ENERGY_OIL = 0.2;
/**
 * THE PROPERTY-INSURANCE CYCLE (Winter 1994, "The dynamics of competitive
 * insurance markets"; Gron 1994; Cummins & Danzon 1997). Insurers can write
 * only as much as their capital carries. A heavy loss year takes capital out
 * and the price of cover goes up until it is rebuilt — the hard markets of
 * 1985-87, 2001-03 (9/11 and the dot-com losses), 2005-06 (Katrina) and
 * 2019-23 (US commercial property rates up about 60% cumulatively, Marsh
 * Global Insurance Market Index). Profitable years then add capital beyond
 * what the business needs, competition cuts the price below normal (the soft
 * markets of 1988-2000 and 2004-17), and the cycle turns.
 *
 *   capital   falls by a loss year's hit; rises with the premium's excess
 *             over normal; pays out its surplus over three years [K]
 *   price     the rate follows minus the capital gap, one for one, over a
 *             year of renewals [K: a 10% capital hit, ~10% dearer cover]
 *   yields    less investment income is made up in price: about 3% of
 *             premium per point the ten-year falls below its opening, for a
 *             short-tail line (investment income ~10-15% of premium;
 *             Cummins & Outreville 1987) [S]
 *   losses    a heavy loss year about one in four (Swiss Re sigma: 1992,
 *             2001, 2004-05, 2011-12, 2017, 2020-22), taking 5-20% of the
 *             industry's capital (Andrew ~10% of 1992 surplus, 2001 and 2005
 *             ~15%) [S]. Weather is nature's dice: drawn from a hash of the
 *             seed and the year, so no stream moves.
 */
const INS_CAT_P = 0.25, INS_CAT_LO = 0.05, INS_CAT_HI = 0.20;
const INS_RENEW_M = 12, INS_PAYOUT_M = 36, INS_RATE_SENS = 0.03;

function hash01(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return ((h >>> 0) + 0.5) / 4294967296;
}

/**
 * A month of the operating-cost inputs: labour with the town's wage, energy
 * with the nation's prices and oil, the insurance market's capital and price.
 * Each component starts equal to the cost index, so a building costs what it
 * did to run on the day this began (inputs read after the cost index moves).
 */
export function tickOpexInputs(s: GameState): void {
  const e = s.econ;
  if (!e || !(e.costIdx > 0)) return;
  const wage = e.wageIdx ?? 1;
  const natCpi = e.natCpi ?? e.cpi ?? 1;
  const energy = natCpi * Math.exp(ENERGY_OIL * (e.oilLn ?? 0));
  const prev = e.opexPrev;
  if (!e.opexIdx) e.opexIdx = { labour: e.costIdx, energy: e.costIdx, ins: 0, insCap: 0 };
  const o = e.opexIdx;
  if (prev) {
    o.labour *= wage / Math.max(1e-9, prev.wage);
    o.energy *= energy / Math.max(1e-9, prev.energy);
  }
  // THE INSURANCE MARKET.
  const r0 = (e.opexRate0 ??= e.indexRate ?? 5.4);
  if (s.month % 12 === 9) {
    const yr = Math.floor(s.month / 12);
    if (hash01(`${s.seed}|cat|${yr}`) < INS_CAT_P) {
      const hit = INS_CAT_LO + (INS_CAT_HI - INS_CAT_LO) * hash01(`${s.seed}|catsev|${yr}`);
      o.insCap -= hit;
      const id = why(s, { k: "insurance.lossyear", a: "nation", name: "property insurers", n: { capitalHit: hit },
        t: `A heavy loss year for insurers · ${(hit * 100).toFixed(0)}% of their capital gone` }, [whyNation(s)]);
      s.news.unshift({ q: s.month, kind: "warn", why: id,
        text: `A heavy year of storms and fires has taken about ${(hit * 100).toFixed(0)}% of the property insurers' capital. Expect dearer cover at your next renewals.` });
    }
  }
  const target = -o.insCap + INS_RATE_SENS * (r0 - (e.indexRate ?? r0));
  o.ins += (target - o.ins) / INS_RENEW_M;
  // The premium carries the expected loss year (a quarter of the mean hit a
  // year), so an ordinary year adds back what a heavy one takes on average and
  // the cycle has no drift: cover is dear after a bad year, not on average.
  o.insCap += o.ins / 12 - o.insCap / INS_PAYOUT_M + INS_CAT_P * (INS_CAT_LO + INS_CAT_HI) / 2 / 12;
  e.opexPrev = { wage, energy };
}
