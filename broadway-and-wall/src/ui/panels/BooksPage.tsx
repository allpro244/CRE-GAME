import { useState } from "react";
import { useStore } from "@/state/store";
import { monthLabel } from "@/engine/types";
import { MILESTONES } from "@/engine/sim";
import { depositsHeld } from "@/engine/leasing";
import { usd } from "@/ui/format";
import { CreditLine } from "@/ui/panels/DebtPage";
import { NewsText } from "@/ui/panels/MarketPage";
import { NWChart, Big } from "@/ui/panels/shared";

export function BooksPage() {
  const game = useStore((s) => s.game)!;
  const focus = useStore((s) => s.focus);
  const nw = game.nwHistory[game.nwHistory.length - 1] ?? 0;
  const realized = game.exits.reduce((a, e) => a + e.gain, 0);
  const years = [...(game.books ?? [])].reverse().slice(0, 15);
  const exits = [...(game.exits ?? [])].reverse().slice(0, 12);
  const achieved = MILESTONES.filter((m) => game.milestones?.[m.id] !== undefined);
  const pending = MILESTONES.filter((m) => game.milestones?.[m.id] === undefined);
  return (
    <div>
      <div className="stat-strip">
        <Big label="Net worth" value={usd(nw)} bad={nw < 0} />
        <Big label="Cash" value={usd(game.cash)} bad={game.cash < 0} />
        {/* NOT YOURS. Deposits arrive as cash at signing and look exactly like
            equity until the tenant leaves and takes them back. Net worth above
            is quoted net of this; the cash figure beside it is not. */}
        {depositsHeld(game) > 0 && (
          <Big label="Deposits held" value={"−" + usd(depositsHeld(game))} />
        )}
        <Big label="Realized gains" value={usd(realized)} bad={realized < 0} />
        <Big label="Taxes paid, lifetime" value={usd(game.taxesPaid ?? 0)} />
        <Big label="Exits" value={String(game.exits.length)} />
      </div>
      <NWChart data={game.nwHistory} />
      <CreditLine />
      {/* THE WAY IN TO THE PAYROLL. Firm overhead is a line on the statement
          below and, since the desk exists, half of it is people with names,
          salaries and a notice period. The books are where you find out what
          the office costs; this is where you find out who is in it. */}
      <div className="btn-row">
        <button className="btn" onClick={() => useStore.getState().setPage("staff")}
          title="Property management, leasing and construction — capacity, the shortlist, and what the slip is costing you">
          The desk · {(game.staff ?? []).length} on the payroll →
        </button>
      </div>
      <IncomeStatement />
      <div className="page-section">
        <div className="page-section-head">The ledger, by year — every line, side by side</div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Year</th><th className="num">NOI</th><th className="num">Bank interest</th><th className="num">Debt svc</th><th className="num">Leasing</th>
                <th className="num">Capex</th><th className="num">G&amp;A</th><th className="num">Development</th><th className="num">Taxes</th>
                <th className="num">Acquisitions</th><th className="num">Dispositions</th><th className="num">Net</th>
              </tr>
            </thead>
            <tbody>
              {years.map((b) => {
                const net = b.noi + (b.interest ?? 0) - b.debtSvc - b.leasing - b.capex - (b.ga ?? 0) - b.dev - b.taxes - b.bought + b.sold;
                return (
                  <tr key={b.yr} style={{ cursor: "default" }}>
                    <td className="mono">{2000 + b.yr}</td>
                    <td className="num">{usd(b.noi)}</td>
                    {/* Booked apart from NOI on purpose: 1% on a bank balance is
                        not property income, and folding it in overstated the
                        yield on every building you own. */}
                    <td className="num dim" title="1.0% a year on positive cash balances">{b.interest ? usd(b.interest) : "—"}</td>
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
              {!years.length && <tr><td colSpan={12} className="dim">Nothing on the books yet — advance a month.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <div className="page-section">
        <div className="page-section-head">The tape</div>
        <div className="news" style={{ maxHeight: 260, overflowY: "auto" }}>
          {game.news.slice(0, 60).map((n, i) => (
            // A story about a place can put the camera on the place: a record
            // groundbreaking is only worth reading if you can go look at it.
            <div
              key={i}
              className={"news-item news-" + n.kind}
              style={n.bbl ? { cursor: "pointer" } : undefined}
              title={n.bbl ? "Fly to it" : undefined}
              onClick={n.bbl ? () => focus(n.bbl!, true) : undefined}
            >
              <span className="news-q mono">{monthLabel(n.q)}</span> <NewsText text={n.text} />{n.bbl ? " ✈" : ""}
            </div>
          ))}
        </div>
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

/**
 * THE INCOME STATEMENT.
 *
 * The ledger below this is a fine spreadsheet and a bad statement: twelve
 * columns wide, operating flows sitting next to investing flows, no subtotals,
 * and no way to answer the two questions anybody actually asks — did the
 * BUILDINGS make money this year, and did the FIRM?
 *
 * Those are different questions and the difference is the entire craft. A
 * portfolio can throw off eleven million of property cash flow and still burn
 * cash, because development ate fourteen. A year that looks catastrophic on
 * the bottom line can be the best year you have had, because the money went
 * into the ground and comes back as a building. So this reads down, the way a
 * statement reads, with the subtotals that separate the two.
 */
export function IncomeStatement() {
  const game = useStore((s) => s.game)!;
  const books = game.books ?? [];
  const [yr, setYr] = useState<number | null>(null);
  if (!books.length) return null;
  const cur = books.find((b) => b.yr === yr) ?? books[books.length - 1];
  const prior = books.find((b) => b.yr === cur.yr - 1);
  const partial = cur.yr === Math.floor(game.month / 12) && game.month % 12 !== 0;
  const monthsIn = partial ? game.month % 12 : 12;

  const opCf = (b: typeof cur) => b.noi - b.leasing - b.capex - b.ga;
  const afterDebt = (b: typeof cur) => opCf(b) - b.debtSvc + (b.interest ?? 0);
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
            "Interest on cash": prior.interest ?? 0, "Cash flow after debt": afterDebt(prior),
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
        Income statement · {2000 + cur.yr}{partial && ` · ${monthsIn} month${monthsIn === 1 ? "" : "s"} in, not a full year`}
      </div>
      <div className="hint">
        The buildings and the firm are two different businesses. Everything above <em>property cash flow</em> is
        what the portfolio produced; everything below it is what you did with the money. A year with a terrible
        bottom line and a strong property line is a year you spent building — which is the good kind of terrible.
      </div>
      <div className="btn-row">
        {books.slice(-8).map((b) => (
          <button key={b.yr} className={"btn btn-sm" + (b.yr === cur.yr ? " btn-on" : "")} onClick={() => setYr(b.yr)}>
            {2000 + b.yr}
          </button>
        ))}
      </div>
      <table className="tbl tbl-stmt">
        <thead>
          <tr><th>{2000 + cur.yr}</th><th className="num">Amount</th><th className="num">vs {prior ? 1999 + cur.yr : "—"}</th></tr>
        </thead>
        <tbody>
          <L k="Net operating income" v={cur.noi} note="rent collected, less operating costs and property tax" />
          <L k="Leasing costs" v={-cur.leasing} sub note="fit-out and commissions" />
          <L k="Capital expenditure" v={-cur.capex} sub note="roofs, systems, make-ready" />
          <L k="Firm overhead" v={-cur.ga} sub note="asset management, accounting, legal" />
          <L k="Property cash flow" v={opCf(cur)} strong rule />
          <L k="Debt service" v={-cur.debtSvc} sub note="interest, amortisation, fees" />
          <L k="Interest on cash" v={cur.interest ?? 0} sub note="1.0% on idle balances" />
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

