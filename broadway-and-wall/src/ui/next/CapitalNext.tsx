/**
 * CAPITAL › OVERVIEW AND LOANS, AS TABLES (PLAN §5 step 5). One debt list
 * (`debtBook`), each loan's coverage and leverage from the engine's own
 * `dscr` / `ltv`, the maturity ladder by year, the line. Rows open the
 * building's Money tab, where the refinance quotes are.
 */
import { useMemo } from "react";
import { useStore } from "@/state/store";
import type { GameState } from "@/engine/types";
import type { ParcelTable } from "@/data/types";
import { monthLabel, START_YEAR } from "@/engine/types";
import { dscr, ltv, payOffDue } from "@/engine/debt";
import { locLimit, locRate } from "@/engine/credit";
import { resolveRec } from "@/engine/value";
import { derive, nwOf } from "@/ui/derive";
import { usd } from "@/ui/format";
import { DataTable, Stat, StatStrip, type Col } from "./DataTable";
import { Figure } from "./Figure";
import { debtBook, type DebtRow } from "./derive";

interface LoanRow extends DebtRow { key: string; addr: string; dscr: number | null; ltv: number | null; covenant: number | null; floating: boolean; monthsLeft: number | null; pmtYr: number; sweep: boolean; prepay: number }

function loanRows(g: GameState, p: ParcelTable): LoanRow[] {
  return derive(g, "next.loanRows", () => debtBook(g).rows.map((r, i) => {
    const h = r.bbl ? g.holdings[r.bbl] : undefined;
    const rec = r.bbl ? resolveRec(p, g, r.bbl) : null;
    const ln = r.kind === "mortgage" ? h?.loan : r.kind === "mezz" ? h?.mezz : null;
    const fac = r.kind === "facility" ? g.facility : null;
    return {
      ...r,
      key: `${r.kind}:${r.bbl ?? i}`,
      addr: r.bbl ? p[r.bbl]?.address ?? r.bbl : r.kind === "line" ? "Credit line" : "Pooled facility",
      dscr: r.kind === "mortgage" && h && rec ? dscr(rec, g, h) : null,
      ltv: r.kind === "mortgage" && h && rec ? ltv(rec, g, h) : null,
      covenant: ln?.minDSCR ?? fac?.minDSCR ?? null,
      floating: !!(ln?.floating ?? fac?.floating),
      monthsLeft: r.maturesM !== undefined ? r.maturesM - g.month : null,
      pmtYr: (ln?.monthlyPmt ?? fac?.monthlyPmt ?? 0) * 12,
      sweep: !!(ln?.sweep ?? fac?.sweep),
      prepay: ln ? payOffDue(ln, g.month, g.econ).penalty : 0,
    };
  }), [p]);
}

const cols: Col<LoanRow>[] = [
  { id: "addr", label: "Collateral", get: (r) => r.addr },
  { id: "kind", label: "Kind", get: (r) => r.kind },
  { id: "lender", label: "Lender", get: (r) => r.lender },
  { id: "bal", label: "Balance", get: (r) => r.balance, fmt: "usd" },
  { id: "rate", label: "Rate", get: (r) => r.rate, fmt: "pctv", cell: (r) => <span>{r.rate.toFixed(2)}%{r.floating ? " fl" : ""}</span> },
  { id: "ds", label: "Pmt / yr", get: (r) => r.pmtYr, fmt: "usd" },
  { id: "dscr", label: "DSCR", get: (r) => r.dscr, fmt: "x", tone: (r) => (r.dscr !== null && r.covenant !== null && r.dscr < r.covenant ? "neg" : undefined) },
  { id: "cov", label: "Covenant", get: (r) => r.covenant, fmt: "x", hidden: true },
  { id: "ltv", label: "LTV", get: (r) => r.ltv, fmt: "pct", tone: (r) => ((r.ltv ?? 0) > 0.75 ? "neg" : undefined) },
  { id: "mat", label: "Matures", get: (r) => r.maturesM ?? null, cell: (r) => <span className="mono">{r.maturesM !== undefined ? monthLabel(r.maturesM) : "—"}</span> },
  { id: "left", label: "Months", get: (r) => r.monthsLeft, fmt: "n", tone: (r) => (r.monthsLeft !== null && r.monthsLeft <= 12 ? "neg" : undefined) },
  { id: "prepay", label: "Prepay", get: (r) => r.prepay, fmt: "usd", hidden: true },
  { id: "sweep", label: "Sweep", get: (r) => (r.sweep ? "swept" : ""), tone: (r) => (r.sweep ? "neg" : undefined) },
];

