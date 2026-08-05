/**
 * THE PAYROLL.
 *
 * Everything in this game so far has been done by nobody. Buildings were
 * managed, space was leased, and expenses were controlled by an invisible
 * competence that came free with owning the deed. The firm's overhead line
 * (see sim.ts, the `ga` block) is the shape of that fiction: ~30bps of gross
 * asset value a year over a small fixed base, an office full of people you
 * could not see, hire, or lose.
 *
 * This module makes two of them real: a property manager and a leasing agent.
 *
 * THE MECHANISM IS CAPACITY, NOT A MULTIPLIER.
 *
 * A dial that reads "good manager: opex x0.94" is a difficulty setting wearing
 * a job title, and CLAUDE.md forbids it. What is actually true about the
 * business is that a person covers a certain amount of property and no more. A
 * landlord with two buildings manages them himself perfectly well. The same
 * landlord with twenty does not, and the failure is not that he becomes stupid
 * — it is that the roof inspection slips, the renewal conversation happens two
 * months late, and the vendor contract rolls over unexamined. Work that is not
 * done costs money.
 *
 * So every role has a CAPACITY in square feet, the portfolio has a LOAD, and
 * what degrades is the work, gradually and increasingly, the further past
 * capacity you are. Difficulty is an output of the arithmetic. Nobody typed it.
 *
 * WHAT THE NUMBERS ARE ANCHORED TO
 *
 * Capacity: IREM and BOMA portfolio surveys put a commercial property manager
 * at roughly 500,000-1,000,000 sf depending on asset type and tenant count,
 * and a residential manager at roughly 300-500 units. Leasing is a wider beat
 * because the unit of work is a deal, not a building. Residential does not
 * consume leasing capacity at all — the engine already says so in `setBroker`
 * ("brokers work commercial space — multifamily leases itself").
 *
 * Effect size: professionally managed buildings run roughly 5-15% below
 * absentee-owned ones on CONTROLLABLE expenses — the half of the stack that is
 * contracts, staffing and preventive maintenance — and a genuinely neglected
 * building runs 20-30% over. That band is the whole range of this system. It
 * cannot make a building free to run and it cannot bankrupt one; it moves the
 * controllable half by about a quarter, either way, which is what management
 * is worth in life.
 *
 * Salaries are quoted in year-2000 dollars and billed at `econ.costIdx`. A
 * fixed $200,000 salary in a simulation that runs a century at 5.4x inflation
 * is free money by year sixty, and a wage that ignores the price level is
 * exactly the kind of number this project does not ship.
 */
import type { ParcelRecord, ParcelTable } from "@/data/types";
import type { GameState } from "./types";
import { mulberry32Step } from "./market";
import { resolveRec } from "./value";

export type StaffRole = "pm" | "leasing";

/**
 * THE PAYROLL DRAWS FROM ITS OWN STREAM, AND THIS IS NOT A DETAIL.
 *
 * The engine has one shared mulberry32 state driving the macro walk, every
 * rival, every tenant and every demolition, so anything that calls rng() a
 * different number of times re-rolls the rest of the century. Generating a
 * hiring pool from that stream is exactly such a thing — measured, it moved
 * the loan-index drift through an engineered glut from -0.04pp to +0.97pp
 * across nine seeds and broke acceptance test H, with nothing about the
 * economy having changed at all.
 *
 * A hiring pool is not a fact about the property market and it must not be
 * able to move one. So it gets its own generator, seeded off the run seed and
 * stepped only by this module. The practical consequence is the one that
 * matters to a player: who is available to hire cannot change the weather, and
 * choosing to interview somebody cannot either.
 *
 * (The same fix is what CENTURY_REPORT.md section VI asks for on the macro
 * economy generally. This is the first piece of it.)
 */
function srng(s: GameState): number {
  const r = mulberry32Step(s.staffRng ?? (s.seed ^ 0x5741ff) | 0);
  s.staffRng = r.state;
  return r.value;
}
function srrange(s: GameState, lo: number, hi: number): number {
  return lo + srng(s) * (hi - lo);
}

