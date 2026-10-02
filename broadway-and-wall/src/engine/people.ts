/**
 * THE PRINCIPAL — one person type for the player, every hire, and every rival
 * firm's operating principal.
 *
 * NOBODY AGES AND NOBODY DIES. Owner decision, explicit and final: "remove the
 * age from everything … in this game, everyone doesn't die so age doesn't
 * matter." There is no birth month, no death draw, no estate, no heir and no
 * succession — for the player, for staff, and for every rival principal. The
 * period life table, the player's 70–105 death band, rival-principal estate
 * sales and the heir seat that used to live here are gone (see ECONOMY.md,
 * "No age, no mortality"). What a person has DONE — the career log — is the
 * only thing about time a person carries, and it is seeded from YEARS IN THE
 * BUSINESS, never from an age.
 *
 * RNG: this module owns `s.peopleRng`, seeded `s.seed ^ 0x50454f50` ("PEOP").
 * A hiring pool must not re-roll the economy (staff.ts).
 */
import type { ParcelTable } from "@/data/types";
import type { FounderBid, GameState } from "./types";
import { mulberry32Step } from "./market";
import { resolveRec } from "./value";

export type PersonSeat = "you" | "employee" | "partner" | "rival" | "none";

/**
 * One human being. Staff are Persons with seat "employee" plus payroll fields
 * (see staff.ts). The player is seat "you". Rival firms carry seat "rival".
 */
/** Asset classes a career can specialise in. Land accrues slowly (assemblage). */
export type CareerClass = "office" | "retail" | "multifamily" | "industrial" | "land";

/**
 * What someone has actually done — month-equivalents of operating exposure.
 * Competence is a readout of this, not a purchased skill chip.
 */
export interface CareerLog {
  classM: Partial<Record<CareerClass, number>>;
  /** District (submarket) exposure. */
  districtM: Record<string, number>;
}

export interface Person {
  id: number;
  name: string;
  /** TRUE ability, 1-100. Shown only for seat "you". Never for anyone else. */
  attrs: Record<string, number>;
  /** Noisy first read — interview / dealing history. */
  obs: Record<string, number>;
  /** How wide the initial read was. */
  band0: number;
  seat: PersonSeat;
  /** Rival.firm id when seat === "rival". */
  firmId?: string;
  /** Earned by doing. Absent on legacy rows until ensurePeople / tickCareers. */
  career?: CareerLog;
}

/** peopleRng seed mix — distinct from staff's 0x5741ff. */
export const PEOPLE_RNG_XOR = 0x50454f50;

export function prng(s: GameState): number {
  const r = mulberry32Step(s.peopleRng ?? (s.seed ^ PEOPLE_RNG_XOR) | 0);
  s.peopleRng = r.state;
  return r.value;
}

export function prrange(s: GameState, lo: number, hi: number): number {
  return lo + prng(s) * (hi - lo);
}

export const GENERAL_PERSON_ATTRS = [
  "judgment", "urgency", "diligence", "relationships",
] as const;

/**
 * Years in the business behind the player's opening career seed. It is the
 * track record the opening principal always carried by default (the old
 * default principal seeded (40 − 22) = 18 years of exposure); it no longer
 * comes from an age, and the opening bankroll does not buy it.
 */
export const PLAYER_START_YEARS_IN_BUSINESS = 18;

/**
 * Prior years in the business for a rival principal and for a hire. These are
 * the same spans the career seed always drew (rival principals 38–72 less a
 * working life starting ~22; hires 28–55 less 22) — re-expressed as tenure,
 * with no age attached and one peopleRng step each, as before.
 */
export const RIVAL_YEARS_IN_BUSINESS: readonly [number, number] = [16, 50];
export const HIRE_YEARS_IN_BUSINESS: readonly [number, number] = [6, 33];

function drawGeneralAttrs(s: GameState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of GENERAL_PERSON_ATTRS) {
    const v = (prng(s) + prng(s) + prng(s)) / 3;
    out[k] = Math.round(Math.max(8, Math.min(96, 8 + v * 88)));
  }
  return out;
}

function observeSelf(attrs: Record<string, number>): Record<string, number> {
  // A person knows themselves — obs equals truth, band collapsed for display.
  // Others never see attrs; Phase 2 shows these for seat "you" only.
  return { ...attrs };
}

const FIRST = ["Halloran", "Edmund", "Miriam", "Clement", "Vera", "Solomon", "Greta",
  "Desmond", "Nadia", "Walter", "Imelda", "Perry", "Junius", "Lorna", "Abel"];
