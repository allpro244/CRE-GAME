/**
 * THE MONTH, OFF THE MAIN THREAD.
 *
 * A tick is 50–200ms of engine work on a standard City, and more on a Great
 * City or late in a campaign. Run on the page's own thread it froze the map
 * for that long at every month turn — the camera stopped, the cranes stopped,
 * and Play read as a stutter once a second. Here the same engine runs in a
 * worker: the page keeps drawing while the month closes, and only the finished
 * state comes back.
 *
 * Nothing about the month changes. The engine is deterministic, never writes
 * to the parcel table, and keeps its caches on object identity, so a tick on a
 * structured copy of the state is the same tick (measured: byte-identical
 * JSON against an in-place tick). See state/simClient.ts for the page's side.
 */
import { advanceMonth, advanceUntilAttention } from "@/engine/sim";
import type { GameState } from "@/engine/types";
import type { ParcelTable } from "@/data/types";

type Town = { id: number; parcels: ParcelTable; bbls: string[]; adjacency: Record<string, string[]> | null };
export type SimRequest =
  | { type: "town"; town: Town }
  | { type: "month"; id: number; town: number; s: GameState }
  | { type: "span"; id: number; town: number; s: GameState; cap: number };
export type SimReply = { id: number; s?: GameState; span?: ReturnType<typeof advanceUntilAttention>; err?: string };

let town: Town | null = null;
const post = (r: SimReply) => (self as unknown as Worker).postMessage(r);

self.onmessage = (e: MessageEvent<SimRequest>) => {
  const m = e.data;
  if (m.type === "town") { town = m.town; return; }
  if (!town || town.id !== m.town) { post({ id: m.id, err: "town not loaded" }); return; }
  try {
    if (m.type === "month") post({ id: m.id, s: advanceMonth(m.s, town.parcels, town.bbls, town.adjacency) });
    else post({ id: m.id, span: advanceUntilAttention(m.s, town.parcels, town.bbls, town.adjacency, m.cap) });
  } catch (err) {
    post({ id: m.id, err: String((err as Error)?.stack ?? err) });
  }
};
