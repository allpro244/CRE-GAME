// THE ROADS, BUILT OVER TIME (the region map, Phase 4; REGION_PLAN.md §1).
//
// The hybrid real regions run on, by who pays:
//
//   LOCAL STREETS   the developer's, inside the plat (landdev.ts) — done.
//   ARTERIALS       the county's. It counts the traffic on every piece of its
//                   network each year, and a two-lane road carrying more than
//                   two lanes can is put in the capital programme; it is
//                   widened when the road and bridge fund — a share of the
//                   property tax levy on everything in the county — can pay
//                   for it, two years of design and right-of-way later, and a
//                   construction season and a half after that.
//   HIGHWAYS        the state's. The master plan exists on day one (the
//                   generator's proposed corridors and their planned years,
//                   citygen regionRoadPlan); each segment comes up for funding
//                   four years before its planned opening, and the state funds
//                   growing regions first. A segment that misses slips years;
//                   one that misses three times may be dropped.
//
// WHAT A ROAD DOES. A tract's drive into town (homes.ts platLocation, the
// commute capitalised into every house price there) is read through the
// network as it stands: the county roads at their congested speed (the BPR
// volume-delay curve), or the nearest open interchange and the freeway in at
// freeway speed. Traffic outgrowing a road lengthens the drive and takes value
// off the land along it; the widening gives it back; an interchange opening
// moves the fringe. Nothing about it is a bonus: it is the commute.
//
// The engine holds ids and counts only; the geometry is the plan's
// (roadFeatures draws an opened road for the map and Unreal).
import type { ParcelTable } from "@/data/types";
import type { GameState } from "./types";
import { monthLabel } from "./types";
import { regionRoadPlan, type RegionRoadPlan } from "@/citygen/index.mjs";
import { rng } from "./market";
import { resolveRec, assetValue, initialCondition, farmUsePsf, taxRate } from "./value";
import { COMMUTE, NEW_BUYER_MULT, medianIncome, HH_SIZE } from "./homeprice";

// ---------------------------------------------------------------- the facts
/**
 * Trips a household makes on a weekday: 9.43 for a single-family house (ITE
 * Trip Generation, 11th ed., land use 210) [S]. Every trip from a house out
 * past the town is read as a trip into town and back on the arterials — the
 * jobs, the schools and the shops are there.
 */
const TRIPS_PER_HH = 9.43;
/**
 * The off-map county's households drive in on the old county roads: about
 * half their trips have an end in the county seat (journey-to-work flows for
 * a county seat's own county run 50-60%, ACS) [S, rounded].
 */
const COUNTY_TO_TOWN = 0.5;
/**
 * WHAT A ROAD CARRIES at level of service D, AADT: a two-lane arterial about
 * 15,000 and a four-lane divided one about 33,000 (FDOT 2023 Generalized
 * Service Volume Tables, Class I arterials, rounded) [S].
 */
const CAPACITY: Record<number, number> = { 2: 15_000, 4: 33_000 };
/** The BPR volume-delay curve: travel time = free-flow x (1 + 0.15 (v/c)^4) (Bureau of Public Roads 1964) [S]. */
const bpr = (vc: number) => 1 + 0.15 * Math.pow(Math.max(0, vc), 4);
/**
 * Widening a two-lane arterial to four lanes, about $6M a mile in the 2020s
 * (FDOT 2024 cost-per-mile models, urban/suburban arterial widening, excluding
 * right-of-way, ~$5-9M) [S], carried by the construction-cost index.
 */
const WIDEN_PER_M = 6_000_000 / 1609;
/** Design and right-of-way about two years, construction about eighteen months, for a county widening [S, typical capital programmes]. */
const DESIGN_M = 24, BUILD_M = 18;
/**
 * THE ROAD AND BRIDGE FUND. Illinois counties and their townships levy for
 * roads and bridges separately; together with the county's share of the
 * state motor-fuel tax (which follows its road mileage) the roads take about
 * a tenth of a rural Illinois property tax bill [S, approximate: county clerk
 * extension reports, road and bridge plus township road district levies].
 */
