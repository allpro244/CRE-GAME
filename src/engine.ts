// ============================================================
// GROUNDWORK v1.1 — simulation engine (pure functions, no React)
// Tenant-level rent rolls, LOI/RFP leasing, off-market deals,
// itemized expenses, structured debt, credit facilities.
// ============================================================

export type PType = 'office' | 'retail' | 'industrial' | 'mixed' | 'multifamily';
export const PTYPES: PType[] = ['office', 'retail', 'industrial', 'mixed', 'multifamily'];
export const PLABEL: Record<PType, string> = {
  office: 'Office', retail: 'Retail', industrial: 'Industrial', mixed: 'Mixed-Use', multifamily: 'Multifamily',
};

// ---------- RNG ----------
export function mulberry32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function rng(state: GameState): number {
  const r = mulberry32(state.rngCursor)();
  state.rngCursor = (state.rngCursor + 0x9E3779B9) | 0;
  return r;
}
function rrange(state: GameState, a: number, b: number) { return a + (b - a) * rng(state); }
function rpick<T>(state: GameState, arr: T[]): T { return arr[Math.floor(rng(state) * arr.length) % arr.length]; }

// ---------- Config ----------
export interface ConstrSpec {
  id: string; label: string; cost: number; q: number; qCap: number;
  minUnits?: number; fixedUnits?: number; maxSF?: number; rentBonus?: number;
}
export const CONSTR: Record<PType, ConstrSpec[]> = {
  industrial: [
    { id: 'tilt', label: 'Tilt-wall concrete', cost: 108, q: 78, qCap: 95 },
    { id: 'metal', label: 'Pre-engineered metal', cost: 82, q: 58, qCap: 70 },
    { id: 'tin', label: 'Tin / light steel', cost: 58, q: 36, qCap: 45 },
  ],
  retail: [
    { id: 'center', label: 'Shopping center', cost: 192, q: 70, qCap: 90, minUnits: 6 },
    { id: 'strip', label: 'Retail strip', cost: 128, q: 38, qCap: 55, minUnits: 3 },
    { id: 'pad', label: 'Pad site (single tenant)', cost: 218, q: 74, qCap: 92, fixedUnits: 1, maxSF: 8000, rentBonus: 0.25 },
  ],
  office: [
    { id: 'concrete', label: 'Concrete & steel — Class A', cost: 268, q: 84, qCap: 95 },
    { id: 'masonry', label: 'Masonry — Class B', cost: 205, q: 60, qCap: 72 },
    { id: 'wood', label: 'Wood frame — Class C', cost: 152, q: 38, qCap: 45 },
  ],
  mixed: [
    { id: 'podium', label: 'Podium mixed-use', cost: 252, q: 70, qCap: 92 },
  ],
  multifamily: [
    { id: 'garden', label: 'Garden apartments', cost: 165, q: 52, qCap: 68 },
    { id: 'midrise', label: 'Wood-podium midrise', cost: 210, q: 68, qCap: 84 },
    { id: 'tower', label: 'Concrete tower — Class A', cost: 295, q: 86, qCap: 95 },
  ],
};
export const FAR: Record<PType, number> = { industrial: 0.45, retail: 0.25, office: 2.2, mixed: 1.4, multifamily: 1.6 };
export function isAggregate(type: PType): boolean { return type === 'multifamily'; }

export const CONFIG = {
  GRID_W: 14, GRID_H: 10,
  START_CASH: 600_000,
  baseRent: { office: 30.5, retail: 20.0, industrial: 8.2, mixed: 31, multifamily: 21.5 } as Record<PType, number>,
  hardCost: { office: 215, retail: 175, industrial: 92, mixed: 245, multifamily: 195 } as Record<PType, number>, // legacy: renovation basis
  baseCap: { office: 6.7, retail: 7.0, industrial: 6.3, mixed: 6.45, multifamily: 5.95 } as Record<PType, number>,
  absorbBase: { office: 0.10, retail: 0.15, industrial: 0.22, mixed: 0.13, multifamily: 0.20 } as Record<PType, number>,
  // itemized expense ratios (share of potential rent unless noted)
  expense: {
    maint: { office: 0.115, retail: 0.075, industrial: 0.05, mixed: 0.10, multifamily: 0.13 } as Record<PType, number>, // industrial applies to VACANT space only
    insurance: { office: 0.045, retail: 0.042, industrial: 0.030, mixed: 0.045, multifamily: 0.055 } as Record<PType, number>,
    taxes: { office: 0.125, retail: 0.105, industrial: 0.080, mixed: 0.115, multifamily: 0.120 } as Record<PType, number>,
    mgmtOfEGI: 0.03,
    camMulti: 0.045, camRecovery: 0.70, // office/mixed multi-tenant CAM, mostly recovered
    nnnSlippage: 0.95,            // NNN recoveries collect at 95%
    mfGrounds: 0.025, mfTurnover: 0.04, mfLeasing: 0.03, // multifamily-specific (turnover/leasing on EGI)
  },
  softCostPct: 0.15,
  saleCostPct: 0.03,
  acqLTV: 0.75, indLTVBonus: 0.05, constrLTC: 0.70, refiLTV: 0.70,
  acqSpread: 2.0, constrSpread: 3.0, refiSpread: 1.75, facilitySpread: 1.6,
  minDSCR: 1.25, refiDSCR: 1.20,
  acqAmortYears: 30, refiAmortMax: 25, loanTermMonths: 120,
  feasCost: 8_000,
  scoutCost: 20_000, scoutCooldown: 3,
  primeSpread: 3.0,
  tiers: [
    { name: 'Local Investor', nw: 0, maxSF: 25_000 },
    { name: 'Established Developer', nw: 3_000_000, maxSF: 70_000 },
    { name: 'Regional Player', nw: 12_000_000, maxSF: 160_000 },
  ],
};

// ---------- Types ----------
export interface Tile {
  i: number; x: number; y: number;
  water: boolean;
  park?: boolean;   // unbuildable green — engine-wise it's water, render-wise it's trees
  // D (desirability) = baseD + what the neighborhood has become. baseD is the anchor —
  // geography and street access, fixed at generation except for permanent infrastructure
  // (transit). The rest is emergent: the blend of jobs, residents and retail nearby.
  D: number; baseD: number;
  income: number; emp: number; pop: number; indSuit: number; crime: number;
  // anchors for the demand side: the part of population/jobs the modeled stock doesn't
  // explain (single-family neighborhoods, small employers). Emergent stock adds on top.
  popBase: number; empBase: number;
  supply: Record<PType, number>;
  // street access, fixed at city generation: arterial frontage, highway/rail proximity,
  // and how quiet the block is. Retail wants frontage; industrial wants the highway and
  // the rail spur; housing pays for quiet.
  acc: { art: number; hwy: number; rail: number; quiet: number };
}

// Streets live on the boundaries between blocks: hz[y][x] is the segment between
// tile (x, y-1) and (x, y); vt[y][x] between (x-1, y) and (x, y).
// Classes: 0 none · 1 local · 2 collector · 3 arterial · 4 highway · 5 rail.
export interface RoadNet { hz: number[][]; vt: number[][] }

export type Phase = 'recovery' | 'expansion' | 'peak' | 'recession';
export interface Economy {
  phase: Phase; phaseAge: number;
  rate: number; rateSmooth: number; inflation: number; empIdx: number; confidence: number; popGrowth: number;
  costIdx: number;
  rentIdx: Record<PType, number>;
  cityVac: Record<PType, number>;
  hadCrunch: boolean; crunchMonthsLeft: number; tariffMonthsLeft: number; ecomMonthsLeft: number;
  insSpikeMonthsLeft?: number; capInflowMonthsLeft?: number; wfhMonthsLeft?: number;
  constrCycle?: number;
}

export interface Loan {
  id: number; kind: 'acq' | 'constr' | 'refi';
  balance: number; ratePct: number; amortYears: number;
  ioMonthsLeft: number;          // interest-only period remaining
  monthlyPmt: number;            // amortizing payment (used once IO ends)
  maturityMonth: number;         // balloon
}

export interface Facility {
  id: number; assetIds: number[]; balance: number; ratePct: number; amortYears: number;
  monthlyPmt: number; maturityMonth: number;
}

export type Credit = 0 | 1 | 2; // C, B, A
export const CREDIT_LABEL = ['C', 'B', 'A'];

export interface Tenant {
  id: number; name: string; sf: number; rate: number; // $/SF/yr
  startM: number; endM: number; credit: Credit;
}

export interface LOI {
  id: number; assetId: number; kind: 'loi' | 'rfp' | 'renewal';
  tenantId?: number;
  tenant: string; credit: Credit; sf: number;
  rate?: number; termY?: number;         // their proposal (loi) — absent for rfp
  expiresM: number;
  stage: 'open' | 'countered';           // countered = they already countered your counter (final)
  counterRate?: number; counterTermY?: number;
}

export type Quality = 0 | 1 | 2;
export const QLABEL = ['C', 'B', 'A'];

export interface CFEntry { m: number; amt: number; }
export interface ConstrEvent { month: number; kind: string; resolved: boolean; }
export interface Project {
  stage: 'permitting' | 'building';
  monthsLeft: number; totalMonths: number;
  hardBudget: number; softBudget: number; spent: number;
  contingency: number; contingencyLeft: number;
  contractor: 'budget' | 'standard' | 'premium';
  expedited: boolean;
  events: ConstrEvent[]; drawnSoFar: number; monthsBuilt: number;
}

export interface SaleOffer {
  id: number; assetId: number; amount: number; buyer: string;
  ceiling: number; // hidden: their true max
  expiresM: number; countered?: boolean;
}

export interface JV {
  lpPct: number;        // LP share of equity (and of cash flow)
  lpContrib: number;    // capital they wired at closing
  accPref: number;      // accrued, unpaid 8% preferred return
  since: number;
}

export interface Asset {
  id: number; name: string; tileI: number; type: PType;
  px?: number; py?: number; pw?: number; ph?: number; cells?: number[];
  forSale?: { ask: number; sinceM: number; listingId: number };
  jv?: JV;
  deprBasis?: number;   // depreciable improvements (land doesn't depreciate)
  deprTaken?: number;   // accumulated depreciation — recaptured at sale
  taxBumpYr?: number;
  sf: number; acres: number; units: number; construction: string;
  quality: number; qCap: number; age: number;
  mode: 'construction' | 'leaseup' | 'operating';
  tenants: Tenant[];
  occ: number; // derived cache: leased SF / sf
  rentStance: number; maint: 'low' | 'std' | 'high';
  loans: Loan[];
  ledger: CFEntry[]; cumCF: number;
  basis: number; acqMonth: number;
  entryNOI: number; entryCap: number;
  project?: Project; renovMonthsLeft?: number;
  negCFStreak: number;
}

export interface Listing {
  id: number; tileI: number;
  kind: 'land' | 'building' | 'offmarket';
  price: number;               // ask (land/building) or agreed price; offmarket may have 0 = no ask
  expiresMonth: number; hot: boolean;
  // land
  acres?: number;
  // building / offmarket
  type?: PType; sf?: number; units?: number; construction?: string; occ?: number; quality?: number; age?: number;
  tenants?: Tenant[];          // in-place rent roll (revealed by feasibility)
  distressed?: boolean; feasDone?: boolean;
  stockId?: number;
  // negotiation (all building listings have a hidden reservation)
  reservation?: number; offersLeft?: number; counterAt?: number; agreed?: boolean; noAsk?: boolean;
  resFrac?: number; listMonth?: number; declinedYou?: boolean; parentAssetId?: number; yourSale?: boolean;
  parcel?: Parcel; parcelCells?: number[]; fromLandId?: number;
}

export interface Firm { name: string; short: string; style: 'core' | 'aggressive' | 'industrial' | 'value-add' | 'mf'; netWorth: number; alive: boolean; }
export interface NewsItem { m: number; kind: 'info' | 'rumor' | 'event' | 'deal' | 'warn' | 'success'; text: string; tileI?: number; }
export interface ActiveEffect { kind: string; monthsLeft: number; tiles: number[]; dPerMonth?: number; empPerMonth?: number; }
export interface PendingDecision { type: 'constrEvent' | 'assetEvent'; assetId: number; eventKind: string; payload?: number; }
export interface PostMortem {
  assetName: string; profit: number; irr: number | null;
  parts: { label: string; amt: number; note: string }[];
  lesson: string;
}

export const PARCEL_AC = 0.25;   // quarter-acre lots
export const PGRID = 4;          // 4x4 parcels per block = 4 acres
export interface Parcel { px: number; py: number; pw: number; ph: number }

export interface LandHolding {
  id: number; tileI: number; cells: number[];
  basis: number; acquiredM: number;
}
export interface Migration { m: number; tenant: string; fromTileI: number; toTileI: number; sf: number }

export interface StockBuilding {
  id: number; tileI: number; type: PType; sf: number; units: number;
  px?: number; py?: number; pw?: number; ph?: number; cells?: number[];
  buildLeft?: number; buildTotal?: number; builder?: string;   // visible construction pipeline
  quality: number; age: number; construction: string; occ: number;
  owner: string;            // 'private' or a firm's short code
  listedId?: number;        // currently on the market as this listing
  blacklist?: boolean;      // owner no longer takes your calls
  approachedM?: number;     // last time you knocked (24-month memory)
}

export interface Comp {
  m: number; type: PType; sf: number; price: number; capPct: number | null; tileI: number; buyer: string;
}

export interface GameState {
  seed: number; rngCursor: number;
  month: number;
  tiles: Tile[];
  stock: StockBuilding[];
  econ: Economy;
  cash: number; reputation: number; tier: number;
  assets: Asset[]; listings: Listing[]; lois: LOI[]; facilities: Facility[]; saleOffers: SaleOffer[];
  comps: Comp[]; autoLease: boolean; prefer1031: boolean;
  land: LandHolding[]; migrations: Migration[];
  sandbox?: boolean;
  taxYr: { noi: number; interest: number; depr: number };
  nolCarry: number;         // net operating losses carried forward
  exchange?: { deferred: number; mustSpend: number; deadlineM: number; fromName: string }; // live 1031 clock
  jvLockedUntil?: number;   // burned a partner? capital has a memory
  firms: Firm[]; news: NewsItem[]; effects: ActiveEffect[];
  scheduledEvents: { m: number; kind: string; payload?: number }[];
  nwHistory: { m: number; nw: number; cash: number; cf: number }[];
  econHistory: { m: number; rate: number; infl: number; emp: number; conf: number; phase: Phase; ri: Record<PType, number>; ci?: number; occSF?: Record<PType, number>; totSF?: Record<PType, number>; pop?: number }[];
  nextId: number;
  pending: PendingDecision[];
  lastMonthCF: number; negCashStreak: number;
  lastScoutMonth: number; approachesLeft: number;
  gameOver: boolean; gameOverReason?: string; forcedSaleNotice?: string;
  transitCorridor: number[];
  roads: RoadNet;
  totalRealizedProfit: number; dealsClosed: number;
  version: number;
}

// ---------- helpers ----------
export function qGrade(q: number): Quality { return q >= 72 ? 2 : q >= 42 ? 1 : 0; }
export function roundPrice(n: number): number { return Math.max(1000, Math.round(n / 1000) * 1000); }
export function constrCostIdx(state: GameState): number { return state.econ.costIdx * (state.econ.constrCycle ?? 1); }
export function fmtMoney(n: number, compact = true): string {
  const neg = n < 0; const a = Math.abs(n);
  let s: string;
  if (!compact || a < 10e6) s = '$' + Math.round(a).toLocaleString('en-US');
  else if (a >= 1e9) s = '$' + (a / 1e9).toFixed(2) + 'B';
  else s = '$' + (a / 1e6).toFixed(2) + 'M';
  return neg ? '−' + s : s;
}
export function monthName(m: number): string {
  const d = new Date(2026, m, 1);
  return d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
}
function dist(ax: number, ay: number, bx: number, by: number) { return Math.hypot(ax - bx, ay - by); }
function gauss(d: number, r: number) { return Math.exp(-(d * d) / (2 * r * r)); }
function clamp(v: number, a: number, b: number) { return Math.max(a, Math.min(b, v)); }
export function leasedSF(a: Pick<Asset, 'tenants'>): number { return a.tenants.reduce((s, t) => s + t.sf, 0); }
export function recalcOcc(a: Asset) { if (isAggregate(a.type)) return; a.occ = a.sf > 0 ? clamp(leasedSF(a) / a.sf, 0, 1) : 0; }
export function primeRate(state: GameState): number { return state.econ.rate + CONFIG.primeSpread; }
export function constrSpec(a: Pick<Asset, 'type' | 'construction'>): ConstrSpec {
  return CONSTR[a.type].find(c => c.id === a.construction) ?? CONSTR[a.type][0];
}

// ---------- City generation (unchanged from v1) ----------
function smoothNoise(r: () => number, w: number, h: number): number[] {
  const raw = Array.from({ length: w * h }, () => r());
  const out = new Array(w * h).fill(0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, c = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < w && ny >= 0 && ny < h) { s += raw[ny * w + nx]; c++; }
    }
    out[y * w + x] = s / c;
  }
  return out;
}

// Every city gets its own street network. Arterials jog, locals get pruned into
// superblocks and dead ends, the river is crossed only where someone built a bridge,
// and the rail line runs the industrial band with a spur to the port.
function generateRoads(r: () => number, riverCol: number[], CBD: { x: number; y: number }, UPT: { x: number; y: number }): RoadNet {
  const W = CONFIG.GRID_W, H = CONFIG.GRID_H;
  const hz: number[][] = Array.from({ length: H + 1 }, () => new Array(W).fill(1));
  const vt: number[][] = Array.from({ length: H }, () => new Array(W + 1).fill(1));
  const isWater = (x: number, y: number) => x >= 0 && x < W && y >= 0 && y < H && x === riverCol[y];

  // Superblocks and dead ends: the grid frays, more at the edges of town.
  for (let y = 1; y < H; y++) for (let x = 0; x < W; x++) if (r() < 0.16) hz[y][x] = 0;
  for (let y = 0; y < H; y++) for (let x = 1; x < W; x++) if (r() < 0.16) vt[y][x] = 0;
  for (let x = 0; x < W; x++) { if (r() < 0.55) hz[0][x] = 0; if (r() < 0.55) hz[H][x] = 0; }
  for (let y = 0; y < H; y++) { if (r() < 0.55) vt[y][0] = 0; if (r() < 0.55) vt[y][W] = 0; }

  // E-W arterial through the CBD, with staircase jogs.
  let ay = clamp(CBD.y + (r() < 0.5 ? 0 : 1), 1, H - 1);
  for (let x = 0; x < W; x++) {
    hz[ay][x] = Math.max(hz[ay][x], 3);
    if (x > 1 && x < W - 2 && r() < 0.16) {
      const ny = clamp(ay + (r() < 0.5 ? -1 : 1), 1, H - 1);
      if (ny !== ay) { vt[Math.min(ay, ny)][x + 1] = Math.max(vt[Math.min(ay, ny)][x + 1], 3); ay = ny; }
    }
  }
  // N-S arterial through the CBD, same treatment.
  let ax = clamp(CBD.x + (r() < 0.5 ? 0 : 1), riverCol[0] + 2, W - 1);
  for (let y = 0; y < H; y++) {
    vt[y][ax] = Math.max(vt[y][ax], 3);
    if (y > 0 && y < H - 2 && r() < 0.16) {
      const nx = clamp(ax + (r() < 0.5 ? -1 : 1), 2, W - 1);
      if (nx !== ax) { hz[y + 1][Math.min(ax, nx)] = Math.max(hz[y + 1][Math.min(ax, nx)], 3); ax = nx; }
    }
  }
  // Collectors: one through uptown, sometimes more, sometimes one on the far bank.
  const nCollV = 1 + (r() < 0.6 ? 1 : 0);
  for (let k = 0; k < nCollV; k++) {
    const cx = k === 0 ? clamp(UPT.x, 1, W - 1) : 1 + Math.floor(r() * (W - 1));
    for (let y = 0; y < H; y++) vt[y][cx] = Math.max(vt[y][cx], 2);
  }
  const nCollH = 1 + (r() < 0.5 ? 1 : 0);
  for (let k = 0; k < nCollH; k++) {
    const cy2 = 1 + Math.floor(r() * (H - 1));
    for (let x = 0; x < W; x++) hz[cy2][x] = Math.max(hz[cy2][x], 2);
  }
  // A staircase boulevard from a corner toward the CBD, some cities only.
  if (r() < 0.45) {
    let px = r() < 0.5 ? 1 : W - 2, py = r() < 0.5 ? 1 : H - 2, guard = 0;
    while ((px !== CBD.x || py !== CBD.y) && guard++ < 40) {
      if (Math.abs(CBD.x - px) >= Math.abs(CBD.y - py)) {
        const d = CBD.x > px ? 1 : -1;
        hz[clamp(py, 1, H - 1)][Math.min(px, px + d)] = Math.max(hz[clamp(py, 1, H - 1)][Math.min(px, px + d)], 2);
        px += d;
      } else {
        const d = CBD.y > py ? 1 : -1;
        vt[Math.min(py, py + d)][clamp(px, 1, W - 1)] = Math.max(vt[Math.min(py, py + d)][clamp(px, 1, W - 1)], 2);
        py += d;
      }
    }
  }
  // Highway: some cities have one skirting an edge. Not all.
  if (r() < 0.5) {
    const side = Math.floor(r() * 3);
    if (side === 0) for (let x = 0; x < W; x++) hz[0][x] = 4;
    else if (side === 1) for (let y = 0; y < H; y++) vt[y][0] = 4;
    else for (let y = 0; y < H; y++) vt[y][W] = 4;
  }
  // Rail through the industrial band, spur down to the port.
  for (let x = 0; x < W; x++) hz[H - 1][x] = 5;
  const spurX = clamp(riverCol[H - 1] + (riverCol[H - 1] < W / 2 ? 1 : -1), 1, W - 1);
  for (let y = H - 2; y < H; y++) vt[y][spurX] = 5;

  // The river severs the grid. Arterials keep their bridge; add one or two humbler ones.
  for (let y = 0; y <= H; y++) for (let x = 0; x < W; x++) {
    const overWater = (y > 0 && isWater(x, y - 1)) || (y < H && isWater(x, y));
    if (overWater && hz[y][x] > 0 && hz[y][x] < 3) hz[y][x] = 0;
  }
  const extraBridges = 1 + (r() < 0.5 ? 1 : 0);
  for (let k = 0; k < extraBridges; k++) {
    const yb = 1 + Math.floor(r() * (H - 1));
    const wx = riverCol[yb];
    const cls = 1 + (r() < 0.4 ? 1 : 0);
    hz[yb][wx] = Math.max(hz[yb][wx], cls);
    if (wx > 0) hz[yb][wx - 1] = Math.max(hz[yb][wx - 1], cls);
    if (wx < W - 1) hz[yb][wx + 1] = Math.max(hz[yb][wx + 1], cls);
  }
  // No block ends up landlocked: everyone gets at least a local street.
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (isWater(x, y)) continue;
    if (hz[y][x] || hz[y + 1][x] || vt[y][x] || vt[y][x + 1]) continue;
    if (!isWater(x, y + 1)) hz[y + 1][x] = 1;
    else if (!isWater(x, y - 1)) hz[y][x] = 1;
    else vt[y][x + 1] = 1;
  }
  return { hz, vt };
}

// New Amsterdam's grid: tight avenues down the island, crosstown streets, a Broadway
// slicing diagonally, bridges off both shores, a shoreline expressway, freight rail on
// the south bank. Water severs everything else.
function generateIslandRoads(r: () => number, isWater: (x: number, y: number) => boolean, CBD: { x: number; y: number }, UPT: { x: number; y: number }): RoadNet {
  const W = CONFIG.GRID_W, H = CONFIG.GRID_H;
  const hz: number[][] = Array.from({ length: H + 1 }, () => new Array(W).fill(1));
  const vt: number[][] = Array.from({ length: H }, () => new Array(W + 1).fill(1));
  // dense grid — prune only lightly
  for (let y = 1; y < H; y++) for (let x = 0; x < W; x++) if (r() < 0.06) hz[y][x] = 0;
  for (let y = 0; y < H; y++) for (let x = 1; x < W; x++) if (r() < 0.06) vt[y][x] = 0;
  // avenues: arterials through both cores, collectors between
  for (let y = 0; y < H; y++) {
    vt[y][CBD.x] = Math.max(vt[y][CBD.x], 3);
    vt[y][UPT.x] = Math.max(vt[y][UPT.x], 3);
    vt[y][Math.floor((CBD.x + UPT.x) / 2)] = Math.max(vt[y][Math.floor((CBD.x + UPT.x) / 2)], 2);
  }
  // crosstown arterial mid-island + a second collector
  const mid = Math.floor(H / 2);
  for (let x = 0; x < W; x++) hz[mid][x] = Math.max(hz[mid][x], 3);
  const c2 = mid + (r() < 0.5 ? -2 : 2);
  for (let x = 0; x < W; x++) hz[Math.max(1, Math.min(H - 1, c2))][x] = Math.max(hz[Math.max(1, Math.min(H - 1, c2))][x], 2);
  // Broadway: a staircase avenue from the west end toward uptown
  let px = 1, py = 2, guard = 0;
  while ((px !== UPT.x || py !== UPT.y) && guard++ < 50) {
    if (Math.abs(UPT.x - px) >= Math.abs(UPT.y - py)) {
      const d = UPT.x > px ? 1 : -1;
      hz[Math.max(1, Math.min(H - 1, py))][Math.min(px, px + d)] = Math.max(hz[Math.max(1, Math.min(H - 1, py))][Math.min(px, px + d)], 2);
      px += d;
    } else {
      const d = UPT.y > py ? 1 : -1;
      vt[Math.min(py, py + d)][Math.max(1, Math.min(W - 1, px))] = Math.max(vt[Math.min(py, py + d)][Math.max(1, Math.min(W - 1, px))], 2);
      py += d;
    }
  }
  // shoreline expressway along the north bank
  for (let x = 0; x < W; x++) hz[1][x] = 4;
  // freight rail on the south shore + port spur
  for (let x = 0; x < W; x++) hz[H - 1][x] = 5;
  vt[H - 2][2] = 5;
  // water severs the grid — except the bridges
  const bridgeXs = [2 + Math.floor(r() * 2), 6 + Math.floor(r() * 2), 10 + Math.floor(r() * 2)];
  for (let y = 0; y <= H; y++) for (let x = 0; x < W; x++) {
    const aW = y > 0 && isWater(x, y - 1), bW = y < H && isWater(x, y);
    if (aW && bW && hz[y][x] > 0 && hz[y][x] !== 4) hz[y][x] = 0;   // open water (expressway rides the shore)
  }
  for (let y = 0; y < H; y++) for (let x = 0; x <= W; x++) {
    const lW = x > 0 && isWater(x - 1, y), rW = x < W && isWater(x, y);
    if (lW && rW && vt[y][x] > 0 && vt[y][x] !== 5) vt[y][x] = 0;
    else if ((lW || rW) && isWater(x, y) && vt[y][x] > 0 && vt[y][x] < 3 && !bridgeXs.includes(x)) vt[y][x] = 0;
  }
  for (const bx of bridgeXs) { vt[0][bx] = Math.max(vt[0][bx], 3); vt[H - 1][bx] = Math.max(vt[H - 1][bx], 3); }
  // nobody landlocked
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (isWater(x, y)) continue;
    if (hz[y][x] || hz[y + 1][x] || vt[y][x] || vt[y][x + 1]) continue;
    hz[y + 1][x] = 1;
  }
  return { hz, vt };
}

