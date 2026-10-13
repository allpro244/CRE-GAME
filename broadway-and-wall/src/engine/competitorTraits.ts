// THE COMPETITOR'S SHEET — COMPETITORS_PLAN.md §2–§3.
//
// A competitor used to be one of eleven STYLES, and the style was every
// difference it had: leverage, hold clock, cycle sensitivity, upkeep, build
// appetite, and a short list of asset classes. Nothing said WHERE a firm
// buys, HOW BIG it goes or WHAT QUALITY it builds, so a trophy builder and a
// merchant builder were the same firm on the map.
//
// So a firm now carries a sheet: about twenty numbers (1–100), a few hard
// RULES and a couple of QUIRKS. Every number changes a DECISION — a filter, a
// threshold, or a weight when the firm ranks its options. None of them makes
// the market kinder to the firm (CLAUDE.md, "no fake numbers";
// ATTR_CONTRACT.md: only capacity, access, information and time).
//
// THE STYLE IS STILL THE FALLBACK, AND THAT IS HOW THE PLUMBING IS PROVED. A
// firm with no stored sheet (every save written before this, and every firm
// until the roster draws profiles) reads its parameters from its style row,
// exactly as before — `params()` hands back the style's own numbers, so the
// century is bit-identical. A firm WITH a sheet reads each parameter through
// the mapping below. `sheetOf()` derives a sheet from the style for display,
// and is never read by behaviour, so showing a number cannot move the economy.
//
// Nothing here draws on any RNG stream. Sheets are drawn by hash off the run
// seed and the firm id (`hash01`), the discipline owners.ts and ledger.ts use,
// because a roster that consumed the rivals stream would re-roll the century
// every time somebody added a profile.
import type { RivalStyle } from "./types";

export type TraitKey =
  // where
  | "prime" | "edge" | "homeTurf"
  // what
  | "office" | "residential" | "retail" | "industrial" | "land" | "scale" | "quality"
  // how
  | "build" | "hold" | "renovation" | "distress" | "assembly"
  // money
  | "leverage" | "cycle" | "discipline" | "cashOut"
  // run
  | "upkeep" | "capacity" | "reach" | "underwriting"
  // temperament
  | "grudge" | "secrecy" | "panic";

export type TraitGroup = "Where" | "What" | "How" | "Money" | "Run" | "Temperament";

export interface TraitDef {
  key: TraitKey;
  label: string;
  group: TraitGroup;
  /** What 1 and 100 mean, for the card's tooltip. */
  lo: string;
  hi: string;
  /** Never shown as a number until an event reveals it (§2.4). */
  hidden?: boolean;
}

export const TRAITS: readonly TraitDef[] = [
  { key: "prime", label: "Prime appetite", group: "Where", lo: "avoids the core", hi: "only the best-located lots" },
  { key: "edge", label: "Edge appetite", group: "Where", lo: "never leaves the core", hi: "lives on the outskirts" },
  { key: "homeTurf", label: "Home-turf loyalty", group: "Where", lo: "buys anywhere", hi: "only where it already owns" },
  { key: "office", label: "Office", group: "What", lo: "won't touch it", hi: "specialist" },
  { key: "residential", label: "Residential", group: "What", lo: "won't touch it", hi: "specialist" },
  { key: "retail", label: "Retail", group: "What", lo: "won't touch it", hi: "specialist" },
  { key: "industrial", label: "Industrial", group: "What", lo: "won't touch it", hi: "specialist" },
  { key: "land", label: "Land", group: "What", lo: "won't touch it", hi: "specialist" },
  { key: "scale", label: "Scale", group: "What", lo: "small infill", hi: "full-block towers" },
  { key: "quality", label: "Quality", group: "What", lo: "Class C", hi: "trophy" },
  { key: "build", label: "Build appetite", group: "How", lo: "never builds", hi: "builds everything" },
  { key: "hold", label: "Hold patience", group: "How", lo: "flips", hi: "holds for generations" },
  { key: "renovation", label: "Renovation appetite", group: "How", lo: "buys as-is", hi: "buys tired to fix" },
  { key: "distress", label: "Distress appetite", group: "How", lo: "avoids it", hi: "hunts it" },
  { key: "assembly", label: "Assembly drive", group: "How", lo: "single lots", hi: "builds sites lot by lot" },
  { key: "leverage", label: "Leverage appetite", group: "Money", lo: "all cash", hi: "max the lender gives" },
  { key: "cycle", label: "Cycle timing", group: "Money", lo: "buys busts", hi: "rides booms" },
  { key: "discipline", label: "Price discipline", group: "Money", lo: "will overpay", hi: "never above its number" },
  { key: "cashOut", label: "Cash-out appetite", group: "Money", lo: "never refinances out", hi: "pulls equity every boom" },
  { key: "upkeep", label: "Upkeep", group: "Run", lo: "milks the building", hi: "over-maintains" },
  { key: "capacity", label: "Capacity", group: "Run", lo: "one deal at a time", hi: "many at once" },
  { key: "reach", label: "Reach", group: "Run", lo: "only the open tape", hi: "first call off-market" },
  { key: "underwriting", label: "Underwriting", group: "Run", lo: "sloppy values", hi: "sharp values" },
  { key: "grudge", label: "Grudge memory", group: "Temperament", lo: "forgets", hi: "never forgets" },
  { key: "secrecy", label: "Secrecy", group: "Temperament", lo: "an open book", hi: "opaque" },
  { key: "panic", label: "Panic threshold", group: "Temperament", lo: "sells at the first stress", hi: "rides it to the end", hidden: true },
];

