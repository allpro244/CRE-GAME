// THE TENANT MARKET (ONE_ECONOMY_PLAN.md step 4, 2026-10-29).
//
// Rent used to be an equation of the city's vacancy against a "natural" rate
// per class (market.ts NATURAL_VAC, `rentDriftAt`, `vacTerm`), and every lease
// was priced off the index that equation moved. Here nobody sets the rent of
// the town. Two kinds of agent meet:
//
//   LANDLORDS PRICE THEIR OWN SPACE. Each street building's owner holds an
//   asking rent for each kind of space it has, in dollars, and a package off
//   it. It prices on its own tours: the firms its broker brought through, the
//   most each would pay, the feet it has to let and the term a lease runs —
//   the rent that earns most over a lease net of the months its space waits
//   at it (`reviewAsk`), the package moving before the face. It takes less
//   when its loan is in trouble.
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
//   AND TENANTS COMPETE. The firms looking in a month tour the same market, so
//   in a tight one several want the same suite. Its landlord takes the best
//   proposal its room holds, the firm it signs pays enough to beat the best
//   one it turned away (`contestPrice`), and its next suite is posted at what
//   this one fetched (`noteContest`). Where space is plentiful nobody is
//   turned away and none of this binds; it is what makes rents climb fastest
//   at the lowest vacancy.
//
// The city's rent index is then a READ-OUT of the leases signed (`readOut`),
// and so are its concession level and the rent swing between quality bands.
//
// Constants carry [S] when they are a measured fact with a source and [K]
// when they are a shape parameter, stated as such (CLAUDE.md).
import type { ParcelRecord } from "@/data/types";
import type { BuiltClass, Credit, Econ, GameState, Tenant } from "./types";
import { SIZE_DIST } from "./plates";
import { tenantQualityTerms } from "./bands";
import { FIRM_PROFILE, SF_PER_JOB, MAKE_READY_M, CONC_DEPTH } from "./market";
import { IO_A, INDUSTRY_IDS, N_IND, sfMix } from "./industries";

export type Comm = "office" | "retail" | "industrial";

/**
 * A FIRM'S HEADS (FORMULA_LEDGER #10): the floor it needs in reference feet
 * (streetRolls.ts `firmHc`: what it took at signing, moved by its staff since)
 * over the feet a worker of its industry takes on its class's floor
 * (industries.ts `sfMix` on market.ts SF_PER_JOB). Its need is those heads
 * times those feet — the same number read the other way. economy.ts and
 * streetRolls.ts read these heads.
 */
