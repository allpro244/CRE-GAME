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
import type { Disclosure } from "./value";
import { initialCondition, noiAfterTaxYr, holdingNOIYr, asIfOwned, disclosureFor, landPsfNow, resolveRec, assetValue, envelopeRealisation, LAND_CREDIBILITY } from "./value";
import { farMaxFor } from "./proforma";
import { industryStress } from "./market";
import { recordPropertyEvent } from "./history";
import { printTrade, printLandTrade } from "./propmarket";

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
  /**
   * NEVER EXPOSED TO THE MARKET. A deed is a deed and this one is real, but
   * the price was never tested — no marketing, no second bidder, no evidence
   * anybody else would have paid it. An appraiser takes an off-market print
   * and weights it down for exactly that reason; they do not throw it away,
   * because it is still somebody's money. See `tickLandComps`.
   */
  offMarket?: boolean;
  /**
   * THE APPRAISAL THIS LOT CARRIED ON THE DAY IT CLOSED — dirt only.
   *
   * A comp is a price at a date. Comparing it to an appraisal at a DIFFERENT
   * date measures the months in between and calls the answer location. See
   * `tickLandComps`, which divided by it and got the sign backwards for it.
   */
  mark?: number;
  /**
   * WHAT THE INDEX SAID IT WAS WORTH, AND THE INDEX, on the day it closed —
   * buildings only (2026-10-16). The cap-rate index follows where the
   * market's sales actually clear (market.ts): a print under the model's
   * value is the market saying yields are higher than the index thinks.
   */
  mv?: number; capAt?: number;
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
  offMarket?: boolean,
) {
  if (!rec || price <= 0) return;
  recordPropertyEvent(s, rec.bbl, {
    kind: "trade",
    party: buyer,
    otherParty: seller,
    amount: Math.round(price),
    outcome: distress ? "distress sale" : offMarket ? "off-market" : "marketed",
  });
  if (!s.comps) s.comps = [];
  const built = rec.class !== "land" && rec.bldgArea > 0;
  const cond = condition ?? initialCondition(rec);
  // A COMP IS A FACT, AND SO IS THE CAP RATE ON IT.
  //
  // "The going-in cap rate on the price actually paid" was half a promise: the
  // price was real and the income was the class model's guess, computed from a
  // ParcelRecord that cannot see a rent roll. Measured over 3,195 buildings,
  // that guess ran 89% occupancy against real rolls at 69% — so the comps
  // sheet, the only place in this game that reports facts rather than
  // opinions, was printing a market whose yields nobody had earned.
  //
  // The roll comes from whichever side of the trade has it: the deed that just
  // moved, or the offering memorandum it moved out of. Either way it is
  // re-assessed at the price actually paid, because a sale reassesses — which
  // is what makes this the GOING-IN cap and not the seller's in-place cap.
  const h = s.holdings[rec.bbl];
  const d: Disclosure | null = h
    ? { roll: h.tenants, occ: h.occ, cond: condition ?? h.condition }
    : disclosureFor(s, rec.bbl);
  const noi = !built ? 0
    : d ? holdingNOIYr(rec, s.econ, asIfOwned(s, rec.bbl, price, d, rec), s.month)
    : noiAfterTaxYr(rec, s.econ, cond, price);
  const px = Math.round(price);
  s.comps.push({
    m: s.month,
    bbl: rec.bbl,
    address: rec.address,
    cls: rec.class,
    price: px,
    sf: built ? rec.bldgArea : 0,
    psf: built ? price / Math.max(1, rec.bldgArea) : price / Math.max(1, rec.lotArea),
    capRate: built && price > 0 ? +((noi / price) * 100).toFixed(2) : 0,
    buyer, seller,
    distress: distress || undefined,
    offMarket: offMarket || undefined,
    // Stamped here because here is the only place that knows the date. Every
    // one of the twelve callers hands in a resolveRec'd record, so this is
    // bit-for-bit the number `tickLandComps` would have computed for this lot
    // this month — and unlike that one, it does not keep moving afterwards.
    mark: built ? undefined : landPsfNow(rec, s.econ) || undefined,
    ...(built ? { mv: Math.round(assetValue(rec, s.econ, cond)), capAt: +(s.econ.capRate?.[rec.class as "office"] ?? 0).toFixed(3) } : {}),
  });
  // Rolling sheet vs century volume. The buffer stays short for the UI; the
  // counters keep every print that ever closed so a long-horizon report is not
  // capped at MAX_COMPS (a fake ceiling on street activity — CLAUDE.md).
  // ...AND IT IS THE MARKET'S CAP RATE: every building that closes is a
  // print on the cap tape the class read is taken from (propmarket.ts).
  if (built) printTrade(s, rec, price, buyer, seller, cond, distress, offMarket);
  // ...AND EVERY LAND PRINT IS ON THE LAND INDEX'S TAPE, weighted by the same
  // rule the comps desk reads it by (landEvidenceWeight): one tape, one answer.
  else printLandTrade(s, rec, price, buyer, landEvidenceWeight(s.comps[s.comps.length - 1]));
  s.compsTotal = (s.compsTotal ?? 0) + 1;
  s.compsVolume = (s.compsVolume ?? 0) + px;
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
 * WHAT THE STREET IS ACTUALLY PAYING FOR DIRT — the comparable land sales.
 *
 * Dirt has no income of its own worth the name and no replacement cost; what
 * anybody knows about a lot's price is what can be built on it (the residual,
 * value.ts) and what the lots around it have been fetching. This is the
 * second half: every arm's-length land print in a district, read the way an
 * appraiser reads a land comp sheet, published for value.ts readLand to
 * reconcile with the residual (LAND_CREDIBILITY).
 *
 *   - THE UNIT IS THE ZONED ENVELOPE. Urban land is compared per square foot
 *     of floor area the zoning lets it carry ("price per buildable foot"):
 *     a lot that may carry 12 FAR is not a comp for one that may carry 2 at
 *     its price per foot of dirt. The envelope is the physical one the
 *     residual reads (farMaxFor x envelopeRealisation).
 *   - TIME IS ADJUSTED, AND OLD PRINTS FADE. A print is restated to today's
 *     dollars (the CPI on its closing month) and weighted by its age at a
 *     one-year half-life: lenders' appraisal rules want comparables closed
 *     inside twelve months and older ones explained (Fannie Mae Selling
 *     Guide B4-1.3-08). Past five years a print carries 3% of its weight and
 *     is dropped. So a district whose buyers have walked away loses its comps
 *     as they age and its dirt drifts to what the residual and the holder say
 *     — the old no-bid decay and the holders' capitulation were two halves of
 *     that, and neither reached a lot nobody could build on.
 *   - WHAT IS NOT A PRINT (landEvidenceWeight). A distress sale is the
 *     price of the compulsion (USPAP market value: neither party under
 *     compulsion). An off-market
 *     deed counts at reduced weight — most of it when it paid over the
 *     appraisal (an assembler's premium leaks), a third when it paid under
 *     (a favour, an estate). A farm, a plat lot or a subdivision tract trades
 *     to its own buyer and its own comps.
 *
 * The median, weighted, so one assemblage premium or one wild print cannot set
 * a district's price; no clamp on it. It draws no random numbers.
 *
 * THE OPENING SEED. Before any dirt has traded, the opening survey read at
 * the map's location texture stands in as one district's worth of prints
 * (LAND_CREDIBILITY) dated at the opening, ageing like any print
 * (`econ.landSeedW`). It is evidence, never a floor, and it is gone in a few
 * years.
 *
 * This replaced a per-district multiplier on the generator's stamped land
 * price (`landAdj`, clamped [0.25, 4]) under a floor at 0.30 x that stamp,
 * which priced 59% of the vacant lots; the variance multiplier (x1.22) and
 * the holders' capitulation wrote the same multiplier. `landAdj` is no longer
 * written; an old save's values only scale its opening seed.
 */
const LAND_HALF_LIFE_M = 12;   // Fannie Mae B4-1.3-08: comparables closed inside twelve months
const LAND_MAX_AGE_M = 60;     // five half-lives: 3% of a print's weight
export function tickLandComps(s: GameState, parcels: Record<string, ParcelRecord>) {
  // Appraisals are quarterly work. Nobody re-marks a book every month.
  if (s.month % 3 !== 0) return;
  const e = s.econ;
  // the opening seed ages from the first quarter this desk sits
  if (e.landSeedM === undefined) e.landSeedM = s.month;
  const seedAge = s.month - e.landSeedM;
  e.landSeedW = seedAge > LAND_MAX_AGE_M ? 0 : +(LAND_CREDIBILITY * Math.pow(0.5, seedAge / LAND_HALF_LIFE_M)).toPrecision(6);

  const cpiNow = e.cpi ?? 1;
  const cpiAt = new Map<number, number>();
  for (const p of e.history ?? []) if (p.cpi !== undefined) cpiAt.set(p.q, p.cpi);
  const byDist = new Map<string, { v: number; w: number }[]>();
  for (const c of s.comps ?? []) {
    const age = s.month - c.m;
    if (c.sf !== 0 || age < 0 || age > LAND_MAX_AGE_M || !(c.price > 0)) continue;
    const kind = landEvidenceWeight(c);
    if (!(kind > 0)) continue;
    const rec = resolveRec(parcels, s, c.bbl);
    if (!rec || !(rec.lotArea > 0) || rec.ag || rec.homeLot || rec.tract) continue;
    const env = rec.lotArea * farMaxFor(rec) * envelopeRealisation(rec);
    if (!(env > 0)) continue;
    const then = cpiAt.get(c.m) ?? cpiNow;
    const ppb = (c.price / env) * (cpiNow / Math.max(1e-9, then));
    if (!(ppb > 0) || !Number.isFinite(ppb)) continue;
    const w = kind * Math.pow(0.5, age / LAND_HALF_LIFE_M);
    const d = rec.district ?? "—";
    let g = byDist.get(d);
    if (!g) { g = []; byDist.set(d, g); }
    g.push({ v: ppb, w });
  }
  const out: NonNullable<typeof e.landComps> = {};
  for (const [d, g] of byDist) {
    const w = g.reduce((a, x) => a + x.w, 0);
    if (!(w > 0)) continue;
    out[d] = { ppb: +weightedMedian(g).toPrecision(6), w: +w.toPrecision(4), n: g.length, cpi: cpiNow };
  }
  e.landComps = out;
}

/**
 * HOW MUCH A LAND PRINT IS WORTH AS EVIDENCE — the one rule for the comps desk
 * (tickLandComps, what value.ts reconciles with the residual) and the land
 * index's tape (propmarket.ts printLandTrade), so the two read land off the
 * same prints at the same weights.
 *
 *   - A distress sale is the price of the compulsion, not of the land
 *     (USPAP market value: neither party under compulsion). Weight 0.
 *   - An off-market deed is a real price nobody tested: most of its weight
 *     when it paid over the appraisal (an assembler's premium leaks), a third
 *     when under (a favour, an estate). [K: stated weights, as before]
 *   - Anything else, marketed and closed: 1.
 */
export function landEvidenceWeight(c: Pick<Comp, "distress" | "offMarket" | "psf" | "mark">): number {
  if (c.distress) return 0;
  if (!c.offMarket) return 1;
  const ratio = c.mark && c.mark > 0 ? c.psf / c.mark : 1;
  return ratio >= 1 ? 0.75 : 0.35;
}

/** The weighted median: the value at which half the weight lies on each side. */
function weightedMedian(xs: { v: number; w: number }[]): number {
  const s = [...xs].sort((a, b) => a.v - b.v);
  const half = s.reduce((a, x) => a + x.w, 0) / 2;
  let acc = 0;
  for (const x of s) { acc += x.w; if (acc >= half) return x.v; }
  return s[s.length - 1]?.v ?? NaN;
}