export const TRAIT_OF: Record<TraitKey, TraitDef> =
  Object.fromEntries(TRAITS.map((t) => [t.key, t])) as Record<TraitKey, TraitDef>;

export type Sheet = Record<TraitKey, number>;

// ------------------------------------------------------------------- rules

/**
 * HARD LIMITS. Rules filter a firm's options BEFORE its numbers rank them. A
 * firm carries 0–3. "NEVER sells to the player" is earned through the
 * relationship ledger and is never rolled.
 */
export type Rule =
  | "onlyTrophy" | "onlyOffice" | "onlyResidential" | "onlyRetail" | "onlyIndustrial" | "onlyLand"
  | "onlyAssembles" | "onlyHome" | "onlyBuilds"
  | "neverSells" | "neverBuilds" | "neverAbove50" | "neverDistress" | "neverSellsToPlayer"
  | "alwaysOwnBlock" | "alwaysSellsAtDelivery" | "alwaysCourthouse";

export const RULE_LABEL: Record<Rule, string> = {
  onlyTrophy: "ONLY trophy",
  onlyOffice: "ONLY office",
  onlyResidential: "ONLY residential",
  onlyRetail: "ONLY retail",
  onlyIndustrial: "ONLY industrial",
  onlyLand: "ONLY land",
  onlyAssembles: "ONLY assembles",
  onlyHome: "ONLY its home district",
  onlyBuilds: "ONLY builds",
  neverSells: "NEVER sells",
  neverBuilds: "NEVER builds",
  neverAbove50: "NEVER above 50% LTV",
  neverDistress: "NEVER buys distress",
  neverSellsToPlayer: "NEVER sells to you",
  alwaysOwnBlock: "ALWAYS bids on its own block",
  alwaysSellsAtDelivery: "ALWAYS sells at delivery",
  alwaysCourthouse: "ALWAYS at the courthouse steps",
};

/** Public rules — what the market already knows about a firm (§2.4). */
export const PUBLIC_RULES: ReadonlySet<Rule> = new Set<Rule>([
  "onlyTrophy", "onlyOffice", "onlyResidential", "onlyRetail", "onlyIndustrial", "onlyLand",
  "onlyHome", "onlyBuilds", "neverSells", "neverBuilds", "neverSellsToPlayer", "alwaysSellsAtDelivery",
]);

// ------------------------------------------------------------------ quirks

export type Quirk =
  | "corner" | "loyalBank" | "backer" | "copycat" | "trophyHunter"
  | "landmark" | "latePayer" | "patientSeller" | "champion" | "feuding";

export const QUIRK_LABEL: Record<Quirk, string> = {
  corner: "corner-obsessed",
  loyalBank: "loyal to one bank",
  backer: "deep-pocketed backer",
  copycat: "copycat",
  trophyHunter: "trophy hunter",
  landmark: "landmark lover",
  latePayer: "late payer",
  patientSeller: "patient seller",
  champion: "neighbourhood champion",
  feuding: "feuding",
};

/** Quirks nobody knows about until the firm uses them (§2.3). */
export const HIDDEN_QUIRKS: ReadonlySet<Quirk> = new Set<Quirk>(["backer"]);

// ------------------------------------------------------------- the mapping

