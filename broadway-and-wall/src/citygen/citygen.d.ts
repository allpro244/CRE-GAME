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
    /** Building footprints, already massed with setbacks and podiums. */
    buildingFeatures: unknown;
    /** Water, parks, piers, street surfaces and labels — the basemap. */
    context: unknown;
    /** The compact volume feed the Three.js skyline renders. */
    buildings3d: unknown[];
    stats: {
      lots: number; blocks: number; coverage: number; edges: number;
      buildings: number; withNeighbours: number; heightsImputed: number;
    };
  }

  export function makeCity(cityId: string, seed: number): GeneratedCity;
  export function randomSeed(): number;
  export function cityList(): { id: string; name: string; tagline: string }[];
  export const CITIES: Record<string, { name: string; district: string; seed: number }>;
  export const TAGLINES: Record<string, string>;
}
