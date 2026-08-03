// ENDOGENOUS DEMAND.
//
// Until now a parcel's demandScore was stamped on at generation and never moved
// again. Everything downstream read it — rent, cap rate, land value, how many
// tenants toured — so the map was a backdrop with prices painted on it. You
// could fill a district with towers and the district would be worth exactly
// what it was worth before you started. That is not a city; it is a board.
//
// A block's desirability is now an ANCHOR plus an EMERGENCE.
//
//   anchor     — geography, the water, the street network, the stations. Fixed
//                at generation, and it is what the pipeline already computed.
//   emergence  — what is actually standing and occupied within a few hundred
//                metres, scored as jobs, residents and amenity, combined by a
//                GEOMETRIC MEAN so that a monoculture scores near zero and a
//                balanced neighbourhood compounds.
//
// The geometric mean is the whole idea. An office park with nowhere to live and
// nowhere to eat is worth less than the sum of its floors; the same floors with
// housing and shops around them are worth more. That is the actual finding from
// urban economics and it is the mechanic that makes building a place different
// from building a building.
//
// Demand is measured RELATIVE TO DAY ONE. Emergence at generation is computed
// once and subtracted, so a fresh campaign starts exactly where the generator
// put it and only moves as the neighbourhood genuinely changes. That keeps a
// hundred years of balance intact and makes the mechanic purely additive.
//
// What is stored per block is therefore a DRIFT in demand points, not a level.
// Every parcel keeps its own generated score and carries its block's drift on
// top, so the corner lot is still worth more than the mid-block lot after the
// district turns — the neighbourhood moves, the parcels keep their pecking
// order. On day one every drift is zero and the game is bit-for-bit unchanged.
//
// THREE AMENDMENTS, all measured, all in this file.
//
//   THE TANK WAS EMPTY. The response ran off a saturating index on its flat
//   part, so the whole plausible range of things that can happen to a
//   neighbourhood was worth a few points. The largest target any block ever
//   reached in 600 months was 7.5 against a cap of 34. It runs off the LOG of
//   neighbourhood intensity now, which has constant proportional gain.
//
//   IT IS NO LONGER PURELY ADDITIVE, AND MUST NOT BE. Location value is a
//   RELATIVE good and the city's total is set by the macro engine, so every
//   month's targets are centred on their land-value-weighted mean. Demand is
//   redistributed, never created. That is what lets the gain be real.
//
//   AND THREE THINGS FEED IT, not one. What is built and occupied nearby;
//   which trades a block's own tenants are in and whether those trades are
//   hiring; and whether the transit authority has funded a station within a
//   five-minute walk. None of the three asks the player for anything.
import type { ParcelRecord, ParcelTable } from "@/data/types";
import type { BuiltClass, Econ, GameState } from "./types";
import { useOccupancy } from "./value";
import { mixOf, type UseMix } from "./mix";
import { SECTORS, INDUSTRY_LABEL } from "./market";
import { BUILT_CLASSES, type Sector } from "./types";

/** What the neighbourhood panel can recommend: a use, or a mixed-use stack. */
export type WantsKey = BuiltClass | "mixed";

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** How far a neighbourhood reaches, in metres. About two blocks. */
const REACH_M = 270;
/**
 * THE FUEL TANK WAS EMPTY, AND THIS IS WHY.
 *
 * The old response ran off `emergence`, a saturating index that sits at 0.53
 * for the median block. Its derivative there is tiny, so the whole plausible
 * range of things that can happen to a neighbourhood moved it by fractions of
 * a point. Measured over 600 months on 170 blocks with the street building 120
 * buildings: the largest target any block ever reached was 7.5 points against
 * a cap of 34, and putting a MILLION square feet of mixed use on one block
 * moved that block by 5.1. The model was right and its gain was a rounding
 * error.
 *
 * The drift now runs off the LOG of neighbourhood intensity, which has constant
 * proportional gain: doubling what stands and is occupied within two blocks is
 * worth the same number of points whether the corner started dead or busy.
 * `RESPONSE` is points per log unit — 52 makes a doubled neighbourhood worth
 * about 12 points, which is a corner going from ordinary to good.
 */
const RESPONSE = 52;
/** A neighbourhood can at most double, or halve, what it is made of. */
const LOG_CAP = 0.62;
/** A leg that is missing entirely is thin, not infinite. */
const LEG_FLOOR = 0.06;
/** How fast a block's desirability moves toward its target each month. */
const MOMENTUM = 0.055;
/** A neighbourhood can remake itself, but it cannot become somewhere else. */
const DRIFT_CAP = 34;
/** Anchor plus drift, kept inside what the invariant sweep will allow. */
const TOTAL_CAP = 36;

