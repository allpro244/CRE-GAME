// WHERE A LETTER OF INTENT ACTUALLY COMES FROM.
//
// Leasing used to be a coin flip per building whose payoff was the building's
// own suite size. That made it connected to nothing: a 250,000 sf tower drew
// 250,000-sf-shaped letters and a 25,000 sf building drew 25,000-sf-shaped
// ones, so both filled in about the same number of months whatever the market
// was doing. Measured over 1,063 lease-ups spanning 1,744 building-years and
// every market state the engine can produce, it never once failed.
//
// A lease is not a coin flip. It is a share of a finite thing. The city has a
// quantity of tenant requirement in the market each month — firms moving,
// firms growing, firms arriving — and every vacant foot in town is competing
// for it: everybody else's, the space that rolls next year, and your own other
// buildings. What a building captures is its share of that requirement, and
// the terms of the share are the ones a leasing agent would actually name:
// how much space you are marketing, how good the building is, where it stands,
// what you are asking, and how much else there is to choose from.
//
// Nothing here is state. Every number is derived from the space market in
// market.ts and the parcels themselves, so the panel that explains a lease-up
// and the tick that decides one cannot disagree, and the save format does not
// move.
import type { ParcelRecord, ParcelTable } from "@/data/types";
import type { BuiltClass, Econ, GameState, Holding } from "./types";
import { CITY_STOCK, NATURAL_VAC, rng } from "./market";
import { resolveRec, useOccupancy, demandIdx, useRentPsfYr, managedRentPsfYr } from "./value";
import { useSf } from "./mix";
import { demandModel } from "./demand";

const clampA = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/**
 * GROSS NEW-LEASE VOLUME, as a share of citywide stock per year.
 *
 * Not net absorption — that is the change in occupied space, and it is a small
 * residual of a much larger churn. In a real market five to ten per cent of
 * the stock signs a NEW lease every year (relocations, expansions, arrivals,
 * backfill) while net absorption is a point or two either way. Renewals in
 * place are excluded: an incumbent renewing is not in the market and is not
 * touring your building.
 *
 * Shops turn over fastest and sheds slower than the headline suggests, because
 * an industrial lease is long but a shed changes hands whole.
 */
export const GROSS_TURNOVER: Record<BuiltClass, number> = {
  office: 0.088, retail: 0.072, industrial: 0.085, multifamily: 0,
};

/**
 * SPACE THAT IS NOT EMPTY YET AND IS ALREADY ON THE MARKET.
 *
 * Vacancy is not the whole of your competition. A floor whose lease expires in
 * fourteen months is being shown today, and the tenant you want is touring it.
 * This is that shadow, as a share of stock — it is why a market at its natural
 * vacancy rate is still a market you have to compete in.
 */
export const SHADOW_SUPPLY: Record<BuiltClass, number> = {
  office: 0.024, retail: 0.030, industrial: 0.018, multifamily: 0,
};

/** How much of the market a building is judged against is its own corner. */
export const LOCAL_WEIGHT = 0.6;

/**
 * WHY A BIG EMPTY BLOCK DOES NOT LEASE IN PROPORTION TO ITS SIZE.
 *
 * Capture is not linear in square feet. A tower with 250,000 sf standing dark
 * is not competing for six times the tenants of one with 40,000 sf available —
 * most requirements in any market are small, and a building offering nothing
 * but a quarter of a million feet is invisible to nearly all of them. Equally,
 * a building down to its last two suites is not down to a fortieth of the
 * traffic: small space is the most demanded space there is.
 *
 * `marketed` is the availability as the market actually sees it, and the
 * exponent is what turns "how many feet" into "how many tenants can use them".
 * At MARKETED_REF the two are the same number.
 */
export const MARKETED_REF: Record<BuiltClass, number> = {
  office: 40_000, retail: 14_000, industrial: 55_000, multifamily: 40_000,
};
export const MARKETED_ALPHA = 0.70;