/**
 * HOW MUCH OF THE OLD OVERHEAD WAS PEOPLE YOU CAN NOW HIRE.
 *
 * The `ga` line in sim.ts charged ~30bps of gross asset value for an office
 * nobody could see. Roughly 45% of a real estate firm's G&A is property and
 * asset management payroll — the seats this module makes explicit — so that
 * share comes out of the abstract charge and arrives as actual salaries. What
 * stays behind is audit, legal, insurance and the office lease, which no hire
 * removes. Without this split, hiring a manager would bill the player for the
 * same person twice.
 */
export const NON_PAYROLL_GA_SHARE = 0.55;

/** The four everybody has, and the two each role is actually hired for. */
export const GENERAL_ATTRS = ["judgment", "urgency", "diligence", "relationships"] as const;
export const ROLE_ATTRS: Record<StaffRole, readonly string[]> = {
  pm: ["costControl", "tenantCare"],
  leasing: ["marketKnowledge", "negotiation"],
};
export const ATTR_LABEL: Record<string, string> = {
  judgment: "Judgment", urgency: "Sense of urgency", diligence: "Detail orientation",
  relationships: "Relationships", costControl: "Cost control", tenantCare: "Tenant care",
  marketKnowledge: "Market knowledge", negotiation: "Negotiation",
};
export const ROLE_LABEL: Record<StaffRole, string> = {
  pm: "Property Manager", leasing: "Leasing",
};

export interface Staff {
  id: number;
  name: string;
  role: StaffRole;
  /** TRUE ability, 1-100. Never shown. */
  attrs: Record<string, number>;
  /** The first impression: what the interview and the references suggested. */
  obs: Record<string, number>;
  /** Year-2000 dollars a year. Billed at costIdx. */
  salary: number;
  hiredM: number;
  /** How wide the initial read was — narrowed at hire by paying for a search. */
  band0: number;
}

export interface Candidate extends Staff {
  /** What they will accept. Hiring below it is not on offer. */
  askSalary: number;
}

const FIRST = ["Miriam", "Ellis", "Dorothy", "Frank", "Yolanda", "Arthur", "Rosa", "Clement",
  "Nadia", "Walter", "Imelda", "Gus", "Perry", "Cecile", "Otis", "Hannah", "Reuben", "Vera",
  "Marcus", "Junia", "Abel", "Winifred", "Solomon", "Greta", "Desmond", "Lorna"];
const LAST = ["Halloran", "Buckley", "Ferreira", "Okonkwo", "Vance", "Delacroix", "Mazur",
  "Whitcomb", "Ng", "Abernathy", "Sorrentino", "Kowal", "Bright", "Ashford", "Nakamura",
  "Salcedo", "Trent", "Villanueva", "Doyle", "Pike", "Emerson", "Radcliffe", "Osei"];

/**
 * SALARY IS A FUNCTION OF ABILITY, AND THE MARKET IS NOT BLIND.
 *
 * A candidate's ask tracks what they can actually do, because the rest of the
 * industry has been watching them work for a decade even though you have not.
 * That is what makes the noisy read a real problem rather than a free lunch:
 * you cannot simply buy the cheap one and expect to have found an edge, and
 * you cannot read ability off the price either, because the ask carries its own
 * spread. The band is $55k to $210k in year-2000 dollars, which is a real
 * range for a property manager through to a senior leasing director.
 */
function askFor(s: GameState, attrs: Record<string, number>, role: StaffRole): number {
  const keys = [...GENERAL_ATTRS, ...ROLE_ATTRS[role]];
  const mean = keys.reduce((a, k) => a + (attrs[k] ?? 50), 0) / keys.length;
  const base = 55_000 + Math.pow(mean / 100, 1.9) * 155_000;
  return Math.round(base * srrange(s, 0.9, 1.12) / 1000) * 1000;
}

function drawAttrs(s: GameState, role: StaffRole): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of [...GENERAL_ATTRS, ...ROLE_ATTRS[role]]) {
    // Triangular-ish: most people are ordinary, a few are not. Averaging three
    // uniforms gives a believable middle without a normal-distribution import.
    const v = (srng(s) + srng(s) + srng(s)) / 3;
    out[k] = Math.round(8 + v * 88);
  }
  return out;
}

