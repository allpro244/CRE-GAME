// A COMPETITOR'S DEBT, LOAN BY LOAN.
//
// A firm on this street used to carry one number, `Rival.debt`, and the
// mortgage record (ledger.ts) was a projection of it: every month the number
// was spread across the firm's financed deeds by appraised value, every row
// took the firm's status, and the desk on each row was a hashed guess. So a
// sale retired "the firm's leverage times the price" rather than the loan on
// the building, a balloon was a hashed date rather than a term somebody
// agreed, one firm's squeeze defaulted every loan it had at once, and the
// revolver was a lifetime tally of draws with no balance to repay.
//
// Now the loans are the truth and the number is their sum (BANKING.md,
// "Handoff to the rivals revamp"):
//
//   r.debt = Σ rows on s.cityLoans (one first mortgage per deed)
//          + r.lineBal (the corporate revolver, at the firm's bank)
//          + Σ construction balances on its live jobs (s.cityJobs)
//
// A ROW IS ORIGINATED BY THE DESK THAT WROTE IT. The amount is sized where it
// always was (`streetRefiProceeds` / `acquisitionLoan`); the desk is the
// cheapest one in town that will write that amount on that building today —
// `quote(..., street = true)`, the same sheet the player is quoted off — and
// that has room for it under the two rules `placeLoan` enforces: one
// borrower's share of the book (`singleNameCap`) and the capital to carry a
// bigger book (`capital / targetCapital − book`). Its coupon and its balloon
// are that desk's.
//
// THE LINE is an outstanding balance at one named bank, priced like the
// player's: `deskRatePct(shortIndex, LOC_SPREAD, { ci, app })`. A sale pays
// the mortgage on the building at the closing table and then the line out of
// what is left, because a revolver's borrowing base just lost a building.
//
// Nothing here draws on the RNG stream.
import type { CityLoan, GameState, Rival } from "./types";
import { productById, quote, REFI_FEE, singleNameCap, windowOpen, CAP_TERM_M, type StabView } from "./debt";
import { capPremiumOn } from "./amortize";
import { targetCapital } from "./lenders";
import type { Lender } from "./lenders";
import { LOC_SPREAD } from "./credit";
import { deskRatePct } from "./pricing";
import { shortIndexOf } from "./market";

/** Deterministic 0..1 from a string. */
function hash01(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}

/**
 * WHAT ITS FILE DOES TO ITS COUPON (quirks). A firm known for paying late is
 * priced as the risk it is — half a point wider. A firm that has banked with
 * one desk for decades gets the relationship price, fifteen basis points
 * inside: the Access a long file buys (ATTR_CONTRACT.md), not a gift.
 */
export function fileSpreadAdj(r: Rival): number {
  return (r.quirks?.includes("latePayer") ? 0.5 : 0) - (r.quirks?.includes("loyalBank") ? 0.15 : 0);
}

// ------------------------------------------------------------------ reading

/**
 * THE RECORD BY BORROWER. Every firm's service, amortisation, payment status
 * and debt total reads its own rows, and the record is keyed by BBL — numeric
 * keys, which every walk has to collect and sort — so a walk per firm per
 * reader was a tenth of the month. The index is the walk done once: each
 * firm's rows in record order, rebuilt whenever the record is a different
 * object or anything has put a row on it, taken one off or moved one to
 * another borrower. Every such write in the engine calls `loanBookTouched()`;
 * and as a backstop for any writer that does not (a harness deleting a row),
 * a firm's rows are checked on every read — each still on the record under
 * its key and still this firm's — and any miss rebuilds. (Balances, rates and
 * statuses are read off the rows themselves and need no bump.)
 */
