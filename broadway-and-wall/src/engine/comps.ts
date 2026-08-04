// THE COMPS SHEET.
//
// The game could tell you what the city's vacancy was doing and what your own
// buildings were worth, and it could not tell you what anything had actually
// traded for. That is backwards. An appraisal is an opinion; a closed sale is
// a fact, and forming a view out of facts is most of what this job is.
//
// Every deed that moves is recorded here — price, price per foot, the going-in
// cap rate on the price actually paid, who bought and who sold. Two things
// come out of it that nothing else in the game provides:
//
//   • A read on the market that is not the engine telling you the answer. If
//     office is trading at 5.1% this year and traded at 6.4% three years ago,
//     you can see the repricing in the prints rather than in a stat block.
//   • A read on the other firms. A shop that has bought nine buildings in
//     eighteen months is levering into the top and you can watch them do it;
//     one that has printed four sales in a row is getting out.
import type { ParcelRecord } from "@/data/types";
import type { Condition, GameState, Sector } from "./types";
import { initialCondition, noiAfterTaxYr, landPsfNow, resolveRec } from "./value";
import { industryStress } from "./market";

export interface Comp {
  m: number;            // month it closed
  bbl: string;
  address: string;
  cls: string;
  price: number;
  sf: number;           // building area; 0 for dirt
  psf: number;          // $/sf of building, or of LAND when there is no building
  capRate: number;      // going-in on the price actually paid; 0 for land
  buyer: string;
  seller: string;
  distress?: boolean;
}

const MAX_COMPS = 240;

/**
 * Record a closed sale. Called from every path where a deed moves — the
 * player buying, the player selling, and the street trading with itself —
 * because a comps sheet with only some of the trades in it is worse than none.
 */
export function recordComp(
  s: GameState, rec: ParcelRecord, price: number,
  buyer: string, seller: string, distress?: boolean, condition?: Condition,
) {
  if (!rec || price <= 0) return;
  if (!s.comps) s.comps = [];
  const built = rec.class !== "land" && rec.bldgArea > 0;
  const cond = condition ?? initialCondition(rec);
  const noi = built ? noiAfterTaxYr(rec, s.econ, cond, price) : 0;
  s.comps.push({
    m: s.month,
    bbl: rec.bbl,
    address: rec.address,
    cls: rec.class,
    price: Math.round(price),
    sf: built ? rec.bldgArea : 0,
    psf: built ? price / Math.max(1, rec.bldgArea) : price / Math.max(1, rec.lotArea),
    capRate: built && price > 0 ? +((noi / price) * 100).toFixed(2) : 0,
    buyer, seller,
    distress: distress || undefined,
  });
  if (s.comps.length > MAX_COMPS) s.comps.splice(0, s.comps.length - MAX_COMPS);
}

/**
 * What the market has actually been paying for a class, over a window of
 * months. Returns null when there are too few prints to say anything — which
 * is itself the answer, and far more honest than averaging two trades and
 * calling it a market.
 */
export function compStats(s: GameState, cls: string, months = 36) {
  const since = s.month - months;
  // Dirt trades far more often than buildings do in a town still filling in,
  // and a comps sheet that silently dropped every land sale was hiding most
  // of the market. Land has no cap rate; it has a price per foot of LOT, and
  // that is exactly the number a developer is trying to read.
  const land = cls === "land";
  const rows = (s.comps ?? []).filter((c) => c.m >= since && c.cls === cls && (land ? c.sf === 0 : c.sf > 0));
  if (rows.length < 3) return null;
  const caps = rows.map((c) => c.capRate).filter((x) => x > 0).sort((a, b) => a - b);
  const psfs = rows.map((c) => c.psf).sort((a, b) => a - b);
  const mid = (a: number[]) => (a.length ? a[Math.floor(a.length / 2)] : 0);
  return {
    n: rows.length,
    medCap: mid(caps),
    medPsf: mid(psfs),
    volume: rows.reduce((a, c) => a + c.price, 0),
    distressShare: rows.filter((c) => c.distress).length / rows.length,
  };
}

/**
 * Who has been buying and who has been selling, over a window.
 *
 * NAMED PARTICIPANTS ONLY. Half the counterparties in the ledger are
 * placeholders — "a private owner", "a listed seller", "a distressed buyer" —
 * and aggregating them produced a row for the anonymous public reading
 * "getting out, ask why before you buy what they are selling", which is
 * nonsense dressed as insight. A read on a firm is only worth having when
 * there is a firm to read.
 */
export function compFlows(s: GameState, months = 36) {
  const named = new Set<string>([s.firm?.short ?? "You", ...(s.rivals ?? []).map((r) => r.name)]);
  const since = s.month - months;
  const by = new Map<string, { bought: number; sold: number; boughtN: number; soldN: number }>();
  const at = (k: string) => {
    let e = by.get(k);
    if (!e) { e = { bought: 0, sold: 0, boughtN: 0, soldN: 0 }; by.set(k, e); }
    return e;
  };
  for (const c of s.comps ?? []) {
    if (c.m < since) continue;
    if (named.has(c.buyer)) { const e = at(c.buyer); e.bought += c.price; e.boughtN++; }
    if (named.has(c.seller)) { const e = at(c.seller); e.sold += c.price; e.soldN++; }
  }
  return [...by.entries()]
    .map(([name, v]) => ({ name, ...v, net: v.bought - v.sold }))
    .sort((a, b) => (b.bought + b.sold) - (a.bought + a.sold));
}