/** The legacy style row — the shape rivals.ts's STYLE table has always had. */
export interface StyleRow {
  appetite: number;
  procyclical: number;
  maxLtv: number;
  cashOut: number;
  classes: string[] | null;
  patience: number;
  holdM: number;
  contra: number;
  distressBias: number;
}

/** Every parameter a decision site reads, in one place. */
export interface Params extends StyleRow {
  /** CARE: leasing effort and capital plan, 1 = market standard. */
  care: { lease: number; capex: number };
  /** BUILD_APPETITE. */
  build: number;
  /** Concurrent live construction jobs. */
  jobs: number;
  /** YIELD_OVER_COUPON: the spread its committee needs, in points. */
  hurdle: number;
}

const lin = (t: number, a: number, b: number) => a + (b - a) * Math.max(0, Math.min(100, t)) / 100;
export const inv = (v: number, a: number, b: number) => Math.round(Math.max(1, Math.min(100, ((v - a) / (b - a)) * 100)));

// THE RANGES. Each runs wide enough that every legacy style sits inside it,
// so a profile can reach any firm the old table described and a little past
// it — a flipper levers harder than the old "opportunistic", a dynasty holds
// longer than the old "family" — without anything resting on a rail.
const R = {
  maxLtv: [0.15, 0.95],
  cashOut: [0, 1],
  patience: [1.30, 0.96],      // discipline 1 overpays to 1.30x appraisal; 100 stops at 0.96x
  distressBias: [0.3, 2.7],
  build: [0, 1.4],
  appetite: [0.25, 1.30],      // capacity — how often it is in the market at all
  procyclical: [0.2, 2.0],
  hurdle: [-0.9, 1.7],         // discipline — what spread its committee needs
  capex: [0.05, 1.25],
  lease: [0.65, 1.35],
} as const;

/** Leverage appetite's range, for the roster's opening-book floor. */
export const LEVERAGE_RANGE = R.maxLtv;

/** holdM: 12 months at 0, 300 at 100. Forever is a rule (NEVER sells), not a number. */
const holdOf = (t: number) => Math.round(12 + 2.88 * Math.max(0, Math.min(100, t)));
/** contra: only the bottom of the cycle trait inverts the credit window. */
// POSITIVE leans INTO a shut window (every reader is `+ contra × (1 − ci)`).
// It was negative, carried over from the vulture style row, so a contrarian
// bought less in a crunch and more in a boom — the opposite of its label.
// Up to 3.4 at Cycle 0: in a crunch (credit index 0.8) a pure contrarian is
// ~4.5x as keen as in a boom (1.2) — it does most of its buying when nobody
// else can. (1.7 measured as barely visible: 15% of buys in tight credit
// against 12-14% for everyone else, two towns x 50 years.)
const contraOf = (t: number) => (t < 30 ? 3.4 * (30 - t) / 29 : 0);
const jobsOf = (t: number, build: number) => (build <= 0 ? 0 : 1 + Math.floor(Math.max(0, Math.min(99, t)) / 25));

const CLASS_TRAIT: Record<string, TraitKey> = {
  office: "office", multifamily: "residential", retail: "retail", industrial: "industrial", land: "land",
};
/** Under this a class is a hard no. */
export const CLASS_FLOOR = 15;

/**
 * THE PARAMETERS A FIRM ACTS ON. Without a stored sheet, the style's own row,
 * unchanged — the bit-identical path. With one, each parameter through its
 * trait, and the rules folded in where a rule is a limit on a number.
 */
