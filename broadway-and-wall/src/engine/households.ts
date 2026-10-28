// THE HOUSEHOLD REGISTER — STAGE 1, A SHADOW (2026-10-28).
//
// The town's housing demand is an aggregate: `hhIdx` (adults against the
// opening), `tenureIdx` (renting against owning), a budget share and a
// minimum flat (market.ts, the multifamily branch of `affordRaw`). Every one
// of those is a statement about households that no household in the engine
// ever made. This file holds the households themselves: every renter
// household on the island one for one, and a sample of the region's other
// households (owners, renters across the water, families doubled up) each
// standing for `wRegion` of its kind. Each has an age, a family, a home and a
// lease or a mortgage, up to two earners with an employer and a wage, savings,
// card debt at its own rate, and a credit record that remembers arrears.
//
// STAGE 1 IS A SHADOW. Nothing in the world reads this register yet. It is
// seeded from the opening and ticked every month after the town's renters
// have moved (sim.ts, after tickStreetFlats), it follows the aggregates the
// engine already keeps — the flats let in each block, the region's
// households, the town's jobless rate, its wage index — and it draws on its
// own random stream (`s.streams.households`), so the world it shadows is byte
// for byte the world without it (BASELINE.json does not move). Stage 2 turns
// it round: the flats' occupancy, MF absorption and the tenure margin read
// the register instead of the indices it now copies. `householdStats` is the
// read stage 2 starts from, and `tools/households.mjs` holds the two answers
// against each other until then.
//
// STORAGE is struct-of-arrays (typed arrays, one per field), so a month over
// ten thousand households is a few milliseconds and a save is a few hundred
// kilobytes. A save carries the arrays as base64 (`packHouseholdsForSave`);
// `migrateSaveState` unpacks them.
//
// Constants carry [S] when they are a measured fact with a source and [K] when
// they are a shape parameter, stated as such (CLAUDE.md).
import type { ParcelTable } from "@/data/types";
import type { Econ, GameState } from "./types";
import { SF_PER_JOB, HH_RENT_SHARE0, shortIndexOf } from "./market";
import { resolveRecBare, useRentableSf } from "./value";
import { flatUnitSf } from "./streetRolls";
import { HH_SIZE, INCOME_SIGMA, TAX_INS, medianIncome, mortgageRate } from "./homeprice";

// ---------------------------------------------------------------- codes
/** Tenure. */
export const TEN_RENT = 0;      // renting a flat on the island (a block in `blocks`)
export const TEN_OWN = 1;       // owning, somewhere in the region
export const TEN_DOUBLED = 2;   // doubled up with family or friends: no rent of its own
export const TEN_MAINLAND = 3;  // renting across the water
/** An earner slot's employer. A firm's id (`Tenant.fid`) is >= 0. */
export const EMP_NONE = -1;     // no earner in this slot
export const EMP_UNEMP = -2;    // in the labour force, out of work
export const EMP_OTHER = -3;    // working: the public sector, the mainland, a firm the street does not keep
export const EMP_RETIRED = -4;  // a pension (Social Security), not a wage

// ---------------------------------------------------------------- the facts
/** The region's sample: about 2,000 households, each standing for its share of the rest. */
export const REGION_N = 2000;
/** Over this many agents in all, the island's renters are kept two to an agent. */
export const MAX_AGENTS = 10_000;
/** US homeownership rate, 2024: 65.6% of households own (Census HVS). [S] */
const OWN_RATE = 0.656;
/** Share of owner households with a mortgage: 62% (ACS 2023, B25081). [S] */
const MORTGAGED = 0.62;
/** Renters who move in a year: about 45% (NMHC; Census AHS) — the share of leases that end in a move. [S] */
const RENTER_MOVE = 0.45;
/** Monthly employed-to-unemployed flow, about 1.4% (BLS CPS labour-force flows, 2015-19 average). [S] */
const SEP_RATE = 0.014;
/** Unemployment insurance: about 45% of the lost wage for 26 weeks (US DOL, average replacement rate). [S] */
const UI_REPLACE = 0.45, UI_MONTHS = 6;
/** Social Security replaces about 40% of a medium earner's pay (SSA, scheduled benefits). [S] */
const SS_REPLACE = 0.40;
/** Card minimum payment: interest plus 1% of the balance (the standard issuer formula, CFPB). [S] */
const MIN_PRINCIPAL = 0.01;
/**
 * Card APR over the short index by credit band, excellent to poor: prime-based
 * variable rates run about 8 to 24 points over the policy rate (Fed G.19 and
 * CFPB card agreements, 2023-24). [S]
 */
const CARD_SPREAD = [0.08, 0.13, 0.19, 0.24];
/** A card limit as a share of annual income by band (CFPB card-market report: prime about 30%, deep subprime a few points). [S] */
const CARD_LIMIT = [0.35, 0.25, 0.12, 0.03];
/**
 * BUFFER-STOCK SPENDING (Carroll 1997). A household spends its permanent
 * income less what housing and its card minimum take, plus KAPPA of whatever
 * it holds over a target buffer of some months of that income, never less
 * than the subsistence floor. A monthly KAPPA of 0.05 is an annual MPC out of
 * excess cash near a half (Parker et al. 2013 put rebate MPCs at 0.5-0.9).
 * The buffer is two months of income for a young household (the SCF's median
 * renter liquid holding) rising to six by 65, as liquid saving rises with age
 * in the SCF. Both [K].
 */
const KAPPA = 0.05;
const bufferMonths = (age: number) => 2 + 4 * Math.max(0, Math.min(1, (age - 35) / 30));
/** How fast permanent income learns from this month's: a two-year average. [K] */
const PERM_ROLL = 1 / 24;
/** The 2024 HHS poverty guideline, one person and each further one, in dollars of the reference table. [S] */
const POVERTY_1 = 15_060, POVERTY_ADD = 5_380;
/** The non-housing share of a poverty budget, about 65% (the Orshansky food-multiplier line less shelter, BLS CE). [S] */
const SUBSIST_SHARE = 0.65;
/** Months behind on the rent before an eviction; on a mortgage before a foreclosure completes (Eviction Lab; ATTOM average ~ 9 months to REO in a fast state). [S] */
const EVICT_M = 3, FORECLOSE_M = 9;
/** A household's dissolution hazard past 80, a month: about 7% a year (SSA period life table, 80-90 band). [S] */
const DISSOLVE_M = 0.006;
/** Births per couple-headed household of childbearing age, a month: about 7% a year (CDC NVSS general fertility ~ 55 per 1,000 women 15-44 at 1.3 per household). [K] */
const BIRTH_M = 0.006;
/** A child leaves home, per child per month, once the head is past 45 (Census CPS: most leave between 18 and 26). [K] */
const LEAVE_M = 0.012;
/**
 * AVERAGE TAX RATES BY INCOME QUINTILE — CBO, The Distribution of Household
 * Income 2019: federal (income, payroll, excise) 0.6 / 6.9 / 13.0 / 17.4 /
 * 25.7%, plus about 4% of state and local income and sales taxes (ITEP) — read
 * at each quintile's midpoint of the lognormal income spread. [S]
 */
