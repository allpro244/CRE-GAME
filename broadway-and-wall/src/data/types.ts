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
  class: AssetClass;              // the dominant use; the mix has the rest
  mix?: Partial<Record<Exclude<AssetClass, "land">, number>>;  // shares of floor area by use
  lotArea: number;      // sf
  bldgArea: number;     // sf
  floors: number;
  yearBuilt: number;
  unitsRes: number;
  assessedLand: number;
  assessedTotal: number;
  demandScore: number;  // 0–100
  landPsf: number;      // $/sf of land, engine-evolved in later phases
  landPsfHistory: number[];
  imputed: string[];
  centroid: [number, number];
}

export type ParcelTable = Record<string, ParcelRecord>;
export type Adjacency = Record<string, string[]>;

export interface DataManifest {
  source: "nyc-open-data" | "synthetic" | "fictional";
  district: string;
  city?: string;
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