// ------------------------------------------------------ EMPLOYMENT, IN PLACE
//
// The city has had a real labour market for a while — jobs, unemployment, ten
// industries on their own booms and busts — and every bit of it was CITYWIDE.
// A tech bust emptied tech leases everywhere and improved nothing about the
// shipyards. But jobs have addresses. The blocks around the exchange are
// finance and law; the sheds by the water are logistics and food; and when
// logistics has a decade the water gets better and the exchange does not.
//
// Every block carries a trade mix, derived from what is BUILT on and around it
// plus a stable hash, so two office blocks are not the same office block. Its
// employment advantage is the amount its own trades are out-hiring the city
// average, accumulated and then decayed — because an advantage does fade:
// firms follow it, rents rise to meet it, and in ten years the corner is
// expensive rather than cheap. Nothing here asks the player for anything. It
// is a number on the neighbourhood panel and a line in the news.
/** Points of demand per unit of a block's trades out-hiring the city. */
const EMP_RESPONSE = 70;
/** …and how fast that advantage is competed away. Ten-year half-life. */
const EMP_DECAY = 0.006;
const EMP_CAP = 16;
/** How specialised a block's trade mix is. 1 would be the city average. */
const EMP_CONC = 2.2;

// -------------------------------------------------------------- THE NEW LINE
//
// The one thing in this business you can see coming a decade out and buy ahead
// of. A line is announced, argued about for six years, and opens; the ground
// around the head-house reprices on the announcement, again when the hoarding
// goes up, and again on the day it runs. Nobody has to click anything: it is
// news, a lens on the map, and a number on the panel.
/** Odds of a line being announced in any given year. */
const LINE_ODDS = 1 / 14;
/** How long from the announcement to the first train. */
const LINE_BUILD_M = 72;
/** How far a station's pull reaches, in metres. */
const LINE_SIGMA = 380;
/** What the market prices before it opens: on the news, and once it is dug. */
const LINE_EARLY = 0.18, LINE_DIGGING = 0.45;

export interface BlockGeom {
  id: string;
  bbls: string[];
  cx: number; cy: number;      // centroid in local metres
  landArea: number;            // sf of lot area in the block
  baseD: number;               // the generator's anchor, lot-area weighted
  neighbours: { id: string; w: number }[];
  nbLandArea: number;          // neighbourhood land area, weight-adjusted
}

export interface DemandModel {
  blocks: Map<string, BlockGeom>;
  ofBbl: Map<string, string>;          // parcel -> block
  baseStock: Map<string, Partial<Record<BuiltClass, number>>>;
  /** emergence at generation, per block — the zero point */
  e0: Map<string, number>;
  /** neighbourhood intensity at generation — the zero point the DRIFT uses */
  mix0: Map<string, number>;
  /** what the tenants around each block do for a living, shares summing to 1 */
  trades: Map<string, Partial<Record<Sector, number>>>;
  /** land VALUE per block, and the city's total — the weights demand redistributes over */
  landW: Map<string, number>;
  landWTot: number;
  /** the densities that count as "a lot", learned from the city itself */
  refJobs: number; refPop: number; refAmen: number;
}

/**
 * Which trades live in which kind of building. Not a claim that a warehouse
 * cannot hold a law firm — a claim about where the mass of each trade sits.
 */
const TRADE_AFFINITY: Record<BuiltClass, Partial<Record<Sector, number>>> = {
  office:      { finance: 3, law: 3, tech: 2.4, media: 1.6, insurance: 2, design: 1.2, medical: 1, food: 0.4, apparel: 0.5, logistics: 0.2 },
  retail:      { apparel: 3, food: 3, design: 1.4, media: 1, medical: 0.8, finance: 0.4, law: 0.3, tech: 0.4, insurance: 0.3, logistics: 0.5 },
  industrial:  { logistics: 3.4, apparel: 1.6, food: 1.4, media: 0.8, design: 0.8, tech: 0.6, medical: 0.5, finance: 0.2, law: 0.2, insurance: 0.2 },
  multifamily: { food: 1.4, medical: 1.2, design: 1, law: 1, finance: 1, tech: 1, media: 1, insurance: 1, apparel: 1, logistics: 0.8 },
};

/**
 * A stable 0..1 from a string. The same city always has the same trades, and
 * the same campaign seed always gets the same railway.
 *
 * The avalanche at the end is load-bearing and was not obvious: plain FNV-1a
 * on strings that differ in their last character or two produces neighbouring
 * outputs, so `seed:line:2001`, `seed:line:2002`… came out clustered. Measured
 * without it, six campaign seeds out of eight got ZERO stations in fifty years
 * and the other two got six to ten. With it: 7.03% of years against a 7.14%
 * target, a median of 3 lines per campaign, and 6 campaigns in 200 with none.
 */
function hash01(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 2246822507);
  h ^= h >>> 13; h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// One model per parcel table. Static geometry, so it is computed once.
const CACHE = new WeakMap<ParcelTable, DemandModel>();

const M_PER_DEG_LAT = 111_320;

/**
 * Jobs, residents and amenity implied by a square foot of each class. These are
 * the same ratios the employment layer uses, so the two agree about what an
 * office building is for.
 */