export function paramsFrom(sheet: Sheet | undefined, rules: readonly Rule[] | undefined, base: Params): Params {
  if (!sheet) return base;
  const has = (x: Rule) => !!rules?.includes(x);
  const build = has("neverBuilds") ? 0 : lin(sheet.build, R.build[0], R.build[1]);
  let classes: string[] = [];
  for (const [cls, k] of Object.entries(CLASS_TRAIT)) if (sheet[k] >= CLASS_FLOOR) classes.push(cls);
  // AN "ONLY" RULE IS THE WHOLE LIST, whatever drift or jitter did to the
  // other class numbers. A builder under ONLY industrial still buys the dirt it
  // builds the warehouses on.
  const only = has("onlyOffice") ? "office" : has("onlyResidential") ? "multifamily" : has("onlyRetail") ? "retail"
    : has("onlyIndustrial") ? "industrial" : has("onlyLand") ? "land" : null;
  if (only) classes = only === "land" || !(build > 0) ? [only] : [only, "land"];
  return {
    appetite: lin(sheet.capacity, R.appetite[0], R.appetite[1]),
    procyclical: lin(sheet.cycle, R.procyclical[0], R.procyclical[1]),
    maxLtv: has("neverAbove50") ? Math.min(0.5, lin(sheet.leverage, R.maxLtv[0], R.maxLtv[1])) : lin(sheet.leverage, R.maxLtv[0], R.maxLtv[1]),
    cashOut: lin(sheet.cashOut, R.cashOut[0], R.cashOut[1]),
    classes: classes.length === 5 ? null : classes,
    patience: lin(sheet.discipline, R.patience[0], R.patience[1]),
    holdM: has("neverSells") ? 0 : holdOf(sheet.hold),
    contra: contraOf(sheet.cycle),
    distressBias: has("neverDistress") ? 0 : lin(sheet.distress, R.distressBias[0], R.distressBias[1]),
    care: { lease: lin(sheet.upkeep, R.lease[0], R.lease[1]), capex: lin(sheet.upkeep, R.capex[0], R.capex[1]) },
    build,
    jobs: jobsOf(sheet.capacity, build),
    hurdle: lin(sheet.discipline, R.hurdle[0], R.hurdle[1]),
  };
}

/**
 * A SHEET READ OFF A STYLE — for display only. Inverts the mapping so a firm
 * from an old save shows the numbers its behaviour actually has. Traits the
 * old table never described (where, scale, quality, the temperament) sit at
 * the middle, which is what that firm's behaviour was: indifferent.
 */
export function sheetFromStyle(base: Params): Sheet {
  const cls = (c: string) => (base.classes === null ? 50 : base.classes.includes(c) ? 80 : 5);
  return {
    prime: 60, edge: 40, homeTurf: 30,
    office: cls("office"), residential: cls("multifamily"), retail: cls("retail"),
    industrial: cls("industrial"), land: cls("land"),
    scale: 50, quality: inv(base.care.capex, R.capex[0], R.capex[1]),
    build: inv(base.build, R.build[0], R.build[1]),
    hold: base.holdM === 0 ? 100 : inv(base.holdM, 12, 300),
    renovation: 30,
    distress: inv(base.distressBias, R.distressBias[0], R.distressBias[1]),
    assembly: 10,
    leverage: inv(base.maxLtv, R.maxLtv[0], R.maxLtv[1]),
    cycle: base.contra > 1 ? inv(30 - base.contra / 3.4 * 29, 0, 100) : inv(base.procyclical, R.procyclical[0], R.procyclical[1]),
    discipline: inv(base.patience, R.patience[0], R.patience[1]),
    cashOut: inv(base.cashOut, R.cashOut[0], R.cashOut[1]),
    upkeep: inv(base.care.capex, R.capex[0], R.capex[1]),
    capacity: inv(base.appetite, R.appetite[0], R.appetite[1]),
    reach: 40, underwriting: 50, grudge: 50, secrecy: 50, panic: 50,
  };
}

export const classTrait = (cls: string): TraitKey | null => CLASS_TRAIT[cls] ?? null;

// ----------------------------------------------------------------- hashing

/** 0..1 from a string, no RNG stream (owners.ts uses the same discipline). */
export function hash01(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 2246822507);
  h ^= h >>> 13; h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ---------------------------------------------------------------- profiles

export type ProfileId =
  | "trophy" | "ego" | "merchant" | "industrialEdge" | "rentalBuilder" | "placemaker" | "assembler"
  | "bts" | "converter" | "core" | "officeReit" | "retailReit" | "residentialReit" | "dynasty"
  | "foreignTrophy" | "ownerUser" | "highStreet" | "netLease" | "neighbourhood" | "expander"
  | "vulture" | "loanToOwn" | "flipper" | "valueAdd" | "contrarian" | "landBanker" | "raider"
  | "slumlord" | "preservationist" | "spinout";

export interface Profile {
  id: ProfileId;
  label: string;
  /**
   * The legacy style the rest of the engine keys on: deal-by-deal syndication,
   * merchant exits, the Jev charter, the league table's style word. A profile
   * picks the style whose machinery it actually runs on.
   */
  style: RivalStyle;
  /** Trait centres. Anything unlisted centres at 50. */
  centre: Partial<Sheet>;
  /** Usual rules, each kept with probability `p`. */
  rules: { rule: Rule; p: number }[];
  /** Quirks this kind of firm tends to carry. */
  quirks: Quirk[];
}

