// The generator is plain .mjs, shared verbatim between the build pipeline and
// the browser — one copy, so a city built by `pnpm cities` and a city built on
// page load are the same city. These are the shapes the app cares about.
declare module "@/citygen/index.mjs" {
  import type { Adjacency, DataManifest, ParcelTable, ReservedParcel } from "@/data/types";

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
    /**
     * The region map only: land the commercial market does not reach in Phase 1
     * (neighbourhoods, farms, the parish), keyed by BBL. Never in `parcels`.
     */
    reserved?: Record<string, ReservedParcel>;
    /** The region map only: its ground layers in draw order (unrealExport, platPreview). */
    groundLayers?: string[];
    size?: string;
    stats: {
      lots: number; blocks: number; coverage: number; edges: number;
      buildings: number; withNeighbours: number; heightsImputed: number;
      /** Buildings that stand as more than one volume, and how many volumes. */
      stacked?: number; tiersTotal?: number;
      /** How many buildings took each silhouette family. */
      shapes?: Record<string, number>;
    };
  }

  /** Fetch a city's baked data (Manhattan's plat) before makeCity. Idempotent. */
  export function preloadCity(cityId: string): Promise<void>;
  /** Manhattan's baked plat, fetched once (preloadCity uses this). */
  export function loadManhattanPlat(): Promise<unknown>;
  /** Hand the plat to a context that already holds it (the town worker). */
  export function setManhattanPlat(data: unknown): void;
  export function makeCity(cityId: string, seed: number, opts?: { density?: string; size?: string; planV?: number; parks?: string }): GeneratedCity;
  /** How much of a generated town is park: the setup page's choice (island.mjs). */
  export const PARK_AMOUNTS: { id: "low" | "medium" | "high"; name: string; note: string }[];
  export const DEFAULT_PARKS: string;
  /** The street plan new towns are cut with (see GameState.cityPlan). */
  export const CITY_PLAN: number;
  export function sizeList(): { id: string; k: number; name: string; note: string }[];
  export function developmentList(): { id: string; name: string; note: string }[];
  export const DEFAULT_DEVELOPMENT: string;
  export const SIZES: Record<string, { k: number; name: string; note: string }>;
  export function randomSeed(): number;
  export function cityList(): { id: string; name: string; tagline: string; extents?: boolean; fixedSize?: boolean }[];
  /** The id of the region map. */
  export const REGION: string;
  /** Region map: the grid plat of a farm tract at a lot size (region/index.mjs). */
  export function platTractLots(
    tract: NonNullable<import("@/data/types").ParcelRecord["tract"]>, lotSf: number,
  ): { lots: { ring: [number, number][]; a: number; f: number; d: number }[]; streets: [number, number][][] };
  /** Region map: the road network as a plan — highways (built and proposed), interchanges, arterial pieces (region/index.mjs). */
  export function regionRoadPlan(seed: number): RegionRoadPlan;
  export type RoadPiece = { id: string; lenM: number; pts: [number, number][]; mid: [number, number]; edgeM: number };
  export type RegionRoadPlan = {
    seed: number; year0: number; widths: { highway: number; arterial: number; local: number };
    highways: { id: string; kind: string; segs: (RoadPiece & { built: boolean; year: number })[]; ix: { id: string; seg: string | null; p: [number, number]; edgeM: number }[] }[];
    arterials: (RoadPiece & { kind: "county" | "section" })[];
    homes: { p: [number, number]; n: number; edgeM: number; id?: string }[];
    centre: [number, number];
  };
  /** Region map: a reserved neighbourhood's built lots, redrawn from its recipe (region/index.mjs). */
  export function neighbourhoodLots(seed: number, id: number): {
    id: number; era: string; year: number;
    lots: { i: number; ring: [number, number][]; a: number; f: number; d: number; houseSf: number; storeys: number; c: [number, number] }[];
  } | null;
  /** A designed plat's recipe as citygen reads it (engine/platdesign.ts designRecipe). */
  export type DesignRecipe = import("@/engine/types").PlatDesign & { pondSf: number; amen: { k: import("@/engine/types").AmenityKind; at: [number, number] | null; sf: number }[] };
  type Pt = [number, number];
  export type DesignLot = {
    ring: Pt[]; front: Pt[]; c: Pt; a: number; w: number; d: number; size: number; face: number; street: number;
    sd?: number; pie?: boolean; base?: number[]; half?: boolean; near: [number, number][];
  };
  /** Region map: a farm tract as the player designed it, canonical metres (region/platdesign.mjs). */
  export function platTractDesign(
    tract: NonNullable<import("@/data/types").ParcelRecord["tract"]>, design: DesignRecipe,
  ): {
    layout: string; frame: { u: Pt; v: Pt; C: Pt; deg: number };
    base: Omit<DesignLot, "near">[]; lots: DesignLot[];
    streets: { pl: Pt[]; kind: "local" | "collector" | "court"; name: string; row: number }[];
    bulbs: { c: Pt; r: number; street: number }[]; bulbR: number;
    pond: { at: Pt; c: Pt; lots: number[]; sf: number; r: number };
    amen: { k: import("@/engine/types").AmenityKind; at: Pt | null; lots: number[]; sf: number; ok: boolean; trail?: Pt[][] }[];
    open: number[];
    stats: { lotSf: number; streetSf: number; pondSf: number; amenSf: number; openSf: number };
    ground: { outline: Pt[]; flood: Pt[][]; trail: Pt[][]; north: Pt; r: [number, number, number, number]; grossSf: number; floodSf: number; buildableSf: number; pondAt: Pt };
  };
  /** The same plat in lon/lat for the map and Unreal. */
  export function platDesignLL(
    tract: NonNullable<import("@/data/types").ParcelRecord["tract"]>, design: DesignRecipe,
  ): {
    lots: { ring: Pt[]; a: number; f: number; d: number; near: [number, number][] }[];
    streets: Pt[][]; bulbs: Pt[][];
    parks: { k: string; amen: number; ring: Pt[] }[]; pond: Pt[]; trails: Pt[][]; trees: Pt[];
    volumes: { amen: number; ring: Pt[]; h: number }[];
  };
  /** What the engine is handed from a designed plat (engine/platdesign.ts DesignGeo). */
  export function designSummary(geo: ReturnType<typeof platTractDesign>): import("@/engine/platdesign").DesignGeo;
  export const DESIGN_LAYOUTS: string[];
  export const DESIGN_SIZES: number[];
  export const LOT_DIM_FT: Record<number, [number, number]>;
  export const SPLIT_MIN: { sf: number; ft: number };
  export function canSplit(l: { pie?: boolean; w: number; a: number }): boolean;
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

