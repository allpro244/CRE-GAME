/**
 * THE WORLD YOU ARE DEALT, CHOSEN RATHER THAN ROLLED.
 *
 * The setup page asks about the PLAYER — the firm, the money, the family
 * book — and about which generation of capital owns the town. It never asks
 * about the economy: the economy is simulated (regime.ts runs the national
 * model for decades before month one) and the player meets it on the tape.
 * Owner, Oct 2026: "I don't want presets ... or eras in general. I want a
 * simulated economy." Every option is a state the engine already models,
 * never a multiplier — CLAUDE.md, "DIFFICULTY IS AN OUTPUT, NOT A DIAL".
 *
 * THE DEFAULT IS TODAY'S GAME, EXACTLY. `DEFAULT_SETUP` takes the same draws
 * in the same order as a newGame with no setup at all; test/setup.mjs proves
 * it with a state hash over two seeds and twenty years.
 *
 * WHAT WAS ASKED FOR AND IS NOT HERE, and why, so nobody adds it as a dial:
 *
 *  - SHOCK FREQUENCY. swans.ts has two hazards (TRADE_HAZARD_YR 1/22,
 *    USE_HAZARD_YR 1/30), and both are calibrations to the historical count
 *    of level events per city per century. They are not a menu of real
 *    regimes; a "calm decades" setting would be the same constant turned
 *    down. The real spread — some careers see one level event, some nine —
 *    is already in the draw, and the seed is what deals it.
 *  - ZONING REGIME. zoning.ts has one rezoning process (a base rate scaled by
 *    scarcity) and one variance desk. There is no permissive/restrictive pair
 *    of real regimes to choose between, and inventing one means two new
 *    unmeasured constants.
 *  - ANYTHING ABOUT THE ECONOMY: era, rates, credit climate, cycle phase.
 *    These are outputs of the pre-history (regime.ts), not inputs.
 *  - RIVAL COUNT as a free number. How many firms a town supports is an
 *    output — rivals are raised and fail over the run (rivals.ts). What can
 *    honestly be chosen is WHICH GENERATION of capital owns the town on day
 *    one; see FIELDS.
 */
import type { ParcelTable } from "@/data/types";
import type { GameState, Holding, RivalStyle } from "./types";
import { SVC_START } from "./types";
import { ownerOf, gradeOf } from "./rivals";
import { isCivicLand } from "./demand";
import { assetValue, initialCondIdx, inPlace, marketAppraisal } from "./value";
import { genRentRoll } from "./leasing";
import { originate, quote, productById, stabViewFor } from "./debt";
import { money } from "./money";

export type FieldChoice = "standard" | "prefunds";
export type HomeChoice = "any" | "core" | "middle" | "edge";

export interface GameSetup {
  v: 1;
  field: FieldChoice;
  /** 0 = start from nothing; 2-4 = a small family portfolio. */
  inherit: 0 | 2 | 3 | 4;
  /** Where the family's buildings are, by location tier. Only read with inherit. */
  home: HomeChoice;
  firmName?: string;
  /** Unlimited capital, no bankruptcy, no records, no goals, no milestones. */
  sandbox: boolean;
  // ---- recorded for the Saves page and run record; the store applies these ----
  island?: string;
  size?: string;
  dev?: string;
  cash0?: number;
  goal?: string | null;
  clock?: "decisions" | "opportunities" | "everything";
  /** "never" keeps broker first looks off the clock (GameState.brokerStops). */
  brokerStops?: "affordable" | "never";
  jevFirms?: number;
  spectator?: boolean;
}

export const DEFAULT_SETUP: GameSetup = {
  v: 1, field: "standard", inherit: 0, home: "any", sandbox: false,
};

/** Sandbox bankroll: large enough to be unconstrained, and labelled as such. */
export const SANDBOX_CASH = 1_000_000_000;

/** Custom opening capital bounds: the smallest cheque that buys a building, the largest institutional opening. */
export const CASH_MIN = 500_000;
export const CASH_MAX = 20_000_000;

/**
 * WHICH GENERATION OF CAPITAL OWNS THE TOWN.
 *
 * "prefunds" removes the three styles that did not exist as a class before
 * the Resolution Trust Corporation sold the S&L books in 1989-95: the
 * opportunity fund ("opportunistic"), local private equity on an IRR clock
 * ("pe") and the distressed specialist ("vulture"). Blackstone's first real
 * estate fund, Starwood's and Colony's opportunity funds and Lone Star were
 * all born of those sales. Before them the street was families, insurers and
 * pensions (core), REITs (listed since 1960), developers, merchant builders,
 * owner-users and foreign capital — which is exactly what remains.
 */
