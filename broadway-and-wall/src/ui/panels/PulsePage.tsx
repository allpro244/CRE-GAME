import { useMemo } from "react";
import { useStore } from "@/state/store";
import type { BuiltClass } from "@/engine/types";
import { monthLabel } from "@/engine/types";
import { cityValueToReplacement } from "@/engine/dev";
import { standardsWord, underwritingStandards } from "@/engine/debt";
import { NATURAL_VAC, SECTOR_LABEL } from "@/engine/market";
import { availability, marketBalance } from "@/engine/space";
import { resolveRec } from "@/engine/value";
import { sf, pct, pctSigned } from "@/ui/format";
import { Big, openViewOn } from "@/ui/panels/shared";
import { NewsText } from "@/ui/panels/MarketPage";
import { PHASE_BLURB, realRentYoy } from "@/ui/panels/EconomyPage";
import { boardClimate, oddsWord, pendingHearings, tradeRows } from "@/ui/panels/CityStances";

const CLASSES: BuiltClass[] = ["office", "retail", "multifamily", "industrial"];

/**
 * THE CITY ON ONE SCREEN.
 *
 * City used to open on the Economy page — eight stat tiles, a rate chart and
 * a row of cards before anything said what it meant — and the single most
 * useful reading on the desk, where finished buildings trade against what it
 * costs to put them up, was a hint line on Research. Pulse is the answer to
 * "how is the city doing and what changed", and every block on it opens the
 * view on Markets, Players or Tape that has the depth behind it. Nothing here
 * is computed differently from those pages: the market rows read the same
 * `marketBalance` / `availability` / `realRentYoy` the Markets cards read, the
 * trades read `tradeRows`, the board reads `boardClimate`.
 */
