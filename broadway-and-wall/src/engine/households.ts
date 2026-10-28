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
import { HH_RENT_SHARE0, shortIndexOf, ownCostIdx } from "./market";
import { resolveRecBare, useRentableSf } from "./value";
import { flatUnitSf } from "./streetRolls";
import { HH_SIZE, INCOME_SIGMA, TAX_INS, medianIncome, mortgageRate } from "./homeprice";
import { INDUSTRIES, INDUSTRY_IDS, N_IND, COMP_PER_WORKER_2023, PAY_SPLIT } from "./industries";

// STAGE 1b (2026-10-28): THE REGISTER'S EARNERS ARE THE FIRMS' PAYROLL.
// Once the city's firm books exist (economy.ts), every working earner works
// for one of them — a named street firm or one of the off-map sample — in its
// industry, at its industry's pay (BEA compensation per worker, the cash
// part) times the earner's own standing. The firms' heads are the labour
// DEMAND: each month the register lays off where an industry has more of its
// earners than heads, places the earners who arrived with work and hires the
// jobless into the vacancies at the CPS finding rate; the vacancies the town's
// own people cannot fill are filled by households arriving for them, and a
// household whose earners have been out of work past their insurance may
// leave. So the register's employed ARE the firms' heads, and an industry's
// payroll in the firms' books IS its earners' pay (economy.ts reads
// `registerPayroll`). The register no longer re-weights itself to the
// engine's population: its households are who came for the work, and
// `tools/households.mjs` reports the gap.

// ---------------------------------------------------------------- codes
/** Tenure. */
export const TEN_RENT = 0;      // renting a flat on the island (a block in `blocks`)
export const TEN_OWN = 1;       // owning, somewhere in the region
export const TEN_DOUBLED = 2;   // doubled up with family or friends: no rent of its own
export const TEN_MAINLAND = 3;  // renting across the water
/** An earner slot's employer. A firm's id (`Tenant.fid`) is >= 0. */
export const EMP_NONE = -1;     // no earner in this slot
export const EMP_UNEMP = -2;    // in the labour force, out of work
export const EMP_OTHER = -3;    // working, but not yet placed with one of the city's firms (a household that arrived with a job, or the register before the firm books open)
export const EMP_RETIRED = -4;  // a pension (Social Security), not a wage
/** An off-map firm of the books (economy.ts ids -1, -2, ...) is employer EMP_OFF + id: -17, -18, ... */
export const EMP_OFF = -16;
/** Working for one of the city's firms (named or off-map). */
export const isPlaced = (x: number) => x >= 0 || x < EMP_OFF;
/** In work: placed, or not yet placed. */
export const isWorking = (x: number) => isPlaced(x) || x === EMP_OTHER;
/** An earner slot's industry before it has one. */
export const IND_NONE = 255;

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
/**
 * OWNERS WHO SELL AND RENT AGAIN: about 1.7% of owner households a year. CPS
 * ASEC geographic mobility (2015-19): about 5% of owner households move in a
 * year and about a third of those movers rent where they land; 86M owner
 * households (Census HVS) [S~]. The other way — renters buying — is solved at
 * the opening so the region's owners are a steady state there (`tickTenure`),
 * about 5.5% of renters a year against the 4-5% of renter households that
 * first-time buyers are (NAR Profile of Home Buyers and Sellers: ~1.6-2.2M a
 * year on ~44M renter households) — a check, not a fit.
 */
const SELL_YR = 0.017;
/**
 * HOW MUCH THE BUYING ANSWERS WHAT OWNING COSTS AGAINST RENTING: the engine's
 * tenure calibration (market.ts TENURE_PER_LOG, 0.09 renter households per
 * log point of own-over-rent cost, the 1978-85 mortgage-rate episode, Census
 * HVS) over the steady state's elasticity of the renter share to the buying
 * hazard, about 0.65 at the opening's flows [D]: 0.09 / 0.65 = 0.14.
 */
const BUY_ELAST = 0.14;
/** Monthly employed-to-unemployed flow, about 1.4% (BLS CPS labour-force flows, 2015-19 average). [S] */
const SEP_RATE = 0.014;
/** Monthly unemployed-to-employed flow, about a quarter of the jobless a month (BLS CPS labour-force flows, 2015-19 average) — when there is a vacancy to take. [S] */
const UE_RATE = 0.25;
/**
 * A household whose earners are all out of work, past their insurance, leaves
 * the region at about 5% a year: interstate migration ran about 2.5% a year
 * through the 2000s (Census CPS; Molloy, Smith & Wozniak 2011, JEP), and the
 * jobless move about twice as often as the employed — the doubling is [K].
 */
const LEAVE_JOBLESS_M = 0.05 / 12;
/**
 * The spread of pay round an industry's average: lognormal, sigma from the
 * mean over the median of all US wages, OEWS May 2023 ($65,470 mean, $23.11 an
 * hour = $48,069 median: sigma = sqrt(2 ln(mean/median)) = 0.79). That is the
 * spread across all jobs, so an upper bound within one industry [D].
 */
const WAGE_SIGMA = Math.sqrt(2 * Math.log(65470 / 48069));
/** Cash pay a year in an industry at the town's wage index: BEA compensation per worker x the cash share (industries.ts PAY_SPLIT; economy.ts pays the same). */
export function industryCashPay(ind: number, wageIdx: number): number {
  return COMP_PER_WORKER_2023 * INDUSTRIES[INDUSTRY_IDS[ind]].wageRel * wageIdx * PAY_SPLIT.cash;
}
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
/**
 * A household's dissolution hazard from 65, a year: the head's mortality, SSA
 * 2019 period life table, the mean of the sexes — about 1.3% at 65, 2% at 70,
 * 3% at 75, 5% at 80, 8.5% at 85, 15% at 90 — fitted as Gompertz, doubling
 * every seven years [S~]. (Stage 1 had 7% a year from 80 and nothing before:
 * a retiree lived 27 years past 67 against the table's ~18, which stage 1b's
 * register — where every retirement leaves a job for somebody to come for —
 * turned into a town of retirees.)
 */
const dissolveM = (age: number) => 0.013 * Math.exp(0.097 * (age - 65)) / 12;
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
  ind1: Uint8Array, ind2: Uint8Array,  // each earner's industry (INDUSTRY_IDS index; IND_NONE before the firm books place it) — kept through a spell out of work
} as const;
/** Columns a save from before them does not carry, and what they hold then. */
const FIELD_DEFAULT: Partial<Record<keyof typeof FIELDS, number>> = { ind1: IND_NONE, ind2: IND_NONE };
type FieldName = keyof typeof FIELDS;
export type HouseholdArrays = { [K in FieldName]: InstanceType<(typeof FIELDS)[K]> };
const FIELD_NAMES = Object.keys(FIELDS) as FieldName[];