export function tenantHeads(t: Tenant): number {
  const k = (t.use ?? "office") as Comm;
  return (t.hcRef ?? t.sf) * (t.staff ?? 1) / Math.max(0.2, t.staffSign ?? 1) / ((SF_PER_JOB[k] || 230) * sfMix(t.ind, k));
}
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
 * THE LANDLORD PRICES ITS SPACE ON ITS OWN TOURS (REAL_ECONOMY_PLAN, no normal
 * vacancy step 9a, 2026-11-08) — the rule a block's landlord prices its flats
 * by (streetRolls.ts `priceFlats`), on a commercial landlord's evidence.
 *
 * What a landlord knows is what came through its door: the firms that toured
 * its space (each on a broker's shortlist, `shop`) and the most each would pay
 * for the suite — the rent at which it would rather sign nothing and keep
 * looking (`tourBudget`) — the feet each wanted, the term each would sign, and the feet it has to let. At
 * an effective rent p the firms that would sign are those whose ceilings reach
 * it; they arrive at W(p) feet a month, so its free feet F wait about F / W(p)
 * months, and a lease earns p for the rest of the term T. It posts the p that
 * earns most: max p · (T − F / W(p)). A glut is a door with few ceilings for
 * its feet, and it cuts; a shortage one with more than it can house, and it
 * takes the top of the book. Inflation and what firms can pay arrive in the
 * ceilings. No patience, no months-on-market norm, no gain, no comps in the
 * ask: it replaced a ladder (package sweetened, then face cut, once space sat
 * past a patience seeded from the class's ordinary months on market, and the
 * package taken back, then the face raised, for space that let faster than
 * that norm) under which the office face never fell — the century's office
 * Wheaton-Torto slope was −0.22%/yr per point of vacancy, against −2 to −3 in
 * the record.
 *
 * FACE AND PACKAGE. Faces are sticky and packages move: a landlord gives free
 * rent and fit-out before it cuts the face its lender and its valuer read, and
 * takes the package back before it raises the face. That is the record: four
 * years after the 2020 shock Manhattan asking was −3.3% while net effective was
 * −17.3%, and US gateway free rent went 9.7 to 12.5 months in a year (market.ts
 * CONC_DEPTH). So its face is what the best prospect on its book would pay —
 * the top of its tours — and the rent it chooses is posted as that face less
 * a package: in a shortage it takes the top of the book and the package burns
 * off; in a glut it reaches down its book and the package deepens, the face
 * moving only with the best prospects. Past the deepest package the face is
 * cut to carry the rest. (Holding the face until the package was at its
 * deepest, as the ladder did, left offices at 5% vacancy carrying 30%
 * packages for a decade: a face set in another market never came back down.)
 *
 *   PKG_MAX          the deepest package: 15-20 months free on a ten-year office
 *                    lease and $100-150/sf of fit-out in a glut, 30-40% of face
 *                    (market.ts CONC_DEPTH) [S].
 *   COMPS_M          the months of tours it reads, and the most it remembers:
 *                    a commercial landlord's opinion of rent is refreshed about
 *                    once a year with its leasing broker, on the year's tours
 *                    and proposals — an office building sees a handful a year,
 *                    not the flats' daily traffic, which is read over a
 *                    quarter. It is also how fast the package fades on a
 *                    building with nothing left to let [K].
 *   STRESS           an owner whose mortgage is behind (or whose firm is under
 *                    water) needs the rent now: a month empty weighs half as
 *                    much again, and it takes less [K].
 */
const COMPS_M = 12;
const PKG_MAX = 0.35;
const TOUR_Q = 16;
const STRESS_MOVE = 1.5, STRESS_RES = 0.96;

// ---------------------------------------------------------------- the landlord's book

/**
 * A month of the landlord's door, compressed: the month, the CPI then, the
 * feet-weighted term and up to TOUR_Q [ceiling, feet] points of the firms that
 * toured; `f` when it had space to let at the month's end, and the feet it let
 * (`l`) at their mean effective rent (`e`).
 */
export interface TourMonth { m: number; i: number; T: number; q: number[]; f?: 1; l?: number; e?: number }

/** A landlord's book on one kind of space in one building. */
export interface LandlordAsk {
  /** asking (face) rent, $/sf/yr */
  a: number;
  /** the package it posts: free rent and fit-out as a share of the face over the term */
  c: number;
  /** the months it expects its free space to wait for a signer at its ask, read off its own tours (0 before it has any) */
  t: number;
  /** month the ask was last reviewed */
  m: number;
  /** this month's tours so far, flattened [ceiling $/sf/yr, feet, term months] */
  tn?: number[];
  /** this month's lettings so far, flattened [feet, effective $/sf/yr] */
  ln?: number[];
  /** the earlier months' tours (`TourMonth`), the last COMPS_M months */
  tc?: TourMonth[];
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

/**
 * A landlord's book, opened at the comps when it has none (or a fresh
 * opening): a building with no tours yet has only what its broker shows it.
 * From its first tours it prices on its own door (`reviewAsk`).
 */
export function askOf(book: Partial<Record<Comm, LandlordAsk>>, k: Comm, e: Econ, mkt: number, _vacNow: number, m: number): LandlordAsk {
  const L = (book[k] ??= { a: NaN, c: compsPackage(e, k), t: 0, m });
  if (!(L.a > 0) || !Number.isFinite(L.a)) { L.a = +Math.max(0.01, compsFace(e, mkt, k)).toFixed(2); L.c = compsPackage(e, k); }
  if (!Number.isFinite(L.c)) L.c = compsPackage(e, k);
  if (!Number.isFinite(L.t)) L.t = 0;
  return L;
}

/**
 * What the landlord posts, effective: the face less the package. A sitting
 * tenant is offered the same face a new one would be — its landlord's ask.
 *
 * It was offered the face no higher than the comps, "renewal at market". But
 * the comps are the leases that signed on space that was empty, and in a tight
 * market there is little of that: the market for a full building is what its
 * landlord can get, and the tenant's say in it is its options — the runner-up
 * on its broker's shortlist and the cost of moving (`bargain`). Capped at the
 * comps, a full building's ask, which passes its costs through and rises when
 * a tenant has nowhere else to go, never reached a renewal, and the comps
 * themselves were the only way a renewal could move (measured: office rents
 * -24% and sheds -29% against the old rule at LOWER vacancy, 6.9% and 7.0%).
 * A landlord that asks more than its tenant's options are worth loses the
 * tenant at the roll, which is the discipline the cap was standing in for.
 */
export function postedEff(L: LandlordAsk, _e: Econ, _k: Comm, _mkt: number, _sitting: boolean): number {
  return L.a * (1 - L.c);
}

/**
 * WHAT A FIRM THAT TOURED A SUITE WOULD PAY FOR IT, $/sf/yr effective: the
 * rent at which it would rather sign nothing this month and keep looking
 * (worth 0 to it) — its worth of the space less the move, with its taste for
 * the building: joint + post (`bargain`'s surplus at zero). This is what the
 * landlord learns at its door, the commercial guest card: what the firm says
 * the space is worth to it. Its other options are its own broker's business,
 * and they reach the rent where they belong, in the bargain at signing
 * (`bargain`, `contestPrice`). (Measured: a ceiling against the firm's
 * runner-up — the landlord pricing as if it saw every rival's post through
 * each firm's eyes — is Bertrand competition with no cost under it; on seed
 * 11 office effective rent fell 55% in two years at an unchanged 10% vacancy,
 * five of every six tours reporting a ceiling under the building's own post.)
 */
export function tourBudget(o: Option): number {
  return o.joint + o.post;
}

/** The landlord notes a firm that toured its space: its ceiling there, the feet it wanted, the term it would sign. */
export function noteTour(L: LandlordAsk, ceiling: number, sf: number, termM: number): void {
  if (!(ceiling > 0) || !(sf > 0) || !(termM > 0)) return;
  (L.tn ??= []).push(+ceiling.toFixed(3), Math.round(sf), Math.round(termM));
}

/** The landlord notes a letting of its free space: the feet and the effective rent it signed at. */
export function noteLet(L: LandlordAsk, sf: number, eff: number): void {
  if (!(sf > 0) || !(eff > 0)) return;
  (L.ln ??= []).push(Math.round(sf), +eff.toFixed(3));
}

/** Fold this month's door into the book's months, its tours compressed to TOUR_Q points; forget what is older than COMPS_M. */
function foldTours(L: LandlordAsk, m: number, cpi: number, free: boolean): void {
  const tn = L.tn, ln = L.ln;
  delete L.tn; delete L.ln;
  const hist = (L.tc ?? []).filter((h) => h.m > m - COMPS_M);
  let let_ = 0, letE = 0;
  if (ln) for (let i = 0; i + 1 < ln.length; i += 2) { let_ += ln[i]; letE += ln[i] * ln[i + 1]; }
  const rec: TourMonth = { m, i: +cpi.toFixed(5), T: 0, q: [] };
  if (free) rec.f = 1;
  if (let_ > 0) { rec.l = let_; rec.e = +(letE / let_).toFixed(3); }
  if (tn && tn.length) {
    const cards: [number, number, number][] = [];
    for (let i = 0; i + 2 < tn.length; i += 3) cards.push([tn[i], tn[i + 1], tn[i + 2]]);
    cards.sort((p, q) => q[0] - p[0]);
    let sf = 0, T = 0;
    for (const c of cards) { sf += c[1]; T += c[2] * c[1]; }
    const n = Math.min(TOUR_Q, cards.length), q: number[] = [];
    for (let g = 0; g < n; g++) {
      let gs = 0, gb = 0;
      for (let j = Math.floor(g * cards.length / n); j < Math.floor((g + 1) * cards.length / n); j++) { gs += cards[j][1]; gb += cards[j][0] * cards[j][1]; }
      if (gs > 0) q.push(+(gb / gs).toFixed(3), gs);
    }
    if (sf > 0) { rec.T = +(T / sf).toFixed(1); rec.q = q; }
  }
  if (rec.q.length || rec.f || rec.l) hist.push(rec);
  if (hist.length) L.tc = hist; else delete L.tc;
}

/**
 * THE ASK THAT EARNS MOST over a lease, on the book's door: the effective rent
 * p and the months its `free` feet would wait at it. Null when nobody has
 * toured in COMPS_M months — it has nothing to go on.
 *
 * The feet a month that would sign at p are the toured feet whose ceilings
 * reach p, times the share of the toured demand that has actually signed with
 * it: its own lettings over the months it had space, against the toured feet
 * whose ceilings reached what those lettings signed at. A firm that toured
 * and signed down the street was a lead the landlord did not convert — in a
 * glut most of them, since every firm has a runner-up as good; in a shortage
 * few. (The tours alone take every lead for a signer: on seed 11 that left
 * the office cycle in the rent at a fifth of the record's.) With no letting
 * yet in the months it had space it counts half a typical tour's feet — the
 * usual half-count for a rate observed at zero — and with no month of space
 * on the book (space just come to market) the tours stand alone.
 */
export function priceOnTours(L: LandlordAsk, free: number, m: number, cpi: number, stressed: boolean): { p: number; wait: number; top: number } | null {
  const hist = L.tc ?? [];
  if (!hist.length || !(free > 0)) return null;
  const from = m - COMPS_M + 1, months = COMPS_M;
  const pts: { x: number; w: number }[] = [];
  let W = 0, T = 0, nCard = 0, mS = 0, let_ = 0, letE = 0;
  for (const h of hist) {
    if (h.m < from) continue;
    const shift = cpi / Math.max(1e-9, h.i);
    for (let j = 0; j + 1 < h.q.length; j += 2) { pts.push({ x: h.q[j] * shift, w: h.q[j + 1] }); W += h.q[j + 1]; T += h.T * h.q[j + 1]; nCard++; }
    if (h.f || h.l) mS++;
    if (h.l) { let_ += h.l; letE += h.l * (h.e ?? 0) * shift; }
  }
  if (!pts.length || !(W > 0)) return null;
  T /= W;
  pts.sort((p, q) => q.x - p.x);
  // the share of toured demand it converts, at what its lettings signed for (or its post, with none)
  let conv = 1;
  if (mS > 0) {
    const ref = let_ > 0 ? letE / let_ : L.a * (1 - L.c);
    let reach = 0;
    for (const p of pts) if (p.x >= ref) reach += p.w;
    const rate = Math.max(let_, 0.5 * W / nCard) / mS;
    conv = reach > 0 ? rate / (reach / months) : 0;
  }
  const sw = stressed ? STRESS_MOVE : 1;
  let acc = 0, best = -Infinity, bx = pts[pts.length - 1].x, bw = W;
  for (const p of pts) {
    acc += p.w;
    const v = conv > 0 ? p.x * (T - sw * free * months / (acc * conv)) : -Infinity;
    if (v > best) { best = v; bx = p.x; bw = acc; }
  }
  // where even every firm that came would leave its space empty longer than a lease, it prices to the lowest ceiling that came
  if (!(best > 0)) { bx = pts[pts.length - 1].x; bw = W; }
  return { p: bx, wait: conv > 0 ? free * months / (bw * conv) : T, top: pts[0].x };
}

/**
 * ONE MONTH OF A LANDLORD'S BOOK on one kind of space. With space to let, it
 * prices on its tours (`priceOnTours`): the package first, the face second
 * (see above). With nothing to let, the face passes its costs through (the
 * town's CPI over the year) and waits for its own leasing to say more; it
 * does not chase the comps (the comps are the buildings that let, and a full
 * building chasing them up ratchets every good corner's raise onto the whole
 * town — measured: shop rents rising 3.5% a year over 18% vacancy), and the
 * package — given to win a tenant for empty space — is not offered, and fades
 * over the year a broker's opinion takes to refresh. In the opening's years
 * (`holdFace`) the town is grown on an economy held still: only the package
 * moves.
 */
export function reviewAsk(L: LandlordAsk, e: Econ, k: Comm, mkt: number, opts: { m: number; free: number; stressed: boolean; infl12: number; holdFace?: boolean }): void {
  if (L.m >= opts.m) return;
  const months = Math.max(1, Math.min(12, opts.m - L.m));
  L.m = opts.m;
  const cpi = e.cpi ?? 1;
  foldTours(L, opts.m, cpi, opts.free > 0);
  if (!(L.a > 0) || !Number.isFinite(L.a)) { const comps = compsFace(e, mkt, k); L.a = comps > 0 ? comps : 1; }
  if (opts.free > 0) {
    const r = priceOnTours(L, opts.free, opts.m, cpi, opts.stressed);
    if (!r) return;                                   // nobody toured in a year: nothing to go on, the ask stands
    L.t = +r.wait.toFixed(2);
    if (opts.holdFace) { L.c = Math.max(0, Math.min(PKG_MAX, 1 - r.p / L.a)); return; }
    const c = 1 - r.p / r.top;
    if (c > PKG_MAX) { L.a = +(r.p / (1 - PKG_MAX)).toFixed(2); L.c = PKG_MAX; }
    else { L.a = +r.top.toFixed(2); L.c = c; }
    return;
  }
  L.c = Math.max(0, L.c * (1 - Math.min(1, months / COMPS_M)));
  L.a = +(L.a * Math.exp((opts.infl12 / 12) * months)).toFixed(2);
}

/**
 * WHAT THE LANDLORD WILL GO TO for a tenant with somewhere else to go: its
 * posted effective rent less what it expects to lose by waiting for the next
 * tenant instead — the months its own tours say its space waits at its ask
 * (plus the make-ready when the tenant would leave a suite it is sitting in),
 * spread over the term — and less again when it needs the cash.
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

/**
 * The month's location context, built once a month per state. `memo` false
 * builds it without leaving it behind — for a read that must change nothing
 * (a valuation), since which moment of the month the context is first built
 * at is otherwise part of what the month does.
 */
export function locCtx(s: GameState, recOf: (bbl: string) => ParcelRecord | null | undefined, memo = true): LocCtx {
  const hit = CTX.get(s);
  if (hit && hit.m === s.month) return hit;
  const at = new Map<number, [number, number]>();
  const heads = new Map<number, number>();
  const place = (t: Tenant, bbl: string) => {
    if (t.fid === undefined || t.use === "multifamily") return;
    const rec = recOf(bbl);
    const p = rec ? posOf(rec) : null;
    if (p) at.set(t.fid, p);
    heads.set(t.fid, tenantHeads(t));
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
  // (a save that went through JSON holds its link columns as plain {"0": ...}
  // objects until economy.ts reviveLinks mends them, which may be later in the
  // month than this read: read either form, or a loaded game forgets its links
  // for a month and parts from the running one — economy.mjs's JSON replay)
  const lk = E?.lk as unknown as { s?: ArrayLike<number> | Record<string, number>; c?: ArrayLike<number> | Record<string, number> } | undefined;
  const col = (v: ArrayLike<number> | Record<string, number>): ArrayLike<number> => ArrayBuffer.isView(v) || Array.isArray(v) ? v as ArrayLike<number> : Object.values(v);
  if (lk?.s && lk.c) {
    const S = col(lk.s), C = col(lk.c);
    for (let l = 0; l < S.length; l++) {
      const a = S[l], b = C[l];
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
  if (memo) CTX.set(s, ctx);
  return ctx;
}

/** A firm's cost of an hour of its people's time: its payroll over its heads (its own books), else its trade's share of sales at the town's reference. */
export function hourCost(t: Tenant): number {
  const heads = Math.max(0.5, tenantHeads(t));
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
  /** the building's market rent (effective, read-out), and a shop's walk-ins on it (`footFactor`) */
  mkt: number; ff: number;
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
export function worthOf(t: Tenant, k: Comm, mkt: number, sc: number, take: number, distCostYr: number, footRel?: number, capacity = 1): number {
  const fit = tenantQualityTerms(t.quality ?? sc, sc).rent;
  // `capacity`: what the firm's trade can pay against what the market asks (tenantBooks.ts rentCapacity)
  return mkt * capacity * fit * footFactor(k, footRel) - distCostYr / Math.max(1, take);
}
/**
 * A SHOP'S WALK-INS against what its address's rent already charges for, as a
 * multiple of what the space is worth: half the trade is the walking
 * catchment (streetRolls.ts CATCHMENT), so sales — and what a shop can pay —
 * move with the square root of its walk-ins [K: the same elasticity]. Read
 * the same way when a comp is normalised (`recordLease`), so a good corner's
 * rent is the corner's, not the town's.
 */
export function footFactor(k: Comm, footRel?: number): number {
  return k === "retail" && footRel !== undefined && footRel > 0 ? Math.pow(Math.max(0.25, Math.min(4, footRel)), 0.5) : 1;
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
  // THE FIRM'S CEILING HERE: the rent r at which it is as well off as at the
  // runner-up at that landlord's reservation. Its surplus here at r is
  // joint_best + post_best - r; at the runner-up gone to its reservation,
  // joint_second + post_second - res_second. Equal at
  // r = post_best + (joint_best - joint_second) - (post_second - res_second).
  // The last term was ADDED (REAL_ECONOMY_PLAN 2.5, 2026-11-05): a hungrier
  // runner-up RAISED the firm's ceiling, so the ceiling sat over the post and
  // every street deal signed at the post — while offerForPlayer, with the
  // sign right, priced the player's tenants against a discount no street
  // landlord ever gave (a sitting tenant's renewal letter at a median 0.61x
  // the player's market in a 20-year playthrough; 0 renewals).
  const rMax = best.post + (best.joint - second.joint) - (second.post - second.res);
  return Math.max(best.res, Math.min(best.post, (best.res + rMax) / 2));
}

/**
 * THE MOST A FIRM WILL OFFER FOR AN OPTION when other firms want the same
 * space: the rent at which it is no better off here than at its runner-up at
 * the runner-up's post — or, with no runner-up worth having, than with no
 * space this month (it keeps looking: worth 0 to it) — so its ceiling is the
 * post plus how much more it likes this suite than its next-best thing. Never
 * under what it would bargain to anyway (`bargain`). The counterpart of
 * `bargain`'s outside option, from the tenant's side; nothing new is assumed.
 */
export function bidCeiling(best: Option, alt: Option | undefined, offer: number): number {
  return Math.max(offer, best.post + best.joint - Math.max(0, alt?.joint ?? 0));
}

/**
 * COMPETING PROPOSALS. Several firms that toured the same space each put in a
 * proposal; the landlord takes the best and runs a "best and final" round, so
 * the firm it signs pays what it bargained (`offer`) or, when it beat a firm
 * the landlord had to turn away, enough to beat that firm's best — never more
 * than its own ceiling. That is an English auction's price: the winner pays
 * the loser's ceiling (Vickrey 1961; in leasing, the "multiple offers" market
 * brokers report in tight markets, where face rents rise and concessions
 * burn off — CBRE / JLL / Cushman tenant-rep commentary 2021-22 on industrial
 * and 2014-15 on Manhattan retail).
 */
export function contestPrice(offer: number, ceiling: number, turnedDown: number): number {
  return Math.min(ceiling, Math.max(offer, turnedDown));
}

/**
 * THE LANDLORD LEARNS FROM THE OFFERS IT TURNED DOWN. A landlord that had to
 * turn firms away has seen what its space fetches: the deal it just signed,
 * which beat them. When that is above what it posts, its next suite is posted
 * there — the package taken back first (a landlord with several proposals
 * stops offering free rent and fit-out), then the face raised to it. This is
 * the price the contest set, not a step: no gain is chosen. In the opening's
 * years the face holds, as in `reviewAsk`.
 */
export function noteContest(L: LandlordAsk, cleared: number, holdFace = false): void {
  if (!(cleared > 0) || !(L.a > 0) || cleared <= L.a * (1 - L.c)) return;
  const c = 1 - cleared / L.a;
  if (c >= 0) { L.c = Math.min(L.c, c); return; }
  L.c = 0;
  if (!holdFace) L.a = +cleared.toFixed(2);
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
  // NEW LEASES ARE THE MARKET; renewals follow it. A renewal is priced off the
  // comps (a sitting tenant is offered market), so counting it in the market
  // it was priced from weighs the index toward itself — measured, it halved
  // how fast rents rose in a tight market. Renewals count only where too few
  // new leases signed to say anything (MIN_NEW).
  let nNew = 0;
  for (const c of list) if (!c.r) nNew++;
  const useNew = nNew >= MIN_NEW;
  let sf = 0, f = 0, ef = 0, n = 0;
  for (const c of list) { if (useNew && c.r) continue; sf += c.sf; f += c.f * c.sf; ef += c.e * c.sf; n++; }
  if (!(sf > 0)) return null;
  const face = f / sf, eff = ef / sf;
  return { face, eff, conc: Math.max(0, Math.min(1, (1 - eff / Math.max(1e-9, face)) / CONC_DEPTH)), sf, n };
}
/** New leases in the window below which renewals count in the read-out too [K]. */
const MIN_NEW = 3;

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

// ---------------------------------------------------------------- a firm's covenant

/**
 * A FIRM'S COVENANT IS MOSTLY ITS SIZE. An investment-grade name sells to
 * thousands of customers in several lines; a small unrated shop to a handful
 * (tenantBooks.ts Z_GRADE: sales volatility falls steeply with size — Comin &
 * Philippon 2005; Davis et al. 2006). On the street the largest firms hold
 * about 30% of a class's let space as investment-grade names, the next 45% are
 * mid-market and the smallest 25% weak (tenantBooks.ts STREET_GRADE_SF). So a
 * firm's grade is where its floor sits in the class's requirement
 * distribution (plates.ts SIZE_DIST, log-normal): above the size whose
 * larger firms hold 30% of the feet it is a grade-2 name, above the size
 * whose larger firms hold 75% a grade-1 [D: ln x = mu + sigma (sigma + z),
 * z = 0.524 and -0.674]. This replaced a draw on the building's score.
 */
export function creditOfSize(k: Comm, sf: number): Credit {
  const d = SIZE_DIST[k];
  const lx = Math.log(Math.max(1, sf));
  if (lx >= d.mu + d.sigma * (d.sigma + 0.524)) return 2;
  if (lx >= d.mu + d.sigma * (d.sigma - 0.674)) return 1;
  return 0;
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
