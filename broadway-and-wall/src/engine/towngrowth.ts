// THE TOWN GROWING (the region map, Phase 4): commerce following rooftops,
// the board upzoning what the town is rebuilding, and the record of the
// inner ring rebuilt denser.
//
//   COMMERCE      Each year the town's households are counted where they
//                 live — the town's flats by district, the neighbourhoods and
//                 rural homes the generator drew, every house closed on a
//                 plat — and every arterial frontage is asked how many of them
//                 it would be the nearest grocery to. Where that passes the
//                 ICSC rule of thumb for a grocery-anchored neighbourhood
//                 centre, a centre developer takes a site there (a vacant
//                 commercial lot, or a farm it rezones), and the centre is
//                 built through the city's own groundbreak (dev.ts
//                 startTradeAreaBuilding): underwritten, claimed, financed and
//                 delivered like any building in town. A strip centre follows
//                 a smaller count of households with no shops near at all.
//   PLANNING      Each year the plan commission looks at what the town has
//                 built in each district over ten years. Where the new
//                 buildings are using their whole envelope — the zoning is
//                 what is stopping them, not the market — it opens a rezoning
//                 study; two years later the council votes, and most pass.
//                 One step at a time, a decade apart, inside zoning.ts's band.
//   THE RING      The inner ring's houses are ordinary parcels with an envelope
//                 far above what stands on them (citygen region THE INNER RING
//                 IS HOUSES), so the engine's own teardowns and assemblies
//                 (dev.ts tickTeardowns, rivals.ts tickRivalAssembly) rebuild
//                 them where denser building pays. Counted here.
import type { ParcelTable, ParcelRecord } from "@/data/types";
import type { GameState } from "./types";
import { monthLabel, START_YEAR } from "./types";
import { rng } from "./market";
import { resolveRec } from "./value";
import { farMaxFor } from "./proforma";
import { FAR_CEIL } from "./zoning";
import { ownerOf } from "./rivals";
import { startTradeAreaBuilding } from "./dev";
import { roadPlan } from "./roads";
import { tableVersion } from "./tableVersion";

// ---------------------------------------------------------------- the facts
/**
 * A GROCERY-ANCHORED NEIGHBOURHOOD CENTRE: about 4,000 households within a
 * mile and a half (ICSC: neighbourhood centre, 30-125k sf, primary trade area
 * 3 miles, supported by roughly 3,000-5,000 households; a supermarket draws
 * most of its trade from 1.5 miles in a suburb) [S, rule of thumb]. Its size:
 * about 15 sf of centre a household it serves, 60-125k sf [K, ICSC
 * neighbourhood-centre range read against the 4,000].
 */
const GROCERY = { hh: 4_000, radiusM: 2_400, sfPerHh: 15, minSf: 60_000, maxSf: 125_000 };
/**
 * A STRIP / CONVENIENCE CENTRE: a few shops and a pharmacy or a gas station,
 * under 30k sf, a one-mile trade area, about 1,500 households with no shop
 * that close (ICSC convenience centre) [S, rule of thumb].
 */
const STRIP = { hh: 1_500, radiusM: 1_600, sf: 20_000 };
/** Suburban retail sites run FAR 0.2-0.3 with their car parks (commerce.mjs) [S]. */
const RETAIL_FAR = 0.25;
/** A commercial rezoning and site plan approval at an arterial corner: about a year, and usually granted [K: 0.8]. */
const C_ENTITLE_M = 12, C_ODDS = 0.8;
/** How far from the frontage a centre's site may lie, m [K]. */
const SITE_M = 700;
/**
 * THE PLAN COMMISSION. A rezoning study and the council's vote take about two
 * years [S]; it passes about two times in three where the town has already
 * been rebuilding [K]; it moves a district one step (+25% of its envelope,
 * about R5 to R6) [K], and does not revisit the district for ten years [K].
 * The signal is the one planners use: recent buildings built out to their
 * zoning (85%+ of the envelope) — the code is binding [S, Glaeser & Gyourko 2003].
 */