declare module "@/citygen/region/access.mjs" {
  /** Huff's weight of a place `t` minutes' drive away (0 past fifteen minutes). */
  export function huffW(t: number): number;
  /** Drive minutes between two points (local metres) over the surface network and the open interchanges `ixs`. */
  export function driveTimer(ixs: [number, number][]): (ax: number, ay: number, bx: number, by: number) => number;
  export function carAccessibility(sites: [number, number][], origins: { x: number; y: number; n: number }[], ixs: [number, number][]): number[];
  export function surfaceMin(m: number): number;
}

declare module "@/citygen/platPreview.mjs" {
  import type { GeneratedCity } from "@/citygen/index.mjs";
  /** The town as a plat drawing for the setup screen: an SVG string, `w` px wide. */
  export function platPreviewSVG(city: GeneratedCity, w?: number): { svg: string; lots: number; name: string };
}

declare module "@/citygen/unrealExport.mjs" {
  import type { GeneratedCity } from "@/citygen/index.mjs";
  /** The city as the Unreal build reads it ("bw-city/1"); see unrealExport.mjs. */
  export function toBwCity(city: GeneratedCity, opts?: { familyFor?: (cls: string, year: number, h: number, roll?: number, district?: number, nb?: number) => string; tints?: Record<string, number[][]> }): unknown;
  export const GROUND_LAYERS: string[];
}
