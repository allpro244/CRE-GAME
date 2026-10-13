// What a plate can physically carry. Its own module so the parcel loader
// (mix.ts) and the pro forma (value.ts) read one definition without importing
// each other. See "THE PLATE IS THE BUILDING" in value.ts.
//
// Ninety floors is the engineering and market ceiling of this model, not a
// rule: a supertall needs a plate and a market no town on these maps has.
export const ABS_MAX_FLOORS_V = 90;
/**
 * SLENDERNESS IS MEASURED ACROSS THE NARROW SIDE (2026-10-12). A tower's
 * height is limited by its width the wind and the core have to work across:
 * ordinary towers top out around 1:8-1:10, and the slender end of practice
 * (Hong Kong and Manhattan residential towers) runs about 1:12. The
 * super-slender towers of 57th Street (1:15-1:24) are extraordinary engineering
 * at extraordinary cost, not a market product. This used to assume every plate
 * was square, so a long, narrow lot read as a wide one and carried a pencil
 * tower.
 */
const MAX_SLENDERNESS = 12;
const FLOOR_HEIGHT_FT = 12.5;
/** The plate's narrow dimension in feet, from the lot's proportions. */
export function plateNarrowFt(plateSf: number, rec?: { lotFront?: number; lotDepth?: number }): number {
  const f = rec?.lotFront ?? 0, d = rec?.lotDepth ?? 0;
  const aspect = f > 0 && d > 0 ? Math.max(f, d) / Math.min(f, d) : 1;
  return Math.sqrt(Math.max(0, plateSf) / aspect);
}
/** The tallest structure a plate this size can carry: slenderness, and core. */
export function physicalMaxFloors(plateSf: number, rec?: { lotFront?: number; lotDepth?: number }): number {
  if (plateSf < 400) return 1;                       // below this it is not a building
  const slender = (MAX_SLENDERNESS / FLOOR_HEIGHT_FT) * plateNarrowFt(plateSf, rec);
  // The core ramp: a 1,200 ft² plate carries about six floors, and the ability
  // to serve height grows roughly linearly with the area left over after the
  // core takes its fixed bite.
  const core = 1 + (plateSf - 400) / 135;
  return Math.max(1, Math.min(ABS_MAX_FLOORS_V, Math.floor(Math.min(slender, core))));
}