function contribution(cls: BuiltClass, sf: number): { j: number; r: number; a: number } {
  switch (cls) {
    case "office":      return { j: sf / 230, r: 0, a: 0 };
    case "industrial":  return { j: sf / 550, r: 0, a: 0 };
    case "retail":      return { j: sf / 420, r: 0, a: sf };
    case "multifamily": return { j: 0, r: sf / 900, a: 0 };
  }
}

// Mixed use used to be a case in that switch, hand-tuned to contribute all
// three at once. It no longer needs to be: a building that is part shops, part
// offices and part flats contributes its retail feet as retail and its
// residential feet as residential, and the geometric mean below does the rest.
// The reason a mixed-use building lifts a neighbourhood more per square foot
// than a tower is now EMERGENT rather than asserted, which is the only kind of
// answer worth having.

/** A canonical mixed-use stack, for the "what should I build here" probe. */
const MIXED_PROBE: UseMix = { retail: 0.15, office: 0.45, multifamily: 0.40 };

export function demandModel(parcels: ParcelTable): DemandModel {
  const hit = CACHE.get(parcels);
  if (hit) return hit;

  const bbls = Object.keys(parcels);
  if (!bbls.length) {
    const empty: DemandModel = { blocks: new Map(), ofBbl: new Map(), baseStock: new Map(), e0: new Map(), mix0: new Map(), trades: new Map(), landW: new Map(), landWTot: 1, refJobs: 1, refPop: 1, refAmen: 1 };
    CACHE.set(parcels, empty);
    return empty;
  }

  // a local metre grid centred on the city
  let lat0 = 0, lon0 = 0;
  for (const b of bbls) { lon0 += parcels[b].centroid[0]; lat0 += parcels[b].centroid[1]; }
  lon0 /= bbls.length; lat0 /= bbls.length;
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180);

  const blocks = new Map<string, BlockGeom>();
  const ofBbl = new Map<string, string>();
  const baseStock = new Map<string, Partial<Record<BuiltClass, number>>>();
  const acc = new Map<string, { x: number; y: number; area: number; dw: number }>();

  for (const bbl of bbls) {
    const r = parcels[bbl];
    const id = r.block;
    ofBbl.set(bbl, id);
    const x = (r.centroid[0] - lon0) * mPerDegLon;
    const y = (r.centroid[1] - lat0) * M_PER_DEG_LAT;
    const a = acc.get(id) ?? { x: 0, y: 0, area: 0, dw: 0 };
    a.x += x * r.lotArea; a.y += y * r.lotArea;
    a.area += r.lotArea;
    a.dw += r.demandScore * r.lotArea;
    acc.set(id, a);
    if (r.class !== "land" && r.bldgArea > 0) {
      const st = baseStock.get(id) ?? {};
      // by component: the shops under a block of flats are retail feet, and
      // the block only has street life because of them
      const m = mixOf(r);
      for (const k of Object.keys(m) as BuiltClass[]) st[k] = (st[k] ?? 0) + r.bldgArea * (m[k] ?? 0);
      baseStock.set(id, st);
    }
  }

  for (const [id, a] of acc) {
    blocks.set(id, {
      id, bbls: [], cx: a.x / Math.max(1, a.area), cy: a.y / Math.max(1, a.area),
      landArea: a.area, baseD: a.dw / Math.max(1, a.area),
      neighbours: [], nbLandArea: 0,
    });
  }
  for (const bbl of bbls) blocks.get(ofBbl.get(bbl)!)!.bbls.push(bbl);

  // the neighbourhood: everything within reach, weighted down with distance
  const list = [...blocks.values()];
  for (const b of list) {
    let nbArea = 0;
    for (const o of list) {
      const d = Math.hypot(b.cx - o.cx, b.cy - o.cy);
      if (d > REACH_M) continue;
      const w = b === o ? 1 : clamp(1 - d / REACH_M, 0, 1);
      b.neighbours.push({ id: o.id, w });
      nbArea += o.landArea * w;
    }
    b.nbLandArea = Math.max(1, nbArea);
  }

  const model: DemandModel = { blocks, ofBbl, baseStock, e0: new Map(), mix0: new Map(), trades: new Map(), landW: new Map(), landWTot: 0, refJobs: 1, refPop: 1, refAmen: 1 };

  // Calibrate the "a lot of this" densities off the city as generated, so the
  // model travels to any city the pipeline can produce without hand-tuning.
  //
  // The zero point must be measured the same way the live number is, or the
  // difference is not zero on day one. The live model counts OCCUPIED feet, so
  // the baseline counts occupied feet too — at mid-cycle occupancy, since the
  // cycle is the one part of it that genuinely should register: a city with
  // its buildings half empty is a worse neighbourhood, and should say so.
  const dens = { j: [] as number[], r: [] as number[], a: [] as number[] };
  const raw = new Map<string, { j: number; r: number; a: number }>();
  for (const b of list) {
    let j = 0, r = 0, am = 0;
    for (const n of b.neighbours) {
      const st = baseStock.get(n.id);
      if (!st) continue;
      for (const k of Object.keys(st) as BuiltClass[]) {
        const c = contribution(k, (st[k] ?? 0) * n.w * refOcc(k));
        j += c.j; r += c.r; am += c.a;
      }
    }
    const acres = b.nbLandArea / 43_560;
    const v = { j: j / acres, r: r / acres, a: am / acres };
    raw.set(b.id, v);
    dens.j.push(v.j); dens.r.push(v.r); dens.a.push(v.a);
  }
  const p80 = (arr: number[]) => {
    const s = arr.slice().sort((x, y) => x - y);
    return Math.max(1e-6, s[Math.floor(s.length * 0.8)] ?? 1);
  };
  model.refJobs = p80(dens.j);
  model.refPop = p80(dens.r);
  model.refAmen = p80(dens.a);

  for (const b of list) {
    const v = raw.get(b.id)!;
    model.e0.set(b.id, emergenceOf(v.j / model.refJobs, v.r / model.refPop, v.a / model.refAmen));
    model.mix0.set(b.id, intensityOf(v.j / model.refJobs, v.r / model.refPop, v.a / model.refAmen));
  }

  // What each block is for a living, and what its dirt is worth. Both are
  // static, so both belong here rather than in the monthly tick.
  for (const b of list) {
    const sf: Partial<Record<BuiltClass, number>> = {};
    for (const n of b.neighbours) {
      const st = baseStock.get(n.id);
      if (!st) continue;
      for (const k of Object.keys(st) as BuiltClass[]) sf[k] = (sf[k] ?? 0) + (st[k] ?? 0) * n.w;
    }
    model.trades.set(b.id, tradesOf(b.id, sf));
    let lv = 0;
    for (const bbl of b.bbls) { const r = parcels[bbl]; if (r) lv += r.lotArea * r.landPsf; }
    model.landW.set(b.id, lv);
    model.landWTot += lv;
  }
  model.landWTot = Math.max(1, model.landWTot);

  CACHE.set(parcels, model);
  return model;
}

