/**
 * THE PAGE'S SIDE OF THE SIM WORKER (state/simWorker.ts).
 *
 * The town — parcels, the lot list, adjacency — goes over once, when the
 * table first appears or changes. Each month then sends the state and gets
 * the next one back; the copy each way costs single-digit milliseconds
 * against a tick of tens to hundreds.
 *
 * If a worker cannot be started (an old browser, a locked-down page) or one
 * fails mid-month, the same engine call runs here instead, as it always did:
 * a month is never lost to the worker, only made slower.
 */
import SimWorker from "./simWorker?worker&inline";
import { advanceMonth, advanceUntilAttention } from "@/engine/sim";
import type { GameState } from "@/engine/types";
import type { ParcelTable } from "@/data/types";
import type { SimReply, SimRequest } from "./simWorker";

type Adj = Record<string, string[]> | null;
type Span = ReturnType<typeof advanceUntilAttention>;

let worker: Worker | null | undefined;
const waiting = new Map<number, { ok: (r: SimReply) => void; fail: (e: unknown) => void }>();
let seq = 0;
// which parcel table the worker holds, by identity; a new town re-sends it
const towns = new WeakMap<ParcelTable, number>();
let townSent = 0;

function failAll(why: unknown) {
  for (const w of waiting.values()) w.fail(why);
  waiting.clear();
}

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    const w = new SimWorker();
    w.onmessage = (e: MessageEvent<SimReply>) => {
      const p = waiting.get(e.data.id);
      if (!p) return;
      waiting.delete(e.data.id);
      if (e.data.err) p.fail(new Error(e.data.err));
      else p.ok(e.data);
    };
    // a worker that dies (failed to load, out of memory) is retired for the
    // session; everything after runs on the page
    w.onerror = (e) => { e.preventDefault?.(); worker = null; failAll(e.message || "sim worker failed"); w.terminate(); };
    worker = w;
  } catch {
    worker = null;
  }
  return worker;
}

function send(w: Worker, parcels: ParcelTable, bbls: string[], adjacency: Adj, req: (town: number, id: number) => SimRequest): Promise<SimReply> {
  let id = towns.get(parcels);
  if (id === undefined) { id = ++seq; towns.set(parcels, id); }
  if (townSent !== id) {
    w.postMessage({ type: "town", town: { id, parcels, bbls, adjacency } } satisfies SimRequest);
    townSent = id;
  }
  const n = ++seq;
  return new Promise<SimReply>((ok, fail) => {
    waiting.set(n, { ok, fail });
    w.postMessage(req(id!, n));
  });
}

/** One month, off the page's thread where it can be. */
export async function monthOffThread(s: GameState, parcels: ParcelTable, bbls: string[], adjacency: Adj): Promise<GameState> {
  const w = getWorker();
  if (w) {
    try {
      const r = await send(w, parcels, bbls, adjacency, (town, id) => ({ type: "month", id, town, s }));
      if (r.s) return r.s;
    } catch { /* fall through: the same tick, here */ }
  }
  return advanceMonth(s, parcels, bbls, adjacency);
}

/** Up to `cap` months, stopping where advanceUntilAttention stops, off the page's thread where it can be. */
export async function spanOffThread(s: GameState, parcels: ParcelTable, bbls: string[], adjacency: Adj, cap: number): Promise<Span> {
  const w = getWorker();
  if (w) {
    try {
      const r = await send(w, parcels, bbls, adjacency, (town, id) => ({ type: "span", id, town, s, cap }));
      if (r.span) return r.span;
    } catch { /* fall through */ }
  }
  return advanceUntilAttention(s, parcels, bbls, adjacency, cap);
}
