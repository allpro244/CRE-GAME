// THE BROWSER SIDE OF THE JEV INTEGRATION.
//
// Settings (route, which firms, cadence) live in this browser's localStorage;
// the TypeSafe key lives in memory for the session and is written to
// localStorage ONLY when "remember on this device" is ticked. Nothing here is
// ever written into a save: the game state carries which firms are Jev-run,
// their charters, and the answers Jev gave — never a key or an endpoint.
//
// api.typesafe.ai refuses CORS preflights from localhost, so the default route
// is the local bridge (`pnpm ai-bridge`, which can hold the key itself);
// "direct" is offered for a deployment whose origin TypeSafe allows.
//
// LATENCY NEVER BLOCKS THE UI. When the month before a decision month closes,
// the next period's questions are sent in the background (built from that
// month's state); Play only waits if the answers are still out when the
// decision month arrives. Answers are filed on the state before the tick, so
// the engine stays synchronous and deterministic.
import { create } from "zustand";
import type { ParcelTable } from "@/data/types";
import type { GameState } from "@/engine/types";
import { advanceUntilAttentionAsync } from "@/engine/sim";
import { jevRivals } from "@/engine/rivals";
import { setJevFirms, defaultJevFirms } from "@/engine/jevmatch";
import { jevDue, fetchJevDecisions, applyJevDecisions, type Fetched, type FirmCallInfo } from "@/ai/jevController";
import { callJev, JevBreaker, TYPESAFE_URL, BRIDGE_URL } from "@/ai/jevClient";
import { JEV_MODEL, type CharterId } from "@/ai/jevQuestions";
import { useStore } from "@/state/store";

export type JevRoute = "bridge" | "direct";

interface JevUi {
  key: string;
  remember: boolean;
  route: JevRoute;
  bridgeUrl: string;
  every: number;
  timeoutMs: number;
  /** Start screen: how many firms Jev runs in the next town (0 = none). */
  startFirms: number;
  startSpectator: boolean;
  startCharter: CharterId | "style";
  busy: boolean;
  status: "idle" | "ok" | "offline" | "error";
  lastError: string;
  meter: { calls: number; tokens: number; usd: number; ms: number };
  set: (patch: Partial<Pick<JevUi, "key" | "remember" | "route" | "bridgeUrl" | "every" | "timeoutMs" | "startFirms" | "startSpectator" | "startCharter">>) => void;
}

