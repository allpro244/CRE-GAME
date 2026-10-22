// THE REGION GROWING (the region map, Phase 4).
//
// Phases 1-3 built a still picture: a town, its inner ring of houses, the
// outer neighbourhoods, the farms, and the machinery to cut a farm into lots
// and put houses on them. This is what makes the picture move over decades,
// the way a real county seat grows — not by anybody zoning it, but by
// businesses deciding, one deal at a time, that a deal pays:
//
//   HOUSEHOLDS   the town's households are its population over the average
//                household (the engine's own demography, market.ts); each one
//                needs a home, and the town's new-house buyers (homeprice.ts
//                salesPace) are the demand every subdivision sells into.
//   LAND         land developers — named firms, off the player's books, on the
//                same rules and costs as the player (landdev.ts) — price every
//                farm as a subdivision each quarter: the finished lots at the
//                homebuilders' bid, less the board, the streets, the mains to
//                the nearest served land, the wait and the odds of refusal.
//                That bid IS the farm's price where it beats the corn
//                (value.ts landRead "subdivider"). A developer whose own read
//                of a tract clears its price buys it, files, and — if the
//                board agrees — builds the streets; the homebuilders (homes.ts)
//                take the lots. Each new community thins the sales pace every
//                other one can count on, so the fringe advances only as fast
//                as households arrive to buy, and it advances where the drive
//                is short and the mains are close: contiguous, with a leap
//                where a developer reads a cheap farm better than the market.
//   ROADS        roads.ts: the county widens what traffic outgrows, out of its
//                road levy; the state builds its master plan, late or never.
//   TOWN         commerce follows rooftops (a grocery-anchored centre opens
//                where enough households live without one), the board
//                upzones the districts the town is redeveloping, and the
//                engine's own teardowns rebuild the inner ring denser.
//
// CADENCE. Nothing here looks at every parcel every month. The board's
// decisions and the streets are monthly (a handful of records); the land
// market is read quarterly, over the farm tracts only (~100-130); the town's
// commerce, its planning and its roads annually.
import type { ParcelTable, ParcelRecord } from "@/data/types";
import type { GameState } from "./types";
import { monthLabel } from "./types";
import { platTractLots } from "@/citygen/index.mjs";
import { rng } from "./market";
import { ownerOf } from "./rivals";
import { farmUsePsf } from "./value";
import {
  ENTITLE_FIXED, ENTITLE_PER_LOT, ENTITLE_MONTHS, INFRA_MONTHS, INFRA_PER_FRONT_FT, IMPACT_FEE,
  MAIN_PER_M, REZONE, PLAT_LOT_SIZES, entitleOdds, servedM,
} from "./landdev";
import { platLocation, homeTargetPsf } from "./homes";
import {
  homeQuote, salesPace, selloutDiscount, LOT_SELLOUT_RATE, HH_SIZE,
} from "./homeprice";
import { tickRoads, type RoadsState, roadsSummary } from "./roads";
import { tickTownGrowth, type TownState, townSummary } from "./towngrowth";

// ---------------------------------------------------------------- the state
export interface GrowthProject {
  bbl: string;
  /** the land developer */
  by: string;
  boughtM: number;
  /** what the developer paid the farmer, $ */
  price: number;
  lotSf: number;
  lots: number;
  stage: "entitle" | "approved" | "plat";
  decideM: number;
  odds: number;
}
export interface GrowthYear {
  /** months since the opening */
  m: number;
  pop: number;
  households: number;
  /** renter households in the town's flats (occupied flats over the generator's 900-sf home) */
  renters: number;
  /** owner households in new houses closed on the plats, cumulative */
  newHomes: number;
  /** houses started on the plats this year, and closed */
  started: number; closed: number;
  /** lots in finished plats, cumulative; acres platted, cumulative; plats */
  lots: number; acres: number; plats: number;
  /** tracts the developers bought this year; rezonings refused this year */
  bought: number; refused: number;
  /** the farm-tract price gradient: median $/acre by distance from served land (0-0.5, 0.5-1.5, 1.5-3, 3+ km) */
  gradient: number[];
  /** farm-use value, $/acre (crop), for the gradient's floor */
  farmAcre: number;
  /** the going new house, $/sf at the town's edge */
  homePsf: number;
  roads: ReturnType<typeof roadsSummary>;
  town: ReturnType<typeof townSummary>;
}
export interface GrowthState {
  /** the land developers, by name: what they have bought and platted */
  devs: Record<string, { name: string; sinceM: number; tracts: number; plats: number; lots: number; spent: number; refused: number }>;
  /** a developer's tract, from purchase to the streets going in */
  projects: Record<string, GrowthProject>;
  /** tracts off the market while a developer holds them (demand.ts isCivicLand reads it) */
  held: Record<string, string>;
  /** a refused tract, and when: the board does not rehear a refused plat for two years */
  refusedM?: Record<string, number>;
  /** effective distance to town per tract, m, as the roads run (roads.ts writes; homes.ts platLocation reads) */
  access?: Record<string, number>;
  roads?: RoadsState;
  town?: TownState;
  /** the year's counters, reset at each annual record */
  yr: { bought: number; refused: number };
  hist: GrowthYear[];
}