export interface HouseholdFlows {
  /** Households (weighted) that left an island flat this month: moved, evicted, dissolved. */
  movedOut: number; movedIn: number;
  evictions: number; foreclosures: number;
  /** Weighted spending and net income, a month — what stage 2 hands the shops. */
  spend: number; income: number;
  /** Households (weighted) that came to the region for work, and that left it out of work (stage 1b). */
  arrived?: number; left?: number;
  /** Households (weighted) that bought a home, and that sold and went back to renting (step 2). */
  bought?: number; sold?: number;
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
  /**
   * TENURE (step 2): renters' monthly hazard of buying at the opening — solved
   * so the opening's owners are a steady state (`tickTenure`) — the own-or-rent
   * cost the opening chose at (log), and the plats' houses already sold.
   */
  hBuy0?: number; tenRef?: number; homesSeen?: number;
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

/**
 * THE LABOUR DEMAND: the city's firms this month (economy.ts `tickFirms`, run
 * before the register), each with its register employer code, industry and
 * heads, and each industry's heads and cash pay. Null before the books open,
 * or in a month they did not run. Pure.
 */
type Demand = { heads: Float64Array; codes: Int32Array[]; cum: Float64Array[]; live: Set<number>; pay: Float64Array };
function readDemand(s: GameState): Demand | null {
  const E = s.economy;
  if (!E || !E.cur || E.cur.m !== s.month) return null;
  const f = E.f, n = E.L.slot.n;
  const lists: { code: number; hc: number }[][] = Array.from({ length: N_IND }, () => []);
  const live = new Set<number>();
  for (let k = 0; k < n; k++) {
    const id = f.id[k], code = id >= 0 ? id : EMP_OFF + id;
    live.add(code);
    if (f.hc[k] > 0) lists[f.ind[k]].push({ code, hc: f.hc[k] });
  }
  const codes = lists.map((l) => Int32Array.from(l, (x) => x.code));
  const cum = lists.map((l) => { let t = 0; return Float64Array.from(l, (x) => (t += x.hc)); });
  const w = s.econ.wageIdx ?? 1;
  const pay = new Float64Array(N_IND);
  for (let i = 0; i < N_IND; i++) pay[i] = industryCashPay(i, w);
  return { heads: Float64Array.from(E.cur.heads), codes, cum, live, pay };
}
/** A firm of an industry, by its heads (one draw). */
function drawFirm(R: Rand, D: Demand, ind: number): number {
  const c = D.cum[ind], n = c.length, x = R.u() * (n ? c[n - 1] : 0);
  if (!n) return EMP_OTHER;
  let lo = 0, hi = n - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (c[mid] < x) lo = mid + 1; else hi = mid; }
  return D.codes[ind][lo];
}

// ---------------------------------------------------------------- one household
function addAgent(r: HouseholdRegister): number {
  ensureCap(r, r.n + 1);
  const i = r.n++;
  const a = r.a!;
  for (const k of FIELD_NAMES) (a[k] as Uint8Array)[i] = 0;
  a.id[i] = r.nextId++;
  a.blk[i] = -1; a.emp1[i] = EMP_NONE; a.emp2[i] = EMP_NONE; a.ind1[i] = IND_NONE; a.ind2[i] = IND_NONE;
  return i;
}

/**
 * A household's people and pay. `income` is its market income in a normal
 * year (both earners' pay, or the pension). A head under 65 is in the labour
 * force, a second adult is with 70% odds (BLS: about 70% of married-couple
 * families have both spouses in the labour force when the head is of working
 * age); past 65 the household draws a pension.
 */
