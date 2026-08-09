import { useMemo, useState } from "react";
import { useStore } from "@/state/store";
import { monthLabel, START_YEAR } from "@/engine/types";
import { MILESTONES } from "@/engine/sim";
import { depositsHeld } from "@/engine/leasing";
import { collateralAsIs, ownedHoldingValue, netWorth, resolveRec } from "@/engine/value";
import { locLimit, locRate } from "@/engine/credit";
import { taxAppealQuote } from "@/engine/tax";
import { usd, pct } from "@/ui/format";
import { NWChart, Big } from "@/ui/panels/shared";

type BooksTab = "balance" | "income";

export function BooksPage() {
  const parcels = useStore((s) => s.parcels)!;
  const game = useStore((s) => s.game)!;
  const focus = useStore((s) => s.focus);
  const setPage = useStore((s) => s.setPage);
  const select = useStore((s) => s.select);
  const [tab, setTab] = useState<BooksTab>("balance");
  const nw = game.nwHistory[game.nwHistory.length - 1] ?? 0;
  const realized = game.exits.reduce((a, e) => a + e.gain, 0);
  const exits = [...(game.exits ?? [])].reverse().slice(0, 12);
  const achieved = MILESTONES.filter((m) => game.milestones?.[m.id] !== undefined);
  const pending = MILESTONES.filter((m) => game.milestones?.[m.id] === undefined);
  const holdings = Object.values(game.holdings).filter((h) => !game.merged?.[h.bbl]);
  const pendingAppeals = holdings.flatMap((h) => {
    const rec = resolveRec(parcels, game, h.bbl);
    return h.taxAppeal && rec ? [{ bbl: h.bbl, address: rec.address, appeal: h.taxAppeal }] : [];
  });
  const appealable = holdings.flatMap((h) => {
    const q = taxAppealQuote(game, parcels, h.bbl);
    const rec = resolveRec(parcels, game, h.bbl);
    return q && rec ? [{ bbl: h.bbl, address: rec.address, ...q }] : [];
  }).sort((a, b) => b.annualSavings - a.annualSavings);
  const goProperty = (bbl: string) => { select(bbl); focus(bbl); setPage("property"); };
  return (
    <div>
      <div className="stat-strip">
        <Big label="Net worth" value={usd(nw)} bad={nw < 0} />
        <Big label="Cash" value={usd(game.cash)} bad={game.cash < 0} />
        {depositsHeld(game) > 0 && (
          <Big label="Deposits held" value={"−" + usd(depositsHeld(game))} />
        )}
        <Big label="Realized gains" value={usd(realized)} bad={realized < 0} />
        <Big label="Taxes paid, lifetime" value={usd(game.taxesPaid ?? 0)} />
        <Big label="Exits" value={String(game.exits.length)} />
      </div>
      <NWChart data={game.nwHistory} />

      <div className="btn-row" style={{ marginBottom: 12 }}>
        <button className={"btn" + (tab === "balance" ? " btn-on" : "")} onClick={() => setTab("balance")}>
          Balance sheet
        </button>
        <button className={"btn" + (tab === "income" ? " btn-on" : "")} onClick={() => setTab("income")}>
          Income statement
        </button>
        <button className="btn" onClick={() => useStore.getState().setPage("staff")}
          title="Property management, leasing and construction — capacity, the shortlist, and what the slip is costing you">
          The desk · {(game.staff ?? []).length} on the payroll →
        </button>
      </div>

      {tab === "balance" ? <BalanceSheet /> : <IncomeStatementTab />}

      {(pendingAppeals.length > 0 || appealable.length > 0) && (
        <div className="page-section">
          <div className="page-section-head">Property-tax desk</div>
          {pendingAppeals.length > 0 && (
            <div className="mini-list" style={{ marginBottom: 10 }}>
              {pendingAppeals.map(({ bbl, address, appeal }) => (
                <button key={bbl} className="neighbor" onClick={() => goProperty(bbl)}>
                  <span className="neighbor-addr">{address}</span>
                  <span className="neighbor-meta mono">
                    Board sits {monthLabel(appeal.decideM)} · {(appeal.odds * 100).toFixed(0)}% as filed
                  </span>
                </button>
              ))}
            </div>
          )}
          {appealable.length > 0 && (
            <>
              <div className="hint">
                {appealable.length} building{appealable.length === 1 ? "" : "s"} carry assessments materially above today&apos;s market evidence.
              </div>
              <div className="mini-list">
                {appealable.slice(0, 4).map((a) => (
                  <button key={a.bbl} className="neighbor" onClick={() => goProperty(a.bbl)}>
                    <span className="neighbor-addr">{a.address}</span>
                    <span className="neighbor-meta mono">
                      {usd(a.annualSavings)} / yr potential saving · file for {usd(a.fee)}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <div className="page-section">
        <div className="page-section-head">The wire</div>
        <div className="hint">Market and firm news now lives on its own desk — the last {(game.news ?? []).length} items, filterable by kind.</div>
        <button className="btn" onClick={() => setPage("news")}>Open News →</button>
      </div>
      <div className="deals-grid">
        <section className="page-section">
          <div className="page-section-head">Dispositions</div>
          <div className="mini-list">
            {exits.map((e, i) => (
              <div key={i} className="mini-row" style={{ cursor: "default" }}>
                <span>{e.forced ? "⚠ " : ""}{e.address}</span>
                <span className="mono">
                  {usd(e.price)} · {e.gain >= 0 ? "+" : "−"}{usd(Math.abs(e.gain))} · held {((e.soldM - e.boughtM) / 12).toFixed(1)} yrs
                </span>
              </div>
            ))}
            {!exits.length && <div className="hint">No sales yet. The first exit is the education.</div>}
          </div>
        </section>
        <section className="page-section">
          <div className="page-section-head">Milestones · {achieved.length} of {MILESTONES.length}</div>
          <div className="mini-list">
            {achieved.map((m) => (
              <div key={m.id} className="mini-row" style={{ cursor: "default" }}>
                <span>◆ {m.label}</span>
                <span className="mono">{monthLabel(game.milestones[m.id])}</span>
              </div>
            ))}
            {pending.slice(0, 4).map((m) => (
              <div key={m.id} className="mini-row mini-dim" style={{ cursor: "default" }}>
                <span>◇ {m.label}</span>
                <span className="mono dim">—</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

/** One statement line: label, amount, optional note. */
function Row({ k, v, sub, strong, rule, note, bad }: {
  k: string; v: number; sub?: boolean; strong?: boolean; rule?: boolean; note?: string; bad?: boolean;
}) {
  const neg = bad ?? v < 0;
  return (
    <tr className={rule ? "is-rule" : undefined}>
      <td style={{ paddingLeft: sub ? 22 : 0, fontWeight: strong ? 600 : undefined }}>
        {k}{note && <span className="dim" style={{ fontWeight: 400 }}> · {note}</span>}
      </td>
      <td className={"num" + (neg ? " neg" : "") + (strong ? " is-strong" : "")}>
        {v === 0 ? "—" : (v < 0 ? "(" : "") + usd(Math.abs(v)) + (v < 0 ? ")" : "")}
      </td>
    </tr>
  );
}

/**
 * BALANCE SHEET — what you own, what you owe, what is left.
 *
 * Built from the same `netWorth` / `holdingValue` the rest of the engine reads,
 * so the Books page cannot disagree with the TopBar or the lender's sizing.
 */
function BalanceSheet() {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const focus = useStore((s) => s.focus);

  const sheet = useMemo(() => {
    let propGross = 0, mortgages = 0, landOnly = 0, bldgCount = 0, landCount = 0;
    const byClass: Record<string, { n: number; gross: number; debt: number }> = {};
    for (const h of Object.values(game.holdings)) {
      const rec = resolveRec(parcels, game, h.bbl);
      if (!rec) continue;
      const v = ownedHoldingValue(game, parcels, h);
      const debt = h.loan?.balance ?? 0;
      propGross += v;
      mortgages += debt;
      const cls = rec.class === "land" || !(rec.floors > 0) ? "land" : (rec.class ?? "other");
      if (cls === "land") { landOnly += v; landCount++; }
      else { bldgCount++; }
      if (!byClass[cls]) byClass[cls] = { n: 0, gross: 0, debt: 0 };
      byClass[cls].n++;
      byClass[cls].gross += v;
      byClass[cls].debt += debt;
    }

    let cip = 0, cipDebt = 0, cipN = 0;
    for (const d of Object.values(game.developments ?? {})) {
      const sunk = (d.equitySpent ?? 0) + (d.drawn ?? 0) - (d.reserveUsed ?? 0);
      cip += Math.max(0, sunk);
      cipDebt += d.loanBalance ?? 0;
      cipN++;
    }

    let notesVal = 0;
    for (const n of game.notes ?? []) {
      if (n.perf === "performing") { notesVal += n.basis; continue; }
      const rec = resolveRec(parcels, game, n.bbl);
      if (!rec) continue;
      const r = game.rivals?.find((x) => x.id === n.obligorId);
      notesVal += Math.min(n.basis, Math.round(collateralAsIs(rec, game.econ, r?.occ ?? 0.5)));
    }

    const deposits = depositsHeld(game);
    const locBal = game.loc?.balance ?? 0;
    const locLim = locLimit(game, parcels);
    const facility = game.facility?.balance ?? 0;
    const cash = game.cash;
    // Operating cash for the sheet: deposits are a liability against cash.
    const cashOwn = cash; // deposits are still in cash; liability line nets them
    const totalAssets = cashOwn + propGross + Math.max(0, cip - 0) + notesVal;
    // CIP shown gross; construction loan is a liability (cipDebt may already
    // be inside developments — netWorth nets sunk - loanBalance).
    const totalLiab = mortgages + cipDebt + facility + locBal + deposits;
    const equity = totalAssets - totalLiab;
    const nwEngine = netWorth(game, parcels);

    return {
      cash, deposits, propGross, mortgages, landOnly, bldgCount, landCount,
      byClass, cip, cipDebt, cipN, notesVal, noteCount: (game.notes ?? []).length,
      locBal, locLim, facility, totalAssets, totalLiab, equity, nwEngine,
      rate: locRate(game),
    };
  }, [game, parcels]);

  const holdings = Object.values(game.holdings);

  return (
    <div>
      <div className="page-section">
        <div className="page-section-head">Balance sheet · {monthLabel(game.month)}</div>
        <div className="hint">
          Assets at the same values the TopBar, the lender and the desk use — not a second set of books.
          Engine net worth is {usd(sheet.nwEngine)}; the equity line below is assets minus liabilities from the same marks.
        </div>
        <table className="tbl tbl-stmt">
          <thead>
            <tr><th>Assets</th><th className="num">Amount</th></tr>
          </thead>
          <tbody>
            <Row k="Cash" v={sheet.cash} note={sheet.cash < 0 ? "overdrawn — the line should have covered this" : "operating account"} bad={sheet.cash < 0} />
            <Row k="Real estate — gross value" v={sheet.propGross} note={`${sheet.bldgCount} building${sheet.bldgCount === 1 ? "" : "s"}, ${sheet.landCount} land parcel${sheet.landCount === 1 ? "" : "s"}`} />
            {Object.entries(sheet.byClass).sort((a, b) => b[1].gross - a[1].gross).map(([cls, x]) => (
              <Row key={cls} k={cls === "land" ? " Land / sites" : ` ${cls}`} v={x.gross} sub note={`${x.n} deed${x.n === 1 ? "" : "s"} · ${usd(x.debt)} mortgaged`} />
            ))}
            {sheet.cipN > 0 && (
              <Row k="Construction in progress" v={sheet.cip} note={`${sheet.cipN} job${sheet.cipN === 1 ? "" : "s"} — money sunk, not the full budget`} />
            )}
            {sheet.noteCount > 0 && (
              <Row k="Notes receivable" v={sheet.notesVal} note={`${sheet.noteCount} note${sheet.noteCount === 1 ? "" : "s"} · lower of cost and collateral`} />
            )}
            <Row k="Total assets" v={sheet.totalAssets} strong rule />
          </tbody>
        </table>
        <table className="tbl tbl-stmt" style={{ marginTop: 16 }}>
          <thead>
            <tr><th>Liabilities</th><th className="num">Amount</th></tr>
          </thead>
          <tbody>
            <Row k="Mortgages" v={sheet.mortgages} note="secured by individual deeds" bad={sheet.mortgages > sheet.propGross * 0.85} />
            {sheet.cipDebt > 0 && <Row k="Construction loans" v={sheet.cipDebt} sub />}
            {sheet.facility > 0 && <Row k="Cross-collateral facility" v={sheet.facility} note="one loan, many deeds" bad />}
            <Row k="Line of credit drawn" v={sheet.locBal} note={`limit ${usd(sheet.locLim)} · ${pct(sheet.rate)}`} bad={sheet.locBal > 0} />
            {sheet.deposits > 0 && (
              <Row k="Tenant deposits held" v={sheet.deposits} note="not yours — due when they leave" />
            )}
            <Row k="Total liabilities" v={sheet.totalLiab} strong rule />
            <Row k="Equity (assets − liabilities)" v={sheet.equity} strong rule bad={sheet.equity < 0} />
          </tbody>
        </table>
        {sheet.propGross > 0 && (
          <div className="hint">
            Loan-to-value on the real-estate book: {((sheet.mortgages / sheet.propGross) * 100).toFixed(0)}%
            {sheet.locBal > 0 ? ` · Line is ${((sheet.locBal / Math.max(1, sheet.locLim)) * 100).toFixed(0)}% drawn` : ""}.
            {" "}Draw and repay the line on Debt.
          </div>
        )}
      </div>

      {sheet.cipN > 0 && (
        <div className="page-section">
          <div className="page-section-head">Construction in progress · {sheet.cipN} job{sheet.cipN === 1 ? "" : "s"}</div>
          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Site</th>
                  <th>Use</th>
                  <th className="num">Sunk</th>
                  <th className="num">Loan bal</th>
                  <th className="num">Budget</th>
                  <th className="num">Drawn / commit</th>
                  <th className="num">Delivery</th>
                </tr>
              </thead>
              <tbody>
                {Object.values(game.developments ?? {}).map((d) => {
                  const rec = resolveRec(parcels, game, d.bbl);
                  const sunk = Math.max(0, (d.equitySpent ?? 0) + (d.drawn ?? 0) - (d.reserveUsed ?? 0));
                  return (
                    <tr key={d.bbl} style={{ cursor: "pointer" }} onClick={() => focus(d.bbl, true)}>
                      <td>{rec?.address ?? d.bbl}</td>
                      <td className="dim">{d.use}</td>
                      <td className="num">{usd(sunk)}</td>
                      <td className="num">{d.loanBalance ? usd(d.loanBalance) : "—"}</td>
                      <td className="num dim">{usd(d.costTotal)}</td>
                      <td className="num dim">{usd(d.drawn)} / {usd(d.commitment)}</td>
                      <td className="num dim">{monthLabel(d.deliverM)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="page-section">
        <div className="page-section-head">Holdings detail · {holdings.length} deed{holdings.length === 1 ? "" : "s"}</div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Address</th>
                <th>Class</th>
                <th className="num">Value</th>
                <th className="num">Debt</th>
                <th className="num">Equity</th>
                <th className="num">LTV</th>
                <th className="num">Basis</th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((h) => {
                const rec = resolveRec(parcels, game, h.bbl);
                if (!rec) return null;
                const v = ownedHoldingValue(game, parcels, h);
                const debt = h.loan?.balance ?? 0;
                const eq = v - debt;
                const ltv = v > 0 ? debt / v : 0;
                return (
                  <tr key={h.bbl} style={{ cursor: "pointer" }} onClick={() => focus(h.bbl, true)}>
                    <td>{rec.address ?? h.bbl}</td>
                    <td className="dim">{rec.class}</td>
                    <td className="num">{usd(v)}</td>
                    <td className="num">{debt ? usd(debt) : "—"}</td>
                    <td className={"num" + (eq < 0 ? " neg" : "")}>{usd(eq)}</td>
                    <td className={"num" + (ltv > 0.75 ? " neg" : "")}>{debt ? (ltv * 100).toFixed(0) + "%" : "—"}</td>
                    <td className="num dim">{usd(h.costBasis ?? 0)}</td>
                  </tr>
                );
              })}
              {!holdings.length && (
                <tr><td colSpan={7} className="dim">No deeds yet — the balance sheet is cash and whatever the line says.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function IncomeStatementTab() {
  const years = [...(useStore((s) => s.game)!.books ?? [])].reverse().slice(0, 15);
  return (
    <div>
      <IncomeStatement />
      <div className="page-section">
        <div className="page-section-head">The ledger, by year — every line, side by side</div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Year</th><th className="num">NOI</th><th className="num">Bank interest</th><th className="num">Borrowed</th><th className="num">Debt svc</th><th className="num">Leasing</th>
                <th className="num">Capex</th><th className="num">G&amp;A</th><th className="num">Development</th><th className="num">Taxes</th>
                <th className="num">Acquisitions</th><th className="num">Dispositions</th><th className="num">Net</th>
              </tr>
            </thead>
            <tbody>
              {years.map((b) => {
                const net = b.noi + (b.interest ?? 0) + (b.borrowed ?? 0) - b.debtSvc - b.leasing - b.capex - (b.ga ?? 0) - b.dev - b.taxes - b.bought + b.sold;
                return (
                  <tr key={b.yr} style={{ cursor: "default" }}>
                    <td className="mono">{START_YEAR + b.yr}</td>
                    <td className="num">{usd(b.noi)}</td>
                    <td className="num dim" title="1.0% a year on positive cash balances">{b.interest ? usd(b.interest) : "—"}</td>
                    <td className="num dim" title="Cash-out refinance and facility draws">{b.borrowed ? usd(b.borrowed) : "—"}</td>
                    <td className="num">{b.debtSvc ? "−" + usd(b.debtSvc) : "—"}</td>
                    <td className="num">{b.leasing ? "−" + usd(b.leasing) : "—"}</td>
                    <td className="num">{b.capex ? "−" + usd(b.capex) : "—"}</td>
                    <td className="num">{b.ga ? "−" + usd(b.ga) : "—"}</td>
                    <td className="num">{b.dev ? "−" + usd(b.dev) : "—"}</td>
                    <td className="num">{b.taxes ? "−" + usd(b.taxes) : "—"}</td>
                    <td className="num">{b.bought ? "−" + usd(b.bought) : "—"}</td>
                    <td className="num">{b.sold ? usd(b.sold) : "—"}</td>
                    <td className={"num" + (net < 0 ? " neg" : "")}>{usd(net)}</td>
                  </tr>
                );
              })}
              {!years.length && <tr><td colSpan={13} className="dim">Nothing on the books yet — advance a month.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/**
 * THE INCOME STATEMENT.
 *
 * The ledger below this is a fine spreadsheet and a bad statement: twelve
 * columns wide, operating flows sitting next to investing flows, no subtotals,
 * and no way to answer the two questions anybody actually asks — did the
 * BUILDINGS make money this year, and did the FIRM?
 */
export function IncomeStatement() {
  const game = useStore((s) => s.game)!;
  const books = game.books ?? [];
  const [yr, setYr] = useState<number | null>(null);
  if (!books.length) {
    return (
      <div className="page-section">
        <div className="page-section-head">Income statement</div>
        <div className="hint">Nothing on the books yet — advance a month and the year opens.</div>
      </div>
    );
  }
  const cur = books.find((b) => b.yr === yr) ?? books[books.length - 1];
  const prior = books.find((b) => b.yr === cur.yr - 1);
  const partial = cur.yr === Math.floor(game.month / 12) && game.month % 12 !== 0;
  const monthsIn = partial ? game.month % 12 : 12;

  const opCf = (b: typeof cur) => b.noi - b.leasing - b.capex - b.ga;
  const afterDebt = (b: typeof cur) => opCf(b) - b.debtSvc + (b.interest ?? 0) + (b.borrowed ?? 0);
  const investing = (b: typeof cur) => b.sold - b.bought - b.dev;
  const bottom = (b: typeof cur) => afterDebt(b) + investing(b) - b.taxes;

  const L = ({ k, v, sub, strong, rule, note }: {
    k: string; v: number; sub?: boolean; strong?: boolean; rule?: boolean; note?: string;
  }) => (
    <tr className={rule ? "is-rule" : undefined}>
      <td style={{ paddingLeft: sub ? 22 : 0, fontWeight: strong ? 600 : undefined }}>
        {k}{note && <span className="dim" style={{ fontWeight: 400 }}> · {note}</span>}
      </td>
      <td className={"num" + (v < 0 ? " neg" : "") + (strong ? " is-strong" : "")}>
        {v === 0 ? "—" : (v < 0 ? "(" : "") + usd(Math.abs(v)) + (v < 0 ? ")" : "")}
      </td>
      <td className="num dim">
        {prior ? (() => {
          const pv = ({
            "Net operating income": prior.noi, "Leasing costs": -prior.leasing,
            "Capital expenditure": -prior.capex, "Firm overhead": -prior.ga,
            "Property cash flow": opCf(prior), "Debt service": -prior.debtSvc,
            "Interest on cash": prior.interest ?? 0, "Debt drawn": prior.borrowed ?? 0, "Cash flow after debt": afterDebt(prior),
            "Development": -prior.dev, "Acquisitions": -prior.bought,
            "Disposition proceeds": prior.sold, "Taxes": -prior.taxes,
            "Change in cash": bottom(prior),
          } as Record<string, number>)[k];
          if (pv === undefined) return "";
          if (pv === 0) return v === 0 ? "" : "new";
          const d = (v - pv) / Math.abs(pv);
          return (d >= 0 ? "+" : "") + (d * 100).toFixed(0) + "%";
        })() : ""}
      </td>
    </tr>
  );

  return (
    <div className="page-section">
      <div className="page-section-head">
        Income statement · {START_YEAR + cur.yr}{partial && ` · ${monthsIn} month${monthsIn === 1 ? "" : "s"} in, not a full year`}
      </div>
      <div className="hint">
        The buildings and the firm are two different businesses. Everything above <em>property cash flow</em> is
        what the portfolio produced; everything below it is what you did with the money. A year with a terrible
        bottom line and a strong property line is a year you spent building — which is the good kind of terrible.
      </div>
      <div className="btn-row">
        {books.slice(-8).map((b) => (
          <button key={b.yr} className={"btn btn-sm" + (b.yr === cur.yr ? " btn-on" : "")} onClick={() => setYr(b.yr)}>
            {START_YEAR + b.yr}
          </button>
        ))}
      </div>
      <table className="tbl tbl-stmt">
        <thead>
          <tr><th>{START_YEAR + cur.yr}</th><th className="num">Amount</th><th className="num">vs {prior ? START_YEAR - 1 + cur.yr : "—"}</th></tr>
        </thead>
        <tbody>
          <L k="Net operating income" v={cur.noi} note="rent collected, less operating costs and property tax" />
          <L k="Leasing costs" v={-cur.leasing} sub note="fit-out and commissions" />
          <L k="Capital expenditure" v={-cur.capex} sub note="roofs, systems, make-ready" />
          <L k="Firm overhead" v={-cur.ga} sub note="asset management, accounting, legal" />
          <L k="Property cash flow" v={opCf(cur)} strong rule />
          <L k="Debt service" v={-cur.debtSvc} sub note="interest, amortisation, fees, voluntary paydowns" />
          <L k="Interest on cash" v={cur.interest ?? 0} sub note="1.0% on idle balances" />
          <L k="Debt drawn" v={cur.borrowed ?? 0} sub note="cash-out refinance and facility draws" />
          <L k="Cash flow after debt" v={afterDebt(cur)} strong rule />
          <L k="Development" v={-cur.dev} sub note="equity into the ground, construction carry, overruns" />
          <L k="Acquisitions" v={-cur.bought} sub note="equity out the door at closing" />
          <L k="Disposition proceeds" v={cur.sold} sub note="net of loan payoff and penalties" />
          <L k="Taxes" v={-cur.taxes} sub note="income and capital gains" />
          <L k="Change in cash" v={bottom(cur)} strong rule />
        </tbody>
      </table>
      <div className="hint">
        {(() => {
          const p = opCf(cur), a = afterDebt(cur), b = bottom(cur);
          const cover = cur.debtSvc > 0 ? (cur.noi / cur.debtSvc) : null;
          const parts: string[] = [];
          if (p <= 0) parts.push("The portfolio did not cover its own operating costs this year — before a dollar of debt service. That is an occupancy problem or an expense problem, and neither is fixed by borrowing.");
          else if (a < 0 && p > 0) parts.push("The buildings made money and the debt took more than they made. Every month of this comes out of cash or out of the line.");
          else if (a > 0) parts.push(`The portfolio covered its debt with ${usd(a)} to spare.`);
          if (cover !== null) parts.push(`Portfolio coverage ran ${cover.toFixed(2)}× — NOI over debt service, across everything you own.`);
          if (cur.dev > 0 && b < 0 && a > 0) parts.push(`Cash fell because ${usd(cur.dev)} went into construction. That is not a loss; it is a building that is not finished.`);
          if (cur.taxes > 0 && cur.sold > 0) parts.push(`${usd(cur.taxes)} of tax against ${usd(cur.sold)} of disposals — the price of selling rather than exchanging.`);
          return parts.join(" ");
        })()}
      </div>
    </div>
  );
}