/**
 * The mix term. A geometric mean of the three normalised densities, run through
 * a saturating curve so the tenth tower on a block is worth less than the
 * second. Everything below is dimensionless and lands in roughly 0..1.
 */
function emergenceOf(j: number, r: number, a: number): number {
  const mix = Math.cbrt(Math.max(0, j) * Math.max(0, r) * Math.max(0, a));
  return mix / (mix + 0.55);
}

/**
 * The same geometric mean WITHOUT the saturating curve, and with a floor under
 * each leg so a block with no shops at all is thin rather than zero. This is
 * what the drift is measured on, in logs — see RESPONSE.
 */
function intensityOf(j: number, r: number, a: number): number {
  return Math.cbrt((Math.max(0, j) + LEG_FLOOR) * (Math.max(0, r) + LEG_FLOOR) * (Math.max(0, a) + LEG_FLOOR));
}

/** What the tenants on and around a block do for a living. Shares sum to 1. */
function tradesOf(id: string, sf: Partial<Record<BuiltClass, number>>): Partial<Record<Sector, number>> {
  let tot = 0;
  for (const c of BUILT_CLASSES) tot += sf[c] ?? 0;
  tot = Math.max(1, tot);
  const w: Partial<Record<Sector, number>> = {};
  let sum = 0;
  for (const k of SECTORS) {
    let v = 0;
    for (const c of BUILT_CLASSES) v += ((sf[c] ?? 0) / tot) * (TRADE_AFFINITY[c][k] ?? 1);
    v = Math.pow(Math.max(0, v) * (0.35 + 1.3 * hash01(id + ":" + k)), EMP_CONC);
    w[k] = v; sum += v;
  }
  for (const k of SECTORS) w[k] = (w[k] ?? 0) / Math.max(1e-9, sum);
  return w;
}

