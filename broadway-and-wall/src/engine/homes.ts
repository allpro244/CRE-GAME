// THE HOMEBUILDER'S GAME (the region map, Phase 3).
//
// A plat's finished lots become houses, and houses become closings, the way
// they do in life:
//
//   PRICE      the going new house here is what its buyers can carry on a
//              mortgage at today's rate (homeprice.ts), sticky the way house
//              prices are, and placed by the resale houses round the plat and
//              the drive into town;
//   BUILD      a spec house goes up in about seven months, the draws paid as
//              the frame rises;
//   SELL       the town's households buy a few new houses a month — how many
//              depends on how fast the town is growing, whether they can
//              carry the price at today's rate, how many builders are
//              selling, and whose house is cheaper; a buyer signs on a house
//              and closes when it is finished;
//   LOTS       homebuilders buy finished lots at the residual — on a takedown
//              schedule, a few a month, as they start houses — so a plat sells
//              out only as fast as its houses do, and a lot's price carries its
//              place in that queue.
//
// The player can do either half: build and sell the houses on their own lots,
// or sell the lots to a builder who will. Every dollar of it goes through the
// ledger (logBooks): draws as "dev", closings as "sold", the tax on the profit
// as "taxes". A house that closes is a family's home: the lot leaves the
// market for good (demand.ts isCivicLand), as the town's neighbourhoods do.
import type { ParcelTable, ParcelRecord } from "@/data/types";
import type { GameState, HomeUnit, HomesState, PlatPL, LotContract, Exit } from "./types";
import { cloneState, monthLabel, closeDeedLedger, logBooks } from "./types";
import { ownerOf } from "./rivals";
import { rng, HPI_CHASE_M } from "./market";
import { resolveRec, assetValue, initialCondition } from "./value";
import { spendable, fundAndBook, sweepLocIdleCash } from "./credit";
import { saleTaxQuote } from "./actions";
import { recordComp } from "./comps";
import { firmShort } from "./firm";
import { INCOME_TAX_RATE } from "./tax";
import { money } from "./money";
import {
  homeQuote, fundamentalHomePsf, commuteMult, salesPace, selloutDiscount, homeSfFor,
  REF_HOME, BUILD_M, NAHB, type HomeMarket, type PlatMarket, type HomeQuote,
} from "./homeprice";

const YOU = "you";
/**
 * A homebuilder notices a plat with lots to sell and a residual worth paying
 * within a few months: a quarter a month [K]. Their offer stands two months.
 */
const BUILDER_ENTRY_P = 0.25;
const OFFER_LIFE_M = 2;
/**
 * A builder options a year and a half of its expected sales on a plat — the
 * public builders carry two to three years of lots owned and optioned [S,
 * 10-K filings], a smaller builder less.
 */
const TAKEDOWN_MONTHS = 18;
/**
 * A builder keeps about this many months of sales in houses under way and
 * unsold, so it has a house to sell when the buyer walks in: the build time
 * plus a little — new-home inventory runs 7-9 months' supply nationally, most
 * of it not yet finished (Census New Residential Sales) [S, rounded].
 */
const PIPELINE_MONTHS = BUILD_M + 2;
/** A builder walks away from a takedown when the lot's residual has fallen 30% under the contract price, as the public builders walked from options in 2007-09 [K]. */
const WALK_AT = 0.7;
const BUILDER_WORDS = [["Prairie", "Meadowlark", "Cedar Point", "Heritage", "Stonegate", "Willow Creek", "Fairfield", "Brookside", "Oakmont", "Red Barn"], ["Homes", "Builders", "Homebuilders", "Communities", "Home Co."]];

function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 2246822507); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function builderName(s: GameState, k: number): string {
  const a = BUILDER_WORDS[0][Math.floor(hash01(`hb-a:${s.seed}:${k}`) * BUILDER_WORDS[0].length)];
  const b = BUILDER_WORDS[1][Math.floor(hash01(`hb-b:${s.seed}:${k}`) * BUILDER_WORDS[1].length)];
  return `${a} ${b}`;
}

