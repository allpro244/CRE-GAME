/**
 * THE PRINCIPAL — one person type for the player, every hire, every heir, and
 * every rival firm's operating principal.
 *
 * Phase 1 lands the type inert: existing staff behaviour is re-pointed at the
 * same fields unchanged, a principal is synthesised for old saves, and nothing
 * yet dies, raises a fund, or earns a career. See HANDOFF_PRINCIPAL.md.
 *
 * RNG: this module owns `s.peopleRng`, seeded `s.seed ^ 0x50454f50` ("PEOP").
 * A hiring pool must not re-roll the economy (staff.ts); a man's date of death
 * must not either. Draw the death month ONCE at creation — never a monthly
 * hazard — so the draw count is auditable and foreshadowing stays honest.
 */
import type { GameState } from "./types";
import { START_YEAR } from "./types";
import { mulberry32Step } from "./market";

export type PersonSeat = "you" | "employee" | "partner" | "rival" | "none";

/**
 * One human being. Staff are Persons with seat "employee" plus payroll fields
 * (see staff.ts). The player is seat "you". Rival firms carry seat "rival".
 */
export interface Person {
  id: number;
  name: string;
  /**
   * Birth month on the campaign clock. May be negative (born before month 0).
   * Age arithmetic always goes through ageYears() so START_YEAR stays single-
   * sourced — do not invent `2000 + month/12` beside this.
   */
  bornM: number;
  /**
   * Death month on the campaign clock, drawn once at creation from a period
   * life table (drawDeathM). Absent on legacy staff synthesised without a
   * draw; filled on the next ensurePeople pass. Nothing reads this until the
   * mortality phases — storing it now keeps Phase 4/5 from re-drawing.
   */
  diesM?: number;
  /** TRUE ability, 1-100. Shown only for seat "you". Never for anyone else. */
  attrs: Record<string, number>;
  /** Noisy first read — interview / dealing history. */
  obs: Record<string, number>;
  /** How wide the initial read was. */
  band0: number;
  seat: PersonSeat;
  /** Rival.firm id when seat === "rival". */
  firmId?: string;
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

/**
 * US SSA Period Life Table 2019, male — selected ages, annual death probability qx.
 * Source: https://www.ssa.gov/oact/STATS/table4c6.html (period life table).
 * Shape parameter: male table (CRE principals historically skew male; a later
 * pass can sex-mix without changing the draw contract — one U per person).
 *
 * Calibrated industry constant, not a balance dial. Hardcoded with citation.
 */
const QX_MALE: ReadonlyArray<readonly [age: number, qx: number]> = [
  [20, 0.00115], [25, 0.00135], [30, 0.00152], [35, 0.00178],
  [40, 0.00234], [45, 0.00348], [50, 0.00528], [55, 0.00812],
  [60, 0.01248], [65, 0.01872], [70, 0.02915], [75, 0.04682],
  [80, 0.07591], [85, 0.12140], [90, 0.18870], [95, 0.28750],
  [100, 0.41450], [105, 0.55100], [110, 0.68000],
];

function qxAt(age: number): number {
  if (age <= QX_MALE[0][0]) return QX_MALE[0][1];
  if (age >= QX_MALE[QX_MALE.length - 1][0]) return QX_MALE[QX_MALE.length - 1][1];
  for (let i = 1; i < QX_MALE.length; i++) {
    const [a1, q1] = QX_MALE[i - 1];
    const [a2, q2] = QX_MALE[i];
    if (age <= a2) {
      const t = (age - a1) / (a2 - a1);
      return q1 + t * (q2 - q1);
    }
  }
  return QX_MALE[QX_MALE.length - 1][1];
}

/**
 * Draw the death month ONCE. One uniform from peopleRng; invert residual
 * lifetime from current age against the period table. Contract: exactly one
 * peopleRng step per call.
 */
export function drawDeathM(s: GameState, bornM: number, atMonth: number = s.month): number {
  const age0 = Math.max(18, (atMonth - bornM) / 12);
  const u = prng(s);
  let cdf = 0;
  let surv = 1;
  const start = Math.floor(age0);
  for (let age = start; age < 110; age++) {
    const qx = qxAt(age + 0.5);
    const pDie = surv * qx;
    if (u < cdf + pDie) {
      const within = pDie > 0 ? (u - cdf) / pDie : 0.5;
      return Math.round(bornM + (age + within) * 12);
    }
    cdf += pDie;
    surv *= (1 - qx);
  }
  return Math.round(bornM + 110 * 12);
}

/** Calendar age in whole years at the current (or given) month. */
export function ageYears(p: Pick<Person, "bornM">, month: number): number {
  return Math.max(0, Math.floor((month - p.bornM) / 12));
}

/** Calendar year of birth for display. */
export function birthYear(p: Pick<Person, "bornM">): number {
  return START_YEAR + Math.floor(p.bornM / 12);
}

export const GENERAL_PERSON_ATTRS = [
  "judgment", "urgency", "diligence", "relationships",
] as const;

/** Default opening age when the start-menu trade (Phase 5) is not yet live. */
export const DEFAULT_PRINCIPAL_AGE = 40;

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
 * Opening principal for a new run. Age is fixed until Phase 5's start-menu
 * trade; death is drawn once. Attrs use peopleRng only — never s.rng / staffRng.
 */
export function makePlayerPrincipal(s: GameState, ageYrs: number = DEFAULT_PRINCIPAL_AGE): Person {
  const bornM = s.month - Math.round(ageYrs * 12);
  const attrs = drawGeneralAttrs(s);
  const p: Person = {
    id: 0,
    name: s.firm?.name ? principalNameFromFirm(s.firm.name, s) : pickName(s),
    bornM,
    attrs,
    obs: observeSelf(attrs),
    band0: 0,
    seat: "you",
  };
  p.diesM = drawDeathM(s, bornM, s.month);
  return p;
}

function principalNameFromFirm(firmName: string, s: GameState): string {
  // Prefer a human name; firm name stays on FirmIdentity.
  void firmName;
  return pickName(s);
}

/** Rival operating principal — inert until mortality phases. */
export function makeRivalPrincipal(s: GameState, firmId: string, firmName: string, ageYrs?: number): Person {
  // Age band 38–72: working principals, not the opening associate class.
  const age = ageYrs ?? Math.round(prrange(s, 38, 72));
  const bornM = s.month - Math.round(age * 12);
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
    bornM,
    attrs,
    obs,
    band0,
    seat: "rival",
    firmId,
  };
  p.diesM = drawDeathM(s, bornM, s.month);
  return p;
}

