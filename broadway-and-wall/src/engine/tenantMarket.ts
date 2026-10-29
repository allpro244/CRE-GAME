// THE TENANT MARKET (ONE_ECONOMY_PLAN.md step 4, 2026-10-29).
//
// Rent used to be an equation of the city's vacancy against a "natural" rate
// per class (market.ts NATURAL_VAC, `rentDriftAt`, `vacTerm`), and every lease
// was priced off the index that equation moved. Here nobody sets the rent of
// the town. Two kinds of agent meet:
//
//   LANDLORDS PRICE THEIR OWN SPACE. Each street building's owner holds an
//   asking rent for each kind of space it has, in dollars. It cuts the ask
//   when its space has sat longer than it expected to wait for a tenant — and
//   cuts harder when its loan is in trouble — raises it when space lets faster
//   than it expected, and keeps it within reach of the comparable deals its
//   broker shows it. Its patience (the months it expects a vacancy to take) is
//   learned from its own lettings, and so is the vacancy it expects to carry.
//
//   TENANTS SHOP. A firm looking for space — new, growing, or at the end of a
//   lease — gets a broker's shortlist of buildings with room, and weighs each
//   on what the space is worth to it (the building's market rent, how well the
//   building fits the quality it shops for, and how far it is from the firms it
//   trades with and the people who work for it) against what the landlord will
//   take and what moving costs. It signs where the deal is best for it, and it
//   bargains from its options: the landlord it chooses has to beat the
//   runner-up, so a firm with a close second gets a concession and a firm with
//   nowhere else to go pays the ask.
//
// The city's rent index is then a READ-OUT of the leases signed (`readOut`),
// and so are its concession level and the rent swing between quality bands.
//
// Constants carry [S] when they are a measured fact with a source and [K]
// when they are a shape parameter, stated as such (CLAUDE.md).
import type { ParcelRecord } from "@/data/types";
import type { BuiltClass, Econ, GameState, Tenant } from "./types";
import { tenantQualityTerms } from "./bands";
import { FIRM_PROFILE, SF_PER_JOB, MAKE_READY_M, reletMonths, CONC_DEPTH } from "./market";
import { IO_A, INDUSTRY_IDS, N_IND } from "./industries";

export type Comm = "office" | "retail" | "industrial";
export const COMM_USES: Comm[] = ["office", "retail", "industrial"];

// ---------------------------------------------------------------- the facts

/**
 * WHAT A MOVE COSTS THE TENANT, $/sf in 2024 money (times the town's cost
 * index), all in: the move itself, cabling, IT and furniture ($15-35/sf in
 * the JLL and Cushman & Wakefield relocation guides, 2019-2024), the new
 * fit-out the landlord's allowance does not cover (office fit-outs run
 * $100-200/sf against allowances of $50-120, CBRE fit-out cost guides), and
 * the weeks of disruption. A shop adds fixtures and the sales lost while it
 * reopens; a shed is racking, power and equipment [S~: the middles of those
 * ranges, summed].
 */
export const MOVE_PSF: Record<Comm, number> = { office: 50, retail: 50, industrial: 15 };

/** Buildings on a tenant broker's shortlist: a tour book runs five to eight (CBRE / JLL tenant-rep practice) [K]. */
export const SHORTLIST = 6;

/**
 * HOW FAR A FIRM'S TRIPS GO IN AN HOUR, door to door: about 15 km/h in a
 * town's mix of walking, transit and driving (NHTS 2017: urban car trips
 * ~30 km/h, bus ~12, walking 5, all modes with access time ~15-20) [S~].
 */
const SPEED_M_PER_H = 15_000;
/**
 * TRIPS A YEAR BETWEEN A FIRM AND EACH FIRM IT TRADES WITH BY NAME: about one
 * a week — meetings, site visits, deliveries [K].
 */
const LINK_TRIPS_YR = 50;
/** Working days a year, for the commute [S: 260 less ~30 days of leave and holidays]. */
const COMMUTE_DAYS = 230;
/**
 * WHAT A COMMUTE COSTS, and who pays it. US DOT values personal travel time at
 * half the wage [S: USDOT, "Revised Departmental Guidance on Valuation of
 * Travel Time", 2016]; a firm that moves further from its people pays about
 * half of their extra commute in wages or loses them [S~: Mulalic, van
 * Ommeren & Pilegaard 2014, Economic Journal — firm relocations in Denmark].
 */
