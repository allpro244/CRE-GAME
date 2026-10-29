// NAMED GENERAL CONTRACTORS (ONE_ECONOMY_PLAN.md step 8; FORMULA_LEDGER item 16).
//
// The construction cost index was inputs x (1 + a bid premium), and the
// premium was an equation of the town's crew utilisation: a number set from
// the top. Now a handful of named general contractors hold the town's crews
// between them, each with its own backlog, its own capital and its own
// overhead. Every job that breaks ground — yours, a rival's, the street's —
// goes out to tender, each contractor bids it from its OWN order book and
// the input costs of the day, the lowest bid wins, and the city's cost index
// is the average of the winning bids. A contractor that won too much in a
// boom carries a crew it cannot feed when the work dries up, bids under cost
// to keep it, loses money and fails; its jobs are re-tendered and its men
// leave the trade.
//
// WHAT A BID IS. Direct cost (the inputs: on-site labour at the town's wage,
// less what the trades learn; materials at the nation's prices and its oil)
// times one plus the contractor's markup:
//
//   markup = OHP + BID_SLOPE x (its utilisation with this job - 1) + its estimate's error
//
//   OHP        0.12  overhead and profit at a fully booked book: GC general
//                    conditions plus fee run 10-15% of direct cost (RSMeans
//                    O&P) [S]
//   BID_SLOPE  0.35  the markup per unit of excess utilisation — the same
//                    calibration the bid premium carried (market.ts, the
//                    2009-11 and 2021-22 anchors: bids 10-15% under cost in a
//                    lull, 15-30% over in a boom) [K, calibrated]
//   BID_SD     0.06  one contractor's estimate against another's on the same
//                    drawings: the coefficient of variation of bids on a
//                    tender is about 6-8% (Skitmore 1991; Ballesteros-Pérez
//                    et al. 2013) [S]
//
// The index is the average winning markup over about eight months (bids
// reprice on every tender; the Turner and Rider Levett Bucknall indices are
// built from a quarter's bids), and each month the contractors also quote one
// standard reference job — the tender an index survey prices — so a month
// with no awards still has a price.
//
// THE MONEY. A contractor earns its winning markup on the work it puts in
// place each month (the contract value spread over the build), the index
// markup on its share of repair and fit-out (45% of construction work,
// dev.ts MAINTENANCE_SHARE), and pays a fixed overhead of OVERHEAD on what its
// crews could bill at full employment [S: CFMA's annual survey, GC general
// and administrative ~3-4% of revenue; net margins 2-3%]. It opens with
// capital of a tenth of a year's capacity [S: surety underwriting, bonding
// capacity 10-20x working capital]. Under nothing, it fails. The player's
// money moves only through the player's own job budget (the change-order
// path, dev.ts), so `conserve` sees every dollar; contractors' books are
// their own, like a rival's.
//
// [S] a fact with a source, [D] derived, [K] a shape parameter (CLAUDE.md).
import type { BuiltClass, Econ, GameState } from "./types";
import { BUILT_CLASSES } from "./types";
import { HARD_COST_PSF, SOFT_COST, CONTINGENCY } from "./value";
import { pushNewsPublic } from "./market";
import { why, whyNation } from "./why";

const OHP = 0.12, BID_SLOPE = 0.35, BID_SD = 0.06;
const OVERHEAD = 0.035;
const CAPITAL_YEARS = 0.10;
/** How fast the index follows its winning bids: an eight-month memory [K]. */
const INDEX_RHO = 0.12;
/** Crews a contractor's share drifts toward its share of the work over, months [K: crews follow the order book over about two years]. */
const SHARE_TAU_M = 24;
/** A failed contractor's crews: half find another contractor, half leave the trade (US construction lost ~30% of its workforce 2006-11) [K]. */
const CREW_LEAVE = 0.5;
/** How many general contractors a town like this carries, and the most a newcomer starts with. */
const N_GC = 5, ENTRANT_SHARE = 0.08;
/** The floor area of a typical job (dev.ts TYPICAL_SF): one crew-load. */
export const GC_JOB_SF = 26_000;
/** A typical job's months in the ground (BUILD_MONTHS, stock-weighted). */
const JOB_MONTHS = 24;