export const FIELDS: { id: FieldChoice; label: string; note: string; drop: RivalStyle[] }[] = [
  { id: "standard", label: "Today's street", note: "The whole roster: families, institutions, builders, funds on an IRR clock and the distressed specialists.", drop: [] },
  { id: "prefunds", label: "Before the opportunity funds", note: "The street before the RTC sales of 1989-95 created the opportunity fund: no PE, no opportunistic or vulture capital at the start.", drop: ["pe", "opportunistic", "vulture"] },
];

export function fieldRoster<T extends { style: RivalStyle }>(field: FieldChoice | undefined, firms: T[]): T[] {
  const f = FIELDS.find((x) => x.id === field);
  if (!f || !f.drop.length) return firms;
  return firms.filter((x) => !f.drop.includes(x.style));
}

export const HOME_OPTIONS: { id: HomeChoice; label: string; note: string }[] = [
  { id: "any", label: "Anywhere in town", note: "Wherever the family happened to buy." },
  { id: "core", label: "The core", note: "The best-located third of the built stock." },
  { id: "middle", label: "The middle ring", note: "The middle third by location." },
  { id: "edge", label: "The edge", note: "The least-located third — cheaper buildings, thinner demand." },
];

export const CLOCK_OPTIONS: { id: NonNullable<GameSetup["clock"]>; label: string; note: string }[] = [
  { id: "decisions", label: "What you own", note: "Stops only when not answering costs something you already own — a lender filing, a missed payment, a balloon, a lapsing tenant, a capital call. Broker calls, first looks, bids, books for sale and the auction wait on the docket. The standard game." },
  { id: "opportunities", label: "Opportunities too", note: "Also stops for things offered to you — a broker's call, a first look, another firm's repossessed book, a loan for sale, the county auction." },
  { id: "everything", label: "Everything", note: "Also stops for notices with nothing to decide — a tenant giving notice, a quiet letter." },
];

export function normalizeSetup(p: Partial<GameSetup> | undefined): GameSetup {
  const s = { ...DEFAULT_SETUP, ...(p ?? {}) } as GameSetup;
  // THE ECONOMY IS NOT A SETTING (owner, Oct 2026). An old save's record may
  // still carry the era and credit fields the page used to offer; they mean
  // nothing now and are dropped.
  delete (s as unknown as Record<string, unknown>).era;
  delete (s as unknown as Record<string, unknown>).credit;
  if (!FIELDS.some((f) => f.id === s.field)) s.field = "standard";
  if (![0, 2, 3, 4].includes(s.inherit)) s.inherit = 0;
  if (!HOME_OPTIONS.some((h) => h.id === s.home)) s.home = "any";
  s.firmName = s.firmName?.trim().slice(0, 48) || undefined;
  s.sandbox = !!s.sandbox;
  s.v = 1;
  return s;
}

/** What the paper calls the firm in a headline: the name less its corporate suffix. */
export function shortFirmName(name: string): string {
  const words = name.trim().split(/\s+/);
  const SUFFIX = /^(capital|partners|group|holdings|realty|properties|company|co\.?|&|and|llc|inc\.?|trust|estates?|investments?|development|associates)$/i;
  while (words.length > 1 && SUFFIX.test(words[words.length - 1])) words.pop();
  return words.join(" ");
}

/** True when nothing on this setup moves the world off the standard draw. */
export function isDefaultWorld(s: GameSetup | undefined): boolean {
  if (!s) return true;
  return s.field === "standard" && !s.inherit && !s.sandbox;
}

/** One line for a save row or a run record. */
export function describeSetup(s: GameSetup | undefined): string {
  if (!s) return "";
  const bits: string[] = [];
  if (s.field !== "standard") bits.push(FIELDS.find((f) => f.id === s.field)?.label.toLowerCase() ?? s.field);
  if (s.inherit) bits.push(`${s.inherit} family buildings`);
  if (s.sandbox) bits.push("SANDBOX");
  return bits.join(" · ");
}

// ------------------------------------------------------------ the family book

const hash01 = (key: string): number => {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 15; h = Math.imul(h, 2246822507) >>> 0; h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
};

/**
 * A family's small buildings: $0.6M-$3.5M each in year-2000 dollars, the
 * walk-ups, corner shops and loft blocks a family accumulates over a
 * generation. Not a constant to tune: it is what "small" means on the tape
 * (CASH_NOTE in StartMenu: a small building trades around $0.5-2.5M).
 */
const FAMILY_BAND: [number, number] = [600_000, 3_500_000];
/**
 * Family offices run light. The roster's own family-style firms carry 20-41%
 * leverage (rivals.ts FIRMS), and that is the real range for a generational
 * owner. The loan is a new one, written at the transfer — moving a deed into
 * a new entity triggers the due-on-sale clause on the old mortgage, so the
 * firm takes the building with fresh paper at today's sheet, sized by the
 * same desk and the same tests as any acquisition, and capped here.
 */