function homesOf(s: GameState): HomesState {
  s.homes ??= { units: {}, builders: {} };
  return s.homes;
}
const plOf = (h: HomesState, parent: string): PlatPL =>
  ((h.pl ??= {})[parent] ??= { started: 0, closed: 0, revenue: 0, net: 0, cost: 0, lotCost: 0, lotsSold: 0, lotProceeds: 0, lotBasis: 0 });

/** The lots of a finished plat, by BBL (landdev.ts lotBbl). */
export function platLots(s: GameState, parcels: ParcelTable, parent: string): string[] {
  const plat = s.plats?.[parent];
  const p = parcels[parent];
  if (!plat?.done || !p?.tract) return [];
  const base = 6e9 + (p.tract.id % 1e5) * 1e4;
  const out: string[] = [];
  for (let i = 1; i <= plat.lots.length; i++) if (parcels[String(base + i)]) out.push(String(base + i));
  return out;
}

/** Is this lot off the market as a house — a builder's, or a family's? (demand.ts isCivicLand reads it.) */
export function isHomeOffMarket(s: GameState, bbl: string): boolean {
  const u = s.homes?.units[bbl];
  return !!u && (u.by !== YOU || u.closedM !== undefined);
}

// ---------------------------------------------------------------- the market
/**
 * WHERE THE PLAT SITS. Two readings, multiplied:
 *
 * THE RESALE COMPS. The town's existing houses (the inner ring's one-, two-
 * and three-family frames) as the engine values them, per foot, near the plat
 * against the whole town (geometric means — the values are skewed, and an
 * arithmetic mean against a median read every plat as a 20-40% premium): a
 * plat next to the dear end of town sells dearer. Weighted by distance (e-folding 1 km) and shrunk toward the town
 * (credibility W / (W + 3)), so a plat with no houses near it reads 1.
 * Only the RELATIVE reading is used: the inner ring's values carry the
 * town's land texture, which is struck in the reference table's dollars
 * rather than this town's (value.ts readLand), so their LEVEL is not
 * evidence about what a family here can pay — affordability is.
 *
 * THE DRIVE. The commute from the plat to the town's edge, capitalised
 * (homeprice.ts commuteMult).
 */
export function platLocation(s: GameState, parcels: ParcelTable, parent: string, psfEdge: number): { loc: number; commute: number } {
  const p = parcels[parent];
  if (!p?.tract) return { loc: 1, commute: 1 };
  const commute = commuteMult(s.econ, p.tract.edgeM, psfEdge * REF_HOME.sf);
  const comps = houseComps(s, parcels);
  let W = 0, wp = 0;
  const [lon, lat] = p.centroid;
  const kx = 111_320 * Math.cos((lat * Math.PI) / 180), ky = 110_540;
  for (const c of comps.list) {
    const d = Math.hypot((c.x - lon) * kx, (c.y - lat) * ky);
    const w = Math.exp(-d / 1000);
    W += w; wp += w * Math.log(c.psf);
  }
  // geometric means, so a skewed spread of values does not read as a premium
  const rel = W > 0 && comps.lnMean !== 0 ? Math.exp(wp / W - comps.lnMean) : 1;
  const cred = W / (W + 3);
  const fromComps = Math.max(0.7, Math.min(1.3, 1 + cred * (rel - 1)));
  return { loc: fromComps * commute, commute };
}
/** The town's houses as comps, re-read once a year (and on a new state). */
let COMPS: { key: string; list: { x: number; y: number; psf: number }[]; lnMean: number } | null = null;
export function houseComps(s: GameState, parcels: ParcelTable) {
  const key = `${s.seed}:${Math.floor(s.month / 12)}:${Object.keys(parcels).length > 0 ? 1 : 0}`;
  if (COMPS?.key === key) return COMPS;
  const list: { x: number; y: number; psf: number }[] = [];
  for (const bbl in parcels) {
    const raw = parcels[bbl];
    if (raw.class !== "multifamily" || !(raw.bldgClass === "A1" || raw.bldgClass === "B1" || raw.bldgClass === "C0")) continue;
    if ((raw.unitsRes ?? 0) > 3) continue;
    const rec = resolveRec(parcels, s, bbl);
    if (!rec || rec.class !== "multifamily" || !(rec.bldgArea > 0)) continue;
    const v = assetValue(rec, s.econ, initialCondition(rec));
    if (!(v > 0)) continue;
    list.push({ x: rec.centroid[0], y: rec.centroid[1], psf: v / rec.bldgArea });
  }
  const lnMean = list.length ? list.reduce((t, c) => t + Math.log(c.psf), 0) / list.length : 0;
  COMPS = { key, list, lnMean };
  return COMPS;
}

