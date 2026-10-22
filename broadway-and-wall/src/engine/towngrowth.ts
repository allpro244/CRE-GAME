// THE TOWN GROWING (the region map, Phase 4): commerce following rooftops,
// the board upzoning what the town is redeveloping, and the record of the
// inner ring rebuilt.
import type { ParcelTable } from "@/data/types";
import type { GameState } from "./types";

export interface TownState {
  /** shopping centres opened since the opening */
  centres: { bbl: string; kind: string; m: number; sf: number; households: number }[];
}

export function tickTownGrowth(s: GameState, parcels: ParcelTable, bbls: string[], adjacency: Record<string, string[]> | null) {
  void s; void parcels; void bbls; void adjacency;
}

export function townSummary(s: GameState) {
  const t = s.growth?.town;
  return { centres: t?.centres.length ?? 0 };
}