const P = (
  id: ProfileId, label: string, style: RivalStyle, centre: Partial<Sheet>,
  rules: [Rule, number][] = [], quirks: Quirk[] = [],
): Profile => ({ id, label, style, centre, rules: rules.map(([rule, p]) => ({ rule, p })), quirks });

// Classes are listed where a profile cares; a specialist is its class at 90+
// and every other class under the floor.
const ONLY = (k: TraitKey): Partial<Sheet> => ({
  office: 5, residential: 5, retail: 5, industrial: 5, land: 5, [k]: 95,
});

export const PROFILES: readonly Profile[] = [
  // --- builders
  P("trophy", "Trophy Builder", "developer",
    { prime: 92, edge: 5, scale: 85, quality: 95, build: 85, hold: 80, leverage: 35, discipline: 55, upkeep: 85,
      office: 85, residential: 75, retail: 30, industrial: 5, land: 70 },
    [["onlyTrophy", 0.8]], ["corner", "trophyHunter"]),
  P("ego", "Ego Builder", "developer",
    { prime: 88, edge: 5, scale: 98, quality: 90, build: 95, hold: 70, discipline: 12, underwriting: 25, leverage: 70, panic: 30,
      office: 85, residential: 70, retail: 20, industrial: 5, land: 80 },
    [["onlyBuilds", 0.6]], ["corner", "trophyHunter", "feuding"]),
  P("merchant", "Merchant Builder", "merchant",
    { build: 95, hold: 8, scale: 50, quality: 55, leverage: 70, capacity: 75, land: 90 },
    [["alwaysSellsAtDelivery", 0.7]], ["copycat"]),
  P("industrialEdge", "Industrial Edge Developer", "developer",
    { ...ONLY("industrial"), land: 80, edge: 92, prime: 10, build: 85, scale: 70, quality: 45, cycle: 75, capacity: 70 },
    [["onlyIndustrial", 0.8]], ["copycat"]),
  P("rentalBuilder", "Workhorse Rental Builder", "developer",
    { residential: 92, office: 10, retail: 30, industrial: 5, land: 70, prime: 40, edge: 60, build: 70, hold: 90, leverage: 55, upkeep: 60 },
    [], ["champion"]),
  P("placemaker", "Mixed-Use Placemaker", "developer",
    { retail: 75, residential: 75, office: 40, industrial: 5, land: 75, assembly: 75, homeTurf: 88, build: 80, prime: 60, quality: 70 },
    [["onlyHome", 0.7]], ["champion", "landmark"]),
  P("assembler", "Assembler", "developer",
    { assembly: 98, land: 85, discipline: 70, hold: 60, build: 60, scale: 80, reach: 70 },
    [["onlyAssembles", 0.7], ["alwaysOwnBlock", 0.6]], ["patientSeller", "corner"]),
  P("bts", "Build-to-Suit Specialist", "developer",
    { build: 80, office: 70, industrial: 65, retail: 40, residential: 10, land: 60, reach: 82, quality: 65 },
    [["onlyBuilds", 0.6]], ["loyalBank"]),
  P("converter", "Adaptive-Reuse Converter", "opportunistic",
    { office: 85, residential: 70, renovation: 95, distress: 62, cycle: 30, quality: 40, prime: 60 },
    [], ["landmark"]),
  // --- long-term holders that still buy
  P("core", "Pension / Core", "core",
    { office: 75, residential: 75, retail: 40, industrial: 40, land: 5, quality: 78, leverage: 30, hold: 85, discipline: 82, cycle: 50, upkeep: 75 },
    [["neverAbove50", 0.8]], ["loyalBank"]),
  P("officeReit", "Office REIT", "reit",
    { ...ONLY("office"), capacity: 82, hold: 75, quality: 70, prime: 70, leverage: 45 }, [["onlyOffice", 0.9]], []),
  P("retailReit", "Retail REIT", "reit",
    { ...ONLY("retail"), capacity: 82, hold: 75, quality: 60, prime: 75, leverage: 45 }, [["onlyRetail", 0.9]], []),
  P("residentialReit", "Residential REIT", "reit",
    { ...ONLY("residential"), capacity: 82, hold: 75, quality: 60, leverage: 45 }, [["onlyResidential", 0.9]], []),
  P("dynasty", "Old Family Dynasty", "family",
    { hold: 98, leverage: 15, quality: 70, homeTurf: 75, secrecy: 88, capacity: 20, discipline: 80, upkeep: 70, panic: 85 },
    [["neverSells", 0.7]], ["landmark", "patientSeller", "champion"]),
  P("foreignTrophy", "Foreign Trophy Buyer", "foreign",
    { quality: 95, prime: 95, edge: 3, discipline: 10, build: 5, leverage: 25, hold: 75, office: 85, residential: 70, retail: 30, industrial: 5, land: 5 },
    [["onlyTrophy", 0.8]], ["trophyHunter"]),
  P("ownerUser", "Owner-User Corporation", "owneruser",
    { office: 80, industrial: 55, residential: 5, retail: 10, land: 20, hold: 100, build: 30, discipline: 25 },
    [["neverSells", 0.8]], []),
  P("highStreet", "High-Street Retail Landlord", "core",
    { ...ONLY("retail"), prime: 82, hold: 75, quality: 60 }, [["onlyRetail", 0.9]], ["corner"]),
  P("netLease", "Net-Lease Buyer", "core",
    { quality: 60, hold: 80, discipline: 40, renovation: 5, office: 60, industrial: 60, retail: 60, residential: 20, land: 5 },
    [], []),
  P("neighbourhood", "Neighbourhood Operator", "family",
    { residential: 88, retail: 40, office: 10, industrial: 10, land: 20, scale: 15, homeTurf: 95, capacity: 75, upkeep: 60, prime: 35, edge: 55 },
    [["onlyHome", 0.8]], ["champion"]),
  P("expander", "Institutional Expander", "owneruser",
    { homeTurf: 100, discipline: 10, hold: 100, build: 40, office: 60, residential: 50, land: 60 },
    [["onlyHome", 0.9], ["neverSells", 0.9]], []),
  // --- capital and predators
  P("vulture", "Vulture", "vulture",
    { distress: 97, cycle: 5, underwriting: 80, hold: 50, leverage: 45, discipline: 85, renovation: 55 },
    [["alwaysCourthouse", 0.7]], ["backer"]),
  P("loanToOwn", "Loan-to-Own Lender", "vulture",
    { distress: 90, reach: 72, underwriting: 85, cycle: 15, leverage: 35, hold: 45 }, [], ["loyalBank"]),
  P("flipper", "Hot-Money Flipper", "opportunistic",
    { leverage: 95, cycle: 98, hold: 10, underwriting: 30, panic: 20, discipline: 25, cashOut: 85, capacity: 80 },
    [], ["copycat", "latePayer"]),
  P("valueAdd", "Value-Add Fund", "pe",
    { renovation: 85, hold: 22, leverage: 70, quality: 45, discipline: 55, cashOut: 65 }, [], ["copycat"]),
  P("contrarian", "Contrarian", "core",
    { cycle: 5, quality: 72, discipline: 92, leverage: 20, hold: 85, distress: 55, secrecy: 75 }, [], ["patientSeller"]),
  P("landBanker", "Land Banker", "pe",
    { ...ONLY("land"), build: 0, edge: 72, hold: 60, leverage: 15, discipline: 70 },
    [["neverBuilds", 0.9], ["onlyLand", 0.8]], ["patientSeller"]),
  P("raider", "Corporate Raider", "opportunistic",
    { distress: 70, capacity: 90, reach: 85, leverage: 75, hold: 35, underwriting: 70 }, [], ["feuding", "backer"]),
  P("slumlord", "Slumlord", "slumlord",
    { quality: 5, upkeep: 3, residential: 75, retail: 50, industrial: 50, office: 10, land: 5, cashOut: 70, prime: 15, edge: 70, discipline: 90 },
    [], ["latePayer"]),
  P("preservationist", "Preservationist", "family",
    { hold: 98, renovation: 70, build: 0, quality: 65, prime: 70, discipline: 60 },
    [["neverBuilds", 0.9], ["neverSells", 0.7]], ["landmark"]),
  P("spinout", "Spinout Upstart", "pe",
    { capacity: 30, grudge: 90 }, [], ["feuding"]),
];