const ROAD_SHARE = 0.10;
/**
 * KEEPING WHAT IS THERE comes first: resurfacing a lane-mile every 15-20 years (about
 * $200-250k a lane-mile, mill and overlay) and the patching, striping, signs and snow in
 * between run about $20,000 a lane-mile a year [S, approximate: state DOT and county
 * highway budget ratios]. The county pays it on its arterials and on every plat's local
 * streets once they are dedicated to it, before anything is widened.
 */
const MAINT_PER_LANE_M = 20_000 / 1609;
/** The levy's sample: one parcel in eight appraised each year (countyLevy). */
const LEVY_STRIDE = 8;
/** A freeway segment is funded about four years before it opens: final design, letting and three construction seasons [S]. */
const HWY_LEAD_M = 48;
/** Freeway speed, 100 km/h (a 65 mph posted limit) against the county road's 50 (homeprice COMMUTE.kmh) [S]. */
const HWY_KMH = 100;
/**
 * WHETHER THE STATE FUNDS A SEGMENT ON TIME. State DOTs rank projects by
 * need, and need is traffic, and traffic is growth: a region adding households
 * at 1.5%/yr is near the top of the list, a flat one near the bottom. Odds
 * 0.45 flat + 0.35 per point of household growth, inside 0.25-0.85 [K, a
 * shape parameter: about half of programmed state highway projects let on
 * schedule (GAO-11-4, state TIP slippage studies)]. A segment that misses
 * slips two to six years; after its third miss it is dropped three times in
 * ten [K].
 */
const fundOdds = (g10: number) => Math.max(0.25, Math.min(0.85, 0.45 + 35 * g10));
/** A corridor: an arterial piece is on a trip's way into town if it lies within 600 m of the straight line in [K]. */
const CORRIDOR_M = 600;

// ---------------------------------------------------------------- the state
export interface RoadsState {
  /** the county road and bridge fund, $; levied and spent to date */
  fund: number; levied: number; spent: number;
  /** last year's levy, $, and what upkeep of the network took of it */
  levyYr: number; upkeepYr?: number;
  /** the state's segments: planned, funded, open or dropped */
  hwy: Record<string, { planM: number; status: "planned" | "funded" | "open" | "dropped"; slips: number; openM?: number }>;
  /** the county's pieces: lanes, this year's and the opening's traffic, and any widening under way */
  art: Record<string, { lanes: number; adt: number; adt0: number; status?: "programmed" | "building"; startM?: number; openM?: number; cost?: number }>;
  /** every road opened since the opening, in order (roadFeatures draws these) */
  opened: { id: string; kind: "widen" | "highway"; m: number; cost: number }[];
}

// ---------------------------------------------------------------- geometry, cheaply
type XY = [number, number];
const KX = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);
const KY = 110_540;
function meters(a: XY, b: XY): number { return Math.hypot((a[0] - b[0]) * KX(a[1]), (a[1] - b[1]) * KY); }
/** Distance from p to the segment a-b, m (a local flat frame). */
function toSegment(p: XY, a: XY, b: XY): number {
  const kx = KX(p[1]);
  const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * KY, bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * KY;
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  const t = L > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}

let PLAN: RegionRoadPlan | null = null;
/** The region's road plan: the MAP's seed (the tracts carry it), which need not be the game's. */
export function roadPlan(s: GameState): RegionRoadPlan {
  const seed = (s.growth?.mapSeed ?? s.seed) >>> 0;
  if (!PLAN || PLAN.seed !== seed) PLAN = regionRoadPlan(seed);
  return PLAN;
}

