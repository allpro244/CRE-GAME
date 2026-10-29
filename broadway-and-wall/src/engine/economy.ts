// THE CITY'S FIRM BOOKS — ONE ECONOMY, STEPS 1 AND 2 (2026-10-28).
//
// Every named firm in town — each tenant with a firm id in the street's
// rolls, the player's buildings and the queue of firms looking for space —
// and a weighted sample of the firms that are not on the map, each with an
// INDUSTRY (industries.ts) and its own books:
//
//   revenue      by buyer: households, other firms, government, building
//                projects, the rest of the country
//   - wages      its industry's payroll as the household register's earners
//                are paid (households.ts `registerPayroll`), shared by heads
//   - inputs     bought from the other industries by the IO table's row, the
//                local share from local firms, the rest from outside
//   - rent       a named firm's lease; an off-map firm's market rent
//   - production tax, interest, income tax
//   = cash, debt, equity
//
// Each month runs in two halves round the household register (sim.ts):
//   tickFirms     firms open and close and every industry's heads are set —
//                 the named firms' the engine's own, the rest staffing toward
//                 what their industry sold (`staff`, at the hiring and firing
//                 lags), exports from the nation's demand for the industry and
//                 the town's share of it (`exportHeads`); that is the labour
//                 demand the register's earners are matched to;
//   tickEconomy   the industries' output is SOLVED from final demand — the
//                 register's spending, the government's own provision, what
//                 the town buys of the trades (new building, houses, repairs
//                 to the standing stock, public works), health care's
//                 insurers and Washington, and exports — through the
//                 input-output table, every purchase
//                 either made in town (the local purchase coefficient) or
//                 leaking out. Each industry's output is the revenue of its
//                 firms, shared by size and fortune.
// Every dollar moves through the ledger (sfc.ts), so the whole city
// reconciles: the sum of every account is zero.
//
// STEP 2 (2026-10-28): THE MONEY LOOP DRIVES THE TOWN. The ticks still read
// the state and write only `s.economy` and their own stream; what the world
// reads of them is written once a month, after the household register has
// filled the heads, by `economyToEngine` (sim.ts) into `s.econ.eco` — and the
// engine reads that the month after, as a statistician reads last month's
// payrolls:
//   jobs          the town's employment is the register's earners in work, who
//                 are the firms' heads; unemployment, participation and the
//                 population are the register's (market.ts, the labour block);
//   the trades    each trade's employment and sales are its industries'
//                 (`e.firmBooks`, now a read-out, not a second set of books);
//                 the street's firms staff to their own industry's employment
//                 and new ones form toward the island's share of it
//                 (streetRolls.ts);
//   space         each class's demand driver is the floor its industries'
//                 heads take — on the floor, not at home, not in a hospital,
//                 school, depot or yard (industries.ts OFF_FLOOR, REMOTE) — and
//                 flats' is the register's renter households (market.ts).
// What the town sells the nation follows the nation's demand for each
// industry (its CES trend, its cycle) and the town's share of it, which moves
// with what the town costs an employer and with its firms' own fortunes; the
// rest of the town's work is what that export base and its people buy, through
// the input-output table and the register's spending, net of every leak.
// `tools/economy.mjs` reports it; `test/economy.mjs` holds its identities.
//
// STORAGE: the firms are columns (typed arrays) beside the ledger's slot
// columns of cash and debt — firm n is ledger slot n — so a month allocates
// little and the state clone each month copies arrays, not objects. A JSON
// round trip turns a column into a plain object; `reviveEconomy` mends it.
//
// [S] a fact with a source, [D] derived from one by stated arithmetic, [K] a
// shape parameter, stated as one (CLAUDE.md).
import type { BuiltClass, EcoDrive, GameState, Sector, Tenant } from "./types";
import { BUILT_CLASSES } from "./types";
import {
  INDUSTRIES, INDUSTRY_IDS, N_IND, INDUSTRY_INDEX, IO_A, IO_ROW_SUM, NAT_EMP_SHARE, TRADE_TO_INDUSTRY, FLOOR_DEFAULT,
  FINANCE_LIKE, SPEND_SHARE, SPEND_BRIDGE, PAY_SPLIT, PROD_TAX_LOCAL, CORP_TAX, LOCAL_OWNER_SHARE,
  COMP_PER_WORKER_2023, BUYER_TYPES, REPAIR_PER_COMMERCIAL_RENT, REPAIR_PER_FLAT_RENT, REPAIR_OWNER_PER_VALUE_YR,
  OIL_PRICE_2000, OIL_PER_SHOCK, OIL_RISE_M, OIL_HALF_LIFE_M,
  OFF_FLOOR, REMOTE, floorOf, NAT_TREND, CYCLE_BETA, FED_HEALTH_PER_PERSON_2023, MLR,
  type IndustryId, type Floor, type BuyerType, type SpendCategory,
} from "./industries";
import {
  type Ledger, newLedger, transfer, lend, repay, chargeOff, openDebt, sellBond, ledgerSum, ledgerGross, newMonth, ACCOUNTS,
  cashOf, debtOf, addSlot, compactSlots, reviveF64, reviveLedger,
} from "./sfc";
import {
  SF_PER_JOB, FIRM_PROFILE, LENDER_COVER, shortIndexOf, BUILD_MONTHS, SECTORS,
  LABOUR_FORCE_SLOWDOWN, FORTUNE_SD, FORTUNE_TAU_M, NAT_TREND_SD, NAT_TREND_TAU_M, NAT_SALES_PER_GAP, LOCATION_PULL, locationCost,
} from "./market";
import { HARD_COST_PSF, SOFT_COST, CONTINGENCY, constructionTypeMult } from "./value";
import { householdMoney, registerPayroll, registerLabour } from "./households";
import { why, whyOnce, whyNation, whyTenantBooks } from "./why";

// ---------------------------------------------------------------- the facts
/** Off-map firms kept per industry: the sample each industry's off-map employment is shared over. [K] (precision, not a fact) */
export const OFF_PER = 6;
/**
 * The off-map sample's fortunes. A named firm reads its tenant books' own
 * draw (tenantBooks.ts Z_SIG, a single firm's). An off-map "firm" is a sixth
 * of an industry's off-map employment — many firms — so its fortune is their
 * average and far narrower than one firm's; since sales are shared against
 * each group's own mean (tickEconomy, step 6), this only moves sales between
 * the six, never between the map and the rest of the industry. [K] precision,
 * not a fact: the tenant books' persistence, at the older single-firm step.
 */
const Z_RHO = 0.985, Z_SIG = 0.033;
/** Months of costs a firm keeps in cash; surplus over it paid out at 15% a month (tenantBooks.ts CASH_KEEP_M; JPMorgan Chase Institute 2016). [S] */
const CASH_KEEP_M = 1.5, PAYOUT_M = 0.15;
/** Debt moves toward what a lender would write over three years (market.ts tickFirmBook, tenantBooks.ts). [K] */
const DEBT_ADJ_M = 36;

const IND_GOV = INDUSTRY_INDEX.government, IND_CON = INDUSTRY_INDEX.construction, IND_SHOPS = INDUSTRY_INDEX.shops, IND_FUL = INDUSTRY_INDEX.fulfil;
const IND_HE = INDUSTRY_INDEX.healthedu, IND_INS = INDUSTRY_INDEX.insurance;
const FLOORS: readonly Floor[] = ["office", "retail", "industrial"];
const NO_SEC = 255;

// ---------------------------------------------------------------- state
/** The firms, one column per field; firm n is ledger slot n. */
const F64 = ["hc", "z", "eq", "rev", "wages", "inputs", "rent", "prodTax", "interest", "incomeTax", "payout", "ebitda",
  // the last twelve months' revenue, a ring by month (REV_RING): the firm page's sparkline. Read by nothing in the world.
  "h0", "h1", "h2", "h3", "h4", "h5", "h6", "h7", "h8", "h9", "h10", "h11"] as const;
/** Revenue history columns, indexed by month mod 12. */
export const REV_RING = ["h0", "h1", "h2", "h3", "h4", "h5", "h6", "h7", "h8", "h9", "h10", "h11"] as const;
type F64Name = typeof F64[number];
export type FirmColumns = { [K in F64Name]: Float64Array } & {
  /** A named firm's id (Tenant.fid, >= 0), or an off-map firm's (< 0). */
  id: Float64Array;
  /** Index into INDUSTRY_IDS. */
  ind: Uint8Array;
  /** The engine trade it was drawn from (index into SECTORS; 255 for none). */
  sec: Uint8Array;
  /** The month its books opened. */
  openM: Float64Array;
};
// hc: heads this month (named: the engine's own headcount; off-map: its share of the sample)
// z: own fortune, log sales against its industry's
// eq: book equity — opening net worth plus retained earnings. Fixed assets are
//     not on these books, so equity == cash - debt, which test/economy.mjs asserts.
// rev .. ebitda: last month's lines.

export interface EconomyMonth {
  m: number;
  /** Final demand, a month: households (non-housing), government, building projects, exports. */
  C: number; G: number; P: number; X: number;
  /** The register's wages, and the cash wages the firms' books paid. */
  hhWagesRegister: number; hhWagesFirms: number;
  /** Output by industry, its buyers [households, firms, government, construction, exports], heads (engine) and the heads the output implies. */
  x: number[]; buy: number[][]; heads: number[]; namedHeads: number[]; impliedHeads: number[];
  /** The ledger's identity residual and the market clearing account after the month. */
  ledgerSum: number; ledgerGross: number; market: number;
  iters: number;
  /** Each industry's employment (what its firms staff to: `staff`), the town's jobs as the engine read them, and the register's earners by industry. */
  engHeads?: number[]; jobsEngine?: number; regEarners?: number[];
  /** Health care bought for the register's people by employers' insurance and by Washington, a month. */
  health?: { employers: number; federal: number };
  /** What construction was bought for, a month. */
  con?: ConstructionDemand;
  /** The nation's oil price, $ a barrel, and its real level against the opening. */
  oil?: number; oilReal?: number;
}