let LOAN_REV = 0;
export function loanBookTouched(): void { LOAN_REV++; }
type LoanIx = { book: Record<string, CityLoan>; rev: number; by: Map<string, { keys: string[]; rows: CityLoan[] }> };
let LOAN_IX: LoanIx | null = null;
function buildLoanIx(L: Record<string, CityLoan>): LoanIx {
  const by: LoanIx["by"] = new Map();
  for (const k in L) {
    const x = L[k];
    const e = by.get(x.obligorId);
    if (e) { e.keys.push(k); e.rows.push(x); } else by.set(x.obligorId, { keys: [k], rows: [x] });
  }
  return { book: L, rev: LOAN_REV, by };
}
/** An array-index key: for..in walks these first, in ascending numeric order. */
const isIndexKey = (k: string) => /^(?:0|[1-9][0-9]*)$/.test(k) && Number(k) <= 4294967294;
/**
 * PUT A ROW ON THE RECORD, keeping the index current where that is the same
 * as rebuilding it: a NEW numeric key (every BBL is one) sits among the
 * numeric keys in ascending order, ahead of every other key, so it goes into
 * its borrower's list at exactly that place. Anything else — a key already on
 * the record, a non-numeric key, an index that was not current — just bumps.
 */
function loanPut(L: Record<string, CityLoan>, key: string, row: CityLoan): void {
  const ix = LOAN_IX;
  const current = !!ix && ix.book === L && ix.rev === LOAN_REV;
  const existed = Object.prototype.hasOwnProperty.call(L, key);
  L[key] = row;
  if (!current || existed || !isIndexKey(key)) { loanBookTouched(); return; }
  const n = Number(key);
  const e = ix!.by.get(row.obligorId);
  if (!e) { ix!.by.set(row.obligorId, { keys: [key], rows: [row] }); return; }
  let i = 0;
  while (i < e.keys.length && isIndexKey(e.keys[i]) && Number(e.keys[i]) < n) i++;
  e.keys.splice(i, 0, key);
  e.rows.splice(i, 0, row);
}

/** This firm's rows in record order, off the index; null when the record is empty or absent. */
function obligorRows(s: GameState, id: string): CityLoan[] | null {
  const L = s.cityLoans;
  if (!L) return null;
  let ix = LOAN_IX;
  if (!ix || ix.book !== L || ix.rev !== LOAN_REV) ix = LOAN_IX = buildLoanIx(L);
  let e = ix.by.get(id);
  if (e) {
    for (let i = 0; i < e.rows.length; i++) {
      const x = e.rows[i];
      if (L[e.keys[i]] !== x || x.obligorId !== id) { ix = LOAN_IX = buildLoanIx(L); e = ix.by.get(id); break; }
    }
  }
  return e ? e.rows : null;
}

/** This firm's mortgages on the record, in record order (a fresh array the caller may sort). */
export function rowsOf(s: GameState, r: Rival): CityLoan[] {
  const rows = obligorRows(s, r.id);
  return rows ? rows.slice() : [];
}
/** The mortgage on one of this firm's deeds, if it has one. */
export function rowOn(s: GameState, r: Rival, bbl: string): CityLoan | undefined {
  const x = s.cityLoans?.[bbl];
  return x && x.obligorId === r.id ? x : undefined;
}
export function termDebtOf(s: GameState, r: Rival): number {
  let t = 0;
  const rows = obligorRows(s, r.id);
  if (rows) for (const x of rows) t += x.balance;
  return t;
}
export function jobDebtOf(s: GameState, r: Rival): number {
  let t = 0;
  for (const j of s.cityJobs ?? []) if (j.firmId === r.id) t += j.debt ?? 0;
  return t;
}
/** r.debt is the sum of what the firm actually owes. Call after any change to a row, the line, or a job. */
export function syncDebt(s: GameState, r: Rival) {
  r.debt = Math.round(termDebtOf(s, r) + (r.lineBal ?? 0) + jobDebtOf(s, r));
}

// ------------------------------------------------------------------ the desks

/**
 * HOW MUCH MORE THIS DESK WILL LEND THIS BORROWER — `placeLoan`'s two rules.
 * The single-name limit counts every named loan the desk holds against the
 * firm (its mortgages and its line); headroom is the book the desk's capital
 * carries at its own target, less the book it has. The opening record is
 * the exception `placeLoan` always made: those mortgages already exist inside
 * the stated books the city opened with, so a desk's named street paper only
 * has to stay within three quarters of that book.
 */
