// THE PATTERN BOOK'S LATER PAGES. The first forty-odd facade families live in
// facades.ts and were wired into every table by hand. Everything after them is
// one record here, and register.ts does the wiring: the texture spec and its
// three other elevations, the tints, the paint palette, the style, what the
// Build desk calls it and which shelf it sits on, and where in the generated
// city it stands (as a cousin of an original family — see COUSINS).
import type { ArchStyle, FamilySpec, Palette } from "../facades";

/** The Build desk's shelves, in the order the chips show. */
export const FACADE_GROUPS = [
  { key: "street", name: "Row house & walk-up" },
  { key: "ornament", name: "Pre-war ornament" },
  { key: "regional", name: "Regional & revival" },
  { key: "civic", name: "Civic & collegiate" },
  { key: "works", name: "Industrial" },
  { key: "postwar", name: "Post-war" },
  { key: "glass", name: "Glass" },
  { key: "new", name: "Contemporary" },
] as const;
export type FacadeGroup = (typeof FACADE_GROUPS)[number]["key"];

export interface BookEntry {
  /** unique, lowercase, no "#" — the family id saves and the renderer use */
  key: string;
  /**
   * The original family this one behaves like everywhere a rule was written
   * against the originals: tower massing, crowns, shop fronts, pitched roofs,
   * roof tone, quoins, bays, the paint palette when none is given. Must be a
   * key of facades.ts FAMILY_SPECS (not another book entry).
   */
  like: string;
  /** the texture: everything FamilySpec has but the key */
  spec: Omit<FamilySpec, "key">;
  /** exactly three more elevations, drawn as `${key}#1..#3` */
  variants: [Partial<FamilySpec>, Partial<FamilySpec>, Partial<FamilySpec>];
  /** per-building tints of the wall texture, [1,1,1] first */
  tints: [number, number, number][];
  /** the owners' paint schemes; absent = the `like` family's; null = never repainted */
  palette?: Palette | null;
  /** never a pitched roof, whatever its `like` family wears (adobe, Territorial) */
  flatRoof?: boolean;
  /** the building's architectural style, when it is not simply its `like` family's */
  style?: ArchStyle | ((year: number, h: number) => ArchStyle);
  /** what the Build desk shows */
  picker: {
    group: FacadeGroup;
    name: string;
    /** "1905-1930", "timber, to 1950", "2015-today" */
    era: string;
    /** the tallest building this skin was really put on, in floors (99 = any) */
    maxFloors: number;
    /** names of the four elevations: the base, then variants #1-#3 */
    variants: [string, string, string, string];
  };
  /**
   * Where the generated city puts it: a share of a parent family's draws
   * (parent defaults to `like`) for buildings of these years and heights (m).
   * Shares of one parent's cousins are summed, so keep each modest (0.05-0.2).
   */
  city: { parent?: string; share: number; from: number; to?: number; minH?: number; maxH?: number; cls?: ("office" | "multifamily" | "retail" | "industrial")[] }[];
}
