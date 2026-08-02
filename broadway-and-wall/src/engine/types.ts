// The simulation state. Everything the game knows that isn't static parcel
// data lives here, and it must stay JSON-serializable — saves are snapshots.
import type { AssetClass } from "@/data/types";

export type MarketPhase = "recovery" | "expansion" | "peak" | "recession";

export type BuiltClass = Exclude<AssetClass, "land">;
export const BUILT_CLASSES: BuiltClass[] = ["office", "retail", "multifamily", "industrial"];

export type Condition = "worn" | "standard" | "good";

/** Shares of a building's floor area by use. Sums to 1. See engine/mix.ts. */
export type UseMix = Partial<Record<BuiltClass, number>>;
/** What you can choose to build: a single use, or a mixed-use stack. */
export type DevUse = BuiltClass | "mixed";

export type Sector =
  | "finance" | "law" | "tech" | "media" | "insurance"
  | "logistics" | "apparel" | "food" | "medical" | "design";

export type Credit = 0 | 1 | 2; // C, B, A
export const CREDIT_LABEL = ["C", "B", "A"];

export interface Tenant {
  name: string;
  // Which part of the building they are in. A shop under a block of flats is
  // a retail lease in a retail market, not a "mixed-use" lease.
  use?: BuiltClass;
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
  use?: BuiltClass;    // the component of the building they want
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
  // The negotiation, Groundwork-style: you counter with a rent and a TI
  // number; they take it, walk, or counter back ONCE — and that one is final.
  stage?: "open" | "countered";
  counterRentPsf?: number;
  counterTiPsf?: number;
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
  makeReady?: { sf: number; readyM: number; use?: BuiltClass }[]; // vacated space being turned; unleasable until ready
  broker?: boolean;    // leasing broker on retainer: more LOIs, monthly fee
  occ?: number;        // multifamily aggregate occupancy
  stance?: -1 | 0 | 1; // rent posture: push / market / fill
  deliveredM?: number; // ground-up completion: new space leases with momentum
  // On the market. `countered` records that you have already been back to this
  // buyer once — a counter is a real move with a real cost, not a slider you
  // can grind, and one round per offer is what the etiquette actually allows
  // before you are wasting their afternoon.
  sale?: {
    ask: number; listedM: number; unsolicited?: boolean;
    offer?: { price: number; expiresM: number; countered?: boolean };
  };
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
  use: DevUse;
  mix: UseMix;
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
  // Tenants who signed while it was going up. Everything is built on spec now,
  // so this is earned during construction rather than bought before it — the
  // building that lets well on the way up opens covering its mini-perm, and
  // the one that lets nothing opens empty.
  signed?: { sf: number; use: string; discount: number; name: string }[];
  events: number;         // how many things have gone wrong
}