const COMMUTE_VOT = 0.5, COMMUTE_FIRM_SHARE = 0.5;
/** Paid hours a year, for the hourly cost of a head [S: 52 x 40 less leave ≈ 2,000]. */
const HOURS_YR = 2000;
/**
 * A FIRM'S NAMED RELATIONSHIPS (economy.ts LINKS_PER_FIRM, about three
 * suppliers a firm keeps by name): a firm with fewer counts the centre of its
 * industry's customers for the rest.
 */
const LINKS_EXPECTED = 3;

/**
 * THE REASONS A FIRM MOVES THAT ARE NOT IN ITS BOOKS — a merger, a new partner
 * who hates the commute, a landlord it has fallen out with — as a taste for
 * each building, Gumbel-distributed with this scale against the building's
 * rent (the logit of discrete-choice location models). Calibrated so that,
 * with moving costs as above and ordinary landlords, about 55% of expiring
 * office space renews in place, 65% of shops and 75% of sheds (CBRE and JLL
 * lease-expiry studies; Prologis retention) [K: shape parameter, fitted to
 * those retention rates, measured in test/tenantmarket.mjs].
 */
export const TASTE: Record<Comm, number> = { office: 0.10, retail: 0.08, industrial: 0.07 };

/**
 * THE LANDLORD'S PRICING RULE: THE PACKAGE FIRST, THE FACE SECOND.
 *
 * A landlord posts two things for its space: an asking (face) rent and a
 * package — free rent and fit-out, as a share of the face over the term.
 * Faces are sticky and packages move: a landlord whose space sits past its
 * patience sweetens the package before it cuts the face (its lender and its
 * valuer read the face), and one whose space lets at once takes the package
 * back before it raises the face. That is the record: four years after the
 * 2020 shock Manhattan asking was -3.3% while net effective was -17.3%, and
 * US gateway free rent went 9.7 to 12.5 months in a year (market.ts CONC_DEPTH
 * and the concession notes there).
 *
 *   COMPS_M      months for an ask, and a package, to close on the comps its
 *                broker shows it: an opinion of rent is refreshed about once a
 *                year [K].
 *   PKG_MAX      the deepest package: 15-20 months free on a ten-year office
 *                lease and $100-150/sf of fit-out in a glut, 30-40% of face
 *                (market.ts CONC_DEPTH) [S].
 *   PKG_STEP     how fast a package sweetens while space sits past patience:
 *                about a point a month, so a year past patience adds twelve
 *                points — a free month or so a year of term [K].
 *   PKG_TAKE     how much of the package one quick letting takes back [K].
 *   CUT_DEEP     the steepest a face falls in a month, once the package is at
 *                its deepest and the space still sits: -18.6% a year, the
 *                Houston 1983-87 office rate [S].
 *   RAISE        the step a face rises by when space lets at once with no
 *                package left to take back, scaled down to nothing at the
 *                landlord's usual wait [K].
 *   LET_MEMORY   lettings over which a landlord learns how long a vacancy
 *                takes: about twenty — patience is slow to change [K].
 *   VAC_MEMORY   months over which it learns the vacancy it carries: five
 *                years [K].
 *   STRESS       an owner whose mortgage is behind (or whose firm is under
 *                water) moves half as fast again, and takes less [K].
 */
const COMPS_M = 12;
const PKG_MAX = 0.35;
const PKG_STEP = 0.01;
const PKG_TAKE = 0.03;
const CUT_DEEP = 0.0155;
const RAISE = 0.03;
const LET_MEMORY = 20;
const VAC_MEMORY = 60;
const STRESS_MOVE = 1.5, STRESS_RES = 0.96;

/** The months of search in an ordinary turn — the landlord's opening patience (market.ts reletMonths less make-ready). */
export function searchMonths(k: Comm): number {
  return Math.max(1, reletMonths(k) - MAKE_READY_M[k]);
}

// ---------------------------------------------------------------- the landlord's book

