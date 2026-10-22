// THE HOMEBUILDERS AND THE LOTS THEY BUY (the region map, Phase 3).
//
// A plat's finished lots become houses, and houses become closings, the way
// they do in life:
//
//   PRICE      the going new house here is what its buyers can carry on a
//              mortgage at today's rate (homeprice.ts), sticky the way house
//              prices are, and placed by the resale houses round the plat and
//              the drive into town;
//   BUILD      a homebuilder's spec house goes up in about seven months;
//   SELL       the town's households buy a few new houses a month — how many
//              depends on how fast the town is growing, whether they can
//              carry the price at today's rate, and how many builders are
//              selling; a buyer signs on a house and closes when it is done;
//   LOTS       homebuilders buy finished lots at the residual — on a takedown
//              schedule, a few a month, as they start houses, or the whole
//              plat at once at a discount for carrying it — so a plat sells
//              out only as fast as its houses do, and a lot's price carries
//              its place in that queue.
//
// THE PLAYER IS THE LAND DEVELOPER (owner's decision, Oct 2026): buy the
// tract, entitle it, plat it, sell the finished lots to the homebuilders. The
// houses are the builders' business. Every dollar the player sees goes
// through the ledger (logBooks): each lot sale as "sold", the tax on the gain
// as "taxes". A house that closes is a family's home: the lot leaves the
// market for good (demand.ts isCivicLand), as the town's neighbourhoods do.
import type { ParcelTable, ParcelRecord } from "@/data/types";
import type { GameState, HomeUnit, HomesState, HomeBuilder, PlatPL, LotContract, LotOffer, LotListing, Exit } from "./types";
import { cloneState, monthLabel, closeDeedLedger, logBooks, START_YEAR } from "./types";
import { queueSupplyProject } from "./supply";
import { rentableFromSpec } from "./value";
import { ownerOf } from "./rivals";
import { rng, HPI_CHASE_M } from "./market";
import { resolveRec, assetValue, initialCondition } from "./value";
import { sweepLocIdleCash } from "./credit";
import { pickConstructionDesk } from "./dev";
import { lenderByName, chargeLenderLoss } from "./lenders";
import { saleTaxQuote } from "./actions";
import { recordComp } from "./comps";
import { firmShort } from "./firm";
import { money } from "./money";
import {
  homeQuote, fundamentalHomePsf, commuteMult, salesPace, selloutDiscount, homeSfFor, lotPremiumMult,
  REF_HOME, BUILD_M, NAHB, type HomeMarket, type PlatMarket, type HomeQuote,
} from "./homeprice";

/**
 * A homebuilder notices a plat with lots for sale and a residual worth paying
 * within a few months: a quarter a month [K]; twice that when the plat is
 * listed to the builders, which is what a land broker is paid for. An offer
 * stands two months.
 */
const BUILDER_ENTRY_P = 0.25;
const LISTED_ENTRY_P = 0.5;
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
/**
 * WHAT ONE COMMUNITY CAN SELL. A builder's sales office on one plat — a model
 * home or two, a sales agent, one product line — closes about 2-6 houses a
 * month in an ordinary market, and above ~6 is the top decile of US
 * communities (Zonda / John Burns community absorption surveys; the fastest
 * single-builder communities in master plans reach 8-10). A town whose
 * new-house demand runs past what one community can sell does not push it
 * through one sales office: the buyers buy resale, or in the next town, until
 * a second builder opens (the entry rule below brings one). 6 [S, top-decile
 * pace]. It binds only in a fast-growing town with a single seller.
 */
export const COMMUNITY_SALES_CAP = 6;
const communityPace = (...a: Parameters<typeof salesPace>) => Math.min(COMMUNITY_SALES_CAP, salesPace(...a));
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
  ((h.pl ??= {})[parent] ??= { lotsSold: 0, lotRevenue: 0, lotProceeds: 0, lotBasis: 0 });
/**
 * A HOMEBUILDER IS FOUNDED with its own money — lognormal round $3M in the
 * town's opening prices, carried at inflation, the same purse the town's
 * developers draw (dev.ts newBuilder; NAHB puts the typical single-family
 * builder at a few million of revenue a year) — and a construction desk.
 */
