// THE BROWSER SIDE OF THE AI-FIRM PLUG-IN.
//
// Provider profiles (name, transport, URL, model) live in this browser's
// localStorage; keys live in memory for the session and are written to
// localStorage ONLY when the profile's "remember on this device" is ticked.
// Nothing here is ever written into a save — the game state carries a firm's
// provider LABEL (`Rival.aiControlled`) and nothing else. A firm is linked to
// its profile by name, so a reloaded save finds its providers again (and a
// firm whose profile is missing simply holds, with the reason filed).
import { create } from "zustand";
import type { ParcelTable } from "@/data/types";
import type { GameState } from "@/engine/types";
import { advanceUntilAttentionAsync } from "@/engine/sim";
import { aiBrief, createAiFirms, convertToAi } from "@/engine/aifirms";
import { aiRivals } from "@/engine/rivals";
import { runAiTurn, aiTurnDue } from "@/ai/controller";
import { callProvider, type AiProviderConfig, type ProviderKind } from "@/ai/providers";
import { mockPlayers, type MockStyle } from "@/ai/mock";
import { useStore } from "@/state/store";

export interface AiProfile {
  name: string;
  kind: ProviderKind;
  baseUrl?: string;
  model?: string;
  /** anthropic only: call straight from the tab with the direct-browser-access header. */
  browserDirect?: boolean;
  /** openai-compatible only: ask for response_format json_object. */
  jsonMode?: boolean;
  /** Persist the key in this browser's localStorage. Off by default. */
  remember?: boolean;
}

interface AiState {
  profiles: AiProfile[];
  /** Keys by profile name — memory only unless the profile says remember. */
  keys: Record<string, string>;
  everyMonths: number;
  /** Start screen: build the next town with every profile as an AI firm. */
  startWithAi: boolean;
  /** Start screen: the player sits out. */
  startSpectator: boolean;
  startCash: number;
  busy: boolean;
  /** Last call per firm name, for the settings panel. */
  last: Record<string, { ok: boolean; note: string; at: number }>;
  saveProfile: (p: AiProfile, key?: string) => void;
  removeProfile: (name: string) => void;
  set: (patch: Partial<Pick<AiState, "everyMonths" | "startWithAi" | "startSpectator" | "startCash">>) => void;
}

