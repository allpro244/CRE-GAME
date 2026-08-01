// The simulation state. Everything the game knows that isn't static parcel
// data lives here, and it must stay JSON-serializable — saves are snapshots.
import type { AssetClass } from "@/data/types";

export type MarketPhase = "recovery" | "expansion" | "peak" | "recession";

export type BuiltClass = Exclude<AssetClass, "land">;
export const BUILT_CLASSES: BuiltClass[] = ["office", "retail", "mixed", "multifamily", "industrial"];

export type Condition = "worn" | "standard" | "good";

export type Sector =
  | "finance" | "law" | "tech" | "media" | "insurance"
  | "logistics" | "apparel" | "food" | "medical" | "design";

export type Credit = 0 | 1 | 2; // C, B, A
export const CREDIT_LABEL = ["C", "B", "A"];

export interface Tenant {
  name: string;
  sector: Sector;
  credit: Credit;
  sf: number;
  rentPsf: number;     // $/sf/yr
  net: boolean;        // legacy flag; `recovery` is the real answer
  recovery?: "nnn" | "base" | "gross";
  baseStopPsf?: number;   // base-year expense stop, $/sf — frozen at signing
  startM: number;
  endM: number;        // lease expiration
  freeUntilM?: number; // free-rent concession
  defaulted?: boolean;
}

export interface LOI {
  id: number;
  bbl: string;
  kind: "new" | "renewal";
  name: string;
  sector: Sector;
  credit: Credit;
  sf: number;
  rentPsf: number;
  termM: number;
  tiPsf: number;       // tenant-improvement allowance, $/sf at signing
  freeM: number;       // free-rent quarters
  net: boolean;
  recovery?: "nnn" | "base" | "gross";
  expiresM: number;
  countered?: boolean;
  tenantIdx?: number;  // renewals: index into holding.tenants
}

export interface Loan {
  product: string;
  floating?: boolean;
  points?: number;
  recourse?: boolean;         // a personal guarantee: a deficiency follows you
  prepay?: "open" | "stepdown" | "yieldmaint";
  prepayUntilM?: number;
  kicker?: number;            // participating paper: the lender's cut of the gain
  principal: number;
  balance: number;
  ratePct: number;       // current coupon (floating reprices each quarter)
  spread: number;        // over the index, for floating
  ioUntilM: number;      // interest-only through this quarter
  amortYears: number;
  maturityM: number;     // the balloon
  monthlyPmt: number;
  capPremium?: number;   // paid at closing on floating paper
  minDSCR: number;       // covenants, tested quarterly
  maxLTV: number;
  sweep: boolean;        // breach: cash flow trapped to principal until cured
  cleanQs: number;
  originM: number;
  holidayUntilM?: number;  // covenants do not bite until this month
  cap?: { strike: number; expiresM: number }; // purchased rate cap: index capped at strike
}

export interface Holding {
  bbl: string;
  boughtM: number;
  costBasis: number;
  deprTaken?: number;  // accumulated depreciation — reduces basis on sale
  assessed?: number;   // property-tax assessed value; steps up on reassessment
  loan: Loan | null;
  condition: Condition;
  lastCapM?: number;   // when this asset last had money spent on its bones
  renovatingUntilM?: number;
  tenants: Tenant[];   // commercial rent roll
  makeReady?: { sf: number; readyM: number }[]; // vacated space being turned; unleasable until ready
  broker?: boolean;    // leasing broker on retainer: more LOIs, monthly fee
  occ?: number;        // multifamily aggregate occupancy
  stance?: -1 | 0 | 1; // rent posture: push / market / fill
  deliveredM?: number; // ground-up completion: new space leases with momentum
  sale?: { ask: number; listedM: number; unsolicited?: boolean; offer?: { price: number; expiresM: number } }; // on the market
  program?: { id: string; untilM: number };  // capital program underway
  programsDone?: Record<string, number>;     // id -> completed quarter
  cfHistory: number[];
}

// Ground-up development on an owned vacant lot (Groundwork, simplified):
// pick use and FAR up to zoning, 60% construction loan, the building rises
// over 4-6 quarters, then leases up from empty.
export type Contract = "gmp" | "costplus";

export interface Development {
  bbl: string;
  use: BuiltClass;
  sf: number;
  floors: number;
  costTotal: number;      // the budget as it stands today, escalation included
  hardCost: number;       // the part exposed to escalation under cost-plus
  contract: Contract;
  contingency: number;    // held back against change orders; unspent is yours
  contingencyUsed: number;

  // The loan does not land in your account on day one. Equity goes in first,
  // then the bank funds draws against work in place, and the interest on what
  // has been drawn is paid out of a reserve inside the loan until it runs dry.
  commitment: number;     // the lender's total commitment
  drawn: number;          // funded to date
  loanBalance: number;    // drawn + capitalised interest
  interestReserve: number;
  reserveUsed: number;
  equityBudget: number;   // your share of the budget
  equitySpent: number;
  ratePct: number;

  startM: number;
  deliverM: number;
  baseMonths: number;     // schedule at groundbreak, before slips
  preLeaseShare: number;  // 0 if built on spec
  preLeasedSf?: number;
  events: number;         // how many things have gone wrong
}

// A delivered development overrides the static parcel record.
export interface BuiltOverride {
  class: BuiltClass;
  bldgArea: number;
  floors: number;
  yearBuilt: number;
}

