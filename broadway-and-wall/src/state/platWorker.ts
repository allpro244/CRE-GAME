/**
 * THE SEED'S MAP, OFF THE MAIN THREAD — the plat preview on the setup screen.
 *
 * makeCity is a pure function of its arguments (see townWorker.ts), so the
 * preview cuts exactly the town Break ground will cut for the same island,
 * size, build-out, parks and seed, and draws it as a plat. A second or so on
 * a standard island, longer on a big one; the setup screen stays live while
 * it runs. See state/platClient.ts.
 */
import { makeCity } from "@/citygen/index.mjs";
import { platPreviewSVG } from "@/citygen/platPreview.mjs";

export type PlatRequest = { island: string; seed: number; size: string; dev: string; parks?: string };
export type PlatReply = { svg?: string; lots?: number; name?: string; err?: string };

export function drawPlat(r: PlatRequest): PlatReply {
  const city = makeCity(r.island, r.seed, { size: r.size, density: r.dev, parks: r.parks });
  return platPreviewSVG(city);
}

if (typeof document === "undefined" && typeof self !== "undefined") {
  self.onmessage = (e: MessageEvent<PlatRequest>) => {
    const post = (r: PlatReply) => (self as unknown as Worker).postMessage(r);
    try { post(drawPlat(e.data)); } catch (err) { post({ err: String((err as Error)?.message ?? err) }); }
  };
}