const TAX_RATES = [0.046, 0.109, 0.170, 0.214, 0.297];
const TAX_Z = [-1.2816, -0.5244, 0, 0.5244, 1.2816];
/** Renter head's age band (<25, 25-34, 35-44, 45-54, 55-64, 65+): ACS 2023 renter-occupied units by householder age. [S] */
const AGE_RENT = [0.11, 0.27, 0.20, 0.15, 0.13, 0.14];
/** All households, same bands (ACS 2023). [S] */
const AGE_ALL = [0.05, 0.16, 0.17, 0.17, 0.19, 0.26];
const AGE_LO = [19, 25, 35, 45, 55, 65], AGE_HI = [24, 34, 44, 54, 64, 85];
/** Adults per household 1/2/3+ (CPS 2024: 28% live alone; about 1.95 adults per household, 3+ adults — grown children, relatives, roommates — about a fifth). [S] */
const ADULTS = [0.28, 0.52, 0.20];
/** Children per household headed by someone 20-59, 0/1/2/3 (CPS 2024: ~0.56 children under 18 per household overall). [S] */
const KIDS = [0.50, 0.20, 0.19, 0.11];

// ---------------------------------------------------------------- the arrays
const FIELDS = {
  id: Uint32Array,
  wt: Float32Array,       // households this agent stands for
  age: Uint8Array,        // head's age, years (its band is ageBand)
  adults: Uint8Array,
  kids: Uint8Array,
  ten: Uint8Array,        // TEN_*
  blk: Int32Array,        // index into `blocks` for an island renter, else -1
  rent: Float32Array,     // a month, town dollars (renters)
  leaseEnd: Int32Array,   // month the lease ends (island renters)
  emp1: Int32Array, wage1: Float32Array, un1: Uint16Array,  // employer, annual wage (or pension, or the lost wage), months unemployed
  emp2: Int32Array, wage2: Float32Array, un2: Uint16Array,
  sav: Float32Array,      // liquid savings
  debt: Float32Array,     // card and other consumer debt
  debtRate: Float32Array, // its APR
  mort: Float32Array,     // mortgage balance
  mortRate: Float32Array,
  mortPmt: Float32Array,  // principal and interest, a month
  hval: Float32Array,     // the house's value (owners)
  arrears: Uint8Array,    // consecutive months short on housing
  credit: Uint8Array,     // band 0 excellent .. 3 poor
  clean: Uint8Array,      // months since the last missed payment (capped)
  yperm: Float32Array,    // permanent net income, a month
} as const;
type FieldName = keyof typeof FIELDS;
export type HouseholdArrays = { [K in FieldName]: InstanceType<(typeof FIELDS)[K]> };
const FIELD_NAMES = Object.keys(FIELDS) as FieldName[];

export interface HouseholdFlows {
  /** Households (weighted) that left an island flat this month: moved, evicted, dissolved. */
  movedOut: number; movedIn: number;
  evictions: number; foreclosures: number;
  /** Weighted spending and net income, a month — what stage 2 hands the shops. */
  spend: number; income: number;
}

export interface HouseholdRegister {
  v: 1;
  /** Agents in use, the arrays' capacity, and the next id to issue. */
  n: number; cap: number; nextId: number;
  /** Weight of an island renter agent (1, or 2 in a town too big to hold one for one) and of a regional agent. */
  wIsland: number; wRegion: number;
  /** The indices last month, so incomes, rents and house values move with the town. */
  wageRef: number; costRef: number; homeRef: number;
  /** The island renters' median income over the town's median, fixed at the opening. */
  renterInc: number;
  /** The flats' effective rent index and the wage index at the opening: the engine's own burden is 30% moved by their ratio. */
  rent0: number; wage0: number;
  /** A mainland flat's rent, a month, today: indexed by construction cost (the mainland's rent anchor, market.ts `locEff`). */
  mainRent: number;
  /** Each island block of flats an agent can point at (bbl), append-only. */
  blocks: string[];
  /** Each street block's flat size: [sf, month read, month last seen] (see blockUnitSf). */
  unitMemo?: Record<string, number[]>;
  /** The month's flows. */
  flow: HouseholdFlows;
  /** The arrays (in memory), or their base64 (in a save). */
  a?: HouseholdArrays;
  packed?: Partial<Record<FieldName, string>>;
}

function alloc(cap: number): HouseholdArrays {
  const a = {} as Record<FieldName, unknown>;
  for (const k of FIELD_NAMES) a[k] = new FIELDS[k](cap);
  return a as HouseholdArrays;
}

function ensureCap(r: HouseholdRegister, need: number) {
  if (need <= r.cap) return;
  let cap = Math.max(64, r.cap);
  while (cap < need) cap *= 2;
  const a = alloc(cap), old = r.a!;
  for (const k of FIELD_NAMES) (a[k] as Uint8Array).set((old[k] as Uint8Array).subarray(0, r.n));
  r.a = a; r.cap = cap;
}

// ---------------------------------------------------------------- the stream
/** The households' stream, seeded from the campaign seed the way initStreams seeds every channel. */
function streamSeed(seed: number): number {
  let h = (2166136261 ^ (seed >>> 0)) >>> 0;
  const ch = "households";
  for (let i = 0; i < ch.length; i++) { h ^= ch.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) || 1;
}
type Rand = { u: () => number; n: () => number; done: () => void };
/** A draw on `s.streams.households` only — never `s.rng` or any other channel. */
function stream(s: GameState): Rand {
  let st = (s.streams?.households ?? streamSeed(s.seed ?? 1)) | 0;
  // mulberry32, step for step market.ts `mulberry32Step` (test/households.mjs
  // holds them equal), inlined so a month's ~50k draws allocate nothing
  const u = () => {
    st = (st + 0x6d2b79f5) | 0;
    let t = Math.imul(st ^ (st >>> 15), 1 | st);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const n = () => { const a = Math.max(1e-12, u()), b = u(); return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b); };
  return { u, n, done: () => { if (s.streams) s.streams.households = st; } };
}
/** The stream's step, exported for the harness that holds it equal to market.ts mulberry32Step. */
export function householdStreamStep(st: number): number {
  const R = stream({ streams: { households: st }, seed: 1 } as unknown as GameState);
  return R.u();
}
const pick = (R: Rand, p: readonly number[]) => { let x = R.u(); for (let i = 0; i < p.length; i++) { x -= p[i]; if (x < 0) return i; } return p.length - 1; };

// ---------------------------------------------------------------- readers
export const ageBand = (age: number) => age < 25 ? 0 : age < 35 ? 1 : age < 45 ? 2 : age < 55 ? 3 : age < 65 ? 4 : 5;

