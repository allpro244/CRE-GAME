// THE BOOKS OF A FIRM RUN BY AN OUTSIDE AI.
//
// A street firm carries one cash number and one debt number and nobody keeps
// a journal of how they moved — that is fine for a scripted shop, and it is
// not fine for a firm whose every decision is somebody's API call being
// judged. So each money movement an AI firm's DECISION causes is written here
// with the two balance-sheet deltas it produced, measured on the firm itself
// (before and after), not restated from the arithmetic that caused it:
//
//   buy      cash −(equity + closing) (+ line draw),  debt +(loan + draw)
//            ⇒  Δcash − Δdebt  ==  −(price + closing)
//   sale     cash +(price − relief − tax),            debt −relief
//            ⇒  Δcash − Δdebt  ==  price − tax
//   refi     cash +x,  debt +x                        ⇒  Δcash − Δdebt == 0
//   paydown  cash −x,  debt −x                        ⇒  Δcash − Δdebt == 0
//   develop  cash −dayOne equity                      ⇒  Δcash − Δdebt == −equity
//
// test/ai-firms.mjs holds every entry to that identity to the dollar. This
// file imports nothing from the engine so rivals.ts and actions.ts can write
// to it without an import cycle.
import type { GameState, Rival } from "./types";

export type AiBookKind = "buy" | "sale" | "refi" | "paydown" | "develop" | "lost";

export interface AiBookEntry {
  m: number;
  kind: AiBookKind;
  bbl?: string;
  /** Headline consideration: price for a trade, principal for a refi/paydown, equity for a start. */
  amount: number;
  closing?: number;
  tax?: number;
  cashDelta: number;
  debtDelta: number;
  /** Counterparty or channel, for the deals feed. */
  with?: string;
}

export interface AiOrderResult {
  order: unknown;
  ok: boolean;
  reason: string;
}

export interface AiTurn {
  firmId: string;
  m: number;
  provider: string;
  reasoning: string;
  results: AiOrderResult[];
  /** Set when the call failed and the firm held. */
  error?: string;
}

const BOOK_CAP = 400;

/** Record one AI-firm money movement. No-op for a scripted firm. */
export function aiBook(
  s: GameState, r: Rival, e: Omit<AiBookEntry, "m"> & { m?: number },
): void {
  if (!r.aiControlled) return;
  const books = (s.aiBooks ??= {});
  const list = (books[r.id] ??= []);
  list.push({ ...e, m: e.m ?? s.month });
  if (list.length > BOOK_CAP) list.splice(0, list.length - BOOK_CAP);
}

/** Snapshot a firm's two balances, for a measured delta around a change. */
export const aiSnap = (r: Rival) => ({ cash: r.cash, debt: r.debt });
