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
// STAGE 1 WAS A SHADOW (it followed the engine's aggregates). SINCE ONE
// ECONOMY STEP 2 (2026-10-28) THE REGISTER IS THE TOWN'S PEOPLE: its earners
// in work are the town's jobs, its jobless its unemployment, its households'
// members its population and age mix, its renter households what the flats'
// demand reads (economy.ts `economyToEngine`, read by market.ts a month on).
// The island's renters are one for one with the flats the street's rolls have
// let, drawn from — and returned to — the region's renter households across
// the water; households buy and sell homes (`tickTenure`); they arrive for the
// work the town's own people did not take and leave when out of it. It draws
// on its own random stream (`s.streams.households`).
//
// STAGE 2 (2026-10-29): THE HOUSEHOLDS DECIDE. Each renter household chooses
// an island flat or one across the water by rent, commute, pay and its own
// taste, and the flats' demand is the households that choose the island
// (`islandWant`, read by market.ts) — not the region's renters; at its lease
// end each decides to renew, buy (`buyCheck`: the cash, the payment, owning
// against renting), take a flat across the water, or move for the reasons
// the register does not model; the builders' sales are its buyers; grown
// children work and leave home to form households; evictions follow dollars
// owed, not a month a dollar short; and each move-out from the player's
// flats is written to the cause ledger (why.ts) with its reason.
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
import { HH_RENT_SHARE0, shortIndexOf, recordDeal } from "./market";
import { resolveRecBare, useRentableSf } from "./value";
import { flatUnitSf } from "./streetRolls";
import { HH_SIZE, INCOME_SIGMA, TAX_INS, DTI, COMMUTE, REF_HOME, medianIncome, mortgageRate, fundamentalHomePsf } from "./homeprice";
import { why } from "./why";
import { whyIndustry, whyFirmLoss, firmNamesOf } from "./economy";
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
/**
 * RENEW OR MOVE (households stage 2, 2026-10-29). A renter whose lease ends
 * decides: it buys if it can (`tryBuy`), it leaves the island if the flat no
 * longer beats a flat across the water at the renewal rent and its commute
 * (`islandPull`), it leaves town when out of work (`matchJobs`), and it moves
 * for the reasons this register does not model at RESID_MOVE. The CPS ASEC
 * reasons for moving (2019, all movers): change in marital status ~5%, other
 * family reasons ~12%, wanted a new or better home ~15%, a better
 * neighbourhood ~4%, other housing reasons ~8%, other ~12% — about 56% of all
 * moves, none of them a choice this register makes — of the ~45% of renter
 * households that move in a year (NMHC; Census AHS) = 0.25 [S~]. Such a mover
 * still wants an island flat, so most of these are moves from one island flat
 * to another (turnover without a household less). Replaces leasing.ts
 * MF_TURNOVER and the street's 0.22 + out + buy + jobs (FORMULA_LEDGER #11).
 */
const RESID_MOVE = 0.56 * 0.45;
/**
 * OWNERS WHO MOVE: about 5% of owner households a year (CPS ASEC geographic
 * mobility 2015-19), and about a third of those movers rent where they land:
 * 1.7% a year sell and rent again; the other 3.3% buy again — repeat buyers,
 * who are no change of tenure but are half the market a builder sells into
 * (`buyers`, homeprice.ts salesPace). [S~]
 */
const SELL_YR = 0.017, REBUY_YR = 0.05 - SELL_YR;
/**
 * WHAT A FIRST HOME TAKES (households stage 2, replaces the tenure index and
 * its hazard, FORMULA_LEDGER #12). A renter with work buys at a decision (its
 * lease end; a renter across the water on its lease's anniversary) when it
 * can: the cash for the down payment and the closing (FHA's 3.5% minimum, the
 * common first-time loan; closing costs about 3% — ClosingCorp, CFPB) [S],
 * a payment inside the lender's front-end ratio (DTI, homeprice.ts) on a
 * starter home — the bottom tier of the region's houses, about 60% of the
 * standard new house (Zillow ZHVI bottom tier against the middle, 2015-24)
 * [S~] — and a credit record a lender will take (band 3, deep subprime, is
 * under FHA's 580 floor). Then it compares what owning costs a month (the
 * mortgage rate, tax and insurance, upkeep at 1% a year — the AHS puts
 * routine maintenance near 1-1.5% of value — less the price gain it expects:
 * inflation plus a third of the last three years' real house-price growth,
 * the national block's own user cost, market.ts) with its rent, and buys if
 * owning is no dearer than its taste for owning allows: a draw at each
 * decision, spread OWN_SIGMA, centred where the opening's buyers replace the
 * owners who leave (solved once, `ownMu`, as the opening's steady state). The
 * spread is the ACS's spread of housing-cost shares among households of one
 * income (interquartile 22-42% at the median: 0.48 log points) [S~].
 */
const STARTER = 0.60, DOWN_FIRST = 0.035, CLOSING = 0.03, MAINT = 0.01, OWN_SIGMA = 0.5;
/** Homeownership by the householder's age, <25 .. 65+ (Census HVS 2023: 26 / 39 / 62 / 70 / 75 / 79%). [S] */
const OWN_BY_AGE = [0.26, 0.39, 0.62, 0.70, 0.75, 0.79];
/**
 * What an owner moving for work brings from the house it sold, in years of its
 * pay: a house at about 3.2 years of an owner's income (ACS 2023: median value
 * $303k on a median owner income of ~$96k) of which about half is its own
 * (working-age owners; the Fed's Z.1 puts all owners' equity near 70%), less
 * the 6% of selling it. [S~]
 */
const EQUITY_PAY = 3.2 * 0.5 * 0.94;
/**
 * WHERE A RENTER LIVES (households stage 2, replaces the flats' location
 * margin and their budget-share demand, FORMULA_LEDGER #10). Each renter
 * household weighs an island flat at the island's going rent against a flat
 * across the water at the mainland's, plus its commute: every earner who
 * works for one of the island's firms crosses the water each working day from
 * the mainland, and every one who works off the map crosses it from the
 * island — CROSS_KM each way, at the engine's commute costs (homeprice.ts
 * COMMUTE: AAA running cost, half the wage for the time, US DOT). CROSS_KM is
 * the drive from the island's middle to the near suburbs across the water, a
 * shape parameter [K]. Beyond rent and commute, a household's taste for the
 * island is its own (a draw it keeps), spread LOC_SIGMA — the same ACS spread
 * of housing-cost shares at one income [S~] — and centred where the opening's
 * island renters are the households that want the island (`locMu`, solved
 * once). The households that want an island flat ARE the flats' demand
 * (market.ts reads `islandWant`): when the island fills, its rents rise and
 * the marginal household chooses the mainland.
 */
const LOC_SIGMA = 0.5, CROSS_KM = 8;
/**
 * WHAT A MOVE COSTS, in log points of a year's rent: about a month and a half
 * of rent — a local move with movers runs ~$1,250-2,000 (American Moving &
 * Storage Association), plus application fees, a deposit tied up and the days
 * off — over the twelve months of a lease. [S~]
 */
const MOVE_LOG = 1.5 / 12;
/**
 * WORKERS (ONE ECONOMY step 3, 2026-10-29). A worker looking for a job sees a
 * shortlist of JOB_SHORTLIST openings — drawn by where the openings are, and
 * within an industry by which firms are adding heads — and takes the one worth
 * most to it: the pay, less what crossing the water to it costs from where the
 * household lives (homeprice.ts COMMUTE, CROSS_KM), less SWITCH_PAY for a
 * worker leaving the industry it knows (Neal 1995: displaced workers who
 * change industry lose about 5% more of their pay than those who stay) [S~].
 * Six a search is a shape parameter [K] (job seekers send one or two
 * applications a week, Faberman & Kudlyak 2019).
 */
const JOB_SHORTLIST = 6, SWITCH_PAY = 0.95;
/**
 * ON-THE-JOB SEARCH: an employed worker looks each month at OJS_M and moves
 * when an opening beats its job by QUIT_GAIN after the commute — a quit, and
 * an opening at the firm it left. 5% a month looking and a 5% hurdle are shape
 * parameters [K]; what they produce is checked against the record (BLS JOLTS
 * quits ~2.0-2.5% of employment a month, 2015-19; job-to-job flows ~2%,
 * Fujita, Moscarini & Postel-Vinay), not fitted to it.
 */
const OJS_M = 0.05, QUIT_GAIN = 0.05;
/**
 * THE MATCH: what one opening pays one worker, around its industry's going
 * rate at the worker's standing — a lognormal spread of 0.15, the size of the
 * gain a job change brings (Topel & Ward 1992: job changes average ~10% pay
 * gains early in a career and account for a third of its wage growth) [S~].
 * It is what makes a quit worth taking; the going rate (step 5 below) keeps
 * each industry's average where its books pay it.
 */
const MATCH_SD = 0.15;
/** The blocks a household looking for a flat sees: a broker's shortlist, about half a dozen (NMHC/Zillow renter surveys: renters tour a median of 4-6 homes before signing). [S~] */
const SHORTLIST = 6;
/**
 * WORKING PAST SIXTY: the share of each age still in the labour force over
 * the prime-age rate (BLS CPS 2023 annual averages: 25-54 83.4%, 55-59 ~72%,
 * 60-61 ~64%, 62-64 ~51%, 65-69 ~33%, 70-74 ~19%, 75+ ~8%), log-linear between
 * the bands' midpoints. Each earner retires on its birthday at the hazard the
 * curve falls by. (It was everyone at 67 and nobody past it.) [S]
 */
const LF_AGE: [number, number][] = [[52, 1], [57, 0.86], [60.5, 0.77], [63, 0.61], [67, 0.40], [72, 0.23], [80, 0.10], [90, 0.03]];
function lfAge(age: number): number {
  if (age <= LF_AGE[0][0]) return 1;
  for (let k = 1; k < LF_AGE.length; k++) {
    const [a1, v1] = LF_AGE[k], [a0, v0] = LF_AGE[k - 1];
    if (age <= a1) return v0 * Math.pow(v1 / v0, (age - a0) / (a1 - a0));
  }
  return LF_AGE[LF_AGE.length - 1][1];
}
/**
 * THE OTHER ADULTS: a third adult in a household (a grown child, a relative,
 * a roommate — CPS: about a fifth of households have three or more adults) is
 * in the labour force at the US rate for everyone over 16, 62.6% (BLS 2023):
 * mostly young adults at home, above it, and older relatives, below. [S~]
 * (Stage 1 gave a household two earner slots, so these adults never worked:
 * 1.1 earners a household against the 1.28 in the labour force per US
 * household, BLS/Census, and 0.41 employed per person against 0.48.)
 */
const OTHER_LF = 0.626;
/**
 * A GROWN CHILD LEAVES HOME TO FORM ITS OWN HOUSEHOLD, when it has work and
 * its pay can carry a flat across the water at the screen: about 13% a year
 * of those who could (Census CPS: ~55% of 18-24-year-olds live with parents
 * and ~17% of 25-34 — ln(55/17) over the ~8.5 years between the bands' middles
 * = 0.138 a year) [S~]. The ones who cannot afford it stay doubled up, which
 * is why household formation falls in a slump.
 */