/**
 * WHAT AN INTERVIEW ACTUALLY TELLS YOU.
 *
 * `obs` is the first impression, drawn once and frozen. It is wrong by an
 * amount set by how much work you did before making the offer. Everything the
 * player is shown is derived from it, and the truth only arrives through the
 * results the person produces — see `readAttr`.
 *
 * Nobody interviews well on detail orientation. Communication and presence are
 * the things a room reads accurately and the things that matter least, so
 * `relationships` is observed tightly and `diligence` badly. That asymmetry is
 * the whole reason bad hires happen to real people.
 */
const OBS_HARDNESS: Record<string, number> = {
  relationships: 0.5, negotiation: 0.7, marketKnowledge: 0.8, judgment: 1.15,
  urgency: 1.2, tenantCare: 1.2, costControl: 1.3, diligence: 1.4,
};

function observe(s: GameState, attrs: Record<string, number>, band0: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(attrs)) {
    const w = band0 * (OBS_HARDNESS[k] ?? 1);
    out[k] = Math.round(Math.max(1, Math.min(100, v + srrange(s, -w, w))));
  }
  return out;
}

/** How much search you paid for, in months of narrowing. Cheap looks cost more later. */
export const SEARCH_TIERS = [
  { key: "post", label: "Post the job", cost: 0, band: 26 },
  { key: "network", label: "Work your network", cost: 6_000, band: 18 },
  { key: "recruiter", label: "Retain a recruiter", cost: 22_000, band: 11 },
] as const;

export function generateCandidate(s: GameState, role: StaffRole, band0: number): Candidate {
  const attrs = drawAttrs(s, role);
  const name = `${FIRST[Math.floor(srng(s) * FIRST.length) % FIRST.length]} ${LAST[Math.floor(srng(s) * LAST.length) % LAST.length]}`;
  const ask = askFor(s, attrs, role);
  return {
    id: s.nextStaffId ?? 1, name, role, attrs,
    obs: observe(s, attrs, band0),
    salary: ask, askSalary: ask, hiredM: -1, band0,
  };
}

/**
 * THE READ, AS IT STANDS TODAY.
 *
 * Before you hire, this is the interview. After you hire, months of watching
 * someone work move the estimate toward what is actually there and narrow the
 * band around it. Twelve months of results halve the error; five years all but
 * remove it. Nothing ever states the true number, because in life nothing does
 * — you infer it from whether the opex ratio and the renewal rate came in.
 */
export function readAttr(st: Staff, key: string, month: number): { mid: number; lo: number; hi: number } {
  const truth = st.attrs[key] ?? 50;
  const first = st.obs[key] ?? truth;
  const served = st.hiredM < 0 ? 0 : Math.max(0, month - st.hiredM);
  const decay = 1 / (1 + served / 12);
  const mid = truth + (first - truth) * decay;
  const w = (st.band0 * (OBS_HARDNESS[key] ?? 1)) * decay;
  return {
    mid: Math.round(Math.max(1, Math.min(100, mid))),
    lo: Math.round(Math.max(1, mid - w)),
    hi: Math.round(Math.min(100, mid + w)),
  };
}

// ---------------------------------------------------------------------------
// CAPACITY
// ---------------------------------------------------------------------------

/**
 * A manager covers 600,000 sf of commercial at ordinary ability — the middle
 * of the IREM/BOMA range — and residential eats capacity faster per foot
 * because a hundred apartments is a hundred tenancies where a hundred thousand
 * feet of warehouse is one. Urgency and detail set how much more or less than
 * ordinary this particular person gets through: the spread is 0.6x to 1.5x,
 * which is a real spread between a good manager and a poor one and is not
 * wide enough for anybody to cover a portfolio single-handed.
 */
export const PM_BASE_SF = 600_000;
export const LEASING_BASE_SF = 900_000;
/** Apartments are 2.4x the management work per foot. Turnover is the reason. */
export const MF_WORK_WEIGHT = 2.4;