function computeAccess(tiles: Tile[], roads: RoadNet) {
  const W = CONFIG.GRID_W, H = CONFIG.GRID_H;
  const hwyPts: [number, number][] = [], railPts: [number, number][] = [];
  for (let y = 0; y <= H; y++) for (let x = 0; x < W; x++) {
    if (roads.hz[y][x] === 4) hwyPts.push([x, y - 0.5]);
    if (roads.hz[y][x] === 5) railPts.push([x, y - 0.5]);
  }
  for (let y = 0; y < H; y++) for (let x = 0; x <= W; x++) {
    if (roads.vt[y][x] === 4) hwyPts.push([x - 0.5, y]);
    if (roads.vt[y][x] === 5) railPts.push([x - 0.5, y]);
  }
  const rnd = (v: number) => Math.round(v * 100) / 100;
  for (const t of tiles) {
    if (t.water) { t.acc = { art: 0, hwy: 0, rail: 0, quiet: 0 }; continue; }
    const e = [roads.hz[t.y][t.x], roads.hz[t.y + 1][t.x], roads.vt[t.y][t.x], roads.vt[t.y][t.x + 1]]
      .filter(c => c !== 4 && c !== 5);
    const m = e.length ? Math.max(...e) : 0;
    const art = m === 3 ? 1 : m === 2 ? 0.55 : 0;
    const dh = hwyPts.length ? Math.min(...hwyPts.map(p => dist(t.x, t.y, p[0], p[1]))) : 99;
    const dr = railPts.length ? Math.min(...railPts.map(p => dist(t.x, t.y, p[0], p[1]))) : 99;
    const hwy = gauss(dh, 2.0), rail = gauss(dr, 1.6);
    t.acc = { art: rnd(art), hwy: rnd(hwy), rail: rnd(rail), quiet: rnd(clamp(1 - art * 0.6 - hwy * 0.85, 0, 1)) };
  }
}

export type CityKind = 'meridian' | 'island';
export function generateCity(seed: number, city: CityKind = 'meridian'): { tiles: Tile[]; corridor: number[]; roads: RoadNet } {
  const r = mulberry32(seed);
  const W = CONFIG.GRID_W, H = CONFIG.GRID_H;
  const noise = smoothNoise(r, W, H);
  const noise2 = smoothNoise(r, W, H);
  const riverCol: number[] = [];
  let rc = 3;
  for (let y = 0; y < H; y++) { riverCol.push(rc); if (r() < 0.4) rc += r() < 0.5 ? -1 : 1; rc = clamp(rc, 2, 4); }
  // island: a long city between two rivers, bays biting the shoreline, a park mid-island
  const biteT = new Set<number>(), biteB = new Set<number>();
  for (let x = 0; x < W; x++) { if (r() < 0.16) biteT.add(x); if (r() < 0.16) biteB.add(x); }
  const parkSet = new Set<number>();
  if (city === 'island') {
    const px0 = 6 + Math.floor(r() * 2), py0 = 3;
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 2; dx++) parkSet.add((py0 + dy) * W + px0 + dx);
  }
  const isWaterXY = city === 'island'
    ? (x: number, y: number) => y === 0 || y === H - 1 || (y === 1 && biteT.has(x)) || (y === H - 2 && biteB.has(x)) || parkSet.has(y * W + x)
    : (x: number, y: number) => x === riverCol[y];
  const CBD = city === 'island' ? { x: 3, y: Math.floor(H / 2) } : { x: 7, y: 4 };
  const UPT = city === 'island' ? { x: 10, y: Math.floor(H / 2) - 1 } : { x: 11, y: 2 };
  const PORT = city === 'island' ? { x: 1, y: H - 3 } : { x: riverCol[H - 1], y: H - 1 };
  const roads = city === 'island' ? generateIslandRoads(r, isWaterXY, CBD, UPT) : generateRoads(r, riverCol, CBD, UPT);
  const tiles: Tile[] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const water = isWaterXY(x, y);
    const dC = dist(x, y, CBD.x, CBD.y), dU = dist(x, y, UPT.x, UPT.y);
    const riverAdj = !water && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => isWaterXY(x + dx, y + dy));
    const railBand = y >= H - 2 ? 1 : y === H - 3 ? 0.4 : 0;
    let D = 18 + 58 * gauss(dC, 4.2) + 34 * gauss(dU, 2.6) + (riverAdj ? 10 : 0) - 16 * railBand + (noise[i] - 0.5) * 26;
    D = clamp(D, 8, 96);
    const income = clamp(0.55 + (D / 100) * 0.95 + (noise2[i] - 0.5) * 0.2, 0.5, 1.7);
    const emp = clamp(10 + 62 * gauss(dC, 3.4) + 24 * gauss(dU, 2.2) + (noise[i] - 0.5) * 18, 4, 100);
    const pop = clamp(28 + 42 * gauss(dC, 6.5) - 20 * railBand + (noise2[i] - 0.5) * 30, 5, 100);
    const dPort = dist(x, y, PORT.x, PORT.y);
    const indSuit = clamp(16 + 58 * railBand + 30 * gauss(dPort, 3.2) - D * 0.25 + (noise[i] - 0.5) * 20, 3, 100);
    const crime = clamp(68 - 0.58 * D + (noise2[i] - 0.5) * 24, 4, 85);
    tiles.push({ i, x, y, water, park: parkSet.has(i) || undefined, D, baseD: D, income, emp, pop, indSuit, crime, popBase: pop, empBase: emp, supply: { office: 0, retail: 0, industrial: 0, mixed: 0, multifamily: 0 }, acc: { art: 0, hwy: 0, rail: 0, quiet: 0 } });
  }
  computeAccess(tiles, roads);
  // Streets shape the terrain: frontage lifts a block, a highway next door drags on it
  // (unless you're a warehouse — then it's the whole point), rail feeds the industrial band.
  for (const t of tiles) {
    if (t.water) continue;
    let parkBonus = 0;
    if (parkSet.size) {
      let dP = 99;
      for (const pi of parkSet) dP = Math.min(dP, dist(t.x, t.y, pi % W, Math.floor(pi / W)));
      parkBonus = 9 * gauss(dP, 1.7);
    }
    t.D = clamp(t.D + 5.5 * t.acc.art + parkBonus + (t.indSuit > 55 ? 0 : -4.5 * t.acc.hwy), 8, 96);
    t.baseD = t.D;
    t.indSuit = clamp(t.indSuit + 24 * t.acc.hwy + 18 * t.acc.rail, 3, 100);
    t.income = clamp(0.55 + (t.D / 100) * 0.95 + (noise2[t.i] - 0.5) * 0.2, 0.5, 1.7);
  }
  for (const t of tiles) {
    if (t.water) continue;
    t.supply.office = Math.round(t.emp * 3000 * (0.7 + r() * 0.6));
    t.supply.retail = Math.round(t.pop * t.income * 2200 * (0.7 + r() * 0.6));
    t.supply.industrial = Math.round(t.indSuit * 3800 * (0.7 + r() * 0.6));
    t.supply.mixed = Math.round((t.emp + t.pop) * 700 * (0.7 + r() * 0.6));
    t.supply.multifamily = Math.round(t.pop * (0.6 + 0.4 * t.income) * 2100 * (0.7 + r() * 0.6));
  }
  const corridor: number[] = [];
  const tx = city === 'island' ? W - 2 : (r() < 0.5 ? 1 : W - 2);
  const ty = city === 'island' ? UPT.y : (r() < 0.5 ? H - 2 : 1);
  for (let s2 = 0; s2 <= 6; s2++) {
    const cx = Math.round(CBD.x + (tx - CBD.x) * (s2 / 6));
    const cy = Math.round(CBD.y + (ty - CBD.y) * (s2 / 6));
    const idx = cy * W + cx;
    if (!tiles[idx].water) corridor.push(idx);
  }
  return { tiles, corridor, roads };
}

// ---------- Market math ----------
export function tileDemandFactor(state: GameState, t: Tile, type: PType): number {
  const e = state.econ;
  const acc = t.acc ?? { art: 0, hwy: 0, rail: 0, quiet: 0 };
  let f = 1;
  if (type === 'office') f = 0.45 + 1.15 * (t.emp / 100) * (e.empIdx / 100);
  if (type === 'retail') f = (0.40 + 1.15 * (t.pop / 100) * t.income * (0.6 + 0.008 * e.confidence)) * (0.92 + 0.18 * acc.art);
  if (type === 'industrial') f = (0.55 + 0.95 * (t.indSuit / 100) * (e.ecomMonthsLeft > 0 ? 1.15 : 1)) * (0.88 + 0.30 * Math.max(acc.hwy, acc.rail));
  if (type === 'mixed') f = 0.40 + 0.65 * (t.emp / 100) + 0.55 * (t.pop / 100) * t.income;
  if (type === 'multifamily') f = (0.45 + 1.05 * (t.pop / 100) * (0.5 + 0.5 * t.income)) * (0.94 + 0.12 * acc.quiet);
  if (type === 'retail' && e.ecomMonthsLeft > 0) f *= 0.85;
  if (type === 'office' && (e.wfhMonthsLeft ?? 0) > 0) f *= 0.85;
  return clamp(f, 0.35, 1.8);
}

export function marketRentPSF(state: GameState, t: Tile, type: PType): number {
  const acc = t.acc ?? { art: 0, hwy: 0, rail: 0, quiet: 0 };
  let mult = 1;
  if (type === 'office') mult = 0.5 + 0.62 * (t.emp / 100) + 0.45 * (t.D / 100) + 0.06 * acc.art;
  if (type === 'retail') mult = 0.45 + 0.72 * t.income * (t.pop / 100) + 0.35 * (t.D / 100) + 0.20 * acc.art;
  if (type === 'industrial') mult = 0.78 + 0.42 * (t.indSuit / 100) + 0.10 * Math.max(acc.hwy, acc.rail);
  if (type === 'mixed') mult = 0.45 + 0.55 * (t.D / 100) + 0.30 * t.income + 0.10 * acc.art;
  if (type === 'multifamily') mult = 0.48 + 0.55 * (t.D / 100) + 0.32 * t.income + 0.07 * acc.quiet - 0.08 * acc.hwy;
  return CONFIG.baseRent[type] * mult * state.econ.rentIdx[type];
}

// units: more (smaller) units → marginally higher rent PSF, more management cost
export function unitRentPremium(units: number): number {
  return 1 + Math.min(0.15, 0.045 * Math.log2(Math.max(1, units)));
}
export function unitMgmtLoad(units: number): number { // extra opex as share of potential rent
  return Math.min(0.04, 0.007 * Math.log2(Math.max(1, units)));
}
// market rent for THIS building (grade + unit mix + pad bonus)
export function assetRentPSF(state: GameState, a: Pick<Asset, 'tileI' | 'type' | 'quality' | 'units' | 'construction'>): number {
  const t = state.tiles[a.tileI];
  const spec = constrSpec(a as any);
  return marketRentPSF(state, t, a.type)
    * (1 + (qGrade(a.quality) - 1) * 0.06)
    * unitRentPremium(a.units)
    * (1 + (spec.rentBonus ?? 0));
}

export function capRatePct(state: GameState, t: Tile, type: PType, quality: number): number {
  const inflow = (state.econ.capInflowMonthsLeft ?? 0) > 0 ? -0.35 : 0;
  const g = qGrade(quality);
  const loc = type === 'industrial' ? t.indSuit * 0.7 + t.D * 0.3 : t.D;
  let cap = CONFIG.baseCap[type]
    + (55 - loc) * 0.028
    + (state.econ.rateSmooth - 4.5) * 0.55
    + (g === 2 ? -0.4 : g === 0 ? 0.55 : 0)
    + (t.crime > 55 && type !== 'industrial' ? 0.3 : 0);
  return clamp(cap, 4.2, 11.5) + inflow;
}

export function tileCapacitySF(t: Tile, type: PType): number {
  // demand-side capacity, scaled to a 4-acre block of quarter-acre parcels
  const K = 0.13;
  if (type === 'office') return (4200 * t.emp + 20_000) * K;
  if (type === 'retail') return (3000 * t.pop * t.income + 20_000) * K;
  if (type === 'industrial') return (5200 * t.indSuit + 30_000) * K;
  if (type === 'multifamily') return (2600 * t.pop * (0.6 + 0.4 * t.income) + 20_000) * K;
  return (1000 * (t.emp + t.pop) + 20_000) * K;
}
export function oversupplyPenalty(t: Tile, type: PType): number {
  const ratio = t.supply[type] / tileCapacitySF(t, type);
  return clamp((ratio - 1) * 0.22, 0, 0.30);
}
export function targetOcc(state: GameState, t: Tile, type: PType): number {
  const df = tileDemandFactor(state, t, type);
  const base = 1 - Math.max(0.045, (state.econ.cityVac[type] / 100) * (2.0 - df));
  return clamp(base - oversupplyPenalty(t, type), 0.35, 0.93);
}

// ---------- Expenses (itemized) ----------
export interface ExpenseLine { label: string; amt: number; } // monthly $
export function expenseBreakdown(state: GameState, a: Pick<Asset, 'tileI' | 'type' | 'sf' | 'quality' | 'units' | 'construction' | 'maint' | 'tenants'>, potMonthly?: number, egiMonthly?: number): { lines: ExpenseLine[]; total: number } {
  const pot = potMonthly ?? (a.sf * assetRentPSF(state, a as any)) / 12;
  const egi = egiMonthly ?? a.tenants.reduce((s, t) => s + t.sf * t.rate, 0) / 12;
  const X = CONFIG.expense;
  const maintMult = a.maint === 'low' ? 0.55 : a.maint === 'high' ? 1.45 : 1;
  const multi = a.units > 1;
  const mf = a.type === 'multifamily';
  const nnn = a.type === 'retail' || a.type === 'industrial'; // tenants reimburse taxes/insurance/CAM
  const occShare = pot > 0 ? clamp(egi / pot, 0, 1) : 0;
  const insMult = (state.econ as any).insSpikeMonthsLeft > 0 ? 1.45 : 1;
  const ins = pot * X.insurance[a.type] * insMult;   // static: same at 0% or 100% occupancy
  const tax = pot * X.taxes[a.type] + (((a as any).taxBumpYr ?? 0) / 12);  // static: the county doesn't care about your vacancy
  const cam = multi && !mf ? pot * X.camMulti : 0;
  // industrial is truly NNN on upkeep: tenants maintain their own space; you maintain what's empty
  const maintAmt = a.type === 'industrial'
    ? pot * X.maint[a.type] * (1 - occShare) * maintMult
    : pot * X.maint[a.type] * maintMult;
  const selfManaged = a.sf < 20_000; // small buildings don't carry a management company
  const lines: ExpenseLine[] = [
    { label: a.type === 'industrial' ? 'Maintenance (vacant space only)' : 'Maintenance & repairs', amt: maintAmt },
    { label: 'Insurance', amt: ins },
    { label: 'Property taxes', amt: tax },
    { label: selfManaged ? 'Management (self-managed)' : 'Management', amt: selfManaged ? 0 : egi * X.mgmtOfEGI + pot * unitMgmtLoad(mf ? Math.min(a.units, 24) : a.units) },
  ];
  if (mf) {
    lines.push({ label: 'Landscaping & grounds', amt: pot * X.mfGrounds });
    lines.push({ label: 'Unit turnover costs', amt: egi * X.mfTurnover });
    lines.push({ label: 'Leasing & marketing', amt: egi * X.mfLeasing });
  } else if (cam > 0) {
    lines.push({ label: 'CAM', amt: cam });
  }
  if (nnn) {
    lines.push({ label: 'NNN recoveries (tenants reimburse)', amt: -occShare * (ins + tax + cam) * X.nnnSlippage });
  } else if (!mf && multi && cam > 0) {
    lines.push({ label: `CAM recovery (${Math.round(X.camRecovery * 100)}%)`, amt: -cam * X.camRecovery });
  }
  const shown = lines.filter(l => Math.abs(l.amt) > 0.5);
  const total = shown.reduce((s, l) => s + l.amt, 0);
  return { lines: shown, total };
}

// stabilized (valuation) NOI: market rents at supportable occupancy, standard maintenance
export function stabilizedNOI(state: GameState, a: Pick<Asset, 'tileI' | 'type' | 'sf' | 'quality' | 'units' | 'construction'>): number {
  const t = state.tiles[a.tileI];
  const rent = assetRentPSF(state, a as any);
  const occ = targetOcc(state, t, a.type);
  const potM = (a.sf * rent) / 12;
  const egiM = potM * occ;
  const ex = expenseBreakdown(state, { ...(a as any), maint: 'std', tenants: [] }, potM, egiM);
  return (egiM - ex.total) * 12;
}

// ---------- Percentage rent (retail) ----------
// Retail leases carry an overage clause: past a natural breakpoint (base rent ÷ 6%),
// the landlord takes 6% of gross sales. Sales come from the neighborhood — people
// nearby, their incomes, arterial frontage, the cycle's mood — times the tenant's own
// draw. Prime corners pay you twice: once in rent, again at the register. The
// multiplier derives from the tenant id, so no save-format change.
export function tenantSalesPSF(state: GameState, a: Pick<Asset, 'tileI' | 'quality'>, tn: Tenant): number {
  const t = state.tiles[a.tileI];
  const draw = 0.75 + mulberry32((state.seed ^ Math.imul(tn.id, 0x85ebca6b)) | 0)() * 0.5 + tn.credit * 0.06;
  const acc = t.acc ?? { art: 0, hwy: 0, rail: 0, quiet: 0 };
  return 330
    * (0.45 + 0.55 * (t.pop / 100))
    * (0.55 + 0.45 * t.income)
    * (0.85 + 0.30 * acc.art)
    * (0.85 + 0.30 * (state.econ.confidence / 100))
    * (state.econ.ecomMonthsLeft > 0 ? 0.84 : 1)
    * (0.92 + qGrade(a.quality) * 0.06)
    * draw;
}
export const PCT_RENT_RATE = 0.06;
const OCC_COST_NORM = 0.08; // breakpoint sits above a healthy ~9% occupancy-cost — overage means genuine outperformance
export function retailBreakpointPSF(state: GameState, tileI: number): number {
  return marketRentPSF(state, state.tiles[tileI], 'retail') / OCC_COST_NORM;
}
export function retailOverageMonthly(state: GameState, a: Pick<Asset, 'tileI' | 'type' | 'quality' | 'tenants'>): number {
  if (a.type !== 'retail') return 0;
  const bp = retailBreakpointPSF(state, a.tileI);
  let m = 0;
  for (const tn of a.tenants) {
    const sales = tenantSalesPSF(state, a, tn);
    if (sales > bp) m += tn.sf * PCT_RENT_RATE * (sales - bp) / 12;
  }
  return m;
}

export function assetEGIMonthly(state: GameState, a: Pick<Asset, 'tileI' | 'type' | 'sf' | 'quality' | 'units' | 'construction' | 'tenants' | 'occ'>): number {
  if (isAggregate(a.type)) return (a.sf * assetRentPSF(state, a as any) * (a.occ ?? 0)) / 12;
  return a.tenants.reduce((s, t) => s + t.sf * t.rate, 0) / 12 + retailOverageMonthly(state, a);
}
export function assetNOIMonthly(state: GameState, a: Asset): number {
  const potM = (a.sf * assetRentPSF(state, a)) / 12;
  const egiM = assetEGIMonthly(state, a);
  const ex = expenseBreakdown(state, a, potM, egiM);
  return egiM - ex.total;
}

export function assetValue(state: GameState, a: Asset): number {
  if (a.mode === 'construction') {
    const p = a.project!;
    return a.basis * 0.55 + p.spent * 0.85;
  }
  const t = state.tiles[a.tileI];
  const noi = stabilizedNOI(state, a);
  const cap = capRatePct(state, t, a.type, a.quality) / 100;
  const stabDiscount = a.mode === 'leaseup' ? clamp(0.75 + 0.25 * (a.occ / 0.85), 0.75, 1) : 1;
  return Math.max(0, (noi / cap) * stabDiscount);
}

// ---------- Debt math ----------
export function monthlyPayment(principal: number, ratePct: number, years: number): number {
  const r = ratePct / 100 / 12, n = years * 12;
  if (r <= 0) return principal / n;
  return (principal * r) / (1 - Math.pow(1 + r, -n));
}
export function loanMonthlyDS(l: Loan): number {
  return l.ioMonthsLeft > 0 ? l.balance * (l.ratePct / 100 / 12) : l.monthlyPmt;
}
export function facilityShare(state: GameState, a: Asset): number {
  let share = 0;
  for (const f of state.facilities) {
    if (!f.assetIds.includes(a.id)) continue;
    const vals = f.assetIds.map(id => { const x = state.assets.find(y => y.id === id); return x ? assetValue(state, x) : 0; });
    const tot = vals.reduce((s, v) => s + v, 0);
    const mine = (() => { const x = state.assets.find(y => y.id === a.id); return x ? assetValue(state, x) : 0; })();
    if (tot > 0) share += f.balance * (mine / tot);
  }
  return share;
}
export function assetDebt(a: Asset): number { return a.loans.reduce((s, l) => s + l.balance, 0); }
export function assetTotalDebt(state: GameState, a: Asset): number { return assetDebt(a) + facilityShare(state, a); }
export function assetDebtService(a: Asset): number { return a.loans.reduce((s, l) => s + loanMonthlyDS(l), 0); }
export function totalFacilityDS(state: GameState): number { return state.facilities.reduce((s, f) => s + f.monthlyPmt, 0); }
export function lpClaim(state: GameState, a: Asset): number {
  if (!a.jv) return 0;
  const eq = Math.max(0, assetValue(state, a) - assetDebt(a));
  const owed = a.jv.lpContrib + a.jv.accPref;
  const base = Math.min(eq, owed);
  const residual = Math.max(0, eq - base);
  return Math.round(base + residual * a.jv.lpPct * 0.80); // net of your promote
}
export function netWorth(state: GameState): number {
  return state.cash
    + state.assets.reduce((s, a) => s + assetValue(state, a) - assetDebt(a) - lpClaim(state, a), 0)
    + state.land.reduce((s, h) => s + landValue(state, h), 0)
    - state.facilities.reduce((s, f) => s + f.balance, 0);
}
// what's coming: competing SF that will be finished and hunting your tenants
export function pipelineSF(state: GameState, type?: PType): number {
  let sf = 0;
  for (const b of state.stock) if (b.buildLeft && (!type || b.type === type)) sf += b.sf;
  for (const a of state.assets) if (a.mode === 'construction' && (!type || a.type === type)) sf += a.sf;
  return sf;
}
export function portfolioDSCR(state: GameState): number | null {
  let noi = 0, ds = totalFacilityDS(state);
  for (const a of state.assets) {
    if (a.mode === 'construction') continue;
    noi += assetNOIMonthly(state, a); ds += assetDebtService(a);
  }
  if (ds < 1) return null;
  return noi / ds;
}

