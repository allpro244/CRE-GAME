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
  OIL_PRICE_2000,
  OFF_FLOOR, REMOTE, floorOf, sfMix, NAT_TREND, CYCLE_BETA, FED_HEALTH_PER_PERSON_2023, MLR,
  IND_ID_GOV, IND_ID_CON, IND_ID_INS, IND_ID_ONLINE, RETAIL_IDS, HEALTH_SPLIT, OLD24_TO_68,
  type IndustryId, type Floor, type BuyerType, type SpendCategory,
} from "./industries";
import {
  type Ledger, newLedger, transfer, lend, repay, chargeOff, openDebt, sellBond, ledgerSum, ledgerGross, newMonth, ACCOUNTS,
  cashOf, debtOf, addSlot, compactSlots, reviveF64, reviveLedger,
} from "./sfc";
import {
  SF_PER_JOB, FIRM_PROFILE, LENDER_COVER, shortIndexOf, BUILD_MONTHS, SECTORS,
  LABOUR_FORCE_SLOWDOWN, FORTUNE_SD, FORTUNE_TAU_M, NAT_TREND_SD, NAT_TREND_TAU_M, NAT_SALES_PER_GAP, LOCATION_PULL, locationCost,
  WAGE_CURVE, WAGE_GAP_HALF_M,
} from "./market";
import { HARD_COST_PSF, SOFT_COST, CONTINGENCY, constructionTypeMult } from "./value";
import { householdMoney, registerPayroll, registerLabour, unpackHouseholds, whyHouseholdSpend } from "./households";
import { why, whyOnce, whyNation, whyTenantBooks } from "./why";
import { tenantHeads } from "./tenantMarket";

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

const IND_GOV = INDUSTRY_INDEX[IND_ID_GOV], IND_CON = INDUSTRY_INDEX[IND_ID_CON], IND_INS = INDUSTRY_INDEX[IND_ID_INS];
const IND_ONLINE = INDUSTRY_INDEX[IND_ID_ONLINE];
const IND_RETAIL = RETAIL_IDS.map((k) => INDUSTRY_INDEX[k]);
/** The care industries and each one's share of a health dollar (industries.ts HEALTH_SPLIT). */
const IND_HEALTH = (Object.entries(HEALTH_SPLIT) as [IndustryId, number][]).map(([k, w]) => [INDUSTRY_INDEX[k], w] as const);
/** Industries with no firm in the metro (industries.ts `where`): always bought from out of town. */
const OUTSIDE = INDUSTRY_IDS.map((k) => INDUSTRIES[k].where === "outside");
const FLOORS: readonly Floor[] = ["office", "retail", "industrial"];
const NO_SEC = 255;

