/**
 * THE STREET'S SPACE MARKET BY QUALITY — TENANT_TIERS_PLAN.md.
 *
 * A city's office market is not one market. The law firm that wants the best
 * floor in town and the start-up that wants the cheapest are both "office
 * demand", and they do not compete for the same floors until prices push them
 * to. Every building carries one quality score, 1-100 (`overallScore`: the
 * address and the building blended), and every tenant shops for the best
 * space it can afford on that scale. The street's stock — every building the
 * player does not own — is kept here in ten-point bands of that score, and
 * the aggregate market (the pool, absorption, the class rent index in
 * market.ts) is DISTRIBUTED across them rather than replaced:
 *
 *   - each band's stock and its rent premium are measured off the real
 *     buildings once a year, and a building that slips down the scale takes
 *     its tenants with it;
 *   - net absorption arrives by room and leaves weighted to the bottom of the
 *     scale, because weak credits fail first and a firm that consolidates
 *     gives back its worst floors;
 *   - every month the tenants whose leases are rolling look across the scale
 *     and weigh what better space costs against what it is worth to them
 *     (`moveOdds`). When good space gets cheap the upgrade is a bargain and
 *     they take it — a glut of new towers empties the bottom of the market.
 *     When the market is dear they hold, or trade down to save the rent;
 *   - each band's rent swings around its static premium with its own vacancy
 *     gap against the class's.
 */
import type { ParcelRecord, ParcelTable } from "@/data/types";
import type { BuiltClass, Econ, GameState } from "./types";
import { BUILT_CLASSES } from "./types";
import { NATURAL_VAC } from "./market";
import { GROSS_TURNOVER } from "./turnover";
import {
  N_BANDS, bandCenter, overallScore, scoreNatVac, locationRentMult, plateRentMult,
  condMultAt, specRentMult, initialCondIdx, scoreRentMult,
} from "./value";

const zeros = () => new Array(N_BANDS).fill(0) as number[];
/** Before the first measurement, a street spread around the middle of the scale. */
const DEFAULT_SHARE = [0.01, 0.04, 0.09, 0.15, 0.2, 0.2, 0.15, 0.09, 0.05, 0.02];

/**
 * MEASURE THE STREET OFF ITS BUILDINGS, once a year with the stock vintage:
 * each band's floor area, and the average static rent premium its buildings
 * carry (location, plate, condition, spec) over the class's. The clock
 * (`tierCtx`) is stamped with it so any reader can score a building from the
 * economy alone.
 */
export function stampBands(s: GameState, parcels: ParcelTable) {
  const e = s.econ;
  const ctx = { month: s.month, vintage: { ...(s.stockVintage ?? {}) } };
  e.tierCtx = ctx;
  const sf = {} as Record<BuiltClass, number[]>, pw = {} as Record<BuiltClass, number[]>;
  for (const k of BUILT_CLASSES) { sf[k] = zeros(); pw[k] = zeros(); }
  for (const bbl in parcels) {
    if (s.holdings[bbl]) continue;
    const r = (s.built?.[bbl] as typeof parcels[string] | undefined) ?? parcels[bbl];
    if (!r || r.class === "land" || !r.bldgArea) continue;
    const k = r.class as BuiltClass;
    if (!sf[k]) continue;
    const idx = initialCondIdx(r, s.month);
    const sc = overallScore(r, e, k, idx);
    const b = Math.min(N_BANDS - 1, Math.floor(sc / 10));
    const prem = locationRentMult(r, e, k) * plateRentMult(r, k) * condMultAt(idx) * specRentMult(r.buildSpec);
    // A lot with no reading (a spec or plate the tables do not know) is left
    // out rather than poisoning the class's mean premium with a NaN.
    if (!Number.isFinite(prem) || !(r.bldgArea > 0)) continue;
    sf[k][b] += r.bldgArea; pw[k][b] += r.bldgArea * prem;
  }
  const out = {} as Record<BuiltClass, { share: number[]; prem: number[]; mean: number }>;
  for (const k of BUILT_CLASSES) {
    const tot = sf[k].reduce((a, v) => a + v, 0);
    const meanPrem = tot > 0 ? pw[k].reduce((a, v) => a + v, 0) / tot : 1;
    const share = tot > 0 ? sf[k].map((v) => v / tot) : [...DEFAULT_SHARE];
    // A band with no buildings borrows its premium from the line through the bands that have them.
    const prem = sf[k].map((v, b) => v > 0 ? (pw[k][b] / v) / meanPrem : NaN);
    for (let b = 0; b < N_BANDS; b++) if (!Number.isFinite(prem[b])) prem[b] = 0.6 + 0.8 * bandCenter(b) / 100;
    out[k] = { share, prem, mean: meanPrem };
  }
  e.bandStamp = out;
}

