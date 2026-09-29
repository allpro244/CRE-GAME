// WHICH FIRMS JEV RUNS, AND HOW THEY ARE DOING.
//
// `setJevFirms` hands firms on the street to Jev (each keeps its style and its
// scripted rules as the fallback; Jev informs its judgement). `jevStandings`
// and `stampJevHistory` feed the match leaderboard. Pure; no RNG.
import type { ParcelTable } from "@/data/types";
import type { GameState } from "./types";
import { cloneState } from "./types";
import { livingRivals, markRival, jevRivals } from "./rivals";
import { rivalEquity } from "./standing";
import { jevState } from "./jev";
import { charterForStyle, DEFAULT_THRESHOLDS, type CharterId, type JevThresholds } from "../ai/jevQuestions";

export interface JevSetup {
  /** Firm ids to hand to Jev, each with an optional charter (default: the firm's style). */
  firms: { id: string; charter?: CharterId; name?: string }[];
  every?: number;
  thresholds?: Partial<JevThresholds>;
}

/**
 * Hand firms to Jev. Firms not listed stop being Jev-run. A renamed firm keeps
 * its id (the name is the player's label for it). Returns a new state.
 */
export function setJevFirms(s0: GameState, setup: JevSetup): GameState {
  const s = cloneState(s0);
  const want = new Map(setup.firms.map((f) => [f.id, f]));
  for (const r of s.rivals ?? []) {
    const f = want.get(r.id);
    if (!f || r.failedM !== undefined) { if (r.jev) delete r.jev; continue; }
    r.jev = { charter: f.charter ?? r.jev?.charter ?? charterForStyle(r.style), sinceM: r.jev?.sinceM ?? s.month };
    if (f.name && f.name.trim()) r.name = f.name.trim().slice(0, 48);
  }
  if (setup.firms.length) {
    const st = jevState(s);
    if (setup.every) st.every = Math.max(1, Math.round(setup.every));
    st.thresholds = { ...DEFAULT_THRESHOLDS, ...st.thresholds, ...(setup.thresholds ?? {}) };
  }
  return s;
}

/**
 * The N firms Jev runs by default: the largest living books, so the firms
 * Jev runs are ones that trade. Deterministic (ties by id).
 */
export function defaultJevFirms(s: GameState, parcels: ParcelTable, n: number): string[] {
  return livingRivals(s)
    .map((r) => ({ id: r.id, v: markRival(s, parcels, r).aum }))
    .sort((a, b) => b.v - a.v || (a.id < b.id ? -1 : 1))
    .slice(0, Math.max(0, n)).map((x) => x.id);
}

export interface JevStanding {
  id: string; name: string; charter: CharterId; style: string; jev: boolean;
  equity: number; distributed: number; cash: number; debt: number; assets: number; buildings: number;
  failedM?: number;
}

/** Every firm on the street, Jev-run first, marked the way the street is marked. */
export function jevStandings(s: GameState, parcels: ParcelTable): JevStanding[] {
  return (s.rivals ?? []).map((r) => {
    const mk = markRival(s, parcels, r);
    return {
      id: r.id, name: r.name, charter: r.jev?.charter ?? charterForStyle(r.style), style: r.style, jev: !!r.jev,
      equity: Math.round(r.failedM !== undefined ? 0 : rivalEquity(mk, r)), distributed: Math.round(r.distributed ?? 0),
      cash: Math.round(r.cash), debt: Math.round(r.debt), assets: Math.round(mk.aum), buildings: r.bbls.length,
      failedM: r.failedM,
    };
  }).sort((a, b) => Number(b.jev) - Number(a.jev) || b.equity - a.equity);
}

/** File this period's equity marks for Jev-run firms. Returns a new state (or the same one without Jev). */
export function stampJevHistory(s0: GameState, parcels: ParcelTable): GameState {
  const firms = jevRivals(s0);
  if (!firms.length || (s0.jevHistory ?? []).some((h) => h.m === s0.month)) return s0;
  const eq: Record<string, number> = {};
  for (const r of firms) eq[r.id] = Math.round(rivalEquity(markRival(s0, parcels, r), r));
  return { ...s0, jevHistory: [...(s0.jevHistory ?? []), { m: s0.month, eq }].slice(-800) };
}