const openLoan = (r: LoanRow) => { if (r.bbl) useStore.getState().openProperty(r.bbl, "money"); };

export function CapitalLoans() {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const rows = useMemo(() => loanRows(game, parcels), [game, parcels]);
  return (
    <div className="nx-place">
      <DataTable id="capital-loans" cols={cols} rows={rows} rowKey={(r) => r.key} onRow={openLoan} initialSort={{ col: "left", dir: 1 }} empty="No debt"
        actions={(r) => r.bbl && r.kind === "mortgage" ? <button type="button" className="nx-btn nx-sm" onClick={() => openLoan(r)}>Refi</button> : null} />
    </div>
  );
}

export function CapitalOverview() {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const rows = useMemo(() => loanRows(game, parcels), [game, parcels]);
  const book = debtBook(game);
  const lim = useMemo(() => locLimit(game, parcels, nwOf(game, parcels)), [game, parcels]);
  const bal = rows.reduce((a, r) => a + r.balance, 0);
  const wRate = bal > 0 ? rows.reduce((a, r) => a + r.balance * r.rate, 0) / bal : null;
  const dated = rows.filter((r) => r.monthsLeft !== null);
  const datedBal = dated.reduce((a, r) => a + r.balance, 0);
  const wMat = datedBal > 0 ? dated.reduce((a, r) => a + r.balance * r.monthsLeft!, 0) / datedBal / 12 : null;
  const floatBal = rows.filter((r) => r.floating).reduce((a, r) => a + r.balance, 0);
  // the ladder: secured debt by the calendar year it comes due, next ten years
  const y0 = START_YEAR + Math.floor(game.month / 12);
  const ladder = Array.from({ length: 10 }, (_, i) => ({ y: y0 + i, v: 0 }));
  for (const r of dated) {
    const i = Math.floor((r.maturesM! / 12)) + START_YEAR - y0;
    if (i >= 0 && i < 10) ladder[i].v += r.balance;
  }
  const top = Math.max(1, ...ladder.map((l) => l.v));
  return (
    <div className="nx-place">
      <StatStrip>
        <Stat label="Debt"><Figure value={book.total} fmt="usd" drill="debt" /></Stat>
        <Stat label="Due ≤ 3y"><Figure value={book.wall} fmt="usd" drill="debt" tone={book.secured > 0 && book.wall / book.secured > 0.35 ? "neg" : undefined} /></Stat>
        <Stat label="Avg rate"><Figure value={wRate} fmt="pctv" drill="rate" /></Stat>
        <Stat label="Avg life"><Figure value={wMat} fmt="n" text={wMat !== null ? wMat.toFixed(1) + " y" : "—"} drill="debt" /></Stat>
        <Stat label="Floating"><Figure value={bal > 0 ? floatBal / bal : null} fmt="pct" drill="debt" /></Stat>
        <Stat label="Line"><Figure value={game.loc?.balance ?? 0} fmt="usd" drill="debt" /></Stat>
        <Stat label="Line limit"><Figure value={lim} fmt="usd" text={`${usd(lim)} · ${locRate(game).toFixed(2)}%`} /></Stat>
      </StatStrip>
      <div className="nx-box">
        <div className="nx-box-head">Maturities</div>
        <div className="nx-ladder">
          {ladder.map((l) => (
            <div key={l.y} className="nx-ladder-col" title={usd(l.v)}>
              <span className="nx-ladder-v mono">{l.v ? usd(l.v) : ""}</span>
              <span className={"nx-ladder-bar" + (l.y - y0 < 3 ? " nx-warnbar" : "")} style={{ height: `${(l.v / top) * 80}px` }} />
              <span className="nx-ladder-y mono">{l.y}</span>
            </div>
          ))}
        </div>
      </div>
      <DataTable id="capital-overview-loans" cols={cols} rows={rows} rowKey={(r) => r.key} onRow={openLoan} initialSort={{ col: "bal", dir: -1 }} empty="No debt" />
    </div>
  );
}