/** Some live desk would take `amount` more against this name. */
export function deskWithRoom(s: GameState, obligorId: string, amount: number): boolean {
  // `deskRoom` for every live desk off ONE pass over the record: each desk's
  // totals accumulate in the same order, so each is the number deskRoom gives.
  const lenders = s.lenders ?? [];
  const acc = new Map<string, { onDesk: number; exposure: number }>();
  for (const l of lenders) if (l.failedM === undefined && !acc.has(l.name)) acc.set(l.name, { onDesk: 0, exposure: 0 });
  if (!acc.size) return false;
  const L = s.cityLoans;
  if (L) for (const k in L) {
    const x = L[k];
    if (x.heldBy) continue;
    const a = acc.get(x.lender);
    if (!a) continue;
    a.onDesk += x.balance;
    if (x.obligorId === obligorId) a.exposure += x.balance;
  }
  for (const r of s.rivals ?? []) {
    if ((r.lineBal ?? 0) > 0) {
      const a = r.lineBank === undefined ? undefined : acc.get(r.lineBank);
      if (!a) continue;
      a.onDesk += r.lineBal!;
      if (r.id === obligorId) a.exposure += r.lineBal!;
    }
  }
  for (const l of lenders) {
    if (l.failedM !== undefined) continue;
    const a = acc.get(l.name)!;
    const nameRoom = l.book * singleNameCap(l.kind) - a.exposure;
    const room = l.capital / Math.max(0.01, targetCapital(l.name)) - l.book;
    if (Math.min(nameRoom, room) >= amount) return true;
  }
  return false;
}

export function deskRoom(s: GameState, l: Lender, obligorId: string, opening = false): number {
  if (l.failedM !== undefined) return 0;
  let exposure = 0, onDesk = 0;
  const L = s.cityLoans;
  if (L) for (const k in L) {
    const x = L[k];
    if (x.lender !== l.name || x.heldBy) continue;
    onDesk += x.balance;
    if (x.obligorId === obligorId) exposure += x.balance;
  }
  for (const r of s.rivals ?? []) {
    if (r.lineBank === l.name && (r.lineBal ?? 0) > 0) {
      onDesk += r.lineBal!;
      if (r.id === obligorId) exposure += r.lineBal!;
    }
  }
  const nameRoom = l.book * singleNameCap(l.kind) - exposure;
  const room = opening
    ? l.book * 0.75 - onDesk
    : l.capital / Math.max(0.01, targetCapital(l.name)) - l.book;
  return Math.min(nameRoom, room);
}

/** `deskRoom(s, l, obligorId, opening)` for every desk in `s.lenders`, off one walk of the record. */
function deskRooms(s: GameState, obligorId: string, opening: boolean): Map<Lender, number> {
  const acc = new Map<string, { onDesk: number; exposure: number }>();
  for (const l of s.lenders ?? []) if (!acc.has(l.name)) acc.set(l.name, { onDesk: 0, exposure: 0 });
  const L = s.cityLoans;
  if (L) for (const k in L) {
    const x = L[k];
    if (x.heldBy) continue;
    const a = acc.get(x.lender);
    if (!a) continue;
    a.onDesk += x.balance;
    if (x.obligorId === obligorId) a.exposure += x.balance;
  }
  for (const r of s.rivals ?? []) {
    if ((r.lineBal ?? 0) > 0) {
      const a = r.lineBank === undefined ? undefined : acc.get(r.lineBank);
      if (!a) continue;
      a.onDesk += r.lineBal!;
      if (r.id === obligorId) a.exposure += r.lineBal!;
    }
  }
  const out = new Map<Lender, number>();
  for (const l of s.lenders ?? []) {
    if (l.failedM !== undefined) { out.set(l, 0); continue; }
    const a = acc.get(l.name)!;
    const nameRoom = l.book * singleNameCap(l.kind) - a.exposure;
    const room = opening
      ? l.book * 0.75 - a.onDesk
      : l.capital / Math.max(0.01, targetCapital(l.name)) - l.book;
    out.set(l, Math.min(nameRoom, room));
  }
  return out;
}

