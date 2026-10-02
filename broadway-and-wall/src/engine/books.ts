/**
 * THE BOOKS — period views the statement and the sheet share.
 *
 * Year buckets already live on GameState via logBooks. Monthly income and a
 * year-end balance snapshot need their own stamps so the player can toggle
 * without inventing a second set of numbers.
 */
import type { ParcelTable } from "@/data/types";
import type { BalanceSnapshot, BooksMonth, BooksYear, GameState, Holding, PnlYear } from "./types";
import { logBooks, deedCfProbe, deedIrr, fundDepositsHeld, pnlAdd, pnlYear, START_YEAR } from "./types";
import { depositsHeld } from "./leasing";
import { locLimit, locRate, LOC_SPREAD } from "./credit";
import { jvShare } from "./jv";
import { collateralAsIs, ownedHoldingValue, netWorth, resolveRec } from "./value";
import { gpInterestInFund } from "./fund";

/** Re-export so harnesses that load `books` can dual-write without pulling all of types. */
export { logBooks };
/** The per-deed equity ledger's test hook and IRR solver — see test/deedledger.mjs. */
export { deedCfProbe, deedIrr };

export interface BalanceSheetView {
  m: number;
  label: string;
  cash: number;
  deposits: number;
  propGross: number;
  mortgages: number;
  landOnly: number;
  bldgCount: number;
  landCount: number;
  byClass: Record<string, { n: number; gross: number; debt: number }>;
  cip: number;
  cipDebt: number;
  cipN: number;
  notesVal: number;
  noteCount: number;
  locBal: number;
  locLim: number;
  facility: number;
  fundInterest?: number;
  fundDeeds?: number;
  mezz?: number;
  partners?: number;
  totalAssets: number;
  totalLiab: number;
  equity: number;
  nwEngine: number;
  rate: number;
  /** True when this is a frozen year-end stamp, not today's live sheet. */
  historical: boolean;
}

/**
 * Live balance sheet from the same marks the TopBar and the lenders use — AND
 * THE SAME CONSOLIDATION. This summed every deed at 100%: the fund's buildings
 * (which are mostly the LPs'), a JV partner's share, and no mezzanine. Its
 * equity line then disagreed with the engine net worth printed above it on the
 * same page, by +47% on one measured run. It now reads the vehicle as the
 * sponsor's interest in it, the partner's share as what it is, and the mezz
 * as debt — portfolioMark's arithmetic, line by line, so the two agree.
 */
export function buildBalanceSheet(s: GameState, parcels: ParcelTable): BalanceSheetView {
  let propGross = 0, mortgages = 0, landOnly = 0, bldgCount = 0, landCount = 0;
  let mezz = 0, partners = 0, fundNav = 0, fundDeeds = 0;
  const liveFund = s.fund && !s.fund.settled ? s.fund : undefined;
  // Net of the deposits the vehicle holds for its own tenants — portfolioMark's arithmetic.
  if (liveFund) fundNav = liveFund.cash - fundDepositsHeld(s);
  const byClass: Record<string, { n: number; gross: number; debt: number }> = {};
  for (const h of Object.values(s.holdings)) {
    const rec = resolveRec(parcels, s, h.bbl);
    if (!rec) continue;
    const v = ownedHoldingValue(s, parcels, h);
    const debt = h.loan?.balance ?? 0;
    const junior = h.mezz?.balance ?? 0;
    if (liveFund && h.fundOwned) { fundNav += v - debt - junior; fundDeeds++; continue; }
    mezz += junior;
    partners += (v - debt - junior) * (h.jv?.share ?? 0);
    propGross += v;
    mortgages += debt;
    // A leased fee resolves as the lessee's tower — it is still coupon paper,
    // not a building you operate. Keep it out of the office/retail count.
    const cls = h.groundLeased
      ? "leased fee"
      : (rec.class === "land" || !(rec.floors > 0) ? "land" : (rec.class ?? "other"));
    if (cls === "land" || cls === "leased fee") { landOnly += v; landCount++; }
    else { bldgCount++; }
    if (!byClass[cls]) byClass[cls] = { n: 0, gross: 0, debt: 0 };
    byClass[cls].n++;
    byClass[cls].gross += v;
    byClass[cls].debt += debt;
  }

  let cip = 0, cipDebt = 0, cipN = 0;
  for (const d of Object.values(s.developments ?? {})) {
    const sunk = Math.max(0, (d.equitySpent ?? 0) + (d.drawn ?? 0) - (d.reserveUsed ?? 0));
    cip += sunk;
    // Carried the way net worth carries a job: equity in it floors at zero.
    cipDebt += Math.min(d.loanBalance ?? 0, sunk);
    cipN++;
  }

  let notesVal = 0;
  for (const n of s.notes ?? []) {
    if (n.perf === "performing") { notesVal += n.basis; continue; }
    const rec = resolveRec(parcels, s, n.bbl);
    if (!rec) continue;
    const r = s.rivals?.find((x) => x.id === n.obligorId);
    notesVal += Math.min(n.basis, Math.round(collateralAsIs(rec, s.econ, r?.occ ?? 0.5)));
  }

  const deposits = depositsHeld(s) - fundDepositsHeld(s);
  const locBal = s.loc?.balance ?? 0;
  const locLim = locLimit(s, parcels);
  const facility = s.facility?.balance ?? 0;
  const cash = s.cash;
  // The sponsor's note on a wound-down fund's liquidating trust counts with
  // its interest in the fund — the same claim, one step later.
  const fundInterest = (liveFund ? gpInterestInFund(liveFund, fundNav) : 0) + (s.trustNote?.balance ?? 0);
  const totalAssets = cash + propGross + Math.max(0, cip) + notesVal + fundInterest;
  const totalLiab = mortgages + mezz + partners + cipDebt + facility + locBal + deposits;
  const equity = totalAssets - totalLiab;
  const nwEngine = netWorth(s, parcels);

  return {
    m: s.month,
    label: "today",
    cash, deposits, propGross, mortgages, landOnly, bldgCount, landCount,
    byClass, cip, cipDebt, cipN, notesVal, noteCount: (s.notes ?? []).length,
    locBal, locLim, facility, fundInterest, fundDeeds, mezz, partners, totalAssets, totalLiab, equity, nwEngine,
    rate: locRate(s),
    historical: false,
  };
}