/**
 * HOW BIG A REQUIREMENT IS — the city's distribution, not the building's.
 *
 * `[floor, ceiling, skew]`. This is the half of the old model that made
 * lease-up a formality: the letter's square footage was drawn off the
 * building's own suite size, so a big empty tower drew big lettings by
 * definition. A firm looking for eight thousand feet is looking for eight
 * thousand feet whoever owns the floor.
 */
export const REQ_SIZE: Record<string, [number, number, number]> = {
  office: [2_000, 120_000, 2.1], retail: [2_000, 40_000, 2.3], industrial: [10_000, 250_000, 1.9],
};
/** The mean of the draw above, so an arrival rate can be backed out of a rate of capture. */
export const REQ_MEAN: Record<string, number> = { office: 16_970, retail: 7_740, industrial: 50_130 };

/** One requirement, in square feet. */
export function drawRequirementSf(s: GameState, use: BuiltClass): number {
  const [lo, hi, skew] = REQ_SIZE[use] ?? REQ_SIZE.office;
  return Math.round(lo * Math.pow(hi / lo, Math.pow(rng(s), skew)));
}

/**
 * HOW MUCH SPACE THE CITY IS LOOKING FOR THIS MONTH, in square feet.
 *
 * Churn plus growth, moved by whether anyone is hiring. The growth leg comes
 * straight off the space market's own absorption, so a boom that the macro sim
 * says is happening is a boom the leasing desk feels; the churn leg is what
 * keeps a flat market from being a dead one.
 */
export function marketRequirement(e: Econ, use: BuiltClass): number {
  const stock = e.stock?.[use] ?? CITY_STOCK[use];
  const churn = (stock * (GROSS_TURNOVER[use] ?? 0)) / 12;
  const growth = Math.max(0, (e.absorb12?.[use] ?? 0) / 12);
  const phase = e.phase === "recession" ? -0.28 : e.phase === "recovery" ? -0.10
    : e.phase === "peak" ? 0.12 : 0.08;
  const mood = clampA(1 + 12 * (e.sectorMom?.[use] ?? 0) + phase, 0.5, 1.5);
  return Math.max(0, (churn + growth) * mood);
}

// ------------------------------------------------------------- the submarket
//
// "Citywide office vacancy is twelve per cent" is not a decision. "Office on
// your block and the ten around it is at nineteen while the city is at twelve"
// is one. The level comes from the space market, which is the authority on how
// much space there is and how much of it is used; the SHAPE comes from the
// parcels, which are the authority on where the good corners are. The two are
// combined by rescaling the modelled spatial pattern so its own city mean is
// the space market's number — so the map can never disagree with the economy.

interface NbVac { vac0: number; sf: number }
/** Neighbourhood vacancy by block, keyed by parcel table then by content. */
const NB_CACHE = new WeakMap<ParcelTable, Map<string, Map<string, NbVac>>>();
const CITY_KEY = "";

function nbTable(s: GameState, parcels: ParcelTable, use: BuiltClass): Map<string, NbVac> {
  let per = NB_CACHE.get(parcels);
  if (!per) { per = new Map(); NB_CACHE.set(parcels, per); }
  // The table only moves when the city gains a building, so it is keyed on the
  // built stock rather than on the month — a few dozen recomputes a century
  // instead of twelve hundred. The area in the key is what keeps two runs
  // sharing one parcel table from sharing each other's city.
  const built = s.built ?? {};
  let n = 0, area = 0;
  for (const k in built) { n++; area += built[k].bldgArea || 0; }
  const key = `${use}|${n}|${Math.round(area)}`;
  const hit = per.get(key);
  if (hit) return hit;

  const model = demandModel(parcels);
  // At a neutral cycle and with no lease-up curve, so the shape is the
  // building stock's own and the cycle is added back analytically below.
  const neutral = { ...s.econ, cycleDev: 0, m: undefined } as Econ;
  const bSf = new Map<string, number>(), bOcc = new Map<string, number>();
  for (const bbl of Object.keys(parcels)) {
    const rec = resolveRec(parcels, s, bbl);
    if (!rec || rec.class === "land" || !rec.bldgArea) continue;
    const a = useSf(rec, use);
    if (a <= 0) continue;
    const id = model.ofBbl.get(bbl);
    if (!id) continue;
    bSf.set(id, (bSf.get(id) ?? 0) + a);
    bOcc.set(id, (bOcc.get(id) ?? 0) + a * useOccupancy(rec, neutral, use));
  }
  const out = new Map<string, NbVac>();
  let totSf = 0, totVac = 0;
  for (const b of model.blocks.values()) {
    let S = 0, O = 0;
    for (const nb of b.neighbours) {
      S += (bSf.get(nb.id) ?? 0) * nb.w;
      O += (bOcc.get(nb.id) ?? 0) * nb.w;
    }
    if (S <= 0) continue;
    const v = 1 - O / S;
    out.set(b.id, { vac0: v, sf: S });
    const own = bSf.get(b.id) ?? 0;
    totSf += own; totVac += own * v;
  }
  out.set(CITY_KEY, { vac0: totSf > 0 ? totVac / totSf : 0.15, sf: totSf });
  if (per.size > 24) { const first = per.keys().next().value; if (first !== undefined) per.delete(first); }
  per.set(key, out);
  return out;
}