/**
 * AND YOU, DOING IT YOURSELF.
 *
 * The firm starts as one person who is also underwriting, financing, and
 * walking buildings. 150,000 sf is about six small buildings — a real
 * one-person shop, and comfortably less than the portfolio the game expects
 * you to end up with, which is the point. You are never blocked from owning
 * more; you are just visibly worse at running it.
 */
export const OWNER_SF = 150_000;

function abilityMult(st: Staff, month: number, keys: string[]): number {
  // Uses TRUE ability. The player's uncertainty is about what they can see,
  // not about what is happening to their buildings.
  void month;
  const mean = keys.reduce((a, k) => a + (st.attrs[k] ?? 50), 0) / keys.length;
  return 0.6 + (mean / 100) * 0.9;                       // 0.6x .. 1.5x
}

export function roleCapacitySf(s: GameState, role: StaffRole): number {
  const base = role === "pm" ? PM_BASE_SF : LEASING_BASE_SF;
  let cap = OWNER_SF;                                    // you are always working
  for (const st of s.staff ?? []) {
    if (st.role !== role) continue;
    const keys = role === "pm" ? ["urgency", "diligence"] : ["urgency", "relationships"];
    cap += base * abilityMult(st, s.month, keys);
  }
  return cap;
}

/** Square feet each role is on the hook for. */
export function coveredSf(s: GameState, parcels: ParcelTable, role: StaffRole): number {
  let sf = 0;
  for (const h of Object.values(s.holdings)) {
    const rec: ParcelRecord | null = resolveRec(parcels, s, h.bbl);
    if (!rec || !rec.bldgArea) continue;
    const mix = rec.mix;
    const mfShare = mix ? (mix.multifamily ?? 0) : (rec.class === "multifamily" ? 1 : 0);
    const mfSf = rec.bldgArea * mfShare;
    const comSf = rec.bldgArea - mfSf;
    // Leasing does not work on flats. The engine already says so in setBroker.
    sf += role === "pm" ? comSf + mfSf * MF_WORK_WEIGHT : comSf;
  }
  return sf;
}

/**
 * HOW FAR PAST THE LINE YOU ARE, as a number between 0 (fine) and 1 (nothing
 * is getting done properly). Gradual and increasingly bad, never a cliff: at
 * 1.5x capacity roughly a quarter of the work is slipping, at 3x about half,
 * and it asymptotes rather than reaching zero because even an overwhelmed
 * owner still collects the rent.
 */
export function slip(load: number): number {
  if (load <= 1) return 0;
  const over = load - 1;
  return over / (over + 1.4);
}

export interface RoleState { capacity: number; covered: number; load: number; slip: number; skill: number; }

export function roleState(s: GameState, parcels: ParcelTable, role: StaffRole): RoleState {
  const capacity = roleCapacitySf(s, role);
  const covered = coveredSf(s, parcels, role);
  const load = capacity > 0 ? covered / capacity : 0;
  const keys = role === "pm" ? ["costControl", "diligence"] : ["marketKnowledge", "negotiation"];
  // Skill is the ability-weighted average across the people in the seat,
  // floored at the owner's own competence. An owner with no staff is not
  // incompetent, just ordinary and stretched.
  const hired = (s.staff ?? []).filter((x) => x.role === role);
  const skill = hired.length
    ? hired.reduce((a, st) => a + keys.reduce((b, k) => b + (st.attrs[k] ?? 50), 0) / keys.length, 0) / hired.length
    : 42;                                                 // you, doing your best
  return { capacity, covered, load, slip: slip(load), skill };
}

/**
 * WHAT MANAGEMENT IS WORTH, ON THE CONTROLLABLE HALF ONLY.
 *
 * Returns a multiplier on OPEX_CONTROLLABLE. Fixed costs — the tax bill, the
 * insurance premium, the ground rent — do not care who manages the building,
 * which is why the expense stack was already split in two before this existed.
 *
 * Range: a skill-90 manager inside capacity runs the controllable stack ~11%
 * under standard; an owner at 3x capacity runs it ~18% over. That spans the
 * 5-15% professional-management saving and the 20-30% neglect premium the
 * industry surveys report, and it cannot go further in either direction.
 */