export function assetIRR(state: GameState, a: Asset, includeTerminal = true): number | null {
  const flows = [...a.ledger];
  if (includeTerminal && a.mode !== 'construction') {
    const term = assetValue(state, a) * (1 - CONFIG.saleCostPct) - assetTotalDebt(state, a);
    flows.push({ m: state.month, amt: term });
  }
  return irrFromFlows(flows);
}
export function irrFromFlows(flows: CFEntry[]): number | null {
  if (flows.length < 2) return null;
  const hasNeg = flows.some(f => f.amt < 0), hasPos = flows.some(f => f.amt > 0);
  if (!hasNeg || !hasPos) return null;
  const t0 = Math.min(...flows.map(f => f.m));
  const npv = (rm: number) => flows.reduce((s, f) => s + f.amt / Math.pow(1 + rm, f.m - t0), 0);
  let lo = -0.06, hi = 0.08;
  let flo = npv(lo), fhi = npv(hi);
  if (flo * fhi > 0) return null;
  for (let k = 0; k < 80; k++) {
    const mid = (lo + hi) / 2, fm = npv(mid);
    if (Math.abs(fm) < 1e-4) { lo = hi = mid; break; }
    if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  const rm = (lo + hi) / 2;
  return (Math.pow(1 + rm, 12) - 1) * 100;
}

// ---------- Tenant generation ----------
const TENANT_POOLS: Record<PType, string[]> = {
  office: [
    'Halberd Legal Group', 'Corvus Analytics', 'Meridian Mutual', 'Pinnacle Staffing', 'Ashford & Bell CPAs', 'Trellis Software', 'Vector Engineering', 'Northgate Insurance', 'Quill & Coda Media', 'Summit Wealth Partners', 'Bellwether Consulting', 'Ironbridge Title Co.',
    'Redline Actuarial', 'Cobalt Systems', 'Marrow & Finch LLP', 'TrueNorth Recruiting', 'Sable Creative Agency', 'Lattice Biotech', 'Fairwater Capital', 'Osprey Architecture', 'Granite Claims Group', 'Helix Data Services', 'Portman Realty Advisors', 'Cinder Marketing Co.',
    'Aldermont Trust', 'Kite & Key Design', 'Vantage Point Surveying', 'Bluff City Accounting', 'Nova Compliance Partners', 'Wexford Engineering', 'Pillar Mortgage Group', 'Cortex Learning Labs', 'Amberline Logistics HQ', 'Drummond & Reyes Law', 'Silverbirch Wealth', 'Foundry Tech Collective',
    'Harlow Public Relations', 'Keystone Actuaries', 'Bridgeline Software', 'Monarch Title & Escrow', 'Cassia Health Admin', 'Pelham Ventures', 'Rooke Structural Design', 'Tesseract Analytics', 'Windrow Insurance Brokers', 'Calder & Voss Attorneys', 'Zephyr Media Group', 'Oakum Consulting',
    'Larkfield Payroll Services', 'Brightpath Therapy Group', 'Stonegate Appraisals', 'Vireo Environmental', 'Copperfield Holdings', 'Marlowe Talent Agency', 'Delta Ridge Engineering', 'Fenwick & Gray CPAs', 'Halcyon Travel Corporate', 'Iris Telehealth Group',
  ],
  retail: [
    'Brightside Grocers', 'Copper Kettle Coffee', 'Fleet Feet Athletics', 'Luna Nails & Spa', 'Patio Burger Co.', 'Verde Juice Bar', 'Maple & Main Boutique', 'QuickCuts Salon', 'Riverstone Pharmacy', 'Golden Wok', 'Pet Supply Depot', 'First Federal Branch',
    'Cactus Flower Tex-Mex', 'The Cheese Counter', 'Ironworks Barbershop', 'Nook Used Books', 'Pearl Dry Cleaners', 'Sundial Optometry', 'Taco Norte', 'Willow Yoga Studio', 'Big Sky Outfitters', 'Corner Slice Pizzeria', 'Duet Music Shop', 'Everbloom Florist',
    'Frostbite Creamery', 'Gilded Frame Gallery', 'Harvest Table Deli', 'Java Junction', 'Kettle & Crumb Bakery', 'Lucky Star Nails', 'Marigold Thrift', 'Noble Cuts Butcher', 'Old Town Hardware', 'Pho Saigon Kitchen', 'Quarry Climbing Shop', 'Rosewater Skincare',
    'Sagebrush Smokehouse', 'Tidewater Seafood Market', 'Umbra Tattoo Parlor', 'Velvet Hanger Consignment', 'Wagging Tails Grooming', 'Xpress Phone Repair', 'Yarn Over Crafts', 'Zia Home Goods', 'Anchor Bay Liquors', 'Biscuit & Bean Diner', 'Cascade Cellular', 'Drift Surf & Skate',
    'Ember Grill House', 'Fable Toy Company', 'Grove Street Vision', 'Hearthstone Candle Co.', 'Ivory Bridal Boutique', 'Jasper Vape & Smoke', 'Kite String Kids Wear', 'Lantern Thai Cuisine', 'Mesa Verde Cantina', 'Nectar Smoothie Bar',
  ],
  industrial: [
    'Cardinal Logistics', 'Apex Fulfillment', 'Ironline Fabrication', 'ColdChain Storage Co.', 'Meridian Beverage Dist.', 'Stateline Freight', 'ProBuild Supply', 'Vulcan Machine Works', 'Beacon 3PL', 'Harbor Container Services',
    'Anvil Metalforming', 'Blue Ox Crating', 'Crosstown Courier Hub', 'Dynamo Electrical Supply', 'Eastgate Pallet Co.', 'Foundry Plastics', 'Gravity Rigging & Crane', 'Hilltop HVAC Wholesale', 'Interstate Tire Dist.', 'Junction Box Storage',
    'Keel Marine Parts', 'Loadstar Trucking', 'Millwright Tooling', 'Northstar Aggregates', 'Overland Parcel Depot', 'Pinnacle Print Works', 'Quench Beverage Bottling', 'Ridgeline Roofing Supply', 'Steelhead Seafood Proc.', 'Timberline Cabinetry',
    'Union Gear & Axle', 'Vertex Composites', 'Wolfpack Moving & Storage', 'Yardarm Equipment Rental', 'Zenith Auto Parts DC', 'Ballast Point Warehousing', 'Cinderblock Masonry Supply', 'Dockside Cold Storage', 'Evergreen Paper Converters', 'Flatbed Freight Systems',
    'Granary Foods Processing', 'Hydra Pressure Washing Co.', 'Ingot Recycling', 'Jackrabbit Same-Day', 'Krate & Karton Packaging', 'Lodestone Magnetics', 'Monolith Concrete Products', 'Nimbus Air Cargo', 'Ore Dock Minerals', 'Pillarworks Steel Service',
  ],
  mixed: [
    'Corner Bakehouse', 'Loft & Ledger Co-Work', 'Cedar Dental', 'The Daily Grind', 'Atlas Fitness', 'Bloom Florals', 'Vantage Realty', 'Nomad Tap Room', 'Meridian Optical', 'Junction Books',
    'Alcove Wine Bar', 'Brickhouse Pilates', 'Cobbler & Sons Shoes', 'Dashwood Stationery', 'Elm Street Counseling', 'Foxglove Apothecary', 'Gallery on Fifth', 'Hearth Neighborhood Kitchen', 'Inkwell Print & Ship', 'Jubilee Event Space',
    'Kindred Coffee Roasters', 'Ledger & Vine Bistro', 'Mosaic Art Studio', 'Night Owl Ramen', 'Opal Day Spa', 'Provision Market', 'Quarter Note Music School', 'Rambler Bicycle Co.', 'Salt & Ember Steakhouse', 'Tandem Creative Studio',
    'Umbrella Insurance Shop', 'Velo Espresso', 'Wanderlust Travel Co.', 'Xanadu Games & Comics', 'Yellowbird Brunch House', 'Zinnia Gifts', 'Archer Physical Therapy', 'Birchwood Law Clinic', 'Cartographer Brewing', 'Dovetail Woodshop',
    'Ellery Tax Services', 'Fig & Farro Cafe', 'Grange Insurance Agency', 'Halfmoon Bagels', 'Isla Cocina', 'Juniper & Sage Salon', 'Kiln Pottery Studio', 'Limestone Chiropractic', 'Meadow Veterinary Clinic', 'North Fork Fly Shop',
  ],
  multifamily: ['Resident'],
};
function tenantName(state: GameState, type: PType): string { return rpick(state, TENANT_POOLS[type]); }
function rollCredit(state: GameState, quality: number, D: number): Credit {
  const p = rng(state) + qGrade(quality) * 0.16 + (D / 100) * 0.18;
  return p > 1.05 ? 2 : p > 0.62 ? 1 : 0;
}

export function suiteSF(a: Pick<Asset, 'sf' | 'units'>): number { return a.sf / Math.max(1, a.units); }

function genUnitsFor(state: GameState, type: PType, sf: number): number {
  if (type === 'multifamily') return Math.max(6, Math.round(sf / rrange(state, 750, 1100)));
  const cap = (minSF: number) => (n: number) => Math.max(1, Math.min(n, Math.floor(sf / minSF)));
  if (type === 'retail') return cap(1000)(Math.max(1, Math.round(sf / rrange(state, 1800, 4200))));
  if (type === 'office') return cap(1000)(Math.max(1, Math.round(sf / rrange(state, 3200, 7500))));
  if (type === 'industrial') return cap(2000)(sf > 40000 ? 1 + Math.floor(rng(state) * 3) : 1 + Math.floor(rng(state) * 2));
  return cap(800)(Math.max(2, Math.round(sf / rrange(state, 1500, 3500))));
}

// generate an in-place rent roll for an existing building at a given occupancy
function genRentRoll(state: GameState, a: Pick<Asset, 'tileI' | 'type' | 'sf' | 'units' | 'quality' | 'construction'>, occ: number, lo = 0.90, hi = 1.08): Tenant[] {
  if (isAggregate(a.type)) return [];
  const tenants: Tenant[] = [];
  const t = state.tiles[a.tileI];
  const mkt = assetRentPSF(state, a as any);
  let toFill = a.sf * occ;
  const su = suiteSF(a as any);
  let guard = 0;
  while (toFill > su * 0.4 && guard++ < 60) {
    const nUnits = Math.max(1, Math.min(Math.round(toFill / su), 1 + Math.floor(rng(state) * 3)));
    const sf = Math.min(toFill, Math.round(nUnits * su / 100) * 100);
    const rate = mkt * rrange(state, lo, hi);
    const termLeft = Math.round(rrange(state, 8, 84));
    const termTotal = Math.max(termLeft + Math.round(rrange(state, 0, 36)), 36);
    tenants.push({
      id: state.nextId++, name: tenantName(state, a.type), sf,
      rate: Math.round(rate * 100) / 100,
      startM: state.month - (termTotal - termLeft), endM: state.month + termLeft,
      credit: rollCredit(state, a.quality, t.D),
    });
    toFill -= sf;
  }
  return tenants;
}

// ---------- Initial state ----------
export function newGame(seed?: number, opts?: { sandbox?: boolean; city?: CityKind }): GameState {
  const s0 = seed ?? Math.floor(Math.random() * 2 ** 31);
  const { tiles, corridor, roads } = generateCity(s0, opts?.city ?? 'meridian');
  const state: GameState = {
    seed: s0, rngCursor: s0 ^ 0x1234567,
    month: 0, tiles,
    econ: {
      phase: 'recovery', phaseAge: 6,
      rate: 4.0, rateSmooth: 4.2, inflation: 2.2, empIdx: 97, confidence: 52, popGrowth: 1.1, costIdx: 1,
      rentIdx: { office: 1, retail: 1, industrial: 1, mixed: 1, multifamily: 1 },
      cityVac: { office: 13.5, retail: 9.5, industrial: 6.0, mixed: 9.0, multifamily: 7.0 },
      hadCrunch: false, crunchMonthsLeft: 0, tariffMonthsLeft: 0, ecomMonthsLeft: 0,
    },
    cash: opts?.sandbox ? 50_000_000 : CONFIG.START_CASH, reputation: opts?.sandbox ? 60 : 20, tier: opts?.sandbox ? CONFIG.tiers.length - 1 : 0,
    sandbox: opts?.sandbox || undefined,
    stock: [],
    assets: [], listings: [], lois: [], facilities: [], saleOffers: [],
    comps: [], autoLease: false, prefer1031: false,
    land: [], migrations: [],
    taxYr: { noi: 0, interest: 0, depr: 0 }, nolCarry: 0,
    firms: [
      { name: 'Sterling Capital', short: 'STR', style: 'core', netWorth: 48_000_000, alive: true },
      { name: 'Vertex Development', short: 'VTX', style: 'aggressive', netWorth: 22_000_000, alive: true },
      { name: 'Ironclad Industrial', short: 'IRN', style: 'industrial', netWorth: 31_000_000, alive: true },
      { name: 'Copperline Partners', short: 'CPL', style: 'value-add', netWorth: 14_000_000, alive: true },
      { name: 'Harborview Residential', short: 'HBV', style: 'mf', netWorth: 26_000_000, alive: true },
      { name: 'Granite Peak Holdings', short: 'GPH', style: 'core', netWorth: 38_000_000, alive: true },
      { name: 'Bluestem Development', short: 'BLU', style: 'aggressive', netWorth: 9_000_000, alive: true },
      { name: 'Foundry Row Capital', short: 'FDR', style: 'value-add', netWorth: 11_000_000, alive: true },
      { name: 'Kestrel Logistics Trust', short: 'KST', style: 'industrial', netWorth: 19_000_000, alive: true },
      { name: 'Aria Residential Group', short: 'ARG', style: 'mf', netWorth: 16_000_000, alive: true },
    ],
    news: [], effects: [], scheduledEvents: [],
    nwHistory: [], econHistory: [],
    nextId: 1, pending: [], lastMonthCF: 0, negCashStreak: 0,
    lastScoutMonth: -99, approachesLeft: 5,
    gameOver: false, transitCorridor: corridor, roads,
    totalRealizedProfit: 0, dealsClosed: 0,
    version: 10,
  };
  generateStock(state);
  // Born in equilibrium: the anchors absorb whatever the initial city explains, so
  // desirability, population and jobs only move when the built city changes from here.
  {
    const mix0 = computeMix(state);
    const src0 = demandSources(state);
    for (const t of state.tiles) {
      if (t.water) continue;
      t.baseD = clamp(t.D - mix0[t.i], 0, 98);
      t.popBase = clamp(t.pop - RES_K * src0.resSrc[t.i], 0, 100);
      t.empBase = clamp(t.emp / Math.max(0.5, state.econ.empIdx / 100) - JOB_K * src0.jobSrc[t.i], 0, 100);
    }
  }
  pushNews(state, 'info', opts?.sandbox
    ? 'SANDBOX MODE: $50,000,000 of equity, top tier unlocked, and a clean reputation. Nothing here counts — go break things.'
    : 'Welcome to Meridian City. You have $600K of equity and a bank that will listen. Buy well.');
  for (let k = 0; k < 6; k++) spawnListing(state, k < 2);
  // every career starts somewhere: guarantee at least one building a $600K player can close
  let guard = 0;
  while (!state.listings.some(l => l.kind === 'building' && l.price > 0 && l.price * 0.35 + 20_000 <= CONFIG.START_CASH) && guard++ < 6) {
    spawnListing(state, true);
    const nl = state.listings[state.listings.length - 1];
    if (nl && nl.kind === 'building' && nl.price * 0.35 + 20_000 > CONFIG.START_CASH) {
      nl.price = roundPrice(Math.min(nl.price, (CONFIG.START_CASH - 25_000) / 0.35));
      nl.resFrac = 0.97; // already priced to the bone
    }
  }
  recordHistory(state);
  return state;
}

function pushNews(state: GameState, kind: NewsItem['kind'], text: string, tileI?: number) {
  state.news.unshift({ m: state.month, kind, text, tileI });
  if (state.news.length > 80) state.news.pop();
}

// ---------- Listings ----------
function buildableTiles(state: GameState): Tile[] { return state.tiles.filter(t => !t.water); }

export function landPricePerAcre(state: GameState, t: Tile): number {
  const psfLand = (1 + Math.pow(t.D / 100, 2.2) * 55) * (t.indSuit > 55 ? 0.40 : 1);
  return psfLand * 43_560 * state.econ.costIdx;
}

// Build the entire standing inventory of Meridian City. Every building exists
// from day one with an owner; the market is just whichever slice is trading.
const STOCK_SIZE: Record<PType, [number, number]> = {
  office: [8000, 52000], retail: [4000, 20000], industrial: [12000, 52000], mixed: [6000, 32000], multifamily: [10000, 68000],
};
function generateStock(state: GameState) {
  for (const t of state.tiles) {
    for (const ty of PTYPES) t.supply[ty] = 0;
    if (t.water) continue;
    // Meridian City is mostly dirt. Development clusters near the core and thins to nothing at the edges.
    const dens = clamp(0.10 + Math.pow(t.D / 100, 1.9) * 0.62 + (t.indSuit > 62 ? 0.10 : 0), 0.06, 0.62);
    const budget = Math.round(dens * PGRID * PGRID); // parcels to fill on this block
    // each use competes for land in proportion to the acreage its demand implies
    const weights: [PType, number][] = PTYPES.map(ty => [ty, tileCapacitySF(t, ty) / (FAR[ty] * 43_560 * PARCEL_AC)] as [PType, number]);
    let used = 0, guard = 0;
    while (used < budget && guard++ < 12) {
      const tot = weights.reduce((s2, w) => s2 + w[1], 0);
      let pick = rng(state) * tot; let ty: PType = 'retail';
      for (const [tt, w] of weights) { pick -= w; if (pick <= 0) { ty = tt; break; } }
      const [lo, hi] = STOCK_SIZE[ty];
      const room = Math.max(1, budget - used);
      const maxSF = room * PARCEL_AC * 43_560 * FAR[ty];
      let sf = Math.round(clamp(rrange(state, lo, hi), lo, Math.max(lo, maxSF)) / 1000) * 1000;
      if (sf > maxSF) { if (lo > maxSF) break; sf = Math.round(maxSF / 1000) * 1000; }
      const need = parcelsNeeded(sf, ty);
      const spot = findFreeRect(state, t.i, need, () => rng(state));
      if (!spot) break;
      const quality = clamp(rrange(state, 22, 78) + (t.D - 50) * 0.15, 15, 88);
      const df = tileDemandFactor(state, t, ty);
      const occ = clamp(rrange(state, 0.55, 0.97) * clamp(0.75 + df * 0.2, 0.8, 1.05), 0.25, 0.97);
      state.stock.push({
        id: state.nextId++, tileI: t.i, type: ty, sf,
        px: spot.px, py: spot.py, pw: spot.pw, ph: spot.ph,
        units: genUnitsFor(state, ty, sf),
        quality, age: Math.round(rrange(state, 4, 55)),
        construction: CONSTR[ty][Math.min(CONSTR[ty].length - 1, 2 - qGrade(quality))].id,
        occ: Math.round(occ * 100) / 100,
        owner: rng(state) < 0.28 ? pickOwnerFirm(state, ty, quality, t) : 'private',
      });
      t.supply[ty] += sf;
      used += spot.pw * spot.ph;
    }
  }
}

// institutions hold what fits their mandate — an apartment REIT doesn't own truck docks
function pickOwnerFirm(state: GameState, ty: PType, quality: number, t: Tile): string {
  const w = (f: Firm): number => {
    if (f.style === 'industrial') return ty === 'industrial' ? 8 : 0.04;
    if (f.style === 'mf') return ty === 'multifamily' ? 8 : 0.04;
    if (f.style === 'core') return (ty === 'office' || ty === 'mixed' || ty === 'retail') && quality > 55 && t.D > 50 ? 6 : 0.1;
    if (f.style === 'value-add') return quality < 48 && ty !== 'multifamily' ? 5 : 0.15;
    return 2; // aggressive buys anything
  };
  let tot = 0; for (const f of state.firms) tot += w(f);
  let pick = rng(state) * tot;
  for (const f of state.firms) { pick -= w(f); if (pick <= 0) return f.short; }
  return state.firms[0].short;
}

function logComp(s: GameState, c: Comp) {
  s.comps.push(c);
  if (s.comps.length > 60) s.comps.shift();
}

// ---------- parcels ----------
export function parcelGrid(state: GameState, tileI: number): (number | null)[] {
  const g: (number | null)[] = new Array(PGRID * PGRID).fill(null);
  const mark = (cells: number[], id: number) => { for (const c of cells) if (c >= 0 && c < PGRID * PGRID) g[c] = id; };
  for (const b of state.stock) if (b.tileI === tileI) mark(footprintCells(b), b.id);
  for (const a of state.assets) if (a.tileI === tileI) mark(footprintCells(a), a.id);
  for (const l of state.listings) if (l.tileI === tileI) mark(l.parcelCells ?? (l.parcel ? footprintCells(l.parcel) : []), -l.id);
  for (const h of state.land) if (h.tileI === tileI) mark(h.cells, 1_000_000 + h.id);
  return g;
}
export function cellsOfRect(px: number, py: number, pw: number, ph: number): number[] {
  const out: number[] = [];
  for (let y = py; y < py + ph; y++) for (let x = px; x < px + pw; x++) out.push(y * PGRID + x);
  return out;
}
export function footprintCells(o: { cells?: number[]; px?: number; py?: number; pw?: number; ph?: number }): number[] {
  if (o.cells && o.cells.length) return o.cells;
  if (o.px === undefined) return [];
  return cellsOfRect(o.px, o.py!, o.pw ?? 1, o.ph ?? 1);
}
// Edge-sharing only: two lots that meet at a single corner are not one site.
export function isContiguous(cells: number[]): boolean {
  if (cells.length <= 1) return true;
  const set = new Set(cells);
  const seen = new Set<number>([cells[0]]);
  const q = [cells[0]];
  while (q.length) {
    const c = q.pop()!;
    const cx = c % PGRID, cy = Math.floor(c / PGRID);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= PGRID || ny >= PGRID) continue;
      const n = ny * PGRID + nx;
      if (set.has(n) && !seen.has(n)) { seen.add(n); q.push(n); }
    }
  }
  return seen.size === cells.length;
}
export function connectedGroup(cells: number[], from: number): number[] {
  const set = new Set(cells);
  const seen = new Set<number>([from]);
  const q = [from];
  while (q.length) {
    const c = q.pop()!;
    const cx = c % PGRID, cy = Math.floor(c / PGRID);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= PGRID || ny >= PGRID) continue;
      const n = ny * PGRID + nx;
      if (set.has(n) && !seen.has(n)) { seen.add(n); q.push(n); }
    }
  }
  return [...seen];
}

export function parcelsNeeded(sf: number, type: PType): number {
  return Math.max(1, Math.min(PGRID * PGRID, Math.ceil(sf / (FAR[type] * 43_560) / PARCEL_AC)));
}
function fitsAt(g: (number | null)[], px: number, py: number, pw: number, ph: number): boolean {
  if (px + pw > PGRID || py + ph > PGRID) return false;
  for (let y = py; y < py + ph; y++) for (let x = px; x < px + pw; x++) if (g[y * PGRID + x] !== null) return false;
  return true;
}
export function maxRectAt(state: GameState, tileI: number, px: number, py: number): { pw: number; ph: number } {
  const g = parcelGrid(state, tileI);
  let best = { pw: 1, ph: 1 }, bestArea = 1;
  for (let ph = 1; ph <= PGRID - py; ph++) for (let pw = 1; pw <= PGRID - px; pw++) {
    if (fitsAt(g, px, py, pw, ph) && pw * ph > bestArea) { best = { pw, ph }; bestArea = pw * ph; }
  }
  return best;
}
function findFreeRect(state: GameState, tileI: number, need: number, rand: () => number): Parcel | null {
  const g = parcelGrid(state, tileI);
  const shapes: [number, number][] = [];
  for (let w = 1; w <= PGRID; w++) for (let h = 1; h <= PGRID; h++) if (w * h >= need && w * h <= need + 3) shapes.push([w, h]);
  shapes.sort((a, b) => (a[0] * a[1]) - (b[0] * b[1]) + (Math.abs(a[0] - a[1]) - Math.abs(b[0] - b[1])) * 0.5);
  for (const [pw, ph] of shapes) {
    const spots: Parcel[] = [];
    for (let py = 0; py <= PGRID - ph; py++) for (let px = 0; px <= PGRID - pw; px++) if (fitsAt(g, px, py, pw, ph)) spots.push({ px, py, pw, ph });
    if (spots.length) return spots[Math.floor(rand() * spots.length)];
  }
  return null;
}
export function freeParcelCount(state: GameState, tileI: number): number {
  return parcelGrid(state, tileI).filter(v => v === null).length;
}

export function stockOnTile(state: GameState, tileI: number): StockBuilding[] {
  return state.stock.filter(b => b.tileI === tileI);
}

// what informed buyers pay: a blend of stabilized potential and the income actually in place
function pricingValue(state: GameState, spec: { tileI: number; type: PType; sf: number; quality: number; units: number; construction: string }, tenants: Tenant[]): number {
  const t = state.tiles[spec.tileI];
  const cap = capRatePct(state, t, spec.type, spec.quality) / 100;
  const stab = stabilizedNOI(state, spec as any);
  const potM = (spec.sf * assetRentPSF(state, spec as any)) / 12;
  const egiM = isAggregate(spec.type) ? potM * ((spec as any).occ ?? 0.9) : tenants.reduce((s2, tn) => s2 + tn.sf * tn.rate, 0) / 12;
  const ex = expenseBreakdown(state, { ...spec, maint: 'std', tenants } as any, potM, egiM);
  const ip = (egiM - ex.total) * 12;
  const blendNOI = 0.45 * stab + 0.55 * Math.min(stab, Math.max(ip, 0) * 1.25);
  return Math.max(blendNOI, stab * 0.35) / cap;
}

function spawnListing(state: GameState, starter = false) {
  const t = rpick(state, buildableTiles(state));
  const id = state.nextId++;
  const isLand = rng(state) < 0.45;
  const hot = rng(state) < 0.35;
  const expiresMonth = state.month + (hot ? 3 : 6) + Math.floor(rng(state) * 3);
  if (isLand) {
    const need = 2 + Math.floor(rng(state) * 6);
    const spot = findFreeRect(state, t.i, need, () => rng(state));
    if (!spot) { state.nextId--; return; }
    const acres = Math.round(spot.pw * spot.ph * PARCEL_AC * 100) / 100;
    state.listings.push({ id, tileI: t.i, kind: 'land', acres, parcel: spot, price: parcelPrice(state, t.i, spot.pw, spot.ph), resFrac: rrange(state, 0.88, 0.97), listMonth: state.month, offersLeft: 3, expiresMonth, hot });
  } else {
    let pool = state.stock.filter(b => !b.listedId && !b.buildLeft && (starter
      ? b.sf <= 12000 && b.occ >= 0.80 && b.quality >= 40
      : true));
    if (starter && pool.length === 0) pool = state.stock.filter(b => !b.listedId && b.sf <= 16000 && b.occ >= 0.7);
    if (starter && pool.length === 0) pool = state.stock.filter(b => !b.listedId && b.sf <= 18000);
    if (pool.length === 0) { state.nextId--; return; }
    // struggling buildings come to market more often — that's who sells
    const weight = (b: StockBuilding) => 1 + (b.occ < 0.62 ? 1.6 : 0) + (b.quality < 38 ? 0.8 : 0) + (b.owner !== 'private' ? 0.4 : 0);
    let tot = 0; for (const b of pool) tot += weight(b);
    let pick = rng(state) * tot; let b = pool[0];
    for (const cand of pool) { pick -= weight(cand); if (pick <= 0) { b = cand; break; } }
    listStockBuilding(state, b, { id, starter, hot, expiresMonth });
  }
}

function listStockBuilding(state: GameState, b: StockBuilding, opt: { id?: number; starter?: boolean; hot?: boolean; expiresMonth?: number; distressed?: boolean; priceMult?: number }) {
  const id = opt.id ?? state.nextId++;
  const distressed = opt.distressed ?? (b.occ < 0.62 || (b.quality < 38 && rng(state) < 0.5));
  const probe = { tileI: b.tileI, type: b.type, sf: b.sf, quality: b.quality, units: b.units, construction: b.construction };
  const tenants = distressed
    ? genRentRoll(state, { ...probe }, b.occ, 0.82, 1.0)
    : genRentRoll(state, { ...probe }, b.occ);
  const val = pricingValue(state, { ...probe, occ: b.occ } as any, tenants);
  const mult = opt.priceMult ?? (distressed ? rrange(state, 0.72, 0.85) : rrange(state, 0.95, 1.10));
  const l: Listing = {
    id, tileI: b.tileI, kind: 'building',
    type: b.type, sf: b.sf, units: b.units, occ: b.occ, quality: b.quality, age: b.age,
    construction: b.construction, distressed,
    acres: Math.round((b.sf / FAR[b.type] / 43_560) * 100) / 100,
    tenants, stockId: b.id,
    parcel: b.px !== undefined ? { px: b.px, py: b.py!, pw: b.pw!, ph: b.ph! } : undefined,
    parcelCells: b.cells ? [...b.cells] : undefined,
    price: roundPrice(val * mult),
    resFrac: distressed ? rrange(state, 0.86, 0.95) : rrange(state, 0.90, 0.985),
    listMonth: state.month,
    offersLeft: 3,
    expiresMonth: opt.expiresMonth ?? state.month + 6, hot: opt.hot ?? false,
  };
  if (opt.starter) {
    const noiIp = inPlaceNOIYr(state, l);
    const targetCap = state.econ.rate + CONFIG.acqSpread + rrange(state, 0.9, 1.7);
    l.price = roundPrice(Math.min(l.price, Math.max(val * 0.78, noiIp / (targetCap / 100))));
  }
  b.listedId = id;
  state.listings.push(l);
  return l;
}

// ---------- Off-market scouting & negotiation ----------
export function canScout(state: GameState): { ok: boolean; why?: string } {
  if (state.month - state.lastScoutMonth < CONFIG.scoutCooldown) return { ok: false, why: `Your broker network needs ${CONFIG.scoutCooldown - (state.month - state.lastScoutMonth)} more month(s) before canvassing again.` };
  if (state.cash < CONFIG.scoutCost) return { ok: false, why: `Canvassing costs ${fmtMoney(CONFIG.scoutCost)}.` };
  return { ok: true };
}
export function doScout(state: GameState): { s: GameState; found: number } {
  const s = clone(state);
  const chk = canScout(s);
  if (!chk.ok) return { s, found: 0 };
  s.cash -= CONFIG.scoutCost;
  s.lastScoutMonth = s.month;
  const pool = s.stock.filter(b => !b.listedId && !b.blacklist && !b.buildLeft && b.owner === 'private');
  const n = Math.min(pool.length, 2 + Math.floor(rng(s) * 3)); // brokers earn their fee: 2-4 live leads
  for (let k = 0; k < n; k++) {
    const b = rpick(s, pool.filter(x => !x.listedId));
    if (!b || b.listedId) continue;
    makeOffMarketLead(s, b);
  }
  pushNews(s, 'info', n > 0
    ? `Off-market canvass complete: ${n} owner${n > 1 ? 's are' : ' is'} willing to hear a number. They didn't call you — price accordingly.`
    : 'Your canvass came up dry this quarter — every owner your brokers reached is holding.');
  return { s, found: n };
}