const PLAN = { studyM: 24, odds: 0.65, step: 1.25, coolM: 120, binding: 0.85, minBuilt: 2 };

// ---------------------------------------------------------------- the state
export interface TownState {
  /** shopping centres the trade areas called for: where, what, when, for how many households */
  centres: { bbl: string; kind: "neighbourhood" | "strip"; m: number; sf: number; households: number; built: boolean }[];
  /** a centre's site in front of the board */
  pending?: { bbl: string; kind: "neighbourhood" | "strip"; sf: number; households: number; decideM: number; rezone: boolean }[];
  /** district rezoning studies before the council, and the decisions taken */
  studies?: { d: string; decideM: number }[];
  upzoned: { d: string; m: number; mult: number }[];
  lastStudyM?: Record<string, number>;
  /** a centre the street would not finance, and when (it is asked again in two years) */
  failedM?: Record<string, number>;
}
function townOf(s: GameState): TownState {
  const g = s.growth!;
  g.town ??= { centres: [], upzoned: [] };
  return g.town;
}

// ---------------------------------------------------------------- the town as statics
type XY = [number, number];
const KY = 110_540;
const meters = (a: XY, b: XY) => Math.hypot((a[0] - b[0]) * 111_320 * Math.cos((a[1] * Math.PI) / 180), (a[1] - b[1]) * KY);
type Statics = {
  key: string;
  /** the town's flats by district at the opening: centroid and dwellings */
  flats: { p: XY; units: number }[];
  /** the opening's grocery-anchored centres, and every shop of any kind */
  grocers: XY[]; shops: XY[];
  /** the town's districts and their parcels */
  districts: Map<string, string[]>;
  /** the inner ring's houses at the opening */
  ring: string[];
};
let ST: Statics | null = null;
function statics(s: GameState, parcels: ParcelTable, bbls: string[]): Statics {
  const key = `${s.seed}:${bbls[0]}:${tableVersion(parcels)}`;
  if (ST?.key === key) return ST;
  const byD = new Map<string, { x: number; y: number; n: number; units: number }>();
  const districts = new Map<string, string[]>();
  const grocers: XY[] = [], shops: XY[] = [], ring: string[] = [];
  for (const bbl of bbls) {
    const p = parcels[bbl];
    if (!p || p.homeLot || p.ag) continue;
    const d = p.district ?? "—";
    if (d !== "outskirts") { const l = districts.get(d); if (l) l.push(bbl); else districts.set(d, [bbl]); }
    if (p.class === "multifamily" && p.bldgArea > 0) {
      const u = Math.max(1, p.unitsRes ?? Math.round(p.bldgArea / 900));
      const e = byD.get(d) ?? { x: 0, y: 0, n: 0, units: 0 };
      e.x += p.centroid[0]; e.y += p.centroid[1]; e.n++; e.units += u;
      byD.set(d, e);
      if ((p.unitsRes ?? 0) <= 3 && ["A1", "B1", "C0"].includes(p.bldgClass)) ring.push(bbl);
    }
    if (p.class === "retail" || p.centre) {
      if (p.centre && ["neighbourhood", "community", "power", "mall"].includes(p.centre) && p.bldgClass !== "K1") grocers.push(p.centroid as XY);
      if (p.class === "retail" && p.bldgArea > 0) shops.push(p.centroid as XY);
    }
  }
  const flats = [...byD.values()].map((e) => ({ p: [e.x / e.n, e.y / e.n] as XY, units: e.units }));
  ST = { key, flats, grocers, shops, districts, ring };
  return ST;
}

