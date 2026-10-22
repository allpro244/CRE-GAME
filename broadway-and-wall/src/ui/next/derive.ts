/**
 * SHARED READS FOR THE NEW SHELL, once per game state (ui/derive.ts cache).
 * Every figure is an engine function's answer; this file only gathers them.
 */
import type { GameState } from "@/engine/types";
import type { ParcelTable } from "@/data/types";
import { derive, nwOf, standingOf } from "@/ui/derive";
import { firmOverheadMonthly, portfolioMonthlyCF } from "@/engine/sim";
import { portfolioOccupancy } from "@/engine/leasing";
import { loanLender } from "@/engine/debt";
import { locRate } from "@/engine/credit";
import { usablePrev } from "@/ui/vitals/Waterfall";

export type DebtKind = "mortgage" | "mezz" | "facility" | "line";
export interface DebtRow { bbl?: string; lender: string; balance: number; rate: number; maturesM?: number; kind: DebtKind }
export interface DebtBook { rows: DebtRow[]; total: number; secured: number; wall: number }

/**
 * EVERY DOLLAR THE FIRM OWES, ONE LIST. Mortgages, mezzanine, the pooled
 * facility and the drawn line. `secured` (all but the line) is the figure the
 * desk badges have always summed (ui/desks.ts tabCounts reads it from here);
 * `wall` is the secured debt maturing inside three years.
 */
export function debtBook(g: GameState): DebtBook {
  return derive(g, "next.debtBook", () => {
    const rows: DebtRow[] = [];
    for (const h of Object.values(g.holdings)) {
      if (h.loan && h.loan.balance > 0) {
        rows.push({ bbl: h.bbl, lender: loanLender(h.loan), balance: h.loan.balance, rate: h.loan.ratePct, maturesM: h.loan.maturityM, kind: "mortgage" });
      }
      if (h.mezz && h.mezz.balance > 0) {
        rows.push({ bbl: h.bbl, lender: loanLender(h.mezz), balance: h.mezz.balance, rate: h.mezz.ratePct, maturesM: h.mezz.maturityM, kind: "mezz" });
      }
    }
    if (g.facility && g.facility.balance > 0) {
      rows.push({ lender: g.facility.lender, balance: g.facility.balance, rate: g.facility.ratePct, maturesM: g.facility.maturityM, kind: "facility" });
    }
    const line = g.loc?.balance ?? 0;
    if (line > 0) rows.push({ lender: g.loc.lender ?? "Credit line", balance: line, rate: locRate(g), kind: "line" });
    let secured = 0, wall = 0;
    for (const r of rows) {
      if (r.kind === "line") continue;
      secured += r.balance;
      if (r.maturesM !== undefined && r.maturesM - g.month <= 36) wall += r.balance;
    }
    rows.sort((a, b) => b.balance - a.balance);
    return { rows, total: secured + line, secured, wall };
  });
}

/** The firm's monthly cash flow: deeds less debt, less the office (the top bar's figure). */
export const firmCfMonthly = (g: GameState, parcels: ParcelTable): number =>
  derive(g, "topbar.firmCf", () => portfolioMonthlyCF(g, parcels) - firmOverheadMonthly(g, parcels), [parcels]);

export interface HudVitals {
  cash: number;
  debt: number;
  nw: number;
  dNw: number | null;
  cfYr: number;
  dCfYr: number | null;
  rank: number | null;
  of: number | null;
  dRank: number;
  occ: number | null;
  rate: number;
  dRateBp: number | null;
  nwSpark: number[];
}

/** The HUD row: the same reads and deltas the classic top bar prints. */
export function hudVitals(g: GameState, prev: GameState | null, parcels: ParcelTable): HudVitals {
  return derive(g, "next.hud", () => {
    const nw = nwOf(g, parcels);
    const cf = firmCfMonthly(g, parcels);
    const prevOk = usablePrev(g, prev);
    const nh = g.nwHistory ?? [];
    const hist = g.econ.history ?? [];
    const rateThen = hist.length > 12 ? hist[hist.length - 13]?.indexRate : undefined;
    const standing = (g.rivals?.length ?? 0) > 0 ? standingOf(g, parcels) : null;
    const standPrev = standing && prevOk ? standingOf(prevOk, parcels) : null;
    return {
      cash: g.cash,
      debt: debtBook(g).total,
      nw,
      dNw: nh.length >= 2 ? nh[nh.length - 1] - nh[nh.length - 2] : null,
      cfYr: cf * 12,
      dCfYr: prevOk ? (cf - firmCfMonthly(prevOk, parcels)) * 12 : null,
      rank: standing?.rank ?? null,
      of: standing?.of ?? null,
      dRank: standing && standPrev ? standPrev.rank - standing.rank : 0,
      occ: portfolioOccupancy(g, parcels)?.occ ?? null,
      rate: g.econ.indexRate,
      dRateBp: rateThen === undefined ? null : Math.round((g.econ.indexRate - rateThen) * 100),
      nwSpark: nh.slice(-24),
    };
  }, [parcels, prev]);
}