export interface EconomyState {
  v: 1;
  openM: number;
  /** Firms in use = L.slot.n. */
  f: FirmColumns;
  nextOff: number;
  L: Ledger;
  /** Calibration, at the opening. */
  w0: number; lnY0: number; manuf0: number;
  /** Local purchase coefficient by commodity: the share of the town's use of it bought from the town's own firms. */
  rpc: number[];
  /** Exports a month at the opening, and the signal each moves with. */
  X0: number[]; sig0: number[];
  /** Output per worker of the trades behind each industry at the opening (exports are priced at unit labour cost: pay over it). */
  prod0: number[];
  /** Engine trades behind each industry's exports: heads at the opening. */
  sigW: Partial<Record<Sector, number>>[];
  last: EconomyMonth | null;
  /** The nation's technology level at the opening (market.ts nat.techLn): off-map exports are priced at unit labour cost against it. */
  tech0?: number;
  /** This month's labour demand (tickFirms, read by the household register): heads by industry, the named firms' part, and the engine's way of sizing them. */
  cur?: { m: number; heads: number[]; named: number[]; eng: number[] };
  /** The public payroll and the register's people at the opening: government heads follow the people (demandHeads). */
  gov0?: number; persons0?: number;
  /** The oil price (tickOil): its real log level, the nation's prices at the opening, and $ a barrel. */
  lnOil?: number; natCpi0?: number; oil?: number;
  // ---- step 2
  /** Each industry's employment: what its firms staff to, moving toward the heads its output needs (`staff`); last month's; the opening's. */
  emp?: number[]; empPrev?: number[]; emp0?: number[];
  /** Exports at the opening in heads (dollars over output per head): what the nation's demand index multiplies. */
  XJ0?: number[];
  /**
   * What the nation buys (`tickExports`): its employment in each industry, log
   * against the opening, and that industry's national trend now; the town's
   * share of it, log against the opening, and the local fortune moving it; the
   * national output gap at the opening; the level the black swans have moved
   * the town's employers by (log).
   */
  lnNat?: number[]; natTr?: number[]; lnShare?: number[]; fort?: number[]; gap0?: number; swanLn?: number;
  /** The island's share of each industry at the opening: its named firms' heads over its heads. */
  sigma?: number[];
  /** Output at the opening (the trades' sales read-out). */
  x0?: number[];
  /**
   * The past year, rolled (a twelve-month moving average, updated in
   * `tickEconomy`): each industry's employment, exports, what households and
   * other firms bought of it, the town's share of the nation's demand (log),
   * and the town's heads and household spending — what the cause ledger's
   * "since a year ago" reads (why.ts). Records; nothing decides on it.
   */
  ema?: { emp: number[]; X: number[]; hh: number[]; firms: number[]; share: number[]; heads: number; C: number };
  /** The last 13 months by industry, oldest first, for the screens: output, heads, exports, EBITDA margin. Read by nothing in the world. */
  ih?: { m: number; x: number[]; heads: number[]; ex: number[]; mg: number[] }[];
}

function allocCols(cap: number): FirmColumns {
  const c = { id: new Float64Array(cap), ind: new Uint8Array(cap), sec: new Uint8Array(cap), openM: new Float64Array(cap) } as FirmColumns;
  for (const k of F64) c[k] = new Float64Array(cap);
  return c;
}
const COLS = (c: FirmColumns) => [c.id, c.ind, c.sec, c.openM, ...F64.map((k) => c[k])] as (Float64Array | Uint8Array)[];
function growCols(E: EconomyState): void {
  const cap = E.L.slot.cash.length;
  if (E.f.id.length >= cap) return;
  const nc = allocCols(cap), n = E.L.slot.n;
  const from = COLS(E.f), to = COLS(nc);
  for (let k = 0; k < from.length; k++) (to[k] as Float64Array).set((from[k] as Float64Array).subarray(0, n));
  E.f = nc;
}
/** A new firm: a ledger slot and a row of columns. */
function addFirm(E: EconomyState, id: number, ind: number, sec: number, hc: number, z: number, m: number): number {
  const n = addSlot(E.L);
  growCols(E);
  const c = E.f;
  c.id[n] = id; c.ind[n] = ind; c.sec[n] = sec; c.openM[n] = m;
  for (const k of F64) c[k][n] = 0;
  c.hc[n] = hc; c.z[n] = z;
  return n;
}

/** Mend a state whose columns went through JSON (the household register's fault, the same repair). */
export function reviveEconomy(E: EconomyState): void {
  reviveLedger(E.L);
  const cap = E.L.slot.cash.length;
  const c = E.f as unknown as Record<string, unknown>;
  if (COLS(E.f).every((a) => ArrayBuffer.isView(a))) return;
  const out = allocCols(cap);
  const toU8 = (v: unknown) => { const a = new Uint8Array(cap); a.set(reviveF64(v, cap)); return a; };
  out.id = reviveF64(c.id, cap); out.openM = reviveF64(c.openM, cap);
  out.ind = toU8(c.ind); out.sec = toU8(c.sec);
  for (const k of F64) out[k] = reviveF64(c[k], cap);
  E.f = out;
}

// ---------------------------------------------------------------- the stream
function streamSeed(seed: number): number {
  let h = (2166136261 ^ (seed >>> 0)) >>> 0;
  const ch = "economy";
  for (let i = 0; i < ch.length; i++) { h ^= ch.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) || 1;
}
type Rand = { u: () => number; n: () => number; done: () => void };
/** A draw on `s.streams.economy` only — never `s.rng` or any other channel (mulberry32, step for step market.ts). */
function stream(s: GameState): Rand {
  let st = (s.streams?.economy ?? streamSeed(s.seed ?? 1)) | 0;
  const u = () => {
    st = (st + 0x6d2b79f5) | 0;
    let t = Math.imul(st ^ (st >>> 15), 1 | st);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const n = () => { const a = Math.max(1e-12, u()), b = u(); return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b); };
  return { u, n, done: () => { if (s.streams) s.streams.economy = st; } };
}
/** The stream's step, for the harness that holds it equal to market.ts mulberry32Step. */
export function economyStreamStep(st: number): number {
  return stream({ streams: { economy: st }, seed: 1 } as unknown as GameState).u();
}

// ---------------------------------------------------------------- reading the town
interface Seen { sec: Sector; floor: Floor; hc: number; rentMo: number; z: number; ind?: number }
/** Heads a tenant stands for: its headcount in reference feet (streetRolls.ts `firmHc`) over the engine's feet per job. */
function headsOf(t: Tenant, floor: Floor): number {
  return (t.hcRef ?? t.sf) * (t.staff ?? 1) / Math.max(0.2, t.staffSign ?? 1) / SF_PER_JOB[floor];
}
/** Every named firm in town, in the engine's own order. Pure. */
function readFirms(s: GameState): Map<number, Seen> {
  const out = new Map<number, Seen>();
  const m = s.month;
  const add = (t: Tenant, housed: boolean) => {
    if (t.fid === undefined || out.has(t.fid)) return;
    const floor = (t.use ?? "office") as Floor;
    if (!FLOORS.includes(floor)) return;
    const rentYr = housed && m >= (t.freeUntilM ?? -1) ? t.rentPsf * t.sf : 0;
    out.set(t.fid, { sec: t.sector, floor, hc: headsOf(t, floor), rentMo: rentYr / 12, z: t.fin?.z ?? 0, ind: t.ind });
  };
  for (const roll of Object.values(s.econ.streetRolls ?? {})) for (const t of roll.t) add(t, true);
  for (const h of Object.values(s.holdings)) for (const t of h.tenants ?? []) add(t, true);
  for (const k of s.econ.seekers ?? []) if (k.t) add(k.t, false);
  return out;
}

/** What the town spends a month on building: the pipeline at the cost of building it (value.ts underwriting), spread over its build. */
function buildingSpend(s: GameState): number {
  const e = s.econ;
  let out = 0;
  for (const k of BUILT_CLASSES) {
    const sf = e.pipeline?.[k] ?? 0;
    if (!(sf > 0)) continue;
    const psf = HARD_COST_PSF[k] * constructionTypeMult(k, 3) * (e.costIdx ?? 1) * (1 + SOFT_COST) * (1 + CONTINGENCY);
    const months = (BUILD_MONTHS[k][0] + BUILD_MONTHS[k][1]) / 2;
    out += sf * psf / months;
  }
  return out;
}

/** Market rent, $/sf a year, for the floor an industry uses ("special" floors at the office index). */
function marketRent(s: GameState, ind: number): number {
  const sp = INDUSTRIES[INDUSTRY_IDS[ind]].space;
  const k: BuiltClass = sp === "retail" ? "retail" : sp.startsWith("industrial") ? "industrial" : "office";
  return s.econ.rentIdx?.[k] ?? 0;
}

// ---------------------------------------------------------------- per-industry money
/** Output per head and pay per head, a month, in the town's dollars (reference 2023 dollars x the wage index). */
function perHead(w: number) {
  const opw = new Float64Array(N_IND), pay = new Float64Array(N_IND);
  for (let i = 0; i < N_IND; i++) {
    const I = INDUSTRIES[INDUSTRY_IDS[i]];
    // Output per head moves with pay: unit-labour-cost pricing and a stable
    // labour share (Kaldor's facts; the BEA labour share has moved a few
    // points in seventy years). [K]
    opw[i] = I.outPerWorkerK * 1000 * w / 12;
    pay[i] = COMP_PER_WORKER_2023 * I.wageRel * w / 12;
  }
  return { opw, pay };
}

