/**
 * THE TOWN'S FIRMS, AND WHERE THEY SIT (2026-10-16).
 *
 * Every standing commercial building the player does not own keeps a real rent
 * roll — named tenants with leases, covenants and the same hidden books the
 * player's tenants keep (tenantBooks.ts). Each tenant is a FIRM: it keeps its
 * id, name and books when it moves, and it is the unit the street's demand is
 * built from.
 *
 * Each month:
 *
 *   sync       buildings join and leave the street: a fresh delivery opens
 *              empty; a building the player sells carries its tenants over;
 *              one the player buys, or that comes down, leaves.
 *   firms      every firm's headcount follows its trade's payroll; its books
 *              run and it fails off them. The space it needs is its headcount
 *              times the space per head it chose at signing, times how today's
 *              rent compares (market.ts `demandAt` — the same rent response the
 *              city's demand equation carries).
 *   expiries   at the end of a lease a firm renews in place, resized to what
 *              it needs if the building has the room; or it goes looking —
 *              because it has outgrown the building, because it can now afford
 *              better (flight to quality), because it must cut its rent, or
 *              for the ordinary reasons a fraction of every roll moves — while
 *              it holds over; or, in a town with more firms than work, it
 *              leaves.
 *   formation  new firms form, and arrive from outside, at the pace the town's
 *              payrolls call for more space than its firms already hold
 *              (market.ts `demandAt.ref` — jobs, location, income and the
 *              town's long-run shifts) — and stop forming when they do not.
 *   search     every firm looking tours the empty suites in town — the street's
 *              and the player's (leasing.ts pulls its prospects from this same
 *              pool) — and signs where the building's quality is closest to
 *              what it shops for, the space is there, and the price is right.
 *              A firm that finds nothing in its patience leaves town.
 *
 * So the street's vacancy is no longer set by the city's aggregate and shared
 * out: it is what is left when every firm in town has done what it needs to.
 * The city's space market (market.ts) reads the result. Draws run on a private
 * stream, so the rest of the world's dice do not move with the street.
 */
import { renewalAsk } from "./citygov";
import type { ParcelTable, ParcelRecord } from "@/data/types";
import type { BuiltClass, Condition, Credit, GameState, Holding, Tenant } from "./types";
import { START_YEAR } from "./types";
import { resolveRec, useRentableSf, overallScore, initialCondIdx, useRentPsfYr, assetValue, useOccupancy, N_BANDS, scoreRentMult, locationRentMult } from "./value";
import { genRentRoll, isCommercial, bumpOf, minLettableSf, streetLease, pickSector, pickName, termBandM, depositFor } from "./leasing";
import { gradeOf, paramsOf } from "./rivals";
import { tickTenantFin, tenantFailOdds, entrantMargin } from "./tenantBooks";
import { rng, rrange, reletMonths, dealSlack, recordDeal, FIRM_PROFILE, turnoverYr } from "./market";
import { staleDiscount } from "./absorption";
import { tenantQualityTerms } from "./bands";
import { drawTenantSf, sizeScale } from "./plates";
import { noteTenantMove } from "./history";
import { INDUSTRY_IDS, N_IND, TRADE_TO_INDUSTRY, floorOf } from "./industries";
import { demandModel } from "./demand";
import { whyFirmDark } from "./economy";
import { why, whyTenantBooks } from "./why";
import { tenantFin } from "./tenantBooks";
import {
  type LandlordAsk, type Option, SHORTLIST, TASTE, askOf, postedEff, compsFace, reviewAsk, noteLetting, reservation, locCtx, posOf, hourCost,
  placeCost, worthOf, moveCostPsfYr, bargain, freeMonthsFor, gumbel, recordLease, movedLine, fmtPct, creditOfSize, readOut,
} from "./tenantMarket";

export interface StreetRoll {
  t: Tenant[];
  /** Month each use's empty space came on the market, if it has any. */
  vac?: Partial<Record<BuiltClass, number>>;
  /** Space handed back and being made ready — not yet showable. */
  ready?: { use: BuiltClass; sf: number; readyM: number }[];
  /** The landlord's asking rent and what it has learned, by use (tenantMarket.ts). */
  ask?: Partial<Record<Comm, LandlordAsk>>;
}

type Comm = "office" | "retail" | "industrial";
const COMM: Comm[] = ["office", "retail", "industrial"];

/** A firm looking for space. Housed movers stay in their roll (`from`) until they sign. */
export interface Seeker {
  fid: number;
  use: Comm;
  /** sf it wants */
  want: number;
  since: number;
  why: "new" | "grow" | "move" | "trade";
  /** the street building it holds over in while it looks */
  from?: string;
  /** an unhoused firm: the firm itself */
  t?: Tenant;
  /** the month a player's building last toured it — it is in talks there */
  tourM?: number;
  /** the player's building it left, if it came from one */
  fromPlayer?: string;
  /** what it paid and how far it sat from its partners and people where it was, for the line its move writes */
  was?: { rent: number; dLink: number; dWork: number };
  /** the cause-ledger event of its going to market */
  whyId?: number;
}

/** Months a looking firm takes to find and sign space, on average (market.ts MOVE_IN_M). */
const SEARCH_M: Record<Comm, number> = { office: 6, retail: 4, industrial: 3 };
/** How long a new or arriving firm keeps looking before it settles elsewhere. */
const PATIENCE_M: Record<Comm, number> = { office: 15, retail: 10, industrial: 9 };
/** Holdover: how long a firm whose lease has ended stays while it looks. */
const HOLDOVER_M = 6;
/** Share of expiring firms that close or leave town in a town with exactly the firms its payrolls support. */
/** Of the sheds' leases that end, the share whose tenants relocate within the region rather than renew. */
const SHED_MOVE = 0.3;
const EXIT_BASE: Record<Comm, number> = { office: 0.05, retail: 0.07, industrial: SHED_MOVE };
/** Months for the town's want of space to turn into firms looking for it (market.ts DEMAND_FORM_M). */
const FORM_M: Record<Comm, number> = { office: 9, retail: 6, industrial: 6 };
/** Score points between the space a firm shops for and a building, per e-fold of its interest. */
const FIT_W = 12;

/**
 * HOW MUCH OF A SHOP'S TRADE IS ITS WALKING CATCHMENT: half. A shop sells to
 * the people who work and live within a walk of it (demand.ts `blockFoot`, a
 * few hundred metres) and to everyone else who comes; convenience retail and
 * restaurants draw most of their sales from a primary trade area of a few
 * blocks to a mile, so a neighbourhood's share of a shop's sales is about
 * half [K, shape parameter: the ICSC / Huff trade-area convention that the
 * primary area is 50-70% of a centre's sales]. A shop's staff move with its
 * catchment's share of the town's people at this elasticity, on top of its
 * industry's employment — so a factory that closes takes trade from the shops
 * around it (step 2), and the town's spending as a whole stays the industry's.
 */
const CATCHMENT = 0.5;