export interface LocalMarket {
  /** the space market's citywide rate for this class */
  cityVac: number;
  /** the same class, in this building's own corner */
  localVac: number;
  /** local against city, >1 means you are in the looser half of town */
  tilt: number;
  /** competing inventory within reach, in sf */
  nbSf: number;
  /** ...of which is available */
  nbVacantSf: number;
}

/**
 * VACANCY IN THIS BUILDING'S OWN CORNER.
 *
 * The block and everything within about two blocks of it, on the same weights
 * the demand surface uses, so "the neighbourhood" means one thing in this
 * engine and not two.
 */
export function localMarket(s: GameState, parcels: ParcelTable, rec: ParcelRecord, use: BuiltClass): LocalMarket {
  const cityVac = s.econ.cityVac?.[use] ?? NATURAL_VAC[use];
  const t = nbTable(s, parcels, use);
  const mean = t.get(CITY_KEY)!;
  const here = t.get(rec.block);
  // useOccupancy moves every building by the same swing on the cycle, so the
  // cycle can be added back without touching a single parcel again.
  const swing = use === "multifamily" ? 0.04 : 0.09;
  const meanNow = Math.max(0.02, mean.vac0 - swing * s.econ.cycleDev);
  let vacNow = Math.max(0.01, (here?.vac0 ?? mean.vac0) - swing * s.econ.cycleDev);
  const nbSf = here?.sf ?? mean.sf;
  let nbVacantSf = nbSf * vacNow;

  // YOUR OTHER BUILDINGS ARE SOMEBODY ELSE'S COMPETITION AND ALSO YOURS. Two
  // spec towers on the same corner are two spec towers on the same corner, and
  // the model should say so. The subject building itself is left out: its own
  // availability is the numerator of the share, and counting it twice would
  // charge a landlord for existing.
  const model = demandModel(parcels);
  const b = model.blocks.get(rec.block);
  if (b && nbSf > 0) {
    for (const bbl of Object.keys(s.holdings)) {
      if (bbl === rec.bbl) continue;
      const id = model.ofBbl.get(bbl);
      if (!id) continue;
      const nb = b.neighbours.find((x) => x.id === id);
      if (!nb) continue;
      const orec = resolveRec(parcels, s, bbl);
      const oh = s.holdings[bbl];
      if (!orec || !oh) continue;
      const legSf = useSf(orec, use);
      if (legSf <= 0) continue;
      const taken = oh.tenants.reduce((a, x) => a + ((x.use ?? orec.class) === use ? x.sf : 0), 0);
      const openSf = Math.max(0, legSf - taken);
      nbVacantSf += (openSf - legSf * vacNow) * nb.w;
    }
    nbVacantSf = clampA(nbVacantSf, nbSf * 0.01, nbSf * 0.75);
    vacNow = nbVacantSf / nbSf;
  }
  const tilt = clampA(Math.pow(vacNow / meanNow, 1.25), 0.4, 2.4);
  return { cityVac, localVac: clampA(cityVac * tilt, 0.01, 0.6), tilt, nbSf, nbVacantSf };
}