/** The household dollar by industry (purchaser -> producer), and the share of it that is primary goods (always imported). */
function spendVector(online: number): { v: Float64Array; primary: number } {
  const v = new Float64Array(N_IND);
  let primary = 0;
  for (const cat of Object.keys(SPEND_SHARE) as SpendCategory[]) {
    const sh = SPEND_SHARE[cat];
    for (const [k, x] of Object.entries(SPEND_BRIDGE[cat])) {
      if (k === "primary") { primary += sh * (x ?? 0); continue; }
      v[INDUSTRY_INDEX[k as IndustryId]] += sh * (x ?? 0);
    }
  }
  // the online share of a shop's margin is earned by a seller shipping from a shed
  const moved = v[IND_SHOPS] * Math.max(0, Math.min(1, online));
  v[IND_SHOPS] -= moved; v[IND_FUL] += moved;
  return { v, primary };
}

/** Each industry's own purchases per $ of its output: bought locally, and leaking out (imports and primary goods). */
function inputSplit(rpc: readonly number[]) {
  const loc = new Float64Array(N_IND), imp = new Float64Array(N_IND);
  for (let i = 0; i < N_IND; i++) {
    const row = IO_A[INDUSTRY_IDS[i]];
    let l = 0;
    for (let j = 0; j < N_IND; j++) l += row[j] * rpc[j];
    loc[i] = l;
    imp[i] = IO_ROW_SUM[INDUSTRY_IDS[i]] - l + INDUSTRIES[INDUSTRY_IDS[i]].primary;
  }
  return { loc, imp };
}

/** A[i][j] flattened, row i = buyer. */
const A_FLAT = (() => {
  const a = new Float64Array(N_IND * N_IND);
  for (let i = 0; i < N_IND; i++) for (let j = 0; j < N_IND; j++) a[i * N_IND + j] = IO_A[INDUSTRY_IDS[i]][j];
  return a;
})();

/**
 * THE MONTH'S OUTPUT: x = rpc . (A'x + f) + X, by fixed-point iteration from
 * last month's (it converges: no industry buys more than ~45 cents of local
 * inputs per dollar, so the local Leontief inverse's series is short).
 */
function solve(rpc: readonly number[], f: Float64Array, X: Float64Array, x0: readonly number[] | null): { x: Float64Array; iters: number } {
  let x = new Float64Array(N_IND), nx = new Float64Array(N_IND);
  for (let i = 0; i < N_IND; i++) x[i] = x0?.[i] ?? X[i] + f[i];
  let it = 0;
  for (; it < 200; it++) {
    let worst = 0;
    for (let j = 0; j < N_IND; j++) {
      let d = f[j];
      for (let i = 0; i < N_IND; i++) d += A_FLAT[i * N_IND + j] * x[i];
      nx[j] = rpc[j] * d + X[j];
      worst = Math.max(worst, Math.abs(nx[j] - x[j]) / Math.max(1, nx[j]));
    }
    const t = x; x = nx; nx = t;
    if (worst < 1e-12) break;
  }
  return { x, iters: it + 1 };
}

// ---------------------------------------------------------------- firms
function financing(ind: number) {
  const like = FINANCE_LIKE[INDUSTRY_IDS[ind]];
  return like ? FIRM_PROFILE[like] : null;
}

/**
 * Industry for a named firm new to the books: its trade on its floor, by US
 * employment. A firm is what its name says it is: a law firm is professional
 * services, never a headquarters. (Until 2026-10-29 any office firm was drawn
 * a headquarters at HQ_SHARE, and the firm screens (#521) showed "Ashe &
 * Porter LLP" as a company's head office losing 25% on its sales.) The
 * town's head offices are the goods trades' desks (TRADE_TO_INDUSTRY: a food
 * or apparel firm's office) and the off-map sample's.
 */
function assign(R: Rand, sec: Sector, floor: Floor, intended?: number): number {
  R.u(); const b = R.u();   // always two draws: the stream's pace does not depend on the answer
  // a firm the street formed for an industry's work (streetRolls.ts) is in that industry
  if (intended !== undefined && intended >= 0 && intended < N_IND) return intended;
  const opts = TRADE_TO_INDUSTRY[floor][sec];
  if (!opts || !opts.length) return INDUSTRY_INDEX[FLOOR_DEFAULT[floor]];
  const tot = opts.reduce((t, o) => t + o[1], 0);
  let x = b * tot;
  for (const [k, w] of opts) { x -= w; if (x < 0) return INDUSTRY_INDEX[k]; }
  return INDUSTRY_INDEX[opts[opts.length - 1][0]];
}

/**
 * Open a firm's books: CASH_KEEP_M months of its costs in the bank.
 *
 * AT THE OPENING the town's firms already exist: the cash is a deposit the
 * bank owes them, and each carries the debt its trade carries — FIRM_PROFILE's
 * debt over EBITDA, no more than keeps interest covered LENDER_COVER times at
 * today's rate (market.ts tickFirmBook, the same rule) — on its industry's
 * normal margin (BEA gross operating surplus). Opening stocks, booked once.
 *
 * AFTERWARDS a firm that appears is new money arriving: its founders' or its
 * parent's capital, paid in from outside the town (the rest of the country),
 * and no debt until it borrows like everyone else. Minting it from the bank
 * would be money from nowhere.
 */
function openBooks(E: EconomyState, n: number, opwM: number, short: number, opening: boolean) {
  const L = E.L, c = E.f, ind = c.ind[n];
  const I = INDUSTRIES[INDUSTRY_IDS[ind]];
  const rev = c.hc[n] * opwM;
  const cash = CASH_KEEP_M * rev * (1 - I.gos);
  if (!opening) {
    transfer(L, ACCOUNTS.rest, n, cash, "capital", "row>firm:capital in");
    c.eq[n] = cash;
    return;
  }
  const P = financing(ind);
  const debt = P ? Math.min(P.lev, 1 / (Math.max(0.01, short + P.spread) * LENDER_COVER)) * 12 * I.gos * rev : 0;
  transfer(L, ACCOUNTS.bank, n, cash, "open", "bank>firm:opening deposits");
  openDebt(L, n, debt);
  c.eq[n] = cash - debt;
}

function payOwners(L: Ledger, n: number, amt: number) {
  transfer(L, n, ACCOUNTS.households, amt * LOCAL_OWNER_SHARE, "payout", "firm>hh:payout");
  transfer(L, n, ACCOUNTS.rest, amt * (1 - LOCAL_OWNER_SHARE), "payout", "firm>row:payout");
}
/** A firm gone (closed, left town, or out of the engine's sight): its cash to its owners, its debt charged off. */
function closeBooks(L: Ledger, n: number) {
  const cash = cashOf(L, n);
  if (cash > 0) {
    // the local owners' share, then every cent that is left (two products of one balance need not sum to it in floating point)
    transfer(L, n, ACCOUNTS.households, cash * LOCAL_OWNER_SHARE, "payout", "firm>hh:payout");
    transfer(L, n, ACCOUNTS.rest, cashOf(L, n), "payout", "firm>row:payout");
  }
  else if (cash < 0) transfer(L, ACCOUNTS.bank, n, -cash, "overdraft", "bank>firm:overdraft at closing");
  chargeOff(L, n);
}

/**
 * THE OFF-MAP FIRMS AT THE OPENING (step 2). The town's employment (e.jobs)
 * less the named firms' heads holds, first, the work that serves the region's
 * people from buildings of its own — government at its national share of the
 * town's jobs, health and education's off-floor part at its own (industries.ts
 * OFF_FLOOR; the town's size counts them, market.ts `citySize`) — and
 * construction at what the town buys of it; then the rest toward the nation's
 * industry mix, to the industries the street leaves short. If the residual
 * cannot hold the first three they share what there is.
 */
function openingOffMap(s: GameState, named: Float64Array, conOpen: number): Float64Array {
  const jobs = s.econ.jobs ?? 0;
  let namedTot = 0;
  for (let i = 0; i < N_IND; i++) namedTot += named[i];
  let O = Math.max(0, jobs - namedTot);
  const out = new Float64Array(N_IND);
  const gov = Math.max(0, NAT_EMP_SHARE.government * jobs - named[IND_GOV]);
  const he = NAT_EMP_SHARE.healthedu * OFF_FLOOR.healthedu * jobs;
  const fixed = gov + he + conOpen;
  const k = fixed > O ? O / fixed : 1;
  out[IND_GOV] = k * gov; out[IND_HE] = k * he; out[IND_CON] = k * conOpen;
  O -= k * fixed;
  const d = new Float64Array(N_IND);
  let dt = 0;
  for (let i = 0; i < N_IND; i++) {
    if (i === IND_CON || i === IND_GOV) continue;
    const share = NAT_EMP_SHARE[INDUSTRY_IDS[i]] * (i === IND_HE ? 1 - OFF_FLOOR.healthedu : 1);
    d[i] = Math.max(0, share * jobs - named[i]);
    dt += d[i];
  }
  for (let i = 0; i < N_IND; i++) {
    if (i === IND_CON || i === IND_GOV) continue;
    out[i] += O * (dt > 0 ? d[i] / dt : NAT_EMP_SHARE[INDUSTRY_IDS[i]]);
  }
  return out;
}

// ---------------------------------------------------------------- what the nation buys
/**
 * THE NATION'S DEMAND FOR THE TOWN'S EXPORTS, a month on (step 2). Each
 * industry's national employment runs at its national trend, which centres on
 * its 1990-2019 CES rate less the labour force that has stopped arriving
 * (industries.ts NAT_TREND, market.ts LABOUR_FORCE_SLOWDOWN) and wanders round
 * it with a generation's memory (market.ts NAT_TREND_SD, NAT_TREND_TAU_M —
 * manufacturing grew for a century and shrank for half of one). The town's
 * share of it moves with what the town costs an employer against the nation
 * (market.ts `locationCost`, at LOCATION_PULL: Bartik 1991) and with its own
 * firms' fortunes in that industry, a persistent process (market.ts
 * FORTUNE_SD, FORTUNE_TAU_M: Blanchard & Katz 1992) — which is how a town
 * whose plants lose out declines for decades while the nation grows. The
 * black swans' level events (an anchor's campus, a broke city's layoffs) move
 * it too. Opens part-way through each process's story, as the trades did.
 * Draws on the economy's stream only.
 */