export const PROFILE_OF: Record<ProfileId, Profile> =
  Object.fromEntries(PROFILES.map((p) => [p.id, p])) as Record<ProfileId, Profile>;

/** Jitter around a profile's centre: ±JITTER, so two trophy builders still differ. */
const JITTER = 12;
/**
 * WHAT A PROFILE DOES NOT SAY IS PERSONALITY, NOT AVERAGE. A trait the profile
 * leaves unset used to sit at 50 ± 12, so across a town Distress, Reach,
 * Cycle, Underwriting and the temperament all read 40-65 and every firm was
 * the same firm on them. Unset, they are drawn ±40 — two neighbourhood
 * landlords can be a careful one and a reckless one. Class traits keep the
 * narrow band: a generalist stays a generalist.
 */
const WIDE = 40;
const NARROW_UNSET = new Set<TraitKey>(["office", "residential", "retail", "industrial", "land"]);

/**
 * DRAW A FIRM FROM A PROFILE, by hash. `key` is the run seed and the firm id;
 * the same firm in the same town is always the same firm.
 */
export function drawSheet(profile: Profile, key: string, parent?: Sheet): { sheet: Sheet; rules: Rule[]; quirks: Quirk[] } {
  const sheet = {} as Sheet;
  for (const t of TRAITS) {
    const inherited = profile.id === "spinout" && parent && t.key !== "capacity" && t.key !== "grudge";
    const set = inherited || profile.centre[t.key] !== undefined;
    const centre = inherited ? parent![t.key] : profile.centre[t.key] ?? 50;
    const j = (hash01(`${key}:${t.key}`) * 2 - 1) * (set || NARROW_UNSET.has(t.key) ? JITTER : WIDE);
    sheet[t.key] = Math.round(Math.max(1, Math.min(100, centre + j)));
  }
  const rules = profile.rules.filter((r, i) => hash01(`${key}:rule:${i}`) < r.p).map((r) => r.rule).slice(0, 3);
  const quirks: Quirk[] = [];
  const pool = profile.quirks;
  if (pool.length && hash01(`${key}:q0`) < 0.75) quirks.push(pool[Math.floor(hash01(`${key}:q1`) * pool.length)]);
  if (pool.length > 1 && hash01(`${key}:q2`) < 0.3) {
    const q = pool[Math.floor(hash01(`${key}:q3`) * pool.length)];
    if (!quirks.includes(q)) quirks.push(q);
  }
  return { sheet, rules, quirks };
}

