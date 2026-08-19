/**
 * One extruded mass of one building. A stacked building is several of these
 * sharing a BBL — a wedding cake is four, a courtyard block is four wings.
 *
 * Its own file so that the style tables, which are pure data and pure choice,
 * can be imported by a Node probe without dragging in three.js and MapLibre.
 */
export interface BuildingVolume {
  b: string;   // bbl ("" for decorative props like ships and cranes)
  c: string;   // asset class
  y: number;   // year built
  t: number;   // district tone family 0-4 — the SAME derivation the ground's
               //   `dt` uses (FNV of the district name), so a building's
               //   masonry family agrees with the pavement it stands on. It
               //   was lotNo % 5, which striped 1,2,3,4,0 down every block
               //   face and gave the city its candy-quilt roofs.
  f: number;   // floors (whole building)
  z0: number;  // base meters
  z1: number;  // top meters
  d: number;   // 1 = decorative
  k?: number;  // 1 = vacant lot (dress with gravel + fence)
  ds?: number; // demand 0-100, vacant-lot character (downtown vs fringe)
  zn?: number; // vacant lots only — zoning first letter, so a bare lot is
               //   dressed by what it is zoned for: 1 = R (grass, hedge),
               //   2 = M (scrub, broken fence), absent = commercial (gravel).
  x?: number;  // 1 = this volume is the ROOF of its building, not a setback
               //     terrace under it. Bulkheads, masts and stepped crowns
               //     go here and nowhere else.
  dk?: string; // decorative kind: hull0-2, super, funnel, box0-2, crane, shed, light, boat, mast...
  r: [number, number][]; // footprint ring, lon/lat
}
