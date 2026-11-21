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
 *
 * `?simworker=off` on the page's address runs every month here on purpose,
 * for measuring the page with and without the worker. `simWhere()` says
 * where the last month ran (window.__sim, for headless checks).
 *
 * THE NEXT MONTH IS CLOSED AHEAD (2026-11-20). While the player reads month
 * N, a second worker closes N+1 from exactly the state the page holds. If the
 * player presses Advance on that same state — the same object; the store only
 * ever replaces `game`, never edits it — the month is already there. If they
 * did anything (a lease, a bid, a load), the state is a different object and
 * the guess is dropped unread; the month is closed from what is there, as
 * before. advanceMonth is a pure function of the state and the town (it
 * writes nothing back into the parcel table — measured — and a month re-run
 * from the same state is byte-identical), so a month closed ahead is the
 * month that would have been closed: nothing about the game changes, only
 * when the waiting happens. `?simahead=off` turns it off.
 */
import SimWorker from "./simWorker?worker&inline";
import { advanceMonth, advanceUntilAttention } from "@/engine/sim";
import type { GameState } from "@/engine/types";
import type { ParcelTable } from "@/data/types";
import type { SimReply, SimRequest } from "./simWorker";

type Adj = Record<string, string[]> | null;
type Span = ReturnType<typeof advanceUntilAttention>;

let where: "worker" | "ahead" | "page" | "none" = "none";
/** Where the last month was closed: in the sim worker, ahead of time in the second worker, on the page, or none yet. */
export const simWhere = () => where;
if (typeof window !== "undefined") (window as unknown as { __sim?: { where: () => string } }).__sim = { where: simWhere };

function flagOff(name: string): boolean {
  try { return new URLSearchParams(location.search).get(name) === "off"; } catch { return false; }
}
const workerOff = () => flagOff("simworker");
let seq = 0;
// which parcel table a worker holds, by identity; a new town re-sends it
const towns = new WeakMap<ParcelTable, number>();

/** One sim worker and its own bookkeeping: the month's worker, and the one that closes the next month ahead. */
type Lane = {
  w: Worker | null | undefined;
  waiting: Map<number, { ok: (r: SimReply) => void; fail: (e: unknown) => void }>;
  townSent: number;
};
const main: Lane = { w: undefined, waiting: new Map(), townSent: 0 };
const ahead: Lane = { w: undefined, waiting: new Map(), townSent: 0 };

function failAll(lane: Lane, why: unknown) {
  for (const w of lane.waiting.values()) w.fail(why);
  lane.waiting.clear();
}

function getWorker(lane: Lane = main): Worker | null {
  if (lane.w !== undefined) return lane.w;
  if (typeof Worker === "undefined" || workerOff() || (lane === ahead && flagOff("simahead"))) { lane.w = null; return null; }
  try {
    const w = new SimWorker();
    w.onmessage = (e: MessageEvent<SimReply>) => {
      const p = lane.waiting.get(e.data.id);
      if (!p) return;
      lane.waiting.delete(e.data.id);
      if (e.data.err) p.fail(new Error(e.data.err));
      else p.ok(e.data);
    };
    // a worker that dies (failed to load, out of memory) is retired for the
    // session; everything after runs on the page (or, for the ahead lane, not at all)
    w.onerror = (e) => { e.preventDefault?.(); lane.w = null; failAll(lane, e.message || "sim worker failed"); w.terminate(); };
    lane.w = w;
  } catch {
    lane.w = null;
  }
  return lane.w;
}

function send(lane: Lane, w: Worker, parcels: ParcelTable, bbls: string[], adjacency: Adj, req: (town: number, id: number) => SimRequest): Promise<SimReply> {
  let id = towns.get(parcels);
  if (id === undefined) { id = ++seq; towns.set(parcels, id); }
  if (lane.townSent !== id) {
    w.postMessage({ type: "town", town: { id, parcels, bbls, adjacency } } satisfies SimRequest);
    lane.townSent = id;
  }
  const n = ++seq;
  return new Promise<SimReply>((ok, fail) => {
    lane.waiting.set(n, { ok, fail });
    w.postMessage(req(id!, n));
  });
}

/** The month being closed ahead: from which state, on which town. */
let next: { from: GameState; parcels: ParcelTable; p: Promise<GameState | null> } | null = null;

/** Start closing the month after `s` in the ahead lane, if there is one. */
function closeAhead(s: GameState, parcels: ParcelTable, bbls: string[], adjacency: Adj) {
  next = null;
  if (s.gameOver) return;
  const w = getWorker(ahead);
  if (!w) return;
  const p = send(ahead, w, parcels, bbls, adjacency, (town, id) => ({ type: "month", id, town, s }))
    .then((r) => r.s ?? null, () => null);
  next = { from: s, parcels, p };
}

/** One month, off the page's thread where it can be. */
export async function monthOffThread(s: GameState, parcels: ParcelTable, bbls: string[], adjacency: Adj): Promise<GameState> {
  // Already closed ahead from this very state?
  const ready = next && next.from === s && next.parcels === parcels ? next.p : null;
  next = null;
  if (ready) {
    const r = await ready;
    if (r) { where = "ahead"; closeAhead(r, parcels, bbls, adjacency); return r; }
  }
  const w = getWorker();
  if (w) {
    try {
      const r = await send(main, w, parcels, bbls, adjacency, (town, id) => ({ type: "month", id, town, s }));
      if (r.s) { where = "worker"; closeAhead(r.s, parcels, bbls, adjacency); return r.s; }
    } catch (e) { console.warn("Sim worker failed; this month runs on the page:", String((e as Error)?.message ?? e)); }
  }
  where = "page";
  return advanceMonth(s, parcels, bbls, adjacency);
}

/** Up to `cap` months, stopping where advanceUntilAttention stops, off the page's thread where it can be. */
export async function spanOffThread(s: GameState, parcels: ParcelTable, bbls: string[], adjacency: Adj, cap: number, seen?: string[]): Promise<Span> {
  const w = getWorker();
  if (w) {
    try {
      const r = await send(main, w, parcels, bbls, adjacency, (town, id) => ({ type: "span", id, town, s, cap, seen }));
      if (r.span) { where = "worker"; if (r.span.s) closeAhead(r.span.s, parcels, bbls, adjacency); return r.span; }
    } catch { /* fall through */ }
  }
  where = "page";
  return advanceUntilAttention(s, parcels, bbls, adjacency, cap, seen);
}
