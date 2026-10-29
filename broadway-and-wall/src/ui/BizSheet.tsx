// A BUSINESS'S PAGE, WITH ITS BOOKS (ONE_ECONOMY_PLAN step 9a). Opened from
// any tenant name (BizLink): the income statement by buyer, the balance
// sheet, twelve months of sales, and the "Why?" behind its latest move.
// Numbers first. The books are economy.ts's own (firmBooks), read, never
// written. Lines are last month's, shown a year at that rate.
import { useEffect } from "react";
import { useStore } from "@/state/store";
import { useNext } from "@/ui/next/nextStore";
import { firmBooks } from "@/engine/economy";
import { CREDIT_LABEL, monthLabel } from "@/engine/types";
import { INDUSTRY_INDEX } from "@/engine/industries";
import { usd, sf, pctSigned } from "@/ui/format";
import { WhyButton } from "@/ui/WhyChain";
import { bizPlaces, bizRevHist, bizWhy, supplyChain } from "@/ui/econView";
import "./biz.css";

/** A tiny line, no axes: the shape of the last twelve months. */
export function Spark({ pts, w = 120, h = 28 }: { pts: number[]; w?: number; h?: number }) {
  if (pts.length < 2) return null;
  const lo = Math.min(...pts), hi = Math.max(...pts), span = hi - lo || Math.abs(hi) || 1;
  const xy = pts.map((v, i) => `${(i / (pts.length - 1)) * (w - 4) + 2},${h - 2 - ((v - lo) / span) * (h - 4)}`);
  const up = pts[pts.length - 1] >= pts[0];
  return (
    <svg className="biz-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polyline points={xy.join(" ")} fill="none" stroke={up ? "var(--pos)" : "var(--neg)"} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

/** Open Markets → Industries on one industry's supply chain (the new shell's tab too). */
export function goIndustry(id: string | null) {
  if (id) useNext.getState().setPlaceTab("markets", "industries");
  useStore.getState().openIndustry(id);
}

/** A tenant's name that opens its business page, when it has books; plain text otherwise. */
export function BizLink({ t }: { t: { name: string; fid?: number } }) {
  if (t.fid === undefined) return <>{t.name}</>;
  return (
    <button type="button" className="biz-link" title={`${t.name}: books`}
      onClick={(e) => { e.stopPropagation(); useStore.getState().openBiz(t.fid!); }}>
      {t.name}
    </button>
  );
}

const yr = (v: number) => usd(v * 12);

export function BizSheet() {
  const fid = useStore((s) => s.bizFocus);
  const game = useStore((s) => s.game);
  const parcels = useStore((s) => s.parcels);
  const close = () => useStore.getState().openBiz(null);
  useEffect(() => {
    if (fid === null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [fid]);
  if (fid === null || !game) return null;
  const place = bizPlaces(game).get(fid);
  const b = firmBooks(game, fid);
  const name = place?.t.name ?? "Business";
  const hist = bizRevHist(game, fid);
  const w = place ? bizWhy(game, place.t.name) : null;
  const addr = place?.bbl ? parcels?.[place.bbl]?.address ?? place.bbl : null;
  const profit = b ? b.ebitda - b.interest - b.incomeTax : 0;
  const sc = b ? supplyChain(game, INDUSTRY_INDEX[b.industry as keyof typeof INDUSTRY_INDEX]) : null;
  const topBuyers = sc ? sc.sells.filter((f) => f.ind).slice(0, 3) : [];
  const buyerRows: [string, number][] = b ? [
    ["Households", b.revenueBy.households],
    ["Other firms", b.revenueBy.firms],
    ["City and state", b.revenueBy.government],
    ["Building projects", b.revenueBy.construction],
    ["Out-of-town buyers", b.revenueBy.exports],
  ] : [];
  const chg = hist.length >= 2 && hist[0] > 0 ? hist[hist.length - 1] / hist[0] - 1 : null;
  return (
    <div className="biz-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="biz-sheet" role="dialog" aria-label={`${name} books`}>
        <div className="biz-head">
          <div>
            <div className="biz-kicker">{place?.own ? "Your tenant" : place?.looking ? "Looking for space" : "Business"}</div>
            <div className="biz-title">{name}</div>
            {b && (
              <div className="biz-sub">
                <button type="button" className="biz-link" onClick={() => goIndustry(b.industry)}>{b.label}</button>
                {" · "}{Math.round(b.heads).toLocaleString()} jobs
                {place && <> · credit {CREDIT_LABEL[place.t.credit]}</>}
              </div>
            )}
            {place && (
              <div className="biz-sub">
                {addr && place.bbl
                  ? <button type="button" className="biz-link" onClick={() => { close(); useStore.getState().focus(place.bbl!, true); }}>{addr}</button>
                  : "No space yet"}
                {!place.looking && <> · {sf(place.t.sf)} · ${place.t.rentPsf.toFixed(0)}/sf · ends {monthLabel(place.t.endM)}</>}
              </div>
            )}
          </div>
          <button className="panel-close" aria-label="Close" onClick={close}>×</button>
        </div>

        {!b && <div className="hint">No books yet. They open the month after the town's households are counted.</div>}
        {b && (
          <>
            <div className="biz-stats">
              <div><div className="biz-num">{yr(b.revenue)}</div><div className="biz-lab">sales a year</div></div>
              <div><div className={"biz-num" + (profit < 0 ? " neg" : "")}>{yr(profit)}</div><div className="biz-lab">profit a year</div></div>
              <div><div className="biz-num">{(b.margin * 100).toFixed(1)}%</div><div className="biz-lab">margin before interest</div></div>
              <div>
                <Spark pts={hist} />
                <div className="biz-lab">{chg === null ? "sales, 12 mo" : `sales ${pctSigned(chg)} · ${hist.length} mo`}</div>
              </div>
            </div>

            {w && (
              <div className="biz-why">
                <span className="biz-lab">{monthLabel(w.m)}</span> {w.t}<WhyButton id={w.id} />
              </div>
            )}

            <div className="biz-cols">
              <table className="tbl biz-tbl">
                <thead><tr><th>Income · a year</th><th className="num">$</th><th className="num">%</th></tr></thead>
                <tbody>
                  <tr className="biz-strong"><td>Sales</td><td className="num">{yr(b.revenue)}</td><td className="num">100</td></tr>
                  {buyerRows.filter(([, v]) => v > 0.5).map(([k, v]) => (
                    <tr key={k} className="dim"><td className="biz-ind">{k}</td><td className="num">{yr(v)}</td><td className="num">{(v / (b.revenue || 1) * 100).toFixed(0)}</td></tr>
                  ))}
                  {([["Wages", b.wages], ["Inputs", b.inputs], ["Rent", b.rent], ["Production tax", b.prodTax], ["Interest", b.interest], ["Income tax", b.incomeTax]] as [string, number][]).map(([k, v]) => (
                    <tr key={k}><td>{k}</td><td className="num">{yr(-v)}</td><td className="num">{(v / (b.revenue || 1) * 100).toFixed(0)}</td></tr>
                  ))}
                  <tr className="biz-strong"><td>Profit</td><td className={"num" + (profit < 0 ? " neg" : "")}>{yr(profit)}</td><td className="num">{(profit / (b.revenue || 1) * 100).toFixed(0)}</td></tr>
                  {b.payout > 0 && <tr className="dim"><td className="biz-ind">Paid to owners</td><td className="num">{yr(b.payout)}</td><td /></tr>}
                </tbody>
              </table>
              <div>
                <table className="tbl biz-tbl">
                  <thead><tr><th>Balance sheet</th><th className="num">$</th></tr></thead>
                  <tbody>
                    <tr><td>Cash</td><td className="num">{usd(b.cash)}</td></tr>
                    <tr><td>Debt</td><td className="num">{usd(b.debt)}</td></tr>
                    <tr className="biz-strong"><td>Equity</td><td className={"num" + (b.equity < 0 ? " neg" : "")}>{usd(b.equity)}</td></tr>
                    <tr className="dim"><td>Months of costs in cash</td><td className="num">{((b.cash) / Math.max(1, b.wages + b.inputs + b.rent)).toFixed(1)}</td></tr>
                    <tr className="dim"><td>Debt / yearly profit before interest</td><td className="num">{b.ebitda > 0 ? (b.debt / (b.ebitda * 12)).toFixed(1) + "×" : "—"}</td></tr>
                  </tbody>
                </table>
                {topBuyers.length > 0 && (
                  <div className="hint" style={{ marginTop: 8 }}>
                    Its industry sells most to{" "}
                    {topBuyers.map((f, i) => (
                      <span key={f.key}>{i > 0 && ", "}
                        <button type="button" className="biz-link" onClick={() => goIndustry(f.ind!)}>{f.label}</button>
                      </span>
                    ))}.
                  </div>
                )}
              </div>
            </div>
            <div className="hint">Last month's books at a yearly rate. Sales split by buyer as its industry's are.</div>
          </>
        )}
      </div>
    </div>
  );
}