/** The sheets a firm on this street calls for a mortgage, by what the collateral is. */
function sheetsFor(noiYr: number): string[] {
  // The ladder the player's balloon walks (debt.ts balloonLadder).
  return noiYr > 0 ? ["pelican", "ashford", "agencyFixed", "conduit", "bowline", "savings25", "savings", "harbor", "cordage"] : ["land", "tideLand"];
}

export interface Origination { lender: string; ratePct: number; termM: number; product: string }

/**
 * WHO WRITES THIS LOAN. Every desk whose sheet is open and whose quote would
 * fund `amount` against this building, cheapest coupon first, among those
 * with room for this borrower. If nobody quotes the full amount (the amount
 * was sized at the street's own covenant and a desk with room sizes tighter),
 * the desk that quotes the most writes it. If no desk has room for it, it goes
 * to whichever has the most — a syndicate, which is what `placeLoan` did.
 */
export function pickDesk(
  s: GameState, obligorId: string, amount: number, value: number, noiYr: number,
  o: { klass?: string; stab?: StabView; condition?: string; opening?: boolean; seed?: string } = {},
): Origination {
  type C = Origination & { principal: number; room: number };
  const cands: C[] = [];
  // Every desk's `deskRoom` off one walk of the record, worked out the first
  // time one is asked for: nothing below writes a loan, a line or a book.
  let rooms: Map<Lender, number> | null = null;
  const roomOf = (l: Lender) => (rooms ??= deskRooms(s, obligorId, o.opening ?? false)).get(l) ?? deskRoom(s, l, obligorId, o.opening);
  for (const id of sheetsFor(noiYr)) {
    const p = productById(id);
    if (!p || !windowOpen(s, p)) continue;
    const l = (s.lenders ?? []).find((x) => x.name === p.lender);
    if (!l || l.failedM !== undefined) continue;
    const q = quote(s, p, value, Math.max(0, noiYr), o.klass, true, p.bridge ? o.stab : undefined, o.condition);
    if (!(q.principal > 0)) continue;
    cands.push({ lender: p.lender, ratePct: q.ratePct, termM: p.termM, product: p.id, principal: q.principal, room: roomOf(l) });
  }
  const funds = cands.filter((c) => c.principal >= amount * 0.98 && c.room >= amount)
    .sort((a, b) => a.ratePct - b.ratePct);
  if (funds.length) return funds[0];
  const roomy = cands.filter((c) => c.room >= amount).sort((a, b) => b.principal - a.principal);
  if (roomy.length) return roomy[0];
  if (cands.length) return cands.sort((a, b) => b.room - a.room)[0];
  // EVERY WINDOW SHUT. Paper that exists anyway (an opening mortgage, a
  // construction takeout already committed) sits with the desk with the most
  // room, at the street's coupon for that desk's benchmark.
  const live = (s.lenders ?? []).filter((l) => l.failedM === undefined && l.kind !== "fund");
  const best = live.sort((a, b) => roomOf(b) - roomOf(a))[0];
  const fallback = noiYr > 0 ? productById("harbor") : productById("land");
  return {
    lender: best?.name ?? fallback.lender,
    ratePct: +deskRatePct(s.econ.indexRate, 2.2, { ci: s.econ.creditIdx ?? 1, app: best?.appetite ?? 1 }).toFixed(2),
    termM: fallback.termM, product: fallback.id,
  };
}

/**
 * A MORTGAGE ON THIS DEED. A deed carries one first mortgage: borrowing more
 * against a building that already has one is a refinancing — the old loan is
 * taken out, and the whole balance goes onto the new desk's paper at today's
 * coupon and a fresh term. `backdate` places an opening loan part-way through
 * its term, because the town did not take out all its mortgages the day you
 * arrived.
 */
