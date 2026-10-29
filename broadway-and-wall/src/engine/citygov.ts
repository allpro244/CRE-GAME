// CITY HALL (2026-10-28).
//
// The owner: "add a city politics system that has taxes and other policies
// that actually affect the game." Until now the city that taxed every building
// in this game did not exist. The property tax was a statutory 1.1% that
// nobody levied and nobody spent, and the one time the city appeared at all it
// appeared as a dice roll — a fiscal crisis drawn at one in 350 a year
// (blackswans.ts FISCAL_HAZ), tripled in a recession. A city does not go broke
// at random. It goes broke when its own budget has run a deficit long enough
// that the note it has to roll finds no buyer: New York in April 1975, when
// the underwriters could not place the city's notes; Cleveland in December
// 1978, when the banks would not roll $14M; Philadelphia in 1990, Detroit in
// 2013. This file is that city.
//
//   THE BUDGET, kept monthly. Revenue is the property tax on the assessor's
//   roll (the same values the market capitalises — value.ts classValuePsf —
//   and the town's houses), a payroll tax on local wages, a local sales tax,
//   the deed-transfer tax on every trade on the tape, and state and federal
//   aid. Spending is services (police, fire, sanitation, roads, parks — per
//   head, at local wages), schools (per pupil), pensions (the actuarial
//   contribution), debt service, and the capital programme. Δcash = revenue −
//   spending − principal repaid + borrowed, exactly, every month
//   (test/citygov.mjs).
//
//   THE BOND MARKET. The city borrows at the tax-exempt ratio to the ten-year
//   plus a credit spread, and the spread is read off its own books — debt
//   against revenue, the deficit, the bills it has not paid, the pension hole
//   — and widens when credit everywhere is frightened. Past a point nobody
//   will take the paper; in a panic, nobody will take anything but the best.
//
//   THE CRISIS is a failed rollover and nothing else. When a bond or note
//   matures, the city pays it from cash; what cash cannot cover it refinances;
//   and if the market is shut to it that month, the state takes the budget.
//   The control board cuts services (the layoffs are jobs, and they leave
//   town with their households), surcharges the property tax, and holds the
//   books until three balanced years and a market that will lend again.
//
//   POLICY, with effects through the machinery that already exists: the
//   property-tax rate is `econ.taxMult`, which every NOI, value, residual and
//   pro forma in the engine already reads; an abatement (421-a / ICAP) is
//   carried by a building from groundbreak and reaches the pro forma's exit
//   value as the present value of the tax it forgives; the transfer tax is
//   what a seller pays at closing; rent stabilisation caps the renewals on
//   apartments built before it passed; the service level moves jobs (the
//   city's own payroll, and the local multiplier on it) and residents.
//
//   THE MAYOR, elected every four years from three platforms — pro-growth,
//   populist, austerity — by a vote read off unemployment, the tax burden,
//   rents and the city's own fiscal state, and the winner enacts the platform
//   a budget at a time.
//
// Its own RNG stream ("citygov"): the mayor's name and the candidates' draw.
// No other stream moves when City Hall does.
import type { Econ, GameState } from "./types";
import { BUILT_CLASSES, START_YEAR, raiseAlert } from "./types";
import { rng, pushNewsPublic, islandResidents, SF_PER_HOME, PEOPLE_PER_HOME, normalVac } from "./market";
import { TAX_RATE, classValuePsf } from "./value";
import { HH_SIZE, fundamentalHomePsf, medianIncome } from "./homeprice";

// ---------------------------------------------------------------- the facts [S]
/** Deed stamps, paid by the seller at closing (statutory default; the council can move it). */
export const TRANSFER_TAX = 0.006;
/**
 * Services per resident, 2023 dollars at the reference wage: police, fire,
 * sewerage, solid waste, parks and local highways — US Census Annual Survey of
 * Local Government Finances 2021, $426B over 332M people ≈ $1,280, carried to
 * 2023 (~$1,400). Municipal spending is mostly payroll, so it moves with the
 * town's wage index (Baumol), not with the price of goods.
 */
const SERVICES_PC = 1_400;
/** Current spending per public-school pupil (Census, Public Elementary-Secondary Education Finances FY2022: $15,633). */
const PER_PUPIL = 15_600;
/** Public K-12 pupils per resident under 18 (NCES: 49.6M enrolled / ~73M children). */
const PUPILS_PER_CHILD = 0.68;
/** Non-local share of school revenue: state 45% + federal 11% (NCES, FY2021). */
const AID_SCHOOL = 0.55;
/** State revenue sharing toward general government: a few per cent of municipal spending (Census, intergovernmental revenue). */
const AID_GENERAL = 0.04;
/**
 * Current charges — sewer and refuse fees, parking, permits, park fees, fines:
 * about $890 a resident (Census 2021 local current charges ex-utilities and
 * hospitals, ~$295B / 332M), priced at local wages and scaling with the
 * services they pay for.
 */
const FEES_PC = 890;
/** Local capital outlay, ex-schools and utilities, per resident, 2023 dollars at the cost index (Census 2021, ~$165B / 332M ≈ $500). */
const CAPITAL_PC = 500;
/** Average annual pay per job at the reference wage (BLS QCEW, all ownerships, 2022-23, ~$70,000). */
const AVG_PAY = 70_000;
/** Taxable retail sales per resident (Census retail & food services 2023, $7.2T / 335M ≈ $21.6k; ~55% of it in the taxable base). */
const TAXABLE_SALES_PC = 12_000;
/** The local add-on to the sales tax: the average local rate where there is one is 1.5-2.5 points (Tax Foundation 2024). */
const SALES_RATE = 0.015;
/** Compensation's share of municipal operating spending (BEA, state & local government consumption). */
const LABOR_SHARE = 0.60;
/** Homeownership (Census HVS 2023: 65.7%); the median existing house, sf (AHS ~1,800). */
const OWN_RATE = 0.657, HOME_SF = 1_800;
/**
 * PENSIONS (NASRA / Pew, public plans). Accrued liability about 5.5 years of
 * covered payroll, funded about three-quarters; liabilities discounted at the
 * 7.0% median assumed return; normal cost 12% of payroll of which members pay
 * 5%; benefits paid about 5.5% of the liability a year; the unfunded part
 * amortised level-dollar over thirty years at the assumed rate (8.06% a year at 7%; see amortFactor).
 * The assets earn the ten-year plus a 2.5-point premium for the equity in a
 * 60/40 book — a shape parameter. The assumption follows that return on a
 * ten-year lag (PEN_ASSUME_M), and the lag is the hole a falling-rate era opens.
 */
const PEN = { liabPayroll: 5.5, funded0: 0.75, assumed: 0.07, ncTotal: 0.12, member: 0.05, benefits: 0.055, erp: 0.025 };
/**
 * THE ASSUMED RETURN FOLLOWS THE MARKET, SLOWLY. A plan's actuaries do not
 * hold 7% through any rate era: the NASRA median assumption was 8.0% in 2001
 * on a 5% ten-year and 7.0% in 2022 on a 3% one — about the ten-year plus
 * three to four points, revised a step at a time over years. Held fixed while
 * the assets earned the ten-year plus their premium, a high-rate era drove
 * every plan to 130% funded and the city off its pension bill for decades
 * (measured: 1.07% of payroll to zero by year 20 on all three seeds), which
 * was a fixed number pretending to be an actuary. It now chases the plan's
 * own expected return on a ten-year memory.
 */
