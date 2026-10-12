/**
 * THE TOWN, OFF THE MAIN THREAD.
 *
 * Break ground used to cut the city and deal its opening market on the page's
 * own thread, and on a big map that is a long time to hold it: Manhattan below
 * 59th Street at Metropolis build-out measured 10.5s in `makeCity` and 29s in
 * the opening pipeline (firstListings → seedOpeningPipeline) in a headless
 * Chromium, with the waiting screen frozen mid-sweep the whole way. Here the
 * same two calls run in a worker and only the finished town comes back.
 *
 * Nothing about the town changes. makeCity is a pure function of its
 * arguments, and the engine is the one simWorker.ts already runs off-thread:
 * deterministic, and caching on object identity, so dealing the market on a
 * structured copy is dealing the same market. See state/townClient.ts.
 */
import { makeCity, setManhattanPlat, type GeneratedCity } from "@/citygen/index.mjs";
import { normalizeParcels } from "@/engine/mix";
import { newGame, firstListings } from "@/engine/sim";
import type { GameState } from "@/engine/types";
import type { GameSetup } from "@/engine/setup";
import type { ParcelTable } from "@/data/types";

export type TownRequest = {
  island: string; seed: number; size: string; dev: string; plan?: number;
  /** Manhattan's plat, when the island needs it: the worker cannot fetch it from the single-file build. */
  plat?: unknown;
  /** Deal a new campaign on the town as well (Break ground); absent for a Continue. */
  deal?: { runSeed: number; money: number; setup: Partial<GameSetup> };
};
export type TownReply = { built?: GeneratedCity; game?: GameState; err?: string };

/** The town and, if asked, its opening market. Shared by the worker and the page's fallback. */
export function cutTown(r: TownRequest): { built: GeneratedCity; game?: GameState } {
  const built = makeCity(r.island, r.seed, { size: r.size, density: r.dev, planV: r.plan });
  // Any record the pipeline still files as "mixed" becomes its dominant use
  // plus an explicit mix, once, at the door. In place: built.parcels is the table.
  const parcels = normalizeParcels(built.parcels as ParcelTable);
  const game = r.deal
    ? firstListings(newGame(r.deal.runSeed, parcels, r.deal.money, r.deal.setup), parcels, Object.keys(parcels))
    : undefined;
  return { built, game };
}

// only when loaded as a worker: the page imports cutTown from here too
if (typeof document === "undefined" && typeof self !== "undefined") {
  self.onmessage = (e: MessageEvent<TownRequest>) => {
    const post = (r: TownReply) => (self as unknown as Worker).postMessage(r);
    try {
      if (e.data.plat) setManhattanPlat(e.data.plat);
      post(cutTown(e.data));
    } catch (err) {
      post({ err: String((err as Error)?.stack ?? err) });
    }
  };
}