/**
 * THE ODDS A TENANT IN SPACE OF QUALITY `sFrom` TAKES SPACE OF QUALITY `sTo` —
 * a scale, not a switch, and two things at once:
 *
 *   NEAR WHAT IT HAS. A firm shops around the quality it is used to — what it
 *   can afford and what its business needs: most moves are within twenty
 *   points of the score it sits at, and a move of forty is rare.
 *   THE BARGAIN. The normal premium for better space is the market's price of
 *   quality (measured off the buildings), and paying it is not a reason to
 *   move or not to. What moves tenants is space that is cheap or dear FOR
 *   WHAT IT IS — `dearTo` against `dearFrom`, each the rent over what space at
 *   that score normally lets for. When prime that normally costs half again
 *   what a mid tenant pays comes down to a tenth more, the upgrade is a
 *   bargain and most of them take it; when it is dear for what it is, they
 *   stay, or trade down to save the rent.
 *
 * Shape parameters, stated as such: 20 points of reach, and a 6% spread over
 * which a bargain turns from unlikely to likely.
 */
export function moveOdds(sFrom: number, dearFrom: number, sTo: number, dearTo: number): number {
  const d = (sTo - sFrom) / 20;
  const near = Math.exp(-0.5 * d * d);
  const bargain = 1 / (1 + Math.exp(-Math.log(Math.max(1e-9, dearFrom) / Math.max(1e-9, dearTo)) / 0.06));
  return near * bargain;
}
const bandOdds = (bk: { rent: number[] }, j: number, i: number) =>
  moveOdds(bandCenter(j), bk.rent[j], bandCenter(i), bk.rent[i]);

/**
 * How dear a building is for what it is. Its own static premium (location,
 * plate, condition, spec) is the market's price for those things, exactly as
 * it is for every street building in its band — so, at its market rent, the
 * only thing that makes it dear or cheap is the market's swing at its score.
 * The owner's ask over or under market rides on top at the leasing desk.
 */
export function dearnessOf(e: Econ, k: BuiltClass, score: number): number {
  return scoreRentMult(e, k, score);
}

/**
 * A BUILDING'S OWN STATIC PREMIUM over its class — location, plate,
 * condition, spec — on the same footing as the bands' (`stampBands`).
 */
export function staticPremOf(e: Econ, rec: ParcelRecord, k: BuiltClass, condIdx: number): number {
  const raw = locationRentMult(rec, e, k) * plateRentMult(rec, k) * condMultAt(condIdx) * specRentMult(rec.buildSpec);
  return raw / Math.max(1e-9, e.bandStamp?.[k]?.mean ?? 1);
}

/** Who leaves first when the class sheds tenants: the bottom of the scale (weak credits, worst floors). */
const outWeight = (b: number) => 1.6 - 1.0 * bandCenter(b) / 100;
/** How hard a band's rent leans on its vacancy gap against the class's (10 points softer, ~15% cheaper). */
const BAND_RENT_BETA = 1.5;
/** Months for a band's rent to close half its gap — the same order as the class rent's own press term. */
const BAND_RENT_TAU = 12;

/** A band's rent relative to the class: its static premium times the market's swing on it. */
export const bandRent = (bk: { prem: number[]; rent: number[] }, b: number) => bk.prem[b] * bk.rent[b];

/**
 * ONE MONTH OF THE STREET BY QUALITY for class `k`, run after the class's own
 * occupied and vacancy are set (market.ts). Conserves: the bands' stock and
 * occupied always sum to the street's.
 */