/** Who is selling houses in town this month: (plat, builder) with a house nobody has signed for. */
function sellers(h: HomesState): Map<string, { parent: string; by: string; units: HomeUnit[] }> {
  const out = new Map<string, { parent: string; by: string; units: HomeUnit[] }>();
  for (const u of Object.values(h.units)) {
    if (u.soldM !== undefined || u.closedM !== undefined) continue;
    const k = `${u.parent}|${u.by}`;
    const e = out.get(k);
    if (e) e.units.push(u); else out.set(k, { parent: u.parent, by: u.by, units: [u] });
  }
  return out;
}

/** The median lot of a plat, sf, and its rezoned FAR. */
function platLotSf(s: GameState, parent: string): number {
  const lots = s.plats?.[parent]?.lots ?? [];
  if (!lots.length) return REF_HOME.lotSf;
  const a = lots.map((l) => l.a).sort((x, y) => x - y);
  return a[a.length >> 1];
}
const platFar = (s: GameState, parent: string) => s.rezoned?.[parent]?.far ?? 0.6;

/** Lots on the plat nobody has started a house on, and who holds them. */
function freeLots(s: GameState, parcels: ParcelTable, parent: string): { mine: string[]; market: string[] } {
  const mine: string[] = [], market: string[] = [];
  for (const bbl of platLots(s, parcels, parent)) {
    if (s.homes?.units[bbl]) continue;
    const h = s.holdings[bbl];
    if (h) { mine.push(bbl); continue; }
    if (s.built?.[bbl] || s.developments?.[bbl] || ownerOf(s, bbl) || (s.cityJobs ?? []).some((j) => j.bbl === bbl)) continue;
    market.push(bbl);
  }
  return { mine, market };
}

/**
 * Rewrite `econ.homes`: the going price, and each finished plat's location,
 * pace and sell-out. Called by the tick and after every action that changes
 * what is left on a plat, and it bumps the stamp the land memo keys on.
 */
export function refreshHomeMarket(s: GameState, parcels: ParcelTable): void {
  const e = s.econ;
  const fund = fundamentalHomePsf(e);
  const prev = e.homes;
  const psf = prev?.psf ?? fund;
  const plats: Record<string, PlatMarket> = {};
  const h = s.homes;
  const sel = h ? sellers(h) : new Map();
  const n = sel.size;
  for (const [parent, plat] of Object.entries(s.plats ?? {})) {
    // an industrial park (landdev.ts) is not a housing plat: no homes market reads it
    if (!plat.done || plat.template === "industrial") continue;
    const { loc, commute } = prev?.plats[parent] && s.month % 12 !== 0 && prev.plats[parent].loc > 0
      ? prev.plats[parent] : platLocation(s, parcels, parent, psf);
    const q = homeQuote(e, platLotSf(s, parent), psf * loc, platFar(s, parent));
    const here = [...sel.values()].filter((x) => x.parent === parent);
    const adjOf = (by: string) => (by === YOU ? h?.adj?.[parent] ?? 0 : 0);
    const pace = here.length
      ? here.reduce((t, x) => t + salesPace(e, q.price / loc, adjOf(x.by), n), 0)
      : salesPace(e, q.price / loc, 0, n + 1);
    const { mine, market } = freeLots(s, parcels, parent);
    const left = mine.length + market.length;
    plats[parent] = { loc, commute, pace, disc: q.residual > 0 ? selloutDiscount(left, pace) : 0, left };
  }
  const next: HomeMarket = { psf, fund, stamp: (prev?.stamp ?? 0) + 1, plats };
  e.homes = next;
  e.homesStamp = next.stamp;
}