const FAMILY_LTV = 0.35;

/**
 * THE FAMILY'S BUILDINGS COME IN AS AN OPENING EQUITY POSITION, IN KIND.
 *
 * No cash moves, so nothing is booked to `bought`: the family contributes
 * deeds, not dollars, and `pnpm conserve`'s identity (Dcash against the
 * ledger) is untouched by construction. Two things that ARE money are booked
 * the way every closing books them:
 *   - tenant deposits come across with the roll through genRentRoll →
 *     moveDeposit, cash in and liability up, which the identity counts;
 *   - the loan is real paper on a real desk (originate), sized by the desk's
 *     own tests at the transfer, and serviced from month one.
 * The deed ledger opens with the contributed equity (appraisal less loan) as
 * the equity in, dated month zero, so returns-to-date and the exit IRR read a
 * real basis. Tax basis is the appraisal: an inherited deed takes a stepped-up
 * basis at fair market value (IRC §1014).
 *
 * Buildings are picked deterministically off the seed (not off `s.rng`), from
 * built stock no rival owns, so the rest of the world's draws do not move.
 */
export function inheritPortfolio(s: GameState, parcels: ParcelTable): string[] {
  const n = s.setup?.inherit ?? 0;
  if (!n) return [];
  const built: string[] = [];
  for (const bbl of Object.keys(parcels)) {
    const rec = parcels[bbl];
    if (!rec || rec.class === "land" || !(rec.bldgArea > 0)) continue;
    if (ownerOf(s, bbl) || isCivicLand(s, bbl) || s.landmarks?.[bbl] !== undefined) continue;
    built.push(bbl);
  }
  built.sort((a, b) => (parcels[a].demandScore - parcels[b].demandScore) || (a < b ? -1 : 1));
  const third = Math.floor(built.length / 3);
  const home = s.setup?.home ?? "any";
  const tier = home === "edge" ? built.slice(0, third)
    : home === "middle" ? built.slice(third, 2 * third)
    : home === "core" ? built.slice(2 * third)
    : built;
  const ranked = tier
    .map((bbl) => ({ bbl, r: hash01(`${s.seed}:family:${bbl}`) }))
    .sort((a, b) => a.r - b.r);
  const took: string[] = [];
  // The hometown bank: small cheques are its business (the regional desk has a
  // minimum loan these buildings sit under), and it is the family's bank.
  const prod = productById("harbor");
  for (const { bbl } of ranked) {
    if (took.length >= n) break;
    const rec = parcels[bbl];
    const grade = gradeOf(s, rec);
    const v0 = assetValue(rec, s.econ, grade, initialCondIdx(rec, s.month, grade));
    if (!(v0 >= FAMILY_BAND[0] && v0 <= FAMILY_BAND[1])) continue;
    const h: Holding = {
      bbl, boughtM: s.month, costBasis: v0, assessed: v0, loan: null,
      condition: grade, condIdx: initialCondIdx(rec, s.month, grade),
      service: s.opsPolicy?.service ?? 0, stance: s.opsPolicy?.stance ?? 0, plan: s.opsPolicy?.plan ?? 1,
      svcIdx: SVC_START, tenants: [], cfHistory: [],
    };
    s.holdings[bbl] = h;
    genRentRoll(s, rec, h, false);
    // The appraiser reads the roll the family actually has.
    const value = Math.round(marketAppraisal(s, rec, bbl, grade));
    if (!(value > 0)) { delete s.holdings[bbl]; continue; }
    h.costBasis = value;
    h.assessed = value;
    const noi = inPlace(rec, s, bbl, value).noi;
    if (noi > 0) {
      const stab = stabViewFor(rec, s.econ, grade, value);
      const full = quote(s, prod, value, noi, rec.class, false, stab, grade).principal;
      const lev = full > 0 ? Math.min(1, (FAMILY_LTV * value) / full) : 0;
      if (lev > 0) h.loan = originate(s, prod, value, noi, lev, grade, rec.class, stab);
    }
    const equity = value - (h.loan?.balance ?? 0);
    (s.deedCf ??= {})[bbl] = { cf: [s.month, -equity], from: s.month };
    took.push(bbl);
  }
  if (took.length) {
    const total = took.reduce((a, b) => a + (s.holdings[b].costBasis ?? 0), 0);
    const debt = took.reduce((a, b) => a + (s.holdings[b].loan?.balance ?? 0), 0);
    s.news.push({
      q: s.month, kind: "info",
      text: `The family's buildings come with you: ${took.map((b) => parcels[b].address).join(", ")} — `
        + `${money(total)} at the appraiser's number, ${debt > 0 ? `${money(debt)} of fresh ${prod.lender} paper written at the transfer` : "free and clear"}. `
        + `The rolls, the deposits and the roofs are yours now.`,
    });
  }
  return took;
}