/** Profiles that run on each legacy style — the opening roster keeps a firm's style. */
export function profilesForStyle(style: RivalStyle): Profile[] {
  return PROFILES.filter((p) => p.style === style && p.id !== "spinout");
}

/**
 * WHAT A FIRM HAS BECOME. The label is recomputed from the numbers (§4), so a
 * levered developer that got burned can read as a contrarian a decade later.
 * Nearest profile centre by squared distance over the traits that profile
 * defines.
 */
export function nearestProfile(sheet: Sheet): Profile {
  let best = PROFILES[0], bestD = Infinity;
  for (const p of PROFILES) {
    if (p.id === "spinout") continue;
    let d = 0, n = 0;
    for (const [k, v] of Object.entries(p.centre)) { d += (sheet[k as TraitKey] - (v as number)) ** 2; n++; }
    const score = n ? d / n : Infinity;
    if (score < bestD) { bestD = score; best = p; }
  }
  return best;
}

// ---------------------------------------------------------------- site fit

/** What a firm can see about a site when it decides whether it wants it. */
export interface SiteFacts {
  cls: string;
  /** 0 (fringe) .. 1 (the best-located lot in town), off demandScore. */
  loc: number;
  /** Floor area for a building, lot area for dirt. */
  sf: number;
  /** 0 worn .. 1 good; undefined for dirt. */
  grade?: number;
  corner: boolean;
  /** Share of the firm's own book in this district (0..1). */
  districtShare: number;
  /** The firm already owns a lot on this block. */
  ownBlock: boolean;
  /** Distressed listing (receiver, forced sale). */
  distress: boolean;
  /** A landmark the zoning will not let anyone pull down. */
  landmark: boolean;
  /** The firm has nothing on its books yet. */
  emptyBook: boolean;
  /** It is in the firm's home district. */
  home: boolean;
}

/**
 * HOW MUCH THIS FIRM WANTS THIS SITE — a weight on top of the yield and
 * appetite the committee already reads, or 0 for a hard no. Only for firms
 * with a sheet; a firm without one gets 1 and the old behaviour.
 *
 * Every factor is a preference about WHAT and WHERE, never about price: a
 * firm that loves corners still pays what its own discipline allows.
 */