const NAMES = [
  "Halloran Construction", "Brightman & Vane Builders", "Okafor General Contracting", "Castellan Building Co.",
  "Pruitt-Mercer Construction", "Sandoval Brothers", "Northgate Builders", "Whitcombe & Daly",
  "Lindqvist Construction", "Abernathy Structures", "Ferro Brothers Contracting", "Tallis Building Group",
];

export interface Contractor {
  id: number;
  name: string;
  /** its share of the town's construction workforce */
  share: number;
  /** capital, in the town's dollars */
  cash: number;
  foundedM: number;
  failedM?: number;
  /** jobs won, ever */
  won: number;
}
export interface ContractorBook {
  firms: Contractor[];
  /** the index's markup: the average winning bid over direct cost, smoothed */
  idx: number;
  seq: number;
  /** months since the last entrant, so a crowd does not arrive at once */
  lastEntryM: number;
  /** crews that left the trade with a failure this month (read by tickCrews) */
  crewLoss: number;
  /** this month's winning bids, for the page and probes */
  last?: { m: number; bids: { who: string; gc: string; markup: number; sf: number }[] };
}

type Job = { bbl: string; sf: number; startM: number; deliverM: number; use?: string; gc?: number; gcBid?: number; orphaned?: boolean };

/** A deterministic standard normal from a key: no stream is drawn, so tendering moves no other draw. */
function hashNormal(key: string): number {
  let h1 = 2166136261, h2 = 0x9e3779b9;
  for (let i = 0; i < key.length; i++) { const c = key.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ c, 0x85ebca6b); }
  const u1 = ((h1 >>> 0) + 0.5) / 4294967296, u2 = ((h2 >>> 0) + 0.5) / 4294967296;
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
function hash01(key: string): number { return 0.5 + 0.5 * Math.tanh(hashNormal(key)); }

/** The hard share of an all-in construction budget. */
const HARD_SHARE = 1 / ((1 + SOFT_COST) * (1 + CONTINGENCY));

function book(s: GameState): ContractorBook {
  const e = s.econ;
  if (e.gcs) return e.gcs;
  const firms: Contractor[] = [];
  const unit = crewMonthValue(e);
  for (let i = 0; i < N_GC; i++) {
    // Unequal from the start: the biggest builder in a town holds a quarter
    // or so of the work, the smallest a tenth (ENR's top-contractor lists by
    // metro) [K].
    const w = 1 / (i + 1.6);
    firms.push({ id: i + 1, name: NAMES[Math.floor(hash01(`${s.seed}|gc|${i}`) * NAMES.length)], share: w, cash: 0, foundedM: s.month, won: 0 });
  }
  // distinct names
  const used = new Set<string>();
  for (const f of firms) { let k = 0; while (used.has(f.name)) f.name = NAMES[(NAMES.indexOf(f.name) + ++k) % NAMES.length]; used.add(f.name); }
  const tot = firms.reduce((a, f) => a + f.share, 0);
  const cap = workforce(e);
  for (const f of firms) { f.share /= tot; f.cash = CAPITAL_YEARS * 12 * f.share * cap * unit; }
  e.gcs = { firms, idx: NaN, seq: N_GC, lastEntryM: s.month, crewLoss: 0 };
  return e.gcs;
}

/** What one crew bills in a month at direct cost: a typical job's hard cost over its months in the ground. */
function crewMonthValue(e: Econ): number {
  return GC_JOB_SF * HARD_COST_PSF.office * (e.costInputIdx ?? e.costIdx ?? 1) / JOB_MONTHS;
}
/** The town's construction workforce, in crew-loads (dev.ts tickCrews). */
function workforce(e: Econ): number { return Math.max(1, e.crewWorkforce ?? 10); }
/** Work every contractor is pricing against that is not a job of its own: its share of the repair and fit-out load and of the orders queued for a crew (dev.ts tickCrews). */
function steady(e: Econ): number { return Math.max(0, (e.crewSteady ?? 0) + (e.crewOwed ?? 0)); }