/** The going quote on a plat this month: the standard house on its median lot. */
export function platQuoteNow(s: GameState, parent: string, adj = 0): (HomeQuote & { psfHere: number }) | null {
  const hm = s.econ.homes, pm = hm?.plats[parent];
  if (!hm || !pm) return null;
  const psfHere = hm.psf * pm.loc;
  return { ...homeQuote(s.econ, platLotSf(s, parent), psfHere, platFar(s, parent), adj), psfHere };
}

// ---------------------------------------------------------------- the player builds
/** Start `n` spec houses on your own finished lots on this plat. Self-funded: the whole budget must be in reach. */
export function startHomes(s: GameState, parcels: ParcelTable, parent: string, n: number): { s: GameState; err?: string; msg?: string } {
  const plat = s.plats?.[parent];
  if (!plat?.done) return { s, err: "The streets are not in yet." };
  if (!s.econ.homes?.plats[parent]) return { s, err: "No homes market reads this plat yet: advance a month." };
  const contract = s.homes?.contracts?.[parent];
  const free = freeLots(s, parcels, parent).mine.filter((b) => {
    const h = s.holdings[b];
    return h && !h.loan && !h.sale && !s.developments?.[b];
  });
  // lots already promised to a builder stay for the builder
  const avail = free.slice(0, Math.max(0, free.length - (contract?.left ?? 0)));
  const k = Math.min(Math.max(0, Math.floor(n)), avail.length);
  if (!k) return { s, err: contract ? "Every free lot here is promised to a builder." : "You hold no free lots on this plat (a lot with a loan, a listing or a building on it is not free)." };
  const hm = s.econ.homes!, pm = hm.plats[parent];
  const adj = s.homes?.adj?.[parent] ?? 0;
  const jobs = avail.slice(0, k).map((bbl) => {
    const rec = parcels[bbl];
    const q = homeQuote(s.econ, rec.lotArea, hm.psf * pm.loc, platFar(s, parent), adj);
    return { bbl, q };
  });
  const total = jobs.reduce((t, j) => t + j.q.vertical + j.q.overhead, 0);
  const room = spendable(s, parcels);
  if (room.total < total) return { s, err: `${k} houses run ${money(total)} to build and you can raise ${money(room.total)}.` };
  const next = cloneState(s);
  const h = homesOf(next);
  const pl = plOf(h, parent);
  for (const { bbl, q } of jobs) {
    h.units[bbl] = {
      bbl, parent, by: YOU, sf: q.sf, startM: next.month, doneM: next.month + BUILD_M,
      budget: q.vertical + q.overhead, spent: 0, lotCost: next.holdings[bbl].costBasis,
    };
    pl.started++;
  }
  refreshHomeMarket(next, parcels);
  next.news.unshift({ q: next.month, kind: "info", text: `${k} spec house${k === 1 ? "" : "s"} going up at ${parcels[parent]?.address ?? parent}: ${money(total)} to build, finished ${monthLabel(next.month + BUILD_M)}.` });
  return { s: next, msg: `${k} started.` };
}

/** Your price on the plat, against the going one (-15% .. +15%). Signed contracts keep their price. */
export function setHomePrice(s: GameState, parcels: ParcelTable, parent: string, adj: number): GameState {
  const next = cloneState(s);
  const h = homesOf(next);
  (h.adj ??= {})[parent] = Math.max(-0.15, Math.min(0.15, Math.round(adj * 100) / 100));
  refreshHomeMarket(next, parcels);
  return next;
}