function makeOffMarketLead(s: GameState, b: StockBuilding, resBias = 0): Listing {
  const probe = { tileI: b.tileI, type: b.type, sf: b.sf, quality: b.quality, units: b.units, construction: b.construction };
  const omTenants = genRentRoll(s, { ...probe }, b.occ, 0.84, 1.04);
  const val = pricingValue(s, { ...probe, occ: b.occ } as any, omTenants);
  const roll = rng(s) + resBias;
  const resMult = roll < 0.55 ? rrange(s, 1.08, 1.35)   // unrealistic seller
    : roll < 0.82 ? rrange(s, 0.96, 1.07)               // reasonable
      : rrange(s, 0.78, 0.92);                          // quietly motivated — the gems
  const reservation = Math.round(val * resMult);
  const noAsk = rng(s) < 0.5;
  const l: Listing = {
    id: s.nextId++, tileI: b.tileI, kind: 'offmarket',
    type: b.type, sf: b.sf, units: b.units, occ: b.occ, quality: b.quality, age: b.age,
    construction: b.construction,
    acres: Math.round((b.sf / FAR[b.type] / 43_560) * 100) / 100,
    tenants: omTenants, stockId: b.id,
    parcel: b.px !== undefined ? { px: b.px, py: b.py!, pw: b.pw!, ph: b.ph! } : undefined,
    parcelCells: b.cells ? [...b.cells] : undefined,
    price: noAsk ? 0 : roundPrice(reservation * rrange(s, 1.02, 1.10)),
    noAsk, reservation, offersLeft: 3,
    expiresMonth: s.month + 5, hot: false,
  };
  b.listedId = l.id;
  s.listings.push(l);
  return l;
}

// Cold-call a specific owner yourself. Free — you get 5 dials a month.
export const APPROACH_COST = 0;
export function canApproach(state: GameState, stockId: number): { ok: boolean; why?: string } {
  const b = state.stock.find(x => x.id === stockId);
  if (!b) return { ok: false, why: 'That building is gone.' };
  if (b.buildLeft) return { ok: false, why: 'Still under construction — nobody sells a half-built shell over the phone.' };
  if (b.listedId) return { ok: false, why: 'It\'s already on the market — see the deal board.' };
  if (b.blacklist) return { ok: false, why: 'This owner stopped taking your calls after your last offer.' };
  if (b.owner !== 'private') return { ok: false, why: `${state.firms.find(f => f.short === b.owner)?.name ?? 'An institution'} owns this one — they don't sell over a phone call.` };
  if (b.approachedM !== undefined && state.month - b.approachedM < 24) return { ok: false, why: 'You asked recently. Owners remember; give it a couple of years.' };
  if (state.approachesLeft <= 0) return { ok: false, why: 'You\'ve made your 5 calls this month. Even hustle has office hours — more next month.' };
  return { ok: true };
}
export function approachOwner(state: GameState, stockId: number): { s: GameState; lead?: Listing; err?: string } {
  const s = clone(state);
  const chk = canApproach(s, stockId);
  if (!chk.ok) return { s, err: chk.why };
  const b = s.stock.find(x => x.id === stockId)!;
  s.approachesLeft--;
  b.approachedM = s.month;
  const pNo = clamp(0.45 - (s.reputation - 50) * 0.003, 0.22, 0.62);
  if (rng(s) < pNo) {
    pushNews(s, 'info', `The owner of the ${(b.sf / 1000).toFixed(0)}K SF ${PLABEL[b.type]} building heard you out and said no. Not everything is for sale.`);
    return { s, err: 'Owner isn\'t selling. The cooldown and the lunch bill are yours to keep.' };
  }
  const lead = makeOffMarketLead(s, b, 0.06); // a cold-called owner skews a touch prouder on price
  pushNews(s, 'info', `The owner will listen to a number on the ${(b.sf / 1000).toFixed(0)}K SF ${PLABEL[b.type]} building. No promises made.`);
  return { s, lead };
}

export function makeOffer(state: GameState, listingId: number, amount: number): { s: GameState; result: 'accepted' | 'countered' | 'declined' | 'gone'; counter?: number } {
  const s = clone(state);
  const l = s.listings.find(x => x.id === listingId);
  if (!l || l.yourSale || l.declinedYou || l.parentAssetId) return { s, result: 'gone' };
  const res = l.kind === 'offmarket'
    ? (l.reservation ?? l.price)
    : Math.round(l.price * (l.resFrac ?? 0.95) * (1 - (s.reputation - 50) * 0.0006)); // sellers bend a bit for a good name
  if (!res) return { s, result: 'gone' };
  l.offersLeft = (l.offersLeft ?? 1) - 1;
  // even inside polite range, a stingy number can simply end the conversation
  const cheek = amount / res;
  if (cheek < 0.97 && rng(s) < clamp((0.97 - cheek) * 2.2, 0, 0.5)) {
    l.offersLeft = 0;
  }
  if (amount >= res * 0.97) {
    const agreedPrice = roundPrice(Math.min(amount, Math.max(res, amount)));
    l.agreed = true; l.price = agreedPrice; l.expiresMonth = s.month + 2;
    pushNews(s, 'success', `Off-market seller accepted your ${fmtMoney(agreedPrice)} offer. You have ~2 months to close before they get cold feet.`);
    return { s, result: 'accepted' };
  }
  if (amount >= res * (l.kind === 'offmarket' ? 0.85 : 0.90) && (l.offersLeft ?? 0) > 0) {
    const counter = roundPrice(res * rrange(s, 1.00, 1.04));
    l.counterAt = counter;
    l.price = counter; // their counter IS the new ask
    if (l.noAsk) l.noAsk = false;
    return { s, result: 'countered', counter };
  }
  s.reputation = clamp(s.reputation - 1.5, 0, 100); // word gets around about lowballers
  if (l.kind === 'offmarket') {
    const sb = l.stockId ? s.stock.find(b => b.id === l.stockId) : undefined;
    if (sb) { sb.blacklist = true; sb.listedId = undefined; }
    s.listings = s.listings.filter(x => x.id !== listingId);
    pushNews(s, 'warn', `The off-market owner took your ${fmtMoney(amount)} offer as an insult. They've stopped returning calls.`);
  } else {
    l.declinedYou = true;
    pushNews(s, 'warn', l.kind === 'land'
      ? `The landowner won't deal with you after that ${fmtMoney(amount)} offer. Dirt has feelings too, apparently.`
      : `The seller of the ${((l.sf ?? 0) / 1000).toFixed(0)}K SF ${PLABEL[l.type!]} listing won't deal with you after that ${fmtMoney(amount)} offer. Brokers talk.`);
  }
  return { s, result: 'declined' };
}

// ---------- Actions ----------
export function clone(state: GameState): GameState { return JSON.parse(JSON.stringify(state)); }

export function doFeasibility(state: GameState, listingId: number): GameState {
  const s = clone(state);
  const l = s.listings.find(x => x.id === listingId);
  if (!l || s.cash < CONFIG.feasCost) return s;
  s.cash -= CONFIG.feasCost;
  l.feasDone = true;
  return s;
}

export function maxLTV(state: GameState, type?: PType): number {
  let ltv = CONFIG.acqLTV + (type === 'industrial' ? CONFIG.indLTVBonus : 0);
  if (state.econ.crunchMonthsLeft > 0) ltv -= 0.10;
  return ltv;
}

export function inPlaceNOIYr(state: GameState, l: Listing): number {
  const probe = { tileI: l.tileI, type: l.type!, sf: l.sf!, quality: l.quality!, units: l.units ?? 1, construction: l.construction ?? CONSTR[l.type!][0].id, maint: 'std' as const, tenants: l.tenants ?? [] };
  const potM = (l.sf! * assetRentPSF(state, probe as any)) / 12;
  const egiM = isAggregate(l.type!) ? potM * (l.occ ?? 0) : (l.tenants ?? []).reduce((s2, t) => s2 + t.sf * t.rate, 0) / 12;
  const ex = expenseBreakdown(state, probe as any, potM, egiM);
  return (egiM - ex.total) * 12;
}

export function buyBuilding(state: GameState, listingId: number, downPct: number, useJV = false): { s: GameState; err?: string } {
  const s = clone(state);
  const l = s.listings.find(x => x.id === listingId);
  if (!l || l.kind === 'land') return { s, err: 'Listing gone.' };
  if (l.yourSale) return { s, err: 'That\'s your own listing — delist it if you\'ve changed your mind.' };
  if (l.kind === 'offmarket' && !l.agreed) return { s, err: 'The seller hasn\'t agreed to a price yet — make an offer first.' };
  const down = l.price * downPct;
  const loanAmt = l.price - down;
  const ltv = loanAmt / l.price;
  if (ltv > maxLTV(s, l.type) + 1e-6) return { s, err: 'Bank will not exceed ' + Math.round(maxLTV(s, l.type) * 100) + '% LTV.' };
  const jvChk = useJV ? canJV(s, down) : null;
  if (useJV && jvChk && !jvChk.ok) return { s, err: jvChk.why };
  const yourEquity = useJV ? Math.round(down * 0.30) : down;
  if (s.cash < yourEquity + 15000) return { s, err: 'Not enough cash for the down payment plus closing costs.' };
  const rate = s.econ.rate + CONFIG.acqSpread;
  const pmt = monthlyPayment(loanAmt, rate, CONFIG.acqAmortYears);
  const noiYr = inPlaceNOIYr(s, l);
  // at 50% LTV or less, the collateral speaks for itself — a loan is always available
  if (ltv > 0.501) {
    if (loanAmt > 0 && noiYr / (pmt * 12) < CONFIG.minDSCR && !l.distressed && l.kind !== 'offmarket') {
      return { s, err: 'DSCR ' + (noiYr / (pmt * 12)).toFixed(2) + '× is below the bank minimum of 1.25×. Put 50% down and any bank will lend on the collateral alone.' };
    }
    if (loanAmt > 0 && noiYr / (pmt * 12) < 0.9) {
      return { s, err: 'Even a bridge lender needs ~0.9× coverage at this leverage. Drop to 50% LTV and the loan is yours.' };
    }
  }
  s.cash -= yourEquity + 15000;
  const t = s.tiles[l.tileI];
  const a: Asset = {
    id: s.nextId++, name: nameFor(s, l.type!), tileI: l.tileI, type: l.type!,
    sf: l.sf!, acres: l.acres ?? Math.round((l.sf! / FAR[l.type!] / 43560) * 100) / 100,
    px: l.parcel?.px, py: l.parcel?.py, pw: l.parcel?.pw, ph: l.parcel?.ph,
    cells: l.parcelCells ? [...l.parcelCells] : undefined,
    units: l.units ?? 1, construction: l.construction ?? CONSTR[l.type!][0].id,
    quality: l.quality!, qCap: constrSpec({ type: l.type!, construction: l.construction ?? CONSTR[l.type!][0].id }).qCap,
    age: l.age!, mode: 'operating',
    tenants: (l.tenants ?? []).map(tn => ({ ...tn })), occ: 0,
    rentStance: 0, maint: 'std',
    loans: loanAmt > 0 ? [{ id: s.nextId++, kind: 'acq', balance: loanAmt, ratePct: rate, amortYears: CONFIG.acqAmortYears, ioMonthsLeft: 0, monthlyPmt: pmt, maturityMonth: s.month + CONFIG.loanTermMonths, covenant: ltv > 0.501 && noiYr / (pmt * 12) >= 1.2 } as any] : [],
    ledger: [{ m: s.month, amt: -(yourEquity + 15000) }], cumCF: 0,
    basis: l.price + 15000, acqMonth: s.month,
    entryNOI: noiYr, entryCap: capRatePct(s, t, l.type!, l.quality!),
    negCFStreak: 0,
  };
  a.deprBasis = Math.round(l.price * 0.80); // ~20% is land; the rest depreciates
  a.deprTaken = 0;
  if (s.exchange && l.price >= s.exchange.mustSpend) {
    a.deprBasis = Math.max(Math.round(l.price * 0.2), a.deprBasis - Math.round(s.exchange.deferred / TAX.capGains)); // carryover basis: the deferral isn't free
    pushNews(s, 'success', `1031 EXCHANGE COMPLETE: ${a.name} closes the loop from ${s.exchange.fromName}. ${fmtMoney(s.exchange.deferred)} of tax deferred — carried into a lower depreciable basis.`);
    s.exchange = undefined;
  }
  if (useJV) attachJV(s, a, down);
  if (isAggregate(a.type)) a.occ = l.occ ?? 0; else recalcOcc(a);
  s.assets.push(a);
  if (l.stockId) s.stock = s.stock.filter(b => b.id !== l.stockId);
  s.listings = s.listings.filter(x => x.id !== listingId);
  s.dealsClosed++;
  logComp(s, { m: s.month, type: a.type, sf: a.sf, price: l.price, capPct: l.price > 0 ? Math.round((inPlaceNOIYr(s, l) / l.price) * 10000) / 100 : null, tileI: a.tileI, buyer: 'You' });
  pushNews(s, 'deal', `You acquired ${a.name} (${(l.sf! / 1000).toFixed(0)}K SF ${PLABEL[l.type!]}, ${a.tenants.length} tenant${a.tenants.length === 1 ? '' : 's'}) for ${fmtMoney(l.price)} at ${Math.round(ltv * 100)}% LTV${l.kind === 'offmarket' ? ' — off market' : ''}.`);
  return { s };
}

const NAMES = ['Alder', 'Beacon', 'Cascade', 'Drummond', 'Ellsworth', 'Foundry', 'Granite', 'Halstead', 'Ironwood', 'Junction', 'Keystone', 'Larkspur', 'Meridian', 'Northfield', 'Oakline', 'Pemberton', 'Quarry', 'Rowan', 'Sterling', 'Tanner', 'Union', 'Vantage', 'Whitfield'];
function nameFor(state: GameState, type: PType): string {
  const base = NAMES[Math.floor(rng(state) * NAMES.length) % NAMES.length];
  const suffix = type === 'office' ? 'Tower' : type === 'retail' ? 'Commons' : type === 'industrial' ? 'Works' : type === 'multifamily' ? 'Flats' : 'Exchange';
  return `${base} ${suffix}`;
}

export interface DevChoice {
  type: PType; sf: number; units: number; construction: string;
  contractor: 'budget' | 'standard' | 'premium';
  contingencyPct: number; expedited: boolean; downPct: number;
}

export function maxBuildableSF(l: Listing, type: PType): number {
  return Math.floor(((l.acres ?? 0) * 43_560 * FAR[type] * upzoneBonus(listingParcels(l))) / 1000) * 1000;
}

export function devCostBreakdown(state: GameState, c: DevChoice, landCost: number) {
  const spec = CONSTR[c.type].find(x => x.id === c.construction) ?? CONSTR[c.type][0];
  const tariff = state.econ.tariffMonthsLeft > 0 ? 1.08 : 1;
  const contractorMult = c.contractor === 'budget' ? 0.90 : c.contractor === 'premium' ? 1.15 : 1;
  const sizeMult = clamp(1.08 - 0.13 * Math.log10(Math.max(3000, c.sf) / 5000), 0.82, 1.12); // scale economies
  const hard = spec.cost * sizeMult * c.sf * contractorMult * tariff * constrCostIdx(state) * (c.expedited ? 1.08 : 1);
  const soft = hard * CONFIG.softCostPct;
  const cont = hard * c.contingencyPct;
  const total = landCost + hard + soft + cont;
  const months = Math.min(26, Math.max(5, Math.round((4 + c.sf / 7000) * (c.expedited ? 0.75 : 1))));
  return { hard, soft, cont, total, months, landCost, spec };
}

export function validateDev(state: GameState, l: Listing, c: DevChoice): string | null {
  const spec = CONSTR[c.type].find(x => x.id === c.construction);
  if (!spec) return 'Pick a construction type.';
  const bMax = maxBuildableSF(l, c.type);
  if (c.sf > bMax) return `Site coverage caps a ${PLABEL[c.type].toLowerCase()} building on ${l.acres} acres at ${(bMax / 1000).toFixed(0)}K SF.`;
  if (c.sf > CONFIG.tiers[state.tier].maxSF) return `Your firm can take on projects up to ${CONFIG.tiers[state.tier].maxSF / 1000}K SF. Grow to unlock larger.`;
  if (spec.maxSF && c.sf > spec.maxSF) return `${spec.label} tops out at ${spec.maxSF / 1000}K SF.`;
  if (spec.fixedUnits && c.units !== spec.fixedUnits) return `${spec.label} is single-tenant by definition.`;
  if (spec.minUnits && c.units < spec.minUnits) return `${spec.label} needs at least ${spec.minUnits} suites.`;
  const minSuite = c.type === 'multifamily' ? 500 : c.type === 'industrial' ? 2000 : c.type === 'mixed' ? 800 : 1000;
  if (c.units > Math.floor(c.sf / minSuite)) {
    if (c.type === 'multifamily') return 'Apartments under 500 SF won\'t pass code.';
    if (c.type === 'industrial') return 'Industrial bays under 2,000 SF aren\'t functional — fewer, bigger units.';
    return 'Suites under 1,000 SF aren\'t leasable ' + PLABEL[c.type].toLowerCase() + ' space.';
  }
  if (c.type === 'mixed' && state.tier < 1) return 'Mixed-use unlocks at Tier 2 (Established Developer).';
  return null;
}

export function buyLandAndDevelop(state: GameState, listingId: number, c: DevChoice, useJV = false): { s: GameState; err?: string } {
  const s = clone(state);
  const l = s.listings.find(x => x.id === listingId);
  if (!l || l.kind !== 'land') return { s, err: 'Listing gone.' };
  const vErr = validateDev(s, l, c);
  if (vErr) return { s, err: vErr };
  const bd = devCostBreakdown(s, c, l.price);
  const maxLoan = bd.total * (CONFIG.constrLTC - (s.econ.crunchMonthsLeft > 0 ? 0.1 : 0));
  const equity = Math.max(bd.total * c.downPct, bd.total - maxLoan);
  if (s.cash < equity) return { s, err: 'You need ' + fmtMoney(equity) + ' of equity for this capital stack.' };
  const loanAmt = bd.total - equity;
  const rate = s.econ.rate + CONFIG.constrSpread;
  const jvChk2 = useJV ? canJV(s, equity) : null;
  if (useJV && jvChk2 && !jvChk2.ok) return { s, err: jvChk2.why };
  const yourEquity2 = useJV ? Math.round(equity * 0.30) : equity;
  if (s.cash < yourEquity2) return { s, err: `You need ${fmtMoney(yourEquity2)} of equity at closing.` };
  s.cash -= equity - (equity - yourEquity2); // your slice only

  const t = s.tiles[l.tileI];
  const events: ConstrEvent[] = [];
  const riskMult = c.contractor === 'budget' ? 1.7 : c.contractor === 'premium' ? 0.5 : 1;
  const pool = ['materials', 'labor', 'weather', 'soils', ...(c.contractor === 'budget' ? ['default'] : []), 'ahead'];
  const nEvents = rng(s) < 0.55 * riskMult ? (rng(s) < 0.35 * riskMult ? 2 : 1) : 0;
  for (let k = 0; k < nEvents; k++) {
    events.push({ month: 1 + Math.floor(rng(s) * (bd.months - 1)), kind: rpick(s, pool), resolved: false });
  }
  if (c.contractor === 'premium' && rng(s) < 0.35) events.push({ month: Math.floor(bd.months * 0.6), kind: 'ahead', resolved: false });
  const startQ = bd.spec.q + (c.contractor === 'premium' ? 6 : c.contractor === 'budget' ? -8 : 0);
  const permitMonths = 1 + Math.floor(rng(s) * 3);
  const a: Asset = {
    id: s.nextId++, name: nameFor(s, c.type), tileI: l.tileI, type: c.type,
    sf: c.sf, acres: l.acres ?? 0,
    px: l.parcel?.px, py: l.parcel?.py, pw: l.parcel?.pw, ph: l.parcel?.ph,
    cells: l.parcelCells ?? (l.parcel ? cellsOfRect(l.parcel.px, l.parcel.py, l.parcel.pw, l.parcel.ph) : undefined),
    units: c.units, construction: c.construction,
    quality: clamp(startQ, 20, bd.spec.qCap), qCap: bd.spec.qCap,
    age: 0, mode: 'construction',
    tenants: [], occ: 0, rentStance: 0, maint: 'std',
    loans: [{ id: s.nextId++, kind: 'constr', balance: 0, ratePct: rate, amortYears: 25, ioMonthsLeft: 999, monthlyPmt: 0, maturityMonth: s.month + bd.months + permitMonths + 14 }],
    ledger: [{ m: s.month, amt: -equity }], cumCF: 0,
    basis: bd.total, acqMonth: s.month,
    entryNOI: 0, entryCap: capRatePct(s, t, c.type, startQ),
    project: {
      stage: 'permitting', monthsLeft: permitMonths, totalMonths: bd.months,
      hardBudget: bd.hard, softBudget: bd.soft, spent: l.price,
      contingency: bd.cont, contingencyLeft: bd.cont,
      contractor: c.contractor, expedited: c.expedited, events, drawnSoFar: 0, monthsBuilt: 0,
    },
    negCFStreak: 0,
  };
  a.deprBasis = Math.round(bd.hard + bd.soft);
  a.deprTaken = 0;
  if (l.fromLandId) {
    const ids: number[] = (l as any).mergedLand ?? [l.fromLandId];
    for (const hid of ids) {
      const h = s.land.find(x => x.id === hid);
      if (h) { a.basis += h.basis; s.land = s.land.filter(x => x.id !== h.id); }
    }
  }
  if (useJV) attachJV(s, a, equity);
  (a as any).loanCommitment = loanAmt;
  s.assets.push(a);
  s.listings = s.listings.filter(x => x.id !== listingId);
  s.dealsClosed++;
  pushNews(s, 'deal', `Groundbreaking: ${a.name} — ${(c.sf / 1000).toFixed(0)}K SF ${bd.spec.label.toLowerCase()}, ${c.units} unit${c.units === 1 ? '' : 's'} on ${l.acres} acres. Budget ${fmtMoney(bd.total)} (${Math.round((loanAmt / bd.total) * 100)}% LTC).`);
  return { s };
}

export function resolveConstrEvent(state: GameState, assetId: number, choice: 'absorb' | 'mitigate'): GameState {
  const s = clone(state);
  const a = s.assets.find(x => x.id === assetId);
  if (!a || !a.project) return s;
  const p = a.project;
  const idx = s.pending.findIndex(pd => pd.type === 'constrEvent' && pd.assetId === assetId);
  if (idx < 0) return s;
  const kind = s.pending[idx].eventKind;
  s.pending.splice(idx, 1);
  const applyCost = (amt: number, label: string) => {
    const fromCont = Math.min(p.contingencyLeft, amt);
    p.contingencyLeft -= fromCont;
    const overflow = amt - fromCont;
    if (overflow > 0) {
      s.cash -= overflow;
      a.ledger.push({ m: s.month, amt: -overflow });
      pushNews(s, 'warn', `${a.name}: ${label} ran ${fmtMoney(amt)} over — contingency covered ${fmtMoney(fromCont)}, you funded ${fmtMoney(overflow)} from cash.`);
    } else {
      pushNews(s, 'info', `${a.name}: ${label} cost ${fmtMoney(amt)}, absorbed by contingency (${fmtMoney(p.contingencyLeft)} left).`);
    }
    p.spent += amt;
  };
  if (kind === 'materials') {
    const amt = p.hardBudget * (0.04 + rng(s) * 0.06);
    if (choice === 'mitigate') { applyCost(amt * 0.45, 'material spike (value-engineered)'); a.quality -= 9; }
    else applyCost(amt, 'material price spike');
  } else if (kind === 'labor') {
    if (choice === 'mitigate') { applyCost(p.hardBudget * 0.03, 'overtime crews'); }
    else { p.monthsLeft += 2; pushNews(s, 'warn', `${a.name}: labor shortage adds 2 months to the schedule.`); }
  } else if (kind === 'default') {
    if (choice === 'mitigate') { applyCost(p.hardBudget * 0.05, 're-bidding the contract'); p.monthsLeft += 2; }
    else { applyCost(p.hardBudget * 0.09, 'contractor default'); p.monthsLeft += 4; }
    pushNews(s, 'warn', `${a.name}: your budget contractor walked off the job.`);
  }
  return s;
}

export function resolveAssetEvent(state: GameState, assetId: number, choice: 'a' | 'b'): GameState {
  const s = clone(state);
  const a = s.assets.find(x => x.id === assetId);
  const idx = s.pending.findIndex(pd => pd.type === 'assetEvent' && pd.assetId === assetId);
  if (idx < 0) return s;
  const kind = s.pending[idx].eventKind;
  s.pending.splice(idx, 1);
  if (!a) return s;
  const pay = (amt: number) => { s.cash -= amt; a.ledger.push({ m: s.month, amt: -amt }); };
  if (kind === 'roof') {
    const full = Math.round(a.sf * rrange(s, 3.2, 5.5) * s.econ.costIdx / 1000) * 1000;
    if (choice === 'a') { // full replacement
      pay(full); a.basis += full;
      pushNews(s, 'info', `${a.name}: roof and HVAC replaced for ${fmtMoney(full)}. Tenants notice these things — quietly, in renewals.`);
      a.quality = clamp(a.quality + 4, 10, 95);
    } else { // patch it
      pay(Math.round(full * 0.22));
      a.quality = clamp(a.quality - 7, 10, 95);
      if (rng(s) < 0.4) s.scheduledEvents.push({ m: s.month + 6 + Math.floor(rng(s) * 8), kind: 'roofBill', payload: a.id });
      pushNews(s, 'warn', `${a.name}: roof patched for ${fmtMoney(Math.round(full * 0.22))}. Water finds a way; you've bought time, not a roof.`);
    }
  } else if (kind === 'reassess') {
    const hike = Math.round(assetValue(s, a) * 0.006 / 1000) * 1000; // annualized tax bump ~0.6% of value
    if (choice === 'a') { // appeal
      const fee = 25_000; pay(fee);
      if (rng(s) < 0.55) {
        pushNews(s, 'success', `${a.name}: assessment appeal WON. The county backs off; ${fmtMoney(fee)} well spent.`);
      } else {
        (a as any).taxBumpYr = ((a as any).taxBumpYr ?? 0) + hike;
        pushNews(s, 'warn', `${a.name}: appeal denied. Taxes rise ${fmtMoney(hike)}/yr and the lawyer still got paid.`);
      }
    } else {
      (a as any).taxBumpYr = ((a as any).taxBumpYr ?? 0) + hike;
      pushNews(s, 'info', `${a.name}: reassessment accepted — property taxes up ${fmtMoney(hike)}/yr. The county thanks you for your service.`);
    }
  } else if (kind === 'tiDemand') {
    const tn = [...a.tenants].sort((x, y) => y.sf - x.sf)[0];
    if (tn) {
      const ti = Math.round(tn.sf * rrange(s, 9, 15) / 1000) * 1000;
      if (choice === 'a') { // fund the TI package
        pay(ti); a.basis += ti;
        tn.startM = s.month; tn.endM = s.month + Math.round(rrange(s, 60, 96));
        tn.rate = Math.round(tn.rate * rrange(s, 1.02, 1.06) * 100) / 100;
        pushNews(s, 'success', `${a.name}: ${tn.name} signed a long extension after a ${fmtMoney(ti)} improvement package — and took a small bump to $${tn.rate.toFixed(2)}/SF.`);
      } else {
        tn.endM = Math.min(tn.endM, s.month + Math.round(rrange(s, 6, 14)));
        pushNews(s, 'warn', `${a.name}: ${tn.name} didn't get their improvements. They've started touring other buildings — expect them gone within the year.`);
      }
    }
  }
  return s;
}