const LS = "bw:jev:settings";
const LS_KEY = "bw:jev:key";
const read = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : d; } catch { return d; } };
const write = (k: string, v: unknown) => { try { if (v === undefined) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

const saved = read<Partial<JevUi>>(LS, {});
export const useJev = create<JevUi>((set, get) => ({
  key: read<string>(LS_KEY, ""),
  remember: !!saved.remember,
  route: saved.route ?? "bridge",
  bridgeUrl: saved.bridgeUrl ?? BRIDGE_URL,
  every: saved.every ?? 3,
  timeoutMs: saved.timeoutMs ?? 15000,
  startFirms: saved.startFirms ?? 0,
  startSpectator: !!saved.startSpectator,
  startCharter: saved.startCharter ?? "style",
  busy: false,
  status: "idle",
  lastError: "",
  meter: { calls: 0, tokens: 0, usd: 0, ms: 0 },
  set: (patch) => {
    set(patch);
    const s = get();
    write(LS, { remember: s.remember, route: s.route, bridgeUrl: s.bridgeUrl, every: s.every, timeoutMs: s.timeoutMs, startFirms: s.startFirms, startSpectator: s.startSpectator, startCharter: s.startCharter });
    // The key reaches localStorage only when asked to, and leaves it when un-asked.
    write(LS_KEY, s.remember && s.key ? s.key : undefined);
  },
}));

const breaker = new JevBreaker(3, 4);
const pending = new Map<number, Promise<Fetched[]>>();

function clientOpts() {
  const j = useJev.getState();
  return {
    url: j.route === "bridge" ? j.bridgeUrl : TYPESAFE_URL,
    apiKey: j.key || undefined,
    timeoutMs: j.timeoutMs,
    retries: 1,
    concurrency: 4,
    breaker,
    fetchImpl: ((...a: Parameters<typeof fetch>) => fetch(...a)) as typeof fetch,
    onFirm: (_id: string, i: FirmCallInfo) => useJev.setState((s) => ({
      meter: { calls: s.meter.calls + 1, tokens: s.meter.tokens + i.tokens, usd: s.meter.usd + i.usd, ms: i.ms },
      status: i.ok ? "ok" : breaker.isOpen(0) ? "offline" : "error",
      lastError: i.error ?? s.lastError,
    })),
  };
}

/** Is Jev set up to be called at all? Without it the game is exactly the scripted game. */
export const jevConfigured = () => { const j = useJev.getState(); return j.route === "bridge" || !!j.key; };

async function fetchFor(g: GameState, parcels: ParcelTable, forMonth: number): Promise<Fetched[]> {
  useJev.setState({ busy: true });
  try {
    const f = await fetchJevDecisions(g, parcels, { ...clientOpts(), forMonth });
    const period = Math.floor(forMonth / Math.max(1, g.jev?.every ?? 3));
    useJev.setState({ status: breaker.isOpen(period) ? "offline" : f.some((x) => x.error) ? "error" : "ok" });
    return f;
  } finally {
    useJev.setState({ busy: false });
  }
}

/** Start fetching the NEXT decision period in the background, if the next month is one. */
export function prefetchJev(g: GameState): void {
  const parcels = useStore.getState().parcels;
  if (!parcels || !jevConfigured()) return;
  const next = g.month;          // the state after a tick sits at the decision month's eve
  if (!jevDue(g, next) || pending.has(next)) return;
  pending.set(next, fetchFor(g, parcels, next));
}

/** Is a decision period due before the next month? */
export const jevDueNow = (g: GameState) => jevConfigured() && jevDue(g);

/**
 * FILE THE DUE PERIOD'S ANSWERS before the month advances. Uses the prefetch
 * if one is out (Play waits only for what is still in flight). Returns true
 * when the store's game was replaced.
 */
export async function runDueJev(): Promise<boolean> {
  const st = useStore.getState();
  const g = st.game, parcels = st.parcels;
  if (!g || !parcels || st.advancing || !jevDueNow(g)) return false;
  useStore.setState({ advancing: true });
  try {
    const p = pending.get(g.month) ?? fetchFor(g, parcels, g.month);
    const fetched = await p;
    pending.delete(g.month);
    if (useStore.getState().game !== g) return false;    // the player acted meanwhile
    useStore.setState({ game: applyJevDecisions(g, parcels, fetched, g.month) });
    return true;
  } catch (e) {
    useJev.setState({ status: "error", lastError: (e as Error).message });
    return false;
  } finally {
    useStore.setState({ advancing: false });
  }
}

/**
 * A MULTI-MONTH ADVANCE WITH JEV PERIODS ON THE CADENCE (Yr / Skip). Same
 * contract as advanceUntilAttentionAsync. A spectator run ignores the player's
 * stop reasons and a spectator's game over (nobody is at the desk).
 */
export async function advanceSpanWithJev(
  s: GameState, parcels: ParcelTable, bbls: string[], adjacency: Record<string, string[]> | null, cap: number,
): Promise<{ s: GameState; months: number; reason: string | null }> {
  if (!jevRivals(s).length && !s.spectator) return advanceUntilAttentionAsync(s, parcels, bbls, adjacency, cap, 1);
  const every = Math.max(1, s.jev?.every ?? 3);
  let g = s, months = 0;
  while (months < cap) {
    if (jevDueNow(g)) g = applyJevDecisions(g, parcels, await (pending.get(g.month) ?? fetchFor(g, parcels, g.month)), g.month);
    pending.delete(g.month);
    const span = Math.min(cap - months, every - (g.month % every));
    const r = await advanceUntilAttentionAsync(g, parcels, bbls, adjacency, span, 1);
    g = r.s;
    months += r.months;
    if (g.spectator && g.gameOver) g = { ...g, gameOver: null };
    if (r.reason && !g.spectator) return { s: g, months, reason: r.reason };
    if (g.gameOver || r.months === 0) break;
  }
  return { s: g, months, reason: null };
}

/** The player sits out: nothing of theirs interrupts the clock. */
export function asSpectator(g: GameState): GameState {
  return { ...g, spectator: true, brokersOff: true, brokerStops: "never", auctionQuiet: true };
}

/** A new town, set up from the start screen: N Jev firms and/or spectator. */
export function seedRunWithJev(g: GameState, parcels: ParcelTable): GameState {
  const j = useJev.getState();
  let next = g;
  if (j.startFirms > 0) {
    const ids = defaultJevFirms(next, parcels, j.startFirms);
    next = setJevFirms(next, { firms: ids.map((id) => ({ id, charter: j.startCharter === "style" ? undefined : j.startCharter })), every: j.every });
  }
  if (j.startSpectator) next = asSpectator(next);
  return next;
}

/** One tiny Noul, to prove the key and the route. */
export async function testJevConnection(): Promise<string> {
  const o = clientOpts();
  const r = await callJev({
    state: "Broadway & Wall is checking that it can reach Jev.",
    model: JEV_MODEL,
    questions: { reachable: { type: "noul", instructions: "Is this message a connection check?" } },
  }, { url: o.url, apiKey: o.apiKey, timeoutMs: Math.max(o.timeoutMs, 8000), retries: 0, fetchImpl: o.fetchImpl });
  const a = r.response.answers.reachable;
  useJev.setState({ status: "ok", lastError: "" });
  return `Connected to ${r.response.model} in ${r.ms}ms via ${useJev.getState().route === "bridge" ? "the local bridge" : "api.typesafe.ai"} — answered ${a.type === "noul" ? a.noul.toFixed(2) : "?"} (${r.response.usage?.input_tokens ?? "?"} input tokens).`;
}