function roadsOf(s: GameState): RoadsState {
  const g = s.growth!;
  if (g.roads) return g.roads;
  const P = roadPlan(s);
  const hwy: RoadsState["hwy"] = {};
  for (const h of P.highways) for (const sg of h.segs) {
    // the plan's calendar (citygen PLAN_YEAR0) as months after the opening; a segment
    // the plan dates inside the first few years was funded before the game began
    hwy[sg.id] = sg.built ? { planM: 0, status: "open", slips: 0 } : { planM: Math.max(HWY_LEAD_M, (sg.year - P.year0) * 12), status: "planned", slips: 0 };
  }
  const art: RoadsState["art"] = {};
  for (const a of P.arterials) art[a.id] = { lanes: 2, adt: 0, adt0: 0 };
  g.roads = { fund: 0, levied: 0, spent: 0, levyYr: 0, hwy, art, opened: [] };
  return g.roads;
}

// ---------------------------------------------------------------- traffic
/** Households out past the town, where they live: the opening's neighbourhoods and rural homes, and every house closed on a plat. */
function sources(s: GameState, parcels: ParcelTable): { p: XY; n: number }[] {
  const P = roadPlan(s);
  const out: { p: XY; n: number }[] = P.homes.map((h) => ({ p: h.p, n: h.n }));
  const byPlat = new Map<string, number>();
  for (const u of Object.values(s.homes?.units ?? {})) if (u.closedM !== undefined) byPlat.set(u.parent, (byPlat.get(u.parent) ?? 0) + 1);
  for (const [parent, n] of byPlat) { const r = parcels[parent]; if (r) out.push({ p: r.centroid as XY, n }); }
  return out;
}
/**
 * EACH PIECE'S TRAFFIC, AADT. A household's trips run in along the pieces in
 * its corridor to the town's centre, split equally among the parallel pieces
 * in each kilometre band (an all-or-nothing radial assignment — a planner's
 * sketch model, not a network one). The households of the county beyond the
 * map come in on the old county roads, a share of their trips each.
 */
function assignTraffic(s: GameState, parcels: ParcelTable): Record<string, number> {
  const P = roadPlan(s);
  const adt: Record<string, number> = {};
  for (const a of P.arterials) adt[a.id] = 0;
  const C = P.centre as XY;
  const dC = new Map(P.arterials.map((a) => [a.id, meters(a.mid as XY, C)]));
  let mapped = 0;
  for (const src of sources(s, parcels)) {
    mapped += src.n;
    const trips = src.n * TRIPS_PER_HH;
    const dS = meters(src.p, C);
    const bands = new Map<number, string[]>();
    for (const a of P.arterials) {
      const dm = dC.get(a.id)!;
      if (dm > dS + 300) continue;
      if (toSegment(a.mid as XY, src.p, C) > CORRIDOR_M) continue;
      const b = Math.floor(dm / 1000);
      const l = bands.get(b);
      if (l) l.push(a.id); else bands.set(b, [a.id]);
    }
    for (const ids of bands.values()) for (const id of ids) adt[id] += trips / ids.length;
  }
  // the county beyond the map: households not housed on it (the town's flats, the opening's homes out
  // past it, the plats' new houses), in on the old roads
  const e = s.econ;
  const hh = (e.population ?? 0) / HH_SIZE;
  const renters = (e.occupied?.multifamily ?? 0) / 900;
  const beyond = Math.max(0, hh - renters - mapped);
  const roads = new Map<string, string[]>();
  for (const a of P.arterials) if (a.kind === "county") { const r = a.id.split(".")[0]; const l = roads.get(r); if (l) l.push(a.id); else roads.set(r, [a.id]); }
  if (roads.size) {
    const perRoad = (beyond * TRIPS_PER_HH * COUNTY_TO_TOWN) / roads.size;
    for (const ids of roads.values()) for (const id of ids) adt[id] += perRoad;
  }
  return adt;
}

// ---------------------------------------------------------------- the county's money
/**
 * THE LEVY: the property tax rate on everything in the county the engine
 * values — the town's buildings and lots at what the engine says they are
 * worth, the farms at their use value (Illinois assesses farmland on its
 * productivity, 35 ILCS 200/10-115), the plats' houses at what they sold for.
 */