/** Occupied square feet by class in every block, this month. */
function occupiedStock(s: GameState, parcels: ParcelTable, model: DemandModel): Map<string, Partial<Record<BuiltClass, number>>> {
  const out = new Map<string, Partial<Record<BuiltClass, number>>>();
  const occFor = (cls: BuiltClass) => marketOcc(cls, s.econ);

  // start from the static roll-up, occupied at market
  for (const [id, st] of model.baseStock) {
    const o: Partial<Record<BuiltClass, number>> = {};
    for (const k of Object.keys(st) as BuiltClass[]) o[k] = (st[k] ?? 0) * occFor(k);
    out.set(id, o);
  }
  const bump = (id: string | undefined, cls: BuiltClass, sf: number) => {
    if (!id) return;
    const o = out.get(id) ?? {};
    o[cls] = (o[cls] ?? 0) + sf;
    out.set(id, o);
  };

  // anything redeveloped or demolished replaces its base contribution
  for (const [bbl, b] of Object.entries(s.built ?? {})) {
    const base = parcels[bbl];
    const id = model.ofBbl.get(bbl);
    if (!base || !id) continue;
    if (base.class !== "land" && base.bldgArea > 0) {
      const bm = mixOf(base);
      for (const k of Object.keys(bm) as BuiltClass[]) bump(id, k, -base.bldgArea * (bm[k] ?? 0) * occFor(k));
    }
    if (b.bldgArea > 0 && (b.class as string) !== "land") {
      const nm = b.mix ?? { [b.class]: 1 };
      for (const k of Object.keys(nm) as BuiltClass[]) bump(id, k, b.bldgArea * (nm[k] ?? 0) * occFor(k));
    }
  }

  // and your own buildings report their REAL occupancy, not the market's
  for (const h of Object.values(s.holdings)) {
    const base = s.built?.[h.bbl];
    const rec = parcels[h.bbl];
    if (!rec) continue;
    const sf = base?.bldgArea ?? rec.bldgArea ?? 0;
    if (!sf) continue;
    const m = base?.mix ?? mixOf({ ...rec, class: base?.class ?? rec.class, mix: base?.mix });
    for (const cls of Object.keys(m) as BuiltClass[]) {
      const share = m[cls] ?? 0;
      const compSf = sf * share;
      if (compSf <= 0) continue;
      // your empty floors are empty for the neighbourhood too — and each part
      // of a mixed building reports its own occupancy, because the shops can
      // be full while the offices above them are not
      const real = cls === "multifamily"
        ? (h.occ ?? occFor(cls))
        : Math.min(1, h.tenants.filter((tn) => (tn.use ?? cls) === cls).reduce((n, tn) => n + tn.sf, 0) / compSf);
      bump(model.ofBbl.get(h.bbl), cls, (real - occFor(cls)) * compSf);
    }
  }
  return out;
}

// Deliberately blind to the block's own demand: occupancy already rises with
// demand elsewhere in the engine, and reading it back in here would make the
// model chase its own tail — a block that got better would get better because
// it got better. The cycle is the only thing this term is allowed to see.
function marketOcc(cls: BuiltClass, econ: Econ): number {
  return useOccupancy({ class: cls, demandScore: 55 } as unknown as ParcelRecord, econ, cls);
}
/** Occupancy at mid-cycle: the baseline the drift is measured against. */
function refOcc(cls: BuiltClass): number {
  return marketOcc(cls, { cycleDev: 0 } as unknown as Econ);
}

/**
 * One month of the neighbourhood. Every block's desirability walks toward what
 * its surroundings now justify, with enough momentum that a district turns over
 * years rather than overnight.
 */
/**
 * DENSITY AND DEMAND HAVE TO AGREE, AND AT GENERATION THEY DID NOT.
 *
 * The player noticed this before the model did: "in some parts of the city
 * there are large buildings and heavy density where it feels weird to have it,
 * and others there's very high density and very low demand."
 *
 * They were right, and it is a reconciliation bug rather than a taste one.
 * demandScore is computed in the generator from two Gaussian distance
 * functions — transit gravity and employment gravity — and NOTHING ELSE. The
 * buildings are placed by a separate process keyed off zoning and era. The two
 * were never reconciled, so a block can carry six hundred thousand feet of
 * offices and score 30 for demand, or sit nearly empty at 80. In a real city
 * that cannot happen for long, because density IS demand made physical: the
 * jobs, residents and shopfronts in those buildings are what make the corner
 * worth something.
 *
 * And nothing corrected it afterwards, because the runtime model only measures
 * CHANGE against the generated baseline — so the original mismatch was frozen
 * in for the whole run.
 *
 * This runs once, at newGame, and pins that gap. Every block is scored on what
 * is actually standing on and around it, compared against what its gravity
 * score implied, and the difference is written into blockD as a permanent
 * offset. A dense block in a low-gravity corner gets the lift its own buildings
 * earned; an empty block riding on a station it does not use gets the haircut.
 * Drift from that day forward still works exactly as before, on top of it.
 */