export function tickBands(e: Econ, k: BuiltClass) {
  const pSf = e.playerNow?.sf?.[k] ?? 0, pOcc = e.playerNow?.occ?.[k] ?? 0;
  const streetStock = Math.max(1, e.stock[k] - pSf);
  const streetOcc = Math.max(0, Math.min(streetStock, e.occupied[k] - pOcc));
  const stamp = e.bandStamp?.[k];
  const share = stamp?.share ?? DEFAULT_SHARE;
  if (!e.bands) e.bands = {} as NonNullable<Econ["bands"]>;
  let bk = e.bands[k];
  const nat = Array.from({ length: N_BANDS }, (_, b) => scoreNatVac(e, k, bandCenter(b)));
  if (!bk) {
    // Open each band at its own natural rate, scaled so the bands hold the street's tenants.
    const stock = share.map((x) => x * streetStock);
    const want = stock.map((x, b) => x * (1 - nat[b]));
    const f = streetOcc / Math.max(1, want.reduce((a, v) => a + v, 0));
    bk = e.bands[k] = { stock, occ: want.map((v, b) => Math.min(stock[b], v * f)), rent: new Array(N_BANDS).fill(1), prem: [...(stamp?.prem ?? share.map((_, b) => 0.6 + 0.8 * bandCenter(b) / 100))] };
  }
  if (stamp) bk.prem = [...stamp.prem];

  // THE STREET'S FIRMS SAY WHICH FLOORS ARE LET (streetRolls.ts). Where the
  // street keeps real rolls, each band's stock and tenants are measured off
  // the buildings themselves — the moves between bands are firms actually
  // moving — scaled to the class's street totals (sheds carry the region's
  // off-map stock in the same proportions).
  const fromRolls = k !== "multifamily" ? e.streetSpace?.[k]?.byBand : undefined;
  if (fromRolls && fromRolls.stock.reduce((a, v) => a + v, 0) > 0) {
    const st = fromRolls.stock.reduce((a, v) => a + v, 0);
    const oc = fromRolls.occ.reduce((a, v) => a + v, 0);
    for (let b = 0; b < N_BANDS; b++) {
      bk.stock[b] = fromRolls.stock[b] * streetStock / st;
      bk.occ[b] = oc > 0 ? Math.min(bk.stock[b], fromRolls.occ[b] * streetOcc / oc) : 0;
    }
  } else {
  // 1. STOCK. Re-measured this year: the buildings set the mix, and a
    //    building that slipped down the scale keeps its tenants. Between
    //    measurements, new floor arrives high on the scale (it is new) and floor
    //    that leaves goes from the bottom first.
    let target: number[];
    if (bk.m !== e.tierCtx?.month) {
      target = share.map((x) => x * streetStock);
      bk.m = e.tierCtx?.month;
    } else {
      target = [...bk.stock];
      let d = streetStock - target.reduce((a, v) => a + v, 0);
      if (d > 0) target[7] += d;
      for (let b = 0; b < N_BANDS && d < 0; b++) { const cut = Math.min(target[b], -d); target[b] -= cut; d += cut; }
    }
    // Floor that shrinks out of a band moves down the scale with its tenants;
    // floor that grows is new and arrives empty.
    let carry = 0;
    for (let b = N_BANDS - 1; b >= 0; b--) {
      const d = target[b] - bk.stock[b];
      if (d < 0 && bk.stock[b] > 0) {
        const leave = bk.occ[b] * Math.min(1, -d / bk.stock[b]);
        bk.occ[b] -= leave; carry += leave;
      }
    }
    const grow = target.map((x, b) => Math.max(0, x - bk!.stock[b]));
    const growSum = grow.reduce((a, v) => a + v, 0);
    for (let b = 0; b < N_BANDS; b++) {
      bk.stock[b] = target[b];
      if (growSum > 0) bk.occ[b] += carry * grow[b] / growSum;
    }
    if (!(growSum > 0) && carry > 0) bk.occ[0] += carry;

    // 2. THE CLASS'S NET ABSORPTION, distributed. In: by room. Out: weighted to the bottom.
    let delta = streetOcc - bk.occ.reduce((a, v) => a + v, 0);
    if (delta > 0) {
      for (let pass = 0; pass < 3 && delta > 1; pass++) {
        const room = bk.stock.map((x, b) => Math.max(0, x * 0.985 - bk!.occ[b]));
        const roomSum = room.reduce((a, v) => a + v, 0);
        if (!(roomSum > 0)) break;
        const take = Math.min(delta, roomSum);
        for (let b = 0; b < N_BANDS; b++) bk.occ[b] += take * room[b] / roomSum;
        delta -= take;
      }
    } else if (delta < 0) {
      const w = bk.occ.map((o, b) => o * outWeight(b));
      const wSum = w.reduce((a, v) => a + v, 0);
      for (let b = 0; b < N_BANDS && wSum > 0; b++) bk.occ[b] = Math.max(0, bk.occ[b] + delta * w[b] / wSum);
    }

    // 3. THE MOVES. The tenants whose leases are rolling this month (the
    //    class's gross relocation rate) look across the street's empty floors —
    //    and the player's (`playerNow.band`) — and go where the quality is worth
    //    the rent. Of the tenants who choose the player's floors, the street
    //    keeps nothing: the player's own leasing desk competes for them
    //    (absorption.ts). Moving within a band is churn and changes nothing here.
    const turn = (GROSS_TURNOVER[k] ?? 0) / 12;
    if (turn > 0) {
      const p = e.playerNow?.band?.[k];
      const vacS = bk.stock.map((x, b) => Math.max(0, x * 0.985 - bk!.occ[b]));
      const vacP = p ? p.sf.map((x, b) => Math.max(0, x - p.occ[b])) : zeros();
      const moved = zeros(), arrive = zeros();
      for (let j = 0; j < N_BANDS; j++) {
        const lookers = bk.occ[j] * turn;
        if (!(lookers > 0)) continue;
        // Where they look: every empty floor, weighted by the odds they would take it.
        let wAll = 0;
        const w = zeros();
        for (let i = 0; i < N_BANDS; i++) {
          const odds = bandOdds(bk, j, i);
          w[i] = odds * (vacS[i] + vacP[i]);
          wAll += w[i];
        }
        // These are movers, not renewals (GROSS_TURNOVER is new-lease volume);
        // the ones who land in their own band are churn and change nothing here.
        if (!(wAll > 0)) continue;
        for (let i = 0; i < N_BANDS; i++) {
          if (i === j || !(w[i] > 0)) continue;
          const go = lookers * w[i] / wAll;
          const toStreet = go * vacS[i] / Math.max(1e-9, vacS[i] + vacP[i]);
          moved[j] += toStreet; arrive[i] += toStreet;
        }
      }
      for (let b = 0; b < N_BANDS; b++) {
        const room = Math.max(0, bk.stock[b] * 0.985 - (bk.occ[b] - moved[b]));
        bk.occ[b] = bk.occ[b] - moved[b] + Math.min(room, arrive[b]);
      }
    }

    // Exactness: the bands hold the street's tenants, to the foot.
    const sumOcc = bk.occ.reduce((a, v) => a + v, 0);
    if (sumOcc > 0) for (let b = 0; b < N_BANDS; b++) bk.occ[b] = Math.max(0, Math.min(bk.stock[b], bk.occ[b] * streetOcc / sumOcc));

  }

  // 4. RENT. Each band's swing chases its vacancy gap against the class's,
  //    then the set is re-centred so the occupied-weighted mean is one.
  const gapClass = NATURAL_VAC[k] - (1 - streetOcc / streetStock);
  for (let b = 0; b < N_BANDS; b++) {
    if (!(bk.stock[b] > 0)) continue;
    const vac = 1 - bk.occ[b] / bk.stock[b];
    const want = Math.max(0.2, 1 + BAND_RENT_BETA * ((nat[b] - vac) - gapClass));
    bk.rent[b] += (want - bk.rent[b]) / BAND_RENT_TAU;
  }
  const occW = bk.occ.reduce((a, v) => a + v, 0);
  const mean = occW > 0 ? bk.occ.reduce((a, o, b) => a + o * bk!.rent[b], 0) / occW : 1;
  if (mean > 0) for (let b = 0; b < N_BANDS; b++) bk.rent[b] /= mean;
}