const FORM_M = 0.138 / 12;
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
/**
 * EVICTION FROM ARREARS IN DOLLARS (households stage 2). A household that pays
 * part of the rent owes the rest (`owed`) and pays it back first out of what
 * it has over a month's subsistence. A landlord files once a full month's
 * rent is owed — the median eviction filing claims about a month's rent
 * (Eviction Lab, filings 2000-18) — and the household is out when a full
 * month is still owed EVICT_M months into the arrears (the notice and the
 * court, about two months). A mortgage forecloses at FORECLOSE_M months with
 * three payments owed (ATTOM average ~ 9 months to REO in a fast state). [S]
 * Stage 1 counted any month a dollar short as a month behind, so a household
 * paying 95% of its rent was evicted in a quarter.
 */
const EVICT_M = 3, EVICT_OWED = 1, FORECLOSE_M = 9, FORECLOSE_OWED = 3;
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
/**
 * A child comes of age — an adult at home, with a place in the labour force
 * (OTHER_LF) — per child per month once the head is past 45 (Census CPS: most
 * turn 18 with a parent in their late forties). [K] (Stage 1 had the child
 * vanish here; it now stays an adult until it can form a household, FORM_M.)
 */
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
  // households stage 2
  emp3: Int32Array, wage3: Float32Array, un3: Uint16Array, ind3: Uint8Array,  // the other adults' earner (a grown child, a relative): OTHER_LF
  taste: Float32Array,    // its taste for the island, log points (LOC_SIGMA; NaN until drawn)
  owed: Float32Array,     // housing payments owed, dollars
} as const;
/** Columns a save from before them does not carry, and what they hold then. */
const FIELD_DEFAULT: Partial<Record<keyof typeof FIELDS, number>> = { ind1: IND_NONE, ind2: IND_NONE, emp3: EMP_NONE, ind3: IND_NONE, taste: NaN };
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
  /**
   * HOUSEHOLDS STAGE 2. Why island renter households left their flats this
   * month (weighted; MOVE_REASONS), the island leases that ended and how many
   * of them ended in a move, the households grown children formed, and the
   * owners who moved and bought again.
   */
  out?: Record<MoveReason, number>;
  leaseEnds?: number; leaseMoves?: number;
  formed?: number; rebought?: number;
  /** WORKERS (step 3): earners hired (from out of work or arriving), who quit for a better job, and who were laid off (weighted). */
  hires?: number; quits?: number; layoffs?: number;
}

/** Why a household left its island flat. */
export const MOVE_REASONS = ["rent", "afford", "job", "buy", "jobloss", "evict", "other", "ended"] as const;
export type MoveReason = (typeof MOVE_REASONS)[number];
const zeroOut = (): Record<MoveReason, number> => ({ rent: 0, afford: 0, job: 0, buy: 0, jobloss: 0, evict: 0, other: 0, ended: 0 });
/** One recent buyer, for the builders' sales (homeprice.ts salesPace): its month, gross pay a year and weight. */
export interface HomeBuyer { m: number; inc: number; w: number }

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
  /**
   * HOUSEHOLDS STAGE 2: the centre of the households' taste for owning
   * (`ownMu`) and for the island (`locMu`), each solved once at the opening's
   * books (the opening's steady state); the households that want an island
   * flat this month (weighted: the flats' demand); the share of ending island
   * leases that end in a move, and the island renters' move-out rate a year,
   * each rolled over six months (the street's renewals and the player's flats
   * read them); the last twelve months' home buyers.
   */
  ownMu?: number; locMu?: number; islandWant?: number;
  leaseMoveRate?: number; moveOutYr?: number;
  buyers?: HomeBuyer[];
  /** WORKERS (step 3): each firm's heads last month (employer code -> heads), and this month's layoff events by firm (code -> why id). */
  firmHc?: Record<number, number>; layoffWhy?: Record<number, number>;
  /** This month's move-outs from the player's blocks: the cause-ledger event per block (bbl -> why id). */
  flatWhy?: Record<string, number>;
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

type Block = { idx: number; target: number; let: number; unitSf: number;
  /** a street block (its households let it, stage 2): its flats, its draw on movers and its month's letting limit, in flats */
  street?: boolean; capU?: number; w?: number; limU?: number; rel?: number };

/**
 * THE ISLAND'S FLATS, AS HOUSEHOLDS: every street block's let flats (its roll,
 * streetRolls.ts) and every flat in the player's blocks (`Holding.occ`), each
 * block's flat size the street's own (`flatUnitSf`), and each block's rent for
 * a flat let this month — its newest lease cohort, or the street's average for
 * a block that has none. Pure: it reads the parcels and the state.
 */
type RawBlock = { bbl: string; units: number; unitSf: number; psf: number | null; street?: boolean; capU?: number; w?: number; limU?: number; rel?: number };
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
  if (hit && hit[2] === m - 1 && m - hit[1] < 12 && hit.length > 3) { hit[2] = m; return hit[0]; }
  const rec = resolveRecBare(parcels, s, bbl);
  const cap = rec ? useRentableSf(rec, "multifamily") : 0;
  const unitSf = rec && cap > 0 ? Math.max(300, flatUnitSf(rec, cap)) : 0;
  if (memo) {
    // stagger the yearly re-reads across the months by the block's name
    let h = 0;
    for (let i = 0; i < bbl.length; i++) h = (h * 31 + bbl.charCodeAt(i)) | 0;
    memo[bbl] = [unitSf, hit ? m : m - (Math.abs(h) % 12), m, cap];
  }
  return unitSf;
}

