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
  /**
   * SECURITY. One to two months of rent, taken at signing and held against the
   * space coming back damaged or the tenant walking. It arrives as cash and it
   * is NOT income — it is a liability that sits on your balance sheet until
   * the lease ends, and net worth is quoted net of it. A landlord with a
   * hundred tenants is holding a real number here, and it flatters the bank
   * balance of anybody who forgets that.
   *
   * Forfeited on a default, returned on an ordinary expiry, and handed to the
   * buyer when the building trades.
   */
  deposit?: number;
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
  // What YOU asked for, kept so the card can show the conversation rather than
  // silently overwriting the opening terms with the answer.
  askedRentPsf?: number;
  askedTiPsf?: number;
  openRentPsf?: number;   // their original number, before any of this
}

/**
 * HOW THE TENANT ANSWERED.
 *
 * A counter used to resolve into a three-second toast and a card that vanished
 * off the grid, so the single most consequential leasing decision in the game
 * gave no account of itself. The reply is a record now: what you asked, what
 * they did about it, and what it cost or saved — and it sits on the deals
 * screen until you have read a few more of them.
 */
export interface LeaseReply {
  m: number;
  bbl: string;
  address: string;
  name: string;
  outcome: "took" | "walked" | "countered";
  askedRentPsf: number;
  theirRentPsf: number;   // what they had offered, or came back with
  askedTiPsf: number;
  theirTiPsf: number;
  sf: number;
  marketPsf: number;
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
  // Somebody else's building stands on this dirt. It earns ground rent instead
  // of costing carry, and it is not yours to build on until the term is up.
  groundLeased?: boolean;
  // Designated. No demolition, no bigger building, a rent premium forever.
  landmarked?: boolean;
  // PRE-BUILT SPACE. Suites fitted out speculatively, before anyone has signed
  // for them: the fastest-leasing product in the market, because a tenant who
  // can move in next month does not need six months of drawings and a fit-out
  // allowance. It costs the fit-out up front on space that may sit.
  specSuites?: { sf: number; readyM: number; use: BuiltClass };
  occ?: number;        // multifamily aggregate occupancy
  stance?: -1 | 0 | 1; // rent posture: push / market / fill
  /**
   * STOP LETTING IT.
   *
   * You cannot knock a building down with people in it, and you cannot empty
   * it by accident — an owner heading for a demolition or a gut stops signing
   * anybody new and stops renewing anybody rolling, and then waits out the
   * roll. It is a real and painful decision: the building bleeds income for
   * years before it is worth anything as a site.
   */
  leasingHold?: boolean;
  deliveredM?: number; // ground-up completion: new space leases with momentum
  // On the market. `countered` records that you have already been back to this
  // buyer once — a counter is a real move with a real cost, not a slider you
  // can grind, and one round per offer is what the etiquette actually allows
  // before you are wasting their afternoon.
  /**
   * ON THE MARKET — and how.
   *
   * `quiet` is what this used to be and all it used to be: put a number on the
   * building and wait for somebody to ring. It is cheap, it is slow, and one
   * bidder at a time means you never find out what the best buyer in the city
   * would actually have paid.
   *
   * `marketed` is a process. You appoint a broker, publish a whisper price,
   * run a campaign for a few months, and set a date for offers. On that date
   * you get a BID LIST — names and numbers, all at once — and you can take the
   * best of it or go back to the top of it for best and final, which usually
   * lifts the number and sometimes loses you a bidder. It costs a point more
   * in fees and it is the only way to find the top of the market.
   */
  sale?: {
    ask: number; listedM: number; unsolicited?: boolean;
    mode?: "quiet" | "marketed";
    callM?: number;                    // when offers are due
    bids?: Bid[];                      // the list, once they are in
    round?: number;                    // 0 first round, 1 best and final
    offer?: { price: number; expiresM: number; countered?: boolean; from?: string; retrade?: string };
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
  /** How you chose to demise it, sf per space per use. Carried to delivery. */
  suites?: Partial<Record<BuiltClass, number>>;
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
  // THE LEASE-UP RESERVE, held back rather than poured into the slab. It is
  // financed with the rest of the job but it is not spent building anything —
  // it is the fit-out, the commissions and the carry that fill the building
  // after it opens, and it is released as cash on the day it does.
  leaseUpReserve?: number;
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
  /** sf per leasable space, per use — the programming decision you made. */
  suites?: Partial<Record<BuiltClass, number>>;
}

export interface Listing {
  bbl: string;
  ask: number;
  listedM: number;
  expiresM: number;
  distress?: boolean;  // motivated seller — priced under appraisal, goes fast
  // A SITE WITH A FRAME ON IT. The sponsor could not finish, the receiver is
  // clearing it, and whoever buys inherits the steel that is already up and
  // the bill for the rest. Buying one starts a development at that progress
  // rather than at a hole in the ground.
  halfBuilt?: { use: string; sf: number; floors: number; progress: number; costToComplete: number };
}

/**
 * SOMEBODY ELSE'S MONEY IN ONE OF YOUR BUILDINGS.
 *
 * A limited partner owns `lpShare` of the equity, is owed `prefPct` a year on
 * whatever of their capital has not come back, and gets everything before you
 * do. Your compensation for running it is the `promotePct` you take out of
 * their profit once they are whole — which is worth nothing at all on a deal
 * that does not clear the pref, and is most of a career on the ones that do.
 */

import type { Comp } from "./comps";

/**
 * A GROUND LEASE YOU HAVE GRANTED.
 *
 * Somebody else's building on your land, for a very long time. You take a
 * coupon on the land value with fixed step-ups and no operating risk at all —
 * no tenants, no roof, no vacancy — and in exchange the site is not yours to
 * build on or to sell unencumbered until the term runs out. It is the one way
 * to make a land bank earn its carry, and the one way to be certain you will
 * miss the cycle that would have made it worth building on.
 */
export interface GroundLease {
  bbl: string;
  startM: number;
  endM: number;
  rentYr: number;       // today's ground rent, before the next step
  stepPct: number;      // the review, every `stepEveryM` months
  stepEveryM: number;
  lastStepM: number;
  tenant: string;
}

/**
 * One name on a bid list. `credibility` is the thing a seller is actually
 * judging: an aggressive number from a buyer who cannot fund it, or who reads
 * the building harder after they win, is worth less than a slightly lower one
 * that closes. It is what decides whether they retrade you.
 */
export interface Bid {
  name: string;
  price: number;
  credibility: number;   // 0-1
  note: string;
  dropped?: boolean;     // walked at best and final
  countered?: boolean;   // you have already been back to this one privately
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
  population?: number;
  jobs?: number;
  unemployment?: number;
  wageIdx?: number;
  outputIdx?: number;
  cpi?: number;
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
  /**
   * THE CITY, NOT THE ASSET CLASSES.
   *
   * The sector breakdowns were good and the thing underneath them was a single
   * `employIdx` nobody could see. A property market is downstream of a real
   * economy — how many people live here, how many of them work, what they earn
   * in real terms, and what the place produces. Those four numbers explain
   * every rent in the game and none of them were on a screen.
   *
   * All of it is derived from the cycle rather than simulated separately: jobs
   * follow the phase, wages follow jobs with a lag and a productivity drift,
   * population follows jobs slowly because people move for work and move back
   * reluctantly, and output is the product of the two. They are honest
   * consequences, not decoration — the demand behind every lease you sign.
   */
  population?: number;        // souls in the city
  jobs?: number;              // filled positions
  unemployment?: number;      // 0-1, of the labour force
  wageIdx?: number;           // real wage, 1.0 at the start of the century
  outputIdx?: number;         // real output; jobs x productivity
  cpi?: number;               // the price level, for turning nominal into real
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
  // WHAT THE TENANTS DO FOR A LIVING.
  //
  // The classes have had their own cycles for a while. The INDUSTRIES inside
  // them did not — ten sectors existed and the engine read them exactly twice,
  // both times to copy a name onto a lease. So a rent roll seventy per cent
  // let to finance was not a bet on finance, a tech bust took nobody with it,
  // and concentration was a word with no mechanism behind it.
  //
  // Each industry now runs its own boom / steady / bust clock on its own
  // volatility — tech and media swing hard, insurance and medical barely move
  // — independent of the asset class that houses them. An office building let
  // to five law firms and one let to five startups are different assets, and
  // this is the difference.
  industryMom?: Record<Sector, number>;
  industryPhase?: Record<Sector, "boom" | "steady" | "bust">;
  industryPhaseM?: Record<Sector, number>;
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
  // What month it is. The space market needs the calendar to tell a building
  // that opened last year from one that opened in 1928.
  m?: number;
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
  interest: number; // what the bank paid you on idle cash — never property income
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
  // Cost basis of the book, in aggregate. Not per building — that is the one
  // thing about a rival's accounts nobody needs to see — but enough to tax a
  // gain honestly when they sell, which is a cost the player has always paid
  // and the street never did.
  basis?: number;
  // WHAT THEIR BUILDINGS ARE ACTUALLY DOING. A rival's assets used to be
  // marked at market occupancy in birth condition forever, which meant the
  // street could only ever be hurt by the macro cycle — no rival ever lost a
  // tenant, ran a building into the ground, or had a bad leasing year, and the
  // player was the only participant in the city exposed to asset management.
  // One occupancy and one condition index across the book is enough to make
  // them mortal without giving twelve firms a rent roll each.
  occ?: number;          // portfolio occupancy, 0-1
  mktOcc?: number;       // what the market says their book should run at
  condIdx?: number;      // how well they look after the bricks, 0-1
  capexYr?: number;      // what they spent on the buildings this year
  taxPaid?: number;      // lifetime income + gains tax
  distributed?: number;  // lifetime cash sent out to their partners
  failedM?: number;      // the month they stopped existing
}

/** Who is on the other side of the table, and therefore what they want. */
export type SellerKind = "estate" | "institution" | "partnership" | "developer" | "local" | "lender";



export interface GameState {
  v: 20;
  seed: number;
  /**
   * WHICH TOWN THIS WAS PLAYED IN.
   *
   * The island is fixed and the town on it is generated from this number:
   * every block, every lot line, every building. A save without it refers to
   * deeds in a city that no longer exists, so it travels with the game and
   * the city is rebuilt from it on load — six digits instead of two megabytes
   * of parcel table.
   */
  citySeed?: number;
  rng: number;
  month: number;
  cash: number;
  econ: Econ;
  holdings: Record<string, Holding>;
  listings: Listing[];
  lois: LOI[];
  leaseReplies?: LeaseReply[];               // the last few answers to your counters
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
  // EVERY CRANE IN THE CITY, INCLUDING THE ONES WITH A NAME ON THEM.
  //
  // This was the anonymous city's pipeline. It still is — most jobs belong to
  // nobody in particular — but a developer on the street can now claim one:
  // they buy the dirt, write the equity, carry the construction loan, and own
  // the building on the day it opens. `firmId` is the difference between "a
  // building went up" and "Alden Development Co. got to that corner first".
  cityJobs?: {
    bbl: string; use: string; sf: number; floors: number; startM: number; deliverM: number;
    firmId?: string;      // whose job it is; absent means the anonymous city
    cost?: number;        // the budget, for a firm's job
    spent?: number;       // work in place to date
    equityLeft?: number;  // their equity still to go in
    debt?: number;        // construction balance, drawn plus capitalised interest
    ratePct?: number;
    orphaned?: boolean;   // the sponsor died and the frame is standing there
    listedM?: number;     // when the receiver put the frame on the tape
  }[];
  // Named starts owed back against the city's calibrated build rate — see
  // tickCityGrowth. A month with two rival groundbreakings is followed by
  // quiet ones, so the town grows at the pace its vacancy supports.
  startDebt?: number;
  // ASSEMBLAGE. Child parcel -> the lot it has been merged into. The child
  // keeps its deed and its shape on the map; its land area, its value and its
  // buildable envelope have all moved to the parent, which is what assembling
  // a site actually does. See actions.assembleLots.
  merged?: Record<string, string>;
  // GROUND LEASES you have granted on your own dirt, by parcel.
  groundLeases?: Record<string, GroundLease>;
  // ZONING MOVES. A district's envelope multiplier, an extra FAR you won at a
  // hearing on one site, an application waiting on the board, and the
  // buildings nobody is allowed to knock down. See engine/zoning.ts.
  zoneAdj?: Record<string, number>;          // district -> FAR multiplier
  variance?: Record<string, number>;         // bbl -> extra FAR granted
  /**
   * WHAT THE BOARD SAID, and when.
   *
   * A hearing is a year of your life and several hundred thousand dollars, and
   * the answer used to arrive as one line of news that scrolled away in a
   * quarter. It is a fact about the site now: recorded on the parcel and shown
   * on the land panel for years afterwards, the way a refusal actually sits
   * over a property while everybody waits for the board to change its mind.
   */
  varianceLog?: Record<string, { m: number; granted: boolean; far: number; cost: number }>;
  varianceApp?: { bbl: string; filedM: number; decideM: number; cost: number; grant: number; odds: number };
  landmarks?: Record<string, number>;        // bbl -> month designated
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
  // Every deed that has moved in this city, with the price. See comps.ts —
  // an appraisal is an opinion and a closed sale is a fact.
  comps?: Comp[];
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
    e = { yr, noi: 0, debtSvc: 0, leasing: 0, capex: 0, dev: 0, taxes: 0, bought: 0, sold: 0, ga: 0, interest: 0 };
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
  yourPrice: number;       // your last offer
  theirPrice: number;      // their last counter — their ask, until they move
  round: number;           // how many times you have been back
  maxRounds: number;       // what this seller will tolerate
  openedM: number;
  final?: boolean;         // they have said take it or leave it
  note: string;            // what they said, in words
  // UNDER CONTRACT. A price is agreed and nothing has moved yet: the deed is
  // reserved, the property is off everybody else's tape, and you have until
  // `closeByM` to place the debt and fund the equity. This is the whole reason
  // the negotiation no longer asks for a lender — you do not arrange financing
  // to make an offer, you arrange it because you have a deal.
  agreed?: boolean;
  agreedPrice?: number;
  closeByM?: number;
}

export const START_CASH = 6_000_000;
export const START_YEAR = 2000;
/**
 * WHAT A BANK BALANCE EARNS. One per cent a year, on positive balances, for
 * everybody in this city — you and every firm on the street.
 *
 * It used to float with the loan index, two and a half points under it, which
 * was defensible and wrong for what this game is about: in a high-rate decade
 * the safest position in the model quietly became one of the best, and the
 * player who did nothing compounded against the player who underwrote. A flat,
 * unexciting deposit rate is the point. Cash is a place to stand between
 * decisions, not a position — and the whole thesis of owning buildings is that
 * a bank account does not keep up.
 */
export const CASH_APY = 0.01;
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