export function acceptLotOffer(s: GameState, parcels: ParcelTable, parent: string): { s: GameState; err?: string; msg?: string } {
  const o = s.homes?.offers?.[parent];
  if (!o || s.month > o.expiresM) return { s, err: "That offer has lapsed." };
  if (s.homes?.contracts?.[parent]) return { s, err: "A builder already has a takedown here." };
  const free = freeLots(s, parcels, parent).mine.filter((b) => !s.holdings[b]?.loan && !s.holdings[b]?.sale).length;
  if (!free) return { s, err: "You have no free lots left on this plat to sell." };
  const lots = Math.min(o.lots, free);
  const next = cloneState(s);
  const h = homesOf(next);
  delete h.offers![parent];
  (h.contracts ??= {})[parent] = { ...o, lots, left: lots, taken: 0 };
  next.news.unshift({ q: next.month, kind: "deal", text: `${o.builder} signed to take down ${lots} lots at ${parcels[parent]?.address ?? parent}, $${o.psf.toFixed(2)}/sf of lot, as it starts houses.` });
  return { s: next, msg: "Signed." };
}
export function declineLotOffer(s: GameState, parent: string): GameState {
  const next = cloneState(s);
  if (next.homes?.offers?.[parent]) delete next.homes.offers[parent];
  return next;
}

// ---------------------------------------------------------------- the tick
function poisson(s: GameState, lambda: number): number {
  if (!(lambda > 0)) return 0;
  const L = Math.exp(-Math.min(lambda, 30));
  let k = 0, p = 1;
  do { k++; p *= rng(s, "homes"); } while (p > L && k < 60);
  return k - 1;
}

/** A finished house you sold closes: the proceeds, the tax on the profit, and the lot leaves the market as a family's home. */
function closeYourHome(s: GameState, parcels: ParcelTable, u: HomeUnit) {
  const h = s.holdings[u.bbl];
  const homes = homesOf(s);
  const pl = plOf(homes, u.parent);
  u.closedM = s.month;
  const price = u.price ?? 0;
  const selling = Math.round((NAHB.commission + NAHB.marketing) * price);
  const net = price - selling;
  pl.closed++; pl.revenue += price; pl.net += net; pl.cost += u.spent; pl.lotCost += u.lotCost;
  if (!h) return;
  const basis = h.costBasis;
  const gain = net - basis;
  s.cash += net;
  logBooks(s, "sold", net, u.bbl);
  // A HOUSE IS A BUILDER'S INVENTORY, NOT AN INVESTMENT: the profit is
  // ordinary income (a dealer's property, IRC §1221(a)(1)), taxed at the
  // sponsor's blended rate (tax.ts INCOME_TAX_RATE), withheld at the close as
  // the sale desk withholds a capital gain.
  const tax = gain > 0 ? Math.round(gain * INCOME_TAX_RATE) : 0;
  if (tax > 0) { s.cash -= tax; s.taxesPaid = (s.taxesPaid ?? 0) + tax; logBooks(s, "taxes", tax); }
  const rec = resolveRec(parcels, s, u.bbl);
  const ex: Exit = { bbl: u.bbl, address: rec?.address ?? u.bbl, boughtM: h.boughtM, soldM: s.month, price, basis, gain };
  closeDeedLedger(s, ex);
  (s.exits ??= []).push(ex);
  if (s.exits.length > 200) s.exits.shift();
  (s.lastTradeM ??= {})[u.bbl] = s.month;
  delete s.holdings[u.bbl];
}

/** A builder takes down one of your lots under its contract: a land sale, at the contract price. */
function takeDown(s: GameState, parcels: ParcelTable, c: LotContract, bbl: string): number {
  const h = s.holdings[bbl];
  const rec = resolveRec(parcels, s, bbl);
  if (!h || !rec) return 0;
  const price = Math.round(c.psf * rec.lotArea);
  const q = saleTaxQuote(h, price, s);
  s.cash += q.net;
  logBooks(s, "sold", q.net, bbl);
  if (q.tax > 0) { s.cash -= q.tax; s.taxesPaid = (s.taxesPaid ?? 0) + q.tax; logBooks(s, "taxes", q.tax); }
  const pl = plOf(homesOf(s), c.parent);
  pl.lotsSold++; pl.lotProceeds += q.net; pl.lotBasis += h.costBasis;
  const ex: Exit = { bbl, address: rec.address, boughtM: h.boughtM, soldM: s.month, price, basis: h.costBasis, gain: q.gain };
  closeDeedLedger(s, ex);
  (s.exits ??= []).push(ex);
  if (s.exits.length > 200) s.exits.shift();
  recordComp(s, rec, price, c.builder, firmShort(s));
  (s.lastTradeM ??= {})[bbl] = s.month;
  delete s.holdings[bbl];
  c.left--; c.taken++;
  return price;
}

