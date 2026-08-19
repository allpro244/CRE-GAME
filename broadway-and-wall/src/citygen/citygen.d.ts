// The generator is plain .mjs, shared verbatim between the build pipeline and
// the browser — one copy, so a city built by `pnpm cities` and a city built on
// page load are the same city. These are the shapes the app cares about.
declare module "@/citygen/index.mjs" {
  import type { Adjacency, DataManifest, ParcelTable } from "@/data/types";

  export interface GeneratedCity {
    id: string;
    seed: number;
    name: string;
    parcels: ParcelTable;
    adjacency: Adjacency;
    stations: { name: string; lines: string; ll: [number, number] }[];
    manifest: DataManifest;
    /** Parcel polygons for the map, with bbl / demand / landpsf properties. */
    parcelFeatures: unknown;
    /** Building footprints, already massed into setback silhouettes. */
    buildingFeatures: unknown;
    /** Water, parks, piers, street surfaces and labels — the basemap. */
    context: unknown;
    /** The compact volume feed the Three.js skyline renders. */
    buildings3d: unknown[];
    stats: {
      lots: number; blocks: number; coverage: number; edges: number;
      buildings: number; withNeighbours: number; heightsImputed: number;
      /** Buildings that stand as more than one volume, and how many volumes. */
      stacked?: number; tiersTotal?: number;
      /** How many buildings took each silhouette family. */
      shapes?: Record<string, number>;
    };
  }

  export function makeCity(cityId: string, seed: number, opts?: { density?: string; size?: string }): GeneratedCity;
  export function sizeList(): { id: string; k: number; name: string; note: string }[];
  export function developmentList(): { id: string; name: string; note: string }[];
  export const DEFAULT_DEVELOPMENT: string;
  export const SIZES: Record<string, { k: number; name: string; note: string }>;
  export function randomSeed(): number;
  export function cityList(): { id: string; name: string; tagline: string; extents?: boolean }[];
  /** The id of the written-down city. */
  export const MANHATTAN: string;
  /**
   * HOW FAR UPTOWN THE MAP GOES. A written-down city cannot take a size — see
   * makeCity — so this is what fills the size slot for Manhattan, and it is a
   * real place at real scale rather than the same island scaled.
   */
  export const EXTENTS: Record<string, { at: [number, number]; name: string; note: string }>;
  export const DEFAULT_EXTENT: string;
  export function extentList(): { id: string; name: string; note: string }[];
  /**
   * What the island at (id, seed) is called, without building it. Constant for
   * the authored islands; for the procedural one the name comes out of the seed
   * the same way the coastline does.
   */
  export function cityName(cityId: string, seed: number, opts?: { size?: string }): string;
  /** The id of the generated island. */
  export const PROCEDURAL: string;
  /** Fixed reference seed for harnesses and BASELINE.json. */
  export const REFERENCE_SEED: number;
}