export function setPrefer1031(state: GameState, on: boolean): GameState {
  const s = clone(state); s.prefer1031 = on; return s;
}
export function setAutoLease(state: GameState, on: boolean): GameState {
  const s = clone(state); s.autoLease = on;
  pushNews(s, 'info', on
    ? 'Leasing delegated: your agent will negotiate every LOI, RFP, and renewal at standard terms. Commissions apply either way.'
    : 'You\'ve taken lease negotiations back in-house. Every proposal now crosses your desk.');
  return s;
}

export function grantSandboxCash(state: GameState, amount = 50_000_000): GameState {
  const s = clone(state);
  s.cash += amount;
  s.sandbox = true;
  pushNews(s, 'info', `SANDBOX: ${fmtMoney(amount)} wired in for testing. This campaign is flagged as a sandbox.`);
  return s;
}

export function setRentStance(state: GameState, assetId: number, stance: number): GameState {
  const s = clone(state); const a = s.assets.find(x => x.id === assetId); if (a) a.rentStance = stance; return s;
}
export function setMaint(state: GameState, assetId: number, m: 'low' | 'std' | 'high'): GameState {
  const s = clone(state); const a = s.assets.find(x => x.id === assetId); if (a) a.maint = m; return s;
}
// The defining trade of the decade: gut a dying office building and hand it to renters
export function demolitionCost(state: GameState, a: Pick<Asset, 'sf' | 'type'>): number {
  return Math.round(a.sf * (a.type === 'industrial' ? 4.5 : 7.5) * constrCostIdx(state) / 1000) * 1000;
}
export function canDemolish(state: GameState, a: Asset): { ok: boolean; why?: string } {
  if (a.mode === 'construction') return { ok: false, why: 'It isn\'t built yet.' };
  if (a.occ > 0.15) return { ok: false, why: `${Math.round(a.occ * 100)}% of this building is leased — you can\'t demolish around paying tenants.` };
  if (a.forSale) return { ok: false, why: 'Delist it first.' };
  if (assetTotalDebt(state, a) > 0) return { ok: false, why: 'Pay off the debt first — no lender lets you knock down their collateral.' };
  if (state.cash < demolitionCost(state, a)) return { ok: false, why: `Demolition runs ${fmtMoney(demolitionCost(state, a))}.` };
  return { ok: true };
}
export function demolish(state: GameState, assetId: number): { s: GameState; err?: string } {
  const s = clone(state);
  const a = s.assets.find(x => x.id === assetId);
  if (!a) return { s };
  const chk = canDemolish(s, a);
  if (!chk.ok) return { s, err: chk.why };
  const cost = demolitionCost(s, a);
  s.cash -= cost;
  const t = s.tiles[a.tileI];
  t.supply[a.type] = Math.max(0, t.supply[a.type] - a.sf);
  const cells = footprintCells(a);
  if (cells.length) {
    s.land.push({ id: s.nextId++, tileI: a.tileI, cells, basis: Math.round(a.basis + cost), acquiredM: s.month });
  }
  s.assets = s.assets.filter(x => x.id !== assetId);
  s.lois = s.lois.filter(x => x.assetId !== assetId);
  pushNews(s, 'info', `${a.name} is gone — ${fmtMoney(cost)} to take it down. What's left is ${Math.round(cells.length * PARCEL_AC * 100) / 100} acres of clean dirt at block ${blockLabel(t)}.`, a.tileI);
  return { s };
}

export function conversionCost(state: GameState, a: Pick<Asset, 'sf' | 'quality'>): number {
  return Math.round(a.sf * (128 + Math.max(0, 60 - a.quality) * 0.9) * constrCostIdx(state) / 1000) * 1000;
}
export function canConvert(state: GameState, a: Asset): { ok: boolean; why?: string } {
  if (a.type !== 'office') return { ok: false, why: 'Only office buildings convert — the floorplates and plumbing of other types don\'t pencil.' };
  if (a.mode === 'construction' || a.project) return { ok: false, why: 'Finish what you\'re building first.' };
  if (a.occ > 0.35) return { ok: false, why: `Occupancy is ${Math.round(a.occ * 100)}% — you can\'t gut a building around paying tenants. Get below 35%.` };
  if (a.forSale) return { ok: false, why: 'Delist it first.' };
  const cost = conversionCost(state, a);
  if (state.cash < cost) return { ok: false, why: `Conversion runs ${fmtMoney(cost)} cash — plumbing every floor isn't cheap.` };
  return { ok: true };
}
export function startConversion(state: GameState, assetId: number): { s: GameState; err?: string } {
  const s = clone(state);
  const a = s.assets.find(x => x.id === assetId);
  if (!a) return { s };
  const chk = canConvert(s, a);
  if (!chk.ok) return { s, err: chk.why };
  const cost = conversionCost(s, a);
  s.cash -= cost;
  a.basis += cost;
  a.deprBasis = (a.deprBasis ?? 0) + cost;
  a.ledger.push({ m: s.month, amt: -cost });
  // buy out the stragglers
  a.tenants = [];
  a.occ = 0;
  a.mode = 'construction';
  a.project = { stage: 'construction', monthsBuilt: 0, monthsLeft: 12, spent: cost, hardBudget: cost, contingencyLeft: Math.round(cost * 0.08), contractor: 'standard' } as any;
  (a as any).converting = true;
  pushNews(s, 'event', `CONVERSION STARTED: ${a.name} is being gutted — office to apartments, ${fmtMoney(cost)}, ~12 months. The skyline stays; everything inside changes.`);
  return { s };
}
export function renovCost(state: GameState, a: Pick<Asset, 'sf' | 'type'>): number {
  return a.sf * CONFIG.hardCost[a.type] * 0.22 * constrCostIdx(state);
}
export function startRenovation(state: GameState, assetId: number): { s: GameState; err?: string } {
  const s = clone(state); const a = s.assets.find(x => x.id === assetId);
  if (!a) return { s };
  const cost = renovCost(s, a);
  if (s.cash < cost) return { s, err: 'Renovation needs ' + fmtMoney(cost) + ' cash.' };
  if (a.renovMonthsLeft) return { s, err: 'Renovation already underway.' };
  s.cash -= cost;
  a.ledger.push({ m: s.month, amt: -cost });
  a.basis += cost;
  a.renovMonthsLeft = 3;
  pushNews(s, 'info', `Capital program started at ${a.name} (${fmtMoney(cost)}): quality steps up over 3 months.`);
  return { s };
}

// The fewer lots left on a block, the better the remaining owners understand their position.
export function holdoutMult(state: GameState, tileI: number, taking: number): number {
  const free = freeParcelCount(state, tileI);
  const scarcity = 1 - free / (PGRID * PGRID);           // how built-out the block already is
  const sweep = taking / Math.max(1, free);              // how much of what's left you want
  return 1 + scarcity * 0.55 + sweep * 0.22 + Math.max(0, taking - 1) * 0.015;
}
export function parcelPrice(state: GameState, tileI: number, pw: number, ph: number): number {
  const t = state.tiles[tileI];
  const acres = pw * ph * PARCEL_AC;
  return roundPrice(acres * landPricePerAcre(state, t) * holdoutMult(state, tileI, pw * ph));
}
// Assemble enough contiguous frontage and the city will let you build denser.
export function upzoneBonus(parcels: number): number {
  return parcels >= 16 ? 1.35 : parcels >= 12 ? 1.22 : parcels >= 8 ? 1.12 : 1;
}
export function listingParcels(l: Listing): number {
  if (l.parcelCells) return l.parcelCells.length;
  return l.parcel ? l.parcel.pw * l.parcel.ph : Math.max(1, Math.round((l.acres ?? 0) / PARCEL_AC));
}
export function parcelSetPrice(state: GameState, tileI: number, cells: number[]): number {
  const t = state.tiles[tileI];
  return roundPrice(cells.length * PARCEL_AC * landPricePerAcre(state, t) * holdoutMult(state, tileI, cells.length));
}
function cellsAvailable(state: GameState, tileI: number, cells: number[]): boolean {
  const g = parcelGrid(state, tileI);
  return cells.every(c => c >= 0 && c < PGRID * PGRID && g[c] === null);
}
export function buyParcelsOutright(state: GameState, tileI: number, cells: number[]): { s: GameState; err?: string } {
  const s = clone(state);
  if (!cells.length) return { s, err: 'Nothing selected.' };
  if (!cellsAvailable(s, tileI, cells)) return { s, err: 'Some of those parcels aren\'t vacant anymore.' };
  const price = parcelSetPrice(s, tileI, cells);
  if (s.cash < price) return { s, err: `That assembly costs ${fmtMoney(price)}.` };
  s.cash -= price;
  s.land.push({ id: s.nextId++, tileI, cells: [...cells].sort((a, b) => a - b), basis: price, acquiredM: s.month });
  pushNews(s, 'deal', `Land banked: ${Math.round(cells.length * PARCEL_AC * 100) / 100} acres at block ${blockLabel(s.tiles[tileI])} for ${fmtMoney(price)}. Dirt costs nothing to hold but the carry — and the patience.`, tileI);
  return { s };
}
export function landValue(state: GameState, h: LandHolding): number {
  return roundPrice(h.cells.length * PARCEL_AC * landPricePerAcre(state, state.tiles[h.tileI]));
}
export function sellLand(state: GameState, holdingId: number): { s: GameState; err?: string } {
  const s = clone(state);
  const h = s.land.find(x => x.id === holdingId);
  if (!h) return { s };
  const gross = landValue(s, h);
  const net = Math.round(gross * 0.97);
  s.cash += net;
  s.totalRealizedProfit += net - h.basis;
  s.land = s.land.filter(x => x.id !== holdingId);
  pushNews(s, net - h.basis >= 0 ? 'success' : 'warn', `Sold your ${Math.round(h.cells.length * PARCEL_AC * 100) / 100} acres at block ${blockLabel(s.tiles[h.tileI])} for ${fmtMoney(net)} — ${net - h.basis >= 0 ? 'a gain' : 'a loss'} of ${fmtMoney(Math.abs(net - h.basis))} against your ${fmtMoney(h.basis)} basis.`, h.tileI);
  return { s };
}
// Every touching lot you own on this block builds as one site — corners alone don't count.
export function developableFrom(state: GameState, holdingId: number): { cells: number[]; holdings: number[] } {
  const h = state.land.find(x => x.id === holdingId);
  if (!h) return { cells: [], holdings: [] };
  const mine = state.land.filter(x => x.tileI === h.tileI);
  const all = mine.flatMap(x => x.cells);
  const group = connectedGroup(all, h.cells[0]);
  const gset = new Set(group);
  return { cells: group.sort((a, b) => a - b), holdings: mine.filter(x => x.cells.some(c => gset.has(c))).map(x => x.id) };
}
export function developLand(state: GameState, holdingId: number): { s: GameState; listingId?: number; err?: string } {
  const s = clone(state);
  const h = s.land.find(x => x.id === holdingId);
  if (!h) return { s };
  const existing = s.listings.find(l => l.fromLandId === h.id);
  if (existing) return { s, listingId: existing.id };
  const { cells, holdings } = developableFrom(s, holdingId);
  if (!cells.length) return { s, err: 'Nothing to build on.' };
  const id = s.nextId++;
  s.listings.push({
    id, tileI: h.tileI, kind: 'land', acres: Math.round(cells.length * PARCEL_AC * 100) / 100,
    price: 0, parcelCells: cells,
    expiresMonth: s.month + 6, hot: false, agreed: true, fromLandId: h.id,
    ...({ mergedLand: holdings } as any),
  });
  return { s, listingId: id };
}

export function buyParcelsForDev(state: GameState, tileI: number, cells: number[]): { s: GameState; listingId?: number; err?: string } {
  const s = clone(state);
  if (!cells.length) return { s, err: 'Nothing selected.' };
  if (!isContiguous(cells)) return { s, err: 'Those lots only touch at a corner — a building needs parcels that share an edge.' };
  if (!cellsAvailable(s, tileI, cells)) return { s, err: 'Some of those parcels aren\'t vacant anymore.' };
  const id = s.nextId++;
  s.listings.push({
    id, tileI, kind: 'land', acres: Math.round(cells.length * PARCEL_AC * 100) / 100,
    price: parcelSetPrice(s, tileI, cells), parcelCells: [...cells].sort((a, b) => a - b),
    resFrac: rrange(s, 0.9, 0.99), listMonth: s.month, offersLeft: 3,
    expiresMonth: s.month + 4, hot: false,
  });
  return { s, listingId: id };
}

// Excess land on an asset you own: carve it out and build again if the numbers work
export function excessAcres(a: Pick<Asset, 'acres' | 'sf' | 'type'>): number {
  return Math.max(0, Math.round((a.acres - a.sf / (FAR[a.type] * 43_560)) * 100) / 100);
}
export function spareParcels(state: GameState, a: Asset): number { return freeParcelCount(state, a.tileI); }
export function createExcessLandListing(state: GameState, assetId: number): { s: GameState; listingId?: number; err?: string } {
  const s = clone(state);
  const a = s.assets.find(x => x.id === assetId);
  if (!a) return { s };
  const existing = s.listings.find(l => l.parentAssetId === a.id);
  if (existing) return { s, listingId: existing.id };
  const spot = findFreeRect(s, a.tileI, 2, () => rng(s));
  if (!spot) return { s, err: 'No vacant parcels left on this block.' };
  const id = s.nextId++;
  s.listings.push({
    id, tileI: a.tileI, kind: 'land', acres: Math.round(spot.pw * spot.ph * PARCEL_AC * 100) / 100,
    price: parcelPrice(s, a.tileI, spot.pw, spot.ph), parcel: spot,
    parentAssetId: a.id, expiresMonth: s.month + 3, hot: false,
  });
  return { s, listingId: id };
}

// ---------- Refinance (adjustable terms) ----------
export interface RefiChoice { amount: number; amortYears: number; }
export function refiLimits(state: GameState, a: Asset) {
  const val = assetValue(state, a);
  const rate = state.econ.rate + CONFIG.refiSpread;
  const payoff = assetDebt(a);
  const maxByLTV = val * CONFIG.refiLTV;
  const noiYr = assetNOIMonthly(state, a) * 12;
  return { val, rate, payoff, maxByLTV, noiYr };
}
export function refiQuote(state: GameState, a: Asset, c: RefiChoice) {
  const lim = refiLimits(state, a);
  const pmt = monthlyPayment(c.amount, lim.rate, c.amortYears);
  const dscr = pmt > 0 ? lim.noiYr / (pmt * 12) : null;
  const proceeds = c.amount - lim.payoff - lim.val * 0.01;
  return { ...lim, pmt, dscr, proceeds, amount: c.amount, amortYears: c.amortYears };
}
export function doRefi(state: GameState, assetId: number, c: RefiChoice): { s: GameState; err?: string } {
  const s = clone(state); const a = s.assets.find(x => x.id === assetId);
  if (!a) return { s };
  if (s.econ.crunchMonthsLeft > 0) return { s, err: 'Credit markets are frozen — no refinancings until the crunch passes.' };
  if (a.mode !== 'operating' || a.occ < 0.80) return { s, err: 'Lenders want a stabilized asset (80%+ occupied) for permanent debt.' };
  if (s.facilities.some(f => f.assetIds.includes(a.id))) return { s, err: 'This asset is cross-collateralized in a credit facility. Unwind the facility first.' };
  if (c.amortYears < 10 || c.amortYears > CONFIG.refiAmortMax) return { s, err: 'Amortization must be 10–25 years.' };
  const q = refiQuote(s, a, c);
  if (c.amount > q.maxByLTV + 1) return { s, err: `The bank tops out at 70% LTV — ${fmtMoney(q.maxByLTV)}.` };
  if (c.amount < q.payoff) return { s, err: 'The new loan must at least pay off your existing debt.' };
  if (q.dscr !== null && q.dscr < CONFIG.refiDSCR) return { s, err: `DSCR ${q.dscr.toFixed(2)}× is below the 1.20× the bank needs at ${q.rate.toFixed(1)}% / ${c.amortYears}-yr am.` };
  a.loans = [{ id: s.nextId++, kind: 'refi', balance: c.amount, ratePct: q.rate, amortYears: c.amortYears, ioMonthsLeft: 0, monthlyPmt: q.pmt, maturityMonth: s.month + CONFIG.loanTermMonths }];
  s.cash += q.proceeds;
  a.ledger.push({ m: s.month, amt: q.proceeds });
  pushNews(s, 'success', `Refinanced ${a.name}: ${fmtMoney(c.amount)} at ${q.rate.toFixed(1)}%, ${c.amortYears}-yr amortization, 10-yr balloon — ${fmtMoney(q.proceeds)} back to you.`);
  return { s };
}

export function payDownLoan(state: GameState, assetId: number, loanId: number, amount: number): { s: GameState; err?: string } {
  const s = clone(state);
  const a = s.assets.find(x => x.id === assetId);
  const l = a?.loans.find(x => x.id === loanId);
  if (!a || !l) return { s, err: 'Loan not found.' };
  amount = Math.min(amount, l.balance);
  if (amount <= 0) return { s, err: 'Nothing to pay.' };
  const nearMaturity = l.maturityMonth - s.month <= 12;
  const penalty = nearMaturity ? 0 : amount * 0.02;
  if (s.cash < amount + penalty) return { s, err: `You need ${fmtMoney(amount + penalty)} (${fmtMoney(penalty)} prepayment penalty).` };
  s.cash -= amount + penalty;
  l.balance -= amount;
  a.ledger.push({ m: s.month, amt: -(amount + penalty) });
  if (l.balance <= 100) {
    a.loans = a.loans.filter(x => x.id !== loanId);
    pushNews(s, 'success', `${a.name} is free and clear — loan retired${penalty > 0 ? ` (${fmtMoney(penalty)} penalty)` : ''}.`);
  } else {
    pushNews(s, 'info', `Paid ${fmtMoney(amount)} down on ${a.name}'s loan${penalty > 0 ? ` plus a ${fmtMoney(penalty)} prepayment penalty` : ''}. Payment unchanged; the term just got shorter.`);
  }
  return { s };
}
export function payDownFacility(state: GameState, facilityId: number, amount: number): { s: GameState; err?: string } {
  const s = clone(state);
  const f = s.facilities.find(x => x.id === facilityId);
  if (!f) return { s, err: 'Facility not found.' };
  amount = Math.min(amount, f.balance);
  const penalty = f.maturityMonth - s.month <= 12 ? 0 : amount * 0.02;
  if (s.cash < amount + penalty) return { s, err: `You need ${fmtMoney(amount + penalty)} including the penalty.` };
  s.cash -= amount + penalty;
  f.balance -= amount;
  if (f.balance <= 100) s.facilities = s.facilities.filter(x => x.id !== facilityId);
  else f.monthlyPmt = monthlyPayment(f.balance, f.ratePct, f.amortYears);
  pushNews(s, 'info', `Facility paid down by ${fmtMoney(amount)}${penalty > 0 ? ` (+${fmtMoney(penalty)} penalty)` : ''}.`);
  return { s };
}

// ---------- Credit facility (cross-collateralization) ----------
export function facilityQuote(state: GameState, assetIds: number[]) {
  const assets = state.assets.filter(a => assetIds.includes(a.id));
  const val = assets.reduce((s, a) => s + assetValue(state, a), 0);
  const payoff = assets.reduce((s, a) => s + assetDebt(a), 0);
  const rate = state.econ.rate + CONFIG.facilitySpread;
  const maxLoan = val * 0.65;
  const noiYr = assets.reduce((s, a) => s + assetNOIMonthly(state, a), 0) * 12;
  return { val, payoff, rate, maxLoan, noiYr };
}
export function createFacility(state: GameState, assetIds: number[], amount: number): { s: GameState; err?: string } {
  const s = clone(state);
  if (assetIds.length < 2) return { s, err: 'A facility needs at least two assets — that\'s the "cross" in cross-collateralized.' };
  if (s.econ.crunchMonthsLeft > 0) return { s, err: 'Credit markets are frozen.' };
  const assets = s.assets.filter(a => assetIds.includes(a.id));
  if (assets.length !== assetIds.length) return { s, err: 'Asset missing.' };
  if (assets.some(a => a.mode !== 'operating' || a.occ < 0.75)) return { s, err: 'Every pledged asset must be operating at 75%+ occupancy.' };
  if (assets.some(a => s.facilities.some(f => f.assetIds.includes(a.id)))) return { s, err: 'An asset is already pledged to another facility.' };
  const q = facilityQuote(s, assetIds);
  if (amount > q.maxLoan + 1) return { s, err: `The bank lends up to 65% of pooled value — ${fmtMoney(q.maxLoan)}.` };
  if (amount < q.payoff) return { s, err: 'The facility must clear all existing loans on the pledged assets.' };
  const pmt = monthlyPayment(amount, q.rate, 25);
  if (q.noiYr / (pmt * 12) < CONFIG.minDSCR) return { s, err: `Combined DSCR ${(q.noiYr / (pmt * 12)).toFixed(2)}× is below 1.25×.` };
  for (const a of assets) a.loans = [];
  const f: Facility = { id: s.nextId++, assetIds: [...assetIds], balance: amount, ratePct: q.rate, amortYears: 25, monthlyPmt: pmt, maturityMonth: s.month + CONFIG.loanTermMonths };
  s.facilities.push(f);
  const fee = amount * 0.01;
  s.cash += amount - q.payoff - fee;
  pushNews(s, 'success', `Credit facility closed: ${fmtMoney(amount)} at ${q.rate.toFixed(1)}% against ${assets.length} cross-collateralized assets. Net ${fmtMoney(amount - q.payoff - fee)} to you. One default now touches everything pledged.`);
  return { s };
}

// ---------- LOI / RFP leasing ----------
export function marketRateForAsset(state: GameState, a: Asset): number {
  return assetRentPSF(state, a) * (1 + a.rentStance);
}

function spawnLOIs(s: GameState) {
  const openByAsset = new Map<number, number>();
  for (const l of s.lois) openByAsset.set(l.assetId, (openByAsset.get(l.assetId) ?? 0) + 1);
  for (const a of s.assets) {
    if (a.mode === 'construction' || isAggregate(a.type)) continue;
    const vacant = a.sf - leasedSF(a);
    const su = suiteSF(a);
    if (vacant < Math.min(3000, a.sf * 0.9)) continue;
    if ((openByAsset.get(a.id) ?? 0) >= 2 || s.lois.length >= 5) continue;
    const t = s.tiles[a.tileI];
    const df = tileDemandFactor(s, t, a.type);
    const qf = 0.85 + qGrade(a.quality) * 0.12;
    const rentComp = 1 - a.rentStance * 2.2;
    const boost = a.mode === 'leaseup' ? 1.5 : 1;
    // the pool of tenants who can absorb a huge block is thin — big suites sit
    const sizeDrag = clamp(1.2 - su / 30_000, 0.3, 1);
    const p = clamp(CONFIG.absorbBase[a.type] * 2.1 * df * qf * rentComp * boost * sizeDrag * clamp(vacant / a.sf, 0.25, 1), 0.03, 0.6);
    if (rng(s) > p) continue;
    // big-suite tenants come by LOI/RFP; require a meaningful chunk
    const chunkUnits = Math.max(1, Math.min(Math.round(vacant / su), 1 + Math.floor(rng(s) * Math.max(1, a.units / 2))));
    const sf = Math.min(vacant, Math.round((chunkUnits * su) / 100) * 100);
    if (sf < 800) continue;
    const credit = rollCredit(s, a.quality, t.D);
    const isRFP = rng(s) < 0.3;
    const mkt = assetRentPSF(s, a); // tenant anchors on market, not your stance
    const tight = (s.econ.cityVac[a.type] < 8 ? 1 : 0) + df - 1;
    const loi: LOI = {
      id: s.nextId++, assetId: a.id, kind: isRFP ? 'rfp' : 'loi',
      tenant: tenantName(s, a.type), credit, sf,
      expiresM: s.month + 2, stage: 'open',
    };
    if (!isRFP) {
      loi.rate = Math.round(mkt * rrange(s, 0.88, 1.0 + tight * 0.03) * 100) / 100;
      loi.termY = [3, 5, 5, 7, 10][Math.floor(rng(s) * 5)];
    }
    s.lois.push(loi);
    pushNews(s, 'info', isRFP
      ? `${loi.tenant} (${CREDIT_LABEL[credit]} credit) issued an RFP for ${(sf / 1000).toFixed(1)}K SF at ${a.name} — they want your proposal.`
      : `LOI received: ${loi.tenant} (${CREDIT_LABEL[credit]} credit) offers $${loi.rate!.toFixed(2)}/SF for ${(sf / 1000).toFixed(1)}K SF at ${a.name}, ${loi.termY}-yr term.`);
  }
}

export const TI_PSF: Record<PType, number> = { office: 13, retail: 8, industrial: 2, mixed: 11, multifamily: 0 }; // second-gen space, not ground-up
export function leaseSigningCosts(state: GameState, type: PType, sf: number, rate: number, termY: number, renewal = false): { ti: number; lc: number } {
  const ti = Math.round(sf * TI_PSF[type] * constrCostIdx(state) * Math.min(1, termY / 5) * (renewal ? 0.45 : 1) / 100) * 100;
  const lc = Math.round(sf * rate * Math.min(termY, 5) * 0.045 * (renewal ? 0.5 : 1) / 100) * 100;
  return { ti, lc };
}
function chargeSigningCosts(s: GameState, a: Asset, type: PType, sf: number, rate: number, termY: number, tenant: string, renewal: boolean) {
  const { ti, lc } = leaseSigningCosts(s, type, sf, rate, termY, renewal);
  const total = ti + lc;
  if (total <= 0) return;
  s.cash -= total;
  a.basis += ti;
  a.ledger.push({ m: s.month, amt: -total });
  pushNews(s, 'info', `Signing costs for ${tenant}: ${fmtMoney(ti)} tenant improvements + ${fmtMoney(lc)} leasing commission = ${fmtMoney(total)} out the door. Leases are bought, not found.`);
}

function signLease(s: GameState, a: Asset, loi: LOI, rate: number, termY: number) {
  // space may have shrunk since the LOI arrived — you can't lease the same suite twice
  const vacant = a.sf - leasedSF(a);
  const sfNow = Math.min(loi.sf, Math.floor(vacant / 100) * 100);
  if (sfNow < 400) {
    s.lois = s.lois.filter(x => x.id !== loi.id);
    pushNews(s, 'info', `${loi.tenant} needed space at ${a.name} that's no longer available — the deal died at the finish line.`);
    return;
  }
  if (sfNow < loi.sf) pushNews(s, 'info', `${loi.tenant} downsized their lease to the ${(sfNow / 1000).toFixed(1)}K SF still available at ${a.name}.`);
  chargeSigningCosts(s, a, a.type, sfNow, rate, termY, loi.tenant, false);
  a.tenants.push({
    id: s.nextId++, name: loi.tenant, sf: sfNow, rate: Math.round(rate * 100) / 100,
    startM: s.month, endM: s.month + Math.round(termY * 12), credit: loi.credit,
  });
  recalcOcc(a);
  s.lois = s.lois.filter(x => x.id !== loi.id);
  pushNews(s, 'success', `Lease signed: ${loi.tenant} takes ${(loi.sf / 1000).toFixed(1)}K SF at ${a.name} — $${rate.toFixed(2)}/SF, ${termY} years.`);
  if (a.mode === 'leaseup' && a.occ >= 0.85) {
    a.mode = 'operating';
    pushNews(s, 'success', `${a.name} is stabilized at ${Math.round(a.occ * 100)}% occupancy. Permanent financing is on the table.`);
  }
}