function liveJobs(s: GameState): { job: Job; who: "player" | "firm" | "street" }[] {
  const out: { job: Job; who: "player" | "firm" | "street" }[] = [];
  for (const d of Object.values(s.developments ?? {})) out.push({ job: d as unknown as Job, who: "player" });
  for (const j of s.cityJobs ?? []) if (!j.orphaned) out.push({ job: j as Job, who: (j as { firmId?: string }).firmId ? "firm" : "street" });
  return out;
}
const loadOf = (j: Job) => Math.max(0, j.sf ?? 0) / GC_JOB_SF;

/** Each live contractor's book this month, in crew-loads: its share of the repair work and the queue, plus the jobs it holds. */
function backlogs(s: GameState, B: ContractorBook): Map<number, number> {
  const st = steady(s.econ);
  const m = new Map<number, number>();
  for (const f of B.firms) if (f.failedM === undefined) m.set(f.id, f.share * st);
  for (const { job } of liveJobs(s)) if (job.gc !== undefined && m.has(job.gc)) m.set(job.gc, m.get(job.gc)! + loadOf(job));
  return m;
}

/** One contractor's markup on a job of `load`, given its book. */
function markup(f: Contractor, booked: number, load: number, cap: number, key: string): number {
  const u = (booked + load) / Math.max(1e-6, f.share * cap);
  return OHP + BID_SLOPE * (u - 1) + BID_SD * hashNormal(key);
}

/**
 * THE MONTH: tender what broke ground, the reference quote, the index, the
 * contractors' books, failures and entrants. Returns the index markup; the
 * cost index is the input index times one plus it (market.ts).
 */
export function tickContractors(s: GameState): number {
  const e = s.econ;
  const B = book(s);
  const cap = workforce(e);
  const live = B.firms.filter((f) => f.failedM === undefined);
  const booked = backlogs(s, B);
  const unit = crewMonthValue(e);
  const bids: { who: string; gc: string; markup: number; sf: number; w: number }[] = [];

  // ---- the tenders: every job that broke ground and has no contractor
  for (const { job, who } of liveJobs(s)) {
    if (job.gc !== undefined && live.some((f) => f.id === job.gc)) continue;
    const load = loadOf(job);
    let best: Contractor | undefined, bm = Infinity;
    for (const f of live) {
      const m = markup(f, booked.get(f.id) ?? 0, load, cap, `${s.seed}|bid|${job.bbl}|${job.startM}|${f.id}|${s.month}`);
      if (m < bm) { bm = m; best = f; }
    }
    if (!best) break;
    const reTender = job.gc !== undefined;
    const prevBid = job.gcBid;
    job.gc = best.id; job.gcBid = bm;
    best.won++;
    booked.set(best.id, (booked.get(best.id) ?? 0) + load);
    bids.push({ who, gc: best.name, markup: bm, sf: job.sf, w: load });
    if (who === "player") awardPlayer(s, job as unknown as PlayerJob, best, bm, reTender, prevBid);
    else if (who === "firm") awardFirm(job as Job & { cost?: number; spent?: number }, bm, B.idx, reTender, prevBid);
  }
  // ---- the reference tender: one standard job, quoted, not built
  let ref = Infinity;
  for (const f of live) ref = Math.min(ref, markup(f, booked.get(f.id) ?? 0, 1, cap, `${s.seed}|ref|${s.month}|${f.id}`));
  if (!Number.isFinite(ref)) ref = OHP;
  const wSum = bids.reduce((a, b) => a + b.w, 0) + 1;
  const monthMarkup = (bids.reduce((a, b) => a + b.w * b.markup, 0) + ref) / wSum;
  B.idx = Number.isFinite(B.idx) ? B.idx + INDEX_RHO * (monthMarkup - B.idx) : monthMarkup;
  B.last = { m: s.month, bids: bids.map(({ w, ...b }) => { void w; return b; }) };

  // ---- the contractors' books
  const work = new Map<number, number>();
  for (const { job } of liveJobs(s)) {
    if (job.gc === undefined) continue;
    const months = Math.max(1, (job.deliverM ?? s.month + JOB_MONTHS) - job.startM);
    // the month's work in place, in crew-months, at the markup it won at
    work.set(job.gc, (work.get(job.gc) ?? 0) + loadOf(job) * JOB_MONTHS / months * (job.gcBid ?? B.idx));
  }
  let shareWork = 0;
  const tot = [...booked.values()].reduce((a, b) => a + b, 0);
  B.crewLoss = 0;
  for (const f of live) {
    const profitCrewMonths = (work.get(f.id) ?? 0) + B.idx * f.share * (e.crewSteady ?? 0) - OVERHEAD * f.share * cap;
    f.cash += profitCrewMonths * unit;
    // Crews follow the work: a contractor winning more than its share hires.
    const want = tot > 0 ? (booked.get(f.id) ?? 0) / tot : f.share;
    f.share += (want - f.share) / SHARE_TAU_M;
    shareWork += f.share;
  }
  for (const f of live) f.share /= Math.max(1e-9, shareWork);
  // ---- failures
  for (const f of live) {
    if (f.cash >= 0) continue;
    fail(s, B, f);
  }
  // ---- an entrant, when the work is there and the town is short a builder
  const alive = B.firms.filter((f) => f.failedM === undefined);
  const util = (tot) / Math.max(1e-6, cap);
  if (alive.length < N_GC && util > 0.9 && s.month - B.lastEntryM >= 6) {
    B.seq++;
    const used = new Set(B.firms.map((f) => f.name));
    let name = NAMES[Math.floor(hash01(`${s.seed}|gcname|${B.seq}`) * NAMES.length)];
    for (let k = 1; used.has(name) && k < NAMES.length; k++) name = NAMES[(NAMES.indexOf(name) + 1) % NAMES.length];
    if (used.has(name)) name = `${name.split(" ")[0]} & Sons ${B.seq}`;
    const nf: Contractor = { id: B.seq, name, share: ENTRANT_SHARE, cash: 0, foundedM: s.month, won: 0 };
    for (const f of alive) f.share *= 1 - ENTRANT_SHARE;
    nf.cash = CAPITAL_YEARS * 12 * nf.share * cap * unit;
    B.firms.push(nf);
    B.lastEntryM = s.month;
    pushNewsPublic(s, "info", `${name} has opened as a general contractor in town, hiring crews away from a booked-up trade.`,
      why(s, { k: "contractor.entered", a: "firm", name, n: { util }, t: `${name} entered · the trades ${Math.round(util * 100)}% booked` }));
  }
  // keep the book small: drop the long-failed
  B.firms = B.firms.filter((f) => f.failedM === undefined || s.month - f.failedM < 120);
  return B.idx;
}

