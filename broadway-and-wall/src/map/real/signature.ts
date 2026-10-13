/**
 * SIGNATURE TOWERS — the skyline's landmarks.
 *
 * Most towers in town draw a massing from their period's ordinary repertoire
 * (RealCity.massing: slab, podium, tiers, taper, twins...). A city's skyline
 * is not read from those, though: it is read from the handful of towers that
 * are a SHAPE — the bullet, the pyramid, the needle on a Y, the twin spires
 * with a bridge between them. This file is the catalogue of those shapes and
 * the plan geometry they are built from; RealCity.signatureTower builds them.
 *
 * Each form is a real archetype and carries the year its kind first went up,
 * so a 1931 tower is never a diagrid bullet: the generated stock only draws
 * the forms its own year allows, a rival's new tower the forms of the year it
 * delivers, and the Build desk offers a form from the year it was first built.
 * Every form is UNIQUE in a city (a second bullet is not a landmark), except
 * where the player asks for one by name.
 *
 * Looks only. Nothing here is read by the engine; nothing priced reads it.
 */

import type { P2 } from "./signature-plans";
import { MORE_FORMS_A } from "./signature-more-a";
import { MORE_FORMS_B } from "./signature-more-b";
export * from "./signature-plans";

export type BaseSignatureKey =
  | "cathedral" | "sunburst" | "obelisk" | "pyramid" | "halo" | "telescope" | "prisms" | "crystal" | "gate"
  | "petronas" | "needle" | "bullet" | "torso" | "shard" | "helix" | "walkie" | "jenga" | "pencil";

/** A form's key: one of the originals, or a later form's (signature-more-*.ts). */
export type SignatureKey = BaseSignatureKey | (string & {});

export interface SignatureForm {
  key: SignatureKey;
  name: string;
  /** one line for the picker */
  blurb: string;
  /** the year the first of its kind went up (the generated stock and the desk both respect it) */
  from: number;
  /** and the year the type stopped being built, where it did */
  until?: number;
  /** below this many floors the form does not read as itself */
  minFloors: number;
  /** needs a long footprint (twin towers, a gateway): long side at least this many times the short */
  long?: number;
  /** the facade families it is clad in, by preference; the building's own family wins if it is one of them */
  fams: string[];
}

/** One floor, as the engine counts one (FLOOR_M). Used only to turn floors into metres for eligibility. */
const FLOOR = 3.6;

export const SIGNATURE_FORMS: SignatureForm[] = [
  { key: "cathedral", name: "Gothic cathedral", blurb: "A terra-cotta shaft of pinnacles under a steep copper pyramid", from: 1905, until: 1935, minFloors: 25, fams: ["terracotta", "stone"] },
  { key: "sunburst", name: "Deco spire", blurb: "Setbacks, a crown of stacked rings and pinnacles, a steel needle", from: 1926, until: 1948, minFloors: 30, fams: ["deco", "decobrick", "stone"] },
  { key: "obelisk", name: "Obelisk", blurb: "A tapering square shaft ending in a pyramidion", from: 1925, minFloors: 25, fams: ["stone", "pomo", "blackglass", "deco"] },
  { key: "pyramid", name: "Pyramid", blurb: "Four faces leaning in to a point, a beacon on top", from: 1970, minFloors: 25, fams: ["precast", "silverglass", "glass"] },
  { key: "halo", name: "Halo crown", blurb: "A glass drum ringed by a crown of blades", from: 1975, minFloors: 25, fams: ["blueglass", "greenglass", "glass", "silverglass"] },
  { key: "telescope", name: "Telescope", blurb: "Elliptical tiers that step in like a lipstick case", from: 1982, minFloors: 22, fams: ["pomo", "stone", "bronze"] },
  { key: "prisms", name: "Prisms", blurb: "A square split into four triangular shafts of different heights, each topped by a slope", from: 1985, minFloors: 30, fams: ["silverglass", "glass", "blueglass"] },
  { key: "crystal", name: "Crystal", blurb: "A faceted hexagon whose corners turn as it rises, ending in a sloped crystal", from: 1985, minFloors: 25, fams: ["silverglass", "blueglass", "glass"] },
  { key: "gate", name: "Gateway", blurb: "Two slabs joined across the top by a sky-lobby bridge", from: 1988, minFloors: 25, long: 1.45, fams: ["glass", "blueglass", "silverglass", "precast"] },
  { key: "petronas", name: "Twin spires", blurb: "Two star-plan towers stepping to pinnacles, a skybridge between", from: 1993, minFloors: 35, long: 1.5, fams: ["silverglass", "glass", "fins"] },
  { key: "needle", name: "Needle", blurb: "A Y-plan tower whose wings step back in a spiral to a spire", from: 2000, minFloors: 40, fams: ["silverglass", "glass", "blueglass"] },
  { key: "bullet", name: "Bullet", blurb: "A round diagrid tower that swells, then closes to a dome", from: 2000, minFloors: 28, fams: ["diagrid", "greenglass", "blueglass"] },
  { key: "torso", name: "Turning stack", blurb: "Stacked blocks, each turned on the one below, a quarter-turn top to bottom", from: 2002, minFloors: 30, fams: ["silverglass", "precast", "glass"] },
  { key: "shard", name: "Shard", blurb: "Glass facets leaning in at different rates, splintering open at the top", from: 2005, minFloors: 35, fams: ["silverglass", "glass", "blueglass"] },
  { key: "helix", name: "Helix", blurb: "A rounded triangle that twists a third of a turn and tapers as it rises", from: 2005, minFloors: 40, fams: ["blueglass", "glass", "silverglass"] },
  { key: "walkie", name: "Flared top", blurb: "Faces that lean out as it rises, a sky garden on the roof", from: 2008, minFloors: 28, fams: ["glass", "greenglass", "silverglass"] },
  { key: "jenga", name: "Stacked boxes", blurb: "Glass boxes cantilevered off one another, no two floors alike", from: 2010, minFloors: 30, fams: ["pixel", "glass", "silverglass"] },
  { key: "pencil", name: "Pencil", blurb: "A slender supertall square, open plant floors every dozen storeys", from: 2012, minFloors: 50, fams: ["grid", "precast", "blackglass"] },
];

