// The simulation state. Everything the game knows that isn't static parcel
// data lives here, and it must stay JSON-serializable — saves are snapshots.
import type { AssetClass } from "@/data/types";
import type { Lender } from "./lenders";

export type MarketPhase = "recovery" | "expansion" | "peak" | "recession";

export type BuiltClass = Exclude<AssetClass, "land">;
export const BUILT_CLASSES: BuiltClass[] = ["office", "retail", "multifamily", "industrial"];

/**
 * FOUR GRADES, NOT THREE, because three had a floor and a floor is a free lunch.
 *
 * `worn` was the terminal state of neglect — the decay ladder in leasing.ts
 * returned null there — so a building that reached it could never get worse.
 * Measured on New Alden: 571 of 1,042 built parcels, 55% of the stock, START
 * worn, because initialCondition calls anything built before 1965 worn and the
 * campaign opens in 2000. Worn also carries a +70bp cap spread, so it is the
 * highest-YIELDING stock in the city. Buy the best yield on the tape and never
 * spend a dollar was, quite literally, the strategy of buying the assets the
 * engine had promised never to punish.
 *
 * `obsolete` is what actually happens to a building nobody puts money into: the
 * plant is finished, the market has stopped calling, and what is left is worth
 * the dirt. Nothing STARTS obsolete — initialCondition never returns it and
 * initialCondIdx floors above it. You have to earn it.
 */
export type Condition = "obsolete" | "worn" | "standard" | "good";

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
  // WHEN IT LANDED, which is not the same question as when it dies. A letter
  // you have had on the desk since spring is not somebody at the door — it is
  // your own unfinished business — and the broker who decides whose afternoon
  // is free does not count it as one.
  arrivedM?: number;
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
  /**
   * WHICH TOUR THIS PARTY IS ON.
   *
   * A vacant suite in a tight market is being shown to two or three people at
   * once, and you can only have one of them. Letters sharing a tourId are
   * chasing the SAME square feet: signing one sends the others elsewhere, and
   * going back to one with a counter makes the others impatient. Undefined on
   * renewals (the incumbent is not competing with anybody) and on anything
   * written before this existed.
   */
  tourId?: number;
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
  /**
   * MONTHS IN BREACH, CONSECUTIVELY.
   *
   * A swept loan used to be able to sit broken forever — the counter reset
   * every month it was still broken, so nothing downstream of a covenant
   * breach ever happened. Two years of this and the lender stops waiting and
   * opens a file, which is the covenant cause the workout desk declares and
   * previously had no way to reach.
   */
  breachMs?: number;
  /**
   * MONTHS THE PAYMENT DID NOT ACTUALLY GET MADE.
   *
   * `arrears` was declared as a workout cause in this file and could never
   * happen: nothing anywhere detected a missed payment, because debt service
   * is taken centrally and the player's cash simply goes negative. So the
   * workout desk's own copy about arrears was dead text, and the only route to
   * a foreclosure file was a blown balloon.
   *
   * A lender does not see your other buildings. What they see is a payment
   * that did not arrive — which is this building failing to cover its own debt
   * service while the borrower has no cash to make up the difference.
   */
  arrearsMs?: number;
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
  /**
   * The label. It is a READING of condIdx below, recomputed every month — see
   * condGrade in value.ts. Kept as a string because every consumer in the
   * engine (rent multiplier, cap spread, lender minimums, leasing odds, bundle
   * discount) reads a grade, and a grade is what a broker actually says.
   */
  condition: Condition;
  /**
   * THE BRICKS, 0.20 to 0.97. Falls every month; a capital plan and a capital
   * programme push it back up. This is the player's half of the model the
   * street has always had — see tickAssetManagement in rivals.ts, whose own
   * comment claims the firms that skip the plan are "marked down for it exactly
   * the way the player is". They were not. Now they are.
   */
  condIdx?: number;
  /** Last month the capital plan went unfunded, because the money was short. */
  planCutM?: number;
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
  /** When a marketed campaign on this deed was last pulled. The market remembers. */
  lastCampaignM?: number;
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
  /**
   * THE DAY-ONE CHEQUE, STILL SITTING IN THE JOB.
   *
   * startDevelopment takes equityAtClose out of your account and marked it as
   * equity SPENT — which retired budget without paying for a single hour of
   * work. The S-curve then went on to spend the whole build cost on top of it,
   * so uses exceeded sources by exactly (equityAtClose − leaseUpReserve) and
   * that difference fell through as an unannounced capital call in the last
   * months before delivery. Measured at 1.33x to 1.51x the equity the panel
   * promised, and 2.43x to 2.75x the day-one figure.
   *
   * The cheque is money ON DEPOSIT against the budget. This is how much of it
   * the job has not yet drawn down.
   */
  equityPrefunded?: number;
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
  /**
   * WHOSE BUILDING THIS IS, while it is on the market.
   *
   * The distress paths used to strip the deed out of a firm's book before
   * pushing the listing, so the most interesting sellers in the game — the
   * ones under pressure, and the dead ones being wound up — arrived at the
   * table as "a special servicer clearing a book". The news would say Kestrel
   * Capital was selling and then you negotiated with nobody.
   */
  sellerId?: string;
  /** Set when a receiver is clearing a failed firm's book, so it still reads. */
  receiverFor?: string;
}


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
/**
 * A PORTFOLIO IN THE MARKET.
 *
 * One process, many deeds. The ask is for the bundle; the indications are for
 * the bundle; and at the closing table the number is allocated across the
 * deeds pro rata to value, because that is what the schedule to a purchase and
 * sale agreement actually looks like.
 */