/** The average tax rate on a household's gross income, interpolated across the quintiles. */
export function taxRate(gross: number, e: Econ): number {
  if (!(gross > 0)) return 0;
  const z = Math.log(gross / Math.max(1, medianIncome(e))) / INCOME_SIGMA;
  const zs = TAX_Z;
  if (z <= zs[0]) return TAX_RATES[0];
  if (z >= zs[4]) return TAX_RATES[4];
  let i = 0; while (z > zs[i + 1]) i++;
  return TAX_RATES[i] + (TAX_RATES[i + 1] - TAX_RATES[i]) * (z - zs[i]) / (zs[i + 1] - zs[i]);
}

/** Non-housing subsistence, a month, at the town's prices. */
function subsistence(e: Econ, persons: number): number {
  return SUBSIST_SHARE * (POVERTY_1 + POVERTY_ADD * Math.max(0, persons - 1)) * (e.priceLevel ?? 1) * (e.cpi ?? 1) / 12;
}

type Block = { idx: number; target: number; let: number; unitSf: number };

/**
 * THE ISLAND'S FLATS, AS HOUSEHOLDS: every street block's let flats (its roll,
 * streetRolls.ts) and every flat in the player's blocks (`Holding.occ`), each
 * block's flat size the street's own (`flatUnitSf`), and each block's rent for
 * a flat let this month — its newest lease cohort, or the street's average for
 * a block that has none. Pure: it reads the parcels and the state.
 */
type RawBlock = { bbl: string; units: number; unitSf: number; psf: number | null };
/**
 * A street block's flat size, through the register's memo when it has one.
 * Resolving 2,000 records a month was most of a region month's cost, and a
 * block's flat size changes only when the building does — which takes its
 * roll off the street while it is rebuilt — so a size is re-read when a block
 * was not on the street last month, and otherwise once a year (staggered).
 */
type UnitMemo = Record<string, number[]>;   // bbl -> [flat sf, month read, month last seen]
function blockUnitSf(s: GameState, parcels: ParcelTable, bbl: string, memo?: UnitMemo): number {
  const m = s.month, hit = memo?.[bbl];
  if (hit && hit[2] === m - 1 && m - hit[1] < 12) { hit[2] = m; return hit[0]; }
  const rec = resolveRecBare(parcels, s, bbl);
  const cap = rec ? useRentableSf(rec, "multifamily") : 0;
  const unitSf = rec && cap > 0 ? Math.max(300, flatUnitSf(rec, cap)) : 0;
  if (memo) {
    // stagger the yearly re-reads across the months by the block's name
    let h = 0;
    for (let i = 0; i < bbl.length; i++) h = (h * 31 + bbl.charCodeAt(i)) | 0;
    memo[bbl] = [unitSf, hit ? m : m - (Math.abs(h) % 12), m];
  }
  return unitSf;
}

function rawBlocks(s: GameState, parcels: ParcelTable, memo?: UnitMemo): { raw: RawBlock[]; psfAvg: number } {
  const e = s.econ;
  const raw: RawBlock[] = [];
  let rs = 0, sf = 0;
  for (const [bbl, roll] of Object.entries(e.flatRolls ?? {})) {
    if (!(roll.occ > 0)) continue;
    const unitSf = blockUnitSf(s, parcels, bbl, memo);
    if (!(unitSf > 0)) continue;
    let newest: { rent: number; endM: number } | null = null;
    for (const x of roll.l ?? []) { rs += x.rent * x.sf; sf += x.sf; if (!newest || x.endM > newest.endM) newest = x; }
    raw.push({ bbl, units: roll.occ / unitSf, unitSf, psf: newest ? newest.rent : null });
  }
  const psfAvg = sf > 0 ? rs / sf : 0;
  for (const h of Object.values(s.holdings)) {
    if (h.occ === undefined || !(h.occ > 0)) continue;
    const rec = resolveRecBare(parcels, s, h.bbl);
    if (!rec) continue;
    const cap = useRentableSf(rec, "multifamily");
    if (!(cap > 0)) continue;
    const unitSf = Math.max(300, flatUnitSf(rec, cap));
    raw.push({ bbl: h.bbl, units: h.occ * cap / unitSf, unitSf, psf: null });
  }
  return { raw, psfAvg };
}

/** The island's renter households as the engine's flats count them: every block's let feet over its flat size. Pure. */
export function islandRenterHouseholds(s: GameState, parcels: ParcelTable): number {
  return rawBlocks(s, parcels).raw.reduce((t, x) => t + x.units, 0);
}

function readBlocks(s: GameState, parcels: ParcelTable, r: HouseholdRegister): { list: Block[]; byIdx: Map<number, Block>; psfAvg: number } {
  const ix = new Map<string, number>();
  r.blocks.forEach((b, i) => ix.set(b, i));
  const idxOf = (bbl: string) => { let i = ix.get(bbl); if (i === undefined) { i = r.blocks.length; r.blocks.push(bbl); ix.set(bbl, i); } return i; };
  const memo = (r.unitMemo ??= {});
  const { raw, psfAvg } = rawBlocks(s, parcels, memo);
  for (const k in memo) if (memo[k][2] < s.month) delete memo[k];   // off the street, or let to nobody
  const list: Block[] = [];
  const byIdx = new Map<number, Block>();
  // Each block's households in agents: its let flats over the agent weight,
  // rounded on the running total so the town's sum is exact (rounding block
  // by block lost 8% of a weight-2 region's renters in its one-flat blocks).
  let cum = 0, done = 0;
  for (const x of raw) {
    const psf = x.psf ?? psfAvg;
    cum += x.units / r.wIsland;
    const target = Math.round(cum) - done;
    done += target;
    const b: Block = { idx: idxOf(x.bbl), target, let: (psf * x.unitSf) / 12, unitSf: x.unitSf };
    list.push(b); byIdx.set(b.idx, b);
  }
  return { list, byIdx, psfAvg };
}

/** The town's employers: every firm the street and the player keep, weighted by the jobs its space holds. */
function readFirms(s: GameState): { fid: Int32Array; cum: Float64Array; share: number; live: Set<number> } {
  const w = new Map<number, number>();
  const add = (t: { fid?: number; sf: number; use?: string }) => {
    if (t.fid === undefined) return;
    const per = SF_PER_JOB[(t.use ?? "office") as keyof typeof SF_PER_JOB];
    if (!(per > 0)) return;
    w.set(t.fid, (w.get(t.fid) ?? 0) + t.sf / per);
  };
  for (const roll of Object.values(s.econ.streetRolls ?? {})) for (const t of roll.t) add(t);
  for (const h of Object.values(s.holdings)) for (const t of h.tenants ?? []) add(t);
  const fid = new Int32Array(w.size), cum = new Float64Array(w.size);
  let i = 0, tot = 0;
  for (const [f, x] of w) { tot += x; fid[i] = f; cum[i] = tot; i++; }
  // the street's firms' share of the town's jobs; the rest work for the
  // public sector, the mainland or a firm the street does not keep
  const jobs = s.econ.jobs ?? 0;
  const share = jobs > 0 ? Math.max(0, Math.min(1, tot / jobs)) : 0;
  return { fid, cum, share, live: new Set(w.keys()) };
}
function drawEmployer(R: Rand, F: ReturnType<typeof readFirms>): number {
  const n = F.fid.length;
  if (!n || R.u() >= F.share) return EMP_OTHER;
  const x = R.u() * F.cum[n - 1];
  let lo = 0, hi = n - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (F.cum[mid] < x) lo = mid + 1; else hi = mid; }
  return F.fid[lo];
}

