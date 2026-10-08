/**
 * When a building opening is worth interrupting the player.
 *
 * The city delivers a hundred-odd buildings a century. A popup on every one
 * is noise. A principal is told when something MASSIVE tops out — one of the
 * five largest buildings on the whole map by floor area, any asset class,
 * yours or anyone's — measured against the rest of the standing city, not
 * against the handful of jobs already in `s.built`. Smaller deliveries still
 * land in the news, the digest and the firm timeline.
 *
 * Compared to the rest, not including itself: otherwise a new building is
 * already in the distribution it is being ranked against.
 */
import type { ParcelTable } from "@/data/types";
import type { GameState } from "./types";
import { resolveRec } from "./value";

/** How many of the city's largest buildings earn the popup. */
export const DELIVERY_CEREMONY_TOP_N = 5;

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
  // in the top five if it is at least the fifth-largest of the others
  return others.length < DELIVERY_CEREMONY_TOP_N || sf >= others[DELIVERY_CEREMONY_TOP_N - 1];
}