export interface PortfolioSale {
  bbls: string[];
  ask: number;
  listedM: number;
  /** What the buildings were worth one at a time on the day it was listed. */
  sumOfParts: number;
  bids: { name: string; price: number; expiresM: number; countered?: boolean }[];
  /** They came to you. Those bids carry a premium and a short fuse. */
  unsolicited?: boolean;
}

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
  /**
   * YOU INSULTED THEM, AND WHEN THEY WILL TAKE YOUR CALL AGAIN.
   *
   * The lowball penalty used to be a news item and nothing else: talks were
   * deleted, the seller "ended it", and the player pressed Offer again in the
   * same month and went under contract at 94. A cost you can undo in one click
   * is not a cost. This is the month the door reopens, and until it does no
   * offer on this building is answered by anybody.
   */
  insultedUntilM?: number;
  /** How much their floor moved because of it, and it does not move back. */
  soured?: number;
}

/** A claim the city makes about you, computed from state, with a date on it. */
export interface Epithet {
  id: string;
  text: string;
  sinceM: number;   // the month it first became true
  weight: number;   // 0-1, how quotable
}

/**
 * WHO YOU ARE, AND HOW WELL THE TOWN KNOWS IT.
 *
 * The player was the string "You" — in the comps sheet, on the league table,
 * in every news item. Twelve rival firms had names and a paper trail; the
 * protagonist had a pronoun, which is why thirty years in the game still
 * sounded like year one.
 */
export interface FirmIdentity {
  name: string;       // "Corbin & Co."
  short: string;      // "Corbin" — for tables and comps
  foundedM: number;
  epithets: Epithet[];
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
  /**
   * SQUARE FEET THE SPACE MARKET HAS ASKED FOR AND THE MAP HAS NOT YET BUILT.
   *
   * The economy used to decide how much the city should build and drop it
   * straight into an anonymous cohort queue, while the map placed buildings by
   * a completely separate rule. Over fifty years the market grew the city 60%
   * and the map gained four buildings — twenty-eight times more floor area
   * existed in the rents than on the ground.
   *
   * Now it is a debt the map owes, worked off lot by lot. A burst of demand is
   * followed by a burst of cranes and then a quiet stretch, which is also how
   * a real pipeline behaves.
   */
  startOwed?: Record<BuiltClass, number>;
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
  dumped?: number;       // buildings hit the tape in the CURRENT stress episode
  taxPaid?: number;      // lifetime income + gains tax
  distributed?: number;  // lifetime cash sent out to their partners
  failedM?: number;      // the month they stopped existing
  // A CASH SHORTFALL IS NOT A FAILURE WHILE THERE IS ROOM ON THE BOOK.
  // Lifetime draw on their own credit, for the street table — a firm running
  // on its revolver is a firm you should be watching.
  revolver?: number;
}