/** A landlord's book on one kind of space in one building. */
export interface LandlordAsk {
  /** asking (face) rent, $/sf/yr */
  a: number;
  /** the package it posts: free rent and fit-out as a share of the face over the term */
  c: number;
  /** months it expects a vacancy to take to let, learned from its lettings */
  t: number;
  /** the vacancy it expects to carry, learned from its own record */
  v: number;
  /** month the ask was last reviewed */
  m: number;
}

/** The town's package now, from the comps: what separates face from effective. */
export function compsPackage(e: Econ, k: Comm): number {
  const face = e.rentIdx?.[k] ?? 0, eff = e.effRentIdx?.[k] ?? face;
  return face > 0 ? Math.max(0, Math.min(PKG_MAX, 1 - eff / face)) : 0;
}

/** What the comps say this building's space rents for, face: the read-out market rent times the face-over-effective of the read-out. */
export function compsFace(e: Econ, mkt: number, k: Comm): number {
  const face = e.rentIdx?.[k] ?? 0, eff = e.effRentIdx?.[k] ?? face;
  return mkt * (eff > 0 ? face / eff : 1);
}

/** A landlord's book, opened at the comps when it has none (or a fresh opening). */
export function askOf(book: Partial<Record<Comm, LandlordAsk>>, k: Comm, e: Econ, mkt: number, vacNow: number, m: number): LandlordAsk {
  const L = (book[k] ??= { a: NaN, c: compsPackage(e, k), t: searchMonths(k), v: vacNow, m });
  if (!(L.a > 0) || !Number.isFinite(L.a)) { L.a = +Math.max(0.01, compsFace(e, mkt, k)).toFixed(2); L.c = compsPackage(e, k); }
  if (!Number.isFinite(L.c)) L.c = compsPackage(e, k);
  return L;
}

/** What the landlord posts, effective: the face less the package. A sitting tenant is offered the face no higher than the comps say (renewal at market). */
export function postedEff(L: LandlordAsk, e: Econ, k: Comm, mkt: number, sitting: boolean): number {
  const face = sitting ? Math.min(L.a, compsFace(e, mkt, k)) : L.a;
  return face * (1 - L.c);
}

/**
 * ONE MONTH OF A LANDLORD'S BOOK on one kind of space: costs passed through,
 * face and package pulled toward the comps, and — space sitting past its
 * patience — the package sweetened, then the face cut (both faster when its
 * loan is in trouble).
 */
export function reviewAsk(L: LandlordAsk, e: Econ, k: Comm, mkt: number, opts: { m: number; vacNow: number; darkM?: number; stressed: boolean; infl12: number }): void {
  if (L.m >= opts.m) return;
  const months = Math.max(1, Math.min(12, opts.m - L.m));
  L.m = opts.m;
  L.v += (opts.vacNow - L.v) * Math.min(1, months / VAC_MEMORY);
  const comps = compsFace(e, mkt, k), pull = Math.min(1, months / COMPS_M);
  if (!(L.a > 0) || !Number.isFinite(L.a)) L.a = comps > 0 ? comps : 1;
  let d = (opts.infl12 / 12) * months;
  if (comps > 0) d += (Math.log(comps) - Math.log(L.a)) * pull;
  L.c += (compsPackage(e, k) - L.c) * pull;
  if (opts.darkM !== undefined && opts.darkM > L.t) {
    const push = (1 - Math.exp(-(opts.darkM - L.t) / Math.max(1, L.t))) * (opts.stressed ? STRESS_MOVE : 1) * months;
    if (L.c < PKG_MAX) L.c = Math.min(PKG_MAX, L.c + PKG_STEP * push);
    else d -= CUT_DEEP * push;
  }
  L.c = Math.max(0, Math.min(PKG_MAX, L.c));
  L.a = +(L.a * Math.exp(Math.max(-0.2, Math.min(0.2, d)))).toFixed(2);
}