const LAST = ["Voss", "Boyle", "Whitcomb", "Ashford", "Hale", "Mercer", "Quincy",
  "Trent", "Alden", "Crowley", "Beckett", "Moss", "Pryor", "Shaw"];

function pickName(s: GameState): string {
  const f = FIRST[Math.floor(prng(s) * FIRST.length) % FIRST.length];
  const l = LAST[Math.floor(prng(s) * LAST.length) % LAST.length];
  return `${f} ${l}`;
}

export function nextPersonId(s: GameState): number {
  const id = s.nextPersonId ?? 1;
  s.nextPersonId = id + 1;
  return id;
}

/**
 * Opening principal for a new run. Attrs use peopleRng only — never s.rng /
 * staffRng. No age, no death draw.
 */
export function makePlayerPrincipal(s: GameState, yearsInBusiness: number = PLAYER_START_YEARS_IN_BUSINESS): Person {
  const attrs = drawGeneralAttrs(s);
  const p: Person = {
    id: 0,
    name: s.firm?.name ? principalNameFromFirm(s.firm.name, s) : pickName(s),
    attrs,
    obs: observeSelf(attrs),
    band0: 0,
    seat: "you",
  };
  p.career = seedCareer(s, yearsInBusiness);
  return p;
}

function principalNameFromFirm(firmName: string, s: GameState): string {
  // Prefer a human name; firm name stays on FirmIdentity.
  void firmName;
  return pickName(s);
}

/**
 * Queue a departed employee as a founder bid. They try to raise in
 * ~3–9 months; rivals.ts can still refuse. peopleRng for the delay only.
 */
export function queueFounderBid(
  s: GameState,
  st: {
    name: string;
    attrs: Record<string, number>;
    obs: Record<string, number>;
    band0: number;
    career?: CareerLog;
    role: "pm" | "leasing" | "construction";
  },
  fromFirmId: string,
  fromFirmName: string,
): void {
  const delay = 3 + Math.floor(prng(s) * 7); // 3–9 months to raise
  const bid: FounderBid = {
    readyM: s.month + delay,
    name: st.name,
    attrs: { ...st.attrs },
    obs: { ...st.obs },
    band0: st.band0,
    career: st.career ? {
      classM: { ...st.career.classM },
      districtM: { ...st.career.districtM },
    } : undefined,
    role: st.role,
    fromFirmId,
    fromFirmName,
  };
  (s.founderBids ??= []).push(bid);
}

/** Seat a founder bid as the operating principal of a new rival. */
export function seatFounderAsRival(s: GameState, firmId: string, bid: FounderBid): Person {
  const p: Person = {
    id: nextPersonId(s),
    name: bid.name,
    attrs: { ...bid.attrs },
    obs: { ...bid.obs },
    band0: bid.band0,
    seat: "rival",
    firmId,
    career: bid.career ? {
      classM: { ...bid.career.classM },
      districtM: { ...bid.career.districtM },
    } : undefined,
  };
  return p;
}

/** Rival operating principal. `yearsInBusiness` seeds the career log only. */
export function makeRivalPrincipal(s: GameState, firmId: string, firmName: string, yearsInBusiness?: number): Person {
  const years = yearsInBusiness ?? Math.round(prrange(s, RIVAL_YEARS_IN_BUSINESS[0], RIVAL_YEARS_IN_BUSINESS[1]));
  const attrs = drawGeneralAttrs(s);
  // Noisy read of a rival — wide band; never shown as truth.
  const band0 = 22;
  const obs: Record<string, number> = {};
  for (const [k, v] of Object.entries(attrs)) {
    obs[k] = Math.round(Math.max(1, Math.min(100, v + prrange(s, -band0, band0))));
  }
  void firmName;
  const p: Person = {
    id: nextPersonId(s),
    name: pickName(s),
    attrs,
    obs,
    band0,
    seat: "rival",
    firmId,
  };
  p.career = seedCareer(s, years);
  return p;
}

/**
 * Prior career for a new hire, drawn from peopleRng AFTER staffRng work is done
 * so the staff stream's step count is unchanged. A desk that has been on your
 * payroll since `hiredM` has that tenure on top of what it walked in with.
 */
export function seedEmployeeCareer(
  s: GameState,
  st: { hiredM?: number; career?: CareerLog },
): void {
  if (st.career) return;
  const prior = Math.round(prrange(s, HIRE_YEARS_IN_BUSINESS[0], HIRE_YEARS_IN_BUSINESS[1]));
  const tenure = typeof st.hiredM === "number" && st.hiredM >= 0 ? Math.max(0, s.month - st.hiredM) / 12 : 0;
  st.career = seedCareer(s, prior + tenure);
}