/**
 * WHAT YOU AND A FIRM HAVE ACTUALLY DONE TO EACH OTHER.
 *
 * Measured: in a fifty-year run the player closes with nine distinct named
 * firms and deals with five of them more than once — and none of it was
 * written down anywhere, so every conversation started from nothing and the
 * street stayed a set of strangers who happened to keep appearing.
 *
 * This is the ledger. It moves on actions the player already takes, it is
 * never asked about, and it changes their number and whose buildings the
 * broker rings about.
 */
export interface StreetTie {
  deals: number;      // buildings traded between you, in either direction
  beats: number;      // times they came over the top of you on a live deal
  insults: number;    // times you opened a conversation with a number they refused
  lastM: number;
}

/**
 * A SPECIFIC CORNER A SPECIFIC FIRM TOOK OFF YOU.
 *
 * Kept so that when they finally let it go — ten years later, into strength or
 * out of a receivership — the game can put it in front of you before the tape
 * and say whose it was and what they paid. That is the difference between a
 * rival and a name in a news line.
 */
export interface Beat {
  bbl: string;
  firmId: string;
  firm: string;
  m: number;
  yours: number;      // your last offer
  theirs: number;     // what they paid to end the conversation
}

/** Who is on the other side of the table, and therefore what they want. */
export type SellerKind = "estate" | "institution" | "partnership" | "developer" | "local" | "lender";