/** The landlord learns from a letting: how long it took, and — let at once — that it gave too much (the package back first, then the face up). */
export function noteLetting(L: LandlordAsk, tom: number) {
  if (tom < L.t) {
    const f = 1 - tom / Math.max(0.5, L.t);
    if (L.c > 0) L.c = Math.max(0, L.c - PKG_TAKE * f);
    else L.a = +(L.a * Math.exp(RAISE * f)).toFixed(2);
  }
  L.t += (Math.max(0.5, tom) - L.t) / LET_MEMORY;
}

/**
 * WHAT THE LANDLORD WILL GO TO for a tenant with somewhere else to go: its
 * posted effective rent less what it expects to lose by waiting for the next
 * tenant instead — its own expected months to let (plus the make-ready when
 * the tenant would leave a suite it is sitting in), spread over the term —
 * and less again when it needs the cash.
 */
export function reservation(L: LandlordAsk, k: Comm, post: number, termM: number, sitting: boolean, stressed: boolean): number {
  const wait = L.t + (sitting ? MAKE_READY_M[k] : 0);
  return post * Math.max(0.4, 1 - wait / Math.max(12, termM)) * (stressed ? STRESS_RES : 1);
}
// ---------------------------------------------------------------- where firms are

/** A point in metres (local projection of a parcel's centroid). */
export function posOf(rec: Pick<ParcelRecord, "centroid">): [number, number] | null {
  const c = rec.centroid;
  if (!c) return null;
  const k = 111_320;
  return [c[0] * k * Math.cos((c[1] * Math.PI) / 180), c[1] * k];
}

/**
 * EACH FIRM'S PLACES THAT MATTER, this month: the buildings of the firms it
 * trades with by name (economy.ts links), the homes of its people who live on
 * the island (the household register), and — for a firm with fewer named
 * relationships than usual — the centre of its industry's customers. Each
 * point carries the hours a year a metre of distance to it costs the firm.
 */
export interface LocCtx {
  m: number;
  /** fid -> [x, y, hoursPerMetreYr, kind(0 link,1 worker,2 customers)] flattened */
  pts: Map<number, number[]>;
  /** each housed firm's position */
  at: Map<number, [number, number]>;
  /** each firm's industry */
  ind: Map<number, number>;
}

const CTX = new WeakMap<GameState, LocCtx>();

