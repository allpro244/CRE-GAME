// FIRM BOOKS IN SHADOW — ONE ECONOMY, STEP 1 (2026-10-28).
//
// Every named firm in town — each tenant with a firm id in the street's
// rolls, the player's buildings and the queue of firms looking for space —
// and a weighted sample of the firms that are not on the map, each with an
// INDUSTRY (industries.ts) and its own books:
//
//   revenue      by buyer: households, other firms, government, building
//                projects, the rest of the country
//   - wages      its heads at its industry's pay (BEA compensation per worker)
//   - inputs     bought from the other industries by the IO table's row, the
//                local share from local firms, the rest from outside
//   - rent       a named firm's lease; an off-map firm's market rent
//   - production tax, interest, income tax
//   = cash, debt, equity
//
// Each month (sim.ts, after the household register) the industries' output
// is SOLVED from the demand the engine already has — the household
// register's spending, the government's own provision, the building pipeline
// at the cost of building it, and exports moving with the trades' sales and
// the nation's output — through the input-output table, every purchase either
// made in town (the local purchase coefficient) or leaking out. Each
// industry's output is the revenue of its firms, shared by size and fortune.
// Every dollar moves through the ledger (sfc.ts), so the whole city
// reconciles: the sum of every account is zero.
//
// STEP 1 IS A SHADOW. Nothing in the world reads these books. The tick reads
// the state and writes only `s.economy` and its own random stream
// (`s.streams.economy`), so the world it shadows is byte for byte the world
// without it (BASELINE.json does not move). `tools/economy.mjs` holds its
// answers against the engine's: employment by industry, the multiplier its
// leakages imply, the share of output exported, margins against the BEA's.
//
// STORAGE: the firms are columns (typed arrays) beside the ledger's slot
// columns of cash and debt — firm n is ledger slot n — so a month allocates
// little and the state clone each month copies arrays, not objects. A JSON
// round trip turns a column into a plain object; `reviveEconomy` mends it.
//
// [S] a fact with a source, [D] derived from one by stated arithmetic, [K] a
// shape parameter, stated as one (CLAUDE.md).
import type { BuiltClass, GameState, Sector, Tenant } from "./types";
import { BUILT_CLASSES } from "./types";
import {
  INDUSTRIES, INDUSTRY_IDS, N_IND, INDUSTRY_INDEX, IO_A, IO_ROW_SUM, NAT_EMP_SHARE, TRADE_TO_INDUSTRY, FLOOR_DEFAULT,
  HQ_SHARE, FINANCE_LIKE, SPEND_SHARE, SPEND_BRIDGE, PAY_SPLIT, PROD_TAX_LOCAL, CORP_TAX, LOCAL_OWNER_SHARE,
  COMP_PER_WORKER_2023, BUYER_TYPES, type IndustryId, type Floor, type BuyerType, type SpendCategory,
} from "./industries";
import {
  type Ledger, newLedger, transfer, lend, repay, chargeOff, openDebt, sellBond, ledgerSum, ledgerGross, newMonth, ACCOUNTS,
  cashOf, debtOf, addSlot, compactSlots, reviveF64, reviveLedger,
} from "./sfc";
import { SF_PER_JOB, FIRM_PROFILE, LENDER_COVER, shortIndexOf, CONSTRUCTION_JOB_SHARE, REF_PIPE_SHARE, BUILD_MONTHS, SECTORS } from "./market";
import { HARD_COST_PSF, SOFT_COST, CONTINGENCY, constructionTypeMult } from "./value";
import { householdMoney } from "./households";

// ---------------------------------------------------------------- the facts
/** Off-map firms kept per industry: the sample each industry's off-map employment is shared over. [K] (precision, not a fact) */
export const OFF_PER = 6;
/**
 * A firm's own fortunes: the same process the engine's tenant books run
 * (tenantBooks.ts Z_RHO, Z_SIG — monthly persistence 0.985, a small firm's
 * sales ~19% either side of its trade's; Census BDS), for the off-map
 * sample. A named firm reads its tenant books' own draw.
 */