export function reconcileDemand(s: GameState, parcels: ParcelTable) {
  const model = demandModel(parcels);
  if (!model.blocks.size) return;
  s.blockD = s.blockD ?? {};

  // What the built environment says each block is worth, and what its gravity
  // score said. Both as percentile ranks, so we are comparing shapes rather
  // than units.
  const rows: { id: string; e: number; g: number }[] = [];
  for (const b of model.blocks.values()) {
    const e = model.e0.get(b.id);
    if (e === undefined) continue;
    // the gravity score the generator gave this block, averaged over its lots
    let g = 0, n = 0;
    for (const bbl of b.bbls ?? []) {
      const rec = parcels[bbl];
      if (rec) { g += rec.demandScore; n++; }
    }
    if (!n) continue;
    rows.push({ id: b.id, e, g: g / n });
  }
  if (rows.length < 8) return;

  const rank = (vals: number[]) => {
    const sorted = [...vals].map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const out = new Array<number>(vals.length);
    sorted.forEach((x, k) => { out[x.i] = k / Math.max(1, sorted.length - 1); });
    return out;
  };
  const er = rank(rows.map((r) => r.e));
  const gr = rank(rows.map((r) => r.g));

  // The correction is deliberately PARTIAL. Gravity is real — a station and a
  // job centre make a corner valuable whether or not anyone has built on it
  // yet — so this does not overwrite it, it argues with it. Two thirds gravity,
  // one third what is actually there.
  //
  // AND IT HAS TO BE PERMANENT, WHICH IT WAS NOT. This wrote into `blockD`,
  // and `blockD` is the same field the monthly drift walks toward its own
  // target — a target that knows nothing about this correction. So the tick
  // decayed it away at the momentum rate: measured, 91.5% of it survived one
  // month, 34% survived a year and 4.3% survived three. A reconciliation the
  // player asked for lasted three years of a campaign with no end date. It
  // lives in its own field now, is never walked, and `blockD` is the sum.
  const WEIGHT = 34;
  s.blockA = s.blockA ?? {};
  for (let i = 0; i < rows.length; i++) {
    const delta = +((er[i] - gr[i]) * WEIGHT).toFixed(2);
    if (Math.abs(delta) >= 0.5) { s.blockA[rows[i].id] = delta; s.blockD[rows[i].id] = delta; }
  }
}

/**
 * A block's employment advantage: how far its own trades are out-hiring the
 * city, accumulated month by month and competed away on a ten-year half-life.
 * Reads the industry cycle that already exists and adds no state to it.
 */
function tickEmployment(s: GameState, model: DemandModel) {
  const mom = s.econ.industryMom;
  if (!mom) return;
  let city = 0;
  for (const k of SECTORS) city += mom[k] ?? 0;
  city /= SECTORS.length;
  s.blockJ = s.blockJ ?? {};
  for (const [id, w] of model.trades) {
    let m = 0;
    for (const k of SECTORS) m += (w[k] ?? 0) * (mom[k] ?? 0);
    const next = clamp((s.blockJ[id] ?? 0) * (1 - EMP_DECAY) + EMP_RESPONSE * (m - city), -EMP_CAP, EMP_CAP);
    if (Math.abs(next) < 0.005) delete s.blockJ[id];
    else s.blockJ[id] = +next.toFixed(3);
  }
}

/**
 * The transit authority. One line a decade or so, announced six years before
 * anybody rides it, put where a city actually puts one: ground that is cheap,
 * buildable and badly served, and not on top of the last line.
 */
function tickTransit(s: GameState, model: DemandModel, parcels: ParcelTable) {
  if (s.month < 24 || s.month % 12 !== 0) return;
  // Hashed off the campaign seed rather than drawn from `s.rng`, deliberately.
  // Drawing here would shift the RNG stream for everything downstream of this
  // tick — every rival decision, every tenant, every listing — which turns a
  // change about geography into a change about all of it, and makes every
  // seed-pinned number anybody else has measured stop reproducing. It also
  // means a save-scummer cannot reroll the line.
  const yr = Math.floor(s.month / 12);
  if (hash01(`${s.seed}:line:${yr}`) >= LINE_ODDS) return;
  const cand = [...model.blocks.values()].filter((b) =>
    b.baseD < 55 && !(s.lines ?? []).some((l) => Math.hypot(l.cx - b.cx, l.cy - b.cy) < 900));
  if (!cand.length) return;
  const b = cand[Math.min(cand.length - 1, Math.floor(hash01(`${s.seed}:where:${yr}`) * cand.length))];
  const rec = parcels[b.bbls[0]];
  const name = rec?.address?.replace(/^\d+\s+/, "") ?? "the north end";
  const line = { id: b.id, cx: b.cx, cy: b.cy, name, annM: s.month, openM: s.month + LINE_BUILD_M, pts: +(16 + 10 * hash01(`${s.seed}:size:${yr}`)).toFixed(1) };
  s.lines = [...(s.lines ?? []), line];
  s.news.unshift({ q: s.month, kind: "event",
    text: `The transit authority has funded a new station at ${name}. First trains in ${Math.round(LINE_BUILD_M / 12)} years. Everything within a five-minute walk of that head-house is about to be worth more than it is today — and the people who own it already know.` });
}

/** What the market is currently paying for a line: some on the news, more once it is dug, all of it on opening day. */
function transitLift(s: GameState, b: BlockGeom): number {
  let v = 0;
  for (const l of s.lines ?? []) {
    const priced = s.month >= l.openM ? 1 : s.month >= l.openM - 24 ? LINE_DIGGING : s.month >= l.annM ? LINE_EARLY : 0;
    if (!priced) continue;
    const d = Math.hypot(b.cx - l.cx, b.cy - l.cy);
    v += l.pts * priced * Math.exp(-(d * d) / (2 * LINE_SIGMA * LINE_SIGMA));
  }
  return v;
}