export function originateRow(
  s: GameState, r: Rival, bbl: string, amount: number, value: number, noiYr: number,
  o: { klass?: string; stab?: StabView; condition?: string; opening?: boolean; backdate?: boolean } = {},
): CityLoan | null {
  amount = Math.round(amount);
  if (!(amount > 0)) return null;
  if (!s.cityLoans) s.cityLoans = {};
  const old = s.cityLoans[bbl];
  const prior = old && old.obligorId === r.id ? old.balance : 0;
  const total = prior + amount;
  const d = pickDesk(s, r.id, total, Math.max(value, total), noiYr, o);
  const originM = o.backdate ? s.month - Math.round(hash01(bbl + ":" + r.id) * Math.max(1, d.termM - 6)) : s.month;
  const row: CityLoan = {
    bbl, lender: d.lender, obligorId: r.id, balance: total,
    ratePct: +d.ratePct.toFixed(2), originM, maturityM: originM + d.termM,
    origValue: Math.round(Math.max(value, 1)), klass: o.klass ?? old?.klass ?? "land",
    status: "current", product: d.product,
  };
  // A floater is written at the short index plus the desk's margin, with a
  // cap bought at the table (debt.ts originate: struck a point over today's
  // index, for the loan's term or three years, whichever is shorter).
  if (productById(d.product ?? "harbor")?.floating) {
    const idx = shortIndexOf(s.econ);
    row.spread = +(row.ratePct - idx).toFixed(2);
    row.cap = { strike: +(idx + 1.0).toFixed(2), expiresM: originM + Math.min(d.termM, CAP_TERM_M) };
  }
  loanPut(s.cityLoans, bbl, row);
  syncDebt(s, r);
  return row;
}

/**
 * WHAT A STREET LOAN COSTS AT THE TABLE, the player's own closing costs: the
 * desk's points on what is borrowed, the rate cap no desk writes a floater
 * without, and on a refinance the 1% fee on the whole new balance. Rivals'
 * acquisitions and cash-outs used to close free while the player paid all of
 * it on the same desks (renewRow already charged it).
 */
export function streetLoanCost(row: CityLoan, borrowed: number, refiBalance = 0): number {
  const p = productById(row.product ?? "harbor");
  const base = Math.max(borrowed, refiBalance);
  return Math.round(borrowed * (p?.points ?? 0) + refiBalance * REFI_FEE) + (p?.floating ? capPremiumOn(base) : 0);
}

/**
 * A BALLOON RENEWED. The outstanding balance goes onto whichever desk clears
 * it cheapest today — the way the player's balloon rolls (balloonLadder) —
 * at today's coupon and a fresh term, and the borrower pays what a renewal
 * costs at the table: the 1% fee, the new desk's points and, on floating
 * paper, a rate cap. Returns that fee; the caller pays it.
 */
export function renewRow(
  s: GameState, r: Rival, bbl: string, value: number, noiYr: number,
  o: { stab?: StabView; condition?: string } = {},
): number {
  const x = rowOn(s, r, bbl);
  if (!x) return 0;
  const bal = x.balance;
  delete s.cityLoans![bbl];
  loanBookTouched();
  const row = originateRow(s, r, bbl, bal, value, noiYr, { ...o, klass: x.klass });
  if (!row) return 0;
  row.arrearsMs = x.arrearsMs;
  const p = productById(row.product ?? "harbor");
  return Math.round(bal * (REFI_FEE + (p?.points ?? 0))) + (p?.floating ? capPremiumOn(bal) : 0);
}

// ------------------------------------------------------------------ the line