/** Compact year-end stamp — enough to re-open last December without the rent roll. */
export function captureBalanceSnapshot(s: GameState, parcels: ParcelTable): BalanceSnapshot {
  const live = buildBalanceSheet(s, parcels);
  return {
    m: s.month,
    cash: live.cash,
    deposits: live.deposits,
    propGross: live.propGross,
    mortgages: live.mortgages,
    landOnly: live.landOnly,
    bldgCount: live.bldgCount,
    landCount: live.landCount,
    byClass: Object.fromEntries(
      Object.entries(live.byClass).map(([k, v]) => [k, { ...v }]),
    ),
    cip: live.cip,
    cipDebt: live.cipDebt,
    cipN: live.cipN,
    notesVal: live.notesVal,
    noteCount: live.noteCount,
    locBal: live.locBal,
    locLim: live.locLim,
    facility: live.facility,
    fundInterest: live.fundInterest,
    fundDeeds: live.fundDeeds,
    mezz: live.mezz,
    partners: live.partners,
    totalAssets: live.totalAssets,
    totalLiab: live.totalLiab,
    equity: live.equity,
    nwEngine: live.nwEngine,
    rate: live.rate,
  };
}

export function balanceSnapshotView(snap: BalanceSnapshot): BalanceSheetView {
  return { ...snap, label: "year-end", historical: true };
}

/** Stamp December of each game year. Keeps one entry per year. */
export function maybeStampYearEndBalance(s: GameState, parcels: ParcelTable) {
  // month 11, 23, 35… — December of each year (month 0 is January of year 0).
  if (s.month < 0 || s.month % 12 !== 11) return;
  const snap = captureBalanceSnapshot(s, parcels);
  if (!s.balanceHistory) s.balanceHistory = [];
  const yr = Math.floor(s.month / 12);
  const without = s.balanceHistory.filter((b) => Math.floor(b.m / 12) !== yr);
  without.push(snap);
  // A century of year-ends is 100 rows — fine; still cap so a long save stays lean.
  s.balanceHistory = without.slice(-120);
}

export function booksMonthAsYear(b: BooksMonth): BooksYear {
  const { m, ...flows } = b;
  return { yr: Math.floor(m / 12), ...flows };
}

// ---- the income statement ------------------------------------------------

/** A deed the firm reports on its own statement — not the fund vehicle's. */
function onFirmBooks(s: GameState, h: Holding): boolean {
  return !(h.fundOwned && s.fund && !s.fund.settled);
}