export function pmOpexMult(rs: RoleState): number {
  const good = (rs.skill - 50) / 100 * 0.22;             // -0.11 .. +0.11
  const bad = rs.slip * 0.30;
  return Math.max(0.86, Math.min(1.34, 1 - good + bad));
}

/** Renewal conversations that happen on time. Same shape, smaller stakes. */
export function pmRenewalMult(rs: RoleState): number {
  const good = (rs.skill - 50) / 100 * 0.16;
  return Math.max(0.72, Math.min(1.15, 1 + good - rs.slip * 0.28));
}

/**
 * DEAL FLOW YOU CREATED RATHER THAN WAITED FOR.
 *
 * A leasing team does not change how many tenants exist in the city; it
 * changes how many of them tour YOUR building rather than the one across the
 * street. That is why this multiplies tour arrival and nothing else, and why
 * the upside is bounded: at skill 90 and inside capacity you see about 30%
 * more prospects than an owner answering his own phone. An owner three times
 * over capacity misses about a third of them.
 */
export function leasingOddsMult(rs: RoleState): number {
  const good = (rs.skill - 50) / 100 * 0.5;
  return Math.max(0.55, Math.min(1.35, 1 + good - rs.slip * 0.5));
}

/** What the leasing hire gets on the rent, against a market they know better. */
export function leasingRentMult(rs: RoleState): number {
  const good = (rs.skill - 50) / 100 * 0.09;
  return Math.max(0.95, Math.min(1.05, 1 + good - rs.slip * 0.06));
}

// ---------------------------------------------------------------------------
// THE MONTH
// ---------------------------------------------------------------------------

/** Year-2000 salary dollars a month, at today's price level. */
export function payrollMonthly(s: GameState): number {
  let a = 0;
  for (const st of s.staff ?? []) a += st.salary;
  return Math.round((a * (s.econ.costIdx ?? 1)) / 12);
}

/**
 * SEVERANCE IS THREE MONTHS AND THE SEAT STAYS EMPTY.
 *
 * Firing is allowed and it costs what firing costs: three months of salary,
 * and a search that runs before anyone starts. The gap is the real penalty —
 * your coverage falls exactly when you have decided it was inadequate — and it
 * is why the interview is worth doing properly.
 */
export const SEVERANCE_MONTHS = 3;
export const SEARCH_MONTHS = 2;

export function severanceFor(s: GameState, st: Staff): number {
  return Math.round((st.salary * (s.econ.costIdx ?? 1) / 12) * SEVERANCE_MONTHS);
}

/**
 * The pool refreshes slowly. A hiring market that reshuffles every month is a
 * slot machine, and the decision it produces is "spin again", not "is this
 * person worth $140,000 a year".
 */
export const POOL_REFRESH_M = 6;
export const POOL_SIZE = 3;

export function refreshPool(s: GameState, force = false) {
  if (!s.hirePool) s.hirePool = { m: -999, band: 26, list: [] };
  if (!force && s.month - s.hirePool.m < POOL_REFRESH_M) return;
  s.nextStaffId = s.nextStaffId ?? 1;
  const list: Candidate[] = [];
  for (const role of ["pm", "leasing"] as StaffRole[]) {
    for (let i = 0; i < POOL_SIZE; i++) {
      const c = generateCandidate(s, role, s.hirePool.band);
      c.id = s.nextStaffId++;
      list.push(c);
    }
  }
  s.hirePool = { m: s.month, band: s.hirePool.band, list };
}

/**
 * Once a month, work out what the desk is coping with and stamp the results
 * where the operating and leasing code can read them without being handed the
 * whole GameState. Doing it once a tick also means the player's statement, the
 * appraisal and the leasing panel all quote the SAME management — the fault
 * this project keeps finding is two functions answering one question
 * differently, and a single stamped number cannot do that.
 */
