// What the map hands the 3D city besides the building volumes: the town's
// ground furniture, water and crossings, and the per-lot outlines. Lifted out
// of the retired classic renderer (ThreeBuildings), which defined it first.
import type { BuildingDesign } from "@/engine/types";

/** Street furniture arrives with a baked bearing. */
export interface Oriented { p: [number, number]; r: number }

export interface CityCtx {
  trees?: [number, number][];
  /** Parallel to the curbs: per segment, half-street width and footway width (m). */
  curbMeta?: { hw: number[]; sw: number[] }[];
  sidewalks?: { ring: [number, number][]; holes: [number, number][][] }[];
  kerbs?: [number, number][][];
  zebras?: [number, number][][];
  /** The harbour's working edge, where the piers go out. */
  quays?: [number, number][][];
  /** Open ground — boulevard malls and the esplanade — where a tree or a bench may stand but no car parks. */
  opens?: [number, number][][][];   // each: outer ring, then holes
  embankments?: [number, number][][];
  railBeds?: [number, number][][];      // ballast beds (outer rings)
  railTracks?: [number, number][][];    // track centre lines
  plazas?: [number, number][][];        // civic forecourts (ground index only; MapLibre paints them)
  /** named landmarks a written-down city places: kind, facing (maths deg), and a length where it has one */
  landmarks?: { p: [number, number]; kind: string; deg: number; len: number }[];   // promenade rings along embanked water (ground index only)
  piles?: [number, number][];
  land?: [number, number][];
  benches?: Oriented[];
  rails?: Oriented[];
  parks?: { ring: [number, number][]; holes?: [number, number][][]; flavour?: string }[] | [number, number][][];
  ponds?: [number, number][][];
  /** Creeks, canals and mill ponds — sunk into a channel with banks. */
  streams?: { ring: [number, number][]; water: string; embank?: boolean }[];
  /** The generator's crossings: footprint, flow bearing, and the widths spanned. */
  bridges?: { ring: [number, number][]; deg: number; type?: string; w: number; rw: number; cw: number }[];
  paths?: [number, number][][];
  /** The parcel outlines, by BBL — a redevelopment stands on its lot, not on what was knocked down. */
  lots?: Record<string, [number, number][]>;
}

/** A building the player or a rival put up, or is putting up. */
export interface PlayerItem {
  bbl: string;
  cls: string;
  heightM: number;
  floors: number;
  construction: boolean;
  fresh?: boolean;
  cov?: number;
  year?: number;
  /** the developer's chosen look (BuildingDesign); absent means the street decides */
  design?: BuildingDesign;
  /** a trading ground floor (the scheme's mix carries retail); absent: read off cls */
  shops?: boolean;
}