function countyLevy(s: GameState, parcels: ParcelTable, bbls: string[]): number {
  const e = s.econ;
  let v = 0;
  // An assessor's whole roll is ~2,000 appraisals a year here, and the engine's
  // appraisal is the expensive thing it does. The levy needs the total, not
  // each parcel: one parcel in LEVY_STRIDE, every year a different one, scaled
  // up — a sample's error on a total of 2,000 skewed values is a few per cent,
  // well inside what a road budget can tell apart.
  const off = Math.floor(s.month / 12) % LEVY_STRIDE;
  for (let i = off; i < bbls.length; i += LEVY_STRIDE) {
    const bbl = bbls[i];
    const raw = parcels[bbl];
    if (!raw || s.platted?.[bbl] || s.merged?.[bbl]) continue;
    if (raw.ag) { v += LEVY_STRIDE * farmUsePsf(raw, e) * raw.lotArea; continue; }
    if (s.homes?.units[bbl]?.closedM !== undefined) continue;
    const rec = resolveRec(parcels, s, bbl);
    if (!rec) continue;
    const x = assetValue(rec, e, initialCondition(rec));
    if (x > 0) v += LEVY_STRIDE * x;
  }
  for (const u of Object.values(s.homes?.units ?? {})) if (u.closedM !== undefined) v += u.price ?? 0;
  return v * taxRate(e);
}

// ---------------------------------------------------------------- access
/** Cost of a kilometre at freeway speed against one at the county road's, for this town's buyer: fuel the same, time halved. */
function hwyRatio(s: GameState): number {
  const e = s.econ;
  const income = NEW_BUYER_MULT * medianIncome(e);
  const fuel = COMMUTE.perKm * (e.wageIdx ?? 1), vot = COMMUTE.vot * (income / 2080);
  return (fuel + vot / HWY_KMH) / (fuel + vot / COMMUTE.kmh);
}
/**
 * EVERY TRACT'S DRIVE INTO TOWN as the roads now run, in county-road metres
 * (the unit homes.ts commuteMult reads): straight in at the congestion of
 * its corridor, or out to the nearest open interchange and in on the freeway.
 */
function refreshAccess(s: GameState, parcels: ParcelTable, bbls: string[]) {
  const g = s.growth!, R = g.roads!, P = roadPlan(s);
  const C = P.centre as XY;
  const ratio = hwyRatio(s);
  const ixs: { p: XY; edgeM: number }[] = [];
  for (const h of P.highways) for (const x of h.ix) if (x.seg && R.hwy[x.seg]?.status === "open") ixs.push({ p: x.p, edgeM: x.edgeM });
  const access: Record<string, number> = {};
  for (const bbl of bbls) {
    const rec = parcels[bbl];
    if (!rec?.tract) continue;
    const p = rec.centroid as XY, dS = meters(p, C);
    // the corridor's delay: the worst piece in each band, averaged over the bands
    const bands = new Map<number, number>();
    for (const a of P.arterials) {
      const dm = meters(a.mid as XY, C);
      if (dm > dS + 300 || toSegment(a.mid as XY, p, C) > CORRIDOR_M) continue;
      const st = R.art[a.id];
      const f = bpr(st.adt / CAPACITY[st.lanes]) / bpr(0);
      const b = Math.floor(dm / 1000);
      bands.set(b, Math.max(bands.get(b) ?? 1, f));
    }
    const delay = bands.size ? [...bands.values()].reduce((x, y) => x + y, 0) / bands.size : 1;
    let eff = rec.tract.edgeM * delay;
    for (const x of ixs) eff = Math.min(eff, meters(p, x.p) * delay + x.edgeM * ratio);
    access[bbl] = Math.round(eff);
  }
  g.access = access;
}