/**
 * Birth month for a new hire, drawn from peopleRng AFTER staffRng work is done
 * so the staff stream's step count is unchanged. Age 28–55 at hire.
 */
export function stampEmployeeLife(s: GameState, st: { bornM?: number; diesM?: number }): void {
  if (st.bornM === undefined) {
    const age = Math.round(prrange(s, 28, 55));
    st.bornM = s.month - age * 12;
  }
  if (st.diesM === undefined) {
    st.diesM = drawDeathM(s, st.bornM, s.month);
  }
}

/**
 * Idempotent: ensure the player principal and every living rival have a Person,
 * and every staff row has bornM/diesM. Uses peopleRng only. Safe on every load.
 */
export function ensurePeople(s: GameState): void {
  if (s.peopleRng === undefined) {
    s.peopleRng = (s.seed ^ PEOPLE_RNG_XOR) | 0;
  }
  if (!s.principal || s.principal.seat !== "you") {
    s.principal = makePlayerPrincipal(s, DEFAULT_PRINCIPAL_AGE);
  } else if (s.principal.diesM === undefined) {
    s.principal.diesM = drawDeathM(s, s.principal.bornM, s.month);
  }
  s.rivalPrincipals ??= {};
  for (const r of s.rivals ?? []) {
    if (r.failedM != null) continue;
    if (!s.rivalPrincipals[r.id]) {
      s.rivalPrincipals[r.id] = makeRivalPrincipal(s, r.id, r.name);
    } else if (s.rivalPrincipals[r.id].diesM === undefined) {
      const p = s.rivalPrincipals[r.id];
      p.diesM = drawDeathM(s, p.bornM, s.month);
    }
  }
  for (const st of s.staff ?? []) {
    stampEmployeeLife(s, st as { bornM?: number; diesM?: number });
  }
  for (const c of s.hirePool?.list ?? []) {
    stampEmployeeLife(s, c as { bornM?: number; diesM?: number });
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

/** Short league-table line: "Halloran Voss, 44". Never attributes. */
export function principalTag(s: GameState, firmId: string): string | null {
  const p = rivalPrincipalOf(s, firmId);
  if (!p) return null;
  return `${p.name}, ${ageYears(p, s.month)}`;
}

export const ATTR_LABEL_PERSON: Record<string, string> = {
  judgment: "Judgment",
  urgency: "Sense of urgency",
  diligence: "Detail orientation",
  relationships: "Relationships",
};
