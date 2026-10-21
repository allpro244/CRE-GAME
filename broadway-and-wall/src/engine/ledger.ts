// THE MORTGAGE RECORD — every loan in this town, written against a deed.
//
// The banks had balance sheets and the balance sheets had no insides. A
// lender carried `book: $3.4B` and `delinquent: 2.9%` and not one loan you
// could point at — so "open its books and see it coming" meant reading two
// aggregates, the note desk conjured a face value out of thin air the month
// it decided to sell, and the player asking "which properties has this bank
// lent against?" had no answer anywhere in the state.
//
// This is the answer. Every rival-owned building carrying debt gets a row on
// the public record: whose loan it is, which desk wrote it, the balance, the
// coupon, the maturity, and what the building appraised for the day it was
// written — which is the number that makes "LTV then vs. LTV now" a readable
// fact instead of a vibe. The player's own loans and the construction book
// already exist on Holding/Development; together the three are a full
// statement for every desk in town.
//
// THE ROWS ARE THE LOANS. They used to be a projection of one aggregate
// `Rival.debt`, spread across a firm's deeds by value every month, with a
// hashed desk, a hashed balloon and the borrower's squeeze copied onto every
// row. Now a firm's mortgages are originated by the desk that wrote them, at
// that desk's coupon and term, and `Rival.debt` is their sum plus the line and
// the construction balances (rivalDebt.ts). Status comes off each loan's own
// payments (rivalDebt.markPayments), so one bad building can default without
// cross-defaulting the book.
//
// IT IS NO LONGER DECORATION. The desks' books are counted off this record
// (loanbook.ts): a row's balance is on its lender's balance sheet, a row in
// workout is on its lender's delinquency line, and a firm's failure is
// charged to the desks its rows name. Every row is placed under the two
// limits a real desk lends under — one borrower's share of the book, and the
// capital to carry a bigger one (rivalDebt.deskRoom).
import type { ParcelTable } from "@/data/types";
import type { GameState, Rival } from "./types";
import { cityLoanBook, deskTotals } from "./loanbook";
import { addToLine, jobDebtOf, payDown, syncDebt, termDebtOf } from "./rivalDebt";

/** Who holds this deed's paper when it has left the banks — you, or a firm on the street. */
function paperHeldBy(s: GameState, bbl: string): string | undefined {
  if (s.notes?.some((n) => n.bbl === bbl)) return "player";
  return (s.rivalNotes ?? []).find((x) => x.bbl === bbl)?.firmId;
}

/**
 * WHAT DID NOT GO THROUGH THE LOANS. Every path that changes a firm's debt
 * moves a row, the line or a job (rivalDebt.ts), and r.debt is re-summed from
 * them. A path that still wrote r.debt directly would leave the two
 * disagreeing; the difference is booked to the line (more owed) or paid down
 * (less), and counted here so a test can hold the count at zero.
 */
export const debtDrift = { n: 0, abs: 0 };

/** One month of keeping the record true. Runs after the street, before the note desk. */
export function tickLedger(s: GameState, parcels: ParcelTable) {
  if (!s.cityLoans) s.cityLoans = {};
  const led = s.cityLoans;
  const owner: Record<string, Rival> = {};
  for (const r of s.rivals ?? []) if (r.failedM === undefined) for (const b of r.bbls) owner[b] = r;

  // A deed that changed hands or a borrower that died comes off the record —
  // every settlement path retires its row as it goes; this is the backstop.
  // Paper that left the banks for the note market stays: it is still owed.
  for (const bbl of Object.keys(led)) {
    const x = led[bbl];
    const o = owner[bbl];
    if (!o || o.id !== x.obligorId) { delete led[bbl]; continue; }
    const held = paperHeldBy(s, bbl);
    if (held) x.heldBy = held; else delete x.heldBy;
  }

  for (const r of s.rivals ?? []) {
    if (r.failedM !== undefined) continue;
    const before = r.debt;
    const term = termDebtOf(s, r), jobs = jobDebtOf(s, r);
    const drift = Math.round(before - (term + (r.lineBal ?? 0) + jobs));
    if (Math.abs(drift) > 1) {
      debtDrift.n++; debtDrift.abs += Math.abs(drift);
      if (drift > 0) addToLine(s, r, drift);
      else payDown(s, r, -drift);
      syncDebt(s, r);
    } else {
      // Nothing moved since the two sums above: this is syncDebt without the rescan.
      r.debt = Math.round(term + (r.lineBal ?? 0) + jobs);
    }
  }

  // WHAT EACH DESK IS HOLDING IN THIS TOWN, BY CLASS — the number the quote
  // desk checks before it adds another office loan to an office book. Yours,
  // the street's, and the construction paper, counted the same way.
  // Read off the one loan book every other desk test reads, so the class
  // test and the single-name test cannot count different loans. (The street's
  // construction jobs were missing from this sum; the facility and the line
  // carry no single class and stay out of it.)
  const by = deskTotals(cityLoanBook(s, parcels));
  for (const l of s.lenders ?? []) {
    l.classBook = {};
    for (const [k, v] of Object.entries(by[l.name]?.byClass ?? {})) if (v > 0) l.classBook[k] = Math.round(v);
  }
}
