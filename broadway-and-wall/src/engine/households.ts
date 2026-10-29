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
// STAGES 4-5 (2026-10-29): LIFE AND SPENDING. Every person dies at its age's
// rate (CDC life table), children are born at their mother's age's rate (CDC
// NVSS) and come of age at eighteen, singles move in together and couples
// part at the record's rates by age, a widow keeps the larger pension; the
// age pyramid is what those and the people the work brings make
// (`registerPyramid`, tools/households-life.mjs). Each household's spending
// goes to the categories households of its income buy (BLS CE by quintile,
// `bookSpend`), and the firms' household sales are those categories' sum
// (economy.ts `spendVector`); SNAP and the EITC reach the households whose
// means qualify them (`fedTransfers`). A category's spending falling with job
// losses is written to the cause ledger (`rollSpendYear`, `whyHouseholdSpend`).
//
// STAGE 6 (2026-10-29): WHO LIVES WITH WHOM, AND SAVING TO BUY. A young adult
// at home joins the labour force as its age's participation rises
// (`YOUNG_LF`) and leaves home at the CPS rate over all of them — to a
// partner, a roommate or alone, each only if it can (`formFromChild`); a
// household that moves joins only an agent alike in age and make-up
// (`alike`); singles meet partners by households, not agents (`unite`); a
// renter that plans to buy saves for the down payment (`DOWN_SAVE`); the
// opening's owners are drawn by age band (OWN_BY_AGE); SNAP and the EITC
// reach the share of the eligible that claim them (`takesUp`). Measured over
// thirty years (tools/households-life.mjs, seed 550991): living alone 20% ->
// 34% (was -> 38%; CPS 28%), adults a household 1.93 (1.95), 18-34-year-olds
// 20% of people (was 17%; Census 22.6%). Ownership still falls, 65% -> 56%:
// the down payment is not what binds (two in five renters 25-44 hold it; one
// in four passes the lender's payment test; see DOWN_SAVE).
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
import { why, whyOnce } from "./why";
import { whyIndustry, whyFirmLoss, firmNamesOf, whyTown } from "./economy";
import { INDUSTRIES, INDUSTRY_IDS, N_IND, COMP_PER_WORKER_2023, PAY_SPLIT, type SpendCategory } from "./industries";

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
/** Share of owner households with a mortgage: 62% (ACS 2023, B25081). [S] */
const MORTGAGED = 0.62;
/**
 * RENEW OR MOVE (households stage 2, 2026-10-29). A renter whose lease ends
 * decides: it buys if it can (`tryBuy`), it leaves the island if the flat no
 * longer beats a flat across the water at the renewal rent and its commute
 * (`islandPull`), it leaves town when out of work (`matchJobs`), and it moves
 * for the reasons this register does not model at RESID_MOVE. The CPS ASEC
 * reasons for moving (2019, all movers): other family reasons ~12%, wanted a
 * new or better home ~15%, a better neighbourhood ~4%, other housing reasons
 * ~8%, other ~12% — about 51% of all moves, none of them a choice this
 * register makes — of the ~45% of renter households that move in a year
 * (NMHC; Census AHS) = 0.23 [S~]. (A change in marital status, ~5% more, was
 * in it until households stage 4: unions and splits are the register's own.) Such a mover
 * still wants an island flat, so most of these are moves from one island flat
 * to another (turnover without a household less). Replaces leasing.ts
 * MF_TURNOVER and the street's 0.22 + out + buy + jobs (FORMULA_LEDGER #11).
 */
const RESID_MOVE = 0.51 * 0.45;
/**
 * OWNERS WHO MOVE: about 5% of owner households a year (CPS ASEC geographic
 * mobility 2015-19), and about a third of those movers rent where they land:
 * 1.7% a year sell and rent again; the other 3.3% buy again — repeat buyers,
 * who are no change of tenure but are half the market a builder sells into
 * (`buyers`, homeprice.ts salesPace). [S~]
 *
 * BY THE HOUSEHOLDER'S AGE (households stage 4): owners' moves fall with age
 * as everyone's do — CPS ASEC 2019 movers by householder's age, <25 ~35%,
 * 25-34 ~22%, 35-44 ~12%, 45-54 ~8%, 55-64 ~6%, 65+ ~4% of households — so
 * each band's owners move at that profile, scaled to average 5% over the
 * nation's owners by age (ACS 2023: <25 2%, 25-34 9%, 35-44 16%, 45-54 18%,
 * 55-64 22%, 65+ 33%) [S~]. One rate for every age (stage 2) moved an owner of
 * 70 out of owning as often as one of 30 while nobody past working age could
 * buy: measured, the 65+ ownership rate fell from 83% to 56% in forty years
 * against the HVS's steady 79%.
 */
const OWN_MOVE_YR = (() => {
  const prof = [0.35, 0.22, 0.12, 0.08, 0.06, 0.04], mix = [0.02, 0.09, 0.16, 0.18, 0.22, 0.33];
  const avg = prof.reduce((t, p, k) => t + p * mix[k], 0);
  return prof.map((p) => (0.05 * p) / avg);
})();
const SELL_SHARE = 0.017 / 0.05;
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
 * A YOUNG ADULT AT HOME JOINS THE LABOUR FORCE AS IT AGES (households stage
 * 6): participation by age, BLS CPS 2023 annual averages — 18-19 about 50%
 * (16-19 37%, 16-17 about a quarter), 20-24 71%, 25-34 83% — log-linear
 * between the bands' middles [S~]. A child comes of age in the labour force
 * at eighteen's rate, and one still out of it (in school, most of them)
 * joins on each birthday at the hazard the curve rises by. Stages 4-5 gave a
 * child of eighteen one draw at the rate for everyone over 16 (OTHER_LF) and
 * none after: the 37% who drew "out" stayed out, and at home, for life —
 * measured, the share of 18-34-year-olds living with their parents rose
 * from 42% to 61% in ten years against the CPS's ~33%, and only 46% of them
 * worked.
 */
const YOUNG_LF: [number, number][] = [[18.5, 0.50], [22, 0.713], [29.5, 0.83]];
function youngLf(age: number): number {
  const L = YOUNG_LF;
  if (age <= L[0][0]) return L[0][1];
  for (let k = 1; k < L.length; k++) {
    const [a1, v1] = L[k], [a0, v0] = L[k - 1];
    if (age <= a1) return v0 * Math.pow(v1 / v0, (age - a0) / (a1 - a0));
  }
  return L[L.length - 1][1];
}
/** A young adult at home enters the labour force, looking for work. */
function enterLabourForce(a: HouseholdArrays, i: number, e: Econ) {
  a.emp3[i] = EMP_UNEMP; a.un3[i] = UI_MONTHS + 1; a.ind3[i] = IND_NONE;   // a new entrant draws no insurance
  // a young worker earns about two thirds of the median (BLS: median weekly earnings 20-24 ~64% of all full-time workers', 2023) [S]
  a.wage3[i] = 0.64 * medianIncome(e) * payShare(a, i, 2);
}
/**
 * A GROWN CHILD LEAVES HOME: about 13% a year of the young adults living with
 * their parents (Census CPS: ~55% of 18-24-year-olds live with parents and
 * ~17% of 25-34 — ln(55/17) over the ~8.5 years between the bands' middles =
 * 0.138 a year) [S~] — when it can go where it would (`formFromChild`: a
 * partner's home, a shared flat, or its own). The ones who cannot afford it
 * stay at home, which is why household formation falls in a slump. (Stages
 * 2-5 drew this rate only among those with work whose pay carried a flat of
 * their own, a third of the young at home, though it is the rate over all of
 * them: the share of 18-34-year-olds at home rose from 42% to 61% in ten
 * years, and the young households the town's ages need never formed.)
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
 * LIFE (households stage 4, 2026-10-29). Every person in the register dies at
 * its age's rate, a child is born at its mother's age's rate, a child comes of
 * age at eighteen, singles move in together and couples part — each at the
 * rate the record gives for its age, nothing aimed at a pyramid. The shape the
 * town's ages take is what those rates and the people the work brings make.
 *
 * DEATHS: the probability of dying within the year at each age, US period life
 * table 2019, both sexes (CDC NCHS, NVSR 70-19, qx rounded), log-linear between
 * the ages listed [S~]. Stage 1-3 had only a head past 65 die (Gompertz fitted
 * to the same table from 65), so nobody under 65 died, and a couple lost a
 * member at a single person's rate.
 */
const LIFE_Q: [number, number][] = [
  [0, 0.0056], [1, 0.0004], [5, 0.00012], [10, 0.0001], [15, 0.0003], [20, 0.0009], [25, 0.0011], [30, 0.0013],
  [35, 0.0016], [40, 0.0021], [45, 0.0029], [50, 0.0041], [55, 0.0063], [60, 0.0091], [65, 0.0128], [70, 0.0190],
  [75, 0.0300], [80, 0.0485], [85, 0.083], [90, 0.143], [95, 0.24], [100, 0.36],
];
/** The chance a person of this age dies this month. */
export function deathM(age: number): number {
  const L = LIFE_Q;
  if (age <= 0) return L[0][1] / 12;
  for (let k = 1; k < L.length; k++) {
    const [a1, q1] = L[k], [a0, q0] = L[k - 1];
    if (age <= a1) return q0 * Math.pow(q1 / q0, (age - a0) / (a1 - a0)) / 12;
  }
  return Math.min(0.6, L[L.length - 1][1] * Math.exp(0.08 * (age - 100))) / 12;
}
/**
 * BIRTHS per 1,000 women a year by the mother's age, 15-19 .. 45+ (CDC NVSS,
 * Births: Final Data for 2023 — total fertility 1.62) [S]. A household's woman
 * of childbearing age is its head's age (a householder and partner are within
 * a couple of years of each other, Census); a couple's household has one, a
 * householder without a partner half of one (about half of one-adult households are a
 * woman's, CPS); each other adult is half a woman at the other adults' age
 * (a grown daughter or a relative: about one birth in eight is to a mother
 * living in her parents' home, Census CPS), her child one of the household's. [S~]
 */
