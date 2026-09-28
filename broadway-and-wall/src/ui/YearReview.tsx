import { useEffect } from "react";
import { useStore } from "@/state/store";
import { yearReview, ordinal, careerCard, positiveLeverage } from "@/engine/standing";
import { MILESTONES } from "@/engine/sim";
import { goalProgress, goalDef } from "@/engine/goals";
import { START_YEAR, monthLabel } from "@/engine/types";
import { openResearchOn } from "@/ui/panels/shared";
import { usd } from "@/ui/format";

/**
 * THE YEAR, TOLD BACK — once a December closes. A year used to pass with a
 * toast; everything a player works for (the net worth, the place on the
 * street, the milestones) was on pages they had to go and open. This is the
 * one moment the game stops and says how it went: the verdict first, the
 * numbers behind it, and the next thing worth chasing. Dismiss it anywhere.
 */
export default function YearReview() {
  const y = useStore((s) => s.yearReviewY);
  const game = useStore((s) => s.game);
  const popupsOff = useStore((s) => s.popupsOff);
  const dismiss = useStore((s) => s.dismissYearReview);
  const career = useStore((s) => s.careerCardI);
  if (y === null || !game || popupsOff || game.gameOver || career !== null) return null;
  const r = yearReview(game, y, MILESTONES, START_YEAR);
  if (!r) return null;
  const pct = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}%`;
  const moved = r.rank0 - r.rank1;
  const parcels = useStore.getState().parcels;
  const addr = (bbl: string) => parcels?.[bbl]?.address ?? bbl;
  const go = (page: "research" | "books" | "market") => {
    if (page === "research") openResearchOn("street");
    useStore.getState().setPage(page);
    dismiss();
  };
  return (
    <div className="delivery-ceremony year-review" role="dialog" aria-modal="true" aria-labelledby="yr-title" onClick={dismiss}>
      <div className="delivery-stamp year-review-card" onClick={(e) => e.stopPropagation()}>
        <div className="delivery-kicker">The year · {r.year}</div>
        <div className="delivery-title year-review-verdict" id="yr-title">{r.verdict}</div>
        <div className="year-review-grid mono">
          <span>Net worth</span>
          <span className={r.nwPct < 0 ? "neg" : ""}>{usd(r.nw0)} → {usd(r.nw1)} · {pct(r.nwPct)}</span>
          <span>The street's median firm</span>
          <span>{pct(r.streetPct)}</span>
          <span>Your place</span>
          <span>
            {ordinal(r.rank0)} → <strong>{ordinal(r.rank1)}</strong> of {r.of}
            {moved !== 0 && <span className={moved > 0 ? "pos" : "neg"}> {moved > 0 ? "▲" : "▼"}{Math.abs(moved)}</span>}
          </span>
          {r.tier1 && (<><span>Standing</span><span>{r.tier0 && r.tier0 !== r.tier1 ? <>{r.tier0} → <strong>{r.tier1}</strong></> : r.tier1}</span></>)}
          <span>Buildings, after debt</span>
          <span className={r.cashFromBuildings < 0 ? "neg" : ""}>{usd(r.cashFromBuildings)}</span>
          <span>Office and staff</span>
          <span>−{usd(r.overhead)}</span>
          {r.taxes > 0 && (<><span>Tax</span><span>−{usd(r.taxes)}</span></>)}
          <span>Deals</span>
          <span>
            {r.deedsIn} bought · {r.deedsOut} sold · {r.leases} lease{r.leases === 1 ? "" : "s"} signed
          </span>
        </div>
        {(r.star || r.worry) && (
          <div className="year-review-next">
            {r.star && <div>★ <a className="lnk" onClick={() => { useStore.getState().openProperty(r.star!.bbl, "summary"); dismiss(); }}>{addr(r.star.bbl)}</a> — income {usd(r.star.noi0)} → {usd(r.star.noi1)} a year.</div>}
            {r.worry && <div>⚠ <a className="lnk" onClick={() => { useStore.getState().openProperty(r.worry!.bbl, "leasing"); dismiss(); }}>{addr(r.worry.bbl)}</a> — {Math.round(r.worry.occ0 * 100)}% → {Math.round(r.worry.occ1 * 100)}% let. Worth a look.</div>}
          </div>
        )}
        {(r.passed || r.passedBy) && (
          <div className="year-review-next">
            {r.passed ? <>You went past <strong>{r.passed}</strong> this year.</> : <><strong>{r.passedBy}</strong> went past you this year.</>}
          </div>
        )}
        {r.milestones.length > 0 && (
          <div className="year-review-miles">
            {r.milestones.map((m) => <div key={m}>◆ {m}</div>)}
          </div>
        )}
        {r.next && <div className="year-review-next">Next on the ladder: <strong>{r.next.label}</strong></div>}
        {(() => {
          const g = game.goal;
          const p = goalProgress(game, useStore.getState().parcels);
          if (!g || !p) return null;
          const d = goalDef(g.id);
          const left = Math.max(0, Math.ceil((g.deadlineM - game.month) / 12));
          return (
            <div className="year-review-next">
              Your goal, <strong>{d.label}</strong>: {g.doneM !== undefined ? "met" : g.failedM !== undefined ? "missed" : `${p.text} · ${left} year${left === 1 ? "" : "s"} left`}
              {g.doneM === undefined && g.failedM === undefined && (
                <div className="goal-bar"><span style={{ width: `${Math.round(p.share * 100)}%` }} /></div>
              )}
            </div>
          );
        })()}
        {(() => {
          const pl = parcels ? positiveLeverage(game, parcels) : null;
          if (!pl || pl.of === 0) return null;
          return (
            <div className="year-review-next">
              {pl.count > 0 && pl.best
                ? <>On the tape now: <strong>{pl.count} of {pl.of}</strong> buildings earn more than the cheapest money costs — the widest is <a className="lnk" onClick={() => { useStore.getState().openProperty(pl.best!.bbl, "deal"); dismiss(); }}>{addr(pl.best.bbl)}</a> at {pl.best.cap.toFixed(1)}% against {pl.best.coupon.toFixed(1)}%.</>
                : <>On the tape now: none of the {pl.of} buildings earns more than the cheapest money costs — borrowing to buy works against you this year.</>}
            </div>
          );
        })()}
        <div className="btn-row" style={{ marginTop: 14, justifyContent: "center", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-primary" onClick={dismiss}>On to {r.year + 1}</button>
          <button type="button" className="btn" onClick={() => go("research")}>The street</button>
          <button type="button" className="btn" onClick={() => go("books")}>The books</button>
          <button type="button" className="btn" onClick={() => go("market")}>The tape</button>
        </div>
      </div>
    </div>
  );
}

/**
 * A CAREER, CLOSED. The principal's death used to be one line on the tape and
 * the run went on as the heir — decades of work, and nothing said about them.
 * This is the obituary the trade press would write: where they started on the
 * street, where they finished, the best year, the book they handed on.
 */
export function CareerCard() {
  const i = useStore((s) => s.careerCardI);
  const game = useStore((s) => s.game);
  const dismiss = useStore((s) => s.dismissCareerCard);
  if (i === null || !game || game.gameOver) return null;
  const c = careerCard(game, i, MILESTONES, START_YEAR);
  if (!c) return null;
  return (
    <div className="delivery-ceremony year-review" role="dialog" aria-modal="true" aria-labelledby="career-title" onClick={dismiss}>
      <div className="delivery-stamp year-review-card" onClick={(e) => e.stopPropagation()}>
        <div className="delivery-kicker">{c.name} · {c.fromYear}–{c.toYear} · died at {c.age}</div>
        <div className="delivery-title year-review-verdict" id="career-title">{c.verdict}</div>
        <div className="year-review-grid mono">
          <span>The book</span>
          <span>{usd(c.nw0)} handed over → {usd(c.nw1)} at the end</span>
          {c.rank0 !== null && c.rank1 !== null && (<><span>On the street</span><span>{ordinal(c.rank0)} → <strong>{ordinal(c.rank1)}</strong> of {c.of}</span></>)}
          {c.best && (<><span>Best year</span><span>{ordinal(c.best.rank)} of {c.best.of} · {c.best.year}</span></>)}
          <span>Deeds</span><span>{c.bought} bought · {c.sold} sold · {c.years} years</span>
          <span>Estate tax</span><span>{c.tax > 0 ? usd(c.tax) : "under the exclusion"}</span>
        </div>
        {c.milestones.length > 0 && (
          <div className="year-review-miles">{c.milestones.map((m) => <div key={m}>◆ {m}</div>)}</div>
        )}
        <div className="year-review-next">You continue as <strong>{c.heir}</strong>. The buildings stay. The phone book does not.</div>
        <div className="btn-row" style={{ marginTop: 14, justifyContent: "center" }}>
          <button type="button" className="btn btn-primary" onClick={dismiss}>Carry on as {c.heir}</button>
        </div>
      </div>
    </div>
  );
}

/** The milestone banner: gold, four seconds, gone. The ladder is on Books. */
export function MilestoneFlash() {
  const flash = useStore((s) => s.milestoneFlash);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => useStore.setState({ milestoneFlash: null }), 4200);
    return () => clearTimeout(t);
  }, [flash]);
  if (!flash) return null;
  return (
    <div className="milestone-flash" role="status" onClick={() => useStore.setState({ milestoneFlash: null })}>
      <div className="delivery-kicker">Milestone</div>
      {flash.map((m) => <div key={m} className="milestone-flash-line">◆ {m}</div>)}
    </div>
  );
}

/**
 * A SALE, CLOSED. An exit is the other half of every deal — the number the
 * whole hold was for — and it used to end in "Closed. Cash is position." The
 * Exit record already carried the dates, the price and the basis; this reads
 * them back. The per-year figure is the PRICE's growth over the basis — what
 * the building did. What the EQUITY did comes from the deed's own cash ledger
 * (GameState.deedCf): every dollar in and every dollar back over the hold,
 * levered and before tax, with the IRR on the dated flows. A deed with no
 * complete ledger (bought before it existed, taken through a note, financed in
 * a crossed pool) shows no equity rows rather than wrong ones.
 */
export function ExitCard() {
  const card = useStore((s) => s.exitCard);
  const game = useStore((s) => s.game);
  const popupsOff = useStore((s) => s.popupsOff);
  const dismiss = useStore((s) => s.dismissExitCard);
  const yr = useStore((s) => s.yearReviewY);
  if (!card || !game || popupsOff || game.gameOver || yr !== null) return null;
  const e = game.exits?.[card.i];
  if (!e) return null;
  const yrs = Math.max(0, (e.soldM - e.boughtM) / 12);
  const mult = e.basis > 0 ? e.price / e.basis : 0;
  const perYr = e.basis > 0 && yrs >= 1 ? (Math.pow(mult, 1 / yrs) - 1) * 100 : null;
  const verdict = e.gain <= 0 ? "Sold at a loss." : mult >= 2 ? "Sold for twice what it cost." : mult >= 1.4 ? "A good exit." : "Sold at a profit.";
  return (
    <div className="delivery-ceremony year-review" role="dialog" aria-modal="true" aria-labelledby="exit-title" onClick={dismiss}>
      <div className="delivery-stamp year-review-card" onClick={(ev) => ev.stopPropagation()}>
        <div className="delivery-kicker">Sold · {e.address}</div>
        <div className="delivery-title year-review-verdict" id="exit-title">{verdict}</div>
        <div className="year-review-grid mono">
          <span>Bought</span><span>{monthLabel(e.boughtM)} · basis {usd(e.basis)}</span>
          <span>Sold</span><span>{monthLabel(e.soldM)} · {usd(e.price)}</span>
          <span>Held</span><span>{yrs < 1 ? `${e.soldM - e.boughtM} months` : `${yrs.toFixed(1)} years`}</span>
          <span>Gain on basis</span>
          <span className={e.gain < 0 ? "neg" : "pos"}><strong>{usd(e.gain)}</strong>{mult > 0 ? ` · ${mult.toFixed(2)}×` : ""}</span>
          {perYr !== null && (<><span>Price, per year held</span><span>{perYr >= 0 ? "+" : "−"}{Math.abs(perYr).toFixed(1)}% a year over basis</span></>)}
          {e.equityIn ? (<>
            <span>Equity in</span><span title="Closing equity, leasing, capital, development, debt service and paydowns over the hold">{usd(e.equityIn)}</span>
            <span>Equity back</span><span title="NOI, refinance draws and net sale proceeds over the hold — before tax">{usd(e.equityOut ?? 0)}</span>
            <span>Equity multiple</span>
            <span className={(e.equityOut ?? 0) < e.equityIn ? "neg" : "pos"}><strong>{((e.equityOut ?? 0) / e.equityIn).toFixed(2)}×</strong></span>
            <span>IRR (levered, before tax)</span>
            <span className={e.irr != null && e.irr < 0 ? "neg" : undefined}>{e.irr != null ? `${(e.irr * 100).toFixed(1)}% a year` : "— (the flows do not solve to one rate)"}</span>
          </>) : null}
          {card.cash !== undefined && (<><span>Cash in at closing</span><span title="After the loan payoff, closing costs and any partner's share">{usd(card.cash)} net</span></>)}
        </div>
        <div className="btn-row" style={{ marginTop: 14, justifyContent: "center", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-primary" onClick={dismiss}>Back to the desk</button>
          <button type="button" className="btn" onClick={() => { useStore.getState().setPage("market"); dismiss(); }}>Put it to work</button>
          <button type="button" className="btn" onClick={() => { useStore.getState().setPage("firm"); dismiss(); }}>The record</button>
        </div>
      </div>
    </div>
  );
}

/**
 * THE GOAL, DECIDED. Met or out of time — the one ending a hundred-year town
 * has, because the player drew it. The run goes on either way.
 */
export function GoalCard() {
  const verdict = useStore((s) => s.goalCard);
  const game = useStore((s) => s.game);
  const popupsOff = useStore((s) => s.popupsOff);
  if (!verdict || !game?.goal || popupsOff) return null;
  const g = game.goal;
  const d = goalDef(g.id);
  const yrs = ((verdict === "done" ? g.doneM ?? game.month : game.month) - g.setM) / 12;
  const close = () => useStore.setState({ goalCard: null });
  return (
    <div className="delivery-ceremony year-review" role="dialog" aria-modal="true" aria-labelledby="goal-title" onClick={close}>
      <div className="delivery-stamp year-review-card" onClick={(e) => e.stopPropagation()}>
        <div className="delivery-kicker">Your goal · {d.label}</div>
        <div className="delivery-title year-review-verdict" id="goal-title">
          {verdict === "done" ? `Done, in ${yrs.toFixed(1)} years.` : `Time ran out after ${d.years} years.`}
        </div>
        <div className="year-review-next">
          {d.detail}. {verdict === "done"
            ? `The deadline was ${d.years} years; you made it with ${Math.max(0, d.years - yrs).toFixed(1)} to spare.`
            : `Where it stood at the deadline: ${goalProgress(game, useStore.getState().parcels)?.text ?? "—"}.`}
          {" "}The town carries on — the run is yours to keep playing.
        </div>
        <div className="btn-row" style={{ marginTop: 14, justifyContent: "center" }}>
          <button type="button" className="btn btn-primary" onClick={close}>Carry on</button>
        </div>
      </div>
    </div>
  );
}