/**
 * Idempotent: ensure the player principal and every living rival have a Person
 * with a career, and every staff row has a career. peopleRng only. Safe on
 * every load.
 */
export function ensurePeople(s: GameState): void {
  if (s.peopleRng === undefined) {
    s.peopleRng = (s.seed ^ PEOPLE_RNG_XOR) | 0;
  }
  if (!s.principal || s.principal.seat !== "you") {
    s.principal = makePlayerPrincipal(s);
  }
  s.rivalPrincipals ??= {};
  for (const r of s.rivals ?? []) {
    if (r.failedM != null) continue;
    if (!s.rivalPrincipals[r.id]) {
      s.rivalPrincipals[r.id] = makeRivalPrincipal(s, r.id, r.name);
    }
  }
  if (s.principal && !s.principal.career) {
    s.principal.career = seedCareer(s, PLAYER_START_YEARS_IN_BUSINESS);
  }
  for (const id of Object.keys(s.rivalPrincipals)) {
    const p = s.rivalPrincipals[id];
    if (p && !p.career) p.career = seedCareer(s, Math.round(prrange(s, RIVAL_YEARS_IN_BUSINESS[0], RIVAL_YEARS_IN_BUSINESS[1])));
  }
  for (const st of s.staff ?? []) {
    seedEmployeeCareer(s, st as { hiredM?: number; career?: CareerLog });
  }
  for (const c of s.hirePool?.list ?? []) {
    seedEmployeeCareer(s, c as { hiredM?: number; career?: CareerLog });
  }
}

/** Drop the free capacity dials. Inferred firm shape from headcount stays. */
export function clearStyleOverrides(s: GameState): void {
  delete s.ownerStyle;
  delete s.benchStyle;
}

export function rivalPrincipalOf(s: GameState, firmId: string): Person | undefined {
  return s.rivalPrincipals?.[firmId];
}

/** Short league-table line: the principal's name. Never attributes. */
export function principalTag(s: GameState, firmId: string): string | null {
  const p = rivalPrincipalOf(s, firmId);
  return p ? p.name : null;
}

/**
 * Display names for the four temperament attrs. Storage keys stay forever
 * (judgment / urgency / diligence / relationships) so saves and harnesses do
 * not re-roll — see ATTR_CONTRACT.md.
 */
export const ATTR_LABEL_PERSON: Record<string, string> = {
  judgment: "Deal sense",
  urgency: "Bandwidth",
  diligence: "Rigor",
  relationships: "Access",
};

/** Neutral mid when a principal row is missing (should not happen after ensurePeople). */
export function neutralTemperament(): Record<string, number> {
  return { judgment: 50, urgency: 50, diligence: 50, relationships: 50 };
}

export function principalTemperament(s: GameState): Record<string, number> {
  const a = s.principal?.attrs;
  if (!a) return neutralTemperament();
  return {
    judgment: a.judgment ?? 50,
    urgency: a.urgency ?? 50,
    diligence: a.diligence ?? 50,
    relationships: a.relationships ?? 50,
  };
}

const CAREER_CLASSES: CareerClass[] = ["office", "retail", "multifamily", "industrial"];

export function emptyCareer(): CareerLog {
  return { classM: {}, districtM: {} };
}

/**
 * Prior career from years in the business. Drawn from peopleRng — one primary
 * class, a secondary, a handful of districts. Shape parameter: months of
 * exposure ≈ years × 12 × 0.55 (not every month is operating a book).
 */
export function seedCareer(s: GameState, yearsInBusiness: number): CareerLog {
  const years = Math.max(0, yearsInBusiness);
  const months = Math.round(years * 12 * 0.55);
  const log = emptyCareer();
  if (months <= 0) return log;
  const primary = CAREER_CLASSES[Math.floor(prng(s) * CAREER_CLASSES.length) % CAREER_CLASSES.length];
  const secondary = CAREER_CLASSES[Math.floor(prng(s) * CAREER_CLASSES.length) % CAREER_CLASSES.length];
  log.classM[primary] = Math.round(months * (primary === secondary ? 1 : 0.7));
  if (primary !== secondary) log.classM[secondary] = Math.round(months * 0.3);
  // 2–4 districts share the primary book.
  const nDist = 2 + Math.floor(prng(s) * 3);
  for (let i = 0; i < nDist; i++) {
    const d = `d${Math.floor(prng(s) * 40)}`;
    log.districtM[d] = (log.districtM[d] ?? 0) + Math.round(months / nDist);
  }
  return log;
}

