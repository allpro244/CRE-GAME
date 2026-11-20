// THE PLAYER IS ONE FIRM AMONG FIRMS (PARITY_PLAN.md, P0).
//
// Every company in town — the player's and each competitor's — is addressed
// the same way here, by a firm id: "player" for the player, the rival's id for
// a competitor. The two sets of books are still stored apart (the player's on
// the GameState root, a rival's on its Rival record and the city's loan
// record), so this module reads either and hides which. Actions written
// against it can be taken by any firm; that is the whole of the parity rule.
// Storage converges later (P8), one concept at a time, behind these functions.

import type { GameState, Rival } from "./types";
import { livingRivals, ownerOf } from "./rivals";
import { firmName } from "./firm";

/** The player's firm id. */
export const PLAYER = "player";
export type FirmId = string;

/** Every firm in business: the player first, then each living competitor. */
export function firmIds(s: GameState): FirmId[] {
  return [PLAYER, ...livingRivals(s).map((r) => r.id)];
}

/** A competitor's record, or undefined for the player or an unknown id. */
export function rivalOf(s: GameState, id: FirmId): Rival | undefined {
  return id === PLAYER ? undefined : (s.rivals ?? []).find((r) => r.id === id);
}

/** The firm that owns a deed, or null when no firm does (a private holder, the city, nobody). */
export function ownerFirm(s: GameState, bbl: string): FirmId | null {
  if (s.holdings?.[bbl]) return PLAYER;
  return ownerOf(s, bbl)?.id ?? null;
}

/** A firm's cash on hand. */
export function firmCash(s: GameState, id: FirmId): number {
  return id === PLAYER ? s.cash : (rivalOf(s, id)?.cash ?? 0);
}

/** The deeds a firm holds. */
export function firmDeeds(s: GameState, id: FirmId): string[] {
  return id === PLAYER ? Object.keys(s.holdings ?? {}) : [...(rivalOf(s, id)?.bbls ?? [])];
}

/** A firm's name as the street knows it. */
export function firmLabel(s: GameState, id: FirmId): string {
  return id === PLAYER ? firmName(s) : (rivalOf(s, id)?.name ?? id);
}