const PEN_ASSUME_M = 120;
/**
 * A revised assumption revalues the liability: a point higher discounts the
 * promised benefits about 12% lower (public-plan liabilities run a duration
 * of 11-13 years — Novy-Marx & Rauh 2011), and the amortisation payment is
 * the level-dollar 30-year annuity at the assumption, not at a fixed 7%.
 */
const PEN_DURATION = 12;
const amortFactor = (r: number) => (r > 1e-6 ? r / (1 - Math.pow(1 + r, -30)) : 1 / 30);
/**
 * WAGNER'S LAW, ON QUANTITY. What residents ask of their city rises with what
 * they earn: per-capita real (chained) state-and-local consumption in the
 * national accounts rose about 55% from 1970 to 2019 while real GDP per head
 * rose about 150% — a quantity elasticity near 0.5 (BEA NIPA table 3.10.3 vs
 * 7.1). That is on top of the cost of each unit of service tracking wages
 * (Baumol, already here: services are priced at the town's wage index), and
 * together they give the near-unit or slightly above-unit elasticity of
 * public spending to income the cross-country literature finds (Lamartina &
 * Zaghini 2011). A quantity elasticity of 1 ON TOP of Baumol would double
 * count it and raise the city's share of income without limit. Read against
 * real income per resident, smoothed over five years, against the opening.
 */
const WAGNER_ELAST = 0.5, WAGNER_EMA_M = 60;
/** The funded ratio past which a surplus turns into richer benefits (see tickCityGov). */
const PEN_SWEETEN = 1.2;
/** AAA tax-exempt yields run at 70-90% of the Treasury ten-year (MMD/UST, 2000-2024). */
const MUNI_RATIO = 0.80;
/** A general-obligation issue is serial: equal slices maturing each July for twenty years. Notes run a year. */
const BOND_YEARS = 20, STATE_YEARS = 15, NOTE_M = 12;
/** GFOA: an unrestricted reserve of at least two months of operating spending. */
const RESERVE_MONTHS = 2;
/** Assessments trail the market — most US rolls are reassessed every one to three years, New York phases in over five. */
const ASSESS_LAG_M = 36;
/**
 * THE SPREAD, in points over the tax-exempt curve — a shape read off the
 * rating scorecards and the record, not fitted to anything in this game.
 * An AA city pays 20-40bp; a city with twice the debt of its revenue, a
 * deficit and unpaid bills pays junk spreads (Detroit 2012, Chicago 2015:
 * 2-4 points); past about three points the market stops clearing (New York's
 * notes in 1975, Puerto Rico 2014), and in a panic anything under A is shut.
 */
const SPREAD = { base: 0.30, debtNorm: 1.5, perDebt: 1.0, perDeficit: 15, perPayables: 10, penNorm: 1.0, perPen: 0.3 };
const CLOSE_SPREAD = 3.0, SHUT_SPREAD = 1.25;
/** What a state agency's paper costs over the curve (New York's MAC, 1975-76: about 1.5-2 points over Treasuries, tax-exempt). */
const STATE_SPREAD = 1.0;
/** A capital programme the market will not fund shrinks to the emergencies (New York's capital spending fell by more than half after 1975). */
const DEFERRED = 0.4;
/** Rails — guards, not targets; bind rates are in the hist rows. */
const PROP_LO = 0.5, PROP_HI = 2.5, WAGE_HI = 0.05, SERVICE_LO = 0.6, SERVICE_HI = 1.2;
/** What a council will move in one budget: a twelfth of the property rate, half a point of payroll tax, 6% of services. */
const STEP_PROP = 0.12, STEP_WAGE = 0.005, STEP_SERVICE = 0.06;
/**
 * THE ECONOMY ANSWERS. Employment's semi-elasticity to a local payroll tax:
 * about one per cent of the city's jobs per point, delivered over years
 * (Haughwout, Inman, Craig & Luce 2004, Philadelphia's wage tax; Bartik's 1991
 * survey of business-tax elasticities) — a shape parameter. The city's own
 * workforce is jobs, and each carries about half a job more in the shops and
 * services it buys from (Moretti 2010's local multiplier, ~1.6). Residents
 * answer services modestly: a tenth of a per cent of population per per cent
 * of service level, over five years (Tiebout sorting; a shape parameter).
 */
const WAGE_SEMI = 1.0, LOCAL_MULT = 1.5, SERVICE_MIG = 0.10, JOB_ADJ_M = 24, MIG_ADJ_M = 60;
/**
 * ABATEMENT: 421-a and ICAP forgave the tax on the new building's value for
 * ten to twenty-five years with a phase-out; seventy per cent for fifteen
 * years is the average of that schedule.
 */
const ABATE = { pct: 0.7, years: 15 };
/**
 * STABILISATION: renewals capped at a guideline the board sets each year off
 * costs — New York's Rent Guidelines Board has run at about seven-tenths of
 * inflation (11% in 1980 on 13.5% CPI; 0% in 2015 on 0.1%). Stabilised
 * tenants stay: about 85% renew against about 55% at market (NYC HVS tenure).
 */
const RGB_SHARE = 0.7, RENEW_STAB = 0.85;
/** The populist's transfer tax (New York's mansion-tax era: ~1% and up); the civic works' cost and the city's share of it. */
const TRANSFER_POPULIST = 0.010;
const WORK_COST: Record<string, number> = { station: 40e6, park: 10e6, bridge: 120e6 };
/** Federal and state capital grants carry half a station or a bridge (FTA Capital Investment Grants); a park is the city's alone. */
const WORK_CITY_SHARE: Record<string, number> = { station: 0.5, park: 1, bridge: 0.5 };
/** The long-run average US unemployment rate (BLS 1948-2024), what voters read the local rate against. */
const U_NORM = 0.057;