// ---------------------------------------------------------------- state
/** The firms, one column per field; firm n is ledger slot n. */
const F64 = ["hc", "z", "eq", "rev", "wages", "inputs", "rent", "prodTax", "interest", "incomeTax", "payout", "ebitda",
  // the last twelve months' revenue, a ring by month (REV_RING): the firm page's sparkline. Read by nothing in the world.
  "h0", "h1", "h2", "h3", "h4", "h5", "h6", "h7", "h8", "h9", "h10", "h11",
  // what the firm pays a head (posted, nominal, in the engine's wage-index units), the raises it owes
  // itself from months it could not cut, and its price against the nation's for its industry (§6c-D)
  "pay", "owe", "price"] as const;
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
  /** A national swan's level on each industry's exports, log (blackswans.ts swanSec, shared over the trade's industries). */
  swanInd?: number[];
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
  /**
   * NAMED LINKS BETWEEN FIRMS (step 2d, `tickLinks`): supplier and customer
   * firm ids, the supplier's industry, the month it was signed and the month
   * it is next up for renewal, and last month's flow ($ a month). Typed
   * columns, about 17 bytes a link in a save (`reviveLinks` mends a JSON
   * copy). Read by nothing in the world but the fortunes they move (`linkDz`,
   * delivered a month on through economyToEngine).
   */
  lk?: Links;
  /** Each firm's latest loss of a customer that mattered: the cause ledger's event, the month, its share of sales. */
  lkLoss?: Record<string, { id: number; m: number; share: number }>;
  /** This month's moves in a firm's fortune from links won and lost (log), for its tenant books next month. */
  linkDz?: Record<string, number>;
  /** What the town's firms posted this month (`postPayAndPrices`), and the last 13 months of the town's posted pay. */
  posted?: Posted; wageHist?: number[];
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
/** Heads a tenant stands for: its floor in reference feet over its industry's feet a worker (tenantMarket.ts `tenantHeads`). */
function headsOf(t: Tenant, floor: Floor): number {
  void floor;
  return tenantHeads(t);
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

/**
 * WHAT THE HOUSEHOLDS BOUGHT, BY INDUSTRY (households stage 5, 2026-10-29): each
 * category's dollars as the register's households spent them
 * (households.ts `bookSpend`: each household's own spending, in the shares
 * households of its income spend, BLS CE by quintile), each bridged to the
 * industries that make and sell it (industries.ts SPEND_BRIDGE, BEA PCE at
 * producer prices), the shops' online share earned from a shed. What is left
 * of a dollar — primary goods, always imported — leaks with the imports.
 * (This was the register's total times the national basket, SPEND_SHARE: one
 * mix of purchases for every town, whoever lived in it — FORMULA_LEDGER,
 * Removed.) With `cat` null, a dollar of the national basket (the
 * multiplier's marginal dollar when the register has not spent yet).
 */
function spendVector(online: number, cat: Record<SpendCategory, number> | null): { v: Float64Array; total: number } {
  const v = new Float64Array(N_IND);
  const w = cat ?? SPEND_SHARE;
  let total = 0;
  for (const c of Object.keys(SPEND_BRIDGE) as SpendCategory[]) {
    const sh = w[c] ?? 0;
    total += sh;
    for (const [k, x] of Object.entries(SPEND_BRIDGE[c])) {
      if (k === "primary") continue;
      v[INDUSTRY_INDEX[k as IndustryId]] += sh * (x ?? 0);
    }
  }
  // the online share of a shop's margin is earned by a seller shipping from a shed
  const o = Math.max(0, Math.min(1, online));
  for (const r of IND_RETAIL) { const moved = v[r] * o; v[r] -= moved; v[IND_ONLINE] += moved; }
  return { v, total };
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
 * THE OFF-MAP FIRMS AT THE OPENING (step 2; by industry since 2b). The town's
 * employment (e.jobs) less the named firms' heads holds, first, the work done
 * from buildings of its own — each industry's off-floor part (industries.ts
 * OFF_FLOOR: hospitals, schools, City Hall, depots, the region's airport and
 * yards) at its national share of the town's jobs, which is what the town's
 * size counts (market.ts `citySize`) — and construction at what the town buys
 * of it; then the rest toward the nation's industry mix, to the industries the
 * street leaves short. If the residual cannot hold the first part, they share
 * what there is. Industries with no firm in the metro (`where`: outside) hold
 * none.
 */
function openingOffMap(s: GameState, named: Float64Array, conOpen: number): Float64Array {
  const jobs = s.econ.jobs ?? 0;
  let namedTot = 0;
  for (let i = 0; i < N_IND; i++) namedTot += named[i];
  let O = Math.max(0, jobs - namedTot);
  const out = new Float64Array(N_IND);
  const own = new Float64Array(N_IND);
  let fixed = conOpen;
  for (let i = 0; i < N_IND; i++) {
    if (i === IND_CON || OUTSIDE[i]) continue;
    const id = INDUSTRY_IDS[i];
    own[i] = Math.max(0, NAT_EMP_SHARE[id] * OFF_FLOOR[id] * jobs - (OFF_FLOOR[id] >= 1 ? named[i] : 0));
    fixed += own[i];
  }
  const k = fixed > O ? O / fixed : 1;
  for (let i = 0; i < N_IND; i++) out[i] = k * own[i];
  out[IND_CON] = k * conOpen;
  O -= k * fixed;
  const d = new Float64Array(N_IND);
  let dt = 0;
  for (let i = 0; i < N_IND; i++) {
    if (i === IND_CON || OUTSIDE[i]) continue;
    const id = INDUSTRY_IDS[i];
    if (OFF_FLOOR[id] >= 1) continue;
    d[i] = Math.max(0, NAT_EMP_SHARE[id] * (1 - OFF_FLOOR[id]) * jobs - named[i]);
    dt += d[i];
  }
  for (let i = 0; i < N_IND; i++) if (d[i] > 0) out[i] += O * d[i] / dt;
  return out;
}

/**
 * WHAT A HEAD COSTS IN RENT, a month: on the floor its industry rents, the
 * market's rent for its feet; in a building of its own (OFF_FLOOR — a
 * hospital, a depot, the airport), what its industry pays for structures per
 * dollar of output (industries.ts `rent`, BEA) [D].
 */
function rentPerHead(s: GameState, i: number, opw: Float64Array): number {
  const id = INDUSTRY_IDS[i], I = INDUSTRIES[id], off = OFF_FLOOR[id];
  return (1 - off) * I.sfPerWorker * marketRent(s, i) / 12 + off * opw[i] * I.rent;
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
  // ...and a national swan's orders for a trade (blackswans.ts swanSec: a
  // pandemic's restaurants, a war's defense electronics, a trade war's
  // factories), shared over the industries the trade's firms are in.
  const sw = e.swanSec;
  if (sw) {
    const lvl = (E.swanInd ??= new Array(N_IND).fill(0));
    for (const [k, g] of Object.entries(sw) as [Sector, number][]) {
      const rows: [IndustryId, number][] = [];
      for (const fl of Object.values(TRADE_TO_INDUSTRY)) for (const r of fl[k] ?? []) rows.push([r[0], r[1]]);
      const tot = rows.reduce((a, r) => a + r[1], 0);
      for (const [id, w] of rows) lvl[INDUSTRY_INDEX[id]] += g * w / Math.max(1e-9, tot);
    }
  }
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
  return (E.XJ0?.[j] ?? 0) * Math.exp((E.lnNat?.[j] ?? 0) + (E.lnShare?.[j] ?? 0) + (E.swanLn ?? 0) + (E.swanInd?.[j] ?? 0) + cyc) * fx;
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
 * THE NATION'S OIL PRICE, as the live world prices it (inputs.ts
 * tickOilPrice — the supply shocks and a war's premium): one oil price, which
 * these books read and do not set.
 */
function tickOil(s: GameState, E: EconomyState): void {
  E.lnOil = s.econ.oilLn ?? 0;
  E.natCpi0 ??= s.econ.oilCpi0 ?? s.econ.natCpi ?? s.econ.cpi ?? 1;
  E.oil = s.econ.oil ?? OIL_PRICE_2000;
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
    firmRent += eng[i] * rentPerHead(s, i, opw);
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
  tickLinks(s, E, R, opening);
  R.done();
}

// ---------------------------------------------------------------- named links (step 2d)
export interface Links { s: Int32Array; c: Int32Array; j: Uint8Array; m0: Int16Array; ren: Int16Array; f: Float32Array }
type LinkRows = { s: number[]; c: number[]; j: number[]; m0: number[]; ren: number[]; f: number[] };
const LINK_COLS = ["s", "c", "j", "m0", "ren", "f"] as const;
function linksOf(r: LinkRows): Links {
  return { s: Int32Array.from(r.s), c: Int32Array.from(r.c), j: Uint8Array.from(r.j), m0: Int16Array.from(r.m0), ren: Int16Array.from(r.ren), f: Float32Array.from(r.f) };
}
/** A save's links back to typed columns (a JSON copy turns them into plain objects). */
function reviveLinks(E: EconomyState): void {
  const lk = E.lk as unknown as Record<string, unknown> | undefined;
  if (!lk || LINK_COLS.every((k) => ArrayBuffer.isView(lk[k]))) return;
  const rows = Object.fromEntries(LINK_COLS.map((k) => {
    const v = lk[k];
    return [k, Array.isArray(v) ? v as number[] : ArrayBuffer.isView(v) ? Array.from(v as unknown as ArrayLike<number>) : Object.values((v ?? {}) as Record<string, number>)];
  })) as LinkRows;
  E.lk = linksOf(rows);
}
/** Each named firm's name now, by firm id: the street's rolls, the player's buildings, the firms looking. */
/** Each named firm's name by its id (households.ts reads it for the workers it lays off). */
export function firmNamesOf(s: GameState): Map<number, string> { return firmNames(s); }
function firmNames(s: GameState): Map<number, string> {
  const out = new Map<number, string>();
  for (const roll of Object.values(s.econ.streetRolls ?? {})) for (const t of roll.t) if (t.fid !== undefined) out.set(t.fid, t.name);
  for (const h of Object.values(s.holdings)) for (const t of h.tenants ?? []) if (t.fid !== undefined) out.set(t.fid, t.name);
  for (const k of s.econ.seekers ?? []) if (k.t?.fid !== undefined) out.set(k.t.fid, k.t.name);
  return out;
}
/**
 * WHO SELLS TO WHOM, BY NAME (ONE_ECONOMY_PLAN step 2d). Each named firm keeps
 * a few real suppliers — "Ashe & Porter audits Ridgeway Machinery" — and buys
 * the rest of each input through its industry's pool, split by the IO table.
 *
 *   LINKS_PER_FIRM   suppliers a firm keeps by name: 3, so with the links it
 *                    holds as a supplier a firm has about six named
 *                    relationships [K: the plan's "about 5"; US firms in
 *                    Compustat report 2-4 major customers each — Atalay et
 *                    al. 2011, "Network structure of production", PNAS].
 *   LINK_SHARE       of what a firm buys of an industry from town, the share
 *                    its named suppliers in it take: half [K]. A single
 *                    customer is capped at CUSTOMER_CAP of a supplier's sales:
 *                    a supplier's largest customer averages about a fifth of
 *                    its sales among firms that report one (Patatoukas 2012,
 *                    "Customer-base concentration", Accounting Review) [S~].
 *   TERM             contracts run 24-48 months [K: B2B service agreements of
 *                    two to four years]; at renewal the customer re-tenders
 *                    and moves with SWITCH_P [K], more when its supplier is
 *                    short of cash (less than a month of costs) — a supplier
 *                    in trouble is a supplier that may not deliver.
 * A supplier is chosen among the island's named firms in the industry the
 * customer buys from, in proportion to what the customer buys of each
 * industry from town (IO_A x the local purchase coefficient), then to the
 * supplier's size and its cash (reliability). Not yet read: distance (the
 * books do not hold where a firm is) and price (one price an industry).
 *
 * WHAT A LINK DOES. Winning or losing a named customer moves the supplier's
 * own fortune (its tenant books' z, tenantBooks.ts) by the share of its sales
 * the customer was: the dollars come from or go to its industry's other firms
 * — the customer's business does not vanish when it moves, it goes to a rival.
 * When a customer closes, its industry's other firms take its work and buy
 * through the pool; its suppliers lose what it bought of them. That is the
 * shock travelling along the link, and the cause ledger says so: "Harlan
 * Works lost Ridgeway Machinery (14% of sales)".
 */
const LINKS_PER_FIRM = 3, LINK_SHARE = 0.5, CUSTOMER_CAP = 0.25, SWITCH_P = 0.15, SWITCH_DISTRESS = 0.35;
const TERM_LO = 24, TERM_SPAN = 25;
function tickLinks(s: GameState, E: EconomyState, R: Rand, opening: boolean): void {
  const F = E.f, nF = E.L.slot.n, m = s.month;
  reviveLinks(E);
  const lk: LinkRows = E.lk
    ? { s: Array.from(E.lk.s), c: Array.from(E.lk.c), j: Array.from(E.lk.j), m0: Array.from(E.lk.m0), ren: Array.from(E.lk.ren), f: Array.from(E.lk.f) }
    : { s: [], c: [], j: [], m0: [], ren: [], f: [] };
  const dz = (E.linkDz ??= {});
  // books just opened (or reopened): the links found are relationships the firms already had
  const quiet = opening || !E.last || m - (E.openM ?? m) < LINKS_PER_FIRM + 1;
  const slot = new Map<number, number>();
  for (let n = 0; n < nF; n++) if (F.id[n] >= 0) slot.set(F.id[n], n);
  const costM = (n: number) => Math.max(1, F.wages[n] + F.inputs[n] + F.rent[n]);
  const distressed = (n: number) => cashOf(E.L, n) < costM(n);
  // the firms' names this month, and who closed or left (by firm id) with its cause
  const nameOf = firmNames(s);
  const gone = new Map<number, { name: string; why: string; id?: number }>();
  for (const x of s.econ.streetFailed ?? []) if (x.m >= m - 1 && x.fid !== undefined && !x.to) gone.set(x.fid, { name: x.name, why: x.why === "dark" ? "closed" : "left town", id: x.whyId });
  const loss = (l: number, how: string, cause?: number) => {
    const sf = lk.s[l], ns = slot.get(sf);
    if (ns === undefined) return;
    const share = Math.min(0.6, lk.f[l] / Math.max(1, F.rev[ns]));
    if (!(share > 0) || quiet) return;
    dz[sf] = (dz[sf] ?? 0) + Math.log(1 - share);
    if (share < 0.02) return;
    const sup = nameOf.get(sf) ?? "a firm", cus = nameOf.get(lk.c[l]) ?? gone.get(lk.c[l])?.name ?? "a customer";
    const id = why(s, {
      k: "firm.lostCustomer", a: "firm", aid: String(sf), name: sup,
      n: { share, flowYr: Math.round(lk.f[l] * 12) },
      t: `${sup} lost ${cus} (${(share * 100).toFixed(0)}% of sales) · ${how}`,
    }, [cause]);
    const prev = (E.lkLoss ??= {})[sf];
    if (!prev || prev.m < m - 24 || share >= prev.share) E.lkLoss[sf] = { id, m, share };
  };
  // ---- 1. links whose firm is gone, and contracts up for renewal
  const keep: boolean[] = new Array(lk.s.length).fill(true);
  for (let l = 0; l < lk.s.length; l++) {
    const ns = slot.get(lk.s[l]), nc = slot.get(lk.c[l]);
    if (nc === undefined) {
      const g = gone.get(lk.c[l]);
      loss(l, g?.why ?? "gone", g?.id);
      keep[l] = false; continue;
    }
    if (ns === undefined) { keep[l] = false; continue; }   // the customer buys through the pool until it signs another
    if (lk.ren[l] <= m) {
      const p = SWITCH_P + (distressed(ns) ? SWITCH_DISTRESS : 0);
      if (R.u() < p) { loss(l, distressed(ns) ? "at renewal, short of cash" : "at renewal, to a better offer"); keep[l] = false; continue; }
      lk.ren[l] = m + TERM_LO + Math.floor(R.u() * TERM_SPAN);
    }
  }
  if (keep.some((k) => !k)) for (const key of ["s", "c", "j", "m0", "ren", "f"] as const) lk[key] = lk[key].filter((_, l) => keep[l]);
  // ---- 2. firms short of named suppliers sign one a month
  const have = new Map<number, number>();
  const pair = new Set<string>();
  for (let l = 0; l < lk.s.length; l++) { have.set(lk.c[l], (have.get(lk.c[l]) ?? 0) + 1); pair.add(`${lk.s[l]}:${lk.c[l]}`); }
  const byInd: number[][] = Array.from({ length: N_IND }, () => []);
  for (const [, n] of slot) byInd[F.ind[n]].push(n);
  const rpc = E.rpc;
  const wJ = new Float64Array(N_IND);
  for (const [fid, nc] of slot) {
    if ((have.get(fid) ?? 0) >= LINKS_PER_FIRM) continue;
    const u1 = R.u(), u2 = R.u();
    const row = IO_A[INDUSTRY_IDS[F.ind[nc]]];
    let tot = 0;
    for (let j = 0; j < N_IND; j++) { wJ[j] = byInd[j].length && rpc.length ? row[j] * (rpc[j] ?? 0) : 0; tot += wJ[j]; }
    if (!(tot > 0)) continue;
    let x = u1 * tot, j = 0;
    for (; j < N_IND - 1; j++) { x -= wJ[j]; if (x < 0) break; }
    const cand = byInd[j];
    let ct = 0;
    const wt = cand.map((n) => {
      if (n === nc || pair.has(`${F.id[n]}:${fid}`)) return 0;
      const cashM = cashOf(E.L, n) / costM(n);
      const w = F.hc[n] * (0.25 + Math.min(1, cashM / 3));
      ct += w; return w;
    });
    if (!(ct > 0)) continue;
    let y = u2 * ct, k = 0;
    for (; k < cand.length - 1; k++) { y -= wt[k]; if (y < 0) break; }
    const ns = cand[k], sf = F.id[ns];
    lk.s.push(sf); lk.c.push(fid); lk.j.push(j); lk.m0.push(m); lk.ren.push(m + TERM_LO + Math.floor(R.u() * TERM_SPAN));
    // last month's purchase, to size what the supplier won
    const flow = Math.min(CUSTOMER_CAP * F.rev[ns], LINK_SHARE / ((have.get(fid) ?? 0) + 1) * F.rev[nc] * row[j] * (rpc[j] ?? 0));
    lk.f.push(flow);
    have.set(fid, (have.get(fid) ?? 0) + 1); pair.add(`${sf}:${fid}`);
    if (!quiet && F.rev[ns] > 0) dz[sf] = (dz[sf] ?? 0) + Math.log(1 + Math.min(0.5, flow / F.rev[ns]));
  }
  E.lk = linksOf(lk);
  if (E.lkLoss) for (const [k, v] of Object.entries(E.lkLoss)) if (v.m < m - 24) delete E.lkLoss[k];
}

/** What each named link carried this month: its share of what the customer buys of the supplier's industry from town, capped (see tickLinks). */
function linkFlows(E: EconomyState): void {
  reviveLinks(E);
  const lk = E.lk;
  if (!lk || !lk.s.length) return;
  const F = E.f, slot = new Map<number, number>();
  for (let n = 0; n < E.L.slot.n; n++) if (F.id[n] >= 0) slot.set(F.id[n], n);
  const per = new Map<string, number>();
  for (let l = 0; l < lk.s.length; l++) { const key = `${lk.c[l]}:${lk.j[l]}`; per.set(key, (per.get(key) ?? 0) + 1); }
  for (let l = 0; l < lk.s.length; l++) {
    const ns = slot.get(lk.s[l]), nc = slot.get(lk.c[l]);
    if (ns === undefined || nc === undefined) { lk.f[l] = 0; continue; }
    const j = lk.j[l], buy = F.rev[nc] * IO_A[INDUSTRY_IDS[F.ind[nc]]][j] * (E.rpc[j] ?? 0);
    lk.f[l] = Math.min(CUSTOMER_CAP * F.rev[ns], LINK_SHARE / (per.get(`${lk.c[l]}:${j}`) ?? 1) * buy);
  }
}

/** A firm's named customers and suppliers, biggest first: who, the dollars a month, and the share of the supplier's sales. Pure. */
export function firmLinks(s: GameState, fid: number): { customers: { fid: number; name: string; flow: number; share: number; since: number }[]; suppliers: { fid: number; name: string; flow: number; share: number; since: number; industry: string }[] } {
  const E = s.economy, lk = E?.lk;
  const out = { customers: [] as { fid: number; name: string; flow: number; share: number; since: number }[], suppliers: [] as { fid: number; name: string; flow: number; share: number; since: number; industry: string }[] };
  if (!E || !lk) return out;
  reviveEconomy(E);
  reviveLinks(E);
  const L2 = E.lk!;
  const F = E.f, names = firmNames(s);
  const revOf = (id: number) => { for (let n = 0; n < E.L.slot.n; n++) if (F.id[n] === id) return F.rev[n]; return 0; };
  const nm = (id: number) => names.get(id) ?? "a firm";
  for (let l = 0; l < L2.s.length; l++) {
    if (L2.s[l] === fid) out.customers.push({ fid: L2.c[l], name: nm(L2.c[l]), flow: L2.f[l], share: L2.f[l] / Math.max(1, revOf(fid)), since: L2.m0[l] });
    if (L2.c[l] === fid) out.suppliers.push({ fid: L2.s[l], name: nm(L2.s[l]), flow: L2.f[l], share: L2.f[l] / Math.max(1, revOf(L2.s[l])), since: L2.m0[l], industry: INDUSTRIES[INDUSTRY_IDS[L2.j[l]]].label });
  }
  out.customers.sort((a, b) => b.flow - a.flow); out.suppliers.sort((a, b) => b.flow - a.flow);
  return out;
}

/** The cause ledger's event for a firm's latest loss of a customer worth 5% of its sales or more, in the last two years. */
export function whyFirmLoss(s: GameState, fid: number): number | undefined {
  const v = s.economy?.lkLoss?.[fid];
  return v && v.m >= s.month - 24 && v.share >= 0.05 ? v.id : undefined;
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
  for (let i = 0; i < N_IND; i++) rentMkt[i] = rentPerHead(s, i, opw);
  const rentOf = (n: number) => F.id[n] >= 0 ? F.rent[n] : F.hc[n] * rentMkt[F.ind[n]];

  // ---- each firm's payroll this month: its industry's earners' pay in the
  // household register (registerPayroll), shared over the industry's firms by
  // heads — so what the firms pay and what the households are paid are one
  // number. The register is a weighted sample, so an industry's earners sit
  // within half an agent's weight of its heads and its pay per head moves with
  // who they are; the industry's BEA pay is what they are hired at.
  const pr = registerPayroll(s);
  // ...and within an industry, by what each firm posts (`postPay`): a firm that pays more takes more of it
  for (let n = 0; n < nF; n++) { if (!(F.pay[n] > 0)) F.pay[n] = w; if (!(F.price[n] > 0)) F.price[n] = 1; }
  const hp = new Float64Array(N_IND);
  for (let n = 0; n < nF; n++) hp[F.ind[n]] += F.hc[n] * F.pay[n];
  const wagesOf = (n: number) => {
    const i = F.ind[n];
    return pr ? (hp[i] > 0 ? pr.wages[i] / PAY_SPLIT.cash * F.hc[n] * F.pay[n] / hp[i] : 0) : F.hc[n] * pay[i] * F.pay[n] / w;
  };

  // ---- 3. final demand
  const C = hm.spend;
  const sv = spendVector(e.online ?? 0, hm.spendCat);
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
  for (let j = 0; j < N_IND; j++) fH[j] = sv.v[j];
  const fIns = new Float64Array(N_IND), fFed = new Float64Array(N_IND);
  for (const [h, wt] of IND_HEALTH) { fIns[h] = MLR * insEmp * wt; fFed[h] = fedHealth * wt; }
  fIns[IND_INS] += (1 - MLR) * insEmp;
  fG[IND_GOV] = G; fC[IND_CON] = P;
  for (let j = 0; j < N_IND; j++) fd[j] = fH[j] + fIns[j] + fFed[j] + fG[j] + fC[j];

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
    buy.push([r * (fH[j] + fIns[j] + fFed[j]), r * firms, r * fG[j], r * (fC[j] + conB), X[j]]);
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
  let fedLocal = 0;
  for (const [h] of IND_HEALTH) fedLocal += E.rpc[h] * fFed[h];
  transfer(L, ACCOUNTS.rest, M, fedLocal, "health", "row>mkt:medicare and medicaid");
  // an employer's insurance dollar buys care and the insurer's service, here as far as the town supplies them
  let insLocal = (1 - MLR) * E.rpc[IND_INS];
  for (const [h, wt] of IND_HEALTH) insLocal += MLR * wt * E.rpc[h];

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

  linkFlows(E);
  postPayAndPrices(s, E, pr, sv.v);

  // ---- 7. households, the city, the landlords
  const H = ACCOUNTS.households, GOV = ACCOUNTS.government, LAND = ACCOUNTS.landlords, ROW = ACCOUNTS.rest, BANK = ACCOUNTS.bank;
  transfer(L, ROW, H, hm.pensions, "pensions", "row>hh:pensions");
  transfer(L, GOV, H, hm.ui, "ui", "gov>hh:unemployment insurance");
  transfer(L, ROW, H, hm.transfers, "transfers", "row>hh:SNAP and EITC");
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
  d.island = { persons: lab.islandPersons, kids: lab.islandKids, households: lab.islandRenters,
    jobs: s.economy?.cur?.m === s.month ? s.economy.cur.named.reduce((a, v) => a + v, 0) : 0 };
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
    // THE FLOOR THE OFF-MAP FIRMS NEED (FORMULA_LEDGER #10): each industry's
    // on-floor heads the island's named firms do not hold, at its feet a
    // worker on its class's floor — the same heads × sf a named firm's need
    // is (tenantMarket.ts `tenantHeads`). The region's sheds off the map are
    // sized from it (market.ts).
    const offFloorSf: Record<Floor, number> = { office: 0, retail: 0, industrial: 0 };
    const offHeads: number[] = [];
    for (let i = 0; i < N_IND; i++) {
      const id = INDUSTRY_IDS[i], fl = floorOf(id);
      const off = Math.max(0, heads[i] * (1 - OFF_FLOOR[id]) - (E.cur.named[i] ?? 0));
      offHeads.push(off);
      offFloorSf[fl] += off * SF_PER_JOB[fl] * sfMix(i, fl);
    }
    d.offFloorSf = offFloorSf;
    // ...and by industry, in heads: a shed firm moving onto the map from the
    // region is one of these (streetRolls.ts shed movers)
    d.offHeads = offHeads;
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
  if (E?.linkDz && Object.keys(E.linkDz).length) { d.linkDz = E.linkDz; E.linkDz = {}; }
  if (E?.posted) {
    d.wage = E.posted.wage; d.payIdx = E.posted.payIdx.slice(); d.priceRel = E.posted.priceRel; d.localShare = E.posted.localShare;
    whyPay(s, E.posted);
  }
  e.eco = d;
  if (d.floorSf && !e.eco0?.floorSf) {
    // (a save reopened on the 68 industries keeps each class's driver where it stood: `migrateEconomy`)
    const mig = e.eco0?.mig;
    (e.eco0 ??= {}).floorSf = mig
      ? Object.fromEntries(Object.entries(d.floorSf).map(([k, v]) => [k, (v ?? 0) / Math.max(1e-6, mig[k as Floor] ?? 1)]))
      : { ...d.floorSf };
    e.eco0.jobs ??= d.jobs;
    delete e.eco0.mig;
  }
  (e.eco0 ??= {}).renters ??= d.renters;
  if (d.islandWant !== undefined) e.eco0.islandWant ??= d.islandWant;
}

/**
 * A SAVE FROM BEFORE STEP 2b (24 industries). Its books are closed and reopen
 * on the 68 this month, as at an opening (the firms already exist: their cash
 * is the bank's deposits), sized on the town as it now stands; every earner's,
 * tenant's and street firm's industry is renumbered to its old industry's
 * largest successor (industries.ts OLD24_TO_68); and each class's demand
 * driver carries on from where it stood rather than restarting at one.
 * Called first thing in the month (sim.ts), before the street reads it.
 */
export function migrateEconomy(s: GameState): void {
  const E = s.economy;
  if (!E || !(E.rpc?.length) || E.rpc.length === N_IND) return;
  const map = OLD24_TO_68.map((k) => INDUSTRY_INDEX[k]);
  const re = (i: number | undefined) => (i !== undefined && i < map.length ? map[i] : undefined);
  const r = s.households;
  if (r) {
    if (!r.a) unpackHouseholds(r);
    const a = r.a!;
    for (let i = 0; i < r.n; i++) {
      if (a.ind1[i] < map.length) a.ind1[i] = map[a.ind1[i]];
      if (a.ind2[i] < map.length) a.ind2[i] = map[a.ind2[i]];
    }
  }
  const fix = (t: Tenant) => { if (t.ind !== undefined) { const v = re(t.ind); if (v === undefined) delete t.ind; else t.ind = v; } delete t.empInd; };
  for (const roll of Object.values(s.econ.streetRolls ?? {})) for (const t of roll.t) fix(t);
  for (const h of Object.values(s.holdings)) for (const t of h.tenants ?? []) fix(t);
  for (const k of s.econ.seekers ?? []) if (k.t) fix(k.t);
  const e = s.econ;
  if (e.eco?.floorSf && e.eco0?.floorSf) {
    const mig: Partial<Record<Floor, number>> = {};
    for (const k of FLOORS) { const a = e.eco.floorSf[k], b = e.eco0.floorSf[k]; if (a && b) mig[k] = a / b; }
    e.eco0 = { ...e.eco0, floorSf: undefined, mig };
  }
  if (e.eco) { delete e.eco.emp; delete e.eco.empPrev; delete e.eco.target; delete e.eco.offFloorSf; delete e.eco.offHeads; }
  // the off-map sheds re-anchor on the floor they hold (market.ts `offRef`)
  delete e.offRef; delete e.offFloor0;
  delete e.islandFill;
  delete s.economy;
}

// ---------------------------------------------------------------- pay and prices (§6c-D)
/**
 * FIRMS SET THEIR OWN PAY AND PRICES (ONE_ECONOMY_PLAN §6c-D; FORMULA_LEDGER
 * #15). The town's wage index and the local part of its price level used to be
 * set from the top — pay closing toward national pay x local prices over
 * national x a wage curve x a size term, and local prices moving with local
 * pay. Now each firm decides, every month, from its own books and its own
 * labour market, and the town's numbers are what they sum to:
 *
 * PAY. Every firm grants what every employer in the country grants (the
 * nation's pay path: expectations, productivity, the nation's slack — market.ts
 * `natWageIdx`), and moves its own premium over it toward what it takes to
 * hire here:
 *   - the town's slack: the register's unemployment against the nation's, at
 *     the wage curve's elasticity, -0.10 (Blanchflower & Oswald 1994) [S];
 *   - its industry's openings: the heads its industry staffs to that the
 *     register has not filled, V_SLOPE [K: a point of unfilled jobs adds half
 *     a point to the posted premium — firms short of hands outbid each other];
 *   - its own ability to pay: rent sharing, RENT_SHARE of its margin over its
 *     industry's (Card, Cardoso, Heining & Kline 2018: an elasticity of pay to
 *     a firm's surplus of 0.05-0.15) [S~];
 * closing half the gap in WAGE_GAP_HALF_M, as before. Nominal pay is not cut:
 * a cut the firm could not make is owed and worked off by thinner raises
 * (Card & Hyslop; the engine's old `wageDebt`, now each firm's own). The
 * town's wage index is the heads-weighted average of what its firms post; each
 * industry's average carries its earners' pay in the register (households.ts).
 * Gone with the old formula: local prices in pay (a cheaper town no longer
 * pays less because its flats are cheap — it pays less only if its workers
 * are easier to hire) and the size term.
 *
 * PRICES. A firm's price against the nation's for its industry follows its
 * unit cost — its pay against the nation's, at its industry's labour share
 * (BEA compensation per $ of output); its inputs are bought at national
 * prices — and the demand it faces, its industry's orders against the heads
 * it has (PRICE_DEMAND [K]: a tenth of a log point per log point of excess
 * demand). Sticky: a firm reprices in a given month with odds 1/PRICE_DUR_M,
 * nine months on average (Nakamura & Steinsson 2008: median 8-11 months
 * between regular price changes) [S]. The town's local prices are the
 * household-spending-weighted average of its industries'; market.ts reads
 * them into the CPI at the share of the household basket bought in town.
 */
const RENT_SHARE = 0.06, V_SLOPE = 0.5, PRICE_DUR_M = 9, PRICE_DEMAND = 0.1;
export interface Posted { m: number; wage: number; payIdx: number[]; priceRel: number; localShare: number; openings: number; unemp: number; natW: number; wage12?: number }
function postPayAndPrices(s: GameState, E: EconomyState, pr: { wages: Float64Array; earners: Float64Array } | null, spend: Float64Array): void {
  const e = s.econ, F = E.f, nF = E.L.slot.n, m = s.month;
  const natW = Math.max(1e-6, e.natWageIdx ?? e.wageIdx ?? 1);
  const lab = registerLabour(s);
  const uLoc = lab && lab.lf > 0 ? lab.unemployed / lab.lf : (e.unemployment ?? 0.05);
  const uNat = e.nat?.unemp ?? uLoc;
  const emp = E.emp ?? [], implied = E.last?.impliedHeads ?? [];
  // each industry's openings: what its firms staff to that the register has not filled
  const open = new Float64Array(N_IND);
  let openings = 0, jobs = 0;
  for (let i = 0; i < N_IND; i++) {
    const want = emp[i] ?? 0, have = pr?.earners[i] ?? want;
    open[i] = want > 0 ? Math.max(0, want - have) / want : 0;
    openings += Math.max(0, want - have); jobs += want;
  }
  const close = 1 - Math.exp(-Math.LN2 / WAGE_GAP_HALF_M);
  const slack = WAGE_CURVE * Math.log(Math.max(0.01, uLoc) / Math.max(0.01, uNat));
  const prevNat = E.posted?.natW ?? natW;
  for (let n = 0; n < nF; n++) {
    const i = F.ind[n], I = INDUSTRIES[INDUSTRY_IDS[i]];
    // ---- pay
    const rel = Math.log(Math.max(1e-6, F.pay[n]) / prevNat);
    const margin = F.rev[n] > 0 ? F.ebitda[n] / F.rev[n] : I.gos;
    const target = slack + V_SLOPE * open[i] + RENT_SHARE * (margin - I.gos);
    let next = natW * Math.exp(rel + (target - rel) * close);
    if (next < F.pay[n]) { F.owe[n] += Math.log(F.pay[n] / next); next = F.pay[n]; }
    else if (F.owe[n] > 0) {
      const room = Math.log(next / F.pay[n]), repay = Math.min(F.owe[n], room * 0.12 + 0.00008);
      F.owe[n] -= repay; next = F.pay[n] * Math.exp(room - repay);
    }
    F.owe[n] = Math.min(0.25, Math.max(0, F.owe[n]));
    F.pay[n] = next;
    // ---- price, when this firm reprices this month
    if (hashU01(F.id[n], m) < 1 / PRICE_DUR_M) {
      const costRel = 1 + I.comp * (F.pay[n] / natW - 1);
      const press = emp[i] > 0 && implied[i] > 0 ? Math.log(implied[i] / emp[i]) : 0;
      F.price[n] = Math.max(0.5, costRel * Math.exp(PRICE_DEMAND * press));
    }
  }
  // ---- what the town's firms post, summed
  const hp = new Float64Array(N_IND), hh = new Float64Array(N_IND), hpr = new Float64Array(N_IND);
  let tp = 0, th = 0;
  for (let n = 0; n < nF; n++) { const i = F.ind[n]; hp[i] += F.hc[n] * F.pay[n]; hh[i] += F.hc[n]; hpr[i] += F.hc[n] * F.price[n]; tp += F.hc[n] * F.pay[n]; th += F.hc[n]; }
  const payIdx = Array.from(hp, (v, i) => (hh[i] > 0 ? v / hh[i] : natW));
  let wp = 0, ws = 0, all = 0;
  for (let i = 0; i < N_IND; i++) {
    const local = spend[i] * (E.rpc[i] ?? 0);
    all += spend[i];
    if (hh[i] > 0 && local > 0) { wp += local * hpr[i] / hh[i]; ws += local; }
  }
  const wage = th > 0 ? tp / th : (e.wageIdx ?? 1);
  const hist = (E.wageHist ??= []);
  hist.push(wage); if (hist.length > 13) hist.shift();
  E.posted = {
    m, wage, payIdx, priceRel: ws > 0 ? wp / ws : 1, localShare: all > 0 ? ws / all : 0,
    openings, unemp: uLoc, natW, wage12: hist.length === 13 ? wage / hist[0] - 1 : undefined,
  };
}
/** A uniform [0,1) from a firm and a month: whether it reprices, the same in every copy of the game. */
function hashU01(id: number, m: number): number {
  let h = Math.imul((id | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(m | 0, 0xc2b2ae35);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** Once a year, why the town's pay moved: what its firms posted, its openings and its jobless. */
function whyPay(s: GameState, p: Posted): void {
  if (s.month % 12 !== 0 || p.wage12 === undefined) return;
  whyOnce(s, `town.wages:${s.month}`, () => ({
    k: "town.wages", a: "city",
    n: { wage12: p.wage12!, openings: Math.round(p.openings), unemp: p.unemp, priceRel: p.priceRel },
    t: `wages ${p.wage12! >= 0 ? "up" : "down"} ${(Math.abs(p.wage12!) * 100).toFixed(1)}%: ${Math.round(p.openings).toLocaleString("en-US")} openings, ${(p.unemp * 100).toFixed(1)}% unemployed`,
  }));
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
  }, () => {
    if (Math.abs(dX) > Math.abs(dLocal)) return [whyNation(s), whyTown(s)];
    // the households' channel moved most: what they bought of it, in the category that buys most of it (households stage 5)
    const dH = l.buy[i][0] - m.hh[i], dF = l.buy[i][1] - m.firms[i];
    const cat = s.households?.flow.spendCat;
    if (cat && Math.abs(dH) >= Math.abs(dF)) {
      let top: SpendCategory | undefined, best = 0;
      for (const c of Object.keys(SPEND_BRIDGE) as SpendCategory[]) { const v = (cat[c] ?? 0) * (SPEND_BRIDGE[c][id] ?? 0); if (v > best) { best = v; top = c; } }
      if (top) return [whyHouseholdSpend(s, top), whyTown(s), whyNation(s)];
    }
    return [whyTown(s), whyNation(s)];
  });
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
  // the marginal dollar is spent in the mix the town's households spent this month
  const svc = spendVector(s.econ.online ?? 0, hm.spend > 0 ? hm.spendCat : null);
  const sv = svc.v.map((x) => x / Math.max(1e-12, svc.total));
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