function tickExports(s: GameState, E: EconomyState, R: Rand): void {
  const e = s.econ;
  const centre = (i: number) => NAT_TREND[INDUSTRY_IDS[i]] - LABOUR_FORCE_SLOWDOWN;
  if (!E.lnNat || !E.natTr || !E.lnShare || !E.fort) {
    E.lnNat = new Array(N_IND).fill(0); E.lnShare = new Array(N_IND).fill(0);
    E.natTr = Array.from({ length: N_IND }, (_, i) => centre(i) + NAT_TREND_SD * R.n());
    E.fort = Array.from({ length: N_IND }, () => FORTUNE_SD * R.n());
    E.gap0 = e.nat?.gap ?? 0; E.swanLn = 0;
    return;
  }
  const cost = locationCost(e);
  const uni = () => Math.sqrt(3) * (2 * R.u() - 1);
  for (let i = 0; i < N_IND; i++) {
    E.natTr[i] += (centre(i) - E.natTr[i]) / NAT_TREND_TAU_M + NAT_TREND_SD * Math.sqrt(2 / NAT_TREND_TAU_M) * uni();
    E.lnNat[i] += E.natTr[i] / 12;
    E.fort[i] += -E.fort[i] / FORTUNE_TAU_M + FORTUNE_SD * Math.sqrt(2 / FORTUNE_TAU_M) * uni();
    E.lnShare[i] += (E.fort[i] - LOCATION_PULL * cost) / 12;
  }
  E.swanLn = (E.swanLn ?? 0) + Math.log(Math.max(0.5, 1 + (e.bsJobPull ?? 0)));
}

/**
 * AN INDUSTRY'S EXPORTS THIS MONTH, IN HEADS: the opening's, times the
 * nation's employment in it and the town's share of that, times the nation's
 * cycle at the industry's own swing (industries.ts CYCLE_BETA, at the
 * engine's NAT_SALES_PER_GAP points of sales per point of the output gap) —
 * and for a plant, the factory floor a dear dollar has sent abroad (market.ts
 * `manufIdx`). Priced at unit labour cost (heads x output per head), so a
 * town's productivity cancels and what moves the jobs is demand.
 */
function exportHeads(s: GameState, E: EconomyState, j: number): number {
  const e = s.econ, id = INDUSTRY_IDS[j];
  const cyc = CYCLE_BETA[id] * NAT_SALES_PER_GAP * ((e.nat?.gap ?? 0) - (E.gap0 ?? 0));
  const fx = INDUSTRIES[id].group === "making" ? (e.manufIdx ?? 1) / Math.max(1e-6, E.manuf0) : 1;
  return (E.XJ0?.[j] ?? 0) * Math.exp((E.lnNat?.[j] ?? 0) + (E.lnShare?.[j] ?? 0) + (E.swanLn ?? 0) + cyc) * fx;
}

// ---------------------------------------------------------------- construction's buyers
/** The homebuilders' draws this month: every house going up on the plats (homes.ts), its budget spread over its build. */
function homeBuilding(s: GameState): number {
  const units = s.homes?.units;
  if (!units) return 0;
  let out = 0;
  for (const u of Object.values(units)) {
    if (!(u.startM <= s.month && s.month < u.doneM)) continue;
    out += u.budget / Math.max(1, u.doneM - u.startM);
  }
  return out;
}
/**
 * PUBLIC WORKS: the city's own building — streets, schools, the water main.
 * Zero until the city's budget exists (citygov.ts, ONE_ECONOMY_PLAN.md step
 * 6); this is where its capital programme will be read. The off-map
 * government industry already buys its repairs through the IO table.
 */
function publicWorks(s: GameState): number {
  void s;
  return 0;
}
export interface ConstructionDemand {
  /** New commercial building (the pipeline), houses on the plats, repairs to let commercial floors, to let flats, to owner-occupied homes, public works — a month. */
  pipeline: number; homes: number; repairCommercial: number; repairFlats: number; repairOwners: number; publicWorks: number;
}
const conTotal = (c: ConstructionDemand) => c.pipeline + c.homes + c.repairCommercial + c.repairFlats + c.repairOwners + c.publicWorks;
/**
 * WHAT THE TOWN BUYS FROM THE TRADES THIS MONTH, beyond what firms buy
 * through the IO table: the commercial pipeline at the cost of building it,
 * the houses going up on the plats, the repair of the standing stock — let
 * commercial floors and let flats by their landlords, owner-occupied homes by
 * their owners (industries.ts REPAIR_*, BEA 2017) — and public works.
 */
function constructionBought(s: GameState, hm: { rent: number; ownerValue: number }, firmRent: number): ConstructionDemand {
  return {
    pipeline: buildingSpend(s), homes: homeBuilding(s),
    repairCommercial: REPAIR_PER_COMMERCIAL_RENT * firmRent,
    repairFlats: REPAIR_PER_FLAT_RENT * hm.rent,
    repairOwners: REPAIR_OWNER_PER_VALUE_YR / 12 * hm.ownerValue,
    publicWorks: publicWorks(s),
  };
}

// ---------------------------------------------------------------- the price of oil
/**
 * THE NATION'S OIL PRICE, a month on (industries.ts OIL_*): its real level
 * runs toward OIL_PER_SHOCK x the supply shock in force (market.ts — a shock
 * under fiscal pressure is demand and moves no oil, as the engine's own
 * output block reads it), fast on the way up and back with a three-year
 * half-life; the dollar price is that times the nation's prices since the
 * opening. Deterministic; reads the nation, writes only the books.
 */
function tickOil(s: GameState, E: EconomyState): void {
  const n = s.econ.nat;
  const sup = n && (n.shockM ?? 0) > 0 && !((n.pressureM ?? 0) > 0) ? (n.shockSev ?? 0) : 0;
  const target = OIL_PER_SHOCK * sup;
  const cur = E.lnOil ?? 0;
  const k = target > cur ? 1 / OIL_RISE_M : 1 - Math.pow(0.5, 1 / OIL_HALF_LIFE_M);
  E.lnOil = cur + (target - cur) * k;
  const natCpi = s.econ.natCpi ?? s.econ.cpi ?? 1;
  E.natCpi0 ??= natCpi;
  E.oil = OIL_PRICE_2000 * (natCpi / Math.max(1e-6, E.natCpi0)) * Math.exp(E.lnOil);
}

// ---------------------------------------------------------------- the month, first half: who employs whom
/**
 * HOW FAST AN INDUSTRY STAFFS TO WHAT IT SELLS: 3% of the gap a month when it
 * is short of heads and 7% when it has too many. Firms fire faster than they
 * hire, and the payroll's lag behind output (labour hoarding into a downturn,
 * shedding after the trough) is the gap. The rule the trades' own books ran
 * (market.ts tickFirmBook, retired with them in step 2), moved here unchanged:
 * one answer to how a payroll follows its sales.
 */
const HIRE_M = 0.03, FIRE_M = 0.07;

/**
 * EACH INDUSTRY'S EMPLOYMENT, the labour demand the household register fills
 * (step 2). Every industry staffs toward the heads its output needs — what the
 * books solved last month (households' spending, other firms' orders through
 * the IO table, building, what employers' insurance and Washington pay the
 * hospitals for, and what the nation buys) over output per worker — at
 * HIRE_M / FIRE_M. Government is the opening's public payroll per resident, so
 * it follows the register's people (the city's budget will replace it,
 * citygov.ts), moved by a black swan's level (a broke city's layoffs). At the
 * opening each industry is what the town's jobs hold (`openingOffMap`), which
 * is what the opening's local purchase and export coefficients are calibrated
 * on. The named firms' heads are the street's (streetRolls.ts staffs them to
 * their industry's employment); the off-map sample holds the rest.
 */
function staff(E: EconomyState, persons: number): void {
  const emp = E.emp!, last = E.last!;
  E.empPrev = emp.slice();
  for (let i = 0; i < N_IND; i++) {
    if (i === IND_GOV) { emp[i] = (E.gov0 ?? emp[i]) * (persons / Math.max(1, E.persons0 ?? persons)) * Math.exp(E.swanLn ?? 0); continue; }
    const target = last.impliedHeads[i];
    emp[i] += (target - emp[i]) * (target > emp[i] ? HIRE_M : FIRE_M);
  }
}

/**
 * CONSTRUCTION AT THE OPENING: what the town buys of it — its own building
 * and repairs (constructionBought) and what every other industry, sized at the
 * opening, buys through the IO table — over output per worker. A building is
 * built where it stands, so the town's purchases of construction are made in
 * town (BEA: no construction is imported or exported, Use table F040/F050 = 0)
 * and the trades' heads are what those purchases pay for.
 */
function openingConstruction(s: GameState, E: EconomyState, hm: { rent: number; ownerValue: number }, named: Float64Array, eng: Float64Array, opw: Float64Array): number {
  const F = E.f;
  let firmRent = 0;
  for (let n = 0; n < E.L.slot.n; n++) if (F.id[n] >= 0) firmRent += F.rent[n];
  let D = 0;
  for (let i = 0; i < N_IND; i++) {
    if (i === IND_CON) continue;
    firmRent += eng[i] * INDUSTRIES[INDUSTRY_IDS[i]].sfPerWorker * marketRent(s, i) / 12;
    D += A_FLAT[i * N_IND + IND_CON] * (named[i] + eng[i]) * opw[i];
  }
  D += conTotal(constructionBought(s, hm, firmRent));
  return D / (1 - A_FLAT[IND_CON * N_IND + IND_CON]) / opw[IND_CON];
}

/**
 * THE MONTH'S FIRST HALF, before the household register (sim.ts): firms that
 * closed or left the engine's sight close their books, new ones open theirs,
 * the nation's demand for the town's exports moves (`tickExports`), and every
 * industry's employment is set (`staff`) — the labour demand the register's
 * earners are matched to. Writes `s.economy` and `s.streams.economy` only.
 * Opens the books the month after the register is seeded.
 */