/** The month's homebuilding: draws, sales, closings, the builders, and the market they all read. */
export function tickHomes(s: GameState, parcels: ParcelTable): void {
  if (s.citySize !== "region" && !s.plats) return;
  const e = s.econ;
  // the town's household growth, from its population a year ago
  {
    const hist = (homesOf(s).popHist ??= []);
    hist.push(e.population ?? 0);
    if (hist.length > 13) hist.shift();
    if (hist.length === 13 && hist[0] > 0) e.homesG12 = hist[12] / hist[0] - 1;
  }
  // the going price chases what the town's buyers can carry, a third of the gap a year (market.ts HPI_CHASE_M)
  const fund = fundamentalHomePsf(e);
  if (e.homes) e.homes.psf += (fund - e.homes.psf) / HPI_CHASE_M;
  refreshHomeMarket(s, parcels);
  const h = s.homes;
  if (!h) return;

  // 1. THE FRAMES GO UP: your draws, a month's share of the budget at a time.
  for (const u of Object.values(h.units)) {
    if (u.by !== YOU || u.closedM !== undefined || u.spent >= u.budget) continue;
    if (!s.holdings[u.bbl]) continue;
    const due = Math.min(u.budget - u.spent, Math.ceil(u.budget / BUILD_M));
    const paid = fundAndBook(s, parcels, due, "dev", { bbl: u.bbl });
    u.spent += paid;
    s.holdings[u.bbl].costBasis += paid;
    // a draw the account cannot meet stops the trades for the month
    if (paid < due) u.doneM = Math.max(u.doneM, s.month + Math.ceil((u.budget - u.spent) / Math.max(1, u.budget / BUILD_M)));
  }
  // a builder's frames go up on its own money (off the player's books)
  for (const u of Object.values(h.units)) if (u.by !== YOU && u.spent < u.budget) u.spent = Math.min(u.budget, u.spent + Math.ceil(u.budget / BUILD_M));

  // 2. THE BUYERS. Each builder with a house to sell draws this month's buyers.
  const hm = e.homes!;
  const sel = sellers(h);
  const n = sel.size;
  for (const x of [...sel.values()].sort((a, b) => (a.parent + a.by).localeCompare(b.parent + b.by))) {
    const pm = hm.plats[x.parent];
    if (!pm) continue;
    const adj = x.by === YOU ? h.adj?.[x.parent] ?? 0 : 0;
    const std = homeQuote(e, platLotSf(s, x.parent), hm.psf * pm.loc, platFar(s, x.parent), 0);
    const lambda = salesPace(e, std.price / pm.loc, adj, n);
    let k = poisson(s, lambda);
    const queue = x.units.slice().sort((a, b) => a.doneM - b.doneM || a.bbl.localeCompare(b.bbl));
    for (const u of queue) {
      if (k <= 0) break;
      u.soldM = s.month;
      u.price = Math.round(hm.psf * pm.loc * u.sf * (1 + adj));
      k--;
    }
  }

  // 3. CLOSINGS: a signed house closes the month it is finished.
  for (const u of Object.values(h.units).sort((a, b) => a.bbl.localeCompare(b.bbl))) {
    if (u.soldM === undefined || u.closedM !== undefined || s.month < u.doneM || u.spent < u.budget) continue;
    if (u.by === YOU) closeYourHome(s, parcels, u);
    else {
      u.closedM = s.month;
      const b = h.builders[u.by];
      if (b) { b.closed++; b.revenue += u.price ?? 0; b.cost += u.spent + u.lotCost; }
    }
  }

  // 4. THE BUILDERS: start houses on lots they take down, and come looking for more.
  for (const [parent, plat] of Object.entries(s.plats ?? {})) {
    if (!plat.done || !hm.plats[parent]) continue;
    const pm = hm.plats[parent];
    const q = homeQuote(e, platLotSf(s, parent), hm.psf * pm.loc, platFar(s, parent));
    const c = h.contracts?.[parent];
    // the builder walks when the lots are no longer worth what it agreed to pay
    if (c && (c.left <= 0 || q.residualPsf < WALK_AT * c.psf)) {
      if (c.left > 0) s.news.unshift({ q: s.month, kind: "warn", text: `${c.builder} walked from its takedown at ${parcels[parent]?.address ?? parent}: ${c.left} lots left untaken. Houses here no longer pay $${c.psf.toFixed(2)}/sf for the dirt.` });
      delete h.contracts![parent];
    }
    const contract = h.contracts?.[parent];
    const { mine, market } = freeLots(s, parcels, parent);
    // who is building here
    const here = new Set(Object.values(h.units).filter((u) => u.parent === parent && u.by !== YOU && u.closedM === undefined).map((u) => u.by));
    if (contract) here.add(contract.builder);
    // A BUILDER COMES LOOKING where there are lots, a residual worth paying,
    // and nobody building: it offers to take down yours, and starts on any
    // the market holds.
    const freeMine = mine.filter((b) => s.holdings[b] && !s.holdings[b].loan && !s.holdings[b].sale);
    if (!here.size && q.residual > 0 && !h.offers?.[parent] && (freeMine.length || market.length) && rng(s, "homes") < BUILDER_ENTRY_P) {
      const used = new Set(Object.keys(h.builders));
      let k = 0, name = builderName(s, k);
      while (used.has(name) && k < 40) name = builderName(s, ++k);
      h.builders[name] ??= { name, sinceM: s.month, lots: 0, lotSpend: 0, started: 0, closed: 0, revenue: 0, cost: 0 };
      if (market.length) here.add(name);
      if (freeMine.length) {
        const pace = salesPace(e, q.price / pm.loc, 0, n + 1);
        const lots = Math.min(freeMine.length, Math.max(4, Math.round(pace * TAKEDOWN_MONTHS)));
        (h.offers ??= {})[parent] = { parent, builder: name, lots, psf: +q.residualPsf.toFixed(2), madeM: s.month, expiresM: s.month + OFFER_LIFE_M };
        s.news.unshift({ q: s.month, kind: "deal", text: `${name} offers to take down ${lots} of your lots at ${parcels[parent]?.address ?? parent} at $${q.residualPsf.toFixed(2)}/sf of lot (${money(q.residual)} a typical lot), a few a month as it starts houses. Open until ${monthLabel(s.month + OFFER_LIFE_M)}.` });
      }
    }
    for (const by of [...here].sort()) {
      const unsold = Object.values(h.units).filter((u) => u.parent === parent && u.by === by && u.soldM === undefined).length;
      const pace = salesPace(e, q.price / pm.loc, 0, Math.max(1, n));
      const want = Math.min(Math.max(1, Math.ceil(pace * 2)), Math.ceil(pace * PIPELINE_MONTHS) - unsold);
      // a house is started only where it pays for its frame (the lot is bought with it, at the residual)
      if (want <= 0 || !(q.residual > 0)) continue;
      for (let i = 0; i < want; i++) {
        let bbl: string | undefined, lotCost = 0;
        const fromYou = contract && contract.builder === by && contract.left > 0 ? mine.find((b) => s.holdings[b] && !s.holdings[b].loan && !s.holdings[b].sale && !h.units[b]) : undefined;
        if (fromYou) { lotCost = takeDown(s, parcels, contract!, fromYou); if (lotCost > 0) bbl = fromYou; }
        else {
          const m = market.find((b) => !h.units[b]);
          if (m) { bbl = m; lotCost = Math.round(q.residualPsf * (parcels[m]?.lotArea ?? 0) * pm.disc); }
        }
        if (!bbl) break;
        const rec = parcels[bbl];
        const qq = homeQuote(e, rec.lotArea, hm.psf * pm.loc, platFar(s, parent));
        h.units[bbl] = { bbl, parent, by, sf: qq.sf, startM: s.month, doneM: s.month + BUILD_M, budget: qq.vertical + qq.overhead, spent: 0, lotCost };
        const b = (h.builders[by] ??= { name: by, sinceM: s.month, lots: 0, lotSpend: 0, started: 0, closed: 0, revenue: 0, cost: 0 });
        b.lots++; b.lotSpend += lotCost; b.started++;
      }
    }
  }
  for (const [p, o] of Object.entries(h.offers ?? {})) if (s.month > o.expiresM) delete h.offers![p];
  // the sales and takedowns moved what is left on each plat
  refreshHomeMarket(s, parcels);
  if (h.contracts) sweepLocIdleCash(s);
}