/**
 * THE TENANTS A BUILDING DRAWS, per foot it has empty, against an average
 * empty foot of the class (absorption.ts leasingOdds): every band's movers
 * spread across the market's empty floors by their odds of taking them, and
 * this is how many land per foot here — at this building's own score, its own
 * premium, the market's swing at its score and the owner's ask on top.
 */
export function scoreDraw(e: Econ, k: BuiltClass, score: number, askRel = 1): number {
  const bk = e.bands?.[k];
  if (!bk) return 1;
  const p = e.playerNow?.band?.[k];
  const vac = bk.stock.map((x, b) => Math.max(0, x - bk.occ[b]) + (p ? Math.max(0, p.sf[b] - p.occ[b]) : 0));
  const vacAll = vac.reduce((a, v) => a + v, 0);
  const occAll = bk.occ.reduce((a, v) => a + v, 0);
  if (!(vacAll > 0) || !(occAll > 0)) return 1;
  const dHere = dearnessOf(e, k, score) * Math.max(0.05, askRel);
  let here = 0, avg = 0;
  for (let j = 0; j < N_BANDS; j++) {
    const lookers = bk.occ[j] / occAll;
    if (!(lookers > 0)) continue;
    let wAll = 0;
    for (let i = 0; i < N_BANDS; i++) wAll += bandOdds(bk, j, i) * vac[i];
    if (!(wAll > 0)) continue;
    here += lookers * moveOdds(bandCenter(j), bk.rent[j], score, dHere) / wAll;
    avg += lookers / vacAll;
  }
  return avg > 0 ? here / avg : 1;
}