export interface GameState {
  v: 25;
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
  /** Source of tour ids — see LOI.tourId. Letters on one tour share a number. */
  nextTourId?: number;
  /**
   * HOW MANY MONTHS RUNNING NOBODY HAS BEEN AT THE DOOR.
   *
   * Measured over six fifty-year runs of competent play, 69.8% of months had
   * nothing new arrive, the first decade ran at 87%, and the longest silence
   * was 41 consecutive months — because every inbound channel in this engine
   * is gated on the SIZE of your book. This is the counter that lets one
   * channel be gated on the opposite: a broker rings the principal who has
   * money and an empty afternoon. Reset by a letter, an offer, a bid list, an
   * off-market call or a live negotiation — not by a balloon you have known
   * about since spring, which is your own book, not somebody at the door.
   */
  quietMs?: number;
  approaches: Record<string, Approach>;
  /**
   * WHEN EACH BUILDING LAST CHANGED HANDS.
   *
   * refreshListings picked a random parcel with no memory of what had just
   * traded, so a building absorbed by the market came straight back onto the
   * tape. Instrumented over fifty years: 68 E 10th St was "sold to a buyer
   * from out of town" THIRTY-ONE TIMES, 116 W 4th St twenty-nine — the same
   * addresses, sold by nobody to nobody, forever. That is the single loudest
   * reason the news tape reads as a generator rather than as a city.
   *
   * Buildings are held for years. This is the month one last traded, and
   * refreshListings will not put it back on the market until somebody could
   * plausibly have owned it and moved on.
   */
  lastTradeM?: Record<string, number>;
  developments: Record<string, Development>;
  built: Record<string, BuiltOverride>;      // delivered buildings, yours and the city's
  cityBuilt: string[];                       // bbls the market built, not you
  lastUnsolicitedM?: number;                 // when somebody last rang unbidden
  // A LIVE NEGOTIATION TO BUY. One at a time, like escrow, because that is how
  // many deals a principal is actually working at this size.
  /**
   * EVERY CONVERSATION YOU ARE IN, keyed by BBL.
   *
   * This was one Talks, singular, and negotiate() opened with a hard refusal:
   * "You are mid-negotiation at 42 Pearl St. Finish it or walk away first."
   * Nobody buys buildings that way. A principal is in four conversations at
   * once, drops the two that will not move, and takes whichever of the rest
   * comes back at a number worth funding — the CHOOSING is the job, and the
   * old model deleted it by only ever offering one option.
   */
  talks?: Record<string, Talks>;
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
  // THE DEMAND SURFACE. `blockD` is the live offset every economic reader uses;
  // it is the SUM of the two things below and is the only one anybody outside
  // engine/demand.ts should touch.
  blockD: Record<string, number>;            // per-block demand offset, in points off the generated score
  /** the day-one reconciliation between what is standing and what gravity said. PERMANENT. */
  blockA?: Record<string, number>;
  /** the emergent drift since 2000: what has been built, who is hiring, what opened. */
  blockE?: Record<string, number>;
  /** a block's employment advantage in demand points — its trades against the city's */
  blockJ?: Record<string, number>;
  /** funded transit. Announced, dug, opened; the ground reprices at each step. */
  lines?: { id: string; cx: number; cy: number; name: string; annM: number; openM: number; pts: number }[];
  // What the lending market remembers about you. A sponsor who hands back keys
  // does not get to walk into the next credit committee unrecognised.
  sponsor: { events: SponsorEvent[] };
  rivals: Rival[];                           // the other firms on the street
  /** What has passed between you and each firm. See StreetTie. */
  street?: Record<string, StreetTie>;
  /** Corners the street took off you, newest first, capped at 24. */
  beaten?: Beat[];
  /** The desks, with books you can open. See engine/lenders.ts. */
  lenders?: Lender[];
  /** Loans in default and what is being done about them. See engine/workout.ts. */
  workouts?: Record<string, Workout>;
  /** A bundle of buildings in the market as one trade. See engine/portfolio.ts. */
  portfolioSale?: PortfolioSale;
  /** Your firm's name, and what the city has worked out about it. See engine/firm.ts. */
  firm?: FirmIdentity;
  /** Buildings you have put up. Drives the "builder" epithet. */
  delivered?: number;
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
  /**
   * EARNEST MONEY, AND IT IS HARD.
   *
   * The expiry notice already said the seller "kept the deposit's worth of
   * goodwill" — describing a deposit that did not exist. Nothing was ever
   * posted, so signing a contract cost nothing and failing to fund one cost
   * nothing either, which is the whole reason you could not be trusted with
   * more than one at a time: the game had to stop you at the door because it
   * had no way to make the consequence real once you were through it.
   *
   * Post it and both problems go away. You can chase four buildings at once,
   * as anybody in this business does — and you can only sign what you can put
   * money behind, and only fund what you can actually fund. It is credited at
   * closing and gone if the clock runs out.
   */
  deposit?: number;
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

/**
 * THE CAPITAL PLAN, as a share of gross asset value a year.
 *
 * Roofs, lifts, plant, the things that do not appear in an operating statement
 * and do not stop needing doing. It is charged automatically, every month, on
 * every building, because no owner writes this cheque one line item at a time
 * and asking the player to would be a chore rather than a decision. It lands on
 * the existing `capex` line in the Books.
 *
 * It is deliberately NOT enough on its own to hold an old building level. It
 * buys you time; the programmes in dev.ts buy you a grade. That is the whole
 * shape of the decision — the plan is the floor, the programme is the choice.
 */
export const CAP_PLAN_RATE = 0.0034;
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

/**
 * A LOAN THAT HAS STOPPED WORKING, and the conversation that follows.
 *
 * A default used to be an event: the balloon came due, you could not pay, the
 * building was sold at a distress price in the same tick and it went on your
 * record. That is the ENDING of a foreclosure, not a foreclosure — everything
 * interesting about being in trouble happens in the eighteen months before it,
 * across a table, with a lender who has their own problems.
 */
export interface Workout {
  bbl: string;
  lender: string;
  startM: number;
  /** notice -> the clock is running; forbearance -> you bought time; foreclosure -> they have filed. */
  stage: "notice" | "forbearance" | "foreclosure";
  cause: "balloon" | "covenant" | "arrears";
  /** What has to be paid, or the loan balance if it is the whole thing. */
  cure: number;
  /** The month it is decided one way or the other. */
  decideM: number;
  /** How many times you have been to them about this building. */
  asks: number;
  missedMs: number;
}
