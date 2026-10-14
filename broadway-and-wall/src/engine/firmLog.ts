// WHAT EACH FIRM DID, IN ORDER — the street's diary.
//
// The news carries the moves that are about you; this carries all of them,
// per firm, so a firm's page can show its last few years as a timeline and
// the Players page can show what the whole street did this month. Display
// only: nothing reads it back into a decision. Capped, oldest out first.
import type { GameState, Rival } from "./types";

export type FirmMove = "buy" | "sell" | "build" | "open" | "plan" | "event";
export interface FirmLogEntry { m: number; firmId: string; kind: FirmMove; text: string; bbl?: string; px?: number }

const CAP = 600;

export function logFirm(s: GameState, r: Rival | undefined, kind: FirmMove, text: string, bbl?: string, px?: number) {
  if (!r) return;
  const log = (s.firmLog ??= []);
  log.push({ m: s.month, firmId: r.id, kind, text, ...(bbl ? { bbl } : {}), ...(px ? { px: Math.round(px) } : {}) });
  if (log.length > CAP) log.splice(0, log.length - CAP);
}

/** A firm's moves, newest first. */
export function movesOf(s: GameState, id: string, n = 12): FirmLogEntry[] {
  const out: FirmLogEntry[] = [];
  const log = s.firmLog ?? [];
  for (let i = log.length - 1; i >= 0 && out.length < n; i--) if (log[i].firmId === id) out.push(log[i]);
  return out;
}

/** The whole street's moves since `fromM`, newest first. */
export function streetMoves(s: GameState, fromM: number, n = 10): FirmLogEntry[] {
  const out: FirmLogEntry[] = [];
  const log = s.firmLog ?? [];
  for (let i = log.length - 1; i >= 0 && out.length < n; i--) {
    if (log[i].m < fromM) break;
    out.push(log[i]);
  }
  return out;
}


/**
 * A LINE IN THE FIRM'S CAREER (2026-10-14). The move log above is capped
 * across the whole street, so a firm's early years scroll off; the career is
 * the handful of moments that make its story — founded, its peaks, the year
 * it fell behind, the buildings it lost, who it swallowed or was swallowed
 * by, the end — kept per firm. Display only.
 */
export function milestone(s: GameState, r: Rival | undefined, text: string) {
  if (!r) return;
  const c = (r.career ??= []);
  c.push({ m: s.month, text });
  if (c.length > 40) c.splice(1, 1);
}
