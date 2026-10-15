/**
 * THE PAGE'S SIDE OF THE PLAT PREVIEW (state/platWorker.ts). One worker per
 * drawing, terminated when it answers or when a newer request replaces it, so
 * clicking New seed five times draws one map, not five. If no worker can be
 * started, the drawing runs on the page.
 */
import PlatWorker from "./platWorker?worker&inline";
import { drawPlat, type PlatReply, type PlatRequest } from "./platWorker";

let live: Worker | null = null;

export function drawPlatOffThread(req: PlatRequest): Promise<PlatReply> {
  live?.terminate();
  live = null;
  let w: Worker | null = null;
  try { w = new PlatWorker(); } catch { w = null; }
  if (!w) {
    try { return Promise.resolve(drawPlat(req)); } catch (e) { return Promise.resolve({ err: String((e as Error)?.message ?? e) }); }
  }
  const worker = w;
  live = worker;
  return new Promise<PlatReply>((ok) => {
    worker.onmessage = (e: MessageEvent<PlatReply>) => ok(e.data);
    worker.onerror = (e) => { e.preventDefault?.(); ok({ err: e.message || "the map could not be drawn" }); };
    worker.postMessage(req);
  }).finally(() => { worker.terminate(); if (live === worker) live = null; });
}