function applyRenewal(s: GameState, a: Asset, loi: LOI, rate: number, termY: number) {
  const tn = a.tenants.find(x => x.id === loi.tenantId);
  s.lois = s.lois.filter(x => x.id !== loi.id);
  if (!tn) return;
  chargeSigningCosts(s, a, a.type, tn.sf, rate, termY, tn.name, true);
  tn.rate = Math.round(rate * 100) / 100;
  tn.startM = s.month; tn.endM = s.month + Math.round(termY * 12);
  pushNews(s, 'success', `Renewed: ${tn.name} stays at ${a.name} — $${tn.rate.toFixed(2)}/SF for ${termY} more years.`);
}

export type LOIAction =
  | { type: 'accept' }
  | { type: 'decline' }
  | { type: 'counter'; rate: number; termY: number }   // for LOIs (and counters)
  | { type: 'propose'; rate: number; termY: number };  // for RFPs

export function respondLOI(state: GameState, loiId: number, action: LOIAction): { s: GameState; outcome: string } {
  const s = clone(state);
  const loi = s.lois.find(x => x.id === loiId);
  if (!loi) return { s, outcome: 'gone' };
  const a = s.assets.find(x => x.id === loi.assetId);
  if (!a) { s.lois = s.lois.filter(x => x.id !== loiId); return { s, outcome: 'gone' }; }
  const mkt = assetRentPSF(s, a);
  const t = s.tiles[a.tileI];
  const tight = clamp((tileDemandFactor(s, t, a.type) - 1) * 0.5 + (8 - s.econ.cityVac[a.type]) * 0.02, -0.3, 0.35);

  if (action.type === 'decline') {
    s.lois = s.lois.filter(x => x.id !== loiId);
    pushNews(s, 'info', `You passed on ${loi.tenant}.`);
    return { s, outcome: 'declined' };
  }
  if (action.type === 'accept') {
    const rate = loi.stage === 'countered' ? (loi.counterRate ?? loi.rate ?? mkt) : (loi.rate ?? mkt);
    const termY = loi.stage === 'countered' ? (loi.counterTermY ?? loi.termY ?? 5) : (loi.termY ?? 5);
    if (loi.kind === 'renewal') { applyRenewal(s, a, loi, rate, termY); return { s, outcome: 'signed' }; }
    signLease(s, a, loi, rate, termY);
    return { s, outcome: 'signed' };
  }
  // counter / propose: tenant decides
  const asked = action.rate;
  const f = asked / mkt; // how aggressive vs market
  const stick = loi.kind === 'renewal' ? 0.12 : 0; // moving is expensive; incumbents bend a little
  const repEdge = (s.reputation - 50) * 0.001;
  const pAccept = clamp(1.62 - f * 1.4 + loi.credit * 0.03 + tight + stick + repEdge + (action.termY >= 7 ? -0.03 : 0), 0.04, 0.95);
  const roll = rng(s);
  if (roll < pAccept) {
    if (loi.kind === 'renewal') { applyRenewal(s, a, loi, asked, action.termY); return { s, outcome: 'signed' }; }
    signLease(s, a, loi, asked, action.termY);
    return { s, outcome: 'signed' };
  }
  const pWalk = clamp(0.22 + (f - 1.0) * 2.4, 0.15, 0.92); // the further past market you push, the faster the door
  if (loi.stage === 'countered' || rng(s) < pWalk) {
    s.lois = s.lois.filter(x => x.id !== loiId);
    if (loi.kind === 'renewal') {
      const tn = a.tenants.find(x => x.id === loi.tenantId);
      if (tn) { a.tenants = a.tenants.filter(x => x.id !== tn.id); chargeMakeReady(s, a, tn.sf); logMigration(s, a, loi.tenant, tn.sf); }
      recalcOcc(a);
      pushNews(s, 'warn', `${loi.tenant} is moving out of ${a.name}. $${asked.toFixed(2)}/SF was more than staying was worth.`);
    } else {
      pushNews(s, 'warn', `${loi.tenant} walked. $${asked.toFixed(2)}/SF was more than the space was worth to them (market is ~$${mkt.toFixed(2)}).`);
    }
    return { s, outcome: 'walked' };
  }
  // they counter back once — final
  loi.stage = 'countered';
  loi.counterRate = Math.round(clamp(mkt * rrange(s, 0.94, 1.0), (loi.rate ?? mkt * 0.9), asked) * 100) / 100;
  loi.counterTermY = action.termY;
  pushNews(s, 'info', `${loi.tenant} countered: $${loi.counterRate.toFixed(2)}/SF, ${loi.counterTermY}-yr term. Final answer — accept or lose them.`);
  return { s, outcome: 'countered' };
}

// ---------- Selling (takes time: list it, field offers, negotiate) ----------
export function listAssetForSale(state: GameState, assetId: number, ask: number): { s: GameState; err?: string } {
  const s = clone(state);
  const a = s.assets.find(x => x.id === assetId);
  if (!a) return { s };
  if (a.mode === 'construction') return { s, err: 'Finish the building first — half-built projects only sell in fire sales.' };
  if (a.forSale) return { s, err: 'Already on the market. Patience.' };
  const lid = s.nextId++;
  a.forSale = { ask: Math.round(ask), sinceM: s.month, listingId: lid };
  s.listings.push({
    id: lid, tileI: a.tileI, kind: 'building', yourSale: true,
    type: a.type, sf: a.sf, units: a.units, occ: a.occ, quality: Math.round(a.quality), age: Math.round(a.age),
    construction: a.construction, acres: a.acres,
    tenants: isAggregate(a.type) ? [] : a.tenants.map(t => ({ ...t })),
    price: Math.round(ask), expiresMonth: s.month + 999, hot: false, listMonth: s.month,
  });
  pushNews(s, 'info', `${a.name} is on the market at ${fmtMoney(ask)}. Now the phone decides.`);
  return { s };
}
export function matchRivalBid(state: GameState, listingId: number): { s: GameState; err?: string } {
  const s = clone(state);
  const l = s.listings.find(x => x.id === listingId);
  if (!l || !(l as any).rivalBid) return { s, err: 'No live rival bid.' };
  l.price = (l as any).rivalBid;
  (l as any).rivalBid = undefined;
  l.expiresMonth = s.month + 2;
  pushNews(s, 'info', `You matched the rival bid at ${fmtMoney(l.price)}. The seller is yours again — at their price.`);
  return { s };
}

export function cancelSale(state: GameState, assetId: number): GameState {
  const s = clone(state);
  const a = s.assets.find(x => x.id === assetId);
  if (!a || !a.forSale) return s;
  s.listings = s.listings.filter(l => l.id !== a.forSale!.listingId);
  s.saleOffers = s.saleOffers.filter(o => o.assetId !== assetId);
  a.forSale = undefined;
  return s;
}

export const TAX = { income: 0.26, capGains: 0.20, recapture: 0.25 };
function settleIncomeTax(s: GameState) {
  const taxable = s.taxYr.noi - s.taxYr.interest - s.taxYr.depr;
  if (taxable > 0) {
    const shelter = Math.min(s.nolCarry, taxable);
    s.nolCarry -= shelter;
    const due = Math.round((taxable - shelter) * TAX.income);
    if (due > 0) {
      s.cash -= due;
      pushNews(s, 'warn', `INCOME TAX: ${fmtMoney(due)} due on ${fmtMoney(Math.round(taxable))} of taxable income (NOI ${fmtMoney(Math.round(s.taxYr.noi))} − interest ${fmtMoney(Math.round(s.taxYr.interest))} − depreciation ${fmtMoney(Math.round(s.taxYr.depr))}${shelter > 0 ? ` − NOL ${fmtMoney(Math.round(shelter))}` : ''}). Depreciation is the only friend you have in this letter.`);
    } else if (shelter > 0) {
      pushNews(s, 'info', `Tax season: loss carryforwards sheltered all ${fmtMoney(Math.round(taxable))} of taxable income. ${fmtMoney(Math.round(s.nolCarry))} of NOLs remain.`);
    }
  } else if (taxable < -1000) {
    s.nolCarry += -taxable;
    pushNews(s, 'info', `Tax season: paper loss of ${fmtMoney(Math.round(-taxable))} (thank you, depreciation) — banked as a carryforward. NOLs now ${fmtMoney(Math.round(s.nolCarry))}.`);
  }
  s.taxYr = { noi: 0, interest: 0, depr: 0 };
}

// 1031: the government will wait — if you redeploy every dollar on the clock
function saleTaxes(_s: GameState, a: Asset, gross: number): { gain: number; tax: number } {
  const costs = gross * CONFIG.saleCostPct;
  const adjBasis = Math.max(0, a.basis - (a.deprTaken ?? 0));
  const gain = gross - costs - adjBasis;
  if (gain <= 0) return { gain, tax: 0 };
  const recap = Math.min(a.deprTaken ?? 0, gain);
  return { gain, tax: Math.round(recap * TAX.recapture + (gain - recap) * TAX.capGains) };
}

// Outside capital: an LP funds 70% of the equity for an 8% pref; you keep 30% of cash flow
// and earn a 20% promote on their profits at exit. Access requires a reputation — and keeping it.
export const JV_MIN_EQUITY = 1_200_000;
export function canJV(state: GameState, equityNeeded: number): { ok: boolean; why?: string } {
  if ((state.jvLockedUntil ?? 0) > state.month) return { ok: false, why: `Institutional capital remembers ${monthName(state.jvLockedUntil!)} — no partners until then.` };
  if (state.reputation < 35) return { ok: false, why: 'Partners need a track record. Get your reputation above 35.' };
  if (equityNeeded < JV_MIN_EQUITY) return { ok: false, why: `Below ${fmtMoney(JV_MIN_EQUITY)} of equity, funds won't return your calls — too small to underwrite.` };
  return { ok: true };
}
function attachJV(s: GameState, a: Asset, totalEquity: number) {
  const lpPct = 0.70;
  a.jv = { lpPct, lpContrib: Math.round(totalEquity * lpPct), accPref: 0, since: s.month };
  pushNews(s, 'deal', `JV closed on ${a.name}: your partner wired ${fmtMoney(a.jv.lpContrib)} (70% of equity) for an 8% pref. You run the deal; they read the reports.`);
}

function tickSaleOffers(s: GameState) {
  for (const o of [...s.saleOffers]) {
    if (o.expiresM <= s.month) {
      s.saleOffers = s.saleOffers.filter(x => x !== o);
      pushNews(s, 'info', `${o.buyer}'s ${fmtMoney(o.amount)} offer expired unanswered.`);
    }
  }
  // unsolicited approaches: at the right point in the cycle, capital comes looking for YOU
  for (const a of s.assets) {
    if (a.forSale || a.mode === 'construction') continue;
    if (s.saleOffers.some(o => o.assetId === a.id)) continue;
    const pCold = (s.econ.phase === 'peak' ? 0.02 : 0.007) + ((s.econ.capInflowMonthsLeft ?? 0) > 0 ? 0.02 : 0) + (s.reputation - 50) * 0.0001;
    if (rng(s) < clamp(pCold, 0, 0.05)) {
      const val = assetValue(s, a);
      const fitFirms = s.firms.filter(f => f.alive && (
        (f.style === 'industrial' && a.type === 'industrial') || (f.style === 'mf' && a.type === 'multifamily') ||
        (f.style === 'core' && a.quality > 55) || f.style === 'aggressive' || f.style === 'value-add' && a.quality < 50));
      const buyer = fitFirms.length ? rpick(s, fitFirms).name : 'A family office';
      const rich = s.econ.phase === 'peak' || (s.econ.capInflowMonthsLeft ?? 0) > 0;
      const amount = roundPrice(val * rrange(s, rich ? 0.96 : 0.88, rich ? 1.14 : 1.04));
      s.saleOffers.push({ id: s.nextId++, assetId: a.id, amount, buyer, ceiling: roundPrice(amount * rrange(s, 1.0, 1.08)), expiresM: s.month + 2 });
      pushNews(s, 'event', `UNSOLICITED: ${buyer} called about ${a.name} — ${fmtMoney(amount)}, no listing, no process. ${amount > val ? 'Above your own appraisal. Someone wants it more than you do.' : 'Below your number, but cash is cash.'}`);
    }
  }
  for (const a of s.assets) {
    if (!a.forSale) continue;
    if (s.saleOffers.filter(o => o.assetId === a.id).length >= 2) continue;
    const val = assetValue(s, a);
    const askRatio = a.forSale.ask / Math.max(1, val);
    const phase = s.econ.phase;
    let p = 0.28 + (phase === 'peak' ? 0.18 : phase === 'recession' ? -0.12 : 0)
      + clamp((1 - askRatio) * 0.5, -0.12, 0.2)
      + (s.reputation - 50) * 0.002
      + Math.min(0.1, (s.month - a.forSale.sinceM) * 0.015);
    if (rng(s) < clamp(p, 0.05, 0.65)) {
      // offers come in anywhere from 50% to ~100% of value (a hair over at the peak)
      // your appraisal marks to the market cap rate; buyers want a spread above it,
      // so most offers land below appraisal — full price is a peak-market gift
      const hi = phase === 'peak' ? 1.05 : 1.0;
      const amount = roundPrice(val * (0.62 + Math.pow(rng(s), 0.7) * (hi - 0.62)));
      const buyerPool = [...s.firms.filter(f => f.alive).map(f => f.name), 'A family office', 'A 1031 exchange buyer', 'A private syndicate'];
      const o: SaleOffer = {
        id: s.nextId++, assetId: a.id, amount, buyer: rpick(s, buyerPool),
        ceiling: roundPrice(amount * rrange(s, 1.0, 1.12)),
        expiresM: s.month + 2,
      };
      s.saleOffers.push(o);
      pushNews(s, 'event', `OFFER: ${o.buyer} bid ${fmtMoney(amount)} for ${a.name} (${Math.round((amount / Math.max(1, val)) * 100)}% of your appraisal).`);
    }
  }
}

export function respondSaleOffer(state: GameState, offerId: number, action: { type: 'accept' } | { type: 'decline' } | { type: 'counter'; amount: number }): { s: GameState; pm?: PostMortem; outcome: string } {
  const s = clone(state);
  const o = s.saleOffers.find(x => x.id === offerId);
  if (!o) return { s, outcome: 'gone' };
  const a = s.assets.find(x => x.id === o.assetId);
  if (!a) { s.saleOffers = s.saleOffers.filter(x => x.id !== offerId); return { s, outcome: 'gone' }; }
  if (action.type === 'decline') {
    s.saleOffers = s.saleOffers.filter(x => x.id !== offerId);
    return { s, outcome: 'declined' };
  }
  if (action.type === 'accept') {
    const r = finalizeSale(s, a, o.amount, o.buyer);
    return { s: r.s, pm: r.pm, outcome: 'sold' };
  }
  // counter
  if (action.amount <= o.ceiling) {
    const r = finalizeSale(s, a, action.amount, o.buyer);
    return { s: r.s, pm: r.pm, outcome: 'sold' };
  }
  if (o.countered || rng(s) < 0.45) {
    s.saleOffers = s.saleOffers.filter(x => x.id !== offerId);
    pushNews(s, 'warn', `${o.buyer} walked away from ${a.name}. Your ${fmtMoney(action.amount)} counter was past their ceiling.`);
    return { s, outcome: 'walked' };
  }
  o.countered = true;
  o.amount = o.ceiling;
  pushNews(s, 'info', `${o.buyer} came back at ${fmtMoney(o.ceiling)} — best and final.`);
  return { s, outcome: 'countered' };
}

// ---------- Selling ----------
export function sellQuote(state: GameState, a: Asset) {
  const val = assetValue(state, a);
  const sentiment = state.econ.phase === 'peak' ? 1.04 : state.econ.phase === 'recession' ? 0.94 : 1;
  const gross = val * sentiment;
  const costs = gross * CONFIG.saleCostPct;
  const payoff = assetDebt(a);
  const facRelease = facilityShare(state, a) * 1.05; // release price: allocated share + 5%
  const net = gross - costs - payoff - facRelease;
  return { gross, costs, payoff, facRelease, net, sentiment };
}
export function doSell(state: GameState, assetId: number): { s: GameState; pm?: PostMortem; err?: string } {
  const s = clone(state); const a = s.assets.find(x => x.id === assetId);
  if (!a) return { s };
  if (a.mode === 'construction') return { s, err: 'Finish the building first — half-built projects only sell in fire sales.' };
  return finalizeSale(s, a, sellQuote(s, a).gross, 'the market');
}

function finalizeSale(s: GameState, a: Asset, gross: number, buyer: string): { s: GameState; pm?: PostMortem } {
  const q = { gross, costs: gross * CONFIG.saleCostPct, payoff: assetDebt(a), facRelease: facilityShare(s, a) * 1.05, net: 0, sentiment: 1 };
  q.net = q.gross - q.costs - q.payoff - q.facRelease;
  if (a.forSale) { s.listings = s.listings.filter(l => l.id !== a.forSale!.listingId); }
  s.saleOffers = s.saleOffers.filter(o => o.assetId !== a.id);
  logComp(s, { m: s.month, type: a.type, sf: a.sf, price: gross, capPct: gross > 0 ? Math.round((assetNOIMonthly(s, a) * 12 / gross) * 10000) / 100 : null, tileI: a.tileI, buyer });
  // facility release
  for (const f of s.facilities) {
    if (!f.assetIds.includes(a.id)) continue;
    const allocated = facilityShare(s, a);
    f.balance = Math.max(0, f.balance - allocated);
    f.assetIds = f.assetIds.filter(id => id !== a.id);
    f.monthlyPmt = f.balance > 0 ? monthlyPayment(f.balance, f.ratePct, f.amortYears) : 0;
    if (f.assetIds.length === 0 || f.balance <= 0) s.facilities = s.facilities.filter(x => x !== f);
  }
  s.cash += q.net;
  a.ledger.push({ m: s.month, amt: q.net });
  const irr = irrFromFlows(a.ledger);
  const equityIn = -a.ledger.filter(f => f.amt < 0).reduce((x, f) => x + f.amt, 0);
  const distributions = a.ledger.filter(f => f.amt > 0).reduce((x, f) => x + f.amt, 0);
  const profit = distributions - equityIn;
  const t = s.tiles[a.tileI];
  const noiNow = stabilizedNOI(s, a);
  const capNow = capRatePct(s, t, a.type, a.quality);
  const entryNOI = a.entryNOI || noiNow * 0.8;
  const noiPart = entryNOI > 0 ? noiNow / (a.entryCap / 100) - entryNOI / (a.entryCap / 100) : q.gross - a.basis;
  const capPart = noiNow / (capNow / 100) - noiNow / (a.entryCap / 100);
  const opsPart = a.cumCF;
  const pm: PostMortem = {
    assetName: a.name, profit, irr,
    parts: [
      { label: 'Income growth', amt: noiPart, note: entryNOI > 0 ? `NOI moved ${fmtMoney(entryNOI)} → ${fmtMoney(noiNow)}/yr — your leasing, rents, and quality work.` : 'Value created by building to a yield above the market cap rate.' },
      { label: 'Cap-rate shift', amt: capPart, note: `Market cap rate moved ${a.entryCap.toFixed(1)}% → ${capNow.toFixed(1)}%. ${capPart >= 0 ? 'Rates and neighborhood momentum worked for you — partly luck.' : 'Rising rates or a weakening location worked against you.'}` },
      { label: 'Operating cash flow', amt: opsPart, note: 'Rent collected minus expenses and debt service while you held it.' },
      { label: 'Transaction & carry costs', amt: profit - noiPart - capPart - opsPart, note: 'Closing costs, financing costs, overruns, and rounding.' },
    ],
    lesson: capPart > Math.abs(noiPart) && capPart > 0
      ? 'Most of this return came from the market re-pricing, not the building. Enjoy it — but don\'t confuse a bull market with skill.'
      : profit < 0
        ? (s.econ.phase === 'recession' ? 'Selling into a recession locks in the market\'s worst price. If debt service is covered, holding is usually the better trade.' : 'The basis was too high for what the location could support. The profit is made on the buy.')
        : 'Income growth drove this one — the repeatable kind of profit.',
  };
  s.totalRealizedProfit += profit;
  s.reputation = clamp(s.reputation + (profit > 0 ? 3 : -2), 0, 100);
  // the LP gets paid before you do
  if (a.jv) {
    const owed = a.jv.lpContrib + a.jv.accPref;
    const lpBase = Math.min(Math.max(0, q.net), owed);
    const residual = Math.max(0, q.net - lpBase);
    const lpResidual = residual * a.jv.lpPct * (1 - 0.20); // your 20% promote comes out of their profit share
    const lpTotal = Math.round(lpBase + lpResidual);
    s.cash -= lpTotal;
    if (q.net < owed) {
      s.reputation = clamp(s.reputation - 8, 0, 100);
      s.jvLockedUntil = s.month + 36;
      pushNews(s, 'warn', `Your partner took a loss on ${a.name}: ${fmtMoney(lpTotal)} back on ${fmtMoney(a.jv.lpContrib)} invested. That phone number won't answer for a few years.`);
    } else {
      pushNews(s, 'info', `JV waterfall on ${a.name}: partner received ${fmtMoney(lpTotal)} (capital + pref + share). Your promote is inside what's left.`);
    }
  }
  const tx = saleTaxes(s, a, q.gross);
  if (tx.tax > 5000 && !a.jv && s.prefer1031 && !s.exchange) {
    s.exchange = { deferred: tx.tax, mustSpend: Math.round(Math.max(0, q.net) * 0.95), deadlineM: s.month + 6, fromName: a.name };
    pushNews(s, 'event', `1031 CLOCK STARTED: ${fmtMoney(tx.tax)} of tax on the ${a.name} sale is deferred IF you close on a replacement building for at least ${fmtMoney(s.exchange.mustSpend)} by ${monthName(s.month + 6)}. Miss the window and the bill lands.`);
  } else if (tx.tax > 0) {
    s.cash -= tx.tax;
    pushNews(s, 'warn', `Sale taxes on ${a.name}: ${fmtMoney(tx.tax)} (depreciation recapture + capital gains). ${!a.jv && !s.prefer1031 ? 'A 1031 election (Debt tab) would have deferred this.' : ''}`);
  }
  s.stock.push({
    id: s.nextId++, tileI: a.tileI, type: a.type, sf: a.sf, units: a.units,
    px: a.px, py: a.py, pw: a.pw, ph: a.ph, cells: a.cells ? [...a.cells] : undefined,
    quality: Math.round(a.quality), age: Math.round(a.age), construction: a.construction,
    occ: Math.round(a.occ * 100) / 100, owner: 'private',
  });
  s.assets = s.assets.filter(x => x.id !== a.id);
  s.lois = s.lois.filter(x => x.assetId !== a.id);
  pushNews(s, profit >= 0 ? 'success' : 'warn', `Sold ${a.name} to ${buyer} for ${fmtMoney(q.gross)} — ${profit >= 0 ? 'profit' : 'loss'} of ${fmtMoney(Math.abs(profit))}${irr !== null ? ` (${irr.toFixed(1)}% IRR)` : ''}.`);
  return { s, pm };
}

// ---------- Monthly tick ----------
export function advanceMonth(state: GameState): GameState {
  const s = clone(state);
  if (s.gameOver || s.pending.length > 0) return s;
  s.month++;
  s.forcedSaleNotice = undefined;
  tickEconomy(s);
  tickTiles(s);
  tickStock(s);
  tickConstruction(s);
  tickEvents(s);
  tickListings(s);
  tickFirms(s);
  let cf = 0;
  for (const a of [...s.assets]) cf += tickAsset(s, a);
  cf += tickFacilities(s);
  tickSaleOffers(s);
  spawnLOIs(s);
  if (s.autoLease) autoResolveLOIs(s);
  s.lois = s.lois.filter(l => {
    const a = s.assets.find(x => x.id === l.assetId);
    if (!a || a.sf - leasedSF(a) < 500) return false;
    return l.expiresM > s.month || (pushExpire(s, l), false);
  });
  if (s.exchange && s.exchange.deadlineM <= s.month) {
    s.cash -= s.exchange.deferred;
    pushNews(s, 'warn', `1031 WINDOW MISSED: the ${fmtMoney(s.exchange.deferred)} tax bill from ${s.exchange.fromName} is due today. The IRS does not do extensions for indecision.`);
    s.exchange = undefined;
  }
  if (s.month % 12 === 11) settleIncomeTax(s);
  s.approachesLeft = 5; // a fresh month, a fresh call sheet
  s.lastMonthCF = cf;
  s.cash += cf;
  tickSolvency(s);
  tickTier(s);
  recordHistory(s);
  return s;
}
export function makeReadyCost(state: GameState, sf: number): number {
  return Math.round(sf * (4.0 + 2.2) * constrCostIdx(state) / 100) * 100;
}
function logMigration(s: GameState, a: Asset, tenant: string, sf: number) {
  const dests = s.stock.filter(b => !b.buildLeft && b.type === a.type && b.tileI !== a.tileI && b.occ < 0.93 && b.sf > sf);
  if (!dests.length) return;
  dests.sort((x, y) => (tileDemandFactor(s, s.tiles[y.tileI], y.type) + (1 - y.occ)) - (tileDemandFactor(s, s.tiles[x.tileI], x.type) + (1 - x.occ)));
  const d = rpick(s, dests.slice(0, 6));
  d.occ = Math.min(0.97, d.occ + sf / d.sf);
  s.migrations.unshift({ m: s.month, tenant, fromTileI: a.tileI, toTileI: d.tileI, sf });
  if (s.migrations.length > 12) s.migrations.pop();
  pushNews(s, 'info', `${tenant} relocated to block ${blockLabel(s.tiles[d.tileI])} — ${(sf / 1000).toFixed(1)}K SF of your rent roll now pays someone else's mortgage.`, d.tileI);
}

function chargeMakeReady(s: GameState, a: Asset, sf: number) {
  if (a.type !== 'industrial' || sf <= 0) return;
  const cost = Math.round(sf * rrange(s, 3.5, 6.5) * constrCostIdx(s) / 100) * 100;
  s.cash -= cost;
  a.ledger.push({ m: s.month, amt: -cost });
  pushNews(s, 'warn', `Make-ready at ${a.name}: ${(sf / 1000).toFixed(1)}K SF of vacated shell needs ${fmtMoney(cost)} of demising, dock repair, and slab work before it can show.`);
}

// Your leasing agent runs the negotiations: solid but unimaginative — signs market-clearing
// deals, holds the line on lowballs, and never squeezes the last nickel you might have.
function autoResolveLOIs(s: GameState) {
  for (const loi of [...s.lois]) {
    const a = s.assets.find(x => x.id === loi.assetId);
    if (!a) continue;
    const mkt = assetRentPSF(s, a);
    const their = loi.stage === 'countered' ? (loi.counterRate ?? loi.rate ?? mkt) : (loi.rate ?? 0);
    let r: { s: GameState; outcome: string };
    if (loi.kind === 'renewal') {
      r = respondLOI(s, loi.id, their >= mkt * 0.86 ? { type: 'accept' } : { type: 'counter', rate: Math.round(mkt * 0.94 * 100) / 100, termY: loi.termY ?? 5 });
    } else if (loi.kind === 'rfp') {
      r = respondLOI(s, loi.id, { type: 'propose', rate: Math.round(mkt * 0.985 * 100) / 100, termY: 5 });
    } else if (loi.stage === 'countered' || their >= mkt * 0.94) {
      r = respondLOI(s, loi.id, { type: 'accept' });
    } else if (their >= mkt * 0.78) {
      r = respondLOI(s, loi.id, { type: 'counter', rate: Math.round(mkt * 0.97 * 100) / 100, termY: loi.termY ?? 5 });
    } else {
      r = respondLOI(s, loi.id, { type: 'decline' });
    }
    Object.assign(s, r.s); // respondLOI clones; fold the result back
    if (r.outcome === 'signed') pushNews(s, 'info', `Your leasing agent closed ${loi.tenant} — standard terms, no drama, commission earned.`);
  }
}

