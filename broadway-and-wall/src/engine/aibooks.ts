// THE BOOKS OF A JEV-RUN FIRM.
//
// A street firm carries one cash number and one debt number and nobody keeps a
// journal of how they moved — fine for a scripted shop, not fine for a firm
// whose decisions are being judged against the scripted ones. So every money
// movement on a Jev-run firm's deal line — a purchase, a sale, a cash-out, a
// groundbreak — is written here with the two balance-sheet deltas it produced,
// MEASURED on the firm (before and after), not restated from the arithmetic
// that caused it:
//
//   buy      Δcash − Δdebt  ==  −(price + closing)
//   sale     Δcash − Δdebt  ==  price − tax
//   refi     Δcash − Δdebt  ==  0          (cash in, debt up by the same)
//   develop  Δcash − Δdebt  ==  −equity    (day-one equity; the loan follows the job)
//
// test/jev.mjs holds every entry to its identity to the dollar. This file
// imports nothing from the engine so rivals.ts and actions.ts can write to it
// without an import cycle. Scripted firms write nothing (the function no-ops).
import type { GameState, Rival } from "./types";

export type FirmBookKind = "buy" | "sale" | "refi" | "develop";

export interface FirmBookEntry {
  m: number;
  kind: FirmBookKind;
  bbl?: string;
  /** Headline consideration: price for a trade, principal for a refi, equity for a start. */
  amount: number;
  closing?: number;
  tax?: number;
  cashDelta: number;
  debtDelta: number;
  /**
   * Money that moved between the firm and a job's deal investors in the same
   * event: + their equity in at a groundbreak, − their share of a sale. The
   * identities above hold on Δcash − Δdebt − partners.
   */
  partners?: number;
  /** Counterparty or channel. */
  with?: string;
  /** Whether Jev's answer drove it ("jev") or the firm's scripted rule ("script"). */
  by?: "jev" | "script";
}

const BOOK_CAP = 400;

/** Record one money movement of a Jev-run firm. No-op for any other firm. */
export function firmBook(s: GameState, r: Rival, e: Omit<FirmBookEntry, "m">): void {
  if (!r.jev) return;
  const books = (s.jevBooks ??= {});
  const list = (books[r.id] ??= []);
  list.push({ ...e, m: s.month });
  if (list.length > BOOK_CAP) list.splice(0, list.length - BOOK_CAP);
}

/** Snapshot a firm's two balances, for a measured delta around a change. */
export const snap = (r: Rival) => ({ cash: r.cash, debt: r.debt });
