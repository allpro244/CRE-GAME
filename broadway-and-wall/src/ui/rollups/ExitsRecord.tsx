import { useMemo } from "react";
import { useStore } from "@/state/store";
import { monthLabel } from "@/engine/types";
import { usd } from "@/ui/format";
import "./rollups.css";

/**
 * THE REALIZED RECORD — every building that has left the book, and what
 * leaving it actually returned.
 *
 * TWO RETURNS, AND THEY ANSWER DIFFERENT QUESTIONS. Price over basis is what
 * the building did. The EQUITY columns are what the owner's money did: every
 * dollar that went into the deed (the closing cheque, leasing, capital, debt
 * service, paydowns) against every dollar it handed back (NOI, refinance
 * draws, net sale proceeds), read off the deed's own cash ledger — levered and
 * before tax. The IRR is solved on those dated flows.
 *
 * WHEN THE EQUITY COLUMNS ARE BLANK, THAT IS THE ANSWER. A deed bought before
 * the ledger existed, taken through a note, or financed inside a crossed pool
 * has no complete record of its own cash, and an IRR computed on part of one
 * would be a made-up number wearing a precise label. Those rows say nothing.
 */
export function ExitsRecord() {
  const game = useStore((s) => s.game);

  const rec = useMemo(() => {
    if (!game) return null;
    const exits = game.exits ?? [];
    if (!exits.length) return null;
    // Newest first — the engine pushes in sale order — and the table caps at
    // thirty rows; the footer still counts the whole record.
    const rows = [...exits].reverse().slice(0, 30);
    const totalGain = exits.reduce((a, e) => a + e.gain, 0);
    const forced = exits.filter((e) => e.forced).length;
    const mults = exits.filter((e) => e.basis > 0).map((e) => e.price / e.basis).sort((a, b) => a - b);
    const median = mults.length
      ? (mults[(mults.length - 1) >> 1] + mults[mults.length >> 1]) / 2
      : null;
    // Equity multiple median over the exits that carry a complete ledger.
    const eq = exits.filter((e) => (e.equityIn ?? 0) > 0)
      .map((e) => (e.equityOut ?? 0) / (e.equityIn as number)).sort((a, b) => a - b);
    const eqMedian = eq.length ? (eq[(eq.length - 1) >> 1] + eq[eq.length >> 1]) / 2 : null;
    return { rows, n: exits.length, totalGain, forced, median, eqMedian, eqN: eq.length };
  }, [game]);

  if (!rec) return null;

  return (
    <div className="page-section">
      <div className="page-section-head">The realized record · {rec.n} exit{rec.n === 1 ? "" : "s"}</div>
      <table className="tbl exits-tbl">
        <thead>
          <tr>
            <th>Property</th>
            <th className="num" title="Cost basis — price paid plus closing costs, net of any 1031 rolled in">Basis</th>
            <th className="num">Price</th>
            <th className="num" title="Sale price against cost basis — realized, before tax. The multiple under it is price over basis: what the building did.">Gain</th>
            <th className="num" title="What your equity did: every dollar you put into the deed (closing equity, leasing, capital, development, debt service, paydowns) against every dollar it handed back (NOI, refinance draws, net sale proceeds). Levered, before tax, with the IRR on the dated flows. Blank when the deed has no complete ledger — bought before it existed, taken through a note, or financed in a crossed pool.">Equity</th>
          </tr>
        </thead>
        <tbody>
          {rec.rows.map((e, i) => (
            <tr key={`${e.bbl}:${e.soldM}:${i}`}>
              <td>
                {e.address}
                <div className="dim" style={{ fontSize: 11 }}>
                  {monthLabel(e.boughtM)} → {monthLabel(e.soldM)} · {((e.soldM - e.boughtM) / 12).toFixed(1)} yrs
                  {e.forced ? " · forced" : ""}
                </div>
              </td>
              <td className="num dim">{usd(e.basis)}</td>
              <td className="num">{usd(e.price)}</td>
              <td className={"num nowrap" + (e.gain < 0 ? " neg" : " exit-pos")}>
                {e.gain >= 0 ? "+" : ""}{usd(e.gain)}
                <div className="dim" style={{ fontSize: 11 }}>{e.basis > 0 ? `${(e.price / e.basis).toFixed(2)}x` : "—"}</div>
              </td>
              {e.equityIn ? (
                <td
                  className={"num nowrap" + ((e.equityOut ?? 0) < e.equityIn ? " neg" : "")}
                  title={`Equity in ${usd(e.equityIn)} · equity back ${usd(e.equityOut ?? 0)} — levered, before tax`}
                >
                  {((e.equityOut ?? 0) / e.equityIn).toFixed(2)}x
                  <div className="dim" style={{ fontSize: 11 }}>
                    {e.irr != null ? `IRR ${(e.irr * 100).toFixed(1)}%` : "IRR —"}
                  </div>
                </td>
              ) : (
                <td className="num dim" title="No complete equity ledger for this deed — no number rather than a wrong one">—</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="exits-foot">
        <span>{rec.rows.length < rec.n ? `showing the last ${rec.rows.length} of ${rec.n}` : `${rec.n} exit${rec.n === 1 ? "" : "s"}`}</span>
        <span>total realized gain{" "}
          <span className={"mono" + (rec.totalGain < 0 ? " neg" : "")}>
            {rec.totalGain >= 0 ? "+" : ""}{usd(rec.totalGain)}
          </span>
        </span>
        {rec.median !== null && <span>median price/basis <span className="mono">{rec.median.toFixed(2)}x</span></span>}
        {rec.eqMedian !== null && (
          <span title={`Over the ${rec.eqN} exit${rec.eqN === 1 ? "" : "s"} with a complete equity ledger`}>
            median equity multiple <span className="mono">{rec.eqMedian.toFixed(2)}x</span>
          </span>
        )}
        <span>forced{" "}
          <span className={"mono" + (rec.forced > 0 ? " neg" : "")}>
            {rec.forced} · {((rec.forced / rec.n) * 100).toFixed(0)}%
          </span>
        </span>
      </div>
      {rec.n >= 200 && (
        <div className="hint">The record keeps the last two hundred; the earliest exits have scrolled off it.</div>
      )}
    </div>
  );
}