function rawBlocks(s: GameState, parcels: ParcelTable, memo?: UnitMemo, all = false): { raw: RawBlock[]; psfAvg: number } {
  const e = s.econ;
  const raw: RawBlock[] = [];
  let rs = 0, sf = 0;
  for (const [bbl, roll] of Object.entries(e.flatRolls ?? {})) {
    if (!(roll.occ > 0) && !all) continue;
    const unitSf = blockUnitSf(s, parcels, bbl, memo);
    if (!(unitSf > 0)) continue;
    // the rent a flat lets for this month: the block's asking rent (streetRolls), else its newest lease
    let newest: { rent: number; endM: number } | null = null;
    for (const x of roll.l ?? []) if (!newest || x.endM > newest.endM) newest = x;
    const psf = roll.ask ?? roll.mkt ?? (newest ? newest.rent : null);
    if (psf !== null) { rs += psf * roll.occ; sf += roll.occ; }
    const capSf = memo?.[bbl]?.[3] ?? 0;
    if (all && psf === null) continue;   // a block not yet priced by the street: next month
    raw.push(all
      ? { bbl, units: roll.occ / unitSf, unitSf, psf, street: true, capU: capSf / unitSf, w: roll.w ?? 1, limU: (roll.lim ?? 2 * unitSf) / unitSf, rel: roll.ask && roll.mkt ? roll.ask / roll.mkt : 1 }
      : { bbl, units: roll.occ / unitSf, unitSf, psf });
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

function readBlocks(s: GameState, parcels: ParcelTable, r: HouseholdRegister, byHH = false): { list: Block[]; byIdx: Map<number, Block>; psfAvg: number } {
  const ix = new Map<string, number>();
  r.blocks.forEach((b, i) => ix.set(b, i));
  const idxOf = (bbl: string) => { let i = ix.get(bbl); if (i === undefined) { i = r.blocks.length; r.blocks.push(bbl); ix.set(bbl, i); } return i; };
  const memo = (r.unitMemo ??= {});
  const { raw, psfAvg } = rawBlocks(s, parcels, memo, byHH);
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
    const b: Block = { idx: idxOf(x.bbl), target, let: (psf * x.unitSf) / 12, unitSf: x.unitSf, street: x.street, capU: x.capU, w: x.w, limU: x.limU, rel: x.rel };
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
type Demand = { heads: Float64Array; codes: Int32Array[]; cum: Float64Array[]; live: Set<number>; pay: Float64Array;
  /** each firm's heads this month, by register employer code (workers: who is hiring and who is cutting) */
  hc: Map<number, number> };
function readDemand(s: GameState): Demand | null {
  const E = s.economy;
  if (!E || !E.cur || E.cur.m !== s.month) return null;
  const f = E.f, n = E.L.slot.n;
  const lists: { code: number; hc: number }[][] = Array.from({ length: N_IND }, () => []);
  const live = new Set<number>();
  const hc = new Map<number, number>();
  for (let k = 0; k < n; k++) {
    const id = f.id[k], code = id >= 0 ? id : EMP_OFF + id;
    live.add(code); hc.set(code, f.hc[k]);
    if (f.hc[k] > 0) lists[f.ind[k]].push({ code, hc: f.hc[k] });
  }
  const codes = lists.map((l) => Int32Array.from(l, (x) => x.code));
  const cum = lists.map((l) => { let t = 0; return Float64Array.from(l, (x) => (t += x.hc)); });
  const w = s.econ.wageIdx ?? 1;
  const pay = new Float64Array(N_IND);
  for (let i = 0; i < N_IND; i++) pay[i] = industryCashPay(i, w);
  return { heads: Float64Array.from(E.cur.heads), codes, cum, live, pay, hc };
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
  a.blk[i] = -1; a.emp1[i] = EMP_NONE; a.emp2[i] = EMP_NONE; a.emp3[i] = EMP_NONE;
  a.ind1[i] = IND_NONE; a.ind2[i] = IND_NONE; a.ind3[i] = IND_NONE; a.taste[i] = NaN;
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
  const job = (emp: Int32Array, un: Uint16Array) => {
    emp[i] = R.u() < unemp ? EMP_UNEMP : EMP_OTHER;
    if (emp[i] === EMP_UNEMP) un[i] = 1 + Math.floor(R.u() * 10);
  };
  // the head works at its age's rate (LF_AGE); a head who does not draws the pension
  const works = R.u() < lfAge(a.age[i]);
  const other = a.adults[i] >= 3 && R.u() < OTHER_LF;
  if (!works) {
    a.emp1[i] = EMP_RETIRED; a.wage1[i] = income;
    if (other) { a.wage3[i] = income * 0.4; job(a.emp3, a.un3); }
    return;
  }
  const two = a.adults[i] >= 2 && R.u() < 0.70 * lfAge(a.age[i]);
  if (two) { job(a.emp2, a.un2); }
  if (other) { job(a.emp3, a.un3); }
  job(a.emp1, a.un1);
  a.wage1[i] = income * payShare(a, i, 0); a.wage2[i] = two ? income * payShare(a, i, 1) : 0; a.wage3[i] = other ? income * payShare(a, i, 2) : 0;
  void e;
}
/**
 * An earner's share of its household's pay, as the opening draws it: head and
 * partner 60/40 (BLS: the wife's share of a dual-earner couple's pay ~ 38%),
 * and another adult — a grown child, most often — about a fifth of a couple's
 * pay or a third of a single head's. [S~]
 */
function payShare(a: HouseholdArrays, i: number, k: number): number {
  const two = a.emp2[i] !== EMP_NONE && a.emp2[i] !== EMP_RETIRED, other = a.emp3[i] !== EMP_NONE && a.emp3[i] !== EMP_RETIRED;
  const w = [1, two ? 0.667 : 0, other ? (two ? 0.4 : 0.5) : 0];
  const t = w[0] + w[1] + w[2];
  return w[k] / t;
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
  const lfOf = (i: number) => [r.a!.emp1[i], r.a!.emp2[i], r.a!.emp3[i]].filter((x) => x !== EMP_NONE && x !== EMP_RETIRED).length;
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

/** A household's pay a year as a landlord reads it: every slot's wage, pension or lost wage. */
const payOf = (a: HouseholdArrays, i: number) => a.wage1[i] + a.wage2[i] + a.wage3[i];

// ---------------------------------------------------------------- where a renter lives (stage 2)
/** One earner's cost a month of crossing the water to work and back (homeprice.ts COMMUTE), at its pay. */
function crossCostMo(e: Econ, wage: number): number {
  const km = 2 * 1.3 * 250 * CROSS_KM;   // a year: there and back, on the road, each working day
  return (km * (COMMUTE.perKm * (e.wageIdx ?? 1) + (COMMUTE.vot * (wage / 2080)) / COMMUTE.kmh)) / 12;
}
/** What living on the island saves this household a month in commuting (negative: it costs). */
function commuteSaving(a: HouseholdArrays, i: number, e: Econ): number {
  let s = 0;
  const E = [a.emp1[i], a.emp2[i], a.emp3[i]], W = [a.wage1[i], a.wage2[i], a.wage3[i]];
  for (let k = 0; k < 3; k++) {
    if (E[k] >= 0) s += crossCostMo(e, W[k]);              // works for one of the island's firms
    else if (E[k] < EMP_OFF) s -= crossCostMo(e, W[k]);    // works off the map, across the water
  }
  return s;
}
function ensureTaste(R: Rand, a: HouseholdArrays, i: number) {
  if (Number.isNaN(a.taste[i])) a.taste[i] = LOC_SIGMA * R.n();
}
/** The month's island rents and economy, for the matching a move does (set for the length of a tick). */
let CTX: { e: Econ; letAvg: number } | null = null;
/**
 * How far over the mainland's rent (log) this household would pay to live on
 * the island: its taste, the island's amenity centre and its commute saving
 * over the mainland rent. It wants an island flat at `rentIsl` when the log of
 * that over the mainland's going rent is no more than this — and it passes the
 * landlord's screen there.
 */
function islandPull(r: HouseholdRegister, a: HouseholdArrays, i: number, e: Econ): number {
  return a.taste[i] + (r.locMu ?? 0) + commuteSaving(a, i, e) / Math.max(1, r.mainRent);
}
/**
 * Does it want an island flat at `rentIsl`? `move` is what moving costs it in
 * the same log terms (MOVE_LOG): a sitting tenant stays unless the mainland
 * beats its flat by more than the move (+MOVE_LOG), a household across the
 * water comes only if the island beats the mainland by more than it
 * (-MOVE_LOG). Without it, a tenant left over a rent a point too dear and the
 * island's renters turned over 73% a year.
 */
function wantsIsland(r: HouseholdRegister, a: HouseholdArrays, i: number, e: Econ, rentIsl: number, move = 0): boolean {
  if (r.locMu === undefined) return true;   // before the opening's books, nobody has chosen yet
  // the landlord's screen is for a household moving in: a sitting tenant is
  // not screened again at renewal (a quarter of US renters pay over half
  // their income in rent, Harvard JCHS) — it stays while it can pay
  const inc = payOf(a, i);
  if (move <= 0 && (!(inc > 0) || (12 * rentIsl) / inc > SCREEN)) return false;
  return Math.log(rentIsl / Math.max(1, r.mainRent)) <= islandPull(r, a, i, e) + move;
}

// ---------------------------------------------------------------- owning (stage 2)
type HomeMkt = { std: number; starter: number; rate: number; amort: number; ucMo: number };
/** The region's homes this month: the standard house, the starter, the mortgage, and what owning the starter costs a month. */
function homeMarket(e: Econ): HomeMkt {
  const std = (e.homes?.psf ?? fundamentalHomePsf(e)) * REF_HOME.sf;
  const starter = STARTER * std, rate = mortgageRate(e), mo = rate / 12;
  const amort = mo > 0 ? mo / (1 - Math.pow(1 + mo, -360)) : 1 / 360;
  // the expected gain: inflation plus a third of the last three years' real price growth (market.ts hhUserCost)
  const gExp = (e.nat?.inflExp ?? 0.02) + 0.3 * Math.max(-0.03, Math.min(0.05, e.nat?.hpiG3 ?? 0));
  const uc = Math.max(0.035, rate + TAX_INS + MAINT - gExp);
  return { std, starter, rate, amort, ucMo: (starter * uc) / 12 };
}
/** Pay a lender counts: the working earners of the couple (not a grown child's, not a pension). */
function lendPay(a: HouseholdArrays, i: number): number {
  return (isWorking(a.emp1[i]) ? a.wage1[i] : 0) + (isWorking(a.emp2[i]) ? a.wage2[i] : 0);
}
/**
 * Can this renter household buy, and if so how owning the starter compares
 * with its rent (log of the cost over the rent). Null when it cannot: no work,
 * a record no lender takes, rent owed, past 75, the payment over the
 * front-end ratio or the cash short of the down payment and closing.
 */
function buyCheck(a: HouseholdArrays, i: number, H: HomeMkt, rentMo: number): number | null {
  if (a.age[i] >= 75 || a.credit[i] >= 3 || a.owed[i] > 0) return null;
  const inc = lendPay(a, i);
  if (!(inc > 0)) return null;
  const P = H.starter;
  if (P * (1 - DOWN_FIRST) * H.amort + (TAX_INS / 12) * P > (DTI * inc) / 12) return null;
  if (a.sav[i] < (DOWN_FIRST + CLOSING) * P) return null;
  return Math.log(H.ucMo / Math.max(1, rentMo));
}
/** The household buys: the most house its pay and cash carry, from the starter up to the standard house. */
function buyHome(r: HouseholdRegister, a: HouseholdArrays, i: number, H: HomeMkt, m: number) {
  const inc = lendPay(a, i);
  const byPay = ((DTI * inc) / 12) / ((1 - DOWN_FIRST) * H.amort + TAX_INS / 12);
  const P = Math.max(H.starter, Math.min(H.std, byPay, a.sav[i] / (DOWN_FIRST + CLOSING)));
  (r.buyers ??= []).push({ m, inc, w: a.wt[i] });
  a.sav[i] -= (DOWN_FIRST + CLOSING) * P;
  a.ten[i] = TEN_OWN; a.rent[i] = 0; a.blk[i] = -1;
  a.mort[i] = P * (1 - DOWN_FIRST); a.mortRate[i] = H.rate; a.mortPmt[i] = a.mort[i] * H.amort; a.hval[i] = P;
}
const erf = (x: number) => {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
};
const normCdf = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));
/**
 * THE CENTRE OF THE TASTE FOR OWNING, solved once: where the renters'
 * expected buying at the opening (one decision a year each, at its rent)
 * replaces the owner households that leave owning — those who sell and rent,
 * and those who end — so the opening's ownership is a steady state, as the
 * opening's other stocks are.
 */
function solveOwnMu(r: HouseholdRegister, e: Econ): number {
  const a = r.a!, H = homeMarket(e);
  let out = 0;
  const cs: number[] = [], ws: number[] = [];
  for (let i = 0; i < r.n; i++) {
    const w = a.wt[i], t = a.ten[i];
    if (t === TEN_OWN) out += w * (SELL_YR / 12 + (a.adults[i] <= 1 && a.age[i] >= 65 ? dissolveM(a.age[i]) : 0));
    else if (t === TEN_RENT || t === TEN_MAINLAND) { const c = buyCheck(a, i, H, a.rent[i]); if (c !== null) { cs.push(c); ws.push(w); } }
  }
  const buys = (mu: number) => cs.reduce((t, c, k) => t + ws[k] * normCdf((mu - c) / OWN_SIGMA), 0) / 12;
  let lo = -6, hi = 6;
  if (buys(hi) < out) return hi;
  for (let it = 0; it < 50; it++) { const mid = (lo + hi) / 2; if (buys(mid) < out) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}
/**
 * THE CENTRE OF THE TASTE FOR THE ISLAND, solved once, at the first month the
 * books place the households' jobs (their commutes): where the households that
 * want an island flat at the going rents are the island's renter households.
 */
function solveLocMu(r: HouseholdRegister, e: Econ, letOf: (i: number) => number): number {
  const a = r.a!;
  const xs: { x: number; w: number }[] = [];
  let island = 0;
  for (let i = 0; i < r.n; i++) {
    const t = a.ten[i];
    if (t !== TEN_RENT && t !== TEN_MAINLAND) continue;
    if (t === TEN_RENT) island += a.wt[i];
    const rent = letOf(i), inc = payOf(a, i);
    if (t === TEN_MAINLAND && (!(inc > 0) || (12 * rent) / inc > SCREEN)) continue;
    xs.push({ x: Math.log(rent / Math.max(1, r.mainRent)) - a.taste[i] - commuteSaving(a, i, e) / Math.max(1, r.mainRent), w: a.wt[i] });
  }
  xs.sort((p, q) => p.x - q.x);
  let acc = 0;
  for (const { x, w } of xs) { acc += w; if (acc >= island) return x; }
  return xs.length ? xs[xs.length - 1].x : 0;
}

/**
 * THE OPENING IS SORTED. The opening's island renters were placed one for one
 * with the let flats, with tastes drawn at random — but the households living
 * on an island are the ones who chose it. Once the centre is solved, each
 * renter's taste is drawn again from the side of its own threshold it lives
 * on (an island renter's from the tastes that want the island at its rent,
 * a renter across the water's from those that do not), so the opening is a
 * sorted city and nobody is half-way through a move the day the game starts.
 * The spread of tastes stays LOC_SIGMA within each side.
 */
function sortOpening(R: Rand, r: HouseholdRegister, e: Econ, letOf: (i: number) => number) {
  const a = r.a!;
  for (let i = 0; i < r.n; i++) {
    const t = a.ten[i];
    if (t !== TEN_RENT && t !== TEN_MAINLAND) continue;
    const cut = Math.log(letOf(i) / Math.max(1, r.mainRent)) - (r.locMu ?? 0) - commuteSaving(a, i, e) / Math.max(1, r.mainRent);
    const island = t === TEN_RENT;
    let x = a.taste[i];
    for (let k = 0; k < 64 && (island ? x < cut : x >= cut); k++) x = LOC_SIGMA * R.n();
    if (island ? x < cut : x >= cut) x = cut + (island ? 0.01 : -0.01);
    a.taste[i] = x;
  }
}

// ---------------------------------------------------------------- why a flat emptied (cause ledger)
type OutNote = { i: number; reason: MoveReason; n: Record<string, number>; t: string; cause?: number };
/** This month's move-outs from the player's blocks, by block (set for the length of a tick). */
let OUTS: Map<string, OutNote[]> | null = null;
let MINE: Set<string> | null = null;
/** An island household left its flat: count it, and if the flat is the player's, note why. */
function noteOut(r: HouseholdRegister, i: number, reason: MoveReason, detail?: () => Omit<OutNote, "i" | "reason">) {
  const a = r.a!, w = a.wt[i];
  (r.flow.out ??= zeroOut())[reason] += w;
  const bbl = a.blk[i] >= 0 ? r.blocks[a.blk[i]] : undefined;
  if (!bbl || !MINE?.has(bbl) || !OUTS) return;
  let l = OUTS.get(bbl);
  if (!l) { l = []; OUTS.set(bbl, l); }
  if (l.length < 6) l.push({ i, reason, ...(detail ? detail() : { n: {}, t: "A household moved out" }) });
  else l.push({ i, reason, n: {}, t: "" });
}
const REASON_WORD: Record<MoveReason, string> = {
  rent: "rent up", afford: "could not carry the rent", job: "closer to work", buy: "bought a home", jobloss: "left town after a job loss",
  evict: "evicted", other: "family or other reasons", ended: "household ended",
};
function writeOutWhy(s: GameState, parcels: ParcelTable, r: HouseholdRegister) {
  r.flatWhy = {};
  if (!OUTS) return;
  for (const [bbl, l] of OUTS) {
    const ids = l.filter((x) => x.t).slice(0, 4).map((x) => why(s, { k: `household.${x.reason}`, a: "household", bbl, n: x.n, t: x.t }, [x.cause]));
    const by = zeroOut();
    for (const x of l) by[x.reason] += 1;
    const parts = MOVE_REASONS.filter((k) => by[k] > 0).sort((p, q) => by[q] - by[p]).map((k) => `${by[k]} ${REASON_WORD[k]}`);
    const addr = resolveRecBare(parcels, s, bbl)?.address ?? bbl;
    r.flatWhy[bbl] = why(s, {
      k: "flats.out", a: "household", bbl, n: { households: l.length, ...by },
      t: `${l.length} household${l.length === 1 ? "" : "s"} left ${addr} · ${parts.join(" · ")}`,
    }, ids);
  }
}

/**
 * A NEW ISLAND HOUSEHOLD TAKING A FLAT (step 2): a renter from across the
 * water — since households stage 2 one that wants an island flat (`want`,
 * `wantsIsland`), else any; the first of SCREEN_TRIES applicants who can carry
 * the rent (the landlord's screen), else the last — which moves its household
 * (and its weight) onto the island. So the region's renters are one pool and
 * the island's flats are where some of them live: a flat let on the island is
 * a renter household fewer across the water, not a household more in the
 * region. With nobody across the water, a household arrives from outside, at
 * the island renters' income.
 */
function moveIn(R: Rand, r: HouseholdRegister, b: Block, e: Econ, m: number, pool: number[], want: number[], gone: Uint8Array) {
  const w = r.wIsland;
  let j = -1;
  // first, a household that wants THIS flat at its rent (a searcher's choice is a block, not the island's average)
  for (let k = 0; k < 16 && want.length; k++) {
    const c = want[Math.floor(R.u() * want.length)];
    const A = r.a!;
    if ((c < gone.length && gone[c]) || A.ten[c] !== TEN_MAINLAND || A.wt[c] < w) continue;
    if (wantsIsland(r, A, c, e, b.let, -MOVE_LOG)) { j = c; break; }
  }
  // else the first of SCREEN_TRIES applicants from across the water who can carry it, else the last
  for (let k = 0; j < 0 && k < SCREEN_TRIES && pool.length; k++) {
    const c = pool[Math.floor(R.u() * pool.length)];
    const A = r.a!;
    if ((c < gone.length && gone[c]) || A.ten[c] !== TEN_MAINLAND || A.wt[c] < w) continue;
    const inc = payOf(A, c);
    if (inc > 0 && (12 * b.let) / inc <= SCREEN) j = c;
    else if (k === SCREEN_TRIES - 1) j = c;
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
  a.rent[i] = b.let; a.leaseEnd[i] = m + 12; a.owed[i] = 0; a.arrears[i] = 0;
  r.flow.movedIn += w;
}

/**
 * A STREET FLAT LET TO A HOUSEHOLD THAT CHOOSES IT (stage 2): one from across
 * the water that wants this block at its rent, else nobody — the flat stands
 * empty, and its rent answers. (A flat let to whoever was there left at the
 * next renewal: the island's renters turned over 80% a year.)
 */
function letTo(R: Rand, r: HouseholdRegister, b: Block, e: Econ, m: number, want: number[], gone: Uint8Array): boolean {
  const w = r.wIsland, A = r.a!;
  for (let k = 0; k < 16 && want.length; k++) {
    const c = want[Math.floor(R.u() * want.length)];
    if ((c < gone.length && gone[c]) || A.ten[c] !== TEN_MAINLAND || A.wt[c] < w) continue;
    if (!wantsIsland(r, A, c, e, b.let, -MOVE_LOG)) continue;
    const i = addAgent(r), a = r.a!;
    for (const f of FIELD_NAMES) (a[f] as Uint8Array)[i] = (a[f] as Uint8Array)[c];
    a.id[i] = r.nextId++;
    a.wt[c] -= w;
    if (a.wt[c] < 1e-6 && c < gone.length) gone[c] = 1;
    a.wt[i] = w; a.ten[i] = TEN_RENT; a.blk[i] = b.idx;
    a.rent[i] = b.let; a.leaseEnd[i] = m + 12; a.owed[i] = 0; a.arrears[i] = 0;
    r.flow.movedIn += w;
    return true;
  }
  return false;
}

/**
 * An island household that leaves its flat for the region's rented homes:
 * its weight goes back to the pool across the water — onto a household like
 * it (its first earner's industry, else its status: in work, retired, out of
 * work), since it keeps its jobs when it moves. Joining whoever came first
 * moved working households' weight onto jobless ones a few at a time, which
 * over decades is a leak of jobs into joblessness.
 */
function toMainland(R: Rand, r: HouseholdRegister, i: number, pool: number[], gone: Uint8Array, wants?: boolean) {
  const a = r.a!;
  gone[i] = 1; r.flow.movedOut += a.wt[i];
  const kindOf = (x: number, ind: number) => x === EMP_RETIRED ? "r" : x === EMP_UNEMP ? "u" : x === EMP_NONE ? "n" : `w${ind}`;
  const mine = kindOf(a.emp1[i], a.ind1[i]);
  // ...AND OF ITS MIND (stage 2): a household that left because it no longer
  // wants the island joins one across the water that does not want it either,
  // and one that moved for other reasons (and still wants it) joins one that
  // does — else every move would hand its weight a stranger's taste, and the
  // city would never stay sorted.
  const side = (j: number) => wants === undefined || !CTX || (Number.isNaN(a.taste[j]) ? !wants : wantsIsland(r, a, j, CTX.e, CTX.letAvg, -MOVE_LOG) === wants);
  for (let k = 0; k < 32 && pool.length; k++) {
    const j = pool[Math.floor(R.u() * pool.length)];
    if ((j < gone.length && gone[j]) || a.ten[j] !== TEN_MAINLAND) continue;
    const theirs = kindOf(a.emp1[j], a.ind1[j]);
    if (k < 16 ? theirs !== mine : theirs[0] !== mine[0]) continue;
    if (k < 28 && !side(j)) continue;
    a.wt[j] += a.wt[i];
    return;
  }
  // nobody across the water to join: the household itself rents there
  gone[i] = 0; a.ten[i] = TEN_MAINLAND; a.blk[i] = -1; a.rent[i] = mainlandRent(R, r.mainRent, a, i);
}

/**
 * OWN OR RENT (households stage 2). Owners sell and rent again at SELL_YR and
 * move to another home they buy at REBUY_YR (repeat buyers: no change of
 * tenure, but buyers a builder sells to); renters across the water decide on
 * their lease's anniversary whether to buy (`buyCheck`, the taste for owning
 * drawn at the decision) — island renters decide at their lease end, in the
 * blocks below. Replaces the buying hazard moved by the tenure index
 * (FORMULA_LEDGER #12) and the plats' houses sold to renters on top of it:
 * those houses' buyers are these buyers (homeprice.ts salesPace).
 *
 * WHOLE HOUSEHOLDS MOVE, KEEPING WHO THEY ARE (step 2's note): a regional
 * agent stands for ~20 households, so the renter count moves in steps of 20;
 * an island renter who buys puts its weight on an owner of its own kind.
 */
function tickTenure(R: Rand, r: HouseholdRegister, e: Econ, gone: Uint8Array, H: HomeMkt, m: number) {
  const a = r.a!, n = gone.length;
  const sellM = SELL_YR / 12, rebuyM = REBUY_YR / 12;
  if (r.ownMu === undefined) r.ownMu = solveOwnMu(r, e);
  let bought = 0, sold = 0, rebought = 0;
  for (let i = 0; i < n; i++) {
    if (gone[i]) continue;
    const t = a.ten[i];
    if (t === TEN_OWN) {
      const u = R.u();
      if (u < sellM) {
        a.sav[i] += Math.max(0, a.hval[i] - a.mort[i]) * 0.94;   // less the agent's 6%
        a.ten[i] = TEN_MAINLAND; a.mort[i] = 0; a.mortPmt[i] = 0; a.hval[i] = 0;
        a.rent[i] = mainlandRent(R, r.mainRent, a, i);
        sold += a.wt[i];
      } else if (u < sellM + rebuyM) {
        const inc = lendPay(a, i) || payOf(a, i);
        if (inc > 0) { (r.buyers ??= []).push({ m, inc, w: a.wt[i] }); rebought += a.wt[i]; }
      }
      continue;
    }
    if (t !== TEN_MAINLAND || (m + a.id[i]) % 12 !== 0) continue;
    const c = buyCheck(a, i, H, a.rent[i]);
    if (c !== null && r.ownMu + OWN_SIGMA * R.n() >= c) { buyHome(r, a, i, H, m); bought += a.wt[i]; continue; }
    // ...or, if its pay no longer carries its rent (a job lost, a retirement), it moves to a flat it can carry
    const pay = payOf(a, i);
    if (pay > 0 && (12 * a.rent[i]) / pay > SCREEN) a.rent[i] = mainlandRent(R, r.mainRent, a, i);
  }
  r.flow.bought = (r.flow.bought ?? 0) + bought;
  r.flow.sold = (r.flow.sold ?? 0) + sold;
  r.flow.rebought = (r.flow.rebought ?? 0) + rebought;
}
/** An owner household like this one (its first earner's industry, else any owner), drawn at random. */
function ownerLike(R: Rand, r: HouseholdRegister, i: number, gone: Uint8Array): number {
  const a = r.a!, kind = a.ind1[i];
  for (let k = 0; k < 96; k++) {
    const j = Math.floor(R.u() * r.n);
    if ((j < gone.length && gone[j]) || a.ten[j] !== TEN_OWN || a.wt[j] < 1) continue;
    if (k < 64 && a.ind1[j] !== kind) continue;
    return j;
  }
  return -1;
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
  const pay = payOf(a, i);
  return pay > 0 ? Math.min(draw, (SCREEN * pay) / 12) : draw;
}

/**
 * A GROWN CHILD FORMS ITS OWN HOUSEHOLD (households stage 2): young, one
 * adult, its job (and industry and pay) its own, a little money, renting
 * across the water at a rent its pay carries — and from there it may choose
 * an island flat like any renter. It replaces stage 1's young household
 * formed in place of every one that ended. An island household's child (an
 * agent standing for one household) joins a young renter household like it
 * across the water, as an island household that leaves does (`toMainland`),
 * so the register does not fill with agents of weight one.
 */
function formFromChild(R: Rand, r: HouseholdRegister, i: number, e: Econ, pool: number[], gone: Uint8Array) {
  const a = r.a!, w = a.wt[i];
  const emp = a.emp3[i], wage = a.wage3[i], un = a.un3[i], ind = a.ind3[i];
  a.adults[i]--; a.emp3[i] = EMP_NONE; a.wage3[i] = 0; a.un3[i] = 0; a.ind3[i] = IND_NONE;
  r.flow.formed = (r.flow.formed ?? 0) + w;
  if (w < 0.5 * r.wRegion) {
    for (let k = 0; k < 24 && pool.length; k++) {
      const j = pool[Math.floor(R.u() * pool.length)];
      if ((j < gone.length && gone[j]) || a.ten[j] !== TEN_MAINLAND || a.adults[j] !== 1 || a.age[j] >= 35) continue;
      if (k < 16 && a.ind1[j] !== ind) continue;
      a.wt[j] += w;
      return;
    }
  }
  // ...as a couple, about half the time: two grown children leaving home this
  // month to live together (CPS 2023: of 25-34-year-olds living apart from
  // their parents, about 55% live with a spouse or partner) [S~]
  const p = PENDING;
  if (p >= 0 && p < r.n && a.adults[p] === 1 && Math.abs(a.wt[p] - w) <= 0.25 * w && R.u() < COUPLE_SHARE) {
    a.adults[p] = 2; a.emp2[p] = emp; a.wage2[p] = wage; a.un2[p] = un; a.ind2[p] = ind;
    a.wt[p] = (a.wt[p] + w) / 2;
    a.rent[p] = mainlandRent(R, r.mainRent, a, p);
    PENDING = -1;
    return;
  }
  const j = addAgent(r), b = r.a!;
  b.wt[j] = w; b.age[j] = 19 + Math.floor(R.u() * 10); b.adults[j] = 1; b.kids[j] = 0;
  b.emp1[j] = emp; b.wage1[j] = wage; b.un1[j] = un; b.ind1[j] = ind;
  fillMoney(R, b, j, wage, false, e);
  b.ten[j] = TEN_MAINLAND; b.rent[j] = mainlandRent(R, r.mainRent, b, j);
  PENDING = j;
}
/** This month's last new single household from a grown child, which the next may join as a couple. */
let PENDING = -1;
const COUPLE_SHARE = 0.55;

/** One earner slot's gross pay this month: a wage, a pension, or unemployment insurance for its first UI_MONTHS. */
function slotIncome(x: number, wage: number, un: number): number {
  if (x === EMP_NONE) return 0;
  if (x === EMP_UNEMP) return un <= UI_MONTHS ? (UI_REPLACE * wage) / 12 : 0;
  return wage / 12;
}
const grossOf = (a: HouseholdArrays, i: number) =>
  slotIncome(a.emp1[i], a.wage1[i], a.un1[i]) + slotIncome(a.emp2[i], a.wage2[i], a.un2[i]) + slotIncome(a.emp3[i], a.wage3[i], a.un3[i]);
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
function matchJobs(s: GameState, R: Rand, r: HouseholdRegister, D: Demand, e: Econ, n0: number): number[] {
  const a = r.a!;
  const N = new Float64Array(N_IND);
  const members: number[][] = Array.from({ length: N_IND }, () => []);
  // a slot is agent i's first earner (3i), second (3i+1) or other adult (3i+2)
  const EMP = () => [r.a!.emp1, r.a!.emp2, r.a!.emp3], IND = () => [r.a!.ind1, r.a!.ind2, r.a!.ind3], WAGE = () => [r.a!.wage1, r.a!.wage2, r.a!.wage3], UN = () => [r.a!.un1, r.a!.un2, r.a!.un3];
  for (let i = 0; i < r.n; i++) for (let k = 0; k < 3; k++) {
    if (!isPlaced(EMP()[k][i]) || IND()[k][i] === IND_NONE) continue;
    N[IND()[k][i]] += a.wt[i]; members[IND()[k][i]].push(3 * i + k);
  }
  const shuffle = (l: number[]) => { for (let j = l.length - 1; j > 0; j--) { const q = Math.floor(R.u() * (j + 1)); const t = l[j]; l[j] = l[q]; l[q] = t; } return l; };
  // each firm's change in heads since last month: who is cutting and who is hiring
  const prev = r.firmHc ?? {};
  const grow = (code: number) => { const h = D.hc.get(code) ?? 0, p = prev[code] ?? h; return { h, p }; };
  const shrinkFrac = (code: number) => { const { h, p } = grow(code); return p > 0 ? Math.max(0, (p - h) / p) : 0; };
  // 1. LAYOFFS, BY THE FIRMS THAT CUT. An industry with more of the register's
  // earners than heads lets the difference go, and the earners go from the
  // firms that cut their heads this month, the most from the firms that cut
  // the most (a member's draw weighs 1 + 20 x its firm's cut); the firm's
  // name and why it cut are written to the cause ledger (below).
  const laid = new Map<number, number>();
  for (let ind = 0; ind < N_IND; ind++) {
    if (!(N[ind] > D.heads[ind])) continue;
    const order = members[ind].map((sl) => ({ sl, key: Math.pow(R.u(), 1 / (1 + 20 * shrinkFrac(EMP()[sl % 3][(sl / 3) | 0]))) })).sort((p, q) => q.key - p.key);
    for (const { sl } of order) {
      const i = (sl / 3) | 0, k = sl % 3, w = a.wt[i];
      if (N[ind] - D.heads[ind] < w / 2) continue;
      const code = EMP()[k][i];
      laid.set(code, (laid.get(code) ?? 0) + w);
      EMP()[k][i] = EMP_UNEMP; UN()[k][i] = 0; N[ind] -= w;
      r.flow.layoffs = (r.flow.layoffs ?? 0) + w;
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
  // household income its pay was drawn as part of (fillPeople, payShare)
  const standing = (i: number, k: number) => {
    const share = payShare(r.a!, i, k) || 1;
    const z = Math.log(Math.max(1, WAGE()[k][i] / share) / med) / INCOME_SIGMA;
    return Math.exp(WAGE_SIGMA * z - WAGE_SIGMA * WAGE_SIGMA / 2);
  };
  // WHERE THE HOUSEHOLD LIVES, AND WHAT A JOB IS WORTH TO IT: the pay (its
  // industry's going rate at the worker's standing, less SWITCH_PAY to change
  // industry), less a year of crossing the water when the firm is on the
  // other side (an island firm from the mainland, an off-map one from the island)
  const onIsland = (i: number) => r.a!.ten[i] === TEN_RENT;
  const cross = (i: number, code: number, wage: number) => (code >= 0) !== onIsland(i) && (code >= 0 || code < EMP_OFF) ? 12 * crossCostMo(e, wage) : 0;
  const payAt = (i: number, k: number, ind: number) => {
    const old = IND()[k][i], wg = WAGE()[k][i];
    const base = old === IND_NONE ? D.pay[ind] * standing(i, k) : wg * D.pay[ind] / Math.max(1e-9, D.pay[old]);
    return old !== IND_NONE && old !== ind ? base * SWITCH_PAY : base;
  };
  // a firm of an industry, by its heads, more for the firms adding heads (one draw)
  const firmIn = (ind: number) => {
    let c = drawFirm(R, D, ind);
    const { h, p } = grow(c);
    if (!(h > p) && D.codes[ind].length > 1) { const c2 = drawFirm(R, D, ind), g2 = grow(c2); if (g2.h > g2.p) c = c2; }
    return c;
  };
  // the best of a shortlist of openings for this earner, or null
  const bestJob = (i: number, k: number, only?: number) => {
    let best: { ind: number; code: number; pay: number; value: number } | null = null;
    for (let t = 0; t < JOB_SHORTLIST; t++) {
      const ind = only ?? pickInd(r.a!.wt[i]);
      if (ind < 0) break;
      // ...and the match: the same job pays one worker more than another (MATCH_SD)
      const code = firmIn(ind), pay = payAt(i, k, ind) * Math.exp(MATCH_SD * R.n() - MATCH_SD * MATCH_SD / 2), value = pay - cross(i, code, pay);
      if (!best || value > best.value) best = { ind, code, pay, value };
      if (only !== undefined && t >= 1) break;
    }
    return best;
  };
  const place = (i: number, k: number, job: { ind: number; code: number; pay: number }) => {
    WAGE()[k][i] = job.pay;
    EMP()[k][i] = job.code; IND()[k][i] = job.ind; UN()[k][i] = 0;
    V[job.ind] -= r.a!.wt[i];
    r.flow.hires = (r.flow.hires ?? 0) + r.a!.wt[i];
  };
  // 2. the earners who came with work
  const seekers: number[] = [];
  for (let i = 0; i < r.n; i++) for (let k = 0; k < 3; k++) if (EMP()[k][i] === EMP_OTHER) seekers.push(3 * i + k);
  for (const sl of shuffle(seekers)) {
    const i = (sl / 3) | 0, k = sl % 3, job = bestJob(i, k);
    if (job) place(i, k, job);
    else { EMP()[k][i] = EMP_UNEMP; UN()[k][i] = 1; }
  }
  // 3. QUITS (before the jobless: the employed look at the same openings): a worker who looks this month (OJS_M) and finds an opening
  // worth QUIT_GAIN more than its job after the commute moves; the job it
  // left is an opening (filled by the next searcher, or by an arrival)
  const working: number[] = [];
  for (let i = 0; i < r.n; i++) for (let k = 0; k < 3; k++) if (isPlaced(EMP()[k][i]) && IND()[k][i] !== IND_NONE) working.push(3 * i + k);
  for (const sl of shuffle(working)) {
    if (!(R.u() < OJS_M)) continue;
    const i = (sl / 3) | 0, k = sl % 3;
    const cur = WAGE()[k][i] - cross(i, EMP()[k][i], WAGE()[k][i]);
    const job = bestJob(i, k);
    if (!job || !(job.value > cur * (1 + QUIT_GAIN))) continue;
    const old = IND()[k][i];
    V[old] += r.a!.wt[i];
    place(i, k, job);
    r.flow.hires = (r.flow.hires ?? 0) - r.a!.wt[i];
    r.flow.quits = (r.flow.quits ?? 0) + r.a!.wt[i];
  }
  // 3b. the jobless, at the finding rate, where there is a vacancy; the rest a month longer out
  const jobless: number[] = [];
  for (let i = 0; i < r.n; i++) for (let k = 0; k < 3; k++) if (EMP()[k][i] === EMP_UNEMP) jobless.push(3 * i + k);
  for (const sl of shuffle(jobless)) {
    const i = (sl / 3) | 0, k = sl % 3;
    const hire = R.u() < UE_RATE, scar = R.n();
    const job = hire ? bestJob(i, k) : null;
    // a returning worker takes a small cut in pay (job-loss scarring, Jacobson-LaLonde-Sullivan 1993) [S]
    if (job) { place(i, k, job); WAGE()[k][i] *= Math.exp(-0.03 + 0.08 * scar); }
    else if (UN()[k][i] < 65535) UN()[k][i]++;
  }
  // 4. households arriving for the work the town's own people did not take
  const wR = r.wRegion, H = homeMarket(e);
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
      b.emp1[i] = firmIn(ind); b.ind1[i] = ind; b.wage1[i] = D.pay[ind] * f1;
      V[ind] -= wR;
      if (b.adults[i] >= 2 && R.u() < 0.70) {
        const j = pickInd(wR);
        const f2 = Math.exp(WAGE_SIGMA * R.n() - WAGE_SIGMA * WAGE_SIGMA / 2);
        if (j >= 0) { b.emp2[i] = firmIn(j); b.ind2[i] = j; b.wage2[i] = D.pay[j] * f2; V[j] -= wR; }
        else { b.emp2[i] = EMP_UNEMP; b.un2[i] = 1; b.wage2[i] = D.pay[ind] * f2; }
      }
      // its other adult (a grown child, a relative) looks for work here too, at the rate for everyone over 16
      if (b.adults[i] >= 3 && R.u() < OTHER_LF) {
        b.emp3[i] = EMP_UNEMP; b.un3[i] = UI_MONTHS + 1;
        b.wage3[i] = 0.64 * medianIncome(e) * payShare(b, i, 2);
      }
      fillMoney(R, b, i, b.wage1[i] + b.wage2[i], false, e);
      b.ten[i] = TEN_MAINLAND; b.rent[i] = mainlandRent(R, r.mainRent, b, i);
      r.flow.arrived = (r.flow.arrived ?? 0) + wR;
      // AN ARRIVAL MAY HAVE OWNED WHERE IT CAME FROM (households stage 2): at
      // the nation's ownership for its age (OWN_BY_AGE), it sold and brings the
      // equity, and decides here as any renter does (`buyCheck`, the taste for
      // owning). Without it every household that came for work came to rent,
      // and a growing region's ownership fell for ever (measured, 65.6% -> 54%
      // in fifteen years).
      if (R.u() < OWN_BY_AGE[ageBand(b.age[i])]) b.sav[i] += EQUITY_PAY * (b.wage1[i] + b.wage2[i]);
      if (r.ownMu !== undefined) {
        const c = buyCheck(b, i, H, b.rent[i]);
        if (c !== null && r.ownMu + OWN_SIGMA * R.n() >= c) { buyHome(r, b, i, H, s.month); r.flow.bought = (r.flow.bought ?? 0) + wR; }
      }
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
    const EMPc = [c.emp1, c.emp2, c.emp3], INDc = [c.ind1, c.ind2, c.ind3], WAGEc = [c.wage1, c.wage2, c.wage3];
    for (let i = 0; i < r.n; i++) for (let k = 0; k < 3; k++) {
      const ind = INDc[k][i];
      if (!isPlaced(EMPc[k][i]) || ind === IND_NONE) continue;
      sw[ind] += c.wt[i] * WAGEc[k][i]; sn[ind] += c.wt[i];
    }
    const scale = Float64Array.from(sw, (v, ind) => v > 0 ? D.pay[ind] * sn[ind] / v : 1);
    for (let i = 0; i < r.n; i++) for (let k = 0; k < 3; k++) {
      const ind = INDc[k][i];
      if (isPlaced(EMPc[k][i]) && ind !== IND_NONE) WAGEc[k][i] *= scale[ind];
    }
  }
  // the firms that cut, to the cause ledger: the island's named firms that let
  // the most go this month (at most a dozen), each caused by the customer it
  // lost (economy.ts whyFirmLoss) or else its industry's month
  if (laid.size) {
    const names = firmNamesOf(s);
    const top = [...laid.entries()].filter(([c, w]) => c >= 0 && w >= 1 && grow(c).h < grow(c).p).sort((p, q) => q[1] - p[1]).slice(0, 12);
    const ids: Record<number, number> = {};
    for (const [code, w] of top) {
      const name = names.get(code) ?? "A firm";
      const indOf = D.codes.findIndex((l) => l.includes(code));
      const { h, p } = grow(code);
      ids[code] = why(s, {
        k: "firm.layoff", a: "firm", aid: String(code), name,
        n: { workers: Math.round(w), headsBefore: Math.round(p), heads: Math.round(h) },
        t: `${name} laid off ${Math.round(w)} worker${Math.round(w) === 1 ? "" : "s"} · heads ${Math.round(p)} → ${Math.round(h)}`,
      }, [whyFirmLoss(s, code) ?? (indOf >= 0 ? whyIndustry(s, indOf) : undefined)]);
    }
    r.layoffWhy = ids;
  } else r.layoffWhy = {};
  const nowHc: Record<number, number> = {};
  for (const [c, h] of D.hc) nowHc[c] = +h.toFixed(2);
  r.firmHc = nowHc;
  // 6. who leaves: nobody in work, insurance run out — an island renter too
  // (households stage 2: its flat empties and is let again from across the
  // water). A jobless other adult past six months out leaves on its own.
  const leave: number[] = [];
  const c = r.a!;
  for (let i = 0; i < n0; i++) {
    const e1 = c.emp1[i], e2 = c.emp2[i], e3 = c.emp3[i];
    if (e3 === EMP_UNEMP && c.un3[i] > UI_MONTHS && R.u() < LEAVE_JOBLESS_M) {
      c.adults[i] = Math.max(1, c.adults[i] - 1); c.emp3[i] = EMP_NONE; c.wage3[i] = 0; c.un3[i] = 0; c.ind3[i] = IND_NONE;
    }
    if (isWorking(e1) || isWorking(e2) || isWorking(c.emp3[i])) continue;
    const out = (e1 === EMP_UNEMP && c.un1[i] > UI_MONTHS) || (e2 === EMP_UNEMP && c.un2[i] > UI_MONTHS);
    if (out && R.u() < LEAVE_JOBLESS_M) {
      leave.push(i); r.flow.left = (r.flow.left ?? 0) + c.wt[i];
      if (c.ten[i] === TEN_RENT) {
        r.flow.movedOut += c.wt[i];
        const ind = c.ind1[i];
        noteOut(r, i, "jobloss", () => ({
          n: { monthsOut: c.un1[i] },
          t: `A household left town after ${c.un1[i]} months out of work${ind !== IND_NONE ? ` (${INDUSTRIES[INDUSTRY_IDS[ind]].label.toLowerCase()})` : ""}`,
          cause: ind !== IND_NONE ? whyIndustry(s, ind) : undefined,
        }));
      }
    }
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
  // THE HOUSEHOLDS LET THE STREET'S FLATS (stage 2): once they have made their
  // first choices, a street block's flats are let to the households that
  // choose it and empty when they leave; the rolls are written from them
  const byHH = !!D && r.locMu !== undefined && !!e_flatRolls(s);
  const B = readBlocks(s, parcels, r, byHH);
  r.flow = {
    movedOut: 0, movedIn: 0, evictions: 0, foreclosures: 0, spend: 0, income: 0, arrived: 0, left: 0, bought: 0, sold: 0,
    out: zeroOut(), leaseEnds: 0, leaseMoves: 0, formed: 0, rebought: 0, hires: 0, quits: 0, layoffs: 0,
  };
  MINE = new Set(Object.keys(s.holdings ?? {}));
  OUTS = new Map();
  PENDING = -1;
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
      if (x !== EMP_UNEMP && ((D && isPlaced(x) && !D.live.has(x)) || R.u() < SEP_RATE)) { emp[i] = EMP_UNEMP; un_[i] = 0; r.flow.layoffs! += a.wt[i]; }
      lf += a.wt[i];
      if (emp[i] === EMP_UNEMP) un += a.wt[i];
    };
    for (let i = 0; i < n0; i++) {
      a.wage1[i] *= gW; a.wage2[i] *= gW; a.wage3[i] *= gW; a.yperm[i] *= gW;
      if (a.ten[i] === TEN_MAINLAND) a.rent[i] *= gC;
      if (a.ten[i] === TEN_OWN) a.hval[i] *= gH;
      lose(a.emp1, a.un1, i); lose(a.emp2, a.un2, i); lose(a.emp3, a.un3, i);
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
      if (a.emp3[i] === EMP_UNEMP) findWork(R, find, a.emp3, a.wage3, a.un3, i);
    }
  }

  const persons = (i: number) => a.adults[i] + a.kids[i];
  const H = homeMarket(e);
  const atStart = new Map<number, number>();
  for (let i = 0; i < n1; i++) if (a.ten[i] === TEN_RENT) atStart.set(a.blk[i], (atStart.get(a.blk[i]) ?? 0) + 1);
  let letSum = 0, letN = 0;
  for (const b of B.list) { letSum += b.target * b.let; letN += b.target; }
  const letAvg = letN > 0 ? letSum / letN : r.mainRent;
  CTX = { e, letAvg };
  const fmt = (x: number) => Math.round(x).toLocaleString("en-US");
  // the region's renter households across the water: where the island's movers come from and go back to
  const pool: number[] = [];
  for (let i = 0; i < n1; i++) if (!gone[i] && a.ten[i] === TEN_MAINLAND) pool.push(i);
  for (let i = 0; i < n1; i++) {
    if (gone[i]) continue;
    const w = a.wt[i];
    // income
    const gross = grossOf(a, i);
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
    // first; most who default have no liquid assets left). The subsistence
    // floor holds while there is money for it after the rent; under it, a
    // household lives on what is left (and on what the register does not yet
    // carry: SNAP, the food bank, family) and falls behind only when the rent
    // itself cannot be met.
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
    // WHAT IS OWED, IN DOLLARS (stage 2): the part of the rent or the payment
    // that could not be met is owed, and is paid back first out of what is
    // left over a month's subsistence.
    let unpaid = 0;
    if (cash < -1) { unpaid = housing > 0 ? Math.min(housing, -cash) : 0; cash = 0; }
    else if (a.owed[i] > 0) { const p = Math.min(a.owed[i], Math.max(0, cash - sub)); a.owed[i] -= p; cash -= p; if (a.owed[i] < 1) a.owed[i] = 0; }
    else if (cash > 1.5 * target && a.debt[i] > 0) { const p = Math.min(a.debt[i], cash - target); a.debt[i] -= p; cash -= p; }
    a.owed[i] += unpaid;
    a.sav[i] = cash;
    r.flow.spend += w * spend; r.flow.income += w * net;
    // the mortgage amortises on a month paid
    if (ten === TEN_OWN && a.mort[i] > 0 && !(unpaid > 0)) {
      const princ = a.mortPmt[i] - (a.mort[i] * a.mortRate[i]) / 12;
      a.mort[i] = Math.max(0, a.mort[i] - Math.max(0, princ));
      if (a.mort[i] <= 1) { a.mort[i] = 0; a.mortPmt[i] = 0; }
    }
    // arrears (months with something owed) and the credit record
    if (a.owed[i] > 0) { if (a.arrears[i] < 255) a.arrears[i]++; } else a.arrears[i] = 0;
    if (unpaid > 0) {
      if (a.arrears[i] === 2 && a.credit[i] < 3) a.credit[i]++;
      a.clean[i] = 0;
    } else if (!(a.owed[i] > 0)) {
      if (a.clean[i] < 255) a.clean[i]++;
      if (a.clean[i] >= 36 && a.credit[i] > 0) { a.credit[i]--; a.clean[i] = 0; }
    }
    if ((ten === TEN_RENT || ten === TEN_MAINLAND) && a.arrears[i] >= EVICT_M && a.owed[i] >= EVICT_OWED * a.rent[i]) {
      r.flow.evictions += w;
      const owed = a.owed[i], months = a.arrears[i];
      // the landlord writes the arrears off: most eviction judgments are never collected (Desmond 2016)
      a.owed[i] = 0; a.arrears[i] = 0;
      if (ten === TEN_RENT) {
        r.flow.movedOut += w;
        noteOut(r, i, "evict", () => ({ n: { owed, months }, t: `A household was evicted · $${fmt(owed)} owed after ${months} months behind` }));
      }
      // AN EVICTED HOUSEHOLD THAT STILL HAS AN INCOME RENTS AGAIN, CHEAPER
      // (step 2): most evicted families move to worse and cheaper housing in
      // the same region; doubling up is what the ones with nothing coming in
      // do (Desmond 2016, Milwaukee Area Renters Study) — here, a flat across
      // the water at the rent its pay can carry at the median burden (30%,
      // HH_RENT_SHARE0).
      const pay = payOf(a, i);
      if (gross > 0 && pay > 0) {
        if (ten === TEN_RENT) { r.flow.movedOut -= w; toMainland(R, r, i, pool, gone, false); continue; }
        a.rent[i] = Math.min(a.rent[i], (HH_RENT_SHARE0 * pay) / 12);
      } else { a.ten[i] = TEN_DOUBLED; a.rent[i] = 0; a.blk[i] = -1; }
    } else if (ten === TEN_OWN && a.arrears[i] >= FORECLOSE_M && a.owed[i] >= FORECLOSE_OWED * Math.max(1, housing)) {
      r.flow.foreclosures += w;
      a.owed[i] = 0; a.arrears[i] = 0; a.ten[i] = TEN_DOUBLED; a.mort[i] = 0; a.mortPmt[i] = 0; a.hval[i] = 0;
    } else if (ten === TEN_DOUBLED && (isWorking(a.emp1[i]) || isWorking(a.emp2[i])) && a.sav[i] > 3 * r.mainRent) {
      // a doubled-up household with work and a deposit takes its own flat across the water
      a.ten[i] = TEN_MAINLAND; a.rent[i] = mainlandRent(R, r.mainRent, a, i);
    }
    // a year older on its month — and past fifty, at its age's rate, retired (LF_AGE)
    if ((m + a.id[i]) % 12 === 0 && a.age[i] < 110) {
      a.age[i]++;
      if (a.age[i] > LF_AGE[0][0]) {
        const h = 1 - lfAge(a.age[i]) / lfAge(a.age[i] - 1);
        if (R.u() < h) retire(a.emp1, a.wage1, i);
        if (R.u() < h) retire(a.emp2, a.wage2, i);
      }
    }
    if (a.adults[i] >= 2 && a.age[i] >= 20 && a.age[i] < 43 && a.kids[i] < 6 && R.u() < BIRTH_M) a.kids[i]++;
    // a child comes of age: an adult at home, looking for work at the rate for everyone over 16
    if (a.kids[i] > 0 && a.age[i] >= 45 && R.u() < LEAVE_M * a.kids[i]) {
      a.kids[i]--;
      if (a.adults[i] < 250) a.adults[i]++;
      if (a.emp3[i] === EMP_NONE && R.u() < OTHER_LF) {
        a.emp3[i] = EMP_UNEMP; a.un3[i] = UI_MONTHS + 1; a.ind3[i] = IND_NONE;   // a new entrant draws no insurance
        // a young worker earns about two thirds of the median (BLS: median weekly earnings 20-24 ~64% of all full-time workers', 2023) [S]
        a.wage3[i] = 0.64 * medianIncome(e) * payShare(a, i, 2);
      }
    }
    // a grown child with work leaves to form its own household, if its pay carries a flat across the water
    // (at the cheap end of the mainland's rents, the 25th percentile of their spread)
    if (a.adults[i] >= 3 && isWorking(a.emp3[i]) && R.u() < FORM_M && 12 * r.mainRent * Math.exp(-0.674 * 0.25) <= SCREEN * a.wage3[i]) {
      formFromChild(R, r, i, e, pool, gone);
    }
    // a death: the household ends with its last adult, else it goes on without the partner
    if (a.age[i] >= 65 && R.u() < dissolveM(a.age[i])) {
      if (a.adults[i] >= 2) {
        a.adults[i]--;
        a.emp2[i] = EMP_NONE; a.wage2[i] = 0; a.un2[i] = 0; a.ind2[i] = IND_NONE;
      } else {
        if (a.ten[i] === TEN_RENT) {
          r.flow.movedOut += w;
          const age = a.age[i];
          noteOut(r, i, "ended", () => ({ n: { age }, t: `A household ended · its last member died at ${age}` }));
        }
        gone[i] = 1;
      }
    }
  }

  // ---- who owns and who rents (stage 2), then the island's blocks: leases
  // ending in a decision, then each block to the flats its roll has let —
  // its movers in from across the water and out to it (`moveIn`, `toMainland`)
  if (D) tickTenure(R, r, e, gone, H, m);
  // the renters across the water who want an island flat at the going rent: who a flat let goes to first
  const want: number[] = [];
  for (const i of pool) {
    if (gone[i] || a.ten[i] !== TEN_MAINLAND) continue;
    ensureTaste(R, a, i);
    if (r.locMu !== undefined && wantsIsland(r, a, i, e, letAvg, -MOVE_LOG)) want.push(i);
  }
  const inBlock = new Map<number, number[]>();
  for (let i = 0; i < n1; i++) {
    if (a.ten[i] !== TEN_RENT || gone[i]) continue;
    const w = a.wt[i];
    const b = B.byIdx.get(a.blk[i]);
    if (!b) { noteOut(r, i, "other", () => ({ n: {}, t: "A household moved out of a block being emptied" })); toMainland(R, r, i, pool, gone); continue; }
    ensureTaste(R, a, i);
    if (a.leaseEnd[i] <= m) {
      // RENEW OR MOVE (stage 2): buy, choose the mainland at the renewal rent, or move for another reason
      r.flow.leaseEnds! += w;
      const renew = Math.max(a.rent[i] * 0.97, b.let * 0.97);
      const c = D && r.ownMu !== undefined ? buyCheck(a, i, H, renew) : null;
      if (c !== null && r.ownMu! + OWN_SIGMA * R.n() >= c) {
        const j = ownerLike(R, r, i, gone);
        if (j >= 0) {
          noteOut(r, i, "buy", () => ({ n: { price: H.starter, rate: H.rate }, t: `A household bought a home · starter homes from $${fmt(H.starter)} at ${(100 * H.rate).toFixed(1)}%` }));
          (r.buyers ??= []).push({ m, inc: lendPay(a, i), w });
          a.wt[j] += w; gone[i] = 1;
          r.flow.movedOut += w; r.flow.bought! += w; r.flow.leaseMoves! += w;
          continue;
        }
      }
      if (!wantsIsland(r, a, i, e, renew, MOVE_LOG)) {
        const up = renew / Math.max(1, a.rent[i]) - 1, sav = commuteSaving(a, i, e), pay = payOf(a, i);
        const priced = !(pay > 0) || (12 * renew) / pay > SCREEN;
        const reason: MoveReason = priced ? "afford" : sav < 0 && up < 0.03 ? "job" : "rent";
        noteOut(r, i, reason, (): Omit<OutNote, "i" | "reason"> => reason === "job"
          ? { n: { commute: -sav }, t: `A household moved closer to work across the water · the crossing cost it $${fmt(-sav)} a month` }
          : reason === "afford"
            ? { n: { rent: renew, pay }, t: `A household could no longer carry the rent · $${fmt(renew)} a month on $${fmt(pay)} a year` }
            : { n: { rentUp: up, rent: renew }, t: `A household left at renewal · rent ${up >= 0 ? "up" : "down"} ${Math.abs(100 * up).toFixed(0)}% to $${fmt(renew)} a month, dearer than across the water` });
        r.flow.leaseMoves! += w;
        toMainland(R, r, i, pool, gone, false);
        continue;
      }
      if (R.u() < RESID_MOVE) {
        noteOut(r, i, "other", () => ({ n: {}, t: "A household moved for family or other reasons" }));
        r.flow.leaseMoves! += w;
        toMainland(R, r, i, pool, gone, true);
        continue;
      }
      a.rent[i] = renew;
      a.leaseEnd[i] = m + 12;
      if (byHH && b.street) recordDeal(e, "multifamily", m, (b.rel ?? 1) * renew / Math.max(1, b.let), b.unitSf * w, true);
    }
    const l = inBlock.get(b.idx);
    if (l) l.push(i); else inBlock.set(b.idx, [i]);
  }
  // THE STREET'S EMPTY FLATS, AND THE HOUSEHOLDS LOOKING FOR ONE (stage 2).
  // A block that shrank (rebuilt smaller) gives notice to the households it
  // can no longer hold; then each household across the water that wants an
  // island flat looks, as a mover with a broker does, at a shortlist of the
  // blocks with flats empty since before this month (a freed flat is made
  // ready first) — drawn by how well each draws movers (its score, how long
  // it has stood empty, its owner's care: streetRolls) — and takes the first
  // it would pay for, up to each block's letting pace. A flat nobody chooses
  // stands empty, and its rent answers.
  const rooms: { b: Block; room: number }[] = [];
  for (const b of B.list) {
    if (!(byHH && b.street)) continue;
    const l = inBlock.get(b.idx) ?? [];
    const cap = Math.floor((b.capU ?? 0) / r.wIsland);
    let extra = l.length - cap;
    while (extra > 0) {
      const k = Math.floor(R.u() * l.length);
      const i = l[k]; l[k] = l[l.length - 1]; l.pop();
      noteOut(r, i, "other", () => ({ n: {}, t: "A household moved out of a block being rebuilt" }));
      toMainland(R, r, i, pool, gone, true); extra--;
    }
    const room = Math.max(0, Math.min(cap - (atStart.get(b.idx) ?? 0), cap - l.length, Math.floor((b.limU ?? 2) / r.wIsland)));
    if (room > 0) rooms.push({ b, room });
  }
  if (rooms.length) {
    let wTot = rooms.reduce((t, x) => t + (x.b.w ?? 1), 0);
    const pickRoom = () => { let u = R.u() * wTot; for (const x of rooms) { if (x.room <= 0) continue; u -= x.b.w ?? 1; if (u <= 0) return x; } return rooms.find((x) => x.room > 0); };
    const seekers = want.slice();
    for (let j = seekers.length - 1; j > 0; j--) { const q = Math.floor(R.u() * (j + 1)); const t = seekers[j]; seekers[j] = seekers[q]; seekers[q] = t; }
    for (const c of seekers) {
      // each whole household the agent stands for looks once
      for (let h = Math.floor(r.a!.wt[c] / r.wIsland); h > 0 && wTot > 0 && !(c < gone.length && gone[c]); h--) {
        let took = false;
        for (let k = 0; k < SHORTLIST; k++) {
          const x = pickRoom();
          if (!x) break;
          if (!letTo(R, r, x.b, e, m, [c], gone)) continue;
          recordDeal(e, "multifamily", m, x.b.rel ?? 1, x.b.unitSf * r.wIsland);
          if (--x.room <= 0) wTot -= x.b.w ?? 1;
          took = true; break;
        }
        if (!took) break;
      }
    }
  }
  for (const b of B.list) {
    if (byHH && b.street) continue;
    const l = inBlock.get(b.idx) ?? [];
    let extra = l.length - b.target;
    // fewer households than the roll: those leaving are drawn at random
    while (extra > 0) {
      const k = Math.floor(R.u() * l.length);
      const i = l[k]; l[k] = l[l.length - 1]; l.pop();
      toMainland(R, r, i, pool, gone, false); extra--;
    }
    for (let k = 0; k < -extra; k++) moveIn(R, r, b, e, m, pool, want, gone);
  }
  compact(r, gone);
  // the region's households: what the island's renters do not account for —
  // until the firm books open. From then the region's households are the
  // ones the work brought and kept (matchJobs), each standing for the weight
  // it had then: re-weighting them to the engine's population every month
  // would undo every arrival and departure.
  if (!D) {
    const Hh = (e.population ?? 0) / HH_SIZE;
    let islandW = 0, nReg = 0;
    const A = r.a!;
    for (let i = 0; i < r.n; i++) if (A.ten[i] === TEN_RENT) islandW += A.wt[i]; else nReg++;
    r.wRegion = Math.max(0.01, (Hh - islandW) / Math.max(1, nReg));
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
    const leaving = matchJobs(s, R, r, D, e, nOld);
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
    let ppl = 0;
    for (let i = 0; i < r.n; i++) ppl += r.a!.wt[i] * (r.a!.adults[i] + r.a!.kids[i]);
    const agents = Math.round((ppl * wave) / HH_SIZE / Math.max(0.01, r.wRegion));
    for (let k = 0; k < agents; k++) {
      const i = addAgent(r), b = r.a!;
      const income = r.renterInc * medianIncome(e) * Math.exp(INCOME_SIGMA * R.n());
      fillPeople(R, b, i, AGE_RENT.slice(0, 5).map((x) => x / 0.86).concat([0]), income, e, 1);
      fillMoney(R, b, i, income, false, e);
      b.wt[i] = r.wRegion; b.ten[i] = TEN_MAINLAND; b.rent[i] = mainlandRent(R, r.mainRent, b, i);
      r.flow.arrived = (r.flow.arrived ?? 0) + r.wRegion;
    }
  }
  // ---- THE FLATS' DEMAND (stage 2): the renter households that want an
  // island flat — an island renter at its own block's going rent, a renter
  // across the water at the island's average — read by market.ts next month.
  {
    const A = r.a!;
    const letById = new Map<number, number>();
    for (const b of B.list) letById.set(b.idx, b.let);
    const letOf = (i: number) => (A.ten[i] === TEN_RENT ? letById.get(A.blk[i]) ?? letAvg : letAvg);
    let island = 0;
    for (let i = 0; i < r.n; i++) {
      if (A.ten[i] !== TEN_RENT && A.ten[i] !== TEN_MAINLAND) continue;
      ensureTaste(R, A, i);
      if (A.ten[i] === TEN_RENT) island += A.wt[i];
    }
    if (D && r.locMu === undefined && letN > 0) { r.locMu = solveLocMu(r, e, letOf); sortOpening(R, r, e, letOf); }
    // An island renter is demand while it would stay at the rent its lease
    // holds it to (moving out costs it MOVE_LOG) — the asking rent reaches it
    // only at its renewal, where it decides again; reading the asking rent
    // for every sitting tenant made demand jump with each repricing and the
    // flats ran 28% empty and 2% empty by turns. A renter across the water while it
    // would move in at the island's (moving in costs the same). Counting every
    // sitting tenant as demand whatever it thought of its rent was tried: the
    // flats the market held let then went to whoever was across the water,
    // wanting the island or not, who left at the next renewal — the island's
    // renters turned over 80% a year and its demand never fell.
    let seekW = 0;
    if (r.locMu !== undefined) {
      let wantW = 0;
      for (let i = 0; i < r.n; i++) {
        const t = A.ten[i];
        if (t === TEN_RENT ? wantsIsland(r, A, i, e, A.rent[i], MOVE_LOG) : t === TEN_MAINLAND && wantsIsland(r, A, i, e, letAvg, -MOVE_LOG)) {
          wantW += A.wt[i];
          if (t === TEN_MAINLAND) seekW += A.wt[i];
        }
      }
      r.islandWant = wantW;
    }
    if (byHH) writeRolls(s, r, B, seekW);
    // the renewals and the turnover, as the street's rolls and the player's flats read them (rolled over six months)
    const fl = r.flow;
    if ((fl.leaseEnds ?? 0) > 0) {
      const x = fl.leaseMoves! / fl.leaseEnds!;
      r.leaseMoveRate = r.leaseMoveRate === undefined ? x : r.leaseMoveRate + (x - r.leaseMoveRate) / 6;
    }
    if (island > 0) {
      const decided = MOVE_REASONS.reduce((t, k) => t + (fl.out?.[k] ?? 0), 0);
      const y = (12 * decided) / island;
      r.moveOutYr = r.moveOutYr === undefined ? y : r.moveOutYr + (y - r.moveOutYr) / 6;
    }
    if (r.buyers) r.buyers = r.buyers.filter((x) => x.m > m - 12);
  }
  writeOutWhy(s, parcels, r);
  OUTS = null; MINE = null; CTX = null;
  R.done();
}

/**
 * THE STREET'S ROLLS, AS ITS HOUSEHOLDS HOLD THEM (stage 2): each street
 * block's leases are its households' (feet, rent a foot a year, the month the
 * lease ends), and the street's let, its capacity and the feet the households
 * across the water are looking for go to the space market (market.ts reads
 * `flatSpace` as it reads the firms' `streetSpace`).
 */
function writeRolls(s: GameState, r: HouseholdRegister, B: { list: Block[] }, seekW: number) {
  const e = s.econ, a = r.a!, rolls = e.flatRolls!;
  const cohorts = new Map<number, Map<string, { sf: number; rent: number; endM: number }>>();
  const byIdx = new Map<number, Block>();
  for (const b of B.list) if (b.street) byIdx.set(b.idx, b);
  for (let i = 0; i < r.n; i++) {
    if (a.ten[i] !== TEN_RENT) continue;
    const b = byIdx.get(a.blk[i]);
    if (!b) continue;
    const rent = +((12 * a.rent[i]) / b.unitSf).toFixed(2), key = `${a.leaseEnd[i]}|${rent}`;
    let c = cohorts.get(b.idx);
    if (!c) { c = new Map(); cohorts.set(b.idx, c); }
    const x = c.get(key);
    if (x) x.sf += a.wt[i] * b.unitSf; else c.set(key, { sf: a.wt[i] * b.unitSf, rent, endM: a.leaseEnd[i] });
  }
  let let_ = 0, cap = 0, unit = 0;
  for (const b of byIdx.values()) {
    const roll = rolls[r.blocks[b.idx]];
    if (!roll) continue;
    const l = [...(cohorts.get(b.idx)?.values() ?? [])].map((x) => ({ ...x, sf: Math.round(x.sf) }));
    roll.l = l;
    roll.occ = l.reduce((t, x) => t + x.sf, 0);
    const capSf = (b.capU ?? 0) * b.unitSf;
    const vacant = capSf - roll.occ > b.unitSf;
    if (vacant && roll.vac === undefined) roll.vac = s.month;
    else if (!vacant) delete roll.vac;
    let_ += roll.occ; cap += capSf; unit += capSf / Math.max(1, b.capU ?? 1);
  }
  const avgUnit = byIdx.size ? unit / byIdx.size : 850;
  e.flatSpace = { let: let_, cap, seek: seekW * avgUnit };
  // ...and the street's turnover is theirs (market.ts turnoverYr: the flats between tenants)
  if (r.moveOutYr !== undefined) (e.turnMeas ??= {}).multifamily = r.moveOutYr;
}

function e_flatRolls(s: GameState) { return s.econ.flatRolls && Object.keys(s.econ.flatRolls).length > 0; }

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
  const gross = grossOf(a, i);
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
    for (const emp of [a.emp1, a.emp2, a.emp3]) { const x = emp[i]; if (x !== EMP_NONE && x !== EMP_RETIRED) { lf += w; if (x === EMP_UNEMP) un += w; else employed += w; } }
    if (a.arrears[i] > 0) arrears += w;
    if (a.debt[i] > 0) withDebt += w;
    const inc = incomeYear(a.emp1[i], a.wage1[i], a.un1[i]) + incomeYear(a.emp2[i], a.wage2[i], a.un2[i]) + incomeYear(a.emp3[i], a.wage3[i], a.un3[i]);
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
    const gross = slot(a.emp1[i], a.wage1[i], a.un1[i], w) + slot(a.emp2[i], a.wage2[i], a.un2[i], w) + slot(a.emp3[i], a.wage3[i], a.un3[i], w);
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
  /** the people and children in the island's flats (the island renters' households) */
  islandPersons: number; islandKids: number;
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
  const out: RegisterLabour = { employed: 0, unemployed: 0, lf: 0, persons: 0, households: 0, ages: { kids: 0, work: 0, old: 0 }, islandRenters: 0, mainlandRenters: 0, owners: 0, doubled: 0, islandPersons: 0, islandKids: 0 };
  for (let i = 0; i < r.n; i++) {
    const w = a.wt[i];
    out.households += w;
    out.persons += w * (a.adults[i] + a.kids[i]);
    out.ages.kids += w * a.kids[i];
    if (a.age[i] >= 65) out.ages.old += w * a.adults[i]; else out.ages.work += w * a.adults[i];
    const t = a.ten[i];
    if (t === TEN_RENT) { out.islandRenters += w; out.islandPersons += w * (a.adults[i] + a.kids[i]); out.islandKids += w * a.kids[i]; } else if (t === TEN_MAINLAND) out.mainlandRenters += w; else if (t === TEN_OWN) out.owners += w; else out.doubled += w;
    for (const x of [a.emp1[i], a.emp2[i], a.emp3[i]]) {
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
    if (isPlaced(a.emp3[i]) && a.ind3[i] !== IND_NONE) { wages[a.ind3[i]] += w * a.wage3[i] / 12; earners[a.ind3[i]] += w; }
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