/**
 * WHAT YOUR RENT ROLL DOES FOR A LIVING, across the whole book.
 *
 * The single most important number a landlord can know about themselves and
 * the game had no way to compute it. Concentration is not a per-building
 * property: you can own twelve diversified buildings and still be sixty per
 * cent finance, and when finance turns you find that out all at once.
 */
export function portfolioIndustries(s: GameState) {
  const by = new Map<Sector, { income: number; sf: number; tenants: number }>();
  let total = 0;
  for (const h of Object.values(s.holdings)) {
    for (const t of h.tenants) {
      const annual = t.rentPsf * t.sf;
      total += annual;
      const e = by.get(t.sector) ?? { income: 0, sf: 0, tenants: 0 };
      e.income += annual; e.sf += t.sf; e.tenants++;
      by.set(t.sector, e);
    }
  }
  const rows = [...by.entries()]
    .map(([sector, v]) => ({
      sector,
      ...v,
      share: total > 0 ? v.income / total : 0,
      stress: industryStress(s.econ, sector),
      mom: s.econ.industryMom?.[sector] ?? 0,
      phase: s.econ.industryPhase?.[sector] ?? "steady",
    }))
    .sort((a, b) => b.income - a.income);
  // The share of your income sitting in trades that are currently contracting
  // — the number that says how bad the next two years are going to be.
  const atRisk = rows.reduce((a, r) => a + r.share * r.stress, 0);
  return { rows, total, top: rows[0] ?? null, atRisk };
}

/**
 * WHAT THE STREET IS ACTUALLY PAYING FOR DIRT.
 *
 * Land value in this engine was a label rather than a price. `landPsfNow`
 * reads a static seed off the parcel record, a citywide index, a site-quality
 * multiplier and the cycle — and nothing else. `s.landAdj`, the per-parcel
 * mark that every consumer already reads through `resolveBase`, was written by
 * exactly two things: a delivery, and a rezoning. Nothing anybody BOUGHT ever
 * moved the ground under it.
 *
 * That is the wrong way round for the most fundamental price in the business.
 * Dirt has no income and no replacement cost; the only way anybody knows what
 * a lot is worth is what the lots around it have been fetching. Comparable
 * sales are not a check on the appraisal, they ARE the appraisal.
 *
 * Measured before this existed (`pnpm stress --only=B`): a buyer taking 116 to
 * 142 lots out of one district over twenty-five years moved that district's
 * land value DOWN 6.6% relative to the rest of the same town. The player's
 * demand was not an input to the land market at all, so absorbing a third of a
 * district's dirt read to the appraiser as one fewer building trading there —
 * which is the sign it moves, backwards.
 *
 * How it works, and why it converges rather than running away: every land
 * print is compared to what this engine would have appraised that same lot at,
 * and the ratio is the market telling the appraiser it is wrong. Aggregated to
 * the district, because that is the submarket an appraiser actually pulls
 * comps from, and only when there are enough prints to be a market rather than
 * an anecdote. The mark then moves a fraction of the way each quarter — and as
 * it moves, the appraisal rises toward the prints and the ratio returns to
 * one, which is what stops it. A district that keeps clearing above its
 * appraisal keeps getting marked up, exactly as long as it keeps doing it.
 *
 * It draws no random numbers, so every paired run in both audits stays in step.
 */
const LAND_WINDOW_M = 36;      // three years of prints — an appraiser's window
const LAND_MIN_PRINTS = 3;     // one sale is an anecdote, two is a coincidence
const LAND_SPEED = 0.07;       // per quarter, toward what the street is paying

export function tickLandComps(s: GameState, parcels: Record<string, ParcelRecord>) {
  // Appraisals are quarterly work. Nobody re-marks a book every month.
  if (s.month % 3 !== 0) return;
  if (!s.landAdj) s.landAdj = {};
  const since = s.month - LAND_WINDOW_M;
  const byDist = new Map<string, number[]>();
  for (const c of s.comps ?? []) {
    // LAND PRINTS ONLY. An improved sale is mostly a price for the building;
    // backing the dirt out of it is a residual, and a residual of two large
    // numbers is noise at this sample size.
    if (c.m < since || c.sf !== 0) continue;
    const rec = resolveRec(parcels, s, c.bbl);
    if (!rec?.lotArea) continue;
    const appraised = landPsfNow(rec, s.econ);
    if (!(appraised > 0) || !(c.psf > 0)) continue;
    const d = rec.district ?? "—";
    if (!byDist.has(d)) byDist.set(d, []);
    byDist.get(d)!.push(c.psf / appraised);
  }
  if (!byDist.size) return;

  const pull = new Map<string, number>();
  for (const [dist, ratios] of byDist) {
    if (ratios.length < LAND_MIN_PRINTS) continue;
    ratios.sort((a, b) => a - b);
    const median = ratios[Math.floor((ratios.length - 1) / 2)];
    // A single wild print — a distressed clear-out, an assemblage premium —
    // is real but it is not the market. Bound what one quarter can conclude.
    if (Number.isFinite(median)) pull.set(dist, Math.max(0.6, Math.min(1.7, median)));
  }
  if (!pull.size) return;

  for (const bbl of Object.keys(parcels)) {
    const p = parcels[bbl];
    const f = p ? pull.get(p.district ?? "—") : undefined;
    if (f === undefined) continue;
    const cur = s.landAdj[bbl] ?? 1;
    const next = cur * (1 + LAND_SPEED * (f - 1));
    s.landAdj[bbl] = +Math.max(0.25, Math.min(4, next)).toFixed(4);
  }
}