export function tickFirms(s: GameState): void {
  const e = s.econ;
  if (!e || !s.households) return;
  const hm = householdMoney(s);
  if (!hm) return;
  const R = stream(s);
  const seen = readFirms(s);
  const opening = !s.economy;
  const E: EconomyState = s.economy ??= {
    v: 1, openM: s.month, f: allocCols(0), nextOff: -1, L: newLedger("firm", 0),
    w0: e.wageIdx ?? 1, lnY0: e.nat?.lnY ?? 0, manuf0: e.manufIdx ?? 1, tech0: e.nat?.techLn ?? 0,
    rpc: [], X0: [], sig0: [], prod0: [], sigW: [], last: null,
  };
  reviveEconomy(E);
  E.tech0 ??= e.nat?.techLn ?? 0;
  const L = E.L, c = E.f;
  newMonth(L);
  tickOil(s, E);
  tickExports(s, E, R);
  const short = shortIndexOf(e) / 100;
  const { opw } = perHead(e.wageIdx ?? 1);

  // ---- the named firms: gone ones close, new ones get an industry and books
  {
    const n0 = L.slot.n, keep = new Array<boolean>(n0);
    const have = new Set<number>();
    for (let n = 0; n < n0; n++) {
      const id = c.id[n];
      if (id < 0) { keep[n] = true; continue; }
      const sn = seen.get(id);
      if (!sn) { closeBooks(L, n); keep[n] = false; continue; }
      c.hc[n] = sn.hc; c.z[n] = sn.z; c.rent[n] = sn.rentMo; have.add(id); keep[n] = true;
    }
    if (keep.some((k) => !k)) {
      const map = compactSlots(L, keep);
      const cols = COLS(E.f);
      for (let n = 0; n < n0; n++) { const j = map[n]; if (j >= 0 && j !== n) for (const col of cols) col[j] = col[n]; }
    }
    for (const [fid, sn] of seen) {
      if (have.has(fid)) continue;
      const ind = assign(R, sn.sec, sn.floor, sn.ind);
      const n = addFirm(E, fid, ind, SECTORS.indexOf(sn.sec), sn.hc, sn.z, s.month);
      E.f.rent[n] = sn.rentMo;
      openBooks(E, n, opw[ind], short, opening);
    }
  }
  const f = E.f, N = () => L.slot.n;
  const named = new Float64Array(N_IND);
  for (let n = 0; n < N(); n++) if (f.id[n] >= 0) named[f.ind[n]] += f.hc[n];

  // ---- each industry's employment, and the off-map sample that holds what the named firms do not
  if (opening || !E.emp || !E.last) {
    const eng0 = openingOffMap(s, named, 0);
    const conOpen = openingConstruction(s, E, hm, named, eng0, opw);
    const eng = openingOffMap(s, named, conOpen);
    E.gov0 = eng[IND_GOV];
    E.emp = Array.from(eng, (v, i) => v + named[i]);
    E.emp0 = E.emp.slice(); E.empPrev = E.emp.slice();
  } else staff(E, hm.persons);
  const emp = E.emp;
  // A SAVE FROM BEFORE STEP 2 kept its books in the shadow's terms: its
  // exports in dollars at the opening's pay, no island shares, no opening
  // output. Read them into this step's once, from what the save holds.
  if (!opening && E.last && !E.XJ0) {
    const opw0 = perHead(E.w0 || 1).opw;
    E.XJ0 = E.X0.map((v, j) => v / Math.max(1e-9, opw0[j]));
  }
  if (!opening && E.last) {
    E.sigma ??= emp.map((v, i) => (v > 0 ? Math.min(1, named[i] / v) : 0));
    E.x0 ??= emp.map((v, i) => v * opw[i]);
    E.emp0 ??= emp.slice();
  }
  const off = Float64Array.from(emp, (v, i) => Math.max(0, v - named[i]));
  if (opening) {
    for (let i = 0; i < N_IND; i++) for (let k = 0; k < OFF_PER; k++) {
      const n = addFirm(E, E.nextOff--, i, NO_SEC, off[i] / OFF_PER, Z_SIG * R.n() / Math.sqrt(1 - Z_RHO * Z_RHO), s.month);
      openBooks(E, n, opw[i], short, true);
    }
  } else {
    for (let n = 0; n < N(); n++) if (E.f.id[n] < 0) { E.f.hc[n] = off[E.f.ind[n]] / OFF_PER; E.f.z[n] = Z_RHO * E.f.z[n] + Z_SIG * R.n(); }
  }
  const heads: number[] = [];
  for (let i = 0; i < N_IND; i++) heads.push(named[i] + off[i]);
  E.cur = { m: s.month, heads, named: Array.from(named), eng: emp.slice() };
  R.done();
}

// ---------------------------------------------------------------- the month, second half: the money
/**
 * THE MONTH'S MONEY, after the household register has been matched to the
 * heads (sim.ts). Reads the world; writes `s.economy` only. A month whose
 * first half did not run (no books yet) does nothing.
 */