/** The bank that writes this firm's line: the bank holding the most of its mortgages, else the town's biggest. */
export function lineBankOf(s: GameState, r: Rival): Lender | undefined {
  const banks = (s.lenders ?? []).filter((l) => l.kind === "bank");
  if (r.lineBank) {
    const pinned = banks.find((l) => l.name === r.lineBank);
    // A failed bank's receiver still holds the drawn balance; a new draw goes elsewhere.
    if (pinned && (pinned.failedM === undefined || (r.lineBal ?? 0) > 0)) return pinned;
  }
  const live = banks.filter((l) => l.failedM === undefined);
  if (!live.length) return undefined;
  const by: Record<string, number> = {};
  for (const x of rowsOf(s, r)) by[x.lender] = (by[x.lender] ?? 0) + x.balance;
  return [...live].sort((a, b) => (by[b.name] ?? 0) - (by[a.name] ?? 0) || b.book - a.book)[0];
}
/** The line's coupon: the short index plus the line spread at its bank's appetite — the player's `locRate` arithmetic. */
export function lineRatePct(s: GameState, r: Rival): number {
  const bank = lineBankOf(s, r);
  return deskRatePct(shortIndexOf(s.econ), LOC_SPREAD, {
    ci: s.econ.creditIdx ?? 1,
    app: bank ? (bank.failedM !== undefined ? 0 : bank.appetite) : 1,
  }) + fileSpreadAdj(r);
}
/** Draw the line: cash in, balance up, at the firm's bank. */
export function drawLine(s: GameState, r: Rival, draw: number) {
  draw = Math.round(draw);
  if (!(draw > 0)) return;
  if (!r.lineBank || (r.lineBal ?? 0) <= 0) r.lineBank = lineBankOf(s, r)?.name ?? r.lineBank;
  r.lineBal = (r.lineBal ?? 0) + draw;
  r.revolver = (r.revolver ?? 0) + draw;
  r.cash += draw;
  syncDebt(s, r);
}
/**
 * Debt that lands on the firm with no cash and no deed behind it — a
 * capitalised fee, a deficiency after a short sale, a note bought on margin.
 * It is owed on the corporate line, which is where a bank puts it.
 */
export function addToLine(s: GameState, r: Rival, amt: number) {
  amt = Math.round(amt);
  if (!(amt > 0)) return;
  if (!r.lineBank || (r.lineBal ?? 0) <= 0) r.lineBank = lineBankOf(s, r)?.name ?? r.lineBank;
  r.lineBal = (r.lineBal ?? 0) + amt;
  syncDebt(s, r);
}

// ------------------------------------------------------------------ repaying

/**
 * PAY DOWN `amt` OF DEBT (the caller moves the cash). The line first — it is
 * the dearest money and a revolver is meant to be repaid — then the
 * mortgages, dearest coupon first. Returns what was repaid.
 */
export function payDown(s: GameState, r: Rival, amt: number): number {
  let left = Math.round(amt);
  if (!(left > 0)) return 0;
  const fromLine = Math.min(left, r.lineBal ?? 0);
  r.lineBal = (r.lineBal ?? 0) - fromLine;
  left -= fromLine;
  if (left > 0) {
    const rows = rowsOf(s, r).sort((a, b) => b.ratePct - a.ratePct);
    for (const x of rows) {
      if (left <= 0) break;
      const take = Math.min(left, x.balance);
      x.balance -= take;
      left -= take;
      if (x.balance <= 0) { delete s.cityLoans![x.bbl]; loanBookTouched(); }
    }
  }
  syncDebt(s, r);
  return Math.round(amt) - left;
}

/** The deed leaves with its loan (a foreclosure, the keys, a deed through the paper). Returns what the row was. */
export function dropDeed(s: GameState, r: Rival | undefined, bbl: string): number {
  const x = s.cityLoans?.[bbl];
  if (!r) return 0;
  // RE-SUM EVEN WHEN THERE IS NOTHING TO DROP. A path that moved the deed
  // first (the auction's third-party buyer takes title before the borrower is
  // settled) has already retired the row, and returning early left the firm
  // owing a loan that no longer existed — $5.4M on one seed until the ledger
  // noticed, measured by test/rival-loans.mjs.
  if (!x || x.obligorId !== r.id) { syncDebt(s, r); return 0; }
  delete s.cityLoans![bbl];
  loanBookTouched();
  syncDebt(s, r);
  return x.balance;
}