/**
 * DORMANT UNTIL YOU CAN ACTUALLY HIRE SOMEBODY.
 *
 * The capacity model is finished and measured and the hiring screen is not, so
 * a player past 150,000 sf was being charged for management they had no way to
 * buy. A penalty with no counterplay is not a modelled risk — it is half a
 * feature showing through — and this project's rule is that difficulty is an
 * output of something real, not a cost with no decision attached to it.
 *
 * So while there is no way to hire, the capacity effects are held at neutral:
 * the pool still turns over, salaries still bill if staff somehow exist, every
 * measurement in `pnpm staff` still runs against the live functions. Only the
 * multipliers the player feels are pinned to 1.
 *
 * Delete this the day the hiring UI lands. It is one flag and the harness will
 * tell you immediately whether the capacity model still binds: test A asserts
 * a 55k sf book does not slip and a 2.4M sf book does.
 */
export const HIRING_UI_SHIPPED = false;

export function markStaff(s: GameState, parcels: ParcelTable) {
  const pm = roleState(s, parcels, "pm");
  const lease = roleState(s, parcels, "leasing");
  if (!HIRING_UI_SHIPPED && !(s.staff ?? []).length) {
    for (const h of Object.values(s.holdings)) delete h.pmOpexMult;
    delete s.leasingOddsMult; delete s.pmRenewalMult; delete s.leasingRentMult;
    return;
  }
  const opex = pmOpexMult(pm);
  for (const h of Object.values(s.holdings)) h.pmOpexMult = +opex.toFixed(4);
  s.leasingOddsMult = +leasingOddsMult(lease).toFixed(4);
  s.pmRenewalMult = +pmRenewalMult(pm).toFixed(4);
  s.leasingRentMult = +leasingRentMult(lease).toFixed(4);
}

export function tickStaff(s: GameState, parcels: ParcelTable) {
  refreshPool(s);
  markStaff(s, parcels);
  // Anyone whose search has finished takes their seat.
  if (s.pendingHires?.length) {
    const ready = s.pendingHires.filter((p) => s.month >= p.startM);
    if (ready.length) {
      s.staff = s.staff ?? [];
      for (const p of ready) {
        const st: Staff = { ...p.staff, hiredM: s.month };
        s.staff.push(st);
        s.news.unshift({
          q: s.month, kind: "info",
          text: `${st.name} starts today as ${ROLE_LABEL[st.role]} at $${Math.round(st.salary / 1000)}k. `
            + `What they are actually worth is something you will find out.`,
        });
      }
      s.pendingHires = s.pendingHires.filter((p) => s.month < p.startM);
    }
  }
}

export function hire(s: GameState, candidateId: number): { s: GameState; err?: string } {
  const pool = s.hirePool?.list ?? [];
  const c = pool.find((x) => x.id === candidateId);
  if (!c) return { s, err: "That candidate is no longer available." };
  const first = Math.round(c.askSalary * (s.econ.costIdx ?? 1) / 12);
  if (s.cash < first) return { s, err: "You cannot cover the first month's salary." };
  const next: GameState = JSON.parse(JSON.stringify(s));
  next.pendingHires = next.pendingHires ?? [];
  next.pendingHires.push({ staff: { ...c, salary: c.askSalary, hiredM: -1 }, startM: next.month + SEARCH_MONTHS });
  next.hirePool!.list = (next.hirePool!.list ?? []).filter((x) => x.id !== candidateId);
  next.news.unshift({
    q: next.month, kind: "deal",
    text: `Offer accepted: ${c.name} as ${ROLE_LABEL[c.role]}, $${Math.round(c.askSalary / 1000)}k. `
      + `They give notice and start in ${SEARCH_MONTHS} months.`,
  });
  return { s: next };
}

export function fire(s: GameState, staffId: number): { s: GameState; err?: string } {
  const st = (s.staff ?? []).find((x) => x.id === staffId);
  if (!st) return { s, err: "Nobody by that name works here." };
  const pay = severanceFor(s, st);
  if (s.cash < pay) return { s, err: `Severance is $${Math.round(pay / 1000)}k and you do not have it.` };
  const next: GameState = JSON.parse(JSON.stringify(s));
  next.staff = (next.staff ?? []).filter((x) => x.id !== staffId);
  next.cash -= pay;
  next.news.unshift({
    q: next.month, kind: "warn",
    text: `${st.name} is out. Severance $${Math.round(pay / 1000)}k, and the desk is empty until you fill it.`,
  });
  return { s: next };
}