export function siteFit(sheet: Sheet, rules: readonly Rule[] | undefined, quirks: readonly Quirk[] | undefined, f: SiteFacts): number {
  const has = (x: Rule) => !!rules?.includes(x);
  const q = (x: Quirk) => !!quirks?.includes(x);
  const land = f.cls === "land";
  const ct = classTrait(f.cls);
  if (!ct || sheet[ct] < CLASS_FLOOR) return 0;
  // ---- rules: hard filters
  if (has("onlyOffice") && f.cls !== "office") return 0;
  if (has("onlyResidential") && f.cls !== "multifamily") return 0;
  if (has("onlyRetail") && f.cls !== "retail") return 0;
  if (has("onlyIndustrial") && f.cls !== "industrial" && !land) return 0;
  if (has("onlyLand") && !land) return 0;
  if (has("onlyBuilds") && !land) return 0;
  if (has("onlyTrophy") && (f.loc < 0.55 || (!land && (f.grade ?? 0) < 0.5))) return 0;
  if (has("onlyHome") && !f.emptyBook && !f.home && f.districtShare <= 0) return 0;
  if (has("onlyAssembles") && !f.ownBlock && !(land && f.emptyBook)) return 0;
  if (has("neverDistress") && f.distress) return 0;
  // ---- numbers: preferences
  const cls = 0.4 + sheet[ct] / 80;                                   // 0.6 .. 1.65
  const prime = (sheet.prime / 100) * f.loc;
  const edge = (sheet.edge / 100) * (1 - f.loc);
  const where = 0.3 + 1.4 * Math.max(prime, edge);                     // 0.3 .. 1.7
  const turf = Math.max(0.15, 1 + (sheet.homeTurf / 100) * ((f.home || f.districtShare > 0 ? 1.2 : 0) + 2 * f.districtShare - 0.6));
  const target = Math.pow(10, 3.6 + 1.9 * sheet.scale / 100);         // ~4k .. ~300k sf
  const d = Math.log10(Math.max(500, f.sf) / target);
  const scale = 0.35 + 0.65 * Math.exp(-(d * d) / 0.6);
  let quality = 1;
  if (!land && f.grade !== undefined) {
    quality = 1 - 0.6 * Math.abs(f.grade - sheet.quality / 100);
    if (f.grade < 0.5) quality *= 0.6 + 0.8 * sheet.renovation / 100;
  }
  let w = cls * where * turf * scale * quality;
  if (f.ownBlock) w *= 1 + 2.5 * sheet.assembly / 100;
  if (f.ownBlock && has("alwaysOwnBlock")) w *= 2;
  if (f.distress && has("alwaysCourthouse")) w *= 1.5;
  if (f.corner && q("corner")) w *= 1.6;
  if ((f.home || f.districtShare > 0) && q("champion")) w *= 1.3;
  if (q("trophyHunter") && f.loc > 0.8 && (land || (f.grade ?? 0) >= 0.9)) w *= 1.3;
  if (f.landmark && q("landmark")) w *= 1.5;
  return w;
}

/** Condition as a number for `siteFit`. */
export const GRADE_NUM: Record<string, number> = { obsolete: 0, worn: 0.25, standard: 0.6, good: 1 };

/**
 * HOW MANY DEALS A YEAR THE FIRM CAN DIGEST. A small shop closes two; a
 * platform closes eight. Capacity, not money: the cheque is tested elsewhere.
 */
export const dealsPerYear = (sheet: Sheet) => 1 + Math.round(sheet.capacity / 13);

/**
 * THE COMMITTEE'S ERROR, in yield points, from its underwriting. A sharp
 * shop reads within a tenth of a point; a sloppy one is up to ±1.5 points
 * wrong, in a direction fixed for that firm, that building and that month —
 * so it is wrong consistently, the way a bad model is.
 */
export const misreadPp = (sheet: Sheet, key: string) =>
  (hash01(key) * 2 - 1) * 1.5 * (1 - sheet.underwriting / 100);

/**
 * THE FIRM IN WORDS — its most defining traits and its rules. Used where a
 * sentence is wanted rather than a table: the Jev question state, the card's
 * one-line read. `n` traits, furthest from the middle first.
 */
export function describeSheet(sheet: Sheet, rules: readonly Rule[] = [], n = 4, skip: ReadonlySet<TraitKey> = new Set()): string {
  const top = TRAITS
    .filter((t) => !t.hidden && !skip.has(t.key))
    .map((t) => ({ t, d: sheet[t.key] - 50 }))
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
    .slice(0, n)
    .map(({ t, d }) => (d >= 0 ? t.hi : t.lo));
  const r = rules.map((x) => RULE_LABEL[x]);
  return [...top, ...r].join("; ");
}
