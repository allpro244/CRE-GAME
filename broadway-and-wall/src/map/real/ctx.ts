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
  piles?: [number, number][];
  land?: [number, number][];
  benches?: Oriented[];
  rails?: Oriented[];
  parks?: { ring: [number, number][]; holes?: [number, number][][]; flavour?: string }[] | [number, number][][];
  ponds?: [number, number][][];
  /** Creeks, canals and mill ponds — sunk into a channel with banks. */
  streams?: { ring: [number, number][]; water: string }[];
  /** The generator's crossings: footprint, flow bearing, and the widths spanned. */
  bridges?: { ring: [number, number][]; deg: number; w: number; rw: number; cw: number }[];
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
}
