import { useStore } from "@/state/store";
import { monthLabel } from "@/engine/types";
import { fundRaiseQuote, fundCanBuy, FUND_PREF, FUND_PROMOTE, gpInterestInFund, waterfall, fundReserve } from "@/engine/fund";
import { ownedHoldingValue, resolveRec } from "@/engine/value";
import { usd } from "@/ui/format";
import { Big, Row } from "@/ui/panels/shared";

/**
 * THE FUND — optional second cash account. Balance-sheet path stays default;
 * this panel is how you raise, call, distribute, and choose which purse buys.
 */
export function FundDesk() {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const { raiseFund, callFundCapital, distributeFund, setFundPay } = useStore.getState();
  const q = fundRaiseQuote(game);
  const f = game.fund;
  const live = f && !f.settled;
  const fundDeeds = Object.values(game.holdings).filter((h) => h.fundOwned).length;
  if (!live && !game.fundFailedM && !q.ok && (game.exits ?? []).length < 2) {
    // Quiet until the player has something to show LPs — empty chrome is noise.
    return null;
  }
  return (
    <div className="page-section">
      <div className="page-section-head">The fund</div>
      {game.fundFailedM !== undefined && (
        <div className="hint" style={{ color: "var(--neg, #a33)" }}>
          Nobody will back you again. The last vehicle did not return capital
          ({monthLabel(game.fundFailedM)}). Succession clears the name; nothing else does.
        </div>
      )}
      {live && f ? (
        <>
          <div className="stat-strip">
            <Big label="Vehicle cash" value={usd(f.cash)} />
            <Big label="Called" value={usd(f.called)} />
            <Big label="Uncalled" value={usd(f.uncalled)} />
            <Big label="Distributed" value={usd(f.distributed)} />
            <Big label="Promote paid" value={usd(f.promotePaid)} />
            <Big label="Pref accrued" value={usd(f.prefAccrued)} bad={f.prefAccrued > 0} />
          </div>
          {(() => {
            // WHAT THE VEHICLE IS WORTH, AND WHAT WINDING IT DOWN TODAY PAYS.
            // NAV is the same equity portfolioMark counts (vehicle cash plus
            // each deed's mark less its debt); the sponsor's line is the one
            // already inside the top bar's net worth; the LP line is the
            // waterfall applied to NAV. The success test at wind-down is DPI
            // 1.0x on called capital — this says where the fund stands against it.
            const deeds = Object.values(game.holdings).filter((h) => h.fundOwned).map((h) => {
              const v = ownedHoldingValue(game, parcels, h);
              const debt = (h.loan?.balance ?? 0) + (h.mezz?.balance ?? 0);
              return { h, v, debt, eq: v - debt, addr: resolveRec(parcels, game, h.bbl)?.address ?? h.bbl };
            });
            const nav = f.cash + deeds.reduce((a, d) => a + d.eq, 0);
            const gp = gpInterestInFund(f, nav);
            const w = waterfall(f, Math.max(0, nav));
            const dpi = f.called > 0 ? f.distributed / f.called : 0;
            const tvpi = f.called > 0 ? (f.distributed + Math.max(0, nav)) / f.called : 0;
            const endDpi = f.called > 0 ? (f.distributed + w.pref + w.capital + w.split) / f.called : 0;
            return (
              <>
                <div className="stat-strip">
                  <Big label="Vehicle NAV" value={usd(nav)} bad={nav < 0} />
                  <Big label="Your interest" value={usd(gp)} />
                  <Big label="DPI · TVPI" value={`${dpi.toFixed(2)}× · ${tvpi.toFixed(2)}×`} bad={tvpi < 1} />
                </div>
                <div className={"hint" + (endDpi < 1 ? " neg" : "")}>
                  At today&rsquo;s marks, winding the vehicle down now would return {Math.round(endDpi * 100)}&cent; on each dollar
                  called — {endDpi >= 1 ? "capital back, the fund counts as a success" : "short of capital, and a fund that misses is the last one you raise"}.
                  {f.extendedTo !== undefined
                    ? ` In extension: anything unsold by ${monthLabel(f.extendedTo)} you buy in at NAV.`
                    : ` Life ends ${monthLabel(f.lifeEndM)}; unsold buildings then get a two-year extension, then a buy-in at NAV.`}
                </div>
                {deeds.length > 0 && (
                  <table className="tbl" style={{ marginTop: 8 }}>
                    <thead><tr><th>Vehicle deed</th><th className="num">Mark</th><th className="num">Debt</th><th className="num">Equity</th></tr></thead>
                    <tbody>
                      {deeds.map((d) => (
                        <tr key={d.h.bbl} onClick={() => useStore.getState().openProperty(d.h.bbl, "summary")}>
                          <td>{d.addr}{d.h.sale ? " · listed" : ""}</td>
                          <td className="num">{usd(d.v)}</td>
                          <td className="num">{usd(d.debt)}</td>
                          <td className={"num" + (d.eq < 0 ? " neg" : "")}>{usd(d.eq)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            );
          })()}
          <div className="grid">
            <Row k="Vintage" v={`${monthLabel(f.raisedM)} · $${(f.size / 1e6).toFixed(0)}M`} />
            <Row k="Investment period" v={`ends ${monthLabel(f.investEndM)}${fundCanBuy(game) ? "" : " · closed"}`} />
            <Row k="Fund life" v={`ends ${monthLabel(f.lifeEndM)}`} />
            <Row k="Waterfall" v={`${(FUND_PREF * 100).toFixed(0)}% pref · ${(FUND_PROMOTE * 100).toFixed(0)}% promote`} />
            <Row k="Vehicle deeds" v={`${fundDeeds}`} />
            <Row k="Distributions" v={game.month > f.investEndM
              ? `quarterly, cash over a ${usd(fundReserve(game))} reserve${f.lastDistM !== undefined ? ` · last ${monthLabel(f.lastDistM)}` : ""}`
              : `recycled until ${monthLabel(f.investEndM)}, then quarterly`} />
            {(f.gpAdvance ?? 0) > 0 && (
              <Row k="Your advances to the vehicle" v={`${usd(f.gpAdvance ?? 0)} · repaid before any distribution`} bad />
            )}
          </div>
          <div className="btn-row">
            <button className="btn" disabled={f.uncalled <= 0} title={f.uncalled <= 0 ? "Every committed dollar is already called" : undefined}
              onClick={() => callFundCapital(Math.round(f.uncalled * 0.5))}>
              Call half uncalled
            </button>
            <button className="btn" disabled={f.uncalled <= 0} title={f.uncalled <= 0 ? "Every committed dollar is already called" : undefined}
              onClick={() => callFundCapital(f.uncalled)}>
              Call remainder
            </button>
            <button className="btn" disabled={f.cash < 100_000} title={f.cash < 100_000 ? `The fund holds ${usd(f.cash)} — too little to be worth a distribution` : undefined}
              onClick={() => distributeFund(Math.round(f.cash * 0.5))}>
              Distribute half cash
            </button>
            <button className="btn" disabled={f.cash <= 0} title={f.cash <= 0 ? "The fund holds no cash" : undefined}
              onClick={() => distributeFund(f.cash)}>
              Distribute all cash
            </button>
          </div>
          <div className="btn-row">
            <button className={"btn" + (game.fundPay ? " btn-on" : "")}
              disabled={!fundCanBuy(game) && !game.fundPay}
              onClick={() => setFundPay(!game.fundPay)}>
              {game.fundPay ? "Buying from the vehicle" : "Buy from the vehicle"}
            </button>
          </div>
          <div className="hint">
            Vehicle cash is not yours. NOI and sale proceeds on fund deeds stay in the vehicle;
            the promote only crystallises once the pref is current. Miss returning capital and the street closes.
          </div>
        </>
      ) : (
        <>
          <div className="hint">{q.reason}</div>
          {/* A greyed "Cannot raise" said nothing the line above did not;
              the button appears when there is a raise to press. */}
          {q.ok && (
            <div className="btn-row">
              <button className="btn btn-buy" onClick={() => raiseFund()}>
                Raise ${(q.size / 1e6).toFixed(0)}M
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
