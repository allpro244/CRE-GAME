import { useMemo, useState } from "react";
import { useStore } from "@/state/store";
import { monthLabel } from "@/engine/types";
import type { GameState } from "@/engine/types";
import { takePrivateQuote, takePrivateTerms, type TakePrivateTerms } from "@/engine/takeprivate";
import { productById } from "@/engine/debt";
import { usd, sf } from "@/ui/format";
import { Row } from "@/ui/panels/shared";

// THE ENTITY DESK. Buying a competitor whole — their book, their tenants and
// their cash, their paper paid off at the table. Everything on this card is
// engine output: the quote is `takePrivateQuote` (pure) and the closing terms
// are `takePrivateTerms`, which runs the closing on a copy — so the number
// under "cash you need" is the number the closing will draw, not an estimate
// of it. That run is a few hundred milliseconds on a big book, which is why it
// happens when you ask for it rather than on every keystroke.

const SIT_WORD = {
  distressed: "In arrears — selling under NAV",
  strained: "Near its limits — selling at NAV",
  healthy: "Healthy — sells only for a premium",
} as const;

export function TakePrivateDesk({ firmId }: { firmId: string }) {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const focus = useStore((s) => s.focus);
  const takePrivate = useStore((s) => s.takePrivate);
  const q = useMemo(() => takePrivateQuote(game, parcels, firmId), [game, parcels, firmId]);
  const [open, setOpen] = useState(false);
  const [financing, setFinancing] = useState<"cash" | "debt">("debt");
  const [offer, setOffer] = useState<number | null>(null);
  const [terms, setTerms] = useState<{ key: string; t: TakePrivateTerms } | null>(null);
  if (!q) return null;
  const price = Math.min(offer ?? q.ask, q.ask);
  const key = `${game.month}:${firmId}:${financing}:${price}:${Math.round(game.cash)}`;
  const t = terms?.key === key ? terms.t : null;
  const approached = game.takePrivate?.offer?.firmId === firmId && game.month <= game.takePrivate.offer.expiresM;

  return (
    <div style={{ margin: "8px 0", padding: "8px 10px", border: "1px solid rgba(43,37,26,0.15)", borderRadius: 4 }}>
      <div className="page-section" style={{ marginTop: 0, cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>
        {open ? "▾" : "▸"} Take {q.name} private{approached ? " · their board has called you" : ""}
      </div>
      {!open ? (
        <div className="hint" style={{ margin: 0 }}>
          {q.available
            ? `The board would talk about ${usd(q.ask)} for the company — ${q.deeds.length} buildings, ${usd(q.debt)} of debt repaid at the table.`
            : q.why}
        </div>
      ) : (
        <div onClick={(e) => e.stopPropagation()}>
          <div className="hint">
            {q.situationWhy} Their mortgages carry due-on-sale clauses, and a change of control is a sale: the paper is repaid at par
            at the closing and your own lenders write new loans deed by deed. Their cash comes across at par; the premium is paid on
            the equity in the buildings only.
          </div>
          <div className="grid" style={{ margin: "6px 0" }}>
            <Row k="Situation" v={SIT_WORD[q.situation]} bad={q.situation === "distressed"} />
            <Row k="Deeds, as they convey" v={`${q.deeds.length} · ${usd(q.gross)}`}
              title="Each building marked on the roll and grade the closing hands over — the same valuation the tape's own asks use." />
            {Math.abs(q.bookMark - q.gross) > q.gross * 0.01 && (
              <Row k="The street table's mark" v={usd(q.bookMark)}
                title="The league table marks their book at the firm's portfolio occupancy. Diligence reads each building's own roll, and that is what you would be buying." />
            )}
            <Row k="In-place NOI" v={`${usd(q.noi)} a year · ${q.gross > 0 ? ((q.noi / q.gross) * 100).toFixed(1) : "—"}% on the deeds`} />
            <Row k="Their debt — repaid at close" v={usd(q.debt)} />
            <Row k="Their cash — comes across" v={usd(q.cash)} />
            <Row k="Net asset value" v={usd(q.nav)} strong bad={q.nav <= 0} />
            <Row k="Board's premium on property equity" v={`${((q.premium - 1) * 100).toFixed(0)}%`}
              title={q.premiumWhy.join(" · ")} />
            <Row k="Their ask for the company" v={usd(q.ask)} strong />
          </div>
          {q.premiumWhy.length > 0 && <div className="hint">Premium: {q.premiumWhy.join(" · ")}.</div>}

          <table className="tbl" style={{ margin: "6px 0" }}>
            <thead>
              <tr><th>Building</th><th>Use</th><th className="num">Area</th><th className="num">Let</th><th className="num">NOI</th><th className="num">Value</th></tr>
            </thead>
            <tbody>
              {q.deeds.slice(0, 12).map((d) => (
                <tr key={d.bbl} style={{ cursor: "pointer" }} onClick={() => focus(d.bbl, true)}>
                  <td>{d.address}</td>
                  <td className="dim">{d.cls}</td>
                  <td className="num">{d.land ? "—" : sf(d.sf)}</td>
                  <td className="num">{d.land ? "—" : `${(d.occ * 100).toFixed(0)}%`}</td>
                  <td className="num">{usd(d.noi)}</td>
                  <td className="num">{usd(d.value)}</td>
                </tr>
              ))}
              {q.deeds.length > 12 && (
                <tr><td colSpan={6} className="dim">…and {q.deeds.length - 12} more, {usd(q.deeds.slice(12).reduce((a, d) => a + d.value, 0))}</td></tr>
              )}
            </tbody>
          </table>

          {!q.available ? (
            <div className="hint" style={{ color: "var(--neg, #9b2c2c)" }}>{q.why}</div>
          ) : (
            <>
              <div className="btn-row" style={{ flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                <label className="dim" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  Offer for the equity
                  <input type="number" min={0} step={10000} value={price}
                    onChange={(e) => setOffer(Number(e.target.value))} style={{ width: 140 }} />
                </label>
                <label className="dim" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <select value={financing} onChange={(e) => setFinancing(e.target.value as "cash" | "debt")}>
                    <option value="debt">Finance each deed at its best desk</option>
                    <option value="cash">All cash (and line)</option>
                  </select>
                </label>
                <button className="btn" onClick={() => setTerms({ key, t: takePrivateTerms(game, parcels, q, price, financing) })}>
                  Run the closing numbers
                </button>
              </div>
              {t && <TermsSheet game={game} t={t} />}
              {t && (
                <div className="btn-row" style={{ marginTop: 8 }}>
                  <button className="btn btn-buy" disabled={t.short > 0}
                    title={t.short > 0 ? `Short ${usd(t.short)}` : "The board decides. Under its private floor it refuses and will not take the call for a year."}
                    onClick={() => takePrivate(firmId, price, financing)}>
                    Offer {usd(price)} for {q.name}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function TermsSheet({ game, t }: { game: GameState; t: TakePrivateTerms }) {
  const desks = new Map<string, number>();
  for (const l of t.legs) if (l.principal > 0) desks.set(l.product, (desks.get(l.product) ?? 0) + l.principal);
  return (
    <div className="grid" style={{ margin: "8px 0" }}>
      <Row k="Real estate at" v={usd(t.realEstatePrice)}
        title="Your price for the equity, less the cash that comes across, plus the paper repaid — allocated across the deeds by value for basis and stamps." />
      <Row k="Advisers, lawyers, title (2%)" v={usd(t.closingCosts)} />
      <Row k="Transfer tax on the deeds" v={usd(t.transferTax)}
        title="A controlling-interest transfer is taxed as a conveyance of the property; the buyer pays, as on a JV buyout." />
      <Row k="New mortgages" v={t.loans > 0 ? usd(t.loans) : "none — all cash"} />
      {[...desks.entries()].map(([id, amt]) => (
        <Row key={id} k={`  · ${productById(id).lender}`} v={usd(amt)} />
      ))}
      <Row k="Implied premium over property equity" v={`${((t.premium - 1) * 100).toFixed(1)}%`} />
      <Row k="Cash and line the closing draws" v={usd(t.need)} strong bad={t.short > 0} />
      <Row k="Tenant deposits that come across" v={usd(t.deposits)} title="Cash in, liability up — they are the tenants' money." />
      <Row k="You can raise today" v={usd(t.purse)} bad={t.short > 0} />
      {t.short > 0 && <Row k="Short" v={usd(t.short)} bad strong />}
      <Row k="Priced" v={monthLabel(game.month)} />
    </div>
  );
}

/** The closings on record — the entity desk's exit card. */
export function TakenPrivateRecord() {
  const game = useStore((s) => s.game)!;
  const done = game.takePrivate?.done ?? [];
  if (!done.length) return null;
  return (
    <>
      <div className="page-section">Firms you have taken private · {done.length}</div>
      <table className="tbl" style={{ marginBottom: 10 }}>
        <thead>
          <tr>
            <th>Firm</th><th>Closed</th><th className="num">Buildings</th><th className="num">Deeds</th>
            <th className="num">Debt repaid</th><th className="num">Cash in</th><th className="num">Paid for equity</th>
            <th className="num">vs equity</th><th className="num">Costs</th><th className="num">New loans</th>
          </tr>
        </thead>
        <tbody>
          {[...done].reverse().map((d) => (
            <tr key={d.firmId + d.m}>
              <td>{d.name} <span className="dim">· {d.situation}</span></td>
              <td className="dim">{monthLabel(d.m)}</td>
              <td className="num">{d.deeds}</td>
              <td className="num">{usd(d.gross)}</td>
              <td className="num">{usd(d.debtRetired)}</td>
              <td className="num">{usd(d.cashAcquired)}</td>
              <td className="num">{usd(d.equityPrice)}</td>
              <td className={"num" + (d.premium > 1 ? "" : " pos")}>{`${d.premium >= 1 ? "+" : ""}${((d.premium - 1) * 100).toFixed(0)}%`}</td>
              <td className="num">{usd(d.closingCosts + d.transferTax)}</td>
              <td className="num">{usd(d.newLoans)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
