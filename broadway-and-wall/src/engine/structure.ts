// What a plate can physically carry. Its own module so the parcel loader
// (mix.ts) and the pro forma (value.ts) read one definition without importing
// each other. See "THE PLATE IS THE BUILDING" in value.ts.
//
// Ninety floors is the engineering and market ceiling of this model, not a
// rule: a supertall needs a plate and a market no town on these maps has.
export const ABS_MAX_FLOORS_V = 90;
/** The tallest structure a plate this size can carry: slenderness, and core. */
export function physicalMaxFloors(plateSf: number): number {
  if (plateSf < 400) return 1;                       // below this it is not a building
  const slender = 1.2 * Math.sqrt(plateSf);          // MAX_SLENDERNESS / FLOOR_HEIGHT_FT
  // The core ramp: a 1,200 ft² plate carries about six floors, and the ability
  // to serve height grows roughly linearly with the area left over after the
  // core takes its fixed bite.
  const core = 1 + (plateSf - 400) / 135;
  return Math.max(1, Math.min(ABS_MAX_FLOORS_V, Math.floor(Math.min(slender, core))));
}