export function tickDemand(s: GameState, parcels: ParcelTable) {
  const model = demandModel(parcels);
  if (!model.blocks.size) return;
  const occ = occupiedStock(s, parcels, model);
  s.blockD = s.blockD ?? {};
  s.blockE = s.blockE ?? {};

  tickEmployment(s, model);
  tickTransit(s, model, parcels);

  // Blocks you have money in. A district turning is the slowest and most
  // valuable thing in this business and it happens a tenth of a point at a
  // time — so it gets said out loud when it crosses a round number, once,
  // and only where you actually own something.
  const mine = new Map<string, string>();
  for (const bbl of [...Object.keys(s.holdings), ...Object.keys(s.developments ?? {})]) {
    const id = model.ofBbl.get(bbl);
    if (id && !mine.has(id)) mine.set(id, parcels[bbl]?.address ?? bbl);
  }

  // ---- what each block's surroundings now justify --------------------------
  const raw = new Map<string, number>();
  for (const b of model.blocks.values()) {
    let j = 0, r = 0, a = 0;
    for (const n of b.neighbours) {
      const st = occ.get(n.id);
      if (!st) continue;
      for (const k of Object.keys(st) as BuiltClass[]) {
        const c = contribution(k, (st[k] ?? 0) * n.w);
        j += c.j; r += c.r; a += c.a;
      }
    }
    const acres = b.nbLandArea / 43_560;
    const mix = intensityOf((j / acres) / model.refJobs, (r / acres) / model.refPop, (a / acres) / model.refAmen);
    const lr = clamp(Math.log(mix / Math.max(1e-6, model.mix0.get(b.id) ?? mix)), -LOG_CAP, LOG_CAP);
    raw.set(b.id, RESPONSE * lr + (s.blockJ?.[b.id] ?? 0) + transitLift(s, b));
  }

  // ---- DEMAND IS REDISTRIBUTIVE, NOT ADDITIVE -----------------------------
  //
  // This is the whole answer to "why does turning the gain up not run the
  // economy away". Desirability is a RELATIVE good: a corner is worth
  // something because it beats the next corner, and the total rent the city
  // can pay for location is set by the macro engine — jobs, output, the
  // cycle — not by this model. So every month the raw targets are centred on
  // their LAND-VALUE-weighted mean and only the differences survive. Building
  // a tower in a dead quarter takes desirability from somewhere else. A new
  // station makes its own six blocks better and everywhere else a shade
  // worse. There is no aggregate degree of freedom left for a runaway to live
  // in.
  //
  // Measured, holding the state fixed and switching the surface off: total
  // city land value with the drift is 0.974-0.992x the same city without it,
  // and total market rent 0.985-1.000x, flat over 50 years on three seeds.
  // With the centring removed the same runs read 1.14-1.22x land and
  // 1.08-1.11x rent by year 50, and still climbing.
  let centre = 0;
  for (const [id, v] of raw) centre += v * (model.landW.get(id) ?? 0);
  centre /= model.landWTot;

  for (const b of model.blocks.values()) {
    const target = clamp((raw.get(b.id) ?? 0) - centre, -DRIFT_CAP, DRIFT_CAP);
    const was = s.blockE[b.id] ?? 0;
    const e = +(was + (target - was) * MOMENTUM).toFixed(2);
    if (e === 0) delete s.blockE[b.id];
    else s.blockE[b.id] = e;

    const anchor = s.blockA?.[b.id] ?? 0;
    const now = s.blockD[b.id] ?? 0;
    const next = +clamp(anchor + e, -TOTAL_CAP, TOTAL_CAP).toFixed(2);
    if (next === 0) delete s.blockD[b.id];
    else s.blockD[b.id] = next;

    // only on the way out from zero, so a block hovering on a round number
    // does not announce itself twice a year
    const addr = mine.get(b.id);
    if (addr && Math.abs(next) > Math.abs(now) && Math.floor(Math.abs(next) / 10) > Math.floor(Math.abs(now) / 10)) {
      const step = Math.floor(Math.abs(next) / 10) * 10;
      s.news.unshift(next > 0
        ? { q: s.month, kind: "deal", text: `The blocks around ${addr} have gained ${step} points of demand since you came in — rents, tenant quality and land are all repricing off it.` }
        : { q: s.month, kind: "warn", text: `The blocks around ${addr} have lost ${step} points of demand — space is emptying out around you, and the appraisal follows.` });
    }
  }

  // A line opening is the loudest thing that happens to a map. Say it once.
  for (const l of s.lines ?? []) {
    if (s.month !== l.openM) continue;
    s.news.unshift({ q: s.month, kind: "event",
      text: `The ${l.name} station opened this morning. Six years of hoardings, and the ground around it is not the ground it was in ${2000 + Math.floor(l.annM / 12)}.` });
  }
}