// ---------------------------------------------------------------- the tick
function tenYearGrowth(s: GameState): number {
  const h = s.growth?.hist ?? [];
  const now = (s.econ.population ?? 0) / HH_SIZE;
  const then = h.length >= 10 ? h[h.length - 10].households : h[0]?.households;
  if (!then || !(then > 0)) return 0;
  const yrs = h.length >= 10 ? 10 : Math.max(1, h.length);
  return Math.pow(now / then, 1 / yrs) - 1;
}

/** The year's road business, and the month's openings. */
export function tickRoads(s: GameState, parcels: ParcelTable, bbls: string[]) {
  const g = s.growth!;
  const R = roadsOf(s);
  const P = roadPlan(s);
  let changed = !g.access;
  // THE MONTH: what opens.
  for (const [id, a] of Object.entries(R.art)) {
    if (a.status === "programmed" && a.startM !== undefined && s.month >= a.startM) a.status = "building";
    if (a.status === "building" && a.openM !== undefined && s.month >= a.openM) {
      a.lanes = 4; a.status = undefined;
      R.opened.push({ id, kind: "widen", m: s.month, cost: a.cost ?? 0 });
      const piece = P.arterials.find((x) => x.id === id);
      s.news.unshift({ q: s.month, kind: "info", text: `The county opened the widened ${piece?.kind === "section" ? "section-line road" : "county road"} (${((piece?.lenM ?? 0) / 1609).toFixed(1)} mi, four lanes) ${piece ? `${(piece.edgeM / 1000).toFixed(1)} km out of town` : ""}.` });
      changed = true;
    }
  }
  for (const [id, h] of Object.entries(R.hwy).sort(([a], [b]) => a.localeCompare(b))) {
    if (h.status === "planned" && s.month >= h.planM - HWY_LEAD_M) {
      // THE FUNDING DECISION, four years out
      if (rng(s, "growth") < fundOdds(tenYearGrowth(s))) {
        h.status = "funded"; h.openM = s.month + HWY_LEAD_M;
        s.news.unshift({ q: s.month, kind: "event", text: `The state funded the ${id.split(".")[0]} segment ${id}: it opens ${monthLabel(h.openM)}.` });
      } else {
        h.slips++;
        if (h.slips >= 3 && rng(s, "growth") < 0.3) {
          h.status = "dropped";
          s.news.unshift({ q: s.month, kind: "warn", text: `The state dropped the ${id} highway segment from its programme.` });
        } else {
          const slip = 24 + Math.floor(rng(s, "growth") * 49);
          h.planM = s.month + HWY_LEAD_M + slip;
          s.news.unshift({ q: s.month, kind: "warn", text: `The ${id} highway segment missed the state's programme again; the plan now reads ${monthLabel(h.planM)}.` });
        }
      }
    }
    if (h.status === "funded" && h.openM !== undefined && s.month >= h.openM) {
      h.status = "open";
      const seg = P.highways.flatMap((x) => x.segs).find((x) => x.id === id);
      R.opened.push({ id, kind: "highway", m: s.month, cost: 0 });
      s.news.unshift({ q: s.month, kind: "event", text: `The ${id} highway segment opened: ${((seg?.lenM ?? 0) / 1609).toFixed(1)} miles of freeway and its interchanges.` });
      changed = true;
    }
  }
  // THE YEAR: the levy, the counts, the programme.
  if (s.month % 12 === 0) {
    const levy = countyLevy(s, parcels, bbls) * ROAD_SHARE;
    R.fund += levy; R.levied += levy; R.levyYr = Math.round(levy);
    // the upkeep of the network as it stands: the arterials' lanes, and the plats' streets (two lanes, along half their lots' frontage)
    let laneM = 0;
    for (const a of P.arterials) laneM += (R.art[a.id]?.lanes ?? 2) * a.lenM;
    for (const pl of Object.values(s.plats ?? {})) if (pl.done) laneM += 2 * pl.lots.reduce((t, l) => t + l.f, 0) * 0.3048 / 2;
    const upkeep = Math.round(MAINT_PER_LANE_M * laneM * s.econ.costIdx);
    // a county that cannot keep its roads defers the upkeep; it does not borrow for it
    const paid = Math.min(Math.max(0, R.fund), upkeep);
    R.fund -= paid; R.spent += paid; R.upkeepYr = upkeep;
    const adt = assignTraffic(s, parcels);
    const first = !Object.values(R.art).some((a) => a.adt0 > 0);
    for (const [id, a] of Object.entries(R.art)) { a.adt = Math.round(adt[id] ?? 0); if (first) a.adt0 = a.adt; }
    // the county's programme: the worst-overloaded two-lane pieces first, as the fund allows
    const warranted = Object.entries(R.art)
      .filter(([, a]) => a.lanes === 2 && !a.status && a.adt > CAPACITY[2])
      .sort(([ia, a], [ib, b]) => b.adt - a.adt || ia.localeCompare(ib));
    for (const [id, a] of warranted) {
      const piece = P.arterials.find((x) => x.id === id);
      if (!piece) continue;
      const cost = Math.round(WIDEN_PER_M * piece.lenM * s.econ.costIdx);
      if (R.fund < cost) break;
      R.fund -= cost; R.spent += cost;
      a.status = "programmed"; a.cost = cost; a.startM = s.month + DESIGN_M; a.openM = s.month + DESIGN_M + BUILD_M;
      s.news.unshift({ q: s.month, kind: "info", text: `The county put a widening in its capital programme: ${(piece.lenM / 1609).toFixed(1)} miles carrying ${a.adt.toLocaleString()} vehicles a day on two lanes, $${(cost / 1e6).toFixed(1)}M, open ${monthLabel(a.openM)}.` });
    }
    changed = true;
  }
  if (changed) refreshAccess(s, parcels, bbls);
}

