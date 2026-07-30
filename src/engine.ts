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
  minCells?: number;   // quarter-acre parcels a real one of these sits on
}
// The spec whose quality band a building belongs to. CONSTR arrays are NOT uniformly
// ordered best-first (multifamily ascends, retail zigzags), so never index them by grade.
export function constrForQuality(ty: PType, q: number): ConstrSpec {
  let best = CONSTR[ty][0], bd = Infinity;
  for (const spec of CONSTR[ty]) { const d = Math.abs(spec.q - q); if (d < bd) { bd = d; best = spec; } }
  return best;
}

// Quality lives on a 1-150 scale: ~63 is the C/B line, ~108 the B/A line, and the
// air above 130 is trophy territory almost nothing reaches without signature design,
// a capital program, and the address to carry it.
export const CONSTR: Record<PType, ConstrSpec[]> = {
  industrial: [
    { id: 'tilt', label: 'Tilt-wall concrete', cost: 115, q: 117, qCap: 142, minCells: 4 },
    { id: 'metal', label: 'Pre-engineered metal', cost: 88, q: 87, qCap: 105, minCells: 2 },
    { id: 'tin', label: 'Tin / light steel', cost: 62, q: 54, qCap: 68 },
  ],
  retail: [
    { id: 'center', label: 'Shopping center', cost: 262, q: 105, qCap: 135, minUnits: 6, minCells: 3 },
    { id: 'strip', label: 'Retail strip', cost: 176, q: 57, qCap: 83, minUnits: 3 },
    { id: 'pad', label: 'Pad site (single tenant)', cost: 295, q: 111, qCap: 138, fixedUnits: 1, maxSF: 8000, rentBonus: 0.25 },
  ],
  office: [
    { id: 'concrete', label: 'Concrete & steel — Class A', cost: 284, q: 126, qCap: 142 },
    { id: 'masonry', label: 'Masonry — Class B', cost: 217, q: 90, qCap: 108 },
    { id: 'wood', label: 'Wood frame — Class C', cost: 160, q: 57, qCap: 68 },
  ],
  mixed: [
    { id: 'podium', label: 'Podium mixed-use', cost: 267, q: 105, qCap: 138, minCells: 2 },
  ],
  multifamily: [
    { id: 'garden', label: 'Garden apartments', cost: 175, q: 58, qCap: 90, minCells: 2 },
    { id: 'midrise', label: 'Wood-podium midrise', cost: 223, q: 102, qCap: 126 },
    { id: 'tower', label: 'Concrete tower — Class A', cost: 312, q: 129, qCap: 142 },
  ],
};
export const FAR: Record<PType, number> = { industrial: 0.45, retail: 0.45, office: 2.6, mixed: 1.8, multifamily: 1.6 };
export const MIN_BUILD_SF = 2500;   // a small shop is still a building — a quarter-acre carries one at any tier

// ---------- Zoning ----------
// Every block carries a use class and an intensity tier. The FAR table above is the
// TYPICAL product; zoning says what the city will actually let you put on the dirt.
// Tier caps density (t1 suburban-scale, t2 as-of-right typical, t3 core density),
// use class gates the product. Standing stock that violates its zone is grandfathered —
// the city doesn't tear down what's already built, it just won't permit more of it.
export type ZoneUse = 'R' | 'C' | 'MU' | 'M';
export interface Zone { use: ZoneUse; tier: 1 | 2 | 3 }
export const ZONE_ALLOWS: Record<ZoneUse, PType[]> = {
  R: ['multifamily'],
  C: ['office', 'retail'],
  MU: ['multifamily', 'office', 'retail', 'mixed'],
  M: ['industrial'],
};
export const ZONE_LABEL: Record<ZoneUse, string> = { R: 'Residential', C: 'Commercial', MU: 'Mixed-Use', M: 'Industrial' };
export function zoneAllows(z: Zone | undefined, ty: PType): boolean { return !z || ZONE_ALLOWS[z.use].includes(ty); }
export function zoneTierMult(tier: 1 | 2 | 3): number { return tier === 1 ? 0.6 : tier === 3 ? 2.4 : 1.0; }
export function zoneCode(z: Zone): string { return `${z.use}-${z.tier}`; }
// A rezoning application before the council: filed, then decided months later at a
// hearing. Odds are computed the day of the vote, not the day of filing.
export interface Rezoning { id: number; tileI: number; toUse: ZoneUse; toTier: 1 | 2 | 3; decideM: number; cost: number; by?: string }  // by: firm short, or undefined = you
export function isAggregate(type: PType): boolean { return type === 'multifamily'; }

export const CONFIG = {
  GRID_W: 20, GRID_H: 14,
  START_CASH: 600_000,
  baseRent: { office: 30.5, retail: 20.0, industrial: 8.2, mixed: 31, multifamily: 21.5 } as Record<PType, number>,
  hardCost: { office: 215, retail: 175, industrial: 92, mixed: 245, multifamily: 195 } as Record<PType, number>, // legacy: renovation basis
  // retail trades TIGHT: NNN margins, percentage rent, and the strongest demand story
  // in the city — buyers bid its yield away. It was priced at the widest cap AND the
  // best economics, which made every strip center a money printer.
  baseCap: { office: 7.3, retail: 6.35, industrial: 7.1, mixed: 7.0, multifamily: 6.5 } as Record<PType, number>,
  // retail absorption was so fast that owned retail never experienced a vacant month —
  // riskless carry. Finding the next shopkeeper takes real time now.
  absorbBase: { office: 0.10, retail: 0.11, industrial: 0.22, mixed: 0.13, multifamily: 0.20 } as Record<PType, number>,
  // itemized expense ratios (share of potential rent unless noted)
  expense: {
    maint: { office: 0.023, retail: 0.038, industrial: 0.05, mixed: 0.06, multifamily: 0.13 } as Record<PType, number>, // industrial applies to VACANT space only; retail tenants carry most repairs under NNN
    insurance: { office: 0.045, retail: 0.042, industrial: 0.030, mixed: 0.045, multifamily: 0.055 } as Record<PType, number>,
    taxes: { office: 0.125, retail: 0.105, industrial: 0.080, mixed: 0.115, multifamily: 0.120 } as Record<PType, number>,
    mgmtOfEGI: 0.03,
    camMulti: 0.045, camRetail: 0.011, camRecovery: 0.70, // office/mixed multi-tenant CAM, mostly recovered; retail CAM runs lean
    nnnSlippage: 0.95,            // NNN recoveries collect at 95%
    mfGrounds: 0.025, mfTurnover: 0.04, mfLeasing: 0.03, // multifamily-specific (turnover/leasing on EGI)
  },
  softCostPct: 0.15,
  saleCostPct: 0.05,
  acqLTV: 0.75, indLTVBonus: 0.05, constrLTC: 0.70, refiLTV: 0.70,
  acqSpread: 2.0, constrSpread: 2.5, refiSpread: 1.75, facilitySpread: 1.6,
  minDSCR: 1.25, refiDSCR: 1.20,
  acqAmortYears: 30, refiAmortMax: 25, loanTermMonths: 120,
  feasCost: 8_000,
  scoutCost: 20_000, scoutCooldown: 3,
  primeSpread: 3.0,
  tiers: [
    { name: 'Local Investor', nw: 0, maxSF: 25_000 },
    { name: 'Established Developer', nw: 3_000_000, maxSF: 70_000 },
    { name: 'Regional Player', nw: 12_000_000, maxSF: 180_000 },
    { name: 'Institutional Developer', nw: 40_000_000, maxSF: 400_000 },
  ],
};

// ---------- Types ----------
export interface Tile {
  i: number; x: number; y: number;
  water: boolean;
  park?: boolean;   // unbuildable green — engine-wise it's water, render-wise it's trees
  canal?: boolean;  // narrow waterway — water for the economy, half a river to the eye
  marsh?: boolean;  // wetland: unbuildable like water, reads as reeds and mud
  // D (desirability) = baseD + what the neighborhood has become. baseD is the anchor —
  // geography and street access, fixed at generation except for permanent infrastructure
  // (transit). The rest is emergent: the blend of jobs, residents and retail nearby.
  D: number; baseD: number;
  // desirability momentum: neighborhoods on the way up accelerate, on the way down
  // they spiral — points per quarter, damped. Pure physics of a block, not a forecast.
  dMom?: number;
  income: number; emp: number; pop: number; indSuit: number; crime: number;
  // anchors for the demand side: the part of population/jobs the modeled stock doesn't
  // explain (single-family neighborhoods, small employers). Emergent stock adds on top.
  popBase: number; empBase: number;
  supply: Record<PType, number>;
  // street access, fixed at city generation: arterial frontage, highway/rail proximity,
  // and how quiet the block is. Retail wants frontage; industrial wants the highway and
  // the rail spur; housing pays for quiet.
  acc: { art: number; hwy: number; rail: number; quiet: number };
  // what the city will permit here — see the Zoning block up top
  zone: Zone;
}

// Streets live on the boundaries between blocks: hz[y][x] is the segment between
// tile (x, y-1) and (x, y); vt[y][x] between (x-1, y) and (x, y).
// Classes: 0 none · 1 local · 2 collector · 3 arterial · 4 highway · 5 rail.
export interface RoadNet { hz: number[][]; vt: number[][] }
export interface LandContractState {
  m: number; deposit: number;
  studyOrdered?: boolean; studyFee?: number; resultM?: number;
  known?: SiteCond;
}

export type Phase = 'recovery' | 'expansion' | 'peak' | 'recession';
export interface Economy {
  phase: Phase; phaseAge: number;
  rate: number; rateSmooth: number; inflation: number; empIdx: number; confidence: number; popGrowth: number;
  costIdx: number;
  rentIdx: Record<PType, number>;
  cityVac: Record<PType, number>;
  rentMom: Record<PType, number>;   // rent-growth momentum: markets trend, they don't twitch
  hadCrunch: boolean; crunchMonthsLeft: number; tariffMonthsLeft: number; ecomMonthsLeft: number;
  rtoMonthsLeft?: number;   // the year after a remote-work wave breaks: office demand rebounds
  wfhLastM?: number; ecomLastM?: number;   // waves are episodes, not weather — cooldowns between them
  // this game's monetary personality, rolled once from the seed: some careers are
  // cheap-money eras, some are tight-money grinds, some cycle fast and violent.
  // sectorTilt is the era's secular story — which asset classes this generation
  // favors and which it grinds down. No two careers agree on the best sector.
  era: { rateBias: number; inflBias: number; vol: number; tempo: number; sectorTilt?: Partial<Record<PType, number>> };
  insSpikeMonthsLeft?: number; capInflowMonthsLeft?: number; wfhMonthsLeft?: number;
  constrCycle?: number;
  // the demographic tide: a multi-decade regime beneath the business cycle — boom
  // decades pull people and demand in, decline decades drain them out
  demo?: { regime: 'boom' | 'steady' | 'stagnation' | 'decline'; monthsLeft: number; n: number };
  // eras rotate: months until the current era ends; when eraNext is set the wind is
  // mid-turn, blending the live era toward it over ~3 years
  eraMonthsLeft?: number;
  eraNext?: { rateBias: number; inflBias: number; vol: number; tempo: number; sectorTilt?: Partial<Record<PType, number>> };
  // no two recessions are the same: severity is rolled at the turn (1 = ordinary,
  // 2+ = the kind they name). A sector bust marks the cycle's most overbuilt asset
  // class down hard and bleeds it for a year on top of the general downturn.
  recSeverity?: number;
  bustType?: PType; bustMonthsLeft?: number;
}

export interface Loan {
  id: number; kind: 'acq' | 'constr' | 'refi';
  balance: number; ratePct: number; amortYears: number;
  ioMonthsLeft: number;          // interest-only period remaining
  monthlyPmt: number;            // amortizing payment (used once IO ends)
  maturityMonth: number;         // balloon
  // construction debt: the interest reserve is sized at closing for the EXPECTED build.
  // Run long and it empties — then debt service comes from cash, on a building earning
  // nothing. Floating construction debt reprices monthly; fixed costs +60bps up front.
  reserveInitial?: number; reserveBalance?: number; floating?: boolean;
  spreadPct?: number;    // margin over base, fixed at origination
  recourse?: boolean;    // personally guaranteed: better terms, and the deficiency follows you
  lenderId?: string;     // which desk holds this paper — relationships are per-lender
  capStrike?: number;    // rate cap on floating debt: the ceiling you paid for
}

export interface Facility {
  id: number; assetIds: number[]; balance: number; ratePct: number; amortYears: number;
  monthlyPmt: number; maturityMonth: number;
}

export type Credit = 0 | 1 | 2; // C, B, A
export const CREDIT_LABEL = ['C', 'B', 'A'];

// ---------- Mixed-use is a mixture ----------
// A mixed building is not its own asset class — it's ground-floor retail, some office,
// and apartments over both. The split drives rents, tenants, and market accounting.
export interface MixSplit { office: number; retail: number; multifamily: number }
export const MIX_COMPONENTS = ['retail', 'office', 'multifamily'] as const;
export const MIX_DEFAULT: MixSplit = { office: 0.28, retail: 0.16, multifamily: 0.56 };
export function defaultMixSplit(seed: number, key: number): MixSplit {
  const r = mulberry32((seed ^ Math.imul((key | 0) + 1, 0x9E3779B9)) | 0);
  const retail = Math.round((0.10 + r() * 0.14) * 100) / 100;
  const office = Math.round((0.15 + r() * 0.30) * 100) / 100;
  return { office, retail, multifamily: Math.round((1 - retail - office) * 100) / 100 };
}
export function mixOf(state: GameState, o: { type: PType; mix?: MixSplit; id?: number; tileI?: number }): MixSplit {
  return o.mix ?? defaultMixSplit(state.seed, o.id ?? o.tileI ?? 0);
}

export interface Tenant {
  id: number; name: string; sf: number; rate: number; // $/SF/yr
  startM: number; endM: number; credit: Credit;
  use?: PType;            // in a mixed building: which component this lease sits in
  escPct?: number;        // negotiated annual bump; the quiet compounding that pays for buildings
  optionRate?: number;    // renewal option you granted: fixed rate, exercised only against you
  optionYears?: number;
  optionUsed?: boolean;
}

export interface LOI {
  id: number; assetId: number; kind: 'loi' | 'rfp' | 'renewal';
  tenantId?: number;
  use?: PType;                           // mixed buildings: the component they're touring
  tenant: string; credit: Credit; sf: number;
  rate?: number; termY?: number;         // their proposal (loi) — absent for rfp
  freeMonths?: number;                   // rent abatement they're asking for
  tiPsf?: number;                        // TI package they're asking for, $/SF
  escPct?: number;                       // annual escalation they're proposing (they want it low)
  optionAsk?: boolean;                   // they want a fixed-rate renewal option (pure downside for you)
  prevRate?: number;                     // renewals: what they pay today
  expiresM: number;
  stage: 'open' | 'countered';           // countered = they already countered your counter (final)
  counterRate?: number; counterTermY?: number;
}

export type Quality = 0 | 1 | 2;
export const QLABEL = ['C', 'B', 'A'];

export interface CFEntry { m: number; amt: number; }
export interface ConstrEvent { month: number; kind: string; resolved: boolean; }
export interface Project {
  stage: 'diligence' | 'design' | 'permitting' | 'building';
  monthsLeft: number; totalMonths: number;
  hardBudget: number; softBudget: number; spent: number;
  contingency: number; contingencyLeft: number;
  contractor: 'budget' | 'standard' | 'premium';
  expedited: boolean;
  events: ConstrEvent[]; drawnSoFar: number; monthsBuilt: number;
  contractType?: 'gmp' | 'costplus';
  bonded?: boolean;
  gcReplaced?: boolean;      // one GC failure per project is instructive enough
  haltMonthsLeft?: number;   // site dark after a GC bankruptcy; the reserve keeps burning
  // under-contract state: deposit + DD fee at risk until close; land closes after diligence
  dd?: { deposit: number; ddFee: number; landPrice: number; choice: DevChoice; useJV: boolean; known?: SiteCond };
  landCost?: number;
  siteCond?: SiteCond;       // seeded truth; hidden unless diligence found it
  designTier?: 've' | 'std' | 'signature';
}

export type SiteCondKind = 'none' | 'soils' | 'easement' | 'utility' | 'tank' | 'archaeology';
export interface SiteCond { kind: SiteCondKind; cost: number; delayMo: number; sfLossFrac?: number }

export interface SaleOffer {
  id: number; assetId?: number; landId?: number; amount: number; buyer: string;
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
  mix?: MixSplit;   // mixed buildings: the program split — drives rents, tenants, accounting
  quality: number; qCap: number; age: number;
  mode: 'construction' | 'leaseup' | 'operating';
  tenants: Tenant[];
  occ: number; // derived cache: leased SF / sf
  rentStance: number; maint: 'low' | 'std' | 'high';
  loans: Loan[];
  ledger: CFEntry[]; cumCF: number;
  bts?: { rfpId: number; tenant: string; credit: 0 | 1 | 2; rate: number; termY: number; deliverBy: number; penalty: number };
  basis: number; acqMonth: number;
  entryNOI: number; entryCap: number;
  project?: Project; renovMonthsLeft?: number;
  designTier?: 've' | 'std' | 'signature';
  // capital programs: discrete, completed upgrades and the one in flight
  programs?: string[];
  programsDoneM?: Record<string, number>;   // when each finished — they age out and can run again
  programActive?: { id: string; monthsLeft: number };
  negCFStreak: number;
  // an insured casualty in repair: that fraction of the building earns nothing
  // while taxes and insurance run on all of it
  repair?: { frac: number; monthsLeft: number; what: string };
  roofM?: number;   // when the roof was last replaced — a roof is a 20-30 year event, not a season

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
  mix?: MixSplit;              // mixed buildings: the program split
  playerEngaged?: boolean;     // you made an offer or ran feasibility — the brokers noticed
  rivalEye?: string;           // a firm is circling: they close within the month if you don't
  tenants?: Tenant[];          // in-place rent roll (revealed by feasibility)
  distressed?: boolean; feasDone?: boolean;
  stockId?: number;
  // negotiation (all building listings have a hidden reservation)
  reservation?: number; offersLeft?: number; counterAt?: number; agreed?: boolean; noAsk?: boolean;
  resFrac?: number; listMonth?: number; declinedYou?: boolean; parentAssetId?: number; yourSale?: boolean;
  parcel?: Parcel; parcelCells?: number[]; fromLandId?: number;
  underContract?: LandContractState;
}

// Firms keep real books now: cash and debt are actual, the portfolio is marked to
// market every quarter, and netWorth is the cached result — not a random walk.
export interface Firm {
  name: string; short: string; style: 'core' | 'aggressive' | 'industrial' | 'value-add' | 'mf';
  cash: number; debt: number;
  netWorth: number;   // derived cache: cash + portfolio + land bank - debt, refreshed quarterly
  alive: boolean;
}
export interface NewsItem { m: number; kind: 'info' | 'rumor' | 'event' | 'deal' | 'warn' | 'success'; text: string; tileI?: number; }
export interface ActiveEffect { kind: string; monthsLeft: number; tiles: number[]; dPerMonth?: number; empPerMonth?: number; }
export interface DealLogEntry {
  m: number; action: 'buy' | 'sell' | 'land buy' | 'land sell' | 'delivered';
  name: string; type: PType | 'land'; sf: number; price: number;
  capPct?: number | null; holdMo?: number; profit?: number;
}
export interface PendingDecision { type: 'constrEvent' | 'assetEvent'; assetId: number; eventKind: string; payload?: number; data?: { ti?: number; bumpPct?: number; extendMo?: number; tenantName?: string; hikeLo?: number; hikeHi?: number } }
export interface PostMortem {
  assetName: string; profit: number; irr: number | null;
  parts: { label: string; amt: number; note: string }[];
  lesson: string;
  // enough of the building to draw its portrait one last time (transient — the
  // post-mortem never touches the save file)
  bldg?: { type: PType; construction: string; sf: number; units: number; quality: number; age: number; occ: number; tileI: number };
}

export const PARCEL_AC = 0.25;   // quarter-acre lots
export const PGRID = 4;          // 4x4 parcels per block = 4 acres
export interface Parcel { px: number; py: number; pw: number; ph: number }

export interface LandHolding {
  id: number; tileI: number; cells: number[];
  basis: number; acquiredM: number;
  cond?: SiteCond;        // the seeded truth, in land terms
  condKnown?: boolean;    // did you pay for the study, or are you guessing?
  forSale?: { ask: number; sinceM: number };   // dirt on the market — offers trickle in
  // land debt: interest-only, short fuse, recourse in spirit — banks hate dirt
  loan?: { balance: number; ratePct: number; maturityMonth: number };
}
export interface Migration { m: number; tenant: string; fromTileI: number; toTileI: number; sf: number }

export interface StockBuilding {
  id: number; tileI: number; type: PType; sf: number; units: number;
  px?: number; py?: number; pw?: number; ph?: number; cells?: number[];
  buildLeft?: number; buildTotal?: number; builder?: string;   // visible construction pipeline
  quality: number; age: number; construction: string; occ: number;
  mix?: MixSplit;           // mixed buildings: program split (seeded default when absent)
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
  city?: CityKind;          // which map this campaign was cut from (default meridian)
  taxYr: { noi: number; interest: number; depr: number };
  nolCarry: number;         // net operating losses carried forward
  exchange?: { deferred: number; mustSpend: number; deadlineM: number; fromName: string }; // live 1031 clock
  jvLockedUntil?: number;   // burned a partner? capital has a memory
  firms: Firm[]; news: NewsItem[]; effects: ActiveEffect[];
  scheduledEvents: { m: number; kind: string; payload?: number }[];
  nwHistory: { m: number; nw: number; cash: number; cf: number }[];
  econHistory: { m: number; rate: number; infl: number; emp: number; conf: number; phase: Phase; ri: Record<PType, number>; ci?: number; occSF?: Record<PType, number>; totSF?: Record<PType, number>; pop?: number; cap?: number; land?: number }[];
  nextId: number;
  pending: PendingDecision[];
  lastMonthCF: number; negCashStreak: number;
  lastScoutMonth: number; approachesLeft: number;
  // per-parcel owner memory, keyed 'tileI:cell' — refusals and named asks both persist
  parcelApproach: Record<string, { m: number; outcome: 'refused' | 'ask'; ask?: number }>;
  dealLog: DealLogEntry[];
  firmLand: { short: string; tileI: number; cells: number[]; m: number }[];
  rezonings: Rezoning[];
  rezoneDenied: Record<number, number>;   // tileI -> month the council last said no
  swans: { m: number; kind: string; label: string }[];   // the once-a-generation shocks this game has lived through
  gameOver: boolean; gameOverReason?: string; forcedSaleNotice?: string;
  transitCorridor: number[];
  lastTransitM?: number;   // when the last transit line was approved (or forced onto the ballot)
  roads: RoadNet;
  totalRealizedProfit: number; dealsClosed: number;
  // the books: every dollar in or out, categorized — the income statement reads from here
  cfLog: CFLine[];
  staff: Record<StaffId, boolean>;
  lenderRel: Record<string, number>;   // lenderId -> relationship 0-100
  auctions: Auction[];
  btsRfps: BtsRfp[];
  // rivalry: how many deals each firm has taken off your desk — the news remembers
  rivalry?: Record<string, number>;
  // a collapsed firm's whole book, one wire: the special-situations desk would rather
  // sell you everything than run twenty closings
  bulkDeal?: { short: string; name: string; stockIds: number[]; price: number; expiresM: number };
  version: number;
}

export type CFCat = 'rent' | 'opex' | 'debt' | 'lease-costs' | 'capex' | 'ga' | 'fees' | 'tax' | 'buy' | 'sell' | 'dev' | 'jv' | 'other';
export interface CFLine { m: number; cat: CFCat; label: string; amt: number }
export const CF_LABEL: Record<CFCat, string> = {
  rent: 'Rental income', opex: 'Operating expenses', debt: 'Debt service',
  'lease-costs': 'Leasing costs (TI/LC/turns)', capex: 'Capital & repairs', ga: 'G&A — payroll',
  fees: 'Deal fees & pursuit costs', tax: 'Income tax', buy: 'Acquisitions & deposits',
  sell: 'Disposition proceeds', dev: 'Development draws & fees', jv: 'Partner distributions', other: 'Other',
};

export type StaffId = 'analyst' | 'pm' | 'leasing' | 'cm';
export const STAFF: { id: StaffId; title: string; salary: number; desc: string }[] = [
  { id: 'analyst', title: 'Acquisitions analyst', salary: 6_000, desc: 'Two more owner calls a month, and the ones you make find the motivated sellers faster.' },
  { id: 'pm', title: 'Property manager', salary: 8_000, desc: 'Portfolio opex −6%, buildings age slower. Past ~7 assets, self-managing costs you 5% extra — somebody has to answer the 2am calls.' },
  { id: 'leasing', title: 'Leasing director', salary: 5_000, desc: 'Tours book faster: +25% leasing velocity, tenants come back to the table more often. Worth most while you have empty floors.' },
  { id: 'cm', title: 'Construction manager', salary: 8_000, desc: 'Site problems caught early: construction surprises 30% rarer, schedules run a touch faster.' },
];

export function setStaffHired(state: GameState, id: StaffId, hired: boolean): GameState {
  const s = clone(state);
  if (!s.staff) s.staff = { analyst: false, pm: false, leasing: false, cm: false };
  if (s.staff[id] === hired) return s;
  s.staff[id] = hired;
  const st = STAFF.find(x => x.id === id)!;
  pushNews(s, 'info', hired
    ? `Hired: ${st.title.toLowerCase()} joins the firm at ${fmtMoney(st.salary)}/mo. ${st.desc}`
    : `The ${st.title.toLowerCase()} role is cut. The savings show up this month; the work shows up everywhere.`);
  return s;
}

export interface Auction {
  id: number; stockId: number; tileI: number;
  reserve: number; bid: number; leader: string | null;   // null = no bids yet; 'you' or a firm short
  rivalMax: number;    // hidden: the deepest rival pocket in the room
  endsM: number; source: string;
}

export interface BtsRfp {
  id: number; tenant: string; credit: 0 | 1 | 2; type: PType;
  sf: number; rate: number; termY: number;
  deliverBy: number; respondBy: number; penalty: number;
}

// ---------- helpers ----------
export function qGrade(q: number): Quality { return q >= 108 ? 2 : q >= 63 ? 1 : 0; }
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

  // Superblocks and dead ends: the grid frays at the edges of town, and the
  // industrial band keeps its streets far apart — big sheds want big blocks.
  for (let y = 1; y < H; y++) for (let x = 0; x < W; x++) {
    const pr = (y >= H - 4 ? 0.36 : 0.16) + (x <= 1 || x >= W - 2 ? 0.08 : 0);
    if (r() < pr) hz[y][x] = 0;
  }
  for (let y = 0; y < H; y++) for (let x = 1; x < W; x++) {
    const pr = (y >= H - 4 ? 0.36 : 0.16) + (x <= 1 || x >= W - 2 ? 0.08 : 0);
    if (r() < pr) vt[y][x] = 0;
  }
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
  const nCollV = 2 + (r() < 0.3 ? 1 : 0);
  for (let k = 0; k < nCollV; k++) {
    const cx = k === 0 ? clamp(UPT.x, 1, W - 1) : 1 + Math.floor(r() * (W - 1));
    for (let y = 0; y < H; y++) vt[y][cx] = Math.max(vt[y][cx], 2);
  }
  const nCollH = 2 + (r() < 0.1 ? 1 : 0);
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
  const extraBridges = 2 + (r() < 0.1 ? 1 : 0);
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
  // dense grid downtown, loosening with distance — the fringe runs on superblocks,
  // and the freight band always did
  const coreDist = (x: number, y: number) => Math.min(
    Math.max(Math.abs(x - CBD.x), Math.abs(y - CBD.y)),
    Math.max(Math.abs(x - UPT.x), Math.abs(y - UPT.y)));
  const pruneP = (x: number, y: number) => y >= H - 4 ? 0.26 : coreDist(x, y) > 6 ? 0.22 : coreDist(x, y) > 4 ? 0.13 : 0.05;
  for (let y = 1; y < H; y++) for (let x = 0; x < W; x++) if (r() < pruneP(x, y - 0.5 | 0)) hz[y][x] = 0;
  for (let y = 0; y < H; y++) for (let x = 1; x < W; x++) if (r() < pruneP(x, y)) vt[y][x] = 0;
  // avenues: arterials through both cores, collectors between
  for (let y = 0; y < H; y++) {
    vt[y][CBD.x] = Math.max(vt[y][CBD.x], 3);
    vt[y][UPT.x] = Math.max(vt[y][UPT.x], 3);
    vt[y][Math.floor((CBD.x + UPT.x) / 2)] = Math.max(vt[y][Math.floor((CBD.x + UPT.x) / 2)], 2);
  }
  // crosstown arterial mid-island + a second collector
  const mid = Math.floor(H / 2);
  for (let x = 0; x < W; x++) hz[mid][x] = Math.max(hz[mid][x], 3);
  for (const c2 of [mid - 3, mid + 3]) {
    const cy2 = Math.max(1, Math.min(H - 1, c2));
    for (let x = 0; x < W; x++) hz[cy2][x] = Math.max(hz[cy2][x], 2);
  }
  if (W - UPT.x >= 5) {   // the long east end gets its own collector avenue
    const ex = Math.round((UPT.x + W - 1) / 2);
    for (let y = 0; y < H; y++) vt[y][ex] = Math.max(vt[y][ex], 2);
  }
  // Broadway: a staircase AVENUE from the west end toward uptown — upgraded to a
  // real arterial so the diagonal reads at every zoom
  const staircase = (fromX: number, fromY: number, to: { x: number; y: number }, cls: number) => {
    let px = fromX, py = fromY, guard = 0;
    while ((px !== to.x || py !== to.y) && guard++ < 60) {
      if (Math.abs(to.x - px) >= Math.abs(to.y - py)) {
        const d = to.x > px ? 1 : -1;
        const yy = Math.max(1, Math.min(H - 1, py));
        hz[yy][Math.min(px, px + d)] = Math.max(hz[yy][Math.min(px, px + d)], cls);
        px += d;
      } else {
        const d = to.y > py ? 1 : -1;
        const xx = Math.max(1, Math.min(W - 1, px));
        vt[Math.min(py, py + d)][xx] = Math.max(vt[Math.min(py, py + d)][xx], cls);
        py += d;
      }
    }
  };
  staircase(1, 2, UPT, 3);
  // some cities get a second diagonal: a southeast boulevard cutting toward the CBD
  if (r() < 0.55) staircase(W - 2, H - 3, CBD, 2);
  // shoreline expressway along the north bank
  for (let x = 0; x < W; x++) hz[1][x] = 4;
  // freight rail on the south shore + port spur
  for (let x = 0; x < W; x++) hz[H - 1][x] = 5;
  vt[H - 2][2] = 5;
  // water severs the grid — except the bridges
  const bridgeXs = [3, 8, 12, 16].map(b => Math.min(W - 2, b + Math.floor(r() * 2)));
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
  let rc = Math.round(W / 5);
  for (let y = 0; y < H; y++) { riverCol.push(rc); if (r() < 0.4) rc += r() < 0.5 ? -1 : 1; rc = clamp(rc, Math.round(W / 5) - 1, Math.round(W / 5) + 1); }
  // island: a long city between two rivers, bays biting the shoreline, a park mid-island
  const biteT = new Set<number>(), biteB = new Set<number>();
  for (let x = 0; x < W; x++) { if (r() < 0.16) biteT.add(x); if (r() < 0.16) biteB.add(x); }
  const CBD0 = city === 'island' ? { x: Math.round(W * 0.22), y: Math.floor(H / 2) } : { x: Math.round(W * 0.5), y: Math.round(H * 0.4) };
  const UPT0 = city === 'island' ? { x: Math.round(W * 0.71), y: Math.floor(H / 2) - 1 } : { x: Math.round(W * 0.79), y: Math.round(H * 0.2) };
  // the canal column is computed early so parks can stay off it
  const canalCol: number[] = [];
  if (city === 'island') {
    let cc = Math.round(W * 0.55);
    for (let y = 0; y < H; y++) {
      canalCol.push(cc);
      if (r() < 0.45) cc += r() < 0.5 ? -1 : 1;
      cc = clamp(cc, Math.round(W * 0.5) - 2, Math.round(W * 0.55) + 2);
    }
  }
  // ---- park forms: the green rolls its own dice ----
  // One seed gets a Central Park, the next gets a scatter of pocket squares, the
  // next a shoreline greenway or twin neighborhood parks. Parks are unbuildable
  // and lift desirability around them — WHERE the green lands reshapes the city.
  const parkSet = new Set<number>();
  {
    const parkable = (x: number, y: number) => {
      if (x < 1 || x >= W - 1 || y < 2 || y > H - 3) return false;
      if (Math.max(Math.abs(x - CBD0.x), Math.abs(y - CBD0.y)) <= 1) return false;
      if (Math.max(Math.abs(x - UPT0.x), Math.abs(y - UPT0.y)) <= 1) return false;
      if (city === 'island' && canalCol[y] === x) return false;
      if (city !== 'island' && Math.abs(riverCol[y] - x) <= 0) return false;
      return true;
    };
    const addRect = (x0: number, y0: number, w0: number, h0: number) => {
      for (let dy = 0; dy < h0; dy++) for (let dx = 0; dx < w0; dx++) {
        if (parkable(x0 + dx, y0 + dy)) parkSet.add((y0 + dy) * W + x0 + dx);
      }
    };
    const pRoll = r();
    const pForm = pRoll < 0.30 ? 'central' : pRoll < 0.55 ? 'pockets' : pRoll < 0.78 ? 'twin' : 'greenway';
    if (pForm === 'central') {
      // one big park, anywhere in the middle band — the address maker
      const pw0 = 2 + (r() < 0.4 ? 1 : 0), ph0 = 2 + (r() < 0.5 ? 1 : 0);
      const px0 = clamp(Math.round(W * 0.28 + r() * W * 0.4), 2, W - pw0 - 2);
      const py0 = clamp(Math.round(2 + r() * (H - ph0 - 5)), 2, H - ph0 - 3);
      addRect(px0, py0, pw0, ph0);
    } else if (pForm === 'twin') {
      // two neighborhood parks in different quarters
      addRect(clamp(Math.round(3 + r() * (W * 0.35)), 2, W - 4), clamp(Math.round(2 + r() * (H - 8)), 2, H - 5), 2, 2);
      addRect(clamp(Math.round(W * 0.55 + r() * (W * 0.35)), 2, W - 4), clamp(Math.round(2 + r() * (H - 8)), 2, H - 5), 2, 2);
    } else if (pForm === 'greenway') {
      // an esplanade: a broken ribbon of green along one shore
      const north = r() < 0.6;
      const gy = north ? 2 : H - 3;
      const gx0 = clamp(Math.round(2 + r() * (W * 0.4)), 1, W - 8);
      const len = 4 + Math.floor(r() * 3);
      for (let k = 0; k < len; k++) {
        if (r() < 0.85 && parkable(gx0 + k, gy)) parkSet.add(gy * W + gx0 + k);
      }
    }
    if (pForm === 'pockets' || r() < 0.5) {
      // pocket squares scattered through the fabric — every one lifts its block
      const n = pForm === 'pockets' ? 6 + Math.floor(r() * 3) : 2;
      let placed = 0, guard = 0;
      while (placed < n && guard++ < 60) {
        const px2 = 1 + Math.floor(r() * (W - 2)), py2 = 2 + Math.floor(r() * (H - 4));
        if (!parkable(px2, py2)) continue;
        // pockets keep their distance from each other
        let clear = true;
        for (const pi of parkSet) {
          if (Math.max(Math.abs(pi % W - px2), Math.abs(Math.floor(pi / W) - py2)) < 3) { clear = false; break; }
        }
        if (!clear) continue;
        parkSet.add(py2 * W + px2);
        placed++;
      }
    }
  }
  // ---- terrain forms: the rectangle dies here ----
  // Each seed rolls a landform on top of the base city — a bay biting the shore, a
  // wider sound, an inland lake — plus wetland fringes. Same blocks, different city.
  const extraWater = new Set<number>(), marshSet = new Set<number>();
  const nearCore = (x: number, y: number) => Math.max(Math.abs(x - CBD0.x), Math.abs(y - CBD0.y)) <= 2 || Math.max(Math.abs(x - UPT0.x), Math.abs(y - UPT0.y)) <= 2;
  const carve = (x: number, y: number, asMarsh: boolean) => {
    if (x < 1 || x >= W - 1 || y < 1 || y >= H - 1) return;
    const i = y * W + x;
    if (nearCore(x, y) || parkSet.has(i)) return;
    extraWater.add(i);
    if (asMarsh) marshSet.add(i); else marshSet.delete(i);
  };
  const formRoll = r();
  const form = formRoll < 0.28 ? 'classic' : formRoll < 0.56 ? 'bay' : formRoll < 0.78 ? 'sound' : 'lake';
  if (city === 'island') {
    if (form === 'bay') {
      // an elliptical bay bites one shore, marsh at its edges
      const north = r() < 0.5;
      const bx = clamp(Math.round(4 + r() * (W - 9)), 3, W - 4);
      const rx = 2.5 + r() * 1.4, ry = 2.0 + r() * 1.1;
      const shoreY = north ? 1 : H - 2;
      for (let dy = 0; dy <= Math.ceil(ry); dy++) for (let dx = -Math.ceil(rx); dx <= Math.ceil(rx); dx++) {
        const yy = north ? shoreY + dy : shoreY - dy;
        const d2 = (dx / rx) * (dx / rx) + (dy / ry) * (dy / ry);
        if (d2 < 1) carve(bx + dx, yy, false);
        else if (d2 < 1.55 && r() < 0.5) carve(bx + dx, yy, true);
      }
    } else if (form === 'sound') {
      // the north river widens into a sound — the island narrows, the shore goes ragged
      for (let x = 0; x < W; x++) {
        carve(x, 1, false);
        if (r() < 0.45) carve(x, 2, r() < 0.5);
      }
    } else if (form === 'lake') {
      // an inland lake with a wet fringe, out east where the land is cheap
      const lx = clamp(Math.round(W * 0.5 + r() * (W * 0.4)), 5, W - 4);
      const ly = clamp(Math.round(2 + r() * (H - 5)), 3, H - 4);
      const lr = 1.4 + r() * 0.8;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const d2 = (dx * dx + dy * dy * 1.6) / (lr * lr);
        if (d2 < 1) carve(lx + dx, ly + dy, false);
        else if (d2 < 2.1 && r() < 0.45) carve(lx + dx, ly + dy, true);
      }
    }
    // every form gets a little wetland near the freight shore — the land nobody drained
    for (let k = 0; k < 3; k++) {
      const mx = clamp(Math.round(2 + r() * (W - 5)), 2, W - 3);
      if (Math.abs(mx - CBD0.x) < 4) continue;
      carve(mx, H - 3, true);
      if (r() < 0.5) carve(mx + 1, H - 3, true);
      if (r() < 0.3) carve(mx, H - 4, true);
    }
  } else {
    // meridian keeps its river but the banks can go wet
    for (let k = 0; k < 4; k++) {
      const my = clamp(Math.round(1 + r() * (H - 3)), 1, H - 2);
      const mx = riverCol[my] + (r() < 0.5 ? -1 : 1);
      if (r() < 0.6 && !nearCore(mx, my)) carve(mx, my, true);
    }
  }
  const isWaterXY = city === 'island'
    ? (x: number, y: number) => y === 0 || y === H - 1 || (y === 1 && biteT.has(x)) || (y === H - 2 && biteB.has(x)) || parkSet.has(y * W + x) || extraWater.has(y * W + x)
    : (x: number, y: number) => x === riverCol[y] || parkSet.has(y * W + x) || extraWater.has(y * W + x);
  const isCanal = (x: number, y: number) => city === 'island' && y > 0 && y < H - 1 && x === canalCol[y] && !parkSet.has(y * W + x);
  const CBD = city === 'island' ? { x: Math.round(W * 0.22), y: Math.floor(H / 2) } : { x: Math.round(W * 0.5), y: Math.round(H * 0.4) };
  const UPT = city === 'island' ? { x: Math.round(W * 0.71), y: Math.floor(H / 2) - 1 } : { x: Math.round(W * 0.79), y: Math.round(H * 0.2) };
  const PORT = city === 'island' ? { x: 1, y: H - 3 } : { x: riverCol[H - 1], y: H - 1 };
  const roads = city === 'island' ? generateIslandRoads(r, isWaterXY, CBD, UPT) : generateRoads(r, riverCol, CBD, UPT);
  const tiles: Tile[] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const water = isWaterXY(x, y) || isCanal(x, y);
    const dC = dist(x, y, CBD.x, CBD.y), dU = dist(x, y, UPT.x, UPT.y);
    const riverAdj = !water && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => isWaterXY(x + dx, y + dy) || isCanal(x + dx, y + dy));
    const railBand = y >= H - 3 ? 1 : y === H - 4 ? 0.4 : 0;
    let D = 18 + 58 * gauss(dC, 5.9) + 34 * gauss(dU, 3.7) + (riverAdj ? 10 : 0) - 16 * railBand + (noise[i] - 0.5) * 26;
    D = clamp(D, 8, 96);
    const income = clamp(0.55 + (D / 100) * 0.95 + (noise2[i] - 0.5) * 0.2, 0.5, 1.7);
    const emp = clamp(10 + 62 * gauss(dC, 4.8) + 24 * gauss(dU, 3.1) + (noise[i] - 0.5) * 18, 4, 100);
    const pop = clamp(28 + 42 * gauss(dC, 9.2) - 20 * railBand + (noise2[i] - 0.5) * 30, 5, 100);
    const dPort = dist(x, y, PORT.x, PORT.y);
    const indSuit = clamp(16 + 58 * railBand + 30 * gauss(dPort, 4.5) - D * 0.25 + (noise[i] - 0.5) * 20, 3, 100);
    const crime = clamp(68 - 0.58 * D + (noise2[i] - 0.5) * 24, 4, 85);
    tiles.push({ i, x, y, water, park: parkSet.has(i) || undefined, canal: isCanal(x, y) || undefined, marsh: marshSet.has(i) || undefined, D, baseD: D, income, emp, pop, indSuit, crime, popBase: pop, empBase: emp, supply: { office: 0, retail: 0, industrial: 0, mixed: 0, multifamily: 0 }, acc: { art: 0, hwy: 0, rail: 0, quiet: 0 }, zone: { use: 'MU', tier: 1 } });
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
  // The zoning map reads like every zoning map: industrial where the rail is, commercial
  // where the jobs are, residential where it's quiet, mixed where the city actually works.
  // Written AFTER the supply seed so the paper mostly matches the ground — what doesn't
  // match is grandfathered, same as every real city.
  for (const t of tiles) {
    if (t.water) continue;
    // pop carries a high floor (single-family fabric everywhere), so the jobs test
    // is asymmetric: strong employment makes a commercial district even where people live
    let use: ZoneUse;
    if (t.indSuit > 55) use = 'M';
    else if (t.emp > 45 && t.emp > t.pop * 1.0) use = 'C';
    else if (t.pop > t.emp * 1.6) use = 'R';
    else use = 'MU';
    let tier: 1 | 2 | 3 = t.D >= 74 ? 3 : t.D >= 44 ? 2 : 1;
    if (use === 'M' && tier > 2) tier = 2;         // nobody zones for 30-story warehouses
    if (r() < 0.12) tier = Math.max(1, tier - 1) as 1 | 2 | 3;  // pockets of stale downzoned paper
    t.zone = { use, tier };
  }
  const corridor: number[] = [];
  const tx = city === 'island' ? W - 2 : (r() < 0.5 ? 1 : W - 2);
  const ty = city === 'island' ? UPT.y : (r() < 0.5 ? H - 2 : 1);
  const steps = Math.max(1, Math.max(Math.abs(tx - CBD.x), Math.abs(ty - CBD.y)));
  for (let s2 = 0; s2 <= steps; s2++) {
    const cx = Math.round(CBD.x + (tx - CBD.x) * (s2 / steps));
    const cy = Math.round(CBD.y + (ty - CBD.y) * (s2 / steps));
    const idx = cy * W + cx;
    if (!tiles[idx].water && !corridor.includes(idx)) corridor.push(idx);
  }
  return { tiles, corridor, roads };
}

// ---------- Market math ----------
export function tileDemandFactor(state: GameState, t: Tile, type: PType): number {
  const e = state.econ;
  const acc = t.acc ?? { art: 0, hwy: 0, rail: 0, quiet: 0 };
  let f = 1;
  if (type === 'office') f = 0.50 + 1.25 * (t.emp / 100) * (e.empIdx / 100);
  if (type === 'retail') f = (0.40 + 1.15 * (t.pop / 100) * t.income * (0.6 + 0.008 * e.confidence)) * (0.92 + 0.18 * acc.art);
  if (type === 'industrial') f = (0.55 + 0.95 * (t.indSuit / 100) * (e.ecomMonthsLeft > 0 ? 1.15 : 1)) * (0.88 + 0.30 * Math.max(acc.hwy, acc.rail));
  if (type === 'mixed') f = 0.40 + 0.65 * (t.emp / 100) + 0.55 * (t.pop / 100) * t.income;
  if (type === 'multifamily') f = (0.45 + 1.05 * (t.pop / 100) * (0.5 + 0.5 * t.income)) * (0.94 + 0.12 * acc.quiet);
  if (type === 'retail' && e.ecomMonthsLeft > 0) f *= 0.85;
  if (type === 'office' && (e.wfhMonthsLeft ?? 0) > 0) f *= 0.85;
  if (type === 'office' && (e.rtoMonthsLeft ?? 0) > 0) f *= 1.12;   // the return-to-office year
  // the era's secular wind: a headwind sector tours slower everywhere, all era long
  f *= clamp(1 + (e.era?.sectorTilt?.[type] ?? 0) * 2.2, 0.86, 1.14);
  return clamp(f, 0.35, 1.8);
}

export function marketRentPSF(state: GameState, t: Tile, type: PType): number {
  // mixed-use is a mixture: it prices as its components — retail on the ground,
  // office above, apartments over both — plus a small premium for the address that
  // has everything within one elevator ride. It has no market of its own.
  if (type === 'mixed') return mixedBlendRentPSF(state, t, MIX_DEFAULT);
  const acc = t.acc ?? { art: 0, hwy: 0, rail: 0, quiet: 0 };
  // the ADDRESS carries more of the rent: same building, better block, visibly better
  // number — location and quality should argue as equals
  let mult = 1;
  if (type === 'office') mult = 0.44 + 0.62 * (t.emp / 100) + 0.57 * (t.D / 100) + 0.06 * acc.art;
  if (type === 'retail') mult = 0.39 + 0.72 * t.income * (t.pop / 100) + 0.47 * (t.D / 100) + 0.20 * acc.art;
  if (type === 'industrial') mult = 0.74 + 0.50 * (t.indSuit / 100) + 0.10 * Math.max(acc.hwy, acc.rail);
  if (type === 'multifamily') mult = 0.41 + 0.68 * (t.D / 100) + 0.32 * t.income + 0.07 * acc.quiet - 0.08 * acc.hwy;
  // the LOCAL balance: rents on an overbuilt block discount below the citywide index,
  // and a block with real demand and little product earns a scarcity premium.
  // Mixed-use podium slices count toward each component's standing supply here.
  const supplyEff = t.supply[type] + (type === 'office' || type === 'retail' || type === 'multifamily'
    ? (t.supply.mixed ?? 0) * MIX_DEFAULT[type] : 0);
  const ratio = supplyEff / tileCapacitySF(t, type);
  const local = clamp(1 - clamp((ratio - 1) * 0.22, 0, 0.30) * 0.85 + clamp(0.65 - ratio, 0, 0.5) * 0.10, 0.74, 1.08);
  return CONFIG.baseRent[type] * mult * local * state.econ.rentIdx[type];
}
export function mixedBlendRentPSF(state: GameState, t: Tile, m: MixSplit): number {
  return 1.04 * (m.office * marketRentPSF(state, t, 'office')
    + m.retail * marketRentPSF(state, t, 'retail')
    + m.multifamily * marketRentPSF(state, t, 'multifamily'));
}

// units: more (smaller) units → marginally higher rent PSF, more management cost
export function unitRentPremium(units: number): number {
  return 1 + Math.min(0.15, 0.045 * Math.log2(Math.max(1, units)));
}
export function unitMgmtLoad(units: number): number { // extra opex as share of potential rent
  return Math.min(0.04, 0.007 * Math.log2(Math.max(1, units)));
}
// market rent for THIS building (grade + unit mix + pad bonus)
// What a tenant actually perceives touring the building: the product itself plus the
// address it stands on. A good building on a great block shows better than the same
// building over the tracks — the location is part of the product.
export function apparentQuality(state: GameState, a: Pick<Asset, 'tileI' | 'quality'>): number {
  const t = state.tiles[a.tileI];
  return clamp(a.quality + (t.D - 55) * 0.12, 1, 150);
}
export function assetRentPSF(state: GameState, a: Pick<Asset, 'tileI' | 'type' | 'quality' | 'units' | 'construction'> & { designTier?: 've' | 'std' | 'signature'; mix?: MixSplit; id?: number }): number {
  const t = state.tiles[a.tileI];
  const spec = constrSpec(a as any);
  return (a.type === 'mixed' ? mixedBlendRentPSF(state, t, mixOf(state, a)) : marketRentPSF(state, t, a.type))
    * (0.70 + (apparentQuality(state, a) / 150) * 0.56)   // quality argues with location as an equal: C-grade ~0.83x, A+ ~1.19x, anchored at the citywide mean
    * unitRentPremium(a.units)
    * (1 + (spec.rentBonus ?? 0))
    * (a.designTier ? DESIGN[a.designTier].rentMult : 1)
    * frontageMult(a.type, (a as any).cells ?? ((a as any).px !== undefined ? cellsOfRect((a as any).px, (a as any).py, (a as any).pw, (a as any).ph) : undefined));
}
// What a suite in one component of a mixed building rents for: that component's
// market, this building's quality, and a touch of podium premium.
export function componentRentPSF(state: GameState, a: Pick<Asset, 'tileI' | 'quality'> & { cells?: number[]; px?: number; py?: number; pw?: number; ph?: number }, comp: PType): number {
  const t = state.tiles[a.tileI];
  const cells = a.cells ?? (a.px !== undefined ? cellsOfRect(a.px, a.py!, a.pw!, a.ph!) : undefined);
  return marketRentPSF(state, t, comp)
    * (0.70 + (apparentQuality(state, a) / 150) * 0.56)
    * (comp === 'retail' ? frontageMult('retail', cells) : 1)
    * 1.02;
}
// Per-component footage and leasing state of a mixed building — the breakdown the
// deal memo, the LOI flow, and the market accounting all read from.
export function mixedComponents(state: GameState, a: { type: PType; mix?: MixSplit; id?: number; tileI: number; sf: number; tenants: Tenant[] }): { comp: PType; sf: number; leased: number; units: number }[] {
  if (a.type !== 'mixed') return [];
  const m = mixOf(state, a);
  return MIX_COMPONENTS.map(comp => {
    const sf = Math.round(a.sf * m[comp] / 100) * 100;
    const leased = a.tenants.filter(tn => (tn.use ?? 'office') === comp).reduce((s2, tn) => s2 + tn.sf, 0);
    const units = comp === 'multifamily' ? Math.max(4, Math.round(sf / 950)) : Math.max(1, Math.round(sf / (comp === 'retail' ? 2600 : 4400)));
    return { comp, sf, leased: Math.min(leased, sf), units };
  }).filter(c => c.sf >= 600);
}

// Street presence is destiny for retail: perimeter parcels carry a premium, corners more.
export function frontageMult(type: PType, cells?: number[]): number {
  if (type !== 'retail' && type !== 'mixed') return 1;
  if (!cells?.length) return 1;
  let per = 0, corner = 0;
  for (const c of cells) {
    const x = c % PGRID, y = Math.floor(c / PGRID);
    const edges = (x === 0 || x === PGRID - 1 ? 1 : 0) + (y === 0 || y === PGRID - 1 ? 1 : 0);
    if (edges >= 1) per++;
    if (edges === 2) corner++;
  }
  const scale = type === 'mixed' ? 0.5 : 1;
  return 1 + scale * (0.07 * (per / cells.length) + (corner > 0 ? 0.04 : 0));
}

// Where each market clears over a full cycle. Vacancy above this is a tenant's
// market; below it, the landlord stops returning calls.
// mixed's equilibrium is the blend of its components — it has no market of its own
export const EQ_VAC: Record<PType, number> = { office: 13.0, retail: 10.0, industrial: 10.5, mixed: 11.2, multifamily: 11.0 };

export function capRatePct(state: GameState, t: Tile, type: PType, quality: number): number {
  const inflow = (state.econ.capInflowMonthsLeft ?? 0) > 0 ? -0.35 : 0;
  const loc = type === 'industrial' ? t.indSuit * 0.7 + t.D * 0.3 : t.D;
  let cap = CONFIG.baseCap[type]
    + (55 - loc) * 0.038
    + (state.econ.rateSmooth - 5.0) * 0.60
    // buyers price the leasing market, not just the debt market: a soft sector trades wide
    + clamp((state.econ.cityVac[type] - EQ_VAC[type]) * 0.05, -0.35, 0.7)
    + clamp((90 - quality) * 0.011, -0.55, 0.66)   // buyers pay up for every point of product, continuously
    + (t.crime > 55 && type !== 'industrial' ? 0.3 : 0);
  return clamp(cap, 5.0, 12.0) + inflow;
}

export function tileCapacitySF(t: Tile, type: PType): number {
  // demand-side capacity, scaled to a 4-acre block of quarter-acre parcels.
  // Calibrated so the GENERATED city sits modestly below capacity (p50 ~0.85) —
  // the citywide vacancy readout is real now, so this has to agree with what
  // generation actually builds or the whole market opens 25% vacant.
  const K = 0.13;
  if (type === 'office') return (5200 * t.emp + 24_000) * K;
  if (type === 'retail') return (3000 * t.pop * t.income + 20_000) * K;
  if (type === 'industrial') return (13_500 * t.indSuit + 60_000) * K;
  if (type === 'multifamily') return (4700 * t.pop * (0.6 + 0.4 * t.income) + 30_000) * K;
  return (1400 * (t.emp + t.pop) + 26_000) * K;
}
export function oversupplyPenalty(t: Tile, type: PType): number {
  const ratio = t.supply[type] / tileCapacitySF(t, type);
  return clamp((ratio - 1) * 0.22, 0, 0.30);
}
export function targetOcc(state: GameState, t: Tile, type: PType): number {
  const df = tileDemandFactor(state, t, type);
  // vacancy feeds back into occupancy DAMPED toward equilibrium — the real market's
  // stabilizer is price: empty space gets cheap, cheap space gets taken. Without the
  // damping this loop eats the city.
  const effVac = EQ_VAC[type] + (state.econ.cityVac[type] - EQ_VAC[type]) * 0.6;
  // price elasticity, the market's true stabilizer: when rents lag the income/cost
  // trend, tenants take more space; when rents outrun it, demand quietly erodes.
  // Without this, a soft decade never finds a bottom.
  // the ceiling matters: a sector whose rents have halved NEEDS the cheap-space
  // rebound to find its bottom, or it grinds down forever (office, historically)
  const afford = clamp(Math.pow(state.econ.costIdx / state.econ.rentIdx[type], 0.4), 0.86, 1.30);
  const base = (1 - Math.max(0.045, (effVac / 100) * (2.0 - df))) * afford;
  return clamp(base - oversupplyPenalty(t, type), 0.35, 0.95);
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
  const cam = multi && !mf ? pot * (a.type === 'retail' ? X.camRetail : X.camMulti) : 0;
  // industrial is truly NNN on upkeep: tenants maintain their own space; you maintain what's empty
  const maintAmt = a.type === 'industrial'
    ? pot * X.maint[a.type] * (1 - occShare) * maintMult
    : pot * X.maint[a.type] * maintMult;
  const selfManaged = a.sf < 20_000; // small buildings self-manage — cheaper, not free: your Saturdays have a price
  const lines: ExpenseLine[] = [
    { label: a.type === 'industrial' ? 'Maintenance (vacant space only)' : 'Maintenance & repairs', amt: maintAmt },
    { label: 'Insurance', amt: ins },
    { label: 'Property taxes', amt: tax },
    { label: selfManaged ? 'Management (self-managed)' : 'Management', amt: (selfManaged ? 0.5 : 1) * (egi * X.mgmtOfEGI + pot * unitMgmtLoad(mf ? Math.min(a.units, 24) : a.units)) },
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
  // modernized systems cut the whole operating line — the one program that pays twice
  if (((a as any).programs as string[] | undefined)?.includes('systems')) {
    const pct = PROGRAMS.find(p => p.id === 'systems')?.opexPct ?? 0.05;
    const gross = lines.reduce((s, l) => s + Math.max(0, l.amt), 0);
    lines.push({ label: 'Systems modernization savings', amt: -gross * pct });
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
  // retail's percentage rent is income like any other — the market capitalizes it
  const overM = a.type === 'retail' ? expectedRetailOveragePSFYr(state, a.tileI, a.quality) * a.sf * occ / 12 : 0;
  const egiM = potM * occ + overM;
  const ex = expenseBreakdown(state, { ...(a as any), maint: 'std', tenants: [] }, potM, egiM);
  return (egiM - ex.total) * 12;
}

// ---------- Percentage rent (retail) ----------
// Retail leases carry an overage clause: past a natural breakpoint (base rent ÷ 6%),
// the landlord takes 6% of gross sales. Sales come from the neighborhood — people
// nearby, their incomes, arterial frontage, the cycle's mood — times the tenant's own
// draw. Prime corners pay you twice: once in rent, again at the register. The
// multiplier derives from the tenant id, so no save-format change.
function tileSalesBasePSF(state: GameState, a: Pick<Asset, 'tileI' | 'quality'>): number {
  const t = state.tiles[a.tileI];
  const acc = t.acc ?? { art: 0, hwy: 0, rail: 0, quiet: 0 };
  // occupancy-cost gravity: a shop's sales run ~12.5x its rent (the 8% norm), because
  // rents ARE a share of sales — they co-move. The neighborhood moves sales around that
  // anchor, it doesn't detach them. (Detached sales made percentage rent explode on
  // cheap-rent blocks: the breakpoint collapsed while sales stayed high — free money.)
  const anchor = marketRentPSF(state, t, 'retail') / OCC_COST_NORM;
  return anchor
    * (0.90 + 0.12 * (t.pop / 100))
    * (0.96 + 0.08 * (state.econ.confidence / 100))
    * (0.90 + 0.16 * acc.art)
    * (state.econ.ecomMonthsLeft > 0 ? 0.92 : 1)
    * (0.94 + (a.quality / 150) * 0.10);
}
export function tenantSalesPSF(state: GameState, a: Pick<Asset, 'tileI' | 'quality'>, tn: Tenant): number {
  const draw = 0.75 + mulberry32((state.seed ^ Math.imul(tn.id, 0x85ebca6b)) | 0)() * 0.5 + tn.credit * 0.06;
  return tileSalesBasePSF(state, a) * draw;
}
// What a generic stabilized retail roll would collect in overage, $/SF/yr — the market
// prices this in. Overage was invisible to pricing before, which made every retail
// acquisition come with free income the seller never charged for.
export function expectedRetailOveragePSFYr(state: GameState, tileI: number, quality: number): number {
  const base = tileSalesBasePSF(state, { tileI, quality });
  const bp = retailBreakpointPSF(state, tileI);
  // integrate over the tenant-draw spread — the winners past the breakpoint carry it
  const draws = [0.82, 0.95, 1.06, 1.17, 1.30];
  let sum = 0;
  for (const d of draws) sum += Math.max(0, base * d - bp);
  return (sum / draws.length) * PCT_RENT_RATE;
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
  // a casualty in repair takes its share of the income offline; the expenses don't care
  const egiM = assetEGIMonthly(state, a) * (a.repair ? 1 - a.repair.frac : 1);
  const ex = expenseBreakdown(state, a, potM, egiM);
  // a property manager runs the portfolio 6% leaner; self-managing past ~7 buildings
  // costs 5% extra — somebody has to answer the 2am calls, and right now it's you
  const mgmt = state.staff?.pm ? 0.94 : (state.assets?.length ?? 0) > 7 ? 1.05 : 1;
  return egiM - ex.total * mgmt;
}

export function assetValue(state: GameState, a: Asset): number {
  if (a.mode === 'construction') {
    const p = a.project!;
    return a.basis * 0.55 + p.spent * 0.85;
  }
  const t = state.tiles[a.tileI];
  const stab = stabilizedNOI(state, a);
  let noi = stab;
  if (a.mode === 'operating') {
    // buyers underwrite the rent roll in place, not the pro forma: the upside to
    // stabilized gets partial credit — the next owner does that work, not you
    const potM = (a.sf * assetRentPSF(state, a)) / 12;
    const egiM = assetEGIMonthly(state, a) * (a.repair ? 1 - a.repair.frac : 1);
    const ex = expenseBreakdown(state, { ...a, maint: 'std' } as any, potM, egiM);
    const ip = (egiM - ex.total) * 12;
    noi = Math.max(0.45 * stab + 0.55 * Math.min(stab, Math.max(ip, 0) * 1.25), stab * 0.35);
  }
  let capPts = capRatePct(state, t, a.type, a.quality) + (isAggregate(a.type) ? 0 : creditCapAdjPts(a.tenants));
  // the design bet, marked to market: commodity product gets repriced hard in a downturn;
  // signature product holds its bid
  if (state.econ.phase === 'recession' && a.designTier) {
    if (a.designTier === 've') capPts += 0.35;
    else if (a.designTier === 'signature') capPts -= 0.20;
  }
  const cap = capPts / 100;
  const stabDiscount = a.mode === 'leaseup' ? clamp(0.75 + 0.25 * (a.occ / 0.85), 0.75, 1) : 1;
  let v = Math.max(0, (noi / cap) * stabDiscount);
  // an appraisal anchors to your own closing statement for the first year — a building
  // bought last quarter is worth what you paid plus what you can prove since
  const held = state.month - a.acqMonth;
  if (a.mode === 'operating' && held < 12 && a.basis > 0) v = Math.min(v, a.basis * (1.02 + 0.045 * held));
  return v;
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
function logDeal(s: GameState, e: DealLogEntry) {
  (s.dealLog ??= []).push(e);
  if (s.dealLog.length > 200) s.dealLog.shift();
}
export function netWorth(state: GameState): number {
  return state.cash
    + state.assets.reduce((s, a) => s + assetValue(state, a) - assetDebt(a) - lpClaim(state, a), 0)
    + state.land.reduce((s, h) => s + landValue(state, h) - (h.loan?.balance ?? 0), 0)
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
  const p = rng(state) + (quality / 150) * 0.34 + (D / 100) * 0.18;
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
function genRentRoll(state: GameState, a: Pick<Asset, 'tileI' | 'type' | 'sf' | 'units' | 'quality' | 'construction'> & { mix?: MixSplit; id?: number; cells?: number[]; px?: number; py?: number; pw?: number; ph?: number }, occ: number, lo = 0.90, hi = 1.08): Tenant[] {
  if (isAggregate(a.type)) return [];
  if (a.type === 'mixed') return genMixedRentRoll(state, a, occ, lo, hi);
  const tenants: Tenant[] = [];
  const t = state.tiles[a.tileI];
  const mkt = assetRentPSF(state, a as any);
  const su = suiteSF(a as any);
  // leases come in whole suites — a 1-unit building is either leased or it isn't
  const totalSuites = clamp(Math.round(a.units * occ), 0, a.units);
  let suitesLeft = totalSuites, assigned = 0;
  let guard = 0;
  while (suitesLeft > 0 && guard++ < 60) {
    const nUnits = Math.max(1, Math.min(suitesLeft, 1 + Math.floor(rng(state) * 3)));
    const last = suitesLeft - nUnits <= 0;
    const sf = last && totalSuites === a.units ? a.sf - assigned : Math.round(nUnits * su);
    const rate = mkt * rrange(state, lo, hi);
    const termLeft = Math.round(rrange(state, 8, 84));
    const termTotal = Math.max(termLeft + Math.round(rrange(state, 0, 36)), 36);
    const esc = [0, 2, 2.5, 3, 3][Math.floor(rng(state) * 5)];
    tenants.push({
      id: state.nextId++, name: tenantName(state, a.type), sf,
      rate: Math.round(rate * 100) / 100,
      startM: state.month - (termTotal - termLeft), endM: state.month + termLeft,
      credit: rollCredit(state, a.quality, t.D),
      escPct: esc,
      ...(rng(state) < 0.12 ? { optionRate: Math.round(rate * rrange(state, 1.02, 1.15) * 100) / 100, optionYears: 5 } : {}),
    });
    assigned += sf; suitesLeft -= nUnits;
  }
  return tenants;
}

// A mixed building's roll is three rolls: retail suites at retail rents, office
// suites at office rents, and the residential floors as one living block of homes.
function genMixedRentRoll(state: GameState, a: Pick<Asset, 'tileI' | 'type' | 'sf' | 'quality'> & { mix?: MixSplit; id?: number; cells?: number[]; px?: number; py?: number; pw?: number; ph?: number }, occ: number, lo = 0.90, hi = 1.08): Tenant[] {
  const tenants: Tenant[] = [];
  const t = state.tiles[a.tileI];
  const m = mixOf(state, a as any);
  for (const comp of MIX_COMPONENTS) {
    const csf = Math.round(a.sf * m[comp] / 100) * 100;
    if (csf < 600) continue;
    const compMkt = componentRentPSF(state, a as any, comp);
    if (comp === 'multifamily') {
      const units = Math.max(4, Math.round(csf / 950));
      const occUnits = clamp(Math.round(units * occ), 0, units);
      if (occUnits <= 0) continue;
      tenants.push({
        id: state.nextId++, name: `Residences — ${occUnits} of ${units} homes`,
        sf: Math.round(csf * occUnits / units),
        rate: Math.round(compMkt * rrange(state, lo, hi) * 100) / 100,
        startM: state.month - 6, endM: state.month + 9999,   // a living block, not a lease that expires
        credit: 1, escPct: 2.5, use: 'multifamily',
      });
      continue;
    }
    const su = comp === 'retail' ? rrange(state, 1800, 3400) : rrange(state, 2800, 6000);
    const n = Math.max(1, Math.round(csf / su));
    const leaseUnits = clamp(Math.round(n * occ), 0, n);
    let assigned = 0;
    for (let i = 0; i < leaseUnits; i++) {
      const sf = i === n - 1 && leaseUnits === n ? csf - assigned : Math.round(csf / n / 100) * 100;
      if (sf < 400) break;
      const termLeft = Math.round(rrange(state, 8, 84));
      const termTotal = Math.max(termLeft + Math.round(rrange(state, 0, 36)), 36);
      tenants.push({
        id: state.nextId++, name: tenantName(state, comp), sf,
        rate: Math.round(compMkt * rrange(state, lo, hi) * 100) / 100,
        startM: state.month - (termTotal - termLeft), endM: state.month + termLeft,
        credit: rollCredit(state, a.quality, t.D),
        escPct: [0, 2, 2.5, 3, 3][Math.floor(rng(state) * 5)],
        use: comp,
      });
      assigned += sf;
    }
  }
  return tenants;
}

// The era's secular story: strong enough that ANY ordering can happen — retail can
// be this generation's loser, office its darling. Handicaps first center the sectors'
// structural biases (retail runs hot, office runs cold), then a sum-neutral shuffle
// decides who this era loves. Measured so a NEUTRAL roll puts the four sectors at
// rough parity — the random part then genuinely decides winners. Rolled at genesis
// and re-rolled every generation (see tickEraRotation): no sector stays the darling
// for a whole century.
function rollEra(r: () => number): Economy['era'] {
  const HANDICAP: Record<string, number> = { office: 0.087, retail: -0.094, industrial: 0.028, multifamily: -0.021 };
  const raw: Record<string, number> = { office: r(), retail: r(), industrial: r(), multifamily: r() };
  const avg = (raw.office + raw.retail + raw.industrial + raw.multifamily) / 4;
  const tiltOf = (ty: string) => Math.round((HANDICAP[ty] + (raw[ty] - avg) * 0.15) * 1000) / 1000;
  return {
    rateBias: Math.round((-1.0 + r() * 2.4) * 100) / 100,   // -1.0 .. +1.4 pts on every rate target
    inflBias: Math.round((-0.5 + r() * 1.5) * 100) / 100,   // -0.5 .. +1.0 on inflation targets
    vol: Math.round((0.75 + r() * 0.7) * 100) / 100,        // calm seas or whitewater
    tempo: Math.round((0.8 + r() * 0.5) * 100) / 100,       // fast-cycling or long, slow eras
    sectorTilt: { office: tiltOf('office'), retail: tiltOf('retail'), industrial: tiltOf('industrial'), multifamily: tiltOf('multifamily') },
  };
}
const ERA_SECTORS = ['office', 'retail', 'industrial', 'multifamily'] as const;
function eraExtremes(era: Economy['era']): { best: PType; worst: PType } {
  let best: PType = 'office', worst: PType = 'office';
  for (const ty of ERA_SECTORS) {
    if ((era.sectorTilt?.[ty] ?? 0) > (era.sectorTilt?.[best] ?? 0)) best = ty;
    if ((era.sectorTilt?.[ty] ?? 0) < (era.sectorTilt?.[worst] ?? 0)) worst = ty;
  }
  return { best, worst };
}
// Secular regimes turn slowly: every 15-25 years the era re-rolls, then takes three
// years to blend in — a wind shifting, not a light switch. The player who reads the
// turn early repositions a decade ahead of the market.
function tickEraRotation(s: GameState) {
  const e = s.econ;
  if (e.eraMonthsLeft === undefined) e.eraMonthsLeft = 180 + Math.floor(rng(s) * 120);
  e.eraMonthsLeft--;
  if (e.eraNext) {
    const k = 1 / Math.max(1, e.eraMonthsLeft + 1);
    e.era.rateBias += (e.eraNext.rateBias - e.era.rateBias) * k;
    e.era.inflBias += (e.eraNext.inflBias - e.era.inflBias) * k;
    e.era.vol += (e.eraNext.vol - e.era.vol) * k;
    e.era.tempo += (e.eraNext.tempo - e.era.tempo) * k;
    const tilt = (e.era.sectorTilt ??= {});
    for (const ty of ERA_SECTORS) tilt[ty] = (tilt[ty] ?? 0) + ((e.eraNext.sectorTilt?.[ty] ?? 0) - (tilt[ty] ?? 0)) * k;
    if (e.eraMonthsLeft <= 0) {
      const { best, worst } = eraExtremes(e.eraNext);
      e.era = e.eraNext;
      e.eraNext = undefined;
      e.eraMonthsLeft = 180 + Math.floor(rng(s) * 120);
      pushNews(s, 'event', `A NEW ERA HAS SETTLED IN: ${PLABEL[best].toLowerCase()} is this generation's darling, ${PLABEL[worst].toLowerCase()} its castoff. The last era's playbook now reads like your grandfather's.`);
    }
  } else if (e.eraMonthsLeft <= 0) {
    e.eraNext = rollEra(() => rng(s));
    e.eraMonthsLeft = 36;
    const { best, worst } = eraExtremes(e.eraNext);
    pushNews(s, 'event', `THE WIND IS TURNING: the smart money is quietly rotating toward ${PLABEL[best].toLowerCase()} and out of ${PLABEL[worst].toLowerCase()}. Secular shifts take years to finish — and reward whoever repositions first.`);
  }
}

// ---------- Initial state ----------
export function newGame(seed?: number, opts?: { sandbox?: boolean; city?: CityKind }): GameState {
  const s0 = seed ?? Math.floor(Math.random() * 2 ** 31);
  const { tiles, corridor, roads } = generateCity(s0, opts?.city ?? 'island');
  const state: GameState = {
    seed: s0, rngCursor: s0 ^ 0x1234567,
    month: 0, tiles,
    econ: {
      phase: 'recovery', phaseAge: 6,
      rate: 4.0, rateSmooth: 4.2, inflation: 2.2, empIdx: 97, confidence: 52, popGrowth: 1.1, costIdx: 1,
      era: rollEra(mulberry32((s0 ^ 0x5EEDECA7) | 0)),
      rentIdx: { office: 1, retail: 1, industrial: 1, mixed: 1, multifamily: 1 },
      cityVac: { ...EQ_VAC },
      rentMom: { office: 0, retail: 0, industrial: 0, mixed: 0, multifamily: 0 },
      hadCrunch: false, crunchMonthsLeft: 0, tariffMonthsLeft: 0, ecomMonthsLeft: 0,
    },
    cash: opts?.sandbox ? 50_000_000 : CONFIG.START_CASH, reputation: opts?.sandbox ? 60 : 20, tier: opts?.sandbox ? CONFIG.tiers.length - 1 : 0,
    sandbox: opts?.sandbox || undefined,
    city: opts?.city ?? 'island',
    stock: [],
    assets: [], listings: [], lois: [], facilities: [], saleOffers: [],
    comps: [], autoLease: false, prefer1031: false,
    land: [], migrations: [],
    taxYr: { noi: 0, interest: 0, depr: 0 }, nolCarry: 0,
    firms: [
      { name: 'Sterling Capital', short: 'STR', style: 'core', cash: 14_400_000, debt: 0, netWorth: 48_000_000, alive: true },
      { name: 'Vertex Development', short: 'VTX', style: 'aggressive', cash: 6_600_000, debt: 0, netWorth: 22_000_000, alive: true },
      { name: 'Ironclad Industrial', short: 'IRN', style: 'industrial', cash: 9_300_000, debt: 0, netWorth: 31_000_000, alive: true },
      { name: 'Copperline Partners', short: 'CPL', style: 'value-add', cash: 4_200_000, debt: 0, netWorth: 14_000_000, alive: true },
      { name: 'Harborview Residential', short: 'HBV', style: 'mf', cash: 7_800_000, debt: 0, netWorth: 26_000_000, alive: true },
      { name: 'Granite Peak Holdings', short: 'GPH', style: 'core', cash: 11_400_000, debt: 0, netWorth: 38_000_000, alive: true },
      { name: 'Bluestem Development', short: 'BLU', style: 'aggressive', cash: 2_700_000, debt: 0, netWorth: 9_000_000, alive: true },
      { name: 'Foundry Row Capital', short: 'FDR', style: 'value-add', cash: 3_300_000, debt: 0, netWorth: 11_000_000, alive: true },
      { name: 'Kestrel Logistics Trust', short: 'KST', style: 'industrial', cash: 5_700_000, debt: 0, netWorth: 19_000_000, alive: true },
      { name: 'Aria Residential Group', short: 'ARG', style: 'mf', cash: 4_800_000, debt: 0, netWorth: 16_000_000, alive: true },
    ],
    news: [], effects: [], scheduledEvents: [],
    nwHistory: [], econHistory: [],
    nextId: 1, pending: [], lastMonthCF: 0, negCashStreak: 0,
    lastScoutMonth: -99, approachesLeft: 3, parcelApproach: {}, dealLog: [], firmLand: [],
    rezonings: [], rezoneDenied: {}, swans: [],
    gameOver: false, transitCorridor: corridor, roads,
    totalRealizedProfit: 0, dealsClosed: 0,
    cfLog: [],
    staff: { analyst: false, pm: false, leasing: false, cm: false },
    lenderRel: { fnb: 30, hbv: 20, col: 12, ibx: 20, mst: 10 },   // the hometown bank starts warmest
    auctions: [], btsRfps: [], rivalry: {},
    version: 32,
  };
  generateStock(state);
  // Firms open with real books: they already own the buildings generation assigned
  // them; debt is solved so cash + portfolio - debt equals the target net worth.
  // A firm whose buildings outrun the target simply opens leveraged, like a real one.
  for (const f of state.firms) {
    const target = f.netWorth;
    const port = firmPortfolioValue(state, f.short);
    if (f.cash + port < target) f.cash = target - port;   // gen gave them little dirt: the rest is dry powder
    f.debt = Math.max(0, Math.round(f.cash + port - target));
    f.netWorth = Math.round(f.cash + port - f.debt);
  }
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
    : 'Welcome to New Amsterdam. You have $600K of equity, five lenders in town, and a young city with room to grow. Buy well.');
  {
    // every era has its conventional wisdom — right until it isn't
    const st = state.econ.era.sectorTilt;
    if (st) {
      const NAME: Record<string, string> = { office: 'office towers', retail: 'retail', industrial: 'logistics', multifamily: 'apartments' };
      const keys = Object.keys(st);
      const best = keys.sort((a, b) => (st[b as PType] ?? 0) - (st[a as PType] ?? 0))[0];
      const worst = keys[keys.length - 1];
      pushNews(state, 'info', `The era's conventional wisdom, per every panel and podcast: the smart money is crowding into ${NAME[best]}, and nobody wants to underwrite ${NAME[worst]}. Conventional wisdom runs long cycles — and it is right until, suddenly, it isn't.`);
    }
  }
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
// every dollar gets a line — the income statement is built from these
function logCF(s: GameState, cat: CFCat, label: string, amt: number) {
  if (!s.cfLog) return;   // older saves mid-migration
  if (Math.abs(amt) < 1) return;
  s.cfLog.push({ m: s.month, cat, label, amt: Math.round(amt) });
}

// ---------- Listings ----------
function buildableTiles(state: GameState): Tile[] { return state.tiles.filter(t => !t.water); }

// NOI as a share of collected rent, net of recoveries — the shorthand a land buyer
// pencils with before anyone opens a spreadsheet
const NOI_MARGIN: Record<PType, number> = { office: 0.63, retail: 0.85, industrial: 0.95, mixed: 0.65, multifamily: 0.51 };

export function landPricePerAcre(state: GameState, t: Tile): number {
  const psfLand = (3 + Math.pow(t.D / 100, 2.2) * 55) * (t.indSuit > 55 ? 0.8 : 1);
  // land trades on what you're ALLOWED to build. Upzoned dirt is worth more the day
  // the council votes — which is the entire entitle-and-flip business.
  const zf = t.zone ? (t.zone.tier === 1 ? 0.86 : t.zone.tier === 3 ? 1.24 : 1) : 1;
  const curve = psfLand * 43_560 * state.econ.costIdx * zf;
  // RESIDUAL value: what a builder could actually pay for this dirt today — achievable
  // rent to NOI to value at today's cap, minus today's construction cost, times the
  // density the zoning permits. Rents boom and land runs; costs spike or caps blow
  // out and the same acre is suddenly worth less. The curve anchors it (location
  // always carries a floor and a hope premium); the residual bends it.
  let bestRlv = 0;
  const allowed = t.zone ? ZONE_ALLOWS[t.zone.use] : PTYPES;
  for (const ty of allowed) {
    const rent = marketRentPSF(state, t, ty);
    const noiPSF = rent * (1 - state.econ.cityVac[ty] / 100) * NOI_MARGIN[ty];
    const spec = CONSTR[ty][1] ?? CONSTR[ty][0];
    const cap = capRatePct(state, t, ty, spec.q) / 100;
    const valPSF = noiPSF / cap;
    const costPSF = spec.cost * constrCostIdx(state) * 1.32;   // hard + soft + fees
    const density = FAR[ty] * (t.zone ? zoneTierMult(t.zone.tier) : 1);
    const rlv = Math.max(0, valPSF - costPSF) * 0.62 * density * 43_560;   // builder keeps a margin
    if (rlv > bestRlv) bestRlv = rlv;
  }
  // weighted so the GENERATED city prices ~neutral (p50 ≈ 1.0x the curve) and the
  // residual bends it through the cycle rather than repricing day one
  return curve * clamp(0.55 + 0.37 * (bestRlv / Math.max(1, curve)), 0.62, 1.6);
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
    // The city starts young and it starts DOWNTOWN: dense core, thinning ring, and a
    // fringe where most blocks are still dirt — the frontier is the campaign's job.
    // Low-desirability blocks roll to exist at all; the ones that miss stay empty.
    if (t.D < 42 && rng(state) > Math.pow(t.D / 42, 1.7)) continue;
    const dens = clamp(0.02 + Math.pow(t.D / 100, 2.1) * 0.85 + (t.indSuit > 62 ? 0.03 : 0), 0.02, t.zone.tier === 3 ? 0.9 : 0.66) * (t.indSuit > 62 ? 0.75 : 1);
    const budget = Math.round(dens * PGRID * PGRID * (t.D >= 62 ? 0.6 : 0.5)); // day-one fill, core-weighted
    // each use competes for land in proportion to the acreage its demand implies
    // zoning shapes what got built: nonconforming stock exists (it predates the paper) but it's the exception
    const weights: [PType, number][] = PTYPES.map(ty => [ty, tileCapacitySF(t, ty) / (FAR[ty] * 43_560 * PARCEL_AC) * (zoneAllows(t.zone, ty) ? 1 : 0.12)] as [PType, number]);
    let used = 0, guard = 0;
    while (used < budget && guard++ < 12) {
      const tot = weights.reduce((s2, w) => s2 + w[1], 0);
      let pick = rng(state) * tot; let ty: PType = 'retail';
      for (const [tt, w] of weights) { pick -= w; if (pick <= 0) { ty = tt; break; } }
      const [lo, hi0] = STOCK_SIZE[ty];
      // the core generates real towers: office and mixed stock on tier-3 paper runs big
      const hi = t.zone.tier === 3 && ty === 'office' ? 140_000 : t.zone.tier === 3 && ty === 'mixed' ? 80_000 : hi0;
      const room = Math.max(1, budget - used);
      const maxSF = room * PARCEL_AC * 43_560 * FAR[ty] * zoneTierMult(t.zone.tier);
      let sf = Math.round(clamp(rrange(state, lo, hi), lo, Math.max(lo, maxSF)) / 1000) * 1000;
      if (sf > maxSF) { if (lo > maxSF) break; sf = Math.round(maxSF / 1000) * 1000; }
      const quality = clamp(rrange(state, 33, 117) + (t.D - 50) * 0.22, 22, 132);
      const specPick = constrForQuality(ty, quality);
      const need = Math.max(specPick.minCells ?? 1, parcelsNeeded(sf, ty, t.zone.tier));
      const spot = findFreeRect(state, t.i, need, () => rng(state));
      if (!spot) break;
      const df = tileDemandFactor(state, t, ty);
      // day-one occupancy centers where the market model will hold it — a going
      // concern, not a city-wide lease-up in progress
      const occ = clamp(rrange(state, 0.72, 0.97) * clamp(0.78 + df * 0.2, 0.85, 1.05), 0.35, 0.97);
      state.stock.push({
        id: state.nextId++, tileI: t.i, type: ty, sf,
        px: spot.px, py: spot.py, pw: spot.pw, ph: spot.ph,
        units: genUnitsFor(state, ty, sf),
        quality, age: Math.round(rrange(state, 4, 55)),
        construction: constrForQuality(ty, quality).id,
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
    if (f.style === 'core') return (ty === 'office' || ty === 'mixed' || ty === 'retail') && quality > 82 && t.D > 50 ? 6 : 0.1;
    if (f.style === 'value-add') return quality < 72 && ty !== 'multifamily' ? 5 : 0.15;
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
  for (let i = 0; i < (state.firmLand ?? []).length; i++) if (state.firmLand[i].tileI === tileI) mark(state.firmLand[i].cells, 2_000_000 + i);
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

export function parcelsNeeded(sf: number, type: PType, tier: 1 | 2 | 3 = 2): number {
  return Math.max(1, Math.min(PGRID * PGRID, Math.ceil(sf / (FAR[type] * zoneTierMult(tier) * 43_560) / PARCEL_AC)));
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
  // a building's footprint reflects its floor area: a corner store doesn't get to
  // sprawl across four parcels of land it doesn't use
  const slack = need <= 2 ? 0 : need <= 5 ? 1 : 2;
  const shapes: [number, number][] = [];
  for (let w = 1; w <= PGRID; w++) for (let h = 1; h <= PGRID; h++) if (w * h >= need && w * h <= need + slack) shapes.push([w, h]);
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
// SF-weighted credit of a rent roll, mapped to a cap adjustment: an A-credit roll
// trades ~15bps tight, a C-credit roll ~45bps wide. Buyers underwrite the covenant.
export function creditCapAdjPts(tenants: Tenant[]): number {
  if (!tenants.length) return 0;
  const sfTot = tenants.reduce((x, tn) => x + tn.sf, 0);
  if (sfTot <= 0) return 0;
  const wavg = tenants.reduce((x, tn) => x + tn.credit * tn.sf, 0) / sfTot;   // 0=C .. 2=A
  return (1 - wavg / 2) * 0.6 - 0.15;
}
function pricingValue(state: GameState, spec: { tileI: number; type: PType; sf: number; quality: number; units: number; construction: string }, tenants: Tenant[]): number {
  const t = state.tiles[spec.tileI];
  const cap = (capRatePct(state, t, spec.type, spec.quality) + creditCapAdjPts(tenants)) / 100;
  const stab = stabilizedNOI(state, spec as any);
  const potM = (spec.sf * assetRentPSF(state, spec as any)) / 12;
  const overM = spec.type === 'retail' ? retailOverageMonthly(state, { tileI: spec.tileI, type: 'retail', quality: spec.quality, tenants } as any) : 0;
  const egiM = (isAggregate(spec.type) ? potM * ((spec as any).occ ?? 0.9) : tenants.reduce((s2, tn) => s2 + tn.sf * tn.rate, 0) / 12) + overM;
  const ex = expenseBreakdown(state, { ...spec, maint: 'std', tenants } as any, potM, egiM);
  const ip = (egiM - ex.total) * 12;
  const blendNOI = 0.45 * stab + 0.55 * Math.min(stab, Math.max(ip, 0) * 1.25);
  return Math.max(blendNOI, stab * 0.35) / cap;
}

function spawnLandListing(state: GameState) {
  const t = rpick(state, buildableTiles(state));
  if (!t) return;
  const need = 2 + Math.floor(rng(state) * 6);
  const spot = findFreeRect(state, t.i, need, () => rng(state));
  if (!spot) return;
  const acres = Math.round(spot.pw * spot.ph * PARCEL_AC * 100) / 100;
  state.listings.push({
    id: state.nextId++, tileI: t.i, kind: 'land', acres, parcel: spot,
    price: parcelPrice(state, t.i, spot.pw, spot.ph), resFrac: rrange(state, 0.88, 0.97),
    listMonth: state.month, offersLeft: 3, expiresMonth: state.month + 5 + Math.floor(rng(state) * 3), hot: rng(state) < 0.2,
  });
}

function spawnListing(state: GameState, starter = false) {
  const t = rpick(state, buildableTiles(state));
  const id = state.nextId++;
  const isLand = rng(state) < 0.62;
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
      ? b.sf <= 12000 && b.occ >= 0.80 && b.quality >= 60
      : true));
    if (starter && pool.length === 0) pool = state.stock.filter(b => !b.listedId && b.sf <= 16000 && b.occ >= 0.7);
    if (starter && pool.length === 0) pool = state.stock.filter(b => !b.listedId && b.sf <= 18000);
    if (pool.length === 0) { state.nextId--; return; }
    // struggling buildings come to market more often — that's who sells
    const weight = (b: StockBuilding) => 1 + (b.occ < 0.62 ? 1.6 : 0) + (b.quality < 57 ? 0.8 : 0) + (b.owner !== 'private' ? 0.4 : 0);
    let tot = 0; for (const b of pool) tot += weight(b);
    let pick = rng(state) * tot; let b = pool[0];
    for (const cand of pool) { pick -= weight(cand); if (pick <= 0) { b = cand; break; } }
    listStockBuilding(state, b, { id, starter, hot, expiresMonth });
  }
}

function listStockBuilding(state: GameState, b: StockBuilding, opt: { id?: number; starter?: boolean; hot?: boolean; expiresMonth?: number; distressed?: boolean; priceMult?: number }) {
  // one flyer per building: not while it's already listed, not while it's on the steps
  if (b.listedId !== undefined || state.auctions?.some(au => au.stockId === b.id)) return null;
  const id = opt.id ?? state.nextId++;
  const distressed = opt.distressed ?? (b.occ < 0.62 || (b.quality < 57 && rng(state) < 0.5));
  const probe = { tileI: b.tileI, type: b.type, sf: b.sf, quality: b.quality, units: b.units, construction: b.construction, mix: b.type === 'mixed' ? mixOf(state, b) : undefined, id: b.id };
  const tenants = distressed
    ? genRentRoll(state, { ...probe }, b.occ, 0.82, 1.0)
    : genRentRoll(state, { ...probe }, b.occ);
  const val = pricingValue(state, { ...probe, occ: b.occ } as any, tenants);
  // the discount matches what's actually wrong: broken income is priced to move;
  // a tired-but-full building gets a haircut, not a fire sale — old paint still cashes rent
  const mult = opt.priceMult ?? (distressed
    ? (b.occ < 0.62 ? rrange(state, 0.72, 0.85) : rrange(state, 0.87, 0.94))
    : rrange(state, 0.95, 1.10));
  const l: Listing = {
    id, tileI: b.tileI, kind: 'building',
    type: b.type, sf: b.sf, units: b.units, occ: b.occ, quality: b.quality, age: b.age,
    construction: b.construction, distressed,
    mix: b.type === 'mixed' ? mixOf(state, b) : undefined,
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
  // brokers don't leave silent bargains on the flyer: a non-distressed listing prices
  // within ~160bps of its market cap, or it trades by phone before you ever see it.
  // Distress is the exception — the discount is the story, and everyone can smell it.
  if (!distressed) {
    const noiIp2 = inPlaceNOIYr(state, l);
    const t2 = state.tiles[b.tileI];
    const capGuard = (capRatePct(state, t2, b.type, b.quality) + 1.6) / 100;
    if (noiIp2 > 0 && noiIp2 / l.price > capGuard) l.price = roundPrice(noiIp2 / (capGuard * rrange(state, 0.90, 1.0)));
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
  logCF(s, 'fees', 'Broker canvass', -CONFIG.scoutCost);
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
  const probe = { tileI: b.tileI, type: b.type, sf: b.sf, quality: b.quality, units: b.units, construction: b.construction, mix: b.type === 'mixed' ? mixOf(s, b) : undefined, id: b.id };
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
    mix: b.type === 'mixed' ? mixOf(s, b) : undefined,
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
  if (b.listedId) return { ok: false, why: 'It\'s already on the market — see the marketplace.' };
  if (b.blacklist) return { ok: false, why: 'This owner stopped taking your calls after your last offer.' };
  if (b.owner !== 'private') return { ok: false, why: `${state.firms.find(f => f.short === b.owner)?.name ?? 'An institution'} owns this one — they don't sell over a phone call.` };
  if (b.approachedM !== undefined && state.month - b.approachedM < 6) return { ok: false, why: 'You asked recently. Owners remember — but memories fade; try again in a few months.' };
  if (state.approachesLeft <= 0) return { ok: false, why: 'You\'ve made your 3 calls this month. Even hustle has office hours — more next month.' };
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

export function makeOffer(state: GameState, listingId: number, amount: number): { s: GameState; result: 'accepted' | 'countered' | 'declined' | 'gone'; counter?: number; msg?: string } {
  const s = clone(state);
  const l = s.listings.find(x => x.id === listingId);
  if (!l || l.yourSale || l.declinedYou || l.parentAssetId) return { s, result: 'gone' };
  // no zero-dollar theater: a number under four figures never reaches the seller,
  // costs you nothing, and can't generate a counter
  if (!isFinite(amount) || amount < 1000) return { s, result: 'declined', msg: 'The broker won\'t present that number. Offers start with real money.' };
  l.playerEngaged = true;   // the brokers saw your number — rivals hear about deals in play
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
  if (amount >= l.price * 0.8 && l.price > 0 && !(l as any).graceUsed) {
    // close enough to be serious: they scoff, but they'll hear one more number.
    // Counter at a real figure — a no-ask lead's sticker is zero, and zero is not a counter.
    (l as any).graceUsed = true;
    l.offersLeft = Math.max(l.offersLeft ?? 0, 1);
    const gc = roundPrice(Math.max(l.price, res * rrange(s, 1.0, 1.05)));
    pushNews(s, 'info', `The seller waved off your ${fmtMoney(amount)} — but you were close enough that the broker says one more number gets read.`);
    return { s, result: 'countered', counter: gc };
  }
  s.reputation = clamp(s.reputation - 1.5, 0, 100); // word gets around about lowballers
  let msg: string;
  if (l.kind === 'offmarket') {
    const sb = l.stockId ? s.stock.find(b => b.id === l.stockId) : undefined;
    if (sb) { sb.blacklist = true; sb.listedId = undefined; }
    s.listings = s.listings.filter(x => x.id !== listingId);
    msg = `The off-market owner took your ${fmtMoney(amount)} offer as an insult. They've hung up for good — that door doesn't reopen.`;
  } else {
    l.declinedYou = true;
    msg = l.kind === 'land'
      ? `The landowner won't deal with you after that ${fmtMoney(amount)} offer. Dirt has feelings too, apparently.`
      : `The seller of the ${((l.sf ?? 0) / 1000).toFixed(0)}K SF ${PLABEL[l.type!]} listing won't deal with you after that ${fmtMoney(amount)} offer. Brokers talk.`;
  }
  pushNews(s, 'warn', msg);
  return { s, result: 'declined', msg };
}

// ---------- Actions ----------
export function clone(state: GameState): GameState {
  // structuredClone is ~25-40% faster than a JSON round-trip on a full late-game state;
  // both drop functions/undefined the same way for this plain-data shape
  return typeof structuredClone === 'function' ? structuredClone(state) : JSON.parse(JSON.stringify(state));
}

export function doFeasibility(state: GameState, listingId: number): GameState {
  const s = clone(state);
  const l = s.listings.find(x => x.id === listingId);
  if (!l || s.cash < CONFIG.feasCost) return s;
  s.cash -= CONFIG.feasCost;
  logCF(s, 'fees', 'Feasibility study', -CONFIG.feasCost);
  l.feasDone = true;
  l.playerEngaged = true;   // consultants on site — the whole market knows you're circling
  return s;
}

export function maxLTV(state: GameState, type?: PType): number {
  let ltv = CONFIG.acqLTV + (type === 'industrial' ? CONFIG.indLTVBonus : 0);
  if (state.econ.crunchMonthsLeft > 0) ltv -= 0.10;
  return ltv;
}

export function inPlaceNOIYr(state: GameState, l: Listing): number {
  const probe = { tileI: l.tileI, type: l.type!, sf: l.sf!, quality: l.quality!, units: l.units ?? 1, construction: l.construction ?? CONSTR[l.type!][0].id, maint: 'std' as const, tenants: l.tenants ?? [], mix: l.mix, id: l.stockId };
  const potM = (l.sf! * assetRentPSF(state, probe as any)) / 12;
  const overM = l.type === 'retail' ? retailOverageMonthly(state, probe as any) : 0;
  const egiM = (isAggregate(l.type!) ? potM * (l.occ ?? 0) : (l.tenants ?? []).reduce((s2, t) => s2 + t.sf * t.rate, 0) / 12) + overM;
  const ex = expenseBreakdown(state, probe as any, potM, egiM);
  return (egiM - ex.total) * 12;
}

export type AcqLoanOpt = 'std' | 'short' | 'io';
export const ACQ_LOANS: Record<AcqLoanOpt, { label: string; spreadAdj: number; amortYears: number; ioMonths: number; desc: string }> = {
  std: { label: '30-yr amortization', spreadAdj: 0, amortYears: 30, ioMonths: 0, desc: 'The standard sheet — nothing clever, nothing fragile.' },
  short: { label: '25-yr am · −25bps', spreadAdj: -0.25, amortYears: 25, ioMonths: 0, desc: 'Faster paydown buys a sharper rate. Less cash flow, more equity.' },
  io: { label: '10-yr interest-only', spreadAdj: 0.4, amortYears: 30, ioMonths: 120, desc: 'Maximum cash flow now; the principal is still there in year eleven. IO money runs 75-150bps over the 25-year sheet, and the quote is the quote.' },
};
// IO money prices 75-150bps over the 25-year sheet, quoted deal by deal — seeded per
// listing so shopping the same deal twice gets the same answer.
export function acqLoanSpreadAdj(s: GameState, listingId: number, opt: AcqLoanOpt): number {
  if (opt !== 'io') return ACQ_LOANS[opt].spreadAdj;
  const r = mulberry32((s.seed ^ Math.imul(listingId + 1, 0x9E3779B9) ^ 0x10AB) | 0)();
  return Math.round((ACQ_LOANS.short.spreadAdj + 0.75 + r * 0.75) * 100) / 100;
}
export function acqLoanRate(s: GameState, listingId: number, opt: AcqLoanOpt): number {
  return s.econ.rate + CONFIG.acqSpread + acqLoanSpreadAdj(s, listingId, opt);
}
export function buyBuilding(state: GameState, listingId: number, downPct: number, useJV = false, loanOpt: AcqLoanOpt = 'std', lenderId?: string): { s: GameState; err?: string } {
  const s = clone(state);
  const l = s.listings.find(x => x.id === listingId);
  if (!l || l.kind === 'land') return { s, err: 'Listing gone.' };
  if (l.yourSale) return { s, err: 'That\'s your own listing — delist it if you\'ve changed your mind.' };
  if (l.kind === 'offmarket' && !l.agreed) return { s, err: 'The seller hasn\'t agreed to a price yet — make an offer first.' };
  const down = l.price * downPct;
  const loanAmt = l.price - down;
  const ltv = loanAmt / l.price;
  if (!lenderId && ltv > maxLTV(s, l.type) + 1e-6) return { s, err: 'Bank will not exceed ' + Math.round(maxLTV(s, l.type) * 100) + '% LTV.' };
  const jvChk = useJV ? canJV(s, down) : null;
  if (useJV && jvChk && !jvChk.ok) return { s, err: jvChk.why };
  const yourEquity = useJV ? Math.round(down * 0.30) : down;
  if (s.cash < yourEquity + 15000) return { s, err: 'Not enough cash for the down payment plus closing costs.' };
  let lo: { amortYears: number; ioMonths: number } = ACQ_LOANS[loanOpt];
  let rate = acqLoanRate(s, listingId, loanOpt);
  if (lenderId && loanAmt > 0) {
    const q = lenderQuote(s, lenderId, { price: l.price, type: l.type!, quality: l.quality ?? 75 });
    if (!q.ok) return { s, err: `${LENDERS.find(x => x.id === lenderId)?.short}: ${q.why}` };
    if (ltv > q.maxLTV + 1e-6) return { s, err: `${LENDERS.find(x => x.id === lenderId)?.short} tops out at ${Math.round(q.maxLTV * 100)}% LTV on this one.` };
    lo = { amortYears: q.amortYears, ioMonths: q.ioMonths };
    rate = Math.round(q.ratePct * 100) / 100;
  }
  const pmt = monthlyPayment(loanAmt, rate, lo.amortYears);
  const noiYr = inPlaceNOIYr(s, l);
  // at 50% LTV or less, the collateral speaks for itself — a loan is always available.
  // Above it, each desk applies ITS OWN coverage floor: the banks want 1.25x, the life
  // company 1.35x, and Ironbridge will carry 0.75x — lending on anything is their brand.
  if (ltv > 0.501 && loanAmt > 0) {
    const dscrIn = noiYr / (pmt * 12);
    if (lenderId) {
      const floor = LENDER_MIN_DSCR[lenderId] ?? CONFIG.minDSCR;
      if (dscrIn < floor) {
        const nm = LENDERS.find(x => x.id === lenderId)?.short ?? 'The lender';
        return { s, err: lenderId === 'ibx'
          ? `Even Ironbridge wants a path to the coupon: ${dscrIn.toFixed(2)}× coverage is under their ${floor.toFixed(2)}× floor. Less leverage — or a building that earns something.`
          : `${nm} passes at ${dscrIn.toFixed(2)}× coverage — their floor is ${floor.toFixed(2)}×. Ironbridge would look at it, at their price.` };
      }
    } else {
      if (dscrIn < CONFIG.minDSCR && !l.distressed && l.kind !== 'offmarket') {
        return { s, err: 'DSCR ' + dscrIn.toFixed(2) + '× is below the bank minimum of 1.25×. Ironbridge carries thin coverage at a price — or put 50% down and any bank lends on the collateral alone.' };
      }
      if (dscrIn < 0.9) {
        return { s, err: 'Even a bridge lender needs ~0.9× coverage at this leverage. Drop to 50% LTV and the loan is yours.' };
      }
    }
  }
  s.cash -= yourEquity + 15000;
  logCF(s, 'buy', `Acquisition equity + closing — listing ${l.id}`, -(yourEquity + 15000));
  {
    const srcB = l.stockId ? s.stock.find(x => x.id === l.stockId) : undefined;
    const seller = srcB ? s.firms.find(x => x.short === srcB.owner) : undefined;
    if (seller) { seller.cash += l.price * 0.45; seller.debt = Math.max(0, seller.debt - l.price * 0.55); }
  }
  const t = s.tiles[l.tileI];
  const a: Asset = {
    id: s.nextId++, name: nameFor(s, l.type!), tileI: l.tileI, type: l.type!,
    sf: l.sf!, acres: l.acres ?? Math.round((l.sf! / FAR[l.type!] / 43560) * 100) / 100,
    px: l.parcel?.px, py: l.parcel?.py, pw: l.parcel?.pw, ph: l.parcel?.ph,
    cells: l.parcelCells ? [...l.parcelCells] : undefined,
    units: l.units ?? 1, construction: l.construction ?? CONSTR[l.type!][0].id,
    mix: l.type === 'mixed' ? (l.mix ?? defaultMixSplit(s.seed, l.stockId ?? l.id)) : undefined,
    quality: l.quality!, qCap: constrSpec({ type: l.type!, construction: l.construction ?? CONSTR[l.type!][0].id }).qCap,
    age: l.age!, mode: 'operating',
    tenants: (l.tenants ?? []).map(tn => ({ ...tn })), occ: 0,
    rentStance: 0, maint: 'std',
    loans: loanAmt > 0 ? [{ id: s.nextId++, kind: 'acq', balance: loanAmt, ratePct: rate, amortYears: lo.amortYears, ioMonthsLeft: lo.ioMonths, monthlyPmt: pmt, maturityMonth: s.month + CONFIG.loanTermMonths, lenderId, covenant: ltv > 0.501 && noiYr / (pmt * 12) >= 1.2 } as any] : [],
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
  if (lenderId && loanAmt > 0) bumpLenderRel(s, lenderId, 2);   // a closed loan starts a file
  logComp(s, { m: s.month, type: a.type, sf: a.sf, price: l.price, capPct: l.price > 0 ? Math.round((inPlaceNOIYr(s, l) / l.price) * 10000) / 100 : null, tileI: a.tileI, buyer: 'You' });
  logDeal(s, { m: s.month, action: 'buy', name: a.name, type: a.type, sf: a.sf, price: l.price, capPct: l.price > 0 ? Math.round((inPlaceNOIYr(s, l) / l.price) * 10000) / 100 : null });
  pushNews(s, 'deal', `You acquired ${a.name} (${(l.sf! / 1000).toFixed(0)}K SF ${PLABEL[l.type!]}, ${a.tenants.length} tenant${a.tenants.length === 1 ? '' : 's'}) for ${fmtMoney(l.price)} at ${Math.round(ltv * 100)}% LTV${l.kind === 'offmarket' ? ' — off market' : ''}.`);
  return { s };
}

const NAMES = ['Alder', 'Beacon', 'Cascade', 'Drummond', 'Ellsworth', 'Foundry', 'Granite', 'Halstead', 'Ironwood', 'Junction', 'Keystone', 'Larkspur', 'Meridian', 'Northfield', 'Oakline', 'Pemberton', 'Quarry', 'Rowan', 'Sterling', 'Tanner', 'Union', 'Vantage', 'Whitfield'];
function nameFor(state: GameState, type: PType): string {
  const base = NAMES[Math.floor(rng(state) * NAMES.length) % NAMES.length];
  const suffix = type === 'office' ? 'Tower' : type === 'retail' ? 'Commons' : type === 'industrial' ? 'Works' : type === 'multifamily' ? 'Flats' : 'Exchange';
  return `${base} ${suffix}`;
}

// Every standing building has a name — the one on the monument sign, the one the
// brokers use on the phone. Derived, not stored: seeded off the campaign and the
// building's id, so it never changes and costs the save file nothing. Two Larkspurs
// in one city is not a bug; it's Tuesday.
const NAMES2 = ['Aldrich', 'Bellamy', 'Corliss', 'Dunmore', 'Everett', 'Fairbank', 'Gresham', 'Hollis', 'Ivywood', 'Jasper', 'Kingsley', 'Linden', 'Marlowe', 'Norcross', 'Osgood', 'Pinehurst', 'Redwing', 'Saxon', 'Thornton', 'Vesper', 'Wexford', 'Yardley'];
export function stockName(state: GameState, b: { id: number; type: PType; construction: string; quality: number; age: number }): string {
  const r = mulberry32((state.seed ^ Math.imul(b.id + 7, 0x85ebca6b)) | 0);
  const pool = r() < 0.5 ? NAMES : NAMES2;
  const base = pool[Math.floor(r() * pool.length) % pool.length];
  const p = (arr: string[]) => arr[Math.floor(r() * arr.length) % arr.length];
  const old = b.age > 45;
  if (b.type === 'office') {
    if (b.construction === 'concrete') return b.quality >= 105 ? p([`${base} Tower`, `One ${base} Plaza`, `${base} Centre`]) : p([`${base} Tower`, `${base} Executive Center`, `The ${base} Building`]);
    if (b.construction === 'masonry') return old ? `The ${base} Building` : p([`${base} Court`, `The ${base} Building`, `${base} Hall`]);
    return p([`${base} House`, `${base} Professional Building`]);
  }
  if (b.type === 'retail') {
    if (b.construction === 'center') return p([`${base} Crossing`, `${base} Commons`, `${base} Marketplace`, `Shops at ${base}`]);
    if (b.construction === 'pad') return p([`${base} Corner`, `${base} Point`]);
    return p([`${base} Plaza`, `${base} Square Shops`, `${base} Row`]);
  }
  if (b.type === 'industrial') {
    if (b.construction === 'tilt') return p([`${base} Distribution Center`, `${base} Logistics Center`, `${base} Commerce Center`]);
    if (b.construction === 'metal') return p([`${base} Industrial`, `${base} Commerce Park`, `${base} Supply Building`]);
    return old ? p([`${base} Works`, `Old ${base} Yard`, `${base} Iron Works`]) : p([`${base} Works`, `${base} Yard`]);
  }
  if (b.type === 'multifamily') {
    if (b.construction === 'garden') return p([`${base} Court`, `${base} Gardens`, `${base} Village Apartments`]);
    if (b.construction === 'tower') return p([`The ${base}`, `${base} Residences`, `${base} House`]);
    return p([`The ${base}`, `${base} Flats`, `${base} Lofts`]);
  }
  return p([`${base} Exchange`, `${base} Mercantile`, `${base} Market Block`, `${base} Row`]);
}

export interface DevChoice {
  type: PType; sf: number; units: number; construction: string;
  mix?: MixSplit;        // mixed-use: your program — how much retail, office, apartments
  contractor: 'budget' | 'standard' | 'premium';
  contingencyPct: number; expedited: boolean; downPct: number;
  fixedRate?: boolean;   // lock the construction rate for +60bps
  contractType?: 'gmp' | 'costplus';  // who eats overruns above contingency
  bonded?: boolean;                   // surety covers a failed GC (+~1.2% of hard)
  diligence?: boolean;                // tie the land up and dig before you close
  designTier?: 've' | 'std' | 'signature';
  recourse?: boolean;                 // sign personally: -80bps and +10pts LTC, and it can follow you home
}

export function maxBuildableSF(state: GameState, l: Listing, type: PType): number {
  const z = state.tiles[l.tileI]?.zone;
  const zMult = z ? zoneTierMult(z.tier) : 1;
  return Math.floor(((l.acres ?? 0) * 43_560 * FAR[type] * zMult * upzoneBonus(listingParcels(l))) / 1000) * 1000;
}
// Typical site coverage by product — the share of the dirt one floor actually stands on.
// SF = floorplate × stories, so this is what turns a story count into a building.
export const COVERAGE: Record<PType, number> = { industrial: 0.50, retail: 0.28, office: 0.45, mixed: 0.50, multifamily: 0.40 };
export function floorplateSF(l: Listing, type: PType): number {
  return Math.max(1, Math.round((l.acres ?? 0.25) * 43_560 * COVERAGE[type]));
}

export const DESIGN = {
  ve: { hardMult: 0.94, months: 6, fee: 0.04, rentMult: 0.92, qShift: -9, label: 'Value-engineered' },
  std: { hardMult: 1, months: 8, fee: 0.045, rentMult: 1, qShift: 0, label: 'Standard' },
  signature: { hardMult: 1.12, months: 12, fee: 0.06, rentMult: 1.12, qShift: 9, label: 'Signature' },
} as const;
export function devCostBreakdown(state: GameState, c: DevChoice, landCost: number) {
  const spec = CONSTR[c.type].find(x => x.id === c.construction) ?? CONSTR[c.type][0];
  const tariff = state.econ.tariffMonthsLeft > 0 ? 1.08 : 1;
  const gmpMult = (c.contractType ?? 'costplus') === 'gmp' ? 1.07 : 1;   // certainty has a price
  const dsn = DESIGN[c.designTier ?? 'std'];
  // scale economies with teeth: mobilization, GC overhead, and design spread over more
  // floors. 5K SF pays ~1.15x PSF, 20K is the 1.0 reference, 70K ~0.87x, 200K+ ~0.76x
  const sizeMult = clamp(1.0 - 0.24 * Math.log10(Math.max(3000, c.sf) / 20000), 0.74, 1.18);
  const hard = spec.cost * sizeMult * c.sf * gmpMult * dsn.hardMult * tariff * constrCostIdx(state) * (c.expedited ? 1.08 : 1);
  const bond = c.bonded ? hard * 0.012 : 0;                              // the surety's cut
  const soft = hard * CONFIG.softCostPct;
  const cont = hard * c.contingencyPct;
  const designFee = Math.round(hard * dsn.fee);                          // equity-funded, never loan money
  const designMonths = dsn.months;
  const total = landCost + hard + bond + soft + cont;
  const months = Math.min(26, Math.max(5, Math.round((4 + c.sf / 7000) * (c.expedited ? 0.75 : 1))));
  return { hard, soft, cont, bond, designFee, designMonths, total, months, landCost, spec };
}

export function validateDev(state: GameState, l: Listing, c: DevChoice): string | null {
  const spec = CONSTR[c.type].find(x => x.id === c.construction);
  if (!spec) return 'Pick a construction type.';
  const zt = state.tiles[l.tileI];
  if (zt && !zoneAllows(zt.zone, c.type)) {
    return `Block ${blockLabel(zt)} is zoned ${zoneCode(zt.zone)} (${ZONE_LABEL[zt.zone.use].toLowerCase()}) — ${PLABEL[c.type].toLowerCase()} isn't a permitted use. Rezone first, or build what the paper allows.`;
  }
  const minC = spec.minCells ?? 1;
  if (listingParcels(l) < minC) return `A real ${spec.label.toLowerCase()} wants ${minC * 0.25} acres of dirt — this site is ${listingParcels(l) * 0.25}. Assemble ${minC - listingParcels(l)} more parcel${minC - listingParcels(l) > 1 ? 's' : ''} or pick a lighter spec.`;
  const bMax = maxBuildableSF(state, l, c.type);
  if (c.sf > bMax) return `Zoning at ${zt ? zoneCode(zt.zone) : '—'} caps a ${PLABEL[c.type].toLowerCase()} building on ${l.acres} acres at ${(bMax / 1000).toFixed(0)}K SF. Upzone the block to go denser.`;
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
  if (c.type === 'mixed' && c.mix) {
    const sum = c.mix.office + c.mix.retail + c.mix.multifamily;
    if (Math.abs(sum - 1) > 0.02 || c.mix.office < 0 || c.mix.retail < 0 || c.mix.multifamily < 0) return 'The program has to add to 100% — retail, office, homes.';
    if (c.mix.multifamily < 0.2) return 'A podium with almost no homes is an office building with extra steps — put at least 20% residential in the program, or build office.';
  }
  return null;
}

// What's actually under the dirt, seeded from (seed, tileI, sorted cells) — diligence
// tells the truth, and reloading can't re-roll it. Most sites are clean. Some aren't.
function siteRoll(s: GameState, tileI: number, cells: number[]): { u: number; u2: number } {
  let h = s.seed ^ Math.imul(tileI + 1, 0x9E3779B9);
  for (const c of [...cells].sort((a, b) => a - b)) h = Math.imul(h ^ (c + 1), 0x85EBCA6B);
  const r = mulberry32(h | 0);
  return { u: r(), u2: r() };
}
// The same dirt tells the same story whether a study finds it or an excavator does.
export function landSiteCondition(s: GameState, tileI: number, cells: number[], price: number): SiteCond {
  const { u, u2 } = siteRoll(s, tileI, cells);
  if (u < 0.62) return { kind: 'none', cost: 0, delayMo: 0 };
  if (u < 0.74) return { kind: 'soils', cost: roundPrice(price * (0.15 + u2 * 0.25)), delayMo: 1 + Math.round(u2) };
  if (u < 0.82) return { kind: 'easement', cost: 0, delayMo: 0, sfLossFrac: 0.12 + u2 * 0.15 };
  if (u < 0.90) return { kind: 'utility', cost: roundPrice(price * (0.20 + u2 * 0.30)), delayMo: 2 };
  if (u < 0.97) return { kind: 'tank', cost: roundPrice(price * (0.40 + u2 * 0.60)), delayMo: 2 + Math.round(u2 * 2) };
  return { kind: 'archaeology', cost: roundPrice(price * (0.30 + u2 * 0.40)), delayMo: 5 + Math.round(u2 * 3) };
}
export function siteCondition(s: GameState, tileI: number, cells: number[], sf: number): SiteCond {
  const { u, u2 } = siteRoll(s, tileI, cells);
  if (u < 0.62) return { kind: 'none', cost: 0, delayMo: 0 };
  if (u < 0.74) return { kind: 'soils', cost: Math.round(sf * (6 + u2 * 8)), delayMo: 1 + Math.round(u2) };
  if (u < 0.82) return { kind: 'easement', cost: 0, delayMo: 0, sfLossFrac: 0.12 + u2 * 0.15 };
  if (u < 0.90) return { kind: 'utility', cost: Math.round(120_000 + u2 * 280_000), delayMo: 2 };
  if (u < 0.97) return { kind: 'tank', cost: Math.round(250_000 + u2 * 600_000), delayMo: 2 + Math.round(u2 * 2) };
  return { kind: 'archaeology', cost: Math.round(100_000 + u2 * 200_000), delayMo: 5 + Math.round(u2 * 3) };
}
export const SITE_COND_LABEL: Record<SiteCondKind, string> = {
  none: 'Clean site', soils: 'Poor soils — deep foundations required', easement: 'A recorded easement crosses the site',
  utility: 'Utility capacity shortfall — sewer and power upgrades', tank: 'Buried tanks — contamination remediation', archaeology: 'Archaeological find',
};

// Interest-reserve runway in months, at the forward burn rate (average of current and
// fully-drawn balance). This is the number a developer actually watches.
export function reserveRunwayMonths(s: GameState, a: Asset): number | null {
  const loan = a.loans[0];
  if (!loan || loan.reserveBalance === undefined || a.mode !== 'construction') return null;
  const rate = loan.floating ? s.econ.rate + (loan.spreadPct ?? CONFIG.constrSpread) : loan.ratePct;
  const commitment = (a as any).loanCommitment ?? loan.balance;
  const avgBal = Math.max(loan.balance, (loan.balance + commitment) / 2);
  const burn = avgBal * (rate / 100 / 12);
  if (burn <= 1) return 99;
  return loan.reserveBalance / burn;
}

export function buyLandAndDevelop(state: GameState, listingId: number, c: DevChoice, useJV = false): { s: GameState; err?: string } {
  const s = clone(state);
  const l = s.listings.find(x => x.id === listingId);
  if (!l || l.kind !== 'land') return { s, err: 'Listing gone.' };
  const vErr = validateDev(s, l, c);
  if (vErr) return { s, err: vErr };
  const bd = devCostBreakdown(s, c, l.price);
  // a studied holding's known remediation joins the budget and the capital stack
  const srcHolding0 = l.fromLandId ? state.land.find(x => x.id === l.fromLandId) : undefined;
  const knownUpfront = srcHolding0?.condKnown && srcHolding0.cond && srcHolding0.cond.kind !== 'none' && !srcHolding0.cond.sfLossFrac
    ? srcHolding0.cond.cost : 0;
  // any land loans on the dirt going into the project must be retired at groundbreaking —
  // the construction lender takes first position, and they don't share
  const landPayoff = ((l as any).mergedLand ?? (l.fromLandId ? [l.fromLandId] : []))
    .reduce((sum: number, hid: number) => sum + (state.land.find(x => x.id === hid)?.loan?.balance ?? 0), 0);
  if (c.diligence) {
    // Under contract, not closed: deposit at risk, DD fee sunk, the truth in 1-2 months.
    const deposit = Math.max(10_000, Math.round(l.price * 0.03));
    const ddFee = Math.max(25_000, Math.round(l.price * (0.006 + rng(s) * 0.006)));
    if (s.cash < deposit + ddFee) return { s, err: `Going under contract takes ${fmtMoney(deposit)} deposit + ${fmtMoney(ddFee)} of diligence.` };
    s.cash -= deposit + ddFee;
    logCF(s, 'buy', 'Site contract deposit + diligence', -(deposit + ddFee));
    const t2 = s.tiles[l.tileI];
    const a2: Asset = {
      id: s.nextId++, name: nameFor(s, c.type), tileI: l.tileI, type: c.type,
      sf: c.sf, acres: l.acres ?? 0,
      px: l.parcel?.px, py: l.parcel?.py, pw: l.parcel?.pw, ph: l.parcel?.ph,
      cells: l.parcelCells ?? (l.parcel ? cellsOfRect(l.parcel.px, l.parcel.py, l.parcel.pw, l.parcel.ph) : undefined),
      units: c.units, construction: c.construction,
      mix: c.type === 'mixed' ? (c.mix ?? defaultMixSplit(s.seed, l.tileI)) : undefined,
      quality: clamp(Math.round(bd.spec.q * 1.07), 30, bd.spec.qCap), qCap: bd.spec.qCap, // new construction opens above book — everything is under warranty and nothing has leaked yet
      age: 0, mode: 'construction',
      tenants: [], occ: 0, rentStance: 0, maint: 'std',
      loans: [],
      ledger: [{ m: s.month, amt: -(deposit + ddFee) }], cumCF: 0,
      basis: deposit + ddFee, acqMonth: s.month,
      entryNOI: 0, entryCap: capRatePct(s, t2, c.type, bd.spec.q),
      project: {
        stage: 'diligence', monthsLeft: 1 + (rng(s) < 0.5 ? 1 : 0), totalMonths: bd.months,
        hardBudget: bd.hard, softBudget: bd.soft, spent: deposit + ddFee,
        contingency: bd.cont, contingencyLeft: bd.cont,
        contractor: c.contractor, expedited: c.expedited, events: [], drawnSoFar: 0, monthsBuilt: 0,
        contractType: c.contractType ?? 'costplus', bonded: !!c.bonded,
        dd: { deposit, ddFee, landPrice: l.price, choice: { ...c }, useJV },
      },
      negCFStreak: 0,
    };
    s.assets.push(a2);
    s.listings = s.listings.filter(x => x.id !== l.id);
    pushNews(s, 'deal', `${a2.name}: under contract at ${fmtMoney(l.price)} with ${fmtMoney(deposit)} down. Drills and consultants are on site — the truth arrives before your money does.`, l.tileI);
    return { s };
  }
  const totalAll = bd.total + knownUpfront;
  const constrSpreadHere = c.recourse ? 3.1 : 3.9;
  const ltcHere = (c.recourse ? 0.75 : 0.65) - (s.econ.crunchMonthsLeft > 0 ? 0.1 : 0);
  const maxLoan = totalAll * ltcHere;
  const equity = Math.max(totalAll * c.downPct, totalAll - maxLoan);
  if (s.cash < equity + landPayoff) return { s, err: 'You need ' + fmtMoney(equity + landPayoff) + ' of equity for this capital stack' + (landPayoff > 0 ? ` (including ${fmtMoney(landPayoff)} to retire the land loan)` : '') + '.' };
  const loanAmt = totalAll - equity;
  const rate = s.econ.rate + constrSpreadHere + (c.fixedRate ? 0.6 : 0);
  // interest reserve, sized to the expected build at ~60% average drawn balance
  const reserve = Math.round(loanAmt * (rate / 100 / 12) * bd.months * 0.6);
  const jvChk2 = useJV ? canJV(s, equity) : null;
  if (useJV && jvChk2 && !jvChk2.ok) return { s, err: jvChk2.why };
  const yourEquity2 = useJV ? Math.round(equity * 0.30) : equity;
  if (s.cash < yourEquity2 + bd.designFee + landPayoff) return { s, err: `You need ${fmtMoney(yourEquity2 + bd.designFee + landPayoff)} at closing (equity + design fees${landPayoff > 0 ? ' + land-loan payoff' : ''}).` };
  s.cash -= equity - (equity - yourEquity2); // your slice only
  s.cash -= bd.designFee; // architects and engineers bill from day one — pure equity carry
  logCF(s, 'dev', 'Development equity + design fees at groundbreaking', -(yourEquity2 + bd.designFee));
  if (landPayoff > 0) { s.cash -= landPayoff; logCF(s, 'debt', 'Land loan retired at groundbreaking', -landPayoff); }

  const t = s.tiles[l.tileI];
  const events: ConstrEvent[] = [];
  // cost-plus is the low bid: more surprises reach you, and they're all yours
  const riskMult = ((c.contractType ?? 'costplus') === 'costplus' ? 1.25 : 0.85) * (s.staff?.cm ? 0.7 : 1);
  const pool = ['materials', 'labor', 'weather', 'soils', 'ahead'];
  const nEvents = rng(s) < 0.55 * riskMult ? (rng(s) < 0.35 * riskMult ? 2 : 1) : 0;
  for (let k = 0; k < nEvents; k++) {
    events.push({ month: 1 + Math.floor(rng(s) * (bd.months - 1)), kind: rpick(s, pool), resolved: false });
  }
  if (c.contractor === 'premium' && rng(s) < 0.35) events.push({ month: Math.floor(bd.months * 0.6), kind: 'ahead', resolved: false });
  // what's under the dirt: a studied holding prices it into the budget; an unstudied
  // one meets it at excavation, at a multiple
  const cellsHere = l.parcelCells ?? (l.parcel ? cellsOfRect(l.parcel.px, l.parcel.py, l.parcel.pw, l.parcel.ph) : []);
  const cond0 = srcHolding0?.condKnown ? { kind: 'none' as SiteCondKind, cost: 0, delayMo: 0 } : siteCondition(s, t.i, cellsHere, c.sf);
  if (cond0.kind !== 'none') events.push({ month: 1 + Math.floor(rng(s) * 3), kind: 'siteSurprise', resolved: false });
  // new construction opens ~7% above the spec's book number — everything is under
  // warranty, nothing has leaked yet, and the finishes are this decade's
  const startQ = Math.round(bd.spec.q * 1.07) + (c.contractor === 'premium' ? 6 : c.contractor === 'budget' ? -8 : 0);
  const permitMonths = 1 + Math.floor(rng(s) * 3);
  const a: Asset = {
    id: s.nextId++, name: nameFor(s, c.type), tileI: l.tileI, type: c.type,
    sf: c.sf, acres: l.acres ?? 0,
    px: l.parcel?.px, py: l.parcel?.py, pw: l.parcel?.pw, ph: l.parcel?.ph,
    cells: l.parcelCells ?? (l.parcel ? cellsOfRect(l.parcel.px, l.parcel.py, l.parcel.pw, l.parcel.ph) : undefined),
    units: c.units, construction: c.construction,
    mix: c.type === 'mixed' ? (c.mix ?? defaultMixSplit(s.seed, l.tileI)) : undefined,
    quality: clamp(startQ + DESIGN[c.designTier ?? 'std'].qShift, 30, clamp(bd.spec.qCap + DESIGN[c.designTier ?? 'std'].qShift, 30, 146)),
    qCap: clamp(bd.spec.qCap + DESIGN[c.designTier ?? 'std'].qShift, 30, 146),
    age: 0, mode: 'construction', designTier: c.designTier ?? 'std',
    tenants: [], occ: 0, rentStance: 0, maint: 'std',
    loans: [{ id: s.nextId++, kind: 'constr', balance: 0, ratePct: rate, amortYears: 25, ioMonthsLeft: 999, monthlyPmt: 0, maturityMonth: s.month + bd.months + bd.designMonths + permitMonths + 14, reserveInitial: reserve, reserveBalance: reserve, floating: !c.fixedRate, spreadPct: constrSpreadHere + (c.fixedRate ? 0.6 : 0), recourse: !!c.recourse }],
    ledger: [{ m: s.month, amt: -equity }], cumCF: 0,
    basis: bd.total, acqMonth: s.month,
    entryNOI: 0, entryCap: capRatePct(s, t, c.type, startQ),
    project: {
      stage: 'design', monthsLeft: bd.designMonths, totalMonths: bd.months,
      hardBudget: bd.hard + knownUpfront, softBudget: bd.soft, spent: l.price + bd.designFee + knownUpfront,
      contingency: bd.cont, contingencyLeft: bd.cont,
      contractor: c.contractor, expedited: c.expedited, events, drawnSoFar: 0, monthsBuilt: 0,
      contractType: c.contractType ?? 'costplus', bonded: !!c.bonded,
      siteCond: cond0.kind !== 'none' ? cond0 : undefined, landCost: l.price, designTier: c.designTier ?? 'std',
    },
    negCFStreak: 0,
  };
  a.deprBasis = Math.round(bd.hard + bd.soft + bd.designFee + knownUpfront);
  a.basis = totalAll + bd.designFee;
  a.deprTaken = 0;
  if (l.fromLandId) {
    const ids: number[] = (l as any).mergedLand ?? [l.fromLandId];
    for (const hid of ids) {
      const h = s.land.find(x => x.id === hid);
      if (h) { a.basis += h.basis; s.land = s.land.filter(x => x.id !== h.id); s.saleOffers = s.saleOffers.filter(o => o.landId !== hid); }
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

export function resolveConstrEvent(state: GameState, assetId: number, choice: 'absorb' | 'mitigate' | 'abandon'): GameState {
  const s = clone(state);
  const a = s.assets.find(x => x.id === assetId);
  // dequeue BEFORE the existence guard — a stale decision for a dead project
  // must never wedge the queue (pending > 0 blocks the clock)
  const idx = s.pending.findIndex(pd => pd.type === 'constrEvent' && pd.assetId === assetId);
  if (idx < 0) return s;
  const kind = s.pending[idx].eventKind;
  s.pending.splice(idx, 1);
  if (!a || !a.project) return s;
  const p = a.project;
  const applyCost = (amt: number, label: string, siteCondition = false) => {
    const fromCont = Math.min(p.contingencyLeft, amt);
    p.contingencyLeft -= fromCont;
    const overflow = amt - fromCont;
    if (overflow > 0) {
      if (p.contractType === 'gmp' && !siteCondition) {
        // above the guaranteed maximum, the overrun is the GC's problem — that's what the 7% bought
        pushNews(s, 'success', `${a.name}: ${label} ran ${fmtMoney(amt)} over — contingency covered ${fmtMoney(fromCont)}, the GC ate ${fmtMoney(overflow)} under the GMP.`);
      } else {
        s.cash -= overflow;
        logCF(s, 'dev', `${a.name} — construction interest past the reserve`, -overflow);
        a.ledger.push({ m: s.month, amt: -overflow });
        pushNews(s, 'warn', `${a.name}: ${label} ran ${fmtMoney(amt)} over — contingency covered ${fmtMoney(fromCont)}, you funded ${fmtMoney(overflow)} from cash${p.contractType === 'gmp' ? ' (site conditions sit outside the GMP)' : ''}.`);
      }
    } else {
      pushNews(s, 'info', `${a.name}: ${label} cost ${fmtMoney(amt)}, absorbed by contingency (${fmtMoney(p.contingencyLeft)} left).`);
    }
    p.spent += amt;
  };
  const walkDD = (why: string) => {
    const dd = p.dd!;
    pushNews(s, 'warn', `${a.name}: you walked. The ${fmtMoney(dd.deposit)} deposit and ${fmtMoney(dd.ddFee)} of diligence are gone — cheap next to the mistake they prevented. ${why}`, a.tileI);
    // the seller keeps the deposit and relists
    const cells = a.cells ?? (a.px !== undefined ? cellsOfRect(a.px, a.py!, a.pw!, a.ph!) : []);
    s.assets = s.assets.filter(x => x.id !== a.id);
    if (cells.length) {
      s.listings.push({
        id: s.nextId++, tileI: a.tileI, kind: 'land', acres: Math.round(cells.length * PARCEL_AC * 100) / 100,
        parcel: a.px !== undefined ? { px: a.px, py: a.py!, pw: a.pw!, ph: a.ph! } : undefined,
        parcelCells: [...cells], price: dd.landPrice, resFrac: rrange(s, 0.9, 0.99),
        listMonth: s.month, offersLeft: 3, expiresMonth: s.month + 6, hot: false,
      });
    }
  };
  if (kind === 'ddResult' && p.dd) {
    const dd = p.dd;
    const cond = dd.known ?? { kind: 'none' as SiteCondKind, cost: 0, delayMo: 0 };
    if (choice !== 'absorb') { walkDD(''); return s; }
    // CLOSE: price the truth in and put real money down
    const c = { ...dd.choice };
    if (cond.sfLossFrac) {
      a.sf = Math.max(MIN_BUILD_SF, Math.round(a.sf * (1 - cond.sfLossFrac) / 500) * 500);
      a.units = Math.max(1, Math.round(a.units * (1 - cond.sfLossFrac)));
      c.sf = a.sf; c.units = a.units;
    }
    const bd = devCostBreakdown(s, c, dd.landPrice);
    const knownCost = cond.kind === 'easement' ? 0 : cond.cost;
    const totalCost = bd.total + knownCost;
    const maxLoan = totalCost * ((c.recourse ? 0.75 : 0.65) - (s.econ.crunchMonthsLeft > 0 ? 0.1 : 0));
    const equity = Math.max(totalCost * c.downPct, totalCost - maxLoan);
    const useJV = dd.useJV && canJV(s, equity).ok;
    const equityDue = Math.max(0, (useJV ? Math.round(equity * 0.30) : equity) - dd.deposit);
    if (s.cash < equityDue + bd.designFee) { walkDD('(You could not have closed anyway — the equity was not there.)'); return s; }
    s.cash -= equityDue + bd.designFee;
    logCF(s, 'dev', 'Development equity + design fees at groundbreaking', -(equityDue + bd.designFee));
    a.ledger.push({ m: s.month, amt: -(equityDue + bd.designFee) });
    const rate = s.econ.rate + (c.recourse ? 3.1 : 3.9) + (c.fixedRate ? 0.6 : 0);
    const loanAmt = totalCost - equity;
    const buildMonths = bd.months + cond.delayMo;
    const reserve = Math.round(loanAmt * (rate / 100 / 12) * buildMonths * 0.6);
    a.loans = [{ id: s.nextId++, kind: 'constr', balance: 0, ratePct: rate, amortYears: 25, ioMonthsLeft: 999, monthlyPmt: 0, maturityMonth: s.month + buildMonths + 3 + 14, reserveInitial: reserve, reserveBalance: reserve, floating: !c.fixedRate, spreadPct: (c.recourse ? 3.1 : 3.9) + (c.fixedRate ? 0.6 : 0), recourse: !!c.recourse }];
    (a as any).loanCommitment = loanAmt;
    a.basis = totalCost + dd.ddFee;
    a.deprBasis = Math.round(bd.hard + bd.soft + knownCost);
    a.deprTaken = 0;
    p.hardBudget = bd.hard + knownCost; p.softBudget = bd.soft;
    p.contingency = bd.cont; p.contingencyLeft = bd.cont;
    p.totalMonths = buildMonths; p.landCost = dd.landPrice;
    p.spent = dd.landPrice + dd.ddFee;
    const riskMult = (p.contractType ?? 'costplus') === 'costplus' ? 1.25 : 0.85;
    const pool = ['materials', 'labor', 'weather', 'ahead'];   // soils risk was just drilled out
    const nEvents = rng(s) < 0.55 * riskMult ? (rng(s) < 0.35 * riskMult ? 2 : 1) : 0;
    for (let k = 0; k < nEvents; k++) p.events.push({ month: 1 + Math.floor(rng(s) * Math.max(1, buildMonths - 1)), kind: rpick(s, pool), resolved: false });
    p.stage = 'design'; p.monthsLeft = bd.designMonths;
    p.designTier = c.designTier ?? 'std';
    a.designTier = c.designTier ?? 'std';
    a.basis = totalCost + dd.ddFee + bd.designFee;
    if (useJV) attachJV(s, a, equity);
    p.dd = undefined;
    pushNews(s, cond.kind === 'none' ? 'success' : 'info',
      cond.kind === 'none'
        ? `${a.name}: diligence came back CLEAN. You closed knowing it — permits next.`
        : `${a.name}: closed with eyes open. ${SITE_COND_LABEL[cond.kind]} — ${cond.sfLossFrac ? `buildable area cut ${Math.round(cond.sfLossFrac * 100)}%` : fmtMoney(knownCost) + ' priced into the budget'}${cond.delayMo ? `, +${cond.delayMo} months` : ''}. Known problems are just costs.`, a.tileI);
    return s;
  }
  if (kind === 'siteSurprise' && p.siteCond) {
    const cond = p.siteCond;
    const mult = 2 + rng(s) * 3;   // the waived-diligence tax
    if (choice === 'abandon') {
      const loan = a.loans[0];
      const owed = loan?.balance ?? 0;
      const cells = a.cells ?? (a.px !== undefined ? cellsOfRect(a.px, a.py!, a.pw!, a.ph!) : []);
      s.assets = s.assets.filter(x => x.id !== a.id);
      const isRecourse = !!loan?.recourse;
      if (s.cash >= owed || isRecourse) {
        s.cash -= owed;   // a personal guarantee means the deficiency comes out of you either way
        logCF(s, 'debt', 'Recourse deficiency', -owed);
        if (cells.length) s.land.push({ id: s.nextId++, tileI: a.tileI, cells: [...cells], basis: p.landCost ?? 0, acquiredM: s.month });
        pushNews(s, 'warn', `${a.name}: ABANDONED. You repaid ${fmtMoney(owed)} of drawn debt${isRecourse && state.cash < owed ? ' (the guarantee followed you home)' : ''} and kept the dirt. Everything else spent is a lesson now.`, a.tileI);
      } else {
        pushNews(s, 'warn', `${a.name}: ABANDONED — non-recourse, so the lender keeps the site and eats the rest. The market keeps the story.`, a.tileI);
      }
      return s;
    }
    if (choice === 'mitigate') {
      const loss = cond.sfLossFrac ?? 0.15;
      a.sf = Math.max(MIN_BUILD_SF, Math.round(a.sf * (1 - loss) / 500) * 500);
      a.units = Math.max(1, Math.round(a.units * (1 - loss)));
      a.quality = clamp(a.quality - 6, 8, a.qCap);
      applyCost(Math.round(cond.cost * mult * 0.35) + (cond.kind === 'easement' ? 60_000 : 0), `redesigning around the ${cond.kind}`, true);
      p.monthsLeft += Math.ceil(cond.delayMo / 2);
      pushNews(s, 'info', `${a.name}: value-engineered around it — the building shrinks to ${(a.sf / 1000).toFixed(0)}K SF.`, a.tileI);
    } else {
      const cost = cond.kind === 'easement' ? Math.round(150_000 * mult / 2) : Math.round(cond.cost * mult);
      applyCost(cost, `${SITE_COND_LABEL[cond.kind].toLowerCase()} (found the hard way)`, true);
      p.monthsLeft += cond.delayMo + 1;
      if (cond.delayMo > 0) pushNews(s, 'warn', `${a.name}: schedule slips ${cond.delayMo + 1} months. The interest reserve doesn't pause.`, a.tileI);
    }
    p.siteCond = undefined;
    return s;
  }
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

export function resolveAssetEvent(state: GameState, assetId: number, choice: 'a' | 'b' | 'c'): GameState {
  const s = clone(state);
  const a = s.assets.find(x => x.id === assetId);
  const idx = s.pending.findIndex(pd => pd.type === 'assetEvent' && pd.assetId === assetId);
  if (idx < 0) return s;
  const kind = s.pending[idx].eventKind;
  const data = s.pending[idx].data;
  s.pending.splice(idx, 1);
  if (!a) return s;
  const pay = (amt: number) => { s.cash -= amt; logCF(s, 'capex', a.name + ' — event cost', -amt); a.ledger.push({ m: s.month, amt: -amt }); };
  if (kind === 'roof') {
    const full = Math.round(a.sf * rrange(s, 3.2, 5.5) * s.econ.costIdx / 1000) * 1000;
    if (choice === 'a') { // full replacement — good for a generation
      pay(full); a.basis += full;
      a.roofM = s.month;
      pushNews(s, 'info', `${a.name}: roof and HVAC replaced for ${fmtMoney(full)}. Tenants notice these things — quietly, in renewals.`);
      a.quality = clamp(a.quality + 6, 1, a.qCap);
    } else { // patch it — bought a few years, not a roof
      pay(Math.round(full * 0.22));
      a.quality = clamp(a.quality - 10, 1, a.qCap);
      a.roofM = s.month - 110;   // even a patch buys a decade — the question comes back in ~11-21 years
      if (rng(s) < 0.4) s.scheduledEvents.push({ m: s.month + 6 + Math.floor(rng(s) * 8), kind: 'roofBill', payload: a.id });
      pushNews(s, 'warn', `${a.name}: roof patched for ${fmtMoney(Math.round(full * 0.22))}. Water finds a way; you've bought time, not a roof.`);
    }
  } else if (kind === 'reassess') {
    const hike = Math.round(((data?.hikeLo ?? 0) + (data?.hikeHi ?? assetValue(s, a) * 0.006 * 1.4)) / 2 / 1000) * 1000; // lands mid-range of the notice
    const potM0 = (a.sf * assetRentPSF(s, a)) / 12;
    const taxNow = Math.round(potM0 * 12 * CONFIG.expense.taxes[a.type] + ((a as any).taxBumpYr ?? 0));
    if (choice === 'a') { // appeal
      const fee = 25_000; pay(fee);
      if (rng(s) < 0.55) {
        pushNews(s, 'success', `${a.name}: assessment appeal WON. Taxes hold at ${fmtMoney(taxNow)}/yr instead of ${fmtMoney(taxNow + hike)}/yr; ${fmtMoney(fee)} well spent.`);
      } else {
        (a as any).taxBumpYr = ((a as any).taxBumpYr ?? 0) + hike;
        pushNews(s, 'warn', `${a.name}: appeal denied. Taxes go ${fmtMoney(taxNow)}/yr → ${fmtMoney(taxNow + hike)}/yr, and the lawyer still got paid.`);
      }
    } else {
      (a as any).taxBumpYr = ((a as any).taxBumpYr ?? 0) + hike;
      pushNews(s, 'info', `${a.name}: reassessment accepted — property taxes go ${fmtMoney(taxNow)}/yr → ${fmtMoney(taxNow + hike)}/yr. The county thanks you for your service.`);
    }
  } else if (kind === 'tiDemand') {
    const tn = [...a.tenants].sort((x, y) => y.sf - x.sf)[0];
    if (tn) {
      const ti = data?.ti ?? Math.round(tn.sf * 12 / 1000) * 1000;
      const bump = (data?.bumpPct ?? 4) / 100;
      const extend = data?.extendMo ?? 72;
      if (choice === 'a') { // fund the full package at the stated terms
        pay(ti); a.basis += ti;
        tn.startM = s.month; tn.endM = s.month + extend;
        tn.rate = Math.round(tn.rate * (1 + bump) * 100) / 100;
        pushNews(s, 'success', `${a.name}: ${tn.name} signed a ${Math.round(extend / 12)}-year extension for the ${fmtMoney(ti)} package — rate steps up ${Math.round(bump * 100)}% to $${tn.rate.toFixed(2)}/SF.`);
      } else if (choice === 'c') { // counter at roughly half — a real negotiation, with real odds
        const half = Math.round(ti * 0.55 / 1000) * 1000;
        if (rng(s) < 0.6) {
          pay(half); a.basis += half;
          tn.startM = s.month; tn.endM = s.month + Math.round(extend * 0.75);
          tn.rate = Math.round(tn.rate * (1 + bump * 0.5) * 100) / 100;
          pushNews(s, 'success', `${a.name}: ${tn.name} took your counter — ${fmtMoney(half)} of improvements for a ${Math.round(extend * 0.75 / 12)}-year extension at $${tn.rate.toFixed(2)}/SF.`);
        } else {
          tn.endM = Math.min(tn.endM, s.month + Math.round(rrange(s, 8, 16)));
          pushNews(s, 'warn', `${a.name}: ${tn.name} felt low-balled on the improvements. They're quietly touring the competition.`);
        }
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
  logCF(s, 'capex', `Demolition — ${a.name}`, -cost);
  const t = s.tiles[a.tileI];
  t.supply[a.type] = Math.max(0, t.supply[a.type] - a.sf);
  const cells = footprintCells(a);
  if (cells.length) {
    s.land.push({ id: s.nextId++, tileI: a.tileI, cells, basis: Math.round(a.basis + cost), acquiredM: s.month });
  }
  s.assets = s.assets.filter(x => x.id !== assetId);
  s.lois = s.lois.filter(x => x.assetId !== assetId);
  s.pending = s.pending.filter(pd => pd.assetId !== assetId);
  pushNews(s, 'info', `${a.name} is gone — ${fmtMoney(cost)} to take it down. What's left is ${Math.round(cells.length * PARCEL_AC * 100) / 100} acres of clean dirt at block ${blockLabel(t)}.`, a.tileI);
  return { s };
}

export function conversionCost(state: GameState, a: Pick<Asset, 'sf' | 'quality'>): number {
  return Math.round(a.sf * (128 + Math.max(0, 90 - a.quality) * 0.6) * constrCostIdx(state) / 1000) * 1000;
}
export function canConvert(state: GameState, a: Asset): { ok: boolean; why?: string } {
  if (a.type !== 'office') return { ok: false, why: 'Only office buildings convert — the floorplates and plumbing of other types don\'t pencil.' };
  if (a.mode === 'construction' || a.project) return { ok: false, why: 'Finish what you\'re building first.' };
  if (a.occ > 0.35) return { ok: false, why: `Occupancy is ${Math.round(a.occ * 100)}% — you can\'t gut a building around paying tenants. Get below 35%.` };
  if (a.forSale) return { ok: false, why: 'Delist it first.' };
  if (!zoneAllows(state.tiles[a.tileI].zone, 'multifamily')) return { ok: false, why: `Block ${blockLabel(state.tiles[a.tileI])} is zoned ${zoneCode(state.tiles[a.tileI].zone)} — housing isn't a permitted use. Rezone first; conversions get no special pass.` };
  const cost = conversionCost(state, a);
  if (state.cash < cost) return { ok: false, why: `Conversion runs ${fmtMoney(cost)} cash — plumbing every floor isn't cheap.` };
  return { ok: true };
}
export function startConversion(state: GameState, assetId: number): { s: GameState; err?: string } {
  const s = clone(state);
  s.lois = s.lois.filter(x => x.assetId !== assetId);   // nobody signs an office lease in a building being gutted
  const a = s.assets.find(x => x.id === assetId);
  if (!a) return { s };
  const chk = canConvert(s, a);
  if (!chk.ok) return { s, err: chk.why };
  const cost = conversionCost(s, a);
  s.cash -= cost;
  logCF(s, 'capex', `Conversion — ${a.name}`, -cost);
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
export function renovCost(state: GameState, a: Pick<Asset, 'sf' | 'type'> & Partial<Asset>): number {
  // the sledgehammer prices off the building it's swung at — trophy product costs
  // trophy money to renovate
  const full = a as Asset;
  const gradeMult = full.mode !== undefined && full.sf > 0
    ? clamp(0.75 + (assetValue(state, full) / full.sf) / 400, 0.8, 2.2)
    : 1;
  return a.sf * CONFIG.hardCost[a.type] * 0.22 * constrCostIdx(state) * gradeMult;
}
// ---------- Capital programs: the actionable side of quality ----------
// A renovation is a sledgehammer. These are the scalpel: discrete, targeted
// programs that each move quality — and some move more than quality.
export interface CapProgram {
  id: string; label: string; desc: string;
  months: number; costPSF: number; q: number;
  types?: PType[];        // omitted = any type
  capUp?: number;         // modern bones raise what the building can ever be
  opexPct?: number;       // systems work cuts operating cost
  velocity?: number;      // amenities make space lease faster
  creditBump?: boolean;   // credit tenants shortlist smart buildings
}
export const PROGRAMS: CapProgram[] = [
  { id: 'lobby', label: 'Lobby & commons refresh', months: 2, costPSF: 6, q: 9, types: ['office', 'mixed', 'multifamily'],
    desc: 'First impressions are underwriting. Stone, light, and somebody at the desk.' },
  { id: 'systems', label: 'Mechanical & systems modernization', months: 4, costPSF: 14, q: 14, capUp: 8, opexPct: 0.05,
    desc: 'New bones: runs ~5% cheaper, and the ceiling on what this building can be rises.' },
  { id: 'amenity', label: 'Amenity package', months: 3, costPSF: 10, q: 15, types: ['office', 'mixed', 'multifamily'], velocity: 1.08,
    desc: 'Fitness, terrace, conference. Space that doesn\'t rent, leasing the space that does.' },
  { id: 'facade', label: 'Facade & site refresh', months: 3, costPSF: 8, q: 10,
    desc: 'Curb appeal compounds — the block reads better, and so does your rent roll.' },
  { id: 'smart', label: 'Smart-building systems', months: 2, costPSF: 5, q: 7, types: ['office', 'industrial'], creditBump: true,
    desc: 'Metering, access, sensors. Credit tenants ask about it before they ask about rent.' },
];
export function programCost(state: GameState, a: Asset, p: CapProgram): number {
  // better buildings cost more to work on: finishes match the lobby they're going
  // into, crews price the address, and nobody puts laminate in a trophy
  const valPSF = a.sf > 0 ? assetValue(state, a) / a.sf : 120;
  const gradeMult = clamp(0.75 + valPSF / 400, 0.8, 2.2);
  return roundPrice(a.sf * p.costPSF * constrCostIdx(state) * gradeMult);
}
// programs age out with the building: a lobby refreshed a decade ago is due again
export function programRedoWait(state: GameState, a: Asset, p: CapProgram): number {
  return 60 + ((Math.imul((state.seed ^ (a.id * 61 + p.id.length * 7)) >>> 0, 0x9E3779B9) >>> 20) % 37); // 5-8 years
}
export function canStartProgram(state: GameState, a: Asset, p: CapProgram): { ok: boolean; why?: string } {
  if (a.mode === 'construction') return { ok: false, why: 'Finish building it first.' };
  if (p.types && !p.types.includes(a.type)) return { ok: false, why: 'Not a fit for this asset type.' };
  if ((a.programs ?? []).includes(p.id)) {
    const doneM = a.programsDoneM?.[p.id];
    const wait = programRedoWait(state, a, p);
    const left = doneM === undefined ? 1 : doneM + wait - state.month;
    if (left > 0) return { ok: false, why: doneM === undefined ? 'Already done here.' : `Done ${monthName(doneM)} — it holds up another ~${Math.max(1, Math.round(left / 12))} year${left > 18 ? 's' : ''}.` };
  }
  if (a.programActive) return { ok: false, why: 'One crew at a time — a program is already running.' };
  if (a.renovMonthsLeft) return { ok: false, why: 'The renovation crew has the building.' };
  return { ok: true };
}
export function startProgram(state: GameState, assetId: number, programId: string): { s: GameState; err?: string } {
  const s = clone(state); const a = s.assets.find(x => x.id === assetId);
  if (!a) return { s };
  const p = PROGRAMS.find(x => x.id === programId);
  if (!p) return { s, err: 'No such program.' };
  const gate = canStartProgram(s, a, p);
  if (!gate.ok) return { s, err: gate.why };
  const cost = programCost(s, a, p);
  if (s.cash < cost) return { s, err: `${p.label} runs ${fmtMoney(cost)} cash.` };
  s.cash -= cost;
  logCF(s, 'capex', `${a.name} — ${p.label}`, -cost);
  a.ledger.push({ m: s.month, amt: -cost });
  a.basis += cost;
  a.programActive = { id: p.id, monthsLeft: p.months };
  pushNews(s, 'info', `${a.name}: ${p.label.toLowerCase()} underway (${fmtMoney(cost)}, ~${p.months} months).`);
  return { s };
}

export function startRenovation(state: GameState, assetId: number): { s: GameState; err?: string } {
  const s = clone(state); const a = s.assets.find(x => x.id === assetId);
  if (!a) return { s };
  const cost = renovCost(s, a);
  if (s.cash < cost) return { s, err: 'Renovation needs ' + fmtMoney(cost) + ' cash.' };
  if (a.renovMonthsLeft) return { s, err: 'Renovation already underway.' };
  s.cash -= cost;
  logCF(s, 'capex', `${a.name} — renovation`, -cost);
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
// ---------- Off-market land ----------
// Unlisted dirt belongs to someone who didn't wake up wanting to sell. Whether they'll
// listen — and at what premium — is seeded per parcel, so reloading can't re-roll an
// owner. The market moves the thresholds: hot blocks harden owners, recessions soften
// them, your reputation opens or closes doors. Roughly: a third won't sell at any
// price, many want 50-100% over market, some want a modest premium, and one in ten is
// quietly motivated. Assembly plans are supposed to die on this.
export function parcelHeat(s: GameState, tileI: number): number {
  const t = s.tiles[tileI];
  const recentComp = s.comps.some(c => c.tileI === tileI && s.month - c.m <= 24);
  let building = false;
  for (const b of s.stock) if (b.buildLeft) { const bt = s.tiles[b.tileI]; if (Math.max(Math.abs(bt.x - t.x), Math.abs(bt.y - t.y)) <= 1) { building = true; break; } }
  if (!building) for (const a of s.assets) if (a.mode === 'construction') { const at = s.tiles[a.tileI]; if (Math.max(Math.abs(at.x - t.x), Math.abs(at.y - t.y)) <= 1) { building = true; break; } }
  return clamp(((t.D - 45) / 55) * 0.6 + (recentComp ? 0.2 : 0) + (building ? 0.2 : 0), 0, 1);
}
export function parcelDisposition(s: GameState, tileI: number, cell: number): { kind: 'refuse' | 'premium' | 'reasonable' | 'motivated'; mult: number } {
  const rr = mulberry32((s.seed ^ Math.imul(tileI + 1, 0x9E3779B9) ^ Math.imul(cell + 1, 0x85EBCA6B)) | 0);
  const u = rr(), u2 = rr();
  const heat = parcelHeat(s, tileI);
  const e = s.econ;
  const pRef = clamp(0.32 + 0.28 * heat + (e.phase === 'peak' ? 0.08 : 0) - (e.phase === 'recession' ? 0.10 : 0)
    + (s.reputation < 30 ? 0.06 : s.reputation > 65 ? -0.05 : 0), 0.15, 0.75);
  const pMot = clamp(0.10 + (e.phase === 'recession' ? 0.08 : 0) - 0.06 * heat, 0.02, 0.25);
  const pReas = clamp(0.18 - 0.06 * heat, 0.06, 0.30);
  if (u < pMot) return { kind: 'motivated', mult: 0.92 + u2 * 0.12 };
  if (u < pMot + pReas) return { kind: 'reasonable', mult: 1.15 + u2 * 0.30 };
  if (u < 1 - pRef) return { kind: 'premium', mult: 1.5 + u2 * (0.5 + 0.45 * heat) };
  return { kind: 'refuse', mult: 0 };
}
// A "no" isn't forever: owners take the call again after 4-8 months (seeded per parcel).
export function parcelApproachFade(s: GameState, tileI: number, cell: number): number {
  return 4 + ((Math.imul((s.seed ^ (tileI * 197 + cell * 13)) >>> 0, 0x9E3779B9) >>> 18) % 5);
}
export function parcelApproachState(s: GameState, tileI: number, cell: number): { m: number; outcome: 'refused' | 'ask'; ask?: number } | null {
  const rec = s.parcelApproach[tileI + ':' + cell];
  if (!rec) return null;
  if (s.month - rec.m >= parcelApproachFade(s, tileI, cell)) return null;   // memory fades; owners can be asked again
  return rec;
}
export function canApproachParcel(s: GameState, tileI: number, cell: number): { ok: boolean; why?: string } {
  const t = s.tiles[tileI];
  if (!t || t.water) return { ok: false, why: 'Nothing to buy there.' };
  if (!cellsAvailable(s, tileI, [cell])) return { ok: false, why: 'That parcel isn\'t vacant.' };
  const rec = parcelApproachState(s, tileI, cell);
  if (rec?.outcome === 'refused') return { ok: false, why: 'This owner already said no. Give it a few months — moods change, mortgages come due.' };
  if (rec?.outcome === 'ask') return { ok: false, why: 'You already have their number.' };
  if (s.approachesLeft <= 0) return { ok: false, why: 'You\'ve made your 3 calls this month.' };
  return { ok: true };
}
export function approachParcelOwner(state: GameState, tileI: number, cell: number): { s: GameState; refused?: boolean; listing?: Listing; err?: string } {
  const s = clone(state);
  const chk = canApproachParcel(s, tileI, cell);
  if (!chk.ok) return { s, err: chk.why };
  s.approachesLeft--;
  const t = s.tiles[tileI];
  if (rng(s) < 0.30) {
    pushNews(s, 'info', `No answer on the quarter-acre at block ${blockLabel(t)} — wrong number, dead line, or an owner who screens. The call is spent either way.`, tileI);
    return { s, err: 'No answer. Try again another month.' };
  }
  const d = parcelDisposition(s, tileI, cell);
  if (d.kind === 'refuse') {
    s.parcelApproach[tileI + ':' + cell] = { m: s.month, outcome: 'refused' };
    pushNews(s, 'info', `The owner of a quarter-acre at block ${blockLabel(t)} isn't selling. Not at your number — not at any number.`, tileI);
    return { s, refused: true };
  }
  // real owners own more than one lot: seeded horizontal pairs share an owner, and
  // when you call about one they quote you the whole holding
  const pairBase = cell - (cell % 2);
  const paired = (Math.imul((s.seed ^ (tileI * 131 + pairBase)) >>> 0, 0x9E3779B9) >>> 16) % 100 < 38;
  const partner = paired ? pairBase + (cell === pairBase ? 1 : 0) : -1;
  const g0 = parcelGrid(s, tileI);
  const bothCells = partner >= 0 && g0[partner] === null && !parcelApproachState(s, tileI, partner) ? [cell, partner].sort((a, b) => a - b) : [cell];
  const market = PARCEL_AC * landPricePerAcre(s, t) * holdoutMult(s, tileI, bothCells.length);
  const ask = roundPrice(market * d.mult * bothCells.length);
  const px = cell % PGRID, py = Math.floor(cell / PGRID);
  const l: Listing = {
    id: s.nextId++, tileI, kind: 'land',
    acres: Math.round(bothCells.length * PARCEL_AC * 100) / 100, parcel: bothCells.length === 1 ? { px, py, pw: 1, ph: 1 } : undefined, parcelCells: bothCells,
    price: ask,
    resFrac: d.kind === 'motivated' ? rrange(s, 0.94, 0.99) : d.kind === 'reasonable' ? rrange(s, 0.90, 0.97) : rrange(s, 0.93, 0.99),
    listMonth: s.month, offersLeft: 2, expiresMonth: s.month + 4, hot: false,
  };
  (l as any).omLead = true;
  s.listings.push(l);
  for (const c2 of bothCells) s.parcelApproach[tileI + ':' + c2] = { m: s.month, outcome: 'ask', ask };
  const lotTxt = bothCells.length > 1 ? `their ${bothCells.length * 0.25} acres — they own the lot next door too, and it's all or nothing` : 'the quarter-acre';
  pushNews(s, 'info', d.kind === 'motivated'
    ? `An owner at block ${blockLabel(t)} has been wanting out for years — they'd take ${fmtMoney(ask)} for ${lotTxt}.`
    : `The owner at block ${blockLabel(t)} would listen: ${fmtMoney(ask)} for ${lotTxt}. ${d.mult > 1.45 ? 'They know you want it.' : ''}`, tileI);
  return { s, listing: l };
}

// Go under contract on a land listing: ~3% deposit buys a 60-90 day window to study
// the site before real money moves. Study, then close or walk — study costs sunk.
export function contractLand(state: GameState, listingId: number): { s: GameState; err?: string } {
  const s = clone(state);
  const l = s.listings.find(x => x.id === listingId);
  if (!l || l.kind !== 'land' || l.yourSale || l.parentAssetId || l.fromLandId) return { s, err: 'Not that parcel.' };
  if (l.underContract) return { s, err: 'Already under contract.' };
  const deposit = Math.max(10_000, roundPrice(l.price * 0.03));
  if (s.cash < deposit) return { s, err: `The deposit is ${fmtMoney(deposit)}.` };
  s.cash -= deposit;
  logCF(s, 'buy', 'Land contract deposit', -deposit);
  l.underContract = { m: s.month, deposit };
  l.expiresMonth = s.month + 3;   // ~90 days to study and close
  pushNews(s, 'deal', `Under contract: ${l.acres} acres at block ${blockLabel(s.tiles[l.tileI])}, ${fmtMoney(deposit)} down. You have until ${monthName(l.expiresMonth)} to study the dirt and close — or walk and eat the deposit.`, l.tileI);
  return { s };
}
export function orderLandStudy(state: GameState, listingId: number): { s: GameState; err?: string } {
  const s = clone(state);
  const l = s.listings.find(x => x.id === listingId);
  if (!l?.underContract) return { s, err: 'You need the site under contract first.' };
  if (l.underContract.studyOrdered) return { s, err: 'The consultants are already out there.' };
  const fee = Math.max(20_000, roundPrice(l.price * 0.01));
  if (s.cash < fee) return { s, err: `The study runs ${fmtMoney(fee)}.` };
  s.cash -= fee;
  logCF(s, 'fees', 'Site study', -fee);
  l.underContract.studyOrdered = true;
  l.underContract.studyFee = fee;
  l.underContract.resultM = s.month + 1;
  pushNews(s, 'info', `Geotech, environmental and survey ordered on block ${blockLabel(s.tiles[l.tileI])} — ${fmtMoney(fee)}, results in about a month.`, l.tileI);
  return { s };
}
export function closeLandContract(state: GameState, listingId: number, financePct = 0): { s: GameState; err?: string } {
  const s = clone(state);
  const l = s.listings.find(x => x.id === listingId);
  if (!l?.underContract) return { s, err: 'No contract to close.' };
  const uc = l.underContract;
  const terms = landLoanTerms(s);
  const loanAmt = financePct > 0 ? roundPrice(l.price * Math.min(financePct, terms.maxLTV)) : 0;
  const due = l.price - uc.deposit - loanAmt + 5000;
  if (s.cash < due) return { s, err: `Closing takes ${fmtMoney(due)} (balance + costs${loanAmt > 0 ? ', net of the land loan' : ''}).` };
  const cells = l.parcelCells ?? (l.parcel ? cellsOfRect(l.parcel.px, l.parcel.py, l.parcel.pw, l.parcel.ph) : []);
  if (!cells.length) return { s, err: 'No parcel geometry.' };
  s.cash -= due;
  logCF(s, 'buy', 'Land closing', -due);
  const cond = uc.known ?? landSiteCondition(s, l.tileI, cells, l.price);
  s.land.push({ id: s.nextId++, tileI: l.tileI, cells: [...cells].sort((a, b) => a - b),
    basis: l.price + 5000 + (uc.studyFee ?? 0), acquiredM: s.month,
    cond: cond.kind !== 'none' ? cond : undefined, condKnown: !!uc.known,
    loan: loanAmt > 0 ? { balance: loanAmt, ratePct: terms.ratePct, maturityMonth: s.month + terms.termMo } : undefined });
  s.listings = s.listings.filter(x => x.id !== l.id);
  s.dealsClosed++;
  logDeal(s, { m: s.month, action: 'land buy', name: `Block ${blockLabel(s.tiles[l.tileI])} dirt`, type: 'land', sf: Math.round((l.acres ?? 0) * 43_560), price: l.price });
  pushNews(s, 'deal', `CLOSED: ${l.acres} acres at block ${blockLabel(s.tiles[l.tileI])} for ${fmtMoney(l.price)}.${uc.known ? (uc.known.kind === 'none' ? ' The study says clean — you own exactly what you think you own.' : ' You closed knowing the problem. Priced, presumably.') : ' No study — you own the unknowns too.'}`, l.tileI);
  return { s };
}
export function walkLandContract(state: GameState, listingId: number): { s: GameState; err?: string } {
  const s = clone(state);
  const l = s.listings.find(x => x.id === listingId);
  if (!l?.underContract) return { s, err: 'No contract to walk from.' };
  const uc = l.underContract;
  pushNews(s, 'warn', `You walked from the ${l.acres} acres at block ${blockLabel(s.tiles[l.tileI])}. ${fmtMoney(uc.deposit + (uc.studyFee ?? 0))} sunk — often the cheapest mistake available.`, l.tileI);
  if ((l as any).omLead) {
    // an off-market owner goes back to not selling — and remembers you wasted their time
    for (const c of l.parcelCells ?? []) s.parcelApproach[l.tileI + ':' + c] = { m: s.month, outcome: 'refused' };
    s.listings = s.listings.filter(x => x.id !== l.id);
  } else {
    l.underContract = undefined;
    l.expiresMonth = s.month + 5;   // a marketed property relists, deposit in the seller's pocket
  }
  return { s };
}

// Land debt: banks will lend on dirt, reluctantly. Half the price, interest-only,
// a 3-year fuse, and a spread that says "please don't".
export function landLoanTerms(state: GameState): { maxLTV: number; ratePct: number; termMo: number } {
  const crunch = state.econ.crunchMonthsLeft > 0;
  return {
    maxLTV: crunch ? 0.40 : 0.55,
    ratePct: Math.round((state.econ.rate + 3.25 + (crunch ? 0.75 : 0)) * 100) / 100,
    termMo: 36,
  };
}
// Buy a land listing to bank it — closes at the agreed (or asking) price, no development required.
// financePct > 0 puts a land loan on it (capped at the bank's LTV).
export function buyLandHold(state: GameState, listingId: number, financePct = 0): { s: GameState; err?: string } {
  const s = clone(state);
  const l = s.listings.find(x => x.id === listingId);
  if (!l || l.kind !== 'land') return { s, err: 'That land is gone.' };
  if (l.yourSale || l.parentAssetId) return { s, err: 'Not that parcel.' };
  if (l.fromLandId) return { s, err: 'That\'s your own dirt staged for development — you already own it.' };
  const terms = landLoanTerms(s);
  const loanAmt = financePct > 0 ? roundPrice(l.price * Math.min(financePct, terms.maxLTV)) : 0;
  const cost = l.price - loanAmt + 5000;
  if (s.cash < cost) return { s, err: `Closing takes ${fmtMoney(cost)}${loanAmt > 0 ? ' with the land loan' : ' including costs'}.` };
  const cells = l.parcelCells ?? (l.parcel ? cellsOfRect(l.parcel.px, l.parcel.py, l.parcel.pw, l.parcel.ph) : []);
  if (!cells.length) return { s, err: 'No parcel geometry on that listing.' };
  s.cash -= cost;
  logCF(s, 'buy', 'Land purchase', -cost);
  s.land.push({
    id: s.nextId++, tileI: l.tileI, cells: [...cells].sort((a, b) => a - b), basis: l.price + 5000, acquiredM: s.month,
    loan: loanAmt > 0 ? { balance: loanAmt, ratePct: terms.ratePct, maturityMonth: s.month + terms.termMo } : undefined,
  });
  s.listings = s.listings.filter(x => x.id !== l.id);
  s.dealsClosed++;
  logDeal(s, { m: s.month, action: 'land buy', name: `Block ${blockLabel(s.tiles[l.tileI])} dirt`, type: 'land', sf: Math.round(cells.length * PARCEL_AC * 43_560), price: l.price });
  pushNews(s, 'deal', `Land banked: ${Math.round(cells.length * PARCEL_AC * 100) / 100} acres at block ${blockLabel(s.tiles[l.tileI])} for ${fmtMoney(l.price)}${loanAmt > 0 ? ` — ${fmtMoney(loanAmt)} on land paper at ${terms.ratePct.toFixed(1)}%, interest-only, ${terms.termMo}-month fuse` : ''}. Dirt costs nothing to hold but the carry — and now the carry has a coupon.`, l.tileI);
  return { s };
}

export function buyParcelsOutright(state: GameState, tileI: number, cells: number[]): { s: GameState; err?: string } {
  // The old fiction — every vacant parcel instantly purchasable at a computed price —
  // is dead. Unlisted land has an owner who didn't wake up wanting to sell.
  void tileI; void cells;
  return { s: clone(state), err: 'Unlisted land isn\'t yours to click-buy — approach the owners.' };
}
export function landValue(state: GameState, h: LandHolding): number {
  return roundPrice(h.cells.length * PARCEL_AC * landPricePerAcre(state, state.tiles[h.tileI]));
}
// Dirt doesn't trade like buildings: no rent roll to underwrite, a thin buyer pool,
// and everyone who calls has a different plan for it — so it sells slowly, and the
// offers land all over the map. You list it, then you wait.
export function listLandForSale(state: GameState, holdingId: number, ask?: number): { s: GameState; err?: string } {
  const s = clone(state);
  const h = s.land.find(x => x.id === holdingId);
  if (!h) return { s, err: 'Holding gone.' };
  if (h.forSale) return { s, err: 'Already on the market. Patience — it\'s dirt.' };
  h.forSale = { ask: Math.round(ask ?? landValue(s, h)), sinceM: s.month };
  pushNews(s, 'info', `Your ${Math.round(h.cells.length * PARCEL_AC * 100) / 100} acres at block ${blockLabel(s.tiles[h.tileI])} is on the market at ${fmtMoney(h.forSale.ask)}. Land moves slowly — months, not weeks — and the offers will not agree with each other.`, h.tileI);
  return { s };
}
export function repayLandLoan(state: GameState, holdingId: number): { s: GameState; err?: string } {
  const s = clone(state);
  const h = s.land.find(x => x.id === holdingId);
  if (!h?.loan) return { s, err: 'No land loan there.' };
  if (s.cash < h.loan.balance) return { s, err: `Payoff is ${fmtMoney(h.loan.balance)} — you're short.` };
  s.cash -= h.loan.balance;
  logCF(s, 'debt', `Land loan repaid — block ${blockLabel(s.tiles[h.tileI])}`, -h.loan.balance);
  pushNews(s, 'info', `Land loan on block ${blockLabel(s.tiles[h.tileI])} repaid: ${fmtMoney(h.loan.balance)}. The dirt is free and clear.`, h.tileI);
  h.loan = undefined;
  return { s };
}
export function delistLand(state: GameState, holdingId: number): GameState {
  const s = clone(state);
  const h = s.land.find(x => x.id === holdingId);
  if (!h || !h.forSale) return s;
  h.forSale = undefined;
  s.saleOffers = s.saleOffers.filter(o => o.landId !== holdingId);
  pushNews(s, 'info', `Pulled the ${Math.round(h.cells.length * PARCEL_AC * 100) / 100} acres at block ${blockLabel(s.tiles[h.tileI])} off the market.`);
  return s;
}
// ---------- Rezoning: paper into value ----------
// You don't need to own the whole block to ask the council to rezone it — you need
// standing: dirt, a contract, a building, or a project there. What you're really buying
// is a land-value markup on the day of the vote, which is the oldest trade in the business.
export function playerStandingOn(s: GameState, tileI: number): boolean {
  return s.land.some(h => h.tileI === tileI)
    || s.assets.some(a => a.tileI === tileI)
    || s.listings.some(l => l.tileI === tileI && !!l.underContract);
}
export function rezoneCost(s: GameState, tileI: number, toUse: ZoneUse, toTier: 1 | 2 | 3): number {
  const z = s.tiles[tileI].zone;
  const useChange = toUse !== z.use;
  const tierJump = Math.max(0, toTier - z.tier);
  // counsel, traffic study, environmental, filing fees — and the bigger the ask, the bigger the bill
  return roundPrice((35_000 + (useChange ? 55_000 : 0) + 45_000 * tierJump) * s.econ.costIdx);
}
// The honest odds — computed fresh each time, because the neighborhood keeps changing.
export function rezoneOdds(s: GameState, tileI: number, toUse: ZoneUse, toTier: 1 | 2 | 3): { p: number; read: string } {
  const t = s.tiles[tileI];
  const z = t.zone;
  let p = 0.62;
  // coherence: rezoning to match your neighbors is planning; rezoning against them is spot zoning
  const W = CONFIG.GRID_W;
  const neigh = [[1, 0], [-1, 0], [0, 1], [0, -1]]
    .map(([dx, dy]) => s.tiles[(t.y + dy) * W + t.x + dx])
    .filter(n => n && !n.water && Math.abs(n.x - t.x) + Math.abs(n.y - t.y) === 1);
  const matches = neigh.filter(n => n.zone.use === toUse).length;
  p += matches >= 2 ? 0.14 : matches === 1 ? 0.05 : -0.16;
  // opposition: the people who live nearby show up to hearings. Industrial and towers draw crowds.
  const avgPop = neigh.length ? neigh.reduce((a, n) => a + n.pop, 0) / neigh.length : t.pop;
  if (toUse === 'M') p -= 0.30 * (avgPop / 100);
  if (toTier === 3) p -= 0.14 * (avgPop / 100);
  if (toTier - z.tier >= 2) p -= 0.12;                     // two tiers in one ask is greedy
  if (toUse === 'R' || toUse === 'MU') p += 0.07;           // housing plays well at the podium
  if (s.econ.phase === 'expansion' || s.econ.phase === 'peak') p += 0.06;  // growth councils say yes
  if (s.econ.phase === 'recession') p -= 0.04;
  p += (s.reputation - 50) * 0.002;                          // a good name fills the room with allies
  p = clamp(p, 0.12, 0.93);
  const read = p > 0.72 ? 'Counsel likes your chances.'
    : p > 0.5 ? 'A real fight, but winnable.'
    : p > 0.3 ? 'Uphill — pack the hearing room.'
    : 'Counsel advises against filing. Strongly.';
  return { p, read };
}
export function canApplyRezone(s: GameState, tileI: number): { ok: boolean; why?: string } {
  const t = s.tiles[tileI];
  if (!t || t.water) return { ok: false, why: 'Nothing to rezone.' };
  if (s.rezonings.some(r => r.tileI === tileI)) return { ok: false, why: 'This block is already before the council.' };
  const denied = s.rezoneDenied[tileI];
  if (denied !== undefined && s.month - denied < 24) return { ok: false, why: `The council said no in ${monthName(denied)}. Reapplying inside two years reads as contempt.` };
  if (!playerStandingOn(s, tileI)) return { ok: false, why: 'You need standing here — dirt, a contract, or a building — before the council will hear you.' };
  return { ok: true };
}
export function applyRezoning(state: GameState, tileI: number, toUse: ZoneUse, toTier: 1 | 2 | 3): { s: GameState; err?: string } {
  const s = clone(state);
  const gate = canApplyRezone(s, tileI);
  if (!gate.ok) return { s, err: gate.why };
  const t = s.tiles[tileI];
  if (t.zone.use === toUse && t.zone.tier === toTier) return { s, err: 'That\'s what the block is already zoned.' };
  const cost = rezoneCost(s, tileI, toUse, toTier);
  if (s.cash < cost) return { s, err: `Filing runs ${fmtMoney(cost)} — counsel, studies, fees.` };
  s.cash -= cost;
  logCF(s, 'fees', 'Rezoning application', -cost);
  const months = 5 + Math.round(rng(s) * 4);
  s.rezonings.push({ id: s.nextId++, tileI, toUse, toTier, decideM: s.month + months, cost });
  pushNews(s, 'info', `Filed to rezone block ${blockLabel(t)} from ${zoneCode(t.zone)} to ${toUse}-${toTier}. The council hears it in ~${months} months. ${rezoneOdds(s, tileI, toUse, toTier).read}`, tileI);
  return { s };
}
// Losing the anchor trips every co-tenancy clause in the rent roll at once. The
// inline tenants signed up to be next to the anchor, not next to a vacancy.
function tripCoTenancy(s: GameState, a: Asset, ex: { name: string; sf: number }) {
  if (a.type !== 'retail' && a.type !== 'mixed') return;
  if (ex.sf < a.sf * 0.35 || !a.tenants.length) return;
  let cut = 0, fled = 0;
  for (const tn of [...a.tenants]) {
    if (tn.sf >= ex.sf) continue;
    const u = rng(s);
    if (u < 0.22) {
      tn.endM = Math.min(tn.endM, s.month + 1 + Math.round(rng(s) * 2));  // out-clause: they're gone within the quarter
      fled++;
    } else if (u < 0.62) {
      tn.rate = Math.round(tn.rate * 0.85 * 100) / 100;                    // abated until somebody re-anchors the center
      cut++;
    }
  }
  if (cut || fled) pushNews(s, 'warn', `CO-TENANCY TRIPPED at ${a.name}: losing ${ex.name} (${(ex.sf / 1000).toFixed(0)}K SF anchor) let the inline tenants pull their clauses — ${fled ? `${fled} invoking out-clauses` : ''}${fled && cut ? ', ' : ''}${cut ? `${cut} taking a 15% abatement` : ''}. Re-anchor the center or watch it unravel.`, a.tileI);
}

// Hearings resolve on the council's calendar, not yours.
function tickRezonings(s: GameState) {
  for (const r of [...s.rezonings]) {
    if (s.month < r.decideM) continue;
    s.rezonings = s.rezonings.filter(x => x.id !== r.id);
    const t = s.tiles[r.tileI];
    const { p } = rezoneOdds(s, r.tileI, r.toUse, r.toTier);
    const who = r.by ? (s.firms.find(x => x.short === r.by)?.name ?? r.by) : null;
    if (rng(s) < p) {
      const from = zoneCode(t.zone);
      t.zone = { use: r.toUse, tier: r.toTier };
      pushNews(s, 'success', who
        ? `APPROVED: ${who}'s rezoning passed — block ${blockLabel(t)} goes ${from} → ${zoneCode(t.zone)}. Every acre on that block just repriced, whoever holds it.`
        : `APPROVED: block ${blockLabel(t)} rezoned ${from} → ${zoneCode(t.zone)}. The paper changed; the land under it just repriced.`, r.tileI);
    } else {
      s.rezoneDenied[r.tileI] = s.month;
      pushNews(s, 'warn', who
        ? `DENIED: the council killed ${who}'s rezoning at block ${blockLabel(t)}. The neighbors showed up for that one too.`
        : `DENIED: the council killed your rezoning at block ${blockLabel(t)}. The neighbors showed up. Your ${fmtMoney(r.cost)} in fees stays spent.`, r.tileI);
    }
  }
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
// Build on PART of what you own: carve the chosen parcels into their own holding
// (basis follows the dirt, pro-rata) and stage just that site. The rest stays banked.
export function developLandCells(state: GameState, holdingId: number, cells: number[]): { s: GameState; listingId?: number; err?: string } {
  const s = clone(state);
  const h0 = s.land.find(x => x.id === holdingId);
  if (!h0) return { s, err: 'Holding gone.' };
  const d = developableFrom(s, holdingId);
  const dset = new Set(d.cells);
  const picked = [...new Set(cells)].sort((a, b) => a - b);
  if (!picked.length) return { s, err: 'Pick at least one parcel.' };
  if (!picked.every(c => dset.has(c))) return { s, err: 'You can only build on parcels you own here.' };
  if (!isContiguous(picked)) return { s, err: 'The parcels must touch edge-to-edge — one site, not scattered lots.' };
  if (picked.length === d.cells.length) return developLand(state, holdingId);   // the whole thing — the simple path
  if (s.listings.some(l => l.fromLandId !== undefined && d.holdings.includes(l.fromLandId))) return { s, err: 'Part of this site is already staged to build — close or cancel that first.' };
  const tileI = h0.tileI;
  let basis = 0, acquiredM = h0.acquiredM;
  for (const hid of d.holdings) {
    const h = s.land.find(x => x.id === hid);
    if (!h) continue;
    const take = h.cells.filter(c => picked.includes(c));
    if (!take.length) continue;
    acquiredM = Math.min(acquiredM, h.acquiredM);
    if (take.length === h.cells.length) {
      basis += h.basis;
      s.land = s.land.filter(x => x.id !== h.id);
      s.saleOffers = s.saleOffers.filter(o => o.landId !== h.id);
    } else {
      const share = Math.round(h.basis * take.length / h.cells.length);
      h.cells = h.cells.filter(c => !picked.includes(c));
      h.basis -= share;
      basis += share;
      // the parcel under offer just shrank — pull it off the market rather than
      // let a stale buyer pay six-cell money for one cell
      if (h.forSale) { h.forSale = undefined; s.saleOffers = s.saleOffers.filter(o => o.landId !== h.id); }
    }
  }
  const nh: LandHolding = { id: s.nextId++, tileI, cells: picked, basis, acquiredM };
  s.land.push(nh);
  const id = s.nextId++;
  s.listings.push({
    id, tileI, kind: 'land', acres: Math.round(picked.length * PARCEL_AC * 100) / 100,
    price: 0, parcelCells: [...picked],
    expiresMonth: s.month + 6, hot: false, agreed: true, fromLandId: nh.id,
  });
  return { s, listingId: id };
}
export function developLand(state: GameState, holdingId: number): { s: GameState; listingId?: number; err?: string } {
  const s = clone(state);
  const h = s.land.find(x => x.id === holdingId);
  if (!h) return { s };
  if (h.forSale) { h.forSale = undefined; s.saleOffers = s.saleOffers.filter(o => o.landId !== h.id); }   // building on it beats waiting on buyers
  const existing = s.listings.find(l => l.fromLandId === h.id);
  if (existing) return { s, listingId: existing.id };
  const { cells, holdings } = developableFrom(s, holdingId);
  if (s.listings.some(l => l.fromLandId !== undefined && holdings.includes(l.fromLandId))) return { s, err: 'Part of this site is already staged to build — close or cancel that first.' };
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
  void tileI; void cells;
  return { s: clone(state), err: 'Unlisted land isn\'t yours to click-buy — approach the owners, then develop what you\'ve banked.' };
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
  // the bank hires the conservative appraiser — proceeds size off the LOW end of the band
  const band = appraisalBand(state, a);
  const val = band.lo;
  const rate = state.econ.rate + CONFIG.refiSpread;
  const payoff = assetDebt(a);
  const maxByLTV = val * CONFIG.refiLTV;
  const noiYr = assetNOIMonthly(state, a) * 12;
  return { val, rate, payoff, maxByLTV, noiYr, band };
}
export function refiQuote(state: GameState, a: Asset, c: RefiChoice) {
  const lim = refiLimits(state, a);
  const pmt = monthlyPayment(c.amount, lim.rate, c.amortYears);
  const dscr = pmt > 0 ? lim.noiYr / (pmt * 12) : null;
  const proceeds = c.amount - lim.payoff - lim.val * 0.01;
  return { ...lim, pmt, dscr, proceeds, amount: c.amount, amortYears: c.amortYears };
}
export const REFI_FEE_PCT = 0.05;
export function doRefi(state: GameState, assetId: number, c: RefiChoice, lenderId?: string): { s: GameState; err?: string } {
  const s = clone(state); const a = s.assets.find(x => x.id === assetId);
  if (!a) return { s };
  if (s.econ.crunchMonthsLeft > 0 && (!lenderId || lenderPosture(s, lenderId) !== 'open')) return { s, err: 'Credit markets are frozen — only a desk that stays open in a crunch (the debt fund) will quote a refi right now.' };
  if (a.mode !== 'operating' || a.occ < 0.80) return { s, err: 'Lenders want a stabilized asset (80%+ occupied) for permanent debt.' };
  if (s.facilities.some(f => f.assetIds.includes(a.id))) return { s, err: 'This asset is cross-collateralized in a credit facility. Unwind the facility first.' };
  if (c.amortYears < 10 || c.amortYears > CONFIG.refiAmortMax) return { s, err: 'Amortization must be 10–25 years.' };
  const q = refiQuote(s, a, c);
  let rRate = q.rate, rMax = q.maxByLTV, ioM = 0;
  if (lenderId) {
    const val2 = assetValue(s, a);
    const lq = lenderQuote(s, lenderId, { price: val2, type: a.type, quality: a.quality });
    if (!lq.ok) return { s, err: `${LENDERS.find(x => x.id === lenderId)?.short}: ${lq.why}` };
    rRate = Math.round(lq.ratePct * 100) / 100;
    rMax = Math.round(val2 * lq.maxLTV);
    ioM = lq.ioMonths;
  }
  if (c.amount > rMax + 1) return { s, err: `${lenderId ? (LENDERS.find(x => x.id === lenderId)?.short ?? 'The bank') : 'The bank'} tops out at ${fmtMoney(rMax)} on this collateral.` };
  if (c.amount < q.payoff) return { s, err: 'The new loan must at least pay off your existing debt.' };
  const pmt2 = monthlyPayment(c.amount, rRate, c.amortYears);
  const dscr2 = pmt2 > 0 ? (q as any).noiYr / (pmt2 * 12) : null;
  if (dscr2 !== null && dscr2 < CONFIG.refiDSCR) return { s, err: `DSCR ${dscr2.toFixed(2)}× is below the 1.20× the bank needs at ${rRate.toFixed(1)}% / ${c.amortYears}-yr am.` };
  const refiFee = roundPrice(c.amount * REFI_FEE_PCT);
  for (const ln of a.loans) if (ln.lenderId) bumpLenderRel(s, ln.lenderId, 3);   // old paper repaid in full
  if (lenderId) bumpLenderRel(s, lenderId, 2);
  a.loans = [{ id: s.nextId++, kind: 'refi', balance: c.amount, ratePct: rRate, amortYears: c.amortYears, ioMonthsLeft: ioM, monthlyPmt: pmt2, maturityMonth: s.month + CONFIG.loanTermMonths, lenderId }];
  s.cash += q.proceeds - refiFee;
  logCF(s, 'debt', `Refi proceeds — ${a.name} (net of ${fmtMoney(refiFee)} points)`, q.proceeds - refiFee);
  a.basis += refiFee;
  a.ledger.push({ m: s.month, amt: q.proceeds - refiFee });
  pushNews(s, 'success', `Refinanced ${a.name}${lenderId ? ` with ${LENDERS.find(x => x.id === lenderId)?.short}` : ''}: ${fmtMoney(c.amount)} at ${rRate.toFixed(1)}%${ioM > 0 ? `, ${ioM} months IO` : ''}, ${c.amortYears}-yr amortization, 10-yr balloon — ${fmtMoney(q.proceeds - refiFee)} back to you after ${fmtMoney(refiFee)} in points and costs.`);
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
  logCF(s, 'debt', `Principal paydown — ${a.name}`, -(amount + penalty));
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
  logCF(s, 'debt', 'Facility paydown', -(amount + penalty));
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
  logCF(s, 'debt', 'Credit facility — net proceeds', amount - q.payoff - fee);
  pushNews(s, 'success', `Credit facility closed: ${fmtMoney(amount)} at ${q.rate.toFixed(1)}% against ${assets.length} cross-collateralized assets. Net ${fmtMoney(amount - q.payoff - fee)} to you. One default now touches everything pledged.`);
  return { s };
}

// ---------- LOI / RFP leasing ----------
export function marketRateForAsset(state: GameState, a: Asset): number {
  return assetRentPSF(state, a) * (1 + a.rentStance);
}
// The market a given letter negotiates against: its component's market in a mixed
// building, the building's own market otherwise.
export function loiMarketRate(state: GameState, a: Asset, loi: Pick<LOI, 'use'>): number {
  return a.type === 'mixed' && loi.use ? componentRentPSF(state, a, loi.use) : assetRentPSF(state, a);
}

function spawnLOIs(s: GameState) {
  const openByAsset = new Map<number, number>();
  for (const l of s.lois) openByAsset.set(l.assetId, (openByAsset.get(l.assetId) ?? 0) + 1);
  for (const a of s.assets) {
    if (a.mode === 'construction' || isAggregate(a.type)) continue;
    // mixed buildings: the office and retail components tour separately, each against
    // its own market; the homes upstairs absorb on their own every month
    let loiUse: PType | undefined;
    let sector: PType = a.type;
    let vacant = a.sf - leasedSF(a);
    let su = suiteSF(a);
    let unitsRef = a.units;
    if (a.type === 'mixed') {
      const comps = mixedComponents(s, a).filter(c => c.comp !== 'multifamily' && c.sf - c.leased >= 800);
      if (!comps.length) continue;
      const c = comps.sort((x, y) => (y.sf - y.leased) - (x.sf - x.leased))[0];
      loiUse = c.comp; sector = c.comp;
      vacant = c.sf - c.leased;
      su = c.sf / c.units;
      unitsRef = c.units;
    } else if (vacant < Math.min(3000, a.sf * 0.9)) continue;
    if ((openByAsset.get(a.id) ?? 0) >= 2 || s.lois.length >= 5) continue;
    const t = s.tiles[a.tileI];
    const df = tileDemandFactor(s, t, sector);
    const qf = 0.78 + (apparentQuality(s, a) / 150) * 0.30;   // demand climbs with every point
    const rentComp = 1 - a.rentStance * 2.2;
    const boost = a.mode === 'leaseup' ? 1.5 : 1;
    // the pool of tenants who can absorb a huge block is thin — big suites sit
    const sizeDrag = clamp(1.2 - su / 30_000, 0.3, 1);
    // in a tight market every vacancy gets toured; in a soft one the phone is quiet
    const amen = (a.programs ?? []).includes('amenity') ? (PROGRAMS.find(p => p.id === 'amenity')?.velocity ?? 1) : 1;
    const p = clamp(CONFIG.absorbBase[sector] * 1.0 * (s.staff?.leasing ? 1.25 : 1) * df * qf * rentComp * boost * sizeDrag * amen * leasingClimate(s, sector) * clamp(vacant / (loiUse ? Math.max(vacant, 1) : a.sf), 0.25, 1), 0.02, 0.34);
    if (rng(s) > p) continue;
    // big-suite tenants come by LOI/RFP; require a meaningful chunk
    const chunkUnits = Math.max(1, Math.min(Math.round(vacant / su), 1 + Math.floor(rng(s) * Math.max(1, unitsRef / 2))));
    const sf = Math.min(vacant, Math.round((chunkUnits * su) / 100) * 100);
    if (sf < 800) continue;
    const credit = rollCredit(s, a.quality + ((a.programs ?? []).includes('smart') ? 12 : 0), t.D);
    const isRFP = rng(s) < 0.3;
    const mkt = loiUse ? componentRentPSF(s, a, loiUse) : assetRentPSF(s, a); // tenant anchors on market, not your stance
    const tight = (s.econ.cityVac[sector] < EQ_VAC[sector] - 1.5 ? 1 : 0) + df - 1;
    const loi: LOI = {
      id: s.nextId++, assetId: a.id, kind: isRFP ? 'rfp' : 'loi',
      tenant: tenantName(s, sector), credit, sf,
      expiresM: s.month + 2, stage: 'open',
      ...(loiUse ? { use: loiUse } : {}),
    };
    // quality changes the posture across the table: nobody lowballs the best building
    // in the submarket, because somebody else will take the space
    const aqn = apparentQuality(s, a) / 150;
    if (!isRFP) {
      loi.rate = Math.round(mkt * rrange(s, 0.88 + aqn * 0.05, 1.0 + tight * 0.03) * 100) / 100;
      loi.termY = [3, 5, 5, 7, 10][Math.floor(rng(s) * 5)];
    }
    // tenants negotiate the whole package: abatement, TI, escalations, options —
    // a soft market emboldens them; a building with a waiting list does the opposite
    const soft = clamp((s.econ.cityVac[sector] - EQ_VAC[sector]) / 9, 0, 0.65);
    if (rng(s) < 0.5 + soft - aqn * 0.18) loi.freeMonths = 1 + Math.floor(rng(s) * (3 + soft * 3));
    if (a.type !== 'multifamily' && rng(s) < 0.4 + soft - aqn * 0.12) loi.tiPsf = Math.round(rrange(s, 4, 14 + soft * 12));
    loi.escPct = rng(s) < 0.45 ? 0 : rng(s) < 0.6 ? 2 : 2.5;   // they open low; 3% is yours to win
    if (rng(s) < 0.14 + soft * 0.18) loi.optionAsk = true;
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
  logCF(s, 'lease-costs', `${a.name} — ${tenant} TI + commission`, -total);
  a.basis += ti;
  a.ledger.push({ m: s.month, amt: -total });
  pushNews(s, 'info', `Signing costs for ${tenant}: ${fmtMoney(ti)} tenant improvements + ${fmtMoney(lc)} leasing commission = ${fmtMoney(total)} out the door. Leases are bought, not found.`);
}

function signLease(s: GameState, a: Asset, loi: LOI, rate: number, termY: number, withConcessions = false, escPct?: number, grantOption?: boolean) {
  // space may have shrunk since the LOI arrived — you can't lease the same suite twice.
  // In a mixed building the lease also can't spill out of its component.
  const compCap = a.type === 'mixed' && loi.use
    ? Math.max(0, (mixedComponents(s, a).find(c => c.comp === loi.use)?.sf ?? 0)
      - a.tenants.filter(t2 => (t2.use ?? 'office') === loi.use).reduce((x, t2) => x + t2.sf, 0))
    : Infinity;
  const vacant = Math.min(a.sf - leasedSF(a), compCap);
  let sfNow = Math.min(loi.sf, Math.floor(vacant / 100) * 100);
  // tenants take whole suites: if what would remain is a sliver, the lease absorbs it —
  // no single-tenant building sits at 96% leased over 200 orphaned feet
  if (sfNow > 0 && vacant - sfNow < Math.max(400, suiteSF(a) * 0.5)) sfNow = vacant;
  if (sfNow < 400) {
    s.lois = s.lois.filter(x => x.id !== loi.id);
    pushNews(s, 'info', `${loi.tenant} needed space at ${a.name} that's no longer available — the deal died at the finish line.`);
    return;
  }
  if (sfNow < loi.sf) pushNews(s, 'info', `${loi.tenant} downsized their lease to the ${(sfNow / 1000).toFixed(1)}K SF still available at ${a.name}.`);
  chargeSigningCosts(s, a, a.type, sfNow, rate, termY, loi.tenant, false);
  if (withConcessions && ((loi.freeMonths ?? 0) > 0 || (loi.tiPsf ?? 0) > 0)) {
    const free = Math.round((loi.freeMonths ?? 0) * sfNow * rate / 12);
    const extraTI = Math.round((loi.tiPsf ?? 0) * sfNow);
    s.cash -= free + extraTI;
    logCF(s, 'lease-costs', `${a.name} — ${loi.tenant} concessions`, -(free + extraTI));
    a.basis += extraTI;
    a.ledger.push({ m: s.month, amt: -(free + extraTI) });
    pushNews(s, 'info', `Concessions for ${loi.tenant}: ${loi.freeMonths ? `${loi.freeMonths} month${loi.freeMonths > 1 ? 's' : ''} free (${fmtMoney(free)})` : ''}${loi.freeMonths && loi.tiPsf ? ' + ' : ''}${loi.tiPsf ? `${fmtMoney(extraTI)} TI package` : ''}. The rate was never the whole deal.`);
  }
  const esc = escPct ?? loi.escPct ?? 2.5;
  const opt = grantOption ?? (withConcessions && !!loi.optionAsk);
  a.tenants.push({
    id: s.nextId++, name: loi.tenant, sf: sfNow, rate: Math.round(rate * 100) / 100,
    startM: s.month, endM: s.month + Math.round(termY * 12), credit: loi.credit,
    escPct: esc,
    ...(loi.use ? { use: loi.use } : {}),
    ...(opt ? { optionRate: Math.round(rate * Math.pow(1 + esc / 100, termY) * 1.05 * 100) / 100, optionYears: 5 } : {}),
  });
  if (opt) pushNews(s, 'info', `${loi.tenant} got their renewal option: 5 more years at a fixed $${(Math.round(rate * Math.pow(1 + esc / 100, termY) * 1.05 * 100) / 100).toFixed(2)}/SF when this term ends. If the market runs past it, that paper is their money — not yours.`);
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
  | { type: 'counter'; rate: number; termY: number; escPct?: number; grantOption?: boolean }   // for LOIs (and counters)
  | { type: 'propose'; rate: number; termY: number; escPct?: number; grantOption?: boolean };  // for RFPs

export function respondLOI(state: GameState, loiId: number, action: LOIAction): { s: GameState; outcome: string } {
  const s = clone(state);
  return { s, outcome: respondLOIIn(s, loiId, action) };
}
// in-place core: advanceMonth's auto-leasing already owns a private clone, so it calls
// this directly — cloning a ~half-megabyte state per LOI was most of the month tick
function respondLOIIn(s: GameState, loiId: number, action: LOIAction): string {
  const loi = s.lois.find(x => x.id === loiId);
  if (!loi) return 'gone';
  const a = s.assets.find(x => x.id === loi.assetId);
  if (!a) { s.lois = s.lois.filter(x => x.id !== loiId); return 'gone'; }
  const mkt = loiMarketRate(s, a, loi);
  const t = s.tiles[a.tileI];
  const tight = clamp((tileDemandFactor(s, t, a.type) - 1) * 0.5 + (EQ_VAC[a.type] - s.econ.cityVac[a.type]) * 0.02, -0.3, 0.35);

  if (action.type === 'decline') {
    s.lois = s.lois.filter(x => x.id !== loiId);
    pushNews(s, 'info', `You passed on ${loi.tenant}.`);
    return 'declined';
  }
  if (action.type === 'accept') {
    const rate = loi.stage === 'countered' ? (loi.counterRate ?? loi.rate ?? mkt) : (loi.rate ?? mkt);
    const termY = loi.stage === 'countered' ? (loi.counterTermY ?? loi.termY ?? 5) : (loi.termY ?? 5);
    if (loi.kind === 'renewal') { applyRenewal(s, a, loi, rate, termY); return 'signed'; }
    signLease(s, a, loi, rate, termY, true, loi.escPct, !!loi.optionAsk);   // their terms, their concessions
    return 'signed';
  }
  // counter / propose: tenant decides
  const asked = action.rate;
  const f = asked / mkt; // how aggressive vs market
  const stick = loi.kind === 'renewal' ? 0.12 : 0; // moving is expensive; incumbents bend a little
  const repEdge = (s.reputation - 50) * 0.001;
  // stripping the concessions they asked for costs you odds; pushing escalations up costs
  // a little; granting the option they wanted buys goodwill you'll pay for later
  const concPenalty = ((loi.freeMonths ?? 0) > 0 ? 0.10 : 0) + ((loi.tiPsf ?? 0) > 0 ? 0.08 : 0);
  const escPush = Math.max(0, (action.escPct ?? 2.5) - (loi.escPct ?? 2.5)) * 0.025;
  const optBoost = action.grantOption && loi.optionAsk ? 0.09 : 0;
  const pAccept = clamp(1.62 - f * 1.4 + loi.credit * 0.03 + tight + stick + repEdge - concPenalty - escPush + optBoost + (action.termY >= 7 ? -0.03 : 0), 0.04, 0.95);
  const roll = rng(s);
  if (roll < pAccept) {
    if (loi.kind === 'renewal') { applyRenewal(s, a, loi, asked, action.termY); return 'signed'; }
    signLease(s, a, loi, asked, action.termY, false, action.escPct, action.grantOption);
    return 'signed';
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
    return 'walked';
  }
  // they counter back once — final
  loi.stage = 'countered';
  loi.counterRate = Math.round(clamp(mkt * rrange(s, 0.94, 1.0), (loi.rate ?? mkt * 0.9), asked) * 100) / 100;
  loi.counterTermY = action.termY;
  pushNews(s, 'info', `${loi.tenant} countered: $${loi.counterRate.toFixed(2)}/SF, ${loi.counterTermY}-yr term. Final answer — accept or lose them.`);
  return 'countered';
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
      logCF(s, 'tax', 'Income tax', -due);
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
export function saleTaxes(_s: GameState, a: Asset, gross: number): { gain: number; tax: number } {
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
        (f.style === 'core' && a.quality > 82) || f.style === 'aggressive' || f.style === 'value-add' && a.quality < 75));
      const buyer = fitFirms.length ? rpick(s, fitFirms).name : 'A family office';
      const rich = s.econ.phase === 'peak' || (s.econ.capInflowMonthsLeft ?? 0) > 0;
      const amount = roundPrice(val * rrange(s, rich ? 0.96 : 0.88, rich ? 1.14 : 1.04));
      s.saleOffers.push({ id: s.nextId++, assetId: a.id, amount, buyer, ceiling: roundPrice(amount * rrange(s, 1.0, 1.08)), expiresM: s.month + 2 });
      pushNews(s, 'event', `UNSOLICITED: ${buyer} called about ${a.name} — ${fmtMoney(amount)} (${Math.round((amount / Math.max(1, val)) * 100)}% of appraisal), no listing, no process. ${amount > val ? 'Above your own appraisal. Someone wants it more than you do.' : 'Below your number, but cash is cash.'}`);
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
      // buyers respond to the ASK: most offers land below it, and nobody bids over a
      // number the seller printed unless the market is molten. A cheap ask draws bids
      // near full; a rich ask draws haircuts against the appraisal underneath it.
      const hi = phase === 'peak' ? 1.05 : 1.0;
      const anchor = Math.min(a.forSale.ask, val * hi);
      const amount = roundPrice(anchor * (0.68 + Math.pow(rng(s), 0.7) * 0.32));
      const buyerPool = [...s.firms.filter(f => f.alive).map(f => f.name), 'A family office', 'A 1031 exchange buyer', 'A private syndicate'];
      const o: SaleOffer = {
        id: s.nextId++, assetId: a.id, amount, buyer: rpick(s, buyerPool),
        ceiling: roundPrice(Math.min(amount * rrange(s, 1.0, 1.12), Math.max(amount, a.forSale.ask * 1.01))),
        expiresM: s.month + 2,
      };
      s.saleOffers.push(o);
      pushNews(s, 'event', `OFFER: ${o.buyer} bid ${fmtMoney(amount)} for ${a.name} (${Math.round((amount / Math.max(1, a.forSale.ask)) * 100)}% of your ${fmtMoney(a.forSale.ask)} ask).`);
    }
  }
  // listed dirt: a thin market of people with very different plans for the same acres.
  // Offers are rare, and they scatter — a lowball assembler one month, a 1031 buyer
  // with a deadline the next.
  for (const h of s.land) {
    if (!h.forSale) continue;
    if (s.saleOffers.some(o => o.landId === h.id)) continue;
    const val = landValue(s, h);
    const askRatio = h.forSale.ask / Math.max(1, val);
    const phase = s.econ.phase;
    let p = 0.10 + (phase === 'peak' ? 0.09 : phase === 'expansion' ? 0.04 : phase === 'recession' ? -0.06 : 0)
      + clamp((1 - askRatio) * 0.35, -0.08, 0.12)
      + Math.min(0.08, (s.month - h.forSale.sinceM) * 0.006);
    if (rng(s) < clamp(p, 0.02, 0.32)) {
      const hi = phase === 'peak' ? 1.18 : 1.04;
      // a block on the way up draws real bids — the buyers can see the same cranes you can.
      // Patient dirt in a rising neighborhood is a strategy, not a donation.
      const heat = clamp(1 + (s.tiles[h.tileI].dMom ?? 0) * 0.06, 0.96, 1.12);
      const amount = roundPrice(val * (0.58 + Math.pow(rng(s), 0.65) * (hi - 0.58)) * heat);
      const buyers = [...s.firms.filter(f => f.alive).map(f => f.name), 'A homebuilder', 'A self-storage group', 'A 1031 exchange buyer', 'A church group', 'A car-wash chain'];
      s.saleOffers.push({
        id: s.nextId++, landId: h.id, amount, buyer: rpick(s, buyers),
        ceiling: roundPrice(amount * rrange(s, 1.0, 1.15)), expiresM: s.month + 2,
      });
      pushNews(s, 'event', `DIRT OFFER: ${s.saleOffers[s.saleOffers.length - 1].buyer} bid ${fmtMoney(amount)} for your acres at block ${blockLabel(s.tiles[h.tileI])} (${Math.round((amount / Math.max(1, val)) * 100)}% of appraisal). Land offers don't agree with each other — that's the asset class.`, h.tileI);
    }
  }
}

export function respondSaleOffer(state: GameState, offerId: number, action: { type: 'accept' } | { type: 'decline' } | { type: 'counter'; amount: number }): { s: GameState; pm?: PostMortem; outcome: string } {
  const s = clone(state);
  const o = s.saleOffers.find(x => x.id === offerId);
  if (!o) return { s, outcome: 'gone' };
  if (o.landId !== undefined) return respondLandOffer(s, o, action);
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

// Land offers settle in cash against basis — no debt to pay off, no cap rate to argue about.
function respondLandOffer(s: GameState, o: SaleOffer, action: { type: 'accept' } | { type: 'decline' } | { type: 'counter'; amount: number }): { s: GameState; outcome: string } {
  const h = s.land.find(x => x.id === o.landId);
  if (!h) { s.saleOffers = s.saleOffers.filter(x => x.id !== o.id); return { s, outcome: 'gone' }; }
  const closeDirt = (gross: number) => {
    const payoff = h.loan?.balance ?? 0;
    const proceeds = Math.round(gross * 0.97);        // after closing costs
    const net = proceeds - payoff;                    // the land loan clears at the table
    const profit = proceeds - h.basis;                // economic gain vs basis — the loan was never yours
    s.cash += net;
    logCF(s, 'sell', `Sold dirt at block ${blockLabel(s.tiles[h.tileI])}${payoff > 0 ? ' (net of land loan)' : ''}`, net);
    s.totalRealizedProfit += profit;
    s.land = s.land.filter(x => x.id !== h.id);
    s.saleOffers = s.saleOffers.filter(x => x.landId !== h.id);
    logDeal(s, { m: s.month, action: 'land sell', name: `Block ${blockLabel(s.tiles[h.tileI])} dirt`, type: 'land', sf: Math.round(h.cells.length * PARCEL_AC * 43_560), price: proceeds, holdMo: s.month - h.acquiredM, profit });
    pushNews(s, profit >= 0 ? 'success' : 'warn', `Sold your ${Math.round(h.cells.length * PARCEL_AC * 100) / 100} acres at block ${blockLabel(s.tiles[h.tileI])} to ${o.buyer} for ${fmtMoney(net)} net${payoff > 0 ? ` after retiring the ${fmtMoney(payoff)} land loan` : ''} — ${profit >= 0 ? 'a gain' : 'a loss'} of ${fmtMoney(Math.abs(profit))} against your ${fmtMoney(h.basis)} basis.`, h.tileI);
  };
  if (action.type === 'decline') {
    s.saleOffers = s.saleOffers.filter(x => x.id !== o.id);
    return { s, outcome: 'declined' };
  }
  if (action.type === 'accept') { closeDirt(o.amount); return { s, outcome: 'sold' }; }
  if (action.amount <= o.ceiling) { closeDirt(action.amount); return { s, outcome: 'sold' }; }
  if (o.countered || rng(s) < 0.55) {
    s.saleOffers = s.saleOffers.filter(x => x.id !== o.id);
    pushNews(s, 'warn', `${o.buyer} walked from the dirt at block ${blockLabel(s.tiles[h.tileI])}. Your ${fmtMoney(action.amount)} counter was past their number, and land buyers rarely stretch.`);
    return { s, outcome: 'walked' };
  }
  o.countered = true;
  o.amount = o.ceiling;
  pushNews(s, 'info', `${o.buyer} came back at ${fmtMoney(o.ceiling)} on the dirt — best and final.`);
  return { s, outcome: 'countered' };
}

// ---------- Appraisal is an opinion ----------
// Nobody KNOWS what a building is worth — appraisers defensibly disagree, and the band
// of defensible opinions is widest exactly when you'd most like certainty. Stabilized
// product (80%+ leased) with fresh comps in an open market prices tight; empty, oddball,
// or frozen-market product is anyone's guess. The midpoint is your mark. The band is
// the truth.
export function appraisalHalfPts(state: GameState, type: PType, quality: number, occ: number): number {
  const leaseGap = clamp((0.80 - occ) * 2.0, 0, 0.8);                // under 80% leased, the opinions scatter
  const compsN = state.comps.filter(c => c.type === type && state.month - c.m <= 24).length;
  const thin = clamp((4 - compsN) * 0.09, 0, 0.36);                  // nothing traded lately → nobody knows
  const frozen = (state.econ.crunchMonthsLeft > 0 ? 0.30 : 0) + (state.econ.phase === 'recession' ? 0.20 : 0);
  const odd = quality < 45 || quality > 135 ? 0.15 : 0;              // trophy and junk both defy the comps
  return clamp(0.45 + leaseGap + thin + frozen + odd, 0.35, 1.6);
}
export function appraisalBand(state: GameState, a: Asset): { lo: number; mid: number; hi: number; capMid: number; halfPts: number } {
  const mid = assetValue(state, a);
  const t = state.tiles[a.tileI];
  const capMid = Math.max(4, capRatePct(state, t, a.type, a.quality) + (isAggregate(a.type) ? 0 : creditCapAdjPts(a.tenants)));
  const halfPts = appraisalHalfPts(state, a.type, a.quality, a.occ ?? 0);
  return {
    lo: Math.round(mid * capMid / (capMid + halfPts)),
    mid: Math.round(mid),
    hi: Math.round(mid * capMid / Math.max(3.0, capMid - halfPts)),
    capMid: Math.round(capMid * 100) / 100,
    halfPts: Math.round(halfPts * 100) / 100,
  };
}

// ---------- Selling ----------
export function sellQuote(state: GameState, a: Asset) {
  const band = appraisalBand(state, a);
  // the instant sale is the fast nickel: whoever wires this quarter prices in the LOWER
  // half of the band. Reaching for the top half means listing it and waiting. The draw
  // is seeded per asset per quarter — the broker's current opinion, not a slot machine.
  const r = mulberry32((state.seed ^ Math.imul(a.id + 1, 0x9E3779B9) ^ Math.imul(Math.floor(state.month / 3) + 1, 0x85EBCA6B)) | 0)();
  const sentiment = state.econ.phase === 'peak' ? 1.04 : state.econ.phase === 'recession' ? 0.94 : 1;
  const gross = (band.lo + (band.mid - band.lo) * r) * sentiment;
  const costs = gross * CONFIG.saleCostPct;
  const payoff = assetDebt(a);
  const facRelease = facilityShare(state, a) * 1.05; // release price: allocated share + 5%
  const net = gross - costs - payoff - facRelease;
  return { gross, costs, payoff, facRelease, net, sentiment, band };
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
  logCF(s, 'sell', `Sold ${a.name}`, q.net);
  for (const ln of a.loans) if (ln.lenderId) bumpLenderRel(s, ln.lenderId, 3);
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
    bldg: { type: a.type, construction: a.construction, sf: a.sf, units: a.units, quality: a.quality, age: a.age, occ: a.occ, tileI: a.tileI },
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
    logCF(s, 'jv', `JV waterfall — ${a.name}`, -lpTotal);
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
    logCF(s, 'tax', `Sale taxes — ${a.name}`, -tx.tax);
    pushNews(s, 'warn', `Sale taxes on ${a.name}: ${fmtMoney(tx.tax)} (depreciation recapture + capital gains). ${!a.jv && !s.prefer1031 ? 'A 1031 election (Debt tab) would have deferred this.' : ''}`);
  }
  s.stock.push({
    id: s.nextId++, tileI: a.tileI, type: a.type, sf: a.sf, units: a.units,
    px: a.px, py: a.py, pw: a.pw, ph: a.ph, cells: a.cells ? [...a.cells] : undefined,
    quality: Math.round(a.quality), age: Math.round(a.age), construction: a.construction,
    mix: a.mix,
    occ: Math.round(a.occ * 100) / 100, owner: 'private',
  });
  s.assets = s.assets.filter(x => x.id !== a.id);
  s.lois = s.lois.filter(x => x.assetId !== a.id);
  logDeal(s, { m: s.month, action: 'sell', name: a.name, type: a.type, sf: a.sf, price: q.gross, capPct: q.gross > 0 ? Math.round((assetNOIMonthly(s, a) * 12 / q.gross) * 10000) / 100 : null, holdMo: s.month - a.acqMonth, profit });
  pushNews(s, profit >= 0 ? 'success' : 'warn', `Sold ${a.name} to ${buyer} for ${fmtMoney(q.gross)} — ${profit >= 0 ? 'profit' : 'loss'} of ${fmtMoney(Math.abs(profit))}${irr !== null ? ` (${irr.toFixed(1)}% IRR)` : ''}.`);
  return { s, pm };
}

// ---------- Monthly tick ----------
// ---------- Named lenders: five desks, five personalities, one relationship each ----------
export interface LenderDef { id: string; name: string; short: string; blurb: string }
export const LENDERS: LenderDef[] = [
  { id: 'fnb', name: 'First National of New Amsterdam', short: 'First National', blurb: 'The hometown bank. Small checks, honest spreads, and they answer the phone in a crunch — for their friends.' },
  { id: 'hbv', name: 'Harborview Bank', short: 'Harborview', blurb: 'The regional. Bigger checks, covenant-happy, tightens fast when the cycle turns.' },
  { id: 'col', name: 'Colonial Life Insurance', short: 'Colonial Life', blurb: 'Life-company money: the cheapest debt in town, for trophy product only. Low leverage, long memory.' },
  { id: 'ibx', name: 'Ironbridge Credit Partners', short: 'Ironbridge', blurb: 'The debt fund. They will lend on anything, at a price, in any market. The price is the point.' },
  { id: 'mst', name: 'Meridian Street Capital', short: 'Meridian St', blurb: 'The CMBS desk. Sharp pricing on big loans, interest-only years — and the window slams shut the day markets wobble.' },
];
export interface LoanQuote { lenderId: string; ok: boolean; why?: string; ratePct: number; maxLTV: number; amortYears: number; ioMonths: number; minDSCR?: number }
// every desk has its own coverage floor: the banks are banks, the life company wants a
// fortress, and Ironbridge will carry a building that barely pays — the price is the point
export const LENDER_MIN_DSCR: Record<string, number> = { fnb: 1.25, hbv: 1.25, col: 1.35, ibx: 0.75, mst: 1.20 };
export function lenderPosture(s: GameState, id: string): 'open' | 'tight' | 'closed' {
  const crunch = s.econ.crunchMonthsLeft > 0, rec = s.econ.phase === 'recession';
  if (id === 'mst') return crunch || rec ? 'closed' : 'open';
  if (crunch) return id === 'ibx' ? 'open' : 'tight';
  return 'open';
}
export function lenderQuote(s: GameState, lenderId: string, deal: { price: number; type: PType; quality: number }): LoanQuote {
  const rel = s.lenderRel?.[lenderId] ?? 20;
  const disc = clamp((rel - 20) * 0.006, 0, 0.5);   // a name they trust is worth up to 50bps
  const crunch = s.econ.crunchMonthsLeft > 0;
  const base = s.econ.rate;
  const no = (why: string): LoanQuote => ({ lenderId, ok: false, why, ratePct: 0, maxLTV: 0, amortYears: 0, ioMonths: 0 });
  if (lenderPosture(s, lenderId) === 'closed') return no('The window is closed — securitization is dead until markets reopen.');
  if (lenderId === 'fnb') {
    const ltv = crunch ? 0.58 : 0.68;
    if (deal.price * ltv > 6_000_000) return no('Past their legal lending limit — the hometown bank writes checks to $6M of exposure.');
    return { lenderId, ok: true, ratePct: base + 2.55 - disc, maxLTV: ltv, amortYears: 25, ioMonths: 0, minDSCR: LENDER_MIN_DSCR.fnb };
  }
  if (lenderId === 'hbv') {
    const ltv = crunch ? 0.62 : 0.72;
    if (deal.price * ltv > 20_000_000) return no('Above the regional\'s hold size.');
    return { lenderId, ok: true, ratePct: base + 2.25 + (crunch ? 0.5 : 0) - disc, maxLTV: ltv, amortYears: 30, ioMonths: 0, minDSCR: LENDER_MIN_DSCR.hbv };
  }
  if (lenderId === 'col') {
    const minQ = crunch ? 110 : 96;
    if (deal.quality < minQ) return no(`Life-company money wants ${crunch ? 'trophy' : 'Class A'} product — quality ${minQ}+.`);
    if (deal.price < 6_000_000) return no('Below their minimum check — they don\'t underwrite anything under $6M.');
    return { lenderId, ok: true, ratePct: base + 1.55 - disc, maxLTV: 0.58, amortYears: 30, ioMonths: 0, minDSCR: LENDER_MIN_DSCR.col };
  }
  if (lenderId === 'ibx') {
    return { lenderId, ok: true, ratePct: base + (crunch ? 5.4 : 4.1) - disc, maxLTV: crunch ? 0.75 : 0.80, amortYears: 30, ioMonths: 36, minDSCR: LENDER_MIN_DSCR.ibx };
  }
  // mst
  if (deal.price < 10_000_000) return no('Below the securitization minimum — CMBS starts at $10M.');
  return { lenderId, ok: true, ratePct: base + 1.95, maxLTV: 0.75, amortYears: 30, ioMonths: 60, minDSCR: LENDER_MIN_DSCR.mst };   // no relationship pricing: the bonds don't know you
}
export function lenderQuotesFor(s: GameState, deal: { price: number; type: PType; quality: number }): LoanQuote[] {
  return LENDERS.map(l => lenderQuote(s, l.id, deal));
}
export function bumpLenderRel(s: GameState, id: string | undefined, amt: number) {
  if (!id || !s.lenderRel) return;
  s.lenderRel[id] = clamp((s.lenderRel[id] ?? 20) + amt, 0, 100);
}
function tickLenderRel(s: GameState) {
  if (!s.lenderRel) return;
  for (const a of s.assets) for (const l of a.loans) {
    if (!l.lenderId) continue;
    if ((l as any).sweep) bumpLenderRel(s, l.lenderId, -0.4);   // a tripped covenant sours the coffee
    else bumpLenderRel(s, l.lenderId, 0.08);                    // quiet, performing paper builds the name
  }
}

// ---------- Rate hedging: floats, fixes, and caps ----------
export function swapToFloating(state: GameState, assetId: number, loanId: number): { s: GameState; err?: string } {
  const s = clone(state);
  const a = s.assets.find(x => x.id === assetId); const l = a?.loans.find(x => x.id === loanId);
  if (!a || !l) return { s, err: 'Loan not found.' };
  if (l.kind === 'constr') return { s, err: 'Construction debt floats or fixes at closing — too late to restructure mid-build.' };
  if (l.floating) return { s, err: 'Already floating.' };
  const spread = Math.max(1.2, l.ratePct - s.econ.rate) - 0.35;   // floating trades 35bps inside your fixed coupon
  l.floating = true; l.spreadPct = Math.round(spread * 100) / 100;
  l.ratePct = Math.round((s.econ.rate + l.spreadPct) * 100) / 100;
  if (l.monthlyPmt > 0) l.monthlyPmt = monthlyPayment(l.balance, l.ratePct, l.amortYears);
  pushNews(s, 'info', `${a.name}: swapped to floating at base + ${l.spreadPct.toFixed(2)}% (${l.ratePct.toFixed(2)}% today). Cheaper while rates behave — you're the one wearing the rate risk now.`);
  return { s };
}
export function fixRate(state: GameState, assetId: number, loanId: number): { s: GameState; err?: string } {
  const s = clone(state);
  const a = s.assets.find(x => x.id === assetId); const l = a?.loans.find(x => x.id === loanId);
  if (!a || !l) return { s, err: 'Loan not found.' };
  if (!l.floating || l.kind === 'constr') return { s, err: 'Only floating permanent debt can be fixed.' };
  l.floating = false; l.capStrike = undefined;
  l.ratePct = Math.round((s.econ.rate + (l.spreadPct ?? 2.5) + 0.35) * 100) / 100;
  if (l.monthlyPmt > 0) l.monthlyPmt = monthlyPayment(l.balance, l.ratePct, l.amortYears);
  pushNews(s, 'info', `${a.name}: fixed at ${l.ratePct.toFixed(2)}% for the remaining term. Certainty costs 35bps; sleep is included.`);
  return { s };
}
// a cap costs more when the world is volatile and the ceiling is close — priced off this era's temperament
export function rateCapQuote(state: GameState, l: Loan): { strike: number; premium: number } {
  const strike = Math.round((l.ratePct + 1.5) * 4) / 4;
  const vol = state.econ.era?.vol ?? 1;
  const tenorY = clamp((l.maturityMonth - state.month) / 12, 1, 5);
  const premium = roundPrice(l.balance * clamp(0.0035 + (vol - 0.75) * 0.011, 0.003, 0.022) * (tenorY / 3));
  return { strike, premium };
}
export function buyRateCap(state: GameState, assetId: number, loanId: number): { s: GameState; err?: string } {
  const s = clone(state);
  const a = s.assets.find(x => x.id === assetId); const l = a?.loans.find(x => x.id === loanId);
  if (!a || !l) return { s, err: 'Loan not found.' };
  if (!l.floating) return { s, err: 'Caps hedge floating debt — this loan is already fixed.' };
  if (l.capStrike) return { s, err: 'Already capped.' };
  const q = rateCapQuote(s, l);
  if (s.cash < q.premium) return { s, err: `The cap desk wants ${fmtMoney(q.premium)} up front.` };
  s.cash -= q.premium;
  logCF(s, 'fees', `Rate cap premium — ${a.name}`, -q.premium);
  l.capStrike = q.strike;
  pushNews(s, 'success', `${a.name}: bought a rate cap at ${q.strike.toFixed(2)}% for ${fmtMoney(q.premium)}. Whatever the base rate does, this loan stops there.`);
  return { s };
}

// ---------- Foreclosure auctions: the courthouse steps ----------
function startAuction(s: GameState, b: StockBuilding, source: string) {
  if (s.auctions?.some(a => a.stockId === b.id) || b.listedId || b.buildLeft) return;
  const val = stockValue(s, b);
  const rich = s.econ.phase === 'peak' ? 0.98 : s.econ.phase === 'recession' ? 0.78 : 0.88;
  s.auctions.push({
    id: s.nextId++, stockId: b.id, tileI: b.tileI,
    reserve: roundPrice(val * rrange(s, 0.50, 0.62)),
    bid: 0, leader: null,
    rivalMax: roundPrice(val * rrange(s, 0.66, rich)),
    endsM: s.month + 1, source,
  });
  pushNews(s, 'event', `FORECLOSURE AUCTION: the ${(b.sf / 1000).toFixed(0)}K SF ${PLABEL[b.type]} at block ${blockLabel(s.tiles[b.tileI])} goes to the courthouse steps (${source}). As-is, cash or hard money, gone by ${monthName(s.month + 1)}. The marketplace has the details.`, b.tileI);
}
export function placeAuctionBid(state: GameState, auctionId: number, amount: number, hardMoney: boolean): { s: GameState; outcome: 'won' | 'outbid' | 'err'; err?: string } {
  const s = clone(state);
  const au = s.auctions.find(x => x.id === auctionId);
  const b = au ? s.stock.find(x => x.id === au.stockId) : undefined;
  if (!au || !b) return { s, outcome: 'err', err: 'The gavel already fell.' };
  const floor = Math.max(au.reserve, Math.round(au.bid * 1.03));
  if (amount < floor) return { s, outcome: 'err', err: `The clerk won't read a bid under ${fmtMoney(floor)}.` };
  if (amount < au.rivalMax) {
    au.bid = Math.min(au.rivalMax, roundPrice(amount * rrange(s, 1.03, 1.07)));
    au.leader = rpick(s, s.firms.filter(f => f.alive)).short;
    return { s, outcome: 'outbid' };
  }
  // the room goes quiet — you clear the deepest pocket and settle on the spot
  const price = Math.max(au.reserve, Math.min(amount, roundPrice(au.rivalMax * 1.02)));
  const costs = 12_000;
  const loanAmt = hardMoney ? Math.round(price * 0.60) : 0;
  const cashDue = price - loanAmt + costs;
  if (s.cash < cashDue) return { s, outcome: 'err', err: `Settlement is ${fmtMoney(cashDue)} ${hardMoney ? 'with the bridge' : 'in cash'} — you're short.` };
  s.cash -= cashDue;
  logCF(s, 'buy', `Auction — ${(b.sf / 1000).toFixed(0)}K SF ${PLABEL[b.type]} at the steps`, -cashDue);
  const t = s.tiles[b.tileI];
  const rate = s.econ.rate + 4.0;
  const a: Asset = {
    id: s.nextId++, name: nameFor(s, b.type), tileI: b.tileI, type: b.type,
    sf: b.sf, acres: Math.round((b.sf / FAR[b.type] / 43560) * 100) / 100,
    px: b.px, py: b.py, pw: b.pw, ph: b.ph, cells: b.cells ? [...b.cells] : undefined,
    units: b.units, construction: b.construction,
    mix: b.type === 'mixed' ? mixOf(s, b) : undefined,
    quality: b.quality, qCap: constrSpec({ type: b.type, construction: b.construction }).qCap,
    age: b.age, mode: 'operating',
    tenants: genRentRoll(s, { tileI: b.tileI, type: b.type, sf: b.sf, units: b.units, quality: b.quality, construction: b.construction, mix: b.type === 'mixed' ? mixOf(s, b) : undefined, id: b.id, cells: b.cells, px: b.px, py: b.py, pw: b.pw, ph: b.ph }, b.occ), occ: 0,
    rentStance: 0, maint: 'std',
    loans: loanAmt > 0 ? [{ id: s.nextId++, kind: 'acq', balance: loanAmt, ratePct: rate, amortYears: 25, ioMonthsLeft: 24, monthlyPmt: monthlyPayment(loanAmt, rate, 25), maturityMonth: s.month + 24, lenderId: 'ibx' }] : [],
    ledger: [{ m: s.month, amt: -cashDue }], cumCF: 0,
    basis: price + costs, acqMonth: s.month,
    entryNOI: 0, entryCap: capRatePct(s, t, b.type, b.quality),
    negCFStreak: 0,
  };
  if (isAggregate(a.type)) a.occ = b.occ; else recalcOcc(a);
  a.entryNOI = assetNOIMonthly(s, a) * 12;
  a.deprBasis = Math.round(price * 0.80); a.deprTaken = 0;
  s.assets.push(a);
  s.stock = s.stock.filter(x => x.id !== b.id);
  s.listings = s.listings.filter(l => l.stockId !== b.id);
  s.auctions = s.auctions.filter(x => x.id !== au.id);
  s.dealsClosed++;
  logDeal(s, { m: s.month, action: 'buy', name: a.name, type: a.type, sf: a.sf, price, capPct: a.entryNOI > 0 ? Math.round(a.entryNOI / price * 10000) / 100 : null });
  logComp(s, { m: s.month, type: a.type, sf: a.sf, price, capPct: null, tileI: a.tileI, buyer: 'you (auction)' });
  pushNews(s, 'success', `SOLD — to you. ${a.name} off the courthouse steps for ${fmtMoney(price)}${hardMoney ? `, 60% on Ironbridge bridge paper at ${rate.toFixed(1)}% (24-month clock)` : ', all cash'}. The room hated it.`, a.tileI);
  return { s, outcome: 'won' };
}
function tickAuctions(s: GameState) {
  if (!s.auctions) return;
  for (const au of [...s.auctions]) {
    if (au.endsM > s.month) continue;
    const b = s.stock.find(x => x.id === au.stockId);
    s.auctions = s.auctions.filter(x => x !== au);
    if (!b) continue;
    const firms = s.firms.filter(f => f.alive && f.cash > au.rivalMax * 0.4);
    if (firms.length && rng(s) < 0.85) {
      const f = au.leader ? (s.firms.find(x => x.short === au.leader && x.alive) ?? rpick(s, firms)) : rpick(s, firms);
      const price = Math.max(au.reserve, Math.round(au.rivalMax * rrange(s, 0.9, 1.0)));
      f.cash -= price * 0.35; f.debt += price * 0.65;
      b.owner = f.short;
      if (b.listedId !== undefined) { s.listings = s.listings.filter(l => l.id !== b.listedId); b.listedId = undefined; }
      logComp(s, { m: s.month, type: b.type, sf: b.sf, price, capPct: null, tileI: b.tileI, buyer: f.short });
      pushNews(s, 'deal', `The gavel fell at block ${blockLabel(s.tiles[b.tileI])}: ${f.name} took the ${(b.sf / 1000).toFixed(0)}K SF ${PLABEL[b.type]} for ${fmtMoney(price)}. You watched.`, b.tileI);
    } else {
      listStockBuilding(s, b, { distressed: true, priceMult: rrange(s, 0.7, 0.8), hot: true, expiresMonth: s.month + 4 });
      pushNews(s, 'info', `No sale at the steps — the lender took block ${blockLabel(s.tiles[b.tileI])} back and listed it REO, priced to leave.`, b.tileI);
    }
  }
  // rare: a private owner's lender forecloses without a firm collapsing first
  if (!s.auctions.length && rng(s) < (s.econ.phase === 'recession' ? 0.02 : 0.005)) {
    const pool = s.stock.filter(b => b.owner === 'private' && !b.listedId && !b.buildLeft && b.occ < 0.8);
    if (pool.length) startAuction(s, rpick(s, pool), 'a private owner ran out of road');
  }
}

// ---------- Build-to-suit: the tenant brings the lease, you bring the building ----------
const BTS_TENANTS: Record<PType, string[]> = {
  industrial: ['Continental Freight Systems', 'NorthStar Logistics', 'Atlas Cold Chain', 'Vantage Distribution'],
  office: ['Meridian Assurance Group', 'Cortland Data Services', 'The Harriman Firm', 'Pinnacle Health Administrative'],
  retail: ['Greenmarket Grocers', 'Hudson Hardware Co.', 'Falcon Cinemas'],
  mixed: [], multifamily: [],
};
function tickBts(s: GameState) {
  if (!s.btsRfps) return;
  // expiry: they picked somebody, or nobody
  for (const r of [...s.btsRfps]) {
    if (r.respondBy > s.month) continue;
    s.btsRfps = s.btsRfps.filter(x => x !== r);
    pushNews(s, 'info', `${r.tenant}'s build-to-suit RFP closed — they went with a design-build shop from out of town. The lease is gone.`);
  }
  // rivals want that lease too
  for (const r of [...s.btsRfps]) {
    if (rng(s) >= 0.08) continue;
    const f = rpick(s, s.firms.filter(x => x.alive && x.cash > 3_000_000));
    if (!f) continue;
    s.btsRfps = s.btsRfps.filter(x => x !== r);
    const cands = s.tiles.filter(t => !t.water && zoneAllows(t.zone, r.type) && freeParcelCount(s, t.i) >= parcelsNeeded(r.sf, r.type, t.zone.tier));
    if (cands.length) {
      const t = rpick(s, cands);
      const need = Math.max(constrForQuality(r.type, 100).minCells ?? 1, parcelsNeeded(r.sf, r.type, t.zone.tier));
      const spot = findFreeRect(s, t.i, need, () => rng(s));
      if (spot) {
        const months = Math.min(26, Math.max(6, Math.round(4 + r.sf / 7000)));
        s.stock.push({
          id: s.nextId++, tileI: t.i, type: r.type, sf: r.sf, px: spot.px, py: spot.py, pw: spot.pw, ph: spot.ph,
          units: 1, quality: clamp(rrange(s, 95, 120), 45, 138), age: 0,
          construction: constrForQuality(r.type, 105).id,
          occ: 0, owner: f.short, buildLeft: months, buildTotal: months, builder: f.short,
        });
      }
    }
    pushNews(s, 'warn', `${f.name} WON the ${r.tenant} build-to-suit — ${(r.sf / 1000).toFixed(0)}K SF, ${r.termY} years of ${CREDIT_LABEL[r.credit]} credit. They break ground this month; you read about it here.`);
  }
  // new RFPs: a credit tenant decides it wants a building with its name on it
  const employerHot = s.effects?.some(e => e.kind === 'employer');
  const p = (s.econ.phase === 'expansion' ? 0.035 : s.econ.phase === 'recovery' ? 0.025 : 0.01) * (employerHot ? 2.5 : 1);
  if (s.btsRfps.length < 2 && rng(s) < p) {
    const ty: PType = rng(s) < 0.5 ? 'industrial' : rng(s) < 0.75 ? 'office' : 'retail';
    const sf = ty === 'industrial' ? Math.round(rrange(s, 40, 110)) * 1000 : ty === 'office' ? Math.round(rrange(s, 20, 55)) * 1000 : Math.round(rrange(s, 15, 32)) * 1000;
    const credit = (rng(s) < 0.55 ? 2 : 1) as 0 | 1 | 2;
    const mktRent = s.econ.rentIdx[ty] * ({ office: 26, retail: 22, industrial: 8.5, mixed: 24, multifamily: 21 } as Record<PType, number>)[ty];
    const rate = Math.round(mktRent * rrange(s, 1.06, 1.16) * 100) / 100;
    const rfp: BtsRfp = {
      id: s.nextId++, tenant: rpick(s, BTS_TENANTS[ty]), credit, type: ty, sf,
      rate, termY: 15,
      deliverBy: s.month + Math.round(rrange(s, 30, 40)),
      respondBy: s.month + 3,
      penalty: Math.round(sf * rate / 12 * 3 / 1000) * 1000,
    };
    s.btsRfps.push(rfp);
    pushNews(s, 'event', `BUILD-TO-SUIT RFP: ${rfp.tenant} (${CREDIT_LABEL[credit]} credit) wants ${(sf / 1000).toFixed(0)}K SF of purpose-built ${PLABEL[ty].toLowerCase()} — ${rfp.termY} years NNN at $${rate.toFixed(2)}/SF, delivered by ${monthName(rfp.deliverBy)}. Respond by ${monthName(rfp.respondBy)}; the marketplace has the paper.`);
  }
}
// which of your holdings could legally carry this RFP
export function btsEligibleHoldings(s: GameState, r: BtsRfp): { h: LandHolding; cells: number }[] {
  const out: { h: LandHolding; cells: number }[] = [];
  const spec = constrForQuality(r.type, 108);
  for (const h of s.land) {
    const t = s.tiles[h.tileI];
    if (!zoneAllows(t.zone, r.type)) continue;
    const dev = developableFrom(s, h.id);
    if (dev.cells.length < (spec.minCells ?? 1)) continue;   // the spec the tenant expects needs this much dirt
    const maxSF = dev.cells.length * PARCEL_AC * 43_560 * FAR[r.type] * zoneTierMult(t.zone.tier) * upzoneBonus(dev.cells.length);
    if (maxSF < r.sf) continue;
    if (r.sf > CONFIG.tiers[s.tier].maxSF) continue;
    out.push({ h, cells: dev.cells.length });
  }
  return out;
}
export function commitBts(state: GameState, rfpId: number, holdingId: number): { s: GameState; err?: string } {
  let s = clone(state);
  const r = s.btsRfps.find(x => x.id === rfpId);
  if (!r) return { s, err: 'That RFP is gone.' };
  const h = s.land.find(x => x.id === holdingId);
  if (!h) return { s, err: 'Holding gone.' };
  const t = s.tiles[h.tileI];
  if (!zoneAllows(t.zone, r.type)) return { s, err: `Block ${blockLabel(t)} is zoned ${zoneCode(t.zone)} — ${PLABEL[r.type].toLowerCase()} isn't permitted there.` };
  const d = developLand(s, holdingId);
  if (d.err || !d.listingId) return { s, err: d.err ?? 'Could not stage the site.' };
  s = d.s;
  // pick the spec the tenant would expect: purpose-built, mid-A quality
  const spec = constrForQuality(r.type, 108);
  const units = spec.fixedUnits ?? Math.max(1, spec.minUnits ?? 1);
  const choice: DevChoice = {
    type: r.type, sf: r.sf, units, construction: spec.id,
    contractor: 'standard', contingencyPct: 0.10, expedited: false,
    downPct: 0.35, contractType: 'gmp', bonded: true, recourse: false, fixedRate: true, designTier: 'std',
  };
  const l = s.listings.find(x => x.id === d.listingId)!;
  const vErr = validateDev(s, l, choice);
  if (vErr) return { s: clone(state), err: vErr };
  const r2 = buyLandAndDevelop(s, d.listingId, choice);
  if (r2.err) return { s: clone(state), err: r2.err };
  s = r2.s;
  const a = s.assets.reduce((best, x) => (x.id > (best?.id ?? -1) && x.mode === 'construction') ? x : best, undefined as Asset | undefined);
  if (a) {
    a.bts = { rfpId: r.id, tenant: r.tenant, credit: r.credit, rate: r.rate, termY: r.termY, deliverBy: r.deliverBy, penalty: r.penalty };
    a.name = `${r.tenant} BTS`;
  }
  s.btsRfps = s.btsRfps.filter(x => x.id !== r.id);
  pushNews(s, 'success', `COMMITTED: you signed ${r.tenant}'s build-to-suit — ${(r.sf / 1000).toFixed(0)}K SF at block ${blockLabel(t)}, ${r.termY} years NNN at $${r.rate.toFixed(2)}/SF on delivery. Deliver by ${monthName(r.deliverBy)} or the penalty clause reads itself.`, h.tileI);
  return { s };
}

export function advanceMonth(state: GameState): GameState {
  const s = clone(state);
  if (s.gameOver || s.pending.length > 0) return s;
  s.month++;
  s.forcedSaleNotice = undefined;
  tickEconomy(s);
  tickRezonings(s);
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
    logCF(s, 'tax', '1031 window missed — deferred tax due', -s.exchange.deferred);
    pushNews(s, 'warn', `1031 WINDOW MISSED: the ${fmtMoney(s.exchange.deferred)} tax bill from ${s.exchange.fromName} is due today. The IRS does not do extensions for indecision.`);
    s.exchange = undefined;
  }
  if (s.month % 12 === 11) settleIncomeTax(s);
  // payroll: the team costs money every month, whatever the market is doing
  {
    let ga = 0;
    for (const st of STAFF) if (s.staff?.[st.id]) ga += Math.round(st.salary * s.econ.costIdx);
    if (ga > 0) { cf -= ga; logCF(s, 'ga', 'Staff payroll', -ga); }
  }
  // land loans: interest-only carry every month, and a fuse that actually burns down
  for (const h of s.land) {
    if (!h.loan) continue;
    const int = h.loan.balance * (h.loan.ratePct / 100 / 12);
    s.cash -= int; cf -= int;
    logCF(s, 'debt', `Land loan interest — block ${blockLabel(s.tiles[h.tileI])}`, -int);
    if (s.month >= h.loan.maturityMonth) {
      if (s.cash >= h.loan.balance) {
        s.cash -= h.loan.balance; cf -= h.loan.balance;
        logCF(s, 'debt', `Land loan matured — repaid (block ${blockLabel(s.tiles[h.tileI])})`, -h.loan.balance);
        pushNews(s, 'info', `The land loan on block ${blockLabel(s.tiles[h.tileI])} matured — ${fmtMoney(h.loan.balance)} repaid from cash. The dirt is yours free and clear.`, h.tileI);
        h.loan = undefined;
      } else {
        h.loan.maturityMonth = s.month + 12;
        h.loan.ratePct = Math.round((h.loan.ratePct + 1.5) * 100) / 100;
        pushNews(s, 'warn', `LAND LOAN MATURED at block ${blockLabel(s.tiles[h.tileI])} and you can't repay ${fmtMoney(h.loan.balance)}. The bank extends 12 months at +150bps — build it, sell it, or bleed.`, h.tileI);
      }
    }
  }
  tickLenderRel(s);
  tickAuctions(s);
  tickBulkDeal(s);
  tickBts(s);
  // the books keep 24 months; older lines age out
  if (s.cfLog) s.cfLog = s.cfLog.filter(e => e.m > s.month - 25);
  s.approachesLeft = s.staff?.analyst ? 5 : 3; // a fresh month, a fresh call sheet — bigger with an analyst dialing
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
  if (sf <= 0 || isAggregate(a.type)) return;
  // turning space costs 1-3 months of its rent: paint, patch, demising, downtime
  const months = rrange(s, 1, 3);
  const cost = Math.round(sf * assetRentPSF(s, a) / 12 * months / 100) * 100;
  if (cost <= 0) return;
  s.cash -= cost;
  logCF(s, 'lease-costs', `${a.name} — turn costs`, -cost);
  a.ledger.push({ m: s.month, amt: -cost });
  pushNews(s, 'warn', `Turn costs at ${a.name}: ${(sf / 1000).toFixed(1)}K SF of vacated space needs ${fmtMoney(cost)} — about ${months.toFixed(1)} months of its rent — before it can show.`);
}

// Your leasing agent runs the negotiations: solid but unimaginative — signs market-clearing
// deals, holds the line on lowballs, and never squeezes the last nickel you might have.
function autoResolveLOIs(s: GameState) {
  for (const loi of [...s.lois]) {
    const a = s.assets.find(x => x.id === loi.assetId);
    if (!a) continue;
    const mkt = loiMarketRate(s, a, loi);
    const their = loi.stage === 'countered' ? (loi.counterRate ?? loi.rate ?? mkt) : (loi.rate ?? 0);
    let outcome: string;
    if (loi.kind === 'renewal') {
      outcome = respondLOIIn(s, loi.id, their >= mkt * 0.86 ? { type: 'accept' } : { type: 'counter', rate: Math.round(mkt * 0.94 * 100) / 100, termY: loi.termY ?? 5 });
    } else if (loi.kind === 'rfp') {
      outcome = respondLOIIn(s, loi.id, { type: 'propose', rate: Math.round(mkt * 0.985 * 100) / 100, termY: 5 });
    } else if (loi.stage === 'countered' || their >= mkt * 0.94) {
      outcome = respondLOIIn(s, loi.id, { type: 'accept' });
    } else if (their >= mkt * 0.78) {
      outcome = respondLOIIn(s, loi.id, { type: 'counter', rate: Math.round(mkt * 0.97 * 100) / 100, termY: loi.termY ?? 5 });
    } else {
      outcome = respondLOIIn(s, loi.id, { type: 'decline' });
    }
    if (outcome === 'signed') pushNews(s, 'info', `Your leasing agent closed ${loi.tenant} — standard terms, no drama, commission earned.`);
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
  // ~300K at genesis: a real mid-size city with a century of growing (or shrinking) to do
  return Math.round(s.tiles.reduce((t2, t) => t2 + (t.water ? 0 : t.pop), 0) * 26);
}
function recordHistory(s: GameState) {
  s.nwHistory.push({ m: s.month, nw: netWorth(s), cash: s.cash, cf: s.lastMonthCF });
  const occSF = { office: 0, retail: 0, industrial: 0, mixed: 0, multifamily: 0 } as Record<PType, number>;
  const totSF = { office: 0, retail: 0, industrial: 0, mixed: 0, multifamily: 0 } as Record<PType, number>;
  const tallyH = (o: { type: PType; mix?: MixSplit; id?: number; tileI: number }, sf: number, occ: number) => {
    if (o.type === 'mixed') {
      const m = mixOf(s, o);
      for (const c of MIX_COMPONENTS) { occSF[c] += sf * m[c] * occ; totSF[c] += sf * m[c]; }
      return;
    }
    occSF[o.type] += sf * occ; totSF[o.type] += sf;
  };
  for (const b of s.stock) if (!b.buildLeft) tallyH(b, b.sf, b.occ);
  for (const a of s.assets) { if (a.mode !== 'construction') tallyH(a, a.sf, a.occ); }
  // rounded to the thousand SF / two decimals: econHistory is the biggest line in every
  // save and every clone, and the charts can't see the difference
  for (const ty of PTYPES) { occSF[ty] = Math.round(occSF[ty] / 1000) * 1000; totSF[ty] = Math.round(totSF[ty] / 1000) * 1000; }
  const ri = {} as Record<PType, number>;
  for (const ty of PTYPES) ri[ty] = Math.round(s.econ.rentIdx[ty] * 1000) / 1000;
  // the dirt market, remembered: median asking-grade land across the city, monthly
  const landPrices = s.tiles.filter(t => !t.water && !t.park).map(t => landPricePerAcre(s, t)).sort((a, b) => a - b);
  const landP50 = landPrices.length ? Math.round(landPrices[Math.floor(landPrices.length / 2)] / 1000) * 1000 : 0;
  s.econHistory.push({
    m: s.month, rate: Math.round(s.econ.rate * 100) / 100, infl: Math.round(s.econ.inflation * 100) / 100,
    emp: Math.round(s.econ.empIdx * 10) / 10, conf: Math.round(s.econ.confidence * 10) / 10,
    phase: s.econ.phase, ri,
    ci: Math.round(constrCostIdx(s) * 1000) / 1000, occSF, totSF, pop: cityPopulation(s), land: landP50,
    cap: (() => { let best = s.tiles[0]; for (const t of s.tiles) if (!t.water && t.D > best.D) best = t; return Math.round(capRatePct(s, best, 'office', 125) * 100) / 100; })(),
  });
  if (s.nwHistory.length > 520) s.nwHistory.shift();
  if (s.econHistory.length > 520) s.econHistory.shift();
  // refusal memory fades in 4-8 months; records past it are dead weight iterated by the map
  if (s.month % 6 === 0) {
    for (const k in s.parcelApproach) if (s.month - s.parcelApproach[k].m >= 9) delete s.parcelApproach[k];
  }
}

const PHASE_DWELL: Record<Phase, number> = { recovery: 18, expansion: 36, peak: 12, recession: 14 };
const PHASE_NEXT: Record<Phase, Phase> = { recovery: 'expansion', expansion: 'peak', peak: 'recession', recession: 'recovery' };
const PHASE_TARGET: Record<Phase, { rate: number; infl: number; emp: number; conf: number }> = {
  recovery: { rate: 4.2, infl: 2.0, emp: 100, conf: 55 },
  expansion: { rate: 6.0, infl: 3.0, emp: 106, conf: 72 },
  peak: { rate: 7.8, infl: 4.4, emp: 108, conf: 82 },
  recession: { rate: 4.5, infl: 1.6, emp: 92, conf: 32 },
};

// Which way the demographic tide pulls: population growth points, and a smaller
// business-demand term (a metro that's filling up needs offices and warehouses too).
const DEMO_POP: Record<string, number> = { boom: 0.9, steady: 0, stagnation: -0.5, decline: -1.05 };
const DEMO_BIZ: Record<string, number> = { boom: 0.010, steady: 0, stagnation: -0.007, decline: -0.014 };
const DEMO_NEWS: Record<string, string> = {
  boom: 'THE BOOM DECADES BEGIN: the metro is drawing people faster than it can house them. Every unit leases, every corner retail pencils — until everyone builds at once.',
  steady: 'The demographic tide has settled: steady in-migration, normal absorption. The market rewards discipline again, not just presence.',
  stagnation: 'THE LONG PLATEAU: in-migration has stalled. Growth still exists, but it has to be taken from someone else — leasing is a knife fight from here.',
  decline: 'THE EXODUS: the metro is losing people. Vacancy creeps upward citywide, and every pro forma that assumed growth is now wrong. Own the best blocks or own the problem.',
};
function tickDemographics(s: GameState) {
  const e = s.econ;
  if (!e.demo) e.demo = { regime: 'steady', monthsLeft: 144 + Math.floor(rng(s) * 96), n: 1 };
  e.demo.monthsLeft--;
  if (e.demo.monthsLeft <= 0) {
    const pool: ['boom' | 'steady' | 'stagnation' | 'decline', number][] =
      [['boom', 0.28], ['steady', 0.32], ['stagnation', 0.24], ['decline', 0.16]];
    const opts = pool.filter(p => p[0] !== e.demo!.regime);
    const tot = opts.reduce((x, p) => x + p[1], 0);
    let r2 = rng(s) * tot;
    let pick = opts[opts.length - 1][0];
    for (const [k, w] of opts) { r2 -= w; if (r2 <= 0) { pick = k; break; } }
    e.demo = { regime: pick, monthsLeft: 144 + Math.floor(rng(s) * 156), n: e.demo.n + 1 };
    pushNews(s, 'event', DEMO_NEWS[pick]);
  }
}

function tickEconomy(s: GameState) {
  const e = s.econ;
  tickDemographics(s);
  tickEraRotation(s);
  e.phaseAge++;
  if (rng(s) < 1 / (PHASE_DWELL[e.phase] * (e.era?.tempo ?? 1)) && e.phaseAge > PHASE_DWELL[e.phase] * (e.era?.tempo ?? 1) * 0.5) {
    e.phase = PHASE_NEXT[e.phase]; e.phaseAge = 0;
    const msg: Record<Phase, string> = {
      recovery: 'The recession has bottomed. Rates are low, sellers are tired — recoveries are when fortunes are planted.',
      expansion: 'The expansion is broadening: hiring is up, tenants are growing, and money is getting braver.',
      peak: 'The market feels unstoppable. That is usually the tell. Everything you deliver from here lands late-cycle.',
      recession: 'The cycle has turned: layoffs, falling confidence, and lenders remembering what risk is.',
    };
    pushNews(s, 'event', msg[e.phase]);
    if (e.phase === 'recession') {
      // roll this one's severity: most are ordinary; some get named
      e.recSeverity = Math.round(clamp((0.65 + rng(s) * 1.5) * (0.7 + 0.3 * (e.era?.vol ?? 1)), 0.6, 2.3) * 100) / 100;
      if (e.recSeverity > 1.6) pushNews(s, 'event', 'This one is different. The old-timers are using the word "depression" in private, and the young analysts are learning why basements have bars.');
      // the most overbuilt sector takes the bust personally: an immediate markdown,
      // then a year of bleeding while the excess space gets absorbed or abandoned
      if (rng(s) < 0.4) {
        const over = (['office', 'retail', 'industrial', 'multifamily'] as PType[])
          .reduce((x, y) => (e.cityVac[y] - EQ_VAC[y]) > (e.cityVac[x] - EQ_VAC[x]) ? y : x);
        e.bustType = over;
        e.bustMonthsLeft = 10 + Math.floor(rng(s) * 9);
        e.rentIdx[over] *= 1 - (0.03 + rng(s) * 0.04);
        pushNews(s, 'event', `THE ${PLABEL[over].toUpperCase()} BUST: the cycle's favorite got overbuilt, and the music stopped. Asking rents marked down overnight; the bleeding runs until the excess space finds tenants — or the wreckers.`);
      }
    }
    if (e.phase === 'recession' && !e.hadCrunch && rng(s) < 0.5) {
      e.hadCrunch = true; e.crunchMonthsLeft = 12;
      pushNews(s, 'event', 'CREDIT CRUNCH: banks are pulling back. LTVs cut 10 points, refinancing frozen for ~12 months. Leverage is about to be graded.');
    }
    if (e.phase === 'recovery') e.recSeverity = undefined;
  }
  const t0 = PHASE_TARGET[e.phase];
  // severity deepens the trough: a 2.0 recession cuts employment and confidence
  // nearly twice as hard as an ordinary one, and the central bank cuts deeper
  const sev = e.phase === 'recession' ? (e.recSeverity ?? 1) : 1;
  const t = e.phase === 'recession'
    ? { rate: t0.rate - (sev - 1) * 0.7, infl: t0.infl, emp: t0.emp - (sev - 1) * 7, conf: t0.conf - (sev - 1) * 16 }
    : t0;
  if ((e.bustMonthsLeft ?? 0) > 0) {
    e.bustMonthsLeft!--;
    if (e.bustMonthsLeft === 0 && e.bustType) {
      pushNews(s, 'info', `The ${PLABEL[e.bustType].toLowerCase()} bust has bled out — capitulation is complete, the weak hands are gone, and every basis in the sector just reset. Bottoms look like this.`);
      e.bustType = undefined;
    }
  }
  // above ~3.2% inflation the central bank stops being polite: every extra point of
  // inflation pulls the rate target up 1.6 points. A 6% inflation episode means
  // double-digit prime — the bad times the old-timers still talk about.
  const era = e.era ?? { rateBias: 0, inflBias: 0, vol: 1, tempo: 1 };
  const fight = Math.max(0, e.inflation - 3.2) * 1.6;
  e.rate = clamp(e.rate + (t.rate + era.rateBias + fight - e.rate) * 0.10 + (rng(s) - 0.5) * 0.18 * era.vol, 2.0, 13.0);
  e.rateSmooth += (e.rate - e.rateSmooth) * 0.15;
  const tariffHeat = e.tariffMonthsLeft > 0 ? 1.2 : 0;   // tariffs are inflation with paperwork
  e.inflation = clamp(e.inflation + (t.infl + era.inflBias + tariffHeat - e.inflation) * 0.10 + (rng(s) - 0.5) * 0.3 * era.vol, 0, 9);
  e.empIdx = clamp(e.empIdx + (t.emp - e.empIdx) * 0.07 + (rng(s) - 0.5) * 0.5, 80, 115);
  e.confidence = clamp(e.confidence + (t.conf - e.confidence) * 0.09 + (rng(s) - 0.5) * 2.5, 10, 95);
  e.popGrowth = clamp(0.4 + (e.confidence / 100) * 1.4 + (DEMO_POP[e.demo?.regime ?? 'steady'] ?? 0) + (rng(s) - 0.5) * 0.2, -1.2, 2.8);
  e.costIdx *= 1 + (e.inflation * 0.5) / 100 / 12;
  // construction has its own weather: bid climate swings with the cycle and its own momentum
  if (e.constrCycle === undefined) e.constrCycle = 1;
  const cyclePull = e.phase === 'peak' ? 0.0022 : e.phase === 'expansion' ? 0.0012 : e.phase === 'recession' ? -0.0028 : -0.0006;
  e.constrCycle = clamp(e.constrCycle * (1 + cyclePull + (rng(s) - 0.5) * 0.008) + (1 - e.constrCycle) * 0.01, 0.85, 1.22);
  if (e.crunchMonthsLeft > 0) e.crunchMonthsLeft--;
  if (e.tariffMonthsLeft > 0) e.tariffMonthsLeft--;
  if ((e.insSpikeMonthsLeft ?? 0) > 0) e.insSpikeMonthsLeft!--;
  if ((e.capInflowMonthsLeft ?? 0) > 0) e.capInflowMonthsLeft!--;
  if ((e.wfhMonthsLeft ?? 0) > 0) {
    e.wfhMonthsLeft!--;
    if (e.wfhMonthsLeft === 0) {
      // the wave breaks: pent-up leasing comes back to the tour schedule for a while
      e.rtoMonthsLeft = 12;
      pushNews(s, 'event', 'RETURN TO OFFICE: the remote-work wave has crested. Employers are consolidating BACK into space — office tours book out for the next year.');
    }
  }
  if ((e.rtoMonthsLeft ?? 0) > 0) e.rtoMonthsLeft!--;
  if (e.ecomMonthsLeft > 0) e.ecomMonthsLeft--;
  // ---- the leasing market reads the ACTUAL city ----
  // Standing SF and occupied SF, counted building by building — yours, the firms',
  // and every private owner's. When somebody overbuilds industrial, industrial
  // vacancy rises because those exact square feet sit empty, not because a dial moved.
  const occSF: Record<PType, number> = { office: 0, retail: 0, industrial: 0, mixed: 0, multifamily: 0 };
  const totSF: Record<PType, number> = { office: 0, retail: 0, industrial: 0, mixed: 0, multifamily: 0 };
  // mixed buildings ARE their components: their square feet count in the office,
  // retail, and residential markets — there is no separate "mixed market"
  const tally = (o: { type: PType; mix?: MixSplit; id?: number; tileI: number }, sf: number, occ: number) => {
    if (o.type === 'mixed') {
      const m = mixOf(s, o);
      for (const c of MIX_COMPONENTS) { occSF[c] += sf * m[c] * occ; totSF[c] += sf * m[c]; }
      return;
    }
    occSF[o.type] += sf * occ; totSF[o.type] += sf;
  };
  for (const b of s.stock) if (!b.buildLeft) tally(b, b.sf, b.occ);
  for (const a of s.assets) if (a.mode !== 'construction') tally(a, a.sf, a.occ);
  for (const ty of PTYPES) {
    if (ty === 'mixed') continue;   // derived below from the components
    let demandDrift = 0;
    const biz = DEMO_BIZ[e.demo?.regime ?? 'steady'] ?? 0;   // the tide lifts (or drains) business demand too
    if (ty === 'office') demandDrift = 0.04 + (e.empIdx - 99) * 0.014 + biz;
    if (ty === 'retail') demandDrift = 0.022 + (e.confidence - 52) * 0.003 + e.popGrowth * 0.035 - (e.ecomMonthsLeft > 0 ? 0.10 : 0);
    if (ty === 'industrial') demandDrift = 0.045 + (e.ecomMonthsLeft > 0 ? 0.08 : 0) + (e.empIdx - 100) * 0.005 + biz;
    if (ty === 'multifamily') demandDrift = 0.05 + e.popGrowth * 0.05 + (e.confidence - 55) * 0.0012;
    demandDrift += e.era?.sectorTilt?.[ty] ?? 0;   // the era's secular story: this generation's winner isn't the last one's
    if (e.phase === 'recession') demandDrift -= ((e.recSeverity ?? 1) - 1) * 0.018;   // a named recession cuts demand everywhere
    if (e.bustType === ty && (e.bustMonthsLeft ?? 0) > 0) demandDrift -= 0.055;       // the busted sector bleeds on top of it
    const eqVac = EQ_VAC[ty];
    // real vacancy in the modeled stock; the ambient metro beyond our blocks leans
    // toward equilibrium, shifted by where macro demand is pulling
    const realVac = totSF[ty] > 0 ? (1 - occSF[ty] / totSF[ty]) * 100 : eqVac;
    const macroShift = clamp(-(demandDrift - 0.04) * 25, -4, 4);
    const target = realVac * 0.6 + (eqVac + macroShift) * 0.4;
    e.cityVac[ty] = clamp(e.cityVac[ty] + (target - e.cityVac[ty]) * 0.35 + (rng(s) - 0.5) * 0.12, 2, 32);
    // rents follow the vacancy gap with MOMENTUM — a tightening market builds rent
    // growth over quarters and takes quarters to roll over, like a real one.
    // Asymmetric on purpose: markets crash faster than they recover — a landlord
    // chases a fleeing tenant with cuts overnight, but rebuilds pricing power slowly
    const gap = eqVac - e.cityVac[ty];
    const mk = gap < 0 ? 0.0016 : 0.0011, mb = gap < 0 ? 0.30 : 0.22;
    e.rentMom[ty] = e.rentMom[ty] * (1 - mb) + (gap * mk) * mb;
    // rents carry the same inflation pass-through as construction costs (costIdx above),
    // so a development pro forma means the same thing in year 25 as in year 1 —
    // the cycle moves rents around that line, not permanently below it.
    // The era's secular wind also reprices the sector directly: capital crowds into
    // this generation's darling and starves its castoff, beyond what vacancy explains.
    // Feasibility gravity: rents can't diverge from replacement cost forever. A sector
    // priced far below what new construction needs stops getting built, scarcity bites,
    // and pricing crawls back toward feasibility; rents far above cost invite the
    // construction wave that grinds them back down.
    // century-scale sector anchors, phased in with cost drift (zero at genesis, so
    // the measured 20-year era balance is untouched): industrial's structural
    // scarcity edge would otherwise win most quarter-centuries of every long game
    const K: Record<string, number> = { office: 1.12, retail: 1.05, industrial: 0.70, multifamily: 1.18, mixed: 1 };
    const kEff = 1 + ((K[ty] ?? 1) - 1) * Math.min(1, Math.max(0, (e.costIdx - 1) / 1.5));
    const feas = clamp(kEff * e.costIdx / e.rentIdx[ty] - 1, -0.8, 0.8) * 0.0045;
    // froth: a giddy peak pushes rents past what vacancy justifies — the overshoot
    // the next recession takes back with interest
    const froth = e.phase === 'peak' ? Math.max(0, e.confidence - 70) * 0.00012 : 0;
    const growth = e.rentMom[ty] + (e.inflation / 100) * 0.5 / 12 + (e.era?.sectorTilt?.[ty] ?? 0) * 0.018 + feas + froth;
    // the bounds ride the cost index: year-80 rents measure against year-80
    // replacement cost, not against a ceiling written for year one
    const anchor = Math.max(1, e.costIdx * 0.8);
    e.rentIdx[ty] = clamp(e.rentIdx[ty] * (1 + growth), 0.5 * anchor, 4.5 * anchor);
  }
  // mixed reads as the blend of what it contains — kept for display and any legacy reader
  e.cityVac.mixed = Math.round((MIX_DEFAULT.office * e.cityVac.office + MIX_DEFAULT.retail * e.cityVac.retail + MIX_DEFAULT.multifamily * e.cityVac.multifamily) * 100) / 100;
  e.rentIdx.mixed = Math.round((MIX_DEFAULT.office * e.rentIdx.office + MIX_DEFAULT.retail * e.rentIdx.retail + MIX_DEFAULT.multifamily * e.rentIdx.multifamily) * 1000) / 1000;
}
// How fast space moves right now, per sector: >1 means tenants are competing for
// scarce space, <1 means space is competing for scarce tenants.
export function leasingClimate(s: GameState, ty: PType): number {
  return clamp(1 + (EQ_VAC[ty] - s.econ.cityVac[ty]) * 0.03, 0.68, 1.35);
}

function tickStock(s: GameState) {
  if (s.month % 3 !== 0) return;
  for (const b of s.stock) {
    if (b.buildLeft) continue;  // not standing yet
    if (b.listedId) continue; // frozen while marketed — the flyer photos are already printed
    const t = s.tiles[b.tileI];
    // quality sorts winners from losers around the market level — it doesn't
    // subtract occupancy from the whole city at once
    const tOcc = targetOcc(s, t, b.type) * (0.96 + (b.quality / 150) * 0.08);
    b.occ = clamp(b.occ + (tOcc - b.occ) * 0.18 + (rng(s) - 0.5) * 0.05, 0.15, 0.97);
    b.occ = Math.round(b.occ * 100) / 100;
    // owners renovate when the market pays them to: strong blocks and tight sectors
    // keep their stock current, weak blocks let it rot — a real city's strata. A
    // building that's fallen far on a block that still matters gets the gut reno:
    // big quality jump, units offline for the duration.
    const climate = leasingClimate(s, b.type);
    let renoP = 0.03 + (t.D >= 60 ? 0.035 : 0) + (climate > 1.04 ? 0.025 : 0);
    if (climate < 0.95) renoP *= 0.5;   // nobody renovates into a glut
    let bump = 0;
    if (rng(s) < renoP) {
      if (b.quality < 50 && t.D >= 55 && climate >= 1.0) { bump = rrange(s, 28, 48); b.occ = clamp(b.occ - 0.12, 0.15, 0.97); }
      else bump = 18;
    }
    b.quality = clamp(b.quality - 1.0 + bump, 18, 138); // decay still wins wherever renovation doesn't pencil
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
  const add = (o2: { tileI: number; type: PType; mix?: MixSplit; id?: number }, sf: number, occ: number, quality: number) => {
    const tileI = o2.tileI, o = sf * occ;
    if (o2.type === 'office') jobs[tileI] += o;
    else if (o2.type === 'multifamily') res[tileI] += o;
    else if (o2.type === 'retail') amen[tileI] += o;
    else if (o2.type === 'mixed') { const m = mixOf(s, o2); jobs[tileI] += o * m.office; res[tileI] += o * m.multifamily; amen[tileI] += o * m.retail; }
    else ind[tileI] += o;
    qSum[tileI] += quality * sf; qSF[tileI] += sf;
  };
  for (const b of s.stock) if (!b.buildLeft) add(b, b.sf, b.occ, b.quality);
  for (const a of s.assets) if (a.mode !== 'construction') add(a, a.sf, a.occ, a.quality);
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
    const q = qn > 0 ? qs / qn : 75;
    const qf = 0.80 + 0.5 * (q / 150); // Class C drags a district, Class A lifts it
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
  // blight: dark storefronts and empty floors drag a block — vacancy past a healthy
  // frictional level pulls desirability down until somebody fills or razes it
  const W2 = CONFIG.GRID_W, H2 = CONFIG.GRID_H, n2 = s.tiles.length;
  const totB = new Array(n2).fill(0), occB = new Array(n2).fill(0), qB = new Array(n2).fill(0);
  for (const b of s.stock) if (!b.buildLeft) { totB[b.tileI] += b.sf; occB[b.tileI] += b.sf * b.occ; qB[b.tileI] += b.sf * b.quality; }
  for (const a of s.assets) if (a.mode !== 'construction') { totB[a.tileI] += a.sf; occB[a.tileI] += a.sf * a.occ; qB[a.tileI] += a.sf * a.quality; }
  for (const t of s.tiles) {
    if (t.water) continue;
    let totL = totB[t.i], occL = occB[t.i], qL = qB[t.i];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const x = t.x + dx, y = t.y + dy;
      if (x >= 0 && x < W2 && y >= 0 && y < H2) { const j = y * W2 + x; totL += totB[j] * 0.35; occL += occB[j] * 0.35; qL += qB[j] * 0.35; }
    }
    const vacFrac = totL > 0 ? (totL - occL) / (totL + 30_000) : 0;
    const blight = -9 * Math.max(0, vacFrac - 0.06);
    // rot: a concentration of decayed stock drags the block below its fundamentals —
    // decline has teeth, and it feeds on itself until somebody renovates or the
    // wreckers arrive. Weighted by built mass so one shack can't sink a block.
    const qLocal = totL > 0 ? qL / totL : 75;
    const rot = -7 * Math.max(0, (52 - qLocal) / 52) * Math.min(1, totL / 60_000);
    const prev = t.D;
    // momentum: a rising block overshoots its fundamentals a little; a falling one undershoots
    const target = clamp(t.baseD + mix[t.i] + blight + rot + (t.dMom ?? 0) * 2.2, 5, 98);
    t.D = clamp(t.D + (target - t.D) * 0.10, 5, 98);
    t.dMom = Math.round(clamp((t.dMom ?? 0) * 0.72 + (t.D - prev) * 0.28, -2.2, 2.2) * 1000) / 1000;
    // the demographic tide moves the anchor itself: boom decades raise every block's
    // resting population, decline decades drain it — the city genuinely grows and shrinks
    const dp = s.econ.demo?.regime === 'boom' ? 0.02 : s.econ.demo?.regime === 'decline' ? -0.015 : 0;
    if (dp) t.popBase = clamp(t.popBase + dp, 0, 100);
    const popTarget = clamp(t.popBase + RES_K * resSrc[t.i], 5, 100);
    const empTarget = clamp((t.empBase + JOB_K * jobSrc[t.i]) * (s.econ.empIdx / 100), 3, 100);
    t.pop = clamp(t.pop + (popTarget - t.pop) * 0.10, 5, 100);
    t.emp = clamp(t.emp + (empTarget - t.emp) * 0.10, 3, 100);
    t.income = clamp(t.income + ((0.55 + (t.D / 100) * 0.95) - t.income) * 0.05, 0.5, 1.75);
    t.crime = clamp(t.crime + ((68 - 0.58 * t.D) - t.crime) * 0.05, 3, 85);
  }
}

// ---------- Black swans ----------
// Once-a-generation shocks. Most careers see one or two; some see none; nobody
// sees them coming. Gated: never in the first three years, never within eight
// years of the last one — a swan is an era-defining memory, not a Tuesday.
function maybeBlackSwan(s: GameState) {
  if (s.month < 36) return;
  const last = s.swans.length ? s.swans[s.swans.length - 1].m : -999;
  if (s.month - last < 96) return;
  if (rng(s) > 0.0048) return;   // roughly one per couple of decades of eligible time
  const kind = rpick(s, ['crash', 'stagflation', 'pandemic', 'quake', 'miracle'] as const);
  const e = s.econ;
  if (kind === 'crash') {
    s.swans.push({ m: s.month, kind, label: 'The Crash' });
    e.phase = 'recession'; e.phaseAge = 0;
    e.confidence = clamp(e.confidence - 30, 10, 95);
    e.hadCrunch = true; e.crunchMonthsLeft = 18;
    e.rate = clamp(e.rate - 1.5, 2.0, 13.0);   // the cut comes after the damage
    for (const f of s.firms) if (f.alive) { f.cash -= Math.abs(f.debt) * 0.04; }   // margin calls
    for (const b of s.stock) if (!b.buildLeft && rng(s) < 0.25) b.occ = clamp(b.occ - rrange(s, 0.05, 0.18), 0.1, 0.97);
    pushNews(s, 'event', 'THE CRASH. A major lender failed overnight and the credit system seized. LTVs cut, refinancing frozen for ~18 months, tenants failing, and every leveraged balance sheet in the city is getting margin-called. Fortunes are lost this year — and the next ones are bought at the bottom.');
  } else if (kind === 'stagflation') {
    s.swans.push({ m: s.month, kind, label: 'The Great Inflation' });
    e.inflation = clamp(e.inflation + 3.5, 0, 9);
    e.tariffMonthsLeft = Math.max(e.tariffMonthsLeft, 24);
    pushNews(s, 'event', 'THE GREAT INFLATION: prices are running away — materials, wages, everything. The central bank will chase this with rates that end in double digits before it ends. Fixed-rate debt just became the best asset you own; floating debt, the worst.');
  } else if (kind === 'pandemic') {
    s.swans.push({ m: s.month, kind, label: 'The Pandemic' });
    e.wfhMonthsLeft = 36; e.ecomMonthsLeft = 30;
    e.wfhLastM = s.month; e.ecomLastM = s.month;
    e.confidence = clamp(e.confidence - 22, 10, 95);
    e.rate = clamp(e.rate - 2.0, 2.0, 13.0);
    e.popGrowth = clamp(e.popGrowth - 0.8, -1.2, 2.8);
    pushNews(s, 'event', 'PANDEMIC. The city empties overnight: offices dark for years, retail on life support, logistics running triple shifts, and money nearly free while the world holds its breath. Every lease signed this decade will remember this month.');
  } else if (kind === 'quake') {
    s.swans.push({ m: s.month, kind, label: 'The Quake' });
    e.costIdx *= 1.14;   // every contractor in the region books solid for two years
    if (e.constrCycle !== undefined) e.constrCycle = clamp(e.constrCycle * 1.1, 0.85, 1.22);
    let hit = 0;
    for (const b of s.stock) if (!b.buildLeft && rng(s) < 0.12) { b.occ = clamp(b.occ * rrange(s, 0.4, 0.75), 0.05, 0.97); b.quality = clamp(b.quality - rrange(s, 8, 20), 10, 150); hit++; }
    for (const a of s.assets) if (a.mode !== 'construction' && rng(s) < 0.25 && !a.repair) {
      a.repair = { frac: clamp(rrange(s, 0.15, 0.4), 0.05, 0.6), monthsLeft: 3 + Math.round(rng(s) * 4), what: 'quake' };
      const ded = roundPrice(Math.max(25_000, assetValue(s, a) * 0.006));
      s.cash -= ded;
      logCF(s, 'capex', `${a.name} — quake deductible`, -ded);
      a.ledger.push({ m: s.month, amt: -ded });
    }
    pushNews(s, 'event', `THE QUAKE: a magnitude the city builds codes about, not for. ~${hit} buildings damaged, contractors booked solid for two years, costs up 14% overnight. The rebuilding boom starts as soon as the dust settles — for whoever still has cash and standing crews.`);
  } else {
    s.swans.push({ m: s.month, kind, label: 'The Boom' });
    e.phase = 'expansion'; e.phaseAge = 0;
    e.empIdx = clamp(e.empIdx + 6, 80, 115);
    e.confidence = clamp(e.confidence + 20, 10, 95);
    e.capInflowMonthsLeft = 30;
    e.popGrowth = clamp(e.popGrowth + 0.8, -1.2, 2.8);
    pushNews(s, 'event', 'THE BOOM: a national champion is moving its headquarters and half its supply chain here. Jobs, people, and institutional capital are all inbound at once — cap rates compress, rents run, and everyone who owns anything looks like a genius for a while. Booms end. Enjoy this one; underwrite like it will.');
  }
}

// Each transit era draws a NEW line on the map: from wherever the city's live core
// sits today out to a fresh edge, so every generation re-prices a different corridor.
// Rolled when the previous line finishes building; announced when the next one lands.
function rollNextCorridor(s: GameState) {
  const W = CONFIG.GRID_W, H = CONFIG.GRID_H;
  let core = s.tiles[0];
  for (const t of s.tiles) if (!t.water && t.D > core.D) core = t;
  const prev = new Set(s.transitCorridor);
  for (let tries = 0; tries < 8; tries++) {
    const side = Math.floor(rng(s) * 4);
    const tx = side === 0 ? 1 : side === 1 ? W - 2 : 1 + Math.floor(rng(s) * (W - 2));
    const ty2 = side <= 1 ? 1 + Math.floor(rng(s) * (H - 2)) : (side === 2 ? 1 : H - 2);
    const steps = Math.max(1, Math.max(Math.abs(tx - core.x), Math.abs(ty2 - core.y)));
    const path: number[] = [];
    for (let s2 = 0; s2 <= steps; s2++) {
      const cx = Math.round(core.x + (tx - core.x) * (s2 / steps));
      const cy = Math.round(core.y + (ty2 - core.y) * (s2 / steps));
      const idx = cy * W + cx;
      if (!s.tiles[idx].water && !path.includes(idx)) path.push(idx);
    }
    // a new line should mostly serve blocks the last one didn't
    if (path.length >= 5 && path.filter(i => prev.has(i)).length <= path.length * 0.4) {
      s.transitCorridor = path;
      return;
    }
  }
}

function tickEvents(s: GameState) {
  maybeBlackSwan(s);
  for (const ef of [...s.effects]) {
    ef.monthsLeft--;
    for (const ti of ef.tiles) {
      const t = s.tiles[ti];
      if (ef.dPerMonth) { t.baseD = clamp(t.baseD + ef.dPerMonth, 0, 98); t.D = clamp(t.D + ef.dPerMonth, 5, 98); }
      if (ef.empPerMonth) t.emp = clamp(t.emp + ef.empPerMonth, 3, 100);
    }
    if (ef.monthsLeft <= 0) {
      s.effects = s.effects.filter(x => x !== ef);
      if (ef.kind === 'transit') {
        rollNextCorridor(s);
        pushNews(s, 'rumor', 'The transit authority\'s planners are already sketching the NEXT line — a fresh corridor study is circulating. Whoever owns along the eventual route owns the future.');
      }
    }
  }
  // infrastructure is generational policy, not luck: if no line has broken ground in
  // ~25 years, the city forces one onto the ballot
  if (s.month - (s.lastTransitM ?? 0) > 300 && !s.scheduledEvents.some(ev => ev.kind === 'transit') && !s.effects.some(e => e.kind === 'transit')) {
    pushNews(s, 'rumor', 'RUMOR: A generation without a new transit line — the bond measure is polling well. The route map leaks within the quarter.');
    s.scheduledEvents.push({ m: s.month + 3, kind: 'transit' });
    s.lastTransitM = s.month;
  }
  for (const ev of [...s.scheduledEvents]) {
    if (ev.m !== s.month) continue;
    s.scheduledEvents = s.scheduledEvents.filter(x => x !== ev);
    fireEvent(s, ev.kind, ev.payload);
  }
  // operating-asset surprises: the building calls, and it's never good news
  if (rng(s) < 0.04 && s.pending.length === 0) {
    const ops = s.assets.filter(a => a.mode !== 'construction');
    if (ops.length > 0) {
      const a = rpick(s, ops);
      // a roof and its rooftop units last 20-30 years — once it's dealt with, it's
      // dealt with for a generation. An acquired building's roof has an unknown
      // vintage, seeded per asset, so the bill lands once per hold, not once a year.
      const roofWait = 240 + ((Math.imul((s.seed ^ (a.id * 37)) >>> 0, 0x9E3779B9) >>> 21) % 121);   // 20-30 years
      const lastRoof = a.roofM ?? (a.acqMonth - ((Math.imul((s.seed ^ (a.id * 53)) >>> 0, 0x9E3779B9) >>> 22) % 180));
      const roofEligible = a.age >= 20 && s.month - lastRoof >= roofWait;
      const hasAnchor = !isAggregate(a.type) && a.tenants.length > 0;
      const pool: string[] = ['reassess', 'reassess'];
      if (roofEligible) pool.push('roof');
      if (hasAnchor && rng(s) < 0.5) pool.push('tiDemand');
      const kind2 = rpick(s, pool);
      // the assessor doesn't call every time the dice say so — reassessments were landing twice as often as they should
      const skipReassess = kind2 === 'reassess' && rng(s) < 0.5;
      if (!skipReassess) {
        const pd: PendingDecision = { type: 'assetEvent', assetId: a.id, eventKind: kind2 };
        if (kind2 === 'tiDemand') {
          const tn = [...a.tenants].sort((x, y) => y.sf - x.sf)[0];
          if (tn) pd.data = { ti: Math.round(tn.sf * rrange(s, 9, 15) / 1000) * 1000, bumpPct: Math.round(rrange(s, 3, 6)), extendMo: Math.round(rrange(s, 60, 90)), tenantName: tn.name };
        }
        if (kind2 === 'reassess') {
          const base = assetValue(s, a) * 0.006;
          pd.data = { hikeLo: Math.round(base * 0.7 / 1000) * 1000, hikeHi: Math.round(base * 1.4 / 1000) * 1000 };
        }
        s.pending.push(pd);
      }
    }
  }
  if (rng(s) < 0.16) {
    const pool = ['transit', 'employer', 'employerExit', 'tariff', 'ecom', 'rateshock', 'insSpike', 'capInflow', 'wfh'];
    const kind = rpick(s, pool);
    if (kind === 'transit' && (s.effects.some(e => e.kind === 'transit') || s.month - (s.lastTransitM ?? -999) < 120)) return;   // one line per decade, at most
    if (kind === 'employerExit' && (s.month < 60 || s.effects.some(e => e.kind === 'employerExit'))) return;
    if (kind === 'tariff' && s.econ.tariffMonthsLeft > 0) return;
    // structural waves are once-a-decade episodes, not recurring weather — a wave that
    // just ended can't immediately re-form
    if (kind === 'ecom' && (s.econ.ecomMonthsLeft > 0 || s.month - (s.econ.ecomLastM ?? -999) < 72)) return;
    if (kind === 'insSpike' && (s.econ.insSpikeMonthsLeft ?? 0) > 0) return;
    if (kind === 'capInflow' && (s.econ.capInflowMonthsLeft ?? 0) > 0) return;
    if (kind === 'wfh' && ((s.econ.wfhMonthsLeft ?? 0) > 0 || (s.econ.rtoMonthsLeft ?? 0) > 0 || s.month - (s.econ.wfhLastM ?? -999) < 84)) return;
    const lead = 2 + Math.floor(rng(s) * 3);
    let payload: number | undefined;
    const rumors: Record<string, string> = {
      transit: 'RUMOR: The transit authority is quietly surveying a new rapid line out of the core. Land along the route would re-price.',
      employer: 'RUMOR: A large employer is scouting Meridian City for a regional campus. Wherever it lands, office demand follows.',
      employerExit: 'RUMOR: One of the city\'s largest employers is said to be shopping other metros. The brokers who lease to them are pretending not to worry.',
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
    if (kind === 'employerExit') {
      const cands = s.tiles.filter(t => !t.water && t.emp > 55);
      if (!cands.length) return;
      payload = rpick(s, cands).i;
    }
    pushNews(s, 'rumor', rumors[kind]);
    s.scheduledEvents.push({ m: s.month + lead, kind, payload });
  }
}

function fireEvent(s: GameState, kind: string, payload?: number) {
  if (kind === 'transit') {
    s.lastTransitM = s.month;
    s.effects.push({ kind: 'transit', monthsLeft: 14, tiles: [...s.transitCorridor], dPerMonth: 0.9 });
    // the city upzones its own corridor — transit-oriented development is policy, not luck
    let upzoned = 0;
    for (const ti of s.transitCorridor) {
      const t = s.tiles[ti];
      if (t.water) continue;
      const before = zoneCode(t.zone);
      if (t.zone.use === 'R') t.zone = { use: 'MU', tier: t.zone.tier };
      if (t.zone.tier < 2) t.zone = { use: t.zone.use, tier: 2 };
      if (zoneCode(t.zone) !== before) upzoned++;
    }
    pushNews(s, 'event', `TRANSIT LINE APPROVED: a new rapid line will run through the highlighted corridor. Desirability along the route will climb for the next year${upzoned ? `, and the city upzoned ${upzoned} block${upzoned > 1 ? 's' : ''} along it — transit-oriented development is now as-of-right` : ''}.`);
  } else if (kind === 'employer') {
    const ti = payload ?? rpick(s, s.tiles.filter(t => !t.water)).i;
    const t = s.tiles[ti];
    const area = s.tiles.filter(x => !x.water && Math.abs(x.x - t.x) <= 1 && Math.abs(x.y - t.y) <= 1).map(x => x.i);
    s.effects.push({ kind: 'employer', monthsLeft: 10, tiles: area, empPerMonth: 1.4, dPerMonth: 0.4 });
    pushNews(s, 'event', 'MAJOR EMPLOYER ARRIVES: a regional campus is coming to the city grid — office and mixed-use demand near the site will strengthen.');
  } else if (kind === 'employerExit') {
    const ti = payload ?? rpick(s, s.tiles.filter(t => !t.water && t.emp > 40)).i;
    const t = s.tiles[ti];
    const area = s.tiles.filter(x => !x.water && Math.abs(x.x - t.x) <= 1 && Math.abs(x.y - t.y) <= 1).map(x => x.i);
    s.effects.push({ kind: 'employerExit', monthsLeft: 10, tiles: area, empPerMonth: -1.5, dPerMonth: -0.45 });
    pushNews(s, 'event', `MAJOR EMPLOYER DEPARTS: the campus near block ${blockLabel(t)} goes dark over the next year. The lunch crowd disappears first, then the leases — the blocks around it will wear this for a decade.`, ti);
  } else if (kind === 'tariff') {
    s.econ.tariffMonthsLeft = 18;
    pushNews(s, 'event', 'MATERIAL TARIFFS: hard construction costs up ~8% for the next 18 months. Projects already underway feel it too.');
  } else if (kind === 'ecom') {
    s.econ.ecomMonthsLeft = 18;
    s.econ.ecomLastM = s.month;
    pushNews(s, 'event', 'E-COMMERCE SQUEEZE: retail demand softens citywide for the next year and a half; industrial and logistics demand strengthens.');
  } else if (kind === 'insSpike') {
    s.econ.insSpikeMonthsLeft = 18;
    pushNews(s, 'event', 'INSURANCE CRISIS: carriers reprice the whole market. Property insurance runs ~45% higher for the next 18 months — a static cost you can\'t occupancy your way out of.');
  } else if (kind === 'capInflow') {
    s.econ.capInflowMonthsLeft = 15;
    pushNews(s, 'event', 'CAPITAL INFLOW: institutional money floods Meridian City. Cap rates compress ~35 bps citywide for about a year — sellers rejoice, buyers grind their teeth.');
  } else if (kind === 'wfh') {
    s.econ.wfhMonthsLeft = 15;
    s.econ.wfhLastM = s.month;
    pushNews(s, 'event', 'REMOTE-WORK WAVE: major employers cut their footprints. Office demand weakens citywide for the next year or so — and when it breaks, the return-to-office rush follows.');
  } else if (kind === 'roofBill') {
    const a = s.assets.find(x => x.id === payload);
    if (a && a.age >= 20) {
      const bill = Math.round(a.sf * rrange(s, 4.5, 7) * s.econ.costIdx / 1000) * 1000;
      s.cash -= bill; logCF(s, 'capex', `${a.name} — emergency roof replacement`, -bill); a.ledger.push({ m: s.month, amt: -bill });
      a.roofM = s.month;   // an emergency replacement is still a replacement
      a.quality = clamp(a.quality - 6, 1, a.qCap);
      pushNews(s, 'warn', `${a.name}: the patched roof failed in a storm — emergency replacement, ${fmtMoney(bill)}. The cheap fix sends its regards.`);
    }
  } else if (kind === 'rateshock') {
    const up = rng(s) < 0.6;
    s.econ.rate = clamp(s.econ.rate + (up ? rrange(s, 1.5, 2.5) : -rrange(s, 1.2, 2.0)), 2.0, 13.0);
    pushNews(s, 'event', up ? 'RATE SHOCK: the base rate jumps 150 bps. New debt is pricier and cap rates will drift up — values down.' : 'SURPRISE CUT: the base rate drops 150 bps. Financing is cheap; cap rates will compress — values up.');
  }
}

function tickListings(s: GameState) {
  for (const l of s.listings) {
    if (l.underContract) {
      const uc = l.underContract;
      if (uc.studyOrdered && !uc.known && uc.resultM !== undefined && s.month >= uc.resultM) {
        const cells = l.parcelCells ?? (l.parcel ? cellsOfRect(l.parcel.px, l.parcel.py, l.parcel.pw, l.parcel.ph) : []);
        uc.known = landSiteCondition(s, l.tileI, cells, l.price);
        pushNews(s, uc.known.kind === 'none' ? 'success' : 'warn',
          uc.known.kind === 'none'
            ? `Study back on block ${blockLabel(s.tiles[l.tileI])}: CLEAN. Close with confidence — the window runs to ${monthName(l.expiresMonth)}.`
            : `Study back on block ${blockLabel(s.tiles[l.tileI])}: ${SITE_COND_LABEL[uc.known.kind]}. ${uc.known.sfLossFrac ? `Buildable area cut ~${Math.round(uc.known.sfLossFrac * 100)}%` : 'Remediation ~' + fmtMoney(uc.known.cost)}. Close eyes-open, or walk for the deposit.`, l.tileI);
      }
      if (l.expiresMonth <= s.month) {
        pushNews(s, 'warn', `Your contract on the ${l.acres} acres at block ${blockLabel(s.tiles[l.tileI])} EXPIRED unclosed. The seller keeps ${fmtMoney(uc.deposit)}${(l as any).omLead ? ' and goes back to not selling' : ' and relists'}.`, l.tileI);
        if ((l as any).omLead) {
          for (const c of l.parcelCells ?? []) s.parcelApproach[l.tileI + ':' + c] = { m: s.month, outcome: 'refused' };
          s.listings = s.listings.filter(x => x.id !== l.id);
        } else {
          l.underContract = undefined;
          l.expiresMonth = s.month + 5;
        }
      }
      continue;   // parcels under contract don't expire, get bid on, or sell to firms
    }
    if (l.expiresMonth <= s.month) {
      if (l.stockId) {
        const b = s.stock.find(x => x.id === l.stockId);
        if (b) b.listedId = undefined;
      }
      if (l.agreed && !l.yourSale) {
        if ((l as any).rivalBid) {
          const rivalFirm = s.firms.find(f => f.name === (l as any).rivalName);
          if (l.kind === 'land') {
            if (rivalFirm) firmTakesLand(s, rivalFirm, l);
          } else {
            const b2 = l.stockId ? s.stock.find(x => x.id === l.stockId) : undefined;
            if (b2) { b2.owner = rivalFirm?.short ?? b2.owner; b2.listedId = undefined; }
            logComp(s, { m: s.month, type: l.type!, sf: l.sf ?? 0, price: (l as any).rivalBid, capPct: null, tileI: l.tileI, buyer: (l as any).rivalName ?? 'A rival' });
          }
          pushNews(s, 'warn', `You lost the bidding war: ${(l as any).rivalName} closed at ${fmtMoney((l as any).rivalBid)}. Second place in real estate is a story you tell at bars.`);
          {
            const rf = s.firms.find(f2 => f2.name === (l as any).rivalName);
            if (rf) bumpRivalry(s, rf, null);   // the loss line above already told the story; just keep score
          }
        } else {
          s.reputation = clamp(s.reputation - 2, 0, 100);
          pushNews(s, 'warn', 'A seller you had under agreement watched you fail to close. That story travels faster than your good ones.');
        }
      }
    } else if (l.agreed && !l.yourSale && l.kind !== 'offmarket' && !(l as any).rivalBid && !l.parentAssetId && !l.fromLandId && rng(s) < (l.kind === 'land' ? 0.11 : 0.14)) {
      // someone saw the flyer come down and decided they want it more
      const rival = rpick(s, s.firms.filter(f => f.alive));
      (l as any).rivalBid = roundPrice(l.price * rrange(s, 1.03, 1.09));
      (l as any).rivalName = rival.name;
      l.expiresMonth = Math.min(l.expiresMonth, s.month + 1);
      pushNews(s, 'event', l.kind === 'land'
        ? `BIDDING WAR: ${rival.name} just offered ${fmtMoney((l as any).rivalBid)} on the ${l.acres}-acre parcel you have under agreement. Land you hesitate on is land somebody else assembles.`
        : `BIDDING WAR: ${rival.name} just offered ${fmtMoney((l as any).rivalBid)} on the ${((l.sf ?? 0) / 1000).toFixed(0)}K SF ${PLABEL[l.type!]} you have under agreement. Match it this month or the seller walks to them.`, l.tileI);
    } else if (l.kind === 'building' && !l.agreed && (l.listMonth ?? s.month) <= s.month - 3 && rng(s) < 0.2) {
      // fatigue: the longer it sits, the softer the seller
      l.price = roundPrice(l.price * rrange(s, 0.965, 0.99));
      if (rng(s) < 0.25) pushNews(s, 'info', `Price reduced on the ${((l.sf ?? 0) / 1000).toFixed(0)}K SF ${PLABEL[l.type!]} listing — the seller is getting realistic.`);
    }
  }
  s.listings = s.listings.filter(l => l.expiresMonth > s.month);
  const pStarter = s.econ.phase === 'recovery' ? 0.35 : s.econ.phase === 'expansion' ? 0.15 : 0.06;
  while (s.listings.filter(l => l.kind !== 'offmarket' && !(l as any).omLead).length < 12 && rng(s) < 0.8) spawnListing(s, rng(s) < pStarter);
  // with unlisted dirt hard to pry loose, listed land is the pressure valve — keep some on the board
  let guardLand = 0;
  while (s.listings.filter(l => l.kind === 'land' && !(l as any).omLead && !l.parentAssetId && !l.yourSale).length < 3 && guardLand++ < 5) spawnLandListing(s);
  for (const l of s.listings) {
    if (l.kind === 'building' && rng(s) < 0.15) l.price = Math.round(l.price * (0.99 + rng(s) * 0.02));
  }
}

// Rivals don't just shop the board — they put shovels in the ground.
function firmDevelops(s: GameState, f: Firm) {
  const want: PType = f.style === 'industrial' ? 'industrial' : f.style === 'mf' ? 'multifamily'
    : f.style === 'core' ? (rng(s) < 0.5 ? 'office' : 'retail')
      : f.style === 'value-add' ? 'retail' : rpick(s, PTYPES);
  const cands = s.tiles.filter(t => !t.water && zoneAllows(t.zone, want) && freeParcelCount(s, t.i) >= 3 && tileDemandFactor(s, t, want) > 1.02
    && oversupplyPenalty(t, want) < 0.06);
  if (!cands.length) return;
  // growth radiates: firms favor central dirt while it lasts, and only chase the
  // frontier once demand out there actually clears the bar
  const siteScore = (t2: Tile) => tileDemandFactor(s, t2, want) * (0.55 + 0.009 * t2.D);
  cands.sort((a, b) => siteScore(b) - siteScore(a));
  const t = rpick(s, cands.slice(0, 8));
  const need = Math.max(constrForQuality(want, 100).minCells ?? 1, 3 + Math.floor(rng(s) * 5));
  const spot = findFreeRect(s, t.i, need, () => rng(s));
  if (!spot) return;
  const acres = spot.pw * spot.ph * PARCEL_AC;
  const sf = Math.round(acres * 43_560 * FAR[want] * zoneTierMult(t.zone.tier) * rrange(s, 0.6, 0.95) / 1000) * 1000;
  if (sf < 6000) return;
  const months = Math.min(26, Math.max(6, Math.round(4 + sf / 7000)));
  const quality = clamp(rrange(s, 78, 132), 45, 138);
  const cost = sf * constrForQuality(want, quality).cost * constrCostIdx(s) * 1.3;
  if (f.cash < cost * 0.35 + 1_000_000) return;   // same math you face: equity in, loan for the rest
  f.cash -= cost * 0.35;
  f.debt += cost * 0.65;
  s.stock.push({
    id: s.nextId++, tileI: t.i, type: want, sf,
    px: spot.px, py: spot.py, pw: spot.pw, ph: spot.ph,
    units: genUnitsFor(s, want, sf), quality, age: 0,
    construction: constrForQuality(want, quality).id,
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

function firmTakesLand(s: GameState, f: Firm, l: Listing) {
  const t = s.tiles[l.tileI];
  if (f.cash < l.price + 500_000) return;   // dirt is a cash purchase
  f.cash -= l.price;
  const pref: PType[] = t.indSuit > 55 ? ['industrial'] : f.style === 'core' ? ['office', 'mixed'] : rng(s) < 0.5 ? ['retail', 'mixed'] : ['mixed', 'retail'];
  const ty = pref.find(x => zoneAllows(t.zone, x)) ?? ZONE_ALLOWS[t.zone.use][0];
  const cells = l.parcelCells ?? (l.parcel ? footprintCells(l.parcel) : null);
  const acres = l.acres ?? (cells ? cells.length * PARCEL_AC : 1);
  const sf = Math.round(acres * 43_560 * FAR[ty] * zoneTierMult(t.zone.tier) * rrange(s, 0.55, 0.9) / 1000) * 1000;
  if (cells && cells.length && sf >= 4000) {
    const months = Math.min(26, Math.max(6, Math.round(4 + sf / 7000)));
    const quality = clamp(rrange(s, 68, 128), 45, 138);
    s.stock.push({
      id: s.nextId++, tileI: l.tileI, type: ty, sf, cells: [...cells],
      units: genUnitsFor(s, ty, sf), quality, age: 0,
      construction: constrForQuality(ty, quality).id,
      occ: 0, owner: f.short, buildLeft: months, buildTotal: months, builder: f.short,
    });
    pushNews(s, 'deal', `${f.name} took the ${l.acres}-acre parcel — ${(sf / 1000).toFixed(0)}K SF of ${PLABEL[ty].toLowerCase()} breaks ground there this month.`, l.tileI);
  } else if (cells && cells.length) {
    // no build pencils today — the dirt joins the firm's land bank, visible on the map
    const entry = s.firmLand.find(x => x.short === f.short && x.tileI === l.tileI);
    if (entry) { entry.cells.push(...cells); entry.cells.sort((a, b) => a - b); }
    else s.firmLand.push({ short: f.short, tileI: l.tileI, cells: [...cells], m: s.month });
    pushNews(s, 'deal', `${f.name} took the ${l.acres}-acre parcel. For now they're sitting on the dirt.`, l.tileI);
  } else {
    pushNews(s, 'deal', `${f.name} took the ${l.acres}-acre parcel. For now they're sitting on the dirt.`, l.tileI);
  }
}

// Firms assemble like you do. Watch a rival stack parcels on a block and you know
// exactly what's coming — unless you buy the connecting lot first.
function tickFirmLand(s: GameState) {
  // acquire: a firm cold-calls one vacant parcel on a block that fits its book
  for (const f of s.firms) {
    if (!f.alive || f.cash < 1_200_000 || rng(s) > 0.05) continue;
    const want: PType = f.style === 'industrial' ? 'industrial' : f.style === 'mf' ? 'multifamily' : f.style === 'core' ? 'office' : rng(s) < 0.5 ? 'retail' : 'mixed';
    // firms hunt their own thesis, not your footsteps: blocks where YOU hold dirt are off
    // their cold-call list — collisions happen on the open market, not by shadowing you
    const yourBlocks = new Set(s.land.map(h => h.tileI));
    const cands = s.tiles.filter(t => !t.water && !yourBlocks.has(t.i) && zoneAllows(t.zone, want) && freeParcelCount(s, t.i) >= 2 && tileDemandFactor(s, t, want) > 1.0);
    if (!cands.length) continue;
    // prefer blocks where they already hold dirt — assemblies want to finish
    const held = s.firmLand.filter(x => x.short === f.short && !yourBlocks.has(x.tileI));
    const t = held.length && rng(s) < 0.7 ? s.tiles[rpick(s, held).tileI] : rpick(s, cands);
    if (t.water || yourBlocks.has(t.i) || freeParcelCount(s, t.i) < 1) continue;
    const g = parcelGrid(s, t.i);
    const free: number[] = [];
    for (let c = 0; c < PGRID * PGRID; c++) if (g[c] === null) free.push(c);
    if (!free.length) continue;
    // an assembler buys the lot NEXT to their dirt, not a random one across the block
    const mine = s.firmLand.find(x => x.short === f.short && x.tileI === t.i)?.cells ?? [];
    const adj = free.filter(c => mine.some(h => {
      const cx = c % PGRID, cy = Math.floor(c / PGRID), hx = h % PGRID, hy = Math.floor(h / PGRID);
      return Math.abs(cx - hx) + Math.abs(cy - hy) === 1;
    }));
    const cell = adj.length ? rpick(s, adj) : rpick(s, free);
    const d = parcelDisposition(s, t.i, cell);
    if (d.kind === 'refuse') continue;
    const ask = roundPrice(PARCEL_AC * landPricePerAcre(s, t) * holdoutMult(s, t.i, 1) * d.mult);
    if (f.cash < ask + 600_000) continue;
    f.cash -= ask;
    const entry = s.firmLand.find(x => x.short === f.short && x.tileI === t.i);
    if (entry) { entry.cells.push(cell); entry.cells.sort((a, b) => a - b); }
    else s.firmLand.push({ short: f.short, tileI: t.i, cells: [cell], m: s.month });
    if ((entry?.cells.length ?? 1) >= 2) pushNews(s, 'rumor', `${f.name} quietly picked up another quarter-acre at block ${blockLabel(t)} — that's ${entry?.cells.length ?? 1} now. Somebody's assembling.`, t.i);
  }
  // resolve: build when contiguous mass exists; give up when it's gone stale
  for (const e of [...s.firmLand]) {
    const f = s.firms.find(x => x.short === e.short);
    const t = s.tiles[e.tileI];
    if (!f?.alive) {
      s.firmLand = s.firmLand.filter(x => x !== e);
      s.listings.push({ id: s.nextId++, tileI: e.tileI, kind: 'land', acres: Math.round(e.cells.length * PARCEL_AC * 100) / 100, parcelCells: [...e.cells], price: roundPrice(e.cells.length * PARCEL_AC * landPricePerAcre(s, t) * 0.85), resFrac: rrange(s, 0.85, 0.95), listMonth: s.month, offersLeft: 3, expiresMonth: s.month + 6, hot: true });
      continue;
    }
    // largest contiguous piece of the assembly — the first-bought lot isn't always in it
    const rem = new Set(e.cells);
    const groups: number[][] = [];
    while (rem.size) {
      const start = rem.values().next().value as number;
      const grp = connectedGroup([...rem], start);
      for (const c of grp) rem.delete(c);
      groups.push(grp);
    }
    groups.sort((a, b) => b.length - a.length);
    const main = groups[0] ?? [];
    const ready = main.length >= 2 && (main.length >= 4 || rng(s) < 0.22);   // spec minCells re-checked below
    if (ready) {
      const pref: PType[] = t.indSuit > 55 ? ['industrial'] : f.style === 'mf' ? ['multifamily', 'mixed'] : f.style === 'core' ? ['office', 'mixed'] : rng(s) < 0.5 ? ['retail', 'mixed'] : ['mixed', 'retail'];
      const ty = pref.find(x => zoneAllows(t.zone, x)) ?? ZONE_ALLOWS[t.zone.use][0];
      const sf = Math.round(main.length * PARCEL_AC * 43_560 * FAR[ty] * zoneTierMult(t.zone.tier) * upzoneBonus(main.length) * rrange(s, 0.7, 0.95) / 500) * 500;
      const quality = clamp(rrange(s, 75, 132), 45, 138);
      const spec2 = constrForQuality(ty, quality);
      const cost = sf * spec2.cost * constrCostIdx(s) * 1.3;
      if (sf >= MIN_BUILD_SF && main.length >= (spec2.minCells ?? 1) && f.cash >= cost * 0.35 + 1_000_000) {
        const months = Math.min(26, Math.max(6, Math.round(4 + sf / 7000)));
        f.cash -= cost * 0.35;
        f.debt += cost * 0.65;
        s.stock.push({
          id: s.nextId++, tileI: e.tileI, type: ty, sf, cells: [...main],
          units: genUnitsFor(s, ty, sf), quality, age: 0,
          construction: constrForQuality(ty, quality).id,
          occ: 0, owner: f.short, buildLeft: months, buildTotal: months, builder: f.short,
        });
        e.cells = e.cells.filter(c => !main.includes(c));
        if (!e.cells.length) s.firmLand = s.firmLand.filter(x => x !== e);
        pushNews(s, 'event', `${f.name}'s assembly at block ${blockLabel(t)} is done waiting: ${(sf / 1000).toFixed(0)}K SF of ${PLABEL[ty].toLowerCase()} breaks ground on ${main.length} parcels.`, e.tileI);
        continue;
      }
    }
    // a finished assembly on cheap paper is worth more upzoned — firms play that game too
    if (e.cells.length >= 2 && t.zone.tier < 3 && !s.rezonings.some(r => r.tileI === e.tileI)
      && (s.rezoneDenied[e.tileI] === undefined || s.month - s.rezoneDenied[e.tileI] >= 24) && rng(s) < 0.18) {
      const cost2 = rezoneCost(s, e.tileI, t.zone.use, (t.zone.tier + 1) as 1 | 2 | 3);
      if (f.cash > cost2 + 1_500_000) {
        f.cash -= cost2;
        const months2 = 5 + Math.round(rng(s) * 4);
        s.rezonings.push({ id: s.nextId++, tileI: e.tileI, toUse: t.zone.use, toTier: (t.zone.tier + 1) as 1 | 2 | 3, decideM: s.month + months2, cost: cost2, by: f.short });
        pushNews(s, 'rumor', `${f.name} filed to upzone block ${blockLabel(t)} to ${t.zone.use}-${t.zone.tier + 1}. If it passes, every acre on that block reprices — including anything you hold there.`, e.tileI);
      }
    }
    if (s.month - e.m > 36 && rng(s) < 0.2) {
      s.firmLand = s.firmLand.filter(x => x !== e);
      s.listings.push({ id: s.nextId++, tileI: e.tileI, kind: 'land', acres: Math.round(e.cells.length * PARCEL_AC * 100) / 100, parcelCells: [...e.cells], price: roundPrice(e.cells.length * PARCEL_AC * landPricePerAcre(s, t) * 0.92), resFrac: rrange(s, 0.86, 0.95), listMonth: s.month, offersLeft: 3, expiresMonth: s.month + 6, hot: false });
      pushNews(s, 'deal', `${f.name} gave up on its assembly at block ${blockLabel(t)} — the dirt hits the market. Somebody's holdout won.`, e.tileI);
    }
  }
  // snipe: your un-agreed off-market leads are not a secret forever
  for (const l of [...s.listings]) {
    if (!(l as any).omLead || l.agreed || l.underContract || rng(s) > 0.04) continue;
    const f = rpick(s, s.firms.filter(x => x.alive && x.cash > l.price + 800_000));
    if (!f) continue;
    const t = s.tiles[l.tileI];
    f.cash -= l.price;
    const cells = l.parcelCells ?? [];
    const entry = s.firmLand.find(x => x.short === f.short && x.tileI === l.tileI);
    if (entry) entry.cells.push(...cells); else s.firmLand.push({ short: f.short, tileI: l.tileI, cells: [...cells], m: s.month });
    for (const c of cells) s.parcelApproach[l.tileI + ':' + c] = { m: s.month, outcome: 'refused' };
    s.listings = s.listings.filter(x => x.id !== l.id);
    pushNews(s, 'warn', `${f.name} closed on the quarter-acre at block ${blockLabel(t)} you had a number on. Your lead, their dirt — known asks don't keep.`, l.tileI);
  }
}

// Quick mark on a standing building — the number a broker would put on the flyer,
// cheap enough to run across the whole city every quarter.
export function stockNOIYr(s: GameState, b: StockBuilding): number {
  const t = s.tiles[b.tileI];
  const aq = clamp(b.quality + (t.D - 55) * 0.12, 1, 150);
  const rent = marketRentPSF(s, t, b.type) * (0.87 + (aq / 150) * 0.25);
  // retail overage is income; the flyer number carries it like everyone's does now
  const over = b.type === 'retail' ? expectedRetailOveragePSFYr(s, b.tileI, b.quality) * b.sf * Math.min(b.occ, 0.97) : 0;
  return b.sf * rent * Math.min(b.occ, 0.97) * NOI_MARGIN[b.type] + over;
}
export function stockValue(s: GameState, b: StockBuilding): number {
  const t = s.tiles[b.tileI];
  const cap = capRatePct(s, t, b.type, b.quality) / 100;
  const disc = b.buildLeft ? 0.6 : 1;   // under construction: mostly cost, not yet income
  return Math.max(0, stockNOIYr(s, { ...b, occ: b.buildLeft ? 0.85 : b.occ }) / cap) * disc;
}
export function firmPortfolioValue(s: GameState, short: string): number {
  let v = 0;
  for (const b of s.stock) if (b.owner === short) v += stockValue(s, b);
  return v;
}
export function firmLandBankValue(s: GameState, short: string): number {
  let v = 0;
  for (const e of s.firmLand) if (e.short === short) v += e.cells.length * PARCEL_AC * landPricePerAcre(s, s.tiles[e.tileI]);
  return v;
}
export function firmNetWorth(s: GameState, f: Firm): number {
  return Math.round(f.cash + firmPortfolioValue(s, f.short) + firmLandBankValue(s, f.short) - f.debt);
}

// The score you didn't ask anyone to keep: every deal a firm takes off your desk.
export function bumpRivalry(s: GameState, f: Firm, what: string | null) {
  const r = (s.rivalry ??= {});
  const n = (r[f.short] = (r[f.short] ?? 0) + 1);
  if (what === null) return;   // caller already narrated the loss
  const sting = n === 1 ? 'First blood.'
    : n === 2 ? 'That\'s twice now.'
      : n === 3 ? 'Three times. This is personal.'
        : `That's ${n} deals they've taken off your desk.`;
  pushNews(s, 'warn', `⚔ ${f.name} CLOSED on ${what} — the deal you were working. ${sting}`);
}

// A collapsed firm's endgame: with a real portfolio, the lender's special-situations
// desk offers YOU the whole book at one price before breaking it up.
function collapseFirm(s: GameState, f: Firm) {
  f.alive = false;
  const held = s.stock.filter(x => x.owner === f.short && !x.listedId && !x.buildLeft)
    .sort((x, y) => stockValue(s, y) - stockValue(s, x));
  const totVal = held.reduce((x, b) => x + stockValue(s, b), 0);
  if (held.length >= 4 && totVal > 4_000_000 && !s.bulkDeal) {
    const price = roundPrice(totVal * rrange(s, 0.78, 0.86));
    s.bulkDeal = { short: f.short, name: f.name, stockIds: held.map(b => b.id), price, expiresM: s.month + 2 };
    pushNews(s, 'event', `${f.name} HAS COLLAPSED — and the lender wants ONE closing, not ${held.length}. The whole book — ${held.length} buildings, ${(held.reduce((x, b) => x + b.sf, 0) / 1000).toFixed(0)}K SF — is yours for ${fmtMoney(price)} (${Math.round(price / totVal * 100)}% of the marks) until ${monthName(s.month + 2)}. After that they break it up. The marketplace has the paper.`);
    return;
  }
  pushNews(s, 'event', `${f.name} HAS COLLAPSED — the books finally told the truth. The lender is clearing its real buildings: the best one goes to the courthouse steps, the rest hit the market priced to leave.`);
  if (held[0]) startAuction(s, held[0], `${f.name} collapsed`);
  for (const b of held.slice(1, 3)) {
    b.occ = Math.min(b.occ, clamp(b.occ * rrange(s, 0.7, 0.9), 0.3, 0.62));
    listStockBuilding(s, b, { distressed: true, priceMult: rrange(s, 0.66, 0.78), hot: true, expiresMonth: s.month + 4 });
  }
}

// The bulk window closes: either a rival takes the whole book, or it breaks up.
function tickBulkDeal(s: GameState) {
  const bd = s.bulkDeal;
  if (!bd || bd.expiresM > s.month) return;
  s.bulkDeal = undefined;
  const held = bd.stockIds.map(id => s.stock.find(b => b.id === id)).filter((b): b is StockBuilding => !!b && b.owner === bd.short);
  const rich = s.firms.filter(f2 => f2.alive && f2.cash > bd.price * 0.3);
  if (held.length && rich.length && rng(s) < 0.4) {
    const f2 = rpick(s, rich);
    f2.cash -= bd.price * 0.35; f2.debt += bd.price * 0.65;
    for (const b of held) b.owner = f2.short;
    pushNews(s, 'deal', `${f2.name} took the ${bd.name} book — all ${held.length} buildings, one wire, ${fmtMoney(bd.price)}. You watched the discount walk out the door.`);
    return;
  }
  pushNews(s, 'info', `The ${bd.name} bulk window closed unclaimed — the lender breaks the book up the slow way.`);
  const sorted = held.filter(b => b.listedId === undefined).sort((x, y) => stockValue(s, y) - stockValue(s, x));
  if (sorted[0]) startAuction(s, sorted[0], `${bd.name}'s book broke up`);
  for (const b of sorted.slice(1, 4)) {
    listStockBuilding(s, b, { distressed: true, priceMult: rrange(s, 0.7, 0.8), hot: true, expiresMonth: s.month + 4 });
  }
}

// Buy the whole book: every building in a collapsed firm's portfolio, one closing.
export function acceptBulkDeal(state: GameState, hardMoney: boolean): { s: GameState; err?: string } {
  const s = clone(state);
  const bd = s.bulkDeal;
  if (!bd) return { s, err: 'The window closed.' };
  const held = bd.stockIds.map(id => s.stock.find(b => b.id === id)).filter((b): b is StockBuilding => !!b && b.owner === bd.short);
  if (!held.length) { s.bulkDeal = undefined; return { s, err: 'Nothing left in the book.' }; }
  const costs = 25_000 + held.length * 5_000;
  const rate = s.econ.rate + 4.25;
  const loanAmt = hardMoney ? Math.round(bd.price * 0.55) : 0;
  const cashDue = bd.price - loanAmt + costs;
  if (s.cash < cashDue) return { s, err: `The wire is ${fmtMoney(cashDue)}${hardMoney ? ' with the bridge' : ' all cash'} — you're short.` };
  s.cash -= cashDue;
  logCF(s, 'buy', `Bulk purchase — the ${bd.name} book (${held.length} buildings)`, -cashDue);
  const totVal = held.reduce((x, b) => x + stockValue(s, b), 0);
  for (const b of held) {
    const share = totVal > 0 ? stockValue(s, b) / totVal : 1 / held.length;
    const basis = Math.round((bd.price + costs) * share);
    const loanShare = Math.round(loanAmt * share);
    const t = s.tiles[b.tileI];
    const a: Asset = {
      id: s.nextId++, name: nameFor(s, b.type), tileI: b.tileI, type: b.type,
      sf: b.sf, acres: Math.round((b.sf / FAR[b.type] / 43560) * 100) / 100,
      px: b.px, py: b.py, pw: b.pw, ph: b.ph, cells: b.cells ? [...b.cells] : undefined,
      units: b.units, construction: b.construction,
      mix: b.type === 'mixed' ? mixOf(s, b) : undefined,
      quality: b.quality, qCap: constrSpec({ type: b.type, construction: b.construction }).qCap,
      age: b.age, mode: 'operating',
      tenants: genRentRoll(s, { tileI: b.tileI, type: b.type, sf: b.sf, units: b.units, quality: b.quality, construction: b.construction, mix: b.type === 'mixed' ? mixOf(s, b) : undefined, id: b.id, cells: b.cells, px: b.px, py: b.py, pw: b.pw, ph: b.ph }, b.occ), occ: 0,
      rentStance: 0, maint: 'std',
      loans: loanShare > 0 ? [{ id: s.nextId++, kind: 'acq', balance: loanShare, ratePct: rate, amortYears: 25, ioMonthsLeft: 24, monthlyPmt: monthlyPayment(loanShare, rate, 25), maturityMonth: s.month + 24, lenderId: 'ibx' }] : [],
      ledger: [{ m: s.month, amt: -(basis - loanShare) }], cumCF: 0,
      basis, acqMonth: s.month,
      entryNOI: 0, entryCap: capRatePct(s, t, b.type, b.quality),
      negCFStreak: 0,
    };
    if (isAggregate(a.type)) a.occ = b.occ; else recalcOcc(a);
    a.entryNOI = assetNOIMonthly(s, a) * 12;
    a.deprBasis = Math.round(basis * 0.80); a.deprTaken = 0;
    s.assets.push(a);
    s.stock = s.stock.filter(x => x.id !== b.id);
    s.listings = s.listings.filter(l => l.stockId !== b.id);
  }
  s.bulkDeal = undefined;
  s.dealsClosed += held.length;
  if (loanAmt > 0) bumpLenderRel(s, 'ibx', 3);
  s.reputation = clamp(s.reputation + 4, 0, 100);
  logDeal(s, { m: s.month, action: 'buy', name: `The ${bd.name} book`, type: held[0].type, sf: held.reduce((x, b) => x + b.sf, 0), price: bd.price });
  pushNews(s, 'success', `ONE WIRE, ${held.length} BUILDINGS: you took the entire ${bd.name} book for ${fmtMoney(bd.price)}${hardMoney ? `, 55% on Ironbridge bridge paper at ${rate.toFixed(1)}%` : ', all cash'}. The town will be talking about this one for years.`);
  return { s };
}

// New money keeps arriving: when the rival field thins out — collapses, crunches,
// a bad decade — fresh capital eventually smells the vacuum and opens a local
// office. A century of play should never end against three zombies and a monopoly.
const ENTRANT_NAMES: [string, string][] = [
  ['Meridian Yards Group', 'MYG'], ['Cobalt Ridge Partners', 'CRP'], ['Ashline Development', 'ASH'],
  ['Quarry & Vane', 'QVN'], ['Redpoint Urban', 'RPU'], ['Halcyon Property Trust', 'HAL'],
  ['Northgate Equities', 'NGE'], ['Summit & Bow', 'SMB'], ['Ferrous Capital', 'FER'],
  ['Old Canal Holdings', 'OCH'], ['Lantern Hill Group', 'LHG'], ['Crosstown Ventures', 'CTV'],
  ['Bellwether Properties', 'BWP'], ['Stonebridge Collective', 'SBC'], ['Axiom Real Estate', 'AXM'],
  ['Palisade Partners', 'PAL'], ['Ironquill Development', 'IQD'], ['Harbor Gate Capital', 'HGC'],
  ['Terracotta Group', 'TCG'], ['Vantage Point Holdings', 'VPH'], ['Kilnworth & Co', 'KLW'],
  ['Bright Meridian Trust', 'BMT'], ['Southdock Partners', 'SDP'], ['Argent Row Capital', 'ARC'],
];
function tickFirmEntrants(s: GameState) {
  if (s.month % 12 !== 0 || s.month === 0) return;
  const alive = s.firms.filter(f => f.alive).length;
  if (alive >= 10) return;
  // the thinner the field, the stronger the pull — and booms make capital brave
  const p = 0.12 + 0.07 * (10 - alive) + (s.econ.phase === 'expansion' || s.econ.phase === 'peak' ? 0.1 : 0);
  if (rng(s) > p) return;
  const used = new Set(s.firms.map(f => f.short));
  const cand = ENTRANT_NAMES.filter(([, sh]) => !used.has(sh));
  if (!cand.length) return;
  const [name, short] = rpick(s, cand);
  // entrants chase the era: this generation's darling sector is the likeliest thesis
  const { best } = eraExtremes(s.econ.era);
  const styles: Firm['style'][] = ['core', 'aggressive', 'value-add',
    best === 'industrial' ? 'industrial' : best === 'multifamily' ? 'mf' : best === 'office' ? 'core' : 'aggressive'];
  const style = rpick(s, styles);
  // sized for the era it enters: a year-80 entrant carries year-80 money
  const cash = Math.round(rrange(s, 3_000_000, 14_000_000) * Math.max(1, s.econ.costIdx * 0.8));
  s.firms.push({ name, short, style, cash, debt: 0, netWorth: cash, alive: true });
  pushNews(s, 'event', `NEW MONEY IN TOWN: ${name} opened a local office with ${fmtMoney(cash)} to deploy — a ${style === 'mf' ? 'multifamily' : style} shop chasing this era's story. The buyer pool just got deeper.`);
}

// The city eats itself: when the dirt under a tired building is worth clearly more
// than the building standing on it, a developer scrapes it and builds to today's
// density. This is how real cities replace their stock over a century — block by
// block, one teardown at a time. Player assets are never touched.
function tickRedevelopment(s: GameState) {
  if (rng(s) > 0.8) return;   // most quarters, when a scrape actually pencils
  // developer's residual: what the SITE supports at today's zoning and rents, minus
  // all-in cost (buy the building, knock it down, build new) — scrape when the
  // residual clears a real margin. Underbuilt vintage on prime dirt goes first.
  let best: { b: StockBuilding; ty: PType; sf: number; quality: number; allIn: number; margin: number } | null = null;
  for (const b of s.stock) {
    if (b.buildLeft || b.listedId || b.owner !== 'private') continue;
    if (b.age < 25 || b.quality > 72 || b.occ > 0.9) continue;   // good buildings don't get scraped
    const t = s.tiles[b.tileI];
    const opts = PTYPES.filter(ty => zoneAllows(t.zone, ty));
    if (!opts.length) continue;
    const ty = opts.reduce((x, y) => tileDemandFactor(s, t, y) > tileDemandFactor(s, t, x) ? y : x);
    if (tileDemandFactor(s, t, ty) < 1.0 || oversupplyPenalty(t, ty) > 0.06) continue;
    const acres = (b.cells ? b.cells.length : (b.pw ?? 1) * (b.ph ?? 1)) * PARCEL_AC;
    const sf = Math.round(acres * 43_560 * FAR[ty] * zoneTierMult(t.zone.tier) * 0.85 / 1000) * 1000;
    if (sf < 6000 || sf < b.sf * 1.4) continue;   // a scrape has to add real density, not shuffle it
    const quality = clamp(rrange(s, 88, 132), 45, 138);
    const buy = stockValue(s, b) * 1.05;          // the owner gets paid over the income value
    const demo = b.sf * 8 * s.econ.costIdx;
    const build = sf * constrForQuality(ty, quality).cost * constrCostIdx(s) * 1.3;
    const allIn = buy + demo + build;
    const newValue = stockNOIYr(s, { ...b, type: ty, sf, quality, occ: 0.9 }) / (capRatePct(s, t, ty, quality) / 100);
    const margin = (newValue - allIn) / allIn;
    if (margin > 0.10 && (!best || margin > best.margin)) best = { b, ty, sf, quality, allIn, margin };
  }
  if (!best) return;
  const { b, ty, sf, quality, allIn } = best;
  const t = s.tiles[b.tileI];
  const rich = s.firms.filter(x => x.alive && x.cash > allIn * 0.35 + 2_000_000);
  if (!rich.length) return;
  const f = rpick(s, rich);
  const cost = allIn;
  f.cash -= cost * 0.35;
  f.debt += cost * 0.65;
  t.supply[b.type] = Math.max(0, t.supply[b.type] - b.sf);
  s.stock = s.stock.filter(x => x.id !== b.id);
  const months = Math.min(26, Math.max(6, Math.round(5 + sf / 7000)));
  s.stock.push({
    id: s.nextId++, tileI: b.tileI, type: ty, sf,
    px: b.px, py: b.py, pw: b.pw, ph: b.ph, cells: b.cells ? [...b.cells] : undefined,
    units: genUnitsFor(s, ty, sf), quality, age: 0,
    construction: constrForQuality(ty, quality).id,
    occ: 0, owner: f.short, buildLeft: months, buildTotal: months, builder: f.short,
  });
  pushNews(s, 'event', `THE WRECKERS ARE IN at block ${blockLabel(t)}: ${f.name} bought the ${Math.round(b.age)}-year-old ${PLABEL[b.type].toLowerCase()} for the dirt underneath. ${(sf / 1000).toFixed(0)}K SF of new ${PLABEL[ty].toLowerCase()} rises in its place — the city eats itself, one tired building at a time.`, t.i);
}

function tickFirms(s: GameState) {
  if (s.month % 3 !== 0) return;
  tickFirmEntrants(s);
  tickFirmLand(s);
  tickRedevelopment(s);
  for (const f of s.firms) {
    if (!f.alive) continue;
    // ---- the quarter's actual books: rent in, debt service out, portfolio marked ----
    let noiQ = 0;
    for (const b of s.stock) if (b.owner === f.short && !b.buildLeft) noiQ += stockNOIYr(s, b) / 4;
    const rate = (s.econ.rate + 2.3) / 100;
    const interest = f.debt * rate / 4;
    const amort = Math.min(f.debt, f.debt * 0.005);   // slow principal paydown
    f.cash += noiQ - interest - amort;
    f.debt -= amort;
    f.netWorth = firmNetWorth(s, f);
    // ---- distress: negative cash means the lender is calling — sell something ----
    if (f.cash < 0) {
      const held = s.stock.filter(b => b.owner === f.short && !b.listedId && !b.buildLeft);
      if (held.length) {
        const sell = held.sort((a, b) => stockValue(s, a) - stockValue(s, b))[Math.floor(held.length * 0.5)] ?? held[0];
        listStockBuilding(s, sell, { distressed: true, priceMult: rrange(s, 0.78, 0.88), hot: true, expiresMonth: s.month + 4 });
        pushNews(s, 'deal', `${f.name} is deleveraging — a ${(sell.sf / 1000).toFixed(0)}K SF ${PLABEL[sell.type]} hits the market priced to move. Their problem is your entry point.`, sell.tileI);
      }
      if (f.netWorth < 0) {
        collapseFirm(s, f);
        continue;
      }
    }
    // appetite rides the demographic tide: boom decades build, decline decades don't.
    // And it HERDS with the cycle — everyone breaks ground at the peak, when money is
    // brave and rents look permanent, and that supply delivers straight into the bust.
    // Nobody builds at the bottom, which is why the next recovery gets tight.
    const herd = (s.econ.phase === 'peak' ? 1.8 : s.econ.phase === 'expansion' ? 1.3 : s.econ.phase === 'recession' ? 0.25 : 0.7)
      * clamp(s.econ.confidence / 60, 0.6, 1.4);
    const devAppetite = 0.05 * herd * (s.econ.demo?.regime === 'boom' ? 1.5 : s.econ.demo?.regime === 'decline' ? 0.5 : 1);
    if (rng(s) < devAppetite && f.netWorth > 8_000_000) firmDevelops(s, f);
    if (rng(s) > 0.35) continue; // ten firms can't all be buying every quarter
    const fit = (l: Listing): number => {
      if (l.kind === 'offmarket' || l.yourSale || l.parentAssetId || l.fromLandId || (l as any).omLead || l.underContract) return 0; // your leads, contracts and land are yours; your sale listings handled separately
      const t = s.tiles[l.tileI];
      if (f.style === 'industrial') return (l.kind === 'building' && l.type === 'industrial') || (l.kind === 'land' && t.indSuit > 55) ? 0.5 : 0.02;
      if (f.style === 'core') return l.kind === 'building' && !l.distressed && t.D > 60 ? 0.45 : 0.03;
      if (f.style === 'value-add') return l.kind === 'building' && (l.distressed || (l.quality ?? 90) < 63) ? 0.55 : 0.05;
      if (f.style === 'mf') return l.kind === 'building' && l.type === 'multifamily' ? 0.55 : (l.kind === 'land' && t.pop > 45 ? 0.2 : 0.03);
      return l.kind === 'land' ? (s.econ.phase === 'peak' || s.econ.phase === 'expansion' ? 0.5 : 0.15) : 0.12;
    };
    const scored = s.listings.map(l => ({ l, p: fit(l) })).sort((a, b) => b.p - a.p);
    if (scored.length && rng(s) < scored[0].p) {
      const l = scored[0].l;
      // a deal YOU are working gets one month of warning before a rival closes on it —
      // the brokers talk, and now so does the news feed
      if (l.playerEngaged && !l.rivalEye && !l.agreed) {
        l.rivalEye = f.short;
        pushNews(s, 'warn', `⚔ ${f.name} is CIRCLING the ${l.kind === 'land' ? `${l.acres}-acre land` : `${((l.sf ?? 0) / 1000).toFixed(0)}K SF ${PLABEL[l.type!]}`} listing you've been working at block ${blockLabel(s.tiles[l.tileI])}. They close within the month if you don't.`, l.tileI);
        continue;
      }
      if (l.agreed && l.playerEngaged) continue;   // an agreed deal is protected by the rival-bid mechanic, not sniped silently
      if (l.kind === 'land') {
        firmTakesLand(s, f, l);
        if (l.playerEngaged) bumpRivalry(s, f, `the dirt at block ${blockLabel(s.tiles[l.tileI])}`);
      } else {
        if (f.cash < l.price * 0.35 + 800_000) continue;   // real money: no cash, no closing
        const b = l.stockId ? s.stock.find(x => x.id === l.stockId) : undefined;
        if (b) {
          const seller = s.firms.find(x => x.short === b.owner);
          if (seller) { seller.cash += l.price * 0.45; seller.debt = Math.max(0, seller.debt - l.price * 0.55); }
          b.owner = f.short; b.listedId = undefined;
        }
        f.cash -= l.price * 0.35;
        f.debt += l.price * 0.65;
        logComp(s, { m: s.month, type: l.type!, sf: l.sf ?? 0, price: l.price, capPct: l.price > 0 ? Math.round((inPlaceNOIYr(s, l) / l.price) * 10000) / 100 : null, tileI: l.tileI, buyer: f.short });
        if (l.playerEngaged) bumpRivalry(s, f, `the ${((l.sf ?? 0) / 1000).toFixed(0)}K SF ${PLABEL[l.type!]} at block ${blockLabel(s.tiles[l.tileI])}`);
        else pushNews(s, 'deal', `${f.name} acquired a ${((l.sf ?? 0) / 1000).toFixed(0)}K SF ${PLABEL[l.type!]} building for ${fmtMoney(l.price)} (65% financed).`);
      }
      s.listings = s.listings.filter(x => x.id !== l.id);
    }
    if (f.style === 'aggressive' && s.econ.crunchMonthsLeft > 6 && rng(s) < 0.25) {
      collapseFirm(s, f);
    }
  }
}

function tickFacilities(s: GameState): number {
  let cf = 0;
  for (const f of [...s.facilities]) {
    const i = f.balance * (f.ratePct / 100 / 12);
    f.balance = Math.max(0, f.balance - (f.monthlyPmt - i));
    cf -= f.monthlyPmt;
    logCF(s, 'debt', 'Credit facility payment', -f.monthlyPmt);
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
      a.quality = clamp(a.quality + 45, 1, a.qCap);
      pushNews(s, 'success', `${a.name}: renovation complete — building steps up to a ${QLABEL[qGrade(a.quality)]} grade. Rents and renewals follow.`);
    }
  }
  if (a.programActive) {
    a.programActive.monthsLeft--;
    if (a.programActive.monthsLeft <= 0) {
      const p = PROGRAMS.find(x => x.id === a.programActive!.id);
      a.programActive = undefined;
      if (p) {
        if (p.capUp && !(a.programs ?? []).includes(p.id)) a.qCap = clamp(a.qCap + p.capUp, 30, 148); // the ceiling only rises once
        a.quality = clamp(a.quality + p.q, 1, a.qCap);
        if (!(a.programs ?? []).includes(p.id)) a.programs = [...(a.programs ?? []), p.id];
        (a.programsDoneM ??= {})[p.id] = s.month;
        pushNews(s, 'success', `${a.name}: ${p.label.toLowerCase()} complete — quality now ${Math.round(a.quality)}/150 (${QLABEL[qGrade(a.quality)]}-grade).${p.opexPct ? ' The building runs cheaper from today.' : ''}${p.velocity ? ' Tours already booking.' : ''}`);
      }
    }
  }
  if (a.mode === 'construction' && a.project) {
    const p = a.project;
    if (p.stage === 'diligence') {
      p.monthsLeft--;
      if (p.monthsLeft <= 0 && !s.pending.some(pd => pd.type === 'constrEvent' && pd.assetId === a.id)) {
        const cond = siteCondition(s, a.tileI, a.cells ?? [], a.sf);
        if (p.dd) p.dd.known = cond;
        s.pending.push({ type: 'constrEvent', assetId: a.id, eventKind: 'ddResult' });
      }
      return 0;
    }
    if (p.stage === 'design') {
      p.monthsLeft--;
      if (p.monthsLeft <= 0) {
        p.stage = 'permitting'; p.monthsLeft = 1 + Math.floor(rng(s) * 3);
        pushNews(s, 'info', `${a.name}: drawings issued for permit. ${p.designTier === 'signature' ? 'The renderings are getting passed around town.' : p.designTier === 've' ? 'Nothing about it will win awards, and that was the brief.' : ''}`);
      }
      return 0;
    }
    if (p.stage === 'permitting') {
      p.monthsLeft--;
      if (p.monthsLeft <= 0) { p.stage = 'building'; p.monthsLeft = p.totalMonths; pushNews(s, 'info', `${a.name}: permits in hand. Construction begins.`); }
      return 0;
    }
    // a dark site still costs money: no progress, but the interest clock runs
    if (p.haltMonthsLeft && p.haltMonthsLeft > 0) {
      p.haltMonthsLeft--;
      const loan0 = a.loans[0];
      if (loan0.floating) loan0.ratePct = Math.min(s.econ.rate + (loan0.spreadPct ?? CONFIG.constrSpread), loan0.capStrike ?? 99);
      const int0 = loan0.balance * (loan0.ratePct / 100 / 12);
      if (loan0.reserveBalance !== undefined && loan0.reserveBalance > 0) {
        const fr = Math.min(loan0.reserveBalance, int0);
        loan0.reserveBalance = Math.round((loan0.reserveBalance - fr) * 100) / 100;
        loan0.balance += fr;
        const rem0 = int0 - fr;
        if (rem0 > 0.5) { s.cash -= rem0; logCF(s, 'dev', `${a.name} — construction interest`, -rem0); a.ledger.push({ m: s.month, amt: -rem0 }); }
        if (loan0.reserveBalance <= 0) pushNews(s, 'warn', `${a.name}: the interest reserve is EMPTY on a dark site.`, a.tileI);
      } else if (loan0.reserveBalance !== undefined) {
        s.cash -= int0; logCF(s, 'dev', `${a.name} — construction interest`, -int0); a.ledger.push({ m: s.month, amt: -int0 });
      }
      if (p.haltMonthsLeft <= 0) pushNews(s, 'info', `${a.name}: the replacement GC has mobilized. Construction resumes.`, a.tileI);
      return 0;
    }
    // the GC can fail you: rare, uglier unbonded, ugliest in a recession
    if (!p.gcReplaced && p.monthsBuilt >= 1 && p.monthsLeft > 1) {
      const pFail = (p.contractType === 'gmp' ? 0.009 : 0.018) * (s.econ.phase === 'recession' ? 1.6 : 1);
      if (rng(s) < pFail) {
        p.gcReplaced = true;
        if (p.bonded) {
          const slip = 1 + (rng(s) < 0.5 ? 1 : 0);
          p.monthsLeft += slip;
          pushNews(s, 'warn', `${a.name}: your GC went under mid-job. Bonded — the surety covers the rebid delta; you lose ${slip} month${slip > 1 ? 's' : ''}. The premium just earned its keep.`, a.tileI);
        } else {
          const halt = 3 + Math.floor(rng(s) * 3);
          p.haltMonthsLeft = halt;
          const remainFrac = clamp(p.monthsLeft / Math.max(1, p.totalMonths), 0.1, 1);
          const delta = Math.round(p.hardBudget * remainFrac * (0.08 + rng(s) * 0.10) * (s.econ.constrCycle ?? 1));
          const fromCont = Math.min(p.contingencyLeft, delta);
          p.contingencyLeft -= fromCont;
          const over = delta - fromCont;
          if (over > 0) { s.cash -= over; logCF(s, 'dev', `${a.name} — GC rebid overrun`, -over); a.ledger.push({ m: s.month, amt: -over }); }
          p.spent += delta;
          a.quality = clamp(a.quality - (2 + rng(s) * 2), 5, a.qCap);
          pushNews(s, 'warn', `${a.name}: YOUR CONTRACTOR IS BANKRUPT — and unbonded. The site goes dark ~${halt} months while you rebid at today's prices: ${fmtMoney(delta)} more${over > 0 ? ` (${fmtMoney(over)} straight from cash)` : ''}, the exposed shell weathers, and the interest clock does not care.`, a.tileI);
          return 0;
        }
      }
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
        if (over > 0) { s.cash -= over; logCF(s, 'dev', `${a.name} — structural surprise`, -over); a.ledger.push({ m: s.month, amt: -over }); }
        p.spent += amt;
        pushNews(s, over > 0 ? 'warn' : 'info', `${a.name}: structural surprise cost ${fmtMoney(amt)}${over > 0 ? ` — ${fmtMoney(over)} beyond contingency came from your cash` : ', covered by contingency'}.`);
      }
      else { s.pending.push({ type: 'constrEvent', assetId: a.id, eventKind: ev.kind }); }
    }
    const monthlyHard = (p.hardBudget + p.softBudget) / p.totalMonths;
    p.spent += monthlyHard;
    const loan = a.loans[0];
    // floating construction debt reprices every month — a rate spike mid-build compounds
    if (loan.floating) loan.ratePct = Math.min(s.econ.rate + (loan.spreadPct ?? CONFIG.constrSpread), loan.capStrike ?? 99);
    const commitment = (a as any).loanCommitment ?? 0;
    const draw = Math.min(monthlyHard, Math.max(0, commitment - p.drawnSoFar));
    p.drawnSoFar += draw; loan.balance += draw;
    const interest = loan.balance * (loan.ratePct / 100 / 12);
    if (loan.reserveBalance !== undefined && loan.reserveBalance > 0) {
      const fromReserve = Math.min(loan.reserveBalance, interest);
      loan.reserveBalance = Math.round((loan.reserveBalance - fromReserve) * 100) / 100;
      loan.balance += fromReserve;                 // reserve draws are loan draws
      const rem = interest - fromReserve;
      if (rem > 0.5) { s.cash -= rem; logCF(s, 'dev', `${a.name} — construction interest`, -rem); a.ledger.push({ m: s.month, amt: -rem }); }
      if (loan.reserveBalance <= 0) pushNews(s, 'warn', `${a.name}: the interest reserve is EMPTY. Debt service now comes from your cash — on a building earning nothing.`, a.tileI);
    } else if (loan.reserveBalance !== undefined) {
      s.cash -= interest;                          // the expensive months
      logCF(s, 'dev', `${a.name} — construction interest`, -interest);
      a.ledger.push({ m: s.month, amt: -interest });
    } else {
      loan.balance += interest;                    // legacy path (non-reserve loans)
    }
    p.monthsLeft--;
    if (p.monthsLeft <= 0) {
      a.mode = 'leaseup';
      // construction loan flips to 12 months IO then amortizes if not refinanced
      loan.ioMonthsLeft = 12;
      loan.monthlyPmt = monthlyPayment(loan.balance, loan.ratePct, loan.amortYears);
      if (p.contingencyLeft > 0) {
        s.cash += p.contingencyLeft * 0.5;
        logCF(s, 'dev', `${a.name} — unused contingency returned`, p.contingencyLeft * 0.5);
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
        a.quality = clamp(a.quality + 21, 30, constrSpec({ type: 'multifamily', construction: 'midrise' }).qCap);
        a.qCap = constrSpec(a).qCap;
        a.name = a.name.replace(/Tower|Exchange|Works|Commons/, 'Flats');
        (a as any).converting = undefined;
        pushNews(s, 'success', `CONVERSION DELIVERED: ${a.name} reopens as ${a.units} apartments. Office supply shrinks; the rent roll starts from zero — but renters move faster than tenants ever did.`);
      }
      if (a.bts) {
        const bts = a.bts;
        const monthsLate = Math.max(0, s.month - bts.deliverBy);
        if (monthsLate > 6) {
          pushNews(s, 'warn', `${bts.tenant} WALKED: delivery ran ${monthsLate} months past the drop-dead date. The build-to-suit lease is void — you own a purpose-built building with nobody's name on it.`, a.tileI);
        } else {
          let rate = bts.rate;
          if (monthsLate > 0) {
            rate = Math.round(rate * 0.92 * 100) / 100;
            s.cash -= bts.penalty;
            logCF(s, 'fees', `${a.name} — late-delivery penalty`, -bts.penalty);
            a.ledger.push({ m: s.month, amt: -bts.penalty });
            pushNews(s, 'warn', `${a.name} delivered ${monthsLate} month${monthsLate > 1 ? 's' : ''} late: ${bts.tenant} takes the keys, minus a ${fmtMoney(bts.penalty)} penalty and 8% off the rent. The clause read itself.`, a.tileI);
          } else {
            pushNews(s, 'success', `${a.name} delivered ON TIME: ${bts.tenant} signs for the whole building — ${bts.termY} years NNN at $${rate.toFixed(2)}/SF, ${CREDIT_LABEL[bts.credit]} credit. This is the good kind of development.`, a.tileI);
          }
          a.tenants.push({
            id: s.nextId++, name: bts.tenant, sf: a.sf, rate,
            startM: s.month, endM: s.month + bts.termY * 12, credit: bts.credit, escPct: 2.5,
          });
          recalcOcc(a);
          a.mode = 'operating';
        }
        a.bts = undefined;
      }
      a.entryNOI = stabilizedNOI(s, a);
      a.entryCap = capRatePct(s, t, a.type, a.quality);
      t.supply[a.type] += a.sf;
      logDeal(s, { m: s.month, action: 'delivered', name: a.name, type: a.type, sf: a.sf, price: a.basis });
      a.project = undefined;
    }
    return 0;
  }
  // ---- casualty: the 2am phone call. Insured, but insurance never makes you whole ----
  if (a.repair) {
    a.repair.monthsLeft--;
    if (a.repair.monthsLeft <= 0) {
      // rebuilt, but never quite the same — insurance restores function, not luster
      a.quality = clamp(a.quality - 3, 10, a.qCap);
      pushNews(s, 'success', `${a.name}: repairs complete — the ${a.repair.what} damage is behind you and the full building is earning again.`, a.tileI);
      a.repair = undefined;
    }
  } else if (rng(s) < 0.0012) {
    const what = rpick(s, ['fire', 'storm', 'burst-main'] as const);
    const frac = clamp(rrange(s, 0.10, 0.45), 0.05, 0.6);
    const months = 2 + Math.round(rrange(s, 0, 4));
    const val = assetValue(s, a);
    const insCrisis = (s.econ.insSpikeMonthsLeft ?? 0) > 0;
    const deductible = roundPrice(Math.max(25_000, val * 0.008) * (insCrisis ? 1.6 : 1));
    s.cash -= deductible;
    logCF(s, 'capex', `${a.name} — casualty deductible`, -deductible);
    a.ledger.push({ m: s.month, amt: -deductible });
    a.repair = { frac, monthsLeft: months, what };
    const label = what === 'fire' ? 'A fire tore through' : what === 'storm' ? 'Storm damage shut down' : 'A burst water main flooded';
    pushNews(s, 'warn', `CASUALTY at ${a.name}: ${label} ~${Math.round(frac * 100)}% of the building. Insurance covers the rebuild; your deductible is ${fmtMoney(deductible)}${insCrisis ? ' (carriers are repricing mid-crisis)' : ''}, and that share of the rent stops for ~${months} months. Taxes and insurance keep running on all of it.`, a.tileI);
  }
  // ---- tenant dynamics ----
  const mkt = assetRentPSF(s, a);
  if (isAggregate(a.type)) {
    // multifamily runs on aggregate occupancy: renters churn fast and re-lease fast
    const df = tileDemandFactor(s, t, a.type);
    const qf = 0.78 + (apparentQuality(s, a) / 150) * 0.30;
    const rentComp = 1 - a.rentStance * 2.2;
    const tOcc = targetOcc(s, t, a.type);
    const churn = (a.maint === 'low' ? 0.034 : a.maint === 'high' ? 0.019 : 0.025);
    const boost = a.mode === 'leaseup' ? 1.7 : 1;
    const sizeDragMF = clamp(1.12 - a.sf / 300_000, 0.6, 1);
    const amenMF = (a.programs ?? []).includes('amenity') ? (PROGRAMS.find(p => p.id === 'amenity')?.velocity ?? 1) : 1;
    const gain = CONFIG.absorbBase[a.type] * 0.45 * (s.staff?.leasing ? 1.18 : 1) * df * qf * clamp(rentComp, 0.4, 1.6) * boost * sizeDragMF * amenMF * leasingClimate(s, a.type) * Math.max(0, tOcc * 1.03 - a.occ);
    a.occ = clamp(a.occ - churn * a.occ + gain + (rng(s) - 0.5) * 0.006, 0.05, 0.98);
    if (a.mode === 'leaseup' && a.occ >= 0.85) {
      a.mode = 'operating';
      pushNews(s, 'success', `${a.name} is stabilized at ${Math.round(a.occ * 100)}% occupancy. Permanent financing is now on the table.`);
    }
  }
  // mixed: the residential floors absorb like an apartment building — one living
  // block of homes that fills and empties with the rental market, no LOIs involved
  if (a.type === 'mixed') {
    const mfc = mixedComponents(s, a).find(c => c.comp === 'multifamily');
    if (mfc && mfc.sf >= 600) {
      let row = a.tenants.find(tn => tn.use === 'multifamily');
      const df = tileDemandFactor(s, t, 'multifamily');
      const qf = 0.78 + (apparentQuality(s, a) / 150) * 0.30;
      const tOcc = targetOcc(s, t, 'multifamily');
      const churn = (a.maint === 'low' ? 0.034 : a.maint === 'high' ? 0.019 : 0.025);
      const boost = a.mode === 'leaseup' ? 1.7 : 1;
      const rentCompMF = clamp(1 - a.rentStance * 2.2, 0.4, 1.6);
      const curOcc = clamp((row?.sf ?? 0) / mfc.sf, 0, 1);
      const gain = CONFIG.absorbBase.multifamily * 0.45 * (s.staff?.leasing ? 1.18 : 1) * df * qf * rentCompMF * boost * leasingClimate(s, 'multifamily') * Math.max(0, tOcc * 1.03 - curOcc);
      const newOcc = clamp(curOcc - churn * curOcc + gain + (rng(s) - 0.5) * 0.006, 0, 0.98);
      const occUnits = clamp(Math.round(newOcc * mfc.units), 0, mfc.units);
      const newSF = Math.round(occUnits * (mfc.sf / mfc.units));
      const mktMF = componentRentPSF(s, a, 'multifamily');
      if (!row && occUnits > 0) {
        row = { id: s.nextId++, name: '', sf: 0, rate: Math.round(mktMF * 100) / 100, startM: s.month, endM: s.month + 9999, credit: 1, escPct: 2.5, use: 'multifamily' };
        a.tenants.push(row);
      }
      if (row) {
        if (newSF > row.sf) {
          // move-ins sign at today's rent; the block's blended rate follows
          row.rate = Math.round((row.rate * row.sf + mktMF * (newSF - row.sf)) / Math.max(1, newSF) * 100) / 100;
        }
        row.sf = newSF;
        row.name = `Residences — ${occUnits} of ${mfc.units} homes`;
        if (occUnits <= 0) a.tenants = a.tenants.filter(tn => tn !== row);
      }
      recalcOcc(a);
    }
  }
  // ambient small-suite leasing (spaces too small to negotiate individually).
  // Mixed buildings lease component by component above — not through this path.
  const su = suiteSF(a);
  if (!isAggregate(a.type) && a.type !== 'mixed' && su < 4000) {
    const vacant = a.sf - leasedSF(a);
    if (vacant >= su * 0.8) {
      const df = tileDemandFactor(s, t, a.type);
      const rentComp = 1 - a.rentStance * 2.2;
      const qf = 0.78 + (apparentQuality(s, a) / 150) * 0.30;
      const boost = a.mode === 'leaseup' ? 1.6 : 1;
      const amenSm = (a.programs ?? []).includes('amenity') ? (PROGRAMS.find(x => x.id === 'amenity')?.velocity ?? 1) : 1;
      const p = clamp(CONFIG.absorbBase[a.type] * 1.45 * (s.staff?.leasing ? 1.25 : 1) * df * qf * rentComp * boost * amenSm * leasingClimate(s, a.type) * clamp(vacant / a.sf, 0.2, 1), 0.02, 0.44);
      if (rng(s) < p) {
        let sf = Math.min(vacant, Math.round(su / 100) * 100);
        if (vacant - sf < Math.max(400, su * 0.5)) sf = vacant;   // tenants take whole suites — no orphan slivers
        a.tenants.push({
          id: s.nextId++, name: tenantName(s, a.type), sf,
          rate: Math.round(mkt * (1 + a.rentStance) * rrange(s, 0.97, 1.03) * 100) / 100,
          startM: s.month, endM: s.month + Math.round(rrange(s, 24, 60)), credit: rollCredit(s, a.quality + ((a.programs ?? []).includes('smart') ? 12 : 0), t.D),
        });
      }
    }
  }
  // annual escalations at whatever each lease says — the quiet compounding that pays for buildings
  for (const tn of a.tenants) {
    const age = s.month - tn.startM;
    if (age > 0 && age % 12 === 0 && tn.endM > s.month) {
      tn.rate = Math.round(tn.rate * (1 + (tn.escPct ?? 3) / 100) * 100) / 100;
    }
  }
  // expirations & renewals — significant tenants come back as a renewal proposal you negotiate
  for (const tn of [...a.tenants]) {
    if (tn.endM > s.month) continue;
    // a component tenant renews against its own market, not the building blend
    const mktTn = a.type === 'mixed' && tn.use ? componentRentPSF(s, a, tn.use) : mkt;
    // a fixed-rate option is a one-way door: exercised when it's below market, ignored when it isn't
    if (tn.optionRate !== undefined && !tn.optionUsed) {
      tn.optionUsed = true;
      if (tn.optionRate < mktTn * 0.985) {
        tn.rate = tn.optionRate;
        tn.startM = s.month; tn.endM = s.month + (tn.optionYears ?? 5) * 12;
        tn.escPct = tn.escPct ?? 2.5;
        pushNews(s, 'warn', `${tn.name} EXERCISED their option at ${a.name}: ${(tn.optionYears ?? 5)} more years at $${tn.optionRate.toFixed(2)}/SF against a $${mktTn.toFixed(2)} market. The option you granted was worth exactly this much.`);
        continue;
      }
      pushNews(s, 'info', `${tn.name}'s renewal option at ${a.name} lapsed unexercised — the market is below their strike. Now you negotiate fresh.`);
    }
    const under = tn.rate < mktTn * 0.97;
    // a saturated block bleeds: when the neighborhood is oversupplied with this product,
    // tenants have cheaper options across the street — renewals stop being automatic.
    // (Without this, buildings priced for their oversupplied doom never met it.)
    const localHit = clamp(1 - oversupplyPenalty(t, tn.use ?? a.type) * 2.2, 0.45, 1);
    if (tn.sf >= 4000 && !s.lois.some(x => x.kind === 'renewal' && x.tenantId === tn.id)) {
      const wants = clamp(((under ? 0.85 : 0.62)
        + (a.maint === 'high' ? 0.08 : a.maint === 'low' ? -0.16 : 0)
        + clamp((EQ_VAC[a.type] - s.econ.cityVac[a.type]) * 0.014, -0.12, 0.12)  // nowhere to go in a tight market
        + (apparentQuality(s, a) / 150) * 0.10) * localHit, 0.15, 0.95);
      if (rng(s) < wants) {
        tn.endM = s.month + 3; // holds over while you talk
        const ask = Math.round(Math.min(mktTn * 0.985, Math.max(tn.rate * 0.97, tn.rate * rrange(s, 0.98, 1.06))) * 100) / 100;
        s.lois.push({
          id: s.nextId++, assetId: a.id, kind: 'renewal', tenantId: tn.id,
          tenant: tn.name, credit: tn.credit, sf: tn.sf,
          rate: ask, termY: [3, 3, 5, 5, 7][Math.floor(rng(s) * 5)],
          prevRate: Math.round(tn.rate * 100) / 100,
          expiresM: s.month + 2, stage: 'open',
          ...(tn.use ? { use: tn.use } : {}),
        } as LOI);
        pushNews(s, 'info', `Renewal proposal: ${tn.name} wants to stay at ${a.name} — offering $${ask.toFixed(2)}/SF. Their lease is up; the ball is yours.`);
      } else {
        a.tenants = a.tenants.filter(x => x.id !== tn.id);
        chargeMakeReady(s, a, tn.sf);
        logMigration(s, a, tn.name, tn.sf);
        pushNews(s, 'info', `${tn.name} did not renew at ${a.name} — ${(tn.sf / 1000).toFixed(1)}K SF back on the market.`);
        tripCoTenancy(s, a, tn);
      }
      continue;
    }
    // small suites renew quietly — unless the block is drowning in empty space
    let pRenew = ((under ? 0.78 : 0.52)
      + (a.maint === 'high' ? 0.10 : a.maint === 'low' ? -0.16 : 0)
      + clamp((EQ_VAC[a.type] - s.econ.cityVac[a.type]) * 0.014, -0.12, 0.12)
      + (apparentQuality(s, a) / 150) * 0.10) * localHit;
    if (rng(s) < clamp(pRenew, 0.1, 0.92)) {
      tn.rate = Math.round(Math.min(mktTn * (1 + a.rentStance), tn.rate * 1.12) * 100) / 100;
      tn.startM = s.month; tn.endM = s.month + Math.round(rrange(s, 36, 72));
    } else {
      a.tenants = a.tenants.filter(x => x.id !== tn.id);
      chargeMakeReady(s, a, tn.sf);
      pushNews(s, 'info', `${tn.name} did not renew at ${a.name} — ${(tn.sf / 1000).toFixed(1)}K SF back on the market.`);
      tripCoTenancy(s, a, tn);
    }
  }
  // defaults by credit (worse in recessions). The Residences block in a mixed
  // building is dozens of households, not one credit — its churn lives in absorption.
  const recMult = s.econ.phase === 'recession' ? 2.6 : 1;
  for (const tn of isAggregate(a.type) ? [] : [...a.tenants]) {
    if (tn.use === 'multifamily' && tn.endM - s.month > 5000) continue;
    const p = [0.006, 0.002, 0.0006][tn.credit] * recMult;
    if (rng(s) < p) {
      a.tenants = a.tenants.filter(x => x.id !== tn.id);
      chargeMakeReady(s, a, tn.sf);
      pushNews(s, 'warn', `${tn.name} (${CREDIT_LABEL[tn.credit]} credit) defaulted at ${a.name}. ${(tn.sf / 1000).toFixed(1)}K SF goes dark; the rent stops today.`);
      tripCoTenancy(s, a, tn);
    }
  }
  recalcOcc(a);
  if (a.mode === 'leaseup' && a.occ >= 0.85) {
    a.mode = 'operating';
    pushNews(s, 'success', `${a.name} is stabilized at ${Math.round(a.occ * 100)}% occupancy. Permanent financing is now on the table.`);
  }
  // wear: buildings date fastest in their first fifteen years (the market moves on
  // from their finishes), slower once they're already dated. Full buildings wear
  // harder than empty ones, and deferred maintenance compounds.
  {
    const ageWear = (0.30 - Math.min(0.16, a.age * 0.008)) * (s.staff?.pm ? 0.85 : 1);
    const useWear = 0.78 + 0.34 * a.occ;
    const maintAdj = a.maint === 'high' ? 0.16 : a.maint === 'low' ? -0.24 : 0;
    const qFloor = Math.max(10, a.qCap * 0.22);
    a.quality = clamp(a.quality - ageWear * useWear + maintAdj, qFloor, a.qCap);
  }
  a.age += 1 / 12;
  // cash flow
  let noi = assetNOIMonthly(s, a);
  const ds = assetDebtService(a);
  for (const l of a.loans) {
    // floating permanent debt reprices monthly; a cap is the ceiling you paid for
    if (l.floating && l.kind !== 'constr') {
      const nr = Math.min(s.econ.rate + (l.spreadPct ?? 2.5), l.capStrike ?? 99);
      if (Math.abs(nr - l.ratePct) > 0.001) {
        l.ratePct = Math.round(nr * 100) / 100;
        if (l.monthlyPmt > 0) l.monthlyPmt = monthlyPayment(l.balance, l.ratePct, l.amortYears);
      }
    }
    // construction paper is bridge money. When the IO runway ends and it's still on the
    // books, the lender reprices it +150bps and starts calling — the takeout is YOUR job.
    if (l.kind === 'constr' && l.ioMonthsLeft === 1 && a.mode !== 'construction' && !(l as any).extBumped) {
      (l as any).extBumped = true;
      l.ratePct += 1.5;
      l.monthlyPmt = monthlyPayment(l.balance, l.ratePct, l.amortYears);
      pushNews(s, 'warn', `${a.name}: the construction lender's IO runway is up. The loan reprices to ${l.ratePct.toFixed(2)}% and starts amortizing — take it out with permanent financing (Debt tab) or keep paying bridge rates for a stabilized building.`, a.tileI);
    }
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
      l.floating = undefined; l.spreadPct = undefined; l.capStrike = undefined;   // the roll writes fixed paper; old hedges die with the old note
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
  const noiPreSweep = noi;
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
  // the books: this asset's month, line by line
  {
    const egiM2 = assetEGIMonthly(s, a);
    logCF(s, 'rent', a.name, egiM2);
    logCF(s, 'opex', a.name, -(egiM2 - noiPreSweep));
    logCF(s, 'debt', a.name, -ds);
    if (swept && noiPreSweep - ds > 0) logCF(s, 'debt', a.name + ' — covenant cash sweep', -(noiPreSweep - ds));
    if (jvShare > 0 && noi - ds !== 0) logCF(s, 'jv', a.name + ' — LP share', -(noi - ds) * jvShare);
  }
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
  // a trivial overdraft is a fee, not a foreclosure — banks seize buildings over real
  // holes, and they call before they act
  if (s.cash < -25_000) s.negCashStreak++;
  else if (s.cash >= 0) s.negCashStreak = 0;
  if (s.cash < 0 && s.cash >= -25_000) {
    const fee = Math.round(Math.max(250, -s.cash * 0.02));
    s.cash -= fee;
    logCF(s, 'fees', 'Overdraft interest', -fee);
  }
  const grace = s.lastMonthCF > 0 ? 6 : 3;   // cash-flowing borrowers get worked with, not foreclosed
  if (s.negCashStreak === grace - 1 && s.cash < -25_000) {
    pushNews(s, 'warn', `THE BANK IS CALLING: ${grace - 1} months in the red. Cover the ${fmtMoney(-s.cash)} overdraft THIS MONTH — sell something, refinance, cut the burn — or the bank picks a building and sells it for you, at their price.`);
  }
  if (s.negCashStreak >= grace) {
    const sellable = s.assets.filter(a => a.mode !== 'construction');
    if (sellable.length > 0) {
      const worst = sellable.sort((a, b) => (assetNOIMonthly(s, a) - assetDebtService(a)) - (assetNOIMonthly(s, b) - assetDebtService(b)))[0];
      const q = sellQuote(s, worst);
      let net = q.gross * 0.85 - q.costs - q.payoff - q.facRelease;
      if (net < 0 && !worst.loans.some(ln => ln.recourse)) net = 0;   // non-recourse: the keys are the ceiling
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
      logCF(s, 'sell', `FORCED SALE — ${worst.name}`, net);
      for (const ln of worst.loans) if (ln.lenderId) bumpLenderRel(s, ln.lenderId, -22);
      worst.ledger.push({ m: s.month, amt: net });
      s.stock.push({
        id: s.nextId++, tileI: worst.tileI, type: worst.type, sf: worst.sf, units: worst.units,
        px: worst.px, py: worst.py, pw: worst.pw, ph: worst.ph,
        cells: worst.cells ? [...worst.cells] : undefined,
        quality: Math.round(worst.quality), age: Math.round(worst.age), construction: worst.construction,
        occ: Math.round(worst.occ * 100) / 100, owner: 'private',
      });
      s.assets = s.assets.filter(x => x.id !== worst.id);
      s.lois = s.lois.filter(x => x.assetId !== worst.id);
      s.pending = s.pending.filter(pd => pd.assetId !== worst.id);   // a dead asset's modal is a softlock
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
  const probe = { tileI: l.tileI, type: c.type, sf: c.sf, units: c.units, construction: c.construction, quality: bd.spec.q, mix: c.type === 'mixed' ? (c.mix ?? defaultMixSplit(state.seed, l.tileI)) : undefined };
  const scenarios = [
    { name: 'Bear', rentMult: 0.88, vacAdd: 6 },
    { name: 'Base', rentMult: 1.0, vacAdd: 0 },
    { name: 'Bull', rentMult: 1.1, vacAdd: -2 },
  ].map(sc => {
    const rent = assetRentPSF(state, probe as any) * sc.rentMult;
    const occ = clamp(targetOcc(state, t, c.type) - sc.vacAdd / 100, 0.3, 0.97);
    const potM = (c.sf * rent) / 12;
    const overM = c.type === 'retail' ? expectedRetailOveragePSFYr(state, l.tileI, bd.spec.q) * c.sf * occ / 12 * sc.rentMult : 0;
    const egiM = potM * occ + overM;
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
  const probe = { tileI: l.tileI, type: l.type!, sf: l.sf!, quality: l.quality!, units: l.units ?? 1, construction: l.construction ?? CONSTR[l.type!][0].id, mix: l.mix, id: l.stockId };
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
    if (s && s.version === 32 && Array.isArray(s.tiles) && Array.isArray(s.stock)) return s as GameState;
    return null;
  } catch { return null; }
}