type PlayerJob = { bbl: string; hardCost: number; costTotal: number; contingency: number; contingencyUsed: number; equityBudget: number; deliverM: number; startM: number; events?: number; gc?: number; gcBid?: number };

/**
 * YOUR JOB'S PRICE IS ITS OWN BID. The plan was priced at the index — the
 * average winning bid — and the contract is the bid this job actually won:
 * above the index, the difference is a change order (contingency first, then
 * your equity); below it, buyout savings go into the contingency, which comes
 * back to you at delivery if unspent. Both move money only through the
 * budget the draws already book.
 */
function awardPlayer(s: GameState, d: PlayerJob, f: Contractor, bm: number, reTender: boolean, prevBid?: number) {
  const ref = reTender ? (prevBid ?? s.econ.gcs!.idx) : s.econ.gcs!.idx;
  const ratio = (1 + bm) / (1 + (Number.isFinite(ref) ? ref : bm)) - 1;
  // A re-tender prices only what is left to build.
  const span = Math.max(1, d.deliverM - d.startM);
  const left = reTender ? Math.max(0, 1 - (s.month - d.startM) / span) : 1;
  const delta = Math.round(d.hardCost * left * ratio);
  if (delta > 0) {
    const fromC = Math.min(Math.max(0, d.contingency - d.contingencyUsed), delta);
    d.contingencyUsed += fromC;
    const over = delta - fromC;
    d.costTotal += over; d.hardCost += over; d.equityBudget += over;
  } else if (delta < 0) {
    d.contingency += -delta;
  }
  const id = why(s, {
    k: reTender ? "contractor.retender" : "contractor.award", a: "firm", name: f.name, bbl: d.bbl,
    n: { markup: bm, index: ref, delta },
    t: `${f.name} won your job at ${(bm * 100).toFixed(1)}% over direct cost · index ${(ref * 100).toFixed(1)}% · ${delta >= 0 ? "+" : "−"}$${Math.abs(Math.round(delta / 1000))}k`,
  }, [whyTrades(s)]);
  s.news.unshift({
    q: s.month, kind: delta > 0 ? "warn" : "info", why: id,
    text: reTender
      ? `Re-tendered · ${f.name} takes over the job at ${d.bbl ? "your site" : ""} after its contractor failed · ${delta > 0 ? `$${Math.round(delta / 1000)}k more to finish` : "at no extra cost"}.`
      : `Contract awarded · ${f.name} is building your job, ${delta >= 0 ? `$${Math.round(delta / 1000)}k over` : `$${Math.round(-delta / 1000)}k under`} the estimate (its bid against the market's).`,
  });
}