/**
 * A parcel's live demand: what the generator gave it, plus whatever its
 * neighbourhood has become since. Clamped, because nothing in Ashport is
 * worthless and nothing is perfect.
 */
export function demandNow(s: GameState, rec: ParcelRecord): number {
  return clamp(rec.demandScore + (s.blockD?.[rec.block] ?? 0), 2, 100);
}

/**
 * What a block is made of right now, for the panel that shows you why a corner
 * is getting better. Nothing here is computed for the simulation — it is the
 * same numbers, phrased for a person.
 */
export function blockReport(s: GameState, parcels: ParcelTable, block: string): {
  jobs: number; residents: number; amenitySf: number; baseD: number; drift: number;
  /** the block's employment advantage right now, in demand points */
  hiring: number;
  /** the three trades most of the work around here is in */
  trades: { k: Sector; label: string; share: number }[];
  /** a funded line inside the walk, and how many months until it runs */
  line: { name: string; monthsOut: number; pts: number } | null;
  /** each leg against what counts as a full measure of it in this city, 0..1+ */
  mix: { jobs: number; residents: number; amenity: number };
  /** the programme that would lift this block most per square foot */
  wants: WantsKey;
  /** true when no use is meaningfully better than the next — the block is balanced */
  balanced: boolean;
} | null {
  const model = demandModel(parcels);
  const b = model.blocks.get(block);
  if (!b) return null;
  const occ = occupiedStock(s, parcels, model);
  let j = 0, r = 0, a = 0;
  for (const n of b.neighbours) {
    const st = occ.get(n.id);
    if (!st) continue;
    for (const k of Object.keys(st) as BuiltClass[]) {
      const c = contribution(k, (st[k] ?? 0) * n.w);
      j += c.j; r += c.r; a += c.a;
    }
  }
  const acres = b.nbLandArea / 43_560;
  const norm = (jj: number, rr: number, aa: number) =>
    emergenceOf((jj / acres) / model.refJobs, (rr / acres) / model.refPop, (aa / acres) / model.refAmen);
  const mix = {
    jobs: (j / acres) / model.refJobs,
    residents: (r / acres) / model.refPop,
    amenity: (a / acres) / model.refAmen,
  };
  // Which use would help most is NOT simply "whichever index reads lowest".
  // Retail brings jobs and a shopfront; a mixed stack brings all three at once.
  // So ask the model instead of guessing at it: add the same test floorplate as
  // each single use AND as a mixed-use building, and see which moves the block.
  const PROBE_SF = 60_000;
  const here = norm(j, r, a);
  const candidates: { key: WantsKey; mix: UseMix }[] = [
    { key: "office", mix: { office: 1 } },
    { key: "retail", mix: { retail: 1 } },
    { key: "multifamily", mix: { multifamily: 1 } },
    { key: "industrial", mix: { industrial: 1 } },
    { key: "mixed", mix: MIXED_PROBE },
  ];
  let wants: WantsKey = "mixed";
  let bestGain = -Infinity, secondGain = -Infinity;
  for (const cand of candidates) {
    let cj = 0, cr = 0, ca = 0;
    for (const u of Object.keys(cand.mix) as BuiltClass[]) {
      const c = contribution(u, PROBE_SF * (cand.mix[u] ?? 0));
      cj += c.j; cr += c.r; ca += c.a;
    }
    const gain = norm(j + cj, r + cr, a + ca) - here;
    if (gain > bestGain) { secondGain = bestGain; bestGain = gain; wants = cand.key; }
    else if (gain > secondGain) secondGain = gain;
  }
  return {
    jobs: Math.round(j), residents: Math.round(r), amenitySf: Math.round(a),
    baseD: b.baseD,
    // What has happened since 2000 — which is NOT the day-one reconciliation
    // between what is standing here and what the gravity score said.
    drift: +((s.blockD?.[block] ?? 0) - (s.blockA?.[block] ?? 0)).toFixed(2),
    hiring: +(s.blockJ?.[block] ?? 0).toFixed(1),
    trades: SECTORS
      .map((k) => ({ k, label: INDUSTRY_LABEL[k], share: model.trades.get(block)?.[k] ?? 0 }))
      .sort((x, y) => y.share - x.share).slice(0, 3),
    line: (() => {
      let best: { name: string; monthsOut: number; pts: number } | null = null;
      for (const l of s.lines ?? []) {
        const d = Math.hypot(b.cx - l.cx, b.cy - l.cy);
        if (d > LINE_SIGMA * 1.6) continue;
        const p = l.pts * Math.exp(-(d * d) / (2 * LINE_SIGMA * LINE_SIGMA));
        if (!best || p > best.pts) best = { name: l.name, monthsOut: l.openM - s.month, pts: +p.toFixed(1) };
      }
      return best;
    })(),
    mix, wants,
    balanced: !(bestGain > secondGain * 1.35),
  };
}
