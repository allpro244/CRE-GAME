// THE LAND DEVELOPER'S LOAN (region map, Phase 3): acquisition and development.
//
// A subdivision is not built on cash in life. A bank writes an A&D loan
// against the rezoned tract and the streets going in on it: it funds the
// horizontal (and refinances part of the land) up to a share of what the
// finished lots will be worth, takes interest monthly, and is repaid lot by
// lot — each lot sold to a builder pays a RELEASE PRICE, a premium over its
// share of the loan, so the bank is out before the last lots sell. If the
// lots do not sell by maturity the developer pays the rest, or gets a year's
// extension at a price, or hands the bank what is left.
//
// The loan sits on the desk's book (loanbook.ts), its interest is debt
// service and its draw is borrowing on the player's ledger (logBooks), and
// the lots' value is netted against it in net worth (value.ts portfolioMark).
import type { ParcelTable } from "@/data/types";
import type { GameState, ADLoan } from "./types";
import { cloneState, monthLabel, logBooks } from "./types";
import { fundAndBook, fundCashNeed } from "./credit";
import { pickConstructionDesk } from "./dev";
import { lenderByName, chargeLenderLoss } from "./lenders";
import { startPlat, platQuote } from "./landdev";
import { tractLotQuote, platLots } from "./homes";
import { resolveRec, landValue } from "./value";
import { money } from "./money";

/**
 * The most a regulated bank lends against land under development: 75% of
 * its value as finished lots (12 CFR 34 App. A, interagency supervisory LTV
 * limits, "land development"), and in practice no more than 75% of the cost
 * either (A&D loan-to-cost norms, 60-75%) [S].
 */
export const AD_LTV = 0.75;
export const AD_LTC = 0.75;
/** The coupon: the construction desk's, the loan index plus 2.4 points (proforma.ts CONSTR_SPREAD), and a point to open it. */
const AD_SPREAD = 2.4;
const AD_POINTS = 0.01;
/** Three years: the streets and a sell-out, the usual A&D term [S]. */
const AD_TERM_M = 36;
/**
 * THE RELEASE PRICE: each lot sold repays 120% of its pro-rata share of the
 * loan (A&D release provisions run 110-125%) [S], so the bank is repaid by
 * the time about five-sixths of the lots have gone.
 */
const RELEASE_PREMIUM = 1.2;
/** One extension at maturity: a year, a point of fee and a point more on the coupon (the bank row of BANKING.md's workout table). */
const EXT_M = 12, EXT_FEE = 0.01, EXT_BUMP = 1.0;

/** What a desk would lend on this tract's streets, today. */
export function adQuote(s: GameState, parcels: ParcelTable, bbl: string, lots: { a: number; f: number; d: number }[]) {
  const rec = parcels[bbl];
  const h = s.holdings[bbl];
  const rz = s.rezoned?.[bbl];
  if (!rec?.tract || !h || !rz) return null;
  const plat = platQuote(s, lots);
  const t = tractLotQuote(s, parcels, bbl, rz.lotSf, lots.length);
  const value = t.lotValue * lots.length;
  const cost = h.costBasis + plat.cost;
  const amount = Math.max(0, Math.round(Math.min(AD_LTV * value, AD_LTC * cost)));
  const lender = pickConstructionDesk(s, `ad:${bbl}`);
  return { amount, value, cost, lender, ratePct: +((s.econ.indexRate ?? 5.4) + AD_SPREAD).toFixed(2), points: Math.round(amount * AD_POINTS), plat };
}

/** Build the streets on an A&D loan: the desk funds `amount` into your account, then the plat is paid as ever. */
export function startPlatFinanced(s: GameState, parcels: ParcelTable, bbl: string, lots: { a: number; f: number; d: number }[]): { s: GameState; err?: string; msg?: string } {
  if (s.adLoans?.[bbl]) return { s, err: "There is already a land loan on this tract." };
  const q = adQuote(s, parcels, bbl, lots);
  if (!q) return { s, err: "The tract has to be yours and rezoned." };
  if (!q.lender || lenderByName(s, q.lender)?.failedM !== undefined) return { s, err: "No construction desk is writing land loans this month." };
  if (!(q.amount > 0)) return { s, err: "No bank lends on lots nobody would build on: the finished lots here are worth nothing to a homebuilder today." };
  const next = cloneState(s);
  next.cash += q.amount;
  logBooks(next, "borrowed", q.amount, bbl);
  fundAndBook(next, parcels, q.points, "debtSvc", { bbl });
  const totalArea = lots.reduce((t, l) => t + l.a, 0);
  const loan: ADLoan = {
    tract: bbl, lender: q.lender, balance: q.amount, ratePct: q.ratePct, startM: next.month, maturityM: next.month + AD_TERM_M,
    releasePsf: +((RELEASE_PREMIUM * q.amount) / Math.max(1, totalArea)).toFixed(4),
  };
  next.adLoans = { ...(next.adLoans ?? {}), [bbl]: loan };
  const r = startPlat(next, parcels, bbl, lots);
  if (r.err) return { s, err: r.err };
  r.s.news.unshift({ q: r.s.month, kind: "info", text: `${q.lender} wrote a ${money(q.amount)} land loan on ${parcels[bbl]?.address ?? bbl} at ${q.ratePct.toFixed(2)}%, due ${monthLabel(loan.maturityM)}; each lot sold repays ${money(loan.releasePsf * (totalArea / lots.length))} of it.` });
  return { s: r.s, msg: "Financed and under way." };
}