// ---------------------------------------------------------------- types
export type Platform = "growth" | "populist" | "austerity";
export const PLATFORM_LABEL: Record<Platform, string> = { growth: "pro-growth", populist: "populist", austerity: "austerity" };
export const PLATFORM_PARTY: Record<Platform, string> = { growth: "Civic Alliance", populist: "Labor-Tenants", austerity: "Taxpayers' League" };
export interface CityBond { face: number; coupon: number; matM: number; kind: "bond" | "note" | "state" }
export interface BudgetLines {
  rev: { property: number; payroll: number; sales: number; transfer: number; fees: number; aid: number; interest: number };
  spend: { services: number; schools: number; pensions: number; interest: number; capital: number };
  principal: number;
  /** Of the principal, what was notes — short paper meant to be rolled, not repaid from the budget. */
  notesRepaid: number;
  borrowed: number;
}
export interface CityPolicy {
  propRate: number;
  wageRate: number;
  salesRate: number;
  transferRate: number;
  abate: { pct: number; years: number } | null;
  rentCap: { share: number; sinceYr: number } | null;
  service: number;
}
export interface CityGov {
  cash: number;
  bonds: CityBond[];
  pension: { liab: number; assets: number; assumed?: number };
  /** Real income per resident against the opening, five-year memory — what residents' demand for services follows (Wagner). */
  incEma?: number;
  /** Real income per resident at the opening, in the town's own units. */
  inc0?: number;
  policy: CityPolicy;
  policy0: { propRate: number; wageRate: number };
  assessed: number;
  abated: { endM: number; pct: number; sf: number[] }[];
  prevStock: number[];
  mo: BudgetLines;
  fy: BudgetLines;
  lastFy?: BudgetLines & { yr: number };
  rev12: number;
  op12: number;
  defShare: number;
  spread: number;
  open: boolean;
  shut: boolean;
  capUnfunded: number;
  works: { id: string; kind: string; left: number; perM: number }[];
  mayor: { name: string; platform: Platform; sinceM: number; nextElectionM: number; share: number; terms: number; uAt: number };
  control: { sinceM: number; balancedYrs: number } | null;
  crises: { m: number; face: number; spread: number; shut: boolean; cut: number; surcharge: number }[];
  /** Months a maturity could not be paid or refinanced in the market — every crisis is one of these. */
  failedRolls: number[];
  jApplied: number;
  mApplied: number;
  burden0: number;
  rentBurden0: number;
  /** The city's own record: elections, crises, the board — kept past the news wire's 120 lines. */
  log: { m: number; kind: "election" | "crisis" | "board" | "policy"; text: string }[];
  hist: { yr: number; rev: number; spend: number; deficit: number; debt: number; spread: number; propRate: number; wageRate: number; service: number; platform: Platform; control: boolean }[];
}

const zeroLines = (): BudgetLines => ({
  rev: { property: 0, payroll: 0, sales: 0, transfer: 0, fees: 0, aid: 0, interest: 0 },
  spend: { services: 0, schools: 0, pensions: 0, interest: 0, capital: 0 },
  principal: 0, notesRepaid: 0, borrowed: 0,
});
export const revTotal = (L: BudgetLines) => L.rev.property + L.rev.payroll + L.rev.sales + L.rev.transfer + L.rev.fees + L.rev.aid + L.rev.interest;
export const spendTotal = (L: BudgetLines) => L.spend.services + L.spend.schools + L.spend.pensions + L.spend.interest + L.spend.capital;
/** Operating spending: everything but the capital programme, which bonds fund. */
export const opSpend = (L: BudgetLines) => L.spend.services + L.spend.schools + L.spend.pensions + L.spend.interest;
const addLines = (a: BudgetLines, b: BudgetLines) => {
  for (const k of Object.keys(a.rev) as (keyof BudgetLines["rev"])[]) a.rev[k] += b.rev[k];
  for (const k of Object.keys(a.spend) as (keyof BudgetLines["spend"])[]) a.spend[k] += b.spend[k];
  a.principal += b.principal; a.notesRepaid += b.notesRepaid; a.borrowed += b.borrowed;
};
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const cityDebt = (g: CityGov, kind?: CityBond["kind"]) => g.bonds.reduce((a, b) => a + (!kind || b.kind === kind ? b.face : 0), 0);

// ---------------------------------------------------------------- policy readers (used across the engine)
/** The deed-transfer tax a seller pays at closing, this month. */
export function transferTaxRate(s?: { econ?: Econ } | null): number {
  return s?.econ?.gov?.policy.transferRate ?? TRANSFER_TAX;
}
/** The abatement a job breaking ground today is entitled to (eligibility is fixed at commencement). */
export function abatementAtStart(e: Econ): { pct: number; years: number } | undefined {
  const a = e.gov?.policy.abate;
  return a ? { pct: a.pct, years: a.years } : undefined;
}
/** A stabilised building's renewal cap this year, or null where none applies. */
export function stabilisedCap(e: Econ, yearBuilt: number | undefined): number | null {
  const rc = e.gov?.policy.rentCap;
  if (!rc || (yearBuilt ?? 0) > rc.sinceYr) return null;
  return Math.max(0, rc.share * (e.nat?.infl ?? 0.02));
}
/**
 * A month of a block of flats' in-place rent walking toward the market — a
 * twelfth of the leases turn. At market every one of them reprices; under
 * stabilisation the renewals (most of them) are capped and only the vacancies
 * reprice. Unstabilised, this is the expression leasing.ts always used.
 */
export function flatRollStep(e: Econ, yearBuilt: number | undefined, inPlace: number, mkt: number): number {
  const cap = stabilisedCap(e, yearBuilt);
  if (cap === null) return inPlace + (mkt - inPlace) / 12;
  const renew = Math.min(mkt, inPlace * (1 + cap));
  return inPlace + (RENEW_STAB * (renew - inPlace) + (1 - RENEW_STAB) * (mkt - inPlace)) / 12;
}
/** What a sitting tenant is asked at renewal: the street's ask, held to the cap on a stabilised block. */
export function renewalAsk(e: Econ, yearBuilt: number | undefined, ask: number, rent: number): number {
  const cap = stabilisedCap(e, yearBuilt);
  return cap === null ? ask : Math.min(ask, rent * (1 + cap));
}

// ---------------------------------------------------------------- who the city is
/**
 * THE CITY'S OWN PEOPLE, NOT ITS COMMUTING REGION (2026-10-29). `e.population`
 * is the household register's: every household of the town's labour shed,
 * most of it across the water (since ONE_ECONOMY step 2, twice the old
 * engine's count, because the jobs off the commercial floors joined the
 * town's). City Hall taxes and serves the city: the people in the island's
 * flats (the register's island renters, economy.ts `economyToEngine`) and the
 * households in its plats' houses (homes.ts, each at PEOPLE_PER_HOME, with the
 * register's children per household); its payroll tax falls on the jobs on
 * its map (the named firms' heads). Before the books open, the island's
 * occupied flats (market.ts `islandResidents`) and the town's jobs stand in.
 */
function cityPeople(e: Econ): { persons: number; kids: number; households: number } {
  const isl = e.eco?.island;
  const plat = Math.max(0, e.newHomes ?? 0);
  const kidsPerHh = (e.ages?.kids ?? 0) / Math.max(1, e.eco?.households ?? ((e.population ?? 0) / HH_SIZE));
  if (isl && isl.persons > 0) return { persons: isl.persons + plat * PEOPLE_PER_HOME, kids: isl.kids + plat * kidsPerHh, households: isl.households + plat };
  const r = islandResidents(e);
  return { persons: r.residents + plat * PEOPLE_PER_HOME, kids: (r.homes + plat) * kidsPerHh, households: r.homes + plat };
}

