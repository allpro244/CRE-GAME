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
import { initEcon, openingPriceLevel } from "@/engine/market";
import { assetValue, initialCondition } from "@/engine/value";
import { normalizeParcels } from "@/engine/mix";
import type { GameState } from "@/engine/types";
import type { ParcelTable } from "@/data/types";

export type PlatRequest = { island: string; seed: number; size: string; dev: string; parks?: string; streets?: string };
/** This town's opening prices at one price level: office rent $/sf a year, and the median built lot at the street's value. */
export type TownPrices = { officePsf: number; building: number };
export type PlatReply = {
  svg?: string; lots?: number; name?: string; err?: string;
  /** The town's opening prices at the median dollar and at the 1-in-10 cheap and dear ones (see townPrices). */
  prices?: { lo: TownPrices; mid: TownPrices; hi: TownPrices };
};

/**
 * The map, and (`withPrices`) the town's prices. The worker answers twice —
 * the map first, then the prices — so the plat is not held back by the half
 * second the prices take; the page's own fallback asks for both at once.
 */
export function drawPlat(r: PlatRequest, withPrices = false): PlatReply {
  const { reply, prices } = cutPlat(r);
  if (withPrices) reply.prices = prices();
  return reply;
}
function cutPlat(r: PlatRequest): { reply: PlatReply; prices: () => PlatReply["prices"] } {
  const city = makeCity(r.island, r.seed, { size: r.size, density: r.dev, parks: r.parks, streets: r.streets });
  const reply: PlatReply = platPreviewSVG(city);
  // the map still stands without its prices
  const prices = () => { try { return townPrices(normalizeParcels(city.parcels as ParcelTable)); } catch { return undefined; } };
  return { reply, prices };
}

/**
 * WHAT THE OPENING CHEQUE BUYS IN THIS TOWN (setup screen, 2026-11-20).
 *
 * The town's price level is `openingPriceLevel(runSeed)`, and the run's seed
 * is drawn fresh at Break ground (state/store.ts startRun), so the setup page
 * cannot know the exact dollar — only this town's prices at each dollar. So
 * the engine's own opening (`initEcon` on this very parcel table) is run at
 * three run seeds: the ones whose price level sits at the 10th, 50th and 90th
 * percentile of the engine's own draw, found by sampling it. Nothing here is
 * a number of the page's: rent is the opening office rent index, the building
 * is the median `assetValue` of the town's built lots on opening day.
 */
export function townPrices(parcels: ParcelTable): { lo: TownPrices; mid: TownPrices; hi: TownPrices } {
  const at = (seed: number): TownPrices => {
    const e = initEcon({ seed } as GameState, parcels);
    const v: number[] = [];
    for (const k in parcels) {
      const rec = parcels[k];
      if (!rec || rec.class === "land" || !rec.bldgArea) continue;
      const x = assetValue(rec, e, initialCondition(rec));
      if (x > 0 && Number.isFinite(x)) v.push(x);
    }
    v.sort((a, b) => a - b);
    return { officePsf: e.rentIdx.office, building: v.length ? v[v.length >> 1] : 0 };
  };
  const [lo, mid, hi] = priceLevelSeeds();
  return { lo: at(lo), mid: at(mid), hi: at(hi) };
}

let quantileSeeds: [number, number, number] | null = null;
/** Run seeds whose price level sits at the 10th, 50th and 90th percentile of openingPriceLevel over 2,001 seeds. */
function priceLevelSeeds(): [number, number, number] {
  if (quantileSeeds) return quantileSeeds;
  const n = 2001;
  const xs = Array.from({ length: n }, (_, i) => ({ seed: i + 1, p: openingPriceLevel(i + 1) })).sort((a, b) => a.p - b.p);
  const q = (f: number) => xs[Math.round(f * (n - 1))]!.seed;
  return (quantileSeeds = [q(0.1), q(0.5), q(0.9)]);
}

if (typeof document === "undefined" && typeof self !== "undefined") {
  self.onmessage = (e: MessageEvent<PlatRequest>) => {
    const post = (r: PlatReply) => (self as unknown as Worker).postMessage(r);
    // two answers: the map, then its prices ({ prices } alone, possibly undefined)
    try {
      const { reply, prices } = cutPlat(e.data);
      post(reply);
      post({ prices: prices() });   // the second answer: { prices } alone, possibly undefined
    } catch (err) { post({ err: String((err as Error)?.message ?? err) }); }
  };
}