const ASFR = [12.7, 55.4, 91.0, 95.1, 54.5, 12.5, 1.1];
const asfrM = (age: number) => age < 15 || age >= 50 ? 0 : ASFR[Math.min(6, Math.floor((age - 15) / 5))] / 1000 / 12;
function birthM(a: HouseholdArrays, i: number): number {
  return (a.partner[i] === 1 ? 1 : 0.5) * asfrM(a.age[i]) + 0.5 * othersOf(a, i) * asfrM(a.oAge[i]);
}
/** A child comes of age at eighteen: an adult at home, with a place in the labour force (OTHER_LF). [S] */
const ADULT_AT = 18;
/** The usual gap between siblings: about two and a half to three years (CDC NSFG, median interbirth interval ~ 30 months). [S~] */
const SIB_GAP = 2.5;
/**
 * UNIONS: a single adult's household moves in with another's, a year, by age
 * <25 / 25-34 / 35-44 / 45-54 / 55-64 / 65+ — the rate at which single adults
 * start living with a partner, married or not: about a tenth a year in the
 * twenties and early thirties, falling with age (NSFG 2011-19 union formation
 * among unmarried, non-cohabiting women; NCFMR remarriage rates past 45) [S~].
 * (The first cut used the marriage rate per unmarried woman alone, NCFMR 2022
 * — 31 per 1,000 — but ~70% of first unions begin as cohabitation (NSFG), and
 * moving in is when two households become one: measured, the share of
 * households living alone climbed from 20% to 37% in thirty years against
 * the CPS's steady 28%.)
 */
const UNION_YR = [0.09, 0.11, 0.07, 0.045, 0.025, 0.008];
/**
 * SPLITS: a couple parts, a year, by the householder's age, same bands — the
 * divorce rate per 1,000 married women (NCFMR 2022: 14.6 overall, about 3x
 * that under 25 and a third of it past 65), with the cohabiting couples' far
 * higher break-ups (about a tenth a year, NSFG; ~12% of couples cohabit, CPS)
 * blended in [S~]. The partner leaves to rent on its own; the children stay
 * (custody goes to the mother in ~80% of cases, Census CPS; the register
 * does not know which adult is the mother).
 */
const SPLIT_YR = [0.06, 0.04, 0.03, 0.02, 0.012, 0.005];
/**
 * AVERAGE TAX RATES BY INCOME QUINTILE — CBO, The Distribution of Household
 * Income 2019: federal (income, payroll, excise) 0.6 / 6.9 / 13.0 / 17.4 /
 * 25.7%, plus about 4% of state and local income and sales taxes (ITEP) — read
 * at each quintile's midpoint of the lognormal income spread. [S]
 */
const TAX_RATES = [0.046, 0.109, 0.170, 0.214, 0.297];
const TAX_Z = [-1.2816, -0.5244, 0, 0.5244, 1.2816];
/**
 * WHAT A HOUSEHOLD BUYS, BY ITS INCOME (households stage 5, 2026-10-29). Its
 * spending (the buffer-stock rule above: its own income, savings and card)
 * goes to the six categories the economy bridges to industries
 * (industries.ts SPEND_BRIDGE) in the shares households of its income spend
 * on them: BLS Consumer Expenditure Survey 2022-23, Table 1101 (quintiles of
 * income before taxes), grouped as industries.ts CE_2023 groups the all-units
 * column — groceries (food at home, alcohol at home, tobacco), goods
 * (apparel, furnishings, supplies, vehicles, gasoline, entertainment goods,
 * personal-care products, reading), eating out, services (utilities,
 * household operations, other vehicle expenses, public transport,
 * entertainment fees, personal-care services, miscellaneous), health care,
 * education — dollars a year, rounded [S~] (the quintile means average to
 * within ~5% of CE_2023's all-units column). Read at each quintile's midpoint
 * of the lognormal income spread and interpolated, as the tax rates are. A
 * poorer household's dollar goes more to groceries, health and the bills; a
 * richer one's more to goods, eating out and school.
 */
const CE_Q: Record<SpendCategory, readonly number[]> = {
  groceries: [4280, 5300, 5970, 7070, 9250],
  goods: [6900, 10700, 14000, 18000, 27000],
  eatingOut: [1850, 2680, 3500, 4580, 7560],
  services: [8230, 10960, 13550, 16970, 25400],
  health: [3300, 4800, 5700, 6800, 8800],
  education: [700, 650, 900, 1500, 4200],
};
export const SPEND_CATS = Object.keys(CE_Q) as SpendCategory[];
const N_CAT = SPEND_CATS.length;
/** Each quintile's shares, in SPEND_CATS order. */
const CE_SHARE: number[][] = [0, 1, 2, 3, 4].map((q) => {
  const tot = SPEND_CATS.reduce((t, c) => t + CE_Q[c][q], 0);
  return SPEND_CATS.map((c) => CE_Q[c][q] / tot);
});
/** A household's spending shares at its pay a year (into `out`, SPEND_CATS order). */
function spendShares(gross: number, med: number, out: Float64Array): Float64Array {
  const z = gross > 0 ? Math.log(gross / Math.max(1, med)) / INCOME_SIGMA : TAX_Z[0];
  let q = 0, t = 0;
  if (z <= TAX_Z[0]) { q = 0; t = 0; } else if (z >= TAX_Z[4]) { q = 3; t = 1; } else { while (z > TAX_Z[q + 1]) q++; t = (z - TAX_Z[q]) / (TAX_Z[q + 1] - TAX_Z[q]); }
  for (let c = 0; c < N_CAT; c++) out[c] = CE_SHARE[q][c] + (CE_SHARE[Math.min(4, q + 1)][c] - CE_SHARE[q][c]) * t;
  return out;
}
const SHARES = new Float64Array(6);
/** Book a household's month of spending to the categories. */
function bookSpend(r: HouseholdRegister, a: HouseholdArrays, i: number, spend: number, med: number) {
  const cat = (r.flow.spendCat ??= zeroCat());
  spendShares(payOf(a, i), med, SHARES);
  const ws = a.wt[i] * spend;
  for (let c = 0; c < N_CAT; c++) cat[SPEND_CATS[c]] += ws * SHARES[c];
}
const zeroCat = (): Record<SpendCategory, number> => ({ groceries: 0, goods: 0, eatingOut: 0, services: 0, health: 0, education: 0 });
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
  // households stage 4: the children's ages — the oldest and the youngest, the rest spaced between (KID_UNKNOWN before they are drawn);
  // whether the second adult is a partner (else every adult past the householder is an other adult), and the other adults' eldest's age
  kOld: Uint8Array, kYoung: Uint8Array, partner: Uint8Array, oAge: Uint8Array,
} as const;
/** A child's age the register has not drawn yet (a save from before stage 4). */
const KID_UNKNOWN = 255;
/** Columns a save from before them does not carry, and what they hold then. */
const FIELD_DEFAULT: Partial<Record<keyof typeof FIELDS, number>> = { ind1: IND_NONE, ind2: IND_NONE, emp3: EMP_NONE, ind3: IND_NONE, taste: NaN, kOld: 255, kYoung: 255, partner: 255, oAge: 255 };
type FieldName = keyof typeof FIELDS;
export type HouseholdArrays = { [K in FieldName]: InstanceType<(typeof FIELDS)[K]> };
const FIELD_NAMES = Object.keys(FIELDS) as FieldName[];