function growthOf(s: GameState): GrowthState {
  s.growth ??= { devs: {}, projects: {}, held: {}, yr: { bought: 0, refused: 0 }, hist: [] };
  return s.growth;
}

// ---------------------------------------------------------------- the facts
/**
 * A land buyer's closing costs: title, survey, environmental, legal and the
 * transfer tax — about 2-3% of the price on a farm tract [S, rounded]. A
 * developer clears the farmer's price by at least this before it signs.
 */
const LAND_CLOSING = 0.03;
/**
 * HOW FAR APART TWO DEVELOPERS' READS OF ONE FARM ARE. Each prices the
 * subdivision on its own costs and its own view of the sales pace: a
 * log-normal spread of 10% on the lots and on the horizontal [K, a shape
 * parameter — appraisal dispersion on land runs 10-20% (Lusht 1996; IRWA)].
 * It is why the developer who buys is the one who reads the farm best, and
 * why a few buy farms the market as a whole would not yet.
 */
const READ_SIGMA = 0.10;
/** The board does not rehear a refused plat for about two years [K]. */
const REHEAR_M = 24;
/** Land developers' names: regional land companies [O]. */
const DEV_WORDS = [["Prairie", "Northfield", "Grand", "Crossroads", "Harvest", "Timberline", "Keystone", "Bluestem", "Lakeview", "Summit", "Landmark", "Cornerstone"], ["Land Co.", "Development", "Land Partners", "Communities", "Properties", "Land Group"]];

