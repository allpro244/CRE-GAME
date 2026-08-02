// The revolving line of credit: the facility that keeps a good portfolio from
// dying of a bad month. Sized at 35% of net worth, priced at the index plus
// 400bps, drawn and repaid at will — and drawn automatically before cash goes
// negative, because no real sponsor lets a rent cheque bounce while an
// undrawn line sits on the desk.
import type { ParcelTable } from "@/data/types";
import type { GameState } from "./types";
import { logBooks } from "./types";
import { netWorth } from "./value";
import { sponsorStanding } from "./sponsor";

/**
 * THE ADVANCE RATE, against net worth.
 *
 * 35% was conservative to the point of being decorative: the line existed to
 * stop a bad month killing a good book, and at a third of equity it could not
 * do the other thing a revolver is for — bridging an acquisition or a fit-out
 * while a sale closes. Sixty per cent of net worth is a real corporate
 * facility, and it is a genuine two-sided change: it is also sixty per cent of
 * net worth that the bank can call when values fall and your equity with them.
 * The over-advance path below is what makes that a decision rather than a gift.
 */
export const LOC_LTV = 0.60;      // against net worth
export const LOC_SPREAD = 4.0;    // prime + 400bps

export function locRate(s: GameState): number {
  return +(s.econ.indexRate + LOC_SPREAD).toFixed(2);
}

// The lender re-sizes the line off your net worth — which includes what you've
// already drawn, so borrowing doesn't inflate your own borrowing base.
/**
 * The line is not a constant. Banks size a revolver against your equity AND
 * against their own appetite, and their appetite disappears in exactly the
 * quarter you need the money. Cutting the advance rate with the credit cycle
 * is what turns a downturn from an inconvenience into a doom loop: values
 * fall, so equity falls, so the line falls twice over, so the over-advance
 * gets called, so you sell into the bid you least wanted to hit.
 *
 * This is the single most important thing a levered owner has to survive, and
 * without it the whole game had no way to lose.
 */
export function locLimit(s: GameState, parcels: ParcelTable): number {
  const nw = netWorth(s, parcels);
  const ci = s.econ.creditIdx ?? 1;
  // The revolver is the most relationship-dependent money on the balance
  // sheet, so it is the first thing a bank pulls when your name goes bad —
  // and it is pulled at exactly the moment the rest of the stack needs it.
  const st = sponsorStanding(s);
  const advance = LOC_LTV * Math.max(0.35, Math.min(1.15, ci)) * (1 - Math.min(0.6, 1.6 * st.advanceCut));
  return Math.max(0, Math.round(nw * advance));
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
    const st = sponsorStanding(next);
    return {
      s,
      err: `The line only has $${(avail / 1e6).toFixed(2)}M left.`
        + (st.mark > 0.3 ? ` The bank cut your advance rate — ${st.label}.` : " That's the bank's advance rate against your net worth."),
    };
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
    const stillOver = s.loc.balance - locLimit(s, parcels);
    if (stillOver > 1000) {
      // The bank does not accept "I'll pay you when a building sells." An
      // over-advance the borrower cannot clear in cash is a default on the
      // revolver, and it starts the insolvency clock like any other.
      s.locOverMs = (s.locOverMs ?? 0) + 1;
      s.news.unshift({
        q: s.month, kind: "warn",
        text: s.locOverMs >= 6
          ? `The line has been over-advanced for ${s.locOverMs} months. The bank wants $${(stillOver / 1e6).toFixed(2)}M back and has stopped asking politely.`
          : `The line is over-advanced — the bank wants $${(stillOver / 1e6).toFixed(2)}M back.`,
      });
      // after half a year the shortfall is treated as cash owed, which is what
      // pushes the run into the seizure path in sim.ts
      if (s.locOverMs >= 6) s.cash -= Math.round(stillOver * 0.25);
    } else s.locOverMs = 0;
  }
}