export interface Listing {
  bbl: string;
  ask: number;
  listedM: number;
  expiresM: number;
  distress?: boolean;  // motivated seller — priced under appraisal, goes fast
}

export interface Approach {
  q: number;           // when the owner was approached
  refused: boolean;
  ask?: number;        // if willing: their number, good for 4 quarters
  countered?: boolean; // you get one counter per approach
  inbound?: boolean;   // they called you, not the other way round
}

export interface NewsItem {
  q: number;
  kind: "rumor" | "event" | "deal" | "info" | "warn";
  text: string;
}

export interface EconHistoryPoint {
  q: number;
  indexRate: number;
  landIdx: number;
  cycleDev: number;
  capOffice: number;
  rentOffice: number;
  creditIdx?: number;
  employIdx?: number;
}

export interface Econ {
  indexRate: number;
  phase: MarketPhase;
  phaseMLeft: number;
  rumoredPhase: MarketPhase | null;
  cycleDev: number;
  landIdx: number;
  capRate: Record<BuiltClass, number>;
  rentIdx: Record<BuiltClass, number>;
  costIdx: number; // construction & operating cost inflation
  // Sectors do not move together. Each class carries its own momentum, so
  // office can be in a bear market while sheds are the best trade in town —
  // which is the whole reason to hold more than one kind of building.
  sectorMom: Record<BuiltClass, number>;
  // Everything the rest of the market is building, by class, in square feet.
  // Starts respond to profit; deliveries land ~30 months later and take the
  // rent with them. This is the supply half of the cycle, and without it a
  // boom never ends of its own accord.
  pipeline: Record<BuiltClass, number>;
  starts: Record<BuiltClass, number>;
  supplyPress?: Partial<Record<BuiltClass, number>>;
  // Capital availability, 1 = normal. In a crunch this falls, spreads widen,
  // lenders size smaller, and cap rates gap out — independent of the index.
  creditIdx: number;
  // The demand driver behind leasing velocity.
  employIdx: number;
  history: EconHistoryPoint[];
}

// One year of the ledger: every dollar in or out, bucketed. The Books page
// renders these; actions and the tick both write into the current year.
export interface BooksYear {
  yr: number;       // 0-based game year
  noi: number;      // property NOI collected (pre-debt)
  debtSvc: number;  // debt service + refi fees + cap premiums
  leasing: number;  // TI, LC, broker retainers
  capex: number;    // programs, renovations, make-ready turns
  dev: number;      // development equity, construction interest, overruns
  taxes: number;    // income + capital gains + property (property is inside NOI)
  bought: number;   // equity out the door on acquisitions
  sold: number;     // net proceeds in from dispositions
  ga: number;       // firm overhead — asset management, accounting, legal
}

export interface Exit {
  bbl: string;
  address: string;
  boughtM: number;
  soldM: number;
  price: number;
  basis: number;
  gain: number;
  forced?: boolean;
}

export interface GameState {
  v: 11;
  seed: number;
  rng: number;
  month: number;
  cash: number;
  econ: Econ;
  holdings: Record<string, Holding>;
  listings: Listing[];
  lois: LOI[];
  nextLoiId: number;
  approaches: Record<string, Approach>;
  developments: Record<string, Development>;
  built: Record<string, BuiltOverride>;      // delivered buildings, yours and the city's
  cityBuilt: string[];                       // bbls the market built, not you
  landAdj: Record<string, number>;           // per-parcel land value multiplier
  blockD: Record<string, number>;            // per-block demand DRIFT, in points off the generated score
  totalLots: number;
  builtAtStart: number;
  // a 1031 exchange in flight: sale gain rolled, tax deferred until the clock runs out
  exchange: { deferredTax: number; rolledGain: number; minPrice: number; deadlineM: number } | null;
  taxesPaid: number;
  // Leasing agent on retainer: signs every LOI for you at a 6% commission
  // instead of the 4%/2% you'd pay doing it yourself.
  agent: boolean;
  // Revolving line against the portfolio: 35% of net worth at index + 400bps.
  loc: { balance: number; drawnTotal: number; interestPaid: number };
  books: BooksYear[];                        // the ledger, one entry per year
  nwHistory: number[];                       // net worth at each month, for the chart
  exits: Exit[];                             // every disposition, forced or chosen
  milestones: Record<string, number>;        // milestone id -> month achieved
  news: NewsItem[];
  gameOver: { cause: string; complete?: boolean } | null;
  insolventMs: number;
  locOverMs?: number;
}

// Write a cash flow into the current year's ledger bucket.
export function logBooks(s: GameState, key: keyof Omit<BooksYear, "yr">, amt: number) {
  if (!s.books) s.books = [];
  const yr = Math.floor(s.month / 12);
  let e = s.books[s.books.length - 1];
  if (!e || e.yr !== yr) {
    e = { yr, noi: 0, debtSvc: 0, leasing: 0, capex: 0, dev: 0, taxes: 0, bought: 0, sold: 0, ga: 0 };
    s.books.push(e);
  }
  e[key] = (e[key] ?? 0) + amt;
}

export const START_CASH = 6_000_000;
export const START_YEAR = 2026;
export const CAMPAIGN_MONTHS = 1200; // a hundred years of Ashport

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function monthLabel(m: number): string {
  return `${MONTH_NAMES[((m % 12) + 12) % 12]} ${START_YEAR + Math.floor(m / 12)}`;
}
