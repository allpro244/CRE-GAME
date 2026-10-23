// BUILDING FORMS A PLAYER CAN CHOOSE (FORMS_PLAN.md). The game begins in 2000,
// under the 1961 Zoning Resolution and its 1987 contextual districts, so these
// are the forms that law lets a developer build: the street wall, the
// contextual base and setback, the sky-exposure-plane setbacks (the modern
// wedding cake), the courtyard and the U, the tower on a base or a podium,
// paired towers. Each is one of the city generator's own families
// (massing.mjs), so a player's building and the city's are drawn by one hand,
// and each refuses a lot it does not fit (massingStack returns null), which is
// what makes "which forms fit this lot" a real question with a real answer.
//
// The desk solves the form on the actual lot, and the same tiers give the two
// numbers the pro forma reads (one geometry, one answer):
//   retained  floor area kept against the plain extrusion at the same height
//             (a courtyard gives up its court, a setback its terraces)
//   skin      facade area per unit of floor area against the extrusion's (a
//             court or a setback adds wall; the exterior closure is about 15%
//             of a building's hard cost, RSMeans' closure share, so more wall
//             costs in proportion)
import { massingStack } from "./massing.mjs";
import { polygonArea } from "./geom.mjs";

export const PLAYER_FORMS = [
  { key: "base", family: "base", name: "Tower on a base", blurb: "a full-lot base with a slimmer tower set back above it", minFloors: 10 },
  { key: "step", family: "step", name: "Contextual setback", blurb: "a street wall to the cornice line, the upper floors set back behind it", minFloors: 7 },
  { key: "cake", family: "cake", name: "Setbacks (wedding cake)", blurb: "steps back as it rises under the sky exposure plane; terraces on every step", minFloors: 10 },
  { key: "terrace", family: "terrace", name: "Penthouse terraces", blurb: "the top floors pulled in for terraced penthouses", minFloors: 7 },
  { key: "courtyard", family: "courtyard", name: "Courtyard", blurb: "wings round a garden court: light for every flat, less floor area", minFloors: 3 },
  { key: "lightcourt", family: "lightcourt", name: "U-plan (light court)", blurb: "a court open to the rear: every room on a window", minFloors: 4 },
  { key: "podium", family: "podium", name: "Podium and tower", blurb: "a retail podium to the lot line, a tower above it", minFloors: 15 },
  { key: "retail base", family: "retail base", name: "Retail base", blurb: "shops fill the lot at grade; the building above keeps its yard", minFloors: 4 },
  { key: "endtowers", family: "endtowers", name: "End towers", blurb: "a lower middle between two towers at the ends", minFloors: 8 },
  { key: "twins", family: "twins", name: "Twin towers", blurb: "two towers on a common base: the Central Park West type", minFloors: 20 },
  { key: "notch", family: "notch", name: "Notched slab", blurb: "a slab with its corners notched for more corner rooms", minFloors: 10 },
  { key: "telescope", family: "telescope", name: "Telescoping slab", blurb: "the plate steps in where the lift banks end", minFloors: 20 },
];

/** A stable [0,1) draw for a lot (the form's proportions), so the desk and the city solve the same building. */
function hashU(bbl, k) {
  let h = 2166136261 ^ k;
  for (let i = 0; i < bbl.length; i++) { h ^= bbl.charCodeAt(i); h = Math.imul(h, 16777619); }
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/**
 * The tiers of `form` on a lot (rings in metres, open), or null where it does
 * not fit. `footprint` is the building's ground footprint (the lot scaled by
 * coverage), `lotRing` the deed, `hM` the height.
 */
export function formTiers({ bbl, footprint, lotRing, hM, year, klass, form }) {
  const f = PLAYER_FORMS.find((x) => x.key === form);
  if (!f || !footprint || footprint.length < 3) return null;
  const r = massingStack({ ring: footprint, lotRing, hM, year, klass, u: (k) => hashU(bbl, k), families: [f.family] });
  return r && r.tiers.length >= 2 ? r.tiers : null;
}

const perimeter = (ring) => ring.reduce((s, p, i) => s + Math.hypot(ring[(i + 1) % ring.length][0] - p[0], ring[(i + 1) % ring.length][1] - p[1]), 0);

/** Floor area kept and facade per floor area, each against the plain extrusion of `footprint` to `hM`. */
export function formMetrics(footprint, tiers, hM) {
  const a0 = Math.abs(polygonArea([footprint]));
  const vol0 = a0 * hM, wall0 = perimeter(footprint) * hM;
  let vol = 0, wall = 0;
  for (const t of tiers) {
    const a = Math.abs(polygonArea([t.ring]));
    vol += a * (t.top - t.base);
    wall += perimeter(t.ring) * (t.top - t.base);
  }
  // wall per unit volume, as a ratio of the extrusion's
  return { retained: vol0 > 0 ? vol / vol0 : 1, skin: vol > 0 && wall0 > 0 ? (wall / vol) / (wall0 / vol0) : 1 };
}

/** The forms that fit this lot, with their measured numbers. */
export function formsFor({ bbl, footprint, lotRing, hM, year, klass, floors }) {
  const out = [];
  for (const f of PLAYER_FORMS) {
    if (floors < f.minFloors) continue;
    const tiers = formTiers({ bbl, footprint, lotRing, hM, year, klass, form: f.key });
    if (!tiers) continue;
    out.push({ ...f, tiers, ...formMetrics(footprint, tiers, hM) });
  }
  return out;
}