// ---------------------------------------------------------------- one household
function addAgent(r: HouseholdRegister): number {
  ensureCap(r, r.n + 1);
  const i = r.n++;
  const a = r.a!;
  for (const k of FIELD_NAMES) (a[k] as Uint8Array)[i] = 0;
  a.id[i] = r.nextId++;
  a.blk[i] = -1; a.emp1[i] = EMP_NONE; a.emp2[i] = EMP_NONE;
  return i;
}

/**
 * A household's people and pay. `income` is its market income in a normal
 * year (both earners' pay, or the pension). A head under 65 is in the labour
 * force, a second adult is with 70% odds (BLS: about 70% of married-couple
 * families have both spouses in the labour force when the head is of working
 * age); past 65 the household draws a pension.
 */
function fillPeople(R: Rand, a: HouseholdArrays, i: number, ageP: readonly number[], income: number, e: Econ, F: ReturnType<typeof readFirms>, unemp: number) {
  const band = pick(R, ageP);
  a.age[i] = AGE_LO[band] + Math.floor(R.u() * (AGE_HI[band] - AGE_LO[band] + 1));
  a.adults[i] = 1 + pick(R, ADULTS);
  a.kids[i] = a.age[i] >= 20 && a.age[i] < 60 ? pick(R, KIDS) : 0;
  const retired = a.age[i] >= 65;
  if (retired) { a.emp1[i] = EMP_RETIRED; a.wage1[i] = income; return; }
  const two = a.adults[i] >= 2 && R.u() < 0.70;
  const job = (emp: Int32Array, un: Uint16Array) => {
    emp[i] = R.u() < unemp ? EMP_UNEMP : drawEmployer(R, F);
    if (emp[i] === EMP_UNEMP) un[i] = 1 + Math.floor(R.u() * 10);
  };
  a.wage1[i] = two ? income * 0.6 : income; job(a.emp1, a.un1);
  if (two) { a.wage2[i] = income * 0.4; job(a.emp2, a.un2); }
  void e;
}

/** Money at the opening: savings and card debt (SCF 2022: median renter liquid ~ 1.5 months of income, owners several; about half carry a card balance, ~15% of income at the median). [S] */
function fillMoney(R: Rand, a: HouseholdArrays, i: number, income: number, owner: boolean, e: Econ) {
  const mo = income / 12;
  a.sav[i] = mo * Math.exp(Math.log(owner ? 3 : 1.5) + 1.1 * R.n());
  a.credit[i] = Math.max(0, Math.min(3, Math.floor((owner ? 0.8 : 1.4) + 1.1 * R.u() + 0.5 * R.n())));
  a.debt[i] = R.u() < 0.5 ? income * 0.15 * Math.exp(0.8 * R.n()) : 0;
  a.debt[i] = Math.min(a.debt[i], CARD_LIMIT[a.credit[i]] * income * 1.2);
  a.debtRate[i] = shortIndexOf(e) / 100 + CARD_SPREAD[a.credit[i]];
  a.clean[i] = Math.floor(R.u() * 36);
  a.yperm[i] = mo * (1 - taxRate(income, e));
}

// ---------------------------------------------------------------- seeding
/**
 * THE OPENING. The island's renters one for one, block by block, at the rent
 * each block's leases carry; their incomes lognormal at INCOME_SIGMA round a
 * median set so the median household pays HH_RENT_SHARE0 of its income in
 * rent (the one level the engine's flats branch is built on). The region's
 * other households: the sample of REGION_N at the town's median income and
 * the same spread; the richest by a noisy rank own, enough of them that the
 * region's ownership rate is the nation's; the rest rent across the water.
 */