function newBuilder(s: GameState, name: string): HomeBuilder {
  const capital = Math.round(3_000_000 * Math.exp(0.9 * (hash01(`${s.seed}:hbcap:${name}`) * 2 - 1)) * (s.econ.priceLevel ?? 1) * (s.econ.cpi ?? 1));
  return { name, sinceM: s.month, capital, cash: capital, debt: 0, lender: pickConstructionDesk(s, `hb:${name}`), interestPaid: 0,
    lots: 0, lotSpend: 0, started: 0, closed: 0, revenue: 0, cost: 0 };
}
/**
 * WHAT THE DESK ADVANCES. The interagency supervisory loan-to-value limits
 * (12 CFR 34 App. A, OCC / FDIC / Fed): 75% for land development, 85% for
 * one-to-four family residential construction — the most a regulated bank
 * may lend against a finished lot and a house going up on it. The builder's
 * own money is the rest. A desk that has failed advances nothing.
 */
const LOT_ADVANCE = 0.75, HOUSE_ADVANCE = 0.85;
/** The construction desk's coupon: the loan index plus 2.4 points (proforma.ts CONSTR_SPREAD). */
const builderRate = (s: GameState) => ((s.econ.indexRate ?? 5.4) + 2.4) / 100;
const deskOpen = (s: GameState, b: HomeBuilder) => !!b.lender && lenderByName(s, b.lender)?.failedM === undefined;
/** Can the builder fund `cost` of lot (and the cash share of the house it starts on it)? */
function canFund(s: GameState, b: HomeBuilder, lotCost: number, houseBudget: number): boolean {
  const adv = deskOpen(s, b);
  const own = lotCost * (adv ? 1 - LOT_ADVANCE : 1) + houseBudget * (adv ? 1 - HOUSE_ADVANCE : 1);
  return b.failedM === undefined && b.cash >= own;
}
/** Pay `amount`, the desk advancing `adv` of it while open; returns what it borrowed. */
function builderPays(s: GameState, b: HomeBuilder, amount: number, adv: number): number {
  const loan = deskOpen(s, b) ? Math.round(amount * adv) : 0;
  b.debt += loan;
  b.cash -= amount - loan;
  return loan;
}

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

/**
 * Is this lot off the market — a homebuilder's lot, or a house it has not yet
 * closed? (demand.ts isCivicLand reads it.) A house a family has closed on is
 * an ordinary house again, in the town's stock and on its market, and resells
 * as the inner ring's houses do.
 */
export function isHomeOffMarket(s: GameState, bbl: string): boolean {
  const u = s.homes?.units[bbl];
  return (!!u && u.closedM === undefined) || !!s.homes?.held?.[bbl];
}

/** A house's storeys: one up to 1,800 sf, two above (Census: about half of new single-family houses are two-storey) [S, rounded]. */
export const houseFloors = (sf: number) => (sf > 1_800 ? 2 : 1);

/**
 * A HOUSE STARTS. Its square feet join the town's construction queue the day
 * the frame goes up (supply.ts), so the space market sees it coming and books
 * it into the housing stock the month it is finished — the same road every
 * other building in town takes.
 */
function startUnit(s: GameState, u: HomeUnit): void {
  s.homes!.units[u.bbl] = u;
  queueSupplyProject(s, { bbl: u.bbl, source: "homes", startM: u.startM, deliverM: u.doneM, sfByUse: { multifamily: rentableFromSpec(u.sf, houseFloors(u.sf)) } });
}
/** ...and is finished: it stands on its lot, a house (the map draws it as one). */
function finishUnit(s: GameState, parcels: ParcelTable, u: HomeUnit): void {
  u.builtM = s.month;
  const fl = houseFloors(u.sf);
  const lot = parcels[u.bbl]?.lotArea ?? u.sf;
  s.built[u.bbl] = { class: "multifamily", bldgArea: u.sf, floors: fl, yearBuilt: START_YEAR + Math.floor(s.month / 12), cov: +Math.min(0.6, u.sf / fl / Math.max(1, lot)).toFixed(3), house: true };
}