/** Where the town's households live this year, as points with counts. */
function households(s: GameState, parcels: ParcelTable, st: Statics): { p: XY; n: number }[] {
  const e = s.econ;
  const out: { p: XY; n: number }[] = [];
  // the town's flats: the opening's dwellings by district, scaled to the flats occupied now
  if (e.occupied?.multifamily && s.growth) {
    s.growth.mf0 ??= e.occupied.multifamily;
    const scale = e.occupied.multifamily / Math.max(1, s.growth.mf0);
    for (const f of st.flats) out.push({ p: f.p, n: f.units * 0.95 * scale });
  }
  for (const h of roadPlan(s).homes) out.push({ p: h.p as XY, n: h.n });
  const byPlat = new Map<string, number>();
  for (const u of Object.values(s.homes?.units ?? {})) if (u.closedM !== undefined) byPlat.set(u.parent, (byPlat.get(u.parent) ?? 0) + 1);
  for (const [parent, n] of byPlat) { const r = parcels[parent]; if (r) out.push({ p: r.centroid as XY, n }); }
  return out;
}

// ---------------------------------------------------------------- commerce
function nearest(p: XY, pts: XY[]): number {
  let d = Infinity;
  for (const q of pts) { const x = meters(p, q); if (x < d) d = x; }
  return d;
}
/** A site near `at` for a centre of `sf`: a vacant commercial lot first, else the smallest farm that holds it. */
function siteNear(s: GameState, parcels: ParcelTable, bbls: string[], at: XY, sf: number): { bbl: string; rezone: boolean } | null {
  const need = sf / RETAIL_FAR;
  let best: { bbl: string; rezone: boolean; score: number } | null = null;
  for (const bbl of bbls) {
    const p = parcels[bbl];
    if (!p || p.homeLot || !(p.lotArea >= need)) continue;
    if (s.platted?.[bbl] || s.merged?.[bbl] || s.holdings[bbl] || s.built[bbl] || s.developments?.[bbl] || ownerOf(s, bbl) || s.civicLand?.[bbl] || s.growth?.held[bbl]) continue;
    if ((s.cityJobs ?? []).some((j) => j.bbl === bbl) || s.talks?.[bbl]) continue;
    const vacantComm = p.class === "land" && !p.ag && !!p.zoneDist && /^(C|M)/.test(p.zoneDist) && !(p.bldgArea > 0);
    const farm = !!p.ag && !!p.tract && !s.plats?.[bbl] && !s.entitlementApps?.[bbl] && p.lotArea <= need * 6;
    if (!vacantComm && !farm) continue;
    const d = meters(at, p.centroid as XY);
    if (d > SITE_M) continue;
    // prefer zoned land, then the closest fit in size, then the nearest
    const score = (vacantComm ? 0 : 1e6) + Math.abs(Math.log(p.lotArea / need)) * 1e4 + d;
    if (!best || score < best.score) best = { bbl, rezone: farm, score };
  }
  return best ? { bbl: best.bbl, rezone: best.rezone } : null;
}