export function tickEconomy(s: GameState): void {
  const e = s.econ;
  const E = s.economy;
  if (!e || !E || !E.cur || E.cur.m !== s.month) return;
  const hm = householdMoney(s);
  if (!hm) return;
  reviveEconomy(E);
  const opening = E.last === null;
  const L = E.L;
  const short = shortIndexOf(e) / 100;
  const w = e.wageIdx ?? 1;
  const { opw, pay } = perHead(w);
  const F = E.f, nF = L.slot.n;
  const heads = Float64Array.from(E.cur.heads);
  const rentMkt = new Float64Array(N_IND);
  for (let i = 0; i < N_IND; i++) rentMkt[i] = INDUSTRIES[INDUSTRY_IDS[i]].sfPerWorker * marketRent(s, i) / 12;
  const rentOf = (n: number) => F.id[n] >= 0 ? F.rent[n] : F.hc[n] * rentMkt[F.ind[n]];

  // ---- each firm's payroll this month: its industry's earners' pay in the
  // household register (registerPayroll), shared over the industry's firms by
  // heads — so what the firms pay and what the households are paid are one
  // number. The register is a weighted sample, so an industry's earners sit
  // within half an agent's weight of its heads and its pay per head moves with
  // who they are; the industry's BEA pay is what they are hired at.
  const pr = registerPayroll(s);
  const wagesOf = (n: number) => {
    const i = F.ind[n];
    return pr ? (heads[i] > 0 ? pr.wages[i] / PAY_SPLIT.cash * F.hc[n] / heads[i] : 0) : F.hc[n] * pay[i];
  };

  // ---- 3. final demand
  const sv = spendVector(e.online ?? 0);
  const C = hm.spend;
  const G = heads[IND_GOV] * opw[IND_GOV];
  let firmRent = 0, comp = 0;
  for (let n = 0; n < nF; n++) { firmRent += rentOf(n); comp += wagesOf(n); }
  const con = constructionBought(s, hm, firmRent);
  const P = conTotal(con);
  // HEALTH CARE PAID BY SOMEONE ELSE (industries.ts FED_HEALTH_PER_PERSON_2023,
  // MLR): employers' insurance buys care at the loss ratio and the insurer
  // keeps the rest; Medicare and the federal share of Medicaid pay for the
  // register's people's care from outside the town. Both are the households'
  // consumption in BEA's accounts, and booked as such below.
  const insEmp = comp * PAY_SPLIT.insurance;
  const fedHealth = FED_HEALTH_PER_PERSON_2023 / 12 * w * hm.persons;
  const fH = new Float64Array(N_IND), fG = new Float64Array(N_IND), fC = new Float64Array(N_IND), fd = new Float64Array(N_IND);
  for (let j = 0; j < N_IND; j++) fH[j] = C * sv.v[j];
  const fIns = new Float64Array(N_IND);
  fIns[IND_HE] = MLR * insEmp; fIns[IND_INS] = (1 - MLR) * insEmp;
  fG[IND_GOV] = G; fC[IND_CON] = P;
  for (let j = 0; j < N_IND; j++) fd[j] = fH[j] + fIns[j] + fG[j] + fC[j];
  fd[IND_HE] += fedHealth;

  if (opening) {
    // the register's people once the opening's jobs are filled: government follows them from here
    E.persons0 = hm.persons;
    // CALIBRATION: at the opening the town makes what its heads make (x = S).
    // The town supplies its own use of a commodity up to what its firms make
    // of it, after what comes from abroad (the supply-demand pool method;
    // Miller & Blair 2009, Input-Output Analysis, ch. 8); what its firms make
    // beyond its own use is its exports — its economic base. In heads (XJ0):
    // what the nation's demand index multiplies from here (`exportHeads`).
    const S = new Float64Array(N_IND);
    for (let i = 0; i < N_IND; i++) S[i] = heads[i] * opw[i];
    for (let j = 0; j < N_IND; j++) {
      let D = fd[j];
      for (let i = 0; i < N_IND; i++) D += A_FLAT[i * N_IND + j] * S[i];
      const notForeign = 1 - INDUSTRIES[INDUSTRY_IDS[j]].foreignImport;
      const rpc = D > 0 ? Math.min(notForeign, S[j] / D) : notForeign;
      E.rpc.push(rpc);
      E.X0.push(Math.max(0, S[j] - rpc * D));
      E.sigW.push({});
    }
    E.XJ0 = E.X0.map((v, j) => v / opw[j]);
    E.x0 = Array.from(S);
    E.sigma = Array.from(heads, (h, i) => h > 0 ? Math.min(1, E.cur!.named[i] / h) : 0);
    for (let n = 0; n < nF; n++) if (F.id[n] >= 0 && F.sec[n] !== NO_SEC) {
      const sw = E.sigW[F.ind[n]], sec = SECTORS[F.sec[n]];
      sw[sec] = (sw[sec] ?? 0) + F.hc[n];
    }
  }
  // Exports: what the nation buys of each industry, in heads (`exportHeads`),
  // at unit labour cost — heads times output per head.
  const X = new Float64Array(N_IND);
  for (let j = 0; j < N_IND; j++) X[j] = exportHeads(s, E, j) * opw[j];

  // ---- 4. the output that demand calls for, and who bought it
  const { x, iters } = solve(E.rpc, fd, X, opening ? null : E.last?.x ?? null);
  const buy: number[][] = [];
  for (let j = 0; j < N_IND; j++) {
    let firms = 0, conB = 0;
    for (let i = 0; i < N_IND; i++) { const a = A_FLAT[i * N_IND + j] * x[i]; if (i === IND_CON) conB += a; else firms += a; }
    const r = E.rpc[j];
    buy.push([r * (fH[j] + fIns[j] + (j === IND_HE ? fedHealth : 0)), r * firms, r * fG[j], r * (fC[j] + conB), X[j]]);
  }

  // ---- 5. the buyers pay the market
  const M = ACCOUNTS.market;
  const rCon = E.rpc[IND_CON];
  let cLocal = 0, gLocal = 0, xTot = 0;
  for (let j = 0; j < N_IND; j++) { cLocal += E.rpc[j] * fH[j]; gLocal += buy[j][2]; xTot += X[j]; }
  const landBuild = con.pipeline + con.homes + con.repairCommercial + con.repairFlats;
  transfer(L, ACCOUNTS.households, M, cLocal, "spend", "hh>mkt:spend");
  transfer(L, ACCOUNTS.households, ACCOUNTS.rest, C - cLocal, "imports", "hh>row:imports");
  transfer(L, ACCOUNTS.households, M, rCon * con.repairOwners, "building", "hh>mkt:home repairs");
  transfer(L, ACCOUNTS.households, ACCOUNTS.rest, (1 - rCon) * con.repairOwners, "imports", "hh>row:home repairs");
  transfer(L, ACCOUNTS.government, M, gLocal, "provision", "gov>mkt:provision");
  transfer(L, ACCOUNTS.government, ACCOUNTS.rest, G - gLocal, "imports", "gov>row:imports");
  transfer(L, ACCOUNTS.government, M, rCon * con.publicWorks, "building", "gov>mkt:public works");
  transfer(L, ACCOUNTS.government, ACCOUNTS.rest, (1 - rCon) * con.publicWorks, "imports", "gov>row:public works");
  transfer(L, ACCOUNTS.landlords, M, rCon * landBuild, "building", "land>mkt:building and repairs");
  transfer(L, ACCOUNTS.landlords, ACCOUNTS.rest, (1 - rCon) * landBuild, "imports", "land>row:imports");
  transfer(L, ACCOUNTS.rest, M, xTot, "exports", "row>mkt:exports");
  // Washington pays for the care its programmes cover; what is treated out of town never touches it
  transfer(L, ACCOUNTS.rest, M, E.rpc[IND_HE] * fedHealth, "health", "row>mkt:medicare and medicaid");
  // an employer's insurance dollar buys care and the insurer's service, here as far as the town supplies them
  const insLocal = MLR * E.rpc[IND_HE] + (1 - MLR) * E.rpc[IND_INS];

  // ---- 6. every firm's month (its payroll: `wagesOf`, above)
  const { loc, imp } = inputSplit(E.rpc);
  // A FIRM'S SALES: its heads' share of its industry's output, by its fortune
  // AGAINST ITS OWN KIND'S. The named firms' fortunes are their tenant books'
  // (tenantBooks.ts: sales against their own reference, with the failures
  // gone — the survivors' mean ran e^z ~1.6 by year two), the off-map
  // sample's a stationary draw about zero. Weighed together raw, a named
  // firm sold 60% more per head than the same industry off the map, and the
  // off-map firms were left the remainder at a loss (health -6%, fulfilment
  // -51%, 2026-10-29). Luck is relative (streetRolls.ts, `dzBar`): each group's
  // fortunes are read against the group's own mean, so a head sells the
  // industry's average on or off the map and a firm's luck is its own.
  const zh = new Float64Array(2 * N_IND), zs = new Float64Array(2 * N_IND);
  for (let n = 0; n < nF; n++) { const g = 2 * F.ind[n] + (F.id[n] >= 0 ? 1 : 0); zh[g] += F.hc[n]; zs[g] += F.hc[n] * Math.exp(F.z[n]); }
  const wsum = new Float64Array(N_IND), nInd = new Float64Array(N_IND), wt = new Float64Array(nF);
  for (let n = 0; n < nF; n++) {
    const g = 2 * F.ind[n] + (F.id[n] >= 0 ? 1 : 0);
    wt[n] = F.hc[n] * Math.exp(F.z[n]) * (zs[g] > 0 ? zh[g] / zs[g] : 1);
    wsum[F.ind[n]] += wt[n]; nInd[F.ind[n]]++;
  }
  const credit = Math.max(0, Math.min(1, ((e.creditIdx ?? 1) - 0.5) / 0.5));
  let wagesCash = 0;
  for (let n = 0; n < nF; n++) {
    const i = F.ind[n], I = INDUSTRIES[INDUSTRY_IDS[i]];
    const share = wsum[i] > 0 ? wt[n] / wsum[i] : 1 / nInd[i];
    const rev = x[i] * share;
    const wages = wagesOf(n);
    const inLoc = rev * loc[i], inImp = rev * imp[i];
    const rent = rentOf(n);
    const prodTax = rev * I.prodTax;
    const debt = debtOf(L, n);
    const P0 = financing(i);
    const rate = P0 ? short + P0.spread : 0;
    const interest = debt * rate / 12;
    const ebitda = rev - wages - inLoc - inImp - rent - prodTax;
    const pbt = ebitda - interest;
    const incomeTax = P0 ? CORP_TAX * Math.max(0, pbt) : 0;
    transfer(L, M, n, rev, "sales", "mkt>firm:sales");
    transfer(L, n, ACCOUNTS.households, wages * PAY_SPLIT.cash, "wages", "firm>hh:wages");
    transfer(L, n, M, wages * PAY_SPLIT.insurance * insLocal, "health", "firm>mkt:health insurance");
    transfer(L, n, ACCOUNTS.rest, wages * PAY_SPLIT.insurance * (1 - insLocal), "imports", "firm>row:health insurance");
    transfer(L, n, ACCOUNTS.rest, wages * (1 - PAY_SPLIT.cash - PAY_SPLIT.insurance), "benefits", "firm>row:retirement and payroll tax");
    transfer(L, n, M, inLoc, "inputs", "firm>mkt:inputs");
    transfer(L, n, ACCOUNTS.rest, inImp, "imports", "firm>row:imports");
    transfer(L, n, ACCOUNTS.landlords, rent, "rent", "firm>land:rent");
    transfer(L, n, ACCOUNTS.government, prodTax * PROD_TAX_LOCAL, "tax", "firm>gov:production tax");
    transfer(L, n, ACCOUNTS.rest, prodTax * (1 - PROD_TAX_LOCAL), "tax", "firm>row:production tax");
    transfer(L, n, ACCOUNTS.bank, interest, "interest", "firm>bank:interest");
    transfer(L, n, ACCOUNTS.rest, incomeTax, "tax", "firm>row:income tax");
    wagesCash += wages * PAY_SPLIT.cash;
    let payout = 0;
    if (!P0) {
      // a city department: its budget is the city's — the surplus or the shortfall goes back
      const cash = cashOf(L, n), want = CASH_KEEP_M * (wages + inLoc + inImp + rent);
      if (cash > want) transfer(L, n, ACCOUNTS.government, cash - want, "budget", "firm>gov:budget returned");
      else transfer(L, ACCOUNTS.government, n, want - cash, "budget", "gov>firm:budget");
    } else {
      // debt toward what a lender would write today (market.ts tickFirmBook), while the window is open
      const costsM = wages + inLoc + inImp + rent + prodTax + interest;
      const target = Math.min(P0.lev, 1 / (Math.max(0.01, rate) * LENDER_COVER)) * Math.max(0, ebitda * 12);
      let cash = cashOf(L, n);
      if (debt < target) lend(L, n, (target - debt) / DEBT_ADJ_M * credit, "bank>firm:loan");
      else if (cash > CASH_KEEP_M * costsM) repay(L, n, Math.min((cash - CASH_KEEP_M * costsM) * 0.5, debt - target), "firm>bank:repay");
      cash = cashOf(L, n);
      if (cash > CASH_KEEP_M * costsM) { payout = (cash - CASH_KEEP_M * costsM) * PAYOUT_M; payOwners(L, n, payout); }
      cash = cashOf(L, n);
      if (cash < 0) lend(L, n, -cash, "bank>firm:overdraft");   // a firm short of cash draws on its bank
    }
    F.eq[n] += pbt - incomeTax - payout;
    F.rev[n] = rev; F.wages[n] = wages; F.inputs[n] = inLoc + inImp; F.rent[n] = rent; F.prodTax[n] = prodTax;
    F.interest[n] = interest; F.incomeTax[n] = incomeTax; F.payout[n] = payout; F.ebitda[n] = ebitda;
    F[REV_RING[s.month % 12]][n] = rev;
    // a department's budget transfer is the city putting in or taking out capital, not income
    if (!P0) F.eq[n] = cashOf(L, n) - debtOf(L, n);
  }

  // ---- 7. households, the city, the landlords
  const H = ACCOUNTS.households, GOV = ACCOUNTS.government, LAND = ACCOUNTS.landlords, ROW = ACCOUNTS.rest, BANK = ACCOUNTS.bank;
  transfer(L, ROW, H, hm.pensions, "pensions", "row>hh:pensions");
  transfer(L, GOV, H, hm.ui, "ui", "gov>hh:unemployment insurance");
  transfer(L, H, ROW, hm.tax - hm.taxLocal, "tax", "hh>row:income tax");
  transfer(L, H, GOV, hm.taxLocal, "tax", "hh>gov:income and sales tax");
  transfer(L, H, LAND, hm.rent, "rent", "hh>land:rent");
  transfer(L, H, BANK, hm.mortgage, "mortgage", "hh>bank:mortgage");
  transfer(L, H, GOV, hm.propertyTax, "tax", "hh>gov:property tax");
  transfer(L, H, ROW, hm.homeInsurance, "insurance", "hh>row:home insurance");
  // the city borrows what it is short; a landlord short of cash for its jobs borrows from the bank
  if (cashOf(L, GOV) < 0) sellBond(L, ROW, -cashOf(L, GOV));
  if (cashOf(L, LAND) < 0) lend(L, LAND, -cashOf(L, LAND));

  // the past year, rolled, for the cause ledger (whyIndustry, whyTown)
  {
    const cur = {
      emp: (E.emp ?? Array.from(heads)).slice(), X: Array.from(X), hh: buy.map((b) => b[0]), firms: buy.map((b) => b[1]),
      share: (E.lnShare ?? new Array(N_IND).fill(0)).slice(), heads: heads.reduce((a, v) => a + v, 0), C,
    };
    const m = E.ema;
    if (!m) E.ema = cur;
    else {
      const k = 1 / 12, mv = (a: number[], b: number[]) => { for (let i = 0; i < a.length; i++) a[i] += (b[i] - a[i]) * k; };
      mv(m.emp, cur.emp); mv(m.X, cur.X); mv(m.hh, cur.hh); mv(m.firms, cur.firms); mv(m.share, cur.share);
      m.heads += (cur.heads - m.heads) * k; m.C += (cur.C - m.C) * k;
    }
  }
  E.last = {
    m: s.month, C, G, P, X: xTot, hhWagesRegister: hm.wages, hhWagesFirms: wagesCash,
    x: Array.from(x), buy, heads: Array.from(heads), namedHeads: E.cur.named.slice(),
    impliedHeads: Array.from(x, (v, i) => v / Math.max(1e-9, opw[i])),
    engHeads: E.cur.eng.slice(), regEarners: pr ? Array.from(pr.earners) : [], jobsEngine: e.jobs ?? 0,
    con, oil: E.oil ?? OIL_PRICE_2000, oilReal: Math.exp(E.lnOil ?? 0), health: { employers: insEmp, federal: fedHealth },
    ledgerSum: ledgerSum(L), ledgerGross: ledgerGross(L), market: cashOf(L, M), iters,
  };
  // the screens' twelve-month trend by industry (written, never read by the world)
  const revI = new Float64Array(N_IND), ebI = new Float64Array(N_IND);
  for (let n = 0; n < nF; n++) { revI[F.ind[n]] += F.rev[n]; ebI[F.ind[n]] += F.ebitda[n]; }
  const ih = (E.ih ??= []);
  ih.push({ m: s.month, x: Array.from(x), heads: Array.from(heads), ex: Array.from(X), mg: Array.from(revI, (r, i) => (r > 0 ? ebI[i] / r : 0)) });
  if (ih.length > 13) ih.splice(0, ih.length - 13);
}