// ---------------------------------------------------------------- the market
/**
 * WHERE THE PLAT SITS. Two readings, multiplied:
 *
 * THE RESALE COMPS. The town's existing houses (the inner ring's one-, two-
 * and three-family frames) as the engine values them, per foot, near the plat
 * against the whole town (geometric means — the values are skewed, and an
 * arithmetic mean against a median read every plat as a 20-40% premium): a
 * plat next to the dear end of town sells dearer. Weighted by distance
 * (e-folding 1 km) and shrunk toward the town (credibility W / (W + 3)), so a
 * plat with no houses near it reads 1. Only the RELATIVE reading is used: a
 * house's value is mostly the land under it, and the level of that is the
 * land market's own reading (value.ts texture), while what a family here can
 * pay is affordability's.
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
  const rel = W > 0 && comps.lnMean !== 0 ? Math.exp(wp / W - comps.lnMean) : 1;
  const cred = W / (W + 3);
  const fromComps = Math.max(0.7, Math.min(1.3, 1 + cred * (rel - 1)));
  return { loc: fromComps * commute, commute };
}
/** The town's houses as comps, re-read once a year (and on a new state). */
let COMPS: { key: string; list: { x: number; y: number; psf: number }[]; lnMean: number } | null = null;
export function houseComps(s: GameState, parcels: ParcelTable) {
  const key = `${s.seed}:${Math.floor(s.month / 12)}`;
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

/** The median lot of a plat, sf. */
function platLotSf(s: GameState, parent: string): number {
  const lots = s.plats?.[parent]?.lots ?? [];
  if (!lots.length) return REF_HOME.lotSf;
  const a = lots.map((l) => l.a).sort((x, y) => x - y);
  return a[a.length >> 1];
}
const platFar = (s: GameState, parent: string) => s.rezoned?.[parent]?.far ?? 0.6;

/**
 * The plat's lots with no house on them, by who holds them: yours (free to
 * sell: no loan, no listing on the street), a builder's, or the market's.
 */
function freeLots(s: GameState, parcels: ParcelTable, parent: string): { mine: string[]; held: string[]; market: string[] } {
  const mine: string[] = [], held: string[] = [], market: string[] = [];
  for (const bbl of platLots(s, parcels, parent)) {
    if (s.homes?.units[bbl]) continue;
    if (s.homes?.held?.[bbl]) { held.push(bbl); continue; }
    const h = s.holdings[bbl];
    // (a lot under an A&D note is free to sell: the note is released lot by lot, sellLot)
    if (h) { if ((!h.loan || h.loan.ad) && !h.sale) mine.push(bbl); continue; }
    if (s.built?.[bbl] || s.developments?.[bbl] || ownerOf(s, bbl) || (s.cityJobs ?? []).some((j) => j.bbl === bbl)) continue;
    market.push(bbl);
  }
  return { mine, held, market };
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
  const sel = s.homes ? sellers(s.homes) : new Map();
  const n = sel.size;
  for (const [parent, plat] of Object.entries(s.plats ?? {})) {
    // an industrial park (landdev.ts) is not a housing plat: no homes market reads it
    if (!plat.done || plat.template === "industrial") continue;
    const { loc, commute } = prev?.plats[parent] && s.month % 12 !== 0 && prev.plats[parent].loc > 0
      ? prev.plats[parent] : platLocation(s, parcels, parent, psf);
    const q = homeQuote(e, platLotSf(s, parent), psf * loc, platFar(s, parent));
    const here = [...sel.values()].filter((x) => x.parent === parent).length;
    // the plat sells at its own builders' pace; with none, at one newcomer's
    const pace = here ? here * communityPace(e, q.price / loc, 0, n) : communityPace(e, q.price / loc, 0, n + 1);
    const f = freeLots(s, parcels, parent);
    const left = platLots(s, parcels, parent).filter((b) => !s.homes?.units[b]).length;
    plats[parent] = { loc, commute, pace, disc: q.residual > 0 ? selloutDiscount(left, pace) : 0, left };
    void f;
  }
  const next: HomeMarket = { psf, fund, stamp: (prev?.stamp ?? 0) + 1, plats };
  e.homes = next;
  e.homesStamp = next.stamp;
}

/** The going quote on a plat this month: the standard house on its median lot. */
export function platQuoteNow(s: GameState, parent: string): (HomeQuote & { psfHere: number }) | null {
  const hm = s.econ.homes, pm = hm?.plats[parent];
  if (!hm || !pm) return null;
  const psfHere = hm.psf * pm.loc;
  return { ...homeQuote(s.econ, platLotSf(s, parent), psfHere, platFar(s, parent)), psfHere };
}

/**
 * WHAT A HOMEBUILDER WOULD BID for your lots here today, $/sf of lot.
 * Takedown: the residual itself — it pays as it takes, so it carries nothing.
 * Bulk: the residual discounted for the sell-out of all `n` lots at the pace
 * one builder sells at, at the land-development discount rate — what it costs
 * the builder to own the lots it has not yet built on.
 */
export function builderBids(s: GameState, parent: string, n: number): { takedownPsf: number; bulkPsf: number; pace: number; months: number } {
  const q = platQuoteNow(s, parent);
  const pm = s.econ.homes?.plats[parent];
  if (!q || !pm || !(q.residual > 0)) return { takedownPsf: 0, bulkPsf: 0, pace: pm?.pace ?? 0, months: Infinity };
  const sel = s.homes ? sellers(s.homes).size : 0;
  const pace = communityPace(s.econ, q.price / pm.loc, 0, sel + 1);
  return {
    takedownPsf: q.residualPsf,
    bulkPsf: q.residualPsf * selloutDiscount(n, pace),
    pace,
    months: pace > 0 ? n / pace : Infinity,
  };
}

// ---------------------------------------------------------------- your desk
export function acceptLotOffer(s: GameState, parcels: ParcelTable, parent: string): { s: GameState; err?: string; msg?: string } {
  const o = s.homes?.offers?.[parent];
  if (!o || s.month > o.expiresM) return { s, err: "That offer has lapsed." };
  if (s.homes?.contracts?.[parent] && o.kind !== "bulk") return { s, err: "A builder already has a takedown here." };
  if (freeLots(s, parcels, parent).mine.length <= (s.homes?.contracts?.[parent]?.left ?? 0)) return { s, err: "You have no free lots left on this plat to sell (a lot with a loan or a street listing is not free)." };
  const next = cloneState(s);
  const msg = signOffer(next, parcels, parent);
  return { s: next, msg };
}
/** Sign the standing offer on this plat, in place: a bulk sale closes now, a takedown is booked. */
function signOffer(s: GameState, parcels: ParcelTable, parent: string): string {
  const h = homesOf(s);
  const o = h.offers![parent];
  const free = freeLots(s, parcels, parent).mine.slice(h.contracts?.[parent]?.left ?? 0);
  const lots = Math.min(o.lots, free.length);
  delete h.offers![parent];
  if (h.listings?.[parent]) delete h.listings[parent];
  if (o.kind === "bulk") {
    let gross = 0;
    const b = (h.builders[o.builder] ??= newBuilder(s, o.builder));
    for (const bbl of free.slice(0, lots)) {
      const p = sellLot(s, parcels, parent, o.builder, o.psf, bbl);
      gross += p;
      (h.held ??= {})[bbl] = { by: o.builder, cost: p, loan: builderPays(s, b, p, LOT_ADVANCE) };
    }
    b.lots += lots; b.lotSpend += gross;
    refreshHomeMarket(s, parcels);
    sweepLocIdleCash(s);
    s.news.unshift({ q: s.month, kind: "deal", text: `Sold: ${lots} lots at ${parcels[parent]?.address ?? parent} to ${o.builder} for ${money(gross)}, $${o.psf.toFixed(2)}/sf of lot.` });
    return `Sold ${lots} lots.`;
  }
  (h.contracts ??= {})[parent] = { ...o, lots, left: lots, taken: 0 };
  s.news.unshift({ q: s.month, kind: "deal", text: `${o.builder} signed to take down ${lots} lots at ${parcels[parent]?.address ?? parent}, $${o.psf.toFixed(2)}/sf of lot, as it starts houses.` });
  return "Signed.";
}
export function declineLotOffer(s: GameState, parent: string): GameState {
  const next = cloneState(s);
  if (next.homes?.offers?.[parent]) delete next.homes.offers[parent];
  return next;
}

/**
 * LIST THE PLAT TO THE HOMEBUILDERS at an asking price a square foot of lot,
 * as a takedown (they buy as they build) or whole (they buy every free lot
 * now). Builders come looking more often; one that would pay the ask signs at
 * it, one that would not bids its own number, which you can take or leave.
 */
export function listLotsToBuilders(s: GameState, parcels: ParcelTable, parent: string, askPsf: number, bulk: boolean): { s: GameState; err?: string; msg?: string } {
  if (!s.plats?.[parent]?.done) return { s, err: "The streets are not in yet." };
  if (!(askPsf > 0) || !Number.isFinite(askPsf)) return { s, err: "Name a price." };
  if (!freeLots(s, parcels, parent).mine.length) return { s, err: "You have no free lots on this plat." };
  if (s.homes?.contracts?.[parent] && !bulk) return { s, err: "A builder already has a takedown here." };
  const next = cloneState(s);
  const h = homesOf(next);
  (h.listings ??= {})[parent] = { parent, askPsf: +askPsf.toFixed(2), bulk, listedM: next.month } as LotListing;
  return { s: next, msg: "Listed to the builders." };
}
export function delistLots(s: GameState, parent: string): GameState {
  const next = cloneState(s);
  if (next.homes?.listings?.[parent]) delete next.homes.listings[parent];
  return next;
}

/** One of your lots sold to a homebuilder at `psf`: a land sale, through the ledger. Returns the gross price. */
function sellLot(s: GameState, parcels: ParcelTable, parent: string, builder: string, psf: number, bbl: string): number {
  const h = s.holdings[bbl];
  const rec = resolveRec(parcels, s, bbl);
  if (!h || !rec) return 0;
  // a lot by a park fetches more of the builder's per-foot price (homeprice.ts lotPremiumMult)
  const hmk = s.econ.homes, pmk = hmk?.plats[parent];
  const mult = pmk && hmk ? lotPremiumMult(s.econ, rec.lotArea, hmk.psf * pmk.loc, platFar(s, parent), rec.homePrem ?? 0) : 1;
  const price = Math.round(psf * rec.lotArea * mult);
  const q = saleTaxQuote(h, price, s);
  s.cash += q.net;
  logBooks(s, "sold", q.net, bbl);
  if (q.tax > 0) { s.cash -= q.tax; s.taxesPaid = (s.taxesPaid ?? 0) + q.tax; logBooks(s, "taxes", q.tax); }
  // THE RELEASE. A lot under an A&D note closes only when the lender is paid its share (platdesign.ts):
  // out of the price, at the closing table, through the ledger as the payoff it is.
  if (h.loan?.ad && h.loan.balance > 0) {
    const due = Math.round(h.loan.balance);
    s.cash -= due;
    logBooks(s, "debtSvc", due, bbl);
    h.loan = null;
  }
  const pl = plOf(homesOf(s), parent);
  pl.lotsSold++; pl.lotRevenue += price; pl.lotProceeds += q.net; pl.lotBasis += h.costBasis;
  const ex: Exit = { bbl, address: rec.address, boughtM: h.boughtM, soldM: s.month, price, basis: h.costBasis, gain: q.gain };
  closeDeedLedger(s, ex);
  (s.exits ??= []).push(ex);
  if (s.exits.length > 200) s.exits.shift();
  recordComp(s, rec, price, builder, firmShort(s));
  (s.lastTradeM ??= {})[bbl] = s.month;
  delete s.holdings[bbl];
  return price;
}

// ---------------------------------------------------------------- the tick
function poisson(s: GameState, lambda: number): number {
  if (!(lambda > 0)) return 0;
  const L = Math.exp(-Math.min(lambda, 30));
  let k = 0, p = 1;
  do { k++; p *= rng(s, "homes"); } while (p > L && k < 60);
  return k - 1;
}

/**
 * WHAT A FAILED BUILDER'S BOOK FETCHES: its lots at today's bid and its
 * frames at the money in them, less a distress discount — bank REO lots and
 * unfinished houses cleared 20-30% under market in 2009-11, and the FDIC's
 * loss severity on failed banks' AD&C loans ran about 40-50% (FDIC loss-share
 * data) [S]; 25% here, on collateral already marked at the sell-out.
 */
const REO_DISCOUNT = 0.25;
function failBuilder(s: GameState, parcels: ParcelTable, b: HomeBuilder): void {
  const h = s.homes!;
  b.failedM = s.month;
  const mark = (bbl: string, parent: string) => {
    const q = platQuoteNow(s, parent), pm = s.econ.homes?.plats[parent];
    return q && pm ? Math.max(0, q.residualPsf * (parcels[bbl]?.lotArea ?? 0) * pm.disc) : 0;
  };
  const units = Object.values(h.units).filter((u) => u.by === b.name && u.closedM === undefined);
  const held = Object.entries(h.held ?? {}).filter(([, x]) => x.by === b.name);
  const worthOf = new Map<string, number>();
  for (const u of units) worthOf.set(u.bbl, (mark(u.bbl, u.parent) + u.spent) * (1 - REO_DISCOUNT));
  for (const [bbl] of held) {
    const parent = parcels[bbl]?.block ?? "";
    worthOf.set(bbl, mark(bbl, parent) * (1 - REO_DISCOUNT));
  }
  const price = Math.round([...worthOf.values()].reduce((t, v) => t + v, 0));
  // the desk is repaid from the sale and whatever cash is left; the rest is its loss
  const recovered = Math.min(b.debt, price + Math.max(0, b.cash));
  const loss = Math.max(0, Math.round(b.debt - recovered));
  if (b.lender && loss > 0) chargeLenderLoss(s, b.lender, loss);
  const owed = b.debt;
  b.debt = 0; b.cash = 0; b.stressMs = 0;
  // the contracts it had with you die with it
  for (const [p, c] of Object.entries(h.contracts ?? {})) if (c.builder === b.name) {
    delete h.contracts![p];
    s.news.unshift({ q: s.month, kind: "warn", text: `${b.name} has failed: its takedown of ${c.left} more of your lots at ${parcels[p]?.address ?? p} is void.` });
  }
  for (const [p, o] of Object.entries(h.offers ?? {})) if (o.builder === b.name) delete h.offers![p];
  // ANOTHER BUILDER BUYS THE BOOK from the desk, on its own money and loan
  let nb: HomeBuilder | undefined;
  if (worthOf.size && price > 0) {
    let k = 0, name = builderName(s, k);
    while (h.builders[name] && k < 40) name = builderName(s, ++k);
    nb = h.builders[name] = newBuilder(s, name);
    for (const u of units) {
      const paid = Math.round(worthOf.get(u.bbl) ?? 0);
      u.by = name;
      u.loan = builderPays(s, nb, paid, LOT_ADVANCE);
      // its cost: what it paid for the frame and lot, plus the draws still to come
      u.lotCost = paid - u.spent;
      nb.lots++; nb.lotSpend += paid; nb.started++;
    }
    for (const [bbl, x] of held) {
      const paid = Math.round(worthOf.get(bbl) ?? 0);
      x.by = name; x.cost = paid; x.loan = builderPays(s, nb, paid, LOT_ADVANCE);
      nb.lots++; nb.lotSpend += paid;
    }
  }
  s.news.unshift({
    q: s.month, kind: "warn",
    text: `${b.name}, homebuilder, has failed: ${money(owed)} owed${b.lender ? ` to ${b.lender}` : ""} against ${units.length} houses and ${held.length} lots`
      + (nb ? `, sold to ${nb.name} for ${money(price)}` : "") + (loss > 0 ? `; the desk takes a ${money(loss)} loss.` : "."),
  });
}

/** The month's homebuilding: the frames, the buyers, the closings, the builders' lots, and the market they all read. */
export function tickHomes(s: GameState, parcels: ParcelTable): void {
  if (s.citySize !== "region" && !s.plats) return;
  const e = s.econ;
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
  const h = s.homes!;
  const hm = e.homes!;

  // 0. THE BUILDERS' INTEREST, paid from their own money; a builder that
  // cannot pay its way for three months fails (step 5)
  for (const b of Object.values(h.builders)) {
    if (b.failedM !== undefined || !(b.debt > 0)) continue;
    const i = Math.round(b.debt * builderRate(s) / 12);
    b.cash -= i; b.interestPaid += i;
  }
  // 1. THE FRAMES GO UP, the desk advancing its share of each draw, and the finished ones stand
  for (const u of Object.values(h.units)) {
    if (u.spent < u.budget) {
      const b = h.builders[u.by];
      const draw = Math.min(u.budget - u.spent, Math.ceil(u.budget / BUILD_M));
      if (b && b.failedM === undefined) u.loan = (u.loan ?? 0) + builderPays(s, b, draw, HOUSE_ADVANCE);
      u.spent += draw;
    }
    if (u.builtM === undefined && u.spent >= u.budget && s.month >= u.doneM) finishUnit(s, parcels, u);
  }

  // 2. THE BUYERS. Each builder with a house to sell draws this month's buyers.
  const sel = sellers(h);
  const n = sel.size;
  for (const x of [...sel.values()].sort((a, b) => (a.parent + a.by).localeCompare(b.parent + b.by))) {
    const pm = hm.plats[x.parent];
    if (!pm) continue;
    const std = homeQuote(e, platLotSf(s, x.parent), hm.psf * pm.loc, platFar(s, x.parent));
    let k = poisson(s, communityPace(e, std.price / pm.loc, 0, n));
    for (const u of x.units.slice().sort((a, b) => a.doneM - b.doneM || a.bbl.localeCompare(b.bbl))) {
      if (k <= 0) break;
      u.soldM = s.month;
      u.price = Math.round(hm.psf * pm.loc * (1 + (parcels[u.bbl]?.homePrem ?? 0)) * u.sf);
      k--;
    }
  }

  // 3. CLOSINGS: a signed house closes the month it is finished.
  for (const u of Object.values(h.units)) {
    if (u.soldM === undefined || u.closedM !== undefined || s.month < u.doneM || u.spent < u.budget) continue;
    u.closedM = s.month;
    const b = h.builders[u.by];
    if (!b) continue;
    // the buyer's money: commission and marketing off the top, the desk's release, the rest the builder's
    const net = Math.round((u.price ?? 0) * (1 - NAHB.commission - NAHB.marketing));
    const release = Math.min(b.debt, u.loan ?? 0);
    b.debt -= release; b.cash += net - release; u.loan = 0;
    b.closed++; b.revenue += u.price ?? 0; b.cost += u.spent + u.lotCost;
  }
  // 5. A BUILDER THAT CANNOT PAY ITS WAY FAILS: three months short, and its
  // desk takes what it built and holds, sells it to another builder at a
  // distressed price, and charges what that leaves of the loan.
  for (const b of Object.values(h.builders)) {
    if (b.failedM !== undefined) continue;
    b.stressMs = b.cash < 0 ? (b.stressMs ?? 0) + 1 : 0;
    if ((b.stressMs ?? 0) >= 3) failBuilder(s, parcels, b);
  }

  // 4. THE BUILDERS: start houses on lots they hold or take down, and come looking for more.
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
    const f = freeLots(s, parcels, parent);
    const heldBy = (by: string) => f.held.filter((b) => h.held?.[b]?.by === by);
    const here = new Set(Object.values(h.units).filter((u) => u.parent === parent && u.closedM === undefined).map((u) => u.by));
    for (const b of f.held) here.add(h.held![b].by);
    if (contract) here.add(contract.builder);

    // A BUILDER COMES LOOKING where there are lots for sale and a residual
    // worth paying: for yours it makes an offer (takedown, or the whole plat
    // when you listed it whole), and on the market's it simply builds.
    const listing = h.listings?.[parent];
    // lots already promised on a takedown are the takedown builder's to take
    const spare = f.mine.slice(contract?.left ?? 0);
    // the town wants more houses than the communities selling can sell: room for another builder
    const crowded = salesPace(e, q.price / pm.loc, 0, Math.max(1, n)) > COMMUNITY_SALES_CAP;
    const canEnter = !here.size || crowded;
    const want = spare.length > 0 && !h.offers?.[parent];
    const entryP = listing ? LISTED_ENTRY_P : BUILDER_ENTRY_P;
    if (q.residual > 0 && ((want && (listing || canEnter)) || (canEnter && f.market.length)) && rng(s, "homes") < entryP) {
      let name: string;
      const existing = [...here].sort()[0];
      if (existing && !canEnter) name = existing;
      else {
        let k = 0; name = builderName(s, k);
        while ((h.builders[name] || here.has(name)) && k < 40) name = builderName(s, ++k);
        h.builders[name] = newBuilder(s, name);
      }
      if (!want) here.add(name);
      else {
        const bids = builderBids(s, parent, spare.length);
        // with a takedown already signed here, a second builder buys what is left outright
        const kind: LotOffer["kind"] = listing?.bulk || contract ? "bulk" : "takedown";
        const bid = kind === "bulk" ? bids.bulkPsf : bids.takedownPsf;
        const lots = kind === "bulk" ? spare.length : Math.min(spare.length, Math.max(4, Math.round(bids.pace * TAKEDOWN_MONTHS)));
        // it pays your ask if the ask is under what the lots are worth to it; otherwise it names its own number
        const psf = listing && listing.askPsf <= bid ? listing.askPsf : bid;
        // a builder bids for the whole plat only with the money to close it: its share, the desk the rest
        const whole = spare.slice(0, lots).reduce((t, b) => t + psf * (parcels[b]?.lotArea ?? 0), 0);
        if (kind === "bulk" && !canFund(s, h.builders[name], whole, 0)) continue;
        const offer: LotOffer = { parent, builder: name, kind, lots, psf: +psf.toFixed(2), madeM: s.month, expiresM: s.month + OFFER_LIFE_M };
        (h.offers ??= {})[parent] = offer;
        if (listing && listing.askPsf <= bid) {
          // at your ask: signed on your standing instruction
          signOffer(s, parcels, parent);
        } else {
          s.news.unshift({ q: s.month, kind: "deal", text: `${name} ${kind === "bulk" ? `bids for all ${lots}` : `offers to take down ${lots}`} of your lots at ${parcels[parent]?.address ?? parent}: $${psf.toFixed(2)}/sf of lot (${money(psf * platLotSf(s, parent))} a typical lot)${listing ? `, under your $${listing.askPsf.toFixed(2)} ask` : ""}. Open until ${monthLabel(s.month + OFFER_LIFE_M)}.` });
        }
      }
    }

    const cNow = h.contracts?.[parent];
    const f2 = freeLots(s, parcels, parent);
    for (const by of [...here].sort()) {
      const unsold = Object.values(h.units).filter((u) => u.parent === parent && u.by === by && u.soldM === undefined).length;
      const pace = communityPace(e, q.price / pm.loc, 0, Math.max(1, n));
      const starts = Math.min(Math.max(1, Math.ceil(pace * 1.5)), Math.ceil(pace * PIPELINE_MONTHS) - unsold);
      // a house is started only where it pays for its frame and the lot
      if (starts <= 0 || !(q.residual > 0)) continue;
      const own = heldBy(by).filter((b) => f2.held.includes(b));
      for (let i = 0; i < starts; i++) {
        let bbl: string | undefined, lotCost = 0, fromHeld = false, loan = 0;
        const b = (h.builders[by] ??= newBuilder(s, by));
        const lotNow = Math.round(q.residualPsf * platLotSf(s, parent));
        if (!canFund(s, b, own.length ? 0 : lotNow, q.vertical + q.overhead)) break;
        if (own.length) {
          fromHeld = true;
          bbl = own.shift()!;
          lotCost = h.held![bbl].cost;     // already in its book (lots, lotSpend) from the bulk purchase
          loan = h.held![bbl].loan ?? 0;
          delete h.held![bbl];
        } else if (cNow && cNow.builder === by && cNow.left > 0 && f2.mine.length) {
          bbl = f2.mine.shift()!;
          lotCost = sellLot(s, parcels, parent, by, cNow.psf, bbl);
          cNow.left--; cNow.taken++;
          if (!(lotCost > 0)) bbl = undefined;
          else loan = builderPays(s, b, lotCost, LOT_ADVANCE);
        } else if (f2.market.length) {
          bbl = f2.market.shift()!;
          lotCost = Math.round(q.residualPsf * (parcels[bbl]?.lotArea ?? 0) * pm.disc);
          loan = builderPays(s, b, lotCost, LOT_ADVANCE);
        }
        if (!bbl) break;
        const qq = homeQuote(e, parcels[bbl].lotArea, hm.psf * pm.loc, platFar(s, parent));
        startUnit(s, { bbl, parent, by, sf: qq.sf, startM: s.month, doneM: s.month + BUILD_M, budget: qq.vertical + qq.overhead, spent: 0, lotCost, loan });
        b.started++;
        if (!fromHeld) { b.lots++; b.lotSpend += lotCost; }
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
  lots: number; mine: number; free: number; houses: number; closed: number;
  builders: { name: string; building: number; closed: number; held: number; cash: number; debt: number; failed: boolean }[];
  bids: ReturnType<typeof builderBids>;
  pl: PlatPL | null;
  offer: LotOffer | null;
  contract: LotContract | null;
  listing: LotListing | null;
};
/** Everything the lots desk shows for one plat. */
export function platHomesView(s: GameState, parcels: ParcelTable, parent: string): PlatHomesView | null {
  const quote = platQuoteNow(s, parent);
  const hm = s.econ.homes, pm = hm?.plats[parent];
  if (!quote || !hm || !pm) return null;
  const all = platLots(s, parcels, parent);
  const h = s.homes;
  const units = Object.values(h?.units ?? {}).filter((u) => u.parent === parent);
  const f = freeLots(s, parcels, parent);
  const byB = new Map<string, PlatHomesView["builders"][number]>();
  const row = (by: string) => {
    const bk = h?.builders[by];
    const b = byB.get(by) ?? { name: by, building: 0, closed: 0, held: 0, cash: bk?.cash ?? 0, debt: bk?.debt ?? 0, failed: bk?.failedM !== undefined };
    byB.set(by, b); return b;
  };
  for (const u of units) { const b = row(u.by); if (u.closedM === undefined) b.building++; else b.closed++; }
  for (const bbl of f.held) row(h!.held![bbl].by).held++;
  return {
    quote, fund: hm.fund, psfTown: hm.psf, loc: pm.loc, commute: pm.commute,
    pace: pm.pace, disc: pm.disc, left: pm.left,
    lots: all.length,
    mine: all.filter((b) => s.holdings[b]).length,
    free: f.mine.length,
    houses: units.length,
    closed: units.filter((u) => u.closedM !== undefined).length,
    builders: [...byB.values()],
    bids: builderBids(s, parent, Math.max(1, f.mine.length)),
    pl: h?.pl?.[parent] ?? null,
    offer: h?.offers?.[parent] ?? null,
    contract: h?.contracts?.[parent] ?? null,
    listing: h?.listings?.[parent] ?? null,
  };
}

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
  const pace = communityPace(e, quote.price / loc, 0, n + 1);
  const disc = quote.residual > 0 ? selloutDiscount(lots, pace) : 0;
  return { quote, loc, commute, pace, disc, lotValue: Math.max(0, quote.residual) * disc };
}
export { homeSfFor };
export type { ParcelRecord };