// A delivered development overrides the static parcel record.
export interface BuiltOverride {
  class: BuiltClass;
  mix?: UseMix;
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
  vac?: Record<BuiltClass, number>;
  rent?: Record<BuiltClass, number>;
  cap?: Record<BuiltClass, number>;
  abs?: Record<BuiltClass, number>;    // net absorption that month, sf
  comp?: Record<BuiltClass, number>;   // completions that month, sf
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
  // THE PIPELINE AS A QUEUE, not a number. Every start is a cohort with a
  // month it will deliver in, so the game can answer the question every
  // developer actually asks — "what is coming, and when" — instead of only
  // "how much is out there somewhere". This is what makes the supply side
  // legible: you can see the wave before it lands on you.
  cohorts?: Record<BuiltClass, { m: number; sf: number }[]>;
  completions12?: Record<BuiltClass, number>;   // trailing 12-month deliveries
  // THE MONETARY ERA. The loan index used to mean-revert at 0.03/month toward
  // a phase target between 5.0 and 7.0, clamped to 4.2-9.2 — so over a whole
  // century it never left a two-point band and rates were, in practice, a
  // constant. Real money does not behave like that: there are decades of cheap
  // money and decades of dear money, and the cycle rides ON TOP of whichever
  // era you happen to be in. rateRegime is that era; the phase supplies only a
  // deviation from it.
  rateRegime?: number;    // the secular level of money
  rateAimTo?: number;     // where the era is heading
  rateAimM?: number;      // month the era next re-rolls
  // Capital availability, 1 = normal. In a crunch this falls, spreads widen,
  // lenders size smaller, and cap rates gap out — independent of the index.
  creditIdx: number;
  // The demand driver behind leasing velocity.
  employIdx: number;
  // THE SPACE MARKET, class by class. Stock is every square foot standing;
  // occupied is every square foot with a tenant in it; their ratio is the
  // citywide vacancy that decides which side of the table has the leverage.
  // Employment pulls occupancy up, deliveries push vacancy up, and rents move
  // on the GAP between vacancy and its natural rate — the classic four-
  // quadrant model, run monthly.
  stock: Record<BuiltClass, number>;
  // what was standing on day one — the anchor the demand target is measured
  // against, so a century of building does not drag the target along with it
  baseStock?: Record<BuiltClass, number>;
  occupied: Record<BuiltClass, number>;
  cityVac: Record<BuiltClass, number>;
  absorb12: Record<BuiltClass, number>;   // trailing 12-month net absorption, sf
  // EACH CLASS HAS ITS OWN CYCLE. sectorMom was an AR walk with a +/-0.02 cap
  // and noise so small it sat at a tenth of that forever — the classes moved
  // together, as one market wearing four labels. Now every class runs an
  // explicit boom / steady / bust clock of its own, so office can be three
  // years into a bust while apartments are booming, which is the ordinary
  // condition of a real property market.
  sectorPhase?: Record<BuiltClass, "boom" | "steady" | "bust">;
  sectorPhaseM?: Record<BuiltClass, number>;   // months left in it
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

/**
 * A black mark on the sponsor's record. Real estate is a small business at the
 * top: the same twenty lenders see every deal, and a foreclosure follows a
 * name around for a decade. This is how leverage acquires a memory — without
 * it, maximum leverage was a free option, because handing back a non-recourse
 * asset cost you the asset and nothing else.
 */
export interface SponsorEvent {
  m: number;
  kind: "forced" | "deficiency" | "seized";
  address: string;
  amount: number;      // the hole left behind, if any
}

export type RivalStyle = "core" | "opportunistic" | "developer" | "family";

/**
 * A competing firm. Aggregate balance sheet, real portfolio — enough to bid
 * against you, to overreach, and to fail, without carrying a rent roll and a
 * loan stack for every building in town.
 */
export interface Rival {
  id: string;
  name: string;
  style: RivalStyle;
  cash: number;
  debt: number;
  bbls: string[];        // what they own
  targetLtv: number;
  bornM: number;
  aum?: number;          // marked each month, for display
  stressMs?: number;     // consecutive months in trouble
  distributed?: number;  // lifetime cash sent out to their partners
  failedM?: number;      // the month they stopped existing
}

/** Who is on the other side of the table, and therefore what they want. */
export type SellerKind = "estate" | "institution" | "partnership" | "developer" | "local" | "lender";



export interface GameState {
  v: 20;
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
  lastUnsolicitedM?: number;                 // when somebody last rang unbidden
  // A LIVE NEGOTIATION TO BUY. One at a time, like escrow, because that is how
  // many deals a principal is actually working at this size.
  talks?: Talks;
  // THE CITY'S OWN SITES. Other people's buildings used to appear finished,
  // the month they were decided, adding their square feet to the market on the
  // spot. Nothing in a city works that way: the decision to build is taken in
  // one market and the building arrives in a different one, and that lag is
  // the entire reason property cycles overshoot. A city job is a hole in the
  // ground with a delivery date, and its space is in the pipeline from the day
  // it starts — visible on the Economy page long before it competes with you.
  cityJobs?: { bbl: string; use: string; sf: number; floors: number; startM: number; deliverM: number }[];
  landAdj: Record<string, number>;           // per-parcel land value multiplier
  blockD: Record<string, number>;            // per-block demand DRIFT, in points off the generated score
  // What the lending market remembers about you. A sponsor who hands back keys
  // does not get to walk into the next credit committee unrecognised.
  sponsor: { events: SponsorEvent[] };
  rivals: Rival[];                           // the other firms on the street
  lenderRel: Record<string, number>;         // lender name -> relationship 0-100; a trusted name is worth basis points
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

/**
 * A NEGOTIATION IN PROGRESS.
 *
 * Buying used to be one roll of a die: you named a number, an invisible seller
 * rolled against it, and a refusal told you nothing and left you nothing to do
 * except name another number and roll again. There was no counterparty in the
 * room and no way to read one.
 *
 * A negotiation is a conversation with a state: their number, your number, how
 * many times you have been round, and how much patience is left. You can see
 * the gap closing or not closing, which is the whole skill.
 */
export interface Talks {
  bbl: string;
  sellerKind: SellerKind;
  sellerName: string;
  product: string;         // how you would fund it, carried through to escrow
  lev: number;
  yourPrice: number;       // your last offer
  theirPrice: number;      // their last counter — their ask, until they move
  round: number;           // how many times you have been back
  maxRounds: number;       // what this seller will tolerate
  openedM: number;
  final?: boolean;         // they have said take it or leave it
  note: string;            // what they said, in words
}

export const START_CASH = 6_000_000;
export const START_YEAR = 2000;
// The century is a MILESTONE, not a wall. A hundred years used to end the run
// on the spot, which turned the back half of a good campaign into a countdown
// and threw away the most interesting book in the game the moment it was
// finished being built. The clock keeps running; the century is something you
// pass, and the ledger closes when you lose it or choose to stop.
export const CENTURY_MONTHS = 1200; // Jan 2000 to Jan 2100

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function monthLabel(m: number): string {
  return `${MONTH_NAMES[((m % 12) + 12) % 12]} ${START_YEAR + Math.floor(m / 12)}`;
}