// ---------------------------------------------------------------- what the engine reads (step 2)
/**
 * THE MONTH, AS THE ENGINE WILL READ IT: written into `s.econ.eco` after the
 * household register has filled the heads and the books are kept (sim.ts),
 * read by the engine the month after (market.ts, streetRolls.ts) — the data a
 * statistician has. Before the books open it carries the register alone.
 *
 *   the register   earners in work (the town's jobs), the labour force, the
 *                  jobless rate, people, households, the age mix, renters;
 *   the floor      what each class's tenants need: every industry's heads on
 *                  the floor it rents — not at home, not in a building of
 *                  its own (industries.ts OFF_FLOOR, REMOTE) — at its feet a
 *                  worker (industries.ts sfPerWorker);
 *   the industries each one's employment, a month ago, and the heads the
 *                  island's named firms form toward: its share of the
 *                  industry at the opening (`sigma`);
 *   the trades     each engine trade's employment and real sales against the
 *                  opening, its industries' by the heads it had in each — the
 *                  read-out that replaces the trades' own books.
 */
export function economyToEngine(s: GameState): void {
  const e = s.econ;
  if (!e || !s.households) return;
  const lab = registerLabour(s);
  if (!lab) return;
  const fl = s.households.flow;
  const d: EcoDrive = {
    m: s.month, jobs: lab.employed, lf: lab.lf, unemp: lab.lf > 0 ? lab.unemployed / lab.lf : 0,
    persons: lab.persons, households: lab.households, ages: { ...lab.ages },
    renters: lab.islandRenters + lab.mainlandRenters,
    arrived: fl?.arrived ?? 0, left: fl?.left ?? 0, heads: 0,
  };
  if (s.economy?.last && fl?.bought !== undefined && d.renters > 0) d.buyRate = 12 * fl.bought / d.renters;
  // households stage 2: what the households chose (households.ts)
  const hr = s.households;
  if (hr.islandWant !== undefined) d.islandWant = hr.islandWant;
  if (hr.moveOutYr !== undefined) d.flatMoveOut = hr.moveOutYr;
  if (hr.leaseMoveRate !== undefined) d.flatLeaseMove = hr.leaseMoveRate;
  if (hr.buyers) d.buyers = hr.buyers.map((x) => ({ ...x }));
  const E = s.economy;
  if (E?.last && E.cur?.m === s.month && E.emp && E.emp0 && E.x0) {
    reviveEconomy(E);
    const heads = E.cur.heads;
    d.heads = heads.reduce((a, v) => a + v, 0);
    const floorSf: Record<Floor, number> = { office: 0, retail: 0, industrial: 0 };
    for (let i = 0; i < N_IND; i++) {
      const id = INDUSTRY_IDS[i];
      floorSf[floorOf(id)] += heads[i] * (1 - OFF_FLOOR[id]) * (1 - REMOTE[id]) * INDUSTRIES[id].sfPerWorker;
    }
    d.floorSf = floorSf;
    d.emp = E.emp.slice(); d.empPrev = (E.empPrev ?? E.emp).slice();
    d.target = E.emp.map((v, i) => v * (E.sigma?.[i] ?? 0));
    // each trade, by the heads it had in each industry at the opening (its own
    // firms'), else by the industries TRADE_TO_INDUSTRY draws it into
    const real = (E.w0 || 1) / Math.max(1e-6, e.wageIdx ?? 1);
    const F = E.f, rev = new Float64Array(N_IND), ebitda = new Float64Array(N_IND);
    for (let n = 0; n < E.L.slot.n; n++) { rev[F.ind[n]] += F.rev[n]; ebitda[F.ind[n]] += F.ebitda[n]; }
    const trade: NonNullable<EcoDrive["trade"]> = {};
    for (const sec of SECTORS) {
      let wt = 0, emp = 0, sales = 0, mg = 0;
      const add = (i: number, w: number) => {
        if (!(w > 0) || !(E.emp0![i] > 0) || !(E.x0![i] > 0)) return;
        wt += w; emp += w * E.emp![i] / E.emp0![i]; sales += w * E.last!.x[i] / E.x0![i] * real;
        mg += w * (rev[i] > 0 ? ebitda[i] / rev[i] : INDUSTRIES[INDUSTRY_IDS[i]].gos);
      };
      for (let i = 0; i < N_IND; i++) add(i, E.sigW[i]?.[sec] ?? 0);
      if (!(wt > 0)) for (const fl2 of ["office", "retail", "industrial"] as Floor[]) for (const [k, w] of TRADE_TO_INDUSTRY[fl2][sec] ?? []) add(INDUSTRY_INDEX[k], w);
      if (wt > 0) trade[sec] = { emp: emp / wt, sales: sales / wt, margin: mg / wt };
    }
    d.trade = trade;
  }
  e.eco = d;
  if (d.floorSf && !e.eco0?.floorSf) { (e.eco0 ??= {}).floorSf = { ...d.floorSf }; e.eco0.jobs = d.jobs; }
  (e.eco0 ??= {}).renters ??= d.renters;
  if (d.islandWant !== undefined) e.eco0.islandWant ??= d.islandWant;
}

// ---------------------------------------------------------------- why (why.ts)
// The cause ledger's upstream for step 2: what the industries and the town did
// this month, made on demand — only when something downstream cites it — and
// at most once a month each (whyOnce). They read the books' rolled past year
// (`ema`); they draw nothing and decide nothing.
const sgn = (x: number) => `${x >= 0 ? "+" : ""}${(100 * x).toFixed(0)}%`;
const vsYear = (now: number, yr: number) => (yr > 0 ? now / yr - 1 : 0);

/**
 * WHAT THE NATION BOUGHT OF AN INDUSTRY this month against its past year:
 * the exports, the town's share of the nation's demand for it (what the town
 * costs an employer and its firms' fortunes), the industry's national trend.
 * Caused by the nation's month.
 */
export function whyExports(s: GameState, i: number): number | undefined {
  const E = s.economy, l = E?.last, m = E?.ema;
  if (!E || !l || !m) return undefined;
  const id = INDUSTRY_IDS[i];
  return whyOnce(s, `exports:${id}:${s.month}`, () => {
    const dx = vsYear(l.buy[i][4], m.X[i]), dShare = (E.lnShare?.[i] ?? 0) - m.share[i];
    return {
      k: "industry.exports", a: "trade", aid: id, name: INDUSTRIES[id].label,
      n: { exports: dx, share: dShare, natTrend: E.natTr?.[i] ?? 0 },
      t: `${INDUSTRIES[id].label} · sold out of town ${sgn(dx)} on its year · the town's share ${sgn(dShare)}`,
    };
  }, () => [whyNation(s)]);
}

/**
 * THE TOWN'S MONTH: its firms' heads and its households' spending against the
 * past year, and the jobless rate. Caused by the export industries whose sales
 * out of town moved most (largest first) — the base the rest of the town lives
 * on — and the nation.
 */