const Z_RHO = 0.985, Z_SIG = 0.033;
/** Months of costs a firm keeps in cash; surplus over it paid out at 15% a month (tenantBooks.ts CASH_KEEP_M; JPMorgan Chase Institute 2016). [S] */
const CASH_KEEP_M = 1.5, PAYOUT_M = 0.15;
/** Debt moves toward what a lender would write over three years (market.ts tickFirmBook, tenantBooks.ts). [K] */
const DEBT_ADJ_M = 36;

const IND_GOV = INDUSTRY_INDEX.government, IND_CON = INDUSTRY_INDEX.construction, IND_SHOPS = INDUSTRY_INDEX.shops, IND_FUL = INDUSTRY_INDEX.fulfil;
const FLOORS: readonly Floor[] = ["office", "retail", "industrial"];
const NO_SEC = 255;

// ---------------------------------------------------------------- state
/** The firms, one column per field; firm n is ledger slot n. */
const F64 = ["hc", "z", "eq", "rev", "wages", "inputs", "rent", "prodTax", "interest", "incomeTax", "payout", "ebitda"] as const;
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
interface Seen { sec: Sector; floor: Floor; hc: number; rentMo: number; z: number }
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
    out.set(t.fid, { sec: t.sector, floor, hc: headsOf(t, floor), rentMo: rentYr / 12, z: t.fin?.z ?? 0 });
  };
  for (const roll of Object.values(s.econ.streetRolls ?? {})) for (const t of roll.t) add(t, true);
  for (const h of Object.values(s.holdings)) for (const t of h.tenants ?? []) add(t, true);
  for (const k of s.econ.seekers ?? []) if (k.t) add(k.t, false);
  return out;
}

