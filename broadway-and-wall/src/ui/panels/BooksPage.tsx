import { useMemo, useState } from "react";
import { derive, nwOf } from "@/ui/derive";
import { useStore } from "@/state/store";
import Fold from "@/ui/Fold";
import { monthLabel, START_YEAR, sweepApy } from "@/engine/types";
import type { BooksYear } from "@/engine/types";
import { MILESTONES } from "@/engine/sim";
import { depositsHeld } from "@/engine/leasing";
import { resolveRec } from "@/engine/value";
import { deedMark } from "@/ui/deedMarks";
import {
  balanceSnapshotView, buildBalanceSheet, booksMonthAsYear, pnlView,
  type BalanceSheetView, type PnlView,
} from "@/engine/books";
import { taxAppealQuote, INCOME_TAX_RATE, NOL_SHELTER_CAP } from "@/engine/tax";
import { compFlows } from "@/engine/comps";
import { usd, pct } from "@/ui/format";
import { syndicateView } from "@/engine/syndicate";
import { NWChart, Big, openViewOn } from "@/ui/panels/shared";
import Waterfall from "@/ui/vitals/Waterfall";

type BooksTab = "balance" | "pnl" | "cash";

export function BooksPage() {
  const parcels = useStore((s) => s.parcels)!;
  const game = useStore((s) => s.game)!;
  const focus = useStore((s) => s.focus);
  const setPage = useStore((s) => s.setPage);
  const select = useStore((s) => s.select);
  const [tab, setTab] = useState<BooksTab>("balance");
  // THE SAME NET WORTH THE TOP BAR PRINTS. This read `nwHistory`, the figure
  // stamped at the last tick — so for the rest of any month in which you
  // bought or sold, the tile disagreed with the bar above it ($2.54M against
  // $2.15M on the owner's screen, after a levered purchase). Live, one
  // function, one answer.
  const nw = nwOf(game, parcels);
  const realized = game.exits.reduce((a, e) => a + e.gain, 0);
  const exits = game.exits ?? [];
  const achieved = MILESTONES.filter((m) => game.milestones?.[m.id] !== undefined);
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
      {/* The page opens with the month attributed — where the move came from,
          before the totals that only say how big it was. */}
      <Waterfall />
      <div className="stat-strip" style={{ marginTop: 14 }}>
        <Big label="Net worth" value={usd(nw)} bad={nw < 0} />
        <Big label="Cash" value={usd(game.cash)} bad={game.cash < 0} />
        {depositsHeld(game) > 0 && (
          <Big label="Deposits held" value={usd(depositsHeld(game))}
            title="Liability · included in Cash" />
        )}
        <Big label="Realized gains" value={usd(realized)} bad={realized < 0} />
        <Big label="Taxes paid, lifetime" value={usd(game.taxesPaid ?? 0)} />
        {(game.taxLossCarry ?? 0) > 0 && (
          <Big label="NOL carryforward" value={usd(game.taxLossCarry ?? 0)} />
        )}
        <Big label="Exits" value={String(game.exits.length)} />
      </div>
      <NWChart data={game.nwHistory} />

      <div className="btn-row" style={{ marginBottom: 12 }}>
        <button className={"btn" + (tab === "balance" ? " btn-on" : "")} onClick={() => setTab("balance")}>
          Balance sheet
        </button>
        <button className={"btn" + (tab === "pnl" ? " btn-on" : "")} onClick={() => setTab("pnl")}
          title="Accrual basis · interest, depreciation, gains on sale">
          Income statement
        </button>
        <button className={"btn" + (tab === "cash" ? " btn-on" : "")} onClick={() => setTab("cash")}
          title="Cash basis · incl. principal, purchases, sales, draws">
          Cash flow
        </button>
      </div>

      {tab === "balance" ? <BalanceSheet /> : tab === "pnl" ? <ProfitAndLoss /> : <IncomeStatementTab />}

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
                {appealable.length} building{appealable.length === 1 ? "" : "s"} assessed above market
              </div>
              <div className="mini-list">
                {appealable.slice(0, 4).map((a) => (
                  <button key={a.bbl} className="neighbor" onClick={() => goProperty(a.bbl)}>
                    <span className="neighbor-addr">{a.address}</span>
                    <span className="neighbor-meta mono">
                      {usd(a.annualSavings)} / yr savings · fee {usd(a.fee)}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {(() => {
        const peak = Math.max(0, ...(game.nwHistory ?? [0]));
        const peakAt = (game.nwHistory ?? []).lastIndexOf(peak);
        const flows = compFlows(game, 120).slice(0, 5);
        const failed = (game.rivals ?? [])
          .filter((r) => r.failedM !== undefined)
          .sort((a, b) => (b.failedM ?? 0) - (a.failedM ?? 0))
          .slice(0, 4);
        const decadePrints = [...(game.comps ?? [])]
          .filter((c) => c.sf > 0)
          .sort((a, b) => b.price - a.price)
          .slice(0, 3);
        if (!flows.length && !failed.length && !decadePrints.length && peak <= 0) return null;
        return (
          <Fold id="books:census" title="City census" summary="buyers, failures, your peak">
            {/* Four unlabelled lists in a row read as one list of unrelated
                rows; each gets the caption the Waterfall above uses. */}
            {peak > 0 && <div className="wf-kicker">Firm</div>}
            {peak > 0 && (
              <div className="mini-list" style={{ marginBottom: 8 }}>
                <div className="mini-row" style={{ cursor: "default" }}>
                  <span>Peak net worth</span>
                  <span className="mono">{usd(peak)}{peakAt >= 0 ? ` · ${monthLabel(peakAt)}` : ""}</span>
                </div>
                <div className="mini-row" style={{ cursor: "default" }}>
                  <span>Now</span>
                  <span className={"mono" + (nw < peak * 0.7 ? " neg" : "")}>{usd(nw)}</span>
                </div>
              </div>
            )}
            {decadePrints.length > 0 && <div className="wf-kicker">Largest sales</div>}
            {decadePrints.length > 0 && (
              <div className="mini-list" style={{ marginBottom: 8 }}>
                {decadePrints.map((c) => (
                  <div key={`${c.m}:${c.bbl}`} className="mini-row" style={{ cursor: "default" }}>
                    <span>{c.address} · {c.buyer}</span>
                    <span className="mono">{usd(c.price)} · {monthLabel(c.m)}</span>
                  </div>
                ))}
              </div>
            )}
            {flows.length > 0 && <div className="wf-kicker">Net buyers · 10 yrs</div>}
            {flows.length > 0 && (
              <div className="mini-list" style={{ marginBottom: 8 }}>
                {flows.map((f) => (
                  <div key={f.name} className="mini-row" style={{ cursor: "default" }}>
                    <span>{f.name}</span>
                    <span className="mono">
                      bought {usd(f.bought)} · sold {usd(f.sold)} · net {f.net >= 0 ? "+" : "−"}{usd(Math.abs(f.net))}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {failed.length > 0 && <div className="wf-kicker">Failed firms</div>}
            {failed.length > 0 && (
              <div className="mini-list">
                {failed.map((r) => (
                  <div key={r.id} className="mini-row" style={{ cursor: "default" }}>
                    <span>Failed · {r.name}</span>
                    <span className="mono">{monthLabel(r.failedM!)}</span>
                  </div>
                ))}
              </div>
            )}
            <button className="btn" onClick={() => { openViewOn("news", "prints"); setPage("news"); }}>All sales →</button>
          </Fold>
        );
      })()}

      {/* Dispositions and milestones were second copies: every exit is on
          Portfolio's realized record and every milestone on The Record's
          strip. The ledger points at them rather than repeating them. */}
      <div className="hint" style={{ marginTop: 18 }}>
        {exits.length ? `${exits.length} exit${exits.length === 1 ? "" : "s"} · ` : ""}
        <button type="button" className="linkish" onClick={() => setPage("portfolio")}>realized record →</button>
        {" · "}{achieved.length} of {MILESTONES.length} milestones ·{" "}
        <button type="button" className="linkish" onClick={() => setPage("firm")}>The Record →</button>
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
 * December of each year is frozen so you can reopen last year's close.
 */
function BalanceSheet() {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const focus = useStore((s) => s.focus);
  const history = game.balanceHistory ?? [];
  // Prior calendar year only — the December you just closed while still in
  // that December is "today", not last year.
  const curYr = Math.floor(game.month / 12);
  const lastYear = [...history].reverse().find((b) => Math.floor(b.m / 12) < curYr) ?? null;
  const [view, setView] = useState<"today" | "yearEnd">("today");

  const live = derive(game, "books.balanceSheet", () => buildBalanceSheet(game, parcels), [parcels]);
  const sheet: BalanceSheetView = view === "yearEnd" && lastYear
    ? balanceSnapshotView(lastYear)
    : live;
  const holdings = Object.values(game.holdings);
  const showingHistory = sheet.historical;

  return (
    <div>
      <div className="page-section">
        <div className="page-section-head">
          Balance sheet · {showingHistory ? `year-end ${monthLabel(sheet.m)}` : monthLabel(game.month)}
        </div>
        <div className="btn-row" style={{ marginBottom: 10 }}>
          <button
            type="button"
            className={"btn btn-sm" + (view === "today" ? " btn-on" : "")}
            onClick={() => setView("today")}
          >
            Today
          </button>
          <button
            type="button"
            className={"btn btn-sm" + (view === "yearEnd" ? " btn-on" : "")}
            disabled={!lastYear}
            title={lastYear
              ? `Frozen marks from ${monthLabel(lastYear.m)}`
              : "Available after first December close"}
            onClick={() => lastYear && setView("yearEnd")}
          >
            {lastYear ? `Last year-end · ${monthLabel(lastYear.m)}` : "Last year-end"}
          </button>
        </div>
        <div className="hint">
          {showingHistory
            ? `December marks, frozen · holdings detail shows today`
            : `Net worth ${usd(sheet.nwEngine)}`}
        </div>
        <BalanceSheetTables sheet={sheet} />
        {sheet.propGross > 0 && (
          <div className="hint">
            Portfolio LTV {((sheet.mortgages / sheet.propGross) * 100).toFixed(0)}%
            {sheet.locBal > 0 ? ` · line ${((sheet.locBal / Math.max(1, sheet.locLim)) * 100).toFixed(0)}% drawn` : ""}
          </div>
        )}
      </div>

      {!showingHistory && sheet.cipN > 0 && (
        <div className="page-section">
          <div className="page-section-head">Construction in progress · {sheet.cipN} job{sheet.cipN === 1 ? "" : "s"}</div>
          <div>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Site</th>
                  <th className="num">Sunk</th>
                  <th className="num">Loan</th>
                  <th className="num">Budget</th>
                </tr>
              </thead>
              <tbody>
                {Object.values(game.developments ?? {}).map((d) => {
                  const rec = resolveRec(parcels, game, d.bbl);
                  const sunk = Math.max(0, (d.equitySpent ?? 0) + (d.drawn ?? 0) - (d.reserveUsed ?? 0));
                  return (
                    <tr key={d.bbl} style={{ cursor: "pointer" }} onClick={() => focus(d.bbl, true)}>
                      <td>
                        <div>{rec?.address ?? d.bbl}</div>
                        <div className="dim" style={{ fontSize: 11 }}>{d.use} · delivers {monthLabel(d.deliverM)}</div>
                      </td>
                      <td className="num">{usd(sunk)}</td>
                      <td className="num">{d.loanBalance ? usd(d.loanBalance) : "—"}</td>
                      <td className="num dim">
                        {usd(d.costTotal)}
                        <div className="dim" style={{ fontSize: 11 }}>{usd(d.drawn)} / {usd(d.commitment)}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!showingHistory && (
        <div className="page-section">
          <div className="page-section-head">Holdings detail · {holdings.length} deed{holdings.length === 1 ? "" : "s"}</div>
          <div>
            {/* ONE EQUITY, ONE ANSWER. The rows used to read value less the senior
                loan at 100% for every deed, fund and partner deeds included, and
                summed to a number the balance sheet above never shows. Rows now
                carry the whole stack (mezz too) and a "your share" column that
                consolidates the way the sheet does: a JV partner owns its slice;
                a fund deed is the LPs' until the waterfall says otherwise, so the
                vehicle is one line — your interest in it — not the sum of its
                deeds. */}
            <table className="tbl">
              <thead>
                <tr>
                  <th>Address</th>
                  <th className="num">Value</th>
                  <th className="num">Debt</th>
                  <th className="num">Deed equity</th>
                  <th className="num" title="Net of JV share · fund deeds via fund interest">Your share</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const liveFund = !!game.fund && !game.fund.settled;
                  const groups: { key: string; label: string; rows: typeof holdings }[] = [
                    { key: "own", label: "Balance sheet", rows: holdings.filter((h) => !(liveFund && h.fundOwned)) },
                    { key: "fund", label: "Fund", rows: liveFund ? holdings.filter((h) => h.fundOwned) : [] },
                  ].filter((g) => g.rows.length);
                  return groups.flatMap((g) => {
                    let totEq = 0, totMine = 0;
                    const rows = g.rows.map((h) => {
                      const rec = resolveRec(parcels, game, h.bbl);
                      if (!rec) return null;
                      const v = deedMark(game, parcels, h.bbl).v;
                      const debt = (h.loan?.balance ?? 0) + (h.mezz?.balance ?? 0);
                      const eq = v - debt;
                      const ltv = v > 0 ? debt / v : 0;
                      const jv = h.jv?.share ?? 0;
                      const syn = syndicateView(game, parcels, h.bbl);
                      const mine = g.key === "fund" ? null : syn ? syn.yours : eq * (1 - jv);
                      totEq += eq;
                      if (mine !== null) totMine += mine;
                      return (
                        <tr key={h.bbl} style={{ cursor: "pointer" }} onClick={() => focus(h.bbl, true)}>
                          <td>
                            <div>{rec.address ?? h.bbl}</div>
                            <div className="dim" style={{ fontSize: 11 }}>{rec.class} · basis {usd(h.costBasis ?? 0)}{jv > 0 ? ` · JV, partner ${Math.round(jv * 100)}%` : ""}</div>
                          </td>
                          <td className="num">{usd(v)}</td>
                          <td className={"num" + (ltv > 0.75 ? " neg" : "")}>
                            {debt ? usd(debt) : "—"}
                            {debt ? <div className="dim" style={{ fontSize: 11 }}>{(ltv * 100).toFixed(0)}% LTV{h.mezz ? " incl. mezz" : ""}</div> : null}
                          </td>
                          <td className={"num" + (eq < 0 ? " neg" : "")}>{usd(eq)}</td>
                          <td className={"num" + ((mine ?? 0) < 0 ? " neg" : "")}>{mine === null ? <span className="dim">via fund</span> : usd(mine)}</td>
                        </tr>
                      );
                    });
                    const fundMine = g.key === "fund" ? (sheet.fundInterest ?? 0) : totMine;
                    return [
                      <tr key={`h-${g.key}`}><td colSpan={5} className="dim" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", paddingTop: 10 }}>{g.label} · {g.rows.length}</td></tr>,
                      ...rows,
                      <tr key={`t-${g.key}`} style={{ fontWeight: 600 }}>
                        <td>{g.key === "fund" ? "Your fund interest" : "Your equity"}</td>
                        <td /><td />
                        <td className={"num" + (totEq < 0 ? " neg" : "")}>{usd(totEq)}</td>
                        <td className={"num" + (fundMine < 0 ? " neg" : "")} title={g.key === "fund" ? "Co-invest + promote at NAV" : undefined}>{usd(fundMine)}</td>
                      </tr>,
                    ];
                  });
                })()}
                {!holdings.length && (
                  <tr><td colSpan={5} className="dim">No holdings.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function BalanceSheetTables({ sheet }: { sheet: BalanceSheetView }) {
  return (
    <>
      <table className="tbl tbl-stmt">
        <thead>
          <tr><th>Assets</th><th className="num">Amount</th></tr>
        </thead>
        <tbody>
          <Row k="Cash" v={sheet.cash} note={sheet.cash < 0 ? "overdrawn" : "operating account"} bad={sheet.cash < 0} />
          <Row k="Real estate (gross)" v={sheet.propGross} note={`${sheet.bldgCount} building${sheet.bldgCount === 1 ? "" : "s"}, ${sheet.landCount} land parcel${sheet.landCount === 1 ? "" : "s"}`} />
          {Object.entries(sheet.byClass).sort((a, b) => b[1].gross - a[1].gross).map(([cls, x]) => (
            <Row key={cls} k={cls === "land" ? " Land / sites" : ` ${cls.charAt(0).toUpperCase()}${cls.slice(1)}`} v={x.gross} sub note={`${x.n} deed${x.n === 1 ? "" : "s"} · ${usd(x.debt)} mortgaged`} />
          ))}
          {sheet.cipN > 0 && (
            <Row k="Construction in progress" v={sheet.cip} note={`${sheet.cipN} job${sheet.cipN === 1 ? "" : "s"} · cost to date`} />
          )}
          {sheet.noteCount > 0 && (
            <Row k="Notes receivable" v={sheet.notesVal} note={`${sheet.noteCount} note${sheet.noteCount === 1 ? "" : "s"} · lower of cost and collateral`} />
          )}
          {(sheet.fundInterest ?? 0) > 0 && (
            <Row k="Fund interest" v={sheet.fundInterest!} note={`co-invest + promote at NAV · ${sheet.fundDeeds ?? 0} fund deed${sheet.fundDeeds === 1 ? "" : "s"}`} />
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
          {(sheet.mezz ?? 0) > 0 && <Row k="Mezzanine" v={sheet.mezz!} note="subordinate" bad />}
          {sheet.cipDebt > 0 && <Row k="Construction loans" v={sheet.cipDebt} sub />}
          {sheet.facility > 0 && <Row k="Cross-collateral facility" v={sheet.facility} note="cross-collateralized" bad />}
          <Row k="Line of credit drawn" v={sheet.locBal} note={`limit ${usd(sheet.locLim)} · ${pct(sheet.rate)}`} bad={sheet.locBal > 0} />
          {sheet.deposits > 0 && (
            <Row k="Tenant deposits held" v={sheet.deposits} note="refundable" />
          )}
          {(sheet.partners ?? 0) !== 0 && <Row k="JV partners' share" v={sheet.partners!} note="partner equity in JV deeds" />}
          <Row k="Total liabilities" v={sheet.totalLiab} strong rule />
          <Row k="Equity (assets − liabilities)" v={sheet.equity} strong rule bad={sheet.equity < 0} />
        </tbody>
      </table>
    </>
  );
}

function IncomeStatementTab() {
  const years = [...(useStore((s) => s.game)!.books ?? [])].reverse().slice(0, 15);
  return (
    <div>
      <IncomeStatement />
      <div className="page-section">
        <div className="page-section-head">Ledger by year</div>
        <div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Year</th>
                <th className="num">NOI</th>
                <th className="num">Debt</th>
                <th className="num">Spend</th>
                <th className="num">Trades</th>
                <th className="num">Net</th>
              </tr>
            </thead>
            <tbody>
              {years.map((b) => {
                const net = b.noi + (b.interest ?? 0) + (b.borrowed ?? 0) - b.debtSvc - b.leasing - b.capex - (b.ga ?? 0) - b.dev - b.taxes - b.bought + b.sold
                  + (b.lpCalled ?? 0) + (b.fees ?? 0) - (b.lpDistributed ?? 0);
                return (
                  <tr key={b.yr} style={{ cursor: "default" }}>
                    <td className="mono">{START_YEAR + b.yr}</td>
                    <td className="num">
                      {usd(b.noi)}
                      {(b.interest || b.borrowed) ? (
                        <div className="dim" style={{ fontSize: 11 }}>
                          {b.interest ? `int ${usd(b.interest)}` : ""}
                          {b.interest && b.borrowed ? " · " : ""}
                          {b.borrowed ? `drew ${usd(b.borrowed)}` : ""}
                        </div>
                      ) : null}
                    </td>
                    <td className="num">{b.debtSvc ? usd(-b.debtSvc) : "—"}</td>
                    <td className="num">
                      {usd((b.leasing ?? 0) + (b.capex ?? 0) + (b.ga ?? 0) + (b.dev ?? 0) + (b.taxes ?? 0))}
                      <div className="dim" style={{ fontSize: 11 }}>
                        {[
                          b.leasing ? `lease ${usd(b.leasing)}` : null,
                          b.capex ? `capex ${usd(b.capex)}` : null,
                          b.ga ? `g&a ${usd(b.ga)}` : null,
                          b.dev ? `dev ${usd(b.dev)}` : null,
                          b.taxes ? `tax ${usd(b.taxes)}` : null,
                        ].filter(Boolean).join(" · ") || "—"}
                      </div>
                    </td>
                    <td className="num">
                      {b.bought || b.sold ? (
                        <>
                          {b.bought ? usd(-b.bought) : "—"}
                          {b.sold ? <div className="dim" style={{ fontSize: 11 }}>sold {usd(b.sold)}</div> : null}
                        </>
                      ) : "—"}
                    </td>
                    <td className={"num" + (net < 0 ? " neg" : "")}>{usd(net)}</td>
                  </tr>
                );
              })}
              {!years.length && <tr><td colSpan={6} className="dim">No data yet.</td></tr>}
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
 *
 * Period toggle: yearly is the firm year; monthly is the same buckets for one
 * month, so a loud December does not hide inside a quiet year.
 */
export function IncomeStatement() {
  const game = useStore((s) => s.game)!;
  const books = game.books ?? [];
  const months = game.booksMonthly ?? [];
  const [period, setPeriod] = useState<"year" | "month">("year");
  const [yr, setYr] = useState<number | null>(null);
  const [mo, setMo] = useState<number | null>(null);

  if (!books.length && !months.length) {
    return (
      <div className="page-section">
        <div className="page-section-head">Cash flow</div>
        <div className="hint">No data yet.</div>
      </div>
    );
  }

  const yearCur = books.find((b) => b.yr === yr) ?? books[books.length - 1];
  const yearPrior = yearCur ? books.find((b) => b.yr === yearCur.yr - 1) : undefined;
  const monthCur = months.find((b) => b.m === mo) ?? months[months.length - 1];
  // Prior month may have aged out of the keep window — fine; the vs column blanks.
  const priorMonth = monthCur
    ? [...months].reverse().find((b) => b.m < monthCur.m)
    : undefined;

  const usingMonth = period === "month" && !!monthCur;
  const cur: BooksYear | undefined = usingMonth
    ? booksMonthAsYear(monthCur)
    : yearCur;
  const prior: BooksYear | undefined = usingMonth
    ? (priorMonth ? booksMonthAsYear(priorMonth) : undefined)
    : yearPrior;
  const partial = !usingMonth && !!yearCur
    && yearCur.yr === Math.floor(game.month / 12) && game.month % 12 !== 0;
  const monthsIn = partial ? game.month % 12 : 12;
  const headLabel = usingMonth && monthCur
    ? monthLabel(monthCur.m)
    : yearCur
      ? `${START_YEAR + yearCur.yr}${partial ? ` · ${monthsIn} month${monthsIn === 1 ? "" : "s"} YTD` : ""}`
      : "—";
  const vsLabel = usingMonth
    ? (priorMonth ? monthLabel(priorMonth.m) : "—")
    : (yearPrior ? String(START_YEAR + yearPrior.yr) : "—");

  const opCf = (b: BooksYear) => b.noi - b.leasing - b.capex - b.ga;
  const afterDebt = (b: BooksYear) => opCf(b) - b.debtSvc + (b.interest ?? 0) + (b.borrowed ?? 0);
  const investing = (b: BooksYear) => b.sold - b.bought - b.dev;
  // INVESTORS' MONEY MOVES THE ACCOUNT TOO: capital called in from syndicate
  // and fund investors, distributions paid out to them, and the deal fees the
  // sponsor charges (which development booked as spend). The same identity the
  // conservation test reconciles against cash (test/conserve.mjs IN / OUT).
  const investors = (b: BooksYear) => (b.lpCalled ?? 0) + (b.fees ?? 0) - (b.lpDistributed ?? 0);
  const bottom = (b: BooksYear) => afterDebt(b) + investing(b) - b.taxes + investors(b);

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

  const recentMonths = months.slice(-12);

  return (
    <div className="page-section">
      <div className="page-section-head">Cash flow · {headLabel}</div>
      <div className="btn-row" style={{ marginBottom: 10 }}>
        <button
          type="button"
          className={"btn btn-sm" + (period === "year" ? " btn-on" : "")}
          onClick={() => setPeriod("year")}
        >
          Yearly
        </button>
        <button
          type="button"
          className={"btn btn-sm" + (period === "month" ? " btn-on" : "")}
          disabled={!months.length}
          title={months.length ? "By month" : "No monthly data yet"}
          onClick={() => months.length && setPeriod("month")}
        >
          Monthly
        </button>
      </div>
      <div className="hint">Above <em>property cash flow</em>: operations · below: financing, investing, tax</div>
      <div className="btn-row">
        {period === "year"
          ? books.slice(-8).map((b) => (
            <button key={b.yr} className={"btn btn-sm" + (yearCur && b.yr === yearCur.yr ? " btn-on" : "")} onClick={() => setYr(b.yr)}>
              {START_YEAR + b.yr}
            </button>
          ))
          : recentMonths.map((b) => (
            <button
              key={b.m}
              className={"btn btn-sm" + (monthCur && b.m === monthCur.m ? " btn-on" : "")}
              onClick={() => setMo(b.m)}
            >
              {monthLabel(b.m)}
            </button>
          ))}
      </div>
      {!cur ? (
        <div className="hint">No data for this period.</div>
      ) : (
        <>
          <table className="tbl tbl-stmt">
            <thead>
              <tr><th>{headLabel}</th><th className="num">Amount</th><th className="num">vs {vsLabel}</th></tr>
            </thead>
            <tbody>
              <L k="Net operating income" v={cur.noi} note="rent less opex and property tax" />
              <L k="Leasing costs" v={-cur.leasing} sub note="TI and commissions" />
              <L k="Capital expenditure" v={-cur.capex} sub note="roofs, systems, make-ready" />
              <L k="Firm overhead" v={-cur.ga} sub note="asset management, accounting, legal" />
              <L k="Property cash flow" v={opCf(cur)} strong rule />
              <L k="Debt service" v={-cur.debtSvc} sub note="interest, amortization, fees, paydowns" />
              <L k="Interest on cash" v={cur.interest ?? 0} sub note={`sweep ${(sweepApy(game.econ) * 100).toFixed(1)}% (policy − 0.4pt) · ordinary income`} />
              <L k="Debt drawn" v={cur.borrowed ?? 0} sub note="cash-out refi and facility draws" />
              <L k="Cash flow after debt" v={afterDebt(cur)} strong rule />
              <L k="Development" v={-cur.dev} sub note="equity, construction carry, overruns" />
              <L k="Acquisitions" v={-cur.bought} sub note="equity at closing" />
              <L k="Disposition proceeds" v={cur.sold} sub note="net of loan payoff and penalties" />
              <L k="Taxes" v={-cur.taxes} sub note={`${(INCOME_TAX_RATE * 100).toFixed(0)}% blended personal rate on income · §1250 recapture and gains on exits`} />
              {investors(cur) !== 0 && (
                <L k="Investors and fees" v={investors(cur)} sub note="LP capital in − distributions + sponsor fees" />
              )}
              <L k="Change in cash" v={bottom(cur)} strong rule />
            </tbody>
          </table>
          <div className="hint">
            {(() => {
              const p = opCf(cur), a = afterDebt(cur), b = bottom(cur);
              const cover = cur.debtSvc > 0 ? (cur.noi / cur.debtSvc) : null;
              const span = usingMonth ? "this month" : "this year";
              const parts: string[] = [];
              if (p <= 0) parts.push(`Property cash flow negative ${span}, before debt service.`);
              else if (a < 0 && p > 0) parts.push("Debt service exceeds property cash flow.");
              else if (a > 0) parts.push(`${usd(a)} after debt service.`);
              if (cover !== null) parts.push(`DSCR ${cover.toFixed(2)}×.`);
              if (cur.dev > 0 && b < 0 && a > 0) parts.push(`Cash down on ${usd(cur.dev)} of development.`);
              if (cur.taxes > 0 && cur.sold > 0) parts.push(`${usd(cur.taxes)} tax on ${usd(cur.sold)} of sales.`);
              // THE SHELTER, SAID OUT LOUD. Depreciation is designed to throw a
              // paper loss, and the loss carries forward with no expiry — so a
              // development year or a soft year is banked capacity, not a
              // wasted one. A player who cannot see the bank cannot plan the
              // year they spend it in.
              const carry = game.taxLossCarry ?? 0;
              if (carry > 0) {
                parts.push(
                  `NOL ${usd(carry)} · no expiry · offsets up to ${(NOL_SHELTER_CAP * 100).toFixed(0)}% of taxable income per year.`,
                );
              }
              return parts.join(" ");
            })()}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * THE PROFIT AND LOSS — the firm's accrual income statement, years side by
 * side the way a company report lays them out.
 *
 * The cash-flow statement next to it answers "where did the money go"; this
 * answers "did the firm make money". They differ for honest reasons and the
 * page says which: principal repaid, buildings bought, loans drawn and sale
 * proceeds are cash but not profit; depreciation and interest accrued on a
 * file in foreclosure are profit-and-loss but not cash. Leasing costs and
 * capital work are expensed as incurred — the simple statement, and the one
 * that shows a heavy re-letting year as the expensive year it was.
 */
function ProfitAndLoss() {
  const game = useStore((s) => s.game)!;
  const years = useMemo(
    () => [...(game.pnl ?? [])].sort((a, b) => b.yr - a.yr).slice(0, 4).map((e) => pnlView(game, e)),
    [game],
  );
  if (!years.length) {
    return (
      <div className="page-section">
        <div className="page-section-head">Income statement</div>
        <div className="hint">No data yet.</div>
      </div>
    );
  }
  const cur = years[0];
  type Key = keyof Omit<PnlView, "yr" | "label" | "months" | "deprFinal">;
  const line = (k: string, key: Key, opts: { sign?: 1 | -1; sub?: boolean; strong?: boolean; rule?: boolean; note?: string } = {}) => (
    <tr className={opts.rule ? "is-rule" : undefined}>
      <td style={{ paddingLeft: opts.sub ? 22 : 0, fontWeight: opts.strong ? 600 : undefined }}>
        {k}{opts.note && <span className="dim" style={{ fontWeight: 400 }}> · {opts.note}</span>}
      </td>
      {years.map((y) => {
        const v = (opts.sign ?? 1) * y[key];
        const r = Math.round(v);
        return (
          <td key={y.yr} className={"num" + (r < 0 ? " neg" : "") + (opts.strong ? " is-strong" : "")}>
            {r === 0 ? "—" : (r < 0 ? "(" : "") + usd(Math.abs(r)) + (r < 0 ? ")" : "")}
          </td>
        );
      })}
    </tr>
  );
  const margin = cur.totalRev > 0 ? cur.net / cur.totalRev : null;
  const cover = cur.intExp > 0 ? cur.ebitda / cur.intExp : null;
  return (
    <div className="page-section">
      <div className="page-section-head">Income statement · accrual basis</div>
      <div className="hint">
        Principal, purchases and draws on Cash flow · sales at gain over depreciated basis · fund deeds report via the fund
      </div>
      <table className="tbl tbl-stmt">
        <thead>
          <tr>
            <th></th>
            {years.map((y) => (
              <th key={y.yr} className="num" title={y.months < 12 ? `${y.months} month${y.months === 1 ? "" : "s"} YTD` : "full year"}>
                {y.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {line("Rental revenue", "rev", { sub: true, note: "rent, recoveries, other income" })}
          {line("Interest on cash", "intInc", { sub: true })}
          {years.some((y) => y.fees) && line("Syndicate fees", "fees", { sub: true, note: "development and asset management" })}
          {line("Total revenue", "totalRev", { strong: true, rule: true })}
          {line("Property operating costs", "propOpex", { sign: -1, sub: true, note: "opex, management, property tax, ground rent" })}
          {line("Leasing costs", "leasing", { sign: -1, sub: true, note: "TI and commissions, expensed as signed" })}
          {line("Capital work", "capex", { sign: -1, sub: true, note: "make-ready, programs, renovations" })}
          {line("Firm overhead", "ga", { sign: -1, sub: true, note: "management, accounting, legal" })}
          {line("Total operating expenses", "totalOpex", { sign: -1, strong: true, rule: true })}
          {line("Operating profit before depreciation", "ebitda", { strong: true, rule: true })}
          {line("Depreciation", "depr", { sign: -1, sub: true, note: cur.deprFinal ? "per tax return" : "accrued at prior-year rate · trued up in January" })}
          {line("Operating profit", "ebit", { strong: true, rule: true })}
          {line("Interest expense", "intExp", { sign: -1, sub: true, note: "mortgages, mezzanine, facility, line" })}
          {line("Gain (loss) on sales", "gains", { sub: true, note: "net proceeds over depreciated basis" })}
          {line("JV partners' share", "jv", { sign: -1, sub: true })}
          {line("Profit before tax", "pretax", { strong: true, rule: true })}
          {line("Income and capital-gains tax", "taxes", { sign: -1, sub: true, note: "paid in the year" })}
          {line("Net profit", "net", { strong: true, rule: true })}
        </tbody>
      </table>
      <div className="hint">
        {[
          margin !== null ? `Net margin ${cur.label}: ${(margin * 100).toFixed(0)}%.` : null,
          cover !== null ? `Interest cover ${cover.toFixed(2)}× (EBITDA ÷ interest).` : null,
          cur.leasing + cur.capex > Math.max(0, cur.ebitda + cur.leasing + cur.capex) * 0.5
            ? "Leasing + capex > 50% of pre-capex profit."
            : null,
          cur.net < 0 && cur.depr > -cur.net
            ? "Loss < depreciation: cash-positive before principal."
            : null,
        ].filter(Boolean).join(" ")}
      </div>
    </div>
  );
}