/** Every foot the tenant could take instead of yours, expressed citywide. */
export function competingSf(s: GameState, parcels: ParcelTable, rec: ParcelRecord, use: BuiltClass): {
  sf: number; lm: LocalMarket;
} {
  const stock = s.econ.stock?.[use] ?? CITY_STOCK[use];
  const lm = localMarket(s, parcels, rec, use);
  const city = stock * lm.cityVac;
  const local = stock * lm.localVac;
  const shadow = stock * (SHADOW_SUPPLY[use] ?? 0);
  return { sf: Math.max(1, (1 - LOCAL_WEIGHT) * city + LOCAL_WEIGHT * local + shadow), lm };
}

// ------------------------------------------------------------ the building
//
// One named multiplier per reason a tenant picks this building over the one
// across the street. They are named because the player has to be able to read
// why they are losing — a building that will not let for reasons nobody can
// see is not difficulty, it is a bug the player cannot report.

export interface LeaseFactor { label: string; detail: string; mult: number }

export function leaseFactors(s: GameState, rec: ParcelRecord, h: Holding, use: BuiltClass): LeaseFactor[] {
  const out: LeaseFactor[] = [];
  const d = demandIdx(rec.demandScore);
  out.push({
    label: "Location", detail: `demand ${Math.round(100 * d)} of 100`,
    mult: +clampA(Math.pow(d / 0.70, 1.1), 0.40, 1.55).toFixed(3),
  });
  out.push({
    label: "Condition", detail: h.condition,
    mult: h.condition === "good" ? 1.22 : h.condition === "worn" ? 0.76 : h.condition === "obsolete" ? 0.48 : 1,
  });
  const st = h.stance ?? 0;
  if (st !== 0) {
    out.push({
      label: "Your ask", detail: st > 0 ? "8% over the market" : "8% under the market",
      mult: +Math.pow(1 + 0.08 * st, -1.9).toFixed(3),
    });
  }
  // HOW THE BUILDING IS RUN. Not the switch — the three-year average of it, so
  // this row moves slowly and honestly and a player who cut the cleaning
  // contract in 2004 can see it here in 2007.
  const svc = h.svcIdx ?? 0.55;
  if (Math.abs(svc - 0.55) > 0.04) {
    out.push({
      label: "Building services",
      detail: svc > 0.55 ? "run to an institutional standard" : "run lean",
      mult: +(0.88 + 0.24 * svc).toFixed(3),
    });
  }
  if (h.broker) out.push({ label: "Leasing exclusive", detail: "a house working the phones", mult: 1.45 });
  const spec = h.specSuites;
  if (spec && spec.use === use && s.month >= spec.readyM) {
    out.push({ label: "Turnkey suites", detail: `${(spec.sf / 1000).toFixed(0)}k sf fitted and standing`, mult: 1.50 });
  }
  if (h.programsDone?.lobby !== undefined) out.push({ label: "Lobby", detail: "rebuilt", mult: 1.08 });
  if (h.programsDone?.facade !== undefined) out.push({ label: "Facade", detail: "rebuilt", mult: 1.06 });
  if (h.landmarked) out.push({ label: "Landmark", detail: "an address people know", mult: 1.06 });
  if (h.deliveredM !== undefined && s.month - h.deliveredM <= 30) {
    out.push({ label: "New building", detail: "brokers have been touring it since the steel", mult: 1.45 });
  }
  const mom = s.econ.sectorMom?.[use] ?? 0;
  if (Math.abs(mom) > 0.0008) {
    out.push({
      label: `${use} tenants`, detail: mom > 0 ? "the sector is taking space" : "the sector is handing space back",
      mult: +clampA(1 + 9 * mom, 0.72, 1.34).toFixed(3),
    });
  }
  return out;
}

/** All of the above, multiplied out. 1.0 is an ordinary building. */
export function buildingWeight(s: GameState, rec: ParcelRecord, h: Holding, use: BuiltClass): number {
  let w = 1;
  for (const f of leaseFactors(s, rec, h, use)) w *= f.mult;
  return w;
}