function fillPeople(R: Rand, a: HouseholdArrays, i: number, ageP: readonly number[], income: number, e: Econ, unemp: number) {
  const band = pick(R, ageP);
  a.age[i] = AGE_LO[band] + Math.floor(R.u() * (AGE_HI[band] - AGE_LO[band] + 1));
  a.adults[i] = 1 + pick(R, ADULTS);
  a.kids[i] = a.age[i] >= 20 && a.age[i] < 60 ? pick(R, KIDS) : 0;
  const retired = a.age[i] >= 65;
  if (retired) { a.emp1[i] = EMP_RETIRED; a.wage1[i] = income; return; }
  const two = a.adults[i] >= 2 && R.u() < 0.70;
  const job = (emp: Int32Array, un: Uint16Array) => {
    emp[i] = R.u() < unemp ? EMP_UNEMP : EMP_OTHER;
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
    fillPeople(R, r.a!, i, AGE_RENT, income, e, u0);
    fillMoney(R, r.a!, i, income, false, e);
  }
  // THE REGION'S OTHER HOUSEHOLDS, AS MANY AS THE OPENING'S JOBS NEED
  // (2026-10-28, step 2). The register is the town's people now, so the
  // region holds the households whose earners the town's jobs employ at the
  // opening's jobless rate: the sample is drawn first, and each agent weighs
  // what puts its labour force at the jobs over one less that rate. (It was
  // the engine's population over the average household, which at the
  // register's ~1.1 earners a household is about a quarter short of workers:
  // the first year's arrivals made up the difference.)
  const lfOf = (i: number) => [r.a!.emp1[i], r.a!.emp2[i]].filter((x) => x !== EMP_NONE && x !== EMP_RETIRED).length;
  let islandLf = 0;
  for (let i = 0; i < r.n; i++) islandLf += r.wIsland * lfOf(i);
  const first = r.n;
  const score: number[] = [];
  const inc: number[] = [];
  let sampleLf = 0;
  for (let k = 0; k < REGION_N; k++) {
    const i = addAgent(r);
    const income = medianIncome(e) * Math.exp(INCOME_SIGMA * R.n());
    inc.push(income);
    fillPeople(R, r.a!, i, AGE_ALL, income, e, u0);
    sampleLf += lfOf(i);
    // ownership rises with income and with age (Census HVS by age and income)
    score.push(Math.log(income / medianIncome(e)) + 0.03 * (r.a!.age[i] - 45) + 0.8 * R.n());
  }
  const lfNeed = (e.jobs ?? 0) / Math.max(0.5, 1 - u0);
  r.wRegion = Math.max(0.01, (lfNeed - islandLf) / Math.max(1, sampleLf));
  for (let k = 0; k < REGION_N; k++) r.a!.wt[first + k] = r.wRegion;
  const islandW = first * r.wIsland;
  const H = islandW + REGION_N * r.wRegion;
  const ownShare = Math.max(0, Math.min(0.95, (OWN_RATE * H) / Math.max(1, H - islandW)));
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
      a.rent[i] = mainlandRent(R, rentMed, a, i);
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

/**
 * A NEW ISLAND HOUSEHOLD TAKING A FLAT (step 2): a renter from across the
 * water — one of the region's renter households, the first of SCREEN_TRIES
 * applicants who can carry the rent (the landlord's screen), else the last —
 * which moves its household (and its weight) onto the island. So the region's
 * renters are one pool and the island's flats are where some of them live:
 * a flat let on the island is a renter household fewer across the water, not
 * a household more in the region (the register's renters are what the flats'
 * demand reads, market.ts). With nobody across the water, a household arrives
 * from outside, at the island renters' income.
 */
function moveIn(R: Rand, r: HouseholdRegister, b: Block, e: Econ, m: number, pool: number[], gone: Uint8Array) {
  const w = r.wIsland;
  let j = -1;
  for (let k = 0; k < SCREEN_TRIES && pool.length; k++) {
    const c = pool[Math.floor(R.u() * pool.length)];
    const A = r.a!;
    if ((c < gone.length && gone[c]) || A.ten[c] !== TEN_MAINLAND || A.wt[c] < w) continue;
    j = c;
    const inc = A.wage1[c] + A.wage2[c];
    if (inc > 0 && (12 * b.let) / inc <= SCREEN) break;
  }
  const i = addAgent(r), a = r.a!;
  if (j >= 0) {
    for (const k of FIELD_NAMES) (a[k] as Uint8Array)[i] = (a[k] as Uint8Array)[j];
    a.id[i] = r.nextId++;
    a.wt[j] -= w;
    if (a.wt[j] < 1e-6 && j < gone.length) gone[j] = 1;
  } else {
    const income = screened(r.renterInc * medianIncome(e), b.let, () => R.n());
    fillPeople(R, a, i, AGE_RENT, income, e, e.unemployment ?? 0.05);
    fillMoney(R, a, i, income, false, e);
  }
  a.wt[i] = w; a.ten[i] = TEN_RENT; a.blk[i] = b.idx;
  a.rent[i] = b.let; a.leaseEnd[i] = m + 12;
  r.flow.movedIn += w;
}

/** An island household that leaves its flat for the region's rented homes: its weight goes back to the pool across the water. */
function toMainland(R: Rand, r: HouseholdRegister, i: number, pool: number[], gone: Uint8Array) {
  const a = r.a!;
  gone[i] = 1; r.flow.movedOut += a.wt[i];
  for (let k = 0; k < 4 && pool.length; k++) {
    const j = pool[Math.floor(R.u() * pool.length)];
    if ((j < gone.length && gone[j]) || a.ten[j] !== TEN_MAINLAND) continue;
    a.wt[j] += a.wt[i];
    return;
  }
  // nobody across the water to join: the household itself rents there
  gone[i] = 0; a.ten[i] = TEN_MAINLAND; a.blk[i] = -1; a.rent[i] = mainlandRent(R, r.mainRent, a, i);
}

/**
 * OWN OR RENT, HOUSEHOLD BY HOUSEHOLD (2026-10-28, step 2). Renters with work
 * buy at the month's hazard — the opening's (solved so the opening's owners
 * are a steady state: their sales and their dissolutions over the renters)
 * moved by what owning costs against renting (market.ts `ownCostIdx` against
 * the flats' real rent, BUY_ELAST) — on a mortgage of a fifth of their income
 * (AHS) at the month's rate, with a tenth down; owners sell and rent again at
 * SELL_YR. The plats' new houses (homes.ts) are sold to the region's renters,
 * one household each. An island renter who buys leaves its flat. It replaces
 * the engine's tenure index as what the flats' demand reads (market.ts: the
 * register's renter households).
 */
function tickTenure(R: Rand, r: HouseholdRegister, e: Econ, gone: Uint8Array, pool: number[]) {
  const a = r.a!, n = gone.length;
  const sellM = SELL_YR / 12;
  const rentRel = (e.effRentIdx?.multifamily ?? 1) / Math.max(0.1, e.cpi ?? 1);
  const rel = Math.log(ownCostIdx(e) / Math.max(1e-6, rentRel));
  if (r.hBuy0 === undefined) {
    let out = 0, rent = 0;
    for (let i = 0; i < n; i++) {
      const w = a.wt[i];
      if (a.ten[i] === TEN_OWN) out += w * (sellM + (a.age[i] >= 65 ? dissolveM(a.age[i]) : 0));
      else if (a.ten[i] === TEN_RENT || a.ten[i] === TEN_MAINLAND) rent += w;
    }
    r.hBuy0 = rent > 0 ? out / rent : 0;
    r.tenRef = rel;
    r.homesSeen = e.newHomes ?? 0;
  }
  const hBuy = r.hBuy0 * Math.exp(-BUY_ELAST * (rel - (r.tenRef ?? rel)));
  const owners: number[] = [];
  for (let i = 0; i < n; i++) if (!gone[i] && a.ten[i] === TEN_OWN) owners.push(i);
  const toOwner = (w: number) => { if (owners.length) a.wt[owners[Math.floor(R.u() * owners.length)]] += w; };
  const mRate = mortgageRate(e);
  for (let i = 0; i < n; i++) {
    if (gone[i]) continue;
    const t = a.ten[i], u = R.u();
    if (t === TEN_OWN) {
      if (u < sellM) {
        a.sav[i] += Math.max(0, a.hval[i] - a.mort[i]) * 0.94;   // less the agent's 6%
        a.ten[i] = TEN_MAINLAND; a.mort[i] = 0; a.mortPmt[i] = 0; a.hval[i] = 0;
        a.rent[i] = mainlandRent(R, r.mainRent, a, i);
        r.flow.sold = (r.flow.sold ?? 0) + a.wt[i];
      }
      continue;
    }
    if (t !== TEN_RENT && t !== TEN_MAINLAND) continue;
    if (!(u < hBuy) || !(isWorking(a.emp1[i]) || isWorking(a.emp2[i]))) continue;
    r.flow.bought = (r.flow.bought ?? 0) + a.wt[i];
    if (t === TEN_RENT) { gone[i] = 1; r.flow.movedOut += a.wt[i]; toOwner(a.wt[i]); continue; }
    const income = a.wage1[i] + a.wage2[i];
    const mo = mRate / 12, pmt = 0.20 * income / 12;
    a.ten[i] = TEN_OWN; a.rent[i] = 0;
    a.mortRate[i] = mRate; a.mortPmt[i] = pmt;
    a.mort[i] = mo > 0 ? (pmt * (1 - Math.pow(1 + mo, -360))) / mo : pmt * 360;
    a.hval[i] = a.mort[i] / 0.9;
    a.sav[i] = Math.max(0, a.sav[i] - 0.1 * a.hval[i]);
  }
  // the plats' houses, each to a household across the water
  const sold = Math.max(0, (e.newHomes ?? 0) - (r.homesSeen ?? 0));
  r.homesSeen = e.newHomes ?? 0;
  for (let k = 0; k < sold && pool.length; k++) {
    const j = pool[Math.floor(R.u() * pool.length)];
    if (gone[j] || a.ten[j] !== TEN_MAINLAND || a.wt[j] < 1) continue;
    a.wt[j] -= 1; toOwner(1);
    r.flow.bought = (r.flow.bought ?? 0) + 1;
  }
}

/**
 * A FLAT ACROSS THE WATER, AT A RENT THE HOUSEHOLD CAN CARRY (step 2): the
 * mainland's going rent with its spread, but no more than the landlord's
 * screen lets a household take on its pay (SCREEN of it — the same test an
 * island flat applies). The draw was the going rent whatever the household
 * earned, so a low earner across the water was put in a flat at twice its
 * income and evicted three months later: measured, 17% of renter households
 * a year against about 2.3% (Eviction Lab national eviction rate), which
 * mattered once the register's renters became the flats' demand.
 */
function mainlandRent(R: Rand, going: number, a: HouseholdArrays, i: number): number {
  const draw = going * Math.exp(0.25 * R.n());
  const pay = a.wage1[i] + a.wage2[i];
  return pay > 0 ? Math.min(draw, (SCREEN * pay) / 12) : draw;
}

/** A household forms in the region in place of one that dissolved: young, renting across the water. */
function formRegional(R: Rand, r: HouseholdRegister, i: number, e: Econ) {
  const a = r.a!;
  for (const k of FIELD_NAMES) (a[k] as Uint8Array)[i] = 0;
  a.id[i] = r.nextId++; a.wt[i] = r.wRegion; a.blk[i] = -1; a.emp1[i] = EMP_NONE; a.emp2[i] = EMP_NONE; a.ind1[i] = IND_NONE; a.ind2[i] = IND_NONE;
  const income = r.renterInc * medianIncome(e) * Math.exp(INCOME_SIGMA * R.n());
  fillPeople(R, a, i, [1, 0, 0, 0, 0, 0], income, e, e.unemployment ?? 0.05);
  fillMoney(R, a, i, income, false, e);
  a.ten[i] = TEN_MAINLAND; a.rent[i] = mainlandRent(R, r.mainRent, a, i);
}

/** One earner slot's gross pay this month: a wage, a pension, or unemployment insurance for its first UI_MONTHS. */
function slotIncome(x: number, wage: number, un: number): number {
  if (x === EMP_NONE) return 0;
  if (x === EMP_UNEMP) return un <= UI_MONTHS ? (UI_REPLACE * wage) / 12 : 0;
  return wage / 12;
}
/** An unemployed earner finds work at this month's rate; a returning worker takes a small cut in pay (job-loss scarring, Jacobson-LaLonde-Sullivan 1993). [S] */
function findWork(R: Rand, find: number, emp: Int32Array, wg: Float32Array, un: Uint16Array, i: number) {
  if (R.u() < find) { emp[i] = EMP_OTHER; wg[i] *= Math.exp(-0.03 + 0.08 * R.n()); un[i] = 0; }
  else if (un[i] < 65535) un[i]++;
}
function retire(emp: Int32Array, wg: Float32Array, i: number) {
  if (emp[i] !== EMP_NONE && emp[i] !== EMP_RETIRED) { emp[i] = EMP_RETIRED; wg[i] *= SS_REPLACE; }
}

/**
 * THE MONTH'S LABOUR MARKET, against the firms' heads (stage 1b). In order:
 *   1. layoffs: an industry with more of the register's earners than heads
 *      lets the difference go, earners drawn at random;
 *   2. the earners who arrived with work (EMP_OTHER) are placed in the
 *      industries with vacancies, by vacancy, and are jobless if there are none;
 *   3. the jobless take vacancies at the CPS finding rate (UE_RATE), with the
 *      scarring a return to work carries;
 *   4. what is still open is filled by households arriving for the work:
 *      working-age, renting across the water, one earner in the vacancy and a
 *      second adult who looks for work like anyone else;
 *   5. each industry's earners are paid its going rate on average (below);
 *   6. a household with nobody in work and its insurance run out may leave
 *      (LEAVE_JOBLESS_M); returned for the caller to drop.
 * An earner's industry is the employer's; its pay is the industry's cash pay
 * times its own standing — kept, in proportion, through a move between
 * industries (economy.ts pays the same rate, so an industry's payroll is its
 * earners' pay). The register is weighted, so an industry is filled to within
 * half an agent's weight; an island household (weight 1) fills what a
 * regional one (weight wRegion) would overshoot.
 */
function matchJobs(R: Rand, r: HouseholdRegister, D: Demand, e: Econ, n0: number): number[] {
  const a = r.a!;
  const N = new Float64Array(N_IND);
  const members: number[][] = Array.from({ length: N_IND }, () => []);
  // a slot is agent i's first earner (2i) or second (2i+1)
  const EMP = () => [r.a!.emp1, r.a!.emp2], IND = () => [r.a!.ind1, r.a!.ind2], WAGE = () => [r.a!.wage1, r.a!.wage2], UN = () => [r.a!.un1, r.a!.un2];
  for (let i = 0; i < r.n; i++) for (let k = 0; k < 2; k++) {
    if (!isPlaced(EMP()[k][i]) || IND()[k][i] === IND_NONE) continue;
    N[IND()[k][i]] += a.wt[i]; members[IND()[k][i]].push(2 * i + k);
  }
  const shuffle = (l: number[]) => { for (let j = l.length - 1; j > 0; j--) { const q = Math.floor(R.u() * (j + 1)); const t = l[j]; l[j] = l[q]; l[q] = t; } return l; };
  // 1. layoffs
  for (let ind = 0; ind < N_IND; ind++) {
    if (!(N[ind] > D.heads[ind])) continue;
    for (const sl of shuffle(members[ind])) {
      const i = sl >> 1, k = sl & 1, w = a.wt[i];
      if (N[ind] - D.heads[ind] < w / 2) continue;
      EMP()[k][i] = EMP_UNEMP; UN()[k][i] = 0; N[ind] -= w;
    }
  }
  const V = Float64Array.from(D.heads, (h, i) => h - N[i]);
  // an industry with room for an earner of weight w, by its vacancies (one draw)
  const pickInd = (w: number) => {
    let t = 0;
    for (let i = 0; i < N_IND; i++) if (V[i] >= w / 2) t += V[i];
    let x = R.u() * t;
    if (!(t > 0)) return -1;
    for (let i = 0; i < N_IND; i++) if (V[i] >= w / 2) { x -= V[i]; if (x < 0) return i; }
    for (let i = N_IND - 1; i >= 0; i--) if (V[i] >= w / 2) return i;
    return -1;
  };
  const med = Math.max(1, medianIncome(e));
  // an earner's standing, for one who has never had an industry: from the
  // household income its pay was drawn as part of (fillPeople: 60/40, or all)
  const standing = (i: number, k: number) => {
    const share = k === 1 ? 0.4 : r.a!.emp2[i] === EMP_NONE ? 1 : 0.6;
    const z = Math.log(Math.max(1, WAGE()[k][i] / share) / med) / INCOME_SIGMA;
    return Math.exp(WAGE_SIGMA * z - WAGE_SIGMA * WAGE_SIGMA / 2);
  };
  const place = (i: number, k: number, ind: number) => {
    const old = IND()[k][i], wg = WAGE()[k];
    wg[i] = old === IND_NONE ? D.pay[ind] * standing(i, k) : wg[i] * D.pay[ind] / Math.max(1e-9, D.pay[old]);
    EMP()[k][i] = drawFirm(R, D, ind); IND()[k][i] = ind; UN()[k][i] = 0;
    V[ind] -= r.a!.wt[i];
  };
  // 2. the earners who came with work
  const seekers: number[] = [];
  for (let i = 0; i < r.n; i++) for (let k = 0; k < 2; k++) if (EMP()[k][i] === EMP_OTHER) seekers.push(2 * i + k);
  for (const sl of shuffle(seekers)) {
    const i = sl >> 1, k = sl & 1, ind = pickInd(a.wt[i]);
    if (ind >= 0) place(i, k, ind);
    else { EMP()[k][i] = EMP_UNEMP; UN()[k][i] = 1; }
  }
  // 3. the jobless, at the finding rate, where there is a vacancy; the rest a month longer out
  const jobless: number[] = [];
  for (let i = 0; i < r.n; i++) for (let k = 0; k < 2; k++) if (EMP()[k][i] === EMP_UNEMP) jobless.push(2 * i + k);
  for (const sl of shuffle(jobless)) {
    const i = sl >> 1, k = sl & 1;
    const hire = R.u() < UE_RATE, scar = R.n();
    const ind = hire ? pickInd(a.wt[i]) : -1;
    // a returning worker takes a small cut in pay (job-loss scarring, Jacobson-LaLonde-Sullivan 1993) [S]
    if (ind >= 0) { place(i, k, ind); WAGE()[k][i] *= Math.exp(-0.03 + 0.08 * scar); }
    else if (UN()[k][i] < 65535) UN()[k][i]++;
  }
  // 4. households arriving for the work the town's own people did not take
  const wR = r.wRegion;
  const ageWork = AGE_RENT.slice(0, 5), ageTot = ageWork.reduce((t, x) => t + x, 0);
  const ageP = ageWork.map((p) => p / ageTot);
  for (let ind = 0; ind < N_IND; ind++) {
    while (V[ind] >= wR / 2) {
      const i = addAgent(r), b = r.a!;
      b.wt[i] = wR;
      const band = pick(R, ageP);
      b.age[i] = AGE_LO[band] + Math.floor(R.u() * (AGE_HI[band] - AGE_LO[band] + 1));
      b.adults[i] = 1 + pick(R, ADULTS);
      b.kids[i] = b.age[i] >= 20 && b.age[i] < 60 ? pick(R, KIDS) : 0;
      const f1 = Math.exp(WAGE_SIGMA * R.n() - WAGE_SIGMA * WAGE_SIGMA / 2);
      b.emp1[i] = drawFirm(R, D, ind); b.ind1[i] = ind; b.wage1[i] = D.pay[ind] * f1;
      V[ind] -= wR;
      if (b.adults[i] >= 2 && R.u() < 0.70) {
        const j = pickInd(wR);
        const f2 = Math.exp(WAGE_SIGMA * R.n() - WAGE_SIGMA * WAGE_SIGMA / 2);
        if (j >= 0) { b.emp2[i] = drawFirm(R, D, j); b.ind2[i] = j; b.wage2[i] = D.pay[j] * f2; V[j] -= wR; }
        else { b.emp2[i] = EMP_UNEMP; b.un2[i] = 1; b.wage2[i] = D.pay[ind] * f2; }
      }
      fillMoney(R, b, i, b.wage1[i] + b.wage2[i], false, e);
      b.ten[i] = TEN_MAINLAND; b.rent[i] = mainlandRent(R, r.mainRent, b, i);
      r.flow.arrived = (r.flow.arrived ?? 0) + wR;
    }
  }
  // 5. THE GOING RATE. An industry's pay bill is its going rate (BEA pay at
  // the town's wage index, D.pay) times its earners; who gets which share of
  // it is each earner's standing. Standing moves — a returning worker's
  // scarring, a household's draw — but the register keeps no tenure profile,
  // so without this the scar compounds spell on spell into industries that
  // pay well under their own going rate (measured, tools/economy.mjs: EBITDA
  // margins 5-20 points over the BEA's by year 30) — the same quantity with
  // two answers. Standing is kept relative: each
  // industry's earners are scaled to average its going rate.
  {
    const c = r.a!, sw = new Float64Array(N_IND), sn = new Float64Array(N_IND);
    const EMPc = [c.emp1, c.emp2], INDc = [c.ind1, c.ind2], WAGEc = [c.wage1, c.wage2];
    for (let i = 0; i < r.n; i++) for (let k = 0; k < 2; k++) {
      const ind = INDc[k][i];
      if (!isPlaced(EMPc[k][i]) || ind === IND_NONE) continue;
      sw[ind] += c.wt[i] * WAGEc[k][i]; sn[ind] += c.wt[i];
    }
    const scale = Float64Array.from(sw, (v, ind) => v > 0 ? D.pay[ind] * sn[ind] / v : 1);
    for (let i = 0; i < r.n; i++) for (let k = 0; k < 2; k++) {
      const ind = INDc[k][i];
      if (isPlaced(EMPc[k][i]) && ind !== IND_NONE) WAGEc[k][i] *= scale[ind];
    }
  }
  // 6. who leaves: nobody in work, insurance run out
  const leave: number[] = [];
  const c = r.a!;
  for (let i = 0; i < n0; i++) {
    if (c.ten[i] === TEN_RENT) continue;   // an island renter leaves through its block (the flats' roll)
    const e1 = c.emp1[i], e2 = c.emp2[i];
    if (isWorking(e1) || isWorking(e2)) continue;
    const out = (e1 === EMP_UNEMP && c.un1[i] > UI_MONTHS) || (e2 === EMP_UNEMP && c.un2[i] > UI_MONTHS);
    if (out && R.u() < LEAVE_JOBLESS_M) { leave.push(i); r.flow.left = (r.flow.left ?? 0) + c.wt[i]; }
  }
  return leave;
}

/**
 * ONE MONTH FOR EVERY HOUSEHOLD. In order: pay moves with the town's wage
 * index, rents across the water with construction cost, houses with the new-
 * house market; jobs are lost at the CPS separation rate (and with the firm,
 * when a firm closes); then the month's labour market against the firms'
 * heads (`matchJobs`; before the firm books open, the old rule: jobs found
 * at the rate that holds the register's jobless share at the town's); then
 * income less tax, the rent or mortgage, the card, spending on the
 * buffer-stock rule, a shortfall borrowed up to the card limit and what is
 * left unpaid counted as arrears; evictions and foreclosures; birthdays,
 * births, children leaving, households ending. Last, the island's blocks:
 * leases end in a move or a renewal, and each block's households are brought
 * to the flats its roll says are let.
 */
export function tickHouseholdRegister(s: GameState, parcels: ParcelTable): void {
  if (!s.econ) return;
  if (!s.households) { s.households = seedHouseholdRegister(s, parcels); return; }
  const r = s.households;
  if (!r.a) unpackHouseholds(r);
  else reviveColumns(r);
  const e = s.econ, m = s.month;
  const R = stream(s);
  const D = readDemand(s);
  const B = readBlocks(s, parcels, r);
  r.flow = { movedOut: 0, movedIn: 0, evictions: 0, foreclosures: 0, spend: 0, income: 0, arrived: 0, left: 0, bought: 0, sold: 0 };
  const wage = e.wageIdx ?? 1, cost = e.costIdx ?? 1, home = e.homes?.psf ?? wage;
  const gW = wage / Math.max(1e-9, r.wageRef), gC = cost / Math.max(1e-9, r.costRef), gH = home / Math.max(1e-9, r.homeRef);
  r.wageRef = wage; r.costRef = cost; r.homeRef = home;
  r.mainRent *= gC;
  const short = shortIndexOf(e) / 100;
  const n0 = r.n;

  // ---- jobs: indexation and separations
  let lf = 0, un = 0;
  {
    const a = r.a!;
    const lose = (emp: Int32Array, un_: Uint16Array, i: number) => {
      const x = emp[i];
      if (x === EMP_NONE || x === EMP_RETIRED) return;
      if (x !== EMP_UNEMP && ((D && isPlaced(x) && !D.live.has(x)) || R.u() < SEP_RATE)) { emp[i] = EMP_UNEMP; un_[i] = 0; }
      lf += a.wt[i];
      if (emp[i] === EMP_UNEMP) un += a.wt[i];
    };
    for (let i = 0; i < n0; i++) {
      a.wage1[i] *= gW; a.wage2[i] *= gW; a.yperm[i] *= gW;
      if (a.ten[i] === TEN_MAINLAND) a.rent[i] *= gC;
      if (a.ten[i] === TEN_OWN) a.hval[i] *= gH;
      lose(a.emp1, a.un1, i); lose(a.emp2, a.un2, i);
    }
  }
  // ---- finding work before the firm books open: the rate that holds the town's jobless share
  // (once they are open, the month's labour market runs last: matchJobs, below)
  const a = r.a!;
  const n1 = n0;
  const gone = new Uint8Array(n1);
  if (!D) {
    const target = (e.unemployment ?? 0.05) * lf;
    const find = un > 0 ? Math.max(0, Math.min(1, (un - target) / un)) : 0;
    for (let i = 0; i < n0; i++) {
      if (a.emp1[i] === EMP_UNEMP) findWork(R, find, a.emp1, a.wage1, a.un1, i);
      if (a.emp2[i] === EMP_UNEMP) findWork(R, find, a.emp2, a.wage2, a.un2, i);
    }
  }

  const persons = (i: number) => a.adults[i] + a.kids[i];
  // the region's renter households across the water: where the island's movers come from and go back to
  const pool: number[] = [];
  for (let i = 0; i < n1; i++) if (!gone[i] && a.ten[i] === TEN_MAINLAND) pool.push(i);
  for (let i = 0; i < n1; i++) {
    if (gone[i]) continue;
    const w = a.wt[i];
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
    // ...BUT THE RENT IS PAID FIRST (2026-10-28, step 2). A household short
    // of money cuts what it buys before it misses the rent or the mortgage —
    // down to the subsistence floor, drawing on its savings and its card —
    // and falls behind only when even that is not enough (Gerardi, Herkenhoff,
    // Ohanian & Willen 2018: households facing a shortfall cut consumption
    // first; most who default have no liquid assets left). It spent its
    // permanent income whatever this month's pay was, so a household whose
    // pay had fallen kept spending and missed the rent: measured, 17% of
    // renter households evicted a year against about 2.3% (Eviction Lab).
    // The subsistence floor holds while there is money for it after the rent;
    // under it, a household lives on what is left (and on what the register
    // does not yet carry: SNAP, the food bank, family) and falls behind only
    // when the rent itself cannot be met.
    const room0 = Math.max(0, CARD_LIMIT[a.credit[i]] * 12 * Math.max(0, a.yperm[i]) - Math.max(0, a.debt[i] - minPay));
    const can = a.sav[i] + net - minPay - housing + room0;
    const sub = subsistence(e, persons(i));
    const want = Math.max(sub, a.yperm[i] - housing - minPay + KAPPA * (a.sav[i] - target));
    const spend = can < 0 ? sub : Math.min(want, can);
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
      if (ten === TEN_RENT) r.flow.movedOut += w;
      // AN EVICTED HOUSEHOLD THAT STILL HAS AN INCOME RENTS AGAIN, CHEAPER
      // (step 2): most evicted families move to worse and cheaper housing in
      // the same region; doubling up is what the ones with nothing coming in
      // do (Desmond 2016, Milwaukee Area Renters Study) — here, a flat across
      // the water at the rent its pay can carry at the median burden (30%,
      // HH_RENT_SHARE0). It used to double up whatever it earned, so every
      // eviction was a renter household gone from the flats' demand.
      const pay = a.wage1[i] + a.wage2[i];
      if (gross > 0 && pay > 0) {
        if (ten === TEN_RENT) { r.flow.movedOut -= w; toMainland(R, r, i, pool, gone); continue; }
        a.rent[i] = Math.min(a.rent[i], (HH_RENT_SHARE0 * pay) / 12);
      } else { a.ten[i] = TEN_DOUBLED; a.rent[i] = 0; a.blk[i] = -1; }
    } else if (ten === TEN_OWN && a.arrears[i] >= FORECLOSE_M) {
      r.flow.foreclosures += w;
      a.arrears[i] = 0; a.ten[i] = TEN_DOUBLED; a.mort[i] = 0; a.mortPmt[i] = 0; a.hval[i] = 0;
    } else if (ten === TEN_DOUBLED && isWorking(a.emp1[i]) && a.sav[i] > 3 * r.mainRent) {
      // a doubled-up household with work and a deposit takes its own flat across the water
      a.ten[i] = TEN_MAINLAND; a.rent[i] = mainlandRent(R, r.mainRent, a, i);
    }
    // a year older on its month; births; children leaving; retirement; the end
    if ((m + a.id[i]) % 12 === 0 && a.age[i] < 110) {
      a.age[i]++;
      if (a.age[i] === 67) { retire(a.emp1, a.wage1, i); retire(a.emp2, a.wage2, i); }
    }
    if (a.adults[i] >= 2 && a.age[i] >= 20 && a.age[i] < 43 && a.kids[i] < 6 && R.u() < BIRTH_M) a.kids[i]++;
    if (a.kids[i] > 0 && a.age[i] >= 45 && R.u() < LEAVE_M * a.kids[i]) a.kids[i]--;
    if (a.age[i] >= 65 && R.u() < dissolveM(a.age[i])) {
      // the household ends and a young one forms in its place, renting across
      // the water (an island one's flat is let again from the region's renters)
      if (a.ten[i] === TEN_RENT) { if (!gone[i]) toMainland(R, r, i, pool, gone); }
      else if (!gone[i]) { formRegional(R, r, i, e); a.wt[i] = w; }
    }
  }

  // ---- who owns and who rents (step 2), then the island's blocks: leases
  // ending, then each block to the flats its roll has let — its movers in
  // from across the water and out to it (`moveIn`, `toMainland`)
  if (D) tickTenure(R, r, e, gone, pool);
  const inBlock = new Map<number, number[]>();
  for (let i = 0; i < n1; i++) {
    if (a.ten[i] !== TEN_RENT || gone[i]) continue;
    const b = B.byIdx.get(a.blk[i]);
    if (!b) { toMainland(R, r, i, pool, gone); continue; }   // the block is gone, or empty
    if (a.leaseEnd[i] <= m) {
      if (R.u() < RENTER_MOVE) { toMainland(R, r, i, pool, gone); continue; }
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
      toMainland(R, r, i, pool, gone); extra--;
    }
    for (let k = 0; k < -extra; k++) moveIn(R, r, b, e, m, pool, gone);
  }
  compact(r, gone);
  // the region's households: what the island's renters do not account for —
  // until the firm books open. From then the region's households are the
  // ones the work brought and kept (matchJobs), each standing for the weight
  // it had then: re-weighting them to the engine's population every month
  // would undo every arrival and departure.
  if (!D) {
    const H = (e.population ?? 0) / HH_SIZE;
    let islandW = 0, nReg = 0;
    const A = r.a!;
    for (let i = 0; i < r.n; i++) if (A.ten[i] === TEN_RENT) islandW += A.wt[i]; else nReg++;
    r.wRegion = Math.max(0.01, (H - islandW) / Math.max(1, nReg));
    for (let i = 0; i < r.n; i++) if (A.ten[i] !== TEN_RENT) A.wt[i] = r.wRegion;
  }
  // ---- THE MONTH'S LABOUR MARKET, last, so that the register the month
  // leaves behind is the one the firms employ: every job vacated this month
  // (a separation, a retirement, a household that moved off the island or
  // ended) is filled or left open against the heads, and the movers-in and
  // new households are placed. Hiring lands at the month's end: a household
  // already here spends on last month's pay; one that arrived for the work
  // spends its first month's (firstMonth).
  if (D) {
    const nOld = r.n;
    const leaving = matchJobs(R, r, D, e, nOld);
    for (let i = nOld; i < r.n; i++) firstMonth(r, i, e);
    const out = new Uint8Array(r.n);
    for (const i of leaving) out[i] = 1;
    compact(r, out);
  }
  // A WAVE OF NEWCOMERS (blackswans.ts `bsMigPull`, a share of the people a
  // month) lands as households renting across the water, looking for work —
  // it does not wait for a vacancy or a flat (step 2: the register is the
  // town's people, so this is where the wave lands).
  const wave = e.bsMigPull ?? 0;
  if (wave > 0 && D) {
    let persons = 0;
    for (let i = 0; i < r.n; i++) persons += r.a!.wt[i] * (r.a!.adults[i] + r.a!.kids[i]);
    const agents = Math.round((persons * wave) / HH_SIZE / Math.max(0.01, r.wRegion));
    for (let k = 0; k < agents; k++) {
      const i = addAgent(r), b = r.a!;
      const income = r.renterInc * medianIncome(e) * Math.exp(INCOME_SIGMA * R.n());
      fillPeople(R, b, i, AGE_RENT.slice(0, 5).map((x) => x / 0.86).concat([0]), income, e, 1);
      fillMoney(R, b, i, income, false, e);
      b.wt[i] = r.wRegion; b.ten[i] = TEN_MAINLAND; b.rent[i] = mainlandRent(R, r.mainRent, b, i);
      r.flow.arrived = (r.flow.arrived ?? 0) + r.wRegion;
    }
  }
  R.done();
}

