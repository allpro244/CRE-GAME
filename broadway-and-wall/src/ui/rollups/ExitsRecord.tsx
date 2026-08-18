import { useMemo } from "react";
import { useStore } from "@/state/store";
import { monthLabel } from "@/engine/types";
import { usd } from "@/ui/format";
import "./rollups.css";

/**
 * THE REALIZED RECORD — every building that has left the book, and what
 * leaving it actually returned.
 *
 * WHY THE RETURN COLUMN IS A MULTIPLE AND NOT AN IRR. An exit records four
 * dollars-and-dates facts: what you paid, what you sold for, and when. The
 * years in between — rent collected, capital spent, refinancing proceeds —
 * are not kept per deed, and an IRR computed without them would be a made-up
 * number wearing a precise label. Price over basis is the whole truth the
 * record supports, so that is the whole truth the column claims.
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
    return { rows, n: exits.length, totalGain, forced, median };
  }, [game]);

  if (!rec) return null;

  return (
    <div className="page-section">
      <div className="page-section-head">The realized record · {rec.n} exit{rec.n === 1 ? "" : "s"}</div>
      <div className="scroll-x">
        <table className="tbl exits-tbl">
          <thead>
            <tr>
              <th>Property</th>
              <th>Bought</th>
              <th>Sold</th>
              <th className="num" title="Years between the deed coming on and going off the book">Held</th>
              <th className="num" title="Cost basis — price paid plus closing costs, net of any 1031 rolled in">Basis</th>
              <th className="num">Price</th>
              <th className="num" title="Sale price against cost basis — realized, before tax">Gain</th>
              <th className="num" title="Sale price over cost basis. The rent and capital of the holding years are not recorded per deed, so no annualized return is quoted — a multiple is what the record supports">Multiple</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rec.rows.map((e, i) => (
              <tr key={`${e.bbl}:${e.soldM}:${i}`}>
                <td className="nowrap">{e.address}</td>
                <td className="nowrap dim">{monthLabel(e.boughtM)}</td>
                <td className="nowrap dim">{monthLabel(e.soldM)}</td>
                <td className="num">{((e.soldM - e.boughtM) / 12).toFixed(1)} yrs</td>
                <td className="num dim">{usd(e.basis)}</td>
                <td className="num">{usd(e.price)}</td>
                <td className={"num nowrap" + (e.gain < 0 ? " neg" : " exit-pos")}>
                  {e.gain >= 0 ? "+" : ""}{usd(e.gain)}
                </td>
                <td className="num">{e.basis > 0 ? `${(e.price / e.basis).toFixed(2)}x` : "—"}</td>
                <td>{e.forced ? <span className="chip chip-distress" title="Taken, not sold — a foreclosure, a receiver's sale, or keys handed back">forced</span> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="exits-foot">
        <span>{rec.rows.length < rec.n ? `showing the last ${rec.rows.length} of ${rec.n}` : `${rec.n} exit${rec.n === 1 ? "" : "s"}`}</span>
        <span>total realized gain{" "}
          <span className={"mono" + (rec.totalGain < 0 ? " neg" : "")}>
            {rec.totalGain >= 0 ? "+" : ""}{usd(rec.totalGain)}
          </span>
        </span>
        {rec.median !== null && <span>median multiple <span className="mono">{rec.median.toFixed(2)}x</span></span>}
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