// ----------------------------------------------------------------- the odds

export interface LeasingOdds {
  use: BuiltClass;
  /** ready, vacant, in this leg */
  availSf: number;
  /** what the market sees — availability weighted by how many tenants can use it */
  marketedSf: number;
  competingSf: number;
  cityVac: number;
  localVac: number;
  /** how much space the whole city is looking for this month */
  requirementSf: number;
  shareOfMarket: number;
  /** expected square feet let per month at this pace */
  captureSf: number;
  /** months to 85% let at this pace — null when it is not happening */
  monthsToLet: number | null;
  /** the chance a letter arrives this month */
  loiOdds: number;
  typicalDealSf: number;
  askPsf: number;
  marketPsf: number;
  weight: number;
  factors: LeaseFactor[];
}

/** The one cap on how fast one building can transact, whatever the arithmetic says. */
export const LOI_ODDS_MAX = 0.85;

export function leasingOdds(
  s: GameState, parcels: ParcelTable, rec: ParcelRecord, h: Holding, use: BuiltClass,
): LeasingOdds | null {
  const legSf = useSf(rec, use);
  if (legSf <= 0) return null;
  const taken = h.tenants.reduce((a, t) => a + ((t.use ?? rec.class) === use ? t.sf : 0), 0);
  const turning = (h.makeReady ?? []).reduce((a, m) => a + (m.readyM > s.month && (m.use ?? use) === use ? m.sf : 0), 0);
  const availSf = Math.max(0, legSf - taken - turning);
  const ref = MARKETED_REF[use] ?? MARKETED_REF.office;
  const marketedSf = availSf > 0 ? ref * Math.pow(availSf / ref, MARKETED_ALPHA) : 0;
  const { sf: compete, lm } = competingSf(s, parcels, rec, use);
  const requirementSf = marketRequirement(s.econ, use);
  const factors = leaseFactors(s, rec, h, use);
  let weight = 1;
  for (const f of factors) weight *= f.mult;
  // A DARK BUILDING IS A HARDER SELL THAN A NEARLY FULL ONE. Nobody wants to
  // be the only name on the board, and a building with a rent roll shows
  // better than a building with a security desk and an echo.
  const dark = 0.85 + 0.15 * (taken / Math.max(1, legSf));
  const shareOfMarket = (marketedSf * weight * dark) / compete;
  const captureSf = requirementSf * shareOfMarket;
  const typicalDealSf = Math.max(1, Math.min(availSf, REQ_MEAN[use] ?? REQ_MEAN.office));
  const loiOdds = Math.min(LOI_ODDS_MAX, captureSf / typicalDealSf);

  // months to 85% let, in closed form: capture falls off as availability does,
  // at the exponent above, so the path is a power law rather than a guess.
  // Bounded by the same ceiling the tick is bounded by — one building can only
  // do so many deals a month however good the arithmetic looks.
  let monthsToLet: number | null = null;
  const target = legSf * 0.15;
  if (availSf <= target) monthsToLet = 0;
  else if (captureSf > 0) {
    const e = 1 - MARKETED_ALPHA;
    const c = (requirementSf * weight * dark / compete) * Math.pow(ref, e);
    const t = (Math.pow(availSf, e) - Math.pow(Math.max(1, target), e)) / (e * c);
    const floor = (availSf - target) / Math.max(1, LOI_ODDS_MAX * typicalDealSf);
    const tt = Math.max(t, floor);
    monthsToLet = tt > 0 && tt < 600 ? Math.round(tt) : null;
  }

  return {
    use, availSf, marketedSf, competingSf: compete,
    cityVac: lm.cityVac, localVac: lm.localVac,
    requirementSf, shareOfMarket, captureSf, monthsToLet, loiOdds, typicalDealSf,
    askPsf: managedRentPsfYr(rec, s.econ, h, use),
    marketPsf: useRentPsfYr(rec, s.econ, "standard", use),
    weight, factors,
  };
}