// ---------------------------------------------------------------- the desk's read
export type PlatHomesView = {
  quote: HomeQuote & { psfHere: number };
  fund: number; psfTown: number; loc: number; commute: number;
  pace: number; disc: number; left: number;
  lots: number; mine: number; building: number; forSale: number; signed: number; closed: number;
  builders: { name: string; building: number; closed: number }[];
  adj: number; yourPace: number;
  pl: PlatPL | null;
  offer: import("./types").LotOffer | null;
  contract: LotContract | null;
};
/** Everything the homebuilding desk shows for one plat. */
export function platHomesView(s: GameState, parcels: ParcelTable, parent: string): PlatHomesView | null {
  const quote = platQuoteNow(s, parent);
  const hm = s.econ.homes, pm = hm?.plats[parent];
  if (!quote || !hm || !pm) return null;
  const all = platLots(s, parcels, parent);
  const h = s.homes;
  const units = Object.values(h?.units ?? {}).filter((u) => u.parent === parent);
  const mineU = units.filter((u) => u.by === YOU);
  const adj = h?.adj?.[parent] ?? 0;
  const n = h ? sellers(h).size : 0;
  const yourSelling = mineU.some((u) => u.soldM === undefined);
  const byB = new Map<string, { name: string; building: number; closed: number }>();
  for (const u of units) {
    if (u.by === YOU) continue;
    const b = byB.get(u.by) ?? { name: u.by, building: 0, closed: 0 };
    if (u.closedM === undefined) b.building++; else b.closed++;
    byB.set(u.by, b);
  }
  return {
    quote, fund: hm.fund, psfTown: hm.psf, loc: pm.loc, commute: pm.commute,
    pace: pm.pace, disc: pm.disc, left: pm.left,
    lots: all.length,
    mine: all.filter((b) => s.holdings[b]).length,
    building: mineU.filter((u) => u.closedM === undefined && (u.spent < u.budget || s.month < u.doneM)).length,
    forSale: mineU.filter((u) => u.soldM === undefined).length,
    signed: mineU.filter((u) => u.soldM !== undefined && u.closedM === undefined).length,
    closed: mineU.filter((u) => u.closedM !== undefined).length,
    builders: [...byB.values()],
    adj,
    yourPace: salesPace(s.econ, quote.price / pm.loc, adj, yourSelling ? Math.max(1, n) : n + 1),
    pl: h?.pl?.[parent] ?? null,
    offer: h?.offers?.[parent] ?? null,
    contract: h?.contracts?.[parent] ?? null,
  };
}
export { homeSfFor };
export type { ParcelRecord };

/**
 * WHAT A FINISHED LOT HERE WOULD FETCH, for a tract not yet platted: the
 * builder's residual on the house a `lotSf` lot carries at this tract's
 * location, today, and the sell-out discount `lots` of them would take at the
 * pace one more builder would sell. What the land developer's desk shows
 * before anyone buys a farm.
 */
export function tractLotQuote(s: GameState, parcels: ParcelTable, bbl: string, lotSf: number, lots: number) {
  const e = s.econ;
  const psf = e.homes?.psf ?? fundamentalHomePsf(e);
  const { loc, commute } = platLocation(s, parcels, bbl, psf);
  const quote = homeQuote(e, lotSf, psf * loc, 0.6);
  const n = s.homes ? sellers(s.homes).size : 0;
  const pace = salesPace(e, quote.price / loc, 0, n + 1);
  const disc = quote.residual > 0 ? selloutDiscount(lots, pace) : 0;
  return { quote, loc, commute, pace, disc, lotValue: Math.max(0, quote.residual) * disc };
}
