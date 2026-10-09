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

type P2 = [number, number];

export type SignatureKey =
  | "cathedral" | "sunburst" | "obelisk" | "pyramid" | "halo" | "telescope" | "prisms" | "crystal" | "gate"
  | "petronas" | "needle" | "bullet" | "torso" | "shard" | "helix" | "walkie" | "jenga" | "pencil"
  | "flatiron" | "dome" | "setbackslab" | "cruciform" | "fluted" | "bundled" | "stilts" | "pediment" | "lattice"
  | "lean" | "sail" | "hourglass";

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
  { key: "flatiron", name: "Flatiron", blurb: "A triangular block with a rounded prow, filling a wedge of the street plan", from: 1902, until: 1935, minFloors: 18, fams: ["terracotta", "stone", "buff"] },
  { key: "dome", name: "Domed tower", blurb: "A Beaux-Arts shaft on a full-lot base, ending in a drum, a copper dome and a lantern", from: 1908, until: 1932, minFloors: 25, fams: ["stone", "terracotta"] },
  { key: "setbackslab", name: "Setback slab", blurb: "A thin limestone slab that steps in only at its narrow ends", from: 1931, until: 1955, minFloors: 35, long: 1.6, fams: ["deco", "decobrick", "stone"] },
  { key: "cruciform", name: "Cruciform", blurb: "A glass cross in plan, every office near a window", from: 1958, minFloors: 25, fams: ["ribbon", "grid", "blackglass", "glass", "silverglass"] },
  { key: "fluted", name: "Fluted column", blurb: "A round tower scalloped into flutes like a classical column", from: 1972, minFloors: 25, fams: ["precast", "stone", "silverglass"] },
  { key: "bundled", name: "Bundled tubes", blurb: "Nine square tubes bundled together, dropping off at different heights", from: 1974, minFloors: 40, fams: ["blackglass", "bronze", "glass"] },
  { key: "stilts", name: "Stilts and wedge", blurb: "A tower lifted on four giant columns over a plaza, its roof sliced at a slope", from: 1977, minFloors: 35, fams: ["silverglass", "precast", "glass"] },
  { key: "pediment", name: "Broken pediment", blurb: "A granite slab topped by a split gable, postmodernism's grandfather clock", from: 1984, minFloors: 25, fams: ["pomo", "stone"] },
  { key: "lattice", name: "Gilded lattice", blurb: "A chamfered shaft crowned by a gold pyramid and a needle", from: 1990, minFloors: 35, fams: ["pomo", "stone", "bronze"] },
  { key: "lean", name: "Leaning tower", blurb: "A shaft that leans out over its base, held by its core", from: 1996, minFloors: 25, fams: ["glass", "blueglass", "silverglass"] },
  { key: "sail", name: "Sail", blurb: "A curved glass sail leaning back to a single spine", from: 1999, minFloors: 30, fams: ["silverglass", "precast", "glass"] },
  { key: "hourglass", name: "Hourglass", blurb: "A round diagrid that pinches at the waist and twists as it rises", from: 2008, minFloors: 30, fams: ["diagrid", "glass", "blueglass"] },
  { key: "pencil", name: "Pencil", blurb: "A slender supertall square, open plant floors every dozen storeys", from: 2012, minFloors: 50, fams: ["grid", "precast", "blackglass"] },
];

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

// ---- plans, in a local frame: u along the footprint's long side, v across ----

/** An ellipse of n points, counter-clockwise. */
export function ellipse(n: number, a: number, b: number, rot = 0): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < n; i++) { const t = rot + (i / n) * Math.PI * 2; out.push([Math.cos(t) * a, Math.sin(t) * b]); }
  return out;
}

/** An axis-aligned rectangle of half-extents a, b centred on (u, v), counter-clockwise. */
export function rect(a: number, b: number, u = 0, v = 0): P2[] {
  return [[u - a, v - b], [u + a, v - b], [u + a, v + b], [u - a, v + b]];
}

/** A square with its corners cut at 45° by c (an octagon), counter-clockwise. */
export function chamfered(a: number, b: number, c: number): P2[] {
  c = Math.min(c, a * 0.9, b * 0.9);
  return [[-a + c, -b], [a - c, -b], [a, -b + c], [a, b - c], [a - c, b], [-a + c, b], [-a, b - c], [-a, -b + c]];
}

/**
 * The eight-pointed star of two squares turned 45° on each other, with the
 * notches filled by arcs — the plan of the 1990s twin towers of the east.
 * 32 points; r is the outer radius.
 */
export function star8(r: number): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < 32; i++) {
    const t = (i / 32) * Math.PI * 2;
    // points at every 45°, a shallow arc between them
    const ph = ((t / (Math.PI / 4)) % 1 + 1) % 1;
    const k = i % 4 === 0 ? 1 : 0.86 + 0.06 * Math.cos((ph - 0.5) * Math.PI * 2);
    out.push([Math.cos(t) * r * k, Math.sin(t) * r * k]);
  }
  return out;
}

/** A rounded triangle (three lobes), radius r at the lobes, n points. */
export function roundTri(n: number, r: number, rot = 0): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const k = 0.84 + 0.16 * Math.cos(3 * t);
    out.push([Math.cos(t + rot) * r * k, Math.sin(t + rot) * r * k]);
  }
  return out;
}

/**
 * THE Y PLAN. Three wings of half-width w at 120° round a core, each wing
 * reaching its own length: the plan the buttressed-core supertall is built
 * on, because a Y braces itself against the wind from every side. Nine
 * points, counter-clockwise; each wing must reach past the core's notch.
 */
export function yPlan(w: number, len: [number, number, number], rot = Math.PI / 2): P2[] {
  const out: P2[] = [];
  const notch = w / Math.sin(Math.PI / 3);
  for (let j = 0; j < 3; j++) {
    const t = rot + (j * 2 * Math.PI) / 3;
    const dx = Math.cos(t), dy = Math.sin(t), px = -dy, py = dx;
    const nt = t - Math.PI / 3;
    out.push([Math.cos(nt) * notch, Math.sin(nt) * notch]);
    const L = Math.max(len[j], notch + w * 0.6);
    out.push([dx * L - px * w, dy * L - py * w]);
    out.push([dx * L + px * w, dy * L + py * w]);
  }
  return out;
}

/** Turn and scale a local plan about its origin. */
export function turn(r: P2[], a: number, s = 1, du = 0, dv = 0): P2[] {
  const c = Math.cos(a), si = Math.sin(a);
  return r.map(([u, v]) => [du + (u * c - v * si) * s, dv + (u * si + v * c) * s] as P2);
}