/** What a lot sale on this plat owes the land loan, $: the release price, capped at what is left. */
export function releaseDue(s: GameState, parcels: ParcelTable, lotBbl: string): number {
  const parent = parcels[lotBbl]?.block;
  const l = parent ? s.adLoans?.[parent] : undefined;
  if (!l || !(l.balance > 0)) return 0;
  return Math.min(l.balance, Math.round(l.releasePsf * (parcels[lotBbl]?.lotArea ?? 0)));
}
/** ...and pay it: the balance falls; the caller nets it from the proceeds (as a sale nets a mortgage payoff). */
export function payRelease(s: GameState, parcels: ParcelTable, lotBbl: string): number {
  const due = releaseDue(s, parcels, lotBbl);
  if (!(due > 0)) return 0;
  const l = s.adLoans![parcels[lotBbl].block!];
  l.balance -= due;
  if (l.balance <= 0) {
    delete s.adLoans![l.tract];
    s.news.unshift({ q: s.month, kind: "info", text: `The land loan on ${parcels[l.tract]?.address ?? l.tract} is repaid from the lot sales.` });
  }
  return due;
}

/** The month on every land loan: interest, and maturity. */
export function tickADLoans(s: GameState, parcels: ParcelTable): void {
  for (const l of Object.values(s.adLoans ?? {})) {
    const interest = Math.round((l.balance * l.ratePct) / 100 / 12);
    if (interest > 0) fundAndBook(s, parcels, interest, "debtSvc", { bbl: l.tract });
    if (s.month < l.maturityM) continue;
    // THE BALLOON: paid from the account and the line if they will cover it
    const paid = fundCashNeed(s, parcels, l.balance);
    if (paid > 0) logBooks(s, "debtSvc", paid, l.tract);
    l.balance -= paid;
    if (l.balance <= 0) {
      delete s.adLoans![l.tract];
      s.news.unshift({ q: s.month, kind: "info", text: `The land loan on ${parcels[l.tract]?.address ?? l.tract} came due and was paid off.` });
      continue;
    }
    if (!l.extended) {
      // a year more, at a price
      const fee = Math.round(l.balance * EXT_FEE);
      l.balance += fee;   // capitalised: the account could not pay the balloon, so it cannot pay the fee either
      l.ratePct = +(l.ratePct + EXT_BUMP).toFixed(2);
      l.maturityM = s.month + EXT_M;
      l.extended = true;
      s.news.unshift({ q: s.month, kind: "warn", text: `${l.lender} extended the land loan on ${parcels[l.tract]?.address ?? l.tract} a year: ${money(l.balance)} still owed, now at ${l.ratePct.toFixed(2)}%, due ${monthLabel(l.maturityM)}.` });
      continue;
    }
    // THE KEYS: the bank takes the lots still yours on the plat; what they will not cover is its loss
    const lots = platLots(s, parcels, l.tract).filter((b) => s.holdings[b]);
    let worth = 0;
    for (const b of lots) {
      const r = resolveRec(parcels, s, b);
      worth += r ? landValue(r, s.econ) : 0;
      delete s.holdings[b];
      (s.lastTradeM ??= {})[b] = s.month;
    }
    if (s.holdings[l.tract]) { const r = resolveRec(parcels, s, l.tract); worth += r ? landValue(r, s.econ) : 0; delete s.holdings[l.tract]; }
    chargeLenderLoss(s, l.lender, Math.max(0, l.balance - worth));
    s.news.unshift({ q: s.month, kind: "warn", text: `${l.lender} took ${lots.length} lots at ${parcels[l.tract]?.address ?? l.tract} for the ${money(l.balance)} land loan you could not pay.` });
    delete s.adLoans![l.tract];
  }
  if (s.adLoans && !Object.keys(s.adLoans).length) delete s.adLoans;
}