export function seedHouseholdRegister(s: GameState, parcels: ParcelTable): HouseholdRegister {
  const e = s.econ;
  const r: HouseholdRegister = {
    v: 1, n: 0, cap: 0, nextId: 1, wIsland: 1, wRegion: 1,
    wageRef: e.wageIdx ?? 1, costRef: e.costIdx ?? 1, homeRef: e.homes?.psf ?? (e.wageIdx ?? 1),
    renterInc: 1, mainRent: 0, blocks: [],
    rent0: e.effRentIdx?.multifamily ?? e.rentIdx?.multifamily ?? 1, wage0: e.wageIdx ?? 1,
    flow: { movedOut: 0, movedIn: 0, evictions: 0, foreclosures: 0, spend: 0, income: 0 },
  };
  r.a = alloc(0);
  const R = stream(s);
  const F = readFirms(s);
  const u0 = e.unemployment ?? 0.05;
  let B = readBlocks(s, parcels, r);
  const units = B.list.reduce((t, b) => t + b.target, 0);
  if (units + REGION_N > MAX_AGENTS) { r.wIsland = 2; B = readBlocks(s, parcels, r); }
  // the island's renters: rents first, so the income median can be read off them
  const rents: number[] = [];
  for (const b of B.list) for (let k = 0; k < b.target; k++) {
    const i = addAgent(r);
    const a = r.a!;
    a.wt[i] = r.wIsland; a.ten[i] = TEN_RENT; a.blk[i] = b.idx;
    // leases signed over the last year, at about the block's rent then
    a.rent[i] = b.let * Math.exp(0.06 * R.n());
    a.leaseEnd[i] = s.month + 1 + Math.floor(R.u() * 12);
    rents.push(a.rent[i]);
  }
  const sorted = [...rents].sort((x, y) => x - y);
  const rentMed = sorted.length ? sorted[sorted.length >> 1] : (B.psfAvg * 850) / 12;
  // THE INCOME MEDIAN THAT PUTS THE MEDIAN HOUSEHOLD AT HH_RENT_SHARE0, AFTER
  // THE LANDLORD'S SCREEN. Every island renter got past a screen (see
  // `screened`), so the opening's renters are drawn through the same one that
  // every later mover meets — otherwise the register opens on households no
  // landlord would have let to and drifts off its own opening as they move
  // out. The median is solved for, by bisection on fixed draws, so that the
  // screened households' median burden is the engine's 30%.
  const zs = Array.from({ length: r.n * SCREEN_TRIES }, () => R.n());
  const burdenMed = (med: number) => {
    const b = new Float64Array(r.n);
    for (let i = 0; i < r.n; i++) b[i] = (12 * r.a!.rent[i]) / screened(med, r.a!.rent[i], (k) => zs[i * SCREEN_TRIES + k]);
    b.sort();
    return b.length ? b[b.length >> 1] : HH_RENT_SHARE0;
  };
  let lo = (12 * rentMed) / HH_RENT_SHARE0 / 4, hi = (12 * rentMed) / HH_RENT_SHARE0 * 4;
  for (let it = 0; it < 40; it++) { const mid = Math.sqrt(lo * hi); if (burdenMed(mid) > HH_RENT_SHARE0) lo = mid; else hi = mid; }
  const incMed = Math.sqrt(lo * hi);
  r.renterInc = incMed / Math.max(1, medianIncome(e));
  r.mainRent = rentMed;
  for (let i = 0; i < r.n; i++) {
    const income = screened(incMed, r.a!.rent[i], (k) => zs[i * SCREEN_TRIES + k]);
    fillPeople(R, r.a!, i, AGE_RENT, income, e, F, u0);
    fillMoney(R, r.a!, i, income, false, e);
  }
  // the region's other households
  const H = (e.population ?? 0) / HH_SIZE;
  const islandW = r.n * r.wIsland;
  r.wRegion = Math.max(0.01, (H - islandW) / REGION_N);
  const ownShare = Math.max(0, Math.min(0.95, (OWN_RATE * H) / Math.max(1, H - islandW)));
  const first = r.n;
  const score: number[] = [];
  const inc: number[] = [];
  for (let k = 0; k < REGION_N; k++) {
    const i = addAgent(r);
    const income = medianIncome(e) * Math.exp(INCOME_SIGMA * R.n());
    inc.push(income);
    r.a!.wt[i] = r.wRegion;
    fillPeople(R, r.a!, i, AGE_ALL, income, e, F, u0);
    // ownership rises with income and with age (Census HVS by age and income)
    score.push(Math.log(income / medianIncome(e)) + 0.03 * (r.a!.age[i] - 45) + 0.8 * R.n());
  }
  const cut = [...score].sort((x, y) => y - x)[Math.max(0, Math.round(ownShare * REGION_N) - 1)] ?? Infinity;
  const mRate = mortgageRate(e);
  for (let k = 0; k < REGION_N; k++) {
    const i = first + k, a = r.a!, income = inc[k];
    const owner = score[k] >= cut;
    fillMoney(R, a, i, income, owner, e);
    if (owner) {
      a.ten[i] = TEN_OWN;
      if (R.u() < MORTGAGED) {
        // the payment a household took on, about a fifth of its income (AHS
        // 2023 median mortgage payment to income ~ 17-20%), at the rate of the
        // year it bought — the book's rates sit under today's on average
        const rate = Math.max(0.025, Math.min(0.12, mRate - 0.01 + 0.01 * R.n()));
        const left = 24 + Math.floor(R.u() * 312);
        const pmt = 0.20 * (income / 12) * Math.exp(0.25 * R.n());
        const m = rate / 12;
        a.mortRate[i] = rate; a.mortPmt[i] = pmt;
        a.mort[i] = (pmt * (1 - Math.pow(1 + m, -left))) / m;
        a.hval[i] = a.mort[i] / (0.35 + 0.5 * R.u());
      } else {
        a.hval[i] = 4 * income * Math.exp(0.3 * R.n());
      }
    } else {
      a.ten[i] = TEN_MAINLAND;
      a.rent[i] = rentMed * Math.exp(0.25 * R.n());
    }
  }
  R.done();
  return r;
}

// ---------------------------------------------------------------- the month
/**
 * THE LANDLORD'S SCREEN. A renter household applying for a flat whose rent
 * would take more than SCREEN of its income is turned away and the flat goes
 * to the next applicant; after SCREEN_TRIES applicants it goes to whoever is
 * there. Landlords' income tests run from 2.5 to 3 times the rent (33-40%);
 * 50% allows for guarantors, vouchers and savings shown in lieu (NMHC/NAA
 * screening surveys) — a fact about the trade, not a fit. [S]
 */
const SCREEN = 0.5, SCREEN_TRIES = 3;
function screened(median: number, rentMo: number, z: (k: number) => number): number {
  let income = 0;
  for (let k = 0; k < SCREEN_TRIES; k++) { income = median * Math.exp(INCOME_SIGMA * z(k)); if ((12 * rentMo) / income <= SCREEN) break; }
  return income;
}

/** A new island household taking a flat: a renter from the region at the island renters' income, who can carry the rent. */
function moveIn(R: Rand, r: HouseholdRegister, b: Block, e: Econ, F: ReturnType<typeof readFirms>, m: number) {
  const i = addAgent(r), a = r.a!;
  const income = screened(r.renterInc * medianIncome(e), b.let, () => R.n());
  a.wt[i] = r.wIsland; a.ten[i] = TEN_RENT; a.blk[i] = b.idx;
  a.rent[i] = b.let; a.leaseEnd[i] = m + 12;
  fillPeople(R, a, i, AGE_RENT, income, e, F, e.unemployment ?? 0.05);
  fillMoney(R, a, i, income, false, e);
  r.flow.movedIn += r.wIsland;
}

/** A household forms in the region in place of one that dissolved: young, renting across the water. */
function formRegional(R: Rand, r: HouseholdRegister, i: number, e: Econ, F: ReturnType<typeof readFirms>) {
  const a = r.a!;
  for (const k of FIELD_NAMES) (a[k] as Uint8Array)[i] = 0;
  a.id[i] = r.nextId++; a.wt[i] = r.wRegion; a.blk[i] = -1; a.emp1[i] = EMP_NONE; a.emp2[i] = EMP_NONE;
  const income = r.renterInc * medianIncome(e) * Math.exp(INCOME_SIGMA * R.n());
  fillPeople(R, a, i, [1, 0, 0, 0, 0, 0], income, e, F, e.unemployment ?? 0.05);
  fillMoney(R, a, i, income, false, e);
  a.ten[i] = TEN_MAINLAND; a.rent[i] = r.mainRent * Math.exp(0.25 * R.n());
}

/** One earner slot's gross pay this month: a wage, a pension, or unemployment insurance for its first UI_MONTHS. */
function slotIncome(x: number, wage: number, un: number): number {
  if (x === EMP_NONE) return 0;
  if (x === EMP_UNEMP) return un <= UI_MONTHS ? (UI_REPLACE * wage) / 12 : 0;
  return wage / 12;
}
/** An unemployed earner finds work at this month's rate; a returning worker takes a small cut in pay (job-loss scarring, Jacobson-LaLonde-Sullivan 1993). [S] */
function findWork(R: Rand, F: ReturnType<typeof readFirms>, find: number, emp: Int32Array, wg: Float32Array, un: Uint16Array, i: number) {
  if (R.u() < find) { emp[i] = drawEmployer(R, F); wg[i] *= Math.exp(-0.03 + 0.08 * R.n()); un[i] = 0; }
  else if (un[i] < 65535) un[i]++;
}
function retire(emp: Int32Array, wg: Float32Array, i: number) {
  if (emp[i] !== EMP_NONE && emp[i] !== EMP_RETIRED) { emp[i] = EMP_RETIRED; wg[i] *= SS_REPLACE; }
}