/** The month's location context, built once a month per state. */
export function locCtx(s: GameState, recOf: (bbl: string) => ParcelRecord | null | undefined): LocCtx {
  const hit = CTX.get(s);
  if (hit && hit.m === s.month) return hit;
  const at = new Map<number, [number, number]>();
  const heads = new Map<number, number>();
  const place = (t: Tenant, bbl: string) => {
    if (t.fid === undefined || t.use === "multifamily") return;
    const rec = recOf(bbl);
    const p = rec ? posOf(rec) : null;
    if (p) at.set(t.fid, p);
    const k = (t.use ?? "office") as Comm;
    heads.set(t.fid, (t.hcRef ?? t.sf) * (t.staff ?? 1) / Math.max(0.2, t.staffSign ?? 1) / (SF_PER_JOB[k] || 230));
  };
  for (const [bbl, roll] of Object.entries(s.econ.streetRolls ?? {})) for (const t of roll.t) place(t, bbl);
  for (const [bbl, h] of Object.entries(s.holdings)) for (const t of h.tenants ?? []) place(t, bbl);
  const pts = new Map<number, number[]>();
  const add = (fid: number, p: [number, number], hPerM: number, kind: number) => {
    let a = pts.get(fid);
    if (!a) { a = []; pts.set(fid, a); }
    a.push(p[0], p[1], hPerM, kind);
  };
  // the firms they trade with by name
  const E = s.economy;
  const ind = new Map<number, number>();
  if (E?.f && E.L?.slot) {
    const n = E.L.slot.n, id = E.f.id as unknown as ArrayLike<number>, ii = E.f.ind as unknown as ArrayLike<number>;
    for (let q = 0; q < n; q++) if (id[q] >= 0) ind.set(id[q], ii[q]);
  }
  const linkH = LINK_TRIPS_YR * 2 / SPEED_M_PER_H;
  const nLinks = new Map<number, number>();
  const lk = E?.lk as unknown as { s?: ArrayLike<number>; c?: ArrayLike<number> } | undefined;
  if (lk?.s && lk.c && ArrayBuffer.isView(lk.s)) {
    for (let l = 0; l < lk.s.length; l++) {
      const a = lk.s[l], b = lk.c[l];
      const pa = at.get(a), pb = at.get(b);
      if (pa && pb) {
        add(a, pb, linkH, 0); add(b, pa, linkH, 0);
        nLinks.set(a, (nLinks.get(a) ?? 0) + 1); nLinks.set(b, (nLinks.get(b) ?? 0) + 1);
      }
    }
  }
  // the island's people and where they work
  const R = s.households as unknown as { n?: number; blocks?: string[]; a?: { blk: Int32Array; emp1: Int32Array; emp2: Int32Array; wt: Float32Array } } | undefined;
  if (R?.a && R.blocks && R.n) {
    const commuteH = COMMUTE_DAYS * 2 / SPEED_M_PER_H * COMMUTE_VOT * COMMUTE_FIRM_SHARE;
    const home = new Map<number, [number, number] | null>();
    const acc = new Map<number, Map<number, number>>();   // fid -> block -> heads
    for (let i = 0; i < R.n; i++) {
      const b = R.a.blk[i];
      if (b < 0) continue;
      for (const emp of [R.a.emp1[i], R.a.emp2[i]]) {
        if (emp < 0 || !at.has(emp)) continue;
        let m = acc.get(emp);
        if (!m) { m = new Map(); acc.set(emp, m); }
        m.set(b, (m.get(b) ?? 0) + R.a.wt[i]);
      }
    }
    for (const [fid, m] of acc) for (const [b, w] of m) {
      let p = home.get(b);
      if (p === undefined) { const rec = recOf(R.blocks[b]); p = rec ? posOf(rec) : null; home.set(b, p); }
      if (p) add(fid, p, commuteH * w, 1);
    }
  }
  // the centre of each industry's customers, for firms with fewer named links than usual
  if (ind.size) {
    const cx = new Float64Array(N_IND), cy = new Float64Array(N_IND), cw = new Float64Array(N_IND);
    const sx = new Float64Array(N_IND), sy = new Float64Array(N_IND), sw = new Float64Array(N_IND);
    for (const [fid, p] of at) {
      const j = ind.get(fid);
      if (j === undefined) continue;
      const h = heads.get(fid) ?? 1;
      sx[j] += p[0] * h; sy[j] += p[1] * h; sw[j] += h;
    }
    for (let i = 0; i < N_IND; i++) {
      for (let j = 0; j < N_IND; j++) {
        if (!(sw[j] > 0)) continue;
        const a = IO_A[INDUSTRY_IDS[j]][i] ?? 0;
        if (!(a > 0)) continue;
        cx[i] += a * sx[j]; cy[i] += a * sy[j]; cw[i] += a * sw[j];
      }
    }
    for (const [fid] of at) {
      const i = ind.get(fid);
      if (i === undefined || !(cw[i] > 0)) continue;
      const short = LINKS_EXPECTED - (nLinks.get(fid) ?? 0);
      if (short > 0) add(fid, [cx[i] / cw[i], cy[i] / cw[i]], linkH * short, 2);
    }
  }
  const ctx: LocCtx = { m: s.month, pts, at, ind };
  CTX.set(s, ctx);
  return ctx;
}

/** A firm's cost of an hour of its people's time: its payroll over its heads (its own books), else its trade's share of sales at the town's reference. */
export function hourCost(t: Tenant): number {
  const k = (t.use ?? "office") as Comm;
  const heads = Math.max(0.5, (t.hcRef ?? t.sf) * (t.staff ?? 1) / Math.max(0.2, t.staffSign ?? 1) / (SF_PER_JOB[k] || 230));
  const rev = t.fin?.revRef ?? t.fin?.rev0 ?? 0;
  const w = FIRM_PROFILE[t.sector]?.wage ?? 0.35;
  return rev > 0 ? rev * w / heads / HOURS_YR : 0;
}