/** A uniform [0,1) from a key — the same tenant in the same month always draws the same number. */
function hashU(seed: number, key: string): number {
  let h = 2166136261 ^ (seed >>> 0);
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

/**
 * WHICH WORK A NEW FIRM IS FORMED FOR (ONE ECONOMY step 2): an industry with
 * room on this floor, by the size of its gap, and a trade on the street that
 * does that work (industries.ts TRADE_TO_INDUSTRY, by US employment); any
 * office trade for a headquarters. With no gap anywhere (the opening's fill,
 * the region's shed movers), the trade the street would have drawn. Two draws
 * either way.
 */
function formFor(s: GameState, k: Comm, gap: Float64Array): { sector: Tenant["sector"]; ind?: number } {
  const u1 = rng(s, "leasing"), u2 = rng(s, "leasing");
  let tot = 0;
  for (let i = 0; i < N_IND; i++) tot += gap[i];
  if (!(tot > 0)) return { sector: pickSector(s, k) };
  let x = u1 * tot, ind = N_IND - 1;
  for (let i = 0; i < N_IND; i++) { x -= gap[i]; if (x < 0) { ind = i; break; } }
  const id = INDUSTRY_IDS[ind];
  const opts: [Tenant["sector"], number][] = [];
  for (const [sec, list] of Object.entries(TRADE_TO_INDUSTRY[k]) as [Tenant["sector"], readonly [string, number][]][]) {
    const tw = list.reduce((a, [, w]) => a + w, 0);
    for (const [j, w] of list) if (j === id) opts.push([sec, w / Math.max(1e-9, tw)]);
  }
  if (!opts.length) return { sector: pickSector(s, k), ind };
  const ot = opts.reduce((a, [, w]) => a + w, 0);
  let y = u2 * ot;
  for (const [sec, w] of opts) { y -= w; if (y < 0) return { sector: sec, ind }; }
  return { sector: opts[opts.length - 1][0], ind };
}

/** Run `fn` on a private "leasing" stream seeded from the key; the world's streams are restored after. */
function privately<T>(s: GameState, key: string, fn: () => T): T {
  const saved = s.rng;
  const savedStreams = s.streams ? { ...s.streams } : undefined;
  const seed = Math.max(1, Math.floor(hashU(s.seed, key) * 4294967295));
  s.rng = seed;
  if (s.streams) s.streams = { ...s.streams, leasing: seed };
  try { return fn(); } finally { s.rng = saved; if (savedStreams) s.streams = savedStreams; }
}

function eligible(s: GameState, parcels: ParcelTable, bbl: string) {
  if (s.holdings[bbl]) return null;
  const rec = resolveRec(parcels, s, bbl);
  if (!rec || rec.class === "land" || rec.class === "house" || !(rec.bldgArea > 0) || !isCommercial(rec)) return null;
  return rec;
}

const useOf = (t: Tenant) => (t.use ?? "office") as Comm;

/** The rent response now: how much of its reference space a firm takes at today's rent. */
function rawNow(s: GameState, k: Comm): number {
  const d = s.econ.demandAt?.[k];
  if (!d) return 1;
  // ...at the space per worker the town's long-run shifts set (remote work,
  // income, the island against the mainland), against the opening's.
  const lvl0 = d.lvl !== undefined ? ((s.econ.demandLvl0 ??= {})[k] ??= d.lvl) : 1;
  return Math.max(0.2, (d.raw ?? 1) * (d.lvl !== undefined ? d.lvl / Math.max(1e-6, lvl0) : 1));
}

/** Square feet a worker takes, by class (market.ts SF_PER_JOB). */
const SF_PER_JOB: Record<Comm, number> = { office: 230, retail: 420, industrial: 550 };

/** Give a tenant its firm identity if it has none (opening rolls, old saves, the player's tenants). */
function ensureFirm(s: GameState, t: Tenant) {
  const e = s.econ;
  if (t.fid === undefined) t.fid = (e.nextFid = (e.nextFid ?? 1) + 1);
  t.staffSign ??= t.staff ?? 1;
  t.hcRef ??= t.sf / rawNow(s, useOf(t));
}

/** The space this firm needs now: its headcount, at the space per head it chose, at today's rent. */
export function firmNeed(s: GameState, t: Tenant): number {
  ensureFirm(s, t);
  return (t.hcRef ?? t.sf) * (t.staff ?? 1) / Math.max(0.2, t.staffSign ?? 1) * rawNow(s, useOf(t));
}

/**
 * EACH FIRM'S INDUSTRY (ONE ECONOMY step 2): the one it was formed in, else
 * the one the city's books put it in (economy.ts `assign`). Read once a
 * month off the books' columns. Pure.
 */
function industryMap(s: GameState): Map<number, number> {
  const out = new Map<number, number>();
  const E = s.economy;
  if (!E?.f || !E.L?.slot) return out;
  const n = E.L.slot.n, id = E.f.id as unknown as ArrayLike<number>, ind = E.f.ind as unknown as ArrayLike<number>;
  for (let k = 0; k < n; k++) if (id[k] >= 0) out.set(id[k], ind[k]);
  return out;
}

/** Headcount in reference feet — what the firm counts for against the town's demand. */
function firmHc(t: Tenant): number {
  return (t.hcRef ?? t.sf) * (t.staff ?? 1) / Math.max(0.2, t.staffSign ?? 1);
}

/** Buildings join and leave the street. */
export function syncStreetRolls(s: GameState, parcels: ParcelTable, bbls: string[]) {
  const e = s.econ;
  const opening = !e.streetRolls;
  e.streetRolls ??= {};
  const year = START_YEAR + Math.floor(s.month / 12);
  for (const bbl of bbls) {
    const rec = eligible(s, parcels, bbl);
    const has = e.streetRolls[bbl];
    if (!rec) {
      if (has) {
        // Its firms are not demolished with it: the ones mid-lease go looking.
        for (const t of has.t) if (t.endM > s.month) toSeekers(s, t, "move", undefined);
        delete e.streetRolls[bbl];
      }
      continue;
    }
    if (has) continue;
    // A building the player has just sold keeps the tenants it had, books and all.
    const sold = e.heldTenants?.[bbl];
    if (sold) { e.streetRolls[bbl] = { t: structuredClone(sold).filter((t) => t.use !== "multifamily") }; continue; }
    // A delivery opens empty and leases up through the street's search below.
    if (!opening && year - (rec.yearBuilt || 1900) <= 1) { e.streetRolls[bbl] = { t: [] }; continue; }
    // Otherwise the standing roll: the same draw a listing of it would show.
    const cond: Condition = gradeOf(s, rec);
    const vessel = { bbl, boughtM: s.month, costBasis: 0, assessed: assetValue(rec, s.econ, cond), loan: null, condition: cond,
      condIdx: initialCondIdx(rec, s.month, cond), tenants: [], cfHistory: [] } as unknown as Holding;
    genRentRoll(s, rec, vessel, false, false);
    const t = vessel.tenants.filter((x) => x.use !== "multifamily");
    for (const x of t) x.quality ??= overallScore(rec, s.econ, useOf(x));
    e.streetRolls[bbl] = { t };
  }
  // A seeker holding over in a building that has left the street goes with it (it was looking anyway).
  if (e.seekers) e.seekers = e.seekers.filter((k) => !k.from || !!e.streetRolls![k.from]);
  syncFlats(s, parcels, bbls, opening);
  // What the player holds today, so a sale next month can carry it to the street.
  e.heldTenants = Object.fromEntries(Object.entries(s.holdings).map(([b, h]) => [b, h.tenants ?? []]));
  if (opening) growOpeningStreet(s, parcels);
}

/** Put a firm into the looking pool (unhoused). */
function toSeekers(s: GameState, t: Tenant, why: Seeker["why"], fromPlayer: string | undefined) {
  const e = s.econ;
  const use = useOf(t);
  if (!COMM.includes(use)) return;
  ensureFirm(s, t);
  const firm: Tenant = { ...structuredClone(t), freeUntilM: undefined, deposit: 0 };
  (e.seekers ??= []).push({ fid: t.fid!, use, want: Math.round(firmNeed(s, firm)), since: s.month, why, t: firm,
    ...(fromPlayer ? { fromPlayer, was: { rent: t.rentPsf, dLink: NaN, dWork: NaN } } : {}) });
}

interface Bld {
  bbl: string; rec: ParcelRecord; cond: Condition; condIdx: number; care: number; stressed: boolean;
  /** where it is (metres), and its market rent by use this month (the read-out, value.ts useRentPsfYr) */
  pos: [number, number] | null; mkt: Partial<Record<Comm, number>>;
  sc: Partial<Record<Comm, number>>; cap: Partial<Record<Comm, number>>;
  /** minLettableSf(rec, k), worked out once: the record is resolved once a month and never written. */
  min?: Partial<Record<Comm, number>>;
}
function minSfOf(b: Bld, k: Comm): number {
  const m = (b.min ??= {});
  let v = m[k];
  if (v === undefined) { v = minLettableSf(b.rec, k); m[k] = v; }
  return v;
}

/**
 * The town's firms live a month — see the head of this file. Run before the
 * city's space market (market.ts reads `streetSpace`).
 */
export function tickStreetRolls(s: GameState, parcels: ParcelTable) {
  const e = s.econ;
  if (!e.streetRolls) return;
  privately(s, `streetfirms|${s.month}`, () => tickFirms(s, parcels, growing));
}
/** True while the opening street is being grown (growOpeningStreet). */
let growing = false;

/**
 * THE STREET AS A FIRM SHOPPING IT SEES IT, this month: its buildings, what
 * each has free, what each landlord posts, and the broker's shortlist
 * (tenantMarket.ts). One view, read by the street's month (tickFirms) and by
 * the player's leasing desk, where a firm touring the player's floors weighs
 * them against the same street.
 */
function marketView(s: GameState, parcels: ParcelTable) {
  const e = s.econ;
  const R = e.streetRolls ?? {};
  const m = s.month;
  const owners = new Map<string, NonNullable<GameState["rivals"]>[number]>();
  for (const r of s.rivals ?? []) for (const b of r.bbls) owners.set(b, r);
  const blds = new Map<string, Bld>();
  const bld = (bbl: string): Bld | null => {
    let b = blds.get(bbl);
    if (b) return b;
    const rec = resolveRec(parcels, s, bbl);
    if (!rec) return null;
    const cond = gradeOf(s, rec);
    const condIdx = initialCondIdx(rec, m, cond);
    const owner = owners.get(bbl);
    const care = owner ? owner.leaseW ?? 0.85 + 0.3 * (paramsOf(owner).care.lease ?? 0.5) : 1;
    // AN OWNER UNDER PRESSURE: a firm under water, or a private holder whose
    // mortgage is behind (streetLoans.ts) — it needs the rent now.
    const loan = s.streetLoans?.[bbl];
    const stressed = !!owner?.stressMs || (!!loan && loan.status !== "current");
    b = { bbl, rec, cond, condIdx, care, stressed, sc: {}, cap: {}, pos: posOf(rec), mkt: {} };
    for (const k of COMM) {
      const c = useRentableSf(rec, k);
      if (c > 0) { b.cap[k] = c; b.sc[k] = overallScore(rec, e, k, condIdx); b.mkt[k] = useRentPsfYr(rec, e, cond, k, condIdx); }
    }
    blds.set(bbl, b);
    return b;
  };
  const letOf = (roll: StreetRoll, k: Comm) => roll.t.reduce((a, t) => a + (useOf(t) === k ? t.sf : 0), 0);
  const notReady = (roll: StreetRoll, k: Comm) => (roll.ready ?? []).reduce((a, r) => a + (r.use === k && r.readyM > m ? r.sf : 0), 0);
  const availOf = (b: Bld, roll: StreetRoll, k: Comm) => Math.max(0, (b.cap[k] ?? 0) - letOf(roll, k) - notReady(roll, k));
  // each street building's block and its catchment's share of the town's people now
  const foot = s.blockFoot, ofBbl = foot ? demandModel(parcels).ofBbl : undefined;
  let footTot = 0;
  if (foot) for (const v of Object.values(foot)) footTot += v;
  const catchOf = (bbl: string) => {
    const id = ofBbl?.get(bbl);
    const v = id !== undefined ? foot?.[id] : undefined;
    return v !== undefined && footTot > 0 ? v / footTot : undefined;
  };
  // ---- THE TENANT MARKET (tenantMarket.ts): a firm's shortlist, valued from its own books
  const recOf = (bbl: string) => resolveRec(parcels, s, bbl);
  const ctx = locCtx(s, recOf);
  // THE TRIPS A SHOP SELLS TO (ONE ECONOMY §6c-B, as far as location needs it):
  // the people working and living within a walk of each retail building this
  // month (demand.ts `blockFoot`) against the street's average shop — net of
  // what the address's rent already prices (value.ts locationRentMult, which
  // reads the slow neighbourhood score), so a shop weighs only the walk-ins
  // its address's rent does not already charge it for.
  let catchW = 0, catchV = 0, locV = 0;
  const locOf = new Map<string, number>();
  if (foot) for (const bbl of Object.keys(R)) {
    const c = catchOf(bbl);
    const b = bld(bbl);
    const cap = b?.cap.retail ?? 0;
    if (c === undefined || !(cap > 0) || !b) continue;
    const l = locationRentMult(b.rec, e, "retail");
    locOf.set(bbl, l);
    catchW += cap; catchV += cap * c; locV += cap * l;
  }
  const catchMean = catchW > 0 ? catchV / catchW : 0, locMean = catchW > 0 ? locV / catchW : 0;
  const footRel = (bbl: string) => {
    const c = catchOf(bbl), l = locOf.get(bbl);
    return c !== undefined && l !== undefined && catchMean > 0 && locMean > 0 && l > 0 ? (c / catchMean) / (l / locMean) : undefined;
  };
  const vacShare = (b: Bld, roll: StreetRoll, k: Comm) => Math.max(0, 1 - letOf(roll, k) / Math.max(1, b.cap[k] ?? 1));
  const bookOf = (b: Bld, roll: StreetRoll, k: Comm) => askOf((roll.ask ??= {}), k, e, b.mkt[k] ?? 0, vacShare(b, roll, k), m);
  // each trade's payroll, this month against last: the term a firm signs reads it (see THE TERM IS CHOSEN TOO)
  const gTradeOf = (sec: string) => {
    const bk = e.firmBooks?.[sec as Tenant["sector"]], prevE = e.tradeEmpPrev?.[sec];
    return bk && prevE ? Math.pow(bk.emp / Math.max(1e-6, prevE), 12) - 1 : 0;
  };
  const termOf = (firm: Tenant) => {
    const band = termBandM(firm.credit);
    return (band.loM + band.hiM) / 2 * Math.max(0.6, Math.min(1.4, Math.exp(-4 * gTradeOf(firm.sector))));
  };
  /**
   * What `firm` would make of `take` feet of `k` in this building: what it is
   * worth to the firm, what the landlord will take, the move, its taste.
   */
  const value = (firm: Tenant, k: Comm, b: Bld, roll: StreetRoll, take: number, termM: number, stay: boolean, moving: boolean): Option => {
    const mkt = b.mkt[k] ?? 0;
    const L = bookOf(b, roll, k);
    const post = postedEff(L, e, k, mkt, stay);
    const res = reservation(L, k, post, termM, stay, b.stressed);
    const pc = placeCost(firm.fid !== undefined ? ctx.pts.get(firm.fid) : undefined, b.pos, hourCost(firm));
    const worth = worthOf(firm, k, mkt, b.sc[k] ?? 50, take, pc.cost, k === "retail" ? footRel(b.bbl) : undefined);
    const move = !stay && moving ? moveCostPsfYr(e, k, termM) : 0;
    const joint = worth - post - move + TASTE[k] * mkt * gumbel(rng(s, "leasing"));
    // a sitting tenant is offered the face no higher than the comps (a renewal at market)
    const ask = stay ? Math.min(L.a, compsFace(e, mkt, k)) : L.a;
    return { bbl: b.bbl, take, mkt, ask, post, res, worth, move, joint, dLink: pc.dLink, dWork: pc.dWork, ...(stay ? { stay: true } : {}) };
  };
  // The street's buildings, listed once: the search lets space and moves
  // tenants inside rolls, and never adds, removes or replaces a roll.
  const rollList = Object.entries(R);
  // Each roll's empty space by use, remembered while its tenant list and its
  // make-ready list are the arrays they were at the same lengths: in this
  // month a roll changes only by a lease pushed on, a tenant filtered off
  // (a new array) or a suite put to make-ready (pushed), or a tenant's feet
  // changed at a renewal (which `noteRoll` forgets), never otherwise in place.
  type AvailMemo = { t: Tenant[]; tl: number; r: StreetRoll["ready"]; rl: number; v: Partial<Record<Comm, number>> };
  const availMemo = new Map<StreetRoll, AvailMemo>();
  const availIn = (b: Bld, roll: StreetRoll, k: Comm) => {
    const rl = roll.ready ? roll.ready.length : -1;
    let am = availMemo.get(roll);
    if (!am || am.t !== roll.t || am.tl !== roll.t.length || am.r !== roll.ready || am.rl !== rl) {
      am = { t: roll.t, tl: roll.t.length, r: roll.ready, rl, v: {} };
      availMemo.set(roll, am);
    }
    let v = am.v[k];
    if (v === undefined) { v = availOf(b, roll, k); am.v[k] = v; }
    return v;
  };
  const noteRoll = (roll: StreetRoll) => availMemo.delete(roll);
  /**
   * THE BROKER'S SHORTLIST: up to SHORTLIST street buildings with room for
   * the firm, drawn by how close each is to the quality it shops for, how much
   * room it has, how keen its posted rent is against the market for it (a
   * broker shows what is priced to let — the cube is the old stale-space
   * weight's, `staleDiscount`^-3, now read off the landlord's actual post), how
   * hard its owner lets and how dark its lobby is; each valued, with the
   * firm's own suite (when it has one to renew) beside them. Best first.
   */
  const shop = (firm: Tenant, k: Comm, want: number, from: string | undefined, stay: Option | null, moving: boolean): Option[] => {
    const q = firm.quality ?? 50;
    const termM = termOf(firm);
    const cands: { b: Bld; roll: StreetRoll; avail: number; w: number }[] = [];
    let tot = 0;
    for (const [bbl, roll] of rollList) {
      if (bbl === from) continue;
      const b = blds.get(bbl) ?? bld(bbl);
      if (!b || !b.cap[k]) continue;
      const avail = availIn(b, roll, k);
      const floor = minSfOf(b, k);
      if (avail < Math.max(floor, Math.min(want * 0.5, avail + 1))) continue;
      const letShare = 1 - avail / (b.cap[k] ?? 1);
      const mkt = b.mkt[k] ?? 0;
      const keen = mkt > 0 ? Math.min(4, Math.pow(mkt / Math.max(0.01, postedEff(bookOf(b, roll, k), e, k, mkt, false)), 3)) : 1;
      const w = Math.sqrt(avail) * Math.exp(-Math.abs((b.sc[k] ?? 50) - q) / FIT_W) * keen * b.care * (0.85 + 0.15 * letShare);
      if (!(w > 0)) continue;
      cands.push({ b, roll, avail, w }); tot += w;
    }
    const out: Option[] = stay ? [stay] : [];
    for (let n = 0; n < SHORTLIST && tot > 1e-12 && cands.length; n++) {
      let u = rng(s, "leasing") * tot, at = cands.length - 1;
      for (let i = 0; i < cands.length; i++) { u -= cands[i].w; if (u <= 0) { at = i; break; } }
      const c = cands[at];
      tot -= c.w; cands[at] = cands[cands.length - 1]; cands.pop();
      const floor = minSfOf(c.b, k);
      let take = Math.min(want, c.avail);
      if (c.avail - take < floor) take = c.avail <= want * 1.4 ? c.avail : Math.max(floor, c.avail - floor);
      if (take < floor) continue;
      out.push(value(firm, k, c.b, c.roll, take, termM, false, moving));
    }
    out.sort((a, b) => b.joint - a.joint);
    return out;
  };
  return { R, m, owners, blds, bld, letOf, notReady, availOf, catchOf, foot, ctx, recOf, footRel, vacShare, bookOf, gTradeOf, termOf, value, shop, availIn, noteRoll, rollList };
}
/** The street as the player's leasing desk's prospects see it this month (one view a month). */
const DESK_VIEW = new WeakMap<GameState, { m: number; v: ReturnType<typeof marketView> }>();
function deskView(s: GameState, parcels: ParcelTable) {
  const hit = DESK_VIEW.get(s);
  if (hit && hit.m === s.month) return hit.v;
  const v = marketView(s, parcels);
  DESK_VIEW.set(s, { m: s.month, v });
  return v;
}

/**
 * WHAT A FIRM TOURING ONE OF THE PLAYER'S FLOORS OFFERS (ONE ECONOMY step 4).
 * The firm weighs the player's space against its broker's shortlist on the
 * street — what each is worth to it (tenantMarket.ts worthOf: the market rent
 * for the address, its fit with the quality the firm shops for, its distance
 * from the firm's partners and people, a shop's walk-ins) and what each
 * landlord posts. It offers the player's posted rent when the player's space
 * is the better deal, and otherwise the most it can pay and still do as well
 * as on the street — where the runner-up's landlord would go to its own
 * reservation. A firm with nowhere else to go offers the posted rent.
 *
 * `postEff` is what the player posts, effective (face less the market's
 * package); returns the offer over it (at most 1), and the street building it
 * was weighed against. This replaced a coin flip: three letters in ten offered
 * 68-86% of the ask and the rest 90-110%, whoever the tenant was.
 */
export function offerForPlayer(s: GameState, parcels: ParcelTable, firm: Tenant, use: BuiltClass, sf: number, rec: ParcelRecord, score: number, mktHere: number, postEff: number, termM: number, sitting = false): { bid: number; alt?: string } {
  if (!COMM.includes(use as Comm) || !(postEff > 0) || !(mktHere > 0)) return { bid: 1 };
  const k = use as Comm;
  const V = deskView(s, parcels);
  const from = firm.fid !== undefined ? s.econ.seekers?.find((x) => x.fid === firm.fid)?.from : undefined;
  const opts = V.shop(firm, k, sf, from, null, true);
  const c = opts[0];
  if (!c) return { bid: 1 };
  const pc = placeCost(firm.fid !== undefined ? V.ctx.pts.get(firm.fid) : undefined, posOf(rec), hourCost(firm));
  const worth = worthOf(firm, k, mktHere, score, sf, pc.cost, k === "retail" ? V.footRel(rec.bbl) : undefined);
  const taste = TASTE[k] * mktHere * gumbel(rng(s, "leasing"));
  // a sitting tenant renewing does not move; every street option costs it the move
  const rMax = worth - (sitting ? 0 : moveCostPsfYr(s.econ, k, termM)) + taste - c.joint - (c.post - c.res);
  return { bid: Math.max(0.4, Math.min(1, rMax / postEff)), alt: c.bbl };
}

function tickFirms(s: GameState, parcels: ParcelTable, opening: boolean) {
  const e = s.econ;
  const R = e.streetRolls!;
  const m = s.month;
  e.seekers ??= [];
  const V = marketView(s, parcels);
  const { owners, blds, bld, letOf, availOf, catchOf, ctx, recOf, bookOf, gTradeOf, termOf, value, shop, noteRoll, vacShare } = V;
  const seeking = new Map<number, Seeker>();
  for (const k of e.seekers) seeking.set(k.fid, k);
  const ratio = (k: Comm) => e.streetSpace?.[k] && (e.streetSpace[k] as { ratio?: number }).ratio || 1;
  const handed: Record<string, number> = { office: 0, retail: 0, industrial: 0 };
  const vacate = (roll: StreetRoll, t: Tenant) => {
    const k = useOf(t);
    handed[k] = (handed[k] ?? 0) + t.sf;
    (roll.ready ??= []).push({ use: k, sf: t.sf, readyM: m + Math.max(1, Math.round(reletMonths(k) * 0.5)) });
  };

  // Headcount that closed or left town this month, by class — what new firms replace.
  const lost: Record<string, number> = { office: 0, retail: 0, industrial: 0 };
  const eco = e.eco, indOf = industryMap(s);
  const dzAcc: Record<string, [number, number]> = {};

  /** What the firm would renew for in its own building: what it needs, if the building has the room. */
  const renewTake = (b: Bld, roll: StreetRoll, t: Tenant, need: number) => {
    const k = useOf(t) as Comm;
    if (need < t.sf) return Math.round(Math.max(Math.min(t.sf, minSfOf(b, k)), need));
    return Math.round(t.sf + Math.min(need - t.sf, Math.max(0, (b.cap[k] ?? 0) - letOf(roll, k))));
  };
  /**
   * A FIRM SIGNS where its shortlist says it is best off, at the rent it
   * bargained (`bargain`: the landlord has to beat the runner-up): the
   * landlord's asking rent on the face, the rest as free months. Writes the
   * comp, teaches the landlord, and — for a firm that moved — the line that
   * says why. Returns the lease.
   */
  const signAt = (firm: Tenant, k: Comm, pick: Option, second: Option | undefined, want: number, fromBbl: string | undefined, fromPlayer: string | undefined, was: Seeker["was"], cause?: number): Tenant | null => {
    const b = blds.get(pick.bbl) ?? bld(pick.bbl);
    const roll = R[pick.bbl];
    if (!b || !roll) return null;
    const sc = b.sc[k] ?? 50;
    const qt = tenantQualityTerms(firm.quality ?? sc, sc);
    const band = termBandM(firm.credit);
    // THE TERM IS CHOSEN TOO (2026-10-16): within its covenant's band, a firm
    // in a trade that is growing fast signs shorter — it expects to outgrow
    // the suite, and a short lease is the option to move — and one in a
    // shrinking trade signs longer at today's rent (Grenadier 1995 on the
    // option value in lease term; the covenant bands stay, since they are
    // what landlords and their lenders will take from each grade).
    const termM = rrange(s, band.loM, band.hiM, "leasing") * qt.term * Math.max(0.6, Math.min(1.4, Math.exp(-4 * gTradeOf(firm.sector))));
    const eff = bargain(pick, second);
    const face = pick.ask;
    const freeM = freeMonthsFor(face, eff, termM);
    const carry: Partial<Tenant> = {
      fid: firm.fid, quality: firm.quality, staff: firm.staff, empRef: firm.empRef, fin: firm.fin,
      ...(firm.ind !== undefined ? { ind: firm.ind } : {}), ...(firm.empInd !== undefined ? { empInd: firm.empInd } : {}),
    };
    const lease = streetLease(s, b.rec, b.cond, b.condIdx, k, pick.take, { name: firm.name, sector: firm.sector, credit: firm.credit, ...carry },
      face / Math.max(0.01, pick.mkt), termM, freeM);
    // Signed for the people it has now, at today's rent.
    lease.staffSign = firm.staff ?? 1;
    lease.hcRef = want / rawNow(s, k);
    roll.t.push(lease);
    noteRoll(roll);
    const effSigned = face * (1 - freeM / Math.max(1, termM));
    recordLease(e, k, m, face, effSigned, pick.mkt, pick.take, Math.max(0, Math.min(N_BANDS - 1, Math.floor(sc / 10))), scoreRentMult(e, k, sc));
    const since = roll.vac?.[k];
    const full = availOf(b, roll, k) < minSfOf(b, k);
    noteLetting(bookOf(b, roll, k), since === undefined ? 0 : Math.max(0, m - since), full, opening);
    if (full) { roll.vac ??= {}; delete roll.vac[k]; }
    // WHY IT MOVED: where it went, what it pays against what it paid, and how much nearer its partners and people it is.
    if ((fromBbl || fromPlayer) && !opening) {
      const oldRec = recOf((fromBbl ?? fromPlayer)!);
      const old = placeCost(firm.fid !== undefined ? ctx.pts.get(firm.fid) : undefined, oldRec ? posOf(oldRec) : null, 1);
      const rentCh = was?.rent ? effSigned / was.rent - 1 : NaN;
      const grew = pick.take > firm.sf * 1.2 ? ` · ${(firm.sf / 1000).toFixed(1)}k → ${(pick.take / 1000).toFixed(1)}k sf` : "";
      const line = movedLine(b.rec.address, rentCh, old.dLink, pick.dLink, old.dWork, pick.dWork) + grew;
      const whyId = why(s, {
        k: "tenant.moved", a: "tenant", aid: firm.fid !== undefined ? String(firm.fid) : undefined, name: firm.name, bbl: fromBbl ?? fromPlayer,
        n: { sf: pick.take, rentPsf: +effSigned.toFixed(2), ...(Number.isFinite(rentCh) ? { rentCh: +rentCh.toFixed(3) } : {}),
          ...(Number.isFinite(old.dLink - pick.dLink) ? { closerM: Math.round(old.dLink - pick.dLink) } : {}) },
        t: `${firm.name} ${line}`,
      }, [cause]);
      if (fromBbl) {
        (e.streetFailed ??= []).push({ m, bbl: fromBbl, name: firm.name, sf: firm.sf, use: k, why: "left", to: b.rec.address, whyId });
        if (firm.sf >= 8000) noteTenantMove(s, { kind: "leave", who: firm.name, sf: firm.sf, bbl: fromBbl, to: b.rec.address });
      } else if (fromPlayer) {
        // One of the player's old tenants has landed — and where is news.
        if (pick.take >= 8000) noteTenantMove(s, { kind: "leave", who: firm.name, sf: pick.take, bbl: fromPlayer, to: b.rec.address });
        const owner = owners.get(b.bbl);
        s.news.unshift({ q: m, kind: "info", why: whyId,
          text: `${firm.name}, who left your building at ${oldRec?.address ?? "one of your buildings"}, has signed for ${(pick.take / 1000).toFixed(1)}k sf at ${b.rec.address}${owner ? ` — ${owner.name}'s building` : ""} · rent ${Number.isFinite(rentCh) ? fmtPct(rentCh) : "—"} against what it paid you.` });
      }
    }
    return lease;
  };
  // ---- 1. the firms in the street's buildings: books, failures, expiries
  for (const [bbl, roll] of Object.entries(R)) {
    const b = bld(bbl);
    if (!b) continue;
    if (roll.ready) { roll.ready = roll.ready.filter((r) => r.readyM > m); if (!roll.ready.length) delete roll.ready; }
    const keep: Tenant[] = [];
    for (const t of roll.t) {
      const k = useOf(t);
      ensureFirm(s, t);
      // HEADCOUNT IS THE FIRM'S OWN DECISION: half of its trade's swing in
      // demand (new entrants carry the other half — see formation below),
      // and its own run of sales against its trade's (luck is relative: what
      // one firm wins from its rivals another loses, so the firm-specific part
      // nets out across the trade — survivors growing must not add jobs the
      // trade does not have).
      // ...ITS INDUSTRY'S, NOT ITS TRADE'S (2026-10-28, ONE ECONOMY step 2):
      // the employment the city's books say its industry staffs to (economy.ts
      // `staff`), month on month; a firm the books have not met yet keeps its
      // staff for the month.
      const ind = t.ind ?? indOf.get(t.fid!);
      const iEmp = ind !== undefined ? eco?.emp?.[ind] : undefined;
      const known = iEmp !== undefined && iEmp > 0;
      const emp = known ? iEmp : 1;
      const prev = known ? (t.empInd ?? emp) : 1;
      if (known) t.empInd = emp;
      // a shop: and its walking catchment's share of the town's people
      let catchR = 1;
      if (k === "retail") {
        const c = catchOf(bbl);
        if (c !== undefined && c > 0) { if (t.catch !== undefined && t.catch > 0) catchR = Math.pow(c / t.catch, CATCHMENT); t.catch = c; }
      }
      const zNow = t.fin?.z ?? 0;
      const dz = zNow - ((t as Tenant & { zSeen?: number }).zSeen ?? zNow);
      (t as Tenant & { zSeen?: number }).zSeen = zNow;
      const za = (dzAcc[t.sector] ??= [0, 0]), hw = firmHc(t);
      za[0] += hw * dz; za[1] += hw;
      // ...AND WHERE THE ISLAND HOLDS MORE OF ITS INDUSTRY THAN THE
      // INDUSTRY'S WORK SUPPORTS (step 2: its share of the industry's
      // employment at the opening, `islandFill` last month), its firms shed
      // the excess at the pace new firms fill a shortfall (FORM_M). Half of a
      // swing is the sitting firms', half new firms' or closures', in both
      // directions; without this a shrinking industry's sitting firms kept
      // staff its sales no longer paid for, since no entrant was there to
      // take the other half. (A first cut took the whole fall on the sitting
      // firms and a square root of the rise, which ratcheted every firm down
      // in an industry whose employment merely wobbled: measured, a tech
      // tenant's sales -58% since signing with its industry -1% on its year.)
      const r = emp / Math.max(1e-6, prev);
      const over = ind !== undefined ? Math.max(1, e.islandFill?.[ind] ?? 1) : 1;
      const shed = over > 1 && COMM.includes(k) ? Math.pow(over, -1 / FORM_M[k as Comm]) : 1;
      t.staff = Math.max(0.05, Math.min(60, (t.staff ?? 1) * Math.sqrt(r) * shed * catchR * Math.exp(0.7 * (dz - (e.dzBar?.[t.sector] ?? 0)))));
      // The contractual bump on each anniversary.
      const age = m - t.startM;
      if (age > 0 && age % 12 === 0) t.rentPsf = +(t.rentPsf * (1 + bumpOf(t) / 100)).toFixed(2);
      const f = tickTenantFin(e, t, m < (t.freeUntilM ?? -1) ? 0 : t.rentPsf * t.sf, e.creditIdx ?? 1);
      if (rng(s, "leasing") < tenantFailOdds(f, t.credit)) {
        if (k in lost) lost[k] += firmHc(t);
        // WHY (why.ts): a firm the size of an anchor (rivals.ts reads them) writes what failed it
        const whyId = t.sf >= 8000 ? whyFirmDark(s, t, f, bbl) : undefined;
        (e.streetFailed ??= []).push({ m, bbl, name: t.name, fid: t.fid, sf: t.sf, use: k, why: "dark", credit: t.credit, ...(whyId ? { whyId } : {}) });
        (e.failedSf ??= { office: 0, retail: 0, multifamily: 0, industrial: 0 })[k] += t.sf;
        seeking.delete(t.fid!);
        vacate(roll, t);
        continue;                                   // went dark: the suite is empty
      }
      if (!COMM.includes(k)) { keep.push(t); continue; }
      const need = firmNeed(s, t);
      const mine = seeking.get(t.fid!);
      if (mine) {
        // Holding over while it looks. When the holdover runs out it takes the
        // best it has been shown — its own suite included, on a fresh lease
        // sized to what the building can give it.
        mine.want = Math.round(need);
        if (t.endM <= m) {
          seeking.delete(t.fid!);
          const kk = k as Comm;
          const room = availOf(b, roll, kk);
          const outgrown = need > t.sf * 1.25 && room < need - t.sf;
          const stayOpt = outgrown ? null : value(t, kk, b, roll, renewTake(b, roll, t, need), termOf(t), true, true);
          const opts = shop(t, kk, Math.round(need), bbl, stayOpt, true);
          const best = opts[0];
          if (best && !best.stay) {
            const lease = signAt(t, kk, best, opts[1], Math.round(need), bbl, undefined, mine.was, mine.whyId);
            if (lease) { vacate(roll, t); continue; }
          }
          renewInPlace(s, b, roll, t, need, stayOpt ? { face: stayOpt.ask, eff: bargain(stayOpt, opts.find((o) => !o.stay)) } : undefined, bookOf(b, roll, kk));
          noteRoll(roll);
        }
        keep.push(t);
        continue;
      }
      if (t.endM <= m) {
        // Closes or leaves town — more of them when the town has more firms than its payrolls support.
        const exitP = Math.min(0.5, EXIT_BASE[k] * Math.pow(Math.max(0.5, Math.min(2, ratio(k))), 4));
        if (rng(s, "leasing") < exitP) {
          lost[k] += firmHc(t);
          // WHY: a firm of size that left town writes its books as they stood
          const whyId = t.sf >= 5000 && !opening ? why(s, {
            k: "tenant.leftTown", a: "tenant", aid: String(t.fid), name: t.name, bbl,
            n: { sf: t.sf, rentYr: Math.round(t.rentPsf * t.sf), firmsPerWork: +ratio(k).toFixed(2) },
            t: `${t.name} left town at lease end · ${(t.sf / 1000).toFixed(1)}k sf · its trade has ${Math.round((ratio(k) - 1) * 100)}% more firms here than work`,
          }, [whyTenantBooks(s, t, f)]) : undefined;
          (e.streetFailed ??= []).push({ m, bbl, name: t.name, fid: t.fid, sf: t.sf, use: k, why: "left", ...(whyId ? { whyId } : {}) });
          vacate(roll, t);
          continue;
        }
        // THE FIRM SHOPS ITS RENEWAL (tenantMarket.ts): its own suite, at
        // what its landlord will take from a sitting tenant, against the
        // broker's shortlist, net of what moving costs. It renews in place
        // when that is best and goes to market when it is not — or when it has
        // outgrown a building with no room to give it.
        const kk = k as Comm;
        const room = availOf(b, roll, kk);
        const outgrown = need > t.sf * 1.25 && room < need - t.sf;
        const stayOpt = outgrown ? null : value(t, kk, b, roll, renewTake(b, roll, t, need), termOf(t), true, true);
        const opts = shop(t, kk, Math.round(need), bbl, stayOpt, true);
        const best = opts[0];
        if (outgrown || (best && !best.stay)) {
          const sk: Seeker = { fid: t.fid!, use: kk, want: Math.round(need), since: m, why: outgrown ? "grow" : "move", from: bbl,
            was: { rent: t.rentPsf, dLink: stayOpt?.dLink ?? NaN, dWork: stayOpt?.dWork ?? NaN } };
          e.seekers.push(sk);
          seeking.set(t.fid!, sk);
          t.endM = m + HOLDOVER_M;
        } else {
          renewInPlace(s, b, roll, t, need, stayOpt ? { face: stayOpt.ask, eff: bargain(stayOpt, opts.find((o) => !o.stay)) } : undefined, bookOf(b, roll, kk));
          noteRoll(roll);
          // A SITTING TENANT WITH NOWHERE ELSE TO GO is the landlord's read of
          // a tight market: its broker could show it nothing. The landlord
          // learns what a letting at once teaches — the package back, then
          // the face up (tenantMarket.ts noteLetting) — when it has nothing else
          // of the kind to let.
          if (!opts.some((o) => !o.stay) && availOf(b, roll, kk) < minSfOf(b, kk)) noteLetting(bookOf(b, roll, kk), 0, true, opening);
        }
      } else if (need > t.sf * 1.5 && rng(s, "leasing") < 0.03) {
        // Outgrown mid-lease: next door if the building has it, else go looking.
        const room = availOf(b, roll, k);
        if (room >= need - t.sf) t.sf = Math.round(need);
        else {
          e.seekers.push({ fid: t.fid!, use: k, want: Math.round(need), since: m, why: "grow", from: bbl });
          seeking.set(t.fid!, e.seekers[e.seekers.length - 1]);
        }
      }
      keep.push(t);
    }
    roll.t = keep;
  }
  // Seekers whose firm is gone; new firms that ran out of patience (they settle elsewhere).
  // A firm that had been trading here and gave up looking has left town, and
  // a new one replaces it like any other exit. A START-UP that never found a
  // floor never traded here: replacing it as a closure kept the queue of
  // the unhoused topped up for ever — measured, 400k sf of searchers beside
  // 360k sf of empty shops, read as a shortage, rents up 70% at 25% vacancy.
  for (const k of e.seekers) if (k.t && !k.from && k.why !== "new" && m - k.since > PATIENCE_M[k.use]) lost[k.use] += firmHc(k.t);
  e.seekers = e.seekers.filter((k) => seeking.get(k.fid) === k
    && (k.from ? !!R[k.from]?.t.some((t) => t.fid === k.fid) : !!k.t)
    && (k.from || m - k.since <= PATIENCE_M[k.use]));
  for (const k of e.seekers) if (k.t) k.want = Math.round(firmNeed(s, k.t));

  // ---- 2. space and headcount by class, and the firms that form
  const space: NonNullable<GameState["econ"]["streetSpace"]> = {};
  const scores: Record<Comm, { sc: number; cap: number }[]> = { office: [], retail: [], industrial: [] };
  for (const k of COMM) space[k] = { let: 0, cap: 0, seek: 0, byBand: { stock: new Array(N_BANDS).fill(0), occ: new Array(N_BANDS).fill(0) } };
  const hc: Record<Comm, number> = { office: 0, retail: 0, industrial: 0 };
  for (const [bbl, roll] of Object.entries(R)) {
    const b = bld(bbl);
    if (!b) continue;
    for (const k of COMM) {
      const c = b.cap[k];
      if (!c) continue;
      const l = letOf(roll, k);
      const band = Math.max(0, Math.min(N_BANDS - 1, Math.floor((b.sc[k] ?? 50) / 10)));
      const sp = space[k]!;
      sp.cap += c; sp.let += l;
      sp.byBand!.stock[band] += c; sp.byBand!.occ[band] += Math.min(c, l);
      scores[k].push({ sc: b.sc[k] ?? 50, cap: c });
    }
    for (const t of roll.t) { const k = useOf(t); if (k in hc) hc[k] += firmHc(t); }
  }
  for (const h of Object.values(s.holdings)) for (const t of h.tenants ?? []) {
    const k = useOf(t);
    if (!(k in hc)) continue;
    ensureFirm(s, t);
    hc[k] += firmHc(t);
  }
  for (const sk of e.seekers) if (sk.t) { hc[sk.use] += firmHc(sk.t); space[sk.use]!.seek += sk.want; }
  e.dzBar = Object.fromEntries(Object.entries(dzAcc).map(([sec, [a, w]]) => [sec, w > 0 ? a / w : 0]));
  // each trade's payroll this month against last (its industries', economy.ts): the term a signing firm chooses reads it
  const tradeR: Record<string, number> = {};
  for (const [sec, b] of Object.entries(e.firmBooks ?? {})) tradeR[sec] = b.emp / Math.max(1e-6, e.tradeEmpPrev?.[sec] ?? b.emp);
  e.tradeEmpPrev = Object.fromEntries(Object.entries(e.firmBooks ?? {}).map(([sec, b]) => [sec, b.emp]));
  const secW: Partial<Record<Comm, Partial<Record<string, number>>>> = {};
  // THE ISLAND'S FIRMS BY INDUSTRY AND FLOOR, in heads (ONE ECONOMY step 2):
  // what new firms are formed against.
  const named: Record<Comm, Float64Array> = { office: new Float64Array(N_IND), retail: new Float64Array(N_IND), industrial: new Float64Array(N_IND) };
  // What space costs the town's firms against what space and staff cost them
  // together, by class (market.ts reads it for how firms economise on floor).
  const shareAcc: Partial<Record<Comm, [number, number]>> = {};
  for (const roll of Object.values(R)) for (const t of roll.t) {
    const k = useOf(t), f = t.fin;
    if (!f || !(f.revRef ?? 0)) continue;
    const rentYr = t.rentPsf * t.sf, wages = (f.revRef ?? 0) * (FIRM_PROFILE[t.sector]?.wage ?? 0.35);
    const a = (shareAcc[k] ??= [0, 0]);
    a[0] += rentYr; a[1] += rentYr + wages;
  }
  for (const k of COMM) { const a = shareAcc[k]; if (a && a[1] > 0) (e.spaceShare ??= {})[k] = a[0] / a[1]; }
  const tradeAdd = (t: Tenant) => {
    const k = useOf(t);
    if (!(k in named)) return;
    const h = firmHc(t);
    const ws = (secW[k] ??= {});
    ws[t.sector] = (ws[t.sector] ?? 0) + h;
    const ind = t.ind ?? indOf.get(t.fid!);
    if (ind !== undefined) named[k as Comm][ind] += h / SF_PER_JOB[k as Comm];
  };
  let jobs = 0;
  for (const roll of Object.values(R)) for (const t of roll.t) { tradeAdd(t); const k = useOf(t); if (k in SF_PER_JOB) jobs += firmHc(t) / SF_PER_JOB[k]; }
  for (const h of Object.values(s.holdings)) for (const t of h.tenants ?? []) { tradeAdd(t); const k = useOf(t); if (k in SF_PER_JOB) jobs += firmHc(t) / SF_PER_JOB[k]; }
  for (const sk of e.seekers) if (sk.t) { tradeAdd(sk.t); jobs += firmHc(sk.t) / SF_PER_JOB[sk.use]; }
  e.firmJobs = Math.round(jobs);
  // WHAT EACH INDUSTRY WANTS OF THE ISLAND'S FLOORS: its employment times
  // the island's share of it at the opening (economy.ts `sigma`), shared over
  // the floors its named firms sit on (its own floor when it has none), less
  // what the island's firms already employ. New firms form into that gap at
  // the pace demand becomes a search (FORM_M); a town holding more firms than
  // its industries support loses more at each lease's end (`ratio`, EXIT_BASE).
  const gap: Record<Comm, Float64Array> = { office: new Float64Array(N_IND), retail: new Float64Array(N_IND), industrial: new Float64Array(N_IND) };
  const want: Record<Comm, number> = { office: 0, retail: 0, industrial: 0 };
  const tgt = eco?.target;
  const fill: number[] = [];
  if (tgt) for (let i = 0; i < N_IND; i++) {
    let tot = 0;
    for (const k of COMM) tot += named[k][i];
    fill.push(tgt[i] > 0 ? tot / tgt[i] : 1);
    for (const k of COMM) {
      const split = tot > 0 ? named[k][i] / tot : (floorOf(INDUSTRY_IDS[i]) === k ? 1 : 0);
      const t = tgt[i] * split;
      want[k] += t;
      gap[k][i] = Math.max(0, t - named[k][i]);
    }
  }
  if (tgt) e.islandFill = fill;
  // The suites on the market now, for firms sized by what is on offer.
  const suites: Record<Comm, { avail: number; sc: number }[]> = { office: [], retail: [], industrial: [] };
  for (const [bbl, roll] of Object.entries(R)) {
    const b = blds.get(bbl);
    if (!b) continue;
    for (const k of COMM) {
      if (!b.cap[k]) continue;
      const a = availOf(b, roll, k);
      if (a >= minSfOf(b, k)) suites[k].push({ avail: a, sc: b.sc[k] ?? 50 });
    }
  }
  for (const k of COMM) {
    const d = e.demandAt?.[k];
    const sp = space[k]! as NonNullable<typeof space[Comm]> & { ratio?: number };
    let have = 0;
    for (let i = 0; i < N_IND; i++) have += named[k][i];
    sp.ratio = tgt && want[k] > 0 ? have / want[k] : 1;
    if (!scores[k].length) continue;
    // THE OPENING ONLY (growOpeningStreet): before the game the town is grown
    // to the size its opening space market says it is.
    // THE OPENING: before the game the town is grown to the size its opening
    // space market says it is.
    let fill = 0;
    if (opening && d) {
      const pCap = e.playerNow?.sf?.[k] ?? 0;
      const share = Math.min(1, (sp.cap + pCap) / Math.max(1, e.stock[k]));
      fill = Math.max(0, d.ref * share - hc[k]) / FORM_M[k];
    }
    // SHEDS ARE A REGIONAL MARKET, AND ITS FIRMS CHOOSE WHERE TO BE
    // (2026-10-16). Most of the class's floor is off the map; its tenants are
    // the region's distributors. Each month some of them are on the move —
    // the share of the region's let floor whose leases end and who relocate
    // (SHED_MOVE of each year's expiries, on five-year leases), the sheds on
    // the map whose tenants leave or close, and the region's net new demand —
    // and each mover takes the empty floor it finds: the map's sheds get the
    // movers in proportion to their share of the region's empty floor. That
    // is a matching market, not a quota: the map fills when it has the space
    // and the region is tight, and empties when the region has better to offer.
    // (It replaced a fill toward the map's share of regional demand, itself
    // there because firms formed only from the town's own trades left new
    // sheds empty — 45% vacancy and rents tripling on four of eight runs.)
    let shedMovers = 0;
    if (!opening && k === "industrial" && d) {
      const pCap = e.playerNow?.sf?.[k] ?? 0, pLet = e.playerNow?.occ?.[k] ?? 0;
      let letMap = 0;
      for (const roll of Object.values(R)) for (const t of roll.t) if (useOf(t) === k) letMap += t.sf;
      const mapCap = sp.cap + pCap, occAll = e.occupied?.[k] ?? 0;
      const offCap = Math.max(0, (e.stock?.[k] ?? 0) - mapCap), offOcc = Math.max(0, occAll - letMap - pLet);
      const avMap = Math.max(0, mapCap - letMap - pLet), avOff = Math.max(0, offCap - offOcc);
      const growth = Math.max(0, d.ref - (e.shedRefPrev ?? d.ref)) * (d.raw ?? 1);
      e.shedRefPrev = d.ref;
      const pool = offOcc * SHED_MOVE / 60 + lost[k] * rawNow(s, k) + growth;
      shedMovers = pool * avMap / Math.max(1, avMap + avOff) / rawNow(s, k);
    }
    // NEW FIRMS REPLACE THE ONES THAT CLOSE — fewer of them while the trades
    // they would join are shrinking — AND CARRY HALF OF WHAT THE TRADES ADD
    // (incumbents' own hiring carries the other half). US establishment
    // births and deaths each run ~8-10% a year and track each other; about
    // half of net job creation is new firms (Census BDS; Haltiwanger, Jarmin
    // & Miranda 2013). Nothing here reads the old space-demand equation: the
    // town's firms grow as their trades and their own books let them.
    // ...AND START WHERE A START PAYS. Entry follows what a new firm in the
    // town's trades would clear here today — its trade's normal margin less
    // what today's rent takes of a head's sales (tenantBooks entrantMargin),
    // at the footage it would take at that rent — against the trade's normal
    // margin: half the starts where a start earns half the usual margin, none
    // where it would lose money, more where space is cheap against what is
    // sold (Hopenhayn 1992: entry until the expected value of a start covers
    // its cost). Without an entry decision, closures driven out by rent were
    // replaced one for one at the same rent, and shop rents tripled in real
    // terms over twenty-five years at 3-7% vacancy (measured).
    let entry = 1;
    if (k !== "industrial" && d) {
      let mg = 0, mg0 = 0;
      for (const [sec, w] of Object.entries(secW[k] ?? {})) {
        mg += w! * entrantMargin(e, sec as Tenant["sector"], k, d.raw ?? 1);
        mg0 += w! * FIRM_PROFILE[sec as Tenant["sector"]].margin;
      }
      if (mg0 > 0) entry = Math.max(0, Math.min(1.6, mg / mg0));
    }
    let gapHc = 0;
    for (let i = 0; i < N_IND; i++) gapHc += gap[k][i];
    let form = k === "industrial" && !opening ? shedMovers
      : tgt ? gapHc * SF_PER_JOB[k] / FORM_M[k] * entry + fill
      : fill;
    if (!(form > 0)) continue;
    // New firms, sized off the city's distribution of requirements, shopping
    // for space across the quality the town has.
    const capAll = scores[k].reduce((a, x) => a + x.cap, 0);
    for (let guard = 0; guard < 60 && form > 0; guard++) {
      let u = rng(s, "leasing") * capAll, q = 50;
      for (const x of scores[k]) { u -= x.cap; if (u <= 0) { q = x.sc; break; } }
      q = Math.max(1, Math.min(100, q + rrange(s, -6, 6, "leasing")));
      let want = Math.round(drawTenantSf(s, k, 40_000, 120_000, sizeScale(q)) * rawNow(s, k));
      // Half the new firms are sized by the space on offer: a start-up takes
      // the small suite that is there, not the one it might have drawn up.
      if (suites[k].length && rng(s, "leasing") < 0.5) {
        const pickS = suites[k][Math.floor(rng(s, "leasing") * suites[k].length)];
        want = Math.min(want, pickS.avail);
        q = Math.max(1, Math.min(100, pickS.sc + rrange(s, -4, 4, "leasing")));
      }
      if (!(want > 0)) break;
      // A firm the size of the gap's remainder forms only in proportion.
      if (want > form && rng(s, "leasing") > form / want) break;
      const { sector, ind } = formFor(s, k, gap[k]);
      const credit: Credit = creditOfSize(k, want);
      const t: Tenant = {
        name: pickName(s, sector), use: k, sector, credit, quality: Math.round(q), sf: want, rentPsf: 0,
        net: false, startM: m, endM: m, staff: 1, staffSign: 1, hcRef: want / rawNow(s, k),
        ...(ind !== undefined ? { ind } : {}),
      } as Tenant;
      ensureFirm(s, t);
      e.seekers.push({ fid: t.fid!, use: k, want, since: m, why: "new", t });
      sp.seek += want;
      form -= want / rawNow(s, k);
    }
  }

  // ---- 3. the search: every looking firm takes its broker's shortlist and signs where it is best off
  const pool = [...e.seekers];
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng(s, "leasing") * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const signed = new Set<number>();
  for (const sk of pool) {
    if (sk.tourM !== undefined && m - sk.tourM < 3) continue;          // in talks at one of the player's buildings
    if (rng(s, "leasing") > 1 / SEARCH_M[sk.use]) continue;            // still looking
    const k = sk.use;
    const firm = sk.from ? R[sk.from]?.t.find((t) => t.fid === sk.fid) : sk.t;
    if (!firm) continue;
    const opts = shop(firm, k, sk.want, sk.from, null, !!(sk.from || sk.fromPlayer));
    if (!opts.length) continue;
    const lease = signAt(firm, k, opts[0], opts[1], sk.want, sk.from, sk.fromPlayer, sk.was, sk.whyId);
    if (!lease) continue;
    // ...and the space it leaves behind.
    if (sk.from) {
      const old = R[sk.from];
      if (old) {
        old.t = old.t.filter((t) => t.fid !== sk.fid);
        vacate(old, firm);
        noteRoll(old);
      }
    }
    signed.add(sk.fid);
  }
  if (signed.size) e.seekers = e.seekers.filter((k) => !signed.has(k.fid));
  // Where the street's empty space began, for the markdown it signs at.
  for (const [bbl, roll] of Object.entries(R)) {
    const b = blds.get(bbl);
    if (!b) continue;
    for (const k of COMM) {
      if (!b.cap[k]) continue;
      const vacNow = availOf(b, roll, k) >= minSfOf(b, k);
      roll.vac ??= {};
      if (vacNow && roll.vac[k] === undefined) roll.vac[k] = m;
      else if (!vacNow) delete roll.vac[k];
    }
    if (roll.vac && !Object.keys(roll.vac).length) delete roll.vac;
  }
  // THE LANDLORDS PRICE (tenantMarket.ts reviewAsk): each street owner reviews
  // its ask on each kind of space it has, from its own empty floors, how long
  // they have sat against how long it expected, its mortgage, and the comps.
  // In the opening's years the town is grown on its opening economy held
  // still, demand and all: the landlords sweeten their packages for space
  // that sits, but do not cut faces against a demand that cannot answer —
  // that would only ever cut.
  {
    const h12 = e.history?.length >= 12 ? e.history[e.history.length - 12] : undefined;
    const infl12 = h12?.cpiXS ? (e.cpiXS ?? 1) / h12.cpiXS - 1 : h12?.cpi ? (e.cpi ?? 1) / h12.cpi - 1 : (e.inflExp ?? 0.02);
    for (const [bbl, roll] of Object.entries(R)) {
      const b = blds.get(bbl);
      if (!b) continue;
      for (const k of COMM) {
        if (!b.cap[k] || !(b.mkt[k]! > 0)) continue;
        const since = roll.vac?.[k];
        reviewAsk(bookOf(b, roll, k), e, k, b.mkt[k]!, { m, vacNow: vacShare(b, roll, k), darkM: since === undefined ? undefined : m - since, stressed: b.stressed, infl12, holdFace: opening });
      }
    }
  }
  // The month's totals, after the signings.
  for (const k of COMM) {
    const sp = space[k]!;
    sp.let = 0; sp.seek = 0;
    sp.byBand!.occ.fill(0);
  }
  for (const [bbl, roll] of Object.entries(R)) {
    const b = blds.get(bbl);
    if (!b) continue;
    for (const k of COMM) {
      const c = b.cap[k];
      if (!c) continue;
      const l = Math.min(c, letOf(roll, k));
      space[k]!.let += l;
      space[k]!.byBand!.occ[Math.max(0, Math.min(N_BANDS - 1, Math.floor((b.sc[k] ?? 50) / 10)))] += l;
    }
  }
  for (const sk of e.seekers) if (sk.t) space[sk.use]!.seek += sk.want;
  // What the street's tenants handed back this month, against what is let, a
  // year's rate over a two-year memory (market.ts turnoverYr).
  if (!opening) for (const k of COMM) {
    const l = space[k]!.let;
    if (l > 0) { const tm = (e.turnMeas ??= {}); const was = tm[k] ?? turnoverYr(e, k); tm[k] = was + (12 * handed[k] / l - was) / 24; }
  }
  e.streetSpace = space;
  if (e.streetFailed && e.streetFailed.length > 600) e.streetFailed = e.streetFailed.slice(-600);
}

/** A firm stays: a fresh lease at today's rent for the building, sized to what it needs if the building has the room. */
/**
 * A firm stays: a fresh lease sized to what it needs if the building has the
 * room, at what it bargained against its runner-up (`eff`, $/sf/yr effective;
 * the landlord's ask on the face and the difference as free months). With no
 * bargain to hand — the opening's years, an old save — it pays the ask.
 */
function renewInPlace(s: GameState, b: Bld, roll: StreetRoll, t: Tenant, need: number, deal?: { face: number; eff: number }, L?: LandlordAsk) {
  const k = useOf(t) as Comm;
  const m = s.month;
  const mkt = b.mkt[k] ?? useRentPsfYr(b.rec, s.econ, b.cond, k, b.condIdx);
  // with no bargain to hand, the landlord's renewal offer: the face at market, its package off it
  const face = deal?.face ?? (L ? Math.min(L.a, compsFace(s.econ, mkt, k)) : mkt);
  const eff = deal?.eff ?? face * (1 - (L?.c ?? 0));
  // The renewal term is chosen as a new lease's is: within the covenant's
  // band, shorter for a firm whose trade is growing fast (see THE TERM IS
  // CHOSEN TOO).
  const band = termBandM(t.credit);
  const bk = s.econ.firmBooks?.[t.sector], prevE = s.econ.tradeEmpPrev?.[t.sector];
  const gTrade = bk && prevE ? Math.pow(bk.emp / Math.max(1e-6, prevE), 12) - 1 : 0;
  const termM = Math.round(rrange(s, band.loM, band.hiM, "leasing") * Math.max(0.6, Math.min(1.4, Math.exp(-4 * gTrade))));
  const freeM = freeMonthsFor(face, eff, termM);
  t.rentPsf = +face.toFixed(2);
  t.endM = m + termM;
  t.freeUntilM = freeM > 0 ? m + freeM : undefined;
  const was = t.sf;
  const floor = minSfOf(b, k);
  if (need < t.sf) t.sf = Math.round(Math.max(Math.min(t.sf, floor), need));
  else if (need > t.sf) {
    const room = Math.max(0, (b.cap[k] ?? 0) - roll.t.reduce((a, x) => a + (useOf(x) === k ? x.sf : 0), 0));
    t.sf = Math.round(t.sf + Math.min(need - t.sf, room));
  }
  // WHY: a firm of size that renewed for much less space says so, with the books that shrank it.
  if (was >= 5000 && t.sf < was * 0.85 && t.fin && !growing) {
    why(s, {
      k: "tenant.downsized", a: "tenant", aid: t.fid !== undefined ? String(t.fid) : undefined, name: t.name, bbl: b.bbl,
      n: { sfWas: was, sf: t.sf, staffCh: +((t.staff ?? 1) / Math.max(0.05, t.staffSign ?? 1) - 1).toFixed(3) },
      t: `${t.name} renewed smaller · ${(was / 1000).toFixed(1)}k → ${(t.sf / 1000).toFixed(1)}k sf · staff ${fmtPct((t.staff ?? 1) / Math.max(0.05, t.staffSign ?? 1) - 1)} since it signed`,
    }, [whyTenantBooks(s, t, tenantFin(s.econ, t))]);
  }
  t.staffSign = t.staff ?? 1;
  t.hcRef = need / rawNow(s, k);
  // A fresh lease takes a fresh deposit, sized to the rent and floor it is
  // for: it kept the old one, so a renewal at less rent or on less floor left
  // a deposit of four months' rent with the firm (invariants, seed 4000).
  t.deposit = depositFor(s, t.rentPsf, t.sf, t.credit);
  const sc = b.sc[k] ?? 50;
  recordLease(s.econ, k, m, face, face * (1 - freeM / Math.max(1, termM)), mkt, t.sf,
    Math.max(0, Math.min(N_BANDS - 1, Math.floor(sc / 10))), scoreRentMult(s.econ, k, sc), true);
}

// ------------------------------------------------------- the player's buildings
//
// ONE POOL OF FIRMS. The player's leasing desk (leasing.ts tickLeasing) shows
// its floors to the same firms the street does: a prospect at the player's door
// is a firm from this pool, and if the player does not sign it, it may sign
// down the street. A tenant who leaves a player's building goes looking.

/**
 * A firm from the looking pool to tour one of the player's buildings — of this
 * use, wanting roughly `sf`, shopping near this building's `score`. Marks it in
 * talks for three months. Null when nobody suitable is looking.
 */
export function pullSeeker(s: GameState, use: BuiltClass, sf: number, score: number): Tenant | null {
  const e = s.econ;
  if (!e.seekers?.length || !COMM.includes(use as Comm)) return null;
  const m = s.month;
  let tot = 0;
  const ws: [Seeker, number][] = [];
  for (const k of e.seekers) {
    if (k.use !== use || (k.tourM !== undefined && m - k.tourM < 3)) continue;
    if (k.want < sf * 0.5 || k.want > sf * 2.2) continue;
    const firm = firmOf(s, k);
    if (!firm) continue;
    const w = Math.exp(-Math.abs((firm.quality ?? score) - score) / FIT_W);
    ws.push([k, w]); tot += w;
  }
  if (!(tot > 0)) return null;
  let u = rng(s, "leasing") * tot;
  let pick = ws[0][0];
  for (const [k, w] of ws) { u -= w; if (u <= 0) { pick = k; break; } }
  pick.tourM = m;
  return firmOf(s, pick);
}

function firmOf(s: GameState, k: Seeker): Tenant | null {
  if (k.t) return k.t;
  if (!k.from) return null;
  return s.econ.streetRolls?.[k.from]?.t.find((t) => t.fid === k.fid) ?? null;
}

/**
 * A firm from the pool has signed at one of the player's buildings: it leaves
 * the pool, and the street suite it held over in. Returns what it carries —
 * its books and its people.
 */
export function seekerSigned(s: GameState, fid: number): Partial<Tenant> | null {
  const e = s.econ;
  const at = e.seekers?.findIndex((k) => k.fid === fid) ?? -1;
  if (at < 0) return null;
  const k = e.seekers![at];
  const firm = firmOf(s, k);
  e.seekers!.splice(at, 1);
  if (k.from && e.streetRolls?.[k.from] && firm) {
    const roll = e.streetRolls[k.from];
    roll.t = roll.t.filter((t) => t.fid !== fid);
    (roll.ready ??= []).push({ use: k.use, sf: firm.sf, readyM: s.month + Math.max(1, Math.round(reletMonths(k.use) * 0.5)) });
    (e.streetFailed ??= []).push({ m: s.month, bbl: k.from, name: firm.name, fid: firm.fid, sf: firm.sf, use: k.use, why: "left" });
  }
  if (!firm) return null;
  return { fid, quality: firm.quality, staff: firm.staff, empRef: firm.empRef, fin: firm.fin };
}

/** A tenant leaving one of the player's buildings, on its own feet, goes looking. */
export function playerTenantLeft(s: GameState, t: Tenant, bbl: string, whyId?: number) {
  if (t.defaulted) return;
  toSeekers(s, t, "move", bbl);
  const sk = s.econ.seekers?.[s.econ.seekers.length - 1];
  if (whyId && sk && sk.fid === t.fid) sk.whyId = whyId;
}

// ---------------------------------------------------------------- the flats
//
// EVERY BLOCK OF FLATS HAS ITS OWN HOUSEHOLDS (2026-10-16). A street building's
// occupancy was the market's plus a fixed hash for its character. Now each
// keeps the flats actually let: about 45% of renters move in a year (NMHC,
// Census AHS); movers and new households pick a building by how good it is,
// how keen its rent is (space that has sat is marked down, as the commercial
// floors are) and how hard its owner lets; a new block leases up at most ~8%
// of its units a month. How many households the town houses is the city's
// household and tenure arithmetic (market.ts) — households are people, not
// firms with books — and where they live is these flows.

/**
 * A block of flats' roll: what is let, and the leases that let it — cohorts of
 * flats signed the same month at the same rent ($/sf/yr), each on a one-year
 * lease. `occ` is always the sum of the leases.
 */
export interface FlatRoll { occ: number; vac?: number; l?: { sf: number; rent: number; endM: number }[] }

const MF_LEASEUP = 0.08;

function flatsEligible(s: GameState, parcels: ParcelTable, bbl: string) {
  if (s.holdings[bbl]) return null;
  const rec = resolveRec(parcels, s, bbl);
  if (!rec || rec.class === "land" || rec.class === "house" || !(rec.bldgArea > 0)) return null;
  return useRentableSf(rec, "multifamily") > 0 ? rec : null;
}

/** Blocks of flats join and leave the street (called from syncStreetRolls). */
function syncFlats(s: GameState, parcels: ParcelTable, bbls: string[], opening: boolean) {
  const e = s.econ;
  e.flatRolls ??= {};
  const year = START_YEAR + Math.floor(s.month / 12);
  for (const bbl of bbls) {
    const rec = flatsEligible(s, parcels, bbl);
    const has = e.flatRolls[bbl];
    if (!rec) { if (has) delete e.flatRolls[bbl]; continue; }
    if (has) continue;
    const cap = useRentableSf(rec, "multifamily");
    const sold = e.heldFlats?.[bbl];
    if (sold !== undefined) { e.flatRolls[bbl] = { occ: Math.round(cap * sold) }; continue; }
    if (!opening && year - (rec.yearBuilt || 1900) <= 1) { e.flatRolls[bbl] = { occ: 0 }; continue; }
    // The standing block opens at the market's read on it; the opening's own
    // years of moves (growOpeningStreet) spread the blocks out from there.
    e.flatRolls[bbl] = { occ: Math.round(cap * useOccupancy(rec, e, "multifamily", true)) };
  }
  e.heldFlats = Object.fromEntries(Object.entries(s.holdings).filter(([, h]) => h.occ !== undefined).map(([b, h]) => [b, h.occ!]));
}

/**
 * A month of moves in the street's blocks of flats, to the town's housed
 * households (market.ts `occupied.multifamily`, less the player's). Run after
 * the city's space market.
 */
export function tickStreetFlats(s: GameState, parcels: ParcelTable, housed?: number) {
  const e = s.econ;
  if (!e.flatRolls) return;
  privately(s, `streetflats|${s.month}`, () => {
    const m = s.month;
    // The town's jobs about a year ago (a twelve-month memory), for job moves.
    e.jobsPrevYr = (e.jobsPrevYr ?? e.jobs ?? 1) + ((e.jobs ?? 1) - (e.jobsPrevYr ?? e.jobs ?? 1)) / 12;
    const owners = new Map<string, NonNullable<GameState["rivals"]>[number]>();
    for (const r of s.rivals ?? []) for (const b of r.bbls) owners.set(b, r);
    type F = { roll: FlatRoll; cap: number; w: number; unit: number; intake: number; lim: number; mkt: number; sc: number };
    const fs: F[] = [];
    let after = 0, flatOut = 0;
    for (const [bbl, roll] of Object.entries(e.flatRolls!)) {
      const rec = resolveRec(parcels, s, bbl);
      if (!rec) continue;
      const cap = useRentableSf(rec, "multifamily");
      if (!(cap > 0)) continue;
      roll.occ = Math.min(cap, roll.occ);
      const mkt = useRentPsfYr(rec, e, gradeOf(s, rec), "multifamily");
      // The roll's leases (an old save, or a block that has just joined the
      // street, carries only a count: its flats were let over the last year
      // at about today's rent).
      if (!roll.l) {
        roll.l = [];
        for (let i = 1; i <= 12; i++) if (roll.occ > 0) roll.l.push({ sf: roll.occ / 12, rent: +(mkt * rrange(s, 0.93, 1.01, "leasing")).toFixed(2), endM: m + i });
      }
      // THE MONTH'S EXPIRIES (2026-10-16). Each lease ending this month either
      // renews — at today's rent for the block, less the discount a landlord
      // gives a sitting tenant, and moved by how the last six months' deals
      // went (market.ts dealSlack) — or moves out. About 55% of US renters
      // renew (NMHC/RealPage retention), and a renter whose lease has fallen
      // well under the market stays more often; one asked for much more goes.
      // Each renewal and each new letting below is a deal the market reads.
      const slack = dealSlack(e, "multifamily");
      const keep: NonNullable<FlatRoll["l"]> = [];
      // WHY RENTERS MOVE OUT, FROM WHAT IS HAPPENING (2026-10-16). This was a
      // flat 45% a year. A renter household leaves its flat for a reason, and
      // most of the reasons are flows this town already keeps: it leaves town
      // (renters are about half again as mobile as everyone, so they carry
      // more of any net out-migration), it buys (the US renter-to-owner rate,
      // about 8% a year, falls as owning gets dear against renting — the
      // same tenure margin as `tenureIdx`), or it moves for a job (about 10% a
      // year of renters, more when the town is hiring). What is left is
      // family life — a baby, a partner, a split, an old age — at the rate
      // the CPS records it (about 22% of renters a year). At the opening that
      // adds up to about the old 45%; after it, it moves with the town.
      const out = Math.max(0, -(e.migRate ?? 0)) * 12 * 1.5;
      // (since ONE ECONOMY step 2, the household register's own buyers: the
      // share of its renter households that bought last month, a year —
      // households.ts `tickTenure` — not a second tenure margin)
      const buy = e.eco?.buyRate ?? 0.08 * Math.exp(-10 * ((e.tenureIdx ?? 1) - 1));
      const jobs = 0.10 * Math.max(0.5, Math.min(2, ((e.jobs ?? 1) / Math.max(1, e.jobsPrevYr ?? e.jobs ?? 1)) ** 10));
      const moveOut = Math.min(0.85, 0.22 + out + buy + jobs);
      for (const x of roll.l) {
        if (x.endM > m) { keep.push(x); continue; }
        // A stabilised block (citygov.ts) asks its sitting tenants no more than the guideline.
        const ask = renewalAsk(e, rec.yearBuilt, mkt * slack * 0.97, x.rent);
        const pRenew = Math.max(0.1, Math.min(0.9, (1 - moveOut) - 0.8 * Math.log(ask / Math.max(0.01, x.rent))));
        const stay = x.sf * pRenew * rrange(s, 0.85, 1.15, "leasing");
        flatOut += Math.max(0, x.sf - Math.max(0, stay));
        if (stay > 1) {
          const rent = +Math.max(x.rent * 0.97, ask).toFixed(2);
          keep.push({ sf: stay, rent, endM: m + 12 });
          recordDeal(e, "multifamily", m, rent / Math.max(0.01, mkt), stay, true);
        }
      }
      roll.l = keep;
      roll.occ = keep.reduce((a, x) => a + x.sf, 0);
      const owner = owners.get(bbl);
      const care = owner ? owner.leaseW ?? 0.85 + 0.3 * (paramsOf(owner).care.lease ?? 0.5) : 1;
      const stale = staleDiscount(roll.vac === undefined ? 0 : m - roll.vac);
      const sc = overallScore(rec, e, "multifamily");
      const w = Math.exp((sc - 55) / 25) * Math.pow(1 / stale, 2) * care;
      const unit = Math.max(300, flatUnitSf(rec, cap));
      // A month's lettings: ~8% of the units of a big block, two flats of a small one.
      fs.push({ roll, cap, w, unit, intake: 0, lim: Math.max(cap * MF_LEASEUP, unit * 2), mkt, sc });
      after += roll.occ;
    }
    if (!fs.length) return;
    if (!growing && after + flatOut > 0) {
      const r = 12 * flatOut / (after + flatOut), tm = (e.turnMeas ??= {});
      const was = tm.multifamily ?? turnoverYr(e, "multifamily");
      tm.multifamily = was + (r - was) / 24;
    }
    const target = housed ?? Math.max(0, (e.occupied?.multifamily ?? 0) - (e.playerNow?.occ?.multifamily ?? 0));
    let gap = target - after;
    if (gap < 0) {
      // Fewer households than last month: the extra leavers come out of the
      // least wanted blocks first.
      const tot = fs.reduce((a, f) => a + f.roll.occ / f.w, 0);
      if (tot > 0) for (const f of fs) {
        const occ = Math.max(0, f.roll.occ + gap * (f.roll.occ / f.w) / tot);
        const k = f.roll.occ > 0 ? occ / f.roll.occ : 0;
        for (const x of f.roll.l ?? []) x.sf *= k;
        f.roll.occ = occ;
      }
      gap = 0;
    }
    // Movers and new households take the empty flats.
    // Each block's weight in the draw, kept per block: a draw changes only the
    // block it picks, so only that block's weight is worked out again — the
    // same numbers, summed and walked in the same order, as recomputing every
    // block every draw. (Two blocks sharing one roll would both move; then
    // every weight is recomputed, as before.)
    const nF = fs.length;
    // (The sum counts a block when v > half a unit; the walk skips it only when
    // v <= half a unit — the same blocks unless v is not a number.)
    const inTot = new Uint8Array(nF), inPick = new Uint8Array(nF), termF = new Float64Array(nF);
    const setTerm = (i: number) => {
      const f = fs[i];
      const v = Math.min(f.cap - f.roll.occ, f.lim - f.intake);
      const half = f.unit * 0.5;
      inTot[i] = v > half ? 1 : 0;
      inPick[i] = v <= half ? 0 : 1;
      termF[i] = v * f.w;
    };
    const sharedRoll = new Set(fs.map((f) => f.roll)).size !== nF;
    for (let i = 0; i < nF; i++) setTerm(i);
    for (let guard = 0; guard < 2000 && gap > 1; guard++) {
      if (sharedRoll) for (let i = 0; i < nF; i++) setTerm(i);
      let tot = 0;
      for (let i = 0; i < nF; i++) if (inTot[i]) tot += termF[i];
      if (!(tot > 0)) break;
      let u = rng(s, "leasing") * tot, pick = fs[0], pickI = 0;
      for (let i = 0; i < nF; i++) { if (!inPick[i]) continue; u -= termF[i]; if (u <= 0) { pick = fs[i]; pickI = i; break; } }
      const take = Math.min(gap, pick.cap - pick.roll.occ, pick.unit * 4, pick.lim - pick.intake);
      if (!(take > 0)) break;
      pick.roll.occ += take; pick.intake += take; gap -= take;
      setTerm(pickI);
      // A new letting at the block's rent, as the last six months' deals have
      // moved it, less the concession a block that has stood empty gives.
      const rent = +(pick.mkt * dealSlack(e, "multifamily") * staleDiscount(pick.roll.vac === undefined ? 0 : m - pick.roll.vac)).toFixed(2);
      (pick.roll.l ??= []).push({ sf: take, rent, endM: m + 12 });
      recordDeal(e, "multifamily", m, rent / Math.max(0.01, pick.mkt), take);
    }
    for (const f of fs) {
      // Same-month cohorts at one rent are one lease line; tiny remnants fold in.
      if (f.roll.l) {
        const byKey = new Map<string, { sf: number; rent: number; endM: number }>();
        for (const x of f.roll.l) {
          if (!(x.sf > 0.5)) continue;
          const key = `${x.endM}|${x.rent}`;
          const y = byKey.get(key);
          if (y) y.sf += x.sf; else byKey.set(key, { ...x });
        }
        f.roll.l = [...byKey.values()].map((x) => ({ ...x, sf: Math.round(x.sf) }));
        f.roll.occ = f.roll.l.reduce((a, x) => a + x.sf, 0);
      }
      f.roll.occ = Math.round(f.roll.occ);
      const vacant = f.cap - f.roll.occ > f.unit;
      if (vacant && f.roll.vac === undefined) f.roll.vac = m;
      else if (!vacant) delete f.roll.vac;
    }
    // THE FLATS BY QUALITY, MEASURED OFF THE BLOCKS (2026-10-17), as the
    // offices' and shops' bands are (bands.ts reads it). The bands used to
    // be bookkeeping: new floor parked empty in the top band and the
    // households spread by room, so a band of new blocks that were 95% let
    // read 30% empty, its rent swing fell to 0.26 and every new block
    // priced off it let at a third of what its desk had planned.
    const byBand = { stock: new Array(N_BANDS).fill(0), occ: new Array(N_BANDS).fill(0) };
    for (const f of fs) {
      const b = Math.max(0, Math.min(N_BANDS - 1, Math.floor(f.sc / 10)));
      byBand.stock[b] += f.cap; byBand.occ[b] += Math.min(f.cap, f.roll.occ);
    }
    e.flatBands = byBand;
  });
}

/** A flat's size in this block: its residential feet over its units (households.ts reads the same). */
export function flatUnitSf(rec: ParcelRecord, cap: number): number {
  const units = Math.max(1, rec.unitsRes || Math.round(cap / 850));
  return cap / units;
}

// --------------------------------------------------------- the opening street
//
// THE OPENING STREET IS GROWN, NOT DRAWN (2026-10-16). The rolls a game opens
// on were a fresh draw per building around the market's read of it. Now the
// town's firms and households live four years before the game starts — on the
// opening economy, held still — so the street a player opens on is the result
// of moves, renewals, failures and new firms: which buildings are full and
// which are struggling is something that happened.
const OPENING_YEARS = 4;

function growOpeningStreet(s: GameState, parcels: ParcelTable) {
  const e = s.econ;
  const m0 = s.month, em0 = e.m;
  const savedDemand = e.demandAt;
  // The town at its opening size: firms form to replace what fails and leaves.
  const demandAt: NonNullable<typeof e.demandAt> = {};
  for (const k of COMM) {
    let hc = 0, cap = 0;
    for (const [bbl, roll] of Object.entries(e.streetRolls ?? {})) {
      const rec = resolveRec(parcels, s, bbl);
      if (rec) cap += useRentableSf(rec, k);
      for (const t of roll.t) if (useOf(t) === k) { ensureFirm(s, t); hc += firmHc(t); }
    }
    for (const h of Object.values(s.holdings)) for (const t of h.tenants ?? []) if (useOf(t) === k) { ensureFirm(s, t); hc += firmHc(t); }
    const share = Math.min(1, (cap + (e.playerNow?.sf?.[k] ?? 0)) / Math.max(1, e.stock?.[k] ?? cap));
    // The town at the size its space market opens at: the firms that hold
    // what the city's opening occupancy says is held, plus the few per cent
    // that are always between suites.
    const held = (e.occupied?.[k] ?? 0) * share;
    const want = held > 0 ? held * 1.03 : hc;
    if (want > 0 && share > 0) demandAt[k] = { ref: want / share, eff: 1, raw: 1 };
  }
  e.demandAt = demandAt;
  const housed = Object.values(e.flatRolls ?? {}).reduce((a, f) => a + f.occ, 0);
  growing = true;
  try {
    for (let i = 0; i < OPENING_YEARS * 12; i++) {
      s.month = m0 - OPENING_YEARS * 12 + i;
      e.m = s.month;
      tickStreetRolls(s, parcels);
      tickStreetFlats(s, parcels, housed);
    }
  } finally {
    growing = false;
    s.month = m0;
    e.m = em0;
    e.demandAt = savedDemand;
    // What happened before the game is history, not this month's news — or
    // this month's comps.
    e.streetFailed = [];
    e.deals = undefined;
    // ...but its leases are the comps the town's rents open on (tenantMarket.ts
    // readOut): the asking and effective indices and the package between them
    // are what the street signed in the opening's last six months, so the
    // game's first months restate nothing the street had not already done.
    // The landlords keep their books.
    for (const k of COMM) {
      const ro = readOut(e, k, m0 - 1);
      if (!ro || !e.effRentIdx || !e.concIdx) continue;
      e.rentIdx[k] = +ro.face.toFixed(4);
      e.effRentIdx[k] = +ro.eff.toFixed(4);
      e.concIdx[k] = +ro.conc.toFixed(4);
    }
    // ...and the market opens on what the firms hold, so its first month
    // does not restate the city's occupancy in one step.
    for (const k of ["office", "retail"] as const) {
      const sp = e.streetSpace?.[k];
      if (!sp || !e.occupied || !e.stock?.[k]) continue;
      const pOcc = e.playerNow?.occ?.[k] ?? 0;
      e.occupied[k] = Math.min(e.stock[k], sp.let + pOcc);
      if (e.cityVac) e.cityVac[k] = Math.max(0, Math.min(0.45, 1 - e.occupied[k] / e.stock[k]));
      if (e.streetVac) e.streetVac[k] = Math.max(0, Math.min(0.45, 1 - sp.let / Math.max(1, sp.cap)));
      if (e.pool) e.pool[k] = e.occupied[k] + sp.seek;
    }
    e.streetSpace = undefined;
  }
}