function tickCommerce(s: GameState, parcels: ParcelTable, bbls: string[], adjacency: Record<string, string[]> | null, st: Statics) {
  const T = townOf(s);
  // the board's decisions on the sites in front of it
  for (const p of (T.pending ?? []).slice()) {
    if (s.month < p.decideM) continue;
    T.pending = (T.pending ?? []).filter((x) => x !== p);
    if (s.growth?.held[p.bbl]) delete s.growth.held[p.bbl];
    if (p.rezone && !(rng(s, "growth") < C_ODDS)) {
      s.news.unshift({ q: s.month, kind: "info", bbl: p.bbl, text: `The board turned down a shopping centre at ${parcels[p.bbl]?.address ?? p.bbl}.` });
      (T.failedM ??= {})[p.bbl] = s.month;
      continue;
    }
    // the centre's site plan (a farm rezoned for it, or a commercial lot's planned-unit approval) is the
    // centre's envelope and no more: neighbourhood commercial, one storey and its car park
    s.rezoned = { ...(s.rezoned ?? {}), [p.bbl]: { zone: "C-N", far: +Math.min(RETAIL_FAR, p.sf / Math.max(1, parcels[p.bbl]?.lotArea ?? 1)).toFixed(3), lotSf: 0, m: s.month } };
    const rec = parcels[p.bbl];
    const plate = Math.min(0.9, p.sf / Math.max(1, rec?.lotArea ?? 1));
    // the centre as the product it is (products.ts): a grocery-anchored neighbourhood centre, or a strip
    const ok = startTradeAreaBuilding(s, parcels, adjacency, p.bbl, "retail", 1, plate, p.kind === "neighbourhood" ? "neighborhood" : "strip");
    if (ok) {
      const job = (s.cityJobs ?? []).find((j) => j.bbl === p.bbl);
      T.centres.push({ bbl: p.bbl, kind: p.kind, m: s.month, sf: job?.sf ?? p.sf, households: Math.round(p.households), built: true });
      s.news.unshift({ q: s.month, kind: "info", bbl: p.bbl, text: `${p.kind === "neighbourhood" ? "A grocery-anchored centre" : "A strip centre"} broke ground at ${rec?.address ?? p.bbl}: about ${Math.round((job?.sf ?? p.sf) / 1000)}k sf for the ${Math.round(p.households).toLocaleString()} households it will be nearest to. Opens ${job ? monthLabel(job.deliverM) : "in a year or so"}.` });
    } else {
      (T.failedM ??= {})[p.bbl] = s.month;
    }
  }
  // THE TRADE AREAS, once a year
  const hh = households(s, parcels, st);
  const grocers: XY[] = [...st.grocers, ...T.centres.filter((c) => c.kind === "neighbourhood").map((c) => parcels[c.bbl]?.centroid as XY).filter(Boolean)];
  const shops: XY[] = [...st.shops, ...T.centres.map((c) => parcels[c.bbl]?.centroid as XY).filter(Boolean)];
  for (const p of T.pending ?? []) { const c = parcels[p.bbl]?.centroid as XY | undefined; if (c) { shops.push(c); if (p.kind === "neighbourhood") grocers.push(c); } }
  const dG = hh.map((h) => nearest(h.p, grocers)), dS = hh.map((h) => nearest(h.p, shops));
  let bestG: { at: XY; n: number } | null = null, bestS: { at: XY; n: number } | null = null;
  for (const a of roadPlan(s).arterials) {
    const at = a.mid as XY;
    let nG = 0, nS = 0;
    for (let i = 0; i < hh.length; i++) {
      const d = meters(hh[i].p, at);
      if (d <= GROCERY.radiusM && d < dG[i]) nG += hh[i].n;
      if (d <= STRIP.radiusM && dS[i] > STRIP.radiusM) nS += hh[i].n;
    }
    if (nG >= GROCERY.hh && (!bestG || nG > bestG.n)) bestG = { at, n: nG };
    if (nS >= STRIP.hh && (!bestS || nS > bestS.n)) bestS = { at, n: nS };
  }
  const recent = (bbl: string) => T.failedM?.[bbl] !== undefined && s.month - T.failedM[bbl] < 24;
  for (const [best, kind] of [[bestG, "neighbourhood"], [bestS, "strip"]] as const) {
    if (!best) continue;
    const sf = kind === "neighbourhood" ? Math.round(Math.max(GROCERY.minSf, Math.min(GROCERY.maxSf, GROCERY.sfPerHh * best.n))) : STRIP.sf;
    const site = siteNear(s, parcels, bbls, best.at, sf);
    if (!site || recent(site.bbl)) continue;
    // the centre developer takes the site off the market while the board hears it
    if (site.rezone) (s.growth!.held[site.bbl] = kind === "neighbourhood" ? "a centre developer" : "a strip developer");
    (T.pending ??= []).push({ bbl: site.bbl, kind, sf, households: best.n, decideM: s.month + (site.rezone ? C_ENTITLE_M : 3), rezone: site.rezone });
    s.listings = (s.listings ?? []).filter((x) => x.bbl !== site.bbl);
  }
}

