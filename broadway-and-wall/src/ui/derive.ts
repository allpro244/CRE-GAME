/**
 * DERIVED DATA, COMPUTED ONCE PER GAME STATE.
 *
 * Pages used to keep their heavy derivations in a `useMemo` inside the
 * component. A page unmounts when you switch desks, so the memo went with it
 * and every visit re-walked the whole book — the Buildings table appraised
 * every deed in town (1.2 s on a 2012 save) each time it was opened, in the
 * same month, against the same state.
 *
 * The game state is immutable: every advance and every action writes a new
 * object. So a result keyed by that object's identity is good for exactly as
 * long as the state it was read from is the state on screen, and the WeakMap
 * lets it go with the state. Nothing here changes what is computed — only how
 * often.
 *
 * `deps` are any other inputs the derivation reads (the parcel table, the
 * pre-advance snapshot); the cached value is reused only while every one of
 * them is the same object as when it was computed.
 */
import type { GameState } from "@/engine/types";
import type { ParcelTable } from "@/data/types";
import { netWorth } from "@/engine/value";
import { streetStanding, type Standing } from "@/engine/standing";
import { ownerOf } from "@/engine/rivals";
import { holderOf } from "@/engine/owners";
import { ownerAt } from "@/engine/ownership";

type Entry = { deps: readonly unknown[]; value: unknown };

const cache = new WeakMap<object, Map<string, Entry>>();

const same = (a: readonly unknown[], b: readonly unknown[]) =>
  a.length === b.length && a.every((x, i) => Object.is(x, b[i]));

export function derive<T>(game: object, key: string, fn: () => T, deps: readonly unknown[] = []): T {
  let m = cache.get(game);
  if (!m) { m = new Map(); cache.set(game, m); }
  const hit = m.get(key);
  if (hit && same(hit.deps, deps)) return hit.value as T;
  const value = fn();
  m.set(key, { deps, value });
  return value;
}


// ---------- the derivations more than one screen reads ---------------------
// One per game state for the whole UI: the top bar, Books, the Street and the
// docket all print net worth, and the top bar reads last month's standing
// back as the baseline for "▲3" — which the month before already worked out.

/** The firm's net worth — `engine/value.netWorth`, once per state. */
export const nwOf = (game: GameState, parcels: ParcelTable): number =>
  derive(game, "netWorth", () => netWorth(game, parcels), [parcels]);

/** Your place on the street — `engine/standing.streetStanding`, once per state. */
export const standingOf = (game: GameState, parcels: ParcelTable): Standing =>
  derive(game, "streetStanding", () => streetStanding(game, parcels, nwOf(game, parcels)), [parcels]);

/**
 * Who holds a deed that is not yours, by name — the `name` of
 * `engine/ownership.ownerAt`, in the same order it looks (a firm, then a
 * private holder, then the city). `ownerAt` builds the owner's whole marked
 * statement to answer, ~0.5 ms a deed, which a table of every building in
 * town paid nine hundred times to print one word; the firm and the holder
 * carry the name themselves. Anything else falls through to `ownerAt`.
 */
export const ownerName = (game: GameState, parcels: ParcelTable, bbl: string): string | null =>
  ownerOf(game, bbl)?.name ?? holderOf(game, parcels, bbl)?.name ?? ownerAt(game, parcels, bbl)?.name ?? null;