/**
 * THE MONTH'S REVENUE ON ONE DEED, stamped at the moment its NOI is booked so
 * the two are the same month of the same building. `egiYr` is the operating
 * statement's effective gross income; a leased fee's revenue is its coupon.
 */
export function stampPnlDeed(s: GameState, h: Holding, noiMonth: number, egiYr: number | null) {
  if (!onFirmBooks(s, h)) return;
  pnlAdd(s, "rev", egiYr === null ? noiMonth : egiYr / 12);
  const share = jvShare(h);
  if (share > 0) pnlAdd(s, "jv", noiMonth * share);
}

/**
 * MONTH-END ACCRUALS: interest on everything owed, and a twelfth of last
 * January's depreciation. Interest accrues on the balance outstanding at the
 * contract rate — the same `balance × rate / 12` `tickLoan` charges — whether
 * or not a cheque left this month; a loan in foreclosure is still accruing,
 * which is exactly what an accrual statement is for. Construction loans are
 * left out: their interest is capitalised into the job (see `dev`).
 */
export function stampPnlMonth(s: GameState) {
  let intExp = 0, depr = 0, jvInt = 0;
  for (const h of Object.values(s.holdings)) {
    if (!onFirmBooks(s, h)) continue;
    let i = 0;
    if (h.loan && h.loan.balance > 0) i += (h.loan.balance * h.loan.ratePct) / 100 / 12;
    if (h.mezz && h.mezz.balance > 0) i += (h.mezz.balance * h.mezz.ratePct) / 100 / 12;
    intExp += i;
    jvInt += i * jvShare(h);
    depr += (h.deprYr ?? 0) / 12;
  }
  if (s.facility && s.facility.balance > 0) intExp += (s.facility.balance * s.facility.ratePct) / 100 / 12;
  if (s.loc && s.loc.balance > 0) intExp += (s.loc.balance * ((s.econ.indexRate ?? 0) + LOC_SPREAD)) / 100 / 12;
  pnlAdd(s, "intExp", intExp);
  pnlAdd(s, "jv", -jvInt);
  pnlAdd(s, "depr", depr);
}

/**
 * JANUARY TRUES THE YEAR UP. The return just filed is the one answer to how
 * much depreciation last year carried, so the year's accrual is replaced by
 * it — a deed bought in November and depreciated for the full year by the
 * return shows up here exactly as the return took it.
 */
export function closePnlDepreciation(s: GameState, closingYr: number, deprTotal: number) {
  if (closingYr < 0) return;
  const e = pnlYear(s, closingYr);
  e.depr = Math.round(deprTotal);
  e.deprFinal = true;
}

export interface PnlView {
  yr: number;
  label: string;
  months: number;
  rev: number;
  intInc: number;
  totalRev: number;
  propOpex: number;
  leasing: number;
  capex: number;
  ga: number;
  totalOpex: number;
  ebitda: number;
  depr: number;
  deprFinal: boolean;
  ebit: number;
  intExp: number;
  gains: number;
  jv: number;
  pretax: number;
  taxes: number;
  net: number;
}

/**
 * One year of the income statement, assembled. Gains on sale come from the
 * exits ledger — the same figure the Realized gains tile prints — struck on
 * net proceeds over the depreciated basis (`saleTaxQuote`).
 */
export function pnlView(s: GameState, e: PnlYear): PnlView {
  const thisYr = Math.floor(s.month / 12);
  const months = e.yr === thisYr ? (s.month % 12) + 1 : 12;
  const gains = (s.exits ?? [])
    .filter((x) => Math.floor(x.soldM / 12) === e.yr)
    .reduce((a, x) => a + (x.gain ?? 0), 0);
  const propOpex = e.rev - e.noi;
  const totalRev = e.rev + e.intInc;
  const totalOpex = propOpex + e.leasing + e.capex + e.ga;
  const ebitda = totalRev - totalOpex;
  const ebit = ebitda - e.depr;
  const pretax = ebit - e.intExp + gains - e.jv;
  return {
    yr: e.yr,
    label: `${START_YEAR + e.yr}${months < 12 ? ` YTD` : ""}`,
    months,
    rev: e.rev, intInc: e.intInc, totalRev,
    propOpex, leasing: e.leasing, capex: e.capex, ga: e.ga, totalOpex,
    ebitda, depr: e.depr, deprFinal: !!e.deprFinal, ebit,
    intExp: e.intExp, gains, jv: e.jv, pretax,
    taxes: e.taxes, net: pretax - e.taxes,
  };
}