/**
 * 0 = stranger, 1 = deep specialist. Exponential saturation — ~36 months in
 * class and ~24 in district approaches competent; never a purchased max.
 */
export function familiarity(
  career: CareerLog | undefined,
  cls: string,
  district: string,
): number {
  if (!career) return 0.5; // unset → neutral (staff harness / legacy)
  const hasExposure = Object.values(career.classM).some((m) => (m ?? 0) > 0)
    || Object.values(career.districtM).some((m) => (m ?? 0) > 0);
  if (!hasExposure) return 0.5;
  const cM = career.classM[cls as CareerClass] ?? 0;
  const dM = career.districtM[district] ?? 0;
  const classFit = 1 - Math.exp(-cM / 36);
  const distFit = 1 - Math.exp(-dM / 24);
  return Math.min(1, 0.55 * classFit + 0.45 * distFit);
}

/**
 * CAPACITY axis — unfamiliar work costs more desk per foot. Range centred so
 * a seeded mid-career generalist ≈ 1.0: novice 1.15, specialist 0.85.
 * Never multiplies rent, opex, or price — only how much load a building is.
 */
export function careerLoadMult(
  career: CareerLog | undefined,
  cls: string,
  district: string,
): number {
  const f = familiarity(career, cls, district);
  return 1.15 - 0.30 * f;
}

export function topCareerLines(career: CareerLog | undefined, n = 2): string[] {
  if (!career) return [];
  const classes = Object.entries(career.classM)
    .filter(([, m]) => (m ?? 0) > 6)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .slice(0, n)
    .map(([c, m]) => `${c} (${Math.round((m ?? 0) / 12)}y)`);
  return classes;
}

export function accrueCareer(
  career: CareerLog,
  cls: string,
  district: string,
  months = 1,
): void {
  const c = (CAREER_CLASSES as string[]).includes(cls) || cls === "land" ? cls as CareerClass : null;
  if (c) career.classM[c] = (career.classM[c] ?? 0) + months;
  if (district) career.districtM[district] = (career.districtM[district] ?? 0) + months;
}

function ensureCareer(s: GameState, p: Person): CareerLog {
  if (!p.career) p.career = seedCareer(s, p.seat === "you" ? PLAYER_START_YEARS_IN_BUSINESS : Math.round(prrange(s, RIVAL_YEARS_IN_BUSINESS[0], RIVAL_YEARS_IN_BUSINESS[1])));
  return p.career;
}

/**
 * Earn competence by operating — one month of exposure per building on the
 * person's book (assigned staff) or on the float (principal). peopleRng is
 * NOT stepped here; accrual is deterministic from the book.
 */
export function tickCareers(s: GameState, parcels: ParcelTable): void {
  if (s.principal) ensureCareer(s, s.principal);
  for (const st of s.staff ?? []) {
    const person = st as Person & { role?: string; assignedBbls?: string[] };
    if (!person.career) {
      seedEmployeeCareer(s, st as { career?: CareerLog; hiredM?: number });
    }
    const career = (st as { career?: CareerLog }).career ?? emptyCareer();
    (st as { career?: CareerLog }).career = career;
    for (const bbl of st.assignedBbls ?? []) {
      const rec = resolveRec(parcels, s, bbl);
      if (!rec) continue;
      accrueCareer(career, rec.class, rec.district ?? "—", 1);
    }
  }
  // Principal earns on every operated holding nobody else is pinned to for PM
  // (the float). Construction/leasing specialisation lands with the hire.
  if (s.principal) {
    const pinned = new Set<string>();
    for (const st of s.staff ?? []) {
      for (const bbl of st.assignedBbls ?? []) pinned.add(bbl);
    }
    const career = ensureCareer(s, s.principal);
    for (const bbl of Object.keys(s.holdings)) {
      if (pinned.has(bbl)) continue;
      const h = s.holdings[bbl];
      if (!h || h.groundLeased) continue;
      const rec = resolveRec(parcels, s, bbl);
      if (!rec) continue;
      accrueCareer(career, rec.class, rec.district ?? "—", 1);
    }
  }
}

/**
 * Monthly people tick — careers only. Rival-principal mortality (estate sales
 * at a drawn death month, an heir seated) and the player's estate were removed
 * with age: nobody dies in this game.
 */
export function tickPeople(s: GameState, parcels: ParcelTable): void {
  tickCareers(s, parcels);
}
