// The revolving line of credit: the facility that keeps a good portfolio from
// dying of a bad month. Sized at 35% of net worth, priced at the index plus
// 400bps, drawn and repaid at will — and drawn automatically before cash goes
// negative, because no real sponsor lets a rent cheque bounce while an
// undrawn line sits on the desk.
import type { ParcelTable } from "@/data/types";
import type { GameState } from "./types";
import { logBooks } from "./types";
import { netWorth } from "./value";

export const LOC_LTV = 0.35;      // against net worth
export const LOC_SPREAD = 4.0;    // prime + 400bps

export function locRate(s: GameState): number {
  return +(s.econ.indexRate + LOC_SPREAD).toFixed(2);
}

// The lender re-sizes the line off your net worth — which includes what you've
// already drawn, so borrowing doesn't inflate your own borrowing base.
export function locLimit(s: GameState, parcels: ParcelTable): number {
  const nw = netWorth(s, parcels);
  return Math.max(0, Math.round(nw * LOC_LTV));
}

export function locAvailable(s: GameState, parcels: ParcelTable): number {
  return Math.max(0, locLimit(s, parcels) - (s.loc?.balance ?? 0));
}

export function drawLoc(s: GameState, parcels: ParcelTable, amount: number): { s: GameState; err?: string } {
  const next: GameState = JSON.parse(JSON.stringify(s));
  if (!next.loc) next.loc = { balance: 0, drawnTotal: 0, interestPaid: 0 };
  const avail = locAvailable(next, parcels);
  const amt = Math.round(amount);
  if (!Number.isFinite(amt) || amt <= 0) return { s, err: "Name an amount." };
  if (amt > avail) {
    return { s, err: `The line only has $${(avail / 1e6).toFixed(2)}M left against 35% of your net worth.` };
  }
  next.loc.balance += amt;
  next.loc.drawnTotal += amt;
  next.cash += amt;
  next.news.unshift({
    q: next.month, kind: "deal",
    text: `Drew $${(amt / 1e6).toFixed(2)}M on the line at ${locRate(next).toFixed(2)}%. Balance $${(next.loc.balance / 1e6).toFixed(2)}M.`,
  });
  return { s: next };
}

export function repayLoc(s: GameState, amount: number): { s: GameState; err?: string } {
  const next: GameState = JSON.parse(JSON.stringify(s));
  if (!next.loc?.balance) return { s, err: "Nothing drawn." };
  const amt = Math.min(Math.round(amount), next.loc.balance, Math.max(0, next.cash));
  if (amt <= 0) return { s, err: "No cash to pay it down with." };
  next.loc.balance -= amt;
  next.cash -= amt;
  next.news.unshift({
    q: next.month, kind: "info",
    text: `Paid $${(amt / 1e6).toFixed(2)}M down on the line. Balance $${(next.loc.balance / 1e6).toFixed(2)}M.`,
  });
  return { s: next };
}

// Monthly: accrue interest, sweep idle cash against the balance, and cover a
// shortfall automatically rather than letting the run die with credit unused.
export function tickLoc(s: GameState, parcels: ParcelTable) {
  if (!s.loc) s.loc = { balance: 0, drawnTotal: 0, interestPaid: 0 };
  const rate = locRate(s);

  if (s.loc.balance > 0) {
    const interest = Math.round((s.loc.balance * rate) / 100 / 12);
    s.cash -= interest;
    s.loc.interestPaid += interest;
    logBooks(s, "debtSvc", interest);
  }

  // a shortfall draws the line before it becomes insolvency
  if (s.cash < 0) {
    const need = Math.ceil(-s.cash);
    const avail = locAvailable(s, parcels);
    const draw = Math.min(need, avail);
    if (draw > 0) {
      s.loc.balance += draw;
      s.loc.drawnTotal += draw;
      s.cash += draw;
      s.news.unshift({
        q: s.month, kind: "warn",
        text: `Short $${(need / 1e6).toFixed(2)}M — the line covered $${(draw / 1e6).toFixed(2)}M at ${rate.toFixed(2)}%.`,
      });
    }
  } else if (s.loc.balance > 0 && s.cash > 250_000) {
    // idle cash pays the most expensive money down first
    const sweep = Math.min(s.loc.balance, Math.floor(s.cash - 250_000));
    if (sweep > 0) { s.loc.balance -= sweep; s.cash -= sweep; }
  }

  // a shrinking portfolio can put you over the line; the lender wants it back
  const over = s.loc.balance - locLimit(s, parcels);
  if (over > 0) {
    const pay = Math.min(over, Math.max(0, s.cash));
    if (pay > 0) { s.loc.balance -= pay; s.cash -= pay; }
    if (s.loc.balance > locLimit(s, parcels) + 1000) {
      s.news.unshift({
        q: s.month, kind: "warn",
        text: `The line is over-advanced — the bank wants $${((s.loc.balance - locLimit(s, parcels)) / 1e6).toFixed(2)}M back.`,
      });
    }
  }
}