/**
 * WHAT A LATER FORM IS BUILT WITH. RealCity.signatureTower measures the lot
 * and hands a form this kit; the form describes itself in it, in the local
 * frame (u along the long side, v across, metres, z up from the street), and
 * the tower is checked to stand inside its lot and drawn. A form that does
 * not fit simply adds nothing it cannot hold: the kit is retried smaller.
 */
export interface FormKit {
  /** half-extents of the lot along u (the long way) and v; R: the circle it holds about its centre */
  A: number; B: number; R: number; sq: number;
  /** the tower's height and a podium/lobby height; fh: the cladding's floor height */
  H: number; zL: number; fh: number;
  /** -1 or 1, fixed per deed: which way a form turns */
  turnDir: number;
  /** the facade family the form is clad in */
  fam: string;
  /** a stable 0..1 draw per deed: pass any salt */
  h: (salt: number) => number;
  /** an extruded prism of plan r from z0 to z1; crown: cornice/plant on its top; plant: roof kit on it */
  vol: (r: P2[], z0: number, z1: number, crown?: boolean, plant?: boolean, fam?: string) => void;
  /** a skin through sections (every ring the same point count, counter-clockwise); cap: roof on the last; col: plain metal instead of cladding */
  loft: (secs: { r: P2[]; z: number }[], cap?: boolean, fam?: string, col?: number[]) => void;
  /** a skybridge or soffit slab: a skin through two rings with a ceiling under the first */
  bridge: (r: P2[], z0: number, z1: number) => void;
  /** a prop from the instance kit: "pinnacle", "fin" (sz = height/scale), "mast", "crownpier", "column", "helipad", "dish", "spire" */
  inst: (kind: string, u: number, v: number, z: number, s: number, r?: number, sz?: number, col?: number[]) => void;
  /** a mast of len metres */
  mast: (z: number, len: number, s?: number, u?: number, v?: number) => void;
  /** a tapering n-sided spire from radius r0 at z0 to a point at z1 */
  spire: (z0: number, z1: number, r0: number, n?: number, col?: number[], u?: number, v?: number) => void;
  /** metal colours for loft/spire col: stainless, verdigris copper, gilt, bronze, white-painted steel */
  STEEL: number[]; COPPER: number[]; GOLD: number[]; BRONZE: number[]; WHITE: number[];
}
export interface MoreForm { form: SignatureForm; build: (k: FormKit) => void }

/** The later forms, by key, for RealCity.signatureTower. */
export const MORE_FORMS = new Map<string, MoreForm>();
for (const m of [...MORE_FORMS_A, ...MORE_FORMS_B]) {
  if (SIGNATURE_FORMS.some((f) => f.key === m.form.key)) throw new Error(`signature form ${m.form.key}: duplicate key`);
  SIGNATURE_FORMS.push(m.form);
  MORE_FORMS.set(m.form.key, m);
}

export const SIGNATURE_BY_KEY = new Map(SIGNATURE_FORMS.map((f) => [f.key, f]));

/** Below this many floors the Build desk offers no signature forms at all. */
export const SIGNATURE_MIN_FLOORS = Math.min(...SIGNATURE_FORMS.map((f) => f.minFloors));

/**
 * A tower of the generated stock or a rival's undesigned tower is a landmark
 * candidate from this height. Calibrated against the generated towns (seeds
 * 1 and 7): 0 such towers in a Young town, 7-8 in Established, 25-45 in a
 * Capital or Metropolis — so a landmark is the tall end of a real skyline and
 * the young town grows its first ones as it is built up.
 */
export const SIGNATURE_MIN_H = 90;

/** Was the form being built in this year? */
export function formInEra(f: SignatureForm, year: number) {
  return year >= f.from && (f.until === undefined || year <= f.until);
}

/** Does a building of this many metres read as the form? */
export function formFits(f: SignatureForm, heightM: number) {
  return heightM >= f.minFloors * FLOOR;
}