function pushExpire(s: GameState, l: LOI) {
  const a = s.assets.find(x => x.id === l.assetId);
  if (l.kind === 'renewal' && a) {
    const tn = a.tenants.find(x => x.id === l.tenantId);
    a.tenants = a.tenants.filter(x => x.id !== l.tenantId);
    if (tn) chargeMakeReady(s, a, tn.sf);
    recalcOcc(a);
    pushNews(s, 'warn', `${l.tenant} left ${a.name} — their renewal proposal expired unanswered. Silence is an answer too.`);
    return;
  }
  pushNews(s, 'info', `${l.tenant} moved on — their ${l.kind.toUpperCase()} at ${(a?.name ?? 'your property')} expired unanswered.`);
}

export function cityPopulation(s: GameState): number {
  return Math.round(s.tiles.reduce((t2, t) => t2 + (t.water ? 0 : t.pop), 0) * 152);
}
function recordHistory(s: GameState) {
  s.nwHistory.push({ m: s.month, nw: netWorth(s), cash: s.cash, cf: s.lastMonthCF });
  const occSF = { office: 0, retail: 0, industrial: 0, mixed: 0, multifamily: 0 } as Record<PType, number>;
  const totSF = { office: 0, retail: 0, industrial: 0, mixed: 0, multifamily: 0 } as Record<PType, number>;
  for (const b of s.stock) { occSF[b.type] += b.sf * b.occ; totSF[b.type] += b.sf; }
  for (const a of s.assets) { if (a.mode !== 'construction') { occSF[a.type] += a.sf * a.occ; totSF[a.type] += a.sf; } }
  s.econHistory.push({
    m: s.month, rate: s.econ.rate, infl: s.econ.inflation, emp: s.econ.empIdx, conf: s.econ.confidence,
    phase: s.econ.phase, ri: { ...s.econ.rentIdx },
    ci: constrCostIdx(s), occSF, totSF, pop: cityPopulation(s),
  });
  if (s.nwHistory.length > 520) s.nwHistory.shift();
  if (s.econHistory.length > 520) s.econHistory.shift();
}

const PHASE_DWELL: Record<Phase, number> = { recovery: 18, expansion: 36, peak: 12, recession: 14 };
const PHASE_NEXT: Record<Phase, Phase> = { recovery: 'expansion', expansion: 'peak', peak: 'recession', recession: 'recovery' };
const PHASE_TARGET: Record<Phase, { rate: number; infl: number; emp: number; conf: number }> = {
  recovery: { rate: 3.6, infl: 1.8, emp: 100, conf: 55 },
  expansion: { rate: 5.2, infl: 2.7, emp: 106, conf: 72 },
  peak: { rate: 6.8, infl: 3.7, emp: 108, conf: 82 },
  recession: { rate: 3.8, infl: 1.0, emp: 92, conf: 32 },
};

function tickEconomy(s: GameState) {
  const e = s.econ;
  e.phaseAge++;
  if (rng(s) < 1 / PHASE_DWELL[e.phase] && e.phaseAge > PHASE_DWELL[e.phase] * 0.5) {
    e.phase = PHASE_NEXT[e.phase]; e.phaseAge = 0;
    const msg: Record<Phase, string> = {
      recovery: 'The recession has bottomed. Rates are low, sellers are tired — recoveries are when fortunes are planted.',
      expansion: 'The expansion is broadening: hiring is up, tenants are growing, and money is getting braver.',
      peak: 'The market feels unstoppable. That is usually the tell. Everything you deliver from here lands late-cycle.',
      recession: 'The cycle has turned: layoffs, falling confidence, and lenders remembering what risk is.',
    };
    pushNews(s, 'event', msg[e.phase]);
    if (e.phase === 'recession' && !e.hadCrunch && rng(s) < 0.5) {
      e.hadCrunch = true; e.crunchMonthsLeft = 12;
      pushNews(s, 'event', 'CREDIT CRUNCH: banks are pulling back. LTVs cut 10 points, refinancing frozen for ~12 months. Leverage is about to be graded.');
    }
  }
  const t = PHASE_TARGET[e.phase];
  e.rate = clamp(e.rate + (t.rate - e.rate) * 0.10 + (rng(s) - 0.5) * 0.15, 2.0, 9.5);
  e.rateSmooth += (e.rate - e.rateSmooth) * 0.15;
  e.inflation = clamp(e.inflation + (t.infl - e.inflation) * 0.10 + (rng(s) - 0.5) * 0.2, 0, 8);
  e.empIdx = clamp(e.empIdx + (t.emp - e.empIdx) * 0.07 + (rng(s) - 0.5) * 0.5, 80, 115);
  e.confidence = clamp(e.confidence + (t.conf - e.confidence) * 0.09 + (rng(s) - 0.5) * 2.5, 10, 95);
  e.popGrowth = clamp(0.4 + (e.confidence / 100) * 1.4 + (rng(s) - 0.5) * 0.2, -0.3, 2.4);
  e.costIdx *= 1 + (e.inflation * 0.5) / 100 / 12;
  // construction has its own weather: bid climate swings with the cycle and its own momentum
  if (e.constrCycle === undefined) e.constrCycle = 1;
  const cyclePull = e.phase === 'peak' ? 0.0022 : e.phase === 'expansion' ? 0.0012 : e.phase === 'recession' ? -0.0028 : -0.0006;
  e.constrCycle = clamp(e.constrCycle * (1 + cyclePull + (rng(s) - 0.5) * 0.008) + (1 - e.constrCycle) * 0.01, 0.85, 1.22);
  if (e.crunchMonthsLeft > 0) e.crunchMonthsLeft--;
  if (e.tariffMonthsLeft > 0) e.tariffMonthsLeft--;
  if ((e.insSpikeMonthsLeft ?? 0) > 0) e.insSpikeMonthsLeft!--;
  if ((e.capInflowMonthsLeft ?? 0) > 0) e.capInflowMonthsLeft!--;
  if ((e.wfhMonthsLeft ?? 0) > 0) e.wfhMonthsLeft!--;
  if (e.ecomMonthsLeft > 0) e.ecomMonthsLeft--;
  for (const ty of PTYPES) {
    let demandDrift = 0;
    if (ty === 'office') demandDrift = 0.04 + (e.empIdx - 99) * 0.014;
    if (ty === 'retail') demandDrift = 0.03 + (e.confidence - 52) * 0.004 + e.popGrowth * 0.04 - (e.ecomMonthsLeft > 0 ? 0.10 : 0);
    if (ty === 'industrial') demandDrift = 0.045 + (e.ecomMonthsLeft > 0 ? 0.08 : 0) + (e.empIdx - 100) * 0.005;
    if (ty === 'mixed') demandDrift = 0.026 + (e.empIdx - 100) * 0.006 + (e.confidence - 55) * 0.002 + e.popGrowth * 0.03;
    if (ty === 'multifamily') demandDrift = 0.05 + e.popGrowth * 0.05 + (e.confidence - 55) * 0.0012;
    const eqVac = ty === 'industrial' ? 6 : ty === 'retail' ? 8.5 : ty === 'multifamily' ? 6.5 : 10.5;
    const phaseAppetite = e.phase === 'peak' ? 1.7 : e.phase === 'expansion' ? 1.25 : e.phase === 'recovery' ? 0.7 : 0.25;
    const ambientSupply = 0.06 * phaseAppetite * clamp(eqVac / e.cityVac[ty], 0.3, 2.0);
    const reversion = (eqVac - e.cityVac[ty]) * 0.015;
    e.cityVac[ty] = clamp(e.cityVac[ty] + ambientSupply - demandDrift + reversion + (rng(s) - 0.5) * 0.15, 2.5, 30);
    const growth = (eqVac - e.cityVac[ty]) * 0.0014 + (e.inflation / 100) * 0.22 / 12; // rents follow supply/demand, only loosely CPI
    e.rentIdx[ty] = clamp(e.rentIdx[ty] * (1 + growth), 0.5, 4.5);
  }
}

function tickStock(s: GameState) {
  if (s.month % 3 !== 0) return;
  for (const b of s.stock) {
    if (b.buildLeft) continue;  // not standing yet
    if (b.listedId) continue; // frozen while marketed — the flyer photos are already printed
    const t = s.tiles[b.tileI];
    const tOcc = targetOcc(s, t, b.type) * (0.88 + qGrade(b.quality) * 0.05);
    b.occ = clamp(b.occ + (tOcc - b.occ) * 0.18 + (rng(s) - 0.5) * 0.05, 0.15, 0.97);
    b.occ = Math.round(b.occ * 100) / 100;
    b.quality = clamp(b.quality - 0.3 + (rng(s) < 0.04 ? 12 : 0), 12, 92); // slow decay; occasional owner renovation
    b.age += 0.25;
  }
}

// ---------- The neighborhood mix ----------
// What makes a corner of the city genuinely desirable is the blend within walking
// distance: jobs (office), people living there (multifamily), and the retail that
// serves both. A geometric mean scores the balance — an office monoculture with no
// housing or shops is dead at night and scores near zero; piling more of what a
// district already has doesn't help it. Quantity matters with diminishing returns,
// and the quality of the standing product weights the whole thing. Industrial is
// its own world: it pays via indSuit, but a heavy industrial presence damps the mix.
export function computeMix(s: GameState): number[] {
  const W = CONFIG.GRID_W, H = CONFIG.GRID_H;
  const n = s.tiles.length;
  const jobs = new Array(n).fill(0), res = new Array(n).fill(0), amen = new Array(n).fill(0), ind = new Array(n).fill(0);
  const qSum = new Array(n).fill(0), qSF = new Array(n).fill(0);
  const add = (tileI: number, type: PType, sf: number, occ: number, quality: number) => {
    const o = sf * occ;
    if (type === 'office') jobs[tileI] += o;
    else if (type === 'multifamily') res[tileI] += o;
    else if (type === 'retail') amen[tileI] += o;
    else if (type === 'mixed') { jobs[tileI] += o * 0.35; res[tileI] += o * 0.5; amen[tileI] += o * 0.15; }
    else ind[tileI] += o;
    qSum[tileI] += quality * sf; qSF[tileI] += sf;
  };
  for (const b of s.stock) if (!b.buildLeft) add(b.tileI, b.type, b.sf, b.occ, b.quality);
  for (const a of s.assets) if (a.mode !== 'construction') add(a.tileI, a.type, a.sf, a.occ, a.quality);
  const out = new Array(n).fill(0);
  for (const t of s.tiles) {
    if (t.water) continue;
    let J = 0, R = 0, A = 0, I = 0, qs = 0, qn = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const x = t.x + dx, y = t.y + dy;
      if (x < 0 || x >= W || y < 0 || y >= H) continue;
      const ring = Math.max(Math.abs(dx), Math.abs(dy));
      const w = ring === 0 ? 1 : ring === 1 ? 0.45 : 0.18;
      const i = y * W + x;
      J += jobs[i] * w; R += res[i] * w; A += amen[i] * w; I += ind[i] * w;
      qs += qSum[i] * w; qn += qSF[i] * w;
    }
    const TOT = J + R + A;
    if (TOT <= 0) continue;
    const balance = 3 * Math.cbrt((J / TOT) * (R / TOT) * (A / TOT)); // 1 in proportion, ~0 when anything is missing
    const scale = clamp(Math.log1p(TOT / 120_000) / Math.log1p(15), 0, 1); // diminishing returns on sheer bulk
    const q = qn > 0 ? qs / qn : 50;
    const qf = 0.80 + 0.5 * (q / 100); // Class C drags a district, Class A lifts it
    const indShare = I / (TOT + I);
    out[t.i] = 34 * balance * scale * qf * (1 - 0.45 * indShare);
  }
  return out;
}

// Occupied residential and job space per tile (with a taste of the adjacent blocks) —
// the raw material for where people live and work.
const RES_K = 1 / 12_000;  // pop index points per occupied residential SF
const JOB_K = 1 / 9_000;   // emp index points per occupied job SF
export function demandSources(s: GameState): { resSrc: number[]; jobSrc: number[] } {
  const W = CONFIG.GRID_W, H = CONFIG.GRID_H;
  const n = s.tiles.length;
  const offO = new Array(n).fill(0), mixO = new Array(n).fill(0), mfO = new Array(n).fill(0), indO = new Array(n).fill(0);
  const tally = (tileI: number, type: PType, sf: number, occ: number) => {
    const o = sf * occ;
    if (type === 'office') offO[tileI] += o;
    else if (type === 'mixed') mixO[tileI] += o;
    else if (type === 'multifamily') mfO[tileI] += o;
    else if (type === 'industrial') indO[tileI] += o;
  };
  for (const b of s.stock) if (!b.buildLeft) tally(b.tileI, b.type, b.sf, b.occ);
  for (const a of s.assets) if (a.mode !== 'construction') tally(a.tileI, a.type, a.sf, a.occ);
  const resLocal = s.tiles.map(t => mfO[t.i] + 0.5 * mixO[t.i]);
  const jobLocal = s.tiles.map(t => offO[t.i] + 0.45 * mixO[t.i] + 0.15 * indO[t.i]);
  const smear = (src: number[]) => s.tiles.map(t => {
    let ring = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const x = t.x + dx, y = t.y + dy;
      if (x >= 0 && x < W && y >= 0 && y < H) ring += src[y * W + x];
    }
    return src[t.i] + 0.2 * ring;
  });
  return { resSrc: smear(resLocal), jobSrc: smear(jobLocal) };
}

function tickTiles(s: GameState) {
  if (s.month % 3 !== 0) return;
  const mix = computeMix(s);
  // The demand side is people: residents follow the housing that's actually occupied,
  // jobs follow the business space that's actually occupied — on top of a per-block
  // anchor for everything the model doesn't track. Build it (and lease it) and they
  // come; let it empty out and they leave.
  const { resSrc, jobSrc } = demandSources(s);
  for (const t of s.tiles) {
    if (t.water) continue;
    const target = clamp(t.baseD + mix[t.i], 5, 98);
    t.D = clamp(t.D + (target - t.D) * 0.10, 5, 98);
    const popTarget = clamp(t.popBase + RES_K * resSrc[t.i], 5, 100);
    const empTarget = clamp((t.empBase + JOB_K * jobSrc[t.i]) * (s.econ.empIdx / 100), 3, 100);
    t.pop = clamp(t.pop + (popTarget - t.pop) * 0.10, 5, 100);
    t.emp = clamp(t.emp + (empTarget - t.emp) * 0.10, 3, 100);
    t.income = clamp(t.income + ((0.55 + (t.D / 100) * 0.95) - t.income) * 0.05, 0.5, 1.75);
    t.crime = clamp(t.crime + ((68 - 0.58 * t.D) - t.crime) * 0.05, 3, 85);
  }
}

function tickEvents(s: GameState) {
  for (const ef of [...s.effects]) {
    ef.monthsLeft--;
    for (const ti of ef.tiles) {
      const t = s.tiles[ti];
      if (ef.dPerMonth) { t.baseD = clamp(t.baseD + ef.dPerMonth, 0, 98); t.D = clamp(t.D + ef.dPerMonth, 5, 98); }
      if (ef.empPerMonth) t.emp = clamp(t.emp + ef.empPerMonth, 3, 100);
    }
    if (ef.monthsLeft <= 0) s.effects = s.effects.filter(x => x !== ef);
  }
  for (const ev of [...s.scheduledEvents]) {
    if (ev.m !== s.month) continue;
    s.scheduledEvents = s.scheduledEvents.filter(x => x !== ev);
    fireEvent(s, ev.kind, ev.payload);
  }
  // operating-asset surprises: the building calls, and it's never good news
  if (rng(s) < 0.055 && s.pending.length === 0) {
    const ops = s.assets.filter(a => a.mode !== 'construction');
    if (ops.length > 0) {
      const a = rpick(s, ops);
      // a roof and its rooftop units last ~20 years; new construction doesn't fail
      const roofEligible = a.age >= 20;
      const hasAnchor = !isAggregate(a.type) && a.tenants.length > 0;
      const pool: string[] = ['reassess'];
      if (roofEligible) pool.push('roof', 'roof');
      if (hasAnchor) pool.push('tiDemand');
      s.pending.push({ type: 'assetEvent', assetId: a.id, eventKind: rpick(s, pool) });
    }
  }
  if (rng(s) < 0.16) {
    const pool = ['transit', 'employer', 'tariff', 'ecom', 'rateshock', 'insSpike', 'capInflow', 'wfh'];
    const kind = rpick(s, pool);
    if (kind === 'transit' && s.effects.some(e => e.kind === 'transit')) return;
    if (kind === 'tariff' && s.econ.tariffMonthsLeft > 0) return;
    if (kind === 'ecom' && s.econ.ecomMonthsLeft > 0) return;
    if (kind === 'insSpike' && (s.econ.insSpikeMonthsLeft ?? 0) > 0) return;
    if (kind === 'capInflow' && (s.econ.capInflowMonthsLeft ?? 0) > 0) return;
    if (kind === 'wfh' && (s.econ.wfhMonthsLeft ?? 0) > 0) return;
    const lead = 2 + Math.floor(rng(s) * 3);
    let payload: number | undefined;
    const rumors: Record<string, string> = {
      transit: 'RUMOR: The transit authority is quietly surveying a new rapid line out of the core. Land along the route would re-price.',
      employer: 'RUMOR: A large employer is scouting Meridian City for a regional campus. Wherever it lands, office demand follows.',
      tariff: 'RUMOR: Trade negotiators are stuck. Contractors are warning about material costs if tariffs land.',
      ecom: 'RUMOR: Retailers report weakening foot traffic as online share grows. Warehouse brokers are smiling.',
      rateshock: 'RUMOR: The central bank is signaling a sharp policy move. Lock rates if you believe them.',
      insSpike: 'RUMOR: Two regional carriers are pulling out of the market after storm losses. Property insurance renewals could get ugly.',
      capInflow: 'RUMOR: Coastal pension money is said to be circling Meridian City. If it lands, everything trades richer.',
      wfh: 'RUMOR: Three of the city\'s largest employers are piloting permanent remote work. Office landlords are pretending not to hear it.',
    };
    if (kind === 'employer') {
      const cands = s.tiles.filter(t => !t.water && t.D > 30 && t.D < 70);
      payload = rpick(s, cands).i;
    }
    pushNews(s, 'rumor', rumors[kind]);
    s.scheduledEvents.push({ m: s.month + lead, kind, payload });
  }
}

function fireEvent(s: GameState, kind: string, payload?: number) {
  if (kind === 'transit') {
    s.effects.push({ kind: 'transit', monthsLeft: 14, tiles: s.transitCorridor, dPerMonth: 0.9 });
    pushNews(s, 'event', 'TRANSIT LINE APPROVED: a new rapid line will run through the highlighted corridor. Desirability along the route will climb for the next year.');
  } else if (kind === 'employer') {
    const ti = payload ?? rpick(s, s.tiles.filter(t => !t.water)).i;
    const t = s.tiles[ti];
    const area = s.tiles.filter(x => !x.water && Math.abs(x.x - t.x) <= 1 && Math.abs(x.y - t.y) <= 1).map(x => x.i);
    s.effects.push({ kind: 'employer', monthsLeft: 10, tiles: area, empPerMonth: 1.4, dPerMonth: 0.4 });
    pushNews(s, 'event', 'MAJOR EMPLOYER ARRIVES: a regional campus is coming to the city grid — office and mixed-use demand near the site will strengthen.');
  } else if (kind === 'tariff') {
    s.econ.tariffMonthsLeft = 18;
    pushNews(s, 'event', 'MATERIAL TARIFFS: hard construction costs up ~8% for the next 18 months. Projects already underway feel it too.');
  } else if (kind === 'ecom') {
    s.econ.ecomMonthsLeft = 24;
    pushNews(s, 'event', 'E-COMMERCE SQUEEZE: retail demand softens citywide for ~2 years; industrial and logistics demand strengthens.');
  } else if (kind === 'insSpike') {
    s.econ.insSpikeMonthsLeft = 18;
    pushNews(s, 'event', 'INSURANCE CRISIS: carriers reprice the whole market. Property insurance runs ~45% higher for the next 18 months — a static cost you can\'t occupancy your way out of.');
  } else if (kind === 'capInflow') {
    s.econ.capInflowMonthsLeft = 15;
    pushNews(s, 'event', 'CAPITAL INFLOW: institutional money floods Meridian City. Cap rates compress ~35 bps citywide for about a year — sellers rejoice, buyers grind their teeth.');
  } else if (kind === 'wfh') {
    s.econ.wfhMonthsLeft = 24;
    pushNews(s, 'event', 'REMOTE-WORK WAVE: major employers cut their footprints. Office demand weakens citywide for ~2 years. The best buildings will hold; the rest will negotiate.');
  } else if (kind === 'roofBill') {
    const a = s.assets.find(x => x.id === payload);
    if (a && a.age >= 20) {
      const bill = Math.round(a.sf * rrange(s, 4.5, 7) * s.econ.costIdx / 1000) * 1000;
      s.cash -= bill; a.ledger.push({ m: s.month, amt: -bill });
      a.quality = clamp(a.quality - 4, 10, 95);
      pushNews(s, 'warn', `${a.name}: the patched roof failed in a storm — emergency replacement, ${fmtMoney(bill)}. The cheap fix sends its regards.`);
    }
  } else if (kind === 'rateshock') {
    const up = rng(s) < 0.6;
    s.econ.rate = clamp(s.econ.rate + (up ? 1.5 : -1.5), 2.0, 9.5);
    pushNews(s, 'event', up ? 'RATE SHOCK: the base rate jumps 150 bps. New debt is pricier and cap rates will drift up — values down.' : 'SURPRISE CUT: the base rate drops 150 bps. Financing is cheap; cap rates will compress — values up.');
  }
}

function tickListings(s: GameState) {
  for (const l of s.listings) {
    if (l.expiresMonth <= s.month) {
      if (l.stockId) {
        const b = s.stock.find(x => x.id === l.stockId);
        if (b) b.listedId = undefined;
      }
      if (l.agreed && !l.yourSale) {
        if ((l as any).rivalBid) {
          const b2 = l.stockId ? s.stock.find(x => x.id === l.stockId) : undefined;
          if (b2) { b2.owner = s.firms.find(f => f.name === (l as any).rivalName)?.short ?? b2.owner; b2.listedId = undefined; }
          logComp(s, { m: s.month, type: l.type!, sf: l.sf ?? 0, price: (l as any).rivalBid, capPct: null, tileI: l.tileI, buyer: (l as any).rivalName ?? 'A rival' });
          pushNews(s, 'warn', `You lost the bidding war: ${(l as any).rivalName} closed at ${fmtMoney((l as any).rivalBid)}. Second place in real estate is a story you tell at bars.`);
        } else {
          s.reputation = clamp(s.reputation - 2, 0, 100);
          pushNews(s, 'warn', 'A seller you had under agreement watched you fail to close. That story travels faster than your good ones.');
        }
      }
    } else if (l.agreed && !l.yourSale && l.kind !== 'offmarket' && !(l as any).rivalBid && rng(s) < 0.14) {
      // someone saw the flyer come down and decided they want it more
      const rival = rpick(s, s.firms.filter(f => f.alive));
      (l as any).rivalBid = roundPrice(l.price * rrange(s, 1.03, 1.09));
      (l as any).rivalName = rival.name;
      l.expiresMonth = Math.min(l.expiresMonth, s.month + 1);
      pushNews(s, 'event', `BIDDING WAR: ${rival.name} just offered ${fmtMoney((l as any).rivalBid)} on the ${((l.sf ?? 0) / 1000).toFixed(0)}K SF ${PLABEL[l.type!]} you have under agreement. Match it this month or the seller walks to them.`);
    } else if (l.kind === 'building' && !l.agreed && (l.listMonth ?? s.month) <= s.month - 3 && rng(s) < 0.2) {
      // fatigue: the longer it sits, the softer the seller
      l.price = roundPrice(l.price * rrange(s, 0.965, 0.99));
      if (rng(s) < 0.25) pushNews(s, 'info', `Price reduced on the ${((l.sf ?? 0) / 1000).toFixed(0)}K SF ${PLABEL[l.type!]} listing — the seller is getting realistic.`);
    }
  }
  s.listings = s.listings.filter(l => l.expiresMonth > s.month);
  const pStarter = s.econ.phase === 'recovery' ? 0.35 : s.econ.phase === 'expansion' ? 0.15 : 0.06;
  while (s.listings.filter(l => l.kind !== 'offmarket').length < 7 && rng(s) < 0.8) spawnListing(s, rng(s) < pStarter);
  for (const l of s.listings) {
    if (l.kind === 'building' && rng(s) < 0.15) l.price = Math.round(l.price * (0.99 + rng(s) * 0.02));
  }
}

// Rivals don't just shop the board — they put shovels in the ground.
function firmDevelops(s: GameState, f: Firm) {
  const want: PType = f.style === 'industrial' ? 'industrial' : f.style === 'mf' ? 'multifamily'
    : f.style === 'core' ? (rng(s) < 0.5 ? 'office' : 'retail')
      : f.style === 'value-add' ? 'retail' : rpick(s, PTYPES);
  const cands = s.tiles.filter(t => !t.water && freeParcelCount(s, t.i) >= 3 && tileDemandFactor(s, t, want) > 1.02
    && oversupplyPenalty(t, want) < 0.06);
  if (!cands.length) return;
  cands.sort((a, b) => tileDemandFactor(s, b, want) - tileDemandFactor(s, a, want));
  const t = rpick(s, cands.slice(0, 8));
  const need = 3 + Math.floor(rng(s) * 5);
  const spot = findFreeRect(s, t.i, need, () => rng(s));
  if (!spot) return;
  const acres = spot.pw * spot.ph * PARCEL_AC;
  const sf = Math.round(acres * 43_560 * FAR[want] * rrange(s, 0.6, 0.95) / 1000) * 1000;
  if (sf < 6000) return;
  const months = Math.min(26, Math.max(6, Math.round(4 + sf / 7000)));
  const quality = clamp(rrange(s, 52, 88), 30, 92);
  s.stock.push({
    id: s.nextId++, tileI: t.i, type: want, sf,
    px: spot.px, py: spot.py, pw: spot.pw, ph: spot.ph,
    units: genUnitsFor(s, want, sf), quality, age: 0,
    construction: CONSTR[want][Math.min(CONSTR[want].length - 1, 2 - qGrade(quality))].id,
    occ: 0, owner: f.short, buildLeft: months, buildTotal: months, builder: f.short,
  });
  pushNews(s, 'event', `${f.name} broke ground on ${(sf / 1000).toFixed(0)}K SF of ${PLABEL[want].toLowerCase()} at block ${blockLabel(t)} — delivering in ~${months} months. Competing supply is easier to see than to stop.`, t.i);
}