// ---------------------------------------------------------------- the roll and the lines
/** The market value the assessor is chasing: the map's buildings at their actual occupancy, and the town's homes off it. */
export function marketRoll(e: Econ): { commercial: number; homes: number } {
  let commercial = 0;
  for (const k of BUILT_CLASSES) {
    const stk = e.stock?.[k] ?? 0;
    if (!(stk > 0)) continue;
    const occ = clamp((e.occupied?.[k] ?? stk * (1 - normalVac(e, k))) / stk, 0, 1);
    commercial += stk * Math.max(0, classValuePsf(e, k, occ));
  }
  const households = cityPeople(e).households;
  const off = Math.max(0, households - islandResidents(e).homes);
  const owners = Math.min(off, households * OWN_RATE);
  const homePrice = (e.homes?.psf ?? fundamentalHomePsf(e)) * HOME_SF;
  const flat = Math.max(0, classValuePsf(e, "multifamily")) * SF_PER_HOME;
  return { commercial, homes: owners * homePrice + (off - owners) * flat };
}

/** The tax the roll would raise this year before abatements, and what the abatements forgive. */
function abatedValue(e: Econ, g: CityGov, m: number): number {
  let v = 0;
  for (const c of g.abated) {
    if (c.endM <= m) continue;
    BUILT_CLASSES.forEach((k, i) => { if (c.sf[i] > 0) v += c.sf[i] * Math.max(0, classValuePsf(e, k)) * c.pct; });
  }
  return v;
}

function payrollBase(e: Econ): number { return (e.eco?.island?.jobs || e.jobs || 0) * AVG_PAY * (e.wageIdx ?? 1); }

/** This month's lines, from the state as it stands — capital and transfers passed in. */
function computeLines(s: GameState, g: CityGov, capital: number, transferBase: number): BudgetLines {
  const e = s.econ, P = g.policy, w = e.wageIdx ?? 1, city = cityPeople(e), pop = city.persons;
  const kids = city.kids;
  const L = zeroLines();
  // What is provided: the council's service level on top of what residents at
  // this income ask for (Wagner), each unit priced at the town's wage (Baumol).
  const q = P.service * Math.pow(Math.max(0.2, g.incEma ?? 1), WAGNER_ELAST);
  L.spend.services = SERVICES_PC * pop * w * q / 12;
  L.spend.schools = PER_PUPIL * kids * PUPILS_PER_CHILD * w * q / 12;
  const payroll = LABOR_SHARE * (L.spend.services + L.spend.schools) * 12;
  // The actuarial contribution amortises a surplus as well as a hole — a plan
  // over 100% funded takes a holiday on the normal cost — and is never negative.
  L.spend.pensions = Math.max(0, (PEN.ncTotal - PEN.member) * payroll + amortFactor(g.pension.assumed ?? PEN.assumed) * (g.pension.liab - g.pension.assets)) / 12;
  L.spend.interest = g.bonds.reduce((a, b) => a + b.face * b.coupon, 0) / 12;
  L.spend.capital = capital;
  L.rev.property = Math.max(0, (g.assessed - abatedValue(e, g, s.month)) * P.propRate) / 12;
  L.rev.payroll = payrollBase(e) * P.wageRate / 12;
  L.rev.sales = pop * TAXABLE_SALES_PC * w * P.salesRate / 12;
  L.rev.transfer = transferBase * P.transferRate;
  L.rev.fees = FEES_PC * pop * w * q / 12;
  L.rev.aid = AID_SCHOOL * L.spend.schools + AID_GENERAL * L.spend.services;
  L.rev.interest = Math.max(0, g.cash) * Math.max(0, e.shortIndex ?? e.indexRate) / 100 / 12;
  return L;
}

function cityPayroll(L: BudgetLines): number { return LABOR_SHARE * (L.spend.services + L.spend.schools) * 12; }

function yieldFor(e: Econ, g: CityGov, kind: CityBond["kind"]): number {
  const base = kind === "note" ? (e.shortIndex ?? e.indexRate) : e.indexRate;
  return Math.max(0, base * MUNI_RATIO + (kind === "state" ? STATE_SPREAD : g.spread)) / 100;
}

/** Sell paper. Proceeds go to cash and are booked as borrowed; serial issues mature a slice each July. */
function borrow(s: GameState, g: CityGov, kind: CityBond["kind"], face: number) {
  if (!(face > 0)) return;
  const m = s.month, c = yieldFor(s.econ, g, kind);
  if (kind === "note") g.bonds.push({ face, coupon: c, matM: m + NOTE_M, kind });
  else {
    const n = kind === "state" ? STATE_YEARS : BOND_YEARS;
    // the first slice the July after next issue month's fiscal year
    const firstJuly = m + ((6 - (m % 12) + 12) % 12 || 12);
    for (let j = 0; j < n; j++) g.bonds.push({ face: face / n, coupon: c, matM: firstJuly + 12 * j, kind });
  }
  g.cash += face;
  g.mo.borrowed += face;
}

function scheduled12(g: CityGov, m: number): number {
  return g.bonds.reduce((a, b) => a + (b.kind !== "note" && b.matM > m && b.matM <= m + 12 ? b.face : 0), 0);
}

function updateSpread(s: GameState, g: CityGov) {
  const e = s.econ;
  const rev = Math.max(1, g.rev12);
  const debtRatio = cityDebt(g) / rev;
  const payables = Math.max(0, -g.cash) / rev;
  const penGap = Math.max(0, g.pension.liab - g.pension.assets) / rev;
  const raw = SPREAD.base + SPREAD.perDebt * Math.max(0, debtRatio - SPREAD.debtNorm) + SPREAD.perDeficit * g.defShare
    + SPREAD.perPayables * payables + SPREAD.perPen * Math.max(0, penGap - SPREAD.penNorm);
  // ...and every credit spread widens together when the credit window is
  // frightened: BBB munis went from ~1 to ~2.5 points over AAA in 2008.
  const stress = clamp(0.9 / Math.max(0.3, e.creditIdx ?? 0.9), 1, 2.5);
  g.spread = raw * stress;
  g.shut = !!e.panic || !!e.debtShut || (e.creditIdx ?? 1) < 0.55;
  g.open = g.control ? true : g.spread < CLOSE_SPREAD && !(g.shut && g.spread > SHUT_SPREAD);
}