/** The engine's construction jobs this month (market.ts, the BUILDING IS A JOB block — the same arithmetic, read). */
function constructionJobs(s: GameState): number {
  const e = s.econ;
  let pipe = 0, stock = 0;
  for (const k of BUILT_CLASSES) { pipe += e.pipeline?.[k] ?? 0; stock += e.stock?.[k] ?? 0; }
  const share = stock > 0 ? pipe / stock : REF_PIPE_SHARE;
  const trades = Math.max(0, Math.min(0.11, CONSTRUCTION_JOB_SHARE * (share / REF_PIPE_SHARE)));
  return (e.jobs ?? 0) * trades / (1 - CONSTRUCTION_JOB_SHARE + trades);
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

/** Industry for a named firm new to the books: its trade on its floor, by US employment; any office firm a headquarters at HQ_SHARE. */
function assign(R: Rand, sec: Sector, floor: Floor): number {
  const a = R.u(), b = R.u();   // always two draws: the stream's pace does not depend on the answer
  if (floor === "office" && a < HQ_SHARE) return INDUSTRY_INDEX.hq;
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
  if (cash > 0) payOwners(L, n, cash);
  else if (cash < 0) transfer(L, ACCOUNTS.bank, n, -cash, "overdraft", "bank>firm:overdraft at closing");
  chargeOff(L, n);
}

/**
 * THE OFF-MAP FIRMS. The town's employment (e.jobs) less the named firms'
 * heads: first the engine's own construction jobs, then the rest toward the
 * nation's industry mix (CES), to the industries the street leaves short.
 */
function offMapHeads(s: GameState, named: Float64Array): Float64Array {
  const jobs = s.econ.jobs ?? 0;
  let namedTot = 0;
  for (let i = 0; i < N_IND; i++) namedTot += named[i];
  let O = Math.max(0, jobs - namedTot);
  const out = new Float64Array(N_IND);
  const con = Math.min(O, constructionJobs(s));
  out[IND_CON] = con; O -= con;
  const d = new Float64Array(N_IND);
  let dt = 0;
  for (let i = 0; i < N_IND; i++) {
    if (i === IND_CON) continue;
    d[i] = Math.max(0, NAT_EMP_SHARE[INDUSTRY_IDS[i]] * jobs - named[i]);
    dt += d[i];
  }
  for (let i = 0; i < N_IND; i++) {
    if (i === IND_CON) continue;
    out[i] += O * (dt > 0 ? d[i] / dt : NAT_EMP_SHARE[INDUSTRY_IDS[i]]);
  }
  return out;
}

/** What each industry's exports move with: its trades' sales on the street; else the nation's output (and the factory floor the dollar has left, for plants). */
function exportSignal(s: GameState, E: Pick<EconomyState, "sigW" | "lnY0" | "manuf0">, i: number): number {
  const e = s.econ;
  const w = E.sigW[i];
  let a = 0, t = 0;
  for (const [sec, h] of Object.entries(w) as [Sector, number][]) { a += h * (e.firmBooks?.[sec]?.sales ?? 1); t += h; }
  if (t > 0) return a / t;
  const nat = Math.exp((e.nat?.lnY ?? 0) - E.lnY0);
  return INDUSTRIES[INDUSTRY_IDS[i]].group === "making" ? nat * (e.manufIdx ?? 1) / Math.max(1e-6, E.manuf0) : nat;
}

/**
 * Output per job of the engine trades behind an industry (market.ts firm
 * books: sales over employment, both indices); an industry with no trade on
 * the street takes the town's trades together, by their heads at the opening.
 */
function tradeProductivity(s: GameState, E: Pick<EconomyState, "sigW">, i: number): number {
  const fb = s.econ.firmBooks;
  const of = (w: Partial<Record<Sector, number>>) => {
    let a = 0, t = 0;
    for (const [sec, h] of Object.entries(w) as [Sector, number][]) { const b = fb?.[sec]; if (!b) continue; a += h * b.sales / Math.max(1e-9, b.emp); t += h; }
    return t > 0 ? a / t : NaN;
  };
  const own = of(E.sigW[i]);
  if (Number.isFinite(own)) return own;
  const all: Partial<Record<Sector, number>> = {};
  for (const w of E.sigW) for (const [sec, h] of Object.entries(w) as [Sector, number][]) all[sec] = (all[sec] ?? 0) + h;
  const town = of(all);
  return Number.isFinite(town) ? town : 1;
}

// ---------------------------------------------------------------- the month
/**
 * ONE MONTH OF THE CITY'S BOOKS. Called from sim.ts after the household
 * register. Reads the world; writes `s.economy` and `s.streams.economy` only.
 */
export function tickEconomy(s: GameState): void {
  const e = s.econ;
  if (!e) return;
  const hm = householdMoney(s);
  if (!hm || !(hm.spend > 0)) return;          // the register's first month has no flows yet
  const R = stream(s);
  const seen = readFirms(s);
  const opening = !s.economy;
  const E: EconomyState = s.economy ??= {
    v: 1, openM: s.month, f: allocCols(0), nextOff: -1, L: newLedger("firm", 0),
    w0: e.wageIdx ?? 1, lnY0: e.nat?.lnY ?? 0, manuf0: e.manufIdx ?? 1,
    rpc: [], X0: [], sig0: [], prod0: [], sigW: [], last: null,
  };
  reviveEconomy(E);
  const L = E.L, c = E.f;
  newMonth(L);
  const short = shortIndexOf(e) / 100;
  const w = e.wageIdx ?? 1;
  const { opw, pay } = perHead(w);

  // ---- 1. the named firms: gone ones close, new ones get an industry and books
  {
    const n0 = L.slot.n, keep = new Array<boolean>(n0);
    const have = new Set<number>();
    for (let n = 0; n < n0; n++) {
      const id = c.id[n];
      if (id < 0) { keep[n] = true; continue; }
      const sn = seen.get(id);
      if (!sn) { closeBooks(L, n); keep[n] = false; continue; }
      c.hc[n] = sn.hc; c.z[n] = sn.z; have.add(id); keep[n] = true;
    }
    if (keep.some((k) => !k)) {
      const map = compactSlots(L, keep);
      const cols = COLS(E.f);
      for (let n = 0; n < n0; n++) { const j = map[n]; if (j >= 0 && j !== n) for (const col of cols) col[j] = col[n]; }
    }
    for (const [fid, sn] of seen) {
      if (have.has(fid)) continue;
      const ind = assign(R, sn.sec, sn.floor);
      const n = addFirm(E, fid, ind, SECTORS.indexOf(sn.sec), sn.hc, sn.z, s.month);
      openBooks(E, n, opw[ind], short, opening);
    }
  }
  const f = E.f, N = () => L.slot.n;
  const named = new Float64Array(N_IND);
  for (let n = 0; n < N(); n++) if (f.id[n] >= 0) named[f.ind[n]] += f.hc[n];

  // ---- 2. the off-map sample
  const off = offMapHeads(s, named);
  if (opening) {
    for (let i = 0; i < N_IND; i++) for (let k = 0; k < OFF_PER; k++) {
      const n = addFirm(E, E.nextOff--, i, NO_SEC, off[i] / OFF_PER, Z_SIG * R.n() / Math.sqrt(1 - Z_RHO * Z_RHO), s.month);
      openBooks(E, n, opw[i], short, true);
    }
  } else {
    for (let n = 0; n < N(); n++) if (E.f.id[n] < 0) { E.f.hc[n] = off[E.f.ind[n]] / OFF_PER; E.f.z[n] = Z_RHO * E.f.z[n] + Z_SIG * R.n(); }
  }
  const F = E.f, nF = N();
  const heads = new Float64Array(N_IND);
  for (let i = 0; i < N_IND; i++) heads[i] = named[i] + off[i];

  // ---- 3. final demand
  const sv = spendVector(e.online ?? 0);
  const C = hm.spend;
  const G = heads[IND_GOV] * opw[IND_GOV];
  const P = buildingSpend(s);
  const fH = new Float64Array(N_IND), fG = new Float64Array(N_IND), fC = new Float64Array(N_IND), fd = new Float64Array(N_IND);
  for (let j = 0; j < N_IND; j++) fH[j] = C * sv.v[j];
  fG[IND_GOV] = G; fC[IND_CON] = P;
  for (let j = 0; j < N_IND; j++) fd[j] = fH[j] + fG[j] + fC[j];

  if (opening) {
    // CALIBRATION: at the opening the town makes what its heads make (x = S).
    // The town supplies its own use of a commodity up to what its firms make
    // of it, after what comes from abroad (the supply-demand pool method;
    // Miller & Blair 2009, Input-Output Analysis, ch. 8); what its firms make
    // beyond its own use is its exports — its economic base.
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
    for (let n = 0; n < nF; n++) if (F.id[n] >= 0 && F.sec[n] !== NO_SEC) {
      const sw = E.sigW[F.ind[n]], sec = SECTORS[F.sec[n]];
      sw[sec] = (sw[sec] ?? 0) + F.hc[n];
    }
    for (let j = 0; j < N_IND; j++) { E.sig0.push(exportSignal(s, E, j)); E.prod0.push(tradeProductivity(s, E, j)); }
  }
  const X = new Float64Array(N_IND);
  // Exports in dollars: the real quantity (the signal) at the price of a unit
  // of it, which is pay over output per worker — the wage index over the
  // trades' own productivity (their books' sales per job). Pricing them at
  // pay alone counted the productivity in the quantity and again in the price.
  for (let j = 0; j < N_IND; j++) {
    const price = (w / E.w0) / Math.max(1e-6, tradeProductivity(s, E, j) / Math.max(1e-9, E.prod0[j]));
    X[j] = E.X0[j] * (exportSignal(s, E, j) / Math.max(1e-9, E.sig0[j])) * price;
  }

  // ---- 4. the output that demand calls for, and who bought it
  const { x, iters } = solve(E.rpc, fd, X, opening ? null : E.last?.x ?? null);
  const buy: number[][] = [];
  for (let j = 0; j < N_IND; j++) {
    let firms = 0, con = 0;
    for (let i = 0; i < N_IND; i++) { const a = A_FLAT[i * N_IND + j] * x[i]; if (i === IND_CON) con += a; else firms += a; }
    const r = E.rpc[j];
    buy.push([r * fH[j], r * firms, r * fG[j], r * (fC[j] + con), X[j]]);
  }

  // ---- 5. the buyers pay the market
  const M = ACCOUNTS.market;
  let cLocal = 0, gLocal = 0, pLocal = 0, xTot = 0;
  for (let j = 0; j < N_IND; j++) { cLocal += buy[j][0]; gLocal += buy[j][2]; pLocal += E.rpc[j] * fC[j]; xTot += X[j]; }
  transfer(L, ACCOUNTS.households, M, cLocal, "spend", "hh>mkt:spend");
  transfer(L, ACCOUNTS.households, ACCOUNTS.rest, C - cLocal, "imports", "hh>row:imports");
  transfer(L, ACCOUNTS.government, M, gLocal, "provision", "gov>mkt:provision");
  transfer(L, ACCOUNTS.government, ACCOUNTS.rest, G - gLocal, "imports", "gov>row:imports");
  transfer(L, ACCOUNTS.landlords, M, pLocal, "building", "land>mkt:building");
  transfer(L, ACCOUNTS.landlords, ACCOUNTS.rest, P - pLocal, "imports", "land>row:imports");
  transfer(L, ACCOUNTS.rest, M, xTot, "exports", "row>mkt:exports");

  // ---- 6. every firm's month
  const { loc, imp } = inputSplit(E.rpc);
  const wsum = new Float64Array(N_IND), nInd = new Float64Array(N_IND), wt = new Float64Array(nF);
  for (let n = 0; n < nF; n++) { wt[n] = F.hc[n] * Math.exp(F.z[n]); wsum[F.ind[n]] += wt[n]; nInd[F.ind[n]]++; }
  const rentMkt = new Float64Array(N_IND);
  for (let i = 0; i < N_IND; i++) rentMkt[i] = INDUSTRIES[INDUSTRY_IDS[i]].sfPerWorker * marketRent(s, i) / 12;
  const credit = Math.max(0, Math.min(1, ((e.creditIdx ?? 1) - 0.5) / 0.5));
  let wagesCash = 0;
  for (let n = 0; n < nF; n++) {
    const i = F.ind[n], I = INDUSTRIES[INDUSTRY_IDS[i]];
    const share = wsum[i] > 0 ? wt[n] / wsum[i] : 1 / nInd[i];
    const rev = x[i] * share;
    const hc = F.hc[n];
    const wages = hc * pay[i];
    const inLoc = rev * loc[i], inImp = rev * imp[i];
    const sn = F.id[n] >= 0 ? seen.get(F.id[n]) : undefined;
    const rent = sn ? sn.rentMo : hc * rentMkt[i];
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
    transfer(L, n, ACCOUNTS.rest, wages * (1 - PAY_SPLIT.cash), "benefits", "firm>row:benefits and payroll tax");
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

  E.last = {
    m: s.month, C, G, P, X: xTot, hhWagesRegister: hm.wages, hhWagesFirms: wagesCash,
    x: Array.from(x), buy, heads: Array.from(heads), namedHeads: Array.from(named),
    impliedHeads: Array.from(x, (v, i) => v / Math.max(1e-9, opw[i])),
    ledgerSum: ledgerSum(L), ledgerGross: ledgerGross(L), market: cashOf(L, M), iters,
  };
  R.done();
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
  }));
}