function hash01(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 2246822507); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** A standard normal from two hashes (Box-Muller): a draw that consumes no stream. */
function hashNormal(key: string): number {
  const u1 = Math.max(1e-9, hash01(key + ":a")), u2 = hash01(key + ":b");
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// ---------------------------------------------------------------- the plat a tract would take
/** citygen's plat of a tract at a lot size, reduced to what the engine needs; memoised (the geometry is a pure function of the tract). */
const GEO = new Map<string, { n: number; frontage: number; lots: { a: number; f: number; d: number }[] }>();
export function tractPlat(rec: ParcelRecord, lotSf: number) {
  const t = rec.tract!;
  const key = `${t.seed}:${t.id}:${lotSf}`;
  let g = GEO.get(key);
  if (!g) {
    const lots = platTractLots(t, lotSf).lots.map(({ a, f, d }) => ({ a, f, d }));
    g = { n: lots.length, frontage: lots.reduce((x, l) => x + l.f, 0), lots };
    if (GEO.size > 2000) GEO.clear();
    GEO.set(key, g);
  }
  return g;
}

/** Communities selling, or about to: finished plats with lots left, plats under way, and rezonings before the board. */
function activeCommunities(s: GameState): number {
  let n = 0;
  for (const [p, pl] of Object.entries(s.plats ?? {})) {
    if (!pl.done) { n++; continue; }
    if ((s.econ.homes?.plats[p]?.left ?? 0) > 0) n++;
  }
  n += Object.keys(s.entitlementApps ?? {}).length;
  for (const pr of Object.values(s.growth?.projects ?? {})) if (pr.stage !== "plat") n++;
  return n;
}

export type TractRead = {
  bbl: string; lotSf: number; lots: number;
  /** what the subdivision is worth to a developer today, $ (and per sf of tract) */
  bid: number; bidPsf: number;
  /** the parts: finished lots at sell-out, $; the horizontal and the mains; the board's fees; its odds; the farm */
  lotsValue: number; horizontal: number; offsite: number; entitle: number; odds: number; farm: number;
  months: number; pace: number; disc: number; residual: number;
};
/**
 * WHAT A FARM IS WORTH AS A SUBDIVISION, TODAY, to a developer whose reads are
 * `lotsMult` and `costMult` times the market's. The finished lots at the
 * homebuilders' residual on the house each carries, discounted for the
 * sell-out at the pace one more community would sell at; less the
 * horizontal and the off-site mains (paid once the board says yes); less the
 * board's fees (paid now); all discounted at the land-development rate over
 * the months the board and the streets take; times the odds the board agrees —
 * and if it refuses, the developer still owns a farm. The lot size is the
 * developer's choice: whichever pays most.
 */
export function readTract(s: GameState, parcels: ParcelTable, bbl: string, extraSellers = 0, lotsMult = 1, costMult = 1): TractRead | null {
  const rec = parcels[bbl];
  if (!rec?.tract || !(rec.lotArea > 0)) return null;
  const e = s.econ;
  const psf = e.homes?.psf ?? homeTargetPsf(e);
  const { loc } = platLocation(s, parcels, bbl, psf);
  const served = servedM(s, parcels, bbl);
  const odds = entitleOdds(served);
  const farm = farmUsePsf(rec, e) * rec.lotArea;
  const r = LOT_SELLOUT_RATE;
  const sellers = activeCommunities(s) + extraSellers + 1;
  const offsite = MAIN_PER_M * served * e.costIdx * costMult;
  let best: TractRead | null = null;
  for (const lotSf of PLAT_LOT_SIZES) {
    const g = tractPlat(rec, lotSf);
    if (g.n < 4) continue;
    const q = homeQuote(e, lotSf, psf * loc, REZONE.far);
    const pace = salesPace(e, q.price / loc, 0, sellers);
    const disc = q.residual > 0 ? selloutDiscount(g.n, pace) : 0;
    const lotsValue = Math.max(0, q.residual) * g.n * disc * lotsMult;
    const horizontal = (INFRA_PER_FRONT_FT * g.frontage + IMPACT_FEE * g.n) * e.costIdx * costMult;
    const entitle = (ENTITLE_FIXED + ENTITLE_PER_LOT * g.n) * e.costIdx * costMult;
    const tE = ENTITLE_MONTHS(g.n), tI = INFRA_MONTHS(g.n);
    const dfE = Math.pow(1 + r, -tE / 12), dfI = Math.pow(1 + r, -(tE + tI) / 12);
    const bid = odds * (lotsValue * dfI - (horizontal + offsite) * dfE) + (1 - odds) * farm * dfE - entitle;
    if (!best || bid > best.bid) {
      best = { bbl, lotSf, lots: g.n, bid, bidPsf: bid / rec.lotArea, lotsValue, horizontal, offsite, entitle, odds, farm, months: tE + tI, pace, disc, residual: q.residual };
    }
  }
  return best;
}

/** A tract the market can trade: a whole farm, not platted, not the player's, not in anyone's hands or talks. */
function tradableTract(s: GameState, parcels: ParcelTable, bbl: string): boolean {
  const rec = parcels[bbl];
  if (!rec?.tract || s.platted?.[bbl] || s.plats?.[bbl]) return false;
  if (s.holdings[bbl] || s.growth?.held[bbl] || s.entitlementApps?.[bbl]) return false;
  if (s.talks?.[bbl] || s.approaches?.[bbl] || s.civicLand?.[bbl]) return false;
  if (ownerOf(s, bbl)) return false;
  return true;
}

// ---------------------------------------------------------------- the quarter: the land market
let TRACTS: { key: string; list: string[] } | null = null;
function tractList(parcels: ParcelTable, bbls: string[]): string[] {
  const key = `${bbls.length}:${bbls[0]}`;
  if (TRACTS?.key === key) return TRACTS.list;
  const list = bbls.filter((b) => parcels[b]?.tract).sort();
  TRACTS = { key, list };
  return list;
}

function devName(s: GameState, g: GrowthState): string {
  const used = new Set(Object.keys(g.devs));
  for (let k = 0; k < 60; k++) {
    const a = DEV_WORDS[0][Math.floor(hash01(`ld-a:${s.seed}:${k}`) * DEV_WORDS[0].length)];
    const b = DEV_WORDS[1][Math.floor(hash01(`ld-b:${s.seed}:${k}`) * DEV_WORDS[1].length)];
    const n = `${a} ${b}`;
    if (!used.has(n)) return n;
  }
  return `Land Developer ${used.size + 1}`;
}
/**
 * Who buys: most fringe land in a county this size is taken down by a handful
 * of regional developers. An existing one takes the next deal unless a new
 * name enters, about one deal in three [K].
 */
function pickDev(s: GameState, g: GrowthState): string {
  const names = Object.keys(g.devs).sort();
  if (names.length && rng(s, "growth") > 1 / 3) return names[Math.floor(rng(s, "growth") * names.length)];
  const n = devName(s, g);
  g.devs[n] = { name: n, sinceM: s.month, tracts: 0, plats: 0, lots: 0, spent: 0, refused: 0 };
  return n;
}

function tickLandMarket(s: GameState, parcels: ParcelTable, bbls: string[]) {
  const g = growthOf(s);
  const e = s.econ;
  const tracts = tractList(parcels, bbls);
  // THE MARKET'S BID FOR EVERY FARM: the median developer's read.
  const bids: Record<string, number> = {};
  const reads: TractRead[] = [];
  for (const bbl of tracts) {
    if (s.platted?.[bbl] || s.plats?.[bbl] || g.held[bbl]) continue;
    const rd = readTract(s, parcels, bbl);
    if (!rd) continue;
    if (rd.bidPsf > 0) bids[bbl] = +rd.bidPsf.toFixed(4);
    if (tradableTract(s, parcels, bbl) && !(g.refusedM?.[bbl] !== undefined && s.month - g.refusedM[bbl] < REHEAR_M)) reads.push(rd);
  }
  e.tractBid = bids;
  e.growthStamp = (e.growthStamp ?? 0) + 1;
  // THE DEVELOPERS' OWN READS. Each tract this quarter has one developer
  // looking at it, with its own read of the lots and the costs; it buys if
  // that read clears the farm's price (the market's bid or the corn, whichever
  // is higher) and its closing costs. Every purchase is one more community
  // the next one's sales are split with, so the next is re-read.
  const qtr = Math.floor(s.month / 3);
  const own = (rd: TractRead, extra: number) => {
    const lm = Math.exp(READ_SIGMA * hashNormal(`lot:${s.seed}:${rd.bbl}:${qtr}`));
    const cm = Math.exp(READ_SIGMA * hashNormal(`cost:${s.seed}:${rd.bbl}:${qtr}`));
    return readTract(s, parcels, rd.bbl, extra, lm, cm);
  };
  const ask = (rd: TractRead) => Math.max(rd.farm, rd.bid);
  let cands = reads.map((rd) => ({ rd, mine: own(rd, 0) })).filter((c) => c.mine && c.mine.bid > ask(c.rd) * (1 + LAND_CLOSING) && c.mine.lotsValue > 0);
  let bought = 0;
  while (cands.length) {
    cands.sort((a, b) => (b.mine!.bid / ask(b.rd)) - (a.mine!.bid / ask(a.rd)) || a.rd.bbl.localeCompare(b.rd.bbl));
    const c = cands.shift()!;
    // re-read with the communities bought this quarter in the count
    const mine = bought ? own(c.rd, 0) : c.mine;
    const base = bought ? readTract(s, parcels, c.rd.bbl) : c.rd;
    if (!mine || !base || !(mine.bid > Math.max(base.farm, c.rd.bid) * (1 + LAND_CLOSING))) continue;
    buyTract(s, parcels, g, c.rd.bbl, Math.round(ask(c.rd)), mine);
    bought++;
    cands = cands.filter((x) => x.rd.bbl !== c.rd.bbl);
  }
}

function buyTract(s: GameState, parcels: ParcelTable, g: GrowthState, bbl: string, price: number, rd: TractRead) {
  const rec = parcels[bbl];
  const by = pickDev(s, g);
  const d = g.devs[by];
  d.tracts++; d.spent += price + rd.entitle;
  g.held[bbl] = by;
  g.yr.bought++;
  s.listings = (s.listings ?? []).filter((x) => x.bbl !== bbl);
  g.projects[bbl] = {
    bbl, by, boughtM: s.month, price, lotSf: rd.lotSf, lots: rd.lots, stage: "entitle",
    decideM: s.month + ENTITLE_MONTHS(rd.lots), odds: +rd.odds.toFixed(2),
  };
  (s.lastTradeM ??= {})[bbl] = s.month;
  s.news.unshift({
    q: s.month, kind: "deal", bbl,
    text: `${by} bought ${rec.address} for $${Math.round(price / Math.max(1, rec.lotArea / 43560)).toLocaleString()} an acre and filed to rezone it for ${rd.lots} house lots. The board sits ${monthLabel(s.month + ENTITLE_MONTHS(rd.lots))}.`,
  });
}

// ---------------------------------------------------------------- the month: the board and the streets
function tickProjects(s: GameState, parcels: ParcelTable) {
  const g = s.growth;
  if (!g) return;
  for (const pr of Object.values(g.projects).sort((a, b) => a.bbl.localeCompare(b.bbl))) {
    const rec = parcels[pr.bbl];
    if (!rec) { delete g.projects[pr.bbl]; delete g.held[pr.bbl]; continue; }
    if (pr.stage === "entitle" && s.month >= pr.decideM) {
      // the board's odds are the ones it would give the player for the same farm today
      const odds = entitleOdds(servedM(s, parcels, pr.bbl));
      if (rng(s, "growth") < odds) {
        s.rezoned = { ...(s.rezoned ?? {}), [pr.bbl]: { zone: REZONE.zone, far: REZONE.far, lotSf: pr.lotSf, m: s.month } };
        pr.stage = "approved";
      } else {
        g.devs[pr.by] && g.devs[pr.by].refused++;
        g.yr.refused++;
        (g.refusedM ??= {})[pr.bbl] = s.month;
        delete g.projects[pr.bbl]; delete g.held[pr.bbl];
        s.news.unshift({ q: s.month, kind: "info", bbl: pr.bbl, text: `The board refused ${pr.by}'s subdivision at ${rec.address}. It goes back on the market a farm.` });
        continue;
      }
    }
    if (pr.stage === "approved" && s.month % 3 === 0) {
      // THE STREETS GO IN WHEN THEY PAY: the lots at today's sell-out against
      // the horizontal still to spend. The land and the board are sunk; a
      // developer whose lots no longer cover the streets banks the land.
      const g2 = tractPlat(rec, pr.lotSf);
      const e = s.econ;
      const psf = e.homes?.psf ?? homeTargetPsf(e);
      const { loc } = platLocation(s, parcels, pr.bbl, psf);
      const q = homeQuote(e, pr.lotSf, psf * loc, REZONE.far);
      // this community is already in the count of those selling (activeCommunities)
      const pace = salesPace(e, q.price / loc, 0, Math.max(1, activeCommunities(s)));
      const horizontal = (INFRA_PER_FRONT_FT * g2.frontage + IMPACT_FEE * g2.n) * e.costIdx + MAIN_PER_M * servedM(s, parcels, pr.bbl) * e.costIdx;
      const tI = INFRA_MONTHS(g2.n);
      const lots = q.residual > 0 ? q.residual * g2.n * selloutDiscount(g2.n, pace) : 0;
      if (lots * Math.pow(1 + LOT_SELLOUT_RATE, -tI / 12) > horizontal) {
        s.plats = {
          ...(s.plats ?? {}),
          [pr.bbl]: { parent: pr.bbl, template: "grid2", lotSf: pr.lotSf, startM: s.month, doneM: s.month + tI, cost: Math.round(horizontal), lots: g2.lots.map((l) => ({ ...l })) },
        };
        pr.stage = "plat";
        const d = g.devs[pr.by];
        if (d) { d.plats++; d.lots += g2.n; d.spent += Math.round(horizontal); }
        s.news.unshift({ q: s.month, kind: "info", bbl: pr.bbl, text: `${pr.by} is building the streets at ${rec.address}: ${g2.n} lots, finished ${monthLabel(s.month + tI)}.` });
      }
    }
    if (pr.stage === "plat" && s.plats?.[pr.bbl]?.done) {
      delete g.projects[pr.bbl]; delete g.held[pr.bbl];
    }
  }
}

// ---------------------------------------------------------------- the year: the record
function housesOn(s: GameState) {
  let closed = 0, startedY = 0, closedY = 0;
  const y0 = s.month - 12;
  for (const u of Object.values(s.homes?.units ?? {})) {
    if (u.closedM !== undefined) { closed++; if (u.closedM > y0) closedY++; }
    if (u.startM > y0) startedY++;
  }
  return { closed, startedY, closedY };
}
function median(a: number[]): number {
  if (!a.length) return 0;
  const b = a.slice().sort((x, y) => x - y);
  return b[b.length >> 1];
}
function recordYear(s: GameState, parcels: ParcelTable, bbls: string[]) {
  const g = growthOf(s);
  const e = s.econ;
  const pop = e.population ?? 0;
  const h = housesOn(s);
  let lots = 0, acres = 0, plats = 0;
  for (const pl of Object.values(s.plats ?? {})) {
    if (!pl.done) continue;
    plats++; lots += pl.lots.length;
    acres += (parcels[pl.parent]?.lotArea ?? 0) / 43560;
  }
  // THE LAND GRADIENT: what farms trade at, by how far they sit from served land.
  const bands: number[][] = [[], [], [], []];
  for (const bbl of tractList(parcels, bbls)) {
    if (s.platted?.[bbl] || s.plats?.[bbl]) continue;
    const rec = parcels[bbl];
    if (!rec?.tract || rec.ag !== "crop") continue;
    const d = servedM(s, parcels, bbl);
    const psf = Math.max(farmUsePsf(rec, e), e.tractBid?.[bbl] ?? 0);
    bands[d < 500 ? 0 : d < 1500 ? 1 : d < 3000 ? 2 : 3].push(psf * 43560);
  }
  const anyCrop = tractList(parcels, bbls).map((b) => parcels[b]).find((r) => r?.ag === "crop");
  g.hist.push({
    m: s.month, pop, households: Math.round(pop / HH_SIZE),
    renters: Math.round((e.occupied?.multifamily ?? 0) / 900),
    newHomes: h.closed, started: h.startedY, closed: h.closedY,
    lots, acres: +acres.toFixed(1), plats,
    bought: g.yr.bought, refused: g.yr.refused,
    gradient: bands.map((b) => Math.round(median(b))),
    farmAcre: anyCrop ? Math.round(farmUsePsf(anyCrop, e) * 43560) : 0,
    homePsf: +(e.homes?.psf ?? 0).toFixed(1),
    roads: roadsSummary(s),
    town: townSummary(s),
  });
  g.yr = { bought: 0, refused: 0 };
}

// ---------------------------------------------------------------- the tick
/** The month's growth: monthly the board and the streets; quarterly the land market; annually the roads, the town and the record. */
export function tickGrowth(s: GameState, parcels: ParcelTable, bbls: string[], adjacency: Record<string, string[]> | null): void {
  if (s.citySize !== "region") return;
  if ((globalThis as { BW_NO_GROWTH?: boolean }).BW_NO_GROWTH) return;
  growthOf(s);
  tickProjects(s, parcels);
  tickRoads(s, parcels, bbls);
  if (s.month % 3 === 0) tickLandMarket(s, parcels, bbls);
  tickTownGrowth(s, parcels, bbls, adjacency);
  if (s.month % 12 === 0) recordYear(s, parcels, bbls);
}