export function PulsePage() {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const setPage = useStore((s) => s.setPage);
  const focus = useStore((s) => s.focus);
  const e = game.econ;
  const goMarkets = (view: string) => { openViewOn("economy", view); setPage("economy"); };

  // THE HINGE OF THE WHOLE DEVELOPMENT CYCLE.
  const x = cityValueToReplacement(game);
  const hinge = x > 1.15
    ? "Comfortably above replacement cost — every developer in this city can see it, which is exactly how the next glut gets started. Build now and you deliver into their supply."
    : x > 1.0
      ? "Just above replacement cost. Building pencils, barely, and it does not pencil for anyone careless."
      : x > 0.85
        ? "Below replacement cost. Nobody is starting anything and the pipeline is emptying — which is what eventually fixes a soft market. Buying is cheaper than building."
        : "Far below replacement cost. Construction has stopped; buildings are worth less than the bricks in them — the best moment there is to be a buyer rather than a builder.";

  const trades = tradeRows(game);
  const moving = trades.filter((t) => t.phase !== "steady").sort((a, b) => b.mine - a.mine || Math.abs(b.mom) - Math.abs(a.mom));
  const exposed = [...trades].sort((a, b) => b.mine - a.mine)[0];
  const hearings = pendingHearings(game);
  const climate = boardClimate(game);

  // WHAT CHANGED. The month's warnings and events first; on a quiet month the
  // latest few items of any kind, so the card is never blank.
  const headlines = useMemo(() => {
    const news = game.news ?? [];
    const loud = news.filter((n) => n.q === game.month && (n.kind === "warn" || n.kind === "event"));
    return (loud.length ? loud : news).slice(0, 4);
  }, [game.news, game.month]);
  const prints12 = (game.comps ?? []).filter((c) => c.m >= game.month - 12).length;

  return (
    <div className="pulse">
      <div className="pulse-hero">
        <div className="pulse-hero-cell">
          <div className="pulse-kicker">The cycle</div>
          <div className="pulse-big">{e.phase}</div>
          <div className="pulse-line">
            {PHASE_BLURB[e.phase] ?? ""}
            {e.rumoredPhase ? <> Word on the street: <strong>{e.rumoredPhase}</strong> is coming.</> : null}
          </div>
        </div>
        <div className="pulse-hero-cell">
          <div className="pulse-kicker">Value against replacement cost</div>
          <div className={"pulse-big mono" + (x < 0.95 ? " neg" : "")}>{x.toFixed(2)}×</div>
          <div className="pulse-line">{hinge}</div>
        </div>
      </div>

      <div className="stat-strip">
        <Big label="Base rate" value={pct(e.indexRate)}
          title="Every loan in town prices off this benchmark: your floating coupons reprice to it monthly, a new quote is this rate plus the lender's spread, and cap rates lean on it — so it moves building values too." />
        {e.rateRegime !== undefined && (
          <Big label="Long-run rate" value={pct(e.rateRegime)}
            title="The base rate without this month's market noise: where the bond market expects the central bank's rate to average over the next ten years, plus the premium it charges for holding that long — wider when the bank is not believed. The base rate wanders around it month to month."
            bad={e.rateRegime > 9} />
        )}
        <Big label="Credit window" value={`${Math.round(e.creditIdx * 100)}%`} bad={e.creditIdx < 0.7} />
        <Big label="Underwriting" value={standardsWord(underwritingStandards(game))} bad={underwritingStandards(game) < -0.5}
          title="The standards every lender in town writes to. See Markets → The banks for the sheet desk by desk." />
        <Big label="Employment" value={(e.employIdx * 100).toFixed(0)} />
        <Big label="Build costs" value={(e.costIdx * 100).toFixed(0)} title="Construction and operating cost index. Salaries and budgets are billed at it." />
        <Big label="Land index" value={(e.landIdx * 100).toFixed(0)} title="Land value index. Its level is the town's own; the moves are what matter." />
      </div>

      <div className="pulse-head">
        <span>The four markets</span>
        <button type="button" className="pulse-link" onClick={() => goMarkets("general")}>All markets →</button>
      </div>
      <table className="tbl pulse-markets">
        <thead>
          <tr>
            <th>Market</th>
            <th className="num" title="Space available — empty floors plus sublet — against the rate this class settles at">Available</th>
            <th>Balance</th>
            <th className="num">Rent $/sf</th>
            <th className="num" title="Effective rent after concessions, deflated, against a year ago">Real rent · 12m</th>
            <th className="num">Cap rate</th>
            <th className="num" title="Net absorption over twelve months, as a share of the standing stock">Demand · 12m</th>
            <th className="num">Under construction</th>
          </tr>
        </thead>
        <tbody>
          {CLASSES.map((k) => {
            const v = availability(e, k);
            const bal = marketBalance(e, k);
            const ry = realRentYoy(e, k);
            // WHAT THE TENANTS DID, as against what the market feels like:
            // net absorption over twelve months against the standing stock,
            // so a shed market and an office market read on one scale.
            const abs12 = e.absorb12?.[k] ?? 0;
            const stk = e.stock?.[k] ?? 0;
            const dmd = stk > 0 ? abs12 / stk : 0;
            const pipe = e.pipeline?.[k] ?? 0;
            const soft = bal.gap > 0.018;
            return (
              <tr key={k} className="pulse-row" tabIndex={0} title={`${bal.note} Click for ${SECTOR_LABEL[k]} in depth.`}
                onClick={() => goMarkets(k)} onKeyDown={(ev) => { if (ev.key === "Enter") goMarkets(k); }}>
                <td>{SECTOR_LABEL[k]}</td>
                <td className={"num" + (soft ? " neg" : "")}>
                  {(v * 100).toFixed(1)}% <span className="dim">/ {(NATURAL_VAC[k] * 100).toFixed(1)}</span>
                </td>
                <td className={soft ? "neg" : "dim"}>{bal.state}</td>
                <td className="num">${e.rentIdx[k].toFixed(0)}</td>
                <td className={"num" + (ry < -0.025 ? " neg" : "")}>{pctSigned(ry)}</td>
                <td className="num">{pct(e.capRate[k])}</td>
                <td className={"num" + (dmd < -0.002 ? " neg" : "")}>{(dmd > 0 ? "+" : "") + (dmd * 100).toFixed(1)}%</td>
                <td className="num">{sf(Math.round(pipe))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="pulse-grid">
        <div className="pulse-card">
          <div className="pulse-head">
            <span>Employers</span>
            <button type="button" className="pulse-link" onClick={() => goMarkets("employers")}>All trades →</button>
          </div>
          {moving.length === 0
            ? <div className="pulse-line">Every trade is steady — nobody hiring hard, nobody shedding.</div>
            : (
              <div className="pulse-list">
                {moving.slice(0, 4).map((t) => (
                  <div key={t.k} className="pulse-item">
                    <span className={t.phase === "bust" ? "neg" : undefined}>{t.label}</span>
                    <span className="dim"> · {t.phase === "boom" ? "hiring hard" : "contracting"}
                      {t.mine > 0 ? ` · ${(t.mine * 100).toFixed(0)}% of your roll` : ""}</span>
                  </div>
                ))}
              </div>
            )}
          {exposed && exposed.mine > 0 && (
            <div className="pulse-line dim">
              Your biggest tenant trade is {exposed.label.toLowerCase()} at {(exposed.mine * 100).toFixed(0)}% of the roll.
            </div>
          )}
        </div>

        <div className="pulse-card">
          <div className="pulse-head">
            <span>The zoning board</span>
            <button type="button" className="pulse-link" onClick={() => goMarkets("districts")}>Districts →</button>
          </div>
          <div className="pulse-line">{climate.text.charAt(0).toUpperCase() + climate.text.slice(1)}.</div>
          {hearings.length > 0 && (
            <div className="pulse-list">
              {hearings.slice(0, 3).map((a) => (
                <button key={a.bbl} type="button" className="pulse-item pulse-item-btn" onClick={() => focus(a.bbl, true)}
                  title="Put the camera on the site">
                  {resolveRec(parcels, game, a.bbl)?.address ?? a.bbl}
                  <span className="dim"> · sits {monthLabel(a.decideM)} · {oddsWord(a.odds)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="pulse-card">
          <div className="pulse-head">
            <span>On the tape</span>
            <button type="button" className="pulse-link" onClick={() => setPage("news")}>The whole tape →</button>
          </div>
          {headlines.length === 0
            ? <div className="pulse-line">Nothing on the wire yet.</div>
            : (
              <div className="pulse-list">
                {headlines.map((n, i) => (
                  <div key={i} className={"pulse-item news-" + n.kind + (n.bbl ? " news-clickable" : "")}
                    onClick={n.bbl ? () => focus(n.bbl!, true) : undefined}>
                    <NewsText text={n.text} />{n.bbl ? " ✈" : ""}
                  </div>
                ))}
              </div>
            )}
          <button type="button" className="pulse-link pulse-foot" onClick={() => { openViewOn("news", "prints"); setPage("news"); }}>
            {prints12} closed sale{prints12 === 1 ? "" : "s"} in the last year — the prints →
          </button>
        </div>
      </div>
    </div>
  );
}