/** The roads at a glance, for the yearly record. */
export function roadsSummary(s: GameState) {
  const R = s.growth?.roads;
  if (!R) return { widened: 0, highway: 0, programmed: 0, overloaded: 0, maxAdt: 0, fund: 0, levy: 0, upkeep: 0 };
  const art = Object.values(R.art);
  return {
    widened: R.opened.filter((o) => o.kind === "widen").length,
    highway: R.opened.filter((o) => o.kind === "highway").length,
    programmed: art.filter((a) => a.status).length,
    overloaded: art.filter((a) => a.adt > CAPACITY[a.lanes]).length,
    maxAdt: Math.max(0, ...art.map((a) => a.adt)),
    fund: Math.round(R.fund), levy: R.levyYr, upkeep: R.upkeepYr ?? 0,
  };
}

/**
 * THE ROADS OPENED SINCE THE OPENING, as lines the map and Unreal draw: each
 * with its class and carriageway width (a widened arterial at four lanes and
 * a median, ~22 m; a freeway segment at the region's 24 m) [S, AASHTO lane
 * 3.6 m]. Lon/lat.
 */
export function roadFeatures(s: GameState): { id: string; kind: "widen" | "highway"; m: number; cls: "arterial" | "highway"; w: number; pts: [number, number][] }[] {
  const R = s.growth?.roads;
  if (!R || s.citySize !== "region") return [];
  const P = roadPlan(s);
  const segs = new Map(P.highways.flatMap((h) => h.segs).map((x) => [x.id, x]));
  const arts = new Map(P.arterials.map((a) => [a.id, a]));
  return R.opened.map((o) => {
    const geo = o.kind === "highway" ? segs.get(o.id) : arts.get(o.id);
    return { id: o.id, kind: o.kind, m: o.m, cls: o.kind === "highway" ? "highway" as const : "arterial" as const, w: o.kind === "highway" ? P.widths.highway : 22, pts: (geo?.pts ?? []) as [number, number][] };
  }).filter((f) => f.pts.length >= 2);
}
