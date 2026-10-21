// Mixed-use is NOT here on purpose. It is not a market — there is no
// mixed-use cap rate and no mixed-use tenant. A building that is part shops,
// part offices and part apartments carries a `mix` and is described by it.
// See engine/mix.ts.
export type AssetClass = "office" | "retail" | "multifamily" | "industrial" | "land";

export interface ParcelRecord {
  bbl: string;
  address: string;
  borough: string;
  block: string;
  lot: string;
  zoneDist: string;
  farMaxComm: number;
  farMaxRes: number;
  bldgClass: string;
  district: string;     // the neighbourhood — the unit of a submarket (a KEY: `thechange`)
  districtName?: string;  // what it is called on the map (`The Change`); absent on old saves
  class: AssetClass;              // the dominant use; the mix has the rest
  mix?: Partial<Record<Exclude<AssetClass, "land">, number>>;  // shares of floor area by use
  /**
   * HOW THE BUILDING IS CUT UP, in square feet per leasable space.
   *
   * Absent for everything the generator produced — those fall back to the
   * class defaults in plates.typicalSuiteSf, which is what a building of that
   * size and use is normally demised into. It is present on buildings YOU
   * developed, because deciding whether a 200,000 sf tower is eight big floors
   * or ninety small suites is a real programming decision with real
   * consequences: small suites lease faster and cost far more to fit out and
   * to manage, big ones sit empty longer and never turn.
   */
  suites?: Partial<Record<Exclude<AssetClass, "land">, number>>;
  lotArea: number;      // sf
  bldgArea: number;     // sf
  /**
   * Stamped by `resolveRec`, never stored: the block's cornice datum (the
   * tallest distance-weighted comparable, floors) and the town's maturity
   * (0..1) as of the state the record was resolved against — the two
   * state-dependent inputs of the one height rule (`heightCapFloors`), so the
   * land residual can read it. Absent on a record nobody resolved.
   */
  cornice?: number;
  maturity?: number;
  floors: number;
  yearBuilt: number;
  unitsRes: number;
  assessedLand: number;
  assessedTotal: number;
  /**
   * HOW WELL THIS BUILDING WAS BUILT, 0..1, with 0.5 as ordinary market
   * standard. Set when the player or the street breaks ground. A gut
   * renovation steps it toward (not to) modern — that is the re-clad and
   * re-plant. yearBuilt is the thing a renovation cannot reach: floor-to-floor,
   * the core, the slab. Read by `condCeiling`. QUALITY_BALANCE_PLAN.md §1.
   */
  buildSpec?: number;
  demandScore: number;  // 0–100
  /** Hedonic multiplier from waterfront / corridor / corner (mean 1). Appraisal only. */
  locPremium?: number;
  shoreM?: number;
  corridorM?: number;
  corner?: boolean;
  /**
   * Street frontage of the lot and the depth behind it, in feet (PLUTO's
   * LotFront / LotDepth). Frontage is the longest run of lot line on one
   * street; depth is area over that. Absent on towns cut before street plan 4
   * had them measured, and on lots with no street line at all.
   */
  lotFront?: number;
  lotDepth?: number;
  landPsf: number;      // $/sf of land, engine-evolved in later phases
  landPsfHistory: number[];
  imputed: string[];
  centroid: [number, number];
  /**
   * NOT IN THE COMMERCIAL MARKET (the region map, Phase 1). Absent on every
   * parcel the engine holds — and that is the rule, not a convention: a
   * parcel with a tenure lives in the city's `reserved` table, never in the
   * parcel table the engine is handed, so no listing, rival bid, teardown,
   * street roll, city growth or land valuation can reach it. See
   * citygen/region/index.mjs.
   */
  tenure?: Tenure;
  /**
   * A FARM OR WOODLOT TRACT (the region map): farmed land with a farm-use value
   * of its own (value.ts farmUsePsf), "crop" or "wood". Kept through a
   * rezoning; a farm stays a farm until it is platted.
   */
  ag?: "crop" | "wood";
  /**
   * The survey tract under a farm (region map, canonical metres) and what it
   * takes to cut it into lots (citygen/region platTractLots). Absent where the
   * tract cannot be platted whole (the unbuilt remainder of a subdivision).
   */
  tract?: { seed: number; r: [number, number, number, number]; id: number; bearing: number | null; edgeM: number };
}

export type ParcelTable = Record<string, ParcelRecord>;

/**
 * Who holds land the commercial market does not reach in Phase 1 of the region:
 * "homes" — households (a neighbourhood parcel, or a rural home on its acre);
 * "farm" — a farm or woodlot tract, agricultural and unbuildable until Phase 2;
 * "civic" — a church, a school.
 */
export type Tenure = "homes" | "farm" | "civic";

/** A reserved parcel: drawn, labelled and clickable, with its numbers; never traded in Phase 1. */
export interface ReservedParcel {
  bbl: string;
  address: string;
  tenure: Tenure;
  class: AssetClass;
  zoneDist: string;
  district: string;
  districtName?: string;
  lotArea: number;      // sf
  bldgArea: number;     // sf
  floors: number;
  yearBuilt: number;
  centroid: [number, number];
  kind: "neighbourhood" | "rural" | "civic" | "farm" | "woodlot";
  name?: string;
  /** a neighbourhood or a rural home: how many houses stand on it */
  homes?: number;
  era?: "prewar" | "postwar" | "recent";
  eraYears?: [number, number];
  avgHouseSf?: number;
  avgLotSf?: number;
  /** how many lots the subdivision's plat holds, built or not */
  platLots?: number;
  leapfrog?: boolean;
  /**
   * THE RECIPE that redraws a neighbourhood lot for lot (citygen/region/plats.mjs
   * platFor): a later phase unpacks the parcel into individual deeds from
   * exactly these lots, `built` (a base64url bitset over the plat's lots) naming
   * the ones standing.
   */
  recipe?: { gen: string; seed: number; tract: [number, number, number, number]; era: string; id: number; bearing: number | null; waterNear?: [number, number]; scale?: number; built: string };
  acres?: number;
  floodShare?: number;
  wood?: boolean;
  crop?: string | null;
}
export type Adjacency = Record<string, string[]>;

export interface DataManifest {
  source: "nyc-open-data" | "synthetic" | "fictional";
  district: string;
  city?: string;
  /** district key -> display name, from the generator */
  districts?: Record<string, string>;
  lots: number;
  adjacencyEdges: number;
}

export const CLASS_LABEL: Record<AssetClass, string> = {
  office: "Office",
  retail: "Retail",
  multifamily: "Multifamily",
  industrial: "Industrial",
  land: "Vacant Land",
};

export const CLASS_COLOR: Record<AssetClass, string> = {
  office: "#7f95ad",
  retail: "#c08552",
  multifamily: "#8aab8a",
  industrial: "#8f8f7a",
  land: "#b5a67f",
};