export interface HouseholdFlows {
  /** Households (weighted) that left an island flat this month: moved, evicted, dissolved. */
  movedOut: number; movedIn: number;
  evictions: number; foreclosures: number;
  /** of the evictions, island renters', and households with nobody in work */
  evictIsland?: number; evictJobless?: number;
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
  /** LIFE (stage 4): people born and died, households that moved in together and couples that parted (weighted). */
  births?: number; deaths?: number; unions?: number; splits?: number;
  /** What Washington paid the households this month by their means: SNAP and the EITC (weighted; `fedTransfers`). */
  transfers?: number;
  /** SPENDING BY CATEGORY (stage 5): what the households spent this month on each (weighted; sums to `spend`). */
  spendCat?: Record<SpendCategory, number>;
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
  /** Each industry's openings still unfilled at the end of last month's matching: what a household may move to the region for. */
  vacLeft?: number[];
  /** This month's move-outs from the player's blocks: the cause-ledger event per block (bbl -> why id). */
  flatWhy?: Record<string, number>;
  /** THE HOUSEHOLDS' YEAR (stage 5), rolled for the cause ledger: spending by category, net income, layoffs, the jobless rate and the wage index; the month each category's fall was last written. */
  yr?: { cat: Partial<Record<SpendCategory, number>>; income: number; layoffs: number; unemp: number; wage?: number; hh?: number; noted: Partial<Record<SpendCategory, number>> };
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

/**
 * WHAT WASHINGTON PAYS A HOUSEHOLD OF ITS MEANS, a month (households stage 5,
 * 2026-10-29): the two federal programmes that reach most low-income working
 * households in cash or near-cash, at FY2024 rules, in dollars of the
 * reference table moved with the town's prices as the poverty line is.
 *   SNAP (USDA FNS, FY2024, 48 states): a household under 130% of the poverty
 *     line (gross) gets the maximum allotment for its size less 30% of its net
 *     income — gross less 20% of earnings, the standard deduction ($198) and
 *     the shelter cost over half of what is left (capped at $672). [S]
 *   EITC (IRS Rev. Proc. 2023-34, tax year 2024): on the couple's earnings, by
 *     its children (0 / 1 / 2 / 3+): phase-in 7.65 / 34 / 40 / 45% to a
 *     maximum of $632 / $4,213 / $6,960 / $7,830, phased out at 7.65 / 15.98 /
 *     21.06 / 21.06% from $10,330 / $22,720 (a single filer; $17,250 / $29,640
 *     a couple); none for a childless filer under 25 or past 64. Paid with the
 *     refund in spring; spread over the year here. [S]
 * NOT EVERY ELIGIBLE HOUSEHOLD TAKES THEM (households stage 6): SNAP reaches
 * about 82% of the eligible (USDA FNS, Reaching Those in Need, FY2018-19) and
 * the EITC about 78% (IRS, EITC participation rate, tax year 2020) [S]. Who
 * does not is a household's own and lasting (not knowing, the stigma, the
 * paperwork), so each household draws it once, from its id (`takesUp`), and
 * keeps it. (Non-takers are somewhat more often those due least — USDA — so
 * the share of the dollars left unclaimed is under this; the draw is even.)
 * Stages 4-5 paid both to every eligible household. The
 * register had neither: CBO's tax rates (TAX_RATES) count refundable credits
 * as transfers, not as negative tax, so the bottom fifth's EITC was missing,
 * and a family of four at the screen's limit fell short of its rent and its
 * food every month (households 4-5: island evictions ran ~11% in the opening
 * year against Eviction Lab's ~2.3%).
 */
const SNAP_MAX = [291, 535, 766, 973, 1155, 1386, 1532, 1751], SNAP_ADD = 219, SNAP_STD = 198, SNAP_SHELTER_CAP = 672;
const EITC = [[0.0765, 632, 0.0765, 10_330], [0.34, 4213, 0.1598, 22_720], [0.40, 6960, 0.2106, 22_720], [0.45, 7830, 0.2106, 22_720]];
const EITC_MARRIED_ADD = [17_250 - 10_330, 29_640 - 22_720, 29_640 - 22_720, 29_640 - 22_720];
const SNAP_TAKEUP = 0.82, EITC_TAKEUP = 0.78;
/** A household's lasting draw for whether it claims a programme: a fixed fraction from its id, one per programme. */
const takesUp = (id: number, salt: number, rate: number) => {
  let h = Math.imul((id | 0) ^ Math.imul(salt, 0x9e3779b9), 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296 < rate;
};
function fedTransfers(a: HouseholdArrays, i: number, e: Econ, grossMo: number, housing: number): number {
  const px = (e.priceLevel ?? 1) * (e.cpi ?? 1);
  const size = a.adults[i] + a.kids[i];
  // SNAP
  let snap = 0;
  const poverty = (POVERTY_1 + POVERTY_ADD * Math.max(0, size - 1)) * px / 12;
  if (grossMo <= 1.3 * poverty && takesUp(a.id[i], 1, SNAP_TAKEUP)) {
    const earned = slotEarn(a.emp1[i], a.wage1[i]) + slotEarn(a.emp2[i], a.wage2[i]) + slotEarn(a.emp3[i], a.wage3[i]);
    const adj = Math.max(0, grossMo - 0.2 * earned - SNAP_STD * px);
    const shelter = Math.min(SNAP_SHELTER_CAP * px, Math.max(0, housing - 0.5 * adj));
    const max = (size <= 8 ? SNAP_MAX[Math.max(1, size) - 1] : SNAP_MAX[7] + SNAP_ADD * (size - 8)) * px;
    snap = Math.max(0, max - 0.3 * Math.max(0, adj - shelter));
  }
  // the EITC, on the couple's earnings a year
  const kidsK = Math.min(3, a.kids[i]);
  let eitc = 0;
  if ((kidsK > 0 || (a.age[i] >= 25 && a.age[i] < 65)) && takesUp(a.id[i], 2, EITC_TAKEUP)) {
    const earnYr = 12 * (slotEarn(a.emp1[i], a.wage1[i]) + slotEarn(a.emp2[i], a.wage2[i])) / px;
    const [rate, max, out, start] = EITC[kidsK];
    const from = start + (a.partner[i] === 1 ? EITC_MARRIED_ADD[kidsK] : 0);
    eitc = Math.max(0, Math.min(rate * earnYr, max) - out * Math.max(0, earnYr - from)) * px / 12;
  }
  return snap + eitc;
}
/** A slot's earnings this month (a wage, not a pension or insurance). */
const slotEarn = (x: number, wage: number) => isWorking(x) ? wage / 12 : 0;

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
  drawPartner(R, a, i);
  a.kids[i] = a.age[i] >= 20 && a.age[i] < 60 ? pick(R, KIDS) : 0;
  drawKidAges(R, a, i);
  const job = (emp: Int32Array, un: Uint16Array) => {
    emp[i] = R.u() < unemp ? EMP_UNEMP : EMP_OTHER;
    if (emp[i] === EMP_UNEMP) un[i] = 1 + Math.floor(R.u() * 10);
  };
  // the head works at its age's rate (LF_AGE); a head who does not draws the pension
  const works = R.u() < lfAge(a.age[i]);
  const other = othersOf(a, i) > 0 && R.u() < OTHER_LF;
  if (!works) {
    a.emp1[i] = EMP_RETIRED; a.wage1[i] = income;
    if (other) { a.wage3[i] = income * 0.4; job(a.emp3, a.un3); }
    return;
  }
  const two = a.partner[i] === 1 && R.u() < 0.70 * lfAge(a.age[i]);
  if (two) { job(a.emp2, a.un2); }
  if (other) { job(a.emp3, a.un3); }
  job(a.emp1, a.un1);
  a.wage1[i] = income * payShare(a, i, 0); a.wage2[i] = two ? income * payShare(a, i, 1) : 0; a.wage3[i] = other ? income * payShare(a, i, 2) : 0;
  void e;
}
/**
 * WHO THE ADULTS ARE (households stage 4): a household of two or more adults
 * has a partner with 75% odds — CPS 2023: married couples 47% and unmarried
 * partners 7% of households, against the 72% with two or more adults [S~] —
 * and the rest are its other adults: past 38, a grown child born to a parent
 * of 20-32; younger, a relative or a roommate within a few years of the
 * householder (their eldest's age, `oAge`).
 */
function drawPartner(R: Rand, a: HouseholdArrays, i: number) {
  a.partner[i] = a.adults[i] >= 2 && R.u() < 0.75 ? 1 : 0;
  const age = a.age[i];
  a.oAge[i] = othersOf(a, i) > 0 ? (age >= 38 ? Math.max(18, age - 20 - Math.floor(R.u() * 13)) : Math.max(18, age - 3 + Math.floor(R.u() * 7))) : 0;
}
/** The adults who are neither the householder nor its partner. */
const othersOf = (a: HouseholdArrays, i: number) => Math.max(0, a.adults[i] - 1 - (a.partner[i] === 1 ? 1 : 0));
/**
 * A household's children's ages, drawn when the household is (the opening, an
 * arrival): the oldest at any age its head could have had it from eighteen,
 * under ADULT_AT, the others SIB_GAP apart below it.
 */
function drawKidAges(R: Rand, a: HouseholdArrays, i: number) {
  if (!(a.kids[i] > 0)) { a.kOld[i] = 0; a.kYoung[i] = 0; return; }
  const span = Math.max(0, Math.min(ADULT_AT - 1, a.age[i] - 18));
  a.kOld[i] = Math.floor(R.u() * (span + 1));
  a.kYoung[i] = Math.max(0, Math.round(a.kOld[i] - SIB_GAP * (a.kids[i] - 1)));
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
    // within an age, ownership rises with income (Census HVS by income)
    score.push(Math.log(income / medianIncome(e)) + 0.8 * R.n());
  }
  const lfNeed = (e.jobs ?? 0) / Math.max(0.5, 1 - u0);
  r.wRegion = Math.max(0.01, (lfNeed - islandLf) / Math.max(1, sampleLf));
  for (let k = 0; k < REGION_N; k++) r.a!.wt[first + k] = r.wRegion;
  // WHO OWNS, BY AGE (households stage 6): in each band of the householder's
  // age, the richest of the region's sample by a noisy rank own, enough that
  // the band's ownership — the island's renters of that age counted — is the
  // HVS's for the age (OWN_BY_AGE), which at the nation's mix of ages is the
  // nation's 65.6%. (It was one cut over all ages with a made-up lean to age:
  // the opening came out 36 / 44 / 55 / 62 / 76 / 84% by age against the
  // HVS's 26 / 39 / 62 / 70 / 75 / 79.)
  const islB = [0, 0, 0, 0, 0, 0], regB = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < first; i++) islB[ageBand(r.a!.age[i])] += r.wIsland;
  const byBand: number[][] = [[], [], [], [], [], []];
  for (let k = 0; k < REGION_N; k++) { const b = ageBand(r.a!.age[first + k]); regB[b] += r.wRegion; byBand[b].push(score[k]); }
  const cutB = byBand.map((l, b) => {
    const own = OWN_BY_AGE[b] * (islB[b] + regB[b]), nOwn = Math.min(l.length, Math.round(own / r.wRegion));
    return nOwn <= 0 ? Infinity : [...l].sort((x, y) => y - x)[nOwn - 1];
  });
  const mRate = mortgageRate(e);
  for (let k = 0; k < REGION_N; k++) {
    const i = first + k, a = r.a!, income = inc[k];
    const owner = score[k] >= cutB[ageBand(a.age[i])];
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
/** Pay a lender counts: the couple's earnings and pensions (not a grown child's). */
function lendPay(a: HouseholdArrays, i: number): number {
  // ...and a pension: a lender counts Social Security and pension income that continues (Fannie Mae Selling Guide B3-3.1-09) [S]
  const k = (x: number) => isWorking(x) || x === EMP_RETIRED;
  return (k(a.emp1[i]) ? a.wage1[i] : 0) + (k(a.emp2[i]) ? a.wage2[i] : 0);
}
/**
 * Can this renter household buy, and if so how owning the starter compares
 * with its rent (log of the cost over the rent). Null when it cannot: no work,
 * a record no lender takes, rent owed, past 75, the payment over the
 * front-end ratio or the cash short of the down payment and closing.
 */
function buyCheck(a: HouseholdArrays, i: number, H: HomeMkt, rentMo: number): number | null {
  if (!lenderTakes(a, i, H)) return null;
  if (a.sav[i] < (DOWN_FIRST + CLOSING) * H.starter) return null;
  return Math.log(H.ucMo / Math.max(1, rentMo));
}
/** Everything a lender asks of a first-time buyer but the cash: work or a pension, a record it takes, no rent owed, under 75, the starter's payment inside the front-end ratio. */
function lenderTakes(a: HouseholdArrays, i: number, H: HomeMkt): boolean {
  if (a.age[i] >= 75 || a.credit[i] >= 3 || a.owed[i] > 0) return false;
  const inc = lendPay(a, i);
  if (!(inc > 0)) return false;
  const P = H.starter;
  return P * (1 - DOWN_FIRST) * H.amort + (TAX_INS / 12) * P <= (DTI * inc) / 12;
}
/**
 * SAVING FOR A FIRST HOME (households stage 6). A renter that plans to buy
 * saves for the down payment and the closing on top of its buffer: one a
 * lender would take on the starter's payment (`lenderTakes`) for which
 * owning costs no more than renting at the centre of the taste for owning
 * (`ownMu`) — the household that would buy at its next decision if it had
 * the cash. It aims at what first-time buyers actually put down, a median 6%
 * (NAR Profile of Home Buyers and Sellers 2019, the year FIRST_BUY_YR is read
 * from; 5-7% through 2015-19) [S], plus the closing (CLOSING), and moves
 * toward it as it moves toward its buffer, KAPPA of the gap a month [K, the
 * buffer-stock rule's own speed]. Stages 2-5 had renters spend everything
 * over a buffer of a few months (`bufferMonths`), so a renter reached the
 * cash for a home only by the luck of its opening draw: buyers thinned as the
 * opening's savers bought, and ownership fell 66% to 56% in thirty years with
 * every age band under the HVS's.
 *
 * MEASURED (stage 6, seed 550991): that was not the fault. Among renters of
 * 25-44, about 40% already held the down payment and closing on the starter
 * through the first twenty years, while about 25% passed the lender's payment
 * test (`lenderTakes`) and about 10% planned to buy; renters 25-34 bought at
 * ~10% a year and 35-44 at ~6%. The saving is kept because households who mean
 * to buy do save for it, but ownership still drifts to ~56% in thirty years:
 * what tightens is the payment, as the starter's price rose ~80% in twenty
 * years against ~60% for renters' pay (homeprice.ts), not the cash.
 */
const DOWN_SAVE = 0.06;
function plansToBuy(r: HouseholdRegister, a: HouseholdArrays, i: number, H: HomeMkt): boolean {
  const t = a.ten[i];
  if ((t !== TEN_RENT && t !== TEN_MAINLAND) || r.ownMu === undefined || !lenderTakes(a, i, H)) return false;
  return Math.log(H.ucMo / Math.max(1, a.rent[i])) <= r.ownMu;
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
 * expected buying at the opening (one decision a year each, at its rent) is
 * the nation's rate of first-time buying — about 2.0 million first-time buyers
 * a year (NAR Profile of Home Buyers and Sellers 2019: 33% of ~5.3 million
 * existing and ~0.7 million new homes sold) out of ~43 million renter
 * households (Census HVS 2019): 4.6% of renters a year [S~].
 *
 * (Stage 2 solved it so the opening's buyers only replaced the owners who
 * sell and the owners who die — the opening's ownership a steady state of its
 * owners' exits alone. But every household that forms — a grown child leaving
 * home, a couple parting, a family arriving for work — forms renting, so the
 * buyers that balance only the exits let ownership fall for ever: measured,
 * 66% to 54% in thirty years, with every age band under the HVS's. It came to
 * renters buying at ~3% a year against the record's 4.6%.)
 */
const FIRST_BUY_YR = 2.0 / 43;
function solveOwnMu(r: HouseholdRegister, e: Econ): number {
  const a = r.a!, H = homeMarket(e);
  let renters = 0;
  const cs: number[] = [], ws: number[] = [];
  for (let i = 0; i < r.n; i++) {
    const w = a.wt[i], t = a.ten[i];
    if (t !== TEN_RENT && t !== TEN_MAINLAND) continue;
    renters += w;
    const c = buyCheck(a, i, H, a.rent[i]);
    if (c !== null) { cs.push(c); ws.push(w); }
  }
  const out = (FIRST_BUY_YR / 12) * renters;
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
/**
 * TWO HOUSEHOLDS ALIKE IN WHO THEY ARE (households stage 6): a householder
 * within five years of the other's age, as many adults, a partner or not,
 * children or not. A household that joins another agent's weight becomes that
 * agent's household — its people take that agent's ages and make-up — so a
 * join must be to one alike, or every move rewrites the town's people.
 * (Stages 2-5 joined an island household leaving for the mainland, or buying,
 * to any household with its earner's kind of work: the island's young renters,
 * nearly half of whom move each year, were handed in their thousands to
 * households of any age — measured, the under-35 householders fell from 21%
 * of households to 12% in ten years, and the 65+ rose from 27% to 35%, with
 * ownership and living alone moving by age with them.)
 */
const alike = (a: HouseholdArrays, i: number, j: number) =>
  Math.abs(a.age[i] - a.age[j]) <= 5 && a.adults[i] === a.adults[j] && a.partner[i] === a.partner[j] && (a.kids[i] > 0) === (a.kids[j] > 0);
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
  // the best of a draw of households alike: its own work and mind first, then its kind of work (`alike` always)
  let best = -1, rank = 9;
  for (let k = 0; k < 128 && pool.length && rank > 0; k++) {
    const j = pool[Math.floor(R.u() * pool.length)];
    if ((j < gone.length && gone[j]) || a.ten[j] !== TEN_MAINLAND || !alike(a, i, j)) continue;
    const theirs = kindOf(a.emp1[j], a.ind1[j]);
    if (theirs[0] !== mine[0]) continue;
    const q = (theirs === mine ? 0 : 1) + (side(j) ? 0 : 2);
    if (q < rank) { best = j; rank = q; }
  }
  if (best >= 0) {
    a.wt[best] += a.wt[i];
    return;
  }
  // nobody across the water to join: the household itself rents there
  gone[i] = 0; a.ten[i] = TEN_MAINLAND; a.blk[i] = -1; a.rent[i] = mainlandRent(R, r.mainRent, a, i);
}

/**
 * OWN OR RENT (households stage 2). Owners sell and rent again at SELL_SHARE of
 * their age's moves and move to another home they buy at the rest (repeat buyers: no change of
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

  if (r.ownMu === undefined) r.ownMu = solveOwnMu(r, e);
  let bought = 0, sold = 0, rebought = 0;
  for (let i = 0; i < n; i++) {
    if (gone[i]) continue;
    const t = a.ten[i];
    if (t === TEN_OWN) {
      const u = R.u(), mv = OWN_MOVE_YR[ageBand(a.age[i])] / 12, sellM = SELL_SHARE * mv, rebuyM = mv - sellM;
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
/** An owner household alike (`alike`), of its first earner's industry if one is found, drawn at random; -1 if none. */
function ownerLike(R: Rand, r: HouseholdRegister, i: number, gone: Uint8Array): number {
  const a = r.a!, kind = a.ind1[i];
  let best = -1;
  for (let k = 0; k < 192; k++) {
    const j = Math.floor(R.u() * r.n);
    if ((j < gone.length && gone[j]) || a.ten[j] !== TEN_OWN || a.wt[j] < 1 || !alike(a, i, j)) continue;
    if (a.ind1[j] === kind) return j;
    if (best < 0) best = j;
  }
  return best;
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
 * A GROWN CHILD LEAVES HOME (households stage 2; where it goes, stage 6). It
 * leaves with its job (and industry and pay) to live with a partner, with a
 * roommate, or on its own, at the shares young adults living apart from their
 * parents live each way: CPS ASEC 2023, 25-34-year-olds — about 17% live with
 * their parents; of the rest, about 55% with a spouse or partner
 * (COUPLE_SHARE), about one in seven alone (one-person households headed by a
 * 25-34-year-old, ~4.5 million, against ~37 million of the age not living
 * with parents), and the other ~30% with roommates or relatives
 * (ROOMMATE_SHARE) [S~]. The partner or roommate is another unpartnered young
 * adult of about its age (within five years), drawn from where they are: a
 * single adult's household (the child moves in, as its partner or its other
 * adult), or another young adult still at home — and then the two leave home
 * together and a new household is formed. An agent stands for many
 * households, so a pairing is as many of each as the smaller agent stands
 * for, as two singles moving in together are (`unite`). Living alone, it rents
 * across the water at a rent its pay carries, and from there may choose an
 * island flat like any renter; an island household's child (an agent standing
 * for one household) joins a young single renter like it across the water, as
 * an island household that leaves does (`toMainland`), so the register does
 * not fill with agents of weight one. It goes only if it can: to a single's
 * home, which already carries itself; to share a flat if its pay carries half
 * the cheap end of the mainland's rents at the screen (two leaving together:
 * if their pay carries all of it); alone if its pay carries all of it. When
 * it cannot, it stays at home this month — which is why household formation
 * falls in a slump.
 *
 * (Stages 2-5 sent nearly every child out on its own — the half that left as
 * a couple had to find another child leaving the same month at the same
 * weight — though the union rates (UNION_YR) are the rates for the young
 * adults who live on their own. Measured, the share of households living
 * alone climbed from 21% to 32% in ten years, half of the under-25
 * households alone, against the CPS's steady 28%.)
 */
const COUPLE_SHARE = 0.55, ROOMMATE_SHARE = 0.30;
function formFromChild(R: Rand, r: HouseholdRegister, i: number, e: Econ, pool: number[], singles: number[], atHome: number[], gone: Uint8Array): boolean {
  let a = r.a!, w = a.wt[i];
  const emp = a.emp3[i], wage = a.wage3[i], pay = isWorking(emp) ? wage : 0, age = Math.max(18, a.oAge[i]);
  const cheap = 12 * r.mainRent * Math.exp(-0.674 * 0.25);
  const u = R.u(), together = u < COUPLE_SHARE + ROOMMATE_SHARE, couple = u < COUPLE_SHARE;
  let j = -1, k = -1;
  if (together) {
    // where the other is: on its own, or at home, as many of each as there are
    if (R.u() * (singles.length + atHome.length) < singles.length) {
      if (couple || cheap / 2 <= SCREEN * pay) j = findMate(R, r, couple, couple ? singles : pool, gone, age);
    } else k = findHomeMate(R, r, atHome, gone, i, w, age, cheap, pay);
  }
  if (j < 0 && k < 0 && !(cheap <= SCREEN * pay)) return false;
  // as many leave as the other agent stands for (all of this one, or part): the rest of this one stay at home as they were
  a = r.a!;
  const m = j >= 0 ? Math.min(w, a.wt[j]) : k >= 0 ? Math.min(w, a.wt[k]) : w;
  if (w > m + 1e-6) {
    const c = addAgent(r); a = r.a!;
    for (const f of FIELD_NAMES) (a[f] as Uint8Array)[c] = (a[f] as Uint8Array)[i];
    a.id[c] = r.nextId++; a.wt[c] = w - m; a.wt[i] = m; w = m;
  }
  const un = a.un3[i], ind = a.ind3[i];
  const sav = j >= 0 ? Math.min(1.5 * wage / 12, Math.max(0, a.sav[i]) / 2) : 0;
  a.sav[i] -= sav;
  leaveHome(R, r, i, e);
  if (j >= 0) { moveInWith(r, j, couple, e, w, age, emp, wage, un, ind, sav); return true; }
  if (k >= 0) {
    // the two leave home together: a new household across the water
    const b0 = r.a!;
    const emp2 = b0.emp3[k], wage2 = b0.wage3[k], un2 = b0.un3[k], ind2 = b0.ind3[k], age2 = Math.max(18, b0.oAge[k]);
    leaveHome(R, r, k, e);
    const n = addAgent(r), b = r.a!;
    b.wt[n] = w; b.age[n] = age; b.adults[n] = 2; b.kids[n] = 0;
    b.emp1[n] = emp; b.wage1[n] = wage; b.un1[n] = un; b.ind1[n] = ind;
    if (couple) {
      b.partner[n] = 1; b.emp2[n] = emp2; b.wage2[n] = wage2; b.un2[n] = un2; b.ind2[n] = ind2;
      r.flow.unions = (r.flow.unions ?? 0) + w;
    } else {
      b.emp3[n] = emp2; b.wage3[n] = wage2; b.un3[n] = un2; b.ind3[n] = ind2; b.oAge[n] = age2;
    }
    fillMoney(R, b, n, wage + wage2, false, e);
    b.ten[n] = TEN_MAINLAND; b.rent[n] = mainlandRent(R, r.mainRent, b, n);
    return true;
  }
  if (w < 0.5 * r.wRegion) {
    for (let t = 0; t < 24 && pool.length; t++) {
      const q = pool[Math.floor(R.u() * pool.length)];
      if ((q < gone.length && gone[q]) || a.ten[q] !== TEN_MAINLAND || a.adults[q] !== 1 || a.kids[q] > 0 || Math.abs(a.age[q] - age) > 5) continue;
      if (t < 16 && a.ind1[q] !== ind) continue;
      a.wt[q] += w;
      return true;
    }
  }
  const n = addAgent(r), b = r.a!;
  b.wt[n] = w; b.age[n] = age; b.adults[n] = 1; b.kids[n] = 0;
  b.emp1[n] = emp; b.wage1[n] = wage; b.un1[n] = un; b.ind1[n] = ind;
  fillMoney(R, b, n, wage, false, e);
  b.ten[n] = TEN_MAINLAND; b.rent[n] = mainlandRent(R, r.mainRent, b, n);
  return true;
}
/** The eldest adult at home leaves: the next is the eldest now, and in the labour force at its age's rate (the register keeps one earner slot for the adults at home). */
function leaveHome(R: Rand, r: HouseholdRegister, i: number, e: Econ) {
  const a = r.a!;
  a.adults[i]--; a.emp3[i] = EMP_NONE; a.wage3[i] = 0; a.un3[i] = 0; a.ind3[i] = IND_NONE;
  a.oAge[i] = othersOf(a, i) > 0 ? Math.max(18, a.oAge[i] - SIB_GAP) : 0;
  if (othersOf(a, i) > 0 && a.oAge[i] < 35 && R.u() < youngLf(a.oAge[i])) enterLabourForce(a, i, e);
  r.flow.formed = (r.flow.formed ?? 0) + a.wt[i];
}
/** A single adult's household of about this age (within five years) that can take in a partner (any) or a roommate (a childless renter across the water). */
function findMate(R: Rand, r: HouseholdRegister, couple: boolean, list: number[], gone: Uint8Array, age: number): number {
  const a = r.a!;
  for (let k = 0; k < 24 && list.length; k++) {
    const j = list[Math.floor(R.u() * list.length)];
    if ((j < gone.length && gone[j]) || a.adults[j] !== 1 || a.partner[j] !== 0 || a.age[j] < 18 || Math.abs(a.age[j] - age) > 5) continue;
    if (!couple && (a.kids[j] > 0 || a.ten[j] !== TEN_MAINLAND)) continue;
    return j;
  }
  return -1;
}
/**
 * Another young adult at home, of about this age, in another household, who
 * leaves with it; the two of them must carry a flat at the screen. A larger
 * agent is split so that as many of its households as this one stands for
 * lose their young adult (the rest stay as they were).
 */
function findHomeMate(R: Rand, r: HouseholdRegister, list: number[], gone: Uint8Array, i: number, w: number, age: number, cheap: number, pay: number): number {
  for (let t = 0; t < 24 && list.length; t++) {
    const a = r.a!, k = list[Math.floor(R.u() * list.length)];
    if (k === i || (k < gone.length && gone[k]) || othersOf(a, k) <= 0 || Math.abs(Math.max(18, a.oAge[k]) - age) > 5) continue;
    if (cheap > SCREEN * (pay + (isWorking(a.emp3[k]) ? a.wage3[k] : 0))) continue;
    if (a.wt[k] > w + 1e-6) {
      const c = addAgent(r), b = r.a!;
      for (const f of FIELD_NAMES) (b[f] as Uint8Array)[c] = (b[f] as Uint8Array)[k];
      b.id[c] = r.nextId++; b.wt[c] = b.wt[k] - w; b.wt[k] = w;
    }
    return k;
  }
  return -1;
}
/**
 * The young adult moves in with that single's household as its partner or
 * its roommate (its other adult), bringing its pay and, from its parents'
 * savings, up to a month and a half of it (the SCF's median renter liquid
 * holding, `fillMoney`). The singles of the larger agent who take nobody in
 * stay as they were (a copy of it, lighter).
 */
function moveInWith(r: HouseholdRegister, j: number, couple: boolean, e: Econ,
  w: number, age: number, emp: number, wage: number, un: number, ind: number, sav: number): void {
  const wj = r.a!.wt[j];
  if (wj > w + 1e-6) {
    const c = addAgent(r), b = r.a!;
    for (const f of FIELD_NAMES) (b[f] as Uint8Array)[c] = (b[f] as Uint8Array)[j];
    b.id[c] = r.nextId++; b.wt[c] = wj - w;
  }
  const b = r.a!;
  b.wt[j] = w; b.adults[j] = 2;
  if (couple) {
    b.partner[j] = 1; b.emp2[j] = emp; b.wage2[j] = wage; b.un2[j] = un; b.ind2[j] = ind;
    r.flow.unions = (r.flow.unions ?? 0) + w;
  } else {
    b.emp3[j] = emp; b.wage3[j] = wage; b.un3[j] = un; b.ind3[j] = ind; b.oAge[j] = age;
  }
  b.sav[j] += sav;
  b.yperm[j] += (wage / 12) * (1 - taxRate(wage, e));
}

/**
 * TWO SINGLES MOVE IN TOGETHER (households stage 4): a single adult's
 * household and another's within eight years of its age (about three couples
 * in four are within five years, Census CPS 2022) [S~], both on the island or
 * both not. They live in the home that is owned if either owns (the
 * other's equity, if both do, is sold into their savings), else the first's;
 * the partner's earner, money, debts and children join the household. Two
 * households become one: an agent stands for many households, so the couple
 * is as many of each as the smaller agent stands for, and the rest of the
 * larger stay single (a copy of the first, or the partner's agent, lighter) —
 * the people are kept exactly. An island partner moving out leaves a flat
 * empty, which the street lets again.
 *
 * WHO MEETS WHOM IS BY HOUSEHOLDS (stage 6): the partner is drawn in
 * proportion to the households an agent stands for, and the singles of a
 * larger agent left unpaired go on looking. Each single starts a union at
 * half its age's rate and is chosen at about the other half only if the
 * choosing is by households; drawn by agents, a regional agent of twenty
 * singles met one partner where it should have met twenty, and a pairing of
 * an agent of twenty with one of one paired one of the twenty. Measured,
 * unions ran ~6 a year per 1,000 people against the ~11-12 at which US
 * couples start living together (~2 million marriages, ~70% of first ones
 * after cohabiting, and ~3 million cohabitations begun a year: CDC NSFG,
 * NCFMR), and the share living alone climbed from 20% to 43% in thirty years.
 */
function unite(R: Rand, r: HouseholdRegister, i: number, list: number[], cum: Float64Array, gone: Uint8Array) {
  let a = r.a!, wi = a.wt[i];
  const isl = a.ten[i] === TEN_RENT, tot = list.length ? cum[list.length - 1] : 0;
  for (let k = 0; k < 16 && list.length; k++) {
    // a partner drawn by households, not by agents (an agent of twenty households is twenty singles to meet)
    const x = R.u() * tot;
    let lo = 0, hi = list.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] > x) hi = mid; else lo = mid + 1; }
    const j = list[lo];
    if (j === i || gone[j] || a.adults[j] !== 1 || a.partner[j] !== 0 || Math.abs(a.age[j] - a.age[i]) > 8) continue;
    if ((a.ten[j] === TEN_RENT) !== isl) continue;
    const wj = a.wt[j], m = Math.min(wi, wj);
    // the singles of the larger agent who do not pair stay as they were — and go on looking
    let rest = -1;
    if (wi > m + 1e-6) {
      rest = addAgent(r); a = r.a!;
      for (const f of FIELD_NAMES) (a[f] as Uint8Array)[rest] = (a[f] as Uint8Array)[i];
      a.id[rest] = r.nextId++; a.wt[rest] = wi - m;
    }
    if (a.ten[j] === TEN_RENT) {
      r.flow.movedOut += m;
      noteOut(r, j, "other", () => ({ n: {}, t: "A household moved in with a partner" }));
    }
    // the home
    if (a.ten[i] === TEN_OWN && a.ten[j] === TEN_OWN) a.sav[i] += 0.94 * Math.max(0, a.hval[j] - a.mort[j]);
    else if (a.ten[j] === TEN_OWN || (a.ten[i] === TEN_DOUBLED && a.ten[j] === TEN_MAINLAND)) {
      a.ten[i] = a.ten[j]; a.rent[i] = a.rent[j]; a.blk[i] = a.blk[j]; a.leaseEnd[i] = a.leaseEnd[j];
      a.mort[i] = a.mort[j]; a.mortRate[i] = a.mortRate[j]; a.mortPmt[i] = a.mortPmt[j]; a.hval[i] = a.hval[j];
    }
    // the partner's earner
    a.emp2[i] = a.emp1[j]; a.wage2[i] = a.wage1[j]; a.un2[i] = a.un1[j]; a.ind2[i] = a.ind1[j];
    a.adults[i]++; a.partner[i] = 1;
    // the children
    if (a.kids[j] > 0) {
      const had = a.kids[i] > 0;
      a.kids[i] = Math.min(8, a.kids[i] + a.kids[j]);
      a.kOld[i] = had ? Math.max(a.kOld[i], a.kOld[j]) : a.kOld[j];
      a.kYoung[i] = had ? Math.min(a.kYoung[i], a.kYoung[j]) : a.kYoung[j];
    }
    // the money
    const d = a.debt[i] + a.debt[j];
    a.debtRate[i] = d > 0 ? (a.debt[i] * a.debtRate[i] + a.debt[j] * a.debtRate[j]) / d : a.debtRate[i];
    a.debt[i] = d; a.sav[i] += a.sav[j]; a.owed[i] += a.owed[j]; a.yperm[i] += a.yperm[j];
    a.arrears[i] = Math.max(a.arrears[i], a.arrears[j]);
    a.credit[i] = Math.max(a.credit[i], a.credit[j]); a.clean[i] = Math.min(a.clean[i], a.clean[j]);
    a.wt[i] = m;
    if (wj > m + 1e-6) a.wt[j] = wj - m; else gone[j] = 1;
    r.flow.unions! += m;
    if (rest < 0) return;
    i = rest; wi = a.wt[i];
  }
}

