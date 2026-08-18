/**
 * When a building opening is worth interrupting the player.
 *
 * The city delivers a hundred-odd buildings a century. A popup on every one
 * is noise. A principal is told when something MASSIVE tops out — the top
 * one per cent of the standing city by floor area, measured against the rest
 * of the properties, not against the handful of jobs already in `s.built`.
 *
 * Compared to the rest, not including itself: otherwise a new building is
 * already in the distribution it is being ranked against.
 */
import type { ParcelTable } from "@/data/types";
import type { GameState } from "./types";
import { resolveRec } from "./value";

export const DELIVERY_CEREMONY_TOP = 0.01;

export function deliveryWorthCeremony(
  game: GameState, parcels: ParcelTable, bbl: string,
): boolean {
  const rec = resolveRec(parcels, game, bbl);
  const sf = rec?.bldgArea ?? 0;
  if (sf <= 0) return false;

  const others: number[] = [];
  for (const id of Object.keys(parcels)) {
    if (id === bbl) continue;
    const r = resolveRec(parcels, game, id);
    const a = r?.bldgArea ?? 0;
    if (a > 0) others.push(a);
  }
  // An empty town: the first building is the skyline.
  if (others.length === 0) return true;
  others.sort((a, b) => b - a);
  const k = Math.max(1, Math.ceil(others.length * DELIVERY_CEREMONY_TOP));
  return sf >= (others[k - 1] ?? 0);
}
