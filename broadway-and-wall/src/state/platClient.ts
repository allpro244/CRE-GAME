/**
 * THE PAGE'S SIDE OF THE PLAT PREVIEW (state/platWorker.ts). One worker per
 * drawing, terminated when it answers or when a newer request replaces it, so
 * clicking New seed five times draws one map, not five. If no worker can be
 * started, the drawing runs on the page. The worker answers twice: the map,
 * then the town's prices (`onPrices`).
 */
import PlatWorker from "./platWorker?worker&inline";
import { drawPlat, type PlatReply, type PlatRequest } from "./platWorker";

let live: Worker | null = null;

export function drawPlatOffThread(req: PlatRequest, onPrices?: (p: PlatReply["prices"]) => void): Promise<PlatReply> {
  live?.terminate();
  live = null;
  let w: Worker | null = null;
  try { w = new PlatWorker(); } catch { w = null; }
  if (!w) {
    try {
      const r = drawPlat(req, !!onPrices);
      onPrices?.(r.prices);
      return Promise.resolve(r);
    } catch (e) { return Promise.resolve({ err: String((e as Error)?.message ?? e) }); }
  }
  const worker = w;
  live = worker;
  // Two answers: the map, then the town's prices (platWorker.ts). The worker
  // lives until the second, or until a newer request replaces it.
  let n = 0;
  const done = () => { worker.terminate(); if (live === worker) live = null; };
  return new Promise<PlatReply>((ok) => {
    worker.onmessage = (e: MessageEvent<PlatReply>) => {
      if (n++ === 0) { ok(e.data); if (e.data.err) done(); return; }
      onPrices?.(e.data.prices);
      done();
    };
    worker.onerror = (e) => { e.preventDefault?.(); ok({ err: e.message || "the map could not be drawn" }); done(); };
    worker.postMessage(req);
  });
}