// ---------------------------------------------------------------- the opening
const FIRST = ["Abe", "Ed", "Rose", "Fiorella", "John", "Bill", "David", "Mary", "Frank", "Ruth", "Kathryn", "Ray", "Carmen", "Lou", "Helen", "Vincent", "Dolores", "Tom", "Ada", "Sam"];
const LAST = ["Beame", "Koch", "Dinkins", "Wagner", "Lindsay", "Moran", "Kowalski", "Haskell", "Ortiz", "Brennan", "Whitlock", "Garrity", "Novak", "Pryor", "Delaney", "Stroud", "Abernathy", "Castellano", "Rourke", "Lindqvist"];
function drawName(s: GameState): string {
  return `${FIRST[Math.floor(rng(s, "citygov") * FIRST.length)]} ${LAST[Math.floor(rng(s, "citygov") * LAST.length)]}`;
}
function ensureStream(s: GameState) {
  // An old save's streams carry no "citygov": seed it from the campaign seed
  // the way initStreams would have, so it never borrows another stream's state.
  if (s.streams && (s.streams as Record<string, number>).citygov === undefined) {
    let h = (2166136261 ^ ((s.seed ?? 1) >>> 0)) >>> 0;
    for (const ch of "citygov") { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    (s.streams as Record<string, number>).citygov = (h >>> 0) || 1;
  }
}
function note(s: GameState, g: CityGov, kind: CityGov["log"][number]["kind"], text: string, wire: "event" | "warn" | "info" = "event") {
  (g.log ??= []).push({ m: s.month, kind, text });
  if (g.log.length > 80) g.log.shift();
  pushNewsPublic(s, wire, text);
}
const nextNovember = (m: number) => m + ((10 - (m % 12) + 12) % 12 || 12);

/** Real income per resident: the real wage times the share of residents working. */
function realIncome(e: Econ): number {
  return (e.wageIdx ?? 1) / Math.max(1e-6, e.cpi ?? 1) * (e.jobs ?? 0) / Math.max(1, e.population ?? 1);
}

function rentBurden(e: Econ): number {
  return (e.effRentIdx?.multifamily ?? e.rentIdx.multifamily) * SF_PER_HOME / Math.max(1, medianIncome(e));
}

export function openCityGov(s: GameState): CityGov {
  const e = s.econ, m = s.month;
  ensureStream(s);
  const roll = marketRoll(e);
  const platform = (["growth", "populist", "austerity"] as Platform[])[Math.floor(rng(s, "citygov") * 3)];
  const g: CityGov = {
    cash: 0, bonds: [], pension: { liab: 0, assets: 0 },
    policy: { propRate: TAX_RATE * (e.taxMult ?? 1), wageRate: 0, salesRate: SALES_RATE, transferRate: TRANSFER_TAX, abate: null, rentCap: null, service: 1 },
    policy0: { propRate: 0, wageRate: 0 },
    assessed: roll.commercial + roll.homes, abated: [],
    prevStock: BUILT_CLASSES.map((k) => e.stock?.[k] ?? 0),
    mo: zeroLines(), fy: zeroLines(), rev12: 0, op12: 0, defShare: 0, spread: SPREAD.base, open: true, shut: false,
    capUnfunded: 0, works: [],
    mayor: { name: drawName(s), platform, sinceM: m, nextElectionM: nextNovember(m) + 12 * Math.floor(rng(s, "citygov") * 4), share: 0, terms: 1, uAt: e.unemployment ?? U_NORM },
    control: null, crises: [], failedRolls: [], jApplied: 0, mApplied: 0, burden0: 0, rentBurden0: rentBurden(e), hist: [], log: [],
  };
  // THE DEBT THE CITY OPENS WITH is the steady state of its own capital
  // programme: twenty years of serial issues, each with its unmatured slices.
  const capYr = CAPITAL_PC * cityPeople(e).persons * (e.costIdx ?? 1);
  const c = yieldFor(e, g, "bond");
  const firstJuly = m + ((6 - (m % 12) + 12) % 12 || 12);
  for (let k = 1; k <= BOND_YEARS; k++) g.bonds.push({ face: capYr / BOND_YEARS * (BOND_YEARS + 1 - k), coupon: c, matM: firstJuly + 12 * (k - 1), kind: "bond" });
  const L = computeLines(s, g, 0, 0);
  const payroll = cityPayroll(L);
  g.pension.liab = PEN.liabPayroll * payroll;
  g.pension.assets = PEN.funded0 * g.pension.liab;
  g.pension.assumed = PEN.assumed;
  g.inc0 = realIncome(e); g.incEma = 1;
  const L2 = computeLines(s, g, 0, 0);
  const op = opSpend(L2) * 12;
  g.cash = op * RESERVE_MONTHS / 12;
  // THE PAYROLL TAX IS THE BALANCING ITEM, SOLVED, NOT CHOSEN: the town opens
  // with a balanced budget (every US city but Washington has to) at the
  // statutory property tax, and the payroll tax is whatever closes it. Where
  // it lands is a fact about the town — 1-4% is the real range (Ohio's cities
  // ~2%, Philadelphia ~3.8%), and a town that needs none opens in surplus.
  const need = op + scheduled12(g, m) - (revTotal(L2) - L2.rev.payroll) * 12;
  g.policy.wageRate = clamp(need / Math.max(1, payrollBase(e)), 0, WAGE_HI);
  g.policy0 = { propRate: g.policy.propRate, wageRate: g.policy.wageRate };
  const L3 = computeLines(s, g, 0, 0);
  g.rev12 = revTotal(L3) * 12;
  g.op12 = opSpend(L3) * 12;
  g.burden0 = (L3.rev.property + L3.rev.payroll + L3.rev.sales) * 12 / Math.max(1, payrollBase(e));
  updateSpread(s, g);
  return g;
}

// ---------------------------------------------------------------- the month
export function tickCityGov(s: GameState) {
  const e = s.econ;
  if (!e.gov) {
    if (!e.population || !e.jobs || !e.ages) return;
    e.gov = openCityGov(s);
    pushNewsPublic(s, "event", `City Hall: Mayor ${e.gov.mayor.name} (${PLATFORM_LABEL[e.gov.mayor.platform]}) presides over a $${(opSpend(computeLines(s, e.gov, 0, 0)) * 12 / 1e6).toFixed(0)}M budget. Property tax ${(e.gov.policy.propRate * 100).toFixed(2)}%, payroll tax ${(e.gov.policy.wageRate * 100).toFixed(2)}%.`);
    return;
  }
  const g = e.gov, m = s.month, P = g.policy;
  ensureStream(s);
  g.mo = zeroLines();
  // Old saves: no income memory, no moving assumption — start both where they stand.
  if (g.inc0 === undefined) { g.inc0 = realIncome(e); g.incEma = 1; }
  g.incEma = (g.incEma ?? 1) + (realIncome(e) / Math.max(1e-9, g.inc0) - (g.incEma ?? 1)) / WAGNER_EMA_M;
  const expRet = e.indexRate / 100 + PEN.erp;
  const was = g.pension.assumed ?? PEN.assumed;
  g.pension.assumed = was + (expRet - was) / PEN_ASSUME_M;
  g.pension.liab *= Math.exp(-PEN_DURATION * (g.pension.assumed - was));

  // THE ROLL: the assessor chases the market, years behind.
  const roll = marketRoll(e);
  g.assessed += (roll.commercial + roll.homes - g.assessed) / ASSESS_LAG_M;
  // What delivered this month (stock up) under an abatement joins the abated roll.
  const stockNow = BUILT_CLASSES.map((k) => e.stock?.[k] ?? 0);
  const added = stockNow.map((v, i) => Math.max(0, v - (g.prevStock[i] ?? v)));
  g.prevStock = stockNow;
  if (P.abate && added.some((x) => x > 0)) g.abated.push({ endM: m + P.abate.years * 12, pct: P.abate.pct, sf: added });
  g.abated = g.abated.filter((c) => c.endM > m);

  updateSpread(s, g);

  // THE CAPITAL PROGRAMME: routine renewal (deferred when the market will not
  // fund it) and the civic works the council voted.
  let capital = CAPITAL_PC * cityPeople(e).persons * (e.costIdx ?? 1) / 12 * (g.open && !g.control ? 1 : DEFERRED);
  for (const w of g.works) { const x = Math.min(w.left, w.perM); capital += x; w.left -= x; }
  g.works = g.works.filter((w) => w.left > 1);
  g.capUnfunded += capital;

  // Deeds recorded last month pay the transfer tax.
  let transferBase = 0;
  for (const c of s.comps ?? []) if (c.m === m - 1) transferBase += c.price ?? 0;

  const L = computeLines(s, g, capital, transferBase);
  // The pension plan rolls forward on what the city paid in.
  const payroll = cityPayroll(L);
  const benefits = PEN.benefits * g.pension.liab / 12;
  g.pension.liab = g.pension.liab * (1 + (g.pension.assumed ?? PEN.assumed) / 12) + PEN.ncTotal * payroll / 12 - benefits;
  g.pension.assets = g.pension.assets * (1 + expRet / 12) + L.spend.pensions + PEN.member * payroll / 12 - benefits;
  // A SURPLUS IS BARGAINED AWAY. A plan much over fully funded does not sit on
  // it: the unions and the legislature turn it into benefits (California's
  // SB 400 in 1999, New York's 2000 COLA, both on the late-1990s surplus).
  // Past 120% funded, the excess becomes liability over about five years.
  if (g.pension.assets > PEN_SWEETEN * g.pension.liab) g.pension.liab += (g.pension.assets - PEN_SWEETEN * g.pension.liab) / 60;

  g.mo.rev = L.rev; g.mo.spend = L.spend;
  g.cash += revTotal(L) - spendTotal(L);

  // MATURITIES. Paid from cash; what cash cannot cover is rolled — if the
  // market will take the paper. If it will not, that is the crisis.
  const due = g.bonds.filter((b) => b.matM <= m);
  if (due.length) {
    const face = due.reduce((a, b) => a + b.face, 0);
    g.bonds = g.bonds.filter((b) => b.matM > m);
    g.cash -= face;
    g.mo.principal += face;
    g.mo.notesRepaid += due.reduce((a, b) => a + (b.kind === "note" ? b.face : 0), 0);
    if (g.cash < 0) {
      const need = -g.cash;
      if (g.open) borrow(s, g, g.control ? "state" : "note", need);
      else startCrisis(s, g, need);
    }
  }
  // AN OPERATING SHORTFALL with nothing maturing is carried on notes; with the
  // market shut it is carried on the vendors — bills paid late, which is the
  // payables line the spread reads, and which the next maturity has to clear.
  if (g.cash < 0 && g.open) borrow(s, g, g.control ? "state" : "note", -g.cash);

  // July: the fiscal year turns, the capital programme is bonded, and the
  // council adopts a budget.
  if (m % 12 === 6) fiscalYear(s, g);
  if (m === g.mayor.nextElectionM) election(s, g);

  // Trailing twelve months, for the spread and the budget.
  g.rev12 += (revTotal(L) * 12 - g.rev12) / 12;
  g.op12 += (opSpend(L) * 12 - g.op12) / 12;
  g.defShare = Math.max(0, (g.op12 + scheduled12(g, m) - g.rev12) / Math.max(1, g.rev12));
  addLines(g.fy, g.mo);

  // THE ECONOMY ANSWERS (see WAGE_SEMI): the city's own payroll and the
  // payroll tax move jobs, services move residents — as level effects
  // delivered over years, read beside the swans' pulls in tickEcon.
  const wRef = payroll / Math.max(1e-9, P.service) / (AVG_PAY * (e.wageIdx ?? 1));
  const dW = wRef * (P.service - 1);
  const jStar = Math.log(Math.max(0.5, 1 + LOCAL_MULT * dW / Math.max(1, e.jobs ?? 1))) - WAGE_SEMI * (P.wageRate - g.policy0.wageRate);
  const pull = (jStar - g.jApplied) / JOB_ADJ_M;
  g.jApplied += pull;
  e.bsJobPull = (e.bsJobPull ?? 0) + pull;
  const mStar = SERVICE_MIG * Math.log(Math.max(0.1, P.service));
  const mPull = (mStar - g.mApplied) / MIG_ADJ_M;
  g.mApplied += mPull;
  e.bsMigPull = (e.bsMigPull ?? 0) + mPull;

  publish(e, g);
}

/** Put the adopted rate where the rest of the engine reads it. */
function publish(e: Econ, g: CityGov) {
  e.taxMult = g.policy.propRate / TAX_RATE;
}

// ---------------------------------------------------------------- the budget
function fiscalYear(s: GameState, g: CityGov) {
  const e = s.econ, m = s.month, P = g.policy;
  const yr = START_YEAR + Math.floor(m / 12);
  if (m >= 12 || g.fy.rev.property > 0) {
    g.lastFy = { ...JSON.parse(JSON.stringify(g.fy)), yr };
    const rev = revTotal(g.fy), op = opSpend(g.fy);
    g.hist.push({ yr, rev, spend: op + g.fy.spend.capital, deficit: rev - op - (g.fy.principal - g.fy.notesRepaid),
      debt: cityDebt(g), spread: +g.spread.toFixed(2), propRate: P.propRate, wageRate: P.wageRate, service: +P.service.toFixed(3), platform: g.mayor.platform, control: !!g.control });
    if (g.hist.length > 150) g.hist.shift();
  }
  g.fy = zeroLines();
  // The capital programme goes to market once a year.
  // Cash above three months of spending pays for capital directly (pay-go) before any is borrowed.
  if (g.capUnfunded > 0 && g.open) {
    const payGo = Math.min(g.capUnfunded, Math.max(0, g.cash - g.op12 * 3 / 12));
    borrow(s, g, g.control ? "state" : "bond", g.capUnfunded - payGo);
    g.capUnfunded = 0;
  }

  // THE GAP: next year's operating bill and principal against this year's
  // revenue, plus a third of the way back to a two-month reserve.
  const notes = cityDebt(g, "note");
  const target = g.op12 * RESERVE_MONTHS / 12;
  const gap = g.op12 + scheduled12(g, m) - g.rev12 + (target - (g.cash - notes)) / 3;

  // The board: three balanced years and a market that will lend again.
  if (g.control) {
    g.control.balancedYrs = gap <= 0.02 * g.rev12 ? g.control.balancedYrs + 1 : 0;
    const own = g.spread < CLOSE_SPREAD / 2;
    if (g.control.balancedYrs >= 3 && m - g.control.sinceM >= 36 && own) {
      g.control = null;
      note(s, g, "board", `The control board has handed the city its books back after ${Math.round((m - (g.crises[g.crises.length - 1]?.m ?? m)) / 12)} years. Three balanced budgets, a spread of ${g.spread.toFixed(2)} points, and the city can sell its own bonds again.`);
    }
  }

  const before = { ...P, abate: P.abate, rentCap: P.rentCap };
  const plat: Platform | "board" = g.control ? "board" : g.mayor.platform;
  const yrsIn = Math.floor((m - g.mayor.sinceM) / 12);
  const roll = Math.max(1, g.assessed), payBase = Math.max(1, payrollBase(e));
  const svcCost = Math.max(1, (g.mo.spend.services + g.mo.spend.schools) * 12 / Math.max(0.1, P.service));
  const raiseProp = (x: number) => { const d = clamp(x / roll, -P.propRate * STEP_PROP, P.propRate * STEP_PROP); const to = clamp(P.propRate + d, TAX_RATE * PROP_LO, TAX_RATE * PROP_HI); const used = (to - P.propRate) * roll; P.propRate = to; return used; };
  const raiseWage = (x: number) => { const to = clamp(P.wageRate + clamp(x / payBase, -STEP_WAGE, STEP_WAGE), 0, WAGE_HI); const used = (to - P.wageRate) * payBase; P.wageRate = to; return used; };
  const moveService = (x: number) => { const to = clamp(P.service + clamp(x / svcCost, -STEP_SERVICE, STEP_SERVICE), SERVICE_LO, SERVICE_HI); const used = (to - P.service) * svcCost; P.service = to; return used; };
  // EACH PLATFORM HAS ONE TAX MIX, AND USES IT BOTH WAYS. The first cut raised
  // gaps on the property tax and gave surpluses back on the payroll tax, a
  // ratchet that walked the payroll tax to zero in every seed whatever the
  // budget did. The populist taxes property (the landlords) and relieves it
  // the same way; the other two split. What a rail or a step will not take
  // spills to the other tax.
  const propShare = plat === "populist" ? 0.8 : 0.5;
  const moveTax = (x: number) => { let left = x; left -= raiseProp(propShare * x); left -= raiseWage(left); left -= raiseProp(left); return x - left; };

  if (gap > 0) {
    // CLOSING THE GAP, the way each platform closes one. What is not closed
    // is borrowed on notes — the populist's habit, and the road to a crisis.
    const share = plat === "growth" ? 0.85 : plat === "populist" ? 0.6 : 1;
    const x = gap * share;
    if (plat === "growth") { const cut = -moveService(-0.8 * x); moveTax(x - cut); }
    else if (plat === "populist") moveTax(x);
    else { const cut = -moveService(-0.5 * x); moveTax(x - cut); }
  } else if (gap < 0 && plat !== "board") {
    // A SURPLUS IS SPENT OR GIVEN BACK — no council sits on one for long.
    // Each platform's first choice, then the next where a rail or a step stops it.
    let x = -gap;
    // Services cut in a bad year are the first thing a good year buys back,
    // whoever is mayor — nobody campaigns on keeping the firehouses shut.
    if (P.service < 1) x -= moveService(Math.min(x, (1 - P.service) * svcCost));
    if (plat === "populist" && P.service < 1.15) x -= moveService(Math.min(x, (1.15 - P.service) * svcCost));
    if (x > 0) moveTax(-x);
  }

  // THE PLATFORM, a budget at a time.
  if (plat === "growth") {
    if (!P.abate) P.abate = { ...ABATE };
    else if (P.transferRate > TRANSFER_TAX) P.transferRate = Math.max(TRANSFER_TAX, P.transferRate - 0.001);
    if (P.rentCap && yrsIn >= 2) P.rentCap = null;
  } else if (plat === "populist") {
    if (P.abate) P.abate = null;
    if (!P.rentCap) P.rentCap = { share: RGB_SHARE, sinceYr: yr };
    else if (P.transferRate < TRANSFER_POPULIST) P.transferRate = Math.min(TRANSFER_POPULIST, P.transferRate + 0.002);
    // "Make the landlords pay": the rate up, the proceeds to the streets.
    if (yrsIn < 2 && gap <= 0) { const used = raiseProp(P.propRate * 0.03 * roll); if (P.service < 1.15) moveService(Math.min(used, (1.15 - P.service) * svcCost)); }
  } else if (plat === "austerity") {
    if (P.abate) P.abate = null;
  }

  // Say what changed, in numbers.
  const bits: string[] = [];
  if (Math.abs(P.propRate - before.propRate) > 1e-5) bits.push(`property tax ${(before.propRate * 100).toFixed(2)}% → ${(P.propRate * 100).toFixed(2)}%`);
  if (Math.abs(P.wageRate - before.wageRate) > 1e-5) bits.push(`payroll tax ${(before.wageRate * 100).toFixed(2)}% → ${(P.wageRate * 100).toFixed(2)}%`);
  if (Math.abs(P.service - before.service) > 0.004) bits.push(`services ${P.service > before.service ? "+" : ""}${((P.service / before.service - 1) * 100).toFixed(0)}%`);
  if (Math.abs(P.transferRate - before.transferRate) > 1e-6) bits.push(`transfer tax ${(P.transferRate * 100).toFixed(1)}%`);
  if (!!P.abate !== !!before.abate) bits.push(P.abate ? `new buildings' tax abated ${Math.round(P.abate.pct * 100)}% for ${P.abate.years} years` : "abatements for new building ended");
  if (!!P.rentCap !== !!before.rentCap) bits.push(P.rentCap ? `rent stabilisation on every apartment built by ${P.rentCap.sinceYr} (renewals held to ~${Math.round(RGB_SHARE * 100)}% of inflation)` : "rent stabilisation repealed");
  if ((!!P.abate !== !!before.abate) || (!!P.rentCap !== !!before.rentCap)) e.govStamp = (e.govStamp ?? 0) + 1;
  const who = g.control ? "The control board" : `Mayor ${g.mayor.name}`;
  (bits.length ? (t: string) => note(s, g, "policy", t) : (t: string) => pushNewsPublic(s, "info", t))(
    `${who} adopted the FY${yr + 1} budget: $${((g.op12 + g.capUnfunded) / 1e6).toFixed(0)}M, ${gap > 0 ? `a $${(gap / 1e6).toFixed(1)}M gap` : `a $${(-gap / 1e6).toFixed(1)}M surplus`}.${bits.length ? " " + bits.join("; ") + "." : " No change in rates."}`);
  publish(e, g);
}

// ---------------------------------------------------------------- the crisis
function startCrisis(s: GameState, g: CityGov, need: number) {
  const e = s.econ, m = s.month, P = g.policy;
  const yr = START_YEAR + Math.floor(m / 12);
  g.failedRolls.push(m);
  const spreadAt = g.spread, shut = g.shut;
  // The state lends what the market would not, and takes the budget.
  g.control = { sinceM: m, balancedYrs: 0 };
  borrow(s, g, "state", need);
  // THE EMERGENCY BUDGET: the structural gap and half the unpaid bills, half
  // in layoffs (up to a fifth of the services) and half on the property tax
  // (up to two-fifths over the rate) — New York's 1975 board did both.
  const gap = Math.max(0, g.op12 + scheduled12(g, m) - g.rev12) + need / 2;
  const svcCost = Math.max(1, (g.mo.spend.services + g.mo.spend.schools) * 12 / Math.max(0.1, P.service));
  const cut = clamp(0.5 * gap / svcCost, 0.05, 0.20);
  P.service = clamp(P.service * (1 - cut), SERVICE_LO, SERVICE_HI);
  const surcharge = clamp(0.5 * gap / Math.max(1, g.assessed) / P.propRate, 0.05, 0.40);
  P.propRate = clamp(P.propRate * (1 + surcharge), TAX_RATE * PROP_LO, TAX_RATE * PROP_HI);
  g.crises.push({ m, face: need, spread: +spreadAt.toFixed(2), shut, cut: +cut.toFixed(3), surcharge: +surcharge.toFixed(3) });
  publish(e, g);
  (g.log ??= []).push({ m, kind: "crisis", text: `$${(need / 1e6).toFixed(1)}M came due and could not be rolled (spread ${spreadAt.toFixed(2)}${shut ? ", credit shut" : ""}); the state took the budget: services −${Math.round(cut * 100)}%, property tax +${Math.round(surcharge * 100)}%.` });
  (e.blackSwans ??= []).push({ m, kind: "fiscal", size: Math.round(cut * 100), sf: 0, title: "the city could not pay its bills" });
  raiseAlert(s, {
    kind: "swan", tone: "bad",
    title: "The city cannot pay its bills",
    body: `$${(need / 1e6).toFixed(1)}M of the city's paper came due and ${shut ? "the credit markets are shut" : `nobody would roll it at a ${spreadAt.toFixed(1)}-point spread`}. The state has taken the budget: ${Math.round(cut * 100)}% of city services cut and ${Math.round(surcharge * 100)}% on every property-tax bill, now ${(P.propRate * 100).toFixed(2)}%.`,
    detail: `Every building's tax bill just went up, and the board pays the bondholders first. The layoffs are jobs, and the households they support follow them out of town. The board stays until three balanced budgets and a market that will lend to the city again. (${yr})`,
  });
}

// ---------------------------------------------------------------- the election
function election(s: GameState, g: CityGov) {
  const e = s.econ, m = s.month;
  const u = e.unemployment ?? U_NORM;
  const L = g.mo;
  const burden = (L.rev.property + L.rev.payroll + L.rev.sales) * 12 / Math.max(1, payrollBase(e));
  const X = {
    u: (u - U_NORM) * 100,
    tax: (burden / Math.max(1e-9, g.burden0) - 1) * 100,
    rent: (rentBurden(e) / Math.max(1e-9, g.rentBurden0) - 1) * 100,
    fisc: g.defShare * 100 + Math.max(0, g.spread - SPREAD.base) * 3 + (g.control ? 10 : 0) + (g.crises.some((c) => m - c.m < 48) ? 15 : 0),
  };
  // A SIMPLE VOTE, DRIVEN BY THE NUMBERS. Each platform's pull is what it
  // campaigns on: jobs and taxes for pro-growth, rents and jobs for the
  // populist, the city's books for austerity. The incumbent's party carries
  // the incumbency edge and answers for what happened to jobs on its watch
  // (retrospective voting). A candidate's own quality is the only draw, and
  // it is small against what the numbers do. A grievance is one-sided: taxes
  // below where the town opened are no argument FOR the tax-cutters' rivals,
  // only no argument for the tax-cutters — so a contented city re-elects.
  const U: Record<Platform, number> = {
    growth: 0.8 * Math.max(0, X.u) + 0.4 * Math.max(0, X.tax),
    populist: 0.4 * Math.max(0, X.rent) + 0.4 * Math.max(0, X.u),
    austerity: 0.8 * X.fisc,
  };
  const inc = g.mayor.platform;
  U[inc] += 4 - 1.0 * (u - g.mayor.uAt) * 100 - (g.crises.some((c) => c.m >= g.mayor.sinceM) ? 8 : 0);
  for (const p of Object.keys(U) as Platform[]) {
    const z = Math.sqrt(-2 * Math.log(Math.max(1e-9, rng(s, "citygov")))) * Math.cos(2 * Math.PI * rng(s, "citygov"));
    U[p] += 2 * z;
  }
  const ex = (Object.keys(U) as Platform[]).map((p) => [p, Math.exp(U[p] / 5)] as const);
  const tot = ex.reduce((a, [, v]) => a + v, 0);
  ex.sort((a, b) => b[1] - a[1]);
  const [win, wv] = ex[0];
  const share = wv / tot;
  const reelect = win === inc && g.mayor.terms < 3;
  const prev = g.mayor;
  g.mayor = reelect
    ? { ...prev, terms: prev.terms + 1, nextElectionM: m + 48, share, uAt: u }
    : { name: drawName(s), platform: win, sinceM: m + 2, nextElectionM: m + 48, share, terms: 1, uAt: u };
  const why = [`unemployment ${(u * 100).toFixed(1)}%`, `taxes ${X.tax >= 0 ? "+" : ""}${X.tax.toFixed(0)}% of pay vs the opening`, `rents ${X.rent >= 0 ? "+" : ""}${X.rent.toFixed(0)}% of income`, g.control ? "the city under a control board" : `a ${(g.defShare * 100).toFixed(1)}% deficit`].join(", ");
  note(s, g, "election", reelect
    ? `Election: Mayor ${prev.name} (${PLATFORM_LABEL[win]}) re-elected with ${(share * 100).toFixed(0)}% — ${why}.`
    : `Election: ${g.mayor.name} (${PLATFORM_PARTY[win]}, ${PLATFORM_LABEL[win]}) wins City Hall with ${(share * 100).toFixed(0)}%, over Mayor ${prev.name} — ${why}. ${win === "growth" ? "Promises lower taxes and abatements for new building." : win === "populist" ? "Promises rent stabilisation and a bigger tax bill for landlords." : "Promises to balance the books, by cuts first."}`);
}

// ---------------------------------------------------------------- civic works
/**
 * THE HEARING ON A CIVIC WORK ASKS THE BUDGET (demand.ts tickTransit). A city
 * under a control board or shut out of the market builds nothing new, and a
 * park is the first thing cut from a budget in deficit. A funded work is put
 * on the capital programme — the city's share of its cost, spent over the
 * build and bonded with the rest. No draw: the old hearing's hash still
 * decides the politics; this decides whether there is money.
 */
export function cityFundsWork(s: GameState, kind: string, id: string, months: number): boolean {
  const g = s.econ.gov;
  if (!g) return true;
  if (g.control || !g.open) return false;
  if (kind === "park" && g.defShare > 0.03) return false;
  const cost = (WORK_COST[kind] ?? WORK_COST.station) * (s.econ.costIdx ?? 1) * (WORK_CITY_SHARE[kind] ?? 1);
  g.works.push({ id, kind, left: cost, perM: cost / Math.max(12, months) });
  return true;
}

/** Tests and probes: what the next maturity is, and a hook to force a state. Never called by the game. */
export function nextMaturity(g: CityGov): { m: number; face: number } | null {
  if (!g.bonds.length) return null;
  const m = Math.min(...g.bonds.map((b) => b.matM));
  return { m, face: g.bonds.filter((b) => b.matM === m).reduce((a, b) => a + b.face, 0) };
}