/**
 * ONE MONTH FOR EVERY HOUSEHOLD. In order: pay moves with the town's wage
 * index, rents across the water with construction cost, houses with the new-
 * house market; jobs are lost at the CPS separation rate (and with the firm,
 * when a firm leaves the street) and found at the rate that holds the
 * register's jobless share at the town's; then income less tax, the rent or
 * mortgage, the card, spending on the buffer-stock rule, a shortfall
 * borrowed up to the card limit and what is left unpaid counted as arrears;
 * evictions and foreclosures; birthdays, births, children leaving, households
 * ending. Last, the island's blocks: leases end in a move or a renewal, and
 * each block's households are brought to the flats its roll says are let.
 */
export function tickHouseholdRegister(s: GameState, parcels: ParcelTable): void {
  if (!s.econ) return;
  if (!s.households) { s.households = seedHouseholdRegister(s, parcels); return; }
  const r = s.households;
  if (!r.a) unpackHouseholds(r);
  else reviveColumns(r);
  const a = r.a!, e = s.econ, m = s.month;
  const R = stream(s);
  const F = readFirms(s);
  const B = readBlocks(s, parcels, r);
  r.flow = { movedOut: 0, movedIn: 0, evictions: 0, foreclosures: 0, spend: 0, income: 0 };
  const wage = e.wageIdx ?? 1, cost = e.costIdx ?? 1, home = e.homes?.psf ?? wage;
  const gW = wage / Math.max(1e-9, r.wageRef), gC = cost / Math.max(1e-9, r.costRef), gH = home / Math.max(1e-9, r.homeRef);
  r.wageRef = wage; r.costRef = cost; r.homeRef = home;
  r.mainRent *= gC;
  const short = shortIndexOf(e) / 100;
  const n0 = r.n;
  const gone = new Uint8Array(n0);

  // ---- jobs: indexation and separations, then the finding rate that holds the town's rate
  let lf = 0, un = 0;
  const lose = (emp: Int32Array, un_: Uint16Array, i: number) => {
    const x = emp[i];
    if (x === EMP_NONE || x === EMP_RETIRED) return;
    if (x !== EMP_UNEMP && ((x >= 0 && !F.live.has(x)) || R.u() < SEP_RATE)) { emp[i] = EMP_UNEMP; un_[i] = 0; }
    lf += a.wt[i];
    if (emp[i] === EMP_UNEMP) un += a.wt[i];
  };
  for (let i = 0; i < n0; i++) {
    a.wage1[i] *= gW; a.wage2[i] *= gW; a.yperm[i] *= gW;
    if (a.ten[i] === TEN_MAINLAND) a.rent[i] *= gC;
    if (a.ten[i] === TEN_OWN) a.hval[i] *= gH;
    lose(a.emp1, a.un1, i); lose(a.emp2, a.un2, i);
  }
  const target = (e.unemployment ?? 0.05) * lf;
  const find = un > 0 ? Math.max(0, Math.min(1, (un - target) / un)) : 0;

  const persons = (i: number) => a.adults[i] + a.kids[i];
  for (let i = 0; i < n0; i++) {
    const w = a.wt[i];
    // finding work: a returning worker takes a small cut in pay (job-loss scarring, Jacobson-LaLonde-Sullivan)
    if (a.emp1[i] === EMP_UNEMP) findWork(R, F, find, a.emp1, a.wage1, a.un1, i);
    if (a.emp2[i] === EMP_UNEMP) findWork(R, F, find, a.emp2, a.wage2, a.un2, i);
    // income
    const gross = slotIncome(a.emp1[i], a.wage1[i], a.un1[i]) + slotIncome(a.emp2[i], a.wage2[i], a.un2[i]);
    const net = gross * (1 - taxRate(gross * 12, e));
    a.yperm[i] += PERM_ROLL * (net - a.yperm[i]);
    // housing
    const ten = a.ten[i];
    let housing = 0;
    if (ten === TEN_RENT || ten === TEN_MAINLAND) housing = a.rent[i];
    else if (ten === TEN_OWN) housing = a.mortPmt[i] + (TAX_INS / 12) * a.hval[i];
    // the card: interest accrues at its floating rate, the minimum is due
    a.debtRate[i] = short + CARD_SPREAD[a.credit[i]];
    if (a.debt[i] > 0) a.debt[i] *= 1 + a.debtRate[i] / 12;
    const minPay = a.debt[i] > 25 ? a.debt[i] * (a.debtRate[i] / 12 + MIN_PRINCIPAL) : a.debt[i];
    // spending on the buffer-stock rule
    const target = bufferMonths(a.age[i]) * a.yperm[i];
    const spend = Math.max(subsistence(e, persons(i)), a.yperm[i] - housing - minPay + KAPPA * (a.sav[i] - target));
    let cash = a.sav[i] + net - spend - minPay - housing;
    a.debt[i] = Math.max(0, a.debt[i] - minPay);
    if (cash < 0) {
      const room = Math.max(0, CARD_LIMIT[a.credit[i]] * 12 * Math.max(0, a.yperm[i]) - a.debt[i]);
      const b = Math.min(-cash, room);
      a.debt[i] += b; cash += b;
    }
    let shortfall = false;
    if (cash < -1) { shortfall = housing > 0; cash = 0; }
    else if (cash > 1.5 * target && a.debt[i] > 0) { const p = Math.min(a.debt[i], cash - target); a.debt[i] -= p; cash -= p; }
    a.sav[i] = cash;
    r.flow.spend += w * spend; r.flow.income += w * net;
    // the mortgage amortises on a month paid
    if (ten === TEN_OWN && a.mort[i] > 0 && !shortfall) {
      const princ = a.mortPmt[i] - (a.mort[i] * a.mortRate[i]) / 12;
      a.mort[i] = Math.max(0, a.mort[i] - Math.max(0, princ));
      if (a.mort[i] <= 1) { a.mort[i] = 0; a.mortPmt[i] = 0; }
    }
    // arrears and the credit record
    if (shortfall) {
      if (a.arrears[i] < 255) a.arrears[i]++;
      if (a.arrears[i] === 2 && a.credit[i] < 3) a.credit[i]++;
      a.clean[i] = 0;
    } else {
      a.arrears[i] = 0;
      if (a.clean[i] < 255) a.clean[i]++;
      if (a.clean[i] >= 36 && a.credit[i] > 0) { a.credit[i]--; a.clean[i] = 0; }
    }
    if ((ten === TEN_RENT || ten === TEN_MAINLAND) && a.arrears[i] >= EVICT_M) {
      r.flow.evictions += w;
      a.arrears[i] = 0;
      if (ten === TEN_RENT) { gone[i] = 1; r.flow.movedOut += w; } else { a.ten[i] = TEN_DOUBLED; a.rent[i] = 0; }
    } else if (ten === TEN_OWN && a.arrears[i] >= FORECLOSE_M) {
      r.flow.foreclosures += w;
      a.arrears[i] = 0; a.ten[i] = TEN_DOUBLED; a.mort[i] = 0; a.mortPmt[i] = 0; a.hval[i] = 0;
    } else if (ten === TEN_DOUBLED && (a.emp1[i] >= 0 || a.emp1[i] === EMP_OTHER) && a.sav[i] > 3 * r.mainRent) {
      // a doubled-up household with work and a deposit takes its own flat across the water
      a.ten[i] = TEN_MAINLAND; a.rent[i] = r.mainRent * Math.exp(0.25 * R.n());
    }
    // a year older on its month; births; children leaving; retirement; the end
    if ((m + a.id[i]) % 12 === 0 && a.age[i] < 110) {
      a.age[i]++;
      if (a.age[i] === 67) { retire(a.emp1, a.wage1, i); retire(a.emp2, a.wage2, i); }
    }
    if (a.adults[i] >= 2 && a.age[i] >= 20 && a.age[i] < 43 && a.kids[i] < 6 && R.u() < BIRTH_M) a.kids[i]++;
    if (a.kids[i] > 0 && a.age[i] >= 45 && R.u() < LEAVE_M * a.kids[i]) a.kids[i]--;
    if (a.age[i] >= 80 && R.u() < DISSOLVE_M) {
      if (a.ten[i] === TEN_RENT) { if (!gone[i]) { gone[i] = 1; r.flow.movedOut += w; } }
      else formRegional(R, r, i, e, F);
    }
  }

  // ---- the island's blocks: leases ending, then each block to the flats its roll has let
  const inBlock = new Map<number, number[]>();
  for (let i = 0; i < n0; i++) {
    if (a.ten[i] !== TEN_RENT || gone[i]) continue;
    const b = B.byIdx.get(a.blk[i]);
    if (!b) { gone[i] = 1; r.flow.movedOut += a.wt[i]; continue; }   // the block is gone, or empty
    if (a.leaseEnd[i] <= m) {
      if (R.u() < RENTER_MOVE) { gone[i] = 1; r.flow.movedOut += a.wt[i]; continue; }
      // renewed at the block's rent less the sitting tenant's discount, never cut more than 3% (streetRolls renewals)
      a.rent[i] = Math.max(a.rent[i] * 0.97, b.let * 0.97);
      a.leaseEnd[i] = m + 12;
    }
    const l = inBlock.get(b.idx);
    if (l) l.push(i); else inBlock.set(b.idx, [i]);
  }
  for (const b of B.list) {
    const l = inBlock.get(b.idx) ?? [];
    let extra = l.length - b.target;
    // fewer households than the roll: those leaving are drawn at random
    while (extra > 0) {
      const k = Math.floor(R.u() * l.length);
      const i = l[k]; l[k] = l[l.length - 1]; l.pop();
      gone[i] = 1; r.flow.movedOut += a.wt[i]; extra--;
    }
    for (let k = 0; k < -extra; k++) moveIn(R, r, b, e, F, m);
  }
  // compact: drop the households that left, keep the order (through r.a: a
  // move-in may have grown the arrays), and zero the tail so a save round-trips exactly
  const C = r.a!;
  // (in runs of kept agents, a native copyWithin per column: an element-wise
  // copy across 26 kinds of typed array is megamorphic and cost ~40 ms a month)
  let j = 0;
  for (let i = 0; i < r.n;) {
    if (i < n0 && gone[i]) { i++; continue; }
    let end = i + 1;
    while (end < r.n && !(end < n0 && gone[end])) end++;
    if (j !== i) for (const k of FIELD_NAMES) (C[k] as Uint8Array).copyWithin(j, i, end);
    j += end - i; i = end;
  }
  for (const k of FIELD_NAMES) (C[k] as Uint8Array).fill(0, j, r.n);
  r.n = j;
  // the region's households: what the island's renters do not account for
  const H = (e.population ?? 0) / HH_SIZE;
  let islandW = 0, nReg = 0;
  const A = r.a!;
  for (let i = 0; i < r.n; i++) if (A.ten[i] === TEN_RENT) islandW += A.wt[i]; else nReg++;
  r.wRegion = Math.max(0.01, (H - islandW) / Math.max(1, nReg));
  for (let i = 0; i < r.n; i++) if (A.ten[i] !== TEN_RENT) A.wt[i] = r.wRegion;
  R.done();
}