/** Hours-weighted distance cost a year ($) of a firm at a point; and the mean metres to its named partners / customers' centre (for the record). */
export function placeCost(pts: number[] | undefined, p: [number, number] | null, hour: number): { cost: number; dLink: number; dWork: number } {
  if (!pts || !p || !(hour > 0)) return { cost: 0, dLink: NaN, dWork: NaN };
  let cost = 0, dl = 0, wl = 0, dw = 0, ww = 0;
  for (let i = 0; i < pts.length; i += 4) {
    const d = Math.hypot(pts[i] - p[0], pts[i + 1] - p[1]);
    cost += d * pts[i + 2] * hour;
    if (pts[i + 3] === 1) { dw += d * pts[i + 2]; ww += pts[i + 2]; } else { dl += d * pts[i + 2]; wl += pts[i + 2]; }
  }
  return { cost, dLink: wl > 0 ? dl / wl : NaN, dWork: ww > 0 ? dw / ww : NaN };
}

// ---------------------------------------------------------------- the deal

/** One option on a firm's shortlist, valued per foot a year. */
export interface Option {
  bbl: string;
  /** feet it would take here */
  take: number;
  /** the building's market rent (effective, read-out) */
  mkt: number;
  /** the landlord's ask (face), what it posts after its package (effective), and what it would go to */
  ask: number; post: number; res: number;
  /** what the space is worth to this firm, $/sf/yr, before rent */
  worth: number;
  /** moving cost, $/sf/yr over the term */
  move: number;
  /** worth less the posted rent less moving, plus the firm's taste for it: what the firm ranks on */
  joint: number;
  /** metres to its partners / its people from here */
  dLink: number; dWork: number;
  /** the current building (a renewal) */
  stay?: boolean;
}

/** A Gumbel draw (the logit taste). */
export function gumbel(u: number): number {
  return -Math.log(-Math.log(Math.min(1 - 1e-12, Math.max(1e-12, u))));
}

/**
 * WHAT A BUILDING IS WORTH TO A FIRM, $/sf/yr: its market rent (the read-out
 * of what deals sign at, for its address, plate, quality and condition) times
 * how well it fits the quality this firm shops for (bands.ts: a firm
 * stretching up offers under, one settling down pays over), plus — for a shop
 * — how the people within a walk of it now compare with the town's (the trips
 * that make a shop's sales: streetRolls CATCHMENT), less what being there
 * costs it in its people's and partners' time.
 */
export function worthOf(t: Tenant, k: Comm, mkt: number, sc: number, take: number, distCostYr: number, footRel?: number): number {
  const fit = tenantQualityTerms(t.quality ?? sc, sc).rent;
  const foot = k === "retail" && footRel !== undefined && footRel > 0 ? Math.pow(Math.max(0.25, Math.min(4, footRel)), 0.5) : 1;
  return mkt * fit * foot - distCostYr / Math.max(1, take);
}

/** Moving cost, $/sf/yr over the term. */
export function moveCostPsfYr(e: Econ, k: Comm, termM: number): number {
  return MOVE_PSF[k] * (e.costIdx ?? 1) / Math.max(1, termM / 12);
}

/**
 * THE BARGAIN. The firm takes the building it ranks first, at its posted
 * rent — unless the runner-up's landlord is hungrier: the firm can walk to
 * the runner-up and have it go to its own reservation, so the chosen landlord
 * must leave the firm at least as well off as that, and the two split what is
 * left (a Nash bargain with an outside option). So a firm with a close second
 * at a landlord that needs the tenant more gets the rent cut; a firm with
 * nowhere else to go pays what is posted. Never under the chosen landlord's
 * own reservation, never over its post.
 */
export function bargain(best: Option, second: Option | undefined): number {
  if (!second) return best.post;
  const rMax = best.post + (best.joint - second.joint) + (second.post - second.res);
  return Math.max(best.res, Math.min(best.post, (best.res + rMax) / 2));
}

/** Free months that take a face rent to an effective one over a term. */
export function freeMonthsFor(face: number, eff: number, termM: number): number {
  if (!(face > 0) || eff >= face) return 0;
  return Math.max(0, Math.min(termM - 1, Math.round(termM * (1 - eff / face))));
}

// ---------------------------------------------------------------- the read-out

/**
 * A LEASE SIGNED, AS A COMP: its face and effective rent in index dollars (its
 * rent over its building's market rent, times the effective index the month it
 * signed), its building's quality band and the band's swing then, and its feet.
 */