export function blockLabel(t: Tile): string { return `${String.fromCharCode(65 + t.x)}-${t.y + 1}`; }

function tickConstruction(s: GameState) {
  for (const b of s.stock) {
    if (!b.buildLeft) continue;
    b.buildLeft--;
    if (b.buildLeft <= 0) {
      b.buildLeft = undefined;
      const t = s.tiles[b.tileI];
      t.supply[b.type] += b.sf;
      b.occ = 0.05;
      const f = s.firms.find(x => x.short === b.builder);
      pushNews(s, 'event', `DELIVERED: ${(b.sf / 1000).toFixed(0)}K SF of ${PLABEL[b.type].toLowerCase()} at block ${blockLabel(t)}${f ? ` by ${f.name}` : ''}. New supply is competing for your tenants today.`, b.tileI);
      b.builder = undefined;
    }
  }
}

function tickFirms(s: GameState) {
  if (s.month % 3 !== 0) return;
  for (const f of s.firms) {
    if (!f.alive) continue;
    f.netWorth *= 1 + (s.econ.phase === 'recession' ? -0.012 : 0.008) * (f.style === 'aggressive' ? 2.2 : 1) + (rng(s) - 0.5) * 0.01;
    if (rng(s) < 0.035 && f.netWorth > 8_000_000) firmDevelops(s, f);
    if (rng(s) > 0.35) continue; // ten firms can't all be buying every quarter
    const fit = (l: Listing): number => {
      if (l.kind === 'offmarket' || l.yourSale || l.parentAssetId) return 0; // your leads and your land are yours; your sale listings handled separately
      const t = s.tiles[l.tileI];
      if (f.style === 'industrial') return (l.kind === 'building' && l.type === 'industrial') || (l.kind === 'land' && t.indSuit > 55) ? 0.5 : 0.02;
      if (f.style === 'core') return l.kind === 'building' && !l.distressed && t.D > 60 ? 0.45 : 0.03;
      if (f.style === 'value-add') return l.kind === 'building' && (l.distressed || (l.quality ?? 60) < 42) ? 0.55 : 0.05;
      if (f.style === 'mf') return l.kind === 'building' && l.type === 'multifamily' ? 0.55 : (l.kind === 'land' && t.pop > 45 ? 0.2 : 0.03);
      return l.kind === 'land' ? (s.econ.phase === 'peak' || s.econ.phase === 'expansion' ? 0.5 : 0.15) : 0.12;
    };
    const scored = s.listings.map(l => ({ l, p: fit(l) })).sort((a, b) => b.p - a.p);
    if (scored.length && rng(s) < scored[0].p) {
      const l = scored[0].l;
      const t = s.tiles[l.tileI];
      if (l.kind === 'land') {
        const ty: PType = t.indSuit > 55 ? 'industrial' : f.style === 'core' ? 'office' : rng(s) < 0.5 ? 'retail' : 'mixed';
        const cells = l.parcelCells ?? (l.parcel ? footprintCells(l.parcel) : null);
        const acres = l.acres ?? (cells ? cells.length * PARCEL_AC : 1);
        const sf = Math.round(acres * 43_560 * FAR[ty] * rrange(s, 0.55, 0.9) / 1000) * 1000;
        if (cells && cells.length && sf >= 4000) {
          const months = Math.min(26, Math.max(6, Math.round(4 + sf / 7000)));
          const quality = clamp(rrange(s, 45, 85), 30, 92);
          s.stock.push({
            id: s.nextId++, tileI: l.tileI, type: ty, sf, cells: [...cells],
            units: genUnitsFor(s, ty, sf), quality, age: 0,
            construction: CONSTR[ty][Math.min(CONSTR[ty].length - 1, 2 - qGrade(quality))].id,
            occ: 0, owner: f.short, buildLeft: months, buildTotal: months, builder: f.short,
          });
          pushNews(s, 'deal', `${f.name} bought the ${l.acres}-acre parcel you may have been watching — ${(sf / 1000).toFixed(0)}K SF of ${PLABEL[ty].toLowerCase()} breaks ground there this month.`, l.tileI);
        } else {
          pushNews(s, 'deal', `${f.name} bought the ${l.acres}-acre parcel you may have been watching. For now they're sitting on the dirt.`, l.tileI);
        }
      } else {
        const b = l.stockId ? s.stock.find(x => x.id === l.stockId) : undefined;
        if (b) { b.owner = f.short; b.listedId = undefined; }
        logComp(s, { m: s.month, type: l.type!, sf: l.sf ?? 0, price: l.price, capPct: l.price > 0 ? Math.round((inPlaceNOIYr(s, l) / l.price) * 10000) / 100 : null, tileI: l.tileI, buyer: f.short });
        pushNews(s, 'deal', `${f.name} acquired a ${((l.sf ?? 0) / 1000).toFixed(0)}K SF ${PLABEL[l.type!]} building for ${fmtMoney(l.price)}.`);
      }
      s.listings = s.listings.filter(x => x.id !== l.id);
    }
    if (f.style === 'aggressive' && s.econ.crunchMonthsLeft > 6 && rng(s) < 0.25) {
      f.alive = false;
      pushNews(s, 'event', `${f.name} HAS COLLAPSED. Its lenders are liquidating its actual holdings — fire-sale prices, real buildings.`);
      const held = s.stock.filter(b => b.owner === f.short && !b.listedId && !b.buildLeft);
      const toSell = held.length ? held.slice(0, 3) : s.stock.filter(b => !b.listedId && !b.buildLeft).slice(0, 2);
      for (const b of toSell) {
        b.occ = Math.min(b.occ, clamp(b.occ * rrange(s, 0.7, 0.9), 0.3, 0.62)); // tenants fled the drama
        listStockBuilding(s, b, { distressed: true, priceMult: rrange(s, 0.66, 0.78), hot: true, expiresMonth: s.month + 4 });
      }
    }
  }
}

function tickFacilities(s: GameState): number {
  let cf = 0;
  for (const f of [...s.facilities]) {
    const i = f.balance * (f.ratePct / 100 / 12);
    f.balance = Math.max(0, f.balance - (f.monthlyPmt - i));
    cf -= f.monthlyPmt;
    if (f.maturityMonth <= s.month && f.balance > 1000) {
      f.ratePct = s.econ.rate + CONFIG.facilitySpread;
      f.monthlyPmt = monthlyPayment(f.balance, f.ratePct, f.amortYears);
      f.maturityMonth = s.month + CONFIG.loanTermMonths;
      pushNews(s, 'warn', `Your credit facility matured and rolled at ${f.ratePct.toFixed(1)}% — payment now ${fmtMoney(f.monthlyPmt)}/mo.`);
    }
    if (f.balance <= 0) s.facilities = s.facilities.filter(x => x !== f);
  }
  return cf;
}

function tickAsset(s: GameState, a: Asset): number {
  const t = s.tiles[a.tileI];
  if (a.renovMonthsLeft) {
    a.renovMonthsLeft--;
    if (a.renovMonthsLeft === 0) {
      a.quality = clamp(a.quality + 30, 0, a.qCap);
      pushNews(s, 'success', `${a.name}: renovation complete — building steps up to a ${QLABEL[qGrade(a.quality)]} grade. Rents and renewals follow.`);
    }
  }
  if (a.mode === 'construction' && a.project) {
    const p = a.project;
    if (p.stage === 'permitting') {
      p.monthsLeft--;
      if (p.monthsLeft <= 0) { p.stage = 'building'; p.monthsLeft = p.totalMonths; pushNews(s, 'info', `${a.name}: permits in hand. Construction begins.`); }
      return 0;
    }
    p.monthsBuilt++;
    const ev = p.events.find(e => !e.resolved && e.month === p.monthsBuilt);
    if (ev) {
      ev.resolved = true;
      if (ev.kind === 'ahead') { p.monthsLeft = Math.max(1, p.monthsLeft - 1); pushNews(s, 'success', `${a.name}: your premium contractor is a month ahead of schedule.`); }
      else if (ev.kind === 'weather') { p.monthsLeft += 1; pushNews(s, 'info', `${a.name}: a storm month — insurance covers damage, schedule slips 1 month.`); }
      else if (ev.kind === 'soils') {
        const amt = p.hardBudget * (0.05 + rng(s) * 0.05);
        const fromCont = Math.min(p.contingencyLeft, amt); p.contingencyLeft -= fromCont; const over = amt - fromCont;
        if (over > 0) { s.cash -= over; a.ledger.push({ m: s.month, amt: -over }); }
        p.spent += amt;
        pushNews(s, over > 0 ? 'warn' : 'info', `${a.name}: structural surprise cost ${fmtMoney(amt)}${over > 0 ? ` — ${fmtMoney(over)} beyond contingency came from your cash` : ', covered by contingency'}.`);
      }
      else { s.pending.push({ type: 'constrEvent', assetId: a.id, eventKind: ev.kind }); }
    }
    const monthlyHard = (p.hardBudget + p.softBudget) / p.totalMonths;
    p.spent += monthlyHard;
    const loan = a.loans[0];
    const commitment = (a as any).loanCommitment ?? 0;
    const draw = Math.min(monthlyHard, Math.max(0, commitment - p.drawnSoFar));
    p.drawnSoFar += draw; loan.balance += draw;
    const interest = loan.balance * (loan.ratePct / 100 / 12);
    loan.balance += interest;
    p.monthsLeft--;
    if (p.monthsLeft <= 0) {
      a.mode = 'leaseup';
      // construction loan flips to 12 months IO then amortizes if not refinanced
      loan.ioMonthsLeft = 12;
      loan.monthlyPmt = monthlyPayment(loan.balance, loan.ratePct, loan.amortYears);
      if (p.contingencyLeft > 0) {
        s.cash += p.contingencyLeft * 0.5;
        a.ledger.push({ m: s.month, amt: p.contingencyLeft * 0.5 });
        pushNews(s, 'success', `${a.name} delivered. Unused contingency returns ${fmtMoney(p.contingencyLeft * 0.5)} to you. Now: lease it up — LOIs will start arriving.`);
      } else {
        pushNews(s, 'success', `${a.name} delivered. Now: lease it up before the interest clock wins.`);
      }
      if ((a as any).converting) {
        t.supply.office = Math.max(0, t.supply.office - a.sf);
        a.type = 'multifamily';
        a.units = Math.max(8, Math.round(a.sf / 900));
        a.construction = 'midrise';
        a.quality = clamp(a.quality + 14, 20, constrSpec({ type: 'multifamily', construction: 'midrise' }).qCap);
        a.qCap = constrSpec(a).qCap;
        a.name = a.name.replace(/Tower|Exchange|Works|Commons/, 'Flats');
        (a as any).converting = undefined;
        pushNews(s, 'success', `CONVERSION DELIVERED: ${a.name} reopens as ${a.units} apartments. Office supply shrinks; the rent roll starts from zero — but renters move faster than tenants ever did.`);
      }
      a.entryNOI = stabilizedNOI(s, a);
      a.entryCap = capRatePct(s, t, a.type, a.quality);
      t.supply[a.type] += a.sf;
      a.project = undefined;
    }
    return 0;
  }
  // ---- tenant dynamics ----
  const mkt = assetRentPSF(s, a);
  if (isAggregate(a.type)) {
    // multifamily runs on aggregate occupancy: renters churn fast and re-lease fast
    const df = tileDemandFactor(s, t, a.type);
    const qf = 0.85 + qGrade(a.quality) * 0.12;
    const rentComp = 1 - a.rentStance * 2.2;
    const tOcc = targetOcc(s, t, a.type);
    const churn = (a.maint === 'low' ? 0.034 : a.maint === 'high' ? 0.019 : 0.025);
    const boost = a.mode === 'leaseup' ? 1.7 : 1;
    const sizeDragMF = clamp(1.12 - a.sf / 300_000, 0.6, 1);
    const gain = CONFIG.absorbBase[a.type] * 0.75 * df * qf * clamp(rentComp, 0.4, 1.6) * boost * sizeDragMF * Math.max(0, tOcc * 1.03 - a.occ);
    a.occ = clamp(a.occ - churn * a.occ + gain + (rng(s) - 0.5) * 0.006, 0.05, 0.98);
    if (a.mode === 'leaseup' && a.occ >= 0.85) {
      a.mode = 'operating';
      pushNews(s, 'success', `${a.name} is stabilized at ${Math.round(a.occ * 100)}% occupancy. Permanent financing is now on the table.`);
    }
  }
  // ambient small-suite leasing (spaces too small to negotiate individually)
  const su = suiteSF(a);
  if (!isAggregate(a.type) && su < 4000) {
    const vacant = a.sf - leasedSF(a);
    if (vacant >= su * 0.8) {
      const df = tileDemandFactor(s, t, a.type);
      const rentComp = 1 - a.rentStance * 2.2;
      const qf = 0.85 + qGrade(a.quality) * 0.12;
      const boost = a.mode === 'leaseup' ? 1.6 : 1;
      const p = clamp(CONFIG.absorbBase[a.type] * 3.4 * df * qf * rentComp * boost * clamp(vacant / a.sf, 0.2, 1), 0.03, 0.85);
      if (rng(s) < p) {
        const sf = Math.min(vacant, Math.round(su / 100) * 100);
        a.tenants.push({
          id: s.nextId++, name: tenantName(s, a.type), sf,
          rate: Math.round(mkt * (1 + a.rentStance) * rrange(s, 0.97, 1.03) * 100) / 100,
          startM: s.month, endM: s.month + Math.round(rrange(s, 24, 60)), credit: rollCredit(s, a.quality, t.D),
        });
      }
    }
  }
  // annual escalations: 3% bumps written into every lease — the quiet compounding that pays for buildings
  for (const tn of a.tenants) {
    const age = s.month - tn.startM;
    if (age > 0 && age % 12 === 0 && tn.endM > s.month) {
      tn.rate = Math.round(tn.rate * 1.03 * 100) / 100;
    }
  }
  // expirations & renewals — significant tenants come back as a renewal proposal you negotiate
  for (const tn of [...a.tenants]) {
    if (tn.endM > s.month) continue;
    const under = tn.rate < mkt * 0.97;
    if (tn.sf >= 4000 && !s.lois.some(x => x.kind === 'renewal' && x.tenantId === tn.id)) {
      const wants = clamp((under ? 0.85 : 0.62)
        + (a.maint === 'high' ? 0.08 : a.maint === 'low' ? -0.16 : 0)
        + qGrade(a.quality) * 0.04, 0.15, 0.95);
      if (rng(s) < wants) {
        tn.endM = s.month + 3; // holds over while you talk
        const ask = Math.round(Math.min(mkt * 0.985, Math.max(tn.rate * 0.97, tn.rate * rrange(s, 0.98, 1.06))) * 100) / 100;
        s.lois.push({
          id: s.nextId++, assetId: a.id, kind: 'renewal', tenantId: tn.id,
          tenant: tn.name, credit: tn.credit, sf: tn.sf,
          rate: ask, termY: [3, 3, 5, 5, 7][Math.floor(rng(s) * 5)],
          expiresM: s.month + 2, stage: 'open',
        });
        pushNews(s, 'info', `Renewal proposal: ${tn.name} wants to stay at ${a.name} — offering $${ask.toFixed(2)}/SF. Their lease is up; the ball is yours.`);
      } else {
        a.tenants = a.tenants.filter(x => x.id !== tn.id);
        chargeMakeReady(s, a, tn.sf);
        logMigration(s, a, tn.name, tn.sf);
        pushNews(s, 'info', `${tn.name} did not renew at ${a.name} — ${(tn.sf / 1000).toFixed(1)}K SF back on the market.`);
      }
      continue;
    }
    // small suites renew quietly
    let pRenew = (under ? 0.78 : 0.52)
      + (a.maint === 'high' ? 0.10 : a.maint === 'low' ? -0.16 : 0)
      + qGrade(a.quality) * 0.04;
    if (rng(s) < clamp(pRenew, 0.1, 0.92)) {
      tn.rate = Math.round(Math.min(mkt * (1 + a.rentStance), tn.rate * 1.12) * 100) / 100;
      tn.startM = s.month; tn.endM = s.month + Math.round(rrange(s, 36, 72));
    } else {
      a.tenants = a.tenants.filter(x => x.id !== tn.id);
      chargeMakeReady(s, a, tn.sf);
      pushNews(s, 'info', `${tn.name} did not renew at ${a.name} — ${(tn.sf / 1000).toFixed(1)}K SF back on the market.`);
    }
  }
  // defaults by credit (worse in recessions)
  const recMult = s.econ.phase === 'recession' ? 2.6 : 1;
  for (const tn of isAggregate(a.type) ? [] : [...a.tenants]) {
    const p = [0.006, 0.002, 0.0006][tn.credit] * recMult;
    if (rng(s) < p) {
      a.tenants = a.tenants.filter(x => x.id !== tn.id);
      chargeMakeReady(s, a, tn.sf);
      pushNews(s, 'warn', `${tn.name} (${CREDIT_LABEL[tn.credit]} credit) defaulted at ${a.name}. ${(tn.sf / 1000).toFixed(1)}K SF goes dark; the rent stops today.`);
    }
  }
  recalcOcc(a);
  if (a.mode === 'leaseup' && a.occ >= 0.85) {
    a.mode = 'operating';
    pushNews(s, 'success', `${a.name} is stabilized at ${Math.round(a.occ * 100)}% occupancy. Permanent financing is now on the table.`);
  }
  // quality drift
  a.quality = clamp(a.quality - 0.12 + (a.maint === 'high' ? 0.10 : a.maint === 'low' ? -0.18 : 0), 5, a.qCap);
  a.age += 1 / 12;
  // cash flow
  let noi = assetNOIMonthly(s, a);
  const ds = assetDebtService(a);
  for (const l of a.loans) {
    if (l.ioMonthsLeft > 0) { l.ioMonthsLeft--; }
    else if (l.monthlyPmt > 0) {
      const i = l.balance * (l.ratePct / 100 / 12);
      l.balance = Math.max(0, l.balance - (l.monthlyPmt - i));
    }
    // covenant test: slip below 1.10x and the lender traps your cash until coverage heals.
    // Bridge and low-leverage loans carry no covenant; everyone gets a 12-month holiday.
    if (s.month % 3 === 0 && (l as any).covenant && s.month - a.acqMonth > 12 && l.kind !== 'constr' && l.monthlyPmt > 0 && l.ioMonthsLeft <= 0) {
      const dscrNow = loanMonthlyDS(l) > 0 ? noi / loanMonthlyDS(l) : 9;
      if (!(l as any).sweep && dscrNow < 1.10) {
        (l as any).sweep = true;
        pushNews(s, 'warn', `COVENANT BREACH at ${a.name}: DSCR ${dscrNow.toFixed(2)}× tripped the 1.10× test. The lender is sweeping all property cash flow to principal until coverage recovers.`);
      } else if ((l as any).sweep && dscrNow >= 1.25) {
        (l as any).sweep = false;
        pushNews(s, 'success', `${a.name}: DSCR back to ${dscrNow.toFixed(2)}× — the cash sweep is released. Your distributions resume.`);
      }
    }
    if (l.maturityMonth <= s.month && l.balance > 1000) {
      l.ratePct = s.econ.rate + (l.kind === 'constr' ? CONFIG.constrSpread : CONFIG.refiSpread);
      l.amortYears = Math.min(l.amortYears, 25);
      l.monthlyPmt = monthlyPayment(l.balance, l.ratePct, l.amortYears);
      l.ioMonthsLeft = 0;
      l.maturityMonth = s.month + CONFIG.loanTermMonths;
      pushNews(s, 'warn', `${a.name}: loan ballooned and rolled at today's ${l.ratePct.toFixed(1)}% — payment is now ${fmtMoney(l.monthlyPmt)}/mo.`);
    }
  }
  // tax accounting: what the IRS sees is not what your bank account sees
  s.taxYr.noi += noi;
  for (const l of a.loans) s.taxYr.interest += l.balance * (l.ratePct / 100 / 12);
  if (a.deprBasis && a.mode !== 'construction') {
    const life = a.type === 'multifamily' ? 27.5 : 39;
    const d = a.deprBasis / life / 12;
    s.taxYr.depr += d;
    a.deprTaken = (a.deprTaken ?? 0) + d;
  }
  const swept = a.loans.some(l => (l as any).sweep);
  if (swept && noi - ds > 0) {
    const sweepAmt = noi - ds;
    const sl = a.loans.find(l => (l as any).sweep)!;
    sl.balance = Math.max(0, sl.balance - sweepAmt);
    noi = ds; // your distribution this month is zero; the lender ate it
  }
  const jvShare = a.jv ? a.jv.lpPct : 0;
  if (a.jv) {
    a.jv.accPref += a.jv.lpContrib * 0.08 / 12;
    const lpDist = Math.max(0, noi - ds) * jvShare;
    a.jv.accPref = Math.max(0, a.jv.accPref - lpDist);
  }
  const cf = (noi - ds) * (1 - jvShare); // your share; the LP's slice never touches your account
  a.cumCF += cf;
  a.ledger.push({ m: s.month, amt: cf });
  if (a.ledger.length > 400) {
    const head = a.ledger.slice(0, 2);
    const rest = a.ledger.slice(2);
    const merged: CFEntry[] = [];
    for (let i = 0; i < rest.length; i += 2) {
      if (i + 1 < rest.length) merged.push({ m: rest[i + 1].m, amt: rest[i].amt + rest[i + 1].amt });
      else merged.push(rest[i]);
    }
    a.ledger = [...head, ...merged];
  }
  a.negCFStreak = cf < 0 ? a.negCFStreak + 1 : 0;
  return cf;
}

function tickSolvency(s: GameState) {
  if (s.cash < 0) s.negCashStreak++; else s.negCashStreak = 0;
  if (s.negCashStreak >= 3) {
    const sellable = s.assets.filter(a => a.mode !== 'construction');
    if (sellable.length > 0) {
      const worst = sellable.sort((a, b) => (assetNOIMonthly(s, a) - assetDebtService(a)) - (assetNOIMonthly(s, b) - assetDebtService(b)))[0];
      const q = sellQuote(s, worst);
      const net = q.gross * 0.85 - q.costs - q.payoff - q.facRelease;
      for (const f of s.facilities) {
        if (!f.assetIds.includes(worst.id)) continue;
        const allocated = facilityShare(s, worst);
        f.balance = Math.max(0, f.balance - allocated);
        f.assetIds = f.assetIds.filter(id => id !== worst.id);
        f.monthlyPmt = f.balance > 0 ? monthlyPayment(f.balance, f.ratePct, f.amortYears) : 0;
        if (f.assetIds.length === 0 || f.balance <= 0) s.facilities = s.facilities.filter(x => x !== f);
      }
      if (worst.forSale) { s.listings = s.listings.filter(l => l.id !== worst.forSale!.listingId); }
      s.saleOffers = s.saleOffers.filter(o => o.assetId !== worst.id);
      s.cash += net;
      worst.ledger.push({ m: s.month, amt: net });
      s.stock.push({
        id: s.nextId++, tileI: worst.tileI, type: worst.type, sf: worst.sf, units: worst.units,
        px: worst.px, py: worst.py, pw: worst.pw, ph: worst.ph,
        quality: Math.round(worst.quality), age: Math.round(worst.age), construction: worst.construction,
        occ: Math.round(worst.occ * 100) / 100, owner: 'private',
      });
      s.assets = s.assets.filter(x => x.id !== worst.id);
      s.lois = s.lois.filter(x => x.assetId !== worst.id);
      s.negCashStreak = 0;
      s.reputation = clamp(s.reputation - 8, 0, 100);
      s.forcedSaleNotice = `Your bank forced the sale of ${worst.name} at a 15% haircut to cover three months of negative cash. Net ${fmtMoney(net)} after payoff.`;
      pushNews(s, 'warn', s.forcedSaleNotice);
    }
  }
  if (netWorth(s) < 0 || (s.cash < -200_000 && s.assets.length === 0)) {
    s.gameOver = true;
    s.gameOverReason = 'Equity wiped out. Leverage cuts both ways — the debt outlived the values.';
  }
}

function tickTier(s: GameState) {
  const nw = netWorth(s);
  for (let ti = CONFIG.tiers.length - 1; ti > s.tier; ti--) {
    if (nw >= CONFIG.tiers[ti].nw) {
      s.tier = ti;
      pushNews(s, 'event', `TIER UP — you are now a ${CONFIG.tiers[ti].name}. Projects up to ${CONFIG.tiers[ti].maxSF / 1000}K SF unlocked${ti === 1 ? ', and mixed-use development is now on the menu' : ''}.`);
      break;
    }
  }
}

// ---------- Pro formas ----------
export function proFormaLand(state: GameState, l: Listing, c: DevChoice) {
  const t = state.tiles[l.tileI];
  const bd = devCostBreakdown(state, c, l.price);
  const probe = { tileI: l.tileI, type: c.type, sf: c.sf, units: c.units, construction: c.construction, quality: bd.spec.q };
  const scenarios = [
    { name: 'Bear', rentMult: 0.88, vacAdd: 6 },
    { name: 'Base', rentMult: 1.0, vacAdd: 0 },
    { name: 'Bull', rentMult: 1.1, vacAdd: -2 },
  ].map(sc => {
    const rent = assetRentPSF(state, probe as any) * sc.rentMult;
    const occ = clamp(targetOcc(state, t, c.type) - sc.vacAdd / 100, 0.3, 0.97);
    const potM = (c.sf * rent) / 12;
    const egiM = potM * occ;
    const ex = expenseBreakdown(state, { ...probe, maint: 'std', tenants: [] } as any, potM, egiM);
    const noi = (egiM - ex.total) * 12;
    const yoc = (noi / bd.total) * 100;
    return { ...sc, noi, yoc };
  });
  const cap = capRatePct(state, t, c.type, bd.spec.q);
  const baseNOI = scenarios[1].noi;
  const stabilizedValue = baseNOI / (cap / 100);
  const profit = stabilizedValue - bd.total;
  return { bd, scenarios, cap, stabilizedValue, profit, spread: scenarios[1].yoc - cap };
}

export function proFormaBuilding(state: GameState, l: Listing) {
  const t = state.tiles[l.tileI];
  const probe = { tileI: l.tileI, type: l.type!, sf: l.sf!, quality: l.quality!, units: l.units ?? 1, construction: l.construction ?? CONSTR[l.type!][0].id };
  const noiStab = stabilizedNOI(state, probe as any);
  const cap = capRatePct(state, t, l.type!, l.quality!);
  const noiNow = inPlaceNOIYr(state, l);
  const capNow = l.price > 0 ? (noiNow / l.price) * 100 : 0;
  const stabValue = noiStab / (cap / 100);
  const walt = (() => { // weighted average lease term, years
    const tn = l.tenants ?? [];
    const tot = tn.reduce((s2, x) => s2 + x.sf, 0);
    if (!tot) return 0;
    return tn.reduce((s2, x) => s2 + Math.max(0, x.endM - state.month) * x.sf, 0) / tot / 12;
  })();
  return { noiNow, noiStab, cap, capNow, stabValue, upside: stabValue - l.price, marketRent: assetRentPSF(state, probe as any), tOcc: targetOcc(state, t, l.type!), walt };
}

// ---------- Save / load ----------
export function serialize(state: GameState): string { return JSON.stringify(state); }
export function deserialize(json: string): GameState | null {
  try {
    const s = JSON.parse(json);
    if (s && s.version === 10 && Array.isArray(s.tiles) && Array.isArray(s.stock)) return s as GameState;
    return null;
  } catch { return null; }
}
