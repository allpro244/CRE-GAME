import { useEffect } from "react";
import { useStore } from "@/state/store";
import type { GameState } from "@/engine/types";
import { START_YEAR } from "@/engine/types";
import { cityList, cityName } from "@/citygen/index.mjs";
import { goalDef } from "@/engine/goals";

/**
 * YOUR RUNS, KEPT ACROSS RUNS. A hundred-year town has no win screen and a
 * run rarely ends, so nothing ever said how this one compared with the last.
 * Each December close (and the run ending) writes the run's standing numbers
 * here — the same year marks the year card reads, keyed by the run's seed —
 * and the start screen lists the best of them. localStorage, not the save:
 * this is the player's record, not the firm's.
 */
export interface RunRecord {
  seed: number;
  town: string;
  years: number;
  nw: number;
  peakNw: number;
  bestRank: number | null;
  of: number | null;
  bestYear: number | null;
  over: boolean;
  updatedAt: number;
  /** The goal chosen at the start, and how it went. */
  goal?: string;
  goalResult?: "met" | "missed" | "open";
}

const KEY = "bw:runs";
const KEEP = 12;

export function loadRuns(): RunRecord[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? (v as RunRecord[]) : [];
  } catch { return []; }
}

function townOf(g: GameState): string {
  const island = g.cityIsland ?? "";
  const named = g.citySeed !== undefined ? cityName(island, g.citySeed) : "";
  return named || cityList().find((c) => c.id === island)?.name || "The town";
}

export function recordRun(g: GameState) {
  const marks = (g.yearMarks ?? []).filter((m) => m.y >= 0);
  const best = marks.length ? marks.reduce((a, m) => (m.rank < a.rank ? m : a), marks[0]) : null;
  const rec: RunRecord = {
    seed: g.seed,
    town: townOf(g),
    years: Math.floor(g.month / 12),
    nw: g.nwHistory.at(-1) ?? 0,
    peakNw: Math.max(...g.nwHistory),
    bestRank: best?.rank ?? null,
    of: best?.of ?? null,
    bestYear: best ? START_YEAR + best.y : null,
    over: !!g.gameOver,
    updatedAt: Date.now(),
    ...(g.goal ? { goal: goalDef(g.goal.id).label, goalResult: g.goal.doneM !== undefined ? "met" as const : g.goal.failedM !== undefined ? "missed" as const : "open" as const } : {}),
  };
  const all = loadRuns().filter((r) => r.seed !== rec.seed);
  all.push(rec);
  all.sort((a, b) => b.peakNw - a.peakNw);
  try { localStorage.setItem(KEY, JSON.stringify(all.slice(0, KEEP))); } catch { /* private mode */ }
}

/** Writes the record at each year close and at game over. Renders nothing. */
export default function RunRecorder() {
  useEffect(() => useStore.subscribe((s, p) => {
    if (!s.game) return;
    const yearClosed = s.yearReviewY !== null && s.yearReviewY !== p.yearReviewY;
    const ended = !!s.game.gameOver && !p.game?.gameOver;
    const goalDecided = s.goalCard !== null && s.goalCard !== p.goalCard;
    if (yearClosed || ended || goalDecided) recordRun(s.game);
  }), []);
  return null;
}