/**
 * A COUPLE PARTS (households stage 4): the partner leaves with its earner, half
 * the savings and half the card, to rent across the water at a rent its pay
 * carries; the children and the home stay with the householder. A partner who
 * was not in the labour force looks for work at the pay the opening's second
 * earners draw against their householder's (`payShare`: two thirds), or past
 * 62 draws the spousal benefit, half the householder's (SSA) [S]. An island
 * household's partner (one household) joins a single renter like it across
 * the water, as a grown child leaving home does.
 */
function part(R: Rand, r: HouseholdRegister, i: number, e: Econ, pool: number[], gone: Uint8Array) {
  const a = r.a!, w = a.wt[i];
  let emp = a.emp2[i], wage = a.wage2[i], un = a.un2[i];
  const ind = a.ind2[i];
  if (emp === EMP_NONE) {
    if (a.age[i] >= 62) { emp = EMP_RETIRED; wage = 0.5 * (a.emp1[i] === EMP_RETIRED ? a.wage1[i] : SS_REPLACE * a.wage1[i]); }
    else { emp = EMP_UNEMP; un = UI_MONTHS + 1; wage = 0.667 * a.wage1[i]; }
  }
  const sav = Math.max(0, a.sav[i]) / 2, debt = a.debt[i] / 2;
  a.sav[i] -= sav; a.debt[i] -= debt;
  a.adults[i]--; a.partner[i] = 0;
  a.emp2[i] = EMP_NONE; a.wage2[i] = 0; a.un2[i] = 0; a.ind2[i] = IND_NONE;
  r.flow.splits! += w;
  if (w < 0.5 * r.wRegion) {
    for (let k = 0; k < 24 && pool.length; k++) {
      const j = pool[Math.floor(R.u() * pool.length)];
      if ((j < gone.length && gone[j]) || a.ten[j] !== TEN_MAINLAND || a.adults[j] !== 1 || a.kids[j] > 0 || Math.abs(a.age[j] - a.age[i]) > 5) continue;
      if (k < 16 && a.ind1[j] !== ind) continue;
      a.wt[j] += w;
      return;
    }
  }
  const j = addAgent(r), b = r.a!;
  b.wt[j] = w; b.age[j] = a.age[i]; b.adults[j] = 1; b.kids[j] = 0;
  b.emp1[j] = emp; b.wage1[j] = wage; b.un1[j] = un; b.ind1[j] = ind;
  b.sav[j] = sav; b.debt[j] = debt; b.debtRate[j] = a.debtRate[i]; b.credit[j] = a.credit[i]; b.clean[j] = a.clean[i];
  b.yperm[j] = (wage / 12) * (1 - taxRate(wage, e));
  b.ten[j] = TEN_MAINLAND; b.rent[j] = mainlandRent(R, r.mainRent, b, j);
}

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
  // ...THE OPENINGS THE TOWN'S OWN PEOPLE HAVE HAD A MONTH TO FILL (step 3):
  // an opening is posted, the jobless here and the workers looking for a
  // better job see it first, and a household moves to the region for it only
  // if it is still open a month on. Filling every opening the month it opened
  // from outside made each quit a household arriving: measured, the region
  // grew 17% more people and 23% more jobs in 25 years with quits on than off.
  const open = Float64Array.from(V, (v, i) => Math.min(v, r.vacLeft?.[i] ?? v));
  for (let ind = 0; ind < N_IND; ind++) {
    while (open[ind] >= wR / 2) {
      open[ind] -= wR;
      const i = addAgent(r), b = r.a!;
      b.wt[i] = wR;
      const band = pick(R, ageP);
      b.age[i] = AGE_LO[band] + Math.floor(R.u() * (AGE_HI[band] - AGE_LO[band] + 1));
      b.adults[i] = 1 + pick(R, ADULTS);
      drawPartner(R, b, i);
      b.kids[i] = b.age[i] >= 20 && b.age[i] < 60 ? pick(R, KIDS) : 0;
      drawKidAges(R, b, i);
      const f1 = Math.exp(WAGE_SIGMA * R.n() - WAGE_SIGMA * WAGE_SIGMA / 2);
      b.emp1[i] = firmIn(ind); b.ind1[i] = ind; b.wage1[i] = D.pay[ind] * f1;
      V[ind] -= wR;
      if (b.partner[i] === 1 && R.u() < 0.70) {
        const j = pickInd(wR);
        const f2 = Math.exp(WAGE_SIGMA * R.n() - WAGE_SIGMA * WAGE_SIGMA / 2);
        if (j >= 0) { b.emp2[i] = firmIn(j); b.ind2[i] = j; b.wage2[i] = D.pay[j] * f2; V[j] -= wR; }
        else { b.emp2[i] = EMP_UNEMP; b.un2[i] = 1; b.wage2[i] = D.pay[ind] * f2; }
      }
      // its other adult (a grown child, a relative) looks for work here too, at the rate for everyone over 16
      if (othersOf(b, i) > 0 && R.u() < OTHER_LF) {
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
  r.vacLeft = Array.from(V, (v) => +Math.max(0, v).toFixed(2));
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
      if (othersOf(c, i) > 0) { c.adults[i]--; c.oAge[i] = othersOf(c, i) > 0 ? Math.max(18, c.oAge[i] - SIB_GAP) : 0; }
      c.emp3[i] = EMP_NONE; c.wage3[i] = 0; c.un3[i] = 0; c.ind3[i] = IND_NONE;
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
    births: 0, deaths: 0, unions: 0, splits: 0, spendCat: zeroCat(), transfers: 0,
  };
  const med = medianIncome(e);
  MINE = new Set(Object.keys(s.holdings ?? {}));
  OUTS = new Map();
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
  // (room for the households the month forms — a grown child, a partner who
  // leaves — so the columns the loop below holds are not reallocated under it)
  ensureCap(r, r.n + 64 + (r.n >> 4));
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
  const enterLf = (i: number) => enterLabourForce(a, i, e);
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
  // the single adults' households, on the island and off it: who a single moves in with (`unite`)
  const singlesIsl: number[] = [], singlesReg: number[] = [];
  for (let i = 0; i < n1; i++) if (a.adults[i] === 1 && a.age[i] >= 18) (a.ten[i] === TEN_RENT ? singlesIsl : singlesReg).push(i);
  const cumOf = (l: number[]) => { const c = new Float64Array(l.length); let t = 0; l.forEach((j, k) => { t += a.wt[j]; c[k] = t; }); return c; };
  const cumIsl = cumOf(singlesIsl), cumReg = cumOf(singlesReg);
  // the young adults at home: who a young adult leaving home may leave with (`formFromChild`)
  const atHome: number[] = [];
  for (let i = 0; i < n1; i++) if (othersOf(a, i) > 0 && a.oAge[i] < 40) atHome.push(i);
  for (let i = 0; i < n1; i++) {
    if (gone[i]) continue;
    const w = a.wt[i];
    // housing
    const ten = a.ten[i];
    let housing = 0;
    if (ten === TEN_RENT || ten === TEN_MAINLAND) housing = a.rent[i];
    else if (ten === TEN_OWN) housing = a.mortPmt[i] + (TAX_INS / 12) * a.hval[i];
    // income: pay less tax, and what Washington pays a household of its means (SNAP, the EITC)
    const gross = grossOf(a, i);
    const xfer = fedTransfers(a, i, e, gross, housing);
    const net = gross * (1 - taxRate(gross * 12, e)) + xfer;
    r.flow.transfers! += w * xfer;
    a.yperm[i] += PERM_ROLL * (net - a.yperm[i]);
    // the card: interest accrues at its floating rate, the minimum is due
    a.debtRate[i] = short + CARD_SPREAD[a.credit[i]];
    if (a.debt[i] > 0) a.debt[i] *= 1 + a.debtRate[i] / 12;
    const minPay = a.debt[i] > 25 ? a.debt[i] * (a.debtRate[i] / 12 + MIN_PRINCIPAL) : a.debt[i];
    // spending on the buffer-stock rule
    // ...and a renter that plans to buy saves for the down payment too (DOWN_SAVE)
    const target = bufferMonths(a.age[i]) * a.yperm[i] + (plansToBuy(r, a, i, H) ? (DOWN_SAVE + CLOSING) * H.starter : 0);
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
    bookSpend(r, a, i, spend, med);
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
      if (ten === TEN_RENT) r.flow.evictIsland = (r.flow.evictIsland ?? 0) + w;
      if (!(isWorking(a.emp1[i]) || isWorking(a.emp2[i]) || isWorking(a.emp3[i]))) r.flow.evictJobless = (r.flow.evictJobless ?? 0) + w;
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
      if (a.kids[i] > 0) { a.kOld[i]++; a.kYoung[i]++; }
      if (othersOf(a, i) > 0 && a.oAge[i] < 110) {
        a.oAge[i]++;
        // a young adult at home still out of the labour force joins it at the hazard its age's participation rises by (YOUNG_LF)
        const o = a.oAge[i];
        if (a.emp3[i] === EMP_NONE && o > ADULT_AT && o < 35) {
          const p0 = youngLf(o - 1), p1 = youngLf(o);
          if (p1 > p0 && R.u() < (p1 - p0) / (1 - p0)) enterLf(i);
        }
      }
      if (a.age[i] > LF_AGE[0][0]) {
        const h = 1 - lfAge(a.age[i]) / lfAge(a.age[i] - 1);
        if (R.u() < h) retire(a.emp1, a.wage1, i);
        if (R.u() < h) retire(a.emp2, a.wage2, i);
      }
    }
    // LIFE (stage 4): a birth at the mother's age's rate (ASFR)
    if (a.kids[i] < 8 && R.u() < birthM(a, i)) {
      if (a.kids[i] === 0) a.kOld[i] = 0;
      a.kids[i]++; a.kYoung[i] = 0;
      r.flow.births! += w;
    }
    // a child comes of age at eighteen: an adult at home, looking for work at the rate for everyone over 16
    if (a.kids[i] > 0 && a.kOld[i] >= ADULT_AT) {
      const k0 = a.kids[i];
      a.kids[i]--;
      if (a.kids[i] === 0) { a.kOld[i] = 0; a.kYoung[i] = 0; }
      else a.kOld[i] = a.kids[i] === 1 ? a.kYoung[i] : Math.round(a.kOld[i] - (a.kOld[i] - a.kYoung[i]) / (k0 - 1));
      if (othersOf(a, i) === 0) a.oAge[i] = ADULT_AT;
      if (a.adults[i] < 250) a.adults[i]++;
      if (a.emp3[i] === EMP_NONE && R.u() < youngLf(ADULT_AT)) enterLf(i);
    }
    // a young adult at home (or an older one with work) leaves — to a partner, to roommates, or alone — if it can (FORM_M, formFromChild)
    // (each of them at the rate: the eldest, with the household's earner slot for its adults, goes first)
    if (othersOf(a, i) > 0 && (a.oAge[i] < 35 || isWorking(a.emp3[i])) && R.u() < Math.min(1, othersOf(a, i) * FORM_M)) {
      formFromChild(R, r, i, e, pool, singlesReg, atHome, gone);
    }
    // a single adult moves in with a partner; a couple parts (UNION_YR, SPLIT_YR)
    {
      const band = ageBand(a.age[i]);
      if (a.partner[i] === 0 && a.age[i] >= 18) {
        // each union is two singles: each starts one at half the rate and is chosen by another at about the other half
        if (R.u() < UNION_YR[band] / 24) unite(R, r, i, a.ten[i] === TEN_RENT ? singlesIsl : singlesReg, a.ten[i] === TEN_RENT ? cumIsl : cumReg, gone);
      } else if (a.partner[i] === 1 && R.u() < SPLIT_YR[band] / 12) {
        part(R, r, i, e, pool, gone);
      }
    }
    // DEATHS (LIFE_Q): each adult and child at its age's rate. The household
    // ends with its last adult; a partner who survives heads it and keeps the
    // larger pension (Social Security pays a widow or widower the larger of
    // the two benefits, SSA) [S]; else the eldest other adult heads it.
    {
      const age = a.age[i], qA = deathM(age), others = othersOf(a, i);
      if (a.kids[i] > 0) {
        const qK = a.kids[i] * deathM((a.kOld[i] + a.kYoung[i]) / 2) + (a.kYoung[i] === 0 ? deathM(0) : 0);
        if (R.u() < qK) {
          a.kids[i]--; r.flow.deaths! += w;
          if (a.kids[i] <= 1) a.kYoung[i] = a.kOld[i];
          if (a.kids[i] === 0) { a.kOld[i] = 0; a.kYoung[i] = 0; }
        }
      }
      if (others > 0 && R.u() < others * deathM(a.oAge[i])) {
        a.adults[i]--; r.flow.deaths! += w;
        if (others === 1) { a.emp3[i] = EMP_NONE; a.wage3[i] = 0; a.un3[i] = 0; a.ind3[i] = IND_NONE; a.oAge[i] = 0; }
      }
      const headDies = R.u() < qA, partnerDies = a.partner[i] === 1 && R.u() < qA;
      if (headDies || partnerDies) {
        r.flow.deaths! += w * ((headDies ? 1 : 0) + (partnerDies ? 1 : 0));
        const pen = Math.max(a.emp1[i] === EMP_RETIRED ? a.wage1[i] : 0, a.emp2[i] === EMP_RETIRED ? a.wage2[i] : 0);
        const survivor = (headDies && a.partner[i] === 1 && !partnerDies) || (!headDies && partnerDies);
        if (survivor) {
          // the couple is one: the survivor heads it
          if (headDies) { a.emp1[i] = a.emp2[i]; a.wage1[i] = a.wage2[i]; a.un1[i] = a.un2[i]; a.ind1[i] = a.ind2[i]; }
          a.emp2[i] = EMP_NONE; a.wage2[i] = 0; a.un2[i] = 0; a.ind2[i] = IND_NONE;
          a.adults[i]--; a.partner[i] = 0;
          if (pen > 0 && (a.emp1[i] === EMP_RETIRED || a.emp1[i] === EMP_NONE)) {
            const own = a.emp1[i] === EMP_RETIRED ? a.wage1[i] : 0;
            a.emp1[i] = EMP_RETIRED; a.wage1[i] = Math.max(pen, own);
          }
        } else if (othersOf(a, i) > 0) {
          // nobody of the couple left: the eldest other adult heads it, with the children
          a.adults[i] -= 1 + a.partner[i]; a.partner[i] = 0;
          a.emp1[i] = a.emp3[i]; a.wage1[i] = a.wage3[i]; a.un1[i] = a.un3[i]; a.ind1[i] = a.ind3[i];
          a.emp2[i] = EMP_NONE; a.wage2[i] = 0; a.un2[i] = 0; a.ind2[i] = IND_NONE;
          a.emp3[i] = EMP_NONE; a.wage3[i] = 0; a.un3[i] = 0; a.ind3[i] = IND_NONE;
          a.age[i] = Math.max(18, a.oAge[i]);
          a.oAge[i] = othersOf(a, i) > 0 ? Math.max(18, a.oAge[i] - SIB_GAP) : 0;
          if (a.emp1[i] === EMP_NONE && a.age[i] < 65) { a.emp1[i] = EMP_UNEMP; a.un1[i] = UI_MONTHS + 1; a.wage1[i] = 0.64 * medianIncome(e); }
        } else {
          if (a.ten[i] === TEN_RENT) {
            r.flow.movedOut += w;
            noteOut(r, i, "ended", () => ({ n: { age }, t: `A household ended · its last member died at ${age}` }));
          }
          gone[i] = 1;
        }
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
        noteOut(r, i, "buy", () => ({ n: { price: H.starter, rate: H.rate }, t: `A household bought a home · starter homes from $${fmt(H.starter)} at ${(100 * H.rate).toFixed(1)}%` }));
        r.flow.movedOut += w; r.flow.bought! += w; r.flow.leaseMoves! += w;
        if (j >= 0) {
          (r.buyers ??= []).push({ m, inc: lendPay(a, i), w });
          a.wt[j] += w; gone[i] = 1;
        } else buyHome(r, a, i, H, m);   // no owner like it to join: it buys as itself
        continue;
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
  const bsIsland = wave > 0 && e.bsArrivals ? e.bsArrivals.island * Math.min(1, e.bsArrivals.monthly / wave) : 0;
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
      // THE ARRIVALS SWAN'S NEWCOMERS GO WHERE THEIR COMMUNITY IS (blackswans.ts
      // ARRIVALS_CORE): that share of the swan's part of the wave arrives with
      // a taste for the island that wants a flat there at the going rent, net
      // of the move — the flats' demand from the month they land
      if (bsIsland > 0 && r.locMu !== undefined && R.u() < bsIsland) {
        const cut = Math.log(letAvg / Math.max(1, r.mainRent)) - r.locMu - commuteSaving(b, i, e) / Math.max(1, r.mainRent) + MOVE_LOG;
        let x = LOC_SIGMA * R.n();
        for (let t = 0; t < 64 && x < cut; t++) x = LOC_SIGMA * R.n();
        b.taste[i] = x < cut ? cut + 0.01 : x;
      }
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
  if (D) rollSpendYear(s, r);
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
  const housing = a.rent[i];
  const xfer = fedTransfers(a, i, e, gross, housing);
  const net = gross * (1 - taxRate(gross * 12, e)) + xfer;
  r.flow.transfers = (r.flow.transfers ?? 0) + w * xfer;
  const target = bufferMonths(a.age[i]) * a.yperm[i];
  const spend = Math.max(subsistence(e, a.adults[i] + a.kids[i]), a.yperm[i] - housing + KAPPA * (a.sav[i] - target));
  a.sav[i] = Math.max(0, a.sav[i] + net - spend - housing);
  r.flow.spend += w * spend; r.flow.income += w * net;
  bookSpend(r, a, i, spend, medianIncome(e));
}

// ---------------------------------------------------------------- why the shops' month moved (stage 5)
const CAT_WORD: Record<SpendCategory, string> = {
  groceries: "groceries", goods: "goods", eatingOut: "eating out", services: "services", health: "health care", education: "education",
};
/** A category's fall on its year that is worth a line of its own: a real fall a household (after the year's pay growth) the size of a recession's — real consumer spending fell 1.6% from 2007 to 2009 while households grew ~0.8%, ~2.4% a household (BEA NIPA T1.1.6, Census HVS). [S~] */
const SPEND_NOTE = 0.02;
/**
 * THE HOUSEHOLDS' YEAR, rolled (households stage 5): each category's spending,
 * the households' net income, the layoffs and the jobless rate over the past
 * twelve months (a one-year exponential roll, as the firm books roll theirs),
 * for the cause ledger. And when a category's spending falls SPEND_NOTE on
 * its year while the town's households are losing work or income, a line
 * saying so, at most once a year a category, caused by the month's largest
 * layoffs and the town's month.
 */
function rollSpendYear(s: GameState, r: HouseholdRegister) {
  const f = r.flow, cat = f.spendCat ?? zeroCat(), k = 1 / 12;
  const roll = (prev: number | undefined, x: number) => prev === undefined ? x : prev + k * (x - prev);
  let hh = 0;
  for (let i = 0; i < r.n; i++) hh += r.a!.wt[i];
  const y = (r.yr ??= { cat: {}, income: f.income, layoffs: f.layoffs ?? 0, unemp: s.econ.unemployment ?? 0, wage: r.wageRef, hh, noted: {} });
  const lab = { u: s.econ.unemployment ?? 0 };
  for (const c of SPEND_CATS) {
    const prev = y.cat[c];
    const chg = prev ? cat[c] / prev - 1 : 0;
    // a fall a household, after the pay growth of the year (the wage index's), with work or income lost
    const real = (1 + chg) * ((y.hh ?? hh) / Math.max(1, hh)) * (y.wage ?? r.wageRef) / Math.max(1e-9, r.wageRef) - 1;
    const hurt = (f.layoffs ?? 0) > 1.2 * y.layoffs || f.income < (1 - SPEND_NOTE) * y.income || lab.u > y.unemp + 0.005;
    if (prev && real < -SPEND_NOTE && hurt && !(s.month - (y.noted[c] ?? -99) < 12)) {
      y.noted[c] = s.month;
      why(s, {
        k: "households.spend", a: "household", aid: c, name: CAT_WORD[c],
        n: { spend: cat[c], spendYear: chg, real, income: f.income / Math.max(1, y.income) - 1, layoffs: f.layoffs ?? 0, layoffsYear: 12 * y.layoffs, unemp: lab.u, unempYear: lab.u - y.unemp },
        t: `Households spent ${(100 * -real).toFixed(1)}% less each on ${CAT_WORD[c]} than over the past year, after pay growth · ${Math.round(12 * y.layoffs).toLocaleString("en-US")} laid off in the year · ${(100 * lab.u).toFixed(1)}% jobless`,
      }, [...Object.values(r.layoffWhy ?? {}).slice(0, 3), whyTown(s)]);
    }
    y.cat[c] = roll(prev, cat[c]);
  }
  y.income = roll(y.income, f.income);
  y.layoffs = roll(y.layoffs, f.layoffs ?? 0);
  y.unemp = roll(y.unemp, lab.u);
  y.wage = roll(y.wage, r.wageRef);
  y.hh = roll(y.hh, hh);
}

/**
 * THE HOUSEHOLDS' MONTH IN ONE CATEGORY, on demand (why.ts): what they spent
 * on it against the past year, their income, the layoffs and the jobless rate
 * — what an industry's month cites when its household sales moved most
 * (economy.ts `whyIndustry`). Caused by the month's largest layoffs, else the
 * town's month.
 */
export function whyHouseholdSpend(s: GameState, c: SpendCategory): number | undefined {
  const r = s.households, y = r?.yr;
  if (!r || !y || !r.flow.spendCat) return undefined;
  return whyOnce(s, `hhspend:${c}:${s.month}`, () => {
    const now = r.flow.spendCat![c], chg = y.cat[c] ? now / y.cat[c] - 1 : 0;
    return {
      k: "households.month", a: "household", aid: c, name: CAT_WORD[c],
      n: { spend: now, spendYear: chg, income: r.flow.income / Math.max(1, y.income) - 1, layoffsYear: 12 * y.layoffs, unemp: s.econ.unemployment ?? 0 },
      t: `Households · ${CAT_WORD[c]} ${chg >= 0 ? "+" : ""}${(100 * chg).toFixed(1)}% on the year · income ${(100 * (r.flow.income / Math.max(1, y.income) - 1)).toFixed(1)}% · ${Math.round(12 * y.layoffs).toLocaleString("en-US")} laid off in the year`,
    };
  }, () => [...Object.values(r.layoffWhy ?? {}).slice(0, 2), whyTown(s)]);
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
  /** the month's spending by category (stage 5): the sum of what each household spent on each */
  spendCat: Record<SpendCategory, number>;
  /** what Washington paid them by their means this month (SNAP, the EITC) */
  transfers: number;
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
  return { wages, pensions, ui, tax, taxLocal, rent, mortgage, propertyTax: ownerCost * (1 / 1.5), homeInsurance: ownerCost * (0.5 / 1.5), spend: r.flow.spend, households: hh, persons, ownerValue,
    spendCat: r.flow.spendCat ?? zeroCat(), transfers: r.flow.transfers ?? 0 };
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
    // the householder and partner at the householder's age, the other adults at theirs (stage 4)
    const couple = Math.min(a.adults[i], a.partner[i] === 1 ? 2 : 1), oth = a.adults[i] - couple;
    if (a.age[i] >= 65) out.ages.old += w * couple; else out.ages.work += w * couple;
    if (a.oAge[i] >= 65) out.ages.old += w * oth; else out.ages.work += w * oth;
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

/**
 * THE REGISTER'S PEOPLE BY AGE (households stage 4), weighted, one entry a
 * year of age to 100+: each householder and partner at the householder's age,
 * other adults at their eldest's, the children spread evenly from the
 * youngest to the oldest. Pure.
 */
export function registerPyramid(s: GameState): number[] | null {
  const r = s.households;
  if (!r) return null;
  if (!r.a) unpackHouseholds(r);
  const a = r.a!, out = new Array(101).fill(0);
  const add = (age: number, w: number) => { out[Math.max(0, Math.min(100, Math.round(age)))] += w; };
  for (let i = 0; i < r.n; i++) {
    const w = a.wt[i], age = a.age[i], ad = a.adults[i], k = a.kids[i];
    const couple = a.partner[i] === 1 ? 2 : 1;
    add(age, w * Math.min(couple, ad));
    if (ad > couple) add(a.oAge[i], w * (ad - couple));
    if (k > 0) {
      const o = a.kOld[i], y = a.kYoung[i];
      for (let c = 0; c < k; c++) add(k === 1 ? o : y + (o - y) * c / (k - 1), w);
    }
  }
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
  mendPeople(r);
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
  mendPeople(r);
}
/**
 * A register saved before households stage 4 has no children's ages, partner
 * flags or other adults' ages: read them as stage 3 did — a second adult is a
 * partner, an adult child is the householder's age less 28 once past 45, the
 * eldest child 28 years younger than the householder (under 18), the rest
 * SIB_GAP apart.
 */
function mendPeople(r: HouseholdRegister): void {
  const a = r.a!;
  for (let i = 0; i < r.n; i++) {
    if (a.partner[i] === 255) a.partner[i] = a.adults[i] >= 2 ? 1 : 0;
    if (a.oAge[i] === 255) a.oAge[i] = othersOf(a, i) > 0 ? Math.max(18, a.age[i] >= 46 ? a.age[i] - 28 : a.age[i]) : 0;
    if (a.kOld[i] === KID_UNKNOWN || a.kYoung[i] === KID_UNKNOWN) {
      a.kOld[i] = a.kids[i] > 0 ? Math.max(0, Math.min(ADULT_AT - 1, a.age[i] - 28)) : 0;
      a.kYoung[i] = a.kids[i] > 0 ? Math.max(0, Math.round(a.kOld[i] - SIB_GAP * (a.kids[i] - 1))) : 0;
    }
  }
}

/** A state ready for a save: the register packed, nothing else touched (a shallow copy). */
export function packHouseholdsForSave<T extends { households?: HouseholdRegister }>(state: T): T {
  if (!state.households?.a) return state;
  return { ...state, households: packHouseholds(state.households) };
}