/** WHO WALKS IN: the quality a touring tenant is shopping for, drawn from the bands by how many of each band's movers this building draws. */
export function drawTenantQuality(e: Econ, k: BuiltClass, score: number, u: number, u2: number): number {
  const bk = e.bands?.[k];
  if (!bk) return score;
  const dHere = dearnessOf(e, k, score);
  const w = bk.occ.map((o, j) => o * moveOdds(bandCenter(j), bk.rent[j], score, dHere));
  const tot = w.reduce((a, v) => a + v, 0);
  if (!(tot > 0)) return score;
  let x = u * tot, j = 0;
  for (; j < N_BANDS - 1; j++) { x -= w[j]; if (x <= 0) break; }
  return Math.max(1, Math.min(100, bandCenter(j) + (u2 - 0.5) * 10));
}

/**
 * WHAT A TENANT'S QUALITY DOES TO ITS LETTER, on a scale. Better tenants (the
 * law firm, the headquarters) sign longer, fit out heavier and carry better
 * covenants; the bottom of the scale signs short, fits out light, and is the
 * weaker credit — the term and TI spreads between Class A and B/C lease comps
 * (CBRE / JLL) run on that order. A tenant stretching up the scale offers
 * less to get in; one settling below what it usually takes pays up to close.
 */
export function tenantQualityTerms(q: number, score: number): { rent: number; term: number; ti: number; credit: number } {
  const x = q / 100;
  const gap = score - q;   // > 0: stretching up into this building
  return {
    term: 0.75 + 0.45 * x,
    ti: 0.75 + 0.5 * x,
    credit: gap < -15 ? 1 : gap > 15 ? -1 : 0,
    rent: gap > 0 ? 1 - 0.1 * Math.min(1, gap / 30) : 1 + 0.03 * Math.min(1, -gap / 30),
  };
}

/** For the economy page and probes: each band's stock, vacancy, natural rate and rent vs the class. */
export function bandTable(e: Econ, k: BuiltClass): { lo: number; stock: number; vac: number; nat: number; rent: number }[] {
  const bk = e.bands?.[k];
  if (!bk) return [];
  return bk.stock.map((st, b) => ({
    lo: b * 10, stock: Math.round(st),
    vac: +(st > 0 ? 1 - bk.occ[b] / st : 0).toFixed(4),
    nat: +scoreNatVac(e, k, bandCenter(b)).toFixed(4),
    rent: +bandRent(bk, b).toFixed(3),
  }));
}