export interface Comp { m: number; f: number; e: number; b: number; nb: number; sf: number; r?: 1 }

export const COMP_WINDOW_M = 6;

/** Record a commercial lease (the street's, a renewal, or the player's). */
export function recordLease(e: Econ, k: BuiltClass, m: number, face: number, eff: number, mkt: number, sf: number, band: number, bandRent: number, renewal = false) {
  if (k === "multifamily" || !(mkt > 0) || !(sf > 0) || !(face > 0) || !(eff > 0)) return;
  const idx = e.effRentIdx?.[k] ?? e.rentIdx?.[k] ?? 0;
  if (!(idx > 0)) return;
  const list = ((e.comps ??= {})[k] ??= []);
  const fx = face / mkt * idx, ex = eff / mkt * idx;
  list.push({ m, f: +fx.toFixed(4), e: +ex.toFixed(4), b: band, nb: +(ex * Math.max(0.05, bandRent)).toFixed(4), sf: Math.round(sf), ...(renewal ? { r: 1 as const } : {}) });
  while (list.length && list[0].m < m - COMP_WINDOW_M) list.shift();
  while (list.length > 600) list.shift();
}

/**
 * THE TOWN'S RENT, READ OFF ITS LEASES: the asking (face) and effective rent
 * indices are the square-foot-weighted means of the comps of the last six
 * months, each normalised to an ordinary building (its address, plate,
 * quality and condition taken out). The concession level is what separates
 * them. Null when nothing has signed in the window — the index then stands.
 */
export function readOut(e: Econ, k: Comm, m: number): { face: number; eff: number; conc: number; sf: number; n: number } | null {
  const list = e.comps?.[k];
  if (!list) return null;
  while (list.length && list[0].m < m - COMP_WINDOW_M) list.shift();
  let sf = 0, f = 0, ef = 0;
  for (const c of list) { sf += c.sf; f += c.f * c.sf; ef += c.e * c.sf; }
  if (!(sf > 0)) return null;
  const face = f / sf, eff = ef / sf;
  return { face, eff, conc: Math.max(0, Math.min(1, (1 - eff / Math.max(1e-9, face)) / CONC_DEPTH)), sf, n: list.length };
}

/**
 * EACH QUALITY BAND'S RENT AGAINST THE CLASS, read off the same comps: a band
 * with deals reads what they signed at with the band's own swing taken back
 * out (`nb`), over the effective index. Bands without a deal in the window
 * keep what they had.
 */
export function bandReadOut(e: Econ, k: Comm, nBands: number): (number | undefined)[] {
  const list = e.comps?.[k] ?? [];
  const idx = e.effRentIdx?.[k] ?? 0;
  const sf = new Array(nBands).fill(0), v = new Array(nBands).fill(0);
  for (const c of list) { if (c.b >= 0 && c.b < nBands) { sf[c.b] += c.sf; v[c.b] += c.nb * c.sf; } }
  return sf.map((x, b) => (x > 0 && idx > 0 ? v[b] / x / idx : undefined));
}

// ---------------------------------------------------------------- why it left

const fmtPct = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(Math.round(x * 100))}%`;

/** "moved to 40 Water St · rent −18% · 600 m closer to clients" */
export function movedLine(to: string, rentCh: number, dLinkOld: number, dLinkNew: number, dWorkOld: number, dWorkNew: number): string {
  const parts = [`moved to ${to}`];
  if (Number.isFinite(rentCh)) parts.push(`rent ${fmtPct(rentCh)}`);
  const dl = dLinkOld - dLinkNew, dw = dWorkOld - dWorkNew;
  if (Number.isFinite(dl) && Math.abs(dl) >= 100) parts.push(`${Math.round(Math.abs(dl) / 50) * 50} m ${dl > 0 ? "closer to" : "further from"} clients`);
  else if (Number.isFinite(dw) && Math.abs(dw) >= 100) parts.push(`${Math.round(Math.abs(dw) / 50) * 50} m ${dw > 0 ? "closer to" : "further from"} its staff`);
  return parts.join(" · ");
}

export { fmtPct };