/** A firm's job is priced at its own bid the same way: its budget moves by the hard-cost difference. */
function awardFirm(j: Job & { cost?: number; spent?: number }, bm: number, idx: number, reTender: boolean, prevBid?: number) {
  if (!(j.cost ?? 0)) return;
  const ref = reTender ? (prevBid ?? idx) : idx;
  if (!Number.isFinite(ref)) return;
  const toFinish = Math.max(0, j.cost! - (j.spent ?? 0));
  j.cost = Math.round((j.spent ?? 0) + toFinish * (1 + HARD_SHARE * ((1 + bm) / (1 + ref) - 1)));
}

/** The trades' month as a cause: how booked they are and the index markup. */
function whyTrades(s: GameState): number {
  const B = s.econ.gcs;
  return why(s, {
    k: "construction.month", a: "trade", name: "construction",
    n: { util: s.econ.crewUtil ?? 1, markup: B?.idx ?? 0, contractors: B?.firms.filter((f) => f.failedM === undefined).length ?? 0 },
    t: `Construction trades ${Math.round((s.econ.crewUtil ?? 1) * 100)}% booked · winning bids ${((B?.idx ?? 0) * 100).toFixed(1)}% over direct cost`,
  }, [whyNation(s)]);
}

/** A contractor runs out of capital: its jobs go back out to tender, half its crews leave the trade. */
function fail(s: GameState, B: ContractorBook, f: Contractor) {
  f.failedM = s.month;
  B.crewLoss += f.share * CREW_LEAVE;
  const share = f.share;
  f.share = 0;
  const rest = B.firms.filter((x) => x.failedM === undefined);
  const rs = rest.reduce((a, x) => a + x.share, 0);
  for (const x of rest) x.share = rs > 0 ? x.share / rs : 1 / rest.length;
  const mine: string[] = [];
  for (const { job, who } of liveJobs(s)) {
    if (job.gc !== f.id) continue;
    if (who === "player") {
      // THE SURETY PAYS, THE CALENDAR DOES NOT. A performance bond funds the
      // cost to complete over the contract, but finding and mobilising a
      // completion contractor takes months: two to five here [S: surety
      // industry, takeover after default 60-150 days].
      const d = job as unknown as PlayerJob & { deliverM: number };
      d.deliverM += 2 + Math.round(3 * hash01(`${s.seed}|gcfail|${f.id}|${job.bbl}`));
      d.events = (d.events ?? 0) + 1;
      mine.push(job.bbl);
    }
  }
  const id = why(s, {
    k: "contractor.failed", a: "firm", name: f.name,
    n: { share, cash: Math.round(f.cash), workforceLost: share * CREW_LEAVE },
    t: `${f.name} failed · ran out of capital carrying ${Math.round(share * 100)}% of the town's crews`,
  }, [whyTrades(s)]);
  pushNewsPublic(s, mine.length ? "warn" : "info",
    `${f.name}, the general contractor, has failed: it took on crews for a boom and could not feed them once the work dried up. Its jobs go back out to tender${mine.length ? ", yours among them — expect a delay while the surety finds a completion contractor" : ""}.`, id);
}

/** For pages and probes. */
export function contractorsOf(e: Econ): Contractor[] { return (e.gcs?.firms ?? []).filter((f) => f.failedM === undefined); }
export const GC_BUILT: readonly BuiltClass[] = BUILT_CLASSES;