/**
 * WHAT A SALE AT `price` RETIRES, without retiring it: the mortgage on the
 * building, and the line out of whatever is left. Read by the disposal
 * decision and by every settlement, so the two cannot disagree.
 */
export function saleRelief(s: GameState, r: Rival, bbl: string, price: number): number {
  const row = rowOn(s, r, bbl)?.balance ?? 0;
  const afterRow = Math.max(0, price - row);
  return Math.min(price, row) + Math.min(afterRow, r.lineBal ?? 0);
}

/**
 * THE CLOSING TABLE. The mortgage on the building is paid off out of the
 * price; if the price does not cover it the shortfall is still owed (bank
 * paper is recourse) and moves to the line. What is left pays the line down.
 * Returns the debt retired out of the proceeds — the seller's cash is
 * `price − relief`.
 */
export function settleSale(s: GameState, r: Rival, bbl: string, price: number): number {
  const relief = saleRelief(s, r, bbl, price);
  const row = rowOn(s, r, bbl);
  if (row) {
    delete s.cityLoans![bbl];
    loanBookTouched();
    if (row.balance > price) addToLine(s, r, row.balance - price);
  }
  const fromLine = relief - Math.min(price, row?.balance ?? 0);
  r.lineBal = Math.max(0, (r.lineBal ?? 0) - fromLine);
  syncDebt(s, r);
  return relief;
}

/**
 * A PACKAGE BOUGHT ON ONE CHEQUE is still mortgaged deed by deed: the debt is
 * spread across the buildings by value and each piece is written by the desk
 * that will take it.
 */
export function financePackage(
  s: GameState, r: Rival, total: number,
  items: { bbl: string; v: number; noi: number; klass?: string; condition?: string }[],
) {
  const tv = items.reduce((a, x) => a + Math.max(1, x.v), 0);
  if (!(total > 0) || !(tv > 0)) return;
  for (const x of items) {
    originateRow(s, r, x.bbl, Math.round(total * Math.max(1, x.v) / tv), x.v, x.noi, { klass: x.klass, condition: x.condition });
  }
}

/** One firm takes another's book: every mortgage, the line and the jobs move with the deeds. */
export function assumeBook(s: GameState, from: Rival, to: Rival) {
  for (const x of rowsOf(s, from)) x.obligorId = to.id;
  loanBookTouched();
  if ((from.lineBal ?? 0) > 0) { addToLine(s, to, from.lineBal!); from.lineBal = 0; }
  syncDebt(s, from);
  syncDebt(s, to);
}

/** Construction balance moving with a job to a new sponsor is the job's business; both sponsors re-read it. */
export function resyncAll(s: GameState) {
  for (const r of s.rivals ?? []) if (r.failedM === undefined) syncDebt(s, r);
}

// ------------------------------------------------------------------ the monthly carry

/**
 * ONE MONTH OF DEBT SERVICE. Each mortgage at its own coupon, amortising on
 * the firm's schedule (`amortShare` of a thirty-year straight line — a
 * value-add shop runs interest-only, a family pays down); the line at its
 * floating coupon, interest only. Construction interest is not here: it is
 * capitalised into the job (rivals.ts fundJobs), and charging it again on the
 * firm's account counted it twice. Returns what was owed by loan, for the
 * payment test.
 */
/**
 * FLOATING PAPER FLOATS (2026-10-15). The street's floaters — bank five-years,
 * bridges, construction takeouts — were charged the coupon they were written
 * at for their whole term, so a firm on floating debt paid 7% through a 20%
 * index and never missed a payment: measured, delinquency on the desks ran to
 * 14-30% in a glut while not one firm fell behind. The player's floater has
 * always reset every month off the short index, through its cap until the cap
 * runs out (debt.ts). The street's does the same now. A row written before
 * this carries no margin: it is read off its current coupon the first time,
 * uncapped.
 */