export function whyTown(s: GameState): number | undefined {
  const E = s.economy, l = E?.last, m = E?.ema;
  if (!E || !l || !m) return undefined;
  return whyOnce(s, `town:${s.month}`, () => {
    const heads = l.heads.reduce((a, v) => a + v, 0);
    const dj = vsYear(heads, m.heads), dc = vsYear(l.C, m.C);
    return {
      k: "town.month", a: "city",
      n: { jobs: heads, jobsYear: dj, spend: dc, unemp: s.econ.unemployment ?? 0 },
      t: `The town · ${Math.round(heads).toLocaleString("en-US")} jobs, ${sgn(dj)} on its year · household spending ${sgn(dc)} · ${(100 * (s.econ.unemployment ?? 0)).toFixed(1)}% jobless`,
    };
  }, () => {
    const moves = INDUSTRY_IDS.map((_, i) => ({ i, d: l.buy[i][4] - m.X[i] })).filter((x) => m.X[x.i] > 0)
      .sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 3);
    return [...moves.map((x) => whyExports(s, x.i)), whyNation(s)];
  });
}

/**
 * AN INDUSTRY'S MONTH: its employment against the past year, and who bought
 * less or more of it — the nation (exports), other firms (orders through the
 * input-output table), households. Its first cause is the channel that moved
 * most: the nation's month (what it bought), else the town's month
 * (`whyTown`: its payrolls and its spending, caused by the export
 * industries that moved them).
 */
export function whyIndustry(s: GameState, i: number): number | undefined {
  const E = s.economy, l = E?.last, m = E?.ema;
  if (!E || !l || !m || !E.emp) return undefined;
  const id = INDUSTRY_IDS[i];
  const dX = l.buy[i][4] - m.X[i], dLocal = (l.buy[i][0] - m.hh[i]) + (l.buy[i][1] - m.firms[i]);
  return whyOnce(s, `industry:${id}:${s.month}`, () => {
    const de = vsYear(E.emp![i], m.emp[i]);
    return {
      k: "industry.month", a: "trade", aid: id, name: INDUSTRIES[id].label,
      n: { emp: E.emp![i], empYear: de, exports: vsYear(l.buy[i][4], m.X[i]), households: vsYear(l.buy[i][0], m.hh[i]), firms: vsYear(l.buy[i][1], m.firms[i]), share: (E.lnShare?.[i] ?? 0) - m.share[i] },
      t: `${INDUSTRIES[id].label} · ${Math.round(E.emp![i]).toLocaleString("en-US")} jobs, ${sgn(de)} on its year · households ${sgn(vsYear(l.buy[i][0], m.hh[i]))} · firms ${sgn(vsYear(l.buy[i][1], m.firms[i]))} · exports ${sgn(vsYear(l.buy[i][4], m.X[i]))}`,
    };
  }, () => Math.abs(dX) > Math.abs(dLocal) ? [whyNation(s), whyTown(s)] : [whyTown(s), whyNation(s)]);
}

/** A named firm's industry: the one it was formed in, else the one the books put it in. Pure. */
export function industryOfFirm(s: GameState, t: { fid?: number; ind?: number }): number | undefined {
  if (t.ind !== undefined) return t.ind;
  const E = s.economy;
  if (t.fid === undefined || !E?.f) return undefined;
  const n = E.L.slot.n, ids = E.f.id as unknown as ArrayLike<number>;
  for (let k = 0; k < n; k++) if (ids[k] === t.fid) return (E.f.ind as unknown as ArrayLike<number>)[k];
  return undefined;
}

/** A street firm that went dark: its books, which cite its industry's month (why.ts `whyTenantBooks`). */
export function whyFirmDark(s: GameState, t: Tenant, fin: { rev0: number; revRef?: number; cover: number; liqM: number }, bbl: string): number {
  return why(s, {
    k: "tenant.dark", a: "firm", name: t.name, bbl,
    n: { sf: t.sf, rentYr: Math.round(t.rentPsf * t.sf) },
    t: `${t.name} went dark · ${(t.sf / 1000).toFixed(1)}k sf`,
  }, [whyTenantBooks(s, t, fin)]);
}

// ---------------------------------------------------------------- reading it
/** One firm's books, laid out: revenue by buyer, inputs by IO row (local and imported), costs, cash, debt, equity. Pure. */
export function firmBooks(s: GameState, id: number) {
  const E = s.economy;
  if (!E?.last) return null;
  reviveEconomy(E);
  const F = E.f;
  let n = -1;
  for (let k = 0; k < E.L.slot.n; k++) if (F.id[k] === id) { n = k; break; }
  if (n < 0) return null;
  const i = F.ind[n], b = E.last.buy[i], tot = b.reduce((a, v) => a + v, 0) || 1;
  const row = IO_A[INDUSTRY_IDS[i]], rev = F.rev[n];
  return {
    id, industry: INDUSTRY_IDS[i], label: INDUSTRIES[INDUSTRY_IDS[i]].label, heads: F.hc[n],
    revenue: rev,
    revenueBy: Object.fromEntries(BUYER_TYPES.map((k, j) => [k, rev * b[j] / tot])) as Record<BuyerType, number>,
    inputsBy: Object.fromEntries(INDUSTRY_IDS.map((k, j) => [k, { local: rev * row[j] * E.rpc[j], imported: rev * row[j] * (1 - E.rpc[j]) }])),
    wages: F.wages[n], inputs: F.inputs[n], rent: F.rent[n], prodTax: F.prodTax[n], interest: F.interest[n], incomeTax: F.incomeTax[n],
    ebitda: F.ebitda[n], margin: rev > 0 ? F.ebitda[n] / rev : 0, payout: F.payout[n],
    cash: cashOf(E.L, n), debt: debtOf(E.L, n), equity: F.eq[n],
  };
}

/**
 * THE TOWN'S MULTIPLIERS, from its leakages. A dollar more of exports, in
 * this month's export mix, through the local input-output table (type I),
 * and with households closed (type II): each dollar of output pays its
 * industry's compensation share, of which PAY_SPLIT.cash reaches a household,
 * less its tax rate; households spend their marginal dollar at the register's
 * own propensity (spending over net income) on this month's basket, bought
 * locally at the local purchase coefficients. Output and jobs per export job.
 */
export function economyMultipliers(s: GameState): { outputI: number; outputII: number; jobsII: number; exportShare: number } | null {
  const E = s.economy, hm = householdMoney(s);
  if (!E?.last || !hm) return null;
  const { opw } = perHead(s.econ.wageIdx ?? 1);
  const gross = hm.wages + hm.pensions + hm.ui;
  const net = gross - hm.tax;
  const mpc = net > 0 ? hm.spend / net : 0;
  const taxR = gross > 0 ? hm.tax / gross : 0;
  const sv = spendVector(s.econ.online ?? 0).v;
  const X = Float64Array.from(E.last.buy.map((b) => b[4]));
  const xs = X.reduce((a, v) => a + v, 0);
  if (!(xs > 0)) return null;
  const dX = Float64Array.from(X, (v) => v / xs);
  const run = (closed: boolean) => {
    let x = Float64Array.from(dX);
    for (let it = 0; it < 500; it++) {
      let y = 0;
      if (closed) for (let i = 0; i < N_IND; i++) y += x[i] * INDUSTRIES[INDUSTRY_IDS[i]].comp * PAY_SPLIT.cash * (1 - taxR) * mpc;
      const nx = new Float64Array(N_IND);
      let worst = 0;
      for (let j = 0; j < N_IND; j++) {
        let d = y * sv[j];
        for (let i = 0; i < N_IND; i++) d += A_FLAT[i * N_IND + j] * x[i];
        nx[j] = E.rpc[j] * d + dX[j];
        worst = Math.max(worst, Math.abs(nx[j] - x[j]));
      }
      x = nx;
      if (worst < 1e-12) break;
    }
    return x;
  };
  const x1 = run(false), x2 = run(true);
  const sum = (v: Float64Array) => v.reduce((a, b) => a + b, 0);
  let jobs = 0, jobs0 = 0;
  for (let i = 0; i < N_IND; i++) { jobs += x2[i] / opw[i]; jobs0 += dX[i] / opw[i]; }
  const xt = E.last.x.reduce((a, v) => a + v, 0);
  return { outputI: sum(x1), outputII: sum(x2), jobsII: jobs / jobs0, exportShare: xt > 0 ? xs / xt : 0 };
}

/** Each industry's read-out: engine heads, the heads its output implies, EBITDA margin against the BEA's. Pure. */
export function economyByIndustry(s: GameState) {
  const E = s.economy;
  if (!E?.last) return null;
  reviveEconomy(E);
  const F = E.f;
  const rev = new Float64Array(N_IND), ebitda = new Float64Array(N_IND), firms = new Float64Array(N_IND), namedFirms = new Float64Array(N_IND);
  for (let n = 0; n < E.L.slot.n; n++) { const i = F.ind[n]; rev[i] += F.rev[n]; ebitda[i] += F.ebitda[n]; firms[i]++; if (F.id[n] >= 0) namedFirms[i]++; }
  const l = E.last;
  return INDUSTRY_IDS.map((k, i) => ({
    id: k, label: INDUSTRIES[k].label,
    heads: l.heads[i], namedHeads: l.namedHeads[i], impliedHeads: l.impliedHeads[i],
    namedFirms: namedFirms[i], firms: firms[i],
    output: l.x[i], exports: l.buy[i][4], exportShare: l.x[i] > 0 ? l.buy[i][4] / l.x[i] : 0,
    margin: rev[i] > 0 ? ebitda[i] / rev[i] : NaN, marginBEA: INDUSTRIES[k].gos, rpc: E.rpc[i],
    /** the engine's way of sizing it, and the register's earners in it */
    engHeads: l.engHeads?.[i] ?? NaN, regEarners: l.regEarners?.[i] ?? NaN,
    /** its oil and refined-fuel bill per dollar of output at today's real oil price (BEA 2023 coefficient x the real price against the opening) — read, not yet paid */
    oilBill: INDUSTRIES[k].exposure.oil * (l.oilReal ?? 1),
  }));
}