// ---------------------------------------------------------------- planning
function tickPlanning(s: GameState, parcels: ParcelTable, st: Statics) {
  const T = townOf(s);
  for (const st0 of (T.studies ?? []).slice()) {
    if (s.month < st0.decideM) continue;
    T.studies = (T.studies ?? []).filter((x) => x !== st0);
    if (rng(s, "growth") < PLAN.odds) {
      const now = s.zoneAdj?.[st0.d] ?? 1;
      const mult = +Math.min(FAR_CEIL, now * PLAN.step).toFixed(3);
      if (mult > now) {
        s.zoneAdj = { ...(s.zoneAdj ?? {}), [st0.d]: mult };
        T.upzoned.push({ d: st0.d, m: s.month, mult });
        s.news.unshift({ q: s.month, kind: "event", text: `The council upzoned ${st0.d}: its envelope is ${Math.round((mult / now - 1) * 100)}% larger from today.` });
      }
    } else {
      s.news.unshift({ q: s.month, kind: "info", text: `The council voted down the rezoning study for ${st0.d}. The neighbours turned out.` });
    }
  }
  const year = START_YEAR + Math.floor(s.month / 12);
  for (const [d, list] of st.districts) {
    if ((T.studies ?? []).some((x) => x.d === d)) continue;
    if (T.lastStudyM?.[d] !== undefined && s.month - T.lastStudyM[d] < PLAN.coolM) continue;
    let built = 0, binding = 0;
    for (const bbl of list) {
      const b = s.built[bbl];
      if (!b || !(b.bldgArea > 0) || (b.yearBuilt ?? 0) < year - 10) continue;
      const rec = resolveRec(parcels, s, bbl);
      if (!rec || !(rec.lotArea > 0)) continue;
      built++;
      if (b.bldgArea / (rec.lotArea * Math.max(0.1, farMaxFor(rec))) >= PLAN.binding) binding++;
    }
    if (built >= PLAN.minBuilt && binding * 2 >= built) {
      (T.studies ??= []).push({ d, decideM: s.month + PLAN.studyM });
      (T.lastStudyM ??= {})[d] = s.month;
      s.news.unshift({ q: s.month, kind: "info", text: `The plan commission opened a rezoning study for ${d}: ${binding} of the ${built} buildings it has seen in ten years are built out to the zoning. The council votes ${monthLabel(s.month + PLAN.studyM)}.` });
    }
  }
}

// ---------------------------------------------------------------- the tick and the record
export function tickTownGrowth(s: GameState, parcels: ParcelTable, bbls: string[], adjacency: Record<string, string[]> | null) {
  townOf(s);
  if (s.month % 12 !== 6) return;
  const st = statics(s, parcels, bbls);
  tickCommerce(s, parcels, bbls, adjacency, st);
  tickPlanning(s, parcels, st);
}

/** The town at a glance, for the yearly record. */
export function townSummary(s: GameState) {
  const t = s.growth?.town;
  const r = ST && ST.key.startsWith(`${s.seed}:`) ? ST.ring : [];
  let ringRebuilt = 0;
  for (const bbl of r) {
    const b = s.built?.[bbl];
    if (s.merged?.[bbl] || (b && (!(b.bldgArea > 0) || (b.yearBuilt ?? 0) >= START_YEAR))) ringRebuilt++;
  }
  let townBuilt = 0;
  if (ST) for (const list of ST.districts.values()) for (const bbl of list) { const b = s.built?.[bbl]; if (b && b.bldgArea > 0 && (b.yearBuilt ?? 0) >= START_YEAR) townBuilt++; }
  return {
    centres: t?.centres.length ?? 0,
    pendingCentres: t?.pending?.length ?? 0,
    upzones: t?.upzoned.length ?? 0,
    studies: t?.studies?.length ?? 0,
    /** inner-ring houses torn down, folded into an assembled site or rebuilt since the opening */
    redev: ringRebuilt, ring: r.length,
    /** buildings delivered in the town's districts since the opening */
    townBuilt,
  };
}
export type { ParcelRecord };
