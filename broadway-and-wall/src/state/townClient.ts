/**
 * THE PAGE'S SIDE OF THE TOWN WORKER (state/townWorker.ts).
 *
 * One worker per town, terminated as soon as the town comes back: it holds a
 * full copy of the city while it works, and on a big map that copy is
 * hundreds of megabytes nobody needs once the page has its own.
 *
 * If a worker cannot be started, or dies (an old browser, a locked-down page,
 * out of memory), the same call runs here instead, as it always did: a town is
 * never lost to the worker, only built with the page held while it is.
 */
import TownWorker from "./townWorker?worker&inline";
import { MANHATTAN, loadManhattanPlat } from "@/citygen/index.mjs";
import { cutTown, type TownReply, type TownRequest } from "./townWorker";

export async function cutTownOffThread(req: TownRequest): Promise<ReturnType<typeof cutTown>> {
  const plat = req.island === MANHATTAN ? await loadManhattanPlat() : undefined;
  let w: Worker | null = null;
  try { w = new TownWorker(); } catch { w = null; }
  if (w) {
    const worker = w;
    const r = await new Promise<TownReply>((ok) => {
      worker.onmessage = (e: MessageEvent<TownReply>) => ok(e.data);
      worker.onerror = (e) => { e.preventDefault?.(); ok({ err: e.message || "the town worker failed to start" }); };
      worker.postMessage({ ...req, plat } satisfies TownRequest);
    }).finally(() => worker.terminate());
    if (r.built) return { built: r.built, game: r.game };
    // a worker error is not trusted as the verdict: the page tries the same
    // call, and says so, because the page is held while it does
    console.warn(`Town worker failed; building the town on the page instead. ${r.err ?? ""}`);
  }
  return cutTown(req);
}