const LS = "bw:ai:profiles";
const LS_KEYS = "bw:ai:keys";
const LS_OPTS = "bw:ai:opts";
const read = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : d; } catch { return d; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

function persist(profiles: AiProfile[], keys: Record<string, string>) {
  write(LS, profiles);
  // Only the keys of profiles that asked to be remembered, and nothing else.
  const kept: Record<string, string> = {};
  for (const p of profiles) if (p.remember && keys[p.name]) kept[p.name] = keys[p.name];
  if (Object.keys(kept).length) write(LS_KEYS, kept);
  else { try { localStorage.removeItem(LS_KEYS); } catch { /* */ } }
}

const opts0 = read<{ everyMonths?: number; startCash?: number }>(LS_OPTS, {});
export const useAi = create<AiState>((set, get) => ({
  profiles: read<AiProfile[]>(LS, []),
  keys: read<Record<string, string>>(LS_KEYS, {}),
  everyMonths: opts0.everyMonths ?? 3,
  startWithAi: false,
  startSpectator: false,
  startCash: opts0.startCash ?? 25_000_000,
  busy: false,
  last: {},
  saveProfile: (p, key) => {
    const profiles = [...get().profiles.filter((x) => x.name !== p.name), p];
    const keys = { ...get().keys };
    if (key !== undefined) { if (key) keys[p.name] = key; else delete keys[p.name]; }
    set({ profiles, keys });
    persist(profiles, keys);
  },
  removeProfile: (name) => {
    const profiles = get().profiles.filter((x) => x.name !== name);
    const keys = { ...get().keys };
    delete keys[name];
    set({ profiles, keys });
    persist(profiles, keys);
  },
  set: (patch) => {
    set(patch);
    const s = get();
    write(LS_OPTS, { everyMonths: s.everyMonths, startCash: s.startCash });
  },
}));

export function profileConfig(p: AiProfile, key?: string): AiProviderConfig {
  // The built-in demo players need no API — for trying a match with no key.
  if (p.kind === "mock") return { kind: "mock", script: mockPlayers[(p.model as MockStyle) || "yield"] ?? mockPlayers.yield };
  return {
    kind: p.kind, baseUrl: p.baseUrl || undefined, model: p.model || undefined, apiKey: key || undefined,
    browserDirect: p.browserDirect, jsonMode: p.jsonMode, timeoutMs: 60_000,
  };
}

/** Provider configs for every living AI firm in this game, linked by firm name. */
export function configsFor(game: GameState): Record<string, AiProviderConfig | undefined> {
  const { profiles, keys } = useAi.getState();
  const out: Record<string, AiProviderConfig | undefined> = {};
  for (const r of aiRivals(game)) {
    const p = profiles.find((x) => x.name === r.name);
    out[r.id] = p ? profileConfig(p, keys[p.name]) : undefined;
  }
  return out;
}

const hasAi = (g: GameState) => aiRivals(g).length > 0;

async function turn(g: GameState, parcels: ParcelTable): Promise<GameState> {
  useAi.setState({ busy: true });
  try {
    const names = Object.fromEntries(aiRivals(g).map((r) => [r.id, r.name]));
    return await runAiTurn(g, parcels, configsFor(g), {
      everyMonths: useAi.getState().everyMonths,
      fetchImpl: (...a) => fetch(...a),
      onTurn: (id, r) => useAi.setState((s) => ({
        last: { ...s.last, [names[id] ?? id]: { ok: r.ok, note: r.ok ? `${r.ms ?? "?"}ms` : r.error ?? "failed", at: Date.now() } },
      })),
    });
  } finally {
    useAi.setState({ busy: false });
  }
}

/**
 * RUN THE TURN THAT IS DUE, if one is — before the month is advanced. Returns
 * true when the store's game was replaced by the post-turn state. The store
 * is marked `advancing` while the providers are thinking, which is what makes
 * Continuous Play wait rather than race the network.
 */
export async function runDueAiTurn(): Promise<boolean> {
  const st = useStore.getState();
  const g = st.game, parcels = st.parcels;
  if (!g || !parcels || st.advancing || !aiTurnDue(g, useAi.getState().everyMonths)) return false;
  useStore.setState({ advancing: true });
  try {
    const next = await turn(g, parcels);
    if (useStore.getState().game !== g) return false;   // the player acted meanwhile
    useStore.setState({ game: next });
    return true;
  } finally {
    useStore.setState({ advancing: false });
  }
}

/** Is an AI turn due before the next month? */
export const aiDueNow = (g: GameState) => aiTurnDue(g, useAi.getState().everyMonths);

/**
 * A MULTI-MONTH ADVANCE WITH AI TURNS ON THE CADENCE. Same contract as
 * advanceUntilAttentionAsync; runs it in spans that end at each turn. A
 * spectator run ignores the player's stop reasons and a spectator's game over
 * (the principal's mortality) — nobody is at the desk.
 */
export async function advanceSpanWithAi(
  s: GameState, parcels: ParcelTable, bbls: string[], adjacency: Record<string, string[]> | null, cap: number,
): Promise<{ s: GameState; months: number; reason: string | null }> {
  if (!hasAi(s)) return advanceUntilAttentionAsync(s, parcels, bbls, adjacency, cap, 1);
  const every = Math.max(1, useAi.getState().everyMonths);
  let g = s, months = 0;
  while (months < cap) {
    if (aiTurnDue(g, every)) g = await turn(g, parcels);
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

/** Put this run's firms on the street — one per profile — optionally as a spectator. */
export function seedRunWithAi(g: GameState): GameState {
  const a = useAi.getState();
  let next = g;
  if (a.startWithAi && a.profiles.length) {
    next = createAiFirms(next, a.profiles.map((p) => ({ name: p.name, provider: p.kind, model: p.model })), a.startCash);
  }
  if (a.startSpectator) next = asSpectator(next);
  return next;
}

/** The player sits out: nothing of theirs interrupts the clock. */
export function asSpectator(g: GameState): GameState {
  return { ...g, spectator: true, brokersOff: true, brokerStops: "never", auctionQuiet: true };
}

/** Add one profile's firm to the live game. */
export function addFirmToGame(g: GameState, p: AiProfile, cash: number): GameState {
  return createAiFirms(g, [{ name: p.name, provider: p.kind, model: p.model }], cash);
}

/** Hand a scripted firm to a profile: the profile is copied under the firm's name so they link. */
export function convertFirm(g: GameState, firmId: string, p: AiProfile): GameState {
  const r = (g.rivals ?? []).find((x) => x.id === firmId);
  if (!r) return g;
  const a = useAi.getState();
  if (r.name !== p.name) a.saveProfile({ ...p, name: r.name }, a.keys[p.name]);
  return convertToAi(g, firmId, p.kind, p.model);
}

/**
 * TEST A PROFILE: a real brief from the live game (a hypothetical firm if the
 * profile has none yet), one real call, the parsed reply shown — nothing is
 * executed.
 */
export async function testProfile(p: AiProfile, key: string | undefined, g: GameState, parcels: ParcelTable): Promise<string> {
  let probe = g, id = aiRivals(g).find((r) => r.name === p.name)?.id;
  if (!id) { probe = createAiFirms(g, [{ name: `${p.name} (test)`, provider: p.kind }], useAi.getState().startCash); id = aiRivals(probe).at(-1)!.id; }
  const brief = aiBrief(probe, parcels, id);
  const r = await callProvider(profileConfig(p, key), brief, (...a) => fetch(...a));
  const n = r.reply.orders.length;
  return `Connected in ${r.ms}ms${r.usage?.input ? ` (${r.usage.input} in / ${r.usage.output ?? "?"} out tokens)` : ""}. `
    + `${n} order${n === 1 ? "" : "s"}: ${JSON.stringify(r.reply.orders).slice(0, 240)}. Reasoning: "${r.reply.reasoning.slice(0, 240)}"`;
}