/** Drop the households marked gone, keep the order, and zero the tail so a save round-trips exactly. */
function compact(r: HouseholdRegister, gone: Uint8Array): void {
  const C = r.a!, nG = gone.length;
  // (in runs of kept agents, a native copyWithin per column: an element-wise
  // copy across 28 kinds of typed array is megamorphic and cost ~40 ms a month)
  let j = 0;
  for (let i = 0; i < r.n;) {
    if (i < nG && gone[i]) { i++; continue; }
    let end = i + 1;
    while (end < r.n && !(end < nG && gone[end])) end++;
    if (j !== i) for (const k of FIELD_NAMES) (C[k] as Uint8Array).copyWithin(j, i, end);
    j += end - i; i = end;
  }
  for (const k of FIELD_NAMES) (C[k] as Uint8Array).fill(0, j, r.n);
  r.n = j;
}

/** A household that arrived for work this month: its first pay, its rent, and what it spends on the buffer-stock rule. */
function firstMonth(r: HouseholdRegister, i: number, e: Econ): void {
  const a = r.a!, w = a.wt[i];
  const gross = slotIncome(a.emp1[i], a.wage1[i], a.un1[i]) + slotIncome(a.emp2[i], a.wage2[i], a.un2[i]);
  const net = gross * (1 - taxRate(gross * 12, e));
  const housing = a.rent[i];
  const target = bufferMonths(a.age[i]) * a.yperm[i];
  const spend = Math.max(subsistence(e, a.adults[i] + a.kids[i]), a.yperm[i] - housing + KAPPA * (a.sav[i] - target));
  a.sav[i] = Math.max(0, a.sav[i] + net - spend - housing);
  r.flow.spend += w * spend; r.flow.income += w * net;
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
  let employed = 0, hh = 0, persons = 0, island = 0, main = 0, own = 0, dbl = 0, lf = 0, un = 0, arrears = 0, withDebt = 0;
  const burden: number[] = [], bw: number[] = [], sav: number[] = [], debt: number[] = [], ww: number[] = [], sm: number[] = [];
  for (let i = 0; i < r.n; i++) {
    const w = a.wt[i];
    hh += w; persons += w * (a.adults[i] + a.kids[i]);
    const t = a.ten[i];
    if (t === TEN_RENT) island += w; else if (t === TEN_MAINLAND) main += w; else if (t === TEN_OWN) own += w; else dbl += w;
    for (const emp of [a.emp1, a.emp2]) { const x = emp[i]; if (x !== EMP_NONE && x !== EMP_RETIRED) { lf += w; if (x === EMP_UNEMP) un += w; else employed += w; } }
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
    /** earners in work (weighted): once the firm books open, the firms' heads */
    employed, laborForce: lf,
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
  persons: number; ownerValue: number;
} | null {
  const r = s.households;
  if (!r || !s.econ) return null;
  if (!r.a) unpackHouseholds(r);
  const a = r.a!, e = s.econ;
  // once the firm books run, an earner not yet placed with one of their firms
  // (a household that moved in after this month's hiring) is paid from next month
  const books = s.economy?.cur?.m === s.month;
  let wages = 0, pensions = 0, ui = 0, tax = 0, taxLocal = 0, rent = 0, mortgage = 0, ownerCost = 0, hh = 0, persons = 0, ownerValue = 0;
  const slot = (x: number, wage: number, un: number, w: number) => {
    if (x === EMP_NONE || (books && x === EMP_OTHER)) return 0;
    if (x === EMP_RETIRED) { pensions += w * wage / 12; return wage / 12; }
    if (x === EMP_UNEMP) { const v = un <= UI_MONTHS ? (UI_REPLACE * wage) / 12 : 0; ui += w * v; return v; }
    wages += w * wage / 12; return wage / 12;
  };
  for (let i = 0; i < r.n; i++) {
    const w = a.wt[i];
    hh += w; persons += w * (a.adults[i] + a.kids[i]);
    const gross = slot(a.emp1[i], a.wage1[i], a.un1[i], w) + slot(a.emp2[i], a.wage2[i], a.un2[i], w);
    const t = taxRate(gross * 12, e);
    tax += w * gross * t;
    taxLocal += w * gross * Math.min(t, 0.04);   // the state-and-local part of TAX_RATES (ITEP, above)
    const ten = a.ten[i];
    if (ten === TEN_RENT || ten === TEN_MAINLAND) rent += w * a.rent[i];
    else if (ten === TEN_OWN) { if (a.mort[i] > 0) mortgage += w * a.mortPmt[i]; ownerCost += w * (TAX_INS / 12) * a.hval[i]; ownerValue += w * a.hval[i]; }
  }
  // TAX_INS is ~1.0 points of property tax and ~0.5 of insurance (homeprice.ts)
  return { wages, pensions, ui, tax, taxLocal, rent, mortgage, propertyTax: ownerCost * (1 / 1.5), homeInsurance: ownerCost * (0.5 / 1.5), spend: r.flow.spend, households: hh, persons, ownerValue };
}

/**
 * EACH INDUSTRY'S PAYROLL, AS ITS EARNERS ARE PAID: the register's working
 * earners' pay a month (cash, weighted) and their number, by the industry
 * of the firm they work for. economy.ts pays its firms' wages out of exactly
 * this, so the firms' payroll and the households' wages are one number.
 * Earners not yet placed with a firm (the register before the books open)
 * are not in it. Pure.
 */
export interface RegisterLabour {
  /** earners in work (placed with a firm, or arrived with work not yet placed), out of work, and both */
  employed: number; unemployed: number; lf: number;
  persons: number; households: number;
  /** children; adults in households headed under 65; adults in households headed 65 and over */
  ages: { kids: number; work: number; old: number };
  /** renter households: on the island, and across the water; owners; doubled up */
  islandRenters: number; mainlandRenters: number; owners: number; doubled: number;
}
/**
 * THE REGISTER'S PEOPLE AND ITS LABOUR FORCE, weighted (step 2): what the
 * engine's labour block reads as the town's employment, unemployment,
 * participation, population and age mix (economy.ts `economyToEngine`).
 * One pass, no sorting. Pure.
 */
export function registerLabour(s: GameState): RegisterLabour | null {
  const r = s.households;
  if (!r) return null;
  if (!r.a) unpackHouseholds(r);
  const a = r.a!;
  const out: RegisterLabour = { employed: 0, unemployed: 0, lf: 0, persons: 0, households: 0, ages: { kids: 0, work: 0, old: 0 }, islandRenters: 0, mainlandRenters: 0, owners: 0, doubled: 0 };
  for (let i = 0; i < r.n; i++) {
    const w = a.wt[i];
    out.households += w;
    out.persons += w * (a.adults[i] + a.kids[i]);
    out.ages.kids += w * a.kids[i];
    if (a.age[i] >= 65) out.ages.old += w * a.adults[i]; else out.ages.work += w * a.adults[i];
    const t = a.ten[i];
    if (t === TEN_RENT) out.islandRenters += w; else if (t === TEN_MAINLAND) out.mainlandRenters += w; else if (t === TEN_OWN) out.owners += w; else out.doubled += w;
    for (const x of [a.emp1[i], a.emp2[i]]) {
      if (x === EMP_NONE || x === EMP_RETIRED) continue;
      if (x === EMP_UNEMP) out.unemployed += w; else out.employed += w;
    }
  }
  out.lf = out.employed + out.unemployed;
  return out;
}

export function registerPayroll(s: GameState): { wages: Float64Array; earners: Float64Array } | null {
  const r = s.households;
  if (!r) return null;
  if (!r.a) unpackHouseholds(r);
  const a = r.a!;
  const wages = new Float64Array(N_IND), earners = new Float64Array(N_IND);
  for (let i = 0; i < r.n; i++) {
    const w = a.wt[i];
    if (isPlaced(a.emp1[i]) && a.ind1[i] !== IND_NONE) { wages[a.ind1[i]] += w * a.wage1[i] / 12; earners[a.ind1[i]] += w; }
    if (isPlaced(a.emp2[i]) && a.ind2[i] !== IND_NONE) { wages[a.ind2[i]] += w * a.wage2[i] / 12; earners[a.ind2[i]] += w; }
  }
  return { wages, earners };
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
    if (v === undefined && FIELD_DEFAULT[k] !== undefined) { (a[k] as Uint8Array).fill(FIELD_DEFAULT[k]!, 0, r.n); continue; }
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
    if (!b64) { if (FIELD_DEFAULT[k] !== undefined) (a[k] as Uint8Array).fill(FIELD_DEFAULT[k]!, 0, r.n); continue; }   // a save from before the column
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