// ---------------------------------------------------------------- reading it
const wq = (v: number[], w: number[], q: number) => {
  const ix = v.map((_, i) => i).sort((x, y) => v[x] - v[y]);
  const tot = w.reduce((t, x) => t + x, 0);
  let acc = 0;
  for (const i of ix) { acc += w[i]; if (acc >= q * tot) return v[i]; }
  return NaN;
};

/**
 * A slot's income over the last twelve months, the income a rent burden is
 * measured on (ACS: gross rent over household income in the past 12 months):
 * pay for the months worked, unemployment insurance for the months it ran.
 */
function incomeYear(x: number, wage: number, un: number): number {
  if (x === EMP_NONE) return 0;
  if (x !== EMP_UNEMP) return wage;
  const out = Math.min(12, un);
  return wage * (12 - out) / 12 + UI_REPLACE * wage * Math.min(out, UI_MONTHS) / 12;
}

/** What the register adds up to, weighted. Pure. */
export function householdStats(s: GameState) {
  const r = s.households;
  if (!r) return null;
  if (!r.a) unpackHouseholds(r);
  const a = r.a!, e = s.econ;
  let hh = 0, persons = 0, island = 0, main = 0, own = 0, dbl = 0, lf = 0, un = 0, arrears = 0, withDebt = 0;
  const burden: number[] = [], bw: number[] = [], sav: number[] = [], debt: number[] = [], ww: number[] = [], sm: number[] = [];
  for (let i = 0; i < r.n; i++) {
    const w = a.wt[i];
    hh += w; persons += w * (a.adults[i] + a.kids[i]);
    const t = a.ten[i];
    if (t === TEN_RENT) island += w; else if (t === TEN_MAINLAND) main += w; else if (t === TEN_OWN) own += w; else dbl += w;
    for (const emp of [a.emp1, a.emp2]) { const x = emp[i]; if (x !== EMP_NONE && x !== EMP_RETIRED) { lf += w; if (x === EMP_UNEMP) un += w; } }
    if (a.arrears[i] > 0) arrears += w;
    if (a.debt[i] > 0) withDebt += w;
    const inc = incomeYear(a.emp1[i], a.wage1[i], a.un1[i]) + incomeYear(a.emp2[i], a.wage2[i], a.un2[i]);
    if (t === TEN_RENT) { burden.push(inc > 0 ? 12 * a.rent[i] / inc : 9.99); bw.push(w); }
    sav.push(a.sav[i]); debt.push(a.debt[i]); ww.push(w);
    sm.push(a.yperm[i] > 0 ? a.sav[i] / a.yperm[i] : 0);
  }
  return {
    agents: r.n, wIsland: r.wIsland, wRegion: r.wRegion,
    households: hh, persons, islandRenters: island, mainlandRenters: main, owners: own, doubledUp: dbl,
    unemployment: lf > 0 ? un / lf : 0,
    medianBurden: burden.length ? wq(burden, bw, 0.5) : NaN,
    costBurdened: burden.length ? burden.filter((b) => b > 0.3).length / burden.length : NaN,
    arrearsRate: hh > 0 ? arrears / hh : 0,
    debtShare: hh > 0 ? withDebt / hh : 0,
    savP10: wq(sav, ww, 0.1), savP50: wq(sav, ww, 0.5), savP90: wq(sav, ww, 0.9),
    savMonthsP50: wq(sm, ww, 0.5),
    debtP50: wq(debt, ww, 0.5), debtP90: wq(debt, ww, 0.9),
    medianIncome: medianIncome(e),
    /** the engine's households: the region's people over the average household (homeprice HH_SIZE) */
    engineHouseholds: (e.population ?? 0) / HH_SIZE,
    /** the engine's burden: the opening's HH_RENT_SHARE0 moved by the flats' effective rent over the wage index since */
    engineBurden: HH_RENT_SHARE0 * ((e.effRentIdx?.multifamily ?? e.rentIdx?.multifamily ?? 1) / (r.rent0 || 1)) / ((e.wageIdx ?? 1) / (r.wage0 || 1)),
    flow: { ...r.flow },
  };
}