export function repriceFloating(s: GameState, r: Rival) {
  repriceRows(s, rowsOf(s, r));
}
/** Reprices rows in place; it moves no row on or off the record and changes no obligor. */
function repriceRows(s: GameState, rows: CityLoan[]) {
  const idx = shortIndexOf(s.econ);
  for (const x of rows) {
    if (!productById(x.product ?? "harbor")?.floating) continue;
    if (x.spread === undefined) x.spread = +(x.ratePct - idx).toFixed(2);
    if (x.cap && s.month >= x.cap.expiresM) delete x.cap;
    const eff = x.cap ? Math.min(idx, x.cap.strike) : idx;
    x.ratePct = +(eff + x.spread).toFixed(2);
  }
}

export function monthlyService(s: GameState, r: Rival, amortShare: number): { interest: number; amort: number; byRow: Record<string, number> } {
  // Repricing leaves the firm's rows the rows they were, so one read serves both.
  const rows = rowsOf(s, r);
  repriceRows(s, rows);
  const adj = fileSpreadAdj(r);
  let interest = 0, amort = 0;
  const byRow: Record<string, number> = {};
  for (const x of rows) {
    const i = (x.balance * (x.ratePct + adj)) / 100 / 12;
    const a = (x.balance * amortShare) / (30 * 12);
    interest += i; amort += a;
    byRow[x.bbl] = i + a;
  }
  if ((r.lineBal ?? 0) > 0) interest += (r.lineBal! * lineRatePct(s, r)) / 100 / 12;
  return { interest, amort, byRow };
}
/** Book the scheduled principal: each row comes down by its own share. */
export function amortizeRows(s: GameState, r: Rival, amortShare: number) {
  // The rows that remain are these rows in the same order, less the ones paid
  // to zero — which add nothing — so their sum is termDebtOf's, without a rescan.
  let term = 0;
  for (const x of rowsOf(s, r)) {
    x.balance = Math.max(0, Math.round(x.balance - (x.balance * amortShare) / (30 * 12)));
    if (x.balance <= 0) { delete s.cityLoans![x.bbl]; loanBookTouched(); }
    else term += x.balance;
  }
  r.debt = Math.round(term + (r.lineBal ?? 0) + jobDebtOf(s, r));
}

/**
 * STATUS FROM PAYMENTS. A firm that cannot meet the month's service does not
 * miss every loan it has: it pays the buildings that pay for themselves and
 * stops feeding the ones that do not. The shortfall falls on the rows whose
 * own income covers least of their own service, worst first, until the
 * unpaid service covers the shortfall; those rows are in arrears and every
 * other row is paid. A missed payment is a default the month it is missed —
 * the rule the player's loans are counted under (loanbook.ts) — and a row
 * whose building no longer covers its coupon, or that is living on an
 * extension, is on watch.
 */
export function markPayments(
  s: GameState, r: Rival, shortfall: number, byRow: Record<string, number>,
  noiOf: (bbl: string) => number, extended: (bbl: string) => boolean,
) {
  const rows = rowsOf(s, r);
  const cover = (x: CityLoan) => noiOf(x.bbl) / 12 / Math.max(1, byRow[x.bbl] ?? 1);
  const missed = new Set<string>();
  if (shortfall > 0) {
    let left = shortfall;
    for (const x of [...rows].sort((a, b) => cover(a) - cover(b))) {
      if (left <= 0) break;
      missed.add(x.bbl);
      left -= byRow[x.bbl] ?? 0;
    }
  }
  for (const x of rows) {
    if (missed.has(x.bbl)) x.arrearsMs = (x.arrearsMs ?? 0) + 1;
    else x.arrearsMs = 0;
    x.status = (x.arrearsMs ?? 0) >= 1 ? "workout"
      : extended(x.bbl) || (x.klass !== "land" && cover(x) < 1) ? "watch" : "current";
  }
}