/**
 * THE REGISTER'S MONTH IN MONEY, weighted, read off its state after the tick:
 * what its households earn (pay, pensions, unemployment insurance), pay in
 * tax, pay for their homes (rent; a mortgage's principal and interest; the
 * owner's property tax and insurance, TAX_INS) and spend on everything else
 * (`flow.spend`). The economy's ledger (economy.ts) books these; nothing here
 * writes. Pure.
 */
export function householdMoney(s: GameState): {
  wages: number; pensions: number; ui: number; tax: number; taxLocal: number;
  rent: number; mortgage: number; propertyTax: number; homeInsurance: number; spend: number; households: number;
} | null {
  const r = s.households;
  if (!r || !s.econ) return null;
  if (!r.a) unpackHouseholds(r);
  const a = r.a!, e = s.econ;
  let wages = 0, pensions = 0, ui = 0, tax = 0, taxLocal = 0, rent = 0, mortgage = 0, ownerCost = 0, hh = 0;
  const slot = (x: number, wage: number, un: number, w: number) => {
    if (x === EMP_NONE) return 0;
    if (x === EMP_RETIRED) { pensions += w * wage / 12; return wage / 12; }
    if (x === EMP_UNEMP) { const v = un <= UI_MONTHS ? (UI_REPLACE * wage) / 12 : 0; ui += w * v; return v; }
    wages += w * wage / 12; return wage / 12;
  };
  for (let i = 0; i < r.n; i++) {
    const w = a.wt[i];
    hh += w;
    const gross = slot(a.emp1[i], a.wage1[i], a.un1[i], w) + slot(a.emp2[i], a.wage2[i], a.un2[i], w);
    const t = taxRate(gross * 12, e);
    tax += w * gross * t;
    taxLocal += w * gross * Math.min(t, 0.04);   // the state-and-local part of TAX_RATES (ITEP, above)
    const ten = a.ten[i];
    if (ten === TEN_RENT || ten === TEN_MAINLAND) rent += w * a.rent[i];
    else if (ten === TEN_OWN) { if (a.mort[i] > 0) mortgage += w * a.mortPmt[i]; ownerCost += w * (TAX_INS / 12) * a.hval[i]; }
  }
  // TAX_INS is ~1.0 points of property tax and ~0.5 of insurance (homeprice.ts)
  return { wages, pensions, ui, tax, taxLocal, rent, mortgage, propertyTax: ownerCost * (1 / 1.5), homeInsurance: ownerCost * (0.5 / 1.5), spend: r.flow.spend, households: hh };
}

// ---------------------------------------------------------------- saves
function toB64(u8: Uint8Array): string {
  let out = "";
  for (let i = 0; i < u8.length; i += 0x8000) out += String.fromCharCode.apply(null, Array.from(u8.subarray(i, i + 0x8000)));
  return btoa(out);
}
function fromB64(str: string): Uint8Array {
  const bin = atob(str);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

/** The register as a save carries it: the first `n` of each array as base64, nothing else changed. */
export function packHouseholds(r: HouseholdRegister): HouseholdRegister {
  if (!r.a) return r;
  const packed: Partial<Record<FieldName, string>> = {};
  for (const k of FIELD_NAMES) {
    const arr = r.a[k];
    packed[k] = toB64(new Uint8Array(arr.buffer, arr.byteOffset, r.n * arr.BYTES_PER_ELEMENT));
  }
  const { a: _a, ...rest } = r;
  void _a;
  return { ...rest, flow: { ...r.flow }, blocks: [...r.blocks], ...(r.unitMemo ? { unitMemo: structuredClone(r.unitMemo) } : {}), packed };
}

/** Back to arrays, in place, at the register's own capacity (the tail zero, as the running register keeps it). */
/**
 * A STATE THAT WENT THROUGH JSON (a harness's deep copy, an old save path)
 * comes back with each typed column as a plain {"0": v, ...} object. Put the
 * numbers back in typed columns of the register's capacity.
 */
function reviveColumns(r: HouseholdRegister): void {
  const cur = r.a as unknown as Record<string, unknown>;
  if (FIELD_NAMES.every((k) => ArrayBuffer.isView(cur[k]))) return;
  const a = alloc(r.cap);
  for (const k of FIELD_NAMES) {
    const v = cur[k];
    if (ArrayBuffer.isView(v)) { (a[k] as Uint8Array).set((v as Uint8Array).subarray(0, r.cap)); continue; }
    if (v && typeof v === "object") for (const [i, x] of Object.entries(v as Record<string, number>)) {
      const j = +i;
      if (j >= 0 && j < r.cap) (a[k] as Uint8Array)[j] = x;
    }
  }
  r.a = a;
}

export function unpackHouseholds(r: HouseholdRegister): void {
  if (r.a || !r.packed) { if (!r.a) r.a = alloc(r.cap); return; }
  const a = alloc(r.cap);
  for (const k of FIELD_NAMES) {
    const b64 = r.packed[k];
    if (!b64) continue;
    const u8 = fromB64(b64);
    new Uint8Array(a[k].buffer).set(u8.subarray(0, Math.min(u8.length, r.cap * a[k].BYTES_PER_ELEMENT)));
  }
  r.a = a;
  delete r.packed;
}

/** A state ready for a save: the register packed, nothing else touched (a shallow copy). */
export function packHouseholdsForSave<T extends { households?: HouseholdRegister }>(state: T): T {
  if (!state.households?.a) return state;
  return { ...state, households: packHouseholds(state.households) };
}
